# Advertising-site deployment

Live URL: **https://morse.arrangedgodly.com/**

- Deployment date: 2026-11-02.
- Cloudflare Worker: `morse-marketing`.
- Active version: `91ed6b5a-cf6e-40bb-bfdc-400cb547a5b3`, at 100% rollout.
- Wrangler version used: `4.156.2`.
- Configuration: `marketing/wrangler.jsonc`.
- Release directory: generated `marketing/dist/`, containing 23 static files.

This is a direct upload of the local advertising-site package. Its page, CSS and
JavaScript are copied byte-for-byte, along with the required delivery assets
and three shared Morse modules. The repository baseline was
`fd3752c2752fd708ece2adbc14768c872082b1e9`; the advertising work was local and
uncommitted at upload. That baseline is not a claim that the release matches
the committed app tree. No GitHub-triggered deployment was configured.

## Publish an update

Run from the project root with the appropriate Cloudflare account authenticated:

```powershell
node scripts/build-marketing.mjs
npx --yes wrangler@4.156.2 deploy --config marketing/wrangler.jsonc
```

The build clears only its bounded `marketing/dist/` output and rejects a linked
output directory. Its asset filter includes the WebP delivery files, fonts and
their licenses. Source prompt sidecars, design documents, review evidence,
native projects and the app's entry point are outside the release directory.
The existing root `wrangler.jsonc` still belongs to the separate `morse-code`
app Worker.

## Verification

The dry run passed before publication. After publication:

- DNS resolved and the requested custom hostname served HTTPS successfully.
- Cloudflare's deployment list reported the version above at 100% rollout.
- All 23 release-file responses matched the staged SHA-256 hashes.
- Chrome at 390×844 and 1440×1000 loaded the page and artwork without startup
  exceptions or horizontal overflow. Sending `E` produced the expected receipt.
- The main beta actions open the on-page signup guide. Its ordered links point
  to the Google Group, Google Play beta opt-in page and Play Store listing.
  Discord and message-preserving web-app destinations are correct.
- Checked development-only and app-entry paths returned 404.

The live browser reports record Cloudflare's injected Insights beacon. These
checks do not establish physical-phone, Safari/Firefox, audible, screen-reader,
camera/torch or Android-package acceptance. See `VALIDATION.md` for the earlier
responsive checks and the preserved legacy design-tool phase qualification.

Detailed local evidence lives under `.impeccable/review/` in
`marketing-deployment-http.json`, `marketing-release-local.json`,
`marketing-release-live.json` and the `release-live-*.png` captures.

## Beta signup update

Version `91ed6b5a-cf6e-40bb-bfdc-400cb547a5b3` adds the owner-provided Google
Play opt-in and store URLs alongside the existing Google Group. The guide
explains the group, opt-in and installation sequence and tells visitors to use
the same Google account throughout. It follows
[Google's closed-testing guidance](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en).

The guide passed layout and navigation checks at 320, 390, 430, 520, 768, 844,
900, 1199, 1280 and 1440px. All three links remain available without JavaScript.
Live checks verified the destinations and demo behavior at 390px and 1440px;
all 23 published file hashes match the staged package. Signed-in Google Play
enrollment and installation were not performed.

The initial version was `44330854-8136-4489-b093-386bb66bb031`. Its HTTP
verification record is preserved as
`.impeccable/review/marketing-deployment-44330854-8136-4489-b093-386bb66bb031.json`.
