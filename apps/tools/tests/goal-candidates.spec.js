import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/* notes/bcba/goal-candidates.js is a pure function over the masked clinical
 * notes. It decides which named items in the notes could be goal rows, how
 * strongly the notes specify each, and which of them the tool preselects. No
 * model is called. The file is a browser IIFE, so it is run here in a bare vm
 * context with a stand-in window. All names and numbers are invented. */

const SRC = readFileSync(join(__dirname, '..', 'notes/bcba/goal-candidates.js'), 'utf8');

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(SRC, sandbox);
  return sandbox.window.GoalCandidates;
}

const GC = load();
const find = (list, name) => list.find((c) => c.name === name);

test.describe('goal candidates: scoring tiers', () => {
  test('a name beside a goal word outranks a reduction frame, which outranks a data row', () => {
    const out = GC.score([
      '- Elopement goal: reduce to zero',
      '- Property Destruction (behavior targeted for reduction): 0 occurrences',
      '- Motor Imitation: 3 of 5 independent',
    ].join('\n'));
    const a = find(out, 'Elopement');
    const b = find(out, 'Property Destruction');
    const c = find(out, 'Motor Imitation');
    expect(a && b && c).toBeTruthy();
    expect(a.score).toBeGreaterThan(b.score);
    expect(b.score).toBeGreaterThan(c.score);
    expect(out.map((x) => x.name)).toEqual(['Elopement', 'Property Destruction', 'Motor Imitation']);
  });

  test('"goal: Name" counts as the strongest marker too', () => {
    const out = GC.score('- Goal: Mand For Help');
    expect(find(out, 'Mand For Help').score).toBe(find(GC.score('- Elopement goal'), 'Elopement').score);
  });

  test('a reduction frame names the item before or after the label', () => {
    const before = GC.score('- Elopement (behavior of concern): none today');
    const after = GC.score('- Behavior of concern: Elopement');
    expect(find(before, 'Elopement').kind).toBe('reduction');
    expect(find(after, 'Elopement').kind).toBe('reduction');
  });

  test('a bullet carrying a count, percent or prompt string is a data row', () => {
    const out = GC.score([
      '- Tact Colors: 80% over 10 trials',
      '- Intraverbal Fill-Ins: FP PP I I',
      '- Peer Greeting: 2/4 independent',
    ].join('\n'));
    for (const n of ['Tact Colors', 'Intraverbal Fill-Ins', 'Peer Greeting']) {
      expect(find(out, n), n).toBeTruthy();
    }
  });

  test('a Title Case label after a bullet is a weaker candidate than a data row', () => {
    const out = GC.score('- Motor Imitation: 3 of 5\n- Joint Attention:\n');
    expect(find(out, 'Joint Attention').score).toBeLessThan(find(out, 'Motor Imitation').score);
    expect(find(out, 'Joint Attention').score).toBeGreaterThan(0);
  });

  test('a defined term is a candidate', () => {
    const out = GC.score('Elopement is operationally defined as leaving the assigned area.');
    expect(find(out, 'Elopement')).toBeTruthy();
  });

  test('a heading line lists its items, each weak', () => {
    const out = GC.score('Treatment goals assessed: Mand For Help, Tact Colors, Elopement');
    for (const n of ['Mand For Help', 'Tact Colors', 'Elopement']) expect(find(out, n), n).toBeTruthy();
    expect(find(out, 'Tact Colors').score).toBeLessThan(find(GC.score('- Elopement goal'), 'Elopement').score);
  });

  test('a name found in two places scores above the same name found once', () => {
    const once = find(GC.score('- Joint Attention:'), 'Joint Attention');
    const twice = find(GC.score('- Joint Attention:\nLater we returned to Joint Attention.'), 'Joint Attention');
    expect(twice.score).toBeGreaterThan(once.score);
  });

  test('every candidate carries a source that is a substring of the input, and a why', () => {
    const input = '- Elopement goal: reduce to zero\n- Tact Colors: 80%';
    for (const c of GC.score(input)) {
      expect(input).toContain(c.source);
      expect(typeof c.why).toBe('string');
      expect(c.why.length).toBeGreaterThan(0);
      expect(['skill', 'reduction', 'probe']).toContain(c.kind);
    }
  });

  test('input without a named item gives an empty list', () => {
    expect(GC.score('')).toEqual([]);
    expect(GC.score('   \n  ')).toEqual([]);
    expect(GC.score(null)).toEqual([]);
  });
});

test.describe('goal candidates: attack list', () => {
  test('4: a story bullet with no data and no program name is not a candidate', () => {
    const out = GC.score('- we played blocks and he named animals');
    expect(out).toEqual([]);
  });

  test('5: "Elopement goal" is strong, "he did not elope" gives nothing', () => {
    expect(find(GC.score('- Elopement goal'), 'Elopement').score).toBeGreaterThanOrEqual(6);
    expect(GC.score('He did not elope during the session.')).toEqual([]);
  });

  test('6: apostrophes, quotes, slashes and unicode dashes survive verbatim', () => {
    const out = GC.score([
      "- Tolerate 'No': 4 of 5 independent",
      '- Alternative to Denied Item/Activity: 3 of 4',
      '- Wait \u2013 Then Go: 80%',
      '- Say “My Turn”: 2/4',
    ].join('\n'));
    expect(find(out, "Tolerate 'No'")).toBeTruthy();
    expect(find(out, 'Alternative to Denied Item/Activity')).toBeTruthy();
    expect(find(out, 'Wait \u2013 Then Go')).toBeTruthy();
    expect(find(out, 'Say “My Turn”')).toBeTruthy();
  });

  test('6: the same goal spelled with a curly and a straight apostrophe is one candidate', () => {
    const out = GC.score("- Tolerate 'No': 4 of 5\n- Tolerate ‘No’: 3 of 5");
    expect(out.filter((c) => /tolerate/i.test(c.name))).toHaveLength(1);
  });

  test('7: a Title Case sentence start that is not a goal gives nothing', () => {
    expect(GC.score('- Client Played Cars')).toEqual([]);
    expect(GC.score('Client Played Cars with a peer.')).toEqual([]);
    expect(GC.score('- Mom Asked About Mornings.')).toEqual([]);
  });

  test('4: incidental teaching and probes are candidates only as unchecked probes', () => {
    const out = GC.score('- Incidental Teaching: 2 of 3 opportunities\n- Color Probe: 4/6');
    for (const c of out) expect(c.kind, c.name).toBe('probe');
    expect(GC.preselect(out)).toEqual([]);
  });
});

test.describe('goal candidates: preselect', () => {
  test('keeps at most six, strongest first, skipping probes and weak tiers', () => {
    const lines = [];
    for (let i = 1; i <= 8; i += 1) lines.push(`- Target Number ${'ABCDEFGH'[i - 1]} goal`);
    lines.push('- Color Probe: 4/6');
    lines.push('- Joint Attention:');
    const chosen = GC.preselect(GC.score(lines.join('\n')));
    expect(chosen).toHaveLength(6);
    expect(chosen.map((c) => c.name)).toEqual(
      ['A', 'B', 'C', 'D', 'E', 'F'].map((l) => `Target Number ${l}`),
    );
  });

  test('returns the candidate objects, not just their names', () => {
    const chosen = GC.preselect(GC.score('- Elopement goal'));
    expect(chosen).toEqual([{ name: 'Elopement', score: expect.any(Number), source: expect.any(String), why: expect.any(String), kind: 'skill' }]);
  });
});

test.describe('goal candidates: bracket rows', () => {
  const ROW = '[Receptive ID | Animals | 5/3 | 62% | FP PP I I M I I I]';

  test('a full row parses into program, target, counts, percent, sequence', () => {
    const r = GC.parseRow(ROW);
    expect(r).toMatchObject({
      program: 'Receptive ID', target: 'Animals', correct: 5, incorrect: 3, percent: 62,
    });
    expect(r.sequence).toEqual(['FP', 'PP', 'I', 'I', 'M', 'I', 'I', 'I']);
  });

  test('a bullet before the bracket is allowed', () => {
    expect(GC.parseRow('- ' + ROW).program).toBe('Receptive ID');
  });

  test('8: one trial parses', () => {
    const r = GC.parseRow('[Receptive ID | Animals | 1/0 | 100% | I]');
    expect(r).toMatchObject({ correct: 1, incorrect: 0, percent: 100, mismatch: false });
  });

  test('8: zero correct parses and stays zero', () => {
    const r = GC.parseRow('[Receptive ID | Animals | 0/4 | 0% | FP FP FP FP]');
    expect(r).toMatchObject({ correct: 0, incorrect: 4, percent: 0, mismatch: false });
  });

  test('8: a percent that disagrees with the counts is flagged and the counts win', () => {
    const r = GC.parseRow('[Receptive ID | Animals | 5/3 | 90% | I I I I I M M M]');
    expect(r.mismatch).toBe(true);
    expect(r.correct).toBe(5);
    expect(r.incorrect).toBe(3);
    expect(r.computedPercent).toBe(63);
  });

  test('8: a code the parser cannot explain is listed, not interpreted', () => {
    const r = GC.parseRow('[Receptive ID | Animals | 3/1 | 75% | I I F2 -]');
    expect(r.unexplained).toEqual(['F2', '-']);
  });

  test('8: a missing raw field still parses, with null counts', () => {
    const r = GC.parseRow('[Receptive ID | Animals]');
    expect(r).toMatchObject({ program: 'Receptive ID', target: 'Animals', correct: null, incorrect: null, percent: null });
    expect(r.sequence).toEqual([]);
  });

  test('MED 11: short free text in Details is not a prompt-code sequence', () => {
    for (const text of ['Did well', 'Did well today', 'tired', 'Ok then']) {
      const r = GC.parseRow(`[Receptive ID | Animals | 5/3 | 62% | ${text}]`);
      expect(r.sequence, text).toEqual([]);
      expect(r.unexplained, text).toEqual([]);
      expect(r.details).toBe(text);
    }
  });

  test('8: extra pipes inside Details stay in the details', () => {
    const r = GC.parseRow('[Receptive ID | Animals | 5/3 | 62% | tired | out of seat | I I M]');
    expect(r.details).toBe('tired | out of seat | I I M');
    expect(r.sequence).toEqual([]);
  });

  test('8: text that is not a bracket row gives null, so it falls back to free text', () => {
    expect(GC.parseRow('- Receptive ID: 5 of 8')).toBeNull();
    expect(GC.parseRow('[just a note]')).toBeNull();
    expect(GC.parseRow('')).toBeNull();
  });

  test('a bracket row is a data-row candidate named for the program', () => {
    const out = GC.score(ROW);
    const c = find(out, 'Receptive ID');
    expect(c).toBeTruthy();
    expect(c.row.target).toBe('Animals');
    expect(c.score).toBe(find(GC.score('- Tact Colors: 80%'), 'Tact Colors').score);
  });

  test('two rows for one program make one candidate that holds both', () => {
    const out = GC.score(`${ROW}\n[Receptive ID | Colors | 4/4 | 100% | I I I I]`);
    const matches = out.filter((c) => c.name === 'Receptive ID');
    expect(matches).toHaveLength(1);
    expect(matches[0].rows).toHaveLength(2);
  });

  test('parseRows returns only the rows that parse, in order', () => {
    const rows = GC.parseRows(`intro\n${ROW}\n- free text: 2/4\n[Tact | Colors | 1/1 | 100% | I]`);
    expect(rows.map((r) => r.program)).toEqual(['Receptive ID', 'Tact']);
  });
});

test.describe('goal candidates: sentence fragments are never names (review HIGH 2)', () => {
  const FRAGMENTS = [
    '- He did not meet his goal of staying at the table.',
    '- BT ran the program for 3 of 5 trials.',
    '- Client engaged in elopement, a behavior of concern.',
    '- Mom reported 2 episodes at home.',
    '- Client ate 4/5 bites independently.',
  ];

  for (const line of FRAGMENTS) {
    test(`no fragment name from: ${line}`, () => {
      for (const c of GC.score(line)) {
        expect(c.name, c.name).not.toMatch(/^(?:he|she|bt|client|mom|they)\b/i);
        expect(c.name, c.name).not.toMatch(/\b(?:the|his|her|a|an|of|to|ran|ate|did)$/i);
      }
      expect(GC.preselect(GC.score(line))).toEqual([]);
    });
  }

  test('a name after the colon wins over a sentence before the frame', () => {
    const out = GC.score('- Client engaged in elopement, a behavior of concern: Elopement');
    expect(out.map((c) => c.name)).toContain('Elopement');
    expect(out.every((c) => !/^client/i.test(c.name))).toBe(true);
  });

  test('the same fragments mid-note do not poison a real goal line', () => {
    const out = GC.score(FRAGMENTS.join('\n') + '\n- Elopement goal: reduce to zero');
    expect(GC.preselect(out).map((c) => c.name)).toEqual(['Elopement']);
  });
});

test.describe('goal candidates: old Safari (review HIGH 4)', () => {
  test('the source holds no lookbehind, which throws on Safari before 16.4', () => {
    expect(SRC).not.toMatch(/\(\?<[!=]/);
  });

  test('"behavior goal" is still a reduction frame, not a goal word', () => {
    const out = GC.score('- Behavior goal: Elopement');
    expect(find(out, 'Elopement').kind).toBe('reduction');
  });
});

test.describe('goal candidates: preselect keeps reduction targets on top of six skills (review HIGH 3)', () => {
  test('six skills and two reduction targets are all preselected', () => {
    const lines = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((l) => `- Target Number ${l} goal`);
    lines.push('- Elopement (behavior of concern): none today');
    lines.push('- Aggression (behavior targeted for reduction): 0 occurrences');
    const chosen = GC.preselect(GC.score(lines.join('\n')));
    expect(chosen.filter((c) => c.kind === 'skill')).toHaveLength(6);
    expect(chosen.filter((c) => c.kind === 'reduction').map((c) => c.name).sort()).toEqual(['Aggression', 'Elopement']);
  });
});
