# Supervision tuning: attack notes and gaps

Each item from the spec's attack list gets a test or a gap written here, with the failing input.

## F. Goal-rewrite failure (ruling 4)

Spec: `apps/tools/tests/sup-goal-rewrite.spec.js`, canned replies only, no live model.

Result: three cases pass on the current tree (rows added and reworded, a row dropped, a one-cell change). The change reaches the proposal panel and Accept writes it into the grid. Cause of the reported failure: not identified. The `valuesEqual` comparison, the table branch of the proposal and the grid's `onChange` all behave. The spec stays as the regression test.

Not covered, so a remaining suspect: a revision aimed at one section with the Goals card clicked (the card has no click-to-target in these tests), and a reply whose `goalsAnalyzed` rows carry the same text with different whitespace.
