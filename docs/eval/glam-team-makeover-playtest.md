# Glam Team Makeover — playtest evaluation

**Build under test:** `apps/games/glam-team-makeover/index.html` (unmodified — see *Method*)
**Served from:** `npx wrangler pages dev .` in `apps/games`, at `http://localhost:8788/glam-team-makeover/`
**Driven with:** Playwright (Chromium), scripted playthroughs in a scratch directory that is **not** committed
**Date of run:** 2026-07-24

> **Status — this report is being built up across passes.**
> Playthroughs **1 and 2** are complete and written up below. Playthroughs **3, 4 and 5**
> are specified but **have not been run yet**; their sections say so explicitly and they
> are listed in *Not tested*. Every finding in the tables below was reproduced in a
> browser. Nothing here is inferred from reading code alone — code references are given
> only to locate a behaviour that was first observed.

**Screenshot paths** in this report point at `.gnhf/runs/objective-produce-an-e923a7/shots/`,
which is a local, git-excluded run artifact directory. The screenshots are evidence for the
person who ran the playtest; they are not committed with this report.

---

## 1. Summary — worst first

1. **The primary clinical target is not measured at all.** The program is meant to teach
   *take a turn → relinquish → wait → ask → resume*, and to score the **relinquish** step as
   independent vs. prompted. The build scores nothing about relinquishing. `handoff()` only
   increments a turn counter. Passing the turn after zero actions, after the exact number of
   actions, or only after the pulsing button prompt all produce **identical** data: a token,
   a bonus, and `turnsTaken + 1`. The end-of-session stat line therefore cannot answer the one
   question the BT needs answered.

2. **The "give it back" prompt never fades and is never recorded.** Once the action goal is met,
   the "Done — their turn ▸" button starts a CSS pulse (`animation: gtm-cue`) and pulses forever.
   That is a permanent visual prompt on the target response. The four-level cue fader
   (full → short → icon → none) that the settings expose is wired to a *different* response —
   the ask-for-it-back step — not to relinquishing.

3. **Illegal actions are silently swallowed.** At the per-turn cap, tapping a target does
   nothing at all: no refusal message, no flag, no datum, no prompt to pass. I tapped a live,
   pulsing blemish target **eight** times past the cap and the app's internal counters did not
   move and nothing appeared on screen. (Evidence: `pt1-05-t1-at-cap.png`, `pt1-06-t1-overcap.png`.)

4. **Nothing distinguishes who is touching the screen.** During the partner's turn the whole
   palette stays live and *uncapped by the learner's own goal*. The learner can spend the
   partner's entire turn — and in playthrough 1 that is exactly what happened: the learner's
   taps ended the partner's turn for them.

5. **A counted partner turn has no exit control.** There is no button of any kind during the
   partner's turn. The only way out is to perform exactly `partnerGoal` *newly-charged* actions.
   I sat idle for 8 s in phase `theirs`: nothing changed, and the only interactive things on
   screen were the palette tools and the ⓘ Method button. (`pt1-12-theirs-idle-8s.png`)

6. **The "Actions left" meter counts the wrong way.** The pips fill as actions are *spent*.
   Three filled dots under the label "ACTIONS LEFT" means **zero** left.
   (`pt1-02-t1-mine-start.png` = 0 spent, 3 empty · `pt1-05-t1-at-cap.png` = 3 spent, 3 filled.)

7. **The turn meter only exists in one of the three turn maps.** Both the countdown clock and
   the action pips are rendered only by the *Banner* map. Choose *Vanity stations* or
   *Turn runway* and there is no countdown and no action counter anywhere on screen. In
   playthrough 2 (Timed + Vanity) the turn simply ended with no warning of any kind.

8. **The whole "Shirt color" category is invisible.** The shirt is painted into a band that is
   100 % covered by the vanity-ledge overlay. Measured: applied shirt pixels occupy page-Y
   729.6–800.9; the ledge spans 706.6–813.5. An action is spent, a ✓ appears on the button, and
   the doll does not change. (`effect-final-look.png`)

9. **Small-phone layout breaks.** At 375 × 667 the document overflows horizontally by 88 px and
   the doll scrolls off-screen.

10. **Five SVG console errors on every single load.** Harmless-looking but not a clean console.

---

## 2. Playthrough 1 — staged skincare, counted turns, partner hands it back

### Configuration

| Setting | Value |
|---|---|
| Theme | 🎉 Social event *(the only option offered — see F-19)* |
| Routine | Staged (in order) |
| Turn map | Banner |
| My turn | Count shown · 3 actions |
| Their turn | Same as mine (fair) |
| Give-back | They hand it back |
| Ask cue | Full sentence |
| Goal | 3 ⭐ |
| Earn more time | on |
| Model | M2 (default) |
| Viewport | 1280 × 900 |

**Outcome: reached a real ending** — 3 ⭐, "Ta-da — what a team!" (`pt1-13-done.png`).

### What happened

Turn 1 opened with exactly three tools on the palette: **Wash**, **Shape brows**, **Brow pencil**.
Everything else in the routine was *absent* rather than shown-and-locked. Washing revealed
**Moisturize**; moisturizing revealed **Treat spots** and **Conceal**.

I spent the three allowed actions (Wash → Moisturize → patch one blemish) and hit the cap. From
that moment:

* The banner text changed to **"All set — now I hand it over!"** and the "Done — their turn ▸"
  button began to pulse.
* But the palette hint above the tools still read **"✋ NOW DO IT ON THE FACE →"**, and the two
  remaining blemish targets were still drawn on the doll, still pulsing red, still clickable.
* I tapped a blemish once, then five more times. Nothing happened — no message, no shake, no
  sound, no counter movement. The four tools that would spend a *new* action dimmed to 45 %
  opacity with `cursor: not-allowed`; the two already-charged tools (Wash, Moisturize) stayed
  fully bright and re-armable, and re-applying them was free.

I handed over. Token 1 awarded, bonus +1, `turnsTaken` 1.

On the **partner's turn** the entire palette went back to full brightness and I — still playing
as the child — armed *Treat spots* and patched another blemish. It applied, and it counted
against the partner's three actions. Two more actions (Wash, Moisturize) ended the partner's turn
*for* the partner. The "▸ My turn again" button then appeared with the message
"They finished their turn." Because give-back was set to *They hand it back*, the ask step never
ran, so the ask cue setting ("Full sentence") never appeared at any point in the whole session.

Turn 2 I handed over **immediately, with zero actions spent**. The app awarded a token, awarded
another bonus, incremented `turnsTaken`, and moved on — indistinguishable from a completed turn.

I then left the partner turn completely untouched for 8 seconds. Nothing happened. Phase stayed
`theirs`; the only visible interactive controls were the six palette tools and ⓘ Method. There is
no "they're done" button, no skip, no timeout.

Turn 3 hit the 3 ⭐ goal. Final stat line, read from the ⓘ Method panel:

> **3 turns handed over · 0 independent asks · 0 prompted asks**

### Client (player 1)

* **Whose turn it is** is unmistakable in this map. The banner is large, colour-coded
  (sage = me, blue = them), carries an avatar glyph and an all-caps "MY TURN" label. This is the
  strongest part of the design.
* **The count is unreadable.** "ACTIONS LEFT" with three filled dots means none left. A child
  who can count will read it as three remaining.
* **The cap is a wall with no sign on it.** The app tells the child "Now do it on the face →",
  keeps a red target pulsing on the face, and then refuses every touch of it without saying
  anything. This is the single most confusing moment in the run.
* **Steps appear out of nowhere.** Nothing forecasts that washing will reveal Moisturize. The
  child cannot see the routine ahead of them, only the one or two steps they can do now — which
  undercuts the "The routine: Skincare → Makeup → Hair → Accessories" promise on the intro card.
* Handing over is well reinforced: a token lands, stars fill, and the next turn is visibly longer.

### BT (player 2)

* **Setup is fast** — one bar, nine dropdowns, all on one screen at desktop and tablet size.
* **The data is empty.** After a complete, correct session the stat line reads *0 independent
  asks · 0 prompted asks*. In this give-back mode those two counters can never be anything else,
  because the ask phase is skipped entirely. The BT gets one number — turns handed over — and it
  counts turns that were passed instantly with zero actions the same as turns that were played out.
* **The configured turn size drifts.** "Earn more time" is on by default; in a *count* mode it
  grants extra **actions**, not time. The goal of 3 became 4 on turn 2 and 5 on turn 3. The
  setting's label says "time", the effect is actions.
* **There is no record of the over-cap attempts.** Eight refused taps — exactly the behaviour a
  BT would want to see trending down — left no trace anywhere.
* **The BT cannot end the partner turn.** To move the session on they must physically take the
  device and make the required number of moves. There is no clinician-side control.

---

## 3. Playthrough 2 — timed turns, vanity-station map, tablet portrait

### Configuration

| Setting | Value |
|---|---|
| Theme | 🎉 Social event |
| Routine | Staged (in order) |
| Turn map | Vanity stations |
| My turn | **Timed** (label reads "(auto 30s)") |
| Their turn | **Timed 20s** |
| Give-back | They hand it back |
| Ask cue | Short |
| Goal | 3 ⭐ |
| Earn more time | on |
| Model | **M1** |
| Viewport | **768 × 1024 (tablet portrait)** |

**Outcome: reached a real ending** — 3 ⭐ (`pt2-09-done-tabletportrait.png`).

### What happened

Selecting **Timed** leaves the *action count* dropdown visible and still set to 3 — but it is
completely inert. In the first timed turn I took **five** charged actions
(Wash → Moisturize → patch → Shape brows → Brow pencil) with no refusal at any point. The cap
logic is bypassed wholesale in timed mode.

With the *Vanity stations* map selected, **there is no countdown anywhere on screen.** The only
clock is the session timer in the dark header, which counts *up* and is unrelated to the turn.
I sampled the screen at 9 s, 6 s and 3 s remaining: no colour change, no animation, no warning.
Then the turn ended by itself and the app flipped to the partner's turn.
(`pt2-04-t1-armed-awaiting-expiry.png` — a tool is armed, the target is drawn, and there is no
timer of any kind.)

The auto-handoff was clean: the armed tool was cleared, the token and bonus were awarded, and the
partner's 20 s clock started. During the partner's clock I again played as the learner and took
four more actions with no limit at all.

The bonus visibly extends the clock: 30 s → 35 s → 40 s across the three turns.

Final stat line: **3 turns handed over · 0 independent asks · 0 prompted asks**.

### Client (player 1)

* **The vanity-station map is attractive but weaker than the banner.** Two cards, "Me" and "Them",
  with the active one ringed and the inactive one dashed and at 70 % opacity, plus a "🖌 my brush"
  chip. Whose turn it is is still legible, but the cue is quieter than the banner's colour block.
* **In a timed turn on this map the child is flying blind.** There is no indication of time
  remaining and no warning before it expires. The turn just ends mid-task — in my run, with a
  tool armed and a target still drawn on the face. For a learner being taught to tolerate
  relinquishing, an unsignalled removal is the opposite of what the routine is trying to build.
* Nothing was blocked or refused in this configuration, so there was no confusion of the
  playthrough-1 kind — but that is because there was no contingency at all.

### BT (player 2)

* **Timed mode silently voids the action goal.** The "3" is still on screen in the setup bar
  while the learner takes five actions. Nothing indicates the setting is inactive.
* **Timed mode also voids the entire refusal contingency.** `_capBlocks` returns false
  immediately when the count mode is timed, so there is no over-reach to detect, refuse or record
  in this configuration at all.
* **Choosing a turn map silently removes the turn meter.** A BT who prefers the vanity-station
  visual loses the countdown and the action pips without being told.
* Tablet portrait is comfortable: no horizontal overflow, the setup bar wraps to three tidy rows,
  the "Done — their turn" button sits at y 949–997 inside a 1024 px viewport, and every palette
  button is an 82 × 82 px touch target.
* The stat line is again 0/0.

---

## 4. Playthrough 3 — hidden count, asymmetric turns, free play *(NOT YET RUN)*

Planned configuration: Turn runway map · Free play routine · My turn **Count hidden**, goal 2 ·
Their turn **4 actions** (asymmetric) · Give-back "They hand it back" · Ask cue **Icon only** ·
Goal 3 ⭐ · Earn more time **off** · model **M3** · phone viewport 375 × 667.

**This playthrough has not been run.** Nothing is reported for it. See *Not tested*.

## 5. Playthrough 4 — "They forget → I ask" with the cue faded to none *(NOT YET RUN)*

Planned configuration: Banner map · Staged · My turn Count shown, goal 1 · Their turn 2 actions ·
Give-back **They "forget" → I ask** · Ask cue **None (probe)** · Goal 3 ⭐ · model **M4** ·
tablet landscape 1024 × 768. Intended probes: the 3.5 s cue delay, whether a very late ask is
still scored independent when the cue level is *none*, and what the learner sees while waiting.

**This playthrough has not been run.** Nothing is reported for it. See *Not tested*.

## 6. Playthrough 5 — non-default theme and model *(NOT YET RUN)*

Planned configuration: a non-default theme plus a non-default model.

**This playthrough has not been run.** One blocking fact was, however, established in-browser
during setup for playthroughs 1 and 2 and is reported as F-19: **the Theme dropdown contains
exactly one option, `social` / "🎉 Social event".** The pet-show and hero themes exist in the
build's theme table but cannot be selected from the UI, so the "non-default theme" half of this
playthrough has no reachable configuration. The model half (M1–M4) is selectable and was
exercised — see *Paper-doll fidelity*.

---

## 7. Turn-taking and prompt fading — the clinical target

The intended contingency is: **detect + flag → refuse → prompt to pass**, and score the pass
itself as independent or prompted.

### 7.1 What the build actually does

| Target behaviour | Observed behaviour | Verdict |
|---|---|---|
| An out-of-turn / over-cap attempt is **detected and flagged** as a datum | Nothing is recorded anywhere. I made 8 refused taps in playthrough 1; every counter was byte-identical before and after | **Absent** |
| The attempt is **refused** | Refused, yes — but only in count modes. In *Timed* mode there is no cap at all (playthrough 2: 5 actions on a goal of 3) | **Partial** |
| The learner is **prompted to pass** | No prompt is emitted on a refused attempt. The banner does change to "All set — now I hand it over!" when the goal is met, and the handoff button starts pulsing — but that happens on reaching the goal, not on over-reaching, and it is the same in every session forever | **Absent** |
| Passing unprompted is scored **INDEPENDENT** | Not scored. `handoff()` increments `turnsTaken` and nothing else | **Absent** |
| Passing only after a prompt is scored **PROMPTED** | Not scored | **Absent** |
| The pass prompt **fades** across sessions | The pulse on "Done — their turn ▸" is unconditional and permanent whenever the goal is met | **Absent** |

### 7.2 The fading machinery exists, but on the wrong response

`indAsks` / `promptedAsks` are the only prompt-fading measure in the build, and they score the
**ask-for-it-back** step, not the relinquish step. Two consequences I confirmed by playing:

* With give-back set to **"They hand it back"** — the setting most likely to be used early in
  teaching — the ask phase never runs, so both counters are structurally frozen at 0. Both
  completed sessions ended with *"3 turns handed over · 0 independent asks · 0 prompted asks."*
* The pass step, which is the response the pulsing button prompts, has no counterpart counters
  at all.

### 7.3 Who is touching the screen is not modelled

During the partner's turn the palette is fully live, every tool is bright, and there is no
per-actor gate. In playthrough 1 the learner patched a blemish on the partner's turn and it
applied; two further learner actions ended the partner's turn. In playthrough 2 the learner took
four actions on the partner's 20 s clock. The app cannot tell — and does not ask — whether the
device changed hands.

### 7.4 Data the BT needs and cannot get

None of the following is available anywhere in the UI, the Method panel, or any export:

* count of **refused / over-cap attempts** per turn and per session (the core "detect and flag" datum);
* count of **touches during the partner's turn**;
* **independent vs prompted relinquishes** — the prompt-fading measure for the taught response;
* **latency to pass** after the goal is met (i.e. how long the pulse ran before the child passed);
* whether a turn was passed **early with actions unspent**, versus played out;
* any per-turn breakdown at all — the stat line is three session totals and is only reachable
  through the ⓘ Method modal, which is labelled "Clinician reference — not shown to the learner"
  and is buried behind a header button.

---

## 8. Paper-doll fidelity

Checked across models **M1–M4** in Free-play routine with the cap disabled, on a fresh doll per
model. No broken images anywhere, on any model (`document.images` all decoded).

* **Hitboxes are one fixed table shared by all four models.** The measured target rectangles for
  face / brows / eyes / cheeks / lips / ears / contour / highlight / hair are *bit-identical*
  across M1, M2, M3 and M4 (e.g. `lips` is always left 38 %, top 61 %, 24 % × 10 %). By contrast
  the blemish positions *are* derived per model and vary a lot between them — M1 spots at 36–55 %
  of frame height, M3 all three at 29 %, M4 at 24–59 %. A single fixed rectangle table cannot fit
  four differently-proportioned faces. Only `brows`, `lips`, `ears` and `cheeks` have art-aligned
  overrides; `face`, `eyes`, `contour`, `hl` and `hair` still use the rectangle set that was tuned
  for the old procedural SVG.
* **Shirt colour is drawn entirely underneath the vanity ledge.** Measured directly: after
  applying a purple shirt, the shirt pixels span page-Y 729.6–800.9 and the ledge overlay spans
  706.6–813.5. All four Shirt-colour tools therefore have zero visible effect.
* **Contour and Lip liner are near-invisible.** Measured as a fraction of the canvas changed
  when applied: Contour 0.119 %, Lip liner 0.086 %. For comparison, Wash changes 5.8 %,
  Blush 1.3 %, a hair recolour 30.5 %.
* **Blemish legibility varies badly by model.** On M3 the three blemishes render as pale pink
  dots in a single tight row directly under the hairline, against a deep skin tone — they are very
  hard to see, and the three pulsing target rings sit over the brows and hairline
  (`art-m3-00-base.png`, `art-m3-01-spot-hitboxes.png`). On M4 one of the three lands in the hair
  (`art-m4-01-spot-hitboxes.png`). Registration is correct — the rings do sit on the drawn spots —
  but the drawn spots are too low-contrast to serve as a "find the spots" target on the darker
  models.
* **The seven hairstyle buttons have no name.** They render with an empty label and an empty
  `title` attribute, showing only a digit 1–7 over a shared comb icon. Neither the child nor the
  BT can tell "Buzz" from "Pixie" without tapping.
* **Target labels mismatch their mechanic.** The eyes target says "Drag across the eyes" and the
  lips target says "Drag over the lips", but Eyeliner, Mascara and Lip liner are single-tap tools.
* Re-arming an already-completed paint tool shows the label **"Keep painting… 100 %"**.
* A full look on M1 composites correctly — hair recolour, eyeshadow, blush, lips, liner, lashes
  and earrings all land on their features and layer in a sensible order
  (`art-m1-02-full-look.png`).

---

## 9. Compatibility

| Viewport | Setup bar | Horizontal overflow | Doll on screen | "Done — their turn" reachable | Palette touch target |
|---|---|---|---|---|---|
| 1280 × 900 (desktop) | 2 rows | 0 px | yes | yes (y 825–873) | 82 × 82 px |
| 768 × 1024 (tablet portrait) | 3 rows | 0 px | yes | yes (y 949–997) | 82 × 82 px |
| 1024 × 768 (tablet landscape) | 2 rows | 0 px | yes | yes (y 693–741) | 82 × 82 px |
| **375 × 667 (small phone)** | **7 rows** | **88 px** | **no** — stage scrolled to y −241 | yes, but ⓘ Method is off-screen at y −415 | 82 × 82 px |

Touch targets are comfortable for a child everywhere (82 × 82 px, well above the 44 px guideline).
The two tablet orientations — the stated in-session form factor — are sound. The small-phone
layout is not usable: the setup bar alone consumes 7 rows, the document overflows sideways by
88 px, and the doll is pushed out of the viewport.

## 10. Console and network

Every page load, in every configuration and every viewport, produces **exactly five console
errors** and nothing else:

```
Error: <path> attribute d: Expected moveto path command ('M' or 'm'), "{{ V.capePath }}".
Error: <path> attribute d: Expected moveto path command ('M' or 'm'), "{{ V.garmentPath…".
Error: <path> attribute d: Expected moveto path command ('M' or 'm'), "{{ V.garmentTrim…".
Error: <path> attribute d: Expected moveto path command ('M' or 'm'), "{{ V.contourPath…".
Error: <path> attribute d: Expected moveto path command ('M' or 'm'), "{{ V.garmentPath…".
```

These are the browser parsing the raw `{{ }}` placeholders in the inline SVG before the
design-canvas runtime substitutes them. **Zero page exceptions** (`pageerror`), **zero failed
requests**, and **zero HTTP ≥ 400** were recorded across every run in this evaluation. No crash,
freeze or blank screen was seen at any point.

---

## 11. Consolidated findings

Severity: **blocking** = the configuration cannot achieve its purpose · **major** = a reasonable
session is damaged · **minor** = friction · **polish** = cosmetic.

| # | Sev | Category | Where | Reproduction | Hurts |
|---|---|---|---|---|---|
| F-1 | blocking | clinical | `index.html:578` `handoff()` | Play any config to the goal. Open ⓘ Method. Stat line reads "N turns handed over · 0 independent asks · 0 prompted asks". Passing early with 0 actions (PT1 turn 2) yields the same token, bonus and turn count as a full turn | BT — the taught response is unmeasured; client — independent passing is never differentially reinforced |
| F-2 | blocking | clinical | `index.html:512` `arm()`, `:546,:554,:559,:563` | Count-shown, goal 3. Spend 3 actions. Tap a still-pulsing blemish target 6 more times, then a dimmed tool, then re-tap the stage. No message, no counter change, no prompt | Both — client gets an unexplained wall; BT gets no over-reach datum |
| F-3 | blocking | clinical | give-back = "They hand it back" (`index.html:583`) | Set Give-back to "They hand it back", play to the goal. `indAsks`/`promptedAsks` stay 0 because phase `ask` never runs; the Ask-cue setting has no effect anywhere in the session | BT — no prompt-fading data at all in this mode |
| F-4 | major | clinical | `index.html:1111` `handoffStyle` | Reach the action goal in any count mode. "Done — their turn ▸" starts `animation: gtm-cue` and pulses indefinitely, every turn, every session, with no fade setting and no record | Client — prompt dependence; BT — an unfaded, unrecorded prompt on the target response |
| F-5 | major | clinical | `index.html:522` `_turnCap()` | Hand over. During the partner's turn arm any tool and use it — it applies and counts against the partner's actions. Three such learner actions ended the partner's turn (PT1) | Both — the "wait" step is not protected; BT cannot separate the two players' responses |
| F-6 | major | bad state | phase `theirs`, controls block `index.html:251-254` | Partner turn with a *counted* goal. Touch nothing. After 8 s the phase is unchanged and the only controls on screen are palette tools and ⓘ Method. The turn can only be ended by performing exactly `partnerGoal` newly-charged actions | Both — no legal "we're done" action; BT must take the device and make moves |
| F-7 | major | UX | "ACTIONS LEFT" meter, `index.html:968` | Count-shown, goal 3. At 0 actions the 3 pips are empty; at 3 actions all 3 are filled. The label says "Actions left" | Both — client mis-reads the count; BT mis-reads it over the child's shoulder |
| F-8 | major | UX | turn map, `index.html:101-120` | Set Turn map to "Vanity stations" or "Turn runway". No countdown and no action pips render in any phase — they exist only in the Banner map. In PT2 (Timed + Vanity) the turn ended with no warning | Client — no time/turn feedback; BT — silently loses the meter by picking a visual |
| F-9 | major | workflow | `index.html:526` `_capBlocks()` | Set My turn = Timed. The action-count dropdown stays visible and set to 3, but 5 charged actions were taken in one turn with no refusal | BT — a configured limit that silently does nothing; the whole refusal contingency is void in this mode |
| F-10 | major | art | shirt layer vs. vanity ledge (`index.html:1101` `footerBarStyle`) | Free play, apply any "Shirt color". An action is charged and the button gets a ✓, but the changed pixels span page-Y 729.6–800.9, entirely inside the ledge overlay at 706.6–813.5 — nothing visible changes | Client — a spent action with no result on the doll |
| F-11 | major | art | shared hitbox table, `index.html:409-421` + `:438-443` | Arm the same tool on M1, M2, M3 and M4 and measure the target rectangle: identical on all four (`lips` = l38 t61 w24 h10 every time), while the per-model blemish positions differ by up to 35 % of frame height | Client — the "do it here" box does not track the face it is drawn on |
| F-12 | major | compat | 375 × 667 | Load at 375 × 667. `scrollWidth − clientWidth` = 88 px; setup bar wraps to 7 rows; after starting a turn the doll's canvas sits at y −241 (off-screen) | Both — unusable on a phone |
| F-13 | major | workflow | palette filter, `index.html:996` | Staged routine, turn 1. Only Wash / Shape brows / Brow pencil exist on the palette. Moisturize appears only after Wash completes. Locked steps are removed, not shown locked — the `🔒` label branch at `:1021-1027` can never render because locked options are filtered out first | Client — cannot see the routine ahead; BT — cannot show the child what is coming |
| F-14 | major | workflow | "Earn more time" checkbox, `index.html:73` + `:481,:578` | Count-shown, goal 3, checkbox on. Turn 1 cap = 3, turn 2 = 4, turn 3 = 5. In a count mode the bonus grants extra **actions**, not time, contradicting the label | BT — the configured turn size drifts upward every turn |
| F-15 | minor | art | Contour, Lip liner | Apply each and diff the canvas: Contour changes 0.119 % of pixels, Lip liner 0.086 % (vs. Wash 5.8 %, hair recolour 30.5 %) | Client — a spent action with almost no visible result |
| F-16 | minor | art | blemish contrast on M3 / M4 | Select M3, arm "Treat spots": three pale-pink dots in one row under the hairline on a deep skin tone, with the target rings over the brows/hairline. On M4 one of three lands in the hair | Client — cannot see what they are being asked to find |
| F-17 | minor | UX | hairstyle buttons, `index.html:1027` | Free play → Hair style group. All seven buttons render an empty label and an empty `title`; only a digit 1–7 over a shared comb icon identifies them | Both — neither player can name the styles |
| F-18 | minor | UX | zone labels, `index.html:413,:440` | Arm Eyeliner (a tap tool): the target says "Drag across the eyes". Arm Lip liner (a tap tool): "Drag over the lips" | Client — instructed to drag when a tap is required |
| F-19 | minor | workflow | Theme select, `index.html:56` | Open the setup bar. The Theme dropdown has exactly one `<option>`: `social`. The pet-show and hero themes in the build's theme table are unreachable from the UI | BT — a documented configuration axis that cannot be used |
| F-20 | minor | crash-adjacent | inline SVG placeholders, `index.html:149-151,163` | Load the page with the console open. Five `<path> attribute d` errors on every load, in every configuration, from unsubstituted `{{ V.*Path }}` values. No page exception, no failed request | BT — a permanently noisy console hides any real error |
| F-21 | polish | UX | paint target label, `index.html:1056` | Complete a paint step, then re-arm the same tool. The target reads "Keep painting… 100 %" | Client — mildly confusing |

---

## 12. Not tested

Stated as gaps rather than guessed at.

**Playthroughs not yet run**

* **Playthrough 3** — hidden count, asymmetric turns (my 2 / their 4), free-play routine, runway
  map, icon cue, model M3, phone viewport. Not run.
* **Playthrough 4** — the `They "forget" → I ask` give-back path with the ask cue faded to
  **None (probe)**. **This is the single biggest gap in this report**: it is the only
  configuration in which `indAsks` / `promptedAsks` can move at all, and the only way to observe
  the 3.5 s cue delay, the four cue levels, and whether a very late ask is still scored as
  independent when the cue level is `none`. Not run.
* **Playthrough 5** — non-default theme and model. Not run. The theme half is blocked by F-19.

**Behaviours not exercised**

* The `giveback`/`ask` phases beyond the "They hand it back" branch — never entered.
* The **Turn runway** map — never rendered in a live session.
* **Count hidden** mode, and whether the cap is silently enforced there (`capDim` is applied only
  in `shown` mode).
* The **⭐ Finish & SR** button on the done screen, and `window.NooutcoReward.celebrate` /
  `openSR` — not clicked.
* **↺ Play again** and whether it correctly resets counters mid-device-session.
* Whether opening the setup bar mid-session (the header ▾/▸ toggle) exposes the **▶ Play** button,
  and whether pressing it silently destroys the running session's tokens/turn/ask counters. The
  button is in the DOM during play but hidden; I did not reveal and press it.
* Changing any setting **mid-session** (e.g. raising the token goal on turn 2) and whether it
  applies live or corrupts state.
* Token goals **5 ⭐ and 8 ⭐** — both completed runs used 3 ⭐.
* **Their turn = 2 / 3 / 4 actions** (asymmetric) and **Timed 30s**.
* The pet-show and hero themes and their procedural-SVG render path — unreachable from the UI.
* Real **touch** input, multi-touch, and pointer-cancel on the drag/paint tools. All input in this
  evaluation was synthetic mouse input from Chromium.
* **Firefox and WebKit.** Only Chromium was used. The repo's Playwright config defines Firefox and
  WebKit projects; they were not run.
* **Screen readers, keyboard-only navigation and reduced-motion.** Not assessed. Note in passing
  that the pulsing cue animations have no reduced-motion guard, but this was not verified against
  a `prefers-reduced-motion` media setting.
* **Offline / deployed behaviour.** Everything was run against a local `wrangler pages dev` server.
* **Long sessions.** The longest run was three turns; no soak test for timer drift, memory growth
  or canvas cache growth.

---

## Method

Served with `npx wrangler pages dev . --port 8788` from `apps/games` after `npm install`.
Driven with Playwright Chromium from throwaway scripts under
`.gnhf/runs/objective-produce-an-e923a7/scratch/` (git-excluded, not committed). Console messages,
page exceptions, failed requests and HTTP ≥ 400 responses were captured for every run. Internal
counters quoted in this report (`actionsThisTurn`, `chargedThisTurn`, `turnsTaken`, `indAsks`,
`promptedAsks`, `bonus`) were read out of the mounted component's React state **read-only**, to
corroborate what was visible on screen; every finding also states its on-screen symptom.

**No file under `apps/games/glam-team-makeover/` was modified.** No existing spec file was
modified. Verified with `git status` before and after the run.
