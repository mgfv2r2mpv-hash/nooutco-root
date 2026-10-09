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
// These tests read RESPONSES, not a file (#141). They used to parse _headers,
// and stayed green while production served max-age=14400, because a _worker.js
// puts Pages in advanced mode and advanced mode never applies _headers. The
// rules now live in _worker.js (SITE_CACHE_RULES), and `wrangler pages dev`
// runs that same Worker, so a header asserted here is a header a browser gets.

const ROOT = join(__dirname, '..');
const REVALIDATES = /no-cache|no-store|max-age=0\b/;

async function cacheControlOf(request, path) {
  const res = await request.get(path, { maxRedirects: 0 });
  expect(res.status(), `${path} did not answer`).toBeLessThan(400);
  return res.headers()['cache-control'] || '';
}

test('the files that must move together are served revalidating', async ({ request }) => {
  for (const path of [
    '/assets/notes-gate.js',
    '/assets/notes-scrub.js',
    '/assets/nav-bar.css',
    '/notes/notes-page.css',
    '/notes/bcba/engine.jsx',
    '/notes/bcba/',
    '/notes/sup',
    '/tokens.css',
    '/admin/',
  ]) {
    expect(await cacheControlOf(request, path), `${path} can go stale independently of the page`)
      .toMatch(REVALIDATES);
  }
});

test('the vendored libraries are immutable, which is what makes this cheap', async ({ request }) => {
  // Their version is in the filename, so a change to React is a change to the
  // URL. Revalidating 3MB of Babel on every page load would be the wrong trade.
  const cc = await cacheControlOf(request, '/vendor/react-18.3.1.production.min.js');
  expect(cc).toMatch(/immutable/);
  expect(cc).toMatch(/max-age=\d{6,}/);
});

test('a missing vendored file is not cached for a year', async ({ request }) => {
  // Pages answers a path with no file with the root page and a 200. Cached
  // immutable under a library's name, that page would stand in for the library
  // until the version in the filename changed.
  const res = await request.get('/vendor/not-a-real-file-9.9.9.js');
  expect(res.headers()['cache-control'] || '').not.toMatch(/immutable/);
});

test('every lockstep file the notes page loads is served revalidating or immutable', async ({ request }) => {
  // The real risk is a file nobody thought about. Read the page and ask the
  // server for each same-origin asset it pulls.
  const html = readFileSync(join(ROOT, 'notes/bcba/index.html'), 'utf8');
  const srcs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((s) => !/^https?:/.test(s))
    .map((s) => new URL(s, 'http://x/notes/bcba/').pathname);
  expect(srcs.length).toBeGreaterThan(5);

  const loose = [];
  for (const path of srcs) {
    const cc = await cacheControlOf(request, path);
    if (!REVALIDATES.test(cc) && !/immutable/.test(cc)) loose.push(`${path} (${cc || 'no header'})`);
  }
  expect(loose, 'these load with the default cache and can go stale independently').toEqual([]);
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
