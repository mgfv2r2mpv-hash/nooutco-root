import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initiatorStart, responderReply, initiatorFinish, responderConfirm, generatorFor, channelFor, unlockChannelFor } from '../src/pake.mjs';

const CHANNEL = 'lp.example.test|pollux';

function run({ phoneCode, serverCodes, channelA = CHANNEL, channelB = CHANNEL }) {
  const a = initiatorStart({ code: phoneCode, channel: channelA });
  const b = responderReply({ codes: serverCodes, channel: channelB, ...a.message });
  const finished = initiatorFinish(a.state, b.replies);
  const serverKeys = finished ? responderConfirm(b.pending, finished.tagA) : null;
  return { a, b, finished, serverKeys };
}

test('a matching code gives both ends the same keys', () => {
  const { finished, serverKeys } = run({ phoneCode: '123456', serverCodes: ['123456', '000000'] });
  assert.ok(finished && serverKeys);
  for (const name of ['sessionId', 'c2s', 's2c']) {
    assert.deepEqual(Buffer.from(finished.keys[name]), Buffer.from(serverKeys[name]));
  }
  assert.notDeepEqual(Buffer.from(serverKeys.c2s), Buffer.from(serverKeys.s2c));
});

test('the previous window code is accepted too', () => {
  const { serverKeys } = run({ phoneCode: '000000', serverCodes: ['123456', '000000'] });
  assert.ok(serverKeys);
});

test('a wrong code fails on the phone and on the gatekeeper', () => {
  const { a, b, finished } = run({ phoneCode: '111111', serverCodes: ['123456', '000000'] });
  assert.equal(finished, null);
  const forged = initiatorFinish(a.state, b.replies.map((r) => ({ ...r, tagB: r.tagB })));
  assert.equal(forged, null);
  assert.equal(responderConfirm(b.pending, new Uint8Array(32)), null);
});

test('an exchange bound to one Mac does not pair with another', () => {
  const { finished } = run({ phoneCode: '123456', serverCodes: ['123456'], channelB: 'lc.example.test|castor' });
  assert.equal(finished, null);
});

test('two runs with the same code give different keys', () => {
  const one = run({ phoneCode: '123456', serverCodes: ['123456'] });
  const two = run({ phoneCode: '123456', serverCodes: ['123456'] });
  assert.notDeepEqual(Buffer.from(one.serverKeys.c2s), Buffer.from(two.serverKeys.c2s));
});

test('a tagA replayed into a later exchange is refused', () => {
  const first = run({ phoneCode: '123456', serverCodes: ['123456'] });
  const a = initiatorStart({ code: '123456', channel: CHANNEL });
  const b = responderReply({ codes: ['123456'], channel: CHANNEL, ...a.message });
  assert.equal(responderConfirm(b.pending, first.finished.tagA), null);
});

test('the identity point and bad encodings are refused', () => {
  const sid = new Uint8Array(16);
  assert.throws(() => responderReply({ codes: ['123456'], channel: CHANNEL, sid, Ya: new Uint8Array(32) }));
  assert.throws(() => responderReply({ codes: ['123456'], channel: CHANNEL, sid, Ya: new Uint8Array(32).fill(255) }));
  assert.throws(() => responderReply({ codes: ['123456'], channel: CHANNEL, sid, Ya: new Uint8Array(31) }));
});

test('only a 6-digit code is taken', () => {
  const sid = new Uint8Array(16);
  for (const code of ['12345', '1234567', 'abcdef', 123456]) {
    assert.throws(() => generatorFor({ code, channel: CHANNEL, sid }));
  }
});

// A5 (A1 open point 3): Horae Zone runs the same exchange at /unlock/start and
// /unlock/finish, under its own channel label, bound to the one device that
// signs both requests. The device builds the same label with this function.
test('a Horae Zone unlock channel names one device and is apart from every JanusMirror channel', () => {
  assert.equal(unlockChannelFor('dev-A_1'), 'horae-zone-unlock-v1|dev-A_1');
  assert.notEqual(unlockChannelFor('dev-1'), unlockChannelFor('dev-2'));
  assert.equal(unlockChannelFor('lp-example').startsWith('janusmirror-e2e|'), false);
  assert.notEqual(unlockChannelFor('x'), channelFor('x'));
});

test('an unlock exchange for one device does not finish for another', () => {
  const { finished } = run({ phoneCode: '123456', serverCodes: ['123456'], channelA: unlockChannelFor('dev-1'), channelB: unlockChannelFor('dev-2') });
  assert.equal(finished, null);
});

test('NEGATIVE CONTROL: an unlock exchange finishes for the device it names', () => {
  const { serverKeys } = run({ phoneCode: '123456', serverCodes: ['123456'], channelA: unlockChannelFor('dev-1'), channelB: unlockChannelFor('dev-1') });
  assert.ok(serverKeys);
});

test('an unlock channel takes only a device id', () => {
  for (const bad of [42, '', 'has space', 'a|b', 'x'.repeat(65), null]) {
    assert.throws(() => unlockChannelFor(bad), TypeError, String(bad));
  }
});
