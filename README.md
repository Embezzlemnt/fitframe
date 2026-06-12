# FitFrame

FitFrame is a browser-based custom eyewear flow: a face scan measures frame-fitting dimensions in real millimeters, the customer answers four style questions, picks lenses, and submits a waitlist/order-intent signup. Frames are 3D printed in PA12 nylon to the scanned measurements. Base price $119, blue light lenses included.

**Live site:** https://fitframe.store

## Current live flow

1. **Landing** — value proposition, live scan counter, FAQ.
2. **Face scan** — MediaPipe Face Mesh runs in the browser. Scale comes from an optional credit-card calibration or an iris-diameter fallback (11.8 mm HVID reference). No face images leave the device; only numeric measurements are kept.
3. **Style questions** — four quick questions, one at a time.
4. **Frame + lens** — single made-to-measure frame; blue light lenses included (other lens tiers shown as coming soon).
5. **Waitlist submission** — the app POSTs email + measurements + frame/lens choice to `/api/waitlist`. The Worker stores the signup in KV, emails the customer a confirmation, and emails the founder the full build spec via Resend.

There is **no card payment in the live flow**. A Stripe checkout path exists in the Worker but is dormant (see below).

### Creator key flow

A visitor arriving with `/?key=XXXXXXXX` (a single-use key stored in KV as `creator_key:XXXXXXXX`) sees a condensed personalized landing, skips pricing ("covered for you"), and their spec email is tagged `[CREATOR: name]`. Keys are created manually:

```bash
npx wrangler kv key put --namespace-id=792e2a9294074693835db0ca56f6b2bc \
  "creator_key:a7k2m9x4" '{"name":"creator name","used":false,"created":"2026-06-10"}'
```

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
| `/api/waitlist` | POST | store signup, send confirmation + founder spec emails |
| `/api/creator-key` | GET | validate a single-use creator key |
| `/api/create-checkout-session` | POST | **dormant** Stripe checkout |
| `/api/checkout-session` | GET | **dormant** Stripe session lookup |
| `/api/stripe-webhook` | POST | **dormant** Stripe webhook (signature-verified) |

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

> **Safety note:** local dev does **not** talk to production APIs by default. If you explicitly need the live backend (e.g. to see the real scan counter), opt in with `VITE_API_PROXY=prod npm run dev`. Be aware that waitlist submissions in that mode create real production data and send real emails.

### Secrets

Set via `wrangler secret put` (never committed):

- `RESEND_API_KEY` — transactional email (live flow)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — dormant checkout path only

Vars in `wrangler.jsonc`: `RESEND_FROM_EMAIL`, `FITFRAME_ORDER_EMAIL`.

## Dormant Stripe checkout

The Worker contains a complete Stripe hosted-checkout path (session creation, signature-verified webhook, paid-order spec email). It is **not used by the live flow** and fails closed (HTTP 501) unless Stripe secrets are configured. Do not configure Stripe secrets in production until checkout is intentionally launched and tested.

## Data + privacy

- Camera frames are processed in-browser; no images or video are stored or transmitted.
- Numeric measurements (PD, bridge, temple, lens height, face width) are sent to the Worker only when the customer submits the waitlist form, stored in KV, and included in the order emails.
- See `public/privacy.html` for the customer-facing policy. Deletion requests are handled manually (`wrangler kv key delete ... "waitlist:<email>"`).

## Testing

No automated test suite yet. Manual verification path: full flow on desktop Chrome and iPhone Safari (camera permission → scan complete → waitlist confirmation), `npm run lint`, `npm run build`. CI runs lint + build on every push.
