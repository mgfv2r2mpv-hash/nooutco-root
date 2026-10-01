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
