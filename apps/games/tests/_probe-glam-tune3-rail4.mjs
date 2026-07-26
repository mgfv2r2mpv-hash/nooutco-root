/* THIRD PASS · rail correction probe 4 — contrast, after the rail got shorter.
   Not a spec.  Run against a hash-verified :8788:

     node tests/_probe-glam-tune3-rail4.mjs

   Shortening the rail COMPRESSES the sand gradient behind the type and moves
   every line to a new position in it, so W6's "clears 3:1" has to be re-asked
   rather than inherited.  For each piece of rail type this reads the element's
   own colour and its vertical centre, resolves the band's painted gradient at
   exactly that y (sRGB interpolation between the declared stops, which is what
   `linear-gradient` does), and prints the WCAG 2.x contrast ratio — plus the
   ratio against the band's darkest stop, which is the worst any of it can be. */
import { chromium } from '@playwright/test';

const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'phone', width: 390, height: 844 },
];

const painted = () => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
};

/* WCAG 2.x relative luminance + contrast, on 0-255 sRGB triples. */
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const la = lum(a), lb = lum(b);
  return +(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)).toFixed(3)); };
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/* The band's own declared gradient (index.html · bandStyle). */
const STOPS = [[0, [0xcd, 0xb3, 0x83]], [0.58, [0xbd, 0xa0, 0x6e]], [1, [0xa9, 0x8d, 0x5d]]];
const sand = (t) => {
  const u = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (u <= STOPS[i][0]) {
      const [p0, c0] = STOPS[i - 1], [p1, c1] = STOPS[i];
      const k = (u - p0) / (p1 - p0);
      return c0.map((v, j) => v + k * (c1[j] - v));
    }
  }
  return STOPS[STOPS.length - 1][1];
};

const browser = await chromium.launch();
for (const d of DEVICES) {
  for (const phase of ['my', 'their']) {
    const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, reducedMotion: 'reduce' });
    await page.goto('http://localhost:8788/glam-team-makeover/');
    await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
    await page.getByTitle('Show / hide setup').click();
    await page.getByLabel('Character', { exact: true }).selectOption('m4');
    await page.getByRole('button', { name: /^▶ Play/ }).click();
    await page.getByRole('button', { name: /Go —/ }).click();
    await page.waitForFunction(painted, undefined, { timeout: 20000 });
    if (phase === 'their') { await page.getByRole('button', { name: /Done — their turn/ }).click(); }
    await page.waitForTimeout(350);

    const parts = await page.evaluate(() => {
      const band = document.querySelector('.gtm-band');
      const br = band.getBoundingClientRect();
      const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
      const of = (sel, what) => {
        const e = band.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { what, ink: rgb(getComputedStyle(e).color),
                 top: +((r.top - br.top) / br.height).toFixed(3),
                 mid: +((r.top + r.height / 2 - br.top) / br.height).toFixed(3),
                 bot: +((r.bottom - br.top) / br.height).toFixed(3) };
      };
      const pip = band.querySelector('.gtm-pip');
      const pipR = pip && pip.getBoundingClientRect();
      return {
        railH: +br.height.toFixed(1),
        parts: [of('.gtm-band-eyebrow', 'eyebrow (whose turn)'), of('.gtm-band-line', 'whose-turn line'),
                of('.gtm-band-meter', 'actions-left label')].filter(Boolean),
        pip: pip ? { what: 'filled pip', ink: rgb(getComputedStyle(pip).backgroundColor),
                     top: +((pipR.top - br.top) / br.height).toFixed(3),
                     mid: +((pipR.top + pipR.height / 2 - br.top) / br.height).toFixed(3),
                     bot: +((pipR.bottom - br.top) / br.height).toFixed(3) } : null,
      };
    });

    console.log(`\n=== ${d.tag} ${d.width}×${d.height} · ${phase} turn · rail ${parts.railH}px`);
    for (const p of [...parts.parts, parts.pip].filter(Boolean)) {
      if (!p.ink.length) continue;
      const bgMid = sand(p.mid), bgBot = sand(p.bot);
      console.log(`  ${p.what.padEnd(22)} ink ${hex(p.ink)}  sits ${(p.top * 100).toFixed(0)}–${(p.bot * 100).toFixed(0)}% down the band`);
      console.log(`     vs sand at its centre  ${hex(bgMid)}  →  ${ratio(p.ink, bgMid)}:1`);
      console.log(`     vs sand at its foot    ${hex(bgBot)}  →  ${ratio(p.ink, bgBot)}:1`);
      console.log(`     vs the band's darkest  #a98d5d  →  ${ratio(p.ink, [0xa9, 0x8d, 0x5d])}:1`);
    }
    await page.close();
  }
}
await browser.close();
