// A small stand-in for the private @nooutco/pin-blocklist package, in the
// same shape (PINS, COUNT). The real list is not redistributed in this public
// repository (owner ruling, 2026-10-03); these five are well-known keypad and
// number patterns, safe to publish, chosen so each has no run of three and so
// only the list can refuse them.
export const PINS = Object.freeze(['159753', '147258', '246810', '696969', '101010']);
export const COUNT = PINS.length;
