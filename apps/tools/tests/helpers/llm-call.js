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

/* True for every shape triage has ever had, so a spec reads the same before and
   after its tool migrates.

   ANY prompt_kind, not the string "triage". This read `prompt_kind === 'triage'`
   until 2026-08-20, when sap started sending "sap_triage" for its own triage
   prompt - and that would have failed open in the one direction this helper
   exists to prevent, treating a sap triage call as a note. Every kind the store
   holds is a triage prompt today; if that ever stops being true, this needs a
   set rather than a truthiness check. */
export const isTriageCall = (body) =>
  !!(body && typeof body.prompt_kind === 'string' && body.prompt_kind) ||
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
