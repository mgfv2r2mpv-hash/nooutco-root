import { test, expect } from '@playwright/test';

/**
 * ONE BUDGET OVER THE EIGHT ALERT PRODUCERS (slice 4, the queue and the ledger).
 *
 * THE FINDINGS ARE PRODUCED BY THE REAL PASSES, not typed into a fixture. Every
 * source this suite feeds the budget comes back from the code that ships:
 * NoteHollow.misplacedInput against bt's own strategy table, NoteAbsence on real
 * prose, NoteToolsUtil.normalizeHints against bt's own catalog, NoteMetrics on
 * a tired paragraph, NoteRubric.grade on a half written note, and NotesScrub for
 * the substitution map. A hand built input would test the shape I imagined
 * rather than the shape the passes return, and the shapes are the whole risk
 * here - the budget's job is reading eight of them.
 *
 * WHAT IS HAND BUILT AND WHY, stated so a reader can discount it: the gap
 * questions and the expert pass both come back from the server, so their
 * fixtures are written to the schema in the tree rather than fetched. Neither is
 * load bearing for a tier rule.
 *
 * NO LAYOUT IS TESTED AND NONE EXISTS. The maintainer is ruling on the revision
 * panel and the note page, and this slice changes how findings are produced,
 * ranked and recorded rather than how any of it is drawn.
 */

const BT_PAGE = '/notes/bt/index.html';

const ready = async (page) => {
  await page.goto(BT_PAGE);
  await page.waitForFunction(
    () => !!window.AlertBudget && !!window.NoteDisposition && !!window.NoteHollow &&
      !!window.NoteAbsence && !!window.NoteMetrics && !!window.NoteRubric &&
      !!window.NotesScrub && !!window.NOTE_TOOLS && window.NOTE_TOOLS.length > 0,
  );
};

/* A note with something wrong with it in more than one way, written once and
   read by every producer below. Nothing in it is a real person or a real
   session: the names are invented and the numbers are made up. */
const INTAKE = {
  fLesson: 'Ran tacting in mixed trials, 16/20 with a gesture prompt.',
  // Redirection is a CONSEQUENCE strategy on bt's published table, and it is
  // typed into the antecedent box. This is what makes the pre draft check fire.
  fAntecedent: 'Used redirection each time he yelled at the table.',
  fBehavior: 'Two instances of yelling, both brief.',
};

const TIRED = [
  'The client was appropriately engaged throughout the session.',
  'Staff effectively utilized the strategies as written.',
  'Progress was supported by providing frequent reinforcement.',
  'His communication response pattern remained consistent.',
].join(' ');

// ─────────────────────────────────────────────── the sources, from real passes

/* Everything below runs IN the page so the real modules do the work. Returned
   values are plain JSON, which is all the budget takes anyway. */
const realSources = (page, opts = {}) =>
  page.evaluate(
    ([intake, tired, o]) => {
      const bt = window.NOTE_TOOLS.find((t) => t.id === 'bt');
      const sections = bt.formSections.filter((s) => s.kind === 'narrative').map((s) => s.id || s.key);

      // 2. the pre draft wrong section check, against bt's own ownership table
      const misfiled = window.NoteHollow.misplacedInput(intake, bt.strategyOwnership);

      // 4. the hint catalog, through the tool's own validator
      const codes = Object.keys(bt.hintCatalog);
      const rawHints = (o.hints || []).map((h) => ({ ...h, code: h.code || codes[0] }));
      const hints = window.NoteToolsUtil.normalizeHints(rawHints, bt.hintCatalog, sections);

      // 7. the absence and hollow passes, on prose they were written against
      const drafted = {};
      sections.forEach((id, i) => { drafted[id] = o.narratives ? (o.narratives[i] || '') : ''; });
      const stripped = window.NoteAbsence.scrubNote(drafted);
      const filled = window.NoteHollow.passNote(stripped.output, sections);

      // 6. the register measure, on the tired paragraph
      const registerFlagged = window.NoteMetrics.flagged(o.registerText === undefined ? tired : o.registerText);

      // 8. the rubric band, graded by the shipped grader
      const quality = window.NoteRubric.grade({
        output: { ...filled.output, hints },
        narrativeIds: sections,
        rubric: bt.qualityRubric || null,
        hintCatalog: bt.hintCatalog || {},
      });

      return {
        misfiled,
        hints,
        absence: { cut: stripped.cut, flagged: stripped.flagged },
        hollow: { recast: filled.recast, hollow: filled.hollow },
        registerFlagged,
        quality,
        output: filled.output,
      };
    },
    [INTAKE, TIRED, opts],
  );

const build = (page, sources, opts = {}) =>
  page.evaluate(([s, o]) => window.AlertBudget.build(s, o), [sources, opts]);

// ───────────────────────────────────────────────────────────── the one queue

test.describe('eight producers, one ranked queue', () => {
  test('a note raising findings from four producers yields ONE list', async ({ page }) => {
    await ready(page);
    const sources = await realSources(page, {
      hints: [
        { section: 'behaviorPlanNarrative', kind: 'blocks-claim', rank: 1, detail: 'no antecedent' },
        { section: 'lessonProgressNarrative', kind: 'thin', rank: 2, detail: 'no prompt level' },
      ],
      narratives: [
        // The technician is the subject, so the absence pass FLAGS this rather
        // than cutting it: a sentence a person is doing the not-doing in stays
        // in the note and is the note asserting something nobody observed.
        'The technician did not document a rate for the session.',
        'Worked imitation across twelve trials.',
        '',
      ],
    });

    // The producers really did produce. If any of these is empty the test below
    // is measuring a queue built out of one source and would pass for the wrong
    // reason, so each is asserted before the budget ever runs.
    expect(sources.misfiled.length, 'the wrong section check found the misfiled redirection').toBeGreaterThan(0);
    expect(sources.hints.length, 'normalizeHints kept the hints').toBeGreaterThan(0);
    expect(sources.registerFlagged.length, 'the register measure flagged the tired paragraph').toBeGreaterThan(0);
    expect(sources.quality.level, 'the rubric graded the note').not.toBe('good');

    const out = await build(page, sources, { cap: 99 });
    const producers = [...new Set(out.shown.concat(out.withheld).map((i) => i.producer))];
    expect(producers.length, `producers in one queue: ${producers.join(', ')}`).toBeGreaterThanOrEqual(4);

    // ONE list. Every item carries a tier, a key and a producer, and no item
    // appears twice under two keys.
    const keys = out.shown.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const it of out.shown) {
      expect([1, 2, 3]).toContain(it.tier);
      expect(it.key).toContain(it.producer);
    }
  });

  /* A PRODUCER ID AND THE FIELD ITS FINDINGS ARRIVE UNDER ARE DIFFERENT THINGS.
     The wrong-section producer reads `misfiled`, the passes producer reads
     `absence` and `hollow`. A check written against producer ids would refuse
     every real source as unregistered, which fills the one list whose job is
     answering "why did I not see that" with noise and hides a real refusal in
     it. This is the test that says the live sources come through clean. */
  test('the real sources raise no refusal of their own', async ({ page }) => {
    await ready(page);
    const sources = await realSources(page, {
      hints: [{ section: 'behaviorPlanNarrative', kind: 'thin', rank: 1 }],
      narratives: ['The technician did not document a rate for the session.', 'Worked imitation.', ''],
    });
    const out = await build(page, sources, { cap: 99 });
    expect(out.refused, `refused: ${JSON.stringify(out.refused)}`).toEqual([]);
    expect(Object.keys(sources).length, 'the fixture really did hand over several sources').toBeGreaterThan(4);
  });

  test('tier one sorts above tier two, and tier two above tier three', async ({ page }) => {
    await ready(page);
    const sources = await realSources(page, {
      hints: [
        { section: 'lessonProgressNarrative', kind: 'register', rank: 1, detail: 'reads flat' },
        { section: 'behaviorPlanNarrative', kind: 'blocks-claim', rank: 9, detail: 'claim unsupported' },
        { section: 'antecedentNarrative', kind: 'thin', rank: 5, detail: 'no outcome' },
      ],
      narratives: ['Ran the session.', 'Worked imitation.', 'Redirected twice.'],
    });
    // Resolve the tier ones so nothing is withheld and the whole ordering is
    // visible in one list. The withholding rule has its own test below.
    const dispositions = {};
    const pre = await build(page, sources, { cap: 99 });
    pre.shown.filter((i) => i.tier === 1).forEach((i) => { dispositions[i.key] = 'approve'; });

    const out = await build(page, sources, { cap: 99, dispositions });
    const tiers = out.shown.map((i) => i.tier);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(new Set(tiers).size, `tiers present: ${tiers.join(',')}`).toBeGreaterThanOrEqual(2);
  });

  test('a producer rank cannot promote a finding past another producer tier', async ({ page }) => {
    await ready(page);
    // The register hint ranks itself 1, ahead of everything. It is still tier 3.
    const sources = await realSources(page, {
      hints: [
        { section: 'lessonProgressNarrative', kind: 'register', rank: 1 },
        { section: 'behaviorPlanNarrative', kind: 'thin', rank: 80 },
      ],
      narratives: ['Ran the session.', 'Worked imitation.', 'Redirected twice.'],
    });
    const out = await build(page, sources, { cap: 99, dispositions: {} });
    const all = out.shown.concat(out.withheld);
    const reg = all.find((i) => i.producer === 'hints' && i.tier === 3);
    const thin = all.find((i) => i.producer === 'hints' && i.tier === 2);
    expect(reg, 'the register hint is in the queue').toBeTruthy();
    expect(thin, 'the thin hint is in the queue').toBeTruthy();
    expect(out.shown.indexOf(thin)).toBeGreaterThanOrEqual(0);
    // Either the register item is withheld outright or it sorts after the thin
    // one. What it must never do is come first on a rank it set itself.
    const shownReg = out.shown.findIndex((i) => i.key === reg.key);
    const shownThin = out.shown.findIndex((i) => i.key === thin.key);
    if (shownReg !== -1) expect(shownReg).toBeGreaterThan(shownThin);
  });
});

// ─────────────────────────────────────────────── the withholding rule

test.describe('a tier three never sits beside an open tier one', () => {
  const twoTiers = (page) =>
    realSources(page, {
      hints: [
        { section: 'behaviorPlanNarrative', kind: 'blocks-claim', rank: 1, detail: 'claim unsupported' },
        { section: 'lessonProgressNarrative', kind: 'register', rank: 2, detail: 'reads flat' },
      ],
      narratives: ['Ran the session.', 'Worked imitation.', 'Redirected twice.'],
    });

  test('the tier three item is withheld while the tier one is unresolved', async ({ page }) => {
    await ready(page);
    const out = await build(page, await twoTiers(page), { cap: 99 });
    expect(out.open, 'an unresolved tier one is open').toBeGreaterThan(0);
    expect(out.shown.some((i) => i.tier === 3), 'no tier three occupies a slot').toBe(false);
    const held = out.withheld.filter((i) => i.tier === 3);
    expect(held.length, 'the tier three items are withheld rather than dropped').toBeGreaterThan(0);
    for (const h of held) expect(h.withheld).toBe('tier-1-open');
  });

  /* THE CONTROL. Without it the test above passes on a budget that never shows
     a tier three at all, which is a different bug wearing the same green. */
  test('the same tier three item IS shown once the tier one is answered', async ({ page }) => {
    await ready(page);
    const sources = await twoTiers(page);
    const first = await build(page, sources, { cap: 99 });
    const dispositions = {};
    first.shown.filter((i) => i.tier === 1).forEach((i) => { dispositions[i.key] = 'reject'; });
    first.withheld.filter((i) => i.tier === 1).forEach((i) => { dispositions[i.key] = 'reject'; });

    const after = await build(page, sources, { cap: 99, dispositions });
    expect(after.open).toBe(0);
    expect(after.shown.some((i) => i.tier === 3), 'the held item is shown once nothing is open').toBe(true);
  });

  test('no action does not resolve a tier one, because nobody answered it', async ({ page }) => {
    await ready(page);
    const sources = await twoTiers(page);
    const first = await build(page, sources, { cap: 99 });
    const dispositions = {};
    first.shown.concat(first.withheld).forEach((i) => { dispositions[i.key] = 'none'; });
    const after = await build(page, sources, { cap: 99, dispositions });
    expect(after.open, 'default acceptance is not an answer to a fault').toBeGreaterThan(0);
    expect(after.shown.some((i) => i.tier === 3)).toBe(false);
  });
});

// ─────────────────────────────────────────────── the refusals and the cap

test.describe('a producer that cannot state its tier gets no slot', () => {
  test('a hint with an unknown kind is refused with a reason, not defaulted', async ({ page }) => {
    await ready(page);
    const out = await page.evaluate(() =>
      window.AlertBudget.build({
        hints: [
          { code: 'no_prompt_level', section: 'lessonProgressNarrative', kind: 'urgent', rank: 1 },
          { code: 'no_rate_comparison', section: 'lessonProgressNarrative', kind: 'thin', rank: 2 },
        ],
      }, { cap: 99 }),
    );
    const codes = out.shown.map((i) => i.code);
    expect(codes, 'the unknown kind took no slot').not.toContain('no_prompt_level');
    expect(codes, 'the known kind still did').toContain('no_rate_comparison');
    const refusal = out.refused.find((r) => r.code === 'no_prompt_level');
    expect(refusal, `refusals: ${JSON.stringify(out.refused)}`).toBeTruthy();
    expect(refusal.reason).toBe('no-tier');
  });

  test('a rubric level nobody declared is refused rather than graded', async ({ page }) => {
    await ready(page);
    const out = await page.evaluate(() =>
      window.AlertBudget.build({ quality: { level: 'catastrophic', reason: 'invented' } }, { cap: 99 }),
    );
    expect(out.shown.length).toBe(0);
    expect(out.refused.some((r) => r.producer === 'rubric' && r.reason === 'no-tier')).toBe(true);
  });

  test('a source key naming no registered producer is refused, never ignored', async ({ page }) => {
    await ready(page);
    const out = await page.evaluate(() =>
      window.AlertBudget.build({ ninthProducer: [{ detail: 'something' }] }, { cap: 99 }),
    );
    expect(out.refused.some((r) => r.producer === 'ninthProducer' && r.reason === 'unregistered')).toBe(true);
  });

  /* THE NINTH PRODUCER, and it exists because the eight cannot break this rule.
     Every one of them refuses its own untiered findings on the way past, so the
     check at the end of collect() was landed by nothing: taking it out left all
     25 tests green. A registry that can be handed a producer is what makes the
     rule testable on a producer that breaks it, which is the only way to know
     the rule is enforced rather than merely never needed. */
  test('a producer emitting a tier nobody declared is refused at the collection', async ({ page }) => {
    await ready(page);
    const out = await page.evaluate(() => {
      const rogue = {
        id: 'rogue',
        label: 'A producer added later that states a tier nobody declared',
        collect: () => [{ producer: 'rogue', tier: 9, rank: 0, code: 'urgent', section: 'note', detail: '', key: 'rogue:urgent:note' }],
      };
      return window.AlertBudget.build({ rogue: [1] }, { cap: 99, producers: [rogue] });
    });
    expect(out.shown.length, 'tier 9 took no slot').toBe(0);
    expect(out.refused.some((r) => r.producer === 'rogue' && r.reason === 'no-tier')).toBe(true);
  });

  test('what does not fit the cap is withheld over-cap rather than lost', async ({ page }) => {
    await ready(page);
    const sources = await realSources(page, {
      hints: [
        { section: 'behaviorPlanNarrative', kind: 'thin', rank: 1 },
        { section: 'lessonProgressNarrative', kind: 'thin', rank: 2 },
        { section: 'antecedentNarrative', kind: 'thin', rank: 3 },
      ],
      narratives: ['Ran the session.', 'Worked imitation.', ''],
    });
    const out = await build(page, sources, { cap: 2 });
    expect(out.shown.length).toBe(2);
    expect(out.withheld.length).toBeGreaterThan(0);
    expect(out.shown.length + out.withheld.length).toBe(out.offered);
    expect(out.withheld.some((i) => i.withheld === 'over-cap')).toBe(true);
  });
});

// ─────────────────────────────────────────────── the scrub producer, two tiers

test.describe('a stranded token is the note saying something wrong', () => {
  /* Same token family the round trip harness asserts against: one or two
     brackets, upper or lower case T, whitespace inside. A budget that only saw
     the canonical [[T1]] would report a clean note on exactly the failures
     slice 1 exists to catch. */
  const SHAPES = ['[[T1]]', '[T2]', '[[t3]]', '[[ T4 ]]', '[ T5]'];

  for (const shape of SHAPES) {
    test(`${shape} left in the note raises a tier one`, async ({ page }) => {
      await ready(page);
      const out = await page.evaluate(
        (tok) => window.AlertBudget.build({
          output: { lessonProgressNarrative: `Worked imitation with ${tok} at the table.` },
        }, { cap: 99 }),
        shape,
      );
      const stranded = out.shown.find((i) => i.producer === 'scrub' && i.code === 'token_in_note');
      expect(stranded, `no tier one for ${shape}`).toBeTruthy();
      expect(stranded.tier).toBe(1);
    });
  }

  test('a substituted name that stays is tier two, not tier one', async ({ page }) => {
    await ready(page);
    const out = await page.evaluate(async () => {
      // The REAL scrubber builds the map, off text with a name in it.
      const review = await window.NotesScrub.review({
        freeText: 'Grace hit the table when the timer went off.',
      });
      return {
        map: review.map,
        budget: window.AlertBudget.build({
          map: review.map,
          output: { lessonProgressNarrative: 'Client--1 hit the table when the timer went off.' },
        }, { cap: 99 }),
      };
    });
    expect(out.map.length, 'the scrubber found a name to substitute').toBeGreaterThan(0);
    const kept = out.budget.shown.find((i) => i.producer === 'scrub' && i.code === 'substituted');
    expect(kept, `budget: ${JSON.stringify(out.budget.shown)}`).toBeTruthy();
    expect(kept.tier).toBe(2);
    expect(out.budget.shown.some((i) => i.code === 'token_in_note'), 'a restored note has no tier one').toBe(false);
  });
});

// ─────────────────────────────────────────────── the four dispositions

test.describe('four dispositions, four weights', () => {
  test('each disposition records its own distinct weight', async ({ page }) => {
    await ready(page);
    const w = await page.evaluate(() => ({
      none: window.NoteDisposition.weightOf('none'),
      approve: window.NoteDisposition.weightOf('approve'),
      reject: window.NoteDisposition.weightOf('reject'),
      edit: window.NoteDisposition.weightOf('edit'),
    }));
    expect(new Set(Object.values(w)).size, `weights: ${JSON.stringify(w)}`).toBe(4);
  });

  test('the ordering is the ruled one: untouched low, approve stronger, edit strongest', async ({ page }) => {
    await ready(page);
    const w = await page.evaluate(() => ({
      none: window.NoteDisposition.weightOf('none'),
      approve: window.NoteDisposition.weightOf('approve'),
      edit: window.NoteDisposition.weightOf('edit'),
    }));
    expect(w.none).toBeGreaterThan(0);
    expect(w.approve).toBeGreaterThan(w.none);
    expect(w.edit).toBeGreaterThan(w.approve);
  });

  test('a reject is negative evidence and carries its own kind, not a small score', async ({ page }) => {
    await ready(page);
    const r = await page.evaluate(() => ({
      weight: window.NoteDisposition.weightOf('reject'),
      evidence: window.NoteDisposition.evidenceOf('reject'),
      approveEvidence: window.NoteDisposition.evidenceOf('approve'),
      revertWeight: window.NoteDisposition.weightOf('revert'),
      revertName: window.NoteDisposition.normalize('revert'),
    }));
    expect(r.weight).toBeLessThan(0);
    expect(r.evidence).toBe('refused');
    expect(r.evidence).not.toBe(r.approveEvidence);
    // A revert is the same act under the affordance's own word.
    expect(r.revertName).toBe('reject');
    expect(r.revertWeight).toBe(r.weight);
  });

  test('an edit hands the offered and kept pair to a sink and stores neither', async ({ page }) => {
    await ready(page);
    const out = await page.evaluate(() => {
      const seen = [];
      const led = window.NoteDisposition.record(
        window.NoteDisposition.emptyLedger(),
        {
          producer: 'hints', code: 'no_prompt_level', section: 'lessonProgressNarrative', tool: 'bt',
          disposition: 'edit',
          offered: 'The learner demonstrated appropriate behavior.',
          kept: 'He sat down and started the puzzle.',
        },
        (pair) => seen.push(pair),
      );
      return { seen, led, json: JSON.stringify(led) };
    });
    expect(out.seen.length, 'the sink was handed the pair').toBe(1);
    expect(out.seen[0].offered).toContain('demonstrated');
    expect(out.seen[0].kept).toContain('puzzle');
    expect(out.led.entries.length).toBe(1);
    expect(out.led.entries[0].paired, 'the entry records that a specimen exists').toBe(true);
    // The whole ledger, serialised, holds no sentence from the note.
    expect(out.json).not.toContain('demonstrated');
    expect(out.json).not.toContain('puzzle');
  });

  test('a non-edit disposition never reaches the sink at all', async ({ page }) => {
    await ready(page);
    const n = await page.evaluate(() => {
      let hits = 0;
      let led = window.NoteDisposition.emptyLedger();
      ['none', 'approve', 'reject'].forEach((d) => {
        led = window.NoteDisposition.record(
          led,
          { producer: 'hints', code: 'no_prompt_level', section: 'note', disposition: d, offered: 'a', kept: 'b' },
          () => { hits += 1; },
        );
      });
      return { hits, entries: led.entries.length };
    });
    expect(n.hits).toBe(0);
    expect(n.entries).toBe(3);
  });

  test('a disposition nobody declared is dropped with a reason, not read as agreement', async ({ page }) => {
    await ready(page);
    const led = await page.evaluate(() =>
      window.NoteDisposition.record(window.NoteDisposition.emptyLedger(), {
        producer: 'hints', code: 'no_prompt_level', section: 'note', disposition: 'maybe',
      }),
    );
    expect(led.entries.length, 'an unknown answer is not filed as a weak yes').toBe(0);
    expect(led.dropped.length).toBe(1);
    expect(led.dropped[0].reason).toBe('unknown-disposition');
  });

  test('recording returns a new ledger and leaves the old one alone', async ({ page }) => {
    await ready(page);
    const out = await page.evaluate(() => {
      const before = window.NoteDisposition.emptyLedger();
      const after = window.NoteDisposition.record(before, {
        producer: 'hints', code: 'no_prompt_level', section: 'note', disposition: 'approve',
      });
      return { before: before.entries.length, after: after.entries.length };
    });
    expect(out.before).toBe(0);
    expect(out.after).toBe(1);
  });
});

test.describe('closing a note records what nobody touched', () => {
  test('every offered item with no answer is filed as the default acceptance', async ({ page }) => {
    await ready(page);
    const out = await page.evaluate(() => {
      const offered = window.AlertBudget.build({
        hints: [
          { code: 'no_prompt_level', section: 'lessonProgressNarrative', kind: 'thin', rank: 1 },
          { code: 'no_rate_comparison', section: 'lessonProgressNarrative', kind: 'thin', rank: 2 },
        ],
      }, { cap: 99 }).shown;
      let led = window.NoteDisposition.record(window.NoteDisposition.emptyLedger(), {
        producer: offered[0].producer, code: offered[0].code, section: offered[0].section,
        tool: 'bt', disposition: 'approve',
      });
      led = window.NoteDisposition.closeNote(led, offered.map((i) => ({ ...i, tool: 'bt' })));
      return { offered: offered.length, score: window.NoteDisposition.score(led) };
    });
    expect(out.offered).toBe(2);
    const approved = out.score.filter((r) => r.approve === 1);
    const untouched = out.score.filter((r) => r.none === 1);
    expect(approved.length, 'the answered one keeps its answer').toBe(1);
    expect(untouched.length, 'the unanswered one is recorded as accepted by default').toBe(1);
    // An explicit answer is never overwritten by the close.
    expect(approved[0].none).toBe(0);
  });

  test('the score is signed, so agreement and refusal do not read as silence', async ({ page }) => {
    await ready(page);
    const out = await page.evaluate(() => {
      const ev = (d) => ({ producer: 'hints', code: 'no_prompt_level', section: 'note', disposition: d });
      let led = window.NoteDisposition.emptyLedger();
      ['approve', 'reject'].forEach((d) => { led = window.NoteDisposition.record(led, ev(d)); });
      const both = window.NoteDisposition.score(led);
      const silent = window.NoteDisposition.score(window.NoteDisposition.emptyLedger());
      return { both, silent };
    });
    expect(out.silent.length).toBe(0);
    expect(out.both.length).toBe(1);
    expect(out.both[0].approve).toBe(1);
    expect(out.both[0].reject).toBe(1);
    // One each cancels to zero weight, and the COUNTS are what say it was not
    // silence. This is why score returns both and not a single number.
    expect(out.both[0].weight).toBe(0);
  });
});
