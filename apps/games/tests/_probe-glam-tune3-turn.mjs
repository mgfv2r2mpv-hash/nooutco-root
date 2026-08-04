/* Finding B probe - where does the turn indicator live, and does it survive a
   scroll to the trolley?  Not a spec.  Run against a hash-verified :8788:

     PAGE=/glam-team-makeover/ node tests/_probe-glam-tune3-turn.mjs

   Prints, per device: the page's scrollable height, the box of the whose-turn
   text and of the actions-left meter at scrollTop 0 and again after the trolley
   has been scrolled to the bottom, plus the stage panel's box and the sandy
   band's own rect.  Everything is reported in VIEWPORT coordinates, because
   "still visible" is a viewport question. */
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

// Report the viewport rect of the deepest element whose own text is `needle`.
const probe = (needle) => {
  const hit = [...document.querySelectorAll('*')].filter(
    (e) => (e.textContent || '').includes(needle) && ![...e.children].some((c) => (c.textContent || '').includes(needle)),
  );
  if (!hit.length) return null;
  const r = hit[0].getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
};

const browser = await chromium.launch();
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

  const shot = async (label) => {
    const out = await page.evaluate(
      ([turnText, actText]) => {
        const R = (e) => {
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        };
        const deepest = (needle) => {
          const hit = [...document.querySelectorAll('*')].filter(
            (e) =>
              (e.textContent || '').includes(needle) &&
              ![...e.children].some((c) => (c.textContent || '').includes(needle)),
          );
          return hit.length ? R(hit[0]) : null;
        };
        const stage = document.querySelector('.gtm-stage');
        const troll = document.getElementById('gtm-trolley');
        return {
          scrollY: Math.round(window.scrollY),
          docH: Math.round(document.documentElement.scrollHeight),
          viewH: window.innerHeight,
          turn: deepest(turnText),
          act: deepest(actText),
          stage: R(stage),
          trolley: R(troll),
        };
      },
      ['MY TURN', 'Actions left'],
    );
    console.log(`${d.tag} ${label}: ${JSON.stringify(out)}`);
  };

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await shot('top   ');
  await page.evaluate(() => {
    const t = document.getElementById('gtm-trolley');
    if (t) t.scrollIntoView({ block: 'end' });
    window.scrollBy(0, 4000);
  });
  await page.waitForTimeout(200);
  await shot('trolley');
  await page.close();
}
await browser.close();
