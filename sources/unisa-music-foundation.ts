import { defineSource } from "../src/lib/sources.ts";

/**
 * Unisa Music Foundation, Pretoria. SharePoint site; the Concerts page carries
 * the season as text and links the season brochure as PDFs under
 * /static/corporate_web/. Series concerts are at the Dr Miriam Makeba Concert
 * Hall or the ZK Matthews Great Hall (Muckleneuk campus), and mostly tickets at
 * the door. Competition finals and the VC's concert sell on Quicket, which
 * sources/quicket.ts picks up by keyword.
 */
export default defineSource({
  slug: "unisa-music-foundation",
  name: "Unisa Music Foundation",
  role: "presenter",
  defaultPresenter: "Unisa Music Foundation",
  homepage: "https://www.unisa.ac.za/musicfoundation",
  hint: "Concerts page of the Unisa Music Foundation (presenter), Unisa Muckleneuk campus, Pretoria. Tickets are usually sold at the door.",
  allowEmpty: true,
  adapter: {
    type: "html",
    startUrls: ["https://www.unisa.ac.za/sites/corporate/default/About/What-we-do/Arts-&-culture/Unisa-Music-Foundation/Concerts"],
    // Season brochure PDFs; competition rules and entry forms live alongside them.
    follow: {
      selector: "a[href]",
      include: /\/static\/corporate_web\/.*concert.*\.pdf($|\?)/i,
      exclude: /competition|rules|entry|application|syllabus/i,
      max: 10,
    },
    extractStartPages: true,
  },
});
