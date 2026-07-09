# Scan Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild FitFrame's step-1 face scan as an explicit phase machine (consent → positioning → card-lock → scanning → results) with card blur masking, blink-aware gating, adaptive scan duration, adaptive eye ovals, and a curated landmark constellation — extracted into a `src/scan/` module.

**Architecture:** Pure extraction first (zero behavior change, verified against current behavior), then features land one commit at a time. FramesSite.jsx keeps the page shell and steps 0/2/3/4; `<ScanStage/>` owns step 1. The scan engine hook (`useFaceScan`) stays callback-driven; ScanStage owns the phase state machine.

**Tech Stack:** React 19 (hooks only, no new deps), Vite 8, MediaPipe Face Mesh pinned `0.4.1633559619` via CDN, opencv.js 4.9.0 via CDN, Cloudflare Worker backend (untouched).

**Spec:** `docs/superpowers/specs/2026-07-09-scan-flow-redesign-design.md`

## Global Constraints

- No new npm dependencies. No test framework — verification is `npm run lint` + `npm run build` + preview walkthrough.
- MediaPipe version stays pinned: `0.4.1633559619`. OpenCV URL stays `https://docs.opencv.org/4.9.0/opencv.js`.
- All overlay drawing stays in the existing color family: `--accent` #4caf7d, `--accent2` #73d7a0, amber #e5a64a. Geist Mono for metric labels.
- Copy is lowercase-styled like the rest of the site ("hold your card flat under your chin.").
- `prefers-reduced-motion: reduce` must disable shimmer/pulse animations (static rendering, feature still works).
- **HARD GATE: never run `npm run deploy` or `wrangler deploy`. The final task is a local preview demo for Lorenzo; production only changes after his explicit approval.**
- Work on a feature branch `scan-flow-redesign` off `main` (create in Task 1). Commit after every task with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- The existing 4-space/compact code style of FramesSite.jsx (2-space indent, dense expressions, minimal comments) carries into the new files.
- localStorage session schema: `calibration` and `confirmedMeas` keep their current shapes — step 2/3 and the worker payload read them.

## File Structure (end state)

```
src/
  FramesSite.jsx        // page shell, steps 0/2/3/4, css string, mounts <ScanStage/>
  scan/
    constants.js        // thresholds, timings, landmark index sets
    faceMetrics.js      // clamp/median, pose, iris metrics, EAR, yaw, measurements, redoReason
    cardDetection.js    // loadOpenCv, detectCardOutline, drawDetectedCard, drawCardBlurMask
    overlays.js         // eye ovals, constellation
    useCamera.js        // camera lifecycle hook (moved as-is)
    useFaceScan.js      // scan engine hook
    ScanStage.jsx       // step-1 UI: consent, positioning, card-lock, scanning, redo
```

---

### Task 1: Extract the scan engine into src/scan/ (pure move, zero behavior change)

**Files:**
- Create: `src/scan/constants.js`, `src/scan/faceMetrics.js`, `src/scan/cardDetection.js`, `src/scan/useCamera.js`, `src/scan/useFaceScan.js`
- Modify: `src/FramesSite.jsx` (delete moved code, add imports)

**Interfaces (Produces):**
- `constants.js` exports (values copied verbatim from FramesSite.jsx:39-64, 291-299): `IRIS_MM, IRIS_SD, IRIS_MIN_PX, IRIS_MAX_PX, PD_ADULT_MIN, PD_ADULT_MAX, BRIDGE_MIN, BRIDGE_MAX, MONOCULAR_SYMMETRY, TILT_THRESHOLD, IRIS_MISMATCH_MAX, MIN_VALID_SAMPLES, FACE_ABORT_FRAMES, FACE_YAW_MAX, SCALE_HISTORY_FRAMES, CREDIT_CARD_WIDTH_MM, CREDIT_CARD_HEIGHT_MM, CARD_ASPECT, CARD_STABLE_FRAMES, CARD_MAX_ROTATION_DEG, CARD_MIN_CONFIDENCE, CARD_FALLBACK_MS, OPENCV_URL, MEDIAPIPE_FACE_MESH_VERSION, SCAN_SEQ, PRE_SCAN_SETTLE_MS, SCAN_DURATION_SECONDS_PLACEHOLDER`
- `faceMetrics.js` exports: `clamp(v,min,max)`, `median(arr)`, `irisReferenceRange()`, `validatePose(lm)`, `irisDiameter(center,edges,d)`, `calcIrisMetrics(pts,d)`, `calcYawRatio(pts,d)`, `calcMeasurements(lm,W,H,calibratedScale,scaleHistoryRef,precomputedIris)`, `distPt(a,b)` — bodies moved verbatim from FramesSite.jsx:30-36, 74-82, 100, 203-277.
- `cardDetection.js` exports: `loadScript(src)`, `loadOpenCv()`, `detectCardOutline(video,W,H,workCanvas)`, `drawDetectedCard(ctx,detection,stablePct)`, `detectionSimilarity(a,b)` — bodies moved verbatim from FramesSite.jsx:18-28, 84-98, 101-201 (`orderQuad`, `quadAngleDeg` stay module-private).
- `useCamera.js` exports default `useCamera()` returning `{videoRef, ready, requesting, camErr, start, stop}` — moved verbatim from FramesSite.jsx:553-612, along with its private helper `classifyCamError` (FramesSite.jsx:539-551).
- `useFaceScan.js` exports default `useFaceScan({videoRef, scanning, canvasRef, scaleMmPerPx, scaleSource, needsCard, faceEnabled, engineActive, debugScan, onCardLocked, onCardSkipped, onAutoStart, onScanAbort})` returning `{seqIdx, fill, done, measurements, mpReady, cvReady, autoStartPct, facePresent, poseHint, quality, validPct, cardStatus, debugInfo, reset}` — moved verbatim from FramesSite.jsx:614-1045.

- [ ] **Step 1: Create branch**

```bash
cd /home/orchestr/fitframe && git checkout -b scan-flow-redesign main
```

- [ ] **Step 2: Create the five modules by moving code**

Move the exact line ranges listed in Interfaces above. Rules: bodies verbatim (no reformatting, no renaming); each new file imports what it needs from its siblings (`faceMetrics.js` imports constants from `./constants.js`; `cardDetection.js` imports `clamp, distPt` from `./faceMetrics.js` and card constants from `./constants.js`; `useFaceScan.js` imports from all three plus `MEDIAPIPE_FACE_MESH_VERSION`). `useFaceScan.js` needs `import { useState, useRef, useEffect, useCallback } from "react";`.

- [ ] **Step 3: Rewire FramesSite.jsx**

Delete the moved ranges and add at the top:

```js
import useCamera from "./scan/useCamera.js";
import useFaceScan from "./scan/useFaceScan.js";
import { clamp } from "./scan/faceMetrics.js";
import { PRE_SCAN_SETTLE_MS, SCAN_DURATION_SECONDS_PLACEHOLDER } from "./scan/constants.js";
```

`clamp` is still used by `FaceGuide` (line 1050) and `ScanCounter`; `FITFRAME_FAQ`, `saveSession/loadSession/clearSession`, `genOrderId`, `isValidEmail` stay in FramesSite.jsx.

- [ ] **Step 4: Verify**

```bash
cd /home/orchestr/fitframe && npm run lint && npm run build
```
Expected: both pass with zero new warnings. Then `git diff --stat` — FramesSite.jsx should shrink by roughly the sum of moved lines; no logic diffs inside moved bodies (`git diff` on the new files vs. the old ranges should show only import/export lines added).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: extract scan engine into src/scan/ (pure move)"
```

---

### Task 2: Extract ScanStage.jsx (pure move of step-1 UI and scan-flow state)

**Files:**
- Create: `src/scan/ScanStage.jsx`
- Modify: `src/FramesSite.jsx`

**Interfaces:**
- Produces: `ScanStage({calibration, setCalibration, confirmedMeas, setConfirmedMeas, currentMeasAccepted, onAdvance, onScanComplete, debugEnabled, resetToken})` — default export.
  - `onAdvance()` — FramesSite sets `step=2`.
  - `onScanComplete()` — FramesSite's existing `postScanComplete` (POST /api/scan-complete).
  - `resetToken` — a number; when it changes, ScanStage resets its internal scan state (replaces the direct `scan.reset()` calls in `startFreshScan`/`restartFlow`).
- Consumes: everything from Task 1.

- [ ] **Step 1: Move state and UI**

Move into ScanStage.jsx from FramesSite.jsx:
- State: `scanning, scanPrepDismissed, cameraIntro, scanSettling, scanRestartCopy, scanProcessing` + refs `processingTimerRef, settleTimerRef, scanCompletePostedRef→(drop; dedupe stays in FramesSite's postScanComplete)` + `canvasRef`, the `useCamera()` call, the `useFaceScan()` call and its callbacks (`startSettledScan, handleCardLocked, handleCardSkipped, handleScanAbort`), the camera lifecycle effects (FramesSite.jsx:1400-1408, 1454-1463), the auto-advance effect (1475-1491), `acceptMeasurements`, `rescan`, `beginScanSetup`, the derived copy block (1631-1674), and the whole `step===1` JSX (1737-1849) as ScanStage's return value.
- `FaceGuide`, `ScanSetupDiagram`, `Padlock` components move into ScanStage.jsx (they are scan-only).
- `calibration`/`confirmedMeas` stay owned by FramesSite (persistence + steps 2/3 read them); ScanStage receives the setters.
- The auto-advance effect's `setStep(2)` becomes `onAdvance()`; `postScanComplete()` becomes `onScanComplete()`.
- `startFreshScan`/`restartFlow`/step-2's rescan path in FramesSite: replace `scan.reset()` + scan-state clearing with `setResetToken(t=>t+1)`; ScanStage has `useEffect(()=>{ if(resetToken>0) internalReset(); },[resetToken])` where `internalReset` performs the old `rescan()` body.
- FramesSite renders: `{step===1&&<ScanStage calibration={calibration} setCalibration={setCalibration} confirmedMeas={confirmedMeas} setConfirmedMeas={setConfirmedMeas} onAdvance={()=>setStep(2)} onScanComplete={postScanComplete} debugEnabled={debugEnabled} resetToken={resetToken}/>}`
- Step-2's "rescan" button (FramesSite.jsx:1852+ block): it currently calls `rescan()` then relies on step already being 1 — after the move it must `setConfirmedMeas(null); setCalibration(null); setResetToken(t=>t+1); setStep(1);`.
- The css string stays in FramesSite.jsx (global `<style>` tag styles ScanStage's classes).

- [ ] **Step 2: Verify — lint, build, behavioral smoke**

```bash
npm run lint && npm run build
```
Then create `.claude/launch.json` if missing:
```json
{ "version": "0.0.1", "configurations": [ { "name": "fitframe-dev", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 5173 } ] }
```
Start the preview server, walk: hero → "scan your face" → prep card renders → "I'm ready" opens camera prompt. Confirm no console errors. (Camera hardware may be absent in CI-like environments — the prep card render + zero console errors is the smoke bar.)

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor: extract ScanStage component (pure move)"
```

---

### Task 3: Consent phase — explicit card / iris choice

**Files:**
- Modify: `src/scan/ScanStage.jsx`, `src/scan/constants.js`, `src/FramesSite.jsx` (css string only)

**Interfaces:**
- Produces: ScanStage state `scanMode` (`"card" | "iris" | null`, null = not chosen) and `phase` derived flow used by Tasks 4/7. `beginScanSetup(mode)` replaces the old zero-arg version.
- Consumes: Task 2's ScanStage.

- [ ] **Step 1: Replace the prep card with the consent card**

In ScanStage.jsx, replace the `showScanPrep` block (the old `pre-scan-card`) with:

```jsx
{showScanPrep&&(
  <div className="cam-placeholder pre-scan-card">
    <div className="pre-scan-line">this scan takes about {SCAN_DURATION_SECONDS_PLACEHOLDER} seconds and runs entirely in your browser.</div>
    <ScanSetupDiagram/>
    <div className="pre-scan-support">a credit or ID card is a fixed, known size — 85.6mm exactly. holding one under your chin anchors your measurements to the real world.</div>
    <div className="pre-scan-support">no rush — this screen waits while you grab one.</div>
    <div className="consent-choices">
      <button className="btn btn-primary consent-btn" onClick={()=>beginScanSetup("card")}>
        <span>i have a card</span><span className="consent-sub">most accurate</span>
      </button>
      <button className="btn btn-ghost consent-btn" onClick={()=>beginScanSetup("iris")}>
        <span>use iris only</span><span className="consent-sub">still good — measured from your eye</span>
      </button>
    </div>
    <div className="setup-list">
      <div>arm's length from your phone</div>
      <div>good overhead light, face it directly</div>
    </div>
    <div className="privacy-inline"><Padlock/><span>everything runs on this device. no photos or video are ever transmitted or stored — only your final millimeter numbers leave. your card is never read, only measured, and we blur it on screen automatically.</span></div>
  </div>
)}
```

`beginScanSetup(mode)`:
```js
function beginScanSetup(mode){
  setScanMode(mode);
  setScanRestartCopy("");
  setScanPrepDismissed(true);
  setCameraIntro(true);
  startCamera();
}
```

- [ ] **Step 2: Add css (FramesSite.jsx css string, next to `.pre-scan-card` rules)**

```css
.consent-choices{display:grid;gap:9px;width:100%;margin-top:2px;}
.consent-btn{display:flex;flex-direction:column;align-items:center;gap:2px;width:100%;padding:13px 16px;}
.consent-sub{font-size:11px;font-weight:300;opacity:.72;letter-spacing:.01em;}
```

- [ ] **Step 3: Wire scanMode into the engine**

`useFaceScan` call: `needsCard` becomes `scanMode==="card"&&camReady&&!cameraIntro&&scanning` for now (Task 4 replaces this with the dedicated phase). Iris mode: on scan start, set calibration immediately via the existing `handleCardSkipped` shape (`{source:"iris-fallback", skippedCard:true, timestamp}`) so the scale strip reads iris from the start.

- [ ] **Step 4: Verify + commit**

```bash
npm run lint && npm run build
```
Preview: consent screen shows two choices + privacy block; both paths reach the camera. Commit:
```bash
git add -A && git commit -m "feat: consent phase with explicit card / iris-only choice and full privacy disclosure"
```

---

### Task 4: Dedicated card-lock phase (no silent fallback)

**Files:**
- Modify: `src/scan/useFaceScan.js`, `src/scan/ScanStage.jsx`, `src/scan/constants.js`

**Interfaces:**
- Produces (useFaceScan API change):
  - New props: `cardLockActive` (bool — run card detection with overlay each frame), `onCardTimeout()` (fired once after `CARD_LOCK_TIMEOUT_MS` without a lock). `needsCard` and `onCardSkipped` props are **removed**, as is the `CARD_FALLBACK_MS` silent-skip branch inside `processCardFrame`.
  - New returned method: `retryCardLock()` — resets `cardStartedRef, cardStableRef, lastCardRef, cardLockedRef` and the timeout-fired flag.
  - `constants.js`: add `export const CARD_LOCK_TIMEOUT_MS = 20000;` and delete `CARD_FALLBACK_MS`.
- Produces (ScanStage): phase machine `phase ∈ {consent, positioning, cardlock, settling, scanning, processing, redo}` stored as state; Tasks 5–8 read it.
- Consumes: Task 3's `scanMode`.

- [ ] **Step 1: Rework processCardFrame in useFaceScan.js**

Change signature to `processCardFrame(ctx)` — it no longer clears the canvas or owns it; `handleResults` passes its live ctx so face overlays and card overlays coexist:

```js
const cardTimeoutFiredRef = useRef(false);
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
    if (ctx) drawDetectedCard(ctx,detection,stablePct);
    const reason=!highConfidence?"both long sides visible, card facing the camera.":!flatEnough?"hold the card flatter.":"";
    setCardStatus({label:stablePct>=1?"scale — card reference":"scale — iris reference",stablePct,reason,confidence:detection.confidence});
    if (stablePct>=1&&!cardLockedRef.current){
      cardLockedRef.current=true;
      scaleRef.current=detection.mmPerPx;
      scaleSourceRef.current="credit-card";
      setCardStatus({label:"scale — card reference",stablePct:1,reason:"",confidence:detection.confidence});
      onCardLocked?.({ /* same payload as before, unchanged */ });
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
```

In `handleResults`, after the face-present branch begins (past the early no-face return — keep card processing even without a face by moving this ABOVE the no-face early-return):

```js
const cardLockActiveNow=cardLockActiveRef.current;   // routed via ref like scanningRef
if (cardLockActiveNow&&!cardLockedRef.current) processCardFrame(ctx);
```

Also route `cardLockActive` through a ref (`useEffect(()=>{cardLockActiveRef.current=cardLockActive;},[cardLockActive])`), delete the `needsCard` prop, the old `processCardFrame(false)` call inside the scanning branch, and the `onCardSkipped` invocation. Add `retryCardLock` to the hook's return object. The OpenCV loader effect now keys on `engineActive&&cardLockPossible` — pass a new prop `wantsCard` (bool, `scanMode==="card"`) so iris-only users never download the ~10MB opencv.js.

- [ ] **Step 2: ScanStage phase machine**

Replace the boolean spaghetti with a single `phase` state (`useState("consent")`). Transitions:

```
consent --beginScanSetup(mode)--> positioning
positioning --scan.autoStartPct>=1 (onAutoStart cb)--> scanMode==="card" ? cardlock : settling
positioning --manual "start scan" btn--> same as above
cardlock --onCardLocked--> settling            (after a 900ms "scale locked." beat)
cardlock --onCardTimeout--> cardchoice overlay (stay in cardlock, show choice)
  choice "retry card" --> scan.retryCardLock() (stay in cardlock)
  choice "continue with iris" --> setScanMode("iris"); setCalibration({source:"iris-fallback",skippedCard:true,timestamp:new Date().toISOString()}); --> settling
settling --PRE_SCAN_SETTLE_MS timer--> scanning (setScanning(true))
scanning --scan.done--> processing (existing auto-advance effect)
scanning --onScanAbort--> positioning (with scanRestartCopy message)
redo: Task 7
```

Derived props: `cardLockActive={phase==="cardlock"}`, `scanning={phase==="scanning"}`, `wantsCard={scanMode==="card"}`.

Card-lock UI inside `cam-inner` (replaces `face-intro`/`settle-intro` during that phase):

```jsx
{phase==="cardlock"&&!cardChoice&&(
  <div className="settle-intro">
    <div className="settle-intro-main">{scan.cardStatus.stablePct>=1?"scale locked.":"show your card"}</div>
    {scan.cardStatus.stablePct<1&&<div className="face-intro-sub">hold it flat under your chin, facing the camera{scan.cardStatus.reason?` — ${scan.cardStatus.reason}`:""}</div>}
  </div>
)}
{phase==="cardlock"&&cardChoice&&(
  <div className="face-intro" style={{pointerEvents:"auto",background:"rgba(0,0,0,.55)"}}>
    <div className="face-intro-main">having trouble?</div>
    <div className="face-intro-sub">we couldn't get a clean read on the card.</div>
    <div className="btn-row" style={{marginTop:14}}>
      <button className="btn btn-primary" onClick={()=>{setCardChoice(false);scan.retryCardLock();}}>retry card</button>
      <button className="btn btn-ghost" onClick={continueWithIris}>continue with iris</button>
    </div>
  </div>
)}
```

`onCardTimeout` handler sets `setCardChoice(true)`. `onCardLocked` handler: existing `setCalibration({...})` plus `setTimeout(()=>advanceToSettling(),900)` for the lock beat.

- [ ] **Step 3: Verify + commit**

```bash
npm run lint && npm run build
```
Preview walkthrough: card path shows card-lock phase → (with a real card or 20s wait) lock beat or explicit retry/iris choice; iris path skips card-lock entirely; network tab confirms opencv.js is NOT fetched on the iris path. Commit:

```bash
git add -A && git commit -m "feat: dedicated card-lock phase with explicit retry/iris choice — no silent fallback"
```

---

### Task 5: Card blur mask

**Files:**
- Modify: `src/scan/cardDetection.js`, `src/scan/useFaceScan.js`

**Interfaces:**
- Produces: `drawCardBlurMask(ctx, video, detection)` exported from cardDetection.js.
- Consumes: Task 4's `processCardFrame(ctx)`.

- [ ] **Step 1: Implement in cardDetection.js**

```js
let blurCanvas;
export function drawCardBlurMask(ctx,video,detection){
  const {quad,center}=detection;
  const inflated=quad.map(p=>({x:center.x+(p.x-center.x)*1.08,y:center.y+(p.y-center.y)*1.08}));
  const xs=inflated.map(p=>p.x),ys=inflated.map(p=>p.y);
  const x0=Math.max(0,Math.min(...xs)),y0=Math.max(0,Math.min(...ys));
  const w=Math.min(ctx.canvas.width,Math.max(...xs))-x0,h=Math.min(ctx.canvas.height,Math.max(...ys))-y0;
  if (w<8||h<8) return;
  blurCanvas=blurCanvas||document.createElement("canvas");
  const bw=Math.max(2,Math.round(w/14)),bh=Math.max(2,Math.round(h/14));
  blurCanvas.width=bw; blurCanvas.height=bh;
  blurCanvas.getContext("2d").drawImage(video,x0,y0,w,h,0,0,bw,bh);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(inflated[0].x,inflated[0].y);
  inflated.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
  ctx.closePath();
  ctx.clip();
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(blurCanvas,0,0,bw,bh,x0,y0,w,h);
  ctx.restore();
}
```

(Both the `<video>` and overlay `<canvas>` are mirrored by the same `scaleX(-1)` CSS transform, so raw pixel coordinates line up — no flip math needed. The detector reads the raw video, so accuracy is untouched.)

- [ ] **Step 2: Call it in processCardFrame**

In the `if (detection)` branch, immediately BEFORE `drawDetectedCard`:
```js
if (ctx){ drawCardBlurMask(ctx,videoRef.current,detection); drawDetectedCard(ctx,detection,stablePct); }
```
Every candidate quad gets blurred, pre-lock included.

- [ ] **Step 3: Verify + commit**

Preview with a real card (or card-sized object with printed text): the card region renders pixelated the moment the outline appears; text is unreadable; outline + "CARD %" label draw on top; lock still occurs. `npm run lint && npm run build`. Commit:
```bash
git add -A && git commit -m "feat: pixelated privacy mask over the detected card"
```

---

### Task 6: Blink detection (EAR gating)

**Files:**
- Modify: `src/scan/faceMetrics.js`, `src/scan/constants.js`, `src/scan/useFaceScan.js`

**Interfaces:**
- Produces: `calcEAR(d)` in faceMetrics.js returning `{left,right,min}`; `EAR_BLINK_MIN = 0.16` in constants.js; discard reason `"blink"`.
- Consumes: Task 1's `d(a,b)` closure inside `handleResults`.

- [ ] **Step 1: Implement calcEAR**

```js
// eye-aspect-ratio: vertical lid gap over horizontal eye width, per eye.
// left: lids 159/145 over corners 33/133 · right: lids 386/374 over corners 362/263
export function calcEAR(d){
  const lw=d(33,133), rw=d(362,263);
  const left=lw?d(159,145)/lw:0;
  const right=rw?d(386,374)/rw:0;
  return {left,right,min:Math.min(left,right)};
}
```

- [ ] **Step 2: Gate sampling in handleResults**

In the scanning branch of `handleResults`, compute `const ear=calcEAR(d);` next to the iris metrics, and change the sampling block to:

```js
if (!iris.valid){
  markDiscard(iris.reason);
} else if (ear.min<EAR_BLINK_MIN){
  markDiscard("blink");
} else {
  const m=calcMeasurements(lm,W,H,scaleRef.current,scaleHistoryRef,iris);
  ...
}
```
Add `earMin:Number(ear.min.toFixed(3))` to `setDebugInfo` and a `EAR: {scan.debugInfo?.earMin ?? "-"}` line to the debug overlay in ScanStage (visible with `?debug=1`).

- [ ] **Step 3: Verify + commit**

Preview with `?debug=1`: blink deliberately during a scan → `blink:N` appears in the Discard line and EAR dips below 0.16 during blinks while sitting ~0.25+ open. `npm run lint && npm run build`. Commit:
```bash
git add -A && git commit -m "feat: EAR blink detection — blinks are discarded, never measured"
```

---

### Task 7: Sample-driven progress, adaptive duration, re-do prompts

**Files:**
- Modify: `src/scan/useFaceScan.js`, `src/scan/constants.js`, `src/scan/faceMetrics.js`, `src/scan/ScanStage.jsx`

**Interfaces:**
- Produces:
  - constants: `SCAN_BASE_MS=12000, SCAN_MAX_MS=18000, TARGET_VALID_SAMPLES=150, REDO_MIN_SAMPLES=40`. `SCAN_SEQ` and `seqIdx` are deleted from the codebase.
  - faceMetrics: `redoReason(discards)` → plain-language string from the dominant discard reason.
  - useFaceScan: `fill` now = `min(validSamples/TARGET_VALID_SAMPLES,1)` (monotonic); scan completes when `(elapsed>=SCAN_BASE_MS && valid>=TARGET_VALID_SAMPLES) || elapsed>=SCAN_MAX_MS`; a quality of `{label:"let's try that again", rescan:true, reason:redoReason(...)}` when `valid<REDO_MIN_SAMPLES` at the cap. Hook return drops `seqIdx`.
- Consumes: Task 6's discard reasons.

- [ ] **Step 1: redoReason in faceMetrics.js**

```js
export function redoReason(discards){
  const top=Object.entries(discards).sort((a,b)=>b[1]-a[1])[0]?.[0];
  switch(top){
    case "blink": return "we caught too many blinks — keep your eyes relaxed and open, then go again.";
    case "no-face": return "we lost your face — keep it inside the oval this time.";
    case "pose": case "yaw": return "too much head movement — face the camera straight on and hold steady.";
    case "too-far": return "you're a bit far away — bring the phone to about arm's length.";
    case "too-close": return "you're too close — ease back to about arm's length.";
    case "iris-lost": case "iris-mismatch": return "we lost track of your eyes — try facing a light so your eyes are clearly lit.";
    default: return "the scan couldn't get enough clean frames — find even light, hold steady, and go again.";
  }
}
```

- [ ] **Step 2: Replace the SCAN_SEQ animation with sample-driven completion**

Delete the `seqIdx` state, the `SCAN_SEQ` effect (old lines 948-1032) and `setSeqIdx` calls. Add `const scanStartRef=useRef(null);` — set to `performance.now()` in the scanning-start effect (which currently sets `setSeqIdx(0)`). Extract the entire completion block (the `else` branch computing trimmed weighted averages and quality, old lines 958-1027) into `const finishScan=useCallback(()=>{...},[...])` — body unchanged except the redo path:

```js
if (s.length<REDO_MIN_SAMPLES){
  setQuality({label:"let's try that again",rescan:true,reason:redoReason(discardRef.current)});
  setMeasurements(null);
  logScanDebug("complete",{sampleCount:s.length,quality:"redo",discarded:{...discardRef.current}});
}
```
(the old `MIN_VALID_SAMPLES` small-sample "Double-check these" branch remains for the 40..149-samples-at-cap case).

At the end of the scanning branch in `handleResults` (runs every frame, including no-face frames — put it in both paths):

```js
const elapsed=performance.now()-(scanStartRef.current||performance.now());
const nextFill=Math.min(validRef.current/TARGET_VALID_SAMPLES,1);
if (nextFill>fillRef.current){ fillRef.current=nextFill; setFill(nextFill); }
if ((elapsed>=SCAN_BASE_MS&&validRef.current>=TARGET_VALID_SAMPLES)||elapsed>=SCAN_MAX_MS){
  setFill(1); fillRef.current=1;
  setDone(true);
  clearScanCanvas();
  finishScan();
}
```

- [ ] **Step 3: Re-do UI in ScanStage**

The existing `scan.done && quality.rescan` block already renders a retry card — update it:

```jsx
{scan.done&&!scanProcessing&&scan.quality?.rescan&&(
  <div className="cam-placeholder" style={{marginTop:0}}>
    <div className="cam-label">{scan.quality.label}</div>
    <div className="cam-sub">{scan.quality.reason}</div>
    <button className="btn btn-primary" style={{marginTop:4}} onClick={redoScan}>scan again →</button>
  </div>
)}
```
`redoScan` = existing `rescan()` but WITHOUT `stopCamera()` (camera stays warm) and returning `phase` to `"positioning"`; scale calibration from a locked card is kept (`setCalibration` untouched) so a card user doesn't redo the card phase.

Note: the completion effect that releases the camera (`if(scan.done) stopCamera()`) must skip redo-grade scans: `if (scan.done&&!scan.quality?.rescan){ setScanning(false); stopCamera(); }`.

- [ ] **Step 4: Verify + commit**

Preview with `?debug=1`: a clean scan finishes at ~12s with the ring filling smoothly; deliberately turning your head mid-scan visibly stalls the ring and stretches the scan past 12s (watch elapsed in console `[FitFrame scan] sampling` logs); covering the camera for the whole scan produces the re-do card with the no-face message and "scan again" keeps the camera on. `npm run lint && npm run build`. Commit:
```bash
git add -A && git commit -m "feat: honest sample-driven progress with adaptive duration and reasoned re-do prompts"
```

---

### Task 8: Eye ovals + landmark constellation

**Files:**
- Create: `src/scan/overlays.js`
- Modify: `src/scan/constants.js`, `src/scan/useFaceScan.js`

**Interfaces:**
- Produces: `drawEyeOval(ctx,pts,indices)`, `drawConstellation(ctx,pts,tMs,alpha,reduceMotion)` from overlays.js; index arrays in constants.js.
- Consumes: `pts` array from `handleResults`.

- [ ] **Step 1: Landmark index sets in constants.js**

```js
// visual-only landmark sets (measurement never reads these)
export const LEFT_EYE_CONTOUR =[33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
export const RIGHT_EYE_CONTOUR=[263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466];
export const CONSTELLATION_INDICES=[
  // silhouette / jawline
  10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,
  // brows
  70,63,105,66,107,55,65,52,53,46, 300,293,334,296,336,285,295,282,283,276,
  // nose bridge + base
  168,6,197,195,5,4,1,19,94,2,98,327,
  // outer lips
  61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185,
  // cheeks
  50,101,118,205,280,330,347,425,
];
```

- [ ] **Step 2: overlays.js**

```js
import { CONSTELLATION_INDICES } from "./constants.js";

const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});

export function drawEyeOval(ctx,pts,indices){
  const ring=indices.map(i=>pts[i]);
  if (ring.some(p=>!p)) return;
  ctx.beginPath();
  const start=mid(ring[ring.length-1],ring[0]);
  ctx.moveTo(start.x,start.y);
  for (let i=0;i<ring.length;i++){
    const m=mid(ring[i],ring[(i+1)%ring.length]);
    ctx.quadraticCurveTo(ring[i].x,ring[i].y,m.x,m.y);
  }
  ctx.closePath();
  ctx.strokeStyle="rgba(76,175,125,.85)";
  ctx.lineWidth=1.5;
  ctx.shadowColor="rgba(76,175,125,.5)";
  ctx.shadowBlur=6;
  ctx.stroke();
  ctx.shadowBlur=0;
}

export function drawConstellation(ctx,pts,tMs,alpha,reduceMotion){
  if (alpha<=0.01) return;
  ctx.save();
  ctx.fillStyle="#73d7a0";
  for (let k=0;k<CONSTELLATION_INDICES.length;k++){
    const p=pts[CONSTELLATION_INDICES[k]];
    if (!p) continue;
    const shimmer=reduceMotion?1:.55+.45*Math.sin(tMs/900+k*1.7);
    ctx.globalAlpha=alpha*(.14+.14*shimmer);
    ctx.fillRect(p.x-.6,p.y-.6,1.2,1.2);
  }
  ctx.restore();
}
```

- [ ] **Step 3: Wire into handleResults**

Add refs: `const constAlphaRef=useRef(0); const lastFrameTsRef=useRef(0);` and module-level-per-hook `const reduceMotion=typeof matchMedia==="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches;`

In `handleResults`, in the face-present path, replace the iris-circle block's surroundings:

```js
const now=performance.now();
const dt=lastFrameTsRef.current?now-lastFrameTsRef.current:16;
lastFrameTsRef.current=now;
const targetAlpha=scanningRef.current?1:0;
constAlphaRef.current+= (targetAlpha-constAlphaRef.current)*Math.min(1,dt/600);
drawConstellation(ctx,pts,now,constAlphaRef.current,reduceMotion);
if (scanningRef.current&&iris.valid){
  drawEyeOval(ctx,pts,LEFT_EYE_CONTOUR);
  drawEyeOval(ctx,pts,RIGHT_EYE_CONTOUR);
  /* existing iris circles + dashed PD line stay, drawn after (on top) */
}
```
The alpha ramp gives the ~600ms fade-in at scan start and fade-out at completion (constellation keeps drawing on post-scan frames until alpha decays; `done` clears the canvas anyway).

- [ ] **Step 4: Verify + commit**

Preview: during positioning only the oval + hints show; when the scan fires, constellation fades in as faint shimmering dots, eye ovals track blinks/eye shape, iris circles render on top; at completion everything fades/clears. With OS reduced-motion enabled (or DevTools emulation), dots are static. Frame rate stays smooth (no jank in the ring fill). `npm run lint && npm run build`. Commit:
```bash
git add -A && git commit -m "feat: adaptive eye ovals and curated landmark constellation during the scan"
```

---

### Task 9: Scale-source badge on the measurements payoff

**Files:**
- Modify: `src/FramesSite.jsx` (step-2 block + css string)

**Interfaces:**
- Consumes: `confirmedMeas.scaleSource` (`"credit-card" | "iris-fallback"`), already stored by the engine.

- [ ] **Step 1: Add badge**

In the step-2 (`step===2`) header area, under the "these are yours." heading:

```jsx
<div className="scale-badge">{m.scaleSource==="credit-card"?"calibrated with card — highest accuracy":"calibrated from iris — solid accuracy"}</div>
```
(`m` is the measurements object already in scope in that block.) CSS next to `.calibration-strip`:

```css
.scale-badge{display:inline-block;margin:2px 0 10px;padding:5px 11px;border:1px solid var(--border);border-radius:999px;font-size:10.5px;color:var(--dim);font-family:'Geist Mono',monospace;letter-spacing:.02em;}
```

- [ ] **Step 2: Verify + commit**

`npm run lint && npm run build`; preview: complete an iris-only scan → badge reads "calibrated from iris". Commit:
```bash
git add -A && git commit -m "feat: scale-source badge on the measurements screen"
```

---

### Task 10: Full preview verification demo (NO DEPLOY)

**Files:** none (verification only)

- [ ] **Step 1: Build + serve the production bundle locally**

```bash
npm run lint && npm run build
```
Use the preview server (`.claude/launch.json` → `fitframe-dev`) for the interactive walkthrough.

- [ ] **Step 2: Walk every path, capture proof**

1. Consent screen: both choices + privacy block render (screenshot).
2. Iris path: consent → positioning → scan → measurements with "calibrated from iris" badge; network tab shows opencv.js NOT fetched.
3. Card path: consent → positioning → card-lock (blur mask visible over a real card, screenshot) → scale-locked beat → scan → badge reads "calibrated with card".
4. Card timeout: choose card, never show one → after 20s the retry/iris choice appears; "continue with iris" completes the scan.
5. Re-do: cover the camera during a scan → re-do card with plain-language reason; "scan again" keeps camera warm and works.
6. Blink/extension with `?debug=1`: blink discards logged; heavy movement stretches scan past 12s, caps at 18s.
7. Constellation: fades in at scan start, quiet shimmer, fades at end; reduced-motion emulation → static.
8. Console: zero errors across all paths. Steps 0/2/3 unaffected (hero, measurements, checkout form all render).

- [ ] **Step 3: Present the demo to Lorenzo**

Report results with screenshots. **STOP. Do not deploy.** Deployment happens only after Lorenzo's explicit approval, per the spec's hard gate.

---

## Self-review notes

- Spec coverage: consent (T3), card-lock w/o silent fallback (T4), blur mask (T5), blink gating (T6), adaptive duration + honest ring + re-do (T7), eye ovals + constellation (T8), scale badge (T9), extraction (T1-2), preview gate (T10). CARD_FALLBACK_MS removal: T4. Reduced-motion: T8. Iris users skip the opencv download: T4.
- Type consistency: `calibration` shape `{source, mmPerPx?, skippedCard?, ...}` unchanged everywhere; `quality.rescan` drives redo in both engine (T7) and UI (T7); `retryCardLock`/`cardLockActive`/`onCardTimeout` names match between T4 engine and T4 UI.
