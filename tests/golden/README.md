# Golden set

Hand-labelled fixtures that run through the real `extract → normalise` path.
The harness reports **per-field accuracy** and the change against the committed
baseline, so you can see whether a prompt edit helped or just moved the errors around.

```sh
pnpm run golden                     # live, needs ANTHROPIC_API_KEY (a few cents)
pnpm run golden -- --case cpo-echoes-of-vienna
pnpm run golden -- --recorded       # re-score the last live run; no API calls
pnpm run golden -- --save-baseline  # accept the current run as the baseline
```

## Adding a case

One directory per case under `cases/`:

| file | contents |
|---|---|
| `case.json` | `source` (slug), `url`, `fetched_at` (fixes "now" for date checks), `document_type`, `snippet_of` (**where the snippet came from, with its URL**), `notes` |
| `input.txt` | the document text **as the pipeline would send it**: grab it from `data/raw/<source>/<doc_id>.txt` after a local fetch, then cut it down to the minimum that exercises the case |
| `expected.json` | array of expected events in published shape. Omit `id`, `dedupe_key`, `first_seen`, `last_updated` and `confidence`. Label every field you'd score; a missing list field means "should be empty" |

Rules:

- **Snippets, not pages.** Never commit a whole third-party page. Keep only the
  lines the case needs, and record the source URL in `snippet_of`. The test
  suite rejects inputs over 8 KB.
- Descriptions are free text, so they aren't compared. Put `"description": "(present)"`
  in the expected record to check that one exists, or `null` to check there isn't one.
- Fields where both sides are null don't count, so "all unknown" never scores well.

The five cases the extraction prompt asks for, to add next: an Afrikaans page, a
PDF season brochure, a Quicket listing, and one deliberately awful page (the two
here are the clean HTML listing and a calendar entry).
