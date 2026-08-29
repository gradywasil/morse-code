# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Plain static HTML/CSS/JS — no build step, no dependencies, no framework (user-confirmed 2026-08-28). Unit tests for the pure logic run via Node. Deploys to any static host (GitHub Pages/Netlify class).

## Users

People who want a fun demo / party trick: show off what a phone browser can do, send a silly message across a dark room, share a link that makes strangers' phones blink. Secondary onlookers: Morse-curious people watching the dot/dash readout.

## Product Purpose

Type a plain-English message, press one button, and the phone physically broadcasts it in International Morse — camera LED torch where the browser supports it, full-screen white/black flashes everywhere else, with synchronized audio tones and a live dot/dash readout. Success is the wow moment: cold open to broadcast within 15 seconds, shared link to broadcast within 2 taps.

## Positioning

The only zero-install webpage that drives real flashlight hardware from a plain browser tab (on supporting Android devices), with a first-class screen-light fallback so the trick works on every device. No app store, no server, no account — the URL is the whole product.

## Operating Context

Used on phones, usually held up, often in dim rooms (the light is the point). Camera permission is requested from the Broadcast gesture only, with honest why-camera copy. Broadcasts are one-shot with a replay button; the message and speed travel in the URL hash for sharing. Photosensitivity safety is part of normal use, not an edge case.

## Capabilities and Constraints

- Translator: full ITU International Morse (A–Z, 0–9, punctuation `. , ? ' ! / ( ) & : ; = + - _ " $ @`); unknown characters visibly flagged in the preview, never silently dropped. No prosigns. Timing in dot-units: dot 1, dash 3, intra-char gap 1, letter gap 3, word gap 7.
- Broadcast channels: LED torch via `getUserMedia({video})` + `applyConstraints({advanced:[{torch}]})` where supported (Chromium-based Android browsers and iOS Safari 17.4+, with device quirks); full-screen white/black flash via Fullscreen API everywhere else — screen-flash fallback remains first-class for everything else; synchronized Web Audio tones; synced on-screen Morse readout.
- WPM slider with a low photosensitivity-aware default and a capped upper bound (exact values are research-informed open decisions).
- Pre-flight: test flash, camera permission flow, photosensitivity notice before first broadcast.
- Sharing: message + WPM round-trip through the URL hash.
- Privacy constraint: video frames are never read, recorded, or transmitted; the camera track exists only to unlock the torch and is released after broadcast.
- Non-goals: receiver/decoding, continuous loop mode, server, accounts, persistence, analytics, native wrapper, non-Latin Morse variants.

## Brand Commitments

Working title: "The Morse Code Broadcaster". No logo, no assets, no voice commitments yet (absence noted — future work must not fabricate brand evidence).

## Evidence on Hand

The approved scoping brief at `docs/ultron/town-hall.md` is the product-truth source. No real content, imagery, testimonials, or device-test data exists yet; torch device-support evidence is expected from the research phase and must not be invented.

## Product Principles

1. The wow is the light — every decision serves the physical broadcast moment; anything that delays open→broadcast gets cut.
2. Works on every phone in the room — torch where possible, screen-flash everywhere else, both first-class.
3. Honest hardware — camera permission asked in-context with a truthful reason; nothing leaves the device.
4. Light is safety-relevant — photosensitivity notice, low default speed, capped range are product features, not compliance chores.
5. Zero servers, zero installs — the URL is the whole product.

## Accessibility & Inclusion

Photosensitivity is the primary accessibility concern: pre-broadcast notice, low default WPM, capped flash rate, `prefers-reduced-motion` honored. Multimodal output (light + sound + readout) keeps the message perceivable when any single channel is unavailable.
