import { useCallback, useRef, useState } from "react";
import { classifyCamError, isIOSSafari } from "../utils.js";

function waitForVideoFrame(video, timeoutMs = 5000) {
  if (video.readyState >= 2 && video.videoWidth && video.videoHeight) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let raf = null;
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
      video.removeEventListener("loadedmetadata", check);
      video.removeEventListener("canplay", check);
      video.removeEventListener("playing", check);
      ok ? resolve() : reject(new Error("Camera video did not start."));
    };
    const check = () => {
      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) finish(true);
    };
    const tick = () => {
      check();
      if (settled) return;
      raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    video.addEventListener("loadedmetadata", check);
    video.addEventListener("canplay", check);
    video.addEventListener("playing", check);
    tick();
  });
}

function waitForLoadedMetadata(video, timeoutMs = 5000) {
  if (video.readyState >= 1 && video.videoWidth && video.videoHeight) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onLoaded);
      ok ? resolve() : reject(new Error("Camera metadata did not load."));
    };
    const onLoaded = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    video.addEventListener("loadedmetadata", onLoaded, { once:true });
  });
}

function waitForVideoElement(videoRef, timeoutMs = 1000) {
  if (videoRef.current) return Promise.resolve(videoRef.current);
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const tick = () => {
      if (videoRef.current) resolve(videoRef.current);
      else if (performance.now() - started > timeoutMs) reject(new Error("Camera view did not mount."));
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

export default function useCamera() {
  const videoRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [camErr, setCamErr] = useState(null);

  const start = useCallback(async () => {
    setCamErr(null);
    setReady(false);
    setLoading(true);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamErr({ type:"https", headline:"Camera unavailable", detail:"Ensure you're on https://", fix:null });
      setLoading(false);
      return;
    }
    let stream = null;
    try {
      const safari = isIOSSafari();
      try {
        const video = safari ? { facingMode:"user" } : { facingMode:"user", width:{ ideal:640 }, height:{ ideal:480 } };
        stream = await navigator.mediaDevices.getUserMedia({ video, audio:false });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
      }
      const v = await waitForVideoElement(videoRef);
      v.setAttribute("playsinline", "");
      v.setAttribute("autoplay", "");
      if (safari) v.setAttribute("webkit-playsinline", "");
      v.playsInline = true;
      v.autoplay = true;
      v.muted = true;
      v.defaultMuted = true;
      v.srcObject = stream;
      await waitForLoadedMetadata(v, 8000);
      await v.play();
      await waitForVideoFrame(v, 8000);
      setReady(true);
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop());
      setCamErr(classifyCamError(e));
      setReady(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const stop = useCallback(() => {
    const v = videoRef.current;
    if (v?.srcObject) {
      v.srcObject.getTracks().forEach(t => t.stop());
      v.srcObject = null;
    }
    setReady(false);
    setLoading(false);
  }, []);

  return { videoRef, ready, loading, camErr, start, stop };
}
