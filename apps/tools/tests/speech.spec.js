import { test, expect, devices } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* Talking to the note.
 *
 * His ruling is what allows this to exist: "This is acceptable based on their
 * privacy practices and their inability to access. Staff should still avoid
 * using client names on this surface so they should not be dictating it to
 * Apple as well. This will be part of their training that I will do in person
 * with them when I teach them to use it."
 *
 * Both halves are tested. The control exists (given a browser that can hear),
 * the rule about names is ON it rather than in a training memory, and - the one
 * that actually protects anybody - a name that gets said out loud still never
 * reaches the model, because recognised text enters the same box typing enters
 * and meets the same scrub.
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

const note = () => ({
  individualsPresent: ['Client'], clinicalStatus: ['Presented Tired'],
  clinicalStatusNarrative: 'The client presented as tired on arrival today.',
  purpose: ['Worked on goals as stated in the treatment plan'], servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'Choices were offered before each demand presented.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions during the session.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
});

/* A recogniser that hears exactly what the test says it hears. Installed before
   any page script runs, so the capability check sees it the way it would see a
   real one.

   IT SHADOWS BOTH NAMES, and that is not belt and braces. The first version of
   this installed the prefixed name only, on the reasoning that Chrome is the
   prefixed one. Chromium exposes BOTH today, `available()` reads the unprefixed
   name FIRST, and so every test here drove the real engine: headless Chromium
   went looking for a microphone it does not have and the renderer died, which
   arrives as "Target crashed" and names nothing. A fake that shadows one of the
   two names a checker reads is not a fake, it is a coin toss, and the test
   below named "the recogniser under test is the fake one" exists so this can
   never fail quietly again. */
const INSTALL_FAKE = () => {
  window.__speech = { started: 0, stopped: 0, last: null, lang: null, local: null };
  function FakeRecognition() {
    const self = this;
    this.continuous = false;
    this.interimResults = false;
    this.processLocally = false;
    this.lang = '';
    this.start = function () {
      window.__speech.started += 1;
      window.__speech.last = self;
      window.__speech.lang = self.lang;
      window.__speech.local = self.processLocally;
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

// Say something. The shape matches what a real result event carries.
const hear = (page, words, final = true) => page.evaluate(([said, isFinal]) => {
  const rec = window.__speech.last;
  if (!rec || !rec.onresult) throw new Error('nothing is listening');
  const one = [{ transcript: said }];
  one.isFinal = isFinal;
  one.length = 1;
  const results = [one];
  results.length = 1;
  rec.onresult({ resultIndex: 0, results });
}, [words, final]);

async function ready(page, { speech = true } = {}) {
  await page.route('**/api/corrections-pass**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: [], dropped: 0 }),
  }));
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(note()));
  });
  if (speech) await page.addInitScript(INSTALL_FAKE);
  else {
    // THE CONTROL: a browser that cannot hear must be offered nothing.
    await page.addInitScript(() => {
      try { delete window.webkitSpeechRecognition; } catch (e) {}
      try { delete window.SpeechRecognition; } catch (e) {}
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
      Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
    });
  }

  await page.goto('/notes/bt/?aid=1');
  await page.evaluate(() => localStorage.clear());
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto('/notes/bt/?aid=1');
  // The panel has to be open for the composer to exist.
  const fab = page.locator('.revision-fab');
  if (await fab.isVisible({ timeout: 10000 }).catch(() => false)) await fab.click();
  await expect(page.locator('.revision-input')).toBeVisible({ timeout: 10000 });
}

const holdAndSay = async (page, words) => {
  const btn = page.locator('[data-speak]');
  await btn.dispatchEvent('pointerdown');
  await hear(page, words);
  await btn.dispatchEvent('pointerup');
};

test.describe('the control to talk', () => {
  /* THE CONTROL. Nothing is offered on a browser that cannot hear, and nothing
     about the page changes. */
  test('a browser that cannot hear is offered nothing', async ({ page }) => {
    await ready(page, { speech: false });
    await expect(page.locator('[data-speak]')).toHaveCount(0);
    await expect(page.locator('[data-speak-rule]')).toHaveCount(0);
    await expect(page.locator('.revision-input')).toBeVisible();
  });

  test('a browser that can hear gets the control', async ({ page }) => {
    await ready(page);
    await expect(page.locator('[data-speak]')).toBeVisible();
  });

  /* A GUARD ON THE HARNESS, NOT ON THE PAGE. Every assertion below is only
     worth something if the recogniser the page reaches for is ours. Chromium
     ships a real one under the unprefixed name, so a fake that misses a name
     hands the whole file to the real engine and the failures that follow point
     everywhere except here. */
  test('the recogniser under test is the fake one', async ({ page }) => {
    await ready(page);
    const mine = await page.evaluate(() =>
      String(window.SpeechRecognition || window.webkitSpeechRecognition).indexOf('FakeRecognition') >= 0);
    expect(mine, 'the harness must shadow every name available() reads, or these tests drive the real engine').toBe(true);
  });

  /* HIS RULING'S SECOND HALF, carried by the interface rather than by memory.
     It is a label on the affordance, so it costs nothing and it is there every
     single time. */
  test('the rule about names is on the button, not in a queue of alerts', async ({ page }) => {
    await ready(page);
    await expect(page.locator('[data-speak-rule]')).toHaveText(/say roles, not names/i);
    const together = await page.evaluate(() => {
      const btn = document.querySelector('[data-speak]');
      const rule = document.querySelector('[data-speak-rule]');
      return btn.parentElement === rule.parentElement;
    });
    expect(together).toBe(true);
    // And it is not an alert anybody has to dismiss.
    await expect(page.locator('[data-speak-rule]')).not.toHaveAttribute('role', 'alert');
  });

  test('holding it listens, and letting go stops', async ({ page }) => {
    await ready(page);
    const btn = page.locator('[data-speak]');
    /* Polling the whole counter object rather than one field: this failed once
       under the full parallel suite and passed ten times in a row on its own,
       and a poll on a single number reports "expected 1" without ever saying
       what it saw. The object says whether the recogniser never started or
       started twice, which are opposite faults. */
    await btn.dispatchEvent('pointerdown');
    await expect.poll(() => page.evaluate(() => window.__speech), { timeout: 10000 })
      .toMatchObject({ started: 1, stopped: 0 });
    await btn.dispatchEvent('pointerup');
    await expect.poll(() => page.evaluate(() => window.__speech), { timeout: 10000 })
      .toMatchObject({ started: 1, stopped: 1 });
  });

  test('the button says which of the two states it is in', async ({ page }) => {
    await ready(page);
    const btn = page.locator('[data-speak]');
    const resting = (await btn.textContent()).trim();
    await btn.dispatchEvent('pointerdown');
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    const listening = (await btn.textContent()).trim();
    expect(listening).not.toBe(resting);
    await btn.dispatchEvent('pointerup');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  test('what was said lands in the box typing lands in', async ({ page }) => {
    await ready(page);
    await holdAndSay(page, 'she needed full physical prompting on the last three trials');
    await expect(page.locator('.revision-input')).toHaveValue(/full physical prompting on the last three trials/);
  });

  test('saying more adds to it rather than replacing what is there', async ({ page }) => {
    await ready(page);
    await page.locator('.revision-input').fill('first part.');
    await holdAndSay(page, 'and the second part');
    const v = await page.locator('.revision-input').inputValue();
    expect(v).toContain('first part.');
    expect(v).toContain('and the second part');
  });

  test('it asks the platform to keep the audio local, without depending on it', async ({ page }) => {
    await ready(page);
    const btn = page.locator('[data-speak]');
    await btn.dispatchEvent('pointerdown');
    await expect.poll(() => page.evaluate(() => window.__speech.local)).toBe(true);
    await btn.dispatchEvent('pointerup');
    // And it listened anyway, which is the half his ruling settles.
    expect(await page.evaluate(() => window.__speech.started)).toBe(1);
  });
});

test.describe('what is said meets the same gate as what is typed', () => {
  /* THE ONE THAT PROTECTS SOMEBODY. The ruling changes who hears the audio. It
     changes nothing about what our API calls carry, and this is where that is
     either true or it is not. */
  test('a name that was said out loud never reaches the model', async ({ page }) => {
    const bodies = [];
    await page.route('**/api/corrections-pass**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: [], dropped: 0 }),
    }));
    await page.route('**/api/llm-call**', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}');
      bodies.push(route.request().postData() || '');
      if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
      return route.fulfill(reply(note()));
    });
    await page.addInitScript(INSTALL_FAKE);

    await page.goto('/notes/bt/?aid=1');
    await page.evaluate(() => localStorage.clear());
    await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
    await page.goto('/notes/bt/?aid=1');
    await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array');
    await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board, also moved to the floor and he settled');
    await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
    await page.getByRole('button', { name: 'Generate Note' }).click();
    const ackGo = page.locator('#notes-ack-go');
    if (await ackGo.isVisible({ timeout: 6000 }).catch(() => false)) {
      await page.locator('#notes-ack-cb').check();
      await ackGo.click();
    }
    let scrubGo = page.locator('#notes-scrub-go');
    if (await scrubGo.isVisible({ timeout: 3000 }).catch(() => false)) await scrubGo.click();
    /* Wait on the section CARD, not on a textarea. A section that carries a
       correction renders as marked-up prose rather than as an editable box, so
       a textarea is present for some drafts and absent for others. The card is
       there either way. */
    await expect(page.locator('[data-section-key]').first()).toBeVisible({ timeout: 30000 });

    const before = bodies.length;
    await expect(page.locator('.revision-input')).toBeVisible({ timeout: 10000 });
    await holdAndSay(page, 'Jacob got upset when the timer went off, say that in the behavior part');
    await expect(page.locator('.revision-input')).toHaveValue(/Jacob/);
    await page.locator('.revision-send').click();
    scrubGo = page.locator('#notes-scrub-go');
    if (await scrubGo.isVisible({ timeout: 6000 }).catch(() => false)) await scrubGo.click();

    await expect.poll(() => bodies.length, { timeout: 20000 }).toBeGreaterThan(before);
    const sent = bodies.slice(before).join('\n');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent, 'the spoken name must never cross the wire').not.toContain('Jacob');
  });
});

test.describe('on the phone they actually use', () => {
  const { defaultBrowserType, ...IPHONE } = devices['iPhone 14'];
  test.use(IPHONE);

  test('the button is big enough to hold with a thumb', async ({ page }) => {
    await ready(page);
    const box = await page.locator('[data-speak]').boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test('the rule is readable, not fine print', async ({ page }) => {
    await ready(page);
    const size = await page.locator('[data-speak-rule]').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(12);
  });
});
