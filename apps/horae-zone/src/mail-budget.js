/**
 * One daily mail budget across every Horae Zone sender (PR #324, Pollux's
 * review MEDIUM, 9 Oct 2026).
 *
 * The Resend account is on the free plan (Kaleb, 9 Oct 2026): 3,000 a month,
 * which Resend enforces as 100 a day. Past that Resend drops mail, security
 * notices included. Sign-up and recovery each had a day cap of their own, and
 * the notices and the operator alert had none, so together they could pass
 * the plan's day.
 *
 * Every send through Resend now takes one place in MAIL_BUCKET, one sliding
 * 24-hour count in the throttle table (src/throttle.js), whoever sends it.
 * Each sender may take a place only while the count is under its tier's
 * ceiling, a share of the day's budget (HZ_MAIL_PER_DAY, default 100):
 *
 *   signup   70 percent: a sign-up start, counted when the start is admitted
 *   recovery 90 percent: a recovery start, counted when the start is admitted
 *   notice  100 percent: every notice (lock, removal, offline, PIN, code path,
 *                        recovery done, vault switch) and the operator alert,
 *                        counted as each one is sent
 *
 * So a sign-up flood stops at 70 and never starves a recovery, and neither
 * ever starves a security notice. The per-feature buckets still apply.
 *
 * A start's place is taken in the same all-or-none statement as its own caps
 * (admitThrottle), so two starts together cannot both take the last place and
 * a refused start takes none; its link mail is then sent without a second
 * place (budgetedMailer's `paid`). A start that mails nothing (an address
 * with an account, or a re-send past its hour) keeps its place, as the
 * sign-up and recovery day caps already count it.
 *
 * A notice refused at the ceiling is not sent, does not throw into the action
 * it tells about, and is audited as MAIL_REFUSED_REASON on its route: a closed
 * word, with no address and no account id.
 */
import { Refusal } from "./checks.js";
import { admitThrottle } from "./throttle.js";

export const MAIL_BUCKET = "mail-day";
export const MAIL_DAY_MS = 24 * 60 * 60 * 1000;
// The Resend free plan's day, confirmed by Kaleb on 9 Oct 2026.
export const MAIL_PER_DAY = 100;
// Each tier's ceiling, in percent of the day's budget.
export const MAIL_TIERS = Object.freeze({ signup: 70, recovery: 90, notice: 100 });
// The audit word for a send the budget refused.
export const MAIL_REFUSED_REASON = "mail-budget";

// Thrown by a budgeted send that the budget refused. A sender that does not
// know it reads it as any failed send (mail-failed), so it never passes as sent.
export class MailRefused extends Error {
  constructor() {
    super("mail budget refused the send");
    this.name = "MailRefused";
  }
}

// A whole number of 1 or more, from a number or a string of digits, or null.
export function wholeFromOne(value) {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

// The day's budget from HZ_MAIL_PER_DAY, the default when unset, or null when
// it is set but is not a whole number of 1 or more.
function perDayOf(env) {
  const value = env.HZ_MAIL_PER_DAY;
  if (value === undefined || value === null) return MAIL_PER_DAY;
  return wholeFromOne(value);
}

export function ceilingOf(perDay, tier) {
  return Math.floor((perDay * MAIL_TIERS[tier]) / 100);
}

// The bucket a sign-up or recovery start adds to its own all-or-none admit.
// A bad HZ_MAIL_PER_DAY stops the start (unavailable) rather than open it,
// as a bad HZ_CODES_PER_DAY does.
export function mailBucketFor(env, tier) {
  const perDay = perDayOf(env);
  if (perDay === null) throw new Refusal("unavailable", 503);
  return { bucket: MAIL_BUCKET, limit: ceilingOf(perDay, tier), windowMs: MAIL_DAY_MS };
}

// The transport every handler gets (src/index.js). Each call takes a notice
// place before it sends and throws MailRefused when none is left. A bad
// HZ_MAIL_PER_DAY falls back to the default, the smallest plan's day, so a
// typo never silences a security notice and never passes the free plan.
// `paid` sends mail whose place a start's admit already took.
export function budgetedMailer({ db, env, now, mailer }) {
  const limit = ceilingOf(perDayOf(env) ?? MAIL_PER_DAY, "notice");
  const send = async (message) => {
    const admitted = await admitThrottle(db, now, MAIL_DAY_MS, [{ bucket: MAIL_BUCKET, limit }]);
    if (!admitted) throw new MailRefused();
    return mailer(message);
  };
  send.paid = (message) => mailer(message);
  return send;
}

// The mail a start already paid for: its admit took the place.
export const paidSend = (mailer) => mailer.paid ?? mailer;

// One send, as the audit word for its failure: null when sent, the budget's
// word when the budget refused it, `failed` when it failed or threw.
export async function sendReason(mailer, message, failed = "mail-failed") {
  try {
    return (await mailer(message)) ? null : failed;
  } catch (err) {
    return err instanceof MailRefused ? MAIL_REFUSED_REASON : failed;
  }
}
