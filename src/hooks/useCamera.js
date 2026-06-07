import { useCallback, useRef, useState } from "react";
import { classifyCamError } from "../utils.js";

export default function useCamera() {
  const videoElRef = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [camErr, setCamErr] = useState(null);

  const attachStream = useCallback((node) => {
    if (!node || !streamRef.current) return;
    node.setAttribute("playsinline", "");
    node.muted = true;
    node.srcObject = streamRef.current;
    node.play().catch(() => {});
  }, []);

  const videoRef = videoElRef;

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

      streamRef.current = stream;

      let v = videoElRef.current;
      for (let i = 0; i < 10 && !v; i++) {
        await new Promise(r => setTimeout(r, 100));
        v = videoElRef.current;
      }

      if (!v) {
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setCamErr({ type:"unknown", headline:"camera unavailable", detail:"could not connect to camera view. reload and try again.", fix:"reload" });
        setLoading(false);
        return;
      }

      attachStream(v);
      setReady(true);
    } catch(e) {
      stream?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setCamErr(classifyCamError(e));
      setReady(false);
    } finally {
      setLoading(false);
    }
  }, [attachStream]);

  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    const v = videoElRef.current;
    if (v) v.srcObject = null;
    setReady(false);
    setLoading(false);
  }, []);

  return { videoRef, ready, loading, camErr, start, stop };
}
