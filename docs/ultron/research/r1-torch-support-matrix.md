# R1 — Torch (flashlight) control support matrix and detection strategy

- **Track:** R1 (Deep Research, ultron-supreme run)
- **Product:** The Morse Code Broadcaster — no-build static web app (plain HTML/CSS/JS, ES modules, no dependencies)
- **Affected plan tasks:** F3 (torch channel), F8 (app state machine)
- **Decision priority:** P0 (blocking decision for F3 implementation and F8 state design)
- **Status:** DECIDED (recommendation below); ready for plan update
- **Delegation record:** Researched by ZCode research subagent (track R1), 2026-08-28. All web evidence fetched 2026-08-28.

---

## 1. Question

Which mobile browsers/devices implement the torch track constraint via
`MediaStreamTrack.applyConstraints({advanced:[{torch:true}]})` after `getUserMedia({video})`?
How reliable is `track.getCapabilities().torch` detection (false positives/negatives, Android vendor
quirks)? What is iOS Safari's actual status? What is the recommended runtime detection order for a
static web app (capabilities check → trial applyConstraints → screen fallback)? Do desktop browsers
expose the constraint? Does `facingMode:'environment'` matter? HTTPS/permission specifics for a
static host?

## 2. Constraints and evaluation criteria

1. No build step, no dependencies; plain ES modules — detection must be hand-rolled (no adapter.js).
2. Torch must modulate at Morse speeds (dot ≈ 60–250 ms at 5–20 WPM) → both torch ON **and** torch OFF
   must work via `applyConstraints`; per-symbol stream restarts are not viable.
3. Camera permission must be requested only from a user gesture (good UX, and iOS Safari requires a
   user gesture for `getUserMedia` in practice).
4. Failure mode must be graceful: full-screen white-flash fallback (already planned).
5. Evidence quality: prefer primary sources (specs, WebKit/Bugzilla/Chromium trackers, library source
   code) over blog hearsay; device reports labeled with dates and versions.

## 3. Findings: who implements torch

### 3.1 Browser/device support matrix

| Browser / platform | torch support | First version | Notes |
|---|---|---|---|
| Chrome for Android | YES | 59 (June 2017) | Torch lives in Chromium's Android camera pipeline; `applyConstraints` full support since Chrome 59. Works on devices with rear flash LED. |
| Other Chromium-Android browsers (Edge, Opera, Samsung Internet, Brave) | YES (expected) | — | Chromium-based Android browsers inherit the Android media stack. Samsung Internet widely reported working; treat as "engine-level, verify at runtime". |
| Android WebView | YES (engine), caveats | — | Shares Chromium media stack, but camera permission prompting must be granted by the host app (`WebChromeClient.onPermissionRequest`); WebView lags Chrome in constraint polish (e.g., old zoom-constraint issues, twilio-video.js #1312). Low confidence; not a target for this app. |
| iOS Safari (all iOS browsers are WebKit) | YES | iOS/Safari 17.4 (Mar 2024); verified by reports at 17.4 and 17.5.1 | WebKit implemented torch Oct 2023 (bug 262131, commit 268853@main). Works via `applyConstraints`; `getCapabilities().torch` present. Chrome/Firefox on iOS use WKWebView → same engine behavior. |
| Safari macOS | API present, no hardware | 17.4 era | Torch code is in `AVVideoCaptureSource` (shared macOS/iOS), but no Mac ships a flash LED → capability absent → screen fallback. |
| Chrome / Edge desktop (Win/macOS/Linux) | Constraint unimplemented/no hardware | — | Laptops have no torch hardware; `getCapabilities()` on laptop webcams does not report torch (historically returned an empty capabilities object on desktop). Screen fallback. |
| Firefox (Android + desktop) | NO | — | `torch` not implemented; Firefox's `applyConstraints` supports only a basic constraint subset (width/height/frameRate/resizeMode; bug 1286945 landed resizeMode-scale support only in Fx 144, Aug 2025). Older Firefox lacked `getCapabilities` entirely (zxing-js/browser #72). Screen fallback. |

### 3.2 Spec status (where torch is actually documented)

- `torch` is defined in the **W3C MediaStream Image Capture** spec — "Extensions" section extending
  `MediaTrackSupportedConstraints` / `MediaTrackCapabilities` / `MediaTrackConstraintSet` /
  `MediaTrackSettings`. Current document: **W3C Working Draft, 23 April 2025** (Recommendation
  track, not yet a Recommendation; constraint extensions shipped by browsers years before maturity).
  - §9.2.1: `torch, of type sequence<boolean>` — "If the source cannot turn on torch, a single false is reported."
  - §10 definition: torch is the fill light "**staying on as long as track is active**" (i.e., torch dies with the track — confirmed by real-world behavior).
  - It is **not** in `mediacapture-extensions` (that doc has no torch) and there is **no caniuse
    feature** entry for torch; MDN documents torch as part of the Image Capture constraint set
    (MediaTrackConstraints/Image Capture docs). WebKit's own engineers described it as "part of the
    MediaStream Image Capture spec" (bug 243075, comment 2, 2022-07-29).

### 3.3 iOS Safari — the definitive timeline

1. **2022-07-21** — WebKit bug 243075 "torch track constraint ignored on iOS" filed by Zach Rattner
   (torch worked on Android demo, not iOS).
2. **2022-07-29** — Eric Carlson (WebKit): "The `torch` constraint is part of the MediaStream Image
   Capture spec, which WebKit doesn't support yet."
3. **2023-09-26 → 2023-10-04** — WebKit bug 262131 "[MediaStream] Add support for torch" filed and
   FIXED; commit `9c0b105d` / `268853@main` (PR #18249) adds `torch` to MediaTrackCapabilities/
   Settings, `setTorch`, `AVVideoCaptureSource::updateTorch`; ignored for `getDisplayMedia`; layout
   test `mediastreamtrack-video-torch.html` exercises `applyConstraints({torch:true/false})` and
   `getCapabilities().torch`.
4. **2024-03-05** — Safari 17.4 ships (torch not called out in release notes; shipped unlisted).
5. **2024-08-06/07** — Reporter confirms on bug 243075 that torch works on **iOS 17.5.1**; Carlson
   confirms he forgot to update the bug; bug closed RESOLVED CONFIGURATION CHANGED.
6. Community corroboration (Stack Overflow 62717417): "As of iOS 17.4 (possibly earlier …), the
   torch constraint now works on Safari."

**Bottom line:** iOS 17.4+ Safari = supported (treat 17.4 as minimum; unverified whether 17.2/17.3
included the Oct 2023 commit). iOS ≤ 16 = unsupported → screen fallback. Because Apple ships WebKit
system-wide, Chrome/Edge/Firefox on iOS inherit the same support from iOS 17.4.

### 3.4 Reliability of `getCapabilities().torch` and known quirks

- **False positives exist.** oberhofer.co (June 2017, Chrome 59 era): a device (Moto G 2014) exposed
  the torch capability but refused to actually comply; author's words: capabilities report torch on
  devices "where it might not work"; worked on Nexus 5 / Galaxy S6. → capability check alone is insufficient.
- **Capabilities can be empty if queried too early** — call `getCapabilities()` only after the track
  is live (`loadedmetadata` on a video element; the oberhofer article had to wait ~500 ms after
  `loadedmetadata` on Chrome 59-era Android). (Historical; still wise to query lazily.)
- **False negatives: capability correctly absent** when there is no LED (NVIDIA Shield K1 rear camera
  has no flash → no torch; spieswl.github.io, 2018-11-14).
- **Torch OFF via `torch:false` is unreliable on some Android devices.**
  - Chromium issue 1246938: "`applyConstraints` works to turn on torch but not off" (Android).
  - spieswl (2018, OnePlus 3T): "Attempting to set the boolean constraint for the torch to false
    does nothing… I cannot turn the LED off … without locking the phone screen."
  - nimiq/qr-scanner (production code, master): "applyConstraints with torch: false does not work to
    turn the flashlight off … Therefore, we have to stop the stream to turn the flashlight off."
    Their `hasFlash()` deliberately uses `'torch' in track.getSettings()` (not getCapabilities).
- **Torch is tied to the track/camera session.** `track.stop()` "will also automatically turn the
    flashlight off" (qr-scanner comment) and matches the spec ("staying on as long as track is
    active"). Screen lock / backgrounding kills the torch (spieswl). → keep the stream alive during
    broadcast; treat `track.stop()` as a guaranteed kill switch.
- **Multi-camera gotcha.** On multi-lens phones the camera Chrome hands out (often the wide-angle
  rear lens) may not be the one with the torch; developers query torch capability per enumerated
  camera to find the flash-bearing lens (w3c/mediacapture-extensions #20, 2020; Chromium 1246938
  repro steps include switching to "the main rear camera that supports torch"). `facingMode:'environment'`
  does not guarantee a torch-capable lens.
- **Firefox:** `getCapabilities` was undefined in older Firefox ("track.getCapabilities is defined in
  Chrome, but not Firefox", zxing-js/browser #72, 2021-10-25) → always feature-detect the function
  itself; unknown constraints also may reject with "Constraints could not be satisfied" (user reports,
  Dec 2024). No torch support on any Firefox (Bugzilla 888177 ImageCapture API still open).
- **Torch ON may flash the camera preview/indicator**; on Android the camera-in-use indicator/LED
  preview is inherent to holding a camera stream. Not avoidable.

### 3.5 `facingMode:'environment'` — yes, it matters

- Torch hardware is on the rear camera. Without `facingMode`, Chrome Android defaults to a front
  camera, which has no flash → capabilities report no torch (false dead-end). The oberhofer article
  recommends `facingMode: {ideal: 'environment'}` to get the more-capable back camera (use `ideal`,
  not `exact`, to avoid OverconstrainedError on one-camera devices such as the Shield K1).
- Multi-lens caveat above still applies after `environment`.

### 3.6 HTTPS / secure context / permissions (static host)

- `getUserMedia` is **secure-context-only**: on insecure origins `navigator.mediaDevices` is
  `undefined` (MDN). GitHub Pages / Netlify / Vercel HTTPS is fine; `file://` and `localhost` also OK
  for testing. App must check `navigator.mediaDevices` before offering torch mode and fall back to
  screen flash otherwise.
- Camera permission prompt appears at first `getUserMedia` (browsers may remember per-origin).
  Request from a user gesture ("Arm torch" tap), never on page load — this also matches F8's
  state-machine entry point. iOS Safari requires HTTPS and a gesture; denied permission →
  `NotAllowedError` → offer screen mode.
- If the page is ever embedded in an iframe, the embedder needs `allow="camera"` (Permissions
  Policy); for the standalone static app this is a non-issue.

## 4. Options considered (detection strategy)

| Option | Description | Reliability | Permission/UX cost | Complexity |
|---|---|---|---|---|
| A. Capabilities-only | `gUM` → `getCapabilities().torch` → decide | Insufficient: documented false positives (Moto G 2014 class), `getCapabilities` may be undefined (old Firefox), does not verify OFF path | One camera prompt | Low |
| B. Trial applyConstraints (probe) | After caps check, apply `torch:true` then `torch:false`, require both to resolve | Highest available: validates the exact signal path the broadcaster needs (incl. OFF) | Same one prompt + a brief LED blink during arming (user-initiated, acceptable; QR apps do the same) | Medium |
| C. Always-try-then-fallback (no caps check) | Skip caps; attempt apply; catch → screen | Misses cheap signal for UI/multi-camera iteration; rejection semantics for unknown constraints vary by browser | Same | Lowest |
| D. Stream-restart OFF workaround (nimiq style) | Turn OFF by `track.stop()` + re-`gUM` | Reliable OFF, but re-acquisition takes ~200–800 ms — impossible per Morse symbol | Extra prompts avoided (permission remembered) but LED gaps break timing | High; not viable for Morse |

## 5. Recommendation

**Capability check → short trial applyConstraints (both ON and OFF) → screen fallback, all
initiated by a user gesture ("Arm torch").** Concretely:

1. On tap: verify `navigator.mediaDevices` (secure context). Else → screen mode.
2. `getUserMedia({video: {facingMode: {ideal:'environment'}}})` (audio:false). Keep the track alive
   for the whole session (torch dies with the track). Handle `NotAllowedError` → screen mode offer.
3. After the track is live (attach to a muted `<video>`, wait `loadedmetadata`), read
   `const caps = track.getCapabilities?.()` (guard the function — Firefox history). If
   `caps?.torch` falsy → (optional, P2) one retry iterating `enumerateDevices()` for another
   environment camera; else → screen mode.
4. Trial probe: `await applyConstraints({advanced:[{torch:true}]})` — on rejection, retry once with
   top-level `{torch:true}` (WebKit's own tests use the top-level form; both accepted by Chromium).
   Then `await applyConstraints({advanced:[{torch:false}]})` (same fallback shape). Wrap both in a
   ~1.5 s timeout. Any rejection/timeout → `track.stop()` and screen mode.
   **Both directions must succeed**: a Morse broadcaster needs reliable OFF; devices where only
   `torch:false` is broken (Chromium 1246938 class) must not use the torch channel.
5. Torch channel armed → state TORCH_READY. During broadcast, ON/OFF = `applyConstraints`
   (`advanced:[{torch:bool}]`), not awaited on the hot path (fire-and-forget with `.catch(noop)`);
   the browser serializes applies on the same track. Provide a hardware-guaranteed kill switch:
   `track.stop()` on Stop/Exit (always extinguishes the LED).
6. Keep a manual "Torch not flashing? Switch to screen" control in the UI (covers the
   resolves-but-no-physical-flash false-positive class that no web API can detect).

Rationale: B layered after A is the only strategy that (a) respects documented false positives,
(b) verifies the OFF transition Morse timing depends on, (c) avoids dead-end prompts on desktop/
Firefox (caps check fails → straight to screen), and (d) needs no dependencies.

## 6. Evidence index (source → exact claim it supports)

1. **W3C MediaStream Image Capture WD, 2025-04-23** — https://www.w3.org/TR/image-capture/
   Defines `torch` (ConstrainBoolean; capabilities `sequence<boolean>`; "staying on as long as track
   is active"); Working Draft on REC track, §9–10 constraint extensions.
2. **WebKit Bug 262131 "[MediaStream] Add support for torch"** — https://bugs.webkit.org/show_bug.cgi?id=262131
   RESOLVED FIXED; commit 268853@main (9c0b105d) 2023-10-04; adds torch to capabilities/settings,
   `applyConstraints({torch:true/false})`, `getCapabilities().torch`; macOS+iOS AVVideoCaptureSource.
3. **WebKit commit 9c0b105d** — https://github.com/WebKit/WebKit/commit/9c0b105d
   33 files, +441/−152; test `mediastreamtrack-video-torch.html` exercises gUM({video:{torch:true}}),
   applyConstraints({torch:true/false}), getSettings/getCapabilities torch; torch invalid for getDisplayMedia.
4. **WebKit Bug 243075 "torch track constraint ignored on iOS"** — https://bugs.webkit.org/show_bug.cgi?id=243075
   2022-07-21 filed; 2022-07-29 "part of the MediaStream Image Capture spec, which WebKit doesn't
   support yet"; 2024-08-06 reporter: works on **iOS 17.5.1**; closed CONFIGURATION CHANGED.
5. **Safari 17.4 / WebKit blog, 2024-03-05** — https://webkit.org/blog/15063/webkit-features-in-safari-17-4/
   Torch not mentioned in notes (shipped unlisted); 17.4 is the first stable widely verified.
6. **Stack Overflow 62717417** — https://stackoverflow.com/questions/62717417/
   "As of iOS 17.4 (possibly earlier…), the torch constraint now works on Safari." (community device report)
7. **Chromium issue 1246938** — https://issues.chromium.org/issues/1246938
   "applyConstraints works to turn on torch but not off" (Android); repro includes switching to the
   main rear camera that supports torch (multi-camera).
8. **spieswl.github.io, 2018-11-14** — https://spieswl.github.io/blog/2018/realities-of-using-webrtc
   OnePlus 3T: torch ON works; `torch:false` "does nothing"; screen lock kills LED. NVIDIA Shield K1:
   no rear LED → torch correctly absent (false-negative guard).
9. **oberhofer.co "Let's light a torch…" (Chrome 59 release, June 2017)** — https://oberhofer.co/mediastreamtrack-and-its-capabilities/
   Chrome-for-Android 59 shipped the capability/torch constraints; desktop Chrome webcam
   `getCapabilities()` returned an empty object (no torch); device false positive (Moto G 2014
   exposes torch, refuses to comply; Nexus 5 / Galaxy S6 OK); capabilities may be empty until track
   live (~500 ms after loadedmetadata); recommend `facingMode:{ideal:'environment'}` for back camera.
10. **nimiq/qr-scanner source (master)** — https://github.com/nimiq/qr-scanner/blob/master/src/qr-scanner.ts
    Production torch code: ON via `applyConstraints({advanced:[{torch:true}]})`; OFF by restarting
    the stream because "applyConstraints with torch: false does not work to turn the flashlight off";
    `track.stop()` "will also automatically turn the flashlight off"; `hasFlash()` uses
    `'torch' in track.getSettings()`.
11. **quagga2 issue #397, 2022-02-23** — https://github.com/ericblade/quagga2/issues/397
    Torch works on Android/Google Chrome; not on Firefox Android; not on iOS Safari (pre-17.4 era).
12. **zxing-js/browser issue #72, 2021-10-25** — https://github.com/zxing-js/browser/issues/72
    "track.getCapabilities is defined in Chrome, but not Firefox" — guard the function; treat torch
    unavailable when absent.
13. **Mozilla Bugzilla 1286945** — https://bugzilla.mozilla.org/show_bug.cgi?id=1286945
    Firefox applyConstraints historically limited (resizeMode/width/height/frameRate; resizeMode work
    landed Fx 144, Aug 2025); no torch implementation. See also bug 888177 (ImageCapture API, open).
14. **MDN MediaDevices.getUserMedia** — https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
    Secure-context-only ("in insecure contexts, `navigator.mediaDevices` is undefined"); user
    permission mandatory; `NotAllowedError` semantics; iframe requires Permissions Policy.
15. **w3c/mediacapture-extensions #20, 2020-01-12** — https://github.com/w3c/mediacapture-extensions/issues/20
    Multi back-camera selection problem; developers use per-camera torch capability to find the
    non-wide lens (multi-camera gotcha). (mediacapture-extensions doc itself contains no torch —
    torch stays in the Image Capture spec.)
16. **WebKit Features in Safari 17.4 (2024-03-05)** + Apple Safari 17.4 release notes — no torch
    mention; support inferred from WebKit commits + on-device reports (items 4/6).

## 7. Tradeoffs, risks, confidence

- **Tradeoff accepted:** trial probe blinks the LED once at arming. Justified: it is the only way to
  verify the OFF path Morse depends on; user-initiated and self-explanatory.
- **Risks:**
  - Probe succeeds but device silently ignores applies at speed (unverifiable from JS) → mitigated
    by manual screen-mode switch + Stop always `track.stop()`s (hardware-guaranteed off).
  - `applyConstraints` promise resolves slower than Morse symbols on some devices (Chrome serializes
    camera ops; torch toggles are fast on tested hardware but not guaranteed) → keep WPM default
    low (≈5–8 WPM), fire-and-forget applies.
  - iOS minimum version ambiguity (17.2 vs 17.4): harmless — detection is runtime, not UA-based.
  - Screen lock/autoplay policies pausing the camera stream mid-broadcast → Wake Lock + visibility
    handling belongs to F3/F8 follow-ups (out of R1 scope).
- **Confidence:** HIGH on the browser matrix (WebKit/Bugzilla + multiple independent device reports);
  MEDIUM on exact iOS first-version (17.4 confirmed by reports; 17.2/17.3 untested), WebView, and
  Samsung-Internet-class browsers (engine-inferred); HIGH that capabilities-only detection is
  insufficient; HIGH that both ON and OFF applies must be probed.

## 8. Implementation consequences and plan updates

- **F3 (torch channel):** implement gUM(ideal environment) → caps guard (`getCapabilities?.()` +
  `caps.torch`) → probe ON then OFF with `{advanced:[{torch}]}` falling back to top-level form, with
  ~1.5 s timeouts; keep stream alive; per-symbol OFF via `torch:false` apply (never stream-restart);
  `track.stop()` as kill switch; muted `<video>` sink to keep track live on iOS.
- **F8 (state machine):** IDLE → (tap "Arm torch") ARMING (gUM + probe) → TORCH_READY | SCREEN_MODE
  (any probe failure) → BROADCASTING → STOP (always `track.stop()` + torch cleanup). Deny/insecure →
  SCREEN_MODE. Manual channel toggle available.
- **Plan adds (small):** manual "switch to screen flash" control; default WPM conservative; document
  HTTPS hosting requirement (GitHub Pages OK) in README/help text.
- **Explicitly out:** per-device UA sniffing, stream-restart signaling, WebView optimization.

## 9. Decision

- **Priority:** P0 — F3/F8 cannot be implemented without this detection order.
- **Status:** Decided 2026-08-28 (see §5). No unresolved blockers.
