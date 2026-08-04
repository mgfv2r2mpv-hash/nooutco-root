# Glam Team Makeover - Redesign Spec

**Status:** grilled + parameters approved; pending `/adv-review`, then tiered build.
**Repo:** `nooutco-root` · **File:** `apps/games/glam-team-makeover/index.html` (one self-contained ~114KB file: vendored React + a `{{ }}`/`<sc-if>` template layer + one component class).
**Build shape:** fresh branch off the clean base, committed, not pushed. Tiered GNHF in Companion mode. Evaluation of the current build lives in `docs/eval/glam-team-makeover-playtest.md` (37 findings).

---

## 1. Goal

Turn the game from a turn-taking *activity with no data capture* into a **clinical task-analysis (TA) trial tool** that honestly measures a learner's (player 1's) turn-taking, usable in session by an SAP and a supervising BCBA - **a tool, not a replacement for ABA therapy**. Along the way, make gameplay smoother, cleaner, and visually aligned.

Two players, **one device, taking turns**:
- **Player 1 - learner/client.** The child; the makeover is the motivating shared activity.
- **Player 2 - BT.** Runs the program *and* takes the partner turns.

## 2. The three defects that motivate the rebuild (from the eval)

1. **Scoring can't be trusted.** With the ask cue set to *None*, a pass 37s late still scored `independent` (`confirmAsk` computes `independent = !cueVisible`, and cue=none never sets `cueVisible`). The one setting a BT would use to probe independence manufactured a perfect score.
2. **Violations are invisible.** At the action cap in hidden-count mode, 0/43 tools gave any feedback; over-cap taps did nothing, said nothing, logged nothing.
3. **You can "win" with a blank doll.** Winning counts handoffs (`tokenGoal`), not makeover progress, so a full celebration fired over an unfinished look.

---

## 3. Locked decisions

### 3.1 Measurement spine (Q1)
- Session = an **append-only event log**. The clinical unit is a **trial** = one full playthrough (one makeover).
- Independent/prompted is recorded **per turn**, never as a running total, so a **fade curve** across turns survives into the report.
- The per-turn table (§4) is the human-readable render of this log.

### 3.2 Independent vs prompted (Q2) - HARDENED by adversarial review (A1/B2/B3/C2/D1/E1)
> The authoritative, adversary-tested criteria are **D-A, AC-1, AC-2, AC-4, AC-17, AC-19 - AC-23** in `docs/glam-team-makeover-redesign-hardened-claims.md`. The below is the prose the build follows; where any earlier draft wording conflicts, the hardened claims win.

- The action budget is a **cap, not a quota** - the learner may pass at any time, including with actions to spare (an **early voluntary relinquish** is the *stronger* behavior and must score, not be blocked). Pass is a **learner-operated** control available throughout the turn.
- A **possession floor:** a scored relinquish requires **≥1 engaged action**. A 0-action pass is a distinct **`no-engagement`** code, never `independent` (an all-0-action run → Tier 3).
- The wait-window / prompt ladder is **anchored to possession-taken + a no-relinquish idle interval** (measured from the learner's most recent action) - **not** budget-exhaustion. Budget-exhaustion is just the special case where the learner cannot resume.
- **`independent`** iff the pass precedes **every** prompt - the app's faded cue **and** any **BT real prompt** - and no turn-durable forfeit flag is set. Gated on *any* prompt, not just the app's.
- **Forfeit flag is turn-durable** (like the over-cap flag): set by any **BT real prompt** or any prompt **at/after budget-exhaustion**, and a resume-action does **not** clear it (kills the E1 resume-launder). Only a **sub-budget app-faded cue during a genuine mid-task pause** stays discardable by a real resume (the accepted L8 case).
- After a prompt: **`prompted@level`** (full / gesture / silent-probe). At **silent-probe** the "prompt" is delivered by window-elapse, so a silent stall still scores prompted - never a free `independent` (kills the cue=none analog on the pass).
- **Never passes →** `staff-prompted` (defined at any budget level, sub-budget included - **no own-turn deadlock**).
- **Both** the **pass** and the **ask-back** are scored - see **§3.2b**. The **pass is primary** and is built + verified first.

### 3.2b Ask-back scoring (F1/G1) - the original F-22 site, now hardened
> Authoritative: **D-K, AC-15, AC-24 - AC-27** in the hardened-claims doc. The eval's headline defect (37s silent ask scored `independent`) lived on the **ask-back** (`confirmAsk`, index.html:586), which the pre-debate spec left with only a *reachability* criterion. It now gets the full model:
- Window **anchored to the staff-idle "forget" onset** (staff holds possession without acting **or** handing back for the wait interval) - **not** staff-actions-spent, so the "staff genuinely forgets (0 actions)" case opens the window instead of deadlocking (**AC-27**; verify the counted+forgets+0-action path in Playwright - the one G1 fix not re-tested by a final adversary round).
- Independence gated on **any** prompt (app cue or BT real prompt) with the same **turn-durable forfeit** rule; at silent-probe the window-elapse delivers the prompt → a 37s silent ask scores **`prompted@silent`**, never `independent` (**AC-24**, F-22 killed on its own site).
- An ask **before** the staff-idle onset is a recordable **`early-ask`** code (also fixes eval F-33).
- The ask-back is **reported, not tiered** (per §3.7 lock and the maintainer's sign-off) - measured and printed, but it does **not** drive the child-facing outro tier.

### 3.3 Illegal-action handling (Q3) - HARDENED (A3/B2)
- Over-cap attempt (learner, own turn) → **refuse** (no effect) + **log** the attempt + set the **turn-durable forfeit flag** (decoupled from cue visibility, so it holds at silent-probe too) + deliver the pass prompt. Forfeiture is **per-turn** (not per-trial - that preserves the per-turn fade curve; AC-4).
- Refusal gives **gentle, kid-friendly feedback in every count mode** (fixes the silent hidden-mode cap). Never a red error; no clinical labels on the child's screen.
- Per turn: **count** of over-cap attempts + derived **"stayed within limit: yes/no."**
- Acting during the *staff's* turn is not machine-distinguishable (one device) → routed to the **(E) button** (§3.4).

### 3.4 The (E) button (Q4)
- Small, muted, **always available** in a consistent corner, every phase. Opens a **fixed 3-item picker**: **Took turn by force · Interfering behavior · Other.**
- Logs `{timestamp, phase/trial, whose turn}` only. **Never alters** gameplay, the doll, or any score. "logged ✓ undo" toast.
- **Fixed, generic, NO freeform** - PHI-safe. Distinct event type from machine-caught over-cap attempts.
- **Governing principle:** the game logs codes; the program holds the definitions and the identity. *The data accompanies a program; it does not contain one.*

### 3.5 Coordination mode - TIER 2 (Q5)
- App randomly cues the **staff** (peripheral **coded symbol**, legible to the trained BT, meaningless to the learner) to model an error: **take an extra turn** or **stall / get distracted**.
- The extra-action **block lifts only for the injection**, so the violation the learner must catch is real and on-screen.
- The learner's "catch" is a social act the machine can't see → **staff-marked 3-way**: *caught & redirected · no response · responded but off.* That's the coordination datum.
- Cleanly separable; layered on **after Tier 1 verifies**.

### 3.6 Data sink - print view (Q6)
- Deliverable is a **print-to-PDF view**, matching the other No Outcome tools (mirror their existing print pattern - verify before wiring).
- The **per-turn results table sits below the outro story** on the print page.
- **No ID, no learner input, no identifying info** - just results. Auto session id + date/time only. The human prints and enters it into the clinical system.
- **No in-game persistence to build**: the printed page is the export; the trial log renders into the table.

### 3.7 Character, pretext, outro (Q7/Q8/Q9)
- **Character = the client being made over.** Random by default (face model, restricted to generated ones + a name + a scenario), with an **optional BT lock**.
- **Constrained mad-lib** for intro *and* outro - event-anchored so every combination is cogent. Narrative-only: the underlying self-care task is **identical** across scenarios so trials stay comparable.
- **Outro is a pure story that names the turn-taking**, no numbers to the child. **3 positive tiers** keyed **only** to the learner's own **pass** turn-taking (over-cap attempts + pass independence; `staff-prompted` and `no-engagement` count as non-independent). (E), coordination, and **ask-back** outcomes stay out of the child's story tier (ask-back is reported-only - maintainer sign-off).
- **Two-axis outro (C1, HARDENED):** the outro is **two independent parts** - a **tier-keyed turn-taking line** (teamwork only, asserts no event success) + a **completion-gated completion beat** (the event-success flavor, emitted only when the look is actually complete). So a **perfect-turn-taking-but-incomplete** run gets the Tier-1 turn-taking praise **with no completion claim** (closes F-30; AC-18). The §5 outro strings are re-authored into this two-part form at build for maintainer review (L7) - the six approved events are unchanged.
- Child-facing: mad-lib outro + the existing `NooutcoReward.celebrate` animation; the SR timer (`openSR`) stays available to the BT.

#### 3.7.1 STORY/VISUAL CONGRUENCE - hard rule
The mad-lib **asserts no checkable visual attribute of the client.** No hair texture/length/color words (frizzy, bedhead, short, matted), **no specific spot/blemish counts**, nothing a learner can look at the doll and refute. Every model's default hair differs and spots are procedurally seeded, so those are cleanly refutable claims that break the activity. The text references only the **event**, the **stakes**, and the **task** ("getting ready," "the whole glam routine," "no outfit yet"), and credits the team. The outro is **generic-celebratory + teamwork** - it never claims a specific feature was transformed.

### 3.8 Config surface, staged self-care, completion (Q10)
- **Staged phases stay** - they are a **self-care task analysis**, not just scaffolding. Choice stays where it lives (colors, options). **Inaccessible items are hidden, not dimmed** - the constraint holds; the "tap a dead tool" friction is gone.
- **Timed is a partner/BT-turn mechanic**, **configurable duration**: the BT holds possession for a set length, which trains the learner's **waiting by length** and cues the BT to act inside the window. **The learner's own turn is always action-counted** (shown/hidden). Prescribed wait length is recorded per turn; grabs during the wait are the (E)/violation signal.
- **Completion = finish the look** (not a handoff count - kills the empty-doll win). The BT picks the **number of turns**; **actions-per-turn auto-scales** to finish the look, **favoring the learner** (bigger chunks in short runs); staff turns stay light (model the pass, or hold the timed wait). Even a 2-turn run keeps ≥1 real pass + ≥1 real wait.
- **Theme dropdown removed** (one reachable theme; **pet/hero stay off**). **Whose-turn indicator always visible** in every map style (fix/drop Runway, which hid it). Count shown/hidden both kept (both now give refusal feedback). Fade level kept as the prompt ceiling. Give-back reworked so the **ask-back is reachable in counted mode**. Model dropdown becomes the **character lock**. Extra-time bonus kept as a relinquish reinforcer.

### 3.9 Visual fidelity & device (Q11)
Fix list: sprite layers **exactly aligned**; sweep malformed colorations, clipping, misplacement across all steps & models · hide inaccessible items · surface the **"Shirt color"** category (currently fully behind the vanity ledge) · fix the **"Actions left"** meter (fills backwards) · name the empty **hairstyle button labels** · **blemish contrast** (rings are correctly registered - contrast, not alignment) · clean the **5 SVG console errors** on load · whose-turn always visible.

**Device priority:** **1 Desktop browser (first-class) → 2 Tablet → 3 iPhone.** All work, in that quality order.

---

## 4. The clinical data (approved parameters)

**Per-turn table columns (all ten kept):** Turn # · Player · Step worked · Actions (used/allotted) · Within limit · Over-cap count · Pass score · Wait held · Ask-back score · (E) events.

- **Pass score** ∈ `independent` / `prompted@{full|gesture|silent}` / `staff-prompted` / ` - ` (staff turn).
- Staff turns: limited columns, no scoring; show `blocked-extra` / wait held.

**Session footer (de-identified):** auto session id · date/time · character · scenario · scaffold (staged) · turns configured · totals (independent passes, over-cap total, (E) counts, coordination outcomes) · outro tier.

**Approved tuning parameters:**
| Parameter | Value |
|---|---|
| Learner : staff action split | **2 : 1** (learner ~⅔) |
| Relinquish wait window (default) | **3s** |
| Outro tier thresholds | **Strict** - Tier 1: 0 over-cap & all passes independent · Tier 3: ≥2 over-cap or majority prompted · Tier 2: between |
| Print-table columns | **All ten** |
| Story pool | **6 events approved** (below), under the congruence rule |

## 5. Mad-lib story pool (approved, congruence-safe)

Event-anchored; each occasion carries its own compatible problem/stakes/payoff; free slots (client name from ~12 neutral names, one flavor word) vary. Problem text is **task/readiness framing only** - no refutable appearance claims (§3.7.1).

| Event | Problem (task/readiness only) | Stakes | Outro tiers 1→3 (generic, all positive) |
|---|---|---|---|
| School picture day | isn't ready yet · whole routine to do · no outfit picked | photographer's almost here | picture-perfect, day was a hit → looked great → got there, as a team |
| Birthday party | not party-ready · lots to do · no outfit yet | guests arriving | party star → great party → had fun together, taking turns |
| Talent show | needs the full glam routine before going on | on stage next | dazzled the crowd → great set → took the stage, as a team |
| Family photo | not camera-ready yet · the whole routine to do | grandma's waiting | the framed favorite → lovely photo → a keeper, together |
| First day, new school | wants to feel ready · full routine · no outfit yet | bus in a few minutes | walked in beaming → felt ready → made it, as a team |
| Dance recital | not show-ready yet · glam routine to do | curtain in minutes | shone on stage → great recital → danced it out, together |

---

## 6. Build plan

**Tier 1 (core, built + verified first):** turn-taking rebuild (wait-window pass scoring, over-cap refuse/flag/prompt, kid feedback in all modes, ask-back reachable) · completion = finish the look + BT turns-count lever + 2:1 learner-favored action split · staged self-care with hidden (not dimmed) locked items · event log → print view → per-turn table · random character + mad-lib intro/outro + 3-tier ending under the congruence rule · (E) button · config cleanup (timed=partner-only configurable, theme removed, whose-turn always on) · visual-fidelity sweep + fix list.

**Tier 2 (after Tier 1 verifies):** coordination mode - random staff-error injection (extra turn / stall) · peripheral coded staff cue · conditional block-lift for the injection · staff-marked 3-way outcome.

**Verification (each tier):** Playwright playthroughs driving the real game, checking the **hardened acceptance criteria** in `docs/glam-team-makeover-redesign-hardened-claims.md` (AC-1 - AC-27) - including specifically:
- pass `independent` only within possession+idle before *any* prompt (app or BT); over-cap sets a **turn-durable** forfeit surviving resume (E1); silent-probe stall → `prompted@silent` not independent (B2/D1);
- **0-action pass → `no-engagement`, not independent** (C2); early voluntary sub-budget pass scores (B3);
- **ask-back:** silent 37s ask → `prompted@silent` (AC-24); and the **G1 must-test** - counted staff turn + give-back=forgets + **0 staff actions** → the ask window opens (no deadlock) and a correct ask scores the mand, not `early-ask` (AC-27);
- completion-by-look always terminable, incomplete run prints marked-incomplete with **no completion over-claim** and the Tier-1 turn-taking line still fires (AC-16/AC-18);
- over-cap flow, hidden-mode feedback, turns lever + 2:1 split, mad-lib coherence + congruence, tier selection, print table renders, (E) logging;

plus sprite-alignment screenshots; print view; clean console; existing `tests/glam-team-makeover.spec.js` still green.

## 7. Risks / confirm-at-build
- **Print pattern** - mirror the existing No Outcome tools; read CPR/others' print-to-PDF before wiring.
- **Art fidelity effort is unbounded** - exact sprite alignment across 4 models × all steps may be deep; if it balloons, land the clinical + gameplay core first and treat last-mile art polish as its own pass rather than block the build.
- **Tier-2 shared-screen cue** - the peripheral coded symbol is the best no-hardware option; its legible-to-BT / invisible-to-learner balance needs real-session tuning before it's relied on for data.

## 8. Non-goals / invariants
- Pet and hero themes **stay inaccessible**.
- **No PHI**: no names, no freeform anywhere; auto session id only.
- No clinical jargon or parenthetical framing in child-facing prose - clean and focused.

## 9. Adversarial hardening & sign-off (2026-07-24)

This spec was stress-tested via `/adv-review` - a 7-round adversary/proponent debate. It ended as a **cap-escalation** (the adversary found a real seam every round and never went `dry`), but **every attack A1 - G1 was conceded and pinned** to a criterion. Full hardened claims (D-A…D-K, AC-1…AC-27, L1…L8) with per-attack provenance live in **`docs/glam-team-makeover-redesign-hardened-claims.md`** - that document is **authoritative** for the acceptance criteria where it conflicts with earlier prose here.

**Maintainer sign-off (2026-07-24):** hardened design accepted as the build basis. Decisions:
- **Ask-back is reported-only**, not tiered - the §3.7 tier stays keyed to the pass (§3.2b, §3.7).
- **G1's fix** (ask-back onset → staff-idle) is **verified in the build's Playwright tests**, not a separate adversarial pass (§6 must-tests).

**Accepted limits (not blockers):**
- **L6 - who-taps on one device.** The app cannot machine-prove the learner (vs the BT) activated the pass or "✓ I asked!" control. Mitigation is **procedural**: the BT conducts with prompt-fading fidelity and data integrity. The tool *supports* clinical judgment; it does not replace ABA therapy. Applies to both the pass and the ask-back.
- **L7 - outro strings** re-authored into the two-axis form at build for maintainer review (six events unchanged).
- **L8 - pause-vs-stall window timing** is a bounded, configurable tuning matter; it can affect prompt *timing*, never false independence (independence is gated on any prompt with the durable-forfeit rule).

**What the hardening changed most:** the `independent` definition (from a gameable timing predicate → possession+idle anchor, any-prompt gating, turn-durable forfeit flags); the **ask-back** gained its own hardened model (it, not the pass, was the original F-22 site); and the outro became **two axes** so a clean-but-incomplete run never over-claims completion. The three motivating defects (untrustworthy scoring · invisible violations · blank-doll win) are all closed, and **F-22 is killed on both its sites** (pass `handoff` and ask-back `confirmAsk`).
