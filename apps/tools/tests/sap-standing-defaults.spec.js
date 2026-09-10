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
