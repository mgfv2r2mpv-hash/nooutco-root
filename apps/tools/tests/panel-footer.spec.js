import { test, expect, devices } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The assistant's footer, and how much of the phone it is allowed to take.
 *
 * His words: "The page still has a lot of buttons going on for using the
 * system. The hold to talk button could maybe be a microphone icon instead and
 * next to the airplane send icon button. Try to remove some of the vertical
 * rows for the interface in the Ask NoMe panel."
 *
 * MEASURED BEFORE THE CHANGE, on an iPhone 14 profile: the footer was 276px of
 * a 664px viewport across five stacked rows - composer, a full-width hold to
 * talk, the speaking rule, a full-width "What would you do here?", the PHI
 * line, and a divided row for "Report a problem". Every bound below is written
 * against that number, so each one of these fails on the build it replaced
 * rather than passing on both.
 *
 * The rule about names has its own file: speech.spec.js holds it beside the
 * microphone, which is a ruling and not a layout preference.
 */

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

/* A recogniser that exists and hears nothing. The microphone is offered on a
   capability check, so without this the footer under test is the one a browser
   that cannot hear gets, which is not the footer anybody uses. */
const INSTALL_FAKE = () => {
  function FakeRecognition() {
    this.continuous = false; this.interimResults = false; this.processLocally = false; this.lang = '';
    this.start = function () {};
    this.stop = function () { if (this.onend) this.onend(); };
    this.abort = function () {};
  }
  Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
};

async function ready(page) {
  await page.route('**/api/corrections-pass**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: [], dropped: 0 }),
  }));
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply({}));
  });
  await page.addInitScript(INSTALL_FAKE);
  await page.goto('/notes/bt/?aid=1');
  await page.evaluate(() => localStorage.clear());
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto('/notes/bt/?aid=1');
  /* Click the pill until the composer is there rather than once. These pages
     compile their JSX in the browser, so the pill can be painted a moment
     before its handler is wired and a single click lands on nothing. Same
     reason, same shape, as speech.spec.js. */
  await expect
    .poll(async () => {
      if (await page.locator('.revision-input').isVisible().catch(() => false)) return true;
      const fab = page.locator('.revision-fab');
      if (await fab.isVisible().catch(() => false)) await fab.click().catch(() => {});
      return false;
    }, { timeout: 30000, intervals: [250, 500, 500, 1000] })
    .toBe(true);
}

const geometry = (page) => page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, w: r.width, mid: r.top + r.height / 2 };
  };
  const foot = document.querySelector('.revision-panel-foot');
  return {
    rows: [...foot.children].map((c) => String(c.className || c.tagName)),
    footHeight: foot.getBoundingClientRect().height,
    viewport: window.innerHeight,
    input: box('.revision-input'),
    mic: box('[data-speak]'),
    send: box('.revision-send'),
    advice: box('.revision-advice'),
    report: box('.revision-report'),
    micParent: document.querySelector('[data-speak]').parentElement.className,
    sendParent: document.querySelector('.revision-send').parentElement.className,
    adviceParent: document.querySelector('.revision-advice').parentElement.className,
    reportParent: document.querySelector('.revision-report').parentElement.className,
  };
});

test.describe('the assistant footer is three rows, not six', () => {
  test('the microphone sits beside send, on the composer row', async ({ page }) => {
    await ready(page);
    const g = await geometry(page);

    expect(g.micParent, 'the mic is in the composer row').toContain('revision-compose');
    expect(g.sendParent, 'and so is send').toContain('revision-compose');

    // Side by side rather than stacked: same baseline, mic to the left of send,
    // both to the right of the box they fill.
    expect(Math.abs(g.mic.mid - g.send.mid), 'mic and send share a baseline').toBeLessThan(4);
    expect(g.mic.right, 'the mic comes before send').toBeLessThanOrEqual(g.send.left + 1);
    expect(g.mic.left, 'both sit after the box').toBeGreaterThanOrEqual(g.input.right - 1);
  });

  /* THE ONE TEST HERE THAT ALSO PASSES ON THE BUILD THIS REPLACED, and it is
     said out loud rather than left to be discovered: the old buttons carried
     the words "Send" and "Hold to talk" on their faces, so of course they had
     names. It earns its place going forward, not backward - strip the clipped
     label and the title off the new icon buttons and it fails, which is the
     exact mistake an icon-only row invites. */
  test('neither icon button is a mystery to a screen reader', async ({ page }) => {
    await ready(page);
    /* An icon with no text is a button with no name unless something supplies
       one. Queried by role and accessible name, which is what a screen reader
       actually announces - not by the class, which would pass on a button
       announcing nothing. */
    await expect(page.getByRole('button', { name: /^Send$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /hold to talk/i })).toBeVisible();
  });

  /* PUTTING THE TWO CONTROLS ON ONE ROW CREATED A WAY FOR THEM TO COLLIDE that
     did not exist while one was stacked under the other, and the first version
     of this change walked straight into it: listening inverted the mic to
     Send's own dark green, so a screenshot at 390px showed two identical dark
     squares and nothing readable saying which one was live. Caught by looking
     at it, which no assertion in this file was going to do, so it gets one. */
  test('an open microphone does not look like the send button', async ({ page }) => {
    await ready(page);
    // Send has to be ENABLED, or it is grey and would differ from anything.
    await page.locator('.revision-input').fill('say that in the behavior part');
    const mic = page.locator('[data-speak]');
    await mic.dispatchEvent('pointerdown');
    await expect(mic).toHaveAttribute('aria-pressed', 'true');

    /* Read the settled colour, not a frame of the 130ms transition. Comparing
       mid-transition would report "different" on its way to landing on the
       same value, which is the failure this test exists to catch passing
       itself. 500ms is comfortably past it. */
    await page.waitForTimeout(500);
    const c = await page.evaluate(() => ({
      mic: getComputedStyle(document.querySelector('[data-speak]')).backgroundColor,
      send: getComputedStyle(document.querySelector('.revision-send')).backgroundColor,
      disabled: document.querySelector('.revision-send').disabled,
    }));
    expect(c.disabled, 'send is live, so this compares two live controls').toBe(false);
    expect(c.mic, 'a listening mic and a live send must not be the same swatch').not.toBe(c.send);

    await mic.dispatchEvent('pointerup');
  });

  test('the errands share one line instead of a stack', async ({ page }) => {
    await ready(page);
    const g = await geometry(page);
    expect(g.adviceParent, 'asking is an errand').toContain('revision-errands');
    expect(g.reportParent, 'so is reporting a fault').toContain('revision-errands');
    expect(Math.abs(g.advice.mid - g.report.mid), 'on the same line').toBeLessThan(4);
    expect(g.advice.right, 'asking first, reporting last').toBeLessThanOrEqual(g.report.left + 1);
  });

  test('the footer is three rows at rest', async ({ page }) => {
    await ready(page);
    const g = await geometry(page);
    expect(g.rows, 'compose, the fine print, the errands').toHaveLength(3);
  });
});

test.describe('on the phone they actually write these on', () => {
  const { defaultBrowserType, ...IPHONE } = devices['iPhone 14'];
  test.use(IPHONE);

  /* A PIXEL BOUND HERE MEASURES THE FONT AS MUCH AS THE LAYOUT, and the first
     version of this test did not know that. It asserted under 200px because
     three engines on a Mac all said 174, and CI's chromium failed it: this page
     pulls Atkinson Hyperlegible from Google Fonts, the runner renders in a
     wider fallback instead, and wider glyphs mean more wrapped lines and a
     taller footer. Same shape as every other thing in this repo that was
     measured on one machine and believed.

     So the bound is set where it still answers the question it was written for
     - the old footer was 276px of a 664px viewport and this fails that - while
     leaving room for a font nobody here has seen. The assertions that actually
     carry the ask are the structural ones above and below, which no font can
     move: three rows, both controls on the composer row, the errands on one
     line. */
  test('the footer does not take a third of the screen', async ({ page }) => {
    await ready(page);
    const g = await geometry(page);
    expect(g.footHeight, 'the note is what the screen is for').toBeLessThan(240);
  });

  /* The row that can silently become two, checked at the width where it would.
     Everything else in the footer is one element per line; the errands hold two
     buttons whose labels are text, so this is the single place a wider font can
     put a row back without anything else changing. Shared baseline rather than
     a pixel height, because that is true in any font: if the row wrapped, the
     two buttons would be a line apart. */
  test('the errands stay on one line at phone width', async ({ page }) => {
    await ready(page);
    const g = await geometry(page);
    expect(Math.abs(g.advice.mid - g.report.mid), 'wrapped to a second row').toBeLessThan(4);
  });

  /* The square cannot shrink to buy the row back. A control you hold down with
     a thumb has a floor, and this is it. */
  test('the microphone is still big enough to hold with a thumb', async ({ page }) => {
    await ready(page);
    const g = await geometry(page);
    expect(g.mic.h).toBeGreaterThanOrEqual(44);
    expect(g.mic.w).toBeGreaterThanOrEqual(44);
    expect(g.send.h).toBeGreaterThanOrEqual(44);
  });
});
