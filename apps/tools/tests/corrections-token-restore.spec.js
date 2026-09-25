import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The corrections pass speaks tokens both ways, like every other model turn.
 *
 * WHAT HE READ ON 2026-09-23. A parent-training note said "Minimal Redirect
 * (Request [[T6]]) for touching others" where he had typed "Request Attn". The
 * scrubber took Attn for a possible name and sent it out as an opaque token,
 * which is its job. The draft came back and finalize() put Attn back, which is
 * its job too. Then the corrections pass ran over the draft, and its answer went
 * straight into the note with no restore at all, so the token the pass copied
 * out of the scrubbed intake it was given stayed in the note.
 *
 * The same pass was also sent the RESTORED draft, so every word the scrubber
 * held back from the drafting call reached the corrections call in clear. Both
 * halves are pinned here: what leaves carries the token, and what comes back
 * carries the word.
 *
 * Every LLM call is intercepted. Nothing here reaches Anthropic.
 */

function tokenFor(role = 'user', tools = ['bt']) {
  const payload = { role, kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  const b64 = Buffer.from(JSON.stringify(payload))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.not-a-real-signature`;
}

function reply(obj) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(obj) }],
      usage: { output_tokens: 100 },
      stop_reason: 'end_turn',
    }),
  };
}

const OPAQUE = /\[\[T\d+\]\]/;
// The token inside the parentheses. The name pass takes "Request Attn" as one
// two-word phrase and "Minimal Redirect" as another, so the first token in the
// text is not this one.
const ATTN = /\((\[\[T\d+\]\])\)/;
const attnToken = (text) => (String(text).match(ATTN) || [null, '[[T1]]'])[1];

function note(token) {
  return {
    individualsPresent: ['Client'],
    clinicalStatus: ['Presented Tired'],
    clinicalStatusNarrative: 'The client presented as tired on arrival.',
    purpose: ['Worked on goals as stated in the treatment plan'],
    servicePaused: 'No',
    abaTechniques: ['Discrete Trial Training'],
    lessonProgressNarrative: 'The behavior technician used a three-item array.',
    antecedentStrategies: ['Offered choices'],
    antecedentNarrative: 'Choices were offered before each demand.',
    consequenceStrategies: ['Redirection'],
    consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
    // The model echoes the token it was given, as a real draft does.
    behaviorPlanNarrative: `Touching others was met with Minimal Redirect (${token}).`,
    clientProgress: 'Steady progress towards goals and behaviors',
    actionItems: ['None'],
    followUpNarrative: 'Direct staff do not report new questions or concerns for the BCBA.',
    hints: [],
  };
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

async function draft(page) {
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT 3-item array, full physical faded to independent');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i })
    .fill('touching others, staff used Minimal Redirect (Request Attn) each time');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await acceptScrubGate(page);
}

/* The token is read off what the page actually sent rather than assumed to be
   [[T1]], so the spec does not depend on how many other words were taken. */
async function stub(page, passBodies) {
  await page.route('**/api/llm-call**', async (route) => {
    const raw = route.request().postData() || '{}';
    if (isTriageCall(JSON.parse(raw))) return route.fulfill(reply({ sufficient: true, questions: [], readiness: 90 }));
    const token = attnToken(raw);
    return route.fulfill(reply(note(token)));
  });
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
  await page.route('**/api/corrections-pass**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    passBodies.push(body);
    // The pass copies the token out of the scrubbed intake, which is exactly
    // what a model given "[[T6]]" in its intake does.
    const token = attnToken(body.intake);
    const text = `Touching others was met with Minimal Redirect (${token}), and each episode ended.`;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        corrections: [{
          section: 'behaviorPlanNarrative',
          text,
          why: `You wrote that ${token} ended each episode.`,
          reasons: [{ quote: 'and each episode ended', why: `${token} ended each episode.` }],
        }],
        dropped: 0,
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'test',
      }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
});

test('the pass answer comes back into the note with the word, not the token', async ({ page }) => {
  const passBodies = [];
  await stub(page, passBodies);
  await page.goto('/notes/bt/');
  await draft(page);

  const section = page.locator('[data-corrections-section="behaviorPlanNarrative"]');
  await expect(section).toBeVisible({ timeout: 20000 });

  // Precondition, so a scrubber that stops taking Attn fails here loudly
  // instead of passing for the wrong reason.
  expect(passBodies.length, 'the corrections route was never called').toBe(1);
  expect(passBodies[0].intake, 'Attn was not tokenised, so this spec proves nothing').toMatch(ATTN);

  await expect(section).toContainText('(Request Attn)');
  await expect(section).not.toContainText('[[T');
});

test('the pass is sent the tokenised draft, never the restored word', async ({ page }) => {
  const passBodies = [];
  await stub(page, passBodies);
  await page.goto('/notes/bt/');
  await draft(page);
  await expect(page.locator('[data-corrections-section]').first()).toBeVisible({ timeout: 20000 });

  const sent = passBodies[0].draft.find((d) => d.id === 'behaviorPlanNarrative');
  expect(sent, 'the section was not sent to the pass').toBeTruthy();
  expect(sent.text).toMatch(OPAQUE);
  expect(sent.text).not.toContain('Attn');
});

test('what they type into an ask leaves under the map too, and not as typed', async ({ page }) => {
  const passBodies = [];
  await stub(page, passBodies);
  await page.goto('/notes/bt/');
  await draft(page);
  const section = page.locator('[data-corrections-section="behaviorPlanNarrative"]');
  await expect(section).toBeVisible({ timeout: 20000 });

  // The ask names the word the scrubber held back from every other call.
  await section.locator('[data-correction-type="ins"]').first().click();
  await page.locator('[data-correction-ask]').first().click();
  await page.locator('[data-correction-ask-input]').first().fill('say Request Attn ended each one');
  await page.locator('[data-correction-ask-save]').first().click();
  await page.locator('[data-panel-ask-send]').click();
  await acceptScrubGate(page);
  await expect.poll(() => passBodies.length, { timeout: 20000 }).toBe(2);

  const typed = passBodies[1].asks[0].text;
  expect(typed).toMatch(OPAQUE);
  expect(typed).not.toContain('Attn');
});
