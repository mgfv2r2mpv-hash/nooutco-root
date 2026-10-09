/*
 * brow_finish.mjs - finish the base render's brow removal past the mask key (issue #41).
 *
 * What was measured: every shipped base render had its original brow skin-filled
 * at build time, inside the mask's eyes+brows key (blue channel). The brow half
 * of that key is the brow shape CLIPPED BY A RECTANGLE: on every model and side
 * its inner and outer ends are straight vertical edges (m2 left: x=152 on 14
 * rows, x=225 on 26). The brow runs past the rectangle's outer side, so its faint
 * upper outline survives as a thin arc on the temple skin outboard of the key,
 * running toward the hairline, and along the key's own top rows. That arc is the
 * "pixel noise between outer tail of eyebrows and temple/hairline" reported.
 *
 * What this does: inside a band around each brow key, on skin only, it
 * estimates the clean skin each pixel should be as the MEDIAN of the skin around
 * it (a window wider than the ghost line is thick), and where a pixel is darker
 * than that estimate it is pulled back to it. A median removes a thin line yet
 * keeps a straight step edge where it is, so the cel-shaded hairline highlight
 * and the forehead's shading survive, where one flat median tone for the whole
 * band (the game's `_browClean`) cannot keep them.
 *
 * What it will not touch, by construction:
 *   - the eye key, or any key pixel outside the brow key's own box;
 *   - hair, or skin within `hairGap` px of hair (the hairline's anti-aliasing);
 *   - strong lines: a pixel darker than `faint` x its estimate is real line art
 *     (ear and hairline outlines), not a ghost;
 *   - wide shading: a dark stripe without clean skin within `thin` px on both
 *     sides (the shadow hair casts along the hairline) is art, not a ghost;
 *   - anything outside the band, so eyes, lids, nose and ears are out of reach.
 * It only ever moves a pixel toward lighter skin, and a second run changes next
 * to nothing (the line is gone, so the median finds nothing darker).
 */

/* Mask cutoffs (fractions of 255), the same ones the game's compositor uses. */
export const MASK = { key: 0.12, hair: 0.10 };
export const BROW_FINISH = {
  /* Band around the brow key, in key-blob widths/heights. The tail side gets
     the long reach; the band also climbs above the key for the outline. */
  outboard: 0.75, inboard: 0.55, above: 0.70, below: 0.55,
  /* Median window radius (px). The ghost arc is up to ~6 px wide, so 7 gives a
     15x15 window in which clean skin is always the majority. */
  radius: 7,
  /* Darkness (luminance units under the estimate) where the repair starts, and
     where it is total; in between it blends linearly. */
  start: 1.5, full: 5,
  /* A pixel darker than FAINT x its estimate is line art and is kept. */
  faint: 0.62,
  /* A ghost is THIN: along some axis, clean skin lies within this many px on
     BOTH sides. A wider dark stripe (the shadow hair casts on the skin along the
     hairline) has hair on one side and is kept. */
  thin: 4,
  /* Skin closer than this to hair is the hairline's own edge and is kept. */
  hairGap: 2,
  /* Repair passes; each one re-reads the previous result, so the arc's own
     anti-aliased fringe is taken by the second. */
  passes: 3,
};

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** Connected components (4-neighbour) of `on`, within x in [x0, x1). */
function components(on, W, H, x0, x1) {
  const label = new Int32Array(W * H);
  const out = [];
  for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) {
    const k0 = y * W + x;
    if (!on[k0] || label[k0]) continue;
    const c = { n: 0, sy: 0, x0: x, x1: x, y0: y, y1: y };
    label[k0] = out.length + 1;
    const stack = [k0];
    while (stack.length) {
      const k = stack.pop(), kx = k % W, ky = (k / W) | 0;
      c.n++; c.sy += ky;
      if (kx < c.x0) c.x0 = kx; if (kx > c.x1) c.x1 = kx;
      if (ky < c.y0) c.y0 = ky; if (ky > c.y1) c.y1 = ky;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = kx + dx, ny = ky + dy;
        if (nx < x0 || nx >= x1 || ny < 0 || ny >= H) continue;
        const n = ny * W + nx;
        if (on[n] && !label[n]) { label[n] = out.length + 1; stack.push(n); }
      }
    }
    out.push(c);
  }
  return out;
}

/* Rows the brow key may occupy, in eye heights above the eye anchor. Some hair
   styles' masks join the brow key to the eye key or to a strip along the
   hairline, so the blob is looked for only in this window. */
export const BROW_ROWS = { from: 3.2, to: 1.15 };

/**
 * The brow key blob on each side: the largest key component inside the rows
 * above that side's eye anchor. `face` is the style's {eyeL, eyeR} anchors from
 * art-generated.js, as frame fractions.
 */
export function findBrowKeys(mask, W, H, mch, face) {
  const sides = [];
  for (const [side, eye, out] of [['L', face.eyeL, -1], ['R', face.eyeR, 1]]) {
    const ey = eye.y * H, eh = eye.h * H;
    const r0 = Math.max(0, Math.floor(ey - BROW_ROWS.from * eh)), r1 = Math.min(H - 1, Math.ceil(ey - BROW_ROWS.to * eh));
    const on = new Uint8Array(W * H);
    const x0 = side === 'L' ? 0 : W >> 1, x1 = side === 'L' ? W >> 1 : W;
    for (let y = r0; y <= r1; y++) for (let x = x0; x < x1; x++) {
      const k = y * W + x;
      on[k] = mask[k * mch + 2] / 255 > MASK.key ? 1 : 0;
    }
    const big = components(on, W, H, x0, x1).sort((a, b) => b.n - a.n)[0];
    if (big) sides.push({ side, out, x0: big.x0, x1: big.x1, y0: big.y0, y1: big.y1 });
  }
  return sides;
}

/** Band rectangle around one brow key, biased toward the tail (outboard). */
export function bandOf(k, W, H, P = BROW_FINISH) {
  const w = k.x1 - k.x0 + 1, h = k.y1 - k.y0 + 1;
  const lo = k.out < 0 ? k.x0 - P.outboard * w : k.x0 + (1 - P.inboard) * w;
  const hi = k.out < 0 ? k.x1 - (1 - P.inboard) * w : k.x1 + P.outboard * w;
  return {
    x0: Math.max(0, Math.floor(lo)), x1: Math.min(W - 1, Math.ceil(hi)),
    y0: Math.max(0, Math.floor(k.y0 - P.above * h)), y1: Math.min(H - 1, Math.ceil(k.y1 + P.below * h)),
  };
}

const median = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
const AXES = [[1, 0], [0, 1], [1, 1], [1, -1]];

/** True when clean skin (luminance at least `clean`) lies within `reach` px on
    both sides of (x, y) along at least one axis. */
function isThin(src, W, x, y, clean, reach, skinAt) {
  const cleanAt = (cx, cy) => skinAt(cx, cy) && lum(src, (cy * W + cx) * 4) >= clean;
  for (const [dx, dy] of AXES) {
    let a = false, b = false;
    for (let r = 1; r <= reach && !(a && b); r++) {
      if (!a && cleanAt(x - r * dx, y - r * dy)) a = true;
      if (!b && cleanAt(x + r * dx, y + r * dy)) b = true;
    }
    if (a && b) return true;
  }
  return false;
}

/** One repair pass over `src` (read) into a new array. */
function repairPass(src, W, H, bands, skinAt, P) {
  const out = Uint8Array.from(src);
  let changed = 0, ghost = 0;
  const R = P.radius;
  for (const { band } of bands) {
    for (let y = band.y0; y <= band.y1; y++) for (let x = band.x0; x <= band.x1; x++) {
      if (!skinAt(x, y)) continue;
      const i = (y * W + x) * 4, L = lum(src, i);
      const rs = [], gs = [], bs = [], ls = [];
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        if (!skinAt(x + dx, y + dy)) continue;
        const j = ((y + dy) * W + x + dx) * 4;
        rs.push(src[j]); gs.push(src[j + 1]); bs.push(src[j + 2]); ls.push(lum(src, j));
      }
      if (ls.length < (2 * R + 1) * (2 * R + 1) * 0.35) continue;   // too little skin to judge
      const ref = median(ls), dark = ref - L;
      if (dark < P.start || L < P.faint * ref) continue;
      if (!isThin(src, W, x, y, ref - P.start, P.thin, skinAt)) continue;
      ghost += dark;
      const t = Math.min(1, (dark - P.start) / (P.full - P.start) + 0.2);
      const fill = [median(rs), median(gs), median(bs)];
      for (let c = 0; c < 3; c++) {
        const v = Math.round(src[i + c] + t * (fill[c] - src[i + c]));
        out[i + c] = Math.max(src[i + c] - 2, v);   // never darken a channel beyond rounding
      }
      if (out[i] !== src[i] || out[i + 1] !== src[i + 1] || out[i + 2] !== src[i + 2]) changed++;
    }
  }
  return { out, changed, ghost };
}

/**
 * Finish the removal on one render. `base` is RGBA (4 ch), `mask` RGB or RGBA,
 * `face` the style's eye anchors.
 * Returns { data: new Uint8Array, changed, bands, ghost } and never mutates input.
 * `ghost` is the summed darkness found on the first pass, in luminance units.
 */
export function finishBrowRemoval(base, mask, W, H, mch, face, P = BROW_FINISH) {
  const keys = findBrowKeys(mask, W, H, mch, face);
  const isKey = (k) => mask[k * mch + 2] / 255 > MASK.key;
  // hair, grown by hairGap, so the hairline's own anti-aliasing is out of reach
  const nearHair = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (mask[(y * W + x) * mch] / 255 < MASK.hair) continue;
    for (let dy = -P.hairGap; dy <= P.hairGap; dy++) for (let dx = -P.hairGap; dx <= P.hairGap; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) nearHair[ny * W + nx] = 1;
    }
  }
  // The brow key's own pixels count as skin: the build's fill left the brow's
  // upper outline along the key's top rows too. The EYE key never does.
  const inBrowKey = (x, y) => keys.some((k) => x >= k.x0 && x <= k.x1 && y >= k.y0 && y <= k.y1);
  const skinAt = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const k = y * W + x;
    return base[k * 4 + 3] > 200 && !nearHair[k] && (!isKey(k) || inBrowKey(x, y));
  };
  const bands = keys.map((k) => ({ side: k.side, key: k, band: bandOf(k, W, H, P) }));
  let data = base, ghost = 0;
  for (let pass = 0; pass < P.passes; pass++) {
    const r = repairPass(data, W, H, bands, skinAt, P);
    if (pass === 0) ghost = r.ghost;
    data = r.out;
    if (!r.changed) break;
  }
  let changed = 0;
  for (let k = 0; k < W * H; k++) {
    const i = k * 4;
    if (data[i] !== base[i] || data[i + 1] !== base[i + 1] || data[i + 2] !== base[i + 2]) changed++;
  }
  return { data: data === base ? Uint8Array.from(base) : data, changed, bands, ghost: Math.round(ghost) };
}
