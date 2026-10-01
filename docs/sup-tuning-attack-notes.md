# Supervision tuning: attack notes and gaps

Each item from the spec's attack list gets a test or a gap written here, with the failing input.

## F. Goal-rewrite failure (ruling 4)

Spec: `apps/tools/tests/sup-goal-rewrite.spec.js`, canned replies only, no live model.

Result: three cases pass on the current tree (rows added and reworded, a row dropped, a one-cell change). The change reaches the proposal panel and Accept writes it into the grid. Cause of the reported failure: not identified. The `valuesEqual` comparison, the table branch of the proposal and the grid's `onChange` all behave. The spec stays as the regression test.

Not covered, so a remaining suspect: a revision aimed at one section with the Goals card clicked (the card has no click-to-target in these tests), and a reply whose `goalsAnalyzed` rows carry the same text with different whitespace.

## B. Deletions rail (attack items 15 and 18, rail part)

Spec: `apps/tools/tests/deletions-rail-icons.spec.js`. Covered: icons with title and aria-label and 30px targets, restore, pencil with chip and the row's why queued as an ask, check collapsing into the strip with a count and the strip above the rows, popover Reopen, tap and keyboard on the strip, dismiss-all then reopen the middle row, Copy output unchanged by dismiss, 375px with no horizontal scroll, quiet mode with no controls.

Gaps (no test yet):
- 20 rows: the strip's glyphs wrap by flex-wrap, but nothing asserts it at 375px.
- Dismiss then edit: `NoteCorrections.toggle` and `edit` rebuild a mark as `{reverted, text}`, so they drop `approved` and `dismissed`. A rail row cannot be edited, but a move's paired key is rewritten by `toggle`, so dismissing the origin end of a move and then toggling the other end would reopen the row. Failing input: dismiss a `del` row that is half of a substitution pair, then Restore its partner.
- Dismiss while an ask is queued for that row: the ask stays in the queue and is sent with the others. Not asserted.
- The rail's per-section strip means a note with deletions in three sections shows three strips, not one.

## D. Goal candidates and chosen goals (attack items 4 to 8, 17 in part)

Spec: `apps/tools/tests/goal-candidates.spec.js` (30 cases, node vm, no browser) and `apps/tools/tests/sup-chosen-goals.spec.js` (6 cases). `goal-candidates.js` is built and wired into the prompt (`chosenGoals`, parsed bracket rows) and `migrateDraft`. The picker UI, the cap rule, Update, and held-text recovery are not built yet, so attack items 9, 10, 11 and the 375px part of 18 are still open for D.

Covered: tier order (goal word, reduction frame, data row, label, definition, heading); 4 (a story bullet with no data gives no candidate; probes and incidental teaching are probe kind and never preselected); 5 ("Elopement goal" scores 6, "He did not elope" gives nothing); 6 (apostrophes, double quotes, slash names, en dash kept verbatim; curly and straight apostrophe spellings are one candidate); 7 ("Client Played Cars" gives nothing); 8 (one trial, zero correct, percent that disagrees with the counts is flagged and the counts stand, unexplained code listed and never interpreted, missing raw field, extra pipes inside Details, non-bracket text returns null).

Decisions to confirm:
- A bracket row is named for its Program (first cell), not its Target. Two rows for one Program make one candidate holding both rows.
- Only score 4 and above is preselected (goal word, reduction frame, data row). Title Case labels, defined terms, heading items are chips but start unchecked.
- A trial sequence is read from Details only when Details is nothing but short codes and there are exactly five cells. Anything else is free text.

Gaps (no test yet):
- 17, the eye popover: `source` is a line of whatever text is passed in. Nothing here proves the engine passes masked text. That check belongs to the picker spec.
- A Title Case goal with no colon, no data and no marker (a bare "- Joint Attention") scores 3 as a label, but a lowercase goal in the same position ("- joint attention") is not a candidate.
- A name followed by "target" as a noun ("the target was elopement") has no name before the marker, so the "after" route takes "was elopement" only if a colon follows; otherwise nothing.
- Names longer than six words are dropped, not truncated.

## E. Repeat check (attack items 12 and 14 in part)

Spec: `apps/tools/tests/repeated-facts.spec.js` (11 cases, node vm) and `apps/tools/tests/sup-repeat-hint.spec.js` (2 cases, stubbed model). `repeated-facts.js` is pure, edits nothing, and is wired in `finalize` in engine.jsx as a third injected hint source, beside the misplaced-strategy and effect-unstated checks. The tool lists its sections in `repeatSections`. Hints land on the later section with the earlier section's heading in the detail.

Covered: sentence counter (abbreviation, decimal, quoted line, bullets, empty and null); the same fact in different words flagged (token Jaccard on content words, threshold 0.5, at least 4 content words per sentence); a legitimate echo (the same goal name and the same antecedent strategy named in Behavior and Feedback Notes inside different sentences) does not flag; caregiver coaching restated in Progress flagged against Feedback Notes; one hint per section; short and stopword-only sentences never flag; a section repeating itself is not flagged; empty and non-string sections skipped; input not mutated; end to end, the hint shows on Feedback Notes only and the text is left as drafted.

Decisions to confirm:
- The 0.5 threshold and the 4-word floor were chosen against the invented fixtures in the spec, not against real notes. A real corpus run would tune them.

Gaps (no test yet):
- A repeat built from a paraphrase that shares few words ("did not leave the area" against "stayed in the room") is not caught; token overlap cannot see synonyms.
- Numbers and names are ordinary content words, so two different facts about the same goal in two sections (same goal name, different counts) can score as a repeat when the sentences are short.
- A repeat inside Goals Analyzed rows or against Follow-Up Items is not checked, only the four narrative sections.
- The hint detail is a heading, not a sentence quote, so a note with three repeats in one section shows only the first matching section.
- Sentence budgets (item A1) are not enforced by this file; `countSentences` is the helper for tests on canned model outputs, and no budget test exists here because the prompt rules are section A, which is not part of this run.

## D (picker rules, pure half) result

- `notes/bcba/goal-picks.js` (window.GoalPicks) holds the cap rule, Update-button state and held row text with no DOM. `tests/goal-picks.spec.js` covers attack item 9 (seventh check, uncheck, recheck, eviction order), the pure half of item 10 (held text returns only while the notes text is unchanged) and the state half of item 11 (`differs` false means the button stays hidden).
- Still untested until the picker UI exists: item 11 double press, item 10 through the real grid, the eye popover masked-text check (item 17), and 375px for the chip strip (item 18).
