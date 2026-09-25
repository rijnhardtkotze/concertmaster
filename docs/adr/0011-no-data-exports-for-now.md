---
status: accepted
---

# No open-data exports for now; listings stay CC BY 4.0 on the site

The file-based pipeline committed its CC BY 4.0 dataset to `data/`. With Postgres as the source of truth (ADR 0001), the rebuild publishes no dataset exports for now. The listings shown on the site remain licensed CC BY 4.0, and the site's about page says so. `data/` and `data/LICENSE` are removed from the repo, and the README's dual-licensing section is updated to match.

## Considered Options

- **A daily JSON/CSV export committed to `data/`**, making git history a public changelog. Deferred until someone asks for the data.
- **Dropping CC BY altogether.** Rejected: keeping it costs nothing, and exports can come back without a licence change.
