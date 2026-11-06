# Morse marketing site

A static advertising page based on the approved C composition, with a layout
designed for phones first. No bundler or new runtime dependencies are required.

From the project root, run:

```powershell
node scripts/preview-marketing.mjs
```

Open **http://127.0.0.1:4173/marketing/**. Stop the local preview with Ctrl+C.
An optional numeric argument chooses another port. Serve the project root when
using a different static server, because this page shares the app's Morse logic,
favicon and paper texture. Opening the HTML through `file://` will not load its
ES modules in browsers that restrict local-file imports.

## Source

- `index.html` contains the page, real tester/community links and semantic controls.
- `site.css` contains the responsive layouts and locally served font faces.
- `site.js` handles the demo and imports the app's translator, timing and hash modules.
- `assets/` contains optimized WebP variants and the fonts with their OFL licenses.
- The original generated artwork and paper tile remain in `../assets/plates/`.

The campaign hero and paper headline use Saira Stencil. The app wordmark and
other display headings retain Saira Stencil One, alongside Barlow body copy
and Spline Sans Mono controls. Each bundled font has its OFL license in assets.

Below 1200px, the page uses a vertical layout with a persistent signup link.
Wide layouts preserve the approved diagonal phone exchange. Controls have at
least 44px targets. Options contains speed and sound; selecting a setting closes
the disclosure so the Send control stays accessible. The page also honors reduced
motion and supports short viewports without a fixed bottom bar covering content.

## Demo behavior

The page uses the same International Morse translator and 5/8/12 WPM timing as
the app. A message punches the tape, follows the light path and assembles a demo
receipt. Sound starts only after an explicit choice. Supported browsers can
vibrate when that output is selected. Stop, page hiding and completion cancel
playback; the audio context suspends after use. Unsupported characters are
identified, and the web-app links carry the current message and speed in a URL
fragment. The demo has a 24-character limit.

The light exchange is an on-page illustration. It does not use a camera or
control a real flashlight. Actual camera reception is available in the app.

## Conversion routes

- Step 1, tester group: https://groups.google.com/g/morse-android-testers
- Step 2, beta opt-in: https://play.google.com/apps/testing/com.arrangedgodly.morsecode
- Step 3, installation: https://play.google.com/store/apps/details?id=com.arrangedgodly.morsecode
- Discord: https://discord.gg/NvyRQcYPrz
- Web app: https://morse.graydonwasil.com/

The main beta buttons lead to the on-page three-step guide at `#get-morse`.
Visitors join the group, opt in, then open the store listing, using the same
Google account throughout. Each external step opens separately so the guide
stays available. The page continues to describe closed beta access; the store
link is the owner-provided installation route after enrollment. The app's
separate Options-menu Discord link is in the main `index.html`.

## Deployment

The campaign has its own Cloudflare Worker, `morse-marketing`, configured for
**https://morse.arrangedgodly.com/** in `marketing/wrangler.jsonc`.

From the project root, build and deploy with:

```powershell
node scripts/build-marketing.mjs
npx --yes wrangler@4.156.2 deploy --config marketing/wrangler.jsonc
```

The build stages the page at the site root in `marketing/dist/`, including its
fonts, optimized artwork, favicon, paper texture and three shared Morse modules.
It preserves the page's source bytes. Documentation, prompt sidecars, app entry
points, native files and development captures are outside that package.
The generated directory is ignored by Git. The root app's Wrangler configuration
remains separate. `DEPLOYMENT.md` records the published version and live checks.

## Validation

Browser captures and interaction reports are under `.impeccable/review/`.
The verification scripts use the local Chrome installation and built-in Node
APIs. They do not require a browser package or change the native Android bundle.
See `VALIDATION.md` for the final coverage and its limits.
