import fs from "node:fs";
import { PATHS } from "./config.ts";
import { sha256 } from "./hash.ts";

/**
 * The system prompt is the fenced block under "## System prompt" in
 * extraction-prompt.md. Reading it from the markdown keeps one source of truth:
 * edit the doc, and the next run (and the golden set) uses the new prompt.
 */
export function loadSystemPrompt(file = PATHS.prompt): string {
  const md = fs.readFileSync(file, "utf8");
  const section = md.split(/^## System prompt\s*$/m)[1];
  if (!section) throw new Error(`${file}: no "## System prompt" section`);
  const m = /```[a-z]*\n([\s\S]*?)\n```/.exec(section);
  if (!m?.[1]) throw new Error(`${file}: no fenced block under "## System prompt"`);
  return m[1].trim();
}

/** Short fingerprint recorded on every extraction, so you can see which prompt produced which record. */
export function promptVersion(prompt = loadSystemPrompt()): string {
  return sha256(prompt).slice(0, 12);
}

export interface DocumentHeader {
  source: string;
  url: string;
  fetchedAt: string;
  documentType: string;
  hint?: string;
  chunk?: { index: number; total: number };
}

/** The per-document part of the user message (see extraction-prompt.md, "User message format"). */
export function documentBlock(h: DocumentHeader, text: string): string {
  const lines = [`SOURCE: ${h.source}`, `URL: ${h.url}`, `FETCHED_AT: ${h.fetchedAt}`, `DOCUMENT_TYPE: ${h.documentType}`];
  if (h.chunk && h.chunk.total > 1) {
    lines.push(`CHUNK: ${h.chunk.index + 1} of ${h.chunk.total} (extract only the Performances described in this chunk)`);
  }
  if (h.hint) lines.push(`SOURCE_NOTE: ${h.hint}`);
  return `${lines.join("\n")}\n\n---\n${text}`;
}

/**
 * The reference block: the Venue table and `COMPOSERS_ZA`, the curated list of
 * South African Composers, so the model keeps those names spelled as the list has
 * them. Sent as the first, cacheable block of the user message: identical across
 * every call in a run, so it sits in the cached prefix with the system prompt.
 */
export function referenceBlock(venues: unknown[], composersZa: string[]): string {
  return `VENUE_TABLE:\n${JSON.stringify(venues)}\n\nCOMPOSERS_ZA:\n${JSON.stringify(composersZa)}`;
}
