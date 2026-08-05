import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

/* "What would you do here?" - the only path that reaches the owning clinician's
 * stored judgement.
 *
 * His ruling of 2026-08-04 was that an opinion fires ONLY when the tool asks:
 * it never fills a silence in the input. Everything here exists to hold that
 * line, because the gate is worth exactly as much as the assertion that no other
 * path opens it.
 *
 * Note the belt and braces: BT is also absent from the Worker's allowlist, so
 * even a request that sets the flag composes nothing for this tool. These tests
 * cover the CLIENT half - which calls send the flag at all.
 */

const SECRET = 'playwright-local-test-secret';
const b64url = (b) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function tokenFor(role = 'user', tools = ['bt']) {
  const payload = { role, kid: 'pw:tech-1', tools, exp: Math.floor(Date.now() / 1000) + 3600 };
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${p}.${b64url(createHmac('sha256', SECRET).update(p).digest())}`;
}

const reply = (obj) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
    usage: { output_tokens: 100 },
    stop_reason: 'end_turn',
  }),
});

function note(overrides = {}) {
  return {
    individualsPresent: ['Client'],
    clinicalStatus: ['Presented Tired'],
    clinicalStatusNarrative: 'The client presented as tired on arrival.',
    purpose: ['Worked on goals as stated in the treatment plan'],
    servicePaused: 'No',
    abaTechniques: ['Discrete Trial Training'],
    lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
    antecedentStrategies: ['Offered choices'],
    antecedentNarrative: 'Choices were offered before each demand.',
    consequenceStrategies: ['Redirection'],
    consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
    behaviorPlanNarrative: 'Elopement occurred on two occasions.',
    clientProgress: 'Steady progress towards goals and behaviors',
    actionItems: ['None'],
    followUpNarrative: 'Direct staff do not report new questions or concerns for the BCBA.',
    hints: [],
    ...overrides,
  };
}

// The panel docks as a collapsed pill, and the ask button lives in its footer.
async function openPanel(page) {
  const input = page.locator('.revision-input');
  if (await input.isVisible({ timeout: 800 }).catch(() => false)) return;
  const fab = page.locator('.revision-fab').first();
  if (await fab.isVisible({ timeout: 3000 }).catch(() => false)) await fab.click();
  await expect(input).toBeVisible({ timeout: 5000 });
}

async function acceptScrubGate(page) {
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await expect(ack).toBeEnabled();
    await ack.click();
  }
  const review = page.locator('#notes-scrub-go');
  if (await review.isVisible({ timeout: 1500 }).catch(() => false)) await review.click();
}

async function draftANote(page) {
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT 3-item array, full physical faded to independent');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await acceptScrubGate(page);
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 15000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
});

test.describe('asking what he would do', () => {
  test('drafting a note never asks for his judgement', async ({ page }) => {
    // THE LOAD-BEARING ONE. If drafting ever sets this flag, his stored calls
    // start appearing in notes nobody asked to individualise, which is the whole
    // failure his ruling 2 exists to prevent.
    const posted = [];
    await page.route('**/api/llm-call**', async (route) => {
      posted.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill(reply(posted.length === 1 ? { sufficient: true, questions: [] } : note()));
    });

    await page.goto('/notes/bt/');
    await draftANote(page);

    expect(posted.length).toBeGreaterThan(0);
    for (const body of posted) {
      expect(body.want_opinions, 'a draft must not request his judgement').toBeUndefined();
    }
  });

  test('revising a note never asks either', async ({ page }) => {
    const posted = [];
    await page.route('**/api/llm-call**', async (route) => {
      posted.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill(reply(posted.length === 1 ? { sufficient: true, questions: [] } : note()));
    });

    await page.goto('/notes/bt/');
    await draftANote(page);

    const before = posted.length;
    await openPanel(page);
    const input = page.locator('.revision-input');
    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
      await input.fill('make the behaviour section shorter');
      await page.locator('.revision-send').click();
      await acceptScrubGate(page);
      await page.waitForTimeout(1500);
      expect(posted.length).toBeGreaterThan(before);
      for (const body of posted) expect(body.want_opinions).toBeUndefined();
    }
  });

  test('the button is disabled until there is a note, and stacks no refusals', async ({ page }) => {
    // It used to accept the click and answer "generate the note first", so four
    // clicks put four identical lines in the thread and nothing on the button
    // ever said why. He hit exactly that on his first real use.
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');
    await openPanel(page);

    const ask = page.getByRole('button', { name: /What would you do here/i });
    await expect(ask).toBeVisible();
    await expect(ask).toBeDisabled();
    await expect(ask).toHaveAttribute('title', /Generate the note first/i);
    // Nothing was pushed into the thread by looking at it.
    await expect(page.getByText('Generate the note first, then I can suggest')).toHaveCount(0);
  });

  test('the button asks, and is the only thing that does', async ({ page }) => {
    const posted = [];
    await page.route('**/api/llm-call**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      posted.push(body);
      if (body.want_opinions === true) {
        return route.fulfill(reply('Consider running this target in more than one area of the home.'));
      }
      return route.fulfill(reply(posted.length === 1 ? { sufficient: true, questions: [] } : note()));
    });

    await page.goto('/notes/bt/');
    await draftANote(page);
    await openPanel(page);
    const beforeAsk = posted.length;

    const ask = page.getByRole('button', { name: /What would you do here/i });
    await expect(ask).toBeVisible();
    await ask.click();
    await page.waitForTimeout(2000);

    const asked = posted.slice(beforeAsk);
    expect(asked.length, 'the button must make a call').toBeGreaterThan(0);
    // Sent as a literal true, so a truthy value cannot open the gate by accident.
    expect(asked[0].want_opinions).toBe(true);
    // Advice is prose, so constraining it to the note's schema would force it
    // back into sections.
    expect(asked[0].output_config).toBeUndefined();
    // Exactly one call carries the flag: the one the clinician pressed for.
    expect(posted.filter((b) => b.want_opinions === true)).toHaveLength(1);
  });

  test('the request asks for implications and gaps, not just the immediate answer', async ({ page }) => {
    // His note on first real use: "it isn't quite thoughtful enough. I make a
    // statement and it does it small and simple and doesn't consider or ask if
    // there are larger implications."
    //
    // A clinician asking this has already thought of the obvious move, so the
    // value is in what follows from it and in what is missing. The deepening
    // also raises the fabrication risk, which is why the same prompt marks an
    // untraceable implication as a question rather than an assertion.
    let asked = null;
    await page.route('**/api/llm-call**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.want_opinions === true) { asked = body; return route.fulfill(reply('ADVICE')); }
      return route.fulfill(reply(asked === null && !body.messages ? { sufficient: true, questions: [] } : note()));
    });
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');
    await draftANote(page);
    await openPanel(page);
    await page.getByRole('button', { name: /What would you do here/i }).click();
    await page.waitForTimeout(1500);

    const sent = JSON.stringify(asked);
    expect(asked, 'the ask must reach the API').not.toBeNull();
    expect(sent).toMatch(/ANSWER AT THREE LEVELS/);
    expect(sent).toMatch(/What follows from it/);
    expect(sent).toMatch(/What you would want to know/);
    expect(sent).toMatch(/already thought of the obvious move/);
    // The guard that has to travel with the depth.
    expect(sent).toMatch(/mark it as a question rather than asserting it/);
  });

  test('advice answers in the panel and does not edit the note', async ({ page }) => {
    // A recommendation is something to read and act on. Silently rewriting the
    // note would make his judgement indistinguishable from the record.
    await page.route('**/api/llm-call**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.want_opinions === true) return route.fulfill(reply('ADVICE-TEXT-ONLY'));
      return route.fulfill(reply(body.messages ? note() : { sufficient: true, questions: [] }));
    });

    await page.goto('/notes/bt/');
    await draftANote(page);

    await openPanel(page);
    const before = await page.locator('textarea[data-section-id]').first().inputValue();
    await page.getByRole('button', { name: /What would you do here/i }).click();
    await expect(page.getByText('ADVICE-TEXT-ONLY')).toBeVisible({ timeout: 10000 });

    const after = await page.locator('textarea[data-section-id]').first().inputValue();
    expect(after, 'advice must not rewrite the note').toBe(before);
    // And nothing is staged for accept/discard either.
    await expect(page.getByRole('button', { name: /^Accept/ })).toHaveCount(0);
  });
});

/* The copy-prompt path: logged-out only.
 *
 * His refinement of 2026-08-04: "If someone is not logged in, they get a
 * basic-ass prompt from the copy prompt button. if you log in, it is
 * generate-in-place."
 *
 * That is a better answer than removing it, which is what I did first. A
 * logged-out visitor cannot reach the Worker at all, so a pasteable prompt is
 * the only value the page can offer them, and since they are not authenticated
 * the voice block was never going to reach them either. Signed in, the button is
 * absent and Generate Note is the only route - which is what makes it true that
 * no authenticated output can bypass his voice.
 */
test.describe('the copy-prompt path', () => {
  test('a logged-out visitor gets the button', async ({ page }) => {
    await page.goto('/notes/bt/');
    await page.evaluate(() => localStorage.removeItem('notes_auth_token'));
    await page.goto('/notes/bt/');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    await expect(page.getByRole('button', { name: 'Generate Prompt' })).toBeVisible();
  });

  test('a signed-in clinician does not, so every authenticated route goes through the Worker', async ({ page }) => {
    // THE LOAD-BEARING ONE. If this button reappears while signed in, there is
    // a way to produce output from the tool that never sees his voice.
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    await expect(page.getByRole('button', { name: 'Generate Prompt' })).toHaveCount(0);
    await expect(page.getByText('Generated Prompt')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Generate Note/i })).toBeVisible();
  });

  test('every signed-in generation carries the tool id the Worker keys the voice on', async ({ page }) => {
    const posted = [];
    await page.route('**/api/llm-call**', async (route) => {
      posted.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill(reply(posted.length === 1 ? { sufficient: true, questions: [] } : note()));
    });
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');
    await draftANote(page);
    expect(posted.length).toBeGreaterThan(0);
    for (const body of posted) expect(body.tool).toBe('bt');
  });
});
