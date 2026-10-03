import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* REGENERATE. His words, 2 Oct 2026:
 *
 *   "after the first time, generate is clicked on a page, it should switch to
 *   regenerate in orange button. When they click generate as opposed to
 *   revising in the panel, they are making a different decision, regenerate
 *   starts again with the raw input as a new process rather than continuing
 *   with the previous conversation."
 *
 * So the main button reads Generate Note until the first Generate lands on
 * this page load, then Regenerate in orange. Regenerate is a new note built
 * from the intake alone. The panel's Send is the other decision, and it still
 * continues the conversation.
 */

function tokenFor(tools = ['bt']) {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
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

const SUFFICIENT = { sufficient: true, readiness: 90, questions: [] };

const REVISIONS = {
  sufficient: false, readiness: 70,
  questions: [
    { field: 'fAntecedent', question: 'You wrote that you moved to the floor. Was that in the plan?',
      suggestions: ['Moving to the floor settled him faster than the break did.'] },
    { field: 'fBehavior', question: 'How did the two elopements end?',
      suggestions: ['Both ended with a block and a redirect to the table.'] },
  ],
};

const SECOND_ROUND = {
  sufficient: false, readiness: 70,
  questions: [
    { field: 'fBehavior', question: 'What did you do right after he reached the door?',
      suggestions: ['Blocked the door and pointed back to the table.'] },
  ],
};

const ORANGE = 'rgb(234, 88, 12)'; // --brand-fix, which is --orange-600

/* `triage` answers every first-round triage call; `later` answers a round that
   carries earlier answers. `failDraft` turns every note call into a 500. */
async function open(page, { triage = SUFFICIENT, later = null, aid = false, clock = false, failDraft = false } = {}) {
  const seen = { notes: [], revisions: [], triage: [] };
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const msgs = b.messages || [];
    const last = msgs.length ? String(msgs[msgs.length - 1].content || '') : '';
    if (/look at your own draft again/i.test(last)) return route.fulfill(reply(note()));
    if (isTriageCall(b)) {
      seen.triage.push(last);
      if (/ALREADY ANSWERED/.test(last)) return route.fulfill(reply(later || SUFFICIENT));
      return route.fulfill(reply(triage));
    }
    if (failDraft) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' });
    // A note call opens a conversation with one user turn; a revision carries
    // the conversation so far and a new turn on the end.
    (msgs.length > 1 ? seen.revisions : seen.notes).push(b);
    return route.fulfill(reply(note()));
  });
  if (clock) await page.clock.install();
  const url = aid ? '/notes/bt/?aid=1' : '/notes/bt/';
  await page.goto(url);
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto(url);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, needed full physical most of it');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board, also moved to the floor and he settled');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  return seen;
}

async function press(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
}

const passScrub = async (page) => {
  const go = page.locator('#notes-scrub-go');
  if (await go.isVisible({ timeout: 3000 }).catch(() => false)) await go.click();
};

/* WCAG relative luminance, from a computed rgb() string. */
const contrast = (fg, bg) => {
  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(fg); const b = lum(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const colours = (loc) => loc.evaluate((el) => {
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundColor, fg: cs.color };
});

test.describe('the main button after the first Generate', () => {
  test('reads Generate Note and is not orange until the first Generate, then Regenerate in orange', async ({ page }) => {
    await open(page);
    const first = page.getByRole('button', { name: 'Generate Note', exact: true });
    await expect(first).toBeVisible({ timeout: 20000 });
    await expect(first).not.toHaveClass(/\bis-regenerate\b/);
    expect((await colours(first)).bg).not.toBe(ORANGE);
    await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toHaveCount(0);

    await press(page, 'Generate Note');
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    const again = page.getByRole('button', { name: 'Regenerate', exact: true });
    await expect(again).toBeVisible();
    await expect(again).toHaveClass(/\bis-regenerate\b/);
    await expect(page.getByRole('button', { name: 'Generate Note', exact: true })).toHaveCount(0);
    // The click left the pointer on the button, which is its hover state.
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await colours(again)).bg).toBe(ORANGE);
    const c = await colours(again);
    // WCAG AA for 15px text is 4.5:1.
    expect(contrast(c.fg, c.bg)).toBeGreaterThanOrEqual(4.5);

    // Hover darkens it and keeps the text readable.
    await again.hover();
    await expect.poll(async () => (await colours(again)).bg).not.toBe(ORANGE);
    const h = await colours(again);
    expect(contrast(h.fg, h.bg)).toBeGreaterThanOrEqual(4.5);
  });

  test('a first round of questions on screen counts as the first Generate', async ({ page }) => {
    await open(page, { triage: REVISIONS });
    await press(page, 'Generate Note');
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toHaveClass(/\bis-regenerate\b/);
  });

  test('a first Generate that fails keeps the Generate Note label', async ({ page }) => {
    await open(page, { failDraft: true });
    await press(page, 'Generate Note');
    await expect(page.getByText(/Request failed/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Generate Note', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Regenerate', exact: true })).toHaveCount(0);
  });
});

test.describe('Regenerate starts a new process from the intake', () => {
  test('the request carries no earlier turns and has the shape of a first Generate, while the panel Send still continues', async ({ page }) => {
    const seen = await open(page);
    await press(page, 'Generate Note');
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
    expect(seen.notes).toHaveLength(1);

    // The panel's Send continues the conversation: it carries the draft back.
    await page.locator('.revision-input').fill('Make the antecedent section shorter please.');
    await page.locator('.revision-send').click();
    await passScrub(page);
    await expect.poll(() => seen.revisions.length, { timeout: 20000 }).toBe(1);
    expect(seen.revisions[0].messages.length).toBeGreaterThan(1);

    await press(page, 'Regenerate');
    await expect.poll(() => seen.notes.length, { timeout: 20000 }).toBe(2);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    const [firstCall, again] = seen.notes;
    expect(again.messages).toHaveLength(1);
    expect(Object.keys(again).sort()).toEqual(Object.keys(firstCall).sort());
    expect(again.messages).toEqual(firstCall.messages);
    expect(String(again.messages[0].content)).not.toContain('shorter please');
    // The thread starts over too: the revision ask is not shown under the new note.
    await expect(page.locator('.revision-panel').getByText('Make the antecedent section shorter please.')).toHaveCount(0);
  });

  test('answers typed in place on the old round do not ride into the new one', async ({ page }) => {
    const seen = await open(page, { triage: REVISIONS, aid: true, clock: true });
    await press(page, 'Generate Note');
    const inPlace = page.locator('[data-question-answer="0"]');
    await expect(inPlace).toBeVisible({ timeout: 20000 });
    const stale = 'It was in the plan, the BCBA added it last week.';
    await inPlace.fill(stale);
    await expect(page.locator('.revision-send')).toBeEnabled();

    await press(page, 'Regenerate');
    await expect(page.locator('[data-question-answer="0"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-question-answer="0"]')).toHaveValue('');
    // A new round 1 with nothing written: locked, as for a new note.
    await expect(page.locator('.revision-send')).toBeDisabled();
    await expect(page.locator('[data-send-lock]')).toBeVisible();

    /* Nothing arrives chosen (2 Oct 2026), so below the bar the gate holds an
       untouched round even after the minute. A short fresh answer opens it
       without opening the wait, which still runs off the clock. */
    await page.locator('[data-question-answer="0"]').fill('Yes.');
    await page.clock.runFor(61_000);
    await page.locator('.revision-send').click();
    await passScrub(page);
    await expect.poll(() => seen.notes.length, { timeout: 20000 }).toBe(1);
    expect(String(seen.notes[0].messages[0].content)).not.toContain(stale);
  });

  test('a Regenerate on a finished note clears it before the new round asks', async ({ page }) => {
    await open(page, { triage: SUFFICIENT });
    await press(page, 'Generate Note');
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    // The next triage asks, so the new process stops at a question round.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.route('**/api/llm-call**', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}');
      return route.fulfill(reply(isTriageCall(b) ? REVISIONS : note()));
    });
    await press(page, 'Regenerate');
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Generated Note')).toHaveCount(0);
  });
});

test.describe('the Send lock after Regenerate', () => {
  test('round 1 of a regenerated note locks again after the old note had feedback', async ({ page }) => {
    const seen = await open(page, { triage: REVISIONS, later: SECOND_ROUND, clock: true });
    await press(page, 'Generate Note');
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    const send = page.locator('.revision-send');
    const lock = page.locator('[data-send-lock]');
    await expect(send).toBeDisabled();

    // One Send is the first feedback, so the second round opens straight away.
    await page.locator('.revision-input').fill('He ran to the door twice.');
    await send.click();
    await passScrub(page);
    await expect(page.getByText(/right after he reached the door/i)).toBeVisible({ timeout: 20000 });
    await expect(send).toBeEnabled();

    // Regenerate mid-conversation: a new note, so round 1 locks again.
    await press(page, 'Regenerate');
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await expect(send).toBeDisabled();
    await expect(lock).toBeVisible();
    await expect(lock).toHaveText(/\b(60|59|58)s\b/, { timeout: 2000 });
    await expect(page.locator('.revision-input')).toHaveAttribute('aria-describedby', 'revision-send-lock');
    expect(seen.notes).toHaveLength(0);

    /* A short answer, because with nothing arriving chosen (2 Oct 2026) the
       gate below the bar holds an untouched round after the minute too. Short
       of 25 characters it leaves the wait running. */
    await page.locator('.revision-input').fill('Twice.');
    await expect(send).toBeDisabled();
    await page.clock.runFor(61_000);
    await expect(send).toBeEnabled();
    await expect(lock).toHaveCount(0);
  });
});
