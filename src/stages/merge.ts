import { PATHS } from "../lib/config.ts";
import { readJson, writeJson } from "../lib/json.ts";
import { errorMessage, logger } from "../lib/log.ts";
import { merge, type ReviewDecisions } from "../lib/merge.ts";
import { loadVenues, VenueIndex } from "../lib/reference.ts";
import type { Event } from "../lib/schema.ts";
import { writeStats } from "../lib/state.ts";
import { now } from "../lib/time.ts";

const log = logger("merge");

async function main() {
  const { published, queue, counts } = merge({
    incoming: readJson<Event[]>(PATHS.deduped, []),
    published: readJson<Event[]>(PATHS.events, []),
    queue: readJson<Event[]>(PATHS.reviewQueue, []),
    decisions: readJson<ReviewDecisions>(PATHS.reviewDecisions, {}),
    venues: new VenueIndex(loadVenues()),
    now: now(),
  });
  writeJson(PATHS.events, published, { sortKeys: false });
  writeJson(PATHS.reviewQueue, queue, { sortKeys: false });
  const { newlyQueued, bySource, ...totals } = counts;
  writeStats("merge", { sources: bySource, totals: { ...totals, newly_queued: newlyQueued.length, published: published.length, queue: queue.length } });
  log.info(
    `+${counts.added} added, ${counts.updated} updated, ${counts.queued} in review (${newlyQueued.length} new), ${counts.unconfirmed} newly unconfirmed, ${counts.approved} approved, ${counts.rejected} rejected by reviewer`,
  );
}

main().catch((err) => {
  log.error(errorMessage(err));
  process.exit(1);
});
