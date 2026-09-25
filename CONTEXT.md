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

**Artist**:
One person credited on a Production, such as a conductor, soloist or accompanist.
_Avoid_: Performer, musician

**Credit**:
The link between a Production and an Ensemble or Artist, with the role they play in it (for example "conductor" or "orchestra").
_Avoid_: Billing, cast

**Composer**:
The person who wrote a Work.
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

**Upcoming**:
A Performance whose start is at or after now. This is a view of the listings, not a rule about what is stored: Performances up to 7 days in the past are kept.
_Avoid_: Future, current, live

## Ingestion

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
