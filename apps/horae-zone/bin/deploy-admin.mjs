/**
 * Step 6 of the Horae Zone deploy (bin/deploy.mjs): the owner as the first
 * administrator (plan §3.4 "The first administrator is the owner, set once
 * by a deploy-time command"; §4 "It sets the owner as administrator").
 *
 * The owner signs up through the app like anyone else, so at the first
 * deploy there is no account to make admin. The step reads the role table
 * and the accounts, and:
 *   - an admin already set: PASS, nothing asked or changed (set once);
 *   - no account yet: SKIPPED, with the command to run after sign-up
 *     (node bin/deploy.mjs --owner-admin, Step 6 alone);
 *   - otherwise: lists the oldest accounts by creation time and device
 *     count (the database keeps no address in the clear, and HZ_ACCOUNT_KEY
 *     stays in Cloudflare, so the script cannot match an address), asks the
 *     owner which one is theirs, reads the pick back for a typed y, and
 *     runs one guarded INSERT.
 *
 * The INSERT carries its own guards: it adds the role only for an account
 * that exists, and only while no account holds the admin role, so a second
 * run, or a race with another, can never add a second admin. An account id
 * is put into the statement only when it has the shape of the ids sign-up
 * makes; a row of any other shape is never shown or offered.
 *
 * Nothing here reads or prints a secret: the statements carry account ids
 * and times only.
 */
import { DATABASE, DEPLOY_CONFIG, parseJson } from "./deploy-parts.mjs";

export const OWNER_ADMIN_FLAG = "--owner-admin";
export const ACCOUNTS_SHOWN = 10;
// The ids sign-up makes (crypto.randomUUID, src/signup.js), lower-case hex.
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ITEM = "Owner as administrator";

const sql = (command) => ["d1", "execute", DATABASE, "--remote", "--json", "--command", command, "--config", DEPLOY_CONFIG];

export const ADMIN_COMMANDS = Object.freeze({
  adminCount: sql("SELECT COUNT(*) AS admins FROM role WHERE role = 'admin'"),
  accounts: sql(
    "SELECT a.id, a.created_at, (SELECT COUNT(*) FROM device d WHERE d.account_id = a.id AND d.removed_at IS NULL) AS devices "
    + `FROM account a ORDER BY a.created_at, a.id LIMIT ${ACCOUNTS_SHOWN + 1}`,
  ),
  // Only ever called with an id that passed ACCOUNT_ID.
  grant: (id) => [
    ...sql(`INSERT INTO role (account_id, role) SELECT id, 'admin' FROM account WHERE id = '${id}' `
      + "AND NOT EXISTS (SELECT 1 FROM role WHERE role = 'admin') RETURNING account_id"),
    "--yes",
  ],
});

const when = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The result rows of one wrangler d1 execute --json.
async function rowsOf(ctx, args, label) {
  const parsed = parseJson(ctx.checked(label, await ctx.wrangler(args)));
  const results = parsed?.[0]?.results;
  if (!Array.isArray(results)) throw new Error(`${label} gave no result rows`);
  return results;
}

// Only rows sign-up could have made: a well-formed id and a whole-number time.
const wellFormed = (row) => typeof row?.id === "string" && ACCOUNT_ID.test(row.id) && Number.isSafeInteger(row.created_at) && Number.isSafeInteger(row.devices);

async function readState(ctx) {
  const [count] = await rowsOf(ctx, ADMIN_COMMANDS.adminCount, "the role read");
  if (!Number.isSafeInteger(count?.admins)) throw new Error("the role read gave no count");
  return { admins: count.admins, rows: await rowsOf(ctx, ADMIN_COMMANDS.accounts, "the account read") };
}

async function pickAccount(ctx, deps, accounts, more) {
  ctx.say("  No administrator yet. Accounts, oldest first (the database keeps no address in the clear, so pick yours by when you signed up):");
  accounts.forEach((a, i) => ctx.say(`  ${i + 1}) created ${when(a.created_at)}, ${plural(a.devices, "device")}`));
  if (more) ctx.say(`  (only the oldest ${ACCOUNTS_SHOWN} are shown)`);
  const pick = (await deps.ask({ name: "pick-owner-account", question: "  Number of your own account (blank sets no administrator): ", hidden: false })).trim();
  if (!/^[1-9]\d*$/.test(pick) || Number(pick) > accounts.length) return null;
  const chosen = accounts[Number(pick) - 1];
  // The grant cannot be undone by this script (set once), so the pick is
  // read back and confirmed with a typed y.
  ctx.say(`  You picked the account created ${when(chosen.created_at)}, ${plural(chosen.devices, "device")}. The first administrator is set once.`);
  const yes = (await deps.ask({ name: "confirm-owner-account", question: "  Make it administrator? Type y to go on, anything else sets none: ", hidden: false })).trim().toLowerCase();
  return yes === "y" || yes === "yes" ? chosen : null;
}

export async function ownerAdminStep(ctx, deps) {
  ctx.say("Step 6. Owner as administrator");
  let state;
  try {
    state = await readState(ctx);
  } catch (err) {
    ctx.say("  Could not read the role or account tables; no role was set.");
    return ctx.item(ITEM, "FAIL", `could not read the role or account tables (${err.message.split("\n")[0]}); no role was set`);
  }
  if (state.admins > 0) {
    ctx.say("  An administrator is already set. The first one is set once, so nothing was changed.");
    return ctx.item(ITEM, "PASS", "already set (set once; nothing changed)");
  }
  const accounts = state.rows.filter(wellFormed).slice(0, ACCOUNTS_SHOWN);
  if (accounts.length === 0) {
    ctx.say(`  No account yet. Sign up in the app first, then run: node bin/deploy.mjs ${OWNER_ADMIN_FLAG}`);
    return ctx.item(ITEM, "SKIPPED", `no account yet: sign up, then node bin/deploy.mjs ${OWNER_ADMIN_FLAG}`);
  }
  const chosen = await pickAccount(ctx, deps, accounts, state.rows.length > ACCOUNTS_SHOWN);
  if (!chosen) {
    ctx.say("  No account picked; no role was set.");
    return ctx.item(ITEM, "SKIPPED", `no account picked; run node bin/deploy.mjs ${OWNER_ADMIN_FLAG} to pick one`);
  }
  try {
    const granted = await rowsOf(ctx, ADMIN_COMMANDS.grant(chosen.id), "the role write");
    if (granted.length !== 1) throw new Error("no row came back");
  } catch (err) {
    ctx.say("  The role write came back with no row: no role was set.");
    return ctx.item(ITEM, "FAIL", `no role was set (${err.message.split("\n")[0]}): an administrator may have been set meanwhile; rerun node bin/deploy.mjs ${OWNER_ADMIN_FLAG}`);
  }
  ctx.say(`  Set the account created ${when(chosen.created_at)} as administrator.`);
  return ctx.item(ITEM, "PASS", `the account created ${when(chosen.created_at)}`);
}

// What the dry run prints for Step 6, with `show` rendering a wrangler call.
export function ownerAdminDryRun(show) {
  return [
    "Step 6. Owner as administrator",
    `  ${show(ADMIN_COMMANDS.adminCount)}   an administrator already set: nothing is asked or changed (set once)`,
    `  ${show(ADMIN_COMMANDS.accounts)}   no account yet: says to sign up, then run node bin/deploy.mjs ${OWNER_ADMIN_FLAG}`,
    "  prompt: the number of your own account, listed by creation time and device count (blank sets no administrator)",
    "  prompt: the pick read back; y to make it administrator, anything else sets none",
    `  ${show(ADMIN_COMMANDS.grant("ACCOUNT_ID"))}   only while no administrator is set`,
  ];
}
