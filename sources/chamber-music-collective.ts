import { defineSource } from "../src/lib/sources.ts";

/**
 * Mzansi Chamber Music Collective, Johannesburg. Webflow CMS: /upcoming-concerts
 * links to one /concert/<slug> page per concert, with the programme, date, time,
 * price and venue (Northwards House, Shed & Silo in Benoni, St Stithians Chapel).
 * Detail pages carry Event JSON-LD, but its dates are malformed ("Oct 25, 2026T15:00"),
 * so the page text is what counts. robots.txt allows everything. Tickets on Quicket
 * (organiser 47792, also in sources/quicket.ts), which doesn't list every concert.
 */
export default defineSource({
  slug: "chamber-music-collective",
  name: "Mzansi Chamber Music Collective",
  role: "presenter",
  defaultPresenter: "Mzansi Chamber Music Collective",
  homepage: "https://www.chambermusiccollective.co.za/",
  hint: "Website of the Mzansi Chamber Music Collective (presenter), Johannesburg and surrounds.",
  allowEmpty: true,
  adapter: {
    type: "html",
    startUrls: ["https://www.chambermusiccollective.co.za/upcoming-concerts"],
    follow: { selector: 'a[href^="/concert/"]', max: 20 },
    // The concert itself; below it sit "Other Upcoming Concerts" cards, which would change every page's hash.
    contentSelector: ".section.details-dark-bg",
  },
});
