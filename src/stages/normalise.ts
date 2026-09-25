import { sortEvents } from "../lib/canonical.ts";
import { PATHS } from "../lib/config.ts";
import { readExtracted } from "../lib/extracted.ts";
import { sourceShingles } from "../lib/guard.ts";
import { writeJson } from "../lib/json.ts";
import { errorMessage, logger } from "../lib/log.ts";
import { normaliseEvent, type NormaliseContext } from "../lib/normalise.ts";
import { ComposerIndex, loadComposers, loadVenues, VenueIndex } from "../lib/reference.ts";
import type { Event } from "../lib/schema.ts";
import { loadSources } from "../lib/sources.ts";
import { bump, loadManifest, loadSourceStatus, readDocText, writeStats, type Reject, type SourceRunStats } from "../lib/state.ts";
import { now } from "../lib/time.ts";

const log = logger("normalise");

/**
 * Always runs over every live document of every enabled source, not just the
 * ones re-extracted this run: the output is a pure function of the committed
 * extractions, so it can be re-run at any time for free.
 */
async function main() {
  const sources = await loadSources();
  const manifest = loadManifest();
  const status = loadSourceStatus();
  const ctx: NormaliseContext = { venues: new VenueIndex(loadVenues()), composers: new ComposerIndex(loadComposers()), now: now() };
  const stats: Record<string, SourceRunStats> = {};
  const events: Event[] = [];
  const rejects: Reject[] = [];

  for (const source of sources) {
    stats[source.slug] = {};
    for (const url of status[source.slug]?.documents ?? []) {
      const entry = manifest[url];
      if (!entry) continue;
      const file = readExtracted(source.slug, entry.doc_id);
      if (!file || file.status !== "ok") continue;
      // The cached text is the latest fetch. If this file is the last good extraction kept
      // while a newer version fails to extract, that text isn't what it was extracted from:
      // re-checking against it could reject an event over words only the new page contains.
      // The extract-time guard, which the kept file passed, stands instead.
      const text = file.content_hash === entry.content_hash ? readDocText(source.slug, entry.doc_id) : null;
      const doc = {
        url,
        source: source.slug,
        fetchedAt: file.fetched_at,
        contentHash: file.content_hash,
        text: text === null ? null : sourceShingles(text),
        defaultPresenter: source.defaultPresenter,
      };
      const failures = new Map(file.guard_failures.map((g) => [g.index, g.reason]));
      file.events.forEach((raw, i) => {
        const r = normaliseEvent(raw, doc, ctx, failures.get(i));
        if (r.ok) {
          events.push(r.event);
          bump(stats, source.slug, "events_valid");
        } else if (r.skipped !== "past") {
          bump(stats, source.slug, "events_rejected");
          // No description in rejects: a rejected description may be exactly the copied text we refuse to publish.
          rejects.push({
            source: source.slug,
            url,
            title: typeof raw.title === "string" ? raw.title : null,
            start: typeof raw.start === "string" ? raw.start : null,
            reasons: r.reasons,
          });
        }
      });
    }
  }

  rejects.sort((a, b) => a.source.localeCompare(b.source) || a.url.localeCompare(b.url) || (a.start ?? "").localeCompare(b.start ?? ""));
  writeJson(PATHS.normalised, sortEvents(events), { sortKeys: false });
  writeJson(PATHS.rejects, rejects);
  writeStats("normalise", { sources: stats });
  log.info(`${events.length} valid events, ${rejects.length} rejected`);
}

main().catch((err) => {
  log.error(errorMessage(err));
  process.exit(1);
});
