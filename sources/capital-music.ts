import { defineSource } from "../src/lib/sources.ts";

/**
 * Capital Music Association: a Pretoria-based aggregator listing concerts
 * nationally across genres, much of it in Afrikaans. Server-rendered WordPress;
 * listing cards link to one page per event and carry a genre label, which we
 * filter on before fetching anything.
 */
export default defineSource({
  slug: "capital-music",
  name: "Capital Music Association",
  role: "aggregator",
  homepage: "https://capitalmusic.org/",
  hint: "Concert aggregator (not the presenter). Lists all genres; only classical music, opera and choral events count.",
  adapter: {
    type: "html",
    startUrls: ["https://capitalmusic.org/events/"],
    follow: {
      selector: '.results .col-lg-4 > a[href*="/events/"]',
      include: /^https:\/\/capitalmusic\.org\/events\/[^/?#]+\/?$/,
      // Listing cards carry a genre label ("Classical | Chamber Music", "Popular/Light"…).
      keep: (card) => /classical|chamber|choral|orchestral|baroque|opera|recital|organ|concerto/i.test(card),
      max: 100,
    },
    remove: ["header", "footer", ".bread-crumb"],
  },
});
