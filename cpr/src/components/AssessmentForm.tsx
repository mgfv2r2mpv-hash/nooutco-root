import { useState } from 'react';
import type { Assessment } from '../types';
import { makeAssessment, today } from '../utils/assessmentHelpers';

interface Props {
  initial?:  Partial<Assessment>;
  onSave:    (a: Assessment) => Promise<void>;
  onCancel:  () => void;
}

export function AssessmentForm({ initial = {}, onSave, onCancel }: Props) {
  const [clientName,  setClientName]  = useState(initial.clientName  ?? '');
  const [observer,    setObserver]    = useState(initial.observer    ?? '');
  const [setting,     setSetting]     = useState(initial.setting     ?? '');
  const [date,        setDate]        = useState(initial.date        ?? today());
  const [startEnd,    setStartEnd]    = useState(initial.startEndTime ?? '');
  const [targetBxName, setTargetBxName] = useState(initial.targetBehaviorName       ?? '');
  const [targetBxDef,  setTargetBxDef]  = useState(initial.targetBehaviorDefinition ?? '');
  const [notes,        setNotes]        = useState(initial.notes       ?? '');
  const [saving,      setSaving]      = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const fields = { clientName, observer, setting, date, startEndTime: startEnd,
      targetBehaviorName: targetBxName, targetBehaviorDefinition: targetBxDef, notes };
    const assessment: Assessment = initial.id
      ? { ...(initial as Assessment), ...fields, updatedAt: new Date().toISOString() }
      : makeAssessment(fields);
    await onSave(assessment);
    setSaving(false);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{initial.id ? 'Edit assessment' : 'New assessment'}</h1>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Client" required>
              <input className="input" value={clientName} onChange={e => setClientName(e.target.value)}
                required placeholder="Client name or ID" />
            </Field>
            <Field label="Observer">
              <input className="input" value={observer} onChange={e => setObserver(e.target.value)}
                placeholder="Observer name" />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Setting">
              <input className="input" value={setting} onChange={e => setSetting(e.target.value)}
                placeholder="e.g. Classroom, Home" />
            </Field>
            <Field label="Date" required>
              <input type="date" className="input" value={date}
                onChange={e => setDate(e.target.value)} required />
            </Field>
          </div>
          <Field label="Start / End time">
            <input className="input" value={startEnd} onChange={e => setStartEnd(e.target.value)}
              placeholder="e.g. 9:00 – 9:30 AM" />
          </Field>
          <Field label="Target behavior name" required>
            <input className="input" value={targetBxName} onChange={e => setTargetBxName(e.target.value)}
              required placeholder="e.g. Screaming, Self-injurious behavior, Elopement" />
          </Field>
          <Field label="Target behavior definition" required>
            <textarea className="input resize-none" rows={3} value={targetBxDef}
              onChange={e => setTargetBxDef(e.target.value)} required
              placeholder="Operational definition of the target behavior..." />
          </Field>
          <Field label="Notes">
            <textarea className="input resize-none" rows={2} value={notes}
              onChange={e => setNotes(e.target.value)} placeholder="General assessment notes..." />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <button type="button" onClick={onCancel} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? 'Saving…' : initial.id ? 'Save changes' : 'Create assessment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}
