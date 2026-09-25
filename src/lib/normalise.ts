import { canonicalEvent, dropNulls } from "./canonical.ts";
import { RULES } from "./config.ts";
import { copiedSpan } from "./guard.ts";
import { dedupeKey, eventId } from "./keys.ts";
import type { ComposerIndex, VenueIndex } from "./reference.ts";
import { Event } from "./schema.ts";
import { addMonths, normaliseTimestamp } from "./time.ts";
import { canonicalUrl } from "./url.ts";

export interface NormaliseContext {
  venues: VenueIndex;
  composers: ComposerIndex;
  now: Date;
}

export interface DocumentInfo {
  url: string;
  source: string;
  fetchedAt: string;
  contentHash: string;
  /** Source text for the copyright re-check. Null if the raw cache is gone (the extract-time guard then stands). */
  text: string | Set<string> | null;
}

export type NormaliseResult =
  | { ok: true; event: Event }
  | { ok: false; skipped: "past"; reason: string }
  | { ok: false; skipped?: undefined; reasons: string[]; partial: Record<string, unknown> };

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    return /^https?:$/.test(new URL(v).protocol);
  } catch {
    return false;
  }
}

function sameSite(a: string, b: string): boolean {
  const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");
  try {
    return host(a) === host(b);
  } catch {
    return false;
  }
}

/**
 * Turn one extractor record into a published-shape Event, or explain why not.
 * Pure: everything it needs comes in through the arguments.
 */
export function normaliseEvent(raw: Raw, doc: DocumentInfo, ctx: NormaliseContext, guardFailure?: string): NormaliseResult {
  const reasons: string[] = [];
  const review = new Set<string>(Array.isArray(raw.needs_review) ? raw.needs_review.filter((x: unknown) => typeof x === "string") : []);
  const e: Raw = structuredClone(raw);

  // Timestamps → explicit +02:00.
  for (const k of ["start", "end", "doors"] as const) {
    if (e[k] == null) continue;
    const t = normaliseTimestamp(e[k]);
    if (!t) {
      if (k === "start") reasons.push(`start is not a valid timestamp: ${JSON.stringify(e[k])}`);
      else review.add(k);
    }
    e[k] = t;
  }

  // Venue: resolve aliases against venues.json.
  if (e.venue && typeof e.venue === "object") {
    const claimedId = e.venue.venue_id;
    const match = ctx.venues.resolve(e.venue);
    if (match) {
      e.venue = {
        venue_id: match.venue_id,
        name: match.name,
        address: match.address ?? e.venue.address ?? null,
        city: match.city,
        province: match.province,
        lat: match.lat ?? e.venue.lat ?? null,
        lng: match.lng ?? e.venue.lng ?? null,
      };
    } else {
      if (claimedId) review.add("venue.venue_id");
      e.venue.venue_id = null;
    }
  }

  // SA content: match only, never infer. The extractor's own list is discarded.
  const programme: Raw[] = Array.isArray(e.programme) ? e.programme : [];
  const saComposers = new Set<string>();
  programme.forEach((w, i) => {
    const m = typeof w?.composer === "string" ? ctx.composers.match(w.composer) : null;
    if (!m) return;
    saComposers.add(m.name);
    if (!m.certain) review.add(`programme.${i}.composer`);
  });
  e.sa_content = {
    sa_composers: [...saComposers].sort(),
    has_sa_work: saComposers.size > 0,
    languages: Array.isArray(e.sa_content?.languages) ? e.sa_content.languages : [],
  };

  // Tickets.
  if (e.tickets && typeof e.tickets === "object") {
    if (e.tickets.url != null && !isHttpUrl(e.tickets.url)) {
      e.tickets.url = null;
      review.add("tickets.url");
    } else if (e.tickets.url) e.tickets.url = canonicalUrl(e.tickets.url);
    const known = Object.entries(e.tickets).filter(([k, v]) => k !== "currency" && v !== null && v !== undefined);
    if (known.length) e.tickets.currency = "ZAR";
    else delete e.tickets;
    const { price_min: lo, price_max: hi } = e.tickets ?? {};
    if (typeof lo === "number" && typeof hi === "number" && lo > hi) reasons.push(`price_min ${lo} > price_max ${hi}`);
  }

  // Source: pipeline-owned. A per-event URL from the model is accepted only on the document's own site.
  const modelUrl = e.source?.url;
  e.source = {
    url: isHttpUrl(modelUrl) && sameSite(modelUrl, doc.url) ? canonicalUrl(modelUrl) : doc.url,
    publisher: doc.source,
    fetched_at: doc.fetchedAt,
    content_hash: doc.contentHash,
    secondary_urls: [],
  };

  e.status ??= "scheduled";

  // Description: copyright guard and length.
  if (guardFailure) reasons.push(`copyright guard: ${guardFailure}`);
  if (typeof e.description === "string") {
    // Re-check against the source text when we have it. Without it (raw cache evicted and
    // the source not fetched this run) the extract-time guard, which every committed
    // extraction has already passed, stands, so a cache miss never strips descriptions.
    const span = doc.text === null ? null : copiedSpan(e.description, doc.text);
    if (span) reasons.push(`copyright guard: description shares a ${RULES.copyrightSpanWords}-word span with the source ("${span}")`);
    else if (e.description.length > RULES.descriptionMax) {
      e.description = null;
      review.add("description");
    }
  }

  // Computed identity.
  if (e.start && e.title && e.venue?.name) {
    e.dedupe_key = dedupeKey(e as { start: string; title: string; venue: { name: string } });
    e.id = eventId(e.dedupe_key);
  }

  e.needs_review = [...review].sort();
  const cleaned = dropNulls(e);
  const parsed = Event.safeParse(cleaned);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) reasons.push(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  if (reasons.length || !parsed.success) return { ok: false, reasons, partial: cleaned };
  const event = parsed.data;

  // Assertions from extraction-prompt.md.
  const start = new Date(event.start);
  if (start.getTime() <= ctx.now.getTime()) return { ok: false, skipped: "past", reason: `start ${event.start} is not in the future` };
  if (start > addMonths(new Date(doc.fetchedAt), RULES.horizonMonths)) reasons.push(`start ${event.start} is more than ${RULES.horizonMonths} months after the fetch date`);
  if (event.end && new Date(event.end) < start) reasons.push(`end ${event.end} is before start`);
  if (reasons.length) return { ok: false, reasons, partial: cleaned };

  return { ok: true, event: canonicalEvent(event) };
}
