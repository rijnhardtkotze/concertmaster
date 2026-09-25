---
status: accepted
---

# No third-party source content is stored at rest

Source pages and PDFs are copyrighted by their publishers, and we hold no rights to them. Their bodies are never written to Postgres or to any other store we own, including staging tables. Postgres holds three layers: Fetch records (URL, hash, status, no body), Extractions (model output after the copyright guard has passed it), and the canonical listings. During a run, raw bodies exist only in the GitHub Actions cache, which lets unchanged documents skip extraction. This carries the old rule that `data/raw/` stays gitignored for good over to the database.

## Considered Options

- **A short-lived raw staging table**, purged after each run. Rejected: it would put third-party content in our store, if only briefly. Debugging can re-fetch instead.

## Consequences

- The copyright guard stays in the extract stage, before anything is persisted.
- Re-extracting after a prompt change means re-fetching, or a warm Actions cache.
