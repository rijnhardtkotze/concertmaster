---
status: accepted
---

# Nothing is seeded: the pipeline and the Review queue build every record

The rebuild starts with an empty database (PRD, cutover). This goes one step further: no listings data is seeded from v1's curated lists either. Every Venue, Person, Presenter, Ensemble and Work comes from a Source, through the pipeline, and a new Venue through the Review queue. The industry's own announcements decide who is who and what goes where.

## Decision

1. **No seed from `data/venues.json` or `data/composers-sa.json`.** v2 never reads them. They go with the rest of `data/` at cutover (ADR 0011).
2. **Every Venue starts as a Venue candidate.** The first time extraction names a place, it waits in the Review queue with the address and city the source gave. Approving it creates the Venue. "Same as <Venue>" adds the name as an alias of a Venue already approved. Rejecting it keeps its Performances off the site.
3. **A Venue's details come from its sources.** Address, city, province, map location, and doors-open and parking notes are all nullable, and approval never waits for them. Whatever is unknown shows as unconfirmed. The site's map and directions links use the map location when there is one, then the address, then the Venue's name and city.
4. **A Person is South African only when a source says so**, whatever their role. The model reports what the page states about a Person, such as "South African composer", and never guesses from a name. Normalise never infers it either. This replaces the spec's rule that a Composer's `locale` comes only from the curated seed.
5. **Settings and enums are not listings data.** ADR 0017's settings and the Genre, Performance status and premiere enums are still created by migration.

## Why

A curated list is someone's judgement, typed in by hand, and nobody re-checks it. If it is wrong, the site repeats the mistake with the guide's name on it. Records built from what presenters and venues publish, with a human approving each new Venue, can be traced to their source (ADR 0009) and corrected there.

## Considered Options

- **Seed Venues and South African composers from v1's lists** (spec #28, ticket #33). Rejected: the owner won't vouch for data the pipeline didn't find.
- **Seed Venues only.** Rejected for the same reason.
- **Mark nobody South African until a later decision.** Rejected in favour of taking the source's word, which keeps South African content on the site from the start.

## Consequences

- The first weeks' Review queues hold more Venue candidates: every place the CPO and Quicket use, once each. After that, only genuinely new places. This can push the weekly review past 15 minutes at first.
- A Performance at a Venue not yet approved stays off the site until you approve the Venue (PRD, Review and alerts).
- South African content shows only where a source says so. A South African Composer whose presenter doesn't say so isn't marked.
- User stories 34, 78, 79 and 80 in spec #28, and tickets #33, #44, #47 and #56, change to match.
