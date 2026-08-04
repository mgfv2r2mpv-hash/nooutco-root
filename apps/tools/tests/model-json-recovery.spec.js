import { test, expect } from '@playwright/test';

// Regression for the intermittent "Model returned malformed JSON" failure on the
// SAP drafter.
//
// Every note tool asks the model to hand-serialize its draft as a JSON object,
// so the model - not a serializer - is responsible for every escape. SAP is by
// far the most exposed of the four: its schema packs multi-line bullet blocks
// into 8 separate string values (sup and parent have 1 each, assess none), and a
// tacting goal's SD field is *required* to quote demands verbatim ("What is
// it?"), so interior double quotes are inherent to its output rather than
// incidental. One missed escape anywhere in that ~1000-token object threw away
// the clinician's entire draft, with no repair and no retry.
//
// Two recoveries, matched to which slips are safely fixable:
//   - a raw control character inside a string literal is illegal JSON in every
//     case, so rewriting it to its escape is lossless → repaired in place;
//   - an unescaped interior quote cannot be repaired without guessing where the
//     string was meant to end, so it earns one resample instead. Guessing wrong
//     would silently drop clinical text, which is worse than failing loudly.
//
// A max_tokens truncation is neither: it is not a slip, and a resample just hits
// the same cap, so it must stay a single call with its own distinct message.

const MODEL_RESPONSE = (text, stopReason = 'end_turn') => ({
  model: 'claude-haiku-4-5-20251001',
  stop_reason: stopReason,
  usage: { input_tokens: 100, output_tokens: 200 },
  content: [{ type: 'text', text }],
});

// Drive NotesGate directly from the dependency-light scrub-test page (loads
// /assets/notes-gate.js with no React/Turnstile/CDN deps), stubbing the API so
// the model's exact bytes are under the test's control.
async function callWith(page, bodies, expectKeys) {
  const remaining = [...bodies];
  const seen = [];
  await page.route('**/api/llm-call**', async (route) => {
    seen.push(1);
    const body = remaining.length > 1 ? remaining.shift() : remaining[0];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.goto('/notes/scrub-test.html');
  await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.generateConversation));

  const result = await page.evaluate(async (keys) => {
    try {
      const r = await window.NotesGate.generateConversation({
        system: 'sys',
        messages: [{ role: 'user', content: 'draft a SAP' }],
        tool: 'sap',
        expectKeys: keys,
      });
      return { ok: true, parsed: r.parsed };
    } catch (e) {
      return { ok: false, msg: String((e && e.message) || e), diagnostics: (e && e.diagnostics) || null };
    }
  }, expectKeys);
  return { ...result, calls: seen.length };
}

// What the SAP tool's formSections resolve to - the same list engine.jsx derives.
const SAP_KEYS = ['refinedGoal', 'exercise', 'generalization', 'errorCorrection'];

const FULL_SAP = JSON.stringify({
  refinedGoal: 'A goal',
  exercise: { purpose: '* a' },
  generalization: { criteria: 'x' },
  errorCorrection: { initial: '(1) y' },
  hints: [],
});

test.describe('malformed model JSON recovery', () => {
  test('repairs raw newlines inside string values without a second call', async ({ page }) => {
    // What the model emits when it writes the line break instead of "\n" - the
    // single most likely slip given SAP's 8 multi-line values.
    const malformed = '{"refinedGoal": "Line one\nLine two", "exercise": {"purpose": "* a\n* b"}, "hints": []}';
    const r = await callWith(page, [MODEL_RESPONSE(malformed)]);

    expect(r.ok).toBe(true);
    // Lossless: the newline survives as a newline, not as a dropped character.
    expect(r.parsed.refinedGoal).toBe('Line one\nLine two');
    expect(r.parsed.exercise.purpose).toBe('* a\n* b');
    expect(r.calls).toBe(1); // repaired in place - no resample needed
  });

  test('resamples once when a string carries an unescaped interior quote', async ({ page }) => {
    // The failure the reported SAP goal provokes: the SD field quotes the demand
    // verbatim, and the model emits the quotes bare.
    const malformed = '{"refinedGoal": "tact within 5s of "What is it?"", "hints": []}';
    const good = '{"refinedGoal": "tact within 5s of \\"What is it?\\"", "hints": []}';
    const r = await callWith(page, [MODEL_RESPONSE(malformed), MODEL_RESPONSE(good)]);

    expect(r.ok).toBe(true);
    expect(r.parsed.refinedGoal).toBe('tact within 5s of "What is it?"');
    expect(r.calls).toBe(2);
  });

  test('does not resample a max_tokens truncation', async ({ page }) => {
    // Truncated mid-object at the cap. The nested object closes, so the brace
    // slice still matches and this reaches the parse branch (rather than the
    // earlier "no JSON object" one) - which is what a real truncation looks like.
    // Resampling burns a second call to hit the same cap, so this must stay one
    // call and keep its own actionable message.
    const truncated = '{"refinedGoal": "Line one", "exercise": {"purpose": "* a\\n* b"}, "generalization": {"criteria": "cut off mid';
    const r = await callWith(page, [MODEL_RESPONSE(truncated, 'max_tokens')]);

    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/token cap/i);
    expect(r.calls).toBe(1);
  });

  test('still fails loudly, with diagnostics, when both samples are unparseable', async ({ page }) => {
    const malformed = '{"refinedGoal": "quote "here" bare", "hints": []}';
    const r = await callWith(page, [MODEL_RESPONSE(malformed)]);

    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/malformed JSON/i);
    expect(r.calls).toBe(2);
    expect(r.diagnostics).toBeTruthy();
    expect(r.diagnostics.retried).toBe(true);
    expect(r.diagnostics.stage).toBe('parse');
    expect(r.diagnostics.parseError).toBeTruthy();
  });

  // Parsing proves the bytes are JSON, not that they are the note. normalizeOutput
  // is tolerant of missing keys by design, so before the shape gate a fragment
  // that parsed cleanly rendered as a note with silently blank sections - no
  // error, nothing for the clinician to notice. Demonstrated directly:
  // sap.normalizeOutput({}) returns empty refinedGoal/exercise/generalization and
  // an errorCorrection containing only the boilerplate maintenance-probe line.
  test('resamples a fragment that parses cleanly but is not the note', async ({ page }) => {
    // A stray brace in model prose ahead of the real object: the greedy
    // first-{ to last-} slice starts off the JSON and lands on a valid fragment.
    const strayBrace = 'Here is the draft {see below} - {"purpose": "* a"}';
    const r = await callWith(page, [MODEL_RESPONSE(strayBrace), MODEL_RESPONSE(FULL_SAP)], SAP_KEYS);

    expect(r.ok).toBe(true);
    expect(r.parsed.refinedGoal).toBe('A goal');
    expect(r.calls).toBe(2);
  });

  test('reports which contracted sections the model dropped', async ({ page }) => {
    const partial = JSON.stringify({ refinedGoal: 'A goal', exercise: { purpose: '* a' }, hints: [] });
    const r = await callWith(page, [MODEL_RESPONSE(partial)], SAP_KEYS);

    expect(r.ok).toBe(false);
    expect(r.calls).toBe(2); // one resample, then fail loudly
    expect(r.diagnostics.stage).toBe('shape');
    expect(r.diagnostics.retried).toBe(true);
    expect(r.diagnostics.missingKeys).toBe('generalization,errorCorrection');
  });

  test('does not resample missing sections that are a max_tokens truncation', async ({ page }) => {
    // Sections absent because the response was cut off at the cap, not because
    // the model dropped them - the brace slice still closed, so it parses and
    // reaches the shape gate rather than the parse one. A resample would burn a
    // call to hit the same cap, so the max_tokens guard has to hold on this
    // stage too, not just on parse failures.
    const truncated = '{"refinedGoal": "A goal", "exercise": {"purpose": "* a"}}';
    const r = await callWith(page, [MODEL_RESPONSE(truncated, 'max_tokens')], SAP_KEYS);

    expect(r.ok).toBe(false);
    expect(r.calls).toBe(1);
    expect(r.diagnostics.stage).toBe('shape');
    expect(r.diagnostics.stopReason).toBe('max_tokens');
  });

  test('a complete note passes the shape gate in a single call', async ({ page }) => {
    const r = await callWith(page, [MODEL_RESPONSE(FULL_SAP)], SAP_KEYS);

    expect(r.ok).toBe(true);
    expect(r.parsed.refinedGoal).toBe('A goal');
    expect(r.calls).toBe(1);
  });

  test('repair never rewrites a document that already parses', async ({ page }) => {
    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate._json));

    const cases = await page.evaluate(() => {
      const repair = window.NotesGate._json.repair;
      // Escapes, delimiters inside strings, and unicode must all round-trip
      // untouched - the repair runs on the same text a later parse consumes.
      const samples = [
        '{"a":"plain"}',
        '{"a":"already\\nescaped"}',
        '{"a":"quote \\" inside"}',
        '{"a":"backslash \\\\ then \\"q\\""}',
        '{"a":"braces {} and brackets [] and commas ,"}',
        '{"a":"em-dash and ünïcode"}',
        '{"a":["x","y"],"b":{"c":1},"d":null,"e":true}',
      ];
      return samples.map((s) => ({
        s,
        identical: repair(s) === s,
        sameValue: JSON.stringify(JSON.parse(repair(s))) === JSON.stringify(JSON.parse(s)),
      }));
    });

    for (const c of cases) {
      expect(c.identical, `repair() altered valid JSON: ${c.s}`).toBe(true);
      expect(c.sameValue, `repair() changed the parsed value of: ${c.s}`).toBe(true);
    }
  });
});
