import * as cheerio from "cheerio";
import { defineSource, type SplitItem } from "../src/lib/sources.ts";
import { normaliseTimestamp, now } from "../src/lib/time.ts";
import { htmlToText, slugify } from "../src/lib/text.ts";

interface CalendarEntry {
  title: string;
  description: string;
  start: string;
  end?: string;
  allDay?: string;
  url?: string;
}

/**
 * The /concerts/ page embeds its whole calendar (Essential Addons event
 * calendar widget) as JSON in a data-events attribute, past seasons included.
 * Each upcoming entry becomes its own document so one edit costs one call.
 */
export function splitCpoCalendar(html: string, pageUrl: string): SplitItem[] {
  const $ = cheerio.load(html);
  const raw = $("[data-events]").first().attr("data-events");
  if (!raw) throw new Error("CPO calendar widget (data-events) not found on the page");
  const entries = JSON.parse(raw) as CalendarEntry[];
  const cutoff = now().getTime() - 24 * 3600_000;
  const items: SplitItem[] = [];
  for (const e of entries) {
    // "2026-11-12", "2026-11-12 19:30" and "2026-11-12 19:30:00" all occur. Anything
    // unparseable is kept (the extractor decides) rather than silently dropped.
    const toMs = (s?: string) => (s ? Date.parse(normaliseTimestamp(s.slice(0, 19)) ?? "") : NaN);
    const startMs = toMs(e.start);
    const endMs = toMs(e.end);
    const latest = Math.max(...[startMs, endMs].filter(Number.isFinite));
    if (Number.isFinite(latest) && latest < cutoff) continue;
    const details = htmlToText(`<body>${e.description}</body>`, { baseUrl: pageUrl }).replace(/^PAGE TITLE:.*\n+/, "");
    const lines = [
      "CALENDAR ENTRY from the Cape Town Philharmonic Orchestra's concert calendar",
      `Title: ${e.title.trim()}`,
      `Start (local time): ${e.start}${e.allDay === "yes" ? " (all-day entry: no performance time given)" : ""}`,
      // The widget stores end times as "22:00:01" defaults; they're noise, not facts.
      e.allDay === "yes" && e.end ? `End date (exclusive): ${e.end}` : "",
      e.url ? `Link: ${e.url}` : "",
      "Details:",
      details.trim() || "(none)",
    ].filter(Boolean);
    items.push({ key: `${e.start.replace(/[^0-9]/g, "")}-${slugify(e.title).slice(0, 60)}`, text: lines.join("\n") + "\n" });
  }
  return items;
}

export default defineSource({
  slug: "cpo",
  name: "Cape Town Philharmonic Orchestra",
  role: "presenter",
  homepage: "https://cpo.org.za/",
  hint: "Cape Town Philharmonic Orchestra calendar. Its symphony seasons are at Cape Town City Hall unless the entry says otherwise, but only use a venue the entry itself states.",
  adapter: {
    type: "html",
    startUrls: ["https://cpo.org.za/concerts/"],
    split: splitCpoCalendar,
  },
});
