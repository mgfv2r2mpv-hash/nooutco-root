import { useState } from 'react';
import type { Assessment, Session, ConditionType, SessionType } from '../types';
import { ALL_CONDITIONS, CONDITION_META } from '../types';
import { makeSession, resizeIntervals } from '../utils/assessmentHelpers';
import type { SessionKey } from '../App';

interface Props {
  assessment:  Assessment;
  sessionKey:  SessionKey | null;
  initial?:    Session;
  onSave:      (session: Session) => Promise<void>;
  onCancel:    () => void;
}

export function SessionForm({ assessment, sessionKey, initial, onSave, onCancel }: Props) {
  // Determine defaults from sessionKey
  const defaultType: SessionType =
    sessionKey?.type === 'synthesized' ? 'synthesized' : 'single';
  const defaultCondition: ConditionType | null =
    sessionKey?.type === 'separate' ? sessionKey.condition : null;

  const [conditionNote,      setConditionNote]      = useState(initial?.conditionNote ?? '');
  const [intervalSecs,       setIntervalSecs]       = useState(String(initial?.intervalDurationSeconds ?? 10));
  const [intervalCount,      setIntervalCount]      = useState(String(initial?.intervalCount ?? 60));
  const [indicated,          setIndicated]          = useState<ConditionType[]>(initial?.indicatedFunctions ?? []);
  const [synthConditions,    setSynthConditions]    = useState<ConditionType[]>(initial?.synthesizedConditions ?? ALL_CONDITIONS);
  const [notes,              setNotes]              = useState(initial?.notes ?? '');
  const [saving,             setSaving]             = useState(false);

  // Condition type and condition are fixed by sessionKey — not editable here
  const sessionType = defaultType;
  const condition   = defaultCondition;

  const conditionMeta = condition ? CONDITION_META[condition] : null;

  function toggleIndicated(c: ConditionType) {
    setIndicated(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  }

  function toggleSynthCondition(c: ConditionType) {
    setSynthConditions(prev => {
      const next = prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c];
      return next.length === 0 ? prev : next; // must keep at least one
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const count    = Math.max(1, parseInt(intervalCount, 10) || 60);
    const duration = Math.max(1, parseInt(intervalSecs,  10) || 10);

    const synthConds   = sessionType === 'synthesized' ? synthConditions : undefined;
    // Separate sessions have only one consequence — no indicated ordering needed
    const savedIndicated = sessionType === 'synthesized' ? indicated : [];

    let session: Session;
    if (initial) {
      let updated: Session = { ...initial, conditionNote, intervalDurationSeconds: duration,
        indicatedFunctions: savedIndicated, synthesizedConditions: synthConds,
        notes, updatedAt: new Date().toISOString() };
      if (count !== initial.intervalCount) updated = resizeIntervals(updated, count);
      session = updated;
    } else {
      session = { ...makeSession(assessment.id, sessionType, condition, count, duration),
        conditionNote, indicatedFunctions: savedIndicated, synthesizedConditions: synthConds, notes };
    }

    await onSave(session);
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">
        {initial ? 'Edit session' : 'New session'}:{' '}
        {sessionType === 'synthesized'
          ? 'Synthesized'
          : conditionMeta ? conditionMeta.label : ''}
      </h1>

      {/* Assessment context (read-only reminder) */}
      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
        <p><strong>Client:</strong> {assessment.clientName} · <strong>Date:</strong> {assessment.date}</p>
        <p className="line-clamp-1"><strong>Target behavior:</strong> {assessment.targetBehaviorName || assessment.targetBehaviorDefinition}</p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Single-condition info card */}
          {conditionMeta && (
            <div className="rounded-lg border border-dashed px-3 py-2 text-sm space-y-0.5"
              style={{ borderColor: `var(--cond-${conditionMeta.color})` }}>
              <p className="font-semibold text-gray-700 dark:text-gray-200">{conditionMeta.label} condition</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                EO: {conditionMeta.eoLabel} · Consequence: {conditionMeta.cLabel}
              </p>
            </div>
          )}

          {/* Synthesized EO conditions picker */}
          {sessionType === 'synthesized' && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">
                EO conditions to include
                <span className="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">
                  (all selected EOs are present simultaneously; shown as one EO column)
                </span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {ALL_CONDITIONS.map(c => {
                  const meta   = CONDITION_META[c];
                  const active = synthConditions.includes(c);
                  return (
                    <button key={c} type="button" onClick={() => toggleSynthCondition(c)}
                      className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors
                        ${active ? conditionActiveClass(meta.color) : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                      {meta.label}
                      {active && <span className="ml-1.5 text-xs opacity-80">({meta.eoLabel})</span>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          <Field label="Condition note"
            hint="Describe what was specifically tested (demand type, tangible item, setting events, etc.)">
            <textarea className="input resize-none" rows={2} value={conditionNote}
              onChange={e => setConditionNote(e.target.value)}
              placeholder={conditionMeta
                ? `e.g. Setting, activity, what ${conditionMeta.cLabel} looked like in this context`
                : 'e.g. Setting, activities observed, which conditions occurred naturally'} />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Interval duration">
              <select className="input" value={intervalSecs} onChange={e => setIntervalSecs(e.target.value)}>
                <option value="6">6 s</option>
                <option value="10">10 s (default)</option>
                <option value="15">15 s</option>
                <option value="30">30 s</option>
                <option value="60">60 s / 1 min</option>
                <option value="300">5 min</option>
              </select>
            </Field>
            <Field label="Number of intervals">
              <input type="number" className="input" min={1} max={500} value={intervalCount}
                onChange={e => setIntervalCount(e.target.value)} />
            </Field>
          </div>

          {/* Interview-indicated functions — synthesized only */}
          {sessionType === 'synthesized' && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Interview-indicated functions
                <span className="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">
                  (shown left in data entry for faster toggling)
                </span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {ALL_CONDITIONS.map(c => {
                  const meta   = CONDITION_META[c];
                  const active = indicated.includes(c);
                  return (
                    <button key={c} type="button" onClick={() => toggleIndicated(c)}
                      className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors
                        ${active ? conditionActiveClass(meta.color) : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          <Field label="Session notes">
            <textarea className="input resize-none" rows={2} value={notes}
              onChange={e => setNotes(e.target.value)} placeholder="Session-level notes..." />
          </Field>

          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onCancel} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? 'Saving…' : initial ? 'Save changes' : 'Start session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function conditionActiveClass(color: 'blue'|'green'|'orange'|'purple'): string {
  return { blue: 'bg-blue-600 text-white border-blue-600', green: 'bg-green-600 text-white border-green-600',
    orange: 'bg-orange-500 text-white border-orange-500', purple: 'bg-purple-600 text-white border-purple-600' }[color];
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}
