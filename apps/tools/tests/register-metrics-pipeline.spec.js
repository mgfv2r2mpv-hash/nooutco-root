import { test, expect } from '@playwright/test';
import { sanitizeAuditEvent } from '../_worker.js';

/* The register metrics never reached the store, in two separate ways.
   ------------------------------------------------------------------
   The engine measures every generated note and emits the result as its own
   `note_register` event, deliberately separate from note_generated so the two
   do not share the 12-key payload cap. Two things read those numbers:
   shape_profile, which is written ONLY from a note_register, and the Friday
   self-audit, which pulls note_register rows out of usage_metric to compare the
   week against the measured human bands.

   Neither had ever received one.

   1. `note_register` was missing from AUDIT_TYPES, so sanitizeAuditEvent
      returned null and the event was dropped at the Pages worker.
   2. Even allowed through, every value was passed through Math.round. The
      register measures are fractions - burstiness runs 0.55 to 0.82, opener
      variety 0.92 to 1.0 - so they collapsed to 0 or 1. That is not a
      degraded signal, it is a destroyed one: the human bands they are read
      against are fractional, and shape_profile requires burstiness > 0, so a
      rounded 0.6 was discarded rather than merely blunted.

   These test the sanitiser directly because it is where both faults live, and
   because the stored record is not readable back through any route. */

const REGISTER = {
  type: 'note_register',
  tool: 'sap',
  ts: 1800000000000,
  data: {
    sentences: 14,
    words: 268,
    meanLen: 19.142857,
    burstiness: 0.6231,
    openerVariety: 0.9444,
    clientRate: 0.1785,
  },
};

test.describe('note_register survives the worker', () => {
  test('it is an allowed event type at all', () => {
    const out = sanitizeAuditEvent(REGISTER);
    expect(out).not.toBeNull();
    expect(out.type).toBe('note_register');
    expect(out.tool).toBe('sap');
  });

  test('a fractional measure keeps its value instead of collapsing', () => {
    const out = sanitizeAuditEvent(REGISTER);
    // The two shape_profile is written from. Both are between 0 and 1, so
    // rounding to a whole number took one to 1 and the other to 0 - and a
    // burstiness of 0 fails the > 0 guard, so the row was never written.
    expect(out.data.burstiness).toBeCloseTo(0.6231, 4);
    expect(out.data.openerVariety).toBeCloseTo(0.9444, 4);
    expect(out.data.clientRate).toBeCloseTo(0.1785, 4);
    expect(out.data.burstiness).toBeGreaterThan(0);
  });

  test('mean sentence length keeps the fraction the human bands are read at', () => {
    const out = sanitizeAuditEvent(REGISTER);
    expect(out.data.meanLen).toBeCloseTo(19.1429, 4);
  });

  test('whole numbers are unchanged, so the older metrics are untouched', () => {
    const out = sanitizeAuditEvent({
      type: 'note_generated', tool: 'bt', ts: 1800000000000,
      data: { len_narrative: 412, answered: true },
    });
    expect(out.data.len_narrative).toBe(412);
    expect(out.data.answered).toBe(true);
  });
});

test.describe('widening the allowlist did not widen anything else', () => {
  test('an unknown type is still refused', () => {
    expect(sanitizeAuditEvent({ type: 'note_text', tool: 'bt', data: {} })).toBeNull();
  });

  test('prose in a register payload is still dropped, not rounded or stringified', () => {
    const out = sanitizeAuditEvent({
      type: 'note_register',
      tool: 'sap',
      data: {
        burstiness: 0.61,
        narrative: 'Jacob eloped from the table three times.',
        nested: { note: 'Jacob eloped' },
        list: ['Jacob'],
      },
    });
    expect(out.data.burstiness).toBeCloseTo(0.61, 4);
    expect(out.data).not.toHaveProperty('narrative');
    expect(out.data).not.toHaveProperty('nested');
    expect(out.data).not.toHaveProperty('list');
    expect(JSON.stringify(out)).not.toContain('Jacob');
  });

  test('precision is bounded rather than unbounded', () => {
    // The rounding existed to bound precision, and it still does. A number
    // cannot carry prose at any precision, but there is no reason to store
    // seventeen significant figures of one.
    const out = sanitizeAuditEvent({
      type: 'note_register', tool: 'sap', data: { burstiness: 0.123456789012345 },
    });
    expect(String(out.data.burstiness).length).toBeLessThanOrEqual(8);
  });
});

/* apiUrl put the .js suffix in the wrong place whenever a path carried a query.
   ------------------------------------------------------------------
   "/api/style-card?tool=bt&seed=x" came out as
   "/api/style-card?tool=bt&seed=x.js&_=1", which fails twice and silently: the
   PATH loses the ".js" that is the only thing getting an /api request past
   Super Bot Fight Mode, and the final parameter's value gains a ".js" it never
   had. The style card's shape target is fetched with exactly that shape, so it
   had been going out malformed. */
test.describe('apiUrl keeps the suffix on the path', () => {
  const build = async (page, path) => {
    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.apiUrl));
    return page.evaluate((p) => window.NotesGate.apiUrl(p), path);
  };

  test('a path with no query is unchanged in shape', async ({ page }) => {
    const url = await build(page, '/api/style-card');
    expect(url).toMatch(/^\/api\/style-card\.js\?_=\d+$/);
  });

  test('a path with a query keeps .js on the path, not on a value', async ({ page }) => {
    const url = await build(page, '/api/style-card?tool=bt&seed=abc');
    expect(url.split('?')[0]).toBe('/api/style-card.js');
    expect(url).not.toContain('abc.js');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('tool')).toBe('bt');
    expect(params.get('seed')).toBe('abc');
    expect(params.get('_')).toMatch(/^\d+$/);
  });

  test('the cache-buster is still there either way', async ({ page }) => {
    for (const p of ['/api/audit', '/api/style-card?tool=sap']) {
      const url = await build(page, p);
      expect(new URLSearchParams(url.split('?')[1]).get('_')).toMatch(/^\d+$/);
    }
  });
});
