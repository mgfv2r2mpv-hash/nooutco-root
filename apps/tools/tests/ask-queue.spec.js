import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* THE QUEUE: ask for a change where it sits, send them all in one move.
 *
 * His complaint, 2026-09-20, against a screenshot of the corrections view: the
 * same sentence was drawn twice, struck in red and again in green, and "it is
 * hard to tell visually what will be in the text buffer".
 *
 * Every test in this file is a way of asking the same question. Nothing whose
 * words are absent from the note may draw those words inside the box, and
 * nothing the box draws may fail to reach the clipboard.
 *
 * THE WATERMARK. His ruling: "I used [] to represent a tall narrow watermark
 * without any characters to make sure that nothing looks (or does) copy out."
 * Two separate paths can carry a character out of this page and both are
 * pinned below, because they fail independently:
 *
 *   1. textContent, which is what the Copy button reads
 *   2. a drag-selection, which is what a technician does with a mouse
 *
 * A marker with user-select:none passes (2) and fails (1), which is the trap
 * this file exists to keep anyone from walking into. A marker with no text
 * node passes both.
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

const MOVED = 'Staff redirected neutrally to the functional communication response and reinforced the alternative.';
const CUT = 'Choices were offered before each demand because the client dislikes transitions.';
const KEPT = 'Choices were offered before each demand.';

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
    antecedentNarrative: CUT + ' ' + MOVED,
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

/* The pass does three different things at once, on purpose, because the point
   of this file is that they can all be drawn in one paragraph without any of
   them appearing twice:
     - a REMOVAL: the causal clause about disliking transitions goes
     - an ADDITION: an outcome the notes support arrives
     - a MOVE: the response strategy leaves antecedent for behaviour plan */
const CORRECTIONS = [
  {
    section: 'antecedentNarrative',
    text: KEPT,
    why: 'A response strategy is misfiled, and a causal claim is not supported.',
    reasons: [
      { quote: 'because the client dislikes transitions', why: 'A causal claim about why, which the notes do not support.' },
    ],
  },
  {
    section: 'behaviorPlanNarrative',
    text: 'Elopement occurred on two occasions. ' + MOVED + ' Episodes ended once the alternative was reinforced.',
    why: 'You wrote that episodes ended once the alternative was reinforced.',
    reasons: [
      { quote: 'Episodes ended once the alternative was reinforced', why: 'You wrote this in your own notes.' },
    ],
  },
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

async function fillRequiredAndGenerate(page) {
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT 3-item array, full physical faded to independent');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i })
    .fill('elopement, blocked and redirected to FCR, episodes ended once the alternative was reinforced');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await acceptScrubGate(page);
}

async function stub(page, { corrections = CORRECTIONS } = {}) {
  await page.route('**/api/llm-call**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(body)) return route.fulfill(reply({ sufficient: true, questions: [], readiness: 90 }));
    return route.fulfill(reply(note()));
  });
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
  await page.route('**/api/corrections-pass**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ corrections, dropped: 0, usage: { input_tokens: 10, output_tokens: 5 }, model: 'test' }),
    }));
}

/* Capturing the write rather than reading the real clipboard, because
   grantPermissions throws on firefox and webkit. The page still takes its
   normal path: engine.jsx calls navigator.clipboard.writeText and nothing
   else. See changes-drawer.spec.js for the history of that. */
const captureClipboard = (page) => page.addInitScript(() => {
  const written = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text) => { written.push(String(text)); return Promise.resolve(); },
      readText: () => Promise.resolve(written.length ? written[written.length - 1] : ''),
    },
  });
});

const collapse = async (page) => {
  const close = page.locator('.revision-panel-close');
  if (await close.isVisible({ timeout: 5000 }).catch(() => false)) await close.click();
  await expect(page.locator('.revision-fab')).toBeVisible({ timeout: 10000 });
};

const view = (page, id = 'antecedentNarrative') => page.locator(`[data-corrections-section="${id}"]`);
const rail = (page, id = 'antecedentNarrative') => page.locator(`[data-corrections-rail="${id}"]`);

const copied = async (page, section = 'antecedentNarrative') => {
  await collapse(page);
  await page.locator(`[data-section-key="${section}"]`).getByRole('button', { name: 'Copy', exact: true }).click();
  return page.evaluate(() => navigator.clipboard.readText());
};

/* What a mouse would take. selectNodeContents over the box, then read the
   selection back, which is the same path a drag and a Cmd-C take. */
const dragSelected = (page, id = 'antecedentNarrative') => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  const r = document.createRange();
  r.selectNodeContents(el);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  const out = s.toString();
  s.removeAllRanges();
  return out;
}, `[data-corrections-section="${id}"]`);

test.beforeEach(async ({ page }) => {
  await captureClipboard(page);
  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
});

/* Every corrections call is recorded, so a test can ask what the SEND actually
   carried rather than only what the screen shows afterwards. */
async function stubSeen(page, seen, { second = CORRECTIONS } = {}) {
  await page.route('**/api/llm-call**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(body)) return route.fulfill(reply({ sufficient: true, questions: [], readiness: 90 }));
    return route.fulfill(reply(note()));
  });
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
  await page.route('**/api/corrections-pass**', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    seen.push(body);
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        corrections: seen.length === 1 ? CORRECTIONS : second,
        dropped: 0, usage: { input_tokens: 10, output_tokens: 5 }, model: 'test',
      }),
    });
  });
}

const askOn = async (page, section, what) => {
  const chg = page.locator(`[data-corrections-section="${section}"] [data-correction-type="ins"]`).first();
  await chg.click();
  await page.locator('[data-correction-ask]').first().click();
  await page.locator('[data-correction-ask-input]').first().fill(what);
  await page.locator('[data-correction-ask-save]').first().click();
};

test.describe('asking for a change queues it, and queuing sends nothing', () => {
  test('the ask appears under the section it is about', async ({ page }) => {
    const seen = [];
    await stubSeen(page, seen);
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-section="behaviorPlanNarrative"]')).toBeVisible({ timeout: 30000 });

    await askOn(page, 'behaviorPlanNarrative', 'say it in one sentence');
    await expect(page.locator('[data-corrections-asks="behaviorPlanNarrative"]')).toContainText('say it in one sentence');
  });

  test('NOTHING LEAVES THE PAGE UNTIL SEND, which is the whole point of a queue', async ({ page }) => {
    const seen = [];
    await stubSeen(page, seen);
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-section="behaviorPlanNarrative"]')).toBeVisible({ timeout: 30000 });
    expect(seen.length, 'the drafting pass').toBe(1);

    await askOn(page, 'behaviorPlanNarrative', 'say it in one sentence');
    await askOn(page, 'antecedentNarrative', 'shorter please');
    // Two asks, still one call: the drafting pass and nothing since.
    expect(seen.length).toBe(1);
  });

  test('Drop takes one off the queue', async ({ page }) => {
    const seen = [];
    await stubSeen(page, seen);
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-section="behaviorPlanNarrative"]')).toBeVisible({ timeout: 30000 });

    await askOn(page, 'behaviorPlanNarrative', 'say it in one sentence');
    await page.locator('[data-correction-ask-drop]').first().click();
    await expect(page.locator('[data-corrections-asks="behaviorPlanNarrative"]')).toHaveCount(0);
  });
});

test.describe('the Send is in the panel, and it spends the whole note at once', () => {
  test('THE SEND IS NOT UNDER A SECTION. It is in the Ask NoMe panel, which is his ruling', async ({ page }) => {
    const seen = [];
    await stubSeen(page, seen);
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-section="behaviorPlanNarrative"]')).toBeVisible({ timeout: 30000 });

    await askOn(page, 'behaviorPlanNarrative', 'say it in one sentence');
    // Nothing that sends sits inside the note.
    await expect(page.locator('[data-corrections-asks] [data-panel-ask-send]')).toHaveCount(0);
    await expect(page.locator('[data-corrections-section] [data-panel-ask-send]')).toHaveCount(0);
    // And exactly one thing that sends sits in the panel.
    await expect(page.locator('[data-panel-ask-send]')).toHaveCount(1);
  });

  test('two asks in two sections cost ONE turn, not two', async ({ page }) => {
    const seen = [];
    await stubSeen(page, seen);
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-section="behaviorPlanNarrative"]')).toBeVisible({ timeout: 30000 });

    await askOn(page, 'behaviorPlanNarrative', 'say it in one sentence');
    await askOn(page, 'antecedentNarrative', 'shorter please');
    await expect(page.locator('[data-panel-asks="2"]')).toBeVisible();

    await page.locator('[data-panel-ask-send]').click();
    await expect.poll(() => seen.length, { timeout: 20000 }).toBe(2);

    const sent = seen[1];
    expect(sent.asks.length, 'both asks in one turn').toBe(2);
    expect(sent.asks.map((a) => a.id).sort()).toEqual(['antecedentNarrative', 'behaviorPlanNarrative']);
    // Each ask quotes the wording it is about, because the model has never seen
    // a mark and cannot be handed an index into one.
    expect(sent.asks.every((a) => typeof a.about === 'string' && a.about.length > 0)).toBe(true);
  });

  test('the queue empties once it has been sent', async ({ page }) => {
    const seen = [];
    await stubSeen(page, seen);
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-section="behaviorPlanNarrative"]')).toBeVisible({ timeout: 30000 });

    await askOn(page, 'behaviorPlanNarrative', 'say it in one sentence');
    await page.locator('[data-panel-ask-send]').click();
    await expect.poll(() => seen.length, { timeout: 20000 }).toBe(2);
    await expect(page.locator('[data-panel-ask-send]')).toHaveCount(0);
  });
});

test.describe('what the technician took out stays out', () => {
  /* HIS THIRD RULING. Without this the pass re-proposes what they already
     overruled, they overrule it again, and the ledger records a disagreement
     the tool manufactured. It has to outlive markState, because a send rebuilds
     the marks from nothing. */
  test('an addition they took out is named in the send as held out', async ({ page }) => {
    const seen = [];
    await stubSeen(page, seen);
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-section="behaviorPlanNarrative"]')).toBeVisible({ timeout: 30000 });

    const added = page.locator('[data-corrections-section="behaviorPlanNarrative"] [data-correction-type="ins"]').first();
    await added.click();
    await page.getByRole('button', { name: 'Take it out' }).click();

    await askOn(page, 'antecedentNarrative', 'shorter please');
    await page.locator('[data-panel-ask-send]').click();
    await expect.poll(() => seen.length, { timeout: 20000 }).toBe(2);

    const held = seen[1].heldOut;
    expect(held.length).toBeGreaterThan(0);
    expect(held.some((h) => /Episodes ended once the alternative was reinforced/.test(h.text))).toBe(true);
  });

  /* THE MOVE PAIR IS THE ONE THAT READS AS AN ADDITION AND IS NOT. Undoing a
     move leaves the destination contributing nothing, which looks exactly like
     a declined addition in markState. But the sentence is not gone: it is back
     at its origin and still in the note, so holding it out would ask the pass
     to delete it from there. */
  test('an UNDONE MOVE is not held out, because the sentence is back at its origin', async ({ page }) => {
    const seen = [];
    await stubSeen(page, seen);
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-section="behaviorPlanNarrative"]')).toBeVisible({ timeout: 30000 });

    const moved = page.locator('[data-correction-type="move-in"]').first();
    await moved.click();
    await page.getByRole('button', { name: 'Take it out' }).click();

    await askOn(page, 'behaviorPlanNarrative', 'say it in one sentence');
    await page.locator('[data-panel-ask-send]').click();
    await expect.poll(() => seen.length, { timeout: 20000 }).toBe(2);

    const held = seen[1].heldOut || [];
    expect(held.some((h) => /functional communication response/.test(h.text))).toBe(false);
  });

  test('a REMOVAL they restored is not held out, because that is their own wording', async ({ page }) => {
    const seen = [];
    await stubSeen(page, seen);
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-rail]').first()).toBeVisible({ timeout: 30000 });

    // Restoring a removal is the opposite decision: they KEPT their sentence.
    // Holding it out would tell the pass to delete what they just rescued.
    await page.locator('[data-corrections-cut]').first().getByRole('button', { name: /Restore/ }).click();

    await askOn(page, 'behaviorPlanNarrative', 'say it in one sentence');
    await page.locator('[data-panel-ask-send]').click();
    await expect.poll(() => seen.length, { timeout: 20000 }).toBe(2);

    const held = seen[1].heldOut || [];
    expect(held.some((h) => /dislikes transitions/.test(h.text))).toBe(false);
  });
});
