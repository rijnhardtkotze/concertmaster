import { afterEach, describe, expect, it, vi } from "vitest";
import { ISSUE_LABELS } from "../src/lib/config.ts";
import { GitHub } from "../src/lib/github.ts";

/** Captures the JSON body of each request the client sends. */
function mockFetch() {
  const sent: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ number: 1, title: "t", body: "b", html_url: "u" }), { status: 201 });
    }),
  );
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("GitHub.createIssue labels", () => {
  const gh = new GitHub("token", "owner/repo", "https://api.example");

  it("sends the source-failing label with the issue", async () => {
    const sent = mockFetch();
    await gh.createIssue("Source failing: jpo", "body", ISSUE_LABELS.sourceFailing);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ method: "POST", url: "https://api.example/repos/owner/repo/issues" });
    expect(sent[0]?.body).toEqual({ title: "Source failing: jpo", body: "body", labels: ["ingest-failure"] });
  });

  it("sends the review-queue label with the issue", async () => {
    const sent = mockFetch();
    await gh.createIssue("Review queue", "body", ISSUE_LABELS.reviewQueue);
    expect(sent[0]?.body).toEqual({ title: "Review queue", body: "body", labels: ["review-queue"] });
  });

  it("sends an empty label list when none are given", async () => {
    const sent = mockFetch();
    await gh.createIssue("x", "y");
    expect(sent[0]?.body).toEqual({ title: "x", body: "y", labels: [] });
  });
});
