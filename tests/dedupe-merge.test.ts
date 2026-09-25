import { describe, expect, it } from "vitest";
import { dedupe } from "../src/lib/dedupe.ts";
import { fingerprint, merge } from "../src/lib/merge.ts";
import { VenueIndex } from "../src/lib/reference.ts";
import type { SourceRole } from "../src/lib/sources.ts";
import { event, venues } from "./helpers.ts";

const roles: Record<string, SourceRole> = { jpo: "presenter", quicket: "vendor", artscape: "venue" };
const V = new VenueIndex(venues);
const NOW = new Date("2026-09-01T03:00:00+02:00");

const presenter = () =>
  event({ tickets: { url: "https://jpo.co.za/tickets", vendor: "direct", price_min: null, price_max: null, is_free: null, concessions_note: null, booking_required: null } });
const vendor = (over: Record<string, unknown> = {}) =>
  event(
    {
      title: "Spring Symphony Concert",
      description: null,
      programme: [],
      tickets: { url: "https://www.quicket.co.za/events/9-spring/", vendor: "quicket", price_min: 120, price_max: 300, is_free: null, concessions_note: null, booking_required: null },
      confidence: 0.8,
      ...over,
    },
    { url: "https://www.quicket.co.za/events/9-spring/", source: "quicket" },
  );

describe("dedupe", () => {
  it("merges an exact dedupe_key match: presenter canonical, vendor ticket URL kept, loser URL in secondary_urls", () => {
    const { events, fuzzy } = dedupe([vendor(), presenter()], V, roles);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.source.publisher).toBe("jpo");
    expect(e.source.secondary_urls).toEqual(["https://www.quicket.co.za/events/9-spring/"]);
    expect(e.tickets?.url).toBe("https://www.quicket.co.za/events/9-spring/");
    expect(e.tickets?.vendor).toBe("quicket");
    expect(e.tickets?.price_min).toBe(120);
    expect(e.programme).toHaveLength(1); // presenter's programme kept
    expect(fuzzy).toHaveLength(0);
  });

  it("falls back to fuzzy matching (same date, venue alias, similar title) and logs it", () => {
    const v = vendor({ title: "The JPO Spring Symphony Concert 2026", venue: { venue_id: null, name: "Linder", address: null, city: "Johannesburg", province: "Gauteng", lat: null, lng: null } });
    const { events, fuzzy } = dedupe([presenter(), v], V, roles);
    expect(events).toHaveLength(1);
    expect(fuzzy).toHaveLength(1);
    expect(fuzzy[0]!.score).toBeGreaterThanOrEqual(0.6);
  });

  it("keeps a matinee and an evening performance apart, with distinct ids", () => {
    const matinee = event({ start: "2026-10-15T14:00:00+02:00" });
    const evening = event({ start: "2026-10-15T19:30:00+02:00" }, { url: "https://jpo.co.za/spring-evening/" });
    const { events } = dedupe([matinee, evening], V, roles);
    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.id)).size).toBe(2);
  });

  it("never chains fuzzy merges beyond one performance window (18:00~19:00~20:00)", () => {
    const at = (t: string, url: string, title: string) => event({ start: `2026-10-15T${t}:00+02:00`, title }, { url });
    const { events } = dedupe(
      [at("18:00", "https://jpo.co.za/a/", "Spring Symphony Concert"), at("19:00", "https://jpo.co.za/b/", "Spring Symphony Concert!"), at("20:00", "https://jpo.co.za/c/", "Spring Symphony Concert!!")],
      V,
      roles,
    );
    const urls = (e: (typeof events)[number]) => [e.source.url, ...(e.source.secondary_urls ?? [])];
    expect(events.length).toBeGreaterThanOrEqual(2);
    for (const e of events) expect(urls(e).includes("https://jpo.co.za/a/") && urls(e).includes("https://jpo.co.za/c/")).toBe(false);
  });

  it("flags fields taken from a low-confidence duplicate for review", () => {
    const { events } = dedupe([vendor({ confidence: 0.5 }), presenter()], V, roles);
    expect(events).toHaveLength(1);
    expect(events[0]!.tickets?.url).toBe("https://www.quicket.co.za/events/9-spring/");
    expect(events[0]!.needs_review).toEqual(expect.arrayContaining(["tickets.url", "tickets.price_min", "tickets.price_max"]));
    // and a confident vendor adds nothing to the review list
    expect(dedupe([vendor(), presenter()], V, roles).events[0]!.needs_review).toEqual([]);
  });

  it("a parent review path on a duplicate covers the child fields taken from it", () => {
    const { events } = dedupe([vendor({ needs_review: ["tickets"] }), presenter()], V, roles);
    expect(events[0]!.needs_review).toEqual(expect.arrayContaining(["tickets.url", "tickets.price_min"]));
  });

  it("does not fuzzy-merge different concerts at the same venue on the same night", () => {
    const other = event({ title: "Chamber Music Soirée", start: "2026-10-15T19:30:00+02:00" }, { url: "https://jpo.co.za/other/" });
    expect(dedupe([presenter(), other], V, roles).events).toHaveLength(2);
  });
});

describe("merge", () => {
  const base = { queue: [], decisions: {}, venues: V, now: NOW };

  it("adds new events with first_seen/last_updated = now", () => {
    const { published, counts } = merge({ ...base, incoming: [presenter()], published: [] });
    expect(counts.added).toBe(1);
    expect(published[0]!.first_seen).toBe("2026-09-01T03:00:00+02:00");
    expect(published[0]!.last_updated).toBe("2026-09-01T03:00:00+02:00");
  });

  it("preserves first_seen and only bumps last_updated on real change", () => {
    const first = merge({ ...base, incoming: [presenter()], published: [] }).published;
    const later = new Date("2026-09-02T03:00:00+02:00");
    // Same content, new fetch time and hash: not a change.
    const refetched = { ...presenter(), source: { ...presenter().source, fetched_at: "2026-09-02T03:00:00+02:00", content_hash: "def" } };
    const same = merge({ ...base, now: later, incoming: [refetched], published: first });
    expect(same.counts.updated).toBe(0);
    expect(same.published[0]!.last_updated).toBe("2026-09-01T03:00:00+02:00");
    const changed = merge({ ...base, now: later, incoming: [{ ...presenter(), status: "sold_out" as const }], published: first });
    expect(changed.counts.updated).toBe(1);
    expect(changed.published[0]!.first_seen).toBe("2026-09-01T03:00:00+02:00");
    expect(changed.published[0]!.last_updated).toBe("2026-09-02T03:00:00+02:00");
  });

  it("keeps the id when the title is edited at the source", () => {
    const first = merge({ ...base, incoming: [presenter()], published: [] }).published;
    const edited = event({ title: "Spring Symphony Concert (Beethoven 5)" });
    expect(edited.id).not.toBe(first[0]!.id);
    const r = merge({ ...base, incoming: [edited], published: first });
    expect(r.published).toHaveLength(1);
    expect(r.published[0]!.id).toBe(first[0]!.id);
  });

  it("routes low confidence or needs_review to the queue, and publishes after approval", () => {
    const shaky = event({ confidence: 0.6 });
    const r1 = merge({ ...base, incoming: [shaky], published: [] });
    expect(r1.published).toHaveLength(0);
    expect(r1.queue).toHaveLength(1);
    const decisions = { [r1.queue[0]!.id]: { decision: "approve" as const, decided_at: "x", fingerprint: fingerprint(r1.queue[0]!), title: "" } };
    const r2 = merge({ ...base, incoming: [shaky], published: [], queue: r1.queue, decisions });
    expect(r2.published).toHaveLength(1);
    expect(r2.queue).toHaveLength(0);
    // An approval lapses when the content changes.
    const r3 = merge({ ...base, incoming: [{ ...shaky, title: "Spring Symphony Concert!!" }], published: [], queue: r1.queue, decisions });
    expect(r3.queue).toHaveLength(1);
  });

  it("marks vanished future events unconfirmed instead of deleting them", () => {
    const first = merge({ ...base, incoming: [presenter()], published: [] }).published;
    const r = merge({ ...base, incoming: [], published: first });
    expect(r.published).toHaveLength(1);
    expect(r.published[0]!.status).toBe("unconfirmed");
    expect(r.counts.unconfirmed).toBe(1);
  });

  it("keeps the last published version live while a changed version waits for review", () => {
    const first = merge({ ...base, incoming: [presenter()], published: [] }).published;
    const r = merge({ ...base, incoming: [{ ...presenter(), confidence: 0.5 }], published: first });
    expect(r.published).toHaveLength(1);
    expect(r.published[0]!.confidence).toBe(0.9);
    expect(r.queue).toHaveLength(1);
  });
});
