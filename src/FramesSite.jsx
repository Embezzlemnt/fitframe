import { useState, useRef, useEffect, useCallback } from "react";

// ─── Config — change these ────────────────────────────────────────────────────
const MAKER_EMAIL = "your@email.com"; // ← your actual email
const BASE_PRICE  = 89;

// ─── Script loader ────────────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.crossOrigin = "anonymous";
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── Measurement math ─────────────────────────────────────────────────────────
function calcMeasurements(lm, W, H) {
  const pts = lm.map(p => ({ x: p.x * W, y: p.y * H }));
  const d = (a, b) => Math.sqrt((pts[a].x-pts[b].x)**2 + (pts[a].y-pts[b].y)**2);
  const lId = (d(468,469)+d(468,470)+d(468,471)+d(468,472))/4*2;
  const rId = (d(473,474)+d(473,475)+d(473,476)+d(473,477))/4*2;
  const avgId = (lId+rId)/2;
  if (avgId < 2) return null;
  const scale = 11.7/avgId;
  return {
    pd:     (d(468,473)*scale).toFixed(1),
    bridge: (d(133,362)*scale).toFixed(1),
    temple: (d(234,454)*scale*0.68).toFixed(0),
    lensH:  ((d(159,145)+d(386,374))/2*scale).toFixed(1),
    faceW:  (d(234,454)*scale).toFixed(0),
  };
}

function genOrderId() {
  return "FF-" + Math.random().toString(36).substring(2,8).toUpperCase();
}

// ─── Data ─────────────────────────────────────────────────────────────────────
const FRAMES = [
  { id:"thin-round",  label:"Thin Round",     emoji:"○", desc:"Wire. Circular. Timeless.",      tags:["minimal","soft","retro","classic","clean"] },
  { id:"bold-square", label:"Bold Square",    emoji:"□", desc:"Thick acetate. Presence.",       tags:["bold","statement","modern","confident"] },
  { id:"cat-eye",     label:"Cat Eye",        emoji:"◇", desc:"Upswept. Distinct. Playful.",    tags:["vintage","expressive","retro","statement"] },
  { id:"navigator",   label:"Navigator",      emoji:"▽", desc:"Teardrop. Works on most faces.", tags:["classic","clean","modern","adjustable"] },
  { id:"rectangle",   label:"Slim Rectangle", emoji:"▭", desc:"Low profile. Understated.",      tags:["minimal","sleek","modern","clean","slim"] },
  { id:"round-thick", label:"Round Thick",    emoji:"◉", desc:"Wide. Retro. Confident.",        tags:["bold","retro","statement","vintage"] },
  { id:"sporty-wrap", label:"Sporty Wrap",    emoji:"⌒", desc:"Curved. Active. Polished.",      tags:["sporty","practical","adjustable","bold"] },
  { id:"geometric",   label:"Geometric",      emoji:"⬡", desc:"Angular. Unconventional.",       tags:["editorial","modern","statement","bold"] },
];

const STYLE_QUESTIONS = [
  { id:"fit", q:"How do glasses usually feel on you?", options:[
    { label:"Too tight at my temples",           tags:["slim","minimal","soft"] },
    { label:"They slide down constantly",        tags:["adjustable","sporty","practical"] },
    { label:"I've never found a pair that fits", tags:["adjustable","bold","sporty"] },
    { label:"Fine mostly, just never perfect",   tags:["classic","clean","modern"] },
  ]},
  { id:"vibe", q:"What's your visual instinct?", options:[
    { label:"Quiet. Clean lines, nothing extra",    tags:["minimal","clean","soft"] },
    { label:"Present. Something people notice",     tags:["bold","statement","confident"] },
    { label:"Timeless. Classic shapes, no trends",  tags:["retro","classic","vintage"] },
    { label:"Relaxed. Comfortable over everything", tags:["sporty","practical","soft"] },
  ]},
  { id:"use", q:"Where will you wear them most?", options:[
    { label:"At a desk, most of the day",        tags:["minimal","sleek","clean"] },
    { label:"Out and about, always on",          tags:["sporty","practical","bold"] },
    { label:"Both — they need to do everything", tags:["clean","modern","classic"] },
    { label:"Special occasions only",            tags:["bold","expressive","statement"] },
  ]},
  { id:"priority", q:"What matters most in a frame?", options:[
    { label:"It disappears on my face",       tags:["minimal","soft","clean"] },
    { label:"It says something about me",     tags:["bold","statement","editorial"] },
    { label:"It holds up to daily use",       tags:["sporty","practical","modern"] },
    { label:"It fits without any adjustment", tags:["classic","adjustable","clean"] },
  ]},
];

const LENS_OPTIONS = [
  { id:"bluelight",    label:"Blue light",   price:0,  desc:"Filters screen glare. Everyday clarity." },
  { id:"sunglass",     label:"Sunglass",     price:25, desc:"UV400 tint. Built for outside." },
  { id:"transition",   label:"Transitions",  price:45, desc:"Adapts to light. One pair, everywhere." },
  { id:"prescription", label:"Prescription", price:65, desc:"Your exact Rx. Requires prescription details." },
];

const SCAN_SEQUENCE = [
  { label:"Center",     instruction:"Eyes forward. Stay still.", holdMs:3000, fill:0.25 },
  { label:"Left",       instruction:"Turn left — slowly.",       holdMs:3500, fill:0.42 },
  { label:"Hold",       instruction:"Hold.",                     holdMs:2500, fill:0.56 },
  { label:"Center",     instruction:"Back to center.",           holdMs:2000, fill:0.65 },
  { label:"Right",      instruction:"Turn right — slowly.",      holdMs:3500, fill:0.80 },
  { label:"Hold",       instruction:"Hold.",                     holdMs:2500, fill:0.91 },
  { label:"Center",     instruction:"Face forward.",             holdMs:1500, fill:0.96 },
  { label:"Processing", instruction:"Almost done.",              holdMs:1200, fill:1.00 },
];

// ─── CSS ──────────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@300;400;500&display=swap');
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
  :root {
    --bg:#0d0d0d; --surface:#161616; --surface2:#1c1c1c;
    --border:#2a2a2a; --border2:#383838; --mid:#6f6f6f;
    --soft:#4a4a4a; --text:#e0e0e0; --dim:#888;
    --green:#4caf7d; --green-bg:#0d1f16; --white:#f5f5f5;
  }
  html,body { height:100%; }
  body { background:var(--bg); color:var(--text); font-family:'Geist',-apple-system,sans-serif; -webkit-font-smoothing:antialiased; overscroll-behavior:none; }
  .app { min-height:100dvh; display:flex; flex-direction:column; align-items:center; padding:0 16px env(safe-area-inset-bottom,24px); }
  .container { width:100%; max-width:430px; }
  .site-header { width:100%; max-width:430px; padding:20px 0 16px; display:flex; align-items:center; justify-content:space-between; }
  .logo { font-size:15px; font-weight:500; color:var(--white); letter-spacing:-0.02em; }
  .logo-dot { color:var(--green); }
  .header-right { font-size:10px; color:var(--soft); font-family:'Geist Mono',monospace; }
  .prog-track { width:100%; height:1px; background:var(--border); margin-bottom:20px; }
  .prog-fill { height:100%; background:var(--green); transition:width 0.5s cubic-bezier(.4,0,.2,1); }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:20px 18px; animation:up 0.35s cubic-bezier(.4,0,.2,1) both; }
  @keyframes up { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
  .step-eyebrow { font-size:11px; color:var(--mid); letter-spacing:0.06em; margin-bottom:6px; }
  .step-title { font-size:24px; font-weight:600; color:var(--white); letter-spacing:-0.03em; line-height:1.1; margin-bottom:4px; }
  .step-sub { font-size:13px; color:var(--dim); line-height:1.6; margin-bottom:16px; font-weight:300; }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:11px 22px; font-family:'Geist',sans-serif; font-size:13px; font-weight:500; cursor:pointer; border:none; border-radius:8px; transition:all 0.18s; letter-spacing:-0.01em; -webkit-tap-highlight-color:transparent; }
  .btn-primary { background:var(--white); color:#0d0d0d; }
  .btn-primary:hover { background:#e8e8e8; transform:translateY(-1px); }
  .btn-green { background:var(--green); color:#0d0d0d; }
  .btn-green:hover { background:#5bc98f; }
  .btn-ghost { background:transparent; color:var(--dim); border:1px solid var(--border2); }
  .btn-ghost:hover { border-color:var(--mid); color:var(--text); }
  .btn-row { display:flex; gap:8px; margin-top:20px; flex-wrap:wrap; }
  .btn-row .btn { flex:1; min-width:0; }
  .btn:disabled { opacity:0.25; cursor:not-allowed; transform:none !important; }
  .divider { border:none; border-top:1px solid var(--border); margin:20px 0; }
  /* Camera */
  .cam-wrap { width:100%; aspect-ratio:4/3; background:#000; border-radius:10px; overflow:hidden; position:relative; border:1px solid var(--border); }
  .cam-wrap video { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; transform:scaleX(-1); }
  .cam-wrap canvas { position:absolute; inset:0; width:100%; height:100%; transform:scaleX(-1); pointer-events:none; }
  .cam-vignette { position:absolute; inset:0; background:radial-gradient(ellipse at center,transparent 38%,rgba(0,0,0,0.6) 100%); pointer-events:none; z-index:2; }
  .cam-hud-top { position:absolute; top:0; left:0; right:0; z-index:3; padding:12px 14px; display:flex; justify-content:space-between; align-items:center; background:linear-gradient(rgba(0,0,0,0.5),transparent); }
  .cam-hud-bottom { position:absolute; bottom:0; left:0; right:0; z-index:3; padding:28px 16px 14px; background:linear-gradient(transparent,rgba(0,0,0,0.75)); display:flex; flex-direction:column; align-items:center; gap:3px; }
  .scan-status { font-family:'Geist Mono',monospace; font-size:10px; color:rgba(255,255,255,0.5); letter-spacing:0.06em; }
  .scan-status.active { color:var(--green); }
  .hud-instruction { font-size:15px; font-weight:500; color:var(--white); letter-spacing:-0.01em; text-align:center; }
  .hud-step-label { font-family:'Geist Mono',monospace; font-size:10px; color:var(--green); letter-spacing:0.08em; opacity:0.8; }
  /* No cam */
  .no-cam { width:100%; border-radius:10px; background:var(--surface2); border:1px dashed var(--border2); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; color:var(--dim); font-size:13px; text-align:center; padding:28px 24px; }
  .no-cam-icon { font-size:28px; opacity:0.3; }
  .err-headline { font-size:14px; font-weight:500; color:var(--white); }
  .err-detail { font-size:12px; color:var(--dim); line-height:1.6; max-width:280px; }
  .err-fix-box { width:100%; padding:10px 14px; background:var(--surface); border:1px solid var(--border2); border-radius:8px; font-size:11px; color:#e8a04a; line-height:1.7; text-align:left; }
  .scan-hint { margin-top:10px; font-size:12px; color:var(--dim); text-align:center; line-height:1.5; padding:0 4px; }
  /* Quality */
  .quality-row { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:var(--surface2); border:1px solid var(--border); border-radius:8px; margin-top:12px; }
  .quality-label { font-size:11px; color:var(--mid); }
  .quality-val { font-size:13px; font-weight:500; }
  .q-excellent,.q-good { color:var(--green); }
  .q-fair { color:#e8a04a; }
  .q-low,.q-not { color:#ff453a; }
  /* Step 2 choices */
  .q-progress { font-size:11px; color:var(--soft); letter-spacing:0.06em; margin-bottom:18px; }
  .q-label { font-size:17px; font-weight:500; color:var(--white); letter-spacing:-0.02em; line-height:1.3; margin-bottom:16px; }
  .choices { display:flex; flex-direction:column; gap:8px; }
  .choice { padding:14px 16px; border:1px solid var(--border2); border-radius:10px; cursor:pointer; background:var(--surface2); text-align:left; font-family:'Geist',sans-serif; font-size:14px; color:var(--text); font-weight:300; line-height:1.4; width:100%; transition:border-color 0.12s,background 0.12s; -webkit-tap-highlight-color:transparent; }
  .choice:active { transform:scale(0.98); }
  .choice.chosen { border-color:var(--green); background:var(--green-bg); color:var(--white); }
  /* Step 3 lens */
  .lens-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:14px 0; }
  .lens-card { padding:14px 12px; border:1px solid var(--border); border-radius:10px; cursor:pointer; background:var(--surface2); transition:all .15s; -webkit-tap-highlight-color:transparent; }
  .lens-card:hover { border-color:var(--mid); }
  .lens-card.sel { border-color:var(--green); background:var(--green-bg); }
  .lens-name { font-size:13px; font-weight:500; color:var(--white); margin-bottom:3px; }
  .lens-price { font-size:11px; color:var(--green); font-family:'Geist Mono',monospace; margin-bottom:6px; }
  .lens-desc { font-size:11px; color:var(--dim); line-height:1.5; font-weight:300; }
  .rx-form { margin-top:12px; padding:14px; background:var(--surface2); border:1px solid var(--border); border-radius:8px; }
  .rx-title { font-size:10px; color:var(--mid); letter-spacing:0.06em; margin-bottom:12px; }
  .rx-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
  .rx-field-label { font-size:10px; color:var(--soft); margin-bottom:4px; }
  .rx-input { width:100%; padding:8px 10px; background:var(--surface); border:1px solid var(--border2); border-radius:6px; color:var(--text); font-size:16px; outline:none; font-family:'Geist Mono',monospace; }
  .rx-input:focus { border-color:var(--mid); }
  /* Step 4 match */
  .loading-ring { width:36px; height:36px; border:2px solid var(--border2); border-top-color:var(--green); border-radius:50%; animation:spin 0.8s linear infinite; margin:0 auto; }
  @keyframes spin { to{transform:rotate(360deg)} }
  .match-card { display:flex; align-items:center; gap:14px; padding:14px 16px; border:1px solid var(--border); border-radius:10px; cursor:pointer; background:var(--surface2); transition:all .15s; margin-bottom:8px; -webkit-tap-highlight-color:transparent; }
  .match-card:hover { border-color:var(--mid); }
  .match-card.sel { border-color:var(--green); background:var(--green-bg); }
  .match-emoji { font-size:24px; flex-shrink:0; }
  .match-info { flex:1; }
  .match-name { font-size:13px; font-weight:500; color:var(--white); }
  .match-desc { font-size:11px; color:var(--dim); margin-top:2px; font-weight:300; }
  .match-badge { font-size:9px; padding:2px 7px; background:var(--green); color:#0d0d0d; border-radius:4px; font-weight:500; letter-spacing:0.04em; flex-shrink:0; }
  /* Step 5 checkout */
  .price-breakdown { background:var(--surface2); border:1px solid var(--border); border-radius:8px; padding:14px 16px; margin:14px 0; }
  .price-row { display:flex; justify-content:space-between; font-size:12px; color:var(--dim); padding:4px 0; font-weight:300; }
  .price-total { border-top:1px solid var(--border); margin-top:8px; padding-top:10px; font-size:15px; font-weight:500; color:var(--white); }
  .customer-field { width:100%; padding:12px 14px; background:var(--surface2); border:1px solid var(--border2); border-radius:8px; color:var(--text); font-size:16px; font-family:'Geist',sans-serif; outline:none; margin-bottom:8px; font-weight:300; }
  .customer-field:focus { border-color:var(--mid); }
  .confirm-box { background:var(--green-bg); border:1px solid var(--green); border-radius:10px; padding:20px; margin-top:14px; text-align:center; }
  .confirm-title { font-size:15px; font-weight:500; color:var(--green); margin-bottom:8px; }
  .confirm-body { font-size:12px; color:var(--dim); line-height:1.7; font-weight:300; }
  .order-footer { margin-top:16px; font-size:11px; color:var(--soft); text-align:center; font-family:'Geist Mono',monospace; }
`;

// ─── Camera error classifier ──────────────────────────────────────────────────
function classifyCamError(err) {
  const name = err?.name || "";
  const isLocal = location.hostname==="localhost" || location.hostname==="127.0.0.1";
  if (!isLocal && location.protocol!=="https:") return { type:"https", headline:"HTTPS required", detail:"Camera requires a secure connection. Open this page over https://", fix:null };
  if (name==="NotFoundError"||name==="DevicesNotFoundError") return { type:"nohardware", headline:"No camera found", detail:"No camera detected on this device.", fix:null };
  if (name==="NotReadableError"||name==="TrackStartError") return { type:"inuse", headline:"Camera in use", detail:"Another app is using the camera. Close it and try again.", fix:"retry" };
  if (name==="NotAllowedError"||name==="PermissionDeniedError") {
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    const fix = isSafari
      ? "Safari → Settings for this Website → Camera → Allow → reload the page."
      : "Tap the camera icon in your address bar → Allow → reload.";
    return { type:"denied", headline:"Camera access blocked", detail:fix, fix:"reload" };
  }
  return { type:"unknown", headline:"Camera unavailable", detail:`${err?.message||"Unknown error"}. Try reloading.`, fix:"reload" };
}

// ─── useCamera ────────────────────────────────────────────────────────────────
function useCamera() {
  const videoRef = useRef(null);
  const [ready, setReady]   = useState(false);
  const [camErr, setCamErr] = useState(null);

  const start = useCallback(async () => {
    setCamErr(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamErr({ type:"https", headline:"Camera unavailable", detail:"Browser doesn't support camera here. Ensure you're on https://", fix:null, debugInfo:`proto:${location.protocol}` });
      return;
    }
    try {
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"user", width:{ideal:640}, height:{ideal:480} }, audio:false }); }
      catch  { stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:false }); }
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        v.setAttribute("playsinline","");
        v.muted = true;
        try { await v.play(); } catch {}
        setReady(true);
      }
    } catch (err) {
      const e = classifyCamError(err);
      e.debugInfo = `${err.name}: ${err.message}`;
      setCamErr(e);
    }
  }, []);

  const stop = useCallback(() => {
    const v = videoRef.current;
    if (v?.srcObject) { v.srcObject.getTracks().forEach(t=>t.stop()); v.srcObject=null; }
    setReady(false);
  }, []);

  return { videoRef, ready, camErr, start, stop };
}

// ─── useScanRunner ────────────────────────────────────────────────────────────
const HOLD_FRAMES = 45;

function useScanRunner(scanning, videoRef, canvasRef, onAutoStart) {
  const [seqIdx,       setSeqIdx]       = useState(-1);
  const [fill,         setFill]         = useState(0);
  const [done,         setDone]         = useState(false);
  const [measurements, setMeasurements] = useState(null);
  const [mpReady,      setMpReady]      = useState(false);
  const [autoStartPct, setAutoStartPct] = useState(0);
  const [facePresent,  setFacePresent]  = useState(false);
  const [quality,      setQuality]      = useState(null);

  const fillRef        = useRef(0);
  const faceMeshRef    = useRef(null);
  const samplesRef     = useRef([]);
  const noseXRef       = useRef([]); // nose x-positions to measure head rotation
  const processingRef  = useRef(false);
  const loopRef        = useRef(null);
  const holdRef        = useRef(0);
  const autoStartedRef = useRef(false);
  const scanningRef    = useRef(false);

  useEffect(() => { scanningRef.current = scanning; }, [scanning]);

  // Load MediaPipe once on mount
  useEffect(() => {
    Promise.all([
      loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js"),
      loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"),
    ]).then(() => {
      const fm = new window.FaceMesh({ locateFile: f=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}` });
      fm.setOptions({ maxNumFaces:1, refineLandmarks:true, minDetectionConfidence:0.5, minTrackingConfidence:0.5 });
      fm.onResults(handleResults);
      faceMeshRef.current = fm;
      setMpReady(true);
    }).catch(console.error);
  }, []);

  function handleResults(results) {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas||!video) return;
    const W=video.videoWidth||640, H=video.videoHeight||480;
    canvas.width=W; canvas.height=H;
    const ctx=canvas.getContext("2d");
    ctx.clearRect(0,0,W,H);

    if (!results.multiFaceLandmarks?.length) {
      holdRef.current=0; setFacePresent(false);
      if (!autoStartedRef.current) setAutoStartPct(0);
      return;
    }

    setFacePresent(true);

    if (!autoStartedRef.current && !scanningRef.current) {
      holdRef.current++;
      const pct=Math.min(holdRef.current/HOLD_FRAMES,1);
      setAutoStartPct(pct);
      if (pct>=1) { autoStartedRef.current=true; onAutoStart?.(); }
    }

    const lm=results.multiFaceLandmarks[0];
    const pts=lm.map(p=>({x:p.x*W,y:p.y*H}));
    const d=(a,b)=>Math.sqrt((pts[a].x-pts[b].x)**2+(pts[a].y-pts[b].y)**2);
    const lId=(d(468,469)+d(468,470)+d(468,471)+d(468,472))/4*2;
    const rId=(d(473,474)+d(473,475)+d(473,476)+d(473,477))/4*2;
    const teal="#4caf7d";

    [[pts[468],lId],[pts[473],rId]].forEach(([c,diam])=>{
      ctx.beginPath(); ctx.arc(c.x,c.y,diam/2,0,Math.PI*2);
      ctx.strokeStyle=teal; ctx.lineWidth=1.5; ctx.stroke();
    });
    [pts[468],pts[473]].forEach(p=>{
      ctx.beginPath(); ctx.arc(p.x,p.y,2.5,0,Math.PI*2);
      ctx.fillStyle=teal; ctx.fill();
    });
    ctx.beginPath(); ctx.moveTo(pts[468].x,pts[468].y); ctx.lineTo(pts[473].x,pts[473].y);
    ctx.strokeStyle=teal; ctx.lineWidth=1.2; ctx.stroke();
    const scale=11.7/((lId+rId)/2);
    ctx.font="11px monospace"; ctx.fillStyle=teal; ctx.textAlign="center";
    ctx.fillText(`${(d(468,473)*scale).toFixed(1)}mm`,(pts[468].x+pts[473].x)/2,pts[468].y-10);
    [33,133,362,263].forEach(i=>{
      ctx.beginPath(); ctx.arc(pts[i].x,pts[i].y,2,0,Math.PI*2);
      ctx.fillStyle="rgba(255,255,255,0.7)"; ctx.fill();
    });

    if (scanningRef.current) {
      const m=calcMeasurements(lm,W,H);
      if(m) samplesRef.current.push(m);
      // track nose tip x (normalized) to detect left/right rotation
      noseXRef.current.push(lm[1].x);
    }
  }

  // Always-running loop — works even before scanning starts
  useEffect(() => {
    const loop=async()=>{
      const v=videoRef.current;
      if(faceMeshRef.current&&v&&v.readyState>=2&&!processingRef.current){
        processingRef.current=true;
        try{await faceMeshRef.current.send({image:v});}catch{}
        processingRef.current=false;
      }
      loopRef.current=requestAnimationFrame(loop);
    };
    loopRef.current=requestAnimationFrame(loop);
    return ()=>{ if(loopRef.current) cancelAnimationFrame(loopRef.current); };
  }, []);

  useEffect(()=>{
    if(scanning&&!done){ samplesRef.current=[]; setSeqIdx(0); }
  },[scanning]);

  useEffect(()=>{
    if(seqIdx<0||seqIdx>=SCAN_SEQUENCE.length) return;
    const step=SCAN_SEQUENCE[seqIdx];
    const start=fillRef.current, end=step.fill, t0=performance.now();
    let raf;
    const animate=now=>{
      const t=Math.min((now-t0)/step.holdMs,1);
      const v=start+(end-start)*t; fillRef.current=v; setFill(v);
      if(t<1){ raf=requestAnimationFrame(animate); }
      else if(seqIdx<SCAN_SEQUENCE.length-1){ setSeqIdx(i=>i+1); }
      else {
        setDone(true);
        const s=samplesRef.current;
        const noseX=noseXRef.current;
        if(s.length>=5){
          const sorted=[...s].sort((a,b)=>parseFloat(a.pd)-parseFloat(b.pd));
          const trim=Math.max(1,Math.floor(sorted.length*0.1));
          const good=sorted.slice(trim,sorted.length-trim);
          const avg=key=>{
            const val=good.reduce((acc,m)=>acc+parseFloat(m[key]),0)/good.length;
            return (key==="temple"||key==="faceW")?val.toFixed(0):val.toFixed(1);
          };
          setMeasurements({pd:avg("pd"),bridge:avg("bridge"),temple:avg("temple"),lensH:avg("lensH"),faceW:avg("faceW")});
          // Compliance = did they actually turn their head?
          // Nose x-range > 0.12 means meaningful left+right rotation
          const noseMin=Math.min(...noseX), noseMax=Math.max(...noseX);
          const rotationRange=noseMax-noseMin; // 0.0–1.0 (normalized image width)
          const rotated=rotationRange>0.10;
          const q=rotated&&s.length>60 ? {label:"Excellent",emoji:"✦",rescan:false}
                 :rotated&&s.length>25 ? {label:"Good",emoji:"◉",rescan:false}
                 :!rotated&&s.length>40? {label:"Fair — hold still next time",emoji:"◎",rescan:false}
                 :                       {label:"Retake for better fit",emoji:"↺",rescan:true};
          setQuality(q);
        } else { setQuality({label:"Not enough data",emoji:"✕",rescan:true}); }
      }
    };
    raf=requestAnimationFrame(animate);
    return ()=>cancelAnimationFrame(raf);
  },[seqIdx]);

  const reset=useCallback(()=>{
    setSeqIdx(-1); setFill(0); fillRef.current=0;
    setDone(false); setMeasurements(null); setQuality(null);
    setAutoStartPct(0); setFacePresent(false);
    samplesRef.current=[]; noseXRef.current=[];
    holdRef.current=0; autoStartedRef.current=false;
  },[]);

  return { seqIdx, fill, done, measurements, mpReady, autoStartPct, facePresent, quality, reset };
}

// ─── FaceGuide — green strokes the circumference as scan fills ───────────────
function FaceGuide({ fill, autoStartPct, facePresent }) {
  // viewBox matches 4:3 aspect ratio of cam-wrap
  const W=400, H=300;
  const cx=W/2, cy=H/2-10;
  const rx=72, ry=96;
  const circ=Math.PI*(3*(rx+ry)-Math.sqrt((3*rx+ry)*(rx+3*ry)));
  const strokeLen=circ*Math.min(fill,1);
  const border=facePresent?"rgba(255,255,255,0.95)":"rgba(255,255,255,0.45)";
  const bw=12; // corner bracket width
  const x1=cx-rx-10, y1=cy-ry-10, x2=cx+rx+10, y2=cy+ry+10;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:2}}>
      {/* Corner brackets */}
      {[
        [x1,y1+bw,x1,y1,x1+bw,y1],
        [x2-bw,y1,x2,y1,x2,y1+bw],
        [x1,y2-bw,x1,y2,x1+bw,y2],
        [x2-bw,y2,x2,y2,x2,y2-bw],
      ].map(([ax,ay,bx,by,cx2,cy2],i)=>(
        <path key={i} d={`M${ax},${ay} L${bx},${by} L${cx2},${cy2}`}
          stroke="rgba(255,255,255,0.8)" strokeWidth="2" fill="none" strokeLinecap="round"/>
      ))}
      {/* Auto-hold outer ring */}
      {autoStartPct>0&&autoStartPct<1&&(
        <ellipse cx={cx} cy={cy} rx={rx+8} ry={ry+8} fill="none"
          stroke="rgba(255,255,255,0.2)" strokeWidth="1.5"
          strokeDasharray={`${autoStartPct*Math.PI*(3*(rx+8+ry+8)-Math.sqrt((3*(rx+8)+ry+8)*((rx+8)+3*(ry+8))))} 9999`}
          strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}/>
      )}
      {/* Base oval */}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none"
        stroke={border} strokeWidth="2" style={{transition:"stroke 0.3s"}}/>
      {/* Green circumference progress */}
      {fill>0&&(
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none"
          stroke="#4caf7d" strokeWidth="4"
          strokeDasharray={`${strokeLen} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}/>
      )}
      {/* Eye guides */}
      <circle cx={cx-22} cy={cy-16} r="3" fill={border} opacity="0.5"/>
      <circle cx={cx+22} cy={cy-16} r="3" fill={border} opacity="0.5"/>
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function FramesSite() {
  const [step,           setStep]           = useState(0);
  const [scanning,       setScanning]       = useState(false);
  const [confirmedMeas,  setConfirmedMeas]  = useState(null);
  const [styleAnswers,   setStyleAnswers]   = useState({});
  const [styleQIdx,      setStyleQIdx]      = useState(0);
  const [tapped,         setTapped]         = useState(null);
  const [lensChoice,     setLensChoice]     = useState(null);
  const [rxForm,         setRxForm]         = useState({odSphere:"",odCyl:"",odAxis:"",osSphere:"",osCyl:"",osAxis:""});
  const [selectedFrame,  setSelectedFrame]  = useState(null);
  const [matchLoading,   setMatchLoading]   = useState(true);
  const [customerInfo,   setCustomerInfo]   = useState({name:"",email:""});
  const [sent,           setSent]           = useState(false);
  const [orderId]                           = useState(genOrderId);

  const cam       = useCamera();
  const canvasRef = useRef(null);
  const scan      = useScanRunner(scanning, cam.videoRef, canvasRef, ()=>setScanning(true));

  const currentMeas = confirmedMeas||(scan.done?scan.measurements:null);
  const suggestedTags = Object.values(styleAnswers).flatMap(a=>a.tags);

  function frameScore(f) {
    if (!suggestedTags.length) return 1;
    const m=f.tags.filter(t=>suggestedTags.includes(t)).length;
    return m>=2?2:m>=1?1:0;
  }
  const topFrames=[...FRAMES].map(f=>({...f,score:frameScore(f)})).sort((a,b)=>b.score-a.score).slice(0,3);
  const lensData=LENS_OPTIONS.find(l=>l.id===lensChoice);
  const totalPrice=BASE_PRICE+(lensData?.price||0);

  useEffect(()=>{ if(step!==1) cam.stop(); },[step]);
  useEffect(()=>{ if(scan.done) setScanning(false); },[scan.done]);
  useEffect(()=>{ if(step===4){setMatchLoading(true);setTimeout(()=>setMatchLoading(false),2200);} },[step]);
  useEffect(()=>{ setTapped(null); },[styleQIdx]);

  function selectOption(opt) {
    setTapped(opt.label);
    const qId=STYLE_QUESTIONS[styleQIdx].id;
    setStyleAnswers(prev=>({...prev,[qId]:opt}));
    if(styleQIdx<STYLE_QUESTIONS.length-1){ setTimeout(()=>setStyleQIdx(i=>i+1),220); }
    else { setTimeout(()=>setStep(3),300); }
  }

  function buildDevSpec() {
    const f=FRAMES.find(f=>f.id===selectedFrame)||topFrames[0];
    const m=currentMeas;
    const rx=lensChoice==="prescription"
      ?`\nOD  SPH ${rxForm.odSphere||"—"} CYL ${rxForm.odCyl||"—"} AXIS ${rxForm.odAxis||"—"}\nOS  SPH ${rxForm.osSphere||"—"} CYL ${rxForm.osCyl||"—"} AXIS ${rxForm.osAxis||"—"}`:"";
    return `FITFRAME ORDER ${orderId}
${new Date().toLocaleString()}

CUSTOMER
Name    ${customerInfo.name||"—"}
Email   ${customerInfo.email||"—"}

FRAME   ${f?.label}

MEASUREMENTS  (iris-calibrated · quality: ${scan.quality?.label||"—"})
PD            ${m?.pd||"—"} mm
Bridge        ${m?.bridge||"—"} mm
Temple        ${m?.temple||"—"} mm
Lens height   ${m?.lensH||"—"} mm
Face width    ${m?.faceW||"—"} mm

LENS    ${lensData?.label||"—"}${lensData?.price?` (+$${lensData.price})`:" (included)"}${rx}

TOTAL   $${totalPrice}
MATERIAL  PETG prototype → PA12 final`;
  }

  function sendOrder() {
    const body=encodeURIComponent(buildDevSpec());
    const subject=encodeURIComponent(`FitFrame Order ${orderId}`);
    window.location.href=`mailto:${MAKER_EMAIL}?subject=${subject}&body=${body}`;
    setSent(true);
  }

  const pct=(step/5)*100;

  return (
    <>
      <style>{css}</style>
      <div className="app">
        <div className="site-header">
          <div className="logo">fitframe<span className="logo-dot">.</span></div>
        </div>
        <div className="container">
          <div className="prog-track"><div className="prog-fill" style={{width:`${pct}%`}}/></div>

          {/* ── 0 Welcome ── */}
          {step===0&&(
            <div className="card">
              <div className="step-eyebrow">Custom eyewear</div>
              <div className="step-title">Made for<br/>your face.</div>
              <div className="step-sub">Five minutes. Frames built around your exact measurements and style.</div>
              <div className="btn-row"><button className="btn btn-primary" onClick={()=>setStep(1)}>Get started</button></div>
            </div>
          )}

          {/* ── 1 Scan ── */}
          {step===1&&(
            <div className="card">
              <div className="step-eyebrow">Step 1 — Face scan</div>
              <div className="step-title">{scanning?"Stay still.":scan.done?"Scan complete.":"Position your face."}</div>

              {/* video always in DOM — ref is never null */}
              <div className="cam-wrap" style={{display:(cam.ready&&!scan.done)?"block":"none"}}>
                <video ref={cam.videoRef} autoPlay playsInline muted/>
                <canvas ref={canvasRef}/>
                <div className="cam-vignette"/>
                <FaceGuide fill={scan.fill} autoStartPct={scan.autoStartPct} facePresent={scan.facePresent}/>
                <div className="cam-hud-top">
                  {!scan.mpReady&&(
                    <div className="scan-status">loading…</div>
                  )}
                </div>
                <div className="cam-hud-bottom">
                  {scanning&&scan.seqIdx>=0
                    ?<><div className="hud-step-label">{SCAN_SEQUENCE[Math.min(scan.seqIdx,SCAN_SEQUENCE.length-1)].label}</div>
                        <div className="hud-instruction">{SCAN_SEQUENCE[Math.min(scan.seqIdx,SCAN_SEQUENCE.length-1)].instruction}</div></>
                    :scan.autoStartPct>0&&scan.autoStartPct<1
                      ?<div className="hud-instruction">Hold still…</div>
                      :<div className="hud-instruction">Look directly at the camera.</div>
                  }
                </div>
              </div>

              {!cam.ready&&!cam.camErr&&!currentMeas&&(
                <div className="no-cam">
                  <div className="no-cam-icon">◉</div>
                  <div style={{fontWeight:400}}>Camera access needed.</div>
                  <button className="btn btn-primary" style={{marginTop:4}} onClick={cam.start}>Allow camera</button>
                </div>
              )}

              {cam.camErr&&(
                <div className="no-cam">
                  <div style={{fontSize:22,color:cam.camErr.type==="https"?"#e8a04a":"#ff453a"}}>
                    {cam.camErr.type==="nohardware"?"○":cam.camErr.type==="https"?"⚠":"✕"}
                  </div>
                  <div className="err-headline">{cam.camErr.headline}</div>
                  {cam.camErr.type==="denied"
                    ?<div className="err-fix-box">{cam.camErr.detail}</div>
                    :<div className="err-detail">{cam.camErr.detail}</div>
                  }
                  <div style={{fontSize:10,color:"var(--soft)",fontFamily:"monospace"}}>{cam.camErr.debugInfo}</div>
                  {cam.camErr.fix==="retry"&&<button className="btn btn-ghost" onClick={cam.start}>Try again</button>}
                  {cam.camErr.fix==="reload"&&<button className="btn btn-ghost" onClick={()=>location.reload()}>Reload page</button>}
                </div>
              )}

              {cam.ready&&!scan.done&&!scanning&&(
                <div className="scan-hint">
                  {scan.mpReady?"Scan starts automatically when your face is centred in the oval.":"Loading face detection — takes a moment on first visit."}
                </div>
              )}

              {scan.done&&!currentMeas&&(
                <div className="no-cam" style={{marginTop:12}}>
                  <div style={{color:"#ff453a"}}>No face data captured.</div>
                  <div style={{fontSize:11,color:"var(--dim)"}}>Good lighting and a clear view of your face helps. Try again.</div>
                  <button className="btn btn-ghost" style={{marginTop:4}} onClick={()=>{scan.reset();setScanning(false);}}>Try again</button>
                </div>
              )}

              {currentMeas&&(()=>{
                // Auto-advance to step 2 if quality is good — no button needed
                if (!scan.quality?.rescan) {
                  setTimeout(()=>{ setConfirmedMeas(currentMeas); setStep(2); }, 1200);
                }
                return scan.quality?.rescan ? (
                  <div className="no-cam" style={{marginTop:12}}>
                    <div style={{fontSize:22,opacity:0.5}}>↺</div>
                    <div className="err-headline">Let's try that again.</div>
                    <div className="err-detail">Face the camera straight on and follow the turn prompts for a better fit.</div>
                    <button className="btn btn-primary" style={{marginTop:4}}
                      onClick={()=>{scan.reset();setScanning(false);setConfirmedMeas(null);cam.stop();setTimeout(cam.start,300);}}>
                      Rescan
                    </button>
                  </div>
                ) : (
                  <div className="scan-hint" style={{marginTop:12,color:"var(--green)"}}>
                    Measurements confirmed. Moving on…
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── 2 Style ── */}
          {step===2&&(()=>{
            const q=STYLE_QUESTIONS[styleQIdx];
            return(
              <div className="card" key={styleQIdx}>
                <div className="step-eyebrow">Step 2 — Style</div>
                <div className="q-progress">{styleQIdx+1} of {STYLE_QUESTIONS.length}</div>
                <div className="q-label">{q.q}</div>
                <div className="choices">
                  {q.options.map((opt,i)=>(
                    <button key={`q${styleQIdx}-o${i}`}
                      className={`choice ${tapped===opt.label?"chosen":""}`}
                      onClick={()=>selectOption(opt)}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {styleQIdx>0&&(
                  <div className="btn-row" style={{marginTop:16}}>
                    <button className="btn btn-ghost" onClick={()=>{
                      const prev={...styleAnswers};
                      delete prev[STYLE_QUESTIONS[styleQIdx-1].id];
                      setStyleAnswers(prev); setStyleQIdx(i=>i-1);
                    }}>Back</button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── 3 Lens ── */}
          {step===3&&(
            <div className="card">
              <div className="step-eyebrow">Step 3 — Lenses</div>
              <div className="step-title">Choose your lens.</div>
              <div className="step-sub">All options are cut to your exact frame measurements.</div>
              <div className="lens-grid">
                {LENS_OPTIONS.map(l=>(
                  <div key={l.id} className={`lens-card ${lensChoice===l.id?"sel":""}`} onClick={()=>setLensChoice(l.id)}>
                    <div className="lens-name">{l.label}</div>
                    <div className="lens-price">{l.price===0?"Included":`+$${l.price}`}</div>
                    <div className="lens-desc">{l.desc}</div>
                  </div>
                ))}
              </div>
              {lensChoice==="prescription"&&(
                <div className="rx-form">
                  <div className="rx-title">PRESCRIPTION DETAILS</div>
                  <div className="rx-grid">
                    {[["OD Sphere","odSphere"],["OD Cyl","odCyl"],["OD Axis","odAxis"],["OS Sphere","osSphere"],["OS Cyl","osCyl"],["OS Axis","osAxis"]].map(([label,key])=>(
                      <div key={key}>
                        <div className="rx-field-label">{label}</div>
                        <input className="rx-input" placeholder={key.includes("Axis")?"0–180":"±0.00"}
                          value={rxForm[key]} onChange={e=>setRxForm(p=>({...p,[key]:e.target.value}))}/>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="btn-row">
                <button className="btn btn-primary" disabled={!lensChoice} onClick={()=>setStep(4)}>See your frames →</button>
                <button className="btn btn-ghost" onClick={()=>setStep(2)}>Back</button>
              </div>
            </div>
          )}

          {/* ── 4 Match ── */}
          {step===4&&(
            <div className="card">
              <div className="step-eyebrow">Step 4 — Your match</div>
              {matchLoading?(
                <div style={{textAlign:"center",padding:"40px 0"}}>
                  <div className="loading-ring"/>
                  <div style={{marginTop:18,fontSize:14,color:"var(--white)",fontWeight:500}}>Matching your profile…</div>
                  <div style={{marginTop:6,fontSize:12,color:"var(--dim)"}}>Analyzing your answers and measurements.</div>
                </div>
              ):(
                <>
                  <div className="step-title" style={{marginBottom:4}}>We found your frames.</div>
                  <div className="step-sub">These three match your answers and face shape. Tap one to select it.</div>
                  {topFrames.map((f,i)=>(
                    <div key={f.id} className={`match-card ${selectedFrame===f.id?"sel":""}`} onClick={()=>setSelectedFrame(f.id)}>
                      <div className="match-emoji">{f.emoji}</div>
                      <div className="match-info">
                        <div className="match-name">{f.label}</div>
                        <div className="match-desc">{f.desc}</div>
                      </div>
                      {i===0&&<div className="match-badge">best match</div>}
                    </div>
                  ))}
                  <div className="btn-row">
                    <button className="btn btn-primary" onClick={()=>{if(!selectedFrame)setSelectedFrame(topFrames[0]?.id);setStep(5);}}>
                      That's the one →
                    </button>
                    <button className="btn btn-ghost" onClick={()=>setStep(3)}>Back</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── 5 Checkout ── */}
          {step===5&&(
            <div className="card">
              <div className="step-eyebrow">Almost there</div>
              <div className="step-title">Your custom<br/>frames await.</div>
              <div className="step-sub">Built to your face. Shipped to your door.</div>
              <hr className="divider"/>
              <div className="price-breakdown">
                <div className="price-row">
                  <span>Custom frame — {(FRAMES.find(f=>f.id===selectedFrame)||topFrames[0])?.label}</span>
                  <span>${BASE_PRICE}</span>
                </div>
                {lensData&&lensData.price>0&&<div className="price-row"><span>{lensData.label} lenses</span><span>+${lensData.price}</span></div>}
                {lensData&&lensData.price===0&&<div className="price-row"><span>{lensData.label} lenses</span><span>Included</span></div>}
                <div className="price-row price-total"><span>Total</span><span>${totalPrice}</span></div>
              </div>
              {!sent?(
                <>
                  <input className="customer-field" placeholder="Full name"
                    value={customerInfo.name} onChange={e=>setCustomerInfo(p=>({...p,name:e.target.value}))}/>
                  <input className="customer-field" placeholder="Email address" type="email"
                    value={customerInfo.email} onChange={e=>setCustomerInfo(p=>({...p,email:e.target.value}))}/>
                  <div className="btn-row">
                    <button className="btn btn-green"
                      disabled={!customerInfo.name.trim()||!customerInfo.email.trim()}
                      onClick={sendOrder}>
                      Send order to FitFrame →
                    </button>
                  </div>
                  <div style={{marginTop:10,fontSize:11,color:"var(--soft)",textAlign:"center",lineHeight:1.6}}>
                    Your spec is sent directly to our maker. We'll confirm your order and send payment details within 24 hours.
                  </div>
                </>
              ):(
                <div className="confirm-box">
                  <div className="confirm-title">Order received.</div>
                  <div className="confirm-body">
                    We're on it. Check <strong style={{color:"var(--text)"}}>{customerInfo.email}</strong> — you'll hear from us within 24 hours to confirm your order and next steps.
                    <br/><br/>Estimated delivery: 7–10 days after confirmation.
                  </div>
                </div>
              )}
              <div className="order-footer">Order {orderId} · fitframe.</div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
