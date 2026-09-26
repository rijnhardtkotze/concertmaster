---
status: accepted
---

# Settings, vocabularies and the extraction contract come from Postgres

Postgres is the source of truth (ADR 0001). This extends that to what the pipeline is told and tuned with: its settings, the fixed lists the model picks from, and the South African Composers it is shown. The code reads them from the database; it does not keep its own copy.

## Decision

1. **Settings live in `private.setting`**, one row per key: `key text primary key`, `value jsonb not null`, `description text not null`. The table is in the unexposed `private` schema (ADR 0016).
2. **Every tunable number is a setting**: review confidence (0.75), fuzzy title match (0.6), the dedupe window (60 minutes), the gap that splits a Production (60 days), missed runs before a Performance is Unlisted (3), failed runs before a `Source failing` issue (3), the extract time budget (30 minutes), the cap on model calls per run (250, today's `EXTRACT_MAX_CALLS`) and failed attempts before a document is parked (3). The `EXTRACT_MAX_CALLS` environment override goes, so the cap too changes only by migration. Each moves when the ticket that ports its stage does.
3. **The copyright guard stays in code.** Its 400 characters and 12-word span are a legal line, not a knob (ADR 0003).
4. **Settings change only by migration**, like the schema (ADR 0015). The dashboard stays read-only.
5. **Settings are checked on read.** At the start of a run the pipeline reads every setting and validates each key's value with a Zod schema in code. A missing, unknown or invalid value fails the run before any stage starts.
6. **The fixed lists are the database enums.** Genre, Performance status and premiere exist once, as Postgres enums (#35). Nothing in code lists their values.
7. **The extraction contract is built at extract time.** Before its first model call, extract reads the enums, the settings it needs and `COMPOSERS_ZA`, and builds the JSON Schema, the Zod validator and the prompt from templates in the repo. `event-schema.json` and the hard-coded lists in `extraction-prompt.md` go; the prompt file becomes a template.
8. **Every rendered prompt is kept.** `private.prompt_version` holds the hash, the rendered prompt, the rendered JSON Schema and when it was first used. Each Extraction points at its row. The prompt version is that hash, so any change to an enum, a setting in the prompt, `COMPOSERS_ZA` or the template makes a new version and re-extracts unchanged documents (spec #28, user story 53). A document skips extraction only when its content hash already has an Extraction under the current prompt version. The prompt is our own text, so storing it doesn't touch ADR 0003.
9. **`COMPOSERS_ZA` is the Persons with `locale` `en-ZA` who are the Composer of at least one Work.** It goes in the prompt so the model keeps those names spelled consistently, and normalise links a bare surname that matches exactly one of them to that Person, flagged for review. A Person gets `en-ZA` only when a source says so, whatever their role (ADR 0018). Nothing is seeded.

## Why

A migration that adds a Genre, or a change to the review threshold, should reach the prompt, the validator and merge with no code edit. With the lists and numbers in two places, one is always about to be stale. Building the contract at extract time means there is nothing to regenerate or forget, and keeping each rendered prompt means the text the model saw can still be read when a listing is wrong (ADR 0009).

Key and value rows keep adding a setting to one insert. The type checks happen in code, on read, so a bad value stops the run rather than a stage halfway through.

Counting only Composers of a Work keeps the list to people the pipeline has actually met under that name, so an Artist who shares the locale doesn't enter the prompt as a Composer.

## Considered Options

- **One typed row, a column per setting.** Rejected in favour of key and value rows; typing moves to the Zod check on read.
- **Settings editable in the dashboard.** Rejected: it breaks ADR 0015's read-only dashboard, and CI would never see the value.
- **Generating the JSON Schema, Zod mirror and prompt into committed files**, with a CI test for staleness. Rejected in favour of building them at extract time, so there is no regenerate step. The trail it gave is kept by storing each rendered prompt.
- **Storing only the prompt hash on the Extraction.** Rejected: the text the model saw would be lost.
- **A `curated_composer` flag on Person, or counting seeded Persons without a Work.** Rejected in favour of the Work rule.
- **Seeding one Work per curated Composer.** Rejected: up-front research for 35 names, and the Works would have to be right.
- **Seeding the 35 names from `data/composers-sa.json` at all.** Rejected by ADR 0018: nothing is seeded.

## Consequences

- **`COMPOSERS_ZA` starts empty** and fills as sources name South African Composers and their Works are programmed. South African content on the site comes from each Composer's `locale` in the Published views, so it appears as soon as a source says a Composer is South African.
- When a South African Composer joins `COMPOSERS_ZA`, the prompt version changes, so every unchanged document is re-extracted on the next run. Early on this can happen several nights running, until the list settles. The extract time budget caps the cost per night.
- Extract needs the database before its first model call, and so do the golden cases: they read the enums and settings from a local Supabase stack. The TypeScript types for Genre, status and premiere become strings checked by the run-time validator rather than literal unions.
- The Extraction table references `private.prompt_version` instead of holding a free-text prompt version.
- Tickets #33, #34, #44, #45 and spec #28 change to match. The tickets that port merge, dedupe, report and alerts read their numbers from `private.setting`.
