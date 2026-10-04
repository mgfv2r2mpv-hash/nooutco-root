import { test, expect } from '@playwright/test';
import path from 'node:path';

/* TITLE CASE PROGRAM WORDS ARE NOT NAMES.
 *
 * Approved 2 Oct 2026, from the diagnosis of one bad production Supervision
 * note. detectNames flags any capitalised word that is not first on its line
 * or sentence and is not on STOPWORDS. Program titles are written in Title
 * Case ("Personal Information", "Safety Questions", "Task Refusal"), so every
 * word of them was flagged, and since the review dialog went on 2026-08-24
 * each one leaves as an opaque [[Tn]] with no confirm step. The replace is
 * case blind, so a flagged word took its lowercase uses with it, and the model
 * wrote the note around a row of tokens where the goal names should have been.
 *
 * His choice: WORD LIST FIRST, no new UI step. The list is curated from the
 * tools' own vocabulary and stays short on purpose.
 *
 * THE OTHER SIDE IS THE ONE THAT MATTERS MOST. A real name that reaches the
 * model in the clear is the worst outcome this change can have, so half of
 * this file is name cases: a program word standing next to a name is still
 * masked with it, the first-names dictionary still owns every word it knows,
 * and every word on the list is checked against that dictionary.
 */

const ROOT = process.cwd();
const url = (rel) => 'file://' + path.join(ROOT, rel);

let gate;
let raw;

test.beforeAll(async () => {
  const lib = await import(url('scripts/lib/gate-context.mjs'));
  gate = lib.loadGateFromFile(path.join(ROOT, 'assets/notes-gate.js'), 'working tree');
  raw = gate.raw;
});

const lower = (list) => list.map((n) => n.toLowerCase());

/* Invented program titles built from the words in the bad note's class. */
const PROGRAM_LINES = [
  'The technician ran Personal Information and Safety Questions today.',
  'BT worked on Manding, Tacting and Imitation across the block.',
  'Trials on Matching and Listener Responding were run at the table.',
  'The team reviewed Toileting data, and Task Refusal and Aggression stayed low.',
  'Fidelity was checked on Tolerating Delays and Requesting Breaks.',
  'The technician ran mixed trials on Receptive Identification for the next visit.',
];

test.describe('program words in Title Case are not name candidates', () => {
  for (const line of PROGRAM_LINES) {
    test(`nothing is flagged in: ${line}`, () => {
      expect(gate.detectNames(line)).toEqual([]);
    });
  }

  test('after with or for, a program word is still not a person', () => {
    expect(gate.detectNames('The client did well with Imitation and asked for Toileting twice.')).toEqual([]);
  });
});

test.describe('names are still masked', () => {
  test('every word on the list is outside the first-names dictionary', () => {
    const words = raw.programWords();
    expect(words.length).toBeGreaterThan(0);
    expect(words.filter((w) => gate.isFirstName(w))).toEqual([]);
  });

  test('a program word in surname position after a known first name is masked with it', () => {
    for (const w of raw.programWords()) {
      const title = w[0].toUpperCase() + w.slice(1);
      const found = gate.detectNames(`Pickup was done by Sarah ${title} after the session.`);
      expect(lower(found), title).toContain(`sarah ${w}`);
    }
  });

  test('a program word next to an unknown capitalised word is masked as a pair', () => {
    for (const w of raw.programWords()) {
      const title = w[0].toUpperCase() + w.slice(1);
      const found = lower(gate.detectNames(`The session was covered by Kowalski ${title} today.`));
      expect(found, title).toContain(`kowalski ${w}`);
    }
  });

  test('a program word whose neighbour falls outside the pair window is still kept with it', () => {
    // The pair regex reads two words at a time, so "Mom Matching" is one window
    // and "Kowalski" the next. Matching stands beside a name all the same.
    const found = lower(gate.detectNames('The consent was signed by Mom Matching Kowalski at pickup.'));
    expect(found).toContain('matching');
    expect(found).toContain('kowalski');
  });

  test('first names are still taken in any case, and pairs of them as pairs', () => {
    expect(lower(gate.detectNames('The sheet was signed by Sarah Smith.'))).toEqual(
      expect.arrayContaining(['sarah smith', 'sarah', 'smith']),
    );
    expect(lower(gate.detectNames('mom sarah called and client jacob eloped.'))).toEqual(
      expect.arrayContaining(['sarah', 'jacob']),
    );
    expect(gate.detectNames('Client Adaeze worked on Matching.')).toContain('Adaeze');
  });
});

/* THE PARENT NOTE SHAPE, added 2026-10-03 with the parent note plan. A
 * production parent intake headed its lists "Client Goals:" and "Parent
 * Goals:" and wrote pipe rows whose first cell is the program. The role-label
 * cue read "Goals" after "Client" as the client's name and minted [CLIENT] for
 * it, so "Parent Goals:" reached the model as "Parent [CLIENT]:" and the note
 * came back saying "BCBA met with Parent Goals". Invented lines of that shape. */
const PARENT_SHAPE = [
  'Client Goals:',
  'Parent Goals:',
  'Complete Functional One-Step Instructions (Listener Resp.)|0/3',
  '1. Parent Goal: Implement Toilet Training Plan|Use Timer|2/0|100%',
  'The caregiver ran the Client Goal and two Parent Goals today.',
  'BT reviewed the client Programs and the caregiver Targets.',
  // Added with the wider list: rows of the parent note test cases.
  '2. Climbing (Bx Reduction) 2 instances during the session.',
  '1. Parent Goal: Deliver Token Board|Present Token Board Before Demand|4/1|80%',
  '1. Parent Goal: Use First-Then Language|At Home|5/0|100%',
  '1. Parent Goal: Follow Visual Schedule|Point to Next Picture|3/1|75%',
  'Client Goals: Transitions Between Activities|with visual|3/0|100%',
  'A: Add Parent Goal: Implement BIP Climbing: Prompt FCR (Antecedent) 6/1 85%.',
  'The target was "Stand up" + raise hands.',
];

test.describe('goal headers after a role word are not names', () => {
  for (const line of PARENT_SHAPE) {
    test(`nothing is flagged in: ${line}`, () => {
      expect(gate.detectNames(line)).toEqual([]);
    });
  }

  test('a real name after a role word is still taken, header or not', () => {
    expect(gate.detectNames('Client Goals: Client Adaeze did Matching.')).toContain('Adaeze');
    expect(lower(gate.detectNames('Mom Sarah ran Implement Toilet Training Plan with the client.'))).toContain('sarah');
  });

  test('a header word in surname position beside a name is still masked with it', () => {
    expect(lower(gate.detectNames('The form was signed by Kowalski Goals at pickup.'))).toContain('kowalski goals');
  });
});

/* The drafting path end to end: what the model is actually handed. */
async function loggedIn(page) {
  await page.goto('/notes/bt/');
  await page.evaluate(() => {
    const payload = { role: 'user', kid: 'pw:tech-1', tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    localStorage.setItem('notes_auth_token', `${b64}.local-test`);
  });
  await page.reload();
}

const scrubOf = (page, text) =>
  page.evaluate(async (t) => {
    const rev = await window.NotesScrub.review({ freeText: t });
    return { map: rev.map.map((e) => e.name), scrubbed: window.NotesScrub.applyMap(t, rev.map) };
  }, text);

test.describe('what the model is handed', () => {
  test('a program title and its lowercase uses leave the page as written', async ({ page }) => {
    await loggedIn(page);
    const text = 'The team ran Safety Questions and Personal Information. The client answered personal questions about safety.';
    const r = await scrubOf(page, text);
    expect(r.map).toEqual([]);
    expect(r.scrubbed).toBe(text);
  });

  test('a parent intake\'s goal headers and program rows leave the page as written', async ({ page }) => {
    await loggedIn(page);
    const text = 'Client Goals:\nComplete Functional One-Step Instructions|0/3\nParent Goals:\n1. Parent Goal: Implement Toilet Training Plan|2/0|100%\nBCBA met with caregivers.';
    const r = await scrubOf(page, text);
    expect(r.scrubbed).not.toMatch(/\[\[T\d+\]\]|\[CLIENT\]/);
    expect(r.scrubbed).toContain('Parent Goals:');
    expect(r.scrubbed).toContain('Implement Toilet Training Plan');
  });

  test('the name beside the program title is still taken', async ({ page }) => {
    await loggedIn(page);
    const r = await scrubOf(page, 'BT ran Task Refusal trials with Jacob, and Sarah Matching signed at pickup.');
    expect(r.scrubbed).not.toMatch(/jacob|sarah/i);
    expect(r.scrubbed).not.toContain('Sarah Matching');
    expect(r.scrubbed).toContain('Task Refusal');
  });
});
