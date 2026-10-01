import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { ASSETS, ROLESWAP_FILES, loadRoleswap } from './helpers/load-roleswap.mjs';

// The role swap ships as plain scripts: no modules, no build step. These tests
// load them the way a page does, with `window` and nothing else.

const API = [
  'swap', 'swapRoles', 'applySpans', 'checkBeforeCopy', 'namesTwice', 'emptyButUsed',
  'standingRows', 'customRow', 'setLooksFor', 'setValue', 'setKin', 'wordsOf', 'isActive', 'activeRows', 'activeStrip',
  'cleanValue', 'checkValue', 'scrubForms', 'findScrubs', 'possessiveOf', 'fnv1a',
  'REASON_TEXT', 'SWAPPED', 'DEFAULT_RATES', 'MIN_ELIGIBLE_FOR_LEAVES', 'EVENT_NOUNS_USE_NORMAL_RATE',
  'ADD_KINDS', 'STANDING_ROLES', 'CAREGIVER_KIN',
];

test('loads with no module or require and sets window.NotesRoleswap', () => {
  const context = loadRoleswap();
  assert.equal(typeof context.module, 'undefined');
  assert.equal(typeof context.require, 'undefined');
  assert.equal(typeof context.window.NotesRoleswap, 'object');
  assert.equal(context.window.NotesRoleswap.swap({ text: 'x' }).text, 'x');
});

test('the namespace carries exactly the engine API, and no loader scaffolding', () => {
  const ns = loadRoleswap().window.NotesRoleswap;
  assert.deepEqual(Object.keys(ns).sort(), [...API].sort());
  for (const key of API) assert.notEqual(ns[key], undefined, key);
});

test('NotesRoleswap is the only name added to the global scope', () => {
  const context = {};
  context.window = context;
  createContext(context);
  const before = new Set(Object.getOwnPropertyNames(context));
  for (const f of ROLESWAP_FILES) runInContext(readFileSync(new URL(f, ASSETS), 'utf8'), context, { filename: f });
  const added = Object.getOwnPropertyNames(context).filter((k) => !before.has(k));
  assert.deepEqual(added, ['NotesRoleswap']);
});

test('also loads when the global is globalThis and there is no window', () => {
  const context = {};
  createContext(context);
  for (const f of ROLESWAP_FILES) runInContext(readFileSync(new URL(f, ASSETS), 'utf8'), context, { filename: f });
  assert.equal(typeof context.NotesRoleswap.swapRoles, 'function');
});

test('the files use no ES module syntax and reach for no Node or DOM API', () => {
  for (const f of ROLESWAP_FILES) {
    const src = readFileSync(new URL(f, ASSETS), 'utf8').replace(/^\s*(\/\/.*|\/?\*.*)$/gm, '');
    assert.doesNotMatch(src, /^\s*(import|export)\s/m, `${f} has module syntax`);
    assert.doesNotMatch(src, /node:|require\(|\bprocess\.|\bdocument\.|\bmodule\./, `${f} reaches outside the language`);
  }
});

test('each file stays under the repo size ceiling of 800 lines', () => {
  for (const f of ROLESWAP_FILES) {
    const lines = readFileSync(new URL(f, ASSETS), 'utf8').split('\n').length;
    assert.ok(lines <= 800, `${f} is ${lines} lines`);
  }
});
