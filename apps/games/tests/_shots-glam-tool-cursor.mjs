/* Screenshot pass for issue #40 (per-tool cursor art). Not a spec. Run against a
   wrangler server on PORT (default 8788):

     git show origin/dev:apps/games/glam-team-makeover/index.html \
       > apps/games/glam-team-makeover/_before-cursor.html
     PHASE=before PAGE=/glam-team-makeover/_before-cursor.html node tests/_shots-glam-tool-cursor.mjs
     PHASE=after  node tests/_shots-glam-tool-cursor.mjs
     rm apps/games/glam-team-makeover/_before-cursor.html

   A headless screenshot never contains the OS pointer, so each shot DRAWS what
   the browser would show: the computed `cursor` value is read off the target
   and printed in a tag, and when that value carries a sprite the sprite is
   placed at the pointer with its hotspot on the pointer position. On the
   pre-change build the value is the bare keyword (`grab` / `pointer`, the
   system hand) and no sprite is drawn, which is the point of the issue.

   Output: docs/eval/shots/glam-tool-cursor/cursor-<phase>-<tool>.png */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const PHASE = process.env.PHASE || 'after';
const PAGE = process.env.PAGE || '/glam-team-makeover/';
const PORT = Number(process.env.PORT) || 8788;
const OUT = new URL('../../../docs/eval/shots/glam-tool-cursor/', import.meta.url).pathname;

const TOOLS = [
  { title: 'Wash', slug: 'wash', sel: 'div[style*="gtm-target"]' },
  { title: 'Blush rose', slug: 'blush-rose', sel: 'div[style*="gtm-target"]' },
  { title: 'Eyeliner', slug: 'eyeliner', sel: 'div[style*="gtm-target"]' },
  { title: 'Treat spots', slug: 'treat-spots', sel: 'div[style*="gtm-pim"]' },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', (e) => problems.push(e.message));

await page.goto(`http://localhost:${PORT}${PAGE}`);
await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
await page.getByTitle('Show / hide setup').click();
await page.getByLabel('Routine', { exact: true }).selectOption('free');
await page.getByLabel('Turns', { exact: true }).selectOption('4');
await page.getByRole('button', { name: /^▶ Play/ }).click();
await page.getByRole('button', { name: /Go - / }).click();
await page.waitForTimeout(1500);

for (const tool of TOOLS) {
  await page.getByTitle(tool.title, { exact: true }).first().click();
  const zone = page.locator(tool.sel).first();
  await zone.waitFor({ state: 'visible' });
  await page.waitForTimeout(400);   // let a tinted sprite repaint in
  const box = await zone.boundingBox();
  const px = Math.round(box.x + box.width * 0.3);
  const py = Math.round(box.y + box.height * 0.75);
  await page.mouse.move(px, py);

  const value = await zone.evaluate((el) => getComputedStyle(el).cursor);
  await page.evaluate(({ value, px, py }) => {
    document.querySelectorAll('[data-shot-overlay]').forEach((n) => n.remove());
    const m = value.match(/^url\("([^"]+)"\)\s+(\d+)\s+(\d+)/);
    if (m) {
      const img = document.createElement('img');
      img.dataset.shotOverlay = '1';
      img.src = m[1];
      img.style.cssText = `position:fixed;left:${px - Number(m[2])}px;top:${py - Number(m[3])}px;width:32px;height:32px;z-index:9999;pointer-events:none`;
      document.body.appendChild(img);
    }
    const tag = document.createElement('div');
    tag.dataset.shotOverlay = '1';
    const shown = value.replace(/url\("([^"]+)"\)/, (_, u) => 'url(' + (u.startsWith('blob:') ? 'tinted sprite' : u.split('/').pop()) + ')');
    tag.textContent = 'cursor: ' + shown;
    tag.style.cssText = `position:fixed;left:${px + 26}px;top:${py + 22}px;z-index:9999;font:600 12px ui-monospace,monospace;background:#fff;color:#222;border:1px solid #999;border-radius:4px;padding:2px 6px;pointer-events:none`;
    document.body.appendChild(tag);
  }, { value, px, py });
  await page.waitForTimeout(150);
  await page.screenshot({
    path: `${OUT}cursor-${PHASE}-${tool.slug}.png`,
    clip: { x: Math.max(0, px - 200), y: Math.max(0, py - 140), width: 560, height: 260 },
  });
  console.log(`${PHASE} ${tool.slug}: ${value.slice(0, 90)}`);
}

await browser.close();
if (problems.length) { console.error(problems); process.exit(1); }
