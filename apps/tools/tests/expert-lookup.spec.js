import { test, expect } from '@playwright/test';
import {
  expertLookupCalls,
  lookupResultBlocks,
  fetchLogEntries,
  expertSchema,
  lookupRound,
  expertLookupEnabled,
} from '../_worker.js';

/* The lookup: how a topic record gets off the index and into the answer.
 *
 * The store is tiered so the prompt stays lean as it grows: core rules are
 * always in it, topic records are one index line each and the body is fetched
 * only when the intake calls for it. Without the fetch, the index is a list of
 * things the expert cannot read.
 *
 * Two properties have to hold whatever else changes. Nothing a clinician typed
 * may reach the store, so the expert asks BY ID and the tool has no free-text
 * field at all. And every tool_use has to come back with a tool_result, because
 * one that does not is a turn the model cannot finish.
 *
 * These are the pure halves, so they run without a Worker.
 */

const use = (id, ids) => ({ type: 'tool_use', id, name: 'knowledge_lookup', input: { ids } });
const rec = (id, over = {}) => ({ id, version: 1, title: 'A rule', rule: 'Do the thing.', ...over });

test.describe('what the expert asked for', () => {
  test('only our own tool is read, and text blocks beside it are ignored', () => {
    const api = {
      content: [
        { type: 'text', text: 'let me check' },
        use('tu_1', ['kn_a', 'kn_b']),
        { type: 'tool_use', id: 'tu_2', name: 'something_else', input: { ids: ['kn_c'] } },
      ],
    };
    expect(expertLookupCalls(api)).toEqual([{ toolUseId: 'tu_1', ids: ['kn_a', 'kn_b'] }]);
    expect(expertLookupCalls({ content: [] })).toEqual([]);
    expect(expertLookupCalls(null)).toEqual([]);
  });

  test('an id that is not an id is dropped rather than forwarded to the store', () => {
    // These reach a query string on a Worker with no public URL and no auth of
    // its own, so they are checked here as well as there.
    const api = { content: [use('tu_1', ['kn_ok', '../../system?tool=expert', 'a b', '', null, 'x'.repeat(80)])] };
    expect(expertLookupCalls(api)[0].ids).toEqual(['kn_ok']);
  });

  test('ids are deduped and capped, so one confused turn cannot ask for the whole store', () => {
    const api = { content: [use('tu_1', ['kn_a', 'kn_a', 'kn_a'])] };
    expect(expertLookupCalls(api)[0].ids).toEqual(['kn_a']);

    const many = { content: [use('tu_1', Array.from({ length: 30 }, (_, i) => `kn_${i}`))] };
    expect(expertLookupCalls(many)[0].ids).toHaveLength(8);
  });

  test('a malformed input is an empty ask, not a crash', () => {
    for (const input of [{}, { ids: 'kn_a' }, { ids: null }, undefined]) {
      const calls = expertLookupCalls({ content: [{ type: 'tool_use', id: 't', name: 'knowledge_lookup', input }] });
      expect(calls).toEqual([{ toolUseId: 't', ids: [] }]);
    }
  });
});

test.describe('what the expert is told back', () => {
  test('every tool_use gets a tool_result, or the turn cannot finish', () => {
    const calls = [{ toolUseId: 'tu_1', ids: ['kn_a'] }, { toolUseId: 'tu_2', ids: [] }];
    const blocks = lookupResultBlocks(calls, [rec('kn_a')], false);
    expect(blocks.map((b) => b.tool_use_id)).toEqual(['tu_1', 'tu_2']);
    expect(blocks.every((b) => b.type === 'tool_result' && b.content)).toBe(true);
  });

  test('a record that is not in force is named as an absence, never answered with silence', () => {
    // Silence would read as "no such rule exists" and the expert would answer
    // from its own prior. A retired rule has to be distinguishable from an
    // empty store.
    const [block] = lookupResultBlocks([{ toolUseId: 'tu_1', ids: ['kn_gone'] }], [], false);
    expect(block.content).toContain('kn_gone');
    expect(block.content).toMatch(/not in force/);
    expect(block.content).toMatch(/Do not treat that as a rule against it/);
  });

  test('the record comes back whole: title, when it applies, the rule and its reason', () => {
    const [block] = lookupResultBlocks(
      [{ toolUseId: 'tu_1', ids: ['kn_a'] }],
      [rec('kn_a', { title: 'Ratio', applies: 'when a supervisor attended', rationale: 'Funders reject it.' })],
      false
    );
    expect(block.content).toContain('[kn_a] Ratio');
    expect(block.content).toContain('Applies: when a supervisor attended');
    expect(block.content).toContain('Do the thing.');
    expect(block.content).toContain('Why: Funders reject it.');
  });

  test('once the rounds are spent the expert is told so, and still gets an answer', () => {
    const [block] = lookupResultBlocks([{ toolUseId: 'tu_1', ids: ['kn_a'] }], [rec('kn_a')], true);
    expect(block.tool_use_id).toBe('tu_1');
    expect(block.content).toMatch(/No further lookups/);
    expect(block.content).not.toContain('Do the thing.');
  });
});

test.describe('the evidence elevation reads', () => {
  const calls = [{ toolUseId: 'tu_1', ids: ['kn_a', 'kn_b'] }, { toolUseId: 'tu_2', ids: ['kn_a', 'kn_gone'] }];
  const records = [rec('kn_a', { version: 3 }), rec('kn_b')];

  test('a record read twice in one turn is one fetch, and a missing one is none', () => {
    // Counting a repeat twice would let a single confused turn nominate a
    // record for promotion into every note tool's prompt.
    const entries = fetchLogEntries({ calls, records, used: [], tool: 'bt', subjectHash: 'ab' });
    expect(entries.map((e) => e.recordId)).toEqual(['kn_a', 'kn_b']);
    expect(entries[0].version).toBe(3);
  });

  test('answer_moved comes from what the expert says it used, not from what it fetched', () => {
    // His ruling of 2026-08-30: retrieved often AND the answer moved.
    const entries = fetchLogEntries({ calls, records, used: ['kn_b'], tool: 'bt' });
    expect(entries.find((e) => e.recordId === 'kn_a').answerMoved).toBe(false);
    expect(entries.find((e) => e.recordId === 'kn_b').answerMoved).toBe(true);
  });

  test('not measured stays null, so a silence is never counted as a no', () => {
    const entries = fetchLogEntries({ calls, records, used: undefined, tool: 'bt' });
    expect(entries.every((e) => e.answerMoved === null)).toBe(true);
  });

  test('a used id the expert never fetched writes no row', () => {
    const entries = fetchLogEntries({ calls: [], records, used: ['kn_a'], tool: 'bt' });
    expect(entries).toEqual([]);
  });
});

test.describe('the two schema shapes', () => {
  test('without the tool it is byte-identical to the one the note tools get', () => {
    // The shape the pass shipped with, kept because the parameter still decides
    // whether `used` is required. No caller passes false any more: since the
    // glossary split there is always something to fetch. See the always-on
    // block below, which is the live behaviour.
    const before = JSON.stringify(expertSchema(['alpha', 'beta']));
    expect(JSON.stringify(expertSchema(['alpha', 'beta'], false))).toBe(before);
    expect(JSON.stringify(expertSchema(['alpha', 'beta'], undefined))).toBe(before);
    expect(before).not.toContain('used');
  });

  test('with the tool on the call the used list is required, because an optional one measures nothing', () => {
    const s = expertSchema(['alpha'], true);
    expect(s.required).toContain('used');
    expect(s.properties.used.type).toBe('array');
    expect(s.properties.terms).toBeTruthy();
    expect(s.properties.hints.items.properties.section.enum).toEqual(['alpha', 'note']);
  });
});

test.describe('the loop stops', () => {
  /* This is the only part of the lookup that can spend money on its own. Every
   * continuation re-sends the whole conversation to a paid API, and nothing is
   * watching, so what makes the loop stop is worth a test rather than a comment.
   */
  const asked = [use('tu_1', ['kn_a'])];

  test('a turn that did not call the tool ends it', () => {
    expect(lookupRound({ round: 0, told: false, stopReason: 'end_turn', asked })).toBe('done');
    expect(lookupRound({ round: 0, told: false, stopReason: 'max_tokens', asked })).toBe('done');
  });

  test('a tool_use turn that asked for nothing we serve ends it', () => {
    // expertLookupCalls has already dropped calls to other tools and ids that
    // do not look like ids. An empty list here means it asked for nothing WE
    // answer, and re-sending on that is a loop with no way out of itself.
    expect(lookupRound({ round: 0, told: false, stopReason: 'tool_use', asked: [] })).toBe('done');
    expect(lookupRound({ round: 0, told: false, stopReason: 'tool_use', asked: null })).toBe('done');
  });

  test('asking again after being told the well is dry ends it', () => {
    expect(lookupRound({ round: 9, told: true, stopReason: 'tool_use', asked })).toBe('done');
  });

  test('the rounds run out and the last one refuses rather than going quiet', () => {
    expect(lookupRound({ round: 0, told: false, stopReason: 'tool_use', asked })).toBe('fetch');
    expect(lookupRound({ round: 1, told: false, stopReason: 'tool_use', asked })).toBe('fetch');
    expect(lookupRound({ round: 2, told: false, stopReason: 'tool_use', asked })).toBe('refuse');
  });

  test('a model that only ever calls the tool still terminates, and in a bounded number of API calls', () => {
    // Walk the worst case the loop can actually meet: the model asks on every
    // single turn and never answers. Count the rounds to a stop.
    let told = false;
    let rounds = 0;
    for (let round = 0; round < 50; round++) {
      const next = lookupRound({ round, told, stopReason: 'tool_use', asked });
      rounds = round + 1;
      if (next === 'done') break;
      if (next === 'refuse') told = true;
    }
    // Three requests that fetch or refuse, and a fourth that reads the refusal
    // and stops. A fifth would be the model ignoring the refusal, and it does
    // not get one.
    expect(rounds).toBe(4);
  });
});

test.describe('the lookup tool rides on every call, not only when the store has rules', () => {
  test('an empty store still gets the tool, because the glossary is always fetchable', () => {
    /* THE REGRESSION THIS EXISTS FOR. Until 2026-08-30 the gate was
       `composed.topic > 0`, and reinstating it would break nothing near itself:
       the build passes, the pass answers, and the only symptom is an expert
       quietly guessing abbreviations because its prompt told it to fetch and
       nothing gave it a tool. An empty store is the state this store spends its
       first day in, so the empty case is the one that has to be walked. */
    expect(expertLookupEnabled({ core: 0, topic: 0 })).toBe(true);
    expect(expertLookupEnabled(null)).toBe(true);
    expect(expertLookupEnabled(undefined)).toBe(true);
    expect(expertLookupEnabled({ core: 3, topic: 0 })).toBe(true);
  });

  test('a store with rules gets it too, which is the case that always worked', () => {
    expect(expertLookupEnabled({ core: 1, topic: 4 })).toBe(true);
  });
});
