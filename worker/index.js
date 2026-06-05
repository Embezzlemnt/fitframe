const ORDER_PRICE_CENTS = 11900;
const ORDER_EMAIL = "Lorenzo.Laws@outlook.com";
const SCAN_COUNT_KEY = "faces_scanned_count";
const SCAN_COUNT_SEED = 47;
const WAITLIST_COUNT_KEY = "waitlist_count";
const WAITLIST_COUNT_SEED = 0;

let fallbackScanCount = SCAN_COUNT_SEED;
let fallbackWaitlistCount = WAITLIST_COUNT_SEED;
const fallbackWaitlist = new Set();

const ALLOWED_ORIGIN = "https://fitframe.store";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const jsonHeaders = {
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  ...corsHeaders,
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
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
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    shipping_name: order.shipping_name || order.customer_name,
    shipping_address: order.shipping_address,
    shipping_city: order.shipping_city,
    shipping_state: order.shipping_state,
    shipping_zip: order.shipping_zip,
    frame_id: order.frame_id,
    frame: order.frame,
    colorway_id: order.colorway_id || "pending",
    colorway: order.colorway || "Pending selection",
    lens: order.lens,
    pd_binocular: order.pd_binocular,
    pd_left: order.pd_left,
    pd_right: order.pd_right,
    bridge_width_mm: order.bridge_width_mm || order.bridge_mm,
    temple_mm: order.temple_mm,
    face_height_mm: order.face_height_mm,
    face_width_mm: order.face_width_mm,
    scan_quality: order.scan_quality,
    valid_frames_pct: order.valid_frames_pct,
  };
}

function appendMetadata(form, prefix, metadata) {
  Object.entries(metadata).forEach(([key, value]) => {
    form.append(`${prefix}[${key}]`, metadataValue(value));
  });
}

function requiredOrderFields(order) {
  return [
    "order_id",
    "customer_name",
    "customer_email",
    "shipping_address",
    "shipping_city",
    "shipping_state",
    "shipping_zip",
    "frame_id",
    "pd_binocular",
    "bridge_width_mm",
    "temple_mm",
    "face_height_mm",
  ].filter(key => !order[key]);
}

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
  form.append("line_items[0][quantity]", "1");
  form.append("line_items[0][price_data][currency]", "usd");
  form.append("line_items[0][price_data][unit_amount]", String(ORDER_PRICE_CENTS));
  form.append("line_items[0][price_data][product_data][name]", "FitFrame custom 3D printed glasses");
  form.append("line_items[0][price_data][product_data][description]", "Made-to-measure PA12 frame with blue light lenses");
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

function paidOrderSpec(session) {
  const m = session.metadata || {};
  const paymentId = session.payment_intent || session.id;
  return [
    "FitFrame paid order",
    `Stripe payment confirmation ID: ${paymentId}`,
    `Stripe checkout session ID: ${session.id}`,
    "",
    "Customer",
    `Name: ${m.customer_name || "-"}`,
    `Email: ${m.customer_email || session.customer_details?.email || "-"}`,
    "",
    "Shipping",
    `Name: ${m.shipping_name || m.customer_name || "-"}`,
    `Address: ${m.shipping_address || "-"}`,
    `City: ${m.shipping_city || "-"}`,
    `State: ${m.shipping_state || "-"}`,
    `ZIP: ${m.shipping_zip || "-"}`,
    "",
    "Frame",
    `Frame ID: ${m.frame_id || "-"}`,
    `Frame style: ${m.frame || "-"}`,
    `Colorway: ${m.colorway || "-"}`,
    `Lens: ${m.lens || "-"}`,
    "",
    "Face measurements",
    `PD binocular: ${m.pd_binocular || "-"}`,
    `PD left: ${m.pd_left || "-"}`,
    `PD right: ${m.pd_right || "-"}`,
    `Bridge width: ${m.bridge_width_mm || "-"}`,
    `Temple width: ${m.temple_mm || "-"}`,
    `Face height: ${m.face_height_mm || "-"}`,
    `Face width: ${m.face_width_mm || "-"}`,
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

  await sendResendEmail({
    env,
    to:env.FITFRAME_ORDER_EMAIL || ORDER_EMAIL,
    subject:`FitFrame paid order ${session.metadata?.order_id || session.id}`,
    text:paidOrderSpec(session),
  });

  return json({ ok:true });
}

async function readScanCount(env) {
  if (!env.FITFRAME_KV) return fallbackScanCount;
  const stored = await env.FITFRAME_KV.get(SCAN_COUNT_KEY);
  const count = Number.parseInt(stored || "", 10);
  if (Number.isFinite(count)) return count;
  await env.FITFRAME_KV.put(SCAN_COUNT_KEY, String(SCAN_COUNT_SEED));
  return SCAN_COUNT_SEED;
}

async function scanCount(request, env) {
  if (request.method !== "GET") return json({ ok:false, error:"Method not allowed." }, 405);
  return json({ ok:true, count:await readScanCount(env) });
}

async function scanComplete(request, env) {
  if (request.method !== "POST") return json({ ok:false, error:"Method not allowed." }, 405);
  if (!env.FITFRAME_KV) {
    fallbackScanCount += 1;
    return json({ ok:true, count:fallbackScanCount, storage:"worker-memory" });
  }
  const next = (await readScanCount(env)) + 1;
  await env.FITFRAME_KV.put(SCAN_COUNT_KEY, String(next));
  return json({ ok:true, count:next, storage:"kv" });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase().slice(0, 254);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function readWaitlistCount(env) {
  if (!env.FITFRAME_KV) return fallbackWaitlistCount;
  const stored = await env.FITFRAME_KV.get(WAITLIST_COUNT_KEY);
  const count = Number.parseInt(stored || "", 10);
  if (Number.isFinite(count)) return count;
  await env.FITFRAME_KV.put(WAITLIST_COUNT_KEY, String(WAITLIST_COUNT_SEED));
  return WAITLIST_COUNT_SEED;
}

async function waitlistCount(request, env) {
  if (request.method !== "GET") return json({ ok:false, error:"Method not allowed." }, 405);
  return json({ ok:true, count:await readWaitlistCount(env) });
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

function buildFounderNotificationText(email, measurements, frameId, position) {
  const m = measurements || {};
  return [
    "New FitFrame waitlist signup",
    "",
    `Email: ${email}`,
    `Position: #${position}`,
    `Frame: ${frameId || "Not selected"}`,
    "",
    "Measurements",
    `PD: ${m.pd || "-"}`,
    `Bridge: ${m.bridge || "-"} mm`,
    `Temple: ${m.temple || "-"} mm`,
    `Face height: ${m.faceH || "-"} mm`,
    `Face width: ${m.faceW || "-"} mm`,
    "",
    `Submitted: ${new Date().toISOString()}`,
  ].join("\n");
}

async function waitlist(request, env) {
  if (request.method !== "POST") return json({ ok:false, error:"Method not allowed." }, 405);

  // Rate limiting
  if (env.RATE_LIMITER) {
    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.RATE_LIMITER.limit({ key: clientIp });
    if (!success) {
      return json({ error: "too many requests" }, 429);
    }
  }

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
  const allowed = ["email", "measurements", "frame_id", "colorway_id", "timestamp"];
  const sanitized = Object.fromEntries(
    Object.entries(payload).filter(([k]) => allowed.includes(k))
  );

  const measurements = sanitized.measurements || null;
  const frameId = sanitized.frame_id || null;

  const key = `waitlist:${email}`;
  let position = 1;
  let duplicate;

  if (env.FITFRAME_KV) {
    const existing = await env.FITFRAME_KV.get(key);
    duplicate = Boolean(existing);
    if (!duplicate) {
      const nextCount = (await readWaitlistCount(env)) + 1;
      await env.FITFRAME_KV.put(WAITLIST_COUNT_KEY, String(nextCount));
      position = nextCount;
      await env.FITFRAME_KV.put(key, JSON.stringify({
        email,
        measurements,
        frame_id:frameId,
        position,
        created_at:new Date().toISOString(),
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

  if (!duplicate && env.RESEND_API_KEY) {
    const emailPromises = [
      sendResendEmail({
        env,
        to:email,
        subject:"You're on the FitFrame founding member list",
        text:buildWaitlistEmailText(email, measurements, frameId, position),
      }),
    ];
    if (env.FITFRAME_ORDER_EMAIL || ORDER_EMAIL) {
      emailPromises.push(sendResendEmail({
        env,
        to:env.FITFRAME_ORDER_EMAIL || ORDER_EMAIL,
        subject:`FitFrame waitlist signup — ${email}`,
        text:buildFounderNotificationText(email, measurements, frameId, position),
      }));
    }
    await Promise.allSettled(emailPromises);
  }

  return json({ ok:true, duplicate, position, count:currentCount });
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

    if (request.method === "OPTIONS") {
      return new Response(null, { status:204, headers:corsHeaders });
    }

    const originBlock = validateOrigin(request);
    if (originBlock) return originBlock;

    if (url.pathname === "/api/create-checkout-session" && request.method === "POST") return createCheckoutSession(request, env);
    if (url.pathname === "/api/checkout-session" && request.method === "GET") return getCheckoutSession(request, env);
    if (url.pathname === "/api/stripe-webhook" && request.method === "POST") return stripeWebhook(request, env);
    if (url.pathname === "/api/scan-count") return scanCount(request, env);
    if (url.pathname === "/api/scan-complete") return scanComplete(request, env);
    if (url.pathname === "/api/waitlist") return waitlist(request, env);
    if (url.pathname === "/api/waitlist-count") return waitlistCount(request, env);

    if (url.pathname.startsWith("/api/")) return json({ error:"Not found." }, 404);
    return new Response(null, { status:404 });
  },
};
