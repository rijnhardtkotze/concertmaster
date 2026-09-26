import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ExtractedPerformance } from "../src/lib/extraction-schema.ts";
import { combine, scoreCase, type Expected } from "./golden/score.ts";
import { extractedPerformance } from "./helpers.ts";

describe("golden scorer", () => {
  const expected: Expected[] = [
    {
      production: {
        title: "Spring Symphony",
        genre: "orchestral",
        presenter: "Johannesburg Philharmonic Orchestra",
        credits: [{ name: "Daniel Boico", kind: "person", role: "conductor" }],
        programme: [{ kind: "work", composer: "Ludwig van Beethoven", title: "Symphony No. 5", catalogue: "Op. 67" }],
      },
      performance: {
        start_date: "2026-10-15",
        start_time: "19:30",
        venue: { name: "Linder Auditorium", city: "Johannesburg", province: "Gauteng" },
        status: "scheduled",
        price_tiers: [{ name: "General", amount: 350 }],
        ticket_url: "https://www.quicket.co.za/events/1-x/?utm_source=x",
      },
    },
  ];

  it("the fixture is a valid v2 extraction record", () => {
    expect(ExtractedPerformance.safeParse(extractedPerformance()).success).toBe(true);
  });

  it("gives full marks to a perfect extraction and reports per-field", () => {
    const s = scoreCase(expected, [extractedPerformance()]);
    expect(s.matched).toBe(1);
    const { fields, performances } = combine([s]);
    expect(performances.recall).toBe(1);
    expect(Object.keys(fields)).toEqual(expect.arrayContaining(["production.title", "performance.start_time", "production.credits", "performance.price_tiers"]));
    for (const [k, f] of Object.entries(fields)) expect([k, f.accuracy]).toEqual([k, 1]);
  });

  it("separates field errors from missing Performances", () => {
    const wrong = extractedPerformance({
      production: { credits: [{ name: "Someone Else", kind: "person", role: "conductor", instrument: null, locale: null }], programme: [] },
      performance: { start_time: "20:00" },
    });
    const s = scoreCase(expected, [wrong]);
    const { fields } = combine([s]);
    expect(fields["production.credits"]!.accuracy).toBe(0);
    expect(fields["production.programme.composer"]!.accuracy).toBe(0);
    expect(fields["performance.start_time"]!.accuracy).toBe(0);
    expect(fields["production.title"]!.accuracy).toBe(1);
    expect(s.mismatches.join("\n")).toMatch(/production\.credits/);
    expect(scoreCase(expected, []).mismatches[0]).toMatch(/missing Performance/);
  });

  it("scores a Credit's locale and the Programme's intervals", () => {
    const exp: Expected[] = [
      {
        production: {
          title: "Spring Symphony",
          credits: [{ name: "Daniel Boico", kind: "person", role: "conductor", locale: "en-ZA" }],
          programme: [{ kind: "work", composer: "Ludwig van Beethoven", title: "Symphony No. 5" }, { kind: "interval", minutes: 20 }],
        },
        performance: { start_date: "2026-10-15" },
      },
    ];
    const { fields } = combine([scoreCase(exp, [extractedPerformance()])]);
    expect(fields["production.credits.locale"]!.accuracy).toBe(0);
    expect(fields["production.programme.interval"]!.accuracy).toBe(0);
  });

  it("every golden case has the required files and a snippet provenance", () => {
    const dir = path.join(import.meta.dirname, "golden/cases");
    for (const c of fs.readdirSync(dir)) {
      for (const f of ["case.json", "input.txt", "expected.json"]) expect(fs.existsSync(path.join(dir, c, f)), `${c}/${f}`).toBe(true);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, c, "case.json"), "utf8"));
      expect(meta.snippet_of, `${c} snippet_of`).toMatch(/https?:\/\//);
      // Snippets, not mirrored pages.
      expect(fs.statSync(path.join(dir, c, "input.txt")).size, `${c} input size`).toBeLessThan(8_000);
      // Labelled in the v2 extraction shape.
      for (const e of JSON.parse(fs.readFileSync(path.join(dir, c, "expected.json"), "utf8")) as Record<string, unknown>[]) {
        expect(Object.keys(e).sort(), `${c} expected keys`).toEqual(["performance", "production"]);
      }
    }
  });
});
