import { useState, useRef, useEffect, useCallback } from "react";

// ─── Config ───────────────────────────────────────────────────────────────────
const MAKER_EMAIL = "hello@fitframe.store";
const BASE_PRICE  = 89;

// ─── localStorage persistence ─────────────────────────────────────────────────
const STORE_KEY = "fitframe_session_v1";
function saveSession(data) { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* storage can be unavailable in private mode */ } }
function loadSession()     { try { const r = localStorage.getItem(STORE_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function clearSession()    { try { localStorage.removeItem(STORE_KEY); } catch { /* storage can be unavailable in private mode */ } }

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

// ─── Pose validation ──────────────────────────────────────────────────────────
function validatePose(lm) {
  const nx = lm[1].x, ny = lm[1].y;
  if (nx < 0.10 || nx > 0.90) return { valid:false, reason:"Center your face" };
  if (ny < 0.08 || ny > 0.92) return { valid:false, reason:"Center your face" };
  return { valid:true, reason:null };
}

// ─── Measurement math ─────────────────────────────────────────────────────────
const IRIS_MM = 11.8;          // HVID mean, clinical slit lamp reference
const IRIS_SD = 0.5;           // +/-1 SD - acceptable iris diameter range: 10.8-12.8mm
const IRIS_MIN_PX = 18;        // Below this, iris is too small to measure reliably
const IRIS_MAX_PX = 80;        // Above this, face is too close and landmarks compress
const PD_ADULT_MIN = 52.0;     // Adult binocular PD clinical minimum
const PD_ADULT_MAX = 80.0;     // Adult binocular PD clinical maximum
const BRIDGE_MIN = 10.0;       // Minimum human bridge width
const BRIDGE_MAX = 28.0;       // Maximum human bridge width
const MONOCULAR_SYMMETRY = 2.5;// Max acceptable left/right monocular PD difference
const TILT_THRESHOLD = 0.08;   // Iris center Y difference as a fraction of face height
const MIN_VALID_SAMPLES = 8;   // Minimum frames required before reporting measurements
const SCALE_HISTORY_FRAMES = 10;
const CREDIT_CARD_WIDTH_MM = 85.6;
const CREDIT_CARD_HEIGHT_MM = 54;
const CARD_ASPECT = CREDIT_CARD_WIDTH_MM / CREDIT_CARD_HEIGHT_MM;
const CARD_STABLE_FRAMES = 10;
const CARD_MAX_ROTATION_DEG = 14;
const CARD_MIN_CONFIDENCE = 0.72;
const OPENCV_URL = "https://docs.opencv.org/4.9.0/opencv.js";
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
      else if (performance.now()-started>10000) reject(new Error("OpenCV failed to load"));
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

  const roiX=Math.round(W*.08), roiY=Math.round(H*.38), roiW=Math.round(W*.84), roiH=Math.round(H*.58);
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
  if (irisDelta > 0.15) return {valid:false,lId,rId,avgDiam,irisDelta,reason:"iris-mismatch"};
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
  { instruction:"",                   holdMs:1500, fill:0.08 },
  { instruction:"Keep eyes forward.", holdMs:3000, fill:0.35 },
  { instruction:"Almost there.",      holdMs:3000, fill:0.65 },
  { instruction:"Nearly done.",       holdMs:2500, fill:0.88 },
  { instruction:"",                   holdMs:1500, fill:1.00 },
];
const SCAN_DURATION_SECONDS_PLACEHOLDER = 12;

// ─── CSS ──────────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@300;400;500&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  :root{
    --bg:#0d0d0d;--bg2:#11110f;--surface:#161615;--surface2:#1d1d1b;--panel:#141413;
    --border:#2b2b28;--border2:#3a3a35;--text:#f2f0e8;--mid:#b0ada2;--dim:#858176;--soft:#555249;
    --accent:#4caf7d;--accent2:#73d7a0;--accent-bg:#0d2117;--red:#ff5a52;--amber:#e5a64a;--scan:#030303;
  }
  html,body{height:100%;}
  html{background:var(--bg);}
  body{background:radial-gradient(circle at 50% -18%,rgba(76,175,125,.12),transparent 34%),linear-gradient(180deg,var(--bg2),var(--bg));color:var(--text);font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;overscroll-behavior:none;}
  button,input{-webkit-tap-highlight-color:transparent;}
  a{color:inherit;text-decoration:none;}
  .app{min-height:100dvh;display:flex;flex-direction:column;align-items:center;padding-bottom:calc(env(safe-area-inset-bottom,0px) + 28px);}
  .site-header{width:100%;max-width:462px;padding:22px 18px 0;display:flex;align-items:center;justify-content:flex-start;}
  .logo{font-size:15px;font-weight:500;color:var(--text);letter-spacing:-.02em;line-height:1;cursor:pointer;}
  .logo:hover{color:#fff;}
  .logo-dot{color:var(--accent);}
  .container{width:100%;max-width:462px;padding:0 18px;}
  .section{margin-top:20px;padding:22px 18px;background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,.01));border:1px solid var(--border);border-radius:8px;box-shadow:0 18px 60px rgba(0,0,0,.25);animation:fu .34s cubic-bezier(.4,0,.2,1) both;}
  @keyframes fu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
  .eyebrow{font-size:10px;font-family:'Geist Mono',monospace;color:var(--dim);letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;}
  .display{font-size:34px;font-weight:600;color:var(--text);letter-spacing:-.04em;line-height:1.02;margin-bottom:12px;max-width:330px;}
  .display em{font-style:normal;color:var(--accent);}
  .step-head{font-size:26px;font-weight:600;color:var(--text);letter-spacing:-.035em;line-height:1.08;margin-bottom:6px;}
  .body-lg{font-size:14px;color:var(--dim);line-height:1.62;font-weight:300;margin-bottom:24px;max-width:360px;}
  .step-sub{font-size:13px;color:var(--dim);line-height:1.6;font-weight:300;margin-bottom:18px;}
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
  .cam-inner video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);}
  .cam-inner canvas{position:absolute;inset:0;width:100%;height:100%;transform:scaleX(-1);pointer-events:none;}
  .cam-vignette{position:absolute;inset:0;pointer-events:none;z-index:2;background:radial-gradient(ellipse at center,transparent 54%,rgba(0,0,0,.34) 100%);}
  .cam-bottom{position:absolute;bottom:0;left:0;right:0;z-index:3;padding:28px 16px 15px;background:linear-gradient(transparent,rgba(0,0,0,.68));display:flex;flex-direction:column;align-items:center;gap:4px;}
  @keyframes cardPulse{0%,100%{opacity:.74;filter:drop-shadow(0 0 4px rgba(76,175,125,.35));}50%{opacity:1;filter:drop-shadow(0 0 14px rgba(76,175,125,.72));}}
  @keyframes lockIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
  .scan-inst{font-size:15px;font-weight:500;color:rgba(255,255,255,.92);letter-spacing:-.01em;text-align:center;}
  .scale-lock{font-size:12px;color:var(--accent);font-family:'Geist Mono',monospace;text-transform:uppercase;letter-spacing:.06em;animation:lockIn .28s ease both;}
  .scan-note{font-size:12px;color:var(--dim);line-height:1.55;text-align:center;margin:-4px auto 16px;max-width:310px;font-weight:300;}
  .calibration-strip{display:flex;align-items:center;justify-content:center;gap:8px;margin:0 auto 14px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface2);font-size:11px;color:var(--dim);}
  .calibration-strip strong{color:var(--accent);font-weight:500;}
  .cam-placeholder{width:100%;min-height:260px;border-radius:12px;background:var(--surface2);border:1px dashed var(--border2);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:28px 24px;margin-bottom:18px;text-align:center;}
  .pre-scan-card{align-items:flex-start;text-align:left;border-style:solid;gap:13px;}
  .pre-scan-line{font-size:13px;color:var(--text);font-weight:400;line-height:1.45;}
  .pre-scan-support{font-size:12px;color:var(--dim);font-weight:300;line-height:1.5;}
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
  .lens-list{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:22px;}
  .lens-row{min-height:126px;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;gap:12px;padding:15px 14px;border:1px solid var(--border);border-radius:10px;cursor:pointer;background:var(--surface2);transition:border-color .12s,background .12s,transform .12s;}
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
  .frame-tile{min-height:138px;padding:16px 12px;border:1px solid var(--border);border-radius:10px;cursor:pointer;background:var(--surface2);text-align:center;transition:border-color .14s,background .14s,box-shadow .14s,transform .12s;position:relative;}
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
  .confirm-footer{margin-top:24px;font-size:11px;color:var(--soft);text-align:center;font-family:'Geist Mono',monospace;letter-spacing:.04em;}
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
  @media (max-width:390px){
    .site-header{padding-left:14px;padding-right:14px;}
    .container{padding-left:14px;padding-right:14px;}
    .section{padding:20px 16px;border-radius:8px;}
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
function useFaceScan({ videoRef, scanning, canvasRef, scaleMmPerPx=null, scaleSource="iris-fallback", needsCard=false, onCardLocked, onAutoStart }) {
  const fmRef          = useRef(null);
  const workCanvasRef  = useRef(null);
  const [mpReady,      setMpReady]      = useState(false);
  const [cvReady,      setCvReady]      = useState(false);
  const samplesRef     = useRef([]);
  const scaleHistoryRef= useRef([]);
  const noseXRef       = useRef([]);
  const validRef       = useRef(0);
  const totalRef       = useRef(0);
  const cardStableRef  = useRef(0);
  const lastCardRef    = useRef(null);
  const cardLockedRef  = useRef(false);
  const loopRef        = useRef(null);
  const procRef        = useRef(false);
  const scanningRef    = useRef(false);
  const scaleRef       = useRef(scaleMmPerPx);
  const scaleSourceRef = useRef(scaleSource);
  const holdRef        = useRef(0);
  const autoStarted    = useRef(false);
  const fillRef        = useRef(0);

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

  useEffect(()=>{ scanningRef.current=scanning; },[scanning]);
  useEffect(()=>{ scaleRef.current=scaleMmPerPx; scaleSourceRef.current=scaleSource; },[scaleMmPerPx,scaleSource]);

  useEffect(()=>{
    loadOpenCv().then(()=>setCvReady(true)).catch(()=>setCardStatus({label:"Card detector unavailable",stablePct:0,reason:"Refresh and try again."}));
  },[]);

  const handleResults=useCallback((results)=>{
    const video=videoRef.current, canvas=canvasRef.current;
    if (!canvas||!video) return;
    const W=video.videoWidth||640, H=video.videoHeight||480;
    canvas.width=W; canvas.height=H;
    const ctx=canvas.getContext("2d");
    ctx.clearRect(0,0,W,H);

    if (!results.multiFaceLandmarks?.length){
      holdRef.current=0; setFacePresent(false); setPoseHint(null);
      if (!autoStarted.current) setAutoStartPct(0);
      return;
    }

    setFacePresent(true);
    const lm=results.multiFaceLandmarks[0];
    const pts=lm.map(p=>({x:p.x*W,y:p.y*H}));
    const d=(a,b)=>Math.sqrt((pts[a].x-pts[b].x)**2+(pts[a].y-pts[b].y)**2);
    const pose=validatePose(lm);
    const iris=calcIrisMetrics(pts,d);
    const tiltHint=iris.valid&&iris.isTilted&&!autoStarted.current&&!scanningRef.current?"Level your head":null;
    setPoseHint(pose.valid?tiltHint:pose.reason);

    if (onAutoStart&&!autoStarted.current&&!scanningRef.current){
      pose.valid?holdRef.current++:(holdRef.current=Math.max(0,holdRef.current-2));
      const pct=Math.min(holdRef.current/HOLD_FRAMES,1);
      setAutoStartPct(pct);
      if (pct>=1){ autoStarted.current=true; onAutoStart?.(); }
    }

    const lId=iris.lId||0;
    const rId=iris.rId||0;
    const ink=pose.valid?"#4caf7d":"rgba(255,255,255,.22)";
    [[pts[468],lId],[pts[473],rId]].forEach(([c,diam])=>{
      ctx.beginPath(); ctx.arc(c.x,c.y,diam/2,0,Math.PI*2);
      ctx.strokeStyle=ink; ctx.lineWidth=1.5; ctx.stroke();
    });
    ctx.beginPath(); ctx.moveTo(pts[468].x,pts[468].y); ctx.lineTo(pts[473].x,pts[473].y);
    ctx.strokeStyle=ink; ctx.lineWidth=.75; ctx.setLineDash([3,4]); ctx.stroke(); ctx.setLineDash([]);

    if (needsCard&&!scanningRef.current&&!cardLockedRef.current){
      if (!cvReady){
        setCardStatus({label:"Loading card detector",stablePct:0,reason:""});
      } else {
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
          const reason=!highConfidence?"Show all four card corners.":!flatEnough?"Hold the card flatter.":"Hold still.";
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
          setCardStatus({label:"Find card outline",stablePct:0,reason:"Show the full card edge under your face."});
        }
      }
    }

    if (scanningRef.current&&pose.valid){
      totalRef.current++;
      const m=calcMeasurements(lm,W,H,scaleRef.current,scaleHistoryRef);
      if (m){ samplesRef.current.push({...m,scaleSource:scaleSourceRef.current}); noseXRef.current.push(lm[1].x); validRef.current++; }
    } else if (scanningRef.current) totalRef.current++;
  },[canvasRef,cvReady,needsCard,onAutoStart,onCardLocked,videoRef]);

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
      if (fmRef.current&&v&&v.readyState>=2&&!procRef.current){
        procRef.current=true;
        try { await fmRef.current.send({image:v}); } catch { /* frame processing can skip while MediaPipe warms up */ }
        procRef.current=false;
      }
      loopRef.current=requestAnimationFrame(loop);
    };
    loopRef.current=requestAnimationFrame(loop);
    return ()=>{ if(loopRef.current) cancelAnimationFrame(loopRef.current); };
  },[videoRef]);

  useEffect(()=>{
    if (scanning&&!done){
      samplesRef.current=[]; noseXRef.current=[];
      scaleHistoryRef.current=[];
      validRef.current=0; totalRef.current=0;
      setSeqIdx(0);
    }
  },[done,scanning]);

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
        const s=samplesRef.current;
        const vp=totalRef.current>0?validRef.current/totalRef.current:0;
        setValidPct(Math.round(vp*100));
        if (s.length>=MIN_VALID_SAMPLES){
          const sorted=[...s].sort((a,b)=>parseFloat(a.pd)-parseFloat(b.pd));
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
          const finalPd=Math.abs(monoSum-pd)>2?monoSum:pd;
          const sane=finalPd>=PD_ADULT_MIN&&finalPd<=PD_ADULT_MAX&&br>=BRIDGE_MIN&&br<=BRIDGE_MAX&&Math.abs(lMono-rMono)<=MONOCULAR_SYMMETRY;
          const stable=weightedStd("pd")<=1.2&&weightedStd("bridge")<=1.0;
          setMeasurements({pd:finalPd.toFixed(1),pdLeft:lMono.toFixed(1),pdRight:rMono.toFixed(1),bridge:br.toFixed(1),temple:weightedAvg("temple").toFixed(0),lensH:weightedAvg("lensH").toFixed(1),faceW:face.toFixed(0),scaleSource:s[0]?.scaleSource||scaleSourceRef.current});
          setQuality(!sane
            ?{label:"Out of range",rescan:true,reason:"The scan landed outside normal eyewear ranges."}
            :!stable
              ?{label:"Unstable",rescan:true,reason:"The measurements moved too much between frames."}
              :vp>=.7
                ?{label:"Excellent",rescan:false,reason:"Stable face tracking and enough clean frames."}
                :vp>=.5
                  ?{label:"Good",rescan:false,reason:"Usable scan. You can correct any known measurements below."}
                  :vp>=.3
                    ?{label:"Fair",rescan:false,reason:"Usable with caution. Correct known measurements if you have them."}
                    :{label:"Low",rescan:true,reason:"Not enough clean frames to trust the measurements."});
        } else { setQuality({label:"Move to better light and hold still.",rescan:true,reason:"Move to better light and hold still."}); setMeasurements(null); }
      }
    };
    raf=requestAnimationFrame(animate);
    return ()=>cancelAnimationFrame(raf);
  },[seqIdx]);

  const reset=useCallback(()=>{
    setSeqIdx(-1); setFill(0); fillRef.current=0;
    setDone(false); setMeasurements(null); setQuality(null);
    setAutoStartPct(0); setFacePresent(false); setPoseHint(null);
    setCardStatus({label:cvReady?"Find card outline":"Loading card detector",stablePct:0,reason:""});
    samplesRef.current=[]; noseXRef.current=[]; scaleHistoryRef.current=[];
    validRef.current=0; totalRef.current=0;
    cardStableRef.current=0; lastCardRef.current=null; cardLockedRef.current=false;
    holdRef.current=0; autoStarted.current=false;
  },[cvReady]);

  return {seqIdx,fill,done,measurements,mpReady,cvReady,autoStartPct,facePresent,poseHint,quality,validPct,cardStatus,reset};
}

// ─── FaceGuide ────────────────────────────────────────────────────────────────
function FaceGuide({fill,autoStartPct,facePresent,poseHint,showCard=false}){
  const VW=400,VH=300,cx=200,cy=150,rx=78,ry=108;
  const h=((rx-ry)/(rx+ry))**2;
  const circ=Math.PI*(rx+ry)*(1+(3*h)/(10+Math.sqrt(4-3*h)));
  const bo=facePresent?.62:.2;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid slice"
      style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:2}}>
      {autoStartPct>0&&autoStartPct<1&&(
        <ellipse cx={cx} cy={cy} rx={rx+11} ry={ry+11} fill="none"
          stroke="rgba(255,255,255,.1)" strokeWidth="2"
          strokeDasharray={`${autoStartPct*circ*1.1} 9999`}
          strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}/>
      )}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none"
        stroke={`rgba(255,255,255,${bo})`} strokeWidth="2" style={{transition:"stroke .4s ease"}}/>
      {fill>0&&<ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="#4caf7d" strokeWidth="3"
        strokeDasharray={`${circ*Math.min(fill,1)} ${circ+10}`}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} style={{transition:"stroke-dasharray .1s linear"}}/>}
      {poseHint&&<text x={cx} y={cy+ry+22} textAnchor="middle" fill="rgba(255,255,255,.72)"
        fontSize="13" fontFamily="'Geist',-apple-system,sans-serif" fontWeight="400">{poseHint}</text>}
      {showCard&&(
        <g opacity=".92">
          <rect x="90" y="205" width="220" height="139" rx="6" fill="rgba(0,0,0,.18)" stroke="#4caf7d" strokeWidth="2" strokeDasharray="7 6" style={{animation:"cardPulse 1.4s ease-in-out infinite"}}/>
          <text x="200" y="274" textAnchor="middle" fill="rgba(255,255,255,.82)"
            fontSize="11" fontFamily="'Geist Mono',monospace" letterSpacing="1">CARD</text>
        </g>
      )}
    </svg>
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
        url:"https://fitframe.store",
        audience:{
          "@type":"PeopleAudience",
          audienceType:"people who have never found glasses that fit",
        },
        offers:{
          "@type":"Offer",
          price:"89",
          priceCurrency:"USD",
          availability:"https://schema.org/InStock",
          url:"https://fitframe.store",
        },
      },
      {
        "@context":"https://schema.org",
        "@type":"WebSite",
        url:"https://fitframe.store",
        potentialAction:{
          "@type":"SearchAction",
          target:"https://fitframe.store/?q={search_term_string}",
          "query-input":"required name=search_term_string",
        },
      },
    ]);
    document.head.appendChild(script);
    return ()=>script.remove();
  },[]);
}

function Logo({className="",href="/about-us"}){
  const navigate=e=>{
    if (e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0) return;
    e.preventDefault();
    window.history.pushState({}, "", href);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo(0,0);
  };
  return <a className={`logo ${className}`.trim()} href={href} aria-label="About FitFrame" onClick={navigate}>fitframe<span className="logo-dot">.</span></a>;
}

function GeoFooter(){
  return (
    <footer className="geo-footer">
      <details className="geo-block">
        <summary>FAQ</summary>
        <div className="geo-content">
          <p><strong>What is FitFrame?</strong> FitFrame is browser-based custom eyewear. The face scan runs on iPhone with no app download, and 3D printed PA12 nylon frames ship to your measurements.</p>
          <p><strong>Scan accuracy?</strong> FitFrame uses MediaPipe Face Mesh, iris landmark calibration, and an 11.8mm HVID constant. It measures binocular and monocular PD, bridge, lens height, face width, and temple length within 1-2mm for non-prescription frames.</p>
          <p><strong>App required?</strong> No. FitFrame runs entirely in Safari on iPhone.</p>
          <p><strong>Frame material?</strong> FitFrame frames are printed in PA12 nylon, which is lightweight, durable, and precise.</p>
          <p><strong>Price?</strong> FitFrame starts at $89 base. Blue light lenses are included, sunglass lenses are +$25, Transitions are +$45, and prescription lenses are +$65.</p>
          <p><strong>Shipping?</strong> FitFrame ships in 7-10 days after confirmation.</p>
          <p><strong>Fit guarantee?</strong> If frames do not fit, FitFrame reprints once at no charge.</p>
          <p><strong>Where does face data go?</strong> Face data goes nowhere. The camera is used only for measurement, and no images are stored or transmitted.</p>
          <p><strong>Custom 3D printed glasses under $100?</strong> Yes. FitFrame ships custom-measured frames starting at $89.</p>
        </div>
      </details>
      <details className="geo-block">
        <summary>About</summary>
        <div className="geo-content">
          <p>FitFrame is a made-to-measure eyewear company based in Pennsylvania. Frames are designed around your face, not an average one. Every pair is 3D printed in PA12 nylon to your exact scan measurements and shipped directly to you. Founded by Lorenzo, currently fulfilling every order personally.</p>
        </div>
      </details>
    </footer>
  );
}

function AboutUs(){
  useFitFrameJsonLd();
  return (
    <>
      <style>{css}</style>
      <div className="app">
        <main className="container">
          <section className="section">
            <Logo className="logo-large" href="/"/>
            <p className="body-lg">FitFrame is a browser-based eyewear fitting flow for custom 3D-printed frames. It turns a guided phone scan and a few fit questions into a clean maker-ready spec.</p>
            <p className="body-lg">Measurements are captured from a live camera feed, calibrated with a real-world reference, then reviewed before anything is sent. No app required.</p>
          </section>
        </main>
      </div>
    </>
  );
}

// Main ─────────────────────────────────────────────────────────────────────
export { AboutUs };

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
  const [submitting,    setSubmitting]    = useState(false);
  const [sent,          setSent]          = useState(false);
  const [orderId]                         = useState(()=>saved.orderId??genOrderId());

  const canvasRef=useRef(null);
  const {
    videoRef,
    ready: camReady,
    requesting: camRequesting,
    camErr,
    start: startCamera,
    stop: stopCamera,
  } = useCamera();
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
    setTimeout(()=>setScanning(true),650);
  },[]);
  const scan=useFaceScan({
    videoRef,
    scanning,
    canvasRef,
    scaleMmPerPx:calibration?.mmPerPx||null,
    scaleSource:calibration?"detected-card":"iris-fallback",
    needsCard:step===1&&camReady&&!calibration&&!scanning,
    onCardLocked:handleCardLocked,
  });
  const currentMeas=confirmedMeas||scan.measurements;

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
  useEffect(()=>{ if(scan.done) setScanning(false); },[scan.done]);
  useEffect(()=>{ setTapped(null); },[styleQIdx]);

  // Keep the user on scan review until they accept the measured spec.
  useEffect(()=>{
    if (scan.done&&scan.measurements&&!scan.quality?.rescan){
      setConfirmedMeas({
        ...scan.measurements,
        scanQuality:scan.quality?.label||"Review",
        scanReason:scan.quality?.reason||"",
        validPct:scan.validPct,
      });
    }
  },[scan.done,scan.measurements,scan.quality,scan.validPct]);

  function selectOption(opt){
    setTapped(opt.label);
    const qId=STYLE_QUESTIONS[styleQIdx].id;
    setStyleAnswers(prev=>({...prev,[qId]:opt}));
    if (styleQIdx<STYLE_QUESTIONS.length-1){ setTimeout(()=>setStyleQIdx(i=>i+1),220); }
    else { setTimeout(()=>setStep(3),300); }
  }

  function startFreshScan(){
    clearSession();
    setConfirmedMeas(null);
    setCalibration(null);
    setStyleAnswers({});
    setStyleQIdx(0);
    setSelectedFrame(null);
    scan.reset();
    setScanning(false);
    setScanPrepDismissed(false);
    setStep(1);
  }

  function rescan(){
    scan.reset();
    setScanning(false);
    setConfirmedMeas(null);
    setCalibration(null);
    setScanPrepDismissed(false);
    stopCamera();
  }

  function beginScanSetup(){
    setScanPrepDismissed(true);
    startCamera();
  }

  function updateMeasurement(key,value){
    setConfirmedMeas(prev=>({
      ...(prev||scan.measurements||{}),
      [key]:value,
      scaleSource:(prev||scan.measurements)?.scaleSource||"manual-review",
    }));
  }

  function buildMakerSpec(payload){
    return [
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
      "",
      "PRODUCTION_NOTES",
      "Use the matching STL for the selected frame ID. Scale front geometry to face width, set bridge to measured bridge, keep adjustable nose pad allowance, and use PD to center optical openings. PA12 nylon is the default launch material.",
    ].join("\n");
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
      card_reference:calibration?`${calibration.cardWidthMm}x${calibration.cardHeightMm}mm card / ${calibration.cardWidthPx}x${calibration.cardHeightPx}px / confidence ${calibration.confidence ?? "-"}`:"not captured",
      scan_quality:m?.scanQuality||scan.quality?.label||"-",
      valid_frames_pct:m?.validPct??(scan.validPct||"-"),
      user_agent:navigator.userAgent,
    };
    try {
      const spec=buildMakerSpec(payload);
      await navigator.clipboard?.writeText(spec).catch(()=>{});
      const subject=encodeURIComponent(`FitFrame Spec ${orderId}`);
      const body=encodeURIComponent(spec);
      window.location.assign(`mailto:${MAKER_EMAIL}?subject=${subject}&body=${body}`);
      clearSession();
      setSent(true);
    } catch { alert(`Email ${MAKER_EMAIL} and paste the copied spec.`); }
    finally { setSubmitting(false); }
  }

  const firstName=customerInfo.name.trim().split(" ")[0]||"there";
  const cameraActive=camReady||camRequesting;
  const showScanPrep=!scanPrepDismissed&&!scan.done&&!currentMeas&&!camErr&&!cameraActive;
  const scanTitle=scanning
    ?"Stay still."
    :scan.done
      ?"Scan complete."
      :showScanPrep
        ?"Take a quick calibrated face scan to begin."
      :camRequesting
        ?"Opening camera."
      :!camReady
          ?"Opening camera."
          :!calibration
            ?"Hold any card under your face."
            :"Ready to measure.";
  const scanCopy=scanning
    ?"Keep your face forward while we average the clean frames."
    :scan.done
      ?"Review the scan before continuing."
      :showScanPrep
        ?""
      :camRequesting
        ?"Allow camera access to continue."
      :camReady&&!calibration
          ?""
          :camReady
            ?"Card reference saved. Keep your face in the oval and start the measurement."
            :"";

  return (
    <>
      <style>{css}</style>
      <div className="app">

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
                  <div className="pre-scan-line">This scan takes about {SCAN_DURATION_SECONDS_PLACEHOLDER} seconds.</div>
                  <div className="pre-scan-line">Have a credit or ID card ready.</div>
                  <div className="pre-scan-support">Hold it flat under your chin, long edge horizontal.</div>
                  <div className="pre-scan-support">It gives the scan a much better size reference.</div>
                  <button className="btn btn-primary" style={{alignSelf:"stretch",marginTop:4}} onClick={beginScanSetup}>I'm ready</button>
                  <div className="privacy-inline"><Padlock/><span>Scan stays on this device. Images are not transmitted.</span></div>
                </div>
              )}

              {cameraActive&&!scan.done&&(
                <div className="cam-outer">
                  <div className="cam-inner">
                    <video ref={videoRef} autoPlay playsInline muted/>
                    <canvas ref={canvasRef}/>
                    <div className="cam-vignette"/>
                    <FaceGuide fill={scan.fill} autoStartPct={scan.autoStartPct} facePresent={scan.facePresent} poseHint={scan.poseHint} showCard={!calibration&&!scanning}/>
                    <div className="cam-bottom">
                      {scanning&&scan.seqIdx>=0
                        ?<div className="scan-inst">{SCAN_SEQ[Math.min(scan.seqIdx,SCAN_SEQ.length-1)].instruction}</div>
                        :!calibration
                          ?<div className="scan-inst">{scan.cardStatus?.label==="Scale locked"?"Scale locked.":scan.cardStatus?.reason||"Show the full card edge."}</div>
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
                          <span>{scan.facePresent?(scan.cardStatus?.label||"Find card outline"):"Find your face first"}</span>
                          {scan.cardStatus?.stablePct>0&&<strong>{Math.round(scan.cardStatus.stablePct*100)}%</strong>}
                        </div>}
                    </>
                  ):(
                    <>
                      <div className="calibration-strip"><span>Scale</span><strong>locked from card</strong></div>
                      <button className="btn btn-primary" disabled={!scan.mpReady||!scan.facePresent} onClick={()=>setScanning(true)}>
                        {scan.mpReady?scan.facePresent?"Start measurement":"Find your face first":"Loading..."}
                      </button>
                    </>
                  )}
                </div>
              )}

              {scan.done&&!currentMeas&&(
                <div className="cam-placeholder" style={{marginTop:0}}>
                  <div className="cam-label" style={{color:"var(--red)"}}>{scan.quality?.label||"No face data captured."}</div>
                  <div className="cam-sub">{scan.quality?.reason||"Ensure your face is well-lit and centered."}</div>
                  <button className="btn btn-ghost" style={{marginTop:4}} onClick={rescan}>Try again</button>
                </div>
              )}

              {currentMeas&&scan.quality?.rescan&&(
                <div className="cam-placeholder" style={{marginTop:0}}>
                  <div className="cam-label">Let's try that again.</div>
                  <div className="cam-sub">{scan.quality?.reason||"Face the camera straight on in good light and hold still."}</div>
                  <button className="btn btn-primary" style={{marginTop:4}}
                    onClick={rescan}>
                    Rescan
                  </button>
                </div>
              )}

              {(scan.done||confirmedMeas)&&currentMeas&&!scan.quality?.rescan&&(
                <div className="quality-card">
                  <div className="quality-head">
                    <div className="quality-title">Measurement review</div>
                    <div className="quality-pill">{currentMeas.scanQuality||scan.quality?.label||"Review"}</div>
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
                    <button className="btn btn-primary" onClick={()=>setStep(2)}>Continue</button>
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
              <div className="confirm-footer">{orderId} - fitframe.store</div>
            </div>
          )}

          <GeoFooter/>

        </div>
        <div style={{height:60}}/>
      </div>
    </>
  );
}
