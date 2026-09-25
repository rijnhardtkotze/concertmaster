import { defineSource } from "../src/lib/sources.ts";

/**
 * Old Nectar Concerts: chamber recitals for 50 in the wine cellar at Old
 * Nectar Gardens, Jonkershoek, Stellenbosch; 6 to 8 a year, curated by Fiona
 * Grayer. WordPress; /concerts/ lists the upcoming season inline (no detail
 * pages), so the page itself is the document. Tickets are on Quicket
 * (organisers 35300 and 40248, also in sources/quicket.ts), so dedupe will
 * pair these with the Quicket listings.
 */
export default defineSource({
  slug: "old-nectar",
  name: "Old Nectar Concerts",
  role: "presenter",
  defaultPresenter: "Old Nectar Concerts",
  homepage: "https://www.oldnectar.com/concerts/",
  hint: "Website of Old Nectar Concerts (presenter), whose concerts are in the wine cellar at Old Nectar Gardens, Jonkershoek Valley, Stellenbosch.",
  // Short seasons with gaps between them; an empty listing is normal.
  allowEmpty: true,
  adapter: {
    type: "html",
    startUrls: ["https://www.oldnectar.com/concerts/"],
    remove: ["header", "footer", "nav", ".site-header", ".site-footer", "#comments"],
  },
});
