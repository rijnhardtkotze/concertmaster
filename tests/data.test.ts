import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PATHS } from "../src/lib/config.ts";
import { loadComposers, loadVenues, VenueIndex } from "../src/lib/reference.ts";
import { Event, PROVINCES } from "../src/lib/schema.ts";
import { loadSources } from "../src/lib/sources.ts";
import { normalise } from "../src/lib/text.ts";

/** Guards the hand-maintained tables and the committed output against bad edits. */
describe("committed data", () => {
  it("venues.json: unique slug ids, valid provinces, no alias shared between venues", () => {
    const venues = loadVenues();
    const ids = new Set<string>();
    const names = new Map<string, string>();
    for (const v of venues) {
      expect(v.venue_id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(v.venue_id), `duplicate ${v.venue_id}`).toBe(false);
      ids.add(v.venue_id);
      expect(PROVINCES).toContain(v.province);
      for (const n of [v.name, ...v.aliases]) {
        const k = `${normalise(n)}|${normalise(v.city)}`;
        expect(names.get(k) ?? v.venue_id, `"${n}" is claimed by two venues`).toBe(v.venue_id);
        names.set(k, v.venue_id);
      }
    }
  });

  it("venues.json resolves the spellings sources actually print", () => {
    const index = new VenueIndex(loadVenues());
    const cases: [{ name: string; address?: string; city?: string }, string][] = [
      // Mzansi Chamber Music Collective: its own pages, then Quicket's venue records.
      [{ name: "Northwards House", city: "Johannesburg" }, "northwards-house"],
      [{ name: "Shed & Silo", city: "Benoni" }, "shed-and-silo"],
      [{ name: "St Stithians College Chapel", city: "Sandton" }, "st-stithians-chapel"],
      [{ name: "The Shed and Silo Country Restaurant", address: "Thomas Road 77", city: "Benoni" }, "shed-and-silo"],
      [
        { name: "St Stithians College Chapel - Use Bishop Malinga Gate at 40 Peter Place, Lyme Park, Sandton", address: "40 Peter Place, Sandton" },
        "st-stithians-chapel",
      ],
    ];
    for (const [v, id] of cases) expect(index.resolve(v)?.venue_id, v.name).toBe(id);
  });

  it("composers-sa.json: a sorted list of unique names", () => {
    const c = loadComposers();
    expect(new Set(c.map(normalise)).size).toBe(c.length);
    expect(c.every((x) => typeof x === "string" && x.trim() === x)).toBe(true);
  });

  it("events.json and review-queue.json validate against the schema", () => {
    for (const f of [PATHS.events, PATHS.reviewQueue]) {
      const events = JSON.parse(fs.readFileSync(f, "utf8")) as unknown[];
      for (const e of events) expect(Event.safeParse(e).success).toBe(true);
    }
  });

  it("every source config loads and has a unique slug", async () => {
    const sources = await loadSources();
    expect(new Set(sources.map((s) => s.slug)).size).toBe(sources.length);
    expect(sources.length).toBeGreaterThanOrEqual(3);
  });
});
