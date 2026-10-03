/**
 * How long Horae Zone keeps what it writes, and the scheduled purge.
 *
 * The owner left the numbers to the agent (2026-10-03: "Whatever is the
 * balance of best but not overdone"), and the agent chose:
 *   auditYears 6        - audit rows are kept 6 years, the HIPAA documentation
 *                         retention period, which this clinical account log
 *                         should meet; the rows are a route and a reason word.
 *   purgeCron hourly    - nonces already die after NONCE_TTL_MS (60 s); the
 *                         hourly purge only clears spent and expired rows.
 * Both are configuration: purgeExpired() takes overrides, and wrangler.toml's
 * [triggers] must carry purgeCron (test/purge.test.mjs checks they agree).
 */

export const RETENTION = Object.freeze({
  auditYears: 6,
  purgeCron: "0 * * * *",
});

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// The same moment `years` calendar years before `now`. A 29 February with no
// match falls back to the 28th, so the cutoff is never later than true.
export function auditCutoff(now, years) {
  const d = new Date(now);
  const year = d.getUTCFullYear() - years;
  const day = Math.min(d.getUTCDate(), daysInMonth(year, d.getUTCMonth()));
  return Date.UTC(year, d.getUTCMonth(), day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

function checkedYears(value) {
  if (!Number.isInteger(value) || value < 1) throw new RangeError("audit retention must be a whole number of years, 1 or more");
  return value;
}

// Spent or expired nonces go (a spent row can never be accepted again, and a
// deleted one is refused the same way), and audit rows older than the cutoff.
export async function purgeExpired(db, now, { auditYears = RETENTION.auditYears } = {}) {
  const cutoff = auditCutoff(now, checkedYears(auditYears));
  await db.batch([
    db.prepare("DELETE FROM nonce WHERE used = 1 OR expires_at <= ?").bind(now),
    db.prepare("DELETE FROM audit WHERE at < ?").bind(cutoff),
  ]);
}
