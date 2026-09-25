import { defineSource } from "../src/lib/sources.ts";

/**
 * Vox Chamber Choir (Pretoria, Franco Prinsloo). Their Wix site links out to
 * heyzuva.com, the productions company's ticket site, whose event pages carry
 * schema.org Event JSON-LD (kept by htmlToText). Mixed English/Afrikaans.
 * Some flagship concerts are only on Webtickets; add them there if missed.
 */
export default defineSource({
  slug: "vox-chamber-choir",
  name: "Vox Chamber Choir",
  role: "presenter",
  homepage: "https://www.voxchamberchoir.com/",
  hint: "Ticket site of Franco Prinsloo Productions, which presents the Vox Chamber Choir, Pretoria.",
  allowEmpty: true,
  adapter: {
    type: "html",
    startUrls: ["https://www.heyzuva.com/"],
    follow: { selector: 'a[href*="/event-details/"]', include: /^https:\/\/www\.heyzuva\.com\/event-details\//, max: 20 },
  },
});
