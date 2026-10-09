// A6, "Bring my vault" (plan §3.3 "Each further device" step 4, §3.6
// /pair/offer and /pair/take): pairing v2 envelopes between two confirmed
// devices of one account, carried by the handoff table.
//
//   /pair/take  {}                                   -> {offer: null | {from, fromKey, vault, envelope}}
//   /pair/offer {to, vault, envelope, pin, ticket?}  -> {ok: true}
//
// The new device asks with /pair/take. A device holding the vault approves
// with Face ID (its signature) and the app PIN (checked in the PIN lockout,
// with the code at 12 hours as at every open), and puts up the vault key
// sealed on the device to the asking device's registered agreement key. The
// service never opens the envelope: it hands it, once, to the one device that
// asked, for the account's current vault only, and a switch or a recovery
// drops it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BROUGHT_NOTE } from '../src/pair.js';
import {
  harness, pinnedDevice, provedDevice, pinCall, switchVault, vaultId, ticketFor, auditRows, everyRow, addDevice, signed,
} from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses, a PIN off the public list
// and an envelope that is only a marker (the service never opens one).
const ADDRESS = 'pair@example.test';
const PIN = '274951';
const WRONG_PIN = '583920';
const ENVELOPE = 'CANARYenvelope-sealed-to-the-asking-device_0123456789';
const V1 = vaultId(1);
const V2 = vaultId(2);
const NONE = { status: 200, json: { offer: null } };
const OK = { status: 200, json: { ok: true } };

const accountOf = (h, id) => h.db.sqlite.prepare('SELECT account_id FROM device WHERE id = ?').get(id).account_id;

// The owner with its PIN and the first vault recorded, and a second device
// that proved the code: the one that will ask for the vault.
async function setup(h, email = ADDRESS) {
  const owner = { ...(await pinnedDevice(h, email, PIN)), email };
  assert.deepEqual(await switchVault(h, owner, V1), OK);
  const asker = await provedDevice(h, owner);
  return { owner, asker };
}

const take = (h, dev) => pinCall(h, dev, '/pair/take', {});
const offer = (h, dev, body) => pinCall(h, dev, '/pair/offer', { vault: V1, envelope: ENVELOPE, pin: PIN, ...body });

test('a bring hands the sealed envelope only to the device that asked, once', async () => {
  const h = harness();
  const { owner, asker } = await setup(h);
  const bystander = await provedDevice(h, owner, { ip: '192.0.2.12' });
  assert.deepEqual(await take(h, asker), NONE, 'the ask is recorded, nothing waits yet');
  assert.deepEqual(await offer(h, owner, { to: asker.id }), OK);
  assert.deepEqual(await take(h, bystander), NONE, 'another device of the account gets nothing');
  const taken = await take(h, asker);
  assert.equal(taken.status, 200);
  assert.deepEqual(taken.json.offer, { from: owner.id, fromKey: owner.agreeKey, vault: V1, envelope: ENVELOPE });
  assert.deepEqual(await take(h, asker), NONE, 'the envelope is handed out once');
  assert.equal(everyRow(h.db).includes(ENVELOPE), false, 'no table keeps it after the take');
  assert.equal(h.mail.filter((m) => m.subject === BROUGHT_NOTE.subject && m.to === ADDRESS).length, 1, 'the account is told of the approval');
});

test('an offer needs an ask from a confirmed device of the account, for the current vault', async () => {
  const h = harness();
  const { owner, asker } = await setup(h);
  assert.deepEqual(await offer(h, owner, { to: asker.id }), { status: 409, json: { error: 'no-ask' } }, 'nobody asked');
  await take(h, asker);
  assert.deepEqual(await offer(h, owner, { to: owner.id }), { status: 400, json: { error: 'shape' } }, 'never to itself');
  assert.deepEqual(await offer(h, owner, { to: asker.id, vault: V2 }), { status: 409, json: { error: 'vault-gone' } }, 'not the current vault');
  const other = { ...(await pinnedDevice(h, 'pair-other@example.test', PIN)), email: 'pair-other@example.test' };
  await switchVault(h, other, vaultId(9));
  assert.deepEqual(await offer(h, other, { to: asker.id, vault: vaultId(9) }), { status: 409, json: { error: 'no-ask' } }, 'another account\'s device');
  // An ask from a device held back after it asked is no ask.
  h.db.sqlite.prepare('UPDATE device SET pending = 1 WHERE id = ?').run(asker.id);
  assert.deepEqual(await offer(h, owner, { to: asker.id }), { status: 409, json: { error: 'no-ask' } });
});

test('a pending device can neither ask nor approve', async () => {
  const h = harness();
  const { owner } = await setup(h);
  const pending = await addDevice(h.db, { id: 'pending-dev', account: accountOf(h, owner.id), pending: 1 });
  assert.equal((await h.call(await signed(h.call, pending, '/pair/take', {}))).status, 401);
  assert.equal((await h.call(await signed(h.call, pending, '/pair/offer', { to: owner.id, vault: V1, envelope: ENVELOPE, pin: PIN }))).status, 401);
});

test('an offer takes the app PIN, in the PIN lockout, and a wrong one puts nothing up', async () => {
  const h = harness();
  const { owner, asker } = await setup(h);
  await take(h, asker);
  assert.deepEqual(await offer(h, owner, { to: asker.id, pin: WRONG_PIN }), { status: 401, json: { error: 'bad-pin' } });
  assert.deepEqual(await take(h, asker), NONE, 'nothing was put up');
  const state = JSON.parse(h.db.sqlite.prepare('SELECT state FROM pin_limits WHERE account_id = ?').get(accountOf(h, owner.id)).state);
  assert.ok(state, 'the wrong PIN was counted in the PIN lockout');
  assert.deepEqual(await offer(h, owner, { to: asker.id }), OK, 'NEGATIVE CONTROL: the right PIN approves');
});

test('an offer asks for the code once the approving device\'s last code is 12 hours old', async () => {
  const h = harness();
  const { owner, asker } = await setup(h);
  h.clock.ms += 12 * 60 * 60 * 1000;
  await take(h, asker);
  assert.deepEqual(await offer(h, owner, { to: asker.id }), { status: 401, json: { error: 'code-needed' } });
  assert.deepEqual(await offer(h, owner, { to: asker.id, ticket: await ticketFor(h, owner) }), OK);
});

test('a switch drops the envelope in flight, and an offer for the old vault is refused', async () => {
  const h = harness();
  const { owner, asker } = await setup(h);
  await take(h, asker);
  assert.deepEqual(await offer(h, owner, { to: asker.id }), OK);
  assert.deepEqual(await switchVault(h, owner, V2), OK);
  assert.deepEqual(await take(h, asker), NONE, 'the old vault\'s envelope is gone');
  assert.equal(everyRow(h.db).includes(ENVELOPE), false);
  assert.deepEqual(await offer(h, owner, { to: asker.id }), { status: 409, json: { error: 'vault-gone' } });
});

test('an envelope from a device removed after it approved is never taken', async () => {
  const h = harness();
  const { owner, asker } = await setup(h);
  await take(h, asker);
  assert.deepEqual(await offer(h, owner, { to: asker.id }), OK);
  h.db.sqlite.prepare('UPDATE device SET removed_at = ? WHERE id = ?').run(h.clock.ms, owner.id);
  assert.deepEqual(await take(h, asker), NONE);
});

test('an ask and an envelope each live ten minutes', async () => {
  const h = harness();
  const { owner, asker } = await setup(h);
  await take(h, asker);
  h.clock.ms += 10 * 60 * 1000;
  assert.deepEqual(await offer(h, owner, { to: asker.id }), { status: 409, json: { error: 'no-ask' } }, 'a stale ask');
  await take(h, asker);
  assert.deepEqual(await offer(h, owner, { to: asker.id }), OK);
  h.clock.ms += 10 * 60 * 1000;
  assert.deepEqual(await take(h, asker), NONE, 'a stale envelope');
});

test('a take with no vault recorded answers no-vault', async () => {
  const h = harness();
  const owner = { ...(await pinnedDevice(h, ADDRESS, PIN)), email: ADDRESS };
  assert.deepEqual(await take(h, owner), { status: 409, json: { error: 'no-vault' } });
});

test('a malformed offer is refused as shape, before the PIN is compared', async () => {
  const h = harness();
  const { owner, asker } = await setup(h);
  await take(h, asker);
  for (const body of [
    { to: asker.id, envelope: '' }, { to: asker.id, envelope: 'not base64url!' }, { to: asker.id, envelope: 'A'.repeat(4097) },
    { to: asker.id, pin: '12345' }, { to: 'bad id!' }, { to: asker.id, extra: 1 }, { to: asker.id, vault: 'short' },
  ]) {
    assert.deepEqual(await offer(h, owner, body), { status: 400, json: { error: 'shape' } }, JSON.stringify(body));
  }
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM pin_limits').get().n, 0, 'no PIN try was counted');
  assert.deepEqual(await pinCall(h, asker, '/pair/take', { extra: 1 }), { status: 400, json: { error: 'shape' } });
});

test('the brought note carries no number, link, id or value the request carried', async () => {
  const h = harness();
  const { owner, asker } = await setup(h);
  await take(h, asker);
  await offer(h, owner, { to: asker.id });
  const note = h.mail.find((m) => m.subject === BROUGHT_NOTE.subject);
  assert.doesNotMatch(note.text, /\d/);
  assert.doesNotMatch(note.text, /https?:/);
  for (const value of [ENVELOPE, V1, owner.id, asker.id, PIN]) assert.equal(note.text.includes(value), false);
  assert.equal(JSON.stringify(auditRows(h.db)).includes(ENVELOPE), false);
});
