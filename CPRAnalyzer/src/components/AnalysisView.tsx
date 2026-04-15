import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { Assessment, ConditionAnalysis, ContingencyTable, ConditionType, Session } from '../types';
import { CONDITION_META, ALL_CONDITIONS } from '../types';
import { analyzeAssessment } from '../utils/conditionalProbability';
import { sessionProgress } from '../utils/assessmentHelpers';
import { exportAssessmentToExcel, type ExportScope } from '../utils/excelExport';

interface Props { assessment: Assessment; onBack?: () => void; }

export function AnalysisView({ assessment, onBack }: Props) {
  const [lag1Ant,          setLag1Ant]          = useState(true);
  const [lag1Cons,         setLag1Cons]         = useState(true);
  const [exportScope,      setExportScope]      = useState<ExportScope>('both');
  const [showRateTable,    setShowRateTable]    = useState(true);
  const [durationOverride, setDurationOverride] = useState(false);
  const [overrideMins,     setOverrideMins]     = useState('');

  const fullAnalysis = useMemo(
    () => analyzeAssessment(assessment, lag1Ant, lag1Cons),
    [assessment, lag1Ant, lag1Cons],
  );

  // ── Duration calculation ────────────────────────────────────────────────────
  const separateSessions = Object.values(assessment.separateSessions) as Session[];
  const synthSessions    = assessment.synthesizedSessions;
  function scopedSessions(): Session[] {
    if (exportScope === 'separate')    return separateSessions;
    if (exportScope === 'synthesized') return synthSessions;
    return [...separateSessions, ...synthSessions];
  }
  const rawElapsed = scopedSessions().reduce((s, ses) => s + (ses.elapsedSeconds ?? 0), 0);
  const effectiveSecs = durationOverride
    ? Math.round((parseFloat(overrideMins) || 0) * 60)
    : rawElapsed;

  // Scope filters both the rendered view (PDF) and Excel export
  // Sort in fixed order: Attention → Tangible → Escape → Sensory so PDF pages are predictable
  const PRINT_ORDER: ConditionType[] = ['attention', 'tangible', 'escape', 'sensory'];
  const sortForPrint = (analyses: ConditionAnalysis[]) =>
    [...analyses].sort((a, b) => PRINT_ORDER.indexOf(a.condition) - PRINT_ORDER.indexOf(b.condition));

  const separateAnalyses = sortForPrint(
    exportScope === 'synthesized' ? [] : fullAnalysis.separateConditionAnalyses
  );
  const synthesizedAnalyses = (exportScope === 'separate' ? [] : fullAnalysis.synthesizedAnalyses)
    .map(run => sortForPrint(run));

  const hasSeparate    = separateAnalyses.length > 0;
  const hasSynthesized = synthesizedAnalyses.length > 0;

  async function handleExport() {
    try { await exportAssessmentToExcel(assessment, exportScope); }
    catch (err) { alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`); }
  }

  function handlePdf() { window.print(); }

  return (
    <div className="space-y-6">
      {/* ── Controls ── */}
      <div className="no-print space-y-2">
        {/* Row 1: Lag-1 toggles + Back/Export buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800">
            <span className="text-xs font-semibold text-yellow-800 dark:text-yellow-300 uppercase tracking-wide">
              LAG-1
            </span>
            <LagToggle label="Antecedent" value={lag1Ant}  onChange={setLag1Ant}
              hint="EO in n or n−1 → Bx in n" />
            <LagToggle label="Consequence" value={lag1Cons} onChange={setLag1Cons}
              hint="Consequence in n or n+1 → Bx in n" />
            <InfoTooltip buttonClassName="border-yellow-700/50 text-yellow-800 dark:border-yellow-400/60 dark:text-yellow-300" content={
              <div className="space-y-2 text-xs text-gray-700 dark:text-gray-200">
                <p className="font-bold text-sm pb-1 border-b border-gray-200 dark:border-gray-600">Lag-1 Scoring</p>
                <p>Standard CPR counts co-occurrence only within the <em>same</em> interval, which can underestimate true behavioral relationships, especially with longer intervals (e.g., 10s) where consequences or EOs naturally bleed across boundaries.</p>
                <p className="font-semibold mt-1">Antecedent Lag-1:</p>
                <p>An EO recorded in interval <em>n</em> <strong>or n−1</strong> counts as present for behavior in interval n. Reduces false negatives when the EO immediately precedes the interval in which behavior occurs.</p>
                <p className="font-semibold mt-1">Consequence Lag-1:</p>
                <p>A consequence in interval <em>n</em> <strong>or n+1</strong> counts for behavior in interval n. Accounts for natural delays in consequence delivery (e.g., a therapist provides attention one interval after the behavior).</p>
                <p className="text-gray-500 dark:text-gray-400 italic mt-1">Recommendation: Keep both ON for standard 6–10s intervals. Consider turning OFF for longer intervals (15s+), where each interval already spans a wider window and the lag correction may over-credit adjacent events. Turn OFF when your protocol requires strict same-interval co-occurrence.</p>
              </div>
            } />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {fullAnalysis.separateConditionAnalyses.length > 0 && fullAnalysis.synthesizedAnalyses.length > 0 && (
              <select
                value={exportScope}
                onChange={e => setExportScope(e.target.value as ExportScope)}
                className="input text-sm w-auto py-1.5"
                title="Filter which sessions appear in exports"
              >
                <option value="both">Both</option>
                <option value="separate">Separate only</option>
                <option value="synthesized">Synthesized only</option>
              </select>
            )}
            {onBack && (
              <button onClick={onBack} className="btn btn-secondary text-sm">← Back</button>
            )}
            <button onClick={handlePdf} className="btn btn-secondary text-sm">Export PDF</button>
            <button onClick={handleExport} className="btn btn-primary text-sm">Export Excel</button>
          </div>
        </div>
        {/* Row 2: Duration override + rate table toggle */}
        <div className="flex flex-wrap items-center gap-4 px-1">
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none">
            <input type="checkbox" checked={durationOverride} onChange={e => {
              const checked = e.target.checked;
              setDurationOverride(checked);
              // Prepopulate on first check with best available source:
              // 1) importedDurationSeconds (broadest window from imported file)
              // 2) rawElapsed (live timer total)
              if (checked && overrideMins === '') {
                const best = assessment.importedDurationSeconds
                  ? assessment.importedDurationSeconds / 60
                  : rawElapsed > 0 ? rawElapsed / 60 : null;
                if (best !== null) setOverrideMins(best.toFixed(1));
              }
            }} className="rounded" />
            Override Assessment Duration
          </label>
          {durationOverride && (
            <div className="flex items-center gap-1">
              <input
                type="number" min="0" step="0.5"
                value={overrideMins}
                onChange={e => setOverrideMins(e.target.value)}
                placeholder="min"
                className="input text-sm w-20 py-1"
                title="Total observed duration in minutes"
              />
              <span className="text-xs text-gray-500">min</span>
            </div>
          )}
          <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none">
            <input type="checkbox" checked={showRateTable} onChange={e => setShowRateTable(e.target.checked)} className="rounded" />
            Include Rate/Frequency in Output Files
          </label>
        </div>
      </div>
      {/* ── Imported duration advisory ── */}
      {assessment.importedDurationSeconds !== undefined && (
        <div className="no-print flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300">
          <span className="mt-0.5 shrink-0">⚠</span>
          <span>
            Observation time was estimated from the loaded file&apos;s start/end times
            ({(assessment.importedDurationSeconds / 60).toFixed(1)} min).
            Date format variations may affect accuracy; verify and use{' '}
            <strong>Override Assessment Duration</strong> if needed.
          </span>
        </div>
      )}
      {/* ── Print-only summary header (full first page) ── */}
      <div className="hidden print:block print-summary border border-gray-300 rounded-lg p-4 space-y-3">
        <h1 className="text-lg font-bold text-gray-900">SDA CPR Analysis Tool: Report</h1>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-gray-800">
          <div><span className="font-semibold">Client:</span> {assessment.clientName}</div>
          <div><span className="font-semibold">Observer:</span> {assessment.observer || ''}</div>
          <div><span className="font-semibold">Setting:</span> {assessment.setting || ''}</div>
          <div><span className="font-semibold">Date:</span> {assessment.date || ''}</div>
          <div><span className="font-semibold">Time:</span> {assessment.startEndTime || ''}</div>
          <div><span className="font-semibold">Export scope:</span> {exportScope === 'both' ? 'Both (Separate + Synthesized)' : exportScope === 'separate' ? 'Separate conditions only' : 'Synthesized only'}</div>
          {assessment.targetBehaviorName && (
            <div className="col-span-2"><span className="font-semibold">Target behavior:</span> {assessment.targetBehaviorName}</div>
          )}
          {assessment.targetBehaviorDefinition && (
            <div className="col-span-2"><span className="font-semibold">Definition:</span> {assessment.targetBehaviorDefinition}</div>
          )}
        </div>
        <div className="border-t border-gray-200 pt-2 flex flex-wrap gap-6 text-sm">
          <span className="font-semibold text-gray-700">LAG-1 flags:</span>
          <span className={lag1Ant ? 'text-yellow-700 font-semibold' : 'text-gray-500'}>
            Antecedent: {lag1Ant ? 'ON' : 'OFF'}
          </span>
          <span className={lag1Cons ? 'text-yellow-700 font-semibold' : 'text-gray-500'}>
            Consequence: {lag1Cons ? 'ON' : 'OFF'}
          </span>
          {effectiveSecs > 0 && (
            <span className="text-gray-700">
              <span className="font-semibold">Total observed time:</span> {fmtDur(effectiveSecs)}
            </span>
          )}
        </div>
        {showRateTable && <BehaviorRateTable assessment={assessment} exportScope={exportScope} />}
      </div>

      {/* ── Behavior rate/frequency table (screen only — print version is inside print header) ── */}
      <div className="no-print">
        <BehaviorRateTable assessment={assessment} exportScope={exportScope} />
      </div>

      <div>

      {/* ── Separate conditions ── */}
      {hasSeparate && (
        <section className="space-y-4">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700 pb-2">
            Separate Conditions
          </h2>
          <div className="print-conditions-grid space-y-4">
            {separateAnalyses.map(ca => (
              <ConditionSection key={ca.condition} ca={ca} />
            ))}
          </div>
          <GraphSection analyses={separateAnalyses} title="Separate Conditions" className="print-graphs-section" />
        </section>
      )}

      {/* ── Synthesized ── */}
      {hasSynthesized && (
        <section className="space-y-4 print-synth-section">
          <h2 className="text-base font-bold text-gray-800 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700 pb-2">
            Synthesized
          </h2>
          {synthesizedAnalyses.map((runAnalyses, i) => (
            <div key={i} className="space-y-3">
              <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Run {i + 1}</p>
              <div className="print-conditions-grid space-y-3">
                {runAnalyses.map(ca => (
                  <ConditionSection key={ca.condition} ca={ca} />
                ))}
              </div>
              <GraphSection analyses={runAnalyses} title={`Synthesized Run ${i + 1}`} className="print-graphs-section" />
            </div>
          ))}
        </section>
      )}

      {!hasSeparate && !hasSynthesized && (
        <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-12">
          No session data yet. Enter data to see analysis.
        </p>
      )}
      </div>

      {/* ── Notes pages (print-only, appended at end of PDF) ── */}
      {[1, 2].map(n => (
        <div key={n} className="hidden print:block print-notes-page border border-gray-300 rounded-lg p-6 space-y-2">
          <h2 className="text-base font-bold text-gray-800 border-b border-gray-300 pb-2">Notes: Page {n}</h2>
          <div style={{ minHeight: '22cm' }} />
        </div>
      ))}
    </div>
  );
}

// ─── Tooltip component ────────────────────────────────────────────────────────

function InfoTooltip({ content, buttonClassName }: { content: React.ReactNode; buttonClassName?: string }) {
  const [open, setOpen] = useState(false);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (
        popupRef.current && !popupRef.current.contains(e.target as Node) &&
        btnRef.current  && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  function toggle() {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopupStyle({
        position: 'fixed',
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
        zIndex: 9999,
      });
    }
    setOpen(o => !o);
  }

  return (
    <div className="relative no-print">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className={`w-5 h-5 rounded-full border-2 text-[11px] font-bold flex items-center justify-center
          transition-opacity ${buttonClassName ?? 'border-gray-400 text-gray-500 hover:opacity-70 dark:border-gray-500 dark:text-gray-400'}`}
        aria-label="Show help"
      >?</button>
      {open && createPortal(
        <div ref={popupRef} style={popupStyle}
          className="w-80 max-h-96 overflow-y-auto bg-white dark:bg-gray-800
            border border-gray-200 dark:border-gray-600 rounded-xl shadow-2xl p-3 text-left">
          {content}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Tooltip content constants ────────────────────────────────────────────────

const CONS_TOOLTIP = (
  <div className="space-y-2 text-xs text-gray-700 dark:text-gray-200">
    <p className="font-bold text-sm pb-1 border-b border-gray-200 dark:border-gray-600">Consequence Analysis: Abbreviations</p>
    <div className="space-y-1">
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">Bx+</code>: Behavior occurred in this interval</p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">Bx−</code>: Behavior did NOT occur</p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">C+</code>: Consequence observed to occur naturally following the behavior (e.g., attention provided by someone nearby, access to an item, task removed, sensory stimulation present)</p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">C−</code>: Consequence did not occur in this interval</p>
    </div>
    <div className="border-t border-gray-100 dark:border-gray-700 pt-2 space-y-1">
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">P(Bx|C+)</code>: Probability of behavior given consequence was delivered<br/>
        <span className="text-gray-500 dark:text-gray-400 pl-3">= Bx+C+ ÷ C+ column total</span></p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">P(Bx|C−)</code>: Probability of behavior given consequence was absent<br/>
        <span className="text-gray-500 dark:text-gray-400 pl-3">= Bx+C− ÷ C− column total</span></p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">CV</code>: Contingency Value<br/>
        <span className="text-gray-500 dark:text-gray-400 pl-3">= P(Bx|C+) − P(Bx|C−)</span></p>
    </div>
    <p className="text-gray-500 dark:text-gray-400 italic pt-1 border-t border-gray-100 dark:border-gray-700">
      Positive CV → behavior more likely when this consequence naturally occurs; suggests a possible functional relationship. Negative or near-zero → unlikely function. Results are correlational; SDA does not manipulate consequences.
    </p>
  </div>
);

const ANT_TOOLTIP = (
  <div className="space-y-2 text-xs text-gray-700 dark:text-gray-200">
    <p className="font-bold text-sm pb-1 border-b border-gray-200 dark:border-gray-600">Antecedent Analysis: Abbreviations</p>
    <div className="space-y-1">
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">Bx+</code>: Behavior occurred</p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">Bx−</code>: Behavior did NOT occur</p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">A+ (EO Present)</code>: Establishing Operation is active: the motivating condition that increases the value of this reinforcer (e.g., attention deprivation, prolonged work demands, no item access, sensory deprivation)</p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">A− (EO Absent)</code>: EO is not active / motivating condition absent</p>
    </div>
    <div className="border-t border-gray-100 dark:border-gray-700 pt-2 space-y-1">
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">P(Bx|A+)</code>: Probability of behavior given EO is present<br/>
        <span className="text-gray-500 dark:text-gray-400 pl-3">= Bx+A+ ÷ A+ column total</span></p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">P(Bx|A−)</code>: Probability of behavior given EO is absent<br/>
        <span className="text-gray-500 dark:text-gray-400 pl-3">= Bx+A− ÷ A− column total</span></p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">ACV</code>: Antecedent Contingency Value<br/>
        <span className="text-gray-500 dark:text-gray-400 pl-3">= P(Bx|A+) − P(Bx|A−)</span></p>
    </div>
    <p className="text-gray-500 dark:text-gray-400 italic pt-1 border-t border-gray-100 dark:border-gray-700">
      Positive ACV → behavior more likely when EO is present; suggests this EO evokes the behavior. Useful for identifying antecedent control even before consequence analysis is complete.
    </p>
  </div>
);

const GRAPH_TOOLTIP = (
  <div className="space-y-2 text-xs text-gray-700 dark:text-gray-200">
    <p className="font-bold text-sm pb-1 border-b border-gray-200 dark:border-gray-600">Graph Table: Column Guide</p>
    <div className="space-y-1">
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">P(Bx|C+)</code>: Prob. of behavior given consequence delivered</p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">P(Bx|C−)</code>: Prob. of behavior given consequence absent</p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">CV</code>: P(Bx|C+) − P(Bx|C−)<br/>
        <span className="text-gray-500 dark:text-gray-400 pl-3">Consequence Contingency Value</span></p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">P(Bx|A+)</code>: Prob. of behavior given EO present</p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">P(Bx|A−)</code>: Prob. of behavior given EO absent</p>
      <p><code className="font-bold text-indigo-600 dark:text-indigo-300">ACV</code>: P(Bx|A+) − P(Bx|A−)<br/>
        <span className="text-gray-500 dark:text-gray-400 pl-3">Antecedent Contingency Value</span></p>
    </div>
    <p className="text-gray-500 dark:text-gray-400 italic pt-1 border-t border-gray-100 dark:border-gray-700">
      Positive CV / ACV (green) → function may be indicated. Values near 0 or negative (red) → function likely not controlling. Use alongside the full tables for clinical interpretation.
    </p>
  </div>
);

// ─── Per-condition section ────────────────────────────────────────────────────

function ConditionSection({ ca }: { ca: ConditionAnalysis }) {
  const meta = CONDITION_META[ca.condition];
  const hClass = { blue:'text-blue-700 dark:text-blue-300', green:'text-green-700 dark:text-green-300',
    orange:'text-orange-600 dark:text-orange-400', purple:'text-purple-700 dark:text-purple-300' }[meta.color];
  const gridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    function syncRows() {
      const blocks = grid!.querySelectorAll<HTMLElement>('[data-table-block]');
      if (blocks.length !== 2) return;

      const rowSelectors = [
        '[data-table-row="header"]',
        '[data-table-row="col-header"] tr',
        '[data-table-row="bx-plus"]',
        '[data-table-row="bx-minus"]',
        '[data-table-row="col-total"]',
        '[data-table-row="prob-plus"]',
        '[data-table-row="prob-minus"]',
        '[data-table-row="prob-cv"]',
      ];

      rowSelectors.forEach(sel => {
        const rows = Array.from(blocks).map(b => b.querySelector<HTMLElement>(sel));
        if (rows.some(r => !r)) return;
        rows.forEach(r => { r!.style.height = ''; });
        const maxH = Math.max(...rows.map(r => r!.getBoundingClientRect().height));
        rows.forEach(r => { r!.style.height = `${maxH}px`; });
      });
    }

    syncRows();
    window.addEventListener('resize', syncRows);
    return () => window.removeEventListener('resize', syncRows);
  }, [ca]);

  return (
    <section className="space-y-2">
      <h3 className={`text-sm font-bold uppercase tracking-wide ${hClass}`}>▶ {meta.label}</h3>
      <div ref={gridRef} className="condition-tables grid grid-cols-1 gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        <TableBlock title="CONSEQUENCE ANALYSIS" subtitle="P(Bx | C±)"
          colPlusLabel="C+ (Cons. Delivered)" colMinusLabel="C− (Cons. Absent)"
          table={ca.consequenceTable} color={meta.color}
          cvLabel="CV" cvFormula="P(Bx|C+)−P(Bx|C−)"
          tooltipContent={CONS_TOOLTIP} />
        <TableBlock title="ANTECEDENT ANALYSIS" subtitle="P(Bx | A±)"
          colPlusLabel="A+ (EO Present)" colMinusLabel="A− (EO Absent)"
          table={ca.antecedentTable} color={meta.color}
          cvLabel="ACV" cvFormula="P(Bx|A+)−P(Bx|A−)"
          tooltipContent={ANT_TOOLTIP} />
      </div>
    </section>
  );
}

// ─── Contingency table block ──────────────────────────────────────────────────

function TableBlock({ title, subtitle, colPlusLabel, colMinusLabel, table, color, cvLabel, cvFormula, tooltipContent }: {
  title: string; subtitle: string; colPlusLabel: string; colMinusLabel: string;
  table: ContingencyTable; color: 'blue'|'green'|'orange'|'purple'; cvLabel: string; cvFormula: React.ReactNode;
  tooltipContent?: React.ReactNode;
}) {
  const hBg = { blue:'bg-blue-700', green:'bg-green-700', orange:'bg-orange-600', purple:'bg-purple-700' }[color];
  return (
    <div className="relative" data-table-block>
      {tooltipContent && (
        <div className="absolute top-0 right-0 z-20 p-1.5">
          <InfoTooltip buttonClassName="border-white/60 text-white hover:bg-white/20" content={tooltipContent} />
        </div>
      )}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
      <div data-table-row="header" className={`${hBg} text-white px-3 py-1.5 text-center`}>
        <p className="font-bold text-xs uppercase tracking-wide pr-5">{title}: {subtitle}</p>
      </div>
      <table className="w-full">
        <thead data-table-row="col-header" className="bg-gray-100 dark:bg-gray-800">
          <tr>
            <th className="px-3 py-1.5 text-left text-xs font-medium text-gray-600 dark:text-gray-300 w-44" />
            <th className="px-3 py-1.5 text-center text-xs font-medium text-gray-600 dark:text-gray-300">{colPlusLabel}</th>
            <th className="px-3 py-1.5 text-center text-xs font-medium text-gray-600 dark:text-gray-300">{colMinusLabel}</th>
            <th className="px-3 py-1.5 text-center text-xs font-medium text-gray-600 dark:text-gray-300">Row Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          <tr data-table-row="bx-plus" className="bg-white dark:bg-gray-900">
            <td className="px-3 py-1.5 font-medium text-gray-700 dark:text-gray-200">Bx Occurred (Bx+)</td>
            <td className="px-3 py-1.5 text-center">{table.bxPlusCPlus}</td>
            <td className="px-3 py-1.5 text-center">{table.bxPlusCMinus}</td>
            <td className="px-3 py-1.5 text-center font-semibold">{table.rowTotalBxPlus}</td>
          </tr>
          <tr data-table-row="bx-minus" className="bg-white dark:bg-gray-900">
            <td className="px-3 py-1.5 font-medium text-gray-700 dark:text-gray-200">Bx Did NOT Occur (Bx−)</td>
            <td className="px-3 py-1.5 text-center">{table.bxMinusCPlus}</td>
            <td className="px-3 py-1.5 text-center">{table.bxMinusCMinus}</td>
            <td className="px-3 py-1.5 text-center font-semibold">{table.rowTotalBxMinus}</td>
          </tr>
          <tr data-table-row="col-total" className="bg-gray-50 dark:bg-gray-800">
            <td className="px-3 py-1.5 font-semibold text-gray-700 dark:text-gray-200">Column Total</td>
            <td className="px-3 py-1.5 text-center font-semibold">{table.colTotalCPlus}</td>
            <td className="px-3 py-1.5 text-center font-semibold">{table.colTotalCMinus}</td>
            <td className="px-3 py-1.5 text-center font-bold">{table.grandTotal}</td>
          </tr>
        </tbody>
      </table>
      <div className="divide-y divide-gray-100 dark:divide-gray-800 border-t border-gray-200 dark:border-gray-700">
        <ProbRow rowKey="prob-plus" label={`P(Bx | ${colPlusLabel.split(' ')[0]})`} value={table.pBxGivenCPlus}
          desc={`Probability of Bx given ${colPlusLabel}`} color={color} />
        <ProbRow rowKey="prob-minus" label={`P(Bx | ${colMinusLabel.split(' ')[0]})`} value={table.pBxGivenCMinus}
          desc={`Probability of Bx given ${colMinusLabel}`} color={color} />
        <CVRow rowKey="prob-cv" label={cvLabel} value={table.cv} formula={cvFormula} color={color} />
      </div>
    </div>
    </div>
  );
}

function ProbRow({ rowKey, label, value, desc, color }: {
  rowKey:string; label:string; value:number|null; desc:string; color:'blue'|'green'|'orange'|'purple';
}) {
  const tc = { blue:'text-blue-700 dark:text-blue-300', green:'text-green-700 dark:text-green-300',
    orange:'text-orange-600 dark:text-orange-400', purple:'text-purple-700 dark:text-purple-300' }[color];
  return (
    <div data-table-row={rowKey} className="flex items-center px-3 py-1.5 bg-white dark:bg-gray-900">
      <span className={`font-bold text-sm w-28 shrink-0 ${tc}`}>{label}</span>
      <span className="font-bold text-gray-800 dark:text-gray-100 w-16 text-right shrink-0">
        {value !== null ? pct(value) : ''}
      </span>
      <span className="print:hidden text-xs text-gray-400 dark:text-gray-500 ml-3">{desc}</span>
    </div>
  );
}

function CVRow({ rowKey, label, value, formula, color }: {
  rowKey:string; label:string; value:number|null; formula:React.ReactNode; color:'blue'|'green'|'orange'|'purple';
}) {
  const bg = { blue:'bg-blue-50 dark:bg-blue-950/20', green:'bg-green-50 dark:bg-green-950/20',
    orange:'bg-orange-50 dark:bg-orange-950/20', purple:'bg-purple-50 dark:bg-purple-950/20' }[color];
  const vc = value === null ? 'text-gray-400' : value > 0 ? 'text-emerald-700 dark:text-emerald-400' :
    value < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300';
  return (
    <div data-table-row={rowKey} className={`flex items-center px-3 py-1.5 ${bg}`}>
      <span className="font-bold text-sm w-28 shrink-0 text-gray-700 dark:text-gray-200">{label}</span>
      <span className={`font-bold w-16 text-right shrink-0 ${vc}`}>
        {value !== null ? pct(value) : ''}
      </span>
      <span className="print:hidden text-xs text-gray-400 dark:text-gray-500 italic ml-3">{formula}</span>
    </div>
  );
}

// ─── Graph section ────────────────────────────────────────────────────────────

function GraphSection({ analyses, title, className }: { analyses: ConditionAnalysis[]; title: string; className?: string }) {
  return (
    <section className={`space-y-3 ${className ?? ''}`}>
      <div className="flex items-center justify-center gap-2">
        <h4 className="text-sm font-bold text-center text-gray-600 dark:text-gray-300 uppercase tracking-wide">
          {title}: Conditional Probability Graph Data
        </h4>
        <InfoTooltip content={GRAPH_TOOLTIP} />
      </div>

      {/* Summary table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-700 text-white">
              <th className="px-3 py-2 text-left">Function</th>
              <th className="px-3 py-2 text-center">P(Bx|C+)</th>
              <th className="px-3 py-2 text-center">P(Bx|C−)</th>
              <th className="px-3 py-2 text-center">CV</th>
              <th className="px-3 py-2 text-center">P(Bx|A+)</th>
              <th className="px-3 py-2 text-center">P(Bx|A−)</th>
              <th className="px-3 py-2 text-center">ACV</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {analyses.map(ca => {
              const meta = CONDITION_META[ca.condition];
              const lc = { blue:'text-blue-700 dark:text-blue-300', green:'text-green-700 dark:text-green-300',
                orange:'text-orange-600 dark:text-orange-400', purple:'text-purple-700 dark:text-purple-300' }[meta.color];
              return (
                <tr key={ca.condition} className="bg-white dark:bg-gray-900">
                  <td className={`px-3 py-1.5 font-semibold ${lc}`}>{meta.label}</td>
                  <td className="px-3 py-1.5 text-center text-gray-700 dark:text-gray-200">{nullPct(ca.consequenceTable.pBxGivenCPlus)}</td>
                  <td className="px-3 py-1.5 text-center text-gray-700 dark:text-gray-200">{nullPct(ca.consequenceTable.pBxGivenCMinus)}</td>
                  <td className={`px-3 py-1.5 text-center font-bold ${cvCls(ca.consequenceTable.cv)}`}>{nullPct(ca.consequenceTable.cv)}</td>
                  <td className="px-3 py-1.5 text-center text-gray-700 dark:text-gray-200">{nullPct(ca.antecedentTable.pBxGivenCPlus)}</td>
                  <td className="px-3 py-1.5 text-center text-gray-700 dark:text-gray-200">{nullPct(ca.antecedentTable.pBxGivenCMinus)}</td>
                  <td className={`px-3 py-1.5 text-center font-bold ${cvCls(ca.antecedentTable.cv)}`}>{nullPct(ca.antecedentTable.cv)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bar charts */}
      <BarChart title="PBR Comparison: Consequence P(Bx|C)"
        analyses={analyses}
        getPlus={ca => ca.consequenceTable.pBxGivenCPlus}
        getMinus={ca => ca.consequenceTable.pBxGivenCMinus}
        plusLabel="P(Bx|C+)" minusLabel="P(Bx|C−)" />
      <BarChart title="PBR Comparison: Antecedent P(Bx|A)"
        analyses={analyses}
        getPlus={ca => ca.antecedentTable.pBxGivenCPlus}
        getMinus={ca => ca.antecedentTable.pBxGivenCMinus}
        plusLabel="P(Bx|A+)" minusLabel="P(Bx|A−)" />
    </section>
  );
}

function BarChart({ title, analyses, getPlus, getMinus, plusLabel, minusLabel }: {
  title:string; analyses:ConditionAnalysis[];
  getPlus:(ca:ConditionAnalysis)=>number|null; getMinus:(ca:ConditionAnalysis)=>number|null;
  plusLabel:string; minusLabel:string;
}) {
  const CH=160, BW=28, GAP=8, GG=24, PL=36, PB=28, PT=16;
  const chartH = CH-PT-PB;
  const gW = BW*2+GAP;
  const totalW = PL + analyses.length*(gW+GG) - GG + 8;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-900">
      <p className="text-xs font-semibold text-center text-gray-700 dark:text-gray-200 mb-3">{title}</p>
      <div className="flex justify-center">
        <svg width={totalW} height={CH} className="overflow-visible">
          {[0,25,50,75,100].map(tick => {
            const y = PT + chartH - Math.round((tick/100)*chartH);
            return (
              <g key={tick}>
                <text x={PL-4} y={y+4} textAnchor="end" fontSize={9} fill="currentColor" className="text-gray-400">{tick}%</text>
                <line x1={PL} y1={y} x2={totalW-4} y2={y} stroke="currentColor" strokeWidth={0.5} strokeDasharray="2,2" className="text-gray-200 dark:text-gray-700" />
              </g>
            );
          })}
          {analyses.map((ca, i) => {
            const meta = CONDITION_META[ca.condition];
            const x = PL + i*(gW+GG);
            const plus = getPlus(ca); const minus = getMinus(ca);
            const pH = plus  !== null ? Math.round(plus  * chartH) : 0;
            const mH = minus !== null ? Math.round(minus * chartH) : 0;
            const baseY = PT + chartH;
            const lc = { blue:'text-blue-700 dark:text-blue-300', green:'text-green-700 dark:text-green-300',
              orange:'text-orange-600 dark:text-orange-400', purple:'text-purple-700 dark:text-purple-300' }[meta.color];
            return (
              <g key={ca.condition}>
                <rect x={x} y={baseY-pH} width={BW} height={Math.max(pH,1)} className="fill-blue-500" />
                {plus!==null && <text x={x+BW/2} y={plus===1 ? baseY-pH+9 : baseY-pH-2} textAnchor="middle" fontSize={8} fill={plus===1 ? "white" : "#374151"} fontWeight="600">{pct(plus)}</text>}
                <rect x={x+BW+GAP} y={baseY-mH} width={BW} height={Math.max(mH,1)} className="fill-red-400" />
                {minus!==null && <text x={x+BW+GAP+BW/2} y={minus===1 ? baseY-mH+9 : baseY-mH-2} textAnchor="middle" fontSize={8} fill={minus===1 ? "white" : "#374151"} fontWeight="600">{pct(minus)}</text>}
                <text x={x+gW/2} y={baseY+14} textAnchor="middle" fontSize={9} fill="currentColor" className={`font-medium ${lc}`}>{meta.label}</text>
              </g>
            );
          })}
          <line x1={PL} y1={PT+chartH} x2={totalW-4} y2={PT+chartH} stroke="currentColor" strokeWidth={1} className="text-gray-300 dark:text-gray-600" />
        </svg>
      </div>
      <div className="flex justify-center gap-5 mt-2">
        <LegItem color="bg-blue-500" label={plusLabel} />
        <LegItem color="bg-red-400"  label={minusLabel} />
      </div>
    </div>
  );
}

function LegItem({ color, label }: { color:string; label:string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
      <span className={`w-3 h-3 rounded-sm ${color}`} />{label}
    </div>
  );
}

// ─── Behavior rate/frequency table ────────────────────────────────────────────

interface RateRow {
  label:      string;
  total:      number;
  scored:     number;
  bxCount:    number;
  csCount:    number;
  obsTimeSec: number; // elapsed timer OR intervalCount × intervalDurationSeconds
  timerBased: boolean; // true if from live timer (vs. computed estimate)
}

/** Returns observed time in seconds: live timer if recorded, otherwise intervalCount × duration (default 10s). */
function sessionObsTimeSecs(s: Session): number {
  if (s.elapsedSeconds && s.elapsedSeconds > 0) return s.elapsedSeconds;
  return s.intervalCount * (s.intervalDurationSeconds ?? 10);
}

function BehaviorRateTable({ assessment, exportScope }: { assessment: Assessment; exportScope: ExportScope }) {
  const rows: RateRow[] = [];

  if (exportScope !== 'synthesized') {
    ALL_CONDITIONS.forEach(c => {
      const s = assessment.separateSessions[c];
      if (!s) return;
      const { total, scored, behaviorCount, csCount } = sessionProgress(s);
      const timerBased = (s.elapsedSeconds ?? 0) > 0;
      rows.push({ label: CONDITION_META[c].label, total, scored, bxCount: behaviorCount, csCount,
        obsTimeSec: sessionObsTimeSecs(s), timerBased });
    });
  }

  if (exportScope !== 'separate') {
    assessment.synthesizedSessions.forEach((s, i) => {
      const { total, scored, behaviorCount, csCount } = sessionProgress(s);
      const timerBased = (s.elapsedSeconds ?? 0) > 0;
      rows.push({ label: `Synthesized Run ${i + 1}`, total, scored, bxCount: behaviorCount, csCount,
        obsTimeSec: sessionObsTimeSecs(s), timerBased });
    });
  }

  if (rows.length === 0) return null;

  const totTotal   = rows.reduce((a, r) => a + r.total,      0);
  const totScored  = rows.reduce((a, r) => a + r.scored,     0);
  const totBx      = rows.reduce((a, r) => a + r.bxCount,    0);
  const totCS      = rows.reduce((a, r) => a + r.csCount,    0);
  const totSec     = rows.reduce((a, r) => a + r.obsTimeSec, 0);
  const anyTimer   = rows.some(r => r.timerBased);

  function perMin(bx: number, sec: number) {
    if (sec <= 0) return '';
    return (bx / (sec / 60)).toFixed(2);
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden text-xs">
      <div className="bg-gray-700 text-white px-3 py-1.5">
        <p className="font-bold uppercase tracking-wide text-xs">Behavior Frequency &amp; Rate by Condition</p>
      </div>
      {!anyTimer && (
        <p className="px-3 py-1 text-xs text-gray-400 dark:text-gray-500 italic bg-gray-50 dark:bg-gray-800/50">
          Obs. time estimated from interval count × duration (no timer data recorded)
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-100 dark:bg-gray-800">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium text-gray-600 dark:text-gray-300">Condition</th>
              <th className="px-3 py-1.5 text-center font-medium text-gray-600 dark:text-gray-300">Intervals</th>
              <th className="px-3 py-1.5 text-center font-medium text-gray-600 dark:text-gray-300">Scored</th>
              <th className="px-3 py-1.5 text-center font-medium text-gray-600 dark:text-gray-300">Excluded</th>
              <th className="px-3 py-1.5 text-center font-medium text-gray-600 dark:text-gray-300">Bx Count</th>
              <th className="px-3 py-1.5 text-center font-medium text-gray-600 dark:text-gray-300">Obs. Time</th>
              <th className="px-3 py-1.5 text-center font-medium text-gray-600 dark:text-gray-300">Bx/min</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map(r => (
              <tr key={r.label} className="bg-white dark:bg-gray-900">
                <td className="px-3 py-1.5 font-medium text-gray-700 dark:text-gray-200">{r.label}</td>
                <td className="px-3 py-1.5 text-center">{r.total}</td>
                <td className="px-3 py-1.5 text-center">{r.scored}</td>
                <td className="px-3 py-1.5 text-center text-gray-400">{r.csCount}</td>
                <td className="px-3 py-1.5 text-center font-semibold">{r.bxCount}</td>
                <td className="px-3 py-1.5 text-center text-gray-500">{fmtDur(r.obsTimeSec)}</td>
                <td className="px-3 py-1.5 text-center font-semibold">{perMin(r.bxCount, r.obsTimeSec)}</td>
              </tr>
            ))}
            <tr className="bg-gray-50 dark:bg-gray-800 font-semibold border-t-2 border-gray-300 dark:border-gray-600">
              <td className="px-3 py-1.5 text-gray-800 dark:text-gray-100">Total</td>
              <td className="px-3 py-1.5 text-center">{totTotal}</td>
              <td className="px-3 py-1.5 text-center">{totScored}</td>
              <td className="px-3 py-1.5 text-center text-gray-400">{totCS}</td>
              <td className="px-3 py-1.5 text-center">{totBx}</td>
              <td className="px-3 py-1.5 text-center">{fmtDur(totSec)}</td>
              <td className="px-3 py-1.5 text-center">{perMin(totBx, totSec)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmtDur(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

function LagToggle({ label, value, onChange, hint }: {
  label:string; value:boolean; onChange:(v:boolean)=>void; hint:string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button type="button" onClick={() => onChange(!value)}
        className={`w-8 h-4 rounded-full transition-colors relative ${value?'bg-yellow-500':'bg-gray-300 dark:bg-gray-600'}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all shadow ${value ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
      <span className="text-xs text-yellow-800 dark:text-yellow-300">
        <strong>{label}:</strong> {value?'Y':'N'}
        <span className="text-gray-500 dark:text-gray-400 ml-1">({hint})</span>
      </span>
    </label>
  );
}

function pct(v:number):string { return `${(v*100).toFixed(1)}%`; }
function nullPct(v:number|null):string { return v!==null?pct(v):''; }
function cvCls(v:number|null):string {
  if(v===null)return'text-gray-400';
  if(v>0)return'text-emerald-700 dark:text-emerald-400';
  if(v<0)return'text-red-600 dark:text-red-400';
  return'text-gray-600 dark:text-gray-300';
}
