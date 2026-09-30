// The app PIN rules, the same on every device and on Horae Zone: exactly six
// ASCII digits, no run of three ascending, descending or repeated digits
// anywhere in it (a run does not wrap past 9), and not on the blocklist.
// Both refusals share one sentence, so a refusal never says which rule caught
// the PIN, and no refusal carries the PIN.
import { BLOCKLIST } from './pin-blocklist.mjs';

export const PIN_LENGTH = 6;
export const PIN_TOO_EASY = 'That PIN is too easy to guess.';
const SHAPE = /^[0-9]{6}$/;

function hasRun(pin) {
  for (let i = 0; i + 2 < pin.length; i += 1) {
    const a = pin.charCodeAt(i);
    const b = pin.charCodeAt(i + 1);
    const c = pin.charCodeAt(i + 2);
    const step = b - a;
    if ((step === 1 || step === -1 || step === 0) && c - b === step) return true;
  }
  return false;
}

export function pinAllowed(pin) {
  if (typeof pin !== 'string' || !SHAPE.test(pin)) return { ok: false, reason: 'shape' };
  if (hasRun(pin) || BLOCKLIST.has(pin)) return { ok: false, reason: 'too-easy', message: PIN_TOO_EASY };
  return { ok: true };
}
