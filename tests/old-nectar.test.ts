import { describe, expect, it } from "vitest";
import { quicketMatches, type QuicketEvent } from "../src/adapters/quicket.ts";
import { dedupe } from "../src/lib/dedupe.ts";
import { normaliseEvent } from "../src/lib/normalise.ts";
import { ComposerIndex, loadVenues, VenueIndex } from "../src/lib/reference.ts";
import { loadSources, type HtmlAdapterConfig, type QuicketAdapterConfig, type SourceRole } from "../src/lib/sources.ts";
import { htmlToText } from "../src/lib/text.ts";
import { composers, doc, rawEvent } from "./helpers.ts";

/** Old Nectar is listed twice, on its own page and on Quicket; the two must meet as one concert. */
describe("old-nectar source", async () => {
  const sources = await loadSources();
  const oldNectar = sources.find((s) => s.slug === "old-nectar")!;
  const quicket = sources.find((s) => s.slug === "quicket")!;
  const roles = Object.fromEntries(sources.map((s) => [s.slug, s.role])) as Record<string, SourceRole>;

  it("keeps the concerts and ticket links and drops the site chrome", () => {
    // The live page's shape (WordPress, no <main>): header and footer around one .entry-content block.
    const html = `<html><head><title>Concerts – Old Nectar Gardens</title></head><body>
      <header><nav><a href="/">Home</a><a href="/weddings/">Weddings</a></nav></header>
      <div class="entry-content"><h2>UPCOMING CONCERTS</h2>
        <p>18 October 2026, 4pm - Piano Trio Recital</p>
        <p><a href="https://www.quicket.co.za/events/1-piano-trio-recital/#/">BOOK NOW</a></p></div>
      <footer>Copyright Old Nectar Gardens</footer></body></html>`;
    const cfg = oldNectar.adapter as HtmlAdapterConfig;
    const text = htmlToText(html, { baseUrl: cfg.startUrls[0]!, contentSelector: cfg.contentSelector, remove: cfg.remove });
    expect(text).toContain("18 October 2026, 4pm - Piano Trio Recital");
    expect(text).toContain("BOOK NOW <https://www.quicket.co.za/events/1-piano-trio-recital/#/>");
    expect(text).not.toMatch(/Weddings|Copyright/);
  });

  it("keeps its Quicket listings by organiser even when nothing in them matches a classical keyword", () => {
    // As the API sends it: id 0, no name, the real id only in the organiser page URL.
    const e: QuicketEvent = { id: 1, name: "An afternoon at Old Nectar", url: "https://www.quicket.co.za/events/1-x/", startDate: "2026-10-18T16:00:00", organiser: { id: 0, name: null, organiserPageUrl: "https://www.quicket.co.za/organisers/40248-old-nectar-concerts" } };
    const cfg = quicket.adapter as QuicketAdapterConfig;
    expect(quicketMatches(e, cfg)).toBe(true);
    expect(quicketMatches({ ...e, organiser: { id: 0, name: null, organiserPageUrl: "https://www.quicket.co.za/organisers/402480-someone-else" } }, cfg)).toBe(false);
    expect(quicketMatches({ ...e, organiser: { id: 1, name: "Someone else" } }, cfg)).toBe(false);
  });

  it("merges its page and Quicket records into one concert at the Old Nectar venue", () => {
    const ctx = { venues: new VenueIndex(loadVenues()), composers: new ComposerIndex(composers), now: new Date("2026-09-25T03:00:00+02:00") };
    const venue = (name: string) => ({ venue_id: null, name, address: null, city: "Stellenbosch", province: "Western Cape", lat: null, lng: null });
    const record = (over: Record<string, unknown>, d: Parameters<typeof doc>[0]) => {
      const r = normaliseEvent(rawEvent({ start: "2026-10-18T16:00:00+02:00", presenter: "Old Nectar Concerts", performers: [], programme: [], genre_tags: ["chamber"], ...over }), doc(d), ctx);
      if (!r.ok) throw new Error(JSON.stringify(r));
      return r.event;
    };
    const page = record(
      { title: "David Earl 75th Birthday Celebration", venue: venue("Old Nectar wine cellar"), tickets: { url: "https://www.quicket.co.za/events/394922-david-earl-75th-birthday-celebration/", vendor: "quicket", price_min: 200, price_max: 200, is_free: null, concessions_note: null, booking_required: null } },
      { url: "https://www.oldnectar.com/concerts/", source: "old-nectar", text: "David Earl 75th Birthday Celebration, Old Nectar" },
    );
    const listing = record(
      { title: "David Earl 75th Birthday Celebration", description: null, venue: venue("Old Nectar Gardens"), tickets: { url: "https://www.quicket.co.za/events/394922-david-earl-75th-birthday-celebration/", vendor: "quicket", price_min: 200, price_max: 200, is_free: null, concessions_note: null, booking_required: null } },
      { url: "https://www.quicket.co.za/events/394922-david-earl-75th-birthday-celebration/", source: "quicket", text: "David Earl 75th Birthday Celebration" },
    );
    expect(page.venue.venue_id).toBe("old-nectar");
    expect(listing.venue.venue_id).toBe("old-nectar");
    const { events } = dedupe([listing, page], ctx.venues, roles);
    expect(events).toHaveLength(1);
    expect(events[0]!.source.publisher).toBe("old-nectar");
    expect(events[0]!.tickets?.url).toBe("https://www.quicket.co.za/events/394922-david-earl-75th-birthday-celebration/");
  });
});
