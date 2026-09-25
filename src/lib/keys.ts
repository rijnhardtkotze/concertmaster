import { sha256 } from "./hash.ts";
import { localDate } from "./time.ts";
import { normalise, slugify } from "./text.ts";

/**
 * {date_YYYY-MM-DD}|{venue_slug}|{normalised_title_first_6_words}
 * Lowercased, punctuation and diacritics stripped (event-schema.json).
 */
export function dedupeKey(e: { start: string; title: string; venue: { venue_id?: string | null; name: string } }): string {
  const venueSlug = e.venue.venue_id || slugify(e.venue.name);
  const title = normalise(e.title).split(" ").slice(0, 6).join(" ");
  return `${localDate(e.start)}|${venueSlug}|${title}`;
}

/** sha256(dedupe_key) truncated to 16 hex chars. Merge keeps an existing id even if the key later drifts. */
export function eventId(key: string): string {
  return sha256(key).slice(0, 16);
}
