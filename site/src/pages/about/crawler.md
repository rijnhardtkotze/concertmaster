---
title: About our crawler
description: Who SAClassicalGuideBot is, what it fetches, how often, and how to opt out.
---

# About our crawler

If you've found `SAClassicalGuideBot` in your server logs, it's us. We run a
free listings guide to classical music concerts in South Africa, and the bot
collects concert dates so people can find your events.

## What it fetches

- Your public concert, season or events pages, the individual concert pages
  they link to, and any season brochure PDFs linked from them.
- Nothing behind a login, no forms, no images, no media files.

We keep only the facts about each concert: title, date and time, venue,
performers, programme, ticket link and price range. Every listing links back
to your page as the source. We don't republish your descriptions or marketing
copy. Summaries are written in our own words, and anything that looks copied
is dropped automatically. The pages themselves are not stored in any public
place.

## How often, and how politely

- **Once a day**, at about 03:00 South African time.
- **At most one request every 2 seconds to your site**, or slower if your
  `robots.txt` sets a `Crawl-delay`.
- **We obey `robots.txt`.** If we can't read it (for example because your
  server returns an error), we skip your site for that day rather than guess.
- We send `If-None-Match` and `If-Modified-Since` headers, so an unchanged
  page costs you a `304` and almost no bandwidth.

It identifies itself as:

```
SAClassicalGuideBot/1.0 (+https://concertmaster.co.za/about/crawler)
```

## Opting out

To stop us crawling your site, add this to your `robots.txt` and we'll stop
at our next daily run:

```
User-agent: SAClassicalGuideBot
Disallow: /
```

You can also email **crawler@concertmaster.co.za** and we'll remove your site
by hand, along with any listings from it. Please email the same address if
the bot misbehaves, a listing is wrong, or you'd like us to use a feed or API
you already publish.
