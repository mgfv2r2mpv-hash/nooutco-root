/* THIRD PASS · rail correction probe 2 — the WORST CASE, not the case that
   happens to be on screen.  Not a spec.  Run against a hash-verified :8788:

     node tests/_probe-glam-tune3-rail2.mjs

   The single-line question is decided by the longest whose-turn line the game
   can put in the rail, not by the one the default trial opens on.  This walks
   every string `renderVals` can assign to `instruction`, measures each at the
   rail's own computed font at BOTH breakpoints, and prints the budget: inner
   width minus token, eyebrow, gaps and the meter block, against what the
   longest line wants.  A negative slack is a rail that truncates. */
import { chromium } from '@playwright/test';

const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
  { tag: 'phone', width: 390, height: 844 },
];

/* Every literal `instruction` takes in renderVals, plus the two-digit budget
   form a short `turns` setting produces ("I can do 19 more"). */
const LINES = [
  'My turn is ready — tap Go!',
  'My turn — add some things!',
  'My turn — I can do 7 more',
  'My turn — I can do 19 more',
  'All set — now I hand it over!',
  'Their turn — I wait 🕐',
  'Their turn is done',
];
const EYEBROWS = ['MY TURN', 'THEIR TURN'];
const METERS = ['Actions left', 'Their actions left'];

const painted = () => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
};

const browser = await chromium.launch();
for (const d of DEVICES) {
  const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, reducedMotion: 'reduce' });
  await page.goto('http://localhost:8788/glam-team-makeover/');
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Character', { exact: true }).selectOption('m4');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go —/ }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });
  await page.waitForTimeout(250);

  const out = await page.evaluate(({ LINES, EYEBROWS, METERS }) => {
    const band = document.querySelector('.gtm-band');
    const line = band.querySelector('.gtm-band-line');
    const eyebrow = band.querySelector('.gtm-band-eyebrow');
    const meterLabel = band.querySelector('.gtm-band-meter');
    const width = (proto, text) => {
      const cs = getComputedStyle(proto);
      const p = document.createElement('span');
      p.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;visibility:hidden;'
        + 'font:' + cs.font + ';letter-spacing:' + cs.letterSpacing + ';text-transform:' + cs.textTransform;
      p.textContent = text;
      document.body.appendChild(p);
      const w = +p.getBoundingClientRect().width.toFixed(1);
      p.remove();
      return w;
    };
    const bcs = getComputedStyle(band);
    const inner = +(band.getBoundingClientRect().width
      - parseFloat(bcs.paddingLeft) - parseFloat(bcs.paddingRight)).toFixed(1);
    const pip = band.querySelector('.gtm-pip');
    const pipW = pip ? +pip.getBoundingClientRect().width.toFixed(1) : 0;
    const pipRow = band.querySelector('.gtm-band-pips');
    const say = band.querySelector('.gtm-band-say');
    return {
      fontLoaded: document.fonts.check('800 15px "Atkinson Hyperlegible"'),
      lineFamily: getComputedStyle(line).fontFamily,
      pipGap: pipRow ? getComputedStyle(pipRow).gap : '(inline)',
      bandPad: bcs.padding, bandGap: bcs.gap, sayGap: say ? getComputedStyle(say).gap : '(none)',
      sayH: say ? +say.getBoundingClientRect().height.toFixed(1) : null,
      meterH: +band.lastElementChild.getBoundingClientRect().height.toFixed(1),
      railW: +band.getBoundingClientRect().width.toFixed(1),
      railH: +band.getBoundingClientRect().height.toFixed(1),
      inner, pipW, fontLine: bcs.fontSize + ' → ' + getComputedStyle(line).fontSize,
      token: +band.querySelector('.gtm-band-token').getBoundingClientRect().width.toFixed(1),
      lines: LINES.map((t) => [t, width(line, t)]),
      eyebrows: EYEBROWS.map((t) => [t, width(eyebrow, t)]),
      meters: METERS.map((t) => [t, width(meterLabel, t)]),
    };
  }, { LINES, EYEBROWS, METERS });

  const g = parseFloat(out.bandGap) || 0;         // token↔say and say↔meter
  const sg = parseFloat(out.sayGap) || 0;         // eyebrow↔line
  const pg = parseFloat(out.pipGap) || 0;
  const w = (rows, t) => rows.find((r) => r[0] === t)[1];
  /* The two phases that can actually occur, each at ITS OWN worst string — not
     the cross-product, which pairs a my-turn line with a their-turn label. */
  const CASES = [
    ['my turn   ', 'MY TURN', Math.max(...out.lines.filter((l) => !/^Their/.test(l[0])).map((l) => l[1])), 'Actions left', 7],
    ['their turn', 'THEIR TURN', Math.max(...out.lines.filter((l) => /^Their/.test(l[0])).map((l) => l[1])), 'Their actions left', 4],
  ];

  console.log(`\n=== ${d.tag} ${d.width}×${d.height}`);
  console.log(`  rail ${out.railW}×${out.railH}  inner ${out.inner}  pad ${out.bandPad}  gap ${out.bandGap}/${out.sayGap}  pip ${out.pipW}@${out.pipGap}`);
  console.log(`  token ${out.token}  say-row h ${out.sayH}  meter h ${out.meterH}  line-font ${out.fontLine}`);
  console.log(`  webfont loaded: ${out.fontLoaded}  family ${out.lineFamily}`);
  out.lines.forEach(([t, x]) => console.log(`    line   ${String(x).padStart(6)}  "${t}"`));
  out.eyebrows.forEach(([t, x]) => console.log(`    eyebr  ${String(x).padStart(6)}  "${t}"`));
  out.meters.forEach(([t, x]) => console.log(`    meter  ${String(x).padStart(6)}  "${t}"`));
  for (const [tag, eb, lineW, ml, nPips] of CASES) {
    const pipsW = nPips * out.pipW + (nPips - 1) * pg;
    const meterW = Math.max(w(out.meters, ml), pipsW);
    const need = out.token + g + w(out.eyebrows, eb) + sg + lineW + g + meterW;
    console.log(`  ${tag}: token ${out.token} + ${g} + eyebrow ${w(out.eyebrows, eb)} + ${sg} + line ${lineW} + ${g} + meter ${meterW.toFixed(1)} (${nPips} pips ${pipsW.toFixed(1)})`);
    console.log(`              need ${need.toFixed(1)}  vs inner ${out.inner}  →  SLACK ${(out.inner - need).toFixed(1)}`);
  }

  await page.close();
}
await browser.close();
