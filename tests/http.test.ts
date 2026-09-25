import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PoliteClient, RobotsDisallowed } from "../src/lib/http.ts";

/** Two local origins: A redirects to B; B's robots.txt forbids everything. */
let a: http.Server;
let b: http.Server;
let aUrl = "";
let bUrl = "";
const hits: string[] = [];

const listen = (s: http.Server) => new Promise<string>((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));

beforeAll(async () => {
  b = http.createServer((req, res) => {
    hits.push(`b${req.url}`);
    if (req.url === "/robots.txt") return res.end("User-agent: *\nDisallow: /private\n");
    res.end("<main>ok</main>");
  });
  bUrl = await listen(b);
  a = http.createServer((req, res) => {
    hits.push(`a${req.url}`);
    if (req.url === "/robots.txt") return res.end("User-agent: *\nAllow: /\n");
    if (req.url === "/moved") return res.writeHead(302, { location: `${bUrl}/private/page` }).end();
    if (req.url === "/fine") return res.writeHead(301, { location: `${bUrl}/public` }).end();
    if (req.url === "/huge") {
      // No Content-Length: chunked, and far bigger than the cap used in the test.
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = "x".repeat(64 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < 200 && res.write(chunk)) sent++;
        if (sent < 200) res.once("drain", pump);
        else res.end();
      };
      res.on("close", () => (sent = 200));
      return pump();
    }
    res.end("hi");
  });
  aUrl = await listen(a);
});
afterAll(() => {
  a.close();
  b.close();
});

describe("PoliteClient redirects", () => {
  it("checks the destination origin's robots.txt before following a cross-origin redirect", async () => {
    const client = new PoliteClient(0, undefined, true);
    await expect(client.get(`${aUrl}/moved`)).rejects.toBeInstanceOf(RobotsDisallowed);
    expect(hits).toContain("b/robots.txt");
    expect(hits).not.toContain("b/private/page");
  });

  it("follows an allowed cross-origin redirect and reports the final URL", async () => {
    const res = await new PoliteClient(0, undefined, true).get(`${aUrl}/fine`);
    expect(res.status).toBe(200);
    expect(res.url).toBe(`${bUrl}/public`);
    expect(res.body.toString()).toContain("ok");
  });

  it("stops reading at the size cap even without a Content-Length header", async () => {
    const client = new PoliteClient(0, 256 * 1024, true);
    await expect(client.get(`${aUrl}/huge`)).rejects.toThrow(/too large/);
  });
});
