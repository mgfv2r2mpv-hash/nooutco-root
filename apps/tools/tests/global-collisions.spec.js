import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/* No two scripts on a note page may declare the same top-level name.
 *
 * This stack has no build step and no modules. Every .jsx the page lists is
 * compiled by babel-standalone and evaluated in the one global scope, so two
 * files that both write `var STATE_WORD` do not collide loudly. The second one
 * simply wins, and the first file keeps running with the other file's value.
 *
 * That happened on 2026-09-16. disposition-row.jsx and section-map.jsx each
 * declared STATE_WORD, the section map loaded second, and the disposition row
 * looked up "reverted" in the section map's table. It got undefined, so every
 * state word rendered as nothing, while the data attribute beside it, read from
 * the same variable, said "reverted" correctly. A test asserting the state was
 * green; a test asserting the word was red; nothing pointed at the cause.
 *
 * A linter would find this in a bundled project. Here the page IS the bundle,
 * so the check belongs to the page.
 */

/* The app root is the directory holding playwright.config.js. Asking Playwright
   for it beats __dirname: these specs are written as ES modules and run through
   a CommonJS transform, so neither import.meta.url nor a stable __dirname is
   guaranteed. Not config.rootDir, which Playwright sets to the common ancestor
   of the test files and is therefore tests/ here. */
const appRoot = () => path.dirname(test.info().config.configFile);

const PAGES = ['notes/bt/index.html', 'notes/bcba/index.html'];

// Top level means column zero. Everything inside a function in these files is
// indented, so anchoring at the start of the line is enough and does not need a
// parser. A name missed here is a name this test does not protect, never a
// false alarm.
const DECL = /^(?:var|let|const|function|class)\s+([A-Za-z_$][\w$]*)/;

function babelScripts(APP, pageRel) {
  const html = fs.readFileSync(path.join(APP, pageRel), 'utf8');
  const out = [];
  const re = /<script[^>]*type="text\/babel"[^>]*src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

for (const pageRel of PAGES) {
  test(`${pageRel} loads no two scripts that declare the same global`, () => {
    const APP = appRoot();
    const srcs = babelScripts(APP, pageRel);
    expect(srcs.length, 'the page should list its babel scripts').toBeGreaterThan(0);

    const owners = new Map();
    for (const src of srcs) {
      // Site-absolute ("/notes/bcba/engine.jsx") resolves from the app root, the
      // way the server serves it; relative resolves from the page's folder.
      const file = src.startsWith('/')
        ? path.join(APP, src)
        : path.resolve(path.dirname(path.join(APP, pageRel)), src);
      expect(fs.existsSync(file), `${src} is listed by ${pageRel} but not on disk`).toBe(true);
      const base = path.basename(file);
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const d = DECL.exec(line);
        if (!d) continue;
        const name = d[1];
        if (!owners.has(name)) owners.set(name, new Set());
        owners.get(name).add(base);
      }
    }

    const clashes = [...owners.entries()]
      .filter(([, files]) => files.size > 1)
      .map(([name, files]) => `${name} in ${[...files].join(' and ')}`);

    expect(clashes, 'two scripts on one page share a top-level name').toEqual([]);
  });
}
