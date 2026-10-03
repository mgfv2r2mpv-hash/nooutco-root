import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import worker from '../_worker.js';
import profileApi from '../../profile-api/src/index.js';
import { d1Sqlite } from '../../profile-api/test/helpers/d1-sqlite.js';
import { isTriageCall } from './helpers/llm-call.js';

/* PROBE, 2026-10-02: why the assess note Kaleb copied at 21:07 wrote no
 * voice_level row. Cloned from voice-write-path.spec.js (same in-process chain:
 * real page -> real _worker.js -> real profile-api -> real SQLite), pointed at
 * the assessment tool, and instrumented at every link of the copy-time emit. */

const PAGE = '/notes/bcba/?tool=assess';
const SECRET = 'voice-assess-probe-secret';
const KID = 'voice-assess-kid';
const ROOT = process.cwd();
const SCHEMA = readFileSync(path.join(ROOT, '../profile-api/schema.sql'), 'utf8');

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function tokenFor() {
  const payload = { role: 'user', kid: KID, tools: ['assess'], exp: Math.floor(Date.now() / 1000) + 3600 };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(createHmac('sha256', SECRET).update(body).digest())}`;
}

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

const NARRATIVE = 'The Behavior Analyst administered the VB-MAPP milestones assessment across levels one and two. The Behavior Analyst interviewed the caregiver about an increase in tantrums over the past two weeks. The Behavior Analyst completed a functional behavior assessment and scored the protocol.';
const RESULTS = 'The client scored at Level 1 overall with 23.5 milestone points. Manding and visual matching were relative strengths. Imitation generalized in play but not on vocal instruction. Crying occurred when a preferred item was visible but out of reach, and the tangible condition resolved it.';
const ADDED = ' The Behavior Analyst began treatment plan goal development.';

function note(over = {}) {
  return {
    activities: ['Administration of assessment tool', 'Caregiver/Guardian interview', 'Functional Behavior Assessment'],
    reporting: ['Assessment Scoring / Interpretation of results'],
    narrative: NARRATIVE,
    results: RESULTS,
    hints: [],
    ...over,
  };
}

const TYPED_RESULTS = 'The client scored at Level 1 overall with 23.5 milestone points, which I would call an early learner profile. Manding was strong. Visual matching was a strength and I saw it across every probe I ran today with the caregiver present. Imitation generalized in play but not on vocal instruction, so I will target it next.';

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

async function wire(page, c) {
  await page.route('**/api/audit**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const res = await throughWorker(c, `http://localhost${u.pathname}${u.search}`, req.headers(), req.postData());
    await route.fulfill({ status: res.status, contentType: 'application/json', body: res.body });
  });
}

/* The model reply: call 1 triage, call 2 the draft, every later call the
   revision (a whole note with `revised` merged in). */
async function draft(page, c, { corrections = [], revised = {}, aid = false } = {}) {
  await wire(page, c);
  let calls = 0;
  await page.route('**/api/llm-call**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(body)) return route.fulfill(reply({ sufficient: true, questions: [], readiness: 90 }));
    calls++;
    return route.fulfill(reply(calls === 1 ? note() : note(revised)));
  });
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
  await page.route('**/api/corrections-pass**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ corrections, dropped: 0, usage: { input_tokens: 10, output_tokens: 5 }, model: 'test' }),
    }));

  const url = aid ? PAGE + '&aid=1' : PAGE;
  await page.goto(url);
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto(url);
  await page.getByRole('textbox', { name: /Summary Notes of Activities/i })
    .fill('VB-MAPP levels 1-2, Level 1 overall 23.5 points. Caregiver interview re tantrums. FBA, tangible condition resolved crying. Scored protocol.');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await acceptScrubGate(page);
  if (corrections.length) {
    await expect(page.locator('[data-corrections-section]').first()).toBeVisible({ timeout: 20000 });
  } else {
    await expect(page.locator('textarea[data-section-id="results"]')).toBeVisible({ timeout: 20000 });
  }
  await instrument(page);
}

/* Wrap every link the copy-time emit goes through. engine.jsx names
   NoteSpecimens, NoteVoice and NotesGate as globals at call time, so wrapping
   the methods on window is seen by the closure. */
async function instrument(page) {
  await page.evaluate(() => {
    const P = (window.__probe = { pairs: [], entries: [], voiceCalls: [], copies: [] });
    const origPairs = window.NoteSpecimens.pairs;
    window.NoteSpecimens.pairs = (args) => {
      const out = origPairs(args);
      P.pairs.push({
        ids: args.ids,
        draftKeys: args.draft ? Object.keys(args.draft) : null,
        draftNarrativeLen: args.draft ? String(args.draft.narrative || '').length : null,
        draftResultsLen: args.draft ? String(args.draft.results || '').length : null,
        bookKeys: Object.keys(args.book || {}),
        out: out.map((p) => ({ kind: p.kind, own: p.own, beforeLen: p.before.length, afterLen: p.after.length })),
      });
      return out;
    };
    const origEntry = window.NoteVoice.entry;
    window.NoteVoice.entry = (args) => {
      const out = origEntry(args);
      P.entries.push({ tool: args.tool, ids: args.ids, out });
      return out;
    };
    const origVoice = window.NotesGate.audit.voice;
    window.NotesGate.audit.voice = (e) => { P.voiceCalls.push(e); return origVoice(e); };
    const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => { P.copies.push({ len: String(t).length, stack: new Error().stack.split('\n').slice(1, 4).join(' | ') }); return origWrite(t).catch(() => {}); };
  });
}

const probe = (page) => page.evaluate(() => ({
  ...window.__probe,
  voiceBuffer: window.NotesGate.audit._voice(),
  hasStyle: !!window.NoteStyleFeatures, hasMetrics: !!window.NoteMetrics,
}));

const trail = (c) => c.kv.map((v) => JSON.parse(v)).flatMap((r) => r.events);
const voiceSent = (c) => c.forwarded.flatMap((b) => JSON.parse(b).voice || []);
const voiceRows = (c) => c.rows(`SELECT tool, feature, n FROM voice_level WHERE kid = ? ORDER BY feature`, KID);

async function settle(page) {
  await expect.poll(() => page.evaluate(() => window.NotesGate.audit._buffer().length + window.NotesGate.audit._corrections().length), { timeout: 10000 }).toBe(0);
  await page.waitForTimeout(1000);
}

async function copySection(page, id) {
  await page.locator(`[data-section-key="${id}"]`).getByRole('button', { name: 'Copy', exact: true }).click();
}

async function copyAll(page) {
  await page.getByRole('button', { name: /^Copy All$/ }).click();
}

const report = (label, data) => console.log(`\n=== ${label} ===\n${JSON.stringify(data, null, 1)}`);

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('PROBE: assess voice at copy', () => {
  test('D. no corrections, hand edit results, Copy (assess analogue of the BT test)', async ({ page }) => {
    const c = chain();
    await draft(page, c);
    await page.locator('textarea[data-section-id="results"]').fill(TYPED_RESULTS);
    await copySection(page, 'results');
    await settle(page);
    report('D', { probe: await probe(page), sent: voiceSent(c), rows: voiceRows(c), copied: trail(c).filter((e) => /note_/.test(e.type)) });
    expect(voiceRows(c).length).toBeGreaterThan(0);
  });

  test('C. corrections up, Edit by hand, hand edit, Copy', async ({ page }) => {
    const c = chain();
    await draft(page, c, { corrections: [{ section: 'narrative', text: NARRATIVE + ADDED, why: 'test' }] });
    await page.locator('[data-corrections-done="narrative"]').click();
    await page.locator('textarea[data-section-id="results"]').fill(TYPED_RESULTS);
    await copyAll(page);
    await settle(page);
    report('C', { probe: await probe(page), sent: voiceSent(c), rows: voiceRows(c) });
    expect(voiceRows(c).length).toBeGreaterThan(0);
  });

  test('B. corrections up and left as offered, Copy, THEN hand edit and Copy again', async ({ page }) => {
    const c = chain();
    await draft(page, c, { corrections: [{ section: 'narrative', text: NARRATIVE + ADDED, why: 'test' }] });
    await copySection(page, 'narrative');
    await settle(page);
    const first = await probe(page);
    const afterFirst = { sent: voiceSent(c).length, rows: voiceRows(c).length, events: trail(c).filter((e) => /note_/.test(e.type)) };
    await page.locator('[data-corrections-done="narrative"]').click();
    await page.locator('textarea[data-section-id="results"]').fill(TYPED_RESULTS);
    await copyAll(page);
    await settle(page);
    report('B', { first, afterFirst, final: await probe(page), sent: voiceSent(c), rows: voiceRows(c), events: trail(c).filter((e) => /note_/.test(e.type)) });
  });

  test('A. Kaleb literal: corrections, reword one inline, Copy, Edit by hand, hand edit, NoMe revision accepted, Copy', async ({ page }) => {
    const c = chain();
    await draft(page, c, {
      corrections: [{ section: 'narrative', text: NARRATIVE + ADDED, why: 'test' }],
      revised: { results: RESULTS.replace('relative strengths', 'clear strengths') },
    });
    const key = await page.locator('[data-corrections-section="narrative"] [data-correction-type="ins"]').first().getAttribute('data-correction');
    await page.locator(`[data-correction="${key}"]`).click();
    await page.locator(`[data-correction-pencil="${key}"]`).click();
    await page.locator(`[data-correction-edit="${key}"]`).fill(' I started writing the treatment plan goals.');
    await page.locator(`[data-correction-save="${key}"]`).click();
    await copySection(page, 'narrative');
    await settle(page);
    const first = await probe(page);
    const afterFirst = { sent: voiceSent(c).length, rows: voiceRows(c) };

    await page.locator('[data-corrections-done="narrative"]').click();
    await page.locator('textarea[data-section-id="narrative"]').fill(NARRATIVE + ' I started writing the treatment plan goals and will finish them Friday with the caregiver.');
    await page.getByText('Results of Assessment', { exact: true }).click();
    await page.locator('.revision-input').fill('say clear strengths');
    await page.locator('.revision-send').click();
    await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /^Accept$/ }).click();
    await copyAll(page);
    await settle(page);
    report('A', { first, afterFirst, final: await probe(page), sent: voiceSent(c), rows: voiceRows(c), events: trail(c).filter((e) => /note_|revision|corrections/.test(e.type)) });
  });

  test('E. no corrections, NoMe revision accepted, hand edit, Copy', async ({ page }) => {
    const c = chain();
    await draft(page, c, { revised: { results: RESULTS.replace('relative strengths', 'clear strengths') } });
    await page.getByText('Results of Assessment', { exact: true }).click();
    await page.locator('.revision-input').fill('say clear strengths');
    await page.locator('.revision-send').click();
    await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /^Accept$/ }).click();
    await page.locator('textarea[data-section-id="results"]').fill(TYPED_RESULTS);
    await copySection(page, 'results');
    await settle(page);
    report('E', { probe: await probe(page), sent: voiceSent(c), rows: voiceRows(c) });
  });

  /* THE REGRESSION. A note copied once with nothing of the technician's in it
     (corrections left standing as offered) used to spend the note's one
     teaching, so the hand work done after that first Copy never reached the
     store. One note still teaches once: the second test pins that. */
  test('FIX: a note copied untouched first, then worked by hand and copied again, lands its levels once', async ({ page }) => {
    const c = chain();
    await draft(page, c, { corrections: [{ section: 'narrative', text: NARRATIVE + ADDED, why: 'test' }] });
    await copySection(page, 'narrative');
    await settle(page);
    expect(voiceSent(c)).toEqual([]);
    await page.locator('[data-corrections-done="narrative"]').click();
    await page.locator('textarea[data-section-id="results"]').fill(TYPED_RESULTS);
    await copyAll(page);
    await settle(page);
    await expect.poll(() => voiceRows(c).length, { timeout: 10000 }).toBe(4);
    expect(voiceSent(c).length).toBe(1);
    expect(voiceRows(c).every((r) => r.tool === 'assess' && r.n === 1)).toBe(true);
    // The copy itself is still counted once.
    expect(trail(c).filter((e) => e.type === 'note_copied').length).toBe(1);
  });

  test('FIX: a note that already taught its levels does not teach them again on a later Copy', async ({ page }) => {
    const c = chain();
    await draft(page, c);
    await page.locator('textarea[data-section-id="results"]').fill(TYPED_RESULTS);
    await copySection(page, 'results');
    await settle(page);
    await page.locator('textarea[data-section-id="narrative"]').fill(NARRATIVE + ' I will finish the goals Friday with the caregiver present.');
    await copyAll(page);
    await settle(page);
    expect(voiceSent(c).length).toBe(1);
    expect(voiceRows(c).every((r) => r.n === 1)).toBe(true);
  });
});
