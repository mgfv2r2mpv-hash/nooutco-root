/* HAZARD B for the SECOND PASS's finding U3. Not a spec. Run against :8788:

     PAGE=/glam-team-makeover/_before-tune2b.html node tests/_probe-glam-hitbox.mjs
     node tests/_probe-glam-hitbox.mjs

   U3 changes how the stage FITS, which rescales the client, which moves every
   drag target's rendered rect. `F-11` proves the pixels a tool paints land
   inside the box the child is told to work in - but it works entirely in canvas
   coordinates, so a fit that moved the overlay off the art would leave F-11
   green and the game unplayable. This presses the boxes instead.

   Per model × tool × device it:
     1. arms the tool and reads the target overlay the runtime rendered, from the
        DOM - real page geometry, not the zone table;
     2. checks that rect lies on the client's canvas (a hitbox off the art is the
        failure U3 could have introduced);
     3. drives a REAL pointer inside it - drag for paint tools, click for taps - and checks the tool actually took.

   One tool per SLOT - the trolley stocks a dozen lipstick shades and they are
   one article with one target box, which is the thing under test. That is the
   same 14-ish set F-11 measures, pressed instead of read.

   Each tool gets a fresh turn (`play({keepClient:true})` → `go()`, the game's own
   path) so the auto-scaled action budget never refuses an arm, and the trolley is
   put in the BT's own `staged:'free'` mode so nothing is gated behind an earlier
   step. The arming goes through `arm()`, the call the trolley button makes. */
import { chromium } from '@playwright/test';

const PAGE = process.env.PAGE || '/glam-team-makeover/';
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
  { tag: 'phone', width: 390, height: 844 },
];

const logic = (page, src) => page.evaluate(({ src }) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  return new Function('L', src)(f.stateNode.logic);
}, { src });

const painted = () => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
};

const browser = await chromium.launch();
const problems = [];
const rows = [];

for (const d of DEVICES) {
  const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, reducedMotion: 'reduce' });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${d.tag}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${d.tag}: ${e.message}`));
  await page.goto(`http://localhost:8788${PAGE}`);
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await page.getByTitle('Show / hide setup').click();
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go - / }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });

  const models = await page.evaluate(() => window.GlamStory.MODELS);
  for (const m of models) {
    await logic(page, `return (async () => {
      await new Promise((r) => L.setState({ model:'${m}', ed:L.freshEd('person') }, r));
      for (let i = 0; i < 80 && !L._skinPool('${m}'); i++) await new Promise((r) => setTimeout(r, 100));
    })();`);

    // every tool the trolley can offer, in the order it offers them
    const tools = await logic(page, `const seen = new Set();
      return L.cfg().cats.flatMap((g) => g.options || [])
        .filter((o) => (o.mech === 'paint' || o.mech === 'tap')
          && !seen.has(o.slot) && seen.add(o.slot))
        .map((o) => ({ id:o.id, label:o.label, mech:o.mech, slot:o.slot }));`);

    for (const t of tools) {
      /* Clear the look and the turn's action ledger before each tool. Without
         the ledger reset `arm()` starts REFUSING once the auto-scaled budget is
         spent, which is correct game behaviour and useless here - this is about
         the geometry of a target that is offered, not about the cap. */
      await logic(page, `return (async () => {
        L.play({ keepClient:true }); await new Promise((r) => setTimeout(r, 60));
        L.go(); await new Promise((r) => setTimeout(r, 60));
        await new Promise((r) => L.setState((s) => {
          const ed = JSON.parse(JSON.stringify(s.ed));
          ed.pimples = (ed.pimples || []).map(() => 2);
          return { ed, armed:null, staged:'free' };
        }, r));
      })();`);
      await logic(page, `return L.arm(L.cfg().cats.flatMap((g) => g.options || [])
        .find((o) => o.id === ${JSON.stringify(t.id)}));`);
      await page.waitForTimeout(140);

      const armed = await logic(page, `return !!L.state.armed;`);
      if (!armed) { problems.push(`${d.tag}/${m}/${t.id}: arm() left nothing armed`); continue; }
      /* The overlay is found by its dashed rim rather than by a class: only the
         drag targets carry `.gtm-tool`, and React normalises the inline style, so
         an attribute-substring selector silently matched no tap target at all. */
      const tagged = await page.evaluate(() => {
        const box = document.getElementById('gtm-canvas').parentElement;
        for (const e of box.children) {
          if (getComputedStyle(e).borderTopStyle === 'dashed') { e.id = 'gtm-target-probe'; return true; }
        }
        return false;
      });
      const el = page.locator('#gtm-target-probe');
      const box = tagged ? await el.boundingBox({ timeout: 2000 }).catch(() => null) : null;
      if (!box) { problems.push(`${d.tag}/${m}/${t.id}: no target overlay rendered`); continue; }

      // the overlay has to sit on the client's own canvas, not beside it
      const cr = await page.locator('#gtm-canvas').boundingBox();
      const off = [
        box.x < cr.x - 0.6 ? 'left' : null,
        box.y < cr.y - 0.6 ? 'top' : null,
        box.x + box.width > cr.x + cr.width + 0.6 ? 'right' : null,
        box.y + box.height > cr.y + cr.height + 0.6 ? 'bottom' : null,
      ].filter(Boolean);
      if (off.length) problems.push(`${d.tag}/${m}/${t.id}: target overlay hangs off the art (${off.join(', ')})`);

      const before = await logic(page, `return JSON.stringify(L.state.ed);`);
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      if (t.mech === 'paint') {
        await page.mouse.move(box.x + box.width * 0.15, cy);
        await page.mouse.down();
        for (let i = 1; i <= 20; i++) {
          await page.mouse.move(box.x + box.width * (0.15 + 0.7 * i / 20),
            cy + box.height * 0.22 * Math.sin(Math.PI * i / 10));
          await page.waitForTimeout(8);
        }
        await page.mouse.up();
      } else {
        await page.mouse.click(cx, cy);
      }
      await page.waitForTimeout(220);
      const after = await logic(page, `return JSON.stringify(L.state.ed);`);
      const took = before !== after;
      if (!took) problems.push(`${d.tag}/${m}/${t.id}: real pointer inside the target changed nothing`);
      rows.push({ device: d.tag, model: m, tool: t.id, mech: t.mech, took,
        box: `${Math.round(box.width)}×${Math.round(box.height)}` });
      await page.evaluate(() => { const e = document.getElementById('gtm-target-probe'); if (e) e.removeAttribute('id'); });
    }
  }
  await page.close();
}

await browser.close();
const byDevice = {};
for (const r of rows) {
  const k = r.device;
  byDevice[k] = byDevice[k] || { n: 0, took: 0, min: 1e9 };
  byDevice[k].n++; if (r.took) byDevice[k].took++;
  byDevice[k].min = Math.min(byDevice[k].min, ...r.box.split('×').map(Number));
}
for (const [k, v] of Object.entries(byDevice)) {
  console.log(`${k.padEnd(8)} ${v.took}/${v.n} model×tool combinations took a real pointer inside their own target; smallest target side ${v.min}px`);
}
if (problems.length) { console.error('\nPROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log('\nEvery target the runtime rendered sits on the art and answers a real pointer.');
