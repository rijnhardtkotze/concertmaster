import fs from "node:fs";
import { htmlAdapter } from "../adapters/html.ts";
import { quicketAdapter } from "../adapters/quicket.ts";
import type { Adapter, AdapterContext, BodyResult, FetchedDocument } from "../adapters/types.ts";
import { FETCH } from "../lib/config.ts";
import { docId, sha256 } from "../lib/hash.ts";
import { PoliteClient, RobotsDisallowed } from "../lib/http.ts";
import { errorMessage, logger } from "../lib/log.ts";
import { loadSources, parseArgs, type SourceConfig } from "../lib/sources.ts";
import {
  bump,
  emptyStatus,
  loadManifest,
  loadSourceStatus,
  note,
  rawPaths,
  saveManifest,
  saveSourceStatus,
  writeStats,
  type Manifest,
  type SourceRunStats,
  type SourceStatusMap,
} from "../lib/state.ts";
import { nowIso } from "../lib/time.ts";

const ADAPTERS: Record<string, Adapter> = { html: htmlAdapter, quicket: quicketAdapter };
const log = logger("fetch");

function makeContext(
  client: PoliteClient,
  manifest: Manifest,
  source: SourceConfig,
  stats: Record<string, SourceRunStats>,
  kept: Set<string>,
): AdapterContext {
  return {
    keepPrevious: (url) => {
      if (manifest[url]?.source !== source.slug) return false;
      kept.add(url);
      return true;
    },
    client,
    manifest,
    warn: (msg) => {
      log.warn(`${source.slug}: ${msg}`);
      note(stats, source.slug, "warnings", msg);
    },
    async getBody(url: string): Promise<BodyResult> {
      const prev = manifest[url];
      const cached = prev ? rawPaths(prev.source, prev.doc_id).raw : null;
      // Only send conditional headers if we still hold the body to fall back on
      // (the raw cache is an Actions cache and can be evicted at any time).
      const haveCache = !!cached && fs.existsSync(cached);
      const res = await client.get(url, haveCache ? { etag: prev!.etag, lastModified: prev!.last_modified } : {});
      const base = {
        finalUrl: res.url || url,
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
      };
      if (res.status === 304 && haveCache) {
        return { ...base, body: fs.readFileSync(cached!), contentType: prev!.kind === "pdf" ? "application/pdf" : "text/html", notModified: true, etag: prev!.etag, lastModified: prev!.last_modified };
      }
      return { ...base, body: res.body, contentType: res.headers.get("content-type") ?? "", notModified: false };
    },
  };
}

function record(doc: FetchedDocument, source: string, manifest: Manifest, at: string): "changed" | "unchanged" {
  const id = docId(doc.url);
  const p = rawPaths(source, id);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.text, doc.text);
  if (doc.raw) fs.writeFileSync(p.raw, doc.raw);
  const hash = sha256(doc.text);
  const prev = manifest[doc.url];
  const changed = !prev || prev.content_hash !== hash;
  manifest[doc.url] = {
    source,
    doc_id: id,
    kind: doc.kind,
    etag: doc.etag ?? null,
    last_modified: doc.lastModified ?? null,
    content_hash: hash,
    raw_hash: doc.raw ? sha256(doc.raw) : null,
    content_changed_at: changed ? at : prev!.content_changed_at,
    last_fetched: at,
  };
  return changed ? "changed" : "unchanged";
}

async function runSource(
  source: SourceConfig,
  client: PoliteClient,
  manifest: Manifest,
  statusMap: SourceStatusMap,
  stats: Record<string, SourceRunStats>,
) {
  const at = nowIso();
  const status = (statusMap[source.slug] ??= emptyStatus());
  status.last_attempt = at;
  stats[source.slug] ??= {};
  try {
    const adapter = ADAPTERS[source.adapter.type];
    if (!adapter) throw new Error(`unknown adapter type ${source.adapter.type}`);
    // Check the source's own homepage first so a blanket disallow skips the whole source.
    await client.checkRobots(source.adapter.type === "html" ? source.adapter.startUrls[0]! : source.homepage);
    const kept = new Set<string>();
    const docs = await adapter(source, makeContext(client, manifest, source, stats, kept));
    const unique = new Map(docs.map((d) => [d.url, d]));
    if (!unique.size && !kept.size && !source.allowEmpty) {
      throw new Error("0 documents discovered; the listing layout or selector has probably changed");
    }
    for (const doc of unique.values()) {
      const r = record(doc, source.slug, manifest, at);
      bump(stats, source.slug, "documents_fetched");
      bump(stats, source.slug, r === "changed" ? "documents_changed" : "documents_unchanged");
    }
    status.documents = [...new Set([...unique.keys(), ...kept])].sort();
    status.consecutive_failures = 0;
    status.last_error = null;
    status.last_success = at;
    log.info(`${source.slug}: ${unique.size} documents (${stats[source.slug]!.documents_changed ?? 0} changed)`);
  } catch (err) {
    // Fail soft: keep the previous document set so a dead site doesn't make its events vanish.
    const msg = err instanceof RobotsDisallowed ? `robots.txt: ${errorMessage(err)}` : errorMessage(err);
    status.consecutive_failures += 1;
    status.last_error = msg;
    note(stats, source.slug, "errors", msg);
    log.annotate(`${source.slug} failed (${status.consecutive_failures} in a row): ${msg}`);
  }
}

async function main() {
  const args = parseArgs();
  const sources = await loadSources(args.source);
  const manifest = loadManifest();
  const statusMap = loadSourceStatus();
  const client = new PoliteClient();
  const stats: Record<string, SourceRunStats> = {};

  const queue = [...sources];
  await Promise.all(
    Array.from({ length: Math.min(FETCH.sourceConcurrency, queue.length) }, async () => {
      for (let s = queue.shift(); s; s = queue.shift()) await runSource(s, client, manifest, statusMap, stats);
    }),
  );

  saveManifest(manifest);
  saveSourceStatus(statusMap);
  writeStats("fetch", { sources: stats });
}

main().catch((err) => {
  log.error(errorMessage(err));
  process.exit(1);
});
