/**
 * ReviewScreen — data quality check ONLY.
 *
 * IMPORTANT: This screen intentionally shows NO analysis values (no probabilities,
 * no CV, no ACV, no charts) to prevent premature conclusions from biasing the
 * clinician's decision about whether to collect more data ("poisoning the fruit").
 *
 * It shows:
 *   - Read-only interval list with CS rows highlighted
 *   - Raw cell COUNTS only (no percentages) for each 2×2 contingency table
 *   - Three action buttons: Continue | Next condition | Proceed to analysis
 */
import React, { useState } from 'react';
import type { Assessment, Session, ConditionType } from '../types';
import { ALL_CONDITIONS, CONDITION_META } from '../types';

interface Props {
  assessment:          Assessment;
  session:             Session;
  onContinue:          () => void;
  onGoToDashboard:     () => void;
  onProceedToAnalysis: () => void;
}

export function ReviewScreen({ assessment: _assessment, session, onContinue, onGoToDashboard, onProceedToAnalysis }: Props) {
  const activeConditions: ConditionType[] =
    session.sessionType === 'synthesized'
      ? ALL_CONDITIONS
      : session.condition ? [session.condition] : [];

  // A row is CS if Bx=C, OR any active EO=C, OR any active consequence=C
  const csIntervals = session.intervals.filter(iv =>
    iv.behavior === 'could_not_score' ||
    activeConditions.some(c => (iv.eo[c] ?? 'could_not_score') === 'could_not_score') ||
    activeConditions.some(c => iv.consequences[c] === 'could_not_score')
  );

  return (
    <div className="space-y-4">
      {/* ── Title card (non-sticky) ── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-gray-800 dark:text-gray-100">
              Data Review:{' '}
              {session.sessionType === 'synthesized' ? 'Synthesized' :
                session.condition ? CONDITION_META[session.condition].label : ''}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {session.intervals.length} intervals · {csIntervals.length} excluded
            </p>
          </div>
          <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full font-medium">
            Review mode (no analysis shown)
          </span>
        </div>
      </div>

      {/* ── Cell count tables (counts only — NO probabilities) ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Cell counts (excluded intervals omitted)
          </p>
          <InfoBubble content={CELL_COUNT_TOOLTIP} />
        </div>
        {activeConditions.map(c => (
          <CellCountTable key={c} session={session} condition={c} />
        ))}
      </section>

      {/* ── Sticky column header — starts here (below cell count tables), freezes at top on scroll ── */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 rounded-t-lg border border-gray-200 dark:border-gray-700 px-3 py-2 shadow-sm -mb-2">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
          Intervals <span className="text-amber-600 dark:text-amber-400 ml-1 normal-case font-normal">(amber = row with score C)</span>
        </p>
        <ReadOnlyColumnHeader session={session} activeConditions={activeConditions} />
      </div>

      {/* ── Interval rows ── */}
      <div className="space-y-1 pt-2">
        {session.intervals.map(iv => {
          const hasCS =
            iv.behavior === 'could_not_score' ||
            activeConditions.some(c => (iv.eo[c] ?? 'could_not_score') === 'could_not_score') ||
            activeConditions.some(c => iv.consequences[c] === 'could_not_score');
          return (
            <ReadOnlyInterval key={iv.id} interval={iv}
              activeConditions={activeConditions} highlighted={hasCS} session={session} />
          );
        })}
      </div>

      {/* ── Action buttons ── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-4 flex flex-wrap gap-3 justify-end">
        <button onClick={onGoToDashboard} className="btn btn-secondary">
          ← Back to dashboard
        </button>
        <button onClick={onContinue} className="btn btn-secondary flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 16 16" fill="currentColor">
            <polygon points="3,1 15,8 3,15" />
          </svg>
          Continue data collection
        </button>
        <button onClick={onProceedToAnalysis} className="btn btn-primary">
          Proceed to analysis →
        </button>
      </div>
    </div>
  );
}

// ─── Cell count tooltip ───────────────────────────────────────────────────────

const CELL_COUNT_TOOLTIP = (
  <div className="space-y-2 text-xs text-gray-700 dark:text-gray-200">
    <p className="font-bold text-sm pb-1 border-b border-gray-200 dark:border-gray-600">
      What the 2×2 Cells Mean
    </p>

    <div className="space-y-1">
      <p className="font-semibold text-gray-800 dark:text-gray-100">Antecedent table</p>
      <p><span className="font-mono font-bold">Bx+ / EO+</span>: Behavior occurred AND the EO (motivating condition) was present.
        A large count here relative to other cells suggests the EO evokes the behavior.</p>
      <p><span className="font-mono font-bold">Bx+ / EO−</span>: Behavior occurred even when the EO was absent.
        A high count here weakens the case for antecedent control.</p>
      <p><span className="font-mono font-bold">Bx− / EO+</span>: EO was present but behavior did not occur
        (e.g., EO present but other variables suppressed behavior).</p>
      <p><span className="font-mono font-bold">Bx− / EO−</span>: Neither behavior nor EO occurred. Baseline / control intervals.</p>
    </div>

    <div className="space-y-1 border-t border-gray-100 dark:border-gray-700 pt-2">
      <p className="font-semibold text-gray-800 dark:text-gray-100">Consequence table</p>
      <p><span className="font-mono font-bold">Bx+ / C+</span>: Behavior occurred AND consequence was delivered.
        A disproportionately large count here (vs. Bx+ / C−) supports this function.</p>
      <p><span className="font-mono font-bold">Bx+ / C−</span>: Behavior occurred but consequence was NOT delivered.</p>
      <p><span className="font-mono font-bold">Bx− / C+</span>: Consequence delivered even without behavior
        (non-contingent delivery).</p>
      <p><span className="font-mono font-bold">Bx− / C−</span>: Neither occurred. These intervals are the comparison baseline.</p>
    </div>

    <div className="border-t border-gray-100 dark:border-gray-700 pt-2 space-y-1 text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded p-2">
      <p className="font-semibold">⚠ Small cell counts distort conditional probabilities</p>
      <p>Conditional probability (e.g., P(Bx|C+)) is computed from column totals. When a column total is very
        small, because the situation rarely occurred during observation. A single instance changes the
        probability dramatically. For example, if C+ was only delivered 2 times and Bx occurred in 1 of
        those, P(Bx|C+) = 50% even though the evidence is extremely thin.</p>
      <p>This can arise from <strong>artificial limits in data collection</strong>: the observer may never have
        created (or observed) the EO, or the consequence may have been withheld throughout, not because
        the function is absent, but because there were too few natural opportunities to observe it.</p>
      <p className="italic">As a practical guideline: treat any column with fewer than ~5 observations with caution,
        and consider whether more data or a different observation context is needed before concluding.</p>
    </div>
  </div>
);

function InfoBubble({ content }: { content: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative no-print">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-4 h-4 rounded-full border border-gray-400 dark:border-gray-500 text-gray-500 dark:text-gray-400
          text-[10px] font-bold flex items-center justify-center hover:opacity-70 leading-none"
        aria-label="Show cell count help"
      >?</button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-5 w-96 max-h-[80vh] overflow-y-auto bg-white dark:bg-gray-800
            border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl z-50 p-3 text-left">
            {content}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Cell count table (counts ONLY — no probabilities) ───────────────────────

function CellCountTable({ session, condition }: { session: Session; condition: ConditionType }) {
  const meta = CONDITION_META[condition];

  // Build counts — exclude CS on both axes independently
  let bxPlusEOPlus = 0, bxPlusEOMinus = 0, bxMinusEOPlus = 0, bxMinusEOMinus = 0;
  let bxPlusCPlus  = 0, bxPlusCMinus  = 0, bxMinusCPlus  = 0, bxMinusCMinus  = 0;
  let eoCSCount    = 0, cCSCount      = 0, bxCSCount      = 0;

  for (const iv of session.intervals) {
    const bx   = iv.behavior;
    const eo   = iv.eo[condition] ?? 'could_not_score';
    const cons = iv.consequences[condition];

    if (bx === 'could_not_score') { bxCSCount++; continue; }

    if (eo !== 'could_not_score') {
      if (bx === 'yes' && eo === 'yes')  bxPlusEOPlus++;
      if (bx === 'yes' && eo === 'no')   bxPlusEOMinus++;
      if (bx === 'no'  && eo === 'yes')  bxMinusEOPlus++;
      if (bx === 'no'  && eo === 'no')   bxMinusEOMinus++;
    } else { eoCSCount++; }

    if (cons !== 'could_not_score') {
      if (bx === 'yes' && cons === 'yes')  bxPlusCPlus++;
      if (bx === 'yes' && cons === 'no')   bxPlusCMinus++;
      if (bx === 'no'  && cons === 'yes')  bxMinusCPlus++;
      if (bx === 'no'  && cons === 'no')   bxMinusCMinus++;
    } else { cCSCount++; }
  }

  const headingClass = {
    blue:   'text-blue-700 dark:text-blue-300',
    green:  'text-green-700 dark:text-green-300',
    orange: 'text-orange-600 dark:text-orange-400',
    purple: 'text-purple-700 dark:text-purple-300',
  }[meta.color];

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800">
        <p className={`text-xs font-bold uppercase tracking-wide ${headingClass}`}>{meta.label}</p>
      </div>
      <div className="grid grid-cols-2 divide-x divide-gray-100 dark:divide-gray-800">
        {/* Antecedent counts */}
        <div className="px-3 py-2 space-y-1.5">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">
            Antecedent: {meta.eoLabel}
          </p>
          <CountGrid
            plusLabel="EO+" minusLabel="EO−"
            bxPlusPlus={bxPlusEOPlus} bxPlusMinus={bxPlusEOMinus}
            bxMinusPlus={bxMinusEOPlus} bxMinusMinus={bxMinusEOMinus}
            csCount={eoCSCount} bxCSCount={bxCSCount}
          />
        </div>
        {/* Consequence counts */}
        <div className="px-3 py-2 space-y-1.5">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">
            Consequence: {meta.cLabel}
          </p>
          <CountGrid
            plusLabel="C+" minusLabel="C−"
            bxPlusPlus={bxPlusCPlus} bxPlusMinus={bxPlusCMinus}
            bxMinusPlus={bxMinusCPlus} bxMinusMinus={bxMinusCMinus}
            csCount={cCSCount} bxCSCount={bxCSCount}
          />
        </div>
      </div>
    </div>
  );
}

function CountGrid({ plusLabel, minusLabel, bxPlusPlus, bxPlusMinus, bxMinusPlus, bxMinusMinus, csCount, bxCSCount }: {
  plusLabel: string; minusLabel: string;
  bxPlusPlus: number; bxPlusMinus: number;
  bxMinusPlus: number; bxMinusMinus: number;
  csCount: number; bxCSCount: number;
}) {
  return (
    <div className="space-y-1 text-xs">
      <div className="grid grid-cols-3 gap-1 text-center">
        <div />
        <div className="font-semibold text-gray-500 dark:text-gray-400">{plusLabel}</div>
        <div className="font-semibold text-gray-500 dark:text-gray-400">{minusLabel}</div>
        <div className="font-semibold text-gray-600 dark:text-gray-300 text-left">Bx+</div>
        <CountCell n={bxPlusPlus}  />
        <CountCell n={bxPlusMinus} />
        <div className="font-semibold text-gray-600 dark:text-gray-300 text-left">Bx−</div>
        <CountCell n={bxMinusPlus}  />
        <CountCell n={bxMinusMinus} />
      </div>
      <p className="text-gray-400 dark:text-gray-500 text-xs">
        {csCount + bxCSCount} excluded from table
      </p>
    </div>
  );
}

function CountCell({ n }: { n: number }) {
  return (
    <div className={`rounded px-1 py-0.5 text-center font-mono font-semibold
      ${n === 0 ? 'text-gray-300 dark:text-gray-600 bg-gray-50 dark:bg-gray-800' : 'text-gray-800 dark:text-gray-100 bg-gray-100 dark:bg-gray-700'}`}>
      {n}
    </div>
  );
}

// ─── Read-only column header ──────────────────────────────────────────────────

import type { Interval } from '../types';

function condLabelCls(color: 'blue'|'green'|'orange'|'purple'): string {
  return { blue:'text-blue-700 dark:text-blue-300', green:'text-green-700 dark:text-green-300',
    orange:'text-orange-700 dark:text-orange-300', purple:'text-purple-700 dark:text-purple-300' }[color];
}

const RO_EO_SHORT: Record<string, string> = {
  attention: 'Att-EO', escape: 'Esc-EO', tangible: 'Tang-EO', sensory: 'Sens-EO' };
const RO_C_SHORT: Record<string, string> = {
  attention: 'Att-C+', escape: 'Esc-C+', tangible: 'Tang-C+', sensory: 'Sens-C+' };

function ReadOnlyColumnHeader({ session, activeConditions }: { session: Session; activeConditions: ConditionType[] }) {
  const isSynth      = session.sessionType === 'synthesized';
  const synthConds   = session.synthesizedConditions ?? ALL_CONDITIONS;
  const indicated    = session.indicatedFunctions;
  const nonIndicated = ALL_CONDITIONS.filter(c => !indicated.includes(c));
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400
      bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <span className="w-6 shrink-0 text-center">#</span>
      <span className="w-12 shrink-0 text-center text-gray-400">time</span>
      <span className="w-8 shrink-0 text-center">Bx</span>
      <span className="w-0.5 mx-1.5 shrink-0" />
      {isSynth ? (
        <span className="w-16 shrink-0 text-center" title={synthConds.map(c => CONDITION_META[c].eoLabel).join(' + ')}>EO</span>
      ) : (
        activeConditions.map(c => (
          <span key={c} className={`w-16 shrink-0 text-center ${condLabelCls(CONDITION_META[c].color)}`}
            title={CONDITION_META[c].eoLabel}>{RO_EO_SHORT[c]}</span>
        ))
      )}
      <span className="w-0.5 mx-1.5 shrink-0" />
      {isSynth ? (
        /* Synthesized: all 4 consequences with indicated ordering */
        <>
          {indicated.map(c => (
            <span key={c} className={`w-16 shrink-0 text-center ${condLabelCls(CONDITION_META[c].color)}`}
              title={CONDITION_META[c].cLabel}>{RO_C_SHORT[c]}</span>
          ))}
          {nonIndicated.length > 0 && indicated.length > 0 && <span className="w-0.5 mx-1.5 shrink-0" />}
          {nonIndicated.map(c => (
            <span key={c} className={`w-16 shrink-0 text-center ${indicated.length > 0 ? 'opacity-50' : condLabelCls(CONDITION_META[c].color)}`}
              title={CONDITION_META[c].cLabel}>{RO_C_SHORT[c]}</span>
          ))}
        </>
      ) : (
        /* Separate: ONE consequence column — condition-matched only */
        session.condition && (
          <span className={`w-16 shrink-0 text-center ${condLabelCls(CONDITION_META[session.condition].color)}`}
            title={CONDITION_META[session.condition].cLabel}>
            {RO_C_SHORT[session.condition]}
          </span>
        )
      )}
    </div>
  );
}

// ─── Read-only interval row ───────────────────────────────────────────────────

function ReadOnlyInterval({ interval: iv, activeConditions, highlighted, session }: {
  interval: Interval; activeConditions: ConditionType[]; highlighted: boolean; session: Session;
}) {
  const bxLabel = iv.behavior === 'yes' ? 'Y' : iv.behavior === 'no' ? 'N' : 'C';
  const bxColor = iv.behavior === 'yes' ? 'text-green-600 dark:text-green-400' :
    iv.behavior === 'no' ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-gray-500';

  const isSynth      = session.sessionType === 'synthesized';
  const indicated    = session.indicatedFunctions;
  const nonIndicated = ALL_CONDITIONS.filter(c => !indicated.includes(c));

  // For synthesized: merge EO into single display value
  const synthEOVal = activeConditions.length > 0
    ? (activeConditions.every(c => (iv.eo[c] ?? 'could_not_score') === (iv.eo[activeConditions[0]] ?? 'could_not_score'))
        ? (iv.eo[activeConditions[0]] ?? 'could_not_score') : 'could_not_score')
    : 'could_not_score';

  return (
    <div className={`border rounded-lg px-2 py-1.5 flex items-center gap-2 text-xs ${
      highlighted
        ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20'
        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
    }`}>
      <span className="w-6 text-center font-mono font-semibold text-gray-400 dark:text-gray-500 shrink-0">
        {iv.intervalNumber}
      </span>
      <span className="text-gray-400 dark:text-gray-500 w-12 shrink-0">{iv.timeLabel || ''}</span>
      <span className={`w-8 shrink-0 text-center font-bold ${bxColor}`}>{bxLabel}</span>
      <span className="w-0.5 mx-1.5 shrink-0" />
      {/* EO */}
      {isSynth ? (
        <span className="w-16 shrink-0 text-center font-mono text-gray-600 dark:text-gray-300">
          {tw(synthEOVal)}
        </span>
      ) : (
        <span className="w-16 shrink-0 text-center font-mono text-gray-600 dark:text-gray-300">
          {tw(iv.eo[activeConditions[0]] ?? 'could_not_score')}
        </span>
      )}
      <span className="w-0.5 mx-1.5 shrink-0" />
      {/* Consequences */}
      {isSynth ? (
        /* Synthesized: all 4 with indicated ordering */
        <>
          {indicated.map(c => (
            <span key={c} className="w-16 shrink-0 text-center font-mono text-gray-600 dark:text-gray-300">
              {tw(iv.consequences[c])}
            </span>
          ))}
          {nonIndicated.length > 0 && indicated.length > 0 && <span className="w-0.5 mx-1.5 shrink-0" />}
          {nonIndicated.map(c => (
            <span key={c} className="w-16 shrink-0 text-center font-mono text-gray-400 dark:text-gray-500 opacity-60">
              {tw(iv.consequences[c])}
            </span>
          ))}
        </>
      ) : (
        /* Separate: ONE consequence — condition-matched */
        session.condition && (
          <span className="w-16 shrink-0 text-center font-mono text-gray-600 dark:text-gray-300">
            {tw(iv.consequences[session.condition])}
          </span>
        )
      )}
      {iv.note && <span className="text-gray-400 dark:text-gray-500 italic truncate ml-auto">✎ {iv.note}</span>}
    </div>
  );
}

function tw(v: import('../types').ThreeWay): string {
  return v === 'yes' ? 'Y' : v === 'no' ? 'N' : 'C';
}
