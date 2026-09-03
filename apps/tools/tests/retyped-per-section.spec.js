import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';
import { AUDIT_TYPES, sanitizeAuditEvent } from '../_worker.js';

/* HIS UPGRADE 03, ORDERED 2026-09-03 with a plain "yes".

   note_copied already carries `edited`: how many characters of the draft the
   technician retyped before it went into the EHR. It is the tool's best single
   measure of where the model is costing someone effort, and it is one number
   for a note with five narrative sections in it. A section the model gets wrong
   on every single note reads exactly the same as five sections it gets slightly
   wrong, which is the one distinction that would tell anybody what to fix.

   SO THE SAME MEASUREMENT, SPLIT BY SECTION, and split from the SAME arithmetic
   rather than a second pass over the same text: the parts have to sum to the
   whole or one of the two numbers is lying and there is no way to tell which.

   ITS OWN EVENT, NOT MORE KEYS ON note_copied. The client sanitiser keeps the
   first twelve keys of a payload and drops the rest in silence. note_copied
   already spends three, a note has five narrative sections, and sup has five
   too; sharing one budget would work now and start losing whichever section
   sorted last the first time a tool grew a section. note_postpass, note_hints
   and note_register are all separate events for this reason.

   CONTENT-FREE BY CONSTRUCTION: a character count against a section id, and the
   sanitisers on both sides admit numbers and nothing that is not one. The last
   test here is the one that keeps that true. */

const tokenFor = (role = 'user') => {
  const p = { role, kid: 'retyped-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
};

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const NOTE = {
  individualsPresent: ['Client'],
  clinicalStatus: ['Presented Calm'],
  clinicalStatusNarrative: 'The client met the technician at the door and settled quickly into the session space.',
  purpose: ['Worked on goals as stated in the treatment plan'],
  servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'Eight of ten trials came back correct with a gestural prompt across the money array.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'A two minute warning preceded each transition and the client moved without protest.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions and the technician blocked the door and redirected.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
};

async function draftAndWatch(page) {
  const events = [];
  await page.route('**/api/audit**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    (body.events || []).forEach((e) => events.push(e));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"stored":1,"profile":"ok"}' });
  });
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(NOTE));
  });

  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto('/notes/bt/');

  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, 8 of 10 gestural');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('two minute warning before transitions');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();

  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
  return events;
}

const retype = async (page, sectionId, text) => {
  const box = page.locator(`textarea[data-section-id="${sectionId}"]`);
  await expect(box, `no editable ${sectionId} on the drafted note, so this test checks nothing`)
    .toBeVisible({ timeout: 10000 });
  await box.fill(text);
};

const copyAll = async (page) => {
  const buttons = page.getByRole('button', { name: /^Copy$/ });
  const n = await buttons.count();
  expect(n, 'the note rendered no Copy buttons').toBeGreaterThan(0);
  await buttons.first().click();
  await page.waitForTimeout(1200);
};

const one = (events, type) => events.filter((e) => e.type === type);

/* `tool` rides inside data on every event the engine emits, so it is one of the
   twelve keys the client sanitiser keeps and not a wrapper around them. Five
   narrative sections plus it is six, which is the headroom this event has. */
const sections = (data) => {
  const out = { ...data };
  delete out.tool;
  return out;
};

test.describe('how much of each section the technician retyped', () => {
  test('names the sections that were rewritten and stays quiet about the rest', async ({ page }) => {
    const events = await draftAndWatch(page);
    await retype(page, 'lessonProgressNarrative', 'Ran the money array. Eight right out of ten, gestural prompt each time, and he needed fewer of them by the end.');
    await retype(page, 'behaviorPlanNarrative', 'He bolted twice. I blocked the door both times and got him back to the table.');
    await copyAll(page);

    const [retyped] = one(events, 'note_retyped');
    expect(retyped, 'no note_retyped event arrived at all').toBeTruthy();
    expect(Object.keys(sections(retyped.data)).sort()).toEqual(['behaviorPlanNarrative', 'lessonProgressNarrative']);
    expect(retyped.data.lessonProgressNarrative).toBeGreaterThan(0);
    expect(retyped.data.behaviorPlanNarrative).toBeGreaterThan(0);
    expect(retyped.tool).toBe('bt');
  });

  test('the parts add up to the whole note figure that was already being sent', async ({ page }) => {
    /* THE POINT OF THE TEST. Two numbers measuring one thing, computed twice,
       will drift; the only defence is that they come from one arithmetic. If
       this ever fails, the split is wrong or the total is, and nothing in the
       store would say which. */
    const events = await draftAndWatch(page);
    await retype(page, 'clinicalStatusNarrative', 'He came in flat and it took him a minute to settle.');
    await retype(page, 'followUpNarrative', 'Ask the BCBA whether the transition warning should go to five minutes.');
    await copyAll(page);

    const [retyped] = one(events, 'note_retyped');
    const [copied] = one(events, 'note_copied');
    expect(retyped, 'no note_retyped event arrived at all').toBeTruthy();
    expect(copied, 'no note_copied event arrived at all').toBeTruthy();
    const sum = Object.values(sections(retyped.data)).reduce((a, b) => a + b, 0);
    expect(sum).toBe(copied.data.edited);
  });

  test('an untouched note sends no split at all, because there is nothing to split', async ({ page }) => {
    const events = await draftAndWatch(page);
    await copyAll(page);

    expect(one(events, 'note_copied').length, 'the note was copied but never recorded').toBe(1);
    expect(one(events, 'note_copied')[0].data.edited).toBe(0);
    expect(one(events, 'note_retyped')).toEqual([]);
  });

  test('every key is one of the tool\'s own section ids and every value is a number', async ({ page }) => {
    const events = await draftAndWatch(page);
    await retype(page, 'antecedentNarrative', 'Gave him a two minute heads up before each switch and he came without a fight.');
    await copyAll(page);

    const [retyped] = one(events, 'note_retyped');
    expect(retyped).toBeTruthy();
    const ids = await page.evaluate(() => window.NOTE_TOOLS.find((t) => t.id === 'bt')
      .formSections.filter((s) => s.kind === 'narrative').map((s) => s.key || s.group));
    Object.entries(sections(retyped.data)).forEach(([k, v]) => {
      expect(ids, `${k} is not a section of this tool`).toContain(k);
      expect(typeof v, `${k} carried a ${typeof v} rather than a count`).toBe('number');
      expect(Number.isInteger(v)).toBe(true);
    });
  });
});

test.describe('the split reaches the store rather than the door', () => {
  test('note_retyped is named in the server allowlist', () => {
    /* The failure this repo has now shipped six times: engine.jsx emits a type,
       AUDIT_TYPES does not name it, sanitizeAuditEvent returns null, handleAudit
       answers 200 with stored:0 because zero-accepted and nothing-to-do share a
       response shape, and the browser drops the batch as delivered. The source
       scan in audit-events.spec.js is what catches the next one; this is the
       direct check for this one. */
    expect(AUDIT_TYPES.has('note_retyped')).toBe(true);
  });

  test('and the sanitiser keeps the counts while admitting no text', () => {
    const clean = sanitizeAuditEvent({
      type: 'note_retyped',
      tool: 'bt',
      ts: Date.now(),
      data: {
        lessonProgressNarrative: 118,
        behaviorPlanNarrative: 76,
        // Anything that is not a count must not survive, whatever it is keyed by.
        clinicalStatusNarrative: 'He came in flat and it took him a minute to settle.',
      },
    });
    expect(clean).toBeTruthy();
    expect(clean.data.lessonProgressNarrative).toBe(118);
    expect(clean.data.behaviorPlanNarrative).toBe(76);
    expect(clean.data.clinicalStatusNarrative).toBeUndefined();
  });
});
