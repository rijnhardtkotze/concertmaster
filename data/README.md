# data/

Structured concert listings for classical music in South Africa, produced by the pipeline in this repository.

**This data is licensed CC BY 4.0** ([`LICENSE`](LICENSE)). The code that produces it is MIT, and the two licences are separate: the data doesn't inherit the code licence. Attribute as *"SA Classical Guide (https://concertmaster.co.za), CC BY 4.0"*.

Every record is derived: facts about a performance (date, venue, performers, programme, ticket link) plus a short summary in our own words. We never copy publishers' descriptions. Each event links to its source page in `source.url`; that page and its text belong to its publisher.

## Files

| file | what | maintained by |
|---|---|---|
| `events.json` | Published events, one record per performance, sorted by start. Schema: [`../event-schema.json`](../event-schema.json). | pipeline |
| `review-queue.json` | Events below the confidence threshold or with fields flagged for review. Not published. | pipeline |
| `venues.json` | Canonical venue table: `venue_id`, name, aliases, city, province. | **by hand** |
| `composers-sa.json` | South African composers. Drives `sa_content`. Matching is exact, never inferred. | **by hand** |
| `manifest.json` | Per source document: ETag, Last-Modified, content hash, when it last changed. | pipeline |
| `source-status.json` | Per source: current document set, consecutive failures, last error. | pipeline |
| `extracted/` | Raw model output per document and content hash (descriptions that fail the copyright guard already removed). Lets the later stages be re-run for free. | pipeline |
| `rejects.json` | Records that failed validation, with the reasons. No descriptions. | pipeline |
| `fuzzy-merges.json` | Cross-source merges made by title similarity rather than exact key, with scores, for auditing the threshold. | pipeline |
| `review-decisions.json` | Approve/reject decisions ticked in the Review queue issue. | pipeline, from the issue |
| `raw/` | Fetched third-party pages. **Gitignored permanently. Never committed in any form.** | cache only |

## Semantics worth knowing

- **Times** are ISO 8601 with an explicit `+02:00` offset (South Africa has no DST).
- **`id`** is stable for the life of an event, even if the source later edits the title.
- **`status: "unconfirmed"`**: the event was listed, has not happened yet, and has since disappeared from its source. We keep it rather than silently deleting it; treat it as "check before you go".
- **`first_seen`** never changes. **`last_updated`** moves only when the event's content changes, not on every re-fetch.
- **`source.secondary_urls`**: other listings of the same performance (usually the ticket vendor) that were merged into this record.
- Past events stay in `events.json`.
