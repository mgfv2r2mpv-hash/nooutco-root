// Loads the common-PIN blocklist from the private @nooutco/pin-blocklist
// package and checks its shape before anything trusts it. The package exports
// PINS (six-digit strings) and COUNT (their number); see its SOURCE.md.
//
// A missing package is an error, never an empty list: a service that came up
// without the list would quietly accept the commonest PINs.
//
// `importer` is the seam. The default imports the package by name from here;
// a consumer that vendors the engine passes its own
// `() => import('@nooutco/pin-blocklist')` so the name resolves in its tree,
// and tests pass a fixture.

export const PIN_BLOCKLIST_PACKAGE = '@nooutco/pin-blocklist';
const SHAPE = /^[0-9]{6}$/;

export function pinBlocklistFrom(mod) {
  const pins = mod?.PINS;
  if (!Array.isArray(pins) || pins.length === 0) throw new TypeError('pin blocklist: the package has no PINS list');
  if (mod.COUNT !== pins.length) throw new TypeError('pin blocklist: PINS does not match its COUNT');
  if (!pins.every((pin) => typeof pin === 'string' && SHAPE.test(pin))) throw new TypeError('pin blocklist: an entry is not six ASCII digits');
  return Object.freeze([...pins]);
}

export async function loadPinBlocklist({ importer = () => import('@nooutco/pin-blocklist') } = {}) {
  let mod;
  try {
    mod = await importer();
  } catch (cause) {
    throw new Error(`pin blocklist: ${PIN_BLOCKLIST_PACKAGE} is not installed or cannot be read`, { cause });
  }
  return pinBlocklistFrom(mod);
}
