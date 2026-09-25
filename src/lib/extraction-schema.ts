import { z } from "zod";
import { GENRE_TAGS, PERFORMER_ROLES, PREMIERES, PROVINCES, STATUSES, VENDORS } from "./schema.ts";

/**
 * The shape we ask the model for, sent as a structured-output JSON schema.
 *
 * Deliberately looser than the event schema: every field is present-but-
 * nullable (structured outputs are most reliable that way), there are no
 * numeric or length constraints (the API strips those anyway), and the fields
 * the pipeline computes (id, dedupe_key, first_seen, last_updated,
 * source.content_hash) are absent. Strict validation happens in normalise,
 * per event, so one bad record never costs the whole document.
 */
const n = <T extends z.ZodType>(t: T) => t.nullable();

export const ExtractedEvent = z.object({
  title: z.string(),
  subtitle: n(z.string()),
  description: n(z.string()),
  start: z.string(),
  end: n(z.string()),
  doors: n(z.string()),
  duration_minutes: n(z.number()),
  venue: z.object({
    venue_id: n(z.string()),
    name: z.string(),
    address: n(z.string()),
    city: z.string(),
    province: z.enum(PROVINCES),
    lat: n(z.number()),
    lng: n(z.number()),
  }),
  presenter: n(z.string()),
  series: n(z.string()),
  performers: z.array(
    z.object({
      name: z.string(),
      role: z.enum(PERFORMER_ROLES),
      instrument: n(z.string()),
      is_south_african: n(z.boolean()),
    }),
  ),
  programme: z.array(
    z.object({
      composer: z.string(),
      work: z.string(),
      catalogue: n(z.string()),
      movements: n(z.string()),
      is_premiere: n(z.enum(PREMIERES)),
      arranger: n(z.string()),
    }),
  ),
  sa_content: z.object({
    sa_composers: z.array(z.string()),
    has_sa_work: z.boolean(),
    languages: z.array(z.string()),
  }),
  genre_tags: z.array(z.enum(GENRE_TAGS)),
  tickets: z.object({
    url: n(z.string()),
    vendor: n(z.enum(VENDORS)),
    price_min: n(z.number()),
    price_max: n(z.number()),
    is_free: n(z.boolean()),
    concessions_note: n(z.string()),
    booking_required: n(z.boolean()),
  }),
  source: z.object({
    url: n(z.string()),
  }),
  status: z.enum(STATUSES),
  confidence: z.number(),
  needs_review: z.array(z.string()),
  extraction_notes: n(z.string()),
});

export const ExtractionResult = z.object({ events: z.array(ExtractedEvent) });

export type ExtractedEvent = z.infer<typeof ExtractedEvent>;
