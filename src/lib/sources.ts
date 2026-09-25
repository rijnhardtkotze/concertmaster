import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PATHS } from "./config.ts";

/**
 * How dedupe picks the canonical record when several sources list the same
 * concert: the presenter's own page wins; a ticket vendor never does, but its
 * ticket URL is kept.
 */
export type SourceRole = "presenter" | "venue" | "aggregator" | "vendor";

export interface SplitItem {
  /** Stable per-item key, unique within the page. Becomes the URL fragment. */
  key: string;
  /** Canonical URL for the item if it has its own page; defaults to page#key. */
  url?: string;
  text: string;
}

export interface HtmlAdapterConfig {
  type: "html";
  /** Listing or season pages. */
  startUrls: string[];
  /**
   * Follow links from the start pages to detail pages (HTML or PDF). If absent,
   * the start pages themselves are the documents.
   */
  follow?: {
    selector: string;
    include?: RegExp;
    exclude?: RegExp;
    /** Default FETCH.defaultMaxDocuments. */
    max?: number;
    /** Keep a link only if this returns true for its text (e.g. a genre label on a listing card). */
    keep?: (linkText: string) => boolean;
  };
  /** For paginated listings/APIs: the next page's URL given this page's body, or null when done. */
  nextPage?: (body: string, url: string) => string | null;
  /** Also send the start pages to the extractor (default: true when there is no `follow`). */
  extractStartPages?: boolean;
  /** Main-content selector for detail pages. Strips nav/footer noise, which also stabilises content hashes. */
  contentSelector?: string;
  remove?: string[];
  /**
   * Escape hatch for pages that embed many events in one blob (e.g. a calendar
   * widget's JSON). Each returned item becomes its own document, so one changed
   * event costs one LLM call rather than the whole page.
   */
  split?: (html: string, pageUrl: string) => SplitItem[];
}

export interface QuicketAdapterConfig {
  type: "quicket";
  /** Quicket category ids; empty = all public events. */
  categories: number[];
  /** Cheap pre-filter before the LLM: an event must match to be extracted at all. */
  keywords: RegExp;
  /** Events from these organisers are always kept regardless of keywords. */
  organiserIds?: number[];
  pageSize?: number;
}

export interface SourceConfig {
  /** Short slug, used as source.publisher. */
  slug: string;
  name: string;
  role: SourceRole;
  homepage: string;
  enabled?: boolean;
  /** Force the stronger extraction model (e.g. for image-heavy or scanned sources). */
  model?: "fast" | "strong";
  /** Treat "no documents found" as normal (seasonal sources). Otherwise it counts as a failure. */
  allowEmpty?: boolean;
  /** Free-text hint appended to the document header. Keep it factual: which city, which presenter. */
  hint?: string;
  /**
   * The presenter to record when the extractor leaves `presenter` empty. Set it only for a
   * presenter's own listing, where everything on the site is theirs (the extractor is told
   * not to infer, so a calendar entry that never names the orchestra comes back null). A
   * presenter the page does name always wins.
   */
  defaultPresenter?: string;
  adapter: HtmlAdapterConfig | QuicketAdapterConfig;
}

export function defineSource(cfg: SourceConfig): SourceConfig {
  if (!/^[a-z0-9-]+$/.test(cfg.slug)) throw new Error(`source slug must be kebab-case: ${cfg.slug}`);
  return cfg;
}

/** Every *.ts file in sources/ that default-exports a SourceConfig. No registry to edit. */
export async function loadSources(only?: string): Promise<SourceConfig[]> {
  const files = fs
    .readdirSync(PATHS.sources)
    .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
    .sort();
  const out: SourceConfig[] = [];
  for (const f of files) {
    const mod = (await import(pathToFileURL(path.join(PATHS.sources, f)).href)) as { default: SourceConfig };
    const cfg = mod.default;
    if (!cfg?.slug) throw new Error(`sources/${f} has no default export from defineSource()`);
    if (cfg.slug !== f.replace(/\.ts$/, "")) throw new Error(`sources/${f}: slug '${cfg.slug}' must match the filename`);
    if (cfg.enabled === false) continue;
    if (only && cfg.slug !== only) continue;
    out.push(cfg);
  }
  if (only && !out.length) throw new Error(`no enabled source with slug '${only}'`);
  return out;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
    if (v !== undefined) args[k] = v;
    else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) args[k] = argv[++i]!;
    else args[k] = true;
  }
  const source = (typeof args.source === "string" && args.source) || process.env.INGEST_SOURCE || undefined;
  return { ...args, source: source || undefined, force: args.force === true };
}
