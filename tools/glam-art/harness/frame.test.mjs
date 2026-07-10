/*
 * TDD: the bbox → export-frame formula.
 *
 * The reference pipeline (_pipeline.js.txt) consumes a per-model `frame` but does
 * not show how it's derived from the base's character bbox. We reverse-engineered
 * it from the two shipped metas (m1, m3); these goldens lock the formula so the
 * new models (m2, m4) register into the identical 520×600 frame.
 *
 * Run: node --test tools/glam-art/harness/frame.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bboxToFrame, OUT_W, OUT_H } from './frame.mjs';

// Shipped goldens pulled from assets/art/person/m{1,3}/_meta.json
const GOLDENS = [
  { id: 'm1', bbox: { x: 91, y: 102, w: 714, h: 1050 }, frame: { x: -25, y: 81, w: 946, h: 1092 } },
  { id: 'm3', bbox: { x: 12, y: 17, w: 881, h: 1199 }, frame: { x: -88, y: -7, w: 1081, h: 1247 } },
];

test('output dimensions are 520×600', () => {
  assert.equal(OUT_W, 520);
  assert.equal(OUT_H, 600);
});

for (const g of GOLDENS) {
  test(`bboxToFrame reproduces the shipped ${g.id} frame exactly`, () => {
    assert.deepEqual(bboxToFrame(g.bbox), g.frame);
  });

  test(`${g.id} frame preserves the 520:600 output aspect (±1px)`, () => {
    const f = bboxToFrame(g.bbox);
    const expectW = Math.round(f.h * (OUT_W / OUT_H));
    assert.ok(Math.abs(f.w - expectW) <= 1, `frame.w ${f.w} vs aspect-derived ${expectW}`);
  });

  test(`${g.id} frame fully contains the character bbox`, () => {
    const f = bboxToFrame(g.bbox);
    assert.ok(f.x <= g.bbox.x, 'left edge covers bbox');
    assert.ok(f.y <= g.bbox.y, 'top edge covers bbox');
    assert.ok(f.x + f.w >= g.bbox.x + g.bbox.w, 'right edge covers bbox');
    assert.ok(f.y + f.h >= g.bbox.y + g.bbox.h, 'bottom edge covers bbox');
  });

  test(`${g.id} frame is horizontally centered on the character (±1px)`, () => {
    const f = bboxToFrame(g.bbox);
    const bboxCx = g.bbox.x + g.bbox.w / 2;
    const frameCx = f.x + f.w / 2;
    assert.ok(Math.abs(bboxCx - frameCx) <= 1, `bboxCx ${bboxCx} vs frameCx ${frameCx}`);
  });
}
