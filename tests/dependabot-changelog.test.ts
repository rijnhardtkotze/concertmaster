import { describe, expect, it } from "vitest";
import {
  type AdvisoryLookup,
  fixedAdvisories,
  fragmentBody,
  fragmentPath,
  fragmentYaml,
  headIsOurFragment,
} from "../scripts/dependabot-changelog.ts";

const cheerio = { dependencyName: "cheerio", packageEcosystem: "npm_and_yarn", prevVersion: "1.2.0", newVersion: "1.3.0" };
const zod = { dependencyName: "zod", packageEcosystem: "npm_and_yarn", prevVersion: "4.1.0", newVersion: "4.2.0" };
const sdk = { dependencyName: "@anthropic-ai/sdk", packageEcosystem: "npm_and_yarn", prevVersion: "0.128.0", newVersion: "0.129.0" };

/** Advisories by `ecosystem:name@version`. */
function lookupFrom(table: Record<string, string[]>): AdvisoryLookup & { calls: string[] } {
  const calls: string[] = [];
  const fn = async (ecosystem: string, name: string, version: string) => {
    const key = `${ecosystem}:${name}@${version}`;
    calls.push(key);
    return table[key] ?? [];
  };
  return Object.assign(fn, { calls });
}

describe("fragmentBody", () => {
  it("names one package and its versions", () => {
    expect(fragmentBody([cheerio], "chore(deps): bump cheerio from 1.2.0 to 1.3.0")).toBe(
      "Updated the cheerio package from 1.2.0 to 1.3.0.",
    );
  });

  it("lists every package in a group", () => {
    expect(fragmentBody([cheerio, zod, sdk], "chore(deps): bump the minor-and-patch group with 3 updates")).toBe(
      "Updated 3 packages: cheerio from 1.2.0 to 1.3.0, zod from 4.1.0 to 4.2.0 and @anthropic-ai/sdk from 0.128.0 to 0.129.0.",
    );
  });

  it("calls GitHub Actions what they are and drops the v prefix", () => {
    const checkout = { dependencyName: "actions/checkout", packageEcosystem: "github_actions", prevVersion: "v7.0.1", newVersion: "v7.1.0" };
    expect(fragmentBody([checkout], "")).toBe("Updated the actions/checkout GitHub Action from 7.0.1 to 7.1.0.");
  });

  it("shortens commit SHAs", () => {
    const pinned = {
      dependencyName: "pnpm/action-setup",
      packageEcosystem: "github_actions",
      prevVersion: "ea17c68df8912ef543352723c149a84f56e3d413",
      newVersion: "3d3c42e5aac5ba805825da76410c181273ba90b1",
    };
    expect(fragmentBody([pinned], "")).toBe("Updated the pnpm/action-setup GitHub Action from ea17c68 to 3d3c42e.");
  });

  it("falls back to the pull request title without its prefix", () => {
    expect(fragmentBody([], "chore(deps-dev): bump vitest from 4.0.0 to 4.1.0")).toBe("Bump vitest from 4.0.0 to 4.1.0.");
  });

  it("names the advisories a security update fixes", () => {
    expect(fragmentBody([cheerio], "", ["GHSA-aaaa-bbbb-cccc"])).toBe(
      "Updated the cheerio package from 1.2.0 to 1.3.0, which fixes the security advisory GHSA-aaaa-bbbb-cccc.",
    );
    expect(fragmentBody([cheerio, zod], "", ["GHSA-1", "GHSA-2"])).toMatch(
      /, which fixes the security advisories GHSA-1 and GHSA-2\.$/,
    );
  });

  it("refuses to write an empty body", () => {
    expect(() => fragmentBody([], "chore(deps): ")).toThrow(/fragment body/);
  });
});

describe("fixedAdvisories", () => {
  it("finds an advisory the old version has and the new one does not", async () => {
    const lookup = lookupFrom({ "npm:cheerio@1.2.0": ["GHSA-x"], "npm:cheerio@1.3.0": [] });
    expect(await fixedAdvisories([cheerio, zod], lookup)).toEqual(["GHSA-x"]);
  });

  it("ignores an advisory the new version still has", async () => {
    const lookup = lookupFrom({ "npm:cheerio@1.2.0": ["GHSA-x"], "npm:cheerio@1.3.0": ["GHSA-x"] });
    expect(await fixedAdvisories([cheerio], lookup)).toEqual([]);
  });

  it("maps Dependabot's ecosystem names and skips SHA pins", async () => {
    const lookup = lookupFrom({});
    await fixedAdvisories(
      [
        { dependencyName: "actions/checkout", packageEcosystem: "github_actions", prevVersion: "v7.0.1", newVersion: "v7.1.0" },
        { dependencyName: "x/y", packageEcosystem: "github_actions", prevVersion: "a".repeat(40), newVersion: "b".repeat(40) },
        { dependencyName: "gem", packageEcosystem: "bundler", prevVersion: "1", newVersion: "2" },
      ],
      lookup,
    );
    expect(lookup.calls).toEqual(["actions:actions/checkout@7.0.1"]);
  });
});

describe("the fragment file", () => {
  const time = new Date("2026-09-26T09:22:34.567Z");

  it("uses changie's file name", () => {
    expect(fragmentPath("Changed", time)).toBe(".changes/unreleased/Changed-20260926-092234.yaml");
  });

  it("quotes the body so any text is valid YAML", () => {
    expect(fragmentYaml("Security", 'Fixes "a": b', time)).toBe(
      'kind: Security\nbody: "Fixes \\"a\\": b"\ntime: 2026-09-26T09:22:34.567Z\n',
    );
  });
});

describe("headIsOurFragment", () => {
  const ours = { author: { login: "github-actions[bot]" }, commit: { message: "changes: add a fragment for #12" } };

  it("recognises this script's own commit on the same pull request", () => {
    expect(headIsOurFragment(ours, 12)).toBe(true);
  });

  it("ignores Dependabot's commits, people's commits and other pull requests", () => {
    expect(headIsOurFragment({ ...ours, author: { login: "dependabot[bot]" } }, 12)).toBe(false);
    expect(headIsOurFragment({ ...ours, author: null }, 12)).toBe(false);
    expect(headIsOurFragment(ours, 13)).toBe(false);
  });
});
