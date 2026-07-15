/*
 * frame.mjs — the bbox → export-frame formula for Glam Team Makeover layers.
 *
 * Single source of truth (shared by the Playwright driver and the QA gate) for
 * how a model's shared 520×600 crop frame is derived from the base character
 * bbox (the tight opaque-pixel box returned by stripBg, in source-render space).
 *
 * Reverse-engineered from and verified against the two shipped metas
 * (assets/art/person/m{1,3}/_meta.json) — see frame.test.mjs.
 *
 *   padY   = round(bbox.h × 0.02)      2% vertical breathing room, each side
 *   frameH = bbox.h + 2·padY
 *   frameW = round(frameH × 520/600)   lock to the output aspect ratio
 *   frameX = round(bboxCenterX − frameW/2)   center horizontally on the character
 *   frameY = bbox.y − padY
 *
 * Every processed layer is cropped to this same frame, so all layers register
 * against the base with no per-layer offsets.
 */

export const OUT_W = 520;
export const OUT_H = 600;
export const VPAD = 0.02; // vertical padding as a fraction of bbox height, each side

/**
 * @param {{x:number,y:number,w:number,h:number}} bbox character bbox in source space
 * @returns {{x:number,y:number,w:number,h:number}} the 520:600-aspect crop frame
 */
export function bboxToFrame(bbox) {
  const padY = Math.round(bbox.h * VPAD);
  const h = bbox.h + 2 * padY;
  const w = Math.round(h * (OUT_W / OUT_H));
  const x = Math.round(bbox.x + bbox.w / 2 - w / 2);
  const y = bbox.y - padY;
  return { x, y, w, h };
}
