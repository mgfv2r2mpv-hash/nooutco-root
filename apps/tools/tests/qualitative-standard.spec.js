import { test, expect } from '@playwright/test';

// The generator asked for the one thing the knowledge base forbids.
//
// necessity's do-not-repeat-the-data says the EHR already attaches the
// session's percentages, frequencies, rates and counts, and that "a note that
// recites the data has spent its space on the one thing the record already
// has". completeness B7 says the same: the note supplements the data rather
// than repeating it.
//
// The BT generator was ordering the opposite. Its hint catalog carried
// no_behavior_count, which told the technician to "add how many times it
// occurred, even if zero", and its narrative guidance opened with
// "quantitative where reported". Both reached the technician as work, and the
// work was to restate what the RT form already carries.
//
// What survives the removal is the comparison, which is what a reader actually
// takes from a number, and no_rate_comparison already carried it.
//
// The same pass adds the two gaps the handout wants and had no channel for:
// an outcome for a named strategy (completeness B4's third part, and
// necessity's lesson-what-worked), and something that helped which is not in
// the written plan, which is a candidate plan revision and reaches nobody
// today.

const BT_PAGE = '/notes/bt/index.html';

const ready = async (page) => {
  await page.goto(BT_PAGE);
  await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
};

const bt = (page, fn) => page.evaluate(fn);

test.describe('the generator stops asking for data the EHR attaches', () => {
  let system;
  let user;
  let schema;

  test.beforeEach(async ({ page }) => {
    await ready(page);
    system = await bt(page, () => window.NOTE_TOOLS.find((t) => t.id === 'bt').buildSystem());
    schema = await bt(page, () => JSON.stringify(window.NOTE_TOOLS.find((t) => t.id === 'bt').responseSchema));
    user = await bt(page, () => window.NOTE_TOOLS.find((t) => t.id === 'bt').buildUserPrompt({
      placeOfService: 'Home',
      fSession: 'Client met me at the door, calm.',
      fLesson: 'Ran tacting with a gestural prompt.',
      fAntecedent: 'Gave a two minute warning before transitions.',
      fBehavior: 'Two instances of aggression, blocked and withheld attention.',
      fFollowUp: '',
    }));
  });

  test('no code in the catalog asks for a count', async () => {
    // The enum is built from the catalog, so the serialized schema is proof of
    // what the model is allowed to emit.
    expect(schema).not.toContain('no_behavior_count');
    expect(system).not.toContain('no_behavior_count');
  });

  test('the narrative guidance no longer opens with quantitative where reported', async () => {
    expect(user).not.toMatch(/quantitative where reported/i);
  });

  test('it states the rule positively instead of merely dropping the order', async () => {
    // Silence would let the next edit put the demand back. The prompt now
    // carries the reason, which is that the numbers are already attached.
    expect(user).toMatch(/EHR already attaches this session's counts, rates and percentages/i);
    expect(user).toMatch(/write the observation the numbers cannot carry/i);
  });

  test('the comparison survives, because that is what a number is read for', async () => {
    expect(user).toMatch(/ONLY IF the notes give you that comparison/);
    expect(schema).toContain('no_rate_comparison');
  });
});

test.describe('the two gaps the handout wants and could not reach', () => {
  let system;
  let user;
  let schema;

  test.beforeEach(async ({ page }) => {
    await ready(page);
    system = await bt(page, () => window.NOTE_TOOLS.find((t) => t.id === 'bt').buildSystem());
    schema = await bt(page, () => JSON.stringify(window.NOTE_TOOLS.find((t) => t.id === 'bt').responseSchema));
    user = await bt(page, () => window.NOTE_TOOLS.find((t) => t.id === 'bt').buildUserPrompt({
      placeOfService: 'Home', fSession: '', fLesson: 'Ran tacting.', fAntecedent: 'Warned before transitions.',
      fBehavior: 'Aggression, blocked.', fFollowUp: '',
    }));
  });

  test('a strategy named without its outcome has a channel', async () => {
    expect(schema).toContain('no_strategy_outcome');
    expect(system).toMatch(/no_strategy_outcome \(lessonProgressNarrative, behaviorPlanNarrative\)/);
  });

  test('something that helped and is not in the plan has a channel', async () => {
    expect(schema).toContain('helped_not_in_plan');
    expect(system).toMatch(/helped_not_in_plan \(any section\)/);
  });

  test('the teaching narrative names all three parts, not just the first two', async () => {
    // "Named a strategy and stopped" is the gap. The order matters: observed,
    // attempted, then what the attempt produced.
    expect(user).toMatch(/what was observed, what was attempted, and what happened as a result of the attempt/i);
  });
});
