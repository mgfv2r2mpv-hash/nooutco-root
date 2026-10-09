// One daily mail budget across every Horae Zone sender (PR #324, Pollux's
// review MEDIUM, 9 Oct 2026). Kaleb confirmed the Resend account is on the
// free plan: 3,000 a month, enforced as 100 a day. Sign-up and recovery each
// had a 100-a-day bucket of their own, and the notices (lock, removal,
// offline, recovery done, PIN and code-path notes) and the operator alert
// mailed with no daily cap at all, so together they could pass 100 and
// Resend would then drop mail, security notices included.
//
// Now every send through Resend takes one place in one sliding 24-hour count
// ('mail-day'), with tiered ceilings against the day's budget
// (HZ_MAIL_PER_DAY, default 100): sign-up starts only under 70, recovery
// starts under 90, and the notices and the operator alert up to 100. So a
// sign-up flood never starves a recovery or a security notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REMOVED_NOTE } from '../src/device-remove.js';
import {
  harness, post, signed, passToken, auditRows, everyRow, registeredDevice, confirmedDevice, ticketFor,
  recoverStart, T0,
} from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses only.
const ADDRESS = 'mail-budget@example.test';
const OPERATOR = 'operator@example.test';
const BUCKET = 'mail-day';
const LOCKED_SUBJECT = 'Horae Zone: account locked';
const SLOW_DOWN = { status: 429, json: { error: 'slow-down' } };
const UNAVAILABLE = { status: 503, json: { error: 'unavailable' } };

async function answer(res) {
  return { status: res.status, json: await res.json() };
}

const sharedCount = (h) => h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM throttle WHERE bucket = ?').get(BUCKET).n;
// Places other senders took earlier in the day, written as they would be.
const fillTo = (h, count) => {
  const insert = h.db.sqlite.prepare('INSERT INTO throttle (bucket, at) VALUES (?, ?)');
  while (sharedCount(h) < count) insert.run(BUCKET, h.clock.ms);
};
const removedAt = (h, id) => h.db.sqlite.prepare('SELECT removed_at FROM device WHERE id = ?').get(id).removed_at;
const notesTitled = (h, subject) => h.mail.filter((m) => m.subject === subject);

let starts = 0;
// A sign-up start from its own connecting address, so the per-requester
// hour never refuses it: only a day cap can.
function signupStart(h, email = null) {
  starts += 1;
  const ip = `10.${Math.floor(starts / 250) % 250}.${starts % 250}.${(starts % 200) + 1}`;
  return h.call(post('/account', { email: email ?? `flood-${starts}@example.test`, turnstile: passToken('account') }, { 'cf-connecting-ip': ip }));
}

let recovers = 0;
function recoveryStart(h, email = ADDRESS) {
  recovers += 1;
  return h.call(recoverStart(email, { ip: `172.16.${Math.floor(recovers / 250) % 250}.${(recovers % 250) + 1}` }));
}

// The account's owner device, its code enrolled and confirmed, and a second
// device that has proved the code, so neither is pending.
async function twoDevices(h) {
  const owner = await confirmedDevice(h, ADDRESS);
  const second = { ...(await registeredDevice(h, ADDRESS, { fresh: false })), seed: owner.seed };
  await ticketFor(h, second);
  return { owner, second };
}

async function removal(h, owner, second) {
  return answer(await h.call(await signed(h.call, owner, '/device/remove', { device: second.id, ticket: await ticketFor(h, owner) })));
}

test('the budget: 100 a day by default, sign-up under 70, recovery under 90, notices up to 100', async () => {
  const budget = await import('../src/mail-budget.js');
  assert.equal(budget.MAIL_BUCKET, BUCKET);
  assert.equal(budget.MAIL_PER_DAY, 100, 'the Resend free plan, as Kaleb confirmed on 9 Oct 2026');
  assert.deepEqual({ ...budget.MAIL_TIERS }, { signup: 70, recovery: 90, notice: 100 });
  assert.equal(budget.MAIL_DAY_MS, 24 * 60 * 60 * 1000);
});

test('a sign-up flood stops at 70 shared sends, and a device-removal notice still goes out', async () => {
  const h = harness();
  const { owner, second } = await twoDevices(h);
  let last = null;
  for (let i = 0; i < 100 && (last === null || last.status === 200); i += 1) {
    last = await answer(await signupStart(h));
  }
  assert.deepEqual(last, SLOW_DOWN, 'the flood meets the sign-up tier with the same answer as any day cap');
  assert.equal(sharedCount(h), 70, 'sign-up starts stop at 70 of the day');
  const mailed = h.mail.length;
  assert.deepEqual(await answer(await signupStart(h)), SLOW_DOWN, 'and stay stopped');
  assert.equal(h.mail.length, mailed, 'a refused start mails nothing');
  assert.equal(sharedCount(h), 70, 'and takes no place');
  assert.deepEqual(await removal(h, owner, second), { status: 200, json: { ok: true } });
  assert.equal(notesTitled(h, REMOVED_NOTE.subject).length, 1, 'the removal notice still went out');
  assert.equal(sharedCount(h), 71, 'and it counted once');
});

test('recovery starts stop at 90 shared sends, and a lock notice still goes out', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  fillTo(h, 70);
  assert.deepEqual(await answer(await signupStart(h)), SLOW_DOWN, 'NEGATIVE CONTROL: sign-up is already stopped at 70');
  fillTo(h, 88);
  assert.equal((await recoveryStart(h)).status, 200, 'recovery still starts above the sign-up tier');
  assert.equal(sharedCount(h), 89);
  assert.equal((await recoveryStart(h)).status, 200, 'the last place under 90');
  assert.equal(sharedCount(h), 90);
  const mailed = h.mail.length;
  assert.deepEqual(await answer(await recoveryStart(h)), SLOW_DOWN, 'recovery answers as its own day cap does');
  assert.equal(h.mail.length, mailed, 'a refused recovery start mails nothing');
  assert.equal(sharedCount(h), 90, 'and takes no place');
  const blocked = await h.call(await signed(h.call, owner, '/pin/blocked', {}));
  assert.equal(blocked.status, 423);
  assert.equal(notesTitled(h, LOCKED_SUBJECT).length, 1, 'the lock notice still went out');
  assert.equal(sharedCount(h), 91);
});

test('at 100 nothing sends, the removal itself still lands, and the refused notice is audited mail-budget', async () => {
  const h = harness();
  const { owner, second } = await twoDevices(h);
  const ticket = await ticketFor(h, owner);
  fillTo(h, 100);
  const mailed = h.mail.length;
  const before = auditRows(h.db).length;
  const res = await answer(await h.call(await signed(h.call, owner, '/device/remove', { device: second.id, ticket })));
  assert.deepEqual(res, { status: 200, json: { ok: true } }, 'the answer is the one a sent notice gets');
  assert.notEqual(removedAt(h, second.id), null, 'the removal landed');
  assert.equal(h.mail.length, mailed, 'no mail went out');
  assert.equal(sharedCount(h), 100, 'nothing passed the day');
  assert.deepEqual(auditRows(h.db).slice(before).filter((r) => r.route === '/device/remove'),
    [{ route: '/device/remove', reason: 'ok' }, { route: '/device/remove', reason: 'mail-budget' }]);
  assert.deepEqual(await answer(await signupStart(h)), SLOW_DOWN);
  assert.deepEqual(await answer(await recoveryStart(h)), SLOW_DOWN);
  assert.equal(h.mail.length, mailed);
});

test('a refused notice logs no address and no account id, and nothing reaches the console', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  fillTo(h, 100);
  const said = [];
  const saved = {};
  for (const name of ['log', 'info', 'warn', 'error', 'debug']) {
    saved[name] = console[name];
    console[name] = (...args) => said.push(args.join(' '));
  }
  let blocked;
  try {
    blocked = await h.call(await signed(h.call, owner, '/pin/blocked', {}));
  } finally {
    Object.assign(console, saved);
  }
  assert.equal(blocked.status, 423, 'the lock still lands');
  assert.equal(notesTitled(h, LOCKED_SUBJECT).length, 0);
  assert.deepEqual(said, [], 'no console line');
  const rows = h.db.sqlite.prepare('SELECT * FROM audit WHERE reason = ?').all('mail-budget').map((r) => ({ ...r }));
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['at', 'id', 'reason', 'route']);
  assert.equal(rows[0].route, '/pin/blocked');
  const account = h.db.sqlite.prepare('SELECT id FROM account').get().id;
  const text = JSON.stringify(rows);
  assert.equal(text.includes(ADDRESS), false);
  assert.equal(text.includes(account), false);
  assert.equal(everyRow(h.db).includes(ADDRESS), false, 'no table holds the address in the clear');
});

test('the count is shared: each sender takes one place in the same day', async () => {
  const h = harness({ env: { HZ_ALERT_TO: OPERATOR } });
  const { owner, second } = await twoDevices(h);
  const base = sharedCount(h);
  assert.ok(base >= 1, 'the owner sign-up already counted');
  assert.equal((await signupStart(h)).status, 200);
  assert.equal(sharedCount(h), base + 1, 'a sign-up start');
  assert.equal((await recoveryStart(h)).status, 200);
  assert.equal(sharedCount(h), base + 2, 'a recovery start');
  assert.deepEqual(await removal(h, owner, second), { status: 200, json: { ok: true } });
  assert.equal(sharedCount(h), base + 3, 'a removal notice');
  const sent = h.mail.length;
  fillTo(h, 70);
  assert.deepEqual(await answer(await signupStart(h)), SLOW_DOWN, 'notices and recoveries count toward the sign-up stop');
  assert.equal(h.mail.length, sent);
});

test('the operator alert still fires once, at half the sign-up tier (35 shared sends), and counts as a send', async () => {
  const h = harness({ env: { HZ_ALERT_TO: OPERATOR } });
  fillTo(h, 33);
  assert.equal((await signupStart(h)).status, 200);
  assert.equal(h.mail.filter((m) => m.to === OPERATOR).length, 0, 'no alert at 34');
  assert.equal((await signupStart(h)).status, 200);
  const alerts = h.mail.filter((m) => m.to === OPERATOR);
  assert.equal(alerts.length, 1, 'one alert at 35');
  assert.equal(sharedCount(h), 36, 'the alert took a place of its own');
  assert.match(alerts[0].text, /\b35\b/);
  assert.match(alerts[0].text, /\b70\b/);
  assert.equal(/@/.test(alerts[0].text), false);
  assert.equal((await signupStart(h)).status, 200);
  assert.equal(h.mail.filter((m) => m.to === OPERATOR).length, 1, 'still one alert');
});

test('an alert the budget refuses is audited mail-budget, and the sign-up link still goes out', async () => {
  // A day of 10: sign-up under 7, so the alert is due at 4 (half of 7,
  // rounded up). Other senders fill the day while the link mail goes out,
  // so by the alert's turn no place is left.
  const sent = [];
  const h = harness({
    env: { HZ_MAIL_PER_DAY: '10', HZ_ALERT_TO: OPERATOR },
    mailer: async (m) => { sent.push(m); if (m.to !== OPERATOR) fillTo(h, 10); return true; },
  });
  fillTo(h, 3);
  const before = auditRows(h.db).length;
  assert.equal((await signupStart(h)).status, 200);
  assert.equal(sent.filter((m) => m.to === OPERATOR).length, 0, 'the alert was refused');
  assert.equal(sent.length, 1, 'the sign-up link went out');
  assert.deepEqual(auditRows(h.db).slice(before), [{ route: '/account', reason: 'ok' }, { route: '/account', reason: 'mail-budget' }]);
  assert.equal(sharedCount(h), 10, 'nothing passed the day');
});

test('HZ_MAIL_PER_DAY moves every tier with it', async () => {
  // A day of 10: sign-up under 7, recovery under 9, notices up to 10.
  const h = harness({ env: { HZ_MAIL_PER_DAY: '10' } });
  const { owner, second } = await twoDevices(h);
  fillTo(h, 6);
  assert.equal((await signupStart(h)).status, 200);
  assert.deepEqual(await answer(await signupStart(h)), SLOW_DOWN, 'sign-up stops at 7');
  fillTo(h, 8);
  assert.equal((await recoveryStart(h)).status, 200);
  assert.deepEqual(await answer(await recoveryStart(h)), SLOW_DOWN, 'recovery stops at 9');
  assert.deepEqual(await removal(h, owner, second), { status: 200, json: { ok: true } });
  assert.equal(notesTitled(h, REMOVED_NOTE.subject).length, 1, 'the notice takes the 10th place');
  assert.equal(sharedCount(h), 10);
  const big = harness({ env: { HZ_MAIL_PER_DAY: '3000' } });
  fillTo(big, 100);
  assert.equal((await signupStart(big)).status, 200, 'a paid plan raises the shared stop past 100');
});

test('a bad HZ_MAIL_PER_DAY stops sign-up and recovery starts, and a notice falls back to the default 100', async () => {
  for (const bad of ['0', '-1', '1.5', 'many', '']) {
    const h = harness({ env: { HZ_MAIL_PER_DAY: bad } });
    assert.deepEqual(await answer(await signupStart(h)), UNAVAILABLE, `sign-up, ${JSON.stringify(bad)}`);
    assert.deepEqual(await answer(await recoveryStart(h)), UNAVAILABLE, `recovery, ${JSON.stringify(bad)}`);
    assert.deepEqual(h.mail, []);
    assert.equal(sharedCount(h), 0);
  }
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  h.env.HZ_MAIL_PER_DAY = 'many';
  fillTo(h, 99);
  assert.equal((await h.call(await signed(h.call, owner, '/pin/blocked', {}))).status, 423);
  assert.equal(notesTitled(h, LOCKED_SUBJECT).length, 1, 'the lock notice used the last place of the default day');
  assert.equal(sharedCount(h), 100);
});

test('the shared count slides: a place frees 24 hours after it was taken', async () => {
  const h = harness();
  fillTo(h, 70);
  assert.deepEqual(await answer(await signupStart(h)), SLOW_DOWN);
  h.clock.ms = T0 + 24 * 60 * 60 * 1000;
  assert.equal((await signupStart(h)).status, 200, 'the day moved on');
});
