# SA Classical Guide

Concert listings and editorial for classical music in South Africa.
Site: <https://concertmaster.co.za> (also reachable at classicalmusic.co.za; the long-term domain isn't settled, see `SITE_URL` in `src/lib/config.ts`).

This repository holds the ingestion pipeline (`src/`, `sources/`) and its committed output (`data/`). The Astro site (`site/`) comes later.

## Licensing

- **Code** (everything outside `data/`): MIT. See [`LICENSE`](LICENSE).
- **Event data** (`data/`): CC BY 4.0. See [`data/LICENSE`](data/LICENSE).

The data does not inherit the code licence. Third-party source pages are never committed (`data/raw/` is gitignored for good), and we don't hold rights to them.

## How it works

A GitHub Action runs the pipeline (daily at 03:00 SAST; the schedule is paused for now, so run it by hand from the Actions tab). Each stage is a separate script that reads and writes files, so you can run any one of them on its own:

| stage | reads | writes |
|---|---|---|
| `fetch` | `sources/*.ts`, `data/manifest.json` | `data/raw/` (cache only), `data/manifest.json`, `data/source-status.json` |
| `extract` | changed documents only | `data/extracted/<source>/<doc>.json` |
| `normalise` | all current extractions | `.work/normalised.json`, `data/rejects.json` |
| `dedupe` | `.work/normalised.json` | `.work/deduped.json`, `data/fuzzy-merges.json` |
| `review-sync` | the "Review queue" issue | `data/review-decisions.json` |
| `merge` | `.work/deduped.json`, previous output | `data/events.json`, `data/review-queue.json` |
| `report` / `notify` | `.work/stats/` | step summary, commit message, issues |

State lives in git. The Action commits `data/` with a message like `chore(ingest): +12 events, 3 updated, 2 to review` and skips the commit when nothing meaningful changed.

**Your weekly ten minutes** is the open **Review queue** issue. Tick `approve` or `reject` per event; the next run applies it. A decision holds until the event's content changes at the source. Records that failed validation are listed at the bottom of the same issue. A source that fails three runs in a row gets its own `Source failing: <slug>` issue, which closes itself when the source recovers.

## Local dev loop

```sh
corepack enable            # pnpm version comes from package.json
pnpm install

export CLAUDE_CODE_OAUTH_TOKEN=…  # extract + golden, billed to your Claude subscription (`claude setup-token`)
# or: export ANTHROPIC_API_KEY=…  # per-token API billing instead
export QUICKET_API_KEY=…    # quicket source only (free key: developer.quicket.co.za)

pnpm run fetch -- --source jpo     # one source; omit --source for all
pnpm run extract -- --source jpo   # only documents whose content hash changed
pnpm run extract -- --source jpo --force   # re-extract regardless (e.g. after a prompt change)
pnpm run rebuild                   # normalise → dedupe → merge; free, no API calls
pnpm run ingest                    # the whole daily run, minus git and issues

pnpm run test && pnpm run typecheck && pnpm run lint
pnpm run golden                    # prompt regression check, 1 call per case
```

`rebuild` works from the committed extractions, so changing a venue alias, the dedupe threshold or a normalise rule never costs an API call. Behind a corporate proxy, set `NODE_USE_ENV_PROXY=1` so Node's `fetch` picks up `HTTPS_PROXY`.

A pre-commit hook (installed by `pnpm install`) blocks anything shaped like an Anthropic API key. CI runs the same check over the whole tree.

## Adding a source

Write one file, `sources/<slug>.ts`, where the filename is the slug. It's picked up automatically.

```ts
import { defineSource } from "../src/lib/sources.ts";

export default defineSource({
  slug: "kznpo",
  name: "KwaZulu-Natal Philharmonic Orchestra",
  role: "presenter",               // presenter | venue | aggregator | vendor (drives dedupe precedence)
  homepage: "https://kznphil.org.za/",
  hint: "Website of the KZN Philharmonic Orchestra (presenter).",
  adapter: {
    type: "html",
    startUrls: ["https://kznphil.org.za/events/"],
    follow: { selector: ".uagb-post__title a", max: 30 },   // detail pages (HTML or PDF)
    extractStartPages: true,       // also send the listing itself
    contentSelector: "article .entry-content",
  },
});
```

Then:

1. `pnpm run fetch -- --source kznpo` and read `data/raw/kznpo/*.txt`. That text is exactly what the model will see. Tighten `contentSelector` and `remove` until it's the concert and little else. Less noise gives better extraction and more stable content hashes, which means fewer paid calls.
2. `pnpm run extract -- --source kznpo && pnpm run rebuild`, then check `data/review-queue.json` and `data/rejects.json`.
3. Add any new venues to `data/venues.json` (use aliases for the spellings sources actually use) and rerun `rebuild`.

Three shapes cover most sites:

- **Listing with detail pages:** `follow`.
- **One page with everything:** no `follow`.
- **Events embedded as data** (a calendar widget's JSON, a WordPress REST endpoint): a `split(body, url)` function that returns one item per event. See `sources/cpo.ts` and `sources/artscape.ts`.

A source that returns no documents counts as a failure, since that's what a broken selector looks like. For seasonal sources that are legitimately empty, set `allowEmpty: true`.

## Secrets

| secret | used by | notes |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | extract, golden | **Default.** Extraction runs through headless Claude Code (`claude -p`, no tools, JSON-schema output) and is billed to your Claude Pro/Max subscription. Create it with `claude setup-token` (valid one year; put a renewal reminder in your calendar). |
| `ANTHROPIC_API_KEY` | extract, golden | Optional fallback, per-token API billing via the SDK. Used only if the OAuth token isn't set, or with `EXTRACT_BACKEND=api`. |
| `QUICKET_API_KEY` | fetch (quicket) | Sent as a query parameter, so every URL is redacted before logging and it's never part of a manifest key. |

All secrets are passed only to the steps that need them, are never logged, and are never written to `data/` (writes that match a key pattern throw).

**Subscription notes.** Anthropic documents `CLAUDE_CODE_OAUTH_TOKEN` for running Claude Code in your own GitHub Actions; calling the Messages API directly with a subscription token is not documented, which is why this path goes through the Claude Code CLI (pinned in `package.json`). Runs draw on the same usage limits as your interactive Claude use, one call at a time. If a limit or an expired token is hit, extraction stops, the run goes red, and the remaining documents are picked up on the next run. `temperature` can't be set on this path; the JSON schema keeps output structured, and the golden set is how you check it stays accurate.
