import { PATHS, REVIEW_ISSUE_TITLE, REVIEW_SYNC_MARKER } from "../lib/config.ts";
import { GitHub } from "../lib/github.ts";
import { readJson, writeJson } from "../lib/json.ts";
import { errorMessage, logger } from "../lib/log.ts";
import { fingerprint, type ReviewDecisions } from "../lib/merge.ts";
import { parseDecisions } from "../lib/review-issue.ts";
import type { Event } from "../lib/schema.ts";
import { nowIso } from "../lib/time.ts";

const log = logger("review-sync");

/**
 * Pull ticked approve/reject boxes from the "Review queue" issue into
 * data/review-decisions.json, before merge runs. The fingerprint is taken from
 * the queue entry the reviewer was looking at, so a decision is about that
 * exact content and lapses if the source changes it.
 */
async function main() {
  const gh = GitHub.fromEnv();
  if (!gh) {
    log.info("no GITHUB_TOKEN/GITHUB_REPOSITORY; skipping");
    return;
  }
  const issue = await gh.findOpenIssue(REVIEW_ISSUE_TITLE);
  const ticked = parseDecisions(issue?.body ?? "");
  if (!ticked.size) {
    writeJson(REVIEW_SYNC_MARKER, { recorded: [] });
    return;
  }

  const queue = new Map(readJson<Event[]>(PATHS.reviewQueue, []).map((e) => [e.id, e]));
  const decisions = readJson<ReviewDecisions>(PATHS.reviewDecisions, {});
  const recorded: string[] = [];
  for (const [id, decision] of ticked) {
    const e = queue.get(id);
    if (!e) continue; // already gone from the queue
    decisions[id] = { decision, decided_at: nowIso(), fingerprint: fingerprint(e), title: e.title };
    recorded.push(id);
  }
  // Old decisions refer to events long past; drop them to keep the file small.
  const cutoff = Date.now() - 400 * 86400_000;
  for (const [id, d] of Object.entries(decisions)) if (Date.parse(d.decided_at) < cutoff) delete decisions[id];
  writeJson(PATHS.reviewDecisions, decisions);
  writeJson(REVIEW_SYNC_MARKER, { recorded: recorded.sort() });
  log.info(`${recorded.length} review decision(s) recorded`);
}

main().catch((err) => {
  // Never block ingestion on the issue tracker. Unrecorded ticks aren't lost: notify
  // carries them over when it rewrites the issue, and the next run records them.
  log.annotate(`review sync failed (ticks stay in the issue for the next run): ${errorMessage(err)}`);
});
