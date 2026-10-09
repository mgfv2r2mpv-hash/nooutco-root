-- Horae Zone, the nooutco account service. A2: what the route checks use.
-- A3: accounts, email-code challenges and rate-limit rows. A4: a device's
-- agreement key and sign-in tickets. A5: the sealed seed, code exchanges,
-- the code-path lockout and a device's pending flag. The device list: when a
-- device was confirmed. No database has been made from this file yet, so A4,
-- A5 and the device list change the device table in place;
-- once one exists, later slices add their tables as additive migrations.
--
-- WHAT MAY NOT GO IN HERE: a request body, a code, a seed in the clear, a PIN,
-- vault or session keys, or PHI. Columns hold opaque ids, public keys,
-- timestamps and closed reason words. test/config.test.mjs checks the column
-- names; treat "is this column content-free?" as a review gate on every
-- migration.

-- A device's public P-256 signing key and agreement key (raw uncompressed
-- points, base64url). The private halves never leave the device's Secure
-- Enclave. A removed device keeps its row, stamped removed_at, and every
-- route refuses it. A5: pending is 1 for a device that has not proved the
-- account's code yet; it reaches only /nonce and /unlock. A5 re-review:
-- owner is 1 for the account's first device, the one the sign-up link's
-- ticket registered; it starts not pending. Every device registered after it
-- starts pending, code or no code. The device list: confirmed_at is when the
-- device stopped being pending (the owner device's registration, or the code
-- that cleared the flag), the moment the signed list (src/device-list.js)
-- names; null while it never has.
CREATE TABLE IF NOT EXISTS device (
  id          TEXT    PRIMARY KEY,
  account_id  TEXT    NOT NULL,
  sign_key    TEXT    NOT NULL,
  agree_key   TEXT,
  created_at  INTEGER NOT NULL,
  removed_at  INTEGER,
  pending     INTEGER NOT NULL DEFAULT 1,
  owner       INTEGER NOT NULL DEFAULT 0,
  confirmed_at INTEGER
);

CREATE INDEX IF NOT EXISTS device_account_id ON device (account_id);

-- Single-use challenges a device signs over. Spent or expired rows are
-- refused, and the hourly scheduled purge deletes them (src/retention.js).
CREATE TABLE IF NOT EXISTS nonce (
  value       TEXT    PRIMARY KEY,
  device_id   TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS nonce_expires_at ON nonce (expires_at);
CREATE INDEX IF NOT EXISTS nonce_device_id ON nonce (device_id, used, expires_at);

CREATE TABLE IF NOT EXISTS role (
  account_id  TEXT    NOT NULL,
  role        TEXT    NOT NULL,            -- closed list: 'admin'
  PRIMARY KEY (account_id, role)
);

-- One row per request: which route (or 'unknown') and the closed reason word
-- it ended with. Never a path as sent, a header, a body or a value. Kept 6
-- years (the HIPAA documentation retention period), then purged.
CREATE TABLE IF NOT EXISTS audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  route       TEXT    NOT NULL,
  reason      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_at ON audit (at);

-- A3, account + email. An account is filed under its address key (an HMAC of
-- the lowercased address under a key derived from HZ_ACCOUNT_KEY); the
-- address itself is only in address_box, sealed with AES-GCM bound to that
-- key. The login hash is "pbkdf2-sha256$<iterations>$<hex>", peppered with a
-- derived key, over a random per-account salt (src/account-keys.js).
CREATE TABLE IF NOT EXISTS account (
  id           TEXT    PRIMARY KEY,
  address_key  TEXT    NOT NULL UNIQUE,
  address_box  TEXT    NOT NULL,
  login_hash   TEXT    NOT NULL,
  login_salt   TEXT    NOT NULL,
  created_at   INTEGER NOT NULL
);

-- Sign-up challenges: the keyed digest of each emailed code, which a try is
-- checked against, and the code sealed in link_box (AES-GCM under a key
-- derived from HZ_ACCOUNT_KEY, bound to the address key), so a start at the
-- per-address cap can mail the newest live link again (second security
-- review, item 3). Never the code in the clear; the box is dropped when the
-- code is spent. Up to five per address are live at once and a newer one
-- never replaces an older one (H1, security review); tries are counted per
-- row as a record only. Spent and expired rows are refused and purged
-- hourly. A start for an address that has an account writes a row born
-- spent (M1, security review), so both paths do the same write; an account
-- that has never had a device, removed ones included, gets a live row
-- (MEDIUM-1, final A5 re-review).
CREATE TABLE IF NOT EXISTS challenge (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  address_key  TEXT    NOT NULL,
  digest       TEXT    NOT NULL,
  link_box     TEXT,
  expires_at   INTEGER NOT NULL,
  tries        INTEGER NOT NULL DEFAULT 0,
  used         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS challenge_address_key ON challenge (address_key);

-- Rate-limit rows: a closed prefix and a keyed hash, and when. Rows past the
-- window are purged hourly (src/throttle.js, src/retention.js).
CREATE TABLE IF NOT EXISTS throttle (
  bucket       TEXT    NOT NULL,
  at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS throttle_bucket_at ON throttle (bucket, at);

-- A4, sign-in tickets: only the keyed digest of a ticket /signin handed out,
-- bound to its account and to the SHA-256 digest of the two public keys it
-- may register (key_digest, security review M3). A ticket registers one
-- device and dies after a few minutes; spent and expired rows are purged
-- hourly. A5 re-review: owner is 1 for the ticket the sign-up link's verify
-- handed out, the only kind that registers an owner device, and only while
-- the account has no device.
CREATE TABLE IF NOT EXISTS ticket (
  digest       TEXT    PRIMARY KEY,
  account_id   TEXT    NOT NULL,
  key_digest   TEXT    NOT NULL,
  expires_at   INTEGER NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0,
  owner        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ticket_expires_at ON ticket (expires_at);

-- A5, the one authenticator code. The seed is stored only in box, sealed with
-- AES-GCM under a key derived from the Worker secret HZ_SEED_KEY and bound to
-- the account id (src/otp.js). last_step is the newest 30-second step whose
-- code was accepted; no step at or before it is offered again, so a code is
-- accepted once. A5 security review item 3: until the first accepted code
-- the enrolment is unconfirmed (confirmed_by is null) and the owner device
-- may enrol again, which replaces box and counts enrolment up, so an
-- exchange started on the old seed no longer matches. confirmed_by is the
-- device whose code confirmed it, the owner device (A5 re-review, item 2).
CREATE TABLE IF NOT EXISTS otp (
  account_id   TEXT    PRIMARY KEY,
  box          TEXT    NOT NULL,
  last_step    INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  enrolment    INTEGER NOT NULL DEFAULT 1,
  confirmed_by TEXT
);

-- The confirmation and the pending flags move together: the statement that
-- sets confirmed_by (the first accepted code, src/unlock.js) holds back every
-- other live device of the account in the same write, so no device is left
-- unheld by a Worker that stops between two statements.
CREATE TRIGGER IF NOT EXISTS otp_confirmed AFTER UPDATE OF confirmed_by ON otp
WHEN OLD.confirmed_by IS NULL AND NEW.confirmed_by IS NOT NULL
BEGIN
  UPDATE device SET pending = 1 WHERE account_id = NEW.account_id AND id <> NEW.confirmed_by AND removed_at IS NULL;
END;

-- A5, one CPace exchange per /unlock/start, finished once by the device that
-- started it. candidates holds only keyed digests of the tags the service
-- expects (with the step each would accept), never a tag or a code, and the
-- enrolment it was built on. Spent and expired rows are purged hourly.
CREATE TABLE IF NOT EXISTS exchange (
  id           TEXT    PRIMARY KEY,
  account_id   TEXT    NOT NULL,
  device_id    TEXT    NOT NULL,
  candidates   TEXT    NOT NULL,
  expires_at   INTEGER NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0,
  enrolment    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS exchange_expires_at ON exchange (expires_at);

-- A5, the code-path lockout per account: the engine's limits.mjs state as
-- JSON (wrong counts per window, unsettled exchanges, locked windows, and
-- only a hash of a reopen link), written by compare-and-swap on version.
-- reopen_hash repeats state.unlock.hash so /unlock/reopen can find the row.
CREATE TABLE IF NOT EXISTS limits (
  account_id   TEXT    PRIMARY KEY,
  state        TEXT    NOT NULL,
  version      INTEGER NOT NULL DEFAULT 0,
  reopen_hash  TEXT
);

CREATE INDEX IF NOT EXISTS limits_reopen_hash ON limits (reopen_hash);

-- A5 security review item 2: one row per code try by a pending device, when
-- it was admitted. A pending device gets a few a day and none of them reach
-- the account's limits row. A5 re-review item 3: account_id lets the pending
-- devices of one account share one daily cap, and a removed device's rows
-- stay counted. Rows older than a day are purged hourly.
CREATE TABLE IF NOT EXISTS pending_try (
  device_id    TEXT    NOT NULL,
  account_id   TEXT    NOT NULL,
  at           INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS pending_try_device_at ON pending_try (device_id, at);
CREATE INDEX IF NOT EXISTS pending_try_account_at ON pending_try (account_id, at);

-- A5b, the PIN (plan §3.4). Every table below is new in A5b and created only
-- IF NOT EXISTS, so the slice adds to a database A5 made and changes none of
-- its tables.

-- One PIN per account, the same on every device, stored only as a slow,
-- peppered verifier: "pbkdf2-sha256$<iterations>$<hex>", PBKDF2 over the PIN
-- with this account's random salt, then HMAC under the PIN pepper, a key HKDF
-- derives from HZ_ACCOUNT_KEY (src/account-keys.js). Never the PIN.
CREATE TABLE IF NOT EXISTS pin (
  account_id   TEXT    PRIMARY KEY,
  verifier     TEXT    NOT NULL,
  salt         TEXT    NOT NULL,
  set_at       INTEGER NOT NULL
);

-- One row per device that has opened with a code: proved_at is the time of
-- the last code that device had accepted and then used, with the PIN, to
-- open (the `at` of the unlock ticket an open spent). It decides when the
-- next open needs the code again (12 hours, src/pin.js). The spent_ticket
-- trigger below is its only writer, so it moves only in the write that spends
-- a ticket.
CREATE TABLE IF NOT EXISTS device_check (
  device_id    TEXT    PRIMARY KEY,
  account_id   TEXT    NOT NULL,
  proved_at    INTEGER NOT NULL
);

-- The unlock tickets an open has spent (A5 security review item 4): the jti,
-- whose device and account, the ticket's `at` and its `exp`. A jti is spent
-- once, in the same write that accepts the ticket; rows past expires_at are
-- purged hourly, since the ticket is refused by then anyway.
CREATE TABLE IF NOT EXISTS spent_ticket (
  jti          TEXT    PRIMARY KEY,
  account_id   TEXT    NOT NULL,
  device_id    TEXT    NOT NULL,
  at           INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS spent_ticket_expires_at ON spent_ticket (expires_at);

-- The spend and the device's code time move together: a ticket spent is the
-- code it proves, for that device, never an earlier one.
CREATE TRIGGER IF NOT EXISTS spent_ticket_proves AFTER INSERT ON spent_ticket
BEGIN
  INSERT INTO device_check (device_id, account_id, proved_at) VALUES (NEW.device_id, NEW.account_id, NEW.at)
  ON CONFLICT (device_id) DO UPDATE SET proved_at = MAX(device_check.proved_at, excluded.proved_at);
END;

-- An account locked by the offline block (plan §3.4 "Offline wrong PINs"):
-- a device that blocked itself after wrong PINs offline reported it, and
-- every device route of the account refuses account-locked until an
-- administrator unlocks it (A5c deletes the row through unlockAccount,
-- src/account-lock.js). No count, PIN or device is kept: the account and
-- when it locked. Never purged by time.
CREATE TABLE IF NOT EXISTS account_lock (
  account_id   TEXT    PRIMARY KEY,
  locked_at    INTEGER NOT NULL
);

-- The account's replaced PINs, each locked from reuse (plan §3.4 "Reuse
-- lock"): the replaced PIN's verifier (a keyed hash under the account's salt,
-- which a change keeps, so a new PIN is checked against every lock with one
-- slow hash) and the moment it may be chosen again. Several can be locked at
-- once; rows past locked_until are purged hourly. Never the PIN.
CREATE TABLE IF NOT EXISTS pin_lock (
  account_id   TEXT    NOT NULL,
  verifier     TEXT    NOT NULL,
  locked_until INTEGER NOT NULL,
  PRIMARY KEY (account_id, verifier)
);

-- Every write that replaces a PIN locks the one it replaced, whether a
-- change, a reset or the annual review's: 365 days from the new PIN's set_at
-- (31536000000 ms, src/pin.js PIN_LIMITS.reuseLockMs, which a test holds
-- equal). A PIN locked again keeps the later lock-until.
CREATE TRIGGER IF NOT EXISTS pin_replaced_locks AFTER UPDATE OF verifier ON pin
WHEN OLD.verifier <> NEW.verifier
BEGIN
  INSERT INTO pin_lock (account_id, verifier, locked_until) VALUES (OLD.account_id, OLD.verifier, NEW.set_at + 31536000000)
  ON CONFLICT (account_id, verifier) DO UPDATE SET locked_until = MAX(pin_lock.locked_until, excluded.locked_until);
END;

-- The online wrong-PIN lockout per account (plan §3.4 "Online wrong PINs:
-- JanusMirror's lockout"): the engine's limits.mjs state as JSON, the code
-- path's shape in its own row, so wrong PINs never close code entry and
-- wrong codes never close PIN entry (src/pin-lockout.js). No PIN or verifier
-- is kept, and of a reopen link only its hash, which /unlock/reopen finds
-- here by reopen_hash.
CREATE TABLE IF NOT EXISTS pin_limits (
  account_id   TEXT    PRIMARY KEY,
  state        TEXT    NOT NULL,
  version      INTEGER NOT NULL DEFAULT 0,
  reopen_hash  TEXT
);

CREATE INDEX IF NOT EXISTS pin_limits_reopen_hash ON pin_limits (reopen_hash);

-- The forgotten-PIN reset's emailed single-use code (plan §3.4 "Forgotten
-- PIN"), one live per account: a newer mail replaces it, a reset that uses
-- it deletes it, and rows past expires_at are purged hourly. Only its keyed
-- digest is kept; the code itself rides in the mailed link's fragment.
CREATE TABLE IF NOT EXISTS pin_reset (
  account_id   TEXT    PRIMARY KEY,
  digest       TEXT    NOT NULL,
  expires_at   INTEGER NOT NULL
);

-- The annual PIN review's schedule (plan §3.4 "Annual review"), only on the
-- server: a row exists once the account snoozed the review this cycle, with
-- how many snoozes and when the review is due again. With no row the review
-- is due 365 days after the PIN's set_at (src/pin-review.js). No PIN is kept.
CREATE TABLE IF NOT EXISTS pin_review (
  account_id   TEXT    PRIMARY KEY,
  snoozes      INTEGER NOT NULL,
  due_at       INTEGER NOT NULL
);

-- Every write that restarts a PIN's age (a change, a reset, the review's
-- change) starts a fresh review cycle: the old cycle's snoozes go with it.
CREATE TRIGGER IF NOT EXISTS pin_restarts_review AFTER UPDATE OF set_at ON pin
WHEN OLD.set_at <> NEW.set_at
BEGIN
  DELETE FROM pin_review WHERE account_id = NEW.account_id;
END;

-- The membership check (plan §3.3 "Offline and revocation"): when each
-- device's last answered /reverify was, so the next one comes no sooner than
-- 5 minutes after it (src/reverify.js), and the admin screen can show
-- reverification (A5c). One row per device; nothing the request carried.
CREATE TABLE IF NOT EXISTS reverify (
  device_id    TEXT    PRIMARY KEY,
  account_id   TEXT    NOT NULL,
  at           INTEGER NOT NULL
);

-- A6, recovery and the vault switch (plan §3.5, R-6), and bringing the vault
-- to a new device (§3.3 "Each further device" step 4). Every table below is
-- new in A6 and created only IF NOT EXISTS, so the slice adds to the live
-- database and changes none of its tables.

-- The account recovery link (plan §3.5): the keyed digest of the code a
-- /recover start mailed, and the code sealed in link_box while it is live, so
-- a later start can mail it again. One row per address key; a start for an
-- address with no account writes a row born spent, so both paths run the
-- same statements (as sign-up's M1). Spent and expired rows are purged hourly.
CREATE TABLE IF NOT EXISTS recovery (
  address_key  TEXT    PRIMARY KEY,
  digest       TEXT    NOT NULL,
  link_box     TEXT,
  expires_at   INTEGER NOT NULL,
  tries        INTEGER NOT NULL DEFAULT 0,
  used         INTEGER NOT NULL DEFAULT 0
);

-- When the account was last recovered (A6 security review MEDIUM-1). A vault
-- id that a device registered before that moment asks about, and that is not
-- the current one, is gone even if it was never recorded: R-6, every vault
-- from before a recovery is shredded. Kept while the account is.
CREATE TABLE IF NOT EXISTS account_recovery (
  account_id   TEXT    PRIMARY KEY,
  at           INTEGER NOT NULL
);

-- The account's current vault id (plan §3.1: Horae Zone holds the current
-- vault id, never a vault key). The id is 16 random bytes a device minted,
-- base64url; one account, one current vault, and no two accounts share one.
-- No row: no vault recorded yet, or a recovery tombstoned the last one.
CREATE TABLE IF NOT EXISTS vault (
  account_id   TEXT    PRIMARY KEY,
  vault_id     TEXT    NOT NULL UNIQUE,
  set_at       INTEGER NOT NULL
);

-- Every vault id a switch or a recovery replaced. A tombstone is permanent:
-- the id is never current again, for any account, so a signed "gone" stays
-- true, and a device that comes back after months still learns to shred its
-- wrap. Never purged by time.
CREATE TABLE IF NOT EXISTS vault_tombstone (
  vault_id     TEXT    PRIMARY KEY,
  account_id   TEXT    NOT NULL,
  at           INTEGER NOT NULL
);

-- Bringing the vault (pairing v2): one row per asking device. /pair/take
-- writes the ask (envelope null); /pair/offer puts up the envelope, the vault
-- key sealed on the approving device to the asker's registered agreement key,
-- which the service never opens; the asker's next /pair/take hands it out and
-- deletes the row. Bound to the vault id current at the ask; a switch or a
-- recovery deletes the account's rows. Rows past expires_at are purged hourly.
CREATE TABLE IF NOT EXISTS handoff (
  device_id    TEXT    PRIMARY KEY,
  account_id   TEXT    NOT NULL,
  vault_id     TEXT    NOT NULL,
  from_device  TEXT,
  envelope     TEXT,
  expires_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS handoff_account_id ON handoff (account_id);

-- Offline passes (offline unlock, Option C, src/offline.js): one row per pass
-- this service signed, so it can refuse a Mac a new pass until the Mac has
-- reported the last one. The pass's jti (the Mac chose it, so it can report a
-- pass whose answer it lost), whose device and account, the code's time it
-- stands on and when it ends, when it was issued and its cap on opens. The
-- report fills reported_at and the two counts the Mac sent. Never the pass,
-- its signature, a PIN or the log's entries. Not purged by time: a Mac's next
-- pass waits on its row. superseded_at is set when a fresh, unspent code
-- re-proves the same Mac while this pass is unreported (a Mac that lost its
-- record, option c): the pass stops holding the Mac back, and reported_at and
-- the counts stay null, since nobody reported them. Nullable, so on an
-- offline_pass table made before it, the deploy's column step
-- (bin/deploy-columns.mjs) adds superseded_at with ALTER TABLE ... ADD COLUMN
-- before the Worker deploys.
CREATE TABLE IF NOT EXISTS offline_pass (
  jti          TEXT    PRIMARY KEY,
  account_id   TEXT    NOT NULL,
  device_id    TEXT    NOT NULL,
  at           INTEGER NOT NULL,
  until        INTEGER NOT NULL,
  issued_at    INTEGER NOT NULL,
  max_opens    INTEGER NOT NULL,
  reported_at  INTEGER,
  opens        INTEGER,
  wrong_tries  INTEGER,
  superseded_at INTEGER
);

CREATE INDEX IF NOT EXISTS offline_pass_unreported ON offline_pass (device_id) WHERE reported_at IS NULL;
