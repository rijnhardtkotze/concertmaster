import fs from "node:fs";
import path from "node:path";
import { EXTRACT, PATHS } from "../lib/config.ts";
import { readExtracted, removeExtracted, writeExtracted, type ExtractedFile } from "../lib/extracted.ts";
import { copiedSpan, sourceShingles } from "../lib/guard.ts";
import { docId } from "../lib/hash.ts";
import { callExtractor, extractBackend, FatalLlmError } from "../lib/llm.ts";
import { errorMessage, logger } from "../lib/log.ts";
import { documentBlock, loadSystemPrompt, promptVersion, referenceBlock } from "../lib/prompt.ts";
import { loadComposers, loadVenues, venuesForPrompt } from "../lib/reference.ts";
import { loadSources, parseArgs, type SourceConfig } from "../lib/sources.ts";
import { bump, loadManifest, loadSourceStatus, note, readDocText, writeStats, type ManifestEntry, type SourceRunStats } from "../lib/state.ts";
import { chunkText } from "../lib/text.ts";
import { nowIso } from "../lib/time.ts";

const log = logger("extract");

export interface ExtractContext {
  system: string;
  tables: string;
  version: string;
}

export function modelFor(source: Pick<SourceConfig, "model">, kind: ManifestEntry["kind"]): string {
  if (source.model === "strong" || kind === "pdf") return EXTRACT.strongModel;
  return EXTRACT.fastModel;
}

/**
 * Extract one document: chunk, call, merge arrays, apply the copyright guard.
 * Exported for the golden-set harness, which runs exactly this path. Each record
 * is one Performance in the v2 extraction shape (extraction-schema.ts); the
 * description the guard checks is its Production's.
 */
export async function extractDocument(
  ctx: ExtractContext,
  doc: { source: SourceConfig; url: string; kind: ManifestEntry["kind"]; fetchedAt: string; text: string },
  onCall?: (r: Awaited<ReturnType<typeof callExtractor>>) => void,
  signal?: AbortSignal,
) {
  const model = modelFor(doc.source, doc.kind);
  const chunks = chunkText(doc.text, EXTRACT.chunkChars);
  const performances: Record<string, unknown>[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const block = documentBlock(
      { source: doc.source.slug, url: doc.url, fetchedAt: doc.fetchedAt, documentType: doc.kind, hint: doc.source.hint, chunk: { index: i, total: chunks.length } },
      chunks[i]!,
    );
    signal?.throwIfAborted();
    const r = await callExtractor({ model, system: ctx.system, tables: ctx.tables, document: block, signal });
    onCall?.(r);
    performances.push(...(r.performances as Record<string, unknown>[]));
  }
  const shingles = sourceShingles(doc.text);
  const guard_failures: ExtractedFile["guard_failures"] = [];
  performances.forEach((p, index) => {
    const production = p.production as Record<string, unknown> | null | undefined;
    const span = copiedSpan((production?.description as string | null | undefined) ?? null, shingles);
    if (span && production) {
      guard_failures.push({ index, reason: `description shares a 12-word span with the source ("${span.slice(0, 40)}…")` });
      production.description = null; // never persist copied text
    }
  });
  return { model, chunks: chunks.length, performances, guard_failures };
}

/**
 * Skip, retry or park a document. "current": already extracted at this content hash with
 * this prompt. "refresh": same content, but extracted under an older prompt; re-extracted
 * with whatever call budget is left after changed documents. "parked": this content hash
 * has failed maxAttemptsPerHash times; left alone until the page changes again (or --force).
 */
export function planExtraction(existing: ExtractedFile | null, contentHash: string, force = false, promptVersion?: string) {
  const current = existing?.status === "ok" && existing.content_hash === contentHash && !existing.retry;
  const failures = existing?.retry?.content_hash === contentHash ? existing.retry.attempts : 0;
  if (force) return { action: "extract" as const, failures };
  if (current && promptVersion && existing.prompt_version !== promptVersion) return { action: "refresh" as const, failures };
  if (current) return { action: "current" as const, failures };
  if (failures >= EXTRACT.maxAttemptsPerHash) return { action: "parked" as const, failures };
  return { action: "extract" as const, failures };
}

/**
 * What to write when extraction fails. A previous good extraction is kept as-is (its
 * events stay live) with the failure noted under `retry`; with nothing to keep, an empty
 * error record is written. Either way the attempt count is tied to this content hash.
 */
export function failureRecord(
  existing: ExtractedFile | null,
  f: { url: string; source: string; entry: ManifestEntry; error: string; failures: number; promptVersion: string },
): ExtractedFile {
  const retry = { content_hash: f.entry.content_hash, attempts: f.failures + 1, error: f.error, at: nowIso() };
  if (existing?.status === "ok") return { ...existing, retry };
  return {
    url: f.url,
    source: f.source,
    content_hash: f.entry.content_hash,
    fetched_at: f.entry.content_changed_at,
    status: "error",
    error: f.error,
    attempts: f.failures + 1,
    prompt_version: f.promptVersion,
    events: [],
    guard_failures: [],
    retry,
  };
}

/**
 * The extract stage's wall-clock budget. Once `expired()`, no new document should start;
 * `signal` aborts calls still running `graceMs` later, so one slow document can't carry
 * the stage past the job timeout.
 */
export function createBudget(ms: number, graceMs: number, now: () => number = Date.now) {
  const deadline = now() + ms;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("extract time budget exceeded")), ms + graceMs);
  timer.unref();
  return { expired: () => now() >= deadline, signal: controller.signal, dispose: () => clearTimeout(timer) };
}

/**
 * Run `run` over `items` with up to `concurrency` in flight. Once the budget has expired,
 * nothing new starts (work already running finishes). Returns the items never started.
 */
export async function runQueue<T>(items: T[], concurrency: number, budget: { expired: () => boolean }, run: (item: T) => Promise<void>): Promise<T[]> {
  const queue = [...items];
  const deferred: T[] = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        if (budget.expired()) deferred.push(item);
        else await run(item);
      }
    }),
  );
  return deferred;
}

async function main() {
  const args = parseArgs();
  const sources = await loadSources(args.source);
  const manifest = loadManifest();
  const status = loadSourceStatus();
  const system = loadSystemPrompt();
  const ctx: ExtractContext = {
    system,
    version: promptVersion(system),
    tables: referenceBlock(venuesForPrompt(loadVenues()), loadComposers()),
  };
  const stats: Record<string, SourceRunStats> = {};
  let callsLeft = EXTRACT.maxCallsPerRun;
  const budget = createBudget(EXTRACT.timeBudgetMs, EXTRACT.overrunGraceMs);
  let timeDeferred = 0;
  let done = 0;
  let fatal: string | undefined;

  type Job = { source: SourceConfig; url: string; entry: ManifestEntry; existing: ExtractedFile | null; failures: number; refresh?: boolean };
  const jobs: Job[] = [];
  const refreshes: Job[] = [];
  for (const source of sources) {
    stats[source.slug] ??= {};
    const live = new Set(status[source.slug]?.documents ?? []);
    for (const url of live) {
      const entry = manifest[url];
      if (!entry) continue;
      const existing = readExtracted(source.slug, entry.doc_id);
      const { action, failures } = planExtraction(existing, entry.content_hash, args.force, ctx.version);
      if (action === "refresh") {
        refreshes.push({ source, url, entry, existing, failures, refresh: true });
        continue;
      }
      if (action !== "extract") {
        bump(stats, source.slug, "llm_skipped");
        if (action === "parked") note(stats, source.slug, "warnings", `parked after ${failures} failed attempts: ${url}${existing?.status === "ok" ? " (previous extraction still live)" : ""}`);
        continue;
      }
      jobs.push({ source, url, entry, existing, failures });
    }
    // Extractions for documents that are no longer part of the source's listing are dropped.
    const dir = path.join(PATHS.extracted, source.slug);
    const liveIds = new Set([...live].map(docId));
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        const id = f.replace(/\.json$/, "");
        if (!liveIds.has(id)) removeExtracted(source.slug, id);
      }
    }
  }

  // Pages whose content changed come first; re-extractions after a prompt edit use what's
  // left of the call budget, so a prompt change rolls through over a few runs.
  if (refreshes.length) log.info(`${refreshes.length} unchanged documents were extracted under an older prompt; refreshing as budget allows`);
  jobs.push(...refreshes);
  let refreshDeferred = 0;

  const runJob = async ({ source, url, entry, existing, failures, refresh }: Job) => {
    const text = readDocText(source.slug, entry.doc_id);
    if (text === null) {
      note(stats, source.slug, "warnings", `no cached text for ${url} (source not fetched this run?)`);
      return;
    }
    const chunkCount = chunkText(text, EXTRACT.chunkChars).length;
    if (callsLeft < chunkCount) {
      if (refresh) refreshDeferred++;
      else note(stats, source.slug, "warnings", `LLM call budget for this run exhausted; ${url} deferred`);
      return;
    }
    if (refresh) bump(stats, source.slug, "llm_refreshed");
    callsLeft -= chunkCount;
    try {
      const r = await extractDocument(ctx, { source, url, kind: entry.kind, fetchedAt: entry.content_changed_at, text }, (call) => {
        bump(stats, source.slug, "llm_calls");
        bump(stats, source.slug, "input_tokens", call.inputTokens);
        bump(stats, source.slug, "output_tokens", call.outputTokens);
        bump(stats, source.slug, "cost_usd", call.costUsd);
      }, budget.signal);
      writeExtracted(source.slug, entry.doc_id, {
        url,
        source: source.slug,
        content_hash: entry.content_hash,
        fetched_at: entry.content_changed_at,
        status: "ok",
        attempts: failures + 1,
        model: r.model,
        prompt_version: ctx.version,
        extracted_at: nowIso(),
        chunks: r.chunks,
        events: r.performances,
        guard_failures: r.guard_failures,
      });
      bump(stats, source.slug, "events_extracted", r.performances.length);
      if (++done % 25 === 0) log.info(`${done} documents extracted so far`);
    } catch (err) {
      if (err instanceof FatalLlmError) throw err;
      // Cut off by the time budget: not the document's fault, so no failure is recorded
      // against it; it is simply extracted by a later run.
      if (budget.signal.aborted) {
        timeDeferred++;
        return;
      }
      const msg = errorMessage(err);
      note(stats, source.slug, "errors", `${url}: ${msg}`);
      log.annotate(`${source.slug}: extraction failed for ${url}: ${msg}`);
      // Record the failure against this content hash so a permanently broken document is
      // retried a bounded number of times, not every day forever. A previous good
      // extraction stays in place (and its events stay live) until a retry succeeds.
      writeExtracted(source.slug, entry.doc_id, failureRecord(existing, { url, source: source.slug, entry, error: msg, failures, promptVersion: ctx.version }));
    }
  };

  try {
    // Fail fast (and loudly) with no credentials, but only if there is work to do.
    const backend = jobs.length ? extractBackend() : "api";
    if (jobs.length) log.info(`${jobs.length} documents to extract via ${backend === "subscription" ? "Claude subscription (Claude Code)" : "Anthropic API"}`);
    // Subscription usage shares limits with interactive use; go easy on it.
    const concurrency = backend === "subscription" ? 1 : EXTRACT.concurrency;
    timeDeferred += (await runQueue(jobs, concurrency, budget, runJob)).length;
  } catch (err) {
    fatal = errorMessage(err);
    log.error(`aborting: ${fatal}`);
  } finally {
    budget.dispose();
  }

  if (timeDeferred) log.warn(`time budget (${EXTRACT.timeBudgetMs / 60_000} min) used up; ${timeDeferred} documents left for later runs`);
  if (refreshDeferred) log.info(`${refreshDeferred} prompt refreshes left for later runs (call budget)`);
  const totals = Object.values(stats).reduce(
    (t, s) => ({ calls: t.calls + (s.llm_calls ?? 0), skipped: t.skipped + (s.llm_skipped ?? 0), cost: t.cost + (s.cost_usd ?? 0) }),
    { calls: 0, skipped: 0, cost: 0 },
  );
  log.info(`${totals.calls} LLM calls made, ${totals.skipped} documents skipped (content unchanged), ~$${totals.cost.toFixed(3)} API spend`);
  writeStats("extract", { sources: stats, totals, fatal });
  if (fatal) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log.error(errorMessage(err));
    process.exit(1);
  });
}
