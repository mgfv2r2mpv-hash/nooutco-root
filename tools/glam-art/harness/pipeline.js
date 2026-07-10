/* ─────────────────────────────────────────────────────────────────────────
   pipeline.js — Glam Team Makeover art pipeline (browser Canvas2D).

   Faithful port of the reference assets/art/_pipeline.js.txt (stripBg, darkMap,
   alignTo, diffLayer, exportFrame, MODES) — tuned parameters preserved — PLUS
   the three fixes DESIGN_FILE_CLAUDE.md §3 says the reference lacks:

     §3.1 hard post-clip   — feature layers: zero α strictly outside zone+8px
                             after hysteresis, then re-feather (kills feather
                             bleed + lighting-drift blobs).
     §3.2 wash subtraction — wash layers: subtract the union of the brow/eye/lip
                             feature zones (feathered ~6px) so a clean-washed
                             face with an absent upper slot never shows baked
                             brow/lip/eye pixels.
     §3.3 hair config      — the inner-face rect + thresholds are per-model
                             tunable (default = the reference m1/m3 values).

   Runs in a headless Chromium page driven by run_pipeline.mjs. The frame passed
   to exportFrame is computed node-side by frame.mjs (single source of truth).
   Loaded via page.addScriptTag; exposes window.GlamPipeline.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const SLACK = 8;          // ±8px zone slack (source scale)
  const OUT_W = 520, OUT_H = 600;
  // §3.2 wash carve strategy: 'off' | 'rect' | 'color'. 'color' keeps clean skin
  // and only drops baked non-skin (brow/lash/lip/shadow) pixels inside the rects.
  const WASH_SUBTRACT_MODE = 'color';

  function createCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function ctxOf(c) { return c.getContext('2d', { willReadFrequently: true }); }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load failed'));
      img.src = dataUrl;
    });
  }

  // ── strip_bg: flood-fill background removal (ported verbatim) ──────────────
  function stripBg(img) {
    const w = img.width, h = img.height;
    const c = createCanvas(w, h), x = ctxOf(c);
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, w, h), p = d.data;
    const w4 = Math.ceil(w / 4), h4 = Math.ceil(h / 4);
    const c4 = createCanvas(w4, h4), x4 = ctxOf(c4);
    x4.drawImage(img, 0, 0, w4, h4);
    const p4 = x4.getImageData(0, 0, w4, h4).data;
    const lum = (i, arr) => (arr[i] * 0.299 + arr[i + 1] * 0.587 + arr[i + 2] * 0.114);
    const lums = [];
    const addB = (ix, iy) => { const i = (iy * w4 + ix) * 4; const mx = Math.max(p4[i], p4[i + 1], p4[i + 2]), mn = Math.min(p4[i], p4[i + 1], p4[i + 2]); if (mx - mn < 18) lums.push(lum(i, p4)); };
    for (let ix = 0; ix < w4; ix++) addB(ix, 0);
    for (let iy = 0; iy < h4; iy++) { addB(0, iy); addB(w4 - 1, iy); }
    lums.sort((a, b) => a - b);
    const clusters = []; for (const L of lums) { const cl = clusters.find(c => Math.abs(c.mean - L) < 22); if (cl) { cl.mean = (cl.mean * cl.n + L) / (cl.n + 1); cl.n++; } else clusters.push({ mean: L, n: 1 }); }
    const bigCl = clusters.filter(c => c.n > 8).map(c => c.mean);
    const bg4 = (i) => { const mx = Math.max(p4[i], p4[i + 1], p4[i + 2]), mn = Math.min(p4[i], p4[i + 1], p4[i + 2]); if (mx - mn >= 16) return false; const L = lum(i, p4); return bigCl.some(m => Math.abs(L - m) < 20); };
    const seen = new Uint8Array(w4 * h4); const q = []; const BOT = h4 - 2;
    const push = (ix, iy) => { if (ix < 0 || iy < 0 || ix >= w4 || iy >= h4) return; const k = iy * w4 + ix; if (seen[k]) return; if (!bg4(k * 4)) return; seen[k] = 1; q.push(k); };
    for (let ix = 0; ix < w4; ix++) push(ix, 0);
    for (let iy = 0; iy < h4; iy++) { push(0, iy); push(w4 - 1, iy); }
    while (q.length) { const k = q.pop(); const ix = k % w4, iy = (k / w4) | 0; push(ix, iy + 1); push(ix, iy - 1); if (iy < BOT) { push(ix + 1, iy); push(ix - 1, iy); } }
    const bgPix = (i) => { const mx = Math.max(p[i], p[i + 1], p[i + 2]), mn = Math.min(p[i], p[i + 1], p[i + 2]); if (p[i + 3] < 10) return true; if (mx - mn >= 20) return false; const L = lum(i, p); return bigCl.some(m => Math.abs(L - m) < 26); };
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let iy = 0; iy < h; iy++) for (let ix = 0; ix < w; ix++) {
      const k = iy * w + ix, i = k * 4;
      const cx = Math.min(w4 - 1, ix >> 2), cy = Math.min(h4 - 1, iy >> 2);
      let adj = false;
      for (let oy = -1; oy <= 1 && !adj; oy++) for (let ox = -1; ox <= 1 && !adj; ox++) { const nx = cx + ox, ny = cy + oy; if (nx < 0 || ny < 0 || nx >= w4 || ny >= h4) continue; if (seen[ny * w4 + nx]) adj = true; }
      if (adj && bgPix(i)) { p[i + 3] = 0; }
      else if (p[i + 3] > 10) { if (ix < minX) minX = ix; if (ix > maxX) maxX = ix; if (iy < minY) minY = iy; if (iy > maxY) maxY = iy; }
    }
    x.putImageData(d, 0, 0);
    // Guard: a blank/placeholder master that strips to nothing would leave the
    // bbox seeds unmoved → negative w/h → NaN alignment downstream. Fail loud.
    if (maxX < minX || maxY < minY) throw new Error('stripBg: no opaque pixels after background strip (blank master?)');
    return { canvas: c, bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }, clusters: bigCl };
  }

  function darkMap(canvas) {
    const w = canvas.width, h = canvas.height, w4 = Math.ceil(w / 4), h4 = Math.ceil(h / 4);
    const c4 = createCanvas(w4, h4); const x4 = ctxOf(c4); x4.drawImage(canvas, 0, 0, w4, h4);
    const p = x4.getImageData(0, 0, w4, h4).data;
    const grid = new Uint8Array(w4 * h4); const pts = [];
    for (let k = 0; k < w4 * h4; k++) { const i = k * 4; if (p[i + 3] > 40) { const L = p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114; if (L < 90) { grid[k] = 1; pts.push(k); } } }
    return { grid, pts, w4, h4 };
  }

  function alignTo(baseC, baseBbox, rC, rBbox) {
    const scales = [1]; const s2 = baseBbox.h / rBbox.h; if (Math.abs(s2 - 1) > 0.005) scales.push(s2);
    const bMap = darkMap(baseC);
    let best = { score: -1, s: 1, dx: 0, dy: 0 };
    for (const s of scales) {
      let sc = rC;
      if (s !== 1) { sc = createCanvas(Math.round(rC.width * s), Math.round(rC.height * s)); ctxOf(sc).drawImage(rC, 0, 0, sc.width, sc.height); }
      const rMap = darkMap(sc);
      for (let dy = -20; dy <= 20; dy++) for (let dx = -20; dx <= 20; dx++) {
        let v = 0;
        for (const k of rMap.pts) { const x = (k % rMap.w4) + dx, y = ((k / rMap.w4) | 0) + dy; if (x >= 0 && y >= 0 && x < bMap.w4 && y < bMap.h4 && bMap.grid[y * bMap.w4 + x]) v++; }
        if (v > best.score) best = { score: v, s, dx, dy };
      }
    }
    const W = baseC.width, H = baseC.height;
    const al = createCanvas(W, H);
    ctxOf(al).drawImage(rC, 0, 0, rC.width, rC.height, best.dx * 4, best.dy * 4, rC.width * best.s, rC.height * best.s);
    return { canvas: al, best };
  }

  // ── diff: wash / hair / feature, with the §3 fixes ────────────────────────
  function diffLayer(baseC, bbox, alignedC, mode) {
    const W = baseC.width, H = baseC.height;
    const bd = ctxOf(baseC).getImageData(0, 0, W, H).data;
    const ax = ctxOf(alignedC);
    const rd = ax.getImageData(0, 0, W, H); const rp = rd.data;
    const zone = mode.zone;
    const zx0 = bbox.x + (zone ? zone[0] : 0) * bbox.w, zy0 = bbox.y + (zone ? zone[1] : 0) * bbox.h;
    const zx1 = bbox.x + (zone ? zone[2] : 1) * bbox.w, zy1 = bbox.y + (zone ? zone[3] : 1) * bbox.h;
    const dmaxArr = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) {
      const i = k * 4;
      if (rp[i + 3] <= 20) continue;
      const dm = Math.min(255, Math.max(Math.abs(rp[i] - bd[i]), Math.abs(rp[i + 1] - bd[i + 1]), Math.abs(rp[i + 2] - bd[i + 2]), bd[i + 3] < 20 ? 255 : 0));
      dmaxArr[k] = dm;
    }
    const keep = new Uint8Array(W * H);
    if (mode.kind === 'wash') {
      const yCap = bbox.y + 0.68 * bbox.h;
      for (let k = 0; k < W * H; k++) { const y = (k / W) | 0; if (rp[k * 4 + 3] > 20 && dmaxArr[k] > 12 && y < yCap) keep[k] = 1; }
      // §3.2 wash zone-subtraction. Two strategies (see WASH_SUBTRACT_MODE):
      //   'rect'  — remove ALL wash inside the brow/eye/lip search rects (too
      //             aggressive: reveals base skin as a band).
      //   'color' — remove only NON-skin-colored wash pixels inside those rects
      //             (drops baked brow/lip/eye recolor, keeps clean skin).
      //   'off'   — no subtraction.
      if (WASH_SUBTRACT_MODE !== 'off') {
        washSubtract(keep, rp, bbox, W, H, mode.subtractZones || DEFAULT_WASH_SUBTRACT, 6, WASH_SUBTRACT_MODE);
      }
    } else if (mode.kind === 'hair') {
      const hc = mode.hair || DEFAULT_HAIR;
      const fx0 = bbox.x + hc.rect[0] * bbox.w, fx1 = bbox.x + hc.rect[2] * bbox.w;
      const fy0 = bbox.y + hc.rect[1] * bbox.h, fy1 = bbox.y + hc.rect[3] * bbox.h;
      for (let k = 0; k < W * H; k++) {
        const i = k * 4; if (rp[i + 3] <= 20) continue;
        const x = k % W, y = (k / W) | 0;
        const inFace = (x > fx0 && x < fx1 && y > fy0 && y < fy1);
        if (dmaxArr[k] > (inFace ? hc.inside : hc.outside)) keep[k] = 1;
      }
    } else { // feature — zone-clipped hysteresis
      const seedT = mode.seed || 42, growT = mode.grow || 15;
      const st = [];
      for (let k = 0; k < W * H; k++) {
        const x = k % W, y = (k / W) | 0;
        if (x < zx0 || x > zx1 || y < zy0 || y > zy1) continue;
        if (dmaxArr[k] > seedT && rp[k * 4 + 3] > 20) { keep[k] = 1; st.push(k); }
      }
      while (st.length) {
        const k = st.pop(); const x = k % W;
        const nb = [k - 1, k + 1, k - W, k + W, k - W - 1, k - W + 1, k + W - 1, k + W + 1];
        for (const n of nb) {
          if (n < 0 || n >= W * H || keep[n]) continue;
          const nx2 = n % W, ny2 = (n / W) | 0;
          if (Math.abs(nx2 - x) > 1) continue;
          if (nx2 < zx0 - SLACK || nx2 > zx1 + SLACK || ny2 < zy0 - SLACK || ny2 > zy1 + SLACK) continue;
          if (dmaxArr[n] > growT && rp[n * 4 + 3] > 20) { keep[n] = 1; st.push(n); }
        }
      }
      // §3.1 hard post-clip: zero keep strictly outside zone+SLACK (belt) so the
      // subsequent feather can only round a boundary that already sits at zone+8.
      for (let k = 0; k < W * H; k++) {
        if (!keep[k]) continue;
        const x = k % W, y = (k / W) | 0;
        if (x < zx0 - SLACK || x > zx1 + SLACK || y < zy0 - SLACK || y > zy1 + SLACK) keep[k] = 0;
      }
    }
    // zero alpha where not kept
    for (let k = 0; k < W * H; k++) { if (!keep[k]) rp[k * 4 + 3] = 0; }
    // feather: alpha ×= 3×3 mean of keep
    for (let k = 0; k < W * H; k++) {
      if (rp[k * 4 + 3] === 0) continue;
      const x = k % W, y = (k / W) | 0; let s = 0, n = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const nx = x + ox, ny = y + oy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; n++; s += keep[ny * W + nx]; }
      rp[k * 4 + 3] = Math.min(rp[k * 4 + 3], Math.round(255 * s / n));
    }
    // §3.1 (suspenders): after feather, hard-zero any α that bled strictly
    // outside zone+SLACK for feature layers.
    if (mode.kind !== 'wash' && mode.kind !== 'hair' && zone) {
      for (let k = 0; k < W * H; k++) {
        if (rp[k * 4 + 3] === 0) continue;
        const x = k % W, y = (k / W) | 0;
        if (x < zx0 - SLACK || x > zx1 + SLACK || y < zy0 - SLACK || y > zy1 + SLACK) rp[k * 4 + 3] = 0;
      }
    }
    ax.putImageData(rd, 0, 0);
    let cnt = 0; for (let k = 0; k < W * H; k++) if (keep[k]) cnt++;
    return cnt;
  }

  // Feature zones (bbox fractions) whose union is carved out of wash layers.
  const DEFAULT_WASH_SUBTRACT = [
    [0.15, 0.06, 0.85, 0.24], // brows
    [0.12, 0.08, 0.88, 0.26], // eyes (shadow/liner)
    [0.28, 0.26, 0.72, 0.42], // lips
  ];
  const DEFAULT_HAIR = { rect: [0.25, 0.155, 0.75, 0.42], inside: 60, outside: 18 };

  // A wash pixel is "clean skin" (keep it) vs a baked feature (drop it). Skin is
  // a warm mid-tone (r≥g≥b, not dark, not near-white, not strongly saturated);
  // brows/lashes/pencil are dark, sclera/overexposed highlight near-white, and
  // lips/shadow strongly saturated or red-dominant.
  function isSkin(r, g, b) {
    const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (L < 0.34 || L > 0.93) return false;          // lashes/brows/pencil · sclera/blowout
    if (r < g - 6 || g < b - 6) return false;         // skin is warm; cool pixels aren't skin
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (sat > 95) return false;                       // over-saturated → shadow/blush spill
    if ((r - g) > (g - b) + 55) return false;         // red-dominant → lip spill
    return true;
  }

  function washSubtract(keep, rp, bbox, W, H, zones, featherPx, strategy) {
    const sub = new Uint8Array(W * H);
    for (const z of zones) {
      const zx0 = Math.floor(bbox.x + z[0] * bbox.w), zy0 = Math.floor(bbox.y + z[1] * bbox.h);
      const zx1 = Math.ceil(bbox.x + z[2] * bbox.w), zy1 = Math.ceil(bbox.y + z[3] * bbox.h);
      for (let y = Math.max(0, zy0 - featherPx); y < Math.min(H, zy1 + featherPx); y++)
        for (let x = Math.max(0, zx0 - featherPx); x < Math.min(W, zx1 + featherPx); x++)
          sub[y * W + x] = 1;
    }
    for (let k = 0; k < W * H; k++) {
      if (!sub[k] || !keep[k]) continue;
      if (strategy === 'rect') { keep[k] = 0; continue; }
      // 'color': only drop the baked non-skin pixels; keep clean skin coverage.
      const i = k * 4;
      if (!isSkin(rp[i], rp[i + 1], rp[i + 2])) keep[k] = 0;
    }
  }

  function exportFrame(srcCanvas, frame) {
    const tmp = createCanvas(frame.w, frame.h);
    ctxOf(tmp).drawImage(srcCanvas, -frame.x, -frame.y);
    const out = createCanvas(OUT_W, OUT_H);
    ctxOf(out).drawImage(tmp, 0, 0, frame.w, frame.h, 0, 0, OUT_W, OUT_H);
    return out;
  }

  // Content-crop a true-alpha sprite (α>threshold) and resize its longest side.
  function cropResizeSprite(canvas, maxSide, aThresh) {
    const W = canvas.width, H = canvas.height;
    const d = ctxOf(canvas).getImageData(0, 0, W, H).data;
    let minX = W, minY = H, maxX = 0, maxY = 0, any = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > aThresh) { any = true; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (!any) return canvas;
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const scale = maxSide / Math.max(cw, ch);
    const out = createCanvas(Math.max(1, Math.round(cw * scale)), Math.max(1, Math.round(ch * scale)));
    ctxOf(out).drawImage(canvas, minX, minY, cw, ch, 0, 0, out.width, out.height);
    return out;
  }

  // Recolor the tee region of a processed base (520×600): pixels below y>370,
  // low-saturation, mid/high luminance → tinted by rgb = tint × L (preserves
  // shading). tint is [r,g,b] 0..255. (DESIGN_FILE §5 / handoff step 6.)
  function recolorShirt(baseOut, tint) {
    const W = baseOut.width, H = baseOut.height;
    const out = createCanvas(W, H); const ox = ctxOf(out); ox.drawImage(baseOut, 0, 0);
    const d = ox.getImageData(0, 0, W, H), p = d.data;
    const yCut = Math.round(370 / 600 * H);
    for (let y = 0; y < H; y++) {
      if (y <= yCut) continue;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const a = p[i + 3]; if (a < 40) { p[i + 3] = 0; continue; }
        const r = p[i], g = p[i + 1], b = p[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx * 100;
        const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        if (sat < 26 && L > 0.55) { p[i] = tint[0] * L; p[i + 1] = tint[1] * L; p[i + 2] = tint[2] * L; }
        else { p[i + 3] = 0; }
      }
    }
    // clear everything above the tee line so the shirt layer is tee-only
    for (let y = 0; y <= yCut; y++) for (let x = 0; x < W; x++) p[(y * W + x) * 4 + 3] = 0;
    ox.putImageData(d, 0, 0);
    return out;
  }

  // Composite a pair of studs onto a transparent 520×600 at ear anchors
  // {l,r,t} (percent) with a given width fraction of the frame.
  function composeEars(studCanvas, earAnchors, widthFrac) {
    const stud = cropResizeSprite(studCanvas, 512, 12);
    const out = createCanvas(OUT_W, OUT_H); const ox = ctxOf(out);
    const w = OUT_W * widthFrac, h = w * (stud.height / stud.width);
    const place = (cxPct) => { const cx = OUT_W * cxPct / 100, cy = OUT_H * earAnchors.t / 100; ox.drawImage(stud, cx - w / 2, cy - h / 2, w, h); };
    place(earAnchors.l); place(earAnchors.r);
    return out;
  }

  const toPng = (canvas) => canvas.toDataURL('image/png');

  // ── High-level, page-persistent API driven by run_pipeline.mjs ────────────
  const G = {};

  G.stripBase = async function (dataUrl) {
    const img = await loadImage(dataUrl);
    const { canvas, bbox, clusters } = stripBg(img);
    window.__glamBase = { canvas, bbox };
    return { bbox, srcW: img.width, srcH: img.height, clusters };
  };

  G.exportBase = function (frame) {
    const { canvas } = window.__glamBase;
    return toPng(exportFrame(canvas, frame));
  };

  G.processLayer = async function (key, mode, dataUrl, frame) {
    const { canvas: baseC, bbox: baseBbox } = window.__glamBase;
    const img = await loadImage(dataUrl);
    const { canvas: rC, bbox: rBbox } = stripBg(img);
    const { canvas: aligned } = alignTo(baseC, baseBbox, rC, rBbox);
    const count = diffLayer(baseC, baseBbox, aligned, mode);
    return { png: toPng(exportFrame(aligned, frame)), keepCount: count };
  };

  G.processSpot = async function (dataUrl) {
    const img = await loadImage(dataUrl);
    // spot ships with true alpha — no diff; content-crop + downscale to 256.
    const c = createCanvas(img.width, img.height); ctxOf(c).drawImage(img, 0, 0);
    return toPng(cropResizeSprite(c, 256, 12));
  };

  G.processShirt = function (baseOutDataUrl, tint) {
    // recolor runs on the already-exported 520×600 base
    return new Promise(async (resolve) => {
      const base = await loadImage(baseOutDataUrl);
      const bc = createCanvas(base.width, base.height); ctxOf(bc).drawImage(base, 0, 0);
      resolve(toPng(recolorShirt(bc, tint)));
    });
  };

  G.processEar = async function (studDataUrl, earAnchors, widthFrac) {
    const img = await loadImage(studDataUrl);
    // Stud PNGs carry a baked background (only `spot` ships true alpha) — strip it
    // so composeEars crops to the stud itself, not a white matte box.
    const { canvas } = stripBg(img);
    return toPng(composeEars(canvas, earAnchors, widthFrac || 0.045));
  };

  // low-level exposure for tests / QA (qa.mjs reuses isSkin so the heuristic has
  // a single source of truth)
  G._internal = { stripBg, alignTo, diffLayer, exportFrame, cropResizeSprite, recolorShirt, composeEars, isSkin, washSubtract, DEFAULT_WASH_SUBTRACT, DEFAULT_HAIR };

  window.GlamPipeline = G;
})();
