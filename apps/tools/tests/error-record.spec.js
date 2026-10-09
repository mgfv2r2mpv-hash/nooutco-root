import { test, expect } from '@playwright/test';
import { createHmac, randomBytes } from 'node:crypto';

// Issue #152: a production error leaves a durable record a human reviews the
// next morning, counted on every occurrence before the email throttle, and the
// record never holds note text, a name, prompt text, model output or anything a
// user typed. Runs against the real _worker.js through `wrangler pages dev`,
// with a genuinely signed token.
//
// ONE PROJECT ONLY. The record is grouped by structure (tool, route, status),
// so a test can no longer mint a tool name of its own to stay apart from the
// other browsers sharing this local KV. The counting tests run on chromium and
// read a before/after delta, found by a request id this test sends itself.
// The local dev server passes a client's cf-ray through; Cloudflare's edge
// overwrites it in production.

const SECRET = 'playwright-local-test-secret';
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function tokenFor({ kid, role }) {
  const payload = { role, kid, tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
  const payloadStr = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', SECRET).update(payloadStr).digest());
  return `${payloadStr}.${sig}`;
}
const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const ADMIN = () => tokenFor({ role: 'admin', kid: 'pw:admin' });
const TECH = () => tokenFor({ role: 'user', kid: 'pw:tech-1' });
const ray = () => randomBytes(8).toString('hex');

// Invented. Shaped like a scrubbed note that a scrub missed a name in.
const NOTE_BODY = 'Jane Example eloped twice during circle time and was redirected with a visual schedule.';

async function readRecords(request) {
  const res = await request.get('/api/admin/errors.js?days=1', { headers: auth(ADMIN()) });
  expect(res.status()).toBe(200);
  return res.json();
}
const countFor = (body, match) =>
  body.records.filter(match).reduce((n, r) => n + (r.count || 0), 0);

test.describe('the production error record', () => {
  test('refuses anyone who is not an admin', async ({ request }) => {
    expect((await request.get('/api/admin/errors.js')).status()).toBe(401);
    expect((await request.get('/api/admin/errors.js', { headers: auth(TECH()) })).status()).toBe(401);
  });

  test('a client report counts every occurrence and keeps nothing it typed', async ({ request }, info) => {
    test.skip(info.project.name !== 'chromium', 'counts read a shared local store; one project counts');
    const before = countFor(await readRecords(request), (r) => r.tool === 'bt' && r.errorCode === 'parse' && r.status === 418);
    const id = ray();
    for (let i = 0; i < 3; i++) {
      const res = await request.post('/api/error-report.js', {
        headers: { 'cf-ray': id },
        data: {
          tool: 'bt',
          message: NOTE_BODY,
          // A modified client can put anything in these, and a real Chrome
          // JSON.parse error quotes the model output it failed on.
          diagnostics: { stage: 'parse', status: 418, parseError: `Unexpected token 'J', "${NOTE_BODY}" is not valid JSON` },
        },
      });
      expect(res.status()).toBe(200);
    }
    const body = await readRecords(request);
    const mine = body.records.filter((r) => (r.requestIds || []).includes(id));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      tool: 'bt',
      route: '/api/error-report',
      errorCode: 'parse',
      status: 418,
      source: 'client (unauthenticated)',
    });
    expect(mine[0].fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(countFor(body, (r) => r.tool === 'bt' && r.errorCode === 'parse' && r.status === 418) - before).toBe(3);
    const text = JSON.stringify(body);
    expect(text).not.toContain('Jane');
    expect(text).not.toContain('eloped');
  });

  test('a note tool failing on the server leaves a record with no note body in it', async ({ request }, info) => {
    test.skip(info.project.name !== 'chromium', 'counts read a shared local store; one project counts');
    // The local dev server has no PROMPTS binding, so a migrated note tool
    // fails closed with a 503 on /api/llm-call, carrying a real note body in.
    const id = ray();
    const res = await request.post('/api/llm-call.js', {
      headers: { ...auth(ADMIN()), 'cf-ray': id },
      data: { tool: 'sup', system_suffix: 'STYLE', messages: [{ role: 'user', content: NOTE_BODY }] },
    });
    expect(res.status()).toBe(503);
    const body = await readRecords(request);
    const mine = body.records.filter((r) => (r.requestIds || []).includes(id));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      tool: 'prompt-api',
      noteTool: 'sup',
      route: '/api/llm-call',
      errorCode: 'prompt_unavailable',
      status: 503,
      source: 'server',
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain('Jane');
    expect(text).not.toContain('STYLE');
  });
});
