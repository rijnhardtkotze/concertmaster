---
status: accepted
supplements: 0004
---

# Pipeline tables live in a private schema; the site reads materialised views in an `api` schema

This supplements ADR 0004. Its decision still holds: the site is a static build, browsers never talk to Supabase, and the anon role can read the published views and nothing else. This ADR settles where the tables and views live, and how the views read the tables.

## Decision

1. **Every table is in a `private` schema** that the Data API never exposes: Source, Fetch record, Extraction, the listings, reference data, Field lineage and Review decisions, with their enums and helper functions. Row-level security stays on for every table (ADR 0004). anon and authenticated get no privileges on `private`, not even `usage`.
2. **The published views are materialised views in an `api` schema.** Diary, Production and Venue are the only objects in it. anon gets `usage` on `api` and `select` on each view, and nothing else.
3. **The Data API exposes `api` only.** `config.toml` sets `[api] schemas = ["api"]`. The `public` schema stays, empty and unexposed. The site's build reads with supabase-js and the anon key, with the client's schema set to `api` (ADR 0014).
4. **Production gets the same setting from CI.** The workflow that applies migrations also runs `supabase config push`, so `config.toml` is the one record of what is exposed. Nobody changes it in the dashboard.
5. **Merge refreshes the views.** A `private.refresh_published()` function refreshes all three, and merge calls it last, inside its one transaction (ADR 0014). A failed merge rolls the refresh back with everything else. The refresh is a plain one, not concurrent: nothing reads the views while merge runs.
6. **Upcoming is fixed when the views refresh.** The Diary and Venue views keep Performances whose start date is on or after the refresh date. The nightly run refreshes before it builds. On nights when nothing changes and the site isn't rebuilt, the script in the page hides Performances whose start has passed (spec #28, Further Notes 16).
7. **Default privileges are revoked** in `private`, `api` and `public`, in Supabase's form: `alter default privileges for role postgres in schema <schema> revoke select, insert, update, delete on tables from anon, authenticated, service_role`, and the same for sequences and functions. Every grant is written out in the migration that needs it.
8. **Pipeline SQL is always schema-qualified**, as in `private.source`. Functions set `search_path = ''`. Nothing depends on a connection's search path.

## Why

Supabase's guidance (Hardening the Data API, and the row-level security guide) is to keep internal tables in a schema the Data API doesn't expose, and to expose a dedicated schema holding only what is meant to be public. Row-level security then becomes the second lock rather than the only one.

Spec #28 had the views run with their owner's rights, so anon would need no grants on the tables. In an exposed schema, Supabase's advisor rates that an error (lint 0010, security definer view), because such a view ignores row-level security.

Materialised views avoid it. anon can read them without any grant on `private`, so the tables stay closed to anon entirely. The advisor warns about a materialised view in an exposed schema (lint 0016), because it has no row-level security. We accept that warning: the three views hold only what the site shows to everyone anyway.

A static site built once a night doesn't need views that are live to the second. Refreshing inside merge's transaction means the views and the tables always agree when the build reads them.

## Considered Options

- **Materialised views in `api`, refreshed by merge** (chosen).
- **Security-invoker views in `api`**, which is Supabase's documented way to expose a view. Rejected: anon would need `usage` on `private`, `select` on every listing table the views read, and row-level security policies repeating the views' rules (published versions only, not Unlisted, not rejected). That spreads the published-listing rules across policies and views, and opens the tables to anon, if only outside the Data API.
- **Security-definer views, as spec #28 had them.** Rejected: an advisor error we would carry for good.
- **Keep everything in `public`.** Rejected: `public` is where tools and default grants land, so a table put there by mistake would be exposed.
- **One schema per area** (`ingest`, `listings`). Rejected: two schemas to secure, and anon can reach neither anyway.
- **Change the exposed schemas by hand in the dashboard.** Rejected: a manual step that can drift from `config.toml`.

## Consequences

- The row-level security test changes. Because anon can't see `private` at all, a failed `select` no longer proves row-level security is on, so the test checks directly that it is enabled on every table in `private`. Separately, as anon, `select` works on each view in `api` and fails on every table in `private`.
- Supabase's advisor shows one warning per materialised view (lint 0016). It is expected, and nothing else from the advisor is.
- The views are only as fresh as the last merge. A migration that creates or changes a view builds it `with data`, so it is right from the moment it lands.
- Merge's transaction takes a little longer, for the refresh. At a few thousand Performances this is seconds.
- The tickets that create tables (#31, #33 to #36) put them in `private`. The published-views ticket (#37) builds materialised views in `api`.
- A later move to client-side reads (ADR 0004's consequence) would add live views or functions to `api`. The tables stay private either way.
