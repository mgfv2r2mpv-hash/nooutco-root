import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* THE DELETIONS RAIL, three icons per row.
 *
 * Restore (undo arrow), tell NoMe about it (pencil, queues an ask), dismiss
 * (check, collapses the row into a strip at the top of the rail). The strip
 * counts dismissals, and its popover reopens a row. Icons live in the rail,
 * outside the box, so what Copy gives never changes.
 *
 * Every model call is stubbed. Names and sentences are invented.
 */

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const KEEP = ['Blocks were offered first.', 'Choices followed each request.', 'A timer marked the break.', 'The client returned to the table.'];
const CUT = ['Staff felt the plan was working well.', 'The room was noisy during the break.', 'Lunch had been late that day.'];
const DRAFT = [KEEP[0], CUT[0], KEEP[1], CUT[1], KEEP[2], CUT[2], KEEP[3]].join(' ');
const REVISED = KEEP.join(' ');

const note = () => ({
  individualsPresent: ['Client'], clinicalStatus: ['Presented Tired'],
  clinicalStatusNarrative: 'The client presented as tired on arrival today.',
  purpose: ['Worked on goals as stated in the treatment plan'], servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: DRAFT,
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions during the session.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
});

const SEC = 'antecedentNarrative';
const rail = (page) => page.locator(`[data-corrections-rail="${SEC}"]`);
const cuts = (page) => rail(page).locator('[data-corrections-cut]');
const strip = (page) => page.locator(`[data-rail-dismissed="${SEC}"]`);

const captureClipboard = (page) => page.addInitScript(() => {
  const written = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (t) => { written.push(String(t)); return Promise.resolve(); },
      readText: () => Promise.resolve(written.length ? written[written.length - 1] : ''),
    },
  });
});

async function generate(page, { aid = false } = {}) {
  await captureClipboard(page);
  await page.route('**/api/corrections-pass**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      corrections: [{ section: SEC, text: REVISED, why: 'Unsupported or off-topic.' }],
      dropped: 0, usage: {}, model: 'test',
    }),
  }));
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(note()));
  });
  const url = aid ? '/notes/bt/?aid=1' : '/notes/bt/';
  await page.goto(url);
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto(url);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT 3 item array, full physical faded');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('blocks first, choices after each request');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 6000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const scrub = page.locator('#notes-scrub-go');
  if (await scrub.isVisible({ timeout: 2000 }).catch(() => false)) await scrub.click();
  await expect(page.locator(`[data-corrections-section="${SEC}"]`)).toBeVisible({ timeout: 30000 });
}

const copied = async (page) => {
  const close = page.locator('.revision-panel-close');
  if (await close.isVisible({ timeout: 3000 }).catch(() => false)) await close.click();
  await page.locator(`[data-section-key="${SEC}"]`).getByRole('button', { name: 'Copy', exact: true }).click();
  return page.evaluate(() => navigator.clipboard.readText());
};

const row = (page, i) => cuts(page).nth(i);
const act = (page, i, kind) => row(page, i).locator(`[data-rail-${kind}]`);

test.describe('deletions rail icons', () => {
  test.beforeEach(async ({ page }) => { await generate(page); });

  test('each row carries three icon buttons with tooltip, aria-label and a 30px target', async ({ page }) => {
    await expect(cuts(page)).toHaveCount(3);
    const expected = {
      restore: 'Restore to note',
      tell: 'Tell NoMe about this deletion',
      dismiss: 'Dismiss, keep it deleted',
    };
    for (const [kind, label] of Object.entries(expected)) {
      const btn = act(page, 0, kind);
      await expect(btn).toHaveAttribute('title', label);
      await expect(btn).toHaveAttribute('aria-label', label);
      const box = await btn.boundingBox();
      expect(box.width, kind + ' width').toBeGreaterThanOrEqual(30);
      expect(box.height, kind + ' height').toBeGreaterThanOrEqual(30);
    }
    await expect(row(page, 0)).not.toContainText('Restore');
  });

  test('restore puts the sentence back in the note', async ({ page }) => {
    await expect(page.locator(`[data-corrections-section="${SEC}"]`)).not.toContainText(CUT[0]);
    await act(page, 0, 'restore').click();
    await expect(page.locator(`[data-corrections-section="${SEC}"]`)).toContainText(CUT[0]);
    await expect(cuts(page)).toHaveCount(2);
  });

  test('the pencil opens a box with three chips and queues the ask with the chosen chip and the why', async ({ page }) => {
    await act(page, 0, 'tell').click();
    const box = page.locator('[data-rail-tell-box]');
    await expect(box.getByRole('button', { name: 'Restore part of it' })).toBeVisible();
    await expect(box.getByRole('button', { name: 'Restore it differently' })).toBeVisible();
    await expect(box.getByRole('button', { name: 'Clarify so it is not deleted' })).toBeVisible();
    await box.getByRole('button', { name: 'Restore part of it' }).click();
    await box.locator('input').fill('keep the word working');
    await box.locator('[data-rail-tell-save]').click();
    const asks = page.locator(`[data-corrections-asks="${SEC}"]`);
    await expect(asks).toContainText('Restore part of it');
    await expect(asks).toContainText('keep the word working');
    await expect(asks).toContainText('Unsupported or off-topic.');
  });

  test('the check collapses the row into a strip with a count, and approves it', async ({ page }) => {
    await act(page, 1, 'dismiss').click();
    await expect(cuts(page)).toHaveCount(2);
    await expect(strip(page)).toContainText('1 dismissed');
    await act(page, 0, 'dismiss').click();
    await expect(strip(page)).toContainText('2 dismissed');
    await expect(strip(page).locator('[data-rail-dismissed-glyph]')).toHaveCount(2);
    // The strip sits above the rows.
    const stripY = (await strip(page).boundingBox()).y;
    const rowY = (await row(page, 0).boundingBox()).y;
    expect(stripY).toBeLessThan(rowY);
  });

  test('the strip popover lists dismissed rows and Reopen returns the row below', async ({ page }) => {
    const first = (await row(page, 0).textContent()) || '';
    await act(page, 0, 'dismiss').click();
    await act(page, 0, 'dismiss').click();
    await act(page, 0, 'dismiss').click();
    await expect(cuts(page)).toHaveCount(0);
    await strip(page).hover();
    const pop = page.locator('[data-rail-dismissed-pop]');
    await expect(pop).toBeVisible();
    await expect(pop.locator('[data-rail-reopen]')).toHaveCount(3);
    await expect(pop).toContainText(CUT[1]);
    await pop.locator('[data-rail-reopen]').nth(1).click();
    await expect(cuts(page)).toHaveCount(1);
    await expect(row(page, 0)).toContainText(CUT[1]);
    await expect(strip(page)).toContainText('2 dismissed');
    expect(first).toContain(CUT[0]);
  });

  test('a tap on the strip opens the popover too, and the keyboard reaches the controls', async ({ page }) => {
    await act(page, 0, 'dismiss').click();
    await strip(page).locator('button').first().click();
    await expect(page.locator('[data-rail-dismissed-pop]')).toBeVisible();
    await page.locator('[data-rail-reopen]').first().focus();
    await page.keyboard.press('Enter');
    await expect(cuts(page)).toHaveCount(3);
    await expect(strip(page)).toHaveCount(0);
  });

  test('a mouse click pins the popover open after the pointer leaves, and a second click unpins it', async ({ page }) => {
    await act(page, 0, 'dismiss').click();
    const btn = strip(page).locator('button').first();
    const pop = page.locator('[data-rail-dismissed-pop]');
    await btn.hover();
    await expect(pop).toBeVisible();
    await btn.click();
    await page.mouse.move(2, 2);
    await expect(pop).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await btn.click();
    await page.mouse.move(2, 2);
    await expect(pop).toHaveCount(0);
  });

  test('dismissing does not change what Copy gives', async ({ page }) => {
    const before = await copied(page);
    await act(page, 0, 'dismiss').click();
    await act(page, 0, 'dismiss').click();
    const after = await copied(page);
    expect(after).toBe(before);
    expect(after).not.toContain(CUT[0]);
  });

  test('dismissing every row, then reopening the middle one, keeps the others dismissed', async ({ page }) => {
    for (let i = 0; i < 3; i++) await act(page, 0, 'dismiss').click();
    await strip(page).hover();
    await page.locator('[data-rail-reopen]').nth(1).click();
    await expect(cuts(page)).toHaveCount(1);
    await expect(strip(page)).toContainText('2 dismissed');
  });
});

test.describe('deletions rail at phone width', () => {
  test.use({ viewport: { width: 375, height: 700 } });

  test('no horizontal scroll with the strip and rows, and every target is 30px', async ({ page }) => {
    await generate(page);
    await act(page, 0, 'dismiss').click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    for (const kind of ['restore', 'tell', 'dismiss']) {
      const box = await act(page, 0, kind).boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(30);
      expect(box.height).toBeGreaterThanOrEqual(30);
    }
  });
});

test.describe('quiet mode', () => {
  test('shows no rail controls and no strip', async ({ page }) => {
    await generate(page, { aid: true });
    await expect(cuts(page)).toHaveCount(3);
    await expect(rail(page).locator('[data-rail-restore], [data-rail-tell], [data-rail-dismiss]')).toHaveCount(0);
  });
});

test.describe('review defects: dismissed strip, queued asks, phone targets', () => {
  test.describe('on a touch screen', () => {
    test.use({ viewport: { width: 375, height: 700 }, hasTouch: true });

    test('MED 9: a tap opens the strip and the next tap closes it', async ({ page }) => {
      await generate(page);
      await act(page, 0, 'dismiss').tap();
      const btn = strip(page).locator('button').first();
      await btn.tap();
      await expect(page.locator('[data-rail-dismissed-pop]')).toBeVisible();
      await btn.tap();
      await expect(page.locator('[data-rail-dismissed-pop]')).toHaveCount(0);
    });

    test('MED 12: every control in the rail, the tell box and the queue is 30px tall', async ({ page }) => {
      await generate(page);
      await act(page, 0, 'tell').tap();
      const box = page.locator('[data-rail-tell-box]');
      await box.getByRole('button', { name: 'Restore part of it' }).tap();
      await box.locator('input').fill('keep the word');
      const heights = async (loc) => loc.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      (await heights(box.locator('button'))).forEach((h) => expect(h).toBeGreaterThanOrEqual(30));
      await box.locator('[data-rail-tell-save]').tap();
      (await heights(page.locator(`[data-corrections-asks="${SEC}"] button`))).forEach((h) => expect(h).toBeGreaterThanOrEqual(30));
      await act(page, 1, 'dismiss').tap();
      await strip(page).locator('button').first().tap();
      (await heights(page.locator('[data-rail-dismissed-pop] button'))).forEach((h) => expect(h).toBeGreaterThanOrEqual(30));
    });
  });

  test.describe('with a mouse', () => {
    test.beforeEach(async ({ page }) => { await generate(page); });

    test('MED 9: Escape closes the pinned strip and focus stays on its button', async ({ page }) => {
      await act(page, 0, 'dismiss').click();
      const btn = strip(page).locator('button').first();
      await btn.click();
      await expect(btn).toHaveAttribute('aria-expanded', 'true');
      await page.mouse.move(0, 0);
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-rail-dismissed-pop]')).toHaveCount(0);
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      await expect(btn).toBeFocused();
    });

    test('MED 9: the button names the popover it controls', async ({ page }) => {
      await act(page, 0, 'dismiss').click();
      const btn = strip(page).locator('button').first();
      await btn.click();
      const id = await btn.getAttribute('aria-controls');
      expect(id).toBeTruthy();
      await expect(page.locator(`#${id}`)).toHaveAttribute('data-rail-dismissed-pop', SEC);
    });

    test('MED 9: a strip that unmounts does not come back already open', async ({ page }) => {
      await act(page, 0, 'dismiss').click();
      await strip(page).locator('button').first().click();
      await page.locator('[data-rail-reopen]').first().click();
      await expect(strip(page)).toHaveCount(0);
      await page.mouse.move(0, 0);
      await act(page, 0, 'dismiss').click();
      await page.mouse.move(0, 0);
      await expect(strip(page).locator('button').first()).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('[data-rail-dismissed-pop]')).toHaveCount(0);
    });

    test('MED 10: dismissing a row drops the ask queued for it', async ({ page }) => {
      await act(page, 0, 'tell').click();
      const box = page.locator('[data-rail-tell-box]');
      await box.getByRole('button', { name: 'Restore part of it' }).click();
      await box.locator('[data-rail-tell-save]').click();
      await expect(page.locator(`[data-corrections-asks="${SEC}"]`)).toBeVisible();
      await act(page, 0, 'dismiss').click();
      await expect(page.locator(`[data-corrections-asks="${SEC}"]`)).toHaveCount(0);
    });

    test('MED 10: dismissing a row with its tell box open leaves no box when it is reopened', async ({ page }) => {
      await act(page, 0, 'tell').click();
      await expect(page.locator('[data-rail-tell-box]')).toHaveCount(1);
      await act(page, 0, 'dismiss').click();
      await strip(page).locator('button').first().click();
      await page.locator('[data-rail-reopen]').first().click();
      await expect(cuts(page)).toHaveCount(3);
      await expect(page.locator('[data-rail-tell-box]')).toHaveCount(0);
    });
  });
});
