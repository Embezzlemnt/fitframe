# FitFrame

FitFrame is a browser-based custom eyewear flow: face scan, style selection, frame selection, shipping details, and Stripe Checkout for a fixed $89 order.

## Stripe Checkout Setup

Task 1 is scaffolded to run through Cloudflare Workers with no new npm packages.

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
  "FITFRAME_ORDER_EMAIL": "Lorenzo.Laws@outlook.com"
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
2. The Worker creates a Stripe hosted Checkout Session for `$89.00 USD`.
3. Stripe redirects back to `/?checkout=success&session_id=...` after payment.
4. Stripe sends `checkout.session.completed` to `/api/stripe-webhook`.
5. The webhook verifies the Stripe signature and emails the structured order spec to `Lorenzo.Laws@outlook.com` through Resend.

The order spec is carried in Stripe metadata so FitFrame does not store customer data server-side beyond webhook execution.

## Local Checks

```bash
npm run build
```

Use `wrangler dev` with the secrets above to exercise the Worker endpoints locally.
