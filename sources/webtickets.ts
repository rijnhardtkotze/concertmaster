import { defineSource } from "../src/lib/sources.ts";

/**
 * Webtickets client pages for presenters whose own sites are unusable:
 * UCT SACM (the full list; UCT's own page is capped at four) and the
 * Stellenbosch Endler Concert Series (su.ac.za is behind a Cloudflare
 * challenge). Only /eventmanager/ is disallowed. Detail pages have no
 * JSON-LD, so dates come from the page text. Add client codes here.
 */
const CLIENTS = ["sacm", "EndlerConcertSeries"];

export default defineSource({
  slug: "webtickets",
  name: "Webtickets",
  role: "vendor",
  homepage: "https://www.webtickets.co.za/",
  hint: "Ticket vendor event page. The presenter is usually named on the page.",
  allowEmpty: true,
  adapter: {
    type: "html",
    startUrls: CLIENTS.map((c) => `https://www.webtickets.co.za/v2/Client.aspx?clientcode=${c}`),
    follow: { selector: 'a[href*="event.aspx?itemid="]', max: 40 },
    remove: ["header", "footer", ".navbar", "#cookie-bar"],
  },
});
