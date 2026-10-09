import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import worker, { sanitizeVoiceReading, voiceReadSwitchFrom, voiceReadOnForKid } from '../_worker.js';
import profileApi from '../../profile-api/src/index.js';
import { accumulateLevel } from '../../profile-api/src/voice-shrink.js';
import { d1Sqlite } from '../../profile-api/test/helpers/d1-sqlite.js';
import { isTriageCall } from './helpers/llm-call.js';
import { captureClipboard } from './helpers/clipboard.js';

/* SLICE 6: A DRAFT READS ITS AUTHOR'S STORED VOICE BACK.
 *
 * The chain under test is the real one on the read side:
 *
 *   note page (real engine, real notes-gate styleCard.get)
 *     -> /api/style-card, intercepted and handed to the REAL _worker.js fetch
 *     -> env.PROFILE, the REAL profile-api fetch over real SQLite (schema.sql)
 *     -> back through sanitizeVoiceReading to the page
 *     -> NoteVoiceRead.block, into the draft's system_suffix
 *
 * Only the model calls are stubbed. Every kid, reading and note is invented.
 *
 * The claim that matters most is negative: no text but the house dictionary
 * and fixed sentences can reach the prompt this way, whatever the store holds.
 */

const SECRET = 'playwright-local-test-secret';
const KID = 'voice-read-kid-3f2';
const BT_PAGE = '/notes/bt/';
const SCHEMA = readFileSync(path.join(process.cwd(), '../profile-api/schema.sql'), 'utf8');
const HEADER = 'TECHNICIAN VOICE, MEASURED';

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function tokenFor(kid = KID, role = 'user') {
  const payload = { role, kid, tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(createHmac('sha256', SECRET).update(body).digest())}`;
}

function reply(obj) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
  };
}

const NOTE = {
  individualsPresent: ['Client'], clinicalStatus: ['Presented Tired'],
  clinicalStatusNarrative: 'The client presented as tired on arrival.',
  purpose: ['Worked on goals as stated in the treatment plan'], servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
  antecedentStrategies: ['Offered choices'], antecedentNarrative: 'Choices were offered before each demand.',
  consequenceStrategies: ['Redirection'], consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions.',
  clientProgress: 'Steady progress towards goals and behaviors', actionItems: ['None'],
  followUpNarrative: 'Direct staff do not report new questions or concerns for the BCBA.', hints: [],
};

/* The slice 6 switch is OFF unless KV says otherwise (voice-read:v1). The
   tests that are about the read path itself switch it on for every BT. */
const SWITCH_KEY = 'voice-read:v1';
const ALL_ON = JSON.stringify({ enabled: true, kids: 'all' });

/* Two invented BTs with different stored voices, so a reading that crossed from
   one to the other would show. A names the actor rarely, hedges, and writes
   "requested". B writes "refocused" and holds no levels. */
const OTHER_KID = 'voice-read-kid-9b7';
const VOICE_A = { levels: [['actor_naming', 0.1, 200], ['hedging', 0.044, 40]], diction: [['mand', 1, 12, 5]] };
const VOICE_B = { levels: [], diction: [['redirection', 2, 15, 6]] };
const A_LINES = ['Name who did each step in about', 'Mark uncertainty', 'write "requested"'];
const B_LINE = '- For redirection, write "refocused" rather than its synonyms.';

function seedVoice(DB, kid, voice) {
  const now = Date.now();
  for (const [feature, value, n] of voice.levels) {
    let row = null;
    for (let i = 0; i < n; i += 1) row = accumulateLevel(row, value);
    DB.sqlite.prepare(
      'INSERT INTO voice_level (kid, tool, feature, n, sum, sum_sq, w_n, w_sum, w_sum_sq, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(kid, 'bt', feature, row.n, row.sum, row.sum_sq, row.w_n, row.w_sum, row.w_sum_sq, now);
  }
  for (const [family, variant, count, notes] of voice.diction) {
    DB.sqlite.prepare('INSERT INTO diction_level (kid, tool, family, variant, count, notes, updated) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(kid, 'bt', family, variant, count, notes, now);
  }
}

/** A store with this author's voice in it, or an empty one, and the switch as
 *  KV would hold it (`null` is no key at all, which is how production starts). */
function store({ warm, other = false, switchRaw = ALL_ON }) {
  const DB = d1Sqlite(SCHEMA);
  if (warm) seedVoice(DB, KID, VOICE_A);
  if (other) seedVoice(DB, OTHER_KID, VOICE_B);
  return {
    ADMIN_SECRET: SECRET,
    API_PASSWORDS: { get: async (key) => (key === SWITCH_KEY ? switchRaw : null) },
    PROFILE: { fetch: (url, init) => profileApi.fetch(new Request(url, init), { DB }) },
  };
}

/** The style card as the real Pages worker answers it for one BT. */
async function cardFor(env, kid = KID, extra = '') {
  const req = new Request(`https://tools.test/api/style-card?tool=bt&seed=s1${extra}`, {
    headers: { Authorization: `Bearer ${tokenFor(kid)}` },
  });
  const res = await worker.fetch(req, env, { waitUntil() {} });
  expect(res.status).toBe(200);
  return res.json();
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

/* The session data every run types. Invented, and full of the facts a voice
   must never touch: counts, a percentage, a target, a time. */
const SESSION = {
  skill: 'DTT 3-item array, 8 of 10 trials correct (80%), full physical faded to independent, target 90% across 3 sessions',
  antecedent: 'first-then board before demands, 2 choices offered',
  behavior: 'elopement x2 at 10:15 and 10:40, blocked the door, 45 seconds each',
};

/** Draft one note with the style card served by the real chain. Returns every
 *  body sent toward a model, the drafting calls on their own, and the style
 *  card voice the page was handed. The shape seed is pinned so two runs build
 *  the same shape target and differ only by what the test changes. */
async function draftRun(page, env, { kid = KID, copy = false } = {}) {
  const drafts = [];
  const modelBound = [];
  const cards = [];
  await page.route('**/api/style-card**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.searchParams.has('seed')) url.searchParams.set('seed', 'pinned-seed');
    const res = await worker.fetch(new Request(url.toString(), { headers: req.headers() }), env, { waitUntil() {} });
    const text = await res.text();
    cards.push(JSON.parse(text));
    await route.fulfill({ status: res.status, contentType: 'application/json', body: text });
  });
  await page.route('**/api/llm-call**', async (route) => {
    const raw = route.request().postData() || '{}';
    modelBound.push(raw);
    const body = JSON.parse(raw);
    if (isTriageCall(body)) return route.fulfill(reply({ sufficient: true, questions: [], readiness: 90 }));
    drafts.push(body);
    return route.fulfill(reply(NOTE));
  });
  await page.route('**/api/expert-pass**', (route) => {
    modelBound.push(route.request().postData() || '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) });
  });
  await page.route('**/api/corrections-pass**', (route) => {
    modelBound.push(route.request().postData() || '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: [], dropped: 0, usage: {}, model: 'test' }) });
  });
  await page.route('**/api/audit**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"stored":0,"profile":"skipped"}' }));

  if (copy) await captureClipboard(page);
  await page.goto(BT_PAGE);
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor(kid));
  await page.goto(BT_PAGE);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill(SESSION.skill);
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill(SESSION.antecedent);
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill(SESSION.behavior);
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await acceptScrubGate(page);
  await expect.poll(() => drafts.length, { timeout: 30000 }).toBeGreaterThan(0);

  let copied = null;
  if (copy) {
    const close = page.locator('.revision-panel-close');
    if (await close.isVisible({ timeout: 2000 }).catch(() => false)) await close.click();
    await page.getByRole('button', { name: /^Copy$/ }).first().click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10000 }).not.toBe('');
    copied = await page.evaluate(() => navigator.clipboard.readText());
  }
  return { drafts, modelBound, voice: cards.length ? cards[cards.length - 1].voice : null, copied };
}

/** The system_suffix of the first drafting call. */
async function draftSuffix(page, env, opts) {
  const { drafts } = await draftRun(page, env, opts);
  return drafts[0].system_suffix || '';
}

test.describe('the draft reads the stored voice', () => {
  test('a BT with stored voice drafts with their levels and word choice in the suffix', async ({ page }) => {
    const suffix = await draftSuffix(page, store({ warm: true }));
    expect(suffix).toContain(HEADER);
    expect(suffix).toContain('- Name who did each step in about 4 of every 10 sentences.');
    expect(suffix).toMatch(/- Mark uncertainty \(appeared, seemed, may\) about once every \d+ words, more often than a default note does/);
    expect(suffix).toContain('- For mand, write "requested" rather than its synonyms.');
  });

  test('a BT with no stored voice drafts on the suffix that shipped before this slice', async ({ page }) => {
    const suffix = await draftSuffix(page, store({ warm: false }));
    expect(suffix).not.toContain(HEADER);
    expect(suffix).not.toContain('Word choice');
  });

  test('the request that drafts still carries no system prompt of its own', async ({ page }) => {
    // The served prompt is unchanged by this slice, so prompt hash parity with
    // the voice-module store holds: the reading rides in system_suffix only.
    const drafts = [];
    page.on('request', (r) => { if (r.url().includes('/api/llm-call')) drafts.push(JSON.parse(r.postData() || '{}')); });
    await draftSuffix(page, store({ warm: true }));
    const drafting = drafts.filter((b) => !isTriageCall(b));
    expect(drafting.length).toBeGreaterThan(0);
    for (const b of drafting) {
      expect(b.system).toBeUndefined();
      expect(b.systemPrompt).toBeUndefined();
    }
  });
});

test.describe('no client data can ride the voice into a prompt', () => {
  const PLANTED = 'Jordan Avery 04/12/2016';

  test('the Pages worker keeps ids and numbers, and drops a word in every slot', () => {
    const out = sanitizeVoiceReading({
      levels: [
        { feature: PLANTED, direction: 'more', target: 0.5, n: 3 },
        { feature: 'hedging', direction: PLANTED, target: 0.02, n: 3 },
        { feature: 'hedging', direction: 'more', target: PLANTED, n: 3 },
        { feature: 'actor_naming', direction: 'less', target: 0.4, n: 12, note: PLANTED },
      ],
      diction: [
        { family_id: PLANTED, variant_index: 0, share: 0.9, notes: 4 },
        { family_id: 'mand', variant_index: PLANTED, share: 0.9, notes: 4 },
        { family_id: 'mand', variant_index: 1, share: 0.9, notes: 4, word: PLANTED },
      ],
      extra: PLANTED,
    });
    expect(JSON.stringify(out)).not.toContain('Jordan');
    // Positive control: the legal row in each list survives, rebuilt.
    expect(out).toEqual({
      levels: [{ feature: 'actor_naming', direction: 'less', target: 0.4, n: 12 }],
      diction: [{ family_id: 'mand', variant_index: 1, share: 0.9, notes: 4 }],
    });
  });

  test('a store answer that is not an object reads as no voice', () => {
    for (const raw of [null, undefined, PLANTED, 7, [], { levels: PLANTED, diction: PLANTED }]) {
      expect(sanitizeVoiceReading(raw)).toEqual({ levels: [], diction: [] });
    }
  });

  test('every word the block can write is a fixed word or a house dictionary form', async ({ page }) => {
    await page.goto(BT_PAGE);
    await page.waitForFunction(() => !!(window.NoteVoiceRead && window.NoteDiction));
    const { words, forms } = await page.evaluate(() => {
      const fams = window.NoteDiction.FAMILIES;
      const diction = [];
      fams.forEach((f) => f.variants.forEach((_v, i) => diction.push({ family_id: f.id, variant_index: i })));
      const texts = [];
      for (const direction of ['more', 'less']) {
        for (const target of [0.004, 0.02, 0.4, 0.85, 1.3]) {
          texts.push(window.NoteVoiceRead.block({ levels: [{ feature: 'actor_naming', direction, target }, { feature: 'hedging', direction, target }], diction: [] }));
        }
      }
      for (let i = 0; i < diction.length; i += 5) texts.push(window.NoteVoiceRead.block({ levels: [], diction: diction.slice(i, i + 5) }));
      const all = texts.join('\n');
      const formWords = new Set();
      fams.forEach((f) => f.variants.forEach((v) => v.forEach((w) => w.split(/[^a-z]+/i).filter(Boolean).forEach((x) => formWords.add(x.toLowerCase())))));
      fams.forEach((f) => f.id.split('_').forEach((x) => formWords.add(x)));
      return { words: [...new Set(all.toLowerCase().match(/[a-z]+/g))], forms: [...formWords] };
    });
    const FIXED = new Set(`technician voice measured read from the notes this edited by hand these describe how person writes
      match them where they do not conflict with anything above rules win are clinical and documentation requirements
      only style never mention section or fact that writing is being matched name who did each step client staff in about of every
      sentences more often than a default note does names actor less keep wherever leaving it out would hide acted
      mark uncertainty appeared seemed may once words observation was uncertain state an as certain word choice needs
      at all for write rather its synonyms they change phrasing sentence length add drop number count percentage
      target date any other session data because`.split(/\s+/).filter(Boolean));
    const known = new Set([...FIXED, ...forms]);
    const stray = words.filter((w) => !known.has(w));
    expect(stray, `words the block wrote that are neither fixed nor house forms: ${stray.join(', ')}`).toEqual([]);
  });

  test('a reading the page does not recognise writes nothing at all', async ({ page }) => {
    await page.goto(BT_PAGE);
    await page.waitForFunction(() => !!window.NoteVoiceRead);
    const out = await page.evaluate((planted) => [
      window.NoteVoiceRead.block(null),
      window.NoteVoiceRead.block({ levels: [], diction: [] }),
      window.NoteVoiceRead.block({ levels: [{ feature: planted, direction: 'more', target: 0.5 }], diction: [] }),
      window.NoteVoiceRead.block({ levels: [{ feature: 'hedging', direction: planted, target: 0.5 }], diction: [] }),
      window.NoteVoiceRead.block({ levels: [], diction: [{ family_id: planted, variant_index: 0 }] }),
      window.NoteVoiceRead.block({ levels: [], diction: [{ family_id: 'mand', variant_index: 99 }] }),
    ], PLANTED);
    expect(out).toEqual(['', '', '', '', '', '']);
  });

  test('both note pages load voice-read.js', () => {
    for (const p of ['notes/bt/index.html', 'notes/bcba/index.html']) {
      expect(readFileSync(path.join(process.cwd(), p), 'utf8')).toContain('<script src="/notes/bcba/voice-read.js"></script>');
    }
  });
});

test.describe('the switch: slice 6 lands dark', () => {
  test('with no key in KV, a BT with stored voice gets an empty reading', async () => {
    const card = await cardFor(store({ warm: true, switchRaw: null }));
    expect(card.available).toBe(true);
    expect(card.voice).toEqual({ levels: [], diction: [] });
  });

  test('every shape of the key that is not an explicit yes reads as off', async () => {
    const offs = [
      'not json',
      '[]',
      'true',
      JSON.stringify({ enabled: false, kids: 'all' }),
      JSON.stringify({ enabled: 'true', kids: 'all' }),
      JSON.stringify({ enabled: true }),
      JSON.stringify({ enabled: true, kids: [] }),
      JSON.stringify({ enabled: true, kids: 'ALL' }),
      JSON.stringify({ enabled: true, kids: [OTHER_KID] }),
    ];
    for (const switchRaw of offs) {
      const card = await cardFor(store({ warm: true, switchRaw }));
      expect(card.voice, `read as on: ${switchRaw}`).toEqual({ levels: [], diction: [] });
    }
  });

  test('a list turns it on for the BTs it names and no one else', async () => {
    const env = store({ warm: true, other: true, switchRaw: JSON.stringify({ enabled: true, kids: [KID] }) });
    expect((await cardFor(env, KID)).voice.levels.length).toBeGreaterThan(0);
    expect((await cardFor(env, OTHER_KID)).voice).toEqual({ levels: [], diction: [] });
  });

  test('"all" turns it on for every BT', async () => {
    const env = store({ warm: true, other: true, switchRaw: ALL_ON });
    expect((await cardFor(env, KID)).voice.levels.length).toBeGreaterThan(0);
    expect((await cardFor(env, OTHER_KID)).voice.diction).toEqual([{ family_id: 'redirection', variant_index: 2, share: 1, notes: 6 }]);
  });

  test('the switch reader keeps only login ids, and a KV that throws reads as off', async () => {
    expect(voiceReadSwitchFrom(JSON.stringify({ enabled: true, kids: [KID, 7, '', KID, null] })))
      .toEqual({ enabled: true, scope: 'some', kids: [KID] });
    expect(voiceReadOnForKid(voiceReadSwitchFrom(null), KID)).toBe(false);
    const env = { ...store({ warm: true }), API_PASSWORDS: { get: async () => { throw new Error('kv down'); } } };
    expect((await cardFor(env)).voice).toEqual({ levels: [], diction: [] });
  });

  test('a BT with stored voice drafts on the pre-slice-6 suffix while the switch is off', async ({ page }) => {
    const suffix = await draftSuffix(page, store({ warm: true, switchRaw: null }));
    expect(suffix).not.toContain(HEADER);
    for (const line of A_LINES) expect(suffix).not.toContain(line);
  });

  test('the admin read-back reports the switch, and refuses a BT', async () => {
    const env = store({ warm: false, switchRaw: JSON.stringify({ enabled: true, kids: [KID] }) });
    const ask = (role) => worker.fetch(new Request('https://tools.test/api/admin/voice-read', {
      headers: { Authorization: `Bearer ${tokenFor(KID, role)}` },
    }), env, { waitUntil() {} });
    expect((await ask('user')).status).toBe(401);
    const res = await ask('admin');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, scope: 'some', kids: [KID] });
  });
});

test.describe('the voice changes style, never the facts', () => {
  test('the block tells the model it may not add, drop or change any session data', async ({ page }) => {
    const suffix = await draftSuffix(page, store({ warm: true }));
    expect(suffix).toContain('They change phrasing, sentence length and word choice only. Never add, drop or change a fact, number, count, percentage, target, date or any other session data because of this section.');
  });

  test('the same session data with and without a voice profile sends the same facts and copies the same note', async ({ browser }) => {
    const run = async (env) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try { return await draftRun(page, env, { copy: true }); } finally { await context.close(); }
    };
    const withVoice = await run(store({ warm: true }));
    const without = await run(store({ warm: false }));

    // The voice really was in play on one side and not the other.
    expect(withVoice.drafts[0].system_suffix).toContain(HEADER);
    expect(without.drafts[0].system_suffix).not.toContain(HEADER);

    // Every model call carries the session data byte for byte the same: the
    // voice reaches the model as an added style block and nowhere else.
    expect(withVoice.drafts.length).toBe(without.drafts.length);
    const block = await (async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto(BT_PAGE);
        await page.waitForFunction(() => !!(window.NoteVoiceRead && window.NoteDiction));
        return await page.evaluate((v) => window.NoteVoiceRead.block(v), withVoice.voice);
      } finally { await context.close(); }
    })();
    expect(block).toContain(HEADER);
    withVoice.drafts.forEach((call, i) => {
      const other = without.drafts[i];
      expect(call.messages, `call ${i}: the messages differ`).toEqual(other.messages);
      const { system_suffix: a, ...restA } = call;
      const { system_suffix: b, ...restB } = other;
      expect(restA, `call ${i}: a field other than the suffix differs`).toEqual(restB);
      expect((a || '').replace(block, ''), `call ${i}: the suffix differs by more than the voice block`).toBe(b || '');
    });
    for (const fact of ['8 of 10', '80%', '90%', '3 sessions', 'x2', '10:15', '10:40', '45 seconds', '2 choices']) {
      expect(JSON.stringify(withVoice.drafts[0].messages)).toContain(fact);
    }

    // With the same model reply, the note a BT copies is the same note.
    expect(withVoice.copied).toBeTruthy();
    expect(withVoice.copied).toBe(without.copied);
  });
});

test.describe('one BT\'s voice never reaches a model call for another BT', () => {
  test('each BT drafts with their own reading, and no request carries the other\'s', async ({ browser }) => {
    const env = store({ warm: true, other: true, switchRaw: ALL_ON });
    const run = async (kid) => {
      const context = await browser.newContext();
      const page = await context.newPage();
      try { return await draftRun(page, env, { kid }); } finally { await context.close(); }
    };
    const a = await run(KID);
    const b = await run(OTHER_KID);

    // The raw bodies as sent, so a line is looked for in its JSON-escaped form.
    const aAll = a.modelBound.join('\n');
    const bAll = b.modelBound.join('\n');
    const wire = (line) => JSON.stringify(line).slice(1, -1);
    // Positive controls: each BT's own reading reached their own draft.
    for (const line of A_LINES) expect(aAll).toContain(wire(line));
    expect(bAll).toContain(wire(B_LINE));
    // And never the other's, in any request toward any model.
    for (const line of A_LINES) expect(bAll, `A's line reached B: ${line}`).not.toContain(wire(line));
    expect(aAll, 'B\'s line reached A').not.toContain(wire(B_LINE));
  });

  test('a BT cannot ask the style card for another BT\'s reading by naming them', async () => {
    const env = store({ warm: true, other: true, switchRaw: ALL_ON });
    // B names A three ways; the Worker reads the kid off B's signed token only.
    const card = await cardFor(env, OTHER_KID, `&kid=${KID}&kid[]=${KID}&author=${KID}`);
    expect(card.voice.levels).toEqual([]);
    expect(card.voice.diction).toEqual([{ family_id: 'redirection', variant_index: 2, share: 1, notes: 6 }]);
  });

  test('a session with no kid of its own reads no BT\'s voice', async () => {
    // An admin token carries no kid and maps to "admin", whose store is empty here.
    const env = store({ warm: true, other: true, switchRaw: ALL_ON });
    const req = new Request('https://tools.test/api/style-card?tool=bt&seed=s1', {
      headers: { Authorization: `Bearer ${(() => {
        const body = b64url(JSON.stringify({ role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 }));
        return `${body}.${b64url(createHmac('sha256', SECRET).update(body).digest())}`;
      })()}` },
    });
    const card = await (await worker.fetch(req, env, { waitUntil() {} })).json();
    expect(card.voice).toEqual({ levels: [], diction: [] });
  });
});
