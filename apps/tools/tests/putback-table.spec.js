import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';
import { captureClipboard } from './helpers/clipboard.js';

/* THE PUT-BACK TABLE: HIS WORDS ON THE PAGE, TOKENS ON THE WIRE.
 *
 * His ask, 2026-09-28: "I should be able to key in a word in a field in the
 * generated area (not visible on initial entry) that simply maps [CLIENT] or
 * [CAREGIVER-1] etc. tokens to that matching token ... It dehydrates for any
 * review on a section of course, and maintains the rehydrations selected within
 * that page load. When the tab or window is opened again for a note page,
 * anything in there saved in the fields from prior calendar days is axed so a
 * fresh page greets daily."
 *
 * His ruling, 2026-10-02, option (a): "agreed, new generate, new tokens". A
 * word typed for [CLIENT] belongs to ONE note. Every Generate, every
 * Regenerate and every Clear empties the table, and nothing typed there is
 * written to storage, because the note itself does not survive a reload and a
 * saved word could only ever land on a different client's note.
 *
 * What existed before this: a checkbox-gated table under the note, pre-filled
 * with the scrubbed word, that substituted on the CLIPBOARD only, was not saved,
 * and reset on a tool switch. The note on the page kept its tokens.
 *
 * The half that matters most is the wire. A word he types is a real name, and
 * it is in no scrub map, so every model call is captured here and checked for it.
 */

const HIS_GOAL =
  'Client will tolerate delayed access to a preferred item or activity for up to 60 consecutive seconds ' +
  'without engaging in behaviors targeted for reduction in 80% of opportunities across 3 consecutive ' +
  'sessions, within 1 authorization period';

const NAME = 'Samwise';

function tokenFor(tools) {
  const payload = { role: 'user', kid: 'pw:putback', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.local-test`;
}

const SAP_SECTIONS = [
  'refinedGoal', 'purpose', 'teachingStrategy', 'lessonSetUp', 'sd',
  'correctResponse', 'incorrectResponse', 'masteryCriteria', 'promptHierarchy',
  'generalizationCriteria', 'maintenanceCriteria',
  'errorCorrectionInitial', 'errorCorrectionMaintenance',
];

function sapPlan() {
  const plan = {};
  for (const id of SAP_SECTIONS) plan[id] = `The ${id} block, written in full.`;
  plan.purpose = 'Teaches [CLIENT] to wait for a preferred item.';
  plan.refinedGoal = '[CLIENT] will wait up to 60 seconds for a preferred item.';
  return { ...plan, reentryRule: 'Contact the BCBA.', hints: [], design: [], conflicts: [] };
}

/* Every model-bound body, whatever the route: the drafting call, a revision,
   the expert pass and the corrections pass. */
async function captureModelCalls(page, bodies) {
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    bodies.push({ route: 'llm-call', body: b });
    let text;
    if (isTriageCall(b)) text = JSON.stringify({ sufficient: true, questions: [] });
    // A revision replays the conversation, so it carries more than one turn.
    else if ((b.messages || []).length > 1) text = JSON.stringify({ edits: [] });
    else text = JSON.stringify(sapPlan());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }) });
  });
  await page.route('**/api/expert-pass**', async (route) => {
    bodies.push({ route: 'expert-pass', body: JSON.parse(route.request().postData() || '{}') });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) });
  });
  await page.route('**/api/corrections-pass**', async (route) => {
    bodies.push({ route: 'corrections-pass', body: JSON.parse(route.request().postData() || '{}') });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: [], dropped: 0 }) });
  });
}

async function openSap(page) {
  await page.goto('/notes/bcba/index.html?tool=sap');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor(['sap']));
  await page.reload();
  await page.waitForFunction(() => !!(window.NotesScrub && window.NOTE_TOOLS && window.NOTE_TOOLS.length));
}

async function generateSap(page) {
  await page.getByRole('textbox', { name: /Treatment Goal/i }).fill(HIS_GOAL);
  await page.getByRole('button', { name: /Generate SAP/i }).click();
  await expect(page.getByText('Generated SAP Draft')).toBeVisible({ timeout: 30000 });
}

// The note's sections, not the table above them, which names its tokens.
const noteText = (page) => page.getByTestId('generated-note').evaluate((el) =>
  [...el.querySelectorAll('textarea[data-section-id], [data-corrections-section]')]
    .map((t) => (t.tagName === 'TEXTAREA' ? t.value : t.textContent)).join('\n'));

test.describe('the table', () => {
  test('is not on the page before there is output', async ({ page }) => {
    await openSap(page);
    await expect(page.getByTestId('put-back-panel')).toHaveCount(0);
  });

  test('lists the token for the role word he typed, and a word typed there hydrates the note', async ({ page }) => {
    const bodies = [];
    await captureModelCalls(page, bodies);
    await openSap(page);
    await generateSap(page);
    const field = page.getByTestId('put-back-input-[CLIENT]');
    await expect(field).toBeVisible();
    await field.fill(NAME);
    await expect.poll(() => noteText(page)).toContain(`Teaches ${NAME} to wait`);
    expect(await noteText(page)).not.toContain('[CLIENT]');
  });

  test('a blank field keeps the token', async ({ page }) => {
    const bodies = [];
    await captureModelCalls(page, bodies);
    await openSap(page);
    await generateSap(page);
    await expect(page.getByTestId('put-back-input-[CLIENT]')).toHaveValue('');
    expect(await noteText(page)).toContain('Teaches [CLIENT] to wait');
  });
});

test.describe('the wire stays dehydrated', () => {
  test('a revision of a section sends the token and never the word he typed', async ({ page }) => {
    const bodies = [];
    await captureModelCalls(page, bodies);
    await openSap(page);
    await generateSap(page);
    await page.getByTestId('put-back-input-[CLIENT]').fill(NAME);
    await expect.poll(() => noteText(page)).toContain(`Teaches ${NAME} to wait`);

    const before = bodies.length;
    await page.getByText('Purpose', { exact: true }).click();
    await expect(page.locator('.revision-panel')).toBeVisible();
    await page.locator('.revision-input').fill('make it one line');
    await page.locator('.revision-send').click();
    await expect.poll(() => bodies.slice(before).filter((b) => b.route === 'llm-call' && !isTriageCall(b.body)).length,
      { timeout: 30000 }).toBeGreaterThan(0);

    const sent = JSON.stringify(bodies.slice(before));
    expect(sent, 'his word reached the model').not.toContain(NAME);
    expect(sent).toContain('[CLIENT]');
  });

  test('a hand edit of a hydrated section is stored as the token', async ({ page }) => {
    const bodies = [];
    await captureModelCalls(page, bodies);
    await openSap(page);
    await generateSap(page);
    await page.getByTestId('put-back-input-[CLIENT]').fill(NAME);
    const box = page.locator('textarea[data-section-id="purpose"]');
    await expect(box).toHaveValue(`Teaches ${NAME} to wait for a preferred item.`);
    await box.fill(`Teaches ${NAME} to wait for a preferred item, then ask.`);
    await expect(box).toHaveValue(`Teaches ${NAME} to wait for a preferred item, then ask.`);
    // What the page holds for the section is what a revision quotes back.
    const before = bodies.length;
    await page.getByText('Purpose', { exact: true }).click();
    await page.locator('.revision-input').fill('tighten it');
    await page.locator('.revision-send').click();
    await expect.poll(() => bodies.slice(before).filter((b) => b.route === 'llm-call' && !isTriageCall(b.body)).length,
      { timeout: 30000 }).toBeGreaterThan(0);
    const sent = JSON.stringify(bodies.slice(before));
    expect(sent).toContain('Teaches [CLIENT] to wait for a preferred item, then ask.');
    expect(sent).not.toContain(NAME);
  });

  test('the drafting call and both passes carry no typed word even after a second generation', async ({ page }) => {
    const bodies = [];
    await captureModelCalls(page, bodies);
    await openSap(page);
    await generateSap(page);
    await page.getByTestId('put-back-input-[CLIENT]').fill(NAME);
    // Put his word in the intake too, as a technician might after reading the table.
    await page.getByRole('textbox', { name: /SAP Specifications/i }).fill(`Prompt ${NAME} with a touch cue.`);
    await page.getByRole('button', { name: /Generate SAP/i }).click();
    await expect.poll(() => bodies.filter((b) => b.route === 'llm-call' && !isTriageCall(b.body)).length, { timeout: 30000 }).toBeGreaterThan(1);
    expect(JSON.stringify(bodies)).not.toContain(NAME);
  });
});

/* The drafting call is the one non-triage llm-call that carries a single turn.
   A revision replays the conversation, so it carries more. */
const draftingCalls = (bodies) => bodies.filter((b) =>
  b.route === 'llm-call' && !isTriageCall(b.body) && (b.body.messages || []).length === 1).length;

const lastCopied = (page) => page.evaluate(() => navigator.clipboard.readText());

async function copyCard(page, id) {
  await page.locator(`[data-section-key="${id}"]`).getByRole('button', { name: 'Copy', exact: true }).click();
  return lastCopied(page);
}

async function regenerateSap(page, bodies) {
  const before = draftingCalls(bodies);
  await page.getByRole('button', { name: /Generate SAP/i }).click();
  await expect.poll(() => draftingCalls(bodies), { timeout: 30000 }).toBeGreaterThan(before);
  await expect(page.getByText('Generated SAP Draft')).toBeVisible({ timeout: 30000 });
}

test.describe('one note, one set of words (his ruling, 2026-10-02)', () => {
  test('a word typed for one note is gone from the table, the note and the copy after the next Generate', async ({ page }) => {
    const bodies = [];
    await captureModelCalls(page, bodies);
    await captureClipboard(page);
    await openSap(page);
    await generateSap(page);
    await page.getByTestId('put-back-input-[CLIENT]').fill(NAME);
    await expect.poll(() => noteText(page)).toContain(`Teaches ${NAME} to wait`);

    const before = bodies.length;
    await regenerateSap(page, bodies);

    await expect(page.getByTestId('put-back-input-[CLIENT]')).toHaveValue('');
    await expect.poll(() => noteText(page)).toContain('Teaches [CLIENT] to wait');
    expect(await noteText(page)).not.toContain(NAME);
    const copied = await copyCard(page, 'purpose');
    expect(copied).toContain('[CLIENT]');
    expect(copied, 'the last note’s word reached the next note’s copy').not.toContain(NAME);

    const sent = JSON.stringify(bodies.slice(before));
    expect(sent).toContain('[CLIENT]');
    expect(sent).not.toContain(NAME);
  });

  test('within one note the word holds through a revision, in the note and in the copy', async ({ page }) => {
    const bodies = [];
    await captureModelCalls(page, bodies);
    await captureClipboard(page);
    await openSap(page);
    await generateSap(page);
    await page.getByTestId('put-back-input-[CLIENT]').fill(NAME);

    const before = bodies.length;
    await page.getByText('Purpose', { exact: true }).click();
    await page.locator('.revision-input').fill('make it one line');
    await page.locator('.revision-send').click();
    await expect.poll(() => bodies.slice(before).filter((b) => b.route === 'llm-call' && !isTriageCall(b.body)).length,
      { timeout: 30000 }).toBeGreaterThan(0);

    // A revision is the same note, so nothing he typed is dropped by it.
    await expect(page.getByTestId('put-back-input-[CLIENT]')).toHaveValue(NAME);
    await expect.poll(() => noteText(page)).toContain(`Teaches ${NAME} to wait`);
    const copied = await copyCard(page, 'purpose');
    expect(copied).toContain(`Teaches ${NAME} to wait`);
    expect(copied).not.toContain('[CLIENT]');

    const sent = JSON.stringify(bodies.slice(before));
    expect(sent).toContain('[CLIENT]');
    expect(sent, 'his word reached the model').not.toContain(NAME);
  });

  test('Clear empties the table for the next intake', async ({ page }) => {
    const bodies = [];
    await captureModelCalls(page, bodies);
    await openSap(page);
    await generateSap(page);
    await page.getByTestId('put-back-input-[CLIENT]').fill(NAME);

    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /^Clear/ }).click();
    await expect(page.getByTestId('put-back-panel')).toHaveCount(0);

    await generateSap(page);
    await expect(page.getByTestId('put-back-input-[CLIENT]')).toHaveValue('');
    expect(await noteText(page)).not.toContain(NAME);
  });
});

test.describe('the outbound lock', () => {
  test('takes a typed word back to its token, and never rewrites inside a token already there', async ({ page }) => {
    await openSap(page);
    const out = await page.evaluate(() => {
      const d = window.NotesGate._scrub.dehydrateWords;
      return {
        plain: d('Samwise waited, then Samwise asked.', [{ token: '[CLIENT]', word: 'Samwise' }]),
        // A word spelled like a token's own letters must leave the tokens whole.
        inside: d('CLIENT met [CLIENT-2] and [CLIENT].', [{ token: '[CLIENT]', word: 'CLIENT' }]),
        opaque: d('Used [[T1]] with T1.', [{ token: '[CLIENT]', word: 'T1' }]),
      };
    });
    expect(out.plain).toBe('[CLIENT] waited, then [CLIENT] asked.');
    expect(out.inside).toBe('[CLIENT] met [CLIENT-2] and [CLIENT].');
    expect(out.opaque).toBe('Used [[T1]] with [CLIENT].');
  });
});

test.describe('nothing typed there is written to storage', () => {
  test('a typed word is never saved, so a reload and a new note start blank', async ({ page }) => {
    const bodies = [];
    await captureModelCalls(page, bodies);
    await openSap(page);
    await generateSap(page);
    await page.getByTestId('put-back-input-[CLIENT]').fill(NAME);
    await expect.poll(() => noteText(page)).toContain(`Teaches ${NAME} to wait`);
    // The draft store encrypts in the background, so give a write time to land.
    await page.waitForTimeout(500);

    const stored = await page.evaluate(() => ({
      keys: Object.keys(localStorage).filter((k) => k.indexOf('putback') !== -1),
      plain: Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n'),
      decrypted: JSON.stringify(['sap', 'sap::map', 'sap::copied', 'sap::putback'].map((k) => window.NotesGate.draft.load(k))),
    }));
    expect(stored.keys).toEqual([]);
    expect(stored.plain).not.toContain(NAME);
    expect(stored.decrypted, 'his word sits in the draft store').not.toContain(NAME);

    await page.reload();
    await page.waitForFunction(() => !!(window.NotesScrub && window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    await generateSap(page);
    await expect(page.getByTestId('put-back-input-[CLIENT]')).toHaveValue('');
    await expect.poll(() => noteText(page)).toContain('Teaches [CLIENT] to wait');
    expect(await noteText(page)).not.toContain(NAME);
  });

  test('a clear that lands while a save is still encrypting leaves nothing behind', async ({ page }) => {
    await openSap(page);
    const left = await page.evaluate(async () => {
      window.NotesGate.draft.save('sap::race', { w: 'Racer' });
      window.NotesGate.draft.clear('sap::race');
      await new Promise((r) => setTimeout(r, 500));
      return localStorage.getItem('notes_draft_sap::race');
    });
    expect(left, 'the encrypted write landed after the clear').toBeNull();
  });

  /* An earlier build of this table saved the words per tool under
     `<tool>::putback`. Any such record is deleted when the page mounts, on
     every tool, so nothing typed under it can come back into a later note. */
  const PAGES = [
    ['bt', '/notes/bt/'],
    ['sap', '/notes/bcba/index.html?tool=sap'],
    ['sup', '/notes/bcba/index.html?tool=sup'],
    ['assess', '/notes/bcba/index.html?tool=assess'],
    ['parent', '/notes/bcba/index.html?tool=parent'],
  ];
  for (const [id, path] of PAGES) {
    test(`${id}: a word saved by an earlier build is deleted on load`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor([id]));
      await page.reload();
      // Seed only after the page has mounted, or its own sweep on mount races
      // the seed and deletes it before this test can look.
      await page.waitForSelector('textarea', { timeout: 30000 });
      const k = `${id}::putback`;
      const today = await page.evaluate(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });
      await page.evaluate(([key, day]) => window.NotesGate.draft.save(key, { day, words: { '[CLIENT]': 'Stale' } }), [k, today]);
      await expect.poll(() => page.evaluate((key) => localStorage.getItem('notes_draft_' + key), k)).not.toBeNull();

      await page.reload();
      await page.waitForSelector('textarea', { timeout: 30000 });
      await expect.poll(() => page.evaluate((key) => window.NotesGate.draft.load(key), k)).toBeNull();
      expect(await page.evaluate((key) => localStorage.getItem('notes_draft_' + key), k)).toBeNull();
    });
  }
});

