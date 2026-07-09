// ─── Measurement math ─────────────────────────────────────────────────────────
export const IRIS_MM = 11.8;          // HVID mean reference
export const IRIS_SD = 0.5;           // +/-1 SD - acceptable iris diameter range: 10.8-12.8mm
export const IRIS_MIN_PX = 10;        // Launch-tolerant floor for arm's-length phone scans
export const IRIS_MAX_PX = 80;        // Above this, face is too close and landmarks compress
export const PD_ADULT_MIN = 52.0;     // Adult binocular PD lower reference
export const PD_ADULT_MAX = 80.0;     // Adult binocular PD upper reference
export const BRIDGE_MIN = 10.0;       // Minimum human bridge width
export const BRIDGE_MAX = 28.0;       // Maximum human bridge width
export const MONOCULAR_SYMMETRY = 2.5;// Max acceptable left/right monocular PD difference
export const TILT_THRESHOLD = 0.14;   // Iris center Y difference as a fraction of face height
export const IRIS_MISMATCH_MAX = 0.30;// Launch-tolerant left/right iris diameter difference
export const MIN_VALID_SAMPLES = 3;   // Review-screen safety net handles small usable samples
export const FACE_ABORT_FRAMES = 80;  // ~2.5s of sustained face/pose loss during active scan (~32fps)
export const FACE_YAW_MAX = 0.15;
export const EAR_BLINK_MIN = 0.16;
export const SCALE_HISTORY_FRAMES = 10;
export const CREDIT_CARD_WIDTH_MM = 85.6;
export const CREDIT_CARD_HEIGHT_MM = 54;
export const CARD_ASPECT = CREDIT_CARD_WIDTH_MM / CREDIT_CARD_HEIGHT_MM;
export const CARD_STABLE_FRAMES = 6;
export const CARD_MAX_ROTATION_DEG = 14;
export const CARD_MIN_CONFIDENCE = 0.58;
export const CARD_LOCK_TIMEOUT_MS = 20000;
export const OPENCV_URL = "https://docs.opencv.org/4.9.0/opencv.js";
// Pinned MediaPipe version — the scan engine must not float with CDN "latest".
// This is the final published version of the legacy MediaPipe JS face_mesh solution.
export const MEDIAPIPE_FACE_MESH_VERSION = "0.4.1633559619";

export const SCAN_SEQ = [
  { holdMs:1500, fill:0.08 },
  { holdMs:3000, fill:0.35 },
  { holdMs:3000, fill:0.65 },
  { holdMs:2500, fill:0.88 },
  { holdMs:1500, fill:1.00 },
];
export const PRE_SCAN_SETTLE_MS = 1000;
export const SCAN_DURATION_SECONDS_PLACEHOLDER = 12;
