import { useRef, useState, useCallback } from 'react';
import './index.css';
import type { AppView, Assessment, Session, ConditionType } from './types';
import { useAssessments } from './services/AssessmentContext';
import { upsertSeparateSession, upsertSynthesizedSession, clearSeparateSession, deleteSynthesizedSession, clearSynthesizedSession } from './utils/assessmentHelpers';
import { importAssessmentFromExcel } from './utils/excelImport';
import { LocalStorageAssessmentService } from './services/LocalStorageAssessmentService';
import { HomeScreen }       from './components/HomeScreen';
import { AssessmentForm }   from './components/AssessmentForm';
import { AssessmentDetail } from './components/AssessmentDetail';
import { SessionForm }       from './components/SessionForm';
import { DataEntry }         from './components/DataEntry';
import { ReviewScreen }      from './components/ReviewScreen';
import { AnalysisView }      from './components/AnalysisView';
import { HelpModal }         from './components/HelpModal';

export type SessionKey =
  | { type: 'separate'; condition: ConditionType }
  | { type: 'synthesized'; index: number };

export default function App() {
  const { assessments, save, remove } = useAssessments();

  const [view,               setView]               = useState<AppView>('home');
  const [activeAssessmentId, setActiveAssessmentId] = useState<string | null>(null);
  const [activeSessionKey,   setActiveSessionKey]   = useState<SessionKey | null>(null);
  const [helpOpen,           setHelpOpen]           = useState(false);
  const loadFileRef = useRef<HTMLInputElement>(null);

  // ── Derived active objects ──────────────────────────────────────────────────
  const activeAssessment = assessments.find(a => a.id === activeAssessmentId) ?? null;
  const activeSession: Session | null = activeAssessment && activeSessionKey
    ? activeSessionKey.type === 'separate'
      ? (activeAssessment.separateSessions[activeSessionKey.condition] ?? null)
      : (activeAssessment.synthesizedSessions[activeSessionKey.index] ?? null)
    : null;

  // ── Navigation helpers ──────────────────────────────────────────────────────

  const goHome = useCallback(() => {
    setView('home');
    setActiveAssessmentId(null);
    setActiveSessionKey(null);
  }, []);

  const openAssessment = useCallback((id: string) => {
    setActiveAssessmentId(id);
    setView('assessment-detail');
    setActiveSessionKey(null);
  }, []);

  const openSession = useCallback((
    assessmentId: string,
    key: SessionKey,
    target: AppView = 'data-entry',
  ) => {
    setActiveAssessmentId(assessmentId);
    setActiveSessionKey(key);
    setView(target);
  }, []);

  // ── Mutation helpers ────────────────────────────────────────────────────────

  const saveAssessment = useCallback(async (a: Assessment) => {
    const saved = await save(a);
    setActiveAssessmentId(saved.id);
    return saved;
  }, [save]);

  const saveSession = useCallback(async (session: Session) => {
    if (!activeAssessment) return;
    let updated: Assessment;
    if (activeSessionKey?.type === 'separate' && session.condition) {
      updated = upsertSeparateSession(activeAssessment, session);
    } else if (activeSessionKey?.type === 'synthesized') {
      updated = upsertSynthesizedSession(activeAssessment, session, activeSessionKey.index);
    } else {
      return;
    }
    await save(updated);
  }, [activeAssessment, activeSessionKey, save]);

  // ── Load Excel (replace current assessment) ────────────────────────────────

  async function handleLoadExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (loadFileRef.current) loadFileRef.current.value = '';
    try {
      const imported = await importAssessmentFromExcel(file);
      const saved = await save(imported);
      openAssessment(saved.id);
    } catch (err) {
      alert(`Could not load file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function promptLoadExcel() {
    const msg = activeAssessment
      ? 'Loading a new Excel file will open it as a separate assessment. Any data you have not exported may be lost if you navigate away. Continue?'
      : 'Load an Excel file to import an assessment.';
    if (activeAssessment && !confirm(msg)) return;
    loadFileRef.current?.click();
  }

  // ── Page title ──────────────────────────────────────────────────────────────
  function getPageTitle(): string {
    const condName = activeSessionKey?.type === 'separate'
      ? activeSessionKey.condition.charAt(0).toUpperCase() + activeSessionKey.condition.slice(1)
      : activeSessionKey?.type === 'synthesized'
        ? `Synthesized Run ${activeSessionKey.index + 1}`
        : '';
    switch (view) {
      case 'assessment-setup':  return 'Assessment Configuration';
      case 'assessment-detail': return 'Assessment Dashboard';
      case 'session-setup':     return condName ? `${condName} Configuration` : 'Session Configuration';
      case 'data-entry':        return condName ? `${condName} Data Entry` : 'Data Entry';
      case 'review':            return condName ? `${condName} Review` : 'Review';
      case 'analysis':          return 'CPR Analysis Screen';
      default:                  return '';
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* ── Nav bar ── */}
      <header className="no-print bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-2 text-sm">
        <button onClick={goHome}
          className="font-bold text-indigo-600 dark:text-indigo-400 shrink-0">
          Conditional Probability Record &amp; Analysis Tool
        </button>
        {/* Help button — right next to the title */}
        <button
          onClick={() => setHelpOpen(true)}
          className="w-5 h-5 rounded-full border-2 border-indigo-400 text-indigo-500 dark:border-indigo-500 dark:text-indigo-400
            text-[11px] font-bold flex items-center justify-center hover:bg-indigo-50 dark:hover:bg-indigo-950/30 shrink-0"
          title="Help & Tutorial"
          aria-label="Open help and tutorial"
        >?</button>

        {getPageTitle() && (
          <>
            <span className="text-gray-300 dark:text-gray-600">/</span>
            <span className="text-gray-600 dark:text-gray-300 truncate">{getPageTitle()}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={promptLoadExcel}
            className="text-xs px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600
              text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
            Load Excel
          </button>
          <button
            onClick={() => {
              if (confirm('Clear all saved assessments and start fresh? This cannot be undone.')) {
                LocalStorageAssessmentService.clearAll();
                window.location.reload();
              }
            }}
            className="text-xs px-3 py-1.5 rounded-md border border-red-200 dark:border-red-800
              text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30">
            Clear Assessment
          </button>
          <input ref={loadFileRef} type="file" accept=".xlsx" className="hidden" onChange={handleLoadExcel} />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {view === 'home' && (
          <HomeScreen
            assessments={assessments}
            onOpen={openAssessment}
            onNew={() => { setActiveAssessmentId(null); setView('assessment-setup'); }}
            onDelete={async (id) => { await remove(id); }}
            onImported={async (a) => { const saved = await save(a); openAssessment(saved.id); }}
          />
        )}

        {view === 'assessment-setup' && (
          <AssessmentForm
            initial={activeAssessment ?? undefined}
            onSave={async (a) => { const saved = await saveAssessment(a); openAssessment(saved.id); }}
            onCancel={() => setView(activeAssessment ? 'assessment-detail' : 'home')}
          />
        )}

        {view === 'assessment-detail' && activeAssessment && (
          <AssessmentDetail
            assessment={activeAssessment}
            onEditHeader={() => setView('assessment-setup')}
            onStartSession={(key) => {
              setActiveSessionKey(key);
              setView('session-setup');
            }}
            onOpenSession={(key, target) => openSession(activeAssessment.id, key, target)}
            onAnalyze={() => setView('analysis')}
            onClearCondition={async (c) => { await save(clearSeparateSession(activeAssessment, c)); }}
            onDeleteSynthRun={async (i) => { await save(deleteSynthesizedSession(activeAssessment, i)); }}
            onClearSynthRun={async (i) => { await save(clearSynthesizedSession(activeAssessment, i)); }}
          />
        )}

        {view === 'session-setup' && activeAssessment && (
          <SessionForm
            assessment={activeAssessment}
            sessionKey={activeSessionKey}
            initial={activeSession ?? undefined}
            onSave={async (session) => {
              await saveSession(session);
              setView('data-entry');
            }}
            onCancel={() => setView('assessment-detail')}
          />
        )}

        {view === 'data-entry' && activeAssessment && activeSession && activeSessionKey && (
          <DataEntry
            assessment={activeAssessment}
            session={activeSession}
            sessionKey={activeSessionKey}
            onIntervalChange={async (updated) => {
              const intervals = activeSession.intervals.map(iv =>
                iv.id === updated.id ? updated : iv,
              );
              await saveSession({ ...activeSession, intervals });
            }}
            onSaveSession={saveSession}
            onGoReview={() => setView('review')}
            onEditSession={() => setView('session-setup')}
          />
        )}

        {view === 'review' && activeAssessment && activeSession && activeSessionKey && (
          <ReviewScreen
            assessment={activeAssessment}
            session={activeSession}
            onContinue={() => setView('data-entry')}
            onGoToDashboard={() => setView('assessment-detail')}
            onProceedToAnalysis={() => setView('analysis')}
          />
        )}

        {view === 'analysis' && activeAssessment && (
          <AnalysisView assessment={activeAssessment} onBack={() => setView('assessment-detail')} />
        )}
      </main>

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
