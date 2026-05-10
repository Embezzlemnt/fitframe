# Email Delivery Notes

FitFrame stays on Cloudflare. The current launch order flow does not require a backend email service.

## Current Launch Flow

The React app opens a native `mailto:` draft addressed to `hello@fitframe.store`.

The draft includes:

- shipping address
- order ID
- selected frame
- lens selection
- material recommendation
- scan measurements
- scan quality metadata
- style answers

No API key, SMTP service, or third-party order endpoint is required for the customer flow.

## Optional Future Outbound (Resend)

The Cloudflare function at `functions/api/submit-order.js` remains in the repo as an optional future transactional email path, but the frontend does not depend on it for launch.

If FitFrame returns to automated outbound email later, add these in Cloudflare Workers settings for both Production and Preview:

```txt
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=FitFrame <hello@fitframe.store>
FITFRAME_ORDER_EMAIL=hello@fitframe.store
```

`RESEND_API_KEY` must never be exposed client-side.

Resend setup steps:

1. Sign up at `resend.com`.
2. Add domain: `fitframe.store`.
3. Resend provides DKIM TXT records. Add them in Cloudflare DNS.
4. Verify the domain in the Resend dashboard.
5. Generate a Resend API key.
6. Add the API key and email env vars in Cloudflare.
7. Switch the frontend order flow back to `/api/submit-order` only after live send and receipt tests pass.

The blank DNS TXT record currently visible at `resend._domainkey.fitframe.store` is not usable. Replace it with the full DKIM value Resend gives Lorenzo.

## Inbound (ImprovMX)

Current DNS finding: `fitframe.store` has no public MX records. The SPF TXT record exists, but inbound mail to `hello@fitframe.store` will not reliably route until MX is restored.

Confirm the ImprovMX account has this forward:

```txt
hello@fitframe.store -> Lorenzo's mailbox
```

Then add these Cloudflare DNS records. All are DNS only.

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

## Resend DNS Notes

Resend may ask for SPF, DKIM, and bounce/return-path records. Copy the exact generated records from Resend.

If Resend sends from the root domain, the root SPF must be a single combined SPF record:

```txt
v=spf1 include:spf.improvmx.com include:amazonses.com ~all
```

Never publish two separate SPF TXT records at the same host.

Preferred path if Resend allows it:

```txt
From: FitFrame <hello@fitframe.store>
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

## Verification

1. Open `mxtoolbox.com/SuperTool.aspx`.
2. Enter `fitframe.store`.
3. Run MX Lookup.
4. Confirm both ImprovMX MX records appear with priorities 10 and 20.
5. Send a test email from a personal account to `hello@fitframe.store`.
6. Confirm receipt within 60 seconds.
7. Place a test order on `fitframe.store`.
8. Confirm the native mail draft opens with the full order spec.
9. Send the draft and confirm Lorenzo receives it.

## Deprecation Path

Resend replaces only outbound transactional email. It does not replace ImprovMX inbound forwarding by default.

ImprovMX becomes redundant only if FitFrame moves `hello@fitframe.store` to a real mailbox provider or to an inbound email workflow. Configure and test the replacement inbox before removing ImprovMX MX records.
