import robotsParserModule from "robots-parser";
import { BOT_TOKEN, FETCH, USER_AGENT } from "./config.ts";
import { redact } from "./log.ts";

export class RobotsDisallowed extends Error {}
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Robots {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
}
// robots-parser is CommonJS with ESM-style typings; NodeNext sees the namespace, not the function.
const robotsParser = robotsParserModule as unknown as (url: string, contents: string) => Robots;

export interface HttpResponse {
  status: number;
  url: string;
  headers: Headers;
  body: Buffer;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Polite HTTP: one request per `minIntervalMs` per host (or the site's
 * Crawl-delay if longer), robots.txt checked before every request and
 * failing closed, descriptive User-Agent, hard timeout and size cap.
 */
export class PoliteClient {
  private nextSlot = new Map<string, number>();
  private robots = new Map<string, Promise<Robots | { unreachable: string }>>();

  constructor(private readonly minIntervalMs = FETCH.minIntervalMs) {}

  private async throttle(host: string, delayMs: number) {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + delayMs);
    if (slot > now) await sleep(slot - now);
  }

  private loadRobots(origin: string): Promise<Robots | { unreachable: string }> {
    let p = this.robots.get(origin);
    if (!p) {
      p = (async () => {
        const url = `${origin}/robots.txt`;
        let why = "";
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await this.raw(url, {}, this.minIntervalMs);
            // RFC 9309: 4xx means no restrictions. We make 401/403 an exception and
            // fail closed, because a site blocking robots.txt is telling us something.
            if (res.status === 401 || res.status === 403) return { unreachable: `HTTP ${res.status}` };
            if (res.status >= 400 && res.status < 500) return robotsParser(url, "");
            if (res.status < 300) return robotsParser(url, res.body.toString("utf8"));
            why = `HTTP ${res.status}`;
          } catch (err) {
            why = err instanceof Error ? `${err.message}${err.cause instanceof Error ? ` (${err.cause.message})` : ""}` : String(err);
          }
          if (attempt === 0) await sleep(5000);
        }
        return { unreachable: why };
      })();
      this.robots.set(origin, p);
    }
    return p;
  }

  /** Throws RobotsDisallowed if robots.txt forbids the URL or can't be read. */
  async checkRobots(url: string): Promise<number> {
    const { origin } = new URL(url);
    const robots = await this.loadRobots(origin);
    if ("unreachable" in robots) throw new RobotsDisallowed(`robots.txt for ${origin} unreachable (${robots.unreachable}); failing closed`);
    if (robots.isAllowed(url, BOT_TOKEN) === false) throw new RobotsDisallowed(`robots.txt disallows ${redact(url)} for ${BOT_TOKEN}`);
    const crawlDelay = robots.getCrawlDelay(BOT_TOKEN);
    return Math.max(this.minIntervalMs, crawlDelay ? crawlDelay * 1000 : 0);
  }

  private async raw(url: string, headers: Record<string, string>, delayMs: number): Promise<HttpResponse> {
    const host = new URL(url).host;
    await this.throttle(host, delayMs);
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,application/json,application/pdf;q=0.9,*/*;q=0.5", ...headers },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH.timeoutMs),
    });
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > FETCH.maxBytes) throw new HttpError(`response too large (${len} bytes) from ${redact(url)}`, res.status);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > FETCH.maxBytes) throw new HttpError(`response too large (${body.length} bytes) from ${redact(url)}`, res.status);
    return { status: res.status, url: res.url, headers: res.headers, body };
  }

  /**
   * GET with robots check, conditional headers and one retry on network error
   * or 5xx. Returns 304 responses as-is; throws on other non-2xx.
   */
  async get(url: string, conditional: { etag?: string | null; lastModified?: string | null } = {}): Promise<HttpResponse> {
    const delay = await this.checkRobots(url);
    const headers: Record<string, string> = {};
    if (conditional.etag) headers["if-none-match"] = conditional.etag;
    if (conditional.lastModified) headers["if-modified-since"] = conditional.lastModified;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.raw(url, headers, delay);
        if (res.status === 304 || (res.status >= 200 && res.status < 300)) return res;
        if (res.status >= 500 || res.status === 429) {
          lastErr = new HttpError(`HTTP ${res.status} from ${redact(url)}`, res.status);
          await sleep(5000);
          continue;
        }
        throw new HttpError(`HTTP ${res.status} from ${redact(url)}`, res.status);
      } catch (err) {
        if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
        lastErr = err;
        if (attempt === 0) await sleep(5000);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}
