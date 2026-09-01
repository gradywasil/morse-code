# R3 — Clock Recovery + Timing Tolerances (F1, F2, F3)

Sponsor: Professor X (domain accuracy). Dispatched as a general-purpose subagent 2026-09-01. Baseline: ITU-R M.1677-1 (1/3/1/3/7 units; 1200/WPM ms per dot → 240/150/100 at our three steps).

## Q1 — Prior art (verified from sources)

- **morse-pro** (browser JS, powers morsecode.world adaptive decoder; EUPL-1.2): thresholds at ITU midpoints (2× dit; 5× fdit for word); per-character samples into a 30-sample buffer smoothed by a linearly-weighted MA (newer heavier); optional lockSpeed; sub-noise blips merged. Weakness: cold start needs a WPM guess. https://github.com/scp93ch/morse-pro
- **OZ1JHM Arduino family**: exponential dit average (⅓ new / ⅔ old); acceptance windows dot 0.6–2×, dash 2–6×, letter gap 2–5×, word ≥5×; forced flush after silence > 6× last key-down. http://oz1jhm.dk/content/very-simpel-cw-decoder-easy-build
- **fldigi** (`src/cw_rtty/cw.cxx`): speed updates only on a **validated dot–dash pair** (`2×last < new < 4×last`) with hard plausibility bounds, then a moving average; spike rejection (tones < dot/2); buffer-overflow = noise. https://github.com/w1hkj/fldigi
- **K4ICY**: geometric-mean pair discriminator √(short·long); cold lock 2–20 characters; one-character re-lock snap. https://www.k4icy.com/cw_decoder.html
- HMM/Bayesian (CW Skimmer, academic HMM write-ups) — robust end of the spectrum, overkill for quantized machine light; motivates deferred/soft classification.

**→ D6:** combine fldigi's validated-pair gate + morse-pro's weighted MA (window 20–30) + OZ1JHM's 0.6–6× acceptance windows. Snap to a hypothesis when two consecutive validated estimates agree within 15% (û set {240,150,100} well separated, ratios 1.5–1.6); keep a light tracking loop that reopens on >20% drift for 2+ pairs; never hard-lock (morse-pro keeps lockSpeed optional for a reason).

## Q2 — Tolerances → D7

Established boundaries: dot/dash at 2× unit and word gap at 5× unit (morse-pro, OZ1JHM) or 4× (fldigi). The ±33–40% folklore maps exactly onto these. Quantization math at 30 fps: 5 WPM ~6-frame slack everywhere; 8 WPM ≥3.5 frames; 12 WPM ≥1 frame (tightest: symbol/letter gap boundary) — safe for machine-timed senders.

**→ D7:** marks: dot `<2û`, dash `2–6û`, `≥6û` = anomaly (never fed to the estimator). Gaps: symbol `<2û`, letter `2–5û`, word `≥5û` (machine-sent code favors 5× over fldigi's 4×). Classification uses the current estimate + the fldigi pair-ratio gate before any estimator update; optional 1-mark-lookahead nearest-quantum assignment (û/3û/7û) where deferring commit is cheap.

## Q3 — Bootstrap + mid-join → D8

Mid-join rules (structural): the leading gap is never measurable — discard unconditionally. If the session's first edge is ON→OFF (light already on at subscribe), the first mark is truncated — **discard it and the following gap** (this is the partial-session detector).

Cold start: primary = first validated dot–dash pair (û = (short + long/3)/2, typically within 1–3 letters); fallback after 6–8 marks = cluster-split sorted durations at the largest inter-value ratio, lower cluster's median. Then D6's snap rule.

## Q4 — Noise heuristics → D9

Three states: **silence** = no edges. **Noise/interference** = solid light; or marks persistently outside 0.5–6×û; or coherence <~75% (marks within ±1 frame of û/3û); or high invalid-Morse rate (morse-pro's '#' signal). **Valid** requires ≥5–6 marks and ≥1 validated pair before any text commits; sub-dit flicker (1-frame blips at 12 WPM) merged/dropped (also the sampling-glitch defense); confidence reported as the share of elements consistent with the dominant speed hypothesis, text surfaces only above ~80%.

## Q5 — Silence threshold sanity → D10

Longest scheduled gap 1.68 s (5 WPM). 10 s ≈ 6× that (~14× at 12 WPM). Prior-art anchors: OZ1JHM flushes a character after >6× last key-down (within-stream); human between-overs pauses ~1–3 s, 5+ s signals exchange over (informal practice, no standard). **Both 10 s and 5 s are sane** — 5 s ≈ 3× the safest gap with slack, snappier for the demo's COPY unlock. Decision offered at the gate (D10).

## Farnsworth note

Our senders never stretch gaps (fixed 1/3/1/3/7, no Farnsworth) — the gap-boundary mis-split risk documented in morse-pro does not apply to the run-2 compatibility contract; recorded in case hand-flashlight best-effort reception ever returns to scope.

## Open uncertainties

Camera integration time can systematically lengthen detected ON durations (the ±33 ms model assumes uniform edge phase) — pinned by a synthetic-jitter corpus in F1/F2 tests and checked on device in Q3-run2. MA window size and the 15%/20% snap/drift constants are engineering judgment (medium confidence) — tuned in F2's test corpus, not at runtime.
