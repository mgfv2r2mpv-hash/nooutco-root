import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/* notes/bcba/goal-picks.js holds the goal picker's rules with no DOM and no
 * model: which chips are checked, the cap of six, which chip a seventh check
 * evicts, whether the grid differs from the picks, and held row text. It is a
 * browser IIFE, run here in a bare vm context. Names are invented. */

const SRC = readFileSync(join(__dirname, '..', 'notes/bcba/goal-picks.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(SRC, sandbox);
const GP = sandbox.window.GoalPicks;

const cand = (list, preselected) => ({
  order: list,
  preselected: preselected || [],
});
const eight = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6', 'G7', 'H8'];

test.describe('goal picks: cap rule', () => {
  test('init checks the preselected chips in strip order', () => {
    const s = GP.init(cand(eight, ['C3', 'A1']));
    expect(GP.checked(s)).toEqual(['A1', 'C3']);
  });

  test('a seventh check evicts the leftmost preselected chip still checked', () => {
    let s = GP.init(cand(eight, ['A1', 'B2', 'C3', 'D4', 'E5', 'F6']));
    s = GP.toggle(s, 'G7');
    expect(GP.checked(s)).toEqual(['B2', 'C3', 'D4', 'E5', 'F6', 'G7']);
  });

  test('once no preselected chip is left checked, the oldest user check goes', () => {
    let s = GP.init(cand(eight, ['A1']));
    s = GP.toggle(s, 'A1');
    for (const n of ['B2', 'C3', 'D4', 'E5', 'F6', 'G7']) s = GP.toggle(s, n);
    expect(GP.checked(s)).toEqual(['B2', 'C3', 'D4', 'E5', 'F6', 'G7']);
    s = GP.toggle(s, 'H8');
    expect(GP.checked(s)).toEqual(['C3', 'D4', 'E5', 'F6', 'G7', 'H8']);
  });

  test('preselected chips go before any user check, even a user check that is further left', () => {
    let s = GP.init(cand(eight, ['E5', 'F6', 'G7']));
    for (const n of ['A1', 'B2', 'C3']) s = GP.toggle(s, n);
    s = GP.toggle(s, 'D4');
    expect(GP.checked(s)).toEqual(['A1', 'B2', 'C3', 'D4', 'F6', 'G7']);
  });

  test('check a seventh, uncheck it, check it again keeps six and evicts in the same order', () => {
    let s = GP.init(cand(eight, ['A1', 'B2', 'C3', 'D4', 'E5', 'F6']));
    s = GP.toggle(s, 'G7');
    s = GP.toggle(s, 'G7');
    expect(GP.checked(s)).toEqual(['B2', 'C3', 'D4', 'E5', 'F6']);
    s = GP.toggle(s, 'G7');
    expect(GP.checked(s)).toEqual(['B2', 'C3', 'D4', 'E5', 'F6', 'G7']);
    s = GP.toggle(s, 'A1');
    expect(GP.checked(s)).toEqual(['A1', 'C3', 'D4', 'E5', 'F6', 'G7']);
  });

  test('toggle never mutates the state it is given', () => {
    const s = GP.init(cand(eight, ['A1', 'B2']));
    const before = JSON.stringify(s);
    GP.toggle(s, 'C3');
    expect(JSON.stringify(s)).toBe(before);
  });

  test('an unknown name is ignored', () => {
    const s = GP.init(cand(eight, ['A1']));
    expect(GP.checked(GP.toggle(s, 'Nope'))).toEqual(['A1']);
  });

  test('fewer than six candidates never evict', () => {
    let s = GP.init(cand(['A1', 'B2', 'C3'], ['A1']));
    s = GP.toggle(s, 'B2');
    s = GP.toggle(s, 'C3');
    expect(GP.checked(s)).toEqual(['A1', 'B2', 'C3']);
  });
});

test.describe('goal picks: Update button state', () => {
  test('differs is false when picks equal the grid names, in any order', () => {
    const s = GP.init(cand(eight, ['A1', 'B2']));
    expect(GP.differs(s, ['B2', 'A1'])).toBe(false);
  });

  test('differs is true for an added or a removed goal', () => {
    const s = GP.init(cand(eight, ['A1', 'B2']));
    expect(GP.differs(s, ['A1'])).toBe(true);
    expect(GP.differs(GP.toggle(s, 'C3'), ['A1', 'B2'])).toBe(true);
  });

  test('plan lists added and removed names against the grid', () => {
    const s = GP.toggle(GP.init(cand(eight, ['A1', 'B2'])), 'C3');
    expect(GP.plan(s, ['A1', 'Z9'])).toEqual({ added: ['B2', 'C3'], removed: ['Z9'] });
  });
});

test.describe('goal picks: held row text', () => {
  test('a held row comes back while the notes are unchanged', () => {
    const held = GP.hold({}, 'B2', 'Progress text', 'notes v1');
    expect(GP.recall(held, 'B2', 'notes v1')).toBe('Progress text');
  });

  test('a held row is not offered once the notes changed', () => {
    const held = GP.hold({}, 'B2', 'Progress text', 'notes v1');
    expect(GP.recall(held, 'B2', 'notes v2')).toBeNull();
  });

  test('hold returns a new map and leaves the old one alone', () => {
    const a = GP.hold({}, 'B2', 'x', 'n');
    const b = GP.hold(a, 'C3', 'y', 'n');
    expect(Object.keys(a)).toEqual(['B2']);
    expect(Object.keys(b)).toEqual(['B2', 'C3']);
  });

  test('an unknown name recalls nothing', () => {
    expect(GP.recall({}, 'B2', 'n')).toBeNull();
  });
});

test.describe('goal picks: six is the master cap across skills and reduction targets', () => {
  const withFree = (list, preselected) => ({ order: list, preselected });

  test('six picks of any kind are all checked', () => {
    const s = GP.init(withFree(['R1', ...eight.slice(0, 6)], ['R1', ...eight.slice(0, 5)]));
    expect(GP.checked(s)).toHaveLength(6);
  });

  test('a seventh pick evicts the leftmost preselected chip, a reduction target included', () => {
    let s = GP.init(withFree(['R1', ...eight], ['R1', ...eight.slice(0, 5)]));
    s = GP.toggle(s, 'F6');
    expect(GP.checked(s)).toHaveLength(6);
    s = GP.toggle(s, 'G7');
    expect(GP.checked(s)).toEqual(['B2', 'C3', 'D4', 'E5', 'F6', 'G7']);
  });

  test('checking a reduction target past six counts toward the cap', () => {
    let s = GP.init(withFree(['R1', 'R2', ...eight], eight.slice(0, 6)));
    s = GP.toggle(s, 'R1');
    s = GP.toggle(s, 'R2');
    expect(GP.checked(s)).toHaveLength(6);
    expect(GP.checked(s)).toEqual(['R1', 'R2', 'C3', 'D4', 'E5', 'F6']);
  });

  test('eviction is reported so the thread can name it', () => {
    const s = GP.init(withFree(eight, eight.slice(0, 6)));
    const after = GP.toggle(s, 'G7');
    expect(GP.evicted(s, after, 'G7')).toEqual(['A1']);
    expect(GP.evicted(s, GP.toggle(s, 'A1'), 'A1')).toEqual([]);
  });

  test('capRows gives reduction rows first claim on six, keeps order, and names what it dropped', () => {
    const rows = ['A1', 'B2', 'R1', 'C3', 'D4', 'E5', 'F6', 'R2', 'G7'].map((goal) => ({ goal }));
    const out = GP.capRows(rows, (r) => r.goal.startsWith('R'));
    expect(out.rows.map((r) => r.goal)).toEqual(['A1', 'B2', 'R1', 'C3', 'D4', 'R2']);
    expect(out.dropped.map((r) => r.goal)).toEqual(['E5', 'F6', 'G7']);
  });

  test('capRows with seven reduction rows keeps the first six of them', () => {
    const rows = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'A1'].map((goal) => ({ goal }));
    const out = GP.capRows(rows, (r) => r.goal.startsWith('R'));
    expect(out.rows.map((r) => r.goal)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6']);
    expect(out.dropped.map((r) => r.goal)).toEqual(['R7', 'A1']);
  });

  test('capRows drops nothing when six or fewer rows', () => {
    const rows = [{ goal: 'A1' }, { goal: 'R1' }];
    expect(GP.capRows(rows, (r) => r.goal === 'R1')).toEqual({ rows, dropped: [] });
  });
});
