# Glam Team Makeover — playtest evaluation

**Build under test:** `apps/games/glam-team-makeover/index.html` (unmodified — see *Method*)
**Served from:** `apps/games` at `http://localhost:8788/glam-team-makeover/` — `npx wrangler pages dev .` for playthroughs 1–2, `python3 -m http.server 8788` for playthroughs 3–5 (the game is a static file; see §10 for the one difference this made)
**Driven with:** Playwright (Chromium), scripted playthroughs in a scratch directory that is **not** committed
**Date of run:** 2026-07-24

> **Status — complete.** All five playthroughs were played in a browser and are written up
> below, each from both the client's and the BT's perspective. Every finding in the tables
> below was reproduced in a browser. Nothing here is inferred from reading code alone — code
> references are given only to locate a behaviour that was first observed on screen.

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

2. **The one cue level a BT would use to probe independence silently manufactures perfect
   data.** With give-back = *They "forget" → I ask* and Ask cue = **None (probe)**, the cue timer
   is never started at all, so `cueVisible` can never become true and `confirmAsk()` scores
   `independent = !cueVisible` as **true, always**. I sat in the ask phase for **37 seconds
   without asking** and then tapped "✓ I asked!": scored **independent**. On the next turn I
   tapped it instantly: also **independent**. Final stat line
   *"3 turns handed over · 2 independent asks · 0 prompted asks"* — a perfect score for a
   session in which the learner never once responded on their own.
   (`pt4a-03-ask-phase-cue-none.png`, `pt4a-04-ask-phase-16s-later.png`)

3. **"They forget → I ask" is unreachable whenever the partner turn is counted.** The ask phase
   is only entered from `partnerDone()`, which in a counted partner turn only fires once
   `partnerGoal` newly-charged actions have been spent. I set Their turn = *3 actions*, give-back
   = *They "forget" → I ask*, handed over, and then genuinely did nothing — the partner
   "forgot", which is exactly the condition the program is named after. After 25 seconds the
   phase was still `theirs`, there was no "✓ I asked!" button anywhere on screen (`count = 0`),
   and the only controls were palette tools, the model chips and ⓘ Method. **The program that
   teaches "they forget, so you ask" can only run if the partner does not forget.**
   (`pt4c-B-02-stuck-25s.png`)

4. **Illegal actions are silently swallowed — and in *Count hidden* mode there is no feedback of
   any kind.** At the per-turn cap in *Count shown* mode at least the would-be-new-charge tools
   dim. In **hidden** mode nothing dims: I measured **0 of 43** palette buttons at reduced
   opacity at the cap, then tapped five different tools in a row. Every one armed nothing, applied
   nothing, changed no counter and produced no message. (`pt3-03-t1-at-cap-hidden.png`,
   `pt3-04-t1-over-cap-refused.png`)

5. **While the app waits for the ask, the banner still says THEIR TURN and the palette is live
   but inert.** In the ask phase the big turn banner reads **"THEIR TURN"** in blue while the
   headline directly beneath it reads **"It's really my turn now…"**. All 43 palette buttons stay
   at full opacity; tapping one *does* arm it (`armed: "wash"`) and flips the palette hint to
   **"✋ NOW DO IT ON THE FACE →"** — but no target is ever drawn on the face and no action can be
   taken. The child is told to do a thing that cannot be done, under a label that says it is not
   their turn. (`pt4b-03-ask-tool-armed-no-target.png`)

6. **The "give it back" prompt never fades and is never recorded.** Once the action goal is met,
   the "Done — their turn ▸" button starts a CSS pulse (`animation: gtm-cue`) and pulses forever.
   That is a permanent visual prompt on the target response. The four-level cue fader
   (full → short → icon → none) that the settings expose is wired to a *different* response —
   the ask-for-it-back step — not to relinquishing.

7. **On a phone the pass prompt is off the bottom of the page.** The "Done — their turn ▸"
   button's absolute top is **1316 px** in a 1391 px document with a 667 px viewport. Scrolled to
   the top it is 1316 px below the fold; it is only in view at maximum scroll. Acting on the doll
   scrolls the page *away* from it — after two actions the pulsing button sat 1243 px below the
   viewport top. The one cue for the taught response is unreachable without scrolling.
   (`probe-phone-atcap-scrollpos.png`)

8. **Nothing distinguishes who is touching the screen.** During the partner's turn the whole
   palette stays live and *uncapped by the learner's own goal*. The learner can spend the
   partner's entire turn — and in playthroughs 1 and 3 that is exactly what happened: the
   learner's taps ended the partner's turn for them.

9. **A session can be "won" with the routine barely started.** In playthrough 5 (staged routine,
   8 ⭐ goal) turns 5–8 spent every allowed action re-applying steps that were already ✓ done.
   Each re-application charged a full action against the cap and earned a full star, while the
   number of completed slots on the doll stayed frozen at four — of which only two (wash,
   moisturise) count toward the eleven gated skin-and-makeup steps. The session ended on
   **8/8 ⭐ and "Ta-da — what a team! … the whole look came together just in time"** with no
   makeup, no hair, no outfit and no accessories on the doll. (`pt5-09-final.png`)

10. **The *Turn runway* map removes the whose-turn statement entirely.** Measured in the same
    phase against the Banner map: Banner renders "MY TURN" / "THEIR TURN" plus a plain-language
    instruction ("My turn — add some things!", "Their turn — I wait 🕐"). Runway renders neither —
    only a strip of avatar emoji with a small "NOW" caption under the active one.
    (`probe-turnmap-runway-mine.png` vs `probe-turnmap-banner-mine.png`)

11. **A counted partner turn has no exit control.** There is no button of any kind during the
    partner's turn. The only way out is to perform exactly `partnerGoal` *newly-charged* actions.
    I sat idle for 8 s in playthrough 1 and 25 s in playthrough 4c: nothing changed.

12. **The "Actions left" meter counts the wrong way.** The pips fill as actions are *spent*.
    Three filled dots under the label "ACTIONS LEFT" means **zero** left.

13. **The whole "Shirt color" category is invisible**, the small-phone layout overflows by 88 px,
    and every load emits five SVG console errors. See the findings table.

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

## 4. Playthrough 3 — hidden count, asymmetric turns, free play, on a phone

### Configuration

| Setting | Value |
|---|---|
| Theme | 🎉 Social event |
| Routine | **Free play** |
| Turn map | **Turn runway** |
| My turn | **Count hidden** · 2 actions |
| Their turn | **4 actions** (asymmetric — twice mine) |
| Give-back | They hand it back |
| Ask cue | Icon only |
| Goal | 3 ⭐ |
| Earn more time | **off** |
| Model | **M3** |
| Viewport | **375 × 667 (small phone)** |

**Outcome: reached a real ending** — 3 ⭐ (`pt3-09-done-phone.png`). Stat line:
**3 turns handed over · 0 independent asks · 0 prompted asks**.

### What happened

Free play opens the whole palette at once: 43 tools across seven categories, all at full opacity
from turn 1. The staged reveal of playthrough 1 is gone entirely.

**The cap is enforced with no feedback whatsoever.** I spent the two allowed actions (Wash,
Moisturize) and then measured the palette: **0 of 43 buttons dimmed** — every single one still at
`opacity: 1`. I then tapped five *different* tools in sequence — Treat spots, Conceal, Shape
brows, Contour, Blush rose. For every one of them: `actionsThisTurn` stayed at 2, `ed.cov`,
`ed.col` and `ed.done` were byte-identical before and after, and `armed` stayed `null` — the tool
did not even arm. No message, no shake, no colour change, nothing.
(`pt3-03-t1-at-cap-hidden.png`, `pt3-04-t1-over-cap-refused.png`.) This is strictly worse than
*Count shown*, where at least the blocked tools dim to 45 %.

I then sat at the cap for **8 seconds without passing**. Nothing escalated: no reminder, no
message, no second prompt. The only change from reaching the goal is the pulse on the pass button
— which at that moment sat 862 px below the top of a 667 px viewport, i.e. not visible.

**The runway map drops the whose-turn wording.** Measured against the Banner map in the identical
phase, with everything else equal:

| | Banner | Turn runway |
|---|---|---|
| my turn | "🦸 **MY TURN**" + "My turn — add some things!" | "Turns" + 🦸 / **NOW** / 🧑‍⚕️ / 🦸 strip |
| their turn | "🧑‍⚕️ **THEIR TURN**" + "Their turn — I wait 🕐" + "Their actions" pips | "Turns" + 🦸 / ✓ / 🧑‍⚕️ / **NOW** / … strip |

The runway does convey the sequence — a row of upcoming turns with a "NOW" marker and a ✓ on the
completed one — but it renders **no "MY TURN"/"THEIR TURN" label and no instruction sentence at
all**. Combined with *Count hidden* (which suppresses the pips), the child in this configuration
has no words on screen telling them whose turn it is or how much of it is left. The bottom action
bar's phase message ("They take the same-size turn — I wait.") does survive on both maps.

The asymmetric turn worked exactly as configured: `partnerGoal` went to 4 while my goal stayed 2.
I then played the partner's whole four-action turn myself, as the child, and it ended their turn.

On turn 2 I passed **immediately with zero actions spent**: token awarded (1 → 2), `turnsTaken`
incremented, session advanced — identical to a played-out turn.

### Client (player 1)

* **There is no answer to "whose turn is it?" in words.** The runway strip is emoji-based and its
  only turn signal is a small "NOW" caption under the active avatar. For a learner who is being
  taught turn-taking, this is the weakest of the three maps and it is not flagged as such anywhere
  in setup.
* **Hidden count plus a silent cap is a dead end with no exit sign.** The child does not know how
  many actions they have, is not told when they run out, sees no dimming, and every tap after the
  cap does nothing. Five consecutive dead taps is exactly the pattern that produces escape
  behaviour in session.
* **The pass button is off the bottom of the page.** It sat 862 px below the viewport top at the
  cap in this run, and a separate deterministic measurement (§9) puts its absolute top at 1316 px
  in a 1391 px document with a 667 px viewport — reachable only at the very bottom of the scroll
  range, and acting on the doll scrolls the page away from it. The child would have to scroll a
  long way to find the one control that ends their turn.
* The phone layout also overflows sideways by 88 px, so the setup bar and stage can be swiped
  horizontally out of position.

### BT (player 2)

* **Count hidden removes the BT's ability to see the contingency too.** Standing over the child,
  the BT cannot see how many actions are left either — there is no discreet indicator anywhere.
  The BT has to count taps in their head while also delivering the program.
* **The asymmetric setting is honoured but unlabelled.** Nothing on screen says "their turn is 4
  and yours is 2" during play; on the runway map there is not even a pip row to infer it from.
* **Zero data again.** Five refused over-cap taps, one turn passed with nothing done, four learner
  actions taken on the partner's turn — none of it recorded. Stat line 3 / 0 / 0.
* **Do not run this on a phone.** The pass button is unreachable without scrolling and the
  document overflows.

## 5. Playthrough 4 — "They forget → I ask", across every cue level

This is the only give-back mode in which `indAsks` / `promptedAsks` can move, so it was run as
four browser sessions: **4a** with the cue faded to *None (probe)*, **4b** across *Full* → *Short*
to find the cue boundary, **4c-A** at *Icon only* including a never-ask trial, and **4c-B** with a
counted partner turn.

### Configuration

| Setting | 4a | 4b | 4c-A | 4c-B |
|---|---|---|---|---|
| Turn map | Banner | Banner | Banner | Banner |
| Routine | Free play | Free play | Free play | Free play |
| My turn | Count shown · 2 | Count shown · 2 | Count shown · 2 | Count shown · 2 |
| Their turn | **Timed 20s** | Timed 20s | Timed 20s | **3 actions (counted)** |
| Give-back | **They "forget" → I ask** | same | same | same |
| Ask cue | **None (probe)** | **Full → Short** | **Icon only** | Short |
| Goal | 3 ⭐ | 5 ⭐ | 3 ⭐ | 3 ⭐ |
| Earn more time | off | off | off | off |
| Model | M4 | M4 | M4 | M4 |
| Viewport | 1024 × 768 (tablet landscape) | same | same | same |

**Outcomes:** 4a and 4b both reached a real ending. **4c-B reached a real dead end** and is the
most important result in this report.

### What happened

**The 3.5 s boundary is real and it is the entire measure.** `partnerDone()` enters phase `ask`
with `cueVisible: false` and starts a 3.5 s timer; `confirmAsk()` scores
`independent = !cueVisible`. Reproduced at six latency/cue-level combinations:

| Cue level | Ask latency | `cueVisible` at the moment of asking | Scored |
|---|---|---|---|
| Full | ~4.2 s | true | **prompted** |
| Full | < 1 s | false | **independent** |
| Short | ~4.2 s | true | **prompted** |
| Icon | **~33 s** | true | **prompted** |
| **None** | **~37 s** | **false — the timer is never started** | **independent** |
| **None** | < 1 s | false | **independent** |

The 33-second ask and the 3.6-second ask score identically. There is no latency recorded anywhere,
so a learner who takes half a minute every single time and one who responds in a second produce
the same two numbers.

**Cue level *None (probe)* inverts the measure.** `partnerDone()` only arms the cue timer when
`cueLevel !== 'none'`. With the probe level selected, `cueVisible` is structurally pinned to false
— I sampled it every 2 s for 16 s in the ask phase and it never changed — so **every** ask, at any
latency, is filed as independent. A BT running a probe to check whether the learner still needs
the cue will read *"2 independent asks · 0 prompted asks"* off a session in which the learner sat
silent for 37 seconds.

**Nothing escalates while the app waits.** In 4c-A I sat in the ask phase for 29 s with the icon
cue up, sampling every 5 s: the chip text stayed `🖐️ ➡️`, its animation stayed `gtm-cue`, the
button count stayed 13, the phase stayed `ask`. There is one cue, delivered once, and then the
session waits forever. (`pt4c-A-02-never-asked-29s.png`)

**The ask screen contradicts itself.** Throughout the ask phase (`pt4b-03-ask-tool-armed-no-target.png`):

* the turn banner reads **"THEIR TURN"** in blue with the clinician avatar, because
  `whoseMe = isMine || isReady` and the ask phase is neither;
* the headline directly beneath reads **"It's really my turn now…"**;
* the bottom bar reads **"Their turn ran long — time to ask for my turn."** — even though in this
  configuration the partner's turn ended exactly on its 20 s clock and did not run long;
* all **43 palette buttons are at full opacity**; tapping *Wash* set `armed: "wash"` and changed
  the palette hint to **"✋ NOW DO IT ON THE FACE →"**, while `targets` on the doll stayed at **0**.
  Nothing can be done and nothing says so.
* the cue chip before the cue fires is a **30 × 22 px empty dashed grey box**; when the cue fires
  it becomes a 248 × 43 px amber chip, shifting the row.

**4c-B — the dead end.** Their turn = *3 actions*, give-back = *They "forget" → I ask*. I handed
over and then had the partner do what the setting is named for: forget. Nothing was touched.
Sampled every 5 s for 25 s — phase stayed `theirs`, `actionsThisTurn` stayed 0, and the visible
buttons were exactly `ⓘ Method | M1 | M2 | M3 | M4 | 1 | 2 | 3 | 4 | 5 | 6 | 7`. **The "✓ I asked!"
button does not exist in this phase** (queried: 0 matches). The only escape is for someone to
spend the partner's three actions — I then did, and the ask phase appeared immediately. So the
ask-for-it-back program is reachable **only** when the partner completes their turn properly,
which is the opposite of the scenario the setting describes.

### Client (player 1)

* **The turn label says the wrong thing at the exact moment it matters most.** The child is being
  taught to notice "it is my turn again and they have not given it back" — and the biggest element
  on the screen at that moment says **THEIR TURN**.
* **A live palette that refuses everything.** 43 bright buttons, a tool that visibly arms, and a
  hint that says to do it on the face, with nothing on the face to touch. This is the same silent
  refusal as the over-cap case, in a phase where the child has *nothing else to do* while waiting.
* **With cue = None the child is given nothing at all** — an empty dashed placeholder box next to
  a "✓ I asked!" button — and can wait indefinitely with no consequence.
* When the cue does fire it is clear and well-graded: the full sentence
  *I say: "It's my turn now, please."*, the short *"My turn, please."*, and the icon `🖐️ ➡️`,
  all in an amber pulsing chip. The fading ladder itself is good.
* In 4c-B the child is left in front of a frozen screen with no legal action at all.

### BT (player 2)

* **The probe level produces false-positive independence.** This is the most damaging finding for
  the BT: the setting whose purpose is to test whether the prompt can be removed is the one that
  guarantees the data will say yes.
* **"Independent" here means "the BT tapped the button within 3.5 s"**, not "the learner responded
  independently". `confirmAsk()` is a button on the shared screen with nothing tying it to who
  spoke; the BT must tap it, and the score is decided by their reaction time as much as the
  child's.
* **No latency, no per-trial record.** Two session totals. The BT cannot see which trials were
  independent, in what order, or how long each took — so they cannot see a fading trend, which is
  the whole point of the measure.
* **The give-back setting is a trap when paired with a counted partner turn.** A BT who selects
  *They "forget" → I ask* with Their turn = 2/3/4 actions has built a session that can never reach
  the response they are teaching, and nothing warns them.
* **Positive:** the ask cue level *can* be changed mid-session. Opening the header ▸ toggle
  mid-play and switching *Full* → *Short* took effect on the next ask phase with no state loss,
  which is exactly what within-session fading needs. (`pt4b-05-settings-open-mid-session.png`)
* **The "ran long" message is wrong** in the timed configuration and will mislead anyone reading
  the screen for what happened.

## 6. Playthrough 5 — the theme axis is unreachable; a staged 8 ⭐ run instead

### The blocked half, stated plainly

The objective calls for a run on a non-default theme. **There is no reachable non-default theme.**
Read directly off the live dropdown at the start of this run:

```
THEME OPTIONS :: ["social:🎉 Social event"]
```

Exactly one `<option>`. The build's theme table defines `social`, `pet` and `hero`, and the render
path has a whole `base === 'pet'` branch, but neither is selectable from the UI. This half of the
playthrough has no configuration to run and was not simulated. See F-19.

All four models were played end to end across this evaluation (M2 in PT1 and here, M1 in PT2,
M3 in PT3, M4 in PT4), so the model half is covered.

### Configuration

| Setting | Value |
|---|---|
| Theme | 🎉 Social event *(forced — the only option)* |
| Routine | **Staged (in order)** |
| Turn map | Vanity stations |
| My turn | Count shown · **1 action** (the minimum) |
| Their turn | **2 actions** |
| Give-back | They hand it back |
| Ask cue | Full sentence |
| Goal | **8 ⭐** (the maximum) |
| Earn more time | **on** |
| Model | M2 |
| Viewport | 768 × 1024 (tablet portrait) |

**Outcome: reached a real ending** — 8/8 ⭐ in 8 turns, 1 min 07 s. Stat line:
**8 turns handed over · 0 independent asks · 0 prompted asks**.

### What happened

**The "Earn more time" bonus quadrupled the configured turn size.** The BT set 1 action per turn —
the lowest response requirement the app offers, the setting you would choose for a learner who
cannot yet tolerate a long turn. Measured per turn:

| Turn | `bonus` | Effective cap | Setup bar still reads |
|---|---|---|---|
| 1 | 0 | **1** | 1 |
| 2 | 1 | **2** | 1 |
| 3 | 2 | **3** | 1 |
| 4–8 | 3 (capped) | **4** | 1 |

By the fourth turn the learner is required to do four things before they may hand over, on a
setting that says one. The only surface for this is the pip row and the "do N more!" sentence;
the setup bar never changes, and in the Vanity-stations map used here there are no pips at all.

**A star is awarded for re-doing work.** From turn 5 on, every action I took was on a tool already
marked ✓ (`✓ Wash`, `✓ Moisturize`, `✓ Shape brows`, `✓ Brow pencil`). Each re-application charged
a full action against the cap — `actionsThisTurn` went 0 → 1 → 2 → 3 → 4 exactly as if new work
were being done — while the count of completed routine slots stayed frozen at **4**. Four turns and
sixteen actions produced no change to the doll and four more stars.

To be exact about what this does and does not show: two un-done skincare steps (*Treat spots*,
*Conceal*) were on the palette and available the whole time; my driver skipped them because their
per-tap mechanic is awkward to script. So this is **not** a claim that the app forces the
degenerate pattern — it is a demonstration that the app fully rewards it. A child who keeps tapping
the first, largest, leftmost button (*Wash*) gets exactly the same stars, the same "do 4 more!"
progression and the same ending as a child who works through the routine.

**The session ended on a claim that was not true.** 8/8 ⭐ and *"Ta-da — what a team! Everyone took
turns and the whole look came together just in time."* on a doll that had been washed,
moisturised, brow-shaped and brow-pencilled. Of the eleven gated skin-and-makeup steps
(`_stepDone(1..11)`, `index.html:487`) exactly **two** were done — wash and moisturise; brow shape
and brow pencil are explicitly untracked by the gate. No makeup, no hair, no outfit, no
accessories. (`pt5-09-final.png`)

**The done screen does not show the work.** The celebration card replaces the entire stage: no
doll, no "Our makeover" panel, nothing. The child's finished look is gone at the exact moment they
are being reinforced for it. (`pt5-09-final.png`)

**Staged gating behaved as in playthrough 1**, and the partner's actions advance it: turn 1 opened
with three tools (Wash / Shape brows / Brow pencil) and the *partner's* Moisturize on their turn 1
unlocked Treat spots and Conceal for the learner's turn 2. Tablet portrait had zero overflow
throughout (768/768, 1024/1024).

### Client (player 1)

* **The turn gets longer without warning.** Set to one action, the child is asked for two on turn
  2, three on turn 3 and four on turn 4. There is nothing on screen that explains why, and on the
  Vanity map there is not even a pip row to see it coming. For a learner placed at 1 action
  precisely because longer turns are hard, this is an unannounced escalation.
* **Repeating a finished step is rewarded identically to doing the next one.** Nothing on the
  screen distinguishes "you already did this" from "this is worth doing" beyond a small ✓ on the
  button — the button is not dimmed, not moved, not deprioritised, and it still costs and still
  counts.
* **The celebration hides the doll.** The one thing the child worked on for eight turns is not on
  the screen that celebrates it.
* Whose turn it is was legible throughout on the Vanity map ("MY TURN"/"THEIR TURN" plus the two
  station cards), consistent with playthrough 2.

### BT (player 2)

* **The configured response requirement is not what runs.** "Earn more time" is on by default and
  in count modes it silently multiplies the action goal — ×4 here. A BT reading the setup bar
  mid-session sees "1" and is watching a four-action turn.
* **Nothing distinguishes productive turns from filler.** Eight identical "turn handed over"
  events; four of them advanced the routine and four re-did completed steps. The stat line cannot
  tell them apart, and there is no per-turn record.
* **8 ⭐ is a long session with no mid-session read-out.** The only data surface is the ⓘ Method
  modal at the end.
* **The outcome text over-claims.** It asserts the look came together; a BT showing this screen to
  a parent or writing a session note off it would be reporting something that did not happen.
* Setup at 8 ⭐ / 1 action / staged took seconds; the setup bar is genuinely fast to drive.

---

## 7. Turn-taking and prompt fading — the clinical target

The intended contingency is: **detect + flag → refuse → prompt to pass**, and score the pass
itself as independent or prompted.

### 7.1 What the build actually does

| Target behaviour | Observed behaviour | Verdict |
|---|---|---|
| An out-of-turn / over-cap attempt is **detected and flagged** as a datum | Nothing is recorded anywhere. 8 refused taps in playthrough 1, 5 in playthrough 3, 1 per turn in playthrough 5; every counter byte-identical before and after | **Absent** |
| The attempt is **refused** | Refused, yes — but only in count modes. In *Timed* mode there is no cap at all (playthrough 2: 5 actions on a goal of 3) | **Partial** |
| The learner is **prompted to pass** | No prompt is emitted on a refused attempt. The banner does change to "All set — now I hand it over!" when the goal is met, and the handoff button starts pulsing — but that happens on reaching the goal, not on over-reaching, it is the same in every session forever, and on a phone it is 1316 px below the fold | **Absent** |
| Passing unprompted is scored **INDEPENDENT** | Not scored. `handoff()` increments `turnsTaken` and nothing else | **Absent** |
| Passing only after a prompt is scored **PROMPTED** | Not scored | **Absent** |
| The pass prompt **fades** across sessions | The pulse on "Done — their turn ▸" is unconditional and permanent whenever the goal is met | **Absent** |

### 7.2 The fading machinery exists, but on the wrong response — and it can be inverted

`indAsks` / `promptedAsks` are the only prompt-fading measure in the build, and they score the
**ask-for-it-back** step, not the relinquish step. Four consequences confirmed by playing:

* With give-back set to **"They hand it back"** — the setting most likely to be used early in
  teaching — the ask phase never runs, so both counters are structurally frozen at 0. Playthroughs
  1, 2, 3 and 5 all ended with *"N turns handed over · 0 independent asks · 0 prompted asks."*
* With give-back set to **They "forget" → I ask** *and* a **counted** partner turn, the ask phase
  is unreachable: `partnerDone()` (`index.html:583`) only runs from `afterAction()` once
  `partnerGoal` charged actions are spent. A partner who actually forgets leaves the app in phase
  `theirs` indefinitely — 25 s sampled, no change, no ask control on screen (playthrough 4c-B).
* With cue level **None (probe)**, `partnerDone()` never arms the cue timer, so `cueVisible` is
  permanently false and `confirmAsk()`'s `independent = !cueVisible` is permanently **true**.
  Every ask is scored independent regardless of latency; a 37 s silent wait and an instant tap are
  indistinguishable (playthrough 4a). The probe condition cannot fail.
* Where the measure does work (cue = full / short / icon), it is a **binary at 3.5 s with no
  latency stored**: an ask at 3.6 s and an ask at 33 s are both simply "prompted".
* The pass step, which is the response the pulsing button prompts, has no counterpart counters
  at all.

### 7.2b Who presses "✓ I asked!"

`confirmAsk()` is an ordinary button on the shared screen. Nothing binds it to a verbal response,
to the learner rather than the BT, or to any observed behaviour. In practice the BT taps it, so
"independent" records **the BT's reaction time inside a 3.5 s window**, not the learner's
independence. There is also no way to record an ask that happens *too early* — during phase
`theirs` the button does not exist (verified: 0 matches in the DOM), so an interrupting ask, which
is a clinically meaningful error, cannot be captured at all.

### 7.3 Who is touching the screen is not modelled

During the partner's turn the palette is fully live, every tool is bright, and there is no
per-actor gate. In playthrough 1 the learner patched a blemish on the partner's turn and it
applied; two further learner actions ended the partner's turn. In playthrough 2 the learner took
four actions on the partner's 20 s clock. In playthrough 3 the learner spent the partner's entire
asymmetric four-action turn. The app cannot tell — and does not ask — whether the device changed
hands.

The same gap appears in phase `ask`: all 43 palette buttons stay at full opacity and a tool will
arm, but no target renders and no action applies. So the wait-and-ask step is "protected" by the
same silent no-op used everywhere else, rather than by a visible boundary.

### 7.4 Data the BT needs and cannot get

None of the following is available anywhere in the UI, the Method panel, or any export:

* count of **refused / over-cap attempts** per turn and per session (the core "detect and flag" datum);
* count of **touches during the partner's turn**, and of touches during the ask phase;
* **independent vs prompted relinquishes** — the prompt-fading measure for the taught response;
* **latency to pass** after the goal is met (i.e. how long the pulse ran before the child passed);
* **latency to ask** — the ask *is* scored, but only as a binary side-effect of a 3.5 s timer, so
  a 3.6 s response and a 33 s response are recorded identically;
* whether an ask was **too early** (during the partner's turn) — unrecordable, no control exists;
* whether a turn was passed **early with actions unspent**, versus played out;
* whether a turn's actions **advanced the routine** or re-did already-completed steps (playthrough
  5: four consecutive turns of pure repetition scored the same as four productive turns);
* the **effective** action cap in force, once "Earn more time" has inflated it — the setup bar keeps
  showing the configured number;
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
| **375 × 667 (small phone)** | **7 rows** | **88 px** | **no** — stage scrolled to y −241 | **no** — absolute top 1316 px in a 667 px viewport | 82 × 82 px |

Touch targets are comfortable for a child everywhere (82 × 82 px, well above the 44 px guideline).
The two tablet orientations — the stated in-session form factor — are sound. The small-phone
layout is not usable: the setup bar alone consumes 7 rows, the document overflows sideways by
88 px, and the doll is pushed out of the viewport.

**The phone measurement of the pass button, made without any driver-induced scrolling**
(`probe-runway.mjs`, `probe-phone-atcap-scrollpos.png`):

| Moment | `scrollY` | Button top, viewport-relative | In view | Pulsing |
|---|---|---|---|---|
| start of my turn, page at max scroll | 724 | 592 | yes | no |
| after two actions on the doll | 73 | **1243** | **no** | yes |
| forced to the top of the page, still at the cap | 0 | **1316** | **no** | yes |

The document is 1391 px tall and the viewport 667 px, so the button is only ever reachable at the
very bottom of the scroll range — and interacting with the doll moves the page away from it. The
button is pulsing the whole time, where nobody can see it.

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
design-canvas runtime substitutes them. **Zero page exceptions** (`pageerror`) in any run. No
crash, freeze or blank screen was seen at any point.

**Correction to the network claim in the first pass of this report.** Playthroughs 1–2 were served
by `wrangler pages dev` and recorded zero requests at HTTP ≥ 400. Playthroughs 3–5 were served by
`python3 -m http.server` from `apps/games` (a plain static server — the game is a static file), and
every load there records **three HTTP 404s**, all for `{{ }}` placeholders that reached the network
layer un-substituted:

```
HTTP 404 /glam-team-makeover/%7B%7B%20sceneFrame%20%7D%7D
HTTP 404 /glam-team-makeover/%7B%7B%20petArtBase%20%7D%7D
HTTP 404 /glam-team-makeover/%7B%7B%20ly.src%20%7D%7D
```

Same root cause as the five SVG errors: the raw template markup is parsed by the browser before
the runtime substitutes it, and three of those placeholders sit in `src` attributes, so the browser
issues real requests for them. Whether they surface as 404s depends on the server's handling of
unknown paths, which is why the first pass did not see them. They are three wasted requests per
load on any server, and on a static host they are three 404s in the log.

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
| F-22 | blocking | clinical | Ask cue = "None (probe)", `index.html:584` | Give-back = They "forget" → I ask, Their turn = Timed 20s, Ask cue = None. Hand over, let the 20 s run out, sit in the ask phase 37 s without doing anything, then tap "✓ I asked!" → `indAsks` +1. Next turn tap it in under 1 s → `indAsks` +1. Stat line "2 independent asks · 0 prompted asks". `cueVisible` sampled every 2 s for 16 s: never true, because the cue timer is only armed when `cueLevel !== 'none'` | BT — the probe condition can only ever report independence; client — no cue and no consequence for never responding |
| F-23 | blocking | bad state | `partnerDone()` `index.html:583` + `afterAction()` `:515` | Give-back = They "forget" → I ask, Their turn = **3 actions**. Hand over, then touch nothing. Sampled at 5/10/15/20/25 s: phase stays `theirs`, `actionsThisTurn` 0, no "✓ I asked!" button in the DOM (0 matches), visible controls are only `ⓘ Method`, M1–M4 and the 7 hairstyle digits. Spending the partner's 3 actions is the only exit and does then reach phase `ask` | Both — the configuration that names the "forget" scenario deadlocks on the forget; BT builds a session that cannot reach the taught response |
| F-24 | major | UX | turn banner in phase `ask`, `index.html:955` | Reach the ask phase in any give-back = forgets config. The banner reads "🧑‍⚕️ THEIR TURN" (because `whoseMe` is true only for phases `mine` and `ready`, and `ask` is neither) while the headline beneath reads "It's really my turn now…" | Client — the largest turn signal on screen contradicts the instruction at the moment the response is required |
| F-25 | major | bad state | palette during phase `ask`, `canAct` `index.html:984` | In the ask phase, measure the palette: 43 of 43 buttons at `opacity: 1`. Click "Wash": `armed` becomes `"wash"` and the palette hint changes to "✋ NOW DO IT ON THE FACE →", but `document.querySelectorAll('div[style*="gtm-target"]')` = 0 and `actionsThisTurn` does not move | Client — told to act, given nothing to act on, refused silently; BT — the touches are not recorded either |
| F-26 | major | UX | cap feedback in `hidden` mode, `capDim` `index.html:1024` | Count hidden, goal 2. Spend 2 actions. Measure the palette: **0 of 43** buttons dimmed. Tap five different tools in sequence (Treat spots, Conceal, Shape brows, Contour, Blush rose): `actionsThisTurn` stays 2, `ed.cov`/`ed.col`/`ed.done` unchanged, `armed` stays null, nothing on screen changes | Both — hidden mode removes the only remaining cap feedback; BT cannot see the boundary either |
| F-27 | major | compat | "Done — their turn ▸", 375 × 667 | Load at 375 × 667, start a turn, do two actions on the doll. Button absolute top = 1316 px, document height 1391 px, viewport 667 px. Scrolled to the top the button is 1316 px below the fold; after acting on the doll (`scrollY` 73) it is 1243 px below. It pulses the whole time | Both — the pass cue, the whole point of the program, is off-screen on a phone |
| F-28 | major | UX | Turn runway map, `index.html:101-120` | Set Turn map = Turn runway. In phase `mine` and phase `theirs`, dump visible text: no "MY TURN"/"THEIR TURN" label and no instruction sentence render at all — only "Turns", an avatar strip with a "NOW" caption, and the token count. The same config on Banner renders both | Client — no words for whose turn it is; worst of the three maps for the taught skill |
| F-29 | major | workflow | charge keys vs. `ed.done`, `index.html:530,:546` | Staged, goal 1, extra time on, 8 ⭐. From turn 5 on, spend every action re-applying tools already marked ✓. Each charges a full action (`actionsThisTurn` 0→4) and each turn awards a star, while the completed-slot count stays at 4. Session ends 8/8 ⭐ with 2 of the 11 gated skin/makeup steps done and no hair, outfit or accessories | Client — repetition reinforced identically to progress; BT — turns that advanced nothing are indistinguishable in the data |
| F-30 | major | UX | outcome card, `index.html` THEMES `social.outcome` | Finish any session without completing the routine. The card reads "Ta-da — what a team! Everyone took turns and **the whole look came together just in time**" regardless of what is actually on the doll | BT — a screen that over-claims and would be wrong in a session note; client — praise not contingent on the work |
| F-31 | minor | UX | done screen, `showGame` `index.html:1093` | Reach the goal. The celebration card replaces the entire stage: no doll, no "Our makeover" panel. The finished look is not visible on the screen that celebrates it | Client — the product of eight turns disappears at the moment of reinforcement |
| F-32 | minor | clinical | `confirmAsk()` `index.html:586` | Ask at ~3.6 s and at ~33 s with cue = icon: both recorded as one `promptedAsks`. No latency is stored anywhere, and no per-trial record exists — only two session totals | BT — cannot see a fading trend, which is the purpose of the measure |
| F-33 | minor | clinical | phase `theirs` controls | During the partner's turn, query for an ask control: 0 matches. An ask made before the partner finishes — a clinically meaningful error — cannot be recorded | BT — the error side of the response class is invisible |
| F-34 | minor | UX | ask-phase message, `index.html:977` | Set Their turn = Timed 20s, give-back = forgets. Let the clock expire exactly on time. The bottom bar reads "Their turn ran long — time to ask for my turn." although the turn ended precisely on schedule | Both — the on-screen account of what happened is wrong |
| F-35 | minor | UX | cue chip placeholder, `index.html:982` | Enter the ask phase. Before 3.5 s the chip is a 30 × 22 px empty dashed grey box; at 3.5 s it becomes a 248 × 43 px amber chip (full-sentence level), shifting the row. At cue level "None" the empty box is shown permanently | Client — a meaningless placeholder plus a layout jump at the cue |
| F-36 | minor | workflow | "Earn more time" in count modes, `index.html:481,:578` | Set My turn = Count shown, **1 action**, Earn more time on. Measured caps: turn 1 = 1, turn 2 = 2, turn 3 = 3, turns 4–8 = 4 (bonus caps at 3). The setup bar still reads "1" throughout | BT — the response requirement quadruples without the setting changing; client — an unannounced escalation on the lowest setting |
| F-37 | minor | crash-adjacent | `{{ }}` in `src` attributes, `index.html` scene/pet/layer images | Load the page from a plain static server (`python3 -m http.server`) with the network panel open. Three HTTP 404s per load for `%7B%7B%20sceneFrame%20%7D%7D`, `%7B%7B%20petArtBase%20%7D%7D`, `%7B%7B%20ly.src%20%7D%7D`. Under `wrangler pages dev` these did not surface as ≥ 400 | BT — wasted requests every load and 404 noise in any static host's log |

---

## 12. Not tested

Stated as gaps rather than guessed at. All five playthroughs were run; what follows is what
remains untested *within* and *around* them.

**Blocked, not skipped**

* **The pet-show and hero themes.** The Theme dropdown ships exactly one option (`social`),
  verified live in playthrough 5. Both themes exist in the build's theme table and `buildV()` has
  a whole `base === 'pet'` render branch, none of which can be reached from the UI. The
  "non-default theme" half of playthrough 5 has no configuration to run, so nothing is reported
  about it. See F-19.

**Settings not exercised**

* **Their turn = "Timed 30s"** — the 20 s timed partner turn was used in playthroughs 2 and 4;
  the 30 s option was never selected. **Their turn = "2 actions"** was used (playthrough 5) and
  **"4 actions"** (playthrough 3); **"3 actions"** only in the dead-end probe 4c-B, not to an
  ending.
* **Token goal 5 ⭐** was used only in playthrough 4b, which ended on the goal but whose turns
  were scripted around the ask phase rather than played for content.
* **My turn action goals 4 and 5.** Goals of 1, 2 and 3 were played; 4 and 5 were not.
* **Count hidden combined with the Banner map** — hidden mode was only played on the runway map,
  so I did not confirm what the Banner map shows when the pips are suppressed.

**Behaviours not exercised**

* The **⭐ Finish & SR** button on the done screen, and `window.NooutcoReward.celebrate` /
  `openSR` — not clicked in any run.
* **↺ Play again** and whether it correctly resets counters mid-device-session.
* Whether opening the setup bar mid-session exposes the **▶ Play** button and whether pressing it
  silently destroys the running session's tokens/turn/ask counters. The setup bar *was* opened
  mid-session in playthrough 4b (to fade the cue, which worked cleanly), but the Play button was
  not pressed.
* Changing **structural** settings mid-session — token goal, action goal, give-back mode, partner
  turn type — and whether they apply live or corrupt state. Only the **ask cue level** was changed
  mid-session, and only that one is reported as safe.
* Whether a **"forgets" give-back with a counted partner turn** has any escape other than spending
  the partner's actions — e.g. a page reload preserving state, or a timeout longer than the 25 s I
  sampled. I sampled 25 s and stopped.
* Whether the **over-cap refusal is reported to any analytics or storage layer** off-screen. I
  observed only the DOM and the component's own state; I did not inspect `localStorage`, network
  writes, or the games worker.
* Real **touch** input, multi-touch, and pointer-cancel on the drag/paint tools. All input in this
  evaluation was synthetic mouse input from Chromium.
* **Firefox and WebKit.** Only Chromium was used. The repo's Playwright config defines Firefox and
  WebKit projects; they were not run.
* **Screen readers, keyboard-only navigation and reduced-motion.** Not assessed. Note in passing
  that the pulsing cue animations have no reduced-motion guard, but this was not verified against
  a `prefers-reduced-motion` media setting.
* **Offline / deployed behaviour.** Everything was run against a local server.
* **Long sessions.** The longest run was eight turns over ~1 minute of wall clock; no soak test for
  timer drift, memory growth or canvas cache growth.
* **Art fidelity in playthroughs 3–5 was not re-measured.** The paper-doll findings in §8 come from
  the dedicated per-model sweep; playthroughs 3–5 were driven for turn-taking behaviour and their
  screenshots were not pixel-diffed.

---

## Method

Served from `apps/games` at port 8788 — `npx wrangler pages dev .` for playthroughs 1–2 and
`python3 -m http.server 8788` for playthroughs 3–5. The game is a single self-contained static
file, so both serve identical bytes; the only observed difference is how unknown paths are handled,
which is why the three `{{ }}` image 404s in §10 appear under one server and not the other.
Driven with Playwright Chromium from throwaway scripts under
`.gnhf/runs/objective-produce-an-e923a7/scratch/` (git-excluded, not committed). Console messages,
page exceptions, failed requests and HTTP ≥ 400 responses were captured for every run. Internal
counters quoted in this report (`actionsThisTurn`, `chargedThisTurn`, `turnsTaken`, `indAsks`,
`promptedAsks`, `bonus`) were read out of the mounted component's React state **read-only**, to
corroborate what was visible on screen; every finding also states its on-screen symptom.

**No file under `apps/games/glam-team-makeover/` was modified.** No existing spec file was
modified. Verified with `git status` before and after the run.
