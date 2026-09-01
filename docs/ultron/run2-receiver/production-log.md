# Run-2 Production Log

Created 2026-09-01 at production start. Plan: `docs/ultron/run2-receiver/plan.md` (task index = source of truth). Research decisions D1–D10 committed and folded into the plan.

**Gate discipline (user-settled at the Town Hall gate, 2026-09-01):** phase-level user gates — design/plan/research/production/finishing each pause for explicit user review. Within production, every task is verified against its acceptance criteria before the next starts, evidence lands here, and repeated verification failure or any scope change halts immediately for the user. This deliberately replaces the production skill's default per-task user gate (deviation recorded here at production open).

**Delegation policy:** research tracks used parallel subagents (see research/summary.md). Production code tasks are executed directly by the production master when research-context fidelity and context economy favor it (recorded per task); subagents are dispatched for independently scoped work.

---

## T-F1 — Decoder core [Iron Man · Professor X]

**Status:** completed 2026-09-01 (verified against acceptance criteria below; phase-gate run — see gate discipline note).

**Built:** `js/decoder.js` (new, DOM-free, 205 lines) + `test/decoder.test.mjs` (new, 13 tests). Executed directly by the production master (research-context fidelity — D7 boundaries, morse.js integration shapes; delegation declined for context economy, recorded here).

- `REVERSE_MORSE` built from `MORSE` (never redeclared), frozen; `CLASSIFY` frozen constants (D7: dot <2û, dash 2–6û, anomaly ≥6û; gaps symbol <2û / letter 2–5û / word ≥5û — long silences stay word gaps; duration semantics belong to F3).
- `classifyMark`/`classifyGap` pure functions with exact ITU-midpoint boundaries; `createDecoder({unitMs, onEvent})` streaming session — unitMs number OR provider function resolved per classification (F2's clock-recovery socket), anomaly marks void the pending letter, unknown patterns flagged (`known:false, char:null, code`), `flush()` for end-of-stream, per-instance state only.
- **Documented ITU ambiguity:** `.` and `+` share `.-.-.`; a received shared code decodes to the table's last entry with `known:true` — honest receive-side mirror of v1's send-side unknown flagging.

**Validation:** `node --test test/decoder.test.mjs` 13/13; full suite `npm test` **507/507 exit 0** (494 v1 tests unchanged + 13 new). Coverage: reverse-map completeness (54 entries, frozen, independent rebuild); every ITU character round-trips from `schedule()` durations at all 3 steps; multi-word messages; trailing-mark flush; seeded jitter corpus (±1 frame 33.3 ms independently per duration, 3 messages × 3 steps × 50 trials); exact boundary asserts at 2û/6û/5û; anomaly + unknown flagging; word-gap space events; instance purity; TypeError discipline; DOM-free source scan.

**Deviations:** none from plan. One honest finding: the `.`/`+` ITU code collision is real and test-pinned (not a defect — grammar limitation, documented in the module header for U1's copy and I2's tape rendering).

**Next:** W1 watcher module (parallel-lane start per plan).

---

## T-W1 — Watcher module [Iron Man · Thor · Captain America]

**Status:** completed 2026-09-01.

**Built:** `js/watcher.js` (new, ~470 lines) + `test/watcher.test.mjs` (new, 20 tests) + the approved privacy-scan re-scope in `test/privacy-scan.test.mjs` (landed here rather than Q2 so the suite stays green with the watcher present — Q2 keeps the mutation checks + runtime release audit).

- D1: rVFC primary (feature-check on the video element) with a generation counter for loop cancellation; rAF fallback deduping on `video.currentTime`, clock-stamped.
- D2: single 32×32 sampling canvas (`willReadFrequently`, width/height pinned to SAMPLE_GRID), Rec.601 integer luma (77/150/29 >>8), ROI = brightest 4×4-px tile mean of the grid.
- D3: edge stamps = midpoint between the last old-state frame and the FIRST new-state frame, computed at candidate creation (not stretched to the confirming frame); `expectedDisplayTime` as frame time; `presentedFrames` deltas → cumulative count + per-edge `dropped` flag; gUM `frameRate {ideal:60, min:24}` (never exact).
- D4: rolling P25 window for the OFF level; **ON level = decaying peak tracker (`ON_LEVEL_DECAY=0.97`) — implementation deviation from the literal rolling-P95, recorded below**; dual-threshold hysteresis (0.6/0.35 of range), contrast gate ≥20, 2-consecutive-frame confirmation, median-of-3 on the hysteresized series (single-frame spike test pins the PWM/beat defense).
- D5: capability-gated silent exposure posture after 500 ms (manual mode + `EXPOSURE_LOCK_FRACTION=0.1` of the advertised range, else negative-EV nudge, else nothing); reset recipe applied on stop; pagehide safety stop; all constraint failures swallowed by design.
- Kill switch: `stop()` = timers cleared, listener detached, exposure reset, tracks stopped, `srcObject=null` (eye closes, never a frozen frame), canvas wiped, every pipeline buffer reset; re-acquire on the same instance starts clean (pinned).
- Outcomes matrix: permission-denied / no-camera / busy / insecure (zero gUM) / failed; `lost` on track `ended`; DOM-style addEventListener emitter (torch.js discipline).

**Validation:** `node --test test/watcher.test.mjs` 20/20; full suite `npm test` **527/527 exit 0** (v1 494 + F1 13 + W1 20; privacy-scan 8 re-scoped, still 8). Coverage: exact gUM constraints deep-equal; sink attach/muted/playsInline; error matrix; insecure pre-gUM gate; midpoint hand-computed; spike rejection; contrast gate; ROI brightest-tile; clipping/saturation; dropped-frame flag; rAF fallback (dedupe + clock stamps + edge through the fallback path); stop/reset/re-acquire; exposure postures (manual lock target arithmetic, EV nudge, zero calls with no caps); lost; pagehide; time-travel no-op; TypeErrors; sanctioned-forms source scan; DOM references only through injected `doc`/lazy globals.

**Deviations (task-level, outcome preserved — recorded per change control):**
1. **ON-level estimator: decaying peak (0.97/frame) instead of rolling P95.** Rolling-P95 onset math: a 1.5 s window of dark history needs ~4 lit frames before the gate opens — at BRISK a dot IS 3 frames, so dots would measure ~0 ms. The peak tracker lifts contrast on the first lit frame and decays slowly enough (~50%/23 frames) to keep ambient adaptation. D4's intent (rolling baseline + robust thresholds) preserved; pinned by tests; Q1's synthetic E2E re-proves end-to-end.
2. **Privacy-scan re-scope pulled forward from Q2** (suite-green sequencing); the re-scoped law is exactly the approved one: frame tokens confined to watcher, sanctioned downsampled forms pinned by exact-source asserts, export/encode/record/capture surfaces banned everywhere, bare `VideoFrame`-outside-rVFC check.

**Next:** F2 zero-coordination clock recovery.

---

## T-F2 — Clock recovery [Professor X / Iron Man]

**Status:** completed 2026-09-01.

**Built:** `createClockTracker()` + `TRACKER` constants in `js/decoder.js` (D6 composite: fldigi validated-pair gate, morse-pro weighted MA span 25, OZ1JHM 0.6–6× band, snap 15%, drift reopen 20%×2, cluster fallback at 7 marks, `LOCKED_MIN_MARKS: 5`). Decoder emission contract grew an additive `{type:'gap', gap, ms}` event so the tracker samples gaps by classification (symbol = 1û, letter = û/3, word never). Tests: +7 in `test/decoder.test.mjs`.

**Validation:** decoder suite 20/20; full `npm test` **534/534 exit 0** (527 + 7). Coverage: safe default unit before evidence; zero-coordination decode + convergence ≤15% + locked at all 3 steps (no jitter); jitter corpus (±1 frame × 3 messages × 3 steps × 40 trials) — letter-perfect tails + locked everywhere (cold-start soup before lock is the documented prior-art cost; D9/F3 owns suppression); cluster fallback (7 equal marks → one-cluster median); pair-gate rejection; drift reopen after a sender switch (LEARNER→BRISK: head intact, tail letter-perfect, re-lock ≤20%); TypeError discipline.

**Findings fixed during verification (all test-pinned):**
1. Gap samples derived from classifications ride the DEFAULT unit before convergence → poisoned the estimate (pair-gate test caught estimate 100 from a 300 ms letter gap). Fix: gap samples only after mark-based bootstrap (`estimate !== null`).
2. Pair acceptance relative to the current estimate (0.6–6×) blocked exactly the drift evidence needed to re-lock a sender switch. Fix: absolute plausitude bounds `PAIR_ABS_MIN/MAX_MS = 40/500` (≈2.4–30 WPM) — validated pairs are strong evidence by design.
3. `snapped` (pair agreement) is not a usable session gate: SOS contains no dot/dash adjacency — zero pairs, perfect decode via cluster fallback. Public gate is now `locked` (estimate + ≥5 marks); drift reopen triggers on any locked tracker, not only snapped ones ("HI" is all dots — locked but never snapped — which is how finding 2's test failed originally).

**Next:** F3 session semantics.

---

## T-F3 — Session semantics [Hulk · Professor X]

**Status:** completed 2026-09-01. **Milestone M1 (the ear works) reached.**

**Built:** `js/receive-session.js` (new, DOM-free) + `test/receive-session.test.mjs` (9 tests). The composition root wiring decoder + clock tracker + session truth:
- D8 mid-join: light-on-at-begin discards the truncated mark + following gap, flags PARTIAL with the void reason (pinned: O→M degradation, K survives, nothing fabricated).
- D9 text gate: letters surface only when LOCKED = tracker estimate + ≥5 marks + coherence ≥0.75 (marks within ±1 frame of û/3û — the r3 70–80% band). At lock, buffered periods REPLAY through a fresh decoder and the session SWAPS to it (recovered letters `replay:true`, pending symbol carries, no double-emission — the swap fix for the HEALLO double-count). Never-locked sessions get one forced cluster bootstrap at completion (short all-dot messages like HI never pair).
- D9 meter triad: silence / noise (≥8 marks, no coherent unit — incoherent corpus stays NOISE, structured-junk that is accidentally 70% coherent now fails the 0.75 gate) / decoding.
- D10: SILENCE_AUTO_COMPLETE_MS = 5000 with the derivation pinned (7 units at LEARNER = 1680 ms; ≥2.9×). Auto-complete fires exactly at threshold (holds at threshold−1) and never inside any scheduled message at any step. Silence-complete treats the trailing quiet as the final letter gap (flush into text, not PARTIAL); manual stop mid-symbol drops the pending symbol — prefix-honest void (pinned: 'SOS' cut → 'S' + partial, never a fabricated letter).

**Validation:** 9/9; full `npm test` **543/543 exit 0** (534 + 9). Coverage: exact text at all 3 steps through the full session pipeline; forced-bootstrap short message; mid-join; auto-complete sweep (3 steps × holding/completing); stop prefix-honesty; meter triad; TypeError discipline; DOM-free scan.

**Deviations (task-level, outcome preserved):** coherence gate added at 0.75 (r3's band, judgment mid-point); replay-SWAP architecture (the naive replay-then-continue double-emitted letters); forced end-of-session bootstrap (short messages); silence-vs-stop flush asymmetry (the honest reading of D10 + "finalizes whatever was heard").

**Next:** S1 receive state machine (extend js/states.js additively; broadcast TRANSITIONS byte-identical).

---

## T-S1 — Receive state machine [Hulk · Iron Man]

**Status:** completed 2026-09-01. Suite **554/554** (543 + 11).

**Built:** `createReceiveMachine()` + `RECEIVE_STATES/EVENTS/EFFECTS/TRANSITIONS/STATE_LIST` appended additively to `js/states.js` (9 states, 12 events, 2 effects; same dispatch/emitter discipline as v1 — soft rejects, TypeError on unknown events, frozen tables). `test/receive-states.test.mjs` (11 tests): happy journey with effects, why-camera-before-camera, denied/unsupported with retry+reset, honest stop-from-armed partial record, camera-lost → error with release effect, table-BFS no-dead-ends ≤3 hops, exhaustive event×state soft-reject probes, unknown-event TypeError, frozen tables, additive-only broadcast pin (15 states, journey intact — the v1 states suite stays green as the byte-identical guarantee).

**Fixes during verification:** RESET rows added to armed/active (direct exit for S2 mode switching, release-camera effect); context phase-scoped (entering idle wipes outcome/done/error — v1 law); RECEIVE_TRANSITIONS exported for table-driven tests (v1 parity).

**Sequencing adjustment (task-level, outcome preserved):** S2's mode-lever behavior requires I1's markup; S2 implementation lands within I2 with its acceptance verified there (lever freeze, mode-switch camera release, hash untouched). Recorded here and in the plan.

**Next:** U1 receive copy pack, then I1 static surface, then I2 wiring (incl. S2).

## T-U1 — Receive copy pack [Captain America voice + Hulk lines]

**Status:** completed 2026-09-01. Suite **558/558** (554 + 4 new copy tests).

**Built:** `COPY.receive` additive section in `js/copy.js` + `meterLine()` helper: mode lever labels; the receive why-camera plate (honest facts verbatim — nothing recorded, nothing sent, the eye closes on stop); all 9 receive states `{legend, line}` keyed by RECEIVE_STATES values; meter lines for all METER values + actionable hints (aim/closer/dim; step back/block glare) + the saturated warning (D5's honest per-engine guidance); partial/done-partial/quiet-closed lines with the auto-complete seconds DERIVED from SILENCE_AUTO_COMPLETE_MS (never re-typed); transport (STOP LISTENING / COPY MESSAGE / outcomes). Tests: completeness enumerated against live RECEIVE_STATE_LIST + METER exports (a new state/meter cannot ship copyless — v1 pattern); derived-number pin; register-voice laws over every new string (no exclamations, ≤120, no apology); verbatim honesty facts.

**Next:** I1 receive surface (static snapshots) — the heaviest UI task; S2's mode architecture lands in I2.

## T-I1 — Receive surface, static snapshots [the Register Listens]

**Status:** completed 2026-09-01. Suite **558/558** (unchanged — additive markup/CSS only, plus the live-region law extended to the 9 receive lines: 15+9=24 state lines, all inheriting the polite station, none overriding).

**Built:** `index.html` (+~90 lines additive): the mode lever (radio pair, BROADCAST/RECEIVE, v1 speed-detent grammar); the eye bay — aperture (metal-framed `data-rx-camera` shutter + the sanctioned `<video id="preview">` sink) + the meter (three `data-meter-line` variants + hints + saturated/partial notes); 9 receive station lines (`data-receive-line`); the received-record tape strip (static partial "DARK ROOM", spoken/live inks, hand-computed punch geometry per v1's px laws); receive why-camera plate + denied plate (gate grammar); receive transport rows (STOP LISTENING / COPY MESSAGE + LISTEN AGAIN + done note); `data-mode` on body. `css/main.css` (+~180 lines additive): mode-lever keys (amber ring mirrored off BOTH radio-checked and body[data-mode] — static snapshots stay honest), aperture (200px max, 3:4, head-cap metal, shutter with "THE EYE IS CLOSED" micro-plate, state-derived open at armed/active), meter grammar (mono, amber only when decoding), receive-mode chrome (composer/speed/share/corridor stand down; send tape swaps for the received record; plates + transport rows per state; eye stacks below 560px).

**Validation (evidence):** headless-Chrome CDP rig (`/tmp/rx-i1-rig`, zero repo residue) — **14 states × 4 viewports (320/390/768/1280) ALL CHECKS PASSED**: every receive state renders its station line, eye, aperture, exactly one meter line, the right plates/transport rows; zero broadcast-bay/line/tape leakage into receive and zero receive leakage into broadcast; horizontal overflow bounded at the pre-existing v1 6px tape-band overhang (parity across modes — T-refine-3's shipped value). `npm test` 558/558. Six vision-inspected captures at `.impeccable/review/i1-run2-*.png` (idle/active/done/preflight/armed @390 + idle @1280). **Two real defects found by the vision pass and fixed in-batch:** (1) the lever's amber ring followed only the radio `checked` — receive snapshots latched BROADCAST; now mirrored off `data-mode`; (2) the shutter showed "THE EYE IS CLOSED" in armed/active static snapshots — now state-derived open (camera live through armed/active; closed at idle/done — the eye closes on release). Known-carried observations (pre-existing v1 tape behavior, not regressions): head-bridge partially overlaps the live letter (v1 I4/I5 recorded judgment); receive transport sits below the first fold (the eye bay adds height; page scrolls, nothing unreachable).

**Rig notes (honest record):** sequential CDP screenshot sessions are flaky in this environment (screenshot-after-metrics hangs; zombie-target deserialize errors) — captures run one-browser-per-shot with unique debug ports; the DOM/visibility rig is the load-bearing check and runs cleanly.

**Next:** I2 live wiring (+S2 mode architecture).

## T-I2 + T-S2 — Live wiring + mode architecture [Iron Man · Hulk · Daredevil · Captain America]

**Status:** completed 2026-09-01. Suite **558/558**; **fake-camera E2E 13/13 at ALL THREE WPM steps** (LEARNER full journey; STANDARD + BRISK self-consistency runs). **Milestone M3 (the register listens) reached.**

**Built (app.js additive ~300 lines):** the receive composition — watcher edges → (ms, endTMs) periods → session (lazily created at the first edge, where the D8 mid-join truth is actually observable: a first OFF edge means light was already on) → tape punches (buildRxTape: v1 px geometry, spoken/live inks, void groups, live-group centering under the head) + per-word polite announcements (350 ms coalesced bursts into the markup-scoped `.sr-live` region — letters settle silently; config in markup per the refinement-#2 law, JS writes text only) + honest meters (data-meter drives CSS; saturated note from watcher stats; partial note from D8) + done notes (quietClosed/donePartial verbatim from COPY.receive) + COPY MESSAGE (clipboard + honest failure copy) + listen-again → preflight + STOP LISTENING. **S2 mode architecture:** radio lever with values normalized lowercase (radios carry UPPERCASE — a real bug the E2E caught), amber ring mirrored off data-mode; freezes through committed runs of EITHER mode (v1 speed-freeze grammar: disable pass + restore-guard); leaving receive finalizes + releases (no auto-restart); entering receive dispatches REQUEST_RECEIVE (the plate greets the mode) and never touches the broadcast machine or hash; visibilitychange while listening = STOP (finalize + close the eye). Machine gaps fixed en route: HEARING dispatched on the session's first heard mark (without it AUTO_COMPLETE soft-rejected at armed — root cause of the first stuck-state diagnosis); PREFLIGHT gained a RESET row (mode-switch-away path); render called with machine.snapshot() (v1 render's contract).

**Validation:** fake-camera CDP rig (`/tmp/rx-e2e-rig`, canvas captureStream injected pre-navigation, zero repo residue) — 13 checks: broadcast boot unchanged; lever → plate greets; **gUM inside the gesture, constraints deep-equal {facingMode environment-ideal, frameRate 60/24}, exactly one call**; armed with aperture live; synthetic "HI" through the REAL media pipeline (canvas → captureStream → video → rVFC → watcher → session → tape); auto-complete at 5 s → done; **camera released exactly once, srcObject detached**; done note = quiet-closed copy; **clipboard round-trip "HI"**; listen-again → preflight; back to broadcast restores idle + composer + send tape. STANDARD + BRISK re-runs green (self-consistency contract, Q1's core).

**Rig lessons (documented, not product bugs):** a static captureStream canvas presents NO frames until first change — the fake camera now paints ambient-dark from gUM handover (a real camera always presents), without which the rolling window cold-starts full of lit samples and eats the first mark; sequential CDP sessions need unique ports and process.exitCode (not process.exit, which drops piped stdout). Cold-window property documented in the watcher header as an honest limitation.

**Next:** I3 motion + capability layers.

## T-I3 — Motion + capability layers [Daredevil · Thor]

**Status:** completed 2026-09-01. Suite **558/558**; E2E **3× consecutive ALL GREEN** after the fixes below.

**Built:** receive lamp states in the v1 grammar (armed = dim, active = lit + halo + lamp legend); plate-snap seating for the receive surfaces (#eye, receive plates, meter lines, done note); `.tp-new` per-mark die press inside a growing live group (alongside v1's `.tg-new` whole-group press); the read-head lamp FIRES per heard flash via v1's `firePulse()` alternation, cleared outside armed/active. Capability flattening rides v1's universal `prefers-reduced-motion`/`cap-low` layers (animations/transitions off, ring + ink + meter text carry the information; the aperture video is a live picture, never animated by us).

**Renderer rework (the I3-critical changes):** the tape became an INCREMENTAL DOM (append mark spans; finalize groups; word spacing; cached strip shift) — the full-innerHTML rebuild would have replayed every animation per mark. Two real defects found by E2E flakiness and fixed: (1) replayed letters (lock-time recovery / forced bootstrap) arrive with `marks` in the event and no live group — the renderer is now sequence-independent (`rxRenderCompletedGroup` punches completed groups directly; the "H"-only tape was exactly this); (2) a per-mark layout READ (`clientWidth`) stalled edge timing mid-stream — measured dots lengthened into dashes ("T ETT TT") — the window width is now cached at letter boundaries.

**Validation:** `npm test` 558/558; E2E re-run 3× green (stability after the timing fix); prior I1 static validation unaffected (additive CSS only).

**Next:** Q1 (formalize the synthetic-light E2E as the committed rig + STANDARD/BRISK evidence), Q2 (privacy mutation checks + runtime release audit), Q4 (a11y), Q3 (device script).

## T-Q1 + T-Q2 — Synthetic-light E2E + privacy re-scope audit [Hawkeye · Captain America]

**Status:** completed 2026-09-01. Suite **559/559** (558 + the run-2 mutation self-test); **E2E 19/19**. **Milestone M4 evidence complete for the automatable tier.**

**T-Q1 (the self-consistency contract — "what this app sends, this app receives"):** the fake-camera CDP rig (canvas `captureStream` injected pre-navigation — the REAL media pipeline: canvas → stream → `<video>` → rVFC → watcher → session → tape) runs the full journey at LEARNER and re-runs it at STANDARD and BRISK: decoded "HI" on the tape, clipboard round-trip, exactly one gUM per session with the committed constraints deep-equal, camera released exactly once at completion, aperture dark (srcObject detached), done note = quiet-closed copy, listen-again → preflight, broadcast journey byte-identical before/after. Rig lessons recorded at T-I2 (ambient-painting fake camera; unique ports; process.exitCode). Rig in /tmp, zero repo residue (v1 pattern).

**T-Q2 (the re-scoped privacy law, pinned + runtime-audited):**
- Source-level: the re-scoped scan from T-W1 (frame tokens confined to js/watcher.js; sanctioned downsample forms pinned by exact-string asserts; export/encode/record/capture surfaces banned everywhere incl. the watcher; bare-VideoFrame-outside-rVFC check; the aperture `<video>` as the sanctioned preview sink; camera doors = torch.js + watcher.js; zero storage; network = the fonts pair only). NEW: the run-2 mutation self-test — planted `getImageData` outside the watcher caught; `takePhoto` inside the watcher caught; a drifted full-resolution drawImage breaks the exact pin; a bare `VideoFrame` constructor distinguishable from the rVFC API name.
- Runtime (E2E, 19 checks total): **zero gUM calls before the listening gesture** (the plate shows, the camera sleeps); one gUM per session; **mid-listen the lever is FROZEN** (switch refused, radios disabled, camera still held — the design law); **STOP LISTENING → done + release + aperture dark**; switch-from-done restores broadcast; **backgrounding while listening finalizes the session and closes the eye** (visibilitychange path); release counts exact at every step (1 at auto-complete, 2 at stop, 3 at background).

**Q1/Q2 runtime rigs stay disposable** (evidence in this log; the committed `npm test` suite carries the source-level laws + the pure-logic contracts).

**Next:** Q4 a11y pass, then Q3 device-test extension.

## T-Q4 — Receive a11y pass [Daredevil]

**Status:** completed 2026-09-01. **A11Y rig 11/11** (keyboard journey, announcement cadence, aperture photosafety, contrast).

**Checks green:** the mode lever is the FIRST tab stop (radio-group semantics; ArrowRight switches, focus ring 2px lamp amber); Tab reaches BEGIN LISTENING and **Enter arms in-gesture** (gUM count +1 exactly at the keypress); the aperture measures **13.1% of viewport area @390 and 19.6% @320** (WCAG 2.3.1 small-area relief — the only flashing region, replaying sender flashes ≤5 Hz); announcements fire **per completed word** ("SOS", "SOS …" bursts — zero per-letter chatter, MutationObserver evidence); meter line contrast **8.31:1**, done note **16.08:1** (token-derived); aria scopes structurally pinned in the suite (two polite regions: station = states, sr-live = words).

**Two real defects found by the pass, fixed:**
1. **`#why-camera-receive .keys` / `#receive-denied .keys` never overrode v1's `.keys { display:none }` default — the plates' buttons were UNRENDERED** (an I1 bug invisible to every prior rig: computed display lies through hidden ancestors and `el.click()` works unrendered). Fixed with the show rules; both the E2E and a11y rigs now assert `getClientRects().length > 0` on the plate's primary key.
2. **Announcement cadence was a 350 ms timer flush** — at LEARNER's letter rate that announces each LETTER alone (exactly the chatter the law bans). Rewritten to word-event flushes (letters accumulate silently; a completed word announces once; the trailing word flushes at complete before the final message read).

**Next:** Q3 device-test extension (docs-only handover).
\n## T-Q3 — Device-test extension, run 2 [Hawkeye]

**Status:** completed 2026-09-01 (handover delivered; results user-owned). `docs/DEVICE-TEST.md` extended with the RUN 2 RECEIVER section: two-phone setup, the R1 demo journey (plate-before-prompt, in-gesture grant, meter truth transitions, tape punching, 5 s finalize, clipboard), R2 speed matrix (BRISK flagged as the tight subjective case), R3 light sources (screen sender + best-effort hand flashlight), R4 honest-degradation battery (mid-join PARTIAL, silence vs noise meters, saturation hint + distance, backgrounding finalize, OS camera indicator off), R5 privacy spot-checks, and the report-back format feeding the T-Q3-run2 results entry. Receiver expectations per engine match research R1/R2 (incl. the no-exposure-control note for Safari/Firefox). Docs-only; commands verbatim from the v1 §1 setup (no new commands to verify).

**Run-2 production is now code-complete: all 14 plan tasks delivered and validated.**\n