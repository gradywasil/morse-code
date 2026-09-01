# Design Brief — Run 2: The Register Listens

Status: **SHAPE COMPLETE — awaiting phase gate.** World "The Register" (user-locked run 1, seed 53cae9af) is unchanged; this brief covers only the receive surface delta. PRODUCT.md refreshed from the run-2 town hall 2026-09-01 (no re-interview). Build path: code-led (carried over; no image generation exists in this harness).

## 1. Job and audience

The person on the other side of the room: phone in hand, aimed at a flashing light, wanting to know what it says. Visitor mode **Operate** — a one-handed instrument in a dim room, watched by onlookers who now see the second half of the trick. They arrive with zero coordination with the sender and must leave with the message as text.

## 2. Outcome and proof

Primary action: toggle RECEIVE → grant the camera → aim → watch text assemble. Success: the decoded message streams live and copies cleanly; the proof is physical — a flash across the room becomes a punch appearing in your paper. Product truth: nothing is recorded, stored, or transmitted; the camera closes the moment you stop.

## 3. Selected direction — "The Register Listens"

The register inverts. In broadcast, typing punches the tape and the head speaks the punches to the room; in receive, the room speaks and the tape gets punched by what the instrument hears. One machine, two directions of information flow — no second surface, no mode costume.

- **The mode lever.** A two-position machine switch — BROADCAST | RECEIVE — stencil legends, radio-driven like the speed detents (same keyboard/focus grammar). The active position carries the amber ring (One Lamp: the instrument is live there). The lever freezes through any committed run (broadcast or receive) with the established disabled grammar, and leaving receive releases the camera.
- **The aperture.** The live camera preview is the instrument's eye: a small metal-framed inset window (head-cap metal family, cap radius) on the machine face, near the station. Small by photosafety law — a minority fraction of viewport width; exact pixels in production with the WCAG 2.3.1 small-area check. It goes dark (metal blank) whenever the camera is released — the eye closes; never a frozen last frame.
- **The hearing meter.** The station's ledger line carries the textual truth — HEARING LIGHT / HEARING NOTHING / NOISE (machine-register voice, mono) — with a compact bar as visual echo only. The textual line is the accessible source; receiving never requires watching the picture.
- **The tape receives.** Blank paper runs under the fixed head. Each heard flash punches a hole — dot or dash — in live ink (amber ring, live ink #7a4a0c). When a letter completes, its printed letter appears above the group and the group settles to spoken ink (#645637). Ink Ledger mapping: unheard = blank paper; being heard = live; decoded = spoken. The strip advances by the existing traverse mechanics — only the punch source changes, from typing to decoding. The head lamp is the hearing lamp: it fires per heard flash, mirroring broadcast's per-mark fire.
- **The received record.** The station's dialogue area streams the decoded text; the tape holds the punched record. Mid-stream join prints an honest void gap where listening began, and the station legend carries the PARTIAL flag. Auto-complete on extended silence finalizes the record ("n LETTERS · n WORDS"); manual STOP finalizes whatever was heard. COPY is a machine key in the transport row; STOP sits where BROADCAST sits — the transport row adapts to the mode, same seats, same grammar.
- **Why-camera (receive variant).** A gate plate in the established grammar before the prompt: the register watches light levels through a live view; nothing is ever recorded or sent; the eye closes when you stop.

**Memorable moment:** mid-message, a flash across the room punches a hole in your paper — the letter prints above it and settles as the next one starts assembling. Text arrives hole by hole.

## 4. Scope and boundaries

One surface (index.html), one new mode; no new pages, no new accent colors, no new type voices, no camera chrome beyond the aperture (no shutter, no capture controls, no full-screen preview). The v1 broadcast journey renders and behaves byte-identically — its states, copy, and timings are untouched. Anti-goals: relay/re-broadcast UI, share-received-as-link, history, any persistence.

## 5. States and ranges

Receive states (rendering must be legible; machine enumeration is planning-owned): armed/hearing-nothing (actionable: aim, get closer, dim the room), receiving (live text + punches), noise (light seen, not decodable — distinct from silence), done (complete vs partial, honestly flagged), error (permission denied with honest explanation, insecure context, camera busy/lost). Ranges: messages up to the tape's existing capacities; text streams at the sender's WPM (5–12); sessions bounded by auto-complete (~8–10 s silence).

## 6. Interaction and layout

The deck topology stands; receive mode re-purposes it: lever near the nameplate, aperture + meter by the station, tape center stage as ever, transport row becomes STOP + COPY, composer bay sits dark/absent (the register is not being written to). Same responsive law — every content-bearing track `minmax(0, 1fr)`, stacking below 480px; the aperture never grows on wider screens (photosafety law outranks viewport drama). Motion stays on the two curves: punches seat (press), letters print (snap), the lamp fires per heard flash; the tape traverse remains the one progress-driven exception. Announcements: the station announces per completed WORD politely; letters settle visually without announcement chatter; the finalized message announces once.

## 7. Constraints and open decisions

Locked: the world's named rules (One Lamp, Ink Ledger, Warm Ground, Three Voices), static no-dependency stack, photosafety, privacy law as re-scoped, ITU timing as the decode contract. Open (owned downstream, none blocking this gate): aperture exact size + WCAG small-area computation (research/production); receive state machine enumeration (planning); silence constant 8–10 s (planning); meter copy voice details (production); announcement cadence wiring (production). This brief writes no code and no direction contract changes to run-1 artifacts; DESIGN.md extension happens at the run-2 finishing pass, as run 1 did.
