---
status: accepted
---

# Postgres is the source of truth; Supabase is used as Postgres only

Until now git was the database: the daily Action committed `data/` and git history held all state. For the rebuild, the Supabase project's Postgres database becomes the single source of truth for listings. Git holds code, content and exports only. For the first v2 release we use Supabase as a managed Postgres (tables, views, constraints, row-level security) and nothing else: no Auth, Storage, Edge Functions or pg_cron.

## Considered Options

- **Postgres only** (chosen). The site builds from the database and the pipeline connects with the service key, so nothing needs a login.
- **Postgres + Auth** for a logged-in admin area. Rejected for now: there is one editor, and a login adds upkeep that the under-two-hours-a-week budget can't justify.
- **The full platform** (Auth, Storage, Edge Functions, pg_cron). Rejected: nothing in the first v2 release needs it.

## Consequences

- Auth comes back on the table when a second person needs to edit or review.
- Storage comes back when we host images ourselves.
- Anything that would call an Edge Function or pg_cron job has to justify itself against this ADR first.
