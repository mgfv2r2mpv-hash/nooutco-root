import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import {
  expertPassRequest,
  expertSchema,
  orderExpertHints,
  expertFindings,
  expertLimits,
} from '../_worker.js';

/* The expert pass.
 *
 * WHAT IT IS FOR. The hint channel every note tool uses today is a catalog of
 * eight fixed codes per tool. It can say "behavior noted without a count". It
 * cannot say "you wrote 'he wanted attention', and that is a function claim",
 * because there is no code for it and never will be without an edit to five
 * browser files. The expert pass runs BESIDE that channel with the ABA glossary
 * and the mentalism lexicon in front of it, and this suite pins the parts of it
 * that are the Worker's rather than the model's.
 *
 * The shape rules are pure, so they are tested directly. The refusals and the
 * fail-closed behaviour go through the real Worker under `wrangler pages dev`,
 * because "does it actually refuse" is not a claim worth making against a mock.
 */

const SECRET = 'playwright-local-test-secret';
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function adminToken() {
  const payload = { role: 'admin', kid: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 };
  const payloadStr = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', SECRET).update(payloadStr).digest());
  return `${payloadStr}.${sig}`;
}
const auth = () => ({ Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' });

test.describe('what the pass accepts', () => {
  test('a tool and an intake are both required', () => {
    expect(expertPassRequest({ intake: 'x' }).error).toMatch(/tool/i);
    expect(expertPassRequest({ tool: 'bt' }).error).toMatch(/intake/i);
    expect(expertPassRequest({ tool: 'bt', intake: '   ' }).error).toMatch(/intake/i);
    expect(expertPassRequest(undefined).error).toBeTruthy();
  });

  test('an oversized intake is refused rather than truncated', () => {
    const n = expertLimits().intakeChars;
    expect(expertPassRequest({ tool: 'bt', intake: 'x'.repeat(n) }).error).toBeUndefined();
    expect(expertPassRequest({ tool: 'bt', intake: 'x'.repeat(n + 1) }).error).toMatch(/longer/i);
  });

  test('sections are optional, and absent means every finding is about the note', () => {
    expect(expertPassRequest({ tool: 'bt', intake: 'x' }).sections).toEqual([]);
    expect(expertPassRequest({ tool: 'bt', intake: 'x', sections: 'nope' }).error).toMatch(/array/i);
  });

  test('a section id is checked rather than trusted, because it reaches a schema enum', () => {
    // This value is put into an enum that goes to the upstream API. Prose, or
    // anything with structure in it, is refused here rather than forwarded.
    expect(expertPassRequest({ tool: 'bt', intake: 'x', sections: ['clinicalStatus'] }).sections)
      .toEqual(['clinicalStatus']);
    for (const bad of ['has space', 'quote"inside', '', 'x'.repeat(expertLimits().sectionIdChars + 1)]) {
      expect(expertPassRequest({ tool: 'bt', intake: 'x', sections: [bad] }).error).toBeTruthy();
    }
    expect(expertPassRequest({ tool: 'bt', intake: 'x', sections: [1, 2] }).error).toBeTruthy();
    const many = Array.from({ length: expertLimits().sections + 1 }, (_, i) => `s${i}`);
    expect(expertPassRequest({ tool: 'bt', intake: 'x', sections: many }).error).toMatch(/too many/i);
  });

  test('"note" and duplicates are dropped, so no value lands in the enum twice', () => {
    // The whole-note key is added by the schema builder. A caller that also
    // sends it would produce an enum with the same string in it twice, which
    // some validators reject and none of them need.
    const r = expertPassRequest({ tool: 'bt', intake: 'x', sections: ['a', 'note', 'a', 'b'] });
    expect(r.sections).toEqual(['a', 'b']);
  });
});

test.describe('the response shape the Worker fixes', () => {
  test('the schema is built here, so no caller can ask the pass for another shape', () => {
    const s = expertSchema(['alpha', 'beta']);
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(['terms', 'register', 'hints']);
    expect(s.properties.hints.items.properties.section.enum).toEqual(['alpha', 'beta', 'note']);
    expect(s.properties.terms.items.properties.status.enum).toEqual(['resolved', 'ambiguous', 'unknown']);
    expect(s.properties.register.items.properties.action.enum).toEqual(['reframe', 'ask', 'remove', 'keep']);
    expect(s.properties.hints.items.properties.kind.enum).toEqual(['blocks-claim', 'thin', 'register']);
  });

  test('the four register actions are the lexicon\'s own, keep included', () => {
    // keep is the one that stops over-correction: a feeling with its
    // observation beside it, and an observed zero, are both correct as written.
    // Dropping it from the enum would leave the model no way to say so.
    expect(expertSchema([]).properties.register.items.properties.action.enum).toContain('keep');
  });

  test('a whole-note finding has somewhere to go even when the tool has no sections', () => {
    expect(expertSchema([]).properties.hints.items.properties.section.enum).toEqual(['note']);
    expect(expertSchema(undefined).properties.hints.items.properties.section.enum).toEqual(['note']);
  });

  test('a full section list still leaves the schema well inside the Worker\'s own bound', () => {
    // sanitizeOutputConfig refuses a schema over 20000 characters, and this one
    // is built rather than sent, so an overrun would be a 500 nobody could act
    // on rather than a 400 somebody could.
    const many = Array.from({ length: expertLimits().sections }, (_, i) => `section_${i}`);
    expect(JSON.stringify(expertSchema(many)).length).toBeLessThan(20000);
  });
});

test.describe('ordering the hints', () => {
  test('the sort runs before the cut, which is the lesson from the catalog channel', () => {
    // A bare slice on an unordered list throws away whatever arrived last and
    // calls it a priority. Rank 1 must survive a ceiling it was emitted past.
    const ceiling = expertLimits().hintCeiling;
    const raw = Array.from({ length: ceiling + 5 }, (_, i) => ({ ask: `q${i}`, rank: ceiling + 5 - i }));
    const out = orderExpertHints(raw);
    expect(out.hints.length).toBe(ceiling);
    expect(out.hints[0].rank).toBe(1);
    expect(out.dropped).toBe(5);
  });

  test('an unranked hint sinks below every ranked one rather than being dropped', () => {
    // A missing rank is the model declining to order, not the finding being
    // worthless.
    const out = orderExpertHints([{ ask: 'none' }, { ask: 'two', rank: 2 }, { ask: 'one', rank: 1 }]);
    expect(out.hints.map((h) => h.ask)).toEqual(['one', 'two', 'none']);
  });

  test('equal ranks keep the order they were emitted in', () => {
    const out = orderExpertHints([{ ask: 'a', rank: 1 }, { ask: 'b', rank: 1 }, { ask: 'c', rank: 1 }]);
    expect(out.hints.map((h) => h.ask)).toEqual(['a', 'b', 'c']);
  });

  test('nothing that was cut is cut silently', () => {
    expect(orderExpertHints([]).dropped).toBe(0);
    expect(orderExpertHints('not an array')).toEqual({ hints: [], dropped: 0 });
  });
});

test.describe('reading the model back', () => {
  const wrap = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

  test('a complete answer comes back with all three lists', () => {
    const out = expertFindings(wrap({
      terms: [{ token: 'SBT', reading: 'Skills-Based Treatment', status: 'resolved', why: '' }],
      register: [{ quote: 'he wanted attention', action: 'reframe', why: 'function claim', move: 'name what followed' }],
      hints: [{ section: 'note', rank: 1, kind: 'thin', ask: 'how many times?', why: '' }],
    }));
    expect(out.terms[0].token).toBe('SBT');
    expect(out.register[0].action).toBe('reframe');
    expect(out.hints[0].ask).toBe('how many times?');
    expect(out.hintsDropped).toBe(0);
  });

  test('a truncated or unreadable answer fails closed rather than returning half a pass', () => {
    // Half an expert pass is indistinguishable from a complete one that found
    // less, and the second is a claim about the note that nothing checked.
    expect(expertFindings({ content: [{ type: 'text', text: '{"terms":[{"token":"SB' }] })).toBe(null);
    expect(expertFindings({ content: [{ type: 'text', text: '   ' }] })).toBe(null);
    expect(expertFindings({ content: [] })).toBe(null);
    expect(expertFindings({})).toBe(null);
    expect(expertFindings(null)).toBe(null);
    expect(expertFindings({ content: [{ type: 'text', text: '[1,2,3]' }] })).toBe(null);
  });

  test('a missing list is an empty list, because an empty answer is a real answer', () => {
    // The prompt tells it that finding no mentalism is a result rather than a
    // gap. The reader has to agree, or a clean note reads as a broken call.
    const out = expertFindings(wrap({ terms: [], register: [], hints: [] }));
    expect(out).toEqual({ terms: [], register: [], hints: [], hintsDropped: 0 });
    expect(expertFindings(wrap({ terms: [{ token: 'FA' }] })).register).toEqual([]);
  });

  test('the hints come back ordered, so a caller cannot lose the ranking by ignoring it', () => {
    const out = expertFindings(wrap({
      terms: [], register: [],
      hints: [{ ask: 'third', rank: 3 }, { ask: 'first', rank: 1 }, { ask: 'second', rank: 2 }],
    }));
    expect(out.hints.map((h) => h.ask)).toEqual(['first', 'second', 'third']);
  });
});

test.describe('the live route', () => {
  test('it refuses a caller with no session token', async ({ request }) => {
    const res = await request.post('/api/expert-pass', {
      headers: { 'Content-Type': 'application/json' },
      data: { tool: 'bt', intake: 'session went well' },
    });
    expect(res.status()).toBe(401);
  });

  test('a malformed request is refused on its shape, before anything upstream', async ({ request }) => {
    const res = await request.post('/api/expert-pass', { headers: auth(), data: { tool: 'bt' } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/intake/i);
  });

  test('with no prompt binding it fails closed and says nothing was sent', async ({ request }) => {
    // The PROMPTS binding is not bound in dev. Answering anyway, out of whatever
    // the model knows about ABA on its own, is the exact failure this whole
    // build exists to stop: findings that read like expert findings and are not.
    const res = await request.post('/api/expert-pass', {
      headers: auth(),
      data: { tool: 'bt', intake: 'Ran SBT. He wanted attention.', sections: ['clinicalStatus'] },
    });
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/expert is unavailable/i);
    expect(body.error).toMatch(/nothing was sent/i);
  });

  test('a GET reaches no handler, so an intake can never ride in a query string', async ({ request }) => {
    /* A query string is the one place a scrubbed note must never be: it is
       logged by every hop that touches the request, which is the opposite of
       what the whole de-identify-before-send control is for.

       THE STATUS IS NOT THE EVIDENCE HERE. This Worker serves the app's HTML
       for any path it does not route, so a miss is a 200 and not a 404. What
       proves nothing ran is the content type: HTML back means the static
       fallback answered and the route did not. */
    const res = await request.get('/api/expert-pass?intake=secret');
    expect(res.headers()['content-type'] || '').toMatch(/text\/html/);
    expect(await res.text()).not.toMatch(/"terms"/);
  });

  test('the drafting route is untouched by any of this', async ({ request }) => {
    /* The pass runs BESIDE the loop. If adding it changed what /api/llm-call
       does for a tool that has not opted in, the comparison this phase is for
       would be measuring two changes at once.

       THE VEHICLE CHANGED AND THE INTENT DID NOT. This sent `system` for parent
       and asked only that the answer was not a 400. Then parent migrated to the
       server-side store, where sending `system` IS a 400 and is meant to be, so
       the test began failing over the single thing it was never about. A
       migrated tool sends `system_suffix`; what proves the drafting path is
       still whole is that a well-formed call gets past shape-checking and fails
       where every drafting call fails in dev - no PROMPTS binding, nothing sent.

       Asserting the 503 rather than merely `not 400` is the stronger claim: it
       separates "the contract still accepts this request" from "the route
       stopped existing", and only the first of those is what this test wants. */
    const res = await request.post('/api/llm-call', {
      headers: auth(),
      data: { tool: 'parent', system_suffix: 'PER-NOTE BLOCK', messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.status(), 'a 400 would mean the expert pass moved the drafting contract').not.toBe(400);
    expect(res.status()).toBe(503);
    expect((await res.json()).error).toMatch(/nothing was sent/i);
  });
});
