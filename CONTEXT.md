# SA Classical Guide

Listings and editorial for classical music in South Africa. The ingestion pipeline turns presenters' and venues' own announcements into one clean, de-duplicated set of listings.

## Listings

**Production**:
One programme put on by one presenter, performed one or more times. A three-night run of "Echoes of Vienna" is one Production.
_Avoid_: Event, show, concert (as a record type)

**Performance**:
One sitting of a Production at one venue at one start time. A matinee and the evening show on the same day are two Performances.
_Avoid_: Event, date, occurrence, sitting

**Series**:
A recurring named banner that Productions are billed under, such as "Summer Symphonies at the City Hall". It is not the Production's own title.
_Avoid_: Strand, programme

**Season**:
A presenter's time-bounded set of Productions, such as "JPO Spring Season 2026".
_Avoid_: Series (a different thing), year

## People, places and music

**Presenter**:
The organisation responsible for putting on a Production, such as the JPO, Artscape or a festival. It is a separate record from Ensemble, even when one organisation is both, as the CPO is.
_Avoid_: Organiser, promoter, host

**Ensemble**:
A performing group credited on a Production: an orchestra, choir or chamber group.
_Avoid_: Band, group, company

**Person**:
One human being in the listings, whether they compose, perform or both. An SA composer-pianist is one Person.
_Avoid_: Individual, contact

**Artist**:
A Person in a performing role on a Production, such as conductor, soloist or accompanist. Artist is a role, not a separate record.
_Avoid_: Performer, musician

**Credit**:
The link between a Production and an Ensemble or Person, with the role they play in it (for example "conductor" or "orchestra").
_Avoid_: Billing, cast

**Composer**:
A Person in the role of having written a Work. Composer is a role, not a separate record.
_Avoid_: Author

**Work**:
One canonical piece of music, identified by Composer, title and (where one exists) catalogue number. "Beethoven Symphony No. 7, Op. 92" is one Work however a source spells it.
_Avoid_: Piece, song, item

**Programme**:
The ordered list of Works a Production performs.
_Avoid_: Setlist, repertoire

**Venue**:
A place Performances happen, drawn from a curated list that includes each venue's known alternative names. A Performance at a venue that isn't on the list waits in the Review queue until that venue is approved.
_Avoid_: Location, hall, space

**Performance status**:
Whether a Performance is scheduled, cancelled, postponed or sold out, as its sources state. A missing status means scheduled.
_Avoid_: State

**Unlisted**:
A Performance that has been missing from all its sources for three runs in a row. It is hidden from the site and noted in the Review issue, but never deleted.
_Avoid_: Deleted, removed, expired

**Upcoming**:
A Performance whose start is at or after now. This is a view of the listings, not a rule about what is stored: Performances up to 7 days in the past are kept.
_Avoid_: Future, current, live

## Ingestion

**Source**:
One place we fetch listings from, such as the JPO's website or the Quicket API. Each Source has exactly one Source role.
_Avoid_: Feed, site, provider

**Source role**:
What a Source is in relation to the listings it publishes: presenter, venue, aggregator or vendor, in that order of authority. When sources disagree on a field, the higher role wins, and between equal roles the most recently fetched Extraction wins.
_Avoid_: Source type, priority

**Fetch record**:
The log of one attempt to fetch one source document: URL, content hash, time, HTTP status and robots decision. It never holds the document's body.
_Avoid_: Raw, snapshot, page

**Extraction**:
The structured listings a model produced from one source document, stored only after the copyright guard has passed them.
_Avoid_: Parse, scrape, raw

**Field lineage**:
For every field of a Production or Performance, the record of which Extraction supplied its current value.
_Avoid_: Provenance (too vague), audit

**Review decision**:
An approve or reject verdict on one Performance, ticked in the Review queue issue. It holds until that Performance's content changes at the source.
_Avoid_: Approval, moderation
