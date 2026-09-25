import fs from "node:fs";
import path from "node:path";
import { PATHS } from "./config.ts";
import { readJson, writeJson } from "./json.ts";

/** data/manifest.json: one entry per document URL. */
export interface ManifestEntry {
  source: string;
  doc_id: string;
  kind: "html" | "pdf" | "json" | "text";
  etag: string | null;
  last_modified: string | null;
  /** sha256 of the text sent to the extractor (see README: why not the raw bytes). */
  content_hash: string;
  /** sha256 of the raw response body, for reference. */
  raw_hash: string | null;
  /** When content_hash last changed. This is what events carry as source.fetched_at. */
  content_changed_at: string;
  /** Volatile: when we last looked. Ignored when deciding whether a run changed anything. */
  last_fetched: string;
}
export type Manifest = Record<string, ManifestEntry>;

/** data/source-status.json: per-source health and the live document set. */
export interface SourceStatus {
  /** URLs that make up the source's current listing. Events from other documents are treated as gone. */
  documents: string[];
  consecutive_failures: number;
  last_error: string | null;
  last_attempt: string | null;
  last_success: string | null;
}
export type SourceStatusMap = Record<string, SourceStatus>;

export const loadManifest = () => readJson<Manifest>(PATHS.manifest, {});
export const saveManifest = (m: Manifest) => writeJson(PATHS.manifest, m);
export const loadSourceStatus = () => readJson<SourceStatusMap>(PATHS.sourceStatus, {});
export const saveSourceStatus = (s: SourceStatusMap) => writeJson(PATHS.sourceStatus, s);

export function emptyStatus(): SourceStatus {
  return { documents: [], consecutive_failures: 0, last_error: null, last_attempt: null, last_success: null };
}

export function rawPaths(source: string, id: string) {
  const dir = path.join(PATHS.raw, source);
  return { dir, raw: path.join(dir, `${id}.raw`), text: path.join(dir, `${id}.txt`) };
}

export function readDocText(source: string, id: string): string | null {
  const p = rawPaths(source, id).text;
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

export function extractedPath(source: string, id: string) {
  return path.join(PATHS.extracted, source, `${id}.json`);
}

/**
 * Per-stage run statistics, written to .work/stats/<stage>.json and rolled up
 * by the report stage into the step summary and commit message.
 */
export interface SourceRunStats {
  documents_fetched?: number;
  documents_unchanged?: number;
  documents_changed?: number;
  llm_calls?: number;
  llm_skipped?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  events_extracted?: number;
  events_valid?: number;
  events_rejected?: number;
  added?: number;
  updated?: number;
  queued?: number;
  unconfirmed?: number;
  errors?: string[];
  warnings?: string[];
}
export type StageStats = { stage: string; sources: Record<string, SourceRunStats>; totals?: Record<string, number>; fatal?: string };

export function writeStats(stage: string, stats: Omit<StageStats, "stage">) {
  writeJson(path.join(PATHS.stats, `${stage}.json`), { stage, ...stats });
}

export function readStats(stage: string): StageStats | null {
  return readJson<StageStats | null>(path.join(PATHS.stats, `${stage}.json`), null);
}

export function bump(stats: Record<string, SourceRunStats>, source: string, key: keyof SourceRunStats, by = 1) {
  const s = (stats[source] ??= {});
  if (key === "errors" || key === "warnings") return;
  (s[key] as number | undefined) = ((s[key] as number | undefined) ?? 0) + by;
}

export function note(stats: Record<string, SourceRunStats>, source: string, kind: "errors" | "warnings", msg: string) {
  const s = (stats[source] ??= {});
  (s[kind] ??= []).push(msg);
}

/** data/rejects.json: records that failed validation. No descriptions, by design. */
export interface Reject {
  source: string;
  url: string;
  title: string | null;
  start: string | null;
  reasons: string[];
}
