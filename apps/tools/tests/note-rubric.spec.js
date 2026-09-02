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

  test('the codes bt leaves uncovered are the two that name no dimension', async ({ page }) => {
    await ready(page);
    const uncovered = await page.evaluate(() => {
      const bt = window.NOTE_TOOLS.find((t) => t.id === 'bt');
      const claimed = (bt.qualityRubric || []).flatMap((d) => d.codes || []);
      return Object.keys(bt.hintCatalog).filter((c) => claimed.indexOf(c) === -1);
    });
    // ambiguous_item and other are the catch-alls the register rules ask every
    // tool for. They belong to no handout dimension, which is why the residual
    // dimension has to exist rather than the rubric growing a bucket for them.
    expect(uncovered).toEqual(['ambiguous_item', 'other']);
  });

  test('the rubric covers the handout, not a sample of it', async ({ page }) => {
    await ready(page);
    const ids = await page.evaluate(() =>
      (window.NOTE_TOOLS.find((t) => t.id === 'bt').qualityRubric || []).map((d) => d.id),
    );
    expect(ids).toEqual(['result', 'comparison', 'specifics', 'beyond_data']);
  });
});
