#!/usr/bin/env node
// Fails if any file about to be committed contains something shaped like an
// Anthropic API key. Runs as the pre-commit hook, in PR CI over the whole
// tree, and in the ingest workflow right before the bot commits.
//
//   node scripts/check-secrets.mjs           # staged files (pre-commit)
//   node scripts/check-secrets.mjs --all     # every tracked + untracked, non-ignored file
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const PATTERN = /sk-ant-[a-z0-9]{2,10}-[A-Za-z0-9_-]{20,}/;
const all = process.argv.includes("--all");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).split("\0").filter(Boolean);
const files = all
  ? git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
  : git("diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR");

const hits = [];
for (const f of files) {
  let text;
  try {
    const buf = fs.readFileSync(f);
    if (buf.includes(0)) continue; // binary
    text = buf.toString("utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (PATTERN.test(line)) hits.push(`${f}:${i + 1}`);
  });
}

if (hits.length) {
  console.error("Possible Anthropic API key found. Commit blocked:");
  for (const h of hits) console.error(`  ${h}`);
  console.error("Remove it, and if it was ever pushed anywhere, revoke it at console.anthropic.com.");
  process.exit(1);
}
console.log(`check-secrets: ${files.length} file(s) clean`);
