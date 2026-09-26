---
status: accepted
---

# Listings have two levels: Production and Performance

The old schema had one flat "event" record per sitting ("a three-night run is three records"). The rebuild splits this into a Production (one programme by one presenter) that has one or more Performances (one venue, one start time). Series and Season attach to the Production. "Event" is retired as a term.

## Considered Options

- **A flat Performance only**, with optional series and season fields. Rejected: listing pages would show three near-identical cards for a three-night run, and editorial could only link to a single date.

## Consequences

- Dedupe now works at two levels. Matching Performances is the old dedupe-key problem, and grouping them into Productions is a new rule the spec has to define.
- The diary (the site's main listing) still shows one row per Performance, in date order, because a concert-goer scans by date. The Production groups its Performances on its own page. Editorial links to the Production.
