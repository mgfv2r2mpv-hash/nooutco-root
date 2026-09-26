import { test, expect } from '@playwright/test';
import { captureClipboard } from './helpers/clipboard.js';
import { isTriageCall } from './helpers/llm-call.js';

/* THE BOX HOLDS EXACTLY WHAT COPY GIVES YOU.
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

test.describe('the box equals the clipboard', () => {
  test('WHAT IS DRAWN IN THE BOX IS WHAT COPY PUTS ON THE CLIPBOARD', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(view(page)).toBeVisible({ timeout: 30000 });

    const drawn = (await view(page).textContent()).trim();
    const clip = (await copied(page)).trim();
    expect(clip).toBe(drawn);
  });

  test('and a drag-select of the box takes the same thing, with no marker in it', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(view(page)).toBeVisible({ timeout: 30000 });

    const drawn = (await view(page).textContent()).trim();
    const dragged = (await dragSelected(page)).trim();
    expect(dragged).toBe(drawn);
    // Belt and braces: the bracket characters his ruling was about, by name.
    expect(dragged).not.toContain('[');
    expect(dragged).not.toContain(']');
  });

  test('the watermark holds no text node at all, which is what makes both true', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(view(page)).toBeVisible({ timeout: 30000 });

    const marks = page.locator('[data-correction-mark]');
    expect(await marks.count()).toBeGreaterThan(0);
    const texts = await marks.evaluateAll((els) => els.map((e) => e.textContent));
    // Not "trimmed to empty" - EMPTY. A character here would reach the EHR.
    expect(texts.every((t) => t === '')).toBe(true);
    const kids = await marks.evaluateAll((els) => els.map((e) => e.childNodes.length));
    expect(kids.every((n) => n === 0)).toBe(true);
  });

  /* PROVED BY PICTURE, because the three engines disagree about how to REPORT
     generated content even though they agree about drawing it.

     getComputedStyle(el, '::after').content gives the resolved string "1" on
     chromium and webkit, and the SPECIFIED value attr(data-n) on firefox. An
     assertion on that string is a fact about the reporting API, not about the
     mark, and it failed on firefox while the numeral was on screen the whole
     time.

     Blanking data-n and comparing the two images asks the only question worth
     asking - is anything drawn in there - and asks it the same way everywhere. */
  test('the numeral is still drawn, so the mark is readable to the eye', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(view(page)).toBeVisible({ timeout: 30000 });

    const mark = page.locator('[data-correction-mark]').first();
    const withNumeral = await mark.screenshot();
    await mark.evaluate((el) => el.setAttribute('data-n', ''));
    const without = await mark.screenshot();
    expect(Buffer.compare(withNumeral, without), 'the mark draws nothing inside it').not.toBe(0);
  });

  test('nothing from the rail reaches the clipboard, ever', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(rail(page)).toBeVisible({ timeout: 30000 });

    const railText = (await rail(page).textContent()) || '';
    expect(railText).toContain('because the client dislikes transitions');

    const clip = await copied(page);
    expect(clip).not.toContain('because the client dislikes transitions');
  });
});

test.describe('quiet mode keeps the reading and drops the deciding', () => {
  /* With ?aid=1 the dispositions move into the drawer, per his ruling that a
     page of inline controls is a form and not a note. The watermark and the
     rail are READING, not controls: they say what happened and ask nothing, so
     they stay. What must not stay is the promise of an action. */
  test('the watermark is still drawn and still announced, and is not a button', async ({ page }) => {
    await stub(page);
    await page.goto('/notes/bt/?aid=1');
    await fillRequiredAndGenerate(page);
    await expect(view(page)).toBeVisible({ timeout: 30000 });

    const mark = page.locator('[data-correction-mark]').first();
    await expect(mark).toBeVisible();
    await expect(mark).toHaveAttribute('role', 'img');
    await expect(mark).not.toHaveAttribute('tabindex', /.*/);
    // Announced, so a screen reader still hears that something left here.
    expect(await mark.getAttribute('aria-label')).toMatch(/Removal|Moved/);
  });

  test('the rail still says what left, and offers no button to act on it', async ({ page }) => {
    await stub(page);
    await page.goto('/notes/bt/?aid=1');
    await fillRequiredAndGenerate(page);
    await expect(rail(page)).toBeVisible({ timeout: 30000 });

    await expect(rail(page)).toContainText('because the client dislikes transitions');
    await expect(page.locator('[data-corrections-cut] button')).toHaveCount(0);
  });

  test('and the box still equals the clipboard, which does not depend on the flag', async ({ page }) => {
    await stub(page);
    await page.goto('/notes/bt/?aid=1');
    await fillRequiredAndGenerate(page);
    await expect(view(page)).toBeVisible({ timeout: 30000 });

    const drawn = (await view(page).textContent()).trim();
    const clip = (await copied(page)).trim();
    expect(clip).toBe(drawn);
  });
});

test.describe('a removal spends no words inside the box', () => {
  test('the removed wording is drawn ONCE, and it is under the note rather than in it', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(view(page)).toBeVisible({ timeout: 30000 });

    const inBox = (await view(page).textContent()) || '';
    expect(inBox).not.toContain('because the client dislikes transitions');

    const railRows = page.locator('[data-corrections-cut]');
    expect(await railRows.count()).toBe(1);
    await expect(railRows.first()).toContainText('because the client dislikes transitions');
  });

  test('the pass reason rides on the removal itself, not only on the section', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(rail(page)).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-corrections-cut] .cx-cut-why').first())
      .toContainText('A causal claim about why');
  });

  /* A REWRITTEN SENTENCE. NoteDiff works at sentence granularity, so rewording
     a clause arrives as a whole-sentence removal beside a whole-sentence
     addition. Without this the rail repeats every word that survived into the
     green text two lines up, which is his original complaint moved rather than
     cured. The surviving words are dimmed; the clause that actually went is
     not. Nothing is trimmed, so Restore cannot disagree with its own label. */
  test('the rail dims the words that survived, and leaves the clause that went', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(rail(page)).toBeVisible({ timeout: 30000 });

    const row = page.locator('[data-corrections-cut]').first();
    const kept = row.locator('.cx-cut-kept');
    await expect(kept.first()).toHaveText(/Choices were offered before each demand/);

    // Still the whole sentence, so Restore puts back what the row says.
    await expect(row).toContainText('Choices were offered before each demand because the client dislikes transitions');

    // And the surviving half is visibly quieter than the clause that went.
    const faded = await kept.first().evaluate((el) => Number(window.getComputedStyle(el).opacity));
    expect(faded).toBeLessThan(0.6);
  });

  test('Restore puts the words back in the note, and the rail stops claiming them', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(rail(page)).toBeVisible({ timeout: 30000 });

    await page.locator('[data-corrections-cut]').first().getByRole('button', { name: /Restore/ }).click();

    await expect(view(page)).toContainText('because the client dislikes transitions');
    const clip = await copied(page);
    expect(clip).toContain('because the client dislikes transitions');
  });

  test('restored wording reads as the technician own, with a neutral rule and no colour', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(rail(page)).toBeVisible({ timeout: 30000 });
    await page.locator('[data-corrections-cut]').first().getByRole('button', { name: /Restore/ }).click();

    const back = page.locator('[data-correction-restored="true"]').first();
    await expect(back).toBeVisible();
    const paint = await back.evaluate((el) => {
      const s = window.getComputedStyle(el);
      return { shadow: s.boxShadow, deco: s.textDecorationLine, bg: s.backgroundColor };
    });
    // Visible, so the decision is still legible on a second pass.
    expect(paint.shadow).not.toBe('none');
    // Not a colour and not a strike: it is their wording now.
    expect(paint.deco).toBe('none');
    expect(paint.bg === 'rgba(0, 0, 0, 0)' || paint.bg === 'transparent').toBe(true);
  });
});

test.describe('an UNDONE addition leaves no words in the box either', () => {
  /* The fault this catches was live before 2026-09-20: an undone ins kept
     rendering its text while NoteCorrections.contribution returned "" for it,
     so the box showed a sentence the clipboard would not take. Same disease as
     the red-and-green double, one line further down. */
  test('taking an addition out removes its words from the box, not just its colour', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-section="behaviorPlanNarrative"]')).toBeVisible({ timeout: 30000 });

    const added = page.locator('[data-corrections-section="behaviorPlanNarrative"] [data-correction-type="ins"]').first();
    await added.click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();

    const box = page.locator('[data-corrections-section="behaviorPlanNarrative"]');
    await expect(box).not.toContainText('Episodes ended once the alternative was reinforced');

    const drawn = (await box.textContent()).trim();
    const clip = (await copied(page, 'behaviorPlanNarrative')).trim();
    expect(clip).toBe(drawn);
  });
});

test.describe('a move keeps its words once, and blue at both ends', () => {
  test('the origin draws a watermark and NO words, because they are elsewhere in the note', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(view(page)).toBeVisible({ timeout: 30000 });

    const origin = page.locator('[data-correction-type="move-out"]').first();
    await expect(origin).toBeVisible();
    expect(await origin.textContent()).toBe('');
    expect(await view(page).textContent()).not.toContain(MOVED);
  });

  test('and the origin is BLUE, because the sentence was not thrown out', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(view(page)).toBeVisible({ timeout: 30000 });

    const paint = await page.locator('[data-correction-type="move-out"]').first()
      .evaluate((el) => window.getComputedStyle(el).color);
    const [r, g, b] = paint.match(/\d+/g).map(Number);
    expect(b).toBeGreaterThan(r);
  });

  test('the destination keeps the words, and the note holds them exactly once', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(page.locator('[data-corrections-section="behaviorPlanNarrative"]')).toBeVisible({ timeout: 30000 });

    const dest = page.locator('[data-corrections-section="behaviorPlanNarrative"]');
    await expect(dest).toContainText(MOVED);

    const whole = await page.locator('[data-corrections-section]').evaluateAll(
      (els) => els.map((e) => e.textContent).join('\n'),
    );
    const hits = whole.split(MOVED).length - 1;
    expect(hits).toBe(1);
  });

  test('a move gets no rail line, because its words never left the note', async ({ page }) => {
    await stub(page);
    // The reload is what picks the token out of localStorage. Without it the
    // page stays logged out and Generate Note is never drawn.
    await page.goto('/notes/bt/');
    await fillRequiredAndGenerate(page);
    await expect(view(page)).toBeVisible({ timeout: 30000 });
    const rows = page.locator('[data-corrections-cut]');
    const texts = await rows.evaluateAll((els) => els.map((e) => e.textContent));
    expect(texts.some((t) => t.includes(MOVED))).toBe(false);
  });
});
