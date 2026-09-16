import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import path from 'node:path';

/**
 * THE HOUSE SYNONYM FAMILIES (slice 5a, diction).
 *
 * The claim under test is not "the dictionary is right" - a synonym list is a
 * judgment and the maintainer owns it. It is the narrower thing the privacy
 * shape rests on: A WORD CANNOT LEAVE. What comes out of this module is a
 * family id from a sealed list, an integer, and a count, and a word the house
 * does not hold is a number called `unknown` and nothing else.
 *
 * Two of these tests exist because the failure they catch is silent. A surface
 * form written into two families never fires from the losing one, so its counts
 * land on the winner and every number stays plausible. And the longest-match
 * rule is the only thing that makes a phrase a phrase: without it "asked for"
 * is two unknown words, which reads exactly like an author who does not mand.
 *
 * NODE ONLY except for one test. diction.js is a browser IIFE with no
 * dependencies, so a VM with a bare `window` runs it, which keeps the revert
 * proof in seconds rather than minutes. The one page test is there because a
 * module nothing loads is a module that does not ship, and both note pages have
 * to carry it.
 */

const ROOT = process.cwd();

function loadDiction() {
  const src = readFileSync(path.join(ROOT, 'notes/bcba/diction.js'), 'utf8');
  const ctx = createContext({ window: {} });
  runInContext(src, ctx);
  return ctx.window.NoteDiction;
}

let D;
test.beforeAll(() => {
  D = loadDiction();
});

const countFor = (tallied, family, variant) => {
  const row = tallied.counts.find(
    (c) => c.family_id === family && c.variant_index === variant,
  );
  return row ? row.count : 0;
};

/* ---------------------------------------------- the dictionary is a fixture */

test.describe('the shipped dictionary', () => {
  test('no surface form is written down twice', () => {
    // A duplicate is invisible in every other measurement: the second family
    // simply never fires and its count lands on the first.
    expect(D.selfCheck()).toEqual([]);
  });

  test('selfCheck really does catch a duplicate, and an empty form', () => {
    const dupes = D.selfCheck([
      { id: 'one', variants: [['prompted'], ['guided']] },
      { id: 'two', variants: [['prompted'], ['']] },
    ]);
    expect(dupes.map((d) => d.reason).sort()).toEqual([
      'form holds no word',
      'form is written down twice',
    ]);
  });

  test('every family id is a slug, unique, and holds at least two variants', () => {
    const ids = D.FAMILY_IDS;
    expect(ids.length).toBeGreaterThanOrEqual(12);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z_]{1,23}$/);
    // A family with one variant records a choice nobody made.
    for (const f of D.FAMILIES) expect(f.variants.length).toBeGreaterThanOrEqual(2);
  });

  test('the four families the maintainer named are in it', () => {
    for (const id of ['prompting', 'mand', 'elopement', 'dysregulation']) {
      expect(D.FAMILY_IDS).toContain(id);
    }
  });
});

/* ------------------------------------------------------------ what a tally is */

test.describe('tally', () => {
  test('a variant is recorded by its index, whatever case it was typed in', () => {
    const t = D.tally('Prompted the learner, then PROMPTED again.');
    expect(t.counts).toEqual([{ family_id: 'prompting', variant_index: 0, count: 2 }]);
  });

  test('forms of one variant share an index and sum', () => {
    // "prompted" and "prompting" are the same decision, so they are one number.
    const t = D.tally('BT prompted at the table and was prompting throughout.');
    expect(countFor(t, 'prompting', 0)).toBe(2);
    expect(t.counts.filter((c) => c.family_id === 'prompting')).toHaveLength(1);
  });

  test('a different synonym in the same family gets a different index', () => {
    const t = D.tally('BT assisted with the task and guided the reach.');
    expect(countFor(t, 'prompting', 1)).toBe(1);
    expect(countFor(t, 'prompting', 2)).toBe(1);
    expect(countFor(t, 'prompting', 0)).toBe(0);
  });

  test('a phrase beats its first word, so "asked for" is a mand', () => {
    // The longest-first scan is the guard. Reverse it and this text carries no
    // mand at all, which reads as an author who never describes one.
    const t = D.tally('The learner asked for the bubbles.');
    expect(countFor(t, 'mand', 2)).toBe(1);
  });

  test('a phrase wins over a shorter form that starts it', () => {
    /* "asked for" was the wrong fixture for this and the revert proof said so:
       "asked" is in no family, so the scan reaches the phrase from either
       direction. The rule only bites where both forms are real, which in this
       dictionary is "prompted back". Read shortest first it is a prompt, and
       the redirection the technician described is gone. */
    const t = D.tally('BT prompted back to the table after the break.');
    expect(countFor(t, 'redirection', 3)).toBe(1);
    expect(countFor(t, 'prompting', 0)).toBe(0);
  });

  test('"ran mixed trials" is not elopement and "ran off" is', () => {
    const programme = D.tally('BT ran mixed trials and ran discrete trials.');
    expect(programme.counts.filter((c) => c.family_id === 'elopement')).toHaveLength(0);

    const behaviour = D.tally('The learner ran off toward the hallway.');
    expect(countFor(behaviour, 'elopement', 2)).toBe(1);
  });

  test('a word the house does not hold is counted, not kept', () => {
    const t = D.tally('Grace Okonkwo attended Willowbrook Elementary on Tuesday.');
    const clinical = t.counts.filter((c) => c.family_id !== 'engagement');
    expect(clinical).toEqual([]);
    // Every other word in that sentence, a name included, is one tick of a
    // number. Seven words, one of which ("attended") the house does hold.
    expect(t.unknown).toBe(t.words - t.known);
    expect(t.unknown).toBeGreaterThan(0);
  });

  test('a note with no house word at all yields no counts and all unknown', () => {
    const t = D.tally('Marisol Quintero brought the periwinkle folder from Ashford Lane.');
    expect(t.counts).toEqual([]);
    expect(t.known).toBe(0);
    expect(t.unknown).toBe(t.words);
    expect(t.words).toBe(9);
  });

  test('counts come back in a stable order whatever order the note used', () => {
    const a = D.tally('reinforced, then calm, then assisted');
    const b = D.tally('assisted, then calm, then reinforced');
    expect(a.counts).toEqual(b.counts);
  });

  test('a phrase that runs past the end of the text does not read off the end', () => {
    const t = D.tally('asked for');
    expect(countFor(t, 'mand', 2)).toBe(1);
    expect(t.words).toBe(2);
  });

  test('a duplicated form fires from the family that wrote it first', () => {
    /* This is what makes selfCheck's report readable. It names a `first` and a
       `second`, and that is only true if the scan agrees about which is which;
       otherwise the duplicate report points at the family that is still
       working. */
    const dict = [
      { id: 'first_one', variants: [['guided'], ['prompted']] },
      { id: 'second_one', variants: [['prompted'], ['cued']] },
    ];
    expect(D.selfCheck(dict)[0].first).toBe('first_one[1]');
    const t = D.tally('BT prompted twice.', dict);
    expect(t.counts).toEqual([{ family_id: 'first_one', variant_index: 1, count: 1 }]);
  });

  test('a form longer than the phrase cap is never looked for', () => {
    // The cap bounds the scan per word. A form past it is dropped at load, so
    // it cannot match however it is typed.
    const long = 'gave a little bit of help';
    const dict = [{ id: 'prompting', variants: [['prompted'], [long]] }];
    expect(long.split(' ').length).toBeGreaterThan(D.MAX_PHRASE_WORDS);
    const t = D.tally('BT ' + long + ' there.', dict);
    expect(t.counts).toEqual([]);
  });
});

/* --------------------------------------------- the gate in front of the store */

test.describe('record, the sealed check', () => {
  test('a family the house does not hold is refused, and the refusal does not name it', () => {
    // The only way to produce this is an injected dictionary, which is why the
    // seam exists. A caller cannot smuggle a made up family into the store.
    const t = D.tally('Grace and Grace again.', [
      { id: 'grace', variants: [['grace'], ['gracie']] },
    ]);
    expect(t.counts).toEqual([{ family_id: 'grace', variant_index: 0, count: 2 }]);

    const out = D.record(t);
    expect(out.counts).toEqual([]);
    expect(out.refused).toHaveLength(1);
    expect(JSON.stringify(out.refused)).not.toContain('grace');
  });

  test('a variant index past the end of a real family is refused', () => {
    const variants = D.VARIANT_COUNTS.prompting;
    const out = D.record({
      counts: [
        { family_id: 'prompting', variant_index: variants, count: 1 },
        { family_id: 'prompting', variant_index: variants - 1, count: 1 },
      ],
      unknown: 3,
      words: 5,
    });
    expect(out.counts).toEqual([
      { family_id: 'prompting', variant_index: variants - 1, count: 1 },
    ]);
    expect(out.refused[0].reason).toMatch(/variant index/);
  });

  test('a negative or fractional index is refused rather than floored', () => {
    const out = D.record({
      counts: [
        { family_id: 'prompting', variant_index: -1, count: 1 },
        { family_id: 'prompting', variant_index: 1.5, count: 1 },
      ],
    });
    expect(out.counts).toEqual([]);
    expect(out.refused).toHaveLength(2);
  });

  test('a count that is not a positive whole number is refused', () => {
    const out = D.record({
      counts: [
        { family_id: 'mand', variant_index: 0, count: 0 },
        { family_id: 'mand', variant_index: 1, count: 2.5 },
        { family_id: 'mand', variant_index: 2, count: 3 },
      ],
    });
    expect(out.counts).toEqual([{ family_id: 'mand', variant_index: 2, count: 3 }]);
    expect(out.refused).toHaveLength(2);
  });

  test('a payload comes back in the same stable order however it arrived', () => {
    // The store is keyed on (family, variant), so two notes that used the same
    // words in a different order have to produce the same rows.
    const out = D.record({
      counts: [
        { family_id: 'mand', variant_index: 1, count: 1 },
        { family_id: 'calming', variant_index: 0, count: 2 },
        { family_id: 'mand', variant_index: 0, count: 3 },
      ],
    });
    expect(out.counts.map((c) => c.family_id + ':' + c.variant_index)).toEqual([
      'calming:0', 'mand:0', 'mand:1',
    ]);
  });

  test('unknown and words come back as whole numbers whatever arrived', () => {
    const out = D.record({ counts: [], unknown: 'seventeen', words: -4 });
    expect(out.unknown).toBe(0);
    expect(out.words).toBe(0);
  });

  test('nothing in a payload is a string except a house family id', () => {
    /* The privacy claim, driven over prose with invented people, a place and a
       diagnosis in it. Every string that survives has to be a family id. */
    const note = [
      'Grace Okonkwo prompted her son Tobias at the Willowbrook clinic.',
      'Tobias eloped toward Ashford Lane and was redirected by Marisol.',
      'Dr Vandersteen reviewed the plan and praised the caregiver.',
    ].join(' ');
    const out = D.record(D.tally(note));
    expect(out.counts.length).toBeGreaterThan(2);

    const strings = [];
    const walk = (v) => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(out.counts);
    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) expect(D.FAMILY_IDS).toContain(s);
  });
});

/* ------------------------------------------------ the per author running total */

test.describe('merge', () => {
  test('two notes sum into one row per variant', () => {
    const first = D.record(D.tally('BT prompted and prompted again.')).counts;
    const second = D.record(D.tally('BT prompted once, then assisted.')).counts;
    const merged = D.merge(first, second);
    expect(merged).toEqual([
      { family_id: 'prompting', variant_index: 0, count: 3 },
      { family_id: 'prompting', variant_index: 1, count: 1 },
    ]);
  });

  test('neither argument is touched', () => {
    const prev = [{ family_id: 'mand', variant_index: 0, count: 2 }];
    const next = [{ family_id: 'mand', variant_index: 0, count: 5 }];
    const merged = D.merge(prev, next);
    expect(prev).toEqual([{ family_id: 'mand', variant_index: 0, count: 2 }]);
    expect(next).toEqual([{ family_id: 'mand', variant_index: 0, count: 5 }]);
    expect(merged[0].count).toBe(7);
    expect(merged[0]).not.toBe(prev[0]);
  });

  test('a family the house does not hold cannot enter the running total', () => {
    const merged = D.merge(
      [{ family_id: 'mand', variant_index: 0, count: 1 }],
      [{ family_id: 'grace', variant_index: 0, count: 9 }],
    );
    expect(merged).toEqual([{ family_id: 'mand', variant_index: 0, count: 1 }]);
  });

  test('a fractional count or index cannot enter the running total either', () => {
    const merged = D.merge(
      [{ family_id: 'mand', variant_index: 0, count: 1 }],
      [
        { family_id: 'mand', variant_index: 0, count: 0.5 },
        { family_id: 'mand', variant_index: 1.5, count: 2 },
      ],
    );
    expect(merged).toEqual([{ family_id: 'mand', variant_index: 0, count: 1 }]);
  });

  test('an empty history merges to this note', () => {
    const next = D.record(D.tally('BT guided the reach.')).counts;
    expect(D.merge(null, next)).toEqual(next);
    expect(D.merge(undefined, undefined)).toEqual([]);
  });
});

/* ------------------------------------------------------------ it actually ships */

test('both note pages load the dictionary', async ({ page }) => {
  for (const url of ['/notes/bt/index.html', '/notes/bcba/index.html']) {
    await page.goto(url);
    await page.waitForFunction(() => !!window.NoteDiction);
    const ids = await page.evaluate(() => window.NoteDiction.FAMILY_IDS);
    expect(ids).toEqual(D.FAMILY_IDS);
  }
});
