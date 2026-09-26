# AGENTS.md

These are the rules for coding agents in this repository. Claude Code reads them through `CLAUDE.md`.

SA Classical Guide lists classical concerts in South Africa and publishes editorial about them. This repo holds the ingestion pipeline. The Astro site comes later.

The site has to run on less than two hours of my time a week. Any change that adds manual work needs a strong reason.

## Read these two things before you start

1. **`CONTEXT.md` is the glossary.** Use its terms exactly in code, tests, commits and prose. Never use a word from an _Avoid_ list. One dated sitting is a Performance. A run of them is a Production.
2. **`docs/adr/` holds the settled decisions.** Do not reopen them in passing. If your work conflicts with one, stop and say so. Write a new ADR when a decision is hard to reverse, would surprise a later reader, and came from a real trade-off. Use the next number and the same format.

## How the branches work

`v2` is the Supabase rebuild. `main` is the old file-based pipeline, and it is frozen.

1. Open every rebuild pull request against `v2`.
2. Leave `main` alone. Only urgent fixes go there. Nightly ingest is paused.
3. Do not merge `main` into `v2`. v2 is a rewrite. If v2 needs a fix from `main`, re-implement it in the new code.
4. Cut over once, at the end. Run `git merge -s ours origin/main` on `v2`, then fast-forward `main` to `v2`.
5. Never force-push `main` or `v2`.

## How to commit

One change, one commit.

1. Each commit does one thing: a refactor, a feature, a test fix or a doc edit. A formatting pass is its own commit.
2. Every commit passes `pnpm run typecheck && pnpm run lint && pnpm run test`.
3. Write the subject in the imperative, prefixed with the area. For example `ingest: stop extract after a time budget` or `schema: add performance table`.
4. Commit on a branch. Never commit straight to `main` or `v2`.

## Which commands to run

Node 22. The pnpm version is pinned in `package.json`.

```sh
corepack enable && pnpm install
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run check-secrets
pnpm run golden
```

`pnpm run golden` costs model calls. Run it only when the prompt or the extraction code changes.

## The rules that never bend

- **No third-party content at rest** (ADR 0003). Source HTML and PDF bodies never go into git, Postgres or any other store we own. `data/raw/` stays gitignored. The copyright guard runs in the extract stage, before anything is saved.
- **No secrets in commits.** The pre-commit hook and CI block anything shaped like an Anthropic key. Credentials come from environment variables: `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `QUICKET_API_KEY` and the Supabase keys.
- **Model parameters.** Sonnet 5 and Opus 5 take `effort` and reject `temperature`. Haiku 4.5 is the determinism comparison and still takes `temperature: 0`.
- **Times.** Every time is South African Standard Time, with an explicit `+02:00` offset. There is no daylight saving.
- **Copy.** Site copy is localised South African English only. No Afrikaans or other-language titles.

## How we use Supabase

Postgres is the source of truth. The project is `Concertmaster`, ref `egturlxzxgyaugiyybqe`, on Postgres 17 in eu-west-1.

1. **Postgres only, for now.** In the first v2 release we use no Auth, Storage, Edge Functions or pg_cron (ADR 0001).
2. **Migrations are the only way to change the schema.** Write them as SQL in `supabase/migrations/` with the Supabase CLI. CI applies them (ADR 0012). Never change the production schema through the dashboard or an MCP connector.
3. **Row-level security is on for every table.** The anon role may only `select` from published views (ADR 0004).
