import { defineSource } from "../src/lib/sources.ts";

/**
 * Old Nectar Concerts: chamber recitals for 50 in the wine cellar at Old
 * Nectar Gardens, Jonkershoek, Stellenbosch; 6 to 8 a year, curated by Fiona
 * Grayer. WordPress; /concerts/ lists the upcoming season inline (no detail
 * pages), so the page itself is the document. robots.txt only disallows
 * /wp-admin/. Tickets are on Quicket (organiser 40248, also in
 * sources/quicket.ts), so dedupe will pair these with the Quicket listings.
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
    // The page has no <main>; the post body holds the intro and every concert, without the site header and footer.
    contentSelector: ".entry-content",
  },
});
