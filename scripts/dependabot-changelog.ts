// Commits a changie fragment to a Dependabot pull request, then re-runs ci.yml on it.
// Run by .github/workflows/dependabot-changelog.yml, with plain `node` and no install:
// it holds a write token, so it imports Node built-ins only and never runs the
// pull request's dependencies.
//
// The kind is Security when the update moves a dependency off a version that a GitHub
// advisory affects, and Changed otherwise. GITHUB_TOKEN cannot read Dependabot alerts,
// so the public advisory database stands in for them.
import { pathToFileURL } from "node:url";

/** One entry of dependabot/fetch-metadata's `updated-dependencies-json` output. */
export interface UpdatedDependency {
  dependencyName: string;
  packageEcosystem?: string;
  prevVersion?: string;
  newVersion?: string;
}

export type FragmentKind = "Security" | "Changed";

/** Returns the GHSA ids of the advisories that affect `name@version`. */
export type AdvisoryLookup = (ecosystem: string, name: string, version: string) => Promise<string[]>;

/** Dependabot's ecosystem names, mapped to the advisory database's. */
const ADVISORY_ECOSYSTEMS: Record<string, string> = {
  npm_and_yarn: "npm",
  npm: "npm",
  github_actions: "actions",
  "github-actions": "actions",
};

const NOUNS: Record<string, [string, string]> = {
  npm: ["package", "packages"],
  actions: ["GitHub Action", "GitHub Actions"],
};

const isSha = (v: string) => /^[0-9a-f]{40}$/i.test(v);
const cleanVersion = (v: string) => (isSha(v) ? v.slice(0, 7) : v.replace(/^v(?=\d)/, ""));

function advisoryEcosystem(dep: UpdatedDependency): string | undefined {
  return dep.packageEcosystem ? ADVISORY_ECOSYSTEMS[dep.packageEcosystem] : undefined;
}

/**
 * The advisories the update fixes: those that affect the old version but not the new one.
 * A dependency pinned to a commit SHA has no version to look up, so it fixes none.
 */
export async function fixedAdvisories(deps: UpdatedDependency[], lookup: AdvisoryLookup): Promise<string[]> {
  const fixed = new Set<string>();
  for (const dep of deps) {
    const ecosystem = advisoryEcosystem(dep);
    const { prevVersion, newVersion } = dep;
    if (!ecosystem || !prevVersion || !newVersion || isSha(prevVersion) || isSha(newVersion)) continue;
    const before = await lookup(ecosystem, dep.dependencyName, cleanVersion(prevVersion));
    if (before.length === 0) continue;
    const after = new Set(await lookup(ecosystem, dep.dependencyName, cleanVersion(newVersion)));
    for (const id of before) if (!after.has(id)) fixed.add(id);
  }
  return [...fixed].sort();
}

/** " from 1.2.0 to 1.3.0", or whichever part of it Dependabot gave. */
function versions(dep: UpdatedDependency): string {
  const from = dep.prevVersion ? ` from ${cleanVersion(dep.prevVersion)}` : "";
  const to = dep.newVersion ? ` to ${cleanVersion(dep.newVersion)}` : "";
  return `${from}${to}`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Falls back to the pull request title, minus Dependabot's conventional-commit prefix. */
function fromTitle(title: string): string {
  const text = title.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "").trim();
  if (!text) return "";
  const sentence = text[0]!.toUpperCase() + text.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** The fragment body, written for someone reading the release notes. */
export function fragmentBody(deps: UpdatedDependency[], title: string, fixed: string[] = []): string {
  let body: string;
  if (deps.length === 0) {
    body = fromTitle(title);
  } else {
    const first = deps[0]!;
    const ecosystem = advisoryEcosystem(first);
    const [one, many] = (ecosystem && NOUNS[ecosystem]) || ["dependency", "dependencies"];
    body =
      deps.length === 1
        ? `Updated the ${first.dependencyName} ${one}${versions(first)}.`
        : `Updated ${deps.length} ${many}: ${list(deps.map((d) => `${d.dependencyName}${versions(d)}`))}.`;
  }
  if (!body) throw new Error("Could not write a fragment body: no dependency metadata and no pull request title.");
  if (fixed.length > 0) {
    body = `${body.slice(0, -1)}, which fixes ${fixed.length === 1 ? "the security advisory" : "the security advisories"} ${list(fixed)}.`;
  }
  return body;
}

/** changie's file name for a fragment: `<Kind>-<yyyymmdd>-<hhmmss>.yaml`, in UTC. */
export function fragmentPath(kind: FragmentKind, time: Date): string {
  const stamp = time.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `.changes/unreleased/${kind}-${stamp}.yaml`;
}

/** The fragment itself. JSON strings are valid YAML double-quoted scalars. */
export function fragmentYaml(kind: FragmentKind, body: string, time: Date): string {
  return `kind: ${kind}\nbody: ${JSON.stringify(body)}\ntime: ${time.toISOString()}\n`;
}

/** The message of the commit this script makes. */
export function fragmentCommitMessage(prNumber: number): string {
  return `changes: add a fragment for #${prNumber}`;
}

/**
 * Whether the pull request's head is this script's own fragment commit. Then a re-run
 * must dispatch ci.yml again, since the last run may have committed and failed to dispatch.
 */
export function headIsOurFragment(
  head: { author: { login: string } | null; commit: { message: string } },
  prNumber: number,
): boolean {
  return head.author?.login === "github-actions[bot]" && head.commit.message === fragmentCommitMessage(prNumber);
}

interface Env {
  token: string;
  repository: string;
  prNumber: number;
  baseRef: string;
  headRef: string;
  title: string;
  deps: UpdatedDependency[];
}

function readEnv(env: NodeJS.ProcessEnv): Env {
  const need = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set.`);
    return value;
  };
  const raw = env.UPDATED_DEPENDENCIES_JSON?.trim();
  return {
    token: need("GITHUB_TOKEN"),
    repository: need("GITHUB_REPOSITORY"),
    prNumber: Number(need("PR_NUMBER")),
    baseRef: need("BASE_REF"),
    headRef: need("HEAD_REF"),
    title: env.PR_TITLE ?? "",
    deps: raw ? (JSON.parse(raw) as UpdatedDependency[]) : [],
  };
}

function api(token: string) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? undefined : res.json();
  };
}

async function main(): Promise<void> {
  const env = readEnv(process.env);
  const call = api(env.token);
  const repo = `/repos/${env.repository}`;

  // A push made with GITHUB_TOKEN starts no pull_request run that goes ahead without a
  // person's approval, so the checks would not see the fragment on their own.
  // workflow_dispatch is an event that token can start outright.
  const dispatch = async () => {
    await call("POST", `${repo}/actions/workflows/ci.yml/dispatches`, {
      ref: env.headRef,
      inputs: { base_ref: env.baseRef },
    });
    console.log(`Dispatched ci.yml on ${env.headRef}.`);
  };

  // A pull request that already adds a fragment gets no second one. This covers reopened
  // pull requests, and branches a person has already fixed. If the head is our own
  // fragment commit, this is a re-run after a failed dispatch, so dispatch again.
  for (let page = 1; ; page++) {
    const files = (await call("GET", `${repo}/pulls/${env.prNumber}/files?per_page=100&page=${page}`)) as {
      filename: string;
      status: string;
    }[];
    const existing = files.find((f) => f.status === "added" && /^\.changes\/unreleased\/[^/]+\.yaml$/.test(f.filename));
    if (existing) {
      console.log(`#${env.prNumber} already adds ${existing.filename}.`);
      const pr = (await call("GET", `${repo}/pulls/${env.prNumber}`)) as { head: { sha: string } };
      const head = (await call("GET", `${repo}/commits/${pr.head.sha}`)) as Parameters<typeof headIsOurFragment>[0];
      if (headIsOurFragment(head, env.prNumber)) await dispatch();
      return;
    }
    if (files.length < 100) break;
  }

  const lookup: AdvisoryLookup = async (ecosystem, name, version) => {
    const query = new URLSearchParams({ ecosystem, affects: `${name}@${version}`, per_page: "100" });
    const advisories = (await call("GET", `/advisories?${query}`)) as { ghsa_id: string; withdrawn_at: string | null }[];
    return advisories.filter((a) => !a.withdrawn_at).map((a) => a.ghsa_id);
  };
  const fixed = await fixedAdvisories(env.deps, lookup);
  const kind: FragmentKind = fixed.length > 0 ? "Security" : "Changed";
  const body = fragmentBody(env.deps, env.title, fixed);
  const now = new Date();
  const path = fragmentPath(kind, now);

  await call("PUT", `${repo}/contents/${path}`, {
    message: fragmentCommitMessage(env.prNumber),
    content: Buffer.from(fragmentYaml(kind, body, now)).toString("base64"),
    branch: env.headRef,
  });
  console.log(`Committed ${path} (${kind}): ${body}`);
  await dispatch();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
