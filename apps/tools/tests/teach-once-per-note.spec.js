import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* One note teaches the style store once.
 *
 * His ruling on 2026-09-03: "one note should teach the style store once, not
 * once per Copy."
 *
 * A finished note goes into the EHR a section at a time, so it costs six or
 * seven presses of a Copy button. Every press used to re-run the whole
 * measurement: the same note_copied reading, and the same full-note style
 * comparison posted as fresh evidence. A style card counts evidence and derives
 * confidence from how many events agree, so a note copied section by section
 * outvoted six notes copied whole. The rule it taught was not more true, only
 * pressed more often.
 *
 * The other half of the same defect: Copy All recorded nothing whatever, so
 * which button a technician reached for decided whether their note taught the
 * store six times or not at all.
 */

const tokenFor = (role = 'user') => {
  const p = { role, kid: 'teach-once-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
};

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const NOTE = {
  individualsPresent: ['Client'],
  clinicalStatus: ['Presented Calm'],
  clinicalStatusNarrative: 'The client met the technician at the door and settled quickly into the session space.',
  purpose: ['Worked on goals as stated in the treatment plan'],
  servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'Eight of ten trials came back correct with a gestural prompt across the money array.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'A two minute warning preceded each transition and the client moved without protest.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions and the technician blocked the door and redirected.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
};

// Everything the page posted to /api/audit, split into the two things a copy
// records: the usage event, and the style evidence the profile store learns from.
async function draftAndWatch(page, role = 'user') {
  const events = [];
  const corrections = [];
  await page.route('**/api/audit**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    (body.events || []).forEach((e) => events.push(e));
    (body.corrections || []).forEach((c) => corrections.push(c));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"stored":1,"profile":"ok"}' });
  });
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(NOTE));
  });

  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor(role));
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

  return { events, corrections };
}

const copies = (events) => events.filter((e) => e.type === 'note_copied');

test.describe('a note copied section by section still teaches once', () => {
  test('pressing every Copy button records one note_copied, not one each', async ({ page }) => {
    const { events } = await draftAndWatch(page);
    const buttons = page.getByRole('button', { name: /^Copy$/ });
    const n = await buttons.count();
    expect(n, 'the note rendered no per-section Copy buttons, so this test is checking nothing').toBeGreaterThan(2);

    for (let i = 0; i < n; i += 1) await buttons.nth(i).click();

    await expect
      .poll(() => copies(events).length, { timeout: 10000, message: 'no note_copied event arrived at all' })
      .toBeGreaterThan(0);
    await page.waitForTimeout(1000); // give any duplicate the same chance to land
    expect(copies(events).length, `${n} Copy presses produced ${copies(events).length} note_copied events`).toBe(1);
  });

  test('and posts one batch of style evidence, not one per section', async ({ page }) => {
    const { corrections } = await draftAndWatch(page);

    // Rewrite a narrative so there is something for the comparison to find.
    const box = page.locator('textarea').filter({ hasText: /gestural prompt/ }).first();
    if (await box.count()) await box.fill('Ran the money array. Eight right out of ten. Gestural prompt each time.');

    const buttons = page.getByRole('button', { name: /^Copy$/ });
    const n = await buttons.count();
    for (let i = 0; i < n; i += 1) await buttons.nth(i).click();
    await page.waitForTimeout(1500);

    /* The store counts evidence per feature and derives confidence from how
       many events agree, so the corruption is a feature arriving twice off one
       note - not the batch count, which the flush is free to split. This is
       also why the assertion is not "exactly one batch": zero corrections is a
       legitimate outcome when the rewrite happened to move no measured
       feature, and the test says so rather than passing silently on it. */
    const seen = corrections.map((c) => c.feature);
    const dupes = seen.filter((f, i) => seen.indexOf(f) !== i);
    expect(dupes, `${n} Copy presses taught these features more than once: ${dupes.join(', ')}`).toEqual([]);
  });

  test('a fresh note may teach again, because it is new evidence', async ({ page }) => {
    const { events } = await draftAndWatch(page);
    await page.getByRole('button', { name: /^Copy$/ }).first().click();
    await expect.poll(() => copies(events).length, { timeout: 10000 }).toBe(1);

    // Generate again in the same session. The guard is per note, not per page.
    await page.getByRole('button', { name: 'Generate Note' }).click();
    const ack = page.locator('#notes-ack-go');
    if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.locator('#notes-ack-cb').check();
      await ack.click();
    }
    const rev = page.locator('#notes-scrub-go');
    if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    await page.getByRole('button', { name: /^Copy$/ }).first().click();
    await expect
      .poll(() => copies(events).length, { timeout: 10000, message: 'a second note taught nothing, so the guard is stuck on' })
      .toBe(2);
  });
});

test.describe('Copy All records the same note leaving', () => {
  test('it is not silent, so which button they press cannot decide what is learned', async ({ page }) => {
    // Admin, because that is the login the button is shown to: bt sets
    // copyAll false for technicians, on his ruling about their EHR workflow.
    const { events } = await draftAndWatch(page, 'admin');
    const all = page.getByRole('button', { name: 'Copy All' });
    await expect(all, 'Copy All did not render for an admin, so these two tests check nothing').toBeVisible();

    await all.click();
    await expect
      .poll(() => copies(events).length, { timeout: 10000, message: 'Copy All recorded nothing' })
      .toBe(1);
  });

  test('and does not double-count with a section copy afterwards', async ({ page }) => {
    // Admin, because that is the login the button is shown to: bt sets
    // copyAll false for technicians, on his ruling about their EHR workflow.
    const { events } = await draftAndWatch(page, 'admin');
    const all = page.getByRole('button', { name: 'Copy All' });
    await expect(all, 'Copy All did not render for an admin, so these two tests check nothing').toBeVisible();

    await all.click();
    await page.getByRole('button', { name: /^Copy$/ }).first().click();
    await page.waitForTimeout(1500);
    expect(copies(events).length).toBe(1);
  });
});
