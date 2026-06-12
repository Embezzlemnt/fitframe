# Email Delivery Notes

## Live email flow (Resend via Worker)

When a customer submits the waitlist form, `POST /api/waitlist` sends two emails through Resend:

1. **Customer confirmation** — "You're on the FitFrame founding member list" with their position and the spec on file.
2. **Founder spec email** — full build spec (order ID, measurements, frame, lens, total) to `FITFRAME_ORDER_EMAIL` (`hello@fitframe.store`). Creator-key submissions are tagged `[CREATOR: name]` in the subject and include the key in the body.

Duplicate signups (same email) do not re-send the customer confirmation. If the founder email fails for a creator submission, the creator key is **not** marked used.

Required secret: `RESEND_API_KEY` (set with `wrangler secret put RESEND_API_KEY`).
Required vars (`wrangler.jsonc`): `RESEND_FROM_EMAIL`, `FITFRAME_ORDER_EMAIL`.

Without `RESEND_API_KEY` the API still accepts signups (stored in KV) but sends no email.

## Dormant Stripe order emails

The Stripe webhook path (`/api/stripe-webhook`) emails a paid-order spec on `checkout.session.completed`. This path is dormant — see README. Verification steps for when it is activated:

1. Create a Stripe test Checkout Session from `wrangler dev`.
2. Pay with test card `4242 4242 4242 4242`.
3. Confirm `checkout.session.completed` fires and the spec email arrives.

## Resend DNS notes

Resend may ask for SPF, DKIM, and bounce/return-path records. Copy the exact generated records from Resend.

If Resend sends from the root domain, the root SPF must be a single combined SPF record:

```txt
v=spf1 include:spf.improvmx.com include:amazonses.com ~all
```

Never publish two separate SPF TXT records at the same host.

Preferred path if Resend allows it:

```txt
From: FitFrame <orders@fitframe.store>
Reply-To: hello@fitframe.store
```

Alternative path if root SPF conflicts become noisy:

```txt
From: FitFrame <orders@send.fitframe.store>
Reply-To: hello@fitframe.store
```

For a `send.fitframe.store` Resend subdomain, expected records usually look like this, but the DKIM value must come from Resend:

```txt
Type: MX
Name: send
Mail server: feedback-smtp.us-east-1.amazonses.com
Priority: 10
TTL: Auto
Proxy: DNS only
```

```txt
Type: TXT
Name: send
Content: v=spf1 include:amazonses.com ~all
TTL: Auto
Proxy: DNS only
```

```txt
Type: TXT
Name: resend._domainkey.send
Content: [copy the full DKIM public key from Resend]
TTL: Auto
Proxy: DNS only
```

## Inbound mail

ImprovMX remains useful for inbound forwarding to `hello@fitframe.store` unless FitFrame moves that inbox to a mailbox provider.

Confirm the ImprovMX account has this forward:

```txt
hello@fitframe.store -> business inbox
```

Then keep these Cloudflare DNS records. All are DNS only.

```txt
Type: MX
Name: @
Mail server: mx1.improvmx.com
Priority: 10
TTL: Auto
Proxy: DNS only
```

```txt
Type: MX
Name: @
Mail server: mx2.improvmx.com
Priority: 20
TTL: Auto
Proxy: DNS only
```

Keep the existing SPF TXT if it already exists. Do not create a duplicate.

```txt
Type: TXT
Name: @
Content: v=spf1 include:spf.improvmx.com ~all
TTL: Auto
Proxy: DNS only
```
