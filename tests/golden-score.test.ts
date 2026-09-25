import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { combine, scoreCase, type Expected } from "./golden/score.ts";
import { event } from "./helpers.ts";

describe("golden scorer", () => {
  const expected: Expected[] = [
    {
      title: "Spring Symphony Concert",
      start: "2026-10-15T19:30:00+02:00",
      venue: { venue_id: "linder-auditorium", name: "Linder Auditorium", city: "Johannesburg", province: "Gauteng" },
      performers: [{ name: "Daniel Boico", role: "conductor" }],
      programme: [{ composer: "Ludwig van Beethoven", work: "Symphony No. 5", catalogue: "Op. 67" }],
      tickets: { url: "https://www.quicket.co.za/events/1-x/?utm_source=x", vendor: "quicket", price_min: 150, price_max: 350 },
      genre_tags: ["orchestral"],
      presenter: "Johannesburg Philharmonic Orchestra",
      sa_content: { sa_composers: [], has_sa_work: false },
      status: "scheduled",
    },
  ];

  it("gives full marks to a perfect extraction and reports per-field", () => {
    const s = scoreCase(expected, [event()]);
    expect(s.matched).toBe(1);
    const { fields, events } = combine([s]);
    expect(events.recall).toBe(1);
    for (const [k, f] of Object.entries(fields)) expect([k, f.accuracy]).toEqual([k, 1]);
  });

  it("separates field errors from missing events", () => {
    const wrong = event({ performers: [{ name: "Someone Else", role: "conductor", instrument: null, is_south_african: null }], programme: [] });
    const s = scoreCase(expected, [wrong]);
    const { fields } = combine([s]);
    expect(fields.performers!.accuracy).toBe(0);
    expect(fields["programme.composer"]!.accuracy).toBe(0);
    expect(fields.title!.accuracy).toBe(1);
    expect(s.mismatches.join("\n")).toMatch(/performers/);
    expect(scoreCase(expected, []).mismatches[0]).toMatch(/missing event/);
  });

  it("every golden case has the required files and a snippet provenance", () => {
    const dir = path.join(import.meta.dirname, "golden/cases");
    for (const c of fs.readdirSync(dir)) {
      for (const f of ["case.json", "input.txt", "expected.json"]) expect(fs.existsSync(path.join(dir, c, f)), `${c}/${f}`).toBe(true);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, c, "case.json"), "utf8"));
      expect(meta.snippet_of, `${c} snippet_of`).toMatch(/https?:\/\//);
      // Snippets, not mirrored pages.
      expect(fs.statSync(path.join(dir, c, "input.txt")).size, `${c} input size`).toBeLessThan(8_000);
    }
  });
});
