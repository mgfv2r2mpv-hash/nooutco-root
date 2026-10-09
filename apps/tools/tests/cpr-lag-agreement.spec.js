import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readSheet, findRow } from './helpers/xlsx.js';
import { attentionRecord, LAG_ON_CONSEQUENCE, LAG_OFF_CONSEQUENCE } from './fixtures/cpr-attention-record.js';

// One CPR session used to show three different 2x2 tables at once: the Review
// screen counted with no lag, the analysis screen opened with both lags on and
// let them be switched off, and the Excel export always applied both and said
// "Y (applied)" whatever the screen showed. The 8 Oct 2026 review found it on
// an invented record, which is the fixture here.
//
// The lag setting now lives on the assessment. These tests switch it on the
// analysis screen and read the same table from all three places.

const STORAGE_KEY = 'sda_cpr_assessments';

async function seed(page, record) {
  // Seeded once per test: a reload must read back what the page saved, not
  // the fixture again.
  await page.addInitScript(([key, rec]) => {
    if (sessionStorage.getItem('cpr-spec-seeded')) return;
    localStorage.setItem(key, JSON.stringify([[rec.id, rec]]));
    sessionStorage.setItem('cpr-spec-seeded', '1');
  }, [STORAGE_KEY, record]);
}

async function openAssessment(page) {
  await page.goto('/cpr/dist/');
  await page.getByText('Invented behavior').first().click();
  await expect(page.getByRole('button', { name: 'Full analysis' })).toBeVisible();
}

async function cellsIn(scope) {
  const texts = await scope.locator('[data-cell]').allTextContents();
  return texts.map((t) => Number(t.trim()));
}

const analysisConsequence = (page) =>
  page.locator('[data-condition="attention"] [data-cpr-table="consequence"]');
const reviewConsequence = (page) =>
  page.locator('[data-review-condition="attention"] [data-cpr-table="consequence"]');

async function exportedConsequence(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export Excel' }).click(),
  ]);
  const cells = readSheet(await readFile(await download.path()), 'Conditional Probability');
  const plus = findRow(cells, 'A', 'Bx Occurred (Bx+)');
  const minus = findRow(cells, 'A', 'Bx Did NOT Occur (Bx\u2212)', plus);
  const lagRow = (prefix) => {
    const ref = Object.keys(cells).find((r) => r.startsWith('A') && String(cells[r]).startsWith(prefix));
    return cells[`B${ref.slice(1)}`];
  };
  return {
    counts: [cells[`B${plus}`], cells[`C${plus}`], cells[`B${minus}`], cells[`C${minus}`]],
    antecedentLag: lagRow('Antecedent lag-1'),
    consequenceLag: lagRow('Consequence lag-1'),
  };
}

test('Review, the analysis screen and the Excel export show the same table, with lag on and with lag off', async ({ page }) => {
  await seed(page, attentionRecord());
  await openAssessment(page);

  // Lag on, the default: all three agree.
  await page.getByRole('button', { name: 'Review' }).first().click();
  await expect(page.getByText('Lag-1: antecedent on, consequence on')).toBeVisible();
  expect(await cellsIn(reviewConsequence(page))).toEqual(LAG_ON_CONSEQUENCE);

  await page.getByRole('button', { name: /Proceed to analysis/ }).click();
  expect(await cellsIn(analysisConsequence(page))).toEqual(LAG_ON_CONSEQUENCE);
  const on = await exportedConsequence(page);
  expect(on).toEqual({ counts: LAG_ON_CONSEQUENCE, antecedentLag: 'Y (applied)', consequenceLag: 'Y (applied)' });

  // Both switched off on the analysis screen: all three follow.
  await page.getByRole('switch', { name: 'Antecedent lag-1' }).click();
  await page.getByRole('switch', { name: 'Consequence lag-1' }).click();
  await expect(page.getByRole('switch', { name: 'Consequence lag-1' })).toHaveAttribute('aria-checked', 'false');
  expect(await cellsIn(analysisConsequence(page))).toEqual(LAG_OFF_CONSEQUENCE);
  const off = await exportedConsequence(page);
  expect(off).toEqual({ counts: LAG_OFF_CONSEQUENCE, antecedentLag: 'N (not applied)', consequenceLag: 'N (not applied)' });

  await page.getByRole('button', { name: /Back$/ }).click();
  await page.getByRole('button', { name: 'Review' }).first().click();
  await expect(page.getByText('Lag-1: antecedent off, consequence off')).toBeVisible();
  expect(await cellsIn(reviewConsequence(page))).toEqual(LAG_OFF_CONSEQUENCE);
});

test('the lag setting is saved with the assessment and survives a reload', async ({ page }) => {
  await seed(page, attentionRecord());
  await openAssessment(page);
  await page.getByRole('button', { name: 'Full analysis' }).click();
  await page.getByRole('switch', { name: 'Consequence lag-1' }).click();
  await expect(page.getByRole('switch', { name: 'Consequence lag-1' })).toHaveAttribute('aria-checked', 'false');

  await page.reload();
  await page.getByText('Invented behavior').first().click();
  await page.getByRole('button', { name: 'Full analysis' }).click();
  await expect(page.getByRole('switch', { name: 'Antecedent lag-1' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch', { name: 'Consequence lag-1' })).toHaveAttribute('aria-checked', 'false');
});

test('the analysis screen says what separated in plain words, and changes its answer with the lag', async ({ page }) => {
  await seed(page, attentionRecord());
  await openAssessment(page);
  await page.getByRole('button', { name: 'Full analysis' }).click();

  const findings = page.locator('[data-findings]').first();
  await expect(findings).toContainText('Attention separated most, by 50 points, across 10 scored intervals.');
  await expect(findings).toContainText('descriptive record');

  await page.getByRole('switch', { name: 'Antecedent lag-1' }).click();
  await page.getByRole('switch', { name: 'Consequence lag-1' }).click();
  await expect(findings).toContainText('Nothing separated.');
});

test('a column under five intervals is marked thin beside its numbers', async ({ page }) => {
  await seed(page, attentionRecord());
  await openAssessment(page);
  await page.getByRole('button', { name: 'Full analysis' }).click();
  // Lag on: C+ holds 6 intervals and C- holds 4, so the C- side is thin.
  await expect(analysisConsequence(page).locator('[data-thin]').first()).toBeVisible();
});

test('an empty column reads "none", not a blank that looks like zero', async ({ page }) => {
  const record = attentionRecord();
  const session = record.separateSessions.attention;
  const everyIntervalEO = {
    ...record,
    separateSessions: {
      attention: { ...session, intervals: session.intervals.map((iv) => ({ ...iv, eo: { attention: 'yes' } })) },
    },
  };
  await seed(page, everyIntervalEO);
  await openAssessment(page);
  await page.getByRole('button', { name: 'Full analysis' }).click();
  const antecedent = page.locator('[data-condition="attention"] [data-cpr-table="antecedent"]');
  await expect(antecedent.locator('[data-table-row="prob-minus"]')).toContainText('none');
  await expect(antecedent.locator('[data-table-row="prob-cv"]')).toContainText('none');
});

test('the rate column says it counts intervals with behavior, not responses', async ({ page }) => {
  await seed(page, attentionRecord());
  await openAssessment(page);
  await page.getByRole('button', { name: 'Full analysis' }).click();
  await expect(page.getByRole('columnheader', { name: 'Bx intervals/min' }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Bx/min', exact: true })).toHaveCount(0);
});
