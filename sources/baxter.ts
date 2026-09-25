import { defineSource } from "../src/lib/sources.ts";

/**
 * Baxter Theatre Centre, Cape Town (now at baxter.uct.ac.za). Its classical
 * listing also carries UCT South African College of Music concerts and the
 * Cape Town Concert Series, which saves separate configs for those. robots.txt
 * blocks named AI crawlers, not generic ones.
 */
export default defineSource({
  slug: "baxter",
  name: "Baxter Theatre Centre",
  role: "venue",
  homepage: "https://baxter.uct.ac.za/",
  hint: "Baxter Theatre Centre, Cape Town (venue); classical music listing.",
  allowEmpty: true,
  adapter: {
    type: "html",
    startUrls: ["https://baxter.uct.ac.za/whats-classical-music"],
    follow: { selector: ".view-uct-events-upcoming article.node--type-event a.button--cta-readmore", max: 30 },
    contentSelector: "article.node--type-event.node--view-mode-full",
    // "Upcoming / Related events" sidebar: other concerts, which would otherwise be re-extracted from every page.
    remove: [".node__aside--last"],
  },
});
