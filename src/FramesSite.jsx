import { useState, useRef, useEffect, useCallback } from "react";

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
  { id: "thin-round",  label: "Thin Round",     tags: ["minimal","soft","retro","classic","clean"],       emoji: "○", desc: "Wire. Circular. Timeless." },
  { id: "bold-square", label: "Bold Square",    tags: ["bold","statement","modern","confident"],          emoji: "□", desc: "Thick. Acetate. Presence." },
  { id: "cat-eye",     label: "Cat Eye",        tags: ["vintage","expressive","retro","statement"],       emoji: "◇", desc: "Upswept. Distinct. Playful." },
  { id: "navigator",   label: "Navigator",      tags: ["classic","clean","modern","adjustable"],          emoji: "▽", desc: "Teardrop. Works on most faces." },
  { id: "rectangle",   label: "Slim Rectangle", tags: ["minimal","sleek","modern","clean","slim"],        emoji: "▭", desc: "Low profile. Understated." },
  { id: "round-thick", label: "Round Thick",    tags: ["bold","retro","statement","vintage"],             emoji: "◉", desc: "Wide. Retro. Confident." },
  { id: "sporty-wrap", label: "Sporty Wrap",    tags: ["sporty","practical","adjustable","bold"],         emoji: "⌒", desc: "Curved. Active. Polished." },
  { id: "geometric",   label: "Geometric",      tags: ["editorial","modern","statement","bold","unique"], emoji: "⬡", desc: "Angular. Unconventional." },
];

const STYLE_QUESTIONS = [
  {
    id: "fit",
    q: "How do glasses usually feel on you?",
    options: [
      { label: "They slide down constantly",        tags: ["adjustable","sporty","practical"] },
      { label: "Too tight at my temples",           tags: ["slim","minimal","soft"] },
      { label: "Fine mostly, just never perfect",   tags: ["classic","clean","modern"] },
      { label: "I've never found a pair that fits", tags: ["adjustable","bold","sporty"] },
    ],
  },
  {
    id: "vibe",
    q: "What's your visual instinct?",
    options: [
      { label: "Quiet. Clean lines, nothing extra",    tags: ["minimal","clean","soft"] },
      { label: "Present. Something people notice",     tags: ["bold","statement","confident"] },
      { label: "Timeless. Classic shapes, no trends",  tags: ["retro","classic","vintage"] },
      { label: "Relaxed. Comfortable over everything", tags: ["sporty","practical","soft"] },
    ],
  },
  {
    id: "use",
    q: "Where will you wear them most?",
    options: [
      { label: "At a desk, most of the day",       tags: ["minimal","sleek","clean"] },
      { label: "Out and about, always on",          tags: ["sporty","practical","bold"] },
      { label: "Both — they need to do everything", tags: ["clean","modern","classic"] },
      { label: "Special occasions only",            tags: ["bold","expressive","statement"] },
    ],
  },
  {
    id: "priority",
    q: "What matters most in a frame?",
    options: [
      { label: "It disappears on my face",      tags: ["minimal","soft","clean"] },
      { label: "It says something about me",    tags: ["bold","statement","editorial"] },
      { label: "It holds up to daily use",      tags: ["sporty","practical","modern"] },
      { label: "It fits without any adjustment", tags: ["classic","adjustable","clean"] },
    ],
  },
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

  /* Choice cards — step 2 */
  .q-label { font-size: 17px; font-weight: 500; color: var(--white); letter-spacing: -0.02em; line-height: 1.3; margin-bottom: 16px; }
  .q-progress { font-size: 11px; color: var(--soft); letter-spacing: 0.06em; margin-bottom: 20px; }
  .choices { display: flex; flex-direction: column; gap: 8px; }
  .choice {
    padding: 14px 16px; border: 1px solid var(--border2); border-radius: 10px;
    cursor: pointer; background: var(--surface2); text-align: left;
    font-family: 'Geist', sans-serif; font-size: 14px; color: var(--text);
    font-weight: 300; line-height: 1.4; width: 100%;
    transition: all 0.15s cubic-bezier(.4,0,.2,1);
    -webkit-tap-highlight-color: transparent;
  }
  .choice:hover  { border-color: var(--mid); background: var(--surface); }
  .choice:active { transform: scale(0.98); }
  .choice.chosen { border-color: var(--green); background: var(--green-bg); color: var(--white); }

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

    // iOS Safari: navigator.mediaDevices is undefined on HTTP
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCamErr({
        type: "https",
        headline: "Camera unavailable",
        detail: "Your browser doesn't support camera access here. Make sure you're on https:// and using Safari or Chrome.",
        fix: null,
        debugInfo: `mediaDevices: ${!!navigator.mediaDevices} | proto: ${location.protocol}`,
      });
      return;
    }

    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
      } catch {
        // fallback: drop facingMode constraint (some Android/desktop configs reject it)
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        // iOS Safari needs setAttribute, not just the JSX prop
        v.setAttribute("playsinline", "");
        v.muted = true;
        // play() returns a promise on modern browsers — await it
        try { await v.play(); } catch {}
        setReady(true);
      }
    } catch (err) {
      const classified = classifyCamError(err);
      classified.debugInfo = `${err.name}: ${err.message}`;
      setCamErr(classified);
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
  const [styleAnswers, setStyleAnswers]   = useState({}); // { fit: {label, tags}, vibe: ..., use: ..., priority: ... }
  const [styleQIdx, setStyleQIdx]         = useState(0);
  const [selectedFrame, setSelectedFrame] = useState(null);
  const [copied, setCopied]           = useState(false);

  const cam      = useCamera();
  const canvasRef = useRef(null);
  const scan      = useScanRunner(scanning, cam.videoRef, canvasRef);

  // Derive tags from answers — pure JS, no API
  const suggestedTags = Object.values(styleAnswers).flatMap(a => a.tags);

  function selectOption(option) {
    const qId = STYLE_QUESTIONS[styleQIdx].id;
    const newAnswers = { ...styleAnswers, [qId]: option };
    setStyleAnswers(newAnswers);
    if (styleQIdx < STYLE_QUESTIONS.length - 1) {
      setTimeout(() => setStyleQIdx(i => i + 1), 180);
    } else {
      setTimeout(() => setStep(3), 280);
    }
  }

  useEffect(() => { if (scan.done) setScanning(false); }, [scan.done]);
  useEffect(() => { if (step !== 1) cam.stop(); }, [step]);

  function frameScore(f) {
    if (!suggestedTags.length) return 1;
    const matches = f.tags.filter(t => suggestedTags.includes(t)).length;
    if (matches >= 2) return 2;
    if (matches >= 1) return 1;
    return 0;
  }

  const currentMeas = confirmedMeas || (scan.done ? scan.measurements : null);
  const styleDone   = Object.keys(styleAnswers).length === STYLE_QUESTIONS.length;

  function buildPrompt() {
    const f = FRAMES.find(f => f.id === selectedFrame);
    const m = currentMeas;
    const sa = styleAnswers;
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
Fit history    ${sa.fit?.label      || "—"}
Visual style   ${sa.vibe?.label     || "—"}
Primary use    ${sa.use?.label      || "—"}
Priority       ${sa.priority?.label || "—"}

STYLE TAGS     ${[...new Set(suggestedTags)].join(", ") || "—"}

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

              {/* video always in DOM so videoRef.current is never null when cam.start() fires */}
              <div
                className="cam-wrap"
                style={{ display: cam.ready && !scan.done ? "block" : "none" }}
              >
                <video ref={cam.videoRef} autoPlay playsInline muted />
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
                  <div style={{ fontSize: 10, color: "var(--soft)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                    {cam.camErr.debugInfo}
                  </div>
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

          {/* ── Step 2 — Style questions ── */}
          {step === 2 && (() => {
            const q = STYLE_QUESTIONS[styleQIdx];
            return (
              <div className="card" key={styleQIdx}>
                <div className="step-eyebrow">Step 2 — Style</div>
                <div className="q-progress">{styleQIdx + 1} of {STYLE_QUESTIONS.length}</div>
                <div className="q-label">{q.q}</div>
                <div className="choices">
                  {q.options.map(opt => (
                    <button
                      key={opt.label}
                      className={`choice ${styleAnswers[q.id]?.label === opt.label ? "chosen" : ""}`}
                      onClick={() => selectOption(opt)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {styleQIdx > 0 && (
                  <div className="btn-row" style={{ marginTop: 16 }}>
                    <button className="btn btn-ghost" onClick={() => {
                      const prev = { ...styleAnswers };
                      delete prev[STYLE_QUESTIONS[styleQIdx - 1].id];
                      setStyleAnswers(prev);
                      setStyleQIdx(i => i - 1);
                    }}>Back</button>
                  </div>
                )}
              </div>
            );
          })()}

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
                  ["Frame",        FRAMES.find(f => f.id === selectedFrame)?.label],
                  ["PD / Bridge / Temple", `${currentMeas?.pd} / ${currentMeas?.bridge} / ${currentMeas?.temple} mm`],
                  ["Fit history",  styleAnswers.fit?.label],
                  ["Visual style", styleAnswers.vibe?.label],
                  ["Primary use",  styleAnswers.use?.label],
                  ["Priority",     styleAnswers.priority?.label],
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
                    setStyleAnswers({}); setStyleQIdx(0);
                    setSelectedFrame(null); setConfirmedMeas(null);
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
