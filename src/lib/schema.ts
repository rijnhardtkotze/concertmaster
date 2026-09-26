import { z } from "zod";
import { PROVINCES } from "./extraction-schema.ts";

/**
 * v1's stored listing record, which normalise, dedupe and merge still use until
 * their v2 tickets rewrite them. event-schema.json no longer describes it: that
 * file is now the v2 extraction shape, mirrored by extraction-schema.ts.
 */

export { PROVINCES };

export const PERFORMER_ROLES = [
  "conductor",
  "soloist",
  "orchestra",
  "ensemble",
  "choir",
  "chorus_master",
  "director",
  "narrator",
  "accompanist",
  "other",
] as const;

export const PREMIERES = ["world", "african", "south_african", "regional"] as const;

export const GENRE_TAGS = [
  "orchestral",
  "chamber",
  "choral",
  "opera",
  "solo_recital",
  "song_recital",
  "early_music",
  "contemporary",
  "organ",
  "wind_band",
  "sacred",
  "youth",
  "masterclass",
  "competition",
  "crossover",
  "film_music",
] as const;

export const VENDORS = ["quicket", "webtickets", "computicket", "howler", "direct", "at_door", "other"] as const;

export const STATUSES = ["scheduled", "postponed", "cancelled", "sold_out", "unconfirmed"] as const;

const dateTime = z.iso.datetime({ offset: true });
const uri = z.url();
const nstr = z.string().nullable();

export const Venue = z.strictObject({
  venue_id: nstr.optional(),
  name: z.string(),
  address: nstr.optional(),
  city: z.string(),
  province: z.enum(PROVINCES),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
});

export const Performer = z.strictObject({
  name: z.string(),
  role: z.enum(PERFORMER_ROLES),
  instrument: nstr.optional(),
  is_south_african: z.boolean().nullable().optional(),
});

export const Work = z.strictObject({
  composer: z.string(),
  work: z.string(),
  catalogue: nstr.optional(),
  movements: nstr.optional(),
  is_premiere: z.enum(PREMIERES).nullable().optional(),
  arranger: nstr.optional(),
});

export const SaContent = z.strictObject({
  sa_composers: z.array(z.string()).optional(),
  has_sa_work: z.boolean().optional(),
  languages: z.array(z.string()).optional(),
});

export const Tickets = z.strictObject({
  url: uri.nullable().optional(),
  vendor: z.enum(VENDORS).nullable().optional(),
  currency: z.literal("ZAR").optional(),
  price_min: z.number().min(0).nullable().optional(),
  price_max: z.number().min(0).nullable().optional(),
  is_free: z.boolean().nullable().optional(),
  concessions_note: nstr.optional(),
  booking_required: z.boolean().nullable().optional(),
});

export const Source = z.strictObject({
  url: uri,
  publisher: z.string(),
  fetched_at: dateTime,
  content_hash: z.string().optional(),
  secondary_urls: z.array(uri).optional(),
});

export const Event = z.strictObject({
  id: z.string(),
  dedupe_key: z.string(),
  title: z.string().min(3),
  subtitle: nstr.optional(),
  description: nstr.optional(),
  start: dateTime,
  end: dateTime.nullable().optional(),
  doors: dateTime.nullable().optional(),
  duration_minutes: z.number().int().min(10).max(600).nullable().optional(),
  venue: Venue,
  presenter: nstr.optional(),
  series: nstr.optional(),
  performers: z.array(Performer).optional(),
  programme: z.array(Work).optional(),
  sa_content: SaContent.optional(),
  genre_tags: z.array(z.enum(GENRE_TAGS)).optional(),
  tickets: Tickets.optional(),
  source: Source,
  status: z.enum(STATUSES),
  confidence: z.number().min(0).max(1),
  needs_review: z.array(z.string()).optional(),
  extraction_notes: nstr.optional(),
  first_seen: dateTime.optional(),
  last_updated: dateTime.optional(),
});

export type Event = z.infer<typeof Event>;

/** Top-level key order for committed output. */
export const EVENT_KEY_ORDER = Object.keys(Event.shape) as (keyof Event)[];
