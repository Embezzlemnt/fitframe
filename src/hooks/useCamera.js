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

export default function useCamera() {
  const videoRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [camErr, setCamErr] = useState(null);

  const start = useCallback(async () => {
    setCamErr(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamErr({ type:"https", headline:"Camera unavailable", detail:"Ensure you're on https://", fix:null });
      return;
    }
    try {
      const safari = isIOSSafari();
      let stream;
      try {
        const video = safari ? { facingMode:"user" } : { facingMode:"user", width:{ ideal:640 }, height:{ ideal:480 } };
        stream = await navigator.mediaDevices.getUserMedia({ video, audio:false });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
      }
      const v = videoRef.current;
      if (v) {
        v.setAttribute("playsinline", "");
        if (safari) v.setAttribute("webkit-playsinline", "");
        v.muted = true;
        v.srcObject = stream;
        if (safari) {
          await v.play();
          await waitForVideoFrame(v);
        } else {
          await v.play().catch(() => {});
        }
        setReady(true);
      }
    } catch (e) {
      setCamErr(classifyCamError(e));
    }
  }, []);

  const stop = useCallback(() => {
    const v = videoRef.current;
    if (v?.srcObject) {
      v.srcObject.getTracks().forEach(t => t.stop());
      v.srcObject = null;
    }
    setReady(false);
  }, []);

  return { videoRef, ready, camErr, start, stop };
}
