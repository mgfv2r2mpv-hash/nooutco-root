import { test, expect } from '@playwright/test';
import { knowledgeOp } from '../_worker.js';

/* The console's door into the knowledge store.
 *
 * WHAT THIS SUITE IS ACTUALLY GUARDING. The store lives in a Worker with no
 * public URL, no routes, and no auth of its own - ingress is the whole security
 * control. The console is a page. So the one thing that must never be true is
 * that a page gets to choose which internal path this Worker fetches, because
 * that would turn "unreachable from the web" into "reachable through us".
 *
 * The console therefore names an OPERATION and the Worker owns the map from
 * operation to path. These tests are the allowlist's, and they are pure, so they
 * run without a Worker at all.
 */

const params = (qs) => new URLSearchParams(qs);

test.describe('the browser never names the upstream path', () => {
  test('an unknown operation is refused rather than fetched', () => {
    expect(knowledgeOp('anything', 'GET', params('')).error).toMatch(/Unknown knowledge operation/);
    expect(knowledgeOp('', 'GET', params('')).error).toBeTruthy();
    expect(knowledgeOp(undefined, 'GET', params('')).error).toBeTruthy();
    expect(knowledgeOp('/knowledge', 'GET', params('')).error).toBeTruthy();
  });

  test('a path cannot be smuggled in as an operation name', () => {
    for (const attempt of [
      '../../system?tool=expert',
      '/knowledge/fetch-log',
      'list/../fetch-log',
      'http://evil.example/x',
      '__proto__',
      'constructor',
    ]) {
      expect(knowledgeOp(attempt, 'GET', params('')).path, `${attempt} resolved to a path`).toBeUndefined();
    }
  });

  test('the fetch log is not reachable from the browser at all', () => {
    // Elevation evidence decides which rules get promoted into every note
    // tool's prompt. A page that could post its own fetch records could
    // manufacture a promotion, so only the Worker writes that log, server-side,
    // during a real expert call. It has no operation name on purpose.
    expect(knowledgeOp('fetch-log', 'POST', null).error).toMatch(/Unknown knowledge operation/);
    expect(knowledgeOp('fetchLog', 'POST', null).error).toBeTruthy();
    expect(knowledgeOp('log', 'POST', null).error).toBeTruthy();
  });

  test('an operation may only be called with the method it is', () => {
    // A commit arriving as a GET would be a state change reachable from a link,
    // an image tag, or a prefetch.
    expect(knowledgeOp('commit', 'GET', params('')).error).toMatch(/is a POST/);
    expect(knowledgeOp('retire', 'GET', params('')).error).toMatch(/is a POST/);
    expect(knowledgeOp('list', 'POST', null).error).toMatch(/is a GET/);
    expect(knowledgeOp('candidates', 'POST', null).error).toMatch(/is a GET/);
  });
});

test.describe('what reaches the internal query string', () => {
  test('only the parameters an operation declares survive', () => {
    const r = knowledgeOp('history', 'GET', params('id=kn_abc&state=staged&op=list'));
    expect(r.path).toBe('/knowledge/history?id=kn_abc');
  });

  test('a parameter that is not a plain token is dropped, not escaped and hoped for', () => {
    for (const bad of ['../../x', 'a b', "a'b", 'a&b=c', 'a#b', 'x'.repeat(65)]) {
      const r = knowledgeOp('history', 'GET', params(`id=${encodeURIComponent(bad)}`));
      expect(r.path, `${bad} survived`).toBe('/knowledge/history');
    }
  });

  test('the numeric knobs on elevation pass through when they are numeric', () => {
    const r = knowledgeOp('candidates', 'GET', params('minFetches=8&minMoved=4&since=1700000000000'));
    expect(r.path).toBe('/knowledge/candidates?minFetches=8&minMoved=4&since=1700000000000');
  });

  test('every declared operation resolves to a path under /knowledge', () => {
    for (const [op, method] of [
      ['list', 'GET'],
      ['proposals', 'GET'],
      ['candidates', 'GET'],
      ['history', 'GET'],
      ['propose', 'POST'],
      ['commit', 'POST'],
      ['reject', 'POST'],
      ['retire', 'POST'],
    ]) {
      const r = knowledgeOp(op, method, params(''));
      expect(r.error, `${op} was refused`).toBeUndefined();
      expect(r.path.startsWith('/knowledge')).toBe(true);
    }
  });
});
