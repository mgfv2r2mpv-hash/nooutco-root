/**
 * InMemoryAssessmentService
 *
 * Stub implementation of AssessmentService backed by a plain JS Map.
 * Data exists only for the lifetime of the browser session.
 * The exported Excel file is the sole durable artifact.
 *
 * STUB NOTE: Every method is a direct stand-in for a future API call.
 * To wire up a real backend, implement AssessmentService against your
 * API/DB/SharePoint client and pass it to AssessmentContext in main.tsx.
 * No component code needs to change.
 */
import type { Assessment } from '../types';
import type { AssessmentService } from './AssessmentService';

export class InMemoryAssessmentService implements AssessmentService {
  private store = new Map<string, Assessment>();

  async list(): Promise<Assessment[]> {
    // STUB → future: GET /api/assessments
    return Array.from(this.store.values()).sort(
      (a, b) => b.date.localeCompare(a.date),
    );
  }

  async get(id: string): Promise<Assessment | null> {
    // STUB → future: GET /api/assessments/:id
    return this.store.get(id) ?? null;
  }

  async save(assessment: Assessment): Promise<Assessment> {
    // STUB → future: POST /api/assessments  or  PUT /api/assessments/:id
    const record = { ...assessment, updatedAt: new Date().toISOString() };
    this.store.set(record.id, record);
    return record;
  }

  async delete(id: string): Promise<void> {
    // STUB → future: DELETE /api/assessments/:id
    this.store.delete(id);
  }
}
