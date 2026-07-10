/* ─────────────────────────────────────────────────────────────────────────
   Glam Team Makeover — ART MANIFEST  (window.NooutcoArt)   v0.4 · demo wired
   ---------------------------------------------------------------------------
   V1 = PERSON ONLY. m1 + m3 are LIVE (processed in-project by the browser
   pipeline — see assets/art/_pipeline.js.txt and PIPELINE_HANDOFF_CLAUDE.md).
   m2 + m4 slots are ready and empty (placeholders show until processed).

   Blemish flow: heart patch swaps out the spot; concealer removes the patch
   (no popping). Patch asset + full recolor matrices are Claude-Code work —
   this demo wires the delivered colors only.

   Game contract (read by Glam Team Makeover.dc.html):
     bases.person.src / .flaws{dull,spot,browsBushy}
     layers.person[slot].z + .src or .variants[key]
       hair keyed by game color hex · shadow/blush/lips by shade hex ·
       ear by glyph 💠⭕💎 · outfit by value gown/dress/casual/sparkle
     meta.spotAnchors.person = [{l,t}×3]  (percent)
   The model picker in the game calls setArtModel-style repointing on
   meta.models[id] — keep every rig complete.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  const PALETTES = {
    hair:   ['#2b2b2e', '#5b4636', '#b5651d', '#8b5cf6', '#e0b064', '#c7cdd6', '#e5533b', '#2a6fdb'],
    shadow: ['#a06cc9', '#b5793f', '#3aa39c', '#d98ca6', '#6fa8dc', '#c9a227'],
    blush:  ['#f28ba0', '#f6a37a', '#c96a8d', '#d99a6c'],
    lips:   ['#d64b6a', '#e07a5f', '#a83f6b', '#e88bb1', '#c98d7a', '#7d4a6e'],
    outfit: ['#3aa39c', '#d4728f', '#4f8fd0', '#c9a227', '#9b8cc9', '#7fbf9e', '#e07a5f', '#5a6572'],
    stone:  ['#3b5bd0', '#c0392b', '#1f8a5b', '#8b5cf6', '#e8a0b8', '#2b2b2e'],
    metal:  ['#c9a227', '#c7cdd6', '#d4938a'],
  };
  const HAIR_STYLES = ['brunette', 'copper', 'berry', 'blonde', 'silver', 'flame', 'heroblue'];

  const rig = (dir, spotAnchors, earAnchors) => ({
    base: dir + 'base.png',
    flaws: { dull: dir + 'skin-dull.png', spot: dir + 'spot.png', browsBushy: dir + 'brows-bushy.png' },
    layers: {
      outfit:   { z: 3,  variants: { gown: dir + 'shirt-gown.png', dress: dir + 'shirt-dress.png', casual: dir + 'shirt-casual.png', sparkle: dir + 'shirt-sparkle.png' } },
      wash:     { z: 5,  src: dir + 'skin-clean.png' },
      moist:    { z: 6,  src: dir + 'glow.png' },
      hair:     { z: 10, variants: { '#5b4636': dir + 'hair-brunette.png', '#b5651d': dir + 'hair-copper.png', '#8b5cf6': dir + 'hair-berry.png', '#e0b064': dir + 'hair-blonde.png' } },
      brows:    { z: 20, src: dir + 'brows-shaped.png' },
      pencil:   { z: 21, src: dir + 'brow-pencil.png' },
      shadow:   { z: 30, variants: { '#a06cc9': dir + 'eyeshadow-violet.png', '#b5793f': dir + 'eyeshadow-bronze.png' } },
      liner:    { z: 31, src: dir + 'eyeliner.png' },
      mascara:  { z: 32, src: dir + 'mascara.png' },
      contour:  { z: 34, src: dir + 'contour.png' },
      hl:       { z: 35, src: dir + 'highlight.png' },
      blush:    { z: 37, variants: { '#f28ba0': dir + 'blush-rose.png', '#f6a37a': dir + 'blush-peach.png' } },
      lipliner: { z: 40, src: dir + 'lip-liner.png' },
      lips:     { z: 41, variants: { '#d64b6a': dir + 'lips-red.png', '#e07a5f': dir + 'lips-coral.png', '#a83f6b': dir + 'lips-berry.png' } },
      ear:      { z: 50, variants: { '💠': dir + 'ear-a.png', '⭕': dir + 'ear-b.png', '💎': dir + 'ear-c.png' } },
    },
    spotAnchors, earAnchors,
  });

  const MODELS = {
    m1: rig('assets/art/person/m1/', [{ l: 38, t: 26 }, { l: 30, t: 50 }, { l: 62, t: 54 }], { l: 22.5, r: 77.5, t: 39.5 }),
    m2: rig('assets/art/person/m2/', [{ l: 41, t: 28 }, { l: 31, t: 47 }, { l: 48, t: 56 }], { l: 24.0, r: 76.0, t: 39.0 }),
    m3: rig('assets/art/person/m3/', [{ l: 40, t: 24 }, { l: 31, t: 46 }, { l: 63, t: 50 }], { l: 26.2, r: 74.2, t: 38.5 }),
    m4: rig('assets/art/person/m4/', [{ l: 41, t: 28 }, { l: 31, t: 47 }, { l: 48, t: 56 }], { l: 25.0, r: 75.0, t: 39.0 }),
  };

  const ACTIVE_MODEL = 'm1';
  const active = MODELS[ACTIVE_MODEL];

  window.NooutcoArt = {
    meta: {
      version: '0.5.0-m1-m4',
      updated: '2026-07-09',
      scope: 'person-only: all 4 models live, delivered colors. Recolor matrices → M2.',
      canvas: { person: { w: 320, h: 360, viewBox: '0 0 260 300' } },
      spotAnchors: { person: active.spotAnchors },
      palettes: PALETTES,
      hairStyles: HAIR_STYLES,
      models: MODELS,
      activeModel: ACTIVE_MODEL,
      sourcesDir: 'assets/art/src',
      outputDir: 'assets/art/person',
      gaps: ['recolor matrices pending (M2)', 'ears use shared m3/m4 studs (m1/m2 svgs → M2)', 'heart patch pending (M2)'],
    },
    scene: { social: { bg: '', frame: '' } },
    bases: { person: { src: active.base, flaws: active.flaws } },
    layers: { person: active.layers },
    icons: {
      wash: '', patch: '', conceal: '', brows: '', moist: '',
      pencil: '', liner: '', mascara: '', contour: '', hl: '',
      ear1: '', ear2: '', ear3: '', of1: '', of2: '', of3: '', of4: '',
    },
    later: { superhero: 'v2', pet: 'v2' },
  };
})();
