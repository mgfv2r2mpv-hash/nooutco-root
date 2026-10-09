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
    const out = await U(page, (N) => [
      N.recast('The vocalizations did not resolve.').text,
      N.recast("Crying didn't resolve when attention was delivered.").text,
      N.recast('The vocalizations failed to resolve until the iPad was delivered.').text,
      N.recast('Whining remained unresolved across both trials.').text,
      N.recast('The crying was not resolved.').text,
    ]);
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
    const out = await U(page, (N, xs) => xs.map((x) => N.recast(x)), said);
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
