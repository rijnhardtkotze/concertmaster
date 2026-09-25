import { EVENT_KEY_ORDER, type Event } from "./schema.ts";
import { sortDeep } from "./json.ts";

const NESTED_ORDER: Record<string, string[]> = {
  venue: ["venue_id", "name", "address", "city", "province", "lat", "lng"],
  tickets: ["url", "vendor", "currency", "price_min", "price_max", "is_free", "concessions_note", "booking_required"],
  source: ["url", "publisher", "fetched_at", "content_hash", "secondary_urls"],
  sa_content: ["sa_composers", "has_sa_work", "languages"],
  performers: ["name", "role", "instrument", "is_south_african"],
  programme: ["composer", "work", "catalogue", "movements", "is_premiere", "arranger"],
};

function ordered(obj: Record<string, unknown>, order: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of order) if (obj[k] !== undefined) out[k] = obj[k];
  for (const k of Object.keys(obj).sort()) if (!(k in out) && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** Drop null leaves so "unknown" is simply absent. Arrays are kept, empty or not. */
export function dropNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(dropNulls) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== null && v !== undefined) out[k] = dropNulls(v);
    return out as T;
  }
  return value;
}

/**
 * Event with keys in schema order at every level, so committed JSON diffs read
 * like the schema and never reorder between runs.
 */
export function canonicalEvent(e: Event): Event {
  const top = ordered(e as unknown as Record<string, unknown>, EVENT_KEY_ORDER as string[]);
  for (const [k, order] of Object.entries(NESTED_ORDER)) {
    const v = top[k];
    if (Array.isArray(v)) top[k] = v.map((x) => (x && typeof x === "object" ? ordered(x as Record<string, unknown>, order) : x));
    else if (v && typeof v === "object") top[k] = ordered(v as Record<string, unknown>, order);
  }
  return top as unknown as Event;
}

/** The fields that make an event "different" for last_updated purposes. Bookkeeping fields excluded. */
export function contentFingerprint(e: Event): string {
  const { first_seen: _f, last_updated: _l, source, ...rest } = e;
  const { fetched_at: _fa, content_hash: _ch, ...src } = source;
  return JSON.stringify(sortDeep({ ...rest, source: src }));
}

export function sortEvents(events: Event[]): Event[] {
  return [...events].sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}
