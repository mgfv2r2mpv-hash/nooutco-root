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
