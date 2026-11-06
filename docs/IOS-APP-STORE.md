# Morse iOS: from this repo to the App Store

Prepared November 6, 2026. The iOS project was generated and ported on Windows.
It has **not been compiled yet**, because Xcode only runs on macOS. The first
build on the Mac is also the first compile check of the Swift code.

## What is in the repo

- `ios/` is the Capacitor 8.5.3 Xcode project. It uses Swift Package Manager, so CocoaPods is not needed.
- `ios/App/App/MorseHardwarePlugin.swift` ports `MorseHardwarePlugin.java`. It keeps the same JS name,
  methods, events and session rules, so the shared web code runs unchanged:
  - The flashlight uses `AVCaptureDevice` torch control. Timelines run on a strict, zero-leeway
    dispatch timer.
  - The receiver uses `AVCaptureSession` at 640x480 and 30 fps, with a fixed 5 ms exposure at
    ISO 200. It reads the same 32x32 luminance samples and builds the same 8x8 tiles as Android.
  - Other features: Core Haptics pulses, the idle-timer keep-awake, status-bar style, the Settings
    deep link, and closing the hardware when the app goes to the background or the page navigates.
- `MainViewController.swift` registers the plugin. `SceneDelegate` and `Main.storyboard` use that controller.
- `Info.plist` has the camera purpose string, `ITSAppUsesNonExemptEncryption = NO` (so no export
  compliance prompt), a light status bar, and arm64. `PrivacyInfo.xcprivacy` declares no
  tracking and no collected data.
- The app is iPhone only (`TARGETED_DEVICE_FAMILY = 1`), so no iPad screenshots are needed. It
  still runs on iPads in iPhone mode.
- Version `1.2.0`, build `1`. Increase `CURRENT_PROJECT_VERSION` for every upload.
- The icon comes from `docs/branding/morse-icon-1024.png`, flattened to RGB. The launch screen is
  plain `#171008`.
- `npm run ios:sync` bundles the release web build with iOS wording and
  `native/ios/privacy.html`, then copies it into the Xcode project.

Behavior that differs from Android: iOS does not need camera permission for the torch, so a
denied camera still allows flashlight broadcasts. Camera access is only needed to receive.
Verify this on the device.

## 1. One-time Mac setup

1. Install **Xcode** from the Mac App Store, open it once, and let it install the iOS platform.
2. In Xcode, go to Settings, then Accounts, add the Apple ID that holds the developer membership, and
   confirm the team shows **Apple Developer Program**. "Personal Team" means the wrong account.
3. Install Node.js 20 or newer from nodejs.org. Get this repo onto the Mac, either with
   `git clone` after pushing or by copying the folder without `node_modules`.
4. In the repo folder, run:
   ```sh
   npm ci
   npm run ios:sync
   npx cap open ios
   ```
   Xcode opens and resolves the Capacitor Swift packages. The first time takes a minute or two.

## 2. Signing

1. In Xcode, select the **App** project, then the **App** target, then **Signing & Capabilities**.
2. Check **Automatically manage signing** and set **Team** to your developer team.
3. The bundle identifier is `com.arrangedgodly.morsecode`. Xcode registers it in your
   account automatically. If Xcode says the ID is unavailable, someone else owns it. In that
   case, change it here and in `capacitor.config.json`.

## 3. Run on your iPhone (before any upload)

1. Connect the iPhone with a cable. On the phone, tap **Trust**. Then turn on **Settings, Privacy &
   Security, Developer Mode** and let the phone restart.
2. In Xcode's device menu, pick the phone and press Run (⌘R). If Xcode reports Swift build errors,
   copy them back to Claude to fix.
3. Check on the phone:
   - Broadcast by flashlight: the timing looks right and the flash is clean.
   - Deny camera access, then broadcast again. The flashlight should still work.
   - Receive from a second phone or the website. The preview sits in the right place and
     decodes the message.
   - Haptics fire on marks.
   - The screen stays on during a run.
   - Background the app mid-run: the torch turns off and the camera closes.
   - The privacy link opens and back works.
   - The status bar is readable on both light and dark themes.

## 4. Create the App Store Connect record

At https://appstoreconnect.apple.com, go to **Apps**, then **+**, then **New App**:

- Platform: iOS. Name: **Morse**. Names are unique across the whole store, so have a backup ready,
  such as "Morse: Light Signals".
- Primary language: English. Bundle ID: `com.arrangedgodly.morsecode`. SKU: `morse-ios`.

## 5. Upload a build

1. In Xcode, set the run destination to **Any iOS Device (arm64)**, then choose **Product, Archive**.
2. The Organizer opens. Choose **Distribute App**, then **App Store Connect**, then **Upload**, and keep
   the defaults.
3. After 5 to 30 minutes the build appears under **TestFlight** in App Store Connect, and you get an email.
4. Under TestFlight, open **Internal Testing**, add yourself, then install the **TestFlight** app on
   your iPhone and install Morse from there. This checks the real store-signed build.

Every upload needs a higher build number. Bump **Build** in the target's General tab, or change
`CURRENT_PROJECT_VERSION`.

## 6. Store listing (App Store Connect, under your app)

- **Screenshots**: 6.9-inch iPhone size, 1320x2868 or 1290x2796, portrait, 3 to 10 images.
  Take them on a large iPhone or in the iPhone 16 Pro Max Simulator. The Simulator has no camera
  or torch, so only the interface can be shown there.
- **Description, keywords, support URL**: you can adapt the Play listing in `docs/store-listing/`.
- **Privacy Policy URL**: this must be public. The current site page `/privacy-native` describes
  Android. Publish the iOS policy (`native/ios/privacy.html`) on the site first, for example at
  `/privacy-ios`.
- **App Privacy**: choose **Data Not Collected**.
- **Age rating**: answer the questionnaire. Morse has no objectionable content.
- **Category**: Utilities. **Price**: Free.

## 7. Submit for review

Choose the TestFlight build in the version's **Build** section, then **Add for Review**, then **Submit**.
Review usually takes 1 to 2 days. In **Review Notes**, explain the hardware:

> Morse sends text as flashes from the rear flashlight (or the screen) and decodes flashes
> it sees through the rear camera. Camera frames are reduced to brightness samples on the
> device; nothing is recorded or uploaded. To test receiving, open
> https://morse.graydonwasil.com on another device, broadcast by screen light, and point
> this iPhone's camera at it.

Common rejection reasons: guideline 4.2 (an app that is just a website). Native torch and camera
control are the answer to that. Also: a camera purpose string that is too vague, and a privacy
URL that doesn't load.
