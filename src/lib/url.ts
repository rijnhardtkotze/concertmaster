/** Strip tracking parameters and fragments so one page has one URL (manifest keys, ticket links). */
export function canonicalUrl(u: string, keepHash = false): string {
  const url = new URL(u);
  if (!keepHash || url.hash === "#/") url.hash = "";
  for (const k of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|gad_|ref$|preview$|affiliateid$)/i.test(k)) url.searchParams.delete(k);
  }
  return url.toString();
}
