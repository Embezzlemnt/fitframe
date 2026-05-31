import { useEffect, useRef, useState } from "react";
import "./styles.css";
import { COLORWAYS, DEFAULT_LENS, FRAMES, STYLE_QUESTIONS } from "./data.js";
import useCamera from "./hooks/useCamera.js";
import useFaceScan from "./hooks/useFaceScan.js";
import { SCAN_SEQ, clearSession, genOrderId, getETA, loadSession, saveSession } from "./utils.js";

const DOMAIN = "fitframe.store";
const ACCENT_COLOR = "#4caf7d";
const BASE_PRICE = 119;
const LENS_OPTIONS = DEFAULT_LENS;

const EMPTY_CUSTOMER = { name:"", email:"", address:"", city:"", state:"", zip:"" };

const FAQS = [
  { q:"What are the frames made from?", a:"PA12 nylon — a lightweight, American-made material used in high-performance 3D printed parts. It has enough flex for daily wear while holding the custom geometry we generate from your scan. Durable, precise, and significantly lighter than acetate." },
  { q:"What about lenses?", a:"The founding pair includes clear blue light lenses. They filter high-energy blue light for everyday screen use. No medical claims — these are a comfort and style choice, not a vision correction product." },
  { q:"Can I get prescription lenses?", a:"Not at launch. We want prescription fulfillment to be as reliable as the frame fit before we offer it. It's in the plan. For now, the founding pair ships with blue light lenses only." },
  { q:"How does the scan work? How accurate is it?", a:"Your browser uses your front camera and a face landmark model to measure proportions — pupillary distance, bridge width, temple width, face height. No images leave your device. We target ±1.5mm accuracy, calibrated against a standard credit card for scale." },
  { q:"When can I order?", a:"We're opening in limited batches. Join the waitlist after your scan and frame selection — you'll get notified when your batch is ready. This keeps production manageable and guarantees every pair gets the attention it needs." },
  { q:"What's the returns and fit guarantee?", a:"Because every pair is made to your measurements, we don't do standard returns. If the fit is meaningfully off — the frame sits crooked, pinches, or slides in a way the scan should have caught — we'll use your data and your feedback to reprint it. One-time, no questions asked." },
];

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
  return s[id] || s.rectangle;
};

function ColorwaySVG({ colorway, size=88 }) {
  const gradId = `tortoise-${colorway.id}`;
  const fill = colorway.fill === "tortoise" ? `url(#${gradId})` : colorway.fill;
  return (
    <svg width={size} height={size*.5} viewBox="0 0 96 48" fill="none" aria-hidden="true">
      {colorway.fill === "tortoise"&&<defs><linearGradient id={gradId} x1="0" y1="0" x2="96" y2="48" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="var(--colorway-tortoise-1)"/><stop offset="0.38" stopColor="var(--colorway-tortoise-2)"/><stop offset="0.62" stopColor="var(--colorway-tortoise-3)"/><stop offset="1" stopColor="var(--colorway-tortoise-2)"/></linearGradient></defs>}
      <rect x="6" y="10" width="34" height="26" rx="8" fill={fill} stroke="rgba(255,255,255,.18)" strokeWidth="2"/>
      <rect x="56" y="10" width="34" height="26" rx="8" fill={fill} stroke="rgba(255,255,255,.18)" strokeWidth="2"/>
      <path d="M40 23.5 C44 20.5 52 20.5 56 23.5" stroke={fill} strokeWidth="5" strokeLinecap="round"/>
      <path d="M6 22 L0 18 M90 22 L96 18" stroke={fill} strokeWidth="5" strokeLinecap="round"/>
      <circle cx="20" cy="22" r="2.5" fill="rgba(255,255,255,.2)"/>
      <circle cx="70" cy="22" r="2.5" fill="rgba(255,255,255,.2)"/>
    </svg>
  );
}

function ProofIcon({ type }) {
  if (type === "flag") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4v16"/><path d="M4 5h14l-2 4 2 4H4"/><path d="M7 8h5"/></svg>;
  if (type === "box") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 8l8-4 8 4-8 4-8-4Z"/><path d="M4 8v8l8 4 8-4V8"/><path d="M12 12v8"/></svg>;
  if (type === "lock") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 12a8 8 0 0 1-13.6 5.7"/><path d="M4 12A8 8 0 0 1 17.6 6.3"/><path d="M17 2v5h-5"/><path d="M7 22v-5h5"/></svg>;
}

function FaceGuide({ fill, autoStartPct, facePresent, poseHint, faceSpan, showCard=false }) {
  const VW=400,VH=300,cx=200,cy=150,rx=78,ry=108;
  const h=((rx-ry)/(rx+ry))**2;
  const circ=Math.PI*(rx+ry)*(1+(3*h)/(10+Math.sqrt(4-3*h)));
  const bo=facePresent?.62:.2;
  const bx1=cx-rx-12,by1=cy-ry-12,bx2=cx+rx+12,by2=cy+ry+12,bl=13;
  const ringColor=faceSpan>0&&(faceSpan<0.34||faceSpan>0.72)?"rgba(229,166,74,0.5)":"rgba(76,175,125,0.6)";
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid slice" style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",zIndex:2}}>
      {[`M${bx1+bl},${by1} L${bx1},${by1} L${bx1},${by1+bl}`,`M${bx2-bl},${by1} L${bx2},${by1} L${bx2},${by1+bl}`,`M${bx1},${by2-bl} L${bx1},${by2} L${bx1+bl},${by2}`,`M${bx2},${by2-bl} L${bx2},${by2} L${bx2-bl},${by2}`].map((p,i)=><path key={i} d={p} stroke="rgba(255,255,255,.5)" strokeWidth="2" fill="none" strokeLinecap="round"/>)}
      {showCard&&<g opacity=".86"><rect x="126" y="212" width="148" height="43" rx="6" fill="none" stroke="rgba(76,175,125,.7)" strokeWidth="2" strokeDasharray="7 6"/><text x="200" y="239" textAnchor="middle" fill="rgba(255,255,255,.72)" fontSize="11" fontFamily="'Geist Mono',monospace">CARD HERE</text></g>}
      {autoStartPct>0&&autoStartPct<1&&<ellipse cx={cx} cy={cy} rx={rx+11} ry={ry+11} fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="2" strokeDasharray={`${autoStartPct*circ*1.1} 9999`} strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}/>}
      <ellipse cx={cx} cy={cy} rx={rx+6} ry={ry+6} fill="none" stroke={ringColor} strokeWidth="2" style={{transition:"stroke 0.3s ease"}}/>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={`rgba(255,255,255,${bo})`} strokeWidth="2" style={{transition:"stroke .4s ease"}}/>
      {fill>0&&<ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={ACCENT_COLOR} strokeWidth="3" strokeDasharray={`${circ*Math.min(fill,1)} ${circ+10}`} strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} style={{transition:"stroke-dasharray .1s linear"}}/>}
      <circle cx={cx-26} cy={cy-22} r="2" fill={`rgba(255,255,255,${bo})`} opacity=".4"/>
      <circle cx={cx+26} cy={cy-22} r="2" fill={`rgba(255,255,255,${bo})`} opacity=".4"/>
      {poseHint&&<text x={cx} y={cy+ry+22} textAnchor="middle" fill="rgba(255,255,255,.72)" fontSize="13" fontFamily="'Geist',-apple-system,sans-serif" fontWeight="300">{poseHint}</text>}
    </svg>
  );
}

const MEASURE_FIELDS = [
  { key:"pd", label:"PD", hint:"Distance between pupils. Typical range 56-74mm.", min:52, max:80 },
  { key:"bridge", label:"Bridge", hint:"Bridge width above your nose. Typical range 14-24mm.", min:10, max:28 },
  { key:"faceH", label:"Face H", hint:"Vertical face height used to scale the custom frame.", min:80, max:170 },
  { key:"temple", label:"Temple", hint:"Arm length from hinge to tip. Typical range 130-155mm.", min:120, max:170 },
];

function isSane(value, field) {
  if (value === "" || value == null) return null;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return false;
  return n >= field.min && n <= field.max;
}

function sanitizeText(value, max=160) {
  return value.trim().replace(/[<>"'&]/g, "").slice(0, max);
}

// --- Why Section ---
function WhySection() {
  return (
    <section className="why-section">
      <p className="why-lead">glasses are built for an average face. most of us aren't average.</p>
      <p className="why-body">FitFrame exists for the person who gave up without realizing it. one browser-based scan maps your face to real millimeter measurements. a carbon fiber nylon frame gets printed to those numbers — zero inventory, zero waste, built to your geometry. <span className="why-emph">not adjusted. not approximated. yours.</span></p>
    </section>
  );
}

// --- Brand Pillars ---
function PillarsSection() {
  const pillars = [
    { label:"made here", desc:"printed and finished in the US. not outsourced, not warehoused overseas." },
    { label:"zero inventory", desc:"each pair is made after your scan. nothing sits in a box waiting." },
    { label:"no branding", desc:"no logo on the frame. the fit is the statement." },
    { label:"zero waste", desc:"printed to order. no overstock, no landfill cycle." },
  ];
  return (
    <section className="pillars-section">
      <div className="pillars-grid">
        {pillars.map(p => (
          <div className="pillar" key={p.label}>
            <div className="pillar-label">{p.label}</div>
            <div className="pillar-desc">{p.desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- Process Photography Slots ---
function ProcessSection() {
  const slots = [
    { label:"raw PA12 material", caption:"the powder before it becomes your frame." },
    { label:"printer mid-job", caption:"layer by layer, shaped to your scan." },
    { label:"work in progress", caption:"finishing before it ships." },
  ];
  return (
    <section className="process-section">
      <div className="eyebrow">how it's made</div>
      <div className="process-grid">
        {slots.map(s => (
          <div className="process-slot" key={s.label}>
            <div className="process-img-placeholder" aria-label={s.label}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity=".3"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
            </div>
            <div className="process-caption">{s.caption}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- FAQ Page (standalone route) ---
function FAQPage() {
  useEffect(()=>{
    document.title = "FAQ | FitFrame";
    const existing = document.getElementById("fitframe-faq-schema");
    if (existing) existing.remove();
    const script = document.createElement("script");
    script.id = "fitframe-faq-schema";
    script.type = "application/ld+json";
    script.textContent = JSON.stringify({
      "@context":"https://schema.org",
      "@type":"FAQPage",
      mainEntity:FAQS.map(item=>({
        "@type":"Question",
        name:item.q,
        acceptedAnswer:{ "@type":"Answer", text:item.a }
      }))
    });
    document.head.appendChild(script);
    return ()=>script.remove();
  },[]);

  return (
    <div className="app" style={{"--accent":ACCENT_COLOR}}>
      <header className="site-header"><a className="logo" href="/">FitFrame<span className="logo-dot">.</span></a><div className="header-nav"><a className="header-link" href="/">Scan</a><div className="header-tag">FAQ</div></div></header>
      <main className="container">
        <section className="section faq-page">
          <div className="eyebrow">common questions</div>
          <h1 className="step-head">FitFrame faq.</h1>
          <p className="step-sub">straight answers about materials, lenses, the scan, and how orders work.</p>
          <div className="faq-list">
            {FAQS.map((item,index)=><details className="faq-item" key={item.q} open={index===0}><summary>{item.q}</summary><p>{item.a}</p></details>)}
          </div>
          <div className="btn-row" style={{marginTop:24}}><a className="btn btn-primary checkout-submit" href="/">scan your face</a></div>
        </section>
      </main>
      <div className="site-footer"><span>{DOMAIN}</span><span className="footer-dot">·</span><a href="/" className="footer-link">Start scan</a></div>
    </div>
  );
}

// --- Waitlist Gate (replaces order/checkout at result step) ---
function WaitlistGate({ measurements, frameId, colorwayId, scanCount, onAlreadyJoined }) {
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem("ff_waitlist_email") || ""; } catch { return ""; }
  });
  const [status, setStatus] = useState(() => {
    try { return localStorage.getItem("ff_waitlist_status") || null; } catch { return null; }
  });
  const [position, setPosition] = useState(null);
  const [liveCount, setLiveCount] = useState(scanCount);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Check returning user
  useEffect(() => {
    const saved = (() => { try { return localStorage.getItem("ff_waitlist_email"); } catch { return null; } })();
    const savedStatus = (() => { try { return localStorage.getItem("ff_waitlist_status"); } catch { return null; } })();
    if (saved && savedStatus === "joined") {
      setEmail(saved);
      setStatus("joined");
      if (onAlreadyJoined) onAlreadyJoined();
    }
  }, []);

  useEffect(() => {
    fetch("/api/waitlist-count")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.count) setLiveCount(d.count); })
      .catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          measurements: measurements || null,
          frame_id: frameId || null,
          colorway_id: colorwayId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not join the list.");
      setStatus("joined");
      setPosition(data.position || null);
      if (data.count) setLiveCount(data.count);
      try {
        localStorage.setItem("ff_waitlist_email", trimmed);
        localStorage.setItem("ff_waitlist_status", "joined");
      } catch {}
    } catch (err) {
      setError(err.message || "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "joined") {
    return (
      <div className="waitlist-gate">
        <div className="wg-confirmed">
          <div className="wg-check">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={ACCENT_COLOR} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div className="wg-confirmed-head">you're in.</div>
          <p className="wg-confirmed-body">we'll reach out when your batch opens. your frame spec is saved — we have everything we need.</p>
          {position && <div className="wg-position">#{position} on the list</div>}
          {liveCount > 0 && <div className="wg-count">{liveCount.toLocaleString()} faces scanned so far</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="waitlist-gate">
      <div className="wg-head">orders open in limited batches.</div>
      <p className="wg-sub">be first. drop your email and we'll reach out when your batch is ready. your scan result and frame selection are saved.</p>
      {liveCount > 0 && <div className="wg-count">{liveCount.toLocaleString()} faces scanned</div>}
      <form className="wg-form" onSubmit={handleSubmit} noValidate>
        <input
          className="wg-input"
          type="email"
          placeholder="your email"
          autoComplete="email"
          value={email}
          onChange={e => { setEmail(e.target.value); setError(null); }}
        />
        <button className="btn btn-primary wg-submit" disabled={submitting}>
          {submitting ? "saving…" : "join the list →"}
        </button>
      </form>
      {error && <div className="submit-error wg-error">{error}</div>}
      <p className="wg-note">no spam. one email when your batch opens.</p>
    </div>
  );
}

export default function FramesSite(){
  const path = window.location.pathname;
  if (path === "/faq") return <FAQPage/>;
  if (path === "/returns" || path === "/return-policy") return <ReturnsPage/>;
  return <FitFrameApp/>;
}

function ReturnsPage() {
  useEffect(()=>{ document.title = "Returns & Reprints | FitFrame"; },[]);

  return (
    <div className="app" style={{"--accent":ACCENT_COLOR}}>
      <header className="site-header"><a className="logo" href="/">FitFrame<span className="logo-dot">.</span></a><div className="header-nav"><a className="header-link" href="/faq">FAQ</a><div className="header-tag">Returns</div></div></header>
      <main className="container">
        <section className="section faq-page">
          <div className="eyebrow">Policy</div>
          <h1 className="step-head">Returns & Reprints.</h1>
          <div className="returns-copy">
            <p>Every FitFrame is made to order from your scan. Because each pair is printed to your measurements, we don't accept returns for fit preference — that's the nature of custom manufacturing.</p>
            <p>However, if your frame arrives with a manufacturing defect — broken hinge, structural crack, lens that won't seat — we will reprint and reship at no cost. No forms, no back-and-forth. Email hello@fitframe.store with your order ID and a photo.</p>
            <p>If your scan measurements were significantly off and the frame is unwearable, email us. We'll review the scan data and determine whether a reprint is warranted. We'd rather fix it than lose you.</p>
            <p>One reprint per order. Reprint requests accepted within 30 days of delivery.</p>
          </div>
          <div className="btn-row" style={{marginTop:24}}><a className="btn btn-primary checkout-submit" href="/">Scan your face</a></div>
        </section>
      </main>
      <div className="site-footer"><span>{DOMAIN}</span><span className="footer-dot">·</span><a href="/faq" className="footer-link">FAQ</a></div>
    </div>
  );
}

function FitFrameApp(){
  const saved=loadSession()||{};
  const [step, setStep] = useState(saved.step??0);
  const [confirmedMeas, setConfirmedMeas] = useState(saved.confirmedMeas??null);
  const [styleAnswers, setStyleAnswers] = useState(saved.styleAnswers??{});
  const [styleQIdx, setStyleQIdx] = useState(saved.styleQIdx??0);
  const [tapped, setTapped] = useState(null);
  const [lensChoice, setLensChoice] = useState(saved.lensChoice??null);
  const [rxForm] = useState(saved.rxForm??{odSphere:"",odCyl:"",odAxis:"",osSphere:"",osCyl:"",osAxis:""});
  const [selectedFrame, setSelectedFrame] = useState(saved.selectedFrame??null);
  const [selectedColorway, setSelectedColorway] = useState(saved.selectedColorway??"matte-black");
  const [focusedField, setFocusedField] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanCount, setScanCount] = useState(47);
  const [cardCalibrating, setCardCalibrating] = useState(false);
  const [cardCaptured, setCardCaptured] = useState(saved.cardCaptured??false);
  const [calDwell, setCalDwell] = useState(0);
  const [calMoved, setCalMoved] = useState(false);
  const [calCapturedFlash, setCalCapturedFlash] = useState(false);

  const canvasRef=useRef(null);
  const scanCountedRef=useRef(false);
  const { videoRef, ready:camReady, loading:camLoading, camErr, start:startCamera, stop:stopCamera }=useCamera();
  const scan=useFaceScan({videoRef,scanning,canvasRef,onAutoStart:()=>cardCaptured&&setScanning(true)});
  const currentMeas=confirmedMeas||scan.measurements;

  const suggestedTags=Object.values(styleAnswers).flatMap(a=>a?.tags||[]);
  const topFrames=[...FRAMES].map(f=>({...f,score:f.tags.filter(t=>suggestedTags.includes(t)).length})).sort((a,b)=>b.score-a.score);
  const maxScore=Math.max(1,...topFrames.map(f=>f.score));
  const chosenFrame=FRAMES.find(f=>f.id===selectedFrame)||topFrames[0];
  const chosenColorway=COLORWAYS.find(c=>c.id===selectedColorway)||COLORWAYS[0];

  async function hydrateCheckoutSession(sessionId) {
    try {
      const res = await fetch(`/api/checkout-session?session_id=${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      if (!res.ok || !data.ok) return;
      setPaymentDetails({
        session_id:data.session_id,
        payment_intent:data.payment_intent,
        payment_status:data.payment_status,
        customer_email:data.customer_email,
        metadata:data.metadata,
      });
    } catch {
      setPaymentDetails(p=>p||{session_id:sessionId,payment_status:"paid"});
    }
  }

  async function recordScanComplete() {
    if (scanCountedRef.current) return;
    scanCountedRef.current = true;
    try {
      const res = await fetch("/api/scan-complete", { method:"POST" });
      const data = await res.json();
      if (res.ok && data?.count) setScanCount(data.count);
    } catch {
      scanCountedRef.current = false;
    }
  }

  useEffect(()=>{
    fetch("/api/scan-count")
      .then(res=>res.ok?res.json():null)
      .then(data=>{ if (data?.count) setScanCount(data.count); })
      .catch(()=>{});
  },[]);

  useEffect(()=>{
    if (step===0) return;
    saveSession({step,confirmedMeas,styleAnswers,styleQIdx,lensChoice,rxForm,selectedFrame,selectedColorway,cardCaptured});
  },[step,confirmedMeas,styleAnswers,styleQIdx,lensChoice,rxForm,selectedFrame,selectedColorway,cardCaptured]);

  useEffect(()=>{ if(step!==1) stopCamera(); },[step,stopCamera]);
  useEffect(()=>{
    const handleVisibility=()=>{ if(document.hidden&&step===1) stopCamera(); };
    document.addEventListener("visibilitychange",handleVisibility);
    return ()=>document.removeEventListener("visibilitychange",handleVisibility);
  },[step,stopCamera]);
  useEffect(()=>{ if(scan.done) setScanning(false); },[scan.done]);
  useEffect(()=>{ if(scan.scanLost) setScanning(false); },[scan.scanLost]);
  useEffect(()=>{ if(scan.scanError) setScanning(false); },[scan.scanError]);
  useEffect(()=>{ setTapped(null); },[styleQIdx]);
  useEffect(()=>{
    if (scan.measurements&&!scan.quality?.rescan){
      recordScanComplete();
      const t=setTimeout(()=>{ setConfirmedMeas(scan.measurements); setStep(2); },1400);
      return ()=>clearTimeout(t);
    }
  },[scan.measurements,scan.quality]);

  useEffect(()=>{
    if (!cardCalibrating || !camReady || !scan.mpReady || cardCaptured) return;
    let raf;
    let start=null;
    const stable = () => scan.facePresent && !scan.poseHint;
    const tick = now => {
      if (!stable()) {
        start=null;
        setCalDwell(0);
        setCalMoved(true);
        raf=requestAnimationFrame(tick);
        return;
      }
      setCalMoved(false);
      if (!start) start=now;
      const pct=Math.min((now-start)/2000,1);
      setCalDwell(pct);
      if (pct>=1) {
        setCardCaptured(true);
        setCardCalibrating(false);
        setCalCapturedFlash(true);
        setTimeout(()=>setCalCapturedFlash(false),1000);
        return;
      }
      raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(raf);
  },[cardCalibrating,camReady,scan.mpReady,scan.facePresent,scan.poseHint,cardCaptured]);

  async function recordScanComplete() {
    if (scanCountedRef.current) return;
    scanCountedRef.current = true;
    try {
      const res = await fetch("/api/scan-complete", { method:"POST" });
      const data = await res.json();
      if (res.ok && data?.count) setScanCount(data.count);
    } catch {
      scanCountedRef.current = false;
    }
  }

  function selectOption(opt){
    setTapped(opt.label);
    const qId=STYLE_QUESTIONS[styleQIdx].id;
    setStyleAnswers(prev=>({...prev,[qId]:opt}));
    if (styleQIdx<STYLE_QUESTIONS.length-1) setTimeout(()=>setStyleQIdx(i=>i+1),220);
    else setTimeout(()=>setStep(3),300);
  }

  function resetScanFlow(){
    scan.reset();
    setScanning(false);
    setConfirmedMeas(null);
  }

  function scanBadge(){
    if(scan.done&&scan.quality?.rescan) return {label:"RESCAN",tone:"red"};
    if(scan.done&&scan.quality?.label==="Excellent") return {label:"EXCELLENT",tone:"good"};
    if(scan.done&&(scan.quality?.label==="Good"||scan.quality?.label==="Fair")) return {label:scan.quality.label.toUpperCase(),tone:"amber"};
    if(scanning&&scan.seqIdx>=0&&!scan.done) return {label:"SCANNING",tone:"good"};
    return {label:"READY",tone:""};
  }

  // Steps: 0=hero, 1=scan, 2=style, 3=lenses, 4=frames, 5=colorway, 6=result+waitlist
  const dots=[1,2,3,4,5,6].map(i=>({done:step>i,active:step===i}));
  const activeMeasure=MEASURE_FIELDS.find(f=>f.key===focusedField);
  const badge=scanBadge();

  return (
    <div className="app" style={{"--accent":ACCENT_COLOR}}>
      <header className="site-header">
        <a className="logo" href="/">FitFrame<span className="logo-dot">.</span></a>
        <div className="header-nav">
          <a className="header-link" href="/faq">FAQ</a>
          <div className="header-tag">{DOMAIN}</div>
        </div>
      </header>
      {step>0&&<div className="prog-strip">{dots.map((d,i)=><div key={i} className={`prog-dot ${d.done?"done":d.active?"active":""}`}/>)}</div>}

      <div className="container">

        {/* STEP 0 — HERO + WHY + PROCESS + PILLARS + FAQ PREVIEW */}
        {step===0&&<>
          <div className="section">
            <div className="eyebrow">made-to-measure eyewear</div>
            <div className="display">frames built<br/>for <em>your</em> face.</div>
            <p className="body-lg">scan your face. answer four questions. get frames built to your exact measurements.</p>
            <div className="hero-meta">
              <div className="scan-count">{scanCount.toLocaleString()} faces scanned</div>
              <a className="hero-faq-link" href="/faq">questions? →</a>
            </div>
            <div className="btn-row" style={{marginBottom:8}}>
              <button className="btn btn-primary" style={{flex:1}} onClick={()=>setStep(1)}>scan your face →</button>
            </div>
            <div className="proof-strip">
              <span className="proof-item"><ProofIcon type="flag"/>made in america</span>
              <span className="proof-item"><ProofIcon type="box"/>ships in ~10 days</span>
              <span className="proof-item"><ProofIcon type="refresh"/>fit guarantee</span>
              <span className="proof-item"><ProofIcon type="lock"/>no images stored</span>
            </div>
          </div>

          <WhySection/>

          <ProcessSection/>

          <PillarsSection/>

          <div className="section" style={{paddingTop:8}}>
            <div className="features">
              {[
                ["01",<><strong>browser scan, no app.</strong> your camera maps pd, bridge, temple, and face height in under two minutes.</>],
                ["02",<><strong>custom geometry, not adjustments.</strong> the frame spec is generated from your measurements, not bent to fit afterward.</>],
                ["03",<><strong>pa12 nylon, 3d printed.</strong> lightweight, precise, and durable. a material built for this kind of work.</>],
                ["04",<><strong>founding batch.</strong> join the list — orders open soon.</>],
              ].map(([n,t])=><div className="feature-row" key={n}><span className="feature-num">{n}</span><span className="feature-text">{t}</span></div>)}
            </div>
          </div>

          <div className="section faq-preview" style={{paddingTop:0}}>
            <div className="eyebrow">common questions</div>
            <div className="faq-list">
              {FAQS.slice(0,3).map((item,i)=><details className="faq-item" key={item.q} open={i===0}><summary>{item.q}</summary><p>{item.a}</p></details>)}
            </div>
            <div className="btn-row" style={{marginTop:14}}>
              <a className="btn btn-ghost" href="/faq">all questions →</a>
              <button className="btn btn-primary" style={{flex:1}} onClick={()=>setStep(1)}>scan your face →</button>
            </div>
          </div>
        </>}

        {/* STEP 1 — SCAN */}
        {step===1&&<div className="section">
          <div className="eyebrow">step 1 of 6 — face scan</div>
          <div className="step-head">{scanning?"stay still.":scan.done?"scan complete.":"position your face."}</div>
          <p className="step-sub">{cardCalibrating?"hold the card flat below your chin — keep still":scanning?"we're capturing your measurements.":scan.done?"processing your measurements.":"center your face inside the oval and hold still. the scan starts automatically."}</p>
          <p className="privacy-note">your camera is used only for measurement. no images are stored or transmitted.</p>
          {camReady&&!scan.mpReady&&!scan.mpLoadError&&!scan.done&&<div className="cam-placeholder loading"><div className="mp-spinner"/><div className="cam-sub" style={{fontSize:13}}>preparing face scanner…</div></div>}
          {scan.mpLoadError&&<div className="cam-placeholder"><div className="cam-label" style={{color:"var(--red)"}}>face scan couldn't load.</div><div className="cam-sub">check your connection and reload the page.</div><button className="btn btn-ghost" onClick={()=>window.location.reload()}>reload page</button></div>}
          {camReady&&scan.mpReady&&!scan.done&&<>
            <div className="cam-outer">
              <div className="cam-inner">
                <video ref={videoRef} autoPlay playsInline muted/>
                <canvas ref={canvasRef}/>
                <div className="cam-vignette"/>
                <FaceGuide fill={scan.fill} autoStartPct={scan.autoStartPct} facePresent={scan.facePresent} poseHint={scan.poseHint} faceSpan={scan.faceSpan} showCard={cardCalibrating&&!cardCaptured}/>
                <div className="cam-top">
                  <span className={`scan-tag ${badge.tone}`}>{badge.label}</span>
                  {scanning&&scan.seqIdx>=0&&<span className="scan-pct">{Math.round(scan.fill*100)}%</span>}
                </div>
                <div className="cam-bottom">
                  {scan.pauseWarning&&<div className="pause-warning">Hold still — scan paused</div>}
                  {scanning&&scan.seqIdx>=0?<div className="scan-inst">{SCAN_SEQ[Math.min(scan.seqIdx,SCAN_SEQ.length-1)].instruction}</div>:scan.poseHint?<div className="scan-inst" style={{color:"var(--amber)"}}>{scan.poseHint}</div>:scan.autoStartPct>0&&scan.autoStartPct<1?<div className="scan-inst">hold still…</div>:<div className="scan-inst">look directly at the camera.</div>}
                  {scan.lightWarning&&<div className="light-warning">{scan.lightWarning}</div>}
                </div>
              </div>
            </div>
            {cardCalibrating&&!cardCaptured&&<>
              <div className={`cal-status ${calMoved?"warn":""}`}>{calMoved?"moved — hold steady to recapture":"hold the card flat below your chin — keep still"}</div>
              <div className="cal-dwell-bar"><div className="cal-dwell-fill" style={{width:`${Math.round(calDwell*100)}%`}}/></div>
            </>}
            {calCapturedFlash&&<div className="cal-status good">✓ card captured</div>}
          </>}
          {step===1&&camReady&&scan.done&&<canvas ref={canvasRef} style={{display:"none"}}/>}
          {!camReady&&!camErr&&!currentMeas&&<div className="cam-placeholder"><div className="cam-icon"><svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div><div className="cam-label">camera access needed</div><div className="cam-sub">FitFrame uses your front camera to measure your face. nothing leaves your device.</div><button className="btn btn-primary" style={{marginTop:4}} onClick={startCamera}>allow camera</button></div>}
          {camErr&&<div className="cam-placeholder"><div className="cam-label" style={{color:"var(--red)"}}>{camErr.headline}</div>{camErr.type==="denied"?<div className="err-box">{camErr.detail}</div>:<div className="cam-sub">{camErr.detail}</div>}{camErr.fix==="retry"&&<button className="btn btn-ghost" onClick={startCamera}>try again</button>}{camErr.fix==="reload"&&<button className="btn btn-ghost" onClick={()=>location.reload()}>reload page</button>}</div>}
          {scan.scanError&&<div className="cam-placeholder" style={{marginTop:0}}><div className="cam-label" style={{color:"var(--red)"}}>scan stalled.</div><div className="cam-sub">{scan.scanError}</div><button className="btn btn-ghost" onClick={()=>{scan.reset();setScanning(false);}}>retry scan</button></div>}
          {scan.scanLost&&<div className="cam-placeholder" style={{marginTop:0}}><div className="cam-label" style={{color:"var(--amber)"}}>scan lost.</div><div className="cam-sub">position your face and tap start again.</div><button className="btn btn-ghost" onClick={()=>{scan.reset();setScanning(false);}}>try again</button></div>}
          {camReady&&scan.mpReady&&!scan.done&&!scanning&&!scan.scanLost&&!scan.scanError&&!calCapturedFlash&&<div style={{textAlign:"center",marginTop:14}}>{!cardCaptured?<button className="btn btn-primary" onClick={()=>{setCardCalibrating(true);setCalDwell(0);}}>calibrate with card</button>:<button className="btn btn-primary" onClick={()=>setScanning(true)}>start scan</button>}</div>}
          {scan.done&&!currentMeas&&<div className="cam-placeholder" style={{marginTop:0}}><div className="cam-label" style={{color:"var(--red)"}}>{scan.quality?.label==="Low"?"let's try that again.":"no face data captured."}</div><div className="cam-sub">{scan.quality?.reason||"Ensure your face is well-lit and centered."}</div><button className="btn btn-ghost" style={{marginTop:4}} onClick={resetScanFlow}>try again</button></div>}
          {currentMeas&&scan.quality?.rescan&&<div className="cam-placeholder" style={{marginTop:0}}><div className="cam-label">let's try that again.</div><div className="cam-sub">{scan.quality.reason||"Face the camera straight on in good light and hold still."}</div><button className="btn btn-primary" style={{marginTop:4}} onClick={resetScanFlow}>rescan</button></div>}
          {currentMeas&&!scan.quality?.rescan&&<div className="scan-ok">measurements captured. moving forward…</div>}
        </div>}

        {/* STEP 2 — STYLE */}
        {step===2&&(()=>{ const q=STYLE_QUESTIONS[styleQIdx]; return <div className="section" key={styleQIdx}><div className="eyebrow">step 2 of 6 — style</div><div className="q-meta"><span className="q-counter">{styleQIdx+1} / {STYLE_QUESTIONS.length}</span></div><div className="q-label">{q.q}</div><div className="choices">{q.options.map((opt,i)=><button key={`q${styleQIdx}-o${i}`} className={`choice ${tapped===opt.label?"chosen":""}`} onClick={()=>selectOption(opt)}>{opt.label}</button>)}</div>{styleQIdx>0&&<div style={{marginTop:20}}><button className="btn btn-ghost" onClick={()=>{const prev={...styleAnswers};delete prev[STYLE_QUESTIONS[styleQIdx-1].id];setStyleAnswers(prev);setStyleQIdx(i=>i-1);}}>← back</button></div>}</div>; })()}

        {/* STEP 3 — LENSES */}
        {step===3&&<div className="section">
          <div className="eyebrow">step 3 of 6 — lenses</div>
          <div className="step-head">choose your lens.</div>
          <p className="step-sub">blue light lenses are included in the founding pair. no medical claims — comfort and screen use.</p>
          <div className="lens-list">
            {LENS_OPTIONS.map(l=><div key={l.id} className={`lens-row ${lensChoice===l.id?"sel":""}`} onClick={()=>setLensChoice(l.id)}><div className="lens-info"><div className="lens-name">{l.label}</div><div className="lens-desc">{l.desc}</div>{l.spec&&<div className="lens-spec">{l.spec}</div>}</div><div className="lens-price">included</div></div>)}
          </div>
          <div className="lens-disclaimer">prescription support is in development. the founding pair ships with clear blue light lenses.</div>
          <div className="btn-row">
            <button className="btn btn-primary" disabled={!lensChoice} onClick={()=>setStep(4)}>choose your frame →</button>
            <button className="btn btn-ghost" onClick={()=>setStep(2)}>back</button>
          </div>
        </div>}

        {/* STEP 4 — FRAMES */}
        {step===4&&<div className="section">
          <div className="eyebrow">step 4 of 6 — frame</div>
          <div className="step-head">pick your shape.</div>
          <p className="step-sub">your top match is highlighted based on your answers. choose the one that feels right.</p>
          <div className="frame-grid">
            {topFrames.map((f,i)=><div key={f.id} className={`frame-tile ${selectedFrame?selectedFrame===f.id?"sel":"":i===0?"sel":""}`} onClick={()=>setSelectedFrame(f.id)}>{i===0&&<div className="best-badge">best match</div>}<div className="frame-tile-icon"><FrameSVG id={f.id} size={52} color={(selectedFrame?selectedFrame===f.id:i===0)?"var(--accent)":"var(--border2)"}/></div><div className="frame-tile-name">{f.label}</div><div className="frame-tile-desc">{f.desc}</div>{f.score>0&&<div className="frame-tile-bar" style={{width:`${Math.round((f.score/maxScore)*100)}%`}}/>}</div>)}
          </div>
          <div className="btn-row" style={{marginTop:8}}>
            <button className="btn btn-primary" onClick={()=>{if(!selectedFrame)setSelectedFrame(topFrames[0]?.id);setStep(5);}}>choose colorway →</button>
            <button className="btn btn-ghost" onClick={()=>setStep(3)}>back</button>
          </div>
        </div>}

        {/* STEP 5 — COLORWAY */}
        {step===5&&<div className="section">
          <div className="eyebrow">step 5 of 6 — colorway</div>
          <div className="step-head">choose the finish.</div>
          <p className="step-sub">one decision, three finishes. matte black is the default recommendation for most face shapes.</p>
          <div className="colorway-grid">
            {COLORWAYS.map(c=><button key={c.id} className={`colorway-card ${selectedColorway===c.id?"sel":""}`} onClick={()=>setSelectedColorway(c.id)}>{c.recommended&&<span className="colorway-badge">recommended for your face shape</span>}<div className="colorway-preview"><ColorwaySVG colorway={c}/></div><div><div className="colorway-name">{c.label}</div><div className="colorway-desc">{c.desc}</div></div></button>)}
          </div>
          <div className="btn-row">
            <button className="btn btn-primary checkout-submit" onClick={()=>setStep(6)}>see your result →</button>
            <button className="btn btn-ghost" onClick={()=>setStep(4)}>back</button>
          </div>
        </div>}

        {/* STEP 6 — RESULT + WAITLIST GATE */}
        {step===6&&<div className="section">
          <div className="eyebrow">your frame — designed by your face</div>
          <div className="step-head">your spec is ready.</div>
          <p className="step-sub">here's what we captured. join the founding list and we'll reach out when your batch opens.</p>

          {/* Measurements summary */}
          <div className="result-spec">
            <div className="result-spec-head">face measurements</div>
            <div className="measure-grid">
              {MEASURE_FIELDS.map(field=>{
                const value=field.key==="faceH"?(currentMeas?.faceH||currentMeas?.lensH||""):currentMeas?.[field.key]||"";
                const sane=isSane(value,field);
                return (
                  <div className="measure-field" key={field.key}>
                    <label>{field.label}</label>
                    <input
                      className="measure-input"
                      inputMode="decimal"
                      value={value}
                      onFocus={()=>setFocusedField(field.key)}
                      onBlur={()=>setFocusedField(null)}
                      onChange={e=>setConfirmedMeas(p=>({...currentMeas,...p,[field.key]:e.target.value}))}
                    />
                    {sane!==null&&<span className={`measure-dot ${sane?"ok":""}`}/>}
                  </div>
                );
              })}
            </div>
            {activeMeasure&&<div className="measure-tooltip">{activeMeasure.hint}</div>}
          </div>

          {/* Frame summary */}
          <div className="result-frame-summary">
            <div className="rfs-row">
              <span className="rfs-label">frame</span>
              <span className="rfs-value">{chosenFrame?.label || "—"}</span>
            </div>
            <div className="rfs-row">
              <span className="rfs-label">colorway</span>
              <span className="rfs-value">{chosenColorway?.label || "—"}</span>
            </div>
            <div className="rfs-row">
              <span className="rfs-label">lenses</span>
              <span className="rfs-value">Blue Light (included)</span>
            </div>
          </div>

          {/* Waitlist gate — replaces checkout */}
          <WaitlistGate
            measurements={currentMeas}
            frameId={chosenFrame?.id}
            colorwayId={chosenColorway?.id}
            scanCount={scanCount}
          />

          <div className="btn-row" style={{marginTop:20}}>
            <button className="btn btn-ghost" onClick={()=>setStep(5)}>back</button>
            <a className="btn btn-ghost" href="/faq">faq →</a>
          </div>
        </div>}

      </div>

      <div className="site-footer">
        <span>{DOMAIN}</span>
        <span className="footer-dot">·</span>
        <a href="/faq" className="footer-link">FAQ</a>
        <span className="footer-dot">·</span>
        <a href="/returns" className="footer-link">Returns</a>
        <span className="footer-dot">·</span>
        <a href={`mailto:hello@${DOMAIN}`} className="footer-link">hello@{DOMAIN}</a>
      </div>
    </div>
  );
}
