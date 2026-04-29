import { useState, useRef, useEffect, useCallback } from "react";

async function askClaude(messages, system) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system,
      messages,
    }),
  });
  const data = await res.json();
  return data.content?.find(b => b.type === "text")?.text ?? "";
}

// ─── MediaPipe script loader ──────────────────────────────────────────────────
function loadScript(src) {
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

// ─── Measurement math (iris = 11.7 mm biological constant) ───────────────────
function calcMeasurements(landmarks, W, H) {
  const pts = landmarks.map(p => ({ x: p.x * W, y: p.y * H }));
  const d = (a, b) =>
    Math.sqrt((pts[a].x - pts[b].x) ** 2 + (pts[a].y - pts[b].y) ** 2);

  // Iris diameters from refined landmarks (requires refineLandmarks: true)
  const lId = (d(468,469) + d(468,470) + d(468,471) + d(468,472)) / 4 * 2;
  const rId = (d(473,474) + d(473,475) + d(473,476) + d(473,477)) / 4 * 2;
  const avgId = (lId + rId) / 2;
  if (avgId < 2) return null; // skip bad frames

  const scale = 11.7 / avgId; // mm per pixel

  return {
    pd:     (d(468, 473) * scale).toFixed(1),          // pupillary distance
    bridge: (d(133, 362) * scale).toFixed(1),           // inner eye corners
    temple: (d(234, 454) * scale * 0.68).toFixed(0),    // face → temple estimate
    lensH:  (((d(159,145) + d(386,374)) / 2) * scale).toFixed(1), // avg eye height
    faceW:  (d(234, 454) * scale).toFixed(0),           // full face width
  };
}

const FRAMES = [
  { id: "thin-round",  label: "Thin Round",     tags: ["minimal","soft","retro","classic"],        emoji: "○", desc: "Wire. Circular. Timeless." },
  { id: "bold-square", label: "Bold Square",    tags: ["bold","strong","modern","confident"],      emoji: "□", desc: "Thick. Acetate. Presence." },
  { id: "cat-eye",     label: "Cat Eye",        tags: ["vintage","expressive","feminine","retro"], emoji: "◇", desc: "Upswept. Distinct. Playful." },
  { id: "navigator",   label: "Navigator",      tags: ["teardrop","classic","aviator","clean"],    emoji: "▽", desc: "Teardrop. Works on most faces." },
  { id: "rectangle",   label: "Slim Rectangle", tags: ["minimal","sleek","modern","sharp"],        emoji: "▭", desc: "Low profile. Understated." },
  { id: "round-thick", label: "Round Thick",    tags: ["bold","retro","statement","vintage"],      emoji: "◉", desc: "Wide. Retro. Confident." },
  { id: "sporty-wrap", label: "Sporty Wrap",    tags: ["active","bold","sporty","practical"],      emoji: "⌒", desc: "Curved. Active. Polished." },
  { id: "geometric",   label: "Geometric",      tags: ["angular","modern","unique","editorial"],   emoji: "⬡", desc: "Angular. Unconventional." },
];

const QUESTIONS = [
  { id: "issues", q: "Any recurring fit issues with glasses?" },
  { id: "style",  q: "Describe your ideal pair in a few words." },
  { id: "use",    q: "When will you wear them most?" },
  { id: "face",   q: "Your face shape — or let the scan decide?" },
];

const SCAN_SEQUENCE = [
  { id: "detect",     label: "Detecting",    instruction: "Face the camera.",          holdMs: 2000, fill: 0.10 },
  { id: "center",     label: "Center",       instruction: "Eyes forward. Stay still.", holdMs: 3000, fill: 0.25 },
  { id: "left-slow",  label: "Left",         instruction: "Left — slow.",              holdMs: 3500, fill: 0.42 },
  { id: "left-hold",  label: "Hold left",    instruction: "Hold.",                     holdMs: 2500, fill: 0.55 },
  { id: "center2",    label: "Center",       instruction: "Back to center.",           holdMs: 2000, fill: 0.62 },
  { id: "right-slow", label: "Right",        instruction: "Right — slow.",             holdMs: 3500, fill: 0.78 },
  { id: "right-hold", label: "Hold right",   instruction: "Hold.",                     holdMs: 2500, fill: 0.88 },
  { id: "center3",    label: "Center",       instruction: "Face forward.",             holdMs: 1500, fill: 0.93 },
  { id: "compute",    label: "Processing",   instruction: "Almost done.",              holdMs: 2000, fill: 1.00 },
];

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@300;400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:       #0d0d0d;
    --surface:  #161616;
    --surface2: #1c1c1c;
    --border:   #2a2a2a;
    --border2:  #383838;
    --mid:      #6f6f6f;
    --soft:     #4a4a4a;
    --text:     #e0e0e0;
    --dim:      #888;
    --green:    #4caf7d;
    --green-bg: #0d1f16;
    --white:    #f5f5f5;
  }

  html, body { height: 100%; }
  body { background: var(--bg); color: var(--text); font-family: 'Geist', -apple-system, sans-serif; -webkit-font-smoothing: antialiased; overscroll-behavior: none; }

  .app {
    min-height: 100dvh;
    display: flex; flex-direction: column; align-items: center;
    padding: 0 16px env(safe-area-inset-bottom, 24px);
  }

  .container { width: 100%; max-width: 430px; }

  .site-header {
    width: 100%; max-width: 430px;
    padding: 20px 0 16px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .logo { font-family: 'Geist', sans-serif; font-size: 15px; font-weight: 500; color: var(--white); letter-spacing: -0.02em; }
  .logo-dot { color: var(--green); }
  .header-right { font-size: 11px; color: var(--soft); letter-spacing: 0.04em; }

  .prog-track { width: 100%; height: 1px; background: var(--border); margin-bottom: 20px; position: relative; }
  .prog-fill  { height: 100%; background: var(--green); transition: width 0.5s cubic-bezier(.4,0,.2,1); }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 24px 20px;
    animation: up 0.4s cubic-bezier(.4,0,.2,1) both;
  }
  @keyframes up { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }

  .step-eyebrow { font-size: 11px; color: var(--mid); letter-spacing: 0.06em; font-weight: 400; margin-bottom: 8px; }
  .step-title   { font-size: 28px; font-weight: 600; color: var(--white); letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 6px; }
  .step-sub     { font-size: 13px; color: var(--dim); line-height: 1.6; margin-bottom: 20px; font-weight: 300; }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 11px 22px; font-family: 'Geist', sans-serif;
    font-size: 13px; font-weight: 500; cursor: pointer;
    border: none; border-radius: 8px;
    transition: all 0.18s cubic-bezier(.4,0,.2,1);
    letter-spacing: -0.01em;
  }
  .btn-primary { background: var(--white); color: #0d0d0d; }
  .btn-primary:hover { background: #e8e8e8; transform: translateY(-1px); }
  .btn-green   { background: var(--green); color: #0d0d0d; }
  .btn-green:hover { background: #5bc98f; transform: translateY(-1px); }
  .btn-ghost   { background: transparent; color: var(--dim); border: 1px solid var(--border2); }
  .btn-ghost:hover { border-color: var(--mid); color: var(--text); }
  .btn-row { display: flex; gap: 8px; margin-top: 20px; flex-wrap: wrap; }
  .btn-row .btn { flex: 1; min-width: 0; }
  .btn:disabled { opacity: 0.25; cursor: not-allowed; transform: none !important; }

  .divider { border: none; border-top: 1px solid var(--border); margin: 22px 0; }

  /* Camera wrapper — video + canvas overlay stacked */
  .cam-wrap {
    width: 100%; aspect-ratio: 4/3;
    background: #000;
    border-radius: 8px; overflow: hidden;
    position: relative;
    border: 1px solid var(--border);
  }
  .cam-wrap video {
    position: absolute; inset: 0;
    width: 100%; height: 100%; object-fit: cover;
    transform: scaleX(-1);
  }
  /* Landmark canvas — mirrored to match video */
  .cam-wrap canvas {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    transform: scaleX(-1);
    pointer-events: none;
  }
  .cam-vignette {
    position: absolute; inset: 0;
    background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%);
    pointer-events: none; z-index: 2;
  }
  .cam-hud-top {
    position: absolute; top: 0; left: 0; right: 0; z-index: 3;
    padding: 14px 16px;
    display: flex; justify-content: space-between; align-items: center;
    background: linear-gradient(rgba(0,0,0,0.5), transparent);
  }
  .rec-badge { display: flex; align-items: center; gap: 5px; font-family: 'Geist Mono', monospace; font-size: 9px; color: #ff453a; letter-spacing: 0.1em; }
  .rec-dot   { width: 5px; height: 5px; border-radius: 50%; background: #ff453a; animation: blink 1s infinite; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.1} }
  .pct-badge { font-family: 'Geist Mono', monospace; font-size: 11px; color: var(--green); letter-spacing: 0.04em; }
  .cam-hud-bottom {
    position: absolute; bottom: 0; left: 0; right: 0; z-index: 3;
    padding: 32px 16px 16px;
    background: linear-gradient(transparent, rgba(0,0,0,0.75));
    display: flex; flex-direction: column; align-items: center; gap: 4px;
  }
  .hud-instruction { font-size: 15px; font-weight: 500; color: var(--white); letter-spacing: -0.01em; text-align: center; }
  .hud-step-label  { font-family: 'Geist Mono', monospace; font-size: 10px; color: var(--green); letter-spacing: 0.08em; opacity: 0.8; }

  /* MediaPipe status pill */
  .mp-status {
    display: inline-flex; align-items: center; gap: 5px;
    font-family: 'Geist Mono', monospace; font-size: 9px;
    letter-spacing: 0.08em; padding: 3px 8px;
    border-radius: 4px; background: rgba(0,0,0,0.5);
    border: 1px solid rgba(255,255,255,0.08);
  }
  .mp-dot { width: 5px; height: 5px; border-radius: 50%; }

  .no-cam {
    width: 100%; aspect-ratio: 4/3; border-radius: 8px;
    background: var(--surface2); border: 1px dashed var(--border2);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 14px; color: var(--dim); font-size: 13px; text-align: center; padding: 24px;
  }
  .no-cam-icon { font-size: 28px; opacity: 0.3; }
  .err-headline { font-size: 14px; font-weight: 500; color: var(--white); }
  .err-detail   { font-size: 12px; color: var(--dim); line-height: 1.6; max-width: 280px; }
  .err-fix-box  {
    width: 100%; padding: 10px 14px; background: var(--surface);
    border: 1px solid var(--border2); border-radius: 8px;
    font-size: 11px; color: #e8a04a; line-height: 1.7; text-align: left;
  }

  .scan-list { display: flex; flex-direction: column; gap: 3px; margin: 16px 0; }
  .sli {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 12px; border-radius: 6px;
    font-size: 12px; color: var(--soft);
    font-weight: 400; transition: all 0.25s;
  }
  .sli.active { background: var(--surface2); color: var(--white); font-weight: 500; }
  .sli.done   { color: var(--green); }
  .sli-mark { width: 16px; height: 16px; border-radius: 50%; border: 1px solid var(--border2); flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 600; transition: all 0.25s; }
  .sli.done   .sli-mark { background: var(--green); border-color: var(--green); color: #0d0d0d; }
  .sli.active .sli-mark { background: var(--white); border-color: var(--white); color: #0d0d0d; }

  .meas-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 16px 0; }
  .meas-cell { padding: 12px 14px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; }
  .meas-l { font-size: 10px; color: var(--mid); letter-spacing: 0.04em; margin-bottom: 3px; }
  .meas-v { font-family: 'Geist Mono', monospace; font-size: 20px; color: var(--green); font-weight: 400; }
  .meas-u { font-size: 10px; color: var(--soft); margin-left: 2px; }

  .chat-area { display: flex; flex-direction: column; gap: 10px; max-height: 220px; overflow-y: auto; padding: 2px 0 4px; }
  .bubble { max-width: 86%; padding: 10px 14px; font-size: 13px; line-height: 1.6; border-radius: 10px; animation: up 0.25s ease both; font-weight: 300; }
  .bubble.bot  { align-self: flex-start; background: var(--surface2); border: 1px solid var(--border); color: var(--text); border-bottom-left-radius: 3px; }
  .bubble.user { align-self: flex-end; background: var(--surface2); border: 1px solid var(--border2); color: var(--dim); border-bottom-right-radius: 3px; }
  .chat-row { display: flex; gap: 8px; margin-top: 12px; }
  .chat-in {
    flex: 1; padding: 10px 14px; font-family: 'Geist', sans-serif;
    font-size: 13px; background: var(--surface2); border: 1px solid var(--border2);
    color: var(--text); outline: none; border-radius: 8px;
    transition: border-color 0.2s; font-weight: 300;
  }
  .chat-in:focus { border-color: var(--mid); }
  .typing-dots { display: flex; gap: 4px; align-items: center; padding: 2px 0; }
  .typing-dots span { width: 5px; height: 5px; background: var(--soft); border-radius: 50%; animation: bounce 1.2s infinite; }
  .typing-dots span:nth-child(2){animation-delay:.2s} .typing-dots span:nth-child(3){animation-delay:.4s}
  @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }

  .frame-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 14px 0; }
  .frame-card {
    padding: 14px 10px; border: 1px solid var(--border); border-radius: 10px;
    cursor: pointer; background: var(--surface2); text-align: center;
    transition: all 0.2s cubic-bezier(.4,0,.2,1);
  }
  .frame-card:hover { border-color: var(--mid); transform: translateY(-2px); }
  .frame-card.sel { border-color: var(--green); background: var(--green-bg); }
  .frame-card.dim { opacity: 0.18; pointer-events: none; }
  .fe { font-size: 28px; margin-bottom: 8px; display: block; }
  .fn { font-size: 12px; font-weight: 500; color: var(--white); margin-bottom: 3px; letter-spacing: -0.01em; }
  .fd { font-size: 11px; color: var(--dim); line-height: 1.5; font-weight: 300; }
  .fbadge { display: inline-block; margin-top: 6px; font-size: 9px; padding: 2px 7px; background: var(--green); color: #0d0d0d; border-radius: 4px; font-weight: 500; letter-spacing: 0.04em; }

  .sum-stack { display: flex; flex-direction: column; gap: 6px; }
  .sum-row { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 14px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; gap: 12px; }
  .sum-l { font-size: 11px; color: var(--mid); font-weight: 400; flex-shrink: 0; }
  .sum-v { font-size: 12px; color: var(--text); font-weight: 300; text-align: right; }
  .output-wrap { margin-top: 14px; }
  .output-label { font-size: 10px; color: var(--soft); letter-spacing: 0.06em; margin-bottom: 6px; }
  .output-box { background: #0a0a0a; border: 1px solid var(--border); border-radius: 8px; padding: 16px; font-family: 'Geist Mono', monospace; font-size: 11px; color: var(--mid); white-space: pre-wrap; line-height: 1.9; }
`;

// ─── Camera error classifier ──────────────────────────────────────────────────
function classifyCamError(err) {
  const name = err?.name || "";
  const isLocalhost =
    location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const isHttps = location.protocol === "https:";

  if (!isHttps && !isLocalhost) {
    return {
      type: "https",
      headline: "HTTPS required",
      detail: "Browsers block camera access on plain HTTP. Open this site over https:// or run it on localhost.",
      fix: null,
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      type: "nohardware",
      headline: "No camera found",
      detail: "No camera detected on this device. Try a phone or a laptop with a built-in webcam.",
      fix: null,
    };
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      type: "inuse",
      headline: "Camera in use",
      detail: "Another app (Zoom, Discord, another tab) is holding the camera. Close it and try again.",
      fix: "retry",
    };
  }
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    const isChrome  = /Chrome/.test(navigator.userAgent) && !/Edg/.test(navigator.userAgent);
    const isFirefox = /Firefox/.test(navigator.userAgent);
    const isSafari  = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    let fix = "";
    if (isChrome)  fix = 'Click the camera icon in the address bar → "Always allow" → reload.';
    else if (isFirefox) fix = "Go to Preferences → Privacy & Security → Camera → remove this site's block → reload.";
    else if (isSafari)  fix = "Safari → Settings for this Website → Camera → Allow → reload.";
    else fix = "Go to your browser's site settings, set Camera to Allow, then reload.";
    return { type: "denied", headline: "Camera access blocked", detail: fix, fix: "reload" };
  }
  return {
    type: "unknown",
    headline: "Camera unavailable",
    detail: `Unexpected error: ${err?.message || "unknown"}. Try reloading the page.`,
    fix: "reload",
  };
}

// ─── Camera hook ──────────────────────────────────────────────────────────────
function useCamera() {
  const videoRef = useRef(null);
  const [ready, setReady]   = useState(false);
  const [camErr, setCamErr] = useState(null); // null | error object from classifyCamError

  const start = useCallback(async () => {
    setCamErr(null);
    try {
      // Prefer front-facing; fall back to any camera if facingMode unsupported
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
      }
    } catch (err) {
      setCamErr(classifyCamError(err));
    }
  }, []);

  const stop = useCallback(() => {
    const v = videoRef.current;
    if (v?.srcObject) {
      v.srcObject.getTracks().forEach(t => t.stop());
      v.srcObject = null;
    }
    setReady(false);
  }, []);

  return { videoRef, ready, camErr, start, stop };
}

// ─── Scan runner with real MediaPipe measurements ─────────────────────────────
function useScanRunner(active, videoRef, canvasRef) {
  const [seqIdx, setSeqIdx]       = useState(-1);
  const [fill, setFill]           = useState(0);
  const [done, setDone]           = useState(false);
  const [measurements, setMeasurements] = useState(null);
  const [mpReady, setMpReady]     = useState(false);

  const fillRef      = useRef(0);
  const faceMeshRef  = useRef(null);
  const samplesRef   = useRef([]);
  const processingRef = useRef(false);
  const loopRef      = useRef(null);

  // ── Load MediaPipe once ──
  useEffect(() => {
    Promise.all([
      loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js"),
      loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"),
    ])
      .then(() => {
        const fm = new window.FaceMesh({
          locateFile: f =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
        });
        fm.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,        // ← enables iris landmarks 468-477
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        fm.onResults(handleResults);
        faceMeshRef.current = fm;
        setMpReady(true);
      })
      .catch(err => console.error("MediaPipe load failed:", err));
  }, []);

  // ── Handle each frame result ──
  function handleResults(results) {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !video) return;

    const W = video.videoWidth  || 640;
    const H = video.videoHeight || 480;
    canvas.width  = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    if (!results.multiFaceLandmarks?.length) return;

    const lm  = results.multiFaceLandmarks[0];
    const pts = lm.map(p => ({ x: p.x * W, y: p.y * H }));
    const d   = (a, b) =>
      Math.sqrt((pts[a].x - pts[b].x) ** 2 + (pts[a].y - pts[b].y) ** 2);

    // Iris radii
    const lId = (d(468,469)+d(468,470)+d(468,471)+d(468,472)) / 4 * 2;
    const rId = (d(473,474)+d(473,475)+d(473,476)+d(473,477)) / 4 * 2;

    // ── Draw iris circles ──
    const teal = "#4caf7d";
    [[pts[468], lId], [pts[473], rId]].forEach(([c, diam]) => {
      ctx.beginPath();
      ctx.arc(c.x, c.y, diam / 2, 0, Math.PI * 2);
      ctx.strokeStyle = teal;
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    });

    // Pupil dots
    [pts[468], pts[473]].forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = teal; ctx.fill();
    });

    // PD line
    ctx.beginPath();
    ctx.moveTo(pts[468].x, pts[468].y);
    ctx.lineTo(pts[473].x, pts[473].y);
    ctx.strokeStyle = teal; ctx.lineWidth = 1.5; ctx.stroke();

    // Eye corner dots
    [33, 133, 362, 263].forEach(i => {
      ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fill();
    });

    // Bridge line
    ctx.beginPath();
    ctx.moveTo(pts[133].x, pts[133].y);
    ctx.lineTo(pts[362].x, pts[362].y);
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1; ctx.stroke();

    // PD label
    const mid = {
      x: (pts[468].x + pts[473].x) / 2,
      y: pts[468].y - 10,
    };
    const scale = 11.7 / ((lId + rId) / 2);
    const pdMm  = (d(468, 473) * scale).toFixed(1);
    ctx.font      = "11px 'Geist Mono', monospace";
    ctx.fillStyle = teal;
    ctx.textAlign = "center";
    ctx.fillText(`${pdMm}mm`, mid.x, mid.y);

    // Collect measurement sample
    const m = calcMeasurements(lm, W, H);
    if (m) samplesRef.current.push(m);
  }

  // ── Frame processing loop (runs while active) ──
  useEffect(() => {
    if (!active) {
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
      return;
    }
    samplesRef.current = [];

    const loop = async () => {
      const v = videoRef.current;
      if (
        faceMeshRef.current &&
        v &&
        v.readyState >= 2 &&
        !processingRef.current
      ) {
        processingRef.current = true;
        try { await faceMeshRef.current.send({ image: v }); } catch {}
        processingRef.current = false;
      }
      loopRef.current = requestAnimationFrame(loop);
    };

    loopRef.current = requestAnimationFrame(loop);
    return () => { if (loopRef.current) cancelAnimationFrame(loopRef.current); };
  }, [active]);

  // ── Scan sequence timing ──
  useEffect(() => {
    if (active && !done) setSeqIdx(0);
  }, [active]);

  useEffect(() => {
    if (seqIdx < 0 || seqIdx >= SCAN_SEQUENCE.length) return;
    const step  = SCAN_SEQUENCE[seqIdx];
    const start = fillRef.current;
    const end   = step.fill;
    const dur   = step.holdMs;
    const t0    = performance.now();
    let raf;

    const animate = now => {
      const t = Math.min((now - t0) / dur, 1);
      const v = start + (end - start) * t;
      fillRef.current = v;
      setFill(v);

      if (t < 1) {
        raf = requestAnimationFrame(animate);
      } else if (seqIdx < SCAN_SEQUENCE.length - 1) {
        setSeqIdx(i => i + 1);
      } else {
        // ── Sequence complete — average all collected samples ──
        setDone(true);
        const samples = samplesRef.current;

        if (samples.length >= 5) {
          // Median-trim outliers: drop top+bottom 10% of PD values
          const sorted = [...samples].sort(
            (a, b) => parseFloat(a.pd) - parseFloat(b.pd)
          );
          const trim   = Math.max(1, Math.floor(sorted.length * 0.1));
          const good   = sorted.slice(trim, sorted.length - trim);

          const avg = key => {
            const sum = good.reduce((s, m) => s + parseFloat(m[key]), 0);
            const val = sum / good.length;
            return key === "temple" || key === "faceW"
              ? val.toFixed(0)
              : val.toFixed(1);
          };

          setMeasurements({
            pd:     avg("pd"),
            bridge: avg("bridge"),
            temple: avg("temple"),
            lensH:  avg("lensH"),
            faceW:  avg("faceW"),
          });
        } else {
          // MediaPipe didn't load in time — inform user gracefully
          console.warn("Not enough MediaPipe samples, check CDN or camera.");
          setMeasurements(null);
        }
      }
    };

    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [seqIdx]);

  return { seqIdx, fill, done, measurements, mpReady };
}

// ─── Face guide SVG overlay ────────────────────────────────────────────────────
function FaceGuide({ fill }) {
  const cx = 50, cy = 47, rx = 15, ry = 21;
  const circ = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
  const dash  = circ * fill;
  const color = fill < 0.4 ? "#4a4a4a" : fill < 0.75 ? "#8fcc9a" : "#4caf7d";
  return (
    <svg
      viewBox="0 0 100 100"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 2 }}
    >
      {[["5","5","14","5","5","14"],["86","5","95","5","95","14"],["5","86","5","95","14","95"],["86","95","95","95","95","86"]].map(
        ([x1,y1,x2,y2,x3,y3], i) => (
          <g key={i} stroke="#3a3a3a" strokeWidth="0.7" fill="none" opacity="0.8">
            <line x1={x1} y1={y1} x2={x2} y2={y2} />
            <line x1={x2} y1={y2} x2={x3} y2={y3} />
          </g>
        )
      )}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      <ellipse
        cx={cx} cy={cy} rx={rx} ry={ry} fill="none"
        stroke={color} strokeWidth="1.5"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: "stroke 0.6s ease" }}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <circle cx={cx-5} cy={cy-3} r="0.8" fill={color} opacity="0.5" />
      <circle cx={cx+5} cy={cy-3} r="0.8" fill={color} opacity="0.5" />
    </svg>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function FramesSite() {
  const [step, setStep]               = useState(0);
  const [scanning, setScanning]       = useState(false);
  const [confirmedMeas, setConfirmedMeas] = useState(null);
  const [chatLog, setChatLog]         = useState([]);
  const [chatInput, setChatInput]     = useState("");
  const [qIndex, setQIndex]           = useState(0);
  const [answers, setAnswers]         = useState({});
  const [typing, setTyping]           = useState(false);
  const [suggestedTags, setSuggestedTags] = useState([]);
  const [selectedFrame, setSelectedFrame] = useState(null);
  const [copied, setCopied]           = useState(false);

  const cam      = useCamera();
  // ← NEW: pass videoRef + a canvasRef down to the scan runner
  const canvasRef = useRef(null);
  const scan      = useScanRunner(scanning, cam.videoRef, canvasRef);
  const chatEndRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatLog, typing]);
  useEffect(() => { if (scan.done) setScanning(false); }, [scan.done]);
  useEffect(() => { if (step !== 1) cam.stop(); }, [step]);
  useEffect(() => {
    if (step === 2 && chatLog.length === 0)
      setChatLog([{ role: "bot", text: QUESTIONS[0].q }]);
  }, [step]);

  async function sendChat() {
    if (!chatInput.trim() || typing) return;
    const txt    = chatInput.trim();
    setChatInput("");
    const newAns = { ...answers, [QUESTIONS[qIndex].id]: txt };
    setAnswers(newAns);
    setChatLog(l => [...l, { role: "user", text: txt }]);
    setTyping(true);
    const next = qIndex + 1;
    if (next < QUESTIONS.length) {
      await new Promise(r => setTimeout(r, 700));
      const reply = await askClaude(
        [{ role: "user", content: `Answer: "${txt}" to: "${QUESTIONS[qIndex].q}". One-sentence acknowledgement then ask: "${QUESTIONS[next].q}". Under 40 words. No filler.` }],
        "You help find ideal glasses. Ultra brief, direct, friendly. No emojis except ✦ sparingly."
      );
      setTyping(false);
      setChatLog(l => [...l, { role: "bot", text: reply }]);
      setQIndex(next);
    } else {
      const allAns = Object.entries(newAns).map(([k, v]) => `${k}: ${v}`).join("\n");
      const tagRes = await askClaude(
        [{ role: "user", content: `Answers:\n${allAns}\n\nReturn ONLY a JSON array of 2-4 tags from: minimal,bold,soft,retro,classic,modern,confident,vintage,expressive,clean,sharp,sporty,active,angular,editorial,unique` }],
        "Return only valid JSON. No markdown, no explanation."
      );
      let tags = [];
      try { tags = JSON.parse(tagRes.replace(/```json|```/g, "").trim()); } catch {}
      setSuggestedTags(tags);
      setTyping(false);
      setChatLog(l => [...l, { role: "bot", text: "Your frames are ready." }]);
    }
  }

  function frameScore(f) {
    if (!suggestedTags.length) return 1;
    return f.tags.some(t => suggestedTags.includes(t)) ? 2 : 0;
  }

  const currentMeas = confirmedMeas || (scan.done ? scan.measurements : null);
  const chatDone    = qIndex >= QUESTIONS.length;

  function buildPrompt() {
    const f = FRAMES.find(f => f.id === selectedFrame);
    const m = currentMeas;
    return `FITFRAME — CUSTOM ORDER
${new Date().toLocaleString()}

FRAME          ${f?.label}

MEASUREMENTS (iris-calibrated)
PD             ${m?.pd} mm
Bridge         ${m?.bridge} mm
Temple         ${m?.temple} mm
Lens height    ${m?.lensH} mm
Face width     ${m?.faceW} mm

PREFERENCES
Fit issues     ${answers.issues || "None"}
Style          ${answers.style  || "—"}
Use            ${answers.use    || "—"}
Face shape     ${answers.face   || "Scan-derived"}

TAGS           ${suggestedTags.join(", ") || "—"}

MATERIAL       PETG prototype → PA12 final
LENS           Blue light CR39, edge-cut`;
  }

  const pct = (step / 4) * 100;

  return (
    <>
      <style>{css}</style>
      <div className="app">
        <div className="site-header">
          <div className="logo">fitframe<span className="logo-dot">.</span></div>
          <div className="header-right">open source</div>
        </div>

        <div className="container">
          <div className="prog-track">
            <div className="prog-fill" style={{ width: `${pct}%` }} />
          </div>

          {/* ── Step 0 — Welcome ── */}
          {step === 0 && (
            <div className="card">
              <div className="step-eyebrow">Custom eyewear</div>
              <div className="step-title">Made for<br />your face.</div>
              <div className="step-sub">Four steps. A frame spec built around your face.</div>
              <div className="btn-row">
                <button className="btn btn-primary" onClick={() => setStep(1)}>Get started</button>
              </div>
            </div>
          )}

          {/* ── Step 1 — Scan ── */}
          {step === 1 && (
            <div className="card">
              <div className="step-eyebrow">Step 1 — Face scan</div>
              <div className="step-title">Scan your face.</div>

              {!cam.ready && !cam.camErr && !currentMeas && (
                <div className="no-cam">
                  <div className="no-cam-icon">◉</div>
                  <div style={{ fontWeight: 400 }}>Camera needed for measurement.</div>
                  <button className="btn btn-primary" style={{ marginTop: 4 }} onClick={cam.start}>
                    Allow camera
                  </button>
                </div>
              )}

              {cam.camErr && (
                <div className="no-cam" style={{ gap: 10 }}>
                  <div style={{ fontSize: 22, opacity: cam.camErr.type === "denied" ? 1 : 0.5, color: cam.camErr.type === "https" ? "#e8a04a" : "#ff453a" }}>
                    {cam.camErr.type === "nohardware" ? "○" : cam.camErr.type === "https" ? "⚠" : "✕"}
                  </div>
                  <div className="err-headline">{cam.camErr.headline}</div>
                  <div className="err-detail">{cam.camErr.type !== "denied" && cam.camErr.detail}</div>
                  {cam.camErr.type === "denied" && (
                    <div className="err-fix-box">{cam.camErr.detail}</div>
                  )}
                  {cam.camErr.fix === "retry" && (
                    <button className="btn btn-ghost" style={{ marginTop: 4 }} onClick={cam.start}>Try again</button>
                  )}
                  {cam.camErr.fix === "reload" && (
                    <button className="btn btn-ghost" style={{ marginTop: 4 }} onClick={() => location.reload()}>Reload page</button>
                  )}
                </div>
              )}

              {cam.ready && !scan.done && (
                <>
                  <div className="cam-wrap">
                    {/* Video feed */}
                    <video ref={cam.videoRef} autoPlay playsInline muted />
                    {/* ← NEW: canvas for landmark overlay */}
                    <canvas ref={canvasRef} />
                    <div className="cam-vignette" />
                    <FaceGuide fill={scan.fill} />

                    <div className="cam-hud-top">
                      {scanning
                        ? <div className="rec-badge"><div className="rec-dot" />REC</div>
                        : (
                          <div className="mp-status">
                            <div className="mp-dot" style={{ background: scan.mpReady ? "#4caf7d" : "#888" }} />
                            <span style={{ color: scan.mpReady ? "#4caf7d" : "#888" }}>
                              {scan.mpReady ? "MP READY" : "LOADING..."}
                            </span>
                          </div>
                        )
                      }
                      <div className="pct-badge">{Math.round(scan.fill * 100)}%</div>
                    </div>

                    {scanning && scan.seqIdx >= 0 && (
                      <div className="cam-hud-bottom">
                        <div className="hud-step-label">
                          {SCAN_SEQUENCE[Math.min(scan.seqIdx, SCAN_SEQUENCE.length - 1)].label}
                        </div>
                        <div className="hud-instruction">
                          {SCAN_SEQUENCE[Math.min(scan.seqIdx, SCAN_SEQUENCE.length - 1)].instruction}
                        </div>
                      </div>
                    )}
                    {!scanning && (
                      <div className="cam-hud-bottom">
                        <div className="hud-instruction">Position your face in the oval.</div>
                      </div>
                    )}
                  </div>

                  <div className="scan-list">
                    {SCAN_SEQUENCE.map((s, i) => (
                      <div
                        key={s.id}
                        className={`sli ${scanning && scan.seqIdx > i ? "done" : scanning && scan.seqIdx === i ? "active" : ""}`}
                      >
                        <div className="sli-mark">{scanning && scan.seqIdx > i ? "✓" : ""}</div>
                        {s.label}
                      </div>
                    ))}
                  </div>

                  <div className="btn-row">
                    {!scanning
                      ? (
                        <button
                          className="btn btn-primary"
                          disabled={!scan.mpReady}
                          onClick={() => setScanning(true)}
                        >
                          {scan.mpReady ? "Start scan" : "Loading model…"}
                        </button>
                      )
                      : <button className="btn btn-ghost" disabled>Scanning — stay still</button>
                    }
                  </div>
                </>
              )}

              {scan.done && !scan.measurements && (
                <div className="no-cam" style={{ marginTop: 16 }}>
                  <div style={{ color: "#ff453a" }}>Scan incomplete — no face detected.</div>
                  <div style={{ fontSize: 11, color: "var(--dim)" }}>
                    Make sure your face is fully visible and lighting is good, then try again.
                  </div>
                  <button className="btn btn-ghost" style={{ marginTop: 4 }}
                    onClick={() => { setScanning(false); }}>
                    Retry
                  </button>
                </div>
              )}

              {currentMeas && (
                <>
                  <div className="meas-grid">
                    {[
                      ["Pupillary distance", currentMeas.pd,     "mm"],
                      ["Bridge",             currentMeas.bridge,  "mm"],
                      ["Temple",             currentMeas.temple,  "mm"],
                      ["Lens height",        currentMeas.lensH,   "mm"],
                    ].map(([l, v, u]) => (
                      <div className="meas-cell" key={l}>
                        <div className="meas-l">{l}</div>
                        <div className="meas-v">{v}<span className="meas-u">{u}</span></div>
                      </div>
                    ))}
                  </div>
                  <div className="btn-row">
                    <button className="btn btn-primary"
                      onClick={() => { setConfirmedMeas(currentMeas); setStep(2); }}>
                      Confirm
                    </button>
                    <button className="btn btn-ghost"
                      onClick={() => { setConfirmedMeas(null); cam.stop(); setTimeout(cam.start, 200); }}>
                      Rescan
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Step 2 — Chat ── */}
          {step === 2 && (
            <div className="card">
              <div className="step-eyebrow">Step 2 — Style</div>
              <div className="step-title">Four questions.</div>
              <div className="step-sub">Your answers shape the options.</div>
              <hr className="divider" />
              <div className="chat-area">
                {chatLog.map((m, i) => (
                  <div key={i} className={`bubble ${m.role}`}>{m.text}</div>
                ))}
                {typing && (
                  <div className="bubble bot">
                    <div className="typing-dots"><span /><span /><span /></div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              {!chatDone && (
                <div className="chat-row">
                  <input
                    className="chat-in"
                    placeholder="Answer…"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendChat()}
                    disabled={typing}
                  />
                  <button className="btn btn-primary" onClick={sendChat} disabled={!chatInput.trim() || typing}>→</button>
                </div>
              )}
              {chatDone && !typing && (
                <div className="btn-row" style={{ marginTop: 16 }}>
                  <button className="btn btn-primary" onClick={() => setStep(3)}>See frames</button>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3 — Frames ── */}
          {step === 3 && (
            <div className="card">
              <div className="step-eyebrow">Step 3 — Selection</div>
              <div className="step-title">Your matches.</div>
              <div className="step-sub">Highlighted styles fit your answers.</div>
              <div className="frame-grid">
                {FRAMES.map(f => {
                  const sc = frameScore(f);
                  return (
                    <div
                      key={f.id}
                      className={`frame-card ${selectedFrame === f.id ? "sel" : ""} ${suggestedTags.length && sc === 0 ? "dim" : ""}`}
                      onClick={() => setSelectedFrame(f.id)}
                    >
                      <span className="fe">{f.emoji}</span>
                      <div className="fn">{f.label}</div>
                      <div className="fd">{f.desc}</div>
                      {sc === 2 && <div className="fbadge">matched</div>}
                    </div>
                  );
                })}
              </div>
              <div className="btn-row">
                <button className="btn btn-primary" disabled={!selectedFrame} onClick={() => setStep(4)}>Confirm</button>
                <button className="btn btn-ghost" onClick={() => setStep(2)}>Back</button>
              </div>
            </div>
          )}

          {/* ── Step 4 — Summary ── */}
          {step === 4 && (
            <div className="card">
              <div className="step-eyebrow">Done</div>
              <div className="step-title">Your spec.</div>
              <div className="step-sub">Send this to your maker.</div>
              <hr className="divider" />
              <div className="sum-stack">
                {[
                  ["Frame",             FRAMES.find(f => f.id === selectedFrame)?.label],
                  ["PD / Bridge / Temple", `${currentMeas?.pd} / ${currentMeas?.bridge} / ${currentMeas?.temple} mm`],
                  ["Style",             answers.style],
                  ["Fit notes",         answers.issues],
                  ["Use",               answers.use],
                ]
                  .filter(([, v]) => v)
                  .map(([l, v]) => (
                    <div className="sum-row" key={l}>
                      <div className="sum-l">{l}</div>
                      <div className="sum-v">{v}</div>
                    </div>
                  ))}
              </div>
              <div className="output-wrap">
                <div className="output-label">COMPLETE PROMPT</div>
                <div className="output-box">{buildPrompt()}</div>
              </div>
              <div className="btn-row">
                <button className="btn btn-green"
                  onClick={() => { navigator.clipboard.writeText(buildPrompt()); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                  {copied ? "Copied ✓" : "Copy prompt"}
                </button>
                <button className="btn btn-ghost"
                  onClick={() => {
                    setStep(0); setScanning(false); cam.stop();
                    setChatLog([]); setQIndex(0); setAnswers({});
                    setSuggestedTags([]); setSelectedFrame(null); setConfirmedMeas(null);
                  }}>
                  Start over
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
