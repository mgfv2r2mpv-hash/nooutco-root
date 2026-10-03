-- Horae Zone, the nooutco account service. A2 skeleton: only what the route
-- checks use. Later slices add their tables as additive migrations.
--
-- WHAT MAY NOT GO IN HERE: a request body, a code, a seed in the clear, a PIN,
-- vault or session keys, or PHI. Columns hold opaque ids, public keys,
-- timestamps and closed reason words. test/config.test.mjs checks the column
-- names; treat "is this column content-free?" as a review gate on every
-- migration.

-- A device's public P-256 signing key (raw uncompressed point, base64url).
-- The private half never leaves the device's Secure Enclave.
CREATE TABLE IF NOT EXISTS device (
  id          TEXT    PRIMARY KEY,
  account_id  TEXT    NOT NULL,
  sign_key    TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  removed_at  INTEGER
);

-- Single-use challenges a device signs over. Spent or expired rows are
-- refused, and the hourly scheduled purge deletes them (src/retention.js).
CREATE TABLE IF NOT EXISTS nonce (
  value       TEXT    PRIMARY KEY,
  device_id   TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS nonce_expires_at ON nonce (expires_at);

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
