/*
 * modes.mjs - the per-layer diff modes + the delivered-color output plan for
 * Milestone 1 (matches exactly what the shipped m1/m3 rigs reference).
 *
 * MODES follows the reference assets/art/_pipeline.js.txt (dmax seed/grow
 * thresholds preserved; zones re-tuned to the measured faces). On top of the
 * reference each feature carries a `prune` spec - geometry cleanup (thin-stroke
 * component pruning) that replaces color heuristics entirely. Washes keep their
 * verified signature gates. See the plan: geometry-based extraction.
 */

// feature helper: zoneE + hysteresis seed/grow on the RAW dmax diff (reference-
// tuned scale - these captured features faithfully, colors and outlines intact),
// plus `prune` = the geometry cleanup that replaces all color heuristics:
// a component must survive `coreR` erosions somewhere (thin-everywhere ghost
// strokes die) and cover ≥ minArea px. BLOB for solid features; STROKE for
// layers that ARE thin lines (liner/mascara/pencils), where only whisker-level
// noise can be pruned and the tight zone does the rest.
//
// zoneE = [x0, dy0, x1, dy1]: x as bbox fractions; y as offsets from the
// model's MEASURED eye-line (pipeline detectEyeLine). The probe proved fixed
// fractions sit 0.10-0.15 above the real anatomy on this bbox convention
// (the old "lips" zone missed the lips entirely; "brows" caught the hairline).
const F = (zoneE, seed, grow, prune) => ({ kind: 'feature', zoneE, seed, grow, prune });
const BLOB = { coreR: 3, minArea: 60 };
const STROKE = { coreR: 1, minArea: 30 };
// liner/mascara/lip-liner are ≤6px strokes - any component with a ≥7px-thick
// core is an iris/sclera ghost blob, not the feature (inverse of BLOB).
const THIN_STROKE = { coreR: 1, minArea: 30, maxCoreR: 3 };

export const MODES = {
  // NOTE: skin-dull, glow, blush-*, eyeshadow-* are NO LONGER extracted - they
  // are rendered procedurally in-game (soft color/luminance over skin regions),
  // positioned from per-model `face` anchors. See the plan (procedural pivot).

  // skin-clean = base-skin region × any-change (pipeline.js): solid face+neck
  // wash that self-carves lips/eyes/brows (not base-skin), can't touch shirt or
  // backdrop. closing + reconstruct + sweep clean the residue.
  'skin-clean': { kind: 'wash', seed: 10, prune: { coreR: 2, geo: 24, minArea: 200 } },
  // brows diff thin (the base already has brows; the delta is arc edges) → STROKE
  'brows-bushy':  F([0.15, -0.075, 0.85, -0.008], 40, 14, STROKE),
  'brows-shaped': F([0.15, -0.075, 0.85, -0.008], 40, 14, STROKE),
  'brow-pencil':  F([0.15, -0.075, 0.85, -0.008], 35, 12, STROKE),
  'eyeliner':     F([0.12, -0.035, 0.88, 0.028], 38, 14, THIN_STROKE),
  'mascara':      F([0.12, -0.035, 0.88, 0.028], 38, 14, THIN_STROKE),
  // contour keeps the 'dull' skin-darkening gate (cleared its audit).
  'contour':   { kind: 'feature', zoneE: [0.02, -0.05, 0.98, 0.17], seed: 20, grow: 11, gate: 'dull', prune: BLOB, softAlpha: 55 },
  // highlight = lighter SKIN sheen - the 'lighten' gate rejects the light ghost
  // rings around eyes/nose that plain dmax kept (proof-sheet evidence).
  'highlight': { kind: 'feature', zoneE: [0.05, -0.045, 0.95, 0.13], seed: 16, grow: 8, gate: 'lighten', prune: BLOB, softAlpha: 50 },
  'lip-liner':  F([0.28, 0.085, 0.72, 0.195], 30, 12, THIN_STROKE),
  'lips-red':   F([0.28, 0.085, 0.72, 0.195], 35, 12, BLOB),
  'lips-coral': F([0.28, 0.085, 0.72, 0.195], 35, 12, BLOB),
  'lips-berry': F([0.28, 0.085, 0.72, 0.195], 35, 12, BLOB),
  // hair: reference dmax diff + core-reconstruction + capped hole-fill
  // (pipeline.js); face rect is eye-anchored via DEFAULT_HAIR.rectE.
  'hair-brunette': { kind: 'hair' }, 'hair-copper': { kind: 'hair' },
  'hair-berry': { kind: 'hair' }, 'hair-blonde': { kind: 'hair' },
};

// The 22 diffed layer keys, in z-order-ish processing order.
export const DIFF_KEYS = Object.keys(MODES);

// person:<key><suffix>.png - the numeric suffix selects the model.
export const MODEL_SUFFIX = { m1: '', m2: ' 2', m3: ' 3', m4: ' 4' };
export const MODELS = ['m1', 'm2', 'm3', 'm4'];

// Shirt recolors - the 4 delivered outfit values (handoff step 6).
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const SHIRT_TINTS = {
  'shirt-gown':    hexRgb('#2f8f8a'),
  'shirt-dress':   hexRgb('#d6608a'),
  'shirt-casual':  hexRgb('#5477b0'),
  'shirt-sparkle': hexRgb('#c48fd0'),
};

// Ear composites - demo maps 💠→m3 stud (ear-a), ⭕→m4 stud (ear-b), 💎→m3 stud
// (ear-c). m1/m2 studs are SVG (deferred to M2); m3/m4 studs are PNG.
export const EAR_DESIGNS = [
  { out: 'ear-a', studModel: 'm3' },
  { out: 'ear-b', studModel: 'm4' },
  { out: 'ear-c', studModel: 'm3' },
];

// Per-model ear anchors {l,r,t} percent of the 520×600 frame. m1/m3 from the
// shipped rigs; m2/m4 estimated by eye (all models share the same frame recipe)
// - refined against base.png in the QA pass.
export const EAR_ANCHORS = {
  m1: { l: 22.5, r: 77.5, t: 39.5 },
  m2: { l: 24.0, r: 76.0, t: 39.0 },
  m3: { l: 26.2, r: 74.2, t: 38.5 },
  m4: { l: 25.0, r: 75.0, t: 39.0 },
};

// Per-model spot anchors (game-side placement; not used by processing). m1/m3
// from the shipped rigs; m2/m4 by-eye defaults, refined in QA.
// 3 pimples (forehead + two cheeks), top-left of a 12% sprite, from each model's
// measured eye-line (measure_faces.mjs). Kept in sync with art-manifest.js.
export const SPOT_ANCHORS = {
  m1: [{ l: 44, t: 21 }, { l: 30, t: 45 }, { l: 58, t: 45 }],
  m2: [{ l: 44, t: 19 }, { l: 30, t: 43 }, { l: 58, t: 43 }],
  m3: [{ l: 44, t: 17 }, { l: 30, t: 41 }, { l: 58, t: 41 }],
  m4: [{ l: 44, t: 18 }, { l: 30, t: 42 }, { l: 58, t: 42 }],
};

// Optional per-model hair overrides (§3.3). Empty = use the reference default
// (inner-face rect [0.25,0.155,0.75,0.42], inside 60 / outside 18). Populated
// only if the QA pass shows the base buzz outline through a model's fringe.
export const HAIR_OVERRIDES = {
  // m2: { rect: [0.25, 0.15, 0.75, 0.42], inside: 60, outside: 18 },
};
