import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* ISSUE #118. Kaleb, from inside the tool, pointed at an attention-test
 * sentence in an Assessment note: "if the vocalizations didn't resolve, then
 * the client kept making the vocalizations." His reading, confirmed on the
 * board on 2026-10-09: the write-up treated vocalizations that never resolved
 * as if they had stopped. When the data says a behavior did not resolve, the
 * write-up says it continued.
 *
 * The drafting prompt already asks for that (36e4e863), and a prompt cannot
 * guarantee it. notes/bcba/unresolved.js enforces it after the model returns,
 * the way absence.js and hollow.js enforce theirs:
 *
 *   - nothing in the draft is rewritten. #328 recast "did not resolve" to
 *     "continued"; the review of #337 found that flipped correct sentences,
 *     and Kaleb's rule is that an automatic check raises hints and never
 *     rewrites a correct sentence.
 *   - a clause saying a behavior stopped, when the notes say that behavior did
 *     not, puts an amber hint on the section. The sentence is the clinician's
 *     to fix: a regular expression does not rewrite a finding.
 *   - an expert ask or replacement sentence that assumes the behavior stopped
 *     is dropped before the panel reads it.
 *
 * Every model reply here is a mock and every word is invented. These tests
 * prove what the page does with a reply that carries the error. They cannot
 * prove how often the live model makes it. */

const BCBA = '/notes/bcba/index.html?tool=assess';

const INTAKE =
  '- FA, attention condition: during bubble activity, when crying occurred, BCBA delivered attention. ' +
  'Vocalizations did not resolve.\n' +
  '- Tangible condition: iPad delivered after 10 s.';

const U = (page, fn, arg) => page.evaluate(
  ([src, a]) => (0, eval)(`(${src})`)(window.NoteUnresolved, a), [fn.toString(), arg]);

/* What the module does with each draft sentence against one intake: which
   rewrite functions it still offers (none, since the review of #337) and
   whether each sentence gets a hint. */
const read = (page, xs, intake) => U(page, (N, [list, i]) => ({
  rewrite: ['recast', 'passNote', 'recastHints'].filter((k) => typeof N[k] === 'function'),
  hinted: list.map((x) => N.hints({ results: x }, i, ['results']).length > 0),
}), [xs, intake]);
const none = (xs) => ({ rewrite: [], hinted: xs.map(() => false) });
const all = (xs) => ({ rewrite: [], hinted: xs.map(() => true) });

test.describe('what the notes say did not stop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BCBA);
    await page.waitForFunction(() => !!window.NoteUnresolved);
  });

  test('a behavior the notes say did not resolve, did not stop, or kept going is read', async ({ page }) => {
    const read = await U(page, (N) => [
      N.behaviors('Vocalizations did not resolve.'),
      N.behaviors("When attention was delivered the crying didn't stop."),
      N.behaviors('Attention given; client kept screaming.'),
      N.behaviors('The client continued to cry for 2 min.'),
      N.behaviors('Whining remained unresolved across both trials.'),
    ]);
    expect(read).toEqual([['vocalizations'], ['crying'], ['screaming'], ['cry'], ['whining']]);
  });

  test('a behavior the notes also say stopped is left alone, because which condition is unknowable here', async ({ page }) => {
    const read = await U(page, (N) => [
      N.behaviors('Crying stopped in the tangible condition. Crying did not resolve in the attention condition.'),
      N.behaviors('Session continued. Trials ended at 3.'),
      N.behaviors(''),
    ]);
    expect(read).toEqual([[], [], []]);
  });
});

test.describe('the draft says it continued', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BCBA);
    await page.waitForFunction(() => !!window.NoteUnresolved);
  });

  test('nothing is rewritten, and a draft that says "did not resolve" gets no hint', async ({ page }) => {
    const xs = [
      'The vocalizations did not resolve.',
      "Crying didn't resolve when attention was delivered.",
      'Whining remained unresolved across both trials.',
      'Attention did not resolve the crying.',
      'The vocalizations did not fully resolve.',
    ];
    expect(await read(page, xs, 'Vocalizations did not resolve. Crying did not stop. Whining persisted.')).toEqual(none(xs));
  });

  test('a clause saying the behavior stopped, against notes saying it did not, is a hint on that section', async ({ page }) => {
    const hints = await U(page, (N, intake) => N.hints({
      narrative: 'BCBA ran an attention condition and a tangible condition.',
      results: 'To test attention as a potential reinforcer, two trials were arranged: during bubble activity, when Crying occurred, the BCBA delivered attention and the vocalizations stopped. In the tangible condition the iPad was delivered.',
      hints: [],
    }, intake, ['narrative', 'results']), INTAKE);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ section: 'results', code: 'ambiguous_item', kind: 'thin', rank: 0 });
    expect(hints[0].detail).toContain('vocalizations');
    expect(hints[0].detail.length).toBeLessThanOrEqual(120);
  });

  test('a negated stop, a different behavior, or a question the notes never raised is not a hint', async ({ page }) => {
    const hints = await U(page, (N, intake) => [
      N.hints({ results: 'The vocalizations did not stop when attention was delivered.' }, intake, ['results']),
      N.hints({ results: 'The client kept vocalizing. The iPad was delivered and the tantrum ended.' }, intake, ['results']),
      N.hints({ results: 'The vocalizations stopped.' }, 'Vocalizations stopped when the iPad was delivered.', ['results']),
    ], INTAKE);
    expect(hints).toEqual([[], [], []]);
  });

  test('the same word in another form is the same behavior: vocalizing, vocalized, vocalizations', async ({ page }) => {
    const hints = await U(page, (N) => [
      N.hints({ results: 'The client stopped vocalizing after attention.' }, 'Vocalizations did not resolve.', ['results']),
      N.hints({ results: 'The client no longer cried once BCBA attended.' }, "Crying didn't stop.", ['results']),
    ]);
    expect(hints.map((h) => h.length)).toEqual([1, 1]);
  });
});

test.describe('the expert does not ask when it stopped', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BCBA);
    await page.waitForFunction(() => !!window.NoteUnresolved);
  });

  test('an ask or a rewrite that assumes the behavior stopped is dropped and counted; the rest stays', async ({ page }) => {
    const out = await U(page, (N, intake) => {
      const found = {
        terms: [],
        register: [
          { quote: 'Vocalizations did not resolve', action: 'reframe', why: 'Vague.', move: 'The vocalizations stopped after attention was delivered.' },
          { quote: 'BCBA delivered attention', action: 'reframe', why: 'Say for how long.', move: 'BCBA delivered attention for 10 s.' },
        ],
        hints: [
          { section: 'results', rank: 1, kind: 'thin', ask: 'How long after attention did the vocalizations stop?', why: '' },
          { section: 'results', rank: 2, kind: 'thin', ask: 'How many seconds of attention were delivered?', why: '' },
        ],
        hintsDropped: 0,
      };
      const kept = N.dropExpert(found, intake);
      return { kept, before: found.hints.length + found.register.length };
    }, INTAKE);
    expect(out.kept.hints.map((h) => h.ask)).toEqual(['How many seconds of attention were delivered?']);
    expect(out.kept.register.map((r) => r.move)).toEqual(['BCBA delivered attention for 10 s.']);
    expect(out.kept.unresolvedDropped).toBe(2);
    expect(out.before).toBe(4);
  });
});

/* THE MOCKED REPLY THAT CARRIES THE ERROR, through the real page. */
function tokenFor(tools) {
  const p = { role: 'admin', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const WRONG = {
  activities: ['Functional Analysis'],
  reporting: [],
  narrative: 'BCBA ran an attention condition and a tangible condition to identify the function of crying.',
  results:
    'To test attention as a potential reinforcer, two trials were arranged: during bubble activity, when Crying occurred, the BCBA delivered attention and the vocalizations stopped. ' +
    'In the tangible condition the vocalizations did not resolve.',
  hints: [],
};

test.describe('on the page, with a reply that carries the error', () => {
  test('the stopped claim is flagged on Results, and "did not resolve" stays as written', async ({ page }) => {
    await page.route('**/api/llm-call**', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}');
      if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
      return route.fulfill(reply(WRONG));
    });
    await page.route('**/api/expert-pass**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [], hintsDropped: 0 }) }));
    await page.addInitScript(([k, t]) => localStorage.setItem(k, t), ['notes_auth_token', tokenFor(['assess'])]);
    await page.goto(BCBA);
    await page.getByRole('textbox', { name: /Summary Notes of Activities/i }).first().fill(INTAKE);
    await page.getByRole('button', { name: 'Generate Note' }).click();
    const ack = page.locator('#notes-ack-go');
    if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.locator('#notes-ack-cb').check();
      await ack.click();
    }
    const rev = page.locator('#notes-scrub-go');
    if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    await expect(page.locator('textarea[data-section-id="results"]')).toHaveValue(/In the tangible condition the vocalizations did not resolve\./);
    await expect(page.locator('textarea[data-section-id="results"]')).not.toHaveValue(/vocalizations continued/);
    await expect(page.getByTestId('hints-results')).toContainText('vocalizations');
  });
});

/* POLLUX'S HOLD ON #328 (9 Oct). This is clinical text for a BCBA, and a wrong
 * automatic rewrite is worse than no rewrite. Every sentence below is one
 * Pollux ran through the real module and quoted back, so each test starts
 * from his exact example. */

test.describe('Pollux 1: a correct sentence is never recast', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BCBA);
    await page.waitForFunction(() => !!window.NoteUnresolved);
  });

  // Every subject Pollux used is named here as a behavior that did not
  // resolve, so the guards on the words after the phrase are what is tested.
  const NAMED =
    'Crying did not resolve. Elopement did not stop. The behavior did not resolve. Vocalizations did not resolve.';
  const POLLUX_1 = [
    'Crying did not resolve completely.',
    'The behavior did not resolve fully.',
    'Attention did not resolve crying.',
    'Differential reinforcement failed to resolve elopement.',
    "Prompting did not resolve Mom's concern.",
    'The disagreement was not resolved by the team.',
  ];

  test('each of his six sentences, and the words after the phrase, come out unchanged and unflagged', async ({ page }) => {
    const more = POLLUX_1.concat([
      'Crying did not resolve entirely.',
      'Crying did not resolve partly because of the noise.',
      'Crying did not resolve immediately.',
      'Crying did not resolve within 2 minutes.',
      'Crying did not resolve on its own.',
      'Crying was not resolved by the BCBA.',
      'Crying did not resolve in 10 minutes.',
      'Crying did not resolve as expected.',
      'Crying did not resolve so the BT ended the trial.',
      'Crying did not resolve since the last session.',
      'The scheduling conflict did not resolve.',
    ]);
    expect(await read(page, more, NAMED)).toEqual(none(more));
  });

  test('no section carries a recast notice', async ({ page }) => {
    const out = await U(page, (N, intake) => N.hints({
      narrative: 'BCBA ran an attention condition.',
      results: 'In the tangible condition the vocalizations did not resolve.',
    }, intake, ['narrative', 'results']), INTAKE);
    expect(out).toEqual([]);
  });
});

test.describe('Pollux 2: a sentence that already says continued is not flagged', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BCBA);
    await page.waitForFunction(() => !!window.NoteUnresolved);
  });

  const INTAKE_2 = 'Crying did not stop during demands. Vocalizations did not resolve.';
  const POLLUX_2 = [
    'Crying continued after the BT told him to stop.',
    'Crying continued after the demand ended.',
    'Crying continued even when the activity ended.',
    'Vocalizations continued after the BT stopped the task.',
    'Crying did not appear to have stopped by the end of session.',
  ];

  test('each of his five sentences is left unflagged', async ({ page }) => {
    const out = await U(page, (N, [xs, intake]) => xs.map((x) => N.hints({ results: x }, intake, ['results'])), [POLLUX_2, INTAKE_2]);
    expect(out).toEqual(POLLUX_2.map(() => []));
  });

  test('a real stopped claim against the same notes is still flagged', async ({ page }) => {
    const out = await U(page, (N, intake) => N.hints({ results: 'Crying stopped when the BT removed the demand.' }, intake, ['results']), INTAKE_2);
    expect(out).toHaveLength(1);
  });

  test('"did not stop, but stopped" is two conditions, and the post-check stays silent', async ({ page }) => {
    const intake = 'Crying did not stop during demands, but stopped within a minute of the break.';
    const out = await U(page, (N, i) => [
      N.behaviors(i),
      N.hints({ results: 'Crying stopped within a minute of the break.' }, i, ['results']),
    ], intake);
    expect(out).toEqual([[], []]);
  });
});

test.describe('Pollux 3: a real finding cannot hide behind the check mark', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BCBA);
    await page.waitForFunction(() => !!window.NoteUnresolved && !!window.ExpertPraise);
  });

  test('the ask "stop or continue" is the right question and is kept', async ({ page }) => {
    const out = await U(page, (N) => {
      const found = {
        terms: [],
        register: [],
        hints: [
          { section: 'results', rank: 1, kind: 'thin', ask: 'Did the crying stop or continue by the end?', why: '' },
          { section: 'results', rank: 2, kind: 'thin', ask: 'Did the crying persist, or stop after the break?', why: '' },
          { section: 'results', rank: 3, kind: 'thin', ask: 'Say whether the crying stopped.', why: '' },
        ],
        hintsDropped: 0,
      };
      const kept = N.dropExpert(found, 'Crying did not stop during demands.');
      return { asks: kept.hints.map((h) => h.ask), dropped: kept.unresolvedDropped, clear: window.ExpertPraise.nothingToChange(kept) };
    });
    expect(out.asks).toEqual([
      'Did the crying stop or continue by the end?',
      'Did the crying persist, or stop after the break?',
      'Say whether the crying stopped.',
    ]);
    expect(out.dropped).toBe(0);
    expect(out.clear).toBe(false);
  });

  test('a dropped ask holds the block open', async ({ page }) => {
    const out = await U(page, (N) => {
      const found = {
        terms: [],
        register: [],
        hints: [{ section: 'results', rank: 1, kind: 'thin', ask: 'How long after attention did the vocalizations stop?', why: '' }],
        hintsDropped: 0,
      };
      const kept = N.dropExpert(found, 'Vocalizations did not resolve.');
      return { asks: kept.hints.length, dropped: kept.unresolvedDropped, clear: window.ExpertPraise.nothingToChange(kept) };
    });
    expect(out).toEqual({ asks: 0, dropped: 1, clear: false });
  });
});

test.describe('Pollux 4: a skill is not a behavior that did not stop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BCBA);
    await page.waitForFunction(() => !!window.NoteUnresolved);
  });

  test('"kept eating" and "continued requesting" are skills, and are not read', async ({ page }) => {
    const out = await U(page, (N) => [
      N.behaviors('Client kept eating snacks.'),
      N.behaviors('Client continued requesting items with a full sentence.'),
      N.behaviors('The client continued to eat lunch.'),
      N.hints({ results: 'Eating stopped when the bell rang.' }, 'Client kept eating snacks.', ['results']),
    ]);
    expect(out).toEqual([[], [], [], []]);
  });

  test('a problem behavior, or one the notes name as a target, still is', async ({ page }) => {
    const out = await U(page, (N) => [
      N.behaviors('Attention given; client kept hitting.'),
      N.behaviors('Target behavior: humming. The client kept humming through the transition.'),
    ]);
    expect(out).toEqual([['hitting'], ['humming']]);
  });
});

test.describe('on the page, Pollux 1 and 3', () => {
  async function draft(page, expert) {
    await page.route('**/api/llm-call**', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}');
      if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
      return route.fulfill(reply(WRONG));
    });
    await page.route('**/api/expert-pass**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(expert) }));
    await page.addInitScript(([k, t]) => localStorage.setItem(k, t), ['notes_auth_token', tokenFor(['assess'])]);
    await page.goto(BCBA);
    await page.getByRole('textbox', { name: /Summary Notes of Activities/i }).first().fill(INTAKE);
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

  test('Results keeps "did not resolve" and carries no recast notice', async ({ page }) => {
    await draft(page, { terms: [], register: [], hints: [], hintsDropped: 0 });
    await expect(page.locator('textarea[data-section-id="results"]')).toHaveValue(/the vocalizations did not resolve\./);
    await expect(page.getByTestId('hints-results')).not.toContainText('Changed "did not resolve"');
  });

  test('an expert ask dropped for assuming a stop shows a line, and no check mark', async ({ page }) => {
    await draft(page, {
      terms: [],
      register: [],
      hints: [{ section: 'results', rank: 1, kind: 'thin', ask: 'How long after attention did the vocalizations stop?', why: '' }],
      hintsDropped: 0,
    });
    await expect(page.getByTestId('expert-unresolved-dropped')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('expert-unresolved-dropped')).toContainText('notes say');
    await expect(page.getByRole('img', { name: 'Expert: nothing to change' })).toHaveCount(0);
  });
});

/* THE LATE REVIEW'S HOLD ON #328 (10 Oct). Kaleb's clinical rule: automatic
 * checks raise hints and never rewrite a correct sentence or change a tick or
 * a pick. Each sentence below is one the reviewer quoted, and each test says
 * what the module must do with it: leave it as written, stay silent, or hint. */

test.describe('late hold 1: a correct sentence is never rewritten', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BCBA);
    await page.waitForFunction(() => !!window.NoteUnresolved);
  });

  const HOLD_1 = [
    'The data did not resolve whether the function was attention or escape.',
    'The FA failed to resolve which condition maintained it.',
    'Crying failed to resolve to prompting.',
    'Vocalizations did not resolve into a clear pattern.',
    'Crying was not resolved by planned ignoring.',
  ];
  // The intake says every one of those subjects did not resolve, so only the
  // gate on the subject and the words after the phrase stand between each
  // sentence and a rewrite.
  const NAMED_1 = HOLD_1.join(' ') + ' Crying did not stop. Vocalizations did not resolve.';

  test('each of the five sentences comes out as written and unflagged, against notes that name the subject', async ({ page }) => {
    expect(await read(page, HOLD_1, NAMED_1)).toEqual(none(HOLD_1));
  });

  test('whether, which, what, how, if, to, into and by after the phrase: no rewrite, no hint', async ({ page }) => {
    const xs = ['whether', 'which', 'what', 'how', 'if', 'to', 'into', 'by']
      .map((w) => `Crying did not resolve ${w} the BT expected.`);
    expect(await read(page, xs, 'Crying did not stop.')).toEqual(none(xs));
  });

  test('"failed to resolve" and a passive "was not resolved": no rewrite, no hint', async ({ page }) => {
    const xs = [
      'Crying failed to resolve.',
      'The vocalizations failed to resolve until the iPad was delivered.',
      'The crying was not resolved.',
      'Whining was not resolved across both trials.',
      'Vocalizations were not resolved.',
    ];
    expect(await read(page, xs, 'Crying did not stop. Vocalizations did not resolve. Whining persisted.')).toEqual(none(xs));
  });

  test('a subject the intake names that is not a behavior is never read as one', async ({ page }) => {
    const out = await U(page, (N) => [
      N.behaviors('The data did not resolve.'),
      N.behaviors('The FA did not resolve. The question remained unresolved.'),
      N.behaviors('The function did not resolve across conditions.'),
      N.hints({ results: 'The data stopped.' }, 'The data did not resolve.', ['results']),
    ]);
    expect(out).toEqual([[], [], [], []]);
  });

  test('a behavior from the intake that the draft says did not resolve is left as written', async ({ page }) => {
    const xs = ['The vocalizations did not resolve.', 'Elopement did not resolve.'];
    expect(await read(page, xs, 'Vocalizations did not resolve. Elopement did not stop.')).toEqual(none(xs));
  });
});

test.describe('late hold 2: a correct sentence is not hinted', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BCBA);
    await page.waitForFunction(() => !!window.NoteUnresolved);
  });

  const SPLIT = 'Vocalizations did not stop in attention but stopped in escape.';
  const LATER = [
    'Vocalizations stopped immediately in the escape condition.',
    'Rate of vocalizations ended at zero in play.',
    'During tangible, vocalizations resolved.',
  ];

  test('"did not stop in attention but stopped in escape" leaves nothing unresolved', async ({ page }) => {
    const out = await U(page, (N, i) => [
      N.behaviors(i),
      N.behaviors('Vocalizations did not stop in attention but did stop in escape.'),
      N.behaviors('Vocalizations did not stop in attention, but in escape, they stopped.'),
    ], SPLIT);
    expect(out).toEqual([[], [], []]);
  });

  test('the later correct sentences get no hint after that intake', async ({ page }) => {
    const out = await U(page, (N, [xs, i]) => xs.map((x) => N.hints({ results: x }, i, ['results'])), [LATER, SPLIT]);
    expect(out).toEqual(LATER.map(() => []));
  });

  test('a behavior unresolved in one condition is not hinted when a sentence says it stopped in another', async ({ page }) => {
    const intake = '- Attention condition: vocalizations did not resolve.';
    const out = await U(page, (N, [xs, i]) => xs.map((x) => N.hints({ results: x }, i, ['results'])), [LATER, intake]);
    expect(out).toEqual(LATER.map(() => []));
  });

  test('a stop claim in the same condition, or with no condition named, is still hinted', async ({ page }) => {
    const intake = '- Attention condition: vocalizations did not resolve.';
    const out = await U(page, (N, i) => [
      N.hints({ results: 'In the attention condition, vocalizations stopped after 2 minutes.' }, i, ['results']).length,
      N.hints({ results: 'Vocalizations stopped.' }, i, ['results']).length,
    ], intake);
    expect(out).toEqual([1, 1]);
  });

  test('a stop read further back than two words is negated', async ({ page }) => {
    const intake = 'Vocalizations did not resolve.';
    const xs = [
      'Vocalizations were not likely to have stopped.',
      'Vocalizations were not observed to have stopped.',
      'Vocalizations were not at any point observed to have stopped.',
      'Vocalizations were unlikely to have stopped.',
    ];
    const out = await U(page, (N, [list, i]) => list.map((x) => N.hints({ results: x }, i, ['results'])), [xs, intake]);
    expect(out).toEqual(xs.map(() => []));
  });

  test('"the interval ended with vocalizations occurring" is the interval ending, not the behavior', async ({ page }) => {
    const out = await U(page, (N) => [
      N.hints({ results: 'The interval ended with vocalizations occurring.' }, 'Vocalizations did not resolve.', ['results']),
      N.hints({ results: 'The BT stopped the task when crying started.' }, "Crying didn't stop.", ['results']),
    ]);
    expect(out).toEqual([[], []]);
  });
});

/* THE REVIEW OF #337 (10 Oct). It found the "did not resolve" -> "continued"
 * recast still flipped correct sentences, and Atlas's call, on Kaleb's rule
 * that automatic checks raise hints and never rewrite a correct sentence, was
 * to remove the rewrite. Each sentence below is one the reviewer quoted. */

const CRY = 'Crying did not stop during the session.';
const CRYR = 'Crying did not resolve during the session.';
const VOC = 'During the attention condition, vocalizations did not resolve.';

async function draftWith(page, results, intake, expert) {
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply({ ...WRONG, results }));
  });
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(expert || { terms: [], register: [], hints: [], hintsDropped: 0 }) }));
  await page.addInitScript(([k, t]) => localStorage.setItem(k, t), ['notes_auth_token', tokenFor(['assess'])]);
  await page.goto(BCBA);
  await page.getByRole('textbox', { name: /Summary Notes of Activities/i }).first().fill(intake);
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

const FLIPPED = [
  'Crying did not resolve or escalate during the probe.',
  'Crying did not resolve once during the session.',
  'Crying did not resolve for a single interval.',
  'Crying did not resolve for long, and resumed within a minute.',
  'Crying did not resolve even partially.',
  'Crying did not resolve for the first time in three sessions.',
  'Crying did not resolve during any trial.',
  'Crying did not resolve across any condition.',
  'Crying remained unresolved or worsened.',
  'Mom wrote "crying did not resolve." The BCBA disagrees.',
];

test.describe('review of #337: no rewrite at all', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BCBA);
    await page.waitForFunction(() => !!window.NoteUnresolved);
  });

  test('every sentence the recast flipped is left alone and unflagged', async ({ page }) => {
    expect(await read(page, FLIPPED, CRYR)).toEqual(none(FLIPPED));
  });
});

test.describe('review of #337, on the page', () => {
  test('Results keeps every flipped sentence word for word', async ({ page }) => {
    await draftWith(page, FLIPPED.join(' '), CRYR);
    const value = await page.locator('textarea[data-section-id="results"]').inputValue();
    for (const x of FLIPPED) expect(value).toContain(x);
    expect(value).not.toContain('continued');
  });

  test('a reason-only expert finding shows in the panel, not hidden behind a mark', async ({ page }) => {
    await draftWith(page, 'In the tangible condition the iPad was delivered.', 'Tangible condition: iPad delivered after 10 s.', {
      terms: [], register: [], hintsDropped: 0,
      hints: [{ section: 'results', rank: 1, kind: 'thin', ask: '', why: 'The rate of crying in the tangible condition is not given.' }],
    });
    await expect(page.getByText('The rate of crying in the tangible condition is not given.')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('img', { name: 'Expert: nothing to change' })).toHaveCount(0);
  });
});

test.describe('review of #337: hints', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BCBA);
    await page.waitForFunction(() => !!window.NoteUnresolved && !!window.ExpertQuestions);
  });

  test('MEDIUM 1: a condition word elsewhere on the line or in another sentence does not hide a hint', async ({ page }) => {
    const out = await U(page, (N) => [
      ['During demands he hit staff. Crying did not stop.', 'Crying stopped when he was given attention.'],
      ['During the attention condition, vocalizations did not resolve. Mom reports he plays alone at home.', 'Vocalizations stopped after 3 minutes.'],
      ['Mom reports he seeks attention at home and escapes demands by crying. Crying did not stop during the session.', 'Crying stopped when the BT returned to play.'],
      ['Mom reports he seeks attention at home and escapes demands by crying. Crying did not stop during the session.', 'Crying stopped once he was left alone.'],
      ['Mom reports he seeks attention at home.\nCrying did not stop during the session.', 'Crying stopped once he was left alone.'],
    ].map(([intake, x]) => N.hints({ results: x }, intake, ['results']).length));
    expect(out).toEqual([1, 1, 1, 1, 1]);
  });

  test('MEDIUM 2: core target behaviors are read, hyphenated or not', async ({ page }) => {
    const ws = ['Meltdowns', 'Stereotypy', 'Property destruction', 'Self-injury', 'SIB', 'Head-banging', 'Head banging',
      'Hand-flapping', 'Echolalia', 'Pica', 'Dropping', 'Screaming', 'Tantrums', 'Mouthing', 'Biting'];
    const out = await U(page, (N, list) => list.map((b) =>
      N.hints({ results: `${b} stopped after the break.` }, `${b} did not stop during the session.`, ['results']).length), ws);
    expect(out).toEqual(ws.map(() => 1));
  });

  test('MEDIUM 3: a hint with a reason and no ask is a row in the panel', async ({ page }) => {
    const rows = await page.evaluate(() => window.ExpertQuestions.list({
      status: 'done',
      hints: [
        { section: 'results', rank: 1, kind: 'thin', ask: '', why: 'The rate is not given.' },
        { section: 'results', rank: 2, kind: 'thin', ask: '', why: '' },
      ],
      register: [],
    }, { whole: 'note' }));
    expect(rows.map((r) => [r.kind, r.question, r.why])).toEqual([['ask', 'The rate is not given.', '']]);
  });

  test('MEDIUM 4: a question or a correction from the expert is kept; an ask that takes the stop as given is dropped', async ({ page }) => {
    const intake = CRY + ' ' + VOC;
    const out = await U(page, (N, i) => [
      ['Did crying stop before the break?', ''],
      ["Correct the sentence 'crying stopped after 2 minutes'; the notes say it did not stop.", ''],
      ['', 'The note says crying stopped but the data show it did not.'],
      ['Results says crying stopped. Is that right?', ''],
      ["Rewrite 'crying stopped' as the notes have it.", 'Notes say crying did not stop.'],
      ['Clarify whether vocalizations stopped in escape.', ''],
      ['Say who told him to stop crying.', ''],
      ['In escape, how long until vocalizations stopped?', ''],
      ['How long until the crying stopped?', ''],
      ['Name the replacement behavior taught when crying stopped.', ''],
    ].map(([ask, why]) => N.dropExpert({ terms: [], register: [], hints: [{ section: 'results', rank: 1, kind: 'thin', ask, why }] }, i).unresolvedDropped), intake);
    expect(out).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
  });

  test('MEDIUM 5: a stop that is not the behavior stopping is not a hint', async ({ page }) => {
    const cases = [
      [CRY, 'Mom repeatedly asked him to stop crying.'],
      ['Crying did not stop. Hitting did not stop.', 'The BT told him to stop hitting.'],
      ['Elopement did not stop.', 'Elopement ended the session early.'],
      [CRY, 'Crying led the BT to stop the trial.'],
      [CRY, 'The BT said "stop crying" twice.'],
      ['Hitting did not resolve with redirection alone.', 'Hitting stopped the game.'],
      ['SIB did not stop.', 'SIB occurred twice before the BT stopped the activity.'],
      [VOC, 'Vocalizations stopped in escape but not attention.'],
      ['Aggression did not stop during demands.', 'Aggression caused staff to end the demand.'],
      [CRY, 'The BT stopped the timer when crying began.'],
    ];
    const out = await U(page, (N, list) => list.map(([i, x]) => N.hints({ results: x }, i, ['results']).length), cases);
    expect(out).toEqual(cases.map(() => 0));
  });

  test('the behavior stopping is still a hint, however the sentence opens', async ({ page }) => {
    const cases = [
      [CRY, 'Not long after the break crying stopped.'],
      [CRY, 'Without the iPad present crying stopped.'],
      [CRY, 'Planned ignoring was used until crying stopped.'],
      [CRY, 'He stopped crying after two minutes.'],
      [CRY, 'By the end he no longer cried.'],
      ['Elopement did not stop.', 'Elopement occurred three times, but it stopped once the gate was closed.'],
      ['Aggression did not stop during demands.', 'Aggression toward peers stopped after escape was provided.'],
      [VOC, 'In attention, vocalizations stopped after 2 minutes.'],
      ['Crying continued throughout the session.', 'Crying stopped after the BT left.'],
    ];
    const out = await U(page, (N, list) => list.map(([i, x]) => N.hints({ results: x }, i, ['results']).length), cases);
    expect(out).toEqual(cases.map(() => 1));
  });
});
