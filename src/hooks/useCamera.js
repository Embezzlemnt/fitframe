import { useCallback, useRef, useState } from "react";
import { classifyCamError } from "../utils.js";

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
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"user", width:{ ideal:640 }, height:{ ideal:480 } }, audio:false });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
      }
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        v.setAttribute("playsinline", "");
        v.muted = true;
        await v.play().catch(() => {});
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
