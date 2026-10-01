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

test.describe('sup tool: goalsAnalyzed cap (review HIGH 3)', () => {
  test('normalizeOutput caps all rows at six and keeps reduction-target rows first', async ({ page }) => {
    await tool(page);
    const goals = await page.evaluate(() => {
      const t = window.NOTE_TOOLS.find((x) => x.id === 'sup');
      const skill = (n) => ({ goal: `Skill ${n}`, progress: 'Responded to most trials with one prompt.', nextSteps: 'Continue current teaching.' });
      const red = (n) => ({ goal: n, progress: 'Zero occurrences of the behavior today.', nextSteps: 'Continue the reduction plan.' });
      const rows = [skill(1), skill(2), red('Elopement'), skill(3), skill(4), skill(5), skill(6), skill(7), red('Aggression'), skill(8)];
      return t.normalizeOutput({ goalsAnalyzed: rows }, { reductionGoals: ['Elopement', 'Aggression'] }).goalsAnalyzed.map((r) => r.goal);
    });
    expect(goals).toEqual(['Skill 1', 'Skill 2', 'Elopement', 'Skill 3', 'Skill 4', 'Aggression']);
  });

  test('seven skill rows and no reduction row still cap at six', async ({ page }) => {
    await tool(page);
    const n = await page.evaluate(() => {
      const t = window.NOTE_TOOLS.find((x) => x.id === 'sup');
      const rows = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ goal: `Skill ${i}`, progress: 'Went well.', nextSteps: 'Continue.' }));
      return t.normalizeOutput({ goalsAnalyzed: rows }).goalsAnalyzed.length;
    });
    expect(n).toBe(6);
  });
});

test.describe('sup tool: reduction rows are classified by name and kind (second review LOW 6)', () => {
  const run = (page, rows, ctx) => page.evaluate(({ rows, ctx }) => {
    const t = window.NOTE_TOOLS.find((x) => x.id === 'sup');
    return t.normalizeOutput({ goalsAnalyzed: rows }, ctx).goalsAnalyzed.map((r) => r.goal);
  }, { rows, ctx });

  test('a skill row whose progress says "reduced prompting" does not escape the cap', async ({ page }) => {
    await tool(page);
    const rows = [1, 2, 3, 4, 5, 6, 7].map((i) => ({
      goal: `Skill ${i}`, progress: 'Prompting was reduced across trials; two episodes of refusal.', nextSteps: 'Continue.',
    }));
    expect(await run(page, rows)).toHaveLength(6);
  });

  test('a row the picker marked as a reduction target displaces the last skill, whatever its wording', async ({ page }) => {
    await tool(page);
    const rows = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ goal: `Skill ${i}`, progress: 'Went well.', nextSteps: 'Continue.' }));
    rows.push({ goal: 'elopement', progress: 'Went well.', nextSteps: 'Continue.' });
    const out = await run(page, rows, { reductionGoals: ['Elopement'] });
    expect(out).toHaveLength(6);
    expect(out[5]).toBe('elopement');
    expect(out).not.toContain('Skill 6');
  });

  test('a goal name that carries a reduction frame is a reduction row without the picker', async ({ page }) => {
    await tool(page);
    const rows = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ goal: `Skill ${i}`, progress: 'Went well.', nextSteps: 'Continue.' }));
    rows.push({ goal: 'Aggression (behavior targeted for reduction)', progress: '', nextSteps: 'Continue.' });
    const out = await run(page, rows);
    expect(out).toHaveLength(6);
    expect(out).toContain('Aggression (behavior targeted for reduction)');
  });
});

test.describe('sup tool: the master cap of six', () => {
  test('eight reduction rows and two skill rows keep the first six reduction rows', async ({ page }) => {
    await tool(page);
    const out = await page.evaluate(() => {
      const t = window.NOTE_TOOLS.find((x) => x.id === 'sup');
      const mk = (g) => ({ goal: g, progress: 'Steady.', nextSteps: 'Continue.' });
      const rows = [mk('Skill 1'), ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => mk(`Behavior ${i} (behavior of concern)`)), mk('Skill 2')];
      return t.normalizeOutput({ goalsAnalyzed: rows }).goalsAnalyzed.map((r) => r.goal);
    });
    expect(out).toEqual([1, 2, 3, 4, 5, 6].map((i) => `Behavior ${i} (behavior of concern)`));
  });

  test('six or fewer rows pass through untouched', async ({ page }) => {
    await tool(page);
    const n = await page.evaluate(() => {
      const t = window.NOTE_TOOLS.find((x) => x.id === 'sup');
      const rows = [1, 2, 3, 4, 5, 6].map((i) => ({ goal: i === 3 ? 'Elopement (behavior of concern)' : `Skill ${i}`, progress: 'Fine.', nextSteps: 'Continue.' }));
      return t.normalizeOutput({ goalsAnalyzed: rows }).goalsAnalyzed.length;
    });
    expect(n).toBe(6);
  });
});
