/** Strip tracking parameters and fragments so one page has one URL (manifest keys, ticket links). */
export function canonicalUrl(u: string, keepHash = false): string {
  const url = new URL(u);
  if (!keepHash || url.hash === "#/") url.hash = "";
  for (const k of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|gad_|ref$|preview$|affiliateid$)/i.test(k)) url.searchParams.delete(k);
  }
  return url.toString();
}

/**
 * False for hosts a crawler following page-supplied links must never reach: localhost,
 * internal-only names, IP literals in private/loopback/link-local/CGNAT ranges, and any
 * IPv6 literal (no source of ours publishes one). Name-based only: no DNS lookup.
 */
export function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h || h.startsWith("[") || h.includes(":")) return false;
  if (h === "localhost" || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(h)) return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

/** Same site, ignoring a leading "www." and allowing subdomains of the configured host. */
export function sameSite(hostname: string, allowed: string): boolean {
  const strip = (x: string) => x.toLowerCase().replace(/^www\./, "");
  const h = strip(hostname);
  const a = strip(allowed);
  return h === a || h.endsWith(`.${a}`);
}
