/* Reading an /api/llm-call body from a test, now that its shape depends on
 * whether the tool has migrated.
 *
 * A tool whose prompt still lives in the browser sends the whole thing as
 * `system`. A migrated tool sends only the per-note block it measured, as
 * `system_suffix`, and the Worker prepends the stored prompt. Triage is a third
 * shape again: `prompt_kind: "triage"` and no text at all.
 *
 * These live in one place because five specs were each carrying their own copy
 * of "is this the triage call", every one of them keyed on a field triage
 * stopped sending, and all five went quietly wrong on the same day. A detector
 * that fails open - treating triage as a note - does not throw. It answers the
 * triage call with a note and the spec times out somewhere unrelated.
 */

/* THE DAY THE COMMENT BELOW CAME DUE, 2026-09-07.
 *
 * This used to treat ANY prompt_kind as triage, and said so deliberately:
 * "Every kind the store holds is a triage prompt today; if that ever stops
 * being true, this needs a set rather than a truthiness check."
 *
 * It stopped being true. sap now asks for its DRAFTING prompt by name too -
 * "sap_design" - because one prompt store serves two Pages projects and the old
 * and new clients have to run side by side. Left alone, this helper would have
 * called every SAP draft a triage call, which is the exact fail-open direction
 * the paragraph above was written to prevent: the spec answers the draft with a
 * triage payload and then times out somewhere unrelated.
 *
 * So it is a set now. DRAFT_PROMPT_KINDS is the list of kinds that WRITE PROSE,
 * and prompt-kind-suffix.spec.js pins it against the Worker's own SUFFIX_KINDS -
 * which is the same fact from the other side, since a kind takes the per-note
 * style block exactly when it writes something for the block to act on. A new
 * drafting kind added to the Worker and not here fails that spec rather than
 * quietly breaking every note test. */
export const DRAFT_PROMPT_KINDS = new Set(['sap_design']);

export const isTriageCall = (body) =>
  !!(body && typeof body.prompt_kind === 'string' && body.prompt_kind &&
     !DRAFT_PROMPT_KINDS.has(body.prompt_kind)) ||
  !!(body && body.systemPrompt) ||
  /sufficient/i.test((body && body.system) || '');

/* What the BROWSER contributed to this call's system prompt.
 *
 * For an unmigrated tool that is the entire prompt; for a migrated one it is
 * only the measured per-note block, because the rest is composed server-side
 * and no test can see it from here. Assertions about a style card, a sentence
 * target or an intake-voice line read the same either way. Assertions about the
 * tool's own clinical rules do NOT - those moved to voice-module, and the specs
 * that guard them go through buildSystem() instead.
 */
export const browserSystem = (body) =>
  body && typeof body.system_suffix === 'string' ? body.system_suffix : (body && body.system) || '';
