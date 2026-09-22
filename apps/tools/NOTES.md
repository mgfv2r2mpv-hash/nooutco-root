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

## Slice 3 - the type-time screen list

The census in slice 2 put a number on what the wide `FIRST_NAMES` dictionary
costs: 26 false positives over 12 notes, 2.2 a note, and a supervision note
naming three programmes pays 10 on its own. The maintainer's ruling is that the
width stays and the cost is paid here instead, by a technician clearing a word
once, before they draft, rather than by narrowing detection.

### What a cleared word does

`NotesScrub.screenAnswer(word, "not-a-person" | "take-it")` records one of the
two answers. `not-a-person` puts the word in a device-local list; `take-it`
affirms the flag and takes the word back out of the list if a mis-tap had put it
there. Both record a count and the pass name, and neither records the word.

The consult sits in `NotesScrub.detect()`, which is the one place both flagging
paths already met: `review()` calls it for the tokens, and `_syncHighlight` used
to call `NotesGate._scrub.detectNames` directly and now comes through here too.
That was the trap the slice 2 reconnaissance named, and it is closed by routing
rather than by two consults that could drift.

### Where the list lives, and why not in either store that already exists

- **Not `NotesGate.draft.save`.** `decryptDraft` drops a record after 12 hours
  and `clearAllDrafts()` wipes every `notes_draft_` key at logout. Both are right
  for a note and both are wrong for a list that holds no note text: a technician
  would re-answer the same six words every morning.
- **Not `NotesGate.nonPii`.** That store is a shared vocabulary and syncs to
  `/api/nonpii` so a whole clinic stops seeing the same programme name flagged.
  A screening answer is the opposite: one person, one word, at typing speed, and
  the word may well BE a name that this technician decided not to protect.
  Transmitting it would turn a local convenience into a disclosure.
- **What is reused is the key, not the store.** `encryptRecord` and
  `decryptRecord` are the draft pair generalised, so the screen list gets the
  same non-extractable AES-GCM key out of IndexedDB and the same
  `{v, iv, ct, savedAt}` envelope under `noaba_screen_<technician>`.
  `decryptRecord(raw, null)` means no age limit, which is a different record
  rather than a relaxed draft, and the reason is written at the function.
  `screen.ready` is chained off `draftsReady` rather than racing it, because both
  want the same IndexedDB key and minting it twice on a cold device writes two.

The owner is inside the ciphertext as well as in the key name, so moving a
record onto another technician's key does not hand them the list. There is a
test for exactly that, because the key name alone would not have noticed.

### The rules that make it safe

- **Identifiers can never be screened, and there are two locks.**
  `screenNormalize` admits letters only, one word or two, which structurally
  excludes every shape `detectIdentifiers` matches, since each of them carries a
  digit, an `@` or a slash. `screenRefusesIdentifier` then asks
  `detectIdentifiers` outright. The third guarantee is structural and is the one
  that matters most: `identifierMap()` runs first in `review()` and never reads
  the list at all, so screening `Jacob` leaves `123 Jacob Street` tokenised whole.
- **Adjacency beats a prior screen.** A screened word carrying an attached role
  cue is flagged anyway: `mom Grace`, `client Grace`, `Grace, his mother`. The
  decision is `cueRole()`, the same function the token path uses, so the two
  cannot disagree about a sentence. A cue merely in the same sentence claims
  nothing, which is the rule the token path already had.
- **Cap and expiry.** 200 entries, freshest kept. An entry unseen for 25 notes is
  dropped, and a note is a draft: `review()` ticks the counter when `newNote` is
  true, which the engine sets from `!carryOver`, so a technician who revises hard
  does not expire their own answers by lunch. A note that uses a screened word
  again refreshes it.
- **The audit carries counts and a pass name.** `phi_screen` sends
  `{pass: "name", screened, cued}` and `phi_screen_answer` sends
  `{pass: "name", cleared, confirmed}`. Note that the client sanitiser would
  happily pass a four letter word through its short-slug rule, so the claim
  being tested is the emit site's and not the sanitiser's.

### What the interface would need, written down rather than built

The maintainer is ruling on the note page layout, so no popover was built. What
exists is the seam under it, and it is the part that had to be settled whatever
the answer looks like.

- A tap cannot land on a mark. The highlight layer is `pointer-events:none` at
  `z-index:0` and the textarea sits on top; giving the layer pointer events would
  take the click away from the field and stop typing working.
- So the caret is the way in. A click or a tap sets `selectionStart`,
  `NotesScrub.markAt(text, offset)` maps that offset back onto the span the
  overlay drew, and `_attachHighlight` raises `notes-phi-mark` on the textarea
  with `{word, name, start, end, field}`. Mouse and touch both land there, so
  there is one path rather than two to keep in step.
- What is left for the interface is two buttons and where to put them. A page
  listens for `notes-phi-mark` and calls `NotesScrub.screenAnswer(word, answer)`.
  Nothing else in this slice depends on that decision.
- `detectedSpans()` is what both halves read, so what glows and what a tap means
  cannot disagree. Writing it also fixed a live fault in the overlay: the old
  pass ran each name's regex over HTML that already had marks in it, so a shorter
  name inside a longer one matched the text INSIDE a `<mark>` and nested a second
  one in it. `Caregiver Barbara Jean attended with Barbara.` did it.

### Landing tests and their revert proof

`tests/phi-screen-list.spec.js`, 26 tests. Every guard was taken out, the spec
run, and the guard put back.

| guard removed | tests that failed |
|---|---|
| the screen consult in `detect()` | 11 |
| the role cue override in `screenFilter` | 3: the cue in front, the role label in front, the appositive behind |
| `screenRefusesIdentifier` in `screenAdd` | 1: the labelled record number made only of letters |
| the letters-only rule in `screenNormalize` | 1: the word no identifier pattern would catch |
| the owner check inside the ciphertext | 1: a record moved to another key |
| the cap in `screenPrune` | 1: the list is capped |
| the notes-unseen expiry in `screenPrune` | 2: the entry expires, drafting advances the clock |
| the seen refresh on the drafting path | 1: a note that uses the word again restarts its clock |
| the note counter tick in `review()` | 2: drafting advances the clock, a revision does not tick twice |
| encryption at rest for the screen list | 1: not plaintext in localStorage |

**Three guards caught nothing on the first pass, and the fix was fixtures rather
than a shrug.** The two identifier locks each refused all nine identifier shapes
on their own, so removing either one left the other holding the door and no test
moved. They now have a fixture apiece that only one of them catches: `b12` and
`apt 4b` for the letters-only rule, `policy abcdef` for the identifier check,
which is two plain words the letters rule admits and the labelled-ID pattern
reads as a record number. The note counter tick caught nothing because every
expiry test called `advanceNote()` by hand; two tests now draft notes instead,
which is what the expiry is actually counted in.

### Known costs, stated rather than discovered later

- A detected candidate with a digit in it cannot be screened. `detectNames`
  cannot produce one, so this is not reachable from a mark today; it would bite
  if a future pass started returning them.
- A two word phrase whose second word reads as a labelled record number is
  refused. `Chart Notes` is the realistic one, because the labelled-ID pattern
  treats `chart` as a cue and takes the next word whatever it is. It stays
  flagged, which is the conservative direction, and it is the same false positive
  the slice 2 census already recorded against `Insurance authorisation`.
- A logged-out page screens nothing, because there is no technician to key a list
  to. Words are still flagged, which is the direction this has to fail in.

### Suite state after slice 3

`npx playwright test --project=chromium` with `TOOLS_TEST_PORT=8799`:
**1196 of 1196 passed, 10.1m, exit 0.** That is slice 1's 22, slice 2's 20,
slice 3's 26 and everything that was already there.

Ports 8788, 8789, 8799 and 8808 were all checked before the run and all four
were free, so nothing adopted a foreign worktree's server.

---

## Slice 4 - one alert budget, and changes accepted by default

Two new files, both pure data and neither of them draws anything:
`notes/bcba/alert-budget.js` and `notes/bcba/disposition.js`. Both are loaded by
`/notes/bt/` and `/notes/bcba/`, after `note-rubric.js`.

**No interface was built and none was designed.** The maintainer is ruling on
the revision panel and the note page layout, and the ghost checkmark with the
revert arrow is retracted. What is testable without a layout is what got built:
which findings are produced, how they are ranked, what is withheld and why, and
what a technician's answer is worth. The section at the bottom names what the
interface would need when the ruling lands.

### The eight producers, and the tier each one states

| Producer | Reads | Tier, and why |
|---|---|---|
| `scrub` | the substitution map and the drafted note | **1** for a token left in the note: the clinician is reading `[[T3]]` where they wrote a word. **2** for a name that was substituted and stayed, which is an ordinary fact about a note with a person in it |
| `wrong-section` | `NoteHollow.misplacedInput` against the tool's own table | **1**. A consequence procedure narrated as an antecedent one is the note stating something that did not happen that way |
| `passes` | `NoteAbsence.scrubNote`, `NoteHollow.passNote` | **1** for a FLAGGED absence sentence, which stayed because a person was the subject and is the note asserting something nobody observed. **2** for a hollow section |
| `rubric` | `NoteRubric.grade` | **1** at level `missing`, **2** at level `thin`, nothing at `good` |
| `hints` | the model's own hint array | read straight off `kind`: `blocks-claim` 1, `thin` 2, `register` 3 |
| `expert` | the expert pass result | its hints by the same three kinds, its register and term findings **3** |
| `gaps` | the triage questions | **2**. What the model could not tell from the note is what the note is missing |
| `register` | `NoteMetrics.flagged` | **3**, and only at three flagged constructions or more. One is a word choice, three is the register |

`gaps` drops any question carrying `injected`, because those are the misfiled
rows that `wrong-section` already raised at tier 1. Without that filter one
finding sits in the queue twice under two tiers.

### The three rules, and what enforces them

- **A tier 3 never occupies a slot while a tier 1 is unresolved.** Not ranked
  below it, withheld, with `withheld: "tier-1-open"` on the item.
- **A producer that cannot state its tier gets no slot.** It lands in `refused`
  with a reason. Four routes into that list: an unknown hint `kind`, a rubric
  `level` nobody declared, a source key naming no registered producer, and a
  producer emitting a tier outside 1..3.
- **A producer's own rank cannot promote it past another producer's tier.**
  `rank` sorts inside a tier only.

**Resolved is not the same question as accepted, and the difference is the whole
rule.** A change the tool made is accepted by default, which is ruled. A finding
is a statement that the note has a fault, and nobody untouching it has answered
that, so `none` leaves a tier 1 open and the tier 3 stays withheld. Only
approve, reject, revert or edit resolves one.

### The cap is five, ruled by Kaleb on 21 September

Five rows for the whole note, across all eight producers. The number was
borrowed rather than picked: the pre-draft check already argued it for its own
findings, "two findings is a technician who has something to fix; five is a
wall, and a wall gets skipped whole". That argument was made about one producer,
and five across all of them is the same ceiling put where it belongs. `build()`
takes a cap, so nothing in the code treats five as a law, and the tests assert
the cap is enforced rather than that it equals five.

**Kaleb ruled the number on 21 September and left it at five.** It was carried
to him as an open question with the alternative on the table, and he answered
"keep 5", so the heading no longer asks. `DEFAULT_CAP` is unchanged in
`notes/bcba/alert-budget.js`; what changed is that the five is now a decision
rather than a borrowing waiting on one.

### The identifier family, ruled by Kaleb on 22 September

**A check whose job is to catch a restorer's failures has to be strictly wider
than the restorer, never the same width.** That rule was written here on 18
September and applied to the opaque token family. It was left unapplied to the
identifier family, which is the branch where it mattered more.

The two families are minted in different shapes, and the difference is the whole
fault:

| family | minted | identity | example |
|---|---|---|---|
| opaque | DOUBLED, `[[T3]]` | the number | a name, a place, a device |
| identifier | SINGLE, `[DATE_1]` | the TYPE and the number | a date, a phone, an MRN |

Measured on `origin/main` rather than reasoned about: **6 of 11 identifier
reshapings rode past the restorer**, and one of the six was worse than a miss.
A model that doubles the brackets writes `[[DATE_1]]`, which HOLDS the minted
`[DATE_1]` as a substring, so the literal substitution rewrote the inside and
left the outside, handing the clinician `[3/14/2025]` with stray brackets welded
to their own date. A miss is visible. That reads as prose.

**Both halves were widened in one change, which is what Kaleb ruled.**

- `restoreLooseIdentifier` in `notes-gate.js` now reads the identity and treats
  the delimiters as decoration, the same way the opaque pass does: one or two
  brackets, escaped or not, square, round, fullwidth or CJK, `_`, `-` or a space
  for the separator, a padded number, and a merged `[DATE_1, TEL_2]` run. A run
  is ALL OR NOTHING: one number in it this note never issued and the whole run
  is left alone for the check below to catch.
- **The identifier pass now runs BEFORE the literal one, and only this one
  does.** That is what fixes the welded bracket. The opaque family has no such
  hazard, because it is minted doubled, so matching it literally is right and
  its loose pass keeps its old place after the literal one.
- `strandedCount` in `notes/bcba/alert-budget.js` grew an identifier arm. It had
  read T-numbers only, on main and in the branch both, so a stranded `[DATE_9]`
  raised no tier one at all and the note could be filed with a token sitting
  where a date belongs. That is the worst version of this producer's own fault,
  because an identifier is the one class of word that can never be screened off
  or exempted: the restorer is the only thing that puts it back, and this is the
  only thing that says when the restorer did not.

**Two arms again, and the split is the same one.** The square-bracket arm holds
the underscore fixed and needs NO map, because `[DATE_1]` is the shape the page
mints and a lost ledger is exactly when a token cannot be restored and exactly
when nothing else would say so. The wide arm takes the loose separators, the
other brackets and a bare `DATE_1`, and it IS map-gated, because `[see Note 3]`,
`(Item 5)` and `Phase 2` are ordinary clinical writing. Square brackets appear
in both arms on purpose: with the underscore intact they are evidence on their
own, with a loose separator they need the ledger to tell a token from a
sentence.

**Proved by driving both real files over 29 shapes**, not by reading the
regexes: every shape either comes back with the clinician's word in it or comes
back with a tier one on it, and none falls through both. The count is on the
IDENTITY and both families feed one set, so a word the model repeated four times
is one row and the type carries half the key, since a note holding `DATE_1` and
`PHONE_1` at once holds two different words.

### The four dispositions

| Answer | Weight | Evidence | Note |
|---|---|---|---|
| `none` | +1 | `kept` | the default acceptance, low but never zero |
| `approve` | +3 | `endorsed` | they went out of their way to agree |
| `reject` / `revert` | **-3** | `refused` | negative evidence, the same magnitude as an approval and the other way round |
| `edit` | +5 | `rewritten` | strongest, and the only one carrying a specimen |

The numbers are ORDINAL. They encode the order the maintainer stated and nothing
else; no fitting has been done. Every caller reads `weightOf()` so a learned bar
replaces them without another file changing.

**The offered/kept pair never enters the ledger, and that is structural.**
`record(ledger, event, sink)` hands the pair to a sink the caller passes, on an
edit and only on an edit, and the entry it appends has no field that could hold
it. A test serialises the whole ledger and asserts neither sentence is in it.
`closeNote(ledger, offered)` files every offered item nobody answered as `none`,
and never overwrites an explicit answer.

### NoteRubric now reports the severity it graded on

`grade()` returns `band` and `worstTier` beside `level`, `reason` and
`dimensions`. `level` is unchanged and still categorical: a blocking gap is
`missing`, any other gap is `thin`, no gap is `good`. **No numeric bar was
picked and nothing turns a count into a level.**

- `band` counts GAP DIMENSIONS per tier, never hints. Five register findings
  inside one dimension are one thing wrong with the note, and counting them five
  times is the hint tally wearing a different hat.
- `blocking` is now read off the tier rather than off the hint kinds a second
  time. Both spellings picked out the same hints, which is the problem: a change
  to one would leave the other still answering and nothing in the tree saying
  which answer was real.
- **`bySeverity` stopped reporting a tally, and that was a live fault rather
  than a tidy-up.** Its detail read `"1 flagged"`, and on a tool that declares no
  rubric that string becomes the pill's whole reason. Four of the six tools
  declare no rubric. It now names the top hint's catalog text, which is what the
  named dimensions have always done.

### Revert proof: alert-budget.js and disposition.js

Every guard removed, the suite run, the guard restored. 18 of 18 land.

| Guard removed | Tests that failed |
|---|---|
| the tier 3 withholding rule | 2 |
| `none` does not resolve a finding | 1 |
| tier sorts before any producer rank | 1 |
| a hint kind with no tier is refused | 1 |
| a rubric level with no tier is refused | 1 |
| an unregistered source key is refused | 1 |
| the cap | 1 |
| the token family wider than `[[Tn]]` | 4, one per non-canonical shape |
| the tier check at the end of `collect` | 1 |
| a reject is negative | 2 |
| an edit outweighs an approval | 2 |
| an unknown disposition is dropped, not defaulted | 1 |
| the sink fires on an edit alone | 1 |
| the entry cannot hold the pair | 1 |
| `record` returns a new ledger | 1 |
| `closeNote` skips a class already answered | 1 |
| a revert is the same act as a reject | 1 |
| the producer registry is injectable | 1 |

**One guard caught nothing first time and the fix was to make it reachable.**
The tier check at the end of `collect()` was landed by nothing: all eight
producers refuse their own untiered findings on the way past, so removing it left
26 tests green. The registry is injectable now, which lets a test hand `collect`
a ninth producer that emits tier 9 and assert it is refused. Without that the
rule "a producer that cannot state its tier gets no slot" was a claim about code
no caller could reach.

### Revert proof: note-rubric.js

| Guard removed | Tests that failed |
|---|---|
| hint dimensions carry a tier, and blocking is read off it | 4 |
| the band counts dimensions, not hints | 1 |
| the empty-section dimension carries a tier | 1 |
| `bySeverity` carries a tier | 1 |
| `bySeverity` names what to fix rather than how many | 1 |

**Two of these caught nothing until the code or the fixtures changed.** The
first was a dead branch I had written myself: `level` read
`blocking.length || worstTier === 1`, and no dimension can be tier 1 without
being blocking, so the second half was unreachable. Two answers to one question
in the tree. Blocking is now derived from the tier and the branch is gone. The
second was the empty-section dimension's tier, which no test asserted because
every empty-section fixture also carried a claim-blocking hint and graded tier 1
anyway; a fixture with a blank narrative and nothing else lands it.

### What the interface would need, when the ruling arrives

Written here rather than built, per the instruction.

- `build()` returns `{shown, withheld, refused, open, cap, offered}`. `shown` is
  the list to draw, in order. Nothing else needs computing.
- Each item carries `producer`, `tier`, `code`, `section`, `detail` and `key`.
  `detail` is the reader's sentence; `key` is the disposition's identity and is
  built out of enums alone.
- `withheld` is not a second list to draw. It is the answer to "why did I not see
  that", and it belongs in a bench or an audit rather than on the note page.
- **No per-item accept control, and no checkmark.** The only thing the reading
  path needs is a way to reach `reject` and `edit`; `none` is what happens when
  nobody does anything and is recorded by `closeNote` when the note is filed.
- An edit needs the offered sentence and the kept sentence at the moment it is
  recorded, which means whatever captures a retype has to hold the prior text
  long enough to pass both to `record`. `diff.js` already does this work for the
  revision view.

### Not wired into engine.jsx yet, and that is deliberate

The engine still renders each producer where it always did. Wiring the queue in
is a change to what the technician sees, and the layout ruling is what decides
where the queue goes. Everything the engine would need is a pure function call
with values it already has in hand: `S.scrubMap`, `S.output`, `S.output.hints`,
`S.questions`, `S.expert`, the `finalize()` counts, `NoteMetrics.flagged` on the
note body, and `noteQuality()`.


### A defect this slice introduced and caught before it shipped

`collect()` checked incoming source keys against PRODUCER IDS, and a producer id
is not the field its findings arrive under: the wrong-section producer reads
`misfiled`, the passes producer reads `absence` and `hollow`, the rubric reads
`quality`. So every real source would have been refused as unregistered, and
`refused` is the one list whose whole job is answering "why did I not see that".
Filling it with five false entries per note would have hidden a real refusal in
the noise, and nothing would have failed: the unregistered test passed on a key
nobody reads, which is the fixture that agrees with the bug.

Each producer declares `reads` now, and the test that lands it asserts the LIVE
sources come back with `refused` empty. Removing the `reads` half of the check
fails exactly that test.

| Guard removed | Tests that failed |
|---|---|
| producers declare the source fields they read | 1 |

It was found by reading the code back rather than by a test, which is the part
worth keeping: the eight producers all pass their own fixtures, and a fixture
built to exercise a rule agrees with whatever the rule happens to do.

### All eight at once, on one note

Driving `build()` with every producer firing, cap 5:

```
offered 10  shown 5  withheld 5  open 2  refused []

shown:
  1 wrong-section:strategy_in_wrong_section
  1 passes:absence_flagged
  2 gaps:gap_b4
  2 rubric:rubric_thin
  2 scrub:substituted

withheld:
  2 passes:hollow_section      (over-cap)
  3 hints:x                    (tier-1-open)
  3 expert:expert_register     (tier-1-open)
  3 expert:expert_terms        (tier-1-open)
  3 register:tired_register    (tier-1-open)
```

Ten findings, five rows. Both tier 1 items are open, so all four tier 3 items
are held whatever they ranked themselves, and the one tier 2 that did not fit is
held for the cap and says so. Nothing is dropped and `refused` is empty.

### Suite state after slice 4

`npx playwright test --project=chromium` with `TOOLS_TEST_PORT=8811`:
**1229 of 1230 passed, 10.0m.** That is slice 1's 22, slice 2's 20, slice 3's 26,
slice 4's 27 alert-budget tests and 6 added to note-rubric, and everything that
was already there.

**The one failure is named, and it is not a regression.**
`tests/supervisor-email.spec.js:49` - "an address set at creation comes back on
the list" - failed with `apiRequestContext.post: socket hang up` on
`POST /api/admin/passwords`. The whole file passes on its own:
`13 of 13, 3.6s, exit 0`. It is the admin password route, which this slice does
not touch by any path - no file changed here is loaded by the admin page and the
route is the Worker's. The `wrangler pages dev` process was observed restarting
mid-run, which is what a socket hang up on one request looks like from the test
side.

Ports 8788, 8789 and 8799 were checked before every run and all three were free.
Another worktree, `note-tool-interface`, was running its own Playwright on 8831
throughout, verified by reading that process's `cwd`. `TOOLS_TEST_PORT=8811`
means `reuseExistingServer` is off, so neither run could adopt the other's
server in either direction.

## Slice 5 - the shrinkage module and the house prior

This iteration built stage one of slice 5: the PURE module the slice's whole
DONE WHEN list is about, plus the per author store it reads. Two new files in
`apps/profile-api`, `src/house-prior.js` and `src/voice-shrink.js`, and one new
table in `schema.sql`. No routes, no browser code, no I/O anywhere in either
file. **The three voice channels (a) diction, (b) the widened style-features
firing sites and (c) the disposition ledger routing are NOT built yet** and are
the next iteration's work. See "what is still owed" at the end.

### The ruling, and what makes it structural rather than written down

> "I don't really want BTs teaching the system anything but their style."

The house prior is not the mean over technicians. Two mechanisms enforce that,
and neither of them is a comment:

1. **`housePrior` takes exactly one argument and it must be a feature name from
   a closed list.** There is no parameter an observation could arrive through.
   A second argument is refused rather than ignored, because ignoring it would
   let a caller believe their data was being used.
2. **`buildHousePrior` parses entries against an ALLOWLIST of keys and a CLOSED
   enum of provenances.** An entry carrying `kid`, `author`, `observations`,
   `n`, `sum` or any key the file does not name is refused. A provenance outside
   `["maintainer_bar", "bcba_authored"]` is refused. Both fail closed.

The allowlist is the part that matters. A denylist of author-bearing field names
would have to already know the name of the field that one day carries a
technician's observations, and it will not. `test/voice-shrink.test.js` drives
eight field names including one called `whatever` and watches each refuse.

`authorTarget(feature, row)` has no house parameter either. It fetches the prior
by name, so a caller cannot hand it a house mean derived from anything.

### The four features, and where each number came from

`within_var` is one author's note to note variance. `between_var` is the
variance of author MEANS around the house mean. `k = within_var / between_var`
is the price of moving the estimate: how many notes an author writes before
their own mean carries half the weight.

| Feature | House mean | k | Envelope | Provenance |
|---|---|---|---|---|
| `within_cv` | 0.465 | 0.5 | 0.336 to 0.600 | `bcba_authored`, the 108 documents behind `shape.js` |
| `step_rel` | 0.309 | 4 | 0.104 to 0.584 | `bcba_authored`, same corpus |
| `actor_naming` | 0.85 | 1 | **0.40** to 1.30 | `maintainer_bar`, voice rule 1 |
| `hedging` | 0.012 | 0.25 | **0.004** to 0.045 | `maintainer_bar`, voice rule 5 |

**What is measured and what is a bar, stated because they are not the same kind
of number.** Every `mean`, `floor` and `ceiling` for the two shape features is
lifted from `shape.js`, which measured them. Both `actor_naming` and `hedging`
are the maintainer's stated rule rather than a measurement and the entries say
so in a `basis` field a test asserts on.

**Every `between_var` is a house setting, not a measurement, and this is the
honest limit of the file.** No corpus in this repo measures how far author means
sit from each other: the 108 documents are 101 from one author. So the 0.066
figure is a fair reading of one author's note to note noise and there is nothing
to divide it by. Each `between_var` carries its reasoning in the source. Two are
argued from `shape.js` itself: variability is called "effectively personal"
there, so authors should differ more than one author does, and the step is the
one number that transfers across corpora at 0.296 against 0.297, so the house
holds it four times longer. **Replacing these with measurements needs a repeated
measures corpus, several authors and several notes each, which does not exist
here.** Do not present them as measured.

**Two floors are load bearing rather than tidy.** `actor_naming` stops at 0.40
and `hedging` at 0.004. An author who strips attributions out of every note
cannot teach the tool to write notes that never say who did anything, and an
author whose every note is flat assertion cannot teach it never to mark an
uncertain observation as uncertain. Both are house requirements rather than
style preferences, and the clamp is where they stop being a comment. A test
drives 500 and 1000 notes of the offending behaviour and watches the target
stop.

### Why the clamp comes after the shrinkage and not before

Both orders clamp on the same fixture, so "it clamped" proves nothing:

- shrink then clamp: `0.465 + (1/1.5) * (0.95 - 0.465)` is 0.7883, over the
  0.600 ceiling, so **0.600**
- clamp then shrink: 0.95 clamps to 0.600 first, then
  `0.465 + (1/1.5) * (0.600 - 0.465)` is **0.555**

0.555 sits inside the envelope and would never look wrong. The test asserts the
answer is 0.600 and is not 0.555, which is the only thing that separates the two
orders.

### The style budget, and the counter that had to be made falsifiable

Three moves per note, spent only where the draft sits outside that author's
band. The band is the target plus or minus one `within_var` standard deviation,
clipped to the envelope, and the spread is the house's rather than the author's
measured one because a spread needs far more evidence than a mean.

Ranking is by band widths outside, not by raw distance: `hedging` moves in
thousandths and `actor_naming` in tenths, so a raw sort would put `actor_naming`
first whatever was actually wrong. A test builds a case where the two sorts
disagree.

**`inBandMoves` is the audit and it did not work.** It counts moves aimed at a
feature the draft had already got right, and the answer is zero by construction.
That is exactly what made it useless: replacing the entire counter with the
literal `0` broke no test, because a check that can only report zero reads
identically to one that never ran. Two changes fixed it:

- `countInBandMoves(moves)` is extracted and exported, so a test can hand it a
  move that IS in band and watch it say 1.
- `planStyleMoves` takes a `spendWhere` seam defaulting to `OUT_OF_BAND`. A test
  injects a rule that spends everywhere and the audit reports 3 moves, 3 of them
  wasted. **That is the seam slice 4 learned to reach for**: making a guard
  reachable beat deleting it there too.

### A defect found by reading, not by a test

A target whose band is not two real numbers used to **disappear from the plan
entirely**. Every comparison against NaN is false, so it earned no move, was not
in band and was not unmeasured either. It was in no list at all, and a plan
missing a feature looks exactly like a plan that had nothing to say about it.
Driven through `planStyleMoves`, a `[NaN, NaN]` band returns
`{moves: 0, inBand: [], unmeasured: []}`. It now lands in `refused` with a
reason, mirroring slice 4's diagnostic list.

The NaN was reachable: `sum_sq / n - mean * mean` goes negative on floating
point for three identical notes at 0.1, which is what the `Math.max(0, ...)`
guard in `summariseLevel` is for.

### Revert proof

36 guards, each removed one at a time, suite run, restored. 35 of them made a
named test fail. The driver is a throwaway at `/tmp/slice5-revert-proof.py`; the
table below is what it reported, so a later iteration can rebuild it rather than
look for the file.

| Guard | Landed by |
|---|---|
| `housePrior` arity, string check, unknown feature | "housePrior takes a feature name and nothing else" |
| entry key allowlist | "a corpus entry carrying an author is refused, whatever it calls the field" |
| provenance closed enum | "a corpus entry sourced from a technician is refused, by provenance" |
| missing key, `within_var`, `between_var`, finite numbers, mean inside envelope, duplicate feature, non empty feature, plain object, entries is an array | "a malformed house entry is refused rather than defaulted", "the house prior cannot be built out of author rows at all" |
| `Object.freeze` on the entry and on the map | "the prior a caller gets back cannot be edited" |
| the envelope clamp, and its ORDER | "a value outside the envelope clamps, in both directions" |
| band clipped to the envelope | "the band is clipped to the envelope" |
| the out of band filter, the default spend rule, the `spendWhere` default | "a draft already matching the profile spends nothing" |
| unmeasured feature skipped | "an unmeasured feature earns no move even under a rule that spends everywhere" |
| unusable band refused | "a target with an unusable band is refused with a reason, not dropped" |
| budget cap, rank by band widths, tie break on the name | "the budget caps the moves", "an exact tie is broken by the name" |
| variance guarded at zero, Bessel correction, non numeric measurement dropped, negative n floored, fractional n truncated | the four accumulator tests |
| `countInBandMoves` body, and its wiring into the plan | "the audit the caller reads is wired to the moves, shown by making it fire" |

**One guard is correctly caught by nothing, and it is not a test that is not
testing.** `authorTarget` writes `seen.n > 0 ? seen.mean : prior.mean`. Removing
the fallback changes no output: `summariseLevel` returns `null` for a cold
author, `null` coerces to 0, `w` is exactly 0, so the multiply is negative zero
and the sum is the house mean either way. It stays because the n = 0 case is a
promise the module makes and resting it on how `null` happens to coerce rests it
on something no test would notice breaking. The comment in the source says this
rather than claiming a NaN guard it does not provide.

**Three tests were found to be watching accidents and were rebuilt.** Two real
features "the same distance out of band" were separated by float residue, so the
tie break could be deleted with nothing failing; the tie is now built from two
synthetic targets with byte identical arithmetic and asserted in both input
orders. Four notes at 0.47 came out at exactly zero variance, so the negative
variance guard was landed by nothing; the fixture is three notes at 0.1 now. And
a negative note count was rescued by the n = 0 fallback, so asserting only the
VALUE let `n: -4` through carrying a weight of 1.07; the test asserts `n` and
`w` as well.

### Suite state after this iteration

`apps/profile-api`: `npm test` is **120 of 120 green, 5.8s**, of which 38 are the
new `test/voice-shrink.test.js`, including both
live files, which really did spin up `wrangler dev` (6 and 5 tests, 0 skipped,
verified by reading the per test timings rather than the totals).

`apps/tools` Playwright was not re-run. **No file under `apps/tools` changed in
this iteration except this NOTES.md**, so the suite state is slice 4's: 1229 of
1230 with the one named `supervisor-email.spec.js` socket hang up documented
above. The em dash sweep covers `apps/tools` only and does not reach
`apps/profile-api`; both new files were checked by hand and are clean.

### What is still owed on slice 5

- **(a) DICTION.** LANDED, see "Slice 5a" below. The house synonym-family
  dictionary is `notes/bcba/diction.js`, the per author record is
  `{family_id, variant_index, count}`, and a word not in the dictionary has no
  index, counts as unknown and is dropped. Its write path has LANDED, see "The
  write path" below.
- **(b) SHAPE.** LANDED, see "Slice 5b" below. A rejected correction, a
  reworded one and hand typing are three pairs cut from one chain in
  `notes/bcba/specimens.js`, all taught at the first Copy.
- **(c) THE DISPOSITION LEDGER.** LANDED, see "Slice 5c" below. The sink is
  `notes/bcba/distill.js`: one edit's pair gives a diction tally and a shape
  specimen, and a ledger row now refuses any class field that is not an
  identifier.
- **The write path.** LANDED, see "The write path" below. `voice_level` and
  `diction_level` are written through `/api/audit` and `/events`, the route the
  Pages worker already forwards. There is no new route on the profile Worker.
- **A number the maintainer has now ruled on.** `MOVES_PER_NOTE` is **2 of 4**
  features. The worker chose 3 as "most but never all of them" and flagged that
  nobody had ruled. Kaleb ruled it to 2 on 18 September, against his standing
  requirement that the tool sound like the author without overtrying.

## Slice 5a - the house synonym families, and the only thing a word leaves behind

`notes/bcba/diction.js` (new, loaded by both note pages), `../profile-api/src/diction-level.js`
(new), `../profile-api/schema.sql`, `tests/diction.spec.js` (29 tests),
`../profile-api/test/diction-level.test.js` (17 tests).

This is part (a) of slice 5. Twenty families, 85 variants, 309 surface forms.
The four families the maintainer named (prompting, mand, elopement,
dysregulation) are his; every surface form under them, and the other sixteen
families, are authored here and are the part to argue with.

### The record is three fields, and a word is not one of them

A technician writes "prompted" and another writes "assisted", and the difference
is the voice this run is trying to learn. The obvious way to learn it, keeping
the words somebody used, is a store full of clinical text inside a week, and a
store full of clinical text is a store that eventually holds a name.

So a word is looked up and only its coordinates leave: `{family_id,
variant_index, count}`. A word the house does not hold has no coordinates at
all, so it is added to a number called `unknown` and dropped. On the sentence
"Marisol Quintero brought the periwinkle folder from Ashford Lane" the module
returns no counts, `unknown: 9`, and nothing else.

That is structural rather than promised. Inside `tally` the matched text ends at
the line that computes `hit.family + ":" + hit.variant`, and every line below it
reads `FAMILIES[i].id` and an integer, so there is no variable a word could be
sitting in when the entries are built.

### Two gates, because the browser is the side somebody else controls

`NoteDiction.record()` checks the tally against the SEALED house dictionary, not
against whatever dictionary produced it, so an injected family cannot ride a
payload into a caller who is about to write it down. Then
`diction-level.accept()` checks it again on the Worker side. The second one is
the gate that decides what gets stored; a gate that runs before an untrusted hop
is not a gate.

Both refusals name the slot and never quote the id they refused. A rejected
`family_id` is a string somebody on the other side chose, and writing it into a
log is the same mistake in a different file.

### The store side holds no surface form at all

`src/diction-level.js` holds `{prompting: 6, mand: 4, ...}` and no synonyms. Not
because a synonym list is secret, but because the question a reviewer has to
answer there is one sentence long: is every value in this table a slug from a
closed list or an integer. A test reads the browser dictionary, collects all 309
forms, and asserts none of them is quoted in the store module.

`variant_index` is a POSITION, which makes it a stored value: a synonym inserted
in the middle of a family in the browser silently rewrites the meaning of every
row already in D1, and nothing would error. Append, never insert. The mirror test
loads the real browser file and pins the two sides together, which is the only
moment they are ever in one process.

### Forms that are missing on purpose

A form that is a different word in these notes is worse than a form that is
absent, because it counts a meaning the author did not reach for.

| left out | family | why |
|---|---|---|
| `ran`, `running` | elopement | "ran mixed trials" is half the session notes in this app. The family holds `ran off` and `ran away` as phrases instead |
| `note`, `noted` | display | a note is the object this whole app makes, so the word is furniture rather than a choice |
| `bit` | self_injury | "a bit longer" is the same three letters |
| `engaged in` | display | longest-first matching would take it out of the engagement family every time the next word happened to be "in" |

`tally` scans longest form first, so a phrase beats a shorter form that starts
it. The fixture that proves it had to be hunted for: "asked for" does NOT prove
it, because "asked" is in no family and the scan reaches the phrase from either
direction. The rule only bites where both forms are real, which in this
dictionary is `prompted back` (redirection) against `prompted` (prompting). Read
shortest first, and the redirection the technician described is gone.

### Revert proof, the browser module

Seventeen guards, each taken out, `tests/diction.spec.js` run, put back. All
seventeen are caught. The spec is green after every restore and `git status`
shows the three files unchanged.

| guard | named test that fails |
|---|---|
| longest match first | tally / a phrase wins over a shorter form that starts it |
| first writer wins on a duplicate form | tally / a duplicated form fires from the family that wrote it first |
| the text is lowercased before lookup | tally / a variant is recorded by its index, whatever case it was typed in (+1) |
| a form past the phrase cap is dropped at load | tally / a form longer than the phrase cap is never looked for |
| tally sorts its counts | tally / counts come back in a stable order whatever order the note used |
| record refuses an unknown family | record / a family the house does not hold is refused |
| the refusal does not name the family | record / a family the house does not hold is refused |
| record refuses a variant index outside the family | record / a variant index past the end of a real family is refused (+1) |
| record refuses a count that is not a positive whole number | record / a count that is not a positive whole number is refused |
| record sorts what it kept | record / a payload comes back in the same stable order |
| unknown and words coerced to a whole number | record / unknown and words come back as whole numbers |
| merge refuses an unknown family | merge / a family the house does not hold cannot enter the running total |
| merge refuses a fractional index or count | merge / a fractional count or index cannot enter the running total either |
| merge copies rather than carrying the argument row | merge / neither argument is touched |
| elopement holds phrases, never bare "ran" | tally / "ran mixed trials" is not elopement and "ran off" is |
| the bt page loads the dictionary | both note pages load the dictionary |
| the bcba page loads the dictionary | both note pages load the dictionary |

### Revert proof, the store module

Thirteen guards, `node --test test/diction-level.test.js`, twelve caught.

| guard | named test that fails |
|---|---|
| the mirror is pinned to the browser dictionary | the mirror matches the browser dictionary, family for family |
| a family is looked up as an OWN property | accept refuses an inherited property masquerading as a family |
| accept refuses an unknown family | accept refuses a family the house does not hold (+2) |
| the refusal does not quote the id | accept refuses a family the house does not hold, without quoting it |
| accept refuses a variant index outside the family | accept refuses a variant index outside the family it names |
| accept refuses a bad count | accept refuses a count that is not a positive whole number |
| one note's vote is capped at 50 | one note's vote is capped, folding a repeated key first |
| a repeated key is folded rather than half lost | one note's vote is capped, folding a repeated key first |
| accept sorts | accept returns rows in one stable order however they arrived (+1) |
| FAMILY_VARIANTS is frozen | FAMILY_VARIANTS is frozen, so a caller cannot widen the closed list (+3) |
| applyNote puts a stored row through the same gate | a stored row the house no longer holds is dropped rather than carried |
| familyShares refuses an unknown family | familyShares refuses a family the house does not hold |

`FAMILY_VARIANTS[entry.family_id]` written as a plain lookup lets
`{family_id: "constructor"}` through, because `Object.prototype.constructor` is
not undefined and `0 >= [Function]` is false. That is a row keyed on a string an
attacker chose, sitting in the store. `hasOwnProperty` is what closes it, and the
test that lands it names `constructor` and `toString` specifically.

### Two guards I wrote and then removed, because nothing could land them

Both were a fresh object built where an in place add would do, in
`NoteDiction.merge` and in `applyNote`. Neither could be landed, for the reason
slice 5 hit twice: the row being updated was built by the push above it or by
`accept()`, so it is the function's own object and mutating it cannot reach
either argument. The copy that carries the immutability claim is the one at the
push, and THAT one is landed (take it out and "neither argument is touched"
fails). A second copy downstream of it is a guard that can only ever agree.

### What this does not do yet

Nothing calls `NoteDiction` yet, exactly as `alert-budget.js` is loaded and
uncalled. The call site is (c), the disposition ledger, which is where an edit
produces an offered/kept pair to diff. Wiring the tally into the draft path
before that exists would be counting words for nobody.

`diction_level` has a table and no route, the same gap `voice_level` has. Both
close together when the write path lands, through the Pages worker the way
`/events` already does. The browser never calls the profile Worker directly.

**A number the maintainer has now ruled on.** `MAX_COUNT_PER_NOTE` is **10**. It
exists so one note with a stuck key cannot outweigh a year of notes. The worker
set it to 50 and wrote "50 is a guess". Kaleb ruled it to 10 on 21 September,
because a BT session note runs a few hundred words: one family reaching fifty
inside it IS the stuck key, so a cap that only fires there is not bounding a
vote. Ten sits above anything a real note produces and below anything a jam
produces.

### Suite state after slice 5a

`apps/profile-api`: `npm test` is 137 of 137 green in 5.8s, of which 17 are the
new `test/diction-level.test.js`.

`apps/tools`: `tests/diction.spec.js` is 29 of 29 green on chromium in 3.4s
(28 of them node only, one loads both pages).

The full chromium project was re-run after this change and is **1259 of 1259
green in 9.4 minutes**, on `TOOLS_TEST_PORT=8841` with 8789, 8799, 8808 and 8841
all checked free before the run, so no foreign worktree's server could have
answered. The one `supervisor-email.spec.js` socket hang up named under slice 4
did not recur, which supports the reading there that it was ephemeral rather
than a regression.

## Slice 5b - where the style measurement fires

`notes/bcba/specimens.js` (new, loaded by both note pages), `notes/bcba/engine.jsx`
(a ref, one effect, one reset line, the copy-time call and one guard on the
voice capture), `tests/style-specimens.spec.js` (15 tests).

**Nothing about what leaves the page changed.** `style-features.js` is not
edited. What the store receives is still `{feature, direction, magnitude,
source}` plus the `ts` notes-gate adds, and `source` is still `revision` or
`manual`. The kind of a specimen never rides along; it picks one of the two
sources compare already carried, and that is all.

### One pair was three acts, and one act that was not the technician's

Before this, the note taught once at copy: the model's draft against the note
that was copied. On a note the corrections pass touched, that pair holds four
different things.

```
draft      what the model wrote
  |        the corrections pass. The TOOL did this. Not measured.
offered    every correction standing
  |        REJECTED   the technician undid a correction      source revision
rejected   only the undos applied
  |        EDITED     the technician reworded one they kept  source manual
decided    the marks as they now read
  |        OVERTYPED  the technician typed over it by hand   source manual
shipped    what they copied
```

Each link is one pair, so no difference is taught twice and each is taught as
the act that made it. **The old comparison was a live fault, not just a narrow
one:** a correction nobody touched was taught as `manual`, which is the
technician's own typing. Slice 4 ruled that an untouched change is the weakest
evidence there is, and the store was receiving it as the strongest. A test
drives exactly that note, first proving the old comparison finds a hedging
change on it, then asserting nothing is posted.

For a note with no marks the chain collapses to the old comparison exactly
(draft, draft, draft, shipped), and a test pins that too.

### When it is taught

All three at the first Copy, off the note's final state, behind the same
`taughtRef` that keeps a note from teaching once per Copy press. That was a
choice between two moments, and the other one was worse: teaching at the click
would teach a correction undone and then put back as a rejection it no longer
was. A test undoes and restores a correction and asserts nothing is posted.

### The book, and why it exists

"Edit by hand" (`dismissCorrections`) removes a section's marks and its mark
state, which was the only record of what had been offered and what was undone.
A section finished by hand would fall back to the model draft as its baseline
and lose the rejection. So an effect in the engine calls
`NoteSpecimens.observe(book, S.corrections, S.markState)` whenever the marks
change, and the book keeps a section's three readings after its marks are gone.
It is reset in `draftNote` beside `taughtRef`, so the last note's corrections
cannot become this note's baseline. None of the existing handlers were edited
to feed it, which keeps the rebase against `note-tool-interface` to the lines
listed above.

### A rejection is not the owner's prose

`emitStyle` also hands every pair to `VoiceCapture`, which keeps pairs of the
owner's own writing. A rejection's after side is the model's draft put back, so
`KINDS.rejected.own` is false and `emitStyle` skips the capture for it. It
still reaches the style store, because refusing a change is real evidence of
what the author prefers.

### Landing tests and their revert proof

Sixteen guards, each removed alone, the spec run, the guard restored. All
sixteen fail at least one named test. The driver is a throwaway at
`/tmp/slice5b-revert-proof.py`; it hashes every file it touches before and
after, and the hashes matched.

| Guard removed | Tests that failed | The named one |
|---|---|---|
| the REJECTED firing site | 5 | a REJECTED correction teaches, as a revision, in the direction the technician went |
| the EDITED firing site | 2 | an ACCEPTED THEN EDITED correction teaches, as the technician's own prose |
| the OVERTYPED firing site | 3 | a MANUAL OVERTYPE teaches, as the technician's own prose |
| the engine call at copy | 6 | all three firing site tests |
| the engine effect that observes the marks | 7 | a correction left standing is not taught as the technician's prose |
| the book reset in `draftNote` | 1 | a new note starts a new book, so the last note's corrections cannot teach on this one |
| `observe` keeping a section after its marks are gone | 2 | a section finished by hand after an undo still teaches the rejection |
| the rejected stage carrying undos only | 2 | an ACCEPTED THEN EDITED correction teaches (a rewording arrived as a rejection) |
| a link with no change dropped | 1 | a note with no marks yields exactly the old comparison, and nothing else |
| rejection source is `revision` | 4 | a REJECTED correction teaches, as a revision |
| `KINDS.rejected.own` is false | 2 | a rejection is never filed as the owner's own prose in the voice capture |
| `emitStyle` honours `own` | 1 | a rejection is never filed as the owner's own prose in the voice capture |
| the effect's guard for a missing module | 1 | a page that failed to load the specimen module still drafts and copies, and throws nothing |
| the copy guard for a missing module | 1 | the same |
| the bt page loads the module | 11 | both note pages load the specimen module |
| the bcba page loads the module | 1 | both note pages load the specimen module |

**Each firing site is one line** (`link(out, "rejected", ...)` and its two
siblings), so "that site alone removed" is a literal one-line deletion rather
than a condition added to skip it. In each of the three firing tests the other
two links are identical on both sides, so nothing else can pick up the slack.
The edited test also asserts the direction of `hedging`: measured against the
model's draft instead of against what was offered, a rewording of an inserted
hedge moves hedging nowhere, and that is how the effect's removal is caught
there rather than passing on some other `manual` feature.

**The two missing-module guards each have a test of their own.** Both are
there so a page that failed to fetch `specimens.js` keeps working. No other
test in the spec loads a page without the module, so the one that aborts the
script and listens for page errors is the only one that can see either guard go.
The effect guard matters more than it looks: an effect that throws unmounts the
whole note. That test grants clipboard permission, because headless Chromium's
refused clipboard is a page error of its own and would have failed it for a
reason unrelated to this.

### Known costs, stated rather than found later

- **One note can now post the same feature up to three times**, once per act.
  They are three decisions, not one measurement repeated, which is the
  distinction the teach-once ruling drew. `acceptProposal` already posted a
  revision and a copy-time comparison off one note. `derive.js` does not read
  `source` at all, so the store weighs a rejection, a rewording and an accepted
  revision the same. The disposition weights from slice 4 live in the browser
  ledger and do not reach the card. That is slice 5c's question, not this one.
- **A revision accepted onto a section that still has marks** is measured twice:
  once as `revision` when it is accepted, and again as `manual` inside the
  overtyped link. `acceptProposal` replaces the section's text and leaves its
  marks alone, so the book's decided text is still the marks' reading. Read
  from the code, not driven by a test. The old copy-time comparison measured
  an accepted revision a second time as `manual` too, so this is not new, but
  it is not fixed either.
- **The book is filled by an effect**, which runs after paint. A technician who
  changes a mark and presses Generate Note inside the same frame could leave
  that last reading in the book after the reset. Nothing in the tests reaches a
  window that small, and the cost if it happened is one wrong baseline on one
  note.

### Suite state after slice 5b

`tests/style-specimens.spec.js` is 15 of 15 green on chromium, port 8853.
`apps/profile-api` `npm test` is 137 of 137 with 0 skipped. **The full chromium
project was not run to the end in this iteration.** It reached test 593 with
every one passing, and then the iteration had to close and stop its own
processes. The `✘` lines after 593 in that log, and its exit 143, come from
stopping the server under running tests, not from the code. The next iteration
owes a full run before it claims the project green. Ports 8788, 8789, 8799 and
8808 were free at every check, and 8853 was free once the run was stopped.

## Slice 5c - what an edit teaches

`notes/bcba/distill.js` (new, loaded by both note pages), `notes/bcba/disposition.js`
(the identifier rule for class fields), `tests/distill.spec.js` (20 tests).
**No engine.jsx line was added in this slice.** Nothing on this branch answers a
suggestion yet, so a call site here would be code nobody reaches. The call the
host wires is written out below.

### One pair in, two readings out

`NoteDisposition.record` already handed an edit's offered and kept sentences to
a sink and kept neither. `NoteDistill.distill` is that sink, and both readings
come off the one pair it is handed:

- **diction** is what the rewrite reached for that the offer did not hold:
  `tally(kept)` less `tally(offered)`, positive differences only, through
  `NoteDiction.record` so a count can only be a house family and a whole number.
  A word the offer already had and the technician left standing is the weak
  `none` answer, so it is not counted as the edit's evidence.
- **shape** is a specimen in the form `specimens.js` already hands the style
  measurement, `{kind: "edited", source: "manual", own: true, before, after}`,
  with the offer before and the rewrite after. A test pins its source and owner
  to `NoteSpecimens.KINDS.edited`, so the two routes cannot drift apart.

Nothing here posts. `answer()` keeps the latest reading per item in a book that
lives in the browser for one note, and `harvest()` reads it when the note
leaves, the same moment the 5b chain teaches.

### Four decisions made here, stated so they can be argued with

- **Diction counts uses, not weights.** The weights live in the ledger, where
  `score()` sums them per class. A diction count is how many times an author
  used a word, and the store turns it into a share. Multiplying it by an edit's
  weight would record five uses of a word somebody wrote once. The weight takes
  effect in which answers produce a pair at all: only an edit does.
- **A correction mark gets diction and no shape specimen.** The 5b chain
  already reads a reworded correction off the marks at Copy and teaches it as
  the EDITED link. Answered through the ledger as well, the same rewording would
  teach twice. `CHAIN_PRODUCERS` is `["corrections"]`, and the host has to file
  a mark's answer under that producer for this to hold.
- **The last answer on an item governs what the note teaches.** A revert takes
  the pending reading out, a second edit replaces the first, and an approve
  after an edit leaves it standing. The ledger keeps every answer; the book is
  what the note teaches.
- **The book is keyed by item inside the class.** Two correction marks in one
  section are one class (`corrections:correction:<section>`) and two different
  sentences. Keyed by class alone, the second rewording overwrote the first and
  one was never taught. The previous iteration found this and did not fix it.
  `suggestion.item` is the caller's own key (a mark key such as
  `lessonProgressNarrative:0`, a suggestion key such as `3:1`). It picks a slot
  in the book and is never handed to the ledger. A value that is not a short key
  (`^[A-Za-z0-9_.:-]{1,64}$`) is read as no item.

### The ledger row cannot hold a surface form, and now a caller cannot put one there

Slice 4 made the pair structurally unable to enter a row. It left `producer`,
`code`, `section` and `tool` as any string, so a caller handing a detail
sentence in as `code` would have filed it. An affordance this branch cannot see
is about to call this, so that is closed now rather than found later:

- a class field is an identifier, `^[A-Za-z][A-Za-z0-9_-]{0,63}$`, or the event
  is dropped as `class-not-an-identifier`. Absent is still a default.
- `classOf` reads a refused field as its default, so the `dropped` entry that
  explains the refusal cannot carry the text that caused it.
- **The limit, stated:** a single word with no space and no punctuation passes
  the rule. No sentence can sit in a row. A lone name typed into `code` could,
  and nothing short of a closed list of every code and section id would stop
  that.

Every real id this branch produces passes: the alert budget's codes
(`no_prompt_level`, `token_in_note`, `strategy_in_wrong_section`,
`gap_unbarred`), section ids
(`lessonProgressNarrative`) and tool ids (`bt`). `tests/alert-budget.spec.js`
is still green with the rule in place.

### THE CALL AN AFFORDANCE MAKES

For the host, after the rebase. All of it is plain functions and none of it
touches the DOM.

```js
// one per note, reset where draftNote resets taughtRef
voiceState.current = null;

// the technician answered one change or one suggestion
voiceState.current = NoteDistill.answer(
  voiceState.current,
  { producer, code, section, tool, item },  // identifiers plus the item key; no other key is read
  disposition,                               // "none" | "approve" | "reject" | "revert" | "edit"
  { offered, kept },                         // read on "edit" only, may be null otherwise
);

// the note leaves (recordNoteLeft, beside NoteSpecimens.pairs)
const { diction, specimens } = NoteDistill.harvest(voiceState.current);
specimens.forEach((p) => emitStyle(p.before, p.after, p.source, p.own));
// diction goes out through the write path
```

`answer` returns a new `{ledger, book}` and never touches the one passed in.
`voiceState.current.ledger` is the slice 4 ledger, ready for
`NoteDisposition.closeNote` and `score`.

What to pass, read off `note-tool-interface` with `git show` and not wired to it:

| the row there | producer | code | section | item | disposition | pair |
|---|---|---|---|---|---|---|
| a correction mark (`CD_entriesFrom` in `changes-drawer.jsx`) | `corrections` | `correction` | the mark's `id` | the mark's `key` | `reverted` as `revert`, `edited` as `edit`, `approved` as `approve`, `default` as `none` | `{offered: entry.original, kept: entry.text}` |
| a triage suggestion (`suggestionDisposition(qi, si)` in `engine.jsx`) | `gaps` | the budget item's `code` | the question's `field` | `suggestKey(qi, si)` | the same four | `{offered: the suggestion as drafted, kept: st.text}` |

That branch derives a mark's state as reverted, then edited
(`st.text !== m.text`), then approved, and a suggestion's as not accepted, then
edited (`st.text` is a string), then approved. An "edited" suggestion whose text
equals the offer yields no specimen and no diction here, so the looser test on
that side costs nothing.

Calling once per item at Copy, off the derived state, and calling on every
click harvest the same thing, because the book keeps the latest answer per item.
The ledger differs: every click is a row. Slice 4 left that choice open and it
is the host's.

### Landing tests and their revert proof

Twenty-five guards and mutations, each applied alone, `tests/distill.spec.js`
run on chromium (port 8871), the file restored. **All twenty-five are caught.**
The driver is a throwaway at `/tmp/slice5c-revert-proof.py`; it hashes every
file it touches, the hashes matched afterwards, and `shasum -c` against a copy
taken before the run agreed.

| Guard removed, or mutation applied | Failed | The named one |
|---|---|---|
| record refuses a class field that is not an identifier | 5 | a sentence in the producer slot is refused, and the refusal does not carry it either (and code, section, tool) |
| `field()` admits identifiers only | 5 | the same four |
| `classOf` reads a refused field as its default | 3 | the producer, code and section slot tests (tool is not part of a class) |
| absent is a default, not a refusal | 1 | an absent tool or section is still a default rather than a refusal |
| MUTATION a row grows a free `note` field | 1 | a row is identifiers, numbers and a flag, whatever else the caller hands over |
| MUTATION the edit weight collapses onto approve | 1 | the four answers keep four distinct weights in the ruled order, and only the edit is paired or taught |
| `answer` attaches the distiller as the sink | 9 | one edit produces a diction tally and a shape specimen, both read off the same pair |
| the offer's own counts are subtracted | 2 | the diction tally counts what the rewrite added, never a word the offer already held |
| diction goes through the sealed `record()` | 1 | one edit produces a diction tally and a shape specimen (see below) |
| the diction route | 6 | one edit produces a diction tally and a shape specimen |
| the shape route | 5 | the shape specimen is the kind, source and owner the specimen chain gives an edited link |
| a chain producer gets no shape specimen | 1 | a correction mark gets its diction tallied and no shape specimen |
| an unchanged pair gets no shape specimen | 1 | an edit that changed nothing yields no shape specimen and no diction |
| MUTATION the specimen source drifts to `revision` | 1 | the shape specimen is the kind, source and owner the specimen chain gives an edited link |
| a revert takes the pending reading out | 2 | a rewrite reverted before the note leaves teaches nothing, and one approved after still does |
| `answer` copies the book | 1 | answer returns a new state and leaves the one passed in alone |
| a refused answer returns before touching the book | 1 | an answer the ledger refuses teaches nothing, on a note with nothing in it yet |
| a missing dictionary reads as no diction | 1 | a page without the dictionary still records the answer and still hands on the shape |
| MUTATION the book is keyed by answer, not item | 7 | a second edit of the same suggestion replaces the first |
| the book is keyed per item inside the class | 1 | two marks in one section are two items, so both rewordings are taught and a revert takes out only its own |
| an item that is not a short key is read as no item | 1 | an item that is not a short key is read as no item, so it cannot name a slot in the book |
| `harvest` merges the diction | 3 | one edit produces a diction tally and a shape specimen |
| `harvest` hands on the specimens | 4 | a rewrite reverted before the note leaves teaches nothing, and one approved after still does |
| the bt page loads the distiller | 1 | both note pages load the distiller |
| the bcba page loads the distiller | 1 | both note pages load the distiller |

**One guard is landed by a weaker test than it should be.** Sending the diction
through `NoteDiction.record()` is what checks it against the sealed house
dictionary, and `tally()` cannot produce a family the house lacks, so there is
no input that makes the two disagree. Its removal is caught only because the
test asserts `refused` is an empty list and a raw tally has no `refused` field.
That lands the call, not the refusal. The refusal itself is landed in
`tests/diction.spec.js` from slice 5a.

### Known costs, stated rather than found later

- **A correction mark is taught once for shape only if the host files it under
  `corrections`.** The 5b chain teaches its rewording at Copy either way. Filed
  under any other producer, the same rewording teaches shape a second time
  through `harvest`. Nothing on this branch can check what the host passes.
- **Diction from a correction mark is new evidence the chain never counted**, so
  wiring this does change what a note teaches: a note with reworded marks now
  tallies diction it did not before. That is the slice, and it is stated here so
  it is not read as drift.
- **The book holds the pair in the browser** for one note, the same as the 5b
  book holds a section's offered and decided text. It never reaches the ledger
  and `harvest` returns counts and specimens, not the book.

### Suite state after slice 5c

`tests/distill.spec.js` is 20 of 20 green on chromium, port 8871, with
`alert-budget.spec.js`, `style-specimens.spec.js`, `diction.spec.js` and
`no-em-dashes.spec.js` beside it: 92 of 92. `apps/profile-api` `npm test` is 137
of 137 with 0 skipped. Ports 8788, 8789, 8799 and 8808 were free at every check.

**The full chromium project is 1294 of 1294 green in 9.5 minutes**, exit 0, on
`TOOLS_TEST_PORT=8872` with 8788, 8789, 8799, 8808 and 8872 checked free before
it started. That is 1259 from slice 5a, the 15 from 5b and the 20 here, so it is
also the complete run slice 5b owed. It was started after the revert driver had
finished and every file it edits hashed back to its starting value. One comment
line in `distill.js` (the `harvest` doc, "class" to "item") and this section of
NOTES.md were edited while it ran; neither changes code.

## The write path - voice_level and diction_level, through the Pages worker

Both tables had a schema and an accumulator and nothing that wrote to them. They
are written now, and nothing new was opened to do it: the page adds a `voice`
array to the body it already POSTs to `/api/audit`, the Pages worker forwards it
inside the `/events` body it already sends over the `PROFILE` binding, and
`/events` appends the voice statements to the batch it already runs. The browser
still never reaches the profile Worker, and the KV audit trail never sees a voice
entry.

### One entry per note, and what is in it

```
{ tool: "bt",
  levels:  { within_cv, step_rel, actor_naming, hedging },   // any of the four, numbers
  diction: [ { family_id, variant_index, count } ] }           // house ids and integers
```

- **The page** (`notes/bcba/voice-note.js`, new) measures the note as copied with
  `NoteStyleFeatures._measure` and `NoteMetrics.measure` and keeps four rates.
  Nothing of the passage is in the entry.
- **The store** (`apps/profile-api/src/voice-write.js`, new) reads what the
  author already holds, folds the note in, and writes back only the rows that
  changed. A level goes through `accumulateLevel` (n, sum, sum_sq), diction
  through `applyNote` (count, notes). Two notes for one tool in one request fold
  in order, so the second adds to the first.

### Three gates, and every name is checked against a closed list

| Where | Tool | Level names | Level values | Diction |
|---|---|---|---|---|
| the page buffer, `notes-gate.js` `audit.voice` | a slug | identifier shape, first 8 | finite numbers | identifier family, integer variant, integer count above 0, rows rebuilt, 85 at most |
| the Pages worker, `sanitizeVoiceNote` in `_worker.js` | `NOTES_TOOLS` | `VOICE_FEATURES` | finite, rounded to 6 places | `VOICE_FAMILIES`, integer variant 0 to 63, integer count above 0, rows rebuilt, 85 at most; 20 notes a request |
| the store, `acceptVoice` | `VOICE_TOOLS` | walked from `HOUSE_FEATURES` | finite, 0 to `LEVEL_MAX` (4), refused not clamped | `accept()` from slice 5a, 10 a note; 20 notes a request |

`VOICE_FEATURES` and `VOICE_FAMILIES` in the Pages worker are copies of
`HOUSE_FEATURES` and `FAMILY_IDS`, because the two Workers deploy separately and
share no module. `VOICE_TOOLS` in the store is a copy of `NOTES_TOOLS`.
`test/voice-write.test.js` reads all three out of `_worker.js` and fails if any
of them drifts, and a second test pins `NoteVoice.FEATURES` to `HOUSE_FEATURES`.

**A defect in this iteration's own first draft, caught by the surface form
test.** The Pages worker first checked level names and family ids for
identifier shape only, the way `sanitizeCorrection` checks a feature name. The
Playwright surface form test failed with every house synonym listed twice:
"often" and "coached" are legal identifiers, so each crossed once as a level name
and once as a family id. The store dropped them, but they had already been sent
to a second service. Both slots now check against a closed list, and
"a word shaped like an identifier is still refused, as a level name and as a
family id" holds the line.

### When a note teaches a level

**Only when the technician's own hand changed it.** A level is read off the note
as copied, and every word of an untouched note came from the tool. Filed as the
author's level, the tool's habits would come back as somebody's voice, which is
the fault slice 5b took out of the style measurement. So `NoteVoice.entry` reads
levels only when at least one pair on the note has `own === true`: an overtyped
section or an edited correction from `NoteSpecimens.pairs`, or an edit specimen
from `NoteDistill.harvest`. A rejection alone puts model text back and does not
count.

- A note copied as drafted sends nothing. A note changed only by a rejection
  sends nothing.
- Below 25 words, the floor `style-features.js` judges on, no level is read.
- `within_cv` and `step_rel` are left out, never sent as zero, when the sections
  are too short to measure (under 3 sentences). A zero would enter perfect
  flatness as a real reading.
- Diction needs no gate of its own here: every count in `harvest().diction` came
  from an edit.

### Decisions made here, stated so they can be argued with

1. **The own-hand gate above.** The alternative, reading every note, teaches the
   tool's own drafts back as the author's style.
2. **No `voiceState` ref and no harvest wiring in `engine.jsx`.** Nothing on this
   branch answers a suggestion, so a `voiceState` ref or a `harvest` call would
   be code no test could land. The engine edit is one line beside the 5b pairs,
   passing `pairs` only. The host adds `harvest` when the affordance is wired
   (below).
3. **The page buffer drains voice only when the response says `profile: "ok"`**,
   on the terms corrections already drain on. A store that is not bound yet has
   not learned the note, so the reading waits in a bounded ring (500 entries).
4. **`LEVEL_MAX` is 4, ruled by Kaleb on 21 September.** Every one of the four is
   a rate or a ratio that real notes put under 2, and a value past the bound is a
   broken client or a forged payload. It was 10, which refused only obvious
   garbage and let a broken client write a 9 that quietly dragged an author's
   running mean. Four is twice the highest reading a real note has produced. It
   is still a plausibility bound rather than a measured one, and the error it now
   prefers is refusing one real outlying note, whose author then teaches the tool
   nothing from it.

### A defect found in slice 5a's code: `applyNote` cut a running total back to the cap

`applyNote` re-read the rows already stored through `accept()`, and `accept()`
caps ONE NOTE's count at `MAX_COUNT_PER_NOTE` (50 when this was found, 10 since
Kaleb's ruling of 21 September). A stored row is a running
total over many notes. Measured before the fix: a stored count of 120 plus a note
of 3 came back as 53, so an author's history would have been cut down on every
write. It never reached live data, because nothing wrote `diction_level` before
this iteration. `applyNote` now keeps the stored count and still uses `accept()`
to decide whether the row is readable. Landed by "a stored total past one note's
cap is carried whole, not cut back to the cap" in
`test/diction-level.test.js`.

### THE CALL AN AFFORDANCE MAKES, with the write path in place

What `recordNoteLeft` in `engine.jsx` calls now, one line after the 5b pairs:

```js
if (window.NoteVoice) NotesGate.audit.voice(NoteVoice.entry({ tool: tool.id, ids: narrativeIds(), shipped: S.output, pairs: leaving }));
```

What the host makes of that line and the 5c block above, when the affordance
answers suggestions:

```js
const harvest = NoteDistill.harvest(voiceState.current);
harvest.specimens.forEach((p) => emitStyle(p.before, p.after, p.source, p.own));
if (window.NoteVoice) NotesGate.audit.voice(NoteVoice.entry({
  tool: tool.id, ids: narrativeIds(), shipped: S.output, pairs: leaving, harvest,
}));
```

The signatures, all plain functions, none of them touching the DOM:

- `NoteVoice.entry({tool, ids, shipped, pairs, harvest?})` returns
  `{tool, levels, diction}` or `null` when the note has nothing to teach.
- `NoteVoice.levels(passage)` returns
  `{actor_naming, hedging, within_cv?, step_rel?}` or `null` under the word floor.
- `NotesGate.audit.voice(entry)` checks the entry, adds it to the buffer and
  flushes. It returns nothing, and a `null` entry is a no-op.

### How the landing tests join two Workers without a dev server for either

`PROFILE` is not bound under `wrangler pages dev`, so a page test through the dev
server alone would stop at `profile: "skipped"`. `tests/voice-write-path.spec.js`
routes the page's `/api/audit.js` requests to the real `_worker.js` `fetch`,
imported into the Playwright process. Its `env.PROFILE.fetch` calls the real
`apps/profile-api/src/index.js` `fetch`, and that Worker's `env.DB` is
`test/helpers/d1-sqlite.js`: `node:sqlite` running `schema.sql`, recording every
bound statement. The helper takes the schema text from its caller, because
Playwright compiles a spec and what it imports to CommonJS, where `import.meta`
does not exist. Only the LLM, the expert pass and the corrections pass are
mocked.

**DONE WHEN, part one, a browser side accumulation reaches the store:**
"a note the technician typed over lands all four levels in voice_level" types
over two sections, copies, and reads `voice_level` back as `n = 1` with each sum
equal to the value on the wire. "an edit answered through the ledger lands its
diction in diction_level" does the same for diction. The store side
"/events writes a note's levels and diction, and a second request accumulates
onto them" checks the fold against a hand sum.

**DONE WHEN, part two, no route accepts a surface form:**
"no route on the profile Worker writes a surface form from a voice payload, in
any slot" parses every route out of `src/index.js` (so a route added later is
driven without editing the test) and sends each one every house synonym, about
309 forms plus a sentence, in every slot of a voice entry. It reads every bound
write statement and every table cell afterwards. "a voice payload holding a house
synonym in every slot writes none of them, through the real worker into the
store" does the same through `/api/audit` and also walks every key and value the
Pages worker forwarded. Both have a positive control: the one legal row in each
payload must land, so a route that wrote nothing cannot pass. House ids that are
also words ("prompting", "mand", "hedging", "bt") are exempt by exact match
only.

The scope, stated: the route test proves this for the voice payload. The limit
slice 5c stated still stands for other slots: a correction's `tool` and a
metric's `type` and data keys are checked for slug shape, so a single word
passes those. No sentence can.

### Landing tests and their revert proof

Every guard below was removed alone, the named suite run, and the file put back.
The store guards ran `test/voice-write.test.js` and `test/diction-level.test.js`.
All others ran `tests/voice-write-path.spec.js` on chromium, port 8880. The driver
is a throwaway at `/tmp/voice-revert/driver.mjs`. It hashed all 9 files it edits
before and after each batch, and every batch reported the hashes matched.
`git status` was identical before and after. **All 48 are caught.**

**One pair of guards was caught by nothing, and is gone.** `isLevel` read
`typeof v === "number" && Number.isFinite(v) && ...`. Each half, removed alone,
broke no test, because each covers the other: `Number.isFinite` is already false
for anything that is not a number. The `typeof` was removed, and
`Number.isFinite` alone is now caught (S3b).

| Guard removed, or mutation applied | Caught by |
|---|---|
| S1 store tool from `VOICE_TOOLS` | a tool outside the closed list is refused, even a single word a slug rule would take; no route on the profile Worker writes a surface form |
| S2 store levels walked from `HOUSE_FEATURES` | levels are read by house feature name, so a key the payload made up is never visited; no route writes a surface form |
| S3 store level bounds 0 to `LEVEL_MAX` | a level that is not a plausible reading is refused, not clamped |
| S3b store level `Number.isFinite` | a level that is not a plausible reading is refused, not clamped |
| S4 store empty entry refused | diction rows go through the house gate, and an entry left with nothing is not a note |
| S5 store `MAX_VOICE_NOTES` | one request reads at most MAX_VOICE_NOTES notes |
| S6 store running level inside one request | two notes for one tool in one request fold in order, so the second adds to the first |
| S7 store running diction inside one request | the same, and a second note's NEW diction slot survives when the first note added a different one |
| S8 store writes touched rows only | only the rows a request changed are written, not every row the author holds |
| S9 store reads stored rows before folding | /events writes a note's levels and diction, and a second request accumulates onto them |
| S10 store diction through `accept()` | diction rows go through the house gate, and an entry left with nothing is not a note |
| S11 `/events` pushes the voice statements | /events writes ... and a second request accumulates onto them; no route writes a surface form |
| S12 `applyNote` keeps the stored count | a stored total past one note's cap is carried whole, not cut back to the cap |
| W1 worker tool from `NOTES_TOOLS` | sanitizeVoiceNote keeps a note tool, numbers and house names, and drops every other slot; the synonym-in-every-slot test |
| W2 worker level names from `VOICE_FEATURES` | the same two, and a word shaped like an identifier is still refused |
| W3 worker level is a finite number | sanitizeVoiceNote keeps a note tool, numbers and house names |
| W4 worker family from `VOICE_FAMILIES` | a word shaped like an identifier is still refused; the synonym-in-every-slot test |
| W5 worker variant is an integer 0 to 63 | sanitizeVoiceNote keeps ...; the synonym-in-every-slot test |
| W6 worker count is an integer above 0 | sanitizeVoiceNote keeps ...; the synonym-in-every-slot test |
| W7 worker rebuilds each diction row | sanitizeVoiceNote keeps ...; the synonym-in-every-slot test |
| W8 worker refuses an empty entry | sanitizeVoiceNote keeps a note tool, numbers and house names |
| W9 worker forwards `voice` | a note the technician typed over lands all four levels; an edit answered through the ledger lands its diction; one request carries at most twenty notes |
| W10 worker early return counts voice | one request carries at most twenty notes; an edit answered through the ledger lands its diction |
| W11 worker 20 notes a request | one request carries at most twenty notes on to the store |
| W12 worker rounds a level to 6 places | sanitizeVoiceNote keeps a note tool, numbers and house names |
| W13 worker sanitizes voice at all | the synonym-in-every-slot test |
| G1 page flush sends `voice` | a note the technician typed over lands all four levels; a reading waits in the buffer; an edit lands its diction |
| G2 page drains voice only on `profile: "ok"` | a reading waits in the buffer while the store is not there, and goes when it is, twenty at a time |
| G3 page drains voice at all | the same, and an edit answered through the ledger lands its diction |
| G4 page family id shape | the page buffer keeps numbers and identifiers and nothing else |
| G5 page level name and value check | the page buffer keeps numbers and identifiers and nothing else |
| G6 page rebuilds each diction row | the page buffer keeps numbers and identifiers and nothing else |
| G7 page refuses an empty entry | the page buffer keeps numbers and identifiers and nothing else |
| G8 page tool shape | the page buffer keeps numbers and identifiers and nothing else |
| G9 page flush early return counts voice | a reading waits in the buffer; an edit answered through the ledger lands its diction |
| G10 page 20 notes a flush | a reading waits in the buffer ..., twenty at a time |
| G11 `audit.voice` flushes | an edit answered through the ledger lands its diction in diction_level |
| E1 engine calls `NoteVoice` when the note leaves | a note the technician typed over lands all four levels in voice_level |
| E2 engine `window.NoteVoice` guard | a page that failed to load voice-note.js still drafts and copies, and throws nothing |
| V1 the own-hand gate | a note copied as drafted teaches no level; a rejection alone teaches no level; levels are read only when a pair is the technician's own prose |
| V2 `own` must be exactly `true` | a rejection alone teaches no level; levels are read only when a pair is the technician's own prose |
| V3 the 25 word floor | a passage under the word floor gives no level at all |
| V4 `sectionCv` present | a section measure the passage cannot support is left out, never sent as zero |
| V5 `sectionStep` present | a section measure the passage cannot support is left out, never sent as zero |
| V6 harvest specimens count as own | levels are read only when a pair on the note is the technician's own prose |
| V7 an entry with nothing is `null` | the own prose test; the word floor test; diction rides without a level, and an entry with neither is not sent |
| P1 the bt page loads `voice-note.js` | both note pages load voice-note.js; a note the technician typed over lands all four levels |
| P2 the bcba page loads `voice-note.js` | both note pages load voice-note.js |

### Known costs, stated rather than found later

- **One word typed by hand admits the whole note's levels.** A rate cannot be
  taken off a single word, so the gate is per note, not per word.
- **Short sections teach two levels, not four.** `within_cv` and `step_rel` need
  sections of 3 sentences or more.
- **Two requests for one author at once can lose an update.** Read, fold, write
  has no lock, because D1 has no RETURNING on conflict. It is the trade
  `shape_profile` already makes, and one technician rarely copies two notes in
  the same second.
- **The page gate checks shape, not the closed lists.** A caller inside the page
  could put an identifier-shaped word in the localStorage buffer, and the request
  would carry it to the Pages worker, which drops it. `NoteVoice.entry` cannot
  produce one: its level names are `FEATURES` and its diction came through
  `NoteDiction.record`. Anything running inside the page can already POST
  whatever it likes.
- **Nothing sends diction on this branch yet.** The `harvest` argument is the
  host's to add. Until then the diction half is landed by the ledger test that
  calls `NoteVoice.entry` with a harvest directly.
- **`LEVEL_MAX` (4 since Kaleb's ruling of 21 September, 10 before it) and the 6
  place rounding are judgment, not measurement.**

### Suite state after the write path

`tests/voice-write-path.spec.js` is 17 of 17 on chromium, port 8880. With
`style-specimens`, `distill`, `diction`, `audit-events`, `style-card-api`,
`no-em-dashes`, `asset-cache-lockstep`, `voice-capture`, `style-features` and
`profile-admin-api` beside it: 167 of 167 (run before the last test was added,
and the new spec was 17 of 17 alone after that). `apps/profile-api` `npm test`
is 155 of 155 with 0 skipped: 137 before, 1 in `diction-level.test.js`, 17 in
`voice-write.test.js`. Ports 8788, 8789, 8799, 8808 and 8880 were free at every
check.

**The full chromium project was NOT run to the end.** It was started on
`TOOLS_TEST_PORT=8880` after the revert driver had finished and the hashes had
matched. It had passed tests 1 to 206 of 1311 with no failure when the iteration
had to end, and I stopped it so no background process was left. A complete run
is still owed. 1311 is the 1294 from slice 5c plus the 17 here.

`git diff --name-only origin/main` plus untracked files lists nothing outside
`apps/tools` and `apps/profile-api`, and no added line holds an em or en dash.
