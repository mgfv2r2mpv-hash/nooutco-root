# NOTES-gnhf — games stimulus pipeline / clinical settings unification

Working notes and blockers for the run. Baseline revision: `origin/main` =
`7d083751`.

---

## ACCEPTED PRE-EXISTING BASELINE — `tests/glam-team-makeover.spec.js`

**Not a blocker for this run, and not this run's to fix.** Glam Team Makeover is
one of the three games this run must never modify, and that exclusion covers its
spec file as well. These failures are present at `origin/main` before any change
here (reproduce with `git stash && npm test`), identical under a plain static
server and under real `wrangler pages dev`. Recorded here as a follow-up for the
maintainer.

**The run's suite requirement is "no NEW failures versus this baseline."** The
exact baseline failing set, 8 tests across three browsers:

```
[chromium] glam-team-makeover.spec.js:9  › intro screen mounts (runtime boots)
[chromium] glam-team-makeover.spec.js:22 › all four models load their base art…
[chromium] glam-team-makeover.spec.js:43 › applying a step composites a delivered layer…
[firefox]  glam-team-makeover.spec.js:22 › all four models load their base art…
[firefox]  glam-team-makeover.spec.js:43 › applying a step composites a delivered layer…
[webkit]   glam-team-makeover.spec.js:9  › intro screen mounts (runtime boots)
[webkit]   glam-team-makeover.spec.js:22 › all four models load their base art…
[webkit]   glam-team-makeover.spec.js:43 › applying a step composites a delivered layer…
```

(`:9` is timing-dependent and passes on firefox often enough to move the count
between 7 and 8. Any run whose failing set is a subset of the three test titles
above is at baseline.)

### Corrected evidence

An earlier draft of this file asserted two things that are **wrong as stated**,
and the corrections change what a fix would have to do:

- `glam-team-makeover/assets/art/person/m1/base.png` **does exist on disk**
  (157 KB, alongside `m1/base/base.png`). What is true is narrower: the shipped
  art manifest `assets/art-generated.js` references *only* the nested combo-base
  layout — `grep -o "person/m1/base[^\"']*"` returns `person/m1/base/base.png`,
  `…/base/hairluma.png`, `…/base/mask.png`, `…/base/shirtmask.png` and never the
  flat `m1/base.png`. So the flat file exists but is unreferenced, and the
  spec's `img[src*="assets/art/person/m1/base.png"]` does not substring-match
  the `…/base/base.png` the app actually renders.
- **`Brunette` does appear** in `glam-team-makeover/index.html:335`, as
  `{id:'hc_brunette',label:'Brunette',…,ph:'hair'}`. It is an option inside the
  **`Hair color`** tool group, not a top-level rail control. The probe that
  found only `Wash`, `Shape brows`, `Brow pencil` was reading the first group's
  options. *Hypothesis, not verified:* the spec never opens the `Hair color`
  group (and every hair option is gated `ph:'hair'`), so the button is real but
  out of reach at that point in the flow.

The third failure's mechanism is unchanged and still looks right: the vendored
dc-runtime paints `<path d="{{ V.capePath }}">` before template bindings
resolve, so the browser logs `<path> attribute d: Expected moveto path command`
and the zero-console-errors assertion trips.

**Do not act on any of this from inside this run.** A spec edit built on a
premise this shaky could mask a real regression in a game that must not be
touched. Handing it to the maintainer with the corrected evidence is the whole
deliverable here.

---

## Findings that change how later stages must be executed

### 1. `art` file count ≠ distinct stimulus count

The unindexed "real art" sitting in the three `_Resources` trees is almost
entirely **duplicate stems in a second format**, deliberately deselected by the
manifest:

```
matching T_kitchen_items
  INDEXED   blender.webp bowl.jpg ... toaster.webp        (19)
  UNINDEXED blender.svg  bowl.svg ... toaster.svg         (18 — same stems)

clock T_prepositions
  INDEXED   above.png behind.png below.svg ...            (12)
  UNINDEXED above.svg behind.svg                          (2 — same stems)
```

So the objective's success signal `T_kitchen_items 5 -> 24` counts **files**,
including format duplicates: matching has 24 real *files* but only **19 distinct
stems**. Indexing both formats of one stem would show a learner the same concept
twice inside a single discrimination array — clinically wrong.

**Stage 2 must merge on stem, preferring real art over an emoji placeholder and
raster over the deselected duplicate.** Expect clock/receptive
`T_household_items` to land at **11** and `T_kitchen_items` at **19 distinct
stems (24 files)**. State which unit is being reported when claiming the signal.

### 2. `displayNames` orphans were silently dead config

Three technician-set labels were keyed at paths no manifest indexed, so they
never rendered (`labelFromSrc()` fell through to the title-cased filename):

- `clock`, `receptive`: keyed `T_prepositions/above.svg`; the served file is
  `above.png` (the `.svg` is the deselected duplicate). Label `above` was
  rendering as `Above`.
- `matching`: keyed `T_fresh-beats/twist-1` with the extension dropped entirely.
  Label `Group Poster` never rendered.

Fixed by re-keying (no art added or removed). `tests/stimulus-integrity.spec.js`
now fails on any orphaned `displayNames` key, so the Stage 2 repoint cannot drop
labels on the way to the shared library.

### 3. `market` borrows `matching` through a legacy 301, not a relative path

`market/game.js:10` is `IMAGE_BASE = '../../IDMatchGame/IDMatchGame/'`, which only
resolves because `_worker.js` `LEGACY_PREFIXES` 301-redirects
`/IDMatchGame/IDMatchGame` → `/matching/`. This is the borrow-don't-copy pattern
the objective points at, but it is load-bearing on a redirect table. Stage 2
should repoint it at the shared library directly rather than deepen the
indirection.

### 4. The test suite can silently run against the wrong server

`playwright.config.js` had `reuseExistingServer: !process.env.CI` against a
hardcoded `localhost:8788`. On this machine an unrelated
`python3 -m http.server 8788` was already listening, so Playwright adopted it and
the entire suite ran **without `_worker.js`** — no `APP_VERSION` injection, no
`ADMIN_SECRET` hash rewrite, and no legacy `/IDMatchGame/IDMatchGame` → `/matching`
301, which is exactly what `market`'s image borrow depends on (see finding 3).
A static server answers most asset requests, so the run looks green while never
exercising the worker.

Fixed: the port is now `GAMES_TEST_PORT` (default `8788`), and setting it also
disables `reuseExistingServer`, so a run can always force its own wrangler
instance:

```
GAMES_TEST_PORT=8792 npm test
```

Both server modes were re-verified and give the same result, so nothing in the
current numbers is an artefact of this.

Still outstanding: `wrangler` appears in neither `package.json` nor
`package-lock.json`, so `npm ci` does not install it and the webServer depends on
whatever `npx` resolves from cache or the network. Worth pinning as a
devDependency for reproducibility.

---

## Stage 1 progress

Landed (all green, chromium + firefox + webkit):

- `tests/lib/stimuli.mjs` — content-based emoji-placeholder classifier plus the
  registry of every stimulus index in the repo.
- `tests/tools/snapshot-stimuli.mjs` — regenerates the baseline from the working
  tree; `--check` diffs without writing.
- `tests/fixtures/stimulus-baseline.json` — per-category real-art counts captured
  at `origin/main`. **This is the floor the stop condition measures against.**
- `tests/stimulus-integrity.spec.js` — index schema validation for clock,
  receptive, matching, ffc, intraverbal, patterns and sequences; every indexed
  path resolves 200; per-category real art may never fall below the baseline.

Mutation-tested rather than assumed: dropping `table.jpg` from matching's index
and adding a nonexistent path produced
`T_household_items: 10 real now, baseline had 11` plus a 404 report.

Still owed from Stage 1: the per-game settings round-trip (seed the old
localStorage key, reload, assert every option survives). That work shares a
"boot a game with seeded config" helper with the Stage 5/6 migrations, so it
should land alongside them.

---

## Stage 2 progress — the library exists; the games are not repointed yet

Landed (`shared/stimuli/`, additive — no game reads it yet, so nothing in the
existing suite changed behaviour):

- `shared/stimuli/build.mjs` — merges the clock / receptive / matching
  `_Resources` trees into one entry per stimulus. `--check` rebuilds in memory
  and diffs against what is committed without writing, so a tree that gains art
  without a rebuild is a test failure rather than a silent no-op.
- `shared/stimuli/stimuli.json` — **236 stimuli, 126 with real art, across 17
  categories**, `{id, label, categories[], image, emoji}` plus `glyphKind` and
  `variants`.
- `shared/stimuli/img/` — 155 image files, 83 MB on disk and **0 bytes in git**:
  every copy is byte-identical to a blob the repo already tracks, so
  `git hash-object shared/stimuli/img/T_household_items/table.jpg` and the
  `matching/` original both print `81ccd2f7…` and `size-pack` does not move.
- `shared/stimuli/provenance.json` — all 568 source files mapped to the library
  file that now carries their bytes, or to an explicit `droppedBecause`. This is
  the durable proof for the deletion commit, which cannot be re-derived once the
  trees are gone.
- `tests/shared-stimuli.spec.js` — 7 tests × 3 browsers, all green.

The Stage 2 success signal, measured in the library:

| Category | clock at baseline | receptive at baseline | library |
|---|---|---|---|
| `T_household_items` | 0 real | 0 real | **11 real** (incl. `table.jpg`) |
| `T_kitchen_items` | 5 real | 5 real | **19 real** (24 files — see finding 1) |
| `T_prepositions` | 12 real | 9 real | **12 real** |
| `T_community_helpers` | 0 real | 11 real | **11 real** |

Mutation-tested rather than assumed. Pointing `household-items-table` at a
placeholder SVG and `animals-bear` at a nonexistent file failed 5 of the 7
tests, naming both mutations:
`household-items-table -> /clock/…/bed.svg` under "library images that are
generated glyph placeholders", plus `stimuli.json is stale`.

### 5. Two stems in `T_prepositions` shipped as byte copies of another stem

`receptive/…/T_prepositions/on.png` is md5-identical to `above.png`
(`a5520e3f`), and `under.png` to `below.png` (`013a3737`). receptive indexes all
four, so today it asks a learner about "on" and "above" over **the same
picture** — and that picture (checked by eye) is a football resting *on* a box,
which makes it the wrong art for `above` rather than for `on`.

The merge refuses to let two stems in one category resolve to the same bytes:
first stem alphabetically keeps the file, the other falls through to its
next-best candidate, which here is the hand-drawn `on.svg` / `under.svg`
diagram clock already indexes. So the library gives receptive 12 distinct
preposition stimuli where it had 9, with no duplicate pairs. Both demotions are
recorded in `provenance.json` as `duplicate-of:T_prepositions/above` / `…/below`
rather than silently dropped.

Left for the maintainer: whether `above.png` is *itself* mis-filed art. It is
not this run's call to re-shoot clinical stimuli.

### 6. Deriving labels from filenames broke the lowercase-letter programme

`labelFromSrc()` title-cases the stem, so matching's `T_lowercase/a.svg`
rendered as **"A"** — the uppercase discrimination, in the programme that exists
to teach the lowercase one. The library carries labels as data and leaves a
single character or a bare number alone, so `lowercase-a` is `"a"` and
`uppercase-a` is `"A"`. Pinned by a test.

### 7. Ids have to be category-qualified

Stems are not unique. `orange` is both `T_colors` and `T_foods` with different
art, and `a`/`A` collide on a case-insensitive filesystem. Ids are
`<category-without-T_>-<stem>` — `colors-orange`, `foods-orange`,
`lowercase-a`, `uppercase-a`. `categories[]` stays an array so Stage 4 can add
semantic categories to an existing entry without ever moving an id.

### 8. `.svg` in matching's tree does not mean vector

`matching/…/T_animals/bear.svg` is JPEG bytes (Exif header, `OLYMPUS DIGITAL
CAMERA`) under an `.svg` name, and `bird.svg` is a byte copy of *clock's*
`bird.jpg`. The classifier reads content and gets these right, but any code that
branches on extension will not. The merge prefers a correctly-extensioned raster
over an `.svg` for exactly this reason, and only reaches `.svg` when it is the
sole candidate — which is how the hand-drawn preposition diagrams survive.

## Stage 2 — the repoint has landed

`build.mjs` no longer just writes the library; it **projects the library back
out as each game's `manifest.json`**. The games' loading code is unchanged —
they still `fetch('./manifest.json')` and read `folders` / `images` /
`displayNames` — but every image URL is now `/shared/stimuli/…`.

| Game | Old | New |
|---|---|---|
| `clock` | own `_Resources` tree | library, own 12 folders |
| `receptive` | own `_Resources` tree | library, own 12 folders |
| `matching` | own `_Resources` tree | library, own 14 folders |
| `market` | matching's tree via the legacy 301 | matching's manifest at `/matching/` |

Measured on the served manifests (`tests/stimulus-repoint.spec.js` prints the
resolved entries as evidence):

```
clock/T_household_items:      11 real of 11 indexed   (10 indexed before, 0 real)
clock/T_kitchen_items:        19 real of 21 indexed   (20 indexed before, 5 real)
receptive/T_household_items:  11 real of 11 indexed   (10 indexed before, 0 real)
receptive/T_kitchen_items:    19 real of 21 indexed   (20 indexed before, 5 real)
```

No category in any of the three shrank; nine grew.

### 9. Only the art is shared — the programme lists are not

Each game's `folders` comes from the frozen snapshot of what it shipped.
Merging the art must not merge the topic dropdowns: matching's `T_lowercase` /
`T_numbers` / `T_pbs_characters` turning up in receptive would be a behaviour
change, not a merge.

The projection also indexes **exactly one URL per stimulus, never its
`variants`**. clock's bear and matching's bear are different photographs of a
bear; indexing both would put two correct answers in one discrimination array.
The alternates stay in the library for a later feature that knows to rotate.

### 10. The build must not read its own output

`collectCandidates()` ranks a file partly on whether a technician's manifest
selected it. Once the build generates those manifests, reading them back makes
the ranking self-referential — the library would drift on every rebuild. So the
pre-repoint manifests are frozen in `shared/stimuli/source-manifests.json` and
that is what the build reads. It is also the reference the repoint tests diff
against, which is why "no category shrank" is checkable at all.

### 11. Repointing silently destroys a saved target selection unless migrated

`targetFilters` is a per-topic list of image **paths**. Change the paths and
every game's own prune-stale-filters logic quietly deletes the technician's
whole selection — and clock/receptive do not even prune, they just stop
matching, leaving `eligibleSamples()` empty and the game unable to start a
trial.

Each manifest therefore carries `pathAliases`: every URL that game used to
serve mapped to the library URL that replaced it (153 / 167 / 248 entries).
The four games apply it on load and re-save. Mutation-tested: deleting the
`migrateTargetFilters(data)` call from clock fails
`clock: a pre-repoint target selection survives a reload` in 2.4s with the
old paths printed against the expected library URLs.

`market` needs its own strip step — it stored targets under the old relative
base `../../IDMatchGame/IDMatchGame/`, which is also why its `IMAGE_BASE` is
now the site-absolute `/matching/` rather than a path that only resolved
through the legacy 301 (finding 3).

### 12. Placeholders are kept as files, not yet rendered from `emoji`

110 stimuli have no real art. Rather than change three games' render paths in
the same commit as the repoint, the winning glyph SVG each tree already shipped
is kept byte-for-byte as `shared/stimuli/placeholder/<category>/<stem>.svg` and
published as `entry.placeholder`. A stimulus renders exactly as it did before;
only the URL moved. `emoji` + `glyphKind` still carry the same glyph as data
for a later native render that needs no file at all.

Those 110 files cost **0 new git objects** — byte-identical to already-tracked
blobs, same as the 155 in `img/`.

### Still owed for Stage 2

1. Teach the three games to render `emoji` + `glyphKind` directly, and drop
   `placeholder/` (`glyphKind: 'text'` wants a bold sans face, `'emoji'` the
   emoji stack).
2. Only then, as its own revertible commit, delete the duplicated trees —
   checking every key in `provenance.json` first. **Blocked on Stage 3**: see
   below.

---

## HANDOFF INTO STAGE 3 — AdminTools now writes into a generated file

`worker.js` writes an upload's path, and a display-name override, straight into
`<game>/manifest.json` keyed by `_Resources/_imgSource/<folder>/<file>`
(`worker.js:359-361`, `706-729`, `907-937`). That file is now **generated**, so:

- An uploaded image still resolves today (the trees are still there) but is
  wiped by the next `npm run stimuli:build`, and would 404 once the trees go.
- A display-name override lands on a key nothing indexes. Mitigated for now:
  clock / receptive / matching call `foldLegacyDisplayNames()` on load, which
  folds any legacy-keyed label forward onto the library URL it aliases to, and
  `tests/stimulus-integrity.spec.js` accepts a `displayNames` key that reaches
  an indexed image *via `pathAliases`* — but still fails on one that reaches
  nothing.

**Deleting the duplicated trees before Stage 3 lands would break uploads.**
Stage 3 has to point the worker's `repoPath` at `shared/stimuli/img/` and run
the rebuild, at which point the fold and the aliases can start being retired.
(`repoPath` keeps its current shape — `REPO_SUBDIR` already supplies
`apps/games/`; a second prefix double-applies.)

Separately: `market` derives its captions from the filename (`srcLabel()`) and
ignores `displayNames`, so it renders "A" for the lowercase-letter programme.
Pre-existing, unchanged by the repoint, and worth folding into Stage 7's
re-dress rather than patching in isolation.

---

## Stage 3, part 1 — the contract that lets AdminTools edit a generated file

The Stage 2 handoff above is now answered on the library side. `worker.js` is
**not yet wired** (that is part 2), but the rules it has to obey exist, are
shared with the builder, and are pinned by tests.

### 13. Three files, one for each kind of technician state

A generated `<game>/manifest.json` cannot hold anything a technician changes —
the next `npm run stimuli:build` overwrites it. Everything AdminTools writes now
has a source file the rebuild reads:

| File | Holds | Written by |
|---|---|---|
| `shared/stimuli/uploads/<cat>/<file>` | which art exists | an upload |
| `shared/stimuli/labels.json` | what a stimulus is called | save-display-name |
| `shared/stimuli/publishing.json` | which game runs it | a removal |

`folders` and `archived` stay in the manifest and the build now **reads them
back from the live manifest** rather than from the frozen
`source-manifests.json`, so a topic a technician adds survives a rebuild. This
is a narrow, deliberate exception to finding 10: nothing here feeds art
ranking, which still reads only the frozen snapshot.

### 14. The worker and the builder have to produce the same bytes

`shared/stimuli/library.mjs` is the shared vocabulary — ids, file names, the
per-game projection, and `applyUpload` / `applyExclusion` / `applyLabel`. It
holds no node builtins because it is bundled into the Cloudflare Worker as
well. `tests/stimulus-uploads.spec.js` (12 × 3 browsers, green) asserts the
property that matters: for a new stimulus, a same-name replacement, a
different-extension replacement, a photograph replacing another photograph, a
photograph replacing an emoji placeholder, and a brand-new topic,
`applyUpload()` returns **byte-for-byte** what `buildLibrary()` produces from
the whole tree. If those ever diverge, an upload goes live in a state the next
rebuild silently undoes.

Four ways they nearly diverged, all now closed and mutation-tested:

- **Key order is content.** Both files are compared byte-for-byte by
  `--check`, so `provenance` is sorted *before* it is projected — its order
  decides `pathAliases` key order.
- **Entry field order.** `{...existing, image}` keeps whatever order the file
  had; `canonicalEntry()` emits one fixed order.
- **A superseded upload's provenance record.** A rebuild scans disk, so once
  the old upload file is deleted its record must go too, not flip to
  `droppedBecause`.
- **Labels.** A rebuild would re-derive the label from whatever the uploaded
  file happened to be called, so `applyUpload` pins the resolved label into
  `labels.json`.

### 15. An upload supersedes; it does not become a variant

If an upload joined the existing art as `--alt1`, every upload would rename
files, and a Worker that can see one file cannot compute a rename of the whole
group. So an upload is authoritative for its stimulus and every other art
candidate is dropped as `superseded-by-upload`. No clinical loss: only one URL
per stimulus is ever published (finding 9), so the alternates were unpublished
anyway. Uploads are also exempt from the byte-identical-duplicate rule
(finding 5) in both directions — an upload never demotes another stimulus and
is never demoted by one.

Ids are now the grouping key instead of the raw file stem, which also retires
the Stage 4 `mail-carrier` / `mail_carrier` separator split: both spellings
name one stimulus. Zero collisions exist in the trees today, so the library
output is unchanged by the switch.

### 16. Removal has to stop deleting the file — behaviour change, flagged

`atomicManifestRemoveCommit` deletes the image from the repo. That was safe
when each game carried its own copy; it is not safe now, because the same
bytes back three games and removing `T_animals/bear.jpg` on matching's behalf
would pull the picture out of clock and receptive too. `applyExclusion()`
records the removal in `publishing.json` instead: the art stays, that one
game stops offering it, nothing another programme runs changes. Nothing is
lost and the removal is reversible, but it *is* a change from "the file is
gone" and the maintainer should know.

### 17. `md5` → `sha256` in `provenance.json`

Web Crypto has no MD5, so a Worker cannot write a provenance record keyed the
old way. Dedup behaviour is identical; only the recorded hash changed.

---

## Stage 3, part 2 — `worker.js` is wired

Item 1 of the list below is done. AdminTools now edits the library, not the
generated manifests: an upload, a label and a removal each write a **source**
file and re-project every manifest in the same commit, so the next
`npm run stimuli:build` is a no-op rather than an undo.

`clock` is registered as `HickoryDickoryDockGame` in `KNOWN_GAMES` /
`GAME_PATHS`. `repoPath` shapes are unchanged — `gh()` still supplies
`REPO_SUBDIR`, and a test asserts every tree path carries exactly one
`apps/games/` (and none when the secret is unset).

`atomicManifestSaveCommit`, `atomicManifestRemoveCommit` and
`atomicManifestDisplayNameCommit` are gone; they only ever served
IDMatchGame / NameIDGame, which are library games now.

### 18. `/api/admin/batch` is the live path, not the single endpoints

The last commit on `origin/main` is literally `Admin: batch update 1 item(s)`.
`AdminTools/ImageManager` queues every operation and posts one
`/api/admin/batch`; the single endpoints exist but are not what a technician
hits. Wiring only `save-image` / `remove-image` / `save-display-name` would
have left the real admin path writing `_Resources` paths into a generated file
— which is exactly the failure Stage 3 exists to close, still fully live.

A batch cannot commit one op at a time (it is one commit by design), so the
library ops **fold**: one `readLibraryState()`, then `applyUpload` /
`applyExclusion` / `applyLabel` threaded through `foldLibraryState()` in order,
and the whole library written once at the end. Two things this made explicit:

- `games` has to be threaded, not re-derived. `liveGames()` reads
  `folders`/`archived` back from the live manifests, so a second op that
  re-derived would read the manifests the first op had already superseded and
  silently drop its topic addition.
- Tree entries are a **map**, not a list. Uploading `desk-lamp.png` then
  `desk-lamp.jpg` in one batch adds and then removes the same path; last write
  wins only if the entries are keyed by path.

The `generated` stamp is the index digest, so it is computed **once** from the
final index — every intermediate projection carried a stamp that no longer held.

### 19. Clearing a display name needed somewhere to put the old label back

AdminTools has always been able to blank a display name. Post-repoint the
manifest always carries a `displayNames` entry (the projection writes one per
served stimulus), so "clear" means *revert to the library's own label* — and a
Worker cannot re-derive that without redoing the whole merge.

`labels.json` gained a `derived` map: the label an override replaced, captured
the first time an override lands, restored and deleted on clear. `build.mjs`
reads only `overrides`, so it costs a rebuild nothing. Rejecting the clear
instead would have removed a capability the UI still offers.

### 20. Fake the API, not the unit

`tests/lib/fake-github.mjs` is an in-memory Contents + Git-Data API, so
`tests/stimulus-library-worker.spec.js` (20 × 3 browsers, green) POSTs to
`worker.fetch()` exactly as AdminTools does and then reads the resulting tree
back as files. Every test ends by running `buildLibrary()` over what the Worker
actually committed and asserting it is byte-for-byte identical — the property
that matters, and one that asserting on `applyUpload()` alone cannot reach.

It also made the retry real: `PATCH git/refs` with `force: false` returns 422
when the parent is not head, so a test lands someone else's commit mid-flight
and proves the Worker re-reads instead of clobbering. Mutation-tested — dropping
the `img/` tree entry, skipping `stimuli.json`, force-pushing, and breaking the
batch fold each fail 1–7 tests.

### Still owed for Stage 3

1. ~~Wire `worker.js`.~~ **Done** — see above.
2. **`AdminTools/ImageManager/index.html`**: add clock to `GAMES`, replace the
   hardcoded two-way manifest-path ternary (~639-641), and replace the
   optimistic DOM append (~1068-1080) with a read-back of the committed
   manifest so a failed upload can no longer look successful.
   **Now the most urgent item**: its thumbnails are built as
   `'../../' + gameId + '/' + gameId + '/' + item.path` (~939, ~1731), which
   concatenates to `../../IDMatchGame/IDMatchGame//shared/stimuli/img/…` for a
   library URL. Those thumbnails have been broken since the Stage 2 repoint
   landed; the worker wiring neither caused nor fixed it.
3. **Restore the manifest-rebuild step** lost in `514debf4`, as a workflow that
   runs `npm run stimuli:build` and commits. With the worker projecting
   in place this is now a consistency net rather than the publish path.
4. **Archive / restore / purge / rename-topic** still move files inside
   `_Resources` and rewrite the generated manifest directly
   (`atomicTopicRenameCommit`). Untouched so far, and it needs the same
   treatment as save/remove before the duplicated trees can go. Archiving is
   the easy one: `folders` / `archived` already round-trip through the live
   manifest (finding 13), so it needs no file moves at all.
