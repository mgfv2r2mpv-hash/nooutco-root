import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { isTriageCall } from './helpers/llm-call.js';

/* Three items of his bar that the prompt asks for and now the tool guarantees.
 *
 * absence.js already proved the shape: a rule the prompt states in three places
 * and the model breaks anyway is a rule that has to run after the model
 * returns. These are the next three, and each one is enforced only as far as
 * being wrong is free.
 *
 * THE ATTACHED ZERO IS RECAST, because it is a rewrite that loses nothing. His
 * mark on a shipped note: "'without exhibiting' dodges a clean zero into a
 * participial. A zero is an observation and gets stated as one."
 *
 * THE CONTENTLESS SENTENCE IS COUNTED AND LEFT WHERE IT IS, because the cost of
 * being wrong is a deleted clinical fact against a saved style point, and
 * absence.js settled which way that trade goes.
 *
 * THE MISPLACED STRATEGY BECOMES A HINT, because completeness B9 is the one
 * item on his bar that is checkable exactly rather than judged: the tool
 * publishes both strategy lists, so a consequence procedure narrated in the
 * antecedent section is a fact about the note and not an opinion about it. His
 * case, on DRO: "though it uses motivation operations it isn't an antecedent
 * intervention properly."
 */

const SECRET = 'playwright-local-test-secret';
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function adminToken() {
  const payload = { role: 'admin', kid: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 };
  const s = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${s}.${b64url(createHmac('sha256', SECRET).update(s).digest())}`;
}

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}
const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const noteWith = (overrides) => ({
  individualsPresent: ['Client'],
  clinicalStatus: ['Presented Calm'],
  clinicalStatusNarrative: 'The client met the technician at the door and settled quickly.',
  purpose: ['Worked on goals as stated in the treatment plan'],
  servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'Eight of ten trials came back correct with a gestural prompt.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'A two minute warning preceded each transition and the client moved without protest.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions and the technician blocked the door.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
  ...overrides,
});

async function draft(page, note) {
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(note));
  });

  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto('/notes/bt/');

  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, 8 of 10 gestural');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('two minute warning before transitions');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
}

const section = (page, key) => page.locator(`textarea[data-section-id="${key}"]`);

test.describe('a zero gets a sentence of its own', () => {
  test('the participial he marked is moved out into its own statement', async ({ page }) => {
    await draft(page, noteWith({
      antecedentNarrative: 'The client completed programming without exhibiting behaviors of concern.',
    }));
    const a = section(page, 'antecedentNarrative');
    await expect(a).toHaveValue(/The client completed programming\. No behaviors of concern occurred\./);
    await expect(a).not.toHaveValue(/without exhibiting/i);
  });

  test('the quantifier comes off, because "No any behaviors" is not a sentence', async ({ page }) => {
    await draft(page, noteWith({
      behaviorPlanNarrative: 'The session ran to completion without displaying any of the targeted behaviors.',
    }));
    await expect(section(page, 'behaviorPlanNarrative'))
      .toHaveValue(/The session ran to completion\. No targeted behaviors occurred\./);
  });

  test('a clause after the participial is left alone rather than mangled', async ({ page }) => {
    // "No aggression, and then sat down occurred." is a sentence nobody wrote.
    // A zero left in a modifier is the sentence he already sees; costing the
    // compound case is the right way to be wrong.
    const original = 'The client transitioned without exhibiting aggression, and then sat down at the table.';
    await draft(page, noteWith({ behaviorPlanNarrative: original }));
    await expect(section(page, 'behaviorPlanNarrative')).toHaveValue(original);
  });

  test('"without prompting" is a prompt level and survives untouched', async ({ page }) => {
    // A wider "without <any gerund>" would take this, and a prompt level is a
    // clinical fact rather than a dodged zero.
    const original = 'The client completed four of five steps without prompting.';
    await draft(page, noteWith({ lessonProgressNarrative: original }));
    await expect(section(page, 'lessonProgressNarrative')).toHaveValue(original);
  });

  test('the recast reads as a zero to the absence strip, which never cuts one', async ({ page }) => {
    // The strip runs first for exactly this reason, and the new sentence has to
    // survive on its own terms too. A recast that got cut would delete the
    // finding rather than restate it.
    await draft(page, noteWith({
      behaviorPlanNarrative: 'The client stayed at the table without engaging in elopement.',
    }));
    await expect(section(page, 'behaviorPlanNarrative')).toHaveValue(/No elopement occurred\./);
  });
});

test.describe('a sentence with nothing in it is counted, never cut', () => {
  test('the contentless sentence stays on the page', async ({ page }) => {
    const original = 'These strategies supported the client throughout the session.';
    await draft(page, noteWith({ antecedentNarrative: original }));
    await expect(section(page, 'antecedentNarrative')).toHaveValue(original);
  });

  test('a sentence with an observable in it is not hollow, whatever verb it uses', async ({ page }) => {
    const original = 'These strategies supported the client across eight of ten trials.';
    await draft(page, noteWith({ antecedentNarrative: original }));
    await expect(section(page, 'antecedentNarrative')).toHaveValue(original);
    expect(await page.evaluate((s) => window.NoteHollow.isHollow(s), original)).toBe(false);
  });

  test('the count is what changes, and it is a number and not the sentence', async ({ page }) => {
    await draft(page, noteWith({}));
    const r = await page.evaluate(() => window.NoteHollow.pass(
      'These strategies supported the client throughout the session. The client said "more" on four occasions.'
    ));
    expect(r.hollow).toBe(1);
    expect(Object.keys(r)).toEqual(['text', 'recast', 'hollow']);
  });
});

test.describe('a strategy narrated under the wrong heading', () => {
  test('his DRO case is reported against the section it was written in', async ({ page }) => {
    await draft(page, noteWith({
      antecedentNarrative: 'Differential reinforcement was used throughout the session to keep the client engaged.',
      behaviorPlanNarrative: 'Elopement occurred twice and the technician blocked the door.',
    }));
    const box = page.getByTestId('hints-antecedentNarrative');
    await expect(box).toContainText(/wrong section/i);
    await expect(box).toContainText(/Differential reinforcement/);
  });

  test('a strategy that genuinely ran in both roles is reported in neither', async ({ page }) => {
    // His exception, verbatim: "A strategy that genuinely ran in both roles in
    // one session is narrated in both, and that is not an error."
    await draft(page, noteWith({
      antecedentNarrative: 'Differential reinforcement of other behavior ran during each transition.',
      behaviorPlanNarrative: 'Differential reinforcement followed each interval without elopement.',
    }));
    await expect(page.getByTestId('hints-antecedentNarrative')).toHaveCount(0);
  });

  test('a strategy in its own section is not a finding', async ({ page }) => {
    await draft(page, noteWith({
      antecedentNarrative: 'A visual schedule was posted at the table and the client checked it between tasks.',
    }));
    await expect(page.getByTestId('hints-antecedentNarrative')).toHaveCount(0);
  });

  test('the three labels with no safe phrase match nothing at all', async ({ page }) => {
    // "Offered choices", "Allowed break" and the "provided warning" half of
    // "Priming/provided warning" are ordinary words in clinical prose. A false
    // positive here puts a red hint on a correct note, so they carry no term
    // and this test is what keeps somebody from helpfully adding one.
    await draft(page, noteWith({}));
    const labels = await page.evaluate(() => {
      const own = window.NOTE_TOOLS.find((t) => t.id === 'bt').strategyOwnership.sections;
      return Object.keys(own).reduce((a, k) => a.concat(own[k].strategies.map((s) => s.label)), []);
    });
    expect(labels).not.toContain('Offered choices');
    expect(labels).not.toContain('Allowed break');
    expect(labels).not.toContain('Other');
    expect(labels).toContain('Differential reinforcement');
  });

  test('the injected hint goes through the same validation as the model\'s own', async ({ page }) => {
    // It is concatenated before normalizeOutput runs, so its code has to be in
    // the catalog and its section has to be a real one. A hint that skipped
    // that check would be the one hint on the note nobody validated.
    await draft(page, noteWith({}));
    const declared = await page.evaluate(() =>
      Object.keys(window.NOTE_TOOLS.find((t) => t.id === 'bt').hintCatalog));
    const code = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'bt').strategyOwnership.code);
    expect(declared).toContain(code);
  });
});

test.describe('the post-pass counts reach the store', () => {
  test('note_postpass is accepted rather than dropped at the door', async ({ request }) => {
    // note_register, recommendation and capture were all emitted by the browser
    // and refused here for weeks, because the allowlist and the call site were
    // added in different commits.
    const res = await request.post('/api/audit', {
      headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' },
      data: { events: [{ type: 'note_postpass', tool: 'bt', ts: Date.now(), data: { zeroRecast: 1, hollowSaid: 2, misplacedStrategy: 0 } }] },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).stored).toBe(1);
  });
});
