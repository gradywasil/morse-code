# Run-2 Research Summary

Tracks dispatched 2026-09-01 as three parallel general-purpose subagents (delegation available and used; findings synthesized by the parent). The pre-dispatch disposition list (all research / skip none) got no user response; proceeding matched the plan-gate approval ("Approve — run research" with the R1/R2/R3 queue listed) — noted here as the standing-record substitution.

## Decision matrix — ALL DISPOSITIONED AT THE GATE 2026-09-01

D1–D9: **committed** (user approved each package as recommended). D10: **committed at 5 s** (user chose the snappier value; plan updated). No deferred decisions remain except the explicitly-owned D5 sub-deferral (user-facing exposure controls — owner production, revisit trigger: device results).

| # | Decision | Status | Evidence | Plan tasks touched | User disposition |
|---|---|---|---|---|---|
| D1 | rVFC primary sampling path (Baseline 2024: Chrome/Edge 83+, Safari/iOS 15.4+, Firefox 132+), feature-checked; rAF fallback (dedupe on `video.currentTime`, `performance.now()` stamps) | **commit proposed** | MDN BCD, web.dev, WICG spec, Bugzilla 1800882, Firefox 132 release notes | W1 | gate |
| D2 | Sampling canvas 32×32, `willReadFrequently:true`, Rec.601 integer luma; ROI = brightest 4×4-tile mean of the 32×32 grid | **commit proposed** | MDN getContext, ITU-R BT.601; VLC analogues | W1 | gate |
| D3 | Edge timestamps = midpoint between last-old-state and first-new-state frame via `expectedDisplayTime` (never `mediaTime` for gUM — spec-permitted zero); `presentedFrames` deltas detect drops → low-confidence marks; `{frameRate:{ideal:60,min:24}}` never `exact` | **commit proposed** | WICG spec, MDN frameRate constraints | W1 | gate |
| D4 | Binarization: rolling P25 (OFF) / P95 (ON) over 1–2 s, dual-threshold hysteresis (ON at 0.6·range, OFF at 0.35·range), contrast gate ≥20/255, 2-consecutive-frame confirmation + median-of-3 temporal filter (also the PWM/beat-flicker defense) | **commit proposed** | Otsu/hysteresis baselines; camera-VLC literature | W1 | gate |
| D5 | AE posture: continuous AE + adaptive thresholding is the mandatory everywhere-core; capability-gated best-effort exposure strategy applied silently on Chromium only (manual mode + short exposureTime where advertised, else negative EV nudge, reset on release/pagehide); **user-facing lock/EV controls deferred** (owner: production; trigger: device results show decode failures the auto strategy misses) | **commit proposed** | WebKit MediaConstraintType.h (no exposure members — verified in source), Chromium VideoCaptureCamera2.java (verified mapping), Firefox WPT meta; AE converges ~0.3–1 s stepwise (arXiv 2404.01636) | W1, U1 | gate |
| D6 | Clock recovery: fldigi validated-pair estimator (ratio ∈ [2,4] gates every update), linearly-weighted MA window 20–30 (morse-pro), acceptance windows 0.6×–6× (OZ1JHM); snap to a speed hypothesis when 2 consecutive validated estimates agree within 15% (our û set {240,150,100} ms is well separated); light tracking reopens on >20% drift for 2+ pairs; never hard-lock | **commit proposed** | morse-pro source, fldigi cw.cxx, OZ1JHM, K4ICY | F2 | gate |
| D7 | Classification boundaries: marks dot <2û, dash 2–6û, ≥6û anomaly (excluded from estimation); gaps symbol <2û, letter 2–5û, word ≥5û | **commit proposed** | morse-pro/OZ1JHM midpoints (1,3→2; 3,7→5); quantization math: ≥1 frame slack at 12 WPM | F1 | gate |
| D8 | Mid-join rules: leading gap never classified; session's first edge ON→OFF (joined mid-mark) → discard that mark and the following gap (this IS the partial detector) | **commit proposed** | structural; morse-pro unused-times pattern | F3 | gate |
| D9 | Noise triad: silence = no edges; noise/interference = solid light or marks persistently outside 0.5×–6×û or coherence <~75% (marks within ±1 frame of û/3û) or invalid-Morse rate high; valid requires ≥5–6 marks + ≥1 validated pair before any text commits | **commit proposed** | fldigi spike/SNR rules, morse-pro '#' garbage signal, fallows coherence diagnostics | F3 | gate |
| D10 | Silence auto-complete threshold | **choice** | 10 s = 6× longest gap (safe, slower demo); 5 s ≈ 3× longest gap + slack (snappier; R3 verdict: both sane) | F3, U1 | gate (pick one) |

## Track records

- `r1-sampling-design.md` — D1–D4 (sponsor: Iron Man/Thor)
- `r2-auto-exposure.md` — D5 (sponsor: Doctor Strange/Captain America)
- `r3-clock-recovery.md` — D6–D10 (sponsor: Professor X)

## Contradictions and confidence

No cross-track contradictions. High confidence: rVFC matrix (BCD + release notes), WebKit/Firefox exposure-constraint absence (verified in engine source), 2×/5× boundaries (three independent implementations). Medium: 12 WPM one-frame margins (computed, not measured), AE timing distribution per device, PWM behavior of phone torches (inferred constant-current). Device-tier verification lands in Q3-run2 (two-phone script) — the provisional criteria 9–10 own the residual risk.

## Plan impact

D1–D9 pin strategies and constants inside already-planned tasks (W1, F1, F2, F3, U1) without changing task boundaries, architecture, or scope; D10 changes one constant's acceptance criterion (10 s → 5 s if chosen). No whole-plan re-approval trigger beyond this gate per ultron change control; the revised acceptance criteria ride this gate.
