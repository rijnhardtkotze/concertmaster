import { describe, expect, it } from "vitest";
import { dedupeKey, eventId } from "../src/lib/keys.ts";
import { normaliseEvent } from "../src/lib/normalise.ts";
import { ctx, doc, rawEvent } from "./helpers.ts";

describe("normaliseEvent", () => {
  it("computes dedupe_key and id per the schema and resolves the venue alias", () => {
    const r = normaliseEvent(rawEvent(), doc(), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.dedupe_key).toBe("2026-10-15|linder-auditorium|spring symphony concert");
    expect(r.event.id).toBe(eventId(r.event.dedupe_key));
    expect(r.event.id).toMatch(/^[0-9a-f]{16}$/);
    expect(r.event.venue).toMatchObject({ venue_id: "linder-auditorium", name: "Linder Auditorium", province: "Gauteng", address: "Wits Education Campus" });
    expect(r.event.source).toEqual({
      url: "https://jpo.co.za/spring/",
      publisher: "jpo",
      fetched_at: "2026-08-31T03:00:00+02:00",
      content_hash: "abc",
      secondary_urls: [],
    });
    expect(r.event.tickets?.currency).toBe("ZAR");
    // nulls are dropped, not published
    expect("subtitle" in r.event).toBe(false);
  });

  it("uses only the first six title words, lowercased and punctuation-stripped", () => {
    expect(dedupeKey({ start: "2026-10-15T19:30:00+02:00", title: "Beethoven’s Ninth: Ode to Joy — Gala Night 2026!", venue: { venue_id: null, name: "Odeion" } })).toBe(
      "2026-10-15|odeion|beethovens ninth ode to joy gala",
    );
  });

  it("normalises timestamps to +02:00, reading offset-less values as SAST", () => {
    const r = normaliseEvent(rawEvent({ start: "2026-10-15T19:30", end: "2026-10-15T19:30:00Z" }), doc(), ctx());
    expect(r.ok && r.event.start).toBe("2026-10-15T19:30:00+02:00");
    expect(r.ok && r.event.end).toBe("2026-10-15T21:30:00+02:00");
  });

  it("matches SA composers from the table only, and flags a bare surname for review", () => {
    const r = normaliseEvent(
      rawEvent({
        programme: [
          { composer: "Péter Louis van Dijk", work: "San Gloria", catalogue: null, movements: null, is_premiere: null, arranger: null },
          { composer: "Hofmeyr", work: "Raka", catalogue: null, movements: null, is_premiere: null, arranger: null },
          { composer: "Johannes Brahms", work: "Symphony No. 1", catalogue: null, movements: null, is_premiere: null, arranger: null },
        ],
        sa_content: { sa_composers: ["Johannes Brahms"], has_sa_work: true, languages: [] }, // model's own claim is ignored
      }),
      doc(),
      ctx(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.sa_content).toEqual({ sa_composers: ["Hendrik Hofmeyr", "Péter Louis van Dijk"], has_sa_work: true, languages: [] });
    expect(r.event.needs_review).toContain("programme.1.composer");
  });

  it("does not resolve a venue alias when the city contradicts it", () => {
    const r = normaliseEvent(rawEvent({ venue: { venue_id: null, name: "City Hall, Cape Town", address: null, city: "Durban", province: "KwaZulu-Natal", lat: null, lng: null } }), doc(), ctx());
    expect(r.ok && r.event.venue.venue_id).toBeFalsy();
  });

  it("hard-fails a description sharing a 12-word span with the source (copyright guard)", () => {
    const blurb = "an unforgettable evening of soaring melodies and thrilling virtuosity awaits you at the Linder this spring";
    const r = normaliseEvent(rawEvent({ description: `Expect ${blurb}.` }), doc({ text: `Book now! ${blurb}. Tickets R150.` }), ctx());
    expect(r.ok).toBe(false);
    expect(!r.ok && !r.skipped && r.reasons.join()).toMatch(/copyright guard/);
  });

  it("rejects records the extract-time guard already caught", () => {
    const r = normaliseEvent(rawEvent({ description: null }), doc(), ctx(), "shares a span");
    expect(r.ok).toBe(false);
  });

  it("drops a description when the source text is unavailable, rather than publishing it unchecked", () => {
    const r = normaliseEvent(rawEvent(), doc({ text: null }), ctx());
    expect(r.ok && r.event.description).toBeUndefined();
  });

  it("nulls an over-long description and flags it rather than rejecting the event", () => {
    const r = normaliseEvent(rawEvent({ description: "word ".repeat(100) }), doc(), ctx());
    expect(r.ok).toBe(true);
    expect(r.ok && r.event.description).toBeUndefined();
    expect(r.ok && r.event.needs_review).toContain("description");
  });

  it("skips past events and rejects ones beyond the 24-month horizon", () => {
    const past = normaliseEvent(rawEvent({ start: "2026-08-20T19:30:00+02:00" }), doc(), ctx());
    expect(!past.ok && past.skipped).toBe("past");
    const far = normaliseEvent(rawEvent({ start: "2028-12-01T19:30:00+02:00" }), doc(), ctx());
    expect(!far.ok && !far.skipped && far.reasons.join()).toMatch(/24 months/);
  });

  it("rejects price_min > price_max and bad provinces", () => {
    const prices = normaliseEvent(rawEvent({ tickets: { ...(rawEvent().tickets as object), price_min: 400, price_max: 100 } }), doc(), ctx());
    expect(!prices.ok && !prices.skipped && prices.reasons.join()).toMatch(/price_min/);
    const province = normaliseEvent(rawEvent({ venue: { venue_id: null, name: "Somewhere", address: null, city: "Gaborone", province: "South-East", lat: null, lng: null } }), doc(), ctx());
    expect(!province.ok && !province.skipped && province.reasons.join()).toMatch(/venue\.province/);
  });

  it("accepts a per-event source URL only from the document's own site", () => {
    const own = normaliseEvent(rawEvent({ source: { url: "https://www.jpo.co.za/other-concert/" } }), doc(), ctx());
    expect(own.ok && own.event.source.url).toBe("https://www.jpo.co.za/other-concert/");
    const foreign = normaliseEvent(rawEvent({ source: { url: "https://evil.example/" } }), doc(), ctx());
    expect(foreign.ok && foreign.event.source.url).toBe("https://jpo.co.za/spring/");
  });

  it("omits an all-null tickets object instead of publishing just the currency", () => {
    const r = normaliseEvent(
      rawEvent({ tickets: { url: null, vendor: null, price_min: null, price_max: null, is_free: null, concessions_note: null, booking_required: null } }),
      doc(),
      ctx(),
    );
    expect(r.ok && r.event.tickets).toBeUndefined();
  });
});
