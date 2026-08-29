# Deploy — The Register (task D0)

**Who runs this:** you. Deploying means publishing to an external service — that
part is user-owned by design; this document is the handover. **Time:** ~5 minutes
for any host below.

**Why HTTPS matters here:** the camera API (`getUserMedia`, which unlocks the
torch) only works in a secure context. All three hosts below serve HTTPS
automatically — that is most of why they were chosen. If the app is ever opened
over plain `http://`, the torch path is silently unavailable and the app lands in
screen-flash mode (honest fallback, not a crash).

---

## 1. What ships

The app is **15 files, no build step, no dependencies**. Deploy the directory
as-is — nothing to compile, install, or configure. (Inventory verified against
the actual repo tree, not guessed:)

```
index.html          ← the whole app document
css/main.css        ← the only stylesheet
js/app.js           ← entry point (loaded by index.html)
js/morse.js         ┐
js/schedule.js      │
js/torch.js         │
js/screen.js        │ └ the nine logic modules app.js imports
js/audio.js         │   (all ten js/ files are load-bearing)
js/conductor.js     │
js/hash.js          │
js/states.js        │
js/copy.js          ┘
favicon.svg         ┐
favicon.ico         │ the favicon (punched-tape M mark) in three formats
apple-touch-icon.png┘
```

- All asset references are **relative** (`css/main.css`, `js/app.js`), so the
  bundle works at a domain root *or* any subpath (e.g.
  `https://user.github.io/repo/`) with zero changes.
- The only third-party request the page ever makes is the Google Fonts
  stylesheet pair (`fonts.googleapis.com` / `fonts.gstatic.com`). No font files
  to ship.
- **Optional to publish:** `PRODUCT.md`, `DESIGN.md`, `docs/` — informational,
  nothing in the app references them.
- **Do not publish:** `test/`, `package.json`, `.impeccable/` — dev artifacts.
  Publishing just the 12 files keeps them private for free.

**One-time prep** (builds a clean folder containing only the bundle):

```bash
cd /Users/arrangedgodly/Documents/Projects/morse-code
mkdir -p /tmp/register-bundle
cp -R index.html css js /tmp/register-bundle/
```

Every host below deploys `/tmp/register-bundle`.

---

## 2. Host options (all free, all HTTPS-automatic)

**Honest note on accounts:** none of these three options is truly
account-free — every path to a publicly viewable HTTPS URL below requires a
free account somewhere (Netlify to claim the drop, GitHub, or Cloudflare).
Netlify Drop is still the fastest of the three; the account step just comes
after the drag-and-drop instead of before it.

### Option A — Netlify Drop (fastest: live in seconds; free account to make the link public)

For the fastest route to a link you can open on a real phone — the deploy
itself is drag-and-drop in seconds; making the link publicly viewable takes a
free signup (a signed-out drop is **not** public — see below).

1. Open <https://app.netlify.com/drop>.
2. Drag the `/tmp/register-bundle` **folder** (or a zip of it) onto the page.
   The site deploys within seconds at `https://<random-name>.netlify.app` —
   HTTPS automatic, zero configuration. **But while you are signed out, the
   URL is protected by a temporary password until the site is claimed.** The
   drop is available to you as soon as it uploads; anyone else opening the
   link — including a phone — hits the password page.
3. Make the link public: **sign up (free) and claim the site** while the Drop
   tab is still open — the claim window is about **one hour**. The URL stays
   the same when you claim.
4. After claiming, **check the site really is public**: accounts created
   since September 2025 are on credit-based plans where projects can be
   private by default. If yours is, make the site public in its settings,
   then confirm by opening the URL in a private/incognito window — no
   password page means public.

**Caveats (real, current):**
- **An anonymous drop is both private and short-lived.** The URL is
  password-protected until claimed, and unclaimed sites are suspended, then
  **deleted about a week later** (the claim window itself is ~1 hour).
  Signing up and claiming in step 3 avoids both.
- A spurious "log in" wall is a known glitch, usually caused by browser
  extensions/ad-blockers — retry in a private/incognito window.
- To update later (once claimed): your site in the Netlify dashboard →
  **Deploys** → drag the folder again.

### Option B — GitHub Pages (permanent, free, needs a GitHub account)

1. Create the repo: log in at <https://github.com> → **New repository** → name
   it (e.g. `morse-register`) → **Public** → do **not** add a README/license →
   **Create**. (On the free plan Pages only serves **public** repos — fine
   here, the bundle contains no secrets.)
2. Push the bundle (first-time git config may ask your name/email — follow the
   hints it prints):

   ```bash
   cd /tmp/register-bundle
   git init -b main
   git add -A
   git commit -m "The Register — initial deploy"
   git remote add origin https://github.com/<your-username>/morse-register.git
   git push -u origin main
   ```

3. Enable Pages: repo → **Settings** → **Pages** → under "Build and
   deployment", Source = **Deploy from a branch**, Branch = **main** / **/(root)**
   → **Save**.
4. In about a minute the site is at
   `https://<your-username>.github.io/morse-register/`. HTTPS is automatic;
   once the certificate issues, tick **Enforce HTTPS** on the same screen.
5. To update: edit files → `git add -A && git commit -m "update" && git push` —
   Pages redeploys automatically.

**Caveat — Jekyll / `.nojekyll`:** GitHub Pages runs files through Jekyll,
which silently drops underscore-prefixed files and folders (`_next/`-style
assets). **This bundle has none** (checked: no `_`-prefixed path exists), so
nothing is required and `js/` + `css/` serve untouched. Adding an empty
`.nojekyll` file to the repo root is harmless belt-and-braces if you ever
publish more of the project.

### Option C — Cloudflare Pages (permanent, free, needs a Cloudflare account)

1. Create a free account at <https://dash.cloudflare.com/sign-up> (email
   address is enough) and log in.
2. **Workers & Pages** → **Create application** → **Pages** → under
   "Drag and drop your files" click **Get started**.
3. Name the project (the name becomes the URL), drag `/tmp/register-bundle`
   into the upload area → **Deploy site**.
4. Live at `https://<project-name>.pages.dev` — HTTPS automatic, free tier.

**Caveats:** a direct-upload project can't be switched to Git integration
later (irrelevant for a one-shot deploy); to update, create a new deployment
the same way (deployments are atomic); drag-and-drop accepts up to 1,000 files
/ 25 MiB each — this bundle is 15 small files.

### Option D — Cloudflare Workers, Git-connected (push-to-deploy)

The repo ships a committed `wrangler.jsonc` (Worker name `morse-code`,
static assets served from the repo root). In the Cloudflare dashboard:
**Workers & Pages** → **Create** → connect the GitHub repo → accept the
defaults (no build command; deploy command `npx wrangler deploy`). Every
push to `main` redeploys automatically; live at
`https://morse-code.<your-subdomain>.workers.dev` (HTTPS automatic).

**Why the config is committed:** without it, Wrangler runs its interactive
setup inside the build, installing itself as a local devDependency — the
resulting `node_modules/workerd` (146 MiB) lands in the assets directory and
the deploy fails Workers' 25 MiB per-file limit. With the config present,
setup is skipped, nothing is installed into the repo, and the upload is just
the committed files (~2 MiB).

---

## 3. Post-deploy verification checklist

Run these on the deployed URL (this is also `DEVICE-TEST.md` §1 **Option B** —
the most realistic Q3):

- [ ] **HTTPS padlock** present in the address bar on each device (no
      certificate warning). If a browser ever shows the app over plain
      `http://`, something is wrong with the host config — fix that, not the app.
- [ ] **Android + Chrome:** type `HELLO` → BROADCAST → acknowledge → CONTINUE →
      Allow. Expect the torch path: `TORCH READY — LAMP ARMED…` and exactly
      **one** test blink. Run one LEARNER broadcast (~12 s, 16 marks).
- [ ] **iPhone/iPad, iOS 17.4+, Safari:** same journey — **record which channel
      you got**, `TORCH READY` or `SCREEN READY`. Either is a valid result on
      iOS (torch support is newer there); note the iOS version.
- [ ] **Desktop, any browser:** expect `SCREEN READY — SCREEN ARMED…` and one
      screen-light broadcast. (A webcam-equipped desktop may legitimately show
      the camera prompt once before landing in screen mode — by design.)
- [ ] **Share round-trip from a real phone:** type a short message, pick a
      non-default speed (STANDARD), COPY LINK, open the URL on a second device
      → the message and speed auto-fill.
- [ ] **Full script:** `docs/DEVICE-TEST.md` — Android A1–A13, iOS i1–i8,
      desktop D1–D2, results table. Deployed-URL results double as the Q3
      evidence.

---

## 4. What deliberately does NOT exist

- **No server** — nothing runs anywhere; the URL is files on a CDN.
- **No analytics, no cookies, no storage** of any kind (verified in the Q2
  audit: zero storage APIs, no network calls beyond the Google Fonts
  stylesheet, and no request ever carries the message).
- **No secrets, keys, or environment variables** in the bundle — there is
  literally nothing to configure before or after deploying, and nothing to
  leak.

Deploying = copying 12 files. That's the whole job.

---

*Cross-reference: `docs/DEVICE-TEST.md` §1 Option B (deploy-first testing) and
§2–§7 (the full real-device script and the TORCH_LEAD_MS retune protocol).
Host facts above verified against current vendor documentation on 2026-08-29
and corrected at the D0 retry (Netlify Drop: password-gate until claimed,
~1-hour claim window, suspend-then-delete retention) — see the T-D0 and
T-D0 retry entries in `docs/ultron/production-log.md` for the source list.*
