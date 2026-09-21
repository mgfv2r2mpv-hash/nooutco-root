import { test, expect } from '@playwright/test';
import { captureClipboard } from './helpers/clipboard.js';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import path from 'node:path';
import worker, { sanitizeVoiceNote } from '../_worker.js';
import profileApi from '../../profile-api/src/index.js';
import { d1Sqlite } from '../../profile-api/test/helpers/d1-sqlite.js';
import { isTriageCall } from './helpers/llm-call.js';

/* THE WRITE PATH: A NOTE'S VOICE READING, FROM THE PAGE INTO voice_level AND
 * diction_level.
 *
 * The chain under test is the real one, end to end, with no dev server for
 * either Worker:
 *
 *   note page (real engine, real notes-gate buffer and flush)
 *     -> /api/audit, intercepted and handed to the REAL _worker.js fetch
 *     -> env.PROFILE, which calls the REAL profile-api fetch
 *     -> env.DB, real SQLite running schema.sql (d1Sqlite)
 *
 * The profile Worker is not bound under `wrangler pages dev`, which is why the
 * two Workers are joined in this process instead. Nothing else is stubbed but
 * the LLM, the expert pass and the corrections pass, which reach no model.
 *
 * Two claims:
 *   1. A note the technician's own hand changed lands its levels, and an edit
 *      answered through the ledger lands its diction. A note copied as drafted,
 *      or changed only by a rejection, teaches no level.
 *   2. No surface form crosses /api/audit into the store, in any slot.
 */

const BT_PAGE = '/notes/bt/';
const SECRET = 'voice-write-path-secret';
const KID = 'voice-kid-7c1';
const ROOT = process.cwd();
const SCHEMA = readFileSync(path.join(ROOT, '../profile-api/schema.sql'), 'utf8');

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function tokenFor() {
  const payload = { role: 'user', kid: KID, tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(createHmac('sha256', SECRET).update(body).digest())}`;
}

/* The two Workers and the store, joined in this process. `kv` is the audit
   trail the Pages worker writes, `forwarded` every body it sent the store. */
function chain() {
  const DB = d1Sqlite(SCHEMA);
  const kv = [];
  const forwarded = [];
  const env = {
    ADMIN_SECRET: SECRET,
    API_PASSWORDS: { put: async (key, value) => { kv.push(value); } },
    PROFILE: {
      fetch: async (url, init) => {
        forwarded.push(init.body);
        return profileApi.fetch(new Request(url, init), { DB });
      },
    },
  };
  const rows = (sql, ...params) => DB.sqlite.prepare(sql).all(...params).map((r) => ({ ...r }));
  return { DB, kv, forwarded, env, rows };
}

async function throughWorker(c, url, headers, body) {
  const res = await worker.fetch(new Request(url, { method: 'POST', headers, body }), c.env, { waitUntil() {} });
  return { status: res.status, body: await res.text() };
}

function reply(obj) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
  };
}

const PLAN = 'Elopement occurred on two occasions and the technician blocked the door.';
const HEDGED = ' The client appeared to perhaps feel somewhat unsettled and possibly may have tended to leave the table.';

function note() {
  return {
    individualsPresent: ['Client'],
    clinicalStatus: ['Presented Tired'],
    clinicalStatusNarrative: 'The client presented as tired on arrival.',
    purpose: ['Worked on goals as stated in the treatment plan'],
    servicePaused: 'No',
    abaTechniques: ['Discrete Trial Training'],
    lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
    antecedentStrategies: ['Offered choices'],
    antecedentNarrative: 'Choices were offered before each demand.',
    consequenceStrategies: ['Redirection'],
    consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
    behaviorPlanNarrative: PLAN,
    clientProgress: 'Steady progress towards goals and behaviors',
    actionItems: ['None'],
    followUpNarrative: 'Direct staff do not report new questions or concerns for the BCBA.',
    hints: [],
  };
}

/* Two sections of three or more sentences each, of different lengths, so all
   four levels are measurable: the two section measures need that much. */
const TYPED_PLAN = 'Elopement occurred on two occasions. The technician blocked the door each time and waited for the client to return to the table before presenting the next demand. The client appeared to perhaps feel somewhat unsettled. I recorded both.';
const TYPED_FOLLOW = 'Direct staff do not report new questions. The caregiver asked whether the first-then board could be used at home during dinner and the technician agreed to bring a copy next week. We will review it together.';

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

/* Every /api/audit request the page makes goes through the real Pages worker
   and, from there, into the real store. */
async function wire(page, c) {
  await page.route('**/api/audit**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const res = await throughWorker(c, `http://localhost${u.pathname}${u.search}`, req.headers(), req.postData());
    await route.fulfill({ status: res.status, contentType: 'application/json', body: res.body });
  });
}

async function draft(page, c, { corrections = [] } = {}) {
  await wire(page, c);
  await page.route('**/api/llm-call**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(body)) return route.fulfill(reply({ sufficient: true, questions: [], readiness: 90 }));
    return route.fulfill(reply(note()));
  });
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
  await page.route('**/api/corrections-pass**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ corrections, dropped: 0, usage: { input_tokens: 10, output_tokens: 5 }, model: 'test' }),
    }));

  await page.goto(BT_PAGE);
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto(BT_PAGE);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT 3-item array, full physical faded to independent');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2, blocked the door');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await acceptScrubGate(page);
  if (corrections.length) {
    await expect(page.locator('[data-corrections-section]').first()).toBeVisible({ timeout: 20000 });
  } else {
    await expect(page.locator('textarea[data-section-id="behaviorPlanNarrative"]')).toBeVisible({ timeout: 20000 });
  }
}

const trail = (c) => c.kv.map((v) => JSON.parse(v)).flatMap((r) => r.events);

/* Copy, then wait until note_copied has been written to the KV trail by the
   real worker. That event leaves on the same flush path the voice entry does,
   so waiting on it is what makes an empty table a reading rather than a race. */
async function copyAndSettle(page, c) {
  await page.getByRole('button', { name: /^Copy$/ }).first().click();
  await expect
    .poll(() => trail(c).filter((e) => e.type === 'note_copied').length, { timeout: 10000, message: 'the copy never reached the worker' })
    .toBe(1);
  await expect.poll(() => page.evaluate(() => window.NotesGate.audit._buffer().length + window.NotesGate.audit._corrections().length), { timeout: 10000 }).toBe(0);
  await page.waitForTimeout(1000);
}

const voiceSent = (c) => c.forwarded.flatMap((b) => JSON.parse(b).voice || []);

// ───────────────────────────── through the page, into the store

test.describe('a note reaches voice_level and diction_level through the Pages worker', () => {
  test('a note the technician typed over lands all four levels in voice_level', async ({ page }) => {
    const c = chain();
    await draft(page, c);
    await page.locator('textarea[data-section-id="behaviorPlanNarrative"]').fill(TYPED_PLAN);
    await page.locator('textarea[data-section-id="followUpNarrative"]').fill(TYPED_FOLLOW);
    await copyAndSettle(page, c);

    await expect.poll(() => c.rows(`SELECT feature FROM voice_level WHERE kid = ?`, KID).length, { timeout: 10000 }).toBe(4);
    const sent = voiceSent(c);
    expect(sent.length, 'one note, one entry').toBe(1);
    expect(sent[0].tool).toBe('bt');

    const stored = c.rows(`SELECT tool, feature, n, sum, sum_sq FROM voice_level WHERE kid = ? ORDER BY feature`, KID);
    expect(stored.map((r) => r.feature)).toEqual(['actor_naming', 'hedging', 'step_rel', 'within_cv']);
    for (const r of stored) {
      expect(r.tool).toBe('bt');
      expect(r.n).toBe(1);
      expect(r.sum).toBeCloseTo(sent[0].levels[r.feature], 9);
      expect(r.sum_sq).toBeCloseTo(sent[0].levels[r.feature] ** 2, 9);
    }
    // The typed hedges are in the reading, so this is the note that was copied
    // and not the model's draft.
    expect(sent[0].levels.hedging).toBeGreaterThan(0);
  });

  test('a note copied as drafted teaches no level', async ({ page }) => {
    const c = chain();
    await draft(page, c);
    await copyAndSettle(page, c);
    expect(voiceSent(c)).toEqual([]);
    expect(c.rows(`SELECT * FROM voice_level`)).toEqual([]);
    expect(await page.evaluate(() => window.NotesGate.audit._voice())).toEqual([]);
  });

  test('a rejection alone teaches no level, because its after side is the model\'s text', async ({ page }) => {
    const c = chain();
    await draft(page, c, { corrections: [{ section: 'behaviorPlanNarrative', text: PLAN + HEDGED, why: 'test' }] });
    const key = await page.locator('[data-corrections-section="behaviorPlanNarrative"] [data-correction-type="ins"]').first().getAttribute('data-correction');
    await page.locator(`[data-correction-tick="${key}"]`).click();
    await page.locator(`[data-correction-undo="${key}"]`).click();
    await expect(page.locator(`[data-correction="${key}"]`)).toHaveAttribute('data-correction-reverted', 'true');
    await copyAndSettle(page, c);

    // Not vacuous: the rejection was measured as style, so the pair existed.
    const sentCorrections = c.forwarded.flatMap((b) => JSON.parse(b).corrections || []);
    expect(sentCorrections.some((x) => x.source === 'revision'), 'no rejection was taught, so this checks nothing').toBe(true);
    expect(voiceSent(c)).toEqual([]);
    expect(c.rows(`SELECT * FROM voice_level`)).toEqual([]);
  });

  test('an edit answered through the ledger lands its diction in diction_level', async ({ page }) => {
    const c = chain();
    await wire(page, c);
    await page.goto(BT_PAGE);
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto(BT_PAGE);
    await page.waitForFunction(() => !!window.NoteVoice && !!window.NoteDistill && !!window.NotesGate);

    const expected = await page.evaluate(() => {
      // The pair distill.spec.js reads: "prompted" becomes "assisted", "request" becomes "ask for".
      const state = window.NoteDistill.answer(
        null,
        { producer: 'hints', code: 'no_prompt_level', section: 'lessonProgressNarrative', tool: 'bt', item: '0:0' },
        'edit',
        {
          offered: 'The behavior technician prompted the client to request a break when the demand was presented. The client appeared to perhaps feel somewhat unsettled and possibly may have tended to leave the table during the second block of trials.',
          kept: 'The behavior technician assisted the client to ask for a break when the demand was presented. The client left the table twice during the second block of trials, and the technician blocked the door both times.',
        },
      );
      const harvest = window.NoteDistill.harvest(state);
      window.NotesGate.audit.voice(window.NoteVoice.entry({ tool: 'bt', harvest }));
      return harvest.diction;
    });
    expect(expected.length, 'the edit tallied no diction, so this checks nothing').toBeGreaterThan(0);

    await expect.poll(() => c.rows(`SELECT * FROM diction_level WHERE kid = ?`, KID).length, { timeout: 10000 }).toBe(expected.length);
    expect(c.rows(`SELECT tool, family, variant, count, notes FROM diction_level WHERE kid = ? ORDER BY family, variant`, KID))
      .toEqual(expected.map((d) => ({ tool: 'bt', family: d.family_id, variant: d.variant_index, count: d.count, notes: 1 })));
    // Diction alone carries no level: nothing the technician typed was measured.
    expect(c.rows(`SELECT * FROM voice_level`)).toEqual([]);
    await expect.poll(() => page.evaluate(() => window.NotesGate.audit._voice().length)).toBe(0);
  });

  test('a reading waits in the buffer while the store is not there, and goes when it is, twenty at a time', async ({ page }) => {
    let profile = 'skipped';
    const sent = [];
    await page.route('**/api/audit**', (route) => {
      sent.push((JSON.parse(route.request().postData() || '{}').voice || []).length);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stored: 0, voice: 1, profile }) });
    });
    await page.goto(BT_PAGE);
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto(BT_PAGE);
    await page.waitForFunction(() => !!window.NotesGate);

    await page.evaluate(() => {
      for (let i = 0; i < 25; i++) window.NotesGate.audit.voice({ tool: 'bt', levels: { hedging: 0.02 }, diction: [] });
    });
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.NotesGate.audit._voice().length), 'dropped while the store was away').toBe(25);

    profile = 'ok';
    await expect.poll(() => page.evaluate(() => { window.NotesGate.audit.flush(); return window.NotesGate.audit._voice().length; })).toBe(0);
    expect(Math.max(...sent), 'one flush carried more than one request may').toBe(20);
  });

  test('the page buffer keeps numbers and identifiers and nothing else', async ({ page }) => {
    await page.route('**/api/audit**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"stored":0,"profile":"skipped"}' }));
    await page.goto(BT_PAGE);
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto(BT_PAGE);
    await page.waitForFunction(() => !!window.NotesGate);

    const kept = await page.evaluate(() => {
      window.NotesGate.audit.voice({
        tool: 'bt',
        text: 'The client eloped',
        levels: { hedging: 'prompted', actor_naming: 0.5, 'the client': 1 },
        diction: [
          { family_id: 'the client', variant_index: 0, count: 1 },
          { family_id: 'prompting', variant_index: 'prompted', count: 1 },
          { family_id: 'mand', variant_index: 1, count: 2, word: 'asked for' },
        ],
      });
      window.NotesGate.audit.voice({ tool: 'bt', levels: { hedging: 'prompted' }, diction: [] });
      window.NotesGate.audit.voice({ tool: 'The client eloped', levels: { hedging: 0.01 }, diction: [] });
      return window.NotesGate.audit._voice();
    });
    expect(kept).toEqual([{ tool: 'bt', levels: { actor_naming: 0.5 }, diction: [{ family_id: 'mand', variant_index: 1, count: 2 }] }]);
  });

  test('a page that failed to load voice-note.js still drafts and copies, and throws nothing', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e && e.message)));
    /* Not grantPermissions: it throws on firefox and webkit, and failed this
       test in both on its first CI run. See tests/helpers/clipboard.js. */
    await captureClipboard(page);
    await page.route('**/notes/bcba/voice-note.js', (route) => route.abort());
    const c = chain();
    await draft(page, c);
    await page.locator('textarea[data-section-id="behaviorPlanNarrative"]').fill(TYPED_PLAN);
    await copyAndSettle(page, c);
    expect(await page.evaluate(() => typeof window.NoteVoice)).toBe('undefined');
    /* WEBKIT CALLS A BLOCKED SUBRESOURCE A PAGE ERROR and the other two do not.
       /api/style-card.js is fetched with a token this fixture never sets, so
       webkit adds "due to access control checks" to the list while chromium and
       firefox say nothing about it. That is a different script and a different
       question from the one this test asks.

       Filtered BY NAME rather than by count, so a real throw out of the missing
       module still fails here, which is the whole assertion. */
    expect(errors.filter((e) => !/style-card\.js/.test(e))).toEqual([]);
  });

  test('both note pages load voice-note.js', async ({ page }) => {
    for (const url of [BT_PAGE, '/notes/bcba/?tool=sup']) {
      await page.goto(url);
      await page.waitForFunction(() => !!window.NoteVoice, null, { timeout: 20000 });
    }
  });
});

// ───────────────────────────── the entry, without the page flow

function load() {
  const ctx = createContext({ window: {} });
  for (const f of ['style-features.js', 'note-metrics.js', 'voice-note.js']) {
    runInContext(readFileSync(path.join(ROOT, 'notes/bcba', f), 'utf8'), ctx);
  }
  return ctx.window;
}

const IDS = ['plan', 'follow'];
const SHIPPED = { plan: TYPED_PLAN, follow: TYPED_FOLLOW };

test.describe('what one note contributes', () => {
  test('levels are read only when a pair on the note is the technician\'s own prose', () => {
    const w = load();
    const base = { tool: 'bt', ids: IDS, shipped: SHIPPED };
    expect(w.NoteVoice.entry({ ...base, pairs: [] })).toBeNull();
    expect(w.NoteVoice.entry({ ...base, pairs: [{ kind: 'rejected', own: false }] })).toBeNull();
    expect(w.NoteVoice.entry({ ...base, pairs: [{ kind: 'rejected', own: false }, { kind: 'overtyped', own: true }] }).levels.hedging).toBeGreaterThan(0);
    // A specimen from the ledger counts the same way, once an affordance answers.
    const fromLedger = w.NoteVoice.entry({ ...base, pairs: [], harvest: { diction: [], specimens: [{ kind: 'edited', own: true }] } });
    expect(Object.keys(fromLedger.levels).sort()).toEqual(['actor_naming', 'hedging', 'step_rel', 'within_cv']);
  });

  test('the levels are the style and section measures of the note as copied, by the names the store reads', () => {
    const w = load();
    const passage = `${TYPED_PLAN}\n\n${TYPED_FOLLOW}`;
    const style = w.NoteStyleFeatures._measure(passage);
    const shape = w.NoteMetrics.measure(passage);
    expect(w.NoteVoice.levels(passage)).toEqual({
      actor_naming: style.actor_naming,
      hedging: style.hedging,
      within_cv: shape.sectionCv,
      step_rel: shape.sectionStep,
    });
    expect(w.NoteVoice.entry({ tool: 'bt', ids: IDS, shipped: SHIPPED, pairs: [{ own: true }] }).levels)
      .toEqual(w.NoteVoice.levels(passage));
  });

  test('a section measure the passage cannot support is left out, never sent as zero', () => {
    const w = load();
    // Every section is one sentence, so neither section measure exists.
    const flat = 'The technician ran twelve trials of the three item array with a gestural prompt on each miss today.\n\nThe client left the table twice and the technician blocked the door both times without comment.';
    expect(Object.keys(w.NoteVoice.levels(flat)).sort()).toEqual(['actor_naming', 'hedging']);
  });

  test('a passage under the word floor gives no level at all', () => {
    const w = load();
    expect(w.NoteVoice.levels('The client left the table twice.')).toBeNull();
    expect(w.NoteVoice.entry({ tool: 'bt', ids: ['a'], shipped: { a: 'The client left the table twice.' }, pairs: [{ own: true }] })).toBeNull();
  });

  test('diction rides without a level, and an entry with neither is not sent', () => {
    const w = load();
    const diction = [{ family_id: 'prompting', variant_index: 1, count: 1 }];
    expect(w.NoteVoice.entry({ tool: 'bt', harvest: { diction, specimens: [] } })).toEqual({ tool: 'bt', levels: {}, diction });
    expect(w.NoteVoice.entry({ tool: 'bt', harvest: { diction: [], specimens: [] } })).toBeNull();
  });
});

// ───────────────────────────── no surface form crosses into the store

function houseForms() {
  const ctx = createContext({ window: {} });
  runInContext(readFileSync(path.join(ROOT, 'notes/bcba/diction.js'), 'utf8'), ctx);
  const forms = new Set();
  for (const family of ctx.window.NoteDiction.FAMILIES) {
    for (const variant of family.variants) for (const form of variant) forms.add(form.toLowerCase());
  }
  return { forms: [...forms], ids: [...ctx.window.NoteDiction.FAMILY_IDS] };
}

const SENTENCE = 'Marisol Quintero prompted the client to request a break and then eloped from the table';

test.describe('/api/audit carries no surface form into the store', () => {
  test('sanitizeVoiceNote keeps a note tool, numbers and house names, and drops every other slot', () => {
    expect(sanitizeVoiceNote({ tool: 'prompted', levels: { hedging: 0.02 } })).toBeNull();
    expect(sanitizeVoiceNote({
      tool: 'bt',
      text: SENTENCE,
      levels: { hedging: 'prompted', actor_naming: 0.123456789, [SENTENCE]: 1, within_cv: [0.4] },
      diction: [
        { family_id: SENTENCE, variant_index: 0, count: 1 },
        { family_id: 'prompting', variant_index: 'prompted', count: 1 },
        { family_id: 'prompting', variant_index: 0, count: 'twice' },
        { family_id: 'prompting', variant_index: 1.5, count: 1 },
        { family_id: 'mand', variant_index: 2, count: 3, word: 'asked for' },
      ],
    })).toEqual({ tool: 'bt', levels: { actor_naming: 0.123457 }, diction: [{ family_id: 'mand', variant_index: 2, count: 3 }] });
    expect(sanitizeVoiceNote({ tool: 'bt', levels: { hedging: 'prompted' }, diction: [] })).toBeNull();
  });

  test('a word shaped like an identifier is still refused, as a level name and as a family id', () => {
    // "often" and "coached" are house synonyms and legal identifiers. Only a
    // closed list can tell them from "hedging" and "prompting".
    expect(sanitizeVoiceNote({
      tool: 'bt',
      levels: { often: 0.5, coached: 0.2, hedging: 0.01 },
      diction: [{ family_id: 'often', variant_index: 0, count: 1 }, { family_id: 'coached', variant_index: 1, count: 1 }],
    })).toEqual({ tool: 'bt', levels: { hedging: 0.01 }, diction: [] });
  });

  test('one request carries at most twenty notes on to the store', async () => {
    const c = chain();
    const headers = { Authorization: `Bearer ${tokenFor()}`, 'Content-Type': 'application/json' };
    const voice = Array.from({ length: 25 }, () => ({ tool: 'bt', levels: { hedging: 0.01 }, diction: [] }));
    const res = await throughWorker(c, 'http://localhost/api/audit', headers, JSON.stringify({ events: [], corrections: [], voice }));
    expect(JSON.parse(res.body).voice).toBe(20);
    expect(JSON.parse(c.forwarded[0]).voice).toHaveLength(20);
  });

  test('a voice payload holding a house synonym in every slot writes none of them, through the real worker into the store', async () => {
    const { forms, ids } = houseForms();
    expect(forms.length, 'the house dictionary did not load').toBeGreaterThan(300);
    const c = chain();
    const headers = { Authorization: `Bearer ${tokenFor()}`, 'Content-Type': 'application/json' };
    const text = { word: SENTENCE, text: SENTENCE, before: SENTENCE, after: SENTENCE, offered: SENTENCE, kept: SENTENCE };

    for (const form of forms) {
      const voice = [
        { ...text, tool: form, levels: { hedging: 0.02 }, diction: [{ family_id: 'mand', variant_index: 0, count: 1 }] },
        {
          ...text,
          tool: 'bt',
          levels: { [form.replace(/\W/g, '_')]: 0.5, within_cv: form, hedging: SENTENCE, actor_naming: [form] },
          diction: [
            { family_id: form, variant_index: 0, count: 1 },
            { family_id: 'prompting', variant_index: form, count: 1 },
            { family_id: 'prompting', variant_index: 0, count: form },
            { ...text, family_id: 'mand', variant_index: 0, count: 1 },
          ],
        },
      ];
      const res = await throughWorker(c, 'http://localhost/api/audit.js', headers, JSON.stringify({ events: [], corrections: [], voice }));
      expect(res.status, `the worker failed on "${form}"`).toBe(200);
    }

    const house = new Set([...ids, 'within_cv', 'step_rel', 'actor_naming', 'hedging', 'bt', KID]);
    const matchers = [...forms, SENTENCE.toLowerCase()].map((f) =>
      new RegExp(`(^|[^a-z])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i'));
    const carries = (v) => typeof v === 'string' && !house.has(v) && matchers.some((m) => m.test(v));
    const strings = (v) => (typeof v === 'string' ? [v]
      : Array.isArray(v) ? v.flatMap(strings)
        : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)]) : []);

    // What the Pages worker sent on: every key and every value, walked.
    expect(c.forwarded.length, 'nothing was forwarded, so this checks nothing').toBe(forms.length);
    expect(c.forwarded.flatMap((b) => strings(JSON.parse(b))).filter(carries)).toEqual([]);
    // What reached a write statement, and what the tables hold.
    const writes = c.DB.bound.filter((b) => /^\s*(INSERT|UPDATE|DELETE)/i.test(b.sql));
    expect(writes.flatMap((b) => b.values).filter(carries)).toEqual([]);
    for (const { name } of c.DB.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()) {
      if (name.startsWith('sqlite_')) continue;
      const cells = c.DB.sqlite.prepare(`SELECT * FROM ${name}`).all().flatMap((r) => Object.values(r));
      expect(cells.filter(carries), `table ${name} holds a surface form`).toEqual([]);
    }
    // The KV trail was never handed the voice payload at all.
    expect(c.kv).toEqual([]);
    // Positive control: the legal row in each payload did land.
    const mand = c.rows(`SELECT count FROM diction_level WHERE kid = ? AND family = 'mand' AND variant = 0`, KID);
    expect(mand.length && mand[0].count, 'the legal row never landed, so the empty checks read a route that wrote nothing').toBeGreaterThanOrEqual(forms.length);
  });
});
