---
status: accepted
---

# The site is hosted on Cloudflare Workers static assets

The static Astro site is built in the nightly GitHub Action and deployed with `wrangler deploy` to Cloudflare Workers static assets, on the rijnhardt.cloud Cloudflare account. Building in the Action keeps the Supabase credentials in GitHub secrets and uses none of the host's build quota. Cloudflare's own docs now point new static sites to Workers rather than Pages.

## Considered Options

- **Vercel Hobby.** Rejected: the free plan is for non-commercial use only and counts advertising as commercial. The site expects ads or sponsorship, which would mean Pro at $20 per user a month.
- **Cloudflare Pages.** Rejected: it is still supported, but Cloudflare recommends Workers for new projects.

## Consequences

- The site's domain must be an active Cloudflare zone, with its nameservers on Cloudflare.
- The Action needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets.
