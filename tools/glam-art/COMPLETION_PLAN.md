# Glam Team Makeover — Honest Completion Plan

Goal: bring this game to parity with the other games at games.nooutco.me
(Red Carpet Convos is the bar). Written after confirming every defect below in
the running game — not from assumption.

## Honest status

The imported game is a **design-canvas prototype**, not a finished game. The
bones are good and worth keeping: the ABA turn-taking chain, the method/citation
grounding, the 4-model layered art system, and — after this session — correct
art registration, on-face spot placement, and a clean end-to-end turn loop.

But it was authored inside Claude Design's preview, where the **interaction
layer was never exercised as a real touch/mouse game**. My recent work fixed
*placement*; it did not touch *interaction* or *art coverage*. Those are the
defects you're feeling, and they're what make it read as "not complete / not
gamelike." This needs a focused completion pass across three fronts — not
another spot patch.

## Confirmed defects (each verified live)

1. **Tool hit-targets render behind the model.** The drag/tap target `<div>` has
   `z-index: auto` (=0) while the art layers use z 1–50 → the target sits *under*
   the face. This is both "the boxes don't always display" and "hit boxes appear
   behind the model." Depending on which art layer is on top, the target is
   invisible or unclickable.
2. **Drag highlights the image squares.** The art `<img>`s are `draggable:true`
   and the stage is `user-select:auto` / `touch-action:auto`, so a paint-drag
   fires native image-drag + selection instead of smooth painting.
3. **Overlays stop at the neck (color seam).** The pipeline's `wash` diff keeps
   pixels only *above 0.68×height*, which cuts the neck off. Washing lightens the
   face but not the neck → a visible tone seam at the jaw. (Same root for any
   full-skin layer: dull, clean, glow.)
4. **Not smooth / not gamelike.** The sum of (1)–(3) plus missing polish: no
   satisfying "step applied" feedback, abrupt phase changes, and a turn
   "string-together" that doesn't build momentum the way Red Carpet Convos does.

## The plan — three fronts

### Front A · Interaction layer — highest perceived-quality jump
- Raise the drag/tap/pop **target `z-index` above the whole art stack** (z:90) so
  targets are always visible and on top of the model.
- **Kill native drag/selection:** `draggable=false` on every art img,
  `user-select:none` + `touch-action:none` on the stage, keep `pointer-events:none`
  on art imgs so only the target catches the pointer.
- **Smooth the paint gesture:** tune the per-move coverage step, make the drag
  target visually invite the gesture, keep the live "painting… %" readable.
- Where: game template + `renderVals` target styles — via `build_index.mjs`
  patches (so they survive a re-import) plus a small game-local `style.css`.

### Front B · Art coverage & cleanliness — kill the neck seam AND the baked backdrops
Confirmed defects in the wash layers (composited on magenta, per layer):
- **M2 `skin-clean` has a baked-in transparency checkerboard** (lower-left face)
  — the master's checkerboard backdrop survived `stripBg` (interior pocket the
  border flood never reached / checker shades didn't match the border clusters),
  then the diff baked those opaque pixels in. M2 `skin-dull` is noisy and `glow`
  has a stray blob. (m3/m4 `glow` were flagged too and wrongly dismissed.)
- **Neck seam:** the wash keeps only pixels *above 0.68h*, cutting the neck off.

Fixes:
- **Robust background strip:** make `stripBg` remove checkerboard *and* solid
  backdrops fully — cluster BOTH checker shades, and after the border flood, do a
  second pass that clears interior low-saturation background pockets (region-grow
  from any detected-background pixel, not only border-connected). Validate the
  *raw stripped master* has a transparent background before diffing.
- **Wash region = skin mask, not a height cap:** replace the hard `0.68h` cap
  with `isSkin` contiguous coverage (face **+ neck**) down to the shirt line,
  excluding shirt/hair/features. Re-process `skin-dull / skin-clean / glow`
  (all 4 models).
- Where: `tools/glam-art/harness/pipeline.js` (`stripBg`) + `modes.mjs` (wash) +
  re-run `run_pipeline.mjs`.

**QA gate upgrade (this is the real miss):** the current gate counts non-skin px
and I under-weighted it. Add a hard **per-layer background-remnant check** — any
opaque, low-saturation pixel outside the character silhouette fails the layer —
and auto-render every layer on magenta into `out/` for eyeball review. No layer
ships with a background remnant again.

### Front C · Gamelike polish — parity bar = Red Carpet Convos
- **"Step applied" feedback:** the new layer pops/glows in (compositor-friendly
  transform/opacity); a token-earn flourish on hand-off.
- **Smooth phase transitions** (mine → theirs → ask → back) with short
  fades/slides; make the "ask for my turn" moment feel like a beat, not a jump.
- **Tune tool-budget vs. token goal** so a session always completes without
  running dry (today it *just* fits at 5 stars).
- Pass the games design bar: intentional hover/press states, spacing rhythm,
  motion that respects `prefers-reduced-motion`.

## Sequence & honest effort
1. **Front A (interaction)** — ~half a day. Fixes what makes it feel broken.
2. **Front B (neck seam / coverage)** — ~half a day (pipeline re-tune + re-process + QA).
3. **Front C (polish)** — ~1–2 days; open-ended, iterated against the RCC bar.

≈ 2–3 focused days to reach parity. Each front ends with a build you play and
sign off — I won't call it "done" again until you've run a full session and agree.

## Recommendation
**Complete it in place — do not rewrite.** The ABA logic, method grounding, art
pipeline, and 4 processed models are worth keeping; the gaps are interaction,
coverage, and polish — not architecture. The one standing cost is that this is
the only React/dc-runtime game (slightly heavier than the vanilla games), but
that's not worth a rewrite. Start with Front A, show a build, then B, then C.
