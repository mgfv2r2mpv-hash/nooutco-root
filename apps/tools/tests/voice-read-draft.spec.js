import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import worker, { sanitizeVoiceReading } from '../_worker.js';
import profileApi from '../../profile-api/src/index.js';
import { accumulateLevel } from '../../profile-api/src/voice-shrink.js';
import { d1Sqlite } from '../../profile-api/test/helpers/d1-sqlite.js';
import { isTriageCall } from './helpers/llm-call.js';

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
function tokenFor() {
  const payload = { role: 'user', kid: KID, tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
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

/** A store with this author's voice in it, or an empty one. */
function store({ warm }) {
  const DB = d1Sqlite(SCHEMA);
  if (warm) {
    const now = Date.now();
    const level = (feature, value, n) => {
      let row = null;
      for (let i = 0; i < n; i += 1) row = accumulateLevel(row, value);
      DB.sqlite.prepare(
        'INSERT INTO voice_level (kid, tool, feature, n, sum, sum_sq, w_n, w_sum, w_sum_sq, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(KID, 'bt', feature, row.n, row.sum, row.sum_sq, row.w_n, row.w_sum, row.w_sum_sq, now);
    };
    level('actor_naming', 0.1, 200);
    level('hedging', 0.044, 40);
    DB.sqlite.prepare('INSERT INTO diction_level (kid, tool, family, variant, count, notes, updated) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(KID, 'bt', 'mand', 1, 12, 5, now);
  }
  return {
    ADMIN_SECRET: SECRET,
    PROFILE: { fetch: (url, init) => profileApi.fetch(new Request(url, init), { DB }) },
  };
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

/** Draft one note with the style card served by the real chain, and return the
 *  system_suffix of the drafting call. */
async function draftSuffix(page, env) {
  const drafts = [];
  await page.route('**/api/style-card**', async (route) => {
    const req = route.request();
    const res = await worker.fetch(new Request(req.url(), { headers: req.headers() }), env, { waitUntil() {} });
    await route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
  });
  await page.route('**/api/llm-call**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(body)) return route.fulfill(reply({ sufficient: true, questions: [], readiness: 90 }));
    drafts.push(body);
    return route.fulfill(reply(NOTE));
  });
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
  await page.route('**/api/corrections-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ corrections: [], dropped: 0, usage: {}, model: 'test' }) }));
  await page.route('**/api/audit**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"stored":0,"profile":"skipped"}' }));

  await page.goto(BT_PAGE);
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto(BT_PAGE);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT 3-item array, full physical faded to independent');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2, blocked the door');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await acceptScrubGate(page);
  await expect.poll(() => drafts.length, { timeout: 30000 }).toBeGreaterThan(0);
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
      at all for write rather its synonyms`.split(/\s+/).filter(Boolean));
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
