// An invented CPR record, the one the 8 Oct 2026 CPR review used to show the
// lag split: one Attention session, ten 30-second intervals. No real client.
//
// With both lags on, the consequence table is 3 / 0 / 3 / 4 and CV is +50.0%.
// With both off it is 0 / 3 / 3 / 4 and CV is -42.9%. Any view that disagrees
// with the others on which of those it shows is reading a different lag.

const BX = 'YNYNNYNNNN';
const EO = 'NYNNYNNNNN';
const C = 'NYNYNNYNNN';

const tw = (ch) => (ch === 'Y' ? 'yes' : ch === 'N' ? 'no' : 'could_not_score');

export const CPR_RECORD_ID = 'spec-cpr-attention';

export function attentionRecord(overrides = {}) {
  const now = '2026-10-08T12:00:00.000Z';
  const intervals = [...BX].map((bx, i) => ({
    id: `iv-${i + 1}`,
    intervalNumber: i + 1,
    timeLabel: '',
    behavior: tw(bx),
    eo: { attention: tw(EO[i]) },
    consequences: {
      attention: tw(C[i]),
      escape: 'could_not_score',
      tangible: 'could_not_score',
      sensory: 'could_not_score',
    },
    note: '',
  }));
  return {
    id: CPR_RECORD_ID,
    _schemaVersion: 2,
    clientName: 'Spec Client',
    observer: 'Spec Observer',
    setting: 'Clinic',
    date: '2026-10-08',
    startEndTime: '9:00 AM - 9:30 AM',
    targetBehaviorName: 'Invented behavior',
    targetBehaviorDefinition: 'An invented definition for a test record.',
    separateSessions: {
      attention: {
        id: 'spec-session-attention',
        assessmentId: CPR_RECORD_ID,
        sessionType: 'single',
        condition: 'attention',
        conditionNote: '',
        intervalDurationSeconds: 30,
        intervalCount: 10,
        indicatedFunctions: [],
        intervals,
        notes: '',
        createdAt: now,
        updatedAt: now,
      },
    },
    synthesizedSessions: [],
    notes: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// Cell counts in table order: Bx+C+, Bx+C-, Bx-C+, Bx-C-.
export const LAG_ON_CONSEQUENCE = [3, 0, 3, 4];
export const LAG_OFF_CONSEQUENCE = [0, 3, 3, 4];
