import { PATHS } from "./config.ts";
import { readJson } from "./json.ts";
import type { PROVINCES } from "./schema.ts";
import { normalise } from "./text.ts";

export interface VenueRecord {
  venue_id: string;
  name: string;
  aliases: string[];
  address: string | null;
  city: string;
  province: (typeof PROVINCES)[number];
  lat: number | null;
  lng: number | null;
}

export const loadVenues = (file = PATHS.venues) => readJson<VenueRecord[]>(file, []);
export const loadComposers = (file = PATHS.composers) => readJson<string[]>(file, []);

/** The venue table as the extractor sees it: no coordinates, which it doesn't need. */
export function venuesForPrompt(venues: VenueRecord[]) {
  return venues.map(({ venue_id, name, aliases, city, province }) => ({ venue_id, name, aliases, city, province }));
}

export class VenueIndex {
  private byId = new Map<string, VenueRecord>();
  private exact = new Map<string, VenueRecord>();
  private aliases: { key: string; venue: VenueRecord }[] = [];

  constructor(readonly venues: VenueRecord[]) {
    for (const v of venues) {
      this.byId.set(v.venue_id, v);
      for (const name of [v.name, ...v.aliases]) {
        const key = normalise(name);
        if (!key) continue;
        this.exact.set(key, v);
        this.aliases.push({ key, venue: v });
      }
    }
    // Longest alias first, so "artscape opera house" beats "artscape".
    this.aliases.sort((a, b) => b.key.length - a.key.length);
  }

  get(id: string | null | undefined) {
    return id ? this.byId.get(id) : undefined;
  }

  /**
   * Resolve an extracted venue to the canonical table. Exact name/alias match
   * first; then a whole-word alias match inside "name, address", accepted only
   * if the cities don't contradict each other ("City Hall" in Durban is not
   * Cape Town City Hall).
   */
  resolve(v: { venue_id?: string | null; name: string; address?: string | null; city?: string | null }): VenueRecord | undefined {
    const byId = this.get(v.venue_id);
    if (byId) return byId;
    const exact = this.exact.get(normalise(v.name));
    if (exact && citiesAgree(exact.city, v.city)) return exact;
    const hay = ` ${normalise([v.name, v.address].filter(Boolean).join(" "))} `;
    for (const { key, venue } of this.aliases) {
      if (key.length < 5) continue;
      if (hay.includes(` ${key} `) && citiesAgree(venue.city, v.city)) return venue;
    }
    return undefined;
  }

  /** Every name a venue goes by, for fuzzy dedupe. */
  aliasSet(v: { venue_id?: string | null; name: string }): Set<string> {
    const rec = this.get(v.venue_id);
    if (!rec) return new Set([normalise(v.name)]);
    return new Set([rec.name, ...rec.aliases].map(normalise));
  }
}

function citiesAgree(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  const x = normalise(a);
  const y = normalise(b);
  return x === y || x.includes(y) || y.includes(x);
}

export class ComposerIndex {
  private full = new Map<string, string>();
  private surnames = new Map<string, string[]>();

  constructor(readonly composers: string[]) {
    for (const c of composers) {
      this.full.set(normalise(c), c);
      const parts = normalise(c).split(" ");
      // Surname = last token, or "van dijk"-style particles plus last token.
      const idx = parts.findIndex((p, i) => i > 0 && ["van", "von", "de", "du", "le", "la"].includes(p));
      const surname = idx > 0 ? parts.slice(idx).join(" ") : parts[parts.length - 1]!;
      const list = this.surnames.get(surname) ?? [];
      list.push(c);
      this.surnames.set(surname, list);
    }
  }

  /**
   * Table name for a programme composer, or null. A full-name match is
   * certain. A bare surname that matches exactly one table entry is returned
   * with `certain: false`, so the caller can flag it for review rather than
   * publishing an inference.
   */
  match(composer: string): { name: string; certain: boolean } | null {
    const key = normalise(composer);
    const full = this.full.get(key);
    if (full) return { name: full, certain: true };
    const bySurname = this.surnames.get(key);
    if (bySurname?.length === 1) return { name: bySurname[0]!, certain: false };
    return null;
  }
}
