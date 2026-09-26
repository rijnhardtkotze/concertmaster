---
status: superseded by 0014
---

# The ingestion pipeline stays on GitHub Actions and writes to Postgres

The daily run stays a GitHub Actions workflow running the TypeScript stages on Node 22. Each stage now reads from and writes to Postgres instead of files. The pipeline does not move to Supabase Edge Functions or pg_cron. Extraction runs through headless Claude Code (`claude -p`), billed to the Claude Max subscription via `CLAUDE_CODE_OAUTH_TOKEN`, and scanned PDFs are rasterised first. Edge Functions run Deno with short time limits, so they can run neither the `claude` CLI nor the rasteriser.

## Considered Options

- **Actions writes to Postgres** (chosen).
- **Edge Functions + pg_cron.** Rejected: this would force per-token API billing and a rewrite for Deno.
- **Split**: fetch and extract on Actions, with normalise, dedupe and merge as SQL functions. Rejected: the dedupe logic would live in two languages, and the TypeScript version already has tests.

## Consequences

- The Actions runner connects to Postgres with the service key, stored as a repository secret.
- Stages keep running one at a time locally, now against a local Supabase database or a branch database.
