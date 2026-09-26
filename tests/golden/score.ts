import type { ExtractedPerformance } from "../../src/lib/extraction-schema.ts";
import { normalise, titleSimilarity } from "../../src/lib/text.ts";
import { canonicalUrl } from "../../src/lib/url.ts";

/**
 * Per-field scoring of extracted Performances (the v2 extraction shape) against
 * hand-labelled expectations.
 *
 * A field is "applicable" for a pair when either side has a value; null vs null
 * is not counted, so an extractor that returns nothing can't score well by
 * agreeing that everything is unknown. List fields get partial credit (F1).
 */
type DeepPartial<T> = T extends (infer U)[] ? DeepPartial<U>[] : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/** An expected record: the extraction shape, minus confidence, needs_review and extraction_notes. */
export type Expected = DeepPartial<Pick<ExtractedPerformance, "production" | "performance">>;

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
const same = (v: unknown) => v;
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
  ["production.title", str],
  ["production.genre", same],
  ["production.series", str],
  ["production.season", str],
  ["production.presenter", str],
  ["performance.start_date", same],
  ["performance.start_time", same],
  ["performance.doors_time", same],
  ["performance.venue.name", str],
  ["performance.venue.city", str],
  ["performance.venue.province", same],
  ["performance.status", same],
  ["performance.ticket_url", url],
];

const list = (x: Any, path: string) => (get(x, path) as Any[] | undefined) ?? [];
const works = (x: Any) => list(x, "production.programme").filter((i) => i.kind === "work");
const intervals = (x: Any) => list(x, "production.programme").filter((i) => i.kind === "interval").length;

export function scorePair(exp: Any, act: Any, add: (field: string, score: number, note?: string) => void) {
  for (const [path, norm] of SCALARS) {
    const e = get(exp, path);
    const a = get(act, path);
    if (!present(e) && !present(a)) continue;
    const ok = norm(e ?? null) === norm(a ?? null);
    add(path, ok ? 1 : 0, ok ? undefined : `${path}: expected ${JSON.stringify(e ?? null)}, got ${JSON.stringify(a ?? null)}`);
  }

  // Credits: who, as what, then instrument and locale for each Credit found on both sides.
  const credits = (x: Any) => list(x, "production.credits").map((c) => `${normalise(c.name ?? "")}|${c.kind}|${c.role}`);
  if (present(get(exp, "production.credits")) || present(get(act, "production.credits"))) {
    const s = f1(credits(exp), credits(act));
    add("production.credits", s, s < 1 ? `production.credits: expected ${credits(exp).join(", ")}; got ${credits(act).join(", ")}` : undefined);
    for (const c of list(exp, "production.credits")) {
      const m = list(act, "production.credits").find((q) => normalise(q.name ?? "") === normalise(c.name ?? ""));
      if (!m) continue;
      for (const field of ["instrument", "locale"] as const) {
        if (!present(c[field]) && !present(m[field])) continue;
        const ok = str(c[field] ?? null) === str(m[field] ?? null);
        add(`production.credits.${field}`, ok ? 1 : 0, ok ? undefined : `production.credits.${field} for ${c.name}: expected ${c[field] ?? null}, got ${m[field] ?? null}`);
      }
    }
  }

  // Programme: which Composers, which Works, then each matched Work's details, then intervals.
  const composers = (x: Any) => works(x).map((w) => normalise(w.composer ?? ""));
  if (present(get(exp, "production.programme")) || present(get(act, "production.programme"))) {
    const s = f1(composers(exp), composers(act));
    add("production.programme.composer", s, s < 1 ? `production.programme.composer: expected ${composers(exp).join(", ")}; got ${composers(act).join(", ")}` : undefined);
    const pool = works(act);
    for (const w of works(exp)) {
      const i = pool.findIndex((x) => normalise(x.composer ?? "") === normalise(w.composer ?? "") && titleSimilarity(x.title ?? "", w.title ?? "") >= 0.6);
      add("production.programme.work", i >= 0 ? 1 : 0, i >= 0 ? undefined : `production.programme.work missing: ${w.composer} — ${w.title}`);
      if (i < 0) continue;
      const m = pool.splice(i, 1)[0]!;
      for (const field of ["catalogue", "premiere"] as const) {
        if (!present(w[field]) && !present(m[field])) continue;
        const ok = str(w[field] ?? null) === str(m[field] ?? null);
        add(`production.programme.${field}`, ok ? 1 : 0, ok ? undefined : `production.programme.${field} for ${w.title}: expected ${w[field] ?? null}, got ${m[field] ?? null}`);
      }
    }
    if (intervals(exp) || intervals(act)) {
      const ok = intervals(exp) === intervals(act);
      add("production.programme.interval", ok ? 1 : 0, ok ? undefined : `production.programme.interval: expected ${intervals(exp)}, got ${intervals(act)}`);
    }
  }

  const listFields: [string, (x: Any) => string[]][] = [
    ["production.languages", (x) => (list(x, "production.languages") as unknown as string[]).map(normalise)],
    ["performance.price_tiers", (x) => list(x, "performance.price_tiers").map((t) => String(t.amount))],
  ];
  for (const [path, values] of listFields) {
    const [e, a] = [values(exp), values(act)];
    if (!e.length && !a.length) continue;
    const s = f1(e, a);
    add(path, s, s < 1 ? `${path}: expected ${e.join(", ") || "[]"}; got ${a.join(", ") || "[]"}` : undefined);
  }

  // Descriptions are free text: score only that one exists when expected, and never when it shouldn't.
  if (exp.production && "description" in exp.production) {
    add("production.description.present", present(exp.production.description) === present(get(act, "production.description")) ? 1 : 0);
  }
}

const titleOf = (x: Any) => (get(x, "production.title") as string | undefined) ?? "";
const dateOf = (x: Any) => get(x, "performance.start_date") as string | null | undefined;

/** Pair expected with actual Performances by start date, then best title match (greedy). */
export function scoreCase(expected: Expected[], actual: ExtractedPerformance[]): CaseScore {
  const fields: Record<string, FieldScore> = {};
  const mismatches: string[] = [];
  const pool = [...actual];
  let matched = 0;
  for (const exp of expected as Any[]) {
    const date = dateOf(exp);
    const series = get(exp, "production.series") as string | undefined;
    let best = -1;
    let bestScore = 0.3;
    pool.forEach((a, i) => {
      if (dateOf(a) !== date) return;
      const s = Math.max(titleSimilarity(titleOf(a), titleOf(exp)), series ? titleSimilarity(titleOf(a), series) : 0);
      if (s > bestScore || (best < 0 && s >= bestScore)) {
        best = i;
        bestScore = s;
      }
    });
    if (best < 0) {
      mismatches.push(`missing Performance: ${date} ${titleOf(exp)}`);
      continue;
    }
    matched++;
    const act = pool.splice(best, 1)[0]!;
    scorePair(exp, act as Any, (field, score, note) => {
      const f = (fields[field] ??= { correct: 0, total: 0 });
      f.correct += score;
      f.total += 1;
      if (note) mismatches.push(`[${titleOf(exp)}] ${note}`);
    });
  }
  for (const a of pool) mismatches.push(`unexpected Performance: ${dateOf(a)} ${titleOf(a)}`);
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
    performances: { expected, actual, matched, recall: expected ? matched / expected : 1, precision: actual ? matched / actual : 1 },
    fields: Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, { ...v, accuracy: v.total ? v.correct / v.total : 1 }])),
  };
}
