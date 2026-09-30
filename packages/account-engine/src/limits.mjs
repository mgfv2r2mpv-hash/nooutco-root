// The code-path lockout ruled for JanusMirror (its E2E brief, ruling 4), as
// pure rules over a plain state object, so Horae Zone keeps the state in D1
// and a Mac keeps it in a file, and each rule is tested without a clock or a
// disk. The caller sends the email each returned event names.
//
// An exchange is counted when the service answers it, not when the device
// confirms it: a CPace reply already lets the sender check its guess, so a
// sender that never confirms has still used a guess. Each exchange is held as
// pending until its tagA verifies (then it was not a wrong code) or fails or
// times out (then it was). A window admits at most 3 unsettled-or-wrong
// exchanges, so a guesser never gets a 4th try in a window while waiting.
//
// Two locked windows in a row, or four in a day, close the whole path until
// the single-use emailed link reopens it.
import { sha256 } from '../vendor/noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '../vendor/noble/hashes/utils.js';

export const WINDOW_MS = 30_000;
export const WRONG_PER_WINDOW = 3;
export const LOCKED_WINDOWS_PER_DAY = 4;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const UNLOCK_TTL_MS = DAY_MS;
export const CONFIRM_MS = 20_000;
const STATE_VERSION = 1;

export function windowOf(ms) {
  return Math.floor(ms / WINDOW_MS);
}

export function emptyState() {
  return Object.freeze({ version: STATE_VERSION, windows: {}, pending: [], locked: [], pathLocked: false, unlock: null });
}

const hashToken = (token) => bytesToHex(sha256(utf8ToBytes(token)));

// Compares two hex strings of equal length without stopping at the first
// difference.
function sameHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function wrongIn(state, w) {
  return state.windows[w]?.wrong ?? 0;
}

function pendingIn(state, w) {
  return state.pending.filter((p) => p.window === w).length;
}

// Drops what no rule can look at again: windows and locks older than a day.
function prune(state, now) {
  const oldest = windowOf(now - DAY_MS);
  const windows = Object.fromEntries(Object.entries(state.windows).filter(([w]) => Number(w) >= oldest));
  const locked = state.locked.filter((w) => w >= oldest);
  return { ...state, windows, locked };
}

// A window's record: its wrong count and, when some of those came from a
// phone whose clock was off, how many (skewed) and the latest offset.
function windowRecord(state, w, clockOffMs) {
  const prev = state.windows[w] ?? {};
  const wrong = (prev.wrong ?? 0) + 1;
  if (!Number.isSafeInteger(clockOffMs)) return prev.skewed ? { ...prev, wrong } : { wrong };
  return { wrong, skewed: (prev.skewed ?? 0) + 1, clockOffMs };
}

// What a lock email says about clocks: present only when a wrong code in the
// locking window came from a phone whose clock was off.
function clockOf(record) {
  return record.skewed ? { skewed: record.skewed, clockOffMs: record.clockOffMs } : {};
}

// Adds one wrong code to window w. Returns the new state and what happened,
// so the caller can send the right email. clockOffMs is the phone's clock
// offset for that exchange, or null; it changes the email, never the count.
function addWrong(state, w, now, clockOffMs = null) {
  const record = windowRecord(state, w, clockOffMs);
  const { wrong } = record;
  const next = { ...state, windows: { ...state.windows, [w]: record } };
  if (wrong !== WRONG_PER_WINDOW || state.locked.includes(w)) return { state: next, events: [] };
  const locked = [...state.locked, w].sort((a, b) => a - b);
  const inARow = locked.includes(w - 1) || locked.includes(w + 1);
  const today = locked.filter((x) => x > windowOf(now - DAY_MS)).length;
  const escalate = !state.pathLocked && (inARow || today >= LOCKED_WINDOWS_PER_DAY);
  const withLock = { ...next, locked };
  const clock = clockOf(record);
  if (!escalate) return { state: withLock, events: [{ kind: 'window-lock', window: w, lockedToday: today, ...clock }] };
  return {
    state: { ...withLock, pathLocked: true, unlock: null },
    events: [{ kind: 'path-lock', window: w, lockedToday: today, reason: inARow ? 'two-in-a-row' : 'four-in-a-day', ...clock }],
  };
}

// Settles every pending exchange whose confirm time has passed, as wrong.
export function settle(state, now) {
  let next = prune(state, now);
  const events = [];
  const due = next.pending.filter((p) => p.deadline <= now);
  if (due.length === 0) return { state: next, events };
  next = { ...next, pending: next.pending.filter((p) => p.deadline > now) };
  for (const p of due) {
    const r = addWrong(next, p.window, now, p.clockOffMs);
    next = r.state;
    events.push(...r.events);
  }
  return { state: next, events };
}

// Asks to start one exchange. A refusal names why, for the plain status note.
// clockOffMs, when the phone's clock was off, rides on the pending exchange so
// a lock email can name it; it plays no part in whether the try is admitted.
export function admit(state, now, id, { clockOffMs = null } = {}) {
  const w = windowOf(now);
  if (state.pathLocked) return { state, ok: false, reason: 'path-locked' };
  if (state.locked.includes(w)) return { state, ok: false, reason: 'window-locked' };
  if (wrongIn(state, w) + pendingIn(state, w) >= WRONG_PER_WINDOW) return { state, ok: false, reason: 'window-full' };
  const entry = { id, window: w, deadline: now + CONFIRM_MS };
  const pending = [...state.pending, Number.isSafeInteger(clockOffMs) ? { ...entry, clockOffMs } : entry];
  return { state: { ...state, pending }, ok: true };
}

// The phone's tagA verified: that exchange was not a wrong code.
export function confirm(state, id) {
  return { ...state, pending: state.pending.filter((p) => p.id !== id) };
}

// The phone's tagA failed: that exchange was a wrong code, counted now.
export function reject(state, now, id) {
  const p = state.pending.find((x) => x.id === id);
  if (!p) return { state, events: [] };
  return addWrong({ ...state, pending: state.pending.filter((x) => x.id !== id) }, p.window, now, p.clockOffMs);
}

// Records a new unlock link for a closed path. Only its hash is kept.
export function issueUnlock(state, now, token) {
  if (!state.pathLocked) return state;
  return { ...state, unlock: { hash: hashToken(token), expiresAt: now + UNLOCK_TTL_MS } };
}

// Spends an unlock link. It reopens the code path and nothing else. The
// locked-window history stays, so a fresh run of guesses re-locks at once.
export function spendUnlock(state, now, token) {
  const u = state.unlock;
  if (!state.pathLocked || !u || typeof token !== 'string' || token.length === 0) return { state, ok: false, reason: 'no-link' };
  if (u.expiresAt <= now) return { state, ok: false, reason: 'expired' };
  if (!sameHex(hashToken(token), u.hash)) return { state, ok: false, reason: 'no-link' };
  return { state: { ...state, pathLocked: false, unlock: null }, ok: true };
}

// A closed path whose link has died gets a new one on the next refused try.
export function needsFreshLink(state, now) {
  return state.pathLocked && (!state.unlock || state.unlock.expiresAt <= now);
}

export function parseState(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('limits state: not valid JSON');
  }
  const intList = (v) => Array.isArray(v) && v.every(Number.isSafeInteger);
  const ok = raw && raw.version === STATE_VERSION && raw.windows && typeof raw.windows === 'object'
    && Array.isArray(raw.pending) && intList(raw.locked) && typeof raw.pathLocked === 'boolean'
    && (raw.unlock === null || (typeof raw.unlock?.hash === 'string' && /^[0-9a-f]{64}$/.test(raw.unlock.hash)
      && Number.isFinite(raw.unlock.expiresAt)));
  if (!ok) throw new Error('limits state: unexpected shape');
  return raw;
}
