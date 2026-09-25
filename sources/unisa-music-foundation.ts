import { defineSource } from "../src/lib/sources.ts";

/**
 * Unisa Music Foundation, Pretoria. SharePoint, no robots.txt (404). The
 * Concerts page gives the season's intro and door prices, but the season
 * itself is a poster image (dates and artists only). The linked PDFs are
 * posters for festivals that are on Quicket anyway, run to ~10 MB and outlast
 * the fetch timeout, so they aren't followed. Ticketed events (competition
 * finals, the VC's concert, festival nights) come from Quicket organiser 34873
 * in sources/quicket.ts.
 */
export default defineSource({
  slug: "unisa-music-foundation",
  name: "Unisa Music Foundation",
  role: "presenter",
  defaultPresenter: "Unisa Music Foundation",
  homepage: "https://www.unisa.ac.za/musicfoundation",
  hint: "Concerts page of the Unisa Music Foundation (presenter), Unisa Muckleneuk campus, Pretoria. Series concerts sell tickets at the door.",
  adapter: {
    type: "html",
    startUrls: ["https://www.unisa.ac.za/sites/corporate/default/About/What-we-do/Arts-&-culture/Unisa-Music-Foundation/Concerts"],
    contentSelector: ".tab-content",
  },
});
