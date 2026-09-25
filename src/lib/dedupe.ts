import { canonicalEvent } from "./canonical.ts";
import { RULES } from "./config.ts";
import { dedupeKey, eventId } from "./keys.ts";
import type { VenueIndex } from "./reference.ts";
import type { Event } from "./schema.ts";
import type { SourceRole } from "./sources.ts";
import { localDate } from "./time.ts";
import { normalise, titleSimilarity } from "./text.ts";

export interface FuzzyMerge {
  date: string;
  kept: { id: string; source: string; title: string };
  merged: { id: string; source: string; title: string };
  score: number;
}

const ROLE_RANK: Record<SourceRole, number> = { presenter: 0, venue: 1, aggregator: 2, vendor: 3 };
const STATUS_RANK: Record<Event["status"], number> = { cancelled: 4, postponed: 3, sold_out: 2, scheduled: 1, unconfirmed: 0 };
/** Two listings of one performance may differ by doors-vs-start; a matinee and an evening show differ by hours. */
const SAME_PERFORMANCE_MS = 60 * 60_000;

export function sameVenue(a: Event, b: Event, venues: VenueIndex): boolean {
  if (a.venue.venue_id && b.venue.venue_id) return a.venue.venue_id === b.venue.venue_id;
  if (a.venue.venue_id || b.venue.venue_id) {
    // One side resolved and the other didn't: only equal if the unresolved name is one of the aliases.
    const set = venues.aliasSet(a.venue.venue_id ? a.venue : b.venue);
    return set.has(normalise((a.venue.venue_id ? b : a).venue.name));
  }
  return titleSimilarity(a.venue.name, b.venue.name) >= 0.8 && normalise(a.venue.city) === normalise(b.venue.city);
}

const closeInTime = (a: Event, b: Event) => Math.abs(Date.parse(a.start) - Date.parse(b.start)) <= SAME_PERFORMANCE_MS;

/**
 * The schema's dedupe_key has no time component, so a matinee and an evening
 * performance of the same show share a key (and would share an id). Where a key
 * covers performances at different times, append HH:MM to keep them apart.
 */
export function disambiguateKeys(events: Event[]): Event[] {
  const byKey = new Map<string, Event[]>();
  for (const e of events) byKey.set(e.dedupe_key, [...(byKey.get(e.dedupe_key) ?? []), e]);
  const out: Event[] = [];
  for (const group of byKey.values()) {
    const times = new Set(group.map((e) => e.start.slice(11, 16)));
    const spread = Math.max(...group.map((e) => Date.parse(e.start))) - Math.min(...group.map((e) => Date.parse(e.start)));
    if (times.size > 1 && spread > SAME_PERFORMANCE_MS) {
      for (const e of group) {
        const key = `${dedupeKey(e)}|${e.start.slice(11, 16)}`;
        out.push({ ...e, dedupe_key: key, id: eventId(key) });
      }
    } else out.push(...group);
  }
  return out;
}

/** How much a record says: used to prefer a presenter's detail page over its own listing page. */
const richness = (e: Event) => JSON.stringify(e).length;

function pickCanonical(cluster: Event[], roles: Record<string, SourceRole>): Event {
  return [...cluster].sort(
    (a, b) =>
      ROLE_RANK[roles[a.source.publisher] ?? "aggregator"] - ROLE_RANK[roles[b.source.publisher] ?? "aggregator"] ||
      b.confidence - a.confidence ||
      richness(b) - richness(a) ||
      a.source.publisher.localeCompare(b.source.publisher) ||
      a.source.url.localeCompare(b.source.url),
  )[0]!;
}

const FILLABLE = ["subtitle", "description", "end", "doors", "duration_minutes", "presenter", "series"] as const;

export function mergeCluster(cluster: Event[], roles: Record<string, SourceRole>): Event {
  const canonical = pickCanonical(cluster, roles);
  const merged: Event = structuredClone(canonical);
  const review = new Set(merged.needs_review ?? []);
  const secondary = new Set(merged.source.secondary_urls ?? []);

  for (const other of cluster) {
    if (other === canonical) continue;
    if (other.source.url !== merged.source.url) secondary.add(other.source.url);
    for (const u of other.source.secondary_urls ?? []) if (u !== merged.source.url) secondary.add(u);
    const otherReview = new Set(other.needs_review ?? []);
    // Anything taken from a record that itself needs review needs review in the merged
    // record too; otherwise a shaky vendor listing could publish through a confident presenter.
    const otherUncertain = other.confidence < RULES.publishConfidence;
    const fill = (field: string) => {
      if (otherUncertain) review.add(field);
      for (const p of otherReview) if (p === field || p.startsWith(`${field}.`)) review.add(p);
    };

    for (const f of FILLABLE) {
      if (merged[f] == null && other[f] != null) {
        (merged as Record<string, unknown>)[f] = other[f];
        fill(f);
      }
    }
    if (!merged.performers?.length && other.performers?.length) {
      merged.performers = other.performers;
      fill("performers");
    }
    if (!merged.programme?.length && other.programme?.length) {
      merged.programme = other.programme;
      merged.sa_content = other.sa_content;
      fill("programme");
    }
    if (!merged.genre_tags?.length && other.genre_tags?.length) {
      merged.genre_tags = other.genre_tags;
      fill("genre_tags");
    }
    if (!merged.venue.venue_id && other.venue.venue_id) {
      merged.venue = other.venue;
      fill("venue");
    }

    // Ticket vendor's URL beats the presenter's link to it; fill prices the presenter didn't give.
    const ot = other.tickets;
    if (ot) {
      const mt = (merged.tickets ??= { currency: "ZAR" });
      if (ot.url && ot.url !== mt.url && (roles[other.source.publisher] === "vendor" || !mt.url)) {
        mt.url = ot.url;
        if (roles[other.source.publisher] === "vendor") mt.vendor = ot.vendor ?? mt.vendor;
        else mt.vendor ??= ot.vendor;
        fill("tickets.url");
      }
      for (const k of ["price_min", "price_max", "is_free", "concessions_note", "booking_required"] as const) {
        if (mt[k] == null && ot[k] != null) {
          (mt as Record<string, unknown>)[k] = ot[k];
          fill(`tickets.${k}`);
        }
      }
    }
    // The most severe status wins (a vendor usually knows about "sold out" first), flagged if it overrides.
    if (STATUS_RANK[other.status] > STATUS_RANK[merged.status]) {
      merged.status = other.status;
      review.add("status");
    }
  }

  merged.needs_review = [...review].sort();
  merged.source = { ...merged.source, secondary_urls: [...secondary].sort() };
  return canonicalEvent(merged);
}

/**
 * Union-find that also tracks each cluster's earliest and latest start, so a merge that
 * would stretch a cluster beyond one performance window is refused. Pairwise "within an
 * hour" isn't transitive: 18:00~19:00 and 19:00~20:00 must not make 18:00 and 20:00 one event.
 */
class PerformanceClusters {
  private parent: number[];
  private lo: number[];
  private hi: number[];
  constructor(starts: number[]) {
    this.parent = starts.map((_, i) => i);
    this.lo = [...starts];
    this.hi = [...starts];
  }
  find(i: number): number {
    while (this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]!]!;
    return i;
  }
  /** Joins the two clusters if the result still spans at most one performance window. */
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return true;
    const lo = Math.min(this.lo[ra]!, this.lo[rb]!);
    const hi = Math.max(this.hi[ra]!, this.hi[rb]!);
    if (hi - lo > SAME_PERFORMANCE_MS) return false;
    this.parent[ra] = rb;
    this.lo[rb] = lo;
    this.hi[rb] = hi;
    return true;
  }
}

/**
 * Cross-source dedupe: exact dedupe_key first, then fuzzy fallback on same
 * date + same venue (alias-aware) + similar title + start within an hour.
 * Records from the same source document are never fuzzy-merged with each
 * other: a page listing two similar concerts means two concerts.
 */
export function dedupe(input: Event[], venues: VenueIndex, roles: Record<string, SourceRole>, threshold = RULES.fuzzyTitleThreshold) {
  const events = disambiguateKeys(input);
  const uf = new PerformanceClusters(events.map((e) => Date.parse(e.start)));
  const fuzzy: FuzzyMerge[] = [];

  const byKey = new Map<string, number[]>();
  events.forEach((e, i) => byKey.set(e.dedupe_key, [...(byKey.get(e.dedupe_key) ?? []), i]));
  for (const idx of byKey.values()) for (const i of idx.slice(1)) uf.union(idx[0]!, i);

  const byDate = new Map<string, number[]>();
  events.forEach((e, i) => byDate.set(localDate(e.start), [...(byDate.get(localDate(e.start)) ?? []), i]));
  for (const idx of byDate.values()) {
    for (let x = 0; x < idx.length; x++) {
      for (let y = x + 1; y < idx.length; y++) {
        const i = idx[x]!;
        const j = idx[y]!;
        if (uf.find(i) === uf.find(j)) continue;
        const a = events[i]!;
        const b = events[j]!;
        if (a.source.url === b.source.url) continue;
        if (!closeInTime(a, b) || !sameVenue(a, b, venues)) continue;
        const score = titleSimilarity(a.title, b.title);
        if (score < threshold) continue;
        if (!uf.union(i, j)) continue;
        fuzzy.push({
          date: localDate(a.start),
          kept: { id: a.id, source: a.source.publisher, title: a.title },
          merged: { id: b.id, source: b.source.publisher, title: b.title },
          score: Math.round(score * 1000) / 1000,
        });
      }
    }
  }

  const clusters = new Map<number, Event[]>();
  events.forEach((e, i) => clusters.set(uf.find(i), [...(clusters.get(uf.find(i)) ?? []), e]));
  const out = [...clusters.values()].map((c) => (c.length === 1 ? c[0]! : mergeCluster(c, roles)));

  // Record fuzzy merges by the id that survived, so the log reads "this was folded into that".
  const survivor = new Map<string, string>();
  for (const c of clusters.values()) {
    if (c.length < 2) continue;
    const kept = pickCanonical(c, roles);
    for (const e of c) survivor.set(e.id, kept.id);
  }
  for (const f of fuzzy) {
    f.kept.id = survivor.get(f.kept.id) ?? f.kept.id;
  }
  fuzzy.sort((a, b) => a.date.localeCompare(b.date) || a.kept.id.localeCompare(b.kept.id) || a.merged.id.localeCompare(b.merged.id));
  return { events: out, fuzzy };
}
