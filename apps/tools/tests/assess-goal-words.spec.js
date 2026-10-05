import { test, expect } from '@playwright/test';

/* A BEHAVIOR TARGET'S NAME IS NOT A PERSON'S NAME.
 *
 * Kaleb's Assessment note, 2026-10-04: his notes named the reduction target
 * "Hugging/Jumping on People", and the draft wrote "jumping on People" with
 * "Hugging" gone. A target named in title case reads to the name pass as a run
 * of capitalised words, so a word in it can be masked as a guessed name, and a
 * masked word the model has no use for is a word the note loses. These pin what
 * the scrub leaves alone in a target's name. Every phrase here is invented. */

async function review(page, text) {
  await page.goto('/notes/bcba/index.html');
  await page.waitForFunction(() => !!(window.NotesScrub && window.NotesScrub.review));
  return page.evaluate(async (t) => {
    const r = await window.NotesScrub.review({ freeText: t, seen: [], newNote: true });
    return { text: window.NotesScrub.applyMap(t, r.map || []), map: (r.map || []).length };
  }, text);
}

for (const target of ['Hugging/Jumping on People', 'Hugging', 'Climbing', 'Tantrum']) {
  test(`the target "${target}" comes through the scrub as written`, async ({ page }) => {
    const out = await review(page, `BCBA reviewed reduction targets including "${target}," "Aggression," and "Elopement."`);
    expect(out.text).toContain(target);
  });
}
