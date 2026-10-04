/**
 * A5b, the annual PIN review, server side (plan §3.4 "Annual review").
 *
 *   /pin/review {}                  -> {review: false}
 *                                   |  {review: true, actions: ["Snooze", "Change PIN"]}
 *   /pin/review {action: "Snooze"}  -> {ok: true, review: false}   only while due
 *
 * 365 days after the PIN was set, the next login shows one modal with
 * exactly the two actions, in that order. The app asks after an accepted
 * open; the review answers only whether it is due and what the modal offers,
 * never when or how many, so the schedule lives only here.
 *
 * SNOOZE. The first REVIEW_LIMITS.longSnoozes snoozes of a cycle defer the
 * review longSnoozeMs from the snooze, every later one shortSnoozeMs, without
 * limit. A snooze counts only while the review is due, in one write, so two
 * sent together count once and the other answers not-due.
 *
 * CHANGE PIN is the change /pin/set serves ({pin, current, ticket?}, the
 * current PIN and the code under the 12-hour rule). Its write restarts the
 * PIN's set_at and locks the old PIN (pin_replaced_locks), and the
 * pin_restarts_review trigger clears the cycle's snoozes in the same write
 * (schema.sql), so a reset restarts the review the same way.
 *
 * A signed request is enough (Face ID releases the signing key): the answer
 * is one yes or no, and a snooze is what the plan allows without limit. A
 * pending device never reaches the route (src/routes.js).
 */
import { DAY_MS } from "../../../packages/account-engine/src/limits.mjs";
import { Refusal } from "./checks.js";
import { hasOnly } from "./signup.js";

export const REVIEW_LIMITS = Object.freeze({
  everyMs: 365 * DAY_MS,
  longSnoozes: 4,
  longSnoozeMs: 7 * DAY_MS,
  shortSnoozeMs: DAY_MS,
});

export const REVIEW_ACTIONS = Object.freeze(["Snooze", "Change PIN"]);

// Whether the body asks to snooze; refuses any body but {} and the Snooze action.
function wantsSnooze(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Refusal("shape", 400);
  if (hasOnly(body, [])) return false;
  if (hasOnly(body, ["action"]) && body.action === REVIEW_ACTIONS[0]) return true;
  throw new Refusal("shape", 400);
}

// The account's PIN age and this cycle's schedule; refuses no-pin.
async function scheduleOf(db, accountId) {
  const row = await db.prepare(
    "SELECT p.set_at AS set_at, r.due_at AS due_at FROM pin p LEFT JOIN pin_review r ON r.account_id = p.account_id WHERE p.account_id = ?",
  ).bind(accountId).first();
  if (!row) throw new Refusal("no-pin", 409);
  return row;
}

const dueAt = (row) => row.due_at ?? row.set_at + REVIEW_LIMITS.everyMs;

// One write: the cycle's first snooze inserts the row, a later one moves it,
// and either only while the review is due at `now`.
async function snoozed(db, accountId, now) {
  const { everyMs, longSnoozes, longSnoozeMs, shortSnoozeMs } = REVIEW_LIMITS;
  const row = await db.prepare(
    `INSERT INTO pin_review (account_id, snoozes, due_at)
     SELECT account_id, 1, ? FROM pin WHERE account_id = ? AND set_at + ? <= ?
     ON CONFLICT (account_id) DO UPDATE SET snoozes = pin_review.snoozes + 1,
       due_at = ? + CASE WHEN pin_review.snoozes < ? THEN ? ELSE ? END
     WHERE pin_review.due_at <= ? RETURNING account_id`,
  ).bind(now + longSnoozeMs, accountId, everyMs, now, now, longSnoozes, longSnoozeMs, shortSnoozeMs, now).first();
  return Boolean(row);
}

export async function reviewPin({ db, device, body, now }) {
  const snooze = wantsSnooze(body);
  const due = now >= dueAt(await scheduleOf(db, device.account_id));
  if (!snooze) return { status: 200, json: due ? { review: true, actions: [...REVIEW_ACTIONS] } : { review: false } };
  if (!due || !(await snoozed(db, device.account_id, now))) throw new Refusal("not-due", 409);
  return { status: 200, json: { ok: true, review: false } };
}
