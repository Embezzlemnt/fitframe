# FitFrame — Agent Guide

## Cursor Cloud specific instructions

### Stack

Single npm package: React 19 + Vite 8 frontend, Cloudflare Worker API in `worker/index.js`. No Docker, no database, no automated test suite.

### Dependencies

```bash
npm install
```

Requires **Node.js >= 22** (enforced via the `engines` field; Wrangler/KV local dev needs it).

### Running locally

| Command | Port | Use when |
|---------|------|----------|
| `npm run dev` | 5173 | Frontend HMR. `/api/*` proxies to a **local** `wrangler dev` on 8787 by default; without one running, API calls fail and the scan count falls back to `47`. |
| `npm run preview` | 8787 | **Full stack** — build + SPA + Worker APIs on one origin. Preferred for E2E. |

To use the production API from local dev (rarely needed — creates real data and sends real emails), opt in explicitly:

```bash
VITE_API_PROXY=prod npm run dev
```

**Interactive prompts:** first `wrangler dev` run may ask about Cloudflare AI skills — answer `n`. If a crash-report prompt appears, answer `n` as well.

Optional secrets in `.dev.vars` (gitignored): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`. Waitlist and scan-count work without them (in-memory Worker fallbacks).

### Lint / build / tests

```bash
npm run lint   # ESLint — clean (.wrangler/dist/node_modules are ignored)
npm run build  # outputs to dist/
```

No `npm test` script. Manual browser verification is the test path. CI (GitHub Actions) runs lint + build on every push.

### Camera / face scan

`getUserMedia` requires HTTPS or localhost. Use `127.0.0.1` (not plain HTTP on a remote IP). Camera may be unavailable in headless/cloud VMs; the scan UI still loads and shows a clear error state.

### Key files

- `src/FramesSite.jsx` — the live app: full flow (landing → scan → style → frame → lens → waitlist submission) with the MediaPipe scan, camera, and measurement logic all inline. This is the only frontend source file besides `src/main.jsx`.
- `worker/index.js` — `/api/*` routes (scan-count, waitlist, creator-key, and a dormant Stripe checkout path that the live flow does not use), static asset serving, security headers, rate limiting.
- `public/` — static content pages (`about`, `faq`, `returns`, `privacy`), `_headers` (live CSP/security headers), SEO files.
- `wrangler.jsonc` — Worker config: KV (`FITFRAME_KV`), rate limiter binding, assets with `run_worker_first: true`.

### Protected behavior — do not change casually

- Scan math constants in `FramesSite.jsx` (IRIS_MM 11.8, PD ranges, card dimensions).
- Accent color `#4caf7d`, `$119` base price, lowercase brand voice (pronoun "I" stays capitalized).
- Worker rate limiting and security headers.
- The dormant Stripe path stays dormant — do not wire it to the frontend without an explicit brief.
