/**
 * findings - what one group of tables says, in plain words.
 *
 * Ported from NoMe's `summarise` (sass-assistant src/assess/cpr.mjs), which
 * was itself built on this tool's maths. It names the condition whose
 * consequence separated most and whether the antecedent record agrees, and it
 * stops there: it never returns "function" as a finding, because the CPR is a
 * descriptive record and a functional analysis is what tests a function.
 *
 * A group is the separate conditions together, or one synthesized run.
 */
import type { ConditionAnalysis } from '../types';
import { CONDITION_META } from '../types';
import { isThin, THIN_COLUMN } from './conditionalProbability';

export interface GroupFinding {
  headline:  string;
  /** Set when the leading condition's antecedent record also separated. */
  agreement: string | null;
  /** Set when any column in the group is thin. */
  thinNote:  string | null;
  caution:   string;
}

export const DESCRIPTIVE_CAUTION =
  'This is a descriptive record: it shows what went together, not what caused what, ' +
  'and two conditions that move together in the room will both separate. ' +
  'A functional analysis is what tests a function.';

const PERCENT = 100;

function leaders(analyses: ConditionAnalysis[]): { best: number; lead: ConditionAnalysis[] } {
  // A separation has to be positive to be a lead. A negative CV says the
  // behavior was less likely with the consequence: worth seeing in the table,
  // not worth naming.
  const best = analyses.reduce((m, ca) => {
    const cv = ca.consequenceTable.cv;
    return cv !== null && cv > m ? cv : m;
  }, 0);
  const lead = best > 0 ? analyses.filter(ca => ca.consequenceTable.cv === best) : [];
  return { best, lead };
}

function agreementFor(lead: ConditionAnalysis[], mergedEO: boolean): string | null {
  const agreeing = lead.filter(ca => (ca.antecedentTable.cv ?? 0) > 0);
  if (agreeing.length === 0) return null;
  if (mergedEO) {
    return 'The combined EO record points the same way: the behavior was more likely with the EOs present than without them.';
  }
  const eos = agreeing.map(ca => CONDITION_META[ca.condition].eoLabel.toLowerCase()).join(' and ');
  return `The antecedent record points the same way: the behavior was more likely with ${eos} than without it.`;
}

export function summariseGroup(
  analyses: ConditionAnalysis[],
  scored:   number,
  opts:     { mergedEO?: boolean } = {},
): GroupFinding {
  const anyThin = analyses.some(ca => isThin(ca.consequenceTable) || isThin(ca.antecedentTable));
  const thinNote = anyThin
    ? `Some columns hold fewer than ${THIN_COLUMN} intervals (marked thin), so read those percentages as a direction, not a rate. One interval moves a small column a long way.`
    : null;

  if (scored === 0) {
    return { headline: 'No intervals are scored yet, so there is nothing to compare.', agreement: null, thinNote: null, caution: DESCRIPTIVE_CAUTION };
  }

  const { best, lead } = leaders(analyses);
  if (lead.length === 0) {
    return {
      headline: `Nothing separated. Across ${scored} scored intervals, no condition had the behavior more likely with its consequence than without it.`,
      agreement: null,
      thinNote,
      caution: DESCRIPTIVE_CAUTION,
    };
  }

  const names = lead.map(ca => CONDITION_META[ca.condition].label).join(' and ');
  const gap = Math.round(best * PERCENT);
  return {
    headline: `${names} separated most, by ${gap} points, across ${scored} scored intervals.`,
    agreement: agreementFor(lead, opts.mergedEO ?? false),
    thinNote,
    caution: DESCRIPTIVE_CAUTION,
  };
}
