// The code-path lockout ruled for JanusMirror (its E2E brief, ruling 4), as
// pure rules over a plain state object: the caller keeps the state (a file on
// the Mac, a D1 row on Horae Zone) and sends the emails the events name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState, admit, confirm, reject, settle, issueUnlock, spendUnlock, needsFreshLink, parseState,
  WINDOW_MS, CONFIRM_MS, DAY_MS, UNLOCK_TTL_MS,
} from '../src/limits.mjs';

const T0 = 1_000 * WINDOW_MS;

// Admits an exchange and settles it as wrong, as a failed tagA would.
function wrong(state, now, id) {
  const a = admit(state, now, id);
  assert.equal(a.ok, true, `admit ${id}: ${a.reason}`);
  return reject(a.state, now, id);
}

function lockWindow(state, now, tag) {
  let s = state;
  let events = [];
  for (let i = 0; i < 3; i += 1) ({ state: s, events } = wrong(s, now, `${tag}-${i}`));
  return { state: s, events };
}

test('two wrong codes in a window do not lock; the third locks that window and names one email', () => {
  let s = emptyState();
  ({ state: s } = wrong(s, T0, 'a'));
  const second = wrong(s, T0, 'b');
  assert.deepEqual(second.events, []);
  const third = wrong(second.state, T0, 'c');
  assert.deepEqual(third.events.map((e) => e.kind), ['window-lock']);
  assert.deepEqual(admit(third.state, T0, 'd'), { state: third.state, ok: false, reason: 'window-locked' });
  assert.equal(admit(third.state, T0 + WINDOW_MS, 'e').ok, true);
});

test('NEGATIVE CONTROL: a confirmed exchange is not a wrong code', () => {
  let s = emptyState();
  ({ state: s } = wrong(s, T0, 'a'));
  ({ state: s } = wrong(s, T0, 'b'));
  const a = admit(s, T0, 'right');
  assert.equal(a.ok, true);
  s = confirm(a.state, 'right');
  const settled = settle(s, T0 + CONFIRM_MS + 1);
  assert.deepEqual(settled.events, []);
  assert.deepEqual(settled.state.locked, []);
});

test('a window admits no fourth exchange while three are unsettled', () => {
  let s = emptyState();
  for (const id of ['a', 'b', 'c']) ({ state: s } = admit(s, T0, id));
  assert.equal(admit(s, T0, 'd').reason, 'window-full');
});

test('an exchange never confirmed counts as wrong once its confirm time passes', () => {
  let s = emptyState();
  ({ state: s } = wrong(s, T0, 'a'));
  ({ state: s } = wrong(s, T0, 'b'));
  ({ state: s } = admit(s, T0, 'silent'));
  assert.deepEqual(settle(s, T0 + CONFIRM_MS - 1).events, []);
  assert.deepEqual(settle(s, T0 + CONFIRM_MS + 1).events.map((e) => e.kind), ['window-lock']);
});

test('two locked windows in a row close the path until the emailed link', () => {
  let { state: s } = lockWindow(emptyState(), T0, 'w1');
  const r = lockWindow(s, T0 + WINDOW_MS, 'w2');
  assert.deepEqual(r.events.map((e) => [e.kind, e.reason]), [['path-lock', 'two-in-a-row']]);
  s = r.state;
  assert.equal(admit(s, T0 + 10 * WINDOW_MS, 'x').reason, 'path-locked');
  assert.equal(needsFreshLink(s, T0 + 10 * WINDOW_MS), true);
});

test('four locked windows in a day close the path', () => {
  let s = emptyState();
  let events = [];
  for (let i = 0; i < 4; i += 1) ({ state: s, events } = lockWindow(s, T0 + i * 10 * WINDOW_MS, `w${i}`));
  assert.deepEqual(events.map((e) => [e.kind, e.reason]), [['path-lock', 'four-in-a-day']]);
});

test('the reopen link is single use, expires, and keeps only its hash', () => {
  let { state: s } = lockWindow(emptyState(), T0, 'w1');
  ({ state: s } = lockWindow(s, T0 + WINDOW_MS, 'w2'));
  s = issueUnlock(s, T0, 'token-one');
  assert.equal(JSON.stringify(s).includes('token-one'), false);
  assert.equal(spendUnlock(s, T0, 'token-two').ok, false);
  assert.equal(spendUnlock(s, T0 + UNLOCK_TTL_MS, 'token-one').reason, 'expired');
  const spent = spendUnlock(s, T0 + 1, 'token-one');
  assert.equal(spent.ok, true);
  assert.equal(spendUnlock(spent.state, T0 + 2, 'token-one').ok, false);
  assert.equal(admit(spent.state, T0 + 3 * WINDOW_MS, 'y').ok, true);
});

test('history older than a day is dropped', () => {
  const { state: s } = lockWindow(emptyState(), T0, 'old');
  assert.deepEqual(settle(s, T0 + DAY_MS + WINDOW_MS).state.locked, []);
});

test('a state round-trips through JSON and a malformed one is refused', () => {
  const { state: s } = lockWindow(emptyState(), T0, 'w');
  assert.deepEqual(parseState(JSON.stringify(s)), s);
  assert.throws(() => parseState('{"version":1}'), /limits state/);
  assert.throws(() => parseState('nope'), /limits state/);
});
