import { test, expect } from '@playwright/test';

/* KALEB'S BT RULINGS, 2026-10-04, from his marks on six example BT notes
 * (scripts/bench/rulings/bt.md). Each test pins one ruling in the prompt the
 * BT tool sends, so an edit that drops it fails here. The last two pin the one
 * ruling held by code: Consequence Effectiveness is never blank. */

async function bt(page) {
  await page.goto('/notes/bt/index.html');
  await page.waitForFunction(() => (window.NOTE_TOOLS || []).some((t) => t.id === 'bt'));
}
// Both halves of what the BT tool sends: the section rules live in the user
// prompt, the terminology in the system prompt.
const system = (page) => page.evaluate(() => {
  const t = window.NOTE_TOOLS.find((x) => x.id === 'bt');
  return t.buildSystem() + '\n' + t.buildUserPrompt({});
});

test.describe('the BT prompt carries each ruling', () => {
  const RULES = [
    ['status is a behavior with its evidence', /appeared tired as evidenced by yawning/],
    ['a vague status word needs its signs', /"perked up" or "in a good mood" needs the signs that showed it/],
    ['no one who was not there', /never someone who was not there/],
    ['every program has its result', /Every program you mention gets its result/],
    ['mastery criteria, never mastered', /never masters a target and never writes that the client mastered one: write that the target met mastery criteria/],
    ['a program not run is left out', /Leave out a program that was not run, unless the notes give a reason that keeps recurring/],
    ['one program per paragraph', /Give each program its own paragraph, opening with its name and a colon/],
    ['exactly what the technician did', /Name exactly what the technician did, in the notes' words/],
    ['the prompt followed or modeled', /whether the client then did what was prompted or the technician modeled it/],
    ['what "helped" means', /write what that meant \(shorter, less often, or lower intensity than usual\)/],
    ['no aggression occurred', /"No aggression occurred", never "was observed"/],
    ['never reinforcement for the problem behavior', /never reads as reinforcement delivered for the problem behavior/],
    ['numbered BT actions in Concerns', /BT to follow up with BCBA about: 1\./],
    ['the words that fail', /Never "responded well", "did great", "went well", "did well", "throughout the session"/],
    ['effectiveness always picked', /Always exactly one, never "": the form requires a pick/],
  ];
  for (const [name, re] of RULES) {
    test(name, async ({ page }) => {
      await bt(page);
      expect(await system(page)).toMatch(re);
    });
  }
});

test.describe('Consequence Effectiveness is never blank on a draft', () => {
  const MIDDLE = 'Moderately effective at addressing behaviors within session';
  test('a blank pick becomes the middle option, with a hint saying so', async ({ page }) => {
    await bt(page);
    const out = await page.evaluate(() => window.NOTE_TOOLS.find((t) => t.id === 'bt')
      .normalizeOutput({ consequenceEffectiveness: '', hints: [] }, { intake: 'flopping x2 at clean up' }));
    expect(out.consequenceEffectiveness).toBe(MIDDLE);
    expect(out.hints.some((h) => h.section === 'consequenceEffectiveness' && /middle option/.test(h.detail))).toBe(true);
  });

  test('a pick the draft made is kept, and without the intake nothing is filled', async ({ page }) => {
    await bt(page);
    const out = await page.evaluate(() => {
      const t = window.NOTE_TOOLS.find((x) => x.id === 'bt');
      return {
        kept: t.normalizeOutput({ consequenceEffectiveness: 'Highly effective at addressing behaviors and mitigating future incidents' }, { intake: 'x' }).consequenceEffectiveness,
        bare: t.normalizeOutput({ consequenceEffectiveness: '' }).consequenceEffectiveness,
      };
    });
    expect(out.kept).toBe('Highly effective at addressing behaviors and mitigating future incidents');
    expect(out.bare).toBe('');
  });
});
