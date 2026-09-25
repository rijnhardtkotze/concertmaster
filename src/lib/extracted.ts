import fs from "node:fs";
import { readJson, writeJson } from "./json.ts";
import { extractedPath } from "./state.ts";

/**
 * data/extracted/<source>/<doc_id>.json — the model's output for one document
 * at one content hash. Committed: these are derived records, not source pages,
 * and keeping them in git means normalise/dedupe/merge can be re-run at any
 * time without an API call, and a lost Actions cache costs nothing.
 *
 * Descriptions that fail the copyright guard are removed *before* this file is
 * written, so copied text never reaches the public repo.
 */
export interface ExtractedFile {
  url: string;
  source: string;
  content_hash: string;
  fetched_at: string;
  status: "ok" | "error";
  error?: string;
  attempts: number;
  model?: string;
  prompt_version?: string;
  extracted_at?: string;
  chunks?: number;
  events: Record<string, unknown>[];
  /** Index into `events` → reason. Normalise rejects these records outright. */
  guard_failures: { index: number; reason: string }[];
}

export const readExtracted = (source: string, id: string) => readJson<ExtractedFile | null>(extractedPath(source, id), null);
export const writeExtracted = (source: string, id: string, f: ExtractedFile) => writeJson(extractedPath(source, id), f);
export const removeExtracted = (source: string, id: string) => fs.rmSync(extractedPath(source, id), { force: true });
