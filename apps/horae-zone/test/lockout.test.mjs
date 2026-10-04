// A5, the code-path lockout (plan §3.4 "Online wrong PINs" names the rule,
// §3.6 "/unlock/start, /unlock/finish ... pairing-limits.mjs lockout" and
// "/unlock/reopen"). The rules are the engine's limits.mjs, kept per account
// in D1: 3 wrong codes in one 30-second window lock that window and mail the
// account's address; 2 locked windows in a row, or 4 in a day, close the
// code path until the single-use link in the mail reopens it. The link's
// token rides in the fragment and is stored only as a hash. Reopening hands
// out no key and no ticket: the device still needs a right code.
//
// A refused start says only `locked`, never which rule, how many or how long.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WINDOW_MS, CONFIRM_MS, UNLOCK_TTL_MS, DAY_MS, parseState } from '../../../packages/account-engine/src/limits.mjs';
import {
  harness, post, auditRows, everyRow, enrolledDevice, confirmedDevice, registeredDevice, codeAt, wrongCodeAt, tryCode, startCode, reopenTokenFrom, REOPEN_BASE,
} from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses.
const ADDRESS = 'lock-owner@example.test';
const OTHER = 'someone-else@example.test';
const LOCKED = { status: 423, json: { error: 'locked' } };
const BAD_LINK = { status: 401, json: { error: 'bad-link' } };

async function answer(res) {
  return { status: res.status, json: await res.json() };
}

const lockMail = (h, email) => h.mail.filter((m) => m.to === email && !/sign-up/i.test(m.subject));

async function wrongTry(h, dev) {
  const tried = await tryCode(h, dev, await wrongCodeAt(dev, h.clock.ms));
  assert.deepEqual(tried.finish, { status: 401, json: { error: 'bad-code' } });
}

async function lockWindow(h, dev) {
  for (let i = 0; i < 3; i += 1) await wrongTry(h, dev);
}

async function rightTry(h, dev) {
  return tryCode(h, dev, await codeAt(dev, h.clock.ms));
}

function assertPlainNote(message, dev) {
  assert.equal(typeof message.subject, 'string');
  assert.ok(message.subject.length > 0);
  assert.equal(`${message.subject}${message.text}`.includes(String.fromCharCode(0x2014)), false, 'no em dash');
  assert.equal(message.text.includes(dev.secret), false, 'no seed');
  assert.doesNotMatch(message.text, /(?<![0-9])[0-9]{6}(?![0-9])/, 'no six-digit code');
}

// ---- the plan test ----

test('three wrong codes in one window lock it and email; two in a row or four a day close the path until the link', async () => {
  // Two in a row.
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  await wrongTry(h, dev);
  await wrongTry(h, dev);
  assert.deepEqual(lockMail(h, ADDRESS), [], 'two wrong codes mail nothing');
  await wrongTry(h, dev);
  const [windowLock] = lockMail(h, ADDRESS);
  assert.ok(windowLock, 'the third wrong code mails the address');
  assertPlainNote(windowLock, dev);
  assert.equal(windowLock.text.includes(REOPEN_BASE), false, 'a window lock carries no link');
  assert.deepEqual((await rightTry(h, dev)).start, LOCKED, 'the window is locked, even to a right code');
  h.clock.ms += WINDOW_MS;
  await lockWindow(h, dev);
  const mails = lockMail(h, ADDRESS);
  assert.equal(mails.length, 2);
  assertPlainNote(mails[1], dev);
  const token = reopenTokenFrom(h, ADDRESS);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, 'the link carries its token in the fragment');
  assert.ok(mails[1].text.includes(`${REOPEN_BASE}#${token}`));
  for (const later of [WINDOW_MS, 2 * 60 * 60 * 1000]) {
    h.clock.ms += later;
    assert.deepEqual((await rightTry(h, dev)).start, LOCKED, 'the path stays closed until the link');
  }
  assert.deepEqual(await answer(await h.call(post('/unlock/reopen', { token }))), { status: 200, json: { ok: true } });
  h.clock.ms += WINDOW_MS;
  assert.equal((await rightTry(h, dev)).finish.status, 200, 'the link reopened the path');

  // Four in a day, none of them in a row.
  const g = harness();
  const four = await enrolledDevice(g, OTHER);
  for (let i = 0; i < 3; i += 1) {
    await lockWindow(g, four);
    g.clock.ms += 2 * WINDOW_MS;
  }
  assert.equal(lockMail(g, OTHER).length, 3);
  assert.equal(reopenTokenFrom(g, OTHER), null, 'three locked windows apart do not close the path');
  await lockWindow(g, four);
  assert.equal(lockMail(g, OTHER).length, 4);
  assert.match(reopenTokenFrom(g, OTHER), /^[A-Za-z0-9_-]{43}$/);
  g.clock.ms += 2 * WINDOW_MS;
  assert.deepEqual((await rightTry(g, four)).start, LOCKED);
});

test('NEGATIVE CONTROL: two wrong codes and then a right one neither lock nor mail', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  await wrongTry(h, dev);
  await wrongTry(h, dev);
  assert.equal((await rightTry(h, dev)).finish.status, 200);
  assert.deepEqual(lockMail(h, ADDRESS), []);
});

test('an exchange left unfinished counts as a wrong code once its confirm time passes', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  for (let i = 0; i < 3; i += 1) assert.equal((await tryCode(h, dev, await wrongCodeAt(dev, h.clock.ms), { finish: false })).start.status, 200);
  assert.deepEqual((await rightTry(h, dev)).start, LOCKED, 'a fourth try waits while three are unsettled');
  assert.deepEqual(lockMail(h, ADDRESS), []);
  h.clock.ms += CONFIRM_MS;
  assert.deepEqual((await rightTry(h, dev)).start, LOCKED);
  assert.equal(lockMail(h, ADDRESS).length, 1, 'the three unfinished exchanges locked the window');
});

test('a closed path is per account: another account\'s code still works', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const other = await enrolledDevice(h, OTHER);
  await lockWindow(h, dev);
  h.clock.ms += WINDOW_MS;
  await lockWindow(h, dev);
  assert.deepEqual((await rightTry(h, dev)).start, LOCKED);
  assert.equal((await rightTry(h, other)).finish.status, 200);
  assert.deepEqual(lockMail(h, OTHER), []);
});

// ---- the reopen link ----

test('the reopen link is single use and hands out no key', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  await lockWindow(h, dev);
  h.clock.ms += WINDOW_MS;
  await lockWindow(h, dev);
  const token = reopenTokenFrom(h, ADDRESS);
  const res = await h.call(post('/unlock/reopen', { token }));
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(text), { ok: true }, 'the answer is exactly ok: no ticket, key or seed');
  assert.equal(text.includes(dev.secret), false);
  assert.deepEqual(await answer(await h.call(post('/unlock/reopen', { token }))), BAD_LINK, 'a second use is refused');
  const notes = lockMail(h, ADDRESS);
  assert.equal(notes.length, 3, 'the reopen is noted to the address');
  assertPlainNote(notes[2], dev);
  assert.equal(notes[2].text.includes(token), false);
  // The path is open, and the device still needs a right code.
  h.clock.ms += WINDOW_MS;
  const wrong = await tryCode(h, dev, await wrongCodeAt(dev, h.clock.ms));
  assert.equal(wrong.start.status, 200);
  assert.deepEqual(wrong.finish, { status: 401, json: { error: 'bad-code' } });
  assert.equal((await rightTry(h, dev)).finish.status, 200);
});

test('a reopen link expires, and the next refused try mails a fresh one', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  await lockWindow(h, dev);
  h.clock.ms += WINDOW_MS;
  await lockWindow(h, dev);
  const old = reopenTokenFrom(h, ADDRESS);
  h.clock.ms += UNLOCK_TTL_MS;
  assert.deepEqual(await answer(await h.call(post('/unlock/reopen', { token: old }))), BAD_LINK);
  assert.deepEqual((await rightTry(h, dev)).start, LOCKED);
  const fresh = reopenTokenFrom(h, ADDRESS);
  assert.notEqual(fresh, old);
  assertPlainNote(lockMail(h, ADDRESS).at(-1), dev);
  assert.deepEqual(await answer(await h.call(post('/unlock/reopen', { token: fresh }))), { status: 200, json: { ok: true } });
  assert.deepEqual(await answer(await h.call(post('/unlock/reopen', { token: old }))), BAD_LINK);
});

test('NEGATIVE CONTROL: a link used just inside its life reopens the path', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  await lockWindow(h, dev);
  h.clock.ms += WINDOW_MS;
  await lockWindow(h, dev);
  h.clock.ms += UNLOCK_TTL_MS - 1;
  assert.deepEqual(await answer(await h.call(post('/unlock/reopen', { token: reopenTokenFrom(h, ADDRESS) }))), { status: 200, json: { ok: true } });
});

test('a reopen body must be exactly one token, and an unknown token is refused like a spent one', async () => {
  const h = harness();
  for (const body of [{}, { token: 7 }, { token: 'short' }, { token: 'A'.repeat(43), also: 1 }]) {
    assert.deepEqual(await answer(await h.call(post('/unlock/reopen', body))), { status: 400, json: { error: 'shape' } }, JSON.stringify(body));
  }
  assert.deepEqual(await answer(await h.call(post('/unlock/reopen', { token: 'A'.repeat(43) }))), BAD_LINK);
});

// ---- state, mail and audit ----

test('the lock state is the engine\'s, and keeps only a hash of the link', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  await lockWindow(h, dev);
  h.clock.ms += WINDOW_MS;
  await lockWindow(h, dev);
  const token = reopenTokenFrom(h, ADDRESS);
  const [row] = h.db.sqlite.prepare('SELECT * FROM limits').all().map((r) => ({ ...r }));
  assert.equal(row.account_id, dev.account);
  const state = parseState(row.state);
  assert.equal(state.pathLocked, true);
  assert.match(state.unlock.hash, /^[0-9a-f]{64}$/);
  assert.equal(everyRow(h.db).includes(token), false, 'the token is in no table');
  assert.equal(JSON.stringify(h.db.bound.map((b) => b.values)).includes(token), false, 'the token is in no bound value');
});

test('a lock state that cannot be read fails closed, and mails a link', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  await wrongTry(h, dev);
  h.db.sqlite.prepare("UPDATE limits SET state = 'not json'").run();
  assert.deepEqual((await rightTry(h, dev)).start, LOCKED);
  assert.match(reopenTokenFrom(h, ADDRESS), /^[A-Za-z0-9_-]{43}$/);
});

test('a lock mail that fails to send is audited, and the lock holds', async () => {
  // Every send but the sign-up code's fails. The flow helpers read the
  // sign-up code from h.mail, so it shows what this sink kept.
  const sent = [];
  const h = harness({ mailer: async (m) => { sent.push(m); return /sign-up/i.test(m.subject); } });
  Object.defineProperty(h, 'mail', { get: () => sent });
  const dev = await enrolledDevice(h, ADDRESS);
  await lockWindow(h, dev);
  assert.equal(sent.filter((m) => !/sign-up/i.test(m.subject)).length, 1, 'the lock mail was tried');
  assert.deepEqual(auditRows(h.db).at(-1), { route: '/unlock/finish', reason: 'mail-failed' });
  assert.deepEqual((await rightTry(h, dev)).start, LOCKED);
});

test('a refused start and a reopen each write one audit row of route and reason', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  await lockWindow(h, dev);
  h.clock.ms += WINDOW_MS;
  await lockWindow(h, dev);
  const before = auditRows(h.db).length;
  await rightTry(h, dev);
  await h.call(post('/unlock/reopen', { token: reopenTokenFrom(h, ADDRESS) }));
  await h.call(post('/unlock/reopen', { token: 'A'.repeat(43) }));
  assert.deepEqual(auditRows(h.db).slice(before), [
    { route: '/nonce', reason: 'ok' }, { route: '/unlock/start', reason: 'locked' },
    { route: '/unlock/reopen', reason: 'ok' }, { route: '/unlock/reopen', reason: 'bad-link' },
  ]);
});

// ---- A5 security review, item 2 (MEDIUM): a pending device cannot close the path ----
// A pending device (registered once the owner's first code confirmed the
// enrolment, item 3) has shown only the password. Its tries count against its
// own cap (3 a day, a right code included) and never
// toward the account's windows, so a password thief cannot lock the owner out.

const pendingDevice = async (h, owner) => ({ ...(await registeredDevice(h, ADDRESS, { fresh: false })), seed: owner.seed });
const pathState = (h) => parseState(h.db.sqlite.prepare('SELECT state FROM limits').get().state);

test('A5 review 2: the probe (a pending device burns tries in two windows) leaves the owner\'s path open', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  const thief = await pendingDevice(h, owner);
  await lockWindow(h, thief);
  const same = await rightTry(h, owner);
  assert.equal(same.start.status, 200, 'the thief\'s wrongs did not lock the owner\'s window');
  assert.equal(same.finish.status, 200);
  h.clock.ms += WINDOW_MS;
  for (let i = 0; i < 3; i += 1) assert.deepEqual((await tryCode(h, thief, await wrongCodeAt(thief, h.clock.ms))).start, LOCKED, 'the thief is past its cap');
  assert.equal(pathState(h).pathLocked, false);
  assert.equal(reopenTokenFrom(h, ADDRESS), null, 'no path-closed mail');
  h.clock.ms += WINDOW_MS;
  assert.equal((await rightTry(h, owner)).finish.status, 200, 'the owner\'s path is open');
});

test('A5 review 2: a pending device gets 3 tries a day, a right code included, then the next day 3 more', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  const next = await pendingDevice(h, owner);
  const first = h.clock.ms;
  for (let i = 0; i < 3; i += 1) {
    await wrongTry(h, next);
    h.clock.ms += 2 * WINDOW_MS;
  }
  assert.deepEqual((await rightTry(h, next)).start, LOCKED, 'a right code is refused past the cap');
  h.clock.ms = first + DAY_MS - 1;
  assert.deepEqual((await rightTry(h, next)).start, LOCKED, 'the cap holds for a day from the first try');
  h.clock.ms = first + DAY_MS + WINDOW_MS;
  assert.equal((await rightTry(h, next)).finish.status, 200, 'a day later the device proves the code');
  assert.equal(h.db.sqlite.prepare('SELECT pending FROM device WHERE id = ?').get(next.id).pending, 0);
});

test('A5 review 2 NEGATIVE CONTROL: a pending device\'s tries are its own, so another pending device keeps its 3', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  const thief = await pendingDevice(h, owner);
  const mine = await pendingDevice(h, owner);
  await lockWindow(h, thief);
  h.clock.ms += WINDOW_MS;
  assert.equal((await rightTry(h, mine)).finish.status, 200);
});

test('A5 review 2 NEGATIVE CONTROL: a non-pending device\'s wrongs still close the path, for pending devices too', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  const next = await pendingDevice(h, owner);
  await lockWindow(h, owner);
  h.clock.ms += WINDOW_MS;
  await lockWindow(h, owner);
  assert.equal(pathState(h).pathLocked, true);
  assert.match(reopenTokenFrom(h, ADDRESS), /^[A-Za-z0-9_-]{43}$/);
  h.clock.ms += WINDOW_MS;
  assert.deepEqual((await rightTry(h, owner)).start, LOCKED);
  assert.deepEqual((await rightTry(h, next)).start, LOCKED, 'a closed path refuses a pending device');
  // A refusal on a closed path spends none of the device's tries: once the
  // link reopens the path, two wrong codes and then a right one are its 3.
  await h.call(post('/unlock/reopen', { token: reopenTokenFrom(h, ADDRESS) }));
  h.clock.ms += WINDOW_MS;
  await wrongTry(h, next);
  await wrongTry(h, next);
  assert.equal((await rightTry(h, next)).finish.status, 200);
});

// ---- A5 security review, item 5 (LOW): a closed path refuses the finish ----
// A start admitted while the path was open can reach /unlock/finish after
// other tries closed it. The finish answers locked: the exchange is spent,
// its try is dropped from the lockout uncounted, and no ticket is signed.

// Locks `count` windows two apart (none in a row), then sets the clock 5
// seconds before the end of a window two after the last.
async function lockWindowsApart(h, dev, count) {
  for (let i = 0; i < count; i += 1) {
    await lockWindow(h, dev);
    h.clock.ms += 2 * WINDOW_MS;
  }
  h.clock.ms = (Math.floor(h.clock.ms / WINDOW_MS) + 1) * WINDOW_MS - 5_000;
}

test('A5 review 5: /unlock/finish refuses while the path is closed, a right code started before it closed included', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  await lockWindowsApart(h, dev, 3);
  const early = await startCode(h, dev, await codeAt(dev, h.clock.ms));
  assert.equal(early.start.status, 200, 'the start is admitted while the path is open');
  h.clock.ms += 10_000;
  await lockWindow(h, dev);
  assert.equal(pathState(h).pathLocked, true, 'the fourth locked window that day closed the path');
  const mailed = lockMail(h, ADDRESS).length;
  const before = auditRows(h.db).length;
  const late = await early.finish();
  assert.equal(late.proved, true, 'the device proved a right code');
  assert.deepEqual(late.finish, LOCKED);
  assert.deepEqual(auditRows(h.db).slice(before), [{ route: '/nonce', reason: 'ok' }, { route: '/unlock/finish', reason: 'locked' }]);
  assert.deepEqual(pathState(h).pending, [], 'the refused try is dropped from the lockout, not left to count');
  assert.equal(lockMail(h, ADDRESS).length, mailed, 'a live link is not mailed again');
  assert.deepEqual((await early.finish()).finish, { status: 401, json: { error: 'bad-code' } }, 'the refusal spent the exchange');
  // The link reopens the path, and the next window takes a right code.
  await h.call(post('/unlock/reopen', { token: reopenTokenFrom(h, ADDRESS) }));
  h.clock.ms += WINDOW_MS;
  assert.equal((await rightTry(h, dev)).finish.status, 200);
});

test('A5 review 5 NEGATIVE CONTROL: a locked window that leaves the path open does not refuse a finish begun before it', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  await lockWindowsApart(h, dev, 2);
  const early = await startCode(h, dev, await codeAt(dev, h.clock.ms));
  assert.equal(early.start.status, 200);
  h.clock.ms += 10_000;
  await lockWindow(h, dev);
  assert.equal(pathState(h).pathLocked, false, 'three locked windows apart leave the path open');
  assert.equal((await early.finish()).finish.status, 200);
});
