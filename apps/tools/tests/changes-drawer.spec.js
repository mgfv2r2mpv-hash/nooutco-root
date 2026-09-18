import { test, expect, devices } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The record comes out of the reading path.
 *
 * His ruling is one sentence with two halves: "indicate the changes and have
 * them default accepted (low weight for style) or staff can edit (strongest
 * signal), approve (stronger weight for style), or reject/revert (also a signal
 * for style in its manner)", prefaced by what it replaces: "not the thing with
 * the inline check and exes that I had requested. I hate it and it looks stupid
 * and makes it hard to read and use."
 *
 * So the changed phrase keeps its mark and loses its controls, and the four
 * answers move into a drawer nobody has to open. What is tested here is both
 * halves, plus the number on the pill, which changes meaning: it used to count
 * what the tool wanted from the technician and now counts what was done for
 * them.
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

const ANTECEDENT = 'Choices were offered before each demand presented.';
const BEHAVIOR = 'Elopement occurred on two occasions during the session.';

const note = () => ({
  individualsPresent: ['Client'], clinicalStatus: ['Presented Tired'],
  clinicalStatusNarrative: 'The client presented as tired on arrival today.',
  purpose: ['Worked on goals as stated in the treatment plan'], servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: ANTECEDENT,
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: BEHAVIOR,
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
});

// One added sentence, in the antecedent section.
const ONE_ADD = [{
  section: 'antecedentNarrative',
  text: ANTECEDENT + ' Staff moved to the floor beside the client before presenting the next demand.',
  why: 'You wrote that you moved to the floor.',
}];

/* One sentence leaving the behaviour section and arriving in the antecedent
   one. NoteDiff reads that as a move, so corrections.js emits a mark at each
   end and the drawer has to collapse them back into the one thing that
   happened. */
const ONE_MOVE = [
  { section: 'behaviorPlanNarrative', text: 'Staff blocked and redirected each attempt.', why: 'This is an antecedent strategy.' },
  { section: 'antecedentNarrative', text: ANTECEDENT + ' ' + BEHAVIOR, why: 'This belongs with the antecedent.' },
];

async function draft(page, corrections, { aid = true } = {}) {
  await page.route('**/api/corrections-pass**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ corrections, dropped: 0, usage: {}, model: 'test' }),
  }));
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(note()));
  });

  const url = aid ? '/notes/bt/?aid=1' : '/notes/bt/';
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto(url);
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
  await expect(page.locator('[data-corrections-section]').first()).toBeVisible({ timeout: 30000 });
}

/* The panel is ALREADY OPEN when a draft lands - it opens itself to say what it
   did - so the collapsed pill does not exist at that moment. Clicking for it
   unconditionally is what made the first twelve of these fail. */
const openDrawer = async (page) => {
  const fab = page.locator('.revision-fab');
  if (await fab.isVisible({ timeout: 2000 }).catch(() => false)) await fab.click();
  await expect(page.locator('[data-changes-drawer]')).toBeVisible({ timeout: 15000 });
};

/* WHAT ACTUALLY SHIPS, which is the only reading that matters here. A reverted
   change is still DRAWN in the note - struck through, so a technician can see
   what was taken out - so the rendered section is the wrong place to ask
   whether it is gone. Copy All is the question the EHR asks. */
const shipped = async (page, section = 'antecedentNarrative') => {
  await collapse(page);
  await page.locator(`[data-section-key="${section}"]`).getByRole('button', { name: 'Copy', exact: true }).click();
  return page.evaluate(() => navigator.clipboard.readText());
};

/* READING THE REAL CLIPBOARD IS CHROMIUM-ONLY. `grantPermissions` throws
   "Unknown permission: clipboard-read" on firefox and clipboard-write on
   webkit, so these two tests failed in both engines from the day they landed
   and nobody saw it: CI was dying of its own accord at the time.

   Capturing the write keeps the assertion these tests exist for - what Copy
   puts on the clipboard is what reaches the EHR - and runs everywhere. The page
   still takes its normal path: engine.jsx calls navigator.clipboard.writeText
   and nothing else. */
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

/* ── The rows, from the record, without drawing anything ─────────────────── */

test.describe('a pass becomes rows', () => {
  const entries = (page, before, corrections, state) => page.evaluate(
    ([b, c, st]) => {
      const built = window.NoteCorrections.build({ before: b, corrections: c });
      const headings = { a: 'Antecedent', b: 'Behavior' };
      return {
        marks: built.marks.length,
        rows: window.ChangesDrawer.entriesFrom(built, st || {}, headings)
          .map((e) => ({ kind: e.kind, heading: e.heading, from: e.fromHeading, state: e.state, text: e.text })),
        keys: built.marks.map((m) => ({ key: m.key, type: m.type })),
      };
    },
    [before, corrections, state],
  );

  const ready = async (page) => {
    await page.goto('/notes/bt/index.html?aid=1');
    await page.waitForFunction(() => !!window.NoteCorrections && !!window.ChangesDrawer);
  };

  test('an added sentence is one row, named for the section it landed in', async ({ page }) => {
    await ready(page);
    const r = await entries(page, { a: 'One sentence here.' }, [{ section: 'a', text: 'One sentence here. And another.', why: '' }]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].kind).toBe('added');
    expect(r.rows[0].heading).toBe('Antecedent');
  });

  /* THE COLLAPSE. Both ends of a move are real marks and the note needs both.
     A technician counting them is counting one event, so the drawer must not
     report two. */
  test('a move is one row, not two, and it says where it came from', async ({ page }) => {
    await ready(page);
    const r = await entries(
      page,
      { a: 'Antecedent text.', b: 'Behavior text. The sentence that moves.' },
      [
        { section: 'a', text: 'Antecedent text. The sentence that moves.', why: '' },
        { section: 'b', text: 'Behavior text.', why: '' },
      ],
    );
    expect(r.marks).toBe(2);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].kind).toBe('moved');
    expect(r.rows[0].heading).toBe('Antecedent');
    expect(r.rows[0].from).toBe('Behavior');
  });

  test('the count on the pill is the count in the list', async ({ page }) => {
    await ready(page);
    const n = await page.evaluate(() => {
      const built = window.NoteCorrections.build({
        before: { a: 'Antecedent text.', b: 'Behavior text. The sentence that moves.' },
        corrections: [
          { section: 'a', text: 'Antecedent text. The sentence that moves.', why: '' },
          { section: 'b', text: 'Behavior text.', why: '' },
        ],
      });
      return {
        countOf: window.ChangesDrawer.countOf(built, {}, {}),
        rows: window.ChangesDrawer.entriesFrom(built, {}, {}).length,
        raw: built.count,
      };
    });
    expect(n.countOf).toBe(n.rows);
    expect(n.raw).toBe(2);
    expect(n.countOf).toBe(1);
  });

  test('a removal is a row of its own kind, because it is different evidence', async ({ page }) => {
    await ready(page);
    const r = await entries(page, { a: 'Keep this. Drop that.' }, [{ section: 'a', text: 'Keep this.', why: '' }]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].kind).toBe('removed');
  });

  test('doing nothing leaves every row in its resting state', async ({ page }) => {
    await ready(page);
    const r = await entries(page, { a: 'One sentence here.' }, [{ section: 'a', text: 'One sentence here. And another.', why: '' }]);
    expect(r.rows[0].state).toBe('default');
  });

  test('a reverted row says removed, and an edited one says edited', async ({ page }) => {
    await ready(page);
    const built = await entries(page, { a: 'One sentence here.' }, [{ section: 'a', text: 'One sentence here. And another.', why: '' }]);
    const key = built.keys[0].key;

    const reverted = await entries(page, { a: 'One sentence here.' }, [{ section: 'a', text: 'One sentence here. And another.', why: '' }], { [key]: { reverted: true } });
    expect(reverted.rows[0].state).toBe('reverted');

    const edited = await entries(page, { a: 'One sentence here.' }, [{ section: 'a', text: 'One sentence here. And another.', why: '' }], { [key]: { text: 'My own wording.' } });
    expect(edited.rows[0].state).toBe('edited');
    expect(edited.rows[0].text).toBe('My own wording.');
  });

  /* An explicit approval and a passive accept are different evidence, and his
     table weighs them apart. A row that cannot tell them apart throws that
     away. */
  test('an approval is its own state, distinct from having been left alone', async ({ page }) => {
    await ready(page);
    const built = await entries(page, { a: 'One sentence here.' }, [{ section: 'a', text: 'One sentence here. And another.', why: '' }]);
    const key = built.keys[0].key;
    const approved = await entries(page, { a: 'One sentence here.' }, [{ section: 'a', text: 'One sentence here. And another.', why: '' }], { [key]: { approved: true } });
    expect(approved.rows[0].state).toBe('approved');
  });
});

/* ── The reading path, and what is no longer in it ───────────────────────── */

test.describe('the note keeps the mark and loses the control', () => {
  /* THE CONTROL. Without the flag the tick is exactly where it was, so this
     test fails the moment quiet mode is applied to everybody. */
  test('without the flag the ghost tick is still on every change', async ({ page }) => {
    await draft(page, ONE_ADD, { aid: false });
    await expect(page.locator('[data-correction-tick]').first()).toBeVisible();
  });

  test('with the flag the change is still drawn, and nothing is clickable beside it', async ({ page }) => {
    await draft(page, ONE_ADD);
    // Indicated: the phrase still reads as added.
    await expect(page.locator('[data-correction-type="ins"]').first()).toBeVisible();
    // And carrying nothing to act on.
    await expect(page.locator('[data-correction-tick]')).toHaveCount(0);
    await expect(page.locator('[data-correction-undo]')).toHaveCount(0);
    await expect(page.locator('[data-correction-pencil]')).toHaveCount(0);
  });

  test('the pill counts what was done rather than what is owed', async ({ page }) => {
    await draft(page, ONE_ADD);
    await collapse(page);
    await expect(page.locator('[data-fab-changes]')).toHaveText(/1 change/);
  });

  test('without the flag the pill still says Ask NoMe', async ({ page }) => {
    await draft(page, ONE_ADD, { aid: false });
    await collapse(page);
    await expect(page.locator('[data-fab-changes]')).toHaveCount(0);
    await expect(page.locator('.revision-fab-label')).toContainText('Ask');
  });

  test('a move counts once on the pill, the way it lists once in the drawer', async ({ page }) => {
    await draft(page, ONE_MOVE);
    await collapse(page);
    const label = await page.locator('[data-fab-changes]').textContent();
    await openDrawer(page);
    const rows = await page.locator('[data-change]').count();
    expect(label.trim()).toBe(rows + (rows === 1 ? ' change' : ' changes'));
  });
});

/* ── The drawer itself ───────────────────────────────────────────────────── */

test.describe('the drawer', () => {
  test('opens on what changed, because that is what the pill offered', async ({ page }) => {
    await draft(page, ONE_ADD);
    await collapse(page);
    await page.locator('.revision-fab').click();
    await expect(page.locator('[data-changes-drawer]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-changes-tab="changes"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('every answer is a word, and there is not a tick or a cross among them', async ({ page }) => {
    await draft(page, ONE_ADD);
    await openDrawer(page);
    await page.locator('.dz-line').first().click();
    await expect(page.locator('[data-disposition-approve]').first()).toHaveText('Approve');
    await expect(page.locator('[data-disposition-editbtn]').first()).toHaveText('Edit');
    await expect(page.locator('[data-disposition-revert]').first()).toHaveText('Remove it');
  });

  test('approving changes the note not at all, which is the whole point of it', async ({ page }) => {
    await captureClipboard(page);
    await draft(page, ONE_ADD);
    const before = await shipped(page);
    await openDrawer(page);
    await page.locator('.dz-line').first().click();
    await page.locator('[data-disposition-approve]').first().click();
    await expect(page.locator('[data-change]').first()).toHaveAttribute('data-change-state', 'approved');
    expect(await shipped(page)).toBe(before);
  });

  test('removing one takes it out of the note', async ({ page }) => {
    await captureClipboard(page);
    await draft(page, ONE_ADD);
    expect(await shipped(page)).toContain('moved to the floor beside the client');

    await openDrawer(page);
    await page.locator('.dz-line').first().click();
    await page.locator('[data-disposition-revert]').first().click();
    await expect(page.locator('[data-change]').first()).toHaveAttribute('data-change-state', 'reverted');
    // Struck in the note, so the technician can see what left.
    await expect(page.locator('[data-correction-type="ins"]').first()).toHaveAttribute('data-correction-reverted', 'true');
    // And gone from what the EHR gets.
    expect(await shipped(page)).not.toContain('moved to the floor beside the client');
  });

  test('a removal can be taken back, in words', async ({ page }) => {
    await draft(page, ONE_ADD);
    await openDrawer(page);
    await page.locator('.dz-line').first().click();
    await page.locator('[data-disposition-revert]').first().click();
    await page.locator('.dz-line').first().click();
    await expect(page.locator('[data-disposition-revert]').first()).toHaveText('Put it back');
    await page.locator('[data-disposition-revert]').first().click();
    await expect(page.locator('[data-correction-type="ins"]').first()).toHaveAttribute('data-correction-reverted', 'false');
  });

  test('an edit lands in the note in the technician own wording', async ({ page }) => {
    await draft(page, ONE_ADD);
    await openDrawer(page);
    await page.locator('.dz-line').first().click();
    await page.locator('[data-disposition-editbtn]').first().click();
    const box = page.locator('[data-disposition-edit]').first();
    await box.fill('Staff sat on the floor beside him first.');
    await page.locator('[data-disposition-save]').first().click();
    await expect(page.locator('[data-corrections-section="antecedentNarrative"]')).toContainText('Staff sat on the floor beside him first.');
  });

  test('the section line says where in words, and takes you there', async ({ page }) => {
    await draft(page, ONE_ADD);
    await openDrawer(page);
    const where = page.locator('[data-change-goto]').first();
    await expect(where).toContainText(/Added to/);
    await expect(where).toContainText(/Antecedent/i);
    await where.click();
    await expect(page.locator('[data-section-key="antecedentNarrative"]')).toBeVisible();
  });

  test('the composer is one tap away and the drawer is not a dead end', async ({ page }) => {
    await draft(page, ONE_ADD);
    await openDrawer(page);
    await page.locator('[data-changes-tab="ask"]').click();
    await expect(page.locator('[data-changes-drawer]')).toHaveCount(0);
    await expect(page.locator('.revision-input')).toBeVisible();
  });
});

test.describe('on the phone they actually use', () => {
  const { defaultBrowserType, ...IPHONE } = devices['iPhone 14'];
  test.use(IPHONE);

  test('the drawer does not push the page sideways', async ({ page }) => {
    await draft(page, ONE_ADD);
    await openDrawer(page);
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('[data-changes-drawer]');
      return { doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, drawer: el.scrollWidth - el.clientWidth };
    });
    expect(overflow.doc).toBeLessThanOrEqual(1);
    expect(overflow.drawer).toBeLessThanOrEqual(1);
  });

  test('every answer is big enough for a thumb', async ({ page }) => {
    await draft(page, ONE_ADD);
    await openDrawer(page);
    await page.locator('.dz-line').first().click();
    const heights = await page.locator('.dz-act').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    heights.forEach((h) => expect(h).toBeGreaterThanOrEqual(32));
  });
});
