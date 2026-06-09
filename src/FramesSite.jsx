import { useState, useRef, useEffect, useCallback } from "react";

// ─── Config ───────────────────────────────────────────────────────────────────
const MAKER_EMAIL = "hello@fitframe.store";
const DOMAIN_URL = "https://fitframe.store"; // LOCKED
const BASE_PRICE  = 119;

// ─── localStorage persistence ─────────────────────────────────────────────────
const STORE_KEY = "fitframe_session_v1";
const SCAN_HISTORY_KEY = "fitframe_scan_history";
function saveSession(data) { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* storage can be unavailable in private mode */ } }
function loadSession()     { try { const r = localStorage.getItem(STORE_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function clearSession()    { try { localStorage.removeItem(STORE_KEY); } catch { /* storage can be unavailable in private mode */ } }
function appendScanHistory(entry) {
  try {
    const prev=JSON.parse(localStorage.getItem(SCAN_HISTORY_KEY)||"[]");
    localStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify([entry,...prev].slice(0,20)));
  } catch { /* storage can be unavailable in private mode */ }
}

// ─── Script loader ────────────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src; s.crossOrigin = "anonymous";
    s.defer = true;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── Pose validation ──────────────────────────────────────────────────────────
function validatePose(lm) {
  const nx = lm[1].x, ny = lm[1].y;
  if (nx < 0.10 || nx > 0.90) return { valid:false, reason:"Center your face" };
  if (ny < 0.08 || ny > 0.92) return { valid:false, reason:"Center your face" };
  return { valid:true, reason:null };
}

// ─── Measurement math ─────────────────────────────────────────────────────────
const IRIS_MM = 11.8;          // HVID mean reference
const IRIS_SD = 0.5;           // +/-1 SD - acceptable iris diameter range: 10.8-12.8mm
const IRIS_MIN_PX = 10;        // Launch-tolerant floor for arm's-length phone scans
const IRIS_MAX_PX = 80;        // Above this, face is too close and landmarks compress
const PD_ADULT_MIN = 52.0;     // Adult binocular PD lower reference
const PD_ADULT_MAX = 80.0;     // Adult binocular PD upper reference
const BRIDGE_MIN = 10.0;       // Minimum human bridge width
const BRIDGE_MAX = 28.0;       // Maximum human bridge width
const MONOCULAR_SYMMETRY = 2.5;// Max acceptable left/right monocular PD difference
const TILT_THRESHOLD = 0.14;   // Iris center Y difference as a fraction of face height
const IRIS_MISMATCH_MAX = 0.30;// Launch-tolerant left/right iris diameter difference
const MIN_VALID_SAMPLES = 3;   // Review-screen safety net handles small usable samples
const FACE_ABORT_FRAMES = 80;  // ~2.5s of sustained face/pose loss during active scan (~32fps)
const FACE_YAW_MAX = 0.15;
const SCALE_HISTORY_FRAMES = 10;
const CREDIT_CARD_WIDTH_MM = 85.6;
const CREDIT_CARD_HEIGHT_MM = 54;
const CARD_ASPECT = CREDIT_CARD_WIDTH_MM / CREDIT_CARD_HEIGHT_MM;
const CARD_STABLE_FRAMES = 6;
const CARD_MAX_ROTATION_DEG = 14;
const CARD_MIN_CONFIDENCE = 0.58;
const CARD_FALLBACK_MS = 8000;
const OPENCV_URL = "https://docs.opencv.org/4.9.0/opencv.js";
const FITFRAME_FAQ = [
  ["Is FitFrame legit?","FitFrame is a real operation based in the US. Every order is fulfilled by the person who built it. The official domain is fitframe.store."],
  ["Why is FitFrame so cheap?","FitFrame cuts out retail, opticians, and inventory. You're paying for the frame and the fit, not the overhead. $119 is the honest price for what this is."],
  ["Who is behind FitFrame?","FitFrame is built and operated by its founder, who designs the frames, runs the scans, and fulfills every order personally. It's a small operation by choice - every pair gets real attention."],
  ["How accurate is the FitFrame scan?","FitFrame uses MediaPipe Face Mesh, iris landmark calibration, an 11.8mm HVID reference, and optional card calibration. The target accuracy is within 1-2mm for non-Rx frame fitting."],
  ["What if my FitFrame frames don't fit?","FitFrame includes one free reprint if the first pair does not fit."],
  ["Where does FitFrame ship from?","FitFrame ships from the US."],
  ["What material are FitFrame frames made of?","FitFrame frames are 3D printed in PA12 nylon."],
];
const clamp = (v,min,max) => Math.min(max,Math.max(min,v));
const irisReferenceRange = () => [IRIS_MM - IRIS_SD * 2, IRIS_MM + IRIS_SD * 2];

function median(arr) {
  const s = [...arr].filter(Number.isFinite).sort((a,b)=>a-b);
  if (!s.length) return null;
  const m = Math.floor(s.length/2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
}

let openCvPromise;
function loadOpenCv(){
  if (window.cv?.Mat) return Promise.resolve();
  if (openCvPromise) return openCvPromise;
  openCvPromise = loadScript(OPENCV_URL).then(()=>new Promise((resolve,reject)=>{
    const started=performance.now();
    const tick=()=>{
      if (window.cv?.Mat) resolve();
      else if (performance.now()-started>4000) reject(new Error("OpenCV failed to load"));
      else setTimeout(tick,50);
    };
    tick();
  }));
  return openCvPromise;
}

function distPt(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function orderQuad(points){
  const pts=[...points];
  const bySum=[...pts].sort((a,b)=>(a.x+a.y)-(b.x+b.y));
  const byDiff=[...pts].sort((a,b)=>(a.x-a.y)-(b.x-b.y));
  return [bySum[0],byDiff[3],bySum[3],byDiff[0]];
}
function quadAngleDeg(quad){
  const [tl,tr]=quad;
  return Math.abs(Math.atan2(tr.y-tl.y,tr.x-tl.x)*180/Math.PI);
}
function detectionSimilarity(a,b){
  if (!a||!b) return 0;
  const ac=a.center, bc=b.center;
  const centerDelta=Math.hypot(ac.x-bc.x,ac.y-bc.y);
  const sizeDelta=Math.abs(a.width-b.width)+Math.abs(a.height-b.height);
  const angleDelta=Math.abs(a.angle-b.angle);
  return centerDelta+sizeDelta*.5+angleDelta*3;
}

function drawDetectedCard(ctx,detection,stablePct){
  const quad=detection.quad;
  ctx.save();
  ctx.lineWidth=3;
  ctx.strokeStyle=detection.confidence>=CARD_MIN_CONFIDENCE?"#4caf7d":"#e5a64a";
  ctx.shadowColor="rgba(76,175,125,.65)";
  ctx.shadowBlur=12;
  ctx.beginPath();
  ctx.moveTo(quad[0].x,quad[0].y);
  quad.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.closePath();
  ctx.stroke();
  ctx.shadowBlur=0;
  ctx.fillStyle="rgba(76,175,125,.95)";
  quad.forEach(p=>{ ctx.beginPath(); ctx.arc(p.x,p.y,4,0,Math.PI*2); ctx.fill(); });
  ctx.font="13px 'Geist Mono', monospace";
  ctx.fillStyle="rgba(255,255,255,.9)";
  ctx.textAlign="center";
  ctx.fillText(stablePct>=1?"SCALE LOCKED":`CARD ${Math.round(stablePct*100)}%`, detection.center.x, detection.center.y);
  ctx.restore();
}

function detectCardOutline(video,W,H,workCanvas){
  const cv=window.cv;
  if (!cv?.Mat) return null;
  workCanvas.width=W; workCanvas.height=H;
  const wctx=workCanvas.getContext("2d",{willReadFrequently:true});
  wctx.drawImage(video,0,0,W,H);

  const roiX=Math.round(W*.08), roiY=Math.round(H*.30), roiW=Math.round(W*.84), roiH=Math.round(H*.68);
  let src,roi,gray,blurred,edges,dilated,contours,hierarchy,kernel;
  try {
    src=cv.imread(workCanvas);
    roi=src.roi(new cv.Rect(roiX,roiY,roiW,roiH));
    gray=new cv.Mat(); blurred=new cv.Mat(); edges=new cv.Mat(); dilated=new cv.Mat();
    contours=new cv.MatVector(); hierarchy=new cv.Mat();
    kernel=cv.Mat.ones(3,3,cv.CV_8U);
    cv.cvtColor(roi,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blurred,new cv.Size(5,5),0);
    cv.Canny(blurred,edges,45,140);
    cv.dilate(edges,dilated,kernel);
    cv.findContours(dilated,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);

    let best=null;
    for (let i=0;i<contours.size();i++){
      const contour=contours.get(i);
      const area=cv.contourArea(contour);
      if (area<roiW*roiH*.035) { contour.delete(); continue; }
      const peri=cv.arcLength(contour,true);
      const approx=new cv.Mat();
      cv.approxPolyDP(contour,approx,peri*.025,true);
      if (approx.rows===4&&cv.isContourConvex(approx)){
        const raw=[];
        for (let j=0;j<4;j++){
          raw.push({x:approx.intPtr(j,0)[0]+roiX,y:approx.intPtr(j,0)[1]+roiY});
        }
        const quad=orderQuad(raw);
        const top=distPt(quad[0],quad[1]), bottom=distPt(quad[3],quad[2]);
        const left=distPt(quad[0],quad[3]), right=distPt(quad[1],quad[2]);
        const width=(top+bottom)/2, height=(left+right)/2;
        const aspect=width/height;
        const angle=quadAngleDeg(quad);
        const rect=cv.boundingRect(approx);
        const rectangularity=area/(rect.width*rect.height);
        const aspectScore=clamp(1-Math.abs(aspect-CARD_ASPECT)/.42,0,1);
        const angleScore=clamp(1-angle/CARD_MAX_ROTATION_DEG,0,1);
        const fillScore=clamp((rectangularity-.45)/.35,0,1);
        const confidence=aspectScore*.45+angleScore*.3+fillScore*.25;
        const candidate={
          quad,width,height,angle,aspect,confidence,area,rectangularity,
          center:{x:quad.reduce((s,p)=>s+p.x,0)/4,y:quad.reduce((s,p)=>s+p.y,0)/4},
          mmPerPx:CREDIT_CARD_WIDTH_MM/width,
        };
        if (!best||candidate.confidence>best.confidence) best=candidate;
      }
      approx.delete(); contour.delete();
    }
    return best&&best.confidence>=.45?best:null;
  } finally {
    [kernel,hierarchy,contours,dilated,edges,blurred,gray,roi,src].forEach(m=>m?.delete?.());
  }
}

function irisDiameter(center, edges, d) {
  const radii = edges.map(edge => d(center, edge)).filter(r => r >= 1);
  const med = median(radii);
  if (!med) return null;
  const clean = radii.filter(r => Math.abs(r - med) / med < 0.20);
  if (!clean.length) return null;
  return clean.reduce((a,b)=>a+b,0) / clean.length * 2;
}

function calcIrisMetrics(pts, d) {
  const lId = irisDiameter(468, [469,470,471,472], d);
  const rId = irisDiameter(473, [474,475,476,477], d);
  if (!lId || !rId || lId < 2 || rId < 2) return {valid:false,lId:lId||0,rId:rId||0,reason:"iris-lost"};
  const avgDiam = (lId + rId) / 2;
  if (avgDiam < IRIS_MIN_PX) return {valid:false,lId,rId,avgDiam,reason:"too-far"};
  if (avgDiam > IRIS_MAX_PX) return {valid:false,lId,rId,avgDiam,reason:"too-close"};
  const irisDelta = Math.abs(lId - rId) / avgDiam;
  if (irisDelta > IRIS_MISMATCH_MAX) return {valid:false,lId,rId,avgDiam,irisDelta,reason:"iris-mismatch"};
  const faceH = distPt(pts[10], pts[152]);
  const tiltRatio = faceH ? Math.abs(pts[468].y - pts[473].y) / faceH : 0;
  return {
    valid:true,
    lId,
    rId,
    avgDiam,
    irisDelta,
    tiltRatio,
    isTilted:tiltRatio > TILT_THRESHOLD,
  };
}

function calcYawRatio(pts, d) {
  const eyeDist = d(468,473);
  if (!eyeDist) return 0;
  const eyeMidX = (pts[468].x + pts[473].x) / 2;
  return Math.abs(pts[1].x - eyeMidX) / eyeDist;
}

function calcMeasurements(lm, W, H, calibratedScale=null, scaleHistoryRef=null) {
  const pts = lm.map(p => ({ x:p.x*W, y:p.y*H }));
  const d   = (a,b) => Math.sqrt((pts[a].x-pts[b].x)**2+(pts[a].y-pts[b].y)**2);
  const iris = calcIrisMetrics(pts,d);
  if (!iris.valid) return null;
  const irisScale = IRIS_MM / iris.avgDiam;
  if (scaleHistoryRef) {
    scaleHistoryRef.current.push(irisScale);
    if (scaleHistoryRef.current.length > SCALE_HISTORY_FRAMES) scaleHistoryRef.current.shift();
  }
  const stableIrisScale = median(scaleHistoryRef?.current || [irisScale]) || irisScale;
  const sc = calibratedScale || stableIrisScale;
  if (!sc) return null;
  const yawRatio = calcYawRatio(pts,d);
  if (yawRatio >= FACE_YAW_MAX) return null;
  const yawCorrection = Math.max(0.94, 1 - yawRatio * 0.12);
  const pd = d(468,473)*sc*yawCorrection;
  const lPd = d(468,6)*sc;
  const rPd = d(473,6)*sc;
  const innerCanthi = d(133,362)*sc;
  const eyeOpening = ((d(159,145)+d(386,374))/2*sc);
  const faceW = d(234,454)*sc;
  const [irisMin, irisMax] = irisReferenceRange();
  return {
    pd:      pd.toFixed(1), pdLeft:lPd.toFixed(1), pdRight:rPd.toFixed(1),
    bridge:  (innerCanthi*.62).toFixed(1),
    lensH:   clamp(eyeOpening*2.7+10,34,48).toFixed(1),
    faceW:   faceW.toFixed(0),
    temple:  clamp(faceW*.52+68,130,155).toFixed(0),
    sampleWeight: iris.isTilted ? 0.5 : 1,
    tiltRatio: iris.tiltRatio,
    yawRatio,
    irisDelta: iris.irisDelta,
    irisRange: `${irisMin.toFixed(1)}-${irisMax.toFixed(1)}`,
  };
}

function genOrderId() { return "FF-"+Math.random().toString(36).substring(2,8).toUpperCase(); }
function isValidEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
// ─── Data ─────────────────────────────────────────────────────────────────────
const FITFRAME_FRAME = { id:"fitframe-core", label:"fitframe core", desc:"one shape, built to your measurements." };

const STYLE_QUESTIONS = [
  { id:"fit",      q:"How do glasses usually feel on you?", options:[
    { label:"Too tight at my temples",           tags:["slim","minimal","soft"] },
    { label:"They slide down constantly",        tags:["adjustable","sporty","practical"] },
    { label:"I've never found a pair that fits", tags:["adjustable","bold","sporty"] },
    { label:"Fine mostly, just never perfect",   tags:["classic","clean","modern"] },
  ]},
  { id:"vibe",     q:"What's your visual instinct?", options:[
    { label:"Quiet. Clean lines, nothing extra",    tags:["minimal","clean","soft"] },
    { label:"Present. Something people notice",     tags:["bold","statement","confident"] },
    { label:"Timeless. Classic shapes, no trends",  tags:["retro","classic","vintage"] },
    { label:"Relaxed. Comfortable over everything", tags:["sporty","practical","soft"] },
  ]},
  { id:"use",      q:"Where will you wear them most?", options:[
    { label:"At a desk, most of the day",        tags:["minimal","sleek","clean"] },
    { label:"Out and about, always on",          tags:["sporty","practical","bold"] },
    { label:"Both - they need to do everything", tags:["clean","modern","classic"] },
    { label:"Special occasions only",            tags:["bold","expressive","statement"] },
  ]},
  { id:"priority", q:"What matters most in a frame?", options:[
    { label:"It disappears on my face",       tags:["minimal","soft","clean"] },
    { label:"It says something about me",     tags:["bold","statement","editorial"] },
    { label:"It holds up to daily use",       tags:["sporty","practical","modern"] },
    { label:"It fits without any adjustment", tags:["classic","adjustable","clean"] },
  ]},
];

const DEFAULT_LENS = { id:"bluelight", label:"blue light", price:0 };
const LENS_OPTIONS = [
  { id:"bluelight", label:"blue light", desc:"screen-comfort polycarbonate lenses.", price:0, status:"included", selectable:true },
  { id:"transition", label:"transition lenses", desc:"adaptive tint for bright days.", price:40, status:"coming soon", selectable:false },
  { id:"prescription", label:"prescription", desc:"rx lens support after launch.", price:60, status:"coming soon", selectable:false },
];

const SCAN_SEQ = [
  { holdMs:1500, fill:0.08 },
  { holdMs:3000, fill:0.35 },
  { holdMs:3000, fill:0.65 },
  { holdMs:2500, fill:0.88 },
  { holdMs:1500, fill:1.00 },
];
const PRE_SCAN_SETTLE_MS = 1000;
const SCAN_DURATION_SECONDS_PLACEHOLDER = 12;

// ─── CSS ──────────────────────────────────────────────────────────────────────
const css = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  :root{
    --bg:#0a0c0b;--bg2:#11110f;--surface:#161615;--surface2:#1d1d1b;--panel:#141413;
    --border:#2b2b28;--border2:#3a3a35;--text:#f2f0e8;--mid:#b0ada2;--dim:#858176;--soft:#555249;
    --accent:#4caf7d;--accent2:#73d7a0;--accent-bg:#0d2117;--red:#ff5a52;--amber:#e5a64a;--scan:#030303;
  }
  html,body{height:100%;}
  html{background:var(--bg);}
  body{color:var(--text);font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overscroll-behavior:none;}
  button,input{-webkit-tap-highlight-color:transparent;}
  a{color:inherit;text-decoration:none;}
  .app{min-height:100dvh;display:flex;flex-direction:column;align-items:center;padding-bottom:calc(env(safe-area-inset-bottom,0px) + 28px);opacity:0;}
  .app.app-ready{animation:pageFade .4s ease-out forwards;}
  @keyframes pageFade{from{opacity:0}to{opacity:1}}
  .site-header{width:100%;max-width:462px;padding:22px 18px 0;display:flex;align-items:center;justify-content:space-between;gap:12px;}
  .header-nav{display:flex;align-items:center;gap:16px;font-size:12px;font-weight:400;}
  .header-nav a{color:var(--dim);transition:color .15s;}
  .header-nav a:hover{color:var(--text);}
  .app.intro-active .site-header .header-nav{opacity:0;}
  .logo{font:inherit;font-size:15px;font-weight:500;color:var(--text);letter-spacing:-.02em;line-height:1;cursor:pointer;background:transparent;border:0;padding:0;}
  .logo:hover{color:#fff;}
  .logo-dot{color:var(--accent);}
  .container{width:100%;max-width:462px;padding:0 18px;}
  .section{margin-top:20px;padding:22px 18px;background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,.01));border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.25);animation:fu .34s cubic-bezier(.4,0,.2,1) both;}
  @keyframes fu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  .eyebrow{font-size:10px;font-family:'Geist Mono',monospace;color:var(--dim);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;}
  .display{font-size:34px;font-weight:600;color:var(--text);letter-spacing:-.04em;line-height:1.02;margin-bottom:12px;max-width:330px;}
  .display em{font-style:normal;position:relative;color:#8af0bb;white-space:nowrap;padding:0 0.14em;border-radius:5px;background:linear-gradient(90deg,rgba(76,175,125,0.30) 0%,rgba(76,175,125,0.10) 55%,rgba(76,175,125,0) 100%);-webkit-box-decoration-break:clone;box-decoration-break:clone;}
  .display em::after{content:"";position:absolute;left:0.14em;right:0.14em;bottom:0.02em;height:2px;border-radius:2px;pointer-events:none;background:linear-gradient(90deg,rgba(76,175,125,0.95) 0%,rgba(76,175,125,0.18) 100%);transform:scaleX(0);transform-origin:left center;animation:underlineIn .9s cubic-bezier(.22,1,.36,1) .5s forwards;}
  @keyframes underlineIn{to{transform:scaleX(1);}}
  @media (prefers-reduced-motion:reduce){.display em::after{transform:scaleX(1);animation:none;}.scan-stat{animation:none;}}
  .step-head{font-size:26px;font-weight:600;color:var(--text);letter-spacing:-.035em;line-height:1.08;margin-bottom:6px;}
  .body-lg{font-size:14px;color:var(--dim);line-height:1.62;font-weight:300;margin-bottom:24px;max-width:360px;}
  .hero-headline{margin-bottom:14px;}
  .hero-sub{margin-bottom:16px;}
  .scan-stat{display:inline-block;margin-bottom:18px;padding:7px 15px;border-radius:999px;background:transparent;border:1px solid rgba(255,255,255,0.12);font-size:12.5px;line-height:1.35;color:var(--dim);font-weight:300;letter-spacing:.01em;animation:statRise .6s cubic-bezier(.22,1,.36,1) .5s both;}
  @keyframes statRise{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
  .scan-stat-num{font-family:'Geist Mono',monospace;font-weight:500;font-variant-numeric:tabular-nums;color:var(--text);}
  .hero-cta{width:100%;}
  .trust-row{display:flex;flex-wrap:wrap;gap:12px 16px;margin:20px 0 2px;}
  .trust-item{display:flex;flex:1 1 42%;align-items:center;gap:7px;font-size:12px;color:var(--mid);font-weight:300;}
  .trust-icon{color:var(--accent);flex:0 0 auto;}
  .price-block{margin-top:26px;padding-top:24px;border-top:1px solid var(--border);}
  .price-big{font-size:46px;font-weight:600;letter-spacing:-.045em;line-height:1;color:var(--text);}
  .price-sub{margin-top:7px;font-size:13px;color:var(--dim);font-weight:300;}
  .why-block{margin-top:30px;padding-top:24px;border-top:1px solid var(--border);}
  .why-lead{font-size:22px;font-weight:500;letter-spacing:-.03em;color:var(--text);line-height:1.2;margin-bottom:14px;}
  .why-body{font-size:14px;font-weight:300;color:var(--dim);line-height:1.7;}
  .why-emph{color:var(--text);font-weight:500;}
  .feature-list{list-style:none;margin:30px 0 0;padding:0;}
  .feature-list li{display:flex;gap:14px;align-items:baseline;padding:13px 0;border-bottom:1px solid var(--border);}
  .feature-list li:first-child{padding-top:0;}
  .feature-list li:last-child{border-bottom:none;padding-bottom:0;}
  .feature-num{font-family:'Geist Mono',monospace;font-size:12px;color:var(--accent);flex:0 0 auto;}
  .feature-text{font-size:14px;color:var(--dim);font-weight:300;line-height:1.55;}
  .feature-lead{color:var(--text);font-weight:400;}
  .build-block{margin-top:30px;padding-top:24px;border-top:1px solid var(--border);}
  .build-eyebrow{color:var(--accent);margin-bottom:10px;}
  .build-body{font-size:14px;color:var(--dim);font-weight:300;line-height:1.7;}
  .vs-dot{opacity:.5;}
  .footer-links{width:100%;max-width:462px;margin:14px auto 0;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;font-size:11px;color:var(--soft);font-weight:300;}
  .footer-links a{color:var(--soft);transition:color .15s;}
  .footer-links a:hover{color:var(--text);}
  .footer-links span{color:var(--soft);opacity:.55;}
  .step-sub{font-size:13px;color:var(--dim);line-height:1.6;font-weight:300;margin-bottom:18px;letter-spacing:-.01em;}
  .privacy-inline{display:flex;align-items:flex-start;justify-content:center;gap:6px;max-width:300px;margin-top:2px;color:var(--soft);font-size:11px;font-weight:300;line-height:1.45;}
  .privacy-inline svg{flex:0 0 auto;margin-top:1px;opacity:.7;}
  .logo-large{display:inline-block;font-size:34px;letter-spacing:-.04em;margin-bottom:18px;}
  .about-list{border-top:1px solid var(--border);margin-top:20px;}
  .about-row{padding:15px 0;border-bottom:1px solid var(--border);}
  .about-row h2{font-size:13px;font-weight:500;color:var(--text);margin-bottom:5px;letter-spacing:-.01em;}
  .about-row p{font-size:12px;color:var(--dim);line-height:1.55;font-weight:300;}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:12px 18px;font-family:'Geist',sans-serif;font-size:13px;font-weight:500;cursor:pointer;border:none;border-radius:9px;transition:background .16s,border-color .16s,color .16s,transform .16s;white-space:nowrap;touch-action:manipulation;}
  .btn-primary{background:var(--text);color:#0d0d0d;}
  .btn-primary:hover{background:#ffffff;transform:translateY(-1px);}
  .btn-accent{background:var(--accent);color:#07110b;}
  .btn-accent:hover{background:var(--accent2);transform:translateY(-1px);}
  .btn-ghost{background:transparent;color:var(--dim);border:1px solid var(--border2);}
  .btn-ghost:hover{border-color:var(--dim);color:var(--text);}
  .btn:disabled{opacity:.28;cursor:not-allowed;transform:none!important;}
  .btn-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;}
  .btn-row .btn{flex:1;min-width:128px;}
  .cam-outer{width:100%;border-radius:12px;overflow:hidden;background:var(--scan);position:relative;margin-bottom:18px;border:1px solid var(--border2);}
  .cam-inner{width:100%;aspect-ratio:4/3;position:relative;}
  .cam-inner video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);z-index:0;}
  .cam-inner canvas{position:absolute;inset:0;width:100%;height:100%;transform:scaleX(-1);pointer-events:none;z-index:1;}
  .cam-vignette{position:absolute;inset:0;pointer-events:none;z-index:2;background:radial-gradient(ellipse at center,transparent 54%,rgba(0,0,0,.34) 100%);}
  .face-guide{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;filter:drop-shadow(0 0 7px rgba(76,175,125,.55));}
  @keyframes ovalPulse{0%,100%{opacity:0.28;}50%{opacity:0.5;}}
  .oval-waiting{animation:ovalPulse 2.2s ease-in-out infinite;}
  .cam-bottom{position:absolute;bottom:0;left:0;right:0;z-index:5;padding:28px 16px 15px;background:linear-gradient(transparent,rgba(0,0,0,.68));display:flex;flex-direction:column;align-items:center;gap:4px;}
  @keyframes cardPulse{0%,100%{opacity:.74;filter:drop-shadow(0 0 4px rgba(76,175,125,.35));}50%{opacity:1;filter:drop-shadow(0 0 14px rgba(76,175,125,.72));}}
  @keyframes lockIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
  .scan-inst{font-size:15px;font-weight:500;color:rgba(255,255,255,.92);letter-spacing:-.01em;text-align:center;}
  .scan-inst-lost{font-size:12px;font-weight:300;color:rgba(255,255,255,.72);line-height:1.35;max-width:280px;}
  .face-intro{position:absolute;inset:0;z-index:6;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:rgba(0,0,0,.16);pointer-events:none;animation:introFade 2s ease both;}
  .face-intro-main{font-size:24px;font-weight:600;color:rgba(255,255,255,.95);letter-spacing:-.025em;line-height:1.08;}
  .face-intro-sub{margin-top:7px;font-size:13px;color:rgba(255,255,255,.62);font-weight:300;}
  @keyframes introFade{0%{opacity:0}12%{opacity:1}72%{opacity:1}100%{opacity:0}}
  .settle-intro{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;text-align:center;background:rgba(0,0,0,.1);pointer-events:none;animation:settleFade 1s ease both;}
  .settle-intro-main{font-size:24px;font-weight:600;color:rgba(255,255,255,.95);letter-spacing:-.025em;}
  @keyframes settleFade{0%{opacity:0}18%{opacity:1}82%{opacity:1}100%{opacity:0}}
  .scale-lock{font-size:12px;color:var(--accent);font-family:'Geist Mono',monospace;text-transform:uppercase;letter-spacing:.06em;animation:lockIn .28s ease both;}
  .scan-note{font-size:12px;color:var(--dim);line-height:1.55;text-align:center;margin:-4px auto 16px;max-width:310px;font-weight:300;}
  .calibration-strip{display:flex;align-items:center;justify-content:center;gap:8px;margin:0 auto 14px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface2);font-size:10px;color:var(--dim);}
  .calibration-strip strong{color:var(--accent);font-weight:500;}
  .cam-placeholder{width:100%;min-height:260px;border-radius:12px;background:var(--surface2);border:1px dashed var(--border2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:28px 24px;margin-bottom:18px;text-align:center;}
  .pre-scan-card{align-items:flex-start;text-align:left;border-style:solid;gap:13px;background:#111312;border-color:rgba(255,255,255,0.07);border-radius:18px;}
  .pre-scan-line{font-size:13px;color:var(--text);font-weight:400;line-height:1.45;}
  .pre-scan-support{font-size:12px;color:var(--dim);font-weight:300;line-height:1.5;}
  .setup-diagram{width:100%;aspect-ratio:1.85/1;border:1px solid var(--border);border-radius:14px;background:radial-gradient(85% 90% at 50% 32%, #15201b, #0c0e0d);overflow:hidden;color:var(--soft);}
  .setup-diagram svg{display:block;width:100%;height:100%;}
  .setup-diagram circle{stroke:rgba(255,255,255,0.55);}
  .setup-diagram rect{fill:rgba(76,175,125,0.06);}
  .setup-list{display:grid;gap:6px;width:100%;font-size:12px;color:var(--dim);line-height:1.45;}
  .pre-scan-card .privacy-inline{align-self:center;text-align:center;margin-top:4px;}
  .cam-icon{width:42px;height:42px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;color:var(--dim);}
  .cam-label{font-size:14px;color:var(--text);font-weight:500;}
  .cam-sub{font-size:12px;color:var(--dim);line-height:1.6;max-width:250px;font-weight:300;}
  .err-box{padding:11px 14px;background:#23190d;border:1px solid #4d3820;border-radius:8px;font-size:12px;color:var(--amber);line-height:1.65;max-width:286px;}
  .quality-card{margin-top:2px;padding:14px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;}
  .quality-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;}
  .quality-title{font-size:13px;font-weight:500;color:var(--text);}
  .quality-pill{font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:.05em;text-transform:uppercase;padding:5px 8px;border-radius:999px;background:var(--accent-bg);color:var(--accent);}
  .quality-pill.bad{background:#24110f;color:var(--red);}
  .quality-copy{font-size:12px;color:var(--dim);font-weight:300;line-height:1.5;margin-bottom:12px;}
  .measure-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;}
  .measure-field label{display:block;font-size:10px;color:var(--soft);font-family:'Geist Mono',monospace;letter-spacing:.04em;text-transform:uppercase;margin-bottom:5px;}
  .measure-input{width:100%;min-height:44px;padding:10px 9px;background:var(--panel);border:1px solid var(--border2);border-radius:8px;color:var(--text);font-size:16px;outline:none;font-family:'Geist Mono',monospace;font-weight:300;-webkit-appearance:none;}
  .measure-input:focus{border-color:var(--accent);}
  .measure-help{font-size:11px;color:var(--soft);font-weight:300;line-height:1.45;margin-bottom:12px;}
  .q-meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;}
  .q-counter{font-family:'Geist Mono',monospace;font-size:11px;color:var(--soft);letter-spacing:.06em;}
  .q-label{font-size:19px;font-weight:500;color:var(--text);letter-spacing:-.025em;line-height:1.28;margin-bottom:16px;}
  .choices{display:flex;flex-direction:column;gap:8px;}
  .choice{min-height:48px;padding:14px 16px;border:1px solid var(--border2);border-radius:10px;cursor:pointer;background:var(--surface2);text-align:left;font-family:'Geist',sans-serif;font-size:14px;color:var(--text);font-weight:300;line-height:1.4;width:100%;transition:border-color .12s,background .12s,color .12s,transform .12s;}
  .choice:active{transform:scale(.985);}
  .choice.chosen{border-color:var(--accent);background:var(--accent-bg);color:var(--text);}
  .lens-list{display:grid;grid-template-columns:1fr;gap:8px;margin-bottom:10px;}
  .lens-row{display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:14px;padding:15px 16px;border:1px solid var(--border);border-radius:10px;cursor:pointer;background:var(--surface2);text-align:left;transition:border-color .12s,background .12s,transform .12s;}
  .lens-row:active{transform:scale(.985);}
  .lens-row.sel{border-color:var(--accent);background:var(--accent-bg);}
  .lens-row.disabled{opacity:0.45;pointer-events:none;}
  .lens-info{flex:1;}
  .lens-name{font-size:13px;font-weight:500;color:var(--text);margin-bottom:4px;}
  .lens-desc{font-size:11px;color:var(--dim);font-weight:300;line-height:1.45;}
  .lens-meta{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex:0 0 auto;}
  .lens-price-tag{font-family:'Geist Mono',monospace;font-size:15px;color:var(--text);letter-spacing:.02em;}
  .lens-row.sel .lens-price-tag{color:var(--accent);}
  .lens-tag{font-family:'Geist Mono',monospace;font-size:10px;color:var(--soft);letter-spacing:.06em;text-transform:uppercase;}
  .lens-tag.lens-tag-included{color:var(--accent);}
  .pair-summary{margin-bottom:18px;}
  .hp-field{position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;}
  .waitlist-err{font-size:12px;color:var(--red);margin:0 0 8px;font-weight:300;}
  .spec-readout{margin-top:18px;display:grid;gap:10px;font-family:'Geist Mono',monospace;}
  .spec-readout-row{display:flex;align-items:baseline;justify-content:space-between;font-size:13px;}
  .spec-readout-label{color:var(--dim);letter-spacing:.01em;}
  .spec-readout-value{color:var(--text);}
  .spec-readout-unit{color:var(--dim);font-size:11px;margin-left:4px;}
  .rx-block{padding:15px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;margin-bottom:18px;}
  .rx-lbl{font-size:10px;font-family:'Geist Mono',monospace;color:var(--soft);letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px;}
  .rx-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
  .rx-item label{display:block;font-size:10px;color:var(--soft);margin-bottom:5px;}
  .rx-input{width:100%;padding:10px 9px;background:var(--panel);border:1px solid var(--border2);border-radius:7px;color:var(--text);font-size:16px;outline:none;font-family:'Geist Mono',monospace;font-weight:300;-webkit-appearance:none;}
  .rx-input:focus{border-color:var(--accent);}
  .vto-note{display:flex;align-items:flex-start;gap:9px;padding:12px 13px;border:1px solid var(--border);border-radius:10px;margin-bottom:16px;background:var(--surface2);}
  .vto-note-icon{color:var(--accent);flex-shrink:0;padding-top:1px;}
  .vto-note-text{font-size:11px;color:var(--dim);font-weight:300;line-height:1.5;}
  .vto-note-text strong{color:var(--text);font-weight:400;}
  .receipt{background:var(--surface2);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:18px;}
  .receipt-head{padding:13px 16px;border-bottom:1px solid var(--border);font-size:10px;font-family:'Geist Mono',monospace;color:var(--soft);letter-spacing:.08em;text-transform:uppercase;}
  .receipt-row{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--border);font-size:12px;color:var(--dim);font-weight:300;}
  .receipt-total{display:flex;justify-content:space-between;align-items:center;padding:15px 16px;border-top:1px solid var(--border);font-size:15px;font-weight:500;color:var(--text);}
  .field{width:100%;min-height:46px;padding:12px 14px;background:var(--surface2);border:1px solid var(--border2);border-radius:9px;color:var(--text);font-size:16px;font-family:'Geist',sans-serif;outline:none;margin-bottom:8px;font-weight:300;transition:border-color .15s;-webkit-appearance:none;}
  .field::placeholder{color:var(--soft);}
  .field:focus{border-color:var(--dim);}
  .trust-line{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:13px;font-size:11px;color:var(--soft);font-weight:300;}
  .confirm-id{font-family:'Geist Mono',monospace;font-size:11px;color:var(--soft);letter-spacing:.06em;margin-bottom:18px;}
  .confirm-greeting{font-size:30px;font-weight:600;color:var(--text);letter-spacing:-.04em;line-height:1.06;margin-bottom:12px;}
  .confirm-body{font-size:13px;color:var(--dim);line-height:1.65;font-weight:300;margin-bottom:26px;}
  .confirm-body strong{color:var(--text);font-weight:400;}
  .next-steps{border-top:1px solid var(--border);}
  .next-step{display:flex;gap:14px;align-items:flex-start;padding:14px 0;border-bottom:1px solid var(--border);}
  .next-step-num{font-family:'Geist Mono',monospace;font-size:10px;color:var(--soft);padding-top:2px;min-width:18px;}
  .next-step-label{font-size:13px;font-weight:500;color:var(--text);margin-bottom:3px;}
  .next-step-desc{font-size:12px;color:var(--dim);font-weight:300;line-height:1.5;}
  .processing-card{width:100%;padding:18px 16px;border:1px solid var(--border);border-radius:14px;background:var(--surface2);display:flex;flex-direction:column;align-items:center;gap:12px;margin-bottom:18px;}
  .processing-logo{font-size:16px;font-weight:500;color:var(--text);letter-spacing:-.02em;}
  .processing-copy{font-size:13px;color:var(--dim);font-weight:300;}
  .processing-track{width:100%;height:4px;border-radius:999px;background:var(--border);overflow:hidden;}
  .processing-fill{height:100%;width:100%;background:var(--accent);border-radius:999px;transform-origin:left center;animation:processFill 2s ease-in-out both;}
  @keyframes processFill{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  .verification-strip{width:100%;max-width:420px;margin:22px auto 0;border-top:1px solid var(--border);padding-top:12px;display:flex;flex-wrap:wrap;justify-content:center;gap:8px 14px;color:var(--soft);font-family:'Geist Mono',monospace;font-size:11px;line-height:1.45;text-transform:uppercase;letter-spacing:.06em;}
  .faq-section{margin-top:30px;padding-top:24px;border-top:1px solid var(--border);}
  .faq-list{display:flex;flex-direction:column;}
  .faq-item{border-bottom:1px solid var(--border);}
  .faq-q{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 0;font-size:14px;color:var(--text);font-weight:400;text-transform:lowercase;}
  .faq-q::-webkit-details-marker{display:none;}
  .faq-chevron{color:var(--dim);flex:0 0 auto;transition:transform .2s ease;}
  .faq-item[open] .faq-chevron{transform:rotate(180deg);}
  .faq-a{padding:0 0 16px 16px;border-left:2px solid rgba(76,175,125,0.3);font-size:13px;color:var(--dim);font-weight:300;line-height:1.6;}
  .debug-overlay{position:absolute;top:9px;left:9px;z-index:7;padding:8px 9px;border-radius:7px;background:rgba(0,0,0,.68);color:rgba(255,255,255,.78);font-family:'Geist Mono',monospace;font-size:9px;line-height:1.45;text-align:left;pointer-events:none;}
  @media (max-width:390px){
    .site-header{padding-left:14px;padding-right:14px;}
    .container{padding-left:14px;padding-right:14px;}
    .section{padding:20px 16px;border-radius:14px;}
    .display{font-size:31px;}
    .step-head{font-size:24px;}
    .lens-list{gap:7px;}
    .lens-row{padding:14px 13px;}
    .rx-grid{grid-template-columns:1fr 1fr;}
    .btn-row .btn{min-width:112px;}
  }
`;

// ─── Camera error ─────────────────────────────────────────────────────────────
function classifyCamError(err) {
  const n = err?.name||"";
  const local = location.hostname==="localhost"||location.hostname==="127.0.0.1";
  if (!local&&location.protocol!=="https:") return {type:"https",headline:"HTTPS required",detail:"Camera requires a secure connection.",fix:null};
  if (n==="NotFoundError"||n==="DevicesNotFoundError") return {type:"nohardware",headline:"No camera found",detail:"No camera detected on this device.",fix:null};
  if (n==="NotReadableError"||n==="TrackStartError")   return {type:"inuse",headline:"Camera in use",detail:"Another app is using the camera. Close it and try again.",fix:"retry"};
  if (n==="NotAllowedError"||n==="PermissionDeniedError") {
    const safari=/Safari/.test(navigator.userAgent)&&!/Chrome/.test(navigator.userAgent);
    return {type:"denied",headline:"Camera access blocked",fix:"reload",
      detail:safari?"Safari > Settings for this Website > Camera > Allow > reload.":"Tap the camera icon in your address bar > Allow > reload."};
  }
  return {type:"unknown",headline:"Camera unavailable",detail:`${err?.message||"Unknown error"}. Try reloading.`,fix:"reload"};
}

// ─── useCamera ────────────────────────────────────────────────────────────────
function useCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady]   = useState(false);
  const [requesting,setRequesting] = useState(false);
  const [camErr,setCamErr]  = useState(null);

  const attachStream = useCallback(async (stream=streamRef.current) => {
    const v=videoRef.current;
    if (!v||!stream) return false;
    if (v.srcObject!==stream) v.srcObject=stream;
    v.setAttribute("playsinline","");
    v.setAttribute("autoplay","");
    v.muted=true;
    v.play().catch(()=>{});
    return true;
  }, []);

  const start = useCallback(async () => {
    setCamErr(null);
    setRequesting(true);
    if (!navigator.mediaDevices?.getUserMedia) {
      setRequesting(false);
      setCamErr({type:"https",headline:"Camera unavailable",detail:"Ensure you're on https://",fix:null});
      return;
    }
    try {
      let stream;
      try   { stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:640},height:{ideal:480},aspectRatio:{ideal:1.333}},audio:false}); }
      catch { stream = await navigator.mediaDevices.getUserMedia({video:true,audio:false}); }
      streamRef.current=stream;
      setReady(true);
      await attachStream(stream);
    } catch(e) {
      streamRef.current?.getTracks().forEach(t=>t.stop());
      streamRef.current=null;
      setReady(false);
      setCamErr(classifyCamError(e));
    } finally {
      setRequesting(false);
    }
  }, [attachStream]);

  useEffect(()=>{
    if (ready) attachStream();
  },[attachStream,ready]);

  const stop = useCallback(() => {
    const v=videoRef.current;
    const stream=streamRef.current||v?.srcObject;
    if (stream) stream.getTracks().forEach(t=>t.stop());
    streamRef.current=null;
    if (v) v.srcObject=null;
    setReady(false);
    setRequesting(false);
  }, []);

  return { videoRef, ready, requesting, camErr, start, stop };
}

// ─── useFaceScan ──────────────────────────────────────────────────────────────
const HOLD_FRAMES = 18;
function useFaceScan({ videoRef, scanning, canvasRef, scaleMmPerPx=null, scaleSource="iris-fallback", needsCard=false, faceEnabled=true, debugScan=false, onCardLocked, onCardSkipped, onAutoStart, onScanAbort }) {
  const fmRef          = useRef(null);
  const workCanvasRef  = useRef(null);
  const [mpReady,      setMpReady]      = useState(false);
  const [cvReady,      setCvReady]      = useState(false);
  const samplesRef     = useRef([]);
  const scaleHistoryRef= useRef([]);
  const noseXRef       = useRef([]);
  const validRef       = useRef(0);
  const totalRef       = useRef(0);
  const facePresentFramesRef = useRef(0);
  const poseValidFramesRef = useRef(0);
  const faceLostRef    = useRef(0);
  const poseLostRef    = useRef(0);
  const discardRef     = useRef({});
  const cardStableRef  = useRef(0);
  const lastCardRef    = useRef(null);
  const cardLockedRef  = useRef(false);
  const cardLoadFailedRef = useRef(false);
  const cardStartedRef = useRef(null);
  const loopRef        = useRef(null);
  const procRef        = useRef(false);
  const scanningRef    = useRef(false);
  const doneRef        = useRef(false);
  const scaleRef       = useRef(scaleMmPerPx);
  const scaleSourceRef = useRef(scaleSource);
  const holdRef        = useRef(0);
  const autoStarted    = useRef(false);
  const fillRef        = useRef(0);
  const abortingRef    = useRef(false);

  const [seqIdx,       setSeqIdx]       = useState(-1);
  const [fill,         setFill]         = useState(0);
  const [done,         setDone]         = useState(false);
  const [measurements, setMeasurements] = useState(null);
  const [autoStartPct, setAutoStartPct] = useState(0);
  const [facePresent,  setFacePresent]  = useState(false);
  const [poseHint,     setPoseHint]     = useState(null);
  const [quality,      setQuality]      = useState(null);
  const [validPct,     setValidPct]     = useState(0);
  const [cardStatus,   setCardStatus]   = useState({label:"scale — iris reference",stablePct:0,reason:""});
  const [debugInfo,    setDebugInfo]    = useState(null);

  useEffect(()=>{ scanningRef.current=scanning; },[scanning]);
  useEffect(()=>{ doneRef.current=done; },[done]);
  useEffect(()=>{ scaleRef.current=scaleMmPerPx; scaleSourceRef.current=scaleSource; },[scaleMmPerPx,scaleSource]);
  useEffect(()=>{ if (!needsCard) cardStartedRef.current=null; },[needsCard]);

  const clearScanCanvas=useCallback(()=>{
    const canvas=canvasRef.current;
    const video=videoRef.current;
    if (!canvas) return;
    const W=video?.videoWidth||canvas.width||640;
    const H=video?.videoHeight||canvas.height||480;
    canvas.width=W; canvas.height=H;
    canvas.getContext("2d")?.clearRect(0,0,W,H);
  },[canvasRef,videoRef]);

  const markDiscard=useCallback((reason)=>{
    const key=reason||"unknown";
    discardRef.current[key]=(discardRef.current[key]||0)+1;
  },[]);

  const logScanDebug=useCallback((label,extra={})=>{
    const payload={
      validFrames:validRef.current,
      totalFrames:totalRef.current,
      faceFrames:facePresentFramesRef.current,
      poseFrames:poseValidFramesRef.current,
      samples:samplesRef.current.length,
      discarded:{...discardRef.current},
      scaleSource:scaleSourceRef.current,
      ...extra,
    };
    if (debugScan) console.debug(`[FitFrame scan] ${label}`, payload);
    if (label==="complete") console.info("[FitFrame scan] complete", payload);
  },[debugScan]);

  const resetSampleState=useCallback(()=>{
    samplesRef.current=[]; noseXRef.current=[]; scaleHistoryRef.current=[];
    validRef.current=0; totalRef.current=0;
    facePresentFramesRef.current=0; poseValidFramesRef.current=0;
    faceLostRef.current=0; poseLostRef.current=0;
    discardRef.current={};
  },[]);

  const abortActiveScan=useCallback((reason="scan lost. position your face and tap start again.")=>{
    if (abortingRef.current) return;
    abortingRef.current=true;
    clearScanCanvas();
    setSeqIdx(-1); setFill(0); fillRef.current=0;
    setDone(false); setMeasurements(null); setQuality(null);
    setValidPct(0); setAutoStartPct(0); setPoseHint(null); setFacePresent(false);
    setDebugInfo(null);
    setCardStatus({label:"scale — iris reference",stablePct:0,reason:""});
    resetSampleState();
    cardStableRef.current=0; lastCardRef.current=null; cardLockedRef.current=false; cardStartedRef.current=null;
    holdRef.current=0; autoStarted.current=false;
    onScanAbort?.(reason);
    requestAnimationFrame(()=>{ abortingRef.current=false; });
  },[clearScanCanvas,onScanAbort,resetSampleState]);

  useEffect(()=>{
    if (done) clearScanCanvas();
  },[clearScanCanvas,done]);

  const processCardFrame=useCallback((drawOverlay=true)=>{
    const video=videoRef.current, canvas=canvasRef.current;
    if (!video||(!canvas&&drawOverlay)||cardLockedRef.current) return;
    const W=video.videoWidth||640, H=video.videoHeight||480;
    let ctx=null;
    if (drawOverlay){
      canvas.width=W; canvas.height=H;
      ctx=canvas.getContext("2d");
      ctx.clearRect(0,0,W,H);
      setFacePresent(false);
      setPoseHint(null);
      setAutoStartPct(0);
    }

    if (!cardStartedRef.current) cardStartedRef.current=performance.now();
    const timedOut=performance.now()-cardStartedRef.current>CARD_FALLBACK_MS;
    if (cardLoadFailedRef.current||timedOut){
      cardLockedRef.current=true;
      scaleSourceRef.current="iris-fallback";
      setCardStatus({label:"scale — iris reference",stablePct:0,reason:""});
      onCardSkipped?.();
      return;
    }
    if (!cvReady){
      setCardStatus({label:"scale — iris reference",stablePct:0,reason:""});
      return;
    }

    const workCanvas=workCanvasRef.current||(workCanvasRef.current=document.createElement("canvas"));
    const detection=detectCardOutline(video,W,H,workCanvas);
    if (detection){
      const similar=detectionSimilarity(detection,lastCardRef.current)<26;
      const highConfidence=detection.confidence>=CARD_MIN_CONFIDENCE;
      const flatEnough=detection.angle<=CARD_MAX_ROTATION_DEG;
      cardStableRef.current=similar&&highConfidence&&flatEnough?Math.min(CARD_STABLE_FRAMES,cardStableRef.current+1):1;
      lastCardRef.current=detection;
      const stablePct=cardStableRef.current/CARD_STABLE_FRAMES;
      if (ctx) drawDetectedCard(ctx,detection,stablePct);
      const reason=!highConfidence?"both long sides visible, card facing the camera.":!flatEnough?"hold the card flatter.":"";
      setCardStatus({label:stablePct>=1?"scale — card reference":"scale — iris reference",stablePct,reason,confidence:detection.confidence});
      if (stablePct>=1&&!cardLockedRef.current){
        cardLockedRef.current=true;
        scaleRef.current=detection.mmPerPx;
        scaleSourceRef.current="credit-card";
        setCardStatus({label:"scale — card reference",stablePct:1,reason:"",confidence:detection.confidence});
        onCardLocked?.({
          mmPerPx:detection.mmPerPx,
          cardWidthMm:CREDIT_CARD_WIDTH_MM,
          cardHeightMm:CREDIT_CARD_HEIGHT_MM,
          cardWidthPx:Math.round(detection.width),
          cardHeightPx:Math.round(detection.height),
          confidence:Number(detection.confidence.toFixed(2)),
          corners:detection.quad.map(p=>({x:Math.round(p.x),y:Math.round(p.y)})),
          timestamp:new Date().toISOString(),
        });
      }
    } else {
      cardStableRef.current=0;
      lastCardRef.current=null;
      setCardStatus({label:"scale — iris reference",stablePct:0,reason:""});
    }
  },[canvasRef,cvReady,onCardLocked,onCardSkipped,videoRef]);

  useEffect(()=>{
    loadOpenCv().then(()=>setCvReady(true)).catch(()=>{
      cardLoadFailedRef.current=true;
      setCardStatus({label:"scale — iris reference",stablePct:0,reason:""});
    });
  },[]);

  const handleResults=useCallback((results)=>{
    const video=videoRef.current, canvas=canvasRef.current;
    if (!canvas||!video) return;
    const W=video.videoWidth||640, H=video.videoHeight||480;
    canvas.width=W; canvas.height=H;
    const ctx=canvas.getContext("2d");
    ctx.clearRect(0,0,W,H);
    if (doneRef.current||abortingRef.current) { clearScanCanvas(); return; }

    if (!results.multiFaceLandmarks?.length){
      holdRef.current=0; setFacePresent(false); setPoseHint(null);
      if (!autoStarted.current) setAutoStartPct(0);
      if (scanningRef.current){
        totalRef.current++;
        faceLostRef.current++;
        poseLostRef.current++;
        markDiscard("no-face");
        if (totalRef.current%15===0) logScanDebug("sampling");
        if (faceLostRef.current>=FACE_ABORT_FRAMES) abortActiveScan();
      }
      return;
    }

    setFacePresent(true);
    const lm=results.multiFaceLandmarks[0];
    const pts=lm.map(p=>({x:p.x*W,y:p.y*H}));
    const d=(a,b)=>Math.sqrt((pts[a].x-pts[b].x)**2+(pts[a].y-pts[b].y)**2);
    const pose=validatePose(lm);
    const iris=calcIrisMetrics(pts,d);
    const yawRatio=calcYawRatio(pts,d);
    const yawValid=yawRatio<FACE_YAW_MAX;
    const debugScale=(scaleRef.current || (iris.valid ? IRIS_MM / iris.avgDiam : null));
    setDebugInfo({
      lIrisPx:iris.lId?Number(iris.lId.toFixed(1)):null,
      rIrisPx:iris.rId?Number(iris.rId.toFixed(1)):null,
      scaleFactor:debugScale?Number(debugScale.toFixed(4)):null,
      rawPd:debugScale?Number((d(468,473)*debugScale).toFixed(1)):null,
      yawRatio:Number(yawRatio.toFixed(3)),
      validFrames:validRef.current,
      totalFrames:totalRef.current,
      discarded:{...discardRef.current},
      scaleSource:scaleSourceRef.current,
    });
    const tiltHint=iris.valid&&iris.isTilted&&!autoStarted.current&&!scanningRef.current?"Level your head":null;
    setPoseHint(pose.valid?(yawValid?tiltHint:"Face the camera"):pose.reason);

    if (onAutoStart&&!autoStarted.current&&!scanningRef.current){
      pose.valid&&yawValid?holdRef.current++:(holdRef.current=Math.max(0,holdRef.current-2));
      const pct=Math.min(holdRef.current/HOLD_FRAMES,1);
      setAutoStartPct(pct);
      if (pct>=1){ autoStarted.current=true; onAutoStart?.(); }
    }

    if (scanningRef.current){
      totalRef.current++;
      facePresentFramesRef.current++;
      faceLostRef.current=0;
      if (needsCard&&!cardLockedRef.current) processCardFrame(false);
      if (!pose.valid||!yawValid){
        poseLostRef.current++;
        markDiscard(pose.valid?"yaw":"pose");
        if (poseLostRef.current>=FACE_ABORT_FRAMES) abortActiveScan();
        return;
      }
      poseValidFramesRef.current++;
      poseLostRef.current=0;
    }

    const lId=iris.lId||0;
    const rId=iris.rId||0;
    if (scanningRef.current&&iris.valid){
      const ink="#4caf7d"; // LOCKED — must match --accent
      [[pts[468],lId],[pts[473],rId]].forEach(([c,diam])=>{
        ctx.beginPath(); ctx.arc(c.x,c.y,diam/2,0,Math.PI*2);
        ctx.strokeStyle=ink; ctx.lineWidth=1.5; ctx.stroke();
      });
      ctx.beginPath(); ctx.moveTo(pts[468].x,pts[468].y); ctx.lineTo(pts[473].x,pts[473].y);
      ctx.strokeStyle=ink; ctx.lineWidth=.75; ctx.setLineDash([3,4]); ctx.stroke(); ctx.setLineDash([]);
    }

    if (scanningRef.current){
      if (!iris.valid){
        markDiscard(iris.reason);
      } else {
        const m=calcMeasurements(lm,W,H,scaleRef.current,scaleHistoryRef);
        if (m){
          samplesRef.current.push({...m,scaleSource:scaleSourceRef.current});
          noseXRef.current.push(lm[1].x);
          validRef.current++;
        } else {
          markDiscard("measurement-null");
        }
      }
      if (totalRef.current%15===0) {
        logScanDebug("sampling",{
          lIrisPx:iris.lId?Number(iris.lId.toFixed(1)):null,
          rIrisPx:iris.rId?Number(iris.rId.toFixed(1)):null,
          irisDelta:iris.irisDelta?Number(iris.irisDelta.toFixed(3)):null,
          tiltRatio:iris.tiltRatio?Number(iris.tiltRatio.toFixed(3)):null,
        });
      }
    }
  },[abortActiveScan,canvasRef,clearScanCanvas,logScanDebug,markDiscard,needsCard,onAutoStart,processCardFrame,videoRef]);

  useEffect(()=>{
    Promise.all([
      loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"),
      loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js"),
      loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js"),
    ]).then(()=>{
      function init(retry){
        if (!window.FaceMesh){ if(retry) setTimeout(()=>init(false),800); return; }
        const fm=new window.FaceMesh({locateFile:f=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`});
        fm.setOptions({maxNumFaces:1,refineLandmarks:true,minDetectionConfidence:.5,minTrackingConfidence:.5});
        fm.onResults(handleResults);
        fm.initialize().then(()=>{ fmRef.current=fm; setMpReady(true); });
      }
      init(true);
    }).catch(e=>console.error("MediaPipe:",e));
  },[handleResults]);

  useEffect(()=>{
    const loop=async()=>{
      const v=videoRef.current;
      if (doneRef.current||abortingRef.current){
        clearScanCanvas();
      } else if (faceEnabled&&fmRef.current&&v&&v.readyState>=2&&!procRef.current){
        procRef.current=true;
        try { await fmRef.current.send({image:v}); } catch { /* frame processing can skip while MediaPipe warms up */ }
        procRef.current=false;
      }
      loopRef.current=requestAnimationFrame(loop);
    };
    loopRef.current=requestAnimationFrame(loop);
    return ()=>{ if(loopRef.current) cancelAnimationFrame(loopRef.current); };
  },[clearScanCanvas,faceEnabled,videoRef]);

  useEffect(()=>{
    if (scanning&&!done){
      abortingRef.current=false;
      resetSampleState();
      cardStartedRef.current=null; cardStableRef.current=0; lastCardRef.current=null; cardLockedRef.current=false;
      setCardStatus({label:"scale — iris reference",stablePct:0,reason:""});
      setSeqIdx(0);
    }
  },[done,resetSampleState,scanning]);

  useEffect(()=>{
    if (seqIdx<0||seqIdx>=SCAN_SEQ.length) return;
    const step=SCAN_SEQ[seqIdx], start=fillRef.current, end=step.fill, t0=performance.now();
    let raf;
    const animate=now=>{
      const t=Math.min((now-t0)/step.holdMs,1);
      const v=start+(end-start)*t;
      fillRef.current=v; setFill(v);
      if (t<1){ raf=requestAnimationFrame(animate); }
      else if (seqIdx<SCAN_SEQ.length-1){ setSeqIdx(i=>i+1); }
      else {
        setDone(true);
        clearScanCanvas();
        const s=samplesRef.current;
        const vp=totalRef.current>0?validRef.current/totalRef.current:0;
        const facePct=totalRef.current>0?facePresentFramesRef.current/totalRef.current:0;
        const posePct=totalRef.current>0?poseValidFramesRef.current/totalRef.current:0;
        setValidPct(Math.round(vp*100));
        if (s.length<MIN_VALID_SAMPLES){
          setQuality({label:"scan lost",rescan:true,reason:"scan lost. position your face and tap start again."});
          setMeasurements(null);
          logScanDebug("complete",{
            sampleCount:s.length,
            quality:"scan lost",
            facePct:Number(facePct.toFixed(2)),
            posePct:Number(posePct.toFixed(2)),
          });
        } else {
          const cardSamples=s.filter(m=>m.scaleSource==="credit-card");
          const sourceSamples=cardSamples.length>=MIN_VALID_SAMPLES?cardSamples:s;
          const finalScaleSource=cardSamples.length>=MIN_VALID_SAMPLES?"credit-card":sourceSamples[0]?.scaleSource||scaleSourceRef.current;
          const sorted=[...sourceSamples].sort((a,b)=>parseFloat(a.pd)-parseFloat(b.pd));
          const trim=Math.floor(sorted.length*.15);
          const good=trim>0&&sorted.length>(trim*2+MIN_VALID_SAMPLES-1)
            ?sorted.slice(trim,sorted.length-trim)
            :sorted;
          const weightedAvg=k=>{
            const total=good.reduce((sum,m)=>sum+parseFloat(m[k])*(m.sampleWeight||1),0);
            const weights=good.reduce((sum,m)=>sum+(m.sampleWeight||1),0);
            return total/weights;
          };
          const weightedStd=k=>{
            const vals=good.map(m=>parseFloat(m[k]));
            const mean=weightedAvg(k);
            const weights=good.reduce((sum,m)=>sum+(m.sampleWeight||1),0);
            const variance=vals.reduce((sum,v,i)=>sum+((v-mean)**2)*(good[i].sampleWeight||1),0)/weights;
            return Math.sqrt(variance);
          };
          const pd=weightedAvg("pd"),br=weightedAvg("bridge"),face=weightedAvg("faceW");
          const lMono=weightedAvg("pdLeft"),rMono=weightedAvg("pdRight");
          const monoSum=lMono+rMono;
          const directPdSane=pd>=PD_ADULT_MIN&&pd<=PD_ADULT_MAX;
          const monoSumSane=monoSum>=PD_ADULT_MIN&&monoSum<=PD_ADULT_MAX;
          const finalPd=Math.abs(monoSum-pd)>2&&monoSumSane?monoSum:pd;
          const pdStd=weightedStd("pd");
          const bridgeStd=weightedStd("bridge");
          const stable=pdStd<=2.0&&bridgeStd<=1.5;
          const hardOutOfRange=!directPdSane&&!monoSumSane;
          const reviewRangeIssue=br<BRIDGE_MIN||br>BRIDGE_MAX||Math.abs(lMono-rMono)>MONOCULAR_SYMMETRY;
          setMeasurements({pd:finalPd.toFixed(1),pdLeft:lMono.toFixed(1),pdRight:rMono.toFixed(1),bridge:br.toFixed(1),temple:weightedAvg("temple").toFixed(0),lensH:weightedAvg("lensH").toFixed(1),faceW:face.toFixed(0),scaleSource:finalScaleSource});
          const nextQuality=hardOutOfRange
            ?{label:"Out of range",rescan:false,reason:"The PD landed outside the frame-fitting range. Review before continuing."}
            :s.length<MIN_VALID_SAMPLES||vp<.25
              ?{label:"Double-check these",rescan:false,reason:"We captured a small sample. Double-check the numbers below."}
              :reviewRangeIssue||pdStd>4.5||bridgeStd>3
                ?{label:"Review your numbers",rescan:false,reason:"Usable scan with some movement. Review the numbers below."}
                :stable&&vp>=.6
                  ?{label:"Clean scan",rescan:false,reason:"The scan had steady tracking and enough usable frames."}
                  :{label:"Fair scan",rescan:false,reason:"Usable scan with natural movement. Review the numbers below."};
          setQuality(nextQuality);
          logScanDebug("complete",{
            finalPd:Number(finalPd.toFixed(1)),
            pdStd:Number(pdStd.toFixed(2)),
            bridgeStd:Number(bridgeStd.toFixed(2)),
            sampleCount:s.length,
            facePct:Number(facePct.toFixed(2)),
            posePct:Number(posePct.toFixed(2)),
            quality:nextQuality.label,
          });
        }
      }
    };
    raf=requestAnimationFrame(animate);
    return ()=>cancelAnimationFrame(raf);
  },[clearScanCanvas,logScanDebug,seqIdx]);

  const reset=useCallback(()=>{
    setSeqIdx(-1); setFill(0); fillRef.current=0;
    setDone(false); setMeasurements(null); setQuality(null);
    setAutoStartPct(0); setFacePresent(false); setPoseHint(null); setDebugInfo(null);
    setCardStatus({label:"scale — iris reference",stablePct:0,reason:""});
    resetSampleState();
    cardStableRef.current=0; lastCardRef.current=null; cardLockedRef.current=false; cardStartedRef.current=null;
    holdRef.current=0; autoStarted.current=false; abortingRef.current=false;
  },[resetSampleState]);

  return {seqIdx,fill,done,measurements,mpReady,cvReady,autoStartPct,facePresent,poseHint,quality,validPct,cardStatus,debugInfo,reset};
}

// ─── FaceGuide ────────────────────────────────────────────────────────────────
function FaceGuide({fill,poseHint,done=false}){
  const VW=400,VH=300,cx=200,cy=150,rx=78,ry=108;
  const activeFill=clamp(done?0:fill,0,1);
  const waiting=!done&&activeFill<=0;
  return (
    <svg className="face-guide" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <filter id="scanGlow">
          <feGaussianBlur stdDeviation="2.5" result="b"/>
          <feMerge>
            <feMergeNode in="b"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <ellipse
        className={waiting?"oval-waiting":undefined}
        cx={cx} cy={cy} rx={rx} ry={ry}
        fill="none"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="1.5"
      />
      <path
        d={`M${cx},${cy+ry} A${rx},${ry} 0 0,1 ${cx},${cy-ry}`}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinecap="round"
        pathLength="1"
        strokeDasharray="1"
        strokeDashoffset={1 - activeFill}
        filter="url(#scanGlow)"
      />
      <path
        d={`M${cx},${cy+ry} A${rx},${ry} 0 0,0 ${cx},${cy-ry}`}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinecap="round"
        pathLength="1"
        strokeDasharray="1"
        strokeDashoffset={1 - activeFill}
        filter="url(#scanGlow)"
      />
      {poseHint&&<text x={cx} y={cy+ry+22} textAnchor="middle" fill="rgba(255,255,255,.72)"
        fontSize="13" fontFamily="'Geist',-apple-system,sans-serif" fontWeight="400">{poseHint}</text>}
    </svg>
  );
}

function ScanSetupDiagram(){
  return (
    <div className="setup-diagram" aria-hidden="true">
      <svg viewBox="0 0 360 195" fill="none">
        <path d="M58 96h82" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 5"/>
        <path d="M220 96h82" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 5"/>
        <circle cx="180" cy="78" r="43" stroke="rgba(242,240,232,.72)" strokeWidth="2"/>
        <path d="M156 86c11 9 37 9 48 0" stroke="rgba(242,240,232,.5)" strokeWidth="1.5" strokeLinecap="round"/>
        <rect x="116" y="133" width="128" height="50" rx="7" stroke="#4caf7d" strokeWidth="2"/>
        <path d="M180 121v12" stroke="#4caf7d" strokeWidth="2" strokeLinecap="round"/>
        <text x="180" y="164" textAnchor="middle" fill="rgba(242,240,232,.72)" fontSize="10" fontFamily="'Geist Mono',monospace">CARD</text>
      </svg>
    </div>
  );
}

// ─── Padlock ──────────────────────────────────────────────────────────────────
function Padlock(){
  return <svg width="11" height="12" viewBox="0 0 11 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="5" width="9" height="7" rx="1.5"/>
    <path d="M3 5V3.5a2.5 2.5 0 0 1 5 0V5"/>
  </svg>;
}

function useFitFrameJsonLd(){
  useEffect(()=>{
    document.getElementById("fitframe-json-ld")?.remove();
    const script=document.createElement("script");
    script.id="fitframe-json-ld";
    script.type="application/ld+json";
    script.textContent=JSON.stringify([
      {
        "@context":"https://schema.org",
        "@type":"Product",
        name:"FitFrame Custom Eyewear",
        description:"Browser-based face scan measuring PD, bridge, lens height, temple, and face width in millimeters. Frames 3D printed in PA12 nylon to exact measurements. Ships 7-10 days.",
        brand:{ "@type":"Brand", name:"FitFrame" },
        url:DOMAIN_URL,
        audience:{
          "@type":"PeopleAudience",
          audienceType:"people who have never found glasses that fit",
        },
        offers:{
          "@type":"Offer",
          price:"119",
          priceCurrency:"USD",
          availability:"https://schema.org/InStock",
          url:DOMAIN_URL,
        },
      },
      {
        "@context":"https://schema.org",
        "@type":"WebSite",
        url:DOMAIN_URL,
        potentialAction:{
          "@type":"SearchAction",
          target:`${DOMAIN_URL}/?q={search_term_string}`,
          "query-input":"required name=search_term_string",
        },
      },
      {
        "@context":"https://schema.org",
        "@type":"Organization",
        name:"FitFrame",
        founder:{
          "@type":"Person",
          name:"Lorenzo",
          jobTitle:"Founder",
        },
        address:{
          "@type":"PostalAddress",
          addressCountry:"US",
        },
        email:MAKER_EMAIL,
        url:DOMAIN_URL,
        sameAs:[
          "https://github.com/Embezzlemnt/fitframe",
        ],
      },
      {
        "@context":"https://schema.org",
        "@type":"FAQPage",
        mainEntity:FITFRAME_FAQ.map(([name,text])=>({
          "@type":"Question",
          name,
          acceptedAnswer:{
            "@type":"Answer",
            text,
          },
        })),
      },
    ]);
    document.head.appendChild(script);
    return ()=>script.remove();
  },[]);
}

function Logo({onRestart}){
  return <button className="logo" type="button" aria-label="Restart FitFrame" onClick={onRestart}>fitframe<span className="logo-dot">.</span></button>;
}

const TRUST_ICONS = {
  flag:(<><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></>),
  box:(<><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></>),
  refresh:(<><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></>),
  shield:(<><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></>),
};
function TrustIcon({type}){
  return (
    <svg className="trust-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {TRUST_ICONS[type]}
    </svg>
  );
}

function ScanCounter({count}){
  const target = Number.isFinite(count) ? count : null;
  const [shown,setShown]=useState(0);
  const fromRef=useRef(0);
  useEffect(()=>{
    if (target==null) return;
    const reduce = typeof matchMedia==="function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce){ setShown(target); fromRef.current=target; return; }
    const from=fromRef.current;
    if (from===target) return;
    const dur=1600, start=performance.now();
    const ease=t=>1-Math.pow(1-t,3);
    let raf;
    const tick=now=>{
      const p=Math.min(1,(now-start)/dur);
      const v=Math.round(from+(target-from)*ease(p));
      setShown(v); fromRef.current=v;
      if (p<1) raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(raf);
  },[target]);
  if (target==null) return null;
  return (
    <div className="scan-stat" role="status" aria-label={`join ${target.toLocaleString()} people who've already scanned their face`}>
      join <span className="scan-stat-num">{shown.toLocaleString()}</span> people who've already scanned their face
    </div>
  );
}

function VerificationStrip(){
  return (
    <section className="verification-strip" aria-label="Verification">
      <span>AMERICAN MADE</span><span className="vs-dot">·</span>
      <span>ZERO-WASTE TO ORDER</span><span className="vs-dot">·</span>
      <span>ONE-TIME REPRINT GUARANTEE</span>
    </section>
  );
}

function FooterLinks(){
  return (
    <nav className="footer-links" aria-label="Footer">
      <a href="/faq">faq</a><span>·</span>
      <a href="/about">about</a><span>·</span>
      <a href="/returns">returns</a><span>·</span>
      <a href="/privacy">privacy</a><span>·</span>
      <a href="mailto:hello@fitframe.store">hello@fitframe.store</a>
    </nav>
  );
}

function FaqAccordion(){
  return (
    <section className="faq-section" id="faq" aria-label="FAQ">
      <div className="eyebrow build-eyebrow">faq</div>
      <div className="faq-list">
        {FITFRAME_FAQ.map(([q,a])=>(
          <details className="faq-item" key={q}>
            <summary className="faq-q">
              <span>{q}</span>
              <svg className="faq-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </summary>
            <div className="faq-a">{a}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

// Main ─────────────────────────────────────────────────────────────────────
export default function FramesSite(){
  useFitFrameJsonLd();
  const saved=loadSession()||{};

  const savedStep = Number.isInteger(saved.step) && saved.step >= 0 && saved.step <= 5 ? saved.step : 0;
  const [step,          setStep]          = useState(savedStep);
  const [confirmedMeas, setConfirmedMeas] = useState(saved.confirmedMeas??null);
  const [calibration,   setCalibration]   = useState(saved.calibration??null);
  const [styleAnswers,  setStyleAnswers]  = useState(saved.styleAnswers??{});
  const [styleQIdx,     setStyleQIdx]     = useState(saved.styleQIdx??0);
  const [tapped,        setTapped]        = useState(null);
  const [selectedFrame, setSelectedFrame] = useState(saved.selectedFrame??null);
  const [selectedLens,  setSelectedLens]  = useState(saved.selectedLens??DEFAULT_LENS.id);
  const [customerInfo,  setCustomerInfo]  = useState(saved.customerInfo??{name:"",email:""});
  const [scanning,      setScanning]      = useState(false);
  const [scanPrepDismissed,setScanPrepDismissed] = useState(false);
  const [cameraIntro,   setCameraIntro]   = useState(false);
  const [scanSettling,  setScanSettling]  = useState(false);
  const [scanRestartCopy,setScanRestartCopy] = useState("");
  const [introReady,    setIntroReady]    = useState(false);
  const [introDone,     setIntroDone]     = useState(false);
  const [scanProcessing,setScanProcessing] = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [sent,          setSent]          = useState(false);
  const [orderId,       setOrderId]       = useState(()=>saved.orderId??genOrderId());
  const [scanCount,     setScanCount]     = useState(null);
  const [waitlistPosition,setWaitlistPosition] = useState(null);
  const [waitlistError, setWaitlistError] = useState("");
  const [botField,      setBotField]      = useState("");
  const [debugEnabled]                     = useState(()=>new URLSearchParams(window.location.search).get("debug")==="1");
  const scanHistorySavedRef                = useRef(false);
  const scanCompletePostedRef              = useRef(false);
  const processingTimerRef                 = useRef(null);
  const settleTimerRef                     = useRef(null);

  const canvasRef=useRef(null);
  const {
    videoRef,
    ready: camReady,
    requesting: camRequesting,
    camErr,
    start: startCamera,
    stop: stopCamera,
  } = useCamera();
  const startSettledScan=useCallback(()=>{
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    setScanRestartCopy("");
    setScanSettling(true);
    setScanning(false);
    settleTimerRef.current=setTimeout(()=>{
      setScanSettling(false);
      setScanning(true);
      settleTimerRef.current=null;
    },PRE_SCAN_SETTLE_MS);
  },[]);
  const handleCardLocked=useCallback((card)=>{
    setCalibration({
      source:"credit-card",
      cardWidthMm:card.cardWidthMm,
      cardHeightMm:card.cardHeightMm,
      cardWidthPx:card.cardWidthPx,
      cardHeightPx:card.cardHeightPx,
      mmPerPx:card.mmPerPx,
      confidence:card.confidence,
      corners:card.corners,
      timestamp:card.timestamp,
    });
  },[]);
  const handleCardSkipped=useCallback(()=>{
    setCalibration({
      source:"iris-fallback",
      skippedCard:true,
      timestamp:new Date().toISOString(),
    });
  },[]);
  const handleScanAbort=useCallback((message)=>{
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    processingTimerRef.current=null;
    settleTimerRef.current=null;
    setScanProcessing(false);
    setConfirmedMeas(null);
    setCalibration(null);
    setScanning(false);
    setScanSettling(false);
    setCameraIntro(false);
    setScanPrepDismissed(true);
    setScanRestartCopy(message||"scan lost. position your face and tap start again.");
    scanHistorySavedRef.current=false;
    scanCompletePostedRef.current=false;
  },[]);
  const scan=useFaceScan({
    videoRef,
    scanning,
    canvasRef,
    scaleMmPerPx:calibration?.mmPerPx||null,
    scaleSource:calibration?.source||"iris-fallback",
    needsCard:step===1&&camReady&&!cameraIntro&&scanning,
    faceEnabled:step===1&&camReady&&!cameraIntro,
    debugScan:debugEnabled,
    onCardLocked:handleCardLocked,
    onCardSkipped:handleCardSkipped,
    onAutoStart:startSettledScan,
    onScanAbort:handleScanAbort,
  });
  const currentMeas=confirmedMeas||(scan.quality?.rescan?scan.measurements:null);

  // Persist
  useEffect(()=>{
    if (step===0||sent) return;
    saveSession({step,confirmedMeas,calibration,styleAnswers,styleQIdx,selectedFrame,selectedLens,customerInfo,orderId});
  },[step,sent,confirmedMeas,calibration,styleAnswers,styleQIdx,selectedFrame,selectedLens,customerInfo,orderId]);

  const lensData=LENS_OPTIONS.find(lens=>lens.id===selectedLens&&lens.selectable)||DEFAULT_LENS;
  const totalPrice=BASE_PRICE+(lensData?.price||0);
  const chosenFrame=FITFRAME_FRAME;

  useEffect(()=>{ if(step!==1) stopCamera(); },[step,stopCamera]);
  useEffect(()=>{ if(scan.done){ setScanning(false); setScanSettling(false); } },[scan.done]);
  useEffect(()=>{ setTapped(null); },[styleQIdx]);
  useEffect(()=>()=>{ 
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
  },[]);
  useEffect(()=>{
    requestAnimationFrame(()=>setIntroReady(true));
    const timer=setTimeout(()=>setIntroDone(true),720);
    return ()=>clearTimeout(timer);
  },[]);
  useEffect(()=>{
    let cancelled=false;
    const load=()=>fetch("/api/scan-count")
      .then(r=>r.ok?r.json():null)
      .then(d=>{ if(!cancelled&&d?.ok&&Number.isFinite(d.count)) setScanCount(d.count); })
      .catch(()=>{});
    load();
    const id=setInterval(load,20000);
    const onVisible=()=>{ if(document.visibilityState==="visible") load(); };
    document.addEventListener("visibilitychange",onVisible);
    return ()=>{ cancelled=true; clearInterval(id); document.removeEventListener("visibilitychange",onVisible); };
  },[]);
  useEffect(()=>{
    if (!scan.done) return;
    const ctx=canvasRef.current?.getContext("2d");
    if (ctx) ctx.clearRect(0,0,canvasRef.current.width,canvasRef.current.height);
  },[scan.done]);
  useEffect(()=>{
    if (!camReady||!cameraIntro) return;
    const timer=setTimeout(()=>setCameraIntro(false),2000);
    return ()=>clearTimeout(timer);
  },[camReady,cameraIntro]);

  // Keep the user on scan review until they accept the measured spec.
  useEffect(()=>{
    if (scan.done&&scan.measurements&&scan.quality&&!scan.quality.rescan&&!confirmedMeas&&!scanProcessing&&!processingTimerRef.current){
      setScanProcessing(true);
      processingTimerRef.current=setTimeout(()=>{
        setConfirmedMeas({
          ...scan.measurements,
          scanQuality:scan.quality?.label||"Review",
          scanReason:scan.quality?.reason||"",
          validPct:scan.validPct,
        });
        if (!scanHistorySavedRef.current){
          appendScanHistory({
            timestamp:new Date().toISOString(),
            pd:scan.measurements.pd,
            bridge:scan.measurements.bridge,
            face:scan.measurements.faceW,
            scaleSource:scan.measurements.scaleSource,
            quality:scan.quality?.label||"Review",
            validPct:scan.validPct,
          });
          scanHistorySavedRef.current=true;
        }
        if (!scanCompletePostedRef.current){
          scanCompletePostedRef.current=true;
          fetch("/api/scan-complete",{method:"POST"})
            .then(r=>r.ok?r.json():null)
            .then(d=>{ if(d?.ok&&Number.isFinite(d.count)) setScanCount(d.count); })
            .catch(()=>{});
        }
        setScanProcessing(false);
        processingTimerRef.current=null;
      },2000);
    }
  },[confirmedMeas,scan.done,scan.measurements,scan.quality,scan.validPct,scanProcessing]);

  function acceptMeasurements(){
    const m=currentMeas||scan.measurements;
    if (!m) return;
    const accepted={
      ...m,
      scanQuality:m.scanQuality||scan.quality?.label||"Review your numbers",
      scanReason:m.scanReason||scan.quality?.reason||"",
      validPct:m.validPct??scan.validPct,
    };
    setConfirmedMeas(accepted);
    if (!scanHistorySavedRef.current){
      appendScanHistory({
        timestamp:new Date().toISOString(),
        pd:accepted.pd,
        bridge:accepted.bridge,
        face:accepted.faceW,
        scaleSource:accepted.scaleSource,
        quality:accepted.scanQuality,
        validPct:accepted.validPct,
      });
      scanHistorySavedRef.current=true;
    }
    setStep(2);
  }

  function selectOption(opt){
    setTapped(opt.label);
    const qId=STYLE_QUESTIONS[styleQIdx].id;
    setStyleAnswers(prev=>({...prev,[qId]:opt}));
    if (styleQIdx<STYLE_QUESTIONS.length-1){ setTimeout(()=>setStyleQIdx(i=>i+1),220); }
    else { setTimeout(()=>setStep(3),300); }
  }

  function startFreshScan(){
    clearSession();
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    processingTimerRef.current=null;
    settleTimerRef.current=null;
    setScanProcessing(false);
    setScanSettling(false);
    setScanRestartCopy("");
    setConfirmedMeas(null);
    setCalibration(null);
    setStyleAnswers({});
    setStyleQIdx(0);
    setSelectedFrame(null);
    setSelectedLens(DEFAULT_LENS.id);
    scan.reset();
    setScanning(false);
    setCameraIntro(false);
    setSent(false);
    setSubmitting(false);
    scanHistorySavedRef.current=false;
    scanCompletePostedRef.current=false;
    setScanPrepDismissed(false);
    setStep(1);
  }

  function restartFlow(){
    clearSession();
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    processingTimerRef.current=null;
    settleTimerRef.current=null;
    setScanProcessing(false);
    setScanSettling(false);
    setScanRestartCopy("");
    setConfirmedMeas(null);
    setCalibration(null);
    setStyleAnswers({});
    setStyleQIdx(0);
    setTapped(null);
    setSelectedFrame(null);
    setSelectedLens(DEFAULT_LENS.id);
    setCustomerInfo({name:"",email:""});
    setOrderId(genOrderId());
    setSubmitting(false);
    setSent(false);
    scan.reset();
    setScanning(false);
    setCameraIntro(false);
    setScanPrepDismissed(false);
    scanHistorySavedRef.current=false;
    scanCompletePostedRef.current=false;
    stopCamera();
    setStep(0);
  }

  function rescan(){
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    processingTimerRef.current=null;
    settleTimerRef.current=null;
    setScanProcessing(false);
    setScanSettling(false);
    setScanRestartCopy("");
    scan.reset();
    setScanning(false);
    setCameraIntro(false);
    setConfirmedMeas(null);
    setCalibration(null);
    scanHistorySavedRef.current=false;
    scanCompletePostedRef.current=false;
    setScanPrepDismissed(false);
    stopCamera();
  }

  function beginScanSetup(){
    setScanRestartCopy("");
    setScanPrepDismissed(true);
    setCameraIntro(true);
    startCamera();
  }

  async function joinWaitlist(e){
    if (e?.preventDefault) e.preventDefault();
    if (botField) return; // honeypot — silently ignore bots
    const email=customerInfo.email.trim();
    if (!isValidEmail(email)){ setWaitlistError("enter a valid email."); return; }
    setSubmitting(true); setWaitlistError("");
    const m=currentMeas||scan.measurements||{};
    const measurements={
      pd:m.pd, pdLeft:m.pdLeft, pdRight:m.pdRight,
      bridge:m.bridge, temple:m.temple, lensH:m.lensH, faceW:m.faceW,
      scaleSource:m.scaleSource, scanQuality:m.scanQuality, validPct:m.validPct,
    };
    try {
      const res=await fetch("/api/waitlist",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          email,
          order_id:orderId,
          measurements,
          frame_id:chosenFrame?.id||"fitframe-core",
          lens:lensData?.label||"blue light",
          lens_price:lensData?.price||0,
          total:totalPrice,
          timestamp:new Date().toISOString(),
          website:botField,
        }),
      });
      const data=await res.json().catch(()=>null);
      if (res.ok&&data?.ok){
        setWaitlistPosition(Number.isFinite(data.position)?data.position:null);
        clearSession();
        setSent(true);
      } else {
        setWaitlistError(data?.error||"something went wrong. please try again.");
      }
    } catch {
      setWaitlistError("network error. please try again.");
    } finally {
      setSubmitting(false);
    }
  }
  const cameraActive=camReady||camRequesting;
  const showScanPrep=!scanPrepDismissed&&!scan.done&&!currentMeas&&!camErr&&!cameraActive;
  const scanState=scanRestartCopy?"lost":scan.done||confirmedMeas?"complete":scanning||scanSettling?"scanning":"idle";
  const scaleIndicator=calibration?.source==="credit-card"?"scale — card reference":"scale — iris reference";
  const scanTitle=scanProcessing
    ?"your face is mapped."
    :scanState==="lost"
      ?"Face scan"
    :scanState==="scanning"
      ?scanSettling?"Find your spot.":"Stay still."
    :cameraIntro
      ?"Look straight ahead."
    :scanState==="complete"
      ?"your face is mapped."
    :showScanPrep
      ?"Take a quick calibrated face scan to begin."
    :camRequesting||!camReady
      ?"Opening camera."
      :"Ready to measure.";
  const scanCamInst=(()=>{
    if (scanRestartCopy) return {text:scanRestartCopy,lost:true};
    if (scanning) return {text:"Hold steady"};
    if (scanSettling) return {text:"Find your spot"};
    if (scan.poseHint) return {text:scan.poseHint,warn:true};
    if (scan.autoStartPct>0&&scan.autoStartPct<1) return {text:"Hold still..."};
    return {text:"Look directly at the camera."};
  })();
  const scanCopy=scanProcessing
    ?""
    :scanState==="scanning"
      ?scanSettling?"Hold still for a second before measuring.":""
    :cameraIntro
      ?"Fill the oval with your face."
    :scanState==="complete"
      ?""
    :scanState==="lost"
      ?""
    :showScanPrep
      ?""
    :camRequesting
      ?"Allow camera access to continue."
    :camReady
      ?"Position your face in the oval, then start the scan."
      :"";

  return (
    <>
      <style>{css}</style>
      <div className={`app ${introReady?"app-ready":""} ${introDone?"intro-done":"intro-active"}`}>
        <header className="site-header">
          <Logo onRestart={restartFlow}/>
          <nav className="header-nav" aria-label="Site">
            <a href="#faq">FAQ</a>
            <a href="/">fitframe.store</a>
          </nav>
        </header>

        <div className="container">

          {/* ── 0: Hero ── */}
          {step===0&&(
            <div className="section hero">
              <div className="eyebrow">made-to-measure eyewear</div>
              <h1 className="display hero-headline">frames built for <em>your</em> face.</h1>
              <p className="body-lg hero-sub">scan your face. answer four questions. get frames built to your exact measurements.</p>
              <ScanCounter count={scanCount}/>
              <div className="btn-row">
                <button className="btn btn-accent hero-cta" onClick={startFreshScan}>scan your face to join early access →</button>
              </div>

              <div className="trust-row">
                <div className="trust-item"><TrustIcon type="flag"/><span>made in america</span></div>
                <div className="trust-item"><TrustIcon type="box"/><span>ships in ~10 days</span></div>
                <div className="trust-item"><TrustIcon type="refresh"/><span>one-time reprint guarantee</span></div>
                <div className="trust-item"><TrustIcon type="shield"/><span>fit guarantee</span></div>
              </div>

              <div className="price-block">
                <div className="price-big">$119</div>
                <div className="price-sub">blue light lenses included</div>
              </div>

              <ol className="feature-list">
                <li><span className="feature-num">01</span><span className="feature-text"><span className="feature-lead">your phone does what an optician does.</span> no appointment, no store.</span></li>
                <li><span className="feature-num">02</span><span className="feature-text"><span className="feature-lead">every measurement captured —</span> pd, bridge, temple, face width, face height.</span></li>
                <li><span className="feature-num">03</span><span className="feature-text"><span className="feature-lead">3D printed to your spec in carbon fiber nylon.</span> light, precise, durable.</span></li>
                <li><span className="feature-num">04</span><span className="feature-text"><span className="feature-lead">first batch is limited.</span> you're early.</span></li>
              </ol>

              <div className="why-block">
                <p className="why-lead">glasses are built for an average face. most of us aren't average.</p>
                <p className="why-body">FitFrame exists for the person who gave up without realizing it. one browser-based scan maps your face to real millimeter measurements. a carbon fiber nylon frame gets printed to those numbers — zero inventory, zero waste, built to your geometry. <span className="why-emph">not adjusted. not approximated. yours.</span></p>
              </div>

              <div className="build-block">
                <div className="eyebrow build-eyebrow">how we build it</div>
                <p className="build-body">every pair starts with a browser-based scan. a facial landmark system maps your face from the camera feed and extracts the measurements that define a frame's fit — pupillary distance, bridge width, temple length, lens height, face width. a credit card or your own iris gives the scan a real millimeter scale. nothing leaves your device but the numbers.</p>
                <p className="build-body">those measurements go straight into a parametric print file. each frame is printed in carbon-fiber nylon — light, durable, dimensionally precise — then hand-finished, fitted with US lab-cut blue light lenses, and shipped from America. zero inventory: nothing is made until you order it.</p>
                <p className="build-body">it's made-to-measure manufacturing run lean and built to scale carefully. if you care how things are actually made, this is the part for you.</p>
              </div>

              <FaqAccordion/>
            </div>
          )}

          {/* ── 1: Scan ── */}
          {step===1&&(
            <div className="section">
              <div className="eyebrow">Face scan</div>
              <div className="step-head">{scanTitle}</div>
              {scanCopy&&<p className="step-sub">{scanCopy}</p>}

              {showScanPrep&&(
                <div className="cam-placeholder pre-scan-card">
                  <div className="pre-scan-line">this scan takes about {SCAN_DURATION_SECONDS_PLACEHOLDER} seconds.</div>
                  <div className="pre-scan-line">have a credit or ID card ready.</div>
                  <ScanSetupDiagram/>
                  <div className="pre-scan-support">hold a card flat under your chin, facing the camera.</div>
                  <div className="pre-scan-support">this gives the scan a much better size reference.</div>
                  <div className="pre-scan-support">no card? just hold still — we'll measure from your iris.</div>
                  <div className="setup-list">
                    <div>arm's length from your phone</div>
                    <div>good overhead light, face it directly</div>
                  </div>
                  <button className="btn btn-primary" style={{alignSelf:"stretch",width:"100%",marginTop:4}} onClick={beginScanSetup}>i'm ready →</button>
                  <div className="privacy-inline"><Padlock/><span>Scan stays on this device. Images are not transmitted.</span></div>
                </div>
              )}

              {cameraActive&&!scan.done&&(
                <div className="cam-outer">
                  <div className="cam-inner">
                    <video ref={videoRef} autoPlay playsInline muted/>
                    <canvas ref={canvasRef}/>
                    <div className="cam-vignette"/>
                    <FaceGuide fill={scan.fill} poseHint={!scanRestartCopy&&!scanning&&!scanSettling?scan.poseHint:null} done={scan.done}/>
                    {cameraIntro&&!scanRestartCopy&&(
                      <div className="face-intro">
                        <div className="face-intro-main">Look straight ahead</div>
                        <div className="face-intro-sub">Fill the oval with your face</div>
                      </div>
                    )}
                    {scanSettling&&!scanRestartCopy&&(
                      <div className="settle-intro">
                        <div className="settle-intro-main">Find your spot</div>
                      </div>
                    )}
                    {debugEnabled&&(
                      <div className="debug-overlay">
                        <div>L iris: {scan.debugInfo?.lIrisPx ?? "-"}px</div>
                        <div>R iris: {scan.debugInfo?.rIrisPx ?? "-"}px</div>
                        <div>Scale: {scan.debugInfo?.scaleFactor ?? "-"}</div>
                        <div>Raw PD: {scan.debugInfo?.rawPd ?? "-"}mm</div>
                        <div>Frames: {scan.debugInfo?.validFrames ?? 0}/{scan.debugInfo?.totalFrames ?? 0}</div>
                        <div>Source: {scan.debugInfo?.scaleSource ?? "iris-fallback"}</div>
                        <div>Discard: {scan.debugInfo?.discarded ? Object.entries(scan.debugInfo.discarded).map(([k,v])=>`${k}:${v}`).join(", ") : "-"}</div>
                      </div>
                    )}
                    <div className="cam-bottom">
                      <div className={`scan-inst ${scanCamInst.lost?"scan-inst-lost":""}`} style={scanCamInst.warn?{color:"#C49A2E"}:undefined}>
                        {scanCamInst.text}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {step===1&&camReady&&scan.done&&<canvas ref={canvasRef} style={{display:"none"}}/>}

              {scanProcessing&&(
                <div className="processing-card">
                  <div className="processing-logo">fitframe<span className="logo-dot">.</span></div>
                  <div className="processing-copy">mapping your face</div>
                  <div className="processing-track"><div className="processing-fill"/></div>
                </div>
              )}

              {camErr&&(
                <div className="cam-placeholder">
                  <div className="cam-label" style={{color:"var(--red)"}}>{camErr.headline}</div>
                  {camErr.type==="denied"?<div className="err-box">{camErr.detail}</div>:<div className="cam-sub">{camErr.detail}</div>}
                  {camErr.fix==="retry"&&<button className="btn btn-ghost" onClick={startCamera}>Try again</button>}
                  {camErr.fix==="reload"&&<button className="btn btn-ghost" onClick={()=>location.reload()}>Reload page</button>}
                </div>
              )}

              {camReady&&!scan.done&&(
                <div style={{textAlign:"center",marginTop:14}}>
                  <div className="calibration-strip"><span>{scaleIndicator}</span></div>
                  {!scanning&&!scanSettling&&(
                      <button className="btn btn-primary" disabled={!scan.mpReady||!scan.facePresent||scanSettling} onClick={startSettledScan}>
                        {scan.mpReady?scan.facePresent?"start scan →":"find your face first":"loading..."}
                      </button>
                  )}
                </div>
              )}

              {scan.done&&!scanProcessing&&!currentMeas&&(
                <div className="cam-placeholder" style={{marginTop:0}}>
                  <div className="cam-label" style={{color:"var(--red)"}}>{scan.quality?.label||"No face data captured."}</div>
                  <div className="cam-sub">{scan.quality?.reason||"Ensure your face is well-lit and centered."}</div>
                  <button className="btn btn-ghost" style={{marginTop:4}} onClick={rescan}>Try again</button>
                </div>
              )}

              {currentMeas&&!scanProcessing&&scan.quality?.rescan&&(
                <div className="cam-placeholder" style={{marginTop:0}}>
                  <div className={`quality-pill ${scan.quality?.rescan?"bad":""}`}>{scan.quality?.label||"Rescan"}</div>
                  <div className="cam-label">Let's try that again.</div>
                  <div className="cam-sub">{scan.quality?.reason||"Face the camera straight on in good light and hold still."}</div>
                  <div className="btn-row" style={{marginTop:4}}>
                    <button className="btn btn-primary" onClick={rescan}>Rescan</button>
                    <button className="btn btn-ghost" onClick={acceptMeasurements}>continue anyway &rarr;</button>
                  </div>
                </div>
              )}

              {(scan.done||confirmedMeas)&&currentMeas&&!scanProcessing&&!scan.quality?.rescan&&(
                <div className="quality-card">
                  <div className="quality-head">
                    <div className="quality-title">your face is mapped.</div>
                  </div>
                  <p className="quality-copy">
                    you're all set — continue to pick your frame.
                  </p>
                  <div className="btn-row">
                    <button className="btn btn-primary" onClick={acceptMeasurements}>continue &rarr;</button>
                    <button className="btn btn-ghost" onClick={rescan}>rescan</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── 2: Style ── */}
          {step===2&&(()=>{
            const q=STYLE_QUESTIONS[styleQIdx];
            return (
              <div className="section" key={styleQIdx}>
                <div className="eyebrow">Style</div>
                <div className="q-meta"><span className="q-counter">{styleQIdx+1} / {STYLE_QUESTIONS.length}</span></div>
                <div className="q-label">{q.q}</div>
                <div className="choices">
                  {q.options.map((opt,i)=>(
                    <button key={`q${styleQIdx}-o${i}`} className={`choice ${tapped===opt.label?"chosen":""}`}
                      onClick={()=>selectOption(opt)}>{opt.label}</button>
                  ))}
                </div>
                {styleQIdx>0&&(
                  <div style={{marginTop:20}}>
                    <button className="btn btn-ghost" onClick={()=>{
                      const prev={...styleAnswers};
                      delete prev[STYLE_QUESTIONS[styleQIdx-1].id];
                      setStyleAnswers(prev); setStyleQIdx(i=>i-1);
                    }}>← Back</button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Frame */}
          {step===3&&(
            <div className="section">
              <div className="step-head">your frame.</div>
              <p className="step-sub">built to your measurements — printed in matte carbon-fiber nylon, hand-finished, shipped from America.</p>
              <div className="btn-row" style={{marginTop:18}}>
                <button className="btn btn-primary" onClick={()=>{setSelectedFrame(FITFRAME_FRAME.id);setStep(4);}}>
                  choose lenses →
                </button>
                <button className="btn btn-ghost" onClick={()=>setStep(2)}>Back</button>
              </div>
            </div>
          )}

          {/* Lenses */}
          {step===4&&!sent&&(
            <div className="section">
              <div className="step-head">lens options.</div>
              <p className="step-sub">blue light is included for founding pairs. more options are on the roadmap.</p>
              <div className="lens-list">
                {LENS_OPTIONS.map(option=>(
                  <button
                    key={option.id}
                    className={`lens-row ${selectedLens===option.id?"sel":""} ${!option.selectable?"disabled":""}`}
                    disabled={!option.selectable}
                    onClick={()=>option.selectable&&setSelectedLens(option.id)}
                    type="button"
                  >
                    <div className="lens-info">
                      <div className="lens-name">{option.label}</div>
                      <div className="lens-desc">{option.desc}</div>
                    </div>
                    <div className="lens-meta">
                      <div className="lens-price-tag">${BASE_PRICE+option.price}</div>
                      <div className={`lens-tag ${option.selectable?"lens-tag-included":""}`}>{option.status}</div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="btn-row" style={{marginTop:8}}>
                <button className="btn btn-primary" onClick={()=>setStep(5)}>continue →</button>
                <button className="btn btn-ghost" onClick={()=>setStep(3)}>Back</button>
              </div>
            </div>
          )}

          {/* Waitlist wall */}
          {step===5&&!sent&&(
            <div className="section">
              <div className="step-head">you're early.</div>
              <p className="step-sub">your pair is designed. we're in final production on the first batch — join the list and we'll reach out the moment yours can be built.</p>
              <div className="pair-summary">
                <div className="receipt">
                  <div className="receipt-row"><span>your frame</span><span>custom fit</span></div>
                  <div className="receipt-row"><span>{lensData?.label||"blue light"} lenses</span><span>included</span></div>
                  <div className="receipt-total"><span>total</span><span>${totalPrice}</span></div>
                </div>
              </div>
              <form onSubmit={joinWaitlist}>
                <input className="hp-field" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
                  value={botField} onChange={e=>setBotField(e.target.value)}/>
                <input className="field" placeholder="your email" type="email" inputMode="email" autoComplete="email"
                  value={customerInfo.email} onChange={e=>{setCustomerInfo(p=>({...p,email:e.target.value}));setWaitlistError("");}}/>
                {waitlistError&&<div className="waitlist-err">{waitlistError}</div>}
                <div className="btn-row" style={{marginTop:10}}>
                  <button className="btn btn-accent" type="submit"
                    disabled={!customerInfo.email.trim()||submitting}>
                    {submitting?"joining...":"join the list →"}
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={()=>setStep(4)}>Back</button>
                </div>
              </form>
              <div className="trust-line"><Padlock/><span>no images are sent. your measurements go securely to the maker.</span></div>
            </div>
          )}

          {/* ── Confirmation ── */}
          {sent&&(
            <div className="section">
              <div className="confirm-greeting">you're on the list.</div>
              <p className="confirm-body">
                {waitlistPosition!=null&&<><strong>#{waitlistPosition}</strong> in line for the first batch. </>}
                we'll reach out when production opens for your pair.
              </p>
              <div className="pair-summary">
                <div className="receipt">
                  <div className="receipt-row"><span>your frame</span><span>custom fit</span></div>
                  <div className="receipt-row"><span>{lensData?.label||"blue light"} lenses</span><span>included</span></div>
                  <div className="receipt-total"><span>total</span><span>${totalPrice}</span></div>
                </div>
              </div>
            </div>
          )}

          <VerificationStrip/>
          <FooterLinks/>

        </div>
        <div style={{height:60}}/>
      </div>
    </>
  );
}
