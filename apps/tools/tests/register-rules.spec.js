import { test, expect } from '@playwright/test';

/* The maintainer sent one narrative in two versions with everything else held
 * constant: his original scored 53% on QuillBot, his own edit scored 0%.
 *
 * The scorer already shipped rated the 53% version as the BETTER of the two,
 * because sentence count, length, burstiness and opener variety were identical
 * between them. Everything that moved was word choice and clause construction,
 * which no structural measure can see. That is the gap these tests close.
 *
 * The pair is used verbatim as a known-bad and known-good, which nothing else
 * in this project has had. */

const BAD = "The behavior technician proactively offered the client choice of task and task "
  + "order when possible and choice of session area within the home to support engagement. "
  + "The technician also used first-then language (Premack principle) to structure task "
  + "transitions. Additionally, the behavior technician delivered non-contingent attention "
  + "(NCR) throughout the session regardless of the client's behavior, which altered the "
  + "client's motivational state by ensuring attention was available independent of "
  + "behavioral response. These strategies supported the client's participation across the session.";

const GOOD = "The BT offered the client choice of task / task order when possible, and choice "
  + "of session area within the home to increase engagement. The technician also used "
  + "first-then language (Premack principle) to structure task transitions. Additionally, the "
  + "behavior technician delivered non-contingent attention (NCR) during the session "
  + "regardless of the client's behavior, which decreased the client's motivation for "
  + "attention, because attention was available independent of problem behaviors. These "
  + "strategies supported the client's participation across the session.";

test.describe('flagged construction measurement', () => {
  test('separates the 53% version from the 0% version', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!window.NoteMetrics);

    const out = await page.evaluate(([bad, good]) => ({
      bad: window.NoteMetrics.measure(bad),
      good: window.NoteMetrics.measure(good),
    }), [BAD, GOOD]);

    // The whole point: this must move in the direction the detector moved.
    expect(out.bad.flaggedPer100, 'the 53% version must carry more flagged constructions')
      .toBeGreaterThan(out.good.flaggedPer100);

    // And each component individually, so a single dominant term cannot mask a
    // regression in the others.
    expect(out.bad.emptyAdverbs).toBeGreaterThan(out.good.emptyAdverbs);
    expect(out.bad.participialCausals).toBeGreaterThan(out.good.participialCausals);
    expect(out.bad.abstractStates).toBeGreaterThan(out.good.abstractStates);
    expect(out.good.abstractStates, 'the edited version has none left').toBe(0);
  });

  test('the structural score alone does NOT separate them, which is why this exists', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!window.NoteMetrics);

    const out = await page.evaluate(([bad, good]) => ({
      bad: window.NoteMetrics.measure(bad),
      good: window.NoteMetrics.measure(good),
    }), [BAD, GOOD]);

    // Documented rather than asserted as desirable: the structural signals are
    // flat or backwards across a 53 point detector swing. If a future change
    // makes them genuinely discriminate, this test should be revisited, not
    // deleted, because the conclusion it guards would have changed.
    expect(Math.abs(out.bad.burstiness - out.good.burstiness)).toBeLessThan(0.05);
    expect(out.bad.openerVariety).toBe(out.good.openerVariety);
  });
});

test.describe('register rules reach the tools', () => {
  const SESSION_TOOLS = ['sup', 'assess', 'parent'];

  test('every session note tool carries the constructions and the tired register', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sup');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    const prompts = await page.evaluate((ids) => {
      const out = {};
      for (const id of ids) {
        const t = window.NOTE_TOOLS.find((x) => x.id === id);
        out[id] = t ? t.buildSystem() : null;
      }
      return out;
    }, SESSION_TOOLS);

    for (const id of SESSION_TOOLS) {
      expect(prompts[id], `${id} did not load`).toBeTruthy();
      expect(prompts[id], `${id} is missing the construction rules`)
        .toMatch(/Abstract state nouns/);
      expect(prompts[id], `${id} is missing the tired staff register`)
        .toMatch(/end of a work block/);
      expect(prompts[id], `${id} should treat sentence ranges as a ceiling`)
        .toMatch(/CEILING, never a target/);
    }
  });

  test('SAP takes the constructions but NOT the brevity register', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    const system = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'sap').buildSystem());

    expect(system, 'constructions are universal').toMatch(/Abstract state nouns/);
    // A plan is read BEFORE a session by someone who needs the detail, so the
    // brevity instruction would contradict the rule already in that prompt.
    expect(system, 'the tired staff brevity register must not reach the plan tool')
      .not.toMatch(/end of a work block/);
    expect(system, 'and its own do-not-compress rule must survive').toMatch(/[Dd]o not compress/);
  });

  test('no session tool still demands a minimum sentence count', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=assess');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    const prompts = await page.evaluate((ids) => {
      const out = {};
      for (const id of ids) {
        const t = window.NOTE_TOOLS.find((x) => x.id === id);
        out[id] = t ? t.buildSystem() : null;
      }
      return out;
    }, SESSION_TOOLS);

    for (const id of SESSION_TOOLS) {
      // "5-8 sentences" reads as a target to fill. That is what produced notes
      // more complete than a tired technician would ever write.
      expect(prompts[id], `${id} still states a sentence floor`).not.toMatch(/\d+-\d+ sentences?\b/);
    }
  });
});

test.describe('session record focus', () => {
  /* The field requirement is observable events, and the maintainer's own
   * example is why that cannot be applied as an absolute: "he approached staff
   * and was happy" survives in real notes without anyone operationally defining
   * happy. Stripping it produces prose no technician wrote, which is its own
   * tell, and expanding it into "demonstrated positive affect as evidenced by"
   * is worse on both counts.
   *
   * So the rule is an ORDER rather than a ban: opinion, causation and clinical
   * hypotheses come out first, and a light judgment sitting on something seen
   * stays. Three tools carried an absolutist "no value-laden phrasing" that
   * contradicted the second half. */
  const SESSION_TOOLS = ['sup', 'assess', 'parent'];

  test('removal and flagging are separate lists, not one cut order', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sup');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    const prompts = await page.evaluate((ids) => {
      const out = {};
      for (const id of ids) {
        const t = window.NOTE_TOOLS.find((x) => x.id === id);
        out[id] = t ? t.buildSystem() : null;
      }
      return out;
    }, SESSION_TOOLS);

    for (const id of SESSION_TOOLS) {
      expect(prompts[id], `${id} did not load`).toBeTruthy();
      expect(prompts[id], `${id} does not separate removal from flagging`).toMatch(/REMOVE, ALWAYS/);
      expect(prompts[id], `${id} should flag opinion rather than delete it`).toMatch(/FLAG, DO NOT REMOVE/);
      expect(prompts[id], `${id} should forbid causal claims`).toMatch(/Claims about WHY a behavior happened/);
      expect(prompts[id], `${id} should keep hypotheses with the BCBA`).toMatch(/Clinical hypotheses/);
    }
  });

  /* His correction, and it is sharper than what I had written. A feeling is not
   * a behavior. What made "happy" acceptable was never that the word is mild,
   * it is that the observation sits right beside it: he approached, unprompted.
   * A feeling named with nothing attached is a MISSING OBSERVATION, not a
   * softer one, and the answer is to ask what told them rather than to delete
   * the word or invent a definition for it. Three moves, not two. */
  test('a feeling with nothing attached earns a question rather than deletion', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sup');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    const prompts = await page.evaluate((ids) => {
      const out = {};
      for (const id of ids) {
        const t = window.NOTE_TOOLS.find((x) => x.id === id);
        out[id] = t ? t.buildSystem() : null;
      }
      return out;
    }, SESSION_TOOLS);

    for (const id of SESSION_TOOLS) {
      expect(prompts[id], `${id} should state that a feeling is not a behavior`)
        .toMatch(/A FEELING IS NOT A BEHAVIOR/);
      expect(prompts[id], `${id} should flag rather than delete`)
        .toMatch(/FLAG A FEELING THAT HAS NOTHING ATTACHED/);
      // Stated as a problem plus options, not as a question. He reads these at
      // the end of a shift and a flat statement is faster to act on.
      expect(prompts[id], `${id} hint should offer the two ways out`)
        .toMatch(/Add a description or remove it/);
      expect(prompts[id], `${id} should not phrase the hint as a question`)
        .toMatch(/Do not phrase these as a question/);
      // The two failure modes: answering it itself, or quietly removing the word.
      expect(prompts[id], `${id} must forbid both wrong answers`)
        .toMatch(/Never answer it yourself and never quietly drop the word/);
      // It has to route into the existing hint mechanism, not invent a new one.
      expect(prompts[id], `${id} should use the hint code the tools already have`)
        .toMatch(/ambiguous_item hint/);
    }
  });

  test('a light judgment is explicitly kept, not stripped and not expanded', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sup');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    const prompts = await page.evaluate((ids) => {
      const out = {};
      for (const id of ids) {
        const t = window.NOTE_TOOLS.find((x) => x.id === id);
        out[id] = t ? t.buildSystem() : null;
      }
      return out;
    }, SESSION_TOOLS);

    for (const id of SESSION_TOOLS) {
      expect(prompts[id], `${id} should keep a feeling that has its observation beside it`)
        .toMatch(/KEEP A FEELING THAT HAS ITS OBSERVATION BESIDE IT/);
      // The absolutist rule that contradicted it. Three tools carried it.
      expect(prompts[id], `${id} still bans all value-laden phrasing, which strips "happy"`)
        .not.toMatch(/observable language - no value-laden phrasing/);
    }
  });

  test('none of this reaches the SAP tool, which is not a session record', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    const system = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'sap').buildSystem());

    // A plan is written before anything is observed, so a rule about what a
    // record of a session may contain is meaningless there and would only
    // compete with the plan's own instructions.
    expect(system).not.toMatch(/REMOVE, ALWAYS/);
    expect(system).not.toMatch(/A FEELING IS NOT A BEHAVIOR/);
    // Its own rules survive.
    expect(system).toMatch(/Abstract state nouns/);
  });
  test('opinion is a different severity from causation, and the technician can override', async ({ page }) => {
    /* His correction: opinion and causation are not the same thing. A causal
     * claim can land as inappropriate to whoever reads the record next and is
     * not the technician's to make, so it goes without appeal. An opinion is
     * sometimes fine and they may have a reason for it, so it is flagged with a
     * short why and left to them. A technician who reads the flag and keeps the
     * sentence has overridden it, which is the intended outcome. */
    await page.goto('/notes/bcba/index.html?tool=sup');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    const system = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'sup').buildSystem());

    // Causation: no appeal, and the reason is stated rather than asserted.
    expect(system).toMatch(/can land as inappropriate/);
    expect(system).toMatch(/not the technician's to make/);

    // Opinion: kept, flagged, overridable.
    expect(system).toMatch(/Staff opinion .* is sometimes fine/);
    expect(system).toMatch(/has overridden it, which is the correct outcome/);

    // The two must not be collapsed back into one list of things to delete.
    const removeIdx = system.indexOf('REMOVE, ALWAYS');
    const flagIdx = system.indexOf('FLAG, DO NOT REMOVE');
    expect(removeIdx, 'both headings must be present').toBeGreaterThan(-1);
    expect(flagIdx).toBeGreaterThan(removeIdx);
    expect(system.slice(removeIdx, flagIdx), 'opinion must not sit under REMOVE')
      .not.toMatch(/Staff opinion/);
  });
});
