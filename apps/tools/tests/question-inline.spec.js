import { test, expect, devices } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The question is drawn under the box it asks about.
 *
 * MEASURED FIRST, because the reason is a measurement. On an iPhone 14 profile
 * the page during the gap questions is 2555px of intake boxes and the assistant
 * panel is 465px fixed to the bottom of a 664px viewport. A question reading
 * "you wrote that you moved to the floor, was that in the plan?" was drawn in
 * that panel, and the box containing the words "moved to the floor" was behind
 * it. The technician answered a question about their own writing without being
 * able to see their own writing, one question at a time, into a single box
 * shared by all of them.
 *
 * His instinct, in his words: "maybe it is time to come out of the Ask NoMe
 * chat panel and look at a more all-visible open floor plan design interface
 * that remains iPhone screen friendly."
 *
 * No mapping was invented to do this. A triage question already names a field,
 * and that field id is the id of a box on the form. A question naming a field
 * this form does not have is NOT placed and stays in the panel, because a
 * question the tool asked and then hid is worse than any layout.
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

const ONE_PLACED = {
  sufficient: false, readiness: 70,
  questions: [{
    field: 'fAntecedent', bar: '',
    question: 'You wrote that you moved to the floor. Was that in the plan?',
    suggestions: ['Moving to the floor settled him faster than the break did.'],
  }],
};

const TWO_PLACED = {
  sufficient: false, readiness: 70,
  questions: [
    { field: 'fAntecedent', bar: '', question: 'Was moving to the floor in the plan?', suggestions: [] },
    { field: 'fBehavior', bar: '', question: 'How did the two elopements compare with last week?', suggestions: [] },
  ],
};

// A field no form on this tool has. The panel keeps it.
const UNPLACEABLE = {
  sufficient: false, readiness: 70,
  questions: [{ field: 'fSomethingElse', bar: '', question: 'What was the weather doing?', suggestions: [] }],
};

async function ask(page, triage, { aid = true, onCall } = {}) {
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const last = (b.messages && b.messages.length) ? String(b.messages[b.messages.length - 1].content || '') : '';
    if (onCall) onCall(last, b);
    if (/look at your own draft again/i.test(last)) return route.fulfill(reply(note()));
    if (isTriageCall(b)) {
      if (/ALREADY ANSWERED/.test(last)) return route.fulfill(reply({ sufficient: true, readiness: 90, questions: [] }));
      return route.fulfill(reply(triage));
    }
    return route.fulfill(reply(note()));
  });

  const url = aid ? '/notes/bt/?aid=1' : '/notes/bt/';
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto(url);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, needed full physical most of it');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board, also moved to the floor and he settled');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ackGo = page.locator('#notes-ack-go');
  if (await ackGo.isVisible({ timeout: 6000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ackGo.click();
  }
  const scrubGo = page.locator('#notes-scrub-go');
  if (await scrubGo.isVisible({ timeout: 2000 }).catch(() => false)) await scrubGo.click();
}

/* One button ends the round, and in bar mode it is the only one on the panel.
   It waits out its own cooldown first, which is the tool charging for a skip
   and is not something a test should route around. */
async function finishTheRound(page) {
  const finish = page.locator('.skip-cooldown button').first();
  await expect(finish).toBeEnabled({ timeout: 40000 });
  await finish.click();
  const scrubGo = page.locator('#notes-scrub-go');
  if (await scrubGo.isVisible({ timeout: 3000 }).catch(() => false)) await scrubGo.click();
}

test.describe('the question goes to the box', () => {
  /* THE CONTROL. Without the flag nothing moves: the question is in the panel,
     where it has always been, and no question is drawn on the page. */
  test('without the flag no question is drawn on the page', async ({ page }) => {
    await ask(page, ONE_PLACED, { aid: false });
    await expect(page.getByText('Was that in the plan?')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-question-inline]')).toHaveCount(0);
  });

  test('a question about a box is drawn under that box', async ({ page }) => {
    await ask(page, ONE_PLACED);
    const q = page.locator('[data-question-inline="fAntecedent"]');
    await expect(q).toBeVisible({ timeout: 20000 });
    await expect(q).toContainText('Was that in the plan?');

    // Under it, not merely somewhere on the page.
    const order = await page.evaluate(() => {
      const box = document.querySelector('#field-fAntecedent').getBoundingClientRect();
      const ask = document.querySelector('[data-question-inline="fAntecedent"]').getBoundingClientRect();
      const next = document.querySelector('#field-fBehavior').getBoundingClientRect();
      return { belowItsBox: ask.top >= box.bottom - 2, aboveTheNextBox: ask.bottom <= next.top + 2 };
    });
    expect(order).toEqual({ belowItsBox: true, aboveTheNextBox: true });
  });

  test('and is not asked a second time in the panel', async ({ page }) => {
    await ask(page, ONE_PLACED);
    await expect(page.locator('[data-question-inline="fAntecedent"]')).toBeVisible({ timeout: 20000 });
    // One place, one answer box.
    await expect(page.getByText('Was that in the plan?')).toHaveCount(1);
    await expect(page.locator('[data-question-answer]')).toHaveCount(1);
  });

  test('two questions go to two different boxes', async ({ page }) => {
    await ask(page, TWO_PLACED);
    await expect(page.locator('[data-question-inline="fAntecedent"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-question-inline="fBehavior"]')).toBeVisible();
    await expect(page.locator('[data-question-inline="fAntecedent"]')).toContainText('moving to the floor');
    await expect(page.locator('[data-question-inline="fBehavior"]')).toContainText('elopements');
  });

  /* A question the form has no box for is not dropped to keep the layout
     tidy. The tool asked it, so the technician gets to see it. */
  test('a question naming no box on this form stays in the panel', async ({ page }) => {
    await ask(page, UNPLACEABLE);
    await expect(page.getByText('What was the weather doing?')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-question-inline]')).toHaveCount(0);
  });

  test('the suggestions come with the question, as rows and not glyphs', async ({ page }) => {
    await ask(page, ONE_PLACED);
    const q = page.locator('[data-question-inline="fAntecedent"]');
    await expect(q.locator('[data-disposition="0:0"]')).toBeVisible({ timeout: 20000 });
    await expect(q).toContainText('NoMe added this to your note');
    await expect(page.locator('[data-suggestion-tick]')).toHaveCount(0);
  });
});

test.describe('what the answers do', () => {
  test('an answer typed in place reaches the model with the question it answers', async ({ page }) => {
    const bodies = [];
    await ask(page, TWO_PLACED, { onCall: (last) => bodies.push(last) });
    await expect(page.locator('[data-question-answer="1"]')).toBeVisible({ timeout: 20000 });

    await page.locator('[data-question-answer="1"]').fill('Both elopements were shorter than last week.');
    await finishTheRound(page);

    await expect.poll(() => bodies.filter((b) => /ALREADY ANSWERED/.test(b)).length, { timeout: 20000 })
      .toBeGreaterThan(0);
    const answered = bodies.find((b) => /ALREADY ANSWERED/.test(b));
    // The pairing is what answering in place makes knowable, so it is written
    // down rather than left for the model to infer from one blob.
    expect(answered).toContain('How did the two elopements compare with last week?');
    expect(answered).toContain('Both elopements were shorter than last week.');
    // The question they did not answer contributes no blank.
    expect(answered).not.toContain('Was moving to the floor in the plan?');
  });

  /* The dead end the first version of this had. Below the readiness bar the
     tool refuses to draft until a round is answered, and it shows a line of
     text instead of a disabled button, which is right. But the floor plan took
     the panel's own answer box away, so a technician who typed a real answer
     under the question had no control on screen at all: the gate only knew how
     to open for a kept suggestion. Typing an answer opens it now, because
     typing an answer IS answering. */
  test('a typed answer opens the gate that was holding the round shut', async ({ page }) => {
    await ask(page, TWO_PLACED);
    await expect(page.locator('[data-question-answer="0"]')).toBeVisible({ timeout: 20000 });

    // Held, and saying so in words rather than with a dead button.
    await expect(page.locator('[data-skip-held="1"]')).toBeVisible();
    await expect(page.locator('.skip-cooldown button')).toHaveCount(0);

    await page.locator('[data-question-answer="0"]').fill('It was in the plan.');
    await expect(page.locator('[data-skip-held="1"]')).toHaveCount(0);
    await expect(page.locator('.skip-cooldown button').first()).toBeVisible();
  });

  /* The trap this feature could easily have set: type three sentences under the
     questions, press the button that ends the round, and watch them vanish
     because that button was built when the only answer box was in the panel. */
  test('finishing the round never throws away what they typed on the page', async ({ page }) => {
    const bodies = [];
    await ask(page, TWO_PLACED, { onCall: (last) => bodies.push(last) });
    await expect(page.locator('[data-question-answer="0"]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-question-answer="0"]').fill('It was in the plan, we use the floor for transitions.');

    await finishTheRound(page);

    await expect.poll(() => bodies.filter((b) => /ALREADY ANSWERED/.test(b)).length, { timeout: 20000 })
      .toBeGreaterThan(0);
    expect(bodies.find((b) => /ALREADY ANSWERED/.test(b)))
      .toContain('we use the floor for transitions');
  });
});

test.describe('on the phone he actually hands them', () => {
  /* The device profile minus defaultBrowserType, which Playwright refuses
     inside a describe because it would force a new worker. Everything that
     decides layout is here: the 390x664 viewport, the scale factor, and the
     touch and mobile flags. */
  const { defaultBrowserType, ...IPHONE } = devices['iPhone 14'];
  test.use(IPHONE);

  test('the box and the question about it are on screen together', async ({ page }) => {
    await ask(page, ONE_PLACED);
    await expect(page.locator('[data-question-inline="fAntecedent"]')).toBeVisible({ timeout: 25000 });
    await page.locator('#field-fAntecedent').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -80));

    const seen = await page.evaluate(() => {
      const vis = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0;
      };
      return {
        box: vis(document.querySelector('#field-fAntecedent')),
        question: vis(document.querySelector('[data-question-inline="fAntecedent"]')),
      };
    });
    expect(seen).toEqual({ box: true, question: true });
  });

  /* The panel measured 465px of a 664px viewport while it held the questions.
     With every question on the page it has one job left, so it is the size of
     one job. */
  test('the panel gives the screen back once it has handed the questions over', async ({ page }) => {
    await ask(page, ONE_PLACED);
    await expect(page.locator('[data-question-inline="fAntecedent"]')).toBeVisible({ timeout: 25000 });
    const panel = page.locator('.revision-panel');
    await expect(panel).toHaveClass(/revision-panel-bar/);
    const share = await page.evaluate(() => {
      const p = document.querySelector('.revision-panel');
      return p.getBoundingClientRect().height / window.innerHeight;
    });
    expect(share, 'the panel should be a bar, not most of the screen').toBeLessThan(0.4);
  });

  test('nothing on the page scrolls sideways', async ({ page }) => {
    await ask(page, TWO_PLACED);
    await expect(page.locator('[data-question-inline="fBehavior"]')).toBeVisible({ timeout: 25000 });
    const wide = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(wide).toBe(false);
  });
});
