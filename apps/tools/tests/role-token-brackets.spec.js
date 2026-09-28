import { test, expect } from '@playwright/test';
import { correctionsSystem } from '../_worker.js';
import { isTriageCall } from './helpers/llm-call.js';

/* ROLE TOKENS READ [CLIENT], AND A NOTE WITH NO NAMES IN IT CARRIES NONE.
 *
 * His words, 2026-09-28: "Need them to all be [CLIENT] so I can audit them
 * easily for missed restored tokens - though there should not be any." The
 * mint was "Client--1". It is "[CLIENT]" now, "[CLIENT-2]" for a second person
 * of the same role, and the old shape is still READ so a saved draft or an
 * open session keeps restoring.
 *
 * And the report that came with it: his SAP input named nobody, and the SAP
 * output said Client--1 anyway. The scrub was traced on that exact input and
 * mints no person token for it (the first describe below pins that, in every
 * tool). The token was the model's. The corrections pass writes into the note
 * and runs on the expert prompt, which told it "People reach you as tokens like
 * Client--1 ... carry the token through exactly, both hyphens and the number
 * included". Handed an intake that opens with the bare word "Client", it wrote
 * the shape it had been told a client takes.
 */

const HIS_GOAL =
  'Client will tolerate delayed access to a preferred item or activity for up to 60 consecutive seconds ' +
  'without engaging in behaviors targeted for reduction in 80% of opportunities across 3 consecutive ' +
  'sessions, within 1 authorization period';
const HIS_SPECS =
  'Minimum 5 trials in acquisition, 3 trials in maintenance (over 5 consecutive maintenance probes to be ' +
  'maintained). DTT style in natural contexts with staff using items of natural interest (put a kindle ' +
  'nearby and point to it so following the point is directly reinforced). Use least to most prompts to ' +
  'help him wait - prompt another item, offer choice, touch cue, partial physical (maintained prompt for ' +
  'part of response) full physical (hand maintained on hand or shoulder/arm throughout waiting response) ' +
  'Error is not waiting, resisting prompts, or Bx reduction target occurrence.';

const ROLE_WORDS = ['Client', 'Caregiver', 'Parent', 'Mom', 'Dad', 'BT', 'RBT', 'BCBA', 'Staff', 'Teacher'];

/* Five pages carry the six ids: bt is the sessionNote build, and sup, assess
   and parent share the sessionNoteBcba build with sap on its own. */
const PAGES = [
  ['bt', '/notes/bt/'],
  ['sap', '/notes/bcba/index.html?tool=sap'],
  ['sup', '/notes/bcba/index.html?tool=sup'],
  ['assess', '/notes/bcba/index.html?tool=assess'],
  ['parent', '/notes/bcba/index.html?tool=parent'],
];

function tokenFor(tools) {
  const payload = { role: 'user', kid: 'pw:role-token', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.local-test`;
}

async function open(page, path = '/notes/bt/', tools = ['bt']) {
  await page.goto(path);
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor(tools));
  await page.reload();
  await page.waitForFunction(() => !!(window.NotesScrub && window.NotesGate && window.NotesGate._scrub));
}

/* The map the drafting path would mint, with the restore flag, which is the
   line between a word that comes back and a person who stays a token. */
const mapFor = (page, text) =>
  page.evaluate(async (t) => {
    const r = await window.NotesScrub.review({ freeText: t });
    return r.map.map((e) => ({ name: e.name, token: e.token, restore: !!e.restore }));
  }, text);

const persons = (map) => map.filter((e) => !e.restore);

/* The role each word he listed stands in for, and so the token it becomes. */
const ROLE_WORD_TOKEN = {
  Client: '[CLIENT]', Caregiver: '[CAREGIVER]', Parent: '[CAREGIVER]', Mom: '[CAREGIVER]',
  Dad: '[CAREGIVER]', BT: '[BT]', RBT: '[BT]', BCBA: '[BCBA]', Staff: '[STAFF]', Teacher: '[TEACHER]',
};

test.describe('a role word he typed becomes the role token, and nothing else in his input is a person', () => {
  for (const [id, path] of PAGES) {
    test(`${id}: "Client" in his exact two fields is [CLIENT], and Error and Bx are not people`, async ({ page }) => {
      await open(page, path, [id]);
      const map = await page.evaluate(async (t) => {
        const r = await window.NotesScrub.review({ freeText: t });
        return r.map.map((e) => ({ name: e.name, token: e.token, restore: !!e.restore, roleWord: !!e.roleWord }));
      }, HIS_GOAL + '\n' + HIS_SPECS);
      // The one token that stays is the role word he typed, as its role's tag.
      expect(persons(map), JSON.stringify(map)).toEqual([
        { name: 'Client', token: '[CLIENT]', restore: false, roleWord: true },
      ]);
      // Anything else taken leaves as an opaque token and comes back.
      for (const e of map.filter((x) => x.restore)) expect(e.token).toMatch(/^\[\[T\d+\]\]$/);
      const sent = await page.evaluate(([t, m]) => window.NotesScrub.applyMap(t, m), [HIS_GOAL, map]);
      expect(sent.startsWith('[CLIENT] will tolerate delayed access')).toBe(true);
    });

    test(`${id}: every role word at a sentence start is its role's token, never a name`, async ({ page }) => {
      await open(page, path, [id]);
      const found = await page.evaluate((words) => words.map((w) => {
        const text = `${w} will tolerate delayed access to a preferred item. ${w} waited.`;
        return { w, names: window.NotesGate._scrub.detectNames(text) };
      }), ROLE_WORDS);
      for (const { w, names } of found) {
        expect(names.map((n) => n.toLowerCase()), `${w} was read as a name`).not.toContain(w.toLowerCase());
      }
      for (const w of ROLE_WORDS) {
        const map = await mapFor(page, `${w} will tolerate delayed access to a preferred item or activity.`);
        expect(persons(map), w).toEqual([{ name: w, token: ROLE_WORD_TOKEN[w], restore: false }]);
      }
    });
  }

  test('a role word joins the person it labels, and a second caregiver word is a second caregiver', async ({ page }) => {
    await open(page);
    const map = await mapFor(page, 'Client Jacob eloped. Client was calm after. Mom Sarah called. Mom was upset. Dad picked up.');
    const by = (name) => map.find((e) => e.name === name).token;
    expect(by('Jacob')).toBe('[CLIENT]');
    expect(by('Client')).toBe('[CLIENT]');
    expect(by('Sarah')).toBe('[CAREGIVER]');
    expect(by('Mom')).toBe('[CAREGIVER]');
    expect(by('Dad')).toBe('[CAREGIVER-2]');
    // One put-back row per token, pre-filled with the name rather than the role word.
    const rows = await page.evaluate((m) => window.NotesScrub.roleTokenRows(m), map);
    expect(rows.map((r) => [r.token, r.name])).toEqual([['[CLIENT]', 'Jacob'], ['[CAREGIVER]', 'Sarah'], ['[CAREGIVER-2]', 'Dad']]);
  });

  test('a label, a title, a hyphen compound and lower-case prose are left as typed', async ({ page }) => {
    await open(page);
    const text = 'Parent Training went well. BT-led trials continued with staff using items. the client ate. BCBA Supervision is Friday.';
    const roleWords = await page.evaluate(async (t) => {
      const r = await window.NotesScrub.review({ freeText: t });
      return r.map.filter((e) => e.roleWord).map((e) => e.name);
    }, text);
    expect(roleWords).toEqual([]);
    const withClient = await mapFor(page, 'Client ate lunch, and the client napped. client Jacob slept.');
    const sent = await page.evaluate(([t, m]) => window.NotesScrub.applyMap(t, m),
      ['Client ate lunch, and the client napped. client Jacob slept.', withClient]);
    expect(sent).toBe('[CLIENT] ate lunch, and the client napped. client [CLIENT] slept.');
  });
});

test.describe('the mint: [CLIENT], then [CLIENT-2]', () => {
  test('a real name becomes exactly [CLIENT], and never restores', async ({ page }) => {
    await open(page);
    const map = await mapFor(page, 'Client Jacob eloped twice.');
    const jacob = map.find((e) => e.name === 'Jacob');
    expect(jacob).toEqual({ name: 'Jacob', token: '[CLIENT]', restore: false });
  });

  test('each role gets its own upper-case tag', async ({ page }) => {
    await open(page);
    const map = await mapFor(page, 'Client Jacob eloped. Mom Sarah called. Peer Ethan joined. BT Marcus ran it. BCBA Linda observed.');
    const by = Object.fromEntries(map.map((e) => [e.name, e.token]));
    expect(by).toMatchObject({
      Jacob: '[CLIENT]', Sarah: '[CAREGIVER]', Ethan: '[PEER]', Marcus: '[BT]', Linda: '[BCBA]',
    });
  });

  test('a second person of the same role is [CLIENT-2]', async ({ page }) => {
    await open(page);
    const map = await mapFor(page, 'Client Jacob and client Marcus both eloped.');
    expect(persons(map).map((e) => e.token).sort()).toEqual(['[CLIENT-2]', '[CLIENT]']);
  });

  test('a carried map seeds the count in either shape', async ({ page }) => {
    await open(page);
    const next = (seen) => page.evaluate((s) =>
      window.NotesScrub._defaultTokens(['Marcus'], 'Client Marcus arrived.', s)[0].token, seen);
    expect(await next([{ name: 'Jacob', token: '[CLIENT]', restore: false }])).toBe('[CLIENT-2]');
    expect(await next([{ name: 'Jacob', token: '[CLIENT-2]', restore: false }])).toBe('[CLIENT-3]');
    // A saved draft from before this change still holds the old shape.
    expect(await next([{ name: 'Jacob', token: 'Client--2', restore: false }])).toBe('[CLIENT-3]');
  });

  test('the bracketed tag crosses the wire, and the name does not', async ({ page }) => {
    const calls = [];
    await page.route('**/api/llm-call**', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}');
      if (!isTriageCall(b)) calls.push(b);
      const text = isTriageCall(b)
        ? JSON.stringify({ sufficient: true, readiness: 95, questions: [] })
        : JSON.stringify({ lessonProgressNarrative: 'ok', hints: [] });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text }] }) });
    });
    await open(page);
    await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money array, 8 of 10 gestural');
    await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('two minute warning before transitions');
    await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('Client Jacob eloped twice.');
    await page.getByRole('button', { name: 'Generate Note' }).click();
    await expect.poll(() => calls.length, { timeout: 30000 }).toBeGreaterThan(0);
    const sent = JSON.stringify(calls);
    expect(sent).toContain('[CLIENT]');
    expect(sent).not.toContain('Jacob');
    expect(sent).not.toMatch(/Client--\d/);
  });
});

test.describe('restore, rehydrate and the EHR copy read both shapes', () => {
  const MAP = [
    { name: 'Jacob', token: '[CLIENT]', restore: false },
    { name: 'Marcus', token: '[CLIENT-2]', restore: false },
    { name: 'Ethan', token: '[CLIENT-12]', restore: false },
    { name: 'Sarah', token: 'Caregiver--1', restore: false },
    { name: 'Red', token: '[[T101]]', restore: true },
  ];

  test('rehydrate gives back the word behind [CLIENT] and behind a legacy Client--1', async ({ page }) => {
    await open(page);
    const out = await page.evaluate((m) => window.NotesScrub.rehydrate(
      '[CLIENT], [CLIENT-2] and [CLIENT-12] played while Caregiver--1 watched.', m), MAP);
    expect(out).toBe('Jacob, Marcus and Ethan played while Sarah watched.');
  });

  test('restoreOutput puts the opaque word back and leaves every role token in the note', async ({ page }) => {
    await open(page);
    const out = await page.evaluate((m) => window.NotesScrub.restoreOutput(
      { a: '[CLIENT] held the [[T101]] card. [T101] again, then T101.', b: ['Caregiver--1 and [CLIENT-2] left.'] }, m), MAP);
    expect(out.a).toBe('[CLIENT] held the Red card. Red again, then Red.');
    expect(out.b).toEqual(['Caregiver--1 and [CLIENT-2] left.']);
  });

  test('no opaque or identifier restore can eat a role tag', async ({ page }) => {
    await open(page);
    const out = await page.evaluate(() => {
      // Numbers 1 and 2 issued in both restoring families, and no role entry,
      // so anything these passes do to a role tag they do on their own.
      const ids = window.NotesGate._scrub.buildIdentifierMap(
        'DOB 3/14/2019, 4/1/2019. Call (555) 213-4477 or (555) 213-4478. SSN 123-45-6789.');
      const map = [
        { name: 'Red', token: '[[T1]]', restore: true },
        { name: 'Blue', token: '[[T2]]', restore: true },
        ...ids,
      ];
      return {
        text: window.NotesGate._scrub.restoreDeep(
          '[CLIENT] [CLIENT-2] [TEACHER] [TEACHER-2] [BT] [BT-2] [STAFF-2] [T1]', map),
        types: ids.map((e) => e.token),
        tags: window.NotesScrub.ROLES.map((r) => r.tag),
      };
    });
    expect(out.text).toBe('[CLIENT] [CLIENT-2] [TEACHER] [TEACHER-2] [BT] [BT-2] [STAFF-2] Red');
    /* THE REAL GUARD, AND WHY THE SEPARATOR IS A HYPHEN. The identifier
       restorer reads [TYPE_N] loosely, so [CLIENT-2] would be put back if an
       identifier type were ever named after a role. It is not, and this says
       so on every run. */
    const identifierTypes = ['SSN', 'EMAIL', 'ADDRESS', 'DATE', 'PHONE', 'ID', 'ZIP'];
    for (const t of out.types) expect(identifierTypes).toContain(t.replace(/^\[|_\d+\]$/g, ''));
    for (const tag of out.tags) expect(identifierTypes).not.toContain(tag);
  });

  test('the EHR copy substitutes [CLIENT] and the legacy shape, edited or not', async ({ page }) => {
    await open(page);
    const out = await page.evaluate((m) => ({
      plain: window.NotesScrub.forEhr('[CLIENT] and [CLIENT-12] met Caregiver--1.', m),
      edited: window.NotesScrub.forEhr('[CLIENT] and [CLIENT-12] met Caregiver--1.', m, { '[CLIENT]': 'the client', 'Caregiver--1': '' }),
    }), MAP);
    expect(out.plain).toBe('Jacob and Ethan met Sarah.');
    // A blank override keeps the token, as the panel says.
    expect(out.edited).toBe('the client and Ethan met Caregiver--1.');
  });
});

test.describe('a Client--1 the model wrote on its own account', () => {
  test('an unissued legacy token in model output becomes the bracketed tag', async ({ page }) => {
    await open(page);
    const out = await page.evaluate(() => window.NotesScrub.restoreOutput(
      'Client--1 will wait. Caregiver--1 prompts. Client--2 stays as written.', []));
    // Number one of a role is the first person of it, which is [CLIENT]. A
    // higher number the note never issued is left visible for audit rather
    // than guessed at.
    expect(out).toBe('[CLIENT] will wait. [CAREGIVER] prompts. Client--2 stays as written.');
  });

  test('an ISSUED legacy token is left alone, so a saved draft still puts its name back', async ({ page }) => {
    await open(page);
    const map = [{ name: 'Jacob', token: 'Client--1', restore: false }];
    const out = await page.evaluate((m) => {
      const note = window.NotesScrub.restoreOutput('Client--1 will wait.', m);
      return { note, copy: window.NotesScrub.forEhr(note, m) };
    }, map);
    expect(out.note).toBe('Client--1 will wait.');
    expect(out.copy).toBe('Jacob will wait.');
  });

  test('the corrections prompt names the bracketed shape and retires the old one', () => {
    const composed = correctionsSystem('STORED RULES');
    expect(composed).toContain('[CLIENT]');
    expect(composed).toContain('[CLIENT-2]');
    expect(composed).toMatch(/never (write|mint|create)/i);
    expect(composed).not.toMatch(/Client--\d/);
  });

  test('SAP: his exact input, and a pass answer carrying Client--1, reach the page as [CLIENT]', async ({ page }) => {
    const SECTIONS = [
      'refinedGoal', 'purpose', 'teachingStrategy', 'lessonSetUp', 'sd',
      'correctResponse', 'incorrectResponse', 'masteryCriteria', 'promptHierarchy',
      'generalizationCriteria', 'maintenanceCriteria',
      'errorCorrectionInitial', 'errorCorrectionMaintenance',
    ];
    const plan = {};
    for (const id of SECTIONS) plan[id] = `The ${id} block, written in full.`;
    plan.refinedGoal = 'Client--1 will tolerate delayed access to a preferred item for up to 60 seconds.';
    const llm = [];
    const passes = [];
    await page.route('**/api/llm-call**', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}');
      llm.push(b);
      const text = isTriageCall(b)
        ? JSON.stringify({ sufficient: true, questions: [] })
        : JSON.stringify({ ...plan, reentryRule: 'Contact the BCBA.', hints: [], design: [], conflicts: [] });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }) });
    });
    await page.route('**/api/expert-pass**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
    await page.route('**/api/corrections-pass**', async (route) => {
      passes.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          corrections: [{ section: 'purpose', text: 'Teaches Client--1 to wait for a preferred item.', why: 'x', reasons: [] }],
          dropped: 0, usage: { input_tokens: 1, output_tokens: 1 }, model: 'test',
        }),
      });
    });
    await open(page, '/notes/bcba/index.html?tool=sap', ['sap']);
    await page.getByRole('textbox', { name: /Treatment Goal/i }).fill(HIS_GOAL);
    await page.getByRole('textbox', { name: /SAP Specifications/i }).fill(HIS_SPECS);
    await page.getByRole('button', { name: /Generate SAP/i }).click();
    await expect(page.getByText('Generated SAP Draft')).toBeVisible({ timeout: 30000 });

    // No name was typed, so the only token that stays is the role word.
    const scrubMap = await page.evaluate(() => window.NotesGate.draft.load('sap::map') || []);
    expect(scrubMap.filter((e) => !e.restore).map((e) => [e.name, e.token])).toEqual([['Client', '[CLIENT]']]);
    // And the model was handed the tag, not the word.
    const drafting = llm.filter((b) => !isTriageCall(b));
    expect(JSON.stringify(drafting)).toContain('[CLIENT] will tolerate delayed access');

    const note = page.getByTestId('generated-note');
    const text = () => note.evaluate((el) =>
      [el.innerText, ...[...el.querySelectorAll('textarea')].map((t) => t.value)].join('\n'));
    await expect.poll(text, { timeout: 20000 }).toContain('[CLIENT] will tolerate delayed access');
    if (passes.length) await expect.poll(text, { timeout: 20000 }).toContain('Teaches [CLIENT] to wait');
    expect(await text()).not.toMatch(/Client--\d/);
  });
});

test('the corrections pass gets the model\'s own "Client" as written, and his typed one as [CLIENT]', async ({ page }) => {
  const passes = [];
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const text = isTriageCall(b)
      ? JSON.stringify({ sufficient: true, readiness: 95, questions: [] })
      : JSON.stringify({
        individualsPresent: ['Client'],
        clinicalStatus: ['Presented Calm'],
        clinicalStatusNarrative: 'The client settled quickly on arrival.',
        purpose: ['Worked on goals as stated in the treatment plan'],
        servicePaused: 'No',
        abaTechniques: ['Discrete Trial Training'],
        lessonProgressNarrative: 'Client engaged well with the money array.',
        antecedentStrategies: ['Offered choices'],
        antecedentNarrative: 'A two minute warning preceded each transition.',
        consequenceStrategies: ['Redirection'],
        consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
        behaviorPlanNarrative: 'Elopement occurred on two occasions and the technician blocked the door.',
        clientProgress: 'Steady progress towards goals and behaviors',
        actionItems: ['None'],
        followUpNarrative: 'Direct staff do not report new questions or concerns for the BCBA.',
        hints: [],
      });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text }] }) });
  });
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
  await page.route('**/api/corrections-pass**', async (route) => {
    passes.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: [], dropped: 0 }) });
  });
  await open(page);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('Client did DTT money array, 8 of 10 gestural');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('two minute warning before transitions');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await expect.poll(() => passes.length, { timeout: 30000 }).toBeGreaterThan(0);
  const body = passes[0];
  expect(body.intake).toContain('[CLIENT] did DTT money array');
  const sec = body.draft.find((d) => d.id === 'lessonProgressNarrative');
  expect(sec && sec.text).toBe('Client engaged well with the money array.');
});

/* RESTORE REPLACES, IT NEVER INSERTS.
 *
 * His live SAP, 2026-09-28, after clicking Restore under a corrections pass:
 * "Once [CLIENT]Client--1 demonstrates mastery ... Generalization is met when
 * [CLIENT]Client--1 waits for 60 seconds". The SAP drafter writes [CLIENT]
 * because its prompt tells it to (tools/sap.js), the pass swapped it for
 * Client--1, the word diff drew a removal beside an addition, and Restore put
 * the removal back and left the addition. These drive the real rail button.
 */
test.describe('restoring a swapped token in the SAP', () => {
  const HIS_SECTION =
    'Once [CLIENT] demonstrates mastery at the FP level, introduce the target across three contexts: ' +
    'home, clinic and community. Generalization is met when [CLIENT] waits for 60 seconds without ' +
    'behaviors targeted for reduction in all three contexts at 80% accuracy or better.';

  async function sapWithPass(page, passText, drafted = HIS_SECTION) {
    const SECTIONS = [
      'refinedGoal', 'purpose', 'teachingStrategy', 'lessonSetUp', 'sd',
      'correctResponse', 'incorrectResponse', 'masteryCriteria', 'promptHierarchy',
      'generalizationCriteria', 'maintenanceCriteria',
      'errorCorrectionInitial', 'errorCorrectionMaintenance',
    ];
    const plan = {};
    for (const id of SECTIONS) plan[id] = `The ${id} block, written in full.`;
    plan.generalizationCriteria = drafted;
    await page.route('**/api/llm-call**', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}');
      const text = isTriageCall(b)
        ? JSON.stringify({ sufficient: true, questions: [] })
        : JSON.stringify({ ...plan, reentryRule: 'Contact the BCBA.', hints: [], design: [], conflicts: [] });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }) });
    });
    await page.route('**/api/expert-pass**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
    await page.route('**/api/corrections-pass**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        corrections: [{ section: 'generalizationCriteria', text: passText, why: 'Role token carried through.', reasons: [] }],
        dropped: 0, usage: { input_tokens: 1, output_tokens: 1 }, model: 'test',
      }),
    }));
    await open(page, '/notes/bcba/index.html?tool=sap', ['sap']);
    await page.getByRole('textbox', { name: /Treatment Goal/i }).fill(HIS_GOAL);
    await page.getByRole('button', { name: /Generate SAP/i }).click();
    await expect(page.getByText('Generated SAP Draft')).toBeVisible({ timeout: 30000 });
  }

  const sectionText = (page) => page.evaluate(() => {
    const el = document.querySelector('[data-corrections-section="generalizationCriteria"]');
    return el ? el.textContent : null;
  });

  test('his exact case: the pass writes Client--1 over [CLIENT], and the section never reads [CLIENT]Client--1', async ({ page }) => {
    await sapWithPass(page, HIS_SECTION.replace(/\[CLIENT\]/g, 'Client--1'));
    const note = page.getByTestId('generated-note');
    await expect(note).toContainText('Generalization is met when', { timeout: 20000 });
    // Restore every removal the rail offers, which is what he clicked.
    const undo = page.locator('[data-corrections-rail="generalizationCriteria"] [data-correction-undo]');
    for (let i = await undo.count(); i > 0; i--) {
      const first = undo.first();
      if (!(await first.isVisible().catch(() => false))) break;
      if ((await first.textContent()) !== 'Restore') break;
      await first.click();
    }
    const all = await note.evaluate((el) => el.textContent);
    expect(all).not.toContain('[CLIENT]Client--1');
    expect(all).not.toMatch(/Client--\d/);
    expect(all).toContain('Once [CLIENT] demonstrates mastery');
    expect(all).toContain('met when [CLIENT] waits for 60 seconds');
  });

  test('Restore on a swapped token puts the original in its place, at every occurrence, with one click', async ({ page }) => {
    await sapWithPass(page, HIS_SECTION.replace(/\[CLIENT\]/g, 'the learner'));
    await expect.poll(() => sectionText(page), { timeout: 20000 }).toContain('Once the learner demonstrates');
    await page.locator('[data-corrections-rail="generalizationCriteria"] [data-correction-undo]').first().click();
    const after = await sectionText(page);
    expect(after).toContain('Once [CLIENT] demonstrates mastery');
    expect(after).toContain('met when [CLIENT] waits for 60 seconds');
    expect(after).not.toContain('the learner');
    expect(after).not.toMatch(/\[CLIENT\]\S/);
  });

  test('one sentence, one swap: Restore never welds the old token to the new words', async ({ page }) => {
    // Before the fix this read "met when [CLIENT]the learner waits", the shape
    // of his "[CLIENT]Client--1".
    const one = 'Generalization is met when [CLIENT] waits for 60 seconds without behaviors targeted for reduction in all three contexts at 80% accuracy or better.';
    await sapWithPass(page, one.replace('[CLIENT]', 'the learner'), one);
    await expect.poll(() => sectionText(page), { timeout: 20000 }).toContain('met when the learner waits');
    await page.locator('[data-corrections-rail="generalizationCriteria"] [data-correction-undo]').first().click();
    const after = await sectionText(page);
    expect(after).toContain('met when [CLIENT] waits for 60 seconds');
    expect(after).not.toContain('the learner');
  });
});
