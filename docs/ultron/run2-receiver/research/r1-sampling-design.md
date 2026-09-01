# R1 — Camera Sampling Design (W1)

Sponsor: Iron Man (architecture) / Thor (performance). Dispatched as a general-purpose subagent 2026-09-01; evidence synthesized below.

## Q1 — rVFC support matrix → D1

**Baseline 2024 "Newly available"** (MDN BCD): Chrome/Edge 83 (2020) desktop+Android, Safari 15.4 (2022-03-14, macOS+iOS), Firefox 132 (2024-10-29; Bugzilla 1800882, Interop-2024). As of Sept 2026 rVFC is universally shipped in evergreen browsers.

- https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
- https://web.dev/articles/requestvideoframecallback-rvfc
- https://bugzilla.mozilla.org/show_bug.cgi?id=1800882 · https://www.firefox.com/en-US/firefox/132.0/releasenotes/
- Spec: https://wicg.github.io/video-rvfc/

**Decision (D1):** rVFC primary with `"requestVideoFrameCallback" in HTMLVideoElement.prototype` check; rAF fallback for legacy WebViews. Fallback discipline: sample every tick, dedupe identical `video.currentTime`, stamp `performance.now()`. Both rAF and rVFC stop in background tabs → decoder is foreground-only (visibilitychange pause/release already planned).

## Q2 — rVFC vs rAF for edge timing

web.dev + WICG spec: rAF fires ~60/s regardless of video content (same frame sampled 2–4× per camera frame; timestamp reflects page vsync, not frame arrival); rVFC fires exactly once per presented camera frame, provides frame-aligned `expectedDisplayTime`/`presentationTime`, and `presentedFrames` (monotonic) exposes dropped frames. Background throttling evidence: Chrome Developers blog (rAF stopped in background since 2011; intensive timer throttling Chrome 87).

## Q3 — Sampling canvas + luminance → D2

- 32×32 downsample (≈1 kB luminance; `getImageData` 4 kB/frame — negligible; the `drawImage` upload is the only real cost). ≥320×240 makes readback the bottleneck.
- Context created once with `getContext("2d", { willReadFrequently: true })` — avoids GPU→CPU readback stall per call (MDN getContext).
- **Rec.601 luma**, integer form (77R+150G+29B)>>8 — broadband white senders make 601/709 differ <2/255; robustness notes recorded for colored senders (per-channel max as future hardening).

**Decision (D2):** 32×32 + willReadFrequently + Rec.601 integer luma + ROI = mean of the brightest 4×4-tile region of the grid (a small torch in a wide scene must not be diluted by whole-frame mean).

## Q4 — Edge precision at 30 fps → D3

12 WPM worst case at 33.3 ms quantization: dot 100 ms ≈ 3 frames; measured dot ∈ [67,133], dash ∈ [267,333] around the 2û=200 boundary — non-overlapping; **30 fps suffices for 1:3 classification with ~±35% tolerance** if frames aren't dropped. 5/8 WPM have ≥3.5-frame slack everywhere.

**Decision (D3):** edge time = **midpoint of last-old-state and first-new-state frame times** (bounds error at ±½ frame ≈ 16.7 ms; kills the one-frame-late bias). Frame time = `expectedDisplayTime` (rVFC); `mediaTime` is spec-permitted zero for live gUM streams — never relied on. `presentedFrames` deltas mark drop-overlapped symbols low-confidence. Capture constraints `{ frameRate: { ideal: 60, min: 24 } }` — prefer 60 where granted, never `exact` (OverconstrainedError risk; many back cameras lock to 30). Measure real fps at runtime from `presentedFrames`, never assume.

## Q5 — Adaptive threshold → D4

Camera-VLC literature (region-grow thresholding from histogram stats; MDPI Photonics 11(4):293 smartphone LED-to-camera VLC) + standard baselines (Otsu 1979 — global, ill-suited to drifting ambient; Schmitt hysteresis).

**Decision (D4):** rolling **P25** of luminance = OFF level, **P95** = ON level over a 1–2 s window (Morse duty <50% keeps the median near OFF); dual-threshold hysteresis — ON at `L_off + 0.6·range`, OFF at `L_off + 0.35·range`; **contrast gate** `(L_on − L_off) ≥ 20` else no signal; **2-consecutive-frame confirmation** + **median-of-3 temporal filter** on the binarized series before edge emission. Debounce floor ≈ 0.4–0.5 û.

## Q6 — PWM / aliasing → folded into D4

OLED screens PWM-dim ~240 Hz (Notebookcheck PWM ranking; DC near 100% brightness on many panels); torch LEDs likely constant-current at full brightness (inferred; no public corpus). 240 Hz @ exactly 30 fps is stationary; real jittered rates produce sub-Hz–15 Hz beats inside the Morse band. Mitigations (committed via D4): min-mark ≥2 frames + median-of-3 kill single-frame excursions; spatial averaging absorbs rolling-shutter banding; our screen sender already flashes pure white at full brightness (DC region). Same gates absorb 100/120 Hz mains flicker.

## Open uncertainties → device tier (Q3-run2)

`mediaTime` on gUM across engines; iOS Safari rVFC quirks (WebKit bug 211945 follow-ups); delivered fps varying with ambient light; empirical torch PWM. All land in the two-phone script; none block the committed design.
