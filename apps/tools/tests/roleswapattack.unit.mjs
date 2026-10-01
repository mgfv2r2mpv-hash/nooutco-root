import test from 'node:test';
import assert from 'node:assert/strict';
import { roleswap } from './helpers/load-roleswap.mjs';

const { swapRoles, standingRows, setKin, checkBeforeCopy, scrubForms } = roleswap();

// The attack round on the copy-out role swap: sentences written to break it, each
// one a hole that was found by running it, a failing line here first, then the
// fix. Rulings are his; a case that needs a ruling is not here, it is in the
// report as a judgment call.

const VALUES = { client: 'Jaden', bt: 'Ben', bcba: 'Brooke', caregiver: 'Janet', bcaba: 'Casey' };
function rowsOf(values = VALUES, { kin = false } = {}) {
  const rows = standingRows().map((r) => ({ ...r, value: values[r.id] ?? '' }));
  return kin ? rows.map((r) => setKin(r, true)) : rows;
}
const run = (text, options = {}) => swapRoles(text, { rows: rowsOf(options.values, options), ...options });
const textOf = (text, options) => run(text, options).text;
function table(name, cases, options) {
  for (const [input, expected] of cases) {
    test(`${name}: ${JSON.stringify(input)}`, () => assert.equal(textOf(input, options), expected));
  }
}

// ------------------------------------------------------------ already named

table('an intro word before a comma is not a name', [
  ['Unfortunately, the client refused.', 'Unfortunately, Jaden refused.'],
  ['Honestly, the BT was late.', 'Honestly, Ben was late.'],
  ['Yes, the client agreed.', 'Yes, Jaden agreed.'],
  ['Okay, parent agreed.', 'Okay, Janet agreed.'],
  ['Therefore, the BCBA will call.', 'Therefore, Brooke will call.'],
  ['Client, BT and BCBA were present.', 'Jaden, Ben and Brooke were present.'],
]);

table('a name beside the role still keeps the role generic', [
  ['Brooke, BCBA, said hi.', 'Brooke, BCBA, said hi.'],
  ['Spoke with Smith, the BCBA, today.', 'Spoke with Smith, the BCBA, today.'],
  ['BCBA (Brooke) said hi.', 'BCBA (Brooke) said hi.'],
]);

table('a role word after the role word is not a name', [
  ["The client's BT arrived.", "Jaden's BT arrived."],
  ["Sessions with the client's BCBA.", "Sessions with Jaden's BCBA."],
]);

// ------------------------------------------------------- verbs after a role

table('an irregular past after a role is a verb', [
  ['Client became upset.', 'Jaden became upset.'],
  ['Parent drove the child home.', 'Janet drove the child home.'],
  ['The BT broke the tie.', 'Ben broke the tie.'],
  ['Learner spent ten minutes at the table.', 'Jaden spent ten minutes at the table.'],
]);

table('a role after a fronted auxiliary is the subject of a question', [
  ['Is the client ok?', 'Is Jaden ok?'],
  ['Was client present?', 'Was Jaden present?'],
  ['Did BT arrive?', 'Did Ben arrive?'],
  ['Why was the client upset?', 'Why was Jaden upset?'],
]);

table('a role before a participle with an object or a preposition is the subject', [
  ['Client engaging in play.', 'Jaden engaging in play.'],
  ['BT implementing the plan.', 'Ben implementing the plan.'],
  ['BCBA observing BT.', 'Brooke observing Ben.'],
]);

table('the same positions with a noun after the role stay generic', [
  ['Was client behavior reviewed?', 'Was client behavior reviewed?'],
  ['Did parent training start?', 'Did parent training start?'],
  ['Client reading level improved.', 'Client reading level improved.'],
]);

// -------------------------------------------------------------- possessives

const NEVER_BARE = { rates: { client: { bare: 0, modified: 0 }, caregiver: { bare: 0, modified: 0 } } };
table('a gerund or a state after a possessive is an event of the person, at the normal rate', [
  ["The client's walking improved.", "Jaden's walking improved."],
  ["The learner's hitting decreased.", "Jaden's hitting decreased."],
  ["The client's tolerance improved.", "Jaden's tolerance improved."],
  ["Client's walking and running improved.", "Jaden's walking and running improved."],
], NEVER_BARE);

table('a document or a service after a possessive still uses the rates', [
  ["The client's plan was updated.", "The client's plan was updated."],
  ["The client's training continued.", "The client's training continued."],
  ["The client's programming changed.", "The client's programming changed."],
], NEVER_BARE);

table('every apostrophe is a possessive, in any case', [
  ['The CLIENT\'S mother arrived.', "Jaden's mother arrived."],
  ['The client`s mother arrived.', 'Jaden`s mother arrived.'],
  ['The clientʼs mother arrived.', 'Jadenʼs mother arrived.'],
  ['The client´s mother arrived.', 'Jaden´s mother arrived.'],
  ["The BT’s notes arrived.", "Ben’s notes arrived."],
], NEVER_BARE);

// ------------------------------------------------- phrases around the role

table('a describing word before a role is part of the one person and goes with it', [
  ['Primary caregiver arrived.', 'Janet arrived.'],
  ['The primary caregiver signed.', 'Janet signed.'],
  ['Legal guardian signed.', 'Janet signed.'],
  ['Spoke with the biological parent.', 'Spoke with Janet.'],
  ['The assigned BT arrived.', 'Ben arrived.'],
  ['The current BCBA arrived.', 'Brooke arrived.'],
]);

table('a single parent is a kind of household, not the typed one', [
  ['Single parent household.', 'Single parent household.'],
  ['Single parent', 'Single parent'],
]);

table('(s) is a plural that might be one', [
  ['Parent(s) agreed.', 'Parent(s) agreed.'],
  ['Parent(s)/guardian(s) agreed.', 'Parent(s)/guardian(s) agreed.'],
]);

table('an ordinal or a number points at one of several', [
  ['The 3rd client arrived.', 'The 3rd client arrived.'],
  ['The second parent arrived.', 'The second parent arrived.'],
]);

table('an en dash between two words is a compound, like a hyphen', [
  ['Parent\u2013teacher meeting.', 'Parent\u2013teacher meeting.'],
  ['BT\u2013client ratio.', 'BT\u2013client ratio.'],
]);

table('a line break in the middle of a phrase is a space', [
  ['The client\nbehavior was noted.', 'The client\nbehavior was noted.'],
  ['Parent\ntraining was scheduled.', 'Parent\ntraining was scheduled.'],
  ['Client\nengaged in play.', 'Jaden\nengaged in play.'],
  ['Present:\nclient\nparent', 'Present:\nJaden\nJanet'],
]);

table('the other half of a pair with somebody else\'s mother is somebody else\'s too', [
  ["The client's mother and father arrived.", "Jaden's mother and father arrived."],
  ["The client's mom/dad arrived.", "Jaden's mom/dad arrived."],
], { kin: true });

test('a list of roles is all swapped or all generic, whatever each role would have done', () => {
  const text = 'Client arrived. Client played. Client ate with the client. Client left.\n\n'
    + 'The client slept. Present: client, BT, parent. Client woke.';
  for (let seed = 1; seed <= 60; seed += 1) {
    const list = run(text, { seed }).text.split('Present: ')[1].split('.')[0];
    assert.match(list, /^(Jaden, Ben, Janet|client, BT, parent)$/, `seed ${seed}: ${list}`);
  }
});

// ------------------------------------------------------- small words, small marks

table('"notes:" after a role is a label, "notes that" is a verb', [
  ['BT notes: client engaged.', 'BT notes: Jaden engaged.'],
  ['Parent reports: sleep was fine.', 'Parent reports: sleep was fine.'],
  ['BT notes that client was calm.', 'Ben notes that Jaden was calm.'],
]);

table('what follows a possessive is the possessed thing, never a name', [
  ["Client's Teacher said hi.", "Jaden's Teacher said hi."],
  ["Client's Dog barked.", "Jaden's Dog barked."],
  ["Client's 3 brothers visited.", "Jaden's 3 brothers visited."],
  ["Client's nurse called.", "Jaden's nurse called."],
  ["The client's step-mother visited.", "Jaden's step-mother visited."],
], NEVER_BARE);

table('a contraction after a role is an auxiliary', [
  ["The client wasn't present.", "Jaden wasn't present."],
  ["Parent didn't sign.", "Janet didn't sign."],
  ["BT can’t attend.", "Ben can’t attend."],
  ["Client'll attend.", "Jaden'll attend."],
]);

// ------------------------------------------------------ typed values, as scrubs

test('a title or a particle in a typed name is never a scrub of its own', () => {
  assert.deepEqual(scrubForms('Dr. Mehta'), ['Dr. Mehta', 'Mehta']);
  assert.deepEqual(scrubForms('Mr. Hayes'), ['Mr. Hayes', 'Hayes']);
  const forms = scrubForms('Maria de la Cruz');
  for (const bad of ['de', 'la', 'dlC', 'd.l.C.']) assert.ok(!forms.includes(bad), bad);
  for (const good of ['Maria de la Cruz', 'Maria', 'Cruz', 'MC', 'M.C.']) assert.ok(forms.includes(good), good);
});

test('the words of a name that are only a letter or a suffix stay out of the scrubs', () => {
  const forms = scrubForms('Mary J. Smith Jr.');
  for (const bad of ['J.', 'J', 'Jr.']) assert.ok(!forms.includes(bad), bad);
  for (const good of ['Mary', 'Smith', 'MJS', 'M.J.S.']) assert.ok(forms.includes(good), good);
});

test('a one-word name and a plain two-word name scrub as they did', () => {
  assert.deepEqual(scrubForms('Jaden'), ['Jaden']);
  assert.deepEqual(scrubForms('Jaden Parker'), ['Jaden Parker', 'Parker', 'Jaden', 'J. P.', 'J.P.', 'JP']);
});

// ------------------------------------------------------------- line endings

table('a Windows line ending is a line ending', [
  ['The client\r\nbehavior was noted.', 'The client\r\nbehavior was noted.'],
  ['Client\r\nengaged in play.', 'Jaden\r\nengaged in play.'],
  ['Present:\r\nclient\r\nparent', 'Present:\r\nJaden\r\nJanet'],
]);

// ------------------------------------------------------------- "that" clauses

table('a base verb after "that role" is the mandative, so the role is its subject', [
  ['BCBA recommended that parent attend training.', 'Brooke recommended that Janet attend training.'],
  ['Requested that BT complete the form.', 'Requested that Ben complete the form.'],
  ['Asked that the caregiver sign the consent.', 'Asked that Janet sign the consent.'],
]);

table('a noun after "that role" still keeps the role generic', [
  ['Noted that parent request was denied.', 'Noted that parent request was denied.'],
  ['Noted that client work samples were filed.', 'Noted that client work samples were filed.'],
]);

// ------------------------------------------------------------------ guards
// These passed when the attack round found them, and stay to keep them passing.

function paragraph(count, openers) {
  const tails = ['asked for a break.', 'played with the toy.', 'left the room.', 'was calm.'];
  return Array.from({ length: count }, (_, i) => `${openers[i % openers.length]} ${tails[i % tails.length]}`).join(' ');
}

test('density: first swapped, never two left in a row, at most a third, in every paragraph, for 200 seeds', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const n = 4 + (seed % 30);
    const text = `${paragraph(n, ['Client', 'The client', 'The learner'])}\n\n${paragraph(n, ['The BT', 'RBT'])} ${paragraph(6, ['Parent'])}`;
    const byKey = new Map();
    for (const s of run(text, { seed }).spans) byKey.set(`${s.role}|${s.paragraph}`, [...(byKey.get(`${s.role}|${s.paragraph}`) || []), s]);
    for (const [key, list] of byKey) {
      assert.equal(list[0].swapped, true, `${seed} ${key}: first is swapped`);
      const left = list.filter((s) => !s.swapped);
      assert.ok(left.length <= Math.floor(list.length / 3), `${seed} ${key}: ${left.length} of ${list.length}`);
      list.forEach((s, i) => assert.ok(i === 0 || s.swapped || list[i - 1].swapped, `${seed} ${key}: two in a row at ${i}`));
    }
  }
});

test('density: a role with fewer than four mentions leaves none, and forty mentions in a paragraph keep the cap', () => {
  const few = run('Client asked. Client left. Client came. BT left.');
  assert.deepEqual(few.spans.map((s) => s.swapped), [true, true, true, true]);
  const forty = run(paragraph(40, ['The client']));
  assert.equal(forty.counts.swapped + forty.counts.kept, 40);
  assert.ok(forty.counts.kept <= 13);
});

test('same text and seed give the same bytes; another seed changes only which are left, never the reasons that are not density', () => {
  const text = `${paragraph(24, ['Client'])}\n\n${paragraph(12, ['The BT'])} The clients ran. A parent called.`;
  for (let seed = 1; seed <= 40; seed += 1) {
    const a = run(text, { seed });
    assert.equal(run(text, { seed }).text, a.text);
    const b = run(text, { seed: seed + 1000 });
    const shape = (r) => r.spans.map((s) => `${s.id}|${s.role}|${s.swapped || s.reason === 'density' ? 'eligible' : s.reason}`).join();
    assert.equal(shape(a), shape(b));
  }
});

test('running the swap on its own output, with everything on, changes nothing', () => {
  const lines = [
    "The client's mother said the client was tired.", 'Client hit BT and BT blocked.', 'Parent and guardian agreed.',
    'Present: client, BT, parent, BCBA.', 'The BCBA, Brooke, said hi.', 'Each client earned a token.',
    "Client's behavior plan was updated.", 'Unfortunately, the client refused.', 'The primary caregiver signed.',
    'Client (Jaden) and BT (Ben) met.', 'A parent and 3 clients arrived.',
  ];
  for (const line of lines) {
    const once = run(line, { everything: true }).text;
    assert.equal(run(once, { everything: true }).text, once, line);
  }
});

test('a name that ends in s, z or x takes \'s, and a curly apostrophe stays curly', () => {
  for (const name of ['Hayes', 'Cruz', 'Marx', 'José']) {
    assert.equal(textOf("The client's mother arrived.", { values: { ...VALUES, client: name } }), `${name}'s mother arrived.`);
    assert.equal(textOf('The client’s mother arrived.', { values: { ...VALUES, client: name } }), `${name}’s mother arrived.`);
  }
});

test('a blank row swaps nothing for its role and leaves every other role alone', () => {
  assert.equal(textOf('The BT asked client to go.', { values: { ...VALUES, client: '' } }), 'Ben asked client to go.');
  assert.equal(textOf('The BT asked client to go.', { values: {} }), 'The BT asked client to go.');
});

test('a value is inserted as typed, with no replacement pattern read into it', () => {
  assert.equal(textOf('The client arrived.', { values: { ...VALUES, client: "$& $1 $'" } }), "$& $1 $' arrived.");
});

test('a name typed twice in one sentence blocks the copy until a span is flipped', () => {
  const text = 'The client told the learner to go.';
  const result = run(text);
  assert.equal(checkBeforeCopy(text, result, rowsOf()).ok, false);
  assert.equal(checkBeforeCopy(text, result, rowsOf(), { flips: new Set([result.spans[1].id]) }).ok, true);
});

test('the kin toggle only adds mom, mother, dad and father, and "client\'s mom" stays the client\'s', () => {
  assert.equal(textOf('Mom said hi.', {}), 'Mom said hi.');
  assert.equal(textOf('Mom said hi.', { kin: true }), 'Janet said hi.');
  assert.equal(textOf("Client's mom said hi.", { kin: true }), "Jaden's mom said hi.");
});

// ------------------------------------------------------- addresses and names

table('a role word inside an address or an identifier is not a mention', [
  ['Email client@example.com for the form.', 'Email client@example.com for the form.'],
  ['Write to parent@example.com.', 'Write to parent@example.com.'],
  ['The field is client_name.', 'The field is client_name.'],
  ['_BT_ prompted the _client_.', '_Ben_ prompted the _Jaden_.'],
]);
