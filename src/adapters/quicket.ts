import { now } from "../lib/time.ts";
import type { QuicketAdapterConfig, SourceConfig } from "../lib/sources.ts";
import { htmlToText } from "../lib/text.ts";
import { canonicalUrl } from "../lib/url.ts";
import type { Adapter, FetchedDocument } from "./types.ts";

const API = "https://api.quicket.co.za/api/events";

/** Subset of the Quicket public API event object (docs.quicket.com, "Events" collection). */
export interface QuicketEvent {
  id: number;
  name: string;
  description?: string | null;
  url: string;
  startDate: string;
  endDate?: string | null;
  lastModified?: string;
  venue?: { name?: string | null; addressLine1?: string | null; addressLine2?: string | null; latitude?: number | null; longitude?: number | null } | null;
  locality?: { levelOne?: string | null; levelTwo?: string | null; levelThree?: string | null } | null;
  organiser?: { id?: number; name?: string | null; organiserPageUrl?: string | null } | null;
  categories?: { id: number; name: string }[] | null;
  tickets?: { name?: string | null; soldOut?: boolean; provisionallySoldOut?: boolean; price?: number | null; donation?: boolean }[] | null;
  schedules?: { name?: string | null; startDate?: string | null; endDate?: string | null }[] | null;
}

interface ListResult {
  results: QuicketEvent[];
  pages: number;
  records: number;
}

/**
 * Render one Quicket event as a small, stable text document. Only fields that
 * mean something to a concert-goer go in: volatile ones (lastModified, image
 * URLs) would change the content hash and trigger pointless LLM calls.
 */
export function renderQuicketEvent(e: QuicketEvent): string {
  const lines = ["QUICKET EVENT (fields from the Quicket public API; times are as Quicket reports them)", `Name: ${e.name}`];
  lines.push(`Event page: ${canonicalUrl(e.url)}`);
  lines.push(`Start: ${e.startDate}`);
  if (e.endDate) lines.push(`End: ${e.endDate}`);
  const v = e.venue;
  if (v?.name) lines.push(`Venue: ${[v.name, v.addressLine1, v.addressLine2].filter(Boolean).join(", ")}`);
  if (v?.latitude && v?.longitude) lines.push(`Venue coordinates: ${v.latitude}, ${v.longitude}`);
  const loc = e.locality;
  if (loc) lines.push(`Locality: ${[loc.levelThree, loc.levelTwo, loc.levelOne].filter(Boolean).join(", ")}`);
  if (e.organiser?.name) lines.push(`Organiser: ${e.organiser.name}${e.organiser.organiserPageUrl ? ` <${e.organiser.organiserPageUrl}>` : ""}`);
  if (e.categories?.length) lines.push(`Categories: ${e.categories.map((c) => c.name).join(", ")}`);
  if (e.tickets?.length) {
    lines.push("Tickets:");
    for (const t of e.tickets) {
      const flags = [t.soldOut ? "sold out" : null, t.donation ? "donation" : null].filter(Boolean).join(", ");
      lines.push(`- ${t.name ?? "Ticket"}: R${t.price ?? "?"}${flags ? ` (${flags})` : ""}`);
    }
  }
  if (e.schedules && e.schedules.length > 1) {
    lines.push("Performances:");
    for (const s of e.schedules) lines.push(`- ${s.name ?? ""} ${s.startDate ?? ""}${s.endDate ? ` to ${s.endDate}` : ""}`.trim());
  }
  if (e.description) {
    lines.push("", "Description:", htmlToText(`<body>${e.description}</body>`, { baseUrl: e.url }).replace(/^PAGE TITLE:.*\n+/, ""));
  }
  return lines.join("\n").trim() + "\n";
}

/**
 * Latest date the listing covers: its own end/start and every separately dated
 * performance. A run whose first night has passed can still have shows to come.
 */
export function lastDate(e: QuicketEvent): number | null {
  const dates = [e.endDate, e.startDate, ...(e.schedules ?? []).flatMap((s) => [s.endDate, s.startDate])]
    .map((d) => (d ? Date.parse(d) : NaN))
    .filter(Number.isFinite);
  return dates.length ? Math.max(...dates) : null;
}

export function quicketMatches(e: QuicketEvent, cfg: QuicketAdapterConfig): boolean {
  if (e.organiser?.id && cfg.organiserIds?.includes(e.organiser.id)) return true;
  const hay = [e.name, e.description ?? "", e.organiser?.name ?? "", ...(e.categories ?? []).map((c) => c.name), e.venue?.name ?? ""].join(" ");
  return cfg.keywords.test(hay);
}

/**
 * Quicket public API. Needs QUICKET_API_KEY (free, developer.quicket.co.za).
 * One document per matching event, so a changed event costs one LLM call.
 */
export const quicketAdapter: Adapter = async (source: SourceConfig, ctx) => {
  const cfg = source.adapter as QuicketAdapterConfig;
  const key = process.env.QUICKET_API_KEY;
  if (!key) throw new Error("QUICKET_API_KEY is not set (add it as a repository secret)");
  const pageSize = cfg.pageSize ?? 100;
  const cutoff = now().getTime() - 24 * 3600_000;
  const docs: FetchedDocument[] = [];
  let seen = 0;

  for (let page = 1; page <= 200; page++) {
    const params = new URLSearchParams({ api_key: key, pageSize: String(pageSize), page: String(page) });
    if (cfg.categories.length) params.set("categories", cfg.categories.join(","));
    const res = await ctx.client.get(`${API}?${params}`);
    const data = JSON.parse(res.body.toString("utf8")) as ListResult;
    for (const e of data.results ?? []) {
      seen++;
      const end = lastDate(e);
      if (end !== null && end < cutoff) continue;
      if (!quicketMatches(e, cfg)) continue;
      docs.push({ url: canonicalUrl(e.url), kind: "json", text: renderQuicketEvent(e) });
    }
    if (page >= (data.pages ?? 1) || !(data.results ?? []).length) break;
  }
  if (!seen) throw new Error("Quicket API returned no events at all; key or endpoint problem");
  return docs;
};
