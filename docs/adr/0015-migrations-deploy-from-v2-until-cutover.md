---
status: accepted
supersedes: 0012
---

# Database migrations are applied to production from `v2` until cutover, then from `main`

This supersedes ADR 0012. What changes is the branch whose pushes apply migrations to production: `v2` until cutover, then `main`.

## What still holds from ADR 0012

- The schema is defined only by SQL migrations in `supabase/migrations/`, managed with the Supabase CLI.
- CI runs every migration against a local Supabase stack, together with the pipeline tests.
- A GitHub Action applies the migrations to the production project (`egturlxzxgyaugiyybqe`). Nobody applies them by hand.
- Nobody changes the schema through the dashboard or an MCP connector.
- There is no Supabase branching and no preview database per pull request.

## What changes

Until cutover, a push to `v2` applies the migrations to production. At cutover the trigger moves to `main`.

`main` is frozen until cutover, and all rebuild work lands on `v2`. With the trigger on `main`, no migration would reach production before go-live, so the v2 pipeline would have no schema to write to while it is built, and the first production migration run would happen at go-live, untried. The production database is empty and nothing is public yet, so applying migrations from `v2` puts nothing at risk.

## Considered Options

- **Apply from `v2` until cutover, then from `main`** (chosen).
- **Apply from `main`, as ADR 0012 had it.** Rejected: nothing reaches `main` until cutover.
- **The same migration files, applied by hand** with `supabase db push`. Rejected, as in ADR 0012: it's easy to forget, and it takes time from the weekly budget.
- **Supabase branching**, with a preview database per pull request. Rejected, as in ADR 0012: it's a paid add-on with no clear need at one contributor.

## Consequences

- The production access token and database password live as repository secrets, next to the pipeline's connection string (ADR 0014).
- A migration merged to `v2` reaches production straight away. A bad one is fixed with a new migration, not by editing the old one.
- The cutover checklist has to move the trigger from `v2` to `main`.
- Any change made in the dashboard is drift, and the next migration may overwrite it.
