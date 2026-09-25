import type { Event } from "./schema.ts";
import type { Reject } from "./state.ts";

export const REVIEW_MARKER = "<!-- ingest:review-queue -->";
const MAX_BODY = 60_000; // GitHub's limit is 65,536 characters

function fmtDate(iso: string) {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function eventBlock(e: Event): string {
  const lines = [`#### ${fmtDate(e.start)} · ${e.title}`];
  const where = [e.venue.name, e.venue.city].filter(Boolean).join(", ");
  const links = [`[${e.source.publisher}](${e.source.url})`, ...(e.source.secondary_urls ?? []).map((u, i) => `[alt ${i + 1}](${u})`)];
  if (e.tickets?.url) links.push(`[tickets](${e.tickets.url})`);
  lines.push(`${where} · ${links.join(" · ")} · confidence **${e.confidence.toFixed(2)}**${e.status !== "scheduled" ? ` · status \`${e.status}\`` : ""}`);
  if (e.needs_review?.length) lines.push(`Check: ${e.needs_review.map((p) => `\`${p}\``).join(", ")}`);
  if (e.extraction_notes) lines.push(`> ${e.extraction_notes.replace(/\n/g, " ")}`);
  lines.push(`- [ ] approve \`${e.id}\``, `- [ ] reject \`${e.id}\``);
  return lines.join("\n");
}

/**
 * The review issue body. Regenerated in full every run; ticked boxes are read
 * back by review-sync *before* merge, so nothing a reviewer ticks is lost.
 */
export function renderReviewIssue(queue: Event[], rejects: Reject[], runLink: string | null): string {
  const head = [
    REVIEW_MARKER,
    `**${queue.length} event${queue.length === 1 ? "" : "s"} waiting for review.** Tick **approve** to publish as-is or **reject** to keep it off the site. ` +
      `The next ingest run picks up your ticks; a decision holds until the event's content changes at the source.`,
    "",
    "To correct a field instead, fix it at the source if you can, or add the venue/composer to `data/venues.json` / `data/composers-sa.json` and it will resolve on the next run.",
    runLink ? `\n_Updated by [this run](${runLink})._` : "",
    "",
  ].join("\n");

  const blocks = queue.map(eventBlock);
  let rejectSection = "";
  if (rejects.length) {
    const items = rejects.map((r) => `- **${r.title ?? "(untitled)"}** ${r.start ? `(${r.start.slice(0, 16)})` : ""} [${r.source}](${r.url}): ${r.reasons.join("; ")}`);
    rejectSection = `\n\n<details><summary>${rejects.length} record${rejects.length === 1 ? "" : "s"} rejected by validation (not publishable; fix the source, venue table or prompt)</summary>\n\n${items.join("\n")}\n</details>`;
  }

  let body = head;
  let shown = 0;
  for (const b of blocks) {
    if (body.length + b.length + rejectSection.length + 200 > MAX_BODY) break;
    body += `\n${b}\n`;
    shown++;
  }
  if (shown < blocks.length) body += `\n_…and ${blocks.length - shown} more. Work through these and the rest will appear._\n`;
  if (body.length + rejectSection.length <= MAX_BODY) body += rejectSection;
  return body;
}

/** Ticked decisions in an issue body: id → approve | reject. If both are ticked, reject wins. */
export function parseDecisions(body: string): Map<string, "approve" | "reject"> {
  const out = new Map<string, "approve" | "reject">();
  for (const m of body.matchAll(/^\s*[-*] \[[xX]\] (approve|reject) `([0-9a-f]{16})`/gm)) {
    const [, action, id] = m as unknown as [string, "approve" | "reject", string];
    if (out.get(id) !== "reject") out.set(id, action);
  }
  return out;
}
