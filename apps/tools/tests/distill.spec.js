import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import path from 'node:path';

/**
 * WHAT AN EDIT TEACHES (slice 5c, the disposition ledger routed into diction
 * and shape). See notes/bcba/distill.js.
 *
 * Three claims, and the first is the slice:
 *
 *   1. One edit, one offered and kept pair, and BOTH readings come off that
 *      same pair: a diction tally through the sealed house dictionary and a
 *      shape specimen the style measurement can read.
 *   2. The ledger row still cannot hold a surface form. Not "the test did not
 *      put one there": a caller that tries, in any slot, is refused, and the
 *      refusal cannot carry the text either.
 *   3. The four answers keep four distinct weights with the sink attached.
 *
 * NODE ONLY except for one test, for the reason diction.spec.js gives: every
 * module here is a browser IIFE with no DOM, a VM runs them, and the revert
 * proof stays in seconds. The one page test is there because a module nothing
 * loads is a module that does not ship.
 */

const ROOT = process.cwd();
const ALL = ['disposition.js', 'diction.js', 'style-features.js', 'specimens.js', 'distill.js'];

function load(files = ALL) {
  const ctx = createContext({ window: {} });
  for (const f of files) runInContext(readFileSync(path.join(ROOT, 'notes/bcba', f), 'utf8'), ctx);
  return ctx.window;
}

// Both sentences clear style-features' 25 word floor, so shape is measurable.
// The rewrite swaps "prompted" for "assisted" and "request" for "ask for", and
// takes six hedges out.
const OFFERED = 'The behavior technician prompted the client to request a break when the demand was presented. ' +
  'The client appeared to perhaps feel somewhat unsettled and possibly may have tended to leave the table during the second block of trials.';
const KEPT = 'The behavior technician assisted the client to ask for a break when the demand was presented. ' +
  'The client left the table twice during the second block of trials, and the technician blocked the door both times.';

const HINT = { producer: 'hints', code: 'no_prompt_level', section: 'lessonProgressNarrative', tool: 'bt' };
const MARK = { producer: 'corrections', code: 'correction', section: 'lessonProgressNarrative', tool: 'bt' };

const IDENT = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ENTRY_KEYS = ['cls', 'code', 'disposition', 'evidence', 'paired', 'producer', 'section', 'tool', 'weight'];

// Every word of four letters or more in a passage, for "none of it is in here".
const wordsOf = (s) => [...new Set(s.toLowerCase().match(/[a-z]{4,}/g) || [])];
// Words that are also enum values in a row, and so prove nothing when found.
const ENUM_WORDS = new Set(['note', 'hints', 'edit', 'rewritten', 'unknown', 'unspecified', 'none', 'reject']);

const countFor = (counts, family, variant) => {
  const row = counts.find((c) => c.family_id === family && c.variant_index === variant);
  return row ? row.count : 0;
};

/* ------------------------------------------ one pair, diction and shape */

test.describe('an edit teaches diction and shape from the same pair', () => {
  test('one edit produces a diction tally and a shape specimen, both read off the same pair', () => {
    const W = load();
    const state = W.NoteDistill.answer(null, HINT, 'edit', { offered: OFFERED, kept: KEPT });
    const read = state.book['hints:no_prompt_level:lessonProgressNarrative'];
    expect(read, 'the edit reached the book under its class').toBeTruthy();

    // Diction: what the rewrite reached for.
    expect(countFor(read.diction.counts, 'prompting', 1), 'assisted').toBe(1);
    expect(countFor(read.diction.counts, 'mand', 2), 'asked for').toBe(1);
    expect(read.diction.refused).toEqual([]);

    // Shape: the same pair, offer before and rewrite after.
    expect(read.shape.before).toBe(OFFERED);
    expect(read.shape.after).toBe(KEPT);
    const features = W.NoteStyleFeatures.compare(read.shape.before, read.shape.after, read.shape.source);
    const hedging = features.find((f) => f.feature === 'hedging');
    expect(hedging, `features: ${JSON.stringify(features)}`).toBeTruthy();
    expect(hedging.direction).toBe(-1);

    // And harvest hands both on when the note leaves.
    const out = W.NoteDistill.harvest(state);
    expect(out.specimens).toHaveLength(1);
    expect(countFor(out.diction, 'prompting', 1)).toBe(1);
    expect(countFor(out.diction, 'mand', 2)).toBe(1);
  });

  test('the diction tally counts what the rewrite added, never a word the offer already held', () => {
    const W = load();
    const offered = 'The technician prompted the client and prompted again after the break.';
    const kept = 'The technician prompted the client and assisted again after the break.';
    const read = W.NoteDistill.distill({ cls: 'hints:x:note', tool: 'bt', offered, kept });
    // One "prompted" was left standing. That is the weak answer, not the edit.
    expect(countFor(read.diction.counts, 'prompting', 0)).toBe(0);
    expect(countFor(read.diction.counts, 'prompting', 1)).toBe(1);
    expect(read.diction.counts).toHaveLength(1);
  });

  test('the shape specimen is the kind, source and owner the specimen chain gives an edited link', () => {
    const W = load();
    const read = W.NoteDistill.distill({ cls: 'hints:x:note', tool: 'bt', offered: OFFERED, kept: KEPT });
    expect(read.shape.kind).toBe('edited');
    expect(read.shape.source).toBe(W.NoteSpecimens.KINDS.edited.source);
    expect(read.shape.own).toBe(W.NoteSpecimens.KINDS.edited.own);
  });

  test('a correction mark gets its diction tallied and no shape specimen, because the chain already teaches its rewording', () => {
    const W = load();
    const state = W.NoteDistill.answer(null, MARK, 'edit', { offered: OFFERED, kept: KEPT });
    const read = state.book['corrections:correction:lessonProgressNarrative'];
    expect(read.shape, 'the specimen chain measures this one at Copy').toBeNull();
    expect(countFor(read.diction.counts, 'prompting', 1)).toBe(1);
    expect(W.NoteDistill.harvest(state).specimens).toHaveLength(0);
  });

  test('an edit that changed nothing yields no shape specimen and no diction', () => {
    const W = load();
    const read = W.NoteDistill.distill({ cls: 'hints:x:note', tool: 'bt', offered: OFFERED, kept: OFFERED });
    expect(read.shape).toBeNull();
    expect(read.diction.counts).toEqual([]);
  });

  test('a rewrite reverted before the note leaves teaches nothing, and one approved after still does', () => {
    const W = load();
    let reverted = W.NoteDistill.answer(null, HINT, 'edit', { offered: OFFERED, kept: KEPT });
    reverted = W.NoteDistill.answer(reverted, HINT, 'revert', null);
    const gone = W.NoteDistill.harvest(reverted);
    expect(gone.specimens).toHaveLength(0);
    expect(gone.diction).toEqual([]);
    // The ledger still has both answers: the book is what the note teaches,
    // the ledger is what the technician did.
    expect(reverted.ledger.entries.map((e) => e.disposition)).toEqual(['edit', 'reject']);

    let approved = W.NoteDistill.answer(null, HINT, 'edit', { offered: OFFERED, kept: KEPT });
    approved = W.NoteDistill.answer(approved, HINT, 'approve', null);
    expect(W.NoteDistill.harvest(approved).specimens).toHaveLength(1);
  });

  test('a second edit of the same suggestion replaces the first', () => {
    const W = load();
    let state = W.NoteDistill.answer(null, HINT, 'edit', { offered: OFFERED, kept: KEPT });
    const second = OFFERED.replace('prompted', 'guided');
    state = W.NoteDistill.answer(state, HINT, 'edit', { offered: OFFERED, kept: second });
    const out = W.NoteDistill.harvest(state);
    expect(out.specimens).toHaveLength(1);
    expect(out.specimens[0].after).toBe(second);
    expect(countFor(out.diction, 'prompting', 2), 'guided').toBe(1);
    expect(countFor(out.diction, 'prompting', 1), 'the first edit is gone').toBe(0);
  });

  test('two marks in one section are two items, so both rewordings are taught and a revert takes out only its own', () => {
    // One class, corrections:correction:lessonProgressNarrative, and two
    // different sentences. Keyed by class alone the second would overwrite the
    // first.
    const W = load();
    const first = { ...MARK, item: 'lessonProgressNarrative:0' };
    const second = { ...MARK, item: 'lessonProgressNarrative:1' };
    let state = W.NoteDistill.answer(null, first, 'edit',
      { offered: 'The technician prompted the client.', kept: 'The technician assisted the client.' });
    state = W.NoteDistill.answer(state, second, 'edit',
      { offered: 'The client requested a break.', kept: 'The client asked for a break.' });
    const both = W.NoteDistill.harvest(state);
    expect(countFor(both.diction, 'prompting', 1), 'the first mark, assisted').toBe(1);
    expect(countFor(both.diction, 'mand', 2), 'the second mark, asked for').toBe(1);

    state = W.NoteDistill.answer(state, first, 'revert', null);
    const after = W.NoteDistill.harvest(state);
    expect(countFor(after.diction, 'prompting', 1), 'the reverted mark').toBe(0);
    expect(countFor(after.diction, 'mand', 2), 'the mark nobody reverted').toBe(1);
  });

  test('an item that is not a short key is read as no item, so it cannot name a slot in the book', () => {
    const W = load();
    const state = W.NoteDistill.answer(null, { ...HINT, item: 'the client hit his sister' }, 'edit',
      { offered: OFFERED, kept: KEPT });
    expect(Object.keys(state.book)).toEqual(['hints:no_prompt_level:lessonProgressNarrative']);
  });

  test('answer returns a new state and leaves the one passed in alone', () => {
    const W = load();
    const first = W.NoteDistill.answer(null, HINT, 'edit', { offered: OFFERED, kept: KEPT });
    const snapshot = JSON.stringify(first);
    const second = W.NoteDistill.answer(first, MARK, 'edit', { offered: OFFERED, kept: KEPT });
    W.NoteDistill.answer(second, HINT, 'revert', null);
    expect(JSON.stringify(first)).toBe(snapshot);
    expect(Object.keys(second.book)).toHaveLength(2);
  });

  test('an answer the ledger refuses teaches nothing, on a note with nothing in it yet', () => {
    const W = load();
    const state = W.NoteDistill.answer(null, { ...HINT, code: 'the client hit his sister' }, 'edit',
      { offered: OFFERED, kept: KEPT });
    expect(state.ledger.entries).toHaveLength(0);
    expect(Object.keys(state.book)).toHaveLength(0);
  });

  test('a page without the dictionary still records the answer and still hands on the shape', () => {
    const W = load(['disposition.js', 'style-features.js', 'specimens.js', 'distill.js']);
    const state = W.NoteDistill.answer(null, HINT, 'edit', { offered: OFFERED, kept: KEPT });
    expect(state.ledger.entries).toHaveLength(1);
    const out = W.NoteDistill.harvest(state);
    expect(out.specimens).toHaveLength(1);
    expect(out.diction).toEqual([]);
  });
});

/* ------------------------------------------ the row cannot hold the text */

test.describe('the ledger row cannot hold a surface form', () => {
  test('a row is identifiers, numbers and a flag, whatever else the caller hands over', () => {
    const W = load();
    const detail = 'Marisol Quintero eloped from the periwinkle classroom on Ashford Lane.';
    // Straight into record, with every free text key a caller might plausibly
    // carry on a suggestion: the budget item's detail, the pair, a note.
    const led = W.NoteDisposition.record(W.NoteDisposition.emptyLedger(), {
      ...HINT, disposition: 'edit', offered: OFFERED, kept: KEPT, detail, text: detail, note: detail, why: detail,
    }, () => {});
    // And through the affordance's call, with the detail and the item key
    // riding on the suggestion. The item picks a slot in the book and never
    // reaches a row.
    const state = W.NoteDistill.answer(null, { ...HINT, detail, item: 'lessonProgressNarrative:7' }, 'edit',
      { offered: OFFERED, kept: KEPT });

    for (const ledger of [led, state.ledger]) {
      expect(ledger.entries).toHaveLength(1);
      const entry = ledger.entries[0];
      expect(Object.keys(entry).sort()).toEqual(ENTRY_KEYS);
      for (const k of ['producer', 'code', 'section', 'tool']) {
        expect(entry[k] === '' || IDENT.test(entry[k]), `${k}: ${entry[k]}`).toBe(true);
      }
      expect(entry.cls.split(':').every((part) => IDENT.test(part))).toBe(true);
      expect(typeof entry.weight).toBe('number');
      expect(typeof entry.paired).toBe('boolean');

      const json = JSON.stringify(ledger).toLowerCase();
      expect(json, 'the item key reached the ledger').not.toContain(':7');
      for (const w of wordsOf(OFFERED + ' ' + KEPT + ' ' + detail)) {
        if (ENUM_WORDS.has(w)) continue;
        expect(json, `"${w}" reached the ledger`).not.toContain(w);
      }
    }
  });

  for (const slot of ['producer', 'code', 'section', 'tool']) {
    test(`a sentence in the ${slot} slot is refused, and the refusal does not carry it either`, () => {
      const W = load();
      const sentence = 'Marisol Quintero eloped twice.';
      const led = W.NoteDisposition.record(W.NoteDisposition.emptyLedger(), {
        ...HINT, [slot]: sentence, disposition: 'approve',
      });
      expect(led.entries, 'no row was filed').toHaveLength(0);
      expect(led.dropped).toHaveLength(1);
      expect(led.dropped[0].reason).toBe('class-not-an-identifier');
      const json = JSON.stringify(led);
      for (const w of ['Marisol', 'Quintero', 'eloped', 'twice']) expect(json).not.toContain(w);
    });
  }

  test('an absent tool or section is still a default rather than a refusal', () => {
    const W = load();
    const led = W.NoteDisposition.record(W.NoteDisposition.emptyLedger(), {
      producer: 'hints', code: 'no_prompt_level', disposition: 'approve',
    });
    expect(led.entries).toHaveLength(1);
    expect(led.entries[0].section).toBe('note');
    expect(led.entries[0].tool).toBe('');
  });
});

/* ------------------------------------------ four answers, four weights */

test.describe('four weights, with the sink attached', () => {
  test('the four answers keep four distinct weights in the ruled order, and only the edit is paired or taught', () => {
    const W = load();
    let state = null;
    const answers = ['none', 'approve', 'reject', 'edit'];
    answers.forEach((d, i) => {
      state = W.NoteDistill.answer(state, { ...HINT, code: `code_${i}` }, d, { offered: OFFERED, kept: KEPT });
    });
    const w = Object.fromEntries(state.ledger.entries.map((e) => [e.disposition, e.weight]));
    expect(new Set(Object.values(w)).size, JSON.stringify(w)).toBe(4);
    expect(w.none).toBeGreaterThan(0);
    expect(w.approve).toBeGreaterThan(w.none);
    expect(w.edit).toBeGreaterThan(w.approve);
    expect(w.reject).toBeLessThan(0);

    const paired = state.ledger.entries.filter((e) => e.paired).map((e) => e.disposition);
    expect(paired).toEqual(['edit']);
    expect(Object.keys(state.book)).toEqual(['hints:code_3:lessonProgressNarrative']);
  });
});

/* ------------------------------------------ it ships */

test('both note pages load the distiller', async ({ page }) => {
  for (const p of ['/notes/bt/', '/notes/bcba/']) {
    await page.goto(p);
    await page.waitForFunction(() => document.readyState === 'complete');
    expect(await page.evaluate(() => typeof window.NoteDistill?.answer), p).toBe('function');
  }
});
