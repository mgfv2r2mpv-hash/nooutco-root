# note-tool-author-aid

Working notes for the six-slice run. Base: origin/main at 43e36716.

## Slice 1 - round trip harness

`apps/tools/tests/token-family-roundtrip.spec.js`, driven by
`apps/tools/tests/helpers/token-reshape.js`. 22 tests, green on chromium.

### What the harness does that the old round-trip spec did not

The old spec drives an echo mock on the draft and the revision. This one drives a
mock that RESHAPES every canonical `[[Tn]]` on the way back, into one of five
shapes a model has actually been seen to produce, spread across the token
numbers so one drafted note carries four manglings at once:

    [T3]        one bracket, the shape he read on production 2026-09-09
    [[t3]]      case folded
    [[T 3]]     padded inside the brackets
    [[T3]       left unbalanced
    [ t 3 ]     one bracket and padded

Nothing it emits is canonical, and a test at the top of the file asserts that.
Every assertion reads the FAMILY - one or two brackets, optional whitespace,
upper or lower case T - never the canonical shape. The old leak check read
`/\[\[T\d+\]\]/`, so a note carrying `[T3]` passed it while showing the clinician
a token.

### The paths

| # | path | driven through |
|---|---|---|
| 1 | the draft | Generate Note on /notes/bt/ |
| 2 | a revision | the revision box, asserted in the diff AND after accept |
| 3 | an expert quote | `/api/expert-pass` routed, reading the tokens off its own intake |
| 4 | panel advice | "What would you do here", asserted in the panel body |
| 5 | per-section Copy | the clipboard, not the rendered note. Copy All too, as admin |
| 6 | the saved draft after a reload | the ledger, the banner, and the store |
| 7 | a cleared note into the next one | Generate Prompt, the only carry-over caller with no model |
| 8 | switching tools and coming back | sup, parent, sup on /notes/bcba/ |

Paths 7 and 8 are not in the objective's list of six. They were added because the
revert proof below found two fixes that nothing else in the tree tested, and both
of them are the same fault in a worse form than a visible token: the PREVIOUS
note's word landing silently in THIS note.

### The revert proof

Each fix was reverted in place, the harness was run, and the fix was restored.
Measured, not reasoned about.

| fix | where | harness tests that fail |
|---|---|---|
| R1 tolerant reshaped-token pass (`restoreLooseOpaque` inside `restoreDeep`) | notes-gate.js | **14** across paths 1, 2, 3, 4, 5, 6 |
| R2 the ledger is written beside the draft | engine.jsx | **6** across paths 3, 4, 6, 7 |
| R3 the ledger is read back on mount (`savedMap` in `freshSession`) | engine.jsx | **2** on path 6 |
| R4 Clear drops the in-memory map (`scrubMapRef.current = []`) | engine.jsx | **1** on path 7 |
| R5 a revision carries the note's map over (`carryOver: true`) | engine.jsx | **3** on paths 2 and 8 |
| R6 longest token first in `restoreDeep` | notes-gate.js | **0** - see below |
| R7 the ref is re-seeded on a tool change | engine.jsx | **1** on path 8 |
| R8 a role cue only names a CAPITALISED word | notes-gate.js | **0** - see below |

R7 was caught by NOTHING before this file existed. Reverting it and running
`scrub-token-roundtrip.spec.js` leaves that spec green. The fault it prevents is
the sharpest of the set: both tools start numbering at `[[T1]]`, so a stale ref
does not merely fail to restore, it restores the OTHER tool's word into this
note.

#### The two the harness does not catch, and why that is right

**R6, longest token first.** Reverting it fails
`scrub-token-roundtrip.spec.js > restoring is not prefix-blind > Client 2
survives a map that also carries Client`, so it is tested, just not here. It
cannot fail through any path in this harness, and the reason is structural: every
clinician-facing path restores through `restoreOutput`, which filters the map
down to `restore: true` entries, and those are opaque `[[Tn]]` tokens only. No
`[[Tn]]` is a prefix of another, because the closing brackets end it. The sort
only matters where a caller passes a map that restores NAMES, which is the admin
expert bench.

**R8, a role cue only names a capitalised word.** Reverting it fails
`scrub-cue-adjacent-words.spec.js > inferRoles does not file an ordinary word as
a person`. It is a DETECTOR fix rather than a hydration fix: it decides what gets
tokenised, not whether a token comes back. It belongs to the slice 2 census, and
the census is where its cost should be measured.

### What the harness found about the page, worth knowing before slice 4

- `freshSession()` restores the typed inputs and the ledger, and deliberately not
  the output or the conversation. There is no rendered note on the far side of a
  reload, so the two clinician-facing surfaces that survive are the substitution
  banner and the restore entry point a later turn measures against. Both are
  asserted on path 6.
- `handleGeneratePrompt` is the only carry-over caller reachable without a model
  call, and it is logged-out only. That is what path 7 drives.
- bt sets `copyAll: false`, so Copy All exists for an admin only. Per-section Copy
  and Copy All are two different assemblies (`sectionBody` against `copyGroups`),
  so both are asserted.
- The corrections pass edits the note and is therefore a ninth surface a token can
  reach a clinician through. It is not covered here. It is left unrouted in the
  harness, which makes it 401 and resolve null, exactly as the existing green
  spec leaves it.
- A revision whose reply is byte-identical to the draft renders no diff at all.
  A mock that echoes without varying makes a revision test fail on a missing
  panel rather than on the thing under test.
