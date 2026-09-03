import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* HIS UPGRADE 01, ORDERED 2026-09-03 with a plain "yes".

   strategy_in_wrong_section is the one item on his bar that is checkable
   exactly rather than judged, and it already runs. It just runs too late: in
   finalize, against the model's output, so a technician pays a full model round
   trip to learn something a regex knew the moment they stopped typing.

   The misplacement starts in the INPUT. A technician types a consequence
   procedure into the Antecedent Strategies box, and the model carries that
   faithfully through to the output narrative. So the same check, on the same
   published table, run on the intake before the draft call, catches the
   identical thing one model call earlier.

   NO SECOND COPY OF ANYTHING. misplaced() is already pure and already takes an
   object keyed by section; misplacedInput only builds that object from the
   intake boxes the tool names. A duplicated strategy table is a table that
   drifts, and which section owns a DRO has already moved once.

   IT INFORMS AND NEVER BLOCKS. Round 10, his words: "I don't like pages moving
   on me." The reporting barrier is the one that never gets lowered. So this is
   one more row in a panel that already opens before the draft, and Generate is
   untouched.

   THE INPUT IS NOISIER THAN THE OUTPUT, which is the new risk. The post-draft
   check reads model prose; this one reads fragments, shorthand and bullet
   scraps. Same terms, much rougher text, so the fragment tests below are the
   ones that matter most. */

const SECRET = 'playwright-local-test-secret';
function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}
const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const load = async (page) => {
  await page.goto('/notes/bt/');
  await page.waitForFunction(() => !!(window.NoteHollow && window.NOTE_TOOLS));
};

const found = (page, values) => page.evaluate((v) => window.NoteHollow
  .misplacedInput(v, window.NOTE_TOOLS.find((t) => t.id === 'bt').strategyOwnership)
  .map((h) => h.input + ' -> ' + h.homeInput + ': ' + h.label), values);

test.describe('a strategy typed into the box that does not own it', () => {
  test('is found in the intake, naming the box it was typed in and the box it belongs in', async ({ page }) => {
    await load(page);

    // A consequence procedure under Antecedent Strategies.
    expect(await found(page, { fAntecedent: 'DRA alongside the token board', fBehavior: '' }))
      .toEqual(['fAntecedent -> fBehavior: Differential reinforcement of an alternative or incompatible behavior (DRA/DRI)']);

    // And the other way: an antecedent procedure under Behavior & Staff Response.
    expect(await found(page, { fAntecedent: '', fBehavior: 'used a visual schedule after each incident' }))
      .toEqual(['fBehavior -> fAntecedent: Visual schedule']);
  });

  test('says nothing when the strategy is in its own box', async ({ page }) => {
    await load(page);

    expect(await found(page, { fAntecedent: 'visual schedule posted at the table', fBehavior: '' })).toEqual([]);
    expect(await found(page, { fAntecedent: '', fBehavior: 'DRA for every request' })).toEqual([]);
  });

  test('says nothing when it genuinely ran in both, which is his exception verbatim', async ({ page }) => {
    await load(page);

    // "A strategy that genuinely ran in both roles in one session is narrated
    // in both, and that is not an error." misplaced() already holds this rule;
    // this proves feeding it the intake did not lose it.
    expect(await found(page, {
      fAntecedent: 'DRA set up before each transition',
      fBehavior: 'DRA followed every request instead of elopement',
    })).toEqual([]);
  });

  test('survives the shorthand a technician actually types', async ({ page }) => {
    await load(page);

    /* THE RISK THIS UPGRADE ADDS. The post-draft check reads model prose; this
       one reads whatever is in the box. These are the shapes the intake
       placeholders themselves invite, and none of them may produce a finding
       that is not really there. */
    for (const values of [
      // Bullet scraps, the shape the placeholder asks for.
      { fAntecedent: '- 1-min warnings before switching\n- offered choice of work order', fBehavior: '' },
      // Ordinary words that are deliberately not terms.
      { fAntecedent: 'gave him a break when he asked', fBehavior: 'blocked and redirected' },
      // The bare phrase that resolves to neither DR procedure.
      { fAntecedent: 'differential reinforcement throughout', fBehavior: '' },
      // Empty and near-empty boxes.
      { fAntecedent: '', fBehavior: '' },
      { fAntecedent: 'n/a', fBehavior: 'none' },
    ]) {
      expect(await found(page, values), JSON.stringify(values)).toEqual([]);
    }
  });

  test('fails open rather than guessing when it has nothing to read', async ({ page }) => {
    await load(page);

    const empties = await page.evaluate(() => {
      const own = window.NOTE_TOOLS.find((t) => t.id === 'bt').strategyOwnership;
      return [
        window.NoteHollow.misplacedInput(null, own).length,
        window.NoteHollow.misplacedInput({}, own).length,
        window.NoteHollow.misplacedInput({ fAntecedent: 'DRA on the token board' }, null).length,
        window.NoteHollow.misplacedInput({ fAntecedent: 'DRA on the token board' }, { sections: {} }).length,
      ];
    });
    expect(empties).toEqual([0, 0, 0, 0]);
  });

  test('every section that owns strategies names the intake box that feeds it', async ({ page }) => {
    await load(page);

    // Without this mapping the check silently reads undefined and finds
    // nothing, which is the failure that looks exactly like a clean note.
    const declared = await page.evaluate(() => {
      const own = window.NOTE_TOOLS.find((t) => t.id === 'bt').strategyOwnership.sections;
      return Object.keys(own).map((k) => k + '=' + (own[k].input || 'NONE'));
    });
    expect(declared).toEqual([
      'antecedentNarrative=fAntecedent',
      'behaviorPlanNarrative=fBehavior',
    ]);

    // And every named box is a real input on the tool.
    const real = await page.evaluate(() => {
      const t = window.NOTE_TOOLS.find((x) => x.id === 'bt');
      const own = t.strategyOwnership.sections;
      return Object.keys(own).every((k) => t.inputs.some((f) => f.id === own[k].input));
    });
    expect(real).toBe(true);
  });
});

test.describe('the finding reaches the technician before the draft', () => {
  const setup = async (page, triage) => {
    await page.route('**/api/audit**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '{"stored":1}',
    }));
    await page.route('**/api/llm-call**', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}');
      if (isTriageCall(b)) {
        if (triage === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"nope"}' });
        return route.fulfill(reply(triage));
      }
      return route.fulfill(reply({ hints: [] }));
    });
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');
    await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, 8 of 10 gestural');
    await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('DRA alongside the token board');
    await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2, blocked');
    await page.getByRole('button', { name: 'Generate Note' }).click();
    const ack = page.locator('#notes-ack-go');
    if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.locator('#notes-ack-cb').check();
      await ack.click();
    }
  };

  test('opens the panel on the misplacement alone, when triage asks nothing', async ({ page }) => {
    /* The case that would otherwise be lost. handleGenerate goes straight to
       the draft when triage returns no questions, so a finding with nothing
       beside it has to be able to open the panel by itself. */
    await setup(page, { sufficient: true, readiness: 95, questions: [] });

    await expect(page.getByText(/Differential reinforcement of an alternative/i).first())
      .toBeVisible({ timeout: 15000 });
  });

  test('does not block the draft, which is the barrier that never gets raised', async ({ page }) => {
    await setup(page, { sufficient: true, readiness: 95, questions: [] });

    await expect(page.getByText(/Differential reinforcement of an alternative/i).first())
      .toBeVisible({ timeout: 15000 });
    // Generate anyway is reachable. The finding is a row, not a gate.
    await expect(page.getByRole('button', { name: /generate|skip|anyway/i }).first())
      .toBeEnabled({ timeout: 10000 });
  });
});

/* THE BARRIER THIS UPGRADE MUST NOT RAISE, and the one I raised writing it.

   Below a readiness of 85 the tool refuses to draft until one round is
   answered, which is his ruling of 2026-08-31 and is about the CONTENT of the
   note. Putting a finding into the same list handed that gate a question the
   technician cannot answer by improving their note, so a thin note plus a
   misfiled strategy could arrive with no skip button on screen at all: the
   reporting barrier, raised by a paperwork check. Same for the wait, which is
   longest exactly when triage told us nothing.

   A misfiled strategy says nothing about whether the note is thin. So the gate
   and the wait read the model's questions and ignore this one, and the two
   tests below are the pins. The third is the other side: a real question beside
   a finding still holds, because weakening his gate is not the fix. */
test.describe('a finding on its own never holds the draft back', () => {
  const setup = async (page, triage) => {
    await page.route('**/api/audit**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '{"stored":1}',
    }));
    await page.route('**/api/llm-call**', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}');
      if (isTriageCall(b)) {
        if (triage === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"nope"}' });
        return route.fulfill(reply(triage));
      }
      return route.fulfill(reply({ hints: [] }));
    });
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');
    await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, 8 of 10 gestural');
    await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('DRA alongside the token board');
    await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2, blocked');
    await page.getByRole('button', { name: 'Generate Note' }).click();
    const ack = page.locator('#notes-ack-go');
    if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.locator('#notes-ack-cb').check();
      await ack.click();
    }
    await expect(page.getByText(/Differential reinforcement of an alternative/i).first())
      .toBeVisible({ timeout: 15000 });
  };

  test('a thin note plus a finding still gets its skip button, with no wait on it', async ({ page }) => {
    // Readiness 40 is well under the bar, and triage itself asked nothing.
    await setup(page, { sufficient: true, readiness: 40, questions: [] });

    await expect(page.locator('[data-skip-held]')).toHaveCount(0);
    const skip = page.getByRole('button', { name: /generate anyway/i });
    await expect(skip).toBeVisible({ timeout: 5000 });
    await expect(skip).toBeEnabled();
  });

  test('and a triage that failed outright imposes no wait either', async ({ page }) => {
    /* The worst version: no reading at all, so skipSecondsFor would hand back
       the longest wait there is for a panel holding nothing but a regex match. */
    await setup(page, 'fail');

    await expect(page.locator('[data-skip-held]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /generate anyway/i })).toBeEnabled({ timeout: 5000 });
  });

  test('but a real question beside it still holds the gate, which is his ruling', async ({ page }) => {
    await setup(page, {
      sufficient: false,
      readiness: 40,
      questions: [{ field: 'fBehavior', question: 'How many times did the elopement happen?', suggestions: [], bar: 'B4' }],
    });

    await expect(page.locator('[data-skip-held]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /generate anyway/i })).toHaveCount(0);
  });
});
