import { useState, useRef, useEffect, useCallback } from "react";

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
export default function useCamera() {
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
