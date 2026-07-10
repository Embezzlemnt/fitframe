// ─── Measurement math ─────────────────────────────────────────────────────────
export const IRIS_MM = 11.8;          // HVID mean reference
export const IRIS_SD = 0.5;           // +/-1 SD - acceptable iris diameter range: 10.8-12.8mm
export const IRIS_MIN_PX = 15;        // Below this the iris is too low-res for a trustworthy scale
export const IRIS_MAX_PX = 80;        // Above this, face is too close and landmarks compress
export const PD_ADULT_MIN = 52.0;     // Adult binocular PD lower reference
export const PD_ADULT_MAX = 80.0;     // Adult binocular PD upper reference
export const BRIDGE_MIN = 10.0;       // Minimum human bridge width
export const BRIDGE_MAX = 28.0;       // Maximum human bridge width
export const MONOCULAR_SYMMETRY = 2.5;// Max acceptable left/right monocular PD difference
export const TILT_THRESHOLD = 0.12;   // Iris center Y difference as a fraction of face height
export const IRIS_MISMATCH_MAX = 0.12;// Left/right iris reads differing more than this are bad landmark fits
export const MIN_VALID_SAMPLES = 3;   // Review-screen safety net handles small usable samples
export const FACE_ABORT_FRAMES = 80;  // ~2.5s of sustained face/pose loss during active scan (~32fps)
export const FACE_YAW_MAX = 0.08;     // Beyond this, perspective compresses the inter-pupil span
export const EAR_BLINK_MIN = 0.18;    // Catches partial blinks that squash the iris read
export const SCALE_HISTORY_FRAMES = 10;
export const SCALE_DRIFT_MAX = 0.05;  // Frame scale deviating >5% from the running median = distance/lighting shift
export const PD_STD_CLEAN_MM = 2.0;   // A clean scan must hold the PD spread under 2mm
export const BRIDGE_STD_CLEAN_MM = 1.5;
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

export const PRE_SCAN_SETTLE_MS = 1000;
export const SCAN_DURATION_SECONDS_PLACEHOLDER = 12;
export const SCAN_BASE_MS = 12000;
export const SCAN_MAX_MS = 18000;
export const TARGET_VALID_SAMPLES = 150;
export const REDO_MIN_SAMPLES = 40;

// visual-only landmark sets (measurement never reads these)
export const LEFT_EYE_CONTOUR =[33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
export const RIGHT_EYE_CONTOUR=[263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466];
// The measurement blueprint: smooth contour curves traced in anatomical order
// (jaw ring from the chin, brows, nose, lips), plus registration marks at the
// twelve true measurement sites. Visual-only — measurement never reads these.
export const CONTOUR_CHAINS=[
  {loop:true, idx:[152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377]},
  {loop:false,idx:[70,63,105,66,107]},
  {loop:false,idx:[300,293,334,296,336]},
  {loop:false,idx:[168,6,197,195,5,4,1]},
  {loop:false,idx:[98,97,2,326,327]},
  {loop:true, idx:[61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185]},
];
// ordered to match the trace: jaw sites first, then brow/nose/eye-corner sites
export const REGISTRATION_INDICES=[152,58,288,234,454,10,105,334,168,1,133,362];
