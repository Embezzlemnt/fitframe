import { IRIS_MM, IRIS_SD, IRIS_MIN_PX, IRIS_MAX_PX, TILT_THRESHOLD, IRIS_MISMATCH_MAX, FACE_YAW_MAX, SCALE_HISTORY_FRAMES } from "./constants.js";

// ─── Pose validation ──────────────────────────────────────────────────────────
export function validatePose(lm) {
  const nx = lm[1].x, ny = lm[1].y;
  if (nx < 0.10 || nx > 0.90) return { valid:false, reason:"Center your face" };
  if (ny < 0.08 || ny > 0.92) return { valid:false, reason:"Center your face" };
  return { valid:true, reason:null };
}

export const clamp = (v,min,max) => Math.min(max,Math.max(min,v));
export const irisReferenceRange = () => [IRIS_MM - IRIS_SD * 2, IRIS_MM + IRIS_SD * 2];

export function median(arr) {
  const s = [...arr].filter(Number.isFinite).sort((a,b)=>a-b);
  if (!s.length) return null;
  const m = Math.floor(s.length/2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
}

export function distPt(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }

export function irisDiameter(center, edges, d) {
  const radii = edges.map(edge => d(center, edge)).filter(r => r >= 1);
  const med = median(radii);
  if (!med) return null;
  const clean = radii.filter(r => Math.abs(r - med) / med < 0.20);
  if (!clean.length) return null;
  return clean.reduce((a,b)=>a+b,0) / clean.length * 2;
}

export function calcIrisMetrics(pts, d) {
  const lId = irisDiameter(468, [469,470,471,472], d);
  const rId = irisDiameter(473, [474,475,476,477], d);
  if (!lId || !rId || lId < 2 || rId < 2) return {valid:false,lId:lId||0,rId:rId||0,reason:"iris-lost"};
  const avgDiam = (lId + rId) / 2;
  if (avgDiam < IRIS_MIN_PX) return {valid:false,lId,rId,avgDiam,reason:"too-far"};
  if (avgDiam > IRIS_MAX_PX) return {valid:false,lId,rId,avgDiam,reason:"too-close"};
  const irisDelta = Math.abs(lId - rId) / avgDiam;
  if (irisDelta > IRIS_MISMATCH_MAX) return {valid:false,lId,rId,avgDiam,irisDelta,reason:"iris-mismatch"};
  const faceH = distPt(pts[10], pts[152]);
  const tiltRatio = faceH ? Math.abs(pts[468].y - pts[473].y) / faceH : 0;
  return {
    valid:true,
    lId,
    rId,
    avgDiam,
    irisDelta,
    tiltRatio,
    isTilted:tiltRatio > TILT_THRESHOLD,
  };
}

export function calcYawRatio(pts, d) {
  const eyeDist = d(468,473);
  if (!eyeDist) return 0;
  const eyeMidX = (pts[468].x + pts[473].x) / 2;
  return Math.abs(pts[1].x - eyeMidX) / eyeDist;
}

export function calcEAR(d) {
  // eye-aspect-ratio: vertical lid gap over horizontal eye width, per eye.
  // left: lids 159/145 over corners 33/133 · right: lids 386/374 over corners 362/263
  const lw = d(33, 133), rw = d(362, 263);
  const left = lw ? d(159, 145) / lw : 0;
  const right = rw ? d(386, 374) / rw : 0;
  return { left, right, min: Math.min(left, right) };
}

export function redoReason(discards){
  const top=Object.entries(discards).sort((a,b)=>b[1]-a[1])[0]?.[0];
  switch(top){
    case "blink": return "we caught too many blinks — keep your eyes relaxed and open, then go again.";
    case "no-face": return "we lost your face — keep it inside the oval this time.";
    case "pose": case "yaw": return "too much head movement — face the camera straight on and hold steady.";
    case "too-far": return "you're a bit far away — bring the phone to about arm's length.";
    case "too-close": return "you're too close — ease back to about arm's length.";
    case "iris-lost": case "iris-mismatch": return "we lost track of your eyes — try facing a light so your eyes are clearly lit.";
    case "scale-drift": return "your distance to the camera shifted mid-scan — pick a spot at arm's length and hold it.";
    default: return "the scan couldn't get enough clean frames — find even light, hold steady, and go again.";
  }
}

export function calcMeasurements(lm, W, H, calibratedScale=null, scaleHistoryRef=null, precomputedIris=null) {
  const pts = lm.map(p => ({ x:p.x*W, y:p.y*H }));
  const d   = (a,b) => Math.sqrt((pts[a].x-pts[b].x)**2+(pts[a].y-pts[b].y)**2);
  // The caller (handleResults) already computed iris metrics for this frame; reuse them.
  const iris = precomputedIris || calcIrisMetrics(pts,d);
  if (!iris.valid) return null;
  const irisScale = IRIS_MM / iris.avgDiam;
  if (scaleHistoryRef) {
    scaleHistoryRef.current.push(irisScale);
    if (scaleHistoryRef.current.length > SCALE_HISTORY_FRAMES) scaleHistoryRef.current.shift();
  }
  const stableIrisScale = median(scaleHistoryRef?.current || [irisScale]) || irisScale;
  const sc = calibratedScale || stableIrisScale;
  if (!sc) return null;
  const yawRatio = calcYawRatio(pts,d);
  if (yawRatio >= FACE_YAW_MAX) return null;
  const yawCorrection = Math.max(0.94, 1 - yawRatio * 0.12);
  const pd = d(468,473)*sc*yawCorrection;
  const lPd = d(468,6)*sc;
  const rPd = d(473,6)*sc;
  const innerCanthi = d(133,362)*sc;
  const eyeOpening = ((d(159,145)+d(386,374))/2*sc);
  const faceW = d(234,454)*sc;
  const [irisMin, irisMax] = irisReferenceRange();
  return {
    pd:      pd.toFixed(1), pdLeft:lPd.toFixed(1), pdRight:rPd.toFixed(1),
    bridge:  (innerCanthi*.62).toFixed(1),
    lensH:   clamp(eyeOpening*2.7+10,34,48).toFixed(1),
    faceW:   faceW.toFixed(0),
    temple:  clamp(faceW*.52+68,130,155).toFixed(0),
    sampleWeight: iris.isTilted ? 0.5 : 1,
    tiltRatio: iris.tiltRatio,
    yawRatio,
    irisDelta: iris.irisDelta,
    irisRange: `${irisMin.toFixed(1)}-${irisMax.toFixed(1)}`,
  };
}
