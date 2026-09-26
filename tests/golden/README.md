# Golden set

Hand-labelled fixtures that run through the real extract path. Each record the
model returns is checked against the v2 extraction schema (`event-schema.json`)
and scored as extracted. The harness reports **per-field accuracy** and the
change against the committed baseline, so you can see whether a prompt edit
helped or just moved the errors around.

```sh
pnpm run golden                     # live, needs CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY
pnpm run golden -- --case cpo-echoes-of-vienna
pnpm run golden -- --recorded       # re-score the last live run; no API calls
pnpm run golden -- --save-baseline  # accept the current run as the baseline
```

In CI (`golden -- --require-baseline`) the job fails when overall accuracy drops more
than 5 points below the baseline, or title, start date or start time accuracy,
Performance recall or Performance precision drops at all. Extraction isn't deterministic, so a run that trips the
gate is re-run once and only fails if the second run trips it too.

## Adding a case

One directory per case under `cases/`:

| file | contents |
|---|---|
| `case.json` | `source` (slug), `url`, `fetched_at` (fixes "now" for date checks), `document_type`, `snippet_of` (**where the snippet came from, with its URL**), `notes` |
| `input.txt` | the document text **as the pipeline would send it**: grab it from `data/raw/<source>/<doc_id>.txt` after a local fetch, then cut it down to the minimum that exercises the case |
| `expected.json` | array of expected Performances in the extraction shape: a `production` and a `performance` object each. Omit `confidence`, `needs_review` and `extraction_notes`. Label every field you'd score; a missing list field means "should be empty" |

Rules:

- **Snippets, not pages.** Never commit a whole third-party page. Keep only the
  lines the case needs, and record the source URL in `snippet_of`. The test
  suite rejects inputs over 8 KB.
- Descriptions are free text, so they aren't compared. Put `"description": "(present)"`
  in the expected `production` to check that one exists, or `null` to check there isn't one.
- Fields where both sides are null don't count, so "all unknown" never scores well.

Cases to add next: a Quicket listing (the v2 spec asks for it), an Afrikaans page,
a PDF season brochure and one deliberately awful page. The two here are a clean
HTML page and a calendar entry.
