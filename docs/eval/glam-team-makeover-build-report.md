# Glam Team Makeover — Tier 1 build report

**Branch:** `feat/glam-turn-taking-redesign` · **File under change:** `apps/games/glam-team-makeover/index.html`
**Specs added:** `apps/games/tests/glam-tt-scoring.spec.js`, `apps/games/tests/glam-tt-story.spec.js`
**Spec updated:** `apps/games/tests/glam-team-makeover.spec.js`
**Authority:** `docs/glam-team-makeover-redesign-hardened-claims.md` (AC-1…AC-27) — wins over spec prose.
**Date:** 2026-07-24

> **Status: PARTIAL — the measurement spine is built and verified; the game surface is not yet wired to it.**
> This report is written after the first build pass and is honest about the split: the scoring
> engine and the story pool are implemented and covered by passing Playwright specs, and the
> load-time console is clean. The game's own screens still run the **pre-redesign** turn loop —
> so the criteria that depend on the live UI are explicitly marked *pending wiring* below rather
> than claimed. Nothing in the "verified" column is inferred from reading code; each row names the
> test that reproduces it.

**Test status:** `npx playwright test` → **186 passed** (chromium · firefox · webkit), 0 failed.

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

`✔ verified` = reproduced by a named passing test. `◑ engine only` = the rule is implemented and
verified in the engine/story layer, but the **live game screens are not yet wired to it**, so the
criterion is not yet true of the app a BT would open. `✗ not started`.

| AC | Status | Evidence |
|---|---|---|
| AC-1 pass after window → `prompted` at every level incl. silent | ✔ | `AC-1 · a pass after the window elapsed…` (loops full/gesture/silent) |
| AC-2 `independent` iff pre-prompt, no forfeit | ✔ | `AC-2 · a pass inside the window…` |
| AC-3 over-cap: refuse + feedback + log + prompt, every count mode | ◑ | `AC-3 · an over-cap tap is refused…` — engine returns feedback unconditionally; **UI toast pending** |
| AC-4a over-cap forfeits only that turn (fade curve survives) | ✔ | `AC-4a (A3) · over-cap forfeits only THAT turn…` — 5 independent passes survive |
| AC-4b silent-probe over-cap → `prompted@silent` inside the window | ✔ | `AC-4b (B2) · at silent-probe an over-cap grabber…` |
| AC-5 completion claim gated; trial always terminable | ◑ | `AC-16 (A4) …`, `a trial is always terminable…`, `AC-5 / AC-18 · the completion beat…`; **done-screen wiring pending** |
| AC-6 re-applying a done step does not advance completion | ✔ | `AC-6 · re-applying a done step…` |
| AC-7 turns=N auto-scale, ~2/3 learner share | ✔ | `AC-7 · turns=N auto-scales…`, `AC-7 · a cooperative run completes…` |
| AC-8 no timer bounds the learner's turn | ◑ | `AC-8 · no timer bounds the learner's own turn`, `a timed partner turn keeps its prescribed length…`; **config still offers "My turn: Timed"** |
| AC-9 ten-column table + de-identified footer, no name/freeform | ◑ | `AC-9 · the report is a per-turn table…` (column keys + `GTM-YYYYMMDD-XXXX` id + PHI-field sweep); **print view not built** |
| AC-10 no checkable visual claim in any mad-lib string | ◑ | `AC-10 · no producible string…` (1008 strings) + planted-violation control; **live intro still ships pre-redesign copy** |
| AC-11 tier = f(over-cap, pass independence) only | ✔ | `AC-11 (A2) · an all-staff-prompted trial is Tier 3`, `…(E) marks never move it`, `…tier boundaries` |
| AC-12 whose-turn visible in every turn-map style | ✗ | not started |
| AC-13 theme dropdown absent, pet/hero unreachable | ◑ | pet stage block deleted (§1.3); **dropdown still present** |
| AC-14 (E) logs, changes nothing, undoable | ◑ | `AC-14 · an (E) mark logs…`; **UI button pending** |
| AC-15 ask-back reachable on a counted partner turn | ◑ | `AC-15 · the ask-back is reachable…` (all 3 cue levels); **UI pending** |
| AC-16 all-repetition trial terminates, prints incomplete, no deadlock | ✔ | `AC-16 (A4) · an all-repetition trial…` |
| AC-17 cap equals auto-scaled budget, never rises | ✔ | `AC-17 (A5) · the enforced cap…` — caps `[3,3,3,3]`, 24 refusals |
| AC-18 Tier-1 line on an incomplete look, no completion claim | ✔ | `AC-18 (C1) · perfect turn-taking on an INCOMPLETE look…` (tier axis) + `AC-18 · School picture day…` (text axis) |
| AC-19 early sub-budget pass → `independent`, actions-used recorded | ✔ | `AC-19 (B3) · an early voluntary pass…` (used=1, unspent=2) |
| AC-20 0-action run → all `no-engagement`, Tier 3 | ✔ | `AC-20 (C2) · a 0-action pass…` |
| AC-21 sub-budget prompted pass → non-independent | ✔ | `AC-21 (D1) · a sub-budget stall…` (both app and BT paths) |
| AC-22 sub-budget never-pass → `staff-prompted`, no deadlock | ✔ | `AC-22 (D1 corollary) · a sub-budget learner who never passes…` |
| AC-23 BT/at-exhaustion prompt turn-durable; resume cannot launder | ✔ | `AC-23 (E1) · a BT prompt is TURN-DURABLE…` — 3 cases incl. the discardable contrast |
| AC-24 37s silent ask → `prompted@silent` | ✔ | `AC-24 (F1) · a 37s silent ask…` |
| AC-25 ask before onset → recordable `early-ask` | ✔ | `AC-25 (F-33) · an ask while the staff is still actively taking their turn…` |
| AC-26 ask-back forfeit durable; ask-back not tiered | ✔ | `AC-26 · a BT real prompt on the ask-back…` (staff-prompted ask, Tier 1 preserved) |
| **AC-27 (G1 must-test)** | **✔** | see §3 |

### The three motivating defects

| Defect (spec §2) | Status |
|---|---|
| 1. Scoring can't be trusted (37s silent ask scored `independent`) | **closed in the engine** on both F-22 sites — pass (AC-1) and ask-back (AC-24). Not yet reachable through the UI. |
| 2. Violations are invisible (0/43 tools gave feedback at the cap) | **closed in the engine** — the refusal returns kid-facing feedback unconditionally (AC-3). UI toast pending. |
| 3. You can "win" with a blank doll (win counts handoffs) | **closed in the engine** — completion is the staged look, `tokenGoal` plays no part (AC-5/AC-16). Done-screen wiring pending. |

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
**Cheers:** Wow · Look at that · Yes · Amazing · What a team

**Two review questions for the maintainer:**
1. The turn-taking lines name the behaviour plainly ("took a turn and then handed the brush back").
   That is intentional — §3.7 says the outro *names the turn-taking* — but it is the line most likely
   to want a register change for a specific learner. Please confirm the tone.
2. Tier 3's "had a partner for every one of them" is the deliberate encouraging floor. It credits the
   activity, not the learner's performance, so it stays true for a 0-action run. Confirm that is the
   intended floor rather than something warmer.

---

## 5. Not done yet — Tier 1 remainder

The engine and story pool are built and verified; **the game's screens still run the pre-redesign
turn loop.** Wiring is the next unit of work, and until it lands a BT opening the game still sees the
old behaviour. Explicitly outstanding:

1. **Wire the engine into the component's turn lifecycle** — the largest remaining item.
   `handoff()`, `partnerDone()`, `confirmAsk()`, `arm()`/`_capBlocks()` and `go()` must delegate to
   `GlamTT.Trial`; the current `indAsks`/`promptedAsks`/`tokenGoal`/`bonus` state retires. Needs a
   ~250 ms `tick()` interval so prompts are delivered on time.
2. **Over-cap kid feedback in the UI** (AC-3) — a gentle non-red toast, in hidden mode too.
3. **BT affordances** — the "real prompt delivered" control (any turn), the (E) button with its fixed
   3-item picker + undo toast (AC-14), and the always-available end-trial control.
4. **Completion / turns lever** — replace the `tokenGoal` ⭐ win with turns=N + look-complete
   (AC-5/AC-7/AC-16), and derive `setLookComplete` from the existing `_stepDone` task analysis.
5. **Print view** (AC-9, D-H) — per-turn table below the outro story, via the shared
   `NooutcoResults.open()` pattern in `apps/games/results-report.js` (read, confirmed suitable, not
   yet wired; `index.html` does not load it yet).
6. **Mad-lib intro/outro wiring** (AC-10, D-F/D-G) — the live intro still ships the pre-redesign copy
   *"total bedhead, a couple of surprise spots"*, which **violates §3.7.1**; the new congruent strings
   are drafted but not yet on screen. This is the one place the current build is actively
   non-conformant rather than merely un-migrated.
7. **Config cleanup** — remove the theme dropdown (AC-13), make timed partner-only (AC-8), whose-turn
   always visible in every map style (AC-12), fade level → the 3-level `full/gesture/silent` ladder
   the scored enum uses, model dropdown → character lock, wait-window control, extra-time reinforcer
   as non-cap.
8. **Visual-fidelity sweep (§3.9)** — remaining items: sprite-layer alignment across 4 models × all
   steps, malformed colorations/clipping, "Shirt color" category hidden behind the vanity ledge, the
   **"Actions left" meter filling backwards** (confirmed on screen: it reads 0 filled of 3 while the
   banner says "do 3 more"), empty hairstyle button labels, blemish contrast. Per spec §7 this is the
   item to treat as its own pass if it balloons — the clinical core comes first.
   *Already done in this pass:* the 8 console errors (§1.3).
9. **Dead code left in place, on purpose** — `buildV()`, `buildArtLayers()`, the `pet`/`hero` `THEMES`
   entries and the now-unused `personProcedural`/`petArt*`/`sceneFrame` render-values survive the
   template deletions. Removing them is a mechanical simplification pass, deliberately not mixed into
   a change whose risk profile is the scoring rules.
10. **Device sweep** — desktop verified at 1440×900. Tablet and iPhone breakpoints not yet checked
    (spec §3.9 priority order: desktop → tablet → iPhone).

### Explicitly out of scope — Tier 2 (do not build in this run)

Per spec §6 and the run's own instruction, **coordination mode is not started**: random staff-error
injection (extra turn / stall), the peripheral coded staff cue, the conditional block-lift for the
injection, and the staff-marked 3-way catch outcome (D-J / L3). None of it is present, and the Tier-1
engine has no hooks reserved for it beyond the per-turn record being open to extra fields.

---

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
