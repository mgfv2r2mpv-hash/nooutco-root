import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* How did they show up. Two taps, and three words if they have them.
 *
 * His move, and it generalises past this one section: do not build a lock to
 * manage a section that changes late, restructure the section so it is
 * answerable completely at the start. His words on the lock he turned down:
 * "later edits you didn't know to ask for doesn't go into clinical status which
 * is copied early, and locked so it can't be updated to 'client engaged in
 * aggression when staff arrived' and have the clinical status on arrival
 * addressed."
 *
 * An arrival fact captured at arrival never has to be reconstructed from
 * something that turns up an hour later. Aggression at arrival is an arrival
 * fact and goes in the three words. Aggression at 2pm is a behaviour datum and
 * files to behaviour, where it always belonged.
 *
 * It lowers paperwork effort and not reporting effort. The technician still
 * reports what they saw; they stop composing a sentence about it.
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

async function open(page, { aid = true, onCall } = {}) {
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const last = (b.messages && b.messages.length) ? String(b.messages[b.messages.length - 1].content || '') : '';
    if (onCall) onCall(last, b);
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(note()));
  });
  const url = aid ? '/notes/bt/?aid=1' : '/notes/bt/';
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto(url);
}

async function fillRequired(page) {
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, needed full physical most of it');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board before transitions');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2, blocked and redirected');
}

/* The route sees two calls and only one of them is the note. Triage goes first
   and carries a different prompt entirely, so every assertion about what the
   draft was built from has to wait for the draft. */
async function draftPrompt(page, bodies) {
  await expect.poll(() => bodies.filter((b) => /SESSION START & CONTEXT/.test(b)).length, { timeout: 30000 })
    .toBeGreaterThan(0);
  return bodies.find((b) => /SESSION START & CONTEXT/.test(b));
}

async function generate(page) {
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ackGo = page.locator('#notes-ack-go');
  if (await ackGo.isVisible({ timeout: 6000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ackGo.click();
  }
  const scrubGo = page.locator('#notes-scrub-go');
  if (await scrubGo.isVisible({ timeout: 2500 }).catch(() => false)) await scrubGo.click();
}

test.describe('the arrival answer', () => {
  /* THE CONTROL, and it is the strongest one available here: a technician
     without the flag must not see a new control on their form tomorrow, and the
     prompt their note is built from must be unchanged to the byte. */
  test('without the flag there is no control and the prompt is untouched', async ({ page }) => {
    const bodies = [];
    await open(page, { aid: false, onCall: (last) => bodies.push(last) });
    await expect(page.locator('[data-arrival-field]')).toHaveCount(0);
    await expect(page.getByText('How did they show up?')).toHaveCount(0);

    await fillRequired(page);
    await generate(page);
    expect(await draftPrompt(page, bodies)).not.toContain('ARRIVAL, ANSWERED AT ARRIVAL');
  });

  test('two buttons and a short box, and nothing is preselected', async ({ page }) => {
    await open(page);
    await expect(page.getByText('How did they show up?')).toBeVisible();
    await expect(page.locator('[data-arrival="ready"]')).toHaveText('Normal, ready to go');
    await expect(page.locator('[data-arrival="notready"]')).toHaveText('Not ready');
    // Never answered on the technician's behalf. Clinical status is a clinical
    // claim and the tool does not get to make it.
    await expect(page.locator('[data-arrival-on="true"]')).toHaveCount(0);
  });

  test('one tap is the whole common case', async ({ page }) => {
    const bodies = [];
    await open(page, { onCall: (last) => bodies.push(last) });
    await page.locator('[data-arrival="ready"]').click();
    await expect(page.locator('[data-arrival="ready"]')).toHaveAttribute('data-arrival-on', 'true');

    await fillRequired(page);
    await generate(page);
    const sent = await draftPrompt(page, bodies);
    expect(sent).toContain('ARRIVAL, ANSWERED AT ARRIVAL AND AUTHORITATIVE FOR CLINICAL STATUS');
    expect(sent).toContain('presented as ready to work');
  });

  test('a tap can be taken back, because phones are phones', async ({ page }) => {
    await open(page);
    await page.locator('[data-arrival="notready"]').click();
    await expect(page.locator('[data-arrival="notready"]')).toHaveAttribute('data-arrival-on', 'true');
    await page.locator('[data-arrival="notready"]').click();
    await expect(page.locator('[data-arrival-on="true"]')).toHaveCount(0);
  });

  test('the words ride along, and the model is told not to contradict them later', async ({ page }) => {
    const bodies = [];
    await open(page, { onCall: (last) => bodies.push(last) });
    await page.locator('[data-arrival="notready"]').click();
    await page.getByRole('textbox', { name: /1 to 3 words/i }).fill('tired, refused breakfast');

    await fillRequired(page);
    await generate(page);
    const sent = await draftPrompt(page, bodies);
    expect(sent).toContain('did not present as ready to work');
    expect(sent).toContain('tired, refused breakfast');
    // The whole reason the datum is captured at arrival: something at 2pm is a
    // behaviour datum and must not be backfilled into the arrival picture.
    expect(sent).toContain('do not move a behavior that happened later in the session into the arrival picture');
  });

  /* THE ONE MISTAKE THIS FORM CANNOT MAKE. The words box is free text, so it
     has to go through the same PHI scan and the same substitution as every
     other box. It is declared as a textarea for exactly that reason: both
     collectFreeText and scrubValues select on the type. */
  test('a name typed in the words box is caught and never reaches the model', async ({ page }) => {
    const bodies = [];
    await open(page, { onCall: (last) => bodies.push(last) });
    await page.locator('[data-arrival="notready"]').click();
    await page.getByRole('textbox', { name: /1 to 3 words/i }).fill('Jacob was tired');
    await fillRequired(page);

    await generate(page);

    // Every call, not only the draft: triage reads the same boxes.
    await draftPrompt(page, bodies);
    const sent = bodies.join('\n');
    expect(sent, 'the name must never cross the wire').not.toContain('Jacob');
    expect(sent).toContain('tired');
  });

  test('answering nothing leaves the prompt exactly as it was', async ({ page }) => {
    const bodies = [];
    await open(page, { onCall: (last) => bodies.push(last) });
    await expect(page.locator('[data-arrival-field]')).toBeVisible();
    await fillRequired(page);
    await generate(page);
    expect(await draftPrompt(page, bodies)).not.toContain('ARRIVAL, ANSWERED AT ARRIVAL');
  });
});
