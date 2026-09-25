import { PATHS, REVIEW_ISSUE_TITLE, REVIEW_SYNC_MARKER, RULES, SOURCE_ISSUE_PREFIX } from "../lib/config.ts";
import { GitHub, runUrl } from "../lib/github.ts";
import { readJson } from "../lib/json.ts";
import { errorMessage, logger, redact } from "../lib/log.ts";
import { parseDecisions, renderReviewIssue } from "../lib/review-issue.ts";
import type { Event } from "../lib/schema.ts";
import { loadSources } from "../lib/sources.ts";
import { loadSourceStatus, type Reject } from "../lib/state.ts";

const log = logger("notify");

/**
 * Runs after the commit is pushed:
 *  - upserts the single "Review queue" issue (closes it when the queue is empty)
 *  - opens/updates a "Source failing: <slug>" issue after N consecutive failures,
 *    and closes it with a comment when the source recovers
 */
async function main() {
  const gh = GitHub.fromEnv();
  if (!gh) {
    log.info("no GITHUB_TOKEN/GITHUB_REPOSITORY; nothing to notify");
    return;
  }
  const open = await gh.openIssues();
  const link = runUrl();

  const queue = readJson<Event[]>(PATHS.reviewQueue, []);
  const rejects = readJson<Reject[]>(PATHS.rejects, []);
  const review = open.find((i) => i.title === REVIEW_ISSUE_TITLE);
  const committed = process.env.DATA_COMMITTED === "true";
  if (!committed) {
    // The local queue reflects decisions that were never saved: rendering from it would drop
    // those events' ticks (or close the issue) and lose the reviewer's choices. Leave the
    // issue exactly as it is; the next successful run re-reads it.
    log.warn("data was not committed this run; leaving the review issue unchanged");
  } else if (queue.length || rejects.length) {
    // Ticks this run didn't record (review-sync failed, or a box was ticked while the run
    // was going) are carried into the rewritten body. Ticks it did record are not: if that
    // event is still in the queue, its content changed this run and needs a fresh look.
    const synced = new Set(readJson<{ recorded: string[] }>(REVIEW_SYNC_MARKER, { recorded: [] }).recorded);
    const pending = new Map([...parseDecisions(review?.body ?? "")].filter(([id]) => !synced.has(id)));
    if (pending.size) log.warn(`${pending.size} review tick(s) not yet recorded; keeping them in the issue`);
    const body = redact(renderReviewIssue(queue, rejects, link, pending));
    if (!review) log.info(`opened ${(await gh.createIssue(REVIEW_ISSUE_TITLE, body)).html_url}`);
    else if (review.body !== body) await gh.updateIssue(review.number, { body });
  } else if (review) {
    await gh.updateIssue(review.number, { body: "Queue is empty. 🎉", state: "closed", state_reason: "completed" });
  }

  const status = loadSourceStatus();
  for (const s of await loadSources()) {
    const st = status[s.slug];
    if (!st) continue;
    const title = `${SOURCE_ISSUE_PREFIX} ${s.slug}`;
    const issue = open.find((i) => i.title === title);
    if (st.consecutive_failures >= RULES.failuresBeforeIssue) {
      const body = redact(
        [
          `**${s.name}** (\`sources/${s.slug}.ts\`) has failed **${st.consecutive_failures} runs in a row**. Three in a row is a broken selector or a blocked crawler, not a blip.`,
          "",
          `Last error:\n\n\`\`\`\n${st.last_error ?? "(none recorded)"}\n\`\`\``,
          "",
          `Last success: ${st.last_success ?? "never"} · Last attempt: ${st.last_attempt ?? "?"}${link ? ` · [latest run](${link})` : ""}`,
          "",
          `Its ${st.documents.length} previously known documents are being kept, so published events stay up (and turn \`unconfirmed\` only if a successful fetch shows them gone).`,
          `Reproduce locally: \`pnpm run fetch -- --source ${s.slug}\`. This issue closes itself when the source recovers.`,
        ].join("\n"),
      );
      if (!issue) {
        log.info(`opened ${(await gh.createIssue(title, body)).html_url}`);
      } else {
        const lastError = /Last error:\n\n```\n([\s\S]*?)\n```/.exec(issue.body ?? "")?.[1];
        if (lastError !== undefined && lastError !== (st.last_error ?? "(none recorded)")) {
          await gh.comment(issue.number, redact(`The failure changed:\n\n\`\`\`\n${st.last_error}\n\`\`\``));
        }
        await gh.updateIssue(issue.number, { body });
      }
    } else if (issue && st.consecutive_failures === 0) {
      await gh.comment(issue.number, `Recovered: ${s.slug} fetched successfully${link ? ` in [this run](${link})` : ""}.`);
      await gh.updateIssue(issue.number, { state: "closed", state_reason: "completed" });
    }
  }
}

main().catch((err) => {
  log.annotate(`notify failed: ${errorMessage(err)}`);
  process.exitCode = 1;
});
