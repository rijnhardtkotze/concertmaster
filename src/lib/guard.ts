import { RULES } from "./config.ts";
import { sharedSpan, shingles } from "./text.ts";

/**
 * Copyright guard: a description that shares any 12-word span with the source
 * document is presumed copied marketing copy. Returns the offending span, or null.
 */
export function copiedSpan(description: string | null | undefined, sourceText: string | Set<string>): string | null {
  if (!description) return null;
  return sharedSpan(description, sourceText, RULES.copyrightSpanWords);
}

export function sourceShingles(text: string): Set<string> {
  return shingles(text, RULES.copyrightSpanWords);
}
