import { defineSource } from "../src/lib/sources.ts";

/**
 * Symphony Choir of Johannesburg. WordPress (Bricks builder), server-rendered
 * /event/ listing with date and venue in the listing text. Tickets on Quicket
 * (organiser 53944, also in sources/quicket.ts). The REST post type has no
 * dates, so don't be tempted by it.
 */
export default defineSource({
  slug: "symphony-choir-jhb",
  name: "Symphony Choir of Johannesburg",
  role: "presenter",
  defaultPresenter: "Symphony Choir of Johannesburg",
  homepage: "https://symphonychoirofjohannesburg.co.za/",
  hint: "Website of the Symphony Choir of Johannesburg (presenter).",
  allowEmpty: true,
  adapter: {
    type: "html",
    startUrls: ["https://symphonychoirofjohannesburg.co.za/event/"],
    follow: { selector: 'main h3.brxe-heading a[href*="/event/"]', max: 20 },
    contentSelector: "main",
  },
});
