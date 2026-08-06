-- Within-section sentence shape. Run ONCE per database.
--
-- schema.sql is written to be re-runnable and uses CREATE TABLE IF NOT EXISTS,
-- so it cannot add a column to a table that already exists. This file does that
-- part, and it is separate for exactly that reason.
--
-- WHAT CHANGES. shape_profile gains two accumulators for the step between
-- section averages, and sum_cv / sum_cv_sq change meaning: they held the
-- variability of the whole note and they now hold the variability INSIDE one
-- section. Those are different quantities, so the rows accumulated under the
-- old meaning are cleared rather than carried forward. A technician whose row
-- is cleared falls back to the measured human baseline until five new notes
-- arrive, which is the same place every technician started yesterday.
--
-- WHY THAT IS CHEAP. The table shipped on 2026-08-05, so it holds at most one
-- day of a measurement we have since shown does not identify a shape.
--
-- RE-RUNNING THIS IS SAFE, and not by luck. SQLite refuses to add a column that
-- already exists, so a second run fails on the first statement and stops before
-- the DELETE. The order below is load bearing: keep the ALTERs first.
--
-- That was checked rather than assumed. Against a local D1 that already had the
-- columns, a second run stops at "duplicate column name: sum_step" and a probe
-- row inserted beforehand was still there afterwards.
--
-- ORDER OF OPERATIONS ON PRODUCTION. This file first, the Worker deploy second.
-- The new code SELECTs sum_step, so deploying first makes every /style-card
-- call fail until the column exists.
--
--   npx wrangler d1 execute bt-profiles --remote \
--     --file apps/profile-api/migrations/2026-08-06-within-section-shape.sql
--   npx wrangler deploy --config apps/profile-api/wrangler.toml
--   npx wrangler d1 execute bt-profiles --remote --command "DELETE FROM shape_profile;"
--
-- The third command is not redundant. Between the first and the second, the
-- OLD Worker is still running and still writing the whole-note figure into
-- sum_cv, so a note generated inside that window lands in the new columns
-- carrying the old meaning. Clearing once more after the deploy closes it. The
-- cost is the same either way: a technician needs five notes to re-earn their
-- own numbers, and until then they get the human baseline.

ALTER TABLE shape_profile ADD COLUMN sum_step REAL NOT NULL DEFAULT 0;
ALTER TABLE shape_profile ADD COLUMN sum_step_sq REAL NOT NULL DEFAULT 0;

DELETE FROM shape_profile;
