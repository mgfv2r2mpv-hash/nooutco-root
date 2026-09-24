# ClickClackOracle, overnight 2026-09-23

The running plan and log for the overnight GNHF run. Kaleb asked for this on the night of 2026-09-23 and tries the app in the morning. Each slice gets tested (`npm test`, node plus Playwright WebKit and Chromium), built (`app/build.sh`) and committed on this branch. Nothing is pushed.

The principle behind the scoring, in his terms: **thinking is never punished; only typos are.**

## Checklist

One line per point of his ask. A line is done only when it names the test or screenshot that proves it.

| # | Ask | Status | Proof |
|---|-----|--------|-------|
| 1 | Remove the scoring cross-purposes: deleting a thought never costs speed, accuracy, band or star; bands he can climb; a personal ladder | **done** (slice 1) | `tests/drill-cross-purpose.test.mjs` (8 tests); `drills.spec.js` "a thought taken back with plain Backspace costs no error..." in WebKit and Chromium; band tests updated in `drill-score.test.mjs` and `drill-panel.test.mjs` |
| 2 | Strict Shift mode, default on: a same-side Shift refuses the key and flashes, the combo goes on extinction; toggle in settings; refusals counted and reported | **done** (slice 2) | `tests/drill-strict-shift.test.mjs` (5 tests); `drills.spec.js` "strict Shift, on by default...", "strict Shift refuses in a copy round too...", "strict Shift can be turned off in settings..." in WebKit and Chromium; screenshot of the refusal in the margin, light and dark |
| 3 | Read-and-consider screen after the copy round: Respond (Return) or Shelve (S); a shelved passage comes back with different transcription text | **done** (slice 3) | `tests/drill-shelf.test.mjs` (9 tests, including every passage has a checked variant); `drills.spec.js` "after the copy round the passage comes back to read...", "S shelves the passage...", "a shelved passage comes back the next day in new words...", "the settle after the bell holds on the read screen too..." in WebKit and Chromium; screenshots of the read screen, light and dark |
| 4 | Achievements: well over 150, more variety, conversation achievements, and a dynamic "Your nemeses" engine from his own data | **done** (slice 4) | `tests/drill-nemeses.test.mjs` (12 tests: 185 static, baton chains, Keep going, carried across days, shelf, strict clean, domains, and the four nemesis kinds with spotting, taming, sample guards and replay); `drills.spec.js` "a round that spots a nemesis says so..." in WebKit and Chromium; screenshots of the nemesis line and the "Your nemeses" board, light and dark |
| 5 | Clinical knowledge that cycles (spaced repetition), "consider the other side" prompts, and a much bigger storehouse (bank questions in all 9 domains, 20+ passages for w m b u c with variants, oracle seeds) | **done** (slices 5a, 5b, 5c): spaced review and the four lenses (5a); a bank question for all 104 outline items and 30 oracle seeds (5b); 21 passages for w m b u c, each with a variant, and a picker that rotates through them (5c) | `tests/drill-review.test.mjs` (11 tests: boxes, thin answers back tomorrow, Keep going is one answer, no two reviews in a row, lens rotation, home line, lens achievements, oracle told to bring the other side); `drills.spec.js` "a bank question answered days ago comes back for review through a lens..." in WebKit and Chromium; `tests/drill-storehouse.test.mjs` (6 tests: every outline item askable, new questions ASCII with two sourced bullets, only checked citations, seeds take no side, least-used seed, seeds and map take turns); `drills.spec.js` "with no topic typed the oracle opens on a live question for his view..." in WebKit and Chromium; `tests/drill-storehouse.test.mjs` (4 more: 21 new passages with checked sources only, every one with a variant and the set heavier on w m b u c than the first sixteen, a w m b u c player rotates through 12 different passages with 8 or more new, the punishment take cites the 3rd edition chapter title) |
| 6 | Ingest research with his responses and tone: the queued entry carries the expert's claims, sources and his stance; DRAFT_SYSTEM proposes consensus and dissent; local tone metadata in the kept sidecar | **done** (slice 6) | `tests/drill-stance.test.mjs` (8 tests: tone counts, stance, overlapping phrases count once, research context for bank, passage, baton and oracle with the reflection left out, the draft prompt carries research and only the stance label, DRAFT_SYSTEM asks for consensus and dissent, kind and sources on the proposal, the eight-word guard still holds); `drills.spec.js` "a kept respond answer carries the passage it answered and a local stance..." in WebKit and Chromium |
| 7 | Dazzle the non-typing screens (home, read-and-consider, results, band level-up, trophy reveals, board); typing surface stays calm; reduced motion; light and dark; offline | **done** (slice 7, over the ornate layer already in place): the bands as a gilded road on the home screen, a crest the first time a round reaches a band (on the read screen too for a copy round), a bigger burst for it, and trophies revealed one after another | `tests/drill-bands.test.mjs` (6 tests: band from the numbers not the stored name, highest band, level up only past the prior best, three-round guard, old "Professional" records fake nothing, the road); `ornate.spec.js` "the home screen draws the bands as a road...", "a first launch has no road yet", "a round that reaches a band for the first time drops a crest...", "a round inside a band already reached gets no crest", "a copy round that opens a band shows the crest on the read screen..." in WebKit and Chromium, beside the earlier ornate tests (calm while typing, gilded frames, confetti once, reduced motion skips it); WebKit screenshots of the home road, the results crest and the read-screen crest, light and dark |
| 8 | Fun and instructive: small real teaching moments, e.g. a 30-second nemesis drill, offered and never forced; fix what the adversarial review finds | **done** (slice 8): a thirty-second drill on his newest untamed nemesis (or his trickiest key), offered on the home screen and the results (D), with a line that teaches the finger and row; its numbers live in their own log, so it never moves a best, a band or a nemesis; three new trophy families; the review's findings fixed (no band name on a word list, the basis line names the drill) | `tests/drill-tame.test.mjs` (10 tests: fingers and rows, the target and its fallback, confusion and pair targets, the refused-capital lesson, real words two in three on target, capitals and pairs, the drill as a passage, the report from the score's numbers, the log numbers-only and capped, trophies with true dates that never tame a nemesis or move a band); `drills.spec.js` "home offers a thirty-second drill on his nemesis..." and "the results of an ordinary round offer the nemesis drill on D..." in WebKit and Chromium; WebKit screenshots of the home offer, the drill and its results, light and dark |

## Slice log

### Slice 1: thinking is never punished (2026-09-23 23:43 EDT)

What changed:

- In a composed round (answer, respond, oracle), a plain Backspace run is a **revision** when it takes out more than one word, or one whole word of three letters or more that he then replaces with a different word. "teh " taken back and retyped "the" stays a typo correction (a Damerau distance check, `nearWord` in `web/score.js`). Option and Command+Backspace were revisions already.
- Revisions are never errors: they do not touch accuracy, the 96% band gate or the 97% star. GWAM already counted every character he produced; the results now say so, with the keys the revisions took out and the words kept, and the history record carries `revisedKeys` and `keptWords` (numbers only).
- Uncorrected unknown words in the final text still cost NWAM. Copy rounds keep strict reference scoring: the same whole-word delete is a correction there.
- A changed mind is no longer read as a tricky key, so "fast" rewritten as "slow" does not file f as a miss.
- Bands recalibrated from his numbers (median 89 NWAM, best 100): Expert 85, Elite 95, Master 105, Virtuoso 115, Stenographer 125 above Professional 75. Old records keep the band name they were given; the band trophies replay from history, so their dates stay true.
- Personal ladder on the results: the next band, then his usual at this clock (median of his last ten), his best, and the next milestone of five.

Adversarial review:

- *Could it make him use the app less?* The first drill after this lands will read "Expert" where it read "Professional", which is a demotion in name only. The ladder line under it now always has a next rung, which is the point. Two new band trophies (Expert Hands, Elite Fingers) replay from history and appear silently rather than with a reveal, because the before and after trophy cases are both computed on the new bands. That is honest but misses a celebration; slice 7 (level-up moment) should give it one.
- *New cross-purpose?* The classifier is generous in one direction: a garbled word taken back whole and retyped as something more than two edits away is called a revision, not a typo. That errs toward "never punish thinking", which is his ruling. It cannot be gamed into a better NWAM, because a word left wrong in the final text still costs NWAM.
- *Calm typing surface?* Untouched. All of this renders after the bell.
- *Does it feed the expert?* Indirectly: he can now delete a bad thought without a scoring cost, so what reaches the expert is the thought he meant. Only the final text is ever kept.

Stickiness: **7/10.** It removes the thing that made him keep weak thoughts to protect his score, and every result now has a next rung, but nothing new is fun yet.

### Slice 2: strict Shift, the wrong combo on extinction (2026-09-23 23:49 EDT)

What changed:

- **Strict Shift, on by default.** When the first capital of a Shift press is taken with the Shift on the key's own side, the page refuses the key: nothing lands in the box, and the margin flashes. The watercolour Shift paints on the side he should have used, and the key he hit shows struck through and shaken on its own side (`shiftFx.refuse` in `web/shift.js`). Reduced motion drops the shake and keeps the fade.
- **No sneaking the retry.** After a refusal the tracker judges the next capital again (`rejudge`), so holding the same wrong Shift and pressing again is refused again. "EHR" on one correct held Shift still passes whole, as before.
- **Caps Lock capitals are never judged.**
- **A refusal is not a typing error.** It is logged as a `refused` event, which the scorer's event filter never sees, so speed, accuracy, the band and the stars do not move. `refusedStats` in `web/score.js` counts it apart, by hand and by key.
- **Reported.** The results' rhythm list says e.g. "2 capitals refused for a same-side Shift (T 2x); 5 capitals refused this week, down from 9 last week" (`refusedWeeks` and `refusedText` in `web/panel.js`). Only rounds that ran with strict on carry a count, so an older record never passes for a clean week. The history record carries `refused` and `refusedKeys` (single letters, never text).
- **Toggle** on the setup screen, "Strict Shift: a same-side Shift refuses the capital", saved in settings as `strictShift`. Off, the old lenient trainer runs (paint, flash, let it through).
- The old same-side Playwright test now runs with strict off, because it tests the lenient trainer, which still exists as the setting.

Adversarial review:

- *Could it make him use the app less?* A refused key at 90 WPM is a hard stop, and it will cost him speed for a few days. That cost is the point, since he asked for extinction, but the first sessions may feel worse and his NWAM may dip. The weekly "down from" line is the counterweight: it gives him the curve to watch while the habit fades. If it grates, the toggle is on the setup screen, one click.
- *New cross-purpose?* A refused key still eats clock time, so strict mode costs speed indirectly. I left it that way on purpose: the time lost is the natural consequence, and not charging it as an error keeps the band honest. The `shiftSide` tip and its trophy will fire less under strict, because refused capitals never reach `shiftStats`. The dynamic nemesis engine in slice 4 should read `refusedKeys` instead, so a refused combo can become a "tame it" achievement.
- *Calm typing surface?* Yes. The whole flash stays in the side margins; the card and the text do not move.
- *Does it feed the expert?* No. This is a typing slice. It only sends numbers to history.
- *Untested:* Caps Lock. Playwright cannot hold Caps Lock reliably in both engines, so that check (`getModifierState("CapsLock")`) is covered by reading the code only.

Stickiness: **7/10.** It turns a nag into a rule he asked for and gives him a weekly number that should fall, but the first few sessions will be slower.

### Slice 3: read it after, not before (2026-09-23 23:56 EDT)

What changed:

- **The copy round is typed cold.** The hint and placeholder now tell him he gets to read the passage properly afterwards, so he has no reason to read ahead.
- **Read and consider.** When the copy round ends, a new screen shows the passage as a page to read: a parchment folio with a drop cap, the title and source, the text split into paragraphs, the expert's sources for a baton passage, and "Then answer this" with the respond question. One line at the top says how the copy went, and any trophies from the round show there too. The clock is off.
- **Three keys.** Return responds (the one-minute respond round, as before). S shelves it and starts the next passage. N shows the copy round's full numbers, and N again comes back to the page. The three-second settle after the bell holds here as well.
- **The shelf** (`web/shelf.js`, saved as `settings.shelf`). A shelved passage comes back after three more copy rounds or on a later day, whichever comes first, ahead of the picker's choice. It comes back in **new words**: the original text and its authored variant take turns, so the second time he types the same idea in different sentences. The tag says "back from the shelf". Once he copies it again it leaves the shelf, and he can shelve it again from the read screen. The picker never offers a shelved passage early. A baton passage has no variant, so it is shelved with the expert's own text and comes back as it was.
- **Variants** (`web/variants.js`): one for each of the 16 passages. Each restates its passage's content and nothing more, with no new claim and no new citation, and a test checks that it is plain ASCII, has no dashes, is within 75 to 130% of the original's length and repeats at most two sentences verbatim.
- **Where the shelf shows:** a line on the home screen ("On the shelf (1)", each title and when it comes back, marked when ready) and a list under the Map.
- **History:** a copy record carries `variant` and `fromShelf` when they apply, numbers and flags only. Item 4 can read them for the "returned to a shelved idea" achievement.

Not built: the `claude -p` paraphrase through askClaude. The ask allowed it as an option ("may"), and the authored variant covers the need without spending one of the six real calls. It stays open as a proposal: when both texts of a passage have been typed, ask for a third, and fall back to the authored variant if the call fails.

Adversarial review:

- *Could it make him use the app less?* The read screen adds a step between the copy and the respond, so a round now takes one more keypress. Return still goes straight on, which keeps it to one key. The real risk is the opposite one: with Shelve one key away, he could shelve every hard passage and only ever answer the easy ones. The shelf brings each one back in three rounds, so he cannot avoid a passage, only put it off, and the home line keeps the pile in view.
- *New cross-purpose?* Only one he might feel: variant text is new to type, so the second pass of a passage is not a practice run of the same words. That is what he asked for. Copy bests still compare across variants of the same passage, which is fair, since the lengths are within the same band.
- *Calm typing surface?* Untouched. The folio and its animation live on the read screen only; the copy card changed by one hint line.
- *Does it feed the expert?* Indirectly: he now answers passages he has actually read and chosen to answer, so the kept answers should be considered answers rather than whatever the clock forced. The shelf itself sends nothing anywhere.

Stickiness: **8/10.** It fixes a habit he named (reading ahead) without asking him to break it by will, and it turns "I am not ready for this one" into a move instead of a skipped round.

### Slice 4: more achievements, and nemeses written from his drills (2026-09-24 00:02 EDT)

What changed:

- **185 static achievements** (112 before), every old id kept so old unlock dates hold. The new ones:
  - **Conversations**, a new group: baton chains of 1, 2, 3, 5 and 10 passes (read from the "baton-N" passage ids already in history), expert passages copied (10, 50), Keep going on one answer (1, 4, 7), the same prompt answered on 2 and 3 different days, shelved passages copied when they come back (1, 5, 20), the shelf emptied (1, 5), a passage copied in its second wording (1, 10), respond rounds (10, 50, 150) and kept answers (1, 10, 50, 150).
  - Modes: copy rounds, distinct passages, Oracle and spoken rounds in tiers, and **thoughts taken back** (10, 100, 500 revisions), so the principle "thinking is never punished" now earns something as well.
  - Hands, Speed, Clean, Habits: strict Shift drills with 10 capitals and none refused, 110 and 120 GWAM, a 200-word combo, flawless and 97% drills in tiers, 200 and 365 day streaks, 365 days, a lunch drill, all seven weekdays, all four seasons.
  - Field: a pair for each of the nine BACB domains, 3 and 15 answers filed under it ("Ethics Initiate", "Ethics Scholar").
- **Your nemeses** (`web/nemeses.js`), shown first on the board in their own group. The replay writes an achievement when an issue first shows up often enough to be more than one bad drill, dated the drill that spotted it, with the baseline in its condition:
  - a **key** missed on 3% or more of 60+ presses over 8 drills (his keys run 1 to 4.5%, so this catches his worst, not his normal); tamed at half that rate over 12 drills since.
  - a **slow pair** flagged in 3 of 10 drills of 40+ words; tamed by 15 such drills in a row without it.
  - a **letter confusion** ("B Is Not V") in 3 drills; tamed by 8 drills in a row without it, with 40+ presses of the meant letter among them. The history record now carries `confusions` as "meant>hit" letter pairs, letters only.
  - a **refused same-side capital** ("Extinction: Same-Side T"), 3 refusals in 5 strict drills; tamed by 5 strict drills in a row with none, 10+ capitals among them.
  - The round that spots one says so on the results and the read screen ("New nemesis: U No More"); a tamed one says "Nemesis tamed". The board shows "Spotted" and "Tamed" dates and a bar that stops one drill short of full until it is really tamed.
- The copy record carries `shelfEmpty` when the last shelved passage is copied again.
- Replayed against his real history (numbers only): 15 nemeses spotted, 6 tamed. The first cut tamed 9 of them, because a window spotted at its worst drifts back to his usual by chance; the taming windows were lengthened (keys 8 to 12, pairs 10 to 15) until a lucky stretch could not earn one.

Adversarial review:

- *Could it make him use the app less?* 185 trophies can read as noise. The board still shows only what is won plus the next tier of each family, so the page grows by the new families and not by every tier. The nemeses are the opposite risk: 15 on his first look is a lot of enemies. Six of them are already tamed from his own history, which should read as progress rather than a list of faults.
- *New cross-purpose?* A nemesis rewards a stretch without an issue, and he could chase that by avoiding the letter. The guards stop the cheap version: a key needs 60 presses in the taming window, a confusion needs 40 presses of the meant letter, a refusal needs 10 capitals. Pairs have no such guard (the history carries no pair counts), so a pair can be tamed by passages that happen not to use it. That is a known soft spot.
- *Calm typing surface?* Untouched. Everything renders after the bell, on the results, the read screen and the board.
- *Does it feed the expert?* No, this is a typing slice. The conversation trophies do reward the behaviour that feeds it (baton passes, kept answers, answering across days), which is the nearest a trophy can get.
- *Not built:* a "tame it" achievement for a coached tip. The seven "Retire the tip" trophies already do that job with the same shape, so a second copy would be duplication.

Stickiness: **8/10.** The nemesis line is the first thing in the app that talks about HIS numbers as a story (spotted on a day, beaten on a later one), and conversation trophies finally reward the rounds that feed the expert.

### Slice 5a: questions come back, from the other side (2026-09-24 00:12 EDT)

What changed:

- **Spaced review** (`web/review.js`). Every bank question he has answered is scheduled again, Leitner style: a full answer (30 kept words or more, about twenty seconds at his speed) moves it up a box, so it waits 3, then 7, 16 and 35 days; a thin answer puts it back in box 0, so it comes back tomorrow. A Keep going round adds its words to the same answer rather than counting as a second one.
- **The other side.** A returning question wears a lens, and the lens turns with every return: steelman the view he usually argues against, check the knee-jerk (habit or evidence?), name what would change his mind, then say what current research says and what he would look up. The lens is part of the question he types toward, so it also travels with a kept answer to the expert queue (plus a `lens` field).
- **Interleaved, never two reviews in a row**, so the map's emptiest cell still gets its turn and the map keeps filling.
- The home screen says how many questions are due "for another look, from the other side", or when the next one comes back.
- The history record of a review round carries `review` and `lens` (flags only). His existing answer rounds are scheduled from their dates and word counts, so reviews start on his first drill in the morning.
- **Achievements, a new group "The other side":** one per lens (Devil's Advocate, Gut Check, Open Mind, Up to Date), All Sides for all four, reviews answered (5, 25, 100) and Steel Sharpens Steel for ten steelmen. 194 static achievements in all, still replayed from history.
- **The oracle** is now told to keep him on the other side: when his answer sounds settled, ask him to steelman the view he argued against or say what would change his mind, and bring current research (web search) where it dissents from common practice or from him, with a citation. That prompt change is untested against a real `claude -p` call; no real call was spent on it.

Adversarial review:

- *Could it make him use the app less?* Every other answer round is now a question he has seen before. With a bank of 58 that could feel like reruns within a week. The lens changes what he is asked to do with it, which is the point, but the bank still has to grow (the rest of item 5) or the reruns will show. A steelman prompt on a question where he holds no strong view may feel forced; the lens rotation means it is at most one in four returns.
- *New cross-purpose?* A thin answer brings the question back tomorrow, so a question he dislikes will keep coming back until he writes 30 words on it. That is spaced repetition doing its job, but it could read as nagging. Shelving a bank question (as he can a passage) would be the release valve; it is not built yet.
- *Calm typing surface?* Untouched: the lens is one sentence at the end of the question, and the card tag says "review · steelman".
- *Does it feed the expert?* Yes, more than any slice so far. The same question answered from four sides gives the expert his position AND where it bends, which is exactly the "consensus and dissent" item 6 needs. Item 6 should read the `lens` field when it drafts.

Stickiness: **8/10.** It is the first thing in the app that remembers a clinical answer and asks him to push on it later, which is what he asked for by name ("the other side of my opinions and knee-jerks").

### Slice 5b: a question for every item, and seeds for his view (2026-09-24 00:24 EDT)

What changed:

- **The bank asks about the whole outline.** It held 58 questions over 54 of the 104 items. `web/bank-more.js` adds 50, one for each item that had none (A.4, B.1 to B.3, B.5, the measurement and design items in C and D, six ethics items, F.1 to F.3, nine procedures in G, H.4, H.6, and four supervision items), so the bank now holds 108 questions and the map's emptiest cell can be any item on the exam. Spaced review (slice 5a) has every domain to bring back, which spreads the reruns across four times as many cells in the thin domains (D had 3 questions, now 9; I had 4, now 8).
- **Sources kept honest.** Every bullet names the textbook by chapter title, the Ethics Code by section, the outline item it files under, or "general practice knowledge", or one of eleven papers and books a new test lists by name (`CHECKED` in `tests/drill-storehouse.test.mjs`). A new author and year cannot slip in without being added to that list on purpose. The one I had wrong while drafting (Hartman for Hartmann, the changing criterion paper) was caught before it landed.
- **Oracle seeds** (`web/seeds.js`): thirty live questions the field has not settled (hours per week, the neurodiversity critique, stereotypy as a target, assent withdrawal without words, the IISCA against the standard FA, punishment, restraint, tiered service, caseloads, insurance, RFT against Skinner, NDBI against DTT, tokens and intrinsic motivation, mastery criteria, AI in documentation, trauma-informed care and more). Each is a topic, not a verdict; a test refuses one that takes a side. With no topic typed, seeds and the map take turns, one conversation each, and the least-talked-about seed goes first. The card tag reads "oracle, your view, turn 1", and the history record carries `seed` (an id only).
- The two map tests that expected B.4 as the first cell now expect B.1, because B.1 to B.3 finally have questions. The comments say so.

Found, not fixed: `web/passages.js` cites Cooper, Heron & Heward (2020) "ch. Punishment by Stimulus Presentation", which is the 2nd edition's title; the 3rd edition calls the chapter "Positive Punishment" (bank.js already uses "Negative Punishment" for its twin). One line, in the next passages slice.

Adversarial review:

- *Could it make him use the app less?* The first question of the morning is now B.1 (response class) rather than B.4. That is an easier, more textbook item, and a BCBA with his years may find the new C and D questions dry (measure names, IV and DV). I wrote them as vignettes and supervision scenes where I could, so the answer is a clinical call and not a definition, but a few (C.4, D.1) are still close to recall. If they read as flashcards, the spaced review will keep bringing them back, which is the wrong direction; the "shelve a bank question" valve from slice 5a would fix it.
- *New cross-purpose?* The seeds pull toward debate, and the map pulls toward coverage. Taking turns keeps both, but a seeded conversation files its answer under one outline item (e.g., F.8), so three debate topics that file under F.8 can fill that cell and push the map's attention elsewhere, when the debate was really about ethics. Minor; the cell is only a pointer.
- *Calm typing surface?* Untouched: one extra phrase in the card tag.
- *Does it feed the expert?* Yes, and this is the slice that most directly does. A seed asks for his stance on a live question with the oracle bringing current research against it, and a kept answer goes to the expert queue with the oracle's claims. The expert gets his position on thirty contested questions, not his recall of definitions. Item 6 should draft from exactly these (stance plus the research he engaged with).
- *Not verified:* no real `claude -p` call was spent, so how the oracle handles a seed topic in practice (does it stay neutral, does it search) is untested; the mock only proves the topic reaches the prompt.

Stickiness: **8/10.** He now gets asked what he thinks on the questions BCBAs argue about, which is the fresh, current and other-side feed he asked for, and the map can finally reach every corner of the exam. The passages for his weak keys are still the gap in the typing half.

### Slice 5c: passages for his weak keys, and a picker that moves (2026-09-24 00:33 EDT)

What changed:

- **21 new passages** (`web/passages-more.js`), each 150 to 170 words, so a copy round runs a couple of minutes at his speed. Twelve are studies he will know by name, summarized for the drill and never quoted: Hanley, Iwata and McCord (2003) on what the published functional analyses showed, Hanley, Jin, Vanselow and Hanratty (2014) on the synthesized analysis, Vollmer and colleagues (1993) on NCR against DRO, Horner and Day (1991) on response efficiency, Lovaas (1987) with the criticism alongside the 47 percent, Fisher and colleagues (1992) on paired choice, Rincover (1978) on sensory extinction, Michael (1982) on SD against EO, Rosales-Ruiz and Baer (1997) on cusps, Parsons, Rollyson and Reid (2012) on BST, Fisher, Kelley and Lomas (2003) on the dual criterion, and Lalli and colleagues (1999) on positive reinforcement against escape. Nine are the drill's own positions, labelled so, for him to push back on: compassion as a teachable skill, mand before tact, choosing the measure, caseload as a clinical decision, mastery outside the room, the token board's exit plan, pairing after bad weeks, cultural humility changing goals, and multiple relationships starting small. Each has a respond question aimed at his own caseload.
- **A variant for every one** (`web/variants-more.js`), the same idea in new words, so a shelved passage comes back as new typing. The shelf test's rules (length within 0.75 to 1.3, at most two sentences repeated verbatim) now run over all 37.
- **Sources kept honest.** Study summaries stay general where I was not certain of a detail (no participant counts except Lovaas's, which are the numbers everyone quotes, and no effect sizes). A new test lists the twelve works by name and the allowed source line for each take, so a new citation cannot slip in. The p-punish chapter title found in slice 5b is fixed ("Positive Punishment", 3rd edition).
- **The picker no longer loops.** Found while testing: `nextPassage` set aside only the last three copied, so a player aimed at w m b u c would have cycled over the same four heaviest passages for good, and the new storehouse would never have reached him. A third of the passages now sit out after he copies them (never fewer than three), so he rotates through the 13 heaviest for his current keys, 10 of them new. The copy test's name changed to match; its assertions did not.

Adversarial review:

- *Could it make him use the app less?* The lift in weak-key letters is real but modest: the new set averages 12.6 percent of letters on w m b u c against 11.5 percent for the first sixteen. Ordinary clinical prose cannot be pushed much further without reading as a tongue-twister, and a tongue-twister is the thing he would stop opening. The picker does the aiming; the passages give it more to aim with. Longer passages (about 160 words against about 150) also make a copy round a little longer; at 90 WPM that is under two minutes.
- *New cross-purpose?* The wider sit-out means a passage he loved does not come back for about a dozen rounds unless he shelves it. The shelf already brings a passage back sooner and in new words, so the two now pull in the same direction: shelve what you want again, and the picker keeps the rest fresh.
- *Calm typing surface?* Untouched. Only the text changes.
- *Does it feed the expert?* Indirectly. Copy rounds are never kept, but every passage ends in a respond question about his own practice ("which of your mastered targets would fail a probe tomorrow"), and those answers are what the expert gets. The Lovaas and Hanley 2014 passages are built to draw out a stance on the two most argued studies in the field.
- *Not verified:* I wrote the summaries from what I know of the papers and did not re-read them tonight. The details most likely to be off are the ones I kept vague on purpose (the Hanley 2014 treatment sequence, the Rincover carpet example). Both are flagged here so he can check them.

Stickiness: **8/10.** The typing half finally has a storehouse that moves with him: two dozen papers and positions he can argue with, aimed at his weak keys, never the same four twice in a row. What would lift it further is the dazzle (item 7) and the teaching moment (item 8).

### Slice 6: research and stance ride with the kept answer (2026-09-24 00:39 EDT)

What changed:

- **The kept entry carries what was in front of him** (`web/stance.js`, `researchContext`). A bank answer carries the two sourced bullets. A respond answer carries the passage id, its title and first sentence and its source. A respond answer to a baton passage carries the expert's claims and their sources. An oracle answer carries the oracle's thoughts and sources, and the seed id when the conversation opened on a live question. The lens (steelman, knee-jerk check, what would change your mind, current research) rides along too. None of it is his text. The oracle's reflection is left out on purpose, because it paraphrases his last answer.
- **Tone is counted on the Mac** (`toneOf`): hedges ("I think", "might", "it depends", a bare "(?)"), boosters ("always", "never", "must"), first person, questions, sentences, and a stance toward the research (agrees, pushes back, mixed, unclear) from pushback and agreement markers. Overlapping phrases count once. The Swift shell writes `research`, `tone`, `lens` and `seed` into the kept sidecar, and the expert queue line is that sidecar plus the answer, as before.
- **The drafting step reads it** (`web/oracle.js`). `draftPrompt` now lists the research in front of him with its sources, the lens, and one line of stance ("Stance markers in his answer: pushes back."). The hedge and booster counts stay in the sidecar; only the label goes to `claude -p`, which already reads the answer itself, so nothing about him goes anywhere new. `DRAFT_SYSTEM` now asks for three kinds of record: `consensus` (the research he took on), `dissent` (where he pushed back or named a limit, stated as a live question with what the research says on each side) and `practice`. It may name only a source from the list it was given and must say "general practice knowledge" otherwise. The never-quote rule and the eight-word guard are unchanged, and a test proves the guard still drops a consensus record that quotes him.
- **The proposal says what it is.** A `consensus` or `dissent` record carries its kind as its first keyword (a field the store already takes), so the admin page can search for dissent without a new field; a kind without research in the entry falls back to `practice`. `provenance.sources` now lists the research sources for every mode, not only the oracle's.

Proposal, not code (needs the tools site, outside apps/drills): give proposed records a real `kind` field (`practice`, `consensus`, `dissent`) and a `stance` in provenance, and let the admin Knowledge tab filter on them. Until then the keyword carries it. The server's write validation was not in this checkout to check against, so I kept every new value inside fields the app already sends.

Adversarial review:

- *Could it make him use the app less?* He sees nothing new on screen, so no. The risk is downstream: if the drafting starts proposing a "dissent" record every time he writes "however", the admin page fills with weak dissent and he stops reviewing it. The prompt says the stance line is a word count and to trust his answer over it, and an empty list is still a good answer, but only real `claude -p` drafts will show whether that holds. No real call was spent on it tonight.
- *New cross-purpose?* A small one. The stance markers reward words like "however" and "not convinced", and the steelman lens asks him to argue the other side, so a steelman answer reads as "pushes back" against research he actually agrees with. The draft prompt names the lens, so the model can read a steelman as a steelman, but the stance label itself will be wrong on those. It is metadata for the drafting step, never a score, and nothing he sees changes with it, so it cannot pull his typing.
- *Calm typing surface?* Untouched. The counting happens at Keep, after the round.
- *Does it feed the expert?* Yes, more than before. A record now can say "the field holds X (Hanley 2003), a practicing BCBA would add Y", with a named source, instead of a rule floating free of the research that prompted it. The provenance sources let him check a proposal against the passage it came from.
- *Not verified:* whether the tools site keeps unknown keywords as is (it takes up to 24 lowercase keywords today, from the app's own validation mirror), and how `claude -p` actually splits consensus from dissent.

Stickiness: **8/10.** Nothing new to look at, but what he types now reaches the expert with its research attached, so his "however" becomes a sourced dissent record instead of a lost opinion. The dazzle (item 7) is what will pull him back tomorrow morning.

### Slice 7: the bands as a road, and the crest (2026-09-24 00:48 EDT)

What was already there from the ornate layer: watercolour washes that dim and stop while he types, gilded frames on the setup, results and read cards, a sunburst plaque on the results that brightens with the round, confetti on a personal best, the illuminated folio on the read screen with a gilt drop capital, warmer calendar days and gilded trophy cases. This slice adds the one moment the ask named that had nothing: going up a band.

What changed:

- **The road** (`web/bands.js`, `bandRoad`). Under his best on the home screen, the ten bands run left to right as gems. Every band his numbers have reached is gilded, the next one breathes in dashed gold, the rest wait in outline, and a line names the next band and its number ("Highest band so far: Expert. Next: Elite, at 95 NWAM. (answering)"). It follows the mode: copying and answering have separate roads, as they have separate bests.
- **The crest** (`bandUp`). The first time a round reaches a band that none of his earlier rounds of the same kind reached, a gold crest drops in over the plaque ("New band, Elite, past Expert, the first time over 95 NWAM") with a bigger confetti burst than a personal best. A copy round shows it on the read screen, where he lands first. Marking an unknown word clinical re-scores the round and can open the crest after the fact, which is true to the numbers.
- **Bands are worked out from each record's own NWAM and accuracy, never from the name stored on it.** Every record from before tonight's recalibration says "Professional", and reading the name would have thrown an "Elite" crest at a number he had already hit a dozen times. No crest in his first three rounds of a kind. Nothing is written to history.
- **Trophy reveals.** The trophies and nemeses a round wins rise in one after another (capped so a long list still lands in about 1.5 seconds), before the shine sweeps them.
- Reduced motion keeps the gold and drops the crest drop, the breathing gem, the reveal and the confetti. Dark mode has its own crest (deep umber, gold type). No fonts or files from outside; the crest stars are text characters.

Adversarial review:

- *Could it make him use the app less?* With his numbers (median 89 NWAM, best 100), his road shows Elite as reached and Master at 105 next. That is a real climb, about 5 NWAM over his best, which is the point, but a crest he can see and not reach for weeks could turn into a nag. The personal ladder (his usual, his best, the next multiple of five) still sits on every result and moves more often.
- *New cross-purpose?* One, small. A crest waits on the first round over a band line, so a round he typed carelessly fast can open it where a careful round would not. The accuracy gate already drops a band under 96%, so a sloppy round cannot open one on speed alone, and a revision still costs nothing (slice 1). Copy and compose keep separate roads, so an easy passage cannot open a compose band.
- *Calm typing surface?* Untouched. The road is on the home card, the crest on the results and read cards; body[data-calm] still stills everything while a round is armed or running.
- *Does it feed the expert?* No. This slice is for the pull back to the app. It reads history and writes nothing.
- *Seen in the screenshots:* a round that wins a dozen trophies at once pushes the read screen's passage below the fold. Only a first-ever round or a seeded test does that; his real rounds win one or two.

Stickiness: **8/10.** A band to reach that is a real stretch from his numbers, and a moment worth seeing when he gets there. What would lift it is the teaching moment (item 8): something to do with a nemesis besides watch it.

### Slice 8: thirty seconds on the nemesis (2026-09-24 00:56 EDT)

What changed:

- **The drill** (`web/tame.js`). The target is his newest nemesis not yet tamed (a missed key, a slow pair, a letter swap or a refused same-side capital). With none spotted yet, it is his trickiest key lately, the one the copy picker already aims at, so the offer is there from the first morning. With nothing to aim at (a first launch), there is no offer.
- **What he types**: 45 real words from the passages, two in three carrying the target, never the same word twice in a row. A slow pair is drilled with words that hold the pair, a swap with words that hold the letter he meant, and a refused capital with capitalised words that start with it, so strict Shift is doing the teaching.
- **The teaching line** sits above the words, from a US keyboard map: "U is your right index finger, top row. Reach for it from home and come straight back after each one; clean first, then fast." A swap names both fingers ("You have been hitting N for M..."), a pair says whether one finger does both keys, and a refused capital names the other pinky.
- **Offered, never forced.** The home screen shows one line under the shelf ("Nemesis: U No More: thirty seconds on it, if you like.") with a Drill it button on D; Return still starts the ordinary round. The results of any round carry a Drill button on D too. After a drill, Return runs another in fresh words, and Esc goes home.
- **The results say how the target went**, from the numbers only: "U: 0 missed of 20 presses (0%)", "BR still ran slow, 240 ms", "Not one N for M", "Every capital T with the right Shift". The drill goes straight to the numbers, with no read screen and nothing to keep; the rating reads "Nemesis drill (practice only: no band)" and the crest never shows.
- **It stays out of everything else.** A word list is easier than prose, so its numbers go to `settings.tame` (at, target id, kind, NWAM, GWAM, accuracy, clean: numbers and an id, never text, capped at 300), never to history. His bests, bands, road, copy picker, key trends and the nemesis engine never see it: **a nemesis is tamed in real rounds only.** The trophy case replays the log in time order with the history, so the new trophies keep true dates.
- **Three trophy families**, a new "Teaching moments" group: Sparring Partner, Dojo Regular, Sensei (1, 10, 50 drills); Clean Hit, Muscle Memory (1, 10 drills with the target costing nothing, 10 presses or more); Rogues' Gallery (3 different nemeses drilled). 200 static achievements in all.
- The full suite passes (151 node, 106 Playwright across WebKit and Chromium) and `app/build.sh` succeeds.

Adversarial review:

- *Could it make him use the app less?* A drill on a word list can feel like a chore, which is why it is never in the way: Return still starts the round he came for. The risk is the other way, that thirty seconds is an easy way to feel he practised without writing a word for the expert. The drill keeps no streak day and no calendar mark of its own (it is not in history), so it cannot stand in for a real round.
- *New cross-purpose?* Two, both fixed in this slice before commit. The screenshot showed a word-list round named "Expert", a band he had not earned in prose; it now reads "Nemesis drill". The basis line said "A copy round"; it now names the drill. One stays on purpose: the drill's own "Personal best" star and confetti compare only drills with drills, which rewards speed on a word list. That is the drill's only speed claim and it never reaches his real bests.
- *Calm typing surface?* Yes. The lesson is one italic line above the words, like a passage source; nothing moves while he types.
- *Does it feed the expert?* No. It is for his hands. What it feeds is the rest of the app: a nemesis he can act on, rather than watch, turns the "Your nemeses" board from a list of faults into a list of jobs.

Stickiness: **8/10.** The first thing in the app that he can do about a weakness in thirty seconds, with a line that tells him why it happens.

## Final adversarial review of the whole app (2026-09-24 00:56 EDT)

Read as Kaleb opening it tomorrow morning, with 31 drills of history at a median of 90 GWAM and 89 NWAM.

What works:

- **The cross-purpose he flagged is gone.** A thought deleted in a composed round is a revision: counted in speed, never an error, never a band or a star (slice 1). The bands start above his numbers (Expert 85, Elite 95, Master 105), so every result has a next rung, and the road on the home screen shows how far he has come.
- **Strict Shift is on**, so the same-side capital is refused and flashed in the margin, and the weekly count gives him a curve to watch fall (slice 2). The nemesis drill can aim at a refused capital directly (slice 8).
- **He types cold and reads after.** The read-and-consider screen, the shelf, and the variant wording when a shelved passage comes back (slice 3) remove the reason he was reading ahead.
- **The storehouse is large enough for weeks.** A bank question for all 104 outline items, 37 passages with variants, 30 oracle seeds, and spaced review through four lenses (slices 5a to 5c). Kept answers now carry the research he answered and a local stance, so the expert gets consensus and dissent proposals with sources, never his words (slice 6).
- **200 static achievements plus his own nemeses**, and the dazzle stays off the typing surface (slices 4, 7, 8).

What could still make him use it less, and the new cross-purposes the night introduced:

1. **Strict Shift will slow him for a few days.** That cost is the extinction he asked for, but a first-morning NWAM dip after a night of "improvements" could read as the app getting worse. The toggle is one click on the setup screen.
2. **The first rounds read "Expert" where they read "Professional".** It is a rename from the recalibration, not a demotion, and old records are never rewritten, but nothing on screen says so. A one-time line on the first result ("the bands moved up to fit your numbers") would help. Not built.
3. **The stance label will be wrong on steelman answers** (slice 6): arguing the other side reads as "pushes back". It is metadata for the drafting step only, and the prompt names the lens, but only real `claude -p` drafts will show whether the dissent records are worth his review. No real call was spent tonight.
4. **Home is getting busy.** The road, the shelf, the review line and now the nemesis line sit under the minute picker. Each is one line and hides itself when empty, but on a day when all four show, Start is further down the card. Worth watching; not changed.
5. **Unverified clinical details**, flagged for him to check: the Hanley 2014 treatment sequence and the Rincover 1978 example in the new passages (slice 5c). Every other citation is on a named checked list in the tests, or says general practice knowledge.
6. **Proposals outside apps/drills**, not code: a real `kind` field and `stance` for proposed records on the tools site (slice 6), and a `claude -p` paraphrase for shelved passages once both wordings have been typed (slice 3).

Does it feed the expert, or only look busy? It feeds it more than it did yesterday: an answer that engaged research now arrives with that research and its sources attached, the oracle asks for his view on live questions, and the review lenses ask him for the other side in his own words. The dazzle and the drill are there to bring him back to do that.

**Final stickiness: 8/10.** The things that were pushing him away (a score that punished thinking, a top band he already owned, reading ahead) are gone, and there is always a next rung, a nemesis to work, a question coming back, and something the expert will do with what he writes. What keeps it from a 9 is untested contact with his real mornings: the strict Shift slowdown and whether the drafted dissent records are good enough for him to keep reviewing them.

