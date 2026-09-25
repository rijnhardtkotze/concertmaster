import type { Event } from "./schema.ts";
import type { Reject } from "./state.ts";

export const REVIEW_MARKER = "<!-- ingest:review-queue -->";
const MAX_BODY = 60_000; // GitHub's limit is 65,536 characters

function fmtDate(iso: string) {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

/**
 * Everything interpolated into the issue body comes, one way or another, from scraped
 * pages or the model. Flatten it to a single inert line: no line breaks (so it can never
 * start a checkbox line that parseDecisions would read as a reviewer's tick), no HTML,
 * no backticks, and no checkbox-looking brackets.
 */
export function inert(value: unknown, max = 300): string {
  const s = String(value ?? "")
    .replace(/[\r\n\u0085\u2028\u2029\t\v\f]+/g, " ")
    .replace(/[<>]/g, (c) => (c === "<" ? "‹" : "›"))
    .replace(/`/g, "'")
    .replace(/\[( |x|X)\]/g, "($1)")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A URL safe to put in a Markdown link target. */
function inertUrl(u: string): string {
  try {
    const url = new URL(u);
    return /^https?:$/.test(url.protocol) ? url.toString().replace(/[()\s<>`]/g, encodeURIComponent) : "#";
  } catch {
    return "#";
  }
}

function eventBlock(e: Event, ticked?: "approve" | "reject"): string {
  const lines = [`#### ${fmtDate(e.start)} · ${inert(e.title)}`];
  const where = inert([e.venue.name, e.venue.city].filter(Boolean).join(", "));
  const links = [`[${inert(e.source.publisher)}](${inertUrl(e.source.url)})`, ...(e.source.secondary_urls ?? []).map((u, i) => `[alt ${i + 1}](${inertUrl(u)})`)];
  if (e.tickets?.url) links.push(`[tickets](${inertUrl(e.tickets.url)})`);
  lines.push(`${where} · ${links.join(" · ")} · confidence **${e.confidence.toFixed(2)}**${e.status !== "scheduled" ? ` · status \`${e.status}\`` : ""}`);
  if (e.needs_review?.length) lines.push(`Check: ${e.needs_review.map((p) => `\`${inert(p, 80)}\``).join(", ")}`);
  if (e.extraction_notes) lines.push(`> ${inert(e.extraction_notes)}`);
  lines.push(`- [${ticked === "approve" ? "x" : " "}] approve \`${e.id}\``, `- [${ticked === "reject" ? "x" : " "}] reject \`${e.id}\``);
  return lines.join("\n");
}

/**
 * The review issue body, regenerated in full every run. Ticked boxes are read back by
 * review-sync *before* merge. `carryTicks`: boxes ticked in the current issue that no run
 * has recorded yet (a failed review-sync, or a tick made mid-run); they are rendered
 * ticked again so a rewrite never throws a reviewer's decision away.
 *
 * Space goes to the actionable part first: event checkboxes, then as much of the
 * rejected-records appendix as still fits.
 */
export function renderReviewIssue(queue: Event[], rejects: Reject[], runLink: string | null, carryTicks: Map<string, "approve" | "reject"> = new Map()): string {
  const head = [
    REVIEW_MARKER,
    `**${queue.length} event${queue.length === 1 ? "" : "s"} waiting for review.** Tick **approve** to publish as-is or **reject** to keep it off the site. ` +
      `The next ingest run picks up your ticks; a decision holds until the event's content changes at the source.`,
    "",
    "To correct a field instead, fix it at the source if you can, or add the venue/composer to `data/venues.json` / `data/composers-sa.json` and it will resolve on the next run.",
    runLink ? `\n_Updated by [this run](${inertUrl(runLink)})._` : "",
    "",
  ].join("\n");

  const RESERVE = 400; // room for the "…and N more" lines
  let body = head;
  let shown = 0;
  for (const e of queue) {
    const b = `\n${eventBlock(e, carryTicks.get(e.id))}\n`;
    if (body.length + b.length + RESERVE > MAX_BODY) break;
    body += b;
    shown++;
  }
  if (shown < queue.length) body += `\n_…and ${queue.length - shown} more. Work through these and the rest will appear._\n`;

  if (rejects.length) {
    const open = `\n\n<details><summary>${rejects.length} record${rejects.length === 1 ? "" : "s"} rejected by validation (not publishable; fix the source, venue table or prompt)</summary>\n\n`;
    const close = "\n</details>";
    let section = open;
    let listed = 0;
    for (const r of rejects) {
      const item = `- **${inert(r.title ?? "(untitled)", 120)}** ${r.start ? `(${inert(r.start.slice(0, 16))})` : ""} [${inert(r.source)}](${inertUrl(r.url)}): ${inert(r.reasons.join("; "), 400)}\n`;
      if (body.length + section.length + item.length + close.length + 100 > MAX_BODY) break;
      section += item;
      listed++;
    }
    if (listed < rejects.length) section += `- …and ${rejects.length - listed} more in \`data/rejects.json\`\n`;
    if (body.length + section.length + close.length <= MAX_BODY) body += section + close;
  }
  return body;
}

/** Ticked decisions in an issue body: id → approve | reject. If both are ticked, reject wins. */
export function parseDecisions(body: string): Map<string, "approve" | "reject"> {
  const out = new Map<string, "approve" | "reject">();
  // Exactly the line eventBlock writes, and nothing else on it.
  for (const m of body.matchAll(/^- \[[xX]\] (approve|reject) `([0-9a-f]{16})`[ \t\r]*$/gm)) {
    const [, action, id] = m as unknown as [string, "approve" | "reject", string];
    if (out.get(id) !== "reject") out.set(id, action);
  }
  return out;
}
