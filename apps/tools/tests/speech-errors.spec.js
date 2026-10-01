import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The mic that did nothing.
 *
 * A technician reported that neither a click nor a hold on the mic did
 * anything, while the keyboard's own dictation key worked. So the microphone was
 * fine and the page was silent. The page was silent because recognition errors
 * were swallowed: the panel handed NoteSpeech an onError that only reset the
 * button, and Chrome reports a missing on-device language pack
 * (language-not-supported, after processLocally = true) and a blocked
 * microphone (not-allowed) as an error event AFTER start() returns.
 *
 * These tests drive a fake recogniser that fails the way Chrome fails. They
 * cannot hear a real microphone, so what they prove is the page's handling of
 * each error kind, not the engine's.
 *
 * Every page that renders the mic is covered: the panel is one component
 * (notes/bcba/revision-panel.jsx) mounted by the BT page and by the BCBA page,
 * which hosts sup, sap, assess and parent.
 */

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt', 'sup', 'sap', 'assess', 'parent'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

/* window.__plan is a list of error kinds, one per start(). A start whose slot
   holds a kind fails asynchronously, the way Chrome does it: an error event and
   then an end event. A start with no slot (or a null) succeeds and listens.
   window.__noLocal removes the processLocally property, as an engine that has
   never heard of it would. */
const INSTALL_FAKE = () => {
  window.__speech = { starts: [], stopped: 0, last: null };
  function FakeRecognition() {
    const self = this;
    this.continuous = false;
    this.interimResults = false;
    if (!window.__noLocal) this.processLocally = false;
    this.lang = '';
    this.start = function () {
      const slot = (window.__plan || [])[window.__speech.starts.length] || null;
      window.__speech.starts.push({ local: self.processLocally, lang: self.lang, fail: slot });
      window.__speech.last = self;
      if (!slot) return;
      setTimeout(() => {
        if (self.onerror) self.onerror({ error: slot });
        if (self.onend) self.onend();
      }, 0);
    };
    this.stop = function () {
      window.__speech.stopped += 1;
      if (self.onend) self.onend();
    };
    this.abort = function () {};
  }
  Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
};

async function ready(page, url, { plan = [], noLocal = false } = {}) {
  await page.route('**/api/corrections-pass**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: [], dropped: 0 }),
  }));
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply({ hints: [] }));
  });
  await page.addInitScript(([p, n]) => { window.__plan = p; window.__noLocal = n; }, [plan, noLocal]);
  await page.addInitScript(INSTALL_FAKE);
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto(url);
  await expect
    .poll(async () => {
      if (await page.locator('[data-speak]').isVisible().catch(() => false)) return true;
      const fab = page.locator('.revision-fab');
      if (await fab.isVisible().catch(() => false)) await fab.click().catch(() => {});
      return false;
    }, { timeout: 30000, intervals: [250, 500, 500, 1000] })
    .toBe(true);
}

const starts = (page) => page.evaluate(() => window.__speech.starts);
const mic = (page) => page.locator('[data-speak]');
const problem = (page) => page.locator('[data-speak-error]');

const PAGES = [
  ['bt', '/notes/bt/?aid=1'],
  ['sup', '/notes/bcba/index.html?tool=sup'],
  ['sap', '/notes/bcba/index.html?tool=sap'],
  ['assess', '/notes/bcba/index.html?tool=assess'],
  ['parent', '/notes/bcba/index.html?tool=parent'],
];

for (const [name, url] of PAGES) {
  test.describe('mic errors on the ' + name + ' page', () => {
    test('a blocked microphone says so beside the mic, and does not retry', async ({ page }) => {
      await ready(page, url, { plan: ['not-allowed'] });
      await mic(page).click();
      await expect(problem(page)).toBeVisible();
      await expect(problem(page)).toContainText(/microphone/i);
      await expect(problem(page)).toContainText(/blocked|allow/i);
      await expect(mic(page)).toHaveAttribute('aria-pressed', 'false');
      expect((await starts(page)).length).toBe(1);
    });

    test('a missing language pack retries once without processLocally and then listens', async ({ page }) => {
      await ready(page, url, { plan: ['language-not-supported'] });
      await mic(page).click();
      await expect.poll(async () => (await starts(page)).length).toBe(2);
      const s = await starts(page);
      expect(s[0].local).toBe(true);
      expect(s[1].local).toBe(false);
      await expect(mic(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(problem(page)).toHaveCount(0);
    });

    test('a language failure that survives the retry says so beside the mic', async ({ page }) => {
      await ready(page, url, { plan: ['language-not-supported', 'language-not-supported'] });
      await mic(page).click();
      await expect(problem(page)).toBeVisible();
      await expect(problem(page)).toContainText(/language/i);
      await expect(mic(page)).toHaveAttribute('aria-pressed', 'false');
      expect((await starts(page)).length).toBe(2);
    });
  });
}

test.describe('mic errors, once', () => {
  const url = PAGES[0][1];

  test('service-not-allowed reads like a blocked microphone', async ({ page }) => {
    await ready(page, url, { plan: ['service-not-allowed'] });
    await mic(page).click();
    await expect(problem(page)).toContainText(/speech service|blocked|allow/i);
    await expect(mic(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('network names the connection and does not retry', async ({ page }) => {
    await ready(page, url, { plan: ['network'] });
    await mic(page).click();
    await expect(problem(page)).toBeVisible();
    await expect(problem(page)).toContainText(/connection|reach/i);
    expect((await starts(page)).length).toBe(1);
  });

  test('audio-capture names the missing microphone', async ({ page }) => {
    await ready(page, url, { plan: ['audio-capture'] });
    await mic(page).click();
    await expect(problem(page)).toContainText(/no microphone|found/i);
  });

  test('an unknown kind is still shown, with its name', async ({ page }) => {
    await ready(page, url, { plan: ['something-new'] });
    await mic(page).click();
    await expect(problem(page)).toContainText('something-new');
  });

  test('the message sits within a thumb of the mic and the rule stays up', async ({ page }) => {
    await ready(page, url, { plan: ['not-allowed'] });
    await mic(page).click();
    await expect(problem(page)).toBeVisible();
    const gap = await page.evaluate(() => {
      const m = document.querySelector('[data-speak]').getBoundingClientRect();
      const e = document.querySelector('[data-speak-error]').getBoundingClientRect();
      return Math.max(0, e.top - m.bottom, m.top - e.bottom);
    });
    expect(gap, 'the message must be next to the mic, not elsewhere on the page').toBeLessThan(80);
    await expect(page.locator('[data-speak-rule]')).toContainText('Say roles, not names.');
  });

  test('the message is announced and clears on the next try', async ({ page }) => {
    await ready(page, url, { plan: ['not-allowed'] });
    await mic(page).click();
    await expect(problem(page)).toHaveAttribute('role', 'status');
    await mic(page).click();
    await expect(problem(page)).toHaveCount(0);
    await expect(mic(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('an engine without processLocally is never handed the property', async ({ page }) => {
    await ready(page, url, { noLocal: true });
    await mic(page).click();
    await expect(mic(page)).toHaveAttribute('aria-pressed', 'true');
    expect((await starts(page))[0].local).toBeUndefined();
    expect(await page.evaluate(() => 'processLocally' in window.__speech.last)).toBe(false);
  });

  test('a language failure on an engine without processLocally is not retried', async ({ page }) => {
    await ready(page, url, { plan: ['language-not-supported'], noLocal: true });
    await mic(page).click();
    await expect(problem(page)).toContainText(/language/i);
    expect((await starts(page)).length).toBe(1);
  });
});

test.describe('click and tap both toggle, once', () => {
  const url = PAGES[0][1];

  test('a plain mouse click turns listening on, the next click turns it off', async ({ page }) => {
    await ready(page, url);
    await mic(page).click();
    await expect(mic(page)).toHaveAttribute('aria-pressed', 'true');
    await mic(page).click();
    await expect(mic(page)).toHaveAttribute('aria-pressed', 'false');
    expect((await starts(page)).length).toBe(1);
  });

  test('a touch tap toggles once, and the click the browser makes after it does not toggle back', async ({ page }) => {
    await ready(page, url);
    const btn = mic(page);
    await btn.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7 });
    await btn.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7 });
    await btn.dispatchEvent('click', { detail: 1 });
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(150);
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect((await starts(page)).length).toBe(1);
  });

  test('a click with no pointer events (a screen reader activating it) toggles', async ({ page }) => {
    await ready(page, url);
    const btn = mic(page);
    await btn.dispatchEvent('click', { detail: 0 });
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await btn.dispatchEvent('click', { detail: 0 });
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  });
});
