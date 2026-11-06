---
name: Morse campaign
description: Morse's paper-tape instrument expressed as a responsive demonstration page.
colors:
  ground: "#140d06"
  deep: "#0f0a05"
  panel: "#241a10"
  cream: "#eee0c2"
  dim: "#b3a17c"
  lamp: "#ffb454"
  paper: "#e2d3a8"
  ink: "#2b2013"
  line: "rgba(240,214,166,.2)"
typography:
  display:
    fontFamily: "Saira Stencil, Saira Stencil One, Barlow, sans-serif"
    fontSize: "clamp(2.45rem,11.8vw,4.8rem)"
    fontWeight: 700
    lineHeight: 1.06
    letterSpacing: "0.039em"
  headline:
    fontFamily: "Saira Stencil One, Barlow, sans-serif"
    fontSize: "clamp(2rem,6.5vw,3.7rem)"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "0.01em"
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
  input:
    fontFamily: "Spline Sans Mono, monospace"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.3
  key:
    fontFamily: "Spline Sans Mono, monospace"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.035em"
rounded:
  key: "8px"
  select: "5px"
  punch: "7px"
spacing:
  control-gap: "12px"
  section-gap: "20px"
  key-pad: "13px 18px"
  options-pad: "18px"
components:
  key:
    textColor: "{colors.cream}"
    rounded: "{rounded.key}"
    typography: "{typography.key}"
    padding: "{spacing.key-pad}"
  key-primary:
    textColor: "#241407"
    rounded: "{rounded.key}"
    typography: "{typography.key}"
    padding: "{spacing.key-pad}"
  message-field:
    backgroundColor: "{colors.deep}"
    textColor: "{colors.cream}"
    rounded: "{rounded.key}"
    padding: "9px 48px 10px 14px"
  options-panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.cream}"
    rounded: "{rounded.key}"
    padding: "{spacing.options-pad}"
  paper-register:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "34px 20px 18px"
---

# Design System: Morse campaign

## Overview

**Creative North Star: "The Register"**

This campaign extends the app's punched-paper telegraph instrument. Warm dark ground supports cream text, amber keys and a moving paper register. Barlow explains the demonstration; mono carries the message, controls and measured status.

This file describes the campaign only. The app's design system remains authoritative for the instrument itself. The campaign adds larger stencil headings, a darker ground and a scrolling page with spacious sections.

**Key Characteristics:**
- Warm instrument ground and cream paper.
- Amber actions and signal states.
- Local stencil, Barlow and mono fonts.
- Punched tape moving beneath a fixed read head.

## Colors

The campaign retains the app's warm material palette. The frontmatter records the final CSS cascade, including the darker campaign ground.

### Primary

- **Lamp Amber:** focus outlines, active output selection, sound state and signal feedback. Primary keys use a warm vertical gradient, recorded with their full CSS in the sidecar.

### Neutral

- **Instrument Ground / Deep:** page background and inset message slot.
- **Panel:** the options popover.
- **Cream / Dim:** main text and supporting sentences.
- **Paper / Ink:** the textured register and its printed characters and punches.
- **Line:** section rules, navigation rule and output selector border.

### Named Rules

**The Warm Ground Rule.** Keep supporting text and surface rules within the warm paper-and-ink family used by the campaign.

## Typography

**Display Font:** Saira Stencil, weight 700, with Saira Stencil One and Barlow fallbacks.
**Body Font:** Barlow, locally served at weights 400 and 600.
**Label/Mono Font:** Spline Sans Mono, locally served at weights 400 and 600.

The display token describes the base hero. Below 360px its size becomes 12vw. From 520px through 1199px it becomes clamp(3rem,9vw,4.3rem). At 1200px and above it becomes clamp(47px,6.8vw,100px), with 1.04 line height. The paper-register headline shares the heavier display face; other section headings retain Saira Stencil One.

Body copy uses the body token, with smaller supporting copy at 14px to 16px. Measured labels and option controls start at 11px. The message uses the input token, falling to 20px below 360px and using clamp(18px,1.6vw,24px) on desktop. Receipt text uses mono with clamp(23px,6vw,38px) and 1.45 line height, changing to clamp(26px,3vw,40px) on desktop.

### Named Rules

**The Measured Text Rule.** Keep editable messages, counts, tape letters and receipt output in mono; use Barlow for explanatory copy.

## Layout

The page scrolls beneath a sticky header. Most sections use a centered 1180px maximum width with 20px side gutters, changing to 48px gutters at desktop. Below 360px the gutters become 16px. Paragraphs generally stop at 68ch.

Below 1200px the hero uses document flow, with headline, phone exchange, explanation, demo and actions stacked. From 520px, message and send controls share a row; the phone scene caps at 660px and its controls at 800px. Output choices change from two columns to four at 520px.

At 1200px the hero becomes a positioned composition with a 1487/850 aspect ratio and 1600px maximum width. Lower sections use paired columns, while the paper register places its headline beside the tape. Desktop header links become visible. The tablet header also exposes the demo link.

Repeated control gaps use the frontmatter spacing tokens. Section spacing is substantially larger than the app's compact viewport: channels use 72px vertical padding on mobile and 110px on desktop; the closing section uses 74px and 100px respectively.

## Elevation & Depth

The paper texture, inset punches, read-head rails and key gradients supply material depth. Primary keys have a soft warm shadow; the options popover has a darker raised shadow. The sidecar records these and the mechanical motion curve.

Keys move down 2px when pressed. Tape translation takes 190ms; key transitions take 140ms. Reduced-motion removes transitions, pressed movement, vibration movement and live signal/lamp shadows. Signal state still follows the message timing.

## Shapes

Keys, message field, options popover and grouped output selector share the key radius. Paper spans the page with straight edges and repeated perforations. Tape punches use a 14px dot and a 42px dash with 8px gaps, beneath a fixed 68px read head. The desktop demonstration plaque has clipped corners; it is a campaign ornament, not a general container shape.

## Components

### Buttons

Primary keys use an amber gradient with dark text; secondary keys use a dark warm gradient with cream text. Shared padding and type live in the frontmatter. Standard keys have 48px minimum height, prominent hero actions 56px. Hover warms the fill or border. Keyboard focus uses a 2px amber outline with 4px offset. Disabled keys use half opacity.

### Inputs / Fields

The inset message field has an amber-brown border, a mono label and count, and a transparent uppercase input. Focus-within turns the field border amber. The input and clear action each retain 44px minimum targets. The native select uses the select radius and 48px minimum height. The options popover opens beneath its summary, aligns right, and caps at 280px or viewport width minus 40px.

### Navigation

The sticky header has a thin bottom rule and a persistent tester action. Brand and links use at least 44px targets. Footer links wrap; full desktop navigation appears at the desktop breakpoint.

### Beta signup

The header and hero beta actions jump to an ordered signup guide. Its sequence is Google Group, Google Play beta opt-in, then the store listing. Steps stack on phones and use three columns from 900px. Mono numbers mark the required order; Barlow headings and body text explain each action. Each step reuses the secondary key, and external links open separately so the guide stays available.

### Output selector

The grouped buttons use mono labels and outline SVG icons. Selection adds amber text, a warm inset fill and a bottom amber rule. Focus stays inside the group with a negative outline offset. Playback disables selection until the run ends.

### Paper register and receipt

Typing rebuilds the punches and centers the first letter under the head. Playback moves each live letter beneath it, then leaves completed letters in muted ink. The receipt is a ruled mono output, with wrapping for long content and a small state lamp. These are demonstration outputs from the same message schedule.

## Do's and Don'ts

### Do:

- **Do** use the campaign's final ground token and locally served fonts.
- **Do** keep the message, tape and receipt in the same mono voice.
- **Do** preserve the stacked mobile layout and the reduced-motion treatments.

### Don't:

- **Don't** transfer the campaign's large display scale into the compact app toolbar.
- **Don't** replace the paper register with a generic rounded card.
