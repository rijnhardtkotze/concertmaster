import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderQuicketEvent, quicketMatches } from "../src/adapters/quicket.ts";
import { canonicalUrl } from "../src/adapters/html.ts";
import { redact } from "../src/lib/log.ts";
import { loadSystemPrompt, documentBlock } from "../src/lib/prompt.ts";
import { parseDecisions, renderReviewIssue } from "../src/lib/review-issue.ts";
import { chunkText, htmlToText, sharedSpan, titleSimilarity } from "../src/lib/text.ts";
import { normaliseTimestamp } from "../src/lib/time.ts";
import quicket from "../sources/quicket.ts";
import { splitCpoCalendar } from "../sources/cpo.ts";
import { event } from "./helpers.ts";

describe("text", () => {
  it("keeps link targets inline and appends Event JSON-LD", () => {
    const html = `<html><head><title>T</title><script type="application/ld+json">{"@type":"MusicEvent","name":"X"}</script></head>
      <body><nav>menu</nav><main><h1>Gala</h1><p>Book <a href="/tickets?id=1">here</a>.</p><script>evil()</script></main></body></html>`;
    const t = htmlToText(html, { baseUrl: "https://example.org/page" });
    expect(t).toContain("Book here <https://example.org/tickets?id=1>");
    expect(t).not.toContain("menu");
    expect(t).not.toContain("evil");
    expect(t).toContain('"@type":"MusicEvent"');
  });

  it("finds shared 12-word spans regardless of case and punctuation", () => {
    const src = "Join us for an evening of Mozart, Haydn and Beethoven performed by the finest young musicians in Gauteng.";
    expect(sharedSpan("An EVENING of mozart haydn and beethoven performed by the finest young musicians!", src, 12)).toBeTruthy();
    expect(sharedSpan("Young musicians play Mozart, Haydn and Beethoven.", src, 12)).toBeNull();
  });

  it("scores decorated vendor titles as similar and different concerts as not", () => {
    expect(titleSimilarity("Symphonic Jazz", "The JPO Symphonic Jazz Concert 2026")).toBeGreaterThan(0.6);
    expect(titleSimilarity("Messiah", "Messiah Sing-Along for Kids")).toBeLessThan(0.75);
    expect(titleSimilarity("Brahms Requiem", "Mozart Requiem")).toBeLessThan(0.6);
  });

  it("chunks on paragraph and page boundaries", () => {
    const pages = Array.from({ length: 5 }, (_, i) => `page ${i} `.repeat(200)).join("\f");
    const chunks = chunkText(pages, 4000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 4000)).toBe(true);
  });
});

describe("time", () => {
  it("handles the shapes sources and models produce", () => {
    expect(normaliseTimestamp("2026-04-03T19:00:00+02:00")).toBe("2026-04-03T19:00:00+02:00");
    expect(normaliseTimestamp("2026-04-03 19:00")).toBe("2026-04-03T19:00:00+02:00");
    expect(normaliseTimestamp("2026-04-03T17:00:00.000Z")).toBe("2026-04-03T19:00:00+02:00");
    expect(normaliseTimestamp("2026-04-03T19:00:00+0200")).toBe("2026-04-03T19:00:00+02:00");
    expect(normaliseTimestamp("3 April 2026")).toBeNull();
  });
});

describe("secrets", () => {
  it("redacts keys from log lines and URLs", () => {
    const key = `sk-ant-api03-${"x".repeat(40)}`;
    expect(redact(`auth failed for ${key}`)).not.toContain("xxxxxxxx");
    expect(redact("GET https://api.quicket.co.za/api/events?api_key=abc123&page=2")).toBe("GET https://api.quicket.co.za/api/events?api_key=[REDACTED]&page=2");
  });

  it("never lets a key-shaped string into committed JSON", async () => {
    const { writeJson } = await import("../src/lib/json.ts");
    const f = path.join(fs.mkdtempSync("/tmp/sa-"), "x.json");
    expect(() => writeJson(f, { note: `sk-ant-api03-${"y".repeat(40)}` })).toThrow(/secret/);
  });
});

describe("prompt", () => {
  it("loads the system prompt from extraction-prompt.md", () => {
    const p = loadSystemPrompt();
    expect(p.startsWith("You extract structured classical music event data")).toBe(true);
    expect(p).toContain("Deliberate omissions");
    expect(p).not.toContain("```");
  });

  it("builds the documented header block", () => {
    const b = documentBlock({ source: "jpo", url: "https://jpo.co.za/x", fetchedAt: "2026-08-31T03:00:00+02:00", documentType: "html" }, "BODY");
    expect(b).toBe("SOURCE: jpo\nURL: https://jpo.co.za/x\nFETCHED_AT: 2026-08-31T03:00:00+02:00\nDOCUMENT_TYPE: html\n\n---\nBODY");
  });
});

describe("review issue", () => {
  it("round-trips ticked decisions; reject wins over approve", () => {
    const e = event({ confidence: 0.5, needs_review: ["start"] });
    const body = renderReviewIssue([e], [], null);
    expect(body).toContain(`- [ ] approve \`${e.id}\``);
    expect(parseDecisions(body).size).toBe(0);
    const ticked = body.replace(`- [ ] approve \`${e.id}\``, `- [x] approve \`${e.id}\``);
    expect(parseDecisions(ticked).get(e.id)).toBe("approve");
    const both = ticked.replace(`- [ ] reject \`${e.id}\``, `- [X] reject \`${e.id}\``);
    expect(parseDecisions(both).get(e.id)).toBe("reject");
  });
});

describe("adapters", () => {
  it("strips tracking params from URLs", () => {
    expect(canonicalUrl("https://www.quicket.co.za/events/392145-x/?utm_source=EventPage&ref=event-page-share#/")).toBe("https://www.quicket.co.za/events/392145-x/");
  });

  it("renders Quicket events stably and pre-filters by keyword or organiser", () => {
    const cfg = quicket.adapter as Parameters<typeof quicketMatches>[1];
    const e = {
      id: 1,
      name: "The JPO Symphonic Jazz Concert 2026",
      url: "https://www.quicket.co.za/events/392145-x/?ref=a",
      startDate: "2026-09-24T19:00:00",
      lastModified: "2026-09-01T10:00:00",
      venue: { name: "Linder Auditorium" },
      organiser: { id: 36134, name: "The Johannesburg Philharmonic Orchestra" },
      tickets: [{ name: "General", price: 250 }],
    };
    expect(quicketMatches(e, cfg)).toBe(true);
    expect(quicketMatches({ ...e, name: "Comedy night", organiser: { id: 1, name: "Laughs" }, venue: { name: "Pub" } }, cfg)).toBe(false);
    const text = renderQuicketEvent(e);
    expect(text).toContain("Event page: https://www.quicket.co.za/events/392145-x/");
    expect(text).not.toContain("2026-09-01T10:00:00"); // lastModified would churn the content hash
  });

  it("splits the CPO calendar widget into one document per upcoming entry", () => {
    const entries = [
      { title: "Summer Symphonies at the City Hall", description: "<p><strong>ECHOES OF VIENNA</strong></p>", start: "2026-11-12 19:30", end: "2026-11-12 22:00:01", allDay: "" },
      { title: "Old concert", description: "", start: "2025-01-01 19:30", end: "2025-01-01 22:00:01", allDay: "" },
    ];
    const html = `<div class="eael-event-calendar-cls" data-events="${JSON.stringify(entries).replace(/"/g, "&quot;")}"></div>`;
    const items = splitCpoCalendar(html, "https://cpo.org.za/concerts/");
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("202611121930-summer-symphonies-at-the-city-hall");
    expect(items[0]!.text).toContain("ECHOES OF VIENNA");
  });
});

describe("keyword pre-filter", async () => {
  const { CLASSICAL_KEYWORDS } = await import("../src/lib/keywords.ts");
  it("matches classical signals and not their lookalikes", () => {
    for (const s of ["Cape Town Philharmonic", "Brahms Requiem", "Orrelkonsert in die kerk", "Die Kaapse Simfonie", "Vox koor", "Dvořák 9"]) expect(CLASSICAL_KEYWORDS.test(s), s).toBe(true);
    for (const s of ["Organised by the Comedy Club", "Operation Smile fundraiser", "Bachelor party bingo", "Contemporary dance"]) expect(CLASSICAL_KEYWORDS.test(s), s).toBe(false);
  });
});
