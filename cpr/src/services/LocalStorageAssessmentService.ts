/**
 * LocalStorageAssessmentService
 *
 * Persists assessments in localStorage so data survives page refreshes.
 * Swap for InMemoryAssessmentService (or a real API) in main.tsx if needed.
 */
import type { Assessment } from '../types';
import type { AssessmentService } from './AssessmentService';

const STORAGE_KEY = 'sda_cpr_assessments';

function readStore(): Map<string, Assessment> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const entries = JSON.parse(raw) as [string, Assessment][];
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function writeStore(store: Map<string, Assessment>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(store.entries())));
}

export class LocalStorageAssessmentService implements AssessmentService {
  async list(): Promise<Assessment[]> {
    return Array.from(readStore().values()).sort((a, b) => b.date.localeCompare(a.date));
  }

  async get(id: string): Promise<Assessment | null> {
    return readStore().get(id) ?? null;
  }

  async save(assessment: Assessment): Promise<Assessment> {
    const store = readStore();
    const record = { ...assessment, updatedAt: new Date().toISOString() };
    store.set(record.id, record);
    writeStore(store);
    return record;
  }

  async delete(id: string): Promise<void> {
    const store = readStore();
    store.delete(id);
    writeStore(store);
  }

  /** Wipe all stored assessments — used by the "Reset all" action. */
  static clearAll(): void {
    localStorage.removeItem(STORAGE_KEY);
  }
}
