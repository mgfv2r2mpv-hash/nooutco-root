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

import { SIGNUP_LIMITS, DAILY_BUCKET, ALERT_BUCKET } from "./signup.js";
import { SIGNIN_LIMITS } from "./signin.js";
import { DAY_MS } from "../../../packages/account-engine/src/limits.mjs";
import { WRONG_BUCKET_PREFIX } from "./pin-reset.js";

export const RETENTION =Object.freeze({
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
// deleted one is refused the same way), spent and expired email
// codes and sign-in tickets likewise, finished and expired code exchanges
// (A5: the lockout counted an unfinished one when its confirm time passed),
// a pending device's tries once a day old (no cap reads them again),
// rate-limit rows at or past the longest window (no count reads them again;
// the daily cap and alert rows, and each account's wrong reset factors (A5b,
// security review LOW-2), after a day), spent unlock tickets past their
// exp (A5b: the ticket is refused by then anyway; the device's code time in
// device_check stays), PIN reuse locks past their lock-until (A5b: that PIN
// may be chosen again, so the row refuses nothing), forgotten-PIN reset codes
// past their life (A5b: refused by then anyway), spent or expired recovery
// links and bring envelopes or asks past their life (A6; a vault tombstone
// is never purged, since it is what tells a device that comes back after
// months to shred its wrap), and audit rows older than the cutoff.
export async function purgeExpired(db, now, { auditYears = RETENTION.auditYears } = {}) {
  const cutoff = auditCutoff(now, checkedYears(auditYears));
  const throttleWindow = Math.max(SIGNUP_LIMITS.windowMs, SIGNIN_LIMITS.windowMs);
  await db.batch([
    db.prepare("DELETE FROM nonce WHERE used = 1 OR expires_at <= ?").bind(now),
    db.prepare("DELETE FROM challenge WHERE used = 1 OR expires_at <= ?").bind(now),
    db.prepare("DELETE FROM ticket WHERE used = 1 OR expires_at <= ?").bind(now),
    db.prepare("DELETE FROM exchange WHERE used = 1 OR expires_at <= ?").bind(now),
    db.prepare("DELETE FROM pending_try WHERE at <= ?").bind(now - DAY_MS),
    db.prepare("DELETE FROM spent_ticket WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM pin_lock WHERE locked_until <= ?").bind(now),
    db.prepare("DELETE FROM pin_reset WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM recovery WHERE used = 1 OR expires_at <= ?").bind(now),
    db.prepare("DELETE FROM handoff WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM throttle WHERE at <= ? AND ((bucket NOT IN (?, ?) AND substr(bucket, 1, ?) <> ?) OR at <= ?)")
      .bind(now - throttleWindow, DAILY_BUCKET, ALERT_BUCKET, WRONG_BUCKET_PREFIX.length, WRONG_BUCKET_PREFIX, now - SIGNUP_LIMITS.dayMs),
    db.prepare("DELETE FROM audit WHERE at < ?").bind(cutoff),
  ]);
}
