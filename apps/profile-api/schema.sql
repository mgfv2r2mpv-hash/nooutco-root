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

-- The derived card. One row per (technician, register, feature); rebuilt from
-- correction_event whenever new evidence lands.
--
-- WHY REGISTER IS IN THE KEY. It was (kid, feature) until 2026-08-06, which
-- meant one pool per person across every note type: a correction made on the
-- SAP tool shaped the technician's supervision notes too. His ruling was to key
-- it by document class rather than by tool, for the same reason shape_profile is
-- per tool -- a writing habit belongs to the class of document, not to the
-- person. Per tool was the other candidate and was rejected because it
-- fragments the evidence too finely to ever clear the bar. See src/registers.js
-- for the map and the numbers behind that choice.
CREATE TABLE IF NOT EXISTS style_card (
  kid         TEXT    NOT NULL,
  register    TEXT    NOT NULL,            -- document class, see src/registers.js
  feature     TEXT    NOT NULL,
  direction   INTEGER NOT NULL,
  rule        TEXT    NOT NULL,            -- rendered from a fixed template
  evidence    INTEGER NOT NULL,            -- how many events support it
  confidence  REAL    NOT NULL,            -- 0..1 agreement among those events
  muted       INTEGER NOT NULL DEFAULT 0,  -- technician switched it off
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (kid, register, feature)
);

-- Rules a supervisor has removed, because they are not in line with company or
-- best practice policy.
--
-- It is a SEPARATE table, not a column on style_card, and that is the whole
-- point of it. rebuildCard deletes any style_card row whose evidence falls
-- below the bar, so a flag living there would be wiped by the next rebuild and
-- the rule would quietly come back. Suppression has to outlive the derived row
-- it suppresses.
--
-- Nothing here is shown to the technician. The removal is a supervision matter,
-- reviewed in supervision; the tool simply stops applying the rule.
-- Carries `register` for the same reason style_card does: "prefer contractions"
-- can be wrong in a clinical instrument and right in a parent training note, so
-- a removal has to name which one the supervisor was looking at.
CREATE TABLE IF NOT EXISTS style_card_suppression (
  kid      TEXT    NOT NULL,
  register TEXT    NOT NULL,
  feature  TEXT    NOT NULL,
  ts       INTEGER NOT NULL,
  PRIMARY KEY (kid, register, feature)
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

-- Sentence shape profile, one row per technician per tool.
--
-- WHY PER TOOL. Mean sentence length is a property of the document class, not
-- of the person: the same author writes 20.9 words a sentence in academic prose
-- and 13.0 in a clinical plan. Storing one mean per technician would learn the
-- average of two things they never actually write. Their variability, on the
-- other hand, barely moves across classes, so cv_mean is effectively personal
-- and mean_len is not.
--
-- WHY THE RUNNING SUMS. Mean and standard deviation are recomputed from
-- sum_cv and sum_cv_sq on every update, so no per note history is kept. Three
-- accumulators replace an unbounded table, and there is nothing to prune.
--
-- WHAT IS STORED IS THREE NUMBERS AGAINST AN OPAQUE LOGIN CODE ID. No text, no
-- fragment of text, no length in characters. The maintainer's own framing: all
-- anyone could learn is that some login code writes at a given mean length and
-- variance.
CREATE TABLE IF NOT EXISTS shape_profile (
  kid        TEXT    NOT NULL,
  tool       TEXT    NOT NULL,
  n_notes    INTEGER NOT NULL DEFAULT 0,
  sum_len    REAL    NOT NULL DEFAULT 0,   -- running sum of per note mean sentence length
  sum_cv     REAL    NOT NULL DEFAULT 0,   -- running sum of per note CV
  sum_cv_sq  REAL    NOT NULL DEFAULT 0,   -- running sum of CV squared, for the sd
  updated    INTEGER NOT NULL,
  PRIMARY KEY (kid, tool)
);

CREATE INDEX IF NOT EXISTS idx_shape_profile_kid ON shape_profile (kid);
