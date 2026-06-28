import { useState, useEffect, useRef, useCallback } from 'react';
import type { Assessment, Session, Interval } from '../types';
import type { SessionKey } from '../App';
import { ALL_CONDITIONS, CONDITION_META } from '../types';
import { sessionProgress } from '../utils/assessmentHelpers';
import { IntervalEntry } from './IntervalEntry';

interface Props {
  assessment:       Assessment;
  session:          Session;
  sessionKey:       SessionKey;
  onIntervalChange: (updated: Interval) => Promise<void>;
  onSaveSession:    (session: Session)  => Promise<void>;
  onGoReview:       () => void;
  onEditSession:    () => void;
}

/** Format seconds as M:SS or H:MM:SS */
function fmtTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function DataEntry({
  assessment, session, sessionKey,
  onIntervalChange, onSaveSession, onGoReview, onEditSession,
}: Props) {
  const { scored, total, behaviorCount, csCount } = sessionProgress(session);

  // ── Timer state ────────────────────────────────────────────────────────────
  const accumulatedRef  = useRef(session.elapsedSeconds ?? 0);
  const startedAtRef    = useRef<number | null>(null);
  const timerHandleRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const [timerRunning,  setTimerRunning]  = useState(false);
  const [displaySecs,   setDisplaySecs]   = useState(session.elapsedSeconds ?? 0);

  // Keep accumulatedRef in sync if session prop changes from outside (e.g. cleared)
  useEffect(() => {
    if (!timerRunning) {
      accumulatedRef.current = session.elapsedSeconds ?? 0;
      setDisplaySecs(session.elapsedSeconds ?? 0);
    }
  }, [session.elapsedSeconds, timerRunning]);

  // Save accumulated time on unmount if timer is still running
  useEffect(() => {
    return () => {
      if (timerHandleRef.current) clearInterval(timerHandleRef.current);
      if (startedAtRef.current !== null) {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
        const total   = accumulatedRef.current + elapsed;
        void onSaveSession({ ...session, elapsedSeconds: total });
      }
    };
    // intentionally only on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleStartStop() {
    if (!timerRunning) {
      startedAtRef.current = Date.now();
      timerHandleRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current!) / 1000);
        setDisplaySecs(accumulatedRef.current + elapsed);
      }, 500);
      setTimerRunning(true);
    } else {
      if (timerHandleRef.current) clearInterval(timerHandleRef.current);
      const elapsed         = Math.floor((Date.now() - startedAtRef.current!) / 1000);
      accumulatedRef.current += elapsed;
      startedAtRef.current   = null;
      setDisplaySecs(accumulatedRef.current);
      setTimerRunning(false);
      void onSaveSession({ ...session, elapsedSeconds: accumulatedRef.current });
    }
  }

  // ── Pace arrow ─────────────────────────────────────────────────────────────
  // Which interval number should the scorer be on right now?
  const timerEverStarted = displaySecs > 0 || timerRunning;
  const paceInterval = timerEverStarted
    ? Math.min(Math.floor(displaySecs / session.intervalDurationSeconds) + 1, session.intervalCount)
    : null;

  // Scroll pace interval into view
  useEffect(() => {
    if (paceInterval === null) return;
    const el = document.querySelector<HTMLElement>(`[data-interval-num="${paceInterval}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [paceInterval]);

  // ── Auto-save toast ────────────────────────────────────────────────────────
  const [saveFlash, setSaveFlash] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleIntervalChange = useCallback(async (iv: Interval) => {
    await onIntervalChange(iv);
    setSaveFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setSaveFlash(false), 1800);
  }, [onIntervalChange]);

  // ── Progress bar ───────────────────────────────────────────────────────────
  const validPct  = total > 0 ? (scored  / total) * 100 : 0;
  const csPct     = total > 0 ? (csCount / total) * 100 : 0;
  const rate       = scored > 0 ? Math.round((behaviorCount / scored) * 100) : 0;

  // ── Labels ─────────────────────────────────────────────────────────────────
  const condLabel = session.sessionType === 'synthesized'
    ? `Synthesized Run ${sessionKey.type === 'synthesized' ? sessionKey.index + 1 : ''}`
    : session.condition ? CONDITION_META[session.condition].label : '';

  const allScored = scored === total && total > 0;

  return (
    <div className="space-y-3">
      {/* ── Session header (sticky) ── */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5 min-w-0">
            <p className="font-semibold text-gray-800 dark:text-gray-100 truncate">
              {assessment.targetBehaviorName || assessment.targetBehaviorDefinition}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {condLabel} · {session.intervalDurationSeconds}s partial interval recording
            </p>
            {session.conditionNote && (
              <p className="text-xs text-gray-400 dark:text-gray-500 italic line-clamp-1">
                {session.conditionNote}
              </p>
            )}
          </div>
          <div className="flex gap-1.5 shrink-0 items-start">
            <button onClick={onEditSession} className="btn btn-secondary text-xs py-1">Edit</button>
            <button onClick={onGoReview}    className="btn btn-secondary text-xs py-1">Review</button>
          </div>
        </div>

        {/* Timer row */}
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={handleStartStop}
            title={timerRunning ? 'Stop timer' : 'Start timer'}
            aria-label={timerRunning ? 'Stop timer' : 'Start timer'}
            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 transition-colors
              ${timerRunning
                ? 'border-red-400 bg-red-50 dark:bg-red-950/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30'
                : 'border-green-500 bg-green-50 dark:bg-green-950/20 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30'}`}
          >
            {timerRunning
              ? /* Stop icon — filled square */
                <svg viewBox="0 0 12 12" className="w-3 h-3 fill-current"><rect x="2" y="2" width="8" height="8" rx="1"/></svg>
              : /* Play icon — triangle */
                <svg viewBox="0 0 12 12" className="w-3 h-3 fill-current"><polygon points="3,2 10,6 3,10"/></svg>
            }
          </button>
          <span className={`font-mono text-sm tabular-nums ${timerRunning ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'}`}>
            {fmtTime(displaySecs)}
          </span>
          {paceInterval !== null && (
            <span className="text-xs text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/20 px-2 py-0.5 rounded-full border border-yellow-200 dark:border-yellow-700">
              Pace → interval {paceInterval}
            </span>
          )}
          {/* Auto-save toast */}
          <span className={`ml-auto text-xs text-green-600 dark:text-green-400 transition-opacity duration-500 ${saveFlash ? 'opacity-100' : 'opacity-0'}`}>
            Saved ✓
          </span>
        </div>

        {/* Progress bar — blue for scored, gray for CS, empty for unstarted */}
        <div className="mt-2 space-y-1">
          <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
            <span>{scored}/{total} scored ({Math.round(validPct)}%){csCount > 0 ? `, ${csCount} excluded` : ''}</span>
            <span>Bx rate: {behaviorCount}/{scored} = {rate}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden flex">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${validPct}%` }} />
            <div className="h-full bg-gray-300 dark:bg-gray-600 transition-all" style={{ width: `${csPct}%` }} />
          </div>
        </div>

        {/* Column header */}
        <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
          <IntervalColumnHeader session={session} />
        </div>
      </div>

      {/* ── Interval list ── */}
      <div className="space-y-1">
        {session.intervals.map(iv => (
          <div key={iv.id} data-interval-num={iv.intervalNumber}>
            <IntervalEntry
              interval={iv}
              session={session}
              onChange={iv => void handleIntervalChange(iv)}
              isCurrent={paceInterval === iv.intervalNumber}
            />
          </div>
        ))}
      </div>

      {/* ── What's next nudge ── */}
      {allScored && (
        <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 p-4 flex items-start gap-3">
          <span className="text-green-600 dark:text-green-400 text-lg leading-none">✓</span>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-green-800 dark:text-green-300">All intervals scored</p>
            <p className="text-xs text-green-700 dark:text-green-400">
              Review your data before moving on. It&apos;s the last chance to catch entry errors before
              the contingency tables are calculated. When ready, proceed to analysis.
            </p>
            <div className="flex gap-2 mt-2">
              <button onClick={onGoReview} className="btn btn-secondary text-xs py-1">Review data</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Column header matching IntervalEntry layout ───────────────────────────────

function condLabelClass(color: 'blue'|'green'|'orange'|'purple'): string {
  return { blue:'text-blue-700 dark:text-blue-300', green:'text-green-700 dark:text-green-300',
    orange:'text-orange-700 dark:text-orange-300', purple:'text-purple-700 dark:text-purple-300' }[color];
}

const EO_SHORT: Record<string, string> = {
  attention: 'Att-EO', escape: 'Esc-EO', tangible: 'Tang-EO', sensory: 'Sens-EO' };
const C_SHORT: Record<string, string> = {
  attention: 'Att-C+', escape: 'Esc-C+', tangible: 'Tang-C+', sensory: 'Sens-C+' };

function IntervalColumnHeader({ session }: { session: Session }) {
  const isSynth = session.sessionType === 'synthesized';
  const synthConds = session.synthesizedConditions ?? ALL_CONDITIONS;
  const activeEOConditions = isSynth ? synthConds : (session.condition ? [session.condition] : []);
  const indicated    = session.indicatedFunctions;
  const nonIndicated = ALL_CONDITIONS.filter(c => !indicated.includes(c));

  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs font-semibold text-gray-500 dark:text-gray-400
      bg-gray-100 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <span className="w-6 shrink-0 text-center">#</span>
      <span className="w-14 shrink-0 text-center text-gray-400 dark:text-gray-500">time</span>
      <span className="w-20 shrink-0 text-center">Bx</span>
      <span className="w-0.5 mx-1.5 shrink-0" />
      {isSynth ? (
        <span className="w-16 shrink-0 text-center" title={synthConds.map(c => CONDITION_META[c].eoLabel).join(' + ')}>
          EO
        </span>
      ) : (
        activeEOConditions.map(c => (
          <span key={c} className={`w-16 shrink-0 text-center ${condLabelClass(CONDITION_META[c].color)}`}
            title={CONDITION_META[c].eoLabel}>
            {EO_SHORT[c]}
          </span>
        ))
      )}
      <span className="w-0.5 mx-1.5 shrink-0" />
      {isSynth ? (
        /* Synthesized: all 4 consequences, indicated left / non-indicated right */
        <>
          {indicated.map(c => (
            <span key={c} className={`w-16 shrink-0 text-center ${condLabelClass(CONDITION_META[c].color)}`}
              title={CONDITION_META[c].cLabel}>
              {C_SHORT[c]}
            </span>
          ))}
          {nonIndicated.length > 0 && indicated.length > 0 && <span className="w-0.5 mx-1.5 shrink-0" />}
          {nonIndicated.map(c => (
            <span key={c} className={`w-16 shrink-0 text-center ${indicated.length > 0 ? 'opacity-50' : condLabelClass(CONDITION_META[c].color)}`}
              title={CONDITION_META[c].cLabel}>
              {C_SHORT[c]}
            </span>
          ))}
        </>
      ) : (
        /* Separate: ONE column for the condition-matched consequence */
        session.condition && (
          <span className={`w-16 shrink-0 text-center ${condLabelClass(CONDITION_META[session.condition].color)}`}
            title={CONDITION_META[session.condition].cLabel}>
            {C_SHORT[session.condition]}
          </span>
        )
      )}
    </div>
  );
}
