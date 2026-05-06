import { useState, useRef, useEffect, useCallback } from "react";

// ─── Config ───────────────────────────────────────────────────────────────────
const MAKER_EMAIL = "hello@fitframe.store";
const DOMAIN_URL = "https://fitframe.store"; // LOCKED
const DOMAIN_HOST = "fitframe.store"; // LOCKED
const BASE_PRICE  = 89;

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
const FACE_ABORT_FRAMES = 8;   // Roughly 250ms of sustained face/pose loss during active scan
const FACE_PRESENT_MIN_RATIO = 0.90;
const POSE_VALID_MIN_RATIO = 0.75;
const SCALE_HISTORY_FRAMES = 10;
const DISTANCE_TOO_FAR_PX = 14;
const DISTANCE_TOO_CLOSE_PX = 60;
const MOTION_TRACK_POINTS = [468,473,33,263,6,1,10,152,234,454];
const MOTION_SOFT_RATIO = 0.025;
const MOTION_REJECT_RATIO = 0.045;
const QUALITY_KEEP_RATIO = 0.70;
const LOCK_WINDOW_FRAMES = 5;
const LOCK_PD_RANGE_MM = 1.0;
const LOCK_BRIDGE_RANGE_MM = 1.4;
const EXTEND_SCAN_MS = 3000;
const HIGH_VARIANCE_PD_STD = 3.0;
const HIGH_VARIANCE_BRIDGE_STD = 2.0;
const CREDIT_CARD_WIDTH_MM = 85.6;
const CREDIT_CARD_HEIGHT_MM = 54;
const CARD_ASPECT = CREDIT_CARD_WIDTH_MM / CREDIT_CARD_HEIGHT_MM;
const CARD_STABLE_FRAMES = 6;
const CARD_MAX_ROTATION_DEG = 14;
const CARD_MIN_CONFIDENCE = 0.58;
const CARD_FALLBACK_MS = 8000;
const OPENCV_URL = "https://docs.opencv.org/4.9.0/opencv.js";
const MEASUREMENT_RANGES = {
  pd:[50,85], pdLeft:[20,45], pdRight:[20,45],
  bridge:[8,30], faceW:[110,160], temple:[125,160], lensH:[30,50],
};
const FITFRAME_FAQ = [
  ["Is FitFrame legit?","FitFrame is a real operation based in the US. Every order is fulfilled by the person who built it. The official domain is fitframe.store."],
  ["Why is FitFrame so cheap?","FitFrame cuts out retail, opticians, and inventory. You're paying for the frame and the fit, not the overhead. $89 is the honest price for what this is."],
  ["How is FitFrame different from Fitz Frames?","FitFrame is not Fitz Frames. FitFrame is an independent adult custom-fit eyewear workflow for non-Rx frames, direct from the maker to the customer."],
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
  const W=ctx.canvas.width;
  const quad=detection.quad.map(p=>({x:W-p.x,y:p.y}));
  const center={x:W-detection.center.x,y:detection.center.y};
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
  ctx.fillText(stablePct>=1?"SCALE LOCKED":`CARD ${Math.round(stablePct*100)}%`, center.x, center.y);
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
          mmPerPx:((CREDIT_CARD_WIDTH_MM/width)+(CREDIT_CARD_HEIGHT_MM/height))/2,
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

function calcFrameMotion(pts, prevPts) {
  if (!prevPts) return { ratio:0, score:1 };
  const faceH = distPt(pts[10], pts[152]) || 1;
  const deltas = MOTION_TRACK_POINTS.map(i => {
    const a=pts[i], b=prevPts[i];
    return a&&b ? Math.hypot(a.x-b.x,a.y-b.y) : null;
  }).filter(Number.isFinite);
  const ratio=(median(deltas)||0)/faceH;
  return { ratio, score:clamp(1 - ratio / MOTION_SOFT_RATIO, 0, 1) };
}

function distanceCueFromIris(avgDiam) {
  if (!avgDiam) return null;
  if (avgDiam > DISTANCE_TOO_CLOSE_PX) return { label:"Move farther", tone:"bad" };
  if (avgDiam < DISTANCE_TOO_FAR_PX) return { label:"Move closer", tone:"bad" };
  return { label:"Perfect", tone:"good" };
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
  const pd = d(468,473)*sc;
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
    irisDelta: iris.irisDelta,
    irisRange: `${irisMin.toFixed(1)}-${irisMax.toFixed(1)}`,
  };
}

function genOrderId() { return "FF-"+Math.random().toString(36).substring(2,8).toUpperCase(); }
function getETA()     { const d=new Date(); d.setDate(d.getDate()+10); return d.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"}); }

// ─── Frame SVGs ───────────────────────────────────────────────────────────────
const FrameSVG = ({ id, size=56, color="currentColor" }) => {
  const p = { fill:"none", stroke:color, strokeLinecap:"round", strokeLinejoin:"round" };
  const s = {
    "thin-round":  <svg width={size} height={size*.5} viewBox="0 0 80 40" {...p} strokeWidth="2"><circle cx="20" cy="20" r="14"/><circle cx="60" cy="20" r="14"/><line x1="34" y1="20" x2="46" y2="20"/><line x1="0" y1="16" x2="6" y2="20"/><line x1="80" y1="16" x2="74" y2="20"/></svg>,
    "bold-square": <svg width={size} height={size*.5} viewBox="0 0 80 40" {...p} strokeWidth="4"><rect x="4" y="6" width="30" height="26" rx="3"/><rect x="46" y="6" width="30" height="26" rx="3"/><line x1="34" y1="19" x2="46" y2="19"/><line x1="0" y1="12" x2="4" y2="16"/><line x1="80" y1="12" x2="76" y2="16"/></svg>,
    "cat-eye":     <svg width={size} height={size*.5} viewBox="0 0 80 40" {...p} strokeWidth="2"><path d="M6 26 Q8 8 26 6 Q36 5 34 20 Q32 32 18 32 Q8 32 6 26Z"/><path d="M74 26 Q72 8 54 6 Q44 5 46 20 Q48 32 62 32 Q72 32 74 26Z"/><line x1="34" y1="19" x2="46" y2="19"/><line x1="0" y1="16" x2="6" y2="20"/><line x1="80" y1="16" x2="74" y2="20"/></svg>,
    "navigator":   <svg width={size} height={size*.5} viewBox="0 0 80 40" {...p} strokeWidth="2"><path d="M6 10 Q8 6 20 6 Q32 6 34 16 Q36 28 20 32 Q6 32 6 22Z"/><path d="M74 10 Q72 6 60 6 Q48 6 46 16 Q44 28 60 32 Q74 32 74 22Z"/><line x1="34" y1="18" x2="46" y2="18"/><line x1="0" y1="14" x2="6" y2="18"/><line x1="80" y1="14" x2="74" y2="18"/></svg>,
    "rectangle":   <svg width={size} height={size*.5} viewBox="0 0 80 40" {...p} strokeWidth="2"><rect x="4" y="10" width="30" height="18" rx="2"/><rect x="46" y="10" width="30" height="18" rx="2"/><line x1="34" y1="19" x2="46" y2="19"/><line x1="0" y1="14" x2="4" y2="18"/><line x1="80" y1="14" x2="76" y2="18"/></svg>,
    "round-thick": <svg width={size} height={size*.5} viewBox="0 0 80 40" {...p} strokeWidth="4"><circle cx="20" cy="20" r="13"/><circle cx="60" cy="20" r="13"/><line x1="33" y1="20" x2="47" y2="20" strokeWidth="3"/><line x1="0" y1="16" x2="7" y2="20" strokeWidth="3"/><line x1="80" y1="16" x2="73" y2="20" strokeWidth="3"/></svg>,
    "sporty-wrap": <svg width={size} height={size*.5} viewBox="0 0 80 40" {...p} strokeWidth="2"><path d="M2 20 Q4 8 20 8 Q36 8 40 20 Q44 8 60 8 Q76 8 78 20 Q76 32 60 30 Q44 28 40 20 Q36 28 20 30 Q4 32 2 20Z"/><line x1="0" y1="16" x2="2" y2="20"/><line x1="80" y1="16" x2="78" y2="20"/></svg>,
    "geometric":   <svg width={size} height={size*.5} viewBox="0 0 80 40" {...p} strokeWidth="2"><polygon points="20,5 34,12 34,26 20,33 6,26 6,12"/><polygon points="60,5 74,12 74,26 60,33 46,26 46,12"/><line x1="34" y1="19" x2="46" y2="19"/><line x1="0" y1="14" x2="6" y2="18"/><line x1="80" y1="14" x2="74" y2="18"/></svg>,
  };
  return s[id] || s["rectangle"];
};

// ─── Data ─────────────────────────────────────────────────────────────────────
const FRAMES = [
  { id:"thin-round",  label:"Thin Round",     desc:"Wire. Circular. Timeless.",      tags:["minimal","soft","retro","classic","clean"] },
  { id:"bold-square", label:"Bold Square",    desc:"Thick. Structured. Presence.",   tags:["bold","statement","modern","confident"] },
  { id:"cat-eye",     label:"Cat Eye",        desc:"Upswept. Distinct. Playful.",    tags:["vintage","expressive","retro","statement"] },
  { id:"navigator",   label:"Navigator",      desc:"Teardrop. Works on most faces.", tags:["classic","clean","modern","adjustable"] },
  { id:"rectangle",   label:"Slim Rectangle", desc:"Low profile. Understated.",      tags:["minimal","sleek","modern","clean","slim"] },
  { id:"round-thick", label:"Round Thick",    desc:"Wide. Retro. Confident.",        tags:["bold","retro","statement","vintage"] },
  { id:"sporty-wrap", label:"Sporty Wrap",    desc:"Curved. Active. Polished.",      tags:["sporty","practical","adjustable","bold"] },
  { id:"geometric",   label:"Geometric",      desc:"Angular. Unconventional.",       tags:["editorial","modern","statement","bold"] },
];

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

const DEFAULT_LENS = { id:"bluelight", label:"Blue Light", price:0 };

const SCAN_SEQ = [
  { holdMs:1500, fill:0.08 },
  { holdMs:3000, fill:0.35 },
  { holdMs:3000, fill:0.65 },
  { holdMs:2500, fill:0.88 },
  { holdMs:1500, fill:1.00 },
];
const EXTENDED_SCAN_SEQ = [...SCAN_SEQ, { holdMs:EXTEND_SCAN_MS, fill:1.00 }];
const PRE_SCAN_SETTLE_MS = 1000;

// ─── CSS ──────────────────────────────────────────────────────────────────────
const css = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  :root{
    --bg:#0d0d0d;--bg2:#11110f;--surface:#161615;--surface2:#1d1d1b;--panel:#141413;
    --border:#2b2b28;--border2:#3a3a35;--text:#f2f0e8;--mid:#b0ada2;--dim:#858176;--soft:#555249;
    --accent:#4caf7d;--accent2:#73d7a0;--accent-bg:#0d2117;--red:#ff5a52;--amber:#e5a64a;--scan:#030303;
    --ease-premium:cubic-bezier(0.32,0.72,0,1);
  }
  html,body{height:100%;}
  html{background:var(--bg);}
  body{color:var(--text);font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overscroll-behavior:none;}
  button,input{-webkit-tap-highlight-color:transparent;}
  a{color:inherit;text-decoration:none;}
  .app{min-height:100dvh;display:flex;flex-direction:column;align-items:center;padding-bottom:calc(env(safe-area-inset-bottom,0px) + 28px);opacity:0;}
  .app.app-ready{animation:pageFade .4s var(--ease-premium) forwards;}
  @keyframes pageFade{from{opacity:0}to{opacity:1}}
  .app.intro-active .site-header .logo{opacity:0;}
  .intro-logo{position:fixed;z-index:50;left:50%;top:50%;transform:translate(-50%,-50%);font-size:48px;font-weight:600;letter-spacing:-.045em;line-height:1;color:var(--text);pointer-events:none;animation:logoCollapse .7s var(--ease-premium) forwards;}
  @keyframes logoCollapse{to{left:max(18px,calc(50% - 213px));top:27px;transform:none;font-size:15px;font-weight:500;letter-spacing:-.02em;}}
  .site-header{width:100%;max-width:462px;padding:22px 18px 0;display:flex;align-items:center;justify-content:flex-start;}
  .logo{font:inherit;font-size:15px;font-weight:500;color:var(--text);letter-spacing:-.02em;line-height:1;cursor:pointer;background:transparent;border:0;padding:0;}
  .logo:hover{color:#fff;}
  .logo-dot{color:var(--accent);}
  .container{width:100%;max-width:462px;padding:0 18px;}
  .section{margin-top:20px;padding:22px 18px;background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,.01));border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.25);animation:stepEnter .4s var(--ease-premium) both;}
  @keyframes stepEnter{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}
  .eyebrow{font-size:10px;font-family:'Geist Mono',monospace;color:var(--dim);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;}
  .display{font-size:34px;font-weight:600;color:var(--text);letter-spacing:-.04em;line-height:1.02;margin-bottom:12px;max-width:330px;}
  .display em{font-style:normal;color:var(--accent);}
  .step-head{font-size:26px;font-weight:600;color:var(--text);letter-spacing:-.035em;line-height:1.08;margin-bottom:6px;}
  .body-lg{font-size:14px;color:var(--dim);line-height:1.62;font-weight:300;margin-bottom:24px;max-width:360px;}
  .step-sub{font-size:13px;color:var(--dim);line-height:1.6;font-weight:300;margin-bottom:18px;letter-spacing:-.01em;}
  .privacy-inline{display:flex;align-items:flex-start;justify-content:center;gap:6px;max-width:300px;margin-top:2px;color:var(--soft);font-size:11px;font-weight:300;line-height:1.45;}
  .privacy-inline svg{flex:0 0 auto;margin-top:1px;opacity:.7;}
  .logo-large{display:inline-block;font-size:34px;letter-spacing:-.04em;margin-bottom:18px;}
  .about-list{border-top:1px solid var(--border);margin-top:20px;}
  .about-row{padding:15px 0;border-bottom:1px solid var(--border);}
  .about-row h2{font-size:13px;font-weight:500;color:var(--text);margin-bottom:5px;letter-spacing:-.01em;}
  .about-row p{font-size:12px;color:var(--dim);line-height:1.55;font-weight:300;}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:12px 18px;font-family:'Geist',sans-serif;font-size:13px;font-weight:500;cursor:pointer;border:none;border-radius:9px;transition:background .18s var(--ease-premium),border-color .18s var(--ease-premium),color .18s var(--ease-premium),transform .18s var(--ease-premium);white-space:nowrap;touch-action:manipulation;}
  .btn-primary{background:var(--text);color:#0d0d0d;}
  .btn-primary:hover{background:#ffffff;transform:translateY(-1px);}
  .btn-accent{background:var(--accent);color:#07110b;}
  .btn-accent:hover{background:var(--accent2);transform:translateY(-1px);}
  .btn-ghost{background:transparent;color:var(--dim);border:1px solid var(--border2);}
  .btn-ghost:hover{border-color:var(--dim);color:var(--text);}
  .btn:disabled{opacity:.28;cursor:not-allowed;transform:none!important;}
  .btn-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;}
  .btn-row .btn{flex:1;min-width:128px;}
  .cam-outer{width:100%;border-radius:12px;overflow:hidden;background:var(--scan);position:relative;margin-bottom:18px;border:1px solid var(--border2);transition:border-color .22s var(--ease-premium),box-shadow .22s var(--ease-premium);}
  .cam-outer.distance-good{border-color:rgba(76,175,125,.72);box-shadow:0 0 0 1px rgba(76,175,125,.18),0 0 24px rgba(76,175,125,.12);}
  .cam-outer.distance-bad{border-color:rgba(255,90,82,.68);box-shadow:0 0 0 1px rgba(255,90,82,.12);}
  .cam-inner{width:100%;aspect-ratio:4/3;position:relative;}
  .cam-inner video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);z-index:0;}
  .cam-inner canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;}
  .cam-vignette{position:absolute;inset:0;pointer-events:none;z-index:2;background:radial-gradient(ellipse at center,transparent 54%,rgba(0,0,0,.34) 100%);}
  .face-guide{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;filter:drop-shadow(0 0 7px rgba(76,175,125,.55));}
  .distance-pill{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:6;padding:5px 9px;border-radius:999px;background:rgba(0,0,0,.54);font-size:11px;font-family:'Geist Mono',monospace;letter-spacing:.04em;text-transform:uppercase;pointer-events:none;}
  .distance-pill.good{color:var(--accent);}
  .distance-pill.bad{color:var(--red);}
  .cam-bottom{position:absolute;bottom:0;left:0;right:0;z-index:5;padding:28px 16px 15px;background:linear-gradient(transparent,rgba(0,0,0,.68));display:flex;flex-direction:column;align-items:center;gap:4px;}
  @keyframes cardPulse{0%,100%{opacity:.74;filter:drop-shadow(0 0 4px rgba(76,175,125,.35));}50%{opacity:1;filter:drop-shadow(0 0 14px rgba(76,175,125,.72));}}
  @keyframes lockIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
  .scan-inst{font-size:15px;font-weight:500;color:rgba(255,255,255,.92);letter-spacing:-.01em;text-align:center;}
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
  .pre-scan-card{align-items:flex-start;text-align:left;border-style:solid;gap:13px;}
  .pre-scan-line{font-size:13px;color:var(--text);font-weight:400;line-height:1.45;}
  .pre-scan-support{font-size:12px;color:var(--dim);font-weight:300;line-height:1.5;}
  .setup-diagram{width:100%;aspect-ratio:1.85/1;border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.02);overflow:hidden;color:var(--soft);}
  .setup-diagram svg{display:block;width:100%;height:100%;}
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
  .choice{min-height:48px;padding:14px 16px;border:1px solid var(--border2);border-radius:10px;cursor:pointer;background:var(--surface2);text-align:left;font-family:'Geist',sans-serif;font-size:14px;color:var(--text);font-weight:300;line-height:1.4;width:100%;transition:border-color .18s var(--ease-premium),background .18s var(--ease-premium),color .18s var(--ease-premium),transform .18s var(--ease-premium);}
  .choice:active{transform:scale(.985);}
  .choice.chosen{border-color:var(--accent);background:var(--accent-bg);color:var(--text);}
  .lens-list{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:22px;}
  .lens-row{min-height:126px;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;gap:12px;padding:15px 14px;border:1px solid var(--border);border-radius:10px;cursor:pointer;background:var(--surface2);transition:border-color .18s var(--ease-premium),background .18s var(--ease-premium),transform .18s var(--ease-premium);}
  .lens-row:active{transform:scale(.985);}
  .lens-row.sel{border-color:var(--accent);background:var(--accent-bg);}
  .lens-info{flex:1;}
  .lens-name{font-size:13px;font-weight:500;color:var(--text);margin-bottom:4px;}
  .lens-desc{font-size:11px;color:var(--dim);font-weight:300;line-height:1.45;}
  .lens-price{font-family:'Geist Mono',monospace;font-size:11px;color:var(--accent);}
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
  .frame-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;}
  .frame-tile{min-height:138px;padding:16px 12px;border:1px solid var(--border);border-radius:10px;cursor:pointer;background:var(--surface2);text-align:center;transition:border-color .18s var(--ease-premium),background .18s var(--ease-premium),box-shadow .18s var(--ease-premium),transform .18s var(--ease-premium);position:relative;}
  .frame-tile:active{transform:scale(.985);}
  .frame-tile:hover{border-color:var(--border2);}
  .frame-tile.sel{border-color:var(--accent);background:var(--accent-bg);box-shadow:0 0 0 1px rgba(76,175,125,.18) inset;}
  .frame-tile-icon{display:flex;justify-content:center;align-items:center;margin:8px 0 11px;min-height:28px;color:var(--dim);}
  .frame-tile-name{font-size:12px;font-weight:500;color:var(--text);margin-bottom:3px;}
  .frame-tile.sel .frame-tile-name{color:var(--text);}
  .frame-tile-desc{font-size:11px;color:var(--dim);font-weight:300;line-height:1.4;}
  .frame-fit-note{font-size:10px;color:var(--accent);font-family:'Geist Mono',monospace;line-height:1.35;margin-top:8px;}
  .best-badge{position:absolute;top:9px;right:9px;font-size:8px;padding:3px 7px;background:var(--accent);color:#07110b;border-radius:4px;font-family:'Geist Mono',monospace;letter-spacing:.06em;text-transform:uppercase;}
  .receipt{background:var(--surface2);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:18px;}
  .receipt-head{padding:13px 16px;border-bottom:1px solid var(--border);font-size:10px;font-family:'Geist Mono',monospace;color:var(--soft);letter-spacing:.08em;text-transform:uppercase;}
  .receipt-row{display:flex;justify-content:space-between;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid var(--border);font-size:12px;color:var(--dim);font-weight:300;}
  .receipt-total{display:flex;justify-content:space-between;align-items:center;padding:15px 16px;border-top:1px solid var(--border);font-size:15px;font-weight:500;color:var(--text);}
  .field{width:100%;min-height:46px;padding:12px 14px;background:var(--surface2);border:1px solid var(--border2);border-radius:9px;color:var(--text);font-size:16px;font-family:'Geist',sans-serif;outline:none;margin-bottom:8px;font-weight:300;transition:border-color .18s var(--ease-premium);-webkit-appearance:none;}
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
  .confirm-footer{margin-top:24px;font-size:11px;color:var(--soft);text-align:center;font-family:'Geist Mono',monospace;letter-spacing:.04em;}
  .processing-card{width:100%;padding:18px 16px;border:1px solid var(--border);border-radius:14px;background:var(--surface2);display:flex;flex-direction:column;align-items:center;gap:12px;margin-bottom:18px;}
  .processing-logo{font-size:16px;font-weight:500;color:var(--text);letter-spacing:-.02em;}
  .processing-copy{font-size:13px;color:var(--dim);font-weight:300;}
  .processing-track{width:100%;height:4px;border-radius:999px;background:var(--border);overflow:hidden;}
  .processing-fill{height:100%;width:100%;background:var(--accent);border-radius:999px;transform-origin:left center;animation:processFill 2s ease-in-out both;}
  @keyframes processFill{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  .verification-strip{width:100%;max-width:420px;margin:22px auto 0;border-top:1px solid var(--border);padding-top:12px;display:flex;flex-wrap:wrap;justify-content:center;gap:8px 14px;color:var(--soft);font-family:'Geist Mono',monospace;font-size:11px;line-height:1.45;text-transform:uppercase;letter-spacing:.06em;}
  .geo-footer{width:100%;max-width:420px;margin:24px auto 0;border-top:1px solid var(--border);padding-top:8px;}
  .geo-block{border-bottom:1px solid var(--border);}
  .geo-block summary{list-style:none;cursor:pointer;padding:12px 0;font-family:'Geist Mono',monospace;font-size:10px;color:var(--soft);letter-spacing:.08em;text-transform:uppercase;}
  .geo-block summary::-webkit-details-marker{display:none;}
  .geo-block summary::after{content:'+';float:right;color:var(--soft);}
  .geo-block[open] summary::after{content:'-';}
  .geo-content{padding:0 0 14px;font-size:12px;color:var(--dim);line-height:1.58;font-weight:300;}
  .geo-content p{margin-bottom:9px;}
  .geo-content p:last-child{margin-bottom:0;}
  .geo-content strong{color:var(--text);font-weight:400;}
  .debug-overlay{position:absolute;top:9px;left:9px;z-index:7;padding:8px 9px;border-radius:7px;background:rgba(0,0,0,.68);color:rgba(255,255,255,.78);font-family:'Geist Mono',monospace;font-size:9px;line-height:1.45;text-align:left;pointer-events:none;}
  @media (max-width:390px){
    .site-header{padding-left:14px;padding-right:14px;}
    .container{padding-left:14px;padding-right:14px;}
    .section{padding:20px 16px;border-radius:14px;}
    .display{font-size:31px;}
    .step-head{font-size:24px;}
    .lens-list,.frame-grid{gap:7px;}
    .lens-row{min-height:132px;padding:14px 12px;}
    .frame-tile{min-height:142px;padding-left:10px;padding-right:10px;}
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
  const lastMotionPtsRef = useRef(null);
  const stableWindowRef = useRef([]);
  const lockedSampleRef = useRef(null);
  const scanExtendedRef = useRef(false);
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
  const [cardStatus,   setCardStatus]   = useState({label:"Loading card detector",stablePct:0,reason:""});
  const [debugInfo,    setDebugInfo]    = useState(null);
  const [distanceHint, setDistanceHint] = useState(null);
  const [extraScanActive,setExtraScanActive] = useState(false);

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
    lastMotionPtsRef.current=null; stableWindowRef.current=[]; lockedSampleRef.current=null;
    scanExtendedRef.current=false; setExtraScanActive(false);
  },[]);

  const abortActiveScan=useCallback((reason="Lost your face — let's restart")=>{
    if (abortingRef.current) return;
    abortingRef.current=true;
    clearScanCanvas();
    setSeqIdx(-1); setFill(0); fillRef.current=0;
    setDone(false); setMeasurements(null); setQuality(null);
    setValidPct(0); setAutoStartPct(0); setPoseHint(null); setFacePresent(false); setDistanceHint(null);
    setDebugInfo(null);
    setCardStatus({label:cvReady?"Position card":"Loading card detector",stablePct:0,reason:"The whole front of the card should face the camera."});
    resetSampleState();
    cardStableRef.current=0; lastCardRef.current=null; cardLockedRef.current=false; cardStartedRef.current=null;
    holdRef.current=0; autoStarted.current=false;
    onScanAbort?.(reason);
    requestAnimationFrame(()=>{ abortingRef.current=false; });
  },[clearScanCanvas,cvReady,onScanAbort,resetSampleState]);

  useEffect(()=>{
    if (done) clearScanCanvas();
  },[clearScanCanvas,done]);

  const processCardFrame=useCallback(()=>{
    const video=videoRef.current, canvas=canvasRef.current;
    if (!canvas||!video) return;
    const W=video.videoWidth||640, H=video.videoHeight||480;
    canvas.width=W; canvas.height=H;
    const ctx=canvas.getContext("2d");
    ctx.clearRect(0,0,W,H);
    setFacePresent(false);
    setDistanceHint(null);
    setPoseHint(null);
    setAutoStartPct(0);

    if (!cardStartedRef.current) cardStartedRef.current=performance.now();
    const timedOut=performance.now()-cardStartedRef.current>CARD_FALLBACK_MS;
    if (cardLoadFailedRef.current||timedOut){
      cardLockedRef.current=true;
      setCardStatus({label:"Continuing without card",stablePct:0,reason:""});
      onCardSkipped?.();
      return;
    }
    if (!cvReady){
      setCardStatus({label:"Loading card detector",stablePct:0,reason:""});
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
      drawDetectedCard(ctx,detection,stablePct);
      const reason=!highConfidence?"The whole front of the card should face the camera.":!flatEnough?"Hold the card flatter.":"Hold still.";
      setCardStatus({label:stablePct>=1?"Scale locked":"Card detected",stablePct,reason,confidence:detection.confidence});
      if (stablePct>=1){
        cardLockedRef.current=true;
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
      setCardStatus({label:"Position card",stablePct:0,reason:"The whole front of the card should face the camera."});
    }
  },[canvasRef,cvReady,onCardLocked,onCardSkipped,videoRef]);

  useEffect(()=>{
    loadOpenCv().then(()=>setCvReady(true)).catch(()=>{
      cardLoadFailedRef.current=true;
      setCardStatus({label:"Continuing without card",stablePct:0,reason:""});
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
      setDistanceHint(null);
      if (!autoStarted.current) setAutoStartPct(0);
      if (scanningRef.current){
        totalRef.current++;
        faceLostRef.current++;
        poseLostRef.current++;
        markDiscard("no-face");
        if (totalRef.current%15===0) logScanDebug("sampling");
        if (faceLostRef.current>=FACE_ABORT_FRAMES||poseLostRef.current>=FACE_ABORT_FRAMES) abortActiveScan();
      }
      return;
    }

    setFacePresent(true);
    const lm=results.multiFaceLandmarks[0];
    const pts=lm.map(p=>({x:p.x*W,y:p.y*H}));
    const d=(a,b)=>Math.sqrt((pts[a].x-pts[b].x)**2+(pts[a].y-pts[b].y)**2);
    const pose=validatePose(lm);
    const iris=calcIrisMetrics(pts,d);
    const motion=calcFrameMotion(pts,lastMotionPtsRef.current);
    lastMotionPtsRef.current=pts;
    setDistanceHint(distanceCueFromIris(iris.avgDiam));
    const debugScale=(scaleRef.current || (iris.valid ? IRIS_MM / iris.avgDiam : null));
    setDebugInfo({
      lIrisPx:iris.lId?Number(iris.lId.toFixed(1)):null,
      rIrisPx:iris.rId?Number(iris.rId.toFixed(1)):null,
      scaleFactor:debugScale?Number(debugScale.toFixed(4)):null,
      rawPd:debugScale?Number((d(468,473)*debugScale).toFixed(1)):null,
      validFrames:validRef.current,
      totalFrames:totalRef.current,
      discarded:{...discardRef.current},
      scaleSource:scaleSourceRef.current,
    });
    const tiltHint=iris.valid&&iris.isTilted&&!autoStarted.current&&!scanningRef.current?"Level your head":null;
    setPoseHint(pose.valid?tiltHint:pose.reason);

    if (onAutoStart&&!autoStarted.current&&!scanningRef.current){
      pose.valid?holdRef.current++:(holdRef.current=Math.max(0,holdRef.current-2));
      const pct=Math.min(holdRef.current/HOLD_FRAMES,1);
      setAutoStartPct(pct);
      if (pct>=1){ autoStarted.current=true; onAutoStart?.(); }
    }

    if (scanningRef.current){
      totalRef.current++;
      facePresentFramesRef.current++;
      faceLostRef.current=0;
      if (!pose.valid){
        poseLostRef.current++;
        markDiscard("pose");
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
        ctx.beginPath(); ctx.arc(W-c.x,c.y,diam/2,0,Math.PI*2);
        ctx.strokeStyle=ink; ctx.lineWidth=1.5; ctx.stroke();
      });
      ctx.beginPath(); ctx.moveTo(W-pts[468].x,pts[468].y); ctx.lineTo(W-pts[473].x,pts[473].y);
      ctx.strokeStyle=ink; ctx.lineWidth=.75; ctx.setLineDash([3,4]); ctx.stroke(); ctx.setLineDash([]);
    }

    if (scanningRef.current){
      if (!iris.valid){
        markDiscard(iris.reason);
      } else {
        if (motion.ratio > MOTION_REJECT_RATIO) {
          markDiscard("motion");
          return;
        }
        const m=calcMeasurements(lm,W,H,scaleRef.current,scaleHistoryRef);
        if (m){
          const irisScore=clamp(1-(iris.irisDelta||0)/IRIS_MISMATCH_MAX,0,1);
          const tiltScore=iris.isTilted ? .55 : 1;
          const qualityScore=clamp(motion.score*.5+irisScore*.3+tiltScore*.2,0,1);
          if (qualityScore < .22) {
            markDiscard("quality");
            return;
          }
          const sample={
            ...m,
            sampleWeight:(m.sampleWeight||1)*(.45+qualityScore*.55),
            qualityScore:Number(qualityScore.toFixed(3)),
            motionRatio:Number(motion.ratio.toFixed(4)),
            scaleSource:scaleSourceRef.current,
          };
          samplesRef.current.push(sample);
          if (sample.qualityScore >= .55) {
            stableWindowRef.current=[...stableWindowRef.current,sample].slice(-LOCK_WINDOW_FRAMES);
            if (!lockedSampleRef.current&&stableWindowRef.current.length===LOCK_WINDOW_FRAMES) {
              const pds=stableWindowRef.current.map(x=>parseFloat(x.pd));
              const bridges=stableWindowRef.current.map(x=>parseFloat(x.bridge));
              const pdSpread=Math.max(...pds)-Math.min(...pds);
              const bridgeSpread=Math.max(...bridges)-Math.min(...bridges);
              if (pdSpread<=LOCK_PD_RANGE_MM&&bridgeSpread<=LOCK_BRIDGE_RANGE_MM) {
                lockedSampleRef.current=stableWindowRef.current
                  .slice()
                  .sort((a,b)=>(b.qualityScore||0)-(a.qualityScore||0))[0];
                fillRef.current=Math.max(fillRef.current,.92);
                setFill(fillRef.current);
                setQuality({label:"Clean scan",rescan:false,reason:"Stable frame locked."});
                setSeqIdx(i=>Math.max(i,SCAN_SEQ.length-1));
              }
            }
          }
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
          motion:Number(motion.ratio.toFixed(4)),
        });
      }
    }
  },[abortActiveScan,canvasRef,clearScanCanvas,logScanDebug,markDiscard,onAutoStart,videoRef]);

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
      } else if (needsCard&&v&&v.readyState>=2&&!cardLockedRef.current){
        processCardFrame();
      } else if (faceEnabled&&fmRef.current&&v&&v.readyState>=2&&!procRef.current){
        procRef.current=true;
        try { await fmRef.current.send({image:v}); } catch { /* frame processing can skip while MediaPipe warms up */ }
        procRef.current=false;
      }
      loopRef.current=requestAnimationFrame(loop);
    };
    loopRef.current=requestAnimationFrame(loop);
    return ()=>{ if(loopRef.current) cancelAnimationFrame(loopRef.current); };
  },[clearScanCanvas,faceEnabled,needsCard,processCardFrame,videoRef]);

  useEffect(()=>{
    if (scanning&&!done){
      abortingRef.current=false;
      resetSampleState();
      setSeqIdx(0);
    }
  },[done,resetSampleState,scanning]);

  useEffect(()=>{
    const activeSeq=extraScanActive?EXTENDED_SCAN_SEQ:SCAN_SEQ;
    if (seqIdx<0||seqIdx>=activeSeq.length) return;
    const step=activeSeq[seqIdx], start=fillRef.current, end=step.fill, t0=performance.now();
    let raf;
    const animate=now=>{
      const t=Math.min((now-t0)/step.holdMs,1);
      const v=start+(end-start)*t;
      fillRef.current=v; setFill(v);
      if (t<1){ raf=requestAnimationFrame(animate); }
      else if (seqIdx<activeSeq.length-1){ setSeqIdx(i=>i+1); }
      else {
        const s=samplesRef.current;
        const vp=totalRef.current>0?validRef.current/totalRef.current:0;
        const facePct=totalRef.current>0?facePresentFramesRef.current/totalRef.current:0;
        const posePct=totalRef.current>0?poseValidFramesRef.current/totalRef.current:0;
        setValidPct(Math.round(vp*100));
        const keepQualitySamples=(arr)=>{
          const keep=Math.max(MIN_VALID_SAMPLES,Math.ceil(arr.length*QUALITY_KEEP_RATIO));
          const byQuality=[...arr].sort((a,b)=>(b.qualityScore||0)-(a.qualityScore||0)).slice(0,keep);
          const sorted=[...byQuality].sort((a,b)=>parseFloat(a.pd)-parseFloat(b.pd));
          const trim=Math.floor(sorted.length*.15);
          return trim>0&&sorted.length>(trim*2+MIN_VALID_SAMPLES-1)
            ?sorted.slice(trim,sorted.length-trim)
            :sorted;
        };
        const weightedAverage=(arr,k)=>{
          const total=arr.reduce((sum,m)=>sum+parseFloat(m[k])*(m.sampleWeight||1),0);
          const weights=arr.reduce((sum,m)=>sum+(m.sampleWeight||1),0);
          return total/weights;
        };
        const weightedDeviation=(arr,k)=>{
          const mean=weightedAverage(arr,k);
          const weights=arr.reduce((sum,m)=>sum+(m.sampleWeight||1),0);
          const variance=arr.reduce((sum,m)=>sum+((parseFloat(m[k])-mean)**2)*(m.sampleWeight||1),0)/weights;
          return Math.sqrt(variance);
        };
        const preliminary=s.length>=MIN_VALID_SAMPLES?keepQualitySamples(s):[];
        if (!lockedSampleRef.current&&!scanExtendedRef.current&&preliminary.length>=MIN_VALID_SAMPLES) {
          const pdStd=weightedDeviation(preliminary,"pd");
          const bridgeStd=weightedDeviation(preliminary,"bridge");
          if (pdStd>HIGH_VARIANCE_PD_STD||bridgeStd>HIGH_VARIANCE_BRIDGE_STD) {
            scanExtendedRef.current=true;
            setExtraScanActive(true);
            setQuality({label:"Just a moment more",rescan:false,reason:"Collecting a few steadier frames."});
            setSeqIdx(SCAN_SEQ.length);
            return;
          }
        }
        setDone(true);
        clearScanCanvas();
        if (s.length<MIN_VALID_SAMPLES||facePct<FACE_PRESENT_MIN_RATIO||posePct<POSE_VALID_MIN_RATIO){
          setQuality({label:"No data captured",rescan:true,reason:"Lost your face — let's restart"});
          setMeasurements(null);
          logScanDebug("complete",{
            sampleCount:s.length,
            quality:"No data captured",
            facePct:Number(facePct.toFixed(2)),
            posePct:Number(posePct.toFixed(2)),
          });
        } else {
          const lockedSample=lockedSampleRef.current;
          const good=lockedSample?[lockedSample]:keepQualitySamples(s);
          const weightedAvg=k=>weightedAverage(good,k);
          const weightedStd=k=>lockedSample?0:weightedDeviation(good,k);
          const pd=weightedAvg("pd"),br=weightedAvg("bridge"),face=weightedAvg("faceW");
          const lMono=weightedAvg("pdLeft"),rMono=weightedAvg("pdRight");
          const monoSum=lMono+rMono;
          const directPdSane=pd>=PD_ADULT_MIN&&pd<=PD_ADULT_MAX;
          const monoSumSane=monoSum>=PD_ADULT_MIN&&monoSum<=PD_ADULT_MAX;
          const finalPd=Math.abs(monoSum-pd)>2&&monoSumSane?monoSum:pd;
          const pdStd=weightedStd("pd");
          const bridgeStd=weightedStd("bridge");
          const hardOutOfRange=!directPdSane&&!monoSumSane;
          const reviewRangeIssue=br<BRIDGE_MIN||br>BRIDGE_MAX||Math.abs(lMono-rMono)>MONOCULAR_SYMMETRY;
          setMeasurements({pd:finalPd.toFixed(1),pdLeft:lMono.toFixed(1),pdRight:rMono.toFixed(1),bridge:br.toFixed(1),temple:weightedAvg("temple").toFixed(0),lensH:weightedAvg("lensH").toFixed(1),faceW:face.toFixed(0),scaleSource:good[0]?.scaleSource||scaleSourceRef.current});
          const nextQuality=hardOutOfRange
            ?{label:"Out of range",rescan:false,reason:"The PD landed outside the frame-fitting range. Review before continuing."}
            :lockedSample
              ?{label:"Clean scan",rescan:false,reason:"Stable reference frame locked from matching frames."}
            :s.length<MIN_VALID_SAMPLES||vp<.25
              ?{label:"Double-check these",rescan:false,reason:"We captured a small sample. Double-check the numbers below."}
              :reviewRangeIssue||pdStd>4.5||bridgeStd>3
                ?{label:"Review your numbers",rescan:false,reason:"Usable scan with some movement. Review the numbers below."}
                :pdStd<=2.5&&bridgeStd<=1.8&&vp>=.6
                  ?{label:"Clean scan",rescan:false,reason:"The scan had steady tracking and enough usable frames."}
                  :{label:"Good scan",rescan:false,reason:"Usable scan. You can correct any known measurements below."};
          setQuality(nextQuality);
          logScanDebug("complete",{
            finalPd:Number(finalPd.toFixed(1)),
            pdStd:Number(pdStd.toFixed(2)),
            bridgeStd:Number(bridgeStd.toFixed(2)),
            sampleCount:s.length,
            averagedSamples:good.length,
            lockedReference:!!lockedSample,
            facePct:Number(facePct.toFixed(2)),
            posePct:Number(posePct.toFixed(2)),
            quality:nextQuality.label,
          });
        }
      }
    };
    raf=requestAnimationFrame(animate);
    return ()=>cancelAnimationFrame(raf);
  },[clearScanCanvas,extraScanActive,logScanDebug,seqIdx]);

  const reset=useCallback(()=>{
    setSeqIdx(-1); setFill(0); fillRef.current=0;
    setDone(false); setMeasurements(null); setQuality(null);
    setAutoStartPct(0); setFacePresent(false); setPoseHint(null); setDistanceHint(null); setDebugInfo(null);
    setCardStatus({label:cardLoadFailedRef.current?"Continuing without card":cvReady?"Find card outline":"Loading card detector",stablePct:0,reason:"The whole front of the card should face the camera."});
    resetSampleState();
    cardStableRef.current=0; lastCardRef.current=null; cardLockedRef.current=false; cardStartedRef.current=null;
    holdRef.current=0; autoStarted.current=false; abortingRef.current=false;
  },[cvReady,resetSampleState]);

  return {seqIdx,fill,done,measurements,mpReady,cvReady,autoStartPct,facePresent,poseHint,quality,validPct,cardStatus,distanceHint,debugInfo,reset};
}

// ─── FaceGuide ────────────────────────────────────────────────────────────────
function FaceGuide({fill,autoStartPct,facePresent,poseHint,showCard=false,done=false}){
  const VW=400,VH=300,cx=200,cy=150,rx=78,ry=108;
  const h=((rx-ry)/(rx+ry))**2;
  const circ=Math.PI*(rx+ry)*(1+(3*h)/(10+Math.sqrt(4-3*h)));
  const ovalPath=`M ${cx} ${cy-ry} A ${rx} ${ry} 0 1 1 ${cx} ${cy+ry} A ${rx} ${ry} 0 1 1 ${cx} ${cy-ry}`;
  const bo=facePresent?.62:.2;
  const activeFill=clamp(done?0:fill,0,1);
  return (
    <svg className="face-guide" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {!done&&autoStartPct>0&&autoStartPct<1&&(
        <ellipse cx={cx} cy={cy} rx={rx+11} ry={ry+11} fill="none"
          stroke="rgba(255,255,255,.1)" strokeWidth="2"
          strokeDasharray={`${autoStartPct*circ*1.1} 9999`}
          strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}/>
      )}
      <path d={ovalPath} fill="none"
        stroke={`rgba(255,255,255,${bo})`} strokeWidth="2" vectorEffect="non-scaling-stroke" style={{transition:"stroke .4s var(--ease-premium)"}}/>
      {activeFill>0&&<path d={ovalPath} fill="none" stroke="#4caf7d" strokeWidth="5"
        strokeDasharray={`${circ} ${circ}`} strokeDashoffset={circ*(1-activeFill)}
        strokeLinecap="round" strokeOpacity="1" vectorEffect="non-scaling-stroke" shapeRendering="geometricPrecision"
        style={{transition:"stroke-dashoffset .1s linear"}}/>}
      {poseHint&&<text x={cx} y={cy+ry+22} textAnchor="middle" fill="rgba(255,255,255,.72)"
        fontSize="13" fontFamily="'Geist',-apple-system,sans-serif" fontWeight="400">{poseHint}</text>}
      {!done&&showCard&&(
        <g opacity=".92">
          <rect x="90" y="205" width="220" height="139" rx="6" fill="rgba(0,0,0,.18)" stroke="#4caf7d" strokeWidth="2" strokeDasharray="7 6" style={{animation:"cardPulse 1.4s ease-in-out infinite"}}/>
          <text x="200" y="274" textAnchor="middle" fill="rgba(255,255,255,.82)"
            fontSize="11" fontFamily="'Geist Mono',monospace" letterSpacing="1">CARD</text>
        </g>
      )}
    </svg>
  );
}

function ScanSetupDiagram(){
  return (
    <div className="setup-diagram" aria-hidden="true">
      <svg viewBox="0 0 360 195" fill="none">
        <rect x="28" y="26" width="304" height="143" rx="16" stroke="rgba(242,240,232,.1)"/>
        <circle cx="180" cy="69" r="35" stroke="rgba(242,240,232,.72)" strokeWidth="2"/>
        <path d="M163 76c8 6 26 6 34 0" stroke="rgba(242,240,232,.5)" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M135 127c9-18 27-28 45-28s36 10 45 28" stroke="rgba(242,240,232,.34)" strokeWidth="2" strokeLinecap="round"/>
        <rect x="106" y="122" width="148" height="58" rx="7" fill="rgba(76,175,125,.06)" stroke="#4caf7d" strokeWidth="2.4"/>
        <path d="M121 140h118M121 153h74" stroke="rgba(76,175,125,.42)" strokeWidth="1.4" strokeLinecap="round"/>
        <path d="M180 104v18" stroke="#4caf7d" strokeWidth="2" strokeLinecap="round"/>
        <circle cx="180" cy="104" r="3" fill="#4caf7d"/>
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
          price:"89",
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

function Logo(){
  return <a className="logo" aria-label="About FitFrame" href="/about">fitframe<span className="logo-dot">.</span></a>;
}

function VerificationStrip(){
  return (
    <section className="verification-strip" aria-label="Verification">
      <span>American made</span>
      <span>Zero-waste to order</span>
      <span>One-time reprint guarantee</span>
    </section>
  );
}

function GeoFooter(){
  return (
    <footer className="geo-footer">
      <details className="geo-block">
        <summary>FAQ</summary>
        <div className="geo-content">
          {FITFRAME_FAQ.map(([q,a])=>(
            <p key={q}><strong>{q}</strong> {a}</p>
          ))}
        </div>
      </details>
      <details className="geo-block">
        <summary>About</summary>
        <div className="geo-content">
          <p>FitFrame started as a frustration with glasses that never fit right. Every pair built here is measured from your actual face, printed to those measurements, and shipped directly to you. No middleman, no standard sizing, no compromise. It's a small operation built on the belief that fit shouldn't be a luxury.</p>
        </div>
      </details>
    </footer>
  );
}

// Main ─────────────────────────────────────────────────────────────────────
export default function FramesSite(){
  useFitFrameJsonLd();
  const saved=loadSession()||{};

  const savedStep = Number.isInteger(saved.step) && saved.step >= 0 && saved.step <= 4 ? saved.step : 0;
  const [step,          setStep]          = useState(savedStep);
  const [confirmedMeas, setConfirmedMeas] = useState(saved.confirmedMeas??null);
  const [calibration,   setCalibration]   = useState(saved.calibration??null);
  const [styleAnswers,  setStyleAnswers]  = useState(saved.styleAnswers??{});
  const [styleQIdx,     setStyleQIdx]     = useState(saved.styleQIdx??0);
  const [tapped,        setTapped]        = useState(null);
  const [selectedFrame, setSelectedFrame] = useState(saved.selectedFrame??null);
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
  const [orderId]                         = useState(()=>saved.orderId??genOrderId());
  const [debugEnabled]                     = useState(()=>new URLSearchParams(window.location.search).get("debug")==="1");
  const scanHistorySavedRef                = useRef(false);
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
      source:"detected-card",
      cardWidthMm:card.cardWidthMm,
      cardHeightMm:card.cardHeightMm,
      cardWidthPx:card.cardWidthPx,
      cardHeightPx:card.cardHeightPx,
      mmPerPx:card.mmPerPx,
      confidence:card.confidence,
      corners:card.corners,
      timestamp:card.timestamp,
    });
    startSettledScan();
  },[startSettledScan]);
  const handleCardSkipped=useCallback(()=>{
    setCalibration({
      source:"iris-fallback",
      skippedCard:true,
      timestamp:new Date().toISOString(),
    });
    startSettledScan();
  },[startSettledScan]);
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
    setScanRestartCopy(message||"Lost your face — let's restart");
    scanHistorySavedRef.current=false;
  },[]);
  const scan=useFaceScan({
    videoRef,
    scanning,
    canvasRef,
    scaleMmPerPx:calibration?.mmPerPx||null,
    scaleSource:calibration?.source||"iris-fallback",
    needsCard:step===1&&camReady&&!cameraIntro&&!calibration&&!scanning,
    faceEnabled:step===1&&camReady&&!cameraIntro&&(!!calibration||scanning),
    debugScan:debugEnabled,
    onCardLocked:handleCardLocked,
    onCardSkipped:handleCardSkipped,
    onScanAbort:handleScanAbort,
  });
  const currentMeas=confirmedMeas||(scan.quality?.rescan?scan.measurements:null);

  // Persist
  useEffect(()=>{
    if (step===0||sent) return;
    saveSession({step,confirmedMeas,calibration,styleAnswers,styleQIdx,selectedFrame,customerInfo,orderId});
  },[step,sent,confirmedMeas,calibration,styleAnswers,styleQIdx,selectedFrame,customerInfo,orderId]);

  // Frame scoring
  const suggestedTags=Object.values(styleAnswers).flatMap(a=>a?.tags||[]);
  const geometryScore=(frame)=>{
    const m=currentMeas;
    if (!m) return {score:0,note:""};
    const faceW=parseFloat(m.faceW), pd=parseFloat(m.pd), bridge=parseFloat(m.bridge);
    let score=0;
    let note="Balanced fit";
    if (faceW>=145){
      if (["bold-square","navigator","round-thick","sporty-wrap"].includes(frame.id)) score+=2;
      if (["thin-round","rectangle"].includes(frame.id)) { score-=1; note="May sit narrow"; }
      else note="Width match";
    } else if (faceW&&faceW<=128){
      if (["thin-round","rectangle","cat-eye","geometric"].includes(frame.id)) score+=2;
      if (["bold-square","sporty-wrap","round-thick"].includes(frame.id)) { score-=1; note="May feel wide"; }
      else note="Compact fit";
    }
    if (bridge>=20&&["navigator","sporty-wrap","bold-square"].includes(frame.id)){ score+=1; note="Bridge fit strong"; }
    if (bridge&&bridge<=15&&["thin-round","rectangle","cat-eye"].includes(frame.id)){ score+=1; note="Bridge fit strong"; }
    if (pd>=66&&["bold-square","navigator","sporty-wrap","round-thick"].includes(frame.id)) score+=1;
    if (pd&&pd<=58&&["thin-round","rectangle","cat-eye"].includes(frame.id)) score+=1;
    return {score,note};
  };
  const topFrames=[...FRAMES].map(f=>{
    const styleScore=f.tags.filter(t=>suggestedTags.includes(t)).length;
    const fit=geometryScore(f);
    return {...f,score:styleScore+fit.score,styleScore,fitScore:fit.score,fitNote:fit.note};
  }).sort((a,b)=>b.score-a.score);
  const lensData=DEFAULT_LENS;
  const totalPrice=BASE_PRICE+(lensData?.price||0);
  const chosenFrame=FRAMES.find(f=>f.id===selectedFrame)||topFrames[0];

  useEffect(()=>{ if(step!==1) stopCamera(); },[step,stopCamera]);
  useEffect(()=>{ if(scan.done){ setScanning(false); setScanSettling(false); } },[scan.done]);
  useEffect(()=>{ setTapped(null); },[styleQIdx]);
  useEffect(()=>()=>{ 
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
  },[]);
  useEffect(()=>{
    requestAnimationFrame(()=>setIntroReady(true));
    const timer=setTimeout(()=>setIntroDone(true),780);
    return ()=>clearTimeout(timer);
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
    scan.reset();
    setScanning(false);
    setCameraIntro(false);
    scanHistorySavedRef.current=false;
    setScanPrepDismissed(false);
    setStep(1);
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
    setScanPrepDismissed(false);
    stopCamera();
  }

  function beginScanSetup(){
    setScanRestartCopy("");
    setScanPrepDismissed(true);
    setCameraIntro(true);
    startCamera();
  }

  function updateMeasurement(key,value){
    const cleaned=value.replace(/[^\d.]/g,"").replace(/(\..*)\./g,"$1");
    const range=MEASUREMENT_RANGES[key];
    let next=cleaned;
    if (range&&cleaned){
      const n=Number(cleaned);
      if (Number.isFinite(n)) next=String(clamp(n,range[0],range[1]));
    }
    setConfirmedMeas(prev=>({
      ...(prev||scan.measurements||{}),
      [key]:next,
      scaleSource:(prev||scan.measurements)?.scaleSource||"manual-review",
    }));
  }

  function buildMakerSpec(payload,{includeProductionNotes=true}={}){
    const lines=[
      "FITFRAME MAKER SPEC",
      "",
      `Order ID: ${payload.order_id}`,
      `Customer: ${payload.customer_name}`,
      `Customer email: ${payload.customer_email}`,
      `Created: ${payload.timestamp}`,
      "",
      "FRAME",
      `Style: ${payload.frame}`,
      `Frame ID: ${payload.frame_id}`,
      `Lens: ${payload.lens}`,
      `Material recommendation: ${payload.material}`,
      "",
      "MEASUREMENTS_MM",
      `Binocular PD: ${payload.pd_binocular}`,
      `Left PD: ${payload.pd_left}`,
      `Right PD: ${payload.pd_right}`,
      `Bridge: ${payload.bridge_mm}`,
      `Lens height: ${payload.lens_height_mm}`,
      `Face width: ${payload.face_width_mm}`,
      `Temple length: ${payload.temple_mm}`,
      "",
      "SCAN",
      `Scale source: ${payload.scale_source}`,
      `Card reference: ${payload.card_reference}`,
      `Quality: ${payload.scan_quality}`,
      `Valid frames: ${payload.valid_frames_pct}%`,
      "",
      "FIT_ANSWERS",
      `Fit history: ${payload.style_fit}`,
      `Visual instinct: ${payload.style_vibe}`,
      `Use case: ${payload.style_use}`,
      `Priority: ${payload.style_priority}`,
    ];
    if (includeProductionNotes) {
      lines.push(
        "",
        "PRODUCTION_NOTES",
        "Use the matching STL for the selected frame ID. Scale front geometry to face width, set bridge to measured bridge, keep adjustable nose pad allowance, and use PD to center optical openings. PA12 nylon is the default launch material.",
      );
    }
    return lines.join("\n");
  }

  async function submitOrder(){
    setSubmitting(true);
    const m=currentMeas;
    const payload={
      _replyto:customerInfo.email,
      _subject:`FitFrame Order ${orderId}`,
      order_id:orderId,
      customer_name:customerInfo.name,
      customer_email:customerInfo.email,
      timestamp:new Date().toISOString(),
      frame:chosenFrame?.label||"Custom frame",
      frame_id:chosenFrame?.id||"custom",
      lens:lensData?.label||"Blue Light",
      lens_price:lensData?.price||0,
      total:totalPrice,
      material:"PA12 nylon, matte finish, adjustable nose pads",
      style_fit:styleAnswers.fit?.label||"-",
      style_vibe:styleAnswers.vibe?.label||"-",
      style_use:styleAnswers.use?.label||"-",
      style_priority:styleAnswers.priority?.label||"-",
      pd_binocular:m?.pd||"-",
      pd_left:m?.pdLeft||"-",
      pd_right:m?.pdRight||"-",
      bridge_mm:m?.bridge||"-",
      temple_mm:m?.temple||"-",
      lens_height_mm:m?.lensH||"-",
      face_width_mm:m?.faceW||"-",
      scale_source:m?.scaleSource||"iris-fallback",
      card_reference:calibration?.source==="detected-card"?`${calibration.cardWidthMm}x${calibration.cardHeightMm}mm card / ${calibration.cardWidthPx}x${calibration.cardHeightPx}px / confidence ${calibration.confidence ?? "-"}`:calibration?.skippedCard?"skipped - iris reference only":"not captured",
      scan_quality:m?.scanQuality||scan.quality?.label||"-",
      valid_frames_pct:m?.validPct??(scan.validPct||"-"),
      user_agent:navigator.userAgent,
    };
    try {
      const spec=buildMakerSpec(payload);
      await navigator.clipboard?.writeText(spec).catch(()=>{});
      const subject=encodeURIComponent(`FitFrame Spec ${orderId}`);
      const fullBody=encodeURIComponent(spec);
      const emailSpec=fullBody.length>1800?buildMakerSpec(payload,{includeProductionNotes:false}):spec;
      const body=encodeURIComponent(emailSpec);
      window.location.assign(`mailto:${MAKER_EMAIL}?subject=${subject}&body=${body}`);
      clearSession();
      setSent(true);
    } catch { alert(`Email ${MAKER_EMAIL} and paste the copied spec.`); }
    finally { setSubmitting(false); }
  }

  const firstName=customerInfo.name.trim().split(" ")[0]||"there";
  const cameraActive=camReady||camRequesting;
  const showScanPrep=!scanPrepDismissed&&!scan.done&&!currentMeas&&!camErr&&!cameraActive;
  const extendingScan=scanning&&scan.quality?.label==="Just a moment more";
  const scanTitle=scanning
    ?extendingScan?"Just a moment more.":"Stay still."
    :scanProcessing
      ?"Scan complete."
    :scanSettling
      ?"Find your spot."
    :cameraIntro
      ?"Look straight ahead."
    :scan.done
      ?"Scan complete."
      :scanRestartCopy
        ?scanRestartCopy
      :showScanPrep
        ?"Take a quick calibrated face scan to begin."
      :camRequesting
        ?"Opening camera."
      :!camReady
          ?"Opening camera."
          :!calibration
            ?"Hold a credit card flat under your chin."
            :"Ready to measure.";
  const scanCopy=scanning
    ?""
    :scanProcessing
      ?""
    :scanSettling
      ?"Hold still for a second before measuring."
    :cameraIntro
      ?"Fill the oval with your face."
    :scan.done
      ?"Review the scan before continuing."
      :scanRestartCopy
        ?"The whole front of the card should face the camera."
      :showScanPrep
        ?""
      :camRequesting
        ?"Allow camera access to continue."
      :camReady&&!calibration
          ?"The whole front of the card should face the camera."
          :camReady
            ?calibration?.skippedCard
              ?"Continuing without card."
              :"Card reference saved. Keep your face in the oval and start the measurement."
            :"";

  return (
    <>
      <style>{css}</style>
      <div className={`app ${introReady?"app-ready":""} ${introDone?"intro-done":"intro-active"}`}>
        {!introDone&&<div className="intro-logo">fitframe<span className="logo-dot">.</span></div>}

        <header className="site-header">
          <Logo/>
        </header>

        <div className="container">

          {/* ── 0: Hero ── */}
          {step===0&&(
            <div className="section">
              <div className="eyebrow">Made-to-measure eyewear</div>
              <div className="display">Frames built<br/>for <em>your</em> face.</div>
              <p className="body-lg">A calibrated phone scan, four quick answers, and a frame spec ready for 3D printing. No app. No optician visit.</p>
              <div className="btn-row">
                <button className="btn btn-primary" onClick={startFreshScan}>Start fit scan</button>
              </div>
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
                  <div className="pre-scan-line">Two things first.</div>
                  <ScanSetupDiagram/>
                  <div className="setup-list">
                    <div>A credit card held under your chin.</div>
                    <div>Good overhead light.</div>
                  </div>
                  <button className="btn btn-primary" style={{alignSelf:"stretch",width:"100%",marginTop:4}} onClick={beginScanSetup}>I'm ready</button>
                  <div className="privacy-inline"><Padlock/><span>Scan stays on this device.</span></div>
                </div>
              )}

              {cameraActive&&!scan.done&&(
                <div className={`cam-outer ${scan.distanceHint?.tone==="good"?"distance-good":scan.distanceHint?.tone==="bad"?"distance-bad":""}`}>
                  <div className="cam-inner">
                    <video ref={videoRef} autoPlay playsInline muted/>
                    <canvas ref={canvasRef}/>
                    <div className="cam-vignette"/>
                    <FaceGuide fill={scan.fill} autoStartPct={scan.autoStartPct} facePresent={scan.facePresent} poseHint={!scanning&&!scanSettling?scan.poseHint:null} showCard={!calibration&&!scanning&&!scanSettling} done={scan.done}/>
                    {cameraIntro&&(
                      <div className="face-intro">
                        <div className="face-intro-main">Look straight ahead</div>
                        <div className="face-intro-sub">Fill the oval with your face</div>
                      </div>
                    )}
                    {scanSettling&&(
                      <div className="settle-intro">
                        <div className="settle-intro-main">Find your spot</div>
                      </div>
                    )}
                    {scan.distanceHint&&scan.facePresent&&!cameraIntro&&(
                      <div className={`distance-pill ${scan.distanceHint.tone}`}>{scan.distanceHint.label}</div>
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
                      {scanning
                        ?<div className="scan-inst">{extendingScan?"Just a moment more":"Hold steady"}</div>
                        :scanSettling
                          ?<div className="scan-inst">Find your spot</div>
                        :!calibration
                          ?<div className="scan-inst">{scan.cardStatus?.label==="Scale locked"?"Scale locked.":scan.cardStatus?.reason||"The whole front of the card should face the camera."}</div>
                          :scan.poseHint
                          ?<div className="scan-inst" style={{color:"#C49A2E"}}>{scan.poseHint}</div>
                          :scan.autoStartPct>0&&scan.autoStartPct<1
                            ?<div className="scan-inst">Hold still...</div>
                            :<div className="scan-inst">Look directly at the camera.</div>}
                    </div>
                  </div>
                </div>
              )}

              {step===1&&camReady&&scan.done&&<canvas ref={canvasRef} style={{display:"none"}}/>}

              {scanProcessing&&(
                <div className="processing-card">
                  <div className="processing-logo">fitframe<span className="logo-dot">.</span></div>
                  <div className="processing-copy">Analyzing measurements</div>
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

              {camReady&&!scan.done&&!scanning&&(
                <div style={{textAlign:"center",marginTop:14}}>
                  {!calibration?(
                    <>
                      {scan.cardStatus?.label==="Scale locked"
                        ?<div className="scale-lock">Scale locked.</div>
                        :<div className="calibration-strip">
                          <span>{scan.cardStatus?.label||"Position card"}</span>
                          {scan.cardStatus?.stablePct>0&&<strong>{Math.round(scan.cardStatus.stablePct*100)}%</strong>}
                        </div>}
                    </>
                  ):(
                    <>
                      <div className="calibration-strip"><span>Scale</span><strong>{calibration.skippedCard?"Continuing without card":"locked from card"}</strong></div>
                      <button className="btn btn-primary" disabled={!scan.mpReady||!scan.facePresent||scanSettling} onClick={startSettledScan}>
                        {scan.mpReady?scan.facePresent?"Start measurement":"Find your face first":"Loading..."}
                      </button>
                    </>
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
                    <button className="btn btn-ghost" onClick={acceptMeasurements}>Use these measurements &rarr;</button>
                  </div>
                </div>
              )}

              {(scan.done||confirmedMeas)&&currentMeas&&!scanProcessing&&!scan.quality?.rescan&&(
                <div className="quality-card">
                  <div className="quality-head">
                    <div className="quality-title">Measurement review</div>
                    <div className={`quality-pill ${scan.quality?.rescan?"bad":""}`}>{currentMeas.scanQuality||scan.quality?.label||"Review"}</div>
                  </div>
                  <p className="quality-copy">
                    {currentMeas.scanReason||scan.quality?.reason||"Review the measured spec before continuing."} Valid frames: {currentMeas.validPct??scan.validPct}%.
                  </p>
                  <div className="measure-grid">
                    {[
                      ["PD","pd"],["Left PD","pdLeft"],["Right PD","pdRight"],
                      ["Bridge","bridge"],["Face width","faceW"],["Temple","temple"],["Lens height","lensH"],
                    ].map(([label,key])=>(
                      <div className="measure-field" key={key}>
                        <label>{label}</label>
                        <input className="measure-input" inputMode="decimal" value={currentMeas[key]||""}
                          onChange={e=>updateMeasurement(key,e.target.value)}/>
                      </div>
                    ))}
                  </div>
                  <div className="measure-help">If the user already knows a measurement, correct it here. These values are what the maker receives.</div>
                  <div className="btn-row">
                    <button className="btn btn-primary" onClick={acceptMeasurements}>Use these measurements &rarr;</button>
                    <button className="btn btn-ghost" onClick={rescan}>Rescan</button>
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
              <div className="eyebrow">Frame</div>
              <div className="step-head">Pick your shape.</div>
              <p className="step-sub">Your top match is highlighted based on your answers. Choose the one that feels right.</p>
              <div className="vto-note">
                <div className="vto-note-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <div className="vto-note-text"><strong>Virtual try-on coming soon.</strong> Select the shape that matches your style for now.</div>
              </div>
              <div className="frame-grid">
                {topFrames.map((f,i)=>(
                  <div key={f.id} className={`frame-tile ${selectedFrame?selectedFrame===f.id?"sel":"":i===0?"sel":""}`}
                    onClick={()=>setSelectedFrame(f.id)}>
                    {i===0&&<div className="best-badge">best match</div>}
                    <div className="frame-tile-icon">
                      <FrameSVG id={f.id} size={52}
                        color={(selectedFrame?selectedFrame===f.id:i===0)?"var(--accent)":"var(--border2)"}/>
                    </div>
                    <div className="frame-tile-name">{f.label}</div>
                    <div className="frame-tile-desc">{f.desc}</div>
                    {currentMeas&&<div className="frame-fit-note">{f.fitNote}</div>}
                  </div>
                ))}
              </div>
              <div className="btn-row" style={{marginTop:8}}>
                <button className="btn btn-primary" onClick={()=>{if(!selectedFrame)setSelectedFrame(topFrames[0]?.id);setStep(4);}}>
                  Review my spec
                </button>
                <button className="btn btn-ghost" onClick={()=>setStep(2)}>Back</button>
              </div>
            </div>
          )}

          {/* Send spec */}
          {step===4&&!sent&&(
            <div className="section">
              <div className="eyebrow">Send</div>
              <div className="step-head">Send your maker spec.</div>
              <p className="step-sub">Your calibrated measurements and frame choice are ready. This opens a pre-filled email to the maker.</p>
              <div className="receipt">
                <div className="receipt-head">Spec summary - {orderId}</div>
                <div className="receipt-row"><span>Custom frame - {chosenFrame?.label}</span><span>${BASE_PRICE}</span></div>
                {lensData&&<div className="receipt-row"><span>{lensData.label} lenses</span><span>{lensData.price===0?"Included":`+$${lensData.price}`}</span></div>}
                <div className="receipt-total"><span>Total</span><span>${totalPrice}</span></div>
              </div>
              <input className="field" placeholder="Full name" autoComplete="name"
                value={customerInfo.name} onChange={e=>setCustomerInfo(p=>({...p,name:e.target.value}))}/>
              <input className="field" placeholder="Email address" type="email" autoComplete="email"
                value={customerInfo.email} onChange={e=>setCustomerInfo(p=>({...p,email:e.target.value}))}/>
              <div className="btn-row" style={{marginTop:10}}>
                <button className="btn btn-accent"
                  disabled={!customerInfo.name.trim()||!customerInfo.email.trim()||submitting}
                  onClick={submitOrder}>
                  {submitting?"Opening...":"Open email to send"}
                </button>
                <button className="btn btn-ghost" onClick={()=>setStep(3)}>Back</button>
              </div>
              <div className="trust-line"><Padlock/><span>No images are sent. The maker receives measurements only.</span></div>
            </div>
          )}

          {/* ── Confirmation ── */}
          {sent&&(
            <div className="section">
              <div className="confirm-id">{orderId}</div>
              <div className="confirm-greeting">Spec ready,<br/>{firstName}.</div>
              <p className="confirm-body">
                Your maker email opened with the full frame spec. Tap send in your mail app so it reaches <strong>{MAKER_EMAIL}</strong>.
              </p>
              <div className="next-steps">
                {[
                  ["01","Send the email","Your spec is also copied to your clipboard as a backup."],
                  ["02","We confirm details","You'll hear back within 24 hours with payment and shipping next steps."],
                  ["03","We print your frames",`Estimated delivery target: ${getETA()}.`],
                ].map(([n,label,desc])=>(
                  <div className="next-step" key={n}>
                    <span className="next-step-num">{n}</span>
                    <div>
                      <div className="next-step-label">{label}</div>
                      <div className="next-step-desc">{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="confirm-footer">{orderId} - {DOMAIN_HOST} {/* LOCKED: fitframe.store */}</div>
            </div>
          )}

          <VerificationStrip/>
          <GeoFooter/>

        </div>
        <div style={{height:60}}/>
      </div>
    </>
  );
}
