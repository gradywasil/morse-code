# Morse icon exports

The source is [favicon.svg](../../favicon.svg). Both PNGs are rendered directly
from that vector artwork, with the existing punched-tape M and amber lamp.

- `morse-icon-1024.png`: 1024 × 1024, RGBA PNG. Preserves the header icon's
  rounded silhouette and transparent corners for general branding use.
- `morse-google-play-512.png`: 512 × 512, RGBA PNG with a fully opaque square
  ground. The artwork is unchanged; the outer clipping mask is removed so
  Google Play can apply its own corners and shadow. No external shadow is baked in.

These follow the [Google Play icon specifications](https://developer.android.com/distribute/google-play/resources/icon-design-specifications).
The store file is separate from Android adaptive launcher icons. The native
wrapper and its generated launcher assets have not been rebuilt in this pass.

To reproduce, load the SVG into a browser Image, draw it on a same-size canvas,
and export with `canvas.toDataURL('image/png')`. For the store export, remove
`clip-path="url(#plate)"` from the outer group and fill the canvas with `#171008`
before drawing. The canvas export preserves 8-bit RGBA channels at both sizes.
These source assets stay out of the deployed web payload through `.assetsignore`.
