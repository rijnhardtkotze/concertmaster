import { z } from "zod";

/**
 * The v2 extraction shape: what the model returns for one Performance, with the
 * fields of its Production alongside. Zod mirror of event-schema.json, which is
 * the contract; tests/schema-sync.test.ts fails if the two drift apart.
 *
 * The same schema is sent to the model as its structured-output format, so every
 * field is present and nullable rather than optional (structured outputs are most
 * reliable that way). Numeric and length limits the API doesn't support are moved
 * into the field descriptions by the SDK; normalise enforces them per record, so
 * one bad record never costs the whole document.
 *
 * Nothing here is computed by the pipeline: no identity key, no slug, no
 * South African flag on a Composer (normalise matches the curated list), and no
 * Venue slug (normalise resolves the Venue name).
 */

export const PROVINCES = [
  "Gauteng",
  "Western Cape",
  "KwaZulu-Natal",
  "Eastern Cape",
  "Free State",
  "Limpopo",
  "Mpumalanga",
  "North West",
  "Northern Cape",
] as const;

/** The seven Genres (CONTEXT.md). One per Production; the list grows only by a migration. */
export const GENRES = ["chamber", "orchestral", "recital", "choral", "vocal", "contemporary", "early_music"] as const;

/** Performance status (CONTEXT.md). A missing status means scheduled. */
export const PERFORMANCE_STATUSES = ["scheduled", "few_left", "sold_out", "postponed", "cancelled"] as const;

/** Premiere on a Programme item. South Africa is `za`, its ISO 3166-1 code. */
export const PREMIERES = ["world", "african", "za", "regional"] as const;

export const CREDIT_KINDS = ["person", "ensemble"] as const;

export const CREDIT_ROLES = [
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

/** The one locale the model may set on a Credit, and only when the source says so. */
export const CREDIT_LOCALES = ["en-ZA"] as const;

const n = <T extends z.ZodType>(t: T) => t.nullable();
const date = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const Credit = z
  .strictObject({
    name: z.string().min(1),
    kind: z.enum(CREDIT_KINDS),
    role: z.enum(CREDIT_ROLES),
    instrument: n(z.string()).describe("For soloists and accompanists, including voice types such as soprano or baritone."),
    locale: n(z.enum(CREDIT_LOCALES)).describe("en-ZA only when the source says this Person is South African. Otherwise null. Always null for an Ensemble."),
  })
  .describe("A Person or Ensemble credited on the Production, with the role they play.");

export const WorkItem = z
  .strictObject({
    kind: z.literal("work"),
    composer: n(z.string()).describe("Canonical full name where unambiguous. A bare ambiguous surname stays as written."),
    title: z.string().min(1),
    catalogue: n(z.string()).describe("Op. 67, BWV 1043, K. 466, D. 759. Only when the source gives it."),
    movements: n(z.string()).describe("Only when excerpts are performed."),
    arranger: n(z.string()),
    premiere: n(z.enum(PREMIERES)).describe("Only when the source states a premiere."),
  })
  .describe("A Work on the Programme.");

export const IntervalItem = z
  .strictObject({
    kind: z.literal("interval"),
    minutes: n(z.number().int().min(1).max(240)),
  })
  .describe("An interval, in its place on the Programme.");

export const ProgrammeItem = z.union([WorkItem, IntervalItem]);

export const PriceTier = z
  .strictObject({
    name: z.string().min(1).describe('As the source names the tier, such as "Adults" or "Pensioners and students".'),
    amount: z.number().min(0).describe("In rand. Free entry is 0."),
  })
  .describe("One named ticket price.");

export const ExtractedProduction = z.strictObject({
  title: z.string().min(1).describe("The Production's own name, not its Series."),
  genre: n(z.enum(GENRES)).describe("Null when no one Genre fits."),
  series: n(z.string()),
  season: n(z.string()),
  presenter: n(z.string()).describe("The organisation putting the Production on, by its full name."),
  languages: z.array(z.string()).describe("Languages the Production is sung or performed in, as the source states. Empty for instrumental programmes."),
  description: n(z.string().max(400)).describe("A summary in your own words, 400 characters or fewer. Never the source's copy."),
  credits: z.array(Credit),
  programme: z.array(ProgrammeItem).describe("In the order the source gives. Empty when the source names no Works."),
});

export const ExtractedVenue = z.strictObject({
  name: n(z.string()),
  address: n(z.string()),
  city: n(z.string()),
  province: n(z.enum(PROVINCES)),
});

export const ExtractedPerformanceFields = z.strictObject({
  start_date: n(date).describe("YYYY-MM-DD, South African Standard Time."),
  start_time: n(time).describe("HH:MM, 24-hour, South African Standard Time. Null when the source gives no time."),
  doors_time: n(time),
  venue: ExtractedVenue,
  status: z.enum(PERFORMANCE_STATUSES),
  price_tiers: z.array(PriceTier).describe("Empty when the source gives no price."),
  ticket_url: n(z.url()),
});

export const ExtractedPerformance = z.strictObject({
  production: ExtractedProduction,
  performance: ExtractedPerformanceFields,
  confidence: z.number().min(0).max(1).describe("Honest probability that every non-null field is correct as published."),
  needs_review: z.array(z.string()).describe("Dotted paths of uncertain fields, such as performance.start_time or production.programme.1.composer."),
  extraction_notes: n(z.string()).describe("One line for the reviewer. Never shown on the site."),
});

export const ExtractionResult = z.strictObject({ performances: z.array(ExtractedPerformance) });

export type ExtractedPerformance = z.infer<typeof ExtractedPerformance>;
export type ExtractedProduction = z.infer<typeof ExtractedProduction>;
export type ProgrammeItem = z.infer<typeof ProgrammeItem>;
