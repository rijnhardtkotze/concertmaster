import { createHash } from "node:crypto";

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Filesystem-safe stable id for a document URL. */
export function docId(url: string): string {
  return sha256(url).slice(0, 16);
}
