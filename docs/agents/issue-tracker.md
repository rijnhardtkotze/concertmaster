# Issue tracker: GitHub

Tickets and specs for this repo are GitHub Issues in `rijnhardtkotze/concertmaster`. Use the `gh` CLI. Where `gh` is missing, use the GitHub API or a GitHub connector for the same operations.

## Conventions

- **Create a ticket**: `gh issue create --title "..." --body "..." --milestone "v2: Supabase rebuild" --label v2,schema,ready-for-agent`. Swap in the ticket's milestone, its matching release label and one area label, as set out under "Milestones and labels" below. Leave out `ready-for-agent` for `design` work. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`.
- **List tickets**: `gh issue list --state open --label ready-for-agent --json number,title,body,labels`.
- **Comment**: `gh issue comment <number> --body "..."`.
- **Labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.
- **Blocking**: GitHub's native issue dependencies. `gh api --method POST repos/rijnhardtkotze/concertmaster/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where the id comes from `gh api repos/rijnhardtkotze/concertmaster/issues/<n> --jq .id`. Fall back to a `Blocked by: #<n>` line at the top of the body.

## Milestones and labels

Each ticket gets one milestone and its matching label:

1. `v2: Supabase rebuild` and `v2`: everything the first v2 release needs to go live.
2. `v2.1: More sources` and `v2.1`: Sources added after launch, and pipeline upkeep such as merging Works.
3. `v3: Site enhancements` and `v3`: what the site gains after launch.

Add one area label per ticket:

- `schema`: Postgres tables, views, migrations and row-level security.
- `ingest`: fetch, extract, normalise, dedupe, merge, review and alerts.
- `site`: the Astro site and its deploy.
- `new-source`: adding one Source end to end.
- `design`: work in the Claude Design mockup. This is human work, so it never gets `ready-for-agent`.

## Pipeline issues share this tracker

The notify stage owns two kinds of issue: the `Review queue` issue (label `review-queue`) and `Source failing: <slug>` issues (label `ingest-failure`). The pipeline opens, rewrites and closes them. Tickets carry `ready-for-agent`, so filter by that label when listing work.

## Pull requests

Pull requests for v2 tickets target the `v2` branch. Put `Closes #<n>` in the body for each ticket. GitHub only acts on that keyword for merges into `main`, so the `close-v2-tickets` workflow closes the tickets when the pull request merges into `v2`.

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create a GitHub issue labelled `ready-for-agent`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.
