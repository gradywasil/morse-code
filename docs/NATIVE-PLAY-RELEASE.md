# Morse native Play release preparation

## Current update: 1.1.1, code 7

Prepared October 30, 2026 after user reports that the Play-installed 1.1.0 works
well but repeats explanatory permission screens too often.

Upload `artifacts/morse-1.1.1-play.aab`. SHA-256:
`295F8075DF1689C6CC5B1CBCADC528E8B1B204B2B7F75C37DB19B3BB5F3447D9`.
Optional separate test APK: `artifacts/morse-native-1.1.1-debug.apk`.
The Play package and upload key are unchanged. This new bundle is not uploaded.

Native launch now checks Camera permission without opening the camera. Missing
permission is requested at most once per Activity/plugin lifetime; a denied
fresh launch retries under Android's permission rules. Hardware acquisition
checks permission but never triggers additional requests during that launch.
Permanent denial still requires Android app settings. Browser behavior is unchanged.

Native-only onboarding skips camera/flashlight explanations, automatically
continues an acknowledged broadcast into transmission, and enters Receive
without another explanation. The brief flashing-light warning is acknowledged
once per page session by default. Checking Don't show again saves only a local
warning preference, and Broadcast options can restore the warning. This
preference does not affect Android permission grants. Diagnostic flashing on
flashlight acquisition is removed from the native interface.

Validation: all 602 existing Node tests pass. Chrome integration at 320x568,
390x844 and 1440x900 verifies repeat broadcasts, persisted opt-out after reload,
receiver entry, restoring the warning, declining without saving, and settings
recovery after a permission failure. Updated warning captures were viewed:
the checkbox and action buttons fit at 320x568 after trimming the native facts.
An Android 16 emulator confirms the actual first launch prompt, a retry after
denial and fresh launch, no prompt after grant and fresh launch, and no active
camera clients during launch. A separate CDP check could not run because Android
WebView rejects Playwright's Browser.setDownloadBehavior command. Same-launch
request suppression is source-checked, not independently exercised via CDP.

Debug assembly, release bundle and release lint pass (0 errors, 34 warnings).
Jarsigner verifies, bundletool validates and decodes package/version, and all 510
non-signature bundle entries match the unsigned output. The temporary signing
password file was deleted. Physical phone verification of 1.1.1 remains pending.
Public privacy disclosure deployment: `0595a4f5-8b38-4e78-a4cb-1f8ebf0000a6`;
HTTPS 200 and exact bytes confirmed for `/privacy-native`.

Suggested release name: `1.1.1 - Smoother permissions`.
Notes: fewer repeated permission screens; remembered flashing-light warning
choice; faster access to broadcasting and receiving.

## Previous release: 1.1.0, code 6

Prepared October 29, 2026, from the accepted native 0.5 receiver behavior.
The user subsequently uploaded it and reports improved behavior from Play testers.

## Upload artifact

- File: `artifacts/morse-1.1.0-play.aab` (ignored local artifact).
- Name: Morse. Application ID: `com.arrangedgodly.morsecode`, without `.proof`.
- Version name: `1.1.0`. Version code: `6` (previous known Play upload: `1`).
- Minimum SDK 24; target SDK 36.
- SHA-256: `26D323451E36FF5C5F9030154598005C3321E727CFE35BB451A232FAAB622597`.
- Upload key: existing external keystore, alias `morsecode`; no new key created.
- Certificate SHA-256: `49:44:A3:37:59:BE:1F:68:88:2B:80:E6:02:41:15:53:80:09:34:63:25:9C:A8:06:71:EF:9E:70:80:55:BD:13`.

The debug test app remains separate and can coexist with the Play app. Google
Play signs the delivered app using its app-signing key; this AAB uses the upload
key. Do not try to install the AAB directly or replace the Play app with a debug APK.

## Validation

- 602 Node tests pass; release Gradle bundle and lint pass, 0 errors/34 warnings.
- `jarsigner` verifies the signed bundle; `keytool` certificate matches the
  original upload certificate recorded under `android/play-upload-info.json`.
  Self-signed-certificate and no-timestamp notices are expected for this upload key.
- All 508 non-signature entries match the unsigned Gradle bundle byte for byte.
- Official bundletool 1.18.3 validates the AAB. Its decoded manifest confirms
  package/version/SDK values and no enabled debuggable flag.
- All eight native libraries have ELF LOAD alignment of at least 16 KB; bundle
  configuration requests `PAGE_ALIGNMENT_16K`.
- Bundled HTML uses the release app name, excludes the hardware diagnostics
  link and both diagnostic web files, and includes the native privacy policy.
- The user accepted the preceding debug build's transmission, Back behavior,
  and corrected screen-to-phone reception. Release installation, upgrade from
  the TWA, Android 12, and broader device testing remain separate checks.

## Rebuild

Run tests before the final release sync: the packaging test generates a debug
web bundle. Then run `npm run android:sync:release`, select JDK 21, and execute
`android-native/gradlew.bat -p android-native --no-daemon bundleRelease lintRelease`.
The Gradle AAB is unsigned. Sign a separate output with `jarsigner` and the
existing external upload key; supply its password through a private secret
file prompt, never source or literal command-line passwords. Verify the result
again. The password file used for this release was removed after signing.

## Public privacy policy

Native policy: <https://morse.graydonwasil.com/privacy-native>.
The existing `/privacy` page links to it and distinguishes native 1.1.0+ from
the website and older browser wrapper. Both return HTTPS 200 and match local
source bytes using Node fetch. Python urllib received a Cloudflare 403, so that
client result is not evidence of universal accessibility.
Cloudflare deployment: `668caf2b-384e-460e-ab61-7b3a7b553903`.

## Next Console checkpoint

Open the existing Morse app, Testing, Closed testing, then the existing track.
Create a new release and upload the signed artifact above. Wait for processing;
inspect the displayed version code and any warnings before moving on.
Do not create a new app or change its package. Recheck Data safety for the
bundled app and the privacy-policy URL before submitting this update.

Suggested release name: `1.1.0 - Native Android update`.

Suggested notes:

> Camera and flashlight access now use Android app permissions directly.
> Improved Morse reception, including the beginning and end of messages.
> Improved Back-button behavior during broadcasts.
> The interface and fonts are bundled for offline use.

Sources: [Google Play updates](https://support.google.com/googleplay/android-developer/answer/9859350),
[Android app signing](https://developer.android.com/studio/publish/app-signing),
[bundletool](https://developer.android.com/tools/bundletool).
