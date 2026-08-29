# Shape Brief — The Morse Code Broadcaster

Status: **LOCKED by user 2026-08-28** — "The Register" chosen at the single design touchpoint (seed key 53cae9af, telemetry pinged). Direction contract (THESIS/OWN-WORLD/STORY/FIRST VIEWPORT/FORM/FINISH) is written into the artifact's opening comment at build time in production; DESIGN.md is written at finish by the shipped documenter.

## 1. Job and audience

A person at a gathering pulls out their phone, opens a link, types a message, and holds the phone up so the room watches its light speak Morse. Visitor mode: **Operate** — a tool used one-handed in a dim room, watched by onlookers. Physical scene (forces the ground): dark room, phone in hand, light is the point → dark warm ground, the instrument glows.

## 2. Outcome and proof

Cold open → broadcast within 15 s; shared link → 2 taps. Proof is the phone's own light (or screen) blinking the message in correct ITU Morse with synchronized sound — no marketing needed; the mechanism is the demonstration.

## 3. Selected direction (assigned by roll): "The Register" — punched-tape telegraph register world

- **World:** the telegraph register and Wheatstone perforated-tape tradition — a paper strip punched with dots and dashes, read by a machine head. Warm paper tape band crossing a dark instrument ground; punches are holes the ground shows through; machine-plate stencil legends; one lamp-signal accent for live states.
- **Structural thesis:** the live tape IS the translation and the traversing read-head IS the broadcast. Typing punches the tape in real time; during broadcast the head travels the strip and each punch passing the head fires the lamp/screen/audio — progress, rhythm, and correctness are all visible in one instrument. This refuses the category default (centered card + textarea + blue button).
- **Signature interaction:** the read-head traverse with per-mark firing (torch echo pulse in the ground on desktop).
- **Raises from declined challengers (named donors):**
  - *Arcade's capability-layer law:* every glow/bloom effect is a capability layer that degrades to crisp punches with zero information loss (reduced-motion, low-power).
  - *Cape's named-states law:* speed is a small set of named steps (e.g. LEARNER / STANDARD / BRISK), never a continuous anonymous slider — more legible, photosafety-friendlier.
  - *Transit's corridor-focus law:* any reference chart shows the message's own letters at full legibility first; a complete alphabet never shrinks into an unreadable miniature.
- **Honest risk:** machine-shop kitsch (brass-cog steampunk) if discipline slips — the register is precision instrumentation, not antique-shop decor; and a horizontal tape must stay legible in portrait phone use.

**Competitive alternates (full cards, kept on the table):** phosphor-terminal midnight (states print themselves as typed dialogue — strongest alternate), cyclorama dawn (pre-flight as a stage lighting standby ritual), starship terminal (photosensitivity caution as a hazard pictogram plate).

**Pick card (my top-ranked, not assigned):** The Signal Lamp — the Aldis-lamp world with a shutter lever; most literal embodiment (manual keying mode beckons), highest familiarity, least "what is that?" distinctiveness.

**Standing exit:** the canon — clean centered utility card with textarea and button, played straight, if the user asks for the familiar.

## 4. Scope and boundaries

Single surface (the app screen), production fidelity, fully interactive broadcast flow. Named target: `index.html` at project root. Anti-goals: marketing/landing page, multi-screen app shell, gamification chrome, decorative animation without signal meaning.

## 5. States and ranges

- Message: typical 1–140 chars (party message), max ~500 with tape scroll; live preview with unknown-character flags.
- State matrix: torch supported × granted / denied / unsupported (screen mode) — each state must read instantly; broadcasting / paused / done; mid-broadcast track loss → fall back to screen without losing the message.
- Share hash round-trip (message + speed); first-visit photosensitivity notice before first broadcast.

## 6. Interaction and layout (intent, not CSS)

Hierarchy: message input (top), the tape band (the hero, dominant), transport controls (broadcast/replay, thumb-reach), speed steps, share. System states print as machine-dialogue lines near the head, not popups. Caution (photosensitivity) renders as a proper hazard plate: pictogram, one imperative line. Broadcast = standby → caution → GO sequence. All glow effects capability-layered; `prefers-reduced-motion` degrades to static punches.

## 7. Constraints and open decisions

Binding: plain static HTML/CSS/JS, no build step, no dependencies; HTTPS delivery; no frame access; photosafety caps on flash rate; iOS Safari = screen mode by design. Open (production-time): exact tokens/faces at world-commit; WPM step values (research-informed); tape pacing copy. Build path: **code-led** (no image generation in this harness; nothing to record in .impeccable/config.json — the choice does not exist here).
