# R2 — Torch toggle latency → safe WPM bounds, latency-absorption scheduling, audio/light sync tolerance

- **Decision priority:** P0 (blocks F2 schedule engine, F6 broadcast conductor; informs F5 audio channel, U1 copy/speed labels)
- **Status:** decided (pending user real-device confirmation via Q3 — see confidence)
- **Delegation record:** research subagent (ultron-supreme deep-research track R2), 2026-08-28. Desk research only — no Android device was available, so every latency figure below is cited, not measured. That limitation is the single biggest caveat in this record.

## 1. Questions and affected tasks

| # | Question | Affects |
|---|----------|---------|
| Q1 | Measured Android torch-toggle latency via `MediaStreamTrack.applyConstraints({advanced:[{torch}]})` (command → physical LED change, settle/jitter) | F3, F6, F8 (fallback triggers) |
| Q2 | WPM range that stays legible on an LED given that latency (dot = 1200/WPM ms; ratios 1/3/1/3/7) | F2, U1 |
| Q3 | Latency-absorption scheduling: gap-inclusive early-fire vs measure-then-calibrate vs naive; timer drift, background throttling, visibilitychange | F6, F2, F5 |
| Q4 | Perceptually acceptable audio↔light sync offset; how to keep Web Audio beeps and async torch aligned | F5, F6 |

## 2. Constraints and evaluation criteria

From `docs/ultron/plan.md` (fixed by scope) + this track:

1. Plain static web app; no build, no dependencies.
2. Privacy: **no video-frame APIs ever** — this bans any runtime calibration that reads camera frames (e.g. `requestVideoFrameCallback`-based LED confirmation). Camera track released after broadcast.
3. Photosafety: default speed keeps sustained-dot flashing under 3 Hz; capped upper speed; `prefers-reduced-motion` honored.
4. Morse timing: dot = 1200/WPM ms, PARIS standard, ratios dot 1 / dash 3 / intra-char gap 1 / letter gap 3 / word gap 7.
5. Evaluation criteria for options: **legibility risk** (symbol distortion vs dot length), **sync risk** (residual audio↔light offset vs ITU detectability windows), **complexity** (no-dependency, mock-testable per F6 AC), **failure modes** (bad HALs, background tabs, torch-loss fallback).

## 3. Evidence

### 3.1 Torch toggle latency (Q1)

**No published, controlled benchmark of web-level `applyConstraints(torch)` → LED latency exists** (searched: Stack Overflow, GitHub issues of torch-consuming libraries, Chromium tracker, developer articles). The spread must be triangulated from the layers underneath the web call. Every layer below is cited.

**a) The web call is async and resolves *before* the LED moves.**
- MDN, [MediaStreamTrack: applyConstraints()](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/applyConstraints) — returns a Promise that resolves "when the constraints have been applied" to the track/source; no physical-effect timing is specified.
- W3C [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/) — spec ties promise resolution to settings application, not observable hardware state.
- Chromium implementation (primary source, [`media/capture/video/android/java/src/org/chromium/media/VideoCaptureCamera2.java`](https://chromium.googlesource.com/chromium/src/+/3015459a9bf07f62ab7a8816ff88824568d87c04/media/capture/video/android/java/src/org/chromium/media/VideoCaptureCamera2.java)): `SetPhotoOptionsTask.run()` stores `mOptions.torch`, then simply re-issues the live preview request — `mPreviewSession.setRepeatingRequest(mPreviewRequestBuilder.build(), null, null)` — with `CaptureRequest.FLASH_MODE = FLASH_MODE_TORCH` set in `configureCommonCaptureSettings()`. The task completes (and the promise chain proceeds) when the request is **submitted**; the physical LED changes when the camera pipeline reaches that request, i.e. 1–3 preview frames later. Consequence: promise-resolve time is a *lower bound* that systematically underestimates LED latency.

**b) Native-side measured reports (the pipeline Chromium rides on).**
- Stack Overflow, [android camera2 setTorchMode too slow](https://stackoverflow.com/questions/43055551/android-camera2-settorchmode-too-slow) (Mar 2017; camera2 `CameraManager.setTorchMode`): asker measures **~0.5 s** to turn on. Accepted answer (Eddy Talvala, ex-Android camera framework): devices whose HAL lacks the fast enable-torch interface force the OS to **open the whole camera device** (~hundreds of ms); with a HAL that supports it, toggling is "very fast." → Worst-case native torch latency ≈ 300–500 ms on such devices even for a fire-and-forget native call.
- Stack Overflow, [Android Camera (Flashlight) API too slow](https://stackoverflow.com/questions/31758314/android-camera-flashlight-api-too-slow) (old `Camera` API): reported delays **up to ~4 s** when each toggle re-opens the camera. Pathological tail case; not our code path (our track stays open) but it shapes the fallback design.
- Android docs, [Camera capture sessions and requests](https://developer.android.com/media/camera/camera2/capture-sessions-requests): settings changes are **per-request/per-frame**; the doc explicitly gives **"no guarantee" on latency between replacing repeating requests** and frames already in flight ("Latency is not guaranteed between the last repeated request of A before request B activates… frames may be skipped"). No ms figures. At the default 30 fps preview this implies a ~33 ms frame-quantization of when a torch request takes effect, plus HAL pipeline depth.
- Chromium issue [1246938](https://bugs.chromium.org/p/chromium/issues/detail?id=1246938), "WebRTC/getUserMedia applyConstraints works to turn on torch" (2021): reporter states torch control "works great on my Pixel devices" but fails on another specific device — direct evidence of **device/HAL-dependent behavior** (this is the failure class F3/F8 must detect and fall back from). (Snippet-level: page body not retrievable from this environment; title/reporter text verified via search index.)
- W3C mediacapture-image [issue #275](https://github.com/w3c/mediacapture-image/issues/275) (11 Mar 2021): torch-on works "the very first time"; subsequent `torch:false` fails silently on some mobile browsers. Mirrored in the wild by html5-qrcode issues [#634](https://github.com/mebjas/html5-qrcode/issues/634) (torch turns on, fails to turn off) and [#848](https://github.com/mebjas/html5-qrcode/issues/848). → rapid toggling has reliability failure modes beyond latency; consecutive `applyConstraints` calls must be spaced (all our WPM steps naturally space commands ≥100 ms > one 33 ms frame).

**c) Synthesized latency budget for our exact path** (live open track → `FLASH_MODE_TORCH` re-issue; no camera open/close in the loop):

| Segment | Typical | Bad HAL / tail |
|---|---|---|
| Blink → browser-process → Java `setRepeatingRequest` submission (promise ≈ here) | 5–30 ms | 50+ ms |
| HAL pipeline to LED (1–3+ preview frames @30 fps) | 33–100 ms | 150–400 ms |
| **Command → LED total** | **~40–130 ms** | **~300–500 ms** (measured native ~0.5 s class), rare multi-second outliers |
| Settle/jitter (toggle-to-toggle variation, frame-quantized) | ±33–70 ms | larger on first toggle after idle / AE state change |

Confidence: low-to-moderate — triangulated from cited native reports + Chromium source + Android docs; no controlled web-level dataset exists. This is exactly what Q3 (user's real-device script) must confirm.

### 3.2 Morse legibility vs latency and speed (Q2)

- Visual Morse copy is *slower* than audio copy and is limited by decoding, not the eye: flicker fusion is ~48–60 Hz ([flicker fusion threshold, PMC review](https://pmc.ncbi.nlm.nih.gov/articles/PMC8537539/)), far above Morse rates.
- Naval practice — [Visual Signalling in the RCN (jproc.ca)](https://www.jproc.ca/rrp/rrp2/visual_lights.html): **training speed ~5 WPM** (UNTD cadet qualification), **NATO standard sending speed 8 WPM** (directional signalling), **typical flashing-light capability ~13 WPM**. Trained signalmen top out near 13 WPM visual copy.
- Symbol-distortion arithmetic (jitter as fraction of dot): with ±33 ms jitter → 5 WPM (240 ms dot) = 14 %; 8 WPM (150 ms) = 22 %; 12 WPM (100 ms) = 33 %; 15 WPM (80 ms) = 41 %. Fixed latency on BOTH edges cancels (pattern shifts wholesale); only the jitter fraction and slow-tail asymmetry distort dot/dash ratios.
- Photosensitivity: WCAG 2.2 SC [2.3.1 Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) (Level A, non-interference): no more than **three flashes in any one-second period** unless below general/red flash thresholds (small-area exemption needs ≤0.006 steradians ≈ 25 % of a 10° visual field — a full-screen white overlay does not qualify; a distant LED viewed by a receiver plausibly does). Sustained-dot flash rate = WPM/2.4 flashes/s: 5 WPM → **2.08 Hz (compliant)**; 8 → 3.33; 12 → 5.0; 15 → 6.25.

### 3.3 Scheduling, drift, background throttling (Q3)

- Chris Wilson (Google), [A Tale of Two Clocks](https://web.dev/audio-scheduling) (2013; HTML5Rocks original): don't drive audio with `setTimeout` — timer callbacks are skewed "by tens of milliseconds or more" (observed ~50 ms late); schedule against `AudioContext.currentTime` (runs on the audio thread; fires exactly even if the main thread stalls) with a **lookahead scheduler: 25 ms timer interval, 100 ms schedule-ahead time**; OS audio buffer latency varies "from low single digits of milliseconds to around 50 ms."
- WHATWG HTML, [§ Timers](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers): "This API does not guarantee that timers will run exactly on schedule"; nesting >5 forces ≥4 ms; agents may pad timeouts by an implementation-defined amount (low-power modes).
- W3C [High Resolution Time](https://w3c.github.io/hr-time/): `performance.now()` is a monotonic `DOMHighResTimeStamp` (coarsened to 100 µs; 5 µs where isolated) — suitable for wall-relative deltas, but not a substitute for the audio hardware clock.
- Chrome 88 timer throttling ([developer.chrome.com/blog/timer-throttling-in-chrome-88/](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/), Jan 2021): hidden pages with chained timers go to **intensive throttling = 1 timer/minute** after 5 min hidden, unless audio played in the last 30 s or **WebRTC is active (live MediaStreamTrack keeps the page at the 1 s-throttling tier at worst)**. Even the 1 s tier destroys a 25 ms lookahead tick. Only scheduled (already-queued) Web Audio events survive main-thread starvation, and just ~100 ms of them under the standard lookahead.

### 3.4 Audio↔light sync tolerance (Q4)

- **ITU-R BT.1359-1** (1998), *Relative timing of sound and vision for broadcasting* ([ITU PDF](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1359-0-199802-S!!PDF-E.pdf), corroborated by [EE Times](https://www.eetimes.com/audio-video-synchronization/) and [Forasoft's BT.1359 explainer](https://www.forasoft.com/learn/audio-for-video/articles-audio/lip-sync-itu-r-bt-1359-tolerance-windows)): detectability thresholds **+45 ms (audio leads) / −125 ms (audio lags)**; acceptability **+90 / −185 ms**. Undetectable window ≈ audio leading the visual event by <45 ms or lagging it by <125 ms.
- Stricter broadcast practices: **ATSC IS/191** — audio must not lead video by >15 ms nor lag by >45 ms ([EE Times HDMI lip-sync](https://www.eetimes.com/hdmis-lip-sync-and-audio-video-synchronization-for-broadcast-and-home-video/), [TV Tech](https://www.tvtechnology.com/opinions/atsc-recommends-av-sync-rules)); **EBU R37-2007** — +40/−60 ms end-to-end ([Wikipedia: Audio-to-video synchronization](https://en.wikipedia.org/wiki/Audio-to-video_synchronization), [NAB Lip Sync Revisited](http://www.nab.org/xert/scitech/pdfs/tv100509.pdf)).
- Caveat: BT.1359 thresholds were measured for speech/lip-sync; a simple beep+flash pair is *less* sensitive than lips (simpler stimuli, no articulatory detail), so BT.1359 is a conservative design envelope. The task prompt's "<45–125 ms lead / <45 ms lag" framing matches the BT.1359/ATSC numbers above once signs are applied (audio lead is the tight direction — and "light lags audio" is exactly our failure direction).

## 4. Options considered

### WPM steps (Q2)

| Option | Legibility risk | Photosafety | Verdict |
|---|---|---|---|
| A. 5 / 8 / 12, cap 15 (placeholders) | 15 WPM: dot 80 ms; ±33 ms jitter = 41 % distortion; visual copy >13 WPM is expert-only; bad-HAL latency (300 ms) swallows ~4 dots | 15 WPM sustained dots 6.25 Hz | Reject cap 15 |
| **B. 5 / 8 / 12 with hard cap 12** | 12 WPM = naval "typical capability" ceiling; jitter 33 % worst-case but rare; min element (intra gap 100 ms) still > 33 ms frame + IPC spacing needed to avoid rapid-toggle bugs (§3.1c) | BRISK 5 Hz opt-in behind hazard copy; default 5 WPM = 2.08 Hz < 3 Hz | **Recommended** |
| C. 5 / 8 / 10 (more conservative) | Safer margins but 10 WPM has no evidentiary anchor; steps lose the neat naval mapping (5 training / 8 NATO / ~13 capability) | 10 → 4.17 Hz, barely better than 12 | Reject |

### Latency absorption (Q3)

| Option | Mechanism | Failure modes | Verdict |
|---|---|---|---|
| a. **Gap-inclusive early-fire (lead-fire) with fixed lead constant** | Conductor issues torch commands at `tMs − TORCH_LEAD_MS`; physical transition lands inside the symbol window near the boundary; audio stays on the exact `tMs` | Mis-tuned lead leaves residual offset (bounded by tolerance below); slow-HAL outliers (>lead+tolerance) visibly late — mitigated by F3/F8 fallback to screen channel | **Recommended** |
| b. Measure-then-calibrate (pre-flight flash, measure, scale gaps) | Times `await applyConstraints` during pre-flight and adapts | Promise resolves on **submission**, not LED change (§3.1a) → systematically short by 1–3 frames; physical confirmation requires camera frames — **banned by privacy scope**; per-toggle variance makes a single estimate fragile | Reject (unsound signal + violates constraint 2) |
| c. Naive fire-and-hope | Toggle at `tMs`, no correction | Light lags audio by full L (40–500 ms) → outside +45 ms detectability window on essentially every device; ratios survive but sync fails | Reject |
| d. Hybrid a+b-lite | Fixed lead, *sanity-checked* (not calibrated) by post-broadcast `getSettings()` / Q3 human check | Complexity without runtime benefit | Fold the sanity-check into a |

Clocking substrate:
- **setTimeout-per-symbol chains: reject** — cumulative drift, spec-permitted late firing, ≥4 ms nesting clamp, background throttling (§3.3).
- **performance.now() loop: required but not sufficient** — right monotonic wall clock for UI/progress; cannot fire audio precisely.
- **AudioContext.currentTime master clock + 25 ms/100 ms lookahead loop: recommended** (Wilson, §3.3): audio is sample-accurate and immune to main-thread stalls; the same loop emits torch (lead-shifted) and screen (frame-shifted) events.

Background behavior: **pause broadcast on `visibilitychange → hidden`** — Chrome's live-MediaStreamTrack exemption only limits throttling to the 1 s tier (fatal to a 25 ms tick); iOS Safari additionally suspends AudioContext when backgrounded/screen-locked. Pausing also serves battery/privacy (camera released sooner per scope).

## 5. Recommendation and rationale

1. **WPM steps (F2, U1): keep LEARNER 5 (default) / STANDARD 8 / BRISK 12; hard cap 12 (lowered from 15).** Naval visual-signalling practice brackets exactly these numbers (5 training / 8 operational / ~13 ceiling); at 15 WPM jitter is 41 % of a dot, sustained dots flash at 6.25 Hz, and no practical visual-copy population exists above ~13 WPM. At 12 WPM the minimum Morse element (100 ms intra gap) still exceeds the ~33 ms frame + IPC spacing needed to avoid the rapid-toggle torch-off failure class (W3C #275 / html5-qrcode #634).
2. **Sync tolerance (F5, F6): `SYNC_TOLERANCE_MS = 45`, design target ≤40 ms residual audio↔light offset.** Derived from ITU-R BT.1359 detectability (+45 audio-lead / −125 audio-lag); 40 ms also sits inside EBU R37 (+40/−60) and degrades gracefully toward ATSC IS/191 (+15/−45). Residual offset (not raw latency) is what must fit this window.
3. **Scheduling (F6, F2, F5):** single master clock = `AudioContext.currentTime`; Wilson lookahead loop (25 ms tick, 100 ms schedule-ahead) schedules audio *exactly* at `tMs` (5 ms envelopes to kill clicks, per F5 AC); torch commands are emitted **early by `TORCH_LEAD_MS` = 120** (default constant, range 0–200) so the LED transition lands near `tMs` under the typical ~40–130 ms latency; screen overlay toggles at `tMs` (≈1 frame ≈17 ms lag, within tolerance). Because ON and OFF ride the same pipeline, first-order latency cancels; the lead exists to cancel the *audio↔light offset*, not symbol ratios. Never `await` a torch promise inside the timing path (it resolves early and blocks scheduling); torch-loss → screen takeover stays per F6/F8. **Pause on `visibilitychange → hidden`**, re-anchor on resume.
4. **Calibration posture:** runtime self-calibration is rejected (§4b). The constants (`TORCH_LEAD_MS`) are tuned once via the Q3 real-device script ("did light and beep land together at BRISK?") and shipped as named constants. This keeps F6 mock-clock testable per its AC.

## 6. Tradeoffs, risks, confidence

- **Biggest risk:** the latency spread (§3.1c) is triangulated, not measured on a web stack; a real device could sit anywhere in 40–500 ms. Chosen design degrades gracefully: fixed latency cancels; only slow-HAL outliers (>~165 ms ≈ lead+tolerance) show late light, and that symptom routes to the existing screen-fallback path. Q3 must record actual feel; if the flagship device shows >165 ms perceived lag, raise `TORCH_LEAD_MS` toward 200 before shipping.
- Torch-off reliability bugs (W3C #275 class) are spaced out by ≥100 ms minimum element at all steps; if a device still drops OFFs, that is a *correctness* failure (stuck light), handled by F3 error events → F8 fallback, not by timing.
- BT.1359 is a speech/lip-sync envelope; beep+flash pairs are more forgiving, so 40 ms is conservative — acceptable given zero cost of honoring it.
- BRISK (12 WPM) exceeds the 3 flashes/s guidance during rapid dot sequences (5 Hz); accepted because it is opt-in, preceded by the hazard plate (U1), and `prefers-reduced-motion` users get the reduced path. U1 copy must say "rapid flashing" on BRISK explicitly.
- Confidence: **latency spread — low/medium** (cited triangulation, unverified on-device); **sync tolerance — high** (ITU/ATSC/EBU concordant); **clocking/throttling — high** (W3C/WHATWG/Chrome documented); **WPM bounds — medium/high** (naval practice + arithmetic, capped by the latency unknown).

## 7. Implementation consequences / plan updates

- **F2 (`js/schedule.js`):** WPM steps `LEARNER=5` (default) / `STANDARD=8` / `BRISK=12`; **hard cap 12** (was 15). Flash-frequency guard: sustained-dot rate = WPM/2.4 Hz; assert 5 → 2.08 Hz (<3) at default; flag BRISK as above-threshold (5 Hz) for hazard copy. Min Morse element at cap = 100 ms ≥ torch command spacing floor (~34 ms).
- **F5 (`js/audio.js`):** constant `SYNC_TOLERANCE_MS = 45` (BT.1359-derived); schedule via `AudioContext.currentTime` + 25 ms/100 ms lookahead; tone envelopes ~5 ms.
- **F6 (`js/conductor.js`):** master clock = audio clock; per-boundary event list drives three offset channels — audio `tMs`, screen `tMs`, torch `tMs − TORCH_LEAD_MS (120, 0–200)`; no promise awaits on the hot path; `visibilitychange hidden` → pause + re-anchor on resume; torch-loss takeover unchanged.
- **U1 (`js/copy.js`):** speed labels LEARNER 5 / STANDARD 8 / BRISK 12; BRISK carries explicit rapid-flashing warning; default copy states under-3-flashes-per-second at LEARNER.
- **Q3 script:** add a sync-feel check ("light and beep together?") at BRISK and a stuck-torch check after long broadcasts; results may retune `TORCH_LEAD_MS`.
- **Plan §"Planning-owned decisions":** replace "hard cap 15 WPM" with "hard cap 12 WPM"; note sync tolerance 45 ms / lead 120 ms constants.

## 8. Sources (primary claims each supports)

1. [Chromium `VideoCaptureCamera2.java`](https://chromium.googlesource.com/chromium/src/+/3015459a9bf07f62ab7a8816ff88824568d87c04/media/capture/video/android/java/src/org/chromium/media/VideoCaptureCamera2.java) — torch = `FLASH_MODE_TORCH` re-issued on the live repeating request; no session rebuild; promise ≈ submission time.
2. [SO 43055551 (2017)](https://stackoverflow.com/questions/43055551/android-camera2-settorchmode-too-slow) — native torch ~0.5 s on non-fast-HAL devices; "very fast" otherwise.
3. [SO 31758314 (2015)](https://stackoverflow.com/questions/31758314/android-camera-flashlight-api-too-slow) — up to ~4 s when camera re-opened per toggle (tail case).
4. [Android camera2 capture-sessions docs](https://developer.android.com/media/camera/camera2/capture-sessions-requests) — per-frame settings; "no guarantee" on request-switch latency.
5. [Chromium bug 1246938 (2021)](https://bugs.chromium.org/p/chromium/issues/detail?id=1246938) — torch applyConstraints device-dependent (fine on Pixels, broken elsewhere).
6. [W3C mediacapture-image #275 (2021)](https://github.com/w3c/mediacapture-image/issues/275), [html5-qrcode #634](https://github.com/mebjas/html5-qrcode/issues/634)/[#848](https://github.com/mebjas/html5-qrcode/issues/848) — rapid on/off torch failure class.
7. [MDN applyConstraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/applyConstraints) + [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/) — promise semantics (applied-to-source, not physical).
8. [jproc.ca, Visual Signalling in the RCN](https://www.jproc.ca/rrp/rrp2/visual_lights.html) — 5 WPM training / 8 WPM NATO standard / ~13 WPM typical flashing-light speed.
9. [WCAG 2.2 Understanding SC 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html) — three-flashes-per-second rule and area thresholds.
10. [ITU-R BT.1359(-1) 1998](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1359-0-199802-S!!PDF-E.pdf) (with [EE Times](https://www.eetimes.com/audio-video-synchronization/), [Forasoft](https://www.forasoft.com/learn/audio-for-video/articles-audio/lip-sync-itu-r-bt-1359-tolerance-windows)) — detectability +45/−125 ms, acceptability +90/−185 ms.
11. [ATSC IS/191](https://www.tvtechnology.com/opinions/atsc-recommends-av-sync-rules) via TV Tech/EE Times; [EBU R37-2007](https://en.wikipedia.org/wiki/Audio-to-video_synchronization) — stricter production envelopes.
12. [Chris Wilson, A Tale of Two Clocks (2013)](https://web.dev/audio-scheduling) — audio-clock lookahead scheduling; 25 ms/100 ms; ~50 ms timer skew; 50 ms OS audio-buffer spread.
13. [WHATWG HTML §Timers](https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#timers) — no on-time guarantee, 4 ms nesting clamp.
14. [Chrome 88 timer throttling (2021)](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/) — intensive throttling 1/min; audio-30 s and live-MediaStreamTrack exemptions (1 s tier).
15. [Flicker fusion review, PMC 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8537539/) — eye's flash resolution (~48–60 Hz) is not the visual-Morse bottleneck.
