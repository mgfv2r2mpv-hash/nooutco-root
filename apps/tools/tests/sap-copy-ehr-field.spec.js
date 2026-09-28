import { test, expect } from '@playwright/test';
import { captureClipboard } from './helpers/clipboard.js';

/* ONE COPY PER EHR FIELD, NOT ONE PER CARD.
 *
 * His words: "the fields still go into the EHR in the four sections that I
 * indicated for skill acquisition programs. I do expect that I can copy for an
 * entire section, not each of the subsections that we had to break it down into
 * for the expert to understand the shape of the response."
 *
 * The four fields are the ones sap.js already declares as COPY_GROUPS:
 * Treatment Goal (Refined), Exercise, Generalization, Error Correction. The
 * thirteen cards stay for reading and editing. Before this file, the only ways
 * to get a field onto the clipboard were Copy All (all four at once) or one card
 * at a time (eight separate pastes for Exercise alone).
 *
 * Each field's Copy must put that field's parts on the clipboard in order, with
 * the labels typed inside exactly as Copy All types them, and must hand every
 * part through the same put-back the per-card Copy uses.
 */

const SECTIONS = [
  'refinedGoal', 'purpose', 'teachingStrategy', 'lessonSetUp', 'sd',
  'correctResponse', 'incorrectResponse', 'masteryCriteria', 'promptHierarchy',
  'generalizationCriteria', 'maintenanceCriteria',
  'errorCorrectionInitial', 'errorCorrectionMaintenance',
];

const FIELDS = [
  { heading: 'Treatment Goal (Refined)', parts: [['refinedGoal', '']] },
  {
    heading: 'Exercise',
    parts: [
      ['purpose', 'Purpose'],
      ['teachingStrategy', 'Teaching Strategy'],
      ['lessonSetUp', 'Lesson Set Up'],
      ['sd', 'SD (Demand / Discriminative Stimulus)'],
      ['correctResponse', 'Correct Response'],
      ['incorrectResponse', 'Incorrect Response'],
      ['masteryCriteria', 'Mastery Criteria'],
      ['promptHierarchy', 'Prompt Hierarchy'],
    ],
  },
  {
    heading: 'Generalization',
    parts: [['generalizationCriteria', 'Generalization Criteria'], ['maintenanceCriteria', 'Maintenance Criteria']],
  },
  {
    heading: 'Error Correction',
    parts: [['errorCorrectionInitial', 'During Initial Teaching'], ['errorCorrectionMaintenance', 'During Maintenance']],
  },
];

const GOAL = 'Client Jacob will label 10 common objects in 80% of opportunities across 3 sessions.';

function tokenFor() {
  const payload = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['sap'] };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

/* The goal line as it reached the wire, so whatever token the scrub minted for
   "Jacob" comes back in the draft in its own shape. That keeps this file
   independent of what a role token looks like. */
function echoedGoal(body) {
  const text = (body.messages || []).map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
  return (text.split('\n').find((l) => /label 10 common objects/.test(l)) || '').trim();
}

function plan(goalLine) {
  const out = {};
  for (const id of SECTIONS) out[id] = `The ${id} block.`;
  // Two sections carry the token, one in a single-part field and one inside
  // Exercise, so the put-back is exercised on both kinds of field.
  out.refinedGoal = goalLine || 'The refinedGoal block.';
  out.purpose = `${goalLine || ''} Purpose follows from it.`.trim();
  return { ...out, reentryRule: 'After 2 consecutive probes below criteria, contact the BCBA.', hints: [], design: [], conflicts: [] };
}

async function sapPage(page) {
  await page.goto('/notes/bcba/index.html?tool=sap');
  await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
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

async function draft(page) {
  let calls = 0;
  await page.route('**/api/llm-call**', async (route) => {
    calls++;
    if (calls === 1) return route.fulfill(reply({ sufficient: true, questions: [] }));
    const body = JSON.parse(route.request().postData() || '{}');
    if (calls === 2) return route.fulfill(reply(plan(echoedGoal(body))));
    return route.fulfill(reply({ edits: [] }));
  });
  await captureClipboard(page);
  await sapPage(page);
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await sapPage(page);
  await page.getByRole('textbox', { name: /Treatment Goal/i }).fill(GOAL);
  await page.getByRole('button', { name: /Generate SAP/i }).click();
  await acceptScrubGate(page);
  await expect(page.getByText('Generated SAP Draft')).toBeVisible({ timeout: 30000 });
}

// captureClipboard keeps every write, and its readText returns the newest.
const lastCopied = (page) => page.evaluate(() => navigator.clipboard.readText());

async function copyCard(page, id) {
  await page.locator(`[data-section-key="${id}"]`).getByRole('button', { name: 'Copy', exact: true }).click();
  return lastCopied(page);
}

async function copyField(page, heading) {
  await page.getByRole('button', { name: `Copy ${heading}`, exact: true }).click();
  return lastCopied(page);
}

/* What the field should hold, built from what each card's own Copy hands back.
   Same labels and separators as Copy All, minus the field name itself, which
   is the box on the EHR form rather than text typed into it. */
async function expectedField(page, field) {
  const bodies = [];
  for (const [id, label] of field.parts) {
    const text = await copyCard(page, id);
    if (!text.trim()) continue;
    bodies.push(label ? `${label}:\n${text}` : text);
  }
  return bodies.join('\n\n');
}

test.describe('each EHR field has its own Copy', () => {
  test('there is one Copy per field, four in all', async ({ page }) => {
    await draft(page);
    for (const field of FIELDS) {
      await expect(page.getByRole('button', { name: `Copy ${field.heading}`, exact: true })).toHaveCount(1);
    }
    // The cards keep their own Copy for reading and editing.
    await expect(page.getByTestId('generated-note').getByRole('button', { name: 'Copy', exact: true }))
      .toHaveCount(SECTIONS.length);
  });

  for (const field of FIELDS) {
    test(`${field.heading} copies every part of the field, in order`, async ({ page }) => {
      await draft(page);
      const copied = await copyField(page, field.heading);

      let at = -1;
      for (const [id, label] of field.parts) {
        const prose = id === 'refinedGoal' || id === 'purpose' ? 'label 10 common objects' : `The ${id} block.`;
        const where = copied.indexOf(label ? `${label}:\n` : prose);
        expect(where, `${id} is missing from the ${field.heading} copy`).toBeGreaterThan(at);
        at = where;
      }
      // Only this field: nothing from a neighbouring one.
      for (const other of FIELDS.filter((f) => f !== field)) {
        for (const [id] of other.parts) {
          if (id === 'refinedGoal' || id === 'purpose') continue;
          expect(copied, `${id} leaked into ${field.heading}`).not.toContain(`The ${id} block.`);
        }
      }
      // The field name is the box on the form, so it is not typed into it.
      expect(copied.startsWith(`${field.heading}\n`)).toBe(false);
    });
  }

  test('a field copy is exactly its cards joined, token put-back off', async ({ page }) => {
    await draft(page);
    for (const field of FIELDS) {
      const whole = await copyField(page, field.heading);
      expect(whole).toBe(await expectedField(page, field));
    }
  });

  test('a field copy restores tokens exactly as the card copy does', async ({ page }) => {
    await draft(page);
    const panel = page.getByTestId('put-back-toggle');
    await expect(panel, 'the draft carried no role token, so this proves nothing').toBeVisible();
    await panel.check();

    for (const field of FIELDS) {
      const whole = await copyField(page, field.heading);
      expect(whole).toBe(await expectedField(page, field));
    }
    const goal = await copyField(page, 'Treatment Goal (Refined)');
    expect(goal, 'the clinician word did not reach the clipboard').toContain('Jacob');
    const exercise = await copyField(page, 'Exercise');
    expect(exercise).toContain('Jacob');
  });

  test('Copy All still hands back the four fields with their names', async ({ page }) => {
    await draft(page);
    await page.getByRole('button', { name: 'Copy All', exact: true }).click();
    const all = await lastCopied(page);
    const parts = [];
    for (const field of FIELDS) parts.push(`${field.heading}\n${await expectedField(page, field)}`);
    expect(all).toBe(parts.join('\n\n'));
  });
});
