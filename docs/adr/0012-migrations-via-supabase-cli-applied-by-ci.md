---
status: accepted
---

# Database migrations are SQL files in the repo, applied by CI

The schema is defined only by SQL migrations in `supabase/migrations/`, managed with the Supabase CLI. CI runs them against a local Supabase stack together with the pipeline tests. A GitHub Action applies them to the production project (`egturlxzxgyaugiyybqe`) when they're merged to `main`. Nobody changes the schema through the dashboard or the MCP connector.

## Considered Options

- **The same migration files, applied by hand** with `supabase db push`. Rejected: it's easy to forget, and it takes time from the weekly budget.
- **Supabase branching**, with a preview database per PR. Rejected for now: it's a paid add-on with no clear need at one contributor.

## Consequences

- The production database password or access token lives as a repository secret next to the service key.
- Any change made in the dashboard is drift, and the next migration may overwrite it.
