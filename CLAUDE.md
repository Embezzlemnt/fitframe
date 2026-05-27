# FitFrame — Master Agent Brief
# Paste this entire prompt into Claude Code after it reads CLAUDE.md.
# This is your fire-and-forget brief. Walk away and come back to a PR.

---

You are the sole engineer on FitFrame. Read CLAUDE.md fully before doing anything.
Your job is to make this product as good as it can possibly be across four areas.
Work through them in order. Commit each area as a separate PR or clearly labeled commit group.

---

## AREA 1 — Fix the iOS Safari scan (highest priority)

The face scan hangs on iPhone Safari. Debug and fix it completely.

Steps to take:
1. Read the MediaPipe initialization code and camera access logic in /src/scan
2. Check if WASM SIMD or threading flags are incompatible with Safari's WebAssembly restrictions
3. Check if getUserMedia constraints are causing Safari to silently fail
4. Add a Safari-specific fallback path if needed — same result, different initialization
5. Add a visible error state so the user is never left staring at a frozen screen
6. Test path: scan must complete and return face landmarks without errors

Done when: face scan reaches 100% and returns landmarks on iPhone Safari 17. Zero console errors.

---

## AREA 2 — Design system foundation

Before touching any screen, establish the design token layer that everything else will inherit.

Create /src/styles/tokens.css with:
- Type scale: 3 sizes (display, body, caption), 2 weights (regular, medium)
- Font pairing: choose a distinctive premium display font (NOT Inter, NOT Roboto, NOT Space Grotesk)
  that reads as confident and modern. Pair with a clean neutral body font.
  Import both from Google Fonts or Bunny Fonts.
- Color tokens:
  --color-bg: near-white or very dark (commit to one)
  --color-surface: slightly offset from bg
  --color-text-primary
  --color-text-secondary
  --color-accent: one strong brand color (NOT purple)
  --color-success
  --color-error
- Spacing scale: 4px base unit, tokens at 4/8/12/16/24/32/48/64/96px
- Border radius: one value for cards, one for buttons, one for inputs
- Motion: one easing curve (cubic-bezier), duration tokens at 150ms / 250ms / 400ms

Apply the design tokens globally. Every existing hardcoded color or spacing value in the
codebase gets replaced with a token reference.

Done when: tokens.css exists, all components reference it, zero hardcoded hex values remain.

---

## AREA 3 — UI polish across all screens

With the token system in place, upgrade every screen to match the Apple-model design language
defined in CLAUDE.md. Work screen by screen in flow order.

### Screen 1: Landing / entry
- One clear action above the fold: "Scan your face" CTA
- The value proposition (custom fit, 3D printed, $89) visible without scrolling
- Background must have depth — consider a subtle gradient mesh, grain texture, or dark surface
- The CTA button must be large, full-width on mobile, with a satisfying press animation

### Screen 2: Scan flow
- Oval face guide: animated breathing pulse while waiting, fills/locks when face is detected
- Progress indicator: smooth arc or ring that fills as scan completes — not a loading bar
- Instruction text: one line max, updates contextually ("Move closer" / "Hold still" / "Perfect")
- Completion state: confident visual — checkmark animation, measurements displayed cleanly
- If scan fails: clear error state with a retry button. Never leave the user confused.

### Screen 3: Style questions
- Maximum 3 questions. Display them one at a time — not all at once.
- Each question takes the full screen. Large tap targets. No scrolling required.
- Transitions between questions: slide or fade, 250ms, smooth

### Screen 4: Frame selection
- Frame options presented as visual cards with real preview images or illustrated silhouettes
- Selected state is unmistakable — strong accent border, slight scale, no ambiguity
- "Recommended for your face shape" label on the best match based on scan data

### Screen 5: Shipping + order
- Use browser-native autocomplete attributes on all address fields
- Fields: name, email, address (autocomplete="street-address"), city, zip
- Remove any unnecessary fields — if it's not needed to ship the order, cut it
- Submit button: full width, shows loading state, then success state
- Success state: brief celebration moment (not confetti — something refined), then confirmation copy

Done when: every screen matches the design language, works one-handed on iPhone, 
and has no layout regressions on desktop Chrome.

---

## AREA 4 — Order submission (replace mailto)

Replace the mailto fallback with a real structured order pipeline.

1. Create a Fillout form at fillout.com (or use their embed/API) to receive the order spec
2. The form submission should send:
   - Face measurements object (PD, bridge width, temple width, face height) as JSON
   - Frame selection
   - Lens preference
   - Full shipping address
   - Contact email
3. If Fillout webhook is not yet configured: output the full order spec as a clean JSON object
   in the console AND display a formatted order summary screen to the user so they can screenshot it
4. The submission flow must never leave the user uncertain — show a clear confirmation state

Done when: order data is captured in a structured format, user sees confirmation, 
mailto is no longer in the critical path.

---

## PR / commit structure expected

- PR 1: fix/ios-safari-scan
- PR 2: feat/design-system-tokens
- PR 3: feat/ui-polish-all-screens
- PR 4: feat/order-submission

Each PR description should include:
- What changed
- What was tested
- Any new packages added and why
- Any open questions or tradeoffs you made

---

## Final check before you open any PR

- iPhone Safari 17: scan works, all screens render correctly, no console errors
- Chrome desktop: nothing regressed
- Lighthouse mobile score: 85 or above
- Zero hardcoded colors or spacing values outside tokens.css
- No lorem ipsum, placeholder images, or TODO comments in merged code
