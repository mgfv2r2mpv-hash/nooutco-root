import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The note pages are made of files that must move together: the HTML,
// notes-gate.js, notes-scrub.js, engine.jsx, revision-panel.jsx and
// notes-page.css. They were each cached for four hours and independently, so
// after a deploy a browser could hold any mixture of old and new.
//
// That shipped two live failures in one session on 2026-08-04: a fresh
// engine.jsx calling "NotesGate.generateProse is not a function" against a
// stale gate, and the routing card rendering unstyled against a stale
// stylesheet. Both files were correct on the server. The mixture was the bug.
//
// These tests are about the _headers file rather than the browser, because the
// dev server does not apply it and the failure only appears in production. A
// weak test in the right place beats none.

const ROOT = join(__dirname, '..');
const headers = readFileSync(join(ROOT, '_headers'), 'utf8');

// Parse `_headers` into [pattern, {header: value}] pairs.
function parsed() {
  const out = [];
  let current = null;
  for (const raw of headers.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      current = { pattern: line.trim(), headers: {} };
      out.push(current);
      continue;
    }
    const m = line.trim().match(/^([^:]+):\s*(.*)$/);
    if (m && current) current.headers[m[1].toLowerCase()] = m[2];
  }
  return out;
}

const rules = parsed();
const ruleFor = (p) => rules.find((r) => r.pattern === p);

test('the files that must move together are not cached', () => {
  for (const pattern of ['/assets/*.js', '/assets/*.css', '/notes/*']) {
    const rule = ruleFor(pattern);
    expect(rule, `${pattern} has no rule, so it inherits the default four hours`).toBeTruthy();
    expect(rule.headers['cache-control'], `${pattern} must revalidate`).toMatch(/no-cache|no-store|max-age=0/);
  }
});

test('the vendored libraries are immutable, which is what makes this cheap', () => {
  // Their version is in the filename, so a change to React is a change to the
  // URL. Revalidating 3MB of Babel on every page load would be the wrong trade.
  const rule = ruleFor('/vendor/*');
  expect(rule).toBeTruthy();
  expect(rule.headers['cache-control']).toMatch(/immutable/);
  expect(rule.headers['cache-control']).toMatch(/max-age=\d{6,}/);
});

test('every lockstep file the notes pages load is covered by a rule', () => {
  // The real risk is a file that nobody thought about. Read the page and check
  // each same-origin asset it pulls against the patterns above.
  const html = readFileSync(join(ROOT, 'notes/bcba/index.html'), 'utf8');
  const srcs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((s) => !/^https?:/.test(s));

  const covered = (path) => {
    // Resolve relative paths properly. "../notes-page.css" from /notes/bcba/
    // is /notes/notes-page.css, and a resolver that leaves the ".." in makes
    // this test report a covered file as uncovered.
    let abs = path.startsWith('/') ? path : '/notes/bcba/' + path.replace(/^\.\//, '');
    const parts = [];
    for (const seg of abs.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    abs = parts.join('/');
    return rules.some((r) => {
      if (!r.headers['cache-control']) return false;
      const p = r.pattern;
      if (p.endsWith('/*')) return abs.startsWith(p.slice(0, -1));
      if (p.includes('*')) {
        const [pre, post] = p.split('*');
        return abs.startsWith(pre) && abs.endsWith(post);
      }
      return abs === p;
    });
  };

  const uncovered = srcs.filter((s) => !covered(s));
  expect(uncovered, `these load with the default cache and can go stale independently: ${uncovered.join(', ')}`)
    .toEqual([]);
});

test('the vendored files really are version-stamped, or immutable is a lie', () => {
  const html = readFileSync(join(ROOT, 'notes/bcba/index.html'), 'utf8');
  const vendored = [...html.matchAll(/src="(\/vendor\/[^"]+)"/g)].map((m) => m[1]);
  expect(vendored.length).toBeGreaterThan(0);
  for (const v of vendored) {
    expect(v, `${v} is served immutable but carries no version, so it can never be updated`)
      .toMatch(/\d+\.\d+\.\d+/);
  }
});
