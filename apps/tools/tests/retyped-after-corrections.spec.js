import { test, expect } from '@playwright/test';
import { captureClipboard } from './helpers/clipboard.js';
import { isTriageCall } from './helpers/llm-call.js';

/* RETYPED MEANS THE CLINICIAN'S OWN HAND, AND NOTHING NOME'S. Fixed 2026-10-03,
   on his go.

   note_copied's `edited` and the per-section note_retyped are the usage
   numbers he reads to see where a technician is spending effort on the
   model's prose. Both were measured against the last thing the model returned
   in the conversation, and the corrections pass runs AFTER that: it rewrites
   the draft before the technician ever sees it. So a correction left standing,
   which is NoMe's work accepted by doing nothing, was counted as characters
   the technician typed. A note copied without a single keystroke reported the
   length of every correction as retyped.

   THE BASELINE NOW is the note as NoMe last left it, with the corrections the
   technician kept and without the ones they undid. An undo is a click that
   puts NoMe's own draft back, so it is not typing either. A rewording of a
   correction is typed, so it still counts, and so does typing over a section
   by hand.

   The same mistake had two siblings, and both are pinned here: a revision the
   technician discarded still sat last in the conversation and became the
   baseline, and a queued ask sent to NoMe rewrote sections with nothing to
   say the new words were NoMe's.

   Every LLM call is intercepted. Nothing here reaches Anthropic. */

const BT_PAGE = '/notes/bt/';

function tokenFor(role = 'user', tools = ['bt']) {
  const payload = { role, kid: 'retyped-after-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
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

const PLAN = 'Elopement occurred on two occasions and the technician blocked the door.';
const ADDED = ' The client returned to the table after each block and resumed the task.';
const PLAIN = ' He came back both times.';
const ANTE = 'Choices were offered before each demand.';
const ANTE_ADDED = ' A visual timer was set before each transition.';
const LESSON = 'The behavior technician utilized a three-item array.';
const LESSON_REVISED = 'The technician ran a three-item array with a gestural prompt on every trial.';
// What the clinician types, so the count can be checked to the character.
const TYPED = ' He sat back down on his own the second time.';

function note(overrides = {}) {
  return {
    individualsPresent: ['Client'],
    clinicalStatus: ['Presented Tired'],
    clinicalStatusNarrative: 'The client presented as tired on arrival.',
    purpose: ['Worked on goals as stated in the treatment plan'],
    servicePaused: 'No',
    abaTechniques: ['Discrete Trial Training'],
    lessonProgressNarrative: LESSON,
    antecedentStrategies: ['Offered choices'],
    antecedentNarrative: ANTE,
    consequenceStrategies: ['Redirection'],
    consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
    behaviorPlanNarrative: PLAN,
    clientProgress: 'Steady progress towards goals and behaviors',
    actionItems: ['None'],
    followUpNarrative: 'Direct staff do not report new questions or concerns for the BCBA.',
    hints: [],
    ...overrides,
  };
}

const ONE_CORRECTION = [{ section: 'behaviorPlanNarrative', text: PLAN + ADDED, why: 'test' }];
const TWO_CORRECTIONS = [
  { section: 'behaviorPlanNarrative', text: PLAN + ADDED, why: 'test' },
  { section: 'antecedentNarrative', text: ANTE + ANTE_ADDED, why: 'test' },
];

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

/* Draft one note with the corrections pass answering `passes` in turn, the last
   one repeating, and the model answering `revision` to any turn after the
   draft. Collects every usage event and style correction the page posts. */
async function draft(page, { passes = [ONE_CORRECTION], revision = null } = {}) {
  const wire = { events: [], corrections: [] };
  let drafted = false;
  let passCalls = 0;
  await captureClipboard(page);
  await page.route('**/api/audit**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    (body.events || []).forEach((e) => wire.events.push(e));
    (body.corrections || []).forEach((c) => wire.corrections.push(c));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"stored":1,"profile":"ok"}' });
  });
  await page.route('**/api/llm-call**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(body)) return route.fulfill(reply({ sufficient: true, questions: [], readiness: 90 }));
    if (drafted && revision) return route.fulfill(reply(revision));
    drafted = true;
    return route.fulfill(reply(note()));
  });
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
  await page.route('**/api/corrections-pass**', (route) => {
    const corrections = passes[Math.min(passCalls, passes.length - 1)];
    passCalls++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ corrections, dropped: 0, usage: { input_tokens: 10, output_tokens: 5 }, model: 'test' }),
    });
  });

  await page.goto(BT_PAGE);
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto(BT_PAGE);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT 3-item array, gestural prompts');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('choices before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2, blocked the door');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await acceptScrubGate(page);
  await expect(page.locator('[data-corrections-section="behaviorPlanNarrative"]')).toBeVisible({ timeout: 20000 });
  return wire;
}

const insertKey = (page, section) =>
  page.locator(`[data-corrections-section="${section}"] [data-correction-type="ins"]`).first().getAttribute('data-correction');

async function undo(page, key) {
  await page.locator(`[data-correction="${key}"]`).click();
  await page.locator(`[data-correction-undo="${key}"]`).click();
  await expect(page.locator(`[data-correction-mark="${key}"]`)).toBeVisible();
}

async function reword(page, key, text) {
  await page.locator(`[data-correction="${key}"]`).click();
  await page.locator(`[data-correction-pencil="${key}"]`).click();
  await page.locator(`[data-correction-edit="${key}"]`).fill(text);
  await page.locator(`[data-correction-save="${key}"]`).click();
  await expect(page.locator(`[data-correction="${key}"]`)).toContainText(text.trim());
}

// "Edit by hand": the section's marks go away and it becomes a textarea.
async function editByHand(page, section) {
  await page.locator(`[data-corrections-done="${section}"]`).click();
  const box = page.locator(`textarea[data-section-id="${section}"]`);
  await expect(box).toBeVisible();
  return box;
}

const collapsePanel = async (page) => {
  const close = page.locator('.revision-panel-close');
  if (await close.isVisible({ timeout: 2000 }).catch(() => false)) await close.click();
};

async function copyAndSettle(page, wire) {
  await collapsePanel(page);
  await page.getByRole('button', { name: /^Copy$/ }).first().click();
  await expect
    .poll(() => wire.events.filter((e) => e.type === 'note_copied').length, { timeout: 10000, message: 'the copy never reached the audit route' })
    .toBe(1);
  await page.waitForTimeout(1200);
}

const one = (wire, type) => wire.events.filter((e) => e.type === type);
const edited = (wire) => one(wire, 'note_copied')[0].data.edited;
const retyped = (wire) => {
  const [r] = one(wire, 'note_retyped');
  if (!r) return {};
  const out = { ...r.data };
  delete out.tool;
  return out;
};

test.describe('a correction NoMe made is not the clinician\'s typing', () => {
  test('an untouched note after NoMe\'s corrections reports 0 characters retyped', async ({ page }) => {
    const wire = await draft(page);
    await copyAndSettle(page, wire);

    expect(edited(wire), 'a correction left standing was counted as hand typing').toBe(0);
    expect(one(wire, 'note_retyped'), 'a split was sent for a note nobody typed in').toEqual([]);
  });

  test('typing N characters into a corrected section reports N, not N plus the correction', async ({ page }) => {
    const wire = await draft(page);
    const box = await editByHand(page, 'behaviorPlanNarrative');
    await expect(box, 'the correction should still be standing when the marks go away').toHaveValue(PLAN + ADDED);
    await box.fill(PLAN + ADDED + TYPED);
    await copyAndSettle(page, wire);

    expect(edited(wire)).toBe(TYPED.length);
    expect(retyped(wire)).toEqual({ behaviorPlanNarrative: TYPED.length });
  });

  test('typing N characters into a section NoMe never corrected reports N for that section alone', async ({ page }) => {
    const wire = await draft(page);
    const box = page.locator('textarea[data-section-id="lessonProgressNarrative"]');
    await expect(box).toHaveValue(LESSON);
    await box.fill(LESSON + TYPED);
    await copyAndSettle(page, wire);

    expect(edited(wire)).toBe(TYPED.length);
    expect(retyped(wire)).toEqual({ lessonProgressNarrative: TYPED.length });
  });

  test('undoing a correction is a click, not typing, and reports 0', async ({ page }) => {
    const wire = await draft(page);
    await undo(page, await insertKey(page, 'behaviorPlanNarrative'));
    // Finished by hand without a keystroke, so the undo has to survive the marks going away.
    await expect(await editByHand(page, 'behaviorPlanNarrative')).toHaveValue(PLAN);
    await copyAndSettle(page, wire);

    expect(edited(wire)).toBe(0);
    expect(one(wire, 'note_retyped')).toEqual([]);
  });

  test('rewording a correction is typed, and counts against the correction it replaced', async ({ page }) => {
    const wire = await draft(page);
    await reword(page, await insertKey(page, 'behaviorPlanNarrative'), PLAIN);
    const kept = await (await editByHand(page, 'behaviorPlanNarrative')).inputValue();
    await copyAndSettle(page, wire);

    // The same arithmetic manualEditBySection uses, against the offered text.
    const expected = Math.abs(kept.length - (PLAN + ADDED).length) || kept.length;
    expect(expected, 'the rewording changed nothing, so this test checks nothing').toBeGreaterThan(0);
    expect(edited(wire)).toBe(expected);
    expect(retyped(wire)).toEqual({ behaviorPlanNarrative: expected });
  });
});

/* Ask NoMe to revise the lesson narrative, then press `button` (.diff-accept or
   .diff-discard) on the proposal. The reply echoes the corrected behaviour
   section as it stands, so the lesson is the only change it proposes. */
async function reviseLesson(page, button) {
  await page.getByText('Narrative of Lesson Progress', { exact: true }).click();
  await expect(page.locator('.revision-panel')).toBeVisible();
  await page.locator('.revision-input').fill('say which prompt was used');
  await page.locator('.revision-send').click();
  await expect(page.locator(button).first()).toBeVisible({ timeout: 20000 });
  await page.locator(button).first().click();
}

const revisedTo = (lesson) => note({ lessonProgressNarrative: lesson, behaviorPlanNarrative: PLAN + ADDED, crossSection: [] });

test.describe('the same baseline mistake, in the two other places NoMe writes the note', () => {
  test('a revision the clinician discarded is not the baseline, so an untouched note still reports 0', async ({ page }) => {
    const wire = await draft(page, { revision: revisedTo(LESSON_REVISED) });
    await reviseLesson(page, '.diff-discard');
    await expect(page.locator('textarea[data-section-id="lessonProgressNarrative"]')).toHaveValue(LESSON);
    await copyAndSettle(page, wire);

    expect(edited(wire), 'the discarded proposal was measured as the draft').toBe(0);
    expect(one(wire, 'note_retyped')).toEqual([]);
  });

  test('and a discarded revision teaches the style store nothing, since nobody typed', async ({ page }) => {
    // Six hedges in one sentence (style-specimens.spec.js), so a pair with it
    // on one side moves `hedging` well past the noise floor.
    const HEDGED = LESSON + ' The client appeared to perhaps feel somewhat unsettled and possibly may have tended to leave the table.';
    const wire = await draft(page, { revision: revisedTo(HEDGED) });

    // Not vacuous: the old draft side, the discarded proposal against the note
    // as copied, finds a hedging change over the passage the copy measures.
    const n = note();
    const passage = (lesson) => [n.clinicalStatusNarrative, lesson, n.antecedentNarrative, PLAN + ADDED, n.followUpNarrative].join('\n\n');
    const moved = await page.evaluate(
      ([drafted, kept]) => window.NoteStyleFeatures.compare(drafted, kept, 'manual').map((f) => f.feature),
      [passage(HEDGED), passage(LESSON)],
    );
    expect(moved, 'the fixture would not have taught a hedge under the old draft either').toContain('hedging');

    await reviseLesson(page, '.diff-discard');
    await expect(page.locator('textarea[data-section-id="lessonProgressNarrative"]')).toHaveValue(LESSON);
    await copyAndSettle(page, wire);

    expect(wire.corrections, 'the discarded proposal was taught as the technician overtyping it').toEqual([]);
  });

  test('a revision the clinician accepted is NoMe\'s wording, not theirs', async ({ page }) => {
    const wire = await draft(page, { revision: revisedTo(LESSON_REVISED) });
    await reviseLesson(page, '.diff-accept');
    await expect(page.locator('textarea[data-section-id="lessonProgressNarrative"]')).toHaveValue(LESSON_REVISED);
    await copyAndSettle(page, wire);

    expect(edited(wire)).toBe(0);
    expect(one(wire, 'note_retyped')).toEqual([]);
  });

  test('a queued ask NoMe answered is NoMe\'s, and an undo elsewhere is still not typing', async ({ page }) => {
    const ASKED = [{ section: 'behaviorPlanNarrative', text: PLAN + PLAIN, why: 'test' }];
    const wire = await draft(page, { passes: [TWO_CORRECTIONS, ASKED] });
    await expect(page.locator('[data-corrections-section="antecedentNarrative"]')).toBeVisible();
    await undo(page, await insertKey(page, 'antecedentNarrative'));

    const chg = page.locator('[data-corrections-section="behaviorPlanNarrative"] [data-correction-type="ins"]').first();
    await chg.click();
    await page.locator('[data-correction-ask]').first().click();
    await page.locator('[data-correction-ask-input]').first().fill('say it shorter');
    await page.locator('[data-correction-ask-save]').first().click();
    await page.locator('[data-panel-ask-send]').click();
    await expect(page.locator('[data-panel-ask-send]')).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator('[data-corrections-section="behaviorPlanNarrative"]')).toContainText(PLAIN.trim());
    await copyAndSettle(page, wire);

    expect(edited(wire), 'NoMe\'s answer to the ask, or the undo, was counted as typing').toBe(0);
    expect(one(wire, 'note_retyped')).toEqual([]);
  });
});
