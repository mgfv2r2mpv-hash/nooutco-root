import type {
  Assessment,
  Session,
  Interval,
  ConsequenceRecord,
  ConditionType,
  SessionType,
} from '../types';
import { ALL_CONDITIONS } from '../types';

function uid() { return crypto.randomUUID(); }
export function today() { return new Date().toISOString().slice(0, 10); }

// ─── Interval factory ─────────────────────────────────────────────────────────

export function makeInterval(n: number, activeConditions: ConditionType[]): Interval {
  const eo: Partial<Record<ConditionType, 'could_not_score'>> = {};
  for (const c of activeConditions) eo[c] = 'could_not_score';
  const consequences: ConsequenceRecord = {
    attention: 'could_not_score',
    escape:    'could_not_score',
    tangible:  'could_not_score',
    sensory:   'could_not_score',
  };
  return { id: uid(), intervalNumber: n, timeLabel: '', behavior: 'could_not_score', eo, consequences, note: '' };
}

// ─── Session factory ──────────────────────────────────────────────────────────

export function makeSession(
  assessmentId: string,
  type: SessionType,
  condition: ConditionType | null,
  intervalCount: number,
  intervalDurationSeconds: number,
): Session {
  const activeConditions: ConditionType[] =
    type === 'synthesized' ? ALL_CONDITIONS : condition ? [condition] : [];
  const now = new Date().toISOString();
  return {
    id: uid(),
    assessmentId,
    sessionType: type,
    condition,
    conditionNote: '',
    intervalDurationSeconds,
    intervalCount,
    indicatedFunctions: [],
    intervals: Array.from({ length: intervalCount }, (_, i) => makeInterval(i + 1, activeConditions)),
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Assessment factory ───────────────────────────────────────────────────────

export function makeAssessment(fields: {
  clientName:               string;
  observer:                 string;
  setting:                  string;
  date:                     string;
  startEndTime:             string;
  targetBehaviorName:       string;
  targetBehaviorDefinition: string;
  notes:                    string;
}): Assessment {
  const now = new Date().toISOString();
  return {
    _schemaVersion: 2,
    id: uid(),
    ...fields,
    separateSessions:   {},
    synthesizedSessions: [],
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Session helpers ──────────────────────────────────────────────────────────

export function activeConditionsForSession(session: Session): ConditionType[] {
  return session.sessionType === 'synthesized'
    ? ALL_CONDITIONS
    : session.condition ? [session.condition] : [];
}

export interface SessionProgress {
  total:         number;
  scored:        number;  // behavior !== CS
  behaviorCount: number;  // behavior === yes
  csCount:       number;  // behavior === CS
}

export function sessionProgress(session: Session): SessionProgress {
  const total         = session.intervals.length;
  const scored        = session.intervals.filter(iv => iv.behavior !== 'could_not_score').length;
  const behaviorCount = session.intervals.filter(iv => iv.behavior === 'yes').length;
  const csCount       = session.intervals.filter(iv => iv.behavior === 'could_not_score').length;
  return { total, scored, behaviorCount, csCount };
}

// ─── Assessment helpers ───────────────────────────────────────────────────────

/** Next condition not yet started in this assessment (for "Next condition" flow). */
export function nextAvailableCondition(assessment: Assessment): ConditionType | null {
  return ALL_CONDITIONS.find(c => !assessment.separateSessions[c]) ?? null;
}

/** Upsert a separate-condition session into an assessment (returns updated assessment). */
export function upsertSeparateSession(assessment: Assessment, session: Session): Assessment {
  if (!session.condition) throw new Error('Cannot upsert synthesized session as separate');
  return {
    ...assessment,
    separateSessions: { ...assessment.separateSessions, [session.condition]: session },
    updatedAt: new Date().toISOString(),
  };
}

/** Upsert a synthesized session by index (appends if index === length). */
export function upsertSynthesizedSession(
  assessment: Assessment,
  session: Session,
  index: number,
): Assessment {
  const runs = [...assessment.synthesizedSessions];
  runs[index] = session;
  return { ...assessment, synthesizedSessions: runs, updatedAt: new Date().toISOString() };
}

/** Clear interval data for a separate condition (keeps session settings, resets all intervals). */
export function clearSeparateSession(assessment: Assessment, condition: ConditionType): Assessment {
  const session = assessment.separateSessions[condition];
  if (!session) return assessment;
  const active = activeConditionsForSession(session);
  const cleared: Session = {
    ...session,
    elapsedSeconds: 0,
    intervals: Array.from({ length: session.intervalCount }, (_, i) => makeInterval(i + 1, active)),
    updatedAt: new Date().toISOString(),
  };
  return { ...assessment, separateSessions: { ...assessment.separateSessions, [condition]: cleared }, updatedAt: new Date().toISOString() };
}

/** Delete a synthesized run by index. */
export function deleteSynthesizedSession(assessment: Assessment, index: number): Assessment {
  const runs = assessment.synthesizedSessions.filter((_, i) => i !== index);
  return { ...assessment, synthesizedSessions: runs, updatedAt: new Date().toISOString() };
}

/** Clear interval data for a synthesized run (keeps settings, resets all intervals). */
export function clearSynthesizedSession(assessment: Assessment, index: number): Assessment {
  const session = assessment.synthesizedSessions[index];
  if (!session) return assessment;
  const active = session.synthesizedConditions ?? ALL_CONDITIONS;
  const cleared: Session = {
    ...session,
    elapsedSeconds: 0,
    intervals: Array.from({ length: session.intervalCount }, (_, i) => makeInterval(i + 1, active)),
    updatedAt: new Date().toISOString(),
  };
  const runs = [...assessment.synthesizedSessions];
  runs[index] = cleared;
  return { ...assessment, synthesizedSessions: runs, updatedAt: new Date().toISOString() };
}

/** Resize intervals when BCBA changes the interval count after initial setup. */
export function resizeIntervals(session: Session, newCount: number): Session {
  const active = activeConditionsForSession(session);
  const existing = session.intervals;
  const intervals: Interval[] = Array.from({ length: newCount }, (_, i) =>
    existing[i] ?? makeInterval(i + 1, active),
  );
  return { ...session, intervalCount: newCount, intervals, updatedAt: new Date().toISOString() };
}
