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
      expect(prompts[id], `${id} should treat sentence ranges as a floor and a ceiling, never a target`)
        .toMatch(/has a floor and a ceiling, and neither is a target/);
      expect(prompts[id], `${id} should never pad to reach the floor`)
        .toMatch(/the draft never pads to reach the floor/);
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
      /* The removal list must still HAVE something under it on these three. It
         lost the two analysis lines when the analysis went back to the BCBA who
         is writing, and a heading with nothing beneath it is the failure that
         change could have caused. Who keeps which line is pinned at the bottom
         of this file. */
      expect(prompts[id], `${id} has an empty removal list`).toMatch(/\* Anything a checkbox on the form already records\./);
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
    /* The causal half of this now lives on bt alone, because the author of the
       other three IS the BCBA the rule was reserving the analysis for. The
       severity distinction it draws is unchanged; only its reach moved. */
    await page.goto('/notes/bt/');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    const btSystem = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'bt').buildSystem());

    // Causation: no appeal, and the reason is stated rather than asserted.
    expect(btSystem).toMatch(/can land as inappropriate/);
    expect(btSystem).toMatch(/not the technician's to make/);

    await page.goto('/notes/bcba/index.html?tool=sup');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    const system = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'sup').buildSystem());

    // Opinion: kept, flagged, overridable. This half is not about who is
    // holding the pen, so it reaches every session-note tool.
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

/* A RULE THE TOOL CANNOT OBEY IS NOT A RULE.
 *
 * The two FLAG rules above route into the hint mechanism by name: an opinion
 * with no observation behind it, and a feeling with nothing attached, both
 * become an `ambiguous_item` hint rather than a deletion. Every test above this
 * line checks that the INSTRUCTION is in the prompt. None of them checked that
 * the tool would accept the answer.
 *
 * It would not, on two of the four. `code` is an enum built from each tool's own
 * HINT_CATALOG, and normalizeHints drops any code the catalog does not hold, so
 * on bt and sup both rules were unobeyable while their wording sat in the
 * prompt: the model is told to emit ambiguous_item, the schema forbids the
 * value, and the finding is lost with nothing anywhere saying so. assess, parent
 * and sap have carried the code since they were written.
 *
 * So this reads the codes out of the shared rules themselves rather than
 * listing them here. A future rule that names a new code is covered the day it
 * is written, which is the only version of this test worth having.
 */
test.describe('every hint code the shared rules name is one the tool will accept', () => {
  /* bt included. It is the highest-volume tool and it was missing from the two
     lists above, which is part of why this went unnoticed - and it was easy to
     miss because bt is not registered on the same page. Six tool ids live on two
     pages, and window.NOTE_TOOLS holds only the ones its own page loaded, so a
     list gathered from one page silently excludes the other. */
  const PAGES = {
    '/notes/bcba/index.html?tool=sup': ['sup', 'assess', 'parent'],
    '/notes/bt/': ['bt'],
  };
  const ALL_SESSION_TOOLS = ['bt', 'sup', 'assess', 'parent'];

  // Walk both pages and merge, so "did not load" means the tool is genuinely
  // missing rather than that this test looked in one place.
  async function acrossPages(page, collect) {
    const out = {};
    for (const [url, ids] of Object.entries(PAGES)) {
      await page.goto(url);
      await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length && window.NoteRegisterRules));
      Object.assign(out, await page.evaluate(collect, ids));
    }
    return out;
  }

  test('the rules name at least one code, so this test cannot pass vacuously', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sup');
    await page.waitForFunction(() => !!window.NoteRegisterRules);
    const codes = await page.evaluate(() =>
      [...new Set((window.NoteRegisterRules.sessionNote.match(/\b([a-z]+_[a-z_]+) hint\b/g) || [])
        .map((m) => m.replace(/ hint$/, '')))]);
    expect(codes, 'the shared rules stopped naming any hint code').toContain('ambiguous_item');
  });

  /* The extraction above reads a code out of prose by requiring an underscore,
     because "the hint reaches the person who can still fill it in" is a sentence
     and "an ambiguous_item hint" is a code. That works only while every code
     that a rule could name actually has an underscore in it, so the assumption
     is pinned here rather than left in a comment: a future single-word code
     would slip past the reader above and this is what says so. */
  test('every hint code is shaped so the rules can name it unambiguously', async ({ page }) => {
    const codes = await acrossPages(page, (ids) => {
      const out = {};
      for (const id of ids) {
        const t = window.NOTE_TOOLS.find((x) => x.id === id);
        out[id] = t ? Object.keys(t.hintCatalog || {}) : null;
      }
      return out;
    });
    for (const id of ALL_SESSION_TOOLS) {
      expect(codes[id], `${id} did not load`).toBeTruthy();
      for (const code of codes[id]) {
        // "other" is the escape hatch and no rule names it by code.
        if (code === 'other') continue;
        expect(code, `${id}'s "${code}" has no underscore, so a rule naming it would not be found`)
          .toMatch(/_/);
      }
    }
  });

  test('and every tool that gets those rules accepts every code they name', async ({ page }) => {
    const rows = await acrossPages(page, (ids) => {
      const named = [...new Set((window.NoteRegisterRules.sessionNote.match(/\b([a-z]+_[a-z_]+) hint\b/g) || [])
        .map((m) => m.replace(/ hint$/, '')))];
      const out = {};
      for (const id of ids) {
        const t = window.NOTE_TOOLS.find((x) => x.id === id);
        out[id] = t ? { named, codes: Object.keys(t.hintCatalog || {}) } : null;
      }
      return out;
    });

    for (const id of ALL_SESSION_TOOLS) {
      expect(rows[id], `${id} did not load`).toBeTruthy();
      expect(rows[id].named.length, 'the shared rules named no codes').toBeGreaterThan(0);
      for (const code of rows[id].named) {
        expect(rows[id].codes, `${id} is told to emit "${code}" and its catalog rejects it`)
          .toContain(code);
      }
    }
  });

  /* A THIRD GATE, and the one that was nearly missed. Four tools enumerate their
     own codes inside the prompt, bt and sup under the words "code MUST be from
     this list". A catalog that accepts a code the prompt forbids is the same
     defect pointing the other way, and it is worse, because the model reads the
     MUST and obeys it while every schema-level test passes.

     The rule is stated as a conditional rather than as "every prompt lists every
     code": a tool that names none of its codes in prose is not doing anything
     wrong. It is a tool that names SOME of them and omits one the shared rules
     require. */
  test('a tool that lists its codes in the prompt lists the ones the rules require', async ({ page }) => {
    const rows = await acrossPages(page, (ids) => {
      const named = [...new Set((window.NoteRegisterRules.sessionNote.match(/\b([a-z]+_[a-z_]+) hint\b/g) || [])
        .map((m) => m.replace(/ hint$/, '')))];
      const out = {};
      for (const id of ids) {
        const t = window.NOTE_TOOLS.find((x) => x.id === id);
        if (!t) { out[id] = null; continue; }
        const system = t.buildSystem();
        // Its own codes, as the prompt would write them in a list.
        const own = Object.keys(t.hintCatalog || {}).filter((c) => c !== 'other');
        out[id] = {
          named,
          listsAnyOwnCode: own.some((c) => system.includes('- ' + c) || system.includes(c + ' (')),
          present: named.filter((c) => system.includes('- ' + c) || system.includes(c + ' (')),
        };
      }
      return out;
    });

    for (const id of ALL_SESSION_TOOLS) {
      expect(rows[id], `${id} did not load`).toBeTruthy();
      if (!rows[id].listsAnyOwnCode) continue;
      for (const code of rows[id].named) {
        expect(rows[id].present, `${id} enumerates its hint codes and omits "${code}", which its rules require`)
          .toContain(code);
      }
    }
  });

  /* The schema and the normalizer are two separate gates on the same value and
     both read the catalog, so a code has to survive both. Asserting on the
     catalog alone would pass on a build where the normalizer was changed to
     filter against something else. */
  test('an ambiguous_item hint survives normalization rather than being dropped', async ({ page }) => {
    const kept = await acrossPages(page, (ids) => {
      const rows = {};
      for (const id of ids) {
        const t = window.NOTE_TOOLS.find((x) => x.id === id);
        if (!t) { rows[id] = null; continue; }
        const section = t.formSections
          .map((s) => (typeof s === 'string' ? s : s.id || s.key))
          .filter(Boolean)[0];
        const out = t.normalizeOutput({
          hints: [{ section, code: 'ambiguous_item', detail: "'frustrated' has no observation", rank: 1, kind: 'register' }],
        });
        rows[id] = (out.hints || []).map((h) => h.code);
      }
      return rows;
    });

    for (const id of ALL_SESSION_TOOLS) {
      expect(kept[id], `${id} did not load`).toBeTruthy();
      expect(kept[id], `${id} dropped the hint its own rules asked for`).toContain('ambiguous_item');
    }
  });
});

/* WHO OWNS THE ANALYSIS, AND THEREFORE WHO IS ALLOWED TO WRITE IT DOWN.
 *
 * Two lines in the shared block take the analysis away from the author and
 * reserve it for a BCBA:
 *
 *   * Claims about WHY a behavior happened ... not the technician's to make.
 *   * Clinical hypotheses. Function, motivation and diagnosis belong to the
 *     BCBA's analysis.
 *
 * On the BT note that is right and it is his own ruling. It reached sup, assess
 * and parent too, and all three are written BY a BCBA, so the rule took the
 * analysis away from the person it was reserving it for. On the assessment tool
 * it deleted the finding the assessment exists to produce.
 *
 * His instruction, 2026-08-31: "The fix for BCBA analysis should be widened to
 * all non BT tools. remove from all but the BT note tool."
 *
 * These tests are the whole guard. The split is invisible at every call site -
 * `sessionNote` and `sessionNoteBcba` differ by one character in a tool file -
 * so nothing else would catch a tool wired to the wrong build.
 */
const ANALYSIS_LINES = [
  'Claims about WHY a behavior happened',
  "Clinical hypotheses. Function, motivation and diagnosis belong to the BCBA's analysis",
];

test.describe('the analysis rules reach the technician tool and no other', () => {
  test('bt keeps both of them, because bt is the one note a technician writes', async ({ page }) => {
    await page.goto('/notes/bt/');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    const system = await page.evaluate(() => window.NOTE_TOOLS.find((t) => t.id === 'bt').buildSystem());
    for (const line of ANALYSIS_LINES) expect(system, `bt lost "${line}"`).toContain(line);
    expect(system).toContain('the technician does not get a say');
  });

  for (const id of ['sup', 'assess', 'parent']) {
    test(`${id} carries neither, because a BCBA writes it`, async ({ page }) => {
      await page.goto('/notes/bcba/index.html');
      await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
      const system = await page.evaluate((t) => window.NOTE_TOOLS.find((x) => x.id === t).buildSystem(), id);
      for (const line of ANALYSIS_LINES) {
        expect(system, `${id} still reserves the analysis for someone else`).not.toContain(line);
      }
      // The header spoke to a technician about a list that no longer has any
      // technician-specific item left on it.
      expect(system).not.toContain('the technician does not get a say');
    });
  }

  /* The over-correction this could have been. Removing two bullets must not
     take the rest of the block with them, and the removal must not read as a
     general licence to editorialise. */
  for (const id of ['sup', 'assess', 'parent']) {
    test(`${id} keeps everything else the shared block says`, async ({ page }) => {
      await page.goto('/notes/bcba/index.html');
      await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
      const system = await page.evaluate((t) => window.NOTE_TOOLS.find((x) => x.id === t).buildSystem(), id);
      expect(system).toContain('REMOVE, ALWAYS');
      expect(system).toContain('* Anything a checkbox on the form already records.');
      expect(system).toContain('FLAG, DO NOT REMOVE');
      expect(system).toContain('NEVER DOCUMENT AN ABSENCE');
      expect(system).toContain('WHAT THIS RECORD IS FOR');
      expect(system).toContain('A FEELING IS NOT A BEHAVIOR');
    });
  }

  /* THE HOLE THE TWO TESTS ABOVE LEFT OPEN, found 2026-09-28 from a real note.
     ANALYSIS_LINES are the shared block's sentences, matched verbatim, so a tool
     that says the same thing in its OWN core passes both loops while taking the
     analysis away again. parent.js did exactly that: its core carried "Cut staff
     opinion, causal claims and clinical hypotheses", which is the removal this
     file exists to protect, in different words. Kaleb's function analysis - he
     ranked attention over escape - came back out of the narrative and reappeared
     in follow-up as a tie, then as escape-maintained, backwards from what he
     wrote.

     So these assertions read the COMPOSED prompt for a phrase that bans the
     analysis however it is spelled, and require the permission to be stated
     rather than merely not contradicted. assess.js:124 is where that permission
     was already written; this is the same shape on the other two BCBA tools. */
  /* WHY THIS IS AN ALLOW-LIST AND NOT A MATCHER, third attempt.

     First attempt: four regexes over three verbs and a plural noun.
     castor-cfae8acd walked two rewordings through it.
     Second attempt: a verb-polarity classifier with a fourteen sentence fixture.
     They walked NINE more through it, including "Keep causal claims out of the
     note.", "Causal claims do not belong in this note." and "Describe only what
     was seen, never why it happened." It also missed the one real ban in the
     repo, bt's technician list, because the removing verb sits on the header
     line rather than on the bullet, and it flagged "It is fine to leave in
     clinical hypotheses; only cut filler."

     That is the #55 lesson twice over: every control I write puts the thing in
     the position I already thought of. A matcher cannot win this, because the
     set of ways to say "do not do the analysis" is not enumerable and the set
     of people who will add one is not either.

     So this stops trying to recognise a ban. Every sentence in a composed BCBA
     prompt that touches the analysis vocabulary has to be a sentence somebody
     READ and listed below. A new one fails until it is read, whatever it says,
     and the failure prints it so reading it is the fix. That is closed-enum
     behaviour on prose: unknown input fails, rather than being waved through
     because no pattern happened to match it. */
  /* WIDENED after a third read. Five bans got past the first list by avoiding
     the words rather than the meaning: "Leave out the reason a behavior
     occurred." and "Do not interpret the purpose of the behavior." carry none
     of caus, why, hypothes, function, motivat, speculat, explanation or
     diagnos. An allow-list is only closed over the vocabulary that opens it,
     so the vocabulary is the hole, and widening it costs twelve more sentences
     to read once rather than a guess at every phrasing. */
  const ANALYSIS_VOCAB = /caus|\bwhy\b|hypothes|function|motivat|speculat|explanation|diagnos|reason|purpose|interpret|infer|maintain|attribut|\bescape|\battention|\bintent/i;

  function analysisSentences(text) {
    return String(text)
      .split(/\n|(?<=[.:])\s+(?=[A-Z"'*-])/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => ANALYSIS_VOCAB.test(s));
  }

  /* Read one by one on 2026-09-28. Every one is a permission, a terminology rule
     or a structural instruction, and not one of them bans the analysis. Adding a
     line here is the review: do not paste a failing sentence in to make the
     suite green. */
  const REVIEWED = new Set([
    'For training strategies and programming decisions, fold rationale inline - "[caregiver skill level or observed barrier], so [approach] was selected to [functional target or generalization outcome]" - not as a separate rationale sentence.',
    'This author is the Behavior Analyst documenting their own training session, so function, motivation and causal reasoning are their own work and belong in the note.',
    '- So do not cut a causal claim or a clinical hypothesis out of this note, and do not flatten a ranking.',
    'Where they wrote that one function drove the behavior MORE than another, the note says the same thing in the same order, hedged to the evidence they gave and no further.',
    'Prompt and stage codes (RI, M, I and the like, read against the legend they gave) are data too, so name the teaching stage the trials ran under, because the author uses it to plan the next fade.',
    'This is faithfulness and not a caveat: accuracy and independence are different measures, so never hedge, qualify or reinterpret a percentage because prompting was in place.',
    'No loose synonyms (rewarded, encouraged, motivated).',
    '\'decreased the motivation for attention\' not \'altered the motivational state\'.',
    '* Participial causals of the form \'by ensuring\', \'by providing\', \'by allowing\'.',
    'Use a comma and \'because\', or start a new sentence.',
    '* Form before function.',
    'Where only the function is available and the form is genuinely not recoverable, write the function alone and emit the hint.',
    'NEVER invent a topography, because an invented one reads exactly like an observed one.',
    'PROCEDURES GO IN THE ORDER THEY RUN, BECAUSE THAT ORDER IS THE DESIGN.',
    'This is not a preference, because it is wrong in a record rather than merely unwanted:',
    'Embed clinical purpose inline - "[instrument] was administered to identify [deficit or function], [how findings inform planning]" - not as a separate purpose sentence.',
    'Purpose belongs here ("administered to assess X", "to eliminate confounds for behavioral function").',
    '- Report strengths and deficits BY DOMAIN and carry the boundary, because the boundary is the finding.',
    '"Imitation showed generalized instances but not across functional tasks or vocal instruction to imitate" is a finding.',
    '- Where a function was assessed, report it condition by condition before naming it: what the behavior looked like, what occasioned it, what was delivered in each condition, and which conditions did and did not resolve it.',
    'A handful of trials does not license a flat assertion of function.',
    'Assigning a function, naming an establishing operation and identifying an intervention target is what an assessment is for, and it is this author\'s own work.',
    '- So do not cut a causal claim or a clinical hypothesis out of this note.',
    'Naming why a behavior occurs is the assessment\'s finding, not an overreach, provided it is hedged to the evidence that supports it.',
    '- Precise verbs: administered [instrument], conducted a preference assessment, conducted FBA/FA, ran probes, established baseline, observed, interviewed, scored, identified function.',
    // sup's one-owner-per-facet specs, read 2026-10-02. Each says which section
    // owns a facet and asks for the reason to be kept, so none takes the
    // analysis away from the BCBA. The progress line replaces its older form,
    // and now carries the sup tuning's SENTENCE BUDGETS in place of a count.
    '- progress (Summary of Progress and Findings; owns the session arc): sized by SENTENCE BUDGETS, on what data or trends were reviewed, which goals were the focus and why, what was observed that the goal rows do not carry, and any probes or assessments run.',
    '"nextSteps" = what happens to that goal next (continue, modify, hold, mastered or discontinued) with the reason from that goal\'s own data folded in, in the BCBA\'s terms, 1 sentence.',
    'Write it from what the notes say about that goal, so two goals with the same disposition still read differently because their reasons differ.',
    'Each change is stated here once, with its data reason folded into the sentence, and this includes a change to a behavior plan.',
    // sup tuning, section A, read 2026-10-01. Each limits restating or guessing and bans none of the BCBA's analysis.
    'Do not assume a rule such as "two errors in a row, then a more intrusive prompt", because it varies by skill, child and clinician.',
    'Give a reason only when the notes give one.',
    'Escape each one as \\" so the JSON stays valid.',
    // Surfaced by the widening, read 2026-09-28. Output specs, checkbox
    // inference, one worked example, and the opinion carve-out, which flags
    // rather than removes and is the opposite of a ban.
    'OUTPUT: (a) third-person clinical narratives, (b) conservative checkbox inferences for the BCBA to verify.',
    'CHECKBOX INFERENCE:',
    'Infer conservatively - only options clearly supported by the notes.',
    '"The behavior technician modeled play with the toy and reduced attention for several seconds.',
    'Staff opinion about the client, the family or the program is sometimes fine and the technician may have a reason for it.',
    'Keep what they wrote, and emit an ambiguous_item hint on that section giving the reason in a few words, for example \'opinion, not observation.',
    'Purpose: assess language skills."',
    'OUTPUT: (a) a up to 8 sentence third-person clinical narrative for the "Brief Summary of Activities Completed" field, (b) a up to 10 sentence third-person clinical narrative for the "Results of Assessment" field, (c) conservative checkbox inferences for the BCBA to verify.',
    '- "Brief Summary of Activities Completed" is what the Behavior Analyst DID: the instruments administered and the repertoire or domains each one covers, how data were collected, what was manipulated and in what order, and the clinical purpose of each.',
    '- Hedge the inference to the evidence behind it.',
    'The floor is the minimum for a section that has content, the ceiling is the stated maximum, and the draft never pads to reach the floor, because a section with little to say stays short.',
    'YOUR JOB: put what the BCBA entered into the permitted format while preserving clinical intent - NOT to capture everything a session could contain.',
    'EXACTLY one of the allowed strings, inferred conservatively from the progress data across goals.',
  ]);

  for (const id of ['parent', 'assess', 'sup']) {
    test(`every analysis sentence in ${id} is one somebody reviewed`, async ({ page }) => {
      await page.goto('/notes/bcba/index.html');
      await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
      const system = await page.evaluate((t) => window.NOTE_TOOLS.find((x) => x.id === t).buildSystem(), id);
      const unreviewed = analysisSentences(system).filter((s) => !REVIEWED.has(s));
      expect(unreviewed,
        `${id} carries a sentence about the analysis that nobody has read. Read it, and if it `
        + 'does not take the analysis away from the BCBA, add it to REVIEWED above').toEqual([]);
      /* All three carried "Cut staff opinion, causal claims and clinical
         hypotheses" in their own cores before this change, at assess.js:135,
         sup.js:185 and parent.js:125. Only the clause went: the sentence around
         it stays whole, so this is not a licence to editorialise. */
      expect(system).toContain('A light judgment sitting on something actually seen');
    });
  }

  /* THE VOCABULARY IS THE ONE PART THAT CAN STILL BE TOO NARROW, so it gets its
     own fixture. The allow-list is closed over whatever ANALYSIS_VOCAB matches;
     a sentence the vocabulary never sees is never reviewed and never fails.
     castor-fa9d3593 found five that way, and every one of them is invisible to
     the first list: not one carries caus, why, hypothes, function, motivat,
     speculat, explanation or diagnos. */
  test('the vocabulary sees a ban that avoids the obvious words', () => {
    const SNEAKY = [
      'Leave out the reason a behavior occurred.',
      'Do not interpret the purpose of the behavior.',
      'Never infer what maintained the response.',
      'Do not attribute the behavior to escape or attention.',
      'Omit any statement of the client intent.',
    ];
    for (const s of SNEAKY) {
      expect(analysisSentences(s), `the vocabulary cannot see: ${s}`).toEqual([s]);
      expect(REVIEWED.has(s), `a ban is in the allow-list: ${s}`).toBe(false);
    }

    /* And a sentence with nothing to do with the analysis stays out, because a
       vocabulary that matched everything would turn the allow-list into a
       transcript of the prompt and nobody would read the next addition. */
    for (const s of ['The client sat down.', 'Data were collected on three goals.']) {
      expect(analysisSentences(s), `the vocabulary is too wide: ${s}`).toEqual([]);
    }
  });

  /* THE POSITIVE CONTROL, and the allow-list is worth nothing without it. An
     allow-list passes trivially when the vocabulary never matches anything, so
     this proves the same check FIRES on a real ban. bt is the one tool that is
     supposed to carry one: its author is a technician and the analysis is not
     theirs to make. */
  test('the same check fires on the one real ban in the repo, in bt', async ({ page }) => {
    await page.goto('/notes/bt/');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    const system = await page.evaluate(() => window.NOTE_TOOLS.find((t) => t.id === 'bt').buildSystem());
    const found = analysisSentences(system);
    // The ban is really there, so the vocabulary is not the thing doing the work.
    expect(found).toContain('* Claims about WHY a behavior happened.');
    expect(found).toContain('* Clinical hypotheses.');
    // And it is NOT reviewed, so the same check applied to a BCBA tool would
    // fail on it rather than pass it through.
    const unreviewed = found.filter((s) => !REVIEWED.has(s));
    expect(unreviewed).toContain('* Claims about WHY a behavior happened.');
  });

  /* Only two of the three STATE the permission. sup is left neutral, which is
     what register-rules.js intends; asserting a permission there would be
     inventing a ruling nobody made. */
  test('parent states the permission, in the words assess already used', async ({ page }) => {
    await page.goto('/notes/bcba/index.html');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    const system = await page.evaluate(() => window.NOTE_TOOLS.find((t) => t.id === 'parent').buildSystem());
    expect(system).toContain('THE BCBA IS ENTITLED TO THE ANALYSIS');
    expect(system).toContain('do not cut a causal claim or a clinical hypothesis out of this note');
    // The measured defect, not a restatement of the rule: his ranking of attention
    // over escape came back as a tie, then inverted in follow-up.
    expect(system).toMatch(/do not flatten a ranking/);
  });

  test('assess keeps the permission it already had', async ({ page }) => {
    await page.goto('/notes/bcba/index.html');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    const system = await page.evaluate(() => window.NOTE_TOOLS.find((t) => t.id === 'assess').buildSystem());
    expect(system).toContain('THE BEHAVIOR ANALYST IS ENTITLED TO THE ANALYSIS');
    expect(system).toContain('do not cut a causal claim or a clinical hypothesis out of this note');
  });

  /* The four rules the same note earned, each anchored on what it produced.
     Every one of them is a sentence the model wrote that Kaleb did not. */
  test("parent carries the four rules his own note earned", async ({ page }) => {
    await page.goto('/notes/bcba/index.html');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    const system = await page.evaluate(() => window.NOTE_TOOLS.find((t) => t.id === 'parent').buildSystem());
    // It wrote "The Behavior Analyst modeled" three times, because the prompt's
    // own worked example was that phrase.
    expect(system).not.toContain('The Behavior Analyst modeled');
    expect(system).toContain('name the actor by role, bare, with no article');
    // It was asked for "polished" prose against a register block that asks for
    // the opposite.
    expect(system).not.toContain('polished third-person');
    // It wrote "met criterion" and "implemented skills with fidelity". He took
    // neither measurement.
    expect(system).toMatch(/Never assert criterion, mastery, generalization or fidelity/);
    // It turned his "8/0" into "(8 correct)" and dropped the RI/M stage codes.
    expect(system).toContain('DATA IS QUOTED, NEVER PARAPHRASED');
    expect(system).toContain('8/0 stays 8/0');
    // His ruling, 2026-09-28: accuracy and independence are different axes, and
    // staged prompting is a facet of the teaching interaction rather than a
    // caveat on the percentage. The rule carries the stage; it must never hedge
    // the number.
    expect(system).toMatch(/never hedge, qualify or reinterpret a percentage/);
    // Both halves of that ruling, pinned rather than paraphrased, because an
    // edit that softened either one would still pass the line above.
    expect(system).toContain('accuracy and independence are different measures');
    expect(system).toContain('name the teaching stage the trials ran under');
    // It dropped his parenthetical describing the precursor to the tantrum.
    expect(system).toContain('A parenthetical in the notes is load-bearing');
  });

  /* A quote introduced by a negator is a PROHIBITION, not an example, and the
     polarity carries across a bare conjunction because `Never "A" or "B"`
     forbids both. Only the tail of the gap counts, so a "not" forty characters
     upstream in an unrelated clause does not silence the next example. */
  function articledExamples(text) {
    const s = String(text);
    const out = [];
    let prevEnd = 0;
    let negated = false;
    for (const m of s.matchAll(/"([^"]{12,200})"/g)) {
      const tail = s.slice(prevEnd, m.index).slice(-20);
      if (/\b(?:never|not|rather than)\b/i.test(tail)) negated = true;
      else if (!/^[\s,]*(?:or|and)[\s,]*$/i.test(tail)) negated = false;
      if (!negated && /\b[Tt]he (?:caregiver|[Bb]ehavior [Aa]nalyst)\b/.test(m[1])) out.push(m[1]);
      prevEnd = m.index + m[0].length;
    }
    return out;
  }

  /* THE WORKED EXAMPLES, which is where the model actually learns the voice.
     castor-cfae8acd, reviewing this PR: :112 told it to name the actor bare
     while :113 and :126 still showed it "The caregiver's inconsistent prompt
     delivery" and "the caregiver was praised for". This PR's whole diagnosis is
     that the model copies the core's examples, so an example carrying the
     article teaches the article whatever the rule above it says. */
  /* sup and assess joined on 2026-10-04: Kaleb answered #214's open question
     "switch", so their worked examples name the BCBA bare like parent's. */
  for (const id of ['parent', 'sup', 'assess']) {
    test(`${id}'s own worked examples obey the bare-actor rule`, async ({ page }) => {
      await page.goto('/notes/bcba/index.html');
      await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
      const system = await page.evaluate((tid) => window.NOTE_TOOLS.find((t) => t.id === tid).buildSystem(), id);
      expect(system).not.toMatch(/"The Behavior Analyst (?:reviewed|administered|modeled)/);
      expect(articledExamples(system),
        'a worked example names the actor with an article, and the model copies its examples').toEqual([]);
    });
  }

  /* The fixture for the guard above, for the same reason the ban classifier has
     one. My first cut flagged the bare-actor RULE, because the rule has to quote
     "The Behavior Analyst" in order to forbid it, and a guard that fires on the
     fix is a guard nobody can satisfy.

     sup and assess carried one articled example each until Kaleb's #214
     answer on 2026-10-04; the test above now covers all three. */
  test('the example guard reads a prohibition as a prohibition', () => {
    const forbids = 'Never "The Behavior Analyst" or "the behavior analyst": the article is the tell.';
    expect(articledExamples(forbids), 'the rule forbidding the phrase was read as using it').toEqual([]);

    const teaches = 'Example: "The caregiver was praised for pacing the prompt."';
    expect(articledExamples(teaches), 'a worked example carrying the article went unflagged').toHaveLength(1);

    // A negator far upstream must not silence the example after it.
    const far = 'fold rationale inline, not as a separate rationale sentence. Example: "The caregiver rehearsed the chain."';
    expect(articledExamples(far), 'a distant "not" silenced a real example').toHaveLength(1);

    // And the positive half of a this-not-that pair is still checked.
    const pair = 'Example: "The caregiver implemented the plan" - not "Modeling was provided."';
    expect(articledExamples(pair), 'the positive half of a contrast pair was skipped').toHaveLength(1);
  });

  /* sap takes only the constructions block and never took these rules, so it is
     unaffected either way. Asserted so a future reader does not "fix" it. */
  test('sap is untouched, because it never took the session-record block at all', async ({ page }) => {
    await page.goto('/notes/bcba/index.html');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    const system = await page.evaluate(() => window.NOTE_TOOLS.find((t) => t.id === 'sap').buildSystem());
    expect(system).not.toContain('REMOVE, ALWAYS');
    for (const line of ANALYSIS_LINES) expect(system).not.toContain(line);
  });

  /* bt's served prompt is composed from register-rules.js in voice-module, so a
     stray character in the technician build is a re-extract nobody asked for.
     The two builds must differ ONLY by the two lines and the header. */
  test('the split changed the BCBA build and left the technician build alone', async ({ page }) => {
    await page.goto('/notes/bcba/index.html');
    await page.waitForFunction(() => !!window.NoteRegisterRules);
    const { tech, bcba } = await page.evaluate(() => ({
      tech: window.NoteRegisterRules.sessionNote,
      bcba: window.NoteRegisterRules.sessionNoteBcba,
    }));
    const techOnly = tech.split('\n').filter((l) => !bcba.includes(l));
    expect(techOnly).toHaveLength(3);
    expect(techOnly.filter((l) => l.startsWith('* '))).toHaveLength(2);
    // Everything the BCBA build adds is the one reworded header line.
    const bcbaOnly = bcba.split('\n').filter((l) => !tech.includes(l));
    expect(bcbaOnly).toEqual(['REMOVE, ALWAYS. This is not a preference, because it is wrong in a record rather than merely unwanted:']);
  });
});

/* ── Four items of his bar, written as rules a draft can follow ──────────────
   Build order item 7, on his ruling of 2026-08-31: "All five, via
   register-rules.js. Not bt alone."

   The scope IS the test. B1, B2, B6 and B3 are about writing about a client and
   are as true of a plan as of a note, so they go to all five. The zero rule is
   about reporting a session and goes only where a session is reported. A block
   that carried the second one into the plan tool would be the necessity.js
   defect over again, so both halves are pinned here rather than only the
   widening. */
test.describe('the bar rules a draft can follow', () => {
  const ALL_FIVE = ['bt', 'sup', 'assess', 'parent', 'sap'];
  const SESSION_FOUR = ['bt', 'sup', 'assess', 'parent'];

  /* bt registers on its own page and the other four on the bcba one, so a
     helper that reads all five has to visit both. Reading four and silently
     getting null for the fifth is how a scope test passes on nothing. */
  const build = (list) => {
    const out = {};
    for (const id of list) {
      const t = window.NOTE_TOOLS.find((x) => x.id === id);
      out[id] = t ? t.buildSystem() : null;
    }
    return out;
  };

  const systems = async (page, ids) => {
    const out = {};
    const onBcbaPage = ids.filter((id) => id !== 'bt');
    if (onBcbaPage.length) {
      await page.goto('/notes/bcba/index.html?tool=sap');
      await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
      Object.assign(out, await page.evaluate(build, onBcbaPage));
    }
    if (ids.includes('bt')) {
      await page.goto('/notes/bt/');
      await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
      Object.assign(out, await page.evaluate(build, ['bt']));
    }
    return out;
  };

  test('every tool is told what a sentence about a client has to carry', async ({ page }) => {
    const p = await systems(page, ALL_FIVE);
    for (const id of ALL_FIVE) {
      expect(p[id], `${id} did not load`).toBeTruthy();
      // B1, and the exemption without which it flags every framing sentence.
      expect(p[id], `${id} is missing the observable rule`).toMatch(/An observable\./);
      expect(p[id], `${id} lost B1's exemption`).toMatch(/doing structural work and is exempt/);
      // B2, and the line that makes it safe to demand a topography.
      expect(p[id], `${id} is missing form before function`).toMatch(/Form before function\./);
      expect(p[id], `${id} lost the rule that makes B2 safe`).toMatch(/NEVER invent a topography/);
      // B6, and the exemption that stops it nagging about a word the program
      // already defines. His own line: "sometimes it can be fairly safely
      // divined".
      expect(p[id], `${id} is missing the qualitative-word rule`)
        .toMatch(/A qualitative word carries what it consisted of\./);
      expect(p[id], `${id} lost B6's exemption`).toMatch(/what their own program already defines/);
      // B3, and the order itself, which is the entire rule.
      expect(p[id], `${id} is missing the procedure order`).toMatch(/PROCEDURES GO IN THE ORDER THEY RUN/);
      expect(p[id], `${id} lost the order it names`)
        .toMatch(/Arrangement, then the opportunity or SD, then the prompt/);
    }
  });

  /* Two claims his own production note made and his intake never did, both
     read off screenshots on 2026-09-02. They go to all five for the same reason
     B1 does: neither is a rule about session notes, both are rules about
     writing down what somebody watched. */
  test('no tool may impute a verdict with a connective or invent a pattern from a count', async ({ page }) => {
    const p = await systems(page, ALL_FIVE);
    for (const id of ALL_FIVE) {
      expect(p[id], `${id} did not load`).toBeTruthy();
      // "Even after observing" said the staff response failed. His reading:
      // it "implies ineffectiveness not stated".
      expect(p[id], `${id} is missing the connective rule`)
        .toMatch(/No verdict smuggled in by a connective/);
      expect(p[id], `${id} does not name the connectives`).toMatch(/"Even after", "despite", "although" and "still"/);
      // And the remedy, without which the model deletes the sentence instead of
      // rewriting it. Same failure mode B2 has an escape hatch for.
      expect(p[id], `${id} lost the replacement the rule offers`)
        .toMatch(/let the reader draw it/);
      // The behaviour occurred "a few times" and the note said "in bursts".
      expect(p[id], `${id} is missing the pattern rule`).toMatch(/No pattern the intake did not give/);
      expect(p[id], `${id} does not draw the count-versus-pattern line`).toMatch(/A count is not a pattern/);
    }
  });

  test('the plan tool takes them too, and still takes neither session block', async ({ page }) => {
    /* The pairing is the point rather than the first half alone. Widening a
       shared block is exactly the move that carried bt's section names into the
       assessment prompt, so what widened and what must not widen with it are
       asserted in one test.

       The two negatives passed before this change as well. They are here as
       over-correction guards, not as proof of it. */
    const p = await systems(page, ['sap']);
    expect(p.sap).toMatch(/PROCEDURES GO IN THE ORDER THEY RUN/);
    expect(p.sap, 'the tired staff brevity register must still not reach the plan tool')
      .not.toMatch(/end of a work block/);
    expect(p.sap, 'and neither must the session-record block').not.toMatch(/WHAT THIS RECORD IS FOR/);
  });

  test('a zero is stated rather than attached, and only where a session is reported', async ({ page }) => {
    const p = await systems(page, ALL_FIVE);
    for (const id of SESSION_FOUR) {
      expect(p[id], `${id} is missing the zero rule`).toMatch(/STATE A ZERO, NEVER ATTACH IT/);
      // Named because it is the construction his own shipped note carried:
      // "'without exhibiting' dodges a clean zero into a participial."
      expect(p[id], `${id} does not name the construction that produced this rule`)
        .toMatch(/without exhibiting behaviors of concern/);
      /* The carve-out this sharpens rather than replaces. A zero still belongs
         in the note, and losing that line would turn a rule about WHERE the
         zero goes into one that deletes it. */
      expect(p[id], `${id} lost the rule that keeps the zero in the note at all`)
        .toMatch(/A zero is an observation and it stays/);
    }
    expect(p.sap, 'a plan has no zeros to report').not.toMatch(/STATE A ZERO/);
  });
});
