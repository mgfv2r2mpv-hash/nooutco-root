/**
 * A5, the code-path lockout (plan §3.6 "/unlock/start, /unlock/finish ...
 * pairing-limits.mjs lockout", "/unlock/reopen"). The rules are the engine's
 * limits.mjs, unchanged: 3 wrong codes in one 30-second window lock that
 * window and mail the account's address, and 2 locked windows in a row or 4
 * in a day close the code path until the single-use emailed link reopens it.
 *
 * STATE. One limits row per account holds the engine state as JSON, written
 * by compare-and-swap on its version column, so requests arriving together
 * each see the others' tries (6 parallel starts admit exactly 3). A state that
 * cannot be read fails closed: the path counts as closed, and a link is mailed.
 * The reopen token is stored only as the engine's hash, in the state and in
 * reopen_hash (the column /unlock/reopen looks it up by).
 *
 * MAIL. Each lock event becomes one plain note to the account's address,
 * sent after the answer through the engine mailer. A note never carries a
 * code, the seed, a tag, a ticket or a count beyond the rule it names; only
 * the path-closed note carries the link.
 */
import {
  emptyState, parseState, needsFreshLink, issueUnlock, spendUnlock, UNLOCK_TTL_MS, WINDOW_MS,
} from "../../../packages/account-engine/src/limits.mjs";
import { fragmentLink } from "../../../packages/account-engine/src/mailer.mjs";
import { Refusal, b64url } from "./checks.js";
import { admitThrottle } from "./throttle.js";

// Another request writing between a read and a write costs one more read.
// Each write is one request's, so this covers far more requests at once than
// an account's devices send.
const CAS_TRIES = 8;
const TOKEN_BYTES = 32;

async function readLimits(db, accountId) {
  const row = await db.prepare("SELECT state, version FROM limits WHERE account_id = ?").bind(accountId).first();
  if (!row) return { state: emptyState(), version: null };
  try {
    return { state: parseState(row.state), version: row.version };
  } catch {
    return { state: { ...emptyState(), pathLocked: true }, version: row.version };
  }
}

async function writeLimits(db, accountId, version, state) {
  const text = JSON.stringify(state);
  const hash = state.unlock ? state.unlock.hash : null;
  const done = version === null
    ? db.prepare("INSERT INTO limits (account_id, state, version, reopen_hash) VALUES (?, ?, 0, ?) ON CONFLICT (account_id) DO NOTHING RETURNING account_id")
      .bind(accountId, text, hash)
    : db.prepare("UPDATE limits SET state = ?, version = version + 1, reopen_hash = ? WHERE account_id = ? AND version = ? RETURNING account_id")
      .bind(text, hash, accountId, version);
  return Boolean(await done.first());
}

// Gives a closed path whose link is missing or dead a new link. The token
// goes only into the mail; the state keeps its hash.
function withLink(state, now) {
  if (!needsFreshLink(state, now)) return { state, token: null };
  const token = b64url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
  return { state: issueUnlock(state, now, token), token };
}

// Runs `rule` (pure: state in, {state, events, ...} out) over the account's
// state and writes the result, reading again when another request wrote
// first. Returns the rule's result with a link token when the path needs one
// (a reopen try renews no link: its token could reach no one).
export async function ruleLimits(db, accountId, now, rule, { renewLink = true } = {}) {
  for (let i = 0; i < CAS_TRIES; i += 1) {
    const { state, version } = await readLimits(db, accountId);
    const ruled = rule(state);
    const linked = renewLink ? withLink(ruled.state, now) : { state: ruled.state, token: null };
    if (await writeLimits(db, accountId, version, linked.state)) return { ...ruled, state: linked.state, token: linked.token };
  }
  throw new Refusal("slow-down", 429);
}

// Whether the account's code path is closed, read without writing (a state
// that cannot be read counts as closed). A pending device's try asks this
// and changes nothing (security review item 2).
export async function pathClosed(db, accountId) {
  return (await readLimits(db, accountId)).state.pathLocked;
}

// The reopen link's token, looked up by its hash, spent once.
export async function spendReopen(db, now, token) {
  const hash = await sha256Hex(token);
  const row = await db.prepare("SELECT account_id FROM limits WHERE reopen_hash = ?").bind(hash).first();
  if (!row) return null;
  const ruled = await ruleLimits(db, row.account_id, now, (state) => spendUnlock(state, now, token), { renewLink: false });
  return ruled.ok ? row.account_id : null;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- the notes. Plain notes on state; the wording is the owner's to change. ----

const LINK_HOURS = UNLOCK_TTL_MS / 3_600_000;
const WINDOW_SECONDS = WINDOW_MS / 1000;
const CLOCK_LINE = "Some of these codes came from a device whose clock was off; a device clock set automatically gives codes that match.";

function windowNote(event) {
  return {
    subject: "Horae Zone: code entry paused",
    text: [
      `Three wrong authenticator codes were entered for this account within ${WINDOW_SECONDS} seconds.`,
      `Code entry for this account is paused for the rest of that ${WINDOW_SECONDS}-second window.`,
      ...(event?.skewed ? [CLOCK_LINE] : []),
      "No code was accepted.",
    ].join("\n"),
  };
}

function closedNote(event, link) {
  const rule = event?.reason === "four-in-a-day" ? "four times in one day" : "in two windows in a row";
  return {
    subject: "Horae Zone: code entry closed",
    text: [
      event ? `Wrong authenticator codes paused code entry for this account ${rule}.` : "Code entry for this account is closed, and the last reopen link had expired.",
      "Code entry stays closed until this link is opened:",
      link,
      `Works once. Expires ${LINK_HOURS} hours after it was sent.`,
      "Opening it reopens code entry only. A right code is still needed on the device.",
      ...(event?.skewed ? [CLOCK_LINE] : []),
    ].join("\n"),
  };
}

export function reopenedNote() {
  return {
    subject: "Horae Zone: code entry reopened",
    text: [
      "The reopen link was used. Code entry for this account is open again.",
      "A right authenticator code is still needed on the device.",
      "The link no longer works.",
    ].join("\n"),
  };
}

// A5 re-review item 3: the note to the owner when a pending device's try was
// wrong or was refused at a cap. A pending device has shown the password, so
// the note says so; it carries no code, link or count beyond the rule.
const PENDING_NOTES_PER_HOUR = 1;
const HOUR_MS = 60 * 60 * 1000;

export function pendingNote(perAccountDay) {
  return {
    subject: "Horae Zone: code refused on a new device",
    text: [
      "A device signed in with this account's password tried an authenticator code, and the code was not accepted.",
      `Devices that have not yet proved the code get ${perAccountDay} tries a day for this account, all of them together.`,
      "The device can change nothing on the account until it proves a code.",
    ].join("\n"),
  };
}

// The pending note when one is due: at most one an hour per account, counted
// in the throttle table, so a burst of wrong tries sends one note.
export async function pendingNotes(db, accountId, now, perAccountDay) {
  const due = await admitThrottle(db, now, HOUR_MS, [{ bucket: `pending-alert:${accountId}`, limit: PENDING_NOTES_PER_HOUR }]);
  return due ? [pendingNote(perAccountDay)] : [];
}

// The notes a ruling sends: one per window lock, and one carrying the link
// when the path closed now or its link was renewed.
export function lockNotes(events, token, reopenBase) {
  const notes = events.filter((e) => e.kind === "window-lock").map(windowNote);
  if (token) notes.push(closedNote(events.find((e) => e.kind === "path-lock"), fragmentLink(reopenBase, token)));
  return notes;
}

// After-work that mails `notes` to the account's address, opened from its
// sealed box. A send that fails or throws is audited as mail-failed.
export function mailAfter({ db, keys, mailer, accountId, notes }) {
  if (notes.length === 0) return undefined;
  return async () => {
    try {
      const account = await db.prepare("SELECT address_key, address_box FROM account WHERE id = ?").bind(accountId).first();
      if (!account) return "mail-failed";
      const to = await keys.openAddress(account.address_box, account.address_key);
      let ok = true;
      for (const note of notes) ok = (await mailer({ to, ...note })) && ok;
      return ok ? null : "mail-failed";
    } catch {
      return "mail-failed";
    }
  };
}
