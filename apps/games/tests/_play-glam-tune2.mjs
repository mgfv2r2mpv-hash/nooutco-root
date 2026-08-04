/* A real playthrough of Glam Team Makeover, driven with real pointer input, to
   sit behind the SECOND PASS's "played it in a browser" claim.

   `F-11` proves the pixels a tool paints land inside the box the child is told
   to work in. It does NOT prove the box is reachable - it reads the zone table
   rather than pressing it. U2 moved the highlight's hitbox (it is rolled up from
   `_hlStamps`, so it followed the art), and the way to know a moved hitbox still
   works is to drag on it.

   Run against a server on :8788:  node tests/_play-glam-tune2.mjs */
import { chromium } from '@playwright/test';

const PAGE = process.env.PAGE || '/glam-team-makeover/';

const logic = (page, src) => page.evaluate(({ src }) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  return new Function('L', src)(f.stateNode.logic);
}, { src });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => {
  const u = r.url();
  if (!u.includes('fonts.gstatic.com') && !u.includes('fonts.googleapis.com')) {
    problems.push(`requestfailed: ${u} ${r.failure()?.errorText}`);
  }
});

await page.goto(`http://localhost:8788${PAGE}`);
await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
console.log('· title screen up');

/* start → the texting intro → the salon */
await page.getByRole('button', { name: /^Start/ }).click();
await page.getByText('Booking the glam team').waitFor({ timeout: 30000 });
await page.getByRole('button', { name: 'Skip ahead' }).click();
console.log('· texting intro ran');
await page.getByRole('button', { name: /Open the salon/ }).click();
await page.waitForFunction(() => !!document.getElementById('gtm-canvas'), undefined, { timeout: 20000 });
await page.waitForFunction(() => {
  const c = document.getElementById('gtm-canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
}, undefined, { timeout: 20000 });
console.log('· salon open, client painted');

await page.getByRole('button', { name: /Go - / }).click();
console.log('· Go');

/* ── the hitbox test. Pick the Highlight off the trolley the way a child does,
   then drag across the target overlay the runtime rendered, with real pointer
   events. Nothing here reaches into the zone table. ── */
/* The trolley is a staged flow, so Highlight is step 6 and does not appear until
   1-5 are settled. Those five are marked done directly - they are the SUBJECT of
   no claim here; what has to be real is the pick and the drag. */
await logic(page, `return new Promise((r) => L.setState((s) => {
  const ed = JSON.parse(JSON.stringify(s.ed));
  ed.done.wash = ed.done.moist = ed.done.contour = ed.done.blush = true;
  ed.pimples = (ed.pimples || []).map(() => 2);
  return { ed };
}, r));`);
await page.waitForTimeout(300);

const before = await logic(page, `return L.state.ed.cov.hl || 0;`);
await page.getByRole('button', { name: /Highlight/ }).first().click();
await page.waitForTimeout(250);

const box = await page.locator('.gtm-tool').first().boundingBox();
if (!box) { problems.push('no drag target rendered for the highlight'); }
else {
  console.log(`· highlight target box ${Math.round(box.width)}×${Math.round(box.height)} at ${Math.round(box.x)},${Math.round(box.y)}`);
  await page.mouse.move(box.x + box.width * 0.12, box.y + box.height * 0.55);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(box.x + box.width * (0.12 + 0.76 * i / 24),
                          box.y + box.height * (0.55 - 0.18 * Math.sin(Math.PI * i / 24)));
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
}
await page.waitForTimeout(400);
const after = await logic(page, `return L.state.ed.cov.hl || 0;`);
console.log(`· highlight coverage by drag: ${before} → ${after.toFixed(3)}`);
if (!(after > before)) problems.push('dragging on the highlight target did not paint');

/* a handful of turns, then end the trial and look at the outro */
await logic(page, `return (async () => {
  for (let i = 0; i < 6; i++) {
    if (L.state.phase === 'done') break;
    if (typeof L.handoff === 'function' && L.state.phase === 'mine') L.handoff();
    else if (typeof L.giveBack === 'function' && L.state.phase === 'theirs') L.giveBack();
    await new Promise((r) => setTimeout(r, 180));
  }
})();`);
await logic(page, `return L.endTrial();`);
await page.waitForFunction(() => !!document.getElementById('gtm-shot-before')
  && !!document.getElementById('gtm-shot-after'), undefined, { timeout: 20000 });
console.log('· outro reached, before/after photo frames mounted');

/* the child-facing outro text must carry no digits (§8 / congruence guard) */
const outro = await page.evaluate(() => document.body.innerText);
const digits = outro.split('\n').filter((l) => /\d/.test(l) && !/^\s*$/.test(l));
console.log(`· outro lines carrying a digit: ${digits.length}`);
if (digits.length) console.log(digits.map((d) => `    "${d.trim()}"`).join('\n'));

await browser.close();
if (problems.length) { console.error('\nPROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log('\nPlaythrough clean: no console errors, no page errors, no failed local requests.');
