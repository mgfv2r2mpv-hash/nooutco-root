// The app PIN rules, the same on every device and on Horae Zone: exactly six
// ASCII digits, no run of three ascending, descending or repeated digits
// anywhere in it, and not on the blocklist.
//
// RUNS WRAP (owner ruling, 2026-10-03: "7890 is [a run]. 0 is after 9 or
// before 1."). Digits are circular, so 890, 901, 098 and 109 are runs.
//
// THE BLOCKLIST IS INJECTED. The engine holds no list: the real one is the
// private @nooutco/pin-blocklist package (owner ruling, 2026-10-03: "private
// package"), loaded by pin-blocklist-load.mjs and handed to createPinRules().
// Tests hand in a small public fixture instead.
//
// Both refusals share one sentence, so a refusal never says which rule caught
// the PIN, and no refusal carries the PIN.

export const PIN_LENGTH = 6;
export const PIN_TOO_EASY = 'That PIN is too easy to guess.';
const SHAPE = /^[0-9]{6}$/;
const DIGITS = 10;
const RUN_STEPS = new Set([0, 1, DIGITS - 1]); // repeat, up one, down one (mod 10)

function stepOf(pin, i) {
  return (pin.charCodeAt(i + 1) - pin.charCodeAt(i) + DIGITS) % DIGITS;
}

function hasRun(pin) {
  for (let i = 0; i + 2 < pin.length; i += 1) {
    const step = stepOf(pin, i);
    if (RUN_STEPS.has(step) && stepOf(pin, i + 1) === step) return true;
  }
  return false;
}

function blocklistSet(list) {
  if (list === null || typeof list !== 'object' || typeof list[Symbol.iterator] !== 'function') {
    throw new TypeError('pin blocklist: the rules need the list (an array or set of six-digit strings)');
  }
  const set = new Set();
  for (const pin of list) {
    if (typeof pin !== 'string' || !SHAPE.test(pin)) throw new TypeError('pin blocklist: an entry is not six ASCII digits');
    set.add(pin);
  }
  if (set.size === 0) throw new TypeError('pin blocklist: the list is empty');
  return set;
}

export function createPinRules(blocklist) {
  const blocked = blocklistSet(blocklist);
  const pinAllowed = (pin) => {
    if (typeof pin !== 'string' || !SHAPE.test(pin)) return { ok: false, reason: 'shape' };
    if (hasRun(pin) || blocked.has(pin)) return { ok: false, reason: 'too-easy', message: PIN_TOO_EASY };
    return { ok: true };
  };
  return Object.freeze({ pinAllowed });
}
