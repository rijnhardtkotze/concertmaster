import type { ExtractedPerformance } from "../src/lib/extraction-schema.ts";
import { ComposerIndex, VenueIndex, type VenueRecord } from "../src/lib/reference.ts";
import type { Event } from "../src/lib/schema.ts";
import { normaliseEvent, type DocumentInfo } from "../src/lib/normalise.ts";

export const venues: VenueRecord[] = [
  { venue_id: "linder-auditorium", name: "Linder Auditorium", aliases: ["The Linder Auditorium", "Linder"], address: "Wits Education Campus", city: "Johannesburg", province: "Gauteng", lat: null, lng: null },
  { venue_id: "cape-town-city-hall", name: "Cape Town City Hall", aliases: ["City Hall, Cape Town"], address: "Darling Street", city: "Cape Town", province: "Western Cape", lat: null, lng: null },
  { venue_id: "durban-city-hall", name: "Durban City Hall", aliases: ["City Hall, Durban"], address: null, city: "Durban", province: "KwaZulu-Natal", lat: null, lng: null },
];
export const composers = ["Péter Louis van Dijk", "Hendrik Hofmeyr", "Kevin Volans", "Michael Blake"];

export const ctx = () => ({
  venues: new VenueIndex(venues),
  composers: new ComposerIndex(composers),
  now: new Date("2026-09-01T03:00:00+02:00"),
});

/** A v2 record as the extractor returns it: one Performance, with its Production's fields. */
export function extractedPerformance(over: { production?: Record<string, unknown>; performance?: Record<string, unknown> } & Record<string, unknown> = {}): ExtractedPerformance {
  const { production, performance, ...rest } = over;
  return {
    production: {
      title: "Spring Symphony",
      genre: "orchestral",
      series: null,
      season: null,
      presenter: "Johannesburg Philharmonic Orchestra",
      languages: [],
      description: "The orchestra plays a symphony.",
      credits: [{ name: "Daniel Boico", kind: "person", role: "conductor", instrument: null, locale: null }],
      programme: [{ kind: "work", composer: "Ludwig van Beethoven", title: "Symphony No. 5", catalogue: "Op. 67", movements: null, arranger: null, premiere: null }],
      ...production,
    },
    performance: {
      start_date: "2026-10-15",
      start_time: "19:30",
      doors_time: null,
      venue: { name: "Linder Auditorium", address: null, city: "Johannesburg", province: "Gauteng" },
      status: "scheduled",
      price_tiers: [{ name: "General", amount: 350 }],
      ticket_url: "https://www.quicket.co.za/events/1-x/",
      ...performance,
    },
    confidence: 0.9,
    needs_review: [],
    extraction_notes: null,
    ...rest,
  } as ExtractedPerformance;
}

/** A v1 record as the extractor returned it (structured output: every key present, nullable). */
export function rawEvent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Spring Symphony Concert",
    subtitle: null,
    description: "The orchestra plays a symphony.",
    start: "2026-10-15T19:30:00+02:00",
    end: null,
    doors: null,
    duration_minutes: null,
    venue: { venue_id: null, name: "The Linder Auditorium", address: null, city: "Johannesburg", province: "Gauteng", lat: null, lng: null },
    presenter: "Johannesburg Philharmonic Orchestra",
    series: null,
    performers: [{ name: "Daniel Boico", role: "conductor", instrument: null, is_south_african: null }],
    programme: [{ composer: "Ludwig van Beethoven", work: "Symphony No. 5", catalogue: "Op. 67", movements: null, is_premiere: null, arranger: null }],
    sa_content: { sa_composers: [], has_sa_work: false, languages: [] },
    genre_tags: ["orchestral"],
    tickets: { url: "https://www.quicket.co.za/events/1-x/", vendor: "quicket", price_min: 150, price_max: 350, is_free: null, concessions_note: null, booking_required: null },
    source: { url: null },
    status: "scheduled",
    confidence: 0.9,
    needs_review: [],
    extraction_notes: null,
    ...over,
  };
}

export const doc = (over: Partial<DocumentInfo> = {}): DocumentInfo => ({
  url: "https://jpo.co.za/spring/",
  source: "jpo",
  fetchedAt: "2026-08-31T03:00:00+02:00",
  contentHash: "abc",
  text: "Spring Symphony Concert. Beethoven Symphony No. 5. Linder Auditorium.",
  ...over,
});

/** Normalise and assert success; for building fixtures in dedupe/merge tests. */
export function event(over: Record<string, unknown> = {}, d: Partial<DocumentInfo> = {}): Event {
  const r = normaliseEvent(rawEvent(over), doc(d), ctx());
  if (!r.ok) throw new Error(`fixture did not normalise: ${JSON.stringify(r)}`);
  return r.event;
}
