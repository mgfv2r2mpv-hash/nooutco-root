// A6, account recovery (plan §3.5, R-6; slice 8, "A6, recovery and vault
// switch"). Lost authenticator, phone passcode or Mac password: the account
// comes back with the emailed link plus the account password, onto a new
// device, and into a new vault.
//
//   /recover {email}                                      -> {ok: true}   mails the link
//   /recover {email, code, password, signKey, agreeKey}   -> {device}
//
// One write makes the new device the owner device, holds back and demotes
// every other device until it proves the new code, clears the old seed (the
// new device enrols a new authenticator), voids every live sign-in ticket,
// tombstones the current vault id and drops every bring in flight. So no old
// vault key can reach the new device through the service, and every old
// device learns at its next launch that its vault is gone.
//
// It also closes the stranded-account residuals of A5: an account whose
// owner device was removed before the first accepted code, and one that never
// registered its owner device, both come back this way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECOVERED_NOTE, RECOVER_LIMITS } from '../src/recover.js';
import {
  harness, post, signed, pinCall, pinnedDevice, provedDevice, switchVault, vaultId, deviceKeys, everyRow, auditRows,
  recoveryCode, recoverRequest, recoveredDevice, signUpOwner, enrolRequest, enrolTicket, tryCode, codeAt, ticketFor,
  verifyVaultState, signIn, PASSWORD, RECOVER_IP, RECOVER_LINK_SUBJECT_TEXT,
} from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses, a PIN off the public list
// and an envelope that is only a marker.
const ADDRESS = 'recover@example.test';
const PIN = '274951';
const ENVELOPE = 'CANARYold-vault-key-sealed-for-the-second-device_0123';
const V1 = vaultId(1);
const V2 = vaultId(2);

const answer = async (res) => ({ status: res.status, json: await res.json() });
const accountOf = (h, id) => h.db.sqlite.prepare('SELECT account_id FROM device WHERE id = ?').get(id).account_id;
const deviceRow = (h, id) => ({ ...h.db.sqlite.prepare('SELECT owner, pending, removed_at FROM device WHERE id = ?').get(id) });
const recoveryLinks = (h, email) => h.mail.filter((m) => m.to === email && m.subject === RECOVER_LINK_SUBJECT_TEXT);

async function owned(h, email = ADDRESS) {
  return { ...(await pinnedDevice(h, email, PIN)), email };
}

async function enrolOn(h, dev, email) {
  const res = await answer(await h.call(await enrolRequest(h.call, dev, await enrolTicket(h, email, dev))));
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const { base32Decode } = await import('../../../packages/account-engine/src/totp.mjs');
  return { ...dev, seed: base32Decode(res.json.secret) };
}

// ---- plan test ----

test('recovery never returns an old vault key', async () => {
  const h = harness();
  const owner = await owned(h);
  const account = accountOf(h, owner.id);
  assert.equal((await switchVault(h, owner, V1)).status, 200);
  const second = await provedDevice(h, owner);
  // A bring of the old vault is waiting for the second device when the
  // account is recovered.
  assert.equal((await pinCall(h, second, '/pair/take', {})).status, 200);
  assert.deepEqual(await pinCall(h, owner, '/pair/offer', { to: second.id, vault: V1, envelope: ENVELOPE, pin: PIN }), { status: 200, json: { ok: true } });

  const keys = await deviceKeys();
  const code = await recoveryCode(h, ADDRESS);
  const recovered = await answer(await h.call(recoverRequest(ADDRESS, code, keys)));
  assert.equal(recovered.status, 200);
  assert.deepEqual(Object.keys(recovered.json), ['device'], 'the answer is the new device id and nothing else');
  assert.equal(JSON.stringify(recovered.json).includes(ENVELOPE), false);
  assert.equal(everyRow(h.db).includes(ENVELOPE), false, 'the old vault\'s envelope is dropped from every table');
  const fresh = { id: recovered.json.device, key: keys.key, signKey: keys.signKey, agreeKey: keys.agreeKey };

  // The new device asks for the vault: there is no vault to bring until it
  // records a new one, and the old devices are held back, so none can offer.
  assert.deepEqual(await pinCall(h, fresh, '/pair/take', {}), { status: 409, json: { error: 'no-vault' } });
  assert.equal((await h.call(await signed(h.call, second, '/pair/take', {}))).status, 401, 'the old second device is held back');
  assert.equal((await h.call(await signed(h.call, owner, '/pair/offer', { to: fresh.id, vault: V1, envelope: ENVELOPE, pin: PIN }))).status, 401, 'the old owner device is held back');
  // Every old device learns at its next launch that the old vault is gone.
  for (const dev of [owner, second]) {
    const res = await pinCall(h, dev, '/vault/state', { vault: V1 });
    const claims = await verifyVaultState(res.json.state, { account, device: dev.id, now: h.clock.ms });
    assert.equal(claims.state, 'gone');
    assert.equal(claims.current, null);
  }
  // Once the new device has its new code and records a new vault, the old id
  // can never be made current again, so nothing sealed for it is ever carried.
  const enrolled = await enrolOn(h, fresh, ADDRESS);
  await ticketFor(h, enrolled);
  assert.deepEqual(await switchVault(h, enrolled, V1), { status: 409, json: { error: 'vault-used' } });
  assert.deepEqual(await switchVault(h, enrolled, V2), { status: 200, json: { ok: true } });
});

// ---- the two factors ----

test('a recovery needs the emailed link and the password, never one', async () => {
  const h = harness();
  const owner = await owned(h);
  const keys = await deviceKeys();
  // No link at all.
  assert.deepEqual(await answer(await h.call(recoverRequest(ADDRESS, 'A'.repeat(22), keys))), { status: 401, json: { error: 'bad-code' } });
  // The link with a wrong password spends the link and changes nothing.
  const code = await recoveryCode(h, ADDRESS);
  assert.deepEqual(await answer(await h.call(recoverRequest(ADDRESS, code, keys, { password: 'not the account password at all' }))), { status: 401, json: { error: 'bad-login' } });
  assert.deepEqual(await answer(await h.call(recoverRequest(ADDRESS, code, keys))), { status: 401, json: { error: 'bad-code' } }, 'the link was spent');
  assert.deepEqual(deviceRow(h, owner.id), { owner: 1, pending: 0, removed_at: null }, 'the owner device is untouched');
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM otp').get().n, 1, 'the seed is untouched');
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM device').get().n, 1);
});

test('NEGATIVE CONTROL: the link and the password together recover', async () => {
  const h = harness();
  await owned(h);
  const dev = await recoveredDevice(h, ADDRESS);
  assert.deepEqual(deviceRow(h, dev.id), { owner: 1, pending: 0, removed_at: null });
});

test('a recovery link is single use, and two recoveries sent together register one device', async () => {
  const h = harness();
  await owned(h);
  const code = await recoveryCode(h, ADDRESS);
  const [a, b] = await Promise.all([
    h.call(recoverRequest(ADDRESS, code, await deviceKeys())),
    h.call(recoverRequest(ADDRESS, code, await deviceKeys())),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 401]);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM device WHERE owner = 1').get().n, 1);
});

// ---- what the recovery changes ----

test('after a recovery the new device is the owner, and every other device is held back until it proves the new code', async () => {
  const h = harness();
  const owner = await owned(h);
  const second = await provedDevice(h, owner);
  const fresh = await recoveredDevice(h, ADDRESS);
  assert.deepEqual(deviceRow(h, owner.id), { owner: 0, pending: 1, removed_at: null });
  assert.deepEqual(deviceRow(h, second.id), { owner: 0, pending: 1, removed_at: null });
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM otp').get().n, 0, 'the old seed is gone');
  // The old devices reach nothing but /nonce, /unlock and the vault state,
  // and have no code to prove until the new device confirms one.
  for (const p of ['/otp/enrol', '/device/remove', '/pin/verify', '/vault/switch', '/devices']) {
    assert.equal((await h.call(await signed(h.call, owner, p, {}))).status, 401, p);
  }
  assert.deepEqual((await tryCode(h, owner, await codeAt(owner, h.clock.ms))).start, { status: 409, json: { error: 'not-enrolled' } });
  // The new device enrols a new authenticator and confirms it.
  const enrolled = await enrolOn(h, fresh, ADDRESS);
  assert.equal((await tryCode(h, enrolled, await codeAt(enrolled, h.clock.ms))).finish.status, 200);
  h.clock.ms += 30_000;
  // The old seed's code no longer opens anything; the new one does.
  const old = await tryCode(h, second, await codeAt(second, h.clock.ms));
  assert.equal(old.finish.status, 401, 'the old authenticator is refused');
  h.clock.ms += 30_000;
  const proved = await tryCode(h, { ...second, seed: enrolled.seed }, await codeAt(enrolled, h.clock.ms));
  assert.equal(proved.finish.status, 200, 'the new code brings the second device back');
  assert.deepEqual(deviceRow(h, second.id), { owner: 0, pending: 0, removed_at: null });
});

test('a recovery voids every live sign-in ticket and clears the closed code path', async () => {
  const h = harness();
  const owner = await owned(h);
  const account = accountOf(h, owner.id);
  const keys = await deviceKeys();
  const ticket = await signIn(h, ADDRESS, { keys, ip: '192.0.2.44' });
  h.db.sqlite.prepare('INSERT INTO limits (account_id, state, version) VALUES (?, ?, 0)').run(account, '{"closed":"by hand"}');
  await recoveredDevice(h, ADDRESS);
  assert.equal((await h.call(post('/device/register', { ticket, signKey: keys.signKey, agreeKey: keys.agreeKey }))).status, 401, 'the old sign-in ticket registers nothing');
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM limits WHERE account_id = ?').get(account).n, 0);
});

test('the PIN, the admin role and a locked account are not lifted by a recovery', async () => {
  const h = harness();
  const owner = await owned(h);
  const account = accountOf(h, owner.id);
  h.db.sqlite.prepare("INSERT INTO role (account_id, role) VALUES (?, 'admin')").run(account);
  h.db.sqlite.prepare('INSERT INTO account_lock (account_id, locked_at) VALUES (?, ?)').run(account, h.clock.ms);
  const keys = await deviceKeys();
  const code = await recoveryCode(h, ADDRESS);
  assert.deepEqual(await answer(await h.call(recoverRequest(ADDRESS, code, keys))), { status: 423, json: { error: 'account-locked' } });
  assert.deepEqual(deviceRow(h, owner.id), { owner: 1, pending: 0, removed_at: null }, 'a locked account changes nothing');
  h.db.sqlite.prepare('DELETE FROM account_lock').run();
  h.clock.ms += RECOVER_LIMITS.codeTtlMs;
  const fresh = await recoveredDevice(h, ADDRESS);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM pin WHERE account_id = ?').get(account).n, 1, 'the PIN stays');
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM role WHERE account_id = ? AND role = 'admin'").get(account).n, 1, 'the role is the account\'s');
  assert.equal(accountOf(h, fresh.id), account);
});

// ---- stranded accounts (A5 residuals) ----

test('stranded: an account whose owner device was removed before the first accepted code is recovered', async () => {
  const h = harness();
  const keys = await deviceKeys();
  const { account, ticket } = await signUpOwner(h, ADDRESS, { keys });
  assert.equal((await h.call(post('/device/register', { ticket, signKey: keys.signKey, agreeKey: keys.agreeKey }))).status, 200);
  h.db.sqlite.prepare('UPDATE device SET removed_at = ? WHERE account_id = ?').run(h.clock.ms, account);
  h.clock.ms += RECOVER_LIMITS.codeTtlMs;
  const fresh = await recoveredDevice(h, ADDRESS);
  assert.deepEqual(deviceRow(h, fresh.id), { owner: 1, pending: 0, removed_at: null });
  const enrolled = await enrolOn(h, fresh, ADDRESS);
  assert.equal((await tryCode(h, enrolled, await codeAt(enrolled, h.clock.ms))).finish.status, 200, 'the new owner confirms a code');
});

test('stranded: an account that never registered its owner device is recovered', async () => {
  const h = harness();
  await signUpOwner(h, ADDRESS);
  h.clock.ms += RECOVER_LIMITS.codeTtlMs;
  const fresh = await recoveredDevice(h, ADDRESS);
  assert.deepEqual(deviceRow(h, fresh.id), { owner: 1, pending: 0, removed_at: null });
});

// ---- the start ----

test('a recovery start answers the same and runs the same statements whether or not the address has an account', async () => {
  const h = harness();
  await owned(h);
  const run = async (email, ip) => {
    const from = h.db.bound.length;
    const res = await answer(await h.call(post('/recover', { email }, { 'cf-connecting-ip': ip })));
    return { res, sql: h.db.bound.slice(from).map((s) => s.sql) };
  };
  const withAccount = await run(ADDRESS, '192.0.2.50');
  const without = await run('nobody@example.test', '192.0.2.51');
  assert.deepEqual(withAccount.res, { status: 200, json: { ok: true } });
  assert.deepEqual(without.res, withAccount.res);
  assert.deepEqual(without.sql, withAccount.sql);
  assert.equal(recoveryLinks(h, ADDRESS).length, 1, 'only the account\'s address is mailed');
  assert.equal(recoveryLinks(h, 'nobody@example.test').length, 0);
});

test('a recovery start keeps one live link at a time and re-sends it inside the cap', async () => {
  const h = harness();
  await owned(h);
  for (let i = 0; i < 6; i += 1) await h.call(post('/recover', { email: ADDRESS }, { 'cf-connecting-ip': `198.51.100.${i}` }));
  const codes = recoveryLinks(h, ADDRESS).map((m) => new URL(m.text.match(/https:\/\/\S+/)[0]).hash.slice(1));
  assert.equal(codes.length, 1 + RECOVER_LIMITS.resendsPerAddressHour);
  assert.equal(new Set(codes).size, 1, 'every mail carries the one live link');
});

test('the recovery mails carry no number, no password, and say what a recovery replaces', async () => {
  const h = harness();
  await owned(h);
  const fresh = await recoveredDevice(h, ADDRESS);
  const [link] = recoveryLinks(h, ADDRESS);
  const notice = h.mail.find((m) => m.subject === RECOVERED_NOTE.subject);
  assert.ok(link && notice);
  for (const m of [link, notice]) {
    const text = m.text.replace(/https:\/\/\S+/g, '');
    assert.doesNotMatch(text, /\d/, m.subject);
    assert.equal(m.text.includes(PASSWORD), false);
    assert.equal(m.text.includes(fresh.id), false);
    assert.equal(`${m.subject}${m.text}`.includes(String.fromCharCode(0x2014)), false, 'no em dash');
  }
  assert.match(link.text, /vault/i, 'the link mail warns that the old vault goes');
  assert.equal(notice.text.includes('https://'), false, 'the notice carries no link');
});

test('a recovery request is refused as shape before anything is counted', async () => {
  const h = harness();
  await owned(h);
  const keys = await deviceKeys();
  const good = { email: ADDRESS, code: 'A'.repeat(22), password: PASSWORD, signKey: keys.signKey, agreeKey: keys.agreeKey };
  for (const body of [
    { ...good, code: 'short' }, { ...good, signKey: 'AAAA' }, { ...good, agreeKey: keys.signKey.slice(0, 20) },
    { ...good, password: '' }, { ...good, extra: 1 }, { email: 'not an address' }, { email: ADDRESS, code: good.code },
  ]) {
    assert.deepEqual(await answer(await h.call(post('/recover', body, { 'cf-connecting-ip': RECOVER_IP }))), { status: 400, json: { error: 'shape' } }, JSON.stringify(Object.keys(body)));
  }
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM throttle WHERE bucket LIKE 'recover%'").get().n, 0);
  assert.deepEqual(await answer(await h.call(post('/recover', { email: ADDRESS }))), { status: 400, json: { error: 'shape' } }, 'no connecting address');
});

test('recovery tries are capped per connecting address', async () => {
  const h = harness();
  await owned(h);
  const keys = await deviceKeys();
  const statuses = [];
  for (let i = 0; i <= RECOVER_LIMITS.triesPerAddressRequesterHour; i += 1) {
    statuses.push((await h.call(recoverRequest(ADDRESS, 'B'.repeat(22), keys))).status);
  }
  assert.equal(statuses.at(-1), 429);
  assert.ok(auditRows(h.db).some((r) => r.route === '/recover' && r.reason === 'slow-down'));
});
