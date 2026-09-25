---
status: accepted
---

# The review queue stays a GitHub Issue, with decisions stored in Postgres

Even though Postgres is now the source of truth (ADR 0001), the weekly review still happens in the "Review queue" GitHub Issue: approve and reject checkboxes per Performance. The `review-sync` stage reads the ticks and writes them to a Review decision table, which gives an audit trail.

## Considered Options

- **A decisions table plus an admin page.** Rejected for now: it needs Supabase Auth, which ADR 0001 defers.
- **Editing the table in Supabase Studio.** Rejected: it's clumsy, and it's easy to change the wrong row.

## Consequences

- The issue is only an interface. If it's lost, the decisions survive in Postgres.
- Revisit this when a second reviewer arrives.
