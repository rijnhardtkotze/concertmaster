import { CLASSICAL_KEYWORDS } from "../src/lib/keywords.ts";
import { defineSource } from "../src/lib/sources.ts";

/**
 * Quicket public API (not the HTML: robots.txt is permissive, but the API is
 * structured, stable and what they offer for this). Quicket has no "classical"
 * category, so we pull all public events and keep the ones matching a keyword
 * pre-filter; false positives cost one LLM call that returns [], once per
 * content hash. Organisers listed in organiserIds are always kept.
 */

export default defineSource({
  slug: "quicket",
  name: "Quicket",
  role: "vendor",
  homepage: "https://api.quicket.co.za/",
  hint: "Ticket vendor listing. The organiser named in the listing is usually the presenter.",
  adapter: {
    type: "quicket",
    categories: [],
    keywords: CLASSICAL_KEYWORDS,
    organiserIds: [
      34873, // Unisa Music Foundation
      36134, // Johannesburg Philharmonic Orchestra
      53944, // Symphony Choir of Johannesburg
      75734, // UFS Odeion School of Music
      82645, // University of Pretoria, School of the Arts: Music
    ],
    pageSize: 100,
  },
});
