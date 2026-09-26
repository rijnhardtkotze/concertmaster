# PRD: SA Classical Guide v2, the Supabase rebuild

The first v2 release moves the listings into Postgres and puts a listings site live. CPO and Quicket are the two sources it must carry. Everything else follows in slices.

This PRD builds on the glossary in [`CONTEXT.md`](../CONTEXT.md) and the decisions in [`docs/adr/`](adr/). It uses their terms throughout and does not repeat their reasoning.

Author: Rijnhardt Kotze. Written on the 26th of September 2026.

## What problem this solves

Classical concerts in South Africa are listed in a dozen places, each in its own format. A concert-goer who wants to know what is on has to check every orchestra, venue and ticketing site in turn.

The first pipeline gathers these listings with a model and stores them as files in git. That works for one flat list. The site needs more: Productions with several Performances, Works across the country, venue pages, and a trail from every field back to its source. Git cannot answer those questions without code to do so every time.

Nothing is public yet. The rebuild is the first thing people will see.

## What success looks like

1. **Operations stay under budget.** The whole site runs on less than two hours of my time a week. The weekly review takes 15 minutes or less.
2. **Listings publish without me.** At least 95 per cent of Performances go live with no Review decision.
3. **The nightly run is dependable.** It succeeds on at least 27 of every 30 nights.
4. **The site is right.** Upcoming Performances for the CPO, the JPO and the Chamber Music Collective match their own calendars in a monthly spot check, at 95 per cent or better.
5. **Copyright holds.** Zero source text gets past the copyright guard.

## What the first release does not do

1. **No editorial or playlists.** They come after the listings site is live, and they live in git (ADR 0007).
2. **No logins.** There is one editor. Review stays in the GitHub Issue (ADR 0006) and Supabase is Postgres only (ADR 0001).
3. **No open-data exports.** Deferred until someone asks (ADR 0011).
4. **No Artist or Work pages.** The data for them is stored from day one. The pages come later.
5. **Only two sources are required.** The other ten follow as P1 slices after launch.

## Who it is for

### Concert-goers

1. As a concert-goer in Johannesburg or Cape Town, I want one list of upcoming classical Performances near me, so that I stop checking five sites.
2. As a concert-goer, I want a concert's page to list every date it plays, so that I can pick the night that suits me.
3. As a concert-goer, I want to see the Programme, the Ensemble and the soloists before I buy, so that I can decide whether to go.
4. As a concert-goer, I want a cancelled or postponed Performance marked as such, so that I know before I travel.
5. As a concert-goer, I want a link to buy tickets from the presenter or the ticketing site, so that I can go from the guide straight to a seat.
6. As a concert-goer, I want a page per Venue with what is on there, so that I can follow the halls I like.

### The operator (me)

1. As the operator, I want one Review queue issue a week with only the Performances that need a human, so that review stays under 15 minutes.
2. As the operator, I want a failing Source to open its own issue after three failed runs, and close it when it recovers, so that I only look when something is broken.
3. As the operator, I want to trace any field on the site to the Extraction and fetch it came from, so that I can fix a wrong listing at its cause.
4. As the operator, I want a new Venue held back until I approve it, so that "City Hall" and "Cape Town City Hall" do not become two venues.
5. As the operator, I want the database schema to change only through migrations that CI applies, so that production never drifts from the repo.

### Presenters

1. As a presenter, I want the guide to list my Productions accurately and link to my ticketing, so that it sends me an audience.
2. As a presenter, I want to know what the crawler fetches and how to opt out, so that I can trust it. The crawler page does this.

## Requirements

### P0: must ship in the first release

#### 1. Schema foundation

The schema covers Production, Performance, Series, Season, Presenter, Ensemble, Person, Credit, Work, Programme, Venue, Source, Fetch record, Extraction, Field lineage and Review decision, as defined in `CONTEXT.md`.

- [ ] All tables are created by SQL migrations in `supabase/migrations/` (ADR 0015).
- [ ] CI runs the migrations against a local Supabase stack with the tests. A merge to `v2` applies them to the production project `egturlxzxgyaugiyybqe`.
- [ ] Every table is in the `private` schema, with row-level security on. The anon role can `select` only from the Published views: materialised views in the `api` schema, the only schema the Data API exposes, refreshed at the end of every merge (ADR 0004, ADR 0016).
- [ ] Presenter and Ensemble are separate tables that share a slug (ADR 0008).
- [ ] Person is one table. Artist and Composer are roles on a Credit or a Work (glossary).
- [ ] Slugs for Productions, Venues, Presenters and Ensembles never change once published.
- [ ] Every Venue stores an address, city, province, a map location, and optional doors-open and parking notes. Unknown notes show as unconfirmed.
- [ ] A Performance has zero or more Price tiers, each a name and an amount in rand. With none, the price is unknown and the diary shows "Price to come". With tiers, it shows the highest and the lowest beneath it.
- [ ] A Programme is an ordered list of items. Each item is a Work or an interval with its length.
- [ ] Every Production has one Genre from the fixed list in `CONTEXT.md`. Extraction picks it, and a Production it can't place goes to review.
- [ ] The project stays on the Supabase Free plan. The nightly Action's daily writes keep it from pausing.
- [ ] The nightly Action runs `supabase db dump` and keeps the dump in a Cloudflare R2 bucket. Free has no automatic backups.

#### 2. Ingestion into Postgres

The existing stages keep their shape: fetch, extract, normalise, dedupe, review-sync, merge, report, notify. They run on GitHub Actions and read and write Postgres (ADR 0014).

- [ ] Fetch writes a Fetch record per document with URL, content hash, time, HTTP status and robots decision. It writes no body (ADR 0003).
- [ ] Raw bodies exist only in the Actions cache during a run. A document whose hash has not changed skips extraction.
- [ ] Extract writes an Extraction only after the copyright guard passes it. The guard rejects descriptions over 400 characters and any 12-word span copied from the source.
- [ ] Extract stops starting new documents when its time budget runs out, 30 minutes by default. The remaining documents wait for the next run.
- [ ] Scanned PDFs with under about 100 characters of text per page are rasterised and sent as images.
- [ ] Extraction keeps Performances from 7 days before the fetch date to 24 months after it. The validator no longer asserts that a start is in the future.
- [ ] Sonnet 5 and Opus 5 calls use `effort`. Haiku 4.5 is the determinism comparison and uses `temperature: 0`.
- [ ] Every timestamp is stored with an explicit `+02:00` offset.

#### 3. Dedupe and merge

- [ ] Two Extractions describe the same Performance when they share Venue and normalised title and start within 60 minutes of each other. If one source document lists two start times, they are two Performances however close. A fuzzy title match above the current threshold is the fallback. This keeps v1's tested rule in `src/lib/dedupe.ts`.
- [ ] Performances group into one Production when they share a Presenter and normalised title and no two consecutive starts are more than 60 days apart. A run of any length stays one Production. A revival after a longer gap is a new one.
- [ ] Where sources disagree on a field, the higher Source role wins: presenter, then venue, then aggregator, then vendor. Between equal roles, the most recent fetch wins.
- [ ] Performance status is the exception to role precedence. The most severe status any current source reports wins: cancelled, then postponed, sold out, few left, scheduled. A vendor usually learns of "sold out" first. A status that overrides the presenter's is flagged in the Review issue. This keeps v1's rule.
- [ ] Every field on a Production and a Performance records its Field lineage: the Extraction that supplied the current value (ADR 0009).
- [ ] A Work matches on Composer, normalised title and catalogue number where given. A miss creates the Work and lists it in the Review issue as information only (ADR 0010).
- [ ] Performances missing from all their Sources for three runs in a row become Unlisted. They are hidden, noted in the Review issue and never deleted.
- [ ] A Performance status of few left, sold out, postponed or cancelled shows on the site as stated by the source. Scheduled shows as "On sale".
- [ ] A Performance that has Price tiers, all of them zero, shows as "Free". One whose start time is missing shows "Time to come" and is labelled "Unconfirmed".
- [ ] A Performance with no date or no Venue never reaches the site. It waits in the Review queue.

#### 4. Review and alerts

- [ ] The notify stage keeps one Review queue issue with an approve and a reject box per Performance that needs a human. Review-sync writes the ticks to the Review decision table.
- [ ] A Performance goes to review when its extraction confidence is below 0.75, its Venue is unknown, or it fails validation.
- [ ] A decision holds until that Performance's content changes at the source.
- [ ] A Source that fails three runs in a row opens a `Source failing: <slug>` issue. The issue closes itself when the Source recovers.
- [ ] Unknown Venues wait in the Review queue. Approving one adds it to the curated list.

#### 5. Sources

- [ ] **CPO** works end to end: fetch, extract, merge, and a live Production page.
- [ ] **Quicket** works end to end through its API. It carries the JPO and the Chamber Music Collective.
- [ ] Quicket's API terms say nothing about republishing. I accepted that risk without asking Quicket. We store structured facts only, never organisers' descriptions or images.
- [ ] The golden regression cases cover both sources and run in CI on the owner's pull requests.

#### 6. Listings site

An Astro static build reads the published views at build time (ADR 0004).

- [ ] Every nightly run builds the site in the Action and deploys it with `wrangler deploy` to Cloudflare Workers static assets, whether or not the listings changed, so the structured data never lists past concerts for long (ADR 0013, ADR 0019).
- [ ] The home page is the diary: Upcoming Performances, one row each, grouped by month and soonest first. Each row shows date, time, title, Credits, Venue, price and status.
- [ ] The diary filters by date (everything ahead, tonight, this week, this weekend) and by city.
- [ ] Each Production has a page with its Performances, Programme, Credits, Series, status and a ticket link.
- [ ] Each Venue has a page with its Upcoming Performances, address, map, directions link, and doors-open and parking notes where known.
- [ ] Each Production page carries schema.org structured data as JSON-LD: one `MusicEvent` per Upcoming Performance, so search engines can show the concerts as event results. It is built from the Production view alone.
- [ ] Unlisted Performances do not appear anywhere on the site.
- [ ] The site goes live on `concertmaster.co.za`, with `classicalmusic.co.za` redirecting to it. Both are Cloudflare zones.
- [ ] The crawler page at `/about/crawler` explains the bot, its user agent and how to opt out.
- [ ] The about page states that the listings are licensed CC BY 4.0 (ADR 0011).
- [ ] All copy is localised South African English.

#### 7. Cutover

- [ ] The v1 file pipeline stays paused. Postgres starts empty and fills from the first v2 run.
- [ ] At go-live, `v2` takes `main` with `git merge -s ours origin/main` and `main` fast-forwards to `v2`.
- [ ] The workflow that applies migrations and pushes `config.toml` moves its trigger from `v2` to `main` (ADR 0015, ADR 0016).
- [ ] Dependabot drops `target-branch: v2` and follows the default branch again.
- [ ] The README, `data/` and `data/LICENSE` are updated to match ADR 0011.

### P1: fast follow after launch

These sit in two milestones after v2 goes live.

**v2.1: More sources**

1. **The other ten Sources**, one vertical slice each: JPO direct, KZNPO, Symphony Choir of Johannesburg, Vox Chamber Choir, Artscape, Baxter, Webtickets, the Chamber Music Collective direct, Unisa Music Foundation and Old Nectar.
2. **New Sources** already asked for: Christ Church Concert Series (#5), VOX Cape Town (#7) and Pierneef Teater (#11).
3. **A merge-Works action** to fold duplicate Works together, with alternative names.

**v3: Site enhancements**

1. **A Season and Series page** per presenter.
2. **Search, past concerts, Featured and Writing**, as tracked in #23.

### P2: design for, do not build

1. **Artist and Work pages.** "Where is Beethoven 7 on this year?" The data model supports it from day one.
2. **Editorial and playlists** in git, linking to listings by slug (ADR 0007).
3. **Open-data exports** under CC BY 4.0 (ADR 0011).
4. **Auth and an admin page** when a second editor arrives (ADR 0001, ADR 0006).
5. **All live events**, beyond classical. The schema should not assume classical-only fields are always present.

## How we measure it

| Metric | Target | Kind | How we measure |
|---|---|---|---|
| Weekly review time | 15 minutes or less | Leading | My own log, four weeks after launch |
| Published without review | 95 per cent or more | Leading | Share of Performances with no Review decision, from a query over 30 days |
| Nightly run success | 27 of 30 nights | Leading | GitHub Actions history for the ingest workflow |
| Source text past the guard | Zero | Leading | Guard rejections logged per run, plus the golden cases |
| Calendar accuracy | 95 per cent or more | Lagging | Monthly spot check of CPO, JPO and Collective calendars against the site |
| Total weekly time | Under 2 hours | Lagging | My own log, reviewed each quarter |

## What is still open

1. **How the site looks.** A first mockup exists in Claude Design: [SA Classical Guide website](https://claude.ai/artifact/LbLYrB8rpGJgcuJ7noGpfD). It has the diary on desktop and phone, a concert page on desktop, and the listing states. Mine to finish, tracked in [#22](https://github.com/rijnhardtkotze/concertmaster/issues/22). Blocks the site slice only. Still missing for the first release:
   1. The Venue page.
   2. The concert page on phone.
   3. A concert with several dates.
   4. The About page, with the CC BY 4.0 statement.
   5. The sources and crawler page.

The mockup also shows search, past concerts, a Featured flag and the Writing section. They stay in the design and are out of the first release, tracked in [#23](https://github.com/rijnhardtkotze/concertmaster/issues/23).

## How the work is phased

There is no hard deadline. The work ships in this order, each phase a set of vertical slices:

1. **Foundation.** Migrations, CI, row-level security and the published views.
2. **CPO end to end.** Source to Postgres to a Production page, with tests.
3. **Quicket end to end.** Brings in the JPO and the Collective.
4. **Review and alerts.** Review queue, Source failing issues and the nightly schedule on Postgres.
5. **The listings site.** Home, Production and Venue pages, built and deployed every night.
6. **Go-live and cutover.** The `-s ours` merge and the README update.
7. **P1 slices.** One Source at a time, then the listing improvements.
