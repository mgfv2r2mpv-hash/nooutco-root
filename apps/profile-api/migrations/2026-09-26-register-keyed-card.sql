-- style_card and style_card_suppression, re-keyed by register.
-- Run ONCE per database, BEFORE the profile-api deploy that carries the new
-- src/index.js. It is safe to run again, and the section below says why.
--
-- WHY THIS FILE EXISTS. Both tables were keyed (kid, feature), so a technician
-- had one pool of learned rules across every note type and a correction made on
-- the SAP tool changed how their supervision notes were written. Kaleb ruled on
-- 2026-08-06 that the pool is per register, the document class a tool writes
-- in, and src/registers.js holds the map. A register is now half of each
-- primary key, so the tables have to be rebuilt rather than altered: SQLite
-- cannot add a column to a primary key in place.
--
-- WHAT IT COSTS TO SKIP IT. Every read and write in src/index.js names the
-- register column. Against a store without it the first statement throws, so
-- the card path fails rather than degrading. THE DEPLOY IS WHAT MAKES THIS
-- LIVE, so this file runs BEFORE that deploy and not after it.
--
-- WHY THE CARD IS DROPPED AND NOT MIGRATED. Every style_card row is derived:
-- rebuildCard recomputes it from correction_event, which has carried a `tool`
-- column all along. Assigning a register to an existing row would mean guessing
-- which document class the evidence came from, and a wrong guess does not
-- announce itself - it teaches a rule into the wrong pool and looks exactly
-- like a rule someone earned. Dropping it costs one rebuild and guesses
-- nothing. A technician sees their card repopulate as evidence lands, which is
-- the same state as a new hire.
--
-- WHY THE SUPPRESSIONS ARE MIGRATED AND NOT DROPPED. A removal is not derived.
-- It is a supervisor's judgement that a rule is out of line with company or
-- best practice policy, made in supervision, and nothing recomputes it. Drop
-- the table and every removed rule quietly comes back the moment the evidence
-- rebuilds.
--
-- WHY EACH ONE IS COPIED INTO EVERY REGISTER. An old suppression was made when
-- the card was global, so the rule it removed was off everywhere, and that is
-- the state the supervisor left the technician in. Narrowing it to one register
-- would silently switch the rule back on for every other document class,
-- without anyone re-judging it. Widening is the reversible direction: a
-- supervisor can lift a suppression they no longer want, and the tool shows
-- them the rule is off. The other way round, nobody is told.
--
-- WHY IT IS SAFE TO RUN TWICE. The card is recreated empty from schema.sql, so
-- a second run drops an already-rebuilt card and it rebuilds again: the same
-- end state, at the cost of one rebuild.
--
-- The suppressions are safe for a less obvious reason, so it is worth stating
-- rather than trusting. On a second run the source table already carries a
-- register column, and the CROSS JOIN ignores it, so every existing row is
-- re-emitted once per register: three judgements become twelve candidate rows
-- and then forty-eight. Every one of them collides on (kid, register, feature),
-- which is why the statement is INSERT OR IGNORE and not INSERT. The result is
-- the same twelve rows with their original timestamps. Checked on a scratch
-- database rather than reasoned about: run once gives 12 rows from 3, run twice
-- gives 12, and MIN(ts) is unchanged. No suppression is lost on either path.

-- ── style_card: dropped, rebuilt by the first correction that lands ────────
DROP TABLE IF EXISTS style_card;

CREATE TABLE IF NOT EXISTS style_card (
  kid         TEXT    NOT NULL,
  register    TEXT    NOT NULL,            -- document class, from registers.js
  feature     TEXT    NOT NULL,
  direction   INTEGER NOT NULL,
  rule        TEXT    NOT NULL,            -- rendered from a fixed template
  evidence    INTEGER NOT NULL,            -- how many events support it
  confidence  REAL    NOT NULL,            -- 0..1 agreement among those events
  muted       INTEGER NOT NULL DEFAULT 0,  -- technician switched it off
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (kid, register, feature)
);

-- ── style_card_suppression: judgement carried across, into every register ──
CREATE TABLE IF NOT EXISTS style_card_suppression_next (
  kid       TEXT    NOT NULL,
  register  TEXT    NOT NULL,
  feature   TEXT    NOT NULL,
  ts        INTEGER NOT NULL,
  PRIMARY KEY (kid, register, feature)
);

-- The four document classes in src/registers.js. Written out rather than read
-- from the module, because a migration runs against the database on its own and
-- cannot import anything. If a register is added there, it is added here too,
-- and test/registers.test.js is what makes a missing one an error.
INSERT OR IGNORE INTO style_card_suppression_next (kid, register, feature, ts)
SELECT s.kid, r.register, s.feature, s.ts
FROM style_card_suppression s
CROSS JOIN (
  SELECT 'clinical-instrument' AS register
  UNION ALL SELECT 'clinical-narrative'
  UNION ALL SELECT 'interpersonal'
  UNION ALL SELECT 'technician-note'
) r;

DROP TABLE IF EXISTS style_card_suppression;
ALTER TABLE style_card_suppression_next RENAME TO style_card_suppression;
