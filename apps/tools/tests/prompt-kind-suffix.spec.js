import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promptKinds, suffixKinds, serverPromptRequest } from '../_worker.js';
import { DRAFT_PROMPT_KINDS } from './helpers/llm-call.js';

/* A PROMPT KIND EITHER WRITES PROSE OR IT DOES NOT, AND THREE FILES HAVE TO
 * AGREE ABOUT WHICH.
 *
 * Until 2026-09-07 every kind the store held was a triage prompt, and that made
 * one fact do three jobs. tests/helpers/llm-call.js could say "any prompt_kind
 * means triage"; the Worker could hand the per-note style block only to calls
 * that named no kind at all; and nothing had to reconcile them because there
 * was nothing to reconcile.
 *
 * sap_design ended that. It is a DRAFTING prompt asked for by name, because one
 * prompt store serves both the production and the dev Pages projects and the
 * old and new clients have to run side by side through a release.
 *
 * The two lists that now exist are the same fact from opposite sides:
 *
 *   SUFFIX_KINDS       the Worker's - which kinds may carry the style block
 *   DRAFT_PROMPT_KINDS the test helper's - which kinds are not triage
 *
 * They are the same list because the style block is measured from the note the
 * call is about to write. A triage call writes no prose, so it has nothing for
 * the block to act on; a drafting call does. Nothing else in the tree compares
 * them, and the failure when they drift is silent in both directions: a helper
 * that misses a drafting kind answers a draft with a triage payload and the
 * spec times out somewhere unrelated, and a Worker that misses one refuses the
 * clinician's style card with an error the engine's catch swallows.
 */

test.describe('the drafting kinds are one list, held in two places', () => {
  test('the Worker set and the test helper agree, exactly', () => {
    expect([...DRAFT_PROMPT_KINDS].sort(),
      'a kind that writes prose is known to one of these files and not the other')
      .toEqual(suffixKinds());
  });

  test('and every one of them is a kind the Worker will actually fetch', () => {
    // A drafting kind absent from PROMPT_KINDS is refused before the suffix
    // question is ever reached, so the agreement above would be agreement about
    // a kind that cannot be used.
    for (const kind of suffixKinds()) {
      expect(promptKinds(), `${kind} may carry a style block but is not a kind the Worker knows`)
        .toContain(kind);
    }
  });

  test('a drafting kind takes the style block and a triage kind refuses it', () => {
    // Stated as behaviour rather than set membership, because the sets are what
    // the gate is built from and this is what the gate DOES.
    for (const kind of suffixKinds()) {
      const r = serverPromptRequest({ prompt_kind: kind, system_suffix: 'STYLE CARD' }, 'sap');
      expect(r.error, `${kind} writes the note and must accept the measured block`).toBeUndefined();
      expect(r.suffix).toBe('STYLE CARD');
    }
    for (const kind of promptKinds().filter((k) => !suffixKinds().includes(k))) {
      const r = serverPromptRequest({ prompt_kind: kind, system_suffix: 'STYLE CARD' }, 'sap');
      expect(r.error, `${kind} writes no prose and must refuse a block rather than drop it`)
        .toMatch(/takes no system_suffix/);
    }
  });
});

/* AND THE THIRD PLACE, which is the one that started this: a tool declares its
   drafting kind on itself, and that declaration is what puts the kind on the
   wire. A tool naming a draftKind the Worker will not give a style block to
   sends its measured card into a refusal on every single note. */
test('every draftKind a tool declares is a kind that may carry the block', () => {
  const dir = join(__dirname, '..', 'notes/bcba/tools');
  for (const tool of ['bt', 'sap', 'sup', 'parent', 'assess']) {
    const src = readFileSync(join(dir, `${tool}.js`), 'utf8');
    const m = src.match(/draftKind:\s*"([a-z_]+)"/);
    if (!m) continue;
    expect(suffixKinds(), `${tool}.js drafts under "${m[1]}", which the Worker refuses a style block for`)
      .toContain(m[1]);
  }
});
