import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The hint channel gets an ordering, a severity and a ceiling it can defend.
 *
 * WHAT WAS WRONG. normalizeHints ended in a bare `.slice(0, 8)`. When the model
 * found more than eight gaps, the eight that survived were whichever it happened
 * to emit first, and the renderer then drew all of them flat, in that same
 * accidental order, with no cap. So the channel had a truncation with no
 * judgment behind it AND a display with no priority in it, which together make
 * "an expert prioritizes the hints" a sentence with nowhere to land.
 *
 * WHAT CHANGED. `rank` carries the model's own ordering and the sort runs before
 * the cut, so what falls off the end is what the model ranked last rather than
 * what it typed last. `kind` separates a funder rejecting the claim from the
 * note reading thin. `section: "note"` gives whole-note findings a home instead
 * of forcing them under the nearest heading. The renderer shows three per
 * section and puts the remainder behind a disclosure, so nothing is destroyed.
 *
 * These tests are two-sided on purpose: several assert the NEW behaviour and
 * also that the OLD behaviour is gone, because "sorted" and "emitted in a lucky
 * order" look identical on a list that was already in the right order.
 */

const BT_PAGE = '/notes/bt/index.html';
const BCBA_PAGE = '/notes/bcba/index.html';

const util = (page, fn, ...args) => page.evaluate(fn, ...args);

const ready = async (page, path) => {
  await page.goto(path);
  await page.waitForFunction(() => !!(window.NoteToolsUtil && window.NoteToolsUtil.normalizeHints));
};

// A catalog with real wording, because a hint whose catalog entry is empty
// renders nothing and must not be confused with one that was capped away.
const CATALOG = { a: 'Alpha finding', b: 'Beta finding', c: 'Gamma finding', d: 'Delta finding', other: '' };
const SECTIONS = ['one', 'two'];

test.describe('normalizeHints orders before it cuts', () => {
  test.beforeEach(async ({ page }) => { await ready(page, BT_PAGE); });

  test('a lower rank sorts first, whatever order the model emitted', async ({ page }) => {
    const out = await util(page, ([cat, secs]) => window.NoteToolsUtil.normalizeHints([
      { section: 'one', code: 'a', detail: '', rank: 3, kind: 'thin' },
      { section: 'one', code: 'b', detail: '', rank: 1, kind: 'thin' },
      { section: 'two', code: 'c', detail: '', rank: 2, kind: 'thin' },
    ], cat, secs), [CATALOG, SECTIONS]);
    expect(out.map((h) => h.code)).toEqual(['b', 'c', 'a']);
  });

  test('an unranked hint sinks below every ranked one rather than being dropped', async ({ page }) => {
    // A missing rank is the model declining to order, not the finding being
    // worthless, so it survives - at the bottom.
    const out = await util(page, ([cat, secs]) => window.NoteToolsUtil.normalizeHints([
      { section: 'one', code: 'a', detail: '' },
      { section: 'one', code: 'b', detail: '', rank: 5 },
    ], cat, secs), [CATALOG, SECTIONS]);
    expect(out.map((h) => h.code)).toEqual(['b', 'a']);
    expect(out[1].rank).toBeNull();
  });

  test('equal ranks break on severity, then on emission order', async ({ page }) => {
    const out = await util(page, ([cat, secs]) => window.NoteToolsUtil.normalizeHints([
      { section: 'one', code: 'a', detail: '', rank: 1, kind: 'register' },
      { section: 'one', code: 'b', detail: '', rank: 1, kind: 'blocks-claim' },
      { section: 'one', code: 'c', detail: '', rank: 1, kind: 'register' },
    ], cat, secs), [CATALOG, SECTIONS]);
    expect(out.map((h) => h.code)).toEqual(['b', 'a', 'c']);
  });

  test('the ceiling drops the lowest-ranked, not the last-emitted', async ({ page }) => {
    // This is the whole point of sorting before slicing, and it is the test that
    // fails against the old bare .slice(0, 8).
    const out = await util(page, ([cat, secs]) => {
      const many = [];
      // Emitted worst-first: rank 30 down to 1.
      for (let r = 30; r >= 1; r--) many.push({ section: 'one', code: 'a', detail: `r${r}`, rank: r, kind: 'thin' });
      return window.NoteToolsUtil.normalizeHints(many, cat, secs);
    }, [CATALOG, SECTIONS]);
    expect(out).toHaveLength(24);
    expect(out[0].detail).toBe('r1');
    expect(out[out.length - 1].detail).toBe('r24');
    // r25..r30 were emitted FIRST and are the ones cut, which the old code
    // would have kept.
    expect(out.some((h) => h.detail === 'r30')).toBe(false);
  });

  test('an unknown kind falls back rather than poisoning the sort', async ({ page }) => {
    const out = await util(page, ([cat, secs]) => window.NoteToolsUtil.normalizeHints(
      [{ section: 'one', code: 'a', detail: '', rank: 1, kind: 'catastrophic' }], cat, secs), [CATALOG, SECTIONS]);
    expect(out[0].kind).toBe('thin');
  });
});

test.describe('the whole-note section, and the fabrication-proofing that stays', () => {
  test.beforeEach(async ({ page }) => { await ready(page, BT_PAGE); });

  test('section "note" is accepted even though it is in no tool\'s section list', async ({ page }) => {
    const out = await util(page, ([cat, secs]) => window.NoteToolsUtil.normalizeHints(
      [{ section: 'note', code: 'a', detail: '', rank: 1, kind: 'thin' }], cat, secs), [CATALOG, SECTIONS]);
    expect(out).toHaveLength(1);
    expect(out[0].section).toBe('note');
  });

  test('any OTHER unknown section is still dropped', async ({ page }) => {
    // The new escape hatch is exactly one value wide. Widening it to "anything
    // the model says" is the failure this guards.
    const out = await util(page, ([cat, secs]) => window.NoteToolsUtil.normalizeHints(
      [{ section: 'invented', code: 'a', detail: '', rank: 1, kind: 'thin' }], cat, secs), [CATALOG, SECTIONS]);
    expect(out).toEqual([]);
  });

  test('an unknown code is still dropped', async ({ page }) => {
    const out = await util(page, ([cat, secs]) => window.NoteToolsUtil.normalizeHints(
      [{ section: 'one', code: 'not_in_catalog', detail: 'x', rank: 1, kind: 'thin' }], cat, secs), [CATALOG, SECTIONS]);
    expect(out).toEqual([]);
  });

  test('detail is still capped at 120 characters', async ({ page }) => {
    const out = await util(page, ([cat, secs]) => window.NoteToolsUtil.normalizeHints(
      [{ section: 'one', code: 'a', detail: 'x'.repeat(400), rank: 1, kind: 'thin' }], cat, secs), [CATALOG, SECTIONS]);
    expect(out[0].detail).toHaveLength(120);
  });
});

test.describe('the schema carries the meaning, because BT\'s prompt cannot', () => {
  // BT's system prompt is composed inside the Worker from the prompt store, so
  // wording added to HINTS_BLOCK never reaches the served call. The schema IS
  // sent from the browser for every tool, which is why rank and kind are
  // explained in description fields rather than in prose.
  test('bt requires rank and kind, and allows the whole-note section', async ({ page }) => {
    await ready(page, BT_PAGE);
    const hints = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'bt').responseSchema.properties.hints);
    expect(hints.items.required).toEqual(expect.arrayContaining(['rank', 'kind']));
    expect(hints.items.properties.section.enum).toContain('note');
    expect(hints.items.properties.kind.enum).toEqual(['blocks-claim', 'thin', 'register']);
  });

  test('and it explains what the ordering is for', async ({ page }) => {
    await ready(page, BT_PAGE);
    const props = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'bt').responseSchema.properties.hints.items.properties);
    expect(props.rank.description).toMatch(/priority order/i);
    expect(props.rank.description).toMatch(/top three per section/i);
    expect(props.kind.description).toMatch(/blocks-claim/);
  });

  test('sap gets the same shape from the same helper', async ({ page }) => {
    await ready(page, BCBA_PAGE);
    const hints = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'sap').responseSchema.properties.hints);
    expect(hints.items.required).toEqual(expect.arrayContaining(['rank', 'kind']));
    expect(hints.items.properties.section.enum).toContain('note');
  });

  test('the tool section list is not silently replaced by the escape hatch', async ({ page }) => {
    await ready(page, BT_PAGE);
    const sections = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'bt').responseSchema.properties.hints.items.properties.section.enum);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections).toContain('behaviorPlanNarrative');
  });
});

/* ── The renderer ────────────────────────────────────────────────────────── */

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}
const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});
const note = (o = {}) => ({
  individualsPresent: ['Client'], clinicalStatus: ['Presented Tired'],
  clinicalStatusNarrative: 'The client presented as tired on arrival today.',
  purpose: ['Worked on goals as stated in the treatment plan'], servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'Choices were offered before each demand presented.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions during the session.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [], ...o,
});

async function draftWithHints(page, hints) {
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, questions: [] }));
    return route.fulfill(reply(note({ hints })));
  });
  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto('/notes/bt/');
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array faded to gestural');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board, choice up front');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2 blocked, not sure if it counts');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  // The scrub gate stands between Generate and the draft: an acknowledgement
  // first, then the PHI review when the detector found anything.
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });
}

test.describe('the renderer caps at three and destroys nothing', () => {
  const SIX = [1, 2, 3, 4, 5, 6].map((n) => ({
    section: 'behaviorPlanNarrative',
    code: n % 2 ? 'no_behavior_count' : 'no_response_described',
    detail: `finding ${n}`, rank: n, kind: 'thin',
  }));

  test('three are shown and the rest sit behind a disclosure', async ({ page }) => {
    await draftWithHints(page, SIX);
    const box = page.getByTestId('hints-behaviorPlanNarrative');
    await expect(box.locator('p')).toHaveCount(3);
    await expect(page.getByText('finding 1')).toBeVisible();
    await expect(page.getByText('finding 4')).toHaveCount(0);
    await expect(box.getByTestId('hint-disclosure')).toHaveText('3 more notes');
  });

  test('opening the disclosure reveals every one of them', async ({ page }) => {
    await draftWithHints(page, SIX);
    const box = page.getByTestId('hints-behaviorPlanNarrative');
    await box.getByTestId('hint-disclosure').click();
    await expect(box.locator('p')).toHaveCount(6);
    await expect(page.getByText('finding 6')).toBeVisible();
    await expect(box.getByTestId('hint-disclosure')).toHaveText('Show fewer');
  });

  test('the three shown are the top-ranked three, not the first three emitted', async ({ page }) => {
    // Emitted worst-first. Against the old renderer this shows findings 6, 5, 4.
    await draftWithHints(page, [...SIX].reverse());
    await expect(page.getByText('finding 1')).toBeVisible();
    await expect(page.getByText('finding 2')).toBeVisible();
    await expect(page.getByText('finding 3')).toBeVisible();
    await expect(page.getByText('finding 6')).toHaveCount(0);
  });

  test('no disclosure appears when three or fewer survive', async ({ page }) => {
    await draftWithHints(page, SIX.slice(0, 2));
    await expect(page.getByTestId('hints-behaviorPlanNarrative').locator('p')).toHaveCount(2);
    await expect(page.getByTestId('hint-disclosure')).toHaveCount(0);
  });
});

test.describe('severity and the whole-note block', () => {
  test('a claim-blocker is drawn differently from a thin note', async ({ page }) => {
    await draftWithHints(page, [
      { section: 'behaviorPlanNarrative', code: 'no_behavior_count', detail: 'blocker', rank: 1, kind: 'blocks-claim' },
      { section: 'behaviorPlanNarrative', code: 'no_response_described', detail: 'thin one', rank: 2, kind: 'thin' },
    ]);
    const rows = page.getByTestId('hints-behaviorPlanNarrative').locator('p');
    await expect(rows.nth(0)).toHaveAttribute('data-hint-kind', 'blocks-claim');
    await expect(rows.nth(1)).toHaveAttribute('data-hint-kind', 'thin');
    // Different enough to tell apart at a glance, which is the entire reason
    // kind exists rather than being another line of detail text.
    const colours = await rows.evaluateAll((ps) => ps.map((p) => getComputedStyle(p).backgroundColor));
    expect(colours[0]).not.toBe(colours[1]);
  });

  test('a whole-note finding renders above the grid, not under a section', async ({ page }) => {
    await draftWithHints(page, [
      { section: 'note', code: 'single_program_only', detail: 'whole note', rank: 1, kind: 'thin' },
    ]);
    await expect(page.getByTestId('hints-note')).toBeVisible();
    await expect(page.getByText('About the whole note')).toBeVisible();
    // It must not have been filed under a section heading as well.
    await expect(page.getByTestId('hints-lessonProgressNarrative')).toHaveCount(0);
  });

  test('and it sits before the first section card in the DOM', async ({ page }) => {
    await draftWithHints(page, [
      { section: 'note', code: 'single_program_only', detail: 'whole note', rank: 1, kind: 'thin' },
    ]);
    const order = await page.evaluate(() => {
      const block = document.querySelector('[data-testid="hints-note"]');
      const grid = document.querySelector('.output-grid');
      return block.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING ? 'before' : 'after';
    });
    expect(order).toBe('before');
  });
});

test.describe("both note pages share one copy of the helper", () => {
  // The block these helpers live in used to be an inline <script> pasted into
  // each note page, identical by convention and checked by nothing. Growing the
  // hint channel took that duplication from twelve lines to a hundred, and this
  // test is what makes the extraction stick: a future edit made to one page and
  // not the other now fails here instead of shipping.
  test("neither page carries an inline copy any more", () => {
    const { readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const root = join(__dirname, "..");
    for (const page of ["notes/bcba/index.html", "notes/bt/index.html"]) {
      const html = readFileSync(join(root, page), "utf8");
      expect(html, page + " should not define the helpers inline").not.toContain("window.NoteToolsUtil = {");
      expect(html, page + " should load the shared file").toMatch(/note-tools-util\.js/);
    }
  });

  test("and both resolve to the same served file", async ({ page }) => {
    const from = async (path) => {
      await ready(page, path);
      return page.evaluate(() => [
        typeof window.NoteToolsUtil.normalizeHints,
        typeof window.NoteToolsUtil.hintSchema,
        JSON.stringify(window.NoteToolsUtil.HINT_KINDS),
        window.NoteToolsUtil.HINT_CEILING,
      ]);
    };
    expect(await from(BT_PAGE)).toEqual(await from(BCBA_PAGE));
  });
});
