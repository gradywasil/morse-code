# Morse native Play release preparation

Prepared October 29, 2026, from the accepted native 0.5 receiver behavior.
The release has not been uploaded, reviewed, or tested as a Play-installed update.

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
