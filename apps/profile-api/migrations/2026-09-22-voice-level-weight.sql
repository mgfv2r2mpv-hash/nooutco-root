-- WHY THIS FILE EXISTS. voice_level gains the engagement-weighted triple beside
-- the raw one: w_n, w_sum, w_sum_sq. src/voice-write.js reads and writes all
-- six from this change on, so a store without the columns throws on the first
-- voice write. Runs AFTER 2026-09-22-voice-and-diction-level.sql, which creates
-- the table, and BEFORE the profile-api deploy that carries this code.
--
-- WHY THE DEFAULT IS ZERO. A row written before this file has no engagement
-- history. src/voice-shrink.js reads the raw triple whenever the weighted one
-- is all zero, so nobody's estimate moves on the deploy; the weighted triple
-- takes over as their next notes arrive.
--
-- SQLite has no ADD COLUMN IF NOT EXISTS. D1 applies each migration file once
-- and records it, which is what keeps this from running twice.
ALTER TABLE voice_level ADD COLUMN w_n      REAL NOT NULL DEFAULT 0;
ALTER TABLE voice_level ADD COLUMN w_sum    REAL NOT NULL DEFAULT 0;
ALTER TABLE voice_level ADD COLUMN w_sum_sq REAL NOT NULL DEFAULT 0;
