/*
 * modes.mjs — the per-layer diff modes + the delivered-color output plan for
 * Milestone 1 (matches exactly what the shipped m1/m3 rigs reference).
 *
 * MODES is ported verbatim from the reference assets/art/_pipeline.js.txt (zones,
 * seed/grow thresholds preserved). The pipeline adds the §3 fixes on top; the
 * mode objects themselves are unchanged so the tuned parameters carry over.
 */

// feature helper
const F = (zone, seed, grow) => ({ kind: 'feature', zone, seed, grow });

export const MODES = {
  'skin-dull': { kind: 'wash' }, 'skin-clean': { kind: 'wash' }, 'glow': { kind: 'wash' },
  'brows-bushy':  F([0.15, 0.06, 0.85, 0.24], 40, 14),
  'brows-shaped': F([0.15, 0.06, 0.85, 0.24], 40, 14),
  'brow-pencil':  F([0.15, 0.06, 0.85, 0.24], 35, 12),
  'eyeliner':     F([0.12, 0.10, 0.88, 0.26], 38, 14),
  'mascara':      F([0.12, 0.10, 0.88, 0.26], 38, 14),
  'eyeshadow-violet': F([0.12, 0.08, 0.88, 0.26], 30, 12),
  'eyeshadow-bronze': F([0.12, 0.08, 0.88, 0.26], 30, 12),
  'contour':   F([0.02, 0.06, 0.98, 0.42], 30, 12),
  'highlight': F([0.05, 0.06, 0.95, 0.40], 26, 10),
  'blush-rose':  F([0.08, 0.18, 0.92, 0.38], 26, 10),
  'blush-peach': F([0.08, 0.18, 0.92, 0.38], 26, 10),
  'lip-liner':  F([0.28, 0.26, 0.72, 0.42], 30, 12),
  'lips-red':   F([0.28, 0.26, 0.72, 0.42], 35, 12),
  'lips-coral': F([0.28, 0.26, 0.72, 0.42], 35, 12),
  'lips-berry': F([0.28, 0.26, 0.72, 0.42], 35, 12),
  'hair-brunette': { kind: 'hair' }, 'hair-copper': { kind: 'hair' },
  'hair-berry': { kind: 'hair' }, 'hair-blonde': { kind: 'hair' },
};

// The 22 diffed layer keys, in z-order-ish processing order.
export const DIFF_KEYS = Object.keys(MODES);

// person:<key><suffix>.png  — the numeric suffix selects the model.
export const MODEL_SUFFIX = { m1: '', m2: ' 2', m3: ' 3', m4: ' 4' };
export const MODELS = ['m1', 'm2', 'm3', 'm4'];

// Shirt recolors — the 4 delivered outfit values (handoff step 6).
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const SHIRT_TINTS = {
  'shirt-gown':    hexRgb('#2f8f8a'),
  'shirt-dress':   hexRgb('#d6608a'),
  'shirt-casual':  hexRgb('#5477b0'),
  'shirt-sparkle': hexRgb('#c48fd0'),
};

// Ear composites — demo maps 💠→m3 stud (ear-a), ⭕→m4 stud (ear-b), 💎→m3 stud
// (ear-c). m1/m2 studs are SVG (deferred to M2); m3/m4 studs are PNG.
export const EAR_DESIGNS = [
  { out: 'ear-a', studModel: 'm3' },
  { out: 'ear-b', studModel: 'm4' },
  { out: 'ear-c', studModel: 'm3' },
];

// Per-model ear anchors {l,r,t} percent of the 520×600 frame. m1/m3 from the
// shipped rigs; m2/m4 estimated by eye (all models share the same frame recipe)
// — refined against base.png in the QA pass.
export const EAR_ANCHORS = {
  m1: { l: 22.5, r: 77.5, t: 39.5 },
  m2: { l: 24.0, r: 76.0, t: 39.0 },
  m3: { l: 26.2, r: 74.2, t: 38.5 },
  m4: { l: 25.0, r: 75.0, t: 39.0 },
};

// Per-model spot anchors (game-side placement; not used by processing). m1/m3
// from the shipped rigs; m2/m4 by-eye defaults, refined in QA.
export const SPOT_ANCHORS = {
  m1: [{ l: 38, t: 26 }, { l: 30, t: 50 }, { l: 62, t: 54 }],
  m2: [{ l: 41, t: 28 }, { l: 31, t: 47 }, { l: 48, t: 56 }],
  m3: [{ l: 40, t: 24 }, { l: 31, t: 46 }, { l: 63, t: 50 }],
  m4: [{ l: 41, t: 28 }, { l: 31, t: 47 }, { l: 48, t: 56 }],
};

// Optional per-model hair overrides (§3.3). Empty = use the reference default
// (inner-face rect [0.25,0.155,0.75,0.42], inside 60 / outside 18). Populated
// only if the QA pass shows the base buzz outline through a model's fringe.
export const HAIR_OVERRIDES = {
  // m2: { rect: [0.25, 0.15, 0.75, 0.42], inside: 60, outside: 18 },
};
