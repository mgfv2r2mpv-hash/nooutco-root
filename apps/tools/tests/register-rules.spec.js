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
