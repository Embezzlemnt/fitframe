const ORDER_EMAIL = "hello@fitframe.store";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_BODY_BYTES = 64 * 1024;

const securityHeaders = {
  "Content-Type":"application/json",
  "X-Content-Type-Options":"nosniff",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers:securityHeaders });
}

function clean(value, max = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function escapeHtml(value) {
  return clean(value, 2000)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value, 254));
}

function requiredOrderFields(order) {
  return [
    "order_id",
    "customer_name",
    "customer_email",
    "shipping_street",
    "shipping_city",
    "shipping_state",
    "shipping_zip",
    "frame",
    "frame_id",
  ].every(key => clean(order?.[key]));
}

function buildMakerSpec(order) {
  return [
    "FITFRAME MAKER SPEC",
    "",
    `Order ID: ${clean(order.order_id)}`,
    `Customer: ${clean(order.customer_name)}`,
    `Customer email: ${clean(order.customer_email)}`,
    `Created: ${clean(order.timestamp)}`,
    "",
    "SHIP_TO",
    clean(order.shipping_name || order.customer_name),
    clean(order.shipping_street),
    `${clean(order.shipping_city)}, ${clean(order.shipping_state)} ${clean(order.shipping_zip)}`,
    "",
    "FRAME",
    `Style: ${clean(order.frame)}`,
    `Frame ID: ${clean(order.frame_id)}`,
    `Lens: ${clean(order.lens)}`,
    `Total: $${clean(order.total)}`,
    `Material recommendation: ${clean(order.material)}`,
    "",
    "MEASUREMENTS_MM",
    `Binocular PD: ${clean(order.pd_binocular)}`,
    `Left PD: ${clean(order.pd_left)}`,
    `Right PD: ${clean(order.pd_right)}`,
    `Bridge: ${clean(order.bridge_mm)}`,
    `Lens height: ${clean(order.lens_height_mm)}`,
    `Face width: ${clean(order.face_width_mm)}`,
    `Temple length: ${clean(order.temple_mm)}`,
    "",
    "SCAN",
    `Scale source: ${clean(order.scale_source)}`,
    `Card reference: ${clean(order.card_reference, 1000)}`,
    `Quality: ${clean(order.scan_quality)}`,
    `Valid frames: ${clean(order.valid_frames_pct)}%`,
    "",
    "FIT_ANSWERS",
    `Fit history: ${clean(order.style_fit)}`,
    `Visual instinct: ${clean(order.style_vibe)}`,
    `Use case: ${clean(order.style_use)}`,
    `Priority: ${clean(order.style_priority)}`,
    "",
    "PRODUCTION_NOTES",
    "Use the matching STL for the selected frame ID. Scale front geometry to face width, set bridge to measured bridge, keep adjustable nose pad allowance, and use PD to center optical openings. PA12 nylon is the default launch material.",
    "",
    "USER_AGENT",
    clean(order.user_agent, 1000),
  ].join("\n");
}

function buildCustomerText(order) {
  const firstName = clean(order.customer_name).split(" ")[0] || "there";
  return [
    `Hi ${firstName},`,
    "",
    "We received your FitFrame order.",
    "",
    `Order ID: ${clean(order.order_id)}`,
    `Frame: ${clean(order.frame)}`,
    `Lens: ${clean(order.lens)}`,
    `Total: $${clean(order.total)}`,
    "",
    "Shipping to:",
    clean(order.shipping_name || order.customer_name),
    clean(order.shipping_street),
    `${clean(order.shipping_city)}, ${clean(order.shipping_state)} ${clean(order.shipping_zip)}`,
    "",
    "We will review the fit scan and follow up with payment and shipping next steps.",
    "",
    "FitFrame",
    "https://fitframe.store",
  ].join("\n");
}

function buildCustomerHtml(order) {
  const firstName = escapeHtml(clean(order.customer_name).split(" ")[0] || "there");
  const orderId = escapeHtml(order.order_id);
  const frame = escapeHtml(order.frame);
  const lens = escapeHtml(order.lens);
  const total = escapeHtml(order.total);
  const eta = escapeHtml(order.eta || "7-10 days after confirmation");
  const shipName = escapeHtml(order.shipping_name || order.customer_name);
  const street = escapeHtml(order.shipping_street);
  const cityLine = escapeHtml(`${clean(order.shipping_city)}, ${clean(order.shipping_state)} ${clean(order.shipping_zip)}`);

  return `<!doctype html>
<html>
  <body style="margin:0;background:#0d0d0d;color:#f2f0e8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="max-width:520px;margin:0 auto;padding:28px 20px;">
      <div style="font-size:22px;font-weight:600;letter-spacing:-0.04em;margin-bottom:26px;">fitframe<span style="color:#4caf7d;">.</span></div>
      <h1 style="font-size:28px;line-height:1.08;margin:0 0 14px;font-weight:600;letter-spacing:-0.04em;">Order received, ${firstName}.</h1>
      <p style="margin:0 0 24px;color:#b0ada2;line-height:1.6;font-size:15px;">We received your scan, frame choice, and shipping details. We will review the fit data before production.</p>
      <div style="border:1px solid #2b2b28;border-radius:14px;overflow:hidden;background:#161615;margin-bottom:22px;">
        <div style="padding:13px 16px;border-bottom:1px solid #2b2b28;color:#555249;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;">${orderId}</div>
        <div style="padding:14px 16px;border-bottom:1px solid #2b2b28;display:flex;justify-content:space-between;gap:16px;"><span style="color:#858176;">Frame</span><strong>${frame}</strong></div>
        <div style="padding:14px 16px;border-bottom:1px solid #2b2b28;display:flex;justify-content:space-between;gap:16px;"><span style="color:#858176;">Lens</span><strong>${lens}</strong></div>
        <div style="padding:14px 16px;display:flex;justify-content:space-between;gap:16px;"><span style="color:#858176;">Total</span><strong>$${total}</strong></div>
      </div>
      <div style="border-top:1px solid #2b2b28;padding-top:18px;margin-bottom:22px;">
        <div style="color:#555249;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;">Shipping</div>
        <p style="margin:0;color:#b0ada2;line-height:1.6;font-size:14px;">${shipName}<br>${street}<br>${cityLine}</p>
      </div>
      <div style="border-top:1px solid #2b2b28;padding-top:18px;">
        <div style="color:#555249;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:8px;">Next</div>
        <p style="margin:0;color:#b0ada2;line-height:1.6;font-size:14px;">Estimated delivery target: ${eta}. We will email if we need anything before making your frames.</p>
      </div>
    </div>
  </body>
</html>`;
}

async function sendResendEmail({ apiKey, from, to, replyTo, subject, text, html }) {
  const response = await fetch(RESEND_ENDPOINT, {
    method:"POST",
    headers:{
      Authorization:`Bearer ${apiKey}`,
      "Content-Type":"application/json",
    },
    body:JSON.stringify({
      from,
      to:[to],
      reply_to:replyTo,
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend rejected email: ${response.status} ${detail}`);
  }
  return response.json();
}

export async function handleSubmitOrder({ request, env }) {
  if (!env?.RESEND_API_KEY) return json({ error:"Order email is not configured." }, 500);

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return json({ error:"Order payload is too large." }, 413);

  let parsed;
  try {
    parsed = JSON.parse(rawBody || "{}");
  } catch {
    return json({ error:"Invalid JSON payload." }, 400);
  }

  const order = parsed.order || {};
  if (!requiredOrderFields(order) || !validEmail(order.customer_email)) {
    return json({ error:"Missing required order or shipping details." }, 400);
  }

  const from = env.RESEND_FROM_EMAIL || "FitFrame <hello@fitframe.store>";
  const orderEmail = env.FITFRAME_ORDER_EMAIL || ORDER_EMAIL;
  const customerEmail = clean(order.customer_email, 254);
  const makerSpec = buildMakerSpec(order);

  try {
    await Promise.all([
      sendResendEmail({
        apiKey:env.RESEND_API_KEY,
        from,
        to:orderEmail,
        replyTo:customerEmail,
        subject:`FitFrame Order ${clean(order.order_id)}`,
        text:makerSpec,
      }),
      sendResendEmail({
        apiKey:env.RESEND_API_KEY,
        from,
        to:customerEmail,
        replyTo:orderEmail,
        subject:`We received your FitFrame order ${clean(order.order_id)}`,
        text:buildCustomerText(order),
        html:buildCustomerHtml(order),
      }),
    ]);
  } catch (err) {
    console.error(err);
    return json({ error:"Order email could not be sent." }, 502);
  }

  return json({ ok:true, orderId:clean(order.order_id) });
}

export async function onRequestPost(context) {
  return handleSubmitOrder(context);
}

export async function onRequestOptions() {
  return new Response(null, { status:204, headers:securityHeaders });
}
