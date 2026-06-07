import { useCallback, useEffect, useRef, useState } from "react";
import { ACCENT, CREDIT_CARD_WIDTH_MM, HOLD_FRAMES, IRIS_MM, SCAN_SEQ, clamp, isIOSSafari, loadScript, validatePose } from "../utils.js";

const MP_FACE_MESH_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619";
const OPENCV_URL = "https://docs.opencv.org/4.9.0/opencv.js";
const IOS_SAFARI_FRAME_TIMEOUT_MS = 2500;
const IOS_SAFARI_RESULT_TIMEOUT_MS = 6500;

const MP_SCRIPTS = [
  "https://unpkg.com/@mediapipe/camera_utils/camera_utils.js",
  "https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js",
  "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js",
];

const CREDIT_CARD_HEIGHT_MM = 54;
const CARD_ASPECT = CREDIT_CARD_WIDTH_MM / CREDIT_CARD_HEIGHT_MM;
const CARD_STABLE_FRAMES = 6;
const CARD_MAX_ROTATION_DEG = 14;
const CARD_MIN_CONFIDENCE = 0.58;
const CARD_FALLBACK_MS = 8000;
const IRIS_SD = 0.5;
const IRIS_MIN_PX = 10;
const IRIS_MAX_PX = 80;
const IRIS_MISMATCH_MAX = 0.30;
const TILT_THRESHOLD = 0.14;
const MIN_VALID_SAMPLES = 12;
const FACE_PRESENT_MIN_RATIO = 0.85;
const POSE_VALID_MIN_RATIO = 0.55;
const SCALE_HISTORY_FRAMES = 10;
const FACE_ABORT_FRAMES = 24;
const PD_ADULT_MIN = 52.0;
const PD_ADULT_MAX = 80.0;
const BRIDGE_MIN = 10.0;
const BRIDGE_MAX = 28.0;
const MONOCULAR_SYMMETRY = 2.5;

let openCvPromise;
function loadOpenCv() {
  if (window.cv?.Mat) return Promise.resolve();
  if (openCvPromise) return openCvPromise;
  openCvPromise = loadScript(OPENCV_URL).then(() => new Promise((resolve, reject) => {
    const started = performance.now();
    const tick = () => {
      if (window.cv?.Mat) resolve();
      else if (performance.now() - started > 4500) reject(new Error("OpenCV failed to load"));
      else setTimeout(tick, 50);
    };
    tick();
  }));
  return openCvPromise;
}

function median(arr) {
  const sorted = [...arr].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function distPt(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function orderQuad(points) {
  const pts = [...points];
  const bySum = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => (a.x - a.y) - (b.x - b.y));
  return [bySum[0], byDiff[3], bySum[3], byDiff[0]];
}

function quadAngleDeg(quad) {
  const [tl, tr] = quad;
  return Math.abs(Math.atan2(tr.y - tl.y, tr.x - tl.x) * 180 / Math.PI);
}

function detectionSimilarity(a, b) {
  if (!a || !b) return 0;
  const centerDelta = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
  const sizeDelta = Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
  const angleDelta = Math.abs(a.angle - b.angle);
  return centerDelta + sizeDelta * 0.5 + angleDelta * 3;
}

function drawDetectedCard(ctx, detection, stablePct) {
  const quad = detection.quad;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = detection.confidence >= CARD_MIN_CONFIDENCE ? ACCENT : "#e5a64a";
  ctx.shadowColor = "rgba(76,175,125,.65)";
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  quad.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(76,175,125,.95)";
  quad.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); });
  ctx.font = "13px 'Geist Mono', monospace";
  ctx.fillStyle = "rgba(255,255,255,.9)";
  ctx.textAlign = "center";
  ctx.fillText(stablePct >= 1 ? "SCALE LOCKED" : `CARD ${Math.round(stablePct * 100)}%`, detection.center.x, detection.center.y);
  ctx.restore();
}

function detectCardOutline(video, W, H, workCanvas) {
  const cv = window.cv;
  if (!cv?.Mat) return null;
  workCanvas.width = W;
  workCanvas.height = H;
  const wctx = workCanvas.getContext("2d", { willReadFrequently:true });
  wctx.drawImage(video, 0, 0, W, H);

  const roiX = Math.round(W * .08);
  const roiY = Math.round(H * .30);
  const roiW = Math.round(W * .84);
  const roiH = Math.round(H * .68);
  let src, roi, gray, blurred, edges, dilated, contours, hierarchy, kernel;
  try {
    src = cv.imread(workCanvas);
    roi = src.roi(new cv.Rect(roiX, roiY, roiW, roiH));
    gray = new cv.Mat();
    blurred = new cv.Mat();
    edges = new cv.Mat();
    dilated = new cv.Mat();
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 45, 140);
    cv.dilate(edges, dilated, kernel);
    cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let best = null;
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area < roiW * roiH * .035) { contour.delete(); continue; }
      const peri = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, peri * .025, true);
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const raw = [];
        for (let j = 0; j < 4; j++) raw.push({ x:approx.intPtr(j, 0)[0] + roiX, y:approx.intPtr(j, 0)[1] + roiY });
        const quad = orderQuad(raw);
        const top = distPt(quad[0], quad[1]);
        const bottom = distPt(quad[3], quad[2]);
        const left = distPt(quad[0], quad[3]);
        const right = distPt(quad[1], quad[2]);
        const width = (top + bottom) / 2;
        const height = (left + right) / 2;
        const aspect = width / height;
        const angle = quadAngleDeg(quad);
        const rect = cv.boundingRect(approx);
        const rectangularity = area / (rect.width * rect.height);
        const aspectScore = clamp(1 - Math.abs(aspect - CARD_ASPECT) / .42, 0, 1);
        const angleScore = clamp(1 - angle / CARD_MAX_ROTATION_DEG, 0, 1);
        const fillScore = clamp((rectangularity - .45) / .35, 0, 1);
        const confidence = aspectScore * .45 + angleScore * .3 + fillScore * .25;
        const candidate = {
          quad,
          width,
          height,
          angle,
          aspect,
          confidence,
          area,
          rectangularity,
          center:{ x:quad.reduce((s, p) => s + p.x, 0) / 4, y:quad.reduce((s, p) => s + p.y, 0) / 4 },
          mmPerPx:((CREDIT_CARD_WIDTH_MM / width) + (CREDIT_CARD_HEIGHT_MM / height)) / 2,
        };
        if (!best || candidate.confidence > best.confidence) best = candidate;
      }
      approx.delete();
      contour.delete();
    }
    return best && best.confidence >= .45 ? best : null;
  } finally {
    [kernel, hierarchy, contours, dilated, edges, blurred, gray, roi, src].forEach(m => m?.delete?.());
  }
}

function irisDiameter(center, edges, d) {
  const radii = edges.map(edge => d(center, edge)).filter(r => r >= 1);
  const med = median(radii);
  if (!med) return null;
  const clean = radii.filter(r => Math.abs(r - med) / med < 0.20);
  if (!clean.length) return null;
  return clean.reduce((a, b) => a + b, 0) / clean.length * 2;
}

function calcIrisMetrics(pts, d) {
  const lId = irisDiameter(468, [469, 470, 471, 472], d);
  const rId = irisDiameter(473, [474, 475, 476, 477], d);
  if (!lId || !rId || lId < 2 || rId < 2) return { valid:false, lId:lId || 0, rId:rId || 0, reason:"iris-lost" };
  const avgDiam = (lId + rId) / 2;
  if (avgDiam < IRIS_MIN_PX) return { valid:false, lId, rId, avgDiam, reason:"too-far" };
  if (avgDiam > IRIS_MAX_PX) return { valid:false, lId, rId, avgDiam, reason:"too-close" };
  const irisDelta = Math.abs(lId - rId) / avgDiam;
  if (irisDelta > IRIS_MISMATCH_MAX) return { valid:false, lId, rId, avgDiam, irisDelta, reason:"iris-mismatch" };
  const faceH = distPt(pts[10], pts[152]);
  const tiltRatio = faceH ? Math.abs(pts[468].y - pts[473].y) / faceH : 0;
  return { valid:true, lId, rId, avgDiam, irisDelta, tiltRatio, isTilted:tiltRatio > TILT_THRESHOLD };
}

function calcFrameMeasurements(lm, W, H, calibratedScale=null, scaleHistoryRef=null, pdCorrection=1) {
  const pts = lm.map(p => ({ x:p.x * W, y:p.y * H }));
  const d = (a, b) => Math.sqrt((pts[a].x - pts[b].x) ** 2 + (pts[a].y - pts[b].y) ** 2);
  const iris = calcIrisMetrics(pts, d);
  if (!iris.valid) return null;
  const irisScale = IRIS_MM / iris.avgDiam;
  if (scaleHistoryRef) {
    scaleHistoryRef.current.push(irisScale);
    if (scaleHistoryRef.current.length > SCALE_HISTORY_FRAMES) scaleHistoryRef.current.shift();
  }
  const stableIrisScale = median(scaleHistoryRef?.current || [irisScale]) || irisScale;
  const sc = calibratedScale || stableIrisScale;
  if (!sc) return null;
  const correction = Math.max(0.88, Math.min(pdCorrection, 1));
  const pd = d(468, 473) * sc * correction;
  const lPd = d(468, 6) * sc * correction;
  const rPd = d(473, 6) * sc * correction;
  const innerCanthi = d(133, 362) * sc;
  const eyeOpening = ((d(159, 145) + d(386, 374)) / 2 * sc);
  const faceW = d(234, 454) * sc;
  return {
    pd:pd.toFixed(1),
    pdLeft:lPd.toFixed(1),
    pdRight:rPd.toFixed(1),
    bridge:(innerCanthi * .62).toFixed(1),
    lensH:clamp(eyeOpening * 2.7 + 10, 34, 48).toFixed(1),
    faceW:faceW.toFixed(0),
    temple:clamp(faceW * .52 + 68, 130, 155).toFixed(0),
    sampleWeight:iris.isTilted ? 0.5 : 1,
    tiltRatio:iris.tiltRatio,
    irisDelta:iris.irisDelta,
    irisRange:`${(IRIS_MM - IRIS_SD * 2).toFixed(1)}-${(IRIS_MM + IRIS_SD * 2).toFixed(1)}`,
  };
}

export default function useFaceScan({
  videoRef,
  scanning,
  canvasRef,
  scaleMmPerPx=null,
  scaleSource="iris-fallback",
  needsCard=false,
  faceEnabled=true,
  debugScan=false,
  onCardLocked,
  onCardSkipped,
  onAutoStart,
  onScanAbort,
}) {
  const fmRef = useRef(null);
  const workCanvasRef = useRef(null);
  const iosSafariRef = useRef(isIOSSafari());
  const [mpReady, setMpReady] = useState(false);
  const [mpLoadError, setMpLoadError] = useState(false);
  const [cvReady, setCvReady] = useState(false);
  const samplesRef = useRef([]);
  const scaleHistoryRef = useRef([]);
  const validRef = useRef(0);
  const totalRef = useRef(0);
  const facePresentFramesRef = useRef(0);
  const poseValidFramesRef = useRef(0);
  const faceLostRef = useRef(0);
  const poseLostRef = useRef(0);
  const discardRef = useRef({});
  const cardStableRef = useRef(0);
  const lastCardRef = useRef(null);
  const cardLockedRef = useRef(false);
  const cardLoadFailedRef = useRef(false);
  const cardStartedRef = useRef(null);
  const loopRef = useRef(null);
  const procRef = useRef(false);
  const scanningRef = useRef(false);
  const doneRef = useRef(false);
  const scaleRef = useRef(scaleMmPerPx);
  const scaleSourceRef = useRef(scaleSource);
  const holdRef = useRef(0);
  const autoStarted = useRef(false);
  const fillRef = useRef(0);
  const abortingRef = useRef(false);
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
  const [cardStatus, setCardStatus] = useState({ label:"Loading card detector", stablePct:0, reason:"" });
  const [debugInfo, setDebugInfo] = useState(null);
  const [lightWarning, setLightWarning] = useState(null);
  const [pauseWarning, setPauseWarning] = useState(false);
  const [scanLost, setScanLost] = useState(false);
  const [scanError, setScanError] = useState(null);

  useEffect(() => { scanningRef.current = scanning; }, [scanning]);
  useEffect(() => { doneRef.current = done; }, [done]);
  useEffect(() => { scaleRef.current = scaleMmPerPx; scaleSourceRef.current = scaleSource; }, [scaleMmPerPx, scaleSource]);
  useEffect(() => { if (!needsCard) cardStartedRef.current = null; }, [needsCard]);

  const clearScanCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas) return;
    const W = video?.videoWidth || canvas.width || 640;
    const H = video?.videoHeight || canvas.height || 480;
    canvas.width = W;
    canvas.height = H;
    canvas.getContext("2d")?.clearRect(0, 0, W, H);
  }, [canvasRef, videoRef]);

  const markDiscard = useCallback((reason) => {
    const key = reason || "unknown";
    discardRef.current[key] = (discardRef.current[key] || 0) + 1;
  }, []);

  const logScanDebug = useCallback((label, extra={}) => {
    const payload = {
      validFrames:validRef.current,
      totalFrames:totalRef.current,
      faceFrames:facePresentFramesRef.current,
      poseFrames:poseValidFramesRef.current,
      samples:samplesRef.current.length,
      discarded:{ ...discardRef.current },
      scaleSource:scaleSourceRef.current,
      ...extra,
    };
    if (debugScan) console.debug(`[FitFrame scan] ${label}`, payload);
    if (label === "complete") console.info("[FitFrame scan] complete", payload);
  }, [debugScan]);

  const resetSampleState = useCallback(() => {
    samplesRef.current = [];
    scaleHistoryRef.current = [];
    validRef.current = 0;
    totalRef.current = 0;
    facePresentFramesRef.current = 0;
    poseValidFramesRef.current = 0;
    faceLostRef.current = 0;
    poseLostRef.current = 0;
    discardRef.current = {};
  }, []);

  const abortActiveScan = useCallback((reason="Lost your face - let's restart") => {
    if (abortingRef.current) return;
    abortingRef.current = true;
    clearScanCanvas();
    setSeqIdx(-1);
    setFill(0);
    fillRef.current = 0;
    setDone(false);
    setMeasurements(null);
    setQuality(null);
    setValidPct(0);
    setAutoStartPct(0);
    setPoseHint(null);
    setFacePresent(false);
    setLightWarning(null);
    setPauseWarning(false);
    setDebugInfo(null);
    setScanLost(true);
    setScanError(null);
    resetSampleState();
    holdRef.current = 0;
    autoStarted.current = false;
    onScanAbort?.(reason);
    requestAnimationFrame(() => { abortingRef.current = false; });
  }, [clearScanCanvas, onScanAbort, resetSampleState]);

  const processCardFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const W = video.videoWidth || 640;
    const H = video.videoHeight || 480;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    setFacePresent(false);
    setPoseHint(null);
    setAutoStartPct(0);

    if (!cardStartedRef.current) cardStartedRef.current = performance.now();
    const timedOut = performance.now() - cardStartedRef.current > CARD_FALLBACK_MS;
    if (cardLoadFailedRef.current || timedOut) {
      cardLockedRef.current = true;
      setCardStatus({ label:"Continuing without card", stablePct:0, reason:"" });
      onCardSkipped?.();
      return;
    }
    if (!cvReady) {
      setCardStatus({ label:"Loading card detector", stablePct:0, reason:"" });
      return;
    }

    const workCanvas = workCanvasRef.current || (workCanvasRef.current = document.createElement("canvas"));
    const detection = detectCardOutline(video, W, H, workCanvas);
    if (detection) {
      const similar = detectionSimilarity(detection, lastCardRef.current) < 26;
      const highConfidence = detection.confidence >= CARD_MIN_CONFIDENCE;
      const flatEnough = detection.angle <= CARD_MAX_ROTATION_DEG;
      cardStableRef.current = similar && highConfidence && flatEnough ? Math.min(CARD_STABLE_FRAMES, cardStableRef.current + 1) : 1;
      lastCardRef.current = detection;
      const stablePct = cardStableRef.current / CARD_STABLE_FRAMES;
      drawDetectedCard(ctx, detection, stablePct);
      const reason = !highConfidence ? "Both long sides visible, card facing the camera." : !flatEnough ? "Hold the card flatter." : "Hold still.";
      setCardStatus({ label:stablePct >= 1 ? "Scale locked" : "Card detected", stablePct, reason, confidence:detection.confidence });
      if (stablePct >= 1) {
        cardLockedRef.current = true;
        onCardLocked?.({
          source:"detected-card",
          mmPerPx:detection.mmPerPx,
          cardWidthMm:CREDIT_CARD_WIDTH_MM,
          cardHeightMm:CREDIT_CARD_HEIGHT_MM,
          cardWidthPx:Math.round(detection.width),
          cardHeightPx:Math.round(detection.height),
          confidence:Number(detection.confidence.toFixed(2)),
          corners:detection.quad.map(p => ({ x:Math.round(p.x), y:Math.round(p.y) })),
          capturedAt:new Date().toISOString(),
        });
      }
    } else {
      cardStableRef.current = 0;
      lastCardRef.current = null;
      setCardStatus({ label:"Position card", stablePct:0, reason:"Both long sides visible, card facing the camera." });
    }
  }, [canvasRef, cvReady, onCardLocked, onCardSkipped, videoRef]);

  const handleResults = useCallback((results) => {
    lastResultAtRef.current = performance.now();
    setScanError(null);
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const W = video.videoWidth || 640;
    const H = video.videoHeight || 480;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    if (doneRef.current || abortingRef.current) { clearScanCanvas(); return; }

    if (!results.multiFaceLandmarks?.length) {
      holdRef.current = 0;
      setFacePresent(false);
      setPoseHint(null);
      setLightWarning(null);
      setFaceSpan(0);
      if (!autoStarted.current) setAutoStartPct(0);
      if (scanningRef.current) {
        totalRef.current++;
        faceLostRef.current++;
        poseLostRef.current++;
        setPauseWarning(true);
        markDiscard("no-face");
        if (faceLostRef.current >= FACE_ABORT_FRAMES) abortActiveScan();
      }
      return;
    }

    setFacePresent(true);
    faceLostRef.current = 0;
    const lm = results.multiFaceLandmarks[0];
    const pts = lm.map(p => ({ x:p.x * W, y:p.y * H }));
    const d = (a, b) => Math.sqrt((pts[a].x - pts[b].x) ** 2 + (pts[a].y - pts[b].y) ** 2);
    const span = Math.abs(lm[454].x - lm[234].x);
    const pose = validatePose(lm);
    const faceCenterX = (lm[234].x + lm[454].x) / 2;
    const yawRatio = span > 0 ? Math.abs(lm[1].x - faceCenterX) / (span / 2) : 1;
    const yawOk = yawRatio < 0.15;
    const pdCorrection = 1 - yawRatio * 0.12;
    const iris = calcIrisMetrics(pts, d);
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = 40;
    sampleCanvas.height = 40;
    const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently:true });
    const sx = Math.max(0, Math.min(W - 1, Math.floor(pts[1].x) - 20));
    const sy = Math.max(0, Math.min(H - 1, Math.floor(pts[1].y) - 20));
    const sw = Math.min(40, W - sx);
    const sh = Math.min(40, H - sy);
    sampleCtx.clearRect(0, 0, 40, 40);
    sampleCtx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    const imageData = sampleCtx.getImageData(0, 0, sw, sh);
    const luma = imageData.data.reduce((sum, v, i) => i % 4 !== 3 ? sum + v : sum, 0) / (sw * sh * 3);
    const lightHint = luma < 40 ? "better lighting needed" : luma > 220 ? "move from direct light" : null;
    const yawHint = yawOk ? null : lm[1].x < faceCenterX ? "tilt right slightly" : "tilt left slightly";
    const tiltHint = iris.valid && iris.isTilted && !scanningRef.current ? "level your head" : null;
    const currentHint = lightHint || (!yawOk ? yawHint : pose.valid ? tiltHint : pose.reason);
    const frameValid = pose.valid && yawOk && !lightHint;

    setFaceSpan(span);
    setPoseHint(currentHint);
    setLightWarning(lightHint);
    setPauseWarning(false);
    setDebugInfo({
      lIrisPx:iris.lId ? Number(iris.lId.toFixed(1)) : null,
      rIrisPx:iris.rId ? Number(iris.rId.toFixed(1)) : null,
      scaleFactor:scaleRef.current || (iris.valid ? Number((IRIS_MM / iris.avgDiam).toFixed(4)) : null),
      rawPd:iris.valid ? Number((d(468, 473) * (scaleRef.current || IRIS_MM / iris.avgDiam)).toFixed(1)) : null,
      validFrames:validRef.current,
      totalFrames:totalRef.current,
      discarded:{ ...discardRef.current },
      scaleSource:scaleSourceRef.current,
      yawRatio:Number(yawRatio.toFixed(3)),
    });

    if (onAutoStart && !autoStarted.current && !scanningRef.current) {
      frameValid ? holdRef.current++ : (holdRef.current = Math.max(0, holdRef.current - 2));
      const pct = Math.min(holdRef.current / HOLD_FRAMES, 1);
      setAutoStartPct(pct);
      if (pct >= 1) { autoStarted.current = true; onAutoStart?.(); }
    }

    if (scanningRef.current) {
      totalRef.current++;
      facePresentFramesRef.current++;
      if (!frameValid) {
        poseLostRef.current++;
        markDiscard(lightHint ? "light" : !yawOk ? "yaw" : "pose");
        if (poseLostRef.current >= FACE_ABORT_FRAMES) abortActiveScan();
      } else {
        poseValidFramesRef.current++;
        poseLostRef.current = 0;
      }
    }

    if (scanningRef.current && iris.valid) {
      const ink = frameValid ? ACCENT : "rgba(255,255,255,.22)";
      [[pts[468], iris.lId], [pts[473], iris.rId]].forEach(([center, diam]) => {
        ctx.beginPath();
        ctx.arc(center.x, center.y, diam / 2, 0, Math.PI * 2);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(pts[468].x, pts[468].y);
      ctx.lineTo(pts[473].x, pts[473].y);
      ctx.strokeStyle = ink;
      ctx.lineWidth = .75;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (scanningRef.current) {
      if (!iris.valid) {
        markDiscard(iris.reason);
        return;
      }
      if (!frameValid) return;
      const m = calcFrameMeasurements(lm, W, H, scaleRef.current, scaleHistoryRef, pdCorrection);
      if (m) {
        samplesRef.current.push({ ...m, scaleSource:scaleSourceRef.current });
        validRef.current++;
      } else {
        markDiscard("measurement-null");
      }
      if (totalRef.current % 15 === 0) logScanDebug("sampling", { yawRatio:Number(yawRatio.toFixed(3)), tiltRatio:iris.tiltRatio ? Number(iris.tiltRatio.toFixed(3)) : null });
    }
  }, [abortActiveScan, canvasRef, clearScanCanvas, logScanDebug, markDiscard, onAutoStart, videoRef]);

  useEffect(() => {
    loadOpenCv().then(() => setCvReady(true)).catch(() => {
      cardLoadFailedRef.current = true;
      setCardStatus({ label:"Continuing without card", stablePct:0, reason:"" });
    });
  }, []);

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
          },
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
        if (attempt < delays.length) setTimeout(() => init(attempt + 1), delays[attempt]);
        else {
          console.error("MediaPipe:", e);
          setMpLoadError(true);
        }
      }
    }
    init();
    return () => { cancelled = true; };
  }, [handleResults]);

  useEffect(() => {
    const loop = async () => {
      const v = videoRef.current;
      if (doneRef.current || abortingRef.current) {
        clearScanCanvas();
      } else if (needsCard && v && v.readyState >= 2 && !cardLockedRef.current) {
        processCardFrame();
      } else if (faceEnabled && fmRef.current && v && v.readyState >= 2 && !procRef.current) {
        procRef.current = true;
        if (iosSafariRef.current) {
          let timer;
          try {
            await Promise.race([
              fmRef.current.send({ image:v }),
              new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Face scanner frame timed out.")), IOS_SAFARI_FRAME_TIMEOUT_MS); }),
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
          try { await fmRef.current.send({ image:v }); } catch { /* frame processing can skip while MediaPipe warms up */ }
        }
        procRef.current = false;
      }
      loopRef.current = requestAnimationFrame(loop);
    };
    loopRef.current = requestAnimationFrame(loop);
    return () => { if (loopRef.current) cancelAnimationFrame(loopRef.current); };
  }, [clearScanCanvas, faceEnabled, needsCard, processCardFrame, videoRef]);

  useEffect(() => {
    if (scanning && !done) {
      abortingRef.current = false;
      resetSampleState();
      setScanLost(false);
      setScanError(null);
      setPauseWarning(false);
      setSeqIdx(0);
    } else {
      clearScanCanvas();
    }
  }, [clearScanCanvas, done, resetSampleState, scanning]);

  useEffect(() => {
    if (seqIdx < 0 || seqIdx >= SCAN_SEQ.length) return;
    const step = SCAN_SEQ[seqIdx];
    const start = fillRef.current;
    const end = step.fill;
    const started = performance.now();
    let raf;
    const animate = now => {
      const t = Math.min((now - started) / step.holdMs, 1);
      const v = start + (end - start) * t;
      fillRef.current = v;
      setFill(v);
      if (t < 1) {
        raf = requestAnimationFrame(animate);
      } else if (seqIdx < SCAN_SEQ.length - 1) {
        setSeqIdx(i => i + 1);
      } else {
        setDone(true);
        clearScanCanvas();
        const samples = samplesRef.current;
        const vp = totalRef.current > 0 ? validRef.current / totalRef.current : 0;
        const facePct = totalRef.current > 0 ? facePresentFramesRef.current / totalRef.current : 0;
        const posePct = totalRef.current > 0 ? poseValidFramesRef.current / totalRef.current : 0;
        setValidPct(Math.round(vp * 100));
        if (samples.length < MIN_VALID_SAMPLES || facePct < FACE_PRESENT_MIN_RATIO || posePct < POSE_VALID_MIN_RATIO) {
          setQuality({ label:"Low", rescan:true, reason:"Not enough stable frames captured. Try again in good light while holding still." });
          setMeasurements(null);
          logScanDebug("complete", { sampleCount:samples.length, quality:"Low", facePct:Number(facePct.toFixed(2)), posePct:Number(posePct.toFixed(2)) });
          return;
        }
        const sorted = [...samples].sort((a, b) => parseFloat(a.pd) - parseFloat(b.pd));
        const trim = Math.floor(sorted.length * .15);
        const good = trim > 0 && sorted.length > trim * 2 + MIN_VALID_SAMPLES - 1 ? sorted.slice(trim, sorted.length - trim) : sorted;
        const weightedAvg = key => {
          const total = good.reduce((sum, m) => sum + parseFloat(m[key]) * (m.sampleWeight || 1), 0);
          const weights = good.reduce((sum, m) => sum + (m.sampleWeight || 1), 0);
          return total / weights;
        };
        const weightedStd = key => {
          const mean = weightedAvg(key);
          const weights = good.reduce((sum, m) => sum + (m.sampleWeight || 1), 0);
          const variance = good.reduce((sum, m) => sum + ((parseFloat(m[key]) - mean) ** 2) * (m.sampleWeight || 1), 0) / weights;
          return Math.sqrt(variance);
        };
        const pd = weightedAvg("pd");
        const bridge = weightedAvg("bridge");
        const pdLeft = weightedAvg("pdLeft");
        const pdRight = weightedAvg("pdRight");
        const monoSum = pdLeft + pdRight;
        const directPdSane = pd >= PD_ADULT_MIN && pd <= PD_ADULT_MAX;
        const monoSumSane = monoSum >= PD_ADULT_MIN && monoSum <= PD_ADULT_MAX;
        const finalPd = Math.abs(monoSum - pd) > 2 && monoSumSane ? monoSum : pd;
        const pdStd = weightedStd("pd");
        const bridgeStd = weightedStd("bridge");
        const hardOutOfRange = !directPdSane && !monoSumSane;
        const reviewRangeIssue = bridge < BRIDGE_MIN || bridge > BRIDGE_MAX || Math.abs(pdLeft - pdRight) > MONOCULAR_SYMMETRY;
        const stable = pdStd <= 2.0 && bridgeStd <= 1.5;
        setMeasurements({
          pd:finalPd.toFixed(1),
          pdLeft:pdLeft.toFixed(1),
          pdRight:pdRight.toFixed(1),
          bridge:bridge.toFixed(1),
          temple:weightedAvg("temple").toFixed(0),
          lensH:weightedAvg("lensH").toFixed(1),
          faceW:weightedAvg("faceW").toFixed(0),
          scaleSource:good[0]?.scaleSource || scaleSourceRef.current,
        });
        const nextQuality = hardOutOfRange
          ? { label:"Out of range", rescan:true, reason:"The scan landed outside the fitting range. Try again straight on in good light." }
          : !stable
            ? { label:"Unstable", rescan:true, reason:"Measurements varied during the scan. Try again while holding still." }
            : reviewRangeIssue
              ? { label:"Review", rescan:true, reason:"The scan caught some movement. A redo should improve accuracy." }
              : vp >= .6
                ? { label:"Clean scan", rescan:false, reason:"The scan had steady tracking and enough usable frames." }
                : { label:"Good scan", rescan:false, reason:"Usable scan with the best frames averaged." };
        setQuality(nextQuality);
        logScanDebug("complete", { finalPd:Number(finalPd.toFixed(1)), pdStd:Number(pdStd.toFixed(2)), bridgeStd:Number(bridgeStd.toFixed(2)), sampleCount:samples.length, facePct:Number(facePct.toFixed(2)), posePct:Number(posePct.toFixed(2)), quality:nextQuality.label });
      }
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [clearScanCanvas, logScanDebug, seqIdx]);

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
    setValidPct(0);
    setFaceSpan(0);
    setCardStatus({ label:cardLoadFailedRef.current ? "Continuing without card" : cvReady ? "Position card" : "Loading card detector", stablePct:0, reason:"" });
    setDebugInfo(null);
    setLightWarning(null);
    setPauseWarning(false);
    setScanLost(false);
    setScanError(null);
    resetSampleState();
    cardStableRef.current = 0;
    lastCardRef.current = null;
    cardLockedRef.current = false;
    cardStartedRef.current = null;
    holdRef.current = 0;
    autoStarted.current = false;
    abortingRef.current = false;
    clearScanCanvas();
  }, [clearScanCanvas, cvReady, resetSampleState]);

  return {
    seqIdx,
    fill,
    done,
    measurements,
    mpReady,
    mpLoadError,
    cvReady,
    autoStartPct,
    facePresent,
    faceSpan,
    poseHint,
    lightWarning,
    pauseWarning,
    scanLost,
    scanError,
    quality,
    validPct,
    cardStatus,
    debugInfo,
    reset,
  };
}
