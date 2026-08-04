-- Technician style profile store.
--
-- WHAT MAY NOT GO IN HERE: clinical text, note prose, client identifiers, or
-- anything a technician typed. Every column below is a number, a timestamp, a
-- login-code id, or a fixed enum drawn from a closed list in src/features.js.
-- That is the whole reason it is acceptable to keep a durable per-person record
-- at all, so treat "is this column content-free?" as a review gate on any
-- future migration.
--
-- `kid` is the login-code id already carried in the session token. It is an
-- opaque uuid; it is not a name and does not resolve to one without the
-- separate API_PASSWORDS KV record.

CREATE TABLE IF NOT EXISTS technician (
  kid          TEXT PRIMARY KEY,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  note_count   INTEGER NOT NULL DEFAULT 0
);

-- One row per observed correction signal. `feature` and `direction` are the
-- only things carried out of a diff -- never the words that changed.
CREATE TABLE IF NOT EXISTS correction_event (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kid        TEXT    NOT NULL,
  tool       TEXT    NOT NULL,
  ts         INTEGER NOT NULL,
  source     TEXT    NOT NULL,             -- 'revision' | 'manual'
  feature    TEXT    NOT NULL,             -- closed list, see src/features.js
  direction  INTEGER NOT NULL,             -- -1 | 1
  magnitude  REAL    NOT NULL DEFAULT 0    -- 0..1, how pronounced the change was
);

CREATE INDEX IF NOT EXISTS idx_correction_kid_feature
  ON correction_event (kid, feature);
CREATE INDEX IF NOT EXISTS idx_correction_kid_ts
  ON correction_event (kid, ts);

-- The derived card. One row per (technician, feature); rebuilt from
-- correction_event whenever new evidence lands.
CREATE TABLE IF NOT EXISTS style_card (
  kid         TEXT    NOT NULL,
  feature     TEXT    NOT NULL,
  direction   INTEGER NOT NULL,
  rule        TEXT    NOT NULL,            -- rendered from a fixed template
  evidence    INTEGER NOT NULL,            -- how many events support it
  confidence  REAL    NOT NULL,            -- 0..1 agreement among those events
  muted       INTEGER NOT NULL DEFAULT 0,  -- technician switched it off
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (kid, feature)
);

-- Engagement metrics. `data` is JSON, but the Pages worker sanitises every
-- value to a number or boolean before it ever reaches this table.
CREATE TABLE IF NOT EXISTS usage_metric (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  kid   TEXT    NOT NULL,
  tool  TEXT    NOT NULL,
  ts    INTEGER NOT NULL,
  type  TEXT    NOT NULL,
  data  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_kid_ts ON usage_metric (kid, ts);
CREATE INDEX IF NOT EXISTS idx_usage_ts     ON usage_metric (ts);
