import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roleswap } from './helpers/load-roleswap.mjs';

const {
  swap, swapRoles, applySpans, checkBeforeCopy, standingRows, customRow, setLooksFor, setValue, setKin,
  isActive, activeRows, activeStrip, wordsOf, cleanValue, checkValue, scrubForms, findScrubs, possessiveOf, fnv1a,
  EVENT_NOUNS_USE_NORMAL_RATE, DEFAULT_RATES,
} = roleswap();

// His copy-out role swap, admin mode only. The engine is a pure module: text and
// rows in, text and spans with reason codes out. Everything here runs without a
// vault, a document or a DOM, which is also what makes the module portable.

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/roleswap/golden.json', import.meta.url), 'utf8'));

function rowsWith(values, { kinOn = false } = {}) {
  const rows = standingRows().map((r) => ({ ...r, value: values[r.id] ?? '' }));
  return kinOn ? rows.map((r) => setKin(r, true)) : rows;
}
const VALUES = GOLDEN.values;
const rows = () => rowsWith(VALUES);
const run = (text, options = {}) => swapRoles(text, { rows: rows(), ...options });

for (const c of GOLDEN.cases) {
  test(`golden: ${c.name}`, () => {
    const out = swapRoles(c.input, {
      rows: rowsWith({ ...VALUES, ...(c.values || {}) }, { kinOn: c.kinOn }),
      everything: c.everything,
    });
    assert.equal(out.text, c.expected);
    assert.deepEqual(out.spans.map((s) => s.reason), c.reasons);
  });
}

// ----------------------------------------------------------------- the rows

test('a blank row swaps nothing, and the strip names only the rows that swap', () => {
  const r = rowsWith({ client: 'Jaden', bt: '  ' });
  assert.deepEqual(activeRows(r).map((x) => x.id), ['client']);
  assert.equal(activeStrip(r), 'Active: Jaden');
  assert.equal(activeStrip(rowsWith({})), null);
  assert.equal(activeStrip(rows()), 'Active: Jaden / Ben / Brooke / Janet / Casey');
});

test('the caregiver row matches kin words only with its toggle', () => {
  const [client, bt, bcba, caregiver] = standingRows();
  assert.deepEqual(wordsOf(caregiver), ['caregiver', 'parent', 'guardian']);
  assert.deepEqual(wordsOf(setKin(caregiver, true)), ['caregiver', 'parent', 'guardian', 'mom', 'mother', 'dad', 'father']);
  assert.equal(setKin(client, true).kinOn, undefined);
  assert.ok(bt && bcba);
});

test('replace-with mirrors looks-for until it is edited, then stops following', () => {
  let row = customRow('clinician', 1);
  assert.equal(row.value, 'doctor');
  row = setLooksFor(row, 'doctor, SLP');
  assert.equal(row.value, 'doctor, SLP');
  row = setValue(row, 'Dr. Mehta');
  row = setLooksFor(row, 'doctor, SLP, OT');
  assert.equal(row.value, 'Dr. Mehta');
  assert.equal(row.valueEdited, true);
  assert.equal(isActive(row), true);
});

test('a custom row that still mirrors its looks-for swaps nothing', () => {
  assert.equal(isActive(customRow('clinician', 1)), false);
  const out = swapRoles('The doctor called', { rows: [customRow('clinician', 1)] });
  assert.equal(out.text, 'The doctor called');
});

test('a custom row swaps its words: doctor, SLP, uncle', () => {
  const row = setValue(setLooksFor(customRow('other', 2), 'doctor, SLP'), 'Dr. Mehta');
  const out = swapRoles('The doctor wrote and the SLP agreed', { rows: [row] });
  assert.equal(out.text, 'Dr. Mehta wrote and Dr. Mehta agreed');
  const uncle = setValue(setLooksFor(customRow('relative', 3), 'uncle'), 'Tomas');
  assert.equal(swapRoles('The uncle arrived', { rows: [uncle] }).text, 'Tomas arrived');
});

// ------------------------------------------------------------------ names

test('possessives: a singular ending in s takes an apostrophe s, a plural only the apostrophe', () => {
  assert.equal(possessiveOf('Hayes'), "Hayes's");
  assert.equal(possessiveOf('Hayes', { plural: true }), "Hayes'");
  assert.equal(possessiveOf('Jaden'), "Jaden's");
  assert.equal(possessiveOf('Jaden', { plural: true }), "Jaden's");
  assert.equal(possessiveOf('Hayes', { mark: '’' }), 'Hayes’s');
});

test('a curly apostrophe in the draft stays curly in the copy', () => {
  assert.equal(run('The client’s mother left').text, 'Jaden’s mother left');
});

test('the value is typed once and used as typed', () => {
  assert.equal(cleanValue('  Jaden   Parker '), 'Jaden Parker');
  assert.equal(cleanValue('   '), null);
  assert.equal(swapRoles('The client waved', { rows: rowsWith({ client: ' Jaden Parker ' }) }).text, 'Jaden Parker waved');
});

// ------------------------------------------------------- leaving some behind

function longNote(paragraphs = 8, perPara = 6) {
  const body = [];
  for (let p = 0; p < paragraphs; p += 1) {
    const lines = [];
    for (let k = 0; k < perPara; k += 1) lines.push(`The client waited at step ${p}.${k}.`);
    body.push(lines.join(' '));
  }
  return body.join('\n\n');
}

test('the same text gives byte-identical output, twice', () => {
  const note = longNote();
  assert.equal(run(note).text, run(note).text);
  assert.deepEqual(run(note).spans, run(note).spans);
});

test('editing paragraph 3 leaves every other paragraph unchanged', () => {
  const paras = longNote().split('\n\n');
  const edited = [...paras];
  edited[2] = `${paras[2]} The client also stayed for snack.`;
  const before = run(paras.join('\n\n')).text.split('\n\n');
  const after = run(edited.join('\n\n')).text.split('\n\n');
  assert.equal(after.length, before.length);
  for (const i of [0, 1, 3, 4, 5, 6, 7]) assert.equal(after[i], before[i], `paragraph ${i + 1} moved`);
});

test('the first eligible mention in every paragraph is swapped', () => {
  const out = run(longNote());
  const firsts = new Map();
  for (const s of out.spans) if (!firsts.has(s.paragraph)) firsts.set(s.paragraph, s);
  assert.equal(firsts.size, 8);
  for (const s of firsts.values()) assert.equal(s.swapped, true);
});

test('some are left behind, never two in a row, at most one in three per paragraph', () => {
  const out = run(longNote(12, 7));
  const left = out.spans.filter((s) => s.reason === 'density');
  assert.ok(left.length > 0, 'a long note leaves a few generic');
  const byPara = new Map();
  for (const s of out.spans) byPara.set(s.paragraph, [...(byPara.get(s.paragraph) || []), s]);
  for (const list of byPara.values()) {
    assert.ok(list.filter((s) => s.reason === 'density').length <= Math.floor(list.length / 3));
    for (let i = 1; i < list.length; i += 1) {
      assert.ok(!(list[i].reason === 'density' && list[i - 1].reason === 'density'), 'two left in a row');
    }
  }
});

test('a role with fewer than four eligible mentions in the note leaves none behind', () => {
  const out = run('The client waited. The client sat.\n\nThe client left.');
  assert.deepEqual(out.spans.map((s) => s.reason), ['swapped', 'swapped', 'swapped']);
});

test('swap everything leaves nothing behind, and turns the rates into swaps', () => {
  const note = longNote(12, 7);
  assert.equal(run(note, { everything: true }).spans.filter((s) => s.reason === 'density').length, 0);
  const plan = run("The client's plan was read", { everything: true });
  assert.equal(plan.text, "Jaden's plan was read");
});

test('a seed changes which are left, and the same seed gives the same ones', () => {
  const note = longNote(12, 7);
  const a = run(note, { seed: 1 }).text;
  assert.equal(run(note, { seed: 1 }).text, a);
  assert.notEqual(run(note, { seed: 2 }).text, a);
});

test('a per-role rate of zero leaves none, and the rate is read per role', () => {
  const note = longNote(12, 7);
  const none = run(note, { rates: { client: { leave: 0 } } });
  assert.equal(none.spans.filter((s) => s.reason === 'density').length, 0);
  assert.equal(DEFAULT_RATES.bare, 0.15);
  assert.equal(DEFAULT_RATES.modified, 0.6);
});

test('never a generic mention beside a swapped one of the same role in one sentence', () => {
  const lines = [];
  for (let p = 0; p < 14; p += 1) {
    const para = [];
    for (let k = 0; k < 6; k += 1) para.push(`The client smiled and the client waved at ${p}.${k}.`);
    lines.push(para.join(' '));
  }
  const out = run(lines.join('\n\n'));
  const bySentence = new Map();
  for (const s of out.spans) bySentence.set(s.sentence, [...(bySentence.get(s.sentence) || []), s]);
  for (const list of bySentence.values()) {
    const mixed = list.some((s) => s.reason === 'density') && list.some((s) => s.swapped);
    assert.equal(mixed, false);
  }
});

test('a list is all or nothing even when the hash would leave one', () => {
  const lines = [];
  for (let p = 0; p < 14; p += 1) {
    const para = [];
    for (let k = 0; k < 6; k += 1) para.push(`Present ${p}.${k}: client, BT, parent.`);
    lines.push(para.join(' '));
  }
  const out = run(lines.join('\n\n'));
  const byList = new Map();
  for (const s of out.spans) byList.set(s.sentence, [...(byList.get(s.sentence) || []), s]);
  for (const list of byList.values()) assert.equal(new Set(list.map((s) => s.swapped)).size, 1);
});

// --------------------------------------------------------- possessive rates

function share(make, count = 400) {
  let swapped = 0;
  for (let i = 0; i < count; i += 1) if (run(make(i)).spans[0].swapped) swapped += 1;
  return swapped / count;
}

test("the client's [noun] about 15 percent, the client's [adjective noun] about 60", () => {
  const bare = share((i) => `Item ${i}: the client's plan was reviewed.`);
  assert.ok(bare > 0.07 && bare < 0.25, `bare ${bare}`);
  const modified = share((i) => `Item ${i}: the client's treatment plan was reviewed.`);
  assert.ok(modified > 0.5 && modified < 0.7, `modified ${modified}`);
});

test('events and states swap at the normal rate while the constant says so', () => {
  assert.equal(EVENT_NOUNS_USE_NORMAL_RATE, true);
  assert.equal(share((i) => `Item ${i}: the client's tantrum ended.`), 1);
  assert.equal(share((i) => `Item ${i}: the client's mood improved.`), 1);
});

test('the rates are the same for every role', () => {
  const bt = share((i) => `Item ${i}: the BT's plan was reviewed.`);
  assert.ok(bt > 0.07 && bt < 0.25, `bt ${bt}`);
  assert.equal(run("The parent's mother called").spans[0].reason, 'swapped');
});

// -------------------------------------------------------------- the spans

test('every span carries a reason from the closed list and what it would become', () => {
  const REASONS = new Set(['swapped', 'plural', 'indefinite', 'other-person', 'label', 'hyphen', 'quote',
    'title', 'already-named', 'modifier', 'density', 'unsure']);
  const out = run('Parent asked if clients are staffed. School BT arrived. Client tantrum lasted 4 minutes. Client zorbles.');
  for (const s of out.spans) {
    assert.ok(REASONS.has(s.reason), s.reason);
    assert.equal(typeof s.replacement, 'string');
    assert.ok(s.replacement.length > 0);
    assert.equal(s.swapped, s.reason === 'swapped');
  }
});

test('flipping a span turns a kept one on and a swapped one off', () => {
  const out = run('The client ate. School BT arrived.');
  const [first, second] = out.spans;
  assert.equal(applySpans('The client ate. School BT arrived.', out.spans, new Set([first.id])), 'The client ate. School BT arrived.');
  assert.equal(applySpans('The client ate. School BT arrived.', out.spans, new Set([second.id])), 'Jaden ate. School Ben arrived.');
});

test('swap() takes one object and gives the same answer as swapRoles', () => {
  const a = swap({ text: 'The client ate.', config: { rows: rows() } });
  assert.deepEqual(a, run('The client ate.'));
});

test('the original text is never mutated and spans are plain data', () => {
  const text = 'The client ate.';
  const out = run(text);
  assert.equal(text, 'The client ate.');
  assert.deepEqual(JSON.parse(JSON.stringify(out.spans)), out.spans);
});

test('input that is not text is read as empty rather than thrown on', () => {
  assert.equal(swapRoles(undefined, { rows: rows() }).text, '');
  assert.equal(swapRoles('The client ate.', {}).text, 'The client ate.');
  assert.equal(swapRoles('The client ate.', { rows: null }).text, 'The client ate.');
});

// -------------------------------------------------------------- the checks

test('block: a typed name twice in one sentence, and a flip resolves it', () => {
  const text = 'The client told the client to wait.';
  const out = run(text);
  const check = checkBeforeCopy(text, out, rows());
  assert.equal(check.ok, false);
  assert.equal(check.block[0].name, 'Jaden');
  const resolved = checkBeforeCopy(text, out, rows(), { flips: new Set([out.spans[1].id]) });
  assert.equal(resolved.ok, true);
});

test('a name once per sentence is not blocked', () => {
  const text = 'The client waited. The client left.';
  assert.equal(checkBeforeCopy(text, run(text), rows()).ok, true);
});

test('warn: a value is empty but its role word appears', () => {
  const r = rowsWith({ client: 'Jaden', bt: '' });
  const text = 'The BT arrived and the client waved. BT left.';
  const check = checkBeforeCopy(text, swapRoles(text, { rows: r }), r);
  assert.equal(check.ok, true);
  assert.deepEqual(check.warn.map((w) => [w.role, w.count]), [['bt', 2]]);
  assert.deepEqual(checkBeforeCopy('The client waved.', swapRoles('The client waved.', { rows: r }), r).warn, []);
});

// ------------------------------------------------------------ typed values

test('a short or ordinary-word value warns and is still allowed', () => {
  assert.equal(checkValue('Will').ok, true);
  assert.match(checkValue('Will').warn, /ordinary word/);
  assert.match(checkValue('Al').warn, /Short/);
  assert.equal(checkValue('Jaden').warn, null);
  assert.equal(checkValue('').blank, true);
  assert.equal(checkValue('a[[C-1234]]b').ok, false);
  assert.equal(checkValue('x'.repeat(200)).ok, false);
});

test('scrub forms: first name, last name, initials, and the whole', () => {
  assert.deepEqual(scrubForms('Jaden Parker'), ['Jaden Parker', 'Parker', 'Jaden', 'J. P.', 'J.P.', 'JP']);
  assert.deepEqual(scrubForms('Jaden'), ['Jaden']);
  assert.deepEqual(scrubForms(' '), []);
});

test('scrub matching is whole word and case sensitive, with the possessive outside the mask', () => {
  const found = findScrubs("Will will go. Jaden's turn. Jadens left. JAden", scrubForms('Will'));
  assert.deepEqual(found.map((f) => f.surface), ['Will']);
  const j = findScrubs("Jaden's turn. Jadens left. Parker, Jaden Parker.", scrubForms('Jaden Parker'));
  assert.deepEqual(j.map((f) => f.surface), ['Jaden', 'Parker', 'Jaden Parker']);
});

test('fnv1a is the published 32 bit FNV-1a', () => {
  assert.equal(fnv1a(''), 0x811c9dc5);
  assert.equal(fnv1a('a'), 0xe40c292c);
  assert.equal(fnv1a('foobar'), 0xbf9cf968);
});
