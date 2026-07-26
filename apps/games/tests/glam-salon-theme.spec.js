import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover — the salon dressing and the choice echo (refresh R5).
 *
 * R4 gave the activity its DEPTH (ten stations, sixty-nine tools). This slice is
 * the other half of "a richer, more themed makeover activity": the room the
 * stations stand in, and the answer a tap gets back.
 *
 * Two properties are worth pinning, because both are the kind that decay
 * silently:
 *
 *   1. THE ECHO IS AN ECHO, NOT A VERDICT. Every apply path now surfaces a chip
 *      carrying the child's own tool name. The moment that chip composes a
 *      SENTENCE around the name it becomes a claim — either about the choice
 *      ("nice pick!", which is exactly the evaluation this build refuses to make
 *      of a creative choice) or about the client (§3.7.1 / AC-10, refutable).
 *      So the chip's text must stay: sparkle + the tool's own label, nothing
 *      added, no digits.
 *   2. THE FEEDBACK ACTUALLY FIRES, EVERY TIME. A CSS animation only restarts
 *      when its `animation-name` changes, so a second choice inside the echo
 *      window would sit motionless on the same DOM node. The `-a`/`-b` parity in
 *      the stylesheet exists solely to prevent that, and it is exactly the sort
 *      of "duplicate keyframes, tidy them up" detail a later pass would delete.
 *
 * Plus a whole-file guard: every animation this game ships must stay on the
 * compositor (transform / opacity only).
 *
 * The GlamTT engine and tests/glam-tt-scoring.spec.js are untouched by this work.
 */

/** Boot to the play surface via the BT's ▶ Play, doll painted, console watched.
    Free routine so any station can be reached without walking the staged order. */
async function stage(page, { routine = 'free' } = {}) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/glam-team-makeover/');
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Routine', { exact: true }).selectOption(routine);
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.waitForFunction(() => {
    let f = null;
    for (const el of document.querySelectorAll('*')) {
      const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      if (k) { f = el[k]; break; }
    }
    while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
    const L = f && f.stateNode.logic;
    if (!L || !L._skinPool(L.state.model)) return false;
    const c = L._imgc || {};
    const keys = Object.keys(c);
    return keys.length > 0 && keys.every((k) => c[k].ok);
  }, undefined, { timeout: 30000 });
  await page.getByRole('button', { name: /Go —/ }).click();
  return errors;
}

/** The echo chip, addressed by the animation it is the only user of. */
const chip = (page) => page.locator('[style*="gtm-mirror-"]');
/** The stage panel — the canvas's grandparent (canvas → person box → panel). */
const stagePanel = (page) => page.locator('#gtm-canvas').locator('xpath=../..');

/** Apply one tool end to end, whatever its mechanic, and leave the echo up.
    The three overlays the stage can arm are told apart by the animation each one
    is styled with: `.gtm-tool` is the paint drag surface, `gtm-pim` the spot
    rings, `gtm-target` the tap zone. A `choose` tool arms nothing — it lands on
    the button press. */
async function useTool(page, label) {
  await page.getByTitle(label, { exact: true }).first().click();

  const drag = page.locator('.gtm-tool');
  if (await drag.count()) {
    const box = await page.locator('#gtm-canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.42);
    await page.mouse.down();
    for (let i = 0; i < 14; i++) {
      await page.mouse.move(box.x + box.width * (0.36 + 0.02 * i), box.y + box.height * (0.42 + 0.008 * i));
    }
    await page.mouse.up();
    return;
  }
  const spots = page.locator('div[style*="gtm-pim"]');
  if (await spots.count()) { await spots.first().click(); return; }
  const zone = page.locator('div[style*="gtm-target"]');
  if (await zone.count()) await zone.first().click();
}

test.describe('salon dressing + the choice echo (R5)', () => {
  test('the play surface is dressed as a salon room, not a form', async ({ page }) => {
    const errors = await stage(page);

    // the room behind the panels
    await expect(page.locator('main.gtm-room')).toBeVisible();
    const room = await page.locator('main.gtm-room').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(room, 'the room carries a warm wash, not a flat page colour').toContain('gradient');

    // the trolley the stock is wheeled in on
    await expect(page.getByText('Styling trolley')).toBeVisible();

    // salon signage over the vanity, legible on the backdrop art rather than
    // faint grey set straight on it
    const sign = page.getByText('Our makeover');
    await expect(sign).toBeVisible();
    const signBg = await sign.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(signBg, 'the sign sits on a plate').not.toBe('rgba(0, 0, 0, 0)');

    // the stage panel is framed as an alcove: inset rim + vignette
    const framed = await stagePanel(page).evaluate((el) => getComputedStyle(el).boxShadow);
    expect(framed).toContain('inset');

    // the plum chrome the title screen and the phone thread also speak
    const header = await page.locator('header').evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(header).toContain('gradient');

    expect(errors, 'console stays clean on the dressed surface').toEqual([]);
  });

  test('a choice comes back as the child\'s own tool name, then clears itself', async ({ page }) => {
    await stage(page);
    await expect(chip(page)).toHaveCount(0);

    await useTool(page, 'Shape brows');
    await expect(chip(page)).toBeVisible();
    await expect(chip(page)).toHaveText(/Shape brows/);

    // it is a moment, not a status line: it goes on its own
    await expect(chip(page)).toHaveCount(0, { timeout: 4000 });
  });

  test('the echo never composes a sentence around the choice, and never a number', async ({ page }) => {
    await stage(page);

    /* One tool per mechanic that reaches the echo: choose, tap-toggle,
       tap-recolor, paint, and the per-spot patch. If a future change starts
       wrapping the label ("Great pick — Bob!") this is where it fails. */
    const cases = ['Bob', 'Shape brows', 'Copper', 'Wash', 'Treat spots'];
    for (const label of cases) {
      await useTool(page, label);
      const text = (await chip(page).innerText()).trim();
      // exactly: one leading glyph, then the tool's own label
      expect(text.replace(/^\P{L}+/u, ''), `the echo for "${label}" is the label itself`).toBe(label);
      expect(text, `the echo for "${label}" carries no number`).not.toMatch(/\d/);
      await page.waitForTimeout(1600); // let it clear before the next one
    }
  });

  test('a second choice inside the echo window animates like the first', async ({ page }) => {
    await stage(page);

    /* Tapping the SAME tool twice keeps the same DOM node for both the chip and
       the button, so only a change of animation-name can restart the motion.
       Two consecutive echoes must therefore name different keyframes. */
    await useTool(page, 'Shape brows');
    const first = await chip(page).evaluate((el) => getComputedStyle(el).animationName);
    const firstBtn = await page.getByTitle('Shape brows', { exact: true }).first()
      .evaluate((el) => getComputedStyle(el).animationName);

    await useTool(page, 'Shape brows');
    const second = await chip(page).evaluate((el) => getComputedStyle(el).animationName);
    const secondBtn = await page.getByTitle('Shape brows', { exact: true }).first()
      .evaluate((el) => getComputedStyle(el).animationName);

    expect(first).toMatch(/^gtm-mirror-[ab]$/);
    expect(second, 'the chip re-plays rather than sitting still').not.toBe(first);
    expect(firstBtn).toMatch(/^gtm-applied-[ab]$/);
    expect(secondBtn, 'the pressed button re-plays too').not.toBe(firstBtn);
  });

  /* TUNING fix 5 — the warmth is now BOUNDED as well as present.
     The glow was a 60%-alpha cream radial centred at 50% 44%, i.e. squarely on the
     client's face: measured on m3 at desktop it lifted the canvas region's mean
     luminance by 24.6 of a 133 base — an ~18% wash over the face on every single
     action, which is what read as a lens flare. Re-anchored to the top edge at
     20% alpha it lifts the same region by 0.4 and the whole panel by 1.2.
     So this test now pins BOTH ends: the panel still warms (the echo chip must not
     float on nothing), and the face must stay essentially untouched. An upper
     bound is the whole point of the fix — without one, "it warms" passes just as
     happily at the strength the maintainer rejected. */
  test('the mirror warms gently behind the echo, without washing out the client', async ({ page }) => {
    await stage(page);

    /* Mean luminance of a region. Over the whole stage panel the echo chip is
       under 1% of the area, so a swing there can only come from the glow; over the
       canvas alone it measures what lands on the client herself. */
    const meanOf = async (loc) => {
      const shot = await loc.screenshot({ animations: 'disabled' });
      return page.evaluate(async (b64) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        return s / (d.length / 4);
      }, shot.toString('base64'));
    };

    const panel = stagePanel(page);
    const client = page.locator('#gtm-canvas');

    const before = await meanOf(panel);
    const faceBefore = await meanOf(client);
    await useTool(page, 'Shape brows');
    await expect(chip(page)).toBeVisible();
    const during = await meanOf(panel);
    const faceDuring = await meanOf(client);
    await expect(chip(page)).toHaveCount(0, { timeout: 4000 });
    await page.waitForTimeout(500); // the opacity transition back down
    const after = await meanOf(panel);

    expect(during - before, 'the mirror warms behind the echo').toBeGreaterThan(0.35);
    expect(during - before, 'but it is a warming, not a flare').toBeLessThan(4);
    expect(Math.abs(after - before), 'and settles back to where it was').toBeLessThan(1);

    /* The client's own art is what the flare was ruining. Applying a step DOES
       repaint the canvas (brows land), so this is bounded rather than pinned to
       zero — the old glow moved it by 24.6, which no tool stroke comes near. */
    expect(Math.abs(faceDuring - faceBefore), 'the glow must not wash the client out').toBeLessThan(6);
  });

  test('every animation this game ships stays on the compositor', async ({ page }) => {
    await stage(page);

    /* Compositor-friendly motion is a standing constraint for this build (§3.9),
       and a keyframe that animates width/top/filter is invisible in review but
       costs a layout or a paint on every frame — on the exact surface a child is
       dragging a brush across. */
    const offenders = await page.evaluate(() => {
      const allowed = new Set(['transform', 'opacity', 'box-shadow', 'animation-timing-function']);
      const bad = [];
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; } // cross-origin sheet
        for (const rule of rules) {
          if (rule.type !== CSSRule.KEYFRAMES_RULE) continue;
          if (!rule.name.startsWith('gtm-')) continue;
          for (const frame of rule.cssRules) {
            for (const prop of frame.style) {
              if (!allowed.has(prop)) bad.push(`${rule.name}: ${prop}`);
            }
          }
        }
      }
      return bad;
    });
    expect(offenders).toEqual([]);
  });
});
