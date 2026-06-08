# FitFrame

FitFrame is a browser-based custom eyewear flow: face scan, style selection, a single made-to-measure frame, lens selection, and a pre-filled maker spec email that finalizes the $119 order.

> **Current flow:** the live customer path ends in a pre-filled maker spec email (mailto) to `hello@fitframe.store` — there is no card payment at checkout. The Stripe path below is dormant infrastructure kept in the Worker for a possible future paid checkout; it is not part of the live flow.

## Stripe Checkout Setup (dormant)

This payment path is scaffolded in the Worker but not used by the live flow.

Required Cloudflare secrets:

```bash
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put RESEND_API_KEY
```

Required Worker vars in `wrangler.jsonc`:

```json
{
  "RESEND_FROM_EMAIL": "FitFrame <orders@fitframe.store>",
  "FITFRAME_ORDER_EMAIL": "hello@fitframe.store"
}
```

Stripe webhook endpoint:

```text
https://fitframe.store/api/stripe-webhook
```

Subscribe the endpoint to:

```text
checkout.session.completed
```

Checkout flow:

1. The app posts the order payload to `/api/create-checkout-session`.
2. The Worker creates a Stripe hosted Checkout Session for `$119.00 USD`.
3. Stripe redirects back to `/?checkout=success&session_id=...` after payment.
4. Stripe sends `checkout.session.completed` to `/api/stripe-webhook`.
5. The webhook verifies the Stripe signature and emails the structured order spec to `hello@fitframe.store` through Resend.

The order spec is carried in Stripe metadata so FitFrame does not store customer data server-side beyond webhook execution.

## Local Checks

```bash
npm run build
```

Use `wrangler dev` with the secrets above to exercise the Worker endpoints locally.

## Scan Counter

The landing page reads `/api/scan-count` and increments `/api/scan-complete` only after a successful face measurement. The Worker seeds the counter at `47`.

For production persistence, bind a Cloudflare KV namespace as `FITFRAME_KV`. Without that binding, local/dev traffic uses an in-memory Worker counter so the frontend flow still works without localStorage.

## Email Waitlist

The landing page posts early-access emails to `/api/waitlist`.

- With `FITFRAME_KV`, emails are stored as simple KV entries keyed by normalized email.
- Without `FITFRAME_KV`, local/dev traffic uses an in-memory duplicate set.
- With `RESEND_API_KEY`, new subscribers receive a confirmation email.
- Without `RESEND_API_KEY`, the API still accepts the signup and returns `email_sent:false` so configuration gaps are visible.
