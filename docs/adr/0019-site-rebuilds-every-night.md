---
status: accepted
supplements: 0004, 0016
---

# The site is rebuilt and deployed every night

ADR 0004 has an ingest run rebuild the site only when it changes the listings, and ADR 0016 relies on a page script to hide past Performances on nights with no rebuild. Both still hold otherwise. What changes: every nightly run builds the site and deploys it, whether or not the listings changed.

## Why

The first release carries schema.org `MusicEvent` structured data on Production pages (PRD, listings site). The page script can hide a past Performance from visitors, but search engines read the JSON-LD the build wrote. Without a rebuild, a quiet night leaves yesterday's concerts in that markup as upcoming events. A nightly build keeps the markup at most one day stale, the same as the listings.

A build and a `wrangler deploy` take about a minute of CI and none of the owner's time.

## Considered Options

- **Rebuild every night** (chosen).
- **Rebuild only when the listings change, as ADR 0004 had it.** Rejected: stale event markup on quiet nights.
- **Remove past events' JSON-LD with the page script.** Rejected: search engines may not run the script, so the markup they read would stay stale.

## Consequences

- The deploy step no longer depends on merge's changed flag. Report still counts the changes.
- The page script that hides past Performances stays, for the hours between a Performance's start and the next build.
- A failed build or deploy fails the nightly run visibly, as any stage does.
