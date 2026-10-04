import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';
import { sanitizeAuditEvent, AUDIT_TYPES } from '../_worker.js';

/* NO PRE-PICK. His ruling, 2 Oct 2026 (finding 6):
 *
 *   "yes stop the prepick. The design of it should help guide them through.
 *   for example, the NoMe questions should start scroll top-aligned to the
 *   first open item from that round, not at the bottom of the list"
 *
 *   "clicking onto a box for an unchosen item should pick it and open it in
 *   edit textbox mode, and any pending changes in other changes show back to
 *   faded with the pencil glowing yellow to show the deselected change is
 *   unsaved"
 *
 * The first suggestion used to stand by default, so a technician who pressed
 * Send without touching anything sent NoMe's words as their own answer. Now
 * nothing stands until they choose it, and a question they leave alone goes to
 * the model marked "(not refined)".
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

const FLOOR = 'Moving to the floor settled him faster than the break did.';
const BOARD = 'The first-then board worked better once we were down there.';
const BLOCK = 'Both ended with a block and a redirect to the table.';

const ROUND = (readiness = 70) => ({
  sufficient: false, readiness,
  questions: [
    { field: 'fAntecedent', question: 'You wrote that you moved to the floor. Was that in the plan?', suggestions: [FLOOR, BOARD] },
    { field: 'fBehavior', question: 'How did the two elopements end?', suggestions: [BLOCK] },
  ],
});

/* Three questions, each with two offers, so the second round is taller than
   the panel and "top of the scroll area" and "bottom of the list" differ.
   Read at 40, because a note reading 60 or more is asked two at most. */
const SECOND = {
  sufficient: false, readiness: 40,
  questions: [
    { field: 'fBehavior', question: 'What did you do right after he reached the door?',
      suggestions: ['Blocked the door and pointed back to the table.', 'Waited at the door and offered a break card.'] },
    { field: 'fAntecedent', question: 'Which reinforcer was on the first-then board?',
      suggestions: ['The tablet, for two minutes.', 'Bubbles at the table.'] },
    { field: 'fSkill', question: 'Which target in the money program needed full physical?',
      suggestions: ['Identifying the quarter.', 'Identifying the dime.'] },
  ],
};

const NOT_REFINED = '(not refined)';
/* The question, then the marker on the line under it. The optional "A: " is
   for #229, which labels each answer under its question; the marker reads the
   same in both shapes. */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const notRefined = (question) => new RegExp(esc(question) + '\\n(?:A: )?' + esc(NOT_REFINED));

async function ask(page, triage, { later = null, aid = false } = {}) {
  const seen = { notes: [], triage: [] };
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const last = (b.messages && b.messages.length) ? String(b.messages[b.messages.length - 1].content || '') : '';
    if (/look at your own draft again/i.test(last)) return route.fulfill(reply(note()));
    if (isTriageCall(b)) {
      seen.triage.push(last);
      if (/ALREADY ANSWERED/.test(last)) return route.fulfill(reply(later || { sufficient: true, readiness: 90, questions: [] }));
      return route.fulfill(reply(triage));
    }
    seen.notes.push(b);
    return route.fulfill(reply(note()));
  });
  // Refused, so every audit event stays in the browser's buffer to be read.
  await page.route('**/api/audit**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.clock.install();
  await page.goto(aid ? '/notes/bt/?aid=1' : '/notes/bt/');
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto(aid ? '/notes/bt/?aid=1' : '/notes/bt/');
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, needed full physical most of it');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board, also moved to the floor and he settled');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note', exact: true }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  await passScrub(page);
  await expect(page.locator('.revision-panel')).toBeVisible({ timeout: 20000 });
  return seen;
}

const passScrub = async (page) => {
  const go = page.locator('#notes-scrub-go');
  if (await go.isVisible({ timeout: 1500 }).catch(() => false)) await go.click();
};

const noteText = (seen) => String(seen.notes[0].messages[0].content);

test.describe('nothing is picked until the technician picks it', () => {
  test('no suggestion stands on load, and every offered row carries a checkmark', async ({ page }) => {
    await ask(page, ROUND());
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-suggestion]')).toHaveCount(3);
    await expect(page.locator('[data-suggestion-accepted="1"]')).toHaveCount(0);
    for (const id of ['0:0', '0:1', '1:0']) {
      await expect(page.locator(`[data-suggestion-tick="${id}"]`)).toBeVisible();
      await expect(page.locator(`[data-suggestion-pencil="${id}"]`)).toHaveCount(0);
    }
  });

  test('Send with nothing picked sends the question as not refined, and never a suggestion', async ({ page }) => {
    // At 90 neither the gate nor the wait holds, so an untouched round can go.
    // A note that ready is asked one question (QUESTION_CEILINGS).
    const seen = await ask(page, ROUND(90));
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    const send = page.locator('.revision-send');
    await expect(send).toBeEnabled();
    await send.click();
    await passScrub(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    const content = noteText(seen);
    const at = content.indexOf('\n\nTHE TECHNICIAN ADDED');
    expect(at, 'the untouched question never reached the model').toBeGreaterThan(0);
    expect(content.slice(at)).toMatch(notRefined('You wrote that you moved to the floor. Was that in the plan?'));
    for (const offered of [FLOOR, BOARD]) {
      expect(content, 'an untouched suggestion went out as the answer').not.toContain(offered);
    }
  });

  /* The second round never gates and, after one Send, never waits, so an
     untouched round of three can go straight away. */
  const toSecondRound = async (page) => {
    const seen = await ask(page, ROUND(70), { later: SECOND });
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await page.locator('.revision-input').fill('He ran to the door twice, then came back.');
    await page.locator('.revision-send').click();
    await passScrub(page);
    await expect(page.getByText(/right after he reached the door/i)).toBeVisible({ timeout: 20000 });
    return seen;
  };

  test('every question of an untouched second round goes as not refined, and no offer goes with them', async ({ page }) => {
    const seen = await toSecondRound(page);
    await page.locator('.revision-send').click();
    await passScrub(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    const content = noteText(seen);
    for (const q of SECOND.questions) {
      expect(content).toMatch(notRefined(q.question));
      for (const offered of q.suggestions) {
        expect(content, 'an untouched suggestion went out as the answer').not.toContain(offered);
      }
    }
  });

  test('a picked question carries its pick and the ones left alone are marked not refined', async ({ page }) => {
    const seen = await toSecondRound(page);
    await page.locator('[data-suggestion-tick="1:1"]').click();
    await page.locator('.revision-send').click();
    await passScrub(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    const content = noteText(seen);
    const [q0, q1, q2] = SECOND.questions;
    expect(content).toContain(q1.suggestions[1]);
    expect(content).not.toContain(q1.suggestions[0]);
    expect(content).not.toMatch(notRefined(q1.question));
    expect(content).toMatch(notRefined(q0.question));
    expect(content).toMatch(notRefined(q2.question));
  });

  /* His review of #235: "Instead of the disabled-out 'Generate' button, have
     it say 'Please respond to some items above to proceed' or something like
     that but better." So a held round has no greyed Send: a line of text
     stands where it was. */
  test('below the bar an untouched round shows a line where Send was, not a greyed button', async ({ page }) => {
    await ask(page, ROUND(70));
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    const send = page.locator('.revision-send');
    await page.clock.runFor(61_000);
    await expect(send).toHaveCount(0);
    const held = page.locator('.revision-compose [data-skip-held]');
    await expect(held).toHaveText('Send opens after one question above is picked or answered.');
    await expect(page.locator('.revision-input')).toHaveAttribute('aria-describedby', /revision-send-held/);
    await expect(page.locator('#revision-send-held')).toHaveCount(1);

    await page.locator('[data-suggestion="1:0"]').click();
    await expect(send).toBeEnabled();
    await expect(page.locator('[data-skip-held]')).toHaveCount(0);
  });

  test('a round with nothing to pick says answered, not picked', async ({ page }) => {
    await ask(page, { sufficient: false, readiness: 70, questions: [{ field: 'fBehavior', question: 'How many times?', suggestions: [] }] });
    await expect(page.getByText(/How many times/i)).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.revision-send')).toHaveCount(0);
    await expect(page.locator('[data-skip-held]')).toHaveText('Send opens after one question above is answered.');
    await page.locator('.revision-input').fill('Twice.');
    await expect(page.locator('.revision-send')).toBeEnabled();
  });

  test('while the wait runs, its note stands where Send was, and Send comes back when it ends', async ({ page }) => {
    await ask(page, ROUND(70));
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    // Answered, so no longer held, but short of 25 characters, so still waiting.
    await page.locator('.revision-input').fill('Twice.');
    await expect(page.locator('[data-skip-held]')).toHaveCount(0);
    await expect(page.locator('.revision-send')).toHaveCount(0);
    await expect(page.locator('.revision-compose [data-send-lock]')).toBeVisible();
    await page.clock.runFor(61_000);
    await expect(page.locator('.revision-send')).toBeEnabled();
    await expect(page.locator('[data-send-lock]')).toHaveCount(0);
  });
});

test.describe('a picked suggestion counts as an answer for the Send wait', () => {
  test('choosing one opens Send without waiting the minute or typing 25 characters', async ({ page }) => {
    await ask(page, ROUND(70));
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    const send = page.locator('.revision-send');
    const lock = page.locator('[data-send-lock]');
    await expect(send).toHaveCount(0);
    await expect(lock).toBeVisible();

    await page.locator('[data-suggestion-tick="1:0"]').click();
    await expect(send).toBeEnabled();
    await expect(lock).toHaveCount(0);
  });

  test('own words short of 25 characters do not count as a pick, so the wait comes back', async ({ page }) => {
    await ask(page, ROUND(70));
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    const send = page.locator('.revision-send');
    const lock = page.locator('[data-send-lock]');

    await page.locator('[data-suggestion-tick="1:0"]').click();
    await expect(send).toBeEnabled();

    // Keying own words is ipso facto the choice, so the pick goes, and a short
    // answer typed in place is held to the 25 characters as before.
    const own = page.locator('[data-suggestion-own="1:own"]');
    await own.fill('On his own.');
    await own.press('Enter');
    await expect(page.locator('[data-suggestion-accepted="1"]')).toHaveCount(0);
    await expect(send).toHaveCount(0);
    await expect(lock).toBeVisible();
  });
});

test.describe('clicking an unchosen box picks it and opens it for editing', () => {
  test('the field takes focus with the caret at the end', async ({ page }) => {
    await ask(page, ROUND());
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });

    await page.locator('[data-suggestion="0:1"]').click();
    const field = page.locator('[data-suggestion-field="0:1"]');
    await expect(field).toHaveAttribute('data-suggestion-accepted', '1');
    await expect(field).toBeFocused();
    const caret = await field.evaluate((el) => [el.selectionStart, el.selectionEnd, el.value.length]);
    expect(caret).toEqual([BOARD.length, BOARD.length, BOARD.length]);
    await expect(page.locator('[data-suggestion="0:0"]')).toHaveAttribute('data-suggestion-accepted', '0');
  });

  test('the checkmark picks it the same way, so focus does not fall off the page', async ({ page }) => {
    await ask(page, ROUND());
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await page.locator('[data-suggestion-tick="1:0"]').click();
    await expect(page.locator('[data-suggestion-field="1:0"]')).toBeFocused();
  });
});

test.describe('an edit left behind by a pick', () => {
  test('shows faded with a yellow pencil, says so in words, and keeps its text for a re-pick', async ({ page }) => {
    await ask(page, ROUND());
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });

    await page.locator('[data-suggestion="0:0"]').click();
    const field = page.locator('[data-suggestion-field="0:0"]');
    await expect(field).toBeFocused();
    await page.keyboard.type(' Inside a minute.');
    const edited = FLOOR + ' Inside a minute.';
    await expect(field).toHaveValue(edited);

    // Picking the other one deselects this one while its words are unsaved.
    await page.locator('[data-suggestion="0:1"]').click();
    await expect(page.locator('[data-suggestion-field="0:1"]')).toBeFocused();

    const row = page.locator('[data-suggestion-row="0:0"]');
    await expect(row).toHaveAttribute('data-suggestion-unsaved', '1');
    await expect(page.locator('[data-suggestion="0:0"]')).toHaveText(edited);
    await expect(page.locator('[data-suggestion="0:0"]')).toHaveAttribute('data-suggestion-accepted', '0');

    // Faded.
    const opacity = await row.locator('.tg-suggestion-text').evaluate((el) => Number(window.getComputedStyle(el).opacity));
    expect(opacity).toBeLessThan(1);

    // The pencil glows yellow, and colour is not the only cue.
    const pencil = page.locator('[data-suggestion-pencil="0:0"]');
    await expect(pencil).toBeVisible();
    await expect(pencil).toHaveAttribute('aria-label', /unsaved/i);
    const [r, g, b] = (await pencil.evaluate((el) => window.getComputedStyle(el).color)).match(/\d+/g).map(Number);
    expect(r, 'the stranded pencil is not amber').toBeGreaterThan(b + 60);
    expect(g).toBeGreaterThan(b);
    await expect(row.locator('.tg-unsaved-dot')).toHaveCount(1);
    await expect(row.locator('.tg-unsaved-say')).toHaveText(/unsaved/i);

    // A click on the faded sentence picks it again with the edit still unsaved.
    await page.locator('[data-suggestion="0:0"]').click();
    await expect(field).toHaveValue(edited);
    await expect(field).toBeFocused();
    await expect(page.locator('[data-suggestion-pencil="0:0"]')).toHaveAttribute('data-suggestion-dirty', '1');
    await expect(row).toHaveAttribute('data-suggestion-unsaved', '0');
    await expect(page.locator('[data-suggestion="0:1"]')).toHaveAttribute('data-suggestion-accepted', '0');
  });

  /* His review of #235: "Clicking with unsaved also leaves an amber icon to
     revert to suggestion / discard edits idempotent with save. On save, it
     selects that item if unselected." */
  const strand = async (page) => {
    await ask(page, ROUND());
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await page.locator('[data-suggestion="0:0"]').click();
    await page.keyboard.type(' Inside a minute.');
    await page.locator('[data-suggestion="0:1"]').click();
    await expect(page.locator('[data-suggestion-row="0:0"]')).toHaveAttribute('data-suggestion-unsaved', '1');
    return FLOOR + ' Inside a minute.';
  };

  test('the amber pencil saves the edit and picks the row', async ({ page }) => {
    const edited = await strand(page);
    const pencil = page.locator('[data-suggestion-pencil="0:0"]');
    await expect(pencil).toHaveAttribute('aria-label', /save/i);
    await pencil.click();

    const field = page.locator('[data-suggestion-field="0:0"]');
    await expect(field).toHaveAttribute('data-suggestion-accepted', '1');
    await expect(field).toHaveValue(edited);
    await expect(field).toBeFocused();
    await expect(page.locator('[data-suggestion-pencil="0:0"]')).toHaveAttribute('data-suggestion-dirty', '0');
    await expect(page.locator('[data-suggestion="0:1"]')).toHaveAttribute('data-suggestion-accepted', '0');
    await expect(page.locator('[data-suggestion-row="0:0"]')).toHaveAttribute('data-suggestion-unsaved', '0');
  });

  test('saving twice is the same as saving once', async ({ page }) => {
    const edited = await strand(page);
    // Two presses inside one task, so the second lands before any re-render.
    await page.locator('[data-suggestion-pencil="0:0"]').evaluate((el) => { el.click(); el.click(); });
    await expect(page.locator('[data-suggestion-field="0:0"]')).toHaveValue(edited);
    await expect(page.locator('[data-suggestion-accepted="1"]')).toHaveCount(1);
    await expect(page.locator('[data-suggestion-field="0:0"]')).toHaveAttribute('data-suggestion-accepted', '1');
  });

  test('an amber revert beside it discards the unsaved words and puts the suggestion back', async ({ page }) => {
    await strand(page);
    const revert = page.locator('[data-suggestion-revert="0:0"]');
    await expect(revert).toBeVisible();
    await expect(revert).toHaveAttribute('aria-label', /discard/i);
    await expect(revert).toHaveClass(/is-unsaved/);
    const [r, , b] = (await revert.evaluate((el) => window.getComputedStyle(el).color)).match(/\d+/g).map(Number);
    expect(r, 'the stranded revert is not amber').toBeGreaterThan(b + 60);

    // Keyboard reachable: it takes focus and Enter presses it.
    await revert.focus();
    await expect(revert).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-suggestion="0:0"]')).toHaveText(FLOOR);
    await expect(page.locator('[data-suggestion-row="0:0"]')).toHaveAttribute('data-suggestion-unsaved', '0');
    await expect(page.locator('[data-suggestion="0:0"]')).toHaveAttribute('data-suggestion-accepted', '0');
    await expect(page.locator('[data-suggestion-tick="0:0"]')).toBeVisible();
    // The pick it lost stays where it went.
    await expect(page.locator('[data-suggestion-field="0:1"]')).toHaveAttribute('data-suggestion-accepted', '1');
  });

  test('discarding twice is the same as discarding once', async ({ page }) => {
    await strand(page);
    await page.locator('[data-suggestion-revert="0:0"]').evaluate((el) => { el.click(); el.click(); });
    await expect(page.locator('[data-suggestion="0:0"]')).toHaveText(FLOOR);
    await expect(page.locator('[data-suggestion-row="0:0"]')).toHaveAttribute('data-suggestion-unsaved', '0');
    await expect(page.locator('[data-suggestion-accepted="1"]')).toHaveCount(1);
    await expect(page.locator('[data-suggestion-field="0:1"]')).toHaveAttribute('data-suggestion-accepted', '1');
  });

  test('the own row discards back to what was saved, which is empty', async ({ page }) => {
    await ask(page, ROUND());
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    const own = page.locator('[data-suggestion-own="0:own"]');
    await own.fill('It was in the plan.');
    await page.locator('[data-suggestion="0:0"]').click();
    await page.locator('[data-suggestion-revert="0:own"]').click();
    await expect(own).toHaveValue('');
    await expect(page.locator('[data-suggestion-row="0:own"]')).toHaveAttribute('data-suggestion-unsaved', '0');
    await expect(page.locator('[data-suggestion-field="0:0"]')).toHaveAttribute('data-suggestion-accepted', '1');
  });

  test('own words typed and not saved show the same way when a suggestion is picked', async ({ page }) => {
    await ask(page, ROUND());
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    const own = page.locator('[data-suggestion-own="0:own"]');
    await own.fill('It was in the plan.');

    await page.locator('[data-suggestion="0:0"]').click();
    const row = page.locator('[data-suggestion-row="0:own"]');
    await expect(row).toHaveAttribute('data-suggestion-unsaved', '1');
    await expect(own).toHaveValue('It was in the plan.');
    await expect(page.locator('[data-suggestion-pencil="0:own"]')).toHaveAttribute('aria-label', /unsaved/i);
  });
});

/* ── Guided scroll ───────────────────────────────────────────────────────── */

const geometry = (page, qi) => page.evaluate((i) => {
  const body = document.querySelector('.revision-panel-body');
  const q = document.querySelector(`[data-panel-question="${i}"]`);
  const b = body.getBoundingClientRect();
  return {
    offset: q.getBoundingClientRect().top - b.top,
    scrollTop: body.scrollTop,
    max: body.scrollHeight - body.clientHeight,
  };
}, qi);

test.describe('a round opens at its first open question', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('the second round sits top-aligned on its first question, not at the bottom of the list', async ({ page }) => {
    await ask(page, ROUND(70), { later: SECOND });
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await page.locator('[data-suggestion-tick="0:1"]').click();
    await page.locator('[data-suggestion-tick="1:0"]').click();
    // A long answer, so the thread above the next round is tall.
    await page.locator('.revision-input').fill(
      'He ran to the door twice. The first time he came back on his own and the second time ' +
      'he needed a block and a point back to the table. He settled once the timer was on the board. ' +
      'Floor seating helped too, and he asked for the tablet twice during the money program.');
    await page.locator('.revision-send').click();
    await passScrub(page);

    await expect(page.getByText(/right after he reached the door/i)).toBeVisible({ timeout: 20000 });
    await expect.poll(async () => Math.abs((await geometry(page, 0)).offset), { timeout: 5000 }).toBeLessThan(24);
    const g = await geometry(page, 0);
    expect(g.max, 'the panel must overflow for this to mean anything').toBeGreaterThan(40);
    expect(g.scrollTop, 'the round opened at the bottom of the list').toBeLessThan(g.max - 20);
  });

  /* His ruling on call 2, 3 Oct 2026: the ?aid=1 preview starts with nothing
     picked too, and "make sure it scrolls to top of that round in panel". The
     questions here name no box on the form, so the aid rows are drawn in the
     panel rather than on the page. */
  test('under ?aid=1 the second round also sits top-aligned on its first question', async ({ page }) => {
    const unplaced = {
      ...SECOND,
      questions: SECOND.questions.map((q, i) => ({ ...q, field: 'fNowhere' + i })),
    };
    await ask(page, ROUND(70), { later: unplaced, aid: true });
    await expect(page.locator('[data-question-inline="fAntecedent"]')).toBeVisible({ timeout: 20000 });
    // Round 1 sits on the page; a long typed answer ends it from the panel.
    if (!(await page.locator('.revision-input').isVisible())) await page.locator('.revision-fab').click();
    await page.locator('.revision-input').fill(
      'He ran to the door twice. The first time he came back on his own and the second time ' +
      'he needed a block and a point back to the table. He settled once the timer was on the board. ' +
      'Floor seating helped too, and he asked for the tablet twice during the money program.');
    await page.locator('.revision-send').click();
    await passScrub(page);

    await expect(page.locator('.revision-panel').getByText(/right after he reached the door/i)).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-panel-question="0"] [data-disposition="0:0"]')).toBeVisible();
    await expect.poll(async () => Math.abs((await geometry(page, 0)).offset), { timeout: 5000 }).toBeLessThan(24);
    const g = await geometry(page, 0);
    expect(g.max, 'the panel must overflow for this to mean anything').toBeGreaterThan(40);
    expect(g.scrollTop, 'the round opened at the bottom of the list').toBeLessThan(g.max - 20);
  });

  test('reopening the panel lands on the first question still open', async ({ page }) => {
    await ask(page, ROUND(70), { later: SECOND });
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await page.locator('[data-suggestion-tick="0:1"]').click();
    await page.locator('[data-suggestion-tick="1:0"]').click();
    await page.locator('.revision-input').fill('He ran to the door twice and came back on his own the first time.');
    await page.locator('.revision-send').click();
    await passScrub(page);
    await expect(page.getByText(/right after he reached the door/i)).toBeVisible({ timeout: 20000 });

    await page.locator('[data-suggestion-tick="0:0"]').click();
    await page.locator('.revision-panel-close').click();
    await page.locator('.revision-fab').click();
    await expect(page.locator('[data-panel-question="1"]')).toHaveAttribute('data-question-open', '1');
    await expect(page.locator('[data-panel-question="0"]')).toHaveAttribute('data-question-open', '0');
    await expect.poll(async () => Math.abs((await geometry(page, 1)).offset), { timeout: 5000 }).toBeLessThan(24);
  });

  test('reduced motion scrolls instantly, and full motion scrolls smoothly', async ({ page }) => {
    await page.addInitScript(() => {
      window.__scrolls = [];
      const orig = Element.prototype.scrollTo;
      Element.prototype.scrollTo = function (arg) {
        if (this.classList && this.classList.contains('revision-panel-body') && arg && typeof arg === 'object') {
          window.__scrolls.push(arg.behavior);
        }
        return orig.apply(this, arguments);
      };
    });
    await ask(page, ROUND(70));
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await expect.poll(() => page.evaluate(() => window.__scrolls.length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__scrolls)).not.toContain('smooth');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => { window.__scrolls = []; });
    await page.locator('.revision-panel-close').click();
    await page.locator('.revision-fab').click();
    await expect.poll(() => page.evaluate(() => window.__scrolls)).toContain('smooth');
  });
});

/* ── Tracked, not reported ───────────────────────────────────────────────
   His words, 3 Oct 2026: "I do want some reporting on BT note tool use so that
   I can guide their performance. Can't do that blind. It is a little oos for
   now, but let's track accepted-as-is". Counts only, never text. */

const COUNT_KEYS = ['accepted_as_is', 'edited', 'not_refined', 'own_words', 'round'];

const triageAnswerEvents = (page) => page.evaluate(() =>
  JSON.parse(localStorage.getItem('noaba.audit.buffer.v1') || '[]').filter((e) => e.type === 'triage_answers'));

test.describe('how each question was answered is tracked as counts', () => {
  test('one event per Send, carrying the four counts and the round and nothing else', async ({ page }) => {
    await ask(page, ROUND(70), { later: SECOND });
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });

    // Round 1: one suggestion as offered, one in their own words.
    await page.locator('[data-suggestion-tick="0:1"]').click();
    const own = page.locator('[data-suggestion-own="1:own"]');
    await own.fill('He walked back to the table on his own the second time.');
    await own.press('Enter');
    // Typed, so the Send asks again rather than drafting from the picks.
    await page.locator('.revision-input').fill('He settled once the timer was up.');
    await page.locator('.revision-send').click();
    await passScrub(page);
    await expect(page.getByText(/right after he reached the door/i)).toBeVisible({ timeout: 20000 });

    // Round 2: one reworded, two left alone.
    await page.locator('[data-suggestion="0:0"]').click();
    await page.keyboard.type(' Twice.');
    await page.keyboard.press('Enter');
    await page.locator('.revision-send').click();
    await passScrub(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    // What the worker would store from exactly what the browser buffered. The
    // buffer also carries the tool slug every event carries; the store does not.
    const events = await triageAnswerEvents(page);
    const stored = events.map((e) => sanitizeAuditEvent(e));
    expect(stored.map((e) => e.data)).toEqual([
      { accepted_as_is: 1, edited: 0, own_words: 1, not_refined: 0, round: 1 },
      { accepted_as_is: 0, edited: 1, own_words: 0, not_refined: 2, round: 2 },
    ]);
    for (const e of stored) {
      expect(e.tool).toBe('bt');
      expect(Object.keys(e.data).sort()).toEqual(COUNT_KEYS);
      for (const v of Object.values(e.data)) expect(Number.isInteger(v)).toBe(true);
    }
    for (const e of events) {
      expect(Object.keys(e.data).filter((k) => k !== 'tool').sort()).toEqual(COUNT_KEYS);
    }
    const all = JSON.stringify(events);
    expect(all).not.toContain('Twice');
    expect(all).not.toContain('walked back');
  });

  test('the worker stores the event and keeps it to its integer keys', () => {
    expect(AUDIT_TYPES.has('triage_answers')).toBe(true);
    const kept = sanitizeAuditEvent({
      type: 'triage_answers', tool: 'bt', ts: 1,
      data: {
        accepted_as_is: 2, edited: 1.4, own_words: 0, not_refined: 3, round: 1,
        // The shapes a leak would take, including a slug the general rule admits.
        answer: 'jacob_eloped', note: 'Jacob eloped twice.', nested: { a: 'Jacob' }, edited_text: 'Jacob',
      },
    });
    expect(kept.data).toEqual({ accepted_as_is: 2, edited: 1, own_words: 0, not_refined: 3, round: 1 });
    expect(JSON.stringify(kept)).not.toMatch(/jacob/i);
  });
});
