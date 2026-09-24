# ClickClackOracle, overnight 2026-09-23

The running plan and log for the overnight GNHF run. Kaleb asked for this on the night of 2026-09-23 and tries the app in the morning. Each slice gets tested (`npm test`, node plus Playwright WebKit and Chromium), built (`app/build.sh`) and committed on this branch. Nothing is pushed.

The principle behind the scoring, in his terms: **thinking is never punished; only typos are.**

## Checklist

One line per point of his ask. A line is done only when it names the test or screenshot that proves it.

| # | Ask | Status | Proof |
|---|-----|--------|-------|
| 1 | Remove the scoring cross-purposes: deleting a thought never costs speed, accuracy, band or star; bands he can climb; a personal ladder | **done** (slice 1) | `tests/drill-cross-purpose.test.mjs` (8 tests); `drills.spec.js` "a thought taken back with plain Backspace costs no error..." in WebKit and Chromium; band tests updated in `drill-score.test.mjs` and `drill-panel.test.mjs` |
| 2 | Strict Shift mode, default on: a same-side Shift refuses the key and flashes, the combo goes on extinction; toggle in settings; refusals counted and reported | **done** (slice 2) | `tests/drill-strict-shift.test.mjs` (5 tests); `drills.spec.js` "strict Shift, on by default...", "strict Shift refuses in a copy round too...", "strict Shift can be turned off in settings..." in WebKit and Chromium; screenshot of the refusal in the margin, light and dark |
| 3 | Read-and-consider screen after the copy round: Respond (Return) or Shelve (S); a shelved passage comes back with different transcription text | todo | |
| 4 | Achievements: well over 150, more variety, conversation achievements, and a dynamic "Your nemeses" engine from his own data | todo | |
| 5 | Clinical knowledge that cycles (spaced repetition), "consider the other side" prompts, and a much bigger storehouse (bank questions in all 9 domains, 20+ passages for w m b u c with variants, oracle seeds) | todo | |
| 6 | Ingest research with his responses and tone: the queued entry carries the expert's claims, sources and his stance; DRAFT_SYSTEM proposes consensus and dissent; local tone metadata in the kept sidecar | todo | |
| 7 | Dazzle the non-typing screens (home, read-and-consider, results, band level-up, trophy reveals, board); typing surface stays calm; reduced motion; light and dark; offline | todo | |
| 8 | Fun and instructive: small real teaching moments, e.g. a 30-second nemesis drill, offered and never forced; fix what the adversarial review finds | todo | |

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
