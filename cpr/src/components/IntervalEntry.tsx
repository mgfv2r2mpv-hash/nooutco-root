/**
 * IntervalEntry — compact inline row for a single observation interval.
 *
 * Layout (single-condition):
 *   [#] [Time?]  Bx: Y/N/CS  |  EO: Y/N/CS  |  C+ (condition consequence): Y/N/CS  [✎]
 *
 * Layout (synthesized):
 *   [#] [Time?]  Bx: Y/N/CS  |  EO: Y/N/CS  |  [indicated C+ left] | [non-indicated right]  [✎]
 *
 * All toggles default to CS (Could Not Score). BCBAs mark what they observe.
 * For separate conditions, ONLY the condition-matched consequence is shown.
 * For synthesized, indicated functions (from session setup) appear LEFT, non-indicated RIGHT.
 */
import { useState } from 'react';
import type { Interval, Session, ConditionType, ThreeWay } from '../types';
import { ALL_CONDITIONS, CONDITION_META } from '../types';

interface Props {
  interval:  Interval;
  session:   Session;
  onChange:  (updated: Interval) => void;
  /** When true, this row is highlighted as the current pace interval per the timer */
  isCurrent?: boolean;
}

export function IntervalEntry({ interval, session, onChange, isCurrent }: Props) {
  const [noteOpen, setNoteOpen] = useState(false);

  const activeEOConditions: ConditionType[] =
    session.sessionType === 'synthesized'
      ? (session.synthesizedConditions ?? ALL_CONDITIONS)
      : session.condition ? [session.condition] : [];

  // For synthesized sessions, a single merged EO toggle drives all activeEOConditions' EO fields
  const isSynth = session.sessionType === 'synthesized';
  const synthEOValue: ThreeWay = (() => {
    if (!isSynth) return 'could_not_score';
    const vals = activeEOConditions.map(c => interval.eo[c] ?? 'could_not_score');
    if (vals.every(v => v === vals[0])) return vals[0] ?? 'could_not_score';
    return 'could_not_score'; // mixed → treat as unscored
  })();

  function setSynthEO(v: ThreeWay) {
    const updatedEO = { ...interval.eo };
    activeEOConditions.forEach(c => { updatedEO[c] = v; });
    onChange({ ...interval, eo: updatedEO });
  }

  const indicated = session.indicatedFunctions;
  const nonIndicated = ALL_CONDITIONS.filter((c) => !indicated.includes(c));

  function setBehavior(v: ThreeWay) { onChange({ ...interval, behavior: v }); }

  function setEO(condition: ConditionType, v: ThreeWay) {
    onChange({ ...interval, eo: { ...interval.eo, [condition]: v } });
  }

  function setConsequence(condition: ConditionType, v: ThreeWay) {
    onChange({ ...interval, consequences: { ...interval.consequences, [condition]: v } });
  }

  function setNote(note: string) { onChange({ ...interval, note }); }

  // Row background: green tint when Bx occurred, neutral otherwise
  const rowBg =
    interval.behavior === 'yes' ? 'bg-green-50 dark:bg-green-950/20' :
    'bg-white dark:bg-gray-900';

  const paceBorder = isCurrent
    ? 'border-l-4 border-l-yellow-400 dark:border-l-yellow-500'
    : 'border border-gray-200 dark:border-gray-700';

  return (
    <div className={`rounded-lg overflow-hidden ${rowBg} ${paceBorder}`}>
      <div className="flex items-center gap-2 px-2 py-1.5 overflow-x-auto min-w-0 text-xs">
        {/* ── Interval number ── */}
        <span className="w-6 text-center font-mono font-semibold text-gray-500 dark:text-gray-400 shrink-0">
          {interval.intervalNumber}
        </span>

        {/* ── Time label (optional) ── */}
        <input
          type="text"
          value={interval.timeLabel}
          onChange={(e) => onChange({ ...interval, timeLabel: e.target.value })}
          placeholder="time"
          className="w-14 shrink-0 rounded border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-gray-800/60 px-1 py-0.5 text-xs text-gray-600 dark:text-gray-400 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />

        {/* ── Behavior ── */}
        <div className="w-20 shrink-0 flex items-center gap-1">
          <span className="text-gray-500 dark:text-gray-400 font-medium">Bx</span>
          <ThreeWayToggle value={interval.behavior} onChange={setBehavior} colorScheme="behavior" />
        </div>

        <Divider />

        {/* ── EO column(s): single merged toggle for synthesized, per-condition for separate ── */}
        {isSynth ? (
          <div className="w-16 shrink-0 flex justify-center">
            <ThreeWayToggle value={synthEOValue} onChange={setSynthEO} colorScheme="blue" />
          </div>
        ) : (
          activeEOConditions.map((cond) => (
            <div key={cond} className="w-16 shrink-0 flex justify-center">
              <ThreeWayToggle
                value={interval.eo[cond] ?? 'could_not_score'}
                onChange={(v) => setEO(cond, v)}
                colorScheme={CONDITION_META[cond].color}
              />
            </div>
          ))
        )}

        <Divider />

        {/* ── Consequences ── */}
        {isSynth ? (
          /* Synthesized: all 4, indicated left / non-indicated right */
          <>
            {indicated.map((cond) => (
              <div key={cond} className="w-16 shrink-0 flex justify-center">
                <ThreeWayToggle
                  value={interval.consequences[cond]}
                  onChange={(v) => setConsequence(cond, v)}
                  colorScheme={CONDITION_META[cond].color}
                />
              </div>
            ))}
            {nonIndicated.length > 0 && (
              <>
                {indicated.length > 0 && <Divider faint />}
                {nonIndicated.map((cond) => (
                  <div key={cond} className={`w-16 shrink-0 flex justify-center ${indicated.length > 0 ? 'opacity-60' : ''}`}>
                    <ThreeWayToggle
                      value={interval.consequences[cond]}
                      onChange={(v) => setConsequence(cond, v)}
                      colorScheme={indicated.length > 0 ? 'muted' : CONDITION_META[cond].color}
                    />
                  </div>
                ))}
              </>
            )}
          </>
        ) : (
          /* Separate: ONE consequence toggle — the condition-matched one only */
          session.condition && (
            <div className="w-16 shrink-0 flex justify-center">
              <ThreeWayToggle
                value={interval.consequences[session.condition]}
                onChange={(v) => setConsequence(session.condition!, v)}
                colorScheme={CONDITION_META[session.condition].color}
              />
            </div>
          )
        )}

        {/* ── Note toggle ── */}
        <button
          type="button"
          onClick={() => setNoteOpen((v) => !v)}
          className={`ml-auto shrink-0 px-1.5 py-0.5 rounded text-xs transition-colors ${
            interval.note
              ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30'
              : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
          }`}
          title="Toggle note"
        >
          ✎
        </button>
      </div>

      {/* ── Note input (inline expand) ── */}
      {noteOpen && (
        <div className="px-2 pb-2 border-t border-gray-100 dark:border-gray-800">
          <textarea
            value={interval.note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Observation note for this interval..."
            className="input text-xs resize-none mt-1.5"
            autoFocus
          />
        </div>
      )}
    </div>
  );
}

// ─── ThreeWayToggle ───────────────────────────────────────────────────────────

type ColorScheme = 'behavior' | 'blue' | 'green' | 'orange' | 'purple' | 'muted';

interface ThreeWayToggleProps {
  value: ThreeWay;
  onChange: (v: ThreeWay) => void;
  colorScheme: ColorScheme;
}

const OPTIONS: { value: ThreeWay; label: string }[] = [
  { value: 'yes', label: 'Y' },
  { value: 'no',  label: 'N' },
  { value: 'could_not_score', label: 'C' },
];

function ThreeWayToggle({ value, onChange, colorScheme }: ThreeWayToggleProps) {
  return (
    <div className="inline-flex rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
      {OPTIONS.map(({ value: v, label }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`px-1.5 py-0.5 text-xs font-semibold transition-colors leading-none
              ${active ? activeClass(colorScheme, v) : inactiveClass()}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function activeClass(_scheme: ColorScheme, value: ThreeWay): string {
  if (value === 'could_not_score') return 'bg-gray-400 text-white';
  // Y = green (present/occurred/delivered), N = red (absent/not occurred/withheld)
  return value === 'yes' ? 'bg-green-500 text-white' : 'bg-red-500 text-white';
}

function inactiveClass(): string {
  return 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────


function Divider({ faint }: { faint?: boolean }) {
  return (
    <div className={`self-stretch mx-1.5 rounded-full ${faint ? 'w-px bg-gray-200 dark:bg-gray-700' : 'w-0.5 bg-gray-400 dark:bg-gray-500'}`} />
  );
}
