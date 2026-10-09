import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/* Security headers on every response (#141).
 *
 * apps/tools/_headers never reached a browser: a _worker.js puts Pages in
 * advanced mode, which does not apply _headers. The Worker now sets these on
 * the way out of fetch() for every route, and `wrangler pages dev` runs that
 * same Worker, so these assertions are about what production sends.
 *
 * The set matches apps/games/_headers. The microphone stays allowed for this
 * site because dictation needs it, which is the one place it differs.
 */

const EXPECTED = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

function expectSiteHeaders(path, headers) {
  for (const [name, value] of Object.entries(EXPECTED)) {
    expect(headers[name], `${path} is missing ${name}`).toBe(value);
  }
  const pp = headers['permissions-policy'] || '';
  expect(pp, `${path} lets a page ask for the camera`).toContain('camera=()');
  expect(pp, `${path} lets a page ask for location`).toContain('geolocation=()');
  expect(pp, `${path} blocks the microphone, which dictation needs`).toContain('microphone=(self)');
}

test('every page carries the security headers', async ({ request }) => {
  for (const path of ['/', '/notes/bcba/', '/notes/sup', '/notes/parent/', '/admin/', '/graphVA/', '/SuggestFeature/', '/cpr/dist/']) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), `${path} did not load`).toBe(200);
    expectSiteHeaders(path, res.headers());
  }
});

test('static files, API answers and redirects carry them too', async ({ request }) => {
  const asset = await request.get('/assets/notes-gate.js');
  expect(asset.status()).toBe(200);
  expectSiteHeaders('/assets/notes-gate.js', asset.headers());

  // An unauthenticated API call is answered by the Worker's own JSON.
  const api = await request.post('/api/llm-call', { data: {} });
  expect(api.status()).toBe(401);
  expectSiteHeaders('/api/llm-call', api.headers());

  const redirect = await request.get('/cpr', { maxRedirects: 0 });
  expect(redirect.status()).toBe(301);
  expectSiteHeaders('/cpr', redirect.headers());
});

test('the account pages keep their own stricter policy', async ({ request }) => {
  // withAccountLinkHeaders runs first and the site layer fills only what is
  // absent, so the locked-down CSP and no-store survive.
  const res = await request.get('/account/');
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h['content-security-policy']).toContain("default-src 'none'");
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['cache-control']).toBe('no-store');
  expect(h['x-frame-options']).toBe('DENY');
});

test('_headers is gone, so nothing reads as live configuration that is not', () => {
  // Advanced mode ignores it. A file that does nothing and looks like config
  // is how #141 stayed hidden for a month.
  expect(existsSync(join(__dirname, '..', '_headers'))).toBe(false);
});
