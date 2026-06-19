/**
 * AssessmentContext
 *
 * Provides the AssessmentService implementation to the component tree.
 * Swap the service in main.tsx when a real backend is available —
 * all components continue to work unchanged.
 *
 * Also owns the in-flight list state so components don't each
 * trigger redundant fetches.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Assessment } from '../types';
import type { AssessmentService } from './AssessmentService';

interface AssessmentContextValue {
  assessments: Assessment[];
  loading:     boolean;
  error:       string | null;
  save:   (a: Assessment) => Promise<Assessment>;
  remove: (id: string)    => Promise<void>;
  reload: ()              => Promise<void>;
}

const Ctx = createContext<AssessmentContextValue | null>(null);

export function AssessmentProvider({
  service,
  children,
}: {
  service:  AssessmentService;
  children: ReactNode;
}) {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  // Keep a stable ref to the service so callbacks don't go stale
  const svcRef = useRef(service);
  svcRef.current = service;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAssessments(await svcRef.current.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const save = useCallback(async (a: Assessment) => {
    const saved = await svcRef.current.save(a);
    setAssessments((prev) => {
      const idx = prev.findIndex((x) => x.id === saved.id);
      return idx >= 0
        ? prev.map((x, i) => (i === idx ? saved : x))
        : [...prev, saved];
    });
    return saved;
  }, []);

  const remove = useCallback(async (id: string) => {
    await svcRef.current.delete(id);
    setAssessments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  return (
    <Ctx.Provider value={{ assessments, loading, error, save, remove, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAssessments() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAssessments must be used inside AssessmentProvider');
  return ctx;
}
