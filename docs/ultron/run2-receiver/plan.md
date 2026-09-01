# Plan — Run 2: The Receiver

Source briefs: `docs/ultron/run2-receiver/town-hall.md` (approved 2026-09-01) + `docs/ultron/run2-receiver/design-brief.md` ("The Register Listens", approved 2026-09-01). Lanes structured from the hero-claims table. Standing rule (Ant-Man): every task's acceptance includes a non-goal review — no relay, no share-received-as-link, no history, no persistence, no new dependencies, and the v1 broadcast journey stays byte-identical.

## Lanes and tasks

### F-lane — decode logic (Iron Man / Professor X; DOM-free, unit-testable)

**F1 — Decoder core** — `js/decoder.js` — **Status: completed 2026-09-01** (13/13; suite 507/507; evidence: production-log T-F1)
- Outcome: pure streaming decoder — feed timestamped light on/off edges, get decoded events (letters, words, flagged unknowns).
- Scope: duration→symbol classification against an inferred dot unit (injected or self-learned); symbol strings → letters via a reverse of `MORSE` (built from `js/morse.js`, never redeclared); unknown patterns flagged like translate() flags unknown chars; incremental API (no whole-message buffering assumptions).
- Inputs: town-hall decode contract; morse.js map. Output: decoder module + `test/decoder.test.mjs`.
- Deps: none. Parallel with W1, U1 prep.
- Acceptance: every ITU character round-trips from `schedule()`-generated durations at LEARNER/STANDARD/BRISK with a known dot unit; jitter corpus (±1 frame quantization at 30/60 fps); unknown-pattern flagging; DOM-free source scan; full suite green.
- Validation: `node --test 'test/*.test.mjs'`. Size: medium.
- Research: tolerance values (R3).

**F2 — Zero-coordination clock recovery** — `js/decoder.js` — **Status: completed 2026-09-01** (7 tests; suite 534/534; evidence: production-log T-F2)
- Outcome: the dot unit inferred from observed durations alone — no speed hint.
- Scope: streaming estimator (ratio-cluster/median over a mark-gap window), re-estimation as evidence accumulates, early-letter bootstrap behavior, confidence output for F3's noise classification.
- Deps: F1. Acceptance: schedules for all 3 WPM steps decode with no hint, cold start from the first mark; jitter + mid-stream join corpora; estimator converges before letter 2 on clean input (target, tune with R3).
- Validation: unit tests as above. Size: medium (the novel algorithm).

**F3 — Session semantics** — `js/receive-session.js` (separate module, per the planning decision) — **Status: completed 2026-09-01** (9 tests; suite 543/543; evidence: production-log T-F3)
- Outcome: the receive brain — silence tracking, auto-complete, partial detection, noise classification.
- Scope: `SILENCE_AUTO_COMPLETE_MS = 5_000` committed at the research gate (D10, 2026-09-01; ≈3× the longest scheduled gap — 7 units at LEARNER ≈ 1.68 s; derivation pinned in code comments from schedule.js constants, single source); partial = session saw light before a clean letter boundary (mid-stream join) or ended with unresolved marks; noise = light edges present but unit classification confidence below floor; emits session events for S1 (HEARING / SILENCE / NOISE / COMPLETE / PARTIAL).
- Deps: F1, F2. Acceptance: fake-clock tests — auto-complete never fires inside any scheduled message at any step (sweep); partial flagged honestly; noise distinct from silence. Size: medium.

### W-lane — camera watcher (Iron Man / Thor; the ONLY module allowed frame access)

**W1 — Watcher module** — `js/watcher.js` — **Status: completed 2026-09-01** (20 tests; privacy re-scope landed; suite 527/527; evidence: production-log T-W1)
- Outcome: the instrument's eye — camera to timestamped light edges.
- Scope: gesture-gated `getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false})` (host passes the gesture, v1 torch.js pattern); preview `<video>` sink (host-owned element); sampling loop on `requestVideoFrameCallback` with rAF fallback (R1 decides default posture); downsampled sampling canvas (single small canvas, `getImageData` on the downsampled region only — sanctioned forms, nothing else); luminance metric + adaptive threshold with ambient rejection; edge events with `performance.now()` timestamps; injectable clock/port; `release()` kill switch (track.stop, canvas cleared, zero retained pixels — the aperture goes dark, never a frozen frame); track-ended/rejection → `lost` event; visibilitychange port for background release.
- Deps: none (parallel with F-lane). Files: `js/watcher.js` + `test/watcher.test.mjs` (fake gUM/video/frame stubs, dependency-free, v1 torch.test.mjs pattern).
- Acceptance: full stub matrix (grant/deny/insecure/busy/lost/release); edges exact under a synthetic luminance script; zero unsanctioned frame tokens (source scan); preview sink is the only stream consumer; battery-relevant behavior: sampling pauses with the visibility port.
- Size: medium-large (split-required if the threshold strategy exceeds one session — then threshold becomes W1b). Research: R1 sampling, R2 exposure.

### S-lane — machine + mode (Iron Man / Hulk)

**S1 — Receive state machine** — `js/states.js` (additive) — **Status: completed 2026-09-01** (11 tests; suite 554/554; evidence: production-log T-S1; S2 implementation merges into I2 — sequencing adjustment recorded)
- Outcome: the receive journey as an explicit machine, broadcast rows untouched.
- Scope: `createReceiveMachine()` sharing states.js dispatch/emitter discipline; states: receive-idle, receive-arming, receive-denied, receive-unsupported, receive-armed, receiving, receive-done (complete|partial recorded), receive-error; events: REQUEST_RECEIVE, permission outcomes, HEARING/SILENCE/NOISE (from F3), STOP, AUTO_COMPLETE, CAMERA_LOST, RESET; effects: `release-camera` on every exit that still holds the eye; known-event-wrong-state soft rejection; unknown event TypeError (v1 laws).
- Deps: F3 event vocabulary (contract first — can start against a frozen event-name list). Acceptance: journey table tests incl. every dead-end recovery; exhaustive event×state probes (v1 441-cell pattern); **broadcast TRANSITIONS table byte-identical** (test-pinned). Size: medium.

**S2 — Mode architecture** — `js/app.js` — **Status: completed 2026-09-01 inside T-I2** (sequencing adjustment recorded at T-S1; E2E-verified: freeze, release, hash untouched)
- Outcome: the BROADCAST/RECEIVE lever as app-shell state.
- Scope: mode state + radio-driven lever (v1 speed-detent grammar); frozen through committed runs of either mode (v1 speed-freeze grammar); leaving receive dispatches STOP + camera release; entering receive never touches broadcast state; hash untouched by receive.
- Deps: S1. Acceptance: lever freeze tests (source-invariant + behavioral, v1 speed-freeze pattern); mode-switch camera-release verified; broadcast journey regression green. Size: small.

### U-lane — copy (Captain America voice + Hulk lines)

**U1 — Receive copy pack** — `js/copy.js` (additive) — **Status: completed 2026-09-01** (suite 558/558; evidence: production-log T-U1)
- Outcome: every receive string in the one frozen data-only module, register voice.
- Scope: meter lines (HEARING LIGHT / HEARING NOTHING / NOISE + actionable variants), why-camera receive plate (watching light levels; live view; nothing recorded, nothing sent; the eye closes when you stop), denied/unsupported/busy lines, arming/done/partial/complete lines, COPY outcomes, STOP label; numbers derived from schedule.js constants (silence threshold included); register-voice guards extended to the new set (no exclamation, ≤120 chars, machine plate).
- Deps: S1 (state list), F3 (semantics). Acceptance: completeness enumerated against live states.js/decoder exports (v1 pattern — a new state cannot ship copyless); voice-law tests; no new dependencies. Size: medium.

### I-lane — the surface (The Register Listens)

**I1 — Receive surface, static snapshots** — `index.html` + `css/main.css` — **Status: completed 2026-09-01** (14 states × 4 viewports CDP-verified; 2 vision-found defects fixed; evidence: production-log T-I1)
- Outcome: every receive state as a complete static `body[data-state]` rendering, v1 I1 discipline.
- Scope: mode lever markup; the aperture (metal-framed inset window — head-cap metal family, dark when released); station meter line; the tape in receive mode (blank paper, punch geometry reused verbatim); transport row as STOP + COPY; why-camera receive plate; composer bay dark; all strings from copy.js only.
- Deps: U1, S1. Acceptance: every receive state renders legibly at 320/360/390/768/1280 (`scrollWidth === clientWidth === viewport`); copy provenance verbatim; v1 broadcast snapshots byte-identical; aperture ≤ the WCAG small-area fraction at every width; reduced-motion flattening; focus/keyboard grammar intact. Validation: CDP measurement rig + captures (v1 pattern). Size: medium-large.

**I2 — Live wiring** — `js/app.js` (additive) — **Status: completed 2026-09-01** (fake-camera E2E 13/13 × 3 steps; suite 558/558; evidence: production-log T-I2)
- Outcome: light in, text out — the demo works on synthetic light.
- Scope: REQUEST_RECEIVE in-gesture → why-camera plate → acquire camera (W1) → machine events; watcher edges → F1/F2/F3 → tape punches (live ink, letter prints + settles to spoken), station text stream, per-heard-flash lamp fire, meter truth; per-word polite announcements (letters settle silently); auto-complete/manual STOP → done; COPY (clipboard + execCommand fallback); partial void gap where listening began; aperture dark on release; backgrounding → pause + release; visibility resume does not auto-restart (user intent, v1 law).
- Deps: I1, W1, F1–F3, S1, S2. Acceptance: full synthetic-light journeys (Q1 rig) — grant/deny/noise/partial/stop/background/copy; zero gUM outside the receive gesture; zero console/storage; broadcast regression green. Size: large (split into I2a journey / I2b tape+announcements if needed).

**I3 — Motion + capability layers** — `css/main.css` + `js/app.js` — **Status: completed 2026-09-01** (incremental tape DOM; 2 timing/render defects found+fixed; 3× E2E stability; evidence: production-log T-I3)
- Outcome: the receive surface moves like the machine.
- Scope: punch-seat + print-snap on heard events (existing curves, ≤200 ms, single-iteration); lamp fire alternation; reduced-motion + cap-low flattening with information parity (meter text carries the truth); no loops; aperture never animates its content (it is a live picture).
- Deps: I2. Acceptance: computed-motion audits mid-receive (v1 I3 pattern); parity checks; overflow sweep re-run. Size: medium.

### Q-lane — proof (Hawkeye / Daredevil / Captain America)

**Q1 — Synthetic-light E2E rig** — **Status: completed 2026-09-01** (E2E green at all 3 WPM steps; evidence: production-log T-Q1+T-Q2)
- Outcome: the self-consistency contract proven — what this app sends, this app receives.
- Scope: fake camera fed by `schedule()`-driven luminance flashes (frame-injection stub for unit level; canvas `captureStream` fake-camera for the CDP journey level); decode === original at all 3 WPM steps both timing shapes (torch lead-shifted, screen exact); journey battery; broadcast journey regression in the same rig.
- Deps: I2. Acceptance: rig green; suite counts reconciled; rig in /tmp, zero repo residue (v1 pattern). Size: medium.

**Q2 — Privacy re-scope audit** — `test/privacy-scan.test.mjs` — **Status: completed 2026-09-01** (re-scope at T-W1; mutation checks + runtime release matrix 19/19; evidence: production-log T-Q1+T-Q2)
- Outcome: the re-scoped law pinned and mutation-checked.
- Scope: allowlist = sanctioned downsample forms in `js/watcher.js` only; every other frame token still banned repo-wide incl. comments (v1 token list + drawImage/ImageData/canvas beyond watcher); zero `MediaRecorder`/`toDataURL`/capture surfaces; zero storage/network; camera released on stop, mode-switch, background, done — rig-verified counts; why-camera plate before prompt, gUM-inside-gesture re-verified for receive.
- Deps: W1, I2. Acceptance: mutation checks non-vacuous (planted token fails, removed allowlist entry fails); runtime release-count checks. Size: medium.

**Q4 — Receive a11y pass** — **Status: completed 2026-09-01** (11/11; found+fixed the unrendered-plate-keys I1 bug and the per-letter cadence defect; evidence: production-log T-Q4)
- Outcome: receiving works without watching the picture.
- Scope: meter textual truth announcements; per-word cadence verified (no per-letter chatter — MutationObserver evidence, v1 refinement-#2 pattern); keyboard-only receive journey; aperture photosafety measurement (size fraction + flash rate at BRISK); contrast of new elements against tokens; aria-live scopes.
- Deps: I2, I3. Acceptance: audit checklist with evidence captures; any finding fixed in-scope. Size: medium.

**Q3 — DEVICE-TEST extension** (handover, docs-only) — **Status: completed 2026-09-01** (handover delivered; results user-owned)
- Outcome: the two-phone script for the user's hardware.
- Scope: extend `docs/DEVICE-TEST.md` — sender/receiver pair matrix (Android torch → any camera; iPhone screen → Android camera), dark-room + lit-room (AE) passes, all 3 WPM steps, partial-join check, backgrounding, camera-release confirmation; objective/subjective tagging; results table for the T-Q3-run2 entry.
- Deps: all code tasks complete. Acceptance: verbatim-runnable commands re-verified (v1 Q3 lesson: no invented npm packages); cross-referenced acceptance criteria. Size: small-medium.

## Dependency-ordered task index

| # | Task | Deps | Parallel with | Size |
|---|---|---|---|---|
| 1 | F1 decoder core | — | W1 | medium |
| 2 | W1 watcher module | — | F1 | med-large |
| 3 | F2 clock recovery | F1 | W1 | medium |
| 4 | F3 session semantics | F1,F2 | W1 | medium |
| 5 | S1 receive machine | F3 (event contract) | — | medium |
| 6 | U1 receive copy pack | S1,F3 | — | medium |
| 7 | S2 mode architecture | S1 | U1 | small |
| 8 | I1 receive surface (static) | S1,U1 | S2 | med-large |
| 9 | I2 live wiring | I1,W1,F1–F3,S1,S2 | — | large |
| 10 | I3 motion + capability layers | I2 | — | medium |
| 11 | Q1 synthetic-light E2E rig | I2 | I3 | medium |
| 12 | Q2 privacy re-scope audit | W1,I2 | I3,Q1 | medium |
| 13 | Q4 receive a11y pass | I2,I3 | Q2 | medium |
| 14 | Q3 device-test extension | all above | — | small-med |

## Milestones

- **M1 — The ear works** (F1, F2, F3): our own schedules decode pure, zero-coordination. Exposes the decoding assumptions before any UI exists.
- **M2 — The machine is ready** (W1, S1, U1, S2): eyes, brain wiring contract, states, copy — everything I-lane consumes.
- **M3 — The register listens** (I1, I2, I3, Q1): the demo works end-to-end on synthetic light in a browser.
- **M4 — Proven and handed over** (Q2, Q4, Q3): privacy pinned, a11y passed, device script delivered; run-2 finishing follows.

## Research decisions (2026-09-01 — records at `docs/ultron/run2-receiver/research/`, decision matrix in `summary.md`)

- **W1** implements D1–D5: rVFC primary (feature-checked, Baseline 2024) + rAF fallback discipline; 32×32 sampling canvas, `willReadFrequently`, Rec.601 integer luma, brightest-tile ROI; midpoint edge stamping via `expectedDisplayTime`, `presentedFrames` drop detection, `{frameRate:{ideal:60,min:24}}`; rolling P25/P95 dual-threshold hysteresis + contrast gate + 2-frame confirmation + median-of-3; continuous-AE adaptive-threshold core with silent capability-gated exposure strategy on Chromium (reset on release/pagehide) — user-facing lock controls deferred.
- **F1** implements D7 boundaries (dot <2û, dash 2–6û, anomaly ≥6û; gaps <2û / 2–5û / ≥5û).
- **F2** implements D6 (validated-pair estimator + weighted MA 20–30 + 0.6–6× windows + 15% snap / 20% drift reopen).
- **F3** implements D8 mid-join rules (the partial detector) + D9 noise triad (silence/noise/valid gates: ≥5–6 marks, ≥1 validated pair, ~75% coherence, invalid-Morse confidence) + D10 silence constant **committed at 5 s** (≈3× the longest scheduled gap 1.68 s — gate decision 2026-09-01, supersedes the 10 s draft; derivation pinned in code from schedule.js constants).
- **U1** carries the engine-honest guidance copy (Safari/Firefox: distance/off-axis/meter) + clipping warning ("saturated — move back").

## Handoff to deep-research

**Fixed by scope (not researchable):** same-page toggle; auto-detect with zero coordination (no manual override in MVP); live text + COPY only; auto-complete + manual STOP; strict privacy confinement; sender contract = this app's channels; static no-dependency stack; The Register Listens direction.

**Research queue (answerable questions, tied to tasks):**
- **R1 (→ W1):** Sampling design — rVFC support matrix incl. Firefox; rAF fallback behavior; sampling canvas size/fps vs luminance-metric stability; edge timestamp precision at 30/60 fps against 100 ms BRISK dots (interpolation needs); adaptive threshold + ambient rejection strategy; torch PWM aliasing risk at common camera fps.
- **R2 (→ W1, provisional criteria 9–10):** Auto-exposure — how fast AE/AWB adapts to a torch entering the frame on major phone browsers; exposure/exposureMode/ISO constraint support matrix via applyConstraints; saturation-at-close-range behavior; recommended default posture (lock vs continuous) with evidence.
- **R3 (→ F2/F3):** Clock recovery + tolerances — adaptive Morse decoding precedents; unit-classification tolerance values robust to ±1-frame quantization; silence threshold derivation check; noise-vs-signal classification heuristics.

**Assumptions that return to Town Hall if broken:** ~30 fps sampling resolves 12 WPM (else the BRISK receive contract changes); exposure is manageable in typical dim rooms (else provisional criteria change); no new dependencies needed for any of the above.

**Approval needed before research begins:** this plan.
