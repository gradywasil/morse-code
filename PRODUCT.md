# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Plain static HTML/CSS/JS — no build step, no dependencies, no framework (user-confirmed 2026-08-28). Unit tests for the pure logic run via Node. Deploys to any static host (GitHub Pages/Netlify class).

## Users

People who want a fun demo / party trick: show off what a phone browser can do, send a silly message across a dark room, share a link that makes strangers' phones blink. Since run 2, the person on the other side of the room: a stranger who opens the same link, taps RECEIVE, and watches text assemble from the flashing light. Secondary onlookers: Morse-curious people watching the dot/dash readout.

## Product Purpose

Type a plain-English message, press one button, and the phone physically broadcasts it in International Morse — camera LED torch where the browser supports it, full-screen white/black flashes everywhere else, with synchronized audio tones and a live dot/dash readout. Success is the wow moment: cold open to broadcast within 15 seconds, shared link to broadcast within 2 taps. Run 2 adds the second act: point the camera at the flashing light and the message decodes back into live text on your screen — with zero coordination with the sender (speed is auto-detected from the flashes themselves).

## Positioning

The only zero-install webpage that drives real flashlight hardware from a plain browser tab (on supporting Android devices), with a first-class screen-light fallback so the trick works on every device — and, since run 2, one that senses the world back: the same page reads another phone's light and turns it into text, no pairing, no agreed speed. No app store, no server, no account — the URL is the whole product.

## Operating Context

Used on phones, usually held up, often in dim rooms (the light is the point). Camera permission is requested from the Broadcast gesture only, with honest why-camera copy. Broadcasts are one-shot with a replay button; the message and speed travel in the URL hash for sharing. Photosensitivity safety is part of normal use, not an edge case. Receiving (run 2) is the mirrored posture: the phone is held up aimed at the sender's light, camera on with a small live preview for aiming plus a non-visual signal meter; the receive permission gesture carries its own why-camera copy (the page watches light levels, nothing is ever recorded or sent); sessions auto-complete after extended silence and always release the camera on stop, mode switch, or backgrounding.

## Capabilities and Constraints

- Translator: full ITU International Morse (A–Z, 0–9, punctuation `. , ? ' ! / ( ) & : ; = + - _ " $ @`); unknown characters visibly flagged in the preview, never silently dropped. No prosigns. Timing in dot-units: dot 1, dash 3, intra-char gap 1, letter gap 3, word gap 7.
- Broadcast channels: LED torch via `getUserMedia({video})` + `applyConstraints({advanced:[{torch}]})` where supported (Chromium-based Android browsers and iOS Safari 17.4+, with device quirks); full-screen white/black flash via Fullscreen API everywhere else — screen-flash fallback remains first-class for everything else; synchronized Web Audio tones; synced on-screen Morse readout.
- WPM slider with a low photosensitivity-aware default and a capped upper bound (exact values are research-informed open decisions).
- Pre-flight: test flash, camera permission flow, photosensitivity notice before first broadcast.
- Sharing: message + WPM round-trip through the URL hash.
- Receiver (run 2): same page, BROADCAST/RECEIVE mode toggle. Gesture-driven camera permission with a why-camera plate before the prompt; small live preview for aiming plus a non-visual signal meter (hearing light / hearing nothing / noise); downsampled on-device brightness sampling → timestamped light edges; pure decoder with zero-coordination clock recovery (dot unit inferred from durations — ITU ratios 1/3/1/3/7 are speed-invariant) → live streaming text; honest partial-message indication on mid-stream join; auto-complete after extended silence (~8–10 s) plus manual STOP; COPY for the decoded message. Compatibility contract: broadcasts sent by this app (torch and screen channels, all three WPM steps) — hand-held-flashlight Morse is best-effort, never promised.
- Privacy constraint (re-scoped run 2): broadcast keeps the run-1 law untouched — the torch camera track is never read, recorded, or transmitted and is released after broadcast. Receiving reads frames under a strict confinement: downsampled brightness sampling exists only in the receiver watcher module, is computed on-device in memory, is never stored, recorded, or transmitted, and the camera is hard-released on stop, mode switch, and backgrounding. Pinned by a re-scoped repo-wide privacy-scan test.
- Android distribution (authorized 2026-10-26): Bubblewrap TWA launching `https://morsecode.graydonwasil.com`, package `com.arrangedgodly.morsecode`. The web app remains the runtime; native packaging requires Android build tooling, signing, and Digital Asset Links. See `docs/ANDROID.md` for build evidence and remaining release steps.
- Non-goals: re-broadcasting/relaying a received message, sharing a received message as a link, receive history or any persistence, continuous loop mode, server, accounts, analytics, non-Latin Morse variants.

## Brand Commitments

Working title: "The Morse Code Broadcaster". No logo, no assets, no voice commitments yet (absence noted — future work must not fabricate brand evidence).

## Evidence on Hand

The approved scoping briefs are the product-truth sources: `docs/ultron/town-hall.md` (run 1 — broadcast) and `docs/ultron/run2-receiver/town-hall.md` (run 2 — receiver, approved 2026-09-01). The run-1 device-test and deploy handovers exist at `docs/DEVICE-TEST.md` / `docs/DEPLOY.md` (results user-owned). No real content, imagery, testimonials, or device-test data exists yet; torch device-support evidence came from run-1 research; receiver sampling/AE/clock-recovery evidence is expected from run-2 research and must not be invented.

## Product Principles

1. The wow is the light — every decision serves the physical broadcast moment; anything that delays open→broadcast gets cut.
2. Works on every phone in the room — torch where possible, screen-flash everywhere else, both first-class; and since run 2, every phone can also read the light back.
3. Honest hardware — camera permission asked in-context with a truthful reason; nothing leaves the device, nothing persists — true for both the torch track and the receiver's watching.
4. Light is safety-relevant — photosensitivity notice, low default speed, capped range are product features, not compliance chores; the receive preview replays flashes and stays small by the same discipline.
5. Zero servers, zero installs, zero coordination — the URL is the whole product, and receiving requires no pairing, no shared speed, no setup.

## Accessibility & Inclusion

Photosensitivity is the primary accessibility concern: pre-broadcast notice, low default WPM, capped flash rate, `prefers-reduced-motion` honored. Multimodal output (light + sound + readout) keeps the message perceivable when any single channel is unavailable. Receiving adds: a textual non-visual signal meter (receiving works without watching the camera picture), decoded text announced politely at a cadence that avoids per-letter chatter, and a small flashing preview sized within WCAG 2.3.1 small-area relief.
