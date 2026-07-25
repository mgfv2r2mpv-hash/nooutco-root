/* Measurement harness behind SECOND-PASS fix U1/U2 (the highlight's falloff and
   its silhouette). NOT a spec — it prints numbers, it asserts nothing. The table
   in docs/eval/glam-team-makeover-build-report.md §U1 came out of it.

   `_probe-glam-face3.mjs` answers "how big and how bright?" — the T4e questions.
   This one answers the two the maintainer asked after T4e shipped:

     · is the silhouette CURVED, or is it a straight ellipse?
     · does the fade BEGIN near the centre, or is there a bright plateau first?

   Run against a server on :8788, once per side of the comparison:

     git show HEAD:apps/games/glam-team-makeover/index.html \
       > apps/games/glam-team-makeover/_before-tune2.html
     PAGE=/glam-team-makeover/_before-tune2.html node tests/_probe-glam-hl.mjs
     node tests/_probe-glam-hl.mjs
     rm apps/games/glam-team-makeover/_before-tune2.html

   Only the CHEEK sweep is measured. The `hl` tool also lays a stripe down the
   nose bridge, and the side split at W/2 cuts that stripe in half and drops half
   into each side's footprint — which bends the spine of whatever is measured
   there. So a band of ±0.8 eye-widths around the eye midpoint is excluded, which
   is comfortably wider than the stripe (±0.20 ew) and comfortably clear of the
   cheek sweep (whose inner edge sits ~1.5 ew out).

   Printed per model × side:
     n     — pixels moved
     peak  — largest single-channel delta
     area  — n in units of one eye's area
     len   — footprint extent along its own principal axis, px
     bowR  — SAGITTA RATIO. The spine (delta-weighted mean of the cross-axis per
             bin along the principal axis) is fitted with a quadratic; bowR is the
             arc's mid-point deviation from its chord, over the chord. An ellipse
             — at ANY rotation, ANY aspect — has a perfectly straight spine, so it
             scores ~0. A kidney bean scores its own curvature.
     bowS  — the sign of that bow, in the side's own frame (+1 = the ends turn up
             toward the eye, i.e. concave toward the socket). Mirrored sides that
             genuinely mirror agree here; a shape merely translated across does
             not.
     xr50  — CROSS-AXIS FALLOFF. The footprint's delta is summed into bins of
             perpendicular offset over the middle 60 % of its length, giving one
             profile across the shape; xr50 is the width of that profile at half
             its maximum over its width at a tenth. 1.0 is a top hat, and the
             plain raised cosine — flat over the inner quarter — is about 0.63.
             Deliberately measured ACROSS and not radially: a swept shape has a
             ridge near peak along its whole length by construction, so any
             whole-footprint measure reads that ridge rather than the fade, and
             would call a smooth sweep a plateau.
     core  — share of the footprint at or above 70 % of peak (whole-footprint,
             kept for continuity with the T4-era numbers).
     r50   — sqrt(A50/A10): equivalent-radius of the ≥50 %-of-peak region over
             that of the ≥10 % region. 1.0 = a top hat, 0 = a spike. */
import { chromium, firefox, webkit } from '@playwright/test';

const PAGE = process.env.PAGE || '/glam-team-makeover/';
const [VW, VH] = (process.env.VIEW || '1280x720').split('x').map(Number);
const MODELS = ['m2', 'm3', 'm4'];

const logic = (page, src) => page.evaluate(({ src }) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  return new Function('L', src)(f.stateNode.logic);
}, { src });

/* Blemishes are HEALED for every frame here. `freshEd` seeds their positions off
   `Math.random`, and a blemish core is a near-opaque dark dot: screening cream
   over one lifts it ~3.5× as far as it lifts skin, so an unlucky seed that drops
   a spot under the sweep moves `peak` from 35 to 50 on that side alone and reads
   as a left/right asymmetry in a shape that is mirror-exact. Healed, the diff is
   the highlight and nothing else. */
const SET = (patch) => `
  const p = ${JSON.stringify(patch)};
  return new Promise((r) => L.setState(() => {
    const ed = JSON.parse(JSON.stringify(window.__BASE_ED));
    ed.pimples = (ed.pimples || []).map(() => 2);
    if (p.cov) Object.assign(ed.cov, p.cov);
    if (p.col) Object.assign(ed.col, p.col);
    return { ed };
  }, r));`;

/* A fixed wait is not enough. Hair masks and eye sprites decode asynchronously
   and repaint when they land, so a base frame and a tool frame taken 400 ms
   apart can differ by a sprite that arrived in between — which lands in the diff
   as a bright patch and moves `peak` by a third on one side of one model. Grab
   only once the compositor has stopped changing. */
const GRAB = () => new Promise((res) => {
  const cv = document.getElementById('gtm-canvas'), cx = cv.getContext('2d');
  const snap = () => cx.getImageData(0, 0, cv.width, cv.height);
  const hash = (d) => { let h = 2166136261;
    for (let i = 0; i < d.data.length; i += 997) h = Math.imul(h ^ d.data[i], 16777619) >>> 0;
    return h; };
  let last = null, same = 0, i = 0;
  const tick = () => {
    const d = snap(), h = hash(d);
    if (h === last) same++; else { same = 0; last = h; }
    if (same >= 4 || ++i > 200) return res({ w: cv.width, h: cv.height, data: Array.from(d.data) });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

/* Kept verbatim in glam-art-fidelity.spec.js as `SWEEP` — edit both together. */
export const SWEEP_SRC = `
  /* Shape of the cheek sweep on one half of the face.
     \`cxm\` is the eye midpoint in px, \`ew\` one eye's width in px: everything
     within 0.8 ew of the midline is the nose stripe and is excluded. */
  const sweepShape = (a, b, w, h, side, cxm, ew) => {
    const lo = side < 0 ? 0 : Math.ceil(cxm + 0.8 * ew);
    const hi = side < 0 ? Math.floor(cxm - 0.8 * ew) : w;
    const D = new Float64Array(w * h);
    let n = 0, peak = 0, px = 0, py = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    const all = [];
    for (let y = 0; y < h; y++) for (let x = Math.max(0, lo); x < Math.min(w, hi); x++) {
      const i = (y * w + x) * 4;
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]),
                         Math.abs(a[i + 2] - b[i + 2]));
      D[y * w + x] = d; if (d <= 2) continue;
      n++; if (d > peak) { peak = d; px = x; py = y; } all.push(d);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (n < 40) return { n };
    all.sort((p, q) => p - q);
    const p99 = all[Math.floor(all.length * 0.99)];

    /* falloff — how much of the footprint sits in the bright core */
    let core = 0, a50 = 0, a10 = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = D[y * w + x]; if (d <= 2) continue;
      if (d >= peak * 0.70) core++;
      if (d >= peak * 0.50) a50++;
      if (d >= peak * 0.10) a10++;
    }

    /* principal axis of the delta-weighted second-moment tensor */
    let sw = 0, sx = 0, sy = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = D[y * w + x]; if (d <= 2) continue; sw += d; sx += d * x; sy += d * y; }
    const mx = sx / sw, my = sy / sw;
    let uxx = 0, uyy = 0, uxy = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = D[y * w + x]; if (d <= 2) continue;
      uxx += d * (x - mx) * (x - mx); uyy += d * (y - my) * (y - my); uxy += d * (x - mx) * (y - my); }
    uxx /= sw; uyy /= sw; uxy /= sw;
    const th = 0.5 * Math.atan2(2 * uxy, uxx - uyy);
    const ct = Math.cos(th), st = Math.sin(th);

    /* spine: mean cross-axis offset per bin along the principal axis */
    const NB = 24, U = [], V = [], Wt = [];
    let u0 = 1e9, u1v = -1e9;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = D[y * w + x]; if (d <= 2) continue;
      const u = (x - mx) * ct + (y - my) * st;
      if (u < u0) u0 = u; if (u > u1v) u1v = u; }
    const span = u1v - u0; if (!(span > 4)) return { n, peak };
    for (let i = 0; i < NB; i++) { U.push(0); V.push(0); Wt.push(0); }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = D[y * w + x]; if (d <= 2) continue;
      const u = (x - mx) * ct + (y - my) * st, v = -(x - mx) * st + (y - my) * ct;
      const bi = Math.min(NB - 1, Math.max(0, Math.floor((u - u0) / span * NB)));
      U[bi] += d * u; V[bi] += d * v; Wt[bi] += d; }
    /* Drop the outermost bins: at the very tips a couple of stray pixels make a
       bin's mean wander, and a quadratic fit is most sensitive exactly there. */
    const pts = [];
    for (let i = 2; i < NB - 2; i++) if (Wt[i] > sw / NB * 0.06) pts.push([U[i] / Wt[i], V[i] / Wt[i], Wt[i]]);
    if (pts.length < 8) return { n, peak };

    /* weighted least squares for v = A u^2 + B u + C */
    let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
    for (const [u, v, wt] of pts) { const u2 = u * u;
      S0 += wt; S1 += wt * u; S2 += wt * u2; S3 += wt * u2 * u; S4 += wt * u2 * u2;
      T0 += wt * v; T1 += wt * u * v; T2 += wt * u2 * v; }
    const M = [[S4, S3, S2], [S3, S2, S1], [S2, S1, S0]], R = [T2, T1, T0];
    for (let c = 0; c < 3; c++) {
      let p = c; for (let r2 = c + 1; r2 < 3; r2++) if (Math.abs(M[r2][c]) > Math.abs(M[p][c])) p = r2;
      [M[c], M[p]] = [M[p], M[c]]; [R[c], R[p]] = [R[p], R[c]];
      if (!M[c][c]) return { n, peak };
      for (let r2 = 0; r2 < 3; r2++) { if (r2 === c) continue; const k = M[r2][c] / M[c][c];
        for (let c2 = c; c2 < 3; c2++) M[r2][c2] -= k * M[c][c2]; R[r2] -= k * R[c]; } }
    const A = R[0] / M[0][0];

    const uMin = pts[0][0], uMax = pts[pts.length - 1][0], L = uMax - uMin;
    const sag = A * (L / 2) * (L / 2);        // arc mid-point minus chord mid-point

    /* Cross-axis profile over the middle 60 % of the sweep. Mirroring a shape
       flips u and leaves v alone, so this profile — and the sagitta with it —
       is the same number on both cheeks when the two are true mirrors. */
    const uA = uMin + L * 0.20, uB = uMax - L * 0.20, VB = 81, VS = 0.5;
    const prof = new Float64Array(VB);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const d = D[y * w + x]; if (d <= 2) continue;
      const u = (x - mx) * ct + (y - my) * st; if (u < uA || u > uB) continue;
      const v = -(x - mx) * st + (y - my) * ct;
      const bi = Math.round(v / VS) + (VB >> 1); if (bi < 0 || bi >= VB) continue;
      prof[bi] += d; }
    let pm = 0; for (const p of prof) if (p > pm) pm = p;
    const wAt = (f) => { let c = 0; for (const p of prof) if (p >= pm * f) c++; return c * VS; };
    const w50 = wAt(0.5), w10 = wAt(0.1);

    return { n, peak, p99, px, py, len: +L.toFixed(1),
      bowR: +(Math.abs(sag) / L).toFixed(4), bowS: sag === 0 ? 0 : (sag > 0 ? 1 : -1),
      xr50: +(w50 / Math.max(VS, w10)).toFixed(4),
      core: +(core / n).toFixed(4), r50: +Math.sqrt(a50 / Math.max(1, a10)).toFixed(4) };
  };`;

if (process.env.EXPORT_ONLY) process.exit(0);

const ENGINE = { chromium, firefox, webkit }[process.env.BROWSER || 'chromium'];
const browser = await ENGINE.launch();
const page = await browser.newPage({ viewport: { width: VW, height: VH }, reducedMotion: 'reduce' });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', (e) => problems.push(e.message));
await page.goto(`http://localhost:8788${PAGE}`);
await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
await page.getByTitle('Show / hide setup').click();
await page.getByRole('button', { name: /^▶ Play/ }).click();
await page.waitForFunction(() => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
}, undefined, { timeout: 20000 });

const shape = new Function('a', 'b', 'w', 'h', 'side', 'cxm', 'ew',
  `${SWEEP_SRC}\n return sweepShape(a,b,w,h,side,cxm,ew);`);

for (const m of MODELS) {
  await logic(page, `return (async () => {
    await new Promise((r) => L.setState({ model: '${m}', ed: L.freshEd('person') }, r));
    for (let i = 0; i < 80 && !L._skinPool('${m}'); i++) await new Promise((r) => setTimeout(r, 100));
    window.__BASE_ED = JSON.parse(JSON.stringify(L.state.ed));
  })();`);
  await logic(page, SET({}));
  await page.waitForTimeout(400);
  const base = await page.evaluate(GRAB);
  const geo = await logic(page, `const f=L.genEntry().face; const cv=document.getElementById('gtm-canvas');
    return { ew:(f.eyeL.w+f.eyeR.w)/2*cv.width, eh:(f.eyeL.h+f.eyeR.h)/2*cv.height,
             cxm:(f.eyeL.x+f.eyeR.x)/2*cv.width };`);
  await logic(page, SET({ cov: { hl: 1 } }));
  await page.waitForTimeout(400);
  const on = await page.evaluate(GRAB);
  for (const side of [-1, 1]) {
    const s = shape(base.data, on.data, base.w, base.h, side, geo.cxm, geo.ew);
    console.log(`${m} hl ${side < 0 ? 'L' : 'R'}`
      + ` n=${String(s.n).padStart(4)} peak=${String(s.peak).padStart(3)}`
      + ` area=${(s.n / (geo.ew * geo.eh)).toFixed(2)}ey len=${String(s.len).padStart(5)}`
      + ` p99=${String(s.p99).padStart(3)} pk@${s.px},${s.py} bowR=${s.bowR} bowS=${String(s.bowS).padStart(2)}`
      + ` xr50=${s.xr50} core=${s.core} r50=${s.r50}`);
  }
  await logic(page, SET({}));
  await page.waitForTimeout(250);
}
await browser.close();
if (problems.length) { console.error('CONSOLE:\n' + problems.join('\n')); process.exit(1); }
