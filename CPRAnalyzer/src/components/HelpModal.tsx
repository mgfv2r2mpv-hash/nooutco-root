/**
 * HelpModal — tabbed panel with tutorial, conceptual background, and keyboard reference.
 * The "Print Manual" button triggers a print-only stylesheet that shows only modal content
 * + 3 blank Notes pages appended.
 */
import { useState, useEffect, useRef } from 'react';

interface Props { onClose: () => void; }

type Tab = 'quickstart' | 'concepts' | 'keyboard';

export function HelpModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('quickstart');
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Close on backdrop click
  function handleBackdrop(e: React.MouseEvent) {
    if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
  }

  function handlePrint() {
    // Add a temporary print class to body so CSS can show only the modal content
    document.body.classList.add('printing-manual');
    window.print();
    document.body.classList.remove('printing-manual');
  }

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
      tab === t
        ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/20'
        : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
    }`;

  return (
    <>
      {/* Print-only styles injected inline */}
      <style>{`
        @media print {
          body:not(.printing-manual) .help-modal-root { display: none !important; }
          body.printing-manual *:not(.help-modal-print-content):not(.help-modal-print-content *) { display: none !important; }
          body.printing-manual .help-modal-print-content { display: block !important; position: static !important; overflow: visible !important; }
          body.printing-manual .help-modal-notes-page { page-break-before: always; min-height: 25cm; border: 1px solid #ccc; padding: 2rem; }
          body.printing-manual .no-print-in-manual { display: none !important; }
        }
      `}</style>

      {/* Backdrop */}
      <div
        className="help-modal-root fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={handleBackdrop}
      >
        <div
          ref={panelRef}
          className="help-modal-print-content bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              Help &amp; User Guide
            </h2>
            <div className="flex gap-2 no-print-in-manual">
              <button
                onClick={handlePrint}
                className="btn btn-secondary text-xs"
                title="Download a printable manual PDF with blank notes pages at the end"
              >
                Print Manual PDF
              </button>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none" aria-label="Close">✕</button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 px-6 pt-2 border-b border-gray-200 dark:border-gray-700 shrink-0 no-print-in-manual">
            <button className={tabClass('quickstart')} onClick={() => setTab('quickstart')}>Quick Start</button>
            <button className={tabClass('concepts')}   onClick={() => setTab('concepts')}>Conceptual Background</button>
            <button className={tabClass('keyboard')}   onClick={() => setTab('keyboard')}>Keyboard &amp; Tips</button>
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1 px-6 py-5 text-sm text-gray-700 dark:text-gray-300 space-y-4">
            {tab === 'quickstart' && <QuickStartTab />}
            {tab === 'concepts'   && <ConceptsTab />}
            {tab === 'keyboard'   && <KeyboardTab />}
          </div>
        </div>
      </div>

      {/* Print-only Notes pages (always in DOM, hidden on screen) */}
      <div className="help-manual-notes hidden">
        {[1, 2, 3].map(n => (
          <div key={n} className="help-modal-notes-page">
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem', borderBottom: '2px solid #ccc', paddingBottom: '0.5rem' }}>
              Notes — Page {n}
            </h2>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Quick Start tab ──────────────────────────────────────────────────────────

function QuickStartTab() {
  return (
    <div className="space-y-5">
      <p className="text-gray-500 dark:text-gray-400 italic">
        A step-by-step walkthrough from opening the tool to downloading your results.
      </p>

      <Section n="1" title="Create a new assessment">
        <p>Click <strong>+ New assessment</strong> on the home screen. Fill in the assessment header: observer name, setting, date, and the target behavior name and operational definition. None of these fields are required to proceed, but they appear on all output files.</p>
        <p>Click <strong>Save &amp; continue</strong> to go to the assessment dashboard.</p>
      </Section>

      <Section n="2" title="Configure conditions">
        <p>From the assessment dashboard, click <strong>+ Add condition</strong> (or the condition card if already configured) to open the session setup form. Choose:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Session type</strong>: Separate (one condition per session) or Synthesized (all selected conditions present simultaneously)</li>
          <li><strong>Condition</strong>: Attention, Escape, Tangible, or Sensory</li>
          <li><strong>Number of intervals</strong>: how many partial intervals to collect</li>
          <li><strong>Interval duration</strong>: length in seconds (commonly 10s or 15s)</li>
          <li><strong>Interview-indicated functions</strong>: consequences you expect to be functional (from your IISCA or indirect assessment). These move to the left side of the data entry row for faster access during scoring.</li>
        </ul>
        <p>For synthesized sessions, also select which conditions&apos; EOs should be active simultaneously.</p>
      </Section>

      <Section n="3" title="Enter interval data">
        <p>After saving the session, you land on the <strong>data entry screen</strong>. Each row is one partial interval.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Tap the <strong>green play button</strong> to start the pace timer. A yellow badge shows the current target interval based on elapsed time ÷ interval duration, scrolling automatically.</li>
          <li>For each interval: mark <strong>Bx</strong> (behavior occurred?), <strong>EO</strong> (motivating condition present?), and each <strong>consequence</strong> type observed.</li>
          <li>Use <strong>Y / N / C</strong> to cycle toggles (Y = yes, N = no, C = Could Not Score).</li>
          <li>Tap the pencil icon on any row to add an interval note.</li>
          <li>The progress bar fills blue for scored intervals; gray for Could Not Score intervals.</li>
          <li>A <strong>Saved ✓</strong> flash confirms each interval is persisted to your browser.</li>
        </ul>
        <Callout>
          The pace arrow is a guide, not a strict requirement. If you fall behind, stop the timer and catch up before resuming.
        </Callout>
      </Section>

      <Section n="4" title="Review your data">
        <p>Click <strong>Review</strong> to open the review screen. This shows raw cell counts (no probabilities) so you can verify data quality before analysis:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Intervals where behavior, EO, <em>and</em> all consequences are Could Not Score are flagged; these contribute nothing to the analysis and may indicate a scoring interruption.</li>
          <li>Counts only (no probabilities) are shown intentionally, to avoid anchoring your data quality judgment on preliminary results before you decide if more data is needed.</li>
        </ul>
        <p>Click <strong>Proceed to analysis</strong> when satisfied, or <strong>Back</strong> to continue scoring.</p>
      </Section>

      <Section n="5" title="Analyze results">
        <p>The analysis screen shows contingency tables and conditional probabilities for each condition. Toggle LAG-1 for antecedent and/or consequence scoring (see Conceptual Background). Use the export buttons to download your results.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Export PDF</strong>: prints the full analysis with a summary page. Use your browser&apos;s print-to-PDF. Check &quot;Print backgrounds&quot; for best formatting.</li>
          <li><strong>Export Excel</strong>: downloads a workbook with raw data sheets, a probability calculator sheet with COUNTIFS formulas, and embedded bar charts.</li>
          <li>Use the scope dropdown to filter output to Separate only or Synthesized only.</li>
        </ul>
      </Section>

      <Section n="6" title="Working with Excel files">
        <p><strong>Download Template:</strong> from the home screen, download a blank CPR template and fill it in manually (e.g., from paper scoring). Use Y / N / C in each cell.</p>
        <p><strong>Load Excel:</strong> import a previously exported or manually completed CPR spreadsheet. The tool reconstructs the assessment so you can review or re-analyze. If the Time column contains timestamps, session duration is estimated automatically.</p>
        <Callout>
          Data is stored in your browser&apos;s localStorage. It is <strong>device-specific</strong>; it does not sync across computers. Always export your Excel file before closing or switching devices.
        </Callout>
      </Section>

      <Section n="7" title="Starting over or clearing data">
        <p>Use the <strong>Clear</strong> button on any condition card to reset that condition&apos;s interval data while keeping session settings. The timer resets to zero.</p>
        <p>Use <strong>Clear Assessment</strong> (top-right nav) to wipe all saved assessments from the browser and start fresh. This cannot be undone.</p>
      </Section>
    </div>
  );
}

// ─── Concepts tab ─────────────────────────────────────────────────────────────

function ConceptsTab() {
  return (
    <div className="space-y-5">
      <p className="text-gray-500 dark:text-gray-400 italic">
        Methodological and statistical background for the BCBA conducting or supervising the assessment.
      </p>

      <Section title="SDA vs. FBA vs. ABC data collection">
        <p>A <strong>Systematic Descriptive Assessment (SDA)</strong> is an observational procedure; the assessor does not manipulate antecedents or consequences. This contrasts with an experimental functional analysis (FA/EFA), which involves controlled condition comparisons with programmed contingencies.</p>
        <p>Compared to traditional narrative ABC data, SDA introduces <strong>structure and quantification</strong>: partial interval recording across fixed time windows, with all four possible consequence types recorded simultaneously in every interval. This eliminates the observer-selection bias inherent in event-based ABC, where the observer typically records only consequences they deem relevant.</p>
        <p>The result is a complete co-occurrence record that can be analyzed probabilistically, enabling a transition from subjective narrative to empirical conditional probabilities.</p>
      </Section>

      <Section title="Interview-informed assessment (IISCA rationale)">
        <p>Rather than starting from a blank hypothesis, this tool supports an <strong>interview-informed</strong> approach (Hanley et al., 2014). Informed by an open-ended functional assessment interview (e.g., IISCA), the assessor identifies the most likely reinforcers <em>before</em> observation begins and flags them as &quot;indicated functions&quot; in the session setup.</p>
        <p>These indicated consequences appear on the <strong>left</strong> side of each interval row, enabling faster scoring during live observation; they are also reflected in the output so reviewers understand the assessor&apos;s a priori hypothesis.</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Reference: Hanley, G. P., Jin, C. S., Vanselow, N. R., &amp; Hanratty, L. A. (2014). Producing meaningful improvements in problem behavior of children with autism via synthesized analyses and treatments. <em>Journal of Applied Behavior Analysis, 47</em>, 16–36.
        </p>
      </Section>

      <Section title="EO contriving and condition density">
        <p>The <strong>Establishing Operation (EO)</strong> is the motivating condition that temporarily increases the value of a reinforcer and evokes behavior maintained by that reinforcer. Examples: attention deprivation (attention EO), prolonged demands (escape EO), denial of preferred item (tangible EO), unoccupied/alone time (sensory EO).</p>
        <p>In a <em>naturalistic</em> SDA, EOs are not contrived; you record their natural presence or absence. In a <em>semi-structured</em> SDA, the environment may be arranged to alternately produce EO-present and EO-absent epochs, increasing the probability of observing both states within a practical observation period.</p>
        <p><strong>Block density matters:</strong> If nearly all intervals have the EO present, P(Bx|A−) is based on a very small denominator and the Antecedent CV estimate will be unreliable. Aim for at least 20–25% EO-absent intervals for each condition when possible. The raw cell counts table on the Review screen helps you audit this before analysis.</p>
      </Section>

      <Section title="Interval length considerations">
        <p>Partial interval recording <strong>overestimates</strong> behavior rate relative to its true base rate; any occurrence in the interval, regardless of duration, counts. Longer intervals amplify this effect.</p>
        <p>For <strong>conditional probability analysis</strong>, interval length also affects co-occurrence detection: a 10-second interval captures more temporal proximity than a 5-second interval but introduces more noise around event boundaries. Literature recommendations (Vollmer et al., 2001; Camp et al., 2009) were developed around 10-second intervals in clinic settings. For longer intervals (15s+), each interval already spans a wider time window, so the Lag-1 correction can over-credit events in adjacent intervals; consider turning it off in those cases.</p>
        <p>Very short intervals (≤5s) may produce ceiling effects (high Bx+ rates regardless of condition), reducing CV sensitivity. A common practical choice is <strong>10s</strong> for clinic settings and <strong>15s</strong> for classroom or community contexts.</p>
      </Section>

      <Section title="Synthesized condition procedure">
        <p>A <strong>synthesized condition</strong> presents multiple EOs simultaneously; the assessor selects which conditions are active at the same time. This mirrors the real environment, where multiple motivating operations often co-occur (e.g., a child is placed in a demand context with limited adult attention and no preferred items).</p>
        <p>Because all selected EOs are present in every interval, there is a <strong>single merged EO column</strong> in the data entry screen; you score whether the combined EO context is present or absent, rather than scoring each EO individually. Consequences are still scored separately for all four functions.</p>
        <p>Synthesized conditions are analyzed independently in the output, not pooled with separate conditions. Multiple synthesized runs are supported (e.g., run 1 with Attention + Escape; run 2 adding Tangible).</p>
      </Section>

      <Section title="Lag-1 correction: mathematical basis">
        <p>Standard same-interval co-occurrence requires behavior and the antecedent or consequence to fall in the <em>same</em> interval n. This underestimates true associations when events straddle interval boundaries.</p>
        <p><strong>Antecedent Lag-1:</strong> An EO recorded in interval n−1 is treated as present in interval n. Formally:</p>
        <code className="block bg-gray-100 dark:bg-gray-800 rounded p-2 text-xs my-1 font-mono">
          EO_effective[n] = EO[n] OR EO[n−1]
        </code>
        <p>This reduces false negatives when the motivating operation immediately precedes the behavior interval.</p>
        <p><strong>Consequence Lag-1:</strong> A consequence recorded in interval n+1 is credited to behavior in interval n. Formally:</p>
        <code className="block bg-gray-100 dark:bg-gray-800 rounded p-2 text-xs my-1 font-mono">
          C_effective[n] = C[n] OR C[n+1]
        </code>
        <p>This accounts for natural delays in consequence delivery (e.g., a teacher notices and provides attention one interval after the behavior occurred).</p>
        <p>In the Excel export, Lag-1 is implemented via hidden helper columns that COUNTIFS references, keeping the visible formulas clean. On the analysis screen, you can toggle each independently.</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Based on procedures from: Camp, E. M., Iwata, B. A., Hammond, J. L., &amp; Bloom, S. E. (2009). Antecedent versus consequent events as predictors of problem behavior. <em>Journal of Applied Behavior Analysis, 42</em>, 601–616.
        </p>
      </Section>

      <Section title="Interpreting CV and ACV">
        <p>The <strong>Contingency Value (CV)</strong> is the difference in conditional probabilities:</p>
        <code className="block bg-gray-100 dark:bg-gray-800 rounded p-2 text-xs my-1 font-mono">
          CV = P(Bx | C+) − P(Bx | C−)
        </code>
        <p>The <strong>Antecedent CV (ACV)</strong> is the analogous measure for EO presence:</p>
        <code className="block bg-gray-100 dark:bg-gray-800 rounded p-2 text-xs my-1 font-mono">
          ACV = P(Bx | A+) − P(Bx | A−)
        </code>
        <p>Both range from −1 to +1. A positive value indicates that behavior is more likely when the relevant condition is present. Interpretation requires considering raw cell counts (especially denominator sizes), the number of intervals collected, and the overall base rate of behavior; clinical judgment is essential.</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          CV procedure from: Vollmer, T. R., Borrero, J. C., Wright, C. S., Van Camp, C., &amp; Lalli, J. S. (2001). Identifying possible contingencies during descriptive analyses of severe behavior disorders. <em>Journal of Applied Behavior Analysis, 34</em>, 269–287.
        </p>
      </Section>

      <Section title="Observation time and accountability">
        <p>The timer in the data entry screen tracks active observation time per session. This is summed across all conditions on the analysis screen and included in output files when available.</p>
        <p>Observation time matters for two reasons: (1) it anchors behavior rate (responses per minute), giving a meaningful metric for comparing conditions; and (2) it provides accountability. An assessment with only 5 minutes of observation across conditions yields conditional probability estimates with very wide margins of uncertainty compared to a 30-minute assessment. More intervals and longer observation windows produce more reliable estimates.</p>
      </Section>
    </div>
  );
}

// ─── Keyboard tab ─────────────────────────────────────────────────────────────

function KeyboardTab() {
  return (
    <div className="space-y-5">
      <p className="text-gray-500 dark:text-gray-400 italic">
        Keyboard shortcuts speed up live scoring, especially important when observing behavior in real time.
      </p>

      <Section title="Toggle shortcuts (when a toggle button is focused)">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100 dark:bg-gray-800 text-left">
              <th className="p-2 rounded-tl font-semibold">Key</th>
              <th className="p-2 rounded-tr font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {[
              ['Y / 1', 'Set toggle to Yes'],
              ['N / 2', 'Set toggle to No'],
              ['C / 3', 'Set toggle to Could Not Score'],
              ['Space / Enter', 'Cycle to next value (CS → Yes → No → CS)'],
              ['Tab', 'Move focus to the next toggle in the row'],
              ['Shift+Tab', 'Move focus to the previous toggle'],
            ].map(([k, v]) => (
              <tr key={k}>
                <td className="p-2 font-mono text-indigo-600 dark:text-indigo-400">{k}</td>
                <td className="p-2 text-gray-700 dark:text-gray-300">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Callout>
          Tab order within each interval row follows the visual layout: Bx → EO(s) → indicated consequences → non-indicated consequences → note button.
        </Callout>
      </Section>

      <Section title="Navigation shortcuts">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100 dark:bg-gray-800 text-left">
              <th className="p-2 font-semibold">Key</th>
              <th className="p-2 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {[
              ['Escape', 'Close any open modal or tooltip'],
              ['Tab (from last toggle in row)', 'Moves to first toggle in next row'],
            ].map(([k, v]) => (
              <tr key={k}>
                <td className="p-2 font-mono text-indigo-600 dark:text-indigo-400">{k}</td>
                <td className="p-2 text-gray-700 dark:text-gray-300">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Live scoring tips">
        <ul className="list-disc pl-5 space-y-2">
          <li>Start the timer <em>before</em> your first interval. The pace indicator shifts automatically so you always know which interval to be completing.</li>
          <li>If you miss an interval, leave it as Could Not Score (default) and keep pace; do not go back and fill it in retrospectively.</li>
          <li>For faster scoring, pre-assign indicated functions during session setup; they appear on the left, closest to your thumb on a touchscreen or to Tab-stop order on a keyboard.</li>
          <li>Use the note button (pencil icon) sparingly during live scoring. Mark the interval and add context notes afterward during the Review screen.</li>
          <li>If you need to pause, stop the timer. The accumulated time persists when you resume.</li>
          <li>The &quot;Saved ✓&quot; indicator confirms each change is written to localStorage. No manual save is required.</li>
        </ul>
      </Section>
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function Section({ n, title, children }: { n?: string; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        {n && (
          <span className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-bold shrink-0">
            {n}
          </span>
        )}
        {title}
      </h3>
      <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300 pl-1">
        {children}
      </div>
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
      {children}
    </div>
  );
}
