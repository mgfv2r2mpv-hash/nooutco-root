/**
 * AssessmentService — abstract interface for all assessment persistence.
 *
 * Current implementation: InMemoryAssessmentService (data lives only in
 * React state; an exported Excel file is the durable artifact).
 *
 * Future implementations can swap in:
 *   - RestAssessmentService   → REST API backend
 *   - SharePointService       → SharePoint / MS Graph API
 *   - IndexedDbService        → offline-capable browser storage
 *
 * All methods are async so callers are already written in the
 * network-latency style required by every real backend.
 */
export interface AssessmentService {
  list():                              Promise<import('../types').Assessment[]>;
  get(id: string):                     Promise<import('../types').Assessment | null>;
  save(a: import('../types').Assessment): Promise<import('../types').Assessment>;
  delete(id: string):                  Promise<void>;
}
