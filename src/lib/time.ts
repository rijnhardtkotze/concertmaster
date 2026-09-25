/** South Africa: UTC+02:00 all year, no DST. */
export const SAST_OFFSET = "+02:00";

/** Injectable clock so tests and golden runs are deterministic. */
export function now(): Date {
  const fixed = process.env.PIPELINE_NOW;
  return fixed ? new Date(fixed) : new Date();
}

export function nowIso(): string {
  return toSast(now());
}

/** Render an instant as ISO 8601 with an explicit +02:00 offset, second precision. */
export function toSast(d: Date): string {
  const shifted = new Date(d.getTime() + 2 * 3600_000);
  return shifted.toISOString().replace(/\.\d{3}Z$/, SAST_OFFSET);
}

/**
 * Normalise a timestamp from the extractor to +02:00. A value with no offset is
 * read as SAST wall-clock time, which is what every source prints.
 * Returns null for anything unparseable.
 */
export function normaliseTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(v);
  if (!m) return null;
  const [, date, hh = "00", mm = "00", ss = "00", tz] = m as unknown as [string, string, string?, string?, string?, string?];
  // Date() silently rolls 2026-02-30 over to 2 March; refuse anything that isn't a real calendar date/time.
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  if (Number(hh) > 23 || Number(mm) > 59 || Number(ss) > 59) return null;
  const iso = `${date}T${hh}:${mm}:${ss}${tz ? (tz === "Z" ? "Z" : tz.length === 5 ? `${tz.slice(0, 3)}:${tz.slice(3)}` : tz) : SAST_OFFSET}`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return toSast(parsed);
}

/** YYYY-MM-DD of a +02:00 timestamp, i.e. the local date. */
export function localDate(sastIso: string): string {
  return sastIso.slice(0, 10);
}

export function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}
