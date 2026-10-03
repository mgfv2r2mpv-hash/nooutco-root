import { test, expect } from '@playwright/test';

/* SUPERVISION PROMPT: ONE OWNER PER FACET.
 *
 * Approved 2 Oct 2026, from the diagnosis of one bad production Supervision
 * note that repeated the same facts across sections. Three causes, all in the
 * prompt text:
 *
 *   1. the section specs overlapped. Summary of Progress narrated what was
 *      modified, which is Protocol Modifications; Behavior carried "next steps
 *      for the behavior plan", which is a protocol change too; Follow-Up took
 *      pending protocol changes, which Protocol Modifications already states
 *   2. one nextSteps example was a whole sentence, and the model copied it
 *      verbatim into rows it did not fit
 *   3. the ROUTING RULE sent a pending change to programming AND followup
 *
 * His nuance, in his words: "a fact may have more than one facet". So the rule
 * is not "say each fact once". It is that no fact is restated in the same terms
 * in two sections, while a section may cover a DIFFERENT facet of a fact
 * another section covers: programming says what changes, followup says who
 * does what next.
 *
 * The live model reads this text from the voice-module prompt store, so these
 * tests hold the site copy the store is extracted from.
 */

async function supSystem(page) {
  await page.goto('/notes/bcba/index.html?tool=sup');
  await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
  return page.evaluate(() => window.NOTE_TOOLS.find((t) => t.id === 'sup').buildSystem());
}

// The spec line for one section, from its "- key" bullet to the next bullet.
const specFor = (system, key) => {
  const start = system.indexOf(`\n- ${key} `);
  if (start === -1) return '';
  const next = system.indexOf('\n- ', start + 3);
  return system.slice(start, next === -1 ? undefined : next);
};

test.describe('one owner per facet', () => {
  test('the rule is stated, with his nuance that one fact can have several facets', async ({ page }) => {
    const system = await supSystem(page);
    expect(system).toContain('ONE OWNER PER FACET');
    expect(system).toMatch(/A fact can have more than one facet/);
    expect(system).toMatch(/never restate a fact in the same terms in a second section/i);
    // The worked case, in the order he gave it.
    expect(system).toMatch(/programming says what changes, and followup says who does what next/);
  });

  test('every section spec names the facet it owns', async ({ page }) => {
    const system = await supSystem(page);
    for (const key of ['goalsAnalyzed', 'progress', 'programming', 'behavior', 'feedback', 'followup']) {
      expect(specFor(system, key), `${key} has no spec line`).not.toBe('');
      expect(specFor(system, key), `${key} does not say what it owns`).toMatch(/\bowns\b/);
    }
  });

  test('the overlaps are handed to their owner instead of written twice', async ({ page }) => {
    const system = await supSystem(page);
    const progress = specFor(system, 'progress');
    const behavior = specFor(system, 'behavior');
    const followup = specFor(system, 'followup');

    // The arc no longer narrates the modification itself.
    expect(progress).not.toMatch(/what was modified in response/);
    expect(progress).toMatch(/goalsAnalyzed/);
    expect(progress).toMatch(/programming/);
    // A behavior plan change is a protocol change, stated by programming.
    expect(behavior).not.toMatch(/next steps for the behavior plan/);
    expect(behavior).toMatch(/programming/);
    // Follow-up carries the next action, not the change again.
    expect(followup).not.toMatch(/pending protocol changes not yet completed PLUS/);
    expect(followup).toMatch(/who does what next/);
  });

  test('a pending change is routed to programming once, and followup takes only the next action', async ({ page }) => {
    const system = await supSystem(page);
    expect(system).not.toContain('programming (as a modification NEEDED) AND followup');
    const routing = system.slice(system.indexOf('ROUTING RULE'), system.indexOf('HINTS -'));
    expect(routing).toMatch(/revision described as pending → programming \(as a modification NEEDED\)/);
    expect(routing).toMatch(/followup/);
    expect(routing).toMatch(/never the change restated/);
  });

  test('nextSteps describes the pattern and offers no sentence to copy', async ({ page }) => {
    const system = await supSystem(page);
    expect(system).not.toContain('Continue current teaching strategies and re-assess at the next protocol modification session');
    expect(system).not.toContain('Placed on hold to introduce the prerequisite of waiting before responding');
    const goals = specFor(system, 'goalsAnalyzed');
    const nextSteps = goals.slice(goals.indexOf('"nextSteps"'));
    expect(nextSteps, 'a quoted example sentence is what got copied').not.toMatch(/e\.g\./);
    expect(nextSteps).toMatch(/no stock wording/i);
  });

  test('the prompt keeps the house rule on dashes', async ({ page }) => {
    const system = await supSystem(page);
    const dashes = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
    expect(system).not.toMatch(dashes);
  });
});
