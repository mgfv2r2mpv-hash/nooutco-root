# NOTES-gnhf — games stimulus pipeline / clinical settings unification

Working notes and blockers for the run. Baseline revision: `origin/main` =
`7d083751`.

---

## BLOCKER (pre-existing, out-of-scope game): `tests/glam-team-makeover.spec.js`

**Status:** 8 failures across chromium/firefox/webkit. **Present at `origin/main`
before any change in this run** — reproduce with `git stash && npm test`.
Identical under a plain static server and under real `wrangler pages dev`, so
this is not a server-mode artefact.

This blocks the run's stop condition (`npm test` passes on all three browsers)
even though Glam Team Makeover is one of the three games this run must never
modify.

**The spec is stale, not flaky.** All three failures are the test drifting from
the shipped app, and every fix lives in `tests/` — `glam-team-makeover/` itself
must not be touched:

| Test | Why it fails |
|---|---|
| `intro screen mounts (runtime boots)` | Asserts zero console errors, but the vendored dc-runtime paints `<path d="{{ V.capePath }}">` before template bindings resolve, so the browser logs `Expected moveto path command`. Timing-dependent, which is why it intermittently passed. |
| `all four models load their base art` | Expects `assets/art/person/m1/base.png`. `assets/art-generated.js` now serves the combo-base layout at `assets/art/person/m1/base/base.png`. |
| `applying a step composites a delivered layer` | Waits for a `Brunette` button. The current tool rail exposes `Wash`, `Shape brows`, `Brow pencil` — there is no `Brunette` control. |

**Evidence** (chromium, `--workers=1`, warm server):

```
Error: console/page errors: Error: <path> attribute d: Expected moveto path command
  ('M' or 'm'), "{{ V.capePath }}". | ... "{{ V.garmentPath…" | "{{ V.contourPath…"
Error: element(s) not found - waiting for locator('img[src*="assets/art/person/m1/base.png"]')
Error: locator.click: Test timeout - waiting for getByRole('button', { name: /Brunette/ })
3 failed, 1 passed
```

Verified by direct probe that the game itself is healthy: after clicking Play the
page renders `M1 M2 M3 M4`, `Wash`, `Shape brows`, `Brow pencil`,
`▸ Go — my turn!`, all visible and hit-testable. The app is fine; the assertions
are out of date.

**Proposed fix (a later iteration, tests-only):** retarget the art assertion at
`base/base.png`, retarget the tool assertion at a control that exists, and scope
the console-error assertion to exclude the vendored runtime's pre-binding
`<path d>` warnings.

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
