# Google Play listing assets

## Ready to upload

| Play Console field | File | Verified format | Suggested alt text |
| --- | --- | --- | --- |
| App icon | [app-icon-512.png](upload/app-icon-512.png) | 512 x 512, RGBA PNG, all alpha values 255, under 1 MB | Cream punched-tape M with an amber signal lamp on a dark brown square. |
| Feature graphic | [feature-graphic-1024x500.png](upload/feature-graphic-1024x500.png) | 1024 x 500, RGB PNG without alpha, under 15 MB | Morse with an amber signal lamp and a paper tape spelling HELLO in Morse code. |

The icon is a byte-for-byte copy of the approved branding export. The editable
feature-graphic source is [feature-graphic.svg](feature-graphic.svg); its lettering
is outlined, so rendering does not depend on installed fonts. It extends the
existing amber, cream, and brown instrument palette. Its dark background is an
intentional departure from the vintage-poster validator's light-base preference;
the full-bleed paper tape is intentional. SVG validation reports zero errors.

Export the SVG at 1024 x 500 and save as RGB PNG without alpha when revising it.
These files are excluded from web deployment by the existing `docs/**` rule.

## Phone screenshots still needed

No phone was connected when ADB was checked on 2026-10-26. No browser mockups,
synthetic receiver output, or earlier toolbar-bearing captures are included as
store screenshots. Capture the installed Play build after successful website
verification, and place final uploads in `upload/phone-screenshots/`.

Aim for these four distinct views, in this order:

1. `01-broadcast.png`: Broadcast tab, keyboard dismissed, message `HELLO ROOM`.
2. `02-receive.png`: Receive tab after actually decoding a short message from a
   second device, with the received message readable and the camera stopped.
3. `03-options.png`: Broadcast options open, showing the actual speed and output
   controls. Keep the keyboard dismissed.
4. `04-broadcast-active.png`: A broadcast in progress using the actual app's
   screen-light output and optional sound disabled. Avoid capturing an entirely
   white frame; show a readable app state or use a different real feature view.

For a minimal first listing, the first two screenshots cover both main modes.
Google requires at least two screenshots. Four portrait screenshots at
1080 x 1920 are recommended for eligibility for screenshot-based promotion.
The app should be the focal point; avoid personal notifications, browser
toolbars, unrelated apps, and invented received messages.

Preserve original phone captures. Check dimensions before upload: a tall phone
capture may exceed Google's maximum 2:1 long-side/short-side ratio. If so,
compose it proportionally on a 1080 x 1920 background without stretching or
cropping away controls. Label a composed capture as such in the capture record.
Do not claim that the composition is a native 1080 x 1920 device capture.

The feature graphic is promotional vector artwork, not an app screenshot.
Leave the optional YouTube video field blank until a real demo exists.

## Requirements checked

[Google Play preview asset guidance](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en),
checked 2026-10-26. The prepared icon and feature graphic were opened and
visually inspected, and their dimensions, PNG color modes, sizes, and icon
opacity were checked. Actual phone screenshots remain pending.
