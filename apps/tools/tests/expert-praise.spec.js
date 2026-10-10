import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* ISSUE #119. Kaleb, 2026-09-01, from inside the tool: "what is the use in the
 * expert saying 'this is good' to me? It just wastes space."
 *
 * The proposal on record: drop expert findings that only praise, and keep any
 * finding that also asks for something. notes/bcba/expert-praise.js draws that
 * line, and engine.jsx applies it once, where the expert's result arrives, so
 * every reader of S.expert sees the same list. Every model call is stubbed and
 * every word is invented. */

const PAGE = '/notes/bt/';

const praise = (page, fn, arg) => page.evaluate(
  ([src, a]) => (0, eval)(`(${src})`)(window.ExpertPraise, a), [fn.toString(), arg]);

test.describe('what counts as praise only', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await page.waitForFunction(() => !!window.ExpertPraise);
  });

  test('a finding that only approves is praise', async ({ page }) => {
    const said = [
      'This is good.',
      'Well documented.',
      'Good detail on the prompt level.',
      'The section is clear and observable.',
      'No changes needed here.',
      'Fine as written.',
      'Nothing to change.',
    ];
    const read = await praise(page, (P, xs) => xs.map((x) => P.praiseOnly(x)), said);
    expect(read).toEqual(said.map(() => true));
  });

  test('praise with an ask in it is kept, because the ask is the finding', async ({ page }) => {
    const said = [
      'Good detail. How long did each elopement last?',
      'This is good, but add the prompt level.',
      'Well written. Specify the number of trials.',
      'Clear, though the duration is missing.',
      'This is good; it should name who delivered the token.',
    ];
    const read = await praise(page, (P, xs) => xs.map((x) => P.praiseOnly(x)), said);
    expect(read).toEqual(said.map(() => false));
  });

  test('a finding with no praise in it is never dropped', async ({ page }) => {
    const said = ['How long did each elopement last?', 'Duration is what a rate comparison needs.', '', 'Name the prompt.'];
    const read = await praise(page, (P, xs) => xs.map((x) => P.praiseOnly(x)), said);
    expect(read).toEqual([false, false, false, false]);
  });

  test('an ask is judged on its words and its reason together', async ({ page }) => {
    const read = await praise(page, (P) => [
      P.hintIsPraise({ ask: 'This section is good.', why: 'Observable and attributed.' }),
      P.hintIsPraise({ ask: 'This section is good.', why: 'But the prompt level is missing.' }),
    ]);
    expect(read).toEqual([true, false]);
  });

  test('a phrase to reword with a real replacement is a remedy, whatever its reason says', async ({ page }) => {
    const read = await praise(page, (P) => [
      P.registerIsPraise({ quote: 'he did great', action: 'reframe', why: 'Clear and well written.', move: '' }),
      P.registerIsPraise({ quote: 'he did great', action: 'reframe', why: 'Clear and well written.', move: 'Keep as is.' }),
      P.registerIsPraise({ quote: 'he did great', action: 'reframe', why: 'This is good.', move: 'Say what he did.' }),
    ]);
    expect(read).toEqual([true, true, false]);
  });

  test('drop returns a new result with a count, and leaves the one it was given alone', async ({ page }) => {
    const out = await praise(page, (P) => {
      const found = {
        terms: [{ token: 'DTT', reading: 'Discrete Trial Training', status: 'resolved', why: 'Good reading.' }],
        register: [
          { quote: 'he wanted attention', action: 'reframe', why: 'A function claim.', move: 'Say what happened.' },
          { quote: 'he sat nicely', action: 'reframe', why: 'Well written.', move: '' },
        ],
        hints: [
          { section: 'note', rank: 1, kind: 'thin', ask: 'This is good.', why: '' },
          { section: 'note', rank: 2, kind: 'thin', ask: 'Good detail. How long did it last?', why: '' },
        ],
        hintsDropped: 0,
      };
      const kept = P.drop(found);
      return { kept, originalHints: found.hints.length, originalRegister: found.register.length };
    });
    expect(out.kept.hints.map((h) => h.ask)).toEqual(['Good detail. How long did it last?']);
    expect(out.kept.register.map((r) => r.quote)).toEqual(['he wanted attention']);
    expect(out.kept.terms).toHaveLength(1);
    expect(out.kept.praiseDropped).toBe(2);
    expect(out.originalHints).toBe(2);
    expect(out.originalRegister).toBe(2);
  });
});

/* The same line, on the page. A praise-only ask never reaches the NoMe panel,
   and the ask beside it with a compliment in front of it does. */
const NOTE = {
  individualsPresent: ['Client'],
  clinicalStatus: ['Presented Calm'],
  clinicalStatusNarrative: 'The client met the technician at the door and settled quickly.',
  purpose: ['Worked on goals as stated in the treatment plan'],
  servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'Eight of ten trials came back correct with a gestural prompt.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'A two minute warning preceded each transition.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions and the technician blocked the door.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
};

const EXPERT = {
  terms: [],
  register: [],
  hints: [
    { section: 'note', rank: 1, kind: 'thin', ask: 'This is good.', why: 'Observable and attributed.' },
    { section: 'behaviorPlanNarrative', rank: 2, kind: 'thin', ask: 'Good detail. How long did each elopement last?', why: 'Duration is what a rate comparison needs.' },
  ],
  hintsDropped: 0,
  usage: { input_tokens: 20, output_tokens: 30 },
  model: 'claude-haiku-4-5-20251001',
};

function tokenFor(role, tools) {
  const p = { role, kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

async function drafted(page, expert) {
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(NOTE));
  });
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(expert) }));
  await page.addInitScript(([k, t]) => localStorage.setItem(k, t), ['notes_auth_token', tokenFor('admin', ['bt'])]);
  await page.goto(PAGE);
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

test.describe('on the page', () => {
  test('the praise-only ask never reaches the panel, and the ask beside it does', async ({ page }) => {
    await drafted(page, EXPERT);

    const block = page.getByTestId('panel-expert-questions');
    if (!(await block.isVisible({ timeout: 800 }).catch(() => false))) {
      const fab = page.locator('.revision-fab').first();
      if (await fab.isVisible({ timeout: 3000 }).catch(() => false)) await fab.click();
    }
    await expect(block).toBeVisible({ timeout: 10000 });
    await expect(block.locator('[data-panel-expert]')).toHaveCount(1);
    await expect(block).toContainText('How long did each elopement last?');
    await expect(block).not.toContainText('This is good.');
  });
});

/* ISSUE #119, HIS RULING OF 2026-10-09 ON THE BOARD: when the expert has
   nothing to fix, its output collapses to a small check mark. Dropping the
   praise (above) emptied the list, and the block still drew a heading and
   "No unobserved claims found in the intake." on every clean note, which is
   the same "this is good" in the app's own words.

   NOTHING TO CHANGE IS A RULE, not a field. The expert's schema has no
   "nothing to report" flag (expertSchema in _worker.js), so the page decides
   from what is left after the praise is dropped: no ask, no phrase to reword,
   no abbreviation it could not read, and no finding cut by the cap. A reading
   of an abbreviation it did resolve is a reading aid, not a fix, so it does
   not hold the block open. */
test.describe('nothing to change', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE);
    await page.waitForFunction(() => !!window.ExpertPraise);
  });

  test('an empty pass, a keep, and a resolved abbreviation are nothing to change', async ({ page }) => {
    const read = await praise(page, (P) => [
      P.nothingToChange({ terms: [], register: [], hints: [], hintsDropped: 0 }),
      P.nothingToChange({ terms: [{ token: 'DTT', reading: 'Discrete Trial Training', status: 'resolved', why: '' }], register: [], hints: [] }),
      P.nothingToChange({ terms: [], register: [{ quote: 'The client sat.', action: 'keep', why: 'Observable.', move: '' }], hints: [] }),
    ]);
    expect(read).toEqual([true, true, true]);
  });

  test('any real finding means there is something to change', async ({ page }) => {
    const read = await praise(page, (P) => [
      P.nothingToChange({ terms: [], register: [], hints: [{ section: 'note', rank: 1, kind: 'thin', ask: 'How long did it last?', why: '' }] }),
      P.nothingToChange({ terms: [], register: [{ quote: 'he wanted attention', action: 'reframe', why: '', move: 'Say what happened.' }], hints: [] }),
      P.nothingToChange({ terms: [{ token: 'PCT', reading: '', status: 'unknown', why: '' }], register: [], hints: [] }),
      P.nothingToChange({ terms: [], register: [], hints: [], hintsDropped: 2 }),
      P.nothingToChange(null),
      // Pollux's hold on #328, finding 3: an ask the #118 check dropped is a
      // finding, so it holds the block open rather than hiding behind the mark.
      P.nothingToChange({ terms: [], register: [], hints: [], hintsDropped: 0, unresolvedTagged: 1 }),
      // The late hold on #328 (10 Oct), finding 3. A reading with its lists
      // missing is a broken call, not a clean pass.
      P.nothingToChange({}),
      P.nothingToChange({ terms: [], register: [] }),
      // A hint with no ask but a reason is still a finding.
      P.nothingToChange({ terms: [], register: [], hints: [{ section: 'note', rank: 1, kind: 'thin', ask: '', why: 'The rate is not given.' }] }),
    ]);
    expect(read).toEqual([false, false, false, false, false, false, false, false, false]);
  });
});

test.describe('on the page, a clean reading is a check mark', () => {
  const ONLY_PRAISE = {
    terms: [{ token: 'DTT', reading: 'Discrete Trial Training', status: 'resolved', why: 'Named beside the trial count.' }],
    register: [{ quote: 'The client completed programming.', action: 'keep', why: 'Observable and attributed.', move: '' }],
    hints: [{ section: 'note', rank: 1, kind: 'thin', ask: 'This is good.', why: 'Observable and attributed.' }],
    hintsDropped: 0,
    usage: { input_tokens: 20, output_tokens: 30 },
  };

  test('nothing to fix draws one small check mark and no text block', async ({ page }) => {
    await drafted(page, ONLY_PRAISE);
    const reading = page.getByTestId('expert-reading');
    const mark = reading.getByRole('img', { name: 'Expert: nothing to change' });
    await expect(mark).toBeVisible({ timeout: 10000 });
    await expect(reading).not.toContainText('Expert review of intake');
    await expect(reading).not.toContainText('No unobserved claims');
    await expect(reading).not.toContainText('Discrete Trial Training');
    const box = await reading.boundingBox();
    expect(box.height).toBeLessThanOrEqual(28);
  });

  test('a real finding still shows in full, with no check mark', async ({ page }) => {
    await drafted(page, {
      ...ONLY_PRAISE,
      register: [{ quote: 'he wanted attention', action: 'reframe', why: 'A function claim.', move: 'Say what happened.' }],
    });
    await expect(page.getByTestId('expert-register-toggle')).toContainText('1 phrase to reword');
    await expect(page.getByTestId('expert-reading')).toContainText('Discrete Trial Training');
    await expect(page.getByRole('img', { name: 'Expert: nothing to change' })).toHaveCount(0);
  });

  test('asks in the panel and no claims: the empty-claims line is a check, not a sentence', async ({ page }) => {
    await drafted(page, EXPERT);
    const empty = page.getByTestId('expert-register-empty');
    await expect(empty).toBeVisible({ timeout: 10000 });
    await expect(empty).toHaveAccessibleName('Expert: no unobserved claims');
    await expect(empty).not.toContainText('No unobserved claims found');
    await expect(page.getByRole('img', { name: 'Expert: nothing to change' })).toHaveCount(0);
  });
});
