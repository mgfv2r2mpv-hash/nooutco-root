/**
 * load-roleswap - run the notes-roleswap-*.js scripts in a Node VM, the way a
 * browser would, and hand back window.NotesRoleswap.
 *
 * Same move as scripts/lib/gate-context.mjs: the assets are browser IIFEs with no
 * exports, so the test loads the files as scripts. The context has `window` and
 * nothing else: no `module`, no `require`, no `process`, so a file that reached for
 * any of them would throw here the way it would in a page.
 *
 * ROLESWAP_FILES is the load order, the same order the script tags use.
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

export const ASSETS = new URL('../../assets/', import.meta.url);
export const ROLESWAP_FILES = [
  'notes-roleswap-lex.js',
  'notes-roleswap-values.js',
  'notes-roleswap-rows.js',
  'notes-roleswap-ctx.js',
  'notes-roleswap-engine.js',
  'notes-roleswap.js',
];

// A fresh browser-like global. Returns the context so a test can inspect it.
export function loadRoleswap(files = ROLESWAP_FILES) {
  const context = {};
  context.window = context;
  createContext(context);
  for (const f of files) runInContext(readFileSync(new URL(f, ASSETS), 'utf8'), context, { filename: f });
  return context;
}

// Arrays and objects made inside a vm context have that context's prototypes, and
// assert.deepStrictEqual compares prototypes, so a correct answer would read as a
// failure. Copy each result into this realm, shape for shape: same keys, same
// values, undefined kept, nothing added. Functions are wrapped so their results
// are copied; arguments pass through untouched.
function hostify(value) {
  if (Array.isArray(value)) return Array.from(value, hostify);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hostify(v)]));
  }
  return value;
}

// window.NotesRoleswap with every result copied into this realm.
export function roleswap() {
  const ns = loadRoleswap().window.NotesRoleswap;
  return Object.fromEntries(Object.entries(ns).map(([k, v]) => [
    k, typeof v === 'function' ? (...args) => hostify(v(...args)) : hostify(v),
  ]));
}
