# Glam Team Makeover — Tier 1 build report

**Branch:** `feat/glam-turn-taking-redesign` · **File under change:** `apps/games/glam-team-makeover/index.html`
**Specs added:** `apps/games/tests/glam-tt-scoring.spec.js`, `apps/games/tests/glam-tt-story.spec.js`, `apps/games/tests/glam-tt-game.spec.js`, `apps/games/tests/glam-art-fidelity.spec.js`
**Spec updated:** `apps/games/tests/glam-team-makeover.spec.js`
**Authority:** `docs/glam-team-makeover-redesign-hardened-claims.md` (AC-1…AC-27) — wins over spec prose.
**Date:** 2026-07-25 (pass 3)

> **Status: Tier 1 landed, played, and swept.** Pass 1 built the measurement spine (`window.GlamTT`)
> and the story pool (`window.GlamStory`) and verified them in isolation; the game's screens
> still ran the pre-redesign turn loop. **Pass 2 wired the screens to the engine** and added
> `tests/glam-tt-game.spec.js`, which drives the criteria through real buttons on the real
> game rather than through the engine's API. **Pass 3 closed the visual-fidelity sweep (§3.9)** —
> the item pass 2 listed as the main outstanding one — and added
> `tests/glam-art-fidelity.spec.js`, which settles it by measuring pixels rather than by
> eyeballing screenshots. Every row in §2 below names a test that reproduces it; nothing is
> inferred from reading code. What is still outstanding is listed, unhedged, in §5.

**Test status:** `npx playwright test` → **252 passed** (chromium · firefox · webkit), 0 failed.

---

## 1. What landed

### 1.1 The turn-taking measurement engine (`window.GlamTT`)

The clinical spine, added to `index.html` as a pure, DOM-free, **clock-injected** module. It decides
whether the learner's relinquish (the pass) and their mand for the turn back (the ask-back) were
independent or prompted, and it is the append-only event log the per-turn table renders from.

It is deliberately separable from React and from the DOM. That is what makes all 27 criteria
testable at exact wait-window boundaries instead of racing real timers — the hardened claims turn on
distinctions like "pass at t=2s vs t=5s with a 3s window", which cannot be asserted reliably against
a live 1s interval.

Implemented rules, each traceable to the attack it closes:

| Rule | Claim | Closes |
|---|---|---|
| Possession floor: `independent` needs ≥1 engaged action; a 0-action pass is `no-engagement` | D-A / AC-20 | C2 |
| Budget is a **cap, not a quota** — pass available throughout the turn, early pass scored | D-A / AC-19 | B3 |
| Wait-window anchored to **possession-taken + no-relinquish idle**, not budget-exhaustion | D-A / AC-1 | D1 |
| Independence gated on **any** prompt — app faded cue **or** BT real prompt | D-A / AC-2, AC-21 | D1 |
| Forfeit flag is **turn-durable** for BT-real and at-exhaustion prompts; a resume cannot launder it | D-A / AC-23 | E1 |
| Only a **sub-budget app cue** is discardable, and only by a genuine resume | D-A / L8 | E1 |
| At `silent` the prompt is delivered **by window-elapse** — never a free `independent` | AC-1, AC-24 | F-22 |
| Over-cap: refuse + log + turn-durable forfeit + deliver prompt + **kid feedback in every mode** | D-B / AC-3, AC-4 | B2 |
| One **fixed auto-scaled** per-turn cap; nothing inflates it mid-trial | D-B / AC-17 | A5 |
| Ask-back window anchored to the **staff-idle forget onset** — fires at 0…N staff actions | D-K / AC-27 | **G1** |
| Ask before the onset is a recordable `early-ask`; any delivered prompt forfeits unconditionally | D-K / AC-25, AC-26 | F-33, F1 |
| Completion = look finished **or** N turns (hard bound); always terminable | D-D / AC-5, AC-16 | A4 |
| Tier keyed to **pass** independence + over-cap only; `staff-prompted` and `no-engagement` are non-independent | D-G / AC-11 | A2 |
| (E) marks log `{timestamp, phase, whose-turn}`, change nothing, are undoable via a voiding event | D-C / AC-14 | — |

**Auto-scaled action budget (D-D / AC-7).** Computed once, before the trial, from the BT's turn count
and the 19 charged actions a cooperative run needs to finish the look. Turn order is fixed L,S,L,S…,
so every trial has ≥1 learner turn and AC-11's Tier-1 predicate is never vacuously true:

```
turns=2 : learner 1×19 · staff 1×10 · learner share 65.5%
turns=4 : learner 2×10 · staff 2× 5 · learner share 66.7%
turns=6 : learner 3× 7 · staff 3× 4 · learner share 63.6%
turns=8 : learner 4× 5 · staff 4× 3 · learner share 62.5%
turns=10: learner 5× 4 · staff 5× 2 · learner share 66.7%
```

All land inside the §4-approved 2:1 learner-favoured split, and `learnerTurns × learnerBudget ≥ 19`
in every case, so a cooperative run can finish the look inside N turns.

### 1.2 Story pool (`window.GlamStory`) — the two-axis outro, drafted for review

The six approved §5 events, unchanged. The outro is restructured from §5's single **fused** string
per (event, tier) into the two independently gated axes the hardening requires (§3.7 / D-G / L7).
Full strings for maintainer sign-off are in **§4** below.

The congruence rule (§3.7.1) is enforced mechanically rather than by eyeball: `congruenceViolations()`
sweeps **1008** producible strings (6 events × 12 names × 14 string slots) against a banned-pattern
list, and the spec asserts the result is empty *and* that the guard catches a planted violation.

### 1.3 Clean console — all 8 load-time errors fixed

The eval's §3.9 item was "clean the 5 SVG console errors"; there were in fact **8** errors on every
load (5 SVG parse + 3 HTTP 404). All are gone. Root cause of every one of them was the same: raw
`{{ … }}` template placeholders sitting in attributes the **browser** parses and acts on before the
dc-runtime substitutes them.

| Removed | Why it was dead | Errors killed |
|---|---|---|
| Person procedural-SVG fallback | Never rendered since the `<canvas>` compositor (`paintAvatar`) shipped | 4 × `<path> attribute d: Expected moveto…` |
| Whole `isPet` stage block | Pet/hero are unreachable (§8) and the manifest ships no `pet` base | 1 × SVG parse, 2 × 404 (`{{ petArtBase }}`, `{{ ly.src }}`) |
| `<img src="{{ sceneFrame }}">` | `scene.social.frame` is `''`, so the `sc-if` was never true | 1 × 404 (`{{ sceneFrame }}`) |

Verified: stage canvas paints 197 383 opaque pixels, **0 console errors**, all four models render
distinctly. A standing note is now in the template that no `<img src="{{ … }}">` may be reintroduced.

### 1.4 Existing spec updated — deliberately, and it was already red

**`tests/glam-team-makeover.spec.js` was failing 3 of 4 tests at the branch's base commit**, before
this work touched anything (confirmed by stashing the change and re-running). This is a correction to
the run's premise, not a regression:

- *`all four models load their base art…`* and *`applying a step composites a delivered layer…`*
  asserted a **layered-`<img>`** art pipeline that the build had already replaced with the single
  `<canvas>` compositor. There are no `img[src*="assets/art/person/…"]` elements in the DOM any more,
  so those locators could never resolve.
- *`applying a step…`* also armed the **Brunette** hair tool, which the staged self-care task
  analysis (a locked spec decision) hides until skincare and makeup are done.
- *`intro screen mounts`* tripped on the 8 pre-existing console errors above.

Both art tests were rewritten to keep their original intent against the current architecture — read
pixels, not element `src`s:

- per-model art: assert each `base.png` is served (HTTP 200) **and** that selecting each model paints
  a **distinct** stage fingerprint. A model whose art failed to decode leaves `paintAvatar` bailing
  early and the canvas unchanged, so four distinct fingerprints prove all four decoded.
- applying a step: use **Shape brows** (a one-tap step the opening skincare phase actually offers)
  and assert the canvas fingerprint changes and stays non-blank.

No test was deleted, and the rationale is recorded in the spec file itself.

---

## 2. Acceptance criteria — evidence

`✔` = reproduced by a named passing test. Where a criterion has both an engine rule and a
screen that must honour it, **both** tests are named: `glam-tt-scoring.spec.js` proves the rule,
`glam-tt-game.spec.js` proves a BT who opens the game and taps the buttons actually gets it.

| AC | Status | Engine evidence (`glam-tt-scoring.spec.js`) | Played evidence (`glam-tt-game.spec.js`) |
|---|---|---|---|
| AC-1 pass after window → `prompted` at every level incl. silent | ✔ | `AC-1 · a pass after the window elapsed…` | `AC-1 (D1) · a silent-probe stall…` |
| AC-2 `independent` iff pre-prompt, no forfeit | ✔ | `AC-2 · a pass inside the window…` | `AC-19 (B3) · an early pass…` |
| AC-3 over-cap: refuse + feedback + log + prompt, every count mode | ✔ | `AC-3 · an over-cap tap is refused…` | `AC-3 (B2) · …GENTLE kid feedback even in count-HIDDEN mode` |
| AC-4a over-cap forfeits only that turn | ✔ | `AC-4a (A3) · over-cap forfeits only THAT turn…` | — |
| AC-4b silent-probe over-cap → `prompted@silent` | ✔ | `AC-4b (B2) · at silent-probe an over-cap grabber…` | — |
| AC-5 completion claim gated; trial always terminable | ✔ | `AC-16 (A4)…`, `a trial is always terminable…` | `AC-5 · a finished look ends the trial…`, `AC-5/AC-16 (A4/C1)…` |
| AC-6 re-applying a done step does not advance completion | ✔ | `AC-6 · re-applying a done step…` | — |
| AC-7 turns=N auto-scale, ~2/3 learner share | ✔ | `AC-7 · turns=N auto-scales…` | `AC-7/AC-17 (A5) · the BT sets TURNS…` |
| AC-8 no timer bounds the learner's turn | ✔ | `AC-8 · no timer bounds the learner's own turn` | `AC-8/AC-12/AC-13 · no timer on the learner turn…` |
| AC-9 ten-column table + de-identified footer, no name/freeform | ✔ | `AC-9 · the report is a per-turn table…` | `AC-9 (D-H) · the print view renders the ten-column…` |
| AC-10 no checkable visual claim in any mad-lib string | ✔ | `AC-10 · no producible string…` (story spec, 1008 strings) | `AC-10 · the on-screen intro is the mad-lib…` |
| AC-11 tier = f(over-cap, pass independence) only | ✔ | `AC-11 (A2)…`, `…(E) marks never move it`, `…tier boundaries` | `AC-20 (C2) · a 0-action pass…` (tier 3) |
| AC-12 whose-turn visible in every turn-map style | ✔ | — | `AC-8/AC-12/AC-13 · …whose-turn stated in every map style` |
| AC-13 theme dropdown absent, pet/hero unreachable | ✔ | — | `AC-8/AC-12/AC-13 · …no theme selector` |
| AC-14 (E) logs, changes nothing, undoable | ✔ | `AC-14 · an (E) mark logs…` | `AC-14 · an (E) mark logs {timestamp, phase, whose-turn}…` |
| AC-15 ask-back reachable on a counted partner turn | ✔ | `AC-15 · the ask-back is reachable…` | `AC-27 (G1 MUST-TEST)…` |
| AC-16 all-repetition trial terminates, prints incomplete, no deadlock | ✔ | `AC-16 (A4) · an all-repetition trial…` | `AC-5/AC-16 (A4/C1)…` |
| AC-17 cap equals auto-scaled budget, never rises | ✔ | `AC-17 (A5) · the enforced cap…` | `AC-7/AC-17 (A5) · …one fixed cap, no second lever` |
| AC-18 Tier-1 line on an incomplete look, no completion claim | ✔ | `AC-18 (C1)…`, `AC-18 · School picture day…` | `AC-5/AC-16 (A4/C1) · …still scores its turn-taking` |
| AC-19 early sub-budget pass → `independent`, actions-used recorded | ✔ | `AC-19 (B3) · an early voluntary pass…` | `AC-19 (B3) · an early pass with the budget unspent…` |
| AC-20 0-action run → all `no-engagement`, Tier 3 | ✔ | `AC-20 (C2) · a 0-action pass…` | `AC-20 (C2) · a 0-action pass scores no-engagement…` |
| AC-21 sub-budget prompted pass → non-independent | ✔ | `AC-21 (D1) · a sub-budget stall…` | `AC-21/AC-23 · a real BT prompt from the staff strip…` |
| AC-22 sub-budget never-pass → `staff-prompted`, no deadlock | ✔ | `AC-22 (D1 corollary)…` | — |
| AC-23 BT/at-exhaustion prompt turn-durable; resume cannot launder | ✔ | `AC-23 (E1) · a BT prompt is TURN-DURABLE…` | `AC-23 (E1) · the over-cap forfeit is TURN-DURABLE…` |
| AC-24 37s silent ask → `prompted@silent` | ✔ | `AC-24 (F1) · a 37s silent ask…` | `AC-24 (F1/F-22) · a silent ask-back after the window…` |
| AC-25 ask before onset → recordable `early-ask` | ✔ | `AC-25 (F-33)…` | `AC-25 (F-33) · asking while the partner is still actively taking their turn…` |
| AC-26 ask-back forfeit durable; ask-back not tiered | ✔ | `AC-26 · a BT real prompt on the ask-back…` | `AC-24 (F1/F-22)…` (asserts the ask lands in `totals.asks`, not the tier) |
| **AC-27 (G1 must-test)** | **✔** | see §3 | see §3 |

Two further criteria are asserted only where they can be: **console cleanliness** by
`the whole played trial leaves a clean console` (a full played trial: go → over-cap-free turn →
pass → forget onset → ask → second turn → end) and by `intro screen mounts (runtime boots)` in
the pre-existing spec; and **no-PHI** by the played AC-9 test, which asserts the game contains
**zero** text inputs, textareas or `contenteditable` regions and that the print sheet collects
nothing.

### What pass 2 wired

| Wired | Where |
|---|---|
| `GlamTT.Trial` opened at Play; a 250 ms `tick()` drives every prompt | `play()`, `componentDidMount`, `tickTrial()` |
| Every charged tap admitted or refused by the engine — free re-touches never reach it | `_admit()` / `_atCapFor()`; the apply paths (`applyChoose`, `tapApply`, `patchOne`, `concealOne`, `paintStep`) |
| Screens derived from the engine, never from a parallel tally | `syncTT()` — it picks the screen for the engine's current turn and mirrors the counters |
| Pass / ask / hand-back / BT-prompt / (E) / end-trial | `handoff()`, `confirmAsk()`, `giveBack()`, `btPrompt()`, `eMark()`/`eUndo()`, `endTrial()` |
| Look completion from the existing task analysis | `_lookDone()` → `setLookComplete()` in `afterAction()` |
| Over-cap kid feedback | `toast()` → the sage `capToast` pill in the controls bar |
| Mad-lib intro + two-axis outro on screen | `drawChar()`, `storyIntro()`, `storyOutro()` |
| Print-to-PDF sheet: story, then the ten-column table, then totals | `printReport()` via `NooutcoResults.open({html})` |

The `250 ms` cadence is deliberate and load-bearing: at the old 1 s clock the wait window
rounds by up to a second, which is enough to flip a boundary pass between `independent` and
`prompted@…`. `syncTT` commits only on a real change, so the faster tick does not repaint the
avatar canvas four times a second.

### The three motivating defects

| Defect (spec §2) | Status |
|---|---|
| 1. Scoring can't be trusted (37s silent ask scored `independent`) | **closed, and closed as played** — the pass site (`AC-1 (D1)`) and the ask-back site (`AC-24 (F1/F-22)`) both score `prompted@silent` through the UI. The screens no longer decide anything: `cueVisible` is presentation only. |
| 2. Violations are invisible (0/43 tools gave feedback at the cap) | **closed as played** — `AC-3 (B2)` taps a 5th tool in **count-hidden** mode and asserts the child is told, that the message is not a red error, and that no clinical word (`prompted`/`independent`/`forfeit`/`over-cap`/`violation`) appears anywhere on the child's screen. |
| 3. You can "win" with a blank doll (win counts handoffs) | **closed as played** — the ⭐ goal is gone; the chip reads `Turn n of N` and completion is `_lookDone()`. `AC-5` ends a trial with `endReason: 'look-complete'`; `AC-5/AC-16` ends one on the turn bound with `complete: false`, prints the marked-incomplete note and still awards the Tier-1 turn-taking line. |

---

## 3. The G1 must-test — result: **PASS**

This is the one hardened fix the adversarial review never re-probed (it landed on the round cap), and
the maintainer's sign-off routed its verification here rather than to a fresh adversarial pass.

**Configuration:** give-back = "They forget → I ask", Their turn = **3 actions, counted**, cue = full,
staff does **0 of 3** allotted actions — the scenario the mode is named for.

**Test:** `AC-27 (G1 MUST-TEST) · counted staff turn + give-back=forgets + 0 staff actions → the ask window OPENS and a correct ask scores the mand`

**Reproduced:**

| Assertion | Observed |
|---|---|
| staff actions spent | `0` (allotted budget `> 0` and unspent) |
| onset before the idle interval elapses (t=2s, window 3s) | **not fired** — and an ask there scores `early-ask` |
| onset after the idle interval (t=3.5s) | **fired** — the ask window OPENS, no F-23/F-6 deadlock |
| onset source | `staff-idle` — **not** "allotted staff actions spent" |
| onset `staffActions` | `0` — fired on a genuine 0-of-N forget |
| a correct ask after the onset | **`independent`** — the mand is scored, **not** mis-filed as `early-ask` |

### Pass 2 — the same must-test, **played through the UI**

`glam-tt-game.spec.js` → *AC-27 (G1 MUST-TEST) · counted partner turn + give-back=forgets +
0 partner actions → the ask window OPENS and a correct ask scores the mand*

The spec sets **Their turn = Action-counted**, **Give-back = They "forget" → I ask**, takes a
learner turn, hands over, and then **nobody touches the partner's turn at all**. Reproduced on
chromium, firefox and webkit:

| Assertion | Observed |
|---|---|
| the partner turn is counted and unspent | `{actor:'staff', budget:2, spent:0}` |
| the ask window opens with no one having acted | `onsetAt != null` within the polled window |
| the onset's own log record | `{source:'staff-idle', staffActions:0}` |
| a correct ask after the onset | **`independent`** — the mand, not `early-ask` |
| play continues | the `Go — my turn!` button is back; **no deadlock** |

The complementary `AC-25 (F-33)` test asks *before* the onset with an 8 s window and gets
`early-ask`, so the two outcomes are distinguished by the onset and not by luck. The mand
affordance is now live for the **whole** partner turn — the pre-redesign build put it behind a
separate `ask` screen that only opened once the partner had spent their allotted actions, which
is the G1 deadlock in one line of code.

Both wrong outcomes G1 predicted are absent: the window is not unreachable, and the clinically
correct mand under the contrived MO is not recorded as the error code. The `AC-15` test additionally
confirms the onset fires on a counted turn at **every** cue level, and a separate test confirms a
**timed** partner turn still honours its prescribed length (waiting *by length* is the taught skill
there) rather than being short-circuited by the 3s idle heuristic.

---

## 4. Drafted two-axis outro strings — **for maintainer review (L7)**

Six approved events **unchanged**; only the outro's text *structure* changes. Each event now carries
a **tier-keyed turn-taking line** (teamwork only, asserts no event success and no completion, at any
tier) and a **completion beat** (the event-success flavour, emitted *only* when the staged look is
finished). `{name}` draws from 12 neutral fictional-client names; the outro opens with a cheer word
(§5's "one flavour word" slot).

Tier 3 lines are worded to be true even of a fully disengaged run — they credit the *shared activity*
rather than claiming persistence the learner may not have shown.

### 1 · School picture day 📸
- **Intro:** "Picture day is today! {name} is not ready yet — there is a whole glam routine to do and no outfit picked. The photographer is almost here! Good thing the glam team takes turns."
- **Tier 1:** "Every turn, {name} took a turn and then handed the brush back. Getting ready for picture day as a real team."
- **Tier 2:** "{name} and the glam partner traded the brush back and forth the whole time they were getting ready."
- **Tier 3:** "It takes a lot of turns to get ready for picture day — and {name} had a partner for every one of them."
- **Completion beat:** "And the whole routine got finished before the photographer arrived — picture day was a hit!"

### 2 · Birthday party 🎉
- **Intro:** "The party starts in a few minutes! {name} is not party-ready yet — there is lots to do and no outfit yet. The guests are already arriving! Good thing the glam team takes turns."
- **Tier 1:** "Turn after turn, {name} took a turn and passed it right back. Nobody gets party-ready like a team that shares."
- **Tier 2:** "{name} shared the brush with the glam partner all the way through getting ready for the party."
- **Tier 3:** "Getting party-ready takes a lot of turns, and {name} had a partner the whole time."
- **Completion beat:** "And the whole look was ready the moment the guests walked in — what a party!"

### 3 · Talent show 🎤
- **Intro:** "Talent show — {name} is on next! {name} still needs the full glam routine before going on. On stage next! Good thing the glam team takes turns."
- **Tier 1:** "Every turn, {name} took a turn and then gave it back. Backstage teamwork at its very best."
- **Tier 2:** "{name} and the glam partner took turns backstage, right up to showtime."
- **Tier 3:** "Getting ready backstage takes a lot of turns, and {name} had a glam partner for all of them."
- **Completion beat:** "And the whole glam routine was done before the curtain went up — {name} dazzled the crowd!"

### 4 · Family photo 🖼️
- **Intro:** "Family photo time! {name} is not camera-ready yet — the whole routine still has to be done. Grandma is waiting! Good thing the glam team takes turns."
- **Tier 1:** "Turn for turn, {name} took a turn and handed it back every single time. That is what a team looks like."
- **Tier 2:** "{name} and the glam partner passed the brush back and forth while everyone got ready."
- **Tier 3:** "Getting everyone camera-ready takes a lot of turns, and {name} had a partner right there."
- **Completion beat:** "And the whole look came together before grandma finished waiting — the framed favorite!"

### 5 · First day, new school 🎒
- **Intro:** "First day at a new school! {name} wants to feel ready — there is a full routine to do and no outfit yet. The bus comes in a few minutes! Good thing the glam team takes turns."
- **Tier 1:** "Every turn, {name} took a turn and passed it back. Getting ready for a big day, together."
- **Tier 2:** "{name} took turns with the glam partner all through getting ready for the first day."
- **Tier 3:** "Getting ready for a first day takes a lot of turns, and {name} had a partner for every one."
- **Completion beat:** "And the whole routine was finished before the bus came — {name} walked in beaming!"

### 6 · Dance recital 🩰
- **Intro:** "Dance recital tonight! {name} is not show-ready yet — there is a glam routine to do. Curtain in minutes! Good thing the glam team takes turns."
- **Tier 1:** "Turn after turn, {name} took a turn and gave it right back. A recital-day team through and through."
- **Tier 2:** "{name} and the glam partner traded turns the whole time they got ready for the recital."
- **Tier 3:** "Getting show-ready takes a lot of turns, and {name} had a glam partner through all of them."
- **Completion beat:** "And the whole glam routine was ready before the curtain — {name} shone on stage!"

**L7 escalation status: none needed.** Every event expressed a Tier-1 turn-taking line without an
event-success claim, so no event had to be escalated to the maintainer under L7's fallback. The
mechanical check (`tierLinesClaimingCompletion()`, asserted empty) is what backs that statement.

**Names:** Ada · Bea · Cleo · Dani · Elle · Frankie · Gigi · Harper · Iris · Jules · Kit · Lux
**Cheers:** Wow · Look at that · Yes · Amazing · Hooray

> *Changed in pass 2:* the cheer list used to include "What a team", and the outro title is
> `<cheer> — what a team!`, so one draw in five rendered as **"What a team — what a team!"** on
> screen. Caught by playing it, not by reading it. `Hooray` replaces it.

**Two review questions for the maintainer:**
1. The turn-taking lines name the behaviour plainly ("took a turn and then handed the brush back").
   That is intentional — §3.7 says the outro *names the turn-taking* — but it is the line most likely
   to want a register change for a specific learner. Please confirm the tone.
2. Tier 3's "had a partner for every one of them" is the deliberate encouraging floor. It credits the
   activity, not the learner's performance, so it stays true for a 0-action run. Confirm that is the
   intended floor rather than something warmer.

---

## 4b. The visual-fidelity sweep (§3.9) — pass 3, measured

Spec §3.9 is the one Tier-1 item that cannot be settled by reading code: it is a claim about
pixels. So it was settled by measuring them. `tests/glam-art-fidelity.spec.js` (5 tests × 3
browsers) diffs the real compositor's output on the real page; every number below is that
harness's, before and after.

| §3.9 item | Before (measured) | After (measured) | Test |
|---|---|---|---|
| **Sprite layers exactly aligned** | **32 of 56** model×tool combinations painted *outside* their own target box | **0 of 56** | `F-11 · every tool paints inside its own target box…` |
| **"Shirt color" behind the vanity ledge** (F-10) | m1/m3/m4: **0 %** of the shirt on screen — the ledge's opaque body began at page-Y 689, the shirt paints at 728–752 | 25 %/38 %/46 % of shirt pixels above the ledge line (m2 32 %), on desktop, tablet and phone alike; the ledge still covers the canvas's bottom cut | `F-10 · a shirt colour is visible above the vanity ledge…` |
| **Blemish contrast** (F-16) | **1.06–1.67 : 1** on all twelve spots | **3.18–6.82 : 1** on all twelve | `F-16 · every blemish clears 3:1 contrast…` |
| **Misplacement across steps & models** | **10 of 28** model×hairstyle combinations could seed a blemish *under the hair* | **0 of 28** | `F-16b · no seeded blemish lands under the hair…` |
| **Near-invisible tools** | Contour 0.12–0.25 % of canvas, Lip liner 0.055–0.086 % | Contour 0.43–0.65 %, Lip liner 0.115–0.173 % | measured by the same harness |
| **Target labels mismatch mechanic** | eyes/lips zones said "Drag across…" for the single-tap Eyeliner, Mascara and Lip liner | verb comes from the tool's mechanic | `target labels name the tool's mechanic…` |
| **"Keep painting… 100 %"** on a finished step | told the child to keep going | `All done ✓` | same test |
| Actions-left meter · hairstyle button names · phone overflow · 8 console errors | — | done in passes 1–2 | see §1.3, §5 |

**How the alignment fix works, and why it cannot rot.** `ZONES` was a single fixed percentage
table shared by all four models, tuned for the procedural SVG the canvas compositor replaced.
The hitboxes are now *derived per model from the same data `paintAvatar` paints from* — the eye
landmarks in the art manifest, the packed feature masks (R = hair, G = lips, B = eyes + brows)
and the `EYECFG`/`BROWCFG`/`EARCFG` anchor tables, which were hoisted out of `paintAvatar` so
painter and hitbox read one source. A box therefore cannot drift from its effect: if the art
moves, both move. The spec asserts containment for all 56 combinations, so a future art
regeneration that shifts a feature fails the build rather than silently mis-registering the
"do it here" box.

**Three things the measurements corrected in the eval's own account:**

1. The eval reported blemish contrast as a **m3/m4** problem. Measured, **all twelve spots on
   all four models** came in between 1.06 and 1.67 : 1 — and the single worst reading in the
   set, 1.06 : 1, was on **m1**, one of the two models the eval did not flag. The fix picks the
   ink against the local skin luminance sampled from the base render, because no single hue
   clears 3 : 1 across a skin range of L ≈ 0.15–0.33.
2. The eval reported "on M4 one of three [blemishes] lands in the hair" as a one-off. It is
   **systematic**: the pool is seeded per *model*, the hair mask is per *hairstyle*, and 10 of
   the 28 model×style combinations had at least one pool point under hair.
3. The eval's F-11 framing was "a single fixed rectangle table cannot fit four
   differently-proportioned faces". The manifest says the faces are registered *identically*
   (both eyes at x = 0.37/0.63, y ≈ 0.44 on every model) and it is the eye **size** that varies
   by up to 22 %. The table's real failure was being tuned for the retired SVG — which is why
   it missed on all four models at once, not on three out of four.

**Deliberate trade-off, recorded.** The vanity ledge went from `height:16%` of the stage panel
(99 px on desktop) to a fixed `30px`. It is now a counter *edge* rather than a counter. Fixed
pixels, not a percentage, because the whole point is a constant relationship to the canvas's
bottom edge, which the stage panel's height does not track — that is what makes the shirt
visible at 1440, 820 and 390 px wide alike. If the salon art is ever reframed so the shirt sits
higher, the ledge can grow again; the spec will say so.

---

## 5. Not done yet

Tier 1's clinical and gameplay core is landed and played, and the art-fidelity sweep is closed
(§4b). What remains is recorded here rather than quietly dropped.

1. **Visual-fidelity sweep (§3.9) — closed in pass 3.** Full before/after measurements are in
   §4b. **Done across the three passes:** the 8 load-time console errors; the **"Actions left"
   meter, which filled backwards**; the **seven unlabelled hairstyle buttons** (now Buzz ·
   Tousled · Long bob · Bob · Spiky · Cropped · Pixie); the **phone-width horizontal overflow**;
   **sprite-layer alignment** (32 of 56 model×tool combinations painted outside their box → 0);
   **"Shirt color" behind the vanity ledge**; **blemish contrast** (1.06–1.67 : 1 → 3.18–6.82 : 1);
   **blemishes seeded under the hair** (10 of 28 model×style combinations → 0); the two
   near-invisible tools (Contour, Lip liner); the mechanic/label mismatch; and "Keep painting…
   100 %" on a finished step. None of these affect a score — they affect whether a spent action
   shows the child a result, and whether the "do it here" box points at the right place.
   **Still outstanding, deliberately:** the palette's *cap-dim* path still dims a tool the learner
   has no budget for rather than hiding it. That is left alone on purpose — §3.8's "inaccessible
   items are hidden" is about the staged task analysis (already hidden, `renderVals` filters
   locked options), whereas at-cap is a *refusal* the child is meant to see feedback for (D-B /
   AC-3), and hiding the palette mid-turn would be a bigger disruption than the dim.
2. **Device sweep** — desktop (1440×900), tablet (820×1180) and iPhone (390×844) all render with
   zero horizontal overflow and a clean console, and the shirt-visibility fix was verified at all
   three. What has *not* been done is a touch-interaction pass on a real device: the paint tools
   use pointer capture and only mouse pointers have been exercised.
3. **Dead code left in place, on purpose** — `buildV()`, `buildArtLayers()`, the `pet`/`hero`
   `THEMES` entries and the now-unused `personProcedural`/`petArt*`/`sceneFrame` render-values.
   `THEMES.social` is still read for the palette definition, so the map cannot simply be deleted.
   Removing the rest is a mechanical simplification pass, deliberately not mixed into a change
   whose risk profile is the scoring rules.
4. **The extra-time reinforcer is removed, not reworked.** Spec §3.8 asks to keep it as a
   non-cap reinforcer. It could not stay in its old form: it was `effGoal = actionGoal + bonus`,
   i.e. a second lever on the cap, which is exactly the A5 attack AC-17 forbids. And its other
   half — extra *time* — is meaningless now that AC-8 makes the learner's turn always
   action-counted rather than timed. Rather than invent an unspecified replacement, the control
   is gone and this is flagged for the maintainer: **if a relinquish reinforcer is wanted, it
   needs a design that touches neither the cap nor the turn length.**
5. **L6 stands, unchanged and unclosable in software** — see §6.

### Explicitly out of scope — Tier 2 (not built in this run)

Per spec §6 and the run's own instruction, **coordination mode is not started**: random
staff-error injection (extra turn / stall), the peripheral coded staff cue, the conditional
block-lift for the injection, and the staff-marked 3-way catch outcome (D-J / L3). None of it is
present, and the Tier-1 engine has no hooks reserved for it beyond the per-turn record being
open to extra fields.

## 6. Accepted limits carried into the build

- **L6 — who-taps on one device (accepted, human ruling).** The app cannot machine-prove the learner
  rather than the BT activated the pass or "✓ I asked!" control. The engine removes the *structural*
  false positive (the old `independent = !cueVisible`) but not this procedural residue; mitigation is
  BT procedural fidelity. Applies to both the pass and the ask-back.
- **L7 — outro strings.** Drafted here in §4, awaiting maintainer sign-off. No event needed escalation.
- **L8 — pause-vs-stall / forget-vs-mid-turn timing (tuning).** The engine cannot distinguish a
  thoughtful learner pause from a relinquish stall, or a staff mid-turn pause from a forget. Bounded
  as designed: the wait window is a config value, `btPrompt()` lets the observer deliver the real
  prompt, `signalForget()` lets the BT disambiguate a forget, and independence is gated on *any*
  prompt with the durable-forfeit rule — so this affects prompt **timing**, never false independence.
  The `AC-23` discardable-contrast test is the deliberate expression of this boundary.

## 7. One engine bug found and fixed during verification

Worth recording because it is the exact class of mistake this design is most vulnerable to. The first
implementation tested delivered prompts with `!!t.cueAt`. On an injected clock a prompt delivered at
`t=0` is a real delivery, but `!!0 === false`, so the engine reported *no prompt delivered* and would
have scored the pass `independent` — a fresh instance of the F-22 falsy-check family, caught by the
AC-3 assertion. All timestamp reads are now `!= null` comparisons, and the reason is commented at the
site so it is not "simplified" back.

## 8. Found by playing it — pass 2

Three defects that only a real browser surfaces, all now fixed and covered:

1. **`"What a team — what a team!"`** — see §4. A string-pool value colliding with the template
   that consumes it; invisible in a unit test of either half.
2. **Tools became unaddressable once used.** The palette wrote the button's *visible* label
   (which grows a `✓ ` prefix once a tool's effect is on the doll) into the `title` attribute as
   well, so a tool's tooltip changed under it and nothing could refer to a tool by a stable name.
   `title` is now always the raw tool name. This is a real accessibility bug, not just a test
   inconvenience: the tooltip and the accessible description drifted from the tool's identity.
3. **The done screen counted turns it never played.** `Trial finished · 9 of 10 turns` on a
   3-turn trial, because the counter read the (reset-to-zero) live turn index instead of the
   report. It now reads `report.rows.length`. A completion over-claim of a different kind, and
   exactly the class of thing the "no completion over-claim" rule exists to prevent.

None of the three could have been caught by reading the diff; all three came out of driving the
game and looking at the screen.

## 9. Found by measuring it — pass 3

Screenshots were not enough for the art sweep either; three of these were invisible to the eye
and only showed up once the compositor's output was diffed numerically. See §4b for the numbers.

1. **The alignment failure was universal, not per-model.** 32 of 56 model×tool combinations
   painted outside their own target box, and the failing set included every model — because the
   table was tuned for a renderer that no longer exists, not because four faces differ.
2. **Blemish contrast was bad on every model**, not just the two dark-skinned ones the eval
   named; m1's worst spot measured 1.06 : 1, the lowest of all twelve.
3. **Blemishes under the hair are systematic** — 10 of 28 model×hairstyle combinations, not the
   single M4 instance the eval caught. Only a sweep over every style surfaces that.
4. **`_data()` was the wrong tool for the pool filter.** Reading the seven hair masks per model
   through the existing ImageData cache would have retained ~8 MB per model to answer 56
   single-pixel questions. The filter samples one pixel at a time off a scratch canvas instead,
   and freezes its answer per model so a mid-play restyle can never move a spot the learner has
   already patched.
