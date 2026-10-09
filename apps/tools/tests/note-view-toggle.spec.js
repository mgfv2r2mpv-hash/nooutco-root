import { test, expect } from '@playwright/test';
import { captureClipboard } from './helpers/clipboard.js';
import { isTriageCall } from './helpers/llm-call.js';

/* PREVIEW OR RAW TEXT, ONE TOGGLE, REMEMBERED PER TOOL.
 *
 * His ask, 2 Oct 2026: switch the generated note between the formatted preview
 * and raw text he can edit by hand. Preview is the note as it has always drawn,
 * correction marks included. Raw text is each section as the plain text Copy
 * takes, and a narrative is a box he types in even where Preview draws marks.
 *
 * Every LLM call is intercepted. Nothing here reaches Anthropic, and the note
 * below is invented. */

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

const KEPT = 'Choices were offered before each demand.';
const NOTE = {
  individualsPresent: ['Client'],
  clinicalStatus: ['Presented Tired'],
  clinicalStatusNarrative: 'The client presented as tired on arrival.',
  purpose: ['Worked on goals as stated in the treatment plan'],
  servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'Choices were offered before each demand because the client dislikes transitions.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'Direct staff do not report new questions or concerns for the BCBA.',
  hints: [],
};
const CORRECTIONS = [{
  section: 'antecedentNarrative',
  text: KEPT,
  why: 'A causal claim the notes do not support.',
  reasons: [{ quote: 'because the client dislikes transitions', why: 'A causal claim about why.' }],
}];

async function stub(page, note = NOTE) {
  await page.route('**/api/llm-call**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(body)) return route.fulfill(reply({ sufficient: true, questions: [], readiness: 90 }));
    return route.fulfill(reply(note));
  });
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
  await page.route('**/api/corrections-pass**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ corrections: CORRECTIONS, dropped: 0, usage: { input_tokens: 10, output_tokens: 5 }, model: 'test' }),
    }));
}

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

async function draft(page, { inRaw = false, note = NOTE } = {}) {
  await stub(page, note);
  await page.goto('/notes/bt/');
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT 3-item array, full physical faded to independent');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected to FCR');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await acceptScrubGate(page);
  await expect(inRaw ? raw(page) : marks(page)).toBeVisible({ timeout: 30000 });
  const close = page.locator('.revision-panel-close');
  if (await close.isVisible({ timeout: 5000 }).catch(() => false)) await close.click();
}

const marks = (page, id = 'antecedentNarrative') => page.locator(`[data-corrections-section="${id}"]`);
const raw = (page, id = 'antecedentNarrative') => page.locator(`[data-raw-section="${id}"]`);
const viewBtn = (page, view) => page.locator(`[data-testid="note-view-toggle"] [data-note-view="${view}"]`);
const copyOf = async (page, id) => {
  await page.locator(`[data-section-key="${id}"]`).getByRole('button', { name: 'Copy', exact: true }).click();
  return page.evaluate(() => navigator.clipboard.readText());
};

test.beforeEach(async ({ page }) => {
  await captureClipboard(page);
  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
});

test('the note opens on Preview, with the marks drawn and one toggle in the header', async ({ page }) => {
  await draft(page);
  await expect(page.locator('[data-testid="note-view-toggle"]')).toHaveCount(1);
  await expect(viewBtn(page, 'preview')).toHaveAttribute('aria-pressed', 'true');
  await expect(viewBtn(page, 'raw')).toHaveAttribute('aria-pressed', 'false');
  await expect(raw(page)).toHaveCount(0);
});

test('raw text shows each section as exactly what Copy takes, and Preview brings the marks back', async ({ page }) => {
  await draft(page);
  await viewBtn(page, 'raw').click();
  await expect(marks(page)).toHaveCount(0);
  await expect(raw(page)).toHaveValue(KEPT);
  expect((await copyOf(page, 'antecedentNarrative')).trim()).toBe(KEPT);

  // A structured section is shown as its copy text, and is not a place to type.
  const ticks = raw(page, 'antecedentStrategies');
  await expect(ticks).toHaveAttribute('readonly', '');
  expect(await ticks.inputValue()).toBe(await copyOf(page, 'antecedentStrategies'));

  await viewBtn(page, 'preview').click();
  await expect(marks(page)).toBeVisible();
});

test('typing into a marked section in raw text puts its marks away, and the typing is what Copy takes', async ({ page }) => {
  await draft(page);
  await viewBtn(page, 'raw').click();
  const typed = 'Staff offered two choices before each demand.';
  await raw(page).fill(typed);
  expect((await copyOf(page, 'antecedentNarrative')).trim()).toBe(typed);

  await viewBtn(page, 'preview').click();
  await expect(marks(page)).toHaveCount(0);
  await expect(page.locator('textarea[data-section-id="antecedentNarrative"]')).toHaveValue(typed);
});

test('the choice is remembered per tool across a reload', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('nome:noteView:sup', 'raw'));
  await draft(page);
  // Another tool's choice does not carry over to this one.
  await expect(viewBtn(page, 'preview')).toHaveAttribute('aria-pressed', 'true');
  await viewBtn(page, 'raw').click();
  expect(await page.evaluate(() => localStorage.getItem('nome:noteView:bt'))).toBe('raw');

  await draft(page, { inRaw: true });
  await expect(viewBtn(page, 'raw')).toHaveAttribute('aria-pressed', 'true');
  await expect(raw(page)).toHaveValue(KEPT);
});

test('a stored value that is not a view opens on Preview', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('nome:noteView:bt', '<b>raw</b>'));
  await draft(page);
  await expect(viewBtn(page, 'preview')).toHaveAttribute('aria-pressed', 'true');
});

test('blocked storage still lets the toggle switch the view', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith('nome:noteView:')) throw new Error('blocked');
      return original.call(this, k, v);
    };
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await draft(page);
  await viewBtn(page, 'raw').click();
  await expect(raw(page)).toHaveValue(KEPT);
  expect(errors).toEqual([]);
});

/* The card's own list, 9 Oct 2026: the words typed in the put-back table show
   in Raw text exactly as Copy takes them, a hand edit there holds the word and
   stores the token, the toggle sends nothing, and the view fits a phone. */
const NAME = 'Samwise';
const WITH_TOKEN = { ...NOTE, followUpNarrative: 'Direct staff report no new questions about [CLIENT] for the BCBA.' };

test.describe('raw text and the put-back table', () => {
  test('a word typed in the put-back table shows in raw text, as Copy takes it', async ({ page }) => {
    await draft(page, { note: WITH_TOKEN });
    await page.getByTestId('put-back-input-[CLIENT]').fill(NAME);
    await viewBtn(page, 'raw').click();
    const box = raw(page, 'followUpNarrative');
    await expect(box).toHaveValue(`Direct staff report no new questions about ${NAME} for the BCBA.`);
    expect((await copyOf(page, 'followUpNarrative')).trim()).toBe(await box.inputValue());
  });

  test('an edit in raw text keeps the word on the page and in the copy, and switching back shows it', async ({ page }) => {
    await draft(page, { note: WITH_TOKEN });
    await page.getByTestId('put-back-input-[CLIENT]').fill(NAME);
    await viewBtn(page, 'raw').click();
    const typed = `${NAME} asked for a break twice and staff honored both.`;
    await raw(page, 'followUpNarrative').fill(typed);
    expect((await copyOf(page, 'followUpNarrative')).trim()).toBe(typed);

    await viewBtn(page, 'preview').click();
    await expect(page.locator('textarea[data-section-id="followUpNarrative"]')).toHaveValue(typed);

    // A blank put-back field shows the token again, so the note itself kept the token.
    await page.getByTestId('put-back-input-[CLIENT]').fill('');
    await viewBtn(page, 'raw').click();
    await expect(raw(page, 'followUpNarrative')).toHaveValue('[CLIENT] asked for a break twice and staff honored both.');
  });
});

test('switching views sends nothing', async ({ page }) => {
  await draft(page);
  // networkidle never settles here (a connection stays open), so let the draft's
  // own calls finish, then count only what the toggling starts.
  await page.waitForTimeout(1000);
  const sent = [];
  page.on('request', (r) => { if (!r.url().startsWith('data:')) sent.push(r.method() + ' ' + r.url()); });
  await viewBtn(page, 'raw').click();
  await expect(raw(page)).toHaveValue(KEPT);
  await viewBtn(page, 'preview').click();
  await expect(marks(page)).toBeVisible();
  await viewBtn(page, 'raw').click();
  await page.waitForTimeout(500);
  expect(sent).toEqual([]);
});

test('at phone width both views fit with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await draft(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await viewBtn(page, 'raw').click();
  await expect(raw(page)).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  for (const view of ['preview', 'raw']) {
    const b = await viewBtn(page, view).boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(375);
  }
  const box = await raw(page).boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(375);

  // Every raw box shows all of its text at this width: a short box that wraps
  // would hide the end of a field he is about to copy.
  const clipped = await page.locator('[data-raw-section]').evaluateAll((els) =>
    els.filter((el) => el.scrollHeight > el.clientHeight + 1).map((el) => el.dataset.rawSection));
  expect(clipped).toEqual([]);
});
