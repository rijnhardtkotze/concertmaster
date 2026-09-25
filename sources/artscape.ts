import * as cheerio from "cheerio";
import { CLASSICAL_KEYWORDS } from "../src/lib/keywords.ts";
import { defineSource, type SplitItem } from "../src/lib/sources.ts";
import { htmlToText } from "../src/lib/text.ts";
import { canonicalUrl } from "../src/lib/url.ts";

interface TribeEvent {
  title: string;
  url: string;
  description: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  cost: string;
  website: string;
  categories: { name: string; slug: string }[];
  venue: { venue?: string; city?: string; address?: string } | [];
  organizer: { organizer?: string }[] | [];
}

const MUSIC_CATEGORIES = /opera|orchestral|classic|choral|a-cappella|concert|music/i;

/**
 * Artscape runs The Events Calendar, whose REST API returns upcoming events as
 * JSON. We keep music/opera categories plus anything uncategorised or matching
 * the classical keywords (flagship productions sometimes have no category).
 */
export function splitArtscape(body: string): SplitItem[] {
  const data = JSON.parse(body) as { events: TribeEvent[]; total: number };
  const items: SplitItem[] = [];
  const decode = (s: string) => cheerio.load(`<p>${s}</p>`)("p").text();
  for (const e of data.events ?? []) {
    e.title = decode(e.title);
    const cats = e.categories.map((c) => decode(c.name));
    const text = htmlToText(`<body>${e.description}</body>`, { baseUrl: e.url }).replace(/^PAGE TITLE:.*\n+/, "");
    const relevant = !cats.length || cats.some((c) => MUSIC_CATEGORIES.test(c)) || CLASSICAL_KEYWORDS.test(`${e.title} ${text}`);
    if (!relevant) continue;
    const venue = Array.isArray(e.venue) ? undefined : e.venue;
    const organisers = Array.isArray(e.organizer) ? e.organizer.map((o) => o.organizer).filter(Boolean) : [];
    const lines = [
      "EVENT from the Artscape Theatre Centre (Cape Town) events calendar API",
      `Title: ${e.title}`,
      `Event page: ${e.url}`,
      `Start (local time): ${e.start_date}${e.all_day ? " (all-day)" : ""}`,
      `End (local time): ${e.end_date}`,
      "Note: some Artscape entries use 08:00 as a placeholder time; if the description gives another time, that one is right.",
      venue?.venue ? `Venue: ${[venue.venue, venue.address, venue.city].filter(Boolean).join(", ")}` : "",
      organisers.length ? `Organiser: ${organisers.join(", ")}` : "",
      cats.length ? `Categories: ${cats.join(", ")}` : "",
      e.cost ? `Cost: ${e.cost}` : "",
      e.website ? `Tickets/website: ${e.website}` : "",
      "Description:",
      text.trim(),
    ].filter(Boolean);
    items.push({ key: String(e.url), url: canonicalUrl(e.url), text: lines.join("\n") + "\n" });
  }
  return items;
}

export default defineSource({
  slug: "artscape",
  name: "Artscape Theatre Centre",
  role: "venue",
  homepage: "https://www.artscape.co.za/",
  hint: "Artscape Theatre Centre, Cape Town (venue). Many events are dance, theatre or comedy: return [] for anything that isn't classical music or opera.",
  adapter: {
    type: "html",
    startUrls: ["https://www.artscape.co.za/wp-json/tribe/events/v1/events?per_page=50"],
    split: splitArtscape,
  },
});
