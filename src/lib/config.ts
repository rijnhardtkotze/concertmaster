import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The public domain is not settled (classicalmusic.co.za vs concertmaster.co.za,
 * one redirects to the other). Everything that names it reads from here, so a
 * switch is one line. Override per-run with SITE_URL.
 */
export const SITE_URL = process.env.SITE_URL ?? "https://concertmaster.co.za";
export const CRAWLER_PAGE = `${SITE_URL}/about/crawler`;
/** Product token matched against robots.txt groups. Domain-independent on purpose. */
export const BOT_TOKEN = "SAClassicalGuideBot";
export const USER_AGENT = `${BOT_TOKEN}/1.0 (+${CRAWLER_PAGE})`;

export const PATHS = {
  data: path.join(ROOT, "data"),
  raw: path.join(ROOT, "data/raw"),
  extracted: path.join(ROOT, "data/extracted"),
  manifest: path.join(ROOT, "data/manifest.json"),
  sourceStatus: path.join(ROOT, "data/source-status.json"),
  events: path.join(ROOT, "data/events.json"),
  reviewQueue: path.join(ROOT, "data/review-queue.json"),
  reviewDecisions: path.join(ROOT, "data/review-decisions.json"),
  rejects: path.join(ROOT, "data/rejects.json"),
  fuzzyMerges: path.join(ROOT, "data/fuzzy-merges.json"),
  venues: path.join(ROOT, "data/venues.json"),
  composers: path.join(ROOT, "data/composers-sa.json"),
  sources: path.join(ROOT, "sources"),
  work: path.join(ROOT, ".work"),
  normalised: path.join(ROOT, ".work/normalised.json"),
  deduped: path.join(ROOT, ".work/deduped.json"),
  stats: path.join(ROOT, ".work/stats"),
  prompt: path.join(ROOT, "extraction-prompt.md"),
  eventSchema: path.join(ROOT, "event-schema.json"),
} as const;

export const FETCH = {
  minIntervalMs: 2000,
  timeoutMs: 30_000,
  maxBytes: 15 * 1024 * 1024,
  /** Sources fetched concurrently. Per-host rate limiting still applies. */
  sourceConcurrency: 4,
  defaultMaxDocuments: 60,
};

export const EXTRACT = {
  /** Cheap model for clean HTML/JSON; stronger one for PDFs, per extraction-prompt.md. */
  fastModel: process.env.EXTRACT_MODEL_FAST ?? "claude-haiku-4-5",
  strongModel: process.env.EXTRACT_MODEL_STRONG ?? "claude-sonnet-5",
  chunkChars: 40_000,
  maxTokens: 32_000,
  /** A document whose extraction keeps failing is retried this many times per content hash, then parked. */
  maxAttemptsPerHash: 3,
  /** Hard ceiling on LLM calls per run. Protects against a site that changes every page every day. */
  maxCallsPerRun: Number(process.env.EXTRACT_MAX_CALLS ?? 250),
  concurrency: 3,
  /** USD per million tokens, for the cost line in the step summary. Keep in sync with the pricing page. */
  pricing: {
    "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  } as Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>,
};

export const RULES = {
  publishConfidence: 0.75,
  descriptionMax: 400,
  copyrightSpanWords: 12,
  /** Events more than this far ahead are rejected (extraction-prompt.md). */
  horizonMonths: 24,
  fuzzyTitleThreshold: 0.6,
  failuresBeforeIssue: 3,
};

export const REVIEW_ISSUE_TITLE = "Review queue";
/** Written by review-sync on success: the event ids whose ticks it recorded this run. */
export const REVIEW_SYNC_MARKER = PATHS.work + "/review-sync.json";
export const SOURCE_ISSUE_PREFIX = "Source failing:";
/** Labels the pipeline puts on the issues it opens, so ingest problems can be filtered in one view. */
export const ISSUE_LABELS = {
  reviewQueue: ["review-queue"],
  sourceFailing: ["ingest-failure"],
};
