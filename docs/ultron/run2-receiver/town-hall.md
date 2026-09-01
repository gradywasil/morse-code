# Town Hall — Run 2: The Receiver

Status: **BRIEF ASSEMBLED — awaiting final gate confirmation.** Framing round + grilling round 1 user-approved 2026-09-01.

## Problem statement & target users

**Problem:** The Broadcaster's magic trick is one-directional. A phone blinks Morse across a dark room and the only way to read it is to watch the sender's own dot/dash readout — the receiving side of the demo doesn't exist. "Watch my phone flash and yours will tell you what it says" is the missing second act, and it is a *bigger* wow than the first: the page doesn't just drive hardware, it senses the world.

**Target users:** The same demo / party-trick crowd. Primary: the person on the other side of the room — a stranger who opens the same link, taps RECEIVE, and watches text assemble itself out of a flashing light. Secondary: Morse-curious onlookers; the sender showing off both halves.

**Job-to-be-done:** "Open the same page, tap RECEIVE, point at the flashing light, and watch the message appear as text — with zero coordination with the sender: no shared speed, no pairing, no setup."

## Framing decisions (user-confirmed 2026-09-01)

| Decision | Choice |
|---|---|
| App shape | Same page — BROADCAST / RECEIVE mode toggle; the share link stays one surface |
| Camera preview | Live preview for aiming, kept **small**, always paired with a non-visual signal meter |
| Speed handling | **Auto-detected from the flashes themselves** (ITU ratios 1/3/1/3/7 are speed-invariant) — zero coordination, no manual dial, no override in MVP |
| Received-message MVP | **Live streaming text + COPY button only** |
| Non-goals confirmed | Re-broadcast/relay, share-received-as-link, receive history/persistence |
| Sender compatibility | Contract = **this app's sender** (torch channel + screen-flash channel, all three WPM detents); hand-held-flashlight human Morse is best-effort, never acceptance-gated |
| Session end | Auto-complete after extended silence (~8–10 s) **and** manual STOP always; live "hearing nothing" indicator |
| Privacy law | v1's "no video frames are ever read" honestly amended — strict re-scope (below), pinned by a re-scoped privacy-scan test |
| Stack | Unchanged: plain static HTML/CSS/JS, no dependencies, no build step, no server |

## MVP boundary & non-goals

**In:** BROADCAST/RECEIVE toggle; gesture-driven camera permission with why-camera plate *before* the prompt (watching light levels, live view, nothing recorded or sent — ever); live small preview + non-visual signal meter (hearing light / hearing nothing / noise); downsampled on-device brightness sampling producing timestamped light on/off edges; pure decoder with zero-coordination clock recovery (dot-unit inference from durations) → dot/dash → letters → live streaming text; honest partial-message indication when receiving joins mid-stream; auto-complete on extended silence + manual STOP; COPY button for the decoded message; receive error/edge states with actionable copy (permission denied, insecure context, camera busy, too dark/noisy); camera hard-released on stop, mode switch, and backgrounding; receive-surface a11y (polite announcements, non-visual operability, small flashing preview per WCAG 2.3.1 relief); the v1 broadcast journey untouched.

**Non-goals:** re-broadcasting/relaying the received message; sharing the received message as a link; receive history or any persistence; decoding arbitrary hand-sent Morse as an acceptance contract; sender–receiver pairing or message acknowledgement; conversation mode; server/accounts/analytics (unchanged); non-Latin Morse variants (unchanged); continuous loop (unchanged).

## Primary journey & important states

**Journey:** Open page → toggle RECEIVE → why-camera plate → grant camera (in-gesture) → aiming view (small preview + signal meter: HEARING NOTHING) → sender broadcasts → meter flips to HEARING LIGHT, marks and text stream live → sender stops → silence elapses → auto-complete finalizes the message → COPY available. Manual STOP ends the session at any point; camera releases on stop, mode switch, and background.

**Receive states (must render legibly; enumeration and machine shape are planning-owned):**
- idle/armed (camera on, nothing heard — actionable: aim, get closer, dim the room)
- receiving (light heard; decoding; live text; mid-stream join → partial-message indication)
- done (auto-complete on silence or manual stop; complete vs partial recorded honestly)
- error (permission denied with honest explanation, insecure context, camera busy/lost)
- distinguishable noise state (light seen but not decodable — different from silence)

The v1 broadcast state matrix and journey remain intact; the toggle must never regress them.

## Success measures & acceptance criteria

**Automatable:**
1. Decoder correctness: pure-function timing corpus — every ITU-mapped character round-trips from schedule-generated on/off durations with realistic camera-grade jitter, at all three WPM steps; ratio tolerances documented and pinned by tests.
2. Zero-coordination clock recovery: LEARNER / STANDARD / BRISK messages decoded with **no speed hint** — dot unit inferred from durations alone (pinned by unit tests over the pure decoder).
3. Self-consistency E2E on synthetic light: this app's generated schedule drives a synthetic flashing light through a fake camera; decoded text equals the original message at all three WPM steps. "What this app sends, this app must receive."
4. Privacy re-scope pinned: frame-read tokens appear **only** in the receiver watcher module and only in sanctioned downsampled forms; zero storage/recording/transmission surfaces repo-wide; camera track released on stop, mode-switch, and background (test-pinned, mutation-checked).
5. Permission requested only from the RECEIVE gesture, why-camera plate shown before the prompt (rig-verified, v1 pattern).
6. A11y: signal meter is textual and stateful; decoded text announces politely at a cadence that avoids per-letter chatter (v1 refinement-#2 lesson); preview sized within WCAG 2.3.1 small-area flash guidance; full keyboard operability.
7. Session end: auto-complete fires only beyond the longest scheduled gap by a wide margin; manual STOP always works; indicator states live.
8. Regression: the full v1 suite stays green — the broadcast journey is untouched.

**Provisional (research-informed, verified on the user's available hardware):**
9. Real two-phone dark-room decode at all three WPM steps — torch sender → camera receiver, and screen sender → camera receiver.
10. Robustness in typical indoor lighting (auto-exposure behavior) documented honestly from device tests, with the applicable guidance surfaced in-UI.

**Dependency:** provisional tier needs two real phones (user hardware) — an explicit dependency, not a silent assumption (v1 Q3 pattern).

## Constraints, assumptions, risks

- **Camera auto-exposure/auto-white-balance adapting to the flash** can swallow the signal after the first marks — the headline risk; counter-strategy (exposure lock via `applyConstraints` where supported, sampling-region choices) is research-owned.
- Torch LED PWM flicker aliasing with the sampling rate; frame-cadence quantization (at ~30 fps a BRISK dot ≈ 3 samples — workable, but edge timing needs interpolation); both research-owned.
- Saturation at close range (blown-out frames → no edges): mitigation is adaptive thresholding plus an actionable "move back" hint (Hulk states).
- Secure-context requirement for `getUserMedia` (same as v1; static hosts qualify).
- Mid-stream join loses early characters — honest limitation, visibly indicated, never fabricated.
- Multiple/ambient light sources (LED signs, hand-waves) → noise state, not garbage decode.
- Battery/camera-heat on long sessions → Thor budgets; backgrounding pauses and releases.
- One-product-two-acts scope risk: receive must not delay or complicate the broadcast demo (Ant-Man guardianship).

## Hero Perspectives (round of 2026-09-01, concerns dispositioned in grilling round 1 — user-approved "approved all")

- **Iron Man — architecture.** Supports: clean v1-style split — DOM-free pure decoder (durations → text) + camera watcher module (preview, sampling loop, timestamped edges) + toggle as app-shell work. Concern: brightness sampling needs frame readback that v1's privacy scan bans repo-wide; frame access must be confined to one module so the law is re-scoped precisely. Claims: watcher module, decoder module, mode-toggle architecture.
- **Thor — performance.** Supports: 30–60 fps downsampled sampling is cheap per tick. Concern: edge-timestamp resolution (rVFC where available, rAF fallback) and battery on live camera sessions; backgrounding story required. Claims: sampling budgets, visibilitychange behavior.
- **Captain America — security & privacy.** The headline: v1's letter ("no frames read") breaks; the substance (nothing leaves the device, nothing persists) must survive, loudly. Concern: the preview shows the room and bystanders — why-camera copy must say what watching means before the prompt. Claims: the re-scoped privacy law, its copy, and the re-scoped privacy-scan test.
- **Hulk — resilience.** Everything fails: denied permission, insecure context, busy camera, too far, too bright, AE crush, hand-waves, garbage decode, mid-stream join. Concern: the receiver's failure mode is *silent garbage*, not an error screen — silence / light / noise must be distinct, with actionable steps. Claims: receive error/edge states + degradation copy.
- **Ant-Man — scope.** The line is drawn: live text + copy; no relay, no link-share, no history. Concern: the second act must not delay the first — broadcast journey untouched, toggle additive. Claims: MVP boundary guardianship on every task.
- **Daredevil — accessibility.** Supports: non-visual signal meter makes receiving operable without sight. Concern: preview replays the sender's flashes up to ~5 Hz (WCAG 2.3.1) → small window; announcement cadence must avoid the per-letter chatter v1's refinement #2 killed. Claims: receive a11y — meter, announcements, preview photosafety.
- **Hawkeye — testing.** Supports: pure decoder is a timing-corpus dream; v1's fake-camera CDP rig (canvas `captureStream`) can synthesize a flashing light → full E2E with zero hardware. Concern: definition of done also needs the real thing — a two-phone handover script extending DEVICE-TEST.md. Claims: acceptance criteria, synthetic-light rig, device-handover extension.
- **Doctor Strange — risk.** Top contingencies: AE adaptation mid-message; PWM aliasing; close-range saturation; rVFC missing on Firefox. Concern: AE alone can make the feature unusable in real rooms — exposure lock is the counter-spell and is research-owned. Claims: risk register feeding research questions.
- **Professor X — domain.** Supports: ITU ratios are speed-invariant → zero-coordination auto-detection is sound; our own sender is the compatibility contract. Concern: machine timing through a real camera still needs tolerance, and mid-stream join honestly loses early characters. Claims: decode-accuracy contract (ratio tolerances), usage-context facts.
- **Mr. Fantastic — omitted.** No external data, APIs, or integrations; everything stays on-device in the static page.

## Open-question dispositions

| Question | Owner | Blocking status |
|---|---|---|
| rVFC vs rAF sampling design; sampling canvas size / fps | research | Informs architecture; does not block planning (fallback design required either way) |
| AE/exposure-lock support matrix + counter-strategy | research | Informs provisional criteria 9–10; does not block planning |
| Clock-recovery algorithm + ratio tolerance values | research | Informs the decoder test corpus; does not block planning (contract fixed here) |
| Silence threshold exact value (8–10 s window) | planning | Blocks only that constant's production |
| Receive state enumeration; extend states.js vs parallel machine | planning | Blocks production wiring only |
| Announcement cadence (per-word vs settled-line) | planning | Blocks copy/wiring bits only |
| Preview exact sizing vs WCAG small-area guidance | design + research | Implementation detail; outcome preserved |
| Signal-meter thresholds and copy voice | production | Implementation detail |
| Exposure-lock application order inside the watcher | production | Implementation detail |

Production-owned questions above all preserve the approved user outcome; any question that would change user behavior, scope, acceptance criteria, or a non-goal returns to this assembly first.

## Decisions with rationale & rejected alternatives

- **Same-page mode toggle** — the URL is the whole product; one link must serve both acts. Rejected: separate receiver page (splits the share surface, doubles the first viewport story).
- **Live small preview + always-on non-visual meter** — aiming blind is genuinely hard; the meter is required for a11y anyway. Rejected: no-preview privacy-maximal (unusable aiming); rejected: an extra "steady view" toggle (a third mode to justify what sizing already solves).
- **Auto-detect, zero coordination** — the ratios are speed-invariant; anyone can receive anyone. Rejected: manual WPM dial (the demo would require agreeing a speed across the room); rejected for MVP: auto-with-manual-override (extra surface; our three detents are the contract).
- **Live text + COPY only** — scope discipline; the second act must not delay the first. Rejected: relay/re-broadcast (conversation complexity), share-as-link, history (persistence stance).
- **Sender contract = this app's sender** — machine timing, testable self-consistency. Rejected: hand-sent flashlight Morse as a contract (operator-skill variance is not an acceptance criterion); it stays best-effort.
- **Auto-complete on extended silence + manual STOP** — the one-tap demo should not end on a fiddly second tap; 8–10 s is far past the longest scheduled gap (7-unit word gap ≈ 1.7 s at LEARNER). Rejected: manual-stop-only.
- **Privacy law strict re-scope** — keeps the substance (nothing stored, nothing transmitted, nothing persists) while honestly amending the letter for the one feature that needs it, confined to one module and pinned by a mutation-checked test. Rejected: keeping the no-frame law (kills the feature); rejected: loose relaxation (betrays the audit trail v1 built).

## Thumbs-up record (grilling round 1, user-approved "approved all", 2026-09-01)

1. Iron Man — ✅ module-split concern embedded in Q4 (privacy confinement) and approved.
2. Thor — ✅ budgets/backgrounding dispositioned to research+planning (non-blocking).
3. Captain America — ✅ Q4 approved verbatim as written.
4. Hulk — ✅ Q2 (session end + HEARING NOTHING indicator) and noise-state criterion approved.
5. Ant-Man — ✅ framing round: non-goals selected by the user directly.
6. Daredevil — ✅ Q3 (small preview + meter, no third mode) approved.
7. Hawkeye — ✅ criteria 1–8 adopted with the self-consistency contract (Q1).
8. Doctor Strange — ✅ risk register dispositioned to research (Q1–Q4 outcomes bound the contingencies).
9. Professor X — ✅ Q1 (sender contract) approved; mid-stream-join honesty adopted.
10. Descriptive clusters (problem & users; journeys/states) — plainly confirmed in the framing round.

## Handoff note for plan-it-out

UI surface exists → the design phase ($impeccable shape delta for the receive surface; world "The Register" is locked, direction questions never re-asked) runs before planning per ultron routing. Then structure the plan's lanes from the hero claims:

| Hero | Concern | Claimed workload |
|---|---|---|
| Iron Man | frame access confined to one module | Watcher module (camera, preview, sampling, edges); pure decoder module; mode-toggle app architecture |
| Thor | sampling cost, battery, backgrounding | Sampling-loop budgets; visibilitychange pause + camera release |
| Captain America | privacy law re-scope | Re-scoped law + why-camera copy + re-scoped privacy-scan test |
| Hulk | silent-garbage failure modes | Receive error/edge/noise states + actionable degradation copy |
| Ant-Man | boundary guardianship | Non-goal review pass on every task |
| Daredevil | non-visual receive + flash safety | Meter, announcement cadence, preview sizing discipline |
| Hawkeye | definition of done | Acceptance criteria; synthetic-light E2E rig; DEVICE-TEST extension (two phones) |
| Doctor Strange | AE/PWM/saturation contingencies | Risk register feeding research questions |
| Professor X | decode accuracy contract | Ratio-tolerance corpus + usage-context facts |

Research must be commissioned with the P0 questions (sampling design, AE strategy, clock-recovery tolerances) marked inform-not-block, mirroring v1's torch-matrix pattern.
