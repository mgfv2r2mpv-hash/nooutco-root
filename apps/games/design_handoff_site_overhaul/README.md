# Handoff: No Outcome ABA — site overhaul (games + tools)

## Overview

This package hands off the **No Outcome ABA design system** and the upgraded
designs for two existing static sites:

- **`games-nooutco-me`** — the Games & Activities site (skill-targeted ABA
  teaching activities).
- **`tools-nooutco-me`** — the Behavior Analysis Tools site (assessment,
  documentation, planning, session structuring).

The goal is to **overhaul both sites' visual layer** to the No Outcome ABA
brand (Atkinson Hyperlegible type, dusty-sage palette, the ensō "NO" mark,
shared tokens) **without changing their architecture** — and to add the new
features prototyped here (Emotion ID game, Simple/Visual display duality, the
ranked "Prioritize" voter + Worker, the Suggest-a-feature tool).

## About the design files

The HTML/CSS/JS files in this bundle are **design references** — high-fidelity
prototypes showing the intended look, copy, and behavior. They are **not** meant
to be dropped into the sites verbatim.

Both target repos are **static, no-build sites** (plain HTML/CSS/JS served
directly, deployed on Cloudflare Workers; see each repo's `CLAUDE.md`). Recreate
these designs **in that same static idiom** — hand-written HTML/CSS/JS, no
framework, no bundler — matching each repo's existing conventions (the
`admin-gear` + SHA-256 `localStorage` admin pattern, the per-game
`index.html` + `game.js` + `style.css` layout, the shared support/footer
blocks). Where this bundle uses CSS custom properties from `styles.css`, fold
those tokens into each site (e.g. a shared `tokens.css`) rather than linking
this project.

## Fidelity

**High-fidelity.** Colors, typography, spacing, radii, and interactions are
final. Recreate the UI pixel-for-pixel using each site's static patterns. Exact
values live in the bundled `tokens/*.css` and `readme.md`.

## Design tokens (authoritative: `tokens/` + `styles.css`)

- **Type:** Atkinson Hyperlegible (brand face; Braille-Institute legibility
  face — load from Google Fonts), system-sans fallback; Atkinson Hyperlegible
  Mono for numerals/code. Tight working scale (13px body); 700/800 carry
  hierarchy; uppercase + `0.06em` tracking for eyebrows/pills.
- **Primary (sage):** `--sage-500 #6a7659` (dusty, brown-toned green), hover
  `--sage-600 #5d6a4d`, deep/nav `--sage-700 #4d5840`, tints `#e2e6d9` / `#f1f3ec`.
  Brand identity uses this; **the brighter emerald greens are reserved for
  "met/completed/correct," never for primary.**
- **Ink / mist (logo):** charcoal `#3a4448`, dusty-blue disc `#a6c2cf`.
- **Status (compliance):** behind `#b91c1c`, on-pace `#b45309`, met `#15803d`,
  **over `#9a3412`** (orange-red, audit risk above ~20% supervision).
- **Cancellation by canceller:** admin (taupe `#94785a`), family (orange
  `#f59e0b`), BT (red `#dc2626`), BCBA (maroon `#7a1d2b`), BCBA-PTO (gold
  `#c79a2e`); sequential repeats step darker.
- **Clinical phases (SessionFlow):** open `#1d9e75`, pair `#7f77dd`, work
  `#378add`, ease `#ef9f27`, repair `#d85a30`, handoff `#888780`.
- **Neutrals (slate):** structural greys + the colour of **non-billable**
  (admin / travel / PTO).
- **Spacing:** 4px grid (gaps run 4–6px). **Radii:** chips 3–4, controls 6,
  cards 8, sheets 12–16, pills 999. **Shadows:** soft/low-spread; cards lean on
  borders. **Motion:** calm fades/slides 0.15–0.3s, ease-out; no bounce/loops.

## Screens / views in this bundle

### 1. Games hub — `ui_kits/games/index.html`
- **Purpose:** entry point; choose a teaching activity, grouped by skill domain
  (Discrimination, Receptive Language, Concept/Verbal/Social, plus a **Planned**
  roadmap).
- **Layout:** centered max-width 1040px; ensō brand row; H1 + lede; a
  **Simple ⇄ Visual** display toggle (the product's core duality — Simple =
  calm/flat/distraction-free, Visual = illustrated + celebratory but still
  low-arousal); domain sections (eyebrow + dot + rule) over a 2-col card grid;
  cards = accent bar + emoji + label/title/desc + hover arrow.
- **Planned section** carries the **Prioritize voter** (see Interactions).
- Replaces the original `bg`-randomizing hub; keep the existing emoji icon
  vocabulary (📅🔧✨…) and the support/license footer.

### 2. Emotion ID game — `ui_kits/games/EmotionID/index.html`
- **Purpose:** teach emotion identification — **receptive** (find the named
  emotion in a field) and **expressive** (tact a single emotion stimulus).
- **Receptive:** app shows the clinician the SD to deliver (`Touch {emotion}`),
  presents a configurable face field (2–6), auto-scores the learner's tap.
- **Expressive:** single face; app prompts the tact SD (`How does {pronoun}
  feel?`); clinician scores **Independent / Gestural / Partial / Model /
  Incorrect**.
- **Configurable & saved (localStorage):** emotion set, field size, receptive &
  expressive SDs (presets + free edit), pronoun (He/She/They/**Rotate**).
- **Visual mode:** per-emotion color scenes + a 5-token reward strip (earn ⭐ →
  "Great work!"). **Simple mode:** flat neutral, no animation.
- Faces are emoji placeholders — **swap in the site's own photo/illustration
  sets** (the games already use `_Resources/_imgSource/...` topic folders).

### 3. Tools hub — `ui_kits/tools/index.html`
- **Purpose:** entry point to the BCBA/BT tools, grouped Direct Service /
  Supervision-Parent / Assessment-Planning.
- **Privacy-first framing** is the key addition: a prominent band — "your client
  data stays with you; these tools structure your writing or generate a prompt,
  never store PHI or replace your clinical record" — plus per-tool tags
  (`Prompt-only`, `No PHI stored`, `Runs locally`, `Replaces printout`).
- Tools: In-Home Session Flow Guide, BT/Supervision/Parent/Assessment note
  tools, CPR Analyzer, SAP Goals.

### 4. Suggest-a-feature — `ui_kits/tools/SuggestFeature/index.html`
- **Purpose:** zero-backend feedback box. Segmented kind + role, summary, idea
  (counter), optional email; a "don't include client info" guardrail; primary
  button composes a `mailto:` (with "Copy instead" fallback). **Set the real
  address** (`SUGGEST_TO`) or wire to a Worker for silent server-side delivery.

### 5. Prioritize voter + Worker — `ui_kits/games/prioritize-worker/`
- Ranked top-3 voting on Planned features (see Interactions). The Worker
  (`worker.js`, `wrangler.toml`, `README.md`) is deploy-ready Cloudflare KV.

### 6. SAssi scheduler app — `ui_kits/scheduler/`
- **Purpose:** the SAssi scheduling + compliance app (the product the core
  design system was reverse-engineered from), recreated in React from the
  design-system components and **design-ified** to the new brand.
- **Chrome:** ink header (`#333f45`) with the ensō mark + "SAssi · ABA
  Calendar", sage primary add-button, sage active-nav, emoji nav (📅 Cal / 🔧
  Comp / ✨ Wish).
- **Views:** month calendar with type-accented appointment chips + a docked
  context pane (hours meter, agenda, appointment detail); compliance dashboard
  (traffic-light incl. the **Over** audit state); Wish It AI rework.
- This is a React/bundle kit (loads `_ds_bundle.js`); in the real app, mirror
  the structure in its own stack — the value here is the visual + interaction
  spec, not the bundle.

## Interactions & behavior

- **Simple ⇄ Visual toggle** (games): a display mode that changes richness, not
  the teaching target. Persist per user. Keep Visual calm — soft color, brief
  single (non-looping) feedback, optional token reward; respect
  `prefers-reduced-motion`.
- **Prioritize voter** (games Planned): each card has a **1 / 2 / 3** picker.
  Choosing a rank assigns that card as the user's 1st/2nd/3rd; each rank is used
  once; re-tapping the active rank clears it; picking a rank a card already
  holds moves it. Weighted points (3/2/1) drive a live re-rank; the leader shows
  a "★ Most wanted" badge; the user's picks show 🥇🥈🥉. Ballot persists in
  `localStorage` and, when `API_BASE` is set, POSTs to the Worker (changing a
  vote overwrites the visitor's ballot). Anonymous random `clientId` only — no
  accounts, no PII.
- **Emotion ID:** SD/pronoun/set/field-size persist in `localStorage`; receptive
  auto-scores on tap (650ms advance on correct, 1100ms on error with the correct
  face highlighted); expressive logs prompt level; running tally + "Copy data"
  session summary (counts only, no PHI).
- **Suggest-a-feature:** builds `mailto:` subject/body from the form; "Copy
  instead" writes the draft to clipboard and reveals it.
- **Motion everywhere:** ease-out `cubic-bezier(0.4,0,0.2,1)`, 0.15–0.3s, no
  spring/bounce/loops.

## State management

- All client state is `localStorage` (namespaced `noaba.*`) — never store client/
  PHI data. Keys in use: `noaba.games.ranks.v1` (ballot), `noaba.clientId`
  (anon id), `noaba.emotionID.v1` (game config). Server state is only the
  Worker's KV ballots.

## Assets

- `assets/logo-mark.svg` — the ensō + mountain-**N** brand mark (refined vector
  of the founder's hand-drawn original).
- `assets/app-icon.svg` — app-icon variant: the N as motion-lines moving
  appointment blocks on an undated calendar; greens signal "yes."
- `assets/wordmark.svg` — horizontal lockup (mark + "No Outcome ABA").
- Game stimuli here are **emoji placeholders** — replace with the sites' own
  image sets.

## Files in this bundle

- `readme.md` — full design system guide (voice, visual foundations,
  iconography, brand, caveats). **Read this first.**
- `SKILL.md` — Agent-Skill front matter; usable directly as a Claude Code skill.
- `styles.css` + `tokens/*.css` — the authoritative tokens (link/inline these).
- `assets/*.svg` — brand marks.
- `ui_kits/games/index.html` — games hub (+ Simple/Visual, Prioritize voter).
- `ui_kits/games/EmotionID/index.html` — Emotion ID game.
- `ui_kits/games/prioritize-worker/*` — votes Worker + deploy README.
- `ui_kits/tools/index.html` — tools hub.
- `ui_kits/tools/SuggestFeature/index.html` — suggestion tool.
- `ui_kits/scheduler/` — design-ified SAssi scheduler (React kit).
- `screenshots/` — reference renders of each screen.

## Screenshots

Reference renders in `screenshots/`:
- `games-hub.png` — games hub (Simple display, Prioritize voter).
- `tools-hub.png` — tools hub (privacy-first framing).
- `suggest-feature.png` — Suggest-a-feature tool.
- `scheduler.png` — design-ified SAssi scheduler (calendar view).
- `01-emotion-id.png` / `02-emotion-id.png` — Emotion ID in **Simple** vs
  **Visual** display (the duality in practice).

## How to use this with Claude Code

1. Unzip this folder into (or beside) the target repo.
2. Open the repo in Claude Code and point it at this `README.md`.
3. `SKILL.md` works as a Claude Code **skill** — drop the design-system files in
   a skill folder so Claude Code can pull brand rules, tokens, and assets on
   demand.
4. Ask Claude Code to recreate each screen in the site's existing static
   structure, lifting exact values from `tokens/` — not to ship these HTML files
   as-is.
