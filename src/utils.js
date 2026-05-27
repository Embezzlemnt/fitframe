export const ACCENT = "#4caf7d";
export const IRIS_MM = 11.8;
export const CREDIT_CARD_WIDTH_MM = 85.6;
export const CARD_GUIDE_WIDTH_RATIO = 0.58;
export const HOLD_FRAMES = 18;
export const STORE_KEY = "fitframe_session_v1";

export const SCAN_SEQ = [
  { instruction:"",                   holdMs:1500, fill:0.08 },
  { instruction:"Keep eyes forward.", holdMs:3000, fill:0.35 },
  { instruction:"Almost there.",      holdMs:3000, fill:0.65 },
  { instruction:"Nearly done.",       holdMs:2500, fill:0.88 },
  { instruction:"",                   holdMs:1500, fill:1.00 },
];

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function saveSession(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...data, version: 1 }));
  } catch {
    // Ignore storage failures; the scan flow still works without persistence.
  }
}

export function loadSession() {
  try {
    const r = localStorage.getItem(STORE_KEY);
    if (!r) return null;
    const saved = JSON.parse(r);
    return saved?.version === 1 ? saved : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // Ignore storage failures; clearing session is best effort.
  }
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.crossOrigin = "anonymous";
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export function isIOSSafari() {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(navigator.platform) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Android/.test(ua);
}

export function validatePose(lm) {
  const nx = lm[1].x, ny = lm[1].y;
  if (nx < 0.10 || nx > 0.90) return { valid:false, reason:"Center your face" };
  if (ny < 0.08 || ny > 0.92) return { valid:false, reason:"Center your face" };
  return { valid:true, reason:null };
}

export function calcMeasurements(lm, W, H) {
  if (![468,469,470,471,472,473,474,475,476,477].every(i => lm[i])) return null;
  const pts = lm.map(p => ({ x:p.x*W, y:p.y*H }));
  const d   = (a,b) => Math.sqrt((pts[a].x-pts[b].x)**2+(pts[a].y-pts[b].y)**2);
  const lId = (d(468,469)+d(468,470)+d(468,471)+d(468,472))/4*2;
  const rId = (d(473,474)+d(473,475)+d(473,476)+d(473,477))/4*2;
  const avg = (lId+rId)/2;
  if (avg < 2) return null;
  const sc = IRIS_MM/avg;
  const lPd = d(468,168)*sc, rPd = d(473,168)*sc;
  return {
    pd:      (lPd+rPd).toFixed(1), pdLeft:lPd.toFixed(1), pdRight:rPd.toFixed(1),
    bridge:  (d(133,362)*sc).toFixed(1),
    lensH:   ((d(159,145)+d(386,374))/2*sc).toFixed(1),
    faceH:   (d(10,152)*sc).toFixed(1),
    faceW:   (d(234,454)*sc).toFixed(0),
    temple:  (d(234,454)*sc*0.68).toFixed(0),
  };
}

export function genOrderId() {
  return "FF-"+Math.random().toString(36).substring(2,8).toUpperCase();
}

export function getETA() {
  const d = new Date();
  d.setDate(d.getDate()+10);
  return d.toLocaleDateString("en-US", { month:"long", day:"numeric", year:"numeric" });
}

export function classifyCamError(err) {
  const n = err?.name||"";
  const local = location.hostname==="localhost"||location.hostname==="127.0.0.1";
  if (!local&&location.protocol!=="https:") return {type:"https",headline:"HTTPS required",detail:"Camera requires a secure connection.",fix:null};
  if (n==="NotFoundError"||n==="DevicesNotFoundError") return {type:"nohardware",headline:"No camera found",detail:"No camera detected on this device.",fix:null};
  if (n==="NotReadableError"||n==="TrackStartError")   return {type:"inuse",headline:"Camera in use",detail:"Another app is using the camera. Close it and try again.",fix:"retry"};
  if (n==="NotAllowedError"||n==="PermissionDeniedError") {
    const safari=/Safari/.test(navigator.userAgent)&&!/Chrome/.test(navigator.userAgent);
    return {type:"denied",headline:"Camera access blocked",fix:"reload",
      detail:safari?"Safari → Settings for this Website → Camera → Allow → reload.":"Tap the camera icon in your address bar → Allow → reload."};
  }
  return {type:"unknown",headline:"Camera unavailable",detail:`${err?.message||"Unknown error"}. Try reloading.`,fix:"reload"};
}

export function buildMakerSpec(payload) {
  return [
    `FitFrame Order ${payload.order_id}`,
    `Submitted: ${payload.timestamp}`,
    "",
    "Customer",
    `Name: ${payload.customer_name}`,
    `Email: ${payload.customer_email}`,
    "",
    "Frame",
    `Frame ID: ${payload.frame_id}`,
    `Frame: ${payload.frame}`,
    `Colorway: ${payload.colorway || "—"}`,
    `Lens: ${payload.lens}`,
    `Lens price: ${payload.lens_price}`,
    `Total: ${payload.total}`,
    "",
    "Shipping",
    `Name: ${payload.shipping_name || payload.customer_name}`,
    `Address: ${payload.shipping_address || "—"}`,
    `City: ${payload.shipping_city || "—"}`,
    `State: ${payload.shipping_state || "—"}`,
    `ZIP: ${payload.shipping_zip || "—"}`,
    "",
    "Style answers",
    `Fit: ${payload.style_fit}`,
    `Vibe: ${payload.style_vibe}`,
    `Use: ${payload.style_use}`,
    `Priority: ${payload.style_priority}`,
    "",
    "Measurements",
    `PD binocular: ${payload.pd_binocular}`,
    `PD left: ${payload.pd_left}`,
    `PD right: ${payload.pd_right}`,
    `Bridge: ${payload.bridge_mm}`,
    `Temple: ${payload.temple_mm}`,
    `Face height: ${payload.face_height_mm || "—"}`,
    `Lens height: ${payload.lens_height_mm}`,
    `Face width: ${payload.face_width_mm}`,
    `Scan quality: ${payload.scan_quality}`,
    `Valid frames: ${payload.valid_frames_pct}`,
    "",
    "Prescription",
    `OD sphere: ${payload.rx_od_sphere || "—"}`,
    `OD cyl: ${payload.rx_od_cyl || "—"}`,
    `OD axis: ${payload.rx_od_axis || "—"}`,
    `OS sphere: ${payload.rx_os_sphere || "—"}`,
    `OS cyl: ${payload.rx_os_cyl || "—"}`,
    `OS axis: ${payload.rx_os_axis || "—"}`,
    "",
    `User agent: ${payload.user_agent}`,
  ].join("\n");
}
