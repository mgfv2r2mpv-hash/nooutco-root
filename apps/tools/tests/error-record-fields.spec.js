import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import {
  errorRecordFields,
  errorFingerprint,
  recordError,
  listErrors,
  ERROR_RECORD_DAYS,
  REQUEST_IDS_KEPT,
} from '../worker/error-record.js';

// Issue #152, the record's shape. The durable error record is allowed to hold
// time, tool name, route, error class and code, HTTP status, upstream status,
// request ids and the deployed build, and nothing else. These tests feed note
// text into every input the failing path has and then read back every byte the
// fake KV holds, so a field that leaks is caught wherever it lands.

const sha256Hex = async (s) => createHash('sha256').update(String(s)).digest('hex');

function fakeKv() {
  const store = new Map();
  const puts = [];
  return {
    store,
    puts,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value, opts) { puts.push({ key, opts }); store.set(key, value); },
    async list({ prefix }) {
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

const fakeRequest = (path, headers = {}) => new Request('https://tools.example' + path, { method: 'POST', headers });

// Invented, and shaped like the real thing: a scrubbed note body still reads as
// clinical prose, and a client name is what a scrub miss looks like.
const NOTE_BODY = 'Jane Example eloped twice during circle time and was redirected with a visual schedule.';
const NAME = 'Jane Example';

const ALLOWED_KEYS = [
  'day', 'fingerprint', 'tool', 'noteTool', 'route', 'errorClass', 'errorCode',
  'status', 'upstreamStatus', 'source', 'requestIds', 'build', 'count', 'first', 'last',
];

test.describe('the error record holds structure only', () => {
  test('a note body passed into the failing path never reaches the record', async () => {
    const kv = fakeKv();
    const error = new TypeError(NOTE_BODY);
    const fields = errorRecordFields({
      tool: 'llm-call',
      meta: NOTE_BODY,
      diagnostics: { stage: NAME, parseError: `Unexpected token 'J', "${NOTE_BODY}" is not valid JSON`, status: NAME },
      context: {
        request: fakeRequest('/api/llm-call.js', { 'cf-ray': '8f1e2d3c4b5a6978-IAD' }),
        status: 500,
        error,
        code: 'unhandled',
        noteTool: 'bt',
      },
      env: { CF_PAGES_COMMIT_SHA: 'abcdef1234567890abcdef1234567890abcdef12' },
    });
    await recordError(kv, sha256Hex, { fields });

    const everything = JSON.stringify([...kv.store.entries()]);
    expect(everything).not.toContain('Jane');
    expect(everything).not.toContain('eloped');
    expect(everything).not.toContain('circle time');

    const [record] = [...kv.store.entries()].filter(([k]) => k.startsWith('errrec:')).map(([, v]) => JSON.parse(v));
    expect(Object.keys(record).sort()).toEqual([...ALLOWED_KEYS].sort());
    expect(record).toMatchObject({
      tool: 'llm-call',
      noteTool: 'bt',
      route: '/api/llm-call',
      errorClass: 'TypeError',
      errorCode: 'unhandled',
      status: 500,
      upstreamStatus: null,
      source: 'server',
      requestIds: ['8f1e2d3c4b5a6978-IAD'],
      build: 'abcdef123456',
      count: 1,
    });
  });

  test('the upstream status is read off the code-written prefix and nothing after it', async () => {
    const msg = `Anthropic API error 529: Overloaded while reading "${NOTE_BODY}"`;
    const fields = errorRecordFields({
      tool: 'llm-call',
      context: { request: fakeRequest('/api/llm-call'), status: 500, error: new Error(msg), code: 'unhandled' },
    });
    expect(fields.upstreamStatus).toBe(529);
    expect(JSON.stringify(fields)).not.toContain('Jane');
  });

  test('anything a caller can type is held to an allow-list or dropped', () => {
    const fields = errorRecordFields({
      tool: NAME,
      meta: 'client (unauthenticated)',
      diagnostics: { stage: 'parse', status: '502' },
      context: {
        request: fakeRequest('/api/error-report', { 'cf-ray': NAME }),
        noteTool: NAME,
        code: NAME,
        error: Object.assign(new Error('x'), { name: NAME }),
      },
      env: { CF_PAGES_COMMIT_SHA: NAME },
    });
    expect(fields.tool).toBe('(other)');
    expect(fields.noteTool).toBe(null);
    expect(fields.errorClass).toBe('Error');
    expect(fields.requestIds).toEqual([]);
    expect(fields.build).toBe(null);
    // The client's own stage and status are kept only because both are on a
    // fixed list: a stage from the three the browser writes, a 3-digit status.
    expect(fields.errorCode).toBe('parse');
    expect(fields.status).toBe(502);
    expect(fields.source).toBe('client (unauthenticated)');
    expect(fields.route).toBe('/api/error-report');
  });

  test('a stage outside the fixed list and a source the code did not write are dropped', () => {
    const fields = errorRecordFields({
      tool: 'bt',
      meta: NOTE_BODY,
      diagnostics: { stage: NAME },
      context: { request: fakeRequest('/api/error-report') },
    });
    expect(fields.errorCode).toBe(null);
    expect(fields.source).toBe('server');
  });

  test('the fingerprint is built from the structure, so it carries nothing of the message', async () => {
    const base = { tool: 'llm-call', context: { request: fakeRequest('/api/llm-call'), status: 500, code: 'unhandled' } };
    const a = await errorFingerprint(sha256Hex, errorRecordFields(base));
    const b = await errorFingerprint(sha256Hex, errorRecordFields(base));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
    const c = await errorFingerprint(sha256Hex, errorRecordFields({ ...base, context: { ...base.context, status: 503 } }));
    expect(c).not.toBe(a);
  });

  test('repeats count on one record, keep the newest request ids, and expire on a TTL', async () => {
    const kv = fakeKv();
    for (let i = 0; i < REQUEST_IDS_KEPT + 3; i++) {
      const ray = i.toString(16).padStart(16, '0');
      const fields = errorRecordFields({
        tool: 'expert-pass',
        context: { request: fakeRequest('/api/expert-pass', { 'cf-ray': ray }), status: 500, code: 'unhandled' },
      });
      await recordError(kv, sha256Hex, { fields });
    }
    const { records, total } = await listErrors(kv, { days: 1 });
    expect(records).toHaveLength(1);
    expect(total).toBe(REQUEST_IDS_KEPT + 3);
    expect(records[0].requestIds).toHaveLength(REQUEST_IDS_KEPT);
    expect(records[0].requestIds[0]).toBe((REQUEST_IDS_KEPT + 2).toString(16).padStart(16, '0'));
    const recordPuts = kv.puts.filter((p) => p.key.startsWith('errrec:'));
    expect(recordPuts.every((p) => p.opts && p.opts.expirationTtl === ERROR_RECORD_DAYS * 86400)).toBe(true);
  });

  test('a record written before this shape is shown without its old free-text fields', async () => {
    const kv = fakeKv();
    const day = new Date().toISOString().slice(0, 10);
    kv.store.set(`errrec:${day}:0123456789abcdef`, JSON.stringify({
      day, fingerprint: '0123456789abcdef', tool: 'bt', source: 'client (authenticated)',
      count: 4, first: new Date().toISOString(), last: new Date().toISOString(),
      diagnostics: { stage: 'parse', parseError: `"${NOTE_BODY}" is not valid JSON` },
    }));
    const body = await listErrors(kv, { days: 1 });
    expect(body.records).toHaveLength(1);
    expect(body.records[0].count).toBe(4);
    expect(JSON.stringify(body)).not.toContain('Jane');
    expect(Object.keys(body.records[0]).every((k) => ALLOWED_KEYS.includes(k))).toBe(true);
  });

  test('recording never throws, even with no store', async () => {
    const fields = errorRecordFields({ tool: 'login' });
    await expect(recordError(null, sha256Hex, { fields })).resolves.toBe(null);
    const broken = { get: async () => { throw new Error('kv down'); }, put: async () => {} };
    await expect(recordError(broken, sha256Hex, { fields })).resolves.toBe(null);
  });
});
