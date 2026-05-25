const corsHeaders = {
  "Access-Control-Allow-Origin": "https://fitframe.store",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function specFromPayload(payload) {
  if (payload.spec_text) return payload.spec_text;
  return Object.entries(payload).map(([key, value]) => `${key}: ${value}`).join("\n");
}

async function sendResendEmail({ env, to, subject, text }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "FitFrame <orders@fitframe.store>",
      to,
      subject,
      text,
    }),
  });
  if (!res.ok) throw new Error(`Resend failed with ${res.status}`);
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return json({ ok: false, error: "Email service not configured" }, 500);
    const payload = await request.json();
    const required = ["order_id", "customer_name", "customer_email", "frame_id", "pd_binocular"];
    const missing = required.filter(key => !payload[key]);
    if (missing.length) return json({ ok: false, error: `Missing required fields: ${missing.join(", ")}` }, 400);

    const spec = specFromPayload(payload);
    await sendResendEmail({
      env,
      to: env.NOTIFY_EMAIL,
      subject: `FitFrame Order ${payload.order_id}`,
      text: spec,
    });
    await sendResendEmail({
      env,
      to: payload.customer_email,
      subject: "Your FitFrame spec is confirmed",
      text: `Your FitFrame spec is confirmed.\n\nOrder ID: ${payload.order_id}\nEstimated ship window: ${payload.estimated_ship_date || "about 10 days"}\n\nWe'll follow up with payment details and your full order summary.`,
    });

    return json({ ok: true, order_id: payload.order_id });
  } catch (err) {
    return json({ ok: false, error: err.message || "Order submission failed" }, 500);
  }
}
