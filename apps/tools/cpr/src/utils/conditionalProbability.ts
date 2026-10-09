import type {
  Session,
  Interval,
  ConditionType,
  ThreeWay,
  ContingencyTable,
  ConditionAnalysis,
  AssessmentAnalysis,
  Assessment,
} from '../types';
import { ALL_CONDITIONS } from '../types';

// ─── Lag-1 setting ────────────────────────────────────────────────────────────

/**
 * One lag setting per assessment. Review, the analysis screen, the PDF and the
 * Excel export all take it from here, because on 8 Oct 2026 they used three
 * different ones: Review counted with no lag, the screen opened with both on,
 * and the export applied both whatever the screen said.
 */
export interface LagSettings { antecedent: boolean; consequence: boolean; }

export const DEFAULT_LAG: LagSettings = { antecedent: true, consequence: true };

export function lagSettingsOf(assessment: Pick<Assessment, 'lag1Antecedent' | 'lag1Consequence'>): LagSettings {
  return {
    antecedent:  assessment.lag1Antecedent  ?? DEFAULT_LAG.antecedent,
    consequence: assessment.lag1Consequence ?? DEFAULT_LAG.consequence,
  };
}

// ─── Thin columns ─────────────────────────────────────────────────────────────

/**
 * Under this many intervals in a column, a probability swings a long way on one
 * interval. The Review tooltip has said "fewer than about 5" all along; the
 * flag puts it beside the number instead.
 */
export const THIN_COLUMN = 5;

export function isThin(table: ContingencyTable): boolean {
  return table.colTotalCPlus < THIN_COLUMN || table.colTotalCMinus < THIN_COLUMN;
}

// ─── Lag-1 helpers ────────────────────────────────────────────────────────────

function applyAntecedentLag1(values: (ThreeWay | undefined)[]): (ThreeWay | undefined)[] {
  return values.map((v, i) => {
    if (v === 'yes') return 'yes';
    if (i > 0 && values[i - 1] === 'yes') return 'yes';
    return v;
  });
}

function applyConsequenceLag1(values: ThreeWay[]): ThreeWay[] {
  return values.map((v, i) => {
    if (v === 'yes') return 'yes';
    if (i < values.length - 1 && values[i + 1] === 'yes') return 'yes';
    return v;
  });
}

// ─── Contingency table ────────────────────────────────────────────────────────

function buildContingencyTable(
  behavior:  ThreeWay[],
  condition: (ThreeWay | undefined)[],
): ContingencyTable {
  let bxPlusCPlus = 0, bxPlusCMinus = 0, bxMinusCPlus = 0, bxMinusCMinus = 0;

  for (let i = 0; i < behavior.length; i++) {
    const bx   = behavior[i];
    const cond = condition[i];
    if (bx === 'could_not_score' || cond === 'could_not_score' || cond === undefined) continue;
    if (bx === 'yes' && cond === 'yes')  bxPlusCPlus++;
    if (bx === 'yes' && cond === 'no')   bxPlusCMinus++;
    if (bx === 'no'  && cond === 'yes')  bxMinusCPlus++;
    if (bx === 'no'  && cond === 'no')   bxMinusCMinus++;
  }

  const rowTotalBxPlus  = bxPlusCPlus  + bxPlusCMinus;
  const rowTotalBxMinus = bxMinusCPlus + bxMinusCMinus;
  const colTotalCPlus   = bxPlusCPlus  + bxMinusCPlus;
  const colTotalCMinus  = bxPlusCMinus + bxMinusCMinus;
  const grandTotal      = rowTotalBxPlus + rowTotalBxMinus;

  const pBxGivenCPlus  = colTotalCPlus  > 0 ? bxPlusCPlus  / colTotalCPlus  : null;
  const pBxGivenCMinus = colTotalCMinus > 0 ? bxPlusCMinus / colTotalCMinus : null;
  const cv = pBxGivenCPlus !== null && pBxGivenCMinus !== null
    ? pBxGivenCPlus - pBxGivenCMinus : null;

  return {
    bxPlusCPlus, bxPlusCMinus, bxMinusCPlus, bxMinusCMinus,
    rowTotalBxPlus, rowTotalBxMinus, colTotalCPlus, colTotalCMinus,
    grandTotal, pBxGivenCPlus, pBxGivenCMinus, cv,
  };
}

// ─── Per-condition analysis ───────────────────────────────────────────────────

function analyzeCondition(
  intervals:  Interval[],
  condition:  ConditionType,
  lag1Ant:    boolean,
  lag1Cons:   boolean,
): ConditionAnalysis {
  const behavior  = intervals.map(iv => iv.behavior);
  const eoRaw     = intervals.map(iv => iv.eo[condition]);
  const eoEff     = lag1Ant  ? applyAntecedentLag1(eoRaw)                                      : eoRaw;
  const consRaw   = intervals.map(iv => iv.consequences[condition]);
  const consEff   = lag1Cons ? applyConsequenceLag1(consRaw)                                   : consRaw;

  return {
    condition,
    antecedentTable:  buildContingencyTable(behavior, eoEff),
    consequenceTable: buildContingencyTable(behavior, consEff),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Analyze a single session - used by ReviewScreen (counts only) and AnalysisView. */
export function analyzeSession(
  session:   Session,
  lag1Ant:   boolean,
  lag1Cons:  boolean,
): ConditionAnalysis[] {
  const conditions: ConditionType[] =
    session.sessionType === 'synthesized'
      ? ALL_CONDITIONS
      : session.condition ? [session.condition] : [];

  return conditions.map(c => analyzeCondition(session.intervals, c, lag1Ant, lag1Cons));
}

/** Analyze a full assessment - separate conditions and synthesized runs independently. */
export function analyzeAssessment(
  assessment: Assessment,
  lag1Ant:    boolean,
  lag1Cons:   boolean,
): AssessmentAnalysis {
  const separateConditionAnalyses: ConditionAnalysis[] = ALL_CONDITIONS.flatMap(c => {
    const session = assessment.separateSessions[c];
    return session ? [analyzeCondition(session.intervals, c, lag1Ant, lag1Cons)] : [];
  });

  const synthesizedAnalyses: ConditionAnalysis[][] = assessment.synthesizedSessions.map(
    session => ALL_CONDITIONS.map(c => analyzeCondition(session.intervals, c, lag1Ant, lag1Cons)),
  );

  return {
    assessmentId: assessment.id,
    lag1Antecedent:  lag1Ant,
    lag1Consequence: lag1Cons,
    separateConditionAnalyses,
    synthesizedAnalyses,
  };
}
