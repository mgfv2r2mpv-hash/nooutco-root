// ─── Primitive types ─────────────────────────────────────────────────────────

export type ConditionType = 'attention' | 'escape' | 'tangible' | 'sensory';
export type SessionType   = 'single' | 'synthesized';

/** Y = occurred/present | N = did not occur | CS = Could Not Score */
export type ThreeWay = 'yes' | 'no' | 'could_not_score';

// ─── Fixed condition metadata ─────────────────────────────────────────────────

export interface ConditionMeta {
  label: string;
  eoLabel: string;
  cLabel: string;
  color: 'blue' | 'green' | 'orange' | 'purple';
}

export const CONDITION_META: Record<ConditionType, ConditionMeta> = {
  attention: { label: 'Attention', eoLabel: 'Attn Removed',      cLabel: 'Attn Delivered',    color: 'blue'   },
  escape:    { label: 'Escape',    eoLabel: 'Demand Present',     cLabel: 'Escape Granted',    color: 'green'  },
  tangible:  { label: 'Tangible',  eoLabel: 'Item Absent',        cLabel: 'Item Provided',     color: 'orange' },
  sensory:   { label: 'Sensory',   eoLabel: 'Alone / Unoccupied', cLabel: 'Bx Persists Alone', color: 'purple' },
};

export const ALL_CONDITIONS: ConditionType[] = ['attention', 'escape', 'tangible', 'sensory'];

// ─── Interval ────────────────────────────────────────────────────────────────

/** All four consequence types recorded every interval — BCBAs don't control consequences. */
export interface ConsequenceRecord {
  attention: ThreeWay;
  escape:    ThreeWay;
  tangible:  ThreeWay;
  sensory:   ThreeWay;
}

export interface Interval {
  id: string;
  intervalNumber: number;
  timeLabel: string;
  behavior: ThreeWay;
  /**
   * EO presence per condition.
   * Single-condition: only the active condition key is present.
   * Synthesized: all four keys.
   */
  eo: Partial<Record<ConditionType, ThreeWay>>;
  /** All four consequence types, always. */
  consequences: ConsequenceRecord;
  note: string;
}

// ─── Session (child of Assessment) ───────────────────────────────────────────

export interface Session {
  id: string;
  assessmentId: string;

  sessionType: SessionType;
  /** Set for single-condition; null for synthesized */
  condition: ConditionType | null;
  /** Describes what was specifically tested (demand type, tangible item, etc.) */
  conditionNote: string;

  intervalDurationSeconds: number;
  intervalCount: number;

  /**
   * Interview-indicated functions — shown LEFT in the consequence section
   * and easier to toggle (positioned for faster data entry).
   */
  indicatedFunctions: ConditionType[];

  /**
   * For synthesized sessions only: which conditions' EOs are simultaneously
   * active. Shown as a single merged EO column in data entry.
   * Defaults to ALL_CONDITIONS for backward compatibility.
   */
  synthesizedConditions?: ConditionType[];

  intervals: Interval[];
  notes: string;
  /**
   * Timer: total seconds accumulated during data-collection runs for this session.
   * Incremented by the Start/Stop timer in DataEntry. Reset to 0 when session is cleared.
   */
  elapsedSeconds?: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Assessment (top-level entity) ───────────────────────────────────────────

/**
 * An Assessment groups all condition sessions for a single client/date/behavior.
 * Separate-condition sessions and synthesized sessions are kept distinct
 * because their analyses are displayed independently.
 *
 * This is the primary unit stored in (or fetched from) the backend/DB/SharePoint.
 */
export interface Assessment {
  id: string;
  _schemaVersion: 2;

  // Header — shared across all sessions in this assessment
  clientName:               string;
  observer:                 string;
  setting:                  string;
  date:                     string; // YYYY-MM-DD
  startEndTime:             string;
  targetBehaviorName:       string;
  targetBehaviorDefinition: string;

  /**
   * Separate single-condition sessions, keyed by condition.
   * At most one session per condition type.
   */
  separateSessions: Partial<Record<ConditionType, Session>>;

  /**
   * Synthesized sessions — multiple runs are allowed
   * (e.g., second run with different items pre-selected).
   */
  synthesizedSessions: Session[];

  notes:     string;
  /**
   * Set during Excel import when start/end times are parseable from sheet headers.
   * Broadest window (latest end − earliest start) across all sheets.
   * Shown as an advisory to the user and pre-populates Override Assessment Duration.
   */
  importedDurationSeconds?: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Analysis ────────────────────────────────────────────────────────────────

export interface ContingencyTable {
  bxPlusCPlus:   number; // Bx=Y, condition=Y
  bxPlusCMinus:  number; // Bx=Y, condition=N
  bxMinusCPlus:  number; // Bx=N, condition=Y
  bxMinusCMinus: number; // Bx=N, condition=N
  rowTotalBxPlus:  number;
  rowTotalBxMinus: number;
  colTotalCPlus:   number;
  colTotalCMinus:  number;
  grandTotal:      number;
  /** P(Bx | C+) — null when colTotalCPlus = 0 */
  pBxGivenCPlus:  number | null;
  /** P(Bx | C−) — null when colTotalCMinus = 0 */
  pBxGivenCMinus: number | null;
  /** CV = P(Bx|C+) − P(Bx|C−) — null when either probability is null */
  cv: number | null;
}

export interface ConditionAnalysis {
  condition:        ConditionType;
  consequenceTable: ContingencyTable; // C± = consequence delivered
  antecedentTable:  ContingencyTable; // C± = EO/antecedent present
}

export interface AssessmentAnalysis {
  assessmentId:     string;
  lag1Antecedent:   boolean;
  lag1Consequence:  boolean;
  /** One entry per separate condition that has data */
  separateConditionAnalyses: ConditionAnalysis[];
  /** One entry per synthesized session run */
  synthesizedAnalyses: ConditionAnalysis[][];
}

// ─── App navigation ──────────────────────────────────────────────────────────

export type AppView =
  | 'home'
  | 'assessment-setup'
  | 'assessment-detail'
  | 'session-setup'
  | 'data-entry'
  | 'review'
  | 'analysis';
