// node --test tools/glam-art/harness/brow_finish.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finishBrowRemoval, findBrowKeys, bandOf } from './brow_finish.mjs';
import { decodePng, encodePng } from './png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PERSON = path.resolve(HERE, '../../../apps/games/glam-team-makeover/assets/art/person');

/* A 200x100 face: warm skin, hair down the left edge, a brow key (x 50-80,
   y 30-40) above an eye key (x 50-80, y 55-70) on the left half. */
const W = 200, H = 100;
const SKIN = [200, 150, 130];
const FACE = { eyeL: { x: 0.325, y: 0.62, w: 0.15, h: 0.10 }, eyeR: { x: 0.675, y: 0.62, w: 0.15, h: 0.10 } };

function scene() {
  const base = new Uint8Array(W * H * 4), mask = new Uint8Array(W * H * 3);
  const px = (x, y, rgb) => { const i = (y * W + x) * 4; base[i] = rgb[0]; base[i + 1] = rgb[1]; base[i + 2] = rgb[2]; base[i + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px(x, y, SKIN);
  for (let y = 0; y < H; y++) for (let x = 0; x < 10; x++) { mask[(y * W + x) * 3] = 255; px(x, y, [60, 40, 30]); }
  for (let y = 30; y <= 40; y++) for (let x = 50; x <= 80; x++) mask[(y * W + x) * 3 + 2] = 255;
  for (let y = 55; y <= 70; y++) for (let x = 50; x <= 80; x++) mask[(y * W + x) * 3 + 2] = 255;
  // the ghost: a faint 2px line outboard of the brow key, running to the temple
  for (let x = 30; x <= 49; x++) for (const y of [33, 34]) px(x, y, SKIN.map((v) => v - 12));
  // real line art: a strong dark stroke in the band, which must survive
  for (let x = 32; x <= 46; x++) px(x, 46, [70, 50, 45]);
  // a cel-shading step: lighter skin right of x=60 above the key
  for (let y = 12; y <= 26; y++) for (let x = 60; x <= 66; x++) px(x, y, [222, 172, 152]);
  // something dark inside the EYE key, which must survive
  px(60, 60, [150, 100, 90]);
  return { base, mask };
}

const at = (d, x, y) => Array.from(d.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));

test('finds the brow key, not the eye key below it', () => {
  const { mask } = scene();
  const keys = findBrowKeys(mask, W, H, 3, FACE);
  assert.equal(keys.length, 1);
  assert.deepEqual([keys[0].x0, keys[0].x1, keys[0].y0, keys[0].y1], [50, 80, 30, 40]);
  const band = bandOf(keys[0], W, H);
  assert.ok(band.x0 < 30 && band.x1 < 80, 'the band reaches outboard (toward the temple) further than inboard');
});

test('removes the faint ghost line outboard of the key', () => {
  const { base, mask } = scene();
  const { data, changed } = finishBrowRemoval(base, mask, W, H, 3, FACE);
  assert.ok(changed > 0);
  for (let x = 30; x <= 49; x++) for (const y of [33, 34]) {
    const p = at(data, x, y);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(p[c] - SKIN[c]) <= 2, `(${x},${y}) back to skin, got ${p}`);
  }
});

test('leaves line art, hair, the eye key, the step edge and alpha alone', () => {
  const { base, mask } = scene();
  const { data } = finishBrowRemoval(base, mask, W, H, 3, FACE);
  for (let x = 32; x <= 46; x++) assert.deepEqual(at(data, x, 46), at(base, x, 46), 'strong stroke kept');
  for (let y = 0; y < H; y++) for (let x = 0; x < 10; x++) assert.deepEqual(at(data, x, y), at(base, x, y), 'hair kept');
  assert.deepEqual(at(data, 60, 60), at(base, 60, 60), 'eye key kept');
  for (let y = 12; y <= 26; y++) for (let x = 56; x <= 70; x++) assert.deepEqual(at(data, x, y), at(base, x, y), 'step edge kept');
  for (let k = 0; k < W * H; k++) assert.equal(data[k * 4 + 3], base[k * 4 + 3], 'alpha untouched');
});

test('changes nothing outside the band and never mutates its input', () => {
  const { base, mask } = scene();
  const before = Uint8Array.from(base);
  const { data, bands } = finishBrowRemoval(base, mask, W, H, 3, FACE);
  assert.deepEqual(base, before, 'input untouched');
  const b = bands[0].band;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) continue;
    assert.deepEqual(at(data, x, y), at(base, x, y));
  }
});

test('a second run has nothing left to do', () => {
  const { base, mask } = scene();
  const once = finishBrowRemoval(base, mask, W, H, 3, FACE).data;
  const twice = finishBrowRemoval(once, mask, W, H, 3, FACE);
  assert.equal(twice.changed, 0);
});

test('a render with no ghost is returned byte-identical', () => {
  const { mask } = scene();
  const clean = new Uint8Array(W * H * 4);
  for (let k = 0; k < W * H; k++) { clean.set([...SKIN, 255], k * 4); }
  const { data, changed } = finishBrowRemoval(clean, mask, W, H, 3, FACE);
  assert.equal(changed, 0);
  assert.deepEqual(data, clean);
});

test('png codec round-trips a shipped RGBA render and RGB mask exactly', () => {
  for (const f of ['m2/base/base.png', 'm2/base/mask.png']) {
    const a = decodePng(fs.readFileSync(path.join(PERSON, f)));
    const b = decodePng(encodePng(a));
    assert.equal(b.width, a.width);
    assert.equal(b.channels, a.channels);
    assert.deepEqual(b.data, a.data, `${f} samples identical after re-encode`);
  }
});
