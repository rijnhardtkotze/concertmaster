import { defineSource } from "../src/lib/sources.ts";

/**
 * KwaZulu-Natal Philharmonic Orchestra. Same WordPress/Spectra template as the
 * JPO: /events/ carries a post carousel linking to one post per concert. Date
 * and venue are free text in the post ("19h00 ~ Thursday 3 September 2026 ~
 * Playhouse"). The carousel also surfaces old "virtual" posts; past dates are
 * dropped in normalise. robots.txt allows everything.
 */
export default defineSource({
  slug: "kznpo",
  name: "KwaZulu-Natal Philharmonic Orchestra",
  role: "presenter",
  defaultPresenter: "KwaZulu-Natal Philharmonic Orchestra",
  homepage: "https://kznphil.org.za/",
  hint: "Website of the KwaZulu-Natal Philharmonic Orchestra (presenter), Durban.",
  adapter: {
    type: "html",
    startUrls: ["https://kznphil.org.za/events/"],
    follow: { selector: ".uagb-post__inner-wrap .uagb-post__title a", include: /^https:\/\/kznphil\.org\.za\//, max: 20 },
    extractStartPages: true,
    contentSelector: "main",
    remove: [".post-navigation", "footer", ".uagb-post-grid"],
  },
});
