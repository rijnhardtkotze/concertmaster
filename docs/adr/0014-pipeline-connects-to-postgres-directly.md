---
status: accepted
supersedes: 0002
---

# The ingestion pipeline stays on GitHub Actions and connects to Postgres directly

This supersedes ADR 0002. What changes is how the pipeline connects to Postgres: over a direct Postgres connection string, not over supabase-js with the service key.

## What still holds from ADR 0002

- The daily run is a GitHub Actions workflow running the TypeScript stages on Node 22. Each stage reads from and writes to Postgres instead of files.
- The pipeline does not move to Supabase Edge Functions or pg_cron. Edge Functions run Deno with short time limits, so they can run neither the `claude` CLI nor the rasteriser.
- Extraction runs through headless Claude Code (`claude -p`), billed to the Claude Max subscription via `CLAUDE_CODE_OAUTH_TOKEN`.
- Scanned PDFs are rasterised before they go to the model.
- Stages keep running one at a time locally, against a local Supabase database.

## What changes

The pipeline connects with a Postgres connection string for the Supabase connection pooler, held as a repository secret. It no longer uses supabase-js or the service key.

Merge has to write the listings, their Field lineage and the Review decisions it applies in one transaction, so that a failed run leaves the database as it was. supabase-js talks to PostgREST, which runs each request in its own transaction, so it cannot do that. A direct connection can.

The pooler URL is used rather than the database's direct host because Supabase serves the direct host over IPv6 only, and GitHub's hosted runners have no IPv6.

The site's build is not affected. It still reads the published views over supabase-js with the anon key (ADR 0004).

Which Postgres client library to use, and which pooler mode, are left to the ticket that adds the connection.

## Considered Options

- **A direct Postgres connection over the pooler** (chosen).
- **supabase-js with the service key, as ADR 0002 had it.** Rejected: PostgREST cannot run merge's writes in one transaction.
- **supabase-js calling a Postgres function that does the merge.** Rejected: the merge logic would move into PL/pgSQL, so it would live in two languages, and the TypeScript version already has tests. ADR 0002 rejected the split for the same reason.
- **The database's direct host instead of the pooler.** Rejected: it needs IPv6, or Supabase's paid IPv4 add-on.

## Consequences

- The Actions runner holds the pooler connection string as a repository secret. The pipeline no longer needs the service key.
- The connection string's role bypasses row-level security, as the service key did. It stays in the pipeline's secrets and never reaches the site's build, which uses only the anon key.
- Locally, stages connect to the local Supabase stack's Postgres with its own connection string.
