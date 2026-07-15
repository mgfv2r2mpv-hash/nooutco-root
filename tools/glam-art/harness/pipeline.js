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

  // ── diff: wash / hair / feature — plain dmax + geometry pruning ───────────
  // Features and hair use the reference's RAW dmax diff (it captures each
  // feature faithfully: full lip color, hair with its black line-art outline,
  // natural bangs). The ghost problem that diff carries — thin redrawn outlines
  // of eyes/nose/shirt, misalignment bands — is solved GEOMETRICALLY afterwards
  // by pruneComponents(): real features are thick blobs, every ghost is a thin
  // stroke. No color heuristics on features (they broke lips/brows/hair).
  // Washes keep their verified signature gates (lighten/dull within skin — this
  // is what kills the checkerboard, covers the neck, and avoids wash ghosts).
  function diffLayer(baseC, bbox, alignedC, mode, eyeE) {
    const W = baseC.width, H = baseC.height;
    const bd = ctxOf(baseC).getImageData(0, 0, W, H).data;
    const ax = ctxOf(alignedC);
    const rd = ax.getImageData(0, 0, W, H); const rp = rd.data;
    // Zones anchor to the model's MEASURED eye-line (bbox fraction), not fixed
    // fractions: the probe showed the reference zones sit 0.10–0.15 above the
    // real anatomy under this bbox convention (lips zone missed the lips
    // entirely; "brows" zone caught forehead/hairline). zoneE = [x0, dy0, x1,
    // dy1] with dy relative to eyeE.
    const zone = (mode.zoneE && eyeE != null)
      ? [mode.zoneE[0], eyeE + mode.zoneE[1], mode.zoneE[2], eyeE + mode.zoneE[3]]
      : mode.zone;
    const zx0 = bbox.x + (zone ? zone[0] : 0) * bbox.w, zy0 = bbox.y + (zone ? zone[1] : 0) * bbox.h;
    const zx1 = bbox.x + (zone ? zone[2] : 1) * bbox.w, zy1 = bbox.y + (zone ? zone[3] : 1) * bbox.h;
    // per-pixel signal: raw dmax for hair/features; gated signature for washes
    // (and contour's 'dull'). Makeup/wash pixels require an opaque base pixel —
    // they live ON the character (kills backdrop pockets like the m2 checker).
    const sig = new Float32Array(W * H);
    for (let k = 0; k < W * H; k++) {
      const i = k * 4;
      if (rp[i + 3] <= 20) continue;
      if (mode.kind === 'hair') {
        // white-veto: none of the hair colours is white — near-white ghosts are
        // the tee collar/shoulder redraw, not hair.
        if (rp[i] > 215 && rp[i + 1] > 215 && rp[i + 2] > 215) continue;
        sig[k] = Math.min(255, Math.max(Math.abs(rp[i] - bd[i]), Math.abs(rp[i + 1] - bd[i + 1]), Math.abs(rp[i + 2] - bd[i + 2]), bd[i + 3] < 20 ? 255 : 0));
      } else if (mode.kind === 'wash') {
        if (bd[i + 3] < 20) continue;                 // base must be opaque here
        if (mode.gate) {                              // glow: directional sheen
          sig[k] = featureSig(mode.gate, null, bd[i], bd[i + 1], bd[i + 2], rp[i], rp[i + 1], rp[i + 2]);
        } else {
          // wash = REGION (base skin: excludes lips/eyes/brows/hair/shirt/
          // checker) × CONTENT (any change). Direction gates made the mask
          // dappled; the skin region keeps it solid and self-carving.
          if (!isSkin(bd[i], bd[i + 1], bd[i + 2])) continue;
          sig[k] = Math.min(255, Math.max(Math.abs(rp[i] - bd[i]), Math.abs(rp[i + 1] - bd[i + 1]), Math.abs(rp[i + 2] - bd[i + 2])));
        }
      } else {
        if (bd[i + 3] < 20) continue;                 // base must be opaque here
        // white-veto: sclera redraw ghosts are THICK white blobs geometry can't
        // reject — but no makeup layer ADDS near-white (highlight is gated).
        if (!mode.gate && rp[i] > 215 && rp[i + 1] > 215 && rp[i + 2] > 215) continue;
        sig[k] = mode.gate
          ? featureSig(mode.gate, null, bd[i], bd[i + 1], bd[i + 2], rp[i], rp[i + 1], rp[i + 2])
          : Math.min(255, Math.max(Math.abs(rp[i] - bd[i]), Math.abs(rp[i + 1] - bd[i + 1]), Math.abs(rp[i + 2] - bd[i + 2])));
      }
    }
    const keep = new Uint8Array(W * H);
    if (mode.kind === 'wash') {
      const t = mode.seed || 14; // the skin gate inside featureSig confines to skin (incl. neck)
      for (let k = 0; k < W * H; k++) { if (rp[k * 4 + 3] > 20 && sig[k] > t) keep[k] = 1; }
    } else if (mode.kind === 'hair') {
      // Reference diff with threshold ASYMMETRY: the inner-face rect raises the
      // bar (Δ>inside) instead of excluding pixels, so bangs that differ
      // strongly from skin still land naturally — no rectangle clipping, no
      // color tests, black line-art outline kept. The ghosts this admits (thin
      // face/neck/shirt outlines, temple misalignment bands, checker verticals)
      // are removed after: keep only the LARGEST component (the hair mass) and
      // hole-fill it (crown gap where new hair ≈ base buzz). No maxY cap.
      const hc = mode.hair || DEFAULT_HAIR;
      const rect = (hc.rectE && eyeE != null)
        ? [hc.rectE[0], eyeE + hc.rectE[1], hc.rectE[2], eyeE + hc.rectE[3]]
        : hc.rect;
      const fx0 = bbox.x + rect[0] * bbox.w, fx1 = bbox.x + rect[2] * bbox.w;
      const fy0 = bbox.y + rect[1] * bbox.h, fy1 = bbox.y + rect[3] * bbox.h;
      // brow-band carve: where a fringe reaches the brows, the shifted brow
      // redraw is a THICK dark arc — geometry keeps it and it double-prints
      // brows over the composite. Anatomy wins: no hair pixels in the brow band
      // of the inner face (temple hair outside the rect is unaffected).
      const bbY0 = (eyeE != null) ? bbox.y + (eyeE - 0.085) * bbox.h : -1;
      const bbY1 = (eyeE != null) ? bbox.y + (eyeE - 0.002) * bbox.h : -1;
      const bbX0 = bbox.x + 0.24 * bbox.w, bbX1 = bbox.x + 0.76 * bbox.w;
      for (let k = 0; k < W * H; k++) {
        const i = k * 4; if (rp[i + 3] <= 20) continue;
        const x = k % W, y = (k / W) | 0;
        if (bbY0 >= 0 && x > bbX0 && x < bbX1 && y > bbY0 && y < bbY1) continue;
        const inFace = (x > fx0 && x < fx1 && y > fy0 && y < fy1);
        if (sig[k] > (inFace ? hc.inside : hc.outside)) keep[k] = 1;
      }
    } else { // feature — zone-clipped hysteresis on the signature
      const seedT = mode.seed || 30, growT = mode.grow || 12;
      const st = [];
      for (let k = 0; k < W * H; k++) {
        const x = k % W, y = (k / W) | 0;
        if (x < zx0 || x > zx1 || y < zy0 || y > zy1) continue;
        if (sig[k] > seedT) { keep[k] = 1; st.push(k); }
      }
      while (st.length) {
        const k = st.pop(); const x = k % W;
        const nb = [k - 1, k + 1, k - W, k + W, k - W - 1, k - W + 1, k + W - 1, k + W + 1];
        for (const n of nb) {
          if (n < 0 || n >= W * H || keep[n]) continue;
          const nx2 = n % W, ny2 = (n / W) | 0;
          if (Math.abs(nx2 - x) > 1) continue;
          if (nx2 < zx0 - SLACK || nx2 > zx1 + SLACK || ny2 < zy0 - SLACK || ny2 > zy1 + SLACK) continue;
          if (sig[n] > growT) { keep[n] = 1; st.push(n); }
        }
      }
      // §3.1 hard post-clip: zero keep strictly outside zone+SLACK.
      for (let k = 0; k < W * H; k++) {
        if (!keep[k]) continue;
        const x = k % W, y = (k / W) | 0;
        if (x < zx0 - SLACK || x > zx1 + SLACK || y < zy0 - SLACK || y > zy1 + SLACK) keep[k] = 0;
      }
    }
    // ── geometry cleanup (replaces all color heuristics on features) ────────
    if (mode.kind === 'hair') {
      // Core-reconstruction: erode to thick cores (only the hair mass survives —
      // every ghost outline/band is thin-everywhere), then re-grow geodesically
      // INSIDE the kept mask so the mass regains its exact edges, outline and
      // strand tips, while attached thin strings (jaw/neck/shirt lines) that run
      // farther than GEO px from any core are cut. Then close small enclosed
      // holes (brown-on-brown crown gap) — capped so a large region (the face)
      // can never be swallowed like unbounded hole-fill did.
      coreReconstruct(keep, W, H, 4, 14);
      fillHoles(keep, rp, W, H, Math.round(W * H * 0.02));
      pruneComponents(keep, W, H, { minArea: 9000 }); // sweep shoulder-swoosh/string fragments (smallest real hair mass ≈ 20k px)
    } else if (mode.kind === 'wash' && mode.prune) {
      // Wash masks are DAPPLED (soft speckle) — close them first so real wash
      // regions turn solid, then reconstruction: ghost RINGS attach to real
      // patches (component-prune can't cut them), so cut everything > geo px
      // from a thick core instead, then sweep crumbs.
      closeMask(keep, W, H, 2);
      coreReconstruct(keep, W, H, mode.prune.coreR, mode.prune.geo || 12);
      pruneComponents(keep, W, H, { minArea: mode.prune.minArea });
    } else if (mode.prune) {
      pruneComponents(keep, W, H, mode.prune);              // drop thin-everywhere ghosts
    }
    // zero alpha where not kept
    for (let k = 0; k < W * H; k++) { if (!keep[k]) rp[k * 4 + 3] = 0; }
    // soft layers (contour/highlight/blush/glow): the masters are airbrush
    // gradients — encode diff strength into alpha so pads fade at their edges
    // instead of printing hard-edged patches.
    if (mode.softAlpha) {
      const s = mode.softAlpha;
      for (let k = 0; k < W * H; k++) {
        const a = rp[k * 4 + 3];
        if (!a) continue;
        rp[k * 4 + 3] = Math.min(a, Math.round(255 * Math.min(1, sig[k] / s)));
      }
    }
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
  // Reference hair thresholds: inner-face rect raises the diff bar to `inside`
  // (subtle face redraws stay out) while `outside` catches all real hair, bangs
  // included. rectE anchors the rect to the measured eye-line (m1: matches the
  // reference's tuned [0.155..0.42] band at eyeE≈0.375). Ghost cleanup happens
  // later via core-reconstruction + capped hole-fill.
  // inside=34 (was 60): blonde bangs over light skin diff ~46 — 60 cut a
  // rectangle out of the fringe; the face-redraw ghosts 60 guarded against are
  // now killed geometrically by coreReconstruct instead.
  const DEFAULT_HAIR = { rectE: [0.25, -0.22, 0.75, 0.045], rect: [0.25, 0.155, 0.75, 0.42], inside: 34, outside: 18 };

  // A wash pixel is "clean skin" (keep it) vs a baked feature (drop it). Skin is
  // a warm mid-tone (r≥g≥b, not dark, not near-white, not strongly saturated);
  // brows/lashes/pencil are dark, sclera/overexposed highlight near-white, and
  // lips/shadow strongly saturated or red-dominant.
  function isSkin(r, g, b) {
    const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (L < 0.34 || L > 0.93) return false;          // lashes/brows/pencil · sclera/blowout
    if (r < g - 6 || g < b - 6) return false;         // skin is warm; cool pixels aren't skin
    if (r - b < 12) return false;                     // neutral gray (shirt shadow/checker) isn't skin
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (sat > 95) return false;                       // over-saturated → shadow/blush spill
    if ((r - g) > (g - b) + 55) return false;         // red-dominant → lip spill
    return true;
  }

  // ── feature signatures ────────────────────────────────────────────────────
  const lum01 = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const colorDist = (r, g, b, t) => Math.hypot(r - t[0], g - t[1], b - t[2]);
  // a lit, cleaned skin pixel: bright, warm, not very saturated (wash/glow target)
  function isLightSkinish(r, g, b) {
    if (lum01(r, g, b) < 0.46) return false;
    if (r < g - 4 || g < b - 10) return false;
    if (r - b < 12) return false;                     // warmth: rejects neutral-gray checker/backdrop
    return (Math.max(r, g, b) - Math.min(r, g, b)) < 74;
  }
  // any skin-toned pixel (dull included): warm, mid, not a black line or a saturated cosmetic
  function isSkinish(r, g, b) {
    const L = lum01(r, g, b);
    if (L < 0.24 || L > 0.96) return false;
    if (r < g - 3) return false;                      // reject green/olive cast
    if (r - b < 8) return false;                      // warmth: rejects neutral-gray
    return (Math.max(r, g, b) - Math.min(r, g, b)) < 84;
  }
  // How strongly a pixel matches THIS layer's feature (0 = not the feature).
  //   color   → moved toward the tool colour (rejects gray/off-hue ghosts)
  //   dark    → a dark stroke added over lighter base (rejects existing dark edges)
  //   lighten → got lighter AND stays skin (rejects gray checker + dark ghosts)
  //   dull    → got darker but stays skin (the dull patches)
  function featureSig(gate, target, br, bg, bb, lr, lg, lb) {
    if (gate === 'color') return Math.max(0, colorDist(br, bg, bb, target) - colorDist(lr, lg, lb, target));
    if (gate === 'dark') { if (lum01(lr, lg, lb) > 0.5) return 0; return Math.max(0, (lum01(br, bg, bb) - lum01(lr, lg, lb)) * 255); }
    if (gate === 'lighten') { if (!isLightSkinish(lr, lg, lb)) return 0; return Math.max(0, (lum01(lr, lg, lb) - lum01(br, bg, bb)) * 255); }
    if (gate === 'dull') { if (!isSkinish(lr, lg, lb)) return 0; return Math.max(0, (lum01(br, bg, bb) - lum01(lr, lg, lb)) * 255); }
    return 0;
  }

  // ── geometry cleanup ──────────────────────────────────────────────────────
  // Real features are thick blobs; ghosts (redrawn outlines, AA edges,
  // misalignment bands) are thin strokes. A component survives iff it has a
  // "core": a pixel still set after coreR 8-neighbour erosions (i.e. the blob is
  // ≥ 2·coreR+1 px thick somewhere) — and covers ≥ minArea px. Component edges
  // are untouched (no dilate-back distortion). largestOnly keeps just the
  // biggest component (hair = one connected mass).
  function pruneComponents(keep, W, H, opt) {
    const coreR = opt.coreR || 0, minArea = opt.minArea || 0, largestOnly = !!opt.largestOnly;
    const maxCoreR = opt.maxCoreR || 0; // stroke layers: a component with a core
    const erode = (src, r) => {         // this thick is a GHOST blob, not a stroke
      let cur = Uint8Array.from(src);
      for (let i = 0; i < r; i++) {
        const nxt = new Uint8Array(W * H);
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const k = y * W + x;
          if (cur[k] && cur[k - 1] && cur[k + 1] && cur[k - W] && cur[k + W] && cur[k - W - 1] && cur[k - W + 1] && cur[k + W - 1] && cur[k + W + 1]) nxt[k] = 1;
        }
        cur = nxt;
      }
      return cur;
    };
    const core = (coreR > 0 && !largestOnly) ? erode(keep, coreR) : null;
    const fatCore = maxCoreR > 0 ? erode(keep, maxCoreR) : null;
    // label 8-connected components
    const label = new Int32Array(W * H);
    let nLab = 0; const areas = [0]; const hasCore = [true]; const hasFat = [false];
    const st = [];
    for (let k0 = 0; k0 < W * H; k0++) {
      if (!keep[k0] || label[k0]) continue;
      nLab++; areas.push(0); hasCore.push(false); hasFat.push(false);
      label[k0] = nLab; st.push(k0);
      while (st.length) {
        const k = st.pop(); const x = k % W;
        areas[nLab]++; if (core && core[k]) hasCore[nLab] = true;
        if (fatCore && fatCore[k]) hasFat[nLab] = true;
        const nb = [k - 1, k + 1, k - W, k + W, k - W - 1, k - W + 1, k + W - 1, k + W + 1];
        for (const n of nb) {
          if (n < 0 || n >= W * H || !keep[n] || label[n]) continue;
          if (Math.abs((n % W) - x) > 1) continue;
          label[n] = nLab; st.push(n);
        }
      }
    }
    if (!nLab) return;
    let largest = 1;
    for (let l = 2; l <= nLab; l++) if (areas[l] > areas[largest]) largest = l;
    const drop = new Uint8Array(nLab + 1);
    for (let l = 1; l <= nLab; l++) {
      if (largestOnly) { if (l !== largest) drop[l] = 1; continue; }
      if (areas[l] < minArea) { drop[l] = 1; continue; }
      if (core && !hasCore[l]) drop[l] = 1;
      if (fatCore && hasFat[l]) drop[l] = 1;   // too thick to be a stroke → ghost blob
    }
    for (let k = 0; k < W * H; k++) if (keep[k] && drop[label[k]]) keep[k] = 0;
  }

  // Morphological closing: dilate r then erode r — solidifies dappled masks
  // (soft wash speckle) without moving true boundaries. 4-neighbour, cheap.
  function closeMask(keep, W, H, r) {
    let cur = Uint8Array.from(keep);
    for (let i = 0; i < r; i++) {
      const nxt = Uint8Array.from(cur);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const k = y * W + x;
        if (!cur[k] && (cur[k - 1] || cur[k + 1] || cur[k - W] || cur[k + W])) nxt[k] = 1;
      }
      cur = nxt;
    }
    for (let i = 0; i < r; i++) {
      const nxt = Uint8Array.from(cur);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const k = y * W + x;
        if (cur[k] && !(cur[k - 1] && cur[k + 1] && cur[k - W] && cur[k + W])) nxt[k] = 0;
      }
      cur = nxt;
    }
    for (let k = 0; k < W * H; k++) keep[k] = cur[k];
  }

  // Core-reconstruction (hair): erode coreR times — only regions ≥ 2·coreR+1 px
  // thick keep a "core" (the hair mass; every ghost outline/band is thinner) —
  // then re-grow the core geodesically INSIDE the original mask for `geo`
  // rounds. The mass recovers its exact edges/outline/strand tips; attached
  // thin strings (jaw/neck/shirt lines) farther than geo px from a core are cut.
  function coreReconstruct(keep, W, H, coreR, geo) {
    let cur = Uint8Array.from(keep);
    for (let r = 0; r < coreR; r++) {
      const nxt = new Uint8Array(W * H);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const k = y * W + x;
        if (cur[k] && cur[k - 1] && cur[k + 1] && cur[k - W] && cur[k + W] && cur[k - W - 1] && cur[k - W + 1] && cur[k + W - 1] && cur[k + W + 1]) nxt[k] = 1;
      }
      cur = nxt;
    }
    let recon = cur;
    for (let g = 0; g < geo; g++) {
      const nxt = Uint8Array.from(recon);
      let grew = false;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const k = y * W + x;
        if (recon[k] || !keep[k]) continue;
        if (recon[k - 1] || recon[k + 1] || recon[k - W] || recon[k + W] || recon[k - W - 1] || recon[k - W + 1] || recon[k + W - 1] || recon[k + W + 1]) { nxt[k] = 1; grew = true; }
      }
      recon = nxt;
      if (!grew) break;
    }
    for (let k = 0; k < W * H; k++) keep[k] = recon[k];
  }

  // Fill enclosed transparent holes inside a kept mass (hair crown where the new
  // hair ≈ base buzz so the diff missed it). Flood the complement from the
  // border; unreached non-kept regions are enclosed → restore from the aligned
  // render (only where it has content), but ONLY regions ≤ maxArea px — a large
  // enclosed region (the whole face ringed by hair) must never be swallowed.
  function fillHoles(keep, rp, W, H, maxArea) {
    const seen = new Uint8Array(W * H); const st = [];
    const push = (k) => { if (k < 0 || k >= W * H || seen[k] || keep[k]) return; seen[k] = 1; st.push(k); };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (st.length) {
      const k = st.pop(); const x = k % W;
      if (x > 0) push(k - 1);
      if (x < W - 1) push(k + 1);
      push(k - W); push(k + W);
    }
    // label enclosed regions, fill only the small ones
    const cap = maxArea || (W * H);
    const lab = new Uint8Array(W * H); const comp = [];
    for (let k0 = 0; k0 < W * H; k0++) {
      if (keep[k0] || seen[k0] || lab[k0]) continue;
      comp.length = 0; lab[k0] = 1; comp.push(k0);
      for (let qi = 0; qi < comp.length; qi++) {
        const k = comp[qi]; const x = k % W;
        const nb = [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, k - W, k + W];
        for (const n of nb) { if (n < 0 || n >= W * H || keep[n] || seen[n] || lab[n]) continue; lab[n] = 1; comp.push(n); }
      }
      if (comp.length <= cap) {
        for (const k of comp) if (rp[k * 4 + 3] > 20) keep[k] = 1;
      }
    }
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
    const yCut = Math.round(350 / 600 * H);
    // Segment the tee the way hair is segmented: the largest connected mass of
    // opaque, NEUTRAL (low-sat), NON-skin pixels below the collar. Captures the
    // folds / shadows / black outlines the old white-only test dropped (which is
    // what made recolored shirts patchy); neutral-only keeps hanging hair out
    // (saturated), isSkin keeps the neck/arms out.
    const keep = new Uint8Array(W * H);
    for (let y = yCut; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4; if (p[i + 3] <= 40) continue;
      const r = p[i], g = p[i + 1], b = p[i + 2];
      if (isSkin(r, g, b)) continue;                              // neck / arms
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if ((mx === 0 ? 0 : (mx - mn) / mx * 100) > 42) continue;   // saturated → hair, not tee
      keep[y * W + x] = 1;
    }
    pruneComponents(keep, W, H, { largestOnly: true });           // the tee mass
    fillHoles(keep, p, W, H, Math.round(W * H * 0.06));           // close fold/shadow holes
    // recolor the WHOLE mask by luminance — folds keep their shading, black
    // outlines stay dark, white body takes the full tint.
    for (let k = 0; k < W * H; k++) {
      const i = k * 4;
      if (keep[k]) { const L = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255; p[i] = tint[0] * L; p[i + 1] = tint[1] * L; p[i + 2] = tint[2] * L; }
      else p[i + 3] = 0;
    }
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

  // Eye-line detection (bbox fraction): the row with the most bright sclera
  // pixels in the upper-central face band. Anchors every feature zone to the
  // model's real anatomy (the fixed reference fractions sat 0.10–0.15 too high
  // under this bbox convention).
  function detectEyeLine(canvas, bbox) {
    const W = canvas.width, H = canvas.height;
    const d = ctxOf(canvas).getImageData(0, 0, W, H).data;
    const x0 = Math.round(bbox.x + 0.25 * bbox.w), x1 = Math.round(bbox.x + 0.75 * bbox.w);
    const y0 = Math.round(bbox.y + 0.10 * bbox.h), y1 = Math.round(bbox.y + 0.55 * bbox.h);
    let bestY = y0, best = -1;
    for (let y = y0; y < y1; y++) {
      let n = 0;
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        if (d[i + 3] > 40 && d[i] > 222 && d[i + 1] > 222 && d[i + 2] > 222) n++;
      }
      if (n > best) { best = n; bestY = y; }
    }
    return (bestY - bbox.y) / bbox.h;
  }

  // Detect the two eye (sclera) blobs on the eye-line band → centres + widths.
  function detectEyeBoxes(canvas, bbox, eyeE) {
    const W = canvas.width, H = canvas.height;
    const d = ctxOf(canvas).getImageData(0, 0, W, H).data;
    const eyeY = bbox.y + eyeE * bbox.h;
    const y0 = Math.round(eyeY - 0.06 * bbox.h), y1 = Math.round(eyeY + 0.06 * bbox.h);
    const x0 = Math.round(bbox.x + 0.18 * bbox.w), x1 = Math.round(bbox.x + 0.82 * bbox.w);
    const cxF = bbox.x + 0.5 * bbox.w;
    const acc = [{ n: 0, sx: 0, sy: 0, mnx: 1e9, mxx: -1e9 }, { n: 0, sx: 0, sy: 0, mnx: 1e9, mxx: -1e9 }];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      if (d[i + 3] > 40 && d[i] > 205 && d[i + 1] > 205 && d[i + 2] > 205) {
        const s = x < cxF ? acc[0] : acc[1];
        s.n++; s.sx += x; s.sy += y; if (x < s.mnx) s.mnx = x; if (x > s.mxx) s.mxx = x;
      }
    }
    return acc.filter((s) => s.n > 20).map((s) => ({ cx: s.sx / s.n, cy: s.sy / s.n, w: s.mxx - s.mnx }));
  }

  // Per-model face anchors, in box-% of the 320×360 stage (same convention as
  // spotAnchors). Feeds the game's PROCEDURAL cosmetics (eyeshadow on eyelids,
  // blush on cheeks, glow on forehead/cheekbones, dull over the whole face).
  function computeFaceAnchors(canvas, bbox, frame) {
    const eyeE = detectEyeLine(canvas, bbox);
    const eyes = detectEyeBoxes(canvas, bbox, eyeE).sort((a, b) => a.cx - b.cx);
    // stripped-canvas art coord → box-%: map through the export frame, then the
    // object-fit:contain letterbox (520×600 → 312×360 centred, +4px x-bar).
    const bx = (ax) => +(((4 + (ax - frame.x) / frame.w * 312) / 320) * 100).toFixed(1);
    const by = (ay) => +(((ay - frame.y) / frame.h) * 100).toFixed(1);
    const bw = (aw) => +((aw / frame.w * 312 / 320) * 100).toFixed(1);
    const eyeYart = bbox.y + eyeE * bbox.h, cxA = bbox.x + 0.5 * bbox.w;
    let L, R;
    if (eyes.length === 2) { [L, R] = eyes; }
    else { const off = 0.14 * bbox.w, w = 0.16 * bbox.w; L = { cx: cxA - off, cy: eyeYart, w }; R = { cx: cxA + off, cy: eyeYart, w }; }
    const drop = 0.135 * bbox.h;
    return {
      eyeL: { l: bx(L.cx), t: by(L.cy), w: bw(L.w) },
      eyeR: { l: bx(R.cx), t: by(R.cy), w: bw(R.w) },
      cheekL: { l: bx(L.cx - 0.015 * bbox.w), t: by(L.cy + drop) },
      cheekR: { l: bx(R.cx + 0.015 * bbox.w), t: by(R.cy + drop) },
      faceCx: bx(cxA), eyeY: by(eyeYart),
      faceTop: by(bbox.y + 0.05 * bbox.h), faceBot: by(bbox.y + 0.62 * bbox.h),
      faceHalfW: bw(0.30 * bbox.w),
    };
  }

  G.stripBase = async function (dataUrl) {
    const img = await loadImage(dataUrl);
    const { canvas, bbox, clusters } = stripBg(img);
    const eyeE = detectEyeLine(canvas, bbox);
    window.__glamBase = { canvas, bbox, eyeE };
    return { bbox, srcW: img.width, srcH: img.height, clusters, eyeE: +eyeE.toFixed(4) };
  };

  // called after the frame is known (driver computes bboxToFrame post-stripBase)
  G.faceAnchors = function (frame) {
    const { canvas, bbox } = window.__glamBase;
    return computeFaceAnchors(canvas, bbox, frame);
  };

  G.exportBase = function (frame) {
    const { canvas } = window.__glamBase;
    return toPng(exportFrame(canvas, frame));
  };

  G.processLayer = async function (key, mode, dataUrl, frame) {
    const { canvas: baseC, bbox: baseBbox, eyeE } = window.__glamBase;
    const img = await loadImage(dataUrl);
    const { canvas: rC, bbox: rBbox } = stripBg(img);
    const { canvas: aligned } = alignTo(baseC, baseBbox, rC, rBbox);
    const count = diffLayer(baseC, baseBbox, aligned, mode, eyeE);
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
  G._internal = { stripBg, alignTo, diffLayer, exportFrame, cropResizeSprite, recolorShirt, composeEars, isSkin, washSubtract, pruneComponents, coreReconstruct, fillHoles, detectEyeLine, DEFAULT_WASH_SUBTRACT, DEFAULT_HAIR };

  window.GlamPipeline = G;
})();
