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
finished).

**Voice (maintainer correction):** the **turn-taking lines are second-person — "you" — because the
learner (player 1) is who takes turns**, not the client sprite. The fictional client name (`{name}`,
drawn from 12 neutral names) is used **only** where the sentence is about the *client's* situation
(the intro/problem — "{name} is not ready yet") or the *client's* event outcome (the completion beat —
"{name} dazzled the crowd"). The turn-taking credit addresses the child directly. The outro opens with
a cheer word (§5's "one flavour word" slot).

Tier 3 lines are worded to be true even of a fully disengaged run — they credit the *shared activity*
rather than claiming persistence the learner may not have shown.

### 1 · School picture day 📸
- **Intro:** "Picture day is today! {name} is not ready yet — there is a whole glam routine to do and no outfit picked. The photographer is almost here! Good thing the glam team takes turns."
- **Tier 1:** "Every turn, you took a turn and then handed the brush back. Getting ready for picture day as a real team."
- **Tier 2:** "You and the glam partner traded the brush back and forth the whole time."
- **Tier 3:** "It takes a lot of turns to get ready for picture day — and you had a partner for every one of them."
- **Completion beat:** "And the whole routine got finished before the photographer arrived — picture day was a hit!"

### 2 · Birthday party 🎉
- **Intro:** "The party starts in a few minutes! {name} is not party-ready yet — there is lots to do and no outfit yet. The guests are already arriving! Good thing the glam team takes turns."
- **Tier 1:** "Turn after turn, you took a turn and passed it right back. Nobody gets party-ready like a team that shares."
- **Tier 2:** "You shared the brush with the glam partner all the way through getting ready for the party."
- **Tier 3:** "Getting party-ready takes a lot of turns, and you had a partner the whole time."
- **Completion beat:** "And the whole look was ready the moment the guests walked in — what a party!"

### 3 · Talent show 🎤
- **Intro:** "Talent show — {name} is on next! {name} still needs the full glam routine before going on. On stage next! Good thing the glam team takes turns."
- **Tier 1:** "Every turn, you took a turn and then gave it back. Backstage teamwork at its very best."
- **Tier 2:** "You and the glam partner took turns backstage, right up to showtime."
- **Tier 3:** "Getting ready backstage takes a lot of turns, and you had a glam partner for all of them."
- **Completion beat:** "And the whole glam routine was done before the curtain went up — {name} dazzled the crowd!"

### 4 · Family photo 🖼️
- **Intro:** "Family photo time! {name} is not camera-ready yet — the whole routine still has to be done. Grandma is waiting! Good thing the glam team takes turns."
- **Tier 1:** "Turn for turn, you took a turn and handed it back every single time. That is what a team looks like."
- **Tier 2:** "You and the glam partner passed the brush back and forth while everyone got ready."
- **Tier 3:** "Getting everyone camera-ready takes a lot of turns, and you had a partner right there."
- **Completion beat:** "And the whole look came together before grandma finished waiting — the framed favorite!"

### 5 · First day, new school 🎒
- **Intro:** "First day at a new school! {name} wants to feel ready — there is a full routine to do and no outfit yet. The bus comes in a few minutes! Good thing the glam team takes turns."
- **Tier 1:** "Every turn, you took a turn and passed it back. Getting ready for a big day, together."
- **Tier 2:** "You took turns with the glam partner all through getting ready for the first day."
- **Tier 3:** "Getting ready for a first day takes a lot of turns, and you had a partner for every one."
- **Completion beat:** "And the whole routine was finished before the bus came — {name} walked in beaming!"

### 6 · Dance recital 🩰
- **Intro:** "Dance recital tonight! {name} is not show-ready yet — there is a glam routine to do. Curtain in minutes! Good thing the glam team takes turns."
- **Tier 1:** "Turn after turn, you took a turn and gave it right back. A recital-day team through and through."
- **Tier 2:** "You and the glam partner traded turns the whole time, getting ready for the recital."
- **Tier 3:** "Getting show-ready takes a lot of turns, and you had a glam partner through all of them."
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

---

# Refresh — the broader makeover refresh

A second body of work on top of the Tier-1 build: a richer, more themed makeover
*activity*, a texting-style opening flow, and two fixes. The clinical layer is
frozen for all of it — `window.GlamTT` and `tests/glam-tt-scoring.spec.js` are not
to be touched, and `window.GlamStory`'s guarantees (two-axis outro, congruence,
second-person turn-taking lines, no PHI, no numbers) have to keep holding.

This section is written incrementally, one landed slice at a time.

## R1. The two fixes — M1 retired, blemishes softened

### R1.1 M1 is retired

The requirement is that M1 is *not selectable and not in the random-client pool*.
There were four routes into a model and it only takes one left open to put the
retired face in front of a child, so all four now read one list:

`window.GlamStory.MODELS` (`['m2','m3','m4']`) is the roster and the single source
of truth. Off it hang —

| Route | Before | Now |
|---|---|---|
| Random client draw | `pick(['m1','m2','m3','m4'])` | `pick(MODELS)` |
| BT character lock (`<select>`) | five options incl. `Lock: model 1` | roster only |
| A lock value that is *not* on the roster (a stale config, a hand-typed id) | honoured verbatim | falls back to the random draw |
| On-stage art model picker | `artGated()` returned `{}` — everything the art bundle ships | gates every generated model the roster does not list |

`EYECFG` / `BROWCFG` / `EARCFG` lost their `m1` rows with it; those tables are
per-model sprite calibration and every lookup already falls through to a `_D`
default. M1's generated art still ships in `assets/` and is simply unreachable —
no code path enumerates or fetches it. Deleting the asset files is deferred
(below), not forgotten.

**Tests.** `glam-team-makeover.spec.js` gained *M1 is retired — absent from the
roster, the random pool and every picker*, which walks all four routes: 500 draws
never yield `m1` and collectively cover exactly the roster; a forced `m1` lock
does not return `m1`; the `<select>` offers `['random', ...roster]`; and the stage
picker renders a button per roster model and none for M1. The model sweeps in
`glam-art-fidelity.spec.js` (F-11, F-10, F-16, F-16b) and the distinct-stage test
now iterate `GlamStory.MODELS` instead of a hardcoded four, and their count
assertions are derived from it (`roster.length * 14`, `roster.length * 7`) — so
retiring or adding a model updates the sweeps rather than breaking them.
`glam-tt-story.spec.js`'s D-F draw test asserts against the roster and adds an
explicit "`m1` is not drawable".

**One latent test bug fell out of this.** With M1 gone, M2 became the *first*
model measured after page load, and F-16 immediately failed at 1.01 : 1. The cause
was never the blemishes: `_skinPool()` returns `null` while a model's seven hair
masks are still decoding, and `_spots()` then falls back to the *unfiltered* pool —
so a measurement taken inside that window reads spot positions the compositor has
already stopped painting at. M1 had been absorbing the decode as the loop's first
iteration. The spec's shared `setModel` helper now waits for `_skinPool` before
returning, which is what F-16b was already doing by hand.

### R1.2 The blemishes are softer

The skincare targets read as clinical and a bit gross. What could *not* change is
the value: F-16 requires 3 : 1 against the surrounding skin, and at skin L≈0.20
that pins the dark-skin-branch core near L≈0.02. There is no friendlier colour at
that luminance, so "softer" had to mean softer **form**.

The harsh rendering was three cues stacked: a crisp filled disc, a near-black rim
**stroke** around it, and a specular gloss dot offset up-left — the visual grammar
of a pustule. It is now two soft radial falloffs and nothing else:

```
halo   r×1.25   α 0.38   soft gradient   #c1687a (light skin) / #ffb499 (dark skin)
dot    r×0.72   α 1.00   radial falloff  #4a1520 (light skin) / #ffe0cf (dark skin)
```

`rim` and `gloss` are gone from `_spotInk`'s palettes entirely. The only hard value
left anywhere is the single centre pixel, which is what F-16 measures.

Measured coverage profile of the brush, sampled every 0.05 r out to r×1.6:

| | r×0 | 0.2 | 0.4 | 0.5 | 0.6 | 0.7 | 0.75 | 0.8 | 1.0 |
|---|---|---|---|---|---|---|---|---|---|
| harsh | 1.00 | 1.00 | .95 | 1.00 | **1.05** | .90 | **.25** | .12 | .05 |
| soft | 1.00 | .90 | .73 | .56 | .36 | .08 | .04 | .02 | .01 |

The bold cells are the two defects, visible as numbers: `1.05` is the rim stroke
reading as *more* than full coverage (it was inked darker than the core it ringed),
and the `.90 → .25` step is the disc edge.

**Test.** *refresh · blemishes are soft — the paint decays, with no rim, cliff or
gloss* in `glam-art-fidelity.spec.js`. It renders the same face twice with the same
seed — once with the spots cleared, once with them present — and divides the
luminance delta by `(ink − skin)` per pixel to recover the compositor's actual
alpha. That normalisation matters: the raw delta scales with how far the skin under
each pixel already is from the ink, and the face's own shading moves that by ±10%
inside a single spot, which is enough to fake a rim (it did, on Firefox, before the
normalisation went in). On the recovered profile it then requires: coverage never
drops more than 0.35 in one 0.05 r step (no cliff / no disc), no ring more covered
than the paint inside it (no stroke), no negative coverage, and effectively nothing
left by r×1.0.

Verified red/green rather than asserted: with the harsh rendering pasted back in it
fails on all three browsers (`coverage falls 65 points between r×0.7 and r×0.75`);
with the softened rendering it passes on all three.

![blemish, harsh](shots/glam-refresh/blemish-before-zoom-desktop.png)
![blemish, softened](shots/glam-refresh/blemish-after-zoom-desktop.png)

Before (left) and after (right), same model, same seed, same crop —
`docs/eval/shots/glam-refresh/blemish-{before,after}-zoom-desktop.png`, with the
whole face at `blemish-{before,after}-face-desktop.png`.

### R1.3 Verification

- **Full suite: 258 passed** across chromium / firefox / webkit (252 before this
  slice, plus the two new tests × three browsers). No test was skipped or relaxed.
- **`window.GlamTT` is byte-for-byte unchanged**, and so is
  `tests/glam-tt-scoring.spec.js` (`git diff --stat` on it is empty). The only
  edits inside the `GlamStory` block are the roster constant, the roster-aware
  lock in `draw()`, and its export — the event pool, the banned-word guard, the
  two-axis outro and the second-person turn-taking lines are untouched.
- **Console clean** at 1440×900, 820×1180 and 390×844, checked on load and after
  entering play: `play-surface-{desktop,tablet,phone}.png`.
- `git status` shows changes only under `apps/games/` and `docs/`.

### R1.4 Deferred from this slice

- M1's generated art (`assets/art/person/m1/**` and its entries in
  `art-generated.js`) still ships. It is unreachable, but it is dead weight in the
  bundle; deleting it is a separate, easily-verified change.
- The screenshots here cover the *current* play surface only. The start screen,
  the texting intro and the outro reveal do not exist yet, so the device sweep the
  refresh calls for is necessarily partial until they land.
- The blemish palette still has only two branches (light-skin / dark-skin) chosen
  by a luminance threshold at L=0.20. A spot seeded right at the boundary picks one
  or the other with no blending; nothing in the current roster lands there, but a
  future model could.

## R2. The new opening flow — title → texting intro → random client → salon

The single static intro card is gone. The child's route into the game is now:

```
title screen  ──Start Playing──▶  a client texts in and books  ──Open the salon──▶  the vanity
   ⚙ setup                         (bubbles arrive, team replies)      (unchanged play surface)
```

### R2.1 The title screen

![title screen, desktop](shots/glam-refresh/title-screen-desktop.png)

One child-facing affordance — **Start Playing ▸** — on a dark plum/gold salon
marquee, with the staged routine spelled out underneath as a
`Skincare → Makeup → Hair → Accessories` rail so the order the activity enforces
is legible before the first turn. Defaults are sensible, so the tap works with no
setup at all.

The BT's clinical setup (turns, give-back, cue level, wait window, count
shown/hidden, routine, turn map, **and the character lock**) is *reachable but not
in front of the child*: the settings strip now boots collapsed and opens from the
header ⚙ or from the title screen's own `⚙ Session setup` ghost button. There is
deliberately **no character dropdown in the child flow** — the client is drawn at
random on Start (D-F); a learner who needs consistency gets the lock, in the strip,
where the BT is.

`▶ Play` inside that strip still starts a trial directly, skipping the texting
intro. That is the clinician's route in (and the one every pre-existing spec
drives); the child's route is Start.

> **Why the CTA reads "Start Playing" and not "Start".**
> `tests/glam-tt-scoring.spec.js` is frozen by the refresh's hard constraint and
> its smoke test asserts a visible `button[name=/Play/]` on load. With the setup
> strip collapsed, the only button on the first screen is the child's CTA — so the
> label has to satisfy both. "Start Playing ▸" is a clear start affordance and
> keeps the frozen spec green without touching it.

### R2.2 The texting intro

![texting intro mid-thread, desktop](shots/glam-refresh/texting-intro-desktop.png)
![appointment booked, phone](shots/glam-refresh/texting-booked-phone.png)

The pretext plays as an **incoming thread to the glam team's phone**: a contact
header (the drawn client's name + the event's emoji, "Booking the glam team"),
then five bubbles arriving one at a time at 900 ms with a typing indicator on the
side the *next* message will come from, ending with a booked chip and
**Open the salon ▸**. `Skip ahead` lands the whole thread at once. The bubbles hug
the bottom of the panel, so a short thread reads like a conversation rather than
stranding itself at the top of an empty box.

The content is the same mad-lib as before — event + stakes + task — re-shaped as a
booking:

| | |
|---|---|
| client | `Hi glam team! It is school picture day today.` |
| client | `The photographer is almost here!` |
| client | `Could you book me in before the photographer gets here?` |
| team | `Hi {name}! The glam team just picked up.` |
| team | `You are booked — come on in. We take turns here: skincare first, then makeup, then hair, then an outfit.` |

`textOpen` and `textAsk` are new per-event fields; the middle bubble is the
existing `stakes` string. The team's two replies and the booked note are shared.

**Congruence (AC-10 / §3.7.1) is enforced by construction, not by eyeball.**
`thread()` lives in `window.GlamStory` and `allStrings()` now emits every bubble
of every event × every name slot (6 × 12 × 6 = 432 new strings), so the *existing*
`congruenceViolations()` sweep and the existing "no story string carries a number"
test cover the texting intro automatically. The client texts about the occasion,
the stakes and the booking — never a claim about their own hair or skin, and never
a number.

### R2.3 The client who texts is the client who sits down

`play()` used to re-draw the character every time it ran, which — once a screen sat
between the draw and the trial — would have quietly swapped the client between the
thread and the vanity. It now takes `{keepClient:true}` on the salon-opening path
and only draws fresh on the BT's `▶ Play`. A test pins the whole `sel`
(name + model + scenario) plus the painted model across the transition.

`Play again` returns to the title screen, so the second run opens exactly like the
first.

### R2.4 Tests

New spec **`tests/glam-open-flow.spec.js`** (9 tests × 3 browsers):

| Test | What it pins |
|---|---|
| the front door is a title screen with Start… | Start visible; `Character`, `Turns`, `▶ Play` all hidden; the ⚙ affordance opens them; console clean |
| Start plays the pretext as an incoming text thread… | contact header, a first bubble, a live typing indicator, every message lands, both sides of the conversation, typing stops, booked chip, and the salon opens onto `Go — my turn!` |
| "Skip ahead" lands every message at once | `threadStep === total`, Skip disappears, the salon button appears |
| the client who texts in is the client who sits down | `sel` and the painted model identical across `Open the salon` |
| D-F · Start draws a random client, and never the retired M1 | 40 real `beginIntro()` runs: name, model and scenario all vary, models are exactly the roster, never `m1` |
| the BT character lock still pins the client through the new flow | lock `m3` → 20 draws, all `m3` |
| AC-10 · every string the texting intro can put on screen is swept | 432 thread strings in `allStrings()`, none with a digit, no violations, and the guard demonstrably still bites |
| §8 · no number to the child and nowhere to type | no `input`/`textarea`/`contenteditable` on either new screen; no digit in either screen's rendered text; no clinical vocabulary in the thread |
| "Play again" returns to the front door | done → title, with the setup strip collapsed again |

Three pre-existing specs were updated for the collapsed setup strip (and only for
that): `glam-tt-game.spec.js` grew an idempotent `ensureSetupOpen()`,
`glam-team-makeover.spec.js` an `openSetup()`, `glam-art-fidelity.spec.js` one ⚙
click in its `stage()` boot. `glam-tt-game.spec.js`'s AC-10 test now drives
Start → the thread instead of reading the old intro card. No assertion was relaxed.

### R2.5 Verification

- **Full suite: 285 passed** across chromium / firefox / webkit (258 before this
  slice, plus 9 new tests × 3 browsers). Nothing skipped, nothing relaxed.
- **`window.GlamTT` byte-for-byte unchanged** — the first diff hunk in
  `index.html` after the stylesheet is at the `GlamStory` events, well past the
  engine block — and `git diff --stat tests/glam-tt-scoring.spec.js` is empty.
- Inside `GlamStory`, the additions are `textOpen`/`textAsk` per event, the shared
  team replies, `thread()`, its `allStrings()` rows and its export. The event set,
  `BANNED`, the two-axis outro and the second-person turn-taking lines are
  untouched.
- **Console clean** on every screen at 1280×860, 834×1112 and 390×844 — the
  screenshot pass (`tests/_shots-open-flow.mjs`) fails the run on any console or
  page error and it exits clean.
- Screenshots, all three widths: `title-screen-{desktop,tablet,phone}.png`,
  `texting-intro-{…}.png`, `texting-booked-{…}.png`, `salon-open-{…}.png`, plus
  `bt-setup-desktop.png`, under `docs/eval/shots/glam-refresh/`.
- `git status` shows changes only under `apps/games/` and `docs/`.

### R2.6 Deferred from this slice

- **The activity itself is untouched** — same palettes, same tool count, same
  vanity. `salon-open-{desktop,tablet,phone}.png` is the *pre-refresh* play
  surface, reached through the new door. The richer stations, the wider colour
  range and the per-tap feedback are the next slice.
- **No before/after reveal at the outro yet.** The done screen is still the
  Tier-1 celebration + two-axis story. *(Landed in R3 below.)*
- The thread is one fixed shape (three client bubbles, two team bubbles). A
  variable-length thread, or team replies that vary by event, would add texture
  but also multiply the congruence surface; the fixed shape keeps the sweep
  exhaustive.
- `intro()` still composes the old card's title/text. Nothing renders it any more;
  it is kept because it is still swept by AC-10 and is the natural home for the
  pretext if a non-texting presentation is ever wanted.

---

## R3. The outro before → after reveal (the photo booth)

The celebration screen now opens with the transformation the child actually made:
two polaroid frames, side by side, the doll as the client arrived and the doll the
team finished together.

### R3.1 Mechanic adopted — and the novel bit

The mechanic is the makeover genre's oldest payoff: the reveal. What is novel here
is that **nothing is re-rendered for it**. There is no second doll, no serialised
"look" replayed into a preview, no separate art path that could drift from the one
the child was touching. Both frames are grabbed off the *same* `<canvas>` the game
paints on — `paintAvatar`'s compositor — so the picture is the play surface, at the
two moments that matter:

| Frame | Grabbed | Why there |
|---|---|---|
| **Before** | at `Go`, or at the last repaint before the first edit, whichever is later | no action can be admitted before `Go`, so the doll is untouched by definition |
| **After** | inside `syncTT()`, the instant `Trial.ended` flips and *before* the state commit | one render later the game surface unmounts and the compositor canvas is gone |

Both are plain offscreen `<canvas>` elements held on the component instance, never
in state and never as data URLs in markup — a `{{ }}` placeholder inside a `src=`
or a `url()` is fetched by the parser before the runtime substitutes it, which is
exactly the load-time 404 the §3.9 sweep removed. `paintReveal()` blits them into
the two canvases on the done card from `componentDidUpdate`, alongside the avatar
compositor, so the frames arrive with the card rather than a tick later.

**Congruence (§3.7.1 / AC-10).** The booth's own copy is three strings — *Glam team
photo booth*, *Before* / *After*, *Look what you two made together.* — none of
which asserts anything about the client. The only thing it shows of them is the
picture the child made, which is not a refutable claim: it *is* the evidence. A
test runs the booth's rendered text back through `GlamStory.BANNED` and asserts no
digit and no text input, same guarantee as the title screen and the thread.

Motion is `transform` + `opacity` only: the two frames swing in off a tilt,
staggered by 180 ms, and the sparkle between them settles last. Each frame's
resting angle rides on a `--tilt` custom property so one keyframe serves both.
`prefers-reduced-motion` already kills every animation in this file; the resting
`transform:rotate(var(--tilt))` is declared outside the keyframe, so the frames
still sit at their angle with motion off.

### R3.2 Two things that had to be got right

**The before frame must not photograph a half-built doll.** The face is assembled
from sixteen independently-decoding PNGs, and every `onload` repaints. So the
before frame is *re-grabbed on every repaint* while its window is open, and the
window only closes once there is a real frame to close it on: `_shot()` returns
`null` until the base art has decoded, and `_closeBefore()` refuses to close on a
`null`. If the art is still decoding at `Go`, the window simply stays open and the
next repaint takes a clean frame.

**A paint stroke is why `Go` is not the only close.** `paintStep()` moves coverage
on every pointer move and only charges the engine when coverage *completes*, so
closing the window on the engine's first admitted action would photograph a face
most of the way through a wash. Every edit entry point — `applyChoose`,
`tapApply`, `patchOne`, `concealOne`, `paintStep` — calls `_closeBefore()` first as
the backstop.

**The grab is a 1:1 blit, not a downscale.** The first cut halved the resolution on
the way into the frame. On WebKit the same compositor content then came out ~9 % of
pixels apart depending on whether it was photographed inside a click handler or
outside it — visually identical, but enough to make "is this frame the untouched
doll?" unanswerable, and it failed the test that asks exactly that, on WebKit only,
every run. `drawImage` at 1:1 is exact on every engine; the polaroid gets a
retina-sharp source for free, and the frames are byte-identical across the handler
boundary.

### R3.3 Tests

New spec **`tests/glam-outro-reveal.spec.js`** (6 tests × 3 browsers):

| Test | What it pins |
|---|---|
| the celebration opens with two frames, labelled Before and After | booth header, both labels, both canvases mounted, both carrying real ink (> 10 % of pixels non-transparent — not an empty polaroid); console clean |
| the two frames are different pictures | four real tool taps across three stations, then > 1 % of pixels differ between the mounted frames — the reveal cannot be the same picture twice |
| the before frame is the doll exactly as it was before the first edit | hash the live compositor while untouched, edit, assert the live compositor moved, `_shotBefore` did not, and the two mounted canvases are byte-for-byte the pre-edit and post-edit faces |
| the booth appears on the child's route too | Start → thread → salon → play → outro, and the client who texted is the client in the frames |
| §8 · no number, nowhere to type | the booth's rendered text carries no digit, hosts no `input`/`textarea`/`contenteditable`, and passes `GlamStory.BANNED` |
| "Play again" clears the booth | `revealReady` false, both instance frames dropped, the canvases gone from the DOM |

Every test waits on a real settle condition — every image the compositor has
*asked* for decoded, and `_skinPool()` resolved — rather than a timeout. Without
the skin-pool wait the blemishes sit at unfiltered coordinates and a frame taken
across that decode differs from the face the child was looking at.

### R3.4 Verification

- **Full suite: 303 passed** across chromium / firefox / webkit (285 before this
  slice, plus 6 new tests × 3 browsers). The new spec was also run at
  `--repeat-each=2` (36/36) to shake out the WebKit non-determinism above.
- **`window.GlamTT` byte-for-byte unchanged** — the region from `window.GlamTT` to
  `window.GlamStory` is identical to `HEAD` at 24 710 bytes, and
  `git diff --stat tests/glam-tt-scoring.spec.js` is empty. `window.GlamStory` was
  not touched at all in this slice: the booth reads pixels and never asks the
  engine or the story pool anything.
- **Console clean** at 1280×860, 834×1112 and 390×844 — the screenshot pass
  (`tests/_shots-outro-reveal.mjs`) fails the run on any console or page error and
  it exits clean.
- Screenshots under `docs/eval/shots/glam-refresh/`:
  `outro-reveal-desktop.png`, `outro-reveal-tablet.png`, `outro-reveal-phone.png`,
  plus a close crop of the booth itself, `outro-reveal-booth.png`.
- The frames are `clamp(84px, 23vw, 138px)` wide with the aspect ratio taken from
  the compositor, so they stay side by side at 390 px instead of stacking — the
  first cut wrapped into a column on iPhone and lost the comparison.
- `git status` shows changes only under `apps/games/` and `docs/`.

### R3.5 Deferred from this slice

- **The activity itself is still untouched** — same palettes, same tool count,
  same vanity. The richer stations, the wider colour range, the salon theming and
  the per-tap feedback remain the outstanding slice of the refresh.
- The booth does not appear in the **print report**. The printed sheet is the
  clinician's per-turn table under the outro story, and pictures of the doll add
  nothing to it; if a family-facing print is ever wanted, `_shotAfter.toDataURL()`
  is the hook.
- **No save / share of the frames.** Deliberate: there is no per-learner storage in
  this build and adding an export is the kind of thing that grows a PHI surface.
- The booth is skipped entirely on a **procedural (non-art) theme**, where there is
  no compositor canvas to photograph. `showReveal` requires both frames, so the
  outro simply renders as it did before rather than showing two empty rectangles.

---

## R4. The station kit — a generous fixed stock per station

The refresh's remaining piece is the ACTIVITY. This slice does the depth half:
the vanity now carries **ten stations and 69 tools** where it carried seven and
43, and the deep stations are deep in the way a salon is deep — many shades of
one article, not many articles.

That distinction is the whole design constraint. `REQUIRED_ACTIONS = 19` scales
the engine's per-turn budget (D-D / AC-7), so an extra *article* would have
re-scaled every trial ever run. An extra *shade* of an article the child was
already going to apply costs nothing: the charge key is `color:<slot>`, so
Blush plum and Blush rose are the same spend, and swapping between them inside a
turn is free. Depth here is choice, not work — which is also the Toca-Boca
reading of it: more ways to be right, no new way to be wrong.

### R4.1 What is stocked now

| Station | Before | Now | How the range was won |
|---|---|---|---|
| Skincare 🧼 | 5 | 4 | brow tools moved to their own shelf |
| Brow bar ✂️ | — | 2 | new shelf: Shape brows + Brow pencil |
| Cheeks & glow 💄 | (in Makeup) | 8 | blush **2 → 6** shades |
| Eyes 👁️ | (in Makeup) | 8 | eyeshadow **2 → 6** shades |
| Lips 💋 | (in Makeup) | 8 | lipstick **3 → 7** shades |
| Hair style 💇 | 7 | 7 | art-bound (seven shipped masks) |
| Hair color 🎨 | 7 | 12 | **+5** shades on synthesised recolour ramps |
| Earrings 💎 | 3 | 3 | art-bound (three shipped sprites) |
| Shirt color 👕 | 4 | 9 | tint decoupled from the garment cut |
| Colored contacts 👀 | 4 | 8 | **+4** shades |

The one **Makeup** shelf became **Cheeks & glow / Eyes / Lips**, and the two
untracked brow tools got their own **Brow bar**. Before this, "Brow pencil" was
the lone visible member of a shelf headed *Makeup* during the skincare phase,
which read as a station that had lost its stock. A station is now a shelf of the
vanity; the staged order still comes only from each tool's own `step`/`ph`.

### R4.2 Two ceilings that were not real ceilings

**Hair colour was capped at seven by data, not by art.** `_hairCanvas` recolours
the hair masks through a 3-stop `{hue, s[], v[]}` ramp from the generated
manifest, and the build only shipped seven. Measured across all seven, the ramp
is not free-form: `hue` and `s` are exactly the swatch's own hue and saturation,
and the value curve is a fixed proportion of the swatch's value — mid ≈ 0.93·v,
shadow ≈ 0.55·mid, highlight ≈ 1.015·mid (brunette 0.945/0.465, blonde
0.960/0.493, berry 0.993/0.621, silver 0.958/0.764). So `rampFromHex()`
synthesises a ramp from the swatch alone, and the five new shades cost no art.
The seven shipped ramps still win the lookup, so nothing already on screen moved.

**Shirt colour was capped at four by a lookup.** The tee is recoloured in place
(tint × luminance, keeping the folds and the black outline), but the tint came
from `SHIRT_TINT[ed.outfit]` — a table keyed by the garment *cut*. Four cuts, four
colours, forever. The tint now reads `ed.col.garment`, the shade the child
actually picked, with the per-cut table left as the fallback for an outfit set
without a swatch behind it. Two shades may now share a cut, so the ✓ state had to
start matching on cut **and** shade — matching on the cut alone ticked every
shade cut the same way.

### R4.3 Tests — `tests/glam-station-kit.spec.js` (5 × 3 browsers)

| Test | What would have to break for it to fail |
|---|---|
| every station stocks its shades on the real palette | a shade added to the data but filtered off the palette; a station missing; two tools sharing a name (every spec addresses tools by `title` and takes `.first()`) |
| every stocked shade paints, and no two shades of one article paint alike | a swatch with no recolour ramp; a tint read off something other than the shade |
| AC-7 · one article, one charge key | a shade that spends a *new* action, which would re-scale the engine's budget |
| the staged routine still hides a station until its phase opens | the restructure leaking a later station into turn one, or dimming instead of hiding |
| two shirt shades cut the same way are told apart on the button | the ✓ state matching on the cut alone |

**Both halves of the pixel test were red before they were green**, and getting
there took two corrections worth recording:

- *The baseline was noise.* Cutting a fresh `freshEd()` per shade re-seeds
  `spotSeed` from `Math.random()`, which moves the blemishes — so every canvas
  came out different no matter what the shade did, and **both** assertions passed
  vacuously. With a per-shade `freshEd`, reverting the shirt fix still went green.
  One frozen baseline, deep-copied per shade, fixed it: the control then failed
  with *"Sunshine paints identically to Rose"* — the two shades that share the
  `dress` cut.
- *A fixed pixel floor could not see a missing ramp.* A hair shade with no ramp
  still repaints the **brows**, which take the same swatch, so it clears any small
  absolute floor: with a floor of 150 px, deleting the synthesised-ramp fallback
  went green. Measured on m3, a whole head of hair moves ~42 000 px and brows-only
  moves ~6 100, so the floor is now a quarter of the *station's own median*
  (~10 500) — between the two, where no constant is. The control then failed with
  *"Mint moved 6084px, under a quarter of the station's usual"*.

### R4.4 Verification

- **Full suite: 318 passed** across chromium / firefox / webkit (303 before this
  slice, plus 5 new tests × 3 browsers) — green on 3 of the last 4 consecutive
  full runs, with the 4th failing only on the external font fetch described in
  R4.5. `glam-station-kit.spec.js` was also run at `--repeat-each=3` (45/45) and
  `glam-team-makeover.spec.js` at `--repeat-each=6` (90/90).
- **`window.GlamTT` and `window.GlamStory` byte-for-byte unchanged** — both
  regions hash identical to `HEAD` (`28f93cfc…` and `8d212b3b…`), and
  `git status tests/glam-tt-scoring.spec.js` is empty.
- **The staged order still opens exactly as it did**, verified by driving the TA
  forward a phase at a time and reading the rendered shelves:
  `skin → Skincare(1) Brow bar(2)` · `makeup → + Cheeks & glow(1)` ·
  `hair → + Eyes(8) Lips(8) Hair style(7) Hair color(12)` ·
  `acc → + Earrings(3) Shirt color(9) Colored contacts(8)`. Later stations are
  **absent**, not dimmed.
- **Console clean** at 1280×860, 834×1112 and 390×844 —
  `tests/_shots-station-kit.mjs` exits non-zero on any console or page error and
  it exits clean.
- Screenshots under `docs/eval/shots/glam-refresh/`:
  `station-kit-desktop.png`, `station-kit-tablet.png`, `station-kit-phone.png`,
  a close crop of the deepest shelves `station-kit-shelves.png`, and the staged
  first turn `station-kit-staged-turn1.png` as the hidden-not-dimmed record.
- The five synthesised hair shades were **looked at**, not just measured: Mint,
  Lilac, Bubblegum, Sunset and Midnight each render as real hair with the mask's
  own shading and black outline intact, and the brows follow the shade.
- `git status` shows changes only under `apps/games/` and `docs/`.

### R4.5 Three things the fuller suite shook out

Adding 15 test-runs to a `fullyParallel` three-browser suite turned out to be a
load test of the suite itself. All three findings below are recorded because none
of them was a regression in the game, and two of them were latent before this
slice.

**1 · A spec's cost is a shared resource.** The new pixel test was first written
with a 40-iteration re-snapshot settle per shade. Every assertion in it passed —
but the extra CPU starved an unrelated poll and `glam-team-makeover.spec.js`'s
model sweep began timing out. Running the suite with the new spec *excluded* came
back 303-green, which is what identified it as load rather than a regression.
`paintAvatar` runs synchronously inside `componentDidUpdate`, so one frame after
`setState` resolves the canvas is final: the settle is now one frame plus a short
safety net, and one `setState` per shade instead of a reset-then-edit pair.

**2 · The model sweep's wait was hiding a real defect.** `glam-team-makeover.spec.js`
polled for "a fingerprint I have not seen yet", which returns null both while a
model swap is still decoding *and* when a model genuinely painted the same stage
as another. Those are different failures with one symptom — "timed out" — which
is why the first two attempts to fix it (raise the poll, then raise the test
budget) only moved the message around. Split into *wait for the canvas to change
and hold still* + *assert the settled fingerprint is new*, it immediately exposed
what the conflation had been hiding: **the client is drawn at random, so the
model the loop is about to click may already be the one on screen, and clicking
the active model repaints nothing.** The wait now asks for a change only when the
click is an actual swap. 90/90 at `--repeat-each=6` after.

**3 · The fonts come from a CDN, and the suite depends on it.** The remaining
intermittent failure is Firefox reporting
`Cross-Origin Request Blocked … fonts.gstatic.com` and failing whichever spec
asserts a clean console that run. It is not the game: the `@import` for Atkinson
Hyperlegible lives in the shared `apps/games/tailwind.css`, which every game
loads and which is **outside this build's file boundary**, so it was left alone.
Worth flagging beyond this game: it can fail `tests/glam-tt-scoring.spec.js`, the
one spec this work is forbidden to touch, and no assertion in that spec is at
fault when it does. Self-hosting the two font families would remove a network
dependency from the whole games suite.

### R4.6 Deferred from this slice

- **The theming half of the activity refresh is still outstanding.** This slice
  is depth of stock; the warmer salon dressing, the cohesive palette and type
  pass, and the per-tap "choices mirrored with care" feedback are the remaining
  work on the makeover refresh.
- **Hairstyles stay at seven and earrings at three** — both are bound by shipped
  art (seven hair masks, three earring sprites), not by a lookup. Adding to either
  means going back to `avatar-kit`, which is outside this build's file boundary.
- **No new *articles*.** A lip gloss, a face gem, freckles — each would be a new
  slot with new compositor work *and* a new charge key, which re-scales the
  engine's budget. Out of scope for a slice whose contract was "richer, and the
  engine cannot tell".
- The **pet and hero themes** were left alone. They are procedural (non-art)
  routes with their own small palettes and neither is on the child's route in.
- **Self-hosting the Atkinson fonts** (R4.5 · 3) is the one fix identified here
  that could not be made, because the `@import` is in shared games CSS rather
  than in this game.
