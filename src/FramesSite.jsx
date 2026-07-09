import { useState, useRef, useEffect, useCallback } from "react";
import ScanStage from "./scan/ScanStage.jsx";

// ─── Config ───────────────────────────────────────────────────────────────────
const MAKER_EMAIL = "hello@fitframe.store";
const DOMAIN_URL = "https://fitframe.store"; // LOCKED

// ─── Reservation pricing (charged upfront via Stripe) ──────────────────────────
const RESERVE_FRAME_PRICE = 20;      // pair, at cost
const RESERVE_SHIPPING = 1;          // shipping today
const RESERVE_TOTAL = RESERVE_FRAME_PRICE + RESERVE_SHIPPING; // charged now: $21

// ─── localStorage persistence ─────────────────────────────────────────────────
const STORE_KEY = "fitframe_session_v1";
function saveSession(data) { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* storage can be unavailable in private mode */ } }
function loadSession()     { try { const r = localStorage.getItem(STORE_KEY); return r ? JSON.parse(r) : null; } catch { return null; } }
function clearSession()    { try { localStorage.removeItem(STORE_KEY); } catch { /* storage can be unavailable in private mode */ } }

const FITFRAME_FAQ = [
  ["Is FitFrame legit?","FitFrame is a real operation based in the US. Every order is fulfilled by the person who built it. The official domain is fitframe.store."],
  ["Why is the founder's cut so cheap?","The first 25 pairs go out at cost. There's no retail, no optician, no inventory, and no markup yet - you're an early founder helping shape the real product, so you pay what it costs us to make it."],
  ["Who is behind FitFrame?","FitFrame is built and operated by its founder, who designs the frames, runs the scans, and fulfills every order personally. It's a small operation by choice - every pair gets real attention."],
  ["How accurate is the FitFrame scan?","FitFrame uses MediaPipe Face Mesh, iris landmark calibration, an 11.8mm HVID reference, and optional card calibration. The target accuracy is within 1-2mm for non-Rx frame fitting."],
  ["What if my FitFrame frames don't fit?","FitFrame includes one free reprint if the first pair does not fit."],
  ["Where does FitFrame ship from?","FitFrame ships from the US."],
  ["What material are FitFrame frames made of?","FitFrame frames are 3D printed in PA12 nylon."],
];
function genOrderId() { return "FF-"+Math.random().toString(36).substring(2,8).toUpperCase(); }
function isValidEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
// ─── Data ─────────────────────────────────────────────────────────────────────
const FITFRAME_FRAME = { id:"fitframe-core", label:"fitframe core", desc:"one shape, built to your measurements." };

// The two short-text questions of the founder agreement. The third (the photo +
// review commitment) is a yes/no toggle handled inline — "yes" is required to reserve.
const FOUNDER_QUESTIONS = [
  { id:"wearNow",     q:"what do you wear now?",   placeholder:"e.g. ray-ban wayfarers, drugstore readers..." },
  { id:"whatsWrong",  q:"what's wrong with them?", placeholder:"e.g. slide down my nose, too wide..." },
];

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
  /* ── Founder's Cut ── */
  .founder-counter{display:inline-flex;align-items:center;gap:7px;font-family:'Geist Mono',monospace;font-size:11px;letter-spacing:.04em;color:var(--dim);white-space:nowrap;}
  .founder-counter-num{color:var(--accent);font-weight:500;font-variant-numeric:tabular-nums;}
  .founder-dot{width:7px;height:7px;border-radius:999px;background:var(--accent);box-shadow:0 0 0 0 rgba(76,175,125,.5);animation:founderPulse 2s ease-out infinite;flex:none;}
  @keyframes founderPulse{0%{box-shadow:0 0 0 0 rgba(76,175,125,.45);}70%{box-shadow:0 0 0 7px rgba(76,175,125,0);}100%{box-shadow:0 0 0 0 rgba(76,175,125,0);}}
  @media (prefers-reduced-motion:reduce){.founder-dot{animation:none;}}
  .eyebrow-accent{color:var(--accent);}
  .meas-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:6px 0 18px;}
  .meas-cell{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:13px 14px;}
  .meas-cell.wide{grid-column:1 / -1;}
  .meas-label{font-family:'Geist Mono',monospace;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--soft);margin-bottom:5px;}
  .meas-value{font-family:'Geist Mono',monospace;font-size:22px;font-weight:500;color:var(--text);font-variant-numeric:tabular-nums;letter-spacing:-.02em;}
  .meas-unit{font-size:12px;color:var(--dim);font-weight:300;margin-left:2px;}
  .founder-q{margin-bottom:18px;}
  .founder-q-label{font-size:15px;font-weight:500;color:var(--text);letter-spacing:-.02em;margin-bottom:9px;}
  .share-toggle{display:flex;gap:8px;}
  .share-opt{flex:1;min-height:46px;border:1px solid var(--border2);border-radius:10px;background:var(--surface2);color:var(--text);font-family:'Geist',sans-serif;font-size:14px;font-weight:400;cursor:pointer;transition:border-color .12s,background .12s;}
  .share-opt.sel{border-color:var(--accent);background:var(--accent-bg);}
  .reserve-note{font-size:12px;color:var(--dim);line-height:1.55;font-weight:300;margin:14px 0 4px;}
  .confirm-pair{font-family:'Geist Mono',monospace;font-size:44px;font-weight:600;color:var(--text);letter-spacing:-.03em;margin-bottom:14px;}
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
  .consent-choices{display:grid;gap:9px;width:100%;margin-top:2px;}
  .consent-btn{display:flex;flex-direction:column;align-items:center;gap:2px;width:100%;padding:13px 16px;}
  .consent-sub{font-size:11px;font-weight:300;opacity:.72;letter-spacing:.01em;}
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
          price:"21",
          priceCurrency:"USD",
          availability:"https://schema.org/LimitedAvailability",
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

  // Step 4 (confirmation) is never persisted — sessions are cleared on success.
  const savedStep = Number.isInteger(saved.step) && saved.step >= 0 && saved.step <= 3 ? saved.step : 0;
  const [step,          setStep]          = useState(savedStep);
  const [confirmedMeas, setConfirmedMeas] = useState(saved.confirmedMeas??null);
  const [calibration,   setCalibration]   = useState(saved.calibration??null);
  const [founderAnswers,setFounderAnswers]= useState(saved.founderAnswers??{wearNow:"",whatsWrong:"",willShare:null,marketingOptIn:false});
  const [customerInfo,  setCustomerInfo]  = useState(saved.customerInfo??{email:""});
  const [introReady,    setIntroReady]    = useState(false);
  const [introDone,     setIntroDone]     = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [sent,          setSent]          = useState(false);
  const [orderId,       setOrderId]       = useState(()=>saved.orderId??genOrderId());
  const [scanCount,     setScanCount]     = useState(null);
  const [pairNumber,    setPairNumber]    = useState(null);
  const [reserveError,  setReserveError]  = useState("");
  const [botField,      setBotField]      = useState("");
  const [debugEnabled]                     = useState(()=>new URLSearchParams(window.location.search).get("debug")==="1");
  const [resetToken,    setResetToken]    = useState(0);
  const scanCompletePostedRef              = useRef(false);

  // Measurements worth showing: by the time step 2 renders, measurements are
  // always confirmed (ScanStage's auto-advance effect confirms before advancing;
  // acceptMeasurements confirms too).
  const currentMeas=confirmedMeas;

  // Persist
  useEffect(()=>{
    if (step===0||sent) return;
    saveSession({
      step,confirmedMeas,calibration,founderAnswers,customerInfo,orderId,
    });
  },[step,sent,confirmedMeas,calibration,founderAnswers,customerInfo,orderId]);

  const chosenFrame=FITFRAME_FRAME;

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
    // Load once + refresh on tab return. No polling interval: the worker rate
    // limit is 5 req/min/IP shared across ALL /api routes, and a 20s poll ate
    // 3 of those — leaving checkout itself to fight for the remainder.
    load();
    const onVisible=()=>{ if(document.visibilityState==="visible") load(); };
    document.addEventListener("visibilitychange",onVisible);
    return ()=>{ cancelled=true; document.removeEventListener("visibilitychange",onVisible); };
  },[]);

  // Return path from Stripe Checkout. Stripe only hits ?checkout=success after payment —
  // trust that and show confirmation immediately; webhook handles backend state separately.
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const checkout=params.get("checkout");
    if (!checkout) return;
    const clearQuery=()=>window.history.replaceState({}, "", window.location.pathname);
    if (checkout==="cancelled"){ clearQuery(); return; }
    if (checkout!=="success") return;
    // Read the pair number optimistically; if the webhook hasn't fired yet it may be stale — that's ok.
    let cancelled=false;
    (async()=>{
      const cr=await fetch("/api/reservation-count").then(r=>r.ok?r.json():null).catch(()=>null);
      if (cancelled) return;
      // count>0 guard: if the webhook hasn't fired yet the counter can still be 0,
      // and the first founder must never see "pair #0".
      const count=cr?.ok&&Number.isFinite(cr.count)&&cr.count>0?cr.count:null;
      if (count!=null) setPairNumber(count);
      clearSession();
      setSent(true);
      setStep(4);
      clearQuery();
    })();
    return ()=>{ cancelled=true; };
  },[]);

  const postScanComplete=useCallback(()=>{
    if (scanCompletePostedRef.current) return;
    scanCompletePostedRef.current=true;
    fetch("/api/scan-complete",{method:"POST"})
      .then(r=>r.ok?r.json():null)
      .then(d=>{ if(d?.ok&&Number.isFinite(d.count)) setScanCount(d.count); })
      .catch(()=>{});
  },[]);

  function startFreshScan(){
    clearSession();
    setConfirmedMeas(null);
    setCalibration(null);
    setFounderAnswers({wearNow:"",whatsWrong:"",willShare:null,marketingOptIn:false});
    setReserveError("");
    setResetToken(t=>t+1);
    setSent(false);
    setSubmitting(false);
    scanCompletePostedRef.current=false;
    setStep(1);
  }

  function restartFlow(){
    clearSession();
    setConfirmedMeas(null);
    setCalibration(null);
    setFounderAnswers({wearNow:"",whatsWrong:"",willShare:null,marketingOptIn:false});
    setReserveError("");
    setPairNumber(null);
    setCustomerInfo({email:""});
    setOrderId(genOrderId());
    setSubmitting(false);
    setSent(false);
    setResetToken(t=>t+1);
    scanCompletePostedRef.current=false;
    setStep(0);
  }

  const shareYes=founderAnswers.willShare===true;
  const canReserve=isValidEmail(customerInfo.email.trim())&&shareYes
    &&founderAnswers.wearNow.trim()&&founderAnswers.whatsWrong.trim();

  async function reserve(e){
    if (e?.preventDefault) e.preventDefault();
    if (botField) return; // honeypot — silently ignore bots
    const email=customerInfo.email.trim();
    if (!isValidEmail(email)){ setReserveError("enter a valid email."); return; }
    if (!shareYes){ setReserveError("a founder photo + honest review is part of the deal."); return; }
    setSubmitting(true); setReserveError("");
    const m=currentMeas||{};
    try {
      const res=await fetch("/api/create-checkout-session",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          order_id:orderId,
          customer_email:email,
          frame_id:chosenFrame?.id||"fitframe-founders",
          frame:"Founder's Cut · PA12 nylon",
          lens:"blue light",
          // founder agreement answers
          wear_now:founderAnswers.wearNow.trim(),
          whats_wrong:founderAnswers.whatsWrong.trim(),
          will_share:"yes",
          marketing_opt_in:founderAnswers.marketingOptIn?"yes":"no",
          // measurements
          pd_binocular:m.pd, pd_left:m.pdLeft, pd_right:m.pdRight,
          bridge_width_mm:m.bridge, temple_mm:m.temple,
          face_height_mm:m.lensH, face_width_mm:m.faceW,
          scan_quality:m.scanQuality, valid_frames_pct:m.validPct,
          scale_source:m.scaleSource,
          timestamp:new Date().toISOString(),
          website:botField,
        }),
      });
      const data=await res.json().catch(()=>null);
      if (res.ok&&data?.ok&&data.url){
        window.location.assign(data.url); // hand off to Stripe-hosted checkout
        return;
      }
      setReserveError(data?.error||"couldn't open checkout. please try again.");
    } catch {
      setReserveError("network error. please try again.");
    } finally {
      setSubmitting(false);
    }
  }

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
              <p className="body-lg hero-sub">scan your face. answer a few questions. get frames built to your exact measurements.</p>
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
                <div className="price-big">$21</div>
                <div className="price-sub">$20 frame + $1 shipping · US only</div>
              </div>

              <ol className="feature-list">
                <li><span className="feature-num">01</span><span className="feature-text"><span className="feature-lead">your phone does what an optician does.</span> no appointment, no store.</span></li>
                <li><span className="feature-num">02</span><span className="feature-text"><span className="feature-lead">every measurement captured —</span> pd, bridge, temple, face width, face height.</span></li>
                <li><span className="feature-num">03</span><span className="feature-text"><span className="feature-lead">3D printed to your spec in pa12 nylon.</span> light, precise, durable.</span></li>
                <li><span className="feature-num">04</span><span className="feature-text"><span className="feature-lead">first batch is limited.</span> you're early.</span></li>
              </ol>

              <div className="why-block">
                <p className="why-lead">glasses are built for an average face. most of us aren't average.</p>
                <p className="why-body">FitFrame exists for the person who gave up without realizing it. after the scan, we print down to your specific measurements in our proprietary carbon fiber nylon — to your exact geometry. <span className="why-emph">no standardization. zero waste. yours.</span></p>
              </div>

              <div className="build-block">
                <div className="eyebrow build-eyebrow">how we build it</div>
                <p className="build-body">every pair starts with a browser-based scan. a facial landmark system maps your face from the camera feed and extracts the measurements that define a frame's fit — pupillary distance, bridge width, temple length, lens height, face width. a credit card or your own iris gives the scan a real millimeter scale. nothing leaves your device but the numbers.</p>
                <p className="build-body">those measurements go straight into a parametric print file. each frame is printed in pa12 nylon — light, durable, dimensionally precise — then hand-finished, fitted with US lab-cut blue light lenses, and shipped from America. zero inventory: nothing is made until you order it.</p>
                <p className="build-body">it's made-to-measure manufacturing run lean and built to scale carefully. if you care how things are actually made, this is the part for you.</p>
              </div>

              <FaqAccordion/>
            </div>
          )}

          {/* ── 1: Scan ── */}
          {step===1&&(
            <ScanStage
              calibration={calibration}
              setCalibration={setCalibration}
              confirmedMeas={confirmedMeas}
              setConfirmedMeas={setConfirmedMeas}
              onAdvance={()=>setStep(2)}
              onScanComplete={postScanComplete}
              debugEnabled={debugEnabled}
              resetToken={resetToken}
            />
          )}

          {/* ── 2: Your measurements (the free payoff) ── */}
          {step===2&&(()=>{
            const m=confirmedMeas||currentMeas||{};
            const fmt=v=>Number.isFinite(Number(v))&&v!=null&&v!==""?Number(v).toFixed(1):"—";
            const cells=[
              {label:"pupillary distance",value:fmt(m.pd),unit:"mm",wide:true},
              {label:"bridge",value:fmt(m.bridge),unit:"mm"},
              {label:"temple",value:fmt(m.temple),unit:"mm"},
              {label:"lens height",value:fmt(m.lensH),unit:"mm"},
              {label:"face width",value:fmt(m.faceW),unit:"mm"},
            ];
            return (
              <div className="section">
                <div className="eyebrow eyebrow-accent">your measurements</div>
                <div className="step-head">these are yours.</div>
                <div className="meas-grid">
                  {cells.map(c=>(
                    <div key={c.label} className={`meas-cell ${c.wide?"wide":""}`}>
                      <div className="meas-label">{c.label}</div>
                      <div className="meas-value">{c.value}<span className="meas-unit">{c.unit}</span></div>
                    </div>
                  ))}
                </div>
                <p className="reserve-note">these are yours. we don't keep your scan unless you claim a spot.</p>
                <div className="btn-row" style={{marginTop:8}}>
                  <button className="btn btn-accent" onClick={()=>{setReserveError("");setStep(3);}}>claim my founder pair →</button>
                  <button className="btn btn-ghost" onClick={()=>{setConfirmedMeas(null);setCalibration(null);setResetToken(t=>t+1);setStep(1);}}>rescan</button>
                </div>
              </div>
            );
          })()}

          {/* ── 3: The founder agreement ── */}
          {step===3&&!sent&&(
            <div className="section">
              <div className="step-head">claim your founder pair.</div>

              <form onSubmit={reserve}>
                <input className="hp-field" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
                  value={botField} onChange={e=>setBotField(e.target.value)}/>

                {FOUNDER_QUESTIONS.map(q=>(
                  <div className="founder-q" key={q.id}>
                    <div className="founder-q-label">{q.q}</div>
                    <input className="field" style={{marginBottom:0}} type="text" placeholder={q.placeholder}
                      aria-label={q.q} value={founderAnswers[q.id]}
                      onChange={e=>{setFounderAnswers(p=>({...p,[q.id]:e.target.value}));setReserveError("");}}/>
                  </div>
                ))}

                <div className="founder-q">
                  <div className="founder-q-label">will you share a photo + an honest review once your pair arrives?</div>
                  <div className="share-toggle" role="group" aria-label="share an honest photo and review">
                    <button type="button" className={`share-opt ${founderAnswers.willShare===true?"sel":""}`}
                      onClick={()=>{setFounderAnswers(p=>({...p,willShare:true}));setReserveError("");}}>yes</button>
                    <button type="button" className={`share-opt ${founderAnswers.willShare===false?"sel":""}`}
                      onClick={()=>{setFounderAnswers(p=>({...p,willShare:false}));}}>no</button>
                  </div>
                </div>

                <div className="receipt">
                  <div className="receipt-row"><span>founder's cut pair · pa12 nylon</span><span>${RESERVE_FRAME_PRICE} · at cost</span></div>
                  <div className="receipt-row"><span>shipping</span><span>${RESERVE_SHIPPING}</span></div>
                  <div className="receipt-total"><span>today</span><span>${RESERVE_TOTAL}</span></div>
                </div>

                <input className="field" placeholder="your email" aria-label="your email" type="email" inputMode="email" autoComplete="email"
                  value={customerInfo.email} onChange={e=>{setCustomerInfo(p=>({...p,email:e.target.value}));setReserveError("");}}/>
                <label className="marketing-opt" style={{display:"flex",alignItems:"flex-start",gap:10,marginTop:8,cursor:"pointer",fontSize:13,color:"var(--dim)",lineHeight:1.4}}>
                  <input type="checkbox" checked={founderAnswers.marketingOptIn}
                    onChange={e=>setFounderAnswers(p=>({...p,marketingOptIn:e.target.checked}))}
                    style={{marginTop:2,flexShrink:0}}/>
                  <span>keep me updated on new drops, restocks, and early access offers from FitFrame</span>
                </label>
                {reserveError&&<div className="waitlist-err">{reserveError}</div>}
                <div className="btn-row" style={{marginTop:10}}>
                  <button className="btn btn-accent" type="submit" disabled={!canReserve||submitting}>
                    {submitting?"opening checkout...":`reserve — $${RESERVE_TOTAL}`}
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={()=>setStep(2)}>Back</button>
                </div>
              </form>
              <p className="reserve-note">as a founder you agree to send a photo wearing them and an honest review (we ask before anything goes public).</p>
              <div className="trust-line"><Padlock/><span>no images are sent. your measurements go securely to the maker.</span></div>
            </div>
          )}

          {/* ── 4: Confirmation ── */}
          {sent&&step===4&&(
            <div className="section">
              <div className="eyebrow eyebrow-accent">you're a founder.</div>
              {pairNumber!=null&&<div className="confirm-pair">pair #{pairNumber}</div>}
              <p className="confirm-body">your spec is with the maker. we'll email you when your pair is printing — usually within 10 days.</p>
              <div className="btn-row" style={{marginTop:6}}>
                <button className="btn btn-ghost" type="button" onClick={()=>{
                  const link=`${DOMAIN_URL}/?ref=${encodeURIComponent(orderId)}`;
                  if (navigator.clipboard?.writeText){
                    navigator.clipboard.writeText(link).then(()=>setReserveError("link copied")).catch(()=>setReserveError(link));
                  } else { setReserveError(link); }
                }}>share fitframe with a friend</button>
              </div>
              {reserveError&&<div className="reserve-note" style={{color:"var(--accent)"}}>{reserveError}</div>}
              <p className="confirm-body" style={{marginTop:16}}>founder pricing stays locked, even as it rises for everyone else.</p>
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
