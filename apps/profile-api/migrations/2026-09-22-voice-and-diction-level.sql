-- The two level tables, for a store created before they existed.
-- Run ONCE per database. It is safe to run again, and the test below says why.
--
-- WHY THIS FILE EXISTS. voice_level and diction_level were added to schema.sql
-- when the write path landed, and no migration was written beside them. A store
-- created from the current schema.sql has them. bt-profiles was created before
-- that and does not, so it carries six tables where the schema has eight.
--
-- WHAT IT COSTS TO SKIP IT. voiceStatements() in src/voice-write.js opens with
-- `SELECT feature, n, sum, sum_sq FROM voice_level`, before it writes anything.
-- Against a store without the table that throws on the first read, so the whole
-- voice write path fails rather than degrading. The live Worker was last
-- deployed on 5 August and predates that code, which is the only reason
-- production is not failing today. THE NEXT profile-api DEPLOY IS WHAT MAKES
-- THIS LIVE, so this file runs BEFORE that deploy and not after it.
--
-- WHY IT IS SAFE TO RUN TWICE. Every statement is IF NOT EXISTS and every one
-- is a copy of the matching line in schema.sql, so a store that already has the
-- tables is unchanged and a store that lacks them ends up identical to a fresh
-- one. Nothing here alters or drops an existing table, and no row is written.
-- Both tables start empty on purpose: a technician with no level rows falls
-- back to the measured house prior, which is the same state as a new hire.

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
