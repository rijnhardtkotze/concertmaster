---
status: accepted
---

# The site is a static build; the database is closed to the public

The Astro site is built statically, reading Postgres at build time, and each ingest run that changes the listings triggers a rebuild. Browsers never talk to Supabase. Even so, row-level security is enabled on every table from the first migration. The anon role gets no policies except `select` on a few published views.

## Considered Options

- **The browser queries Supabase with the anon key.** Rejected: it's worse for SEO, and it would expose the tables from day one.
- **Astro server-side rendering on a host.** Rejected: it means a server to run and pay for, with no benefit for listings that change once a day.

## Consequences

- Listings are at most one run stale, which matches the daily ingest.
- A later move to client-side reads only needs new policies, not a redesign.
