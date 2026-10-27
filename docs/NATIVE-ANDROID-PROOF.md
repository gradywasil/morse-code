# Morse native Android hardware proof

This is the first Capacitor proof build, alongside the existing Bubblewrap
project. It is not a Play release or a completed migration of the receiver.
The website and existing Play-installed app are unchanged.

## Installable artifact

`artifacts/morse-hardware-test-debug.apk` is a debug-signed, sideloadable APK.
It installs as **Morse Hardware Test**, package
`com.arrangedgodly.morsecode.proof`, so it can coexist with the current Play app.
Minimum Android is 7.0 / API 24; target and compile SDK are 36.

SHA-256:

```text
482D211FF96B10CCAA6BF52EBC998D66B355719693692A6E79DBEDCB0BE66583
```

Do not upload this proof APK to the existing Play listing. The native source
retains release application ID `com.arrangedgodly.morsecode` and version code 2,
but no release build has been signed with the upload key or submitted to Play.

## What it proves

- A local Capacitor WebView loads the bundled Morse interface and fonts, without
  a remote `server.url` or Google Fonts requests at runtime.
- The separate native hardware screen uses Android runtime camera permission,
  CameraX 1.6.2 preview, and Android flashlight APIs. Browser camera permission
  and Digital Asset Links are not involved in this native hardware screen.
- Camera permission belongs to Morse Hardware Test and appears in its Android
  App info page. A button opens that app's Android settings.
- Flashlight works through CameraManager when no preview is active, or through
  CameraX CameraControl when the preview owns the camera.
- Stop, leaving the hardware screen, and backgrounding release the preview and
  turn off the flashlight. A generation counter prevents a late camera startup
  from reopening hardware after Stop or backgrounding.
- Preview content stays on the device. No capture, recording, frame upload,
  microphone access, advertising ID, or analytics SDK was added.

The bundled original interface still uses its web camera/flashlight code. Its
continuous receiver is **not** connected to the native preview. Native frame
analysis, exposure controls, timed flashlight transmission, a final permission
flow, and native Back integration remain migration work after device acceptance.
Message links from the bundled interface also need a public-domain adapter
before a production native release; its current URL is local to the WebView.

The existing privacy policy is bundled as a reference to the current app.
The proof start page separately explains native preview processing. Revise the
public policy, store listing, and Data safety answers for the final native app
before replacing the Play release.

## Build

Requires Node 22 or newer, JDK 21, and Android SDK 36. The local JDK used for this
build is Temurin 21.0.12.1+1. `local.properties` is machine-specific and ignored.
Keep the original Bubblewrap `android/` directory intact.

```powershell
npm ci
npm run android:sync
# Set JAVA_HOME to a JDK 21 installation.
# Set android-native/local.properties to your SDK directory, escaping its colon.
.\android-native\gradlew.bat -p android-native --no-daemon assembleDebug lintDebug
```

The APK is generated at
`android-native/app/build/outputs/apk/debug/app-debug.apk`. The exported artifact
above is a copy. Re-export it and update the recorded hash after rebuilding.
`npm run build:native` only recreates the allowlisted `native-web/` directory;
`android:sync` also updates Capacitor's copy under native assets. Native sources,
bundles, build tools, and APKs are excluded from the Cloudflare payload.

## Verification on 2026-10-27

- 585 Node tests pass, including a packaging check for local assets and exclusion
  of repository, test, dependency, and native build files from the web bundle.
- `assembleDebug lintDebug` succeeds. Android lint reports zero errors and 34
  non-blocking warnings, primarily generated template, dependency-update, and
  launcher/splash asset recommendations. No lint baseline or error suppression
  was introduced.
- APK signature verification passes with the Android debug certificate.
  Compiled metadata confirms the proof package, app label, min/target SDK, and
  camera permission. No microphone or advertising-ID permission is present.
- Android 16 / API 36 emulator: installed and launched with Wi-Fi and mobile
  data disabled; the bundled proof page loaded. The plugin opened the native
  hardware activity.
- Emulator: native permission prompt names Morse Hardware Test. Denial displays
  a usable error, retry presents the native prompt again, and granting it starts
  a streaming emulated rear-camera preview.
- Emulator: flashlight commands succeeded with and without a preview; explicit
  on/off and Stop were exercised. This is an emulated flashlight, not physical
  light-output verification.
- Emulator: after backgrounding, `dumpsys media.camera` showed no active camera
  clients and a disconnect for the proof package. The settings button opened
  Morse Hardware Test App info, with Camera listed under Permissions.
- The native screen and permission dialog were directly inspected. Captures:
  [permission](native-proof/permission-emulator.png) and
  [preview](native-proof/preview-emulator.png). These are emulator evidence,
  not store screenshots or Android 12 device evidence.
- The production npm dependency audit reports zero vulnerabilities. The CLI's
  iOS-only xcode/uuid dependency chain has three moderate development-tool audit
  entries. No forced dependency upgrades were applied to the pinned toolchain.

## First real-phone check

Keep the Play-installed Morse app and its closed-test enrollment intact.
Install this separate APK on each test phone. Android may ask you to allow
installation from the browser or file manager used to open the APK.

1. Open **Morse Hardware Test** and tap **Open native hardware test**.
2. Tap **Enable camera preview**. Confirm the Android prompt names this app;
   choose **While using the app**, and check for a moving rear-camera preview.
3. Tap **Turn flashlight on**, then off. Also try it after stopping the preview.
4. Tap **Stop camera and flashlight**. Confirm the image disappears and the
   physical flashlight is off.
5. Start the preview again, then press Home or Back. Confirm Android's camera
   indicator disappears and the flashlight goes off.

Report phone model, Android version, whether the prompt appears, whether the
preview moves, and the exact status/error if any. A device-wide camera privacy
switch, administrative restriction, unavailable camera, or competing camera app
can still block native access. This build does not bypass Android restrictions.

Physical phones, Android 12, native Morse decoding, precise native transmission
timing, and Play distribution of the replacement remain unverified.

## References

- [Capacitor Android](https://capacitorjs.com/docs/android)
- [Capacitor Android plugins](https://capacitorjs.com/docs/plugins/android)
- [CameraX preview](https://developer.android.com/media/camera/camerax/preview)
- [Android flashlight control](https://developer.android.com/reference/android/hardware/camera2/CameraManager#setTorchMode(java.lang.String,boolean))
