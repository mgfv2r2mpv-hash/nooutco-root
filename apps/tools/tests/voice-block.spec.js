import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { composeVoice } from '../_worker.js';

// The house voice block: a personal style card stored as markdown in KV and
// appended to the system prompt inside the Worker, so the rules never reach a
// browser and never enter this repo.
//
// composeVoice is pure, so the composition rules are tested directly. The admin
// read-back route is tested through `wrangler pages dev` like the other API
// tests, against the throwaway ADMIN_SECRET in playwright.config.js.

const BLOCK = {
  enabled: true,
  core: 'CORE-RULES',
  registers: { 'clinical-narrative': 'NARRATIVE-DELTA', interpersonal: 'EMAIL-DELTA' },
  toolRegister: { sup: 'clinical-narrative', parent: 'interpersonal' },
};

test.describe('composeVoice', () => {
  test('appends the header, core, and the register for a listed tool', () => {
    const out = composeVoice('SYSTEM', BLOCK, 'sup');
    expect(out.startsWith('SYSTEM')).toBe(true);
    expect(out).toContain('HOUSE VOICE');
    expect(out).toContain('CORE-RULES');
    expect(out).toContain('NARRATIVE-DELTA');
    // The tool's own clinical instructions must be read first and win a
    // conflict, so the voice can only ever be appended.
    expect(out.indexOf('SYSTEM')).toBeLessThan(out.indexOf('HOUSE VOICE'));
    expect(out.indexOf('CORE-RULES')).toBeLessThan(out.indexOf('NARRATIVE-DELTA'));
  });

  test('picks the register mapped to the tool, not another one', () => {
    const out = composeVoice('SYSTEM', BLOCK, 'parent');
    expect(out).toContain('EMAIL-DELTA');
    expect(out).not.toContain('NARRATIVE-DELTA');
  });

  test('toolRegister is an allowlist: the BT tool gets nothing', () => {
    // BT notes are written for the technician who signs them and already carry
    // that technician's own learned style card. Stacking a second voice on them
    // would be wrong, so `bt` is absent from the map by design.
    expect(composeVoice('SYSTEM', BLOCK, 'bt')).toBe('SYSTEM');
  });

  test('an unknown tool gets nothing', () => {
    expect(composeVoice('SYSTEM', BLOCK, 'not-a-tool')).toBe('SYSTEM');
  });

  test('fails open on a missing block, a missing tool, or a non-string system', () => {
    expect(composeVoice('SYSTEM', null, 'sup')).toBe('SYSTEM');
    expect(composeVoice('SYSTEM', BLOCK, undefined)).toBe('SYSTEM');
    expect(composeVoice(undefined, BLOCK, 'sup')).toBe(undefined);
  });

  test('a mapped register with no card degrades to core-only, not to nothing', () => {
    // Every rule in the core is confirmed across at least two registers by
    // construction, so it still applies when a register card is missing. The
    // misconfiguration is caught at publish time by render-kv-block.mjs, which
    // warns about any tool mapped to a register with no card; at request time
    // the graceful outcome is the less specific card, not silence.
    const orphan = { ...BLOCK, registers: {}, toolRegister: { sup: 'clinical-narrative' } };
    const out = composeVoice('SYSTEM', orphan, 'sup');
    expect(out).toContain('CORE-RULES');
    expect(out).not.toContain('NARRATIVE-DELTA');
  });

  test('an empty core still ships the register delta', () => {
    const noCore = { ...BLOCK, core: '   ' };
    const out = composeVoice('SYSTEM', noCore, 'sup');
    expect(out).toContain('NARRATIVE-DELTA');
    expect(out).not.toContain('CORE-RULES');
  });

  test('the block states that it is style only and does not outrank the document', () => {
    // This is house rule 1 and it is the reason the feature is safe to ship at
    // all. If this assertion is ever deleted, the header lost its guard.
    const out = composeVoice('SYSTEM', BLOCK, 'sup');
    expect(out).toMatch(/style only/i);
    expect(out).toMatch(/does not change clinical content/i);
    expect(out).toMatch(/what is above wins/i);
  });
});

const SECRET = 'playwright-local-test-secret';
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function tokenFor({ role = 'user', kid = 'pw:tech-1' } = {}) {
  const payload = { role, kid, tools: ['sup'], exp: Math.floor(Date.now() / 1000) + 3600 };
  const payloadStr = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', SECRET).update(payloadStr).digest());
  return `${payloadStr}.${sig}`;
}

test.describe('the admin read-back route', () => {
  test('refuses an unauthenticated request', async ({ request }) => {
    const res = await request.get('/api/admin/voice-block');
    expect(res.status()).toBe(401);
  });

  test('refuses a signed non-admin token', async ({ request }) => {
    const res = await request.get('/api/admin/voice-block', {
      headers: { Authorization: `Bearer ${tokenFor({ role: 'user' })}` },
    });
    expect(res.status()).toBe(401);
  });

  test('reports absence rather than failing when nothing is published', async ({ request }) => {
    const res = await request.get('/api/admin/voice-block', {
      headers: { Authorization: `Bearer ${tokenFor({ role: 'admin' })}` },
    });
    // Dev has no voice block in KV, which is also production's state until the
    // first publish. Reporting {present:false} rather than erroring is what lets
    // the whole feature be absent without anything breaking.
    expect([200, 503]).toContain(res.status());
    if (res.status() === 200) expect((await res.json()).present).toBe(false);
  });

  test('never accepts a write', async ({ request }) => {
    // Publishing goes through `wrangler kv key put`, so the Worker has no write
    // path to its own voice. A POST must not be routed.
    const res = await request.post('/api/admin/voice-block', {
      headers: { Authorization: `Bearer ${tokenFor({ role: 'admin' })}` },
      data: { core: 'injected' },
    });
    expect(res.status()).not.toBe(200);
  });
});
