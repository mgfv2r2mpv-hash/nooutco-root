-- Key the style card by document class instead of pooling one per person.
--
-- His ruling of 2026-08-06, after asking whether a correction on the SAP tool
-- was reaching his supervision notes. It was. See src/registers.js.
--
-- NOT RUN AUTOMATICALLY. Apply with:
--   npx wrangler d1 execute bt-profiles --remote \
--     --file apps/profile-api/migrations/0001-register-keyed-card.sql
--
-- WHAT HAPPENS TO EXISTING ROWS.
--
-- style_card is NOT migrated, it is dropped and left empty. Every row in it is
-- derived, and the derivation is deterministic from correction_event, which is
-- untouched. Assigning old rows a register would mean guessing which one they
-- came from, and the honest guess is unavailable: the old rows were built from a
-- pool spanning every tool. The next correction any technician makes triggers
-- rebuildCard, which regenerates the whole card correctly under the new key.
-- Deleting derived data that can be recomputed beats keeping data that would be
-- wrong.
--
-- style_card_suppression IS migrated, because it is NOT derived. It records a
-- supervisor's judgement that a rule was out of line with policy, and there is
-- no way to recompute that. Each row is copied into every register the
-- technician has evidence in, which is the conservative direction: a rule the
-- supervisor removed stays removed everywhere until they put it back, rather
-- than quietly returning in a register they never reviewed.

PRAGMA foreign_keys = OFF;

-- ── style_card: drop and let it rebuild ──────────────────────────────────────
DROP TABLE IF EXISTS style_card;

CREATE TABLE style_card (
  kid         TEXT    NOT NULL,
  register    TEXT    NOT NULL,
  feature     TEXT    NOT NULL,
  direction   INTEGER NOT NULL,
  rule        TEXT    NOT NULL,
  evidence    INTEGER NOT NULL,
  confidence  REAL    NOT NULL,
  muted       INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (kid, register, feature)
);

-- ── style_card_suppression: carry the judgement forward ──────────────────────
ALTER TABLE style_card_suppression RENAME TO style_card_suppression_old;

CREATE TABLE style_card_suppression (
  kid      TEXT    NOT NULL,
  register TEXT    NOT NULL,
  feature  TEXT    NOT NULL,
  ts       INTEGER NOT NULL,
  PRIMARY KEY (kid, register, feature)
);

-- The register list is derived from the technician's own correction history, so
-- a suppression only lands where that person could actually grow the rule.
-- CASE mirrors src/registers.js; an unmapped tool falls back to its own id
-- there, and does the same here.
INSERT OR IGNORE INTO style_card_suppression (kid, register, feature, ts)
SELECT s.kid, r.register, s.feature, s.ts
  FROM style_card_suppression_old s
  JOIN (
    SELECT DISTINCT kid,
           CASE tool
             WHEN 'sap'    THEN 'clinical-instrument'
             WHEN 'sup'    THEN 'clinical-narrative'
             WHEN 'assess' THEN 'clinical-narrative'
             WHEN 'parent' THEN 'interpersonal'
             WHEN 'bt'     THEN 'technician-note'
             ELSE COALESCE(tool, 'unknown')
           END AS register
      FROM correction_event
  ) r ON r.kid = s.kid;

DROP TABLE style_card_suppression_old;

PRAGMA foreign_keys = ON;
