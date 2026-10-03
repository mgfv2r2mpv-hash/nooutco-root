import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* ONE SEND. His words, 2026-09-28:
 *
 *   "'Use these and generate' button is redundant with the send paper airplane.
 *   Just have the send one be the one that times out for a minute if the note
 *   had revisions and no round of feedback has been provided yet. They cannot
 *   send until the timer is done, or if they type at least 25 characters in the
 *   large bottom text field next to the submit and microphone buttons. Move
 *   microphone to be left of that text field, leave send on the right, text
 *   field in the middle."
 *
 * "Revisions" are the candidate answers NoMe puts under its gap questions: the
 * rows the aid flag labels "Added to the note by NoMe". "A round of feedback" is
 * the technician's reply to that round, which is a Send. Once one Send has gone
 * in a note's rounds, feedback has been provided, so later rounds on that note
 * do not lock (approved 2026-10-02, pinned below).
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

const REVISIONS = {
  sufficient: false, readiness: 70,
  questions: [
    { field: 'fAntecedent', question: 'You wrote that you moved to the floor. Was that in the plan?',
      suggestions: ['Moving to the floor settled him faster than the break did.', 'The first-then board worked better once we were down there.'] },
    { field: 'fBehavior', question: 'How did the two elopements end?',
      suggestions: ['Both ended with a block and a redirect to the table.'] },
  ],
};

/* RECORDED FROM THE OLD BUTTON, not written by hand. On origin/dev at 1d98cf98,
   the same two questions, row 0:1 picked and the own-words row of question 1
   filled, "Use these and generate" put exactly this block at the end of the one
   user message of the note request, on chromium and on webkit alike. */
const OLD_BUTTON_BLOCK =
  '\n\nTHE TECHNICIAN ADDED, ANSWERING FOLLOW-UP QUESTIONS (treat as part of the notes above):\n' +
  'The first-then board worked better once we were down there.\n' +
  'He walked back to the table on his own the second time.';
const OLD_BUTTON_KEYS = ['maxTokens', 'messages', 'model', 'output_config', 'system_suffix', 'tool'];

/* A recogniser that exists and hears nothing, so the microphone is drawn. */
const INSTALL_FAKE = () => {
  function FakeRecognition() {
    this.continuous = false; this.interimResults = false; this.processLocally = false; this.lang = '';
    this.start = function () {};
    this.stop = function () { if (this.onend) this.onend(); };
    this.abort = function () {};
  }
  Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
};

/* `later` answers the triage calls that carry an earlier round's answers
   (ALREADY ANSWERED). Left out, those come back sufficient and the note drafts,
   as they always have here. `aid` opens the floor plan (?aid=1), the only mode
   that draws an answer field under each question on the page. */
async function ask(page, triage, { clock = true, later = null, aid = false } = {}) {
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
  await page.addInitScript(INSTALL_FAKE);
  if (clock) await page.clock.install();
  const url = aid ? '/notes/bt/?aid=1' : '/notes/bt/';
  await page.goto(url);
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto(url);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, needed full physical most of it');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board, also moved to the floor and he settled');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await generate(page);
  await expect(page.locator('.revision-panel')).toBeVisible({ timeout: 20000 });
  return seen;
}

/* After the first Generate on a page load the button reads Regenerate
   (tests/regenerate.spec.js), so a second press names it that way. */
async function generate(page, name = 'Generate Note') {
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

test.describe('one Send ends the round', () => {
  test('the old button is gone', async ({ page }) => {
    await ask(page, REVISIONS);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.revision-skip')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Use these and generate|Nothing to add|Generate without adding answers/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Send$/ })).toHaveCount(1);
  });

  test('Send carries the pick and the own words, byte for byte what the old button sent', async ({ page }) => {
    const seen = await ask(page, REVISIONS);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });

    await page.locator('[data-suggestion-tick="0:1"]').click();
    const own = page.locator('[data-suggestion-own="1:own"]');
    await own.fill('He walked back to the table on his own the second time.');
    await own.press('Enter');

    await page.clock.runFor(61_000);
    const send = page.locator('.revision-send');
    await expect(send).toBeEnabled();
    await send.click();
    await passScrub(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    expect(seen.notes).toHaveLength(1);
    const b = seen.notes[0];
    expect(Object.keys(b).sort()).toEqual(OLD_BUTTON_KEYS);
    expect(b.messages).toHaveLength(1);
    const content = String(b.messages[0].content);
    const at = content.indexOf('\n\nTHE TECHNICIAN ADDED');
    expect(at, 'the answers block is missing').toBeGreaterThan(0);
    expect(content.slice(at)).toBe(OLD_BUTTON_BLOCK);
    // Drafted straight from the picks, as the old button did: no second round.
    expect(seen.triage.filter((t) => /ALREADY ANSWERED/.test(t))).toHaveLength(0);
  });
});

test.describe('Send waits a minute on revisions nobody has answered', () => {
  test('locked for 60 seconds, counting down beside the button, then open', async ({ page }) => {
    await ask(page, REVISIONS);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    const send = page.locator('.revision-send');
    const lock = page.locator('[data-send-lock]');

    await expect(send).toBeDisabled();
    await expect(lock).toBeVisible();
    await expect(lock).toHaveText(/\b(60|59|58)s\b/, { timeout: 2000 });
    // The disabled button leaves the tab order, so the field carries the note.
    await expect(page.locator('.revision-input')).toHaveAttribute('aria-describedby', 'revision-send-lock');

    await page.clock.runFor(30_000);
    await expect(send).toBeDisabled();
    await expect(lock).toHaveText(/\b(30|29|28)s\b/, { timeout: 2000 });

    await page.clock.runFor(25_000);
    await expect(send).toBeDisabled();

    await page.clock.runFor(6_000);
    await expect(send).toBeEnabled();
    await expect(lock).toHaveCount(0);
    await expect(page.locator('.revision-input')).not.toHaveAttribute('aria-describedby', 'revision-send-lock');
  });

  test('typing short of 25 characters does not restart the count', async ({ page }) => {
    await ask(page, REVISIONS);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    const send = page.locator('.revision-send');
    const lock = page.locator('[data-send-lock]');

    await page.clock.runFor(30_000);
    // Every keystroke re-renders the engine; the count must not start over.
    await page.locator('.revision-input').pressSequentially('Twice.');
    await expect(lock).toHaveText(/\b(30|29|28)s\b/, { timeout: 2000 });
    await expect(send).toBeDisabled();

    await page.clock.runFor(31_000);
    await expect(lock).toHaveCount(0);
    await expect(send).toBeEnabled();
  });

  /* The 2026-08-06 floor, kept by the build agent's own reading: his
     2026-09-28 words do not mention readiness. Pinned here so that flipping it
     is a visible change to this spec, not a quiet one. */
  test('a note reading 85 or more is not locked', async ({ page }) => {
    await ask(page, { ...REVISIONS, readiness: 85 });
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.revision-send')).toBeEnabled();
    await expect(page.locator('[data-send-lock]')).toHaveCount(0);
  });

  test('24 characters leave it locked and 25 open it', async ({ page }) => {
    const seen = await ask(page, REVISIONS);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    const send = page.locator('.revision-send');
    const box = page.locator('.revision-input');

    const twentyFour = 'x'.repeat(24);
    expect(twentyFour.length).toBe(24);
    // Padding does not count: the rule is on what was written.
    await box.fill('   ' + twentyFour + '   ');
    await expect(send).toBeDisabled();
    // Enter is the other way to send, and it is locked too.
    await box.press('Enter');
    await expect(box).toHaveValue('   ' + twentyFour + '   ');
    expect(seen.notes).toHaveLength(0);

    const twentyFive = 'He ran to the door twice.';
    expect(twentyFive.length).toBe(25);
    await box.fill(twentyFive);
    await expect(send).toBeEnabled();
    await send.click();
    await passScrub(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
    expect(String(seen.notes[0].messages[0].content)).toContain(twentyFive);
  });

  /* Read below 85 on purpose. At 90 the readiness floor alone opens Send, so
     this test passed whether or not the candidates check worked at all. Below
     the bar the gate wants one answer first, so a short one is typed: short
     enough that only the missing candidates can explain an open Send. */
  test('a round with no revisions in it is not locked', async ({ page }) => {
    await ask(page, {
      sufficient: false, readiness: 70,
      questions: [{ field: 'fBehavior', question: 'How many times?', suggestions: [] }],
    });
    await expect(page.getByText(/How many times/i)).toBeVisible({ timeout: 20000 });
    await page.locator('.revision-input').fill('Twice.');
    await expect(page.locator('.revision-send')).toBeEnabled();
    await expect(page.locator('[data-send-lock]')).toHaveCount(0);
  });
});

/* ── Two readings of the same ruling, approved 2 Oct 2026 ──────────────────
   #218 shipped "no round of feedback has been provided yet" as a lock on every
   round that carries revisions, counting only the bottom field. Kaleb approved
   two readings after it shipped:

   1. The lock holds only until the first feedback. Once the technician has
      sent once in a note's rounds, later rounds on that note are open. A new
      draft starts a new note and locks again.
   2. Answers typed in place count. The answer fields under the questions on
      the page count toward the 25 characters, together with the bottom field. */
const SECOND_ROUND = {
  sufficient: false, readiness: 70,
  questions: [
    { field: 'fBehavior', question: 'What did you do right after he reached the door?',
      suggestions: ['Blocked the door and pointed back to the table.'] },
  ],
};

test.describe('the lock holds only until the first feedback', () => {
  test('a second round after one Send on the same note is not locked', async ({ page }) => {
    const seen = await ask(page, REVISIONS, { later: SECOND_ROUND });
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    const send = page.locator('.revision-send');
    const lock = page.locator('[data-send-lock]');
    await expect(send).toBeDisabled();

    await page.locator('.revision-input').fill('He ran to the door twice.');
    await send.click();
    await passScrub(page);

    // The second round carries revisions of its own and well under a minute
    // has passed, so only the earlier Send can explain an open button.
    await expect(page.getByText(/right after he reached the door/i)).toBeVisible({ timeout: 20000 });
    await expect(send).toBeEnabled();
    await expect(lock).toHaveCount(0);
    await expect(page.locator('.revision-input')).not.toHaveAttribute('aria-describedby', 'revision-send-lock');
    expect(seen.notes).toHaveLength(0);
  });

  test('a new draft locks again', async ({ page }) => {
    const seen = await ask(page, REVISIONS, { later: SECOND_ROUND });
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    const send = page.locator('.revision-send');
    const lock = page.locator('[data-send-lock]');

    await page.locator('.revision-input').fill('He ran to the door twice.');
    await send.click();
    await passScrub(page);
    await expect(page.getByText(/right after he reached the door/i)).toBeVisible({ timeout: 20000 });

    // An empty Send on the open second round finishes it and drafts the note.
    await expect(send).toBeEnabled();
    await send.click();
    await passScrub(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
    expect(seen.notes).toHaveLength(1);

    // Generating again is a new note, and its first round is locked again.
    await generate(page, 'Regenerate');
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await expect(send).toBeDisabled();
    await expect(lock).toBeVisible();
    await expect(page.locator('.revision-input')).toHaveAttribute('aria-describedby', 'revision-send-lock');
  });
});

test.describe('answers typed in place count toward the 25 characters', () => {
  test('25 characters in the answer fields on the page open Send with the bottom field empty', async ({ page }) => {
    await ask(page, REVISIONS, { aid: true });
    const first = page.locator('[data-question-answer="0"]');
    const second = page.locator('[data-question-answer="1"]');
    await expect(first).toBeVisible({ timeout: 20000 });
    await expect(second).toBeVisible();
    const send = page.locator('.revision-send');
    const lock = page.locator('[data-send-lock]');
    await expect(send).toBeDisabled();
    await expect(page.locator('.revision-input')).toHaveValue('');

    const a = 'It was in the plan.';
    expect(a.length).toBe(19);
    await first.fill(a);
    // Padding does not count here either: 19 + 5 written is 24.
    await second.fill('  Block  ');
    await expect(send).toBeDisabled();
    await expect(lock).toBeVisible();

    await second.fill('Block.');
    await expect(send).toBeEnabled();
    await expect(lock).toHaveCount(0);
    await expect(send).not.toHaveAttribute('aria-describedby', 'revision-send-lock');
  });

  /* His ruling, 2026-10-03: the panel's own-words row counts too, so the lock
     works the same with and without ?aid=1. Without the floor plan, the
     own-words row under each question is where a technician answers in place. */
  test('the own-words row counts on the page without ?aid=1, and short of 25 stays locked', async ({ page }) => {
    await ask(page, REVISIONS);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    const send = page.locator('.revision-send');
    const lock = page.locator('[data-send-lock]');
    const own = page.locator('[data-suggestion-own="1:own"]');
    await expect(send).toBeDisabled();
    await expect(page.locator('.revision-input')).toHaveValue('');

    const short = 'Back on his own.';
    const enough = 'He walked back on his own.';
    expect([short.length, enough.length]).toEqual([16, 26]);

    await own.fill(short);
    await own.press('Enter');
    await expect(send).toBeDisabled();
    await expect(lock).toBeVisible();

    await own.fill(enough);
    await own.press('Enter');
    await expect(send).toBeEnabled();
    await expect(lock).toHaveCount(0);
  });

  test('the answers in place and the bottom field add up, and short of 25 together stays locked', async ({ page }) => {
    await ask(page, REVISIONS, { aid: true });
    const inPlace = page.locator('[data-question-answer="0"]');
    await expect(inPlace).toBeVisible({ timeout: 20000 });
    const send = page.locator('.revision-send');
    const box = page.locator('.revision-input');

    const ten = 'Twice now.';
    const fourteen = 'Blocked twice.';
    const fifteen = 'Blocked, twice.';
    expect([ten.length, fourteen.length, fifteen.length]).toEqual([10, 14, 15]);

    await inPlace.fill(ten);
    await expect(send).toBeDisabled();
    await box.fill(fourteen);
    await expect(send).toBeDisabled();
    await expect(page.locator('[data-send-lock]')).toBeVisible();

    await box.fill(fifteen);
    await expect(send).toBeEnabled();
    await expect(page.locator('[data-send-lock]')).toHaveCount(0);
  });
});

/* ── The row: microphone, field, Send ──────────────────────────────────────
   Measured by bounding boxes, never by a screenshot: a headless page at 400px
   crops instead of reflowing. */
const row = (page) => page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width };
  };
  const compose = document.querySelector('.revision-compose');
  const tabbable = [...compose.querySelectorAll('button, textarea, input')].map((el) =>
    el.matches('[data-speak]') ? 'mic' : el.matches('.revision-input') ? 'field' : el.matches('.revision-send') ? 'send' : 'other');
  return {
    mic: r('[data-speak]'), field: r('.revision-input'), send: r('.revision-send'), compose: r('.revision-compose'),
    order: tabbable,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    viewport: window.innerWidth,
  };
});

for (const width of [1280, 400]) {
  test(`mic left, field in the middle, Send right, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await ask(page, REVISIONS);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-speak]')).toBeVisible();

    const g = await row(page);
    expect(g.mic.right, 'the mic ends before the field starts').toBeLessThanOrEqual(g.field.left + 1);
    expect(g.field.right, 'the field ends before Send starts').toBeLessThanOrEqual(g.send.left + 1);
    // The field takes the free width: wider than both squares together.
    expect(g.field.w).toBeGreaterThan(g.mic.w + g.send.w);
    // Everything on screen, and nothing pushes the page sideways.
    expect(g.send.right).toBeLessThanOrEqual(g.viewport);
    expect(g.mic.left).toBeGreaterThanOrEqual(0);
    // DOM order is focus order, and it follows what is drawn.
    expect(g.order).toEqual(['mic', 'field', 'send']);
    await expect.poll(async () => (await row(page)).overflow, { timeout: 5000, intervals: [100, 200, 400, 1000] }).toBe(false);

    // And the keyboard walks it the same way: Tab from the mic reaches the field, then Send.
    await page.clock.runFor(61_000);
    await page.locator('[data-speak]').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('.revision-input')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('.revision-send')).toBeFocused();
  });
}
