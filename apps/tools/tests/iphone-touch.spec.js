import { test, expect } from '@playwright/test';

/* The notes assistant on a phone. Issue #99.
 *
 * Two things only ever worked with a mouse. Pointing at a section painted an
 * outline on hover, and a phone has no hover, so a technician tapping a section
 * could not see what they were about to send. Selecting a sentence raised the
 * revise chip off `mouseup`, and iOS finishes a selection with its own drag
 * handles and fires no mouseup on the document, so the chip never appeared at
 * all.
 *
 * Both fixes are gated on `event.pointerType === "touch"`, which is what makes
 * them additions rather than changes. THIS FILE ONLY PROVES THE TOUCH HALF.
 * The other half of that claim, that a mouse still cannot reach either new
 * path, is pinned in point-at-anything.spec.js, which runs on all three desktop
 * projects. Neither file is worth much without the other.
 *
 * This project runs on the iPhone 13 profile. Playwright cannot drive an iOS
 * selection handle, so the handle drag itself stays a manual check on a real
 * phone, which is what the issue says too. What is checked here is that a
 * selection reported by `selectionchange` raises the chip, which is the
 * mechanism the handles use.
 */

function tokenFor(role = 'user') {
  const payload = { role, kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.not-a-real-signature`;
}

function reply(obj) {
  return {
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
  };
}

function note(o = {}) {
  return {
    individualsPresent: ['Client'], clinicalStatus: ['Presented Tired'],
    clinicalStatusNarrative: 'The client presented as tired on arrival.',
    purpose: ['Worked on goals as stated in the treatment plan'], servicePaused: 'No',
    abaTechniques: ['Discrete Trial Training'],
    lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
    antecedentStrategies: ['Offered choices'],
    antecedentNarrative: 'Choices were offered before each demand.',
    consequenceStrategies: ['Redirection'],
    consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
    behaviorPlanNarrative: 'Elopement occurred on two occasions.',
    clientProgress: 'Steady progress towards goals and behaviors',
    actionItems: ['None'],
    followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
    hints: [], ...o,
  };
}

async function drafted(page, role = 'user') {
  let calls = 0;
  await page.route('**/api/llm-call**', async (route) => {
    calls++;
    if (calls === 1) return route.fulfill(reply({ sufficient: true, questions: [] }));
    return route.fulfill(reply(note()));
  });
  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor(role));
  await page.goto('/notes/bt/');
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT 3-item array');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const review = page.locator('#notes-scrub-go');
  if (await review.isVisible({ timeout: 1500 }).catch(() => false)) await review.click();
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });
  const close = page.locator('.revision-panel-close');
  if (await close.isVisible({ timeout: 2000 }).catch(() => false)) await close.click();
  await expect(page.locator('.revision-dock')).toBeVisible();
}

test.describe('the phone can see what it is about to point at', () => {
  test('a touch press paints the outline a mouse gets from hovering', async ({ page }) => {
    await drafted(page);
    await page.locator('.point-toggle').tap();
    await expect(page.locator('body.is-pointing')).toHaveCount(1);
    await expect(page.locator('.point-hover')).toHaveCount(0);

    // Press without lifting, which is what a technician reaching for a section
    // does. A completed tap would target the section and clear the outline on
    // the way, so it would prove the opposite of what this is about.
    const card = page.locator('[data-section-key]').first();
    await card.scrollIntoViewIfNeeded();
    await card.evaluate((el) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    });

    await expect(page.locator('.point-hover')).toHaveCount(1);
    // On the thing under the finger, not on some ancestor that happens to pass.
    await expect(card).toHaveClass(/point-hover/);
  });

  test('a technician pressing page furniture still gets nothing, so scope holds on touch', async ({ page }) => {
    // His standing rule of 2026-08-04: admin points at anything, everyone else
    // points at note content only. The touch path calls the same eligible()
    // the mouse path does, and this is what says so.
    await drafted(page, 'user');
    await page.locator('.point-toggle').tap();

    const outside = page.locator('h1, header').first();
    await outside.scrollIntoViewIfNeeded();
    await outside.evaluate((el) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    });

    await expect(page.locator('.point-hover')).toHaveCount(0);
  });

  test('lifting the finger clears the outline', async ({ page }) => {
    await drafted(page);
    await page.locator('.point-toggle').tap();
    const card = page.locator('[data-section-key]').first();
    await card.scrollIntoViewIfNeeded();
    const box = await card.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;

    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    }, { x, y });
    await expect(page.locator('.point-hover')).toHaveCount(1);

    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      el.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true }));
    }, { x, y });
    await expect(page.locator('.point-hover')).toHaveCount(0);
  });
});

test.describe('the phone can raise the revise chip off a selection', () => {
  test('a selection reported by selectionchange raises the chip', async ({ page }) => {
    await drafted(page);

    const area = page.locator('textarea[data-section-id]').first();
    await area.scrollIntoViewIfNeeded();
    await expect(page.locator('[data-revise-chip]')).toHaveCount(0);

    // A touch has to have happened first, which is the gate. Then select, which
    // is what the iOS handles do, and let selectionchange carry it.
    await page.evaluate(() => {
      const el = document.querySelector('textarea[data-section-id]');
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
      el.focus();
      el.setSelectionRange(0, Math.min(24, (el.value || '').length));
      document.dispatchEvent(new Event('selectionchange'));
    });

    await expect(page.locator('[data-revise-chip]')).toHaveCount(1, { timeout: 3000 });
  });

  test('a mouse press after a touch closes the gate again', async ({ page }) => {
    // A touchscreen laptop is one device that gets both. The gate reads the
    // LAST pointer rather than latching on the first touch, so plugging a mouse
    // in does not leave the new path armed for every drag after it. This is the
    // case a latching flag would get wrong, and it is the reason for the shape.
    await drafted(page);
    const area = page.locator('textarea[data-section-id]').first();
    await area.scrollIntoViewIfNeeded();

    await page.evaluate(() => {
      const el = document.querySelector('textarea[data-section-id]');
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }));
      el.focus();
      el.setSelectionRange(0, Math.min(24, (el.value || '').length));
      document.dispatchEvent(new Event('selectionchange'));
    });

    await page.waitForTimeout(600);
    await expect(page.locator('[data-revise-chip]')).toHaveCount(0);
  });

  test('the chip carries the selected words into the panel', async ({ page }) => {
    await drafted(page);
    const area = page.locator('textarea[data-section-id]').first();
    await area.scrollIntoViewIfNeeded();

    const picked = await page.evaluate(() => {
      const el = document.querySelector('textarea[data-section-id]');
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
      el.focus();
      const end = Math.min(24, (el.value || '').length);
      el.setSelectionRange(0, end);
      document.dispatchEvent(new Event('selectionchange'));
      return (el.value || '').slice(0, end).trim();
    });

    const chip = page.locator('[data-revise-chip]');
    await expect(chip).toHaveCount(1, { timeout: 3000 });
    await chip.tap();

    // The panel opens carrying the quoted words, which is the whole point of
    // the chip: the next message is about that sentence, not about the section.
    await expect(page.locator('.revision-panel')).toBeVisible();
    expect(picked.length).toBeGreaterThan(1);
    await expect(page.locator('.revision-panel')).toContainText(picked.slice(0, 12));
  });
});
