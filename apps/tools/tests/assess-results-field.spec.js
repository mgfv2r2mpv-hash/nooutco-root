import { test, expect } from '@playwright/test';

/* The assessment note form has TWO required rich-text fields, and the tool
 * drafted one of them.
 *
 * WHAT HE SENT. A screenshot of the live ReThink form on 2026-08-31 showing
 * "Brief Summary of Activities Completed *" and, directly beneath it, "Results
 * of Assessment *". Both carry the required marker. The tool produced the first
 * and the BCBA wrote the second by hand every time.
 *
 * WHY IT IS A SECOND SECTION AND NOT MORE SENTENCES. Everything the engine does
 * per-section derives from the schema's section enum: revising one field
 * without touching the other, the empty-narrative gate, and which sections the
 * expert reads. Appending findings to `narrative` would have filled one EHR box
 * with both fields' content and left the other empty, which is the same hand
 * work in a worse shape.
 *
 * THE SPLIT IS THE POINT. His own sample content divides cleanly: the summary
 * says what the Behavior Analyst DID and carries no findings, results says what
 * the assessment FOUND. A model given two fields and no boundary writes the
 * same paragraph twice, so the boundary is asserted here rather than assumed.
 */

const BCBA_PAGE = '/notes/bcba/index.html';

const ready = async (page) => {
  await page.goto(BCBA_PAGE);
  await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
};

const assess = (page, fn) =>
  page.evaluate(`(${fn.toString()})(window.NOTE_TOOLS.find((t) => t.id === 'assess'))`);

const systemFor = (page) => assess(page, (t) => t.buildSystem());

test.describe('the form has two narratives and so does the tool', () => {
  test.beforeEach(async ({ page }) => { await ready(page); });

  test('both fields are declared, in the order the EHR form shows them', async ({ page }) => {
    const narratives = await assess(page, (t) =>
      t.formSections.filter((s) => s.kind === 'narrative').map((s) => [s.key, s.heading]));
    expect(narratives).toEqual([
      ['narrative', 'Brief Summary of Activities Completed'],
      ['results', 'Results of Assessment'],
    ]);
  });

  /* The id is the whole integration, so it is asserted on its own. A heading
     with no matching section id renders a box the engine cannot revise. */
  test('results is a section id, which is what the engine keys everything off', async ({ page }) => {
    const sections = await assess(page, (t) => t.responseSchema.properties.hints.items.properties.section.enum);
    expect(sections).toContain('results');
  });

  test('the schema requires results, so a draft cannot come back without it', async ({ page }) => {
    const schema = await assess(page, (t) => ({
      required: t.responseSchema.required,
      results: t.responseSchema.properties.results,
    }));
    // Required because the EHR field is required. Optional here would hand the
    // BCBA a blank box the form will not let them submit.
    expect(schema.required).toContain('results');
    expect(schema.results).toEqual({ type: 'string' });
  });

  test('normalizeOutput carries results through, and defaults it rather than dropping the key', async ({ page }) => {
    const out = await assess(page, (t) => ({
      kept: t.normalizeOutput({ narrative: 'a', results: 'b', hints: [] }),
      empty: t.normalizeOutput({ narrative: 'a', hints: [] }),
      wrongType: t.normalizeOutput({ results: { not: 'a string' }, hints: [] }),
    }));
    expect(out.kept.results).toBe('b');
    // A missing key becomes an empty string, never undefined: the engine reads
    // S.output[id] to decide whether a narrative is empty, and undefined and ""
    // are the same to it only by luck.
    expect(out.empty.results).toBe('');
    expect(out.wrongType.results).toBe('');
  });
});

test.describe('the prompt tells the model which field is which', () => {
  let system;
  test.beforeEach(async ({ page }) => { await ready(page); system = await systemFor(page); });

  test('it names both fields in the output instruction', async () => {
    expect(system).toMatch(/Brief Summary of Activities Completed/);
    expect(system).toMatch(/Results of Assessment/);
  });

  test('it draws the did-versus-found boundary and forbids writing one into the other', async () => {
    expect(system).toMatch(/what the Behavior Analyst DID/);
    expect(system).toMatch(/what the assessment FOUND/);
    expect(system).toMatch(/It carries no findings/);
    expect(system).toMatch(/Do not repeat one field's content in the other/);
  });

  /* The one that fights the rest of the stack. The shared register rules and
     the necessity floor both push a session note AWAY from repeating numbers,
     because the clinical software attaches them. An assessment instrument's
     score is not attached anywhere: this narrative is where it is recorded. A
     model reading only the shared rules strips exactly the content the field
     exists for. */
  test('it says the results field is the one that carries scores', async () => {
    expect(system).toMatch(/RESULTS OF ASSESSMENT CARRIES THE NUMBERS/);
    expect(system).toMatch(/in the instrument's own units/);
    expect(system).toMatch(/Never invent a score/);
  });

  test('a named instrument with no score is reported as pending and hinted, not guessed at', async () => {
    expect(system).toMatch(/say it was administered and its scoring is pending/);
    expect(system).toMatch(/emit the unscored_instrument hint/);
  });

  test('findings are reported by domain, and the boundary is what makes them findings', async () => {
    expect(system).toMatch(/BY DOMAIN/);
    expect(system).toMatch(/because the boundary is the finding/);
    // The pair he wrote himself, kept as the worked contrast rather than a rule.
    expect(system).toMatch(/is a finding\. \\?"Imitation was a relative weakness\\?" is not/);
  });

  test('a function is reported condition by condition and hedged to its evidence', async () => {
    expect(system).toMatch(/condition by condition before naming it/);
    expect(system).toMatch(/which conditions did and did not resolve it/);
    expect(system).toMatch(/A handful of trials does not license a flat assertion of function/);
  });

  /* The inversion, and the reason it has to be stated. B10 of the completeness
     bar says the technician reports and the analysis is not theirs to assign.
     That is a rule about a technician's session note. An assessment is the
     document where a Behavior Analyst assigns function, and a model carrying
     the session-note restraint into this tool would strip the finding the
     assessment was run to produce. */
  test('the Behavior Analyst keeps the analysis a technician would not be allowed', async () => {
    expect(system).toMatch(/THE BEHAVIOR ANALYST IS ENTITLED TO THE ANALYSIS/);
    expect(system).toMatch(/Do not recast it into a bare observation/);
    expect(system).toMatch(/not a Behavior Analyst writing an assessment/);
  });

  /* The shared block used to say, under "REMOVE, ALWAYS", that claims about why
     a behavior happened and clinical hypotheses are cut because "function,
     motivation and diagnosis belong to the BCBA's analysis". That clause is
     written for a technician's note. On this tool the author IS the BCBA, so it
     took the analysis away from the person it was reserving it for, and it
     deleted the finding the assessment was run to produce.

     His ruling, 2026-08-31: remove it from every tool but bt. So this tool now
     takes the BCBA build of the shared rules, and the assertion is that the
     clause is ABSENT rather than that it is overridden. */
  test('the shared rule that reserved the analysis for a BCBA is gone from this BCBA tool', async () => {
    expect(system).not.toMatch(/Claims about WHY a behavior happened/);
    expect(system).not.toMatch(/Clinical hypotheses\. Function, motivation and diagnosis belong to the BCBA's analysis/);
    // Removed, not exempted: the rest of the REMOVE block still binds, and the
    // header no longer speaks to a technician who "does not get a say".
    expect(system).toMatch(/REMOVE, ALWAYS/);
    expect(system).toMatch(/\* Anything a checkbox on the form already records\./);
    expect(system).not.toMatch(/the technician does not get a say/);
  });

  test('and the tool says plainly that the finding is not an overreach', async () => {
    expect(system).toMatch(/do not cut a causal claim or a clinical hypothesis out of this note/);
    expect(system).toMatch(/hedged to the evidence that supports it/);
    // No dangling cross-reference. The paragraph that named the shared rule went
    // with the rule, because a pointer at something absent is read as evidence
    // the thing was supplied.
    expect(system).not.toMatch(/THIS OVERRIDES THE SHARED RULE BELOW/);
  });
});

test.describe('reporting an absence that did not happen, without breaking the absence ban', () => {
  /* His sample results field ends "No aggression, flopping (uncontrolled
     posture release), or tears accompanied the crying." That is a real finding
     and it has to survive, while "rates were not documented" still has to die.
     The shared rule already draws that line on what the sentence is ABOUT, so
     this is written as an application of the rule and not as an exception to
     it, and the test pins both halves so a later reader cannot collapse one
     into the other. */
  test('the tool still carries the shared absence ban', async ({ page }) => {
    await ready(page);
    expect(await systemFor(page)).toMatch(/NEVER DOCUMENT AN ABSENCE/);
  });

  test('and a behavior that was looked for and did not occur is kept as a finding', async ({ page }) => {
    await ready(page);
    const system = await systemFor(page);
    expect(system).toMatch(/A behavior that was looked for and did not occur is a finding/);
    expect(system).toMatch(/about the client rather than about the documentation/);
    expect(system).toMatch(/which is the line the absence rule already draws, so it is not an exception to it/);
    // The guard against the other failure: inventing an absence nobody reported.
    expect(system).toMatch(/Report an absence only where the intake states it/);
  });
});

test.describe('the two new hint codes clear every gate the tool has', () => {
  /* The defect this suite already caught once on bt and sup: a code has to
     clear the schema enum, normalizeHints, AND the tool's own prompt list, and
     a code that clears two of the three is silently dropped with nothing
     anywhere saying so. */
  const NEW_CODES = ['no_results', 'unscored_instrument'];

  test.beforeEach(async ({ page }) => { await ready(page); });

  for (const code of NEW_CODES) {
    test(`${code} is in the schema enum the model is constrained to`, async ({ page }) => {
      const codes = await assess(page, (t) => t.responseSchema.properties.hints.items.properties.code.enum);
      expect(codes).toContain(code);
    });

    test(`${code} survives normalizeHints instead of being filtered out`, async ({ page }) => {
      const out = await assess(page, `(t) => t.normalizeOutput({ hints: [{ section: 'results', code: '${code}', detail: 'VB-MAPP', rank: 1, kind: 'thin' }] })`);
      expect(out.hints.map((h) => h.code)).toEqual([code]);
    });

    test(`${code} is enumerated in the prompt, so the model knows it may use it`, async ({ page }) => {
      expect(await systemFor(page)).toContain(code);
    });
  }

  test('both are scoped to the results section in the prompt, since neither means anything elsewhere', async ({ page }) => {
    const system = await systemFor(page);
    expect(system).toMatch(/no_results \(section = results;/);
    expect(system).toMatch(/unscored_instrument \(section = results;/);
  });

  test('an unknown code is still dropped, so the gate did not just get opened', async ({ page }) => {
    const out = await assess(page, (t) =>
      t.normalizeOutput({ hints: [{ section: 'results', code: 'not_a_real_code', detail: 'x', rank: 1, kind: 'thin' }] }));
    expect(out.hints).toEqual([]);
  });
});

test.describe('the logged-out copy-prompt path gets the field too', () => {
  /* His 2026-08-04 ruling keeps the copy-prompt path a logged-out feature, so a
     clinician who never signs in still pastes a prompt that produces both
     fields. A format block that listed one of them would send that clinician
     back to writing the second by hand, which is the whole defect. */
  test('the labeled block asks for both narratives, in form order', async ({ page }) => {
    await ready(page);
    const labeled = await assess(page, (t) => t.buildLabeledPrompt({ summaryNotes: 'VB-MAPP administered.' }));
    const summaryAt = labeled.indexOf('BRIEF SUMMARY OF ACTIVITIES COMPLETED [narrative]');
    const resultsAt = labeled.indexOf('RESULTS OF ASSESSMENT [narrative]');
    expect(summaryAt).toBeGreaterThan(-1);
    expect(resultsAt).toBeGreaterThan(summaryAt);
  });

  test('the JSON block carries the results key, between narrative and hints', async ({ page }) => {
    await ready(page);
    const system = await systemFor(page);
    expect(system).toMatch(/"narrative": "",\s*\n\s*"results": "",\s*\n\s*"hints": \[\]/);
  });
});

test.describe('the intake asks for what the second field needs', () => {
  /* A field the tool must draft and the form never asks about produces an empty
     box or an invented one. The placeholder is where a BCBA learns what to
     type, so it carries a findings example rather than only activities. */
  test('the summary input prompts for findings as well as activities', async ({ page }) => {
    await ready(page);
    const input = await assess(page, (t) => t.inputs.find((i) => i.id === 'summaryNotes'));
    expect(input.hint).toMatch(/Then what it showed/);
    expect(input.hint).toMatch(/Results of Assessment/);
    expect(input.placeholder).toMatch(/23\.5 milestone points/);
    expect(input.placeholder).toMatch(/attention-only condition did not/);
  });
});
