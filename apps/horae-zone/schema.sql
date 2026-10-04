-- Horae Zone, the nooutco account service. A2: what the route checks use.
-- A3: accounts, email-code challenges and rate-limit rows. A4: a device's
-- agreement key and sign-in tickets. A5: the sealed seed, code exchanges,
-- the code-path lockout and a device's pending flag. No database has been
-- made from this file yet, so A4 and A5 change the device table in place;
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
-- starts pending, code or no code.
CREATE TABLE IF NOT EXISTS device (
  id          TEXT    PRIMARY KEY,
  account_id  TEXT    NOT NULL,
  sign_key    TEXT    NOT NULL,
  agree_key   TEXT,
  created_at  INTEGER NOT NULL,
  removed_at  INTEGER,
  pending     INTEGER NOT NULL DEFAULT 1,
  owner       INTEGER NOT NULL DEFAULT 0
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
-- spent (M1, security review), so both paths do the same write.
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
