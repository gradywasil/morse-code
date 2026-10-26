# Morse

Type a message in plain English and your phone's flashlight broadcasts it in Morse code — real hardware, no app install, no server. Point a second phone's camera at the light and it decodes the message back into text as it flashes. The interface is a telegraph register: your words punch a paper tape as dots and dashes, a read-head traverses the tape while the light speaks — and when listening, the tape punches itself from the light it hears.

> [!IMPORTANT]
> Nothing you type and nothing your camera sees leaves your device. To broadcast, the camera stream exists only to unlock the flashlight — no video is read, recorded, or sent. To receive, the page watches light levels in a small live view: frames are sampled on-device, in memory, at low resolution, never stored or transmitted. Either way the camera closes the moment you stop.

## Quickstart

No install, no build step, no dependencies.

```bash
# from this directory
python3 -m http.server 8080
```

Open `http://localhost:8080`, type a message, and press **BROADCAST**.

On a phone the camera paths need HTTPS (browsers only expose the camera on secure pages). The quickest options are in [docs/DEVICE-TEST.md](docs/DEVICE-TEST.md) — or publish the folder to any static host per [docs/DEPLOY.md](docs/DEPLOY.md).

## The two directions

The mode lever at the top picks one:

- **BROADCAST** — type, press the key, hold the phone up. The lamp (or screen) speaks International Morse while the tone channel mirrors it and the tape marks each symbol.
- **RECEIVE** — open the same page on a second phone, tap **RECEIVE**, grant the camera, aim at the light. That's the whole setup: **no pairing, no agreed speed**. The receiver infers the sender's pace from the flashes themselves (Morse's 1/3/1/3/7 timing ratios are speed-invariant), punches each heard flash onto its own paper tape, and prints letters as they decode. When the light goes quiet for five seconds the message finalizes and is ready to copy.

## Broadcasting

- **Translates as you type.** Full International Morse (ITU): letters, digits, and punctuation, with the exact timing ratios (dot 1, dash 3, gaps 1/3/7). Characters outside the map are flagged on the tape, never silently dropped.
- **Three channels at once**, kept in sync: the camera LED torch, a full-screen white flash, and a 700 Hz tone — plus the on-screen tape read-out marking each symbol as it fires.
- **Works on every device.** Where the browser can't drive the torch, the screen becomes the lamp at the same timing.

| Environment | Broadcast medium |
|---|---|
| Android Chrome (most devices) | LED torch |
| iOS Safari 17.4+ | LED torch |
| Other browsers, desktops, older devices | Full-screen flash |

- **Named speed steps**: LEARNER 5 WPM (default) · STANDARD 8 · BRISK 12. The default keeps sustained flashing below 3 flashes per second; BRISK shows a rapid-flash caution.
- **One-shot with replay.** Pause and resume mid-message (broadcasts auto-pause when the tab goes to the background). If the torch dies mid-broadcast, the screen takes over without losing the message's position.
- **Shareable links.** The message and speed travel in the URL (`#m=…&s=…`), so a shared link opens ready to broadcast in two taps. Nothing is stored — no cookies, no storage APIs.
- **Pre-flight checks.** An honest "why the camera?" explanation before any permission prompt, a one-dot test flash to verify the light, and a photosensitivity notice before the first broadcast.

## Receiving

- **The whole message stays readable.** A selectable transcript below the tape fills in live and remains after STOP. Scroll inside the transcript to review earlier text; it holds your position while new letters arrive. LATEST returns to the incoming end, and COPY works during or after listening. Starting a new listen clears the previous record.

- **Zero coordination.** Speed is auto-detected; start listening before, during, or after the sender starts. Joining mid-message is flagged honestly — the record shows a PARTIAL note rather than inventing a beginning.
- **A meter, not guesswork.** The station reads HEARING NOTHING (with aiming hints), HEARING LIGHT (decoding), or LIGHT, BUT NOT MORSE (glare, busy lights) — receiving works without watching the picture at all.
- **Senders that work**: another phone running this app — torch or full-screen — at any of the three speeds. A hand-held flashlight keyed by a person is best-effort: the decoder tolerates human timing, but nothing is promised.
- **The eye closes.** Camera released on stop, on switching modes, and on backgrounding the tab; the OS camera indicator goes dark.

> [!WARNING]
> This app flashes a light deliberately. A caution plate is shown before your first broadcast — if you are photosensitive, keep to the LEARNER step and don't watch the light directly. While receiving, the small preview replays the sender's flashes; the meter and the tape carry everything without watching it.

## Accessibility

The main interface fits one screen, with a compact Morse mark and mode switch.
OPTIONS contains speed, sound, and link sharing. Long transcripts and dialogs
scroll internally. Very short portrait viewports, including those reduced by
an on-screen keyboard or heavy zoom, can scroll the work area to keep controls reachable.

Every glow and motion effect degrades cleanly under `prefers-reduced-motion` and save-data modes with no information loss. The interface is fully keyboard-operable (the mode lever is the first tab stop; Enter arms listening). Announcements go through polite live regions — state changes as they happen, decoded words one word at a time, never per-letter chatter — and the message is always readable on the tape regardless of which channel is broadcasting.

## Running the tests

581 tests cover the translator, timing engine, channels, conductor, state machines, share-hash round-trips, the decoder, the clock recovery, the session semantics, the camera watcher, the live ticker, the transcript, and the privacy scan. Camera-frame simulations also verify exact received text at 24, 30, and 60 fps across all three speeds with a stationary bright background, including the opening H and final M appearing before the next letter or completion timeout:

```bash
npm test
```

## Troubleshooting

**No camera prompt appears.** The prompt only triggers from the **BROADCAST**/**BEGIN LISTENING** press, and only on HTTPS (localhost counts). Check the padlock.

**The torch never lights, but tones play.** Some devices report torch support but ignore it — the app detects this and switches to screen mode automatically. You can also press **SWITCH TO SCREEN** mid-broadcast at any time.

**iPhone shows the screen, not the LED.** Torch control needs iOS 17.4 or later; older versions fall back to screen mode by design.

**Receiving decodes nothing.** Check the meter: HEARING NOTHING means aim closer or dim the room; LIGHT, BUT NOT MORSE means step back from the light or block glare; a "blown out" hint means you're too close. Receivers on Safari and Firefox can't lock camera exposure (the browser doesn't expose it) — distance is the lever there.

**The rhythm feels off on my phone.** Torch timing is tuned with a 120 ms lead ([`js/conductor.js`](js/conductor.js)); if marks blur or drag on your device, [docs/DEVICE-TEST.md](docs/DEVICE-TEST.md) §7 explains how to report it and retune.

## Project layout

Android packaging preparation and the remaining Bubblewrap signing/domain steps
are documented in [docs/ANDROID.md](docs/ANDROID.md). The linked web manifest and
launcher icons are included. A Bubblewrap project targets
`morsecode.graydonwasil.com`; local unsigned APK/AAB compilation succeeds.
An installable debug APK is available locally for device testing.
Release signing, domain verification, and device acceptance remain open.

High-resolution exports of the punched-tape M are in [docs/branding](docs/branding/README.md),
including a 1024px PNG and a separate square 512px Google Play listing icon.

```
index.html      the app — open it in a browser
favicon.*       the punched-tape favicon (svg + ico + apple-touch)
css/main.css    the Register's visual world
js/             13 ES modules: morse, schedule, torch, screen, audio,
                conductor, states, hash, copy, app + decoder, watcher,
                receive-session
test/           node --test suites (no test framework, no dependencies)
docs/           user-facing guides (device testing incl. the two-phone
                receiver script, deployment)
DESIGN.md       the design system, recorded from the built app
```
