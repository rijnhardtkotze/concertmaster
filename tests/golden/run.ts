/**
 * Golden set: run the real extract path over hand-labelled fixtures, check each
 * record against the v2 extraction schema, and report per-field accuracy against
 * tests/golden/results/baseline.json.
 *
 *   pnpm run golden                     # live run (needs CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY)
 *   pnpm run golden -- --case jpo-heritage-day
 *   pnpm run golden -- --recorded       # re-score the last live outputs; no API calls
 *   pnpm run golden -- --save-baseline  # accept this run as the new baseline
 *
 * Exits non-zero when, on two live runs in a row (the first failure triggers one re-run,
 * since extraction isn't deterministic), overall field accuracy drops more than --tolerance
 * (default 0.05) below the baseline, or title, start date or start time accuracy,
 * Performance recall or Performance precision drops at all. Other fields' movement is reported in the table but doesn't gate
 * on its own (too few samples per field). With
 * --require-baseline (as in CI) a missing baseline is an error, not a pass.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PATHS } from "../../src/lib/config.ts";
import { ExtractedPerformance } from "../../src/lib/extraction-schema.ts";
import { readJson, writeJson } from "../../src/lib/json.ts";
import { hasExtractCredentials } from "../../src/lib/llm.ts";
import { loadSystemPrompt, promptVersion, referenceBlock } from "../../src/lib/prompt.ts";
import { loadComposers, loadVenues, venuesForPrompt } from "../../src/lib/reference.ts";
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
const IDENTITY_FIELDS = ["production.title", "performance.start_date", "performance.start_time"];

async function main() {
  const args = parseArgs() as ReturnType<typeof parseArgs> & { case?: string; recorded?: boolean; "save-baseline"?: boolean; "require-baseline"?: boolean; tolerance?: string };
  const recorded = args.recorded === true;
  // Checked before the credential skip, so a PR without secrets (e.g. from a fork) can't
  // pass with the baseline deleted.
  if (args["require-baseline"] && !fs.existsSync(BASELINE)) {
    console.error("golden: no committed baseline (tests/golden/results/baseline.json). Run with --save-baseline and commit it.");
    process.exit(1);
  }
  if (!recorded && !hasExtractCredentials()) {
    console.log("golden: no CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY; skipping live run (use --recorded to re-score the last run).");
    return;
  }
  const sources = new Map((await loadSources()).map((s) => [s.slug, s]));
  const system = loadSystemPrompt();
  const version = promptVersion(system);
  const ctx = { system, version, tables: referenceBlock(venuesForPrompt(loadVenues()), loadComposers()) };
  const previous = readJson<Results | null>(LATEST, null);

  const caseIds = fs.readdirSync(CASES).filter((d) => fs.statSync(path.join(CASES, d)).isDirectory() && (!args.case || d === args.case)).sort();
  const models = new Set<string>();
  const runCases = async () => {
    const scores: CaseScore[] = [];
    const out: Results["cases"] = {};
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
        raw = r.performances;
        guard = new Map(r.guard_failures.map((g) => [g.index, g.reason]));
      }

      // Scored as extracted: each record must match the v2 extraction schema, and a guard
      // failure is reported (its description was already removed).
      const actual: ExtractedPerformance[] = [];
      const notes: string[] = [];
      raw.forEach((r, i) => {
        if (guard.has(i)) notes.push(`copyright guard: ${guard.get(i)}`);
        const p = ExtractedPerformance.safeParse(r);
        if (p.success) actual.push(p.data);
        else notes.push(`rejected by the schema: ${p.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}`);
      });
      const s = scoreCase(expected, actual);
      s.mismatches.push(...notes);
      scores.push(s);
      out[id] = { raw, mismatches: s.mismatches };
    }
    return { summary: combine(scores), out };
  };

  // Gate on overall accuracy (all field checks pooled) and event recall/precision. Individual
  // fields have 1–5 samples, so one non-deterministic answer swings a field by 20–50%: shown
  // in the table below, but gating on it would make the job flaky.
  let baseline = readJson<Results | null>(BASELINE, null);
  // A baseline saved before the v2 extraction shape has other field names and no
  // Performance counts, so there is nothing to compare against until it is re-saved.
  if (baseline && !baseline.summary.performances) {
    console.warn("golden: the committed baseline predates the v2 extraction shape; ignoring it");
    baseline = null;
  }
  const tolerance = Number(args.tolerance ?? 0.05);
  const overall = (f: Record<string, { correct: number; total: number }>) => {
    const t = Object.values(f).reduce((a, x) => ({ c: a.c + x.correct, n: a.n + x.total }), { c: 0, n: 0 });
    return t.n ? t.c / t.n : 1;
  };
  const regressions = (now: ReturnType<typeof combine>, base: Results) => {
    const failures: string[] = [];
    const [a, b] = [overall(base.summary.fields), overall(now.fields)];
    if (a - b > tolerance) failures.push(`overall accuracy fell from ${pct(a)} to ${pct(b)}`);
    // Identity fields are gated on their own: a Production titled with its Series name, or a
    // Performance on the wrong date or time, is wrong on the site however well the other checks score.
    for (const field of IDENTITY_FIELDS) {
      const was = base.summary.fields[field]?.accuracy;
      const is = now.fields[field]?.accuracy;
      if (was !== undefined && is !== undefined && is < was) failures.push(`${field} accuracy fell from ${pct(was)} to ${pct(is)}`);
    }
    const [p, q] = [base.summary.performances, now.performances];
    if (q.recall < p.recall) failures.push(`Performance recall fell from ${pct(p.recall)} to ${pct(q.recall)}`);
    // Extra, invented Performances don't lower recall or field scores, so precision is gated too.
    if (q.precision < p.precision) failures.push(`Performance precision fell from ${pct(p.precision)} to ${pct(q.precision)}`);
    return failures;
  };

  let { summary, out } = await runCases();
  // Extraction isn't deterministic (the Claude Code path can't set temperature), and with
  // ~40 pooled checks one run can drift a few points either way. A real regression fails
  // twice; a wobble doesn't. So a live run that trips the gate gets exactly one re-run,
  // and that second run is the one reported and gated.
  if (!recorded && !args["save-baseline"] && baseline) {
    const first = regressions(summary, baseline);
    if (first.length) {
      console.warn(`golden: ${first.join("; ")}; re-running once to rule out run-to-run variance`);
      ({ summary, out } = await runCases());
    }
  }
  const rows = Object.entries(summary.fields).map(([field, f]) => {
    const b = baseline?.summary.fields[field];
    const delta = b ? f.accuracy - b.accuracy : null;
    const d = delta === null ? "new" : Math.abs(delta) < 0.005 ? "=" : `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(0)}`;
    return `| ${field} | ${pct(f.accuracy)} | ${f.total} | ${d} |`;
  });
  const e = summary.performances;
  const report = [
    `## Golden set (${caseIds.length} cases, prompt ${version}${recorded ? ", recorded outputs" : ""})`,
    "",
    `Performances: recall ${pct(e.recall)} (${e.matched}/${e.expected}), precision ${pct(e.precision)} (${e.matched}/${e.actual})` +
      (baseline ? ` · baseline recall ${pct(baseline.summary.performances.recall)}, precision ${pct(baseline.summary.performances.precision)} (prompt ${baseline.prompt_version})` : ""),
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

  if (!baseline) {
    const msg = "golden: no committed baseline (tests/golden/results/baseline.json), so nothing to compare against";
    if (args["require-baseline"]) {
      console.error(`${msg}. Run with --save-baseline and commit it.`);
      process.exit(1);
    }
    console.warn(msg);
    return;
  }
  const now = overall(summary.fields);
  const before = overall(baseline.summary.fields);
  console.log(
    `golden: overall field accuracy ${pct(now)} (baseline ${pct(before)}), Performance recall ${pct(e.recall)} (baseline ${pct(baseline.summary.performances.recall)}), precision ${pct(e.precision)} (baseline ${pct(baseline.summary.performances.precision)})`,
  );
  const failures = regressions(summary, baseline);
  if (failures.length) {
    console.error(`golden: regression: ${failures.join("; ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
