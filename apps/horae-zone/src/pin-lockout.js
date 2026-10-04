/**
 * A5b, the online wrong-PIN lockout (plan §3.4 "Online wrong PINs:
 * JanusMirror's lockout"). The code path's rules, unchanged: 3 wrong PINs in
 * one 30-second window lock that window and mail the account's address, and
 * 2 locked windows in a row or 4 in a day close PIN entry until the
 * single-use emailed link reopens it. The code path's day cap holds here too
 * (12 wrong a day, from any device of the account, close it the same way).
 *
 * STATE. The engine state lives in pin_limits, its own row per account, run
 * by src/lockout.js's helpers, so wrong PINs never close code entry and wrong
 * codes never close PIN entry. Each comparison of a PIN is admitted first,
 * as a pending try (so tries arriving together never pass a window), then
 * settled as right (confirm) or wrong (reject) once the PIN was compared.
 * A try the service dropped between the two counts as wrong at its confirm
 * time, as on the code path.
 *
 * THE LINK is the code path's: /unlock/reopen finds the token's hash in
 * pin_limits and reopens PIN entry only, with its own note.
 *
 * MAIL. The notes say what happened and nothing else: never a PIN, a hash,
 * a date, a duration or a count (plan test 5), and never which device or
 * which rule closed PIN entry. The code path's notes (A5) keep their numbers.
 */
import { admit, confirm, reject } from "../../../packages/account-engine/src/limits.mjs";
import { fragmentLink } from "../../../packages/account-engine/src/mailer.mjs";
import { Refusal, b64url } from "./checks.js";
import {
  ruleLimits, mailAfter, settleCapped, capDay, dayHasRoom,
} from "./lockout.js";

const TRY_BYTES = 16;
const PIN_PATH = { path: "pin" };

function windowNote() {
  return {
    subject: "Horae Zone: PIN entry paused",
    text: [
      "Wrong app PINs were entered for this account in quick succession.",
      "PIN entry for this account is paused for a short while.",
      "No PIN was accepted.",
    ].join("\n"),
  };
}

function closedLine(event) {
  if (!event) return "PIN entry for this account is closed, and the last reopen link had expired.";
  if (event.reason === "day-cap") return "Too many wrong app PINs were entered for this account.";
  return "Wrong app PINs paused PIN entry for this account too often.";
}

function closedNote(event, link) {
  return {
    subject: "Horae Zone: PIN entry closed",
    text: [
      closedLine(event),
      "PIN entry stays closed until this link is opened:",
      link,
      "Works once, for a short time.",
      "Opening it reopens PIN entry only. The right PIN is still needed on the device.",
    ].join("\n"),
  };
}

export function pinReopenedNote() {
  return {
    subject: "Horae Zone: PIN entry reopened",
    text: [
      "The reopen link was used. PIN entry for this account is open again.",
      "The right PIN is still needed on the device.",
      "The link no longer works.",
    ].join("\n"),
  };
}

// The notes a ruling sends: one per window lock, and one carrying the link
// when PIN entry closed now or its link was renewed.
function pinLockNotes(events, token, reopenBase) {
  const notes = events.filter((e) => e.kind === "window-lock").map(windowNote);
  if (token) notes.push(closedNote(events.find((e) => e.kind === "path-lock"), fragmentLink(reopenBase, token)));
  return notes;
}

// Admits one PIN comparison into the account's PIN lockout. Refuses locked,
// with the notes its ruling owes, when PIN entry is closed, the window is
// locked or full, or the day has no room. Otherwise answers the try's id and
// those notes, for settlePinTry.
export async function admitPinTry({ db, accountId, now, keys, mailer, reopenBase }) {
  const id = b64url(crypto.getRandomValues(new Uint8Array(TRY_BYTES)));
  const ruled = await ruleLimits(db, accountId, now, (state) => {
    const settled = settleCapped(state, now);
    if (!settled.state.pathLocked && !dayHasRoom(settled.state, now)) return { ...settled, ok: false };
    const admitted = admit(settled.state, now, id);
    return { state: admitted.state, ok: admitted.ok, events: settled.events };
  }, PIN_PATH);
  const notes = pinLockNotes(ruled.events, ruled.token, reopenBase);
  if (!ruled.ok) throw new Refusal("locked", 423, mailAfter({ db, keys, mailer, accountId, notes }));
  return { id, notes };
}

// Settles an admitted try as right or wrong, and answers the mail every
// ruling of this try owes (the admit's notes first).
export async function settlePinTry({ db, accountId, now, keys, mailer, reopenBase, tried, right }) {
  const ruled = await ruleLimits(db, accountId, now, (state) => {
    const settled = settleCapped(state, now);
    if (right) return { state: confirm(settled.state, tried.id), events: settled.events };
    const rejected = reject(settled.state, now, tried.id);
    return capDay(settled.state, { state: rejected.state, events: [...settled.events, ...rejected.events] }, now);
  }, PIN_PATH);
  const notes = [...tried.notes, ...pinLockNotes(ruled.events, ruled.token, reopenBase)];
  return mailAfter({ db, keys, mailer, accountId, notes });
}
