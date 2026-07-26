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

### Still owed for Stage 2

1. Repoint clock, receptive and matching at `/shared/stimuli/stimuli.json`.
   Each game must keep its own category list — matching's `T_lowercase` /
   `T_numbers` / `T_pbs_characters` appearing in receptive's topic dropdown
   would be a behaviour change, not a merge.
2. Teach the three games to render `emoji` + `glyphKind` when `image` is null
   (`glyphKind: 'text'` wants a bold sans face, `'emoji'` the emoji stack).
3. Only then, as its own revertible commit, delete the duplicated trees —
   checking every key in `provenance.json` first.
