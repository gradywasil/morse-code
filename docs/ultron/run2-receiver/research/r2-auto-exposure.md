# R2 — Auto-Exposure vs Light-Signal Decoding (W1, provisional criteria 9–10)

Sponsor: Doctor Strange (risk) / Captain America (privacy-honest UI). Dispatched as a general-purpose subagent 2026-09-01.

## Q1 — AE adaptation dynamics

Mobile AE is continuous, per-frame stepwise reconvergence, not a jump: transient **~0.3–1.0 s (10–30 frames at 30 fps)** after the torch enters the frame, sometimes damped oscillation, with a 2–3 frame actuation floor.

- Android Camera2 `CONTROL_AE_STATE` — explicit SEARCHING→CONVERGED state machine, timing device-dependent: https://developer.android.com/reference/android/hardware/camera2/CaptureResult
- arXiv 2404.01636 (2024): built-in AE converged in 30 frames indoor / 10 outdoor: https://arxiv.org/html/2404.01636v1
- US10057499B1 (directional): 2–3 frame pipeline delay. USC MCL (directional): hundreds-of-ms convergence, oscillation documented.
- MDPI Photonics 11(4):293 — native VLC app **disables AE on startup**; working distance 100–210 cm: https://www.mdpi.com/2304-6732/11/4/293

Implication at our speeds: the transient spans 1–4 dots at 5 WPM (≈ one lost character at message start) and 3–10 dots at 12 WPM; after the first element the duty-averaged brightness is constant and AE settles — danger zones are message start, long gaps, AF/AWB co-triggers, hand movement.

## Q2 — Constraint support matrix (verified in engine source)

Spec: mediacapture-image is an Editor's Draft (2025-04-23); exposure constraints apply only via `advanced` (best-effort, silently ignored when unsupported; verify with `getSettings()`).

| | Chrome Android | iOS Safari | Firefox |
|---|---|---|---|
| `exposureMode`/`exposureTime`/`iso` | Implemented (`CONTROL_AE_MODE_OFF` + `SENSOR_EXPOSURE_TIME`); advertised **device-dependent** | **No — not even parsed**: WebKit `MediaConstraintType.h` has no exposure members | No |
| `exposureCompensation` | Yes (`CONTROL_AE_COMPENSATION_RANGE`, EV) | No | No |
| `whiteBalanceMode` | Implemented | Enum exists, wiring unconfirmed | No |

- Chromium `VideoCaptureCamera2.java` (current main): https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/capture/video/android/java/src/org/chromium/media/VideoCaptureCamera2.java
- WebKit `MediaConstraintType.h`: https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/mediastream/MediaConstraintType.h
- Firefox 132 shipped `getCapabilities` (basic only): bug 1179084; WPT meta expects image-capture subtests to fail.
- webrtcHacks manual-exposure walkthrough (order matters: mode, then time; settings can persist — reset on exit): https://webrtchacks.com/bad-lighting-fix-with-javascript-webcam-exposure/
- `getCapabilities()` may be empty until ~0.5 s after stream start (Chrome blog; oberhofer.co).

## Q3 — Close-range saturation

Torch filling the frame clips both states → no threshold recovers; bloom spreads the highlight. Web-controllable levers are Chromium-only (negative EV while continuous; manual mode + short exposureTime). Engine-independent mitigations: small fixed ROI + robust statistics; clipping detection (fraction of ROI ≥ ~250) → "move back" warning; keep sender at arm's length+; rolling percentile thresholds absorb slow gain drift.

## Q4 — Recommended posture → D5

**Core = continuous AE + adaptive thresholding everywhere** (iOS Safari and Firefox expose nothing; Chrome Android advertisement is device-gated — the decoder must work with zero constraint support). **Enhancement = capability-gated, applied silently**: after ~0.5 s, if `exposureMode` includes `'manual'` and `exposureTime` range exists → best-effort lock with short exposureTime (mode first, then time; verify via `getSettings()`; reset on release + pagehide); else if `exposureCompensation` exists → gentle negative-EV nudge; else nothing. UI honesty: Safari/Firefox get guidance copy (light 1–2 m away, off-axis, watch the meter); everywhere: live clipping indicator with "saturated — move back."

**Deferred (explicit):** user-facing "Lock exposure" toggle / EV slider — not in the MVP surface (Ant-Man boundary); owner: production; revisit trigger: device results (Q3-run2) show decode failures the silent strategy misses. Fallback default if revisited: off (adaptive core only).

## Confidence

High: support matrix (engine source), decision rule, mitigation coverage. Medium: per-device AE timing, Chromium tone-mapping interplay, exact EV/exposureTime values (empirical, device tier).
