# Email Delivery Setup

FitFrame stays on Cloudflare. The app posts orders to `/api/submit-order`, which is handled by a Cloudflare Worker route and the Cloudflare Pages-compatible function at `functions/api/submit-order.js`.

## Cloudflare Environment Variables

Add these in Cloudflare Pages or Workers settings for both Production and Preview:

```txt
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=FitFrame <hello@fitframe.store>
FITFRAME_ORDER_EMAIL=hello@fitframe.store
```

`RESEND_API_KEY` must never be exposed client-side. The React app only calls `/api/submit-order`.

## Outbound (Resend)

1. Sign up at `resend.com`.
2. Add domain: `fitframe.store`.
3. Resend provides DKIM TXT records. Add them in Cloudflare DNS.
4. Verify the domain in the Resend dashboard.
5. Generate a Resend API key.
6. Add the API key and email env vars in Cloudflare.
7. Place a test order through `fitframe.store` and confirm both emails send:
   - spec email to `hello@fitframe.store`
   - confirmation email to the customer address

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
8. Confirm Lorenzo receives the spec email and the customer receives the confirmation email.

## Deprecation Path

Resend replaces only outbound transactional email. It does not replace ImprovMX inbound forwarding by default.

ImprovMX becomes redundant only if FitFrame moves `hello@fitframe.store` to a real mailbox provider or to an inbound email workflow. Configure and test the replacement inbox before removing ImprovMX MX records.
