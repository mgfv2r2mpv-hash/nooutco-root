import { test, expect } from '@playwright/test';
import path from 'node:path';

/**
 * Landing tests for the false positive census (slice 2).
 *
 * THE CENSUS CHANGES NO DETECTION BEHAVIOUR, so its landing test cannot be
 * "the fix works". What it can be, and is, is three things that each fail on
 * their own:
 *
 *   1. the truth is a truth. Every name and identifier the corpus claims is
 *      really in the text it claims it is in. A fixture that drifted from its
 *      own prose would move every number in the report and look like a finding
 *   2. the scorer is pinned against arithmetic done by hand, not against its
 *      own output. Precision and recall are written out in the test as
 *      fractions a reader can check
 *   3. the census still sees the guards that are in the tree. Take the
 *      lowercase guard out of detectNames or inferRoles and the
 *      verb-after-role-cue count for the working tree stops being zero, which
 *      is the same thing the two-column report says in prose
 *
 * Node only. No page, no server. Playwright is the runner because it is the
 * runner this app has.
 */

const ROOT = process.cwd();
const url = (rel) => 'file://' + path.join(ROOT, rel);

let corpus;
let score;
let gateLib;
let gate;

test.beforeAll(async () => {
  corpus = await import(url('scripts/fixtures/phi-census-corpus.mjs'));
  score = await import(url('scripts/lib/phi-census-score.mjs'));
  gateLib = await import(url('scripts/lib/gate-context.mjs'));
  gate = gateLib.loadGateFromFile(path.join(ROOT, 'assets/notes-gate.js'), 'working tree');
});

const wordIn = (needle, hay) =>
  new RegExp(`(^|[^A-Za-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`, 'i').test(hay);

test.describe('the corpus is a truth rather than a transcript', () => {
  test('every name the corpus claims is really in its text', () => {
    const wrong = [];
    for (const doc of corpus.CORPUS) {
      for (const name of doc.names) if (!wordIn(name, doc.text)) wrong.push(`${doc.id}: ${name}`);
      for (const key of Object.keys(doc.roles || {})) if (!wordIn(key, doc.text)) wrong.push(`${doc.id}: role ${key}`);
    }
    expect(wrong, 'truth names that are not in the doc they belong to').toEqual([]);
  });

  test('every identifier the corpus claims is in its text verbatim', () => {
    const wrong = [];
    for (const doc of corpus.CORPUS) {
      for (const id of doc.identifiers || []) {
        if (!doc.text.includes(id.text)) wrong.push(`${doc.id}: ${id.text}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test('no doc carries a word that looks like a real record number or a real address', () => {
    /* The corpus is synthetic on purpose and has to stay that way. Anything a
       future hand adds gets checked against the same two shapes the objective
       bans from a fixture: a nine digit run and a real looking SSN. */
    const wrong = [];
    for (const doc of corpus.CORPUS) {
      if (/\b\d{3}-\d{2}-\d{4}\b/.test(doc.text)) wrong.push(`${doc.id}: SSN shape`);
      if (/\b\d{9,}\b/.test(doc.text.replace(/\b\d{7}\b/g, ''))) wrong.push(`${doc.id}: long digit run`);
    }
    expect(wrong).toEqual([]);
  });

  test('every doc declares the fields the census reads', () => {
    for (const doc of corpus.CORPUS) {
      expect(doc.id, 'doc id').toBeTruthy();
      expect(['bt', 'bcba']).toContain(doc.author);
      expect(Array.isArray(doc.names), `${doc.id}.names`).toBe(true);
      expect(Array.isArray(doc.identifiers), `${doc.id}.identifiers`).toBe(true);
      expect(Array.isArray(doc.personGroups), `${doc.id}.personGroups`).toBe(true);
    }
  });
});

test.describe('the scorer, pinned against arithmetic done by hand', () => {
  const doc = {
    id: 'hand-01',
    text: 'Client Jacob sorted the Blue card. mom reports a hard morning. kaelen waited.',
    names: ['Jacob', 'kaelen'],
    identifiers: [],
    traps: { blue: 'colour-or-material-word' },
    personGroups: [],
  };

  test('precision and recall are the fractions written out here', () => {
    // Predicted four, of which two are the truth. Truth is two, of which one
    // was found. So precision is 2/4 and recall is 1/2 exactly.
    const r = score.scoreSet({
      predicted: ['Jacob', 'Blue', 'reports', 'Sarah'],
      truth: doc.names,
      doc,
      ctx: { isFirstName: () => false },
    });
    expect(r.tp).toBe(1);
    expect(r.fp).toBe(3);
    expect(r.fn).toBe(1);
    expect(r.precision).toBeCloseTo(1 / 4, 10);
    expect(r.recall).toBeCloseTo(1 / 2, 10);
  });

  test('an ambiguous word scores as neither a hit nor a miss', () => {
    const amb = { ...doc, ambiguous: ['blue'] };
    const r = score.scoreSet({ predicted: ['Blue'], truth: [], doc: amb, ctx: {} });
    expect(r.tp + r.fp + r.fn).toBe(0);
    expect(r.precision).toBeNull();
  });

  test('an identifier with the right span and the wrong type is not a hit', () => {
    const r = score.scoreIdentifiers(
      [{ text: 'GA 30303', type: 'ID' }],
      [{ text: 'GA 30303', type: 'ZIP' }],
    );
    expect(r.tp).toBe(0);
    expect(r.typeErrors).toEqual([{ text: 'ga 30303', got: 'ID', want: 'ZIP' }]);
  });

  test('a name split across two role tokens is counted as one human, not two', () => {
    const d = { personGroups: [['Barbara Jean', 'Barbara', 'Jean']] };
    const map = [
      { name: 'Barbara', token: 'Caregiver' },
      { name: 'Jean', token: 'Person 2' },
    ];
    const r = score.scoreTokenFragmentation(map, d);
    expect(r.people).toBe(1);
    expect(r.split).toHaveLength(1);
    expect(r.split[0].tokens.sort()).toEqual(['Caregiver', 'Person 2']);
  });
});

test.describe('every class of mistake has a rule that names it', () => {
  const doc = {
    text:
      'mom reports a hard morning.\n'
      + 'Client sorted the Blue card at 1420 Maple Street.\n'
      + 'kaelen waited by the door.\n'
      + 'Caregiver Barbara Jean signed the form.',
    identifiers: [{ text: '1420 Maple Street', type: 'ADDRESS' }],
    traps: { blue: 'colour-or-material-word', georgia: 'place-name-overlapping-span' },
    names: ['Barbara Jean', 'Barbara', 'Jean', 'kaelen'],
  };
  const ctx = { isFirstName: (w) => w === 'grace', isNicknamePrefixOf: (w) => w === 'delay' };

  const cases = [
    ['reports', 'verb-after-role-cue'],
    ['Maple', 'place-name-overlapping-span'],
    ['Blue', 'colour-or-material-word'],
    ['grace', 'dictionary-collision-with-clinical-vocabulary'],
    ['delay', 'nickname-prefix-pass'],
  ];
  for (const [term, want] of cases) {
    test(`a false positive on "${term}" is classed ${want}`, () => {
      expect(score.classifyFalsePositive(term, doc, ctx)).toBe(want);
    });
  }

  test('a lower case name with nothing in front of it is classed as its own miss', () => {
    expect(score.classifyMiss('kaelen', doc, ctx)).toBe('lowercase-real-name-no-cue');
  });

  test('a two word name behind a cue is classed as the cue splitting it', () => {
    expect(score.classifyMiss('Barbara Jean', doc, ctx)).toBe('cue-word-splits-a-two-word-name');
  });
});

test.describe('the census over the real passes in this working tree', () => {
  /* Same four functions the browser calls, loaded out of assets/notes-gate.js.
     A census built on a copy of the regexes would measure the copy. */

  test('the lowercase guard is still in detectNames', () => {
    // Remove `if (!/^[A-Z]/.test(cname)) continue;` from detectNames and this
    // fails: "reports" comes back as a person because the cue matched either
    // case and SIMPLE_CAP's [A-Z] stopped meaning anything under the i flag.
    const names = gate.detectNames('Mom reports the morning went badly, and dad described the evening as rough.');
    expect(names.map((n) => n.toLowerCase())).not.toContain('reports');
    expect(names.map((n) => n.toLowerCase())).not.toContain('described');
  });

  test('the lowercase guard is still in inferRoles', () => {
    // Remove `if (!/^[A-Z]/.test(m[2])) continue;` from inferRoles and this
    // fails: the verb is filed as a Caregiver, and a role token never restores.
    const roles = gate.inferRoles('Mom reports the morning went badly.');
    expect(Object.keys(roles)).not.toContain('reports');
  });

  test('no word in the corpus gets a role token it can never give back', () => {
    // A Person token restores. Client, Caregiver, Technician, Teacher, Sibling
    // and Peer do not, so one landing on a word that is not a person stays in
    // the signed note wearing a role.
    const offenders = [];
    for (const doc of corpus.CORPUS) {
      const truth = new Set(doc.names.map((n) => n.toLowerCase()));
      const amb = new Set((doc.ambiguous || []).map((n) => n.toLowerCase()));
      for (const e of gate.buildRoleMap(doc.text)) {
        const n = e.name.toLowerCase();
        if (truth.has(n) || amb.has(n)) continue;
        if (!/^Person( \d+)?$/.test(e.token)) offenders.push(`${doc.id}: ${e.name} -> ${e.token}`);
      }
    }
    expect(offenders, 'non-person words wearing a role token that never restores').toEqual([]);
  });

  test('every mistake the corpus produces lands in a named class', () => {
    // The slice is done when every miss is classed. An unclassified mistake is
    // one a later slice cannot decide whether to pay for.
    const unclassified = [];
    for (const doc of corpus.CORPUS) {
      const predicted = gate.detectNames(doc.text);
      const ctx = {
        isFirstName: gate.isFirstName,
        isNicknamePrefixOf: (term) => predicted.some((n) => {
          const l = n.toLowerCase();
          return l !== term && term.length >= 3 && l.startsWith(term);
        }),
      };
      const r = score.scoreSet({ predicted, truth: doc.names, doc, ctx });
      [...r.falsePositives, ...r.misses].forEach((m) => {
        if (m.class === 'unclassified') unclassified.push(`${doc.id}: ${m.term}`);
      });
    }
    expect(unclassified).toEqual([]);
  });

  test('identifiers keep full recall on the corpus', () => {
    // Recall is the number that matters on this pass: an identifier the
    // scrubber does not take is PHI leaving the device. Precision is allowed to
    // be imperfect and the report prints what it costs.
    const missed = [];
    for (const doc of corpus.CORPUS) {
      const got = gate.detectIdentifiers(doc.text).map((h) => `${h.text.toLowerCase()}::${h.type}`);
      for (const want of doc.identifiers || []) {
        if (!got.includes(`${want.text.toLowerCase()}::${want.type}`)) missed.push(`${doc.id}: ${want.text} (${want.type})`);
      }
    }
    expect(missed).toEqual([]);
  });
});
