# FitFrame

FitFrame is a browser-based custom eyewear flow: a face scan measures frame-fitting dimensions in real millimeters, the customer answers the founder questionnaire, and reserves a founder pair through Stripe Checkout for $21 ($20 frame at cost + $1 shipping). Frames are 3D printed in PA12 nylon to the scanned measurements, blue light lenses included.

**Live site:** https://fitframe.store

## Current live flow

1. **Landing** — value proposition, live scan counter, FAQ.
2. **Face scan** — MediaPipe Face Mesh runs in the browser. Scale comes from an optional credit-card calibration or an iris-diameter fallback (11.8 mm HVID reference). No face images leave the device; only numeric measurements are kept.
3. **Measurements payoff** — the customer sees their PD, bridge, temple, lens height, and face width.
4. **Founder questionnaire** — what they wear now, what's wrong with it, and a photo + honest review commitment (required), plus a marketing opt-in.
5. **Stripe checkout** — the app POSTs the order (email + answers + measurements) to `/api/create-checkout-session` and redirects to Stripe's hosted page, which collects the shipping address and charges $21. The signature-verified webhook assigns the pair number and emails the founder the full build spec via Resend.

### Legacy endpoints

`/api/waitlist` and `/api/creator-key` remain in the Worker from the pre-checkout waitlist era but are no longer called by the frontend. Creator keys in KV (`creator_key:*`) are only honored by the legacy waitlist endpoint.

## Architecture

- `src/FramesSite.jsx` — the entire SPA (UI, scan engine, camera handling, flow state). Single-file by design for now; a staged split is planned.
- `worker/index.js` — Cloudflare Worker serving the static build and `/api/*` routes.
- `public/` — static pages (`/about`, `/faq`, `/returns`, `/privacy`), headers, SEO files.
- `wrangler.jsonc` — Worker config: KV binding (`FITFRAME_KV`), rate limiter, static assets with `run_worker_first`.

### API routes (`worker/index.js`)

| Route | Method | Purpose |
|---|---|---|
| `/api/scan-count` | GET | live "faces scanned" counter |
| `/api/scan-complete` | POST | increment counter after a successful scan |
| `/api/create-checkout-session` | POST | create the $21 Stripe Checkout session |
| `/api/stripe-webhook` | POST | signature-verified webhook — assigns pair number, sends spec email (idempotent per event) |
| `/api/reservation-count` | GET | paid-reservation counter (pair numbers) |
| `/api/waitlist` | POST | **legacy** — waitlist signup + creator-key handling (not called by the frontend) |
| `/api/creator-key` | GET | **legacy** — validate a single-use creator key (not called by the frontend) |

All `/api/*` routes are rate limited (5 requests / 60 s per IP).

## Development

Requires **Node.js >= 22**.

```bash
npm install
npm run dev        # frontend on :5173 — /api proxies to a LOCAL wrangler dev on :8787 by default
npm run preview    # build + full stack (SPA + Worker) on :8787
npm run lint
npm run build
```

To run the full stack locally, start the Worker in a second terminal:

```bash
npx wrangler dev --port 8787
```

> **Safety note:** local dev does **not** talk to production APIs by default. If you explicitly need the live backend (e.g. to see the real scan counter), opt in with `VITE_API_PROXY=prod npm run dev`. Be aware that submissions in that mode create real production data, real Stripe sessions, and real emails.

### Secrets

Set via `wrangler secret put` (never committed):

- `RESEND_API_KEY` — transactional email (spec emails)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — live checkout + webhook

Vars in `wrangler.jsonc`: `RESEND_FROM_EMAIL`, `FITFRAME_ORDER_EMAIL`.

## Data + privacy

- Camera frames are processed in-browser; no images or video are stored or transmitted.
- Numeric measurements (PD, bridge, temple, lens height, face width) are sent to the Worker only when the customer starts checkout, attached to the Stripe session as metadata, and included in the order spec email.
- See `public/privacy.html` for the customer-facing policy. Deletion requests are handled manually (`wrangler kv key delete ... "waitlist:<email>"`).

## Testing

No automated test suite yet. Manual verification path: full flow on desktop Chrome and iPhone Safari (camera permission → scan complete → questionnaire → Stripe test checkout → confirmation), `npm run lint`, `npm run build`. CI runs lint + build on every push.
