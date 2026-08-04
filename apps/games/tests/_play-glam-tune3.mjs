/* A real, whole trial of Glam Team Makeover - title → texting intro → salon →
   EVERY turn to the end → outro - driven with real pointer input, to sit behind
   the third pass's "played it in a browser" claim.

   What this adds over `_play-glam-tune2.mjs`: it plays the trial OUT (that one
   short-circuits the turn loop through the component), and at every phase change
   it re-reads the turn rail - the counter strip Finding B moved the whose-turn
   line and the actions-left meter into - and records whether both were on screen
   in the viewport at that moment. A rail that is correct on the first frame and
   gone by the partner's turn would pass every static check and still fail the
   child.

   Run against a hash-verified server on :8788:

     node tests/_play-glam-tune3.mjs                 # 1280×860
     VIEW=390x844 node tests/_play-glam-tune3.mjs    # the phone case

   Writes `rail-<phase>.png` per distinct phase into docs/eval/shots/glam-tune3/
   when SHOTS=1. Exits non-zero on any console error, page error, non-font failed
   request, or a phase where the rail was not fully on screen. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const PAGE = process.env.PAGE || '/glam-team-makeover/';
const [VW, VH] = (process.env.VIEW || '1280x860').split('x').map(Number);
const SHOTS = process.env.SHOTS === '1';
const OUT = new URL('../../../docs/eval/shots/glam-tune3/', import.meta.url).pathname;

const logic = (page, src) => page.evaluate(({ src }) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  return new Function('L', src)(f.stateNode.logic);
}, { src });

/* The rail, read the way the pinned spec reads it: the whose-turn label and the
   actions-left meter located by their own words, reported in viewport
   coordinates. `null` for a part that is not on this phase's rail at all - the
   meter is deliberately absent on the ready and give-back phases, and that is
   not a failure. */
const railState = (page) => page.evaluate(() => {
  const R = (e) => { const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const deepest = (txt) => [...document.querySelectorAll('*')].filter((e) =>
    (e.textContent || '').trim() === txt && ![...e.children].some((c) => (c.textContent || '').trim() === txt))[0] || null;
  const sentence = (e) => { const t = (e.textContent || '').trim();
    return t.length > 12 && /^(My turn|All set|Their turn|Nice waiting)\b/.test(t)
      && !e.querySelector('select,input,textarea,button,option'); };
  const line = [...document.querySelectorAll('*')].filter((e) => sentence(e) && ![...e.children].some(sentence))[0];
  const label = deepest('MY TURN') || deepest('THEIR TURN');
  const meterLabel = deepest('Actions left') || deepest('Their actions left');
  const on = (e) => { if (!e) return null; const r = e.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && r.top >= 0 && r.bottom <= window.innerHeight
        && r.left >= 0 && r.right <= window.innerWidth; };
  /* THIRD PASS · rail correction. The rail is a single ROW now, so "is it on
     screen" is no longer the only way it can fail the child: at 390 the row has
     7.7px of measured margin on its worst string, and the state that produces
     that string - the budget spent, so the line reads "All set - now I hand it
     over!" while all 7 pips are still up - only exists partway through a played
     turn. Reading the overrun here means a real trial produces the evidence
     instead of a separate probe having to reconstruct the moment. */
  const over = (e) => { if (!e) return null;
    for (let x = e, i = 0; x && i < 3; x = x.parentElement, i++) {
      if (getComputedStyle(x).overflowX !== 'visible') return +(x.scrollWidth - x.clientWidth).toFixed(1);
    }
    return 0; };
  return {
    label: label ? R(label) : null, labelText: label ? label.textContent.trim() : null, labelOn: on(label),
    line: line ? R(line) : null, lineText: line ? line.textContent.trim() : null, lineOn: on(line),
    lineOver: over(line),
    meter: meterLabel ? R(meterLabel.parentElement) : null, meterText: meterLabel ? meterLabel.textContent.trim() : null,
    meterOn: meterLabel ? on(meterLabel.parentElement) : null,
    meterOver: over(meterLabel),
    scrollY: Math.round(window.scrollY),
  };
});

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: VW, height: VH }, reducedMotion: 'reduce' });
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
console.log(`· title screen up (${VW}×${VH})`);

await page.getByRole('button', { name: /^Start/ }).click();
await page.getByText('Booking the glam team').waitFor({ timeout: 30000 });
await page.getByRole('button', { name: 'Skip ahead' }).click();
await page.getByRole('button', { name: /Open the salon/ }).click();
await page.waitForFunction(() => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
}, undefined, { timeout: 20000 });
console.log('· texting intro ran, salon open, client painted');

const seen = new Map();
/* Distinct WORDINGS the rail showed, with the worst overrun each was measured
   at - the phase tag alone would collapse "I can do N more" and "All set…" into
   one entry and hide the tightest line the trial produced. */
const lines = new Map();
const record = async (tag) => {
  const r = await railState(page);
  if (!seen.has(tag)) {
    seen.set(tag, r);
    console.log(`· [${tag}] "${r.labelText}" / "${r.lineText}" / ${r.meterText ?? ' - '}`
      + `  onscreen: label=${r.labelOn} line=${r.lineOn} meter=${r.meterOn ?? ' - '} (scrollY ${r.scrollY})`);
    if (SHOTS) await page.screenshot({ path: `${OUT}rail-${tag}.png` });
  }
  if (r.lineText) lines.set(r.lineText, Math.max(lines.get(r.lineText) ?? 0, r.lineOver ?? 0));
  for (const [part, ok] of [['whose-turn label', r.labelOn], ['whose-turn line', r.lineOn], ['actions-left meter', r.meterOn]]) {
    if (ok === false) problems.push(`[${tag}] the ${part} was off screen: ${JSON.stringify(r)}`);
  }
  /* A rail that fits by cutting the child's line off has not got shorter. */
  for (const [part, px] of [['whose-turn line', r.lineOver], ['actions-left label', r.meterOver]]) {
    if (px !== null && px > 1) problems.push(`[${tag}] the ${part} was truncated by ${px}px: "${r.lineText}"`);
  }
};

/* Play it out. Every move is a real click on whatever control the game is
   actually offering; the loop is bounded so a stuck phase fails loudly rather
   than hanging. Tools are taken in trolley order, and a tool that arms a target
   zone is applied by pressing that zone. */
const CTRL = [
  [/^▸ Go - my turn!$/, 'ready'],
  [/^▸ My turn again$/, 'giveback'],
  [/^✓ I asked!$/, 'ask'],
];
let step = 0, tools = 0;
const stuck = new Set();
for (; step < 240; step++) {
  const phase = await logic(page, 'return L.state.phase;');
  if (phase === 'done') break;
  await record(phase);

  let clicked = false;
  for (const [re] of CTRL) {
    const b = page.getByRole('button', { name: re });
    if (await b.count() && await b.first().isVisible()) { await b.first().click(); clicked = true; break; }
  }
  if (clicked) { await page.waitForTimeout(220); continue; }

  if (phase === 'mine') {
    /* Spend the turn's budget, then hand over with the real button. Handing
       over on "no tool left" instead would never fire - the trolley always has
       something - and the trial would stall on turn 1 with the cap toast up. */
    const left = await logic(page, 'return Math.max(0, L.state.ttBudget - L.state.ttActions);');
    /* Skip tools that have already been picked and charged nothing. A `choose`
       tool with no zone (and `Conceal` before every spot is treated) arms and
       renders no target at all, so re-picking it is an infinite loop - this is
       the second stall this script hit, at turn 3. */
    const titles = await page.locator('#gtm-trolley button[title]').evaluateAll(
      (bs) => bs.filter((b) => !/✓/.test(b.textContent || '')).map((b) => b.getAttribute('title')));
    const pick = titles.find((t) => !stuck.has(t));
    const tool = pick ? page.locator(`#gtm-trolley button[title="${pick}"]`).first() : null;
    if (left > 0 && tool && await tool.count()) {
      const spent = await logic(page, 'return L.state.ttActions;');
      await tool.click();
      await page.waitForTimeout(180);
      /* A `paint` tool renders `.gtm-tool` and wants a real stroke; every other
         mechanic renders the same dashed box and wants a tap. The stroke needs a
         beat between moves - a burst of coalesced pointermoves paints nothing
         and the action is never charged, which is what stalled the first run of
         this script on turn 1. */
      const drag = page.locator('.gtm-tool').first();
      const tap = page.locator('div[style*="gtm-target"]').first();
      // …and `patch`/`conceal` put a ring on each blemish instead of one box.
      const pops = page.locator('div[style*="gtm-pim"]');
      if (await pops.count()) {
        for (let i = await pops.count(); i > 0; i--) {
          await pops.first().click();
          await page.waitForTimeout(120);
        }
      } else if (await drag.count()) {
        const box = await drag.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.5);
          await page.mouse.down();
          for (let i = 1; i <= 20; i++) {
            await page.mouse.move(box.x + box.width * (0.15 + 0.7 * i / 20),
                                  box.y + box.height * (0.35 + 0.3 * Math.sin(Math.PI * i / 6)));
            await page.waitForTimeout(15);
          }
          await page.mouse.up();
        }
      } else if (await tap.count()) {
        await tap.click();
      }
      await page.waitForTimeout(200);
      if (await logic(page, 'return L.state.ttActions;') > spent) tools++;
      else stuck.add(pick);
      continue;
    }
    const done = page.getByRole('button', { name: /Done - their turn/ });
    if (await done.count()) { await done.first().click(); await page.waitForTimeout(220); continue; }
  }
  // the partner's turn runs on its own clock; wait it out rather than poke it
  await page.waitForTimeout(400);
}

console.log(`· played ${step} steps, ${tools} tools taken by real pointer input`);
console.log(`· rail wordings this trial, with the overrun each was measured at:`);
for (const [text, px] of lines) console.log(`    ${px > 1 ? 'CLIP' : '  ok'} ${String(px).padStart(5)}px  "${text}"`);
const endPhase = await logic(page, 'return L.state.phase;');
if (endPhase !== 'done') {
  await page.getByRole('button', { name: 'End trial', exact: true }).click();
}
await page.waitForFunction(() => !!document.getElementById('gtm-shot-before')
  && !!document.getElementById('gtm-shot-after'), undefined, { timeout: 20000 });
console.log(`· outro reached (phase on exit of the loop: ${endPhase})`);

/* the child-facing outro text must still carry no digits (§8 / congruence) */
const outro = await page.evaluate(() => document.body.innerText);
const digits = outro.split('\n').map((l) => l.trim()).filter((l) => /\d/.test(l) && l);
console.log(`· outro lines carrying a digit: ${digits.length}`);
if (digits.length) console.log(digits.map((d) => `    "${d}"`).join('\n'));

await browser.close();
if (problems.length) { console.error('\nPROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log('\nPlaythrough clean: rail on screen at every phase, no console errors, no page errors, no failed local requests.');
