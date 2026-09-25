/**
 * Golden set: run the real extract → normalise path over hand-labelled
 * fixtures and report per-field accuracy against tests/golden/results/baseline.json.
 *
 *   pnpm run golden                     # live run (needs CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY)
 *   pnpm run golden -- --case jpo-heritage-day
 *   pnpm run golden -- --recorded       # re-score the last live outputs; no API calls
 *   pnpm run golden -- --save-baseline  # accept this run as the new baseline
 *
 * Exits non-zero only on a regression beyond --tolerance (default 0.05) in any field,
 * or on event recall dropping, so a prompt edit that moves errors around is visible
 * in the table but doesn't block a PR by itself.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PATHS } from "../../src/lib/config.ts";
import { sourceShingles } from "../../src/lib/guard.ts";
import { sha256 } from "../../src/lib/hash.ts";
import { readJson, writeJson } from "../../src/lib/json.ts";
import { hasExtractCredentials } from "../../src/lib/llm.ts";
import { normaliseEvent } from "../../src/lib/normalise.ts";
import { loadSystemPrompt, promptVersion, tablesBlock } from "../../src/lib/prompt.ts";
import { ComposerIndex, loadComposers, loadVenues, VenueIndex, venuesForPrompt } from "../../src/lib/reference.ts";
import type { Event } from "../../src/lib/schema.ts";
import { loadSources, parseArgs, type SourceConfig } from "../../src/lib/sources.ts";
import { extractDocument, modelFor } from "../../src/stages/extract.ts";
import { combine, scoreCase, type CaseScore, type Expected } from "./score.ts";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.join(DIR, "cases");
const LATEST = path.join(DIR, "results/latest.json");
const BASELINE = path.join(DIR, "results/baseline.json");

interface CaseMeta {
  source: string;
  url: string;
  fetched_at: string;
  document_type: "html" | "pdf" | "json" | "text";
  /** Where the snippet in input.txt came from and when. Required: we don't keep whole pages. */
  snippet_of: string;
  notes?: string;
}

interface Results {
  prompt_version: string;
  models: string[];
  ran_at: string;
  summary: ReturnType<typeof combine>;
  cases: Record<string, { raw: unknown[]; mismatches: string[] }>;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

async function main() {
  const args = parseArgs() as ReturnType<typeof parseArgs> & { case?: string; recorded?: boolean; "save-baseline"?: boolean; tolerance?: string };
  const recorded = args.recorded === true;
  if (!recorded && !hasExtractCredentials()) {
    console.log("golden: no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY; skipping live run (use --recorded to re-score the last run).");
    return;
  }
  const sources = new Map((await loadSources()).map((s) => [s.slug, s]));
  const system = loadSystemPrompt();
  const version = promptVersion(system);
  const venuesList = loadVenues();
  const ctx = { system, version, tables: tablesBlock(venuesForPrompt(venuesList), loadComposers()) };
  const venues = new VenueIndex(venuesList);
  const composers = new ComposerIndex(loadComposers());
  const previous = readJson<Results | null>(LATEST, null);

  const caseIds = fs.readdirSync(CASES).filter((d) => fs.statSync(path.join(CASES, d)).isDirectory() && (!args.case || d === args.case)).sort();
  const scores: CaseScore[] = [];
  const out: Results["cases"] = {};
  const models = new Set<string>();

  for (const id of caseIds) {
    const dir = path.join(CASES, id);
    const meta = readJson<CaseMeta>(path.join(dir, "case.json"), null as unknown as CaseMeta);
    const text = fs.readFileSync(path.join(dir, "input.txt"), "utf8");
    const expected = readJson<Expected[]>(path.join(dir, "expected.json"), []);
    const source: SourceConfig = sources.get(meta.source) ?? { slug: meta.source, name: meta.source, role: "presenter", homepage: meta.url, adapter: { type: "html", startUrls: [] } };
    models.add(modelFor(source, meta.document_type));

    let raw: unknown[];
    let guard: Map<number, string>;
    if (recorded) {
      raw = previous?.cases[id]?.raw ?? [];
      guard = new Map();
    } else {
      const r = await extractDocument(ctx, { source, url: meta.url, kind: meta.document_type, fetchedAt: meta.fetched_at, text });
      raw = r.events;
      guard = new Map(r.guard_failures.map((g) => [g.index, g.reason]));
    }

    const doc = { url: meta.url, source: meta.source, fetchedAt: meta.fetched_at, contentHash: sha256(text), text: sourceShingles(text) };
    const actual: Event[] = [];
    const notes: string[] = [];
    (raw as Record<string, unknown>[]).forEach((r, i) => {
      const n = normaliseEvent(r, doc, { venues, composers, now: new Date(meta.fetched_at) }, guard.get(i));
      if (n.ok) actual.push(n.event);
      else notes.push(n.skipped ? `skipped (${n.reason})` : `rejected: ${n.reasons.join("; ")}`);
    });
    const s = scoreCase(expected, actual);
    s.mismatches.push(...notes);
    scores.push(s);
    out[id] = { raw, mismatches: s.mismatches };
  }

  const summary = combine(scores);
  const baseline = readJson<Results | null>(BASELINE, null);
  const rows = Object.entries(summary.fields).map(([field, f]) => {
    const b = baseline?.summary.fields[field];
    const delta = b ? f.accuracy - b.accuracy : null;
    const d = delta === null ? "new" : Math.abs(delta) < 0.005 ? "=" : `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(0)}`;
    return `| ${field} | ${pct(f.accuracy)} | ${f.total} | ${d} |`;
  });
  const e = summary.events;
  const report = [
    `## Golden set (${caseIds.length} cases, prompt ${version}${recorded ? ", recorded outputs" : ""})`,
    "",
    `Events: recall ${pct(e.recall)} (${e.matched}/${e.expected}), precision ${pct(e.precision)} (${e.matched}/${e.actual})` +
      (baseline ? ` · baseline recall ${pct(baseline.summary.events.recall)}, precision ${pct(baseline.summary.events.precision)} (prompt ${baseline.prompt_version})` : ""),
    "",
    "| field | accuracy | n | Δ pts vs baseline |",
    "|---|---|---|---|",
    ...rows,
    "",
    "<details><summary>Mismatches</summary>",
    "",
    ...Object.entries(out).flatMap(([id, c]) => [`**${id}**`, ...(c.mismatches.length ? c.mismatches.map((m) => `- ${m}`) : ["- none"]), ""]),
    "</details>",
  ].join("\n");
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");

  const results: Results = { prompt_version: version, models: [...models], ran_at: new Date().toISOString(), summary, cases: out };
  if (!recorded) writeJson(LATEST, results);
  if (args["save-baseline"]) {
    writeJson(BASELINE, results);
    console.log(`baseline saved to ${path.relative(PATHS.data, BASELINE)}`);
    return;
  }

  const tolerance = Number(args.tolerance ?? 0.05);
  if (baseline) {
    const regressions = Object.entries(summary.fields).filter(([k, f]) => (baseline.summary.fields[k]?.accuracy ?? 0) - f.accuracy > tolerance);
    if (e.recall < baseline.summary.events.recall) regressions.push(["events.recall", { accuracy: e.recall, correct: 0, total: 0 }]);
    if (regressions.length) {
      console.error(`golden: regression beyond ${tolerance} in ${regressions.map(([k]) => k).join(", ")}`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
