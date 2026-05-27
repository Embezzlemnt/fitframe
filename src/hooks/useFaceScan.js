import { useCallback, useEffect, useRef, useState } from "react";
import { ACCENT, HOLD_FRAMES, SCAN_SEQ, calcMeasurements, isIOSSafari, loadScript, validatePose } from "../utils.js";

const MP_FACE_MESH_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619";
const IOS_SAFARI_FRAME_TIMEOUT_MS = 2500;
const IOS_SAFARI_RESULT_TIMEOUT_MS = 6500;

const MP_SCRIPTS = [
  "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.4.1633559619/camera_utils.js",
  "https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils@0.3.1675466124/drawing_utils.js",
  "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/face_mesh.js",
];

export default function useFaceScan({ videoRef, scanning, canvasRef, onAutoStart }) {
  const fmRef = useRef(null);
  const iosSafariRef = useRef(isIOSSafari());
  const [mpReady, setMpReady] = useState(false);
  const [mpLoadError, setMpLoadError] = useState(false);
  const samplesRef = useRef([]);
  const noseXRef = useRef([]);
  const validRef = useRef(0);
  const totalRef = useRef(0);
  const loopRef = useRef(null);
  const procRef = useRef(false);
  const scanningRef = useRef(false);
  const holdRef = useRef(0);
  const autoStarted = useRef(false);
  const fillRef = useRef(0);
  const frameCountRef = useRef(0);
  const facePresentRef = useRef(false);
  const lastResultAtRef = useRef(0);

  const [seqIdx, setSeqIdx] = useState(-1);
  const [fill, setFill] = useState(0);
  const [done, setDone] = useState(false);
  const [measurements, setMeasurements] = useState(null);
  const [autoStartPct, setAutoStartPct] = useState(0);
  const [facePresent, setFacePresent] = useState(false);
  const [poseHint, setPoseHint] = useState(null);
  const [quality, setQuality] = useState(null);
  const [validPct, setValidPct] = useState(0);
  const [faceSpan, setFaceSpan] = useState(0);
  const [lightWarning, setLightWarning] = useState(null);
  const [pauseWarning, setPauseWarning] = useState(false);
  const [scanLost, setScanLost] = useState(false);
  const [scanError, setScanError] = useState(null);

  useEffect(() => { scanningRef.current = scanning; }, [scanning]);

  function handleResults(results) {
    lastResultAtRef.current = performance.now();
    setScanError(null);
    frameCountRef.current++;
    const shouldUpdateUI = frameCountRef.current % 3 === 0;
    const video = videoRef.current, canvas = canvasRef.current;
    if (!canvas || !video) return;
    const W = video.videoWidth || 640, H = video.videoHeight || 480;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    if (!results.multiFaceLandmarks?.length) {
      holdRef.current = 0;
      facePresentRef.current = false;
      if (shouldUpdateUI) {
        setFacePresent(false);
        setPoseHint(null);
        setLightWarning(null);
        setFaceSpan(0);
        if (!autoStarted.current) setAutoStartPct(0);
      }
      return;
    }

    const lm = results.multiFaceLandmarks[0];
    const pts = lm.map(p => ({ x:p.x*W, y:p.y*H }));
    const d = (a,b) => Math.sqrt((pts[a].x-pts[b].x)**2+(pts[a].y-pts[b].y)**2);
    const span = Math.abs(lm[454].x - lm[234].x);
    const pose = validatePose(lm);

    ctx.drawImage(video, 0, 0, W, H);
    const sx = Math.max(0, Math.min(W - 1, Math.floor(pts[1].x) - 20));
    const sy = Math.max(0, Math.min(H - 1, Math.floor(pts[1].y) - 20));
    const sw = Math.min(40, W - sx);
    const sh = Math.min(40, H - sy);
    const imageData = ctx.getImageData(sx, sy, sw, sh);
    const luma = imageData.data.reduce((sum, v, i) => i % 4 !== 3 ? sum + v : sum, 0) / (sw * sh * 3);
    ctx.clearRect(0, 0, W, H);
    const lightHint = luma < 40 ? "Better lighting needed" : luma > 220 ? "Move from direct light" : null;
    const currentHint = lightHint || (pose.valid ? null : pose.reason);
    facePresentRef.current = pose.valid && !lightHint;

    if (shouldUpdateUI) {
      setFacePresent(true);
      setFaceSpan(span);
      setPoseHint(currentHint);
      setLightWarning(lightHint);
    }

    if (!autoStarted.current && !scanningRef.current) {
      pose.valid && !lightHint ? holdRef.current++ : (holdRef.current = Math.max(0, holdRef.current - 2));
      const pct = Math.min(holdRef.current / HOLD_FRAMES, 1);
      if (shouldUpdateUI) setAutoStartPct(pct);
      if (pct >= 1) {
        autoStarted.current = true;
        onAutoStart?.();
      }
    }

    const hasIris = [468,469,470,471,472,473,474,475,476,477].every(i => lm[i]);
    const lId = hasIris ? (d(468,469)+d(468,470)+d(468,471)+d(468,472))/4*2 : 0;
    const rId = hasIris ? (d(473,474)+d(473,475)+d(473,476)+d(473,477))/4*2 : 0;
    if (hasIris) {
      const ink = pose.valid && !lightHint ? ACCENT : "rgba(255,255,255,.22)";
      [[pts[468],lId],[pts[473],rId]].forEach(([c,diam]) => {
        ctx.beginPath(); ctx.arc(c.x,c.y,diam/2,0,Math.PI*2);
        ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.stroke();
      });
      ctx.beginPath(); ctx.moveTo(pts[468].x,pts[468].y); ctx.lineTo(pts[473].x,pts[473].y);
      ctx.strokeStyle = ink; ctx.lineWidth = .75; ctx.setLineDash([3,4]); ctx.stroke(); ctx.setLineDash([]);
    }

    if (scanningRef.current) totalRef.current++;
    if (scanningRef.current && pose.valid && !lightHint && hasIris) {
      if (lId < 4 || rId < 4) return;
      const ratio = Math.min(lId, rId) / Math.max(lId, rId);
      if (ratio < 0.70) return;
      noseXRef.current.push(lm[1].x);
      const recent = noseXRef.current.slice(-3);
      if (recent.length === 3) {
        const spread = Math.max(...recent) - Math.min(...recent);
        if (spread > 0.018) return;
      }
      const m = calcMeasurements(lm, W, H);
      if (m) {
        samplesRef.current.push(m);
        validRef.current++;
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    const delays = [800, 2000, 5000];

    async function init(attempt = 0) {
      try {
        await Promise.all(MP_SCRIPTS.map(loadScript));
        if (!window.FaceMesh) throw new Error("FaceMesh unavailable");
        const fm = new window.FaceMesh({
          locateFile:f => {
            const file = iosSafariRef.current && f.includes("_simd_") ? f.replace("_simd_", "_") : f;
            return `${MP_FACE_MESH_BASE}/${file}`;
          }
        });
        fm.setOptions({ maxNumFaces:1, refineLandmarks:true, minDetectionConfidence:.5, minTrackingConfidence:.5, ...(iosSafariRef.current ? { useCpuInference:true } : {}) });
        fm.onResults(handleResults);
        await fm.initialize();
        if (!cancelled) {
          fmRef.current = fm;
          setMpReady(true);
        }
      } catch (e) {
        if (cancelled) return;
        if (attempt < delays.length) {
          setTimeout(() => init(attempt + 1), delays[attempt]);
        } else {
          console.error("MediaPipe:", e);
          setMpLoadError(true);
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const loop = async () => {
      const v = videoRef.current;
      if (fmRef.current && v && v.readyState >= 2 && !procRef.current) {
        procRef.current = true;
        if (iosSafariRef.current) {
          let timer;
          try {
            await Promise.race([
              fmRef.current.send({ image:v }),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error("Face scanner frame timed out.")), IOS_SAFARI_FRAME_TIMEOUT_MS);
              })
            ]);
          } catch {
            try { await fmRef.current?.reset?.(); } catch { /* best-effort MediaPipe recovery */ }
            if (scanningRef.current && performance.now() - lastResultAtRef.current > IOS_SAFARI_RESULT_TIMEOUT_MS) {
              setSeqIdx(-1);
              setFill(0);
              fillRef.current = 0;
              setPauseWarning(false);
              setScanLost(false);
              setScanError("Face scanning stalled in Safari. Tap retry and keep your face centered in good light.");
            }
          } finally {
            if (timer) clearTimeout(timer);
          }
        } else {
          try { await fmRef.current.send({ image:v }); } catch { /* preserve existing silent desktop retry behavior */ }
        }
        procRef.current = false;
      }
      loopRef.current = requestAnimationFrame(loop);
    };
    loopRef.current = requestAnimationFrame(loop);
    return () => { if (loopRef.current) cancelAnimationFrame(loopRef.current); };
  }, []);

  useEffect(() => {
    if (scanning && !done) {
      lastResultAtRef.current = performance.now();
      setScanError(null);
      setScanLost(false);
      setPauseWarning(false);
      samplesRef.current = [];
      noseXRef.current = [];
      validRef.current = 0;
      totalRef.current = 0;
      setSeqIdx(0);
    }
  }, [scanning]);

  useEffect(() => {
    if (seqIdx < 0 || seqIdx >= SCAN_SEQ.length) return;
    const step = SCAN_SEQ[seqIdx], end = step.fill;
    let start = fillRef.current;
    let t0 = performance.now();
    let wasPaused = false;
    let lostSince = null;
    let raf;
    const animate = now => {
      if (!facePresentRef.current) {
        if (!lostSince) lostSince = now;
        setFill(fillRef.current);
        setPauseWarning(true);
        if (now - lostSince > 4000) {
          setSeqIdx(-1);
          setFill(0);
          fillRef.current = 0;
          setDone(false);
          setMeasurements(null);
          setQuality(null);
          setAutoStartPct(0);
          setPauseWarning(false);
          setScanLost(true);
          samplesRef.current = [];
          noseXRef.current = [];
          validRef.current = 0;
          totalRef.current = 0;
          holdRef.current = 0;
          autoStarted.current = false;
          return;
        }
        wasPaused = true;
        raf = requestAnimationFrame(animate);
        return;
      }
      if (wasPaused) {
        start = fillRef.current;
        t0 = now;
        wasPaused = false;
        lostSince = null;
      }
      setPauseWarning(false);
      const t = Math.min((now - t0) / step.holdMs, 1);
      const v = start + (end - start) * t;
      fillRef.current = v;
      setFill(v);
      if (t < 1) {
        raf = requestAnimationFrame(animate);
      } else if (seqIdx < SCAN_SEQ.length - 1) {
        setSeqIdx(i => i + 1);
      } else {
        setDone(true);
        const s = samplesRef.current;
        const vp = totalRef.current > 0 ? validRef.current / totalRef.current : 0;
        setValidPct(Math.round(vp * 100));
        if (s.length >= 12) {
          const sorted = [...s].sort((a,b) => parseFloat(a.pd) - parseFloat(b.pd));
          const trim = Math.max(1, Math.floor(sorted.length * .15));
          const good = sorted.slice(trim, sorted.length - trim);
          const avg = k => good.map(m => parseFloat(m[k])).reduce((a,b) => a + b, 0) / good.length;
          const pd = avg("pd"), br = avg("bridge");
          const sane = pd >= 52 && pd <= 80 && br >= 10 && br <= 28;
          setMeasurements({ pd:pd.toFixed(1), pdLeft:avg("pdLeft").toFixed(1), pdRight:avg("pdRight").toFixed(1), bridge:br.toFixed(1), temple:avg("temple").toFixed(0), lensH:avg("lensH").toFixed(1), faceW:avg("faceW").toFixed(0) });
          setQuality(!sane ? { label:"Out of range", rescan:true } : vp >= .7 ? { label:"Excellent", rescan:false } : vp >= .5 ? { label:"Good", rescan:false } : vp >= .3 ? { label:"Fair", rescan:false } : { label:"Low", rescan:true });
        } else {
          setQuality({ label:"Low", rescan:true, reason:"Not enough stable frames captured. Try better lighting and hold still." });
          setMeasurements(null);
        }
      }
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [seqIdx]);

  const reset = useCallback(() => {
    setSeqIdx(-1);
    setFill(0);
    fillRef.current = 0;
    setDone(false);
    setMeasurements(null);
    setQuality(null);
    setAutoStartPct(0);
    setFacePresent(false);
    setPoseHint(null);
    setLightWarning(null);
    setPauseWarning(false);
    setScanLost(false);
    setScanError(null);
    setFaceSpan(0);
    facePresentRef.current = false;
    samplesRef.current = [];
    noseXRef.current = [];
    validRef.current = 0;
    totalRef.current = 0;
    holdRef.current = 0;
    autoStarted.current = false;
  }, []);

  return { seqIdx, fill, done, measurements, mpReady, mpLoadError, autoStartPct, facePresent, faceSpan, poseHint, lightWarning, pauseWarning, scanLost, scanError, quality, validPct, reset };
}
