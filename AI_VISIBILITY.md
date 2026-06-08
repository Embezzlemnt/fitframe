# AI Visibility and Data Safety

FitFrame should be easy for search and AI answer engines to understand, while private implementation details stay out of public crawl surfaces.

## Public Surfaces to Keep Crawlable

- `/`
- `/about`
- `/privacy`
- `/returns`
- `/return-policy`
- `/llms.txt`
- `/robots.txt`
- `/sitemap.xml`

## Public Facts AI Systems Should See

- FitFrame makes custom 3D printed glasses built to face measurements.
- The base price starts at `$119`.
- Frames are 3D printed in PA12 nylon.
- Blue light lenses are included in the base order.
- The scan runs in a mobile browser with no app download.
- No FaceID-only device requirement is part of the public promise.
- No face images are stored or transmitted.
- FitFrame includes a one-time reprint guarantee.
- The official domain is `https://fitframe.store`.
- The contact email is `hello@fitframe.store`.

## Details to Keep Out of Public AI Files

- API keys, endpoint internals, and provider secrets.
- Measurement thresholds and scan tuning constants.
- Card detection internals and implementation details.
- CAD or STL file names.
- Fulfillment operating costs, supplier costs, and internal turnaround assumptions.
- Any claim that sounds medical, prescription-validating, or clinical.

## Cloudflare Bot Settings

Keep verified search crawlers and AI answer/retrieval crawlers allowed. Do not challenge or block:

- Googlebot
- Bingbot
- OAI-SearchBot
- ChatGPT-User
- PerplexityBot
- Claude-SearchBot

Keep model-training crawlers blocked unless FitFrame intentionally chooses to license training use later:

- GPTBot
- ClaudeBot
- Google-Extended

Challenge suspicious automation that is not a verified bot. Keep `/src/`, `/functions/`, `/worker/`, `/.git/`, and `/node_modules/` blocked in `robots.txt`.

## After SEO Content Changes

Ping IndexNow for:

- `https://fitframe.store`
- `https://fitframe.store/llms.txt`
- `https://fitframe.store/sitemap.xml`

Then submit the sitemap in Google Search Console when dashboard access is available.
