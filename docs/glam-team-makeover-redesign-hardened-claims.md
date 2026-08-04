# Debate - glam-team-makeover redesign (turn-taking clinical data tool)

Protocol: `PROTOCOL.md`. The **orchestrator** owns the baton and turn-taking and is its
only writer. Proponent owns CLAIMS / CONVERGED / OPEN. Adversary appends to DEBATE LOG only.

Ground truth to attack against:
- The full spec: `/Users/kaleb/DEV/nooutco-root/docs/glam-team-makeover-redesign-spec.md`
- The current build (one file): `/Users/kaleb/DEV/nooutco-root/apps/games/glam-team-makeover/index.html`
- The evaluation of the current build (37 reproduced findings): `/Users/kaleb/DEV/nooutco-root/docs/eval/glam-team-makeover-playtest.md`
This is a **design** debate: the implementation does not exist yet. A "verified counterexample"
is a concrete scenario in which the design **as specified** would still produce a wrong or
unsafe outcome - most valuably, an under-specified criterion under which a conforming
implementation could pass every AC while the clinical behavior is still wrong (the E1 trap).
Ground current-behavior claims against `index.html` line numbers; ground design gaps against
the spec's own text.

---

## CLAIMS (proponent)

### Design shape
- **D-A - Independence by wait-window.** A pass scores `independent` only if the learner activates
  the pass control **before any prompt is delivered that turn and with no forfeit flag set (AC-4)**;
  otherwise a fadeable prompt at the BT-set level (full / gesture / silent-probe) is delivered and a
  pass after it → `prompted@level`; never-pass → `staff-prompted`. This replaces the current
  `independent = !cueVisible` (index.html:586) that scores every pass independent at cue=none.
  The pass is a **learner-operated** control **available throughout** the learner's own turn (device
  in front of the learner; the BT does not tap it to advance) - the action budget is a **cap, not a
  quota (AC-17)**, so the learner may relinquish **early**. A scored relinquish requires the learner
  to have **taken possession - ≥1 engaged action that turn**: an early pass **after ≥1 action**
  (budget not yet spent, no prompt delivered, no forfeit) is an at-least-as-strong voluntary
  relinquish → `independent`, recorded with its **actions-used** count, the learner **not** forced to
  exhaust the budget before relinquishing (**AC-19**). A pass with **0 engaged actions** (tap Go,
  instantly pass) is **not a relinquish** - nothing was taken to give up - and is recorded as a
  distinct **`no-engagement`** turn outcome, **never `independent`** (the taught chain is *take a turn
  → relinquish*; **AC-20**). This retires F-1 on **both** axes: the **data** (actions-used recorded)
  **and** the **score** (a 0-action turn cannot read as an independent relinquish). The 0-action pass
  is **scored, not blocked** - blocking it would recreate the F-23/A4 deadlock and hide a clinically
  real disengagement. The **wait-window → prompt escalation anchors to possession-taken + a
  no-relinquish idle interval**, **not** budget-exhaustion (§3.2 re-anchored): once the learner has
  taken possession (≥1 action) and **stops acting**, the no-cue wait window (default 3s, configurable
  per learner) runs **from their most recent action** - budget-exhaustion is now merely the special
  case where the learner cannot resume. On window-elapse the app delivers the faded prompt (full /
  gesture, or **by window-elapse at silent-probe**, AC-1). **Independence is gated on *every* prompt
  source, not the app's alone:** a pass scores `independent` only if it precedes **both** the app's
  faded prompt **and** any **BT real** prompt (the staff verbal/gestural prompt, marked via the §3.2
  "prompt delivered" affordance, deliverable on **any** turn - sub-budget or at-budget). A pass after
  the app prompt → `prompted@level`; a pass after a BT real prompt → `staff-prompted`; never passes →
  `staff-prompted`. This holds on **sub-budget** turns identically to at-budget turns - closing the
  "the app prompt never fires sub-budget, so every sub-budget pass is vacuously `independent`" hole
  (**D1**; F-22 structural, distinct from the L6 who-taps residue: here the **learner** taps, the app
  just never fired). **Which delivered prompts are turn-durable vs discardable (E1).** A prompt sets a
  **turn-durable forfeit-`independent` flag** - like AC-4's over-cap flag, it **survives a resume and
  cannot be laundered** - when it is **(i) any BT real prompt** (a person had to tell the learner to
  let go: the BT judged a genuine relinquish stall and intervened; a token resume cannot erase that),
  **or (ii) any prompt delivered at/after budget-exhaustion** (the learner is at the wall and cannot
  resume with real work - any further tap is over-cap → AC-4 forfeit anyway). **Only a sub-budget
  app-faded prompt is discardable, and only by a genuine resume:** if the learner does another engaged
  action before passing, that premature idle-cue is cleared and a fresh opportunity opens (the L8
  thinking-vs-stalling false-positive - the learner was mid-task, not stalling); if instead the
  learner passes without resuming, the app-faded prompt stands → `prompted@level`. So a learner who
  needed a **BT** prompt (or any prompt at exhaustion) this turn is scored non-independent **durably** - one more token action does **not** launder it back to `independent` (**AC-23**). "prompt
  delivered" is a per-turn **event**, not merely a visible cue.
  Structurally there is **no** configuration under which a pass scores `independent` without the
  learner activating the control **before any prompt is delivered** - the cue=none inversion (F-22)
  has no analog on the pass. The residue that a BT could reach over and tap for a silent learner is a
  **procedural-fidelity** dependency (**L6**), categorically weaker than the old bug: the old code
  *guaranteed* independence with zero response possible; here a genuine pre-prompt activation is
  required by someone.
- **D-B - Over-cap refuse+flag+prompt.** An over-cap action on the learner's own turn is
  refused (no effect), logged as an attempt, and immediately triggers the pass prompt, with
  gentle kid-facing feedback in **every** count mode (fixing the silent hidden-mode cap). The
  over-cap gate reads a **single, fixed per-turn cap = the turn's auto-scaled action budget
  (D-D)**, known before the turn begins; **no** bonus, reward, or mid-trial mechanic inflates it
  (removing the current `effGoal = actionGoal + bonus` / `_turnCap` inflation,
  index.html:481/:522, where `handoff` climbs `bonus` +1 per turn to a cap of 3, index.html:578 - eval F-14/F-36). The extra-time "reinforcer" (§3.8), if kept, is a **non-cap** reward
  (celebration / SR time) and never adds actions (**AC-17**).
- **D-C - (E) button for the machine-blind.** Cross-turn violations (learner acting on the
  staff's turn) are not machine-distinguishable on one device; a staff-operated (E) button
  logs them. (E) never alters gameplay or score.
- **D-D - Completion = finish the look.** The trial ends when the staged look is complete **or
  the BT-set number of turns is exhausted, whichever comes first** - never at a handoff count.
  The BT sets the number of turns (a **hard upper bound**); actions/turn auto-scales so a
  **cooperative** run finishes the look in ~N turns, split **2:1 favoring the learner**. Staff
  turns stay light and do not advance the look. A run that does not complete within N turns ends
  **incomplete** (**AC-5**), never deadlocked.
- **D-E - Timed is partner-only.** Timed turns apply only to the staff/partner turn
  (configurable duration; trains waiting-by-length). The learner's own turn is always
  action-counted.
- **D-F - Random client + mad-lib.** Character = the randomly-assigned client (face model +
  name + scenario), optional BT lock. Intro/outro are event-anchored mad-libs, narrative-only,
  with the underlying self-care task **identical** across scenarios.
- **D-G - Performance-tiered outro.** The outro is a pure story naming turn-taking, no numbers
  to the child, in 3 positive tiers keyed **only** to the learner's own turn-taking (over-cap
  attempts + pass independence); strict thresholds. A `staff-prompted` pass counts as
  **non-independent** for tiering (see **AC-11**). The outro is **composed of two independently-gated
  parts**: (1) a **tier-keyed turn-taking line** that celebrates turn-taking/teamwork **only** and
  asserts **no** event-success or completion (the register §5's Tier-3 cells already use - "as a
  team", "taking turns", "together" - scaled to tier intensity); and (2) a **completion beat** (the
  event-success flavor - "day was a hit", "dazzled the crowd") shown **only** when the look is
  complete. This applies to all **six approved §5 events unchanged** - only the outro **text** is
  restructured from §5's single fused string into these two axes, consistent with §3.7.1's own
  "generic-celebratory + teamwork, never claims a feature was transformed" rule; the actual strings
  are **re-drafted at build for human review** (**L7**).
- **D-H - De-identified print-view data.** Data is an append-only per-trial event log rendered
  as a per-turn table in a print-to-PDF view. No ID/name/freeform anywhere; auto session id only.
- **D-I - Staged self-care, hidden locks.** The staged phase order (a self-care TA) is kept;
  inaccessible items are **hidden**, not dimmed.
- **D-J - Coordination mode (tier 2).** Random staff-error injection (extra turn / stall); the
  extra-action block lifts only for the injection; staff cued by a peripheral coded symbol;
  the learner's catch is staff-marked 3-way.
- **D-K - Ask-back scored by the hardened relinquish model (staff-forget anchor).** §3.2's "**both**
  the pass **and** the ask-back are scored with **this same model**" is realized here as a **pinned**
  model, not intent - closing the fact that five rounds hardened only **the pass** (`handoff`) while
  the eval's **headline** defect (finding 2 / **F-22**) lives on the **ask-back** (`confirmAsk`
  `independent = !cueVisible`, cue timer un-armed at cue=None, index.html:584/:586). The ask-back - the
  learner's **mand** for their turn back in "They forget → I ask" mode (`onConfirmAsk` / "✓ I asked!",
  index.html:254) - is scored by the same hardened model as the pass, with the pass-specific pieces
  re-anchored to the ask-back's structure:
  - **Window anchor = the staff-"forget" onset, fired on STAFF-IDLE** - the true D1 analog (the staff
    has taken possession and then holds it **without acting or handing back** for the wait interval),
    **not** "allotted staff actions spent" (that is the pre-D1 *exhaustion* anchor D1 removed from the
    pass, and it never fires when the staff **genuinely forgets** - does 0 of N actions, the scenario
    the mode is named for - **G1**). The onset fires on staff-idle for **any** number of staff actions
    spent (0, 1, …, N), or on an explicit **BT signal** of the forget (in "forgets" mode the staff *is*
    the BT, deliberately modeling the forget, so the BT can disambiguate a mid-turn pause from a
    forget). Timed staff turns are already fine (the timer elapses regardless). The staff-idle
    threshold shares **L8**'s tuning nature (staff-side pause-vs-forget), bounded by the same accepted
    procedural boundary. This makes the ask-back **reachable on a counted forgets turn** (AC-15) and the
    onset machine-detectable (**AC-27**).
  - **Independence** = an ask scores `independent` iff emitted **after** the forget onset, **before any
    prompt** (app faded cue **or** BT real prompt), with **no turn-durable forfeit flag** - identical
    gating to AC-2. A **BT real prompt** sets a turn-durable forfeit flag (AC-23 analog). At
    **silent-probe** the prompt is delivered by **window-elapse** (AC-1 analog): a silent 37 s ask →
    window elapsed → `prompted@silent`, **never** `independent` (**AC-24**, killing F-22 on its site).
  - **Mand floor** (the possession-floor analog) = an ask **before** the forget onset (interrupting the
    staff's legitimate turn - anticipatory) is **not** `independent`; it is a distinct **`early-ask`**
    code, **recordable** (fixing eval **F-33**, the currently-unrecordable too-early ask) - the
    ask-back analog of the pass's `no-engagement` (**AC-25**).
  - **No resume-launder / discardable-cue path** (simpler and **stricter** than the pass): during the
    staff's forgotten turn the learner takes **no** interleaved actions, so there is no
    opportunity-reset to launder (no E1 analog) and no premature mid-task-pause app-cue to discard
    (no L8 analog) - **any** delivered prompt (app or BT) forfeits, unconditionally.
  - **Scores** ∈ `independent` / `prompted@{full|gesture|silent}` / `staff-prompted` / `early-ask` /
    ` - ` (no ask-back this turn, e.g. "hand it back" mode). Recorded **per turn** (§3.1 fade curve; §4
    "Ask-back score" column).
  - **Reported, not tiered:** the outro tier stays keyed to **pass** independence + over-cap **only**
    (§3.7 / AC-11 - "the pass is primary"); whether the ask-back should also feed the tier is a
    **human scope call**, flagged and defaulted to the §3.7 lock (**AC-26**).
  - **Who taps "✓ I asked!"** inherits **L6** - the mand is a verbal act the machine cannot detect; the
    button is BT-confirmed, bounded by the accepted procedural-fidelity limit. **Verification (§6) must
    exercise the ask-back scoring *separately*** (silent-probe ask, early-ask, BT-prompt durability),
    not fold it into a pass-only probe.

### Acceptance criteria
- **AC-1** A pass at t=5s after the window opened (window=3s, measured from the learner's most recent
  action - the possession-taken + no-relinquish anchor, D1/§3.2 re-anchored, **not** budget-exhaustion)
  scores `prompted`, never `independent`, at **every** cue level including silent-probe.
- **AC-2** A pass on the **learner's own pass control** scores `independent` iff **(a)** no
  **turn-durable forfeit flag** is set that turn - AC-4 (over-cap) or **AC-23** (a **BT real** prompt,
  or **any** prompt delivered **at/after budget-exhaustion**) - **and (b)** no **discardable**
  sub-budget app-faded prompt is live in the **current** relinquish opportunity (a genuine resume
  clears (b) but never (a)). This holds for a pass inside the 3s window (e.g. t=2s) **and** for an
  **early voluntary pass before the budget is spent** (**AC-19**), on **sub-budget turns identically
  to at-budget turns**. A prompt from **either** the app **or** the BT can forfeit independence (no
  structural analog of the cue=none inversion, F-22; D1's sub-budget vacuity closed via **AC-21**),
  and a **BT** prompt or an **at-exhaustion** prompt **cannot be laundered by a resume** (E1 closed
  via **AC-23**). The residual who-taps concern is bounded by **L6**; the sub-budget app-cue-timing
  residue by **L8**.
- **AC-3** An over-cap tap in **hidden**-count mode yields visible kid feedback, logs an
  over-cap attempt, and triggers the pass prompt; the action does not apply.
- **AC-4** An over-cap attempt **sets a forfeit-`independent` flag on that turn** - a state set by
  the over-cap **event itself**, *decoupled from cue visibility and from whether the window has
  elapsed*. That turn's pass therefore scores **non-independent** regardless of latency or cue level:
  `prompted@level`, or **`prompted@silent`** at cue = silent-probe where nothing is shown (this
  **overrides AC-2's** pre-prompt → `independent` for any turn carrying the flag). Passes on
  **other** turns of the same trial are unaffected - the per-turn fade curve (§3.1) is preserved.
  (§3.3's "forfeits `independent` for that trial" is corrected here to **turn** scope; the
  trial-level "stayed within limit: yes/no" is a separate count, not a pass score.) Pins: (a) a
  6-turn trial where turn 1 has one over-cap attempt then a pass and turns 2-6 pass with no prompt/no
  flag records turn 1 non-independent and turns 2-6 `independent` - five independent passes survive;
  (b) at cue = **silent-probe**, one over-cap tap at t=1s then a pass at t=2s (inside the window,
  nothing shown) scores **`prompted@silent`, never `independent`** - the probe cannot be re-inverted
  by the over-cap grabber (B2).
- **AC-5** The completion celebration/outro's **claim that the look is finished** ("came together",
  "day was a hit", etc.) is unreachable unless the staged look's required steps are complete (kills
  the over-claim, F-30). This **completion beat is a separate, completion-gated part** of the outro
  (D-G) - the §5 event-success flavor ("day was a hit", "dazzled the crowd") lives **here**, not in
  the tier-keyed turn-taking line; it is **orthogonal to the tier number**, which stays keyed to
  turn-taking **only** (§3.7 / AC-11).
  An incomplete trial simply **omits the completion beat** and asserts **no** completion - it does
  **not** force a tier (a perfect-turn-taking incomplete run still earns its Tier-1 *turn-taking*
  celebration, **AC-18**). **The trial is always terminable:** bounded by the BT-set number of turns
  (D-D), the BT has an always-available end-trial control, and turns-exhausted reaches the print view
  **regardless** of completion; incomplete trials are marked **incomplete** in the table/footer. No
  unreachable terminal - the F-23 dead-end is **not** reborn on the completion axis (**AC-16**).
- **AC-6** Re-applying an already-done step (recolor) does not advance completion and does not
  by itself end the trial.
- **AC-7** With BT turns=N and a **cooperative** learner (each turn advances the next required
  step), the look completes in ~N turns and the learner receives ~2/3 of the total actions. N is a
  **hard bound**: the trial never runs past N turns to force completion (an incomplete run ends per
  AC-5). The 2/3 split is computed against the fixed auto-scaled budget, not an inflated cap (AC-17).
- **AC-8** On the learner's turn no timer bounds the turn; timed bounds only partner turns.
- **AC-9** The print view renders a per-turn table with all ten columns + a de-identified
  footer; no name or freeform input exists anywhere in the app.
- **AC-10** No mad-lib intro/outro string asserts a checkable visual attribute of the client
  (no hair texture/length/color words, no spot/blemish counts).
- **AC-11** Outro tier is a pure function of (over-cap attempts, pass independence) only; (E)
  events and coordination outcomes never change it. **Strict:** Tier 1 iff 0 over-cap attempts AND
  **every learner turn is an engaged `independent` pass** (≥1 engaged action then pass before any
  prompt; equivalently 0 `prompted@level`, 0 `staff-prompted`, **and 0 `no-engagement` turns** - so
  neither a `staff-prompted` trial nor a 0-action run is ever Tier 1, **AC-20**); Tier 3 iff ≥2
  over-cap attempts OR a **majority** of learner turns are **non-independent** (`prompted@level`,
  `staff-prompted`, or `no-engagement`); Tier 2 otherwise. Every trial has ≥1 learner turn (D-D), so
  the Tier-1 predicate is never vacuously true.
  This matches the §4 table's "all passes independent" and closes the `staff-prompted` → Tier 1 leak.
  The tier **number** is **orthogonal to completion** (§3.7 keys it to turn-taking **only**);
  completion gates the outro's separate completion beat, not the tier (AC-5/AC-18) - so a Tier-1 tier
  and a no-completion-claim story co-exist without contradiction (**AC-18**). The **ask-back** score is
  recorded per turn (§4) but does **not** feed the tier - this "pass independence + over-cap only"
  predicate is **pass**-scoped by §3.7 ("the pass is primary"); the ask-back is reported, not tiered
  (**AC-26**, D-K), so adding ask-back scoring does not reopen this predicate.
- **AC-12** Whose-turn is visible in every turn-map style.
- **AC-13** The theme dropdown is absent and pet/hero themes are unreachable.
- **AC-14** An (E) press logs {timestamp, phase, whose-turn}, changes no game state or score,
  and is undoable.
- **AC-15** The ask-back opportunity is reachable on a **counted** partner turn (fixing the
  current unreachable-when-counted defect, eval finding 3). **Reachability is necessary but not
  sufficient:** the ask-back's independent-vs-prompted **score** is governed by **D-K / AC-24 - AC-26**,
  not by this AC - a build that makes the ask-back reachable yet scores it with the surviving
  `confirmAsk` `!cueVisible` model fails **AC-24** even with AC-15 green.
- **AC-16** A trial in which the learner spends every turn re-applying already-done steps and never
  completes a required step still **terminates** at the BT-set turn count, reaches the print view
  marked **incomplete** with its full per-turn table, fires **no** "the whole look came together"
  claim, and never enters an unexitable state (A4 / F-23 pin).
- **AC-17** The effective per-turn cap the over-cap gate enforces equals the turn's auto-scaled
  budget and **never rises within a trial**. A tap beyond that budget is an over-cap attempt
  (AC-3/AC-4) on **every** turn - there is no "budget+bonus" band in which the same tap is legal on
  one turn and a logged violation on another (A5 pin).
- **AC-18** A trial with **0 over-cap and every turn an engaged `independent` pass** but an
  **incomplete** look fires the **Tier-1 turn-taking line** (the teamwork celebration at tier-1
  intensity - **not** §5's fused event-success string) **and omits the completion beat**, asserting
  **no** completion (AC-5, D-G). Concretely for **School picture day, incomplete**: the outro
  celebrates the turn-taking at Tier-1 intensity and does **not** say "day was a hit" (that string is
  the completion beat, gated on a complete look). AC-11 (tier by turn-taking) and AC-5 (completion-
  gated beat) are realized as **two independent axes** (D-G/L7), so both tests pass on this trial and
  the F-30 over-claim does **not** recur through the Tier-1 string (C1). **No implementation may
  satisfy AC-18 by emitting the §5 fused Tier-1 event-success string on an incomplete look.**
- **AC-19** With budget=3, a learner who does **1 action** then activates the pass control with **no
  prompt delivered (app or BT)** scores `independent` (voluntary early relinquish), recorded with
  actions-used=1; the learner is **never forced** to spend the full budget before relinquishing (cap,
  not quota, AC-17), and an early/unspent pass is **distinct** in the data from a played-out turn
  (fixing F-1) (B3). The floor is **≥1 engaged action**: a **0-action** instant pass scores
  `no-engagement`, not `independent` (**AC-20**), so "cap not quota" is bounded below by "took
  possession". This early pass scores `independent` **only** because no prompt fired first - the same
  1-action turn where a prompt is delivered first scores non-independent (**AC-21**).
- **AC-20** A learner who taps Go then instantly passes with **0 engaged actions every turn** (look
  incomplete) records **every turn as `no-engagement`**, counts **0 independent passes**, and scores
  **Tier 3** (never Tier 1) - the disengaged run gets the encouraging floor, not the celebration. An
  `independent` pass requires **≥1 engaged action** (possession taken), so the pass **score** - the
  value AC-11's tier and the report's independent-count are computed from - **distinguishes
  non-engagement from mastery**, closing F-1's scoring gap (C2). The per-turn table's Pass-score
  column carries `no-engagement` as a distinct code (extending §4's enum). The 0-action pass is
  **scored, not blocked** (no F-23/A4 deadlock).
- **AC-21** On a **sub-budget** turn (budget=3, cue=full), a learner who does **1 engaged action**
  (clears the ≥1 floor, not `no-engagement`), stalls, then passes **only after a prompt is delivered**
  scores **non-independent** - `prompted@full` if the **app's** faded prompt fired on window-elapse,
  `staff-prompted` if the **BT** delivered a real verbal/gestural prompt first. It is **never**
  `independent`. The app fade ladder and the BT real-prompt path both apply on sub-budget turns
  exactly as at budget-exhaustion; "no app prompt fired" is **not** sufficient for `independent`
  (closes D1's structural sub-budget vacuity - a fading-in-progress learner who takes a couple of
  actions then needs prompting reads `prompted`, not "all independent").
- **AC-22** A **sub-budget** learner who takes **≥1 action then will not pass at all** has a defined
  resolution: the relinquish opportunity opens on possession + idle (not on exhaustion), the app
  delivers its faded prompt on window-elapse, and a never-pass resolves to **`staff-prompted`** - the
  same code as at budget-exhaustion - with the BT end-trial control always available. The turn has a
  defined app-driven score and cannot deadlock on the learner's **own** turn (closes D1's corollary;
  F-6/F-23 not reborn on the learner's turn).
- **AC-23** A learner who this turn draws an app faded prompt, then a **BT real prompt** (a genuine
  stall), then does **one more engaged action** (a legal sub-budget resume), then passes quickly in
  the fresh opportunity scores **`staff-prompted`, never `independent`** - the BT real prompt set a
  **turn-durable** forfeit flag (like AC-4's over-cap flag) that the resume does **not** clear. A
  prompt delivered **at/after budget-exhaustion** is likewise turn-durable (any further tap there is
  over-cap → AC-4). Only a **sub-budget app-faded prompt cleared by a genuine resume** is discardable
  (the L8 mid-task-pause case). **No sequence of legal actions launders a BT-prompted or
  at-exhaustion-prompted turn back to `independent`** (E1). Contrast: a learner who draws *only* a
  sub-budget app-faded cue (no BT prompt), resumes, and passes clean scores `independent` - minimal
  self-directed relinquish; the one path the machine leaves open (a BT who fails to prompt a genuinely
  stalling learner) is the accepted L6/L8 procedural boundary.
- **AC-24** With give-back = "They forget → I ask" and ask cue = **silent-probe** (the old **None**
  probe), a learner who sits silent for 37 s after the staff-forget onset then taps "✓ I asked!" scores
  **`prompted@silent`**, **never** `independent` - the ask window is armed on the forget onset
  **regardless of cue level**, and at silent-probe the prompt is delivered by **window-elapse** (D-K,
  AC-1 analog). This kills eval finding 2 / **F-22** on its original `confirmAsk` site
  (`independent = !cueVisible` with the timer un-armed at cue=None, index.html:584/:586): there is
  **no** ask-cue level or configuration under which a **post-window** ask scores `independent`.
- **AC-25** An ask emitted **before** the staff-idle forget onset - i.e. while the staff is **still
  actively taking their turn** (interrupting a legitimate staff action) - scores a distinct
  **`early-ask`** code, **recorded** in the per-turn table, and is **never** `independent` (the ask-back
  analog of `no-engagement`; fixes eval **F-33**, the currently-unrecordable too-early ask). An ask
  **at/after** the onset, before any prompt, is `independent`. Because the onset is **staff-idle**
  (AC-27), a genuine forget (0 staff actions) **does** fire the onset, so the correct mand under the
  contrived MO is scored `independent`, **not** mis-filed as `early-ask` (G1).
- **AC-26** The ask-back's independence is gated on **no prompt (app faded cue OR BT real prompt)**
  with the **same turn-durable forfeit rule** as the pass (a BT real prompt cannot be un-done; there is
  **no** resume-launder or discardable-cue path on the ask-back - any delivered prompt forfeits). The
  ask-back score is **recorded per turn** (§4 "Ask-back score" column) but does **not** feed the outro
  tier - AC-11 stays keyed to **pass** independence + over-cap only (§3.7, "the pass is primary").
  Whether the ask-back should feed the tier is a **human scope call**; the design defaults to the §3.7
  lock (ask-back reported, not tiered).
- **AC-27** With give-back = "They forget → I ask", Their turn = **3 actions (counted)**, and the staff
  **genuinely forgets** (does **0 of 3** allotted actions), the forget onset fires on **staff-idle**
  (the staff held possession without acting or handing back for the wait interval) - **not** on
  "allotted staff actions spent" - so the ask-back window **opens** (reachable per AC-15; no F-23/F-6
  deadlock on the ask-back), and a learner who then asks is scored per the ask model (`independent` if
  before any prompt), **not** `early-ask`. There is **no** counted-turn configuration in which a genuine
  staff forget fails to open the ask-back window (G1; the pre-D1 exhaustion anchor is removed from the
  ask-back exactly as D1 removed it from the pass). *This re-anchor is the one item not re-tested by a
  final adversary pass (round cap) - see OPEN.*

### Stated limits
- **L1** Who is physically touching the screen is not machine-detected; the cross-turn
  "learner grabbed it" case relies on the BT's (E) mark.
- **L2** The staff's turn collects no learner data; the staff is only blocked from extra actions.
- **L3** The coordination-mode peripheral cue's legibility-to-BT / invisibility-to-learner is a
  real-world tuning matter, not guaranteed by the design.
- **L4** The print-to-PDF mechanism depends on matching the existing No Outcome tools' pattern,
  unverified until build.
- **L5** Exact sprite alignment across 4 models × all steps may exceed this pass; last-mile art
  polish may be deferred to its own pass.
- **L6 - ACCEPTED (human ruling, 2026-07-24).** Pass-independence, like the cross-turn grab (L1),
  rests on BT **procedural fidelity**: on a single shared device the app **cannot machine-prove** who
  activated the pass control. The human has ruled this **intractable and accepted** - the mitigation
  is procedural: the BT conducts the session with prompt-fading fidelity and data integrity,
  consistent with the tool's founding principle that it **supports the BT's clinical judgment and does
  not replace ABA therapy**. The rebuild still removes the *structural* false-positive (the old
  `independent = !cueVisible` gave independence regardless of behavior); what remains is the
  irreducible one-device *procedural* residue, now an **accepted operating boundary, not an open
  escalation**. (A learner-side control the BT UI cannot reach was considered and set aside: on one
  physical device it cannot be enforced against a BT who chooses to tap.)
- **L7 - §5 outro re-authored at build (human-reviewed).** Closing C1 requires the §5 outro column be
  restructured from one **fused** string per (event, tier) into **two axes** - a tier-keyed
  **turn-taking line** (no event-success claim) + a completion-gated **completion beat** (the
  event-success flavor). Per the human scope ruling, the **six approved events are unchanged**; only
  the outro **text structure** changes, and the actual strings are **drafted at build and reviewed by
  the human** before ship. This is consistent with §3.7.1 (generic-celebratory + teamwork) and does
  **not** reopen the event set. **Escalation fallback:** if a build-time draft cannot express a
  tier-1 turn-taking line for some event without an event-success claim, that specific event escalates
  to the human rather than being silently re-authored.
- **L8 - sub-budget relinquish-window timing (tuning, not a false-independence hole).** With the
  window re-anchored to possession-taken + a no-relinquish idle interval (D1), on a **sub-budget** turn
  the app cannot machine-distinguish "paused mid-task, still choosing the next action" from "done
  acting, now stalling on the hand-off" - both read as idle-after-last-action. The wait window is
  **configurable per learner** (§3.2) and the **BT is the observer** who delivers the real prompt when
  they judge a genuine relinquish stall (bounded by the accepted L6 procedural boundary). So the
  automatic idle-window is a heuristic on prompt **timing**; it does not, and need not, perfectly infer
  intent - because independence is gated on **any** prompt (app **or** BT, AC-2/AC-21) **and a BT real
  prompt sets a turn-durable forfeit flag a resume cannot clear (AC-23)**, a stalling sub-budget
  learner is scored `prompted`/`staff-prompted` via the BT path. (E1 corrected the earlier wording: it
  is the **durability** of the BT prompt - not mere delivery - that makes the BT path a floor;
  opportunity-scoped delivery alone was launderable by a resume.) The residual affects prompt **timing**
  of the **discardable sub-budget app-cue only**, **not** the false-independence the rebuild kills. The
  one machine-open path - a BT who fails to deliver a real prompt to a genuinely stalling learner,
  letting a bare app-cue be laundered by a resume - is the accepted **L6** procedural-fidelity boundary,
  not a new hole.

---

## DEBATE LOG (append-only, newest at bottom)

<!-- ADVERSARY and PROPONENT alternate. Cite claim ids. Concrete, verified counterexamples only. -->

### Round 1 - ADVERSARY

Five surviving attacks. Current-behavior anchors verified against `index.html` line numbers; design-gap
attacks grounded in the spec's own text. A clean pass would have been the failure, not this.

**A1 - AC-2 / AC-1 / D-A · the E1 trap: `independent` is decided by who taps and when, not by the
learner relinquishing.** The relinquish control is a single button on a shared one-device screen
(`onHandoff` → `handoff()`, index.html:252, :578); its ask-step twin `confirmAsk()` (:586) already
scores `independent=!cueVisible` off a button press with *nothing binding the press to the learner* - the eval names this exactly (§7.2b: "`independent` here means the BT tapped the button within 3.5 s").
D-A/AC-2 swap the predicate from `!cueVisible` to a 3s wait-window timer, but the score stays a pure
function of button-press wall-clock time. Concrete: the learner sits frozen and does nothing; the BT,
pacing the session with the device in hand, taps "Done - their turn" at t=2s. AC-2's predicate - "pass
at t=2s (within window), no app prompt shown" - is satisfied → scored **`independent`**. This is the
precise false-positive independence the rebuild exists to kill (eval finding 2 / F-22), reborn on the
*primary* target (the pass). AC-1, AC-2, AC-4 can all be green while "independent" means "the BT tapped
within 3s." L1/L2 concede who-touches is not machine-detected but scope that concession to *cross-turn
grabs*; the pass-scoring criterion silently inherits the same hole and no AC closes it. Until the design
states what observable *learner* behavior the window times and who may end it, AC-2 is satisfiable by a
silent learner - the whole measure is BT reaction time.

**A2 - AC-11 vs §4 threshold table · a trial the learner never relinquishes independently can score
Tier 1 ("picture-perfect").** AC-11: "tier 1 iff 0 over-cap AND **0 prompted passes**." Pass enum (§4):
`independent` / `prompted@{full|gesture|silent}` / `staff-prompted` / ` - `. Concrete trial: every learner
turn the window elapses, the app prompt fires, the learner still never passes, so the BT delivers a real
prompt → **`staff-prompted`** on every turn; 0 over-cap attempts; count of `prompted@level` passes = 0.
AC-11's literal predicate ("0 over-cap AND 0 prompted passes") is TRUE, because `staff-prompted` is not
`prompted@level` → **Tier 1**, the biggest celebration, for a trial in which the learner needed a staff
prompt to relinquish *every single time*. The §4 table states the opposite rule - "Tier 1: 0 over-cap &
**all passes independent**" - which `staff-prompted` fails. The two definitions of Tier 1 are not
equivalent; a conforming implementation of AC-11 verbatim rewards the worst possible relinquish
performance. AC-11 must fold `staff-prompted` (any non-independent pass) into its exclusion.

**A3 - AC-4 vs §3.1 · "that trial cannot score independent" destroys the per-turn fade curve, the
design's stated primary artifact.** §3.1: "Independent/prompted is recorded **per turn**, never as a
running total, so a fade curve across turns survives." D-D gives multiple learner turns per trial, hence
multiple passes. AC-4: "After ≥1 over-cap attempt in a trial, **that trial cannot score independent**."
Concrete: a 6-turn trial; on turn 1 the learner makes one over-cap attempt then relinquishes
independently; turns 2-6 are clean independent passes. Two conforming readings diverge irreconcilably:
(i) trial-level - the whole trial is forced non-independent, so turns 2-6's genuine independent passes
are erased; the fade curve §3.1 promises is destroyed by one turn-1 slip. (ii) turn-level (per §3.3, "a
grabbed extra is not a self-relinquish") - only turn 1's own pass forfeits, and then AC-4's wording
"that *trial* cannot score independent" is simply false. The two readings yield opposite report tables
and, via AC-11, opposite outro tiers. Which pass(es) an over-cap forfeits - the concurrent turn's or the
whole trial's - is unspecified, and it is load-bearing.

**A4 - AC-5 + AC-6 + D-D · the blank-doll *win* (eval finding 9 / F-29) is replaced by a blank-doll
*deadlock* (the F-23 dead-end reborn).** AC-5: done unreachable unless the required steps complete.
AC-6: re-applying a done step "does not advance completion and does not by itself end the trial." D-D:
staff turns are "light (model the pass, or hold the timed wait)" - i.e. they do **not** advance the look.
AC-7: "the look completes in ~N turns." Concrete: staged routine, next required step is "Treat spots" (a
per-tap step); every learner turn the learner spends all allotted actions re-applying already-✓ Wash /
Moisturize - the exact degenerate pattern reproduced in eval PT5. By AC-6 completion never advances; by
D-D staff turns don't advance it; by AC-5 the done state is never reachable → the trial cannot end: no
celebration, no print data, no exit. The rebuild kills the empty-doll win by making the empty doll a trap
the session cannot leave, while D-D's "auto-scale actions to finish the look" rests on actions == progress - which AC-6 explicitly severs. What happens when a required step is available but the learner will not do
it and their actions are spent is unspecified, and that behavior is the single most common one for this
population. (This is the completion-side twin of A1: both assume a cooperative learner the tool exists
because it cannot assume.)

**A5 - §3.8 "extra-time bonus kept" vs D-D "actions/turn auto-scales" · the cap the over-cap gate reads
is undefined mid-trial, so AC-3/AC-4/AC-7 are ambiguous by construction.** In the current build the cap
is `effGoal = actionGoal + bonus` (index.html:481) and `bonus` accrues +1 per handoff (max 3, :578),
inflating the learner's per-turn cap every turn (eval F-14/F-36: a "1 action" setting ran a 4-action
turn). The redesign keeps the extra-time bonus as a relinquish reinforcer (§3.8) **and** introduces an
auto-scaled per-turn action budget sized to finish the look (D-D), and never says whether the bonus
stacks on that budget. Concrete: a learner tap that exceeds the auto-scaled budget but sits within
budget+bonus is - on one reading - a legal action (no flag, no forfeit); on the other, an over-cap
attempt that fires the pass prompt (AC-3) and forfeits `independent` for the trial (AC-4). The *same tap*
is either the taught success or a logged clinical violation, depending on an interaction the spec leaves
open. AC-7's "~2/3 of actions" and "~N turns" likewise drift the moment the bonus inflates the split. The
over-cap gate must read a single defined cap value, or AC-3/AC-4/AC-7 cannot be conformance-tested.

VERDICT: attacks-remain

### Round 1 - PROPONENT

All five land; I verified each current-code anchor before conceding (`effGoal`/`_turnCap` =
`actionGoal + bonus` at index.html:481/:522, `handoff` climbs `bonus` +1/turn to 3 at :578,
`confirmAsk` scores off a bare button press at :586, cue timer armed only when `cueLevel!=='none'`
at :584). **All five conceded**; none refuted.

**A1 - conceded (E1 trap on the pass).** Correct: D-A/AC-2 swapped the *predicate* but never said
*what the window times* or *who owns the control*, so a BT pacing with the device in hand could tap
at t=2s and score a silent learner `independent` - the same false positive the rebuild exists to
kill, reborn on the primary target. Closed both halves in the spec: D-A now makes the pass a
**learner-operated** control (window = learner's last-action → own-activation interval; the BT's
only pass input is delivering the real prompt → `staff-prompted`), and AC-2 now pins that **no**
configuration scores `independent` without that control activated in-window - the structural
cue=none inversion has no analog on the pass. The irreducible residue (BT taps the learner's control
for them) is a one-device procedural-fidelity limit, added as **L6** and **flagged to the human** as
a scope boundary - categorically weaker than the old bug, which guaranteed independence with zero
response. I do **not** claim the residue is fully closed; I claim the *structural* hole is and the
residue is honestly bounded and escalated, not silently inherited.

**A2 - conceded (staff-prompted → Tier 1).** Clean catch: AC-11's "0 prompted passes" excluded
`prompted@level` but not `staff-prompted`, so an all-`staff-prompted` trial (the *worst* relinquish
performance - a staff prompt needed every turn) satisfied the Tier-1 predicate literally. AC-11
rewritten to "**every scored pass is `independent`**" (0 `prompted@level` AND 0 `staff-prompted`),
Tier 3 on ≥2 over-cap OR majority non-independent, Tier 2 between - matching the §4 table's "all
passes independent". D-G annotated. Leak closed.

**A3 - conceded (trial-level AC-4 destroys the fade curve).** The contradiction is inside the spec:
§3.3 says "forfeits independent **for that trial**," §3.1 mandates a **per-turn** fade curve as the
primary artifact. AC-4 rewritten to **turn** scope - an over-cap attempt forfeits only *that turn's*
pass (the immediate prompt makes it non-independent by D-A); other turns' independent passes survive.
The §3.3 wording is explicitly corrected. Pin folded into AC-4 (6-turn example → five independent
passes preserved).

**A4 - conceded (blank-doll deadlock, F-23 reborn).** Correct and important: AC-6 severs
actions-from-progress and D-D's staff turns don't advance, so a perseverating learner (the modal
behavior for this population) makes AC-5's completion-gated done state unreachable → no exit, no
data. Split AC-5: the **completion *claim*** stays gated (kills the F-30 over-claim), but the
**trial** is always terminable - bounded by the BT-set N turns (now a **hard bound** in D-D/AC-7),
an always-available BT end-trial control, and turns-exhausted reaches the print view marked
**incomplete** on the encouraging floor. New **AC-16** pins that the all-repetition trial terminates,
prints incomplete, and never deadlocks.

**A5 - conceded (undefined mid-trial cap).** Verified the inflation live: `_turnCap`/`effGoal` =
`actionGoal + bonus`, `handoff` climbs `bonus` +1/turn to 3. The redesign kept the extra-time bonus
(§3.8) beside D-D's auto-scaled budget without saying whether it stacks, leaving the over-cap gate
reading an undefined cap - the same tap legal on one turn, a logged violation on another. D-B now
fixes the gate to **one** cap = the turn's auto-scaled budget, known before the turn; the extra-time
reinforcer is redefined **non-cap** (never adds actions). New **AC-17** pins that the enforced cap
never rises within a trial.

Net: D-A, D-B, D-D, D-G amended; AC-2, AC-4, AC-5, AC-7, AC-11 amended; AC-16, AC-17, L6 added. Every
Round-1 hole is folded into a criterion that pins it. Claims stay **open** - the adversary posted
`attacks-remain`, not `dry`, so nothing moves to CONVERGED yet.

### Round 2 - ADVERSARY

**Concessions (round 1 holes genuinely closed).** I re-read every rewrite against the amended text:
- **A1 - conceded.** D-A now makes the pass a **learner-operated** control and AC-2 pins that no config
  scores `independent` without in-window activation; the structural F-22 analog is dead. The who-taps
  residue is honestly named (L6) and **escalated to the human** as a scope call - a legitimate resolution,
  not a silent inheritance. The *structural* trap is closed. (But the rewrite opens B2 and B3 below.)
- **A2 - conceded.** AC-11 now excludes `staff-prompted` from Tier 1 ("every scored pass is
  `independent`"). The literal leak is gone. (But combining this fix with the A4 fix opens B1 below.)
- **A3 - conceded.** AC-4 is turn-scoped; the 6-turn pin preserves five independent passes. Clean.
- **A5 - conceded.** D-B + AC-17 fix the gate to one auto-scaled cap that never rises; the reinforcer is
  made non-cap. The mid-trial-cap ambiguity is gone.
- **A4 - conceded.** AC-16 + the always-available BT end-trial control + N-as-hard-bound make the trial
  always terminable; the F-23 deadlock is not reborn on completion. (But the fix opens B1 below.)

Three **fresh** surviving attacks, each created by the amendments themselves.

**B1 - AC-5 vs AC-11 · the outro tier now has two contradictory definitions; an incomplete look can be
owed both Tier 1 and Tier 3.** The A2 fix made AC-11 "a **pure function of** (over-cap attempts, pass
independence) **only**." The A4 fix made AC-5 impose "a trial incomplete at termination … its outro uses
the **encouraging floor (Tier 3)**." These collide the moment a trial is incomplete *and* has clean
turn-taking. Concrete: N=4 turns, cue=full; the learner passes **within-window every turn (0 over-cap, all
4 passes `independent`)** but spends each turn's action budget re-coloring the hair - an AC-6 recolor that
"does not advance completion." Recolors are legal actions (AC-17 cap, no over-cap), so nothing is flagged;
at turn 4 the required look is **incomplete**. AC-11's predicate ("0 over-cap AND every scored pass
`independent`") is TRUE → **Tier 1** ("picture-perfect"). AC-5 says incomplete → **Tier 3** floor. A test
asserting AC-11 (Tier 1) and a test asserting AC-5 (Tier 3) on this identical trial cannot both pass. Worse
on the story axis: AC-5 forbids any completion claim when incomplete, yet AC-11 *mandates* the Tier-1 story
("day was a hit") for perfect turn-taking - reopening the F-30 over-claim from the opposite side. AC-11's
"pure function of turn-taking **only**" and AC-5's completion-gated Tier-3 floor cannot both be literally
true; one must yield (e.g. "Tier 1 requires perfect turn-taking **and** a complete look; incomplete caps at
Tier 2/3"), and the spec must say which.

**B2 - AC-4 · the over-cap → forfeit-`independent` guarantee leaks at cue level `silent-probe` - the exact
probe surface F-22 died on.** AC-4 grounds forfeiture in *visibility*: "the immediate pass prompt (D-B) is
**shown** before the learner passes, **so** that pass scores `prompted@level`." But at cue level
**silent-probe** the "prompt" is by definition *not shown* (D-A/§3.2 list it as `silent-probe`; AC-1 has to
score it by **window-elapsed**, not by a visible cue, precisely because nothing is shown). Concrete: cue =
silent-probe; the learner spends the full budget, then makes **one over-cap tap at t=1s** (refused, with
D-B's count-mode feedback - but the *pass prompt* it triggers is silent), then activates the pass control at
**t=2s (inside the 3s window)**. Two of the three signals that would mark the pass non-independent are
absent - no visible prompt was shown, and the window has **not** elapsed (t=2s<3s). The only thing left to
force `prompted@silent` is a forfeiture **flag set by the over-cap event itself** - which AC-4 does not
posit; it derives forfeiture *from the prompt being shown*. An implementation faithful to AC-4's stated
mechanism scores this pass **`independent`**. So a learner who grabbed an extra action still reads
`independent` - at the one cue setting a BCBA uses to test whether the prompt can be removed. AC-4 must
define forfeiture as a state set by the over-cap attempt, decoupled from prompt visibility, or the probe
level re-inverts.

**B3 - D-A / AC-2 · the window is anchored to "the learner's last allotted action," leaving the early,
voluntary relinquish unscored (or unreachable).** D-A: "the window times the interval from the learner's
**last allotted action** to the learner's own activation of that control"; §3.2: "When the learner spends
their **last allotted** action, a relinquish opportunity opens." Concrete: budget = 3; the learner does
**one** action and then wants to hand over - the most independent relinquish there is (giving up the turn
before exhausting it). The window's start event (last allotted action) has not occurred, so there is no
defined window and no defined pass score. Two conforming readings, both wrong: (i) the pass control does
not exist until the last allotted action → the learner is **forced to spend the entire budget** before they
may relinquish, which punishes voluntary sharing and contradicts the budget being an upper-bound *cap*
(AC-17) rather than a quota; or (ii) the control is always present (as in the current build, `onHandoff`
index.html:252) and an early tap is scored by a window that never started → **undefined**, the same
early-pass blind spot as the current build (F-1: passing early with actions unspent recorded identically to
a played-out turn). The design scores only the pass that follows an exhausted budget; the earlier and
arguably stronger relinquish is either blocked or unmeasured.

VERDICT: attacks-remain

### Round 2 - PROPONENT

All three fresh attacks land - each is a real seam the round-1 amendments opened. **All three
conceded**; none refuted. Plus one human ruling recorded (L6).

**B1 - conceded (AC-5 Tier-3 floor vs AC-11 turn-taking-only tier).** My A4 fix wrote "incomplete →
Tier 3 floor" into AC-5 while my A2 fix made AC-11 "tier = pure function of turn-taking only"; on a
perfect-turn-taking incomplete run (all `independent`, 0 over-cap, budget spent on AC-6 recolors)
the two demand Tier 1 and Tier 3 on the *same* trial. Resolved in the direction the **locked**
decision dictates: §3.7 keys the tier to turn-taking **only**, so I did **not** adopt the adversary's
suggested "incomplete caps the tier" (that would contradict the lock). Instead I split the outro - the **tier number** stays turn-taking-only (AC-11), and **completion gates a separate completion
beat** of the story (AC-5) - orthogonal axes. Dropped the "Tier 3 floor" clause from AC-5; new
**AC-18** pins that a perfect-turn-taking incomplete run fires the Tier-1 *turn-taking* celebration
**and** asserts no completion, both tests green. F-30 is closed from this side too (the completion
beat is completion-gated) without demoting the child's earned turn-taking celebration.

**B2 - conceded (AC-4 leaks at silent-probe).** Correct and sharp - it re-inverts the exact probe
surface F-22 died on. AC-4 grounded forfeiture in "the prompt is **shown**," but silent-probe shows
nothing and (t=2s<3s) the window has not elapsed, so an over-cap grabber's pass read `independent`.
Adopted the fix: forfeiture is now a **flag set by the over-cap event itself**, decoupled from cue
visibility and window-elapse; the flagged turn's pass scores `prompted@level` - `prompted@silent` at
silent-probe - and this **overrides AC-2**. New pin in AC-4(b): silent-probe, over-cap at t=1s then
pass at t=2s → `prompted@silent`, never `independent`.

**B3 - conceded (early voluntary relinquish unscored/unreachable).** Verified against the build: the
pass control (`onHandoff`, index.html:252) renders under `sc-if isMine` for the whole learner phase,
gated on whose-turn, never on budget-exhaustion - so an early pass is already reachable and
`handoff()` records it identically to a played-out turn (F-1). Anchoring the window to "last allotted
action" either forced the learner to exhaust the budget before relinquishing (contradicting
cap-not-quota, AC-17) or left the early pass scored by a window that never started (F-1 reborn). Fixed
in D-A: the pass control is **available throughout** the turn; a pass with **no prompt delivered and
no forfeit flag** scores `independent` whether early or in-window; the **wait-window→prompt escalation
anchors to budget-exhaustion**, and "prompt delivered" is a per-turn **event** (delivered **by
window-elapse at silent-probe**, unifying B2). New **AC-19** pins the 1-of-3-actions early pass →
`independent`, recorded with actions-used, learner never forced to exhaust the budget - retiring F-1.

**Human ruling recorded - L6 now ACCEPTED.** Per the relayed decision, the one-device "who tapped"
residue is **intractable and accepted**; L6 is rewritten from an open escalation to an accepted
stated limit with the procedural mitigation on record (the BT conducts with prompt-fading fidelity
and data integrity; the tool supports clinical judgment, it does not replace ABA). No open escalation
remains on the pass-scoring axis.

Net: D-A amended (B2+B3 unified - pass available throughout, forfeit-flag pivot, prompt-delivered
event incl. silent-probe-by-elapse); AC-2, AC-4, AC-5, AC-11 amended; AC-18, AC-19 added; L6 moved to
ACCEPTED. Claims stay **open** - the adversary posted `attacks-remain`, not `dry`.

### Round 3 - ADVERSARY

**Concessions (round-2 seams genuinely closed).** L6 not reopened (human ruling accepted).
- **B2 - conceded.** AC-4 now sets forfeiture as a **flag on the over-cap event**, decoupled from cue
  visibility and window-elapse; AC-4(b) pins silent-probe over-cap@t=1s → pass@t=2s = `prompted@silent`.
  The probe re-inversion is dead.
- **B3 - conceded (reachability/unscored half).** D-A makes the pass control available throughout and
  AC-19 scores the early pass and records actions-used, so the early relinquish is no longer unreachable
  or silently dropped. (But the *scoring* rule this opened is C2 below.)
- **B1 - conceded (the numeric Tier-1↔Tier-3 clash).** Dropping AC-5's "Tier-3 floor" and making the
  tier **number** orthogonal to completion removes the two-tiers-owed contradiction. (But AC-18's
  stronger claim - that the *story text* co-exists with no-completion - is false against the locked §5
  pool: C1 below.)

Two **fresh** surviving attacks, at the exact AC-18 / AC-19 / D-A↔AC-11 seams.

**C1 - AC-18 vs AC-5 vs the locked §5 story pool · the Tier-1 celebration string *is* the completion
claim AC-5 forbids; "co-exist" is unrealizable with the approved artifact.** AC-18 asserts a
perfect-turn-taking incomplete run fires "the **Tier-1 story text** *and* asserts **no** completion …
both tests pass." That presumes a two-axis outro: a tier-keyed turn-taking celebration **plus** a
separable, completion-gated "completion beat." **But the locked artifact has no such separation.** §5's
"Outro tiers 1→3" column is a single fused string per event, and its Tier-1 cells are event-**success**
claims: "picture-perfect, **day was a hit**" (school picture day), "**dazzled the crowd**" (talent show),
"**the framed favorite**" (family photo), "**shone on stage**" (dance recital). AC-5 itself names the
completion claim to suppress with the parenthetical **`("came together", "day was a hit", etc.)`** - i.e.
verbatim the §5 Tier-1 string for school picture day. Concrete: perfect turn-taking (0 over-cap, all
passes `independent`), look **incomplete**, event = School picture day. AC-11/AC-18 → fire the Tier-1
story = "picture-perfect, day was a hit." AC-5 → suppress "day was a hit." The Tier-1 celebration text
**is** the forbidden completion claim; they cannot co-exist, and F-30 (the over-claim) recurs through the
tier-1 string on an unfinished look - a child who shows up to picture day un-made-over is told "day was a
hit." AC-18 is not satisfiable against §5 as written: realizing it requires **re-authoring the story pool
into two independent axes** (turn-taking praise × a separable completion beat), which reopens the locked
"Story pool - 6 events approved" parameter (§4). The spec presents AC-18 as already-consistent; it is not.

**C2 - D-A / AC-19 / AC-11 · a 0-action instant pass scores `independent`, so a wholly disengaged learner
earns all-independent passes and the Tier-1 celebration - F-1 survives on the *score* axis, which is the
one that drives the tier.** D-A: "An early pass (**budget not yet spent**, no prompt delivered, no
forfeit) is an at-least-as-strong voluntary relinquish → `independent`." AC-19 pins 1-of-3; the rule has
**no floor** - "budget not yet spent" includes **0 spent**. Concrete (reachable today: eval PT1 turn 2 /
F-1, "handed over immediately, with zero actions spent"): the learner taps Go, then immediately activates
the pass control with **0 actions**, every turn, for all N turns; look incomplete. Each pass: budget
unspent, no prompt, no forfeit → **`independent`**. 0 over-cap. AC-11 counts every scored pass →
**Tier 1**; AC-18 fires the Tier-1 turn-taking celebration. So the **maximal** turn-taking score and the
biggest celebration are handed to a learner who **never engaged** - a 0-action "pass" is not a relinquish
at all (the taught chain is *take a turn → relinquish*; nothing was taken to relinquish). AC-19 fixed
F-1's **data** gap (actions-used is now recorded) but not its **scoring** gap: the pass *score* - the
value AC-11's tier and the report's independent-count are computed from - still cannot distinguish
non-engagement from mastery, so a BCBA's report reads "N independent passes = mastery" for a learner who
did nothing. An `independent` pass must require the learner to have taken possession (≥1 engaged action
that turn), or a 0-action instant pass must carry a distinct non-independent code; as written, disengagement
scores as the target skill.

VERDICT: attacks-remain

### Round 3 - PROPONENT

Both fresh attacks land at the exact AC-18/§5 and AC-19/D-A seams my round-2 fixes opened. **Both
conceded**; none refuted.

**C1 - conceded (AC-18 unrealizable against the locked §5 fused strings).** Verified against §5
(spec line 111): the outro column is **one fused string per (event, tier)** - "picture-perfect, day
was a hit → looked great → got there, as a team" - and the Tier-1 cells *are* event-success claims
("day was a hit", "dazzled the crowd", "the framed favorite", "shone on stage"). AC-5 itself quotes
"day was a hit" as the completion claim to suppress. So my AC-18 ("fire the Tier-1 story **and**
assert no completion") was unrealizable: the fused Tier-1 string *is* the forbidden completion claim,
and F-30 recurs through it on an incomplete look. Resolved per the coordinator's scope authorization
by **restructuring each event's outro into two independent axes** - a tier-keyed **turn-taking line**
(teamwork only, no event-success) + a completion-gated **completion beat** (the event-success flavor) - **keeping the six approved events unchanged**. This is a correction toward §3.7.1's own
"generic-celebratory + teamwork, never claims a feature was transformed" rule, not a re-authoring of
the event set; §5's Tier-3 cells ("got there, as a team") already *are* the turn-taking register, so
the split is natural. The actual strings are **drafted at build for human review** (**L7**), with a
per-event escalation fallback if some event cannot express a tier-1 turn-taking line without an
event-success claim. D-G now carries the two-axis structure; AC-18 rewritten to fire the Tier-1
**turn-taking line** (not the §5 fused string) and to **forbid** any implementation that emits the
fused event-success string on an incomplete look.

**C2 - conceded (0-action instant pass scores `independent` → Tier 1 for zero engagement).** Correct
and important - AC-19 fixed F-1's **data** gap but left the **scoring** gap, and the score is what
drives the tier and the report. Reachable today (eval PT1 turn 2 / F-1: "handed over immediately,
with zero actions spent"). A 0-action pass is not a relinquish at all - the taught chain is *take a
turn → relinquish*, and nothing was taken. Fixed with a **≥1-engaged-action floor**: D-A now requires
possession (≥1 action) for a scored relinquish; a 0-action pass is a distinct **`no-engagement`**
outcome, never `independent`. I did **not** *block* the 0-action pass (that would recreate the
F-23/A4 deadlock and hide a clinically real disengagement) - I **score** it as the honest datum.
AC-11 folds `no-engagement` into the non-independent outcomes and requires **every** learner turn be
an engaged independent pass for Tier 1 (closing both the direct leak **and** the vacuous
"every-scored-pass-independent-over-zero-passes" leak). New **AC-20** pins that an all-0-action run
scores **Tier 3**, not Tier 1, and the report distinguishes non-engagement from mastery. AC-19 gains
the ≥1 floor.

Net: D-A amended (≥1-action floor + `no-engagement` code); D-G amended (two-axis outro); AC-5, AC-11,
AC-18, AC-19 amended; AC-20, L7 added. Claims stay **open** - the adversary posted `attacks-remain`,
not `dry`.

### Round 4 - ADVERSARY

**Concessions (round-3 seams genuinely closed).** L6, L7 not reopened (accepted human handoffs).
- **C1 - conceded.** D-G's two-axis outro (tier-keyed turn-taking line, no event-success + a
  completion-gated completion beat), the AC-18 rewrite (fire the Tier-1 *turn-taking line*, never §5's
  fused event-success string on an incomplete look), and L7 (build-time strings, human-reviewed, per-event
  escalation fallback) genuinely separate the axes. F-30-through-the-Tier-1-string cannot recur. Closed.
- **C2 - conceded.** The **≥1-engaged-action floor** + the distinct **`no-engagement`** code + AC-20
  (all-0-action run → Tier 3, never Tier 1) close the disengagement-scores-as-mastery leak on the *score*
  axis, and **scored-not-blocked** correctly avoids reviving the A4/F-23 deadlock. AC-11 folding
  `no-engagement` into non-independent also kills the vacuous-Tier-1 path. Clean.

One **fresh** surviving attack - an E1 trap opened precisely by the round-2/round-3 combination
(pass "available throughout" + budget a cap-not-quota) colliding with the *unchanged* §3.2 anchor.

**D1 - D-A / AC-2 / AC-19 vs §3.2 · the prompt-escalation ladder is anchored ONLY to budget-exhaustion,
but the budget is now a cap the learner need not reach - so every *sub-budget* pass is "before any app
prompt" by construction and scores `independent`, even when the learner relinquished only after a real
prompt. F-22 reborn on the sub-budget path - and it is structural, not the L6 who-taps residue.** §3.2
(spec line 33, unchanged through four rounds): "When the learner spends their **last allotted action**, a
relinquish opportunity opens with a no-cue wait window"; D-A restates it: "the wait-window → prompt
escalation anchors to **budget-exhaustion**: **once the learner has spent the budget without passing**,
the 3s window runs and then a prompt is delivered." So the app delivers a prompt **only** after
budget-exhaustion. But AC-19/AC-17 make the budget a **cap, not a quota** - "the learner is **never
forced** to spend the full budget before relinquishing." These two are in direct tension. Concrete:
budget=3, cue=full. The learner does **1 engaged action** (clears the ≥1 floor, D-A/AC-20 - this is *not*
a `no-engagement` turn), then stalls. The BT, seeing the child stuck, delivers a **real verbal/gestural
prompt** ("your turn's done - hand it over"); the learner then taps the pass control. App state at the
pass: **no app prompt was delivered** (the window is gated on budget-exhaustion; budget 1<3, so no window
ever opened), and **no forfeit flag** (no over-cap). AC-2's `independent` predicate - "no prompt yet
delivered this turn and no forfeit flag" - is **satisfied** → scored **`independent`**. The learner who
required a prompt to let go is recorded as an independent relinquish. Because AC-19 makes sub-budget turns
legitimate and common, **every** sub-budget pass is immune to the app's only prompt-delivery trigger:
"no app prompt delivered" is **vacuously true** for all of them, so they are **always** `independent`
regardless of actual prompt-dependence. A BT teaching a learner who does a couple of actions and then
needs prompting to relinquish reads **"all independent"** - the exact false mastery the rebuild exists to
kill (eval finding 2 / F-22), now on the *primary* target and **structural**: here the **learner** taps
the control (so L6/who-taps does not apply), yet the score is wrong because the app never fired its prompt.
The prompt-fade measure - the tool's stated primary purpose (§3.2: "the pass is primary") - silently
**skips every turn in which the learner takes possession but does not exhaust the budget**, i.e. exactly
the fading-in-progress learner the instrument is meant to track.

Corollary (same root): a sub-budget learner who takes ≥1 action and then **will not pass at all** triggers
**no** app escalation - no window (budget unspent), and "never-pass → `staff-prompted`" is only defined
*post-exhaustion* - so the turn has no app-driven resolution or score and is exitable only via the BT
end-trial control (F-6/F-23 reborn on the learner's *own* turn). The fix cannot be "require
budget-exhaustion before a pass scores" (that revives the AC-19 quota problem C2/B3 just closed); the
prompt escalation must key off **"possession taken + not relinquishing"** (an idle interval after the
learner's last action, or a BT-triggerable prompt event) rather than budget-exhaustion - otherwise a
conforming implementation passes AC-1/AC-2/AC-19 while the fade measure reports false independence on
every sub-budget turn.

VERDICT: attacks-remain

### Round 4 - PROPONENT

D1 lands - and it is the deepest attack of the debate, an E1 trap my own round-2/round-3 fixes opened.
**Conceded**; not refuted.

**D1 - conceded (sub-budget passes are vacuously `independent`; the app's prompt trigger, budget-
exhaustion, never fires sub-budget).** Reproduced against my own criteria: budget=3, cue=full; the
learner does 1 engaged action (clears the ≥1 floor - *not* `no-engagement`), stalls, the BT delivers
a real verbal prompt, the learner then passes. At the pass, the app never opened a window (budget 1<3,
and my D-A anchored the window to *budget-exhaustion*), and there is no forfeit flag - so AC-2's "no
prompt delivered this turn" was **vacuously true** and it scored `independent`. That is F-22 false
mastery reborn on the **primary** target, and - the sharp part - it is **structural, not L6**: the
*learner* taps the control, so who-taps is not the issue; the app simply never fired its prompt on any
sub-budget turn. Because AC-19 makes sub-budget turns legitimate and common, **every** fading-in-
progress learner (takes a couple of actions, then needs prompting to let go) would have read "all
independent" - exactly the learner the instrument exists to track.

Fixed as the coordinator directed - **re-anchored the ladder off budget-exhaustion**:
1. **§3.2/D-A re-anchor** - the wait-window/prompt escalation now starts from **possession-taken (≥1
   action) + a no-relinquish idle interval** measured from the learner's most recent action; budget-
   exhaustion is just the special case where the learner cannot resume. This satisfies the coordinator's
   "possession taken + not relinquishing," and (per C2/B3) it does **not** revive the quota - the learner
   still needn't exhaust the budget.
2. **Independence gated on *every* prompt, not the app's alone** - a pass is `independent` only if it
   precedes **both** the app's faded prompt **and** any **BT real** prompt (the §3.2 "prompt delivered"
   affordance, now explicitly deliverable on **any** turn). This is the direct kill: the BT prompt in
   D1's scenario forces `staff-prompted`. AC-2 rewritten accordingly; **AC-21** pins the 1-action-then-
   prompted turn → `prompted@full`/`staff-prompted`, never `independent`.
3. **Corollary closed** - the relinquish opportunity opening on possession+idle means a sub-budget
   never-pass now resolves to `staff-prompted` (defined sub-budget, not only post-exhaustion); **AC-22**
   pins that the learner's own turn cannot deadlock (F-6/F-23 not reborn there).

Honest residual, flagged not hidden: on a sub-budget turn the app cannot machine-tell a thoughtful mid-
task pause from a relinquish stall (**L8**). But this is a prompt-**timing** tuning matter, not a false-
independence hole - independence is gated on *any* prompt, and the BT (the observer) delivers the real
prompt on a genuine stall, so a stalling sub-budget learner scores `prompted`/`staff-prompted` via the
BT path even if the idle heuristic mis-fires. AC-1 also re-scoped ("t=5s after the window opened",
window measured from last action, not exhaustion). AC-19 clarified (independent early pass requires no
prompt from app **or** BT).

Net: D-A re-anchored (possession+idle; independence gated on app-or-BT prompt); AC-1, AC-2, AC-19
amended; AC-21, AC-22, L8 added. Claims stay **open** - the adversary posted `attacks-remain`, not
`dry`.

### Round 5 - ADVERSARY

**Concession - D1 direct form genuinely closed.** L6/L7/L8 not reopened as accepted limits. The
round-4 re-anchor closes D1's sub-budget vacuity two ways: (i) §3.2/D-A now start the window from
**possession-taken (≥1 action) + a no-relinquish idle interval** measured from the learner's most
recent action (so the app prompt *can* fire sub-budget), and (ii) independence is gated on **both** the
app faded prompt **and** any **BT real** prompt (AC-2/AC-21), so D1's "1 action → stall → BT verbal
prompt → pass" now forces `staff-prompted`, and AC-22 gives the sub-budget never-pass a defined
`staff-prompted` resolution with no deadlock. The original attack no longer fires.

One **fresh** surviving attack - and it is a textbook E1 trap (every AC green, the clinical value
wrong) opened by the round-4 re-anchor itself, and it **falsifies L8's own stated bound**.

**E1 - D-A "resume reopens the relinquish opportunity" + AC-2 "no prompt delivered *this relinquish
opportunity*" · a delivered prompt is opportunity-scoped, not turn-durable, so a prompted learner who
does one more action then passes launders `prompted`/`staff-prompted` back to `independent`.** The
round-4 fix made two coupled choices: AC-2 (lines 112-113) gates independence on "no prompt delivered
**this relinquish opportunity** from either the app or the BT," and D-A (lines 52-53) rules that "if the
learner **resumes** with an action, the relinquish opportunity **closes and a fresh one opens** when they
next stop, so a mid-task pause that drew **a prompt** is **not carried** into a later clean relinquish."
Together these make **every** prompt - including the **BT real** prompt - scoped to the *opportunity*,
and a single learner action mints a fresh, prompt-free opportunity. Concrete: budget=3, cue=full.
(1) Learner does action 1 (engaged - took possession, not `no-engagement`). (2) Stalls; the idle window
elapses and the app faded prompt fires; the learner still does not pass; the **BT**, judging a genuine
relinquish stall - *the exact L8 safety net* - delivers a **real verbal prompt**, so the pass is headed
for `staff-prompted`. (3) Instead of passing, the learner does **action 2** (a legal resume - budget
remains); per D-A the relinquish opportunity **closes**, and both the app and BT prompts belonged to that
now-closed opportunity. (4) The learner stalls briefly, then passes at t=1s in the **fresh** opportunity,
before any new prompt. AC-2 on the fresh opportunity - "no prompt delivered **this** opportunity from app
or BT" - is satisfied → **`independent`**. A learner who required **both** an app prompt **and** a real
BT prompt this turn, then laundered them with one token action, is scored an independent relinquish. This
is F-22 false-independence on the **primary** target, and it is **structural, not L6** (the *learner*
taps; the hole is that "prompt delivered" is scoped to the relinquish *opportunity* while a resume mints
a fresh one) and **not the L8 timing residue** - here the BT prompt fired *correctly* on a genuine stall.
It **directly falsifies L8's guarantee** (lines 261-263: "a stalling sub-budget learner is scored
`prompted`/`staff-prompted` via the BT path **even if the idle heuristic mis-fires**"): the resume-reset
makes the BT prompt **non-durable**, so the BT path is **not** the floor L8 leans on - a learner action
after it erases it. "One more thing before I hand it over" *after* being prompted is a textbook
compliance-delay pattern, and when the resumed pass is quick the BT gets no window to re-prompt. D-A's own
parenthetical carries the contradiction: "a … pause that drew **a prompt** is **not carried** into a
later clean relinquish" (prompt discarded on resume) vs. "**cannot** reintroduce false independence, since
a stalling learner is scored `prompted`/`staff-prompted` via the BT path **regardless**" (prompt durable) - both cannot hold. The design must decide whether a delivered prompt is opportunity-scoped or
**turn-durable**, and it needs the **BT real prompt** (and any prompt delivered at/after budget-exhaustion)
to set a **turn-level forfeit-`independent` flag** (like AC-4's over-cap flag) that a resume does **not**
clear - while still letting an app-faded prompt drawn during a genuine *mid-task* pause be discardable.
As written, all prompts are opportunity-scoped and the BT floor is resettable, so false independence
returns on the measure the tool exists to protect.

VERDICT: attacks-remain

### Round 5 - PROPONENT

E1 lands - a textbook E1 trap my round-4 "resume reopens the opportunity" clause created, and it
correctly catches my own self-contradiction. **Conceded**; not refuted.

**E1 - conceded (resume-reset launders a prompted turn to `independent`; falsifies L8's "regardless").**
Reproduced against my round-4 text: I scoped *every* prompt (app faded **and** BT real) to the current
relinquish *opportunity* (AC-2), and D-A said a learner action **resumes** - closing that opportunity
and opening a fresh, prompt-free one. So: budget=3, cue=full; action 1 → stall → app prompt → still no
pass → **BT real prompt** (the exact L8 safety net, fired correctly on a genuine stall) → the learner
does **action 2** (legal sub-budget resume) → the opportunity closes, both prompts belong to it → the
learner passes at t=1s in the fresh opportunity → AC-2 "no prompt this opportunity" satisfied →
**`independent`**. A learner who needed *both* prompts, laundered by one token action. The adversary
also correctly quoted my own contradiction: D-A said the prompt "is **not carried** into a later clean
relinquish" (discardable) *and* "**cannot** reintroduce false independence … via the BT path
**regardless**" (durable) - both cannot hold.

Fixed with the durability split the adversary and coordinator point to - **a turn-durable forfeit flag
(like AC-4's over-cap flag) that a resume does not clear**, set by **(i)** any **BT real prompt** (a
person had to intervene - not launderable), or **(ii)** any prompt delivered **at/after
budget-exhaustion** (no real resume is possible there - a further tap is over-cap → AC-4 anyway). Only a
**sub-budget app-faded prompt** stays **discardable**, and only by a **genuine resume** - that is the
legitimate L8 mid-task-pause case (a thoughtful learner who paused, drew a premature idle-cue, resumed,
and relinquished cleanly should *not* be tainted). D-A rewritten with the durable-vs-discardable rule;
AC-2 rewritten to gate on (a) no turn-durable flag **and** (b) no live discardable app-cue; new
**AC-23** pins the app-prompt→BT-prompt→resume→quick-pass sequence to `staff-prompted`, never
`independent`. L8 corrected: it is the **durability** of the BT prompt (AC-23), not mere delivery, that
makes the BT path a floor - and the sole machine-open path (a BT who never prompts a genuinely stalling
learner, letting a bare app-cue be laundered) is named as the accepted **L6** procedural boundary, not a
fresh hole.

Honest scope note: I did **not** make the sub-budget app-cue durable. That would tax a genuinely
thoughtful learner (pause-to-think → premature idle-cue → permanent forfeit), contradicting cap-not-quota
(AC-17/AC-19). The clinically dangerous case - the learner who needs a **person** to intervene - is
closed durably; the residual (bare app-cue + token resume, no BT prompt) is the accepted procedural
boundary, since a BT running the program delivers the real prompt on a genuine stall.

Net: D-A amended (turn-durable forfeit flag for BT-real / at-exhaustion prompts; sub-budget app-cue
discardable-on-genuine-resume); AC-2 rewritten; AC-23 added; L8 corrected. Claims stay **open** - the
adversary posted `attacks-remain`, not `dry`.

### Round 6 - ADVERSARY

**Concession - E1 genuinely closed.** The durability split does it: a **turn-durable** forfeit flag
(like AC-4's over-cap flag) is set by any **BT real prompt** or any prompt **at/after budget-exhaustion**
(AC-23), and AC-2 now gates on "(a) no turn-durable flag **and** (b) no live discardable app-cue," so
**no sequence of legal actions** launders a BT-prompted or at-exhaustion-prompted turn back to
`independent`. The lone remaining discardable path - a *bare* sub-budget app-faded cue cleared by a
genuine resume with **no** BT prompt - is exactly the accepted **L6/L8** boundary (a BT who fails to
prompt a genuinely stalling learner), and the proponent names it as such rather than hiding it. I do
**not** reopen L6/L8. E1 is closed.

One **fresh** surviving attack - the one response class the whole debate never touched. Every attack
A1 - E1 was aimed at **the pass**. The **ask-back** - the path where the eval's headline bug actually
lives - has been left behind by five rounds of pass-hardening.

**F1 - §3.2 "the pass and the ask-back are scored with *this same model*" vs the AC set · every scoring
AC (AC-1/AC-2/AC-4/AC-19 - AC-23) is scoped to *the pass*; the ask-back carries only a **reachability** AC
(AC-15), so the original F-22 inversion can ship on the ask-back with every AC green - reproducing eval
finding 2 verbatim on the path where it originated.** §3.2 (spec line 39): "**Both** the pass (relinquish)
and the **ask-back** are scored with **this same model**. **The pass is primary and is built + verified
first.**" But the eval's finding 2 / **F-22** - "the one cue level a BT would use to probe independence
silently manufactures perfect data," the single worst clinical defect in the report - is the **ask-back**,
not the pass: give-back = "They forget → I ask", ask cue = **None (probe)**; `confirmAsk()`
(index.html:586) scores `independent = !cueVisible`, and `partnerDone()` (:584) arms the cue timer **only**
when `cueLevel !== 'none'`, so at None `cueVisible` never turns true → **every** ask scored `independent`
(37 s silent → `independent`). Now look at what five rounds hardened: D-A, AC-1, AC-2, AC-4, AC-19 - AC-23
are all written for "**a pass on the learner's own pass control**" (AC-2 verbatim). The ask-back uses a
**different control** (`onConfirmAsk` / "✓ I asked!", index.html:254), and **no** amended AC governs its
score. AC-15 - the **only** ask-back AC - pins **reachability** ("reachable on a counted partner turn,"
eval finding **3**), not the independent-vs-prompted **score**.

And "the same model" **cannot be applied mechanically**, because the rebuilt model's load-bearing pieces
are all pass-specific with no ask-back analog: the **≥1-engaged-action possession floor** (AC-19/20, the
C2 fix) - the ask-back has no action budget or "engaged actions" to floor on; the **over-cap forfeit flag
and at/after-exhaustion durability** (AC-4/AC-23, the B2/E1 fixes) - no budget, no over-cap, no exhaustion
exist on the ask-back; the **window anchor** (D1 fix: possession-taken + idle from the learner's last
action) - the ask-back's window must open on the **staff's "forget,"** a machine-invisible staff-idle
event on a counted turn (the very thing AC-15 had to make reachable), and its anchor is never specified.
So the ask-back needs its **own** worked-out scoring (a wait/possession analog, a staff-idle window
anchor, and the same durable-forfeit rule), and **none of it is pinned**.

Concrete E1 trap: a conforming build implements the pass exactly per AC-1/AC-2/AC-23 **and** makes the
ask-back reachable on a counted turn (AC-15 ✓), but scores the ask-back with the **surviving `confirmAsk`
model** (`independent = !cueVisible`, timer un-armed at cue = None). Set give-back = "They forget → I
ask", ask cue = **None**. The learner sits silent 37 s, taps "✓ I asked!" → **`independent`**. Every
acceptance criterion is green - AC-15 (reachable) ✓, AC-1/AC-2 (the pass, correctly built) ✓, and
**nothing constrains the ask-back score** - while eval finding 2 / F-22, the report's worst defect, is
reproduced **verbatim** on its original site. §3.2's "same model" is an unpinned **intent**, and "the pass
is primary and verified first" signals the ask-back's scoring may not even be exercised (the §6
verification list drives "independent-vs-prompted across cue levels" without separating the two response
classes, so a pass-only probe passes). This is **not** an L6/L8 procedural residue - it is a scope gap:
the ask-back must be pinned by its own scoring AC (possession/wait analog + staff-idle window anchor +
durable-forfeit rule), or the primary inversion the rebuild exists to kill survives untouched on the
relinquish chain's second response.

VERDICT: attacks-remain

### Round 6 - PROPONENT

F1 lands - and it is the most consequential gap of the whole debate: five rounds hardened **the pass**
while the eval's **headline** defect (finding 2 / **F-22**) actually lives on the **ask-back**, which
carried only a reachability AC. **Conceded**; not refuted.

**F1 - conceded (ask-back scope gap; F-22 could ship verbatim on its original site).** Verified: §3.2
(spec line 39) says "**both** the pass **and** the ask-back are scored with **this same model** …**the
pass is primary and verified first**," but every scoring AC I wrote (AC-1/AC-2/AC-4/AC-19 - AC-23) is
verbatim scoped to "**a pass on the learner's own pass control**." The ask-back uses a **different**
control (`onConfirmAsk` / "✓ I asked!", index.html:254), and its only AC - AC-15 - pins **reachability**
(finding 3), not the **score**. Meanwhile F-22 *is* the ask-back: `confirmAsk()` scores
`independent = !cueVisible` (index.html:586) and `partnerDone()` arms the cue timer only when
`cueLevel !== 'none'` (:584), so at cue=None a 37 s silent ask scores `independent`. So a conforming
build could implement my hardened pass, make the ask-back reachable (AC-15 ✓), and score it with the
surviving `!cueVisible` model - **every AC green, F-22 reproduced verbatim**. And the adversary is right
that "same model" can't transfer mechanically: the possession floor, over-cap/exhaustion durability, and
possession+idle anchor are all pass-specific.

Fixed by giving the ask-back its **own** hardened model - **D-K** - the ask-back analog of the pass,
re-anchored piece by piece:
- **Window anchor** → the **staff-"forget" onset** (staff turn completes, counted or timed, possession
  not handed back) replaces possession+idle. Machine-visible on a counted turn (the reachability AC-15
  guaranteed).
- **Independence** → emitted after the onset, before any prompt (**app cue OR BT real prompt**), no
  turn-durable forfeit flag - identical gating to AC-2; **silent-probe delivers the prompt by
  window-elapse** (AC-1 analog), so the 37 s silent ask → `prompted@silent`, never `independent`
  (**AC-24**, the F-22 kill on its own site).
- **Mand floor** → an ask **before** the onset is a distinct **`early-ask`** code (the `no-engagement`
  analog), and it is now **recordable** - fixing eval **F-33** (the currently-unrecordable too-early
  ask) as a bonus (**AC-25**).
- **Durability** → the ask-back is actually **stricter/simpler** than the pass: no interleaved learner
  actions during the staff's forget → **no** E1 resume-launder and **no** L8 discardable-cue case; any
  delivered prompt forfeits unconditionally, and a BT real prompt is turn-durable (**AC-26**).

Two things I resolved toward the locks and flagged, not silently chose:
1. **Tier membership.** §3.7 keys the outro tier to **pass** independence + over-cap **only**. I kept
   the ask-back **reported** (§4 column) but **not tiered** (AC-26, and annotated AC-11 so this doesn't
   reopen the "pure function of pass" predicate). Whether the ask-back *should* feed the tier is a
   **human scope call**, flagged, defaulting to the §3.7 lock.
2. **Verification.** "The pass is primary and verified first" + the §6 list (which doesn't separate the
   two response classes) means a pass-only probe could pass; D-K requires the ask-back scoring be
   **exercised separately** (silent-probe ask, early-ask, BT-prompt durability).
The ask-back inherits **L6** (the "✓ I asked!" button is BT-confirmed; the mand is a verbal act the
machine can't detect) - no new limit, the accepted procedural boundary. No part of the model genuinely
failed to mirror the pass, so nothing here is a blocking escalation beyond the flagged tier scope call.

(Housekeeping: restored the "### Stated limits" subheader, dropped by an earlier round's edit.)

Net: D-K added (ask-back hardened model); AC-15 amended (reachability necessary-not-sufficient); AC-24,
AC-25, AC-26 added; AC-11 annotated (ask-back reported, not tiered). Claims stay **open** - the adversary
posted `attacks-remain`, not `dry`.

### Round 7 - ADVERSARY

**Concessions (D-K genuinely closes what it targets).** Ask-back tiering (AC-26/§3.7 lock) and L6/L7/L8
not reopened (accepted handoffs).
- **AC-24 - conceded.** Arming the ask window on the forget onset regardless of cue level, with
  silent-probe delivered by **window-elapse**, kills F-22 on its own site: a 37 s silent ask →
  `prompted@silent`, never `independent`. This holds **wherever the onset fires** (see G1 for where it
  doesn't). The `!cueVisible` inversion has no analog once the window is time-based.
- **AC-26 - conceded.** The durability reasoning is sound and genuinely **stricter** than the pass: with
  no interleaved learner actions during the staff's turn there is no E1 resume-launder and no L8
  discardable-cue, so any delivered prompt forfeits unconditionally. Correct.
- **AC-25 - conceded as an F-33 fix.** Recording the too-early ask as a distinct `early-ask` code is a
  real improvement over the currently-unrecordable interrupt. (But it becomes the *wrong* code under G1.)

One **fresh** surviving structural break - in D-K's onset anchor itself.

**G1 - D-K forget-onset anchor · the ask-back window is anchored to "the staff's allotted actions spent"
(the pre-D1 *exhaustion* analog), not the *staff-idle* analog D-K claims - so on the counted+forgets
config the window never opens when the staff actually forgets, reproducing eval finding 3 / F-23 on the
ask-back and, via AC-25, mis-scoring the correct mand as `early-ask`. It contradicts AC-15 and D-K's own
"possession+idle analog" label.** D-K (lines 122-125): "Window anchor = the staff-'forget' onset
(**analog of the pass's possession-taken + idle**): the no-cue wait window opens when the staff's turn
**completes** (**counted: allotted staff actions spent**; timed: staff timer elapsed) and possession is
not handed back." The pass's D1 fix re-anchored the window **off budget-exhaustion onto possession-taken +
idle**, precisely because exhaustion never fires when the actor takes possession then **stops short**.
D-K claims the ask-back onset is that same possession+idle analog - but the trigger it enumerates for a
**counted** turn is "**allotted staff actions spent**," which is the *exhaustion* analog, the very anchor
D1 replaced. The proponent's own F1 concession named the correct trigger - the window "must open on the
staff's 'forget,' a **machine-invisible staff-idle event** on a counted turn" (Round-6 ADVERSARY, lines
921-923) - then D-K anchored it to actions-spent instead of staff-idle.

Concrete (the exact eval finding-3 / playthrough-4c-B config): give-back = "They forget → I ask", Their
turn = **3 actions (counted)**, cue = full. The staff (BT) **forgets** - genuinely does nothing (0 of 3
allotted actions), which is *the scenario the mode is named for* (Method panel, index.html:281: "'They
forget' → I ask = contrived MO + interrupted chain"; eval finding 3: "the partner 'forgot', which is
exactly the condition the program is named after"). D-K's counted onset requires "allotted staff actions
spent" → 0 < 3 → the staff turn never completes → **the forget onset never fires → the ask-back window
never opens.** Two grounded wrong outcomes:
- (i) **Deadlock - F-23 reborn on the ask-back.** If the learner waits for the window, it never comes; the
  "They forget → I ask" program is again reachable *only when the staff does NOT forget* (spends all 3
  actions) - the opposite of the scenario (eval finding 3 verbatim; current-build F-6: a counted partner
  turn has no exit but spending `partnerGoal` actions). AC-15 - "reachable on a counted partner turn,
  fixing eval finding 3" - is asserted but **unachievable by D-K's stated mechanism**.
- (ii) **Scoring inversion via AC-25.** If the learner correctly notices the forget and asks anyway, AC-25
  scores it **`early-ask`** ("before the onset"), because the machine never registered a forget onset. The
  clinically *correct* mand under the contrived MO - the entire target of the interrupted-chain program - is recorded as a premature interruption, **never `independent`**. The right behavior is filed as the
  error code.

Root/fix: D-K mis-labels its anchor as the possession+idle analog while enumerating the exhaustion analog.
The forget onset must fire on **staff-idle** - the staff has held possession without acting or handing back
for the wait interval - the true analog of the pass's D1 re-anchor, not "allotted staff actions spent."
(Timed staff turns are fine: the timer elapses regardless, so the break is specifically the **counted +
forgets** config - a config the setup supports and AC-15 names.) As written, the ask-back re-imports the
pre-D1 exhaustion bug that five rounds removed from the pass.

VERDICT: attacks-remain

### Round 7 - PROPONENT (final turn; round cap reached)

G1 lands - and it is the cleanest possible closing catch: I made the **exact** mistake D1 fixed on the
pass, re-imported one round later on the ask-back onset. **Conceded**; not refuted.

**G1 - conceded (D-K anchored the counted-turn onset on the pre-D1 exhaustion analog).** D-K labelled
its anchor "the pass's possession-taken + idle analog" but then enumerated, for a counted turn,
"**allotted staff actions spent**" - which is *exhaustion*, the very anchor D1 removed from the pass
because it never fires when the actor takes possession then stops short. On give-back=forgets + Their
turn=3 counted, a staff who **genuinely forgets** (0 of 3 - the scenario the mode is named for, Method
panel index.html:281, eval finding 3) never "spends the allotted actions," so the onset never fires:
(i) the ask-back window never opens → F-23/F-6 deadlock reborn on the ask-back, and AC-15's "reachable
on a counted partner turn" is unachievable by D-K's stated mechanism; (ii) a learner who correctly asks
is filed `early-ask` (no onset registered) - the clinically correct mand recorded as the error code.
The adversary even quoted my own Round-6 concession naming the right trigger ("machine-invisible
staff-idle event") that D-K then contradicted.

Fixed by re-anchoring D-K's onset onto **staff-idle** - the true D1 analog (the staff holds possession
without acting or handing back for the wait interval), firing for **any** number of staff actions
(0…N), or on an explicit **BT signal** (in "forgets" mode the staff *is* the BT, deliberately modeling
the forget, so the BT disambiguates a mid-turn pause from a forget - the staff-side of L8). Timed turns
were already fine. **AC-25** corrected (`early-ask` = asking while the staff is *still actively taking
their turn*; a genuine 0-action forget *does* fire the onset, so the correct mand scores `independent`,
not `early-ask`); new **AC-27** pins the counted+forgets+0-action scenario → window opens, no deadlock,
correct mand scored. The pre-D1 exhaustion bug is now removed from the ask-back exactly as D1 removed it
from the pass.

**Closing the debate (round cap reached; the last adversary turn was `attacks-remain`, not `dry`).**
Per PROTOCOL this is a **cap-escalation**, not certified convergence - expected and correct. I have
folded every conceded point across all seven rounds, moved the settled claims into **CONVERGED** with
provenance (which attack hardened what), and reduced **OPEN** to a crisp, self-contained list for the
human: the accepted handoffs (L6, L7, L8, the ask-back-feeds-tier scope question) and **G1's staff-idle
re-anchor as the one fix not re-tested by a final adversary pass** - the honest residual of stopping at
the cap. The design is materially hardened: the original inversion (F-22) is killed on **both** its
sites (pass and ask-back), the three motivating defects are all closed, and every leak the adversary
found is pinned by an AC.

Net: D-K onset re-anchored to staff-idle; AC-25 corrected; AC-27 added; CONVERGED populated with
seven-round provenance; OPEN reduced to the human hand-off list.

VERDICT: open (cap-escalation - adversary was not `dry`; residual items enumerated in OPEN for the human)

---

## CONVERGED (proponent-owned)

Settled across rounds 1-7 - each fix was conceded as genuinely closed by the adversary in the
following round (provenance = which attack hardened which claim). The CLAIMS section above carries the
full hardened text; this is the sign-off ledger.

**Pass scoring (the primary target).**
- **D-A / AC-1 / AC-2** - independence by wait-window; learner-operated control; gated on *any* prompt
  (app faded **or** BT real); window anchored to **possession-taken + no-relinquish idle** (not
  exhaustion). Hardened by **A1** (structural cue=none analog killed), **B3** (pass available
  throughout; early voluntary relinquish scored), **D1** (re-anchor off exhaustion; sub-budget prompt
  gating), **E1** (turn-durable forfeit flag; no resume-launder).
- **AC-4** - over-cap sets a **turn-durable** forfeit flag, decoupled from cue visibility; per-turn
  scope. Hardened by **A3** (turn-scoped; fade curve preserved), **B2** (event-flag not visibility;
  silent-probe → `prompted@silent`).
- **AC-19 / AC-20** - ≥1-engaged-action **possession floor**; a 0-action pass is `no-engagement`,
  never `independent`; an all-0-action run scores Tier 3. Hardened by **C2** (scoring-axis F-1 fix).
- **AC-21 / AC-22 / AC-23** - sub-budget prompted pass → non-independent; sub-budget never-pass →
  `staff-prompted` (no own-turn deadlock); BT-real / at-exhaustion prompts turn-durable and
  unlaunderable by a resume. Hardened by **D1** and **E1**.
- **AC-17** - single fixed auto-scaled per-turn cap; extra-time reinforcer is non-cap. Hardened by **A5**.

**Ask-back scoring (the headline-defect site).**
- **D-K / AC-15 / AC-24 / AC-25 / AC-26 / AC-27** - the ask-back gets the pass model, anchored to the
  **staff-idle forget onset**; silent-probe delivered by window-elapse kills **F-22** on its
  `confirmAsk` site (37 s silent ask → `prompted@silent`); an ask before the staff-idle onset is a
  recordable `early-ask` (fixes **F-33**); reported, not tiered. Hardened by **F1** (whole model) and
  **G1** (onset re-anchored off exhaustion → staff-idle; *G1's fix is the one item not re-tested by a
  final adversary pass - see OPEN*).

**Completion / outro / tier.**
- **D-D / AC-5 / AC-7 / AC-16** - completion = finish the look **or** N turns (hard bound); the trial
  is always terminable; incomplete trials print (marked incomplete), no deadlock, no completion
  over-claim (**F-30**). Hardened by **A4**, **C2**.
- **D-G / AC-11 / AC-18** - outro tier keyed to **pass** turn-taking only; `staff-prompted` and
  `no-engagement` are non-independent; the outro is two axes (tier-keyed turn-taking line +
  completion-gated completion beat), so an incomplete perfect-turn-taking run gets Tier-1 turn-taking
  praise with **no** completion claim. Hardened by **A2**, **B1**, **C1**.

**Config / data / device (motivating defects & carried claims).**
- **D-B** (over-cap refuse+flag+prompt, kid feedback in **every** count mode), **D-E** (timed =
  partner-only), **D-H** (de-identified print log), **D-I** (hidden locks), **D-F**, **D-J**, and
  **AC-3 / AC-8 / AC-9 / AC-10 / AC-12 / AC-13 / AC-14** - carried from the grilled spec and un-refuted
  across seven rounds. The **three motivating defects** (untrustworthy scoring · invisible violations ·
  blank-doll win) are all closed.

---

## OPEN (proponent-owned)

The round cap was reached with the last adversary turn `attacks-remain` (not `dry`), so this is a
**cap-escalation, not certified convergence**. Every attack **A1 - G1 was conceded and folded** into a
pinned criterion (see CONVERGED and the DEBATE LOG). What remains for the human is **not** an open
design contradiction - it is one un-re-tested fix plus four accepted hand-offs / scope calls:

1. **G1 fix - the one substantive residual: not re-tested by a final adversary pass.** D-K's ask-back
   forget onset was re-anchored *this final turn* from "allotted staff actions spent" (the pre-D1
   exhaustion bug) to **staff-idle** (**AC-27**), mirroring D1's pass re-anchor. The reasoning closes
   both the deadlock and the `early-ask` mis-score, but because it landed on the cap turn no adversary
   round probed it. **Recommend:** a fresh adversarial pass - or the build's Playwright verification - exercise the **counted + forgets + 0-staff-action** ask-back path specifically.
2. **L6 - who-taps on one device (ACCEPTED, human ruling 2026-07-24).** The app cannot machine-prove
   the learner (vs the BT) activated the pass control or the "✓ I asked!" control; mitigation is BT
   procedural fidelity. Applies to **both** the pass and the ask-back.
3. **L7 - §5 outro strings re-authored at build (human-reviewed).** The six approved events are
   unchanged; only the outro text is restructured into the two-axis form (tier-keyed turn-taking line +
   completion-gated completion beat). Strings are drafted at build for human sign-off; per-event
   escalation if some event can't express a tier-1 turn-taking line without an event-success claim.
4. **L8 - pause-vs-stall / forget-vs-mid-turn window timing (tuning).** The app can't perfectly tell a
   thoughtful learner pause from a relinquish stall (pass) or a staff mid-turn pause from a forget
   (ask-back). Bounded: the window is configurable, the BT disambiguates/delivers the real prompt, and
   independence is gated on any prompt with the durable-forfeit rule - so this affects prompt *timing*,
   **never** false independence.
5. **Ask-back-feeds-tier - scope question.** The outro tier is keyed to **pass** turn-taking only
   (§3.7 lock); the ask-back is **reported but not tiered** (AC-26). Whether the human wants the
   ask-back to also drive the child-facing tier is a deliberate product call, defaulted to the lock.

None of items 2-5 blocks proceeding to tickets (they are decisions/tuning the design already routes to
the human); item 1 is a verification to-do. The design is **materially hardened**: the original
inversion **F-22 is killed on both its sites** (pass and ask-back), the **three motivating defects are
closed**, and every leak found across seven rounds is pinned by an AC.
