/**
 * All pipeline output goes through here so secrets can't leak into CI logs,
 * committed data or the step summary. GitHub masks registered secrets too;
 * this is the belt to that pair of braces.
 */
const SECRET_PATTERNS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-[REDACTED]"],
  [/([?&](?:api_key|apikey|key|token|usertoken)=)[^&\s"']+/gi, "$1[REDACTED]"],
  [/(x-api-key|authorization|usertoken)(["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, "$1$2[REDACTED]"],
];

export function redact(input: string): string {
  let out = input;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  for (const name of ["ANTHROPIC_API_KEY", "QUICKET_API_KEY", "GITHUB_TOKEN"]) {
    const v = process.env[name];
    if (v && v.length >= 8) out = out.split(v).join(`[${name}]`);
  }
  return out;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return redact(err.message);
  return redact(String(err));
}

function emit(level: string, scope: string, msg: string) {
  const line = redact(`[${level}] ${scope}: ${msg}`);
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export function logger(scope: string) {
  return {
    info: (msg: string) => emit("info", scope, msg),
    warn: (msg: string) => emit("warn", scope, msg),
    error: (msg: string) => emit("error", scope, msg),
    /** GitHub Actions annotation, so per-source failures show on the run page. */
    annotate: (msg: string) => {
      if (process.env.GITHUB_ACTIONS) console.log(`::warning title=${scope}::${redact(msg).replace(/\n/g, " ")}`);
      else emit("warn", scope, msg);
    },
  };
}
