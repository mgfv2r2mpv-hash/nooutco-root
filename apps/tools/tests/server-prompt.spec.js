import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { serverPromptRequest, composeServerSystem, isServerPromptTool, serverPromptTools, promptKinds, maxSystemSuffix, promptKeyFor } from '../_worker.js';

/* Accessors rather than exported constants, and the reason is load-bearing:
 * workerd refuses to start on a named export that is not a function, so a
 * `export const MAX_SYSTEM_SUFFIX = 8000` takes the whole Worker down at boot.
 * See the comment beside them in _worker.js. */

/* The system prompt moves off the public web.
 *
 * Until 2026-08-16 the browser built the whole system prompt and posted it, so
 * every prompt had to be downloadable for the tool to work: tools.nooutco.me
 * served 145 KB of them. The same shape meant /api/llm-call took `systemPrompt`
 * from the request body, and while the scope check limited which TOOL a login
 * could claim, nothing checked the prompt. Anyone with a password could run any
 * prompt on the account's Anthropic key.
 *
 * The composition rules are pure, so they are tested directly. The refusal and
 * the fail-closed behaviour go through the real Worker under
 * `wrangler pages dev`, because "does it actually refuse" is not a claim worth
 * making against a mock.
 */

const SECRET = 'playwright-local-test-secret';
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function adminToken() {
  // Admin, so the per-login scope check is bypassed and these tests measure the
  // prompt behaviour rather than KV state in a dev server.
  const payload = { role: 'admin', kid: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 };
  const payloadStr = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', SECRET).update(payloadStr).digest());
  return `${payloadStr}.${sig}`;
}
const auth = () => ({ Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' });

test.describe('which tools compose server-side', () => {
  test('every note tool is migrated, and graphva is not', () => {
    // All five as of 2026-08-20. The list is spelled out rather than derived so
    // that dropping a tool from the Worker's Set is a named failure here and not
    // a silently reopened hole.
    expect(serverPromptTools()).toEqual(['assess', 'bt', 'parent', 'sap', 'sup']);
    // graphVA/app.js posts to /api/llm-call with its own short prompt inline. It
    // is the one caller left that sends its own, and it is deliberate: this line
    // is what stops it being migrated by accident rather than on purpose.
    expect(isServerPromptTool('graphva'), 'graphva has not migrated; it must still send its own prompt').toBe(false);
  });

  test('a migrated tool with its own triage prompt names the stored copy', () => {
    // This test used to assert that NO migrated tool had a triageSystem, and it
    // said in its own comment what to do when one needed an override: publish it
    // and give it a kind. sap did, on 2026-08-20, so this is now the stronger
    // form of the same guard.
    //
    // engine.jsx still has ONE triage branch. A migrated tool asks for a stored
    // prompt by kind, and triageKind picks which. A tool that kept its override
    // and lost the key would fall back to "triage": the call succeeds, the model
    // answers, and a clinician is asked about behavior counts instead of prompt
    // hierarchies. Nothing errors. That is what this catches.
    const dir = path.join(process.cwd(), 'notes/bcba/tools');
    for (const tool of serverPromptTools()) {
      const src = readFileSync(path.join(dir, `${tool}.js`), 'utf8');
      const override = /triageSystem\s*:/.test(src);
      const kind = src.match(/triageKind:\s*"([a-z_]+)"/);
      if (!override) {
        expect(kind, `${tool}.js names a triageKind but has no triage prompt of its own`).toBe(null);
        continue;
      }
      expect(kind, `${tool}.js defines triageSystem but no triageKind, so its override is silently ignored`).not.toBe(null);
      // The kind has to be one the Worker will actually fetch. An unrecognised
      // one is refused, and the engine's catch swallows a failed triage, so the
      // technician would lose the gap questions with nothing shown.
      expect(promptKinds(), `${tool}.js asks for a prompt kind the Worker does not know`).toContain(kind[1]);
    }
  });

  test('sap is the tool that has one, and it points at sap_triage', () => {
    // Stated positively as well as structurally. The loop above would still pass
    // if sap's override and its key were both deleted.
    const src = readFileSync(path.join(process.cwd(), 'notes/bcba/tools/sap.js'), 'utf8');
    expect(/triageSystem\s*:/.test(src)).toBe(true);
    expect(src).toContain('triageKind: "sap_triage"');
    expect(promptKinds()).toContain('sap_triage');
  });

  test('the browser flag and the Worker set agree', () => {
    // Two lists, one truth. They can only be kept in step by something that
    // reads both, because the browser copy is a flag on the tool and the Worker
    // copy is a Set, and nothing else compares them.
    const dir = path.join(process.cwd(), 'notes/bcba/tools');
    for (const tool of ['sup', 'bt', 'parent', 'assess', 'sap']) {
      const src = readFileSync(path.join(dir, `${tool}.js`), 'utf8');
      const declares = /serverPrompt:\s*true/.test(src);
      expect(
        declares,
        `${tool}.js ${declares ? 'declares' : 'does not declare'} serverPrompt, but the Worker ` +
        `${isServerPromptTool(tool) ? 'does' : 'does not'} treat it as migrated`
      ).toBe(isServerPromptTool(tool));
    }
  });
});

test.describe('serverPromptRequest', () => {
  test('a tool that has not migrated is untouched', () => {
    // graphva, because every note tool has migrated now and this needs an
    // example that is really left out rather than one that is about to move.
    expect(serverPromptRequest({ system: 'ANYTHING' }, 'graphva')).toEqual({ serverSide: false });
    expect(serverPromptRequest({}, undefined)).toEqual({ serverSide: false });
  });

  test('a migrated tool that still sends a system prompt is refused, not corrected', () => {
    // Ignoring it would leave the caller believing their prompt was used, and
    // leave this hole looking shut while it stayed open for anyone still sending
    // the old shape.
    for (const body of [{ system: 'MINE' }, { systemPrompt: 'MINE' }, { system: '' }]) {
      const r = serverPromptRequest(body, 'sup');
      expect(r.serverSide).toBe(true);
      expect(r.error).toBeTruthy();
      expect(r.suffix).toBeUndefined();
    }
  });

  test('a prompt kind names a prompt in the store and carries no text', () => {
    // Triage is the only kind today. It sends no system, no systemPrompt and no
    // suffix, because nothing measured in the page belongs in a call that
    // writes no prose.
    expect(serverPromptRequest({ prompt_kind: 'triage' }, 'bt'))
      .toEqual({ serverSide: true, kind: 'triage', suffix: '' });
    expect(promptKeyFor('bt', 'triage')).toBe('triage');
    expect(promptKeyFor('bt', undefined)).toBe('bt');
  });

  test('an unrecognised kind is refused, because it selects a key in a private store', () => {
    const r = serverPromptRequest({ prompt_kind: 'anything-else' }, 'bt');
    expect(r.serverSide).toBe(true);
    expect(r.error).toMatch(/Unknown prompt_kind/);
  });

  test('a kind carrying a suffix is refused rather than quietly stripped', () => {
    // Same reasoning as the system field: a caller that believes it sent a
    // style card must not be told nothing while the model never sees one.
    const r = serverPromptRequest({ prompt_kind: 'triage', system_suffix: 'STYLE' }, 'bt');
    expect(r.error).toMatch(/takes no system_suffix/);
  });

  test('the per-note suffix is accepted, because the browser measured it', () => {
    const r = serverPromptRequest({ system_suffix: 'STYLE-CARD' }, 'sup');
    expect(r).toEqual({ serverSide: true, suffix: 'STYLE-CARD' });
  });

  test('a missing suffix is a note without a style card, not an error', () => {
    expect(serverPromptRequest({}, 'sup')).toEqual({ serverSide: true, suffix: '' });
    expect(serverPromptRequest({ system_suffix: 42 }, 'sup')).toEqual({ serverSide: true, suffix: '' });
  });

  test('an oversized suffix is refused', () => {
    const r = serverPromptRequest({ system_suffix: 'x'.repeat(maxSystemSuffix() + 1) }, 'sup');
    expect(r.error).toBeTruthy();
    expect(serverPromptRequest({ system_suffix: 'x'.repeat(maxSystemSuffix()) }, 'sup').error).toBeUndefined();
  });
});

test.describe('composeServerSystem', () => {
  test('reproduces exactly what the browser used to build', () => {
    // The browser did: buildSystem() + (block ? "\n\n" + block : "")
    expect(composeServerSystem('PROMPT', 'BLOCK')).toBe('PROMPT\n\nBLOCK');
  });

  test('an empty or blank suffix adds nothing at all', () => {
    // A trailing blank line would change the cached prefix for every note that
    // has no style card yet, which is every note a new technician writes.
    expect(composeServerSystem('PROMPT', '')).toBe('PROMPT');
    expect(composeServerSystem('PROMPT', '   \n  ')).toBe('PROMPT');
    expect(composeServerSystem('PROMPT', undefined)).toBe('PROMPT');
  });

  test('no base means no prompt, never a partial one', () => {
    expect(composeServerSystem(null, 'BLOCK')).toBe(null);
    expect(composeServerSystem('', 'BLOCK')).toBe(null);
    expect(composeServerSystem(42, 'BLOCK')).toBe(null);
  });
});

test.describe('the live route', () => {
  test('a migrated tool carrying a system prompt is refused with 400', async ({ request }) => {
    const res = await request.post('/api/llm-call', {
      headers: auth(),
      data: { tool: 'sup', system: 'I WROTE THIS MYSELF', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/system_suffix/i);
  });

  test('the refusal happens before anything reaches the model', async ({ request }) => {
    // No ANTHROPIC_API_KEY in dev. A 400 rather than a 503 proves the request was
    // rejected on its shape, before any upstream call was considered.
    const res = await request.post('/api/llm-call', {
      headers: auth(),
      data: { tool: 'sup', systemPrompt: 'MINE', userPrompt: 'hi' },
    });
    expect(res.status()).toBe(400);
  });

  test('with no prompt binding, sup fails closed and says nothing was sent', async ({ request }) => {
    // The PROMPTS binding is not bound in dev, which is also production's state
    // until it is added. Falling back to a client prompt here would be the hole
    // itself, so the only correct answer is a refusal.
    const res = await request.post('/api/llm-call', {
      headers: auth(),
      data: { tool: 'sup', system_suffix: 'STYLE', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not drafted|unavailable/i);
    expect(body.error).toMatch(/nothing was sent/i);
  });

  test('a tool that has not migrated still sends its own prompt', async ({ request }) => {
    // The example is always a tool that has not moved yet, which is what keeps
    // this test meaning something. It named bt until bt migrated, then parent
    // until 2026-08-20, and now graphva - which is a genuine endpoint rather
    // than a placeholder: graphVA/app.js really does post here with its own
    // inline system prompt, so this is the path a real caller takes today.
    const res = await request.post('/api/llm-call', {
      headers: auth(),
      data: { tool: 'graphva', system: 'GRAPHVA PROMPT', messages: [{ role: 'user', content: 'hi' }] },
    });
    // No API key in dev, so it gets as far as the upstream call and fails there.
    // The point is that it is NOT a 400 and NOT a 503 about prompts.
    expect(res.status()).not.toBe(400);
    if (res.status() === 503) expect((await res.json()).error).not.toMatch(/prompt service/i);
  });
});
