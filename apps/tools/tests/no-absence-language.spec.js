import { test, expect } from '@playwright/test';

// A note records what was done, never what was not done.
//
// WHAT WENT WRONG. A generated BT note came back carrying "Behavior rates
// relative to recent sessions were not reported in the session documentation."
// Nothing in that sentence is invented, so every anti-fabrication rule in the
// prompt passed it, and it is still the wrong sentence: it describes the
// paperwork rather than the client, and whoever reads the record next learns
// nothing from it.
//
// WHERE IT CAME FROM. The narrative guidance ordered the comparison outright -
// "state whether behavior increased, decreased, or held steady relative to
// recent sessions" - with no condition on the technician having reported one.
// A specific standing order beats the general "leave the gap" rule that sits
// further up the prompt, so the model obeyed it the only way it could without
// fabricating: by reporting the gap. The fix makes the order conditional and
// bans absence sentences outright, in the shared register rules where it
// reaches every session note tool.
//
// The gap itself already had a channel. no_rate_comparison is a hint, and hints
// reach the technician who can still answer them, which is the whole reason the
// note can afford to say nothing.

const BT_PAGE = '/notes/bt/index.html';
const BCBA_PAGE = '/notes/bcba/index.html';

const systemFor = (page, id) =>
  page.evaluate((toolId) => window.NOTE_TOOLS.find((t) => t.id === toolId).buildSystem(), id);

const ready = async (page, path) => {
  await page.goto(path);
  await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
};

test.describe('the BT prompt no longer orders a comparison it may not have', () => {
  let user;
  let system;

  test.beforeEach(async ({ page }) => {
    await ready(page, BT_PAGE);
    system = await systemFor(page, 'bt');
    // A realistic intake that reports a behavior and its response but never
    // compares the session to any other. This is the exact input that produced
    // the reported sentence.
    user = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'bt').buildUserPrompt({
        placeOfService: 'Home',
        fSession: 'Client met me at the door, calm.',
        fLesson: 'Ran tacting, 8 of 10 with a gestural prompt.',
        fAntecedent: 'Gave a two minute warning before transitions, helped.',
        fBehavior: 'Two instances of aggression, blocked and withheld attention.',
        fFollowUp: '',
      }));
  });

  test('the standing order to state a comparison is gone', async () => {
    // The removal is the fix, so the absence of the old wording is what pins it.
    expect(user).not.toMatch(/quantitative where reported; state whether behavior/i);
  });

  test('the comparison is conditional on the notes carrying one', async () => {
    expect(user).toMatch(/ONLY IF the notes give you that comparison/);
  });

  test('and a missing comparison routes to the hint, not into the note', async () => {
    expect(user).toMatch(/emit the no_rate_comparison hint/);
    expect(user).toMatch(/never state that the comparison is missing/i);
  });

  test('an unsupported section gets an empty narrative, not an explanation of itself', async () => {
    expect(system).toMatch(/empty narrative and empty checkboxes, not a sentence explaining what was missing/i);
    // The old wording invited exactly the sentence that went wrong: "honest"
    // reads as licence to report the gap when the gap is the only honest thing
    // left to say.
    expect(system).not.toMatch(/minimal honest statement/i);
  });

  test('the copy-paste path does not write a nudge into the note either', async ({ page }) => {
    const labeled = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'bt').buildLabeledPrompt({ fBehavior: 'x' }));
    expect(labeled).not.toMatch(/write a brief note prompting the BT to add detail/i);
    expect(labeled).toMatch(/leave that narrative blank/i);
  });
});

test.describe('the absence rule reaches every session note tool', () => {
  // register-rules.js is shared, so this is where the rule belongs: the same
  // defect could surface as "prompt level was not documented" on any of them.
  const SESSION_TOOLS = ['sup', 'assess', 'parent'];

  test('BT carries it', async ({ page }) => {
    await ready(page, BT_PAGE);
    expect(await systemFor(page, 'bt')).toMatch(/NEVER DOCUMENT AN ABSENCE/);
  });

  for (const id of SESSION_TOOLS) {
    test(`${id} carries it`, async ({ page }) => {
      await ready(page, BCBA_PAGE);
      expect(await systemFor(page, id)).toMatch(/NEVER DOCUMENT AN ABSENCE/);
    });
  }

  test('the rule names the words it is banning', async ({ page }) => {
    await ready(page, BT_PAGE);
    const system = await systemFor(page, 'bt');
    for (const phrase of ['not reported', 'not documented', 'not provided', 'not specified']) {
      expect(system, `the rule should name "${phrase}"`).toContain(phrase);
    }
  });

  test('SAP is deliberately left out of it', async ({ page }) => {
    // A treatment plan is read before a session by someone who needs to know
    // what has not been assessed yet, so the session-note register does not
    // apply to it. SAP takes only the constructions block, and that boundary is
    // load-bearing rather than an oversight.
    await ready(page, BCBA_PAGE);
    expect(await systemFor(page, 'sap')).not.toMatch(/NEVER DOCUMENT AN ABSENCE/);
  });
});

test.describe('a zero is still an observation', () => {
  // The dangerous over-correction. These tools ask for behavior counts
  // INCLUDING zero, so a rule that bans the word "not" would delete real
  // clinical content. The rule has to draw the line on what the sentence is
  // about, and this pins that it does.
  test('the rule keeps zero-rate reporting explicitly in bounds', async ({ page }) => {
    await ready(page, BT_PAGE);
    const system = await systemFor(page, 'bt');
    expect(system).toMatch(/A zero is an observation and it stays/i);
    expect(system).toMatch(/No instances of aggression occurred/);
    expect(system).toMatch(/what the sentence is about, not whether it contains the word not/i);
  });

  test('the intake still asks for a count even when it is zero', async ({ page }) => {
    await ready(page, BT_PAGE);
    const user = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'bt').buildUserPrompt({ fBehavior: 'none today' }));
    expect(user).toMatch(/behavior of concern incl\. zero/i);
  });
});
