# FitFrame Scan Flow Redesign — Design Spec

**Date:** 2026-07-09
**Status:** Approved by Lorenzo (with condition: full preview demo before deploy)
**Scope:** Step 1 (face scan) of fitframe.store — consent flow, card-lock phase, visual overlay system, accuracy gating, code extraction.

## Goals

1. Users understand *why* we ask for a card, choose card or iris-only explicitly, and trust the privacy story.
2. Card path never silently degrades to iris; iris path is framed honestly as "still good."
3. Card numbers are never visible on screen (blur mask), without any accuracy cost.
4. Blinks and natural movement never corrupt measurements; bad scans end in a clear, reasoned re-do prompt instead of bad numbers.
5. The scan *feels* like a precision instrument: adaptive eye ovals, honest progress oval, curated landmark constellation.
6. Scan engine extracted from FramesSite.jsx into a `src/scan/` module.

## Non-goals

- No changes to steps 0, 2, 3, 4 (landing, measurements payoff, checkout, confirmation) beyond the scale-source badge on results.
- No new dependencies. MediaPipe Face Mesh (pinned 0.4.1633559619) and opencv.js stay as-is.
- No test framework introduction; verification is lint + build + preview walkthrough.

## 1. Flow / state machine

Step 1 becomes an explicit phase machine:

```
consent → positioning → (card-lock) → scanning → processing → results
                ↑______________redo loop_____________|
```

### Consent phase (replaces current prep card)
- Explains the card: "a credit card is a fixed, known size (85.6mm) — it anchors your measurements to the real world."
- Two equal-weight choices:
  - **"I have a card — most accurate"**
  - **"Use iris only — still good"** (framed honestly: iris calibration targets 1–2mm accuracy for non-Rx frame fitting; card tightens it further)
- Explicit "no rush — this screen waits while you grab a card" line.
- Privacy block: frames processed on-device by MediaPipe; **no photos or video are ever transmitted or stored**; only final millimeter numbers leave the device; the card is never read, only measured; card is auto-blurred on screen.

### Positioning phase
- Camera opens, green face oval as framing target, pose hints ("level your head", "face the camera").
- No timer pressure. Auto-start via existing HOLD_FRAMES good-pose mechanic.

### Card-lock phase (card path only)
- Distinct phase before face sampling. Prompt: "hold your card flat under your chin."
- Live card outline + blur mask + stability percentage.
- On lock: "scale locked" confirmation beat, then face scan begins.
- No lock after ~20s → explicit choice: "retry card / continue with iris". Never a silent fallback.
- The current 8s silent CARD_FALLBACK_MS behavior is removed.

### Scanning phase
- 12s base duration, adaptive extension (see §3).

### Results
- Existing measurements payoff plus a scale-source badge: "calibrated with card" / "calibrated from iris".

## 2. Visual layer

All drawing on the existing overlay canvas, one draw pass per frame, existing color family only (`--accent` #4caf7d, thin strokes, dark scan surface).

- **Face oval / progress ring:** framing target during positioning; during the scan the stroke fills as a progress ring driven by **valid-sample count**, not wall-clock. Blinking/moving pauses the ring — self-teaching honesty.
- **Eye ovals:** two green ovals fitted per-frame to each eye's actual contour landmarks (MediaPipe eye-contour indices), tracking real eyelid shape across all anatomies (monolids, hooded, deep-set, puffy). Measurement continues to come from iris landmarks (eyelid-independent); ovals are visual feedback. Iris circles + dashed PD line kept, drawn inside.
- **Landmark constellation:** scan phase only. Curated ~100 structural points (jawline, brow, nose bridge/tip, lip outline, cheek contours) as 1px low-opacity dots with slow per-dot sinusoidal shimmer. Fades in ~600ms at scan start, fades out at completion. `prefers-reduced-motion` → static dots, no shimmer.
- **Card blur mask:** whenever a card candidate quad exists (pre-lock included), draw a pixelated patch over the quad inflated ~8%, outline/label on top. Implementation: draw the video card region into a small offscreen canvas, scale back up with `imageSmoothingEnabled=false`. Detector reads the raw video, so blur costs zero accuracy.

## 3. Accuracy engine

- **Blink detection:** eye-aspect-ratio (EAR) per eye from eyelid landmarks; frames below threshold discarded with reason `blink`. Discard reasons remain visible in the debug overlay.
- **Adaptive duration:** scan targets a valid-sample floor. If valid samples fall behind pace at 12s, extend in small increments up to +6s (18s hard cap). Progress ring makes extension invisible — it just fills slower.
- **Re-do prompt:** if the cap is hit and samples are under the floor, end in a re-do card that maps the dominant discard reason to plain language: "too much movement", "we lost your eyes — more light on your face", "too far from the camera". One-tap "scan again" returns to positioning; camera stays warm.
- **Kept as-is:** pose/yaw gating, trimmed weighted averaging, abort on sustained face loss, PD sanity ranges, median iris-scale history.

## 4. Code structure

```
src/scan/
  constants.js        // thresholds, landmark index sets, timings
  cardDetection.js    // detectCardOutline + blur mask drawing
  faceMetrics.js      // iris metrics, EAR/blink, pose validation, measurement math
  overlays.js         // constellation, eye ovals, progress oval, card drawing
  useFaceScan.js      // engine hook (phases, sampling, adaptive duration)
  ScanStage.jsx       // consent, positioning, card-lock, scanning, redo UI
```

FramesSite.jsx keeps the page shell and mounts `<ScanStage/>` for step 1.

**Order of work:** pure extraction first (zero behavior change, verified against current behavior), then features on top. Each lands as its own commit.

## 5. Verification & deployment gate

- `npm run lint` and `npm run build` must pass at every commit.
- Preview walkthrough (wrangler dev / vite) of both paths before anything ships:
  - card path end-to-end including blur mask and scale-lock beat
  - iris-only path end-to-end
  - failure cases: camera covered mid-scan → re-do prompt; no card shown → explicit retry/iris choice; sustained blinking → adaptive extension then re-do
- **Hard gate: no deploy to production until Lorenzo has seen the preview demo and explicitly approved.** The live site must not degrade in any way.

## Design language note

Everything stays inside the existing visual system — Geist Mono metrics, #4caf7d accent, thin strokes, quiet dark surfaces. The constellation is the only new visual vocabulary and it is deliberately quiet.
