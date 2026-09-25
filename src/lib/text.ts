import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

export function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Lowercase, diacritics and punctuation stripped, whitespace collapsed. */
export function normalise(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function slugify(s: string): string {
  return normalise(s).replace(/ /g, "-");
}

export function words(s: string): string[] {
  const n = normalise(s);
  return n ? n.split(" ") : [];
}

/** Set of n-word shingles, used by the copyright guard. */
export function shingles(text: string, n: number): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

/** Returns the first n-word span of `candidate` that also appears in `source`, or null. */
export function sharedSpan(candidate: string, source: string | Set<string>, n: number): string | null {
  const src = typeof source === "string" ? shingles(source, n) : source;
  const w = words(candidate);
  for (let i = 0; i + n <= w.length; i++) {
    const span = w.slice(i, i + n).join(" ");
    if (src.has(span)) return span;
  }
  return null;
}

const TITLE_STOPWORDS = new Set(["the", "a", "an", "and", "of", "in", "at", "with", "en", "die", "van", "concert", "konsert", "presents", "2025", "2026", "2027", "2028"]);

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/ /g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function dice(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, c] of A) {
    inter += Math.min(c, B.get(g) ?? 0);
    total += c;
  }
  for (const c of B.values()) total += c;
  return total ? (2 * inter) / total : 0;
}

/**
 * Title similarity in [0,1]: the better of character-bigram Dice over the
 * stopword-stripped titles and token containment (one title's tokens all
 * inside the other's, which is how vendors tend to decorate presenter titles:
 * "JPO Symphonic Jazz" vs "The JPO Symphonic Jazz Concert 2026").
 */
export function titleSimilarity(a: string, b: string): number {
  const ta = words(a).filter((w) => !TITLE_STOPWORDS.has(w));
  const tb = words(b).filter((w) => !TITLE_STOPWORDS.has(w));
  if (!ta.length || !tb.length) return 0;
  const d = dice(ta.join(" "), tb.join(" "));
  const setB = new Set(tb);
  const setA = new Set(ta);
  const small = ta.length <= tb.length ? ta : tb;
  const other = small === ta ? setB : setA;
  const contained = small.filter((w) => other.has(w)).length / small.length;
  // Containment of a one-word title is weak evidence ("Messiah" is in a lot of titles).
  const containment = small.length >= 2 ? contained * 0.95 : contained * 0.7;
  return Math.max(d, containment);
}

const BLOCK = new Set([
  "p", "div", "section", "article", "header", "footer", "li", "ul", "ol", "table", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
  "br", "hr", "dt", "dd", "dl", "blockquote", "pre", "figure", "figcaption", "main", "aside", "td", "th",
]);
const DROP = "script, style, noscript, svg, iframe, form, template, nav, [aria-hidden='true'], .screen-reader-text";

export interface HtmlToTextOptions {
  baseUrl: string;
  /** CSS selector for the main content region. Falls back to <main>, then <body>. */
  contentSelector?: string;
  /** Extra selectors to strip (cookie banners, related-posts carousels…). */
  remove?: string[];
}

/**
 * HTML → plain text for the extractor. Keeps link targets inline as
 * "text <url>" because ticket URLs are the most useful thing on most pages,
 * and appends schema.org Event JSON-LD verbatim when present.
 */
export function htmlToText(html: string, opts: HtmlToTextOptions): string {
  const $ = cheerio.load(html);
  const jsonLd: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text().trim();
    if (/"@type"\s*:\s*"[^"]*Event"/.test(raw)) jsonLd.push(raw.replace(/\s+/g, " "));
  });
  const title = $("title").first().text().trim();
  $(DROP).remove();
  for (const sel of opts.remove ?? []) $(sel).remove();

  let root = opts.contentSelector ? $(opts.contentSelector) : $("main");
  if (!root.length) root = $("body");
  if (!root.length) root = $.root();

  const out: string[] = [];
  const walk = (node: AnyNode) => {
    if (node.type === "text") {
      out.push((node as unknown as { data: string }).data.replace(/\s+/g, " "));
      return;
    }
    if (node.type !== "tag") return;
    const el = node as unknown as { name: string; attribs: Record<string, string>; children: AnyNode[] };
    const name = el.name.toLowerCase();
    if (name === "img") {
      const alt = el.attribs.alt?.trim();
      if (alt) out.push(` [image: ${alt}] `);
      return;
    }
    const isBlock = BLOCK.has(name);
    if (isBlock) out.push("\n");
    for (const c of el.children) walk(c);
    if (name === "a") {
      const href = el.attribs.href?.trim();
      if (href && !href.startsWith("#") && !/^(javascript|mailto|tel):/i.test(href)) {
        try {
          const abs = new URL(href, opts.baseUrl).toString();
          out.push(` <${abs}>`);
        } catch {
          /* unparseable href, skip */
        }
      }
    }
    if (isBlock) out.push("\n");
  };
  root.each((_, el) => walk(el));

  const body = out
    .join("")
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  const parts = [];
  if (title) parts.push(`PAGE TITLE: ${title}`);
  parts.push(body);
  if (jsonLd.length) parts.push(`STRUCTURED DATA (schema.org JSON-LD):\n${jsonLd.join("\n")}`);
  return parts.join("\n\n").trim() + "\n";
}

/** Split long text on paragraph (or PDF page) boundaries into chunks of at most `max` chars. */
export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const units = text.includes("\f") ? text.split("\f") : text.split(/\n(?=\S)/);
  const chunks: string[] = [];
  let cur = "";
  for (const u of units) {
    if (cur && cur.length + u.length + 1 > max) {
      chunks.push(cur);
      cur = "";
    }
    if (u.length > max) {
      for (let i = 0; i < u.length; i += max) chunks.push(u.slice(i, i + max));
      continue;
    }
    cur = cur ? `${cur}\n${u}` : u;
  }
  if (cur) chunks.push(cur);
  return chunks;
}
