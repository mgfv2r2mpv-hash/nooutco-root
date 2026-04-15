import type { Assessment, ConditionType } from '../types';
import { ALL_CONDITIONS, CONDITION_META } from '../types';
import { sessionProgress } from '../utils/assessmentHelpers';
import type { SessionKey } from '../App';
import { AboutCPR } from './AboutCPR';

interface Props {
  assessment:         Assessment;
  onEditHeader:       () => void;
  onStartSession:     (key: SessionKey) => void;
  onOpenSession:      (key: SessionKey, target: 'data-entry' | 'review' | 'analysis') => void;
  onAnalyze:          () => void;
  onClearCondition:   (c: ConditionType) => void;
  onDeleteSynthRun:   (index: number) => void;
  onClearSynthRun:    (index: number) => void;
}

export function AssessmentDetail({ assessment: a, onEditHeader, onStartSession, onOpenSession, onAnalyze, onClearCondition, onDeleteSynthRun, onClearSynthRun }: Props) {
  const hasAnyData =
    Object.keys(a.separateSessions).length > 0 || a.synthesizedSessions.length > 0;

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100">{a.clientName}</h1>
            {a.targetBehaviorName && (
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{a.targetBehaviorName}</p>
            )}
            <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">{a.targetBehaviorDefinition}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-400 dark:text-gray-500">
              {a.observer    && <span>Observer: {a.observer}</span>}
              {a.setting     && <span>Setting: {a.setting}</span>}
              <span>Date: {a.date}</span>
              {a.startEndTime && <span>Time: {a.startEndTime}</span>}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={onEditHeader} className="btn btn-secondary text-xs">Edit</button>
            <button onClick={onAnalyze} disabled={!hasAnyData}
              className="btn btn-primary text-xs disabled:opacity-40">
              Full analysis
            </button>
          </div>
        </div>
      </div>

      {/* ── Separate conditions ── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          Separate conditions
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ALL_CONDITIONS.map(c => (
            <ConditionSlot
              key={c}
              condition={c}
              session={a.separateSessions[c] ?? null}
              onStart={() => onStartSession({ type: 'separate', condition: c })}
              onEdit={() => onStartSession({ type: 'separate', condition: c })}
              onContinue={() => onOpenSession({ type: 'separate', condition: c }, 'data-entry')}
              onReview={() => onOpenSession({ type: 'separate', condition: c }, 'review')}
              onClear={() => {
                if (confirm(`Clear all interval data for ${CONDITION_META[c].label}? Session settings will be kept.`))
                  onClearCondition(c);
              }}
            />
          ))}
        </div>
      </section>

      {/* ── Synthesized runs ── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
            Synthesized runs
          </h2>
          <button
            onClick={() => onStartSession({ type: 'synthesized', index: a.synthesizedSessions.length })}
            className="btn btn-secondary text-xs">
            + Add run
          </button>
        </div>
        {a.synthesizedSessions.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">No synthesized runs yet.</p>
        ) : (
          <div className="space-y-2">
            {a.synthesizedSessions.map((s, i) => {
              const { scored, total } = sessionProgress(s);
              const pct = total > 0 ? Math.round((scored / total) * 100) : 0;
              const synthConds = s.synthesizedConditions ?? ALL_CONDITIONS;
              const condLabel = synthConds.map(c => CONDITION_META[c].label).join(' + ');
              const canDelete = a.synthesizedSessions.length > 1;
              return (
                <div key={s.id}
                  className="bg-white dark:bg-gray-900 rounded-xl border border-indigo-200 dark:border-indigo-800 px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                      Synthesized Run {i + 1}
                      <span className="ml-2 text-xs font-normal text-indigo-500 dark:text-indigo-400">({condLabel})</span>
                    </p>
                    {s.conditionNote && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{s.conditionNote}</p>
                    )}
                    <ProgressMini scored={scored} total={total} pct={pct} />
                  </div>
                  <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                    <button onClick={() => onStartSession({ type: 'synthesized', index: i })}
                      className="btn btn-secondary text-xs py-1">Edit</button>
                    <button onClick={() => onOpenSession({ type: 'synthesized', index: i }, 'data-entry')}
                      className="btn btn-secondary text-xs py-1">Continue</button>
                    <button onClick={() => onOpenSession({ type: 'synthesized', index: i }, 'review')}
                      className="btn btn-secondary text-xs py-1">Review</button>
                    {canDelete ? (
                      <button onClick={() => {
                        if (confirm(`Delete Synthesized Run ${i + 1}? This cannot be undone.`))
                          onDeleteSynthRun(i);
                      }} className="text-xs px-2 py-1 rounded border border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30">
                        Delete
                      </button>
                    ) : (
                      <button onClick={() => {
                        if (confirm('Clear all interval data for this run? Session settings will be kept.'))
                          onClearSynthRun(i);
                      }} className="text-xs px-2 py-1 rounded border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30">
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── About CPR ── */}
      <AboutCPR />
    </div>
  );
}

// ─── Condition slot ───────────────────────────────────────────────────────────

function ConditionSlot({ condition, session, onStart, onEdit, onContinue, onReview, onClear }: {
  condition:  ConditionType;
  session:    ReturnType<typeof Object.values>[0] | null;
  onStart:    () => void;
  onEdit:     () => void;
  onContinue: () => void;
  onReview:   () => void;
  onClear:    () => void;
}) {
  const meta = CONDITION_META[condition];
  const borderColor = {
    blue:   'border-blue-200 dark:border-blue-800',
    green:  'border-green-200 dark:border-green-800',
    orange: 'border-orange-200 dark:border-orange-800',
    purple: 'border-purple-200 dark:border-purple-800',
  }[meta.color];
  const labelColor = {
    blue:   'text-blue-700 dark:text-blue-300',
    green:  'text-green-700 dark:text-green-300',
    orange: 'text-orange-600 dark:text-orange-400',
    purple: 'text-purple-700 dark:text-purple-300',
  }[meta.color];

  if (!session) {
    return (
      <div className={`rounded-xl border border-dashed ${borderColor} px-4 py-4 flex items-center justify-between`}>
        <div>
          <p className={`text-sm font-semibold ${labelColor}`}>{meta.label}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Not started</p>
        </div>
        <button onClick={onStart} className="btn btn-primary text-xs py-1">Start</button>
      </div>
    );
  }

  const { scored, total, behaviorCount } = sessionProgress(session);
  const pct  = total > 0 ? Math.round((scored / total) * 100) : 0;
  const rate = scored > 0 ? Math.round((behaviorCount / scored) * 100) : 0;

  return (
    <div className={`rounded-xl border ${borderColor} bg-white dark:bg-gray-900 px-4 py-3 space-y-2`}>
      <div className="flex items-center justify-between">
        <p className={`text-sm font-semibold ${labelColor}`}>{meta.label}</p>
        <div className="flex gap-1.5 flex-wrap justify-end">
          <button onClick={onEdit}     className="btn btn-secondary text-xs py-1">Edit</button>
          <button onClick={onContinue} className="btn btn-secondary text-xs py-1">Continue</button>
          <button onClick={onReview}   className="btn btn-secondary text-xs py-1">Review</button>
          <button onClick={onClear}
            className="text-xs px-2 py-1 rounded border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30">
            Clear
          </button>
        </div>
      </div>
      {session.conditionNote && (
        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 italic">{session.conditionNote}</p>
      )}
      <ProgressMini scored={scored} total={total} pct={pct} />
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Behavior rate: {behaviorCount}/{scored} = {rate}%
      </p>
    </div>
  );
}

function ProgressMini({ scored, total, pct }: { scored: number; total: number; pct: number }) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
        <span>{scored}/{total} scored</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
        <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
