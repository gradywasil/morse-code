# Website to Google Play promotion

Scoped by the user on 2026-10-26. This is future work, to enable when Morse has
a public Google Play listing.

## Intended behavior

- The regular website at `https://morse.graydonwasil.com` offers an official
  "Get it on Google Play" badge inside OPTIONS, after the existing controls.
  It links directly to the public listing for `com.arrangedgodly.morsecode`.
- The badge is a link to this app, with no ad network, tracking SDK, install
  prompt, countdown, or interstitial. Use Google's official badge asset and
  accessible link text describing the destination.
- Hide the promotion when the page runs inside the installed Android wrapper
  or as an installed standalone web app. Define and verify the wrapper launch
  signal during implementation; do not rely on the Android user agent alone.
- Keep the main instrument in one viewport. The promotion belongs in OPTIONS
  and uses its existing internal scrolling on small screens.
- Follow the normal external HTTPS link to Google Play. Do not require a
  browser-specific intent or interfere with the current message/session.

## Activation requirements

Confirm the real public listing URL and its availability before enabling the
link. The expected URL is
`https://play.google.com/store/apps/details?id=com.arrangedgodly.morsecode`,
but no public listing has been verified. Do not advertise an unpublished app.
Check Google's current badge usage guidance when implementing the badge.

## Acceptance checks

- A normal browser sees the badge in OPTIONS and reaches the correct listing.
- The installed TWA and standalone web app hide it; the normal Android website
  still shows it.
- The link has an accessible name and at least a 44px touch target, works by
  keyboard, and fits the smallest supported phone and landscape layouts.
- Returning from the store preserves the typed message. Existing camera release
  behavior on backgrounding remains intact.
- The promotion makes no new request before the user activates the link,
  aside from loading a locally hosted badge asset.

This scope does not include publishing the store listing or adding a live badge
before that listing is available.
