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

**It came back.** That `python3 -m http.server 8788` was listening again during
Stage 3 part 4, and this time the symptom was loud rather than silent: every
`admin-image-manager.spec.js` test failed at `openManager()` because the static
server does not serve `/AdminTools/ImageManager/` the way `_worker.js` does.
Both the pre-change tree and the working tree failed identically, which is what
identified it as environment rather than regression. **Always pass
`GAMES_TEST_PORT` when running this suite locally** — the default port is not
trustworthy on this machine.

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

## Stage 3, part 3 — `AdminTools/ImageManager` renders the library

Items 1 and 2 of the list below are done. `GAMES` is now a table with a
`folder` per row (`clock` included), so a fetch or a thumbnail goes through the
folder a game is actually served from rather than the legacy `id/id/…` 301, and
adding a game is a row rather than a branch.

### 21. The thumbnails were broken, and the fix is one line of URL discipline

`'../../' + gameId + '/' + gameId + '/' + item.path` produced
`../../IDMatchGame/IDMatchGame//shared/stimuli/img/T_animals/bear.jpg` for
every library URL — an entire page of broken images, silent because the only
handler was `img.onerror → opacity .3`. `manifestImageSrc()` now passes a
site-absolute path through untouched and prefixes only the legacy
game-relative ones, so both kinds render side by side during the migration.

### 22. A read-back has to come from the response, not from HTTP

The obvious reading of "replace the optimistic append with a read-back" is
*re-fetch `manifest.json`*. That is wrong here, and quietly so: the deployed
manifest is still the **pre-commit** build until Pages republishes, so an
immediate re-fetch would show a *successful* save as missing and invite the
technician to do it again.

So `/api/admin/batch` now returns `manifests` — the projection it committed,
keyed by game folder — and the page renders from that. Present only when the
batch actually re-projected; a client that gets none says "Reload to see it."
rather than showing a stale grid under a green "Saved!".

This also fixes a class of bug the old append could not have handled: a
manifest is a *projection*, so one upload can move rows no operation named —
replacing an emoji placeholder changes that stimulus's URL for all three games,
and a new topic adds a folder. Only the committed manifest accounts for it.

Consequences worth knowing:

- the new-topic modal posts to `batch` like everything else (it was the one
  remaining caller of the single `save-image` endpoint), so its folder now
  comes back in the manifest instead of being invented client-side
- `remove-image` from the detail panel sends `localPath` as well as
  `folder`/`filename`, so `resolveStimulusId` can match on the served URL
- the grid redraw is scoped: same folder set ⇒ redraw the cards only, so the
  add form stays open for the next upload; a changed folder set ⇒ full rebuild

`tests/admin-image-manager.spec.js` (7 × 3, green) drives the real page with
only `/api/admin/batch` stubbed; `stimulus-library-worker.spec.js` gained 2 × 3
asserting the Worker half — that `body.manifests[game]` is byte-identical to
what landed in the tree, and absent when nothing was committed. Mutation-tested:
restoring the doubled prefix fails 4, restoring the guessed-path append fails 2,
dropping `manifests` fails 1, returning the *pre*-commit manifests fails 1, and
unregistering clock fails 1.

## Stage 3, part 4 — the topic lifecycle stops moving files

`archive` / `restore` / `purge` for a library game now go through
`library.mjs` (`applyTopicArchive` / `applyTopicRestore` / `applyTopicPurge`)
and commit through the same `commitLibraryChange` path as an upload. The legacy
`atomicTopicRenameCommit` stays for `famous-person`, which still owns its tree.

`rename-topic` is **refused** for a library game — see finding 25.

### 23. `_a_T_colors` was a directory; now it is only a name

Archiving used to be a directory rename inside one game's `_Resources` tree,
which was safe only while each game carried its own copy of the art. Under the
library it is safe in neither direction: moving `T_colors/` out of matching's
way takes the colours out of clock and receptive, and `_a_T_colors` is not a
category any manifest could project from, so the generated manifest would be
left listing URLs that 404.

So the whole lifecycle is programme state and nothing else. `folders` and
`archived` live in the generated manifest and are read back from it on every
rebuild (finding 13), which is exactly what makes a topic that was archived
survive one. The tests assert the negative directly: after an archive,
`hub.treeEntryPaths` contains no `/img/` and no `_Resources` path at all.

### 24. `archived`'s URL lists are a projection, not a record

The old code copied `images[T_colors]` into `archived['_a_T_colors']` and
rewrote the paths. Carrying the list forward is wrong now for the same reason
carrying `images` forward would be: it goes stale. `projectManifest` recomputes
both from the same category through one `publishedIn()` helper, so an upload
into an archived topic reaches it, a removal is honoured inside it, and a
restore is byte-for-byte the manifest that existed before the archive —
`generated` included, because the stamp is a content digest.

That symmetry also exposed a live bug in `applyUpload`: `withCategory()` added
the uploaded topic to the game's `folders` whenever it was missing, which meant
an upload into an **archived** topic silently un-archived it. The rule is now
"an archived topic stays archived" — the upload still lands, it just lands in
the archived projection.

### 25. Rename is refused, not half-done — and it is a real decision

> **Superseded by Stage 3, part 5 below.** Rename is now wired — as a *name*,
> not a directory move. The analysis here is what led to that shape and is left
> in place because it is the argument for it.


A library topic is one shared category, so renaming `T_colors` in matching's
admin page is a rename for clock and receptive too. That is a decision for the
maintainer, not a side effect of one game's page. Worse, the legacy path would
move files inside `matching/_Resources/_imgSource/` — the tree the library is
*built from* — so the next `npm run stimuli:build` would re-key every stimulus
in the topic (`colors-orange` → `colours-orange`), invalidating every URL and
every saved `targetFilters` entry, while the generated manifest 404s in the
meantime.

`/api/admin/rename-topic` therefore answers **409** for clock, receptive and
matching, and the ImageManager's Rename button is disabled with the reason in
its `title`. `showRenameInline()` / `doRenameTopic()` are parked, not deleted:
they are the UI a real rename will be offered through.

**What a real rename needs (for whoever picks it up):** a rename record in a
*source* file — the rebuild derives categories from source directory names, so
a rename that lives only in the index is reverted by the next build — plus a
decision on whether the library files move with it (`img/`, `placeholder/`,
`uploads/`, and the `library` values in `provenance.json`) or whether the
category name and the storage directory are allowed to diverge. Archive + a
fresh topic is the working substitute in the meantime.

### 26. Assert the redraw before the recorded request, not after the click

The browser-side archive test asserted `posted[0]` immediately after the click
and passed everywhere except one firefox run in four. `page.route` records the
request on interception, which is not ordered against `click()` returning — but
the page only redraws after it has *handled the response*, so asserting the DOM
first and the payload second makes the ordering deterministic. Confirmed with
`--repeat-each=5` across all three browsers (135/135).

`tests/stimulus-library-worker.spec.js` gained 7 × 3 (29 tests in the file now)
and `tests/admin-image-manager.spec.js` 2 × 3 (9 in the file). Mutation-tested
six ways: dropping the archived-stays-archived guard, carrying `archived`
forward instead of projecting it, keeping a purged topic's exclusions, letting
archive fall through to the legacy rename, letting rename through, and
re-enabling the Rename button each fail 1–6 tests.

---

## Stage 3, part 5 — rename lands, and the rebuild step comes back

**Stage 3 is complete.** Both remaining items are done: `rename-topic` is wired
for the library games, and the manifest-rebuild workflow lost in `514debf4`
exists again.

### 27. A rename moves the name, never the key

Finding 25 framed rename as "move the directory, for every game at once" and
refused it. The framing was the problem. Splitting the topic's *key* from its
*name* makes every objection evaporate:

| | key (`T_colors`) | name ("Colours") |
|---|---|---|
| shared across the three games? | yes — it is one category | no — per game |
| derives stimulus ids? | yes (`colors-red`) | no |
| names files on disk? | yes (`img/T_colors/`) | no |
| what a technician wanted to change | no | **yes** |

So a rename writes `shared/stimuli/topics.json` — `game -> category -> name` —
and `projectManifest` emits it as `topicNames` in each game's manifest. Nothing
moves, no id is re-keyed, no saved `targetFilters` entry is orphaned, and
matching renaming its colours topic leaves clock's alone, which is exactly the
per-game behaviour of the old directory rename it replaces.

Three things fell out of the shape and are worth keeping in mind:

- **Keyed by category, not by folder.** `_a_T_colors` is the same topic as
  `T_colors`, so a name keyed by the archived folder would be stranded the
  moment it was archived and lost on restore.
- **A name equal to the derived name is a clear, not an override.** That only
  works because `deriveTopicName()` in `library.mjs`, the four games' dropdowns
  and the ImageManager's folder bar now all title-case identically — which is
  why the admin folder tabs read "Household Items" rather than
  "household items". Pinning "Household Items" as an override would look right
  and behave differently.
- **The API contract changed for library games.** `{ game, folder, newName }`
  instead of `{ game, folder, newFolder }`, and the response echoes `renamed:
  folder` — the key it did *not* move. `newFolder` is still accepted and its
  name derived from it, so an old client degrades rather than 400s. Legacy
  games (`famous-person`) keep `atomicTopicRenameCommit` untouched.

### 28. `topicNames` is a projection too — and that is the second self-read trap

Finding 10 caught the build reading its own output for art ranking. `topicNames`
is the same trap in a new place: it lives in the generated manifest, so a build
that read it back would produce a name that could never be *cleared* — deleting
the entry from `topics.json` would change nothing, because the manifest would
keep feeding it back to itself. `liveGames()` therefore reads `folders` and
`archived` from the live manifest (they have nowhere else to live) but names
only from `topics.json`. A mutation that reads them from the manifest passes
every worker test and is caught only by the rebuild test in
`stimulus-uploads.spec.js` that plants a "Ghost Name" in a live manifest and
asserts a rebuild drops it.

### 29. The rebuild workflow is a net, not the publish path

`.github/workflows/rebuild-manifests.yml` runs `npm run stimuli:build` on a push
to `main`/`dev` that touches the library, and commits only if something moved;
on a pull request it runs `npm run stimuli:check` instead, because rewriting a
contributor's branch from CI is a surprise and `--check` already names the file
and the command. Neither job installs dependencies — `build.mjs` and
`tests/lib/stimuli.mjs` are pure node.

It cannot loop: a `GITHUB_TOKEN` push does not trigger workflows, the commit is
`[skip ci]` anyway, and a second run would find nothing to commit. Since
`worker.js` already re-projects every manifest inside the commit an admin edit
makes, the interesting cases this catches are a hand-edited source file, a
change to `build.mjs` itself, and any commit made without the Worker.

### Coverage

`tests/stimulus-library-worker.spec.js` 33 tests (5 new × 3 browsers, the 409
refusal test replaced), `tests/admin-image-manager.spec.js` 10 (2 new),
`tests/stimulus-repoint.spec.js` 16 (4 new — one per game reading the dropdown),
`tests/stimulus-uploads.spec.js` 13 (1 new). Mutation-tested six ways: pinning
the derived name instead of clearing, naming the topic for every game, keying
`topicNames` by folder, reading names back out of the manifest, posting
`newFolder` from the admin page, and using the name as the option `value` —
each fails 1–3 tests.

### Still owed for Stage 3

1. ~~Wire `worker.js`.~~ **Done** — Stage 3 part 2.
2. ~~Repoint `AdminTools/ImageManager/index.html`.~~ **Done** — part 3.
3. ~~Restore the manifest-rebuild step.~~ **Done** — part 5, finding 29.
4. ~~Archive / restore / purge.~~ **Done** — part 4 above.
5. ~~`rename-topic`.~~ **Done** — part 5, finding 27.

Nothing. **Stage 4 (vocabulary) is next.**

---

## Stage 4, part 1 — the core vocabulary is data

`shared/stimuli/vocabulary.json` is a new **source** file (hand-maintained, read
by `build.mjs`, generated by nothing). It holds 118 words across the nine naming
domains the stage lists, each as `{id, category, name, label, emoji}`, and the
build seeds every one of them into the library whether or not a file for it
exists yet.

| domain | topic | words |
|---|---|---|
| household | `T_household_items` | 11 |
| kitchen | `T_kitchen_items` | 21 |
| clothing | `T_clothing` *(new)* | 12 |
| food | `T_foods` | 10 |
| hygiene | `T_hygiene` *(new)* | 9 |
| school | `T_school` *(new)* | 12 |
| community | `T_community_helpers` + `T_buildings` | 21 |
| toys | `T_toys` | 10 |
| vehicles | `T_vehicles` *(new)* | 12 |

45 of the 118 are genuinely new (the four new topics), and clock and receptive
now offer all four — 12 folders each before, 16 after. Nothing was removed from
any game and no existing category changed size; `matching/manifest.json` moved
by exactly one line, its content-derived `generated` stamp.

### 30. A word's id has to be the id the merge would have derived

The join between a word and its art is the id, and the id is
`stimulusId(category, name)`. So the vocabulary carries **both** the id and the
`name` (the file stem art for it is stored under), and the build refuses a word
where the two disagree. Without that check a typo'd id seeds a second entry
*beside* the photograph it was written to label, and everything downstream still
looks healthy: the library has a stimulus, the manifest publishes it, the tests
pass, and a technician sees the word twice.

`stemOfId()` is the stated inverse, asserted word by word rather than assumed.
It is also what lets a seeded word name its own generated placeholder file when
there is no candidate file to take a stem from.

### 31. Two descriptions of one picture must agree

A word with no art is drawn as its `emoji`. There are two ways that happens:

- the trees already shipped a glyph SVG for it (110 files) — that file is kept
  byte-for-byte and stays the placeholder
- nothing exists — `emojiPlaceholderSvg()` draws one, in the same 200×200 box
  and the same emoji font stack the shipped ones use

Which means for the first case the vocabulary's `emoji` and the shipped file's
`<text>` glyph are two descriptions of the same picture, and the learner sees
the file. The build **throws** when they differ rather than letting the data lie
about the art. Seeding the vocabulary's emoji from the glyphs already extracted
made that a no-op on today's data (the diff shows two entries gaining an emoji
and zero changing one), which is the point: the check is there for the next
edit, not for this one.

The generated variant deliberately uses `y="125"` and no `dominant-baseline`.
Both shapes exist among the shipped placeholders; that one is the variant every
browser lays out identically.

### 32. `emoji: null` is a decision, not an omission

Six kitchen items — blender, microwave, napkin, oven, refrigerator, toaster —
have no honest glyph in Unicode. They all ship photographs, so no fallback is
ever drawn for them. Rather than pin a misleading emoji (🥤 for a blender puts a
cup in front of a learner), the vocabulary records an explicit `null` and the
build enforces the rule that actually matters: **a word with no art must have an
emoji**, checked per word, as an error rather than a warning, because a core
word is data someone wrote down and has no file to fall back on.

That is a deliberate narrowing of the stage's "every word needs an emoji
fallback" to the reason the stage gives for it ("so nothing renders blank before
art exists"). `household-items-table` (🍽️) and
`community-helpers-crossing-guard` (🚸) were the two that did have an honest
glyph and now carry it.

### 33. Label precedence, and where the vocabulary sits in it

`labels.json` override → **vocabulary** → the label frozen in
`source-manifests.json` → `deriveLabel(filename)`.

The vocabulary sits above the frozen label because that label was itself usually
derived from a filename at repoint time. It sits below `labels.json` because
that is a technician's own edit through AdminTools, and Stage 4 is not a licence
to overwrite one. Only three frozen labels differ from their derived form at all
(`above` ×2, "Group Poster"), none of them in a core topic, so this ordering
changes no label today — asserted both ways by tests that alter one source and
check the other still wins.

### 34. The Worker needed no change, and that is worth saying out loud

An upload onto a seeded word retires a placeholder `worker.js` never generated,
and keeps a label that lives in a file `worker.js` never reads. It still agrees
with a rebuild byte-for-byte, because `applyUpload()` reads the *committed
index* — where the vocabulary's label and emoji already are — rather than
re-deriving them. Proven by a new test uploading `T_vehicles/bus.jpg` over the
seeded `vehicles-bus`.

### 35. A test over HTTP cannot see a builder that stopped building

The first cut of the vocabulary spec asserted everything against the committed
`stimuli.json` served over HTTP. Deleting the seeding loop from `build.mjs`
failed **one** test — because the committed file still had the 45 words in it,
so every HTTP assertion passed. `build.mjs --check` in `shared-stimuli.spec.js`
would have caught it, but a spec that cannot see its own subject is not a net.
Adding one test that runs `buildLibrary()` in memory and asserts every word
comes back kills the mutation directly.

### Coverage

`tests/stimulus-vocabulary.spec.js` — 15 tests × 3 browsers. Mutation-tested
seven ways, each failing 1–5 tests: seeding removed, the vocabulary label
dropped from the precedence chain, the vocabulary label put *above*
`labels.json`, the generated-placeholder branch disabled, a text font swapped
into `emojiPlaceholderSvg()`, the glyph-agreement check removed, and
`T_vehicles` taken out of clock's folders. Every mutated file was restored from
a byte-compared copy.

`tests/stimulus-uploads.spec.js` +1 × 3 (the seeded-word upload).
`tests/stimulus-repoint.spec.js` — two assertions loosened *deliberately*:
`folders` is now "every topic it shipped, plus only core topics" rather than
"exactly what it shipped", and the settings round-trip counts dropdown options
against the live manifest instead of the frozen snapshot.

**Suite: 411 passed, 9 failed — all 9 in `glam-team-makeover.spec.js`**, at the
three test titles recorded as the accepted baseline. `[firefox] :9` fails under
full-suite load and passes 3/3 when the spec is run alone, which is the
timing-dependence the baseline section already describes; the larger suite (420
tests, up from 372) makes it fail more often, not differently.

### Still owed for Stage 4

1. **ffc joins the core.** `ffc/items.json` keys its 71 items by bare stem
   (`pencil`, `mail_carrier`) with its own `img` filenames under
   `ffc/_Resources/_imgSource/items/`. Its feature/function/class metadata has
   to hang off the library's ids instead, which is also what finally retires the
   `mail_carrier` spelling — `library.mjs` already slugs both spellings onto
   `community-helpers-mail-carrier`, but ffc is the last file still carrying the
   underscore form.
2. **Per-game extras.** The vocabulary is the shared core only; `T_actions`,
   `T_colors`, `T_shapes`, `T_prepositions`, `T_emotions`, the letter/number
   programmes and matching's `T_pbs_characters` / `T_fresh-beats` still derive
   their labels. That is fine — they are not naming vocabulary — but the split
   should be stated somewhere a maintainer reads.

---

## Stage 4, part 2 — ffc joins the core

`shared/stimuli/ffc.json` is a new **source** file (hand-maintained, read by
`build.mjs`, generated by nothing). It carries ffc's 71 items as
`{id, legacyId, category, img, groups, features, functions, classes}` — the
feature / function / class metadata hung off shared stimulus ids — and
`ffc/items.json` became its projection.

The join runs both ways, and the second half is where the clinical win is:

| | before | after |
|---|---|---|
| ffc items resolving to a real photograph | 26 / 71 | **53 / 71** |
| library stimuli with real art | 126 | **140** |
| clock / receptive real-art URLs | 106 | **120** |
| matching real-art URLs | 100 | 103 |
| core vocabulary words with art | ~50 | 64 of 120 |

Zero images moved, zero stimuli lost art, zero categories shrank. Two stimuli
are new (`school-eraser`, `clothing-coat`, both seeded into the vocabulary and
both arriving with an ffc photograph).

### 36. A shared library needs a *late* rank, not just a source order

ffc's tree joined after the other three had been merged **and published**. The
merge already ranked `matching > receptive > clock`, but source order alone is
not enough: `indexed` sorts above it, so ffc's own item selection would have
beaten a file another game shipped but left out of its manifest — silently
moving a URL clock or receptive is serving today.

`rank()` gained one field, between `art` and `indexed`: a late source loses
every tie. So ffc's photograph reaches `T_school`, which had none, and cannot
take `T_animals/bear.jpg` away from anyone.

It is currently a **no-op on the data** — deleting the field rebuilds the
library byte-for-byte — which is exactly why it needed a test that asserts the
rule rather than its effect. `compareRank` is exported for that one test; every
assertion over the committed files passed with the mutation in place.

### 37. `ffc/items.json` carries no picture and no label, deliberately

The projection holds `id` + metadata and nothing a learner sees; the game
resolves the label and the image from `stimuli.json` by id at run time, and the
stamp is derived from `ffc.json` rather than from the library index.

That is what keeps ffc out of the Worker's business. An AdminTools upload
rewrites a stimulus's URL **and deletes the file behind the old one**, so a URL
frozen into `ffc/items.json` would point at a missing file until the next
rebuild — and the Worker would have to re-commit the document on every upload
just to restamp it. Asserted directly: an upload that moves `school-pencil`'s
picture leaves `ffc/items.json` byte-identical.

### 38. Two ffc words were already in the library under a different name

`construction_worker` and `police_officer` file their art as `construction.svg`
and `police.svg`, and the library already had `community-helpers-construction`
and `community-helpers-police` — seeded from those very filenames. Joining ffc
to new ids would have put the same person in front of a learner twice.

They join the existing ids, and the two vocabulary labels move from the
filename-derived "Construction" / "Police" to ffc's curated "Construction
Worker" / "Police Officer". That is the only label change in the commit, and it
is Stage 4's own rule ("explicit labels, never derived from filenames") applied
to two words that had slipped through.

`vehicles-train`'s emoji moved 🚆 → 🚂 for the same class of reason: ffc ships a
`train.svg` glyph, which is now the file a learner sees, and the build refuses
to let the data disagree with the picture (finding 31). The check found it; it
was not looked for.

### 39. ffc's admin path is **refused**, not wired — and that is the next unit

`ffc/items.json` is generated and `ffc/_Resources/_imgSource/items/` is a
library source whose every file must be claimed by an id in `ffc.json`. The old
FFCGame write endpoints break both:

- an item edit written into the projection is reverted by the next rebuild,
  silently
- an image saved under a name no item claims **stops** the rebuild, which takes
  every game's manifest down with it

So `ffc-save-items`, `ffc-save-image`, `ffc-remove-image`, the `FFCGame` branch
of `save-display-name`, and the `ffc-save` / `ffc-remove` batch ops all answer
**409** with `FFC_WRITE_REFUSED`, naming what to edit instead. The dead
`ffcItems` / `ffcModified` batch plumbing went with them. ImageManager's *read*
view still works — it joins the library in `loadGameData()` and its thumbnails
are library URLs — so the page shows the right pictures and only writes fail,
loudly.

Wiring it properly is a small, well-shaped unit: an ffc upload is a library
upload under the item's own category, an ffc label is a `labels.json` override
by id, and an ffc removal is an edit to `ffc.json`. It needs `readLibraryState`
to carry `ffc.json`, an id resolver that accepts either spelling, and
FFCGManager repointed at the source file.

### 40. Fixtures that name their subject rot the moment the data improves

Four existing tests failed for one reason: `foods-apple`, `vehicles-bus` and
`household-items-lamp` stopped being what they were chosen for the instant ffc's
art arrived (two gained photographs; one gained an alternate). None of them was
a regression — every one was a test that had hard-coded a subject.

All four now *find* their subject: "a core word still rendered by a glyph a tree
shipped", "a T_household_items stimulus with one file and no alternates", "two
T_vehicles words still waiting for art". The placeholder-shape test also got
stronger on the way: instead of comparing one file byte-for-byte, it asserts
every drawn placeholder in the library equals `emojiPlaceholderSvg(emoji)`.

### Coverage

`tests/stimulus-ffc.spec.js` — 16 tests × 3 browsers: the projection matches a
rebuild, no item carries a frozen image or label, an upload leaves it
byte-identical, no published id keeps the underscore spelling and every legacy
id still aliases, ffc keeps at least its baseline art (printed as evidence), a
late source loses every tie, no ffc picture displaced another game's, the whole
ffc tree is accounted for in provenance, no category shrank, four in-memory
build refusals, the game renders only `/shared/stimuli/` URLs with one "Mail
Carrier" row, and a seeded pre-join `ffcgSettings` round-trips with every value
intact and its targets remapped rather than pruned.

Mutation-tested four ways, each restored from a byte-compared copy: the `late`
rank removed (1 test), `idAliases` dropped (2), the target migration disabled
(1), and ffc's candidates never pushed into the merge (4, including
`shared-stimuli.spec.js`'s sync check).

`tests/stimulus-integrity.spec.js` — ffc's registry entry became
`kind: 'library-items'` (base `/`, resolved through `stimuli.json`), its
structural test now checks the projected shape plus `idAliases`, and the sweep
loads the library when a source declares one.

**Suite: 457 passed, 8 failed — all 8 in `glam-team-makeover.spec.js`**, at the
three test titles recorded as the accepted baseline. Zero new failures.

### Still owed for Stage 4

1. ~~ffc joins the core.~~ **Done** — this part.
2. **The ffc admin path** (finding 39). Still refused. Its *read* view is now
   fixed (finding 41 below); the write wiring remains the outstanding unit and
   is the last thing between ffc and parity with the other three games.
3. **Per-game extras.** The vocabulary is the shared core only; `T_actions`,
   `T_colors`, `T_shapes`, `T_prepositions`, `T_emotions`, the letter/number
   programmes and matching's `T_pbs_characters` / `T_fresh-beats` still derive
   their labels. That is fine — they are not naming vocabulary — but the split
   should be stated somewhere a maintainer reads.

---

## Stage 5 — `NooutcoConfig.migrate()` is live in all ten games

`CLAUDE.md` has always said "Games call `NooutcoConfig.migrate()` early in
boot". Two did: `matching` and `market`. The other eight now do as well —
`clock`, `emotions`, `ffc`, `intraverbal`, `patterns`, `receptive`, `sequences`
and `think-or-say` each load `../migrate-config.js` before their game script and
call `if (window.NooutcoConfig) NooutcoConfig.migrate();` as the first statement
of boot.

**This is deliberately a behavioural no-op today.** `migrate()` with no steps
only stamps `nooutco:configVersion`. The point is that the hook has to be live
*before* Stage 6 renames anything, because a migration is the only place a
renamed key can be folded forward — which is why the objective orders Stage 5
ahead of Stage 6 and says "NOTHING may be renamed before this lands."

### 41. `AdminTools/FFCGManager` was reading a shape that no longer exists

Stage 4 part 2 joined `AdminTools/ImageManager` to the library and left this
page — the ffc-specific manager, and the one `ffc/index.html`'s admin gear
opens — reading the old shape. `ffc/items.json` items carry `{id, groups,
features, functions, classes}` and nothing else, so `item.label` and `item.img`
are both `undefined`: every card rendered the literal text "undefined" over
`…/_Resources/_imgSource/items/undefined`, and so did the Mass Assign grid and
the detail panel.

Finding 39 said "ImageManager's read view still works", which was true and
also not the whole picture. Fixed the same way ImageManager was: `initApp()`
fetches `stimuli.json` alongside `items.json` and joins `label` + `image` by id;
the three thumbnail sites render `item.image` verbatim; the now-dead `IMG_BASE`
constant is gone.

The **write** path is untouched and still answers 409 — that is the deliberate
state from finding 39, not an oversight — and there is now a test pinning that
the refusal reaches the technician as an error rather than disappearing behind a
green "Saved!".

### 42. "the migration runs" and "the migration runs first" are two tests

The obvious assertion — `nooutco:configVersion` is stamped after boot — passes
with the `migrate()` call sitting *after* `loadSettings()`. That placement is
exactly the bug worth preventing: the game would adopt and re-persist a config
the migration was supposed to rewrite, and every future migration would silently
be a no-op for anyone who had already loaded the page once.

The ordering test patches `Storage.prototype.getItem` / `setItem` in an init
script and records the sequence, then asserts `set:nooutco:configVersion`
precedes `get:<gameKey>`. Moving `patterns`' call one line down fails that one
test and nothing else — confirmed by mutation.

`Storage.prototype`, not the `localStorage` instance: assigning
`localStorage.getItem = fn` goes through Storage's named-property setter in some
engines, which stores an *entry* called `getItem` and leaves the prototype
method in place, so the probe would silently record nothing on those browsers.

### 43. `matching` persists to `mgSettings` and `market` to `mmSettings`

The pairing is the opposite of what the folder names suggest (`m`atching`g`? no
— `matching/game.js:242` reads `mgSettings`, `market/game.js:218` reads
`mmSettings`). Both ordering tests would still pass with the two swapped,
because each game does read *a* settings key after migrating; the tests would
simply be asserting against the wrong read. Called out in the spec's table so a
future edit does not "fix" it.

### 44. The per-game settings round-trip owed since Stage 1 is now complete

Ten games, all covered, all seeded with every option deliberately off its
default so a silent redefault fails rather than coincidentally matching:

| game | key | covered by |
|---|---|---|
| clock, receptive, matching, market | `hddSettings`, `ngSettings`, `mgSettings`, `mmSettings` | `stimulus-repoint.spec.js` |
| ffc | `ffcgSettings` | `stimulus-ffc.spec.js` |
| intraverbal, patterns, think-or-say, emotions | `ivgSettings`, `ppcSettings`, `tosSettings`, `noaba.emotionID.v1` | `config-migration.spec.js` |
| sequences | `seqSettings` → `nooutco.settings.sequences` | `config-migration.spec.js` |

`sequences` is the one game that already migrates: `migrateLegacyIntoStore()`
folds the retired `seqSettings` into the `{sets, last, working}` round store —
read-then-fold, never drop — which is the pattern Stage 6 extracts for the other
nine. Its `autoPromptEnabled` default of **true** (against the other nine's
false) now has its own test: seed a legacy payload that omits the key and assert
the fold reaches for sequences' own default. Harmonising it to `false` fails
that test and only that test.

### Coverage

`tests/config-migration.spec.js` — 26 tests × 3 browsers: ten games stamp the
config version during boot, ten games stamp it *before* reading their settings
key, four seeded round-trips asserted control by control plus a stored-document
check, and the two sequences fold tests.

`tests/admin-ffcg-manager.spec.js` — 5 tests × 3 browsers: every item renders
its library label with no `undefined`, every thumbnail src equals the library
URL verbatim and serves 200, the detail panel matches the card, Mass Assign
renders library URLs, and a 409 write surfaces as an error.

Mutation-tested six ways, each restored from a byte-compared copy: `migrate()`
moved after `loadSettings()` in patterns (1 test), a redefaulted
`promptDelaySecs` in intraverbal (1), the emotions script tag deleted (2),
sequences' `autoPromptEnabled` default harmonised to false (1), the FFCGManager
library join removed (4), and a swallowed write refusal (1).

**Suite: 553 passed, 8 failed — all 8 in `glam-team-makeover.spec.js`**, at the
three test titles recorded as the accepted baseline. Zero new failures.
`APP_VERSION` 0.17.0 → 0.18.0.

### Still owed

- **Stage 6** — the shared `game-settings.js`, extracted from sequences. Every
  rename it performs now has a live `migrate()` hook to run in, and a
  seeded-old-key test per game to fail against.
- **Stage 4 item 2** — the ffc admin *write* path (finding 39).
- **Stage 4 item 3** — the core-vs-extras split, stated for a maintainer.

---

## Stage 6, part 1 — `game-settings.js` exists, and sequences runs on it

`apps/games/game-settings.js` (`window.NooutcoSettings`) is the `sequences`
round-setup pattern lifted out, and `sequences` itself now runs on it — which is
the only honest way to land the extraction, because the game it came from is the
one place the behaviour is already specified by working code.

Four pieces, and deliberately only four:

| piece | what it replaces in sequences |
|---|---|
| `defineStore({key, legacyKey, fields})` | `loadRoundStore` / `saveRoundStore` / `saveWorkingRound` / `applyRoundByName` / `saveCurrentRound` |
| `normalize()` / `defaults()` | `defaultRound()` + `normalizeRound()` + `clampReps` / `clampInt` |
| `foldLegacy()` | `migrateLegacyIntoStore()` |
| `holdToUnlock()` | the hold/tap block in `bindRoundEvents()` |

`sequences/game.js` shrank by ~70 lines and its schema is now a declaration
(`ROUND_FIELDS`) rather than a pair of hand-written functions that had to agree
with each other. `sequences/index.html` loads `../game-settings.js` between
`migrate-config.js` and `game.js`.

### 45. The schema had to become data before a second game could reuse it

`defaultRound()` and `normalizeRound()` were two descriptions of the same
schema, kept in sync by hand — the default lived in one and the clamp in the
other, and nothing checked that the pair agreed. Nine more games each carrying
their own divergent pair is exactly the consolidation Stage 6 is supposed to
end, so the field spec is now one declaration per option
(`{type, min, max, values, default}`) and both the defaults and the clamping are
derived from it. The five types (`int`, `bool`, `enum`, `string`, `list`) are
the five `sequences` actually uses; nothing speculative was added.

Two options resolve at normalize time rather than at declaration time
(`values` and `default` may be thunks), because `setName` has to be validated
against the symbol sets that actually loaded and falls back to whichever one the
game is showing. That is the only dynamic case in the game, and it is the reason
the spec is a function-friendly object rather than plain JSON.

### 46. "Fell back to the default" and "fell back to the floor" are different

Old `clampInt(n, min, max)` did `parseInt(n, 10) || min`, so a corrupted
`bankSize` of `0` landed on **2** — the bottom of the range — while
`clampReps` did `|| 2` and landed on the *default*. The shared normalizer uses
the field's declared default for an unparseable value and then clamps, so a
corrupted bank size restores **4**, the programme's default, not the floor.

This is a deliberate behaviour change on a value the stepper cannot produce
(it clamps 2–8), and it is the honest reading of hard constraint 1: a value
that cannot be understood restores the default the technician was shown, not
the extreme of the range. `bankSize`'s default (4) is deliberately not its
minimum (2) in the spec's scratch schema precisely so the two outcomes are
distinguishable by a test.

### 47. The lock is enforced by CSS, and that is worth a test

The first draft of the "a live edit persists" test tapped the gear (which opens
the panel **locked**) and then clicked a stepper — and Playwright reported the
stepper's own parent intercepting pointer events. That is not a test bug: it is
`#round-panel[data-editing="false"] .round-step { pointer-events: none }` doing
its job. The gating is therefore asserted directly — a locked control *refuses*
the click, and the same control takes the edit after a press-and-hold — rather
than assumed. Any future game that adopts `holdToUnlock()` without the matching
`[data-editing="false"]` rule will have a gear that gates nothing, and this is
the shape of test that catches it.

### 48. `const` hoisting decides where a store can be declared

`defineStore()` is called at game.js's top level, so every constant it reads has
to be initialised above it. `LEGACY_SETTINGS_KEY` lived ~300 lines below, next
to the fold that used it, and moving the store above it would have thrown a
temporal-dead-zone `ReferenceError` that takes the whole game down at parse
time — not just the settings panel. The key moved up next to `ROUND_KEY`; the
same will be true for every game that adopts the store.

### Coverage

`tests/game-settings.spec.js` — 20 tests × 3 browsers, in two halves:

- the module's own semantics against a scratch key outside every game's
  namespace (clamping, default-vs-floor, a stored `false` surviving a
  `true`-defaulting field, list/enum fallback, a fresh defaults array,
  `{sets,last,working}` round-trip, `initial()` precedence, a corrupted
  document degrading rather than throwing, and five `foldLegacy` rules
  including **the legacy key is never deleted**)
- `sequences` on the real page: the module loads, an out-of-range stored round
  is clamped in the panel the technician reads, the gear gates as designed, a
  round still starts with no page error, and a live edit reaches the store

Mutation-tested six ways, each restored from a byte-compared copy: an
unparseable int falling back to the minimum (3 tests), a bool always taking its
default (4, including the sequences fold), `foldLegacy` deleting the legacy key
(1), the post-hold click no longer swallowed (3), `defaults()` sharing its list
(1), and `sequences`' `autoPromptEnabled` default harmonised to false (1 — the
non-negotiable). Deleting the `game-settings.js` script tag fails 19 of 20.

**Suite: 610 passed, 8 failed — all 8 in `glam-team-makeover.spec.js`**, at the
three test titles recorded as the accepted baseline. Zero new failures.
`APP_VERSION` 0.18.0 → 0.19.0.

### Still owed for Stage 6

- The other nine games, one at a time, each folding its retired key
  (`hddSettings`, `ffcgSettings`, `ivgSettings`, `mmSettings`, `mgSettings`,
  `ppcSettings`, `ngSettings`, `tosSettings`, `noaba.emotionID.v1`) through
  `foldLegacy()`. Every one of them already has a seeded-old-key round-trip
  test from Stage 5 to fail against if the fold drops a value, and a live
  `migrate()` hook to run in.
- The press-and-hold gating only *gates* where the panel also carries the
  `[data-editing="false"] { pointer-events: none }` rule (finding 47). Adopting
  `holdToUnlock()` in a game means adopting that rule with it.

---

## Stage 6, part 2 — `clock` and `receptive` adopt the store

Two games down, seven to go. `clock` (`hddSettings` →
`nooutco.settings.clock`) and `receptive` (`ngSettings` →
`nooutco.settings.receptive`) now declare their programme parameters as one
field spec and read/write them through `defineStore()`. Each `loadSettings()`
is `foldLegacy()` then `initial()`; each `saveSettings()` is `saveWorking()`.
Both load `../game-settings.js` between `migrate-config.js` and `game.js`.

Note the key pairing, which stays as surprising as finding 43 recorded it:
`clock` is `hddSettings` but `receptive` is `ngSettings` (it is `NameIDGame`).

### 49. A shared library needs a field type for opaque technician-keyed data

`targetFilters` — `{ topicFolder: [imageUrl, …] }` — is the first setting the
five original types could not describe, and reaching for `list` would have been
actively harmful. `list` validates members against an allowed set and **drops**
what is not in it; `targetFilters`' keys are topic folders and its values are
stimulus URLs, so both sides are *content*. A topic whose art is temporarily
unpublished would have come back empty — a silent deletion of the technician's
target selection, which is precisely the failure `pathAliases` exists to
prevent (finding 11).

The new `map` type therefore keeps every key and value verbatim and only
refuses a value that is not a plain object at all. It is deliberately weaker
than every other type in the module, and the comment says why.

`defaultsFor()` was widened at the same time: it used to clone only a `list`
default, so a declared `default: {}` would have been shared by reference across
every `defaults()` call, and one game's live edit would have reached into the
declaration. Now anything object-shaped is cloned.

### 50. The seeded-old-key tests had to be re-pointed, and that is the point

Two existing specs keyed off the retired names and both would have gone green
for the wrong reason if left alone:

- `config-migration.spec.js`'s ordering probe watches `get:<settingsKey>`. Left
  on `hddSettings` it **still passes** — verified by reverting the row and
  re-running: every test starts from empty storage, so `foldLegacy()` does read
  the retired key on that one load. That is exactly why it had to move. The
  assertion would have been quietly vacuous from the second load onward, when
  `foldLegacy()` returns before touching the retired key and the only settings
  read left is the store's. The row now names the key the game reads on *every*
  load, so the probe keeps asserting something.
- `stimulus-repoint.spec.js` seeded `hddSettings` and read the same key back.
  Post-adoption the game never writes it, so the read-back had to move to
  `<storeKey>.working`. The seed stays where it is — seeding the retired key is
  the whole point of the test — and it gained the assertion that pairs with it:
  the retired key comes back **byte-for-byte what was seeded**, so the
  never-drop rule is proven on the live game and not just on the module.

### 51. "Clamped" and "redefaulted" look identical unless the panel is asserted

`hddSettings` was read with `??` — any stored value was adopted verbatim, so an
`arraySize` of 99 ran 99-tile arrays and a `promptStyle` of `'neon'` left the
select rendering blank. The store clamps: 99 → 10, `'neon'` → `'sparkle'`,
`promptDelaySecs: 0` → 3 (the declared default, per finding 46, not the floor).

That is a behaviour change, and hard constraint 1 says no setting may be
*silently* redefaulted — so the test asserts the **control**, not the stored
value: `#inp-size` must read `10`. A clamp the technician can see in the panel
they are looking at is a correction; one that only exists in storage is exactly
the silent redefault the constraint forbids.

### 52. Moving a schema into a shared module is how a per-game default gets lost

`autoPromptEnabled` is `false` in nine games and `true` only in `sequences`.
Part 1 tested that for `sequences`; nothing tested the other side, so
harmonising `clock`'s declaration to `true` would have passed the whole suite.
Each adopted game now has a fresh-install test asserting its own declared
defaults, with `#chk-auto-prompt` unchecked as the named non-negotiable. The
mutation fails 3 tests and nothing else.

### Coverage

`tests/settings-store-adoption.spec.js` — 6 tests × 2 games × 3 browsers, and
this table is what each remaining game adds a row to: the module loads with no
page error, a fresh install shows that game's own declared defaults, the
retired key folds into the store *and into the panel*, the retired key survives
both the fold and a subsequent live edit byte-for-byte, a config already in the
store outranks the retired key, and an out-of-range value is clamped into the
range the control can display.

`tests/game-settings.spec.js` +2 × 3 for the `map` type against the scratch
store: every key and value kept (including a topic no longer published), the
stored object copied rather than adopted by reference, a non-object falling
back, and `defaults()` handing back a fresh map.

Mutation-tested six ways, each restored from a byte-compared copy: `map`
returning `{}` (9 tests), `clock` skipping `foldLegacy()` (12), the
`game-settings.js` script tag deleted from `receptive` (27), `clock`'s
`autoPromptEnabled` harmonised to true (3 — the non-negotiable), `receptive`'s
`tokenEmoji` enum narrowed to `['random']` (3), and `clock`'s `saveSettings()`
writing back to `hddSettings` (6).

**Suite: 655 passed, 8 failed — all 8 in `glam-team-makeover.spec.js`**, at the
three test titles recorded as the accepted baseline. Zero new failures.
`APP_VERSION` 0.19.0 → 0.19.1.

### Still owed for Stage 6 (updated)

- Seven games: `ffc` (`ffcgSettings`), `intraverbal` (`ivgSettings`), `market`
  (`mmSettings`), `matching` (`mgSettings`), `patterns` (`ppcSettings`),
  `think-or-say` (`tosSettings`), `emotions` (`noaba.emotionID.v1`). Each is a
  row in `ADOPTED` plus a field spec; `matching`/`market` also carry
  `targetFilters`, so they need the `map` type and nothing new.
- `think-or-say` keeps part of its configuration in the DOM rather than in
  state (Stage 7 names this explicitly), so its spec cannot be written from
  `loadSettings()` alone — do that one last, or fix the DOM-as-state first.
- The press-and-hold gating is still unadopted anywhere but `sequences`, and
  only *gates* where the panel carries the matching
  `[data-editing="false"] { pointer-events: none }` rule (finding 47).

---

## Stage 6, part 3 — `matching` and `market` adopt the store

Four games down, five to go. `matching` (`mgSettings` →
`nooutco.settings.matching`) and `market` (`mmSettings` →
`nooutco.settings.market`) now declare their programme parameters as one field
spec and read/write them through `defineStore()`. Each `loadSettings()` is
`foldLegacy()` then `initial()`; each `saveSettings()` is `saveWorking()`. Both
load `../game-settings.js` between `migrate-config.js` and `results-report.js`.

No new field type was needed: both games' `targetFilters` uses the `map` type
added in part 2, and their token boards reuse `receptive`'s declarations. The
two genuinely new fields are display ones — `matching`'s `displayMode`
(`simple` | `visual`) and `market`'s `animTier` (`full` | `light` | `minimal`).

### 53. A persisted setting with no panel control still needs a control assertion

`matching`'s `displayMode` is not in the settings panel at all — it is the
toolbar Simple/Visual slider, written by `window.__setGameDisplayMode` and read
back by `window.__syncDisplayToggle`. Finding 51 says a clamp is only honest if
the technician can see it, and the same argument applies to a fold: asserting
`stored.working.displayMode === 'visual'` proves the value moved, not that the
game is *in* visual mode.

`header-chrome.js` publishes that state as `#display-toggle[aria-checked]`, so
the table gained an `attr:<name>` control kind and the row asserts the toggle
rather than the store. Deleting `displayMode` from the field spec — the exact
shape of "a setting was silently removed" that hard constraint 1 forbids —
fails 3 tests and nothing else; without the toggle assertion it fails none,
because the store simply stops carrying a key nothing else reads.

### 54. `parseInt(raw, 10) || default` makes a cross-field default unsafe

Both games read `currentTokens` as `s.currentTokens ?? state.startingTokens` —
a default derived from another field, which the spec supports via a thunk. But
`normalizeInt` treats a stored `0` as unparseable and takes the default, so a
thunk default would have converted a legitimate `currentTokens: 0` into
`startingTokens` — turning "the board is empty" into "the board is pre-loaded".

The declaration is therefore `default: 0`, matching `receptive`. That is safe
here for a specific reason rather than by preference: `initializeTokenBoard()`
runs at the bottom of `loadSettings()` and unconditionally assigns
`state.currentTokens = state.startingTokens` whenever the board is on, so
neither reading is observable on screen. `currentTokens` is deliberately absent
from both new `ADOPTED` rows for the same reason — it is live session state, not
a programme parameter, and seeding it would assert a value the game overwrites.

### 55. The value that proves an enum survived is the one the shortcut cannot reach

`market`'s `animTier` has three values but the toolbar slider only ever writes
two of them (`visual` → `full`, `simple` → `minimal`). Seeding `full` or
`minimal` would pass against an enum narrowed to those two; seeding `light` —
reachable only from `#sel-anim-tier` — is what fails. Narrowing the enum to
`['full', 'minimal']` fails exactly 3 tests with `light` seeded and zero
without it.

### Coverage

`tests/settings-store-adoption.spec.js` grew from 2 rows to 4 — the same six
assertions per game, now 6 × 4 × 3 = 72 tests. `expectControls()` gained the
`attr:<name>` kind for `#display-toggle`.

`tests/stimulus-repoint.spec.js`: `matching` and `market` gained `storeKey`, so
their seeded pre-repoint round-trip now reads back from `<storeKey>.working`
and additionally asserts the retired key comes back byte-for-byte as seeded.

`tests/config-migration.spec.js`: both ordering probes moved off `mgSettings` /
`mmSettings` and onto the store keys, for the reason finding 50 records — a
probe on a key only read during a one-time fold goes vacuous from the second
load onward without ever going red.

Mutation-tested six ways, each restored from a byte-compared copy: `matching`
skipping `foldLegacy()` (12 tests), `market`'s `autoPromptEnabled` harmonised
to true (3 — the non-negotiable), `matching`'s store adopting `mgSettings` as
its own key (18), `matching`'s `displayMode` deleted from the field spec (3),
`market`'s `animTier` enum narrowed to drop `light` (3), and the
`game-settings.js` script tag deleted from `market` (21).

**Suite: 691 passed, 8 failed — all 8 in `glam-team-makeover.spec.js`**, at the
three test titles recorded as the accepted baseline. Zero new failures.
`APP_VERSION` 0.19.1 → 0.19.2.

### Still owed for Stage 6 (updated)

- Five games: `ffc` (`ffcgSettings`), `intraverbal` (`ivgSettings`), `patterns`
  (`ppcSettings`), `think-or-say` (`tosSettings`), `emotions`
  (`noaba.emotionID.v1`). Each is a row in `ADOPTED` plus a field spec.
- `think-or-say` keeps part of its configuration in the DOM rather than in
  state (Stage 7 names this explicitly), so its spec cannot be written from
  `loadSettings()` alone — do that one last, or fix the DOM-as-state first.
- The press-and-hold gating is still unadopted anywhere but `sequences`, and
  only *gates* where the panel carries the matching
  `[data-editing="false"] { pointer-events: none }` rule (finding 47).

---

## Stage 6, part 4 — `intraverbal` and `patterns` adopt the store

Six games down, three to go. `intraverbal` (`ivgSettings` →
`nooutco.settings.intraverbal`) and `patterns` (`ppcSettings` →
`nooutco.settings.patterns`) now declare their programme parameters as one
field spec and read/write them through `defineStore()`. Each `loadSettings()`
is `foldLegacy()` then `initial()`; each `saveSettings()` is `saveWorking()`.
Both load `../game-settings.js` between `migrate-config.js` and `game.js`.

These are the first two adopters that are **not** library-stimulus games —
`intraverbal` draws from its own `items.json` and `patterns` from
`symbols.json` — which is what forced the adoption table to stop assuming a
shared page shape (finding 56).

### 56. The adoption table assumed two controls that only six games have

`settings-store-adoption.spec.js` was written against four games that all
happen to share `#sel-topic` (the boot signal) and `#inp-size` (the stepper the
edit / precedence / clamp assertions drive). Neither is universal:
`intraverbal` fills `#sel-category`, `patterns` fills `#sel-set`, and
`patterns` has no array size at all — its nearest equivalent is `#inp-bank`,
whose ceiling is 8 rather than 10.

Rather than fork the spec, each row may now name its own `boot`
(`{selector, notText}`) and `probe` (`{selector, option, seeded, edited, ahead,
max}`), both defaulting to what the six library games use. `OUT_OF_RANGE` went
from a constant to `outOfRange(probe)` so the "99 clamps to the control's max"
assertion follows the probe instead of hard-coding 10. The four existing rows
are byte-for-byte unchanged in behaviour; the generalisation is what let two
structurally different games join the same six assertions.

### 57. A cross-field `max` must resolve from the *stored* document

`patterns` clamps `blanksToFill` to `state.patternLength`, not to a constant —
the gift box holds ≤9 tiles, so 3 blanks is legal at pattern length 3 and
illegal at 2. The field spec expresses that as
`max: (cfg) => clampPatternLength(cfg.patternLength)`.

The subtlety is *which* `cfg` the thunk receives: `normalizeWith()` passes the
raw source document, not the partially-normalized output, so the thunk has to
re-clamp `patternLength` itself rather than trusting the neighbouring field to
have been normalized first. Hard-coding the max to the declared default of 2
instead — the shape of the bug where a cross-field constraint quietly collapses
to its default — fails exactly 3 tests, and only because the seeded row carries
`blanksToFill: 3` against `patternLength: 3`. Seeding 2 would have passed.

This is the counterpart to finding 54: a cross-field *default* is unsafe for an
int (`parseInt || default` eats a stored 0), but a cross-field *bound* is fine,
because bounds are applied after the value has already been parsed.

### 58. `bankSize` was clamped on edit and not on load

`patterns`' bank stepper has always clamped to 2–8 in its `change` handler,
while `loadSettings()` read `s.bankSize ?? 4` with no clamp at all — so a
stored 99 survived a reload as 99 and the number input rendered it, while the
first touch of the stepper snapped it back into range. Declaring
`min: 2, max: 8` in the field spec makes the load agree with the edit. Per
finding 51 this is a real behaviour change, and it is an honest one because the
correction is visible in the control the technician is reading.

### 59. A raw NUL byte in `ffc/game.js` made the file invisible to `grep`

Stage 4 introduced `after.join('\0') !== before.join('\0')` in `ffc`'s alias
remap, written as a literal NUL rather than an escape. That is legal JavaScript
and the game works, but `grep`/`ripgrep` classify any file containing a NUL as
binary and skip it silently — `grep -rn 'ffcgSettings' apps/games` returned
nothing while the string was on two lines of that file. `git` was unaffected
(its binary sniff only reads the first 8 KB, and the NULs sit at offset 11832),
so the diff stayed readable and nothing flagged it.

Rewritten as the escape `'\u0000'`: identical behaviour, and the file is text to every
tool again. Worth checking for after any edit that writes a separator
character — the classification is invisible until a search comes back empty.

### 60. `origin/main` has moved 38 commits ahead, all in the excluded games

The run's own exit check is `git diff --stat origin/main..HEAD` showing zero
changes under `famous-person/`, `red-carpet-convos/`, `glam-team-makeover/` and
`glam-*.spec.js`. Run literally today it shows **73 files, 9565 deletions** in
exactly those paths — which reads as "this run deleted the glam suite" and is
the opposite of what happened.

`origin/main` is now `a459afe4`; the merge base with this branch is
`7d083751`, 38 commits back. Every one of those 38 is glam / famous-person /
red-carpet work landed on `main` *after* this branch forked — thirteen
`glam-*.spec.js` files that have never existed on this branch, plus a
3500-line rewrite of `glam-team-makeover/index.html` and the retirement of
`famous-person/_Resources/_imgSource`.

Two-dot `A..B` in `git diff` is not the range operator it is in `git log` — it
is plain `git diff A B`, so everything `main` gained shows up as something this
branch removed. The check that answers the question actually being asked is the
three-dot form:

    git diff --stat origin/main...HEAD -- apps/games/famous-person \
      apps/games/red-carpet-convos apps/games/glam-team-makeover \
      'apps/games/tests/glam-*.spec.js' apps/games/tests/red-carpet-convos.spec.js

which is empty, as is the same diff taken against the merge base with the
working tree included. This branch has introduced zero bytes of change under
the excluded paths, and the recorded 8-failure glam baseline is the baseline of
`7d083751`, not of today's `main`. **Whoever merges this will be integrating
against a `main` whose glam suite has grown from 1 spec file to 14** — the
merge is expected to be clean (disjoint paths) but the post-merge suite will
have a different, larger baseline than the one this run measured against.

### Coverage

`tests/settings-store-adoption.spec.js` grew from 4 rows to 6 — the same six
assertions per game, now 6 × 6 × 3 = 108 tests.

`tests/config-migration.spec.js`: both ordering probes moved off `ivgSettings`
/ `ppcSettings` and onto the store keys (finding 50), and the two `ROUND_TRIPS`
rows gained a `storeKey` so the seeded retired payload is now asserted twice —
returned byte-for-byte under the retired key **and** folded into
`<storeKey>.working`. `intraverbal`'s `category` and `patterns`' `setName` stay
asserted here, against the real `items.json` / `symbols.json`, rather than in
the adoption table.

Mutation-tested six ways, each restored from a byte-compared copy:
`intraverbal` skipping `foldLegacy()` (12 tests), `patterns`'
`autoPromptEnabled` harmonised to true (3 — the non-negotiable), `intraverbal`'s
store adopting `ivgSettings` as its own key (18), `patterns`' `blanksToFill`
max hard-coded to the default pattern length (3), `patterns`' `bankSize` losing
its declared range (3), and the `game-settings.js` script tag deleted from
`intraverbal` (24).

**Suite: 727 passed, 8 failed — all 8 in `glam-team-makeover.spec.js`**, at the
three test titles recorded as the accepted baseline. Zero new failures.
`APP_VERSION` 0.19.2 → 0.19.3.

### Still owed for Stage 6 (superseded by part 5 below)

- Three games: `ffc` (`ffcgSettings`), `think-or-say` (`tosSettings`),
  `emotions` (`noaba.emotionID.v1`). Each is a row in `ADOPTED` plus a field
  spec.
- `ffc` writes its settings from a second place: `loadItems()` calls
  `migrateTargetFilters(data.idAliases)`, which re-points a saved target
  selection at the shared stimulus ids and calls `saveSettings()` when it
  changed anything. That runs after `loadSettings()`, so the fold happens
  first — but it means `ffc`'s adoption has two save paths to move, not one,
  and `tests/stimulus-ffc.spec.js` currently reads the result back out of
  `ffcgSettings` (which after adoption would still be the *pre-remap* payload,
  because `foldLegacy()` never rewrites the retired key). That spec has to be
  re-pointed at `<storeKey>.working` in the same commit as the adoption.
- `think-or-say` keeps part of its configuration in the DOM rather than in
  state (Stage 7 names this explicitly), so its spec cannot be written from
  `loadSettings()` alone — do that one last, or fix the DOM-as-state first.
- `emotions` has no `game.js`: all 816 lines live in `emotions/index.html`, and
  its options are `aria-checked` buttons rather than form controls, so its row
  needs `attr:` control kinds throughout (the kind added in part 3).
- The press-and-hold gating is still unadopted anywhere but `sequences`, and
  only *gates* where the panel carries the matching
  `[data-editing="false"] { pointer-events: none }` rule (finding 47).

---

## Stage 6, part 5 — `ffc` and `emotions` adopt the store

Eight games down, one to go. `ffc` (`ffcgSettings` →
**`nooutco.settings.ffc.trial`**, and that name is the finding) and `emotions`
(`noaba.emotionID.v1` → `nooutco.settings.emotions`) now declare their
programme parameters as one field spec and read/write them through
`defineStore()`. Each load is `foldLegacy()` then `initial()`; each save is
`saveWorking()`. Both load `../game-settings.js` after `migrate-config.js`.

`emotions` is the first adopter with **no `game.js` and no form controls** — all
816 lines are one IIFE inside `emotions/index.html`, and every option is a pill,
a segmented button or a chip.

### 61. `nooutco.settings.ffc` was already taken — by `ffc`

The Frame 07 session panel (`ffc/game.js`, "Session setup") persists a curated
per-learner session to `localStorage['nooutco.settings.ffc']` as
`{ sets, last, working }` — **exactly the shared store's document shape, with an
entirely different schema** (`{items, targets, includeTypes, arraySize,
prompting}` rather than mode / array size / prompting style / target filters).

Pointing the settings store at that key would have done two silent things to any
technician who had ever pressed Start Session, which is what writes `working`:

- `foldLegacy()` returns early once `working` exists, so `ffcgSettings` would
  never fold at all — every trial setting they had configured, gone
- `initial()` would then normalize the *session* document as if it were trial
  settings, defaulting every field it does not recognise (and silently adopting
  the session's `arraySize`, the one field name the two schemas share)

Neither shows up as an error. The game boots, the panel renders, and the
programme parameters are simply the defaults.

So the trial settings took **their own key**, `nooutco.settings.ffc.trial`, and
the session document was left exactly where it is. Moving the session instead
does not work: "never drop" means the old key keeps its document, and a
surviving `working` there is precisely what blocks the fold. Two config
documents for one game is real duplication worth ending, but merging them is a
UI change (the session panel owns its own schema), not a storage one — Stage 7
is where that belongs.

`tests/settings-store-adoption.spec.js` carries the regression test that fails
if a later tidy-up "corrects" the key to match the other nine games: seed a
session document *and* `ffcgSettings`, and assert the trial settings still fold
into their own key while the session document comes back byte-for-byte.

### 62. Discrete buttons are an enum, not a range

`emotions` renders its field size as four buttons (2 / 3 / 4 / 6) and its
pronoun as four segments, painted with
`b.classList.toggle('on', +b.dataset.n === cfg.size)`. A value in range but not
*offered* — a stored `size: 5` — leaves **no button highlighted**, which reads
to a technician as "this setting is unset" rather than as the value it holds.

So both are declared `enum` over the exact values the control offers rather than
`int {min:2, max:6}`. Loosening `size` back to a range is a one-line mutation
that fails exactly one test (the clamp row), because the seeded 5 then survives
normalization and the panel shows nothing selected.

The same reasoning does *not* apply to `promptDelay`: its select offers
1/2/3/4/5/10 s, and the platform-wide `int {min:1, max:10}` clamps an
out-of-range 99 to **10**, which that select can show. Range where the ceiling
is renderable, enum where it is not.

### 63. `emotions`' `promptDelay` is seconds, where eight games call that a flag

Every other in-scope game splits the two: `promptDelay` is the *boolean* "wait
before prompting" toggle and `promptDelaySecs` is the number. `emotions` has no
separate toggle — the delay row is shown by `autoPrompt` alone — so its
`promptDelay` holds the seconds directly.

That matters because the shared `outOfRange()` helper seeds
`{promptDelaySecs: 0, promptStyle: 'neon'}` for every row, and `emotions` has
neither field. Rows can now override `outOfRange` (and `secondary`, the second
option the precedence test asserts) for exactly this reason. Copying another
game's field spec into `emotions` would have declared `promptDelay` a bool and
turned "5 seconds" into `true`.

### 64. The `__auto__` tag fold survived a mutation because nothing tested it

`ffc`'s old `loadSettings()` re-checked `s.tag === '__auto__'` on **every** read
of the retired key; the store reads it **once**, so the rewrite has to move into
`foldLegacy({map})` or the sentinel is adopted verbatim as a tag name.

Deleting the map and running the whole adoption + ffc suite passed 65/65 — the
tag dropdown falls back to `tags[0]` for any unknown tag, so the sentinel is
invisible on screen. It is only visible in the store's working document, which
nothing was reading. The test that kills it seeds `tag: '__auto__'` and asserts
`working.tag === ''`. Worth generalising: a legacy fixup whose effect is
masked by a downstream fallback needs an assertion on the *stored* value, not
on the rendered one.

### Coverage

`tests/settings-store-adoption.spec.js` grew from 6 rows to 8 — the same six
assertions per game (6 × 8 × 3 = 144) — plus two `ffc`-specific tests × 3 for
the key collision (finding 61) and the `__auto__` fold (finding 64). Rows may
now also name their own `secondary` (the precedence test's second option) and
`outOfRange`, and `expectControls()` gained a `text` kind for
`#sizes button.on`.

`tests/config-migration.spec.js`: the `emotions` and `ffc` ordering probes moved
onto the store keys (finding 50 — naming a retired key goes vacuous from the
second load onward), and the `emotions` `ROUND_TRIPS` row gained a `storeKey` so
the seeded payload is asserted twice: byte-for-byte under
`noaba.emotionID.v1` **and** folded into `<storeKey>.working`.

`tests/stimulus-ffc.spec.js`'s pre-join round-trip reads the remapped target ids
out of `nooutco.settings.ffc.trial.working` rather than out of `ffcgSettings`
(which after adoption holds the *pre*-remap ids, permanently), and gained the
paired assertion that the retired key returns byte-for-byte as seeded.

Mutation-tested six ways, each restored from a byte-compared copy: `ffc`'s
settings key collapsed onto `nooutco.settings.ffc` (7 tests), `emotions`'
`autoPrompt` harmonised to true (1 — the non-negotiable), `ffc` skipping
`foldLegacy()` (5), `emotions`' `size` loosened from an enum to a range (1),
the `game-settings.js` script tag deleted from `emotions` (8), and `ffc`
dropping the `__auto__` map (0 → 1 after the test in finding 64 was added).

**Suite: 769 passed, 8 failed — all 8 in `glam-team-makeover.spec.js`**, at the
three test titles recorded as the accepted baseline. Zero new failures.
`APP_VERSION` 0.19.3 → 0.19.4.

### Still owed for Stage 6 (superseded by part 6 below)

- One game: `think-or-say` (`tosSettings`). It keeps part of its configuration
  in the DOM rather than in state (`think-or-say/game.js:239-269`, which Stage 7
  names explicitly), so its field spec cannot be written from `loadSettings()`
  alone — fix the DOM-as-state first, or declare only the fields that already
  round-trip through storage and leave the DOM-held ones to Stage 7.
- `think-or-say`'s retired payload stores `promptDelaySec` (singular, and as a
  **string** — see the `ROUND_TRIPS` row in `config-migration.spec.js`), which
  is a third spelling of the same option. An `int` field normalizes `'5'` to 5
  correctly, but the seeded round-trip asserts `toEqual('5')` against the
  retired key and will need the store read to expect the number.
- The press-and-hold gating is still unadopted anywhere but `sequences`, and
  only *gates* where the panel carries the matching
  `[data-editing="false"] { pointer-events: none }` rule (finding 47).
- Deferred to Stage 7, from finding 61: `ffc` now carries two configuration
  documents (`nooutco.settings.ffc` for the Frame 07 session,
  `nooutco.settings.ffc.trial` for the trial settings). Merging them is a UI
  change, not a storage one.

---

## Stage 6, part 6 — `think-or-say` adopts the store (Stage 6 complete)

The tenth and last game. `tosSettings` → `nooutco.settings.think-or-say`, with
all eleven of its options declared as one `SETTINGS_FIELDS` spec, `loadSettings()`
= `foldLegacy()` + `initial()` and `saveSettings()` = `saveWorking()`.
`../game-settings.js` loads between `migrate-config.js` and `game.js`.

**All ten in-scope games are now on the shared store**, each with its retired key
read once and never deleted:

| game | retired key | store key |
|---|---|---|
| `sequences` | `seqSettings` | `nooutco.settings.sequences` |
| `clock` | `hddSettings` | `nooutco.settings.clock` |
| `receptive` | `ngSettings` | `nooutco.settings.receptive` |
| `matching` | `mgSettings` | `nooutco.settings.matching` |
| `market` | `mmSettings` | `nooutco.settings.market` |
| `intraverbal` | `ivgSettings` | `nooutco.settings.intraverbal` |
| `patterns` | `ppcSettings` | `nooutco.settings.patterns` |
| `ffc` | `ffcgSettings` | `nooutco.settings.ffc.trial` (finding 61) |
| `emotions` | `noaba.emotionID.v1` | `nooutco.settings.emotions` |
| `think-or-say` | `tosSettings` | `nooutco.settings.think-or-say` |

### 65. The DOM-as-state blocker was not a blocker for the adoption

The "still owed" note above said this game's field spec could not be written
from `loadSettings()` alone. That is **wrong as stated**, and the correction is
worth recording because it is the same shape as the rename refusal in finding 52.

`think-or-say` keeps its configuration in the *controls* rather than in a
`state` object — `buildDeck()` reads `el.selCategory.value` directly — but every
one of its eleven options already round-trips through `tosSettings`, so the
schema was fully observable. What the DOM-as-state actually changes is which
direction each half of the adoption runs:

- `loadSettings()` writes the normalized config **to the controls** (no `state`
  assignment in between, unlike the other nine)
- `saveSettings()` reads **from the controls**, so it wraps the payload in
  `settingsStore.normalize()` — the select's `value` is a string, and that call
  is what turns it back into the store's `int` using the *same* declaration the
  load path clamps with

So the store is adopted in full and the DOM-as-state cleanup stays a Stage 7
refactor with no settings work left inside it. `tests/settings-store-adoption.spec.js`
carries the assertion that the two halves agree: the folded category has to
reach the **deck** (start a session, assert the first card), not just the panel.

### 66. `promptDelaySec` was renamed forward, in the fold

The retired payload's third spelling of the prompt delay — singular, and stored
as the string `'5'` — is renamed onto the platform-wide `promptDelaySecs` int
**inside `foldLegacy({map})`**, which is the only place a rename can happen
without touching the retired key. `tosSettings` keeps `promptDelaySec: '5'`
forever; the store never sees the old spelling.

That is worth doing rather than typing the old name as an `int`, because the
rename is what makes the shared field vocabulary actually shared: `promptDelay`
(bool) + `promptDelaySecs` (int) is now the identical pairing in nine games.
(`emotions` is the exception and cannot be harmonised — finding 63: it has no
bool at all and its `promptDelay` *is* the seconds.)

The test that kills a dropped rename asserts both halves: `promptDelaySecs === 5`
as a **number**, and `'promptDelaySec' in working === false`. A second assertion
drives a live edit and re-reads the store, which is what fails if the
`normalize()` in `saveSettings()` is removed and `'4'` starts being persisted.

### 67. `category` is an enum because a stale one leaves the game unstartable

`category` and `order` are declared `enum` over exactly the values their selects
offer. That matters more here than the usual "a value the control cannot render"
argument: a stored category naming cards that no longer exist sets
`el.selCategory.value` to a missing option, which the browser resolves to `''` —
and `buildDeck()` then filters on `cat !== 'all' && s.cat !== cat`, matches zero
scenarios and **alerts "No cards match these settings"** instead of starting.
Clamping to `'all'` is the honest recovery, and it is asserted in the panel.

### 68. A negated Playwright locator assertion does NOT pass on a missing element

`think-or-say`'s category `<select>` ships empty — every other row in the
adoption table excludes a placeholder option that exists in the HTML before boot
(`-- scanning --`, `(no categories)`), and there is nothing here to be *not*. I
added a positive `text` form to the boot helper and documented it as necessary
because `not.toHaveText` would be "satisfied by an element that does not exist".

**That premise was wrong, and I checked it rather than shipping it.** Pointing
the boot signal at `#no-such-element-anywhere` fails with
`Error: element(s) not found` after the timeout — the negated form waits like
the positive one. The `text` form is still the right choice here (there is no
placeholder to exclude, and naming the option the game builds is a stronger
signal), but the comment now says that instead of a false claim about Playwright.

### Coverage

`tests/settings-store-adoption.spec.js` grew from 8 rows to **10** (6 × 10 × 3 =
180) plus two `think-or-say`-specific tests × 3 (the rename in finding 66, and
the folded config reaching the deck in finding 65). Rows may now also name a
`folded` payload — what the store holds after the fold, which differs from the
seeded retired payload only for the game that renames an option — and a `text`
boot signal.

`tests/config-migration.spec.js`: the `think-or-say` ordering probe moved onto
the store key (finding 50), and its `ROUND_TRIPS` row gained `storeKey` +
`folded`, so the seeded payload is asserted twice — byte-for-byte under
`tosSettings` **and** folded into `<storeKey>.working` under the new spelling.

Mutation-tested seven ways, each restored from a byte-compared copy: the
`game-settings.js` script tag deleted (30 tests), `foldLegacy()` skipped (15),
the `promptDelaySec` rename dropped from the fold map (15), `normalize()`
removed from the save path (6), `autoPrompt` harmonised to true (3 — the named
non-negotiable), `category` loosened from an enum to a string (3), and
`el.selCategory.value` never written on load (9).

**Suite: 793 passed, 8 failed — all 8 in `glam-team-makeover.spec.js`**, at the
three test titles recorded as the accepted baseline. Zero new failures; the
suite grew 777 → 801. `APP_VERSION` 0.19.4 → 0.19.5.

### Still owed after Stage 6

- Nothing for Stage 6 itself: all ten games are on the shared store, and every
  retired key is read-then-folded and never deleted.
- The press-and-hold gating is still unadopted anywhere but `sequences`, and
  only *gates* where the panel carries the matching
  `[data-editing="false"] { pointer-events: none }` rule (finding 47). Adopting
  it elsewhere is a UI change per game, not a storage one.
- Stage 7 (unchanged): `think-or-say`'s DOM-as-state (`buildDeck()` and the
  prompt path read the controls directly), and `ffc`'s two configuration
  documents from finding 61.

---

## Stage 7, part 1 — `think-or-say` stops reading its programme off the panel

The first of Stage 7's five items (`Fix think-or-say's DOM-as-state`), plus the
one-line-per-game re-dress that removing it turned up.

`state.cfg` is now the single normalized copy of this game's eleven programme
parameters, and the controls are a **view** of it: `applySettingsToControls()`
writes them, and `editSetting()` reads back exactly one — the control whose
`change` event just fired. Every runtime read moved with it: `buildDeck()`,
`revealChoices()`, `answerCorrect()`, `answerWrong()`, `doPrompt()`,
`scheduleAutoPrompt()`, `willRepresent()` and `syncPromptDelayEnabled()` all
read `state.cfg`, and no line of the game reads a control any more except the
one binding row that owns it.

### 69. The panel could not show four of the values the store could hold

All ten games declare the prompt delay as `int {min:1, max:10}` while the
select offered **1 / 2 / 3 / 4 / 5 / 10**. So 6, 7, 8 and 9 seconds were legal
to store and impossible to display: `select.value = 7` matches no `<option>`,
the browser resolves `.value` to `''`, and the control renders blank.

That is cosmetic in the nine games that keep their configuration in `state` —
the panel blanks, the programme still runs the stored delay. In `think-or-say`
it was not cosmetic, because the panel *was* the configuration:

- `scheduleAutoPrompt()` computed `parseInt('') * 1000` → `NaN`, and
  `setTimeout(fn, NaN)` fires immediately. A 7-second time delay became an
  **instant prompt** — the opposite of the prompt-fading procedure the setting
  exists to run.
- `saveSettings()` rebuilt the whole config from the panel on every edit, so
  the next unrelated toggle read that blank select and silently wrote the
  default 3 over the technician's 7.

The fix is **additive**, per hard constraint 1: the missing `6s`–`9s` options
were added to all ten selects rather than the declared range narrowed to the
six values the select happened to offer. Narrowing would have removed
configurability a technician already has, and 1-second granularity is what a
progressive time-delay procedure actually wants.

### 70. "Restored form control" is the realistic form of DOM-as-state

The refactor's observable difference is confined to controls that change
**without a `change` event** — which sounds exotic and is not: browsers restore
form-control state across a reload and a back-forward navigation. Under the old
code a checkbox that came back ticked over a stored configuration saying
otherwise was silently adopted as a programme change, both into the next deck
and into storage at the next unrelated edit.

Three tests pin it, each seeding the store and then ticking a checkbox with no
event: the deck is built from the configuration (29 non-tricky cards, not 32),
an unrelated real edit persists only the option that was edited, and a trial
runs errorless/reason behaviour off the configuration. `editSetting()` also
re-renders the panel from the config in force afterwards, so the stray control
is visibly put back rather than left contradicting the programme.

### 71. Two fixes for one failure mode need one test each

The instant-prompt bug needs *both* halves to be reachable — a value the select
cannot render AND a runtime that reads the select — so with the options added,
a mutation that puts `parseInt(el.selPromptDelay.value, 10)` back passes a test
that merely seeds 7 s. The auto-prompt test therefore does both: it asserts the
select shows `7` (the re-dress), then sets the select to `1` **without** an
event and asserts no prompt appears within 2 s (the refactor). One assertion per
fix, in one flow.

### Coverage

`tests/settings-store-adoption.spec.js` gained a 7th row test — the prompt-delay
select can show every value the store may hold, for all nine table games
(`emotions` names its own `delayOption`, since its `promptDelay` *is* the
seconds — finding 63) — and four `think-or-say` tests: the deck, the unrelated
edit, a trial's errorless/reason behaviour, and the auto-prompt delay.
`tests/game-settings.spec.js` carries the same renderability test for
`sequences`, which is the one game not in that table (and which renders its
panel on open, not on load).

Mutation-tested eight ways, each restored from a byte-compared copy: the added
options dropped from `think-or-say` (2 tests) and from `emotions` (1),
`editSetting()` re-reading the whole panel (1), the post-edit re-render removed
(1), and `scheduleAutoPrompt` (1), `buildDeck` (1), `errorless` (1) and
`showReason` (1) each put back on their control.

**Suite: 835 passed, 8 failed — all 8 in `glam-team-makeover.spec.js`**, at the
three test titles recorded as the accepted baseline. Zero new failures; the
suite grew 801 → 843. `APP_VERSION` 0.19.5 → 0.20.0 (minor: the panels gained
selectable values).

### Still owed for Stage 7

- Adopt `emotions`' `.option-toggle` pills and help-text discipline in the
  other games (the re-dress proper).
- Propagate `sequences`' three prompting-method radio cards (Most-to-Least /
  Least-to-Most / Time-Delay as presets over the existing primitives, Advanced
  overrides intact) to the eight games that expose only the primitives.
  `sequences/game.js:743-756` is the whole pattern: `METHOD_PRESETS` plus
  `applyMethodPreset()`, called only from the radio's own handler — never on
  load, which is what keeps a preset from overwriting a stored override.
- Collapse the three hand-rolled token boards onto `NooutcoTokens`
  (`market`, `matching` and `receptive` each carry their own copy of
  `generateVRSchedule`). Note the storage question this raises: the token
  options are declared fields of each game's `SETTINGS_FIELDS` today, while
  `NooutcoTokens` persists to its own `noaba.tokens.<ns>.v1` key — moving them
  without a fold would drop a technician's token configuration.
- Add trial-count / session-length and a configurable ITI. No game has either,
  so this is Stage 7's only purely additive item.
- Carried from Stage 6: `ffc`'s two configuration documents (finding 61), and
  the press-and-hold gating still adopted only in `sequences` (finding 47).
