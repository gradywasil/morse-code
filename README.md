# The Morse Code Broadcaster

Type a message in plain English and your phone's flashlight broadcasts it in Morse code — real hardware, no app install, no server. The interface is a telegraph register: your words punch a paper tape as dots and dashes, and a read-head traverses the tape while the light speaks.

> [!IMPORTANT]
> Nothing you type leaves your device. The camera stream exists only to unlock the flashlight — no video is ever read, recorded, or sent, and the stream is released the moment a broadcast ends.

## Quickstart

No install, no build step, no dependencies.

```bash
# from this directory
python3 -m http.server 8080
```

Open `http://localhost:8080`, type a message, and press **BROADCAST**.

On a phone the LED path needs HTTPS (browsers only expose the camera on secure pages). The quickest options are in [docs/DEVICE-TEST.md](docs/DEVICE-TEST.md) — or publish the folder to any static host per [docs/DEPLOY.md](docs/DEPLOY.md).

## What it does

- **Translates as you type.** Full International Morse (ITU): letters, digits, and punctuation, with the exact timing ratios (dot 1, dash 3, gaps 1/3/7). Characters outside the map are flagged on the tape, never silently dropped.
- **Broadcasts on three channels at once**, kept in sync: the camera LED torch, a full-screen white flash, and a 700 Hz tone — plus the on-screen tape read-out marking each symbol as it fires.
- **Works on every device.** Where the browser can't drive the torch, the screen becomes the lamp and carries the same message at the same timing.

| Environment | Broadcast medium |
|---|---|
| Android Chrome (most devices) | LED torch |
| iOS Safari 17.4+ | LED torch |
| Other browsers, desktops, older devices | Full-screen flash |

- **Named speed steps**: LEARNER 5 WPM (default) · STANDARD 8 · BRISK 12. The default keeps sustained flashing below 3 flashes per second; BRISK shows a rapid-flash caution.
- **One-shot with replay.** Pause and resume mid-message (broadcasts auto-pause when the tab goes to the background). If the torch dies mid-broadcast, the screen takes over without losing the message's position.
- **Shareable links.** The message and speed travel in the URL (`#m=…&s=…`), so a shared link opens ready to broadcast in two taps. Nothing is stored — no cookies, no storage APIs.
- **Pre-flight checks.** An honest "why the camera?" explanation before any permission prompt, a one-dot test flash to verify the light, and a photosensitivity notice before the first broadcast.

> [!WARNING]
> This app flashes a light deliberately. A caution plate is shown before your first broadcast — if you are photosensitive, keep to the LEARNER step and don't watch the light directly.

## Accessibility

Every glow and motion effect degrades cleanly under `prefers-reduced-motion` and save-data modes with no information loss. The interface is fully keyboard-operable, announcements go through a polite live region (per-symbol status stays visual to avoid screen-reader chatter), and the message is always readable on the tape regardless of which channel is broadcasting.

## Running the tests

494 unit tests cover the translator, timing engine, channels, conductor, state machine, and share-hash round-trips:

```bash
npm test
```

## Troubleshooting

**No camera prompt appears.** The prompt only triggers from the **BROADCAST** press, and only on HTTPS (localhost counts). Check the padlock.

**The torch never lights, but tones play.** Some devices report torch support but ignore it — the app detects this and switches to screen mode automatically. You can also press **SWITCH TO SCREEN** mid-broadcast at any time.

**iPhone shows the screen, not the LED.** Torch control needs iOS 17.4 or later; older versions fall back to screen mode by design.

**The rhythm feels off on my phone.** Torch timing is tuned with a 120 ms lead ([`js/conductor.js`](js/conductor.js)); if marks blur or drag on your device, [docs/DEVICE-TEST.md](docs/DEVICE-TEST.md) §7 explains how to report it and retune.

## Project layout

```
index.html      the app — open it in a browser
css/main.css    the Register's visual world
js/             10 ES modules: morse, schedule, torch, screen, audio,
                conductor, states, hash, copy, app
test/           node --test suites (no test framework, no dependencies)
docs/           user-facing guides (device testing, deployment)
DESIGN.md       the design system, recorded from the built app
```
