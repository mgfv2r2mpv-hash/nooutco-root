import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isTriageCall } from './helpers/llm-call.js';

/* Whether the advisory hints the prompt asks for actually arrive.
 *
 * WHY THIS EXISTS. The prompt names a code and asks the model to raise it when
 * the note has that gap, and on 2026-09-02 a live note came back without the
 * antecedent one. The proposed remedy was to enforce "no stated effect" in a
 * post-pass, which would mean deciding in a regular expression whether prose
 * states an effect, and being wrong there puts an amber hint on a correct note.
 * Nothing had ever recorded how often a code fires, so there was an anecdote off
 * one note and no rate. This makes the rate a byproduct of ordinary use, and
 * costs a technician nothing.
 *
 * THE CODE GOES IN THE KEY, AND THAT IS THE WHOLE DESIGN. Both sanitisers on
 * the path accept a string VALUE only up to 24 characters, so
 * { code: "antecedent_effect_unstated" } would be dropped in silence at 26
 * characters, along with strategy_in_wrong_section at 25. The two that would go
 * missing include the one this was built to watch. Keys are validated as
 * identifiers rather than by that rule, so the code goes in the key.
 *
 * AND THE KEY LIMIT HAD TO MOVE, which is the second test below. The tools
 * Worker took key names up to 24 characters while profile-api, the store it
 * feeds, takes 32, so a key between the two was accepted downstream and dropped
 * upstream by the shorter of two limits nobody had compared.
 */

const SECRET = 'playwright-local-test-secret';
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function adminToken() {
  const payload = { role: 'admin', kid: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 };
  const s = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${s}.${b64url(createHmac('sha256', SECRET).update(s).digest())}`;
}
function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}
const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const hint = (section, code) => ({ section, code, detail: '', rank: 1, kind: 'thin' });

const noteWith = (overrides) => ({
  individualsPresent: ['Client'],
  clinicalStatus: ['Presented Calm'],
  clinicalStatusNarrative: 'The client met the technician at the door and settled quickly.',
  purpose: ['Worked on goals as stated in the treatment plan'],
  servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'Eight of ten trials came back correct with a gestural prompt.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'A two minute warning preceded each transition and the client moved without protest.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions and the technician blocked the door.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
  ...overrides,
});

// Returns every audit event the page posted while drafting, so a test can ask
// what was recorded rather than what the tool says it records.
async function draftAndCollect(page, note) {
  const events = [];
  await page.route('**/api/audit**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    (body.events || []).forEach((e) => events.push(e));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"stored":1}' });
  });
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(note));
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

  /* The note rendering is not the event arriving. auditFlush POSTs in the
     background and nothing in the page waits for it, so reading the array the
     moment the draft appears reads it before the request lands. Poll for the
     event rather than sleeping a fixed span, which would be slow when it is
     quick and flaky when the machine is loaded. */
  await expect
    .poll(() => events.map((e) => e.type), {
      timeout: 10000,
      message: 'the drafting run never posted a note_hints event',
    })
    .toContain('note_hints');
  return events;
}

const hintsEvent = (events) => events.find((e) => e.type === 'note_hints');

// The codes bt really declares, read from the tool rather than restated here,
// so a catalogue change cannot leave this file quietly asserting the old list.
const catalogCodes = (id) => {
  const src = readFileSync(path.join(process.cwd(), `notes/bcba/tools/${id}.js`), 'utf8');
  const cat = src.match(/var HINT_CATALOG = \{[\s\S]*?\n {2}};/);
  return cat ? [...cat[0].matchAll(/^ {4}([a-z_]+):/gm)].map((m) => m[1]) : [];
};
const btHintCodes = () => catalogCodes('bt');
const codeKeys = (data) => Object.keys(data || {}).filter((k) => btHintCodes().includes(k));

test.describe('which hint codes a draft actually raised', () => {
  test('every code the model raised arrives, with the code as the key', async ({ page }) => {
    const events = await draftAndCollect(page, noteWith({
      hints: [
        hint('antecedentNarrative', 'antecedent_effect_unstated'),
        hint('behaviorPlanNarrative', 'no_response_described'),
      ],
    }));
    const e = hintsEvent(events);
    expect(e, 'no note_hints event was emitted at all').toBeTruthy();
    expect(e.tool).toBe('bt');
    expect(e.data).toMatchObject({ antecedent_effect_unstated: 1, no_response_described: 1 });
  });

  test('the long code survives, which is the one the whole thing is for', async ({ page }) => {
    // 26 characters. Recorded as a value it would be dropped by both sanitisers
    // for being over 24, and as a key it was dropped by the Worker for the same
    // reason until the key limit moved to match the store.
    const events = await draftAndCollect(page, noteWith({
      hints: [hint('antecedentNarrative', 'antecedent_effect_unstated')],
    }));
    const e = hintsEvent(events);
    expect(Object.keys(e.data)).toContain('antecedent_effect_unstated');
  });

  test('it is a count and not a flag, so one code on two sections reads as two', async ({ page }) => {
    const events = await draftAndCollect(page, noteWith({
      hints: [
        hint('lessonProgressNarrative', 'no_strategy_outcome'),
        hint('behaviorPlanNarrative', 'no_strategy_outcome'),
      ],
    }));
    expect(hintsEvent(events).data).toMatchObject({ no_strategy_outcome: 2 });
  });

  test('a draft that raised nothing still reports, because that is a reading too', async ({ page }) => {
    // Distinguishing "the model found nothing to raise" from "the tool never
    // asked" is the entire point of measuring this, and only the first of those
    // sends an empty payload.
    const events = await draftAndCollect(page, noteWith({ hints: [] }));
    const e = hintsEvent(events);
    expect(e, 'a clean note sent no note_hints event, so a zero is indistinguishable from silence').toBeTruthy();
    // `tool` rides along on every audit payload from the engine's own helper,
    // so the claim is that no CODE is present, not that the object is bare.
    expect(codeKeys(e.data), 'a note with no hints reported codes anyway').toEqual([]);
  });

  test('no code ever travels as a value, because a value over 24 characters is dropped', async ({ page }) => {
    const events = await draftAndCollect(page, noteWith({
      hints: [hint('antecedentNarrative', 'antecedent_effect_unstated')],
    }));
    /* The failure this guards is a payload shaped { code: "some_long_code" },
       which both sanitisers drop in silence past 24 characters - and the codes
       that would go missing are the two longest, one of them the code this was
       built to watch. So the test is that no hint code appears as a VALUE, not
       that every value is a number: the engine's helper legitimately puts the
       tool id there. */
    const codes = btHintCodes();
    expect(codes.length, 'no hint codes were read from bt.js, so this test is checking nothing').toBeGreaterThan(0);
    Object.entries(hintsEvent(events).data).forEach(([k, v]) => {
      expect(codes, `the code ${v} was recorded as the value of ${k}, where the sanitiser drops the long ones`)
        .not.toContain(v);
    });
    expect(codeKeys(hintsEvent(events).data), 'the code never arrived as a key either').toContain('antecedent_effect_unstated');
  });
});

test.describe('the hint counts reach the store', () => {
  test('note_hints is accepted rather than dropped at the door', async ({ request }) => {
    // note_register, recommendation and capture were each emitted by the browser
    // and refused here for weeks, because the allowlist and the call site were
    // added in different commits.
    const res = await request.post('/api/audit', {
      headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' },
      data: { events: [{ type: 'note_hints', tool: 'bt', ts: Date.now(), data: { no_prompt_level: 1 } }] },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).stored).toBe(1);
  });

  test('the Worker never takes a shorter key than the store it feeds', async () => {
    /* The invariant, rather than the number. The tools Worker took key names up
       to 24 characters while profile-api takes 32, so anything between the two
       was accepted downstream and dropped upstream in silence by whichever
       limit was shorter. There is no read route for the audit trail, so a
       runtime test cannot see the drop; this reads both limits instead and
       fails whenever either side moves the wrong way.

       It is also measured against the codes the tools really declare, so a
       catalogue that grows a longer code fails here rather than losing that
       code quietly a month later. */
    const between = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
    const limitIn = (block, where) => {
      const m = block.match(/\^\[a-z]\[a-z0-9_]\{0,(\d+)}\$/);
      expect(m, `no metric key pattern found in ${where}`).toBeTruthy();
      return Number(m[1]) + 1;
    };

    const worker = readFileSync(path.join(process.cwd(), '_worker.js'), 'utf8');
    const validate = readFileSync(path.join(process.cwd(), '../profile-api/src/validate.js'), 'utf8');

    const gate = limitIn(between(worker, 'function sanitizeAuditEvent', '\nasync function handleAudit'), '_worker.js');
    const store = limitIn(between(validate, 'export function sanitizeMetrics', 'export function clampTs'), 'profile-api/src/validate.js');

    expect(gate, `the Worker accepts ${gate} character keys and profile-api accepts ${store}, so keys between the two are dropped upstream and would have been kept downstream`)
      .toBeGreaterThanOrEqual(store);

    const longest = ['bt', 'sup', 'assess', 'parent', 'sap']
      .flatMap(catalogCodes)
      .reduce((a, b) => (b.length > a.length ? b : a), '');

    expect(longest.length, 'no hint codes were found in any tool, so this test is checking nothing').toBeGreaterThan(0);
    expect(gate, `the longest hint code is ${longest} at ${longest.length} characters and the Worker only keeps ${gate}`)
      .toBeGreaterThanOrEqual(longest.length);
  });
});
