/**
 * A5c, the administrator's routes (plan §3.4 "Admin", §3.6 "/admin/*").
 *
 *   /admin/status          {email} -> {locked, lockedAt, codeClosed, pinClosed, devices}
 *   /admin/unlock-pins     {email} -> {ok: true}
 *   /admin/unlock-account  {email} -> {unlocked: true|false}
 *   any of them            -> 404 {error: "no-account"}  no account has that address
 *
 * WHO. Each route's checks are `admin` (src/routes.js): signed by a confirmed
 * device whose account holds the admin role, and that account not locked by
 * the offline block (so a device whose PINs locked its own account cannot
 * unlock it; another admin does). The first admin is the owner, set once by
 * the deploy (bin/deploy-admin.mjs).
 *
 * WHICH ACCOUNT. The one the body's address names, found by its keyed
 * address key exactly as sign-up files it. The address is never stored,
 * echoed, bound to a statement or audited. Every route takes exactly
 * {email}, so a request can never name an account by id.
 *
 * UNLOCK PINS is double blind: one DELETE of the account's reuse-lock rows,
 * with no RETURNING and no count read, and the same answer whether any PIN
 * was locked. The admin never learns how many there were, when they lapse or
 * which PINs they were.
 *
 * UNLOCK ACCOUNT calls unlockAccount (src/account-lock.js) and answers
 * whether the account was locked. Its audit row carries the outcome word
 * (`unlocked` or `not-locked`) in place of `ok`.
 *
 * STATUS is what the admin screen shows (§3.4): access (the offline-block
 * lock and when, and whether code or PIN entry is closed), reverification
 * (each device's last answered /reverify) and revocations (each device's
 * removal time). Nothing of the PIN, its locks or its review.
 */
import { Refusal } from "./checks.js";
import { addressOf, hasOnly, keysOrUnavailable } from "./signup.js";
import { unlockAccount } from "./account-lock.js";
import { pathClosed } from "./lockout.js";

// The account the body's address names, or a refusal. Shape first, so a bad
// body is refused before any key is derived.
async function targetAccount({ db, body, env }) {
  if (!hasOnly(body, ["email"])) throw new Refusal("shape", 400);
  const address = addressOf(body.email);
  const keys = await keysOrUnavailable(env);
  const row = await db.prepare("SELECT id FROM account WHERE address_key = ?").bind(await keys.addressKey(address)).first();
  if (!row) throw new Refusal("no-account", 404);
  return row.id;
}

// POST /admin/unlock-pins: deletes every reuse lock of the account, unread.
export async function unlockPins(ctx) {
  const accountId = await targetAccount(ctx);
  await ctx.db.prepare("DELETE FROM pin_lock WHERE account_id = ?").bind(accountId).run();
  return { status: 200, json: { ok: true } };
}

// POST /admin/unlock-account: lifts the offline block's lock.
export async function adminUnlockAccount(ctx) {
  const accountId = await targetAccount(ctx);
  const unlocked = await unlockAccount(ctx.db, accountId);
  return { status: 200, json: { unlocked }, audit: unlocked ? "unlocked" : "not-locked" };
}

const deviceOf = (row) => ({
  device: row.id,
  owner: row.owner === 1,
  pending: row.pending === 1,
  createdAt: row.created_at,
  confirmedAt: row.confirmed_at ?? null,
  removedAt: row.removed_at ?? null,
  reverifiedAt: row.reverified_at ?? null,
});

// POST /admin/status: the account's access, reverification and revocations.
export async function adminStatus(ctx) {
  const { db } = ctx;
  const accountId = await targetAccount(ctx);
  const lock = await db.prepare("SELECT locked_at FROM account_lock WHERE account_id = ?").bind(accountId).first();
  const { results } = await db.prepare(
    `SELECT device.id, device.owner, device.pending, device.created_at, device.confirmed_at, device.removed_at, reverify.at AS reverified_at
     FROM device LEFT JOIN reverify ON reverify.device_id = device.id
     WHERE device.account_id = ? ORDER BY device.created_at, device.id`,
  ).bind(accountId).all();
  return {
    status: 200,
    json: {
      locked: Boolean(lock),
      lockedAt: lock ? lock.locked_at : null,
      codeClosed: await pathClosed(db, accountId, "code"),
      pinClosed: await pathClosed(db, accountId, "pin"),
      devices: results.map(deviceOf),
    },
  };
}
