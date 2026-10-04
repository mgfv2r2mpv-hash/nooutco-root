/**
 * gate-context - run assets/notes-gate.js in a Node VM and hand back the REAL
 * detection functions.
 *
 * WHY A VM RATHER THAN AN IMPORT. notes-gate.js is a browser IIFE with no
 * exports; everything it offers arrives on window.NotesGate. draft-before-after
 * and expert-vs-catalog already load the note tools this way, so this is the
 * same move against a different file.
 *
 * WHY NOT A SECOND COPY OF THE REGEXES. A census that measured a copy would
 * measure the copy. The point of the whole script is to put numbers on the code
 * that ships, including the parts of it nobody meant to write.
 *
 * WHAT THE STUBS CHANGE, STATED SO A READER CAN DISCOUNT IT:
 *   localStorage  empty, so loadNonPii() returns [] and no clinician-certified
 *                 term is excluded. The numbers are a fresh device, which is
 *                 the worst case and the one a new technician sees
 *   fetch         rejects, so /api/scrub-config never lands. The dictionaries
 *                 measured are the ones in the file, with no server-learned
 *                 stopword or first name merged in. A deployed browser can be
 *                 kinder than this and can never be harsher
 *   document      a stub with no DOM. The gate only touches it lazily, when a
 *                 human opens the login modal, which no census run does
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createContext, runInContext } from 'node:vm';

function emptyStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
}

/* Loading a browser file in Node means every global it touches has to exist or
   the whole file throws before a single function is defined. Each entry here is
   present because the load failed without it, never speculatively. */
function browserish(localStorage) {
  const noop = () => {};
  const el = () => ({
    style: {}, classList: { add: noop, remove: noop, toggle: noop },
    appendChild: noop, removeChild: noop, setAttribute: noop, addEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [], remove: noop,
  });
  return {
    localStorage,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: () => Promise.reject(new Error('phi-census: network is stubbed')),
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init || {}); } },
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    document: {
      readyState: 'complete',
      addEventListener: noop,
      createElement: el,
      querySelector: () => null,
      querySelectorAll: () => [],
      body: el(),
      head: el(),
    },
  };
}

/** Load a notes-gate.js SOURCE STRING and return what the census needs. */
/* `prelude` is the English word list (assets/english-words.js), run first the
   way the page loads it before notes-gate.js, so the lowercase-name pass sees
   what the browser sees. Without it that pass is off, as on a page that did
   not load the list. */
export function loadGateSource(source, label, prelude = null) {
  const localStorage = emptyStorage();
  const win = {};
  const globals = browserish(localStorage);
  const ctx = createContext({ ...globals, window: win });
  Object.assign(win, globals);
  if (prelude) runInContext(prelude, ctx, { filename: 'english-words.js' });
  runInContext(source, ctx, { filename: label || 'notes-gate.js' });
  const gate = win.NotesGate;
  if (!gate || !gate._scrub) {
    throw new Error(`${label || 'notes-gate.js'} ran but exposed no NotesGate._scrub.`);
  }
  const s = gate._scrub;
  for (const fn of ['detectNames', 'detectIdentifiers', 'inferRoles', 'buildRoleMap', 'buildIdentifierMap', 'applyScrub']) {
    if (typeof s[fn] !== 'function') throw new Error(`${label}: NotesGate._scrub.${fn} is missing.`);
  }
  return {
    label,
    detectNames: s.detectNames,
    detectIdentifiers: s.detectIdentifiers,
    inferRoles: s.inferRoles,
    buildRoleMap: s.buildRoleMap,
    buildIdentifierMap: s.buildIdentifierMap,
    applyScrub: s.applyScrub,
    isFirstName: s.isFirstName,
    // Everything the gate exposes under _scrub, for a spec that needs a hook
    // the census itself never reads (program-words-not-names.spec.js).
    raw: s,
  };
}

/** Load the file as it sits in the working tree. */
export function loadGateFromFile(file, label) {
  const words = join(dirname(file), 'english-words.js');
  const prelude = existsSync(words) ? readFileSync(words, 'utf8') : null;
  return loadGateSource(readFileSync(file, 'utf8'), label || file, prelude);
}

/**
 * Load the file as some other commit has it.
 *
 * A REF THAT DOES NOT RESOLVE IS A FACT, NOT A CRASH. The comparison column is
 * the point of the run, so the caller is told which ref it got and whether the
 * source is byte-identical to the working tree. Two identical columns mean the
 * branch changed no detection code, which is a finding rather than a bug.
 */
export function loadGateFromRef(ref, repoPath, cwd) {
  const source = execFileSync('git', ['show', `${ref}:${repoPath}`], {
    cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  const sha = execFileSync('git', ['rev-parse', '--short', ref], { cwd, encoding: 'utf8' }).trim();
  // The word list as that commit had it, or none before it existed.
  let prelude = null;
  try {
    prelude = execFileSync('git', ['show', `${ref}:${repoPath.replace(/notes-gate\.js$/, 'english-words.js')}`], {
      cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch { prelude = null; }
  return { gate: loadGateSource(source, `${ref} (${sha})`, prelude), source, sha };
}
