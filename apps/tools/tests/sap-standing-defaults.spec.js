/* His standing clinical defaults for the SAP drafter, given 2026-09-09.
 *
 * WHY THIS FILE EXISTS RATHER THAN A COMMENT IN THE PROMPT.
 *
 * The prompt already told the model to design the mechanics instead of refusing
 * to. It gave it nothing to design FROM, so "design a hierarchy appropriate to
 * this target" resolved to whatever the model reads as reasonable - which is
 * not the same answer twice, and is not this clinic's standard once. He handed
 * over eighteen standing defaults, and a default that lives only in prose can
 * be edited away by anybody reorganising the prompt without ever failing a
 * check. Each one is pinned here on its own line so dropping it is a red test.
 *
 * They are asserted against the COMPOSED prompt (buildSystem), not against the
 * source array, because composition is what the model receives and because the
 * logged-out copy path composes separately. Both are checked.
 *
 * AND THE LIST IS NOT THE POINT, ruled 2026-09-10. He gave the eighteen as
 * EXAMPLES of a standard of practice, not as the standard itself. A framing
 * that closes the list is the same defect as an empty section: the BCBA left
 * the mechanic alone BECAUSE it is standard, so the block nobody specified is
 * the block that comes out thin. The second describe pins the framing, and
 * pins the old closing wording OUT.
 *
 * These are his clinical rulings, not house style. Change one only on his word.
 */

const { test, expect } = require('@playwright/test');

async function sapConfig(page) {
  await page.goto('/notes/bcba/index.html?tool=sap');
  await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
}

// Each entry is [what he ruled, the phrase that carries it].
const DEFAULTS = [
  ['least restrictive controlling prompt', 'least restrictive controlling prompt'],
  ['most-to-least is the default direction', 'Most-to-Least is the default direction'],
  ['least-to-most where the skill is partly held', 'use Least-to-Most instead'],
  ['no vocal prompt for a vocal response', 'Never write a vocal prompt for a vocal response'],
  ['prompt early rather than abandon a trial', 'Prompt early and escalate the prompt'],
  ['never force through prompt rejection', 'Never use physical force to overcome prompt rejection'],
  ['two errors drops to the last mastered level', 'revert to the last mastered prompt level'],
  ['FR1 in acquisition', 'FR1 for a skill in acquisition'],
  ['differentially reinforce independence', 'Differentially reinforce independence'],
  ['fade reinforcement in gen and maintenance', 'Fade reinforcement across generalization and maintenance'],
  ['never reprimand', 'Never reprimand'],
  ['80% over 5 trials across 3 consecutive sessions', '80% accuracy over a minimum of 5 trials, across 3 consecutive sessions'],
  ['three sessions isolates single-session variables', 'isolates the criterion from single-session variables'],
  ['maintenance probes at 3 trials', 'Maintenance probes run at 3 trials'],
  ['re-entry after 2 sessions below criterion', 'after 2 sessions below the mastery criterion'],
  ['build in learner choice', 'Build learner choice into the program'],
  ['minimal distractions', 'Arrange for minimal distractions'],
  ['non-reversible skills in mass trial or DTT', 'non-reversible skill runs in mass trial or discrete trial training'],
  ['minor procedural variation, looser style', 'Vary the procedure in minor ways'],
  ['mands leverage the MO in acquisition', 'leverages the motivating operation during acquisition'],
  ['error correction runs prompt, distractor, reset', 'run a distractor or transfer trial'],
];

test.describe('the SAP drafter designs from his toolkit, not from whatever reads as reasonable', () => {
  test('every standing default reaches the served prompt', async ({ page }) => {
    await sapConfig(page);
    const system = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'sap').buildSystem()
    );
    for (const [ruling, phrase] of DEFAULTS) {
      expect(system, `the served SAP prompt lost his ruling: ${ruling}`).toContain(phrase);
    }
  });

  /* The logged-out copy path pastes into somebody else's model. A clinical
     floor that applies only when you are logged in is not a floor. Both prompts
     read the same constant, and this is what proves they still do. */
  test('and the logged-out copy prompt carries the same floor', async ({ page }) => {
    await sapConfig(page);
    const labeled = await page.evaluate(() => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      return sap.buildLabeledPrompt({ goal: 'x', sapSpecs: '' });
    });
    for (const [ruling, phrase] of DEFAULTS) {
      expect(labeled, `the copy-prompt path lost his ruling: ${ruling}`).toContain(phrase);
    }
  });

  /* The block answers the question "they told me nothing about this section",
     so it has to sit with the design instructions rather than at the end with
     the style rules, where a model that stops reading early never reaches it. */
  test('the defaults sit before the JSON shape, not after the style rules', async ({ page }) => {
    await sapConfig(page);
    const at = await page.evaluate(() => {
      const s = window.NOTE_TOOLS.find((t) => t.id === 'sap').buildSystem();
      return {
        defaults: s.indexOf('STANDING DEFAULTS'),
        shape: s.indexOf('return ONLY a JSON object'),
        style: s.indexOf('Style rules, follow exactly'),
      };
    });
    expect(at.defaults).toBeGreaterThan(-1);
    expect(at.defaults).toBeLessThan(at.shape);
    expect(at.defaults).toBeLessThan(at.style);
  });

  /* THE NEGATIVE CONTROL. A prompt this long makes "contains a phrase" cheap to
     pass by accident - the words prompt, session and reinforcement are all over
     it. This asserts a plausible default he did NOT give, so a test file that
     would pass against any SAP prompt fails here. */
  test('does not carry a default he never ruled', async ({ page }) => {
    await sapConfig(page);
    const system = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'sap').buildSystem()
    );
    expect(system).not.toContain('90% accuracy over a minimum of 5 trials');
    expect(system).not.toContain('Least-to-Most is the default direction');
  });
});

/* His 2026-09-10 ruling, in his words: "There are best-case heuristics in ABA
   like other fields that are used as researched standards unless the individual
   client has some contraindication or it doesn't work with them. I didn't give
   an exhaustive list."

   So the framing has two jobs the bullets cannot do. It has to license the
   field, and it has to stay out of the way of the learner-facts rule, which is
   the one thing the model genuinely may not invent. Both are asserted, and the
   wording that broke it is asserted out. */
test.describe('the defaults read as examples of the standard, not as the whole of it', () => {
  const FRAMING = [
    ['a silent mechanic falls back on the field', 'established standard of practice in ABA'],
    ['unspecified means standard, not optional', 'BECAUSE it is standard, not because it is optional'],
    ['a skipped block gets the same detail', 'Give it the same detail as a block they did reach'],
    ['the list is the house calls, not the field', 'They are not the boundary of the field'],
    ['researched practice governs the gaps', 'researched best practice still governs'],
    ['departure needs a reason, listed or not', 'Depart from any standard, listed or not'],
    ['a contraindication is a reason to depart', 'a contraindication the clinician gave you'],
    ['and the list says so itself at the end', 'The list above is not exhaustive'],
    ['an unnamed mechanic is not thereby unsettled', 'is not thereby unsettled'],
  ];

  test('the framing licenses the field, in both prompts', async ({ page }) => {
    await sapConfig(page);
    const both = await page.evaluate(() => {
      const sap = window.NOTE_TOOLS.find((t) => t.id === 'sap');
      return [sap.buildSystem(), sap.buildLabeledPrompt({ goal: 'x', sapSpecs: '' })];
    });
    for (const prompt of both) {
      for (const [ruling, phrase] of FRAMING) {
        expect(prompt, `the framing lost his ruling: ${ruling}`).toContain(phrase);
      }
    }
  });

  /* THE REGRESSION THIS ROUND EXISTS FOR. "Do not invent one" was meant to stop
     the model making up a mechanic. It read as a ceiling on ABA itself, and the
     blocks the specifications never reached came out thin. Anybody tightening
     this framing again will reach for that phrase; this is what stops them. */
  test('and does not close the list again', async ({ page }) => {
    await sapConfig(page);
    const system = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'sap').buildSystem()
    );
    expect(system).not.toContain('do not invent one');
    expect(system).not.toContain('Design from the standards below.');
  });

  /* Licensing the field must not license the learner. The line that may never
     move is the one about facts, and widening the mechanics is exactly the edit
     that could take it with it. */
  test('but never licenses a fact about the learner', async ({ page }) => {
    await sapConfig(page);
    const system = await page.evaluate(() =>
      window.NOTE_TOOLS.find((t) => t.id === 'sap').buildSystem()
    );
    expect(system).toContain('It never licenses a fact about this learner');
    expect(system).toContain('WHAT YOU STILL MAY NOT INVENT');
    expect(system).toContain('Never state a fact about this client that the clinician did not give you');
  });
});
