-- Horae Zone, the nooutco account service. A2: what the route checks use.
-- A3: accounts, email-code challenges and rate-limit rows. A4: a device's
-- agreement key and sign-in tickets. No database has been made from this
-- file yet, so A4 adds agree_key to the device table in place; once one
-- exists, later slices add their tables as additive migrations.
--
-- WHAT MAY NOT GO IN HERE: a request body, a code, a seed in the clear, a PIN,
-- vault or session keys, or PHI. Columns hold opaque ids, public keys,
-- timestamps and closed reason words. test/config.test.mjs checks the column
-- names; treat "is this column content-free?" as a review gate on every
-- migration.

-- A device's public P-256 signing key and agreement key (raw uncompressed
-- points, base64url). The private halves never leave the device's Secure
-- Enclave. A removed device keeps its row, stamped removed_at, and every
-- route refuses it.
CREATE TABLE IF NOT EXISTS device (
  id          TEXT    PRIMARY KEY,
  account_id  TEXT    NOT NULL,
  sign_key    TEXT    NOT NULL,
  agree_key   TEXT,
  created_at  INTEGER NOT NULL,
  removed_at  INTEGER
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

-- Sign-up challenges: only the keyed digest of each emailed code, never the
-- code. Up to three per address are live at once and a newer one never
-- replaces an older one (H1, security review); tries are counted per row.
-- Spent, used-up and expired rows are refused and purged hourly. A start for
-- an address that has an account writes a row born spent (M1, security
-- review), so both paths do the same write.
CREATE TABLE IF NOT EXISTS challenge (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  address_key  TEXT    NOT NULL,
  digest       TEXT    NOT NULL,
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
-- hourly.
CREATE TABLE IF NOT EXISTS ticket (
  digest       TEXT    PRIMARY KEY,
  account_id   TEXT    NOT NULL,
  key_digest   TEXT    NOT NULL,
  expires_at   INTEGER NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ticket_expires_at ON ticket (expires_at);
