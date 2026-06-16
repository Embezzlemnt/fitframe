// ─── Founder's Cut pricing ──────────────────────────────────────────────────
// Charged upfront at reservation: $20 (frame, at cost) + $1 shipping = $21.
const FOUNDER_FRAME_CENTS = 2000;
const FOUNDER_SHIPPING_CENTS = 100;
const ORDER_EMAIL = "hello@fitframe.store";
const SCAN_COUNT_KEY = "faces_scanned_count";
const SCAN_COUNT_SEED = 47;
const WAITLIST_COUNT_KEY = "waitlist_count";
const WAITLIST_COUNT_SEED = 0;
// Genuine paid reservations only. Seed 0 — the count is driven solely by the
// Stripe webhook on confirmed payment, so test rows never pollute it.
const RESERVATION_COUNT_KEY = "reservations_count";
const RESERVATION_COUNT_SEED = 0;

let fallbackScanCount = SCAN_COUNT_SEED;
let fallbackWaitlistCount = WAITLIST_COUNT_SEED;
let fallbackReservationCount = RESERVATION_COUNT_SEED;
const fallbackWaitlist = new Set();

const ALLOWED_ORIGIN = "https://fitframe.store";
const RATE_LIMIT_POLICY = "5;w=60";

const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
};

const SENSITIVE_BASENAMES = new Set([
  ".env",
  ".DS_Store",
  "package.json",
  "package-lock.json",
  "composer.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".htaccess",
  "web.config",
  "config.json",
  "wp-config.php",
  "database.yml",
  "secrets.json",
  "id_rsa",
  ".npmrc",
  "docker-compose.yml",
  "Dockerfile",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function isSensitivePath(pathname) {
  if (pathname.startsWith("/.git/") || pathname === "/.git") return true;
  if (pathname.startsWith("/.svn/") || pathname === "/.svn") return true;
  const segment = pathname.split("/").pop() || "";
  if (SENSITIVE_BASENAMES.has(segment)) return true;
  if (segment.startsWith(".env")) return true;
  if (segment.startsWith(".") && !pathname.startsWith("/.well-known")) return true;
  return false;
}

function mergeHeaders(...sets) {
  return Object.assign({}, SECURITY_HEADERS, ...sets);
}

function notFound(extra = {}) {
  return new Response("Not found", {
    status: 404,
    headers: mergeHeaders({ "Content-Type": "text/plain; charset=utf-8" }, extra),
  });
}

function rateLimitMetaHeaders() {
  return {
    "X-RateLimit-Policy": RATE_LIMIT_POLICY,
    "X-RateLimit-Limit": "5",
  };
}

async function serveAssets(request, env, extraHeaders = {}) {
  if (!env.ASSETS) return notFound(extraHeaders);
  const asset = await env.ASSETS.fetch(request);
  const headers = new Headers(asset.headers);
  for (const [key, value] of Object.entries(mergeHeaders(rateLimitMetaHeaders(), extraHeaders))) {
    headers.set(key, value);
  }
  return new Response(asset.body, { status: asset.status, headers });
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: mergeHeaders(
      { "Content-Type": "application/json" },
      corsHeaders,
      extraHeaders,
    ),
  });
}

async function enforceRateLimit(request, env) {
  const headers = {
    "X-RateLimit-Policy": RATE_LIMIT_POLICY,
    "X-RateLimit-Limit": "5",
  };
  if (!env.RATE_LIMITER) return { ok: true, headers };
  const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
  const { success } = await env.RATE_LIMITER.limit({ key: clientIp });
  if (!success) {
    return { ok: false, headers: { ...headers, "Retry-After": "60" } };
  }
  return { ok: true, headers };
}

function envMissing(...keys) {
  return keys.filter(key => !key);
}

function metadataValue(value) {
  if (value == null || value === "") return "-";
  return String(value).slice(0, 500);
}

function orderMetadata(order) {
  return {
    order_id: order.order_id,
    customer_email: order.customer_email,
    frame_id: order.frame_id,
    frame: order.frame || "Founder's Cut · PA12 nylon",
    lens: order.lens || "blue light",
    // Founder agreement answers
    wear_now: order.wear_now,
    whats_wrong: order.whats_wrong,
    will_share: order.will_share,
    marketing_opt_in: order.marketing_opt_in,
    submitted: order.timestamp,
    // Face measurements
    pd_binocular: order.pd_binocular,
    pd_left: order.pd_left,
    pd_right: order.pd_right,
    bridge_width_mm: order.bridge_width_mm || order.bridge_mm,
    temple_mm: order.temple_mm,
    face_height_mm: order.face_height_mm,
    face_width_mm: order.face_width_mm,
    scan_quality: order.scan_quality,
    valid_frames_pct: order.valid_frames_pct,
    scale_source: order.scale_source,
  };
}

function appendMetadata(form, prefix, metadata) {
  Object.entries(metadata).forEach(([key, value]) => {
    form.append(`${prefix}[${key}]`, metadataValue(value));
  });
}

function requiredOrderFields(order) {
  // The founder flow collects only an email + agreement answers up front; the
  // shipping address is collected by Stripe Checkout itself.
  return [
    "order_id",
    "customer_email",
  ].filter(key => !order[key]);
}

// ─── DORMANT STRIPE CHECKOUT PATH ────────────────────────────────────────────
// The live product flow (waitlist) does NOT use any of the Stripe handlers
// below. They fail closed with 501 unless STRIPE_SECRET_KEY /
// STRIPE_WEBHOOK_SECRET are configured, which they intentionally are not in
// production. Keep dormant until checkout is launched with a tested plan.
// ─────────────────────────────────────────────────────────────────────────────
async function createCheckoutSession(request, env) {
  const missingEnv = envMissing(env.STRIPE_SECRET_KEY);
  if (missingEnv.length) {
    return json({ ok:false, error:"Stripe checkout is not configured. Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Cloudflare, then retry." }, 501);
  }

  let order;
  try {
    order = await request.json();
  } catch {
    return json({ ok:false, error:"Invalid checkout payload." }, 400);
  }

  const missing = requiredOrderFields(order);
  if (missing.length) return json({ ok:false, error:`Missing required fields: ${missing.join(", ")}` }, 400);

  const url = new URL(request.url);
  const origin = url.origin;
  const metadata = orderMetadata(order);
  const form = new URLSearchParams();
  form.append("mode", "payment");
  form.append("success_url", `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  form.append("cancel_url", `${origin}/?checkout=cancelled`);
  form.append("client_reference_id", metadataValue(order.order_id));
  form.append("customer_email", metadataValue(order.customer_email));
  // Collect the shipping address on Stripe's hosted page (the maker needs it).
  form.append("shipping_address_collection[allowed_countries][0]", "US");
  // Line 0: the founder's cut pair, at cost ($20). Line 1: shipping ($1).
  form.append("line_items[0][quantity]", "1");
  form.append("line_items[0][price_data][currency]", "usd");
  form.append("line_items[0][price_data][unit_amount]", String(FOUNDER_FRAME_CENTS));
  form.append("line_items[0][price_data][product_data][name]", "FitFrame founder's cut pair · PA12 nylon");
  form.append("line_items[0][price_data][product_data][description]", "Made-to-measure PA12 nylon frame, printed to your scan. Founder price locked at $60.");
  form.append("line_items[1][quantity]", "1");
  form.append("line_items[1][price_data][currency]", "usd");
  form.append("line_items[1][price_data][unit_amount]", String(FOUNDER_SHIPPING_CENTS));
  form.append("line_items[1][price_data][product_data][name]", "Shipping");
  appendMetadata(form, "metadata", metadata);
  appendMetadata(form, "payment_intent_data[metadata]", metadata);

  const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method:"POST",
    headers:{
      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body:form,
  });
  const stripeData = await stripeRes.json();
  if (!stripeRes.ok) return json({ ok:false, error:stripeData?.error?.message || "Stripe checkout failed." }, 502);

  return json({ ok:true, id:stripeData.id, url:stripeData.url });
}

async function getCheckoutSession(request, env) {
  if (!env.STRIPE_SECRET_KEY) return json({ ok:false, error:"Stripe checkout is not configured." }, 501);
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId || !sessionId.startsWith("cs_")) return json({ ok:false, error:"Missing checkout session." }, 400);

  const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers:{ "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  const session = await stripeRes.json();
  if (!stripeRes.ok) return json({ ok:false, error:session?.error?.message || "Could not load checkout session." }, 502);

  return json({
    ok:true,
    session_id:session.id,
    payment_status:session.payment_status,
    payment_intent:session.payment_intent,
    customer_email:session.customer_details?.email || session.customer_email,
    metadata:session.metadata || {},
  });
}

function parseStripeSignature(header) {
  const parsed = { signatures:[] };
  header.split(",").forEach(part => {
    const [key, value] = part.split("=");
    if (key === "v1") parsed.signatures.push(value);
    else parsed[key] = value;
  });
  return parsed;
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifyStripeSignature(payload, header, secret) {
  if (!header || !secret) return false;
  const parsed = parseStripeSignature(header);
  const timestamp = Number(parsed.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const signedPayload = `${parsed.t}.${payload}`;
  const expected = toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload)));
  return parsed.signatures.some(signature => safeEqual(signature, expected));
}

function formatShipping(session) {
  const ship = session.shipping_details || session.collected_information?.shipping_details || {};
  const a = ship.address || {};
  const line2 = a.line2 ? `, ${a.line2}` : "";
  return [
    `Name: ${ship.name || session.customer_details?.name || "-"}`,
    `Address: ${a.line1 ? `${a.line1}${line2}` : "-"}`,
    `City: ${a.city || "-"}`,
    `State: ${a.state || "-"}`,
    `ZIP: ${a.postal_code || "-"}`,
    `Country: ${a.country || "-"}`,
  ];
}

function paidOrderSpec(session, pairNumber) {
  const m = session.metadata || {};
  const paymentId = session.payment_intent || session.id;
  return [
    "FITFRAME FOUNDER'S CUT — paid reservation",
    `Pair #: ${pairNumber != null ? pairNumber : "-"}`,
    `Email: ${m.customer_email || session.customer_details?.email || "-"}`,
    `Submitted: ${m.submitted || "-"}`,
    `Stripe payment ID: ${paymentId}`,
    `Stripe checkout session ID: ${session.id}`,
    "",
    "FOUNDER AGREEMENT",
    `What they wear now: ${m.wear_now || "-"}`,
    `What's wrong with them: ${m.whats_wrong || "-"}`,
    `Will share photo + honest review: ${m.will_share || "-"}`,
    `Marketing opt-in: ${m.marketing_opt_in || "no"}`,
    "",
    "SHIPPING",
    ...formatShipping(session),
    "",
    "FRAME",
    `Frame ID: ${m.frame_id || "-"}`,
    `Frame: ${m.frame || "-"}`,
    `Lens: ${m.lens || "-"}`,
    "",
    "FACE MEASUREMENTS (mm)",
    `PD binocular: ${m.pd_binocular || "-"}`,
    `PD left: ${m.pd_left || "-"}`,
    `PD right: ${m.pd_right || "-"}`,
    `Bridge width: ${m.bridge_width_mm || "-"}`,
    `Temple: ${m.temple_mm || "-"}`,
    `Lens height: ${m.face_height_mm || "-"}`,
    `Face width: ${m.face_width_mm || "-"}`,
    `Scale source: ${m.scale_source || "-"}`,
    `Scan quality: ${m.scan_quality || "-"}`,
    `Valid frames: ${m.valid_frames_pct || "-"}`,
  ].join("\n");
}

async function sendResendEmail({ env, to, subject, text }) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured.");
  const res = await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type":"application/json",
    },
    body:JSON.stringify({
      from:env.RESEND_FROM_EMAIL || "FitFrame <orders@fitframe.store>",
      to,
      subject,
      text,
    }),
  });
  if (!res.ok) throw new Error(`Resend failed with ${res.status}`);
}

async function stripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ ok:false, error:"STRIPE_WEBHOOK_SECRET is not configured." }, 501);
  const payload = await request.text();
  const signature = request.headers.get("Stripe-Signature");
  const verified = await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!verified) return json({ ok:false, error:"Invalid Stripe signature." }, 400);

  const event = JSON.parse(payload);
  if (event.type !== "checkout.session.completed") return json({ ok:true, ignored:true });

  const session = event.data.object;
  if (session.payment_status !== "paid") return json({ ok:true, unpaid:true });

  // A confirmed payment is the only thing that increments the reservation count,
  // so the founder's-cut counter reflects genuine paid reservations only.
  const pairNumber = await incrementReservationCount(env);
  const orderRef = session.metadata?.order_id || session.id;

  try {
    await sendResendEmail({
      env,
      to:env.FITFRAME_ORDER_EMAIL || ORDER_EMAIL,
      subject:`FitFrame founder reservation — pair #${pairNumber} (${orderRef})`,
      text:paidOrderSpec(session, pairNumber),
    });
    console.log(`[founder-spec] sent ok — pair #${pairNumber}, order ${orderRef}`);
  } catch (err) {
    console.error(`[founder-spec] SEND FAILED — pair #${pairNumber}, order ${orderRef}: ${err?.message || err}`);
    // The payment succeeded; surface the failure to Stripe so it retries delivery.
    return json({ ok:false, error:"reservation recorded but spec email failed", pair:pairNumber }, 500);
  }

  return json({ ok:true, pair:pairNumber });
}

async function readReservationCount(env) {
  if (!env.FITFRAME_KV) return fallbackReservationCount;
  const stored = await env.FITFRAME_KV.get(RESERVATION_COUNT_KEY);
  const count = Number.parseInt(stored || "", 10);
  if (Number.isFinite(count)) return count;
  await env.FITFRAME_KV.put(RESERVATION_COUNT_KEY, String(RESERVATION_COUNT_SEED));
  return RESERVATION_COUNT_SEED;
}

async function incrementReservationCount(env) {
  if (!env.FITFRAME_KV) { fallbackReservationCount += 1; return fallbackReservationCount; }
  const next = (await readReservationCount(env)) + 1;
  await env.FITFRAME_KV.put(RESERVATION_COUNT_KEY, String(next));
  return next;
}

async function reservationCount(request, env, rateHeaders = {}) {
  if (request.method !== "GET") return json({ ok:false, error:"Method not allowed." }, 405, rateHeaders);
  return json({ ok:true, count:await readReservationCount(env) }, 200, rateHeaders);
}

async function readScanCount(env) {
  if (!env.FITFRAME_KV) return fallbackScanCount;
  const stored = await env.FITFRAME_KV.get(SCAN_COUNT_KEY);
  const count = Number.parseInt(stored || "", 10);
  if (Number.isFinite(count)) return count;
  await env.FITFRAME_KV.put(SCAN_COUNT_KEY, String(SCAN_COUNT_SEED));
  return SCAN_COUNT_SEED;
}

async function scanCount(request, env, rateHeaders = {}) {
  if (request.method !== "GET") return json({ ok:false, error:"Method not allowed." }, 405, rateHeaders);
  return json({ ok:true, count:await readScanCount(env) }, 200, rateHeaders);
}

async function scanComplete(request, env, rateHeaders = {}) {
  if (request.method !== "POST") return json({ ok:false, error:"Method not allowed." }, 405, rateHeaders);
  if (!env.FITFRAME_KV) {
    fallbackScanCount += 1;
    return json({ ok:true, count:fallbackScanCount, storage:"worker-memory" }, 200, rateHeaders);
  }
  const next = (await readScanCount(env)) + 1;
  await env.FITFRAME_KV.put(SCAN_COUNT_KEY, String(next));
  return json({ ok:true, count:next, storage:"kv" }, 200, rateHeaders);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase().slice(0, 254);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeCreatorKey(raw) {
  const key = String(raw || "").trim().toLowerCase();
  if (!/^[a-z0-9]{6,32}$/.test(key)) return null;
  return key;
}

async function readCreatorKey(env, key) {
  if (!env.FITFRAME_KV || !key) return null;
  const stored = await env.FITFRAME_KV.get(`creator_key:${key}`);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function markCreatorKeyUsed(env, key) {
  const record = await readCreatorKey(env, key);
  if (!record || record.used) return false;
  await env.FITFRAME_KV.put(`creator_key:${key}`, JSON.stringify({
    ...record,
    used: true,
    used_at: new Date().toISOString(),
  }));
  return true;
}

async function creatorKey(request, env, rateHeaders = {}) {
  if (request.method !== "GET") return json({ valid: false }, 200, rateHeaders);
  const url = new URL(request.url);
  const key = normalizeCreatorKey(url.searchParams.get("key"));
  if (!key) return json({ valid: false }, 200, rateHeaders);
  const record = await readCreatorKey(env, key);
  if (!record || record.used) return json({ valid: false }, 200, rateHeaders);
  const name = typeof record.name === "string" ? record.name.slice(0, 80) : "";
  if (!name) return json({ valid: false }, 200, rateHeaders);
  return json({ valid: true, name }, 200, rateHeaders);
}

async function readWaitlistCount(env) {
  if (!env.FITFRAME_KV) return fallbackWaitlistCount;
  const stored = await env.FITFRAME_KV.get(WAITLIST_COUNT_KEY);
  const count = Number.parseInt(stored || "", 10);
  if (Number.isFinite(count) && count > 0) return count;
  let recovered = 0;
  if (typeof env.FITFRAME_KV.list === "function") {
    let cursor;
    do {
      const page = await env.FITFRAME_KV.list({ prefix:"waitlist:", cursor });
      recovered += page.keys.length;
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  }
  if (recovered > 0) {
    await env.FITFRAME_KV.put(WAITLIST_COUNT_KEY, String(recovered));
    return recovered;
  }
  if (Number.isFinite(count)) return count;
  await env.FITFRAME_KV.put(WAITLIST_COUNT_KEY, String(WAITLIST_COUNT_SEED));
  return WAITLIST_COUNT_SEED;
}

function buildWaitlistEmailText(email, measurements, frameId, position) {
  const m = measurements || {};
  return [
    "You're on the FitFrame founding member list.",
    "",
    `Position: #${position}`,
    "",
    "We'll reach out when your batch opens. Here's what we have on file:",
    "",
    "Frame: " + (frameId || "Not selected"),
    "PD: " + (m.pd || "-"),
    "Bridge: " + (m.bridge || "-") + " mm",
    "Temple: " + (m.temple || "-") + " mm",
    "Face height: " + (m.faceH || "-") + " mm",
    "",
    "fitframe.store",
  ].join("\n");
}

function buildFounderNotificationText({
  email,
  orderId,
  timestamp,
  measurements,
  frameId,
  position,
  lens,
  lensPrice,
  total,
  creatorKey,
  creatorName,
}) {
  const m = measurements || {};
  const lensLine = lensPrice ? `+$${lensPrice}` : "included";
  const lines = [
    "FITFRAME WAITLIST SPEC",
    "",
    `Order ID: ${orderId || "-"}`,
    `Customer email: ${email}`,
    `Position: #${position}`,
    `Submitted: ${timestamp || new Date().toISOString()}`,
    "",
    "FRAME",
    `Frame ID: ${frameId || "Not selected"}`,
    `Lens: ${lens || "blue light"} — ${lensLine}`,
    `Total: $${total != null ? total : "-"}`,
    "",
    "MEASUREMENTS_MM",
    `PD: ${m.pd || "-"}`,
    `Left PD: ${m.pdLeft || "-"}`,
    `Right PD: ${m.pdRight || "-"}`,
    `Bridge: ${m.bridge || "-"} mm`,
    `Temple: ${m.temple || "-"} mm`,
    `Lens height: ${m.lensH || "-"} mm`,
    `Face width: ${m.faceW || "-"} mm`,
    "",
    "SCAN",
    `Scale source: ${m.scaleSource || "-"}`,
    `Scan quality: ${m.scanQuality || "-"}`,
    `Valid frames: ${m.validPct != null ? `${m.validPct}%` : "-"}`,
  ];
  if (creatorKey && creatorName) {
    lines.push("", `creator key: ${creatorKey} (${creatorName})`, "reminder: free pair — reach out within 24h to confirm shipping address.");
  }
  return lines.join("\n");
}

async function waitlist(request, env, rateHeaders = {}) {
  if (request.method !== "POST") return json({ ok:false, error:"Method not allowed." }, 405, rateHeaders);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok:false, error:"Invalid waitlist payload." }, 400);
  }

  // Honeypot check — bot filled hidden field, silently accept
  if (payload?.website && payload.website.length > 0) {
    return json({ ok: true }, 200);
  }

  const email = normalizeEmail(payload.email);
  if (!validEmail(email) || email.length > 254) return json({ ok:false, error:"Enter a valid email address." }, 400);

  // Measurement sanity check
  const pd = parseFloat(payload.measurements?.pd);
  if (pd && (isNaN(pd) || pd < 45 || pd > 80)) {
    return json({ ok:false, error:"invalid measurements" }, 400);
  }

  // Strip unexpected fields
  const allowed = ["email", "order_id", "measurements", "frame_id", "colorway_id", "lens", "lens_price", "total", "timestamp", "creator_key"];
  const sanitized = Object.fromEntries(
    Object.entries(payload).filter(([k]) => allowed.includes(k))
  );

  let creatorKey = normalizeCreatorKey(sanitized.creator_key);
  let creatorName = null;
  if (creatorKey) {
    const record = await readCreatorKey(env, creatorKey);
    if (!record || record.used) {
      creatorKey = null;
    } else {
      creatorName = typeof record.name === "string" ? record.name.slice(0, 80) : null;
      if (!creatorName) creatorKey = null;
    }
  }

  const measurements = sanitized.measurements || null;
  const orderId = typeof sanitized.order_id === "string" ? sanitized.order_id.slice(0, 32) : null;
  const frameId = sanitized.frame_id || null;
  const colorwayId = sanitized.colorway_id || null;
  const lens = typeof sanitized.lens === "string" ? sanitized.lens.slice(0, 60) : null;
  const lensPrice = Number.isFinite(sanitized.lens_price) ? sanitized.lens_price : null;
  const total = Number.isFinite(sanitized.total) ? sanitized.total : null;
  const submittedAt = typeof sanitized.timestamp === "string" ? sanitized.timestamp.slice(0, 40) : new Date().toISOString();

  const key = `waitlist:${email}`;
  let duplicate;
  let position = 1;

  if (env.FITFRAME_KV) {
    const existing = await env.FITFRAME_KV.get(key);
    duplicate = Boolean(existing);
    if (!duplicate) {
      const nextCount = (await readWaitlistCount(env)) + 1;
      await env.FITFRAME_KV.put(WAITLIST_COUNT_KEY, String(nextCount));
      position = nextCount;
      await env.FITFRAME_KV.put(key, JSON.stringify({
        email,
        order_id:orderId,
        measurements,
        frame_id:frameId,
        colorway_id:colorwayId,
        lens,
        lens_price:lensPrice,
        total,
        position,
        created_at:submittedAt,
      }));
    } else {
      const parsed = JSON.parse(existing);
      position = parsed.position || 1;
    }
  } else {
    duplicate = fallbackWaitlist.has(email);
    if (!duplicate) {
      fallbackWaitlistCount += 1;
      position = fallbackWaitlistCount;
    }
    fallbackWaitlist.add(email);
  }

  const currentCount = await readWaitlistCount(env).catch(() => fallbackWaitlistCount);

  const founderSubjectBase = `FitFrame waitlist spec — ${orderId || email}`;
  const founderSubject = creatorName
    ? `[CREATOR: ${creatorName}] ${founderSubjectBase}`
    : founderSubjectBase;

  if (env.RESEND_API_KEY) {
    let founderEmailOk = false;
    if (!duplicate) {
      try {
        await sendResendEmail({
          env,
          to:email,
          subject:"You're on the FitFrame founding member list",
          text:buildWaitlistEmailText(email, measurements, frameId, position),
        });
      } catch { /* customer email failure does not block founder path */ }
    }

    if (env.FITFRAME_ORDER_EMAIL || ORDER_EMAIL) {
      const sendFounder = !duplicate || creatorKey;
      if (sendFounder) {
        try {
          await sendResendEmail({
            env,
            to:env.FITFRAME_ORDER_EMAIL || ORDER_EMAIL,
            subject:founderSubject,
            text:buildFounderNotificationText({
              email,
              orderId,
              timestamp:submittedAt,
              measurements,
              frameId,
              position,
              lens,
              lensPrice,
              total,
              creatorKey,
              creatorName,
            }),
          });
          founderEmailOk = true;
        } catch { /* founder email failed — do not mark creator key used */ }
      }
    }

    if (creatorKey && founderEmailOk) {
      await markCreatorKeyUsed(env, creatorKey);
    }
  }

  return json({
    ok: true,
    duplicate,
    position,
    count: currentCount,
    creator: Boolean(creatorKey),
  }, 200, rateHeaders);
}

function validateOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== ALLOWED_ORIGIN) {
    return new Response(null, { status: 204 });
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (isSensitivePath(url.pathname)) {
      return notFound();
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status:204, headers: mergeHeaders(corsHeaders) });
    }

    const originBlock = validateOrigin(request);
    if (originBlock) return originBlock;

    if (url.pathname.startsWith("/api/")) {
      const rate = await enforceRateLimit(request, env);
      if (!rate.ok) {
        return json({ error:"too many requests" }, 429, rate.headers);
      }

      if (url.pathname === "/api/create-checkout-session" && request.method === "POST") return createCheckoutSession(request, env);
      if (url.pathname === "/api/checkout-session" && request.method === "GET") return getCheckoutSession(request, env);
      if (url.pathname === "/api/stripe-webhook" && request.method === "POST") return stripeWebhook(request, env);
      if (url.pathname === "/api/reservation-count") return reservationCount(request, env, rate.headers);
      if (url.pathname === "/api/scan-count") return scanCount(request, env, rate.headers);
      if (url.pathname === "/api/scan-complete") return scanComplete(request, env, rate.headers);
      if (url.pathname === "/api/waitlist") return waitlist(request, env, rate.headers);
      if (url.pathname === "/api/creator-key") return creatorKey(request, env, rate.headers);

      return json({ error:"Not found." }, 404, rate.headers);
    }

    return serveAssets(request, env);
  },
};
