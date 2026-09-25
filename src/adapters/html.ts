import * as cheerio from "cheerio";
import { extractText, getDocumentProxy } from "unpdf";
import { FETCH } from "../lib/config.ts";
import { HttpError } from "../lib/http.ts";
import { errorMessage } from "../lib/log.ts";
import type { HtmlAdapterConfig, SourceConfig } from "../lib/sources.ts";
import { htmlToText } from "../lib/text.ts";
import { canonicalUrl } from "../lib/url.ts";

export { canonicalUrl };
import type { Adapter, AdapterContext, FetchedDocument } from "./types.ts";

const isPdf = (contentType: string, url: string) => contentType.includes("application/pdf") || /\.pdf($|\?)/i.test(url);

export async function pdfToText(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  // Form feed between pages so the chunker can split on page boundaries.
  return (text as string[]).map((p) => p.replace(/[ \t]+/g, " ").trim()).join("\n\f\n") + "\n";
}


async function toDocument(url: string, cfg: HtmlAdapterConfig, ctx: AdapterContext): Promise<FetchedDocument> {
  const r = await ctx.getBody(url);
  if (isPdf(r.contentType, r.finalUrl)) {
    return { url, kind: "pdf", text: await pdfToText(r.body), raw: r.body, etag: r.etag, lastModified: r.lastModified };
  }
  const html = r.body.toString("utf8");
  const text = htmlToText(html, { baseUrl: r.finalUrl, contentSelector: cfg.contentSelector, remove: cfg.remove });
  return { url, kind: "html", text, raw: r.body, etag: r.etag, lastModified: r.lastModified };
}

/**
 * Generic HTML adapter. Covers the three shapes most SA presenter sites take:
 *   1. a listing page linking to one detail page per concert (follow),
 *   2. a single season page with everything inline (no follow),
 *   3. a calendar widget with the events embedded as data (split).
 * PDFs linked from listing pages are fetched and text-extracted here.
 */
export const htmlAdapter: Adapter = async (source: SourceConfig, ctx: AdapterContext) => {
  const cfg = source.adapter as HtmlAdapterConfig;
  const docs: FetchedDocument[] = [];
  const detailUrls: string[] = [];
  const extractStart = cfg.extractStartPages ?? (!cfg.follow && !cfg.split);

  for (const start of cfg.startUrls) {
    const r = await ctx.getBody(start);
    const html = r.body.toString("utf8");

    if (cfg.split) {
      for (const item of cfg.split(html, r.finalUrl)) {
        docs.push({ url: item.url ?? `${start.split("#")[0]}#${encodeURIComponent(item.key)}`, kind: "text", text: item.text });
      }
    }

    if (cfg.follow) {
      const $ = cheerio.load(html);
      $(cfg.follow.selector).each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        let abs: string;
        try {
          abs = canonicalUrl(new URL(href, r.finalUrl).toString());
        } catch {
          return;
        }
        if (!/^https?:/.test(abs)) return;
        if (cfg.follow!.include && !cfg.follow!.include.test(abs)) return;
        if (cfg.follow!.exclude && cfg.follow!.exclude.test(abs)) return;
        if (cfg.follow!.keep && !cfg.follow!.keep($(el).text().replace(/\s+/g, " ").trim())) return;
        if (!detailUrls.includes(abs) && !cfg.startUrls.includes(abs)) detailUrls.push(abs);
      });
    }

    if (extractStart) {
      const text = htmlToText(html, { baseUrl: r.finalUrl, contentSelector: cfg.contentSelector, remove: cfg.remove });
      docs.push({ url: start, kind: "html", text, raw: r.body, etag: r.etag, lastModified: r.lastModified });
    }
  }

  if (cfg.follow && !detailUrls.length) ctx.warn(`follow selector "${cfg.follow.selector}" matched no links; layout change or simply nothing listed`);
  const max = cfg.follow?.max ?? FETCH.defaultMaxDocuments;
  if (detailUrls.length > max) ctx.warn(`${detailUrls.length} detail links found, capped at ${max}`);
  for (const url of detailUrls.slice(0, max)) {
    try {
      docs.push(await toDocument(url, cfg, ctx));
    } catch (err) {
      // A single dead detail page is a warning, not a source failure. If we knew the page,
      // keep its last copy: a transient error must not make its event look withdrawn. A 404/410
      // means the page really is gone, so its event is allowed to go unconfirmed.
      const gone = err instanceof HttpError && (err.status === 404 || err.status === 410);
      if (!gone && ctx.keepPrevious(url)) ctx.warn(`kept last copy of ${url} after fetch error: ${errorMessage(err)}`);
      else ctx.warn(`skipped ${url}: ${errorMessage(err)}`);
    }
  }
  return docs;
};
