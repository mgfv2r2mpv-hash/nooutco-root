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

## Slice 2 - false positive census

`apps/tools/scripts/phi-census.mjs`, over a 12 doc synthetic corpus in
`scripts/fixtures/phi-census-corpus.mjs`, scored by the pure module in
`scripts/lib/phi-census-score.mjs` and landed by `tests/phi-census.spec.js`
(20 tests, green on chromium).

Measurement only. No detection behaviour is touched by any file in this slice,
and nothing here is loaded by the browser.

### How it runs the real code

`scripts/lib/gate-context.mjs` runs `assets/notes-gate.js` in a Node VM and
pulls `detectNames`, `detectIdentifiers`, `inferRoles` and `buildRoleMap` off
`window.NotesGate._scrub`. That is the same move `draft-before-after.mjs` makes
on the tool files, against a different file. A census built on a copy of the
regexes would measure the copy.

Two stubs change what is measured and are stated in the report header:

- `localStorage` is empty, so `loadNonPii()` returns `[]` and no clinician has
  certified anything as not a person. That is a fresh device, which is the worst
  case and the one a new technician sees.
- `fetch` rejects, so `/api/scrub-config` never lands and no server-learned
  stopword or first name is merged in. A deployed browser can be kinder than
  these numbers and can never be harsher.

### Two columns and two orders

`--baseline <git-ref>` (default `main`) reads the same file at another commit
with `git show`, loads it in a second VM and prints both columns. When the two
sources hash the same the report says so rather than printing one column twice
and letting it read as agreement.

Two orders per column, because the page has two:

- `names-raw` is `detectNames` on the raw textarea, which is what the highlight
  overlay calls. This is the false positive count a technician sees while typing
  and the surface slice 3 changes.
- `names-prod` is `applyScrub` with the identifier map first, then `detectNames`
  on what is left, which is `scrubForAgent`'s order and what the model gets.

The two differ by exactly the overlapping-span class: `1420 Maple Street` costs
three name candidates on the raw text (`Maple Street`, `Maple`, `Street`) and
none after the identifier pass has taken the address.

### The numbers, working tree at 243bc83f against local main at d977e9c0

```
pass          |  prec  recall  tp/ fp/ fn |  prec  recall  tp/ fp/ fn
--------------+---------------------------+--------------------------
names-raw     |  33.3%  81.3%  13/ 26/  3 |  27.1%  81.3%  13/ 35/  3
names-prod    |  36.1%  81.3%  13/ 23/  3 |  28.9%  81.3%  13/ 32/  3
identifiers   |  88.9% 100.0%   8/  1/  0 |  88.9% 100.0%   8/  1/  0
roles         | 100.0% 100.0%  10/  0/  0 |  41.7% 100.0%  10/ 14/  0
rolemap       |  33.3%  81.3%  13/ 26/  3 |  27.1%  81.3%  13/ 35/  3
```

Against `origin/main` at 43e36716 the two columns are byte-identical, because
this branch has changed no detection code. Local `main` is 22 commits behind and
does not carry the lowercase guards, so it is the useful baseline and the one
the default uses.

What moved between them is one guard in each of two functions. `inferRoles`
precision goes from 41.7% to 100% and the count that matters goes with it:

```
role token on a word that is not a person    working tree 0    local main 7
```

A role token never restores. Seven ordinary words on local main receive
`Client`, `Caregiver` or `Technician` and stay in the signed note wearing it.

### Misses by class, working tree, names on raw text

| class | count | examples |
|---|---|---|
| program-name-capitalised | 9 | `Tolerating Delays`, `Requesting Breaks`, `Receptive Identification` and their words |
| colour-or-material-word | 7 | blue, red, yellow, jade, amber, crystal, ruby |
| place-name-overlapping-span | 5 | `Maple Street`, `Maple`, `Street` inside an address; Sierra; Georgia |
| dictionary-collision-with-clinical-vocabulary | 4 | mark (the data sheet), grace (period), max (prompt level), joy |
| lowercase-real-name-no-cue | 2 | kaelen, tavion, both real people and both missed |
| nickname-prefix-pass | 1 | delay, riding in behind Delays |
| cue-word-splits-a-two-word-name | 1 | `Barbara Jean` |
| verb-after-role-cue | 0 here, 9 on local main | reports, described, labeled, noticed, dropped |
| identifier-cue-swallowed-a-word | 1 | `Insurance authorisation`, taken as an ID |
| unclassified | 0 | required to read 0 |

### The bill per note

```
bt-01    3 to wave off, 1 real     bcba-01  10 to wave off, 0 real
bt-02    0                          bcba-02   0
bt-03    4                          bcba-03   0
bt-04    3                          bcba-04   0
bt-05    0                          bcba-05   0
bt-06    6                          bcba-06   0
                              2.2 per note on average
```

The average hides the shape. A note with no colours, no materials and no
capitalised program names costs nothing. A colour matching block costs three, a
materials-and-rooms note costs six, and a supervision note naming three programs
costs ten. The load is not spread across notes, it lands on the notes that
describe materials and named programmes, which is most of a BT's day.

### What this says to slice 3

- The screen list has to be per word and it has to persist, because the same
  six words come back on every note that uses the same materials.
- It cannot be allowed to cover an identifier. The only identifier false
  positive in the corpus is `Insurance authorisation`, which is one phrase and
  costs one wave. Screening identifiers would buy that one wave and sell the
  whole pass.
- Adjacency beats a prior screen, and the corpus has the case: `ruby` is a
  counter in bt-06 and a sibling in bcba-04, and `Rose` is a reinforcement chart
  and a caregiver inside one doc in bcba-06. A screen keyed on the word alone
  would lose the person.
- The classes split cleanly by what a screen can fix. Colours, materials, places
  and dictionary collisions are stable words a technician screens once, and that
  is 16 of the 26. Program names are 9 more and are stable per programme, and
  the nickname prefix hit is the last one. So a screen list can reach all 26.
  It reaches none of the recall misses: two are lowercase names with no cue and
  the third is a two word name split by the cue in front of it.

### Findings the census turned up that are not precision

- One human can come out of `buildRoleMap` wearing two role tokens. `Caregiver
  Barbara Jean` reaches `Caregiver` and `Person 2`, so the model is told there
  were two people. The cause is the phrase pass taking two capitalised words at a
  time: it reads `Caregiver Barbara` first, the cue drops out as a stopword, and
  what is left is one word rather than two, so `Barbara Jean` never forms.
  Counted as `cue-word-splits-a-two-word-name`, 1 of 14 people in the corpus.
- `detectIdentifiers` has full recall on the corpus and one false positive. The
  labelled-ID pattern reads `insurance` as a cue and then takes the next word
  whatever it is, so `Insurance authorisation` is tokenised as an ID. Harmless
  on this path, because an identifier token is never restored and the notice
  tells the clinician what went, but it is a word that disappears out of a note
  without being PHI.
- Months are stopwords, so `April` and `June` never reach the name pass. The
  dictionary holds `jun` but not `june`.

### Landing tests and their revert proof

`tests/phi-census.spec.js`, 20 tests. Three of them are landing tests against
the shipped code, and each was proved by taking the guard out, running, and
putting it back.

| guard removed | tests that failed |
|---|---|
| `if (!/^[A-Z]/.test(cname)) continue;` in `detectNames` | 1: `the lowercase guard is still in detectNames` |
| `if (!/^[A-Z]/.test(m[2])) continue;` in `inferRoles` | 1: `the lowercase guard is still in inferRoles` |
| both at once | 3: the two above plus `no word in the corpus gets a role token it can never give back` |

The third only fails when both are gone, which is right: with the `inferRoles`
guard in place a mis-detected verb gets `Person 3`, and a Person token restores.
It takes both faults to put an unrestorable role on an ordinary word.

The other 17 pin the corpus against its own prose, the scorer against
arithmetic written out in the test, and the classifier against one case per
class.

### One existing test widened

`tests/no-em-dashes.spec.js` did not walk `.mjs`, so every bench script under
`scripts/` sat outside the rule. The three that existed were already clean, so
adding the extension took nothing away and closed the gap before the next
script walked through it.

### Reconnaissance for slice 3, read while the suite ran

Facts about the two files slice 3 has to touch, so the next turn does not spend
its budget rediscovering them.

- **A mark cannot be clicked as the overlay stands.** `_attachHighlight` puts
  the highlight layer at `z-index:0` with `pointer-events:none` and leaves the
  textarea on top at `z-index:1` with a transparent background. Raising the
  layer or giving a `mark` pointer events would take the click away from the
  textarea and stop typing working. The way in that changes no layout is the
  caret: a click or a tap on the textarea sets `selectionStart`, so the handler
  can map that offset to the detected span it landed in using the same regex
  `_syncHighlight` already builds. Mouse and touch both land there.
- **Every DONE WHEN in slice 3 is data.** A screened word not flagged next note,
  the same word flagged again behind a role cue, an identifier that cannot be
  screened by any route, an audit payload with no word in it, and a list that
  survives a reload and is not plaintext: none of those need the popover to
  exist. Build the store, the consult, the adjacency override and the audit
  shape, expose the decision as a function, and test that.
- **`NotesGate.draft.save` is the wrong store to reuse directly, for two
  reasons that are both deliberate.** `decryptDraft` drops any record older than
  `DRAFT_TTL_MS`, which is 12 hours, so a screen list stored that way is gone
  overnight and a technician re-screens the same six words every morning. And
  `clearAllDrafts()` wipes everything under `notes_draft_` at logout, which is
  right for a note and wrong for a list that holds no note text at all.
- **What to reuse instead is the key, not the store.** `draftKey()` mints a
  non-extractable AES-GCM key once and keeps it in IndexedDB under
  `draft-key-v1`, so it survives a reload and never leaves the device. The
  screen list wants the same key and the same `{v, iv, ct, savedAt}` record
  shape under its own prefix with its own expiry, which means a small addition
  to notes-gate.js exposing the encrypt and decrypt pair rather than a second
  copy of the crypto.
- **`NotesScrub._detect` already funnels through `NotesGate._scrub.detectNames`,
  and `_syncHighlight` calls the gate directly.** Two call sites, so a consult
  added in only one of them leaves the other flagging screened words.

### Suite state after slice 2

`npx playwright test --project=chromium` with `TOOLS_TEST_PORT=8799`:
**1170 of 1170 passed, 9.0m, exit 0.** That is slice 1's 22, slice 2's 20 and
everything that was already there.

Ports were checked before the run and 8788, 8789 and 8799 were all free, so
nothing adopted a foreign worktree's server. A run on all four projects was
started first and stopped at 119 of 3516 because it was going to take about two
hours; chromium is the project the rest of this branch has been scored on.
While the chromium run was going, another session's Playwright was live on 8808
out of the note-tool-interface worktree. It was left alone and it cannot have
touched this result, because `TOOLS_TEST_PORT` turns `reuseExistingServer` off.
