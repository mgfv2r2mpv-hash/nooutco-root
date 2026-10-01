import { test, expect } from '@playwright/test';

/* The goal picker hands the sup tool a list of chosen goal names. The user
 * prompt carries them verbatim and in order, plus any bracket data rows parsed
 * into counts and a trial sequence, so the model is never asked to restate
 * counts it was not given. Nothing here calls a model. */

async function tool(page) {
  await page.goto('/notes/sup/');
  await page.waitForFunction(() => !!window.GoalCandidates && (window.NOTE_TOOLS || []).some((t) => t.id === 'sup'));
}

const ROW = '[Receptive ID | Animals | 5/3 | 62% | FP PP I I M I I I]';

test.describe('sup tool: chosen goals', () => {
  test('migrateDraft gives a draft without chosenGoals an empty list', async ({ page }) => {
    await tool(page);
    const out = await page.evaluate(() => {
      const t = window.NOTE_TOOLS.find((x) => x.id === 'sup');
      return [
        t.migrateDraft({ btPresent: true, clinicalNotes: 'a', staffNotes: '' }),
        t.migrateDraft({ btPresent: true, clinicalNotes: 'a', staffNotes: '', chosenGoals: ['X', 3, 'Y'] }),
        t.migrateDraft({ notes: 'old', btPresent: false }),
        t.migrateDraft(null),
      ];
    });
    expect(out[0].chosenGoals).toEqual([]);
    expect(out[1].chosenGoals).toEqual(['X', 'Y']);
    expect(out[2]).toMatchObject({ clinicalNotes: 'old', chosenGoals: [] });
    expect(out[3]).toBeNull();
  });

  test('the user prompt lists chosen goals verbatim and in order', async ({ page }) => {
    await tool(page);
    const prompt = await page.evaluate(() => window.NOTE_TOOLS.find((x) => x.id === 'sup').buildUserPrompt({
      btPresent: true, clinicalNotes: '- a', staffNotes: '', chosenGoals: ["Tolerate 'No'", 'Alternative to Denied Item/Activity'],
    }));
    expect(prompt).toContain("1. Tolerate 'No'\n2. Alternative to Denied Item/Activity");
  });

  test('without chosen goals the prompt carries no goal list', async ({ page }) => {
    await tool(page);
    const prompt = await page.evaluate(() => window.NOTE_TOOLS.find((x) => x.id === 'sup').buildUserPrompt({
      btPresent: true, clinicalNotes: '- a', staffNotes: '',
    }));
    expect(prompt).not.toContain('CHOSEN GOALS');
    expect(prompt).not.toContain('PARSED DATA ROWS');
  });

  test('a parsed bracket row hands the model counts and the trial sequence', async ({ page }) => {
    await tool(page);
    const prompt = await page.evaluate((row) => window.NOTE_TOOLS.find((x) => x.id === 'sup').buildUserPrompt({
      btPresent: true, clinicalNotes: row, staffNotes: '', chosenGoals: ['Receptive ID'],
    }), ROW);
    expect(prompt).toContain('PARSED DATA ROWS');
    expect(prompt).toContain('Receptive ID | Animals | 5 correct, 3 incorrect | sequence: FP PP I I M I I I');
  });

  test('a row with a mismatched percent or an unexplained code says so in the prompt', async ({ page }) => {
    await tool(page);
    const prompt = await page.evaluate(() => window.NOTE_TOOLS.find((x) => x.id === 'sup').buildUserPrompt({
      btPresent: true,
      clinicalNotes: '[Tact | Colors | 5/3 | 90% | I I F2 -]',
      staffNotes: '', chosenGoals: [],
    }));
    expect(prompt).toContain('stated percent disagrees with the counts; the counts stand');
    expect(prompt).toContain('unexplained codes: F2, -');
  });

  test('a row that does not parse stays free text and adds no data block', async ({ page }) => {
    await tool(page);
    const prompt = await page.evaluate(() => window.NOTE_TOOLS.find((x) => x.id === 'sup').buildUserPrompt({
      btPresent: true, clinicalNotes: '- Receptive ID: 5 of 8', staffNotes: '',
    }));
    expect(prompt).not.toContain('PARSED DATA ROWS');
  });
});
