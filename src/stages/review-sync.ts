import { PATHS, REVIEW_ISSUE_TITLE } from "../lib/config.ts";
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
  if (!issue?.body) {
    log.info("no open review issue");
    return;
  }
  const ticked = parseDecisions(issue.body);
  if (!ticked.size) return;

  const queue = new Map(readJson<Event[]>(PATHS.reviewQueue, []).map((e) => [e.id, e]));
  const decisions = readJson<ReviewDecisions>(PATHS.reviewDecisions, {});
  let applied = 0;
  for (const [id, decision] of ticked) {
    const e = queue.get(id);
    if (!e) continue; // already gone from the queue
    decisions[id] = { decision, decided_at: nowIso(), fingerprint: fingerprint(e), title: e.title };
    applied++;
  }
  // Old decisions refer to events long past; drop them to keep the file small.
  const cutoff = Date.now() - 400 * 86400_000;
  for (const [id, d] of Object.entries(decisions)) if (Date.parse(d.decided_at) < cutoff) delete decisions[id];
  writeJson(PATHS.reviewDecisions, decisions);
  log.info(`${applied} review decision(s) recorded`);
}

main().catch((err) => {
  // Never block ingestion on the issue tracker.
  log.annotate(`review sync failed: ${errorMessage(err)}`);
});
