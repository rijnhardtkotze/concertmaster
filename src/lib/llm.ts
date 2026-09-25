import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { EXTRACT, ROOT } from "./config.ts";
import { ExtractionResult } from "./extraction-schema.ts";
import { redact } from "./log.ts";

/** An error that means every further call will fail too (bad key, no credit, unknown model). Abort the stage. */
export class FatalLlmError extends Error {}

export interface ExtractCallResult {
  events: unknown[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/**
 * Models that still accept sampling parameters. The newer ones reject
 * `temperature` with a 400, so temperature: 0 is only sent where it is legal;
 * elsewhere determinism comes from the structured-output schema.
 */
const ACCEPTS_TEMPERATURE = (model: string) => model.startsWith("claude-haiku-4-5");
const ACCEPTS_EFFORT = (model: string) => !model.startsWith("claude-haiku");

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new FatalLlmError("ANTHROPIC_API_KEY is not set");
  // The SDK retries 408/409/429/5xx and connection errors with exponential
  // backoff, honouring retry-after. Six tries rides out a typical 529 burst.
  client ??= new Anthropic({ maxRetries: 6, timeout: 10 * 60_000, logLevel: "off" });
  return client;
}

export function estimateCost(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  const p = EXTRACT.pricing[model];
  if (!p) return 0;
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6;
}

export type ExtractRequest = { model: string; system: string; tables: string; document: string };

/**
 * Which credentials pay for extraction:
 *  - "subscription": headless Claude Code (`claude -p`) with CLAUDE_CODE_OAUTH_TOKEN from
 *    `claude setup-token`, billed to a Claude Pro/Max plan. This is the documented way to use a
 *    subscription in GitHub Actions; the Messages API itself is not.
 *  - "api": the Messages API with ANTHROPIC_API_KEY, billed per token.
 * EXTRACT_BACKEND forces one; otherwise the subscription wins when its token is present.
 */
export function extractBackend(): "subscription" | "api" {
  const forced = process.env.EXTRACT_BACKEND;
  if (forced === "subscription" || forced === "api") return forced;
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return "subscription";
  if (process.env.ANTHROPIC_API_KEY) return "api";
  throw new FatalLlmError("no extraction credentials: set CLAUDE_CODE_OAUTH_TOKEN (Claude subscription) or ANTHROPIC_API_KEY");
}

export function hasExtractCredentials(): boolean {
  return !!(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY);
}

export async function callExtractor(opts: ExtractRequest): Promise<ExtractCallResult> {
  return extractBackend() === "subscription" ? callViaClaudeCode(opts) : callViaApi(opts);
}

async function callViaApi(opts: ExtractRequest): Promise<ExtractCallResult> {
  const anthropic = getClient();
  const params: Anthropic.MessageCreateParams = {
    model: opts.model,
    max_tokens: EXTRACT.maxTokens,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: opts.tables, cache_control: { type: "ephemeral" } },
          { type: "text", text: opts.document },
        ],
      },
    ],
    output_config: {
      format: zodOutputFormat(ExtractionResult),
      ...(ACCEPTS_EFFORT(opts.model) ? { effort: "low" as const } : {}),
    },
    ...(ACCEPTS_TEMPERATURE(opts.model) ? { temperature: 0 } : {}),
  };

  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.stream(params).finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError) {
      throw new FatalLlmError(`Anthropic API: ${redact(err.message)}`, { cause: err });
    }
    if (err instanceof Anthropic.BadRequestError && /credit balance|billing/i.test(err.message)) {
      throw new FatalLlmError(`Anthropic API: ${redact(err.message)}`, { cause: err });
    }
    if (err instanceof Anthropic.APIError) throw new Error(`Anthropic API ${err.status ?? ""}: ${redact(err.message)}`, { cause: err });
    throw err;
  }

  if (message.stop_reason === "refusal") throw new Error("model declined to extract this document (stop_reason=refusal)");
  if (message.stop_reason === "max_tokens") throw new Error(`output truncated at ${EXTRACT.maxTokens} tokens; the document needs smaller chunks`);
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const cleaned = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`model returned non-JSON output (${cleaned.length} chars)`, { cause: err });
  }
  const events = (parsed as { events?: unknown }).events;
  if (!Array.isArray(events)) throw new Error("model output has no events array");

  const u = message.usage;
  const usage = {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
  return {
    events,
    model: message.model,
    inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    costUsd: estimateCost(opts.model, usage),
  };
}

interface ClaudeCodeResult {
  is_error: boolean;
  api_error_status?: number | null;
  result?: string;
  structured_output?: unknown;
  terminal_reason?: string;
  modelUsage?: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>;
}

// Claude Code's validator doesn't know the draft-2020-12 meta-schema Zod stamps on, so drop it.
const { $schema: _metaSchema, ...extractionSchema } = z.toJSONSchema(ExtractionResult);
const EXTRACTION_JSON_SCHEMA = JSON.stringify(extractionSchema);

/**
 * One extraction through headless Claude Code, authenticated by the
 * subscription token. No tools, no settings, no MCP, no session files, run from
 * an empty directory so no CLAUDE.md is picked up: the only context is our
 * system prompt, the reference tables and the document. Sampling parameters
 * can't be set this way, so there is no temperature: 0 on this path.
 */
export async function callViaClaudeCode(opts: ExtractRequest): Promise<ExtractCallResult> {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw new FatalLlmError("CLAUDE_CODE_OAUTH_TOKEN is not set (run `claude setup-token`)");
  const bin = path.join(ROOT, "node_modules/.bin/claude");
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "extract-"));
  const env: NodeJS.ProcessEnv = { ...process.env, DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1" };
  delete env.ANTHROPIC_API_KEY; // an API key would take precedence and bill per token instead

  const args = [
    "-p",
    "--output-format", "json",
    "--json-schema", EXTRACTION_JSON_SCHEMA,
    "--system-prompt", opts.system,
    "--tools", "",
    "--model", opts.model,
    "--setting-sources", "",
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 15 * 60_000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => reject(new FatalLlmError(`could not start Claude Code: ${e.message}`)));
    child.on("close", (code) => {
      clearTimeout(timer);
      fs.rmSync(cwd, { recursive: true, force: true });
      if (out.trim()) resolve(out);
      else reject(new Error(`Claude Code exited ${code} with no output: ${redact(err.slice(0, 400))}`));
    });
    child.stdin.end(`${opts.tables}\n\n${opts.document}`);
  });

  let r: ClaudeCodeResult;
  try {
    r = JSON.parse(stdout) as ClaudeCodeResult;
  } catch (e) {
    throw new Error(`Claude Code returned non-JSON output (${stdout.length} chars)`, { cause: e });
  }
  if (r.is_error) {
    const msg = redact(r.result ?? r.terminal_reason ?? "unknown error");
    const status = r.api_error_status ?? 0;
    // Bad or expired token, or the plan's usage limit: every further call fails too. Stop and
    // leave the rest for the next run (unextracted documents are retried; nothing is lost).
    if (status === 401 || status === 403 || status === 429 || /usage limit|limit reached|authenticat|expired/i.test(msg)) {
      throw new FatalLlmError(`Claude subscription: ${msg}`);
    }
    throw new Error(`Claude Code: ${msg}`);
  }
  const parsed = (r.structured_output ?? (r.result ? JSON.parse(r.result) : null)) as { events?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.events)) throw new Error("Claude Code output has no events array");

  const usage = Object.values(r.modelUsage ?? {}).reduce(
    (t, u) => ({ input: t.input + u.inputTokens, output: t.output + u.outputTokens, cacheRead: t.cacheRead + u.cacheReadInputTokens, cacheWrite: t.cacheWrite + u.cacheCreationInputTokens }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
  return {
    events: parsed.events,
    model: Object.keys(r.modelUsage ?? {})[0] ?? opts.model,
    inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    costUsd: 0, // covered by the subscription; tokens are still reported
  };
}
