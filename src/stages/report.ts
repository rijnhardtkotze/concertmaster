import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../lib/config.ts";
import { writeText } from "../lib/json.ts";
import { errorMessage, logger, redact } from "../lib/log.ts";
import { loadSources } from "../lib/sources.ts";
import { loadSourceStatus, readStats, type SourceRunStats } from "../lib/state.ts";

const log = logger("report");

const n = (v: number | undefined) => (v ? String(v) : "·");
const md = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Builds the step summary and the commit message from .work/stats. Pure reporting; never fails the run. */
async function main() {
  const sources = await loadSources();
  const status = loadSourceStatus();
  const fetch = readStats("fetch")?.sources ?? {};
  const extract = readStats("extract");
  const normalise = readStats("normalise")?.sources ?? {};
  const merge = readStats("merge");
  const dedupe = readStats("dedupe");
  const m = merge?.totals ?? {};

  const rows: string[] = [];
  const problems: string[] = [];
  for (const s of sources) {
    const f: SourceRunStats = fetch[s.slug] ?? {};
    const x: SourceRunStats = extract?.sources[s.slug] ?? {};
    const v: SourceRunStats = normalise[s.slug] ?? {};
    const g: SourceRunStats = merge?.sources[s.slug] ?? {};
    const errors = [...(f.errors ?? []), ...(x.errors ?? [])];
    const warnings = [...(f.warnings ?? []), ...(x.warnings ?? [])];
    const st = status[s.slug];
    const health = errors.length ? `❌ ${st?.consecutive_failures ?? 0}×` : warnings.length ? "⚠️" : "✅";
    rows.push(
      `| ${health} | ${s.slug} | ${n(f.documents_fetched)} (${n(f.documents_changed)} changed) | ${n(x.llm_calls)} / ${n(x.llm_skipped)} | ${x.cost_usd ? `$${x.cost_usd.toFixed(3)}` : "·"} | ${n(g.added)} / ${n(g.updated)} / ${n(g.queued)} | ${n(v.events_rejected)} | ${errors.length} |`,
    );
    for (const e of errors) problems.push(`- **${s.slug}** ❌ ${md(e)}`);
    for (const w of warnings.slice(0, 5)) problems.push(`- **${s.slug}** ⚠️ ${md(w)}`);
    if (warnings.length > 5) problems.push(`- **${s.slug}** ⚠️ …and ${warnings.length - 5} more warnings`);
  }

  const totals = extract?.totals ?? {};
  const summary = [
    "## Ingest",
    "",
    `**+${m.added ?? 0} added · ${m.updated ?? 0} updated · ${m.newly_queued ?? 0} newly queued for review · ${m.unconfirmed ?? 0} newly unconfirmed** — ${m.published ?? 0} published, ${m.queue ?? 0} in review queue.`,
    `LLM: ${totals.calls ?? 0} calls, ${totals.skipped ?? 0} documents skipped as unchanged, ~$${(totals.cost ?? 0).toFixed(3)}. Dedupe: ${dedupe?.totals?.fuzzy ?? 0} fuzzy merges.`,
    extract?.fatal ? `\n> [!CAUTION]\n> Extraction aborted: ${md(extract.fatal)}` : "",
    "",
    "| | source | docs fetched | LLM calls / skipped | cost | added / updated / queued | rejected | errors |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    problems.length ? "### Problems\n\n" + problems.join("\n") : "",
  ].join("\n");

  const errorCount = sources.filter((s) => (fetch[s.slug]?.errors?.length ?? 0) + (extract?.sources[s.slug]?.errors?.length ?? 0) > 0).length;
  const message =
    `chore(ingest): +${m.added ?? 0} events, ${m.updated ?? 0} updated, ${m.newly_queued ?? 0} to review` +
    (m.unconfirmed ? `, ${m.unconfirmed} unconfirmed` : "") +
    (errorCount ? ` (${errorCount} source${errorCount === 1 ? "" : "s"} failing)` : "");

  writeText(path.join(PATHS.work, "commit-message.txt"), redact(message) + "\n");
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (out) fs.appendFileSync(out, redact(summary) + "\n");
  else console.log(redact(summary));
  log.info(message);
}

main().catch((err) => log.annotate(`report failed: ${errorMessage(err)}`));
