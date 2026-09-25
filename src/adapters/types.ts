import type { PoliteClient } from "../lib/http.ts";
import type { Manifest } from "../lib/state.ts";
import type { SourceConfig } from "../lib/sources.ts";

export interface FetchedDocument {
  /** Canonical URL. Never contains credentials: it is a manifest key and ends up in events.json. */
  url: string;
  kind: "html" | "pdf" | "json" | "text";
  /** Text handed to the extractor. */
  text: string;
  raw?: Buffer;
  etag?: string | null;
  lastModified?: string | null;
}

export interface BodyResult {
  body: Buffer;
  contentType: string;
  finalUrl: string;
  etag: string | null;
  lastModified: string | null;
  /** True when the server said 304 and we reused the cached copy. */
  notModified: boolean;
}

export interface AdapterContext {
  client: PoliteClient;
  manifest: Manifest;
  /** Conditional GET that falls back to the cached raw body on 304, and refetches if the cache is gone. */
  getBody(url: string): Promise<BodyResult>;
  warn(msg: string): void;
  /**
   * A known document couldn't be refreshed this run: keep it in the source's live set
   * (with its last content) instead of treating it as gone. Returns false for URLs we
   * have never fetched, which are simply skipped.
   */
  keepPrevious(url: string): boolean;
  /** The source's live document URLs as of its last run. */
  previousDocuments(): string[];
}

export type Adapter = (source: SourceConfig, ctx: AdapterContext) => Promise<FetchedDocument[]>;
