import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { composeVoice, composeOpinions } from '../_worker.js';

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

// The opinions block: his discretionary clinical calls, gated far harder than
// the voice block because it decides content rather than style. His rulings of
// 2026-08-04 are encoded as tests so they cannot be quietly relaxed later.
const OPINIONS = {
  ...BLOCK,
  opinions: { 'clinical-narrative': 'GUM-ENTRY', interpersonal: 'EMAIL-OPINION' },
};
const ASKED = { wantsRecommendation: true };

test.describe('composeOpinions', () => {
  test('ruling 2: nothing fires unless the caller explicitly asked', () => {
    // An opinion never fills a silence in the input. This is the single most
    // load-bearing assertion in the file: every tool that never adopts the flag
    // behaves exactly as it did before opinions existed.
    expect(composeOpinions('SYSTEM', OPINIONS, 'sup', undefined)).toBe('SYSTEM');
    expect(composeOpinions('SYSTEM', OPINIONS, 'sup', {})).toBe('SYSTEM');
    expect(composeOpinions('SYSTEM', OPINIONS, 'sup', { wantsRecommendation: false })).toBe('SYSTEM');
    // Only a literal true opens the gate, so a truthy string from a JSON body
    // cannot open it by accident.
    expect(composeOpinions('SYSTEM', OPINIONS, 'sup', { wantsRecommendation: 'yes' })).toBe('SYSTEM');
  });

  test('appends the entry for the asking tool, after the system prompt', () => {
    const out = composeOpinions('SYSTEM', OPINIONS, 'sup', ASKED);
    expect(out.startsWith('SYSTEM')).toBe(true);
    expect(out).toContain('GUM-ENTRY');
    expect(out.indexOf('SYSTEM')).toBeLessThan(out.indexOf('HIS CLINICAL JUDGEMENT'));
  });

  test('picks the register mapped to the tool, not another one', () => {
    const out = composeOpinions('SYSTEM', OPINIONS, 'parent', ASKED);
    expect(out).toContain('EMAIL-OPINION');
    expect(out).not.toContain('GUM-ENTRY');
  });

  test('the BT tool gets nothing even when it asks', () => {
    // His judgement is not the technician's to sign. `bt` is absent from the
    // allowlist, and asking must not be a way around that.
    expect(composeOpinions('SYSTEM', OPINIONS, 'bt', ASKED)).toBe('SYSTEM');
  });

  test('a tool with a voice register but no opinions gets nothing', () => {
    // Unlike the voice block, there is no graceful degradation here: with no
    // entry for the register there is no judgement to apply, and inventing one
    // is the whole failure mode this module exists to prevent.
    const out = composeOpinions('SYSTEM', BLOCK, 'sup', ASKED);
    expect(out).toBe('SYSTEM');
    expect(composeOpinions('SYSTEM', { ...OPINIONS, opinions: {} }, 'sup', ASKED)).toBe('SYSTEM');
    expect(composeOpinions('SYSTEM', { ...OPINIONS, opinions: { 'clinical-narrative': '  ' } }, 'sup', ASKED)).toBe('SYSTEM');
  });

  test('fails open on a missing block or a non-string system', () => {
    expect(composeOpinions('SYSTEM', null, 'sup', ASKED)).toBe('SYSTEM');
    expect(composeOpinions('SYSTEM', OPINIONS, undefined, ASKED)).toBe('SYSTEM');
    expect(composeOpinions(undefined, OPINIONS, 'sup', ASKED)).toBe(undefined);
  });

  test('the header carries rulings 1 and 3 and the no-invented-reason rule', () => {
    // If any of these assertions is ever deleted, a ruling he made has been
    // dropped from the prompt without anyone noticing.
    const out = composeOpinions('SYSTEM', OPINIONS, 'sup', ASKED);
    expect(out).toMatch(/THE INPUT WINS/);            // ruling 3
    expect(out).toMatch(/state plainly which entry you set/i); // ruling 3, "and he is told"
    expect(out).toMatch(/NEVER INVENT A REASON/);     // failure mode 1
    expect(out).toMatch(/SCOPE IS BINDING/);          // failure mode 3
    expect(out).toMatch(/`preference` must be attributed to him/); // ruling 1
    expect(out).toMatch(/none of it is a finding/i);  // failure mode 2
  });

  test('stacks after the voice block without disturbing it', () => {
    const voiced = composeVoice('SYSTEM', OPINIONS, 'sup');
    const both = composeOpinions(voiced, OPINIONS, 'sup', ASKED);
    expect(both).toContain('CORE-RULES');
    expect(both).toContain('NARRATIVE-DELTA');
    expect(both.indexOf('HOUSE VOICE')).toBeLessThan(both.indexOf('HIS CLINICAL JUDGEMENT'));
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
