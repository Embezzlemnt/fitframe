# FitFrame — Agent Guide

## Cursor Cloud specific instructions

### Stack

Single npm package: React 19 + Vite 8 frontend, Cloudflare Worker API in `worker/index.js`. No Docker, no database, no automated test suite.

### Dependencies

```bash
npm install
```

Requires **Node.js ≥ 22** (Wrangler/KV local dev).

### Running locally

| Command | Port | Use when |
|---------|------|----------|
| `npm run dev` | 5173 | Frontend-only HMR. `/api/*` calls fail; scan count falls back to `47`. |
| `npm run build && npx wrangler@latest dev --port 8787 --ip 0.0.0.0` | 8787 | **Full stack** — SPA + Worker APIs on one origin. Preferred for E2E. |
| `npm run preview` | 8787 | Same as above, but uses the pinned `wrangler` from `package-lock.json`. |

**Wrangler compatibility gotcha:** `wrangler.jsonc` sets `compatibility_date` to `2026-05-08`. The repo-pinned Wrangler (`^4.87.0`) only supports dates through `2026-05-07` and will fail to start. Use `npx wrangler@latest` (≥ 4.98) until the lockfile is upgraded.

**Interactive prompts:** First `wrangler dev` run may ask about Cloudflare AI skills — answer `n`. If a crash-report prompt appears, answer `n` as well.

Optional secrets in `.dev.vars` (gitignored): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`. Waitlist and scan-count work without them (in-memory Worker fallbacks).

### Lint / build / tests

```bash
npm run lint    # ESLint — currently has pre-existing errors in FramesSite.jsx
npm run build   # outputs to dist/
```

No `npm test` script. Manual browser verification is the test path.

### Camera / face scan

`getUserMedia` requires HTTPS or localhost. Use `127.0.0.1` (not plain HTTP on a remote IP). Camera may be unavailable in headless/cloud VMs; the scan UI still loads and shows a clear error state.

### Key files

- `src/FramesSite.jsx` — main app flow (landing → scan → style → frames → checkout/waitlist)
- `src/hooks/useFaceScan.js` — MediaPipe face scan
- `worker/index.js` — `/api/*` routes (scan-count, waitlist, Stripe checkout)
