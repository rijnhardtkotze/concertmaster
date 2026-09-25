import { canonicalEvent, contentFingerprint, sortEvents } from "./canonical.ts";
import { RULES } from "./config.ts";
import { sameVenue } from "./dedupe.ts";
import type { VenueIndex } from "./reference.ts";
import type { Event } from "./schema.ts";
import { localDate, toSast } from "./time.ts";
import { titleSimilarity } from "./text.ts";
import { sha256 } from "./hash.ts";

export interface ReviewDecision {
  decision: "approve" | "reject";
  decided_at: string;
  /** Decision holds only while the event's content is unchanged. */
  fingerprint: string;
  title: string;
}
export type ReviewDecisions = Record<string, ReviewDecision>;

export interface MergeCounts {
  added: number;
  updated: number;
  queued: number;
  unconfirmed: number;
  approved: number;
  rejected: number;
  newlyQueued: string[];
  bySource: Record<string, { added: number; updated: number; queued: number; unconfirmed: number }>;
}

export const fingerprint = (e: Event) => sha256(contentFingerprint(e)).slice(0, 16);

export function needsReview(e: Event): boolean {
  return e.confidence < RULES.publishConfidence || (e.needs_review?.length ?? 0) > 0;
}

/**
 * Fold today's deduplicated events into the committed state.
 *  - ids are stable: an incoming event that fuzzy-matches an existing one takes its id
 *  - first_seen is preserved; last_updated moves only when content changed
 *  - low confidence or needs_review → review queue, unless a reviewer approved this exact content
 *  - published future events that disappear from their source become "unconfirmed", never deleted
 */
export function merge(opts: {
  incoming: Event[];
  published: Event[];
  queue: Event[];
  decisions: ReviewDecisions;
  venues: VenueIndex;
  now: Date;
}) {
  const nowIso = toSast(opts.now);
  const queuedBefore = new Map(opts.queue.map((e) => [e.id, contentFingerprint(e)]));
  const prior = new Map<string, { event: Event; published: boolean }>();
  for (const e of opts.queue) prior.set(e.id, { event: e, published: false });
  for (const e of opts.published) prior.set(e.id, { event: e, published: true });

  // Match every incoming event to its prior record up front, so the result doesn't depend on
  // input order. Exact ids first. Then fuzzy candidates (same date and venue, within an hour,
  // similar title) are assigned globally, best title match first, with the nearer start time
  // breaking ties: when two performances of a show share a title and one disappears (or its
  // key loses a time suffix), the one left keeps its own id; when a title is edited, it still
  // finds its own record even if its time moved toward a sibling's.
  type Prior = { event: Event; published: boolean };
  const assigned = new Map<Event, Prior>();
  const taken = new Set<string>();
  for (const e of opts.incoming) {
    const exact = prior.get(e.id);
    if (exact && !taken.has(e.id)) {
      assigned.set(e, exact);
      taken.add(e.id);
    }
  }
  const pairs: { e: Event; p: Prior; score: number; gap: number }[] = [];
  for (const e of opts.incoming) {
    if (assigned.has(e)) continue;
    for (const p of prior.values()) {
      if (taken.has(p.event.id) || localDate(p.event.start) !== localDate(e.start)) continue;
      const gap = Math.abs(Date.parse(p.event.start) - Date.parse(e.start));
      if (gap > 60 * 60_000 || !sameVenue(p.event, e, opts.venues)) continue;
      const score = Math.round(titleSimilarity(p.event.title, e.title) * 100) / 100;
      if (score >= RULES.fuzzyTitleThreshold) pairs.push({ e, p, score, gap });
    }
  }
  pairs.sort((x, y) => y.score - x.score || x.gap - y.gap);
  for (const { e, p } of pairs) {
    if (assigned.has(e) || taken.has(p.event.id)) continue;
    assigned.set(e, p);
    taken.add(p.event.id);
  }
  const matched = new Set<string>();

  const published: Event[] = [];
  const queue: Event[] = [];
  const counts: MergeCounts = { added: 0, updated: 0, queued: 0, unconfirmed: 0, approved: 0, rejected: 0, newlyQueued: [], bySource: {} };
  const count = (e: Event, k: "added" | "updated" | "queued" | "unconfirmed") => {
    counts[k]++;
    const s = (counts.bySource[e.source.publisher] ??= { added: 0, updated: 0, queued: 0, unconfirmed: 0 });
    s[k]++;
  };
  const incomingIds = new Set<string>();

  for (const raw of opts.incoming) {
    const p = assigned.get(raw);
    let e: Event = p ? { ...raw, id: p.event.id } : raw;
    if (incomingIds.has(e.id)) continue; // defensive: two incoming records claiming one prior
    incomingIds.add(e.id);
    if (p) matched.add(p.event.id);

    const changed = !p || contentFingerprint(p.event) !== contentFingerprint(e);
    e = canonicalEvent({
      ...e,
      first_seen: p?.event.first_seen ?? nowIso,
      last_updated: changed ? nowIso : (p!.event.last_updated ?? nowIso),
    });

    const d = opts.decisions[e.id];
    const decision = d && d.fingerprint === fingerprint(e) ? d.decision : undefined;
    if (decision === "reject") {
      counts.rejected++;
      continue;
    }
    if (needsReview(e) && decision !== "approve") {
      queue.push(e);
      // A published event whose new version needs review keeps its last published
      // version on the site until someone looks, rather than silently vanishing.
      if (p?.published) published.push(p.event);
      count(e, "queued");
      // New to the queue, or its content changed since it was queued. A published event's
      // pending version is in both lists; being published doesn't make it new work each run.
      if (queuedBefore.get(e.id) !== contentFingerprint(e)) counts.newlyQueued.push(e.id);
      continue;
    }
    if (decision === "approve") counts.approved++;
    published.push(e);
    if (!p || !p.published) count(e, "added");
    else if (changed) count(e, "updated");
  }

  for (const p of prior.values()) {
    if (matched.has(p.event.id) || !p.published) continue; // vanished queue items are simply dropped
    const e = p.event;
    if (Date.parse(e.start) > opts.now.getTime() && e.status !== "unconfirmed" && e.status !== "cancelled") {
      published.push(canonicalEvent({ ...e, status: "unconfirmed", last_updated: nowIso }));
      count(e, "unconfirmed");
    } else {
      published.push(e);
    }
  }

  return { published: sortEvents(published), queue: sortEvents(queue), counts };
}
