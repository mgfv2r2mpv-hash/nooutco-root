import { test, expect } from '@playwright/test';
import { analyzeAssessment, lagSettingsOf, isThin, THIN_COLUMN } from '../cpr/src/utils/conditionalProbability.ts';
import { summariseGroup } from '../cpr/src/utils/findings.ts';
import { attentionRecord, LAG_ON_CONSEQUENCE, LAG_OFF_CONSEQUENCE } from './fixtures/cpr-attention-record.js';

const cells = (t) => [t.bxPlusCPlus, t.bxPlusCMinus, t.bxMinusCPlus, t.bxMinusCMinus];

test('an assessment with no saved lag setting reads with both lags on, as the screen always opened', () => {
  expect(lagSettingsOf(attentionRecord())).toEqual({ antecedent: true, consequence: true });
});

test('a saved lag setting is the one every reader gets', () => {
  const a = attentionRecord({ lag1Antecedent: false, lag1Consequence: false });
  expect(lagSettingsOf(a)).toEqual({ antecedent: false, consequence: false });
  const lag = lagSettingsOf(a);
  const [ca] = analyzeAssessment(a, lag.antecedent, lag.consequence).separateConditionAnalyses;
  expect(cells(ca.consequenceTable)).toEqual(LAG_OFF_CONSEQUENCE);
});

test('the fixture gives the two tables the review measured', () => {
  const a = attentionRecord();
  expect(cells(analyzeAssessment(a, true, true).separateConditionAnalyses[0].consequenceTable)).toEqual(LAG_ON_CONSEQUENCE);
  expect(cells(analyzeAssessment(a, false, false).separateConditionAnalyses[0].consequenceTable)).toEqual(LAG_OFF_CONSEQUENCE);
});

test('a column under five intervals is thin, and five is not', () => {
  const base = { bxPlusCPlus: 0, bxPlusCMinus: 0, bxMinusCPlus: 0, bxMinusCMinus: 0, rowTotalBxPlus: 0, rowTotalBxMinus: 0, grandTotal: 0, pBxGivenCPlus: null, pBxGivenCMinus: null, cv: null };
  expect(THIN_COLUMN).toBe(5);
  expect(isThin({ ...base, colTotalCPlus: 4, colTotalCMinus: 20 })).toBe(true);
  expect(isThin({ ...base, colTotalCPlus: 20, colTotalCMinus: 4 })).toBe(true);
  expect(isThin({ ...base, colTotalCPlus: 5, colTotalCMinus: 5 })).toBe(false);
});

test('with lag on, the finding names Attention, the gap in points, and the antecedent agreeing', () => {
  const analyses = analyzeAssessment(attentionRecord(), true, true).separateConditionAnalyses;
  const f = summariseGroup(analyses, 10);
  expect(f.headline).toBe('Attention separated most, by 50 points, across 10 scored intervals.');
  expect(f.agreement).toBe('The antecedent record points the same way: the behavior was more likely with attn removed than without it.');
  expect(f.thinNote).toContain('fewer than 5');
});

test('with lag off, the same record says nothing separated', () => {
  const analyses = analyzeAssessment(attentionRecord(), false, false).separateConditionAnalyses;
  const f = summariseGroup(analyses, 10);
  expect(f.headline).toBe('Nothing separated. Across 10 scored intervals, no condition had the behavior more likely with its consequence than without it.');
  expect(f.agreement).toBeNull();
});

test('nothing scored is said as nothing scored, not as a null result', () => {
  const analyses = analyzeAssessment(attentionRecord(), true, true).separateConditionAnalyses;
  expect(summariseGroup(analyses, 0).headline).toBe('No intervals are scored yet, so there is nothing to compare.');
});

test('a synthesized run speaks of the combined EO, since its EO column is one merged column', () => {
  const analyses = analyzeAssessment(attentionRecord(), true, true).separateConditionAnalyses;
  expect(summariseGroup(analyses, 10, { mergedEO: true }).agreement)
    .toBe('The combined EO record points the same way: the behavior was more likely with the EOs present than without them.');
});

test('a finding never names a function, and always carries the descriptive caution', () => {
  for (const lag of [true, false]) {
    const f = summariseGroup(analyzeAssessment(attentionRecord(), lag, lag).separateConditionAnalyses, 10);
    expect(`${f.headline} ${f.agreement ?? ''}`).not.toMatch(/function/i);
    expect(f.caution).toContain('descriptive');
  }
});
