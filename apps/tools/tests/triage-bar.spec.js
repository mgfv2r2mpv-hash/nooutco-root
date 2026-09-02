import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';
import { refusedKeywords } from './helpers/schema.js';

/* The bar triage takes its reading against.
 *
 * The readiness number has been model-judged since it shipped, against four
 * bands describing gaps in general terms. It now has something specific to be a
 * reading of: the maintainer's own ten-item completeness bar, which lives in
 * voice-module and reaches bt through the stored prompt rather than through any
 * file the browser downloads. 85 is the line because 85 is what the bar is.
 *
 * Two things follow, and both are here.
 *
 * EVERY QUESTION NAMES THE ITEM IT CAME FROM, in `bar`. Nothing shows it. It is
 * what the audit trail carries, and it is the only way to find out which parts
 * of the bar a technician's notes actually fail - which is the number he would
 * tune the bar against. A model-written string on its way into the one durable
 * per-technician record has to be held to a shape rather than trusted, so the
 * engine keeps "B4" and drops everything that is not an id.
 *
 * THE QUESTION CEILING MOVES WITH THE READING. His ruling of 2026-08-31:
 * "Minimize them but a truly bad note may need more than 3 clarifications." A
 * note that is nearly ready cannot be improved by five questions, and a note
 * that is barely a note cannot be rescued by one.
 */

function tokenFor(tools = ['bt']) {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const note = () => ({
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
  hints: [],
});

/* Drive bt to the gap questions and keep what the page sent while doing it. The
   audit route matters as much as the schema: `bar` is never drawn, so the audit
   row is the only place its value is observable at all. */
async function ask(page, triage) {
  const seen = { triageSchema: null, audits: [] };
  await page.route('**/api/audit**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    (b.events || []).forEach((e) => seen.audits.push(e));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"stored":0}' });
  });
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const last = (b.messages && b.messages.length) ? String(b.messages[b.messages.length - 1].content || '') : '';
    if (/look at your own draft again/i.test(last)) return route.fulfill(reply(note()));
    if (isTriageCall(b)) {
      seen.triageSchema = b.output_config && b.output_config.format && b.output_config.format.schema;
      if (/ALREADY ANSWERED/.test(last)) return route.fulfill(reply({ sufficient: true, readiness: 90, questions: [] }));
      return route.fulfill(reply(triage));
    }
    return route.fulfill(reply(note()));
  });

  await page.goto('/notes/bt/');
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto('/notes/bt/');
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, needed full physical most of it');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board, also moved to the floor and he settled');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  return seen;
}

// Five questions, so every band below is testing its own ceiling rather than
// the length of the list the model happened to return.
const five = (readiness, bars = ['B4', 'B5', 'B6', 'B7', 'B9']) => ({
  sufficient: false,
  readiness,
  questions: bars.map((bar, i) => ({
    field: 'fAntecedent',
    question: `Question number ${i + 1} about the session.`,
    suggestions: [],
    bar,
  })),
});

/* ── The prompt, which is where the ceiling and the field are stated ─────── */

test.describe('the prompt that sets the ceiling', () => {
  test('the ceiling is stated as bands rather than as a flat three', async ({ page }) => {
    await page.goto('/notes/bt/');
    const t = await page.evaluate(() => window.NoteTriagePrompt);
    expect(t.readiness).toContain('HOW MANY TO ASK');
    // Each band names its own ceiling, and the bottom one is the reason this
    // exists: a truly bad note may need more than three.
    expect(t.readiness).toMatch(/85-100\s+At most 1/);
    expect(t.readiness).toMatch(/60-84\s+At most 2/);
    expect(t.readiness).toMatch(/30-59\s+At most 3/);
    expect(t.readiness).toMatch(/0-29\s+At most 5/);
  });

  test('no triage prompt still asserts a flat ceiling of three', async ({ page }) => {
    await page.goto('/notes/bt/');
    const prompts = await page.evaluate(() => {
      const out = { shared: window.NoteTriagePrompt.full };
      (window.NOTE_TOOLS || []).forEach((t) => { if (t.triageSystem) out[t.id] = t.triageSystem; });
      return out;
    });
    expect(Object.keys(prompts).length, 'no tool override was loaded to check').toBeGreaterThan(1);
    // Two ceilings in one prompt is the defect this shape has already produced
    // once, when bt's rules block named a different object than the readiness
    // block did. A band table under a hard three is the same mistake.
    for (const [name, text] of Object.entries(prompts)) {
      expect(text, `${name} still asks for at most 3`).not.toMatch(/at most 3 short/i);
      expect(text, `${name} still calls three the ceiling`).not.toMatch(/three is a ceiling/i);
      // And the same shape, for the same reason: a partial object stated in a
      // tool's own rules is a second object once the readiness block states the
      // real one.
      expect(text, `${name} states a second object shape`)
        .not.toMatch(/Return ONLY a JSON object: \{/);
    }
  });

  test('the closing shape line names the field the questions carry', async ({ page }) => {
    await page.goto('/notes/bt/');
    const readiness = await page.evaluate(() => window.NoteTriagePrompt.readiness);
    expect(readiness).toContain('"bar"');
    // A tool whose prompt supplies no bar has to be told what to send, or it
    // sends whatever it thinks the field means.
    expect(readiness).toMatch(/where this prompt has given you one/i);
    expect(readiness).toMatch(/Never invent an id/i);
  });
});

/* ── The schema, which is what the model is actually held to ─────────────── */

test.describe('the posted schema', () => {
  test('every question is required to carry a bar id', async ({ page }) => {
    const seen = await ask(page, { sufficient: true, readiness: 95, questions: [] });
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
    const q = seen.triageSchema.properties.questions.items;
    expect(q.required, 'a key the model may omit is a key half the tools will omit').toContain('bar');
    expect(q.properties.bar.type).toBe('string');
  });

  test('it carries no keyword the API refuses', async ({ page }) => {
    const seen = await ask(page, { sufficient: true, readiness: 95, questions: [] });
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
    expect(refusedKeywords(seen.triageSchema, 'triage schema')).toEqual([]);
  });
});

/* ── The ceiling as a bound, not a request ──────────────────────────────── */

test.describe('how many questions the reading buys', () => {
  test('a nearly ready note gets one question however many the model sent', async ({ page }) => {
    await ask(page, five(90));
    await expect(page.getByText(/Question number 1 /)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Question number 2 /)).toHaveCount(0);
  });

  test('a note that is barely a note gets all five', async ({ page }) => {
    await ask(page, five(10));
    await expect(page.getByText(/Question number 5 /)).toBeVisible({ timeout: 20000 });
  });

  test('a middling note gets three', async ({ page }) => {
    await ask(page, five(45));
    await expect(page.getByText(/Question number 3 /)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Question number 4 /)).toHaveCount(0);
  });

  test('a reading the model left out keeps the three the tool asked for before there was one', async ({ page }) => {
    const noReading = five(0);
    delete noReading.readiness;
    await ask(page, noReading);
    await expect(page.getByText(/Question number 3 /)).toBeVisible({ timeout: 20000 });
    // Not five. A missing reading is not evidence of a bad note, and handing
    // out the bottom band's allowance on no evidence spends the technician's
    // attention on the tool's own uncertainty.
    await expect(page.getByText(/Question number 4 /)).toHaveCount(0);
  });
});

/* ── The id, on its way to the only place it is kept ─────────────────────── */

test.describe('the item each question came from', () => {
  test('the audit row carries the ids, deduped, and nothing else from the question', async ({ page }) => {
    const seen = await ask(page, five(45, ['B4', 'B4', 'B7']));
    await expect(page.getByText(/Question number 3 /)).toBeVisible({ timeout: 20000 });
    await expect.poll(() => seen.audits.filter((e) => e.type === 'gap_questions').length,
      { timeout: 15000 }).toBeGreaterThan(0);
    const row = seen.audits.filter((e) => e.type === 'gap_questions').find((e) => e.data && e.data.bars);
    expect(row, 'the ids never reached the audit trail').toBeTruthy();
    expect(row.data.bars).toBe('B4-B7');
    expect(row.data.readiness).toBe(45);
    // Hyphen-joined rather than an array because the sanitiser keeps a short
    // token and drops an array without saying so. This is the test that fails
    // if the join character ever stops matching what it accepts.
    expect(row.data.bars).toMatch(/^[a-z0-9_-]{1,24}$/i);
    expect(JSON.stringify(row)).not.toContain('Question number');
  });

  test('prose in the field is dropped and the question still arrives', async ({ page }) => {
    const seen = await ask(page, {
      sufficient: false,
      readiness: 45,
      questions: [{
        field: 'fAntecedent',
        question: 'Question number 1 about the session.',
        suggestions: [],
        bar: 'The client eloped twice, which fails the observable rule',
      }],
    });
    await expect(page.getByText(/Question number 1 /)).toBeVisible({ timeout: 20000 });
    await expect.poll(() => seen.audits.filter((e) => e.type === 'gap_questions').length,
      { timeout: 15000 }).toBeGreaterThan(0);
    // The question is the technician's to answer either way. What must not
    // happen is a sentence about a session reaching the audit trail through a
    // field nobody looks at.
    const rows = seen.audits.filter((e) => e.type === 'gap_questions');
    rows.forEach((r) => expect(r.data).not.toHaveProperty('bars'));
    expect(JSON.stringify(rows)).not.toContain('eloped');
  });
});
