import { defineSource } from "../src/lib/sources.ts";

/**
 * Johannesburg Philharmonic Orchestra. WordPress; /concerts/ has an "Upcoming
 * Concerts" carousel linking to one post per concert. robots.txt only
 * disallows /author/*. Single tickets are on Quicket (organiser 36134), so
 * dedupe will pair these with the Quicket listings.
 */
export default defineSource({
  slug: "jpo",
  name: "Johannesburg Philharmonic Orchestra",
  role: "presenter",
  defaultPresenter: "Johannesburg Philharmonic Orchestra",
  homepage: "https://jpo.co.za/",
  hint: "Website of the Johannesburg Philharmonic Orchestra (presenter).",
  adapter: {
    type: "html",
    startUrls: ["https://jpo.co.za/concerts/"],
    follow: {
      selector: ".uagb-post__title a",
      include: /^https:\/\/jpo\.co\.za\//,
      max: 30,
    },
    // The listing itself carries title/date/venue for each upcoming concert; extracting
    // it too means a changed carousel markup degrades to thinner records, not to nothing.
    extractStartPages: true,
    contentSelector: "main",
    remove: [".post-navigation", ".jpo-overlapping-text", "footer"],
  },
});
