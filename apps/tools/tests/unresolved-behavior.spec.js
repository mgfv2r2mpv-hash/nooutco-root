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
 *   - "did not resolve" in the draft is recast to "continued", which is his
 *     own reading of the phrase and changes nothing else in the sentence.
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

  test('"did not resolve" becomes "continued", and the rest of the sentence is untouched', async ({ page }) => {
    const said = ['vocalizations', 'crying', 'whining'];
    const out = await U(page, (N, b) => [
      N.recast('The vocalizations did not resolve.', b).text,
      N.recast("Crying didn't resolve when attention was delivered.", b).text,
      N.recast('The vocalizations failed to resolve until the iPad was delivered.', b).text,
      N.recast('Whining remained unresolved across both trials.', b).text,
      N.recast('The crying was not resolved.', b).text,
    ], said);
    expect(out).toEqual([
      'The vocalizations continued.',
      'Crying continued when attention was delivered.',
      'The vocalizations continued until the iPad was delivered.',
      'Whining continued across both trials.',
      'The crying continued.',
    ]);
  });

  test('a transitive or partial "resolve" is not recast, because "continued" would change what it says', async ({ page }) => {
    const said = [
      'Attention did not resolve the crying.',
      'The vocalizations did not fully resolve.',
      'BCBA resolved the scheduling conflict.',
    ];
    const out = await U(page, (N, xs) => xs.map((x) => N.recast(x, ['crying', 'vocalizations', 'bcba'])), said);
    expect(out.map((o) => o.text)).toEqual(said);
    expect(out.map((o) => o.n)).toEqual([0, 0, 0]);
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
  test('the stopped claim is flagged on Results, and "did not resolve" reads "continued"', async ({ page }) => {
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

    await expect(page.locator('textarea[data-section-id="results"]')).toHaveValue(/In the tangible condition the vocalizations continued\./);
    await expect(page.locator('textarea[data-section-id="results"]')).not.toHaveValue(/did not resolve/);
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

  test('each of his six sentences comes out unchanged, against notes naming the behavior', async ({ page }) => {
    const out = await U(page, (N, [xs, intake]) => xs.map((x) => N.passNote({ results: x }, ['results'], intake)), [POLLUX_1, NAMED]);
    expect(out.map((o) => o.output.results)).toEqual(POLLUX_1);
    expect(out.map((o) => o.recast)).toEqual(POLLUX_1.map(() => 0));
  });

  test('the words after the phrase hold even when every subject is named as a behavior', async ({ page }) => {
    const said = ['crying', 'behavior', 'attention', 'reinforcement', 'prompting', 'disagreement'];
    const more = POLLUX_1.concat([
      'Crying did not resolve entirely.',
      'Crying did not resolve partly because of the noise.',
      'Crying did not resolve immediately.',
      'Crying did not resolve within 2 minutes.',
      'Crying did not resolve on its own.',
      'Crying was not resolved by the BCBA.',
      // Pollux LOW 1 on 9545b0eb: in, as, so and since change the meaning.
      'Crying did not resolve in 10 minutes.',
      'Crying did not resolve as expected.',
      'Crying did not resolve so the BT ended the trial.',
      'Crying did not resolve since the last session.',
    ]);
    const out = await U(page, (N, [xs, b]) => xs.map((x) => N.recast(x, b).text), [more, said]);
    expect(out).toEqual(more);
  });

  test('only a subject the notes say did not resolve is recast', async ({ page }) => {
    const out = await U(page, (N) => [
      N.passNote({ results: 'The scheduling conflict did not resolve.' }, ['results'], 'Vocalizations did not resolve.').output.results,
      N.passNote({ results: 'The vocalizations did not resolve.' }, ['results'], '').output.results,
      N.passNote({ results: 'The vocalizations did not resolve.' }, ['results'], 'Vocalizations did not resolve.').output.results,
    ]);
    expect(out).toEqual([
      'The scheduling conflict did not resolve.',
      'The vocalizations did not resolve.',
      'The vocalizations continued.',
    ]);
  });

  test('a recast tells the clinician, on that section, what was changed', async ({ page }) => {
    const out = await U(page, (N, intake) => N.recastHints({
      narrative: 'BCBA ran an attention condition.',
      results: 'In the tangible condition the vocalizations did not resolve.',
    }, intake, ['narrative', 'results']), INTAKE);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ section: 'results', code: 'other', kind: 'register' });
    expect(out[0].detail).toBe('Changed "did not resolve" to "continued" to match the notes.');
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

  test('the Results section says what the recast changed', async ({ page }) => {
    await draft(page, { terms: [], register: [], hints: [], hintsDropped: 0 });
    await expect(page.getByTestId('hints-results')).toContainText('Changed "did not resolve" to "continued" to match the notes.');
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
