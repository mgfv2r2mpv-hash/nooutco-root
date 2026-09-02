import { test, expect } from '@playwright/test';
import {
  correctionsRequest,
  correctionsSystem,
  correctionsTurns,
  correctionsSchema,
  correctionsFound,
  correctionsLimits,
} from '../_worker.js';
import { refusedKeywords } from './helpers/schema.js';

/* The corrections pass, at the Worker boundary.
 *
 * This is the one route in the file that WRITES INTO A NOTE, so the shape rules
 * are tested directly rather than inferred from a 400. Everything here is pure:
 * the request validator, the composition order, the turns the model sees, the
 * schema, and how an answer is read.
 */

const draft = () => [
  { id: 'antecedentNarrative', heading: 'Antecedent modifications', text: 'Gave a two minute warning.' },
  { id: 'behaviorNarrative', heading: 'Behavior plan progress', text: 'Aggression occurred 2 times.' },
];
const ok = () => ({ tool: 'bt', intake: 'The technician wrote this.', draft: draft() });

test.describe('what the route accepts', () => {
  test('a well-formed request comes back normalized', () => {
    const r = correctionsRequest(ok());
    expect(r.error).toBeUndefined();
    expect(r.tool).toBe('bt');
    expect(r.draft.map((d) => d.id)).toEqual(['antecedentNarrative', 'behaviorNarrative']);
  });

  test('the tool and the intake are governed by the pass, not by a second copy here', () => {
    // If these two rules ever drift apart, a corrections call would be accepted
    // on an intake the expert pass would have refused - which is the whole
    // reason correctionsRequest delegates rather than re-checking.
    expect(correctionsRequest({ ...ok(), tool: '' }).error).toMatch(/Missing tool/);
    expect(correctionsRequest({ ...ok(), intake: '   ' }).error).toMatch(/Missing intake/);
    expect(correctionsRequest({ ...ok(), intake: 'x'.repeat(correctionsLimits().intakeChars + 1) }).error)
      .toMatch(/longer than this pass accepts/);
  });

  test('a section id that could reach the upstream enum is checked rather than trusted', () => {
    const bad = correctionsRequest({ ...ok(), draft: [{ id: 'has spaces', text: 'x' }] });
    expect(bad.error).toMatch(/characters that are not allowed/);
    expect(correctionsRequest({ ...ok(), draft: [{ id: '', text: 'x' }] }).error).toMatch(/short string id/);
  });

  test('the same section twice is refused, not deduplicated', () => {
    // Deduplicating would pick a winner silently, and the two copies are two
    // different claims about what the draft says.
    const r = correctionsRequest({ ...ok(), draft: [{ id: 'a', text: 'one' }, { id: 'a', text: 'two' }] });
    expect(r.error).toMatch(/appears twice/);
  });

  test('a draft with nothing written in it is refused before the account is billed', () => {
    const r = correctionsRequest({ ...ok(), draft: [{ id: 'a', text: '  ' }, { id: 'b', text: '' }] });
    expect(r.error).toMatch(/no narrative to correct/);
  });

  test('the draft is bounded on the total, because forty short sections cost what one long one does', () => {
    const half = Math.ceil(correctionsLimits().draftChars / 2) + 10;
    const r = correctionsRequest({
      ...ok(),
      draft: [{ id: 'a', text: 'x'.repeat(half) }, { id: 'b', text: 'y'.repeat(half) }],
    });
    expect(r.error).toMatch(/longer than this pass accepts/);
  });

  test('a missing draft is a different error from an empty one', () => {
    expect(correctionsRequest({ tool: 'bt', intake: 'notes' }).error).toMatch(/Missing draft/);
    expect(correctionsRequest({ ...ok(), draft: [] }).error).toMatch(/Missing draft/);
  });
});

test.describe('what the model is told', () => {
  test('the stored prompt comes first and the addendum is appended, never the other way round', () => {
    const composed = correctionsSystem('STORED RULES');
    expect(composed.startsWith('STORED RULES')).toBe(true);
    expect(composed).toContain('You are no longer reviewing an intake');
  });

  test('the addendum names the three things the pass may do and forbids inventing', () => {
    const composed = correctionsSystem('');
    // Each of these is a fault this pass would otherwise commit on a real note:
    // a move that arrives nowhere, an outcome nobody observed, and a rewrite
    // the technician has to read and undo.
    expect(composed).toContain('MOVE');
    expect(composed).toContain('ADD');
    expect(composed).toContain('REMOVE');
    expect(composed).toContain('INVENT NOTHING');
    expect(composed).toContain('CHANGE NOTHING ELSE');
  });

  test('the turns carry the intake first and the draft second, both from the request', () => {
    const turns = correctionsTurns(correctionsRequest(ok()));
    expect(turns.map((t) => t.role)).toEqual(['user', 'user']);
    expect(turns[0].content).toBe('The technician wrote this.');
    expect(turns[1].content).toContain('[antecedentNarrative] Antecedent modifications');
    expect(turns[1].content).toContain('Gave a two minute warning.');
  });
});

test.describe('the response schema', () => {
  test('it carries no keyword the API refuses', () => {
    // The same guard that closed the fortnight-long triage outage. The list
    // lives in tests/helpers/schema.js so one place learns each new refusal.
    expect(refusedKeywords(correctionsSchema(['a', 'b']), 'corrections schema')).toEqual([]);
  });

  test('the section is an enum of the ids that were sent', () => {
    const schema = correctionsSchema(['antecedentNarrative', 'behaviorNarrative']);
    expect(schema.properties.corrections.items.properties.section.enum)
      .toEqual(['antecedentNarrative', 'behaviorNarrative']);
  });

  test('the text field says it wants the whole section, because a fragment would read as a rewrite', () => {
    const desc = correctionsSchema(['a']).properties.corrections.items.properties.text.description;
    expect(desc).toContain('COMPLETE');
    expect(desc).toContain('word for word');
  });
});

test.describe('reading the answer', () => {
  const api = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

  test('a correction naming a section that was never sent is dropped, not trusted', () => {
    // The enum makes this unlikely and does not make it impossible, and a
    // correction for a section the browser has no draft text for would render
    // as the whole section being replaced.
    const found = correctionsFound(
      api({ corrections: [{ section: 'nope', text: 'x', why: '' }, { section: 'a', text: 'kept', why: 'w' }] }),
      [{ id: 'a', text: 'draft' }],
    );
    expect(found.corrections).toEqual([{ section: 'a', text: 'kept', why: 'w' }]);
    expect(found.dropped).toBe(1);
  });

  test('a section returned unchanged is not a correction', () => {
    const found = correctionsFound(
      api({ corrections: [{ section: 'a', text: '  draft  ', why: 'no change' }] }),
      [{ id: 'a', text: 'draft' }],
    );
    expect(found.corrections).toEqual([]);
    expect(found.dropped).toBe(1);
  });

  test('an empty list is a real answer and not a failure', () => {
    const found = correctionsFound(api({ corrections: [] }), [{ id: 'a', text: 'draft' }]);
    expect(found).not.toBeNull();
    expect(found.corrections).toEqual([]);
  });

  test('something that is not JSON at all is a failure, which the route answers 502', () => {
    expect(correctionsFound({ content: [{ type: 'text', text: 'sorry, I cannot' }] }, [{ id: 'a', text: 'd' }])).toBeNull();
    expect(correctionsFound({ content: [] }, [{ id: 'a', text: 'd' }])).toBeNull();
  });
});
