import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import {
  scrubBatch,
  scrubBudget,
  scrubOutcome,
  scrubLimits,
  runScrubLearning,
} from '../_worker.js';

/* The nightly scrub-learning run.
 *
 * WHAT WENT WRONG, because every test here is shaped by it. The job answered
 * {"ok":true} on every run from June to August while writing nothing at all.
 * Three separate things had to be true for that to stay invisible for two
 * months, and this suite pins all three.
 *
 *   The call carried max_tokens 512. Thirteen certified terms need more JSON
 *   than that, so the response was cut off inside the suggestions array, a
 *   greedy brace match handed JSON.parse a truncated array, and the parse
 *   threw. stop_reason came back "max_tokens" on every one of those runs and
 *   nothing read it.
 *
 *   The endpoint returned a bare ok whatever happened, so the nightly Action
 *   went green on every one of those nights and the admin button said "Run
 *   complete" to a run that had completed nothing.
 *
 *   The run only ever read terms certified since midnight today, so the 213
 *   terms certified while the crons were blocked could not be reached however
 *   many times it ran.
 *
 * The shape rules are pure and are tested directly. The run itself is tested
 * against a fake KV and a stubbed model call, because "did it mark the batch
 * seen" and "did it write nothing on failure" are claims about what the
 * function does to storage, and a mock is the only place to watch that.
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

/* ── the backlog window ──────────────────────────────────────────────────── */

const certified = (term, day) => ({ term, certifiedAt: `2026-${day}T12:00:00.000Z` });

test.describe('which terms a run looks at', () => {
  test('reads the whole store, not only the terms certified today', () => {
    // The filter this replaced compared certifiedAt against midnight today, so a
    // term certified on a night the cron could not run had no second chance.
    const { batch } = scrubBatch({ nonPii: [certified('transition', '06-15')] });
    expect(batch).toEqual(['transition']);
  });

  test('takes the oldest first, so the stranded terms drain before the new ones', () => {
    const { batch } = scrubBatch({
      nonPii: [certified('newest', '08-25'), certified('oldest', '06-01'), certified('middle', '07-10')],
    });
    expect(batch).toEqual(['oldest', 'middle', 'newest']);
  });

  test('caps the batch and reports how many are still waiting behind it', () => {
    const nonPii = Array.from({ length: 45 }, (_, i) => certified('term' + i, '06-01'));
    const { batch, backlogRemaining } = scrubBatch({ nonPii, limit: 40 });
    expect(batch).toHaveLength(40);
    expect(backlogRemaining).toBe(5);
  });

  test('skips a term already approved as a stopword', () => {
    const { batch } = scrubBatch({
      nonPii: [certified('transition', '06-01'), certified('raphael', '06-02')],
      approved: ['Transition'],
    });
    expect(batch).toEqual(['raphael']);
  });

  test('skips a term already waiting in the review queue', () => {
    const { batch } = scrubBatch({
      nonPii: [certified('prompting', '06-01'), certified('raphael', '06-02')],
      queued: ['prompting'],
    });
    expect(batch).toEqual(['raphael']);
  });

  /* The reason scrub-seen:v1 has to exist at all. A term the model DECLINES to
     suggest is not queued, not approved and not rejected, so it leaves no trace
     anywhere. Without this the same oldest batch comes round every night and the
     backlog behind it never moves. */
  test('skips a term a previous run already considered, even though nothing was queued for it', () => {
    const { batch, backlogRemaining } = scrubBatch({
      nonPii: [certified('raphael', '06-01'), certified('elopement', '06-02')],
      seen: ['raphael'],
    });
    expect(batch).toEqual(['elopement']);
    expect(backlogRemaining).toBe(0);
  });

  /* An unparseable certifiedAt gives NaN, and a NaN comparator leaves the order
     to whatever the engine happened to do. The oldest-first claim is the whole
     point of the window, so it has to hold on a store with a bad row in it. */
  test('a term with an unreadable certifiedAt still lands in a fixed place, not wherever the engine puts it', () => {
    const run = () => scrubBatch({
      nonPii: [certified('newest', '08-25'), { term: 'undated', certifiedAt: 'not a date' }, certified('older', '06-01')],
    }).batch;
    expect(run()).toEqual(['undated', 'older', 'newest']);
    expect(run()).toEqual(run());
  });

  test('an empty store is an empty batch and no backlog, not a crash', () => {
    expect(scrubBatch({}).batch).toEqual([]);
    expect(scrubBatch({ nonPii: [] }).backlogRemaining).toBe(0);
  });
});

/* ── the output budget ───────────────────────────────────────────────────── */

test.describe('the output budget', () => {
  test('scales with the number of terms rather than sitting at a constant', () => {
    expect(scrubBudget(40)).toBeGreaterThan(scrubBudget(10));
    expect(scrubBudget(10)).toBeGreaterThan(scrubBudget(1));
  });

  /* The exact run that failed. Thirteen terms were certified on 2026-08-25 and
     the call carried 512, which ran out at character 1596 of the JSON. */
  test('covers the thirteen-term run that truncated at 512', () => {
    expect(scrubBudget(13)).toBeGreaterThan(512);
    // Thirteen suggestions serialise to roughly 520 tokens; the budget clears
    // that with room rather than meeting it exactly.
    expect(scrubBudget(13)).toBeGreaterThan(1200);
  });

  test('covers a full batch at the cap, so raising the cap cannot quietly truncate again', () => {
    const { batchMax } = scrubLimits();
    // A suggestion serialises to roughly 40 tokens. The budget must clear a full
    // batch of them by a real margin, not by a rounding error.
    expect(scrubBudget(batchMax)).toBeGreaterThan(batchMax * 40 * 1.5);
  });

  test('a zero-term call still asks for enough to answer', () => {
    expect(scrubBudget(0)).toBeGreaterThan(0);
  });
});

/* ── reading what came back ──────────────────────────────────────────────── */

test.describe('reading the model response', () => {
  const good = { suggestions: [{ term: 'transition', reason: 'ordinary word', confidence: 'high' }], digest: 'ok' };
  const resp = (text, stop) => ({ stop_reason: stop || 'end_turn', content: [{ type: 'text', text }] });

  test('a good response comes back with its suggestions', () => {
    const out = scrubOutcome(resp(JSON.stringify(good)));
    expect(out.ok).toBe(true);
    expect(out.result.suggestions[0].term).toBe('transition');
  });

  /* THE REGRESSION. This is the response that broke the job for two months: the
     text is a genuinely truncated array, and the old code went straight to
     JSON.parse and died on the syntax rather than on the cause. */
  test('a truncated response is reported as truncated, and is never parsed', () => {
    const cut = JSON.stringify(good).slice(0, 60);
    const out = scrubOutcome(resp(cut, 'max_tokens'));
    expect(out.ok).toBe(false);
    expect(out.stopped).toBe('model-response-truncated');
    expect(out.stopReason).toBe('max_tokens');
    // The reason it gives is the budget, not a character offset in a JSON string.
    expect(out.error).toMatch(/budget/i);
    expect(out.error).not.toMatch(/position \d+/);
  });

  test('a response this run cannot read is reported as unreadable', () => {
    const out = scrubOutcome(resp('Sure! Here are the terms I would suggest:'));
    expect(out.ok).toBe(false);
    expect(out.stopped).toBe('model-response-unreadable');
  });

  test('valid JSON that is not the agreed shape is unreadable too, not a half-run', () => {
    const out = scrubOutcome(resp('{"digest":"nothing to add"}'));
    expect(out.ok).toBe(false);
    expect(out.stopped).toBe('model-response-unreadable');
  });

  test('an empty response is reported as empty rather than as a parse failure', () => {
    const out = scrubOutcome(resp('   '));
    expect(out.ok).toBe(false);
    expect(out.stopped).toBe('model-response-empty');
  });
});

/* ── the run itself, against a fake store ────────────────────────────────── */

function fakeKv(seed) {
  const store = new Map(Object.entries(seed || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    store,
    get: async (k) => (store.has(k) ? store.get(k) : null),
    put: async (k, v) => { store.set(k, v); },
    read: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null),
  };
}

/* The model call and the email both leave through global fetch, so the run is
   driven by replacing it and restoring it. Nothing here reaches the network. */
async function runWith(kv, reply) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    if (String(url).includes('anthropic')) return reply();
    return { ok: true, json: async () => ({}) };
  };
  try {
    const report = await runScrubLearning({ API_PASSWORDS: kv, ANTHROPIC_API_KEY: 'k' });
    return { report, calls };
  } finally {
    globalThis.fetch = real;
  }
}

const modelSays = (payload, stop) => () => ({
  ok: true,
  json: async () => ({ stop_reason: stop || 'end_turn', content: [{ type: 'text', text: JSON.stringify(payload) }] }),
});

test.describe('what the run reports and what it writes', () => {
  test('a run that considers nothing says so, instead of answering a bare ok', async () => {
    const kv = fakeKv({ 'nonpii:v1': [] });
    const { report, calls } = await runWith(kv, modelSays({ suggestions: [], digest: '' }));
    expect(report.ok).toBe(true);
    expect(report.stopped).toBe('nothing-to-consider');
    // It also spends nothing finding that out.
    expect(calls.filter((c) => c.url.includes('anthropic'))).toHaveLength(0);
  });

  test('a successful run reports what it considered, what it proposed, and what is left', async () => {
    const nonPii = Array.from({ length: 45 }, (_, i) => certified('term' + i, '06-01'));
    const kv = fakeKv({ 'nonpii:v1': nonPii });
    const { report } = await runWith(kv, modelSays({
      suggestions: [{ term: 'term0', reason: 'ordinary word', confidence: 'high' }],
      digest: 'one term looks safe',
    }));
    expect(report.ok).toBe(true);
    expect(report.considered).toBe(40);
    expect(report.proposed).toBe(1);
    expect(report.backlogRemaining).toBe(5);
    expect(kv.read('scrub-suggestions:v1')).toHaveLength(1);
  });

  /* Thirteen terms, because that is the batch that actually truncated: the run of
     2026-08-25 sent thirteen certified terms under a flat max_tokens 512. */
  test('the budget it sends is sized to the batch, not to a constant', async () => {
    const nonPii = Array.from({ length: 13 }, (_, i) => certified('term' + i, '08-25'));
    const kv = fakeKv({ 'nonpii:v1': nonPii });
    const { calls } = await runWith(kv, modelSays({ suggestions: [], digest: '' }));
    const call = calls.find((c) => c.url.includes('anthropic'));
    expect(call.body.max_tokens).toBe(scrubBudget(13));
    expect(call.body.max_tokens).toBeGreaterThan(512);
  });

  /* The one case sizing on the batch alone would have missed. A run with no
     certified terms left and a handful of admin problem strings still produces
     suggestions, and it would have gone out with the smallest budget there is. */
  test('a run with no certified terms but several problem strings is sized to the problem strings', async () => {
    const kv = fakeKv({ 'nonpii:v1': [], 'scrub-learn:v1': Array.from({ length: 6 }, (_, i) => ({ text: 'string ' + i })) });
    const { calls } = await runWith(kv, modelSays({ suggestions: [], digest: '' }));
    const call = calls.find((c) => c.url.includes('anthropic'));
    expect(call.body.max_tokens).toBe(scrubBudget(6));
    expect(call.body.max_tokens).toBeGreaterThan(scrubBudget(0));
  });

  test('it asks for the answer under a schema rather than fishing it out of prose', async () => {
    const kv = fakeKv({ 'nonpii:v1': [certified('transition', '06-01')] });
    const { calls } = await runWith(kv, modelSays({ suggestions: [], digest: '' }));
    const call = calls.find((c) => c.url.includes('anthropic'));
    expect(call.body.output_config.format.type).toBe('json_schema');
    expect(call.body.output_config.format.schema.required).toContain('suggestions');
  });

  /* The drain, proved over two runs rather than asserted about one. */
  test('a second run moves on to the next terms instead of re-reading the same batch', async () => {
    const nonPii = Array.from({ length: 45 }, (_, i) => certified('term' + i, '06-01'));
    const kv = fakeKv({ 'nonpii:v1': nonPii });
    const empty = modelSays({ suggestions: [], digest: '' });

    const first = await runWith(kv, empty);
    expect(first.report.considered).toBe(40);
    expect(first.report.backlogRemaining).toBe(5);

    const second = await runWith(kv, empty);
    expect(second.report.considered).toBe(5);
    expect(second.report.backlogRemaining).toBe(0);

    const third = await runWith(kv, empty);
    expect(third.report.stopped).toBe('nothing-to-consider');
  });

  test('a term the model declined is still marked seen, which is what lets the backlog move', async () => {
    const kv = fakeKv({ 'nonpii:v1': [certified('raphael', '06-01')] });
    await runWith(kv, modelSays({ suggestions: [], digest: 'nothing safe here' }));
    expect(kv.read(scrubLimits().seenKey)).toContain('raphael');
    expect(kv.read('scrub-suggestions:v1')).toEqual([]);
  });
});

test.describe('a store it cannot read', () => {
  /* The one new silent failure this change could have introduced. Reading a
     corrupt store as empty would let the run answer "nothing to consider" over
     213 waiting terms, which is the shape of the bug being removed. */
  test('a term store that will not parse stops the run and names the key', async () => {
    const kv = fakeKv({ 'nonpii:v1': [] });
    kv.store.set('nonpii:v1', '[{"term":"transition"');
    const { report, calls } = await runWith(kv, modelSays({ suggestions: [], digest: '' }));
    expect(report.ok).toBe(false);
    expect(report.stopped).toBe('store-unreadable');
    expect(report.error).toContain('nonpii:v1');
    expect(calls.filter((c) => c.url.includes('anthropic'))).toHaveLength(0);
  });

  test('a key that is simply absent is empty, which is a different thing and not an error', async () => {
    const kv = fakeKv({});
    const { report } = await runWith(kv, modelSays({ suggestions: [], digest: '' }));
    expect(report.ok).toBe(true);
    expect(report.stopped).toBe('nothing-to-consider');
  });
});

test.describe('a run that fails costs nothing', () => {
  const truncated = () => ({
    ok: true,
    json: async () => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"suggestions":[{"term":"a' }] }),
  });

  test('a truncated call is reported as truncated rather than as a syntax error', async () => {
    const kv = fakeKv({ 'nonpii:v1': [certified('transition', '06-01')] });
    const { report } = await runWith(kv, truncated);
    expect(report.ok).toBe(false);
    expect(report.stopped).toBe('model-response-truncated');
    expect(report.stopReason).toBe('max_tokens');
    expect(report.considered).toBe(1);
  });

  test('a failed run marks nothing seen, so the same terms come back next run', async () => {
    const kv = fakeKv({ 'nonpii:v1': [certified('transition', '06-01')] });
    await runWith(kv, truncated);
    expect(kv.read(scrubLimits().seenKey)).toBeNull();

    const { report } = await runWith(kv, modelSays({ suggestions: [], digest: '' }));
    expect(report.ok).toBe(true);
    expect(report.considered).toBe(1);
  });

  test('a failed run keeps the admin problem strings rather than clearing them unread', async () => {
    const kv = fakeKv({ 'nonpii:v1': [], 'scrub-learn:v1': [{ text: 'Raphy went home' }] });
    await runWith(kv, truncated);
    expect(kv.read('scrub-learn:v1')).toHaveLength(1);
  });

  test('a call that throws is reported as a failed call, not as a run that did nothing', async () => {
    const kv = fakeKv({ 'nonpii:v1': [certified('transition', '06-01')] });
    const boom = () => ({ ok: false, status: 500, statusText: 'boom', json: async () => ({}) });
    const { report } = await runWith(kv, boom);
    expect(report.ok).toBe(false);
    expect(report.stopped).toBe('model-call-failed');
    expect(report.error).toMatch(/500/);
  });
});

test.describe('the guardrail still holds', () => {
  test('a term the model invented is refused, however confidently it is offered', async () => {
    const kv = fakeKv({ 'nonpii:v1': [certified('transition', '06-01')] });
    const { report } = await runWith(kv, modelSays({
      suggestions: [
        { term: 'transition', reason: 'ordinary word', confidence: 'high' },
        { term: 'raphael', reason: 'trust me', confidence: 'high' },
      ],
      digest: '',
    }));
    expect(report.proposed).toBe(1);
    expect(kv.read('scrub-suggestions:v1').map((s) => s.term)).toEqual(['transition']);
  });

  test('a run proposes rather than approves: it never touches the live stopword list', async () => {
    const kv = fakeKv({
      'nonpii:v1': [certified('transition', '06-01')],
      'scrub-overrides:v1': { stopwords: ['session'], firstNames: ['raphael'] },
    });
    await runWith(kv, modelSays({
      suggestions: [{ term: 'transition', reason: 'ordinary word', confidence: 'high' }],
      digest: '',
    }));
    const ov = kv.read('scrub-overrides:v1');
    expect(ov.stopwords).toEqual(['session']);
    expect(ov.firstNames).toEqual(['raphael']);
  });

  test('a reason is bounded, because it was the total length that killed the run', async () => {
    const kv = fakeKv({ 'nonpii:v1': [certified('transition', '06-01')] });
    await runWith(kv, modelSays({
      suggestions: [{ term: 'transition', reason: 'x'.repeat(4000), confidence: 'high' }],
      digest: '',
    }));
    expect(kv.read('scrub-suggestions:v1')[0].reason).toHaveLength(scrubLimits().reasonChars);
  });

  test('the prompt asks for the bound it enforces, rather than enforcing one it never asked for', async () => {
    const kv = fakeKv({ 'nonpii:v1': [certified('transition', '06-01')] });
    const { calls } = await runWith(kv, modelSays({ suggestions: [], digest: '' }));
    const call = calls.find((c) => c.url.includes('anthropic'));
    expect(call.body.system).toContain(String(scrubLimits().reasonChars));
  });
});

/* ── the endpoint, through the real Worker ───────────────────────────────── */

test.describe('what the endpoint answers', () => {
  test('it still refuses a caller with no admin token and no cron secret', async ({ request }) => {
    const res = await request.post('/api/admin/scrub-run');
    expect(res.status()).toBe(401);
  });

  /* The local dev server has no KV binding and no API key, so an authenticated
     run here stops at the first gate. That is the assertion: it says which gate.
     Before this change the same request answered 200 {"ok":true}, which is
     precisely the lie that hid a two-month outage. */
  test('an authenticated run that cannot proceed says why, instead of answering ok', async ({ request }) => {
    const res = await request.post('/api/admin/scrub-run', {
      headers: { Authorization: `Bearer ${adminToken()}` },
    });
    expect(res.status()).not.toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.stopped).toBe('no-bindings');
    expect(body.error).toBeTruthy();
  });
});
