import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

// Issue #152: a production error leaves a durable record a human reviews the
// next morning, counted on every occurrence before the email throttle, and the
// record never holds the message text. Runs against the real _worker.js
// through `wrangler pages dev`, with a genuinely signed token.

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

test.describe('the production error record', () => {
  test('refuses anyone who is not an admin', async ({ request }) => {
    expect((await request.get('/api/admin/errors.js')).status()).toBe(401);
    expect((await request.get('/api/admin/errors.js', { headers: auth(TECH()) })).status()).toBe(401);
  });

  test('counts every occurrence and keeps no message text', async ({ request }, info) => {
    const tool = `spec-${info.project.name}-${Date.now()}`;
    const message = 'Spec failure quoting Jane Example from a model reply';
    for (let i = 0; i < 3; i++) {
      const res = await request.post('/api/error-report.js', { data: { tool, message, diagnostics: { stage: 'parse' } } });
      expect(res.status()).toBe(200);
    }
    const res = await request.get('/api/admin/errors.js?days=1', { headers: auth(ADMIN()) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const mine = body.records.filter((r) => r.tool === tool);
    expect(mine).toHaveLength(1);
    expect(mine[0].count).toBe(3);
    expect(mine[0].fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(mine[0].diagnostics).toEqual({ stage: 'parse' });
    expect(mine[0].source).toBe('client (unauthenticated)');
    expect(JSON.stringify(body)).not.toContain('Jane');
  });
});
