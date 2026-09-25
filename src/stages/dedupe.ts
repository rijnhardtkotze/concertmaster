import { sortEvents } from "../lib/canonical.ts";
import { PATHS, RULES } from "../lib/config.ts";
import { dedupe } from "../lib/dedupe.ts";
import { readJson, writeJson } from "../lib/json.ts";
import { errorMessage, logger } from "../lib/log.ts";
import { loadVenues, VenueIndex } from "../lib/reference.ts";
import type { Event } from "../lib/schema.ts";
import { loadSources, type SourceRole } from "../lib/sources.ts";
import { writeStats } from "../lib/state.ts";

const log = logger("dedupe");

async function main() {
  const sources = await loadSources();
  const roles: Record<string, SourceRole> = Object.fromEntries(sources.map((s) => [s.slug, s.role]));
  const input = readJson<Event[]>(PATHS.normalised, []);
  const { events, fuzzy } = dedupe(input, new VenueIndex(loadVenues()), roles, RULES.fuzzyTitleThreshold);

  for (const f of fuzzy) {
    log.info(`fuzzy merge ${f.date} score=${f.score}: [${f.kept.source}] "${f.kept.title}" ⟵ [${f.merged.source}] "${f.merged.title}"`);
  }
  writeJson(PATHS.deduped, sortEvents(events), { sortKeys: false });
  // Current set of fuzzy merges, committed: git diff shows threshold effects over time.
  writeJson(PATHS.fuzzyMerges, fuzzy);
  writeStats("dedupe", { sources: {}, totals: { input: input.length, output: events.length, fuzzy: fuzzy.length } });
  log.info(`${input.length} → ${events.length} events (${fuzzy.length} fuzzy merges)`);
}

main().catch((err) => {
  log.error(errorMessage(err));
  process.exit(1);
});
