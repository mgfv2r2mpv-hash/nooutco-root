import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The corrections pass, on a real note, through the real engine.
 *
 * WHAT THIS PINS THAT THE UNIT TESTS CANNOT. The marks module can be right
 * about what a section reads like and the tool can still ship the draft: the
 * pass has to run on the drafting path, its answer has to reach S.output before
 * the technician sees anything, and the mark has to be drawn in the colour that
 * means what happened. His ruling of 1 September 2026 is the last of those and
 * it is the one worth stating: BLUE at both ends of a move, with a light
 * strikethrough where the sentence left. Red means gone, and a move is not.
 *
 * Every LLM call is intercepted. Nothing here reaches Anthropic.
 */

function tokenFor(role = 'user', tools = ['bt']) {
  const payload = { role, kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
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

const MISFILED = 'Staff redirected neutrally to the functional communication response and reinforced the alternative.';

function note(overrides = {}) {
  return {
    individualsPresent: ['Client'],
    clinicalStatus: ['Presented Tired'],
    clinicalStatusNarrative: 'The client presented as tired on arrival.',
    purpose: ['Worked on goals as stated in the treatment plan'],
    servicePaused: 'No',
    abaTechniques: ['Discrete Trial Training'],
    lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
    antecedentStrategies: ['Offered choices'],
    antecedentNarrative: 'Choices were offered before each demand. ' + MISFILED,
    consequenceStrategies: ['Redirection'],
    consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
    behaviorPlanNarrative: 'Elopement occurred on two occasions.',
    clientProgress: 'Steady progress towards goals and behaviors',
    actionItems: ['None'],
    followUpNarrative: 'Direct staff do not report new questions or concerns for the BCBA.',
    hints: [],
    ...overrides,
  };
}

// The pass moves the misfiled response strategy out of antecedent and into
// behaviour plan progress, and adds an outcome the notes support.
const CORRECTIONS = [
  {
    section: 'antecedentNarrative',
    text: 'Choices were offered before each demand.',
    why: 'A response strategy is misfiled under antecedent.',
  },
  {
    section: 'behaviorPlanNarrative',
    text: 'Elopement occurred on two occasions. ' + MISFILED + ' Episodes ended once the alternative was reinforced.',
    why: 'You wrote that episodes ended once the alternative was reinforced.',
  },
];

/* The note's own textarea for one section. Located by the attribute the
   selection handler already relies on rather than by an accessible name: these
   boxes are labelled by the section heading beside them, not by an aria-label,
   so a role query finds nothing. */
const sectionBox = (page, id) => page.locator(`textarea[data-section-id="${id}"]`);

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

async function fillRequiredAndGenerate(page) {
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT 3-item array, full physical faded to independent');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i })
    .fill('elopement, blocked and redirected to FCR, episodes ended once the alternative was reinforced');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await acceptScrubGate(page);
}

/* Route everything the drafting path calls. The corrections route answers from
   `corrections`, which a test can set to [] to say "the pass found nothing". */
async function stub(page, { corrections = CORRECTIONS, seen = null } = {}) {
  await page.route('**/api/llm-call**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(body)) return route.fulfill(reply({ sufficient: true, questions: [], readiness: 90 }));
    return route.fulfill(reply(note()));
  });
  // The expert pass writes a panel beside the note and is not what is under
  // test here. Answered rather than blocked, so a failure of it cannot be
  // mistaken for a failure of this.
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
  await page.route('**/api/corrections-pass**', async (route) => {
    if (seen) seen.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ corrections, dropped: 0, usage: { input_tokens: 10, output_tokens: 5 }, model: 'test' }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
});

test.describe('the pass runs on the drafting path', () => {
  test('it is sent the DRAFT, not only the intake', async ({ page }) => {
    const seen = [];
    await stub(page, { seen });
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-section]').first()).toBeVisible({ timeout: 20000 });

    expect(seen.length, 'the corrections route was never called').toBe(1);
    const ids = seen[0].draft.map((d) => d.id);
    expect(ids).toContain('antecedentNarrative');
    expect(ids).toContain('behaviorPlanNarrative');
    // The draft text, not a summary of it: the pass returns whole sections and
    // can only do that if it was given whole sections.
    const antecedent = seen[0].draft.find((d) => d.id === 'antecedentNarrative');
    expect(antecedent.text).toContain('Choices were offered before each demand.');
    expect(seen[0].intake).toBeTruthy();
  });

  test('THE CORRECTION IS IN THE NOTE BEFORE ANYONE CLICKS ANYTHING', async ({ page }) => {
    // His ruling: doing nothing ships all of it. A pass that waited for a click
    // would look identical on screen and ship a different note.
    await stub(page);
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-section]').first()).toBeVisible({ timeout: 20000 });

    // Read the note itself rather than the marks drawn over it. "Edit by hand"
    // puts the section back as a textarea without undoing anything, so its
    // value is exactly what the technician would copy.
    await page.locator('[data-corrections-done="behaviorPlanNarrative"]').click();
    await expect(sectionBox(page, 'behaviorPlanNarrative'))
      .toHaveValue(/Episodes ended once the alternative was reinforced/);
  });

  test('?corrections=off leaves the draft exactly as the model wrote it', async ({ page }) => {
    // The escape hatch matters more here than on the expert pass, because this
    // one edits the note: "show me what the model actually wrote" has to stay
    // one query parameter away.
    let called = false;
    await stub(page);
    await page.route('**/api/corrections-pass**', (route) => {
      called = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: CORRECTIONS }) });
    });
    await page.goto('/notes/bt/?corrections=off');
    await fillRequiredAndGenerate(page);
    await expect(sectionBox(page, 'antecedentNarrative')).toBeVisible({ timeout: 20000 });

    expect(called).toBe(false);
    await expect(page.locator('[data-corrections-section]')).toHaveCount(0);
  });

  test('a pass that finds nothing leaves an ordinary editable note', async ({ page }) => {
    await stub(page, { corrections: [] });
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(sectionBox(page, 'antecedentNarrative')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-corrections-section]')).toHaveCount(0);
  });
});

test.describe('how a move is drawn', () => {
  test.beforeEach(async ({ page }) => {
    await stub(page);
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-section]').first()).toBeVisible({ timeout: 20000 });
  });

  test('BOTH ENDS ARE BLUE, AND THE ORIGIN IS STRUCK THROUGH RATHER THAN RED', async ({ page }) => {
    const out = page.locator('[data-correction-type="move-out"]');
    const into = page.locator('[data-correction-type="move-in"]');
    await expect(out).toHaveCount(1);
    await expect(into).toHaveCount(1);

    const paint = await page.evaluate(() => {
      const read = (el) => {
        const s = getComputedStyle(el);
        return { color: s.color, line: s.textDecorationLine };
      };
      return {
        out: read(document.querySelector('[data-correction-type="move-out"]')),
        in: read(document.querySelector('[data-correction-type="move-in"]')),
      };
    });

    // Blue at both ends: more blue than red in each. Measured on the channel
    // rather than on a class name, so a stylesheet that stops meaning what it
    // says fails here instead of passing on the selector alone.
    for (const end of ['out', 'in']) {
      const [r, g, b] = paint[end].color.match(/\d+/g).map(Number);
      expect(b, `the ${end} end of the move is not blue`).toBeGreaterThan(r + 20);
      expect(b, `the ${end} end of the move is not blue`).toBeGreaterThan(g + 20);
    }
    // And the origin says the sentence is not sitting in two places.
    expect(paint.out.line).toContain('line-through');
    expect(paint.in.line).not.toContain('line-through');
  });

  test('the destination carries a dot back to where the sentence came from', async ({ page }) => {
    const dot = page.locator('[data-correction-origin="antecedentNarrative"]');
    await expect(dot).toHaveCount(1);
    await dot.click();
    await expect(page.locator('[data-section-key="antecedentNarrative"]')).toHaveClass(/cx-flash/);
  });

  test('UNDOING ONE END UNDOES BOTH, so the sentence is never in two places', async ({ page }) => {
    const outKey = await page.locator('[data-correction-type="move-out"]').getAttribute('data-correction');
    await page.locator(`[data-correction-tick="${outKey}"]`).click();
    await page.locator(`[data-correction-undo="${outKey}"]`).click();

    await expect(page.locator('[data-correction-type="move-out"]')).toHaveAttribute('data-correction-reverted', 'true');
    await expect(page.locator('[data-correction-type="move-in"]')).toHaveAttribute('data-correction-reverted', 'true');

    // The marks still DRAW the undone text at both ends, so what is asserted
    // here is the note itself. "Edit by hand" hands back the real value.
    await page.locator('[data-corrections-done="antecedentNarrative"]').click();
    await page.locator('[data-corrections-done="behaviorPlanNarrative"]').click();
    await expect(sectionBox(page, 'antecedentNarrative'))
      .toHaveValue(/functional communication response/);
    await expect(sectionBox(page, 'behaviorPlanNarrative'))
      .not.toHaveValue(/functional communication response/);
  });
});

test.describe('acting on a mark', () => {
  test.beforeEach(async ({ page }) => {
    await stub(page);
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-section]').first()).toBeVisible({ timeout: 20000 });
  });

  test('the resting state is one ghosted tick, and the controls arrive on a click', async ({ page }) => {
    const ins = page.locator('[data-correction-type="ins"]').first();
    const key = await ins.getAttribute('data-correction');
    // Nothing but the tick until it is asked for: a dozen visible button pairs
    // would make a note read as a form.
    await expect(page.locator(`[data-correction-undo="${key}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-correction-pencil="${key}"]`)).toHaveCount(0);

    await page.locator(`[data-correction-tick="${key}"]`).click();
    await expect(page.locator(`[data-correction-undo="${key}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-correction-pencil="${key}"]`)).toHaveCount(1);
  });

  test('the pencil rewords what ships without undoing it', async ({ page }) => {
    const key = await page.locator('[data-correction-type="ins"]').first().getAttribute('data-correction');
    await page.locator(`[data-correction-tick="${key}"]`).click();
    await page.locator(`[data-correction-pencil="${key}"]`).click();
    const box = page.locator(`[data-correction-edit="${key}"]`);
    await expect(box).toBeVisible();
    await box.fill(' Episodes ended quickly.');
    await page.locator(`[data-correction-save="${key}"]`).click();

    await expect(page.locator(`[data-correction="${key}"]`)).toContainText('Episodes ended quickly.');
    await expect(page.locator(`[data-correction="${key}"]`)).toHaveAttribute('data-correction-reverted', 'false');
  });

  test('"Edit by hand" gives the section back as a textarea and undoes nothing', async ({ page }) => {
    await page.locator('[data-corrections-done="behaviorPlanNarrative"]').click();
    const box = sectionBox(page, 'behaviorPlanNarrative');
    await expect(box).toBeVisible();
    await expect(box).toHaveValue(/Episodes ended once the alternative was reinforced/);
    // Only that section. A control sitting inside one section that cleared the
    // marks in three others would be lying about what it does.
    await expect(page.locator('[data-corrections-section="antecedentNarrative"]')).toHaveCount(1);
  });
});
