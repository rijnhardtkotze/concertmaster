---
status: accepted
---

# Listings live in Postgres; editorial and playlists live in git

Only machine-ingested listings go into Postgres. Editorial articles and curated playlists stay in the repo as Markdown (Astro content collections), versioned and reviewed like code. Content refers to listings by stable slug (Production, venue, ensemble), and the static build resolves those slugs against the database.

## Considered Options

- **Content in Supabase tables.** Rejected: there are few pieces, and they're prose. Git gives history and review for free, and a CMS-style editor would need Auth.

## Consequences

- Slugs for Productions, venues and ensembles must be stable. Renaming one breaks links in content, so the build should fail on an unresolved slug.
