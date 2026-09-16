import { test, expect } from '@playwright/test';

// A count is the one thing about a hint list that carries no instruction.
//
// "3 spots could use more detail" tells a technician that work remains and
// nothing about what the work is, so the only way to act on it is to open the
// panel and read all three. That is response effort spent on navigation, and
// response effort is the thing this whole pass exists to lower.
//
// The rubric names the gap in the words the technician would use to fix it.
// Four of its five dimensions are the regional handout's own - B4's observed,
// attempted and resulted; progress against recent sessions; the detail a data
// table cannot carry; and every narrative actually written. The fifth is the
// only one measured on the prose rather than read off the model's hints,
// because "do not repeat the data" is a rule about what is on the page.

const BT_PAGE = '/notes/bt/index.html';

const ready = async (page) => {
  await page.goto(BT_PAGE);
  await page.waitForFunction(() => !!window.NoteRubric && !!window.NOTE_TOOLS);
};

const IDS = ['clinicalStatusNarrative', 'lessonProgressNarrative', 'behaviorPlanNarrative'];

const CATALOG = {
  no_strategy_outcome: 'Strategy described without its outcome, say what happened as a result of trying it',
  no_rate_comparison: 'No comparison to recent sessions, say whether this was higher, lower, or about the same',
  no_prompt_level: 'Teaching described without a prompt level, name the prompt type used and whether it was faded',
};

const RUBRIC = [
  { id: 'result', label: 'What happened as a result', codes: ['no_strategy_outcome'] },
  { id: 'comparison', label: 'How it compares to recent sessions', codes: ['no_rate_comparison'] },
  { id: 'specifics', label: 'The detail a data table cannot carry', codes: ['no_prompt_level'] },
  { id: 'beyond_data', label: 'Says more than the numbers', measure: 'restates_data' },
];

const grade = (page, output, opts = {}) =>
  page.evaluate(
    ([out, ids, rubric, catalog]) =>
      window.NoteRubric.grade({ output: out, narrativeIds: ids, rubric: rubric, hintCatalog: catalog }),
    [output, IDS, opts.rubric === null ? null : RUBRIC, CATALOG],
  );

const filled = (extra) =>
  Object.assign(
    {
      clinicalStatusNarrative: 'Arrived calm and greeted staff at the door.',
      lessonProgressNarrative: 'Worked imitation with a partial gesture prompt.',
      behaviorPlanNarrative: 'Staff redirected neutrally to the functional communication response.',
      hints: [],
    },
    extra,
  );

test.describe('the note is graded, not tallied', () => {
  test('the reason names what to fix, in the words that fix it', async ({ page }) => {
    await ready(page);
    const out = await grade(
      page,
      filled({
        hints: [
          { section: 'behaviorPlanNarrative', code: 'no_strategy_outcome', detail: '', rank: 1, kind: 'thin' },
          { section: 'lessonProgressNarrative', code: 'no_prompt_level', detail: '', rank: 2, kind: 'thin' },
        ],
      }),
    );
    expect(out.level).toBe('thin');
    expect(out.reason).toBe(CATALOG.no_strategy_outcome);
    // The old surface said "2 spots could use more detail". Nothing in the new
    // reason is a tally of the hints, which is the entire point of the change.
    expect(out.reason).not.toMatch(/\d+ spots?/);
  });

  test('every dimension is reported either way, so the panel can list them', async ({ page }) => {
    await ready(page);
    const out = await grade(page, filled());
    expect(out.level).toBe('good');
    expect(out.dimensions.map((d) => d.id)).toEqual([
      'sections', 'result', 'comparison', 'specifics', 'beyond_data',
    ]);
    expect(out.dimensions.every((d) => d.state === 'met')).toBe(true);
  });

  test("the model's own rank decides which gap gets named", async ({ page }) => {
    await ready(page);
    // Declaration order puts result first; rank puts comparison first. Rank wins,
    // because rank is the model's judgment of what the note most needs and the
    // declaration order is just how the array happened to be written.
    const out = await grade(
      page,
      filled({
        hints: [
          { section: 'behaviorPlanNarrative', code: 'no_strategy_outcome', detail: '', rank: 5, kind: 'thin' },
          { section: 'behaviorPlanNarrative', code: 'no_rate_comparison', detail: '', rank: 2, kind: 'thin' },
        ],
      }),
    );
    expect(out.reason).toBe(CATALOG.no_rate_comparison);
  });

  test('a hint the model called claim-blocking turns the pill red', async ({ page }) => {
    await ready(page);
    const out = await grade(
      page,
      filled({
        hints: [{ section: 'behaviorPlanNarrative', code: 'no_rate_comparison', detail: '', rank: 3, kind: 'blocks-claim' }],
      }),
    );
    // Red used to mean only that a section was blank. It now also means a payer
    // could reject the claim over what is written, which is what the pill's own
    // label has always said: "Note is missing something important".
    expect(out.level).toBe('missing');
    expect(out.dimensions.find((d) => d.id === 'comparison').blocking).toBe(true);
  });

  /* The same silent-drop shape as a hint code missing from the schema enum:
     nothing near the mistake fails, and the only symptom is a note that grades
     green with a flag on it. */
  test('a hint no dimension claims still surfaces, instead of vanishing', async ({ page }) => {
    await ready(page);
    const out = await grade(
      page,
      filled({ hints: [{ section: 'clinicalStatusNarrative', code: 'ambiguous_item', detail: '', rank: 1, kind: 'thin' }] }),
    );
    expect(out.level).toBe('thin');
    expect(out.dimensions.map((d) => d.id)).toContain('other');
  });

  test('an empty narrative still outranks everything', async ({ page }) => {
    await ready(page);
    const out = await grade(
      page,
      filled({
        lessonProgressNarrative: '',
        hints: [{ section: 'behaviorPlanNarrative', code: 'no_rate_comparison', detail: '', rank: 1, kind: 'blocks-claim' }],
      }),
    );
    expect(out.level).toBe('missing');
    expect(out.reason).toBe('1 narrative section is empty');
  });
});

test.describe('a sentence that is mostly a number is one the EHR already wrote', () => {
  const restates = (page, sentence) =>
    page.evaluate((s) => window.NoteRubric.restatesData(s), sentence);

  test('a quantity standing in for an observation is a restatement', async ({ page }) => {
    await ready(page);
    for (const s of [
      'Tacting was 80% across 20 trials.',
      'Client tacted 16 of 20 trials.',
      'Independent responding reached 75%.',
      'Mands were 12/20.',
    ]) {
      expect(await restates(page, s), s).toBe(true);
    }
  });

  test('a quantity riding along with an observation is not', async ({ page }) => {
    await ready(page);
    for (const s of [
      'Client engaged in screaming 6 times and staff redirected neutrally to FCR.',
      'Prompting faded from full physical to a partial gesture over 3 blocks.',
      'Episodes were shorter than the 4 recorded last week and ended without staff contact.',
    ]) {
      expect(await restates(page, s), s).toBe(false);
    }
  });

  /* Over-correction guard. Thin prose with no number in it is a real fault and
     it is a different one: the hints report it. If this measure ever starts
     claiming "He did well" restates the data, it has stopped measuring the rule
     it was built for and started guessing at quality. */
  test('prose carrying no number is never a restatement, however thin', async ({ page }) => {
    await ready(page);
    for (const s of ['He did well.', 'The client worked on imitation and did well.', 'Good session.']) {
      expect(await restates(page, s), s).toBe(false);
    }
  });

  test('a restated sentence is a gap on its own, with no hint needed', async ({ page }) => {
    await ready(page);
    const out = await grade(page, filled({ lessonProgressNarrative: 'Tacting was 80% across 20 trials.' }));
    expect(out.level).toBe('thin');
    expect(out.dimensions.find((d) => d.id === 'beyond_data').count).toBe(1);
  });
});

test.describe('the four other tools keep working', () => {
  test('a tool that declares no rubric is graded by severity instead', async ({ page }) => {
    await ready(page);
    const out = await grade(
      page,
      filled({ hints: [{ section: 'note', code: 'other', detail: '', rank: 1, kind: 'register' }] }),
      { rubric: null },
    );
    expect(out.level).toBe('thin');
    expect(out.dimensions.map((d) => d.id)).toEqual(['sections', 'blocks-claim', 'thin', 'register']);
    expect(out.dimensions.find((d) => d.id === 'register').state).toBe('gap');
  });
});

test.describe('bt declares the handout as its rubric', () => {
  test('every code the rubric names is a code the catalogue can emit', async ({ page }) => {
    await ready(page);
    const bad = await page.evaluate(() => {
      const bt = window.NOTE_TOOLS.find((t) => t.id === 'bt');
      const known = Object.keys(bt.hintCatalog);
      return (bt.qualityRubric || [])
        .flatMap((d) => d.codes || [])
        .filter((c) => known.indexOf(c) === -1);
    });
    // A rubric code the schema enum does not carry is a dimension that can
    // never report a gap, and nothing near it would fail.
    expect(bad).toEqual([]);
  });

  test('the codes bt leaves uncovered are the three that name no dimension', async ({ page }) => {
    await ready(page);
    const uncovered = await page.evaluate(() => {
      const bt = window.NOTE_TOOLS.find((t) => t.id === 'bt');
      const claimed = (bt.qualityRubric || []).flatMap((d) => d.codes || []);
      return Object.keys(bt.hintCatalog).filter((c) => claimed.indexOf(c) === -1);
    });
    /* ambiguous_item and other are the catch-alls the register rules ask every
       tool for. strategy_in_wrong_section joined them on 2026-09-02, and it
       belongs here for a different reason worth keeping straight: the rubric is
       the REGIONAL HANDOUT's four dimensions, and B9 is his own bar rather than
       the handout's. A code that reports against a standard the rubric does not
       measure has no dimension to sit under, and inventing one would put his
       bar inside a scorecard that claims to be the handout.

       All three belong to no handout dimension, which is why the residual
       dimension has to exist rather than the rubric growing a bucket for them. */
    expect(uncovered).toEqual(['ambiguous_item', 'strategy_in_wrong_section', 'other']);
  });

  test('the rubric covers the handout, not a sample of it', async ({ page }) => {
    await ready(page);
    const ids = await page.evaluate(() =>
      (window.NOTE_TOOLS.find((t) => t.id === 'bt').qualityRubric || []).map((d) => d.id),
    );
    expect(ids).toEqual(['result', 'comparison', 'specifics', 'beyond_data']);
  });
});

/* THE GRADE REPORTS THE SEVERITY IT GRADED ON (slice 4).
 *
 * A claim-blocking hint and a register nitpick already graded differently. What
 * nothing downstream could tell apart was a thin note from a tidy one with a
 * register flag on it: both come back "thin", and the only thing separating
 * them was a count of hints, which is the reading this file exists to refuse.
 *
 * `band` counts GAP DIMENSIONS per tier, never hints. Five register findings
 * inside one dimension are one thing wrong with the note.
 */
test.describe('the grade carries the severity, never the tally', () => {
  test('one serious finding and five nitpicks do not grade the same', async ({ page }) => {
    await ready(page);
    const serious = await grade(
      page,
      filled({
        hints: [{ section: 'behaviorPlanNarrative', code: 'no_rate_comparison', detail: '', rank: 1, kind: 'blocks-claim' }],
      }),
    );
    const nitpicks = await grade(
      page,
      filled({
        hints: [1, 2, 3, 4, 5].map((i) => ({
          section: 'lessonProgressNarrative', code: 'no_prompt_level', detail: '', rank: i, kind: 'register',
        })),
      }),
    );
    expect(serious.level).toBe('missing');
    expect(serious.worstTier).toBe(1);
    expect(nitpicks.level).toBe('thin');
    expect(nitpicks.worstTier).toBe(3);
    // Five of them is still ONE dimension with something wrong in it. A band
    // that read five here would be the hint tally under another name.
    expect(nitpicks.band['3']).toBe(1);
  });

  test('a thin note and a note that only reads badly share a level and not a band', async ({ page }) => {
    await ready(page);
    const thin = await grade(
      page,
      filled({ hints: [{ section: 'lessonProgressNarrative', code: 'no_prompt_level', detail: '', rank: 1, kind: 'thin' }] }),
    );
    const polish = await grade(
      page,
      filled({ hints: [{ section: 'lessonProgressNarrative', code: 'no_prompt_level', detail: '', rank: 1, kind: 'register' }] }),
    );
    expect(thin.level).toBe(polish.level);
    expect(thin.worstTier).toBe(2);
    expect(polish.worstTier).toBe(3);
  });

  test('a clean note has no band and no worst tier', async ({ page }) => {
    await ready(page);
    const out = await grade(page, filled({}));
    expect(out.level).toBe('good');
    expect(out.worstTier).toBe(null);
    expect(out.band).toEqual({ 1: 0, 2: 0, 3: 0 });
  });

  test('a tool with no rubric reports what to fix, not how many there are', async ({ page }) => {
    await ready(page);
    const out = await grade(
      page,
      filled({
        hints: [
          { section: 'lessonProgressNarrative', code: 'no_prompt_level', detail: '', rank: 1, kind: 'thin' },
          { section: 'lessonProgressNarrative', code: 'no_rate_comparison', detail: '', rank: 2, kind: 'thin' },
        ],
      }),
      { rubric: null },
    );
    // It used to read "2 flagged", which is the tally on the one surface four of
    // the six tools actually show.
    expect(out.reason).not.toMatch(/^\d+ flagged$/);
    expect(out.reason).toBe(CATALOG.no_prompt_level);
  });

  test('the rubric and the budget read the same three tiers off the same three kinds', async ({ page }) => {
    await ready(page);
    const agree = await page.evaluate(() => {
      const kinds = ['blocks-claim', 'thin', 'register'];
      return kinds.map((kind) => {
        const budget = window.AlertBudget.build({
          hints: [{ code: 'x', section: 'note', kind: kind, rank: 1 }],
        }, { cap: 99 });
        const item = budget.shown.concat(budget.withheld)[0];
        return { kind, budget: item ? item.tier : null };
      });
    });
    const rubricTiers = {};
    for (const kind of ['blocks-claim', 'thin', 'register']) {
      const out = await grade(
        page,
        filled({ hints: [{ section: 'lessonProgressNarrative', code: 'no_prompt_level', detail: '', rank: 1, kind }] }),
      );
      rubricTiers[kind] = out.worstTier;
    }
    for (const row of agree) {
      expect(rubricTiers[row.kind], `${row.kind} grades one tier in the rubric and another in the budget`).toBe(row.budget);
    }
  });
});

/* The empty-section dimension is the one that blocks WITHOUT being tier 1, so
   it is the only dimension whose tier can go missing without the level moving.
   Without this the band would quietly stop counting the loudest fault on the
   page and every other assertion above would stay green. */
test.describe('a blank narrative is counted in the band it belongs to', () => {
  test('an empty section grades missing and lands in the tier two band', async ({ page }) => {
    await ready(page);
    const out = await grade(page, filled({ lessonProgressNarrative: '' }));
    expect(out.level).toBe('missing');
    expect(out.worstTier, 'a blank section is the note not saying something').toBe(2);
    expect(out.band['2']).toBeGreaterThanOrEqual(1);
    expect(out.band['1']).toBe(0);
  });
});

/* The four tools that declare no rubric are graded by severity instead, and
   they need the same band the named dimensions produce - otherwise a learned
   bar would read a band on bt and nothing at all on sup, parent, assess and
   sap, which is four of the six. */
test.describe('a tool with no rubric still reports a band', () => {
  test('severity dimensions carry their tier into the band', async ({ page }) => {
    await ready(page);
    const polish = await grade(
      page,
      filled({ hints: [{ section: 'note', code: 'other', detail: '', rank: 1, kind: 'register' }] }),
      { rubric: null },
    );
    expect(polish.worstTier).toBe(3);
    expect(polish.band['3']).toBe(1);

    const serious = await grade(
      page,
      filled({ hints: [{ section: 'note', code: 'other', detail: '', rank: 1, kind: 'blocks-claim' }] }),
      { rubric: null },
    );
    expect(serious.worstTier).toBe(1);
    expect(serious.band['1']).toBe(1);
    expect(serious.level).toBe('missing');
  });
});
