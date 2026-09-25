import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { EXTRACT } from "./config.ts";
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

export async function callExtractor(opts: { model: string; system: string; tables: string; document: string }): Promise<ExtractCallResult> {
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
