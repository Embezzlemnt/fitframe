import { useCallback, useRef, useState } from "react";
import { classifyCamError } from "../utils.js";

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
      setCamErr({ type:"https", headline:"camera unavailable", detail:"requires https://", fix:null });
      setLoading(false);
      return;
    }

    let stream = null;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"user", width:{ideal:640}, height:{ideal:480} }, audio:false });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
      }

      console.log("Camera stream acquired");
      let v = videoRef.current;
      for (let i = 0; i < 10 && !v; i++) {
        await new Promise(r => setTimeout(r, 100));
        v = videoRef.current;
      }

      if (!v) {
        stream.getTracks().forEach(t => t.stop());
        setCamErr({ type:"unknown", headline:"camera unavailable", detail:"could not connect to camera view. reload and try again.", fix:"reload" });
        setLoading(false);
        return;
      }

      v.setAttribute("playsinline", "");
      v.muted = true;
      v.srcObject = stream;
      await v.play().catch(() => {});
      console.log("Video element ready");
      setReady(true);
    } catch(e) {
      console.error("Camera error:", e?.name, e?.message, e?.constraint, e);
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
