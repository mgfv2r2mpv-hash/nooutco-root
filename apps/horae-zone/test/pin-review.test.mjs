// A5b, the annual PIN review (plan §3.4 "Annual review"). 365 days after a
// PIN is set, the next login shows one modal with exactly "Snooze" and
// "Change PIN". The first four snoozes defer 7 days each; every later one
// defers 1 day, without limit. The schedule lives only on the server: the
// client receives only review true or false, and the two action names.
// "Change PIN" restarts the 365 days and locks the old PIN.
//
//   /pin/review {}                  -> {review: false} | {review: true, actions: ['Snooze', 'Change PIN']}
//   /pin/review {action: 'Snooze'}  -> {ok: true, review: false}   only while the review is due
//
// "Change PIN" is the change /pin/set already serves ({pin, current, ticket?}).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_LIMITS, REVIEW_ACTIONS } from '../src/pin-review.js';
import { PIN_LOCKED } from '../../../packages/account-engine/src/pin.mjs';
import { harness, everyRow, landsMidFlight, registeredDevice, ticketFor, pinCall, pinnedDevice } from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses and PINs with no run of
// three that are not on the public fixture list.
const ADDRESS = 'pin-review@example.test';
const OTHER = 'pin-review-other@example.test';
const FIRST = '274951';
const SECOND = '385062';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_DUE = { status: 200, json: { review: false } };
const DUE = { status: 200, json: { review: true, actions: ['Snooze', 'Change PIN'] } };
const SNOOZED = { status: 200, json: { ok: true, review: false } };
// The handler's read of the schedule, for a snooze that lands after it.
const READ_SCHEDULE = 'SELECT p.set_at AS set_at, r.due_at AS due_at FROM pin p';

const setAt = (h, account) => h.db.sqlite.prepare('SELECT set_at FROM pin WHERE account_id = ?').get(account).set_at;
const reviewRows = (h) => h.db.sqlite.prepare('SELECT * FROM pin_review ORDER BY account_id').all().map((r) => ({ ...r }));
const state = (h, dev) => pinCall(h, dev, '/pin/review', {});
const snooze = (h, dev) => pinCall(h, dev, '/pin/review', { action: 'Snooze' });

// Moves the clock to `ms` and checks the review is not due just before it and due at it.
async function dueExactlyAt(h, dev, ms, label) {
  h.clock.ms = ms - 1;
  assert.deepEqual(await state(h, dev), NOT_DUE, `${label}: not due a moment before`);
  h.clock.ms = ms;
  assert.deepEqual(await state(h, dev), DUE, `${label}: due at the moment`);
}

// ---- the plan tests ----

test('the first four snoozes defer seven days and later ones one day', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  assert.deepEqual(REVIEW_LIMITS, { everyMs: 365 * DAY_MS, longSnoozes: 4, longSnoozeMs: 7 * DAY_MS, shortSnoozeMs: DAY_MS });
  assert.deepEqual(await state(h, dev), NOT_DUE, 'a new PIN is not due for review');

  let due = setAt(h, dev.account) + 365 * DAY_MS;
  await dueExactlyAt(h, dev, due, 'the first review');
  const defers = [7, 7, 7, 7, 1, 1, 1];
  for (const [i, days] of defers.entries()) {
    // A snooze a little after the review came due defers from the snooze.
    h.clock.ms = due + 1000;
    assert.deepEqual(await snooze(h, dev), SNOOZED, `snooze ${i + 1}`);
    assert.deepEqual(reviewRows(h), [{ account_id: dev.account, snoozes: i + 1, due_at: h.clock.ms + days * DAY_MS }], `snooze ${i + 1} kept on the server`);
    due = h.clock.ms + days * DAY_MS;
    await dueExactlyAt(h, dev, due, `after snooze ${i + 1}`);
  }
});

test('the review modal offers exactly Snooze and Change PIN', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  assert.deepEqual(REVIEW_ACTIONS, ['Snooze', 'Change PIN']);
  assert.ok(Object.isFrozen(REVIEW_ACTIONS));
  assert.deepEqual(await state(h, dev), NOT_DUE, 'NEGATIVE CONTROL: no modal before the PIN is a year old, and no action named');

  const first = setAt(h, dev.account);
  h.clock.ms = first + 365 * DAY_MS;
  assert.deepEqual(await state(h, dev), DUE, 'the two actions, in that order, and nothing else');

  // A snooze or two this cycle, then "Change PIN": the change /pin/set serves.
  assert.deepEqual(await snooze(h, dev), SNOOZED);
  h.clock.ms += 7 * DAY_MS;
  assert.deepEqual(await state(h, dev), DUE);
  const changed = await pinCall(h, dev, '/pin/set', { pin: SECOND, current: FIRST, ticket: await ticketFor(h, dev) });
  assert.equal(changed.status, 200);
  assert.deepEqual(await state(h, dev), NOT_DUE, 'Change PIN closes the modal');
  assert.deepEqual(reviewRows(h), [], 'and clears this cycle\'s snoozes');
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: FIRST, current: SECOND }),
    { status: 409, json: { error: 'pin-reused', message: PIN_LOCKED } }, 'and locks the old PIN');

  // The 365 days restart at the change, and so does the count of long snoozes.
  const second = setAt(h, dev.account);
  assert.ok(second > first);
  await dueExactlyAt(h, dev, second + 365 * DAY_MS, 'the next review');
  assert.deepEqual(await snooze(h, dev), SNOOZED);
  assert.deepEqual(reviewRows(h), [{ account_id: dev.account, snoozes: 1, due_at: h.clock.ms + 7 * DAY_MS }]);
});

// ---- the route ----

test('a snooze counts only while the review is due, and one that lands meanwhile counts once', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  const notDue = { status: 409, json: { error: 'not-due' } };
  assert.deepEqual(await snooze(h, dev), notDue, 'nothing to snooze before the review');
  assert.deepEqual(reviewRows(h), []);

  // Another device's snooze lands after this request read the review as due,
  // before its own write: the write itself checks the review is still due.
  h.clock.ms = setAt(h, dev.account) + 365 * DAY_MS;
  const other = { ...h.env.DB };
  landsMidFlight(h, READ_SCHEDULE, (db) => {
    db.sqlite.prepare('INSERT INTO pin_review (account_id, snoozes, due_at) VALUES (?, 1, ?)').run(dev.account, h.clock.ms + 7 * DAY_MS);
  });
  assert.deepEqual(await snooze(h, dev), notDue);
  h.env.DB = other;
  assert.deepEqual(reviewRows(h).map((r) => r.snoozes), [1], 'one snooze, not two');
  assert.deepEqual(await snooze(h, dev), notDue, 'a snoozed review is not due');
});

test('the review takes only an empty body or the Snooze action', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  h.clock.ms = setAt(h, dev.account) + 365 * DAY_MS;
  const shape = { status: 400, json: { error: 'shape' } };
  for (const body of [{ action: 'Change PIN' }, { action: 'snooze' }, { action: 'Snooze', days: 30 }, { review: false }, { action: 1 }, []]) {
    assert.deepEqual(await pinCall(h, dev, '/pin/review', body), shape, JSON.stringify(body));
  }
  assert.deepEqual(reviewRows(h), []);
  assert.deepEqual(await state(h, dev), DUE, 'a refused body changes nothing');
});

test('an account with no PIN has no review, and a pending device reaches none', async () => {
  const h = harness();
  const bare = await registeredDevice(h, OTHER);
  assert.deepEqual(await pinCall(h, bare, '/pin/review', {}), { status: 409, json: { error: 'no-pin' } });
  assert.deepEqual(await pinCall(h, bare, '/pin/review', { action: 'Snooze' }), { status: 409, json: { error: 'no-pin' } });

  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  const later = await registeredDevice(h, ADDRESS, { fresh: false });
  h.clock.ms = setAt(h, dev.account) + 365 * DAY_MS;
  assert.deepEqual(await pinCall(h, later, '/pin/review', { action: 'Snooze' }), { status: 401, json: { error: 'no-device' } });
  assert.deepEqual(reviewRows(h), [], 'a pending device snoozed nothing');
});

test('one account\'s snooze is its own', async () => {
  const h = harness();
  const mine = await pinnedDevice(h, ADDRESS, FIRST);
  const theirs = await pinnedDevice(h, OTHER, FIRST);
  h.clock.ms = Math.max(setAt(h, mine.account), setAt(h, theirs.account)) + 365 * DAY_MS;
  assert.deepEqual(await snooze(h, mine), SNOOZED);
  assert.deepEqual(await state(h, mine), NOT_DUE);
  assert.deepEqual(await state(h, theirs), DUE, 'the other account still reviews');
});

// ---- what the table keeps ----

test('the schedule is the account, a count and a due time, and every new PIN starts a fresh one', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  h.clock.ms = setAt(h, dev.account) + 365 * DAY_MS;
  assert.deepEqual(await snooze(h, dev), SNOOZED);
  assert.deepEqual(Object.keys(reviewRows(h)[0]).sort(), ['account_id', 'due_at', 'snoozes']);
  assert.equal(everyRow(h.db).includes(FIRST), false);

  // However the PIN was replaced (a change, a reset, the review's change),
  // the write that restarts set_at clears the snoozes with it.
  h.db.sqlite.prepare('UPDATE pin SET set_at = ? WHERE account_id = ?').run(h.clock.ms, dev.account);
  assert.deepEqual(reviewRows(h), []);
  assert.deepEqual(await state(h, dev), NOT_DUE);
});
