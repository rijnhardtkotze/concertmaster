import type { Sql } from "./db.ts";
import type { SourceRole } from "./sources.ts";
import { SAST_OFFSET, toSast } from "./time.ts";

/** A row of the Source table: who the Source is, and its health. Config stays in sources/. */
export interface SourceRow {
  slug: string;
  name: string;
  role: SourceRole;
  consecutive_failures: number;
  last_error: string | null;
  /** SAST, with an explicit +02:00 offset. */
  last_attempt: string | null;
  /** SAST, with an explicit +02:00 offset. */
  last_success: string | null;
}

interface DbSourceRow {
  slug: string;
  name: string;
  role: SourceRole;
  consecutive_failures: number;
  last_error: string | null;
  last_attempt: Date | null;
  last_success: Date | null;
}

function requireSast(field: string, value: string | null): string | null {
  if (value === null) return null;
  if (!value.endsWith(SAST_OFFSET) || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`Source ${field} must be an ISO timestamp with a ${SAST_OFFSET} offset, got ${JSON.stringify(value)}`);
  }
  return value;
}

function fromDb(row: DbSourceRow): SourceRow {
  return {
    slug: row.slug,
    name: row.name,
    role: row.role,
    consecutive_failures: row.consecutive_failures,
    last_error: row.last_error,
    last_attempt: row.last_attempt ? toSast(row.last_attempt) : null,
    last_success: row.last_success ? toSast(row.last_success) : null,
  };
}

/** Insert the Source, or replace its name, Source role and health. Returns the stored row. */
export async function upsertSource(sql: Sql, source: SourceRow): Promise<SourceRow> {
  const lastAttempt = requireSast("last_attempt", source.last_attempt);
  const lastSuccess = requireSast("last_success", source.last_success);
  const [row] = await sql<DbSourceRow[]>`
    insert into public.source (slug, name, role, consecutive_failures, last_error, last_attempt, last_success)
    values (
      ${source.slug}, ${source.name}, ${source.role}::public.source_role, ${source.consecutive_failures},
      ${source.last_error}, ${lastAttempt}::timestamptz, ${lastSuccess}::timestamptz
    )
    on conflict (slug) do update set
      name = excluded.name,
      role = excluded.role,
      consecutive_failures = excluded.consecutive_failures,
      last_error = excluded.last_error,
      last_attempt = excluded.last_attempt,
      last_success = excluded.last_success
    returning slug, name, role, consecutive_failures, last_error, last_attempt, last_success
  `;
  if (!row) throw new Error(`Upserting Source ${source.slug} returned no row`);
  return fromDb(row);
}

export async function readSource(sql: Sql, slug: string): Promise<SourceRow | null> {
  const [row] = await sql<DbSourceRow[]>`
    select slug, name, role, consecutive_failures, last_error, last_attempt, last_success
    from public.source
    where slug = ${slug}
  `;
  return row ? fromDb(row) : null;
}
