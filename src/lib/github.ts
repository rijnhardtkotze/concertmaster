import { redact } from "./log.ts";

/**
 * Minimal GitHub REST client for the two issue workflows. Uses the Actions
 * GITHUB_TOKEN; returns null from `fromEnv` locally so stages degrade to stdout.
 */
export interface Issue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  pull_request?: unknown;
}

export class GitHub {
  constructor(
    private readonly token: string,
    readonly repo: string,
    private readonly api = process.env.GITHUB_API_URL ?? "https://api.github.com",
  ) {}

  static fromEnv(): GitHub | null {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    return token && repo ? new GitHub(token, repo) : null;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.api}/repos/${this.repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${res.status} ${redact((await res.text()).slice(0, 300))}`);
    return (await res.json()) as T;
  }

  async openIssues(): Promise<Issue[]> {
    const out: Issue[] = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await this.req<Issue[]>("GET", `/issues?state=open&per_page=100&page=${page}`);
      out.push(...batch.filter((i) => !i.pull_request));
      if (batch.length < 100) break;
    }
    return out;
  }

  async findOpenIssue(title: string): Promise<Issue | undefined> {
    return (await this.openIssues()).find((i) => i.title === title);
  }

  createIssue(title: string, body: string, labels: string[] = []) {
    return this.req<Issue>("POST", "/issues", { title, body, labels });
  }

  updateIssue(number: number, patch: { body?: string; state?: "open" | "closed"; state_reason?: string; labels?: string[] }) {
    return this.req<Issue>("PATCH", `/issues/${number}`, patch);
  }

  comment(number: number, body: string) {
    return this.req<unknown>("POST", `/issues/${number}/comments`, { body });
  }
}

export function runUrl(): string | null {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  return GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : null;
}
