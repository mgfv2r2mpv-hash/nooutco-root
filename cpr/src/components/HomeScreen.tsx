import { useRef } from 'react';
import type { Assessment } from '../types';
import { ALL_CONDITIONS, CONDITION_META } from '../types';
import { sessionProgress } from '../utils/assessmentHelpers';
import { importAssessmentFromExcel } from '../utils/excelImport';
import { exportBlankTemplate } from '../utils/excelExport';
import { AboutCPR } from './AboutCPR';

interface Props {
  assessments: Assessment[];
  onOpen:      (id: string) => void;
  onNew:       () => void;
  onDelete:    (id: string) => Promise<void>;
  onImported:  (a: Assessment) => Promise<void>;
}

export function HomeScreen({ assessments, onOpen, onNew, onDelete, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const assessment = await importAssessmentFromExcel(file);
      await onImported(assessment);
    } catch (err) {
      alert(`Could not import file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Assessments</h1>
        <div className="flex gap-2">
          <button onClick={() => exportBlankTemplate()} className="btn btn-secondary text-xs">
            Download Template
          </button>
          <button onClick={() => fileRef.current?.click()} className="btn btn-secondary text-xs">
            Import Excel
          </button>
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={handleImport} />
          <button onClick={onNew} className="btn btn-primary">+ New assessment</button>
        </div>
      </div>

      {assessments.length === 0 ? (
        <EmptyState onNew={onNew} onImport={() => fileRef.current?.click()} />
      ) : (
        <ul className="space-y-2">
          {assessments.map(a => (
            <AssessmentCard key={a.id} assessment={a} onOpen={() => onOpen(a.id)}
              onDelete={() => {
                if (confirm(`Delete this assessment? This cannot be undone.`))
                  void onDelete(a.id);
              }} />
          ))}
        </ul>
      )}

      <AboutCPR />
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onNew, onImport }: { onNew: () => void; onImport: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 space-y-5">
      <div className="text-center space-y-2">
        <p className="text-2xl">📋</p>
        <p className="text-base font-semibold text-gray-700 dark:text-gray-300">No assessments yet</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
          Use this tool to collect and analyze systematic descriptive assessment data using
          conditional probability, tracking behavior co-occurrence with EOs and consequences
          across conditions.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button onClick={onNew} className="btn btn-primary">
          + Start a new assessment
        </button>
        <button onClick={onImport} className="btn btn-secondary">
          Import existing Excel file
        </button>
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: '1', label: 'Configure', desc: 'Set up behavior, conditions, and session settings' },
          { icon: '2', label: 'Collect', desc: 'Score intervals live or load a previously scored spreadsheet' },
          { icon: '3', label: 'Analyze', desc: 'Review contingency tables, probabilities, and export results' },
        ].map(step => (
          <div key={step.icon} className="flex gap-3 items-start">
            <span className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-xs font-bold shrink-0">
              {step.icon}
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{step.label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{step.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Assessment card ───────────────────────────────────────────────────────────

function AssessmentCard({ assessment: a, onOpen, onDelete }: {
  assessment: Assessment; onOpen: () => void; onDelete: () => void;
}) {
  const synthCount = a.synthesizedSessions.length;

  // Total elapsed seconds across all sessions in this assessment
  const totalSecs = [
    ...Object.values(a.separateSessions),
    ...a.synthesizedSessions,
  ].reduce((sum, s) => sum + (s?.elapsedSeconds ?? 0), 0);

  function fmtDuration(sec: number) {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }

  return (
    <li className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3 flex items-start gap-3">
      <button onClick={onOpen} className="flex-1 text-left min-w-0 space-y-1.5">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs text-gray-400 dark:text-gray-500">{a.date}</span>
          {a.observer && <span className="text-xs text-gray-400 dark:text-gray-500">· {a.observer}</span>}
          {totalSecs > 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500">· {fmtDuration(totalSecs)} recorded</span>
          )}
        </div>
        <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm line-clamp-1">
          {a.targetBehaviorName || a.targetBehaviorDefinition || 'Untitled behavior'}
        </p>
        {a.targetBehaviorDefinition && a.targetBehaviorName && (
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{a.targetBehaviorDefinition}</p>
        )}

        {/* Condition progress chips */}
        <div className="flex flex-wrap gap-1.5">
          {ALL_CONDITIONS.map(c => {
            const session = a.separateSessions[c];
            const meta    = CONDITION_META[c];
            if (!session) {
              return (
                <span key={c} className="px-2 py-0.5 rounded-full text-xs border border-dashed border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500">
                  {meta.label}
                </span>
              );
            }
            const { scored, total } = sessionProgress(session);
            const pct = total > 0 ? Math.round((scored / total) * 100) : 0;
            return (
              <span key={c} className={`px-2 py-0.5 rounded-full text-xs font-medium border ${conditionChipClass(meta.color)}`}>
                {meta.label} {pct}%
              </span>
            );
          })}
          {synthCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300">
              Synthesized ×{synthCount}
            </span>
          )}
        </div>
      </button>

      <button onClick={onDelete}
        className="text-red-400 hover:text-red-600 dark:hover:text-red-300 shrink-0 mt-1 p-1"
        aria-label="Delete"
        title="Delete">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
        </svg>
      </button>
    </li>
  );
}

function conditionChipClass(color: 'blue'|'green'|'orange'|'purple'): string {
  return {
    blue:   'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/20',
    green:  'border-green-300 dark:border-green-700 text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950/20',
    orange: 'border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/20',
    purple: 'border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/20',
  }[color];
}
