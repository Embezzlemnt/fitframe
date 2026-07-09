import { useState, useRef, useEffect, useCallback } from "react";
import useCamera from "./useCamera.js";
import useFaceScan from "./useFaceScan.js";
import { clamp } from "./faceMetrics.js";
import { PRE_SCAN_SETTLE_MS, SCAN_DURATION_SECONDS_PLACEHOLDER } from "./constants.js";

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

// ─── ScanStage ────────────────────────────────────────────────────────────────
export default function ScanStage({calibration,setCalibration,confirmedMeas,setConfirmedMeas,onAdvance,onScanComplete,debugEnabled,resetToken}){
  const [phase,         setPhase]         = useState("consent"); // consent|positioning|cardlock|settling|scanning|processing
  const [cardChoice,    setCardChoice]    = useState(false);
  const [scanMode,      setScanMode]      = useState(null);
  const [scanPrepDismissed,setScanPrepDismissed] = useState(false);
  const [cameraIntro,   setCameraIntro]   = useState(false);
  const [scanRestartCopy,setScanRestartCopy] = useState("");
  const processingTimerRef                 = useRef(null);
  const settleTimerRef                     = useRef(null);
  const lockBeatTimerRef                   = useRef(null);

  const scanning=phase==="scanning";
  const scanSettling=phase==="settling";
  const scanProcessing=phase==="processing";
  const cardLockActive=phase==="cardlock";
  const wantsCard=scanMode==="card";

  const canvasRef=useRef(null);
  const {
    videoRef,
    ready: camReady,
    requesting: camRequesting,
    camErr,
    start: startCamera,
    stop: stopCamera,
  } = useCamera();
  const advanceToSettling=useCallback(()=>{
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    setScanRestartCopy("");
    setPhase("settling");
    settleTimerRef.current=setTimeout(()=>{
      setPhase("scanning");
      settleTimerRef.current=null;
    },PRE_SCAN_SETTLE_MS);
  },[]);
  // Auto-start / manual "start scan" both route here: card mode goes through
  // cardlock first (unless the scale is already locked from a prior lock —
  // e.g. recovering from a mid-scan abort), iris mode settles straight away.
  const routeAfterPositioning=useCallback(()=>{
    if (scanMode==="card"&&calibration?.source!=="credit-card"){
      setCardChoice(false);
      setPhase("cardlock");
    } else {
      advanceToSettling();
    }
  },[advanceToSettling,calibration,scanMode]);
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
    if (lockBeatTimerRef.current) clearTimeout(lockBeatTimerRef.current);
    lockBeatTimerRef.current=setTimeout(()=>{
      lockBeatTimerRef.current=null;
      advanceToSettling();
    },900);
  },[advanceToSettling,setCalibration]);
  const handleCardTimeout=useCallback(()=>{
    setCardChoice(true);
  },[]);
  const continueWithIris=useCallback(()=>{
    setCardChoice(false);
    setScanMode("iris");
    setCalibration({
      source:"iris-fallback",
      skippedCard:true,
      timestamp:new Date().toISOString(),
    });
    advanceToSettling();
  },[advanceToSettling,setCalibration]);
  const handleScanAbort=useCallback((message)=>{
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (lockBeatTimerRef.current) clearTimeout(lockBeatTimerRef.current);
    processingTimerRef.current=null;
    settleTimerRef.current=null;
    lockBeatTimerRef.current=null;
    setConfirmedMeas(null);
    setCameraIntro(false);
    setScanPrepDismissed(true);
    setCardChoice(false);
    setPhase("positioning");
    setScanRestartCopy(message||"scan lost. position your face and tap start again.");
  },[setConfirmedMeas]);
  const scan=useFaceScan({
    videoRef,
    scanning,
    canvasRef,
    scaleMmPerPx:calibration?.mmPerPx||null,
    scaleSource:calibration?.source||"iris-fallback",
    cardLockActive,
    wantsCard,
    faceEnabled:camReady&&!cameraIntro,
    debugScan:debugEnabled,
    onCardLocked:handleCardLocked,
    onCardTimeout:handleCardTimeout,
    engineActive:true,
    onAutoStart:routeAfterPositioning,
    onScanAbort:handleScanAbort,
  });
  // Measurements worth showing: confirmed ones, or fresh scan results whose
  // quality did NOT demand a rescan (rescan-grade scans carry null measurements).
  const currentMeas=confirmedMeas||(!scan.quality?.rescan?scan.measurements:null);

  // ScanStage only renders during step 1 — stop the camera on unmount.
  useEffect(()=>()=>stopCamera(),[stopCamera]);
  // Release the camera as soon as the scan finishes — the video is hidden at that
  // point, and leaving the stream (and the camera light) on undermines the
  // "scan stays on this device" promise while the user reviews results. Redo-grade
  // scans (too few clean samples) are the exception: the re-do card invites an
  // immediate retry, so the camera stays warm instead of shutting down and
  // reopening a moment later.
  useEffect(()=>{ if(scan.done&&!scan.quality?.rescan){ stopCamera(); } },[scan.done,scan.quality,stopCamera]);
  useEffect(()=>()=>{
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (lockBeatTimerRef.current) clearTimeout(lockBeatTimerRef.current);
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
      setPhase("processing");
      processingTimerRef.current=setTimeout(()=>{
        setConfirmedMeas({
          ...scan.measurements,
          scanQuality:scan.quality?.label||"Review",
          scanReason:scan.quality?.reason||"",
          validPct:scan.validPct,
        });
        onScanComplete();
        processingTimerRef.current=null;
        onAdvance(); // advance automatically to the measurements payoff
      },2000);
    }
  },[confirmedMeas,onScanComplete,onAdvance,scan.done,scan.measurements,scan.quality,scan.validPct,scanProcessing,setConfirmedMeas]);

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
    onScanComplete();
    onAdvance();
  }

  function resetScanState({keepMode}){
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (lockBeatTimerRef.current) clearTimeout(lockBeatTimerRef.current);
    processingTimerRef.current=null;
    settleTimerRef.current=null;
    lockBeatTimerRef.current=null;
    setScanRestartCopy("");
    setCardChoice(false);
    scan.reset();
    setCameraIntro(false);
    setConfirmedMeas(null);
    setCalibration(null);
    if (keepMode){
      setScanPrepDismissed(true);
      setPhase("positioning");
    } else {
      setScanPrepDismissed(false);
      setScanMode(null);
      setPhase("consent");
    }
    stopCamera();
  }

  function internalReset(){
    resetScanState({keepMode:false});
  }

  // Quick retry (in-scan "Try again" / "rescan" buttons): the user already
  // consented and picked a mode, so keep scanMode and skip consent — just
  // clear scan state and restart the camera flow like beginScanSetup does.
  // Guard: if scanMode is somehow null here, fall back to a full reset so we
  // never start the camera without a mode.
  function rescan(){
    if (!scanMode){ internalReset(); return; }
    resetScanState({keepMode:true});
    setCameraIntro(true);
    startCamera();
  }

  // Re-do (the "let's try that again" card after a too-few-samples scan): the
  // camera never stopped for a redo-grade finish, and any locked card
  // calibration is still good, so this is lighter than rescan() — no
  // stopCamera/startCamera cycle, no clearing calibration, straight back to
  // positioning with the video feed already live.
  function redoScan(){
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (lockBeatTimerRef.current) clearTimeout(lockBeatTimerRef.current);
    processingTimerRef.current=null;
    settleTimerRef.current=null;
    lockBeatTimerRef.current=null;
    setScanRestartCopy("");
    setCardChoice(false);
    scan.reset();
    setConfirmedMeas(null);
    setPhase("positioning");
  }

  // FramesSite increments resetToken instead of calling scan.reset()/rescan
  // directly (startFreshScan/restartFlow/step-2's rescan path). Skip on the
  // initial mount (resetToken===0). internalReset only touches setters/refs,
  // so it's safe to omit from deps and fire solely on resetToken changes.
  useEffect(()=>{
    if (resetToken>0) internalReset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[resetToken]);

  function beginScanSetup(mode){
    setScanMode(mode);
    setScanRestartCopy("");
    setScanPrepDismissed(true);
    setCameraIntro(true);
    setCardChoice(false);
    setPhase("positioning");
    if (mode==="iris"){
      setCalibration({source:"iris-fallback",skippedCard:true,timestamp:new Date().toISOString()});
    }
    startCamera();
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
    <div className="section">
      <div className="eyebrow">Face scan</div>
      <div className="step-head">{scanTitle}</div>
      {scanCopy&&<p className="step-sub">{scanCopy}</p>}

      {showScanPrep&&(
        <div className="cam-placeholder pre-scan-card">
          <div className="pre-scan-line">this scan takes about {SCAN_DURATION_SECONDS_PLACEHOLDER} seconds and runs entirely in your browser.</div>
          <ScanSetupDiagram/>
          <div className="pre-scan-support">a credit or ID card is a fixed, known size — 85.6mm exactly. holding one under your chin anchors your measurements to the real world.</div>
          <div className="pre-scan-support">no rush — this screen waits while you grab one.</div>
          <div className="consent-choices">
            <button className="btn btn-primary consent-btn" onClick={()=>beginScanSetup("card")}>
              <span>i have a card</span><span className="consent-sub">most accurate</span>
            </button>
            <button className="btn btn-ghost consent-btn" onClick={()=>beginScanSetup("iris")}>
              <span>use iris only</span><span className="consent-sub">still good — measured from your eye</span>
            </button>
          </div>
          <div className="setup-list">
            <div>arm's length from your phone</div>
            <div>good overhead light, face it directly</div>
          </div>
          <div className="privacy-inline"><Padlock/><span>everything runs on this device. no photos or video are ever transmitted or stored — only your final millimeter numbers leave. your card is never read, only measured, and we blur it on screen automatically.</span></div>
        </div>
      )}

      {cameraActive&&!scan.done&&(
        <div className="cam-outer">
          <div className="cam-inner">
            <video ref={videoRef} autoPlay playsInline muted/>
            <canvas ref={canvasRef}/>
            <div className="cam-vignette"/>
            <FaceGuide fill={scan.fill} poseHint={!scanRestartCopy&&!scanning&&!scanSettling?scan.poseHint:null} done={scan.done}/>
            {cameraIntro&&!scanRestartCopy&&phase!=="cardlock"&&(
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
            {phase==="cardlock"&&!cardChoice&&(
              <div className="settle-intro">
                <div className="settle-intro-main">{scan.cardStatus.stablePct>=1?"scale locked.":"show your card"}</div>
                {scan.cardStatus.stablePct<1&&<div className="face-intro-sub">hold it flat under your chin, facing the camera{scan.cardStatus.reason?` — ${scan.cardStatus.reason}`:""}</div>}
              </div>
            )}
            {phase==="cardlock"&&cardChoice&&(
              <div className="face-intro" style={{pointerEvents:"auto",background:"rgba(0,0,0,.55)"}}>
                <div className="face-intro-main">having trouble?</div>
                <div className="face-intro-sub">we couldn't get a clean read on the card.</div>
                <div className="btn-row" style={{marginTop:14}}>
                  <button className="btn btn-primary" onClick={()=>{setCardChoice(false);scan.retryCardLock();}}>retry card</button>
                  <button className="btn btn-ghost" onClick={continueWithIris}>continue with iris</button>
                </div>
              </div>
            )}
            {debugEnabled&&(
              <div className="debug-overlay">
                <div>L iris: {scan.debugInfo?.lIrisPx ?? "-"}px</div>
                <div>R iris: {scan.debugInfo?.rIrisPx ?? "-"}px</div>
                <div>Scale: {scan.debugInfo?.scaleFactor ?? "-"}</div>
                <div>Raw PD: {scan.debugInfo?.rawPd ?? "-"}mm</div>
                <div>EAR: {scan.debugInfo?.earMin ?? "-"}</div>
                <div>Frames: {scan.debugInfo?.validFrames ?? 0}/{scan.debugInfo?.totalFrames ?? 0}</div>
                <div>Source: {scan.debugInfo?.scaleSource ?? "iris-fallback"}</div>
                <div>Discard: {scan.debugInfo?.discarded ? Object.entries(scan.debugInfo.discarded).map(([k,v])=>`${k}:${v}`).join(", ") : "-"}</div>
              </div>
            )}
            <div className="cam-bottom">
              <div className={`scan-inst ${scanCamInst.lost?"scan-inst-lost":""}`} aria-live="polite" style={scanCamInst.warn?{color:"#C49A2E"}:undefined}>
                {scanCamInst.text}
              </div>
            </div>
          </div>
        </div>
      )}

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
          {phase==="positioning"&&(
              <button className="btn btn-primary" disabled={!scan.mpReady||!scan.facePresent} onClick={routeAfterPositioning}>
                {scan.mpReady?scan.facePresent?"start scan →":"find your face first":"loading..."}
              </button>
          )}
        </div>
      )}

      {scan.done&&!scanProcessing&&scan.quality?.rescan&&(
        <div className="cam-placeholder" style={{marginTop:0}}>
          <div className="cam-label">{scan.quality.label}</div>
          <div className="cam-sub">{scan.quality.reason}</div>
          <button className="btn btn-primary" style={{marginTop:4}} onClick={redoScan}>scan again &rarr;</button>
        </div>
      )}

      {scan.done&&!scanProcessing&&!currentMeas&&!scan.quality?.rescan&&(
        <div className="cam-placeholder" style={{marginTop:0}}>
          <div className="cam-label" style={{color:"var(--red)"}}>{scan.quality?.label||"No face data captured."}</div>
          <div className="cam-sub">{scan.quality?.reason||"Ensure your face is well-lit and centered."}</div>
          <button className="btn btn-ghost" style={{marginTop:4}} onClick={rescan}>Try again</button>
        </div>
      )}

      {(scan.done||confirmedMeas)&&currentMeas&&!scanProcessing&&!scan.quality?.rescan&&(
        <div className="quality-card">
          <div className="quality-head">
            <div className="quality-title">your face is mapped.</div>
          </div>
          <p className="quality-copy">
            here are your measurements.
          </p>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={acceptMeasurements}>see my measurements &rarr;</button>
            <button className="btn btn-ghost" onClick={rescan}>rescan</button>
          </div>
        </div>
      )}
    </div>
  );
}
