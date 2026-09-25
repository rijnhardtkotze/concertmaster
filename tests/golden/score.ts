import type { Event } from "../../src/lib/schema.ts";
import { normalise, titleSimilarity } from "../../src/lib/text.ts";
import { canonicalUrl } from "../../src/lib/url.ts";

/**
 * Per-field scoring of extracted events against hand-labelled expectations.
 *
 * A field is "applicable" for a pair when either side has a value; null vs
 * null is not counted, so an extractor that returns nothing can't score well
 * by agreeing that everything is unknown. List fields get partial credit (F1).
 */
export type Expected = Partial<Omit<Event, "id" | "dedupe_key" | "first_seen" | "last_updated" | "confidence">>;

export interface FieldScore {
  correct: number;
  total: number;
}
export interface CaseScore {
  expected: number;
  actual: number;
  matched: number;
  fields: Record<string, FieldScore>;
  mismatches: string[];
}

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const present = (v: unknown) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
const str = (v: unknown) => (typeof v === "string" ? normalise(v) : v);
const instant = (v: unknown) => (typeof v === "string" ? Date.parse(v) : v);
const url = (v: unknown) => {
  try {
    return typeof v === "string" ? canonicalUrl(v).replace(/\/$/, "") : v;
  } catch {
    return v;
  }
};

function f1(expected: string[], actual: string[]): number {
  if (!expected.length && !actual.length) return 1;
  const a = [...actual];
  let hit = 0;
  for (const e of expected) {
    const i = a.indexOf(e);
    if (i >= 0) {
      hit++;
      a.splice(i, 1);
    }
  }
  const p = actual.length ? hit / actual.length : 0;
  const r = expected.length ? hit / expected.length : 0;
  return p + r ? (2 * p * r) / (p + r) : 0;
}

const get = (o: Any | undefined, path: string) => path.split(".").reduce<Any | undefined>((x, k) => (x == null ? undefined : x[k]), o);

const SCALARS: [string, (v: unknown) => unknown][] = [
  ["title", str],
  ["subtitle", str],
  ["series", str],
  ["presenter", str],
  ["start", instant],
  ["end", instant],
  ["doors", instant],
  ["venue.venue_id", (v) => v],
  ["venue.name", str],
  ["venue.city", str],
  ["venue.province", (v) => v],
  ["tickets.url", url],
  ["tickets.vendor", (v) => v],
  ["tickets.price_min", (v) => v],
  ["tickets.price_max", (v) => v],
  ["tickets.is_free", (v) => v],
  ["status", (v) => v],
  ["sa_content.has_sa_work", (v) => v],
];

export function scorePair(exp: Any, act: Any, add: (field: string, score: number, note?: string) => void) {
  for (const [path, norm] of SCALARS) {
    const e = get(exp, path);
    const a = get(act, path);
    if (!present(e) && !present(a)) continue;
    const ok = norm(e ?? null) === norm(a ?? null);
    add(path, ok ? 1 : 0, ok ? undefined : `${path}: expected ${JSON.stringify(e ?? null)}, got ${JSON.stringify(a ?? null)}`);
  }

  const performers = (x: Any) => ((x.performers as Any[]) ?? []).map((p) => `${normalise(p.name)}|${p.role}`);
  if (present(exp.performers) || present(act.performers)) {
    const s = f1(performers(exp), performers(act));
    add("performers", s, s < 1 ? `performers: expected ${performers(exp).join(", ")}; got ${performers(act).join(", ")}` : undefined);
    for (const p of (exp.performers as Any[]) ?? []) {
      const m = ((act.performers as Any[]) ?? []).find((q) => normalise(q.name) === normalise(p.name));
      if (!m || (!present(p.instrument) && !present(m.instrument))) continue;
      add("performers.instrument", str(p.instrument) === str(m.instrument) ? 1 : 0);
    }
  }

  const composers = (x: Any) => ((x.programme as Any[]) ?? []).map((w) => normalise(w.composer));
  if (present(exp.programme) || present(act.programme)) {
    const s = f1(composers(exp), composers(act));
    add("programme.composer", s, s < 1 ? `programme.composer: expected ${composers(exp).join(", ")}; got ${composers(act).join(", ")}` : undefined);
    const pool = [...((act.programme as Any[]) ?? [])];
    for (const w of (exp.programme as Any[]) ?? []) {
      const i = pool.findIndex((x) => normalise(x.composer) === normalise(w.composer) && titleSimilarity(x.work, w.work) >= 0.6);
      add("programme.work", i >= 0 ? 1 : 0, i >= 0 ? undefined : `programme.work missing: ${w.composer} — ${w.work}`);
      if (i < 0) continue;
      const m = pool.splice(i, 1)[0]!;
      if (present(w.catalogue) || present(m.catalogue)) {
        const ok = str(w.catalogue ?? null) === str(m.catalogue ?? null);
        add("programme.catalogue", ok ? 1 : 0, ok ? undefined : `programme.catalogue for ${w.work}: expected ${w.catalogue ?? null}, got ${m.catalogue ?? null}`);
      }
    }
  }

  for (const path of ["genre_tags", "sa_content.sa_composers"]) {
    const e = (get(exp, path) as string[] | undefined) ?? [];
    const a = (get(act, path) as string[] | undefined) ?? [];
    if (!e.length && !a.length) continue;
    const s = f1(e.map(normalise), a.map(normalise));
    add(path, s, s < 1 ? `${path}: expected ${e.join(", ") || "[]"}; got ${a.join(", ") || "[]"}` : undefined);
  }

  // Descriptions are free text: score only that one exists when expected, and never when it shouldn't.
  if ("description" in exp) add("description.present", present(exp.description) === present(act.description) ? 1 : 0);
}

/** Pair expected with actual events by local date, then best title match (greedy). */
export function scoreCase(expected: Expected[], actual: Event[]): CaseScore {
  const fields: Record<string, FieldScore> = {};
  const mismatches: string[] = [];
  const pool = [...actual];
  let matched = 0;
  for (const exp of expected) {
    const date = exp.start?.slice(0, 10);
    let best = -1;
    let bestScore = 0.3;
    pool.forEach((a, i) => {
      if (a.start.slice(0, 10) !== date) return;
      const s = Math.max(titleSimilarity(a.title, exp.title ?? ""), exp.series ? titleSimilarity(a.title, exp.series) : 0);
      if (s > bestScore || (best < 0 && s >= bestScore)) {
        best = i;
        bestScore = s;
      }
    });
    if (best < 0) {
      mismatches.push(`missing event: ${exp.start} ${exp.title}`);
      continue;
    }
    matched++;
    const act = pool.splice(best, 1)[0]!;
    scorePair(exp as Any, act as Any, (field, score, note) => {
      const f = (fields[field] ??= { correct: 0, total: 0 });
      f.correct += score;
      f.total += 1;
      if (note) mismatches.push(`[${exp.title}] ${note}`);
    });
  }
  for (const a of pool) mismatches.push(`unexpected event: ${a.start} ${a.title}`);
  return { expected: expected.length, actual: actual.length, matched, fields, mismatches };
}

export function combine(scores: CaseScore[]) {
  const fields: Record<string, FieldScore> = {};
  let expected = 0;
  let actual = 0;
  let matched = 0;
  for (const s of scores) {
    expected += s.expected;
    actual += s.actual;
    matched += s.matched;
    for (const [k, v] of Object.entries(s.fields)) {
      const f = (fields[k] ??= { correct: 0, total: 0 });
      f.correct += v.correct;
      f.total += v.total;
    }
  }
  return {
    events: { expected, actual, matched, recall: expected ? matched / expected : 1, precision: actual ? matched / actual : 1 },
    fields: Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, { ...v, accuracy: v.total ? v.correct / v.total : 1 }])),
  };
}
