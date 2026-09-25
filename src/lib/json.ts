import fs from "node:fs";
import path from "node:path";
import { redact } from "./log.ts";

/**
 * Deterministic JSON: object keys sorted unless the caller has already put
 * them in a canonical order (see canonicalEvent). Git history is the audit
 * trail, so byte-stable output matters more than anything else here.
 */
export function stableStringify(value: unknown, sortKeys = true): string {
  return JSON.stringify(sortKeys ? sortDeep(value) : value, null, 2) + "\n";
}

export function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) out[k] = sortDeep((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

export function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  const text = fs.readFileSync(file, "utf8");
  if (!text.trim()) return fallback;
  return JSON.parse(text) as T;
}

export function writeJson(file: string, value: unknown, opts: { sortKeys?: boolean } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = stableStringify(value, opts.sortKeys ?? true);
  // Last line of defence: nothing that looks like a credential is ever written.
  if (redact(text) !== text) throw new Error(`refusing to write ${file}: content matches a secret pattern`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export function writeText(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
