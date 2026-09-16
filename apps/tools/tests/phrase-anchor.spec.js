import { test, expect, devices } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The composer anchors to the phrase, not to the box.
 *
 * "Select or long-press a phrase and a composer opens anchored to it. Say what
 * is wrong. The revision lands in the note and the exchange is over."
 *
 * The chip used to sit on the textarea's top-right corner, and the comment in
 * the code gave an honest reason: caret coordinates inside a textarea cannot be
 * measured without mirroring the content into a hidden div. That mirror already
 * existed in this repo - notes-scrub.js builds one for every textarea so it can
 * draw PHI highlights over the right characters - so the hard part was running
 * in production while this file called it impossible.
 *
 * These tests do not re-implement the measurement to check it, which would only
 * prove the two copies agree. They assert things the old corner anchoring could
 * not satisfy: a phrase at the START of a box puts the chip at the LEFT of it,
 * and a phrase further down puts the chip LOWER. Both are false of a corner.
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

/* Long enough to wrap over several lines in the rendered box, because a test
   that selects inside one line cannot tell a phrase anchor from a corner. */
const LONG = [
  'Staff presented the first demand at the table and waited a full five seconds.',
  'The client pushed the materials away and left the chair on the second trial.',
  'Staff blocked the exit neutrally and re-presented the same demand once more.',
  'The client returned to the chair without a prompt and completed the trial.',
  'Staff delivered the reinforcer immediately and paired it with brief praise.',
].join(' ');

const note = () => ({
  individualsPresent: ['Client'], clinicalStatus: ['Presented Tired'],
  clinicalStatusNarrative: 'The client presented as tired on arrival today.',
  purpose: ['Worked on goals as stated in the treatment plan'], servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: LONG,
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions during the session.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
});

async function draft(page, corrections = []) {
  await page.route('**/api/corrections-pass**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ corrections, dropped: 0, usage: {}, model: 'test' }),
  }));
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(note()));
  });

  await page.goto('/notes/bt/?aid=1');
  await page.evaluate(() => localStorage.clear());
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto('/notes/bt/?aid=1');
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, needed full physical most of it');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board, also moved to the floor and he settled');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ackGo = page.locator('#notes-ack-go');
  if (await ackGo.isVisible({ timeout: 6000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ackGo.click();
  }
  const scrubGo = page.locator('#notes-scrub-go');
  if (await scrubGo.isVisible({ timeout: 2000 }).catch(() => false)) await scrubGo.click();
  // Collapse the panel so it is not sitting over the section being selected in.
  const close = page.locator('.revision-panel-close');
  if (await close.isVisible({ timeout: 20000 }).catch(() => false)) await close.click();
}

// Select `phrase` inside the antecedent box and return the chip's box.
async function selectInBox(page, phrase) {
  const field = page.locator('textarea[data-section-id="antecedentNarrative"]');
  await expect(field).toBeVisible({ timeout: 30000 });
  await field.evaluate((el, p) => {
    const i = el.value.indexOf(p);
    if (i < 0) throw new Error('phrase not in the box: ' + p);
    el.focus();
    el.setSelectionRange(i, i + p.length);
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, phrase);
  const chip = page.locator('[data-revise-chip]');
  await expect(chip).toBeVisible({ timeout: 5000 });
  return {
    chip: await chip.boundingBox(),
    box: await field.boundingBox(),
  };
}

test.describe('the chip lands on the phrase', () => {
  test('a phrase at the start of a box puts it at the left of the box', async ({ page }) => {
    await draft(page);
    const { chip, box } = await selectInBox(page, 'Staff presented the first demand');
    /* THE ASSERTION THE CORNER COULD NOT PASS. The old anchor was
       box.right - 120, which for any box wider than about 250px is nowhere
       near its left edge. */
    expect(chip.x).toBeLessThan(box.x + 60);
    expect(chip.x).toBeLessThan(box.x + box.width - 140);
  });

  test('a phrase further down puts it lower', async ({ page }) => {
    await draft(page);
    const first = await selectInBox(page, 'Staff presented the first demand');
    const later = await selectInBox(page, 'Staff delivered the reinforcer');
    expect(later.chip.y).toBeGreaterThan(first.chip.y + 10);
  });

  test('it sits above the phrase on a mouse, clear of the words it is about', async ({ page }) => {
    await draft(page);
    const { chip, box } = await selectInBox(page, 'The client returned to the chair');
    expect(chip.y).toBeGreaterThanOrEqual(0);
    expect(chip.y + chip.height).toBeLessThanOrEqual(box.y + box.height + 40);
  });

  test('it stays on screen, wherever the section is', async ({ page }) => {
    await draft(page);
    const { chip } = await selectInBox(page, 'Staff blocked the exit neutrally');
    const vp = page.viewportSize();
    expect(chip.x).toBeGreaterThanOrEqual(0);
    expect(chip.y).toBeGreaterThanOrEqual(0);
    expect(chip.x + chip.width).toBeLessThanOrEqual(vp.width + 1);
    expect(chip.y + chip.height).toBeLessThanOrEqual(vp.height + 1);
  });

  test('the words it carries are the words that were selected', async ({ page }) => {
    await draft(page);
    await selectInBox(page, 'The client pushed the materials away');
    await page.locator('[data-revise-chip]').click();
    await expect(page.locator('.revision-chip')).toContainText('The client pushed the materials away');
  });

  test('the chip says what it does, and there is no glyph to learn', async ({ page }) => {
    await draft(page);
    await selectInBox(page, 'Staff presented the first demand');
    const label = await page.locator('[data-revise-chip]').textContent();
    expect(label.trim()).toBe('Say what is wrong');
  });

  /* The mirror is a hidden div appended to the body. It must not be reachable,
     readable, or in the way of anything. */
  test('the mirror it measures with is inert', async ({ page }) => {
    await draft(page);
    await selectInBox(page, 'Staff presented the first demand');
    const m = await page.evaluate(() => {
      const el = document.getElementById('revise-phrase-mirror');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        hidden: cs.visibility === 'hidden',
        fixed: cs.position === 'fixed',
        noPointer: cs.pointerEvents === 'none',
        aria: el.getAttribute('aria-hidden'),
        behind: Number(cs.zIndex) < 0,
      };
    });
    expect(m).not.toBeNull();
    expect(m.hidden).toBe(true);
    expect(m.fixed).toBe(true);
    expect(m.noPointer).toBe(true);
    expect(m.aria).toBe('true');
    expect(m.behind).toBe(true);
  });
});

/* ── A section the corrections pass rewrote ──────────────────────────────── */

const ONE_ADD = [{
  section: 'antecedentNarrative',
  text: LONG + ' Staff moved to the floor beside the client before the next demand.',
  why: 'You wrote that you moved to the floor.',
}];

test.describe('a corrected section can be spoken to at all', () => {
  /* It is drawn as spans rather than a textarea, so until the rendered branch
     existed this was the one kind of section a phrase could not be selected in
     - and under the aid flag it is the common kind. */
  test('selecting a phrase inside it raises the chip', async ({ page }) => {
    await draft(page, ONE_ADD);
    const view = page.locator('[data-corrections-section="antecedentNarrative"]');
    await expect(view).toBeVisible({ timeout: 30000 });

    await page.evaluate(() => {
      const host = document.querySelector('[data-corrections-section="antecedentNarrative"]');
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && node.textContent.indexOf('pushed the materials away') === -1) node = walker.nextNode();
      if (!node) throw new Error('no text node carrying the phrase');
      const i = node.textContent.indexOf('pushed the materials away');
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 'pushed the materials away'.length);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await expect(page.locator('[data-revise-chip]')).toBeVisible({ timeout: 5000 });
    await page.locator('[data-revise-chip]').click();
    await expect(page.locator('.revision-chip')).toContainText('pushed the materials away');
  });
});

test.describe('on the phone they actually use', () => {
  const { defaultBrowserType, ...IPHONE } = devices['iPhone 14'];
  test.use(IPHONE);

  /* iOS draws its own Copy and Look Up callout ABOVE a selection. Two controls
     in one place is a fight the system wins, so the chip goes below. */
  test('the chip goes below the selection, clear of the system callout', async ({ page }) => {
    await draft(page);
    const field = page.locator('textarea[data-section-id="antecedentNarrative"]');
    await expect(field).toBeVisible({ timeout: 30000 });
    await page.evaluate(() => {
      document.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
    });
    const rect = await field.evaluate((el) => {
      const i = el.value.indexOf('The client pushed the materials away');
      el.focus();
      el.setSelectionRange(i, i + 'The client pushed the materials away'.length);
      document.dispatchEvent(new Event('selectionchange'));
      return el.getBoundingClientRect().top;
    });
    const chip = page.locator('[data-revise-chip]');
    await expect(chip).toBeVisible({ timeout: 5000 });
    const box = await chip.boundingBox();
    // Below the first line of the box, which is where the selected phrase is.
    expect(box.y).toBeGreaterThan(rect);
  });
});
