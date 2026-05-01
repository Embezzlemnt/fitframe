import { useState, useRef, useEffect, useCallback } from "react";

// ─── Config ───────────────────────────────────────────────────────────────────
// Swap FORM_ENDPOINT for your Formspree URL: https://formspree.io/f/YOUR_ID
// or a Netlify function, or any JSON-accepting POST endpoint.
const FORM_ENDPOINT = "https://formspree.io/f/YOUR_FORM_ID";
const BASE_PRICE    = 89;

// ─── localStorage persistence ─────────────────────────────────────────────────
const STORE_KEY = "fitframe_session_v1";
function saveSession(data) { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {} }
function loadSession()     { try { const r = localStorage.getItem(STORE_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function clearSession()    { try { localStorage.removeItem(STORE_KEY); } catch {} }

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
const IRIS_MM = 11.8;
function calcMeasurements(lm, W, H) {
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
    faceW:   (d(234,454)*sc).toFixed(0),
    temple:  (d(234,454)*sc*0.68).toFixed(0),
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
  { id:"bluelight",    label:"Blue Light",   price:0,  desc:"Filters screen glare. Everyday clarity." },
  { id:"sunglass",     label:"Sunglass",     price:25, desc:"UV400 tint. Built for outside." },
  { id:"transition",   label:"Transitions",  price:45, desc:"Adapts to light. One pair, everywhere." },
  { id:"prescription", label:"Prescription", price:65, desc:"Your exact Rx. Requires prescription details." },
];

const SCAN_SEQ = [
  { instruction:"",                   holdMs:1500, fill:0.08 },
  { instruction:"Keep eyes forward.", holdMs:3000, fill:0.35 },
  { instruction:"Almost there.",      holdMs:3000, fill:0.65 },
  { instruction:"Nearly done.",       holdMs:2500, fill:0.88 },
  { instruction:"",                   holdMs:1500, fill:1.00 },
];

// ─── CSS ──────────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&family=DM+Mono:wght@300;400&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  :root{
    --bg:#FAFAF8;--surface:#F3F2EF;--border:#E3E1DB;--border2:#CECCC4;
    --text:#0C0C0A;--mid:#68665D;--dim:#999790;--soft:#BFBDB6;
    --accent:#1A5C3A;--aclt:#EAF2EC;--acmd:#2E7D52;
    --red:#B83232;--amber:#A86B0A;--scan:#080808;
  }
  html,body{height:100%;}
  body{background:var(--bg);color:var(--text);font-family:'DM Sans',-apple-system,sans-serif;-webkit-font-smoothing:antialiased;overscroll-behavior:none;}
  .app{min-height:100dvh;display:flex;flex-direction:column;align-items:center;}
  .site-header{width:100%;max-width:480px;padding:28px 24px 0;display:flex;align-items:center;justify-content:space-between;}
  .logo{font-family:'Cormorant Garamond',serif;font-size:21px;font-weight:500;color:var(--text);letter-spacing:-0.01em;}
  .logo-dot{color:var(--accent);}
  .header-tag{font-size:10px;color:var(--soft);font-family:'DM Mono',monospace;letter-spacing:0.05em;}
  .prog-strip{width:100%;max-width:480px;padding:22px 24px 0;display:flex;gap:5px;}
  .prog-dot{height:2px;flex:1;background:var(--border);border-radius:2px;transition:background .45s ease;}
  .prog-dot.done{background:var(--accent);}
  .prog-dot.active{background:var(--accent);opacity:.4;}
  .container{width:100%;max-width:480px;padding:0 24px;padding-bottom:env(safe-area-inset-bottom,48px);}
  .section{padding:28px 0 0;animation:fu .36s cubic-bezier(.4,0,.2,1) both;}
  @keyframes fu{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
  .eyebrow{font-size:10px;font-family:'DM Mono',monospace;color:var(--accent);letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px;}
  .display{font-family:'Cormorant Garamond',serif;font-size:48px;font-weight:500;color:var(--text);letter-spacing:-.025em;line-height:1;margin-bottom:18px;}
  .display em{font-style:italic;color:var(--accent);}
  .step-head{font-family:'Cormorant Garamond',serif;font-size:34px;font-weight:500;color:var(--text);letter-spacing:-.02em;line-height:1.1;margin-bottom:8px;}
  .body-lg{font-size:15px;color:var(--mid);line-height:1.68;font-weight:300;margin-bottom:30px;}
  .step-sub{font-size:13px;color:var(--dim);line-height:1.65;font-weight:300;margin-bottom:24px;}
  .privacy-note{font-size:11px;color:var(--soft);font-weight:300;margin-bottom:16px;line-height:1.5;}
  .btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:13px 26px;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:400;cursor:pointer;border:none;border-radius:100px;transition:all .16s;-webkit-tap-highlight-color:transparent;white-space:nowrap;}
  .btn-primary{background:var(--text);color:var(--bg);}
  .btn-primary:hover{background:#252522;transform:translateY(-1px);}
  .btn-accent{background:var(--accent);color:#fff;}
  .btn-accent:hover{background:var(--acmd);transform:translateY(-1px);}
  .btn-ghost{background:transparent;color:var(--mid);border:1px solid var(--border2);}
  .btn-ghost:hover{border-color:var(--mid);color:var(--text);}
  .btn:disabled{opacity:.2;cursor:not-allowed;transform:none!important;}
  .btn-row{display:flex;gap:10px;flex-wrap:wrap;}
  .features{border-top:1px solid var(--border);margin-bottom:34px;}
  .feature-row{display:flex;align-items:flex-start;gap:16px;padding:13px 0;border-bottom:1px solid var(--border);}
  .feature-num{font-family:'DM Mono',monospace;font-size:10px;color:var(--soft);padding-top:2px;min-width:18px;}
  .feature-text{font-size:13px;color:var(--mid);line-height:1.5;font-weight:300;}
  .feature-text strong{color:var(--text);font-weight:400;}
  .cam-outer{width:100%;border-radius:16px;overflow:hidden;background:var(--scan);position:relative;margin-bottom:20px;}
  .cam-inner{width:100%;aspect-ratio:4/3;position:relative;}
  .cam-inner video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);}
  .cam-inner canvas{position:absolute;inset:0;width:100%;height:100%;transform:scaleX(-1);pointer-events:none;}
  .cam-vignette{position:absolute;inset:0;pointer-events:none;z-index:2;background:radial-gradient(ellipse at center,transparent 34%,rgba(8,8,8,.65) 100%);}
  .cam-top{position:absolute;top:0;left:0;right:0;z-index:3;padding:env(safe-area-inset-top,14px) 16px 14px;display:flex;justify-content:space-between;align-items:center;background:linear-gradient(rgba(8,8,8,.5),transparent);}
  .cam-bottom{position:absolute;bottom:0;left:0;right:0;z-index:3;padding:32px 16px 18px;background:linear-gradient(transparent,rgba(8,8,8,.8));display:flex;flex-direction:column;align-items:center;gap:4px;}
  .scan-tag{font-family:'DM Mono',monospace;font-size:9px;color:rgba(255,255,255,.3);letter-spacing:.12em;text-transform:uppercase;}
  .scan-tag.live{color:#2E7D52;}
  .scan-pct{font-family:'DM Mono',monospace;font-size:9px;color:rgba(255,255,255,.28);}
  .scan-inst{font-size:16px;font-weight:300;color:rgba(255,255,255,.88);letter-spacing:-.01em;text-align:center;}
  .cam-placeholder{width:100%;aspect-ratio:4/3;border-radius:16px;background:var(--surface);border:1px solid var(--border);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:28px 24px;margin-bottom:20px;text-align:center;}
  .cam-icon{width:44px;height:44px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;color:var(--dim);}
  .cam-label{font-size:14px;color:var(--text);font-weight:400;}
  .cam-sub{font-size:12px;color:var(--dim);line-height:1.6;max-width:240px;font-weight:300;}
  .err-box{padding:11px 15px;background:#FEF8EF;border:1px solid #E8D09A;border-radius:8px;font-size:12px;color:var(--amber);line-height:1.65;max-width:280px;}
  .scan-ok{font-size:12px;color:var(--accent);text-align:center;margin-top:10px;font-weight:300;}
  .q-meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
  .q-counter{font-family:'DM Mono',monospace;font-size:10px;color:var(--soft);}
  .q-label{font-family:'Cormorant Garamond',serif;font-size:27px;font-weight:500;color:var(--text);letter-spacing:-.02em;line-height:1.25;margin-bottom:20px;}
  .choices{display:flex;flex-direction:column;gap:8px;}
  .choice{padding:14px 18px;border:1px solid var(--border);border-radius:10px;cursor:pointer;background:#fff;text-align:left;font-family:'DM Sans',sans-serif;font-size:14px;color:var(--text);font-weight:300;line-height:1.4;width:100%;transition:border-color .12s,background .12s;-webkit-tap-highlight-color:transparent;}
  .choice:active{transform:scale(.99);}
  .choice.chosen{border-color:var(--accent);background:var(--aclt);color:var(--accent);}
  .lens-list{display:flex;flex-direction:column;gap:8px;margin-bottom:28px;}
  .lens-row{display:flex;align-items:center;gap:16px;padding:16px 18px;border:1px solid var(--border);border-radius:10px;cursor:pointer;background:#fff;transition:border-color .12s,background .12s;-webkit-tap-highlight-color:transparent;}
  .lens-row.sel{border-color:var(--accent);background:var(--aclt);}
  .lens-info{flex:1;}
  .lens-name{font-size:14px;font-weight:400;color:var(--text);margin-bottom:2px;}
  .lens-desc{font-size:12px;color:var(--dim);font-weight:300;}
  .lens-price{font-family:'DM Mono',monospace;font-size:12px;color:var(--accent);}
  .rx-block{padding:18px;background:var(--surface);border:1px solid var(--border);border-radius:10px;margin-bottom:20px;}
  .rx-lbl{font-size:10px;font-family:'DM Mono',monospace;color:var(--soft);letter-spacing:.08em;text-transform:uppercase;margin-bottom:14px;}
  .rx-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
  .rx-item label{display:block;font-size:10px;color:var(--dim);margin-bottom:4px;}
  .rx-input{width:100%;padding:8px 10px;background:#fff;border:1px solid var(--border2);border-radius:6px;color:var(--text);font-size:14px;outline:none;font-family:'DM Mono',monospace;font-weight:300;}
  .rx-input:focus{border-color:var(--accent);}
  .vto-note{display:flex;align-items:center;gap:8px;padding:11px 14px;border:1px solid var(--border);border-radius:8px;margin-bottom:20px;background:var(--surface);}
  .vto-note-icon{color:var(--soft);flex-shrink:0;}
  .vto-note-text{font-size:11px;color:var(--dim);font-weight:300;line-height:1.5;}
  .vto-note-text strong{color:var(--mid);font-weight:400;}
  .frame-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;}
  .frame-tile{padding:16px 14px;border:1px solid var(--border);border-radius:12px;cursor:pointer;background:#fff;text-align:center;transition:border-color .14s,background .14s,box-shadow .14s;-webkit-tap-highlight-color:transparent;position:relative;}
  .frame-tile:hover{border-color:var(--border2);}
  .frame-tile.sel{border-color:var(--accent);background:var(--aclt);box-shadow:0 0 0 3px rgba(26,92,58,.07);}
  .frame-tile-icon{display:flex;justify-content:center;align-items:center;margin-bottom:10px;min-height:28px;}
  .frame-tile-name{font-size:12px;font-weight:400;color:var(--text);margin-bottom:2px;}
  .frame-tile.sel .frame-tile-name{color:var(--accent);}
  .frame-tile-desc{font-size:11px;color:var(--dim);font-weight:300;line-height:1.4;}
  .best-badge{position:absolute;top:9px;right:9px;font-size:8px;padding:2px 7px;background:var(--accent);color:#fff;border-radius:100px;font-family:'DM Mono',monospace;letter-spacing:.06em;}
  .receipt{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:22px;}
  .receipt-head{padding:13px 18px;border-bottom:1px solid var(--border);font-size:10px;font-family:'DM Mono',monospace;color:var(--soft);letter-spacing:.08em;text-transform:uppercase;}
  .receipt-row{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--border);font-size:13px;color:var(--mid);font-weight:300;}
  .receipt-total{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;border-top:1px solid var(--border);font-size:15px;font-weight:500;color:var(--text);}
  .field{width:100%;padding:14px 16px;background:#fff;border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:16px;font-family:'DM Sans',sans-serif;outline:none;margin-bottom:8px;font-weight:300;transition:border-color .15s;-webkit-appearance:none;}
  .field:focus{border-color:var(--accent);}
  .trust-line{display:flex;align-items:center;justify-content:center;gap:5px;margin-top:14px;font-size:11px;color:var(--soft);font-weight:300;}
  .confirm-id{font-family:'DM Mono',monospace;font-size:11px;color:var(--soft);letter-spacing:.06em;margin-bottom:22px;}
  .confirm-greeting{font-family:'Cormorant Garamond',serif;font-size:42px;font-weight:500;color:var(--text);letter-spacing:-.02em;line-height:1.05;margin-bottom:14px;}
  .confirm-body{font-size:14px;color:var(--mid);line-height:1.7;font-weight:300;margin-bottom:32px;}
  .confirm-body strong{color:var(--text);font-weight:400;}
  .next-steps{border-top:1px solid var(--border);}
  .next-step{display:flex;gap:16px;align-items:flex-start;padding:14px 0;border-bottom:1px solid var(--border);}
  .next-step-num{font-family:'DM Mono',monospace;font-size:10px;color:var(--soft);padding-top:2px;min-width:18px;}
  .next-step-label{font-size:13px;font-weight:400;color:var(--text);margin-bottom:2px;}
  .next-step-desc{font-size:12px;color:var(--dim);font-weight:300;line-height:1.5;}
  .confirm-footer{margin-top:28px;font-size:11px;color:var(--soft);text-align:center;font-family:'DM Mono',monospace;letter-spacing:.04em;}
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
      detail:safari?"Safari → Settings for this Website → Camera → Allow → reload.":"Tap the camera icon in your address bar → Allow → reload."};
  }
  return {type:"unknown",headline:"Camera unavailable",detail:`${err?.message||"Unknown error"}. Try reloading.`,fix:"reload"};
}

// ─── useCamera ────────────────────────────────────────────────────────────────
function useCamera() {
  const videoRef = useRef(null);
  const [ready, setReady]   = useState(false);
  const [camErr,setCamErr]  = useState(null);

  const start = useCallback(async () => {
    setCamErr(null);
    if (!navigator.mediaDevices?.getUserMedia) { setCamErr({type:"https",headline:"Camera unavailable",detail:"Ensure you're on https://",fix:null}); return; }
    try {
      let stream;
      try   { stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:640},height:{ideal:480}},audio:false}); }
      catch { stream = await navigator.mediaDevices.getUserMedia({video:true,audio:false}); }
      const v=videoRef.current;
      if (v) { v.srcObject=stream; v.setAttribute("playsinline",""); v.muted=true; await v.play().catch(()=>{}); setReady(true); }
    } catch(e) { setCamErr(classifyCamError(e)); }
  }, []);

  const stop = useCallback(() => {
    const v=videoRef.current;
    if (v?.srcObject) { v.srcObject.getTracks().forEach(t=>t.stop()); v.srcObject=null; }
    setReady(false);
  }, []);

  return { videoRef, ready, camErr, start, stop };
}

// ─── useFaceScan ──────────────────────────────────────────────────────────────
const HOLD_FRAMES = 18;
function useFaceScan({ videoRef, scanning, canvasRef, onAutoStart }) {
  const fmRef          = useRef(null);
  const [mpReady,      setMpReady]      = useState(false);
  const samplesRef     = useRef([]);
  const noseXRef       = useRef([]);
  const validRef       = useRef(0);
  const totalRef       = useRef(0);
  const loopRef        = useRef(null);
  const procRef        = useRef(false);
  const scanningRef    = useRef(false);
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

  useEffect(()=>{ scanningRef.current=scanning; },[scanning]);

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
  },[]);

  function handleResults(results){
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
    setPoseHint(pose.valid?null:pose.reason);

    if (!autoStarted.current&&!scanningRef.current){
      pose.valid?holdRef.current++:(holdRef.current=Math.max(0,holdRef.current-2));
      const pct=Math.min(holdRef.current/HOLD_FRAMES,1);
      setAutoStartPct(pct);
      if (pct>=1){ autoStarted.current=true; onAutoStart?.(); }
    }

    const lId=(d(468,469)+d(468,470)+d(468,471)+d(468,472))/4*2;
    const rId=(d(473,474)+d(473,475)+d(473,476)+d(473,477))/4*2;
    const ink=pose.valid?"#1A5C3A":"rgba(255,255,255,.22)";
    [[pts[468],lId],[pts[473],rId]].forEach(([c,diam])=>{
      ctx.beginPath(); ctx.arc(c.x,c.y,diam/2,0,Math.PI*2);
      ctx.strokeStyle=ink; ctx.lineWidth=1.5; ctx.stroke();
    });
    ctx.beginPath(); ctx.moveTo(pts[468].x,pts[468].y); ctx.lineTo(pts[473].x,pts[473].y);
    ctx.strokeStyle=ink; ctx.lineWidth=.75; ctx.setLineDash([3,4]); ctx.stroke(); ctx.setLineDash([]);

    if (scanningRef.current&&pose.valid){
      totalRef.current++;
      const m=calcMeasurements(lm,W,H);
      if (m){ samplesRef.current.push(m); noseXRef.current.push(lm[1].x); validRef.current++; }
    } else if (scanningRef.current) totalRef.current++;
  }

  useEffect(()=>{
    const loop=async()=>{
      const v=videoRef.current;
      if (fmRef.current&&v&&v.readyState>=2&&!procRef.current){
        procRef.current=true;
        try { await fmRef.current.send({image:v}); } catch {}
        procRef.current=false;
      }
      loopRef.current=requestAnimationFrame(loop);
    };
    loopRef.current=requestAnimationFrame(loop);
    return ()=>{ if(loopRef.current) cancelAnimationFrame(loopRef.current); };
  },[]);

  useEffect(()=>{
    if (scanning&&!done){
      samplesRef.current=[]; noseXRef.current=[];
      validRef.current=0; totalRef.current=0;
      setSeqIdx(0);
    }
  },[scanning]);

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
        const s=samplesRef.current, nx=noseXRef.current;
        const vp=totalRef.current>0?validRef.current/totalRef.current:0;
        setValidPct(Math.round(vp*100));
        if (s.length>=3){
          const sorted=[...s].sort((a,b)=>parseFloat(a.pd)-parseFloat(b.pd));
          const trim=Math.max(1,Math.floor(sorted.length*.15));
          const good=sorted.slice(trim,sorted.length-trim);
          const avg=k=>good.map(m=>parseFloat(m[k])).reduce((a,b)=>a+b,0)/good.length;
          const pd=avg("pd"),br=avg("bridge");
          const sane=pd>=52&&pd<=80&&br>=10&&br<=28;
          setMeasurements({pd:pd.toFixed(1),pdLeft:avg("pdLeft").toFixed(1),pdRight:avg("pdRight").toFixed(1),bridge:br.toFixed(1),temple:avg("temple").toFixed(0),lensH:avg("lensH").toFixed(1),faceW:avg("faceW").toFixed(0)});
          const rot=(Math.max(...nx)-Math.min(...nx))>.10;
          setQuality(!sane?{label:"Out of range",rescan:true}:vp>=.7?{label:"Excellent",rescan:false}:vp>=.5?{label:"Good",rescan:false}:vp>=.3?{label:"Fair",rescan:false}:{label:"Low",rescan:true});
        } else { setQuality({label:"No data",rescan:true}); setMeasurements(null); }
      }
    };
    raf=requestAnimationFrame(animate);
    return ()=>cancelAnimationFrame(raf);
  },[seqIdx]);

  const reset=useCallback(()=>{
    setSeqIdx(-1); setFill(0); fillRef.current=0;
    setDone(false); setMeasurements(null); setQuality(null);
    setAutoStartPct(0); setFacePresent(false); setPoseHint(null);
    samplesRef.current=[]; noseXRef.current=[];
    validRef.current=0; totalRef.current=0;
    holdRef.current=0; autoStarted.current=false;
  },[]);

  return {seqIdx,fill,done,measurements,mpReady,autoStartPct,facePresent,poseHint,quality,validPct,reset};
}

// ─── FaceGuide ────────────────────────────────────────────────────────────────
function FaceGuide({fill,autoStartPct,facePresent,poseHint}){
  const VW=400,VH=300,cx=200,cy=150,rx=78,ry=108;
  const h=((rx-ry)/(rx+ry))**2;
  const circ=Math.PI*(rx+ry)*(1+(3*h)/(10+Math.sqrt(4-3*h)));
  const bo=facePresent?.62:.2;
  const bx1=cx-rx-12,by1=cy-ry-12,bx2=cx+rx+12,by2=cy+ry+12,bl=13;
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid slice"
      style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:2}}>
      {[`M${bx1+bl},${by1} L${bx1},${by1} L${bx1},${by1+bl}`,`M${bx2-bl},${by1} L${bx2},${by1} L${bx2},${by1+bl}`,
        `M${bx1},${by2-bl} L${bx1},${by2} L${bx1+bl},${by2}`,`M${bx2},${by2-bl} L${bx2},${by2} L${bx2-bl},${by2}`
      ].map((p,i)=><path key={i} d={p} stroke="rgba(255,255,255,.5)" strokeWidth="2" fill="none" strokeLinecap="round"/>)}
      {autoStartPct>0&&autoStartPct<1&&(
        <ellipse cx={cx} cy={cy} rx={rx+11} ry={ry+11} fill="none"
          stroke="rgba(255,255,255,.1)" strokeWidth="2"
          strokeDasharray={`${autoStartPct*circ*1.1} 9999`}
          strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}/>
      )}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none"
        stroke={`rgba(255,255,255,${bo})`} strokeWidth="2" style={{transition:"stroke .4s ease"}}/>
      {fill>0&&<ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="#1A5C3A" strokeWidth="3"
        strokeDasharray={`${circ*Math.min(fill,1)} ${circ+10}`}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} style={{transition:"stroke-dasharray .1s linear"}}/>}
      <circle cx={cx-26} cy={cy-22} r="2" fill={`rgba(255,255,255,${bo})`} opacity=".4"/>
      <circle cx={cx+26} cy={cy-22} r="2" fill={`rgba(255,255,255,${bo})`} opacity=".4"/>
      {poseHint&&<text x={cx} y={cy+ry+22} textAnchor="middle" fill="rgba(255,255,255,.72)"
        fontSize="13" fontFamily="'DM Sans',-apple-system,sans-serif" fontWeight="300">{poseHint}</text>}
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

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function FramesSite(){
  const saved=loadSession()||{};

  const [step,          setStep]          = useState(saved.step??0);
  const [confirmedMeas, setConfirmedMeas] = useState(saved.confirmedMeas??null);
  const [styleAnswers,  setStyleAnswers]  = useState(saved.styleAnswers??{});
  const [styleQIdx,     setStyleQIdx]     = useState(saved.styleQIdx??0);
  const [tapped,        setTapped]        = useState(null);
  const [lensChoice,    setLensChoice]    = useState(saved.lensChoice??null);
  const [rxForm,        setRxForm]        = useState(saved.rxForm??{odSphere:"",odCyl:"",odAxis:"",osSphere:"",osCyl:"",osAxis:""});
  const [selectedFrame, setSelectedFrame] = useState(saved.selectedFrame??null);
  const [customerInfo,  setCustomerInfo]  = useState(saved.customerInfo??{name:"",email:""});
  const [scanning,      setScanning]      = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [sent,          setSent]          = useState(false);
  const [orderId]                         = useState(()=>saved.orderId??genOrderId());

  const canvasRef=useRef(null);
  const cam =useCamera();
  const scan=useFaceScan({videoRef:cam.videoRef,scanning,canvasRef,onAutoStart:()=>setScanning(true)});
  const currentMeas=scan.measurements||confirmedMeas;

  // Persist
  useEffect(()=>{
    if (step===0||sent) return;
    saveSession({step,confirmedMeas,styleAnswers,styleQIdx,lensChoice,rxForm,selectedFrame,customerInfo,orderId});
  },[step,confirmedMeas,styleAnswers,styleQIdx,lensChoice,rxForm,selectedFrame,customerInfo]);

  // Frame scoring
  const suggestedTags=Object.values(styleAnswers).flatMap(a=>a?.tags||[]);
  const topFrames=[...FRAMES].map(f=>({...f,score:f.tags.filter(t=>suggestedTags.includes(t)).length})).sort((a,b)=>b.score-a.score);
  const lensData=LENS_OPTIONS.find(l=>l.id===lensChoice);
  const totalPrice=BASE_PRICE+(lensData?.price||0);
  const chosenFrame=FRAMES.find(f=>f.id===selectedFrame)||topFrames[0];

  useEffect(()=>{ if(step!==1) cam.stop(); },[step]);
  useEffect(()=>{ if(scan.done) setScanning(false); },[scan.done]);
  useEffect(()=>{ setTapped(null); },[styleQIdx]);

  // Auto-advance after good scan
  useEffect(()=>{
    if (currentMeas&&!scan.quality?.rescan){
      const t=setTimeout(()=>{ setConfirmedMeas(currentMeas); setStep(2); },1400);
      return ()=>clearTimeout(t);
    }
  },[currentMeas,scan.quality]);

  function selectOption(opt){
    setTapped(opt.label);
    const qId=STYLE_QUESTIONS[styleQIdx].id;
    setStyleAnswers(prev=>({...prev,[qId]:opt}));
    if (styleQIdx<STYLE_QUESTIONS.length-1){ setTimeout(()=>setStyleQIdx(i=>i+1),220); }
    else { setTimeout(()=>setStep(3),300); }
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
      frame:chosenFrame?.label||"—",
      lens:lensData?.label||"—",
      lens_price:lensData?.price||0,
      total:totalPrice,
      style_fit:styleAnswers.fit?.label||"—",
      style_vibe:styleAnswers.vibe?.label||"—",
      style_use:styleAnswers.use?.label||"—",
      style_priority:styleAnswers.priority?.label||"—",
      pd_binocular:m?.pd||"—",
      pd_left:m?.pdLeft||"—",
      pd_right:m?.pdRight||"—",
      bridge_mm:m?.bridge||"—",
      temple_mm:m?.temple||"—",
      lens_height_mm:m?.lensH||"—",
      face_width_mm:m?.faceW||"—",
      scan_quality:scan.quality?.label||"—",
      valid_frames_pct:scan.validPct||"—",
      user_agent:navigator.userAgent,
      ...(lensChoice==="prescription"?{
        rx_od_sphere:rxForm.odSphere||"—",rx_od_cyl:rxForm.odCyl||"—",rx_od_axis:rxForm.odAxis||"—",
        rx_os_sphere:rxForm.osSphere||"—",rx_os_cyl:rxForm.osCyl||"—",rx_os_axis:rxForm.osAxis||"—",
      }:{}),
    };
    try {
      const res=await fetch(FORM_ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(payload)});
      if (res.ok){ clearSession(); setSent(true); }
      else alert("Submission failed. Email hello@framefit.shop directly.");
    } catch { alert("Network error. Check your connection and try again."); }
    finally { setSubmitting(false); }
  }

  const dots=[1,2,3,4,5].map(i=>({done:step>i,active:step===i}));
  const firstName=customerInfo.name.trim().split(" ")[0]||"there";

  return (
    <>
      <style>{css}</style>
      <div className="app">

        <header className="site-header">
          <div className="logo">FitFrame<span className="logo-dot">.</span></div>
          <div className="header-tag">framefit.shop</div>
        </header>

        {step>0&&!sent&&(
          <div className="prog-strip">
            {dots.map((d,i)=><div key={i} className={`prog-dot ${d.done?"done":d.active?"active":""}`}/>)}
          </div>
        )}

        <div className="container">

          {/* ── 0: Hero ── */}
          {step===0&&(
            <div className="section">
              <div className="eyebrow">Made-to-measure eyewear</div>
              <div className="display">Frames built<br/>for <em>your</em> face.</div>
              <p className="body-lg">Scan your face. Answer four questions. Receive 3D-printed frames built to your exact measurements — shipped to your door.</p>
              <div className="features">
                {[
                  ["01",<><strong>Browser-based face scan.</strong> No app, no store, no optician.</>],
                  ["02",<><strong>Every measurement captured.</strong> PD, bridge, temple, face width — all from your scan.</>],
                  ["03",<><strong>3D printed to your spec.</strong> PA12 nylon. Lightweight, precise, durable.</>],
                  ["04",<><strong>$89 base price.</strong> Ships in 7–10 days after confirmation.</>],
                ].map(([n,t])=>(
                  <div className="feature-row" key={n}>
                    <span className="feature-num">{n}</span>
                    <span className="feature-text">{t}</span>
                  </div>
                ))}
              </div>
              <div className="btn-row">
                <button className="btn btn-primary" onClick={()=>setStep(1)}>Start your scan →</button>
              </div>
            </div>
          )}

          {/* ── 1: Scan ── */}
          {step===1&&(
            <div className="section">
              <div className="eyebrow">Step 1 of 4 — Face scan</div>
              <div className="step-head">{scanning?"Stay still.":scan.done?"Scan complete.":"Position your face."}</div>
              <p className="step-sub">{scanning?"We're capturing your measurements.":scan.done?"Processing your measurements.":"Center your face inside the oval and hold still. The scan starts automatically."}</p>
              <p className="privacy-note">Your camera is used only for measurement. No images are stored or transmitted.</p>

              {cam.ready&&!scan.done&&(
                <div className="cam-outer">
                  <div className="cam-inner">
                    <video ref={cam.videoRef} autoPlay playsInline muted/>
                    <canvas ref={canvasRef}/>
                    <div className="cam-vignette"/>
                    <FaceGuide fill={scan.fill} autoStartPct={scan.autoStartPct} facePresent={scan.facePresent} poseHint={scan.poseHint}/>
                    <div className="cam-top">
                      <span className={`scan-tag ${scan.facePresent?"live":""}`}>{scan.facePresent?"face detected":"scanning"}</span>
                      {scanning&&scan.seqIdx>=0&&<span className="scan-pct">{Math.round(scan.fill*100)}%</span>}
                    </div>
                    <div className="cam-bottom">
                      {scanning&&scan.seqIdx>=0
                        ?<div className="scan-inst">{SCAN_SEQ[Math.min(scan.seqIdx,SCAN_SEQ.length-1)].instruction}</div>
                        :scan.poseHint
                          ?<div className="scan-inst" style={{color:"#C49A2E"}}>{scan.poseHint}</div>
                          :scan.autoStartPct>0&&scan.autoStartPct<1
                            ?<div className="scan-inst">Hold still…</div>
                            :<div className="scan-inst">Look directly at the camera.</div>}
                    </div>
                  </div>
                </div>
              )}

              {step===1&&cam.ready&&scan.done&&<canvas ref={canvasRef} style={{display:"none"}}/>}

              {!cam.ready&&!cam.camErr&&!currentMeas&&(
                <div className="cam-placeholder">
                  <div className="cam-icon">
                    <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                      <circle cx="12" cy="13" r="4"/>
                    </svg>
                  </div>
                  <div className="cam-label">Camera access needed</div>
                  <div className="cam-sub">FitFrame uses your front camera to measure your face. Nothing leaves your device.</div>
                  <button className="btn btn-primary" style={{marginTop:4}} onClick={cam.start}>Allow camera</button>
                </div>
              )}

              {cam.camErr&&(
                <div className="cam-placeholder">
                  <div className="cam-label" style={{color:"var(--red)"}}>{cam.camErr.headline}</div>
                  {cam.camErr.type==="denied"?<div className="err-box">{cam.camErr.detail}</div>:<div className="cam-sub">{cam.camErr.detail}</div>}
                  {cam.camErr.fix==="retry"&&<button className="btn btn-ghost" onClick={cam.start}>Try again</button>}
                  {cam.camErr.fix==="reload"&&<button className="btn btn-ghost" onClick={()=>location.reload()}>Reload page</button>}
                </div>
              )}

              {cam.ready&&!scan.done&&!scanning&&(
                <div style={{textAlign:"center",marginTop:14}}>
                  <button className="btn btn-primary" disabled={!scan.mpReady} onClick={()=>setScanning(true)}>
                    {scan.mpReady?"Start scan":"Loading…"}
                  </button>
                </div>
              )}

              {scan.done&&!currentMeas&&(
                <div className="cam-placeholder" style={{marginTop:0}}>
                  <div className="cam-label" style={{color:"var(--red)"}}>No face data captured.</div>
                  <div className="cam-sub">Ensure your face is well-lit and centered.</div>
                  <button className="btn btn-ghost" style={{marginTop:4}} onClick={()=>{scan.reset();setScanning(false);}}>Try again</button>
                </div>
              )}

              {currentMeas&&scan.quality?.rescan&&(
                <div className="cam-placeholder" style={{marginTop:0}}>
                  <div className="cam-label">Let's try that again.</div>
                  <div className="cam-sub">Face the camera straight on in good light and hold still.</div>
                  <button className="btn btn-primary" style={{marginTop:4}}
                    onClick={()=>{scan.reset();setScanning(false);setConfirmedMeas(null);cam.stop();setTimeout(cam.start,300);}}>
                    Rescan
                  </button>
                </div>
              )}

              {currentMeas&&!scan.quality?.rescan&&(
                <div className="scan-ok">Measurements captured. Moving forward…</div>
              )}
            </div>
          )}

          {/* ── 2: Style ── */}
          {step===2&&(()=>{
            const q=STYLE_QUESTIONS[styleQIdx];
            return (
              <div className="section" key={styleQIdx}>
                <div className="eyebrow">Step 2 of 4 — Style</div>
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

          {/* ── 3: Lens ── */}
          {step===3&&(
            <div className="section">
              <div className="eyebrow">Step 3 of 4 — Lenses</div>
              <div className="step-head">Choose your lens.</div>
              <p className="step-sub">All lenses are cut to your exact frame measurements.</p>
              <div className="lens-list">
                {LENS_OPTIONS.map(l=>(
                  <div key={l.id} className={`lens-row ${lensChoice===l.id?"sel":""}`} onClick={()=>setLensChoice(l.id)}>
                    <div className="lens-info">
                      <div className="lens-name">{l.label}</div>
                      <div className="lens-desc">{l.desc}</div>
                    </div>
                    <div className="lens-price">{l.price===0?"Included":`+$${l.price}`}</div>
                  </div>
                ))}
              </div>
              {lensChoice==="prescription"&&(
                <div className="rx-block">
                  <div className="rx-lbl">Prescription details</div>
                  <div className="rx-grid">
                    {[["OD Sphere","odSphere"],["OD Cyl","odCyl"],["OD Axis","odAxis"],
                      ["OS Sphere","osSphere"],["OS Cyl","osCyl"],["OS Axis","osAxis"]].map(([label,key])=>(
                      <div className="rx-item" key={key}>
                        <label>{label}</label>
                        <input className="rx-input" placeholder={key.includes("Axis")?"0–180":"±0.00"}
                          value={rxForm[key]} onChange={e=>setRxForm(p=>({...p,[key]:e.target.value}))}/>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="btn-row">
                <button className="btn btn-primary" disabled={!lensChoice} onClick={()=>setStep(4)}>Choose your frame →</button>
                <button className="btn btn-ghost" onClick={()=>setStep(2)}>Back</button>
              </div>
            </div>
          )}

          {/* ── 4: Frame ── */}
          {step===4&&(
            <div className="section">
              <div className="eyebrow">Step 4 of 4 — Frame</div>
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
                  </div>
                ))}
              </div>
              <div className="btn-row" style={{marginTop:8}}>
                <button className="btn btn-primary" onClick={()=>{if(!selectedFrame)setSelectedFrame(topFrames[0]?.id);setStep(5);}}>
                  Review my order →
                </button>
                <button className="btn btn-ghost" onClick={()=>setStep(3)}>Back</button>
              </div>
            </div>
          )}

          {/* ── 5: Checkout ── */}
          {step===5&&!sent&&(
            <div className="section">
              <div className="eyebrow">Almost there</div>
              <div className="step-head">Review and confirm.</div>
              <p className="step-sub">Your measurements and frame spec are ready. We'll confirm your order within 24 hours.</p>
              <div className="receipt">
                <div className="receipt-head">Order summary · {orderId}</div>
                <div className="receipt-row"><span>Custom frame — {chosenFrame?.label}</span><span>${BASE_PRICE}</span></div>
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
                  {submitting?"Sending…":"Place my order →"}
                </button>
                <button className="btn btn-ghost" onClick={()=>setStep(4)}>Back</button>
              </div>
              <div className="trust-line"><Padlock/><span>Secure · Your measurements stay private</span></div>
            </div>
          )}

          {/* ── Confirmation ── */}
          {sent&&(
            <div className="section">
              <div className="confirm-id">{orderId}</div>
              <div className="confirm-greeting">We've got it,<br/>{firstName}.</div>
              <p className="confirm-body">
                Your order is in. Check <strong>{customerInfo.email}</strong> — a confirmation with your order details is on its way.
              </p>
              <div className="next-steps">
                {[
                  ["01","We confirm your order","You'll hear from us within 24 hours with payment details and your full order summary."],
                  ["02","We print your frames","Print time is 2–3 days once confirmed. Your frames are made specifically for your face — no off-the-shelf inventory."],
                  ["03","Shipped to your door",`Estimated delivery: ${getETA()}. We'll send tracking once your order ships.`],
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
              <div className="confirm-footer">{orderId} · framefit.shop</div>
            </div>
          )}

        </div>
        <div style={{height:60}}/>
      </div>
    </>
  );
}
