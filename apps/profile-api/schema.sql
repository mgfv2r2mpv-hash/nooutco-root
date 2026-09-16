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
CREATE TABLE IF NOT EXISTS style_card_suppression (
  kid      TEXT    NOT NULL,
  feature  TEXT    NOT NULL,
  ts       INTEGER NOT NULL,
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

-- Sentence shape profile, one row per technician per tool.
--
-- WHY PER TOOL. Mean sentence length is a property of the document class, not
-- of the person: the same author writes about 21 words a sentence in academic
-- prose and 12 in a clinical plan. Storing one mean per technician would learn
-- the average of two things they never actually write. Their variability, on
-- the other hand, barely moves across classes, so the cv columns are
-- effectively personal and sum_len is not.
--
-- WHY TWO VARIABILITY MEASURES RATHER THAN ONE. A single whole-note figure is a
-- mixture of two nearly independent things: how much sentence length moves
-- INSIDE one section, and how far the average moves BETWEEN sections. Across
-- 108 human documents those two correlate at 0.096 with each other, while the
-- whole-note figure correlates 0.448 and 0.384 with them. Storing one number
-- would learn a quantity that does not identify a shape. See src/shape.js.
--
-- WHY THE RUNNING SUMS. Mean and standard deviation are recomputed from the
-- sums on every update, so no per note history is kept. Five accumulators
-- replace an unbounded table, and there is nothing to prune.
--
-- WHAT IS STORED IS FIVE NUMBERS AGAINST AN OPAQUE LOGIN CODE ID. No text, no
-- fragment of text, no length in characters. The maintainer's own framing: all
-- anyone could learn is that some login code writes at a given mean length and
-- variance.
CREATE TABLE IF NOT EXISTS shape_profile (
  kid          TEXT    NOT NULL,
  tool         TEXT    NOT NULL,
  n_notes      INTEGER NOT NULL DEFAULT 0,
  sum_len      REAL    NOT NULL DEFAULT 0,  -- per note mean sentence length
  sum_cv       REAL    NOT NULL DEFAULT 0,  -- per note WITHIN-SECTION CV
  sum_cv_sq    REAL    NOT NULL DEFAULT 0,  -- and its square, for the sd
  sum_step     REAL    NOT NULL DEFAULT 0,  -- per note BETWEEN-SECTION step, over the mean of the section means
  sum_step_sq  REAL    NOT NULL DEFAULT 0,  -- and its square, for the sd
  updated      INTEGER NOT NULL,
  PRIMARY KEY (kid, tool)
);

CREATE INDEX IF NOT EXISTS idx_shape_profile_kid ON shape_profile (kid);

-- Per author level for one voice feature, one row per (technician, tool,
-- feature). This is the author half of the shrinkage in src/voice-shrink.js;
-- the house half lives in src/house-prior.js and is a constant, not a table,
-- because it is a bar and a measured corpus rather than anything anyone here
-- typed.
--
-- WHY PER TOOL, the same reason shape_profile is: a level like average sentence
-- length or how often an actor is named is partly a property of the document
-- class. One row per technician would learn the average of two things they
-- never write.
--
-- WHY RUNNING SUMS. Mean and sd are recomputed from the sums on every read, so
-- there is no per note history, nothing unbounded and nothing to prune. Same
-- three accumulators as shape_profile, one feature at a time.
--
-- `feature` is a name from the closed list in src/house-prior.js. A row whose
-- feature the house holds no prior for is dead weight: housePrior refuses the
-- name and no target is ever built from it.
--
-- WHAT IS STORED IS THREE NUMBERS AGAINST AN OPAQUE LOGIN CODE ID. No text, no
-- fragment of text, no length in characters.
CREATE TABLE IF NOT EXISTS voice_level (
  kid      TEXT    NOT NULL,
  tool     TEXT    NOT NULL,
  feature  TEXT    NOT NULL,          -- closed list, see src/house-prior.js
  n        INTEGER NOT NULL DEFAULT 0,
  sum      REAL    NOT NULL DEFAULT 0,
  sum_sq   REAL    NOT NULL DEFAULT 0,
  updated  INTEGER NOT NULL,
  PRIMARY KEY (kid, tool, feature)
);

CREATE INDEX IF NOT EXISTS idx_voice_level_kid ON voice_level (kid);

-- Which synonym an author reaches for, per meaning. The diction half of slice 5.
--
-- WHAT A ROW IS. `family` is a meaning from the closed list in
-- src/diction-level.js (prompting, mand, elopement and so on). `variant` is a
-- POSITION in that family's synonym list, which lives in the browser at
-- apps/tools/notes/bcba/diction.js. `count` is how many times that author has
-- used it, `notes` how many notes contributed.
--
-- WHY A POSITION AND NOT THE WORD. A word in a column here is clinical text in
-- the store, and the whole shape of this database is that there is none. A
-- word the house dictionary does not hold has no position at all, so it is
-- counted as unknown on the device and never sent.
--
-- WHY `variant` IS A STORED MEANING. Inserting a synonym in the middle of a
-- family in the browser silently rewrites every row here. Append only, and
-- test/diction-level.test.js pins the two sides together.
CREATE TABLE IF NOT EXISTS diction_level (
  kid      TEXT    NOT NULL,
  tool     TEXT    NOT NULL,
  family   TEXT    NOT NULL,          -- closed list, see src/diction-level.js
  variant  INTEGER NOT NULL,          -- position in that family, never a word
  count    INTEGER NOT NULL DEFAULT 0,
  notes    INTEGER NOT NULL DEFAULT 0,
  updated  INTEGER NOT NULL,
  PRIMARY KEY (kid, tool, family, variant)
);

CREATE INDEX IF NOT EXISTS idx_diction_level_kid ON diction_level (kid);
