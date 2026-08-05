import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { composeVoice, composeOpinions, VOICE_COVERAGE } from '../_worker.js';

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

// Stances: his standing commitments about how a person is described. His ruling
// of 2026-08-04 was "always on, as framing, never as a recommendation", which is
// why these ride the voice block and are NOT behind the want_opinions gate.
const STANCED = {
  ...BLOCK,
  stances: { 'clinical-narrative': 'RAT-IS-RIGHT', interpersonal: 'EMAIL-STANCE' },
};

test.describe('stances', () => {
  test('ship without anyone asking, unlike an opinion', () => {
    // The whole point of the ruling. A stance gated behind a request would be
    // silent in every document that is not asking for advice, which is all of them.
    const out = composeVoice('SYSTEM', STANCED, 'sup');
    expect(out).toContain('RAT-IS-RIGHT');
    expect(out).toContain('HOW HE DESCRIBES PEOPLE');
  });

  test('are declared framing rather than advice', () => {
    // If this assertion goes, the guard that stops a standing commitment from
    // turning into an unrequested clinical recommendation went with it.
    const out = composeVoice('SYSTEM', STANCED, 'sup');
    expect(out).toMatch(/framing, not advice/i);
    expect(out).toMatch(/never produce a recommendation/i);
    expect(out).toMatch(/never .*soften a clinical fact/i);
  });

  test('follow the same allowlist: the BT tool gets none', () => {
    expect(composeVoice('SYSTEM', STANCED, 'bt')).toBe('SYSTEM');
  });

  test('pick the register mapped to the tool', () => {
    const out = composeVoice('SYSTEM', STANCED, 'parent');
    expect(out).toContain('EMAIL-STANCE');
    expect(out).not.toContain('RAT-IS-RIGHT');
  });

  test('a block with no stances composes exactly as before', () => {
    expect(composeVoice('SYSTEM', BLOCK, 'sup')).toBe(composeVoice('SYSTEM', BLOCK, 'sup'));
    expect(composeVoice('SYSTEM', BLOCK, 'sup')).not.toContain('HOW HE DESCRIBES PEOPLE');
  });

  test('a stance still ships when the register has no voice card', () => {
    // The two are independent. A missing card must not silently drop a standing
    // commitment he ruled always-on.
    const orphan = { ...STANCED, core: '', registers: {} };
    const out = composeVoice('SYSTEM', orphan, 'sup');
    expect(out).toContain('RAT-IS-RIGHT');
  });

  test('order is voice, then stance, then opinions', () => {
    const both = { ...STANCED, opinions: { 'clinical-narrative': 'GUM-ENTRY' } };
    const out = composeOpinions(composeVoice('SYSTEM', both, 'sup'), both, 'sup', { wantsRecommendation: true });
    expect(out.indexOf('HOUSE VOICE')).toBeLessThan(out.indexOf('HOW HE DESCRIBES PEOPLE'));
    expect(out.indexOf('HOW HE DESCRIBES PEOPLE')).toBeLessThan(out.indexOf('HIS CLINICAL JUDGEMENT'));
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

// Obligations: what his field requires, not what he prefers. He drew the line
// himself, so these tests hold it.
const OBLIGED = {
  ...BLOCK,
  obligations: { 'clinical-narrative': 'RESTRICTIVE-PROCEDURE-RULE' },
};

test.describe('obligations', () => {
  test('ship unasked, like a stance and unlike an opinion', () => {
    const out = composeVoice('SYSTEM', OBLIGED, 'sup');
    expect(out).toContain('RESTRICTIVE-PROCEDURE-RULE');
    expect(out).toContain('PROFESSIONAL REQUIREMENTS');
  });

  test('are never his preference and are never overruled by the input', () => {
    // The two properties that separate an obligation from an opinion. If either
    // assertion goes, an ethics-code requirement can leave as a personal view a
    // reader is invited to weigh, or be silently dropped when the input differs.
    const out = composeVoice('SYSTEM', OBLIGED, 'sup');
    expect(out).toMatch(/not preferences/i);
    expect(out).toMatch(/never present one as a personal view/i);
    expect(out).toMatch(/the input does not overrule these/i);
    expect(out).toMatch(/gap in the record/i);
  });

  test('follow the allowlist, so the BT tool gets none', () => {
    expect(composeVoice('SYSTEM', OBLIGED, 'bt')).toBe('SYSTEM');
  });

  test('a block with no obligations composes exactly as before', () => {
    expect(composeVoice('SYSTEM', BLOCK, 'sup')).not.toContain('PROFESSIONAL REQUIREMENTS');
  });
});

/* Voice coverage per tool.
 *
 * The tool-to-register mapping lives in KV, not here, so a tool added to
 * NOTES_TOOLS can miss the voice entirely and nothing in this repo would say so.
 * That is not hypothetical: `bt` is excluded deliberately, and for a while the
 * only record of that being a DECISION rather than an oversight was a comment in
 * a local render script that never ships.
 *
 * These tests make the omission loud.
 */
test.describe('voice coverage', () => {
  test('every shipped note tool has an explicit voice decision', async () => {
    // Playwright runs with apps/tools as cwd (playwright.config.js lives there).
    // import.meta is unavailable because this package is not ESM.
    const src = readFileSync(path.join(process.cwd(), '_worker.js'), 'utf8');
    const shipped = (src.match(/const NOTES_TOOLS = \[(.*?)\]/s)[1] || '')
      .split(',').map((t) => t.trim().replace(/["']/g, '')).filter(Boolean);

    expect(shipped.length).toBeGreaterThan(0);
    for (const tool of shipped) {
      expect(
        VOICE_COVERAGE[tool],
        `"${tool}" is shipped but has no entry in VOICE_COVERAGE. Decide whether it ` +
        `receives the house voice, and say why if it does not.`
      ).toBeDefined();
    }
    // And nothing declared that is not shipped, which would be a stale reason
    // outliving the tool it was written about.
    for (const tool of Object.keys(VOICE_COVERAGE)) {
      expect(shipped, `VOICE_COVERAGE names "${tool}", which is not in NOTES_TOOLS`).toContain(tool);
    }
  });

  test('an exclusion carries a reason, not just a false', async () => {
    for (const [tool, v] of Object.entries(VOICE_COVERAGE)) {
      if (v === 'kv') continue;
      expect(typeof v, `"${tool}" is excluded, so it must say why`).toBe('string');
      expect(v.length, `the reason for excluding "${tool}" is too short to be one`).toBeGreaterThan(40);
    }
  });

  test('bt is on the allowlist but takes only the stances and the obligations', () => {
    // This test used to assert bt was excluded outright, and it failed the moment
    // he split it - which is what it was for. The rule it now pins is his:
    // "give bt the stances and obligations but not the voice card or the calls."
    expect(VOICE_COVERAGE.bt).toBe('kv');
    const src = readFileSync(path.join(process.cwd(), '_worker.js'), 'utf8');
    // The reason for the split lives next to the entry, so a future tidy-up
    // cannot quietly turn it into a full inclusion.
    expect(src).toMatch(/the technician signs the note/i);
  });
});

/* Per-tool layers, and the BT split.
 *
 * His ruling of 2026-08-04 split BT rather than including or excluding it whole:
 * "give bt the stances and obligations but not the voice card or the calls."
 * How a person is described and what the ethics code requires belong to the
 * practice; his sentence habits and his discretionary calls do not, because the
 * technician signs the note.
 */
const SPLIT = {
  enabled: true,
  core: 'CORE-RULES',
  registers: { 'clinical-narrative': 'NARRATIVE-DELTA', 'technician-note': 'TECH-CARD' },
  stances: { 'clinical-narrative': 'STANCE', 'technician-note': 'STANCE' },
  obligations: { 'clinical-narrative': 'OBLIGATION', 'technician-note': 'RBT-OBLIGATION' },
  opinions: { 'clinical-narrative': 'GUM-ENTRY', 'technician-note': 'BT-CALL-ENTRY' },
  toolRegister: { sup: 'clinical-narrative', bt: 'technician-note' },
  toolLayers: { bt: ['stances', 'obligations'] },
};

test.describe('per-tool layers', () => {
  test('BT takes the stances and the obligations', () => {
    const out = composeVoice('SYSTEM', SPLIT, 'bt');
    expect(out).toContain('STANCE');
    expect(out).toContain('RBT-OBLIGATION');
  });

  test('BT takes neither his voice card nor his core', () => {
    // The technician signs this note. His sentence habits are not theirs.
    const out = composeVoice('SYSTEM', SPLIT, 'bt');
    expect(out).not.toContain('CORE-RULES');
    expect(out).not.toContain('TECH-CARD');
  });

  test('the BT note takes no opinions: nobody asked, and the technician signs it', () => {
    expect(composeOpinions('SYSTEM', SPLIT, 'bt', {})).toBe('SYSTEM');
    expect(composeOpinions('SYSTEM', SPLIT, 'bt', {})).not.toContain('BT-CALL-ENTRY');
  });

  test('a BT advice call takes them, because the answer is his', () => {
    // The layer split governs the note. "What would you do here" is not a note.
    const asked = { wantsRecommendation: true };
    expect(composeOpinions('SYSTEM', SPLIT, 'bt', asked)).toContain('BT-CALL-ENTRY');
    const out = composeVoice('SYSTEM', SPLIT, 'bt', asked);
    expect(out).toContain('CORE-RULES');
    expect(out).toContain('TECH-CARD');
  });

  test('a tool with no declared layers still takes all of them', () => {
    // Every existing tool must behave exactly as it did before layers existed.
    const out = composeVoice('SYSTEM', SPLIT, 'sup');
    expect(out).toContain('CORE-RULES');
    expect(out).toContain('NARRATIVE-DELTA');
    expect(out).toContain('STANCE');
    expect(out).toContain('OBLIGATION');
    expect(composeOpinions('SYSTEM', SPLIT, 'sup', { wantsRecommendation: true })).toContain('GUM-ENTRY');
  });
});

/* An advisory call is him answering, not a document the technician signs.

   His ruling of 2026-08-05: "'What would you do here' should draw on my clinical
   voice, registers, the system's accumulated domain knowledge, and my opinions
   to answer so that it isn't a canned answer but as close to a certified Bx
   analyst answering as possible."

   The per-tool layer split still governs every document. It stops governing the
   moment the caller asks for a recommendation, because there is no note for his
   habits to contaminate - there is only the answer, read by the person who asked. */
test.describe('an advisory call takes the whole stack', () => {
  const SPLIT = {
    enabled: true,
    core: 'CORE-RULES',
    registers: { 'clinical-narrative': 'NARRATIVE-DELTA' },
    stances: { 'clinical-narrative': 'STANCE-TEXT' },
    obligations: { 'clinical-narrative': 'OBLIGATION-TEXT' },
    opinions: { 'clinical-narrative': 'OPINION-TEXT' },
    toolRegister: { bt: 'clinical-narrative' },
    toolLayers: { bt: ['stances', 'obligations'] },
  };

  test('the note keeps the split: no voice card, no calls', () => {
    const out = composeVoice('SYSTEM', SPLIT, 'bt');
    expect(out).toContain('STANCE-TEXT');
    expect(out).toContain('OBLIGATION-TEXT');
    expect(out, 'his sentence habits do not belong in a note the technician signs').not.toContain('CORE-RULES');
    expect(out).not.toContain('NARRATIVE-DELTA');
    expect(composeOpinions('SYSTEM', SPLIT, 'bt', {})).toBe('SYSTEM');
  });

  test('the answer gets the voice card, the register, and the calls', () => {
    const asked = { wantsRecommendation: true };
    const out = composeVoice('SYSTEM', SPLIT, 'bt', asked);
    expect(out, 'his clinical voice').toContain('CORE-RULES');
    expect(out, 'the register he answers in').toContain('NARRATIVE-DELTA');
    expect(out).toContain('STANCE-TEXT');
    expect(out).toContain('OBLIGATION-TEXT');
    expect(composeOpinions(out, SPLIT, 'bt', asked), 'his opinions').toContain('OPINION-TEXT');
  });

  test('the allowlist still decides: an unlisted tool gets nothing for asking', () => {
    const asked = { wantsRecommendation: true };
    expect(composeVoice('SYSTEM', SPLIT, 'sup', asked)).toBe('SYSTEM');
    expect(composeOpinions('SYSTEM', SPLIT, 'sup', asked)).toBe('SYSTEM');
  });
});

/* The advice register: BT writes in `technician-note`, which holds stances and
   obligations and nothing else. The answer to a question is not that document,
   so it moves onto the register he addresses staff in and the one his clinical
   calls are filed under. */
test.describe('the advice register', () => {
  const ADV = {
    enabled: true,
    core: 'CORE-RULES',
    registers: { 'technician-note': '', instructional: 'TEACHING-CARD', 'clinical-narrative': 'DOC-CARD' },
    stances: { 'technician-note': 'SHARED-STANCE', instructional: 'SHARED-STANCE\n\nTEACHING-STANCE' },
    obligations: { 'technician-note': 'RBT-CODE', instructional: 'TEACHING-DUTY' },
    opinions: { 'clinical-narrative': 'HIS-CALLS', instructional: 'WRONG-CALLS' },
    toolRegister: { bt: 'technician-note' },
    toolLayers: { bt: ['stances', 'obligations'] },
    toolAdvice: { bt: { register: 'instructional', opinions: 'clinical-narrative' } },
  };
  const asked = { wantsRecommendation: true };

  test('the answer takes the teaching card, not the documentation one', () => {
    const out = composeVoice('SYSTEM', ADV, 'bt', asked);
    expect(out).toContain('TEACHING-CARD');
    expect(out, 'a note card would make the answer read like a note').not.toContain('DOC-CARD');
  });

  test('the calls come from where his judgement is filed', () => {
    const out = composeOpinions('SYSTEM', ADV, 'bt', asked);
    expect(out).toContain('HIS-CALLS');
    expect(out).not.toContain('WRONG-CALLS');
  });

  test('both registers bind: the code the asker works under, and how he answers', () => {
    const out = composeVoice('SYSTEM', ADV, 'bt', asked);
    expect(out, 'the RBT code binds whoever acts on the answer').toContain('RBT-CODE');
    expect(out).toContain('TEACHING-DUTY');
    expect(out).toContain('TEACHING-STANCE');
  });

  test('a stance the two registers share arrives once, not twice', () => {
    const out = composeVoice('SYSTEM', ADV, 'bt', asked);
    expect(out.match(/SHARED-STANCE/g)).toHaveLength(1);
  });

  test('the note ignores all of it', () => {
    const out = composeVoice('SYSTEM', ADV, 'bt');
    expect(out).not.toContain('TEACHING-CARD');
    expect(out).not.toContain('TEACHING-STANCE');
    expect(out).not.toContain('TEACHING-DUTY');
    expect(out).toContain('SHARED-STANCE');
    expect(out).toContain('RBT-CODE');
  });

  test('a tool with no advice entry is unaffected, asking or not', () => {
    const plain = { ...ADV, toolAdvice: {} };
    expect(composeVoice('SYSTEM', plain, 'bt', asked)).not.toContain('TEACHING-CARD');
    expect(composeOpinions('SYSTEM', plain, 'bt', asked)).toBe('SYSTEM');
  });
});
