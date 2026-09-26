# Issue tracker: GitHub

Tickets and specs for this repo are GitHub Issues in `rijnhardtkotze/concertmaster`. Use the `gh` CLI. Where `gh` is missing, use the GitHub API or a GitHub connector for the same operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..." --label ready-for-agent`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`.
- **List tickets**: `gh issue list --state open --label ready-for-agent --json number,title,body,labels`.
- **Comment**: `gh issue comment <number> --body "..."`.
- **Labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.
- **Blocking**: GitHub's native issue dependencies. `gh api --method POST repos/rijnhardtkotze/concertmaster/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where the id comes from `gh api repos/rijnhardtkotze/concertmaster/issues/<n> --jq .id`. Fall back to a `Blocked by: #<n>` line at the top of the body.

## Milestones and labels

Every v2 ticket gets the `v2: Supabase rebuild` milestone and the `v2` label. Work for after v2 is live gets `v3: Site enhancements` and `v3`.

Add one area label per ticket:

- `schema`: Postgres tables, views, migrations and row-level security.
- `ingest`: fetch, extract, normalise, dedupe, merge, review and alerts.
- `site`: the Astro site and its deploy.
- `new-source`: adding one Source end to end.
- `design`: work in the Claude Design mockup. This is human work, so it never gets `ready-for-agent`.

## Pipeline issues share this tracker

The notify stage owns two kinds of issue: the `Review queue` issue (label `review-queue`) and `Source failing: <slug>` issues (label `ingest-failure`). The pipeline opens, rewrites and closes them. Tickets carry `ready-for-agent`, so filter by that label when listing work.

## Pull requests

Pull requests for v2 tickets target the `v2` branch. Reference the ticket with `Closes #<n>`.

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue labelled `ready-for-agent`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
