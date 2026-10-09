// A6, the vault id and the vault switch (plan §3.5, R-6; slice 8, "A6,
// recovery and vault switch").
//
//   /vault/switch {vault, ticket}  -> {ok: true}
//   /vault/state  {vault}          -> {state}   a signed statement
//
// Horae Zone holds each account's current vault id and the ids it replaced
// (tombstones), never a vault key. A switch records a new id, tombstones the
// old one and drops every bring in flight. A device asks at every launch
// about the vault it holds; a signed "gone" is what makes it shred its wrap,
// and an id the service never recorded is "unknown", never "gone", so no
// answer but a tombstone can make a device shred.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VAULT_SWITCHED_NOTE } from '../src/vault.js';
import {
  harness, pinnedDevice, provedDevice, ticketFor, pinCall, switchVault, vaultId, verifyVaultState,
  verifyDeviceList, verifyUnlockTicket, signWithTicketKey, UNLOCK_TICKET_LABEL_TEXT, auditRows, addDevice, signed,
} from './helpers.mjs';

// Fixed, fake values: a reserved-domain address and a PIN off the public list.
const ADDRESS = 'vault@example.test';
const PIN = '274951';
const V1 = vaultId(1);
const V2 = vaultId(2);
const V3 = vaultId(3);
const OK = { status: 200, json: { ok: true } };

const accountOf = (h, id) => h.db.sqlite.prepare('SELECT account_id FROM device WHERE id = ?').get(id).account_id;
const current = (h, account) => h.db.sqlite.prepare('SELECT vault_id FROM vault WHERE account_id = ?').get(account)?.vault_id ?? null;
const tombstones = (h) => h.db.sqlite.prepare('SELECT vault_id, account_id FROM vault_tombstone ORDER BY vault_id').all().map((r) => ({ ...r }));
const switchNotes = (h) => h.mail.filter((m) => m.subject === VAULT_SWITCHED_NOTE.subject);

async function stateOf(h, device, vault) {
  const res = await pinCall(h, device, '/vault/state', { vault });
  if (res.status !== 200) return res;
  const claims = await verifyVaultState(res.json.state, { account: accountOf(h, device.id), device: device.id, now: h.clock.ms });
  return { status: res.status, claims };
}

async function owned(h) {
  const owner = { ...(await pinnedDevice(h, ADDRESS, PIN)), email: ADDRESS };
  return owner;
}

// ---- plan test ----

test('a switch shreds the old wrap on every device\'s next launch and tombstones its rows', async () => {
  const h = harness();
  const owner = await owned(h);
  const second = await provedDevice(h, owner);
  const account = accountOf(h, owner.id);
  assert.deepEqual(await switchVault(h, owner, V1), OK, 'the first vault is recorded');
  assert.equal(switchNotes(h).length, 0, 'recording the first vault replaces nothing, so no note');
  // A bring for V1 is in flight when the switch lands.
  assert.equal((await pinCall(h, second, '/pair/take', {})).status, 200);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM handoff WHERE account_id = ?').get(account).n, 1);

  assert.deepEqual(await switchVault(h, second, V2), OK, 'any confirmed device may switch after the first code');
  assert.equal(current(h, account), V2);
  assert.deepEqual(tombstones(h), [{ vault_id: V1, account_id: account }], 'the old id is tombstoned');
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM handoff WHERE account_id = ?').get(account).n, 0, 'every bring in flight is dropped');
  assert.equal(switchNotes(h).length, 1, 'the account is told once');
  assert.equal(switchNotes(h)[0].to, ADDRESS);

  // Every device's next launch: the one that switched, and the other, learn
  // that the vault they held is gone, from a statement signed for them.
  for (const dev of [owner, second]) {
    const { status, claims } = await stateOf(h, dev, V1);
    assert.equal(status, 200);
    assert.ok(claims, 'the statement verifies with the pinned ticket key, for this account and this device');
    assert.equal(claims.vault, V1);
    assert.equal(claims.state, 'gone');
    assert.equal(claims.current, V2);
  }
  const now = await stateOf(h, second, V2);
  assert.equal(now.claims.state, 'current');
});

test('a device held back or locked still learns its vault is gone', async () => {
  const h = harness();
  const owner = await owned(h);
  const account = accountOf(h, owner.id);
  await switchVault(h, owner, V1);
  await switchVault(h, owner, V2);
  // A pending device (a password sign-in that never proved the code).
  const pending = await addDevice(h.db, { id: 'pending-dev', account, pending: 1 });
  assert.equal((await stateOf(h, pending, V1)).claims.state, 'gone');
  // A device of an account the offline block locked.
  h.db.sqlite.prepare('INSERT INTO account_lock (account_id, locked_at) VALUES (?, ?)').run(account, h.clock.ms);
  assert.equal((await stateOf(h, owner, V1)).claims.state, 'gone');
  assert.equal((await pinCall(h, owner, '/vault/switch', { vault: V3, ticket: 'x.y' })).json.error, 'account-locked', 'a locked account switches nothing');
});

test('NEGATIVE CONTROL: an id the service never recorded is unknown, never gone', async () => {
  const h = harness();
  const owner = await owned(h);
  await switchVault(h, owner, V1);
  assert.equal((await stateOf(h, owner, V3)).claims.state, 'unknown');
  assert.equal((await stateOf(h, owner, V1)).claims.state, 'current');
  assert.equal((await stateOf(h, owner, null)).claims.state, 'none');
  assert.equal((await stateOf(h, owner, null)).claims.current, V1);
  // Another account's tombstone is not this account's.
  const other = { ...(await pinnedDevice(h, 'vault-other@example.test', PIN)), email: 'vault-other@example.test' };
  await switchVault(h, other, vaultId(7));
  await switchVault(h, other, vaultId(8));
  assert.equal((await stateOf(h, owner, vaultId(7))).claims.state, 'unknown');
});

test('a vault state passes as no ticket and no device list, and a ticket or list passes as no state', async () => {
  const h = harness();
  const owner = await owned(h);
  await switchVault(h, owner, V1);
  const account = accountOf(h, owner.id);
  const { json } = await pinCall(h, owner, '/vault/state', { vault: V1 });
  assert.equal(await verifyUnlockTicket(json.state, { account, device: owner.id, now: h.clock.ms }), null);
  assert.equal(await verifyDeviceList(json.state, { account, now: h.clock.ms }), null);
  const ticket = await ticketFor(h, owner);
  assert.equal(await verifyVaultState(ticket, { account, device: owner.id, now: h.clock.ms }), null);
  const list = (await pinCall(h, owner, '/devices', {})).json.list;
  assert.equal(await verifyVaultState(list, { account, device: owner.id, now: h.clock.ms }), null);
});

// ---- who may switch, and with what ----

test('a switch needs a fresh code of the caller\'s own, and spends it once', async () => {
  const h = harness();
  const owner = await owned(h);
  const second = await provedDevice(h, owner);
  const account = accountOf(h, owner.id);
  assert.deepEqual(await pinCall(h, owner, '/vault/switch', { vault: V1 }), { status: 401, json: { error: 'code-needed' } });
  assert.deepEqual(await pinCall(h, owner, '/vault/switch', { vault: V1, ticket: 'not.a-ticket' }), { status: 401, json: { error: 'bad-ticket' } });
  const others = await ticketFor(h, second);
  assert.deepEqual(await pinCall(h, owner, '/vault/switch', { vault: V1, ticket: others }), { status: 401, json: { error: 'bad-ticket' } });
  const forged = await signWithTicketKey({ v: 1, account, device: owner.id, at: h.clock.ms - 10 * 60_000, exp: h.clock.ms - 1, jti: 'AAAAAAAAAAAAAAAAAAAAAA' }, UNLOCK_TICKET_LABEL_TEXT);
  assert.deepEqual(await pinCall(h, owner, '/vault/switch', { vault: V1, ticket: forged }), { status: 401, json: { error: 'bad-ticket' } }, 'an expired ticket');
  assert.equal(current(h, account), null, 'nothing was recorded');
  const ticket = await ticketFor(h, owner);
  assert.deepEqual(await pinCall(h, owner, '/vault/switch', { vault: V1, ticket }), OK);
  assert.deepEqual(await pinCall(h, owner, '/vault/switch', { vault: V2, ticket }), { status: 401, json: { error: 'bad-ticket' } }, 'a spent ticket switches nothing');
  assert.equal(current(h, account), V1);
});

test('a pending device switches nothing', async () => {
  const h = harness();
  const owner = await owned(h);
  const account = accountOf(h, owner.id);
  await switchVault(h, owner, V1);
  const pending = await addDevice(h.db, { id: 'pending-dev', account, pending: 1 });
  const res = await h.call(await signed(h.call, pending, '/vault/switch', { vault: V2, ticket: 'x.y' }));
  assert.equal(res.status, 401);
  assert.equal(current(h, account), V1);
});

test('a gone vault id is never current again, for this account or another', async () => {
  const h = harness();
  const owner = await owned(h);
  const account = accountOf(h, owner.id);
  await switchVault(h, owner, V1);
  await switchVault(h, owner, V2);
  assert.deepEqual(await switchVault(h, owner, V1), { status: 409, json: { error: 'vault-used' } });
  const other = { ...(await pinnedDevice(h, 'vault-other@example.test', PIN)), email: 'vault-other@example.test' };
  assert.deepEqual(await switchVault(h, other, V1), { status: 409, json: { error: 'vault-used' } }, 'a tombstone of another account');
  assert.deepEqual(await switchVault(h, other, V2), { status: 409, json: { error: 'vault-used' } }, 'another account\'s current vault');
  assert.equal(current(h, account), V2);
});

test('a switch to the current vault changes nothing, spends no code and mails nobody', async () => {
  const h = harness();
  const owner = await owned(h);
  await switchVault(h, owner, V1);
  const ticket = await ticketFor(h, owner);
  const mails = h.mail.length;
  assert.deepEqual(await pinCall(h, owner, '/vault/switch', { vault: V1, ticket }), OK);
  assert.equal(h.mail.length, mails);
  assert.deepEqual(tombstones(h), []);
  assert.deepEqual(await pinCall(h, owner, '/vault/switch', { vault: V2, ticket }), OK, 'the ticket is still unspent');
});

test('a malformed vault id or body is refused as shape before anything is read', async () => {
  const h = harness();
  const owner = await owned(h);
  for (const body of [{}, { vault: 'short' }, { vault: V1, ticket: 1 }, { vault: V1, ticket: 'x.y', extra: 1 }, { vault: null, ticket: 'x.y' }]) {
    assert.deepEqual(await pinCall(h, owner, '/vault/switch', body), { status: 400, json: { error: 'shape' } }, JSON.stringify(body));
  }
  for (const body of [{}, { vault: 'short' }, { vault: V1, extra: 1 }]) {
    assert.deepEqual(await pinCall(h, owner, '/vault/state', body), { status: 400, json: { error: 'shape' } }, JSON.stringify(body));
  }
});

test('the switch note carries no number, link, id or value the request carried', async () => {
  const h = harness();
  const owner = await owned(h);
  await switchVault(h, owner, V1);
  await switchVault(h, owner, V2);
  const [note] = switchNotes(h);
  assert.ok(note);
  assert.doesNotMatch(note.text, /\d/);
  assert.doesNotMatch(note.text, /https?:/);
  for (const value of [V1, V2, owner.id]) assert.equal(note.text.includes(value), false);
  assert.ok(auditRows(h.db).some((r) => r.route === '/vault/switch' && r.reason === 'ok'));
});
