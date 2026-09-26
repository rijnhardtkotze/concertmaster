# AGENTS.md

Instructions for coding agents (Claude Code, Codex, Cursor and others) working in this repository. Humans are welcome to read along.

SA Classical Guide is a site of classical music listings and editorial for South Africa. This repo holds the ingestion pipeline and, later, the Astro site. It has to run on less than two hours a week of the owner's time, so automation comes first: any change that adds manual work needs a strong reason.

## Read before you start

- **`CONTEXT.md`** is the glossary. Use its terms exactly (Production, Performance, Presenter, Ensemble, Work and so on) in code, tests, commits and prose. Never use a term from its _Avoid_ lists. In particular, don't use "event" as a record type.
- **`docs/adr/`** holds the architecture decisions that are already settled. Don't reopen them in passing. If your work needs to go against one, stop and say so; don't work around it. A new decision that is hard to reverse, would surprise a future reader, and came from a real trade-off gets a new ADR (the next number, same format).

## Branches

- **`v2`** is the Supabase rebuild. All rebuild work goes in pull requests that target `v2`.
- **`main`** is the old file-based pipeline. It is frozen: only urgent fixes go there, and nightly ingest is paused.
- **Don't sync `main` into `v2`.** v2 is a rewrite. If a fix on `main` matters for v2, re-implement it in the new code rather than merging it across.
- **Cutover** happens once, at the end: `git merge -s ours origin/main` on `v2`, then fast-forward `main` to `v2`. Never force-push either branch.

## Commits

- **One change, one commit.** Each commit does exactly one thing and says what it is: a refactor, a feature, a test fix, a doc update. Don't bundle unrelated edits, even small ones. A formatting pass is its own commit.
- Every commit leaves the tree green: `pnpm run typecheck && pnpm run lint && pnpm run test`.
- Subject line in the imperative, prefixed with the area, e.g. `ingest: stop extract after a time budget`, `docs(adr): 0013 …`, `chore(deps): …`, `schema: add performance table`.
- Commit on a branch, never directly to `main` or `v2`.

## Commands

```sh
corepack enable && pnpm install      # Node 22, pnpm version pinned in package.json
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run check-secrets
pnpm run golden                      # live extraction regression; costs model calls, run only when the prompt or extraction changes
```

## Rules that don't bend

- **No third-party content at rest (ADR 0003).** Source HTML and PDF bodies are never committed, and never written to Postgres or any other store we own. `data/raw/` stays gitignored. The copyright guard runs in the extract stage, before anything is persisted.
- **Never commit secrets.** The pre-commit hook and CI both block anything shaped like an Anthropic key. Credentials come from environment variables (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `QUICKET_API_KEY`, and the Supabase keys).
- **Model parameters.** Sonnet 5 and Opus 5 take `effort`, not `temperature`. Haiku 4.5 is the determinism comparison and still accepts `temperature: 0`.
- **Time.** All times are South African Standard Time, written with an explicit `+02:00` offset. There's no DST.
- **Copy.** All site copy is localised South African English. No Afrikaans or other-language titles.

## Supabase

- Project `Concertmaster`, ref `egturlxzxgyaugiyybqe` (eu-west-1, Postgres 17).
- Postgres is the source of truth. For v1, Supabase is used as Postgres only: no Auth, Storage, Edge Functions or pg_cron (ADR 0001).
- The schema changes only through SQL migrations in `supabase/migrations/`, made with the Supabase CLI and applied by CI (ADR 0012). Never change the production schema through the dashboard or an MCP connector.
- Row-level security is enabled on every table. The anon role can only `select` from published views (ADR 0004).
