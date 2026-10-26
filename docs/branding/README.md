# Morse icon exports

[morse-app.svg](morse-app.svg) is the source for the launcher and store artwork.
It keeps the punched-tape M and amber lamp, removes the inset rounded rim, and
fills the complete square with the warm instrument ground. The lamp and punch
shapes fit inside a centered circle of radius 40% of the image width; the paper
band intentionally extends to both edges.

- `morse-icon-1024.png`: 1024 by 1024 master PNG.
- `morse-google-play-512.png`: 512 by 512 Google Play listing PNG.
- The web icons in `icons/` and `apple-touch-icon.png` use the same artwork.
  Both the regular and maskable 512px icons are now opaque.

Every export is an 8-bit RGBA PNG. All pixels, including all four edges and
corners, have alpha 255. There is no transparent padding, pre-rounded outer
mask, border, or external shadow. Google Play applies its display mask after
upload, following its [icon specifications](https://developer.android.com/distribute/google-play/resources/icon-design-specifications).

To reproduce, decode the SVG as a browser Image, draw it on a canvas at the
desired output size, and export with `canvas.toDataURL('image/png')`.
The original [favicon.svg](../../favicon.svg) remains the small header mark.
The source and store exports in this folder stay out of the web payload through
`.assetsignore`; the deployed launcher PNGs remain under their existing URLs.

The local debug APK predates this icon cleanup. The signed Play AAB now embeds
the current artwork at all five launcher, maskable, and splash densities.
Its 15 packaged images were compared against the generated source pixels.
Replacing web icons alone does not replace icons embedded in an existing APK.
