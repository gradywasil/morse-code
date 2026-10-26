---
name: Morse
description: A compact Morse instrument with a live paper tape, readable transcript, warm dark ground, and amber controls.
colors:
  ground: "#171008"
  ground-deep: "#0f0a05"
  panel-hi: "#241a10"
  panel-lo: "#1e150c"
  metal-hi: "#3f2f1d"
  metal-lo: "#2c2013"
  hairline: "rgba(240, 214, 166, 0.14)"
  hairline-strong: "rgba(240, 214, 166, 0.26)"
  cream: "#eee0c2"
  cream-dim: "#b3a17c"
  lamp: "#ffb454"
  lamp-lit: "#ffc879"
  lamp-dim: "#8a6c3c"
  lamp-off: "#3a2b19"
  paper: "#e2d3a8"
  paper-hi: "#e6d7b0"
  paper-lo: "#cbb98b"
  paper-edge: "#453317"
  ink: "#2b2013"
  ink-sent: "#645637"
  ink-current: "#7a4a0c"
typography:
  legend:
    fontFamily: "Saira Stencil One, Barlow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "0.1em"
  body:
    fontFamily: "Barlow, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  mono:
    fontFamily: "Spline Sans Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0.04em"
rounded:
  bay: "12px"
  zone: "10px"
  key: "8px"
  hole: "9px"
  cap: "4px"
  lamp: "50%"
spacing:
  deck-gap: "14px"
  bay-pad: "16px"
  zone-pad: "12px"
  key-pad: "14px 18px"
  group-gap: "10px"
components:
  key:
    backgroundColor: "#241a0f"
    textColor: "#eee0c2"
    rounded: "{rounded.key}"
    padding: "14px 18px"
    height: "48px"
  key-primary:
    backgroundColor: "#ffb454"
    textColor: "#221407"
    rounded: "{rounded.key}"
    padding: "16px 40px"
    height: "58px"
  message-input:
    backgroundColor: "#0f0a05"
    textColor: "#eee0c2"
    rounded: "{rounded.key}"
    padding: "14px"
    height: "auto"
  bay:
    backgroundColor: "#241a10"
    textColor: "#eee0c2"
    rounded: "{rounded.bay}"
    padding: "16px"
  tape-band:
    backgroundColor: "#e2d3a8"
    textColor: "#2b2013"
    rounded: "0"
    height: "152px"
  lamp-indicator:
    backgroundColor: "#3a2b19"
    textColor: "#171008"
    rounded: "{rounded.lamp}"
    size: "9px"
  zone:
    backgroundColor: "#241a10"
    textColor: "#b3a17c"
    rounded: "{rounded.zone}"
    padding: "12px"
---

# Design System: The Register

## Overview

**Creative North Star: "The Register"**

The Register is a punched-tape telegraph register: a paper strip punched with dots and dashes, crossing a dark warm instrument ground, read by a fixed bridge head. The page is the instrument — typing punches the tape, and during broadcast the tape travels under the head while the lamp, screen, and tone speak each punch. Every surface decision comes from precision instrumentation: hairline rules, inset slots, machine-plate legends, one amber lamp family for live states. It is expressly **not** steampunk — no brass, no cogs, no antique-shop texture; the register is a working machine, rendered with instrument economy.

The world refuses the category default (centered card + textarea + blue button) structurally: the paper band is the only full-bleed element and the hero; the composer is an inset mono slot; the single primary key is an amber lamp key. Color commits at page scale — the dark warm ground is the machine body, the paper band owns the middle band of every viewport, and amber appears only where the instrument is live. Depth comes from material (inset slots, punch holes, panel ramps), not decoration.

**Key Characteristics:**
- Dark warm ground (#171008) with a full-bleed paper-tape band (#e2d3a8) as the hero — the only full-bleed element.
- One accent family (lamp amber #ffb454) reserved for live states, cautions, and the primary key.
- Punch holes are the ground showing through paper; printed letters ride above them with a three-tier ink hierarchy.
- Machine-plate stencil legends; monospace carries measured data; Barlow carries sentences.
- Mechanical motion grammar (two curves, ≤200 ms strokes, nothing loops outside a broadcast) with capability layers that flatten decoration, never signal.

## Colors

One warm dark field, one paper band, one lamp: the palette is three materials, not a rainbow of roles.

### Primary
- **Lamp Amber** (#ffb454): the page's only accent. Live group ring and ink, GO zone, progress line, cautions, and the BROADCAST key fill (#ffc879→#f2a23c gradient). Tonal states: lit #ffc879, dim/held #8a6c3c, off #3a2b19.

### Neutral
- **Instrument Ground** (#171008): the machine body — page field (radial warm wash #1d150b→#120c06); **Ground Deep** (#0f0a05): inset slots (composer field, punch holes — the ground reads through the paper as holes).
- **Panel High/Low** (#241a10 / #1e150c): raised machine-bay plates (vertical ramp gradient).
- **Metal High/Low** (#3f2f1d / #2c2013): the read-head bridge and caps.
- **Cream** (#eee0c2): primary text on ground (~14:1). **Cream Dim** (#b3a17c): secondary text (~7:1) — always a warm tint, never gray.
- **Hairline** (rgba(240,214,166,0.14) / strong 0.26): instrument rules and plate borders.
- **Paper** (#e2d3a8, hi #e6d7b0, lo #cbb98b, edge #453317): the tape band's vertical material shading.
- **Tape Inks** — unspoken #2b2013 (10.3:1), live #7a4a0c (4.80:1 worst row), spoken #645637 (4.61:1 worst row) at the actual letter-row backgrounds.

### Named Rules
**The One Lamp Rule.** Amber (#ffb454) is the only accent color on the page, and it appears only where the instrument is live: the group under the head, the GO zone, progress, cautions, and the one primary key. Nothing static glows; nothing amber is decorative.

**The Ink Ledger Rule.** The tape's three inks keep unspoken (10.3:1) > live (≥4.80:1) > spoken (≥4.61:1) against the actual letter-row backgrounds (glyph-top rows ≈ #dfcfa5–#dfcea4). Spoken stays the lightest tape ink but never drops below 4.5:1 (WCAG 1.4.3) — retuning must preserve both the floor and the ordering.

**The Warm Ground Rule.** Dark means warm dark (#171008, brown-black). No blue-blacks, no neutral grays, no cool secondary text — secondary ink tints from the paper hue (#b3a17c).

## Typography

**Legend Font:** Saira Stencil One (fallback Barlow, system-ui)
**Body Font:** Barlow (fallback system-ui)
**Data Font:** Spline Sans Mono (fallback ui-monospace, SF Mono, Menlo)

**Character:** Stencil legends are the machine's engraved plates — identity, never sentences. Mono is the register's ledger: anything counted, measured, or punched (tape letters, progress marks, the share hash, footplate data). Barlow is the operator's manual: full sentences in plates and dialogue lines.

### Hierarchy
- **Display / Nameplate** (400, clamp(1.55rem, 7vw, 2.3rem), 1.05, +0.1em): THE REGISTER on the nameplate, once.
- **Legend** (400, 13px, 1, +0.14–0.16em): plate legends (MESSAGE, SPEED, SHARE) and zone legends (STANDBY/CAUTION/GO); gate titles 15px.
- **Body / Dialogue** (400–700, 14.5–16px, 1.45–1.55): status copy, gate advisory, denied hints. Imperatives 700 16px.
- **Label / Key** (700, 13px, +0.14em; broadcast key 15px +0.2em): machine-key engraving.
- **Data / Mono** (400–600, 11–16px): input 16px (never smaller — iOS zoom), tape chars 600 15–16px, progress 500 13px +0.08em, footplate 500 11px +0.18em.

### Named Rules
**The Three Voices Rule.** Stencil names, mono measures, Barlow explains. A sentence never renders in stencil; a measurement never renders in Barlow; stencil never sets running text.

## Layout

Phone-first single deck. A centered nameplate plate, then `main.deck` (max-width 1160px, 14px gap, 16px gutters past safe-area insets) stacking machine bays: composer → station (the tape) → corridor/gate plates → transport → speed → share, closed by a centered footplate. The tape band breaks the deck: full-bleed 100vw (`margin-left: calc(50% - 50vw)`), 152px tall (176px ≥720px; 128px in landscape ≤480px height), the only full-bleed element. Punch geometry is authored in px (dot 14 / dash 42 / symbol gap 10) and never scales with width; the strip (1778px) translates under the fixed center head (`--strip-shift`).

Responsive law: every content-bearing grid track is `minmax(0, 1fr)` — items re-flow, never shrink past legibility (corridor stacks 1-col below 480px, three columns above; speed steps 1-col below 560px; at ≥900px the two bottom bays sit side-by-side when share is mounted). Breakpoints: 480 / 560 / 720 (tape metrics, ground echo gate) / 900 (two-column deck) / 1240 (body 17px), plus landscape ≤480px height. `viewport-fit=cover` with safe-area `max()` insets on deck/nameplate/footplate; the tape stays full-bleed across notches by design. `100dvh` with a `100vh` fallback; horizontal overflow clipped at the body.

## Elevation & Depth

Depth is material, not decoration: slots are **inset** (composer `inset 0 2px 10px rgba(0,0,0,.55)`; punch holes `inset 0 2px 3px` + a 1px paper-thickness highlight below), plates are raised ramps (panel gradient + `inset 0 1px 0` top light + one soft drop `0 8px 22px rgba(0,0,0,.32)`), the paper band carries symmetric inset edge shading (top highlight / bottom shade of the paper hue) plus `0 12px 28px rgba(0,0,0,.5)`. Glows exist only as lamp light (halo shadows on the head lamp, live punches, GO zone) and are capability-layered: they zero out under `prefers-reduced-motion` and `html.cap-low` with zero information loss (the live ring, head position, and numeric progress carry the same facts). The broadcast flash itself is signal, never flattened. Honest record: the ≥720px per-mark ground echo exists only during live broadcast (source `css/main.css` ~1057–1072) — a static capture cannot show it. No hard offset shadows anywhere; no zero-blur blocks.

## Shapes

Rounded corners are machined, small, and consistent: bays 12px, zones 10px, keys and inputs 8px, punch holes 9px (pill: 18px tall, dot 14px / dash 42px wide), head cap 4px, lamps perfect circles (9px, border 1px dark). The tape band is square-edged (0) — it is material, not chrome. Focus rings are 2px solid lamp amber at +2px offset and follow each element's own radius; a radius is never mutated for focus.

## Components

### Machine Keys (buttons)
- **Shape:** 8px radius, min-height 48px, padding 14px 18px; engraved label 700 13px +0.14em uppercase.
- **Secondary key:** dark warm ramp (#302214→#241a0f), 1px #4a3620 border, inset top light + `0 3px 8px` drop; hover warms the ramp; active seats 1px down with an inset press shadow; disabled 0.45 opacity, no transform.
- **Primary (BROADCAST):** amber ramp (#ffc879→#f2a23c), dark ink #221407, +0.2em 15px label, min-height 58px, full-width on phone / auto width at ≥900px. The only amber key on the page.
- **Focus:** 2px lamp outline, +2px offset (radius never mutated).

### Speed Detents (named steps)
Three radio-driven machine keys (LEARNER / STANDARD / BRISK), never a slider: name in stencil 13px, WPM in mono 13px right-aligned; checked = amber border + amber inner ring + amber WPM; detail/caution lines print only under the checked detent. The hidden radio carries focus (`:focus-visible + .step-key` lamp outline). Through a committed run the radios disable with the composer (the machine-key disabled grammar: 0.45 opacity, inert to hover and press); the checked step keeps its dimmed amber ring so the pace actually speaking stays readable.

### The Tape Band (signature)
Full-bleed paper strip: six-stop vertical paper gradient, 1px paper-edge borders top and bottom, symmetric inset edge shading, sprocket feed holes punched along the bottom edge (26px rhythm). Groups: printed letter (mono 600 15–16px) above a flex row of punch holes — holes are ground-filled pills with inset shadow + paper-thickness highlight; unknown characters print a dashed void bar instead of holes. Ink tiers: unspoken #2b2013, live #7a4a0c + amber ring + glow on punches, spoken #645637. The read-head bridge is fixed at center: metal cap, twin rails, slotted reading aperture, 9px lamp that reports state (off → dim armed → lit live) and fires per mark during broadcast. The tape moves (`transform 190ms --drive`); the head never does.

### Machine Bays (cards/plates)
12px radius, panel ramp, 1px hairline border, 16px padding, soft drop. Legends sit inside as stencil 13px +0.16em cream-dim. Gate plates (hazard, why-camera, denied, screen-note) add the amber-tinted border `rgba(255,180,84,.38)` and seat with a 130ms translate snap.

### Corridor Zones (standby → caution → GO)
Stacked full-width zone plates below 480px, three columns above: 9px zone lamp + stencil legend + one 12px line. The live zone (GO during broadcast, STANDBY in ready, CAUTION on the beat) gets the amber border, the faint amber wash over the panel ramp, the zone halo, and a lit lamp — one zone lit at a time.

### Composer (input)
Inset slot: ground-deep fill, 1px #43301d border, 8px radius, 14px padding, mono 16px cream, lamp-colored caret; focus = amber border + lamp focus ring; disabled (broadcast committed) = 0.55 opacity. Unknown-character flags print beneath in lamp amber 12.5px 600.

### Status Station
Under the head: 9px station lamp + stencil status legend (idle cream-dim / live amber) + machine-dialogue copy (Barlow 15px) + mono progress line (`MARK n OF m · STEP — W WPM`, amber). Takeover notes print in amber 600. aria-live polite on the station itself — states announce; every per-mark progress line carries `aria-live="off"`, so the visible mark ledger never chatters the announcement channel.

### The Mode Lever (run 2)
Two radio-driven machine keys (BROADCAST | RECEIVE) at the top of the deck — the register's direction switch. The active position carries the amber ring; the ring mirrors BOTH the radio's checked state and `body[data-mode]` so static snapshots stay honest. Frozen through any committed run of either mode (the v1 disabled grammar). Focus rides the hidden radio (`:focus-visible + .mode-key`, 2px lamp).

### The Aperture (the eye)

Nested-radius law: an element inset inside a framed plate carries the outer
radius minus the frame padding (the aperture: 4px cap outside, 2px inside its
4px frame) — machined nesting, not a second radius family. The shutter's
inset shadow literal rgba(0,0,0,0.6) is the deepest slot shadow in the system
(the eye's well), recorded here as a one-off material value.
Small metal-framed inset window (head-cap metal ramp, 4px cap radius, max 200px, 3:4) holding the live preview `<video>` — the instrument's eye and the stream's only sanctioned consumer besides the 32×32 sampling canvas. Small by photosafety law: ~13% of viewport area at 390px, ~20% at 320px (WCAG 2.3.1 small-area relief; the only flashing region, replaying sender flashes ≤5 Hz). Closed = the shutter plate: near-black radial with the micro-plate legend "THE EYE IS CLOSED" (mono 10px, cream-dim). The shutter is state-derived (open through armed/active, closed at idle/done — the eye closes the moment the camera releases, never a frozen frame).

### The Hearing Meter
The station's ledger for receive truth: one visible mono line from {HEARING NOTHING, HEARING LIGHT, LIGHT BUT NOT MORSE} (decoding in lamp amber), an actionable hint under silence/noise, the saturated warning and the PARTIAL note in amber 600. Drives `body[data-meter]`; textual truth first — receiving never requires watching the picture. A visually-hidden `aria-live="polite"` paragraph announces decoded WORDS only (letters settle silently; config lives in markup per the refinement-#2 law).

### The Received Record (the tape, inverted)
Blank paper until light punches it: marks append as punch holes inside a growing live group (`.tp-new` die press per heard mark), letters print above and settle to spoken ink, word gaps are spacing. The Ink Ledger maps to hearing: blank = unheard, live ink + amber ring = being heard, spoken = decoded. The lock-time replay and forced bootstrap punch completed groups directly (sequence-independent rendering). The strip shift keeps the record's edge under the fixed head (the broadcast traverse, receive way).

### Receive Transport
STOP LISTENING (a stop key) through armed/active; COPY MESSAGE + LISTEN AGAIN at done with the done note (quiet-closed copy or the honest PARTIAL record — numbers derived from the session constant).

### Share Row
Inline: carries-line (13px cream-dim) + COPY LINK machine key; outcome prints in amber 600 12.5px. The hash itself never renders as UI chrome — the URL is the artifact.

## Do's and Don'ts

### Do:
- **Do** keep amber as the single accent, live-only (The One Lamp Rule) — one lit zone, one amber key, one glowing group at a time.
- **Do** render punches as holes (ground through paper, inset shadow, paper-thickness edge) at fixed geometry: dot 14px, dash 42px, symbol gap 10px at every width.
- **Do** keep every glow a capability layer: zero under `prefers-reduced-motion` and Save-Data with information parity; never flatten the broadcast flash.
- **Do** use `minmax(0, 1fr)` on every content-bearing grid track; re-flow, never shrink, below legibility.
- **Do** theme the browser surfaces you did not draw: selection tint, caret color, focus ring (2px lamp, +2px, radius-preserving), scrollbar — a paper-lo thumb riding the ground, thin, 10px bar pill-capped at 9px like a punch hole (hover steps paper-lo → paper); the viewport is the page's only scroller, so the theme never forces a bar where none exists.
- **Do** keep machine motion on the two curves (`--drive`, `--snap`), strokes ≤200 ms, single-iteration; the tape traverse is the one progress-driven exception.

- **Do** keep the aperture small at every width — the photosafety law outranks viewport drama; the meter carries the truth non-visually.

### Don't:
- **Don't** add steampunk ornament — no brass, cogs, gauges, or antique texture; hairlines and inset slots carry the machine.
- **Don't** introduce blue, neutral gray, or cool secondary text; secondary ink tints from the paper hue.
- **Don't** print sentences in stencil or measurements in Barlow (The Three Voices Rule).
- **Don't** dim the tape's spoken ink below 4.5:1 at the actual letter-row backgrounds, or break the unspoken > live > spoken ordering (The Ink Ledger Rule).
- **Don't** use kickers/eyebrows above headings, gradient text, glyph/emoji icons, hard offset shadows, or a system display face — the world never earns them.
- **Don't** animate the aperture's content — it is a live picture, not chrome; and never show a frozen frame after release.
- **Don't** announce received letters individually — words are the announcement unit (the refinement-#2 law).
- **Don't** add loops, bounces, or entrance fades; plates seat (translate), they never dissolve (opacity belongs only to the die-press keyframe and disabled states).

## Compact instrument update, 2026-10-26

This section supersedes the earlier nameplate, viewport, receive-transport, and
persistent-options descriptions. The paper, ink, and lamp palette remains.

- The small existing M mark, 15px MORSE title, mode lever, and OPTIONS share a
  single toolbar. At 320px, the title remains accessible but is visually hidden.
  The old tagline, decorative header rule, and footer have been removed.
- The main work area fills the remaining dynamic viewport. On portrait phones,
  transmission groups a compact composer, the tape, status, and its
  primary action. Reception gives space to the tape, small camera preview and
  meter, transcript, and transport. Short landscape screens use two columns.
- Tape height is 124px, or 104px on short screens. Punch geometry remains
  14px dot / 42px dash / 10px gap; the receiver mechanics are unchanged.
- The transcript uses 20px mono text with 1.6 line height. It is selectable,
  labeled for assistive technology, and scrolls internally. Appending to the
  existing text node preserves selection. Reading back pauses automatic follow;
  LATEST restores it. COPY is available while receiving and after completion.
  Decoded words still use the existing polite announcer, without letter chatter.
- Speed, sound, and sharing sit in a native OPTIONS dialog. Speed choices share
  one row; their explanation and rapid-flash caution span the full width.
  Safety and camera explanations use a separate native dialog with focus
  containment and Escape recovery. Necessary warning text remains available.
- Functional text has an 11px floor. Header, transcript actions, and dialog
  controls have at least 44px targets; the main transport remains at least 48px.
  Main panels are flat, the message is an inset field, and the dialog backdrop
  is rgba(8, 5, 2, 0.82). The returning-caution caption uses cream-dim for contrast.
- Long transcripts and dialogs own overflow, without scrolling the page.
  Below 450px in narrow portrait, the work area can scroll to support keyboards
  and zoom without clipping controls. Safe-area padding remains in use.

Verified in headless Chrome at 320x568, 390x844, 844x390, and 1440x900. At each
size, the page fits; speed, sound, sharing, caution cancellation, live transcript,
copying, STOP retention, and review-position preservation pass. A 3,299-character
transcript was used to exercise scrolling at desktop size. Captures were directly
inspected on phone, small phone, landscape, and desktop. This is browser-emulated
coverage, not physical-device or screen-reader acceptance.

The Impeccable detector was run once. Its inherited lamp/glow warnings describe
the retained instrument aesthetic. New undersized-text findings were corrected;
current caption sizes and the modal backdrop are documented above. Its native
platform context warning comes from the generated Android wrapper; this remains
a web interface shared by both delivery paths.

### Short-message refinement

The toolbar and work area have a 720px maximum width. Portrait layouts center
the working controls as a group instead of stretching the composer to consume
spare height. The full-width paper band remains the main visual element.

The composer is a centered, 20px mono slot, 96px minimum height with a 156px
ceiling. On screens at most 650px high it uses 18px text and an 80–112px range.
Browsers supporting `field-sizing: content` grow the field inside these bounds;
others keep the compact fixed height and scroll internally. Its label is SHORT
MESSAGE. A quiet caption encourages a few words; the adjacent send duration
comes from the same schedule and selected speed used for broadcasting. Longer
text is retained. Focus gives the slot an amber border and a narrow amber ring.

The transcript has a 176px flex basis and 124px minimum height, retaining its
selectable text, internal scrolling, review hold, LATEST, and live COPY controls.
Keyboard-height portrait work areas align from the top and scroll internally,
so centered overflowing content cannot hide the first control.

Key presses take 130ms on the existing snap curve, move down 2px, and compress
to 98%, replacing the raised shadow with an inset shadow. Reduced motion and
save-data remove the movement while retaining the pressed border and shadow.
No idle animation or additional flashing is introduced.

The original SVG mark also has direct 1024px and 512px PNG exports in
`docs/branding`. The Google Play export has an opaque square background so the
store can apply its own outer mask. These files are excluded from web deployment.
