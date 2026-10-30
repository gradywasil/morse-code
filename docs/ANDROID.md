# Android packaging

The latest native update is prepared for Play as version **1.1.1**, code **7**.
Use the signed `artifacts/morse-1.1.1-play.aab`; see
[native Play release preparation](NATIVE-PLAY-RELEASE.md) for verification and
upload instructions. It has not been uploaded or accepted by Play yet.

## Earlier Bubblewrap release

The separate [native Android hardware proof](NATIVE-ANDROID-PROOF.md) now builds
with Capacitor under `android-native/`. It tests app-owned camera permission,
preview, and flashlight APIs. It has not replaced the Bubblewrap Play release
described below.

## Current status

The current Play upload artifact is **`android/app-release-bundle.aab`**,
built and signed on 2026-10-26 with the current Morse name, new domain, and clean
launcher/splash artwork. It is version code 1, targets API 36, and retains
package ID `com.arrangedgodly.morsecode`. Jarsigner verification passes; its
signing certificate matches the private upload key. All 423 non-signature
bundle entries remain unchanged by signing. Local artifact hashes and the
public upload-certificate fingerprint are in ignored `android/play-upload-info.json`.

Upload this signed file to Play Console's **Test and release > Testing >
Internal testing > Create new release > App bundles > Upload**.
The AAB under `app/build/outputs/bundle/release/` is an unsigned intermediate.

Receiver changes were pulled through `44bdac0` on 2026-10-26. Local corrections
cap manual exposure in real shutter-time units, detect changes within each
sampling tile, and preserve dark gaps between dashes. Synthetic camera-frame
tests cover all sending speeds at 24, 30, and 60 fps. Physical camera exposure
and two-phone decoding still need device verification.

The web app now links `manifest.webmanifest`, with relative launch/scope URLs,
192px and 512px launcher icons, and a maskable icon derived from `favicon.svg`.
`.assetsignore` excludes development files, Android output, and signing keys
from the root-served Cloudflare Worker. No service worker or offline cache is
implemented. This preparation does not establish offline support or TWA
verification.

The Bubblewrap Android project is generated locally in `android/`. Its source
configuration, `android/twa-manifest.json`, is retained as a source file;
generated Java/resources, SDK paths, Gradle caches, and binaries are ignored.
The user selected the new `https://morse.graydonwasil.com` production origin
and accepted the package name `com.arrangedgodly.morsecode`. The wrapper launches
the hosted app; web changes are not embedded in the APK. Both the tracked
configuration and local generated project now use the name Morse and this origin.

Generation used Bubblewrap 1.27.0's core generator with local manifest/icon
responses, without fetching or publishing those assets on the production
host. The project compiles and targets API 36. Minimum API is 24, required by
the resolved Android Browser Helper 2.7.4 dependency. The first build with API
23 failed the manifest merger; raising the minimum to 24 fixes that conflict.

The local build uses Java 17 and Gradle 8.11.1. Gradle installed Android build
tools 35.0.0 into the existing SDK using its accepted license. Bubblewrap was
installed into a temporary tools directory, with no web-app dependencies added.
The private upload keystore now exists outside the repository at
`C:\Users\arran\morse-code-signing\release.keystore`, alias `morsecode`.
Its password was supplied through a private prompt and is not in source or
command arguments. Back up this keystore and the chosen password privately;
reuse the key for future bundle uploads. The public certificate is exported
beside it as `upload-certificate.pem`. No Android device was connected when
`adb devices` was checked.

`gradlew.bat --no-daemon assembleRelease bundleRelease` completed successfully
on 2026-10-26. Both release artifacts are unsigned. The generated template
reports a non-fatal warning about its legacy manifest `package` attribute and
Gradle deprecation notices; compilation succeeded with the pinned wrapper.
That older unsigned release APK predates the branding/domain update. The AAB
has since been rebuilt with current assets and separately signed as described
above; no current signed release APK has been produced.

`gradlew.bat --no-daemon assembleDebug` also completed successfully. The
installable test APK is `android/app/build/outputs/apk/debug/app-debug.apk`.
It was rebuilt after the branding/domain update and uses the Android debug
certificate. It has not been installed or run on a device.

Live HTTP checks on `morse.graydonwasil.com` returned 200 for `/`, the manifest,
and both wrapper icon URLs. The website association is now defined in
`.well-known/assetlinks.json`, with the three public SHA-256 certificate
fingerprints supplied from Play Console on 2026-10-26. The same fingerprints
are retained in `android/twa-manifest.json` for regeneration. Publishing this
file completes the website side of TWA verification; toolbar-free launch still
needs confirmation on the Play-installed app. Physical camera behavior also
needs device testing.
The future website-to-Play promotion is scoped in [PLAY-PROMOTION.md](PLAY-PROMOTION.md)
and awaits a public store listing.

## Regenerate after deploying the manifest

Deploy the web changes to the chosen HTTPS host. Confirm the manifest and all
three icons return their actual content, rather than an HTML fallback.

The current local Android project is already generated. From a fresh clone,
regenerate it from the source configuration after deploying the web assets:

```powershell
Set-Location android
npx --yes @bubblewrap/cli@1.27.0 update --skipVersionUpgrade
```

Bubblewrap's setup prompts can configure/download the JDK and Android SDK.
The signing configuration names the upload key outside this
repository, `../../morse-code-signing/release.keystore`, alias `morsecode`.
On this machine the key is already created. On another machine, restore the
same key privately and update that path if needed. Enter passwords only at private
prompts. For automation through Codex, use its private secret request rather
than chat or committed files.

```powershell
npx --yes @bubblewrap/cli@1.27.0 doctor
npx --yes @bubblewrap/cli@1.27.0 build
```

Check the generated `app/build.gradle` targets API 36 or higher before upload.
If the selected Bubblewrap version generates an older target, update the
toolchain to a version supporting the required target before release. Do not
assume a generated project passes current Play requirements. The expected
outputs are `app-release-signed.apk` for direct device installation and
`app-release-bundle.aab` for Google Play. Use an internal testing track first.

To compile without a release key from the generated project:

```powershell
# Configure JAVA_HOME and android/local.properties for your machine first.
.\gradlew.bat --no-daemon assembleRelease bundleRelease
```

These Gradle release outputs are **unsigned** and are not ready to install or
upload. They are under `app/build/outputs/apk/release/app-release-unsigned.apk`
and `app/build/outputs/bundle/release/app-release.aab`. A developer test APK can
be built with `.\gradlew.bat --no-daemon assembleDebug`; it uses the local
Android debug certificate, which is not a release/upload key.

## Verify the domain association

A TWA displays the hosted web app in a supporting browser. It still uses the
browser's camera/torch APIs and permission flow, so wrapping cannot fix camera
exposure or decoding bugs. A failed association opens a Custom Tab with browser
UI instead of the verified TWA.

Publish a real `/.well-known/assetlinks.json` at the **origin root**, even if
the app itself lives under a subpath. Use the final application ID and SHA-256
certificate fingerprints. For a locally installed release APK, use its signing
certificate. For Play-distributed installs, use the **Play app signing**
certificate from Play Console, which can differ from the upload certificate.
Include both fingerprints when testing both distribution paths.

Bubblewrap can generate the file after adding the real fingerprints:

```powershell
# Run inside android/. Replace the argument with the real certificate hash.
npx --yes @bubblewrap/cli@1.27.0 fingerprint add 'REAL_SHA256_FINGERPRINT'
npx --yes @bubblewrap/cli@1.27.0 fingerprint generateAssetLinks --output assetlinks.json
```

Copy the generated file to the site's `.well-known/assetlinks.json`, deploy it,
and verify that URL returns HTTP 200 JSON without authentication or redirects.
The tracked association file contains the real fingerprints supplied from Play
Console. Keep it synchronized with the wrapper configuration if signing
certificates change.

## Device and release checks

- Install the APK on a physical Android device. Confirm verified launch,
  camera permission denial/retry, torch output, screen fallback, and audio.
- Test the receiver with a second phone
  broadcasting known messages at 5, 8, and 12 WPM. Include steady room light,
  a bright background, ambient-light changes, and direct flashlight input.
  Record device/browser versions and expected versus decoded text.
- Check stop, background, lock, and return behavior. Camera tracks must close
  when their session ends. Check denied permissions as well as granted ones.
- Test the Play internal-track install separately, using the Play signing
  certificate in asset links. A working sideload does not prove this path.
- Supply a public privacy policy, store listing, screenshots, content rating,
  and accurate Data safety answers based on the final app. Receiver privacy
  copy must describe the receiver's local frame processing as well as the
  broadcaster's torch-only camera use.
- Check current Play Console testing and account requirements before release.
  No store submission or deployment has been performed here.

## Official references

- [Bubblewrap CLI, setup, commands, APK and AAB outputs](https://github.com/GoogleChromeLabs/bubblewrap/blob/main/packages/cli/README.md)
- [Android TWA quick start and Digital Asset Links](https://developer.android.com/develop/ui/views/layout/webapps/guide-trusted-web-activities-version2)
- [Google Play target API requirements](https://developer.android.com/google/play/requirements/target-sdk), checked 2026-10-26: new apps and updates require Android 16 / API 36 or higher.
