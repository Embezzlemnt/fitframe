# Email Delivery Notes

FitFrame order email is now sent from the Cloudflare Worker after Stripe confirms payment.

## Current Checkout Email Flow

1. The customer completes Stripe Checkout.
2. Stripe sends `checkout.session.completed` to `/api/stripe-webhook`.
3. The Worker verifies `STRIPE_WEBHOOK_SECRET`.
4. The Worker sends the paid order spec through Resend to `Lorenzo.Laws@outlook.com`.

Required Cloudflare secrets:

```txt
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
```

Required vars:

```txt
RESEND_FROM_EMAIL=FitFrame <orders@fitframe.store>
FITFRAME_ORDER_EMAIL=Lorenzo.Laws@outlook.com
```

The order email includes shipping address, Stripe payment confirmation ID, selected frame, colorway, lens, scan measurements, scan quality, and customer email.

## Resend DNS Notes

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

## Inbound Mail

ImprovMX remains useful for inbound forwarding to `hello@fitframe.store` unless FitFrame moves that inbox to a mailbox provider.

Confirm the ImprovMX account has this forward:

```txt
hello@fitframe.store -> Lorenzo's mailbox
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

## Verification

1. Create a Stripe test Checkout Session from the live app or `wrangler dev`.
2. Complete payment with Stripe test card `4242 4242 4242 4242`.
3. Confirm the customer returns to the FitFrame confirmation screen.
4. Confirm Stripe emits `checkout.session.completed`.
5. Confirm Lorenzo receives the structured order spec.
