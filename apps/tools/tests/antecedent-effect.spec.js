import { test, expect } from '@playwright/test';

/* HIS "CRITICAL, FIRST PRIORITY", MADE CHECKABLE RATHER THAN ASKED FOR.
   `antecedent_effect_unstated` is a code the prompt asks the model to raise when
   an antecedent strategy is named with nothing said about whether it worked. On
   a live note the model did not raise it, and one live note is one live note, so
   the fix is not to argue about the rate: it is to stop the tool depending on a
   judgement for something its own table can check.

   This is the second hint injected by the post-pass rather than reported by the
   model, and it follows strategy_in_wrong_section exactly: the tool publishes
   the strategy terms, the pure function reads them, and the hint goes through
   the tool's own normalizeHints with all the others.

   THE FAILURE THAT MATTERS IS THE FALSE POSITIVE. A hint on a note that already
   states its effect is worse than a miss, because it teaches a technician to
   distrust the panel. So the suppressor is deliberately generous: any effect
   language anywhere in the section silences it, positive or negative, and a
   strategy the tool carries no safe term for is never counted at all. Missing a
   real gap is the acceptable way for this to be wrong. */

const load = async (page) => {
  await page.goto('/notes/bt/');
  await page.waitForFunction(() => !!(window.NoteHollow && window.NOTE_TOOLS));
};

const found = (page, output) => page.evaluate((o) => window.NoteHollow
  .effectUnstated(o, window.NOTE_TOOLS.find((t) => t.id === 'bt').strategyOwnership)
  .map((h) => h.section + ': ' + h.code + ': ' + h.detail), output);

test.describe('an antecedent strategy named with no stated effect', () => {
  test('is caught, and the hint names the strategy rather than the technician\'s words', async ({ page }) => {
    await load(page);

    expect(await found(page, { antecedentNarrative: 'A visual schedule was used throughout the session.' }))
      .toEqual(['antecedentNarrative: antecedent_effect_unstated: Visual schedule is named with no stated effect. Say whether it helped.']);

    // The shape of the live note that started this: the strategy, and nothing
    // about what it did.
    expect(await found(page, { antecedentNarrative: 'Premack was used before each demand.' }))
      .toEqual(['antecedentNarrative: antecedent_effect_unstated: Utilized Premack principle (first-then) is named with no stated effect. Say whether it helped.']);
  });

  test('goes quiet the moment the note says what happened, whichever way it went', async ({ page }) => {
    await load(page);

    // Worked.
    for (const said of [
      'A visual schedule was used and it helped him transition.',
      'A visual schedule was used. He transitioned without protest.',
      'A visual schedule was used, which reduced refusals.',
      'A visual schedule was used and was effective throughout.',
      'A visual schedule was used. As a result he stayed at the table.',
    ]) {
      expect(await found(page, { antecedentNarrative: said }), said).toEqual([]);
    }

    // Did not work. A stated failure is a stated effect, and flagging it would
    // be the worst version of this check: telling a technician who documented a
    // failure honestly that they documented nothing.
    for (const said of [
      'A visual schedule was used and it did not help.',
      'A visual schedule was used. He continued to refuse.',
      'A visual schedule was used and he escalated anyway.',
      'A visual schedule was used, with no effect on the behavior.',
    ]) {
      expect(await found(page, { antecedentNarrative: said }), said).toEqual([]);
    }
  });

  test('says nothing about a strategy the tool carries no safe term for', async ({ page }) => {
    await load(page);

    /* Choices, break and warning are ordinary words in clinical prose, so
       STRATEGY_OWNERSHIP deliberately gives them no term. A check that fired on
       them would put a hint on every note that used the word "break", which is
       the exact reason those three match nothing. */
    for (const said of [
      'Choices were offered before each task.',
      'He was allowed a break when he asked.',
      'A warning was given before the transition.',
    ]) {
      expect(await found(page, { antecedentNarrative: said }), said).toEqual([]);
    }
  });

  test('does not repeat a hint the model already raised on that section', async ({ page }) => {
    await load(page);

    const withModelHint = {
      antecedentNarrative: 'A visual schedule was used throughout the session.',
      hints: [{ section: 'antecedentNarrative', code: 'antecedent_effect_unstated', kind: 'thin', rank: 2 }],
    };
    expect(await found(page, withModelHint)).toEqual([]);

    // The same code on a DIFFERENT section is not this section's hint.
    const elsewhere = {
      antecedentNarrative: 'A visual schedule was used throughout the session.',
      hints: [{ section: 'behaviorPlanNarrative', code: 'antecedent_effect_unstated', kind: 'thin', rank: 2 }],
    };
    expect(await found(page, elsewhere)).toHaveLength(1);
  });

  test('is amber and ranks below the wrong-section match, which is the surer of the two', async ({ page }) => {
    await load(page);

    const raw = await page.evaluate(() => window.NoteHollow
      .effectUnstated({ antecedentNarrative: 'A visual schedule was used throughout the session.' },
        window.NOTE_TOOLS.find((t) => t.id === 'bt').strategyOwnership)
      .map((h) => ({ kind: h.kind, rank: h.rank })));

    // Amber for the reason misplaced is amber, his call of 2026-09-02: the
    // information is missing rather than wrong, and red is what a funder could
    // refuse the claim over. Rank 1 rather than 0 because this one is an
    // absence of language and misplaced is a positive match on a published
    // table, so misplaced is the surer finding and sorts first.
    expect(raw).toEqual([{ kind: 'thin', rank: 1 }]);
  });

  test('goes quiet the moment the note mentions the client, whatever it says about them', async ({ page }) => {
    await load(page);

    /* These two came out of the existing post-pass suite, which caught them as
       false positives of the first version of this check. Both state an effect
       plainly and neither uses a word an effect vocabulary would hold, which is
       why the second suppressor is structural rather than lexical: the effect
       of an antecedent strategy is whatever the client then did, and that is
       not a closed list. */
    for (const said of [
      'A DRO ran on a two minute interval and the client earned the reinforcer at each one.',
      'A visual schedule was posted at the table and the client checked it between tasks.',
      'DRA was set up before each transition and the client asked for help instead.',
      'A visual schedule was posted on his desk.',
    ]) {
      expect(await found(page, { antecedentNarrative: said }), said).toEqual([]);
    }
  });

  test('is one hint for the section however many strategies went unanswered', async ({ page }) => {
    await load(page);

    /* Three strategies in one antecedent section is an ordinary note, not an
       unusual one, and three hints for one gap would crowd out everything the
       model found. The hint ceiling is shared. */
    const many = 'A visual schedule was posted and environmental arrangement was in place. Premack was used before each demand.';
    expect(await found(page, { antecedentNarrative: many }))
      .toEqual(['antecedentNarrative: antecedent_effect_unstated: The antecedent strategies are named with no stated effect. Say whether they helped.']);
  });

  test('fails open rather than guessing when it has nothing to read', async ({ page }) => {
    await load(page);

    const empties = await page.evaluate(() => {
      const own = window.NOTE_TOOLS.find((t) => t.id === 'bt').strategyOwnership;
      return [
        window.NoteHollow.effectUnstated(null, own).length,
        window.NoteHollow.effectUnstated({}, own).length,
        window.NoteHollow.effectUnstated({ antecedentNarrative: '' }, own).length,
        window.NoteHollow.effectUnstated({ antecedentNarrative: 'A visual schedule was used.' }, null).length,
        window.NoteHollow.effectUnstated({ antecedentNarrative: 'A visual schedule was used.' }, { sections: {} }).length,
      ];
    });
    expect(empties).toEqual([0, 0, 0, 0, 0]);
  });

  test('only the sections the tool asks for, and only for the code it declares', async ({ page }) => {
    await load(page);

    /* The consequence section names strategies too, and none of this applies
       there: the tool asks for an effect on antecedent modifications because
       that is what its heading asks the technician for. The check is driven by
       the tool's own table, so a section with no effectCode is untouched. */
    expect(await found(page, { behaviorPlanNarrative: 'A DRA ran alongside the token board.' })).toEqual([]);

    const declared = await page.evaluate(() => {
      const own = window.NOTE_TOOLS.find((t) => t.id === 'bt').strategyOwnership;
      return Object.keys(own.sections).map((k) => k + '=' + (own.sections[k].effectCode || 'none'));
    });
    expect(declared).toEqual([
      'antecedentNarrative=antecedent_effect_unstated',
      'behaviorPlanNarrative=none',
    ]);
  });
});
