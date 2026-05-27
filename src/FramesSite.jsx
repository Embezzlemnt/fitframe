import { useEffect, useRef, useState } from "react";
import "./styles.css";
import { COLORWAYS, DEFAULT_LENS, FRAMES, STYLE_QUESTIONS } from "./data.js";
import useCamera from "./hooks/useCamera.js";
import useFaceScan from "./hooks/useFaceScan.js";
import { SCAN_SEQ, clearSession, genOrderId, getETA, loadSession, saveSession } from "./utils.js";

const DOMAIN = "fitframe.store";
const ACCENT_COLOR = "#4caf7d";
const BASE_PRICE = 89;
const LENS_OPTIONS = DEFAULT_LENS;

const EMPTY_CUSTOMER = { name:"", email:"", address:"", city:"", state:"", zip:"" };

const FAQS = [
  { q:"How does the face scan work and is it private?", a:"The scan runs in your browser using your camera and face landmarks. It measures proportions like PD, bridge width, temple width, and face height. FitFrame does not upload or store camera images; only the measurement values move forward into checkout." },
  { q:"What are the glasses made from?", a:"Frames are made from PA12 nylon, a lightweight material commonly used for durable 3D printed parts. It has enough flex for daily wear while holding the custom shape we generate from your scan." },
  { q:"Do you offer prescription lenses?", a:"Not yet. The launch pair uses clear blue light lenses. Prescription support is planned, but we do not want to offer it until the verification and fulfillment process is as reliable as the frame fit." },
  { q:"How long does shipping take?", a:"Most orders are expected to ship in about 7 to 10 days after payment and spec review. You will hear from us within 2 business days if anything in the scan needs a quick confirmation before printing." },
  { q:"What if my frames don't fit?", a:"FitFrame includes a one-time reprint guarantee. If the frame fit is meaningfully off, contact us with the issue and we will use the scan data and your feedback to make it right." },
  { q:"Are these glasses durable?", a:"Yes. PA12 is chosen because it is light, resilient, and well suited to daily-use objects. Like any eyewear, the frames should still be kept out of extreme heat and protected from crushing force." },
  { q:"How do I care for my frames?", a:"Rinse dust away before wiping lenses, use a microfiber cloth, and store the frames in a case when they are not on your face. Avoid alcohol wipes on the frame surface because they can dull the finish over time." },
  { q:"What is your return policy?", a:"Every FitFrame is made to order from your scan, so we do not accept returns for fit preference. If there is a manufacturing defect or the scan measurements were significantly off, we review the order and prioritize a correction or one-time reprint." },
  { q:"Can I choose my lens type?", a:"At launch, checkout is fixed at $89 for clear blue light lenses. The interface shows the lens direction we are building toward, but paid orders today are fulfilled as the included blue light pair." },
  { q:"Why $89 — what am I actually paying for?", a:"You are paying for a made-to-measure frame workflow: browser scan, custom frame geometry, PA12 3D printing, finishing, lenses, packing, and shipping. The goal is a price that feels closer to normal eyewear while solving the fit problem custom frames usually make expensive." },
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
          <div className="eyebrow">Buyer questions</div>
          <h1 className="step-head">FitFrame FAQ.</h1>
          <p className="step-sub">Straight answers about the scan, materials, shipping, fit guarantee, and what the $89 pair includes.</p>
          <div className="faq-list">
            {FAQS.map((item,index)=><details className="faq-item" key={item.q} open={index===0}><summary>{item.q}</summary><p>{item.a}</p></details>)}
          </div>
          <div className="btn-row" style={{marginTop:24}}><a className="btn btn-primary checkout-submit" href="/">Scan your face</a></div>
        </section>
      </main>
      <div className="site-footer"><span>{DOMAIN}</span><span className="footer-dot">·</span><a href="/" className="footer-link">Start scan</a></div>
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
  const [customerInfo, setCustomerInfo] = useState({...EMPTY_CUSTOMER,...(saved.customerInfo||{})});
  const [focusedField, setFocusedField] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(saved.sent??false);
  const [pendingOrder, setPendingOrder] = useState(saved.pendingOrder??null);
  const [paymentDetails, setPaymentDetails] = useState(saved.paymentDetails??null);
  const [scanCount, setScanCount] = useState(47);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [waitlistStatus, setWaitlistStatus] = useState(null);
  const [waitlistError, setWaitlistError] = useState(null);
  const [waitlistSubmitting, setWaitlistSubmitting] = useState(false);
  const [cardCalibrating, setCardCalibrating] = useState(false);
  const [cardCaptured, setCardCaptured] = useState(saved.cardCaptured??false);
  const [calDwell, setCalDwell] = useState(0);
  const [calMoved, setCalMoved] = useState(false);
  const [calCapturedFlash, setCalCapturedFlash] = useState(false);
  const [orderId] = useState(()=>saved.orderId??genOrderId());

  const canvasRef=useRef(null);
  const scanCountedRef=useRef(false);
  const { videoRef, ready:camReady, loading:camLoading, camErr, start:startCamera, stop:stopCamera }=useCamera();
  const scan=useFaceScan({videoRef,scanning,canvasRef,onAutoStart:()=>cardCaptured&&setScanning(true)});
  const currentMeas=confirmedMeas||scan.measurements;

  const suggestedTags=Object.values(styleAnswers).flatMap(a=>a?.tags||[]);
  const topFrames=[...FRAMES].map(f=>({...f,score:f.tags.filter(t=>suggestedTags.includes(t)).length})).sort((a,b)=>b.score-a.score);
  const maxScore=Math.max(1,...topFrames.map(f=>f.score));
  const lensData=LENS_OPTIONS.find(l=>l.id===lensChoice);
  const totalPrice=BASE_PRICE;
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
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    if (checkout === "success") {
      const sessionId = params.get("session_id") || "";
      setPaymentDetails(p=>({...p,session_id:sessionId,payment_status:"paid"}));
      setSent(true);
      setStep(6);
      if (sessionId) hydrateCheckoutSession(sessionId);
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (checkout === "cancelled") {
      setStep(6);
      setSubmitError("Checkout was cancelled. Your order has not been charged.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(()=>{
    if (step===0&&!sent) return;
    saveSession({step,confirmedMeas,styleAnswers,styleQIdx,lensChoice,rxForm,selectedFrame,selectedColorway,customerInfo,orderId,cardCaptured,sent,pendingOrder,paymentDetails});
  },[step,confirmedMeas,styleAnswers,styleQIdx,lensChoice,rxForm,selectedFrame,selectedColorway,customerInfo,orderId,cardCaptured,sent,pendingOrder,paymentDetails]);

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

  async function submitWaitlist(event) {
    event.preventDefault();
    const email = waitlistEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setWaitlistError("Enter a valid email address.");
      setWaitlistStatus(null);
      return;
    }
    setWaitlistSubmitting(true);
    setWaitlistError(null);
    try {
      const res = await fetch("/api/waitlist", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ email }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not join the list.");
      setWaitlistStatus(data.duplicate ? "You're already on the list — we'll reach out when your pair is ready." : "You're on the list — we'll reach out when your pair is ready.");
      setWaitlistEmail(email);
    } catch (err) {
      setWaitlistError(err.message || "Could not join the list.");
    } finally {
      setWaitlistSubmitting(false);
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
    setSubmitError(null);
  }

  function updateCustomer(key,value){
    setSubmitError(null);
    setCustomerInfo(p=>({...p,[key]:value}));
  }

  function buildOrderPayload(name=customerInfo.name,email=customerInfo.email,info=customerInfo){
    const m=currentMeas;
    return {
      order_id:orderId,
      customer_name:name,
      customer_email:email,
      timestamp:new Date().toISOString(),
      frame_id:chosenFrame?.id||"-",
      frame:chosenFrame?.label||"-",
      colorway_id:chosenColorway.id,
      colorway:chosenColorway.label,
      lens:lensData?.label||"Blue Light",
      lens_spec:lensData?.spec||"Clear blue light lenses",
      lens_price:0,
      total:totalPrice,
      shipping_name:name,
      shipping_address:info.address,
      shipping_city:info.city,
      shipping_state:info.state,
      shipping_zip:info.zip,
      style_fit:styleAnswers.fit?.label||"-",
      style_vibe:styleAnswers.vibe?.label||"-",
      style_use:styleAnswers.use?.label||"-",
      style_priority:styleAnswers.priority?.label||"-",
      pd_binocular:m?.pd||"-",
      pd_left:m?.pdLeft||"-",
      pd_right:m?.pdRight||"-",
      bridge_width_mm:m?.bridge||"-",
      bridge_mm:m?.bridge||"-",
      temple_mm:m?.temple||"-",
      lens_height_mm:m?.lensH||"-",
      face_height_mm:m?.faceH||m?.lensH||"-",
      face_width_mm:m?.faceW||"-",
      scan_quality:scan.quality?.label||"-",
      valid_frames_pct:scan.validPct||"-",
      user_agent:navigator.userAgent,
      ...(lensChoice==="prescription"?{rx_od_sphere:rxForm.odSphere||"-",rx_od_cyl:rxForm.odCyl||"-",rx_od_axis:rxForm.odAxis||"-",rx_os_sphere:rxForm.osSphere||"-",rx_os_cyl:rxForm.osCyl||"-",rx_os_axis:rxForm.osAxis||"-"}:{})
    };
  }

  async function submitOrder(){
    setSubmitting(true);
    setSubmitError(null);
    const safeName=sanitizeText(customerInfo.name,120);
    const safeEmail=customerInfo.email.trim().toLowerCase().slice(0,254);
    const safeAddress=sanitizeText(customerInfo.address,180);
    const safeCity=sanitizeText(customerInfo.city,80);
    const safeState=sanitizeText(customerInfo.state,40);
    const safeZip=sanitizeText(customerInfo.zip,20);
    const emailOk=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail);
    if(!safeName){ setSubmitError("Enter your full name."); setSubmitting(false); return; }
    if(!emailOk){ setSubmitError("Enter a valid email address."); setSubmitting(false); return; }
    if(!safeAddress||!safeCity||!safeState||!safeZip){ setSubmitError("Enter your full shipping address."); setSubmitting(false); return; }

    const payload=buildOrderPayload(safeName,safeEmail,{...customerInfo,address:safeAddress,city:safeCity,state:safeState,zip:safeZip});
    setPendingOrder(payload);
    saveSession({step,confirmedMeas,styleAnswers,styleQIdx,lensChoice,rxForm,selectedFrame,selectedColorway,customerInfo:{...customerInfo,name:safeName,email:safeEmail,address:safeAddress,city:safeCity,state:safeState,zip:safeZip},orderId,cardCaptured,pendingOrder:payload});

    try {
      const res=await fetch("/api/create-checkout-session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const data=await res.json();
      if(!res.ok||!data.ok||!data.url) throw new Error(data.error||"Checkout could not start.");
      window.location.assign(data.url);
    } catch (err) {
      setSubmitError(err.message||"Checkout could not start.");
      setSubmitting(false);
    }
  }

  function scanBadge(){
    if(scan.done&&scan.quality?.rescan) return {label:"RESCAN",tone:"red"};
    if(scan.done&&scan.quality?.label==="Excellent") return {label:"EXCELLENT",tone:"good"};
    if(scan.done&&(scan.quality?.label==="Good"||scan.quality?.label==="Fair")) return {label:scan.quality.label.toUpperCase(),tone:"amber"};
    if(scanning&&scan.seqIdx>=0&&!scan.done) return {label:"SCANNING",tone:"good"};
    return {label:"READY",tone:""};
  }

  const dots=[1,2,3,4,5,6].map(i=>({done:step>i,active:step===i}));
  const firstName=customerInfo.name.trim().split(" ")[0]||"there";
  const activeMeasure=MEASURE_FIELDS.find(f=>f.key===focusedField);
  const badge=scanBadge();
  const confirmationOrder=pendingOrder||buildOrderPayload();
  const stripeConfirmationId=paymentDetails?.payment_intent||paymentDetails?.session_id||"Processing";
  const cameraActive=camLoading||(camReady&&!scan.done);
  const scannerReady=camReady&&scan.mpReady&&!scan.done;

  return (
    <div className="app" style={{"--accent":ACCENT_COLOR}}>
      <header className="site-header"><a className="logo" href="/">FitFrame<span className="logo-dot">.</span></a><div className="header-nav"><a className="header-link" href="/faq">FAQ</a><div className="header-tag">{DOMAIN}</div></div></header>
      {step>0&&!sent&&<div className="prog-strip">{dots.map((d,i)=><div key={i} className={`prog-dot ${d.done?"done":d.active?"active":""}`}/>)}</div>}
      <div className="container">
        {step===0&&<div className="section">
          <div className="eyebrow">Made-to-measure eyewear</div><div className="display">Frames built<br/>for <em>your</em> face.</div>
          <p className="body-lg">Scan your face. Answer four questions. Checkout securely with Stripe for custom 3D-printed frames built to your exact measurements.</p>
          <div className="scan-count">Join {scanCount.toLocaleString()} people who've already scanned their face</div>
          <form className="waitlist-form" onSubmit={submitWaitlist} noValidate>
            <div className="waitlist-row"><input className="waitlist-input" placeholder="Email for early access" type="email" autoComplete="email" value={waitlistEmail} onChange={e=>{setWaitlistEmail(e.target.value);setWaitlistError(null);}}/><button className="btn btn-accent" disabled={waitlistSubmitting}>{waitlistSubmitting?"Joining…":"Join early access"}</button></div>
            {waitlistError&&<div className="submit-error">{waitlistError}</div>}
            {waitlistStatus&&<div className="waitlist-success">{waitlistStatus}</div>}
          </form>
          <div className="proof-strip"><span className="proof-item"><ProofIcon type="flag"/>Made in America</span><span className="proof-item"><ProofIcon type="box"/>Ships in ~10 days</span><span className="proof-item"><ProofIcon type="refresh"/>One-time reprint guarantee</span><span className="proof-item"><ProofIcon type="lock"/>No images stored</span></div>
          <div className="price-block"><div className="price-main">${BASE_PRICE}</div><div className="price-sub">Blue light lenses included · Secure Stripe checkout</div></div>
          <div className="features">{[["01",<><strong>Browser-based face scan.</strong> No app, no store, no optician.</>],["02",<><strong>Every measurement captured.</strong> PD, bridge, temple, face width, and face height.</>],["03",<><strong>3D printed to your spec.</strong> PA12 nylon. Lightweight, precise, durable.</>],["04",<><strong>$89 fixed price.</strong> Pay securely after your frame spec is ready.</>]].map(([n,t])=><div className="feature-row" key={n}><span className="feature-num">{n}</span><span className="feature-text">{t}</span></div>)}</div>
          <div className="btn-row"><button className="btn btn-primary" onClick={()=>setStep(1)}>Start your scan →</button></div>
        </div>}

        {step===1&&<div className="section">
          <div className="eyebrow">Step 1 of 6 — Face scan</div><div className="step-head">{scanning?"Stay still.":scan.done?"Scan complete.":"Position your face."}</div>
          <p className="step-sub">{cardCalibrating?"Hold the card flat below your chin — keep still":scanning?"We're capturing your measurements.":scan.done?"Processing your measurements.":"Center your face inside the oval and hold still. The scan starts automatically."}</p>
          <p className="privacy-note">Your camera is used only for measurement. No images are stored or transmitted.</p>
          {scan.mpLoadError&&<div className="cam-placeholder"><div className="cam-label" style={{color:"var(--red)"}}>Face scan couldn't load.</div><div className="cam-sub">Check your connection and reload the page.</div><button className="btn btn-ghost" onClick={()=>window.location.reload()}>Reload page</button></div>}
          {cameraActive&&!scan.mpLoadError&&<><div className="cam-outer"><div className="cam-inner"><video ref={videoRef} autoPlay playsInline muted/><canvas ref={canvasRef}/><div className="cam-vignette"/>{camLoading&&!camReady&&<div className="cam-loading-overlay"><div className="mp-spinner"/><div className="cam-label">Starting camera…</div><div className="cam-sub">Keep this tab open while Safari prepares the video feed.</div></div>}{camReady&&!scan.mpReady&&<div className="cam-loading-overlay"><div className="mp-spinner"/><div className="cam-sub" style={{fontSize:13}}>Preparing face scanner…</div></div>}{scannerReady&&<><FaceGuide fill={scan.fill} autoStartPct={scan.autoStartPct} facePresent={scan.facePresent} poseHint={scan.poseHint} faceSpan={scan.faceSpan} showCard={cardCalibrating&&!cardCaptured}/><div className="cam-top"><span className={`scan-tag ${badge.tone}`}>{badge.label}</span>{scanning&&scan.seqIdx>=0&&<span className="scan-pct">{Math.round(scan.fill*100)}%</span>}</div><div className="cam-bottom">{scan.pauseWarning&&<div className="pause-warning">Hold still — scan paused</div>}{scanning&&scan.seqIdx>=0?<div className="scan-inst">{SCAN_SEQ[Math.min(scan.seqIdx,SCAN_SEQ.length-1)].instruction}</div>:scan.poseHint?<div className="scan-inst" style={{color:"var(--amber)"}}>{scan.poseHint}</div>:scan.autoStartPct>0&&scan.autoStartPct<1?<div className="scan-inst">Hold still…</div>:<div className="scan-inst">Look directly at the camera.</div>}{scan.lightWarning&&<div className="light-warning">{scan.lightWarning}</div>}</div></>}</div></div>{scannerReady&&cardCalibrating&&!cardCaptured&&<><div className={`cal-status ${calMoved?"warn":""}`}>{calMoved?"Moved — hold steady to recapture":"Hold the card flat below your chin — keep still"}</div><div className="cal-dwell-bar"><div className="cal-dwell-fill" style={{width:`${Math.round(calDwell*100)}%`}}/></div></>}{scannerReady&&calCapturedFlash&&<div className="cal-status good">✓ Card captured</div>}</>}
          {step===1&&camReady&&scan.done&&<canvas ref={canvasRef} style={{display:"none"}}/>}
          {!camReady&&!camLoading&&!camErr&&!currentMeas&&<div className="cam-placeholder"><div className="cam-icon"><svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div><div className="cam-label">Camera access needed</div><div className="cam-sub">FitFrame uses your front camera to measure your face. Nothing leaves your device.</div><button className="btn btn-primary" style={{marginTop:4}} onClick={startCamera}>Allow camera</button></div>}
          {camErr&&<div className="cam-placeholder"><div className="cam-label" style={{color:"var(--red)"}}>{camErr.headline}</div>{camErr.type==="denied"?<div className="err-box">{camErr.detail}</div>:<div className="cam-sub">{camErr.detail}</div>}{camErr.fix==="retry"&&<button className="btn btn-ghost" onClick={startCamera}>Try again</button>}{camErr.fix==="reload"&&<button className="btn btn-ghost" onClick={()=>location.reload()}>Reload page</button>}</div>}
          {scan.scanError&&<div className="cam-placeholder" style={{marginTop:0}}><div className="cam-label" style={{color:"var(--red)"}}>Scan stalled.</div><div className="cam-sub">{scan.scanError}</div><button className="btn btn-ghost" onClick={()=>{scan.reset();setScanning(false);}}>Retry scan</button></div>}
          {scan.scanLost&&<div className="cam-placeholder" style={{marginTop:0}}><div className="cam-label" style={{color:"var(--amber)"}}>Scan lost.</div><div className="cam-sub">Position your face and tap Start again.</div><button className="btn btn-ghost" onClick={()=>{scan.reset();setScanning(false);}}>Try again</button></div>}
          {camReady&&scan.mpReady&&!scan.done&&!scanning&&!scan.scanLost&&!scan.scanError&&!calCapturedFlash&&<div style={{textAlign:"center",marginTop:14}}>{!cardCaptured?<button className="btn btn-primary" onClick={()=>{setCardCalibrating(true);setCalDwell(0);}}>Calibrate with card</button>:<button className="btn btn-primary" onClick={()=>setScanning(true)}>Start scan</button>}</div>}
          {scan.done&&!currentMeas&&<div className="cam-placeholder" style={{marginTop:0}}><div className="cam-label" style={{color:"var(--red)"}}>{scan.quality?.label==="Low"?"Let's try that again.":"No face data captured."}</div><div className="cam-sub">{scan.quality?.reason||"Ensure your face is well-lit and centered."}</div><button className="btn btn-ghost" style={{marginTop:4}} onClick={resetScanFlow}>Try again</button></div>}
          {currentMeas&&scan.quality?.rescan&&<div className="cam-placeholder" style={{marginTop:0}}><div className="cam-label">Let's try that again.</div><div className="cam-sub">{scan.quality.reason||"Face the camera straight on in good light and hold still."}</div><button className="btn btn-primary" style={{marginTop:4}} onClick={resetScanFlow}>Rescan</button></div>}
          {currentMeas&&!scan.quality?.rescan&&<div className="scan-ok">Measurements captured. Moving forward…</div>}
        </div>}

        {step===2&&(()=>{ const q=STYLE_QUESTIONS[styleQIdx]; return <div className="section" key={styleQIdx}><div className="eyebrow">Step 2 of 6 — Style</div><div className="q-meta"><span className="q-counter">{styleQIdx+1} / {STYLE_QUESTIONS.length}</span></div><div className="q-label">{q.q}</div><div className="choices">{q.options.map((opt,i)=><button key={`q${styleQIdx}-o${i}`} className={`choice ${tapped===opt.label?"chosen":""}`} onClick={()=>selectOption(opt)}>{opt.label}</button>)}</div>{styleQIdx>0&&<div style={{marginTop:20}}><button className="btn btn-ghost" onClick={()=>{const prev={...styleAnswers};delete prev[STYLE_QUESTIONS[styleQIdx-1].id];setStyleAnswers(prev);setStyleQIdx(i=>i-1);}}>← Back</button></div>}</div>; })()}

        {step===3&&<div className="section"><div className="eyebrow">Step 3 of 6 — Lenses</div><div className="step-head">Choose your lens.</div><p className="step-sub">Blue light lenses are included in the fixed ${BASE_PRICE} checkout price.</p><div className="lens-list">{LENS_OPTIONS.map(l=><div key={l.id} className={`lens-row ${lensChoice===l.id?"sel":""}`} onClick={()=>setLensChoice(l.id)}><div className="lens-info"><div className="lens-name">{l.label}</div><div className="lens-desc">{l.desc}</div>{l.spec&&<div className="lens-spec">{l.spec}</div>}</div><div className="lens-price">Included</div></div>)}</div><div className="lens-disclaimer">Prescription support is in development. Checkout today is fixed at ${BASE_PRICE} for clear blue light lenses.</div><div className="btn-row"><button className="btn btn-primary" disabled={!lensChoice} onClick={()=>setStep(4)}>Choose your frame →</button><button className="btn btn-ghost" onClick={()=>setStep(2)}>Back</button></div></div>}

        {step===4&&<div className="section"><div className="eyebrow">Step 4 of 6 — Frame</div><div className="step-head">Pick your shape.</div><p className="step-sub">Your top match is highlighted based on your answers. Choose the one that feels right.</p><div className="vto-note"><div className="vto-note-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div className="vto-note-text"><strong>Virtual try-on coming soon.</strong> Select the shape that matches your style for now.</div></div><div className="frame-grid">{topFrames.map((f,i)=><div key={f.id} className={`frame-tile ${selectedFrame?selectedFrame===f.id?"sel":"":i===0?"sel":""}`} onClick={()=>setSelectedFrame(f.id)}>{i===0&&<div className="best-badge">best match</div>}<div className="frame-tile-icon"><FrameSVG id={f.id} size={52} color={(selectedFrame?selectedFrame===f.id:i===0)?"var(--accent)":"var(--border2)"}/></div><div className="frame-tile-name">{f.label}</div><div className="frame-tile-desc">{f.desc}</div>{f.score>0&&<div className="frame-tile-bar" style={{width:`${Math.round((f.score/maxScore)*100)}%`}}/>}</div>)}</div><div className="btn-row" style={{marginTop:8}}><button className="btn btn-primary" onClick={()=>{if(!selectedFrame)setSelectedFrame(topFrames[0]?.id);setStep(5);}}>Choose colorway →</button><button className="btn btn-ghost" onClick={()=>setStep(3)}>Back</button></div></div>}

        {step===5&&!sent&&<div className="section"><div className="eyebrow">Step 5 of 6 — Colorway</div><div className="step-head">Choose the finish.</div><p className="step-sub">One decision, three finishes. Matte Black is the default recommendation for most face shapes.</p><div className="colorway-grid">{COLORWAYS.map(c=><button key={c.id} className={`colorway-card ${selectedColorway===c.id?"sel":""}`} onClick={()=>setSelectedColorway(c.id)}>{c.recommended&&<span className="colorway-badge">Recommended for your face shape</span>}<div className="colorway-preview"><ColorwaySVG colorway={c}/></div><div><div className="colorway-name">{c.label}</div><div className="colorway-desc">{c.desc}</div></div></button>)}</div><div className="btn-row"><button className="btn btn-primary checkout-submit" onClick={()=>setStep(6)}>Continue to shipping →</button><button className="btn btn-ghost" onClick={()=>setStep(4)}>Back</button></div></div>}

        {step===6&&!sent&&<div className="section"><div className="eyebrow">Step 6 of 6 — Secure checkout</div><div className="step-head">Ship your pair.</div><p className="step-sub">Review the measurements, enter shipping, then checkout through Stripe. Nothing is charged until Stripe confirms payment.</p><div className="measure-grid">{MEASURE_FIELDS.map(field=>{ const value=field.key==="faceH"?(currentMeas?.faceH||currentMeas?.lensH||""):currentMeas?.[field.key]||""; const sane=isSane(value,field); return <div className="measure-field" key={field.key}><label>{field.label}</label><input className="measure-input" inputMode="decimal" value={value} onFocus={()=>setFocusedField(field.key)} onBlur={()=>setFocusedField(null)} onChange={e=>setConfirmedMeas(p=>({...currentMeas,...p,[field.key]:e.target.value}))}/>{sane!==null&&<span className={`measure-dot ${sane?"ok":""}`}/>}</div>; })}</div>{activeMeasure&&<div className="measure-tooltip">{activeMeasure.hint}</div>}<div className="receipt"><div className="receipt-head">Order summary · {orderId}</div><div className="receipt-row"><span>Custom frame — {chosenFrame?.label}</span><span>${BASE_PRICE}</span></div><div className="receipt-row"><span>Colorway — {chosenColorway.label}</span><span>Included</span></div><div className="receipt-row"><span>{lensData?.label||"Blue Light"} lenses</span><span>Included</span></div><div className="receipt-total"><span>Total due today</span><span>${totalPrice}</span></div></div><div className="trust-line"><ProofIcon type="refresh"/><span>One-time reprint guarantee if the fit is off. No questions asked.</span></div><div className="payment-note"><span>Payment is processed by Stripe Checkout.</span><span>We never store card details on FitFrame servers.</span></div><input className="field" placeholder="Full name" autoComplete="shipping name" value={customerInfo.name} onChange={e=>updateCustomer("name",e.target.value)}/><input className="field" placeholder="Email address" type="email" autoComplete="email" value={customerInfo.email} onChange={e=>updateCustomer("email",e.target.value)}/><input className="field" placeholder="Street address" autoComplete="shipping address-line1" value={customerInfo.address} onChange={e=>updateCustomer("address",e.target.value)}/><input className="field" placeholder="City" autoComplete="shipping address-level2" value={customerInfo.city} onChange={e=>updateCustomer("city",e.target.value)}/><input className="field" placeholder="State" autoComplete="shipping address-level1" value={customerInfo.state} onChange={e=>updateCustomer("state",e.target.value)}/><input className="field" placeholder="ZIP code" inputMode="numeric" autoComplete="shipping postal-code" value={customerInfo.zip} onChange={e=>updateCustomer("zip",e.target.value)}/>{submitError&&<div className="submit-error">{submitError}</div>}<div className="btn-row"><button className="btn btn-primary checkout-submit" disabled={submitting} onClick={submitOrder}>{submitting?"Starting Stripe…":`Complete order - $${BASE_PRICE}`}</button><button className="btn btn-ghost" onClick={()=>setStep(5)}>Back</button></div></div>}

        {sent&&<div className="section"><div className="confirm-actions"><div className="order-badge">{orderId}</div></div><div className="confirm-greeting">You're all set,<br/>{firstName}.</div><p className="confirm-body">Your payment is confirmed and your FitFrame order is in. We'll be in touch within <strong>2 business days</strong> with the next update.</p><div className="receipt"><div className="receipt-head">Paid order summary</div><div className="receipt-row"><span>Stripe confirmation</span><span>{stripeConfirmationId}</span></div><div className="receipt-row"><span>Frame</span><span>{confirmationOrder.frame}</span></div><div className="receipt-row"><span>Colorway</span><span>{confirmationOrder.colorway}</span></div><div className="receipt-row"><span>Ship to</span><span>{confirmationOrder.shipping_city || customerInfo.city}</span></div><div className="receipt-total"><span>Total paid</span><span>${BASE_PRICE}</span></div></div><div className="next-steps">{[["01","We review your scan","Your measurements and payment confirmation are sent to the production inbox automatically."],["02","We print your frames","Print time is 2–3 days once the spec is approved."],["03","Shipped to your door",`Estimated delivery: ${getETA()}. We'll send tracking once your order ships.`],["04","Fit guarantee","If your frames don't fit, we reprint them once, free."]].map(([n,label,desc])=><div className="next-step" key={n}><span className="next-step-num">{n}</span><div><div className="next-step-label">{label}</div><div className="next-step-desc">{desc}</div></div></div>)}</div><div className="btn-row" style={{marginTop:24}}><a className="btn btn-ghost" href="/faq">Read FAQ</a><button className="btn btn-ghost" onClick={()=>{clearSession();setSent(false);setStep(0);}}>Start another scan</button></div><div className="confirm-footer">{orderId} · {DOMAIN}</div></div>}
      </div>
      <div className="site-footer"><span>{DOMAIN}</span><span className="footer-dot">·</span><a href="/faq" className="footer-link">FAQ</a><span className="footer-dot">·</span><a href="/returns" className="footer-link">Returns</a></div>
    </div>
  );
}
