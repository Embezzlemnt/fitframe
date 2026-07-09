import { useState, useRef, useEffect, useCallback } from "react";
import { validatePose, calcIrisMetrics, calcYawRatio, calcMeasurements, calcEAR } from "./faceMetrics.js";
import { loadScript, loadOpenCv, detectCardOutline, drawDetectedCard, drawCardBlurMask, detectionSimilarity } from "./cardDetection.js";
import { IRIS_MM, FACE_ABORT_FRAMES, FACE_YAW_MAX, EAR_BLINK_MIN, CREDIT_CARD_WIDTH_MM, CREDIT_CARD_HEIGHT_MM, CARD_STABLE_FRAMES, CARD_MAX_ROTATION_DEG, CARD_MIN_CONFIDENCE, CARD_LOCK_TIMEOUT_MS, MEDIAPIPE_FACE_MESH_VERSION, SCAN_SEQ, MIN_VALID_SAMPLES, PD_ADULT_MIN, PD_ADULT_MAX, BRIDGE_MIN, BRIDGE_MAX, MONOCULAR_SYMMETRY } from "./constants.js";

// ─── useFaceScan ──────────────────────────────────────────────────────────────
const HOLD_FRAMES = 18;
export default function useFaceScan({ videoRef, scanning, canvasRef, scaleMmPerPx=null, scaleSource="iris-fallback", cardLockActive=false, wantsCard=false, faceEnabled=true, engineActive=true, debugScan=false, onCardLocked, onCardTimeout, onAutoStart, onScanAbort }) {
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
  const cardTimeoutFiredRef = useRef(false);
  const cardLockActiveRef = useRef(cardLockActive);
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
  useEffect(()=>{ cardLockActiveRef.current=cardLockActive; },[cardLockActive]);

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
    cardStableRef.current=0; lastCardRef.current=null; cardLockedRef.current=false; cardStartedRef.current=null; cardTimeoutFiredRef.current=false;
    holdRef.current=0; autoStarted.current=false;
    onScanAbort?.(reason);
    requestAnimationFrame(()=>{ abortingRef.current=false; });
  },[clearScanCanvas,onScanAbort,resetSampleState]);

  useEffect(()=>{
    if (done) clearScanCanvas();
  },[clearScanCanvas,done]);

  const processCardFrame=useCallback((ctx)=>{
    const video=videoRef.current;
    if (!video||cardLockedRef.current) return;
    if (!cardStartedRef.current) cardStartedRef.current=performance.now();
    const timedOut=performance.now()-cardStartedRef.current>CARD_LOCK_TIMEOUT_MS;
    if ((cardLoadFailedRef.current||timedOut)&&!cardTimeoutFiredRef.current){
      cardTimeoutFiredRef.current=true;
      onCardTimeout?.();
      return;
    }
    if (!cvReady||cardTimeoutFiredRef.current) return;
    const W=video.videoWidth||640, H=video.videoHeight||480;
    const workCanvas=workCanvasRef.current||(workCanvasRef.current=document.createElement("canvas"));
    const detection=detectCardOutline(video,W,H,workCanvas);
    if (detection){
      const similar=detectionSimilarity(detection,lastCardRef.current)<26;
      const highConfidence=detection.confidence>=CARD_MIN_CONFIDENCE;
      const flatEnough=detection.angle<=CARD_MAX_ROTATION_DEG;
      cardStableRef.current=similar&&highConfidence&&flatEnough?Math.min(CARD_STABLE_FRAMES,cardStableRef.current+1):1;
      lastCardRef.current=detection;
      const stablePct=cardStableRef.current/CARD_STABLE_FRAMES;
      if (ctx){ drawCardBlurMask(ctx,videoRef.current,detection); drawDetectedCard(ctx,detection,stablePct); }
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
  },[cvReady,onCardLocked,onCardTimeout,videoRef]);

  const retryCardLock=useCallback(()=>{
    cardStartedRef.current=null; cardStableRef.current=0; lastCardRef.current=null;
    cardLockedRef.current=false; cardTimeoutFiredRef.current=false;
    setCardStatus({label:"scale — iris reference",stablePct:0,reason:""});
  },[]);

  // opencv.js is ~10MB — only fetch it once the user enters card-lock mode.
  useEffect(()=>{
    if (!engineActive||!wantsCard) return;
    loadOpenCv().then(()=>setCvReady(true)).catch(()=>{
      cardLoadFailedRef.current=true;
      setCardStatus({label:"scale — iris reference",stablePct:0,reason:""});
    });
  },[engineActive,wantsCard]);

  const handleResults=useCallback((results)=>{
    const video=videoRef.current, canvas=canvasRef.current;
    if (!canvas||!video) return;
    const W=video.videoWidth||640, H=video.videoHeight||480;
    canvas.width=W; canvas.height=H;
    const ctx=canvas.getContext("2d");
    ctx.clearRect(0,0,W,H);
    if (doneRef.current||abortingRef.current) { clearScanCanvas(); return; }

    const cardLockActiveNow=cardLockActiveRef.current;   // routed via ref like scanningRef
    if (cardLockActiveNow&&!cardLockedRef.current) processCardFrame(ctx);

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
    const ear=calcEAR(d);
    setDebugInfo({
      lIrisPx:iris.lId?Number(iris.lId.toFixed(1)):null,
      rIrisPx:iris.rId?Number(iris.rId.toFixed(1)):null,
      scaleFactor:debugScale?Number(debugScale.toFixed(4)):null,
      rawPd:debugScale?Number((d(468,473)*debugScale).toFixed(1)):null,
      yawRatio:Number(yawRatio.toFixed(3)),
      earMin:Number(ear.min.toFixed(3)),
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
      } else if (ear.min<EAR_BLINK_MIN){
        markDiscard("blink");
      } else {
        const m=calcMeasurements(lm,W,H,scaleRef.current,scaleHistoryRef,iris);
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
  },[abortActiveScan,canvasRef,clearScanCanvas,logScanDebug,markDiscard,onAutoStart,processCardFrame,videoRef]);

  // The results callback changes identity as scan state changes; route it through a
  // ref so FaceMesh (a heavy wasm graph) is constructed exactly once per session
  // instead of being re-instantiated (and leaked) on every dependency change.
  const handleResultsRef=useRef(handleResults);
  useEffect(()=>{ handleResultsRef.current=handleResults; },[handleResults]);

  const mpInitStartedRef=useRef(false);
  useEffect(()=>{
    if (!engineActive||mpInitStartedRef.current) return;
    mpInitStartedRef.current=true;
    loadScript(`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@${MEDIAPIPE_FACE_MESH_VERSION}/face_mesh.js`)
      .then(()=>{
        function init(retry){
          if (!window.FaceMesh){ if(retry) setTimeout(()=>init(false),800); return; }
          const fm=new window.FaceMesh({locateFile:f=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@${MEDIAPIPE_FACE_MESH_VERSION}/${f}`});
          fm.setOptions({maxNumFaces:1,refineLandmarks:true,minDetectionConfidence:.5,minTrackingConfidence:.5});
          fm.onResults(results=>handleResultsRef.current?.(results));
          fm.initialize().then(()=>{ fmRef.current=fm; setMpReady(true); });
        }
        init(true);
      }).catch(e=>console.error("MediaPipe:",e));
  },[engineActive]);

  useEffect(()=>{
    if (!faceEnabled) return; // don't burn a rAF loop on steps that never process frames
    const loop=async()=>{
      const v=videoRef.current;
      if (doneRef.current||abortingRef.current){
        clearScanCanvas();
      } else if (fmRef.current&&v&&v.readyState>=2&&!procRef.current){
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
    cardStableRef.current=0; lastCardRef.current=null; cardLockedRef.current=false; cardStartedRef.current=null; cardTimeoutFiredRef.current=false;
    holdRef.current=0; autoStarted.current=false; abortingRef.current=false;
  },[resetSampleState]);

  return {seqIdx,fill,done,measurements,mpReady,cvReady,autoStartPct,facePresent,poseHint,quality,validPct,cardStatus,debugInfo,reset,retryCardLock};
}
