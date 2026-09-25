import fs from "node:fs";
import path from "node:path";
import { EXTRACT, PATHS } from "../lib/config.ts";
import { readExtracted, removeExtracted, writeExtracted, type ExtractedFile } from "../lib/extracted.ts";
import { copiedSpan, sourceShingles } from "../lib/guard.ts";
import { docId } from "../lib/hash.ts";
import { callExtractor, FatalLlmError } from "../lib/llm.ts";
import { errorMessage, logger } from "../lib/log.ts";
import { documentBlock, loadSystemPrompt, promptVersion, tablesBlock } from "../lib/prompt.ts";
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
 * Exported for the golden-set harness, which runs exactly this path.
 */
export async function extractDocument(
  ctx: ExtractContext,
  doc: { source: SourceConfig; url: string; kind: ManifestEntry["kind"]; fetchedAt: string; text: string },
  onCall?: (r: Awaited<ReturnType<typeof callExtractor>>) => void,
) {
  const model = modelFor(doc.source, doc.kind);
  const chunks = chunkText(doc.text, EXTRACT.chunkChars);
  const events: Record<string, unknown>[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const block = documentBlock(
      { source: doc.source.slug, url: doc.url, fetchedAt: doc.fetchedAt, documentType: doc.kind, hint: doc.source.hint, chunk: { index: i, total: chunks.length } },
      chunks[i]!,
    );
    const r = await callExtractor({ model, system: ctx.system, tables: ctx.tables, document: block });
    onCall?.(r);
    events.push(...(r.events as Record<string, unknown>[]));
  }
  const shingles = sourceShingles(doc.text);
  const guard_failures: ExtractedFile["guard_failures"] = [];
  events.forEach((e, index) => {
    const span = copiedSpan(e.description as string | null, shingles);
    if (span) {
      guard_failures.push({ index, reason: `description shares a 12-word span with the source ("${span.slice(0, 40)}…")` });
      e.description = null; // never persist copied text
    }
  });
  return { model, chunks: chunks.length, events, guard_failures };
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
    tables: tablesBlock(venuesForPrompt(loadVenues()), loadComposers()),
  };
  const stats: Record<string, SourceRunStats> = {};
  let callsLeft = EXTRACT.maxCallsPerRun;
  let fatal: string | undefined;

  type Job = { source: SourceConfig; url: string; entry: ManifestEntry; existing: ExtractedFile | null };
  const jobs: Job[] = [];
  for (const source of sources) {
    stats[source.slug] ??= {};
    const live = new Set(status[source.slug]?.documents ?? []);
    for (const url of live) {
      const entry = manifest[url];
      if (!entry) continue;
      const existing = readExtracted(source.slug, entry.doc_id);
      const sameContent = existing?.content_hash === entry.content_hash;
      const settled = existing?.status === "ok" || (existing?.attempts ?? 0) >= EXTRACT.maxAttemptsPerHash;
      if (sameContent && settled && !args.force) {
        bump(stats, source.slug, "llm_skipped");
        if (existing?.status === "error") note(stats, source.slug, "warnings", `parked after ${existing.attempts} failed attempts: ${url}`);
        continue;
      }
      jobs.push({ source, url, entry, existing: sameContent ? existing : null });
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

  const runJob = async ({ source, url, entry, existing }: Job) => {
    const text = readDocText(source.slug, entry.doc_id);
    if (text === null) {
      note(stats, source.slug, "warnings", `no cached text for ${url} (source not fetched this run?)`);
      return;
    }
    const chunkCount = chunkText(text, EXTRACT.chunkChars).length;
    if (callsLeft < chunkCount) {
      note(stats, source.slug, "warnings", `LLM call budget for this run exhausted; ${url} deferred`);
      return;
    }
    callsLeft -= chunkCount;
    try {
      const r = await extractDocument(ctx, { source, url, kind: entry.kind, fetchedAt: entry.content_changed_at, text }, (call) => {
        bump(stats, source.slug, "llm_calls");
        bump(stats, source.slug, "input_tokens", call.inputTokens);
        bump(stats, source.slug, "output_tokens", call.outputTokens);
        bump(stats, source.slug, "cost_usd", call.costUsd);
      });
      writeExtracted(source.slug, entry.doc_id, {
        url,
        source: source.slug,
        content_hash: entry.content_hash,
        fetched_at: entry.content_changed_at,
        status: "ok",
        attempts: (existing?.attempts ?? 0) + 1,
        model: r.model,
        prompt_version: ctx.version,
        extracted_at: nowIso(),
        chunks: r.chunks,
        events: r.events,
        guard_failures: r.guard_failures,
      });
      bump(stats, source.slug, "events_extracted", r.events.length);
    } catch (err) {
      if (err instanceof FatalLlmError) throw err;
      const msg = errorMessage(err);
      note(stats, source.slug, "errors", `${url}: ${msg}`);
      log.annotate(`${source.slug}: extraction failed for ${url}: ${msg}`);
      // Record the failure against this content hash so a permanently broken
      // document is retried a bounded number of times, not every day forever.
      writeExtracted(source.slug, entry.doc_id, {
        url,
        source: source.slug,
        content_hash: entry.content_hash,
        fetched_at: entry.content_changed_at,
        status: "error",
        error: msg,
        attempts: (existing?.attempts ?? 0) + 1,
        prompt_version: ctx.version,
        events: [],
        guard_failures: [],
      });
    }
  };

  try {
    const queue = [...jobs];
    await Promise.all(
      Array.from({ length: Math.min(EXTRACT.concurrency, queue.length) }, async () => {
        for (let j = queue.shift(); j; j = queue.shift()) await runJob(j);
      }),
    );
  } catch (err) {
    fatal = errorMessage(err);
    log.error(`aborting: ${fatal}`);
  }

  const totals = Object.values(stats).reduce(
    (t, s) => ({ calls: t.calls + (s.llm_calls ?? 0), skipped: t.skipped + (s.llm_skipped ?? 0), cost: t.cost + (s.cost_usd ?? 0) }),
    { calls: 0, skipped: 0, cost: 0 },
  );
  log.info(`${totals.calls} LLM calls made, ${totals.skipped} documents skipped (content unchanged), ~$${totals.cost.toFixed(3)}`);
  writeStats("extract", { sources: stats, totals, fatal });
  if (fatal) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    log.error(errorMessage(err));
    process.exit(1);
  });
}
