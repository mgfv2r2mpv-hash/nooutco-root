import { test, expect } from '@playwright/test';

// Point at anything.
//
// His note: it felt clunky that you could only click things with a yellow bar,
// where Lavish lets you click anything. The mode selector sits beside the
// collapsed pill and, while it is on, anything you hover is outlined and
// anything you click becomes the thing your next message is about.
//
// Scope is by role, his call on 2026-08-04: "anything on the page for admin.
// just the note content stuff for others." That is the load-bearing rule here,
// so most of these tests are about who can point at what.

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
  // Generating opens the panel, so the collapsed dock is not on screen yet.
  // Close it: the dock is what most of these tests are about.
  const close = page.locator('.revision-panel-close');
  if (await close.isVisible({ timeout: 2000 }).catch(() => false)) await close.click();
  await expect(page.locator('.revision-dock')).toBeVisible();
}

test.describe('the mode selector', () => {
  test('sits beside the collapsed pill, not inside the panel', async ({ page }) => {
    await drafted(page);
    const dock = page.locator('.revision-dock');
    await expect(dock).toBeVisible();
    await expect(dock.locator('.point-toggle')).toHaveCount(1);
    await expect(dock.locator('.revision-fab')).toHaveCount(1);
  });

  test('does not overlap the pill it sits next to', async ({ page }) => {
    await drafted(page);
    const a = await page.locator('.point-toggle').boundingBox();
    const b = await page.locator('.revision-fab').boundingBox();
    const overlaps = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    expect(overlaps, 'the two floating controls must not stack, again').toBe(false);
  });

  test('announces its state, and Escape turns it off', async ({ page }) => {
    await drafted(page);
    const toggle = page.locator('.point-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('body.is-pointing')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('body.is-pointing')).toHaveCount(0);
  });
});

test.describe('the mode selector, in the panel too', () => {
  test('the open panel carries its own selector', async ({ page }) => {
    await drafted(page);
    await page.locator('.revision-fab').click();
    await expect(page.locator('.revision-panel')).toBeVisible();
    // Pointing at something is as likely mid-conversation as before one starts,
    // so the selector has to exist while the panel is open.
    await expect(page.locator('.revision-panel-head .point-toggle')).toHaveCount(1);
  });
});

test.describe('what a click means while pointing', () => {
  test('pointing inside a section targets that section', async ({ page }) => {
    await drafted(page);
    await page.locator('.point-toggle').click();
    // Click the section's heading text, which is not clickable normally.
    await page.getByText('Narrative of Lesson Progress', { exact: true }).click();

    await expect(page.locator('.revision-panel')).toBeVisible();
    await expect(page.locator('.revision-chip')).toContainText('Narrative of Lesson Progress');
    // Pointing is a one-shot: it turns itself off so the next click is normal.
    await expect(page.locator('.point-toggle')).toHaveAttribute('aria-pressed', 'false');
  });

  test('a click while pointing does not press the thing it lands on', async ({ page }) => {
    await drafted(page);
    // Arm pointing, then point at Generate Note. It must not generate.
    let calls = 0;
    await page.route('**/api/llm-call**', async (route) => { calls++; await route.abort(); });
    await page.locator('.point-toggle').click();
    await page.getByRole('button', { name: 'Generate Note' }).click();
    await page.waitForTimeout(600);
    expect(calls, 'pointing at a button must not activate it').toBe(0);
  });
});

test.describe('scope is by role', () => {
  test('a technician cannot point at page furniture', async ({ page }) => {
    await drafted(page, 'user');
    await page.locator('.point-toggle').click();

    // The page heading is not note content. Clicking it should do nothing at
    // all: no annotation, and pointing stays armed.
    await page.locator('h1').click();
    await expect(page.locator('.revision-chip')).toHaveCount(0);
    await expect(page.locator('.point-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a technician can still point at note content', async ({ page }) => {
    await drafted(page, 'user');
    await page.locator('.point-toggle').click();
    await page.getByText('Narrative of Lesson Progress', { exact: true }).click();
    await expect(page.locator('.revision-chip')).toContainText('Narrative of Lesson Progress');
  });

  test('an admin can point at page furniture, and it is marked as about the page', async ({ page }) => {
    await drafted(page, 'admin');
    await page.locator('.point-toggle').click();
    await page.locator('h1').click();

    const chip = page.locator('.revision-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('About the page');
    await expect(chip).toHaveClass(/is-page/);
  });
});

test.describe('the assistant is not a target', () => {
  test('pointing at the pill or the toggle does not capture them', async ({ page }) => {
    await drafted(page, 'admin');
    await page.locator('.point-toggle').click();
    // Hovering our own furniture must not outline it.
    await page.locator('.revision-fab').hover();
    await expect(page.locator('.revision-fab.point-hover')).toHaveCount(0);
    await expect(page.locator('.revision-chip')).toHaveCount(0);
  });
});


/* What the record says it is pointing at.
 *
 * Found on the first real use of the ticket path, issue #83: he clicked high in
 * the tree and the stub recorded "◎💬AskBT Direct Service Note ToolEnter your
 * session notes as free text. The tool drafts each clinical narrative and sugg"
 * - the whole page, truncated mid-word, with the assistant's own chrome dragged
 * in at the front. A stub that cannot say what it is about is not a stub.
 */
test.describe('the pointed-at label', () => {
  const clickOn = (page, selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, selector);

  test('a container records what it is, not everything inside it', async ({ page }) => {
    await drafted(page, 'admin');
    await page.locator('.point-toggle').click();
    // The element his click landed on, identified from the string the stub
    // recorded: #root holds the assistant dock, the heading, the form and the
    // note, and its textContent runs them all together.
    await clickOn(page, '#root');

    const chip = page.locator('.revision-chip');
    await expect(chip).toBeVisible();
    // The region it is, named once. Against the shipped build this read
    // "5:00Edits are most useful when made promptly. ..." - a form control and
    // a help line from two different parts of the page, run together.
    await expect(chip).toContainText('BT Direct Service Note Tool');
    expect(await chip.innerText(), 'a container label that needs truncating is a page dump')
      .not.toMatch(/\u2026/);
  });

  test('an element with its own words still uses them', async ({ page }) => {
    await drafted(page, 'admin');
    await page.locator('.point-toggle').click();
    await page.locator('h1').click();
    await expect(page.locator('.revision-chip')).toContainText(/Note Tool/i);
  });
});
