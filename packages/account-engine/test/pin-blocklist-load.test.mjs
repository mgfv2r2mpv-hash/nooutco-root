import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPinBlocklist, pinBlocklistFrom, PIN_BLOCKLIST_PACKAGE } from '../src/pin-blocklist-load.mjs';
import { createPinRules, PIN_TOO_EASY } from '../src/pin.mjs';
import * as fixture from './fixtures/pin-blocklist.mjs';

const fails = (message) => async () => { throw new Error(message); };

test('the loader takes the list from the private package by name', async () => {
  assert.equal(PIN_BLOCKLIST_PACKAGE, '@nooutco/pin-blocklist');
  const list = await loadPinBlocklist({ importer: async () => fixture });
  assert.deepEqual([...list], [...fixture.PINS]);
  assert.ok(Object.isFrozen(list));
});

test('a missing private package is refused by name, never treated as an empty list', async () => {
  await assert.rejects(loadPinBlocklist({ importer: fails("Cannot find package '@nooutco/pin-blocklist'") }),
    (err) => err.message.includes('@nooutco/pin-blocklist is not installed') && err.cause instanceof Error);
});

test('a package of the wrong shape is refused', () => {
  const cases = [
    {},
    { PINS: [], COUNT: 0 },
    { PINS: ['159753'], COUNT: 2 },
    { PINS: ['159753', '15975'], COUNT: 2 },
    { PINS: '159753', COUNT: 1 },
    null,
  ];
  for (const mod of cases) assert.throws(() => pinBlocklistFrom(mod), /pin blocklist/, JSON.stringify(mod));
});

test('NEGATIVE CONTROL: a package in the agreed shape loads, and its PINs are refused', async () => {
  const { pinAllowed } = createPinRules(await loadPinBlocklist({ importer: async () => fixture }));
  assert.deepEqual(pinAllowed('147258'), { ok: false, reason: 'too-easy', message: PIN_TOO_EASY });
});

// Runs only where the private package is installed (CI with the read key, or
// the owner's Mac); everywhere else the fixture suite above stands in.
let installed = null;
try {
  installed = await import(PIN_BLOCKLIST_PACKAGE);
} catch {
  installed = null;
}

test('the installed private package loads all 3,413 PINs', { skip: installed ? false : 'private package not installed' }, async () => {
  const list = await loadPinBlocklist();
  assert.equal(list.length, 3413);
  const { pinAllowed } = createPinRules(list);
  for (const pin of fixture.PINS) assert.deepEqual(pinAllowed(pin), { ok: false, reason: 'too-easy', message: PIN_TOO_EASY }, pin);
});
