# Real-Device Test Script — THE REGISTER (Morse broadcaster)

**Who runs this:** you, on your own phones and computer. **Time:** ~20–30 min for the
full pass (Android ~15, iOS ~8, desktop ~2). **What it's for:** everything below was
built and verified with simulated devices and a fake torch; the one thing no
automation could check is what your actual hardware does. Your results get logged
back into `docs/ultron/production-log.md` (task Q3), and one number —
`TORCH_LEAD_MS` — gets retuned from what you report (see §7).

**Safety, honestly:** the app flashes light by design. LEARNER (5 WPM) stays under
the 3-flashes-per-second safety line; STANDARD and BRISK go above it (BRISK is the
worst at ~5/s). If flashing light has ever triggered a seizure for you or anyone
watching, run only the parts that don't require looking at the light, or skip the
BRISK steps — every subjective check can also be answered by ear (the tone channel
mirrors the light exactly).

Every check below is tagged **[objective]** (a thing either happened or didn't —
anyone would agree) or **[subjective]** (your perception; both "fine" and "feels
off" are useful answers). Please don't turn a subjective miss into a pass because
you feel bad for the app — this run exists so reality can veto the research
assumptions.

---

## 0. What should happen on which device (expected matrix)

| Device / browser | Expected light channel | Why |
|---|---|---|
| Android + Chrome (or Edge/Brave/Samsung Internet) | **Torch** (rear LED) | Chromium camera pipeline has torch since Chrome 59 |
| iPhone/iPad + Safari **17.4 or newer** (any browser on iOS — all are WebKit) | **Torch** — but iOS support is new-ish (shipped Mar 2024, less battle-tested in the wild); some versions/devices may fall back to **screen** | WebKit added torch Oct 2023, first stable in 17.4 |
| iPhone/iPad on iOS ≤ 16 | **Screen** | No torch support in WebKit then |
| Any Firefox, any desktop browser | **Screen** | No torch implementation / no flash hardware |

**How to tell which channel you got:** the app tells you. After arming it shows
either `TORCH READY — LAMP ARMED. STANDING BY FOR THE WORD.` or
`SCREEN READY — SCREEN ARMED. HOLD IT UP — IT IS THE LAMP.` Record which one
appeared — this is the single most important data point per device. If you expected
torch and got screen, also copy the exact one-line reason the app printed (e.g.
`THE CAMERA REPORTS NO TORCH CONTROL.`) into the notes column.

A few quirks this script deliberately probes (from the research matrix, all
documented in `docs/ultron/research/r1-torch-support-matrix.md`): some Android
devices report torch capability but don't physically comply; some turn the LED on
but refuse to turn it off (that device class is probed and rejected on purpose —
expect screen fallback there); on multi-lens phones the camera Chrome hands out is
occasionally a lens without the flash. None of those are test failures — record
what happened; the design's job is to land softly in screen mode when they occur.

---

## 1. Setup — getting the app onto a phone

The camera API (`getUserMedia`) only works in a **secure context** — a real
`https://` URL, or `localhost` (desktop only). A plain LAN address like
`http://192.168.1.42:8000` opened on a phone is **not** secure: the app will detect
that and honestly refuse the torch path (screen mode only). So the phone needs one
of the options below.

All commands run on your computer, in the project directory
(`/Users/arrangedgodly/Documents/Projects/morse-code`). The app is fully static —
there is nothing to build.

### Option A (recommended) — local server + Cloudflare quick tunnel

Real HTTPS URL, no account, no install beyond one brew package, phone doesn't even
need to be on the same Wi-Fi.

```bash
# terminal 1 — from the project directory; serves the app on port 8080
python3 -m http.server 8080          # or: npx serve -l 8080 .

# terminal 2 — once: brew install cloudflared ; then:
cloudflared tunnel --url http://localhost:8080
```

Cloudflared prints a URL like `https://something-random.trycloudflare.com` — open
that on the phone. Keep both terminals open while testing. Caveat: the quick-tunnel
hostname is random and changes each run; re-open the fresh link on the phone each
session (a previously-granted camera permission is remembered per hostname, so a
new hostname = fresh permission prompt — actually convenient for step A3).

No-cloudflared variant, zero install: `ssh -R 80:localhost:8080 localhost.run`
also prints a real HTTPS URL — no account needed; the URL appears in the SSH
banner output when the connection opens. (Avoid `npx localtunnel` for phone testing — its `loca.lt` pages show an
interstitial "tunnel reminder" on mobile browsers that is painful to dismiss on a
second device.)

### Option B — deploy first, test the deployed URL

If you were going to deploy anyway (task D0 is user-owned), do it first:
`docs/DEPLOY.md` holds the operative steps — three free hosts, and the honest
account fact that every publicly viewable HTTPS URL requires a free account
somewhere (Netlify Drop's drag-in is password-gated until you sign up and
claim it). Testing the deployed URL is the most realistic possible
Q3, and it doubles as the deploy smoke test. The tunnel (Option A) remains the
fallback for pre-deploy iteration.

### Option C — desktop only: no tunnel needed at all

`http://localhost:8000` **is** a secure context. For §4 (desktop spot-check) just
run `python3 -m http.server 8000` and open it on the same computer.

*(Android power-user fallback if tunnels are blocked on your network: Chrome on the
phone can be told to trust one LAN origin — `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
enter `http://YOUR-LAN-IP:8000`, relaunch. iOS Safari has no such flag; don't
bother there.)*

**Before you start:** turn screen brightness up (the screen channel needs it), and
do the torch tests in a dim-ish room so LED timing is easy to see. For the share
round-trip you'll want any second device with a browser.

---

## 2. Android test script (Chrome)

Fresh start recommended: Chrome → site settings (ⓘ icon → Permissions → Camera →
Reset / ask every time) so the permission prompt path is exercised honestly.

**A1. Open + type** — Open the link. Type `HELLO`. **[objective]**
Expected: the paper tape punches as you type; the message composer shows HELLO;
status says `IDLE — TYPE A MESSAGE. THE TAPE PUNCHES AS YOU GO.`

**A2. BROADCAST → hazard plate (first visit)** — Tap **BROADCAST**. **[objective]**
Expected: the caution plate (`CAUTION — FLASHING LIGHT`) appears **before anything
flashes or any prompt appears**. Read it, tap **ACKNOWLEDGE — PROCEED**.
(On later runs this first gate is a one-line "CAUTION PLATE ON FILE" re-arm beat —
also fine; note which you saw.)

**A3. Why-camera BEFORE the permission prompt** — This is the key copy-order check.
After acknowledging, you must see the plate `WHY THE CAMERA PROMPT` (four lines,
including "No video is recorded. No video is sent anywhere.") — and the **browser's
own camera permission dialog must not have appeared yet**. Only when you tap
**CONTINUE TO THE PROMPT** does the Android camera permission dialog appear.
**[objective]** Record: copy-plate-first? dialog only after CONTINUE?

**A4. Permission + arming** — Tap **Allow** on the dialog. **[objective]**
Expected: brief `ARMING — TESTING THE LAMP. IT MAY BLINK ONCE.` The LED may blink
once during the internal probe — that is the probe, not a fault. Then
`TORCH READY — LAMP ARMED. STANDING BY FOR THE WORD.`
If you instead land in `SCREEN READY` or `NO TORCH`: that's a fallback — record the
exact reason line and skip A5–A9's torch-specifics (run them in screen mode; the
journey is otherwise identical).

**A5. Test flash — exactly one blink** — A moment (about a third of a second) after
TORCH READY appears, the lamp fires **one** single short blink (one dot at the
current speed). **[objective]** Exactly one blink, then dark. Two blinks, a long
flash, or nothing = record as a finding (nothing = the "capability lies" device
class — the manual screen switch exists precisely for this).

**A6. First broadcast, LEARNER** — Leave speed at **LEARNER** (default, 5 WPM).
Tap **BROADCAST** again. **[objective] + [subjective]**
Expected: STANDBY → CAUTION → GO beats (~0.65 s apart, then auto-start), then
`SENDING — TORCH LIGHT SPEAKS THE TAPE.` with a live `MARK x OF 16 · LEARNER — 5 WPM`
line (HELLO = 16 marks) and the tone sounding each mark in sync.
- Objective: the run takes **about 12 seconds**; the progress line ends at
  `MARK 16 OF 16`; on completion: `DONE — BROADCAST COMPLETE.`
- Subjective (§7 feeds on this): the rhythm of `HELLO`
  (….  .  .-..  .-..  —--) should be **legible as flashes** — four short, one
  short, short-LONG-short-short (twice), three long. Could you hear/see the
  difference between dots and dashes without effort? Did light and tone land
  together?
- The tone key (**TONE / TONE OFF**) mutes/unmutes without changing the light —
  try it once mid-run.

**A7. Rhythm at each speed step** — After the run, tap **REPLAY** is not needed
yet; just select **STANDARD** (8 WPM) and **BROADCAST** again, then **BRISK**
(12 WPM — note it carries a rapid-flash caution; skip if photosensitive).
**[objective] + [subjective]**
Expected durations for HELLO: LEARNER ≈ 11.8 s, STANDARD ≈ 7.4 s, BRISK ≈ 4.9 s.
At each step, judge (subjectively): dots vs dashes still cleanly distinguishable?
Letters separable (the H's four dots not merging into one smear)? Record per step:
legible / squished-but-readable / mush.

**A8. Pause mid-broadcast, resume — marks stay distinct (the F6 fix on real
hardware)** — Start any broadcast, and about halfway through tap **PAUSE**, wait
2–3 seconds, tap **RESUME**. Do this at **BRISK** too — BRISK is where the fixed
defect lived (pausing inside a mark's final 120 ms lead window used to smear marks
together). **[objective] + [subjective]**
Expected: pause shows `PAUSED — HELD AT POSITION.` with the live
`MARK x OF 16 · …` line frozen at the current mark; the light goes OUT and the
tone stops immediately; resume continues from that exact mark — **no mark is lost,
no two marks merge into one long flash, and the gap right after resuming is still
visible as a gap**. Then let it run to DONE.

**A9. Background the tab mid-broadcast** — Start another broadcast; mid-run, switch
apps or press Home (the tab hides). Wait ~5 s, come back. **[objective]**
Expected: the broadcast **auto-paused** while hidden (status `PAUSED`, light off —
no flashes happened while you were away); the camera-in-use indicator (the little
green dot in Android's status bar) may still be present while paused. Tap
**RESUME** — continues cleanly to DONE. At DONE the green camera dot should be
**gone** (the camera is released the moment the broadcast ends — this is the
privacy promise; please record whether the indicator actually disappeared).
**[objective]**

**A10. Torch-loss path (mid-broadcast fallback)** — pick whichever is physically
doable on your device; if neither is safe mid-broadcast, run (a) and note that
(b) wasn't attempted:
- **(a) Manual switch (always available):** start a broadcast, tap
  **SWITCH TO SCREEN** mid-run. **[objective]** Expected: the note
  `TORCH SET ASIDE — CONTINUING ON SCREEN.` + `POSITION KEPT. THE MESSAGE LOSES
  NOTHING.`, status flips to `SENDING — SCREEN LIGHT SPEAKS THE TAPE.`, and the
  white screen-flash continues **from the same mark** to the end.
- **(b) True torch loss:** start a torch broadcast, then force the camera away
  from Chrome — e.g. open the phone's built-in Camera app from quick-toggle/recents,
  or revoke camera for the site in Chrome's site settings mid-run.
  **[objective]** Expected: `LIGHT SOURCE LOST — CONTINUING ON SCREEN.` +
  position kept; message completes on screen.

**A11. Replay** — From DONE, tap **REPLAY**. **[objective]** Expected: brief
re-arm (may re-blink the probe/test dot once), then the same HELLO runs again,
progress restarts cleanly at `MARK 1 OF 16`, completes, camera released again.

**A12. Denied path (optional but cheap)** — RESET, then in Chrome site settings set
Camera → Block for this origin; tap BROADCAST → acknowledge → CONTINUE.
**[objective]** Expected: `PERMISSION DENIED — CAMERA REFUSED. THE TORCH CANNOT
LIGHT WITHOUT IT.` with the offer `BROADCAST BY SCREEN LIGHT` (and `RETRY THE
TORCH`). Take the screen offer; it broadcasts by screen. (Then reset the site
permission back.)

**A13. Share link round-trip** — With HELLO typed and BRISK selected (deliberately
not the default speed), tap **COPY LINK**. **[objective]** Expected:
`LINK COPIED TO THE CLIPBOARD`. Send that URL to a second device (any browser,
any platform — even the desktop) and open it. Expected on the second device: the
composer auto-fills with **HELLO**, the speed control sits on **BRISK**, and the
app announces the link was loaded. Copy the address bar by hand if the clipboard
is finicky — the URL contains `#m=…&s=BRISK`.

---

## 3. iOS test script (Safari, iOS 17.4+)

Same core journey, compressed. Safari settings first if you want the honest
prompt path: Settings → Safari → Advanced → (or just use a fresh Private tab —
private tabs re-prompt for camera).

**i1.** Open the link, type `HELLO`. **i2.** BROADCAST → hazard plate →
**ACKNOWLEDGE — PROCEED**. **i3.** `WHY THE CAMERA PROMPT` plate appears **before**
Safari's camera dialog; tap **CONTINUE TO THE PROMPT**, then **Allow** (Safari's
dialog: "Safari Would Like to Access the Camera"). **[objective]**

**i4. Record the channel** — **[objective]** This is the interesting one on iOS.
After arming you land in either `TORCH READY` or `SCREEN READY`. iOS torch support
shipped in 17.4 (March 2024) and is newer/less battle-tested than Android's —
**either outcome is a valid result**; the point of Q3 on iOS is to learn which
happened on your hardware. Record: iOS version, Safari version, torch or screen,
and the exact fallback line if screen.

**i5. Test flash + one LEARNER broadcast** — If torch: exactly one short blink at
ready **[objective]**, then BROADCAST → full HELLO at LEARNER (~12 s), same
sync-feel judgment as A6 **[subjective]**. If screen: skip the blink check, run
the broadcast by screen (brightness up, phone facing you).

**i6. Pause/resume** — PAUSE mid-run, RESUME. **[objective]** Light/tone stop on
pause, position held (live `MARK x OF 16` line), marks stay distinct after resume.

**i7. Background/lock** — Switch apps or lock the screen mid-broadcast, return.
**[objective]** iOS suspends the page hard — expect auto-pause (never a running
flashlight in your pocket); RESUME continues cleanly to DONE.

**i8. Share round-trip** — COPY LINK → open on the Android device (or desktop);
auto-fills HELLO + speed. **[objective]**

---

## 4. Desktop spot-check (2 minutes, any browser, localhost)

`python3 -m http.server 8000` → `http://localhost:8000` (localhost is already a
secure context — no tunnel needed).

**D1. Screen mode, positive framing, no camera prompt expected on a camera-less
machine** — Type `HELLO`, BROADCAST → acknowledge the plate. **[objective]**
Expected: you land in `SCREEN READY — SCREEN ARMED. HOLD IT UP — IT IS THE LAMP.`
(or the `NO TORCH` step on the way) — screen offered as a first-class light
source, never as an apology, and **no torch ever fires**.
Honest nuance, so you're not surprised: detection is live, not sniffed — on a
desktop **with** a webcam the app may legitimately show the why-camera plate and
the browser camera prompt once (it can't know there's no torch until it looks);
after granting, it lands in screen mode with a reason line. On a desktop
**without** a camera, no prompt ever appears. Record which pre-path you saw —
both are correct; the requirement is the positive screen framing + no torch.

**D2. One screen broadcast at LEARNER** — Full-screen white/black flashing in
lockstep with the tone, `MARK x OF 16` progress, ~12 s, DONE, REPLAY works.
**[objective] + subjective sync-feel note (screen has no lead constant — light and
tone should feel locked together; if they don't on desktop, that's a finding).**

---

## 5. Results table (fill one row per device)

| # | Device model | OS ver | Browser | Torch Y/N (or screen-fallback + reason line) | Test flash = 1 blink | Rhythm legible LEARNER / STANDARD / BRISK | Pause/resume distinct marks | Background auto-pause + resume | Audio↔light sync feel | Camera released at DONE (indicator off) | Share round-trip | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | | | Chrome ___ | | | / / | Y / N | Y / N | aligned / lead / lag | Y / N | Y / N | |
| 2 | | iOS ___ | Safari ___ | | n/a if screen | / / | Y / N | Y / N | aligned / lead / lag | Y / N | Y / N | |
| 3 | desktop | | | screen (expected) | n/a | / / | Y / N | Y / N | aligned / lead / lag | n/a | Y / N | |

Free-text answers that matter as much as the table:
- The sync-feel question, per speed, in your own words: *"watching the LED and
  listening, did every flash land with its beep?"* — perfectly together / light
  visibly late / light visibly early / couldn't tell.
- Anything that felt wrong at BRISK specifically (that's the step nearest the
  edge of the design).
- Anything that confused you in the copy (what you expected vs what the plates said).

## 6. Pass criteria

**Must hold (any device, any channel) — a miss here is a defect:**
1. Why-camera plate appears **before** the browser permission prompt. [objective]
2. Test flash is **exactly one** blink (torch devices). [objective]
3. A full HELLO broadcast completes at LEARNER, STANDARD **and** BRISK with correct
   totals (`MARK 16 OF 16`, DONE) and expected durations (≈11.8 / 7.4 / 4.9 s).
   [objective]
4. Pause → light and tone stop immediately, position line live, resume loses no
   marks and merges none (incl. at BRISK). [objective]
5. Backgrounding/hiding the tab auto-pauses; resume works; no flashing while hidden.
   [objective]
6. Camera released at DONE (Android green dot disappears). [objective]
7. Screen mode is the landing for every unsupported/denied/insecure path, framed
   positively, message broadcastable. [objective]
8. Share link round-trips message + speed on a second device. [objective]

**Judgment calls (report, don't grade yourself):** rhythm legibility per speed,
sync feel, screen readability at distance, copy tone. These feed the constants
below — "feels off" is a pass-tier answer that triggers a retune, not a failure.

**Known-acceptable outcomes (record, not bugs):** one probe blink before the test
flash; screen fallback with a printed reason on devices from the R1 quirk classes;
a camera prompt on a webcam-equipped desktop; iOS landing in screen mode on ≤16 or
on a 17.4+ device where the probe fails — that's the matrix working.

## 7. What to report back (and the TORCH_LEAD_MS retune)

The torch is commanded **120 ms early** (`TORCH_LEAD_MS = 120` in
`js/conductor.js`) to absorb measured-in-the-wild LED lag: research (R2,
`docs/ultron/research/r2-latency-wpm-sync.md`) estimated typical LED lag at
40–130 ms but **never measured it on real hardware — this test is the
measurement.** The constant may be retuned anywhere in **0–200**; the sync
design tolerance is 45 ms (ITU-R BT.1359 detectability).

Report, per torch device:
1. **Sync feel per speed** (aligned / light lags the tone / light leads the tone),
   and whether it was consistent across the whole message or only at the start.
2. **BRISK legibility** (legible / squished / mush).
3. Whether the LED ever got **stuck on** (an OFF command ignored — the
   torch:false quirk class) at any speed.
4. The table row + free-text from §5.

Retune rule (what will happen with your data): light consistently **lagging** the
tone → raise the lead toward 200 in ~30–40 ms steps (e.g. 120 → 160) and re-feel;
light consistently **leading** (flash before beep) → lower toward 0; solidly
aligned at LEARNER and STANDARD with BRISK "squished-but-readable" → keep 120 and
let BRISK stay the opt-in step it is. A device whose lag survives a 200 ms lead
belongs to the slow-HAL class and routes to the screen channel — also a valid
result.

Report back in any form (the table, bullet points, a voice memo transcription) —
results get logged as the Q3 completion entry in `docs/ultron/production-log.md`,
and Q3 closes when they're in.

---

# RUN 2 — THE RECEIVER (added 2026-09-01)

**What this adds:** the RECEIVE half. One phone broadcasts (torch or screen), a
second phone watches with its camera and decodes the message back into text —
no pairing, no agreed speed. Everything below was verified end-to-end with a
fake camera in a real browser pipeline (synthetic light → decode → clipboard,
all three speeds); what automation cannot check is your actual cameras,
auto-exposure behavior, and room lighting. **You need two phones.**

**Receiver expectations by device (research R1/R2):**

| Receiver browser | Expectation |
|---|---|
| Android + Chrome-family | Best case: rVFC sampling, possible silent exposure lock where hardware advertises it |
| iPhone + Safari 15.4+ | Works; no exposure control exists (verified in WebKit source) — rely on distance guidance |
| Firefox (any) | Works (rVFC since 132); no exposure control — same guidance |

## R1. First receive (the demo itself) — ~4 min

Setup: phone A (sender) and phone B (receiver), same URL, a dim-ish room,
2–4 m apart. Sender picks a short word (e.g. HI), LEARNER speed.

1. **[objective]** B: tap **RECEIVE** on the mode lever → the WHY THE CAMERA
   PROMPT plate appears **before** any browser prompt.
2. **[objective]** B: tap **BEGIN LISTENING** → the browser camera prompt
   appears from that tap (not before), grant it → the aperture goes live,
   meter reads **HEARING NOTHING**, station reads LISTENING.
3. **[objective]** A: press BROADCAST. Within the first 1–2 letters B's meter
   flips to **HEARING LIGHT** and dots punch onto the paper tape.
4. **[objective]** B: letters print above their punches as words complete;
   the read-head lamp flickers with each heard flash.
5. **[objective]** A's message ends → B's meter returns to quiet → after
   ~5 s the session finalizes: **HEARD** state, the message stands on the
   tape, **COPY MESSAGE** available.
6. **[objective]** B: tap COPY MESSAGE, paste anywhere → the text matches
   what A sent (a lost first letter is honest — see R4).

## R2. Speed matrix — ~6 min

Repeat R1 with HI or SOS at each step, sender choosing the speed, receiver
doing NOTHING differently: **[objective]** decode succeeds at LEARNER 5,
STANDARD 8. **[subjective]** BRISK 12 (dots are 100 ms — tightest case):
does it decode, and does it feel reliable or flaky?

## R3. Light sources — ~5 min

1. **[objective]** A on an iPhone or desktop (screen-flash mode) broadcasting:
   B still decodes (hold A's screen facing B, full brightness).
2. **[subjective]** A bare flashlight pointed by hand sending rough Morse
   (dot ~½ s): best-effort — report what happens, no pass/fail.

## R4. Honest-degradation checks — ~4 min

1. **[objective]** B taps RECEIVE and grants the camera **while A is already
   mid-message** → B's tape shows a **PARTIAL** note; the message decodes
   from wherever listening caught a clean edge, never a fabricated start.
2. **[objective]** B aims away from the light (at a wall) → meter reads
   HEARING NOTHING with the aim hint; no text appears.
3. **[subjective]** B aims at a busy light (window, LED sign) → meter reads
   **LIGHT, BUT NOT MORSE** (noise), not garbage text.
4. **[subjective]** B very close (<0.5 m) to the torch → the BLOWN OUT hint
   appears; moving back restores decoding. This is the saturation case R2
   research flagged as the physical limit.
5. **[objective]** While listening, B switches the phone away (backgrounds
   the tab) → return: the session finalized, the aperture is dark.
6. **[objective]** After any session ends, the camera indicator (OS-level
   dot/LED) is OFF — the eye closed.

## R5. Privacy spot-check — ~1 min

1. **[objective]** With the receiver idle (not listening), grant-flow only
   after BEGIN LISTENING: reload the page in RECEIVE mode and just wait at
   the plate → no camera prompt ever arrives on its own.
2. **[objective]** Browser padlock/site-info → camera permission is asked
   in-context, and the page's network tab (desktop) shows no requests
   beyond fonts while receiving.

## What to report back

For the live ticker correction, send `HELLO ROOM` at each speed. The opening H
should show four dots and its letter during the gap before E. Completed groups
must keep moving through the visible tape as new letters arrive. The final M
should appear after its letter gap, before the five-second completion timeout.
Press STOP after M appears and confirm the completed record is retained.

For the 2026-10-26 ambient-light correction, repeat R1/R2 with a steady bright
window or lamp in another part of the preview. Then repeat in normal room
light and a brighter room, without a sender, and confirm that the preview
does not wash out when the exposure probe runs after camera startup. Record
the phone/browser, lighting, sender distance, and exact expected/received text.
Synthetic frames pass at 24/30/60 fps across the three sending speeds, but
those results do not verify the physical camera's exposure or torch timing.

For each numbered check: pass/fail (objective) or fine/off (subjective), plus
phone models + browser versions, room brightness (dark/dim/normal/bright),
and distance. For BRISK flakiness: roughly what fraction of letters decoded.
Results land in `docs/ultron/production-log.md` as the **T-Q3-run2** entry;
noise/saturation reports feed the meter-hint copy and (if needed) a
follow-up on the exposure posture (research D5's deferred user-facing lock).
