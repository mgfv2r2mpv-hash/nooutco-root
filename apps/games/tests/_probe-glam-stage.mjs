/* Geometry probe for SECOND-PASS finding B (the stage crops the game art).
   Not a spec. Run against a server on :8788:

     PAGE=/glam-team-makeover/_before-tune2.html node tests/_probe-glam-stage.mjs
     node tests/_probe-glam-stage.mjs

   Reports, per device, the stage panel's content box, the doll box, and - the
   whole point - the backdrop's PAINTED rect worked out from the panel's own
   computed `background-size` / `background-position`, so "is the mirror whole?"
   is answered by geometry rather than by squinting at a screenshot.

   A composition is UNCROPPED when the painted backdrop rect sits inside the
   panel's padding box on all four edges. `cover` can never satisfy that unless
   the panel's aspect ratio happens to equal the art's exactly. */
import { chromium } from '@playwright/test';

const PAGE = process.env.PAGE || '/glam-team-makeover/';
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
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

/* Resolve where the salon backdrop actually lands. It may ride on the stage
   panel itself (pre-change: background-size:cover) or on a dedicated fit box
   inside it (post-change), so look for whichever element carries the image. */
const measure = () => {
  const cv = document.getElementById('gtm-canvas');
  const doll = cv.parentElement;
  let stage = doll;
  while (stage && !/border-radius:\s*16px/.test(stage.getAttribute('style') || '')) stage = stage.parentElement;
  let bgEl = null;
  for (let e = doll; e; e = e.parentElement) {
    const bi = getComputedStyle(e).backgroundImage;
    if (bi && bi !== 'none' && /url\(/.test(bi)) { bgEl = e; break; }
  }
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
  const out = { stage: R(stage), doll: R(doll), bgEl: bgEl ? R(bgEl) : null };
  if (!bgEl) return out;
  const cs = getComputedStyle(bgEl);
  const b = R(bgEl);
  out.bgSize = cs.backgroundSize.split(',')[0].trim();
  out.bgPos = cs.backgroundPosition.split(',')[0].trim();
  out.bgOrigin = cs.backgroundOrigin.split(',')[0].trim();
  const url = (cs.backgroundImage.match(/url\("?([^")]+)"?\)/) || [])[1];
  const im = new Image();
  im.src = url;
  return im.decode().then(() => {
    // the positioning area: padding box, or the content box when background-origin says so
    const pad = ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs['padding' + s]) || 0);
    const bd = ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs['border' + s + 'Width']) || 0);
    const inset = out.bgOrigin === 'content-box' ? pad.map((v, i) => v + bd[i]) : bd;
    const area = { x: b.x + inset[3], y: b.y + inset[0], w: b.w - inset[1] - inset[3], h: b.h - inset[0] - inset[2] };
    const nat = im.naturalWidth / im.naturalHeight;
    const k = out.bgSize === 'cover' ? Math.max(area.w / im.naturalWidth, area.h / im.naturalHeight)
      : Math.min(area.w / im.naturalWidth, area.h / im.naturalHeight);
    const w = im.naturalWidth * k, h = im.naturalHeight * k;
    const yAnchor = /bottom/.test(out.bgPos) ? area.y + area.h - h : area.y + (area.h - h) / 2;
    out.natural = `${im.naturalWidth}×${im.naturalHeight} (aspect ${nat.toFixed(3)})`;
    out.art = { x: +(area.x + (area.w - w) / 2).toFixed(1), y: +yAnchor.toFixed(1), w: +w.toFixed(1), h: +h.toFixed(1) };
    return out;
  });
};

const browser = await chromium.launch();
const rows = [];
for (const d of DEVICES) {
  const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, reducedMotion: 'reduce' });
  await page.goto(`http://localhost:8788${PAGE}`);
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Character', { exact: true }).selectOption('m4');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go - / }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(measure);
  const st = m.stage, a = m.art;
  const bleed = a ? {
    top: +(st.y - a.y).toFixed(1), bottom: +((a.y + a.h) - (st.y + st.h)).toFixed(1),
    left: +(st.x - a.x).toFixed(1), right: +((a.x + a.w) - (st.x + st.w)).toFixed(1),
  } : null;
  rows.push({ device: d.tag, stage: `${st.w}×${st.h}`, aspect: +(st.w / st.h).toFixed(3), doll: `${m.doll.w}×${m.doll.h}`,
    bgSize: m.bgSize, art: a ? `${a.w}×${a.h}` : ' - ', bleed,
    clientShare: a ? +(m.doll.h / a.h).toFixed(3) : null,
    fits: m.doll.h <= st.h && m.doll.w <= st.w });
  await page.close();
}
await browser.close();
for (const r of rows) {
  console.log(`${r.device.padEnd(8)} stage ${r.stage.padEnd(11)} (aspect ${r.aspect})  client ${r.doll.padEnd(13)} bg-size ${String(r.bgSize).padEnd(8)} art ${r.art}  client/art ${r.clientShare}`);
  if (r.bleed) {
    const over = Object.entries(r.bleed).filter(([, v]) => v > 0.5);
    console.log(`         art bleeds past the panel: ${over.length ? over.map(([k, v]) => `${k} +${v}px`).join(', ') : 'NONE - composition is whole'}`);
  }
}
