# Marketing site validation

Initial local validation was completed on 2026-11-02. This is a static site in
`marketing/`, with no new runtime dependencies or bundler. A copy script stages
its production files. It is now deployed at https://morse.arrangedgodly.com/;
the additional live checks are recorded below. No new Android release was
packaged or published.

## Responsive browser checks

Chrome captures cover these CSS viewports:

| Viewport | Purpose |
| --- | --- |
| 320×568 | Small phone |
| 390×844 | Main phone layout |
| 430×932 | Larger phone |
| 520×900 | Narrow intermediate layout |
| 768×1024 | Tablet |
| 844×390 | Landscape phone |
| 1199×900 | Upper edge of the stacked layout |
| 1280×800 | Smaller desktop |
| 1440×1000 | Wide desktop |
| 1487×1058 | Exact approved-comp comparison |

All ten report no horizontal overflow, broken images, startup exceptions,
third-party requests, or visible controls below 44px high. Full-page captures
start at the document top after fonts and images settle. The exact comp capture
is a viewport capture. Each was opened and inspected. Phone, small-phone, tablet
and desktop fold crops are retained separately.

Below 1200px the page uses a stacked composition and a persistent header signup.
The 390×430 shortened-viewport check verifies that the input and sticky signup
remain accessible in a keyboard-height scenario. This does not prove an actual
mobile keyboard's behavior. The main hero signup and web-app link remain in the
page, with a second signup and Discord action near the end.

The 390px device-pixel-ratio-3 check chooses the 720px handset renditions and
reports 677,508 transferred bytes on its local cold load. The standard-density
390px capture reports 556,597 bytes. These are local-browser transfer counts,
not measured field performance, a Lighthouse score or a slow-network test.
Fonts and artwork are served locally; the initial page makes no third-party
requests. Five delivery WebPs and four source plates pass prompt-provenance
scans. The optimized optical WebP is 36,644 bytes.

## Interaction checks

Trusted browser gestures at 390px and 1440px verify:

- Letters arrive after their final mark, with proper word gaps and completion.
- Send, Stop and replay restore the expected controls.
- Empty and unsupported text, recovery and the 24-character paste limit work.
- Web-app links preserve the current message and selected speed in the fragment.
- Options closes on a setting change, Escape or an outside pointer; Escape
  retains keyboard focus.
- Explicit sound selection starts actual Web Audio, and completion suspends
  the audio context. A missing-audio fallback retains the visual demonstration.
- All four output choices update their description and pressed state.
- A simulated hidden-document event stops playback. Reduced-motion emulation
  removes tape and interface transitions.
- With JavaScript disabled, the explanation, tester signup and web-app links
  remain usable.

The first interaction run found that the desktop Options panel could obscure
Send after a speed change. The implementation now closes it after a setting
change and supports Escape/outside dismissal. Subsequent complete interaction
runs passed. Initial failures are not represented as historical passes.

The first finish verdict left the mobile/tablet beam contacts partially
resolved. The second correction anchors both optical endpoints to the phone
edges and keeps live marks on that axis. Extending checks to 520px exposed a
fixed tablet headline size that overflowed at that narrower width; its font
size now scales within the same type treatment. The subsequent ten-size layout
run and seven-size optical check pass. A 390→1440→390 resize check also confirms
that the signal geometry switches cleanly between responsive compositions.

Existing pure translator, scheduler and hash checks also passed:

```powershell
node --test test/morse.test.mjs test/schedule.test.mjs test/hash.test.mjs
```

Result: 219 tests in 23 suites, zero failures. The broader native preparation
and packaging suite was not run because it is outside this isolated marketing
change and can rewrite native assets in this shared checkout.

The preview helper's redirect, page, stylesheet, font, shared module and private
path checks pass. `git diff --check -- marketing scripts/preview-marketing.mjs`
passes. No application/native files were changed by the marketing build.

## Design review and evidence

The independent finish review requested campaign typography, ground tone,
optical-contact and evidence corrections. The final verdict pass scores all
four original fixes resolved, with disposition **ship** at its supplied-evidence
scope. This is a scored-fix verdict, not a new whole-surface review. The original
viewport/interaction evidence was refreshed. The report is recorded in
`.impeccable/review/finish-verdict-marketing.md`.

The single design-detector run reported two cramped-padding warnings, one dark
glow warning and 75 design-token advisories relative to the compact app design
document. The independent reviewer assessed the header/full-width paper spacing
and approved amber key glow as nonmaterial, and did not equate token advisories
with 75 defects. The detector was not rerun or silenced.

The original standalone comparison against revised C remains in
`.impeccable/review/diff/current/` at about 69% overall. The finish comparison in
`diff/finish-fix1/` is about 74% overall, 82% color and 97% bands; its verdict is
still drift. These are diagnostic comparisons, not automated fidelity passes.
The user authorized mobile restructuring and actual tester wording, while
the handsets retain their correct portrait aspect ratios.

Current-comp region measurements, painted pixel samples, asset hashes,
source-to-WebP mapping and completed-work evidence are in
`.impeccable/review/current-build-evidence.md` and its linked JSON reports.
The legacy CLI state and spec refer to the earlier C composition and remain
preserved. Their open asset-review phase is qualified separately from the real
chat approval and current browser evidence. No browser acceptance receipt or
machine gate pass was manufactured. The final `build-phase finish --disposition
ship` request was refused because the legacy plates, hero, sections, motion and
responsive phases are not closed; the active phase is **plates**. The refusal
is preserved in `.impeccable/review/final-phase-attempt.txt`. This automated
workflow remains unfinished, separate from the working site and scoped review.

## Live deployment verification

Cloudflare Worker `morse-marketing` was deployed on 2026-11-02 at the requested
custom hostname, with version `91ed6b5a-cf6e-40bb-bfdc-400cb547a5b3` serving
100% of traffic. DNS resolves and the site responds over HTTPS.

The isolated package contains 23 release files. Direct HTTPS responses for all
23 matched the staged SHA-256 hashes. The production root serves the advertising
page; its fonts, WebPs, paper texture and shared Morse modules all load. Checks
also confirmed that development documents, Wrangler configuration, prompt
sidecars, the app entry module and internal review state return 404.

Fresh live Chrome checks at 390×844 and 1440×1000 verified the correct page,
loaded images, no horizontal overflow or startup exceptions, the beta guide's
Google Group, Play opt-in and store destinations, the Discord destination, and
web-app links preserving the message. A trusted click sent `E` and produced the
expected demo receipt on both layouts.

Live browser visits also load Cloudflare's injected Insights beacon. The earlier
zero-third-party-request measurements apply to local captures; the live reports
explicitly record that additional request. No Cloudflare account-wide analytics
setting was changed during this deployment.

Deployment details and repeat commands are in `DEPLOYMENT.md` and `README.md`.
Raw verification evidence is in `.impeccable/review/marketing-deployment-http.json`
and `marketing-release-live.json`, with full-page live captures for both widths.
This was a direct Wrangler upload from the local package; no GitHub-triggered
deployment was configured or verified. The existing app Worker was not deployed.

## Beta signup flow update

The owner supplied Google Play testing and store URLs. The header and hero beta
actions now lead to `#get-morse`, which presents the three enrollment steps:
Google Group, Play beta opt-in, then installation. The same-account reminder
and account/membership recovery hint are visible beside the steps. The guide
uses [Google's closed-testing sequence](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en).

Checks at 320, 390, 430, 520, 768, 844, 900, 1199, 1280 and 1440px verified the
exact ordered destinations, same-page beta navigation, heading clearance below
the sticky header, no horizontal overflow and links at least 44px high. The
guide stacks on phones and uses three columns from 900px. Captures at 320, 390,
900 and 1440px were inspected directly. All three external links remain in the
JavaScript-disabled page. The final metadata-only terminology adjustment did
not change this layout; the published source was then checked byte-for-byte.

Evidence is in `.impeccable/review/marketing-beta-flow.json` and the
`beta-flow-*.png` and `beta-guide-*.png` captures. Live 390px and 1440px checks
passed again, including the demo message receipt, and all 23 published file
hashes match the staged package. The prior full visual review applies to its
original fix list; no new whole-surface independent review is claimed for this
small signup update. No signed-in Google account was enrolled, and no Play
Store installation was performed during these checks.

## Evidence boundaries

These checks prove the supplied Chrome renders and automated interactions.
They do not prove physical Android/iPhone behavior, Safari or Firefox,
screen-reader acceptance, audible listening quality, physical vibration,
real camera/flashlight transmission or Play acceptance.
The page intentionally labels its two-phone exchange and receipt as a demo.

The earlier, separately requested Discord link remains in the main app's
Options menu. Its prior Chrome checks covered 320px, 390px and 1440px layouts,
keyboard focus, correct destination and new-tab behavior. No new native build
or physical-device acceptance is claimed for that menu addition.
