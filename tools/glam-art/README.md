# tools/glam-art - Glam Team Makeover art pipeline (build-time)

Turns the delivered character renders into the game-ready, pre-registered
520×600 transparent PNG layers that `apps/games/glam-team-makeover` composites.
**Not served** - only the processed PNGs under the game's `assets/art/person/`
are committed and shipped. Source of the contract: the Claude Design project
`ABA turn-taking makeup game` (`DESIGN_FILE_CLAUDE.md` §1-6, `PIPELINE_HANDOFF_CLAUDE.md`).

## Layout

- `harness/pipeline.js` - browser Canvas2D pipeline. Faithful port of the design
  project's reference `_pipeline.js.txt` (`stripBg → alignTo → diffLayer →
  exportFrame`, tuned `MODES` preserved) **plus the DESIGN_FILE §3 fixes** the
  reference lacked:
  - **§3.1 hard post-clip** - feature layers zero α outside `zone+8px` after
    hysteresis, then feather (kills feather-bleed / lighting-drift blobs).
  - **§3.2 wash carve** (`WASH_SUBTRACT_MODE='color'`) - inside the brow/eye/lip
    rects, drop only *non-skin* pixels (baked recolor spill) while keeping clean
    skin coverage. The naive rect-subtract left a visible band; the color-aware
    carve does not.
  - **§3.3 hair config** - inner-face rect + thresholds are per-model tunable
    (`HAIR_OVERRIDES`); default = the reference m1/m3 values.
- `harness/frame.mjs` (+ `.test.mjs`) - the `bbox → 520×600 frame` formula,
  reverse-engineered from and unit-tested against the shipped m1/m3 metas.
- `harness/modes.mjs` - per-layer diff modes, the delivered output plan, shirt
  tints, ear designs, per-model anchors.
- `run_pipeline.mjs` - Playwright driver: masters → in-page pipeline → writes
  `apps/games/glam-team-makeover/assets/art/person/<model>/*.png` + `_meta.json`.
- `qa.mjs` - DESIGN_FILE §4 QA gate: per-layer zone-containment, wash carve
  check, and the full-stack `_qa-fullstack.png` composite per model.
- `diag.mjs` - composite base + named layers over grey for eyeballing one layer.
- `masters/` - symlink to the uncompressed masters (gitignored, ~117 MB).

## Run

```bash
cd tools/glam-art && npm install          # playwright (browsers already cached)
node run_pipeline.mjs                      # all 4 models  (add m1 m3 … for a subset)
node qa.mjs                                # QA gate + composites
node --test harness/frame.test.mjs         # frame-formula unit test
node build_index.mjs                       # re-house the game HTML (rarely needed)
```

Masters live at `~/Desktop/MakeoverGame_Resources` (`person:<key><suffix>.png`;
suffix = model: ""→m1, " 2"→m2, " 3"→m3, " 4"→m4). Re-point the `masters`
symlink if they move.

## Scope

Milestone 1 = delivered colors, all 4 models (matches the shipped m1/m3 rig set:
diffed layers + 4 shirt recolors + 3 ear composites). Deferred to M2: full
recolor matrices (hair 7×8, makeup, shirts ×8), rasterized ear designs, heart
patch, sprite-atlas packaging, and the pending game-UI features.
