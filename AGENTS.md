# AGENTS.md

SA Classical Guide lists classical concerts in South Africa. This repo holds the ingestion pipeline. The Astro site comes later.

The whole thing runs on under two hours of my time a week. Build **automation-first**: a change that adds manual work needs a strong reason.

## Agent skills

### Issue tracker

Tickets are GitHub Issues in this repo, labelled `ready-for-agent`. Read `docs/agents/issue-tracker.md` before you create, read or close a ticket.

### Domain docs

Single context: `CONTEXT.md` and `docs/adr/` at the root. Read `docs/agents/domain.md` before you explore the code or name anything.

## How the branches work

`main` is **frozen**. `v2` is the Supabase rebuild, and all rebuild work lands there.

1. Branch from `v2` and open the pull request against `v2`.
2. Port a fix from `main` by re-implementing it in the v2 code. v2 is a rewrite, so the two branches only meet at cutover.
3. Cut over once, at the end: `git merge -s ours origin/main` on `v2`, then fast-forward `main` to `v2`.
4. History on `main` and `v2` only moves forward. Force-pushing either is off limits.

## How to commit

Every commit is **atomic** and **green**.

1. **Atomic.** One change per commit. A refactor, a feature, a test fix, a doc edit and a formatting pass are five commits.
2. **Green.** `pnpm run typecheck`, `pnpm run lint` and `pnpm run test` all pass.
3. **Subject.** Prefix it with the area: `ingest: …`, `schema: …`, `docs(adr): …`.

## How the changelog works

**Every pull request adds a changie fragment.** CI fails without one, whatever the change.

1. Run `pnpm run change --kind <Kind> --body "<one sentence>"` and commit the file it writes to `.changes/unreleased/`. Kinds: Added, Changed, Deprecated, Removed, Fixed, Security.
2. Write the body for someone reading the release notes. Say what changed for them, in the glossary's terms.
3. Releases come only from the `release` workflow, run by hand with a version such as `v2.0.0`. It is the one thing that commits straight to a branch: it writes `CHANGELOG.md`, tags the version and creates the GitHub Release.

## The rules that hold everywhere

- **Copyright** (ADR 0003). Persist only Fetch records, which carry no body, and Extractions that passed the copyright guard. Source bodies live in the Actions cache during a run and nowhere else. The guard runs in the extract stage, before anything is saved.
- **Secrets.** Credentials come from environment variables only. The pre-commit hook and CI reject anything shaped like an Anthropic key.
- **Models.** Sonnet 5 and Opus 5 take `effort` only. Haiku 4.5 is the determinism comparison and takes `temperature: 0`.
- **Time.** Listing and source timestamps are South African Standard Time with an explicit `+02:00` offset, all year round. Run metadata, such as the golden runner's `ran_at`, stays in UTC.
- **Copy.** Site copy is localised South African English, titles and playlist names included.
- **Golden tests.** `pnpm run golden` makes live model calls. Run it when the extraction prompt or the extraction code changes.

## How we use Supabase

Postgres is the source of truth. The project is `Concertmaster`, ref `egturlxzxgyaugiyybqe`.

1. **Postgres only** in the first v2 release: tables, views, constraints and row-level security. Any other Supabase product needs a new ADR first (ADR 0001).
2. **Migrations change the schema.** SQL files in `supabase/migrations/`, made with the Supabase CLI and applied by CI (ADR 0012). The dashboard and MCP connectors stay read-only on the production schema.
3. **Row-level security on every table.** The anon role gets `select` on published views and nothing else (ADR 0004).
