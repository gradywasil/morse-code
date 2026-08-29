# Town Hall — The Morse Code Broadcaster

Status: **COMPLETE — all clusters signed off.** Final record below.

## Problem statement & target users

**Problem:** There is no dead-simple, zero-install way to turn a plain-English message into a physically broadcast light signal from a phone. The moment a webpage can blink the actual camera LED is a genuine "wait, the web can do that?" surprise.

**Target users:** People who want a fun demo / party trick — show off what a phone browser can do, send a silly message across a dark room, share a link that makes strangers' phones blink. Secondary: Morse-curious onlookers who watch the dot/dash readout.

**Job-to-be-done:** "Type a sentence, press one button, and my phone's light (and sound) broadcasts it in Morse across the room — within 15 seconds of opening the page."

## Framing decisions (user-confirmed)

| Decision | Choice |
|---|---|
| Purpose | Fun demo / party trick — wow and shareability outrank everything |
| Devices without torch (iOS Safari, desktop) | Screen-flash fallback as a first-class mode, same Morse timing |
| Receiver/decoding | Out of scope (possible future phase) |
| Delivery | Static web app, no server, any static host |
| Audio tones | **In MVP** (user override of lean recommendation) — light + synchronized sound |
| Share link | In MVP — message + WPM in URL hash |
| Repeat | One-shot + replay button; no loop mode |
| Speed | WPM slider, low photosensitivity-aware default, capped range |
| Character set | Full ITU map (A–Z, 0–9, punctuation), no prosigns, unknown chars visibly flagged |

## Role Perspectives

### Product / user value
- **Supports:** The hook (real LED hardware from a webpage) is instantly demonstrable, zero-install, shareable as a link. Demo shape: open → type → broadcast in under 15 seconds, no account, no config.
- **Strongest concern:** Device roulette — the wow depends on hardware the visitor holds. On an iPhone the LED becomes a screen flash; screen-flash mode must be framed as a feature ("hold your screen up"), not a consolation prize.
- **Cost/risk:** One-joke product — every added feature delays the wow.
- **Resolution:** 15-second demo moment is the organizing constraint; share link adopted because it amplifies distribution.

### UX / UI
- **Supports:** One input, one big broadcast button, live Morse preview while typing, WPM slider, clear medium indicator (torch vs screen vs audio channels).
- **Strongest concern:** Camera permission must be requested from a user gesture tied to intent (Broadcast button), never on page load, with honest explanation of why a flashlight needs camera permission.
- **Resolution:** Full state storyboard (below) is an acceptance criterion; pre-permission copy owned by planning.

### Frontend
- **Supports:** Static page. Torch: `getUserMedia({video})` → `getCapabilities().torch` → `applyConstraints({advanced:[{torch}]})`. Screen fallback: fullscreen white overlay via Fullscreen API. Timing engine: on/off schedule from dot-units (dot 1, dash 3, symbol gap 1, letter gap 3, word gap 7). Audio: Web Audio tones on the same schedule.
- **Strongest concern:** Timing accuracy — async torch latency, vendor variance, background-tab throttling, and now a second timing-sensitive channel (audio) that must stay in sync with light.
- **Resolution:** Latency measurement and safe WPM cap → research; latency-absorbing scheduler design → production.

### Backend / data / integrations
- **Supports:** None needed. Browser hardware APIs only (Camera/Torch, Fullscreen, Web Audio).
- **Non-goals:** Any server, accounts, message persistence, analytics.

### Quality / reliability
- **Supports:** Translation and schedule generation are pure functions — unit-testable without hardware.
- **Strongest concern:** Android torch fragmentation across vendors. Pre-flight test flash lets the user verify the LED before committing the full message.
- **Resolution:** Test-flash accepted into acceptance criteria (placement detail → production).

### Security / privacy
- **Supports:** Video track opened only to unlock torch; no frames read, recorded, or transmitted. Nothing leaves the device. HTTPS required by getUserMedia (static hosts qualify).
- **Strongest concern:** Camera prompt for a flashlight feels invasive — transparent messaging before the prompt is mandatory.
- **Resolution:** Pre-permission copy in planning; no-frame-access verified in code review.

### Accessibility
- **Supports:** Multimodal broadcast — light (torch/screen), synced dot/dash readout, audio tones — perceivable regardless of which channel works.
- **Strongest concern:** **Photosensitivity.** Flashing >3 Hz risks seizures (WCAG 2.3.1). At 20 WPM repeated dots approach 8 flashes/sec. Mitigations adopted: photosensitivity notice before first broadcast, low default WPM, capped upper WPM, `prefers-reduced-motion` honored.
- **Resolution:** Default WPM value + warning copy → planning.

### Domain / content accuracy (International Morse)
- **Supports:** ITU International Morse: A–Z, 0–9, punctuation `. , ? ' ! / ( ) & : ; = + - _ " $ @`. Timing in dot-units: 1/3/1/3/7.
- **Strongest concern:** Non-Latin variants (Cyrillic, Wabun) out of scope; unmappable characters visibly flagged, never silently dropped. Prosigns out (typing S-O-S already yields correct letters).
- **Resolution:** Character map locked here; per-character unit tests in production.

## Primary journey & states

**Journey:** Open page (or shared link) → type message (live Morse preview, unknown chars flagged) → optionally set WPM → press Broadcast → pre-flight (camera permission if torch available + test flash option; else screen mode offered with photosensitivity notice) → broadcast runs (torch/screen + audio + synced readout) → done → replay button / share link available.

**State matrix (must render legibly):**
- torch supported × permission granted → torch + screen + audio
- torch supported × permission denied → offer screen-flash + audio, explain denial
- torch unsupported (iOS Safari, desktop, older Android) → screen-flash + audio, framed positively
- broadcasting / paused / done / errored (track lost mid-broadcast → fallback to screen without losing message)

## Success measures & acceptance criteria (tightened, adopted)

**Automatable:**
1. Translation correctness: every ITU-mapped character produces correct Morse (unit tests, full map coverage); unknown characters flagged in preview, never dropped.
2. Timing schedule: generated on/off schedule respects 1/3/1/3/7 dot-unit ratios exactly (unit tests).
3. Cold open to broadcast start ≤ 15 s, ≤ 3 taps on a supported phone; shared link to broadcast ≤ 2 taps (message auto-filled from hash).
4. State matrix: every cell above renders a distinct, explanatory UI state (scripted walkthrough).
5. Photosensitivity: notice shown before first broadcast; default WPM is the low value; upper WPM capped; `prefers-reduced-motion` honored.
6. URL hash round-trips message + WPM exactly.
7. Privacy: no video frame APIs invoked anywhere in the codebase; camera track released after broadcast completes or is cancelled.

**Provisional (research-informed, verified on user's available hardware):**
8. Torch latency absorbed within measured bounds — broadcast legible at default WPM on a real Android torch device.
9. Audio/light sync tolerance set by research findings, then verified perceptually.
10. Torch vendor/browser support matrix documented from real tests where hardware allows; unsupported paths degrade cleanly.

**Dependency:** Real Android torch testing requires the user's phone; recorded as an explicit dependency, not a silent assumption.

## Constraints, assumptions, risks (confirmed as written)

- Torch fragmentation across Android vendors (forced-off torch, ignored constraints, settle times).
- `applyConstraints` async latency + background-tab timer throttling.
- HTTPS requirement for getUserMedia.
- Camera-permission optics for a flashlight app.
- Photosensitivity risk (mitigated per acceptance criteria 5).
- One-joke-product scope risk (mitigated: lean MVP boundary below).
- Assumption: a static host (GitHub Pages/Netlify) is acceptable deployment.

## MVP boundary & non-goals

**In:** text→Morse translation (full ITU, flagged unknowns), torch broadcast (Android where supported), screen-flash broadcast (everywhere), synchronized audio tones, live Morse preview, WPM slider (low default, capped), pre-flight test flash, photosensitivity notice, one-shot + replay, shareable URL hash, synced dot/dash readout.

**Non-goals:** receiver/decoding, continuous loop mode, prosigns, non-Latin Morse variants, server/accounts/persistence/analytics, native wrapper, message history.

## Open-question dispositions (confirmed)

| Question | Owner | Blocking status |
|---|---|---|
| Torch device/browser support matrix | research | Informs fallback UX; does not block planning (fallback already decided) |
| Real torch latency, safe WPM cap, audio/light sync tolerance | research | Informs planning defaults; does not block planning |
| Default WPM value, photosensitivity warning copy | planning | Blocks only production of those bits |
| URL hash format | planning | Trivial; blocks nothing |
| Camera-stream lifecycle (release vs keep for replay) | production | Implementation detail; outcome preserved |
| Test-flash placement | production | Implementation detail |
| Screen-flash visual treatment | production/design | Implementation detail |

## Decisions with rationale & rejected alternatives

- **Audio in MVP** — user override; theatrical value of synced light+sound outweighs second-channel timing risk. Rejected: lean light-only (Advocate recommendation).
- **Screen-flash fallback as first-class mode** — device roulette otherwise kills the demo on iPhone. Rejected: torch-only with unsupported message.
- **Share link via URL hash** — viral distribution with zero server and zero on-device failure modes. Rejected: server-backed sharing (violates static constraint).
- **One-shot + replay** — replay is the broadcast button re-run; loop adds state complexity. Rejected: loop toggle.
- **Full ITU map, no prosigns** — lookup table is free; prosigns add parser complexity for marginal value.
- **Tightened success measures** — automatable core + provisional hardware-dependent tier instead of untestable promises.

## Cluster sign-off record

1. Problem & users — ✅ confirmed (framing round)
2. MVP boundary & non-goals — ✅ signed off (Challenger/Advocate round 1)
3. Journeys, states, success measures — ✅ signed off (Challenger/Advocate round 2)
4. Constraints/assumptions/risks — ✅ confirmed as written
5. Open-question dispositions — ✅ confirmed

## Handoff note for plan-it-out

Scope is settled: static single-page app, three broadcast channels (torch/screen/audio) driven by one timing engine over a pure text→Morse→schedule core, plus URL-hash sharing and a photosensitivity-safe pre-flight flow. Research questions (torch matrix, latency, sync tolerance) inform but do not block planning — plan the scheduler with a research-informed latency-absorption design and mark the WPM defaults as research-informed placeholders. Backend/data roles have nothing to plan. UI surface exists, so the design phase (impeccable) runs before planning per supreme's routing.
