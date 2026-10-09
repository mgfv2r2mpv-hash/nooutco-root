import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

/* A scoped login code opens exactly the tools it names, and nothing else.
 *
 * Two gaps found while checking the scoped-password handoff of 2026-08-27:
 *
 * 1. "bcba" is the page at /notes/bcba/, not a tool id. The admin handlers
 *    filtered unknown ids out and kept the rest, so ["sup", "bcba"] saved as
 *    ["sup"] without a word. Now an unknown id is a 400 that names it.
 *
 * 2. /api/llm-call checked scope only when the body named a tool, so a scoped
 *    token that left `tool` out spent the account's key on anything. Every
 *    caller sends `tool`, and expert-pass and corrections-pass already refuse
 *    without one. Now llm-call does too.
 *
 * These run against the real _worker.js through `wrangler pages dev` with a
 * genuinely signed token and a real local KV. The local server has no API key,
 * so a call that passes the scope check stops at 503 "key is not configured",
 * which is what tells it apart from the 403 a refused scope returns.
 */

const SECRET = 'playwright-local-test-secret';
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function sign(payload) {
  const s = b64url(new TextEncoder().encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload })));
  return `${s}.${b64url(createHmac('sha256', SECRET).update(s).digest())}`;
}
const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const ADMIN = () => auth(sign({ role: 'admin' }));
const uniq = () => `scope-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function create(request, tools) {
  const res = await request.post('/api/admin/passwords', { headers: ADMIN(), data: { label: uniq(), password: uniq(), tools } });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

test.describe('the tool ids a login code carries', () => {
  test('"bcba" is refused at creation, by name, rather than saved as an empty scope', async ({ request }) => {
    const { status, body } = await create(request, ['bcba']);
    expect(status).toBe(400);
    expect(body.error).toContain('bcba');
    expect(body.error).toContain('sup');
  });

  test('an unknown id beside a real one is refused too, not quietly dropped', async ({ request }) => {
    const { status, body } = await create(request, ['sup', 'bcba']);
    expect(status).toBe(400);
    expect(body.error).toContain('bcba');
  });

  test('an edit that adds an unknown id is refused and the scope is left as it was', async ({ request }) => {
    const made = await create(request, ['sup']);
    expect(made.status).toBe(200);

    const res = await request.patch('/api/admin/passwords', { headers: ADMIN(), data: { id: made.body.id, tools: ['sup', 'bcba'] } });
    expect(res.status()).toBe(400);

    const list = await (await request.get('/api/admin/passwords', { headers: ADMIN() })).json();
    expect(list.passwords.find((p) => p.id === made.body.id).tools).toEqual(['sup']);
  });

  test('every real tool id is still accepted', async ({ request }) => {
    const { status, body } = await create(request, ['bt', 'sup', 'parent', 'assess', 'sap', 'graphva']);
    expect(status).toBe(200);
    expect(body.tools).toEqual(['bt', 'sup', 'parent', 'assess', 'sap', 'graphva']);
  });
});

test.describe('a scoped token on /api/llm-call', () => {
  const singleShot = { systemPrompt: 'Return {}.', userPrompt: 'Nothing here.' };

  test('naming no tool is refused, not waved past the scope', async ({ request }) => {
    const { body } = await create(request, ['graphva']);
    const token = sign({ role: 'user', kid: body.id, tools: ['graphva'] });
    const res = await request.post('/api/llm-call', { headers: auth(token), data: singleShot });
    expect(res.status()).toBe(403);
  });

  test('naming a tool outside the scope is refused', async ({ request }) => {
    const { body } = await create(request, ['sup']);
    const token = sign({ role: 'user', kid: body.id, tools: ['sup'] });
    const res = await request.post('/api/llm-call', { headers: auth(token), data: { ...singleShot, tool: 'graphva' } });
    expect(res.status()).toBe(403);
  });

  test('naming a tool inside the scope passes the check', async ({ request }) => {
    const { body } = await create(request, ['graphva']);
    const token = sign({ role: 'user', kid: body.id, tools: ['graphva'] });
    const res = await request.post('/api/llm-call', { headers: auth(token), data: { ...singleShot, tool: 'graphva' } });
    // Past the scope check, the local server has no API key to spend.
    expect(res.status()).toBe(503);
  });

  test('an admin token still needs no tool', async ({ request }) => {
    const res = await request.post('/api/llm-call', { headers: ADMIN(), data: singleShot });
    expect(res.status()).toBe(503);
  });
});
