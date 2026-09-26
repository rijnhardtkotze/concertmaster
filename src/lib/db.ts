import postgres from "postgres";

/**
 * The pipeline's Postgres connection (ADR 0014). It connects directly with a
 * connection string, never supabase-js or the service key.
 *
 * - In Actions, DATABASE_URL is the Supabase pooler connection string, held as a
 *   repository secret. Its role bypasses row-level security, so it never reaches
 *   the site's build.
 * - Locally, it is the local Supabase stack's Postgres (see LOCAL_DATABASE_URL).
 */
export const DATABASE_URL_ENV = "DATABASE_URL";

/** The database `supabase start` runs, with the CLI's fixed local credentials. */
export const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export type Sql = postgres.Sql;

export interface ConnectOptions {
  /** Defaults to the DATABASE_URL environment variable. */
  url?: string;
  /** Pool size. The stages run one at a time, so a few connections are plenty. */
  max?: number;
}

export function databaseUrl(): string {
  const url = process.env[DATABASE_URL_ENV];
  if (!url) {
    throw new Error(
      `${DATABASE_URL_ENV} is not set. Locally, run \`supabase start\` and use ${LOCAL_DATABASE_URL}; in Actions it comes from the repository secret.`,
    );
  }
  return url;
}

export function connect(opts: ConnectOptions = {}): Sql {
  return postgres(opts.url ?? databaseUrl(), {
    max: opts.max ?? 4,
    // The Supabase pooler in transaction mode can't keep prepared statements
    // across transactions. Unnamed statements work in either pooler mode.
    prepare: false,
    // Listing and source times are SAST (+02:00, no DST). Anything the session
    // renders as text, in SQL or in psql, carries that offset too.
    connection: { TimeZone: "Africa/Johannesburg", application_name: "concertmaster-pipeline" },
    onnotice: () => {},
  });
}
