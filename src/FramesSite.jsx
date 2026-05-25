import { useEffect, useRef, useState } from "react";
import "./styles.css";
import { DEFAULT_LENS, FRAMES, STYLE_QUESTIONS } from "./data.js";
import useCamera from "./hooks/useCamera.js";
import useFaceScan from "./hooks/useFaceScan.js";
import { SCAN_SEQ, buildMakerSpec, clearSession, genOrderId, getETA, loadSession, saveSession } from "./utils.js";

const MAKER_EMAIL = "hello@fitframe.store";
const DOMAIN = "fitframe.store";
const ACCENT_COLOR = "#4caf7d";
const BASE_PRICE = 89;
const LENS_OPTIONS = DEFAULT_LENS;

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

function ProofIcon({ type }) {
  if (type === "flag") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4v16"/><path d="M4 5h14l-2 4 2 4H4"/><path d="M7 8h5"/></svg>;
  if (type === "box") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 8l8-4 8 4-8 4-8-4Z"/><path d="M4 8v8l8 4 8-4V8"/><path d="M12 12v8"/></svg>;
  if (type === "lock") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 12a8 8 0 0 1-13.6 5.7"/><path d="M4 12A8 8 0 0 1 17.6 6.3"/><path d="M17 2v5h-5"/><path d="M7 22v-5h5"/></svg>;
}

function ShareIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/></svg>;
}

function CopyIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><rect x="4" y="4" width="11" height="11" rx="2"/></svg>;
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

function Padlock(){
  return <svg width="11" height="12" viewBox="0 0 11 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="5" width="9" height="7" rx="1.5"/><path d="M3 5V3.5a2.5 2.5 0 0 1 5 0V5"/></svg>;
}

const MEASURE_FIELDS = [
  { key:"pd", label:"PD", hint:"Distance between pupils. Typical range 56-74mm.", min:52, max:80 },
  { key:"bridge", label:"Bridge", hint:"Gap between lens centers above your nose. Typical range 14-24mm.", min:10, max:28 },
  { key:"lensH", label:"Lens H", hint:"Vertical lens opening. Typical range 34-48mm.", min:28, max:55 },
  { key:"temple", label:"Temple", hint:"Arm length from hinge to tip. Typical range 130-155mm.", min:120, max:170 },
];

function isSane(value, field) {
  if (value === "" || value == null) return null;
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return false;
  return n >= field.min && n <= field.max;
}

export default function FramesSite(){
  const saved=loadSession()||{};
  const [step, setStep] = useState(saved.step??0);
  const [confirmedMeas, setConfirmedMeas] = useState(saved.confirmedMeas??null);
  const [styleAnswers, setStyleAnswers] = useState(saved.styleAnswers??{});
  const [styleQIdx, setStyleQIdx] = useState(saved.styleQIdx??0);
  const [tapped, setTapped] = useState(null);
  const [lensChoice, setLensChoice] = useState(saved.lensChoice??null);
  const [rxForm, setRxForm] = useState(saved.rxForm??{odSphere:"",odCyl:"",odAxis:"",osSphere:"",osCyl:"",osAxis:""});
  const [selectedFrame, setSelectedFrame] = useState(saved.selectedFrame??null);
  const [customerInfo, setCustomerInfo] = useState(saved.customerInfo??{name:"",email:""});
  const [focusedField, setFocusedField] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitFallback, setSubmitFallback] = useState(false);
  const [clipboardCopied, setClipboardCopied] = useState(false);
  const [fallbackSpec, setFallbackSpec] = useState("");
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [cardCalibrating, setCardCalibrating] = useState(false);
  const [cardCaptured, setCardCaptured] = useState(saved.cardCaptured??false);
  const [calDwell, setCalDwell] = useState(0);
  const [calMoved, setCalMoved] = useState(false);
  const [calCapturedFlash, setCalCapturedFlash] = useState(false);
  const [orderId] = useState(()=>saved.orderId??genOrderId());

  const canvasRef=useRef(null);
  const cam=useCamera();
  const scan=useFaceScan({videoRef:cam.videoRef,scanning,canvasRef,onAutoStart:()=>cardCaptured&&setScanning(true)});
  const currentMeas=confirmedMeas||scan.measurements;

  useEffect(()=>{
    if (step===0||sent) return;
    saveSession({step,confirmedMeas,styleAnswers,styleQIdx,lensChoice,rxForm,selectedFrame,customerInfo,orderId,cardCaptured});
  },[step,confirmedMeas,styleAnswers,styleQIdx,lensChoice,rxForm,selectedFrame,customerInfo,orderId,cardCaptured,sent]);

  const suggestedTags=Object.values(styleAnswers).flatMap(a=>a?.tags||[]);
  const topFrames=[...FRAMES].map(f=>({...f,score:f.tags.filter(t=>suggestedTags.includes(t)).length})).sort((a,b)=>b.score-a.score);
  const maxScore=Math.max(1,...topFrames.map(f=>f.score));
  const lensData=LENS_OPTIONS.find(l=>l.id===lensChoice);
  const totalPrice=BASE_PRICE+(lensData?.price||0);
  const chosenFrame=FRAMES.find(f=>f.id===selectedFrame)||topFrames[0];

  useEffect(()=>{ if(step!==1) cam.stop(); },[step,cam.stop]);
  useEffect(()=>{
    const handleVisibility=()=>{ if(document.hidden&&step===1) cam.stop(); };
    document.addEventListener("visibilitychange",handleVisibility);
    return ()=>document.removeEventListener("visibilitychange",handleVisibility);
  },[step,cam.stop]);
  useEffect(()=>{ if(scan.done) setScanning(false); },[scan.done]);
  useEffect(()=>{ if(scan.scanLost) setScanning(false); },[scan.scanLost]);
  useEffect(()=>{ setTapped(null); },[styleQIdx]);
  useEffect(()=>{
    if (scan.measurements&&!scan.quality?.rescan){
      const t=setTimeout(()=>{ setConfirmedMeas(scan.measurements); setStep(2); },1400);
      return ()=>clearTimeout(t);
    }
  },[scan.measurements,scan.quality]);

  useEffect(()=>{
    if (!cardCalibrating || !cam.ready || !scan.mpReady || cardCaptured) return;
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
  },[cardCalibrating,cam.ready,scan.mpReady,scan.facePresent,scan.poseHint,cardCaptured]);

  function selectOption(opt){
    setTapped(opt.label);
    const qId=STYLE_QUESTIONS[styleQIdx].id;
    setStyleAnswers(prev=>({...prev,[qId]:opt}));
    if (styleQIdx<STYLE_QUESTIONS.length-1) setTimeout(()=>setStyleQIdx(i=>i+1),220);
    else setTimeout(()=>setStep(3),300);
  }

  function resetSubmissionFallback(){
    setSubmitFallback(false);
    setClipboardCopied(false);
    setFallbackSpec("");
  }

  function resetScanFlow(){
    scan.reset();
    setScanning(false);
    setConfirmedMeas(null);
    resetSubmissionFallback();
  }

  function updateCustomer(key,value){
    setSubmitError(null);
    resetSubmissionFallback();
    setCustomerInfo(p=>({...p,[key]:value}));
  }

  function buildOrderPayload(name=customerInfo.name,email=customerInfo.email){
    const m=currentMeas;
    return {
      order_id:orderId, customer_name:name, customer_email:email, timestamp:new Date().toISOString(),
      frame_id:chosenFrame?.id||"-", frame:chosenFrame?.label||"-", lens:lensData?.label||"-", lens_spec:lensData?.spec||"-", lens_price:lensData?.price||0, total:totalPrice,
      style_fit:styleAnswers.fit?.label||"-", style_vibe:styleAnswers.vibe?.label||"-", style_use:styleAnswers.use?.label||"-", style_priority:styleAnswers.priority?.label||"-",
      pd_binocular:m?.pd||"-", pd_left:m?.pdLeft||"-", pd_right:m?.pdRight||"-", bridge_mm:m?.bridge||"-", temple_mm:m?.temple||"-", lens_height_mm:m?.lensH||"-", face_width_mm:m?.faceW||"-",
      scan_quality:scan.quality?.label||"-", valid_frames_pct:scan.validPct||"-", user_agent:navigator.userAgent,
      ...(lensChoice==="prescription"?{rx_od_sphere:rxForm.odSphere||"-",rx_od_cyl:rxForm.odCyl||"-",rx_od_axis:rxForm.odAxis||"-",rx_os_sphere:rxForm.osSphere||"-",rx_os_cyl:rxForm.osCyl||"-",rx_os_axis:rxForm.osAxis||"-"}:{})
    };
  }

  function openMailto(spec){
    const subject=encodeURIComponent(`FitFrame Order ${orderId}`);
    const body=encodeURIComponent(spec);
    window.location.href=`mailto:${MAKER_EMAIL}?subject=${subject}&body=${body}`;
  }

  async function copySpec(spec=fallbackSpec){
    try {
      await navigator.clipboard.writeText(spec);
      setClipboardCopied(true);
    } catch {
      setClipboardCopied(false);
    }
  }

  async function submitOrder(){
    setSubmitting(true);
    setSubmitError(null);
    resetSubmissionFallback();
    const safeName=customerInfo.name.trim().replace(/[<>"'&]/g,"").slice(0,120);
    const safeEmail=customerInfo.email.trim().toLowerCase().slice(0,254);
    const emailOk=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail);
    if(!emailOk){ setSubmitError("Enter a valid email address."); setSubmitting(false); return; }
    const payload=buildOrderPayload(safeName,safeEmail);
    const spec=buildMakerSpec(payload);
    const body={...payload,spec_text:spec,estimated_ship_date:getETA()};
    let serverOk=false;
    try {
      const res=await fetch("/submit-order",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await res.json();
      serverOk=data?.ok===true;
    } catch {
      serverOk=false;
    }
    if(serverOk){ clearSession(); setSent(true); setSubmitting(false); return; }
    try { await navigator.clipboard.writeText(spec); setClipboardCopied(true); } catch { setClipboardCopied(false); }
    setFallbackSpec(spec);
    setSubmitFallback(true);
    setSubmitting(false);
  }

  async function shareSpec(){
    const spec=buildMakerSpec(buildOrderPayload(customerInfo.name.trim(),customerInfo.email.trim().toLowerCase()));
    try {
      if(navigator.share) await navigator.share({title:`FitFrame Order ${orderId}`,text:spec});
      else await navigator.clipboard.writeText(spec);
    } catch (err) {
      console.error("Spec share failed:",err);
    }
  }

  function scanBadge(){
    if(scan.done&&scan.quality?.rescan) return {label:"RESCAN",tone:"red"};
    if(scan.done&&scan.quality?.label==="Excellent") return {label:"EXCELLENT",tone:"good"};
    if(scan.done&&(scan.quality?.label==="Good"||scan.quality?.label==="Fair")) return {label:scan.quality.label.toUpperCase(),tone:"amber"};
    if(scanning&&scan.seqIdx>=0&&!scan.done) return {label:"SCANNING",tone:"good"};
    return {label:"READY",tone:""};
  }

  const dots=[1,2,3,4,5].map(i=>({done:step>i,active:step===i}));
  const firstName=customerInfo.name.trim().split(" ")[0]||"there";
  const activeMeasure=MEASURE_FIELDS.find(f=>f.key===focusedField);
  const badge=scanBadge();

  return (
    <div className="app" style={{"--accent":ACCENT_COLOR}}>
      <header className="site-header"><div className="logo">FitFrame<span className="logo-dot">.</span></div><div className="header-tag">{DOMAIN}</div></header>
      {step>0&&!sent&&<div className="prog-strip">{dots.map((d,i)=><div key={i} className={`prog-dot ${d.done?"done":d.active?"active":""}`}/>)}</div>}
      <div className="container">
        {step===0&&<div className="section">
          <div className="eyebrow">Made-to-measure eyewear</div><div className="display">Frames built<br/>for <em>your</em> face.</div>
          <p className="body-lg">Scan your face. Answer four questions. Receive 3D-printed frames built to your exact measurements — shipped to your door.</p>
          <div className="proof-strip"><span className="proof-item"><ProofIcon type="flag"/>Made in America</span><span className="proof-item"><ProofIcon type="box"/>Ships in ~10 days</span><span className="proof-item"><ProofIcon type="refresh"/>One-time reprint guarantee</span><span className="proof-item"><ProofIcon type="lock"/>No images stored</span></div>
          <div className="price-block"><div className="price-main">${BASE_PRICE}</div><div className="price-sub">Blue light lenses included · Free shipping</div></div>
          <div className="features">{[["01",<><strong>Browser-based face scan.</strong> No app, no store, no optician.</>],["02",<><strong>Every measurement captured.</strong> PD, bridge, temple, face width — all from your scan.</>],["03",<><strong>3D printed to your spec.</strong> PA12 nylon. Lightweight, precise, durable.</>],["04",<><strong>$89 base price.</strong> Ships in 7–10 days after confirmation.</>]].map(([n,t])=><div className="feature-row" key={n}><span className="feature-num">{n}</span><span className="feature-text">{t}</span></div>)}</div>
          <div className="btn-row"><button className="btn btn-primary" onClick={()=>setStep(1)}>Start your scan →</button></div>
        </div>}

        {step===1&&<div className="section">
          <div className="eyebrow">Step 1 of 4 — Face scan</div><div className="step-head">{scanning?"Stay still.":scan.done?"Scan complete.":"Position your face."}</div>
          <p className="step-sub">{cardCalibrating?"Hold the card flat below your chin — keep still":scanning?"We're capturing your measurements.":scan.done?"Processing your measurements.":"Center your face inside the oval and hold still. The scan starts automatically."}</p>
          <p className="privacy-note">Your camera is used only for measurement. No images are stored or transmitted.</p>
          {cam.ready&&!scan.mpReady&&!scan.mpLoadError&&!scan.done&&<div className="cam-placeholder loading"><div className="mp-spinner"/><div className="cam-sub" style={{fontSize:13}}>Preparing face scanner…</div></div>}
          {scan.mpLoadError&&<div className="cam-placeholder"><div className="cam-label" style={{color:"var(--red)"}}>Face scan couldn't load.</div><div className="cam-sub">Check your connection and reload the page.</div><button className="btn btn-ghost" onClick={()=>window.location.reload()}>Reload page</button></div>}
          {cam.ready&&scan.mpReady&&!scan.done&&<><div className="cam-outer"><div className="cam-inner"><video ref={cam.videoRef} autoPlay playsInline muted/><canvas ref={canvasRef}/><div className="cam-vignette"/><FaceGuide fill={scan.fill} autoStartPct={scan.autoStartPct} facePresent={scan.facePresent} poseHint={scan.poseHint} faceSpan={scan.faceSpan} showCard={cardCalibrating&&!cardCaptured}/><div className="cam-top"><span className={`scan-tag ${badge.tone}`}>{badge.label}</span>{scanning&&scan.seqIdx>=0&&<span className="scan-pct">{Math.round(scan.fill*100)}%</span>}</div><div className="cam-bottom">{scan.pauseWarning&&<div className="pause-warning">Hold still — scan paused</div>}{scanning&&scan.seqIdx>=0?<div className="scan-inst">{SCAN_SEQ[Math.min(scan.seqIdx,SCAN_SEQ.length-1)].instruction}</div>:scan.poseHint?<div className="scan-inst" style={{color:"var(--amber)"}}>{scan.poseHint}</div>:scan.autoStartPct>0&&scan.autoStartPct<1?<div className="scan-inst">Hold still…</div>:<div className="scan-inst">Look directly at the camera.</div>}{scan.lightWarning&&<div className="light-warning">{scan.lightWarning}</div>}</div></div></div>{cardCalibrating&&!cardCaptured&&<><div className={`cal-status ${calMoved?"warn":""}`}>{calMoved?"Moved — hold steady to recapture":"Hold the card flat below your chin — keep still"}</div><div className="cal-dwell-bar"><div className="cal-dwell-fill" style={{width:`${Math.round(calDwell*100)}%`}}/></div></>}{calCapturedFlash&&<div className="cal-status good">✓ Card captured</div>}</>}
          {step===1&&cam.ready&&scan.done&&<canvas ref={canvasRef} style={{display:"none"}}/>}
          {!cam.ready&&!cam.camErr&&!currentMeas&&<div className="cam-placeholder"><div className="cam-icon"><svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div><div className="cam-label">Camera access needed</div><div className="cam-sub">FitFrame uses your front camera to measure your face. Nothing leaves your device.</div><button className="btn btn-primary" style={{marginTop:4}} onClick={cam.start}>Allow camera</button></div>}
          {cam.camErr&&<div className="cam-placeholder"><div className="cam-label" style={{color:"var(--red)"}}>{cam.camErr.headline}</div>{cam.camErr.type==="denied"?<div className="err-box">{cam.camErr.detail}</div>:<div className="cam-sub">{cam.camErr.detail}</div>}{cam.camErr.fix==="retry"&&<button className="btn btn-ghost" onClick={cam.start}>Try again</button>}{cam.camErr.fix==="reload"&&<button className="btn btn-ghost" onClick={()=>location.reload()}>Reload page</button>}</div>}
          {scan.scanLost&&<div className="cam-placeholder" style={{marginTop:0}}><div className="cam-label" style={{color:"var(--amber)"}}>Scan lost.</div><div className="cam-sub">Position your face and tap Start again.</div><button className="btn btn-ghost" onClick={()=>{scan.reset();setScanning(false);}}>Try again</button></div>}
          {cam.ready&&scan.mpReady&&!scan.done&&!scanning&&!scan.scanLost&&!calCapturedFlash&&<div style={{textAlign:"center",marginTop:14}}>{!cardCaptured?<button className="btn btn-primary" onClick={()=>{setCardCalibrating(true);setCalDwell(0);}}>Calibrate with card</button>:<button className="btn btn-primary" onClick={()=>setScanning(true)}>Start scan</button>}</div>}
          {scan.done&&!currentMeas&&<div className="cam-placeholder" style={{marginTop:0}}><div className="cam-label" style={{color:"var(--red)"}}>{scan.quality?.label==="Low"?"Let's try that again.":"No face data captured."}</div><div className="cam-sub">{scan.quality?.reason||"Ensure your face is well-lit and centered."}</div><button className="btn btn-ghost" style={{marginTop:4}} onClick={resetScanFlow}>Try again</button></div>}
          {currentMeas&&scan.quality?.rescan&&<div className="cam-placeholder" style={{marginTop:0}}><div className="cam-label">Let's try that again.</div><div className="cam-sub">{scan.quality.reason||"Face the camera straight on in good light and hold still."}</div><button className="btn btn-primary" style={{marginTop:4}} onClick={resetScanFlow}>Rescan</button></div>}
          {currentMeas&&!scan.quality?.rescan&&<div className="scan-ok">Measurements captured. Moving forward…</div>}
        </div>}

        {step===2&&(()=>{ const q=STYLE_QUESTIONS[styleQIdx]; return <div className="section" key={styleQIdx}><div className="eyebrow">Step 2 of 4 — Style</div><div className="q-meta"><span className="q-counter">{styleQIdx+1} / {STYLE_QUESTIONS.length}</span></div><div className="q-label">{q.q}</div><div className="choices">{q.options.map((opt,i)=><button key={`q${styleQIdx}-o${i}`} className={`choice ${tapped===opt.label?"chosen":""}`} onClick={()=>selectOption(opt)}>{opt.label}</button>)}</div>{styleQIdx>0&&<div style={{marginTop:20}}><button className="btn btn-ghost" onClick={()=>{const prev={...styleAnswers};delete prev[STYLE_QUESTIONS[styleQIdx-1].id];setStyleAnswers(prev);setStyleQIdx(i=>i-1);}}>← Back</button></div>}</div>; })()}

        {step===3&&<div className="section"><div className="eyebrow">Step 3 of 4 — Lenses</div><div className="step-head">Choose your lens.</div><p className="step-sub">All lenses are cut to your exact frame measurements.</p><div className="lens-list">{LENS_OPTIONS.map(l=><div key={l.id} className={`lens-row ${lensChoice===l.id?"sel":""}`} onClick={()=>setLensChoice(l.id)}><div className="lens-info"><div className="lens-name">{l.label}</div><div className="lens-desc">{l.desc}</div>{l.spec&&<div className="lens-spec">{l.spec}</div>}</div><div className="lens-price">{l.price===0?"Included":`+$${l.price}`}</div></div>)}</div><div className="lens-disclaimer">Currently non-prescription only. Blue light lenses are clear with no vision correction. Prescription support is in development.</div><div className="btn-row"><button className="btn btn-primary" disabled={!lensChoice} onClick={()=>setStep(4)}>Choose your frame →</button><button className="btn btn-ghost" onClick={()=>setStep(2)}>Back</button></div></div>}

        {step===4&&<div className="section"><div className="eyebrow">Step 4 of 4 — Frame</div><div className="step-head">Pick your shape.</div><p className="step-sub">Your top match is highlighted based on your answers. Choose the one that feels right.</p><div className="vto-note"><div className="vto-note-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div><div className="vto-note-text"><strong>Virtual try-on coming soon.</strong> Select the shape that matches your style for now.</div></div><div className="frame-grid">{topFrames.map((f,i)=><div key={f.id} className={`frame-tile ${selectedFrame?selectedFrame===f.id?"sel":"":i===0?"sel":""}`} onClick={()=>setSelectedFrame(f.id)}>{i===0&&<div className="best-badge">best match</div>}<div className="frame-tile-icon"><FrameSVG id={f.id} size={52} color={(selectedFrame?selectedFrame===f.id:i===0)?"var(--accent)":"var(--border2)"}/></div><div className="frame-tile-name">{f.label}</div><div className="frame-tile-desc">{f.desc}</div>{f.score>0&&<div className="frame-tile-bar" style={{width:`${Math.round((f.score/maxScore)*100)}%`}}/>}</div>)}</div><div className="btn-row" style={{marginTop:8}}><button className="btn btn-primary" onClick={()=>{if(!selectedFrame)setSelectedFrame(topFrames[0]?.id);setStep(5);}}>Review my order →</button><button className="btn btn-ghost" onClick={()=>setStep(3)}>Back</button></div></div>}

        {step===5&&!sent&&submitFallback&&<div className="section"><div className="eyebrow">Manual fallback</div><div className="step-head">Your spec is ready.</div><p className="step-sub">Email your spec to {MAKER_EMAIL}. {clipboardCopied?"Your spec has been copied to your clipboard.":"Copy the spec below before sending."}</p><div className="spec-box">{fallbackSpec}</div><div className="btn-row"><button className="btn btn-primary" onClick={()=>copySpec()}>Copy again</button><button className="btn btn-ghost" onClick={()=>openMailto(fallbackSpec)}>Open Mail app</button><button className="btn btn-ghost" onClick={()=>setSubmitFallback(false)}>Back</button></div></div>}

        {step===5&&!sent&&!submitFallback&&<div className="section"><div className="eyebrow">Almost there</div><div className="step-head">Review and confirm.</div><p className="step-sub">Your measurements and frame spec are ready. We'll confirm your order within 24 hours.</p><div className="measure-grid">{MEASURE_FIELDS.map(field=>{ const sane=isSane(currentMeas?.[field.key],field); return <div className="measure-field" key={field.key}><label>{field.label}</label><input className="measure-input" inputMode="decimal" value={currentMeas?.[field.key]||""} onFocus={()=>setFocusedField(field.key)} onBlur={()=>setFocusedField(null)} onChange={e=>setConfirmedMeas(p=>({...currentMeas,...p,[field.key]:e.target.value}))}/>{sane!==null&&<span className={`measure-dot ${sane?"ok":""}`}/>}</div>; })}</div>{activeMeasure&&<div className="measure-tooltip">{activeMeasure.hint}</div>}<div className="receipt"><div className="receipt-head">Order summary · {orderId}</div><div className="receipt-row"><span>Custom frame — {chosenFrame?.label}</span><span>${BASE_PRICE}</span></div>{lensData&&<><div className="receipt-row"><span>{lensData.label} lenses</span><span>{lensData.price===0?"Included":`+$${lensData.price}`}</span></div>{lensData.spec&&<div className="receipt-spec">Blue Light lenses · 40% block at 415-455nm</div>}</>}<div className="receipt-total"><span>Total</span><span>${totalPrice}</span></div></div><div className="trust-line"><ProofIcon type="refresh"/><span>One-time reprint guarantee if the fit is off. No questions asked.</span></div><div className="payment-note"><span>Payment is handled after your spec is reviewed.</span><span>We accept all major credit cards and PayPal.</span></div><input className="field" placeholder="Full name" autoComplete="name" value={customerInfo.name} onChange={e=>updateCustomer("name",e.target.value)}/><input className="field" placeholder="Email address" type="email" autoComplete="email" value={customerInfo.email} onChange={e=>updateCustomer("email",e.target.value)}/>{submitError&&<div className="submit-error">{submitError}</div>}<div className="btn-row" style={{marginTop:10}}><button className="btn btn-accent" disabled={!customerInfo.name.trim()||!customerInfo.email.trim()||submitting} onClick={submitOrder}>{submitting?"Sending…":"Place my order →"}</button><button className="btn btn-ghost" onClick={()=>setStep(4)}>Back</button></div><div className="trust-line"><Padlock/><span>Secure · Your measurements stay private</span></div></div>}

        {sent&&<div className="section"><div className="confirm-actions"><div className="order-badge">{orderId}</div><button className="btn btn-ghost spec-share" onClick={shareSpec}>{navigator.share?<ShareIcon/>:<CopyIcon/>}{navigator.share?"Share spec":"Copy spec"}</button></div><div className="confirm-greeting">We've got it,<br/>{firstName}.</div><p className="confirm-body">Your order is in. Check <strong>{customerInfo.email}</strong> — a confirmation with your order details is on its way.</p><div className="next-steps">{[["01","We confirm your order","You'll hear from us within 24 hours with payment details and your full order summary."],["02","We print your frames","Print time is 2–3 days once confirmed. Your frames are made specifically for your face — no off-the-shelf inventory."],["03","Shipped to your door",`Estimated delivery: ${getETA()}. We'll send tracking once your order ships.`],["04","Fit guarantee","If your frames don't fit, we reprint them once, free."]].map(([n,label,desc])=><div className="next-step" key={n}><span className="next-step-num">{n}</span><div><div className="next-step-label">{label}</div><div className="next-step-desc">{desc}</div></div></div>)}</div><div className="confirm-footer">{orderId} · {DOMAIN}</div></div>}
      </div>
      <div className="site-footer"><span>{DOMAIN}</span><span className="footer-dot">·</span><a href={`mailto:${MAKER_EMAIL}`} className="footer-link">{MAKER_EMAIL}</a><span className="footer-dot">·</span><a href="/returns" className="footer-link">Returns</a></div>
    </div>
  );
}
