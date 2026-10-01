import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/* notes/bcba/repeated-facts.js is a pure function over the drafted narrative
 * sections. It finds a sentence in one section that restates another section's
 * sentence, returns ambiguous_item hints, and never edits anything. It also
 * counts sentences so the section budgets can be tested. No model is called.
 * All names and facts are invented. */

const SRC = readFileSync(join(__dirname, '..', 'notes/bcba/repeated-facts.js'), 'utf8');

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(SRC, sandbox);
  return sandbox.window.RepeatedFacts;
}

const RF = load();
const LABELS = { progress: 'Progress', programming: 'Protocol Modifications', behavior: 'Behavior', feedback: 'Feedback Notes' };
const SECTIONS = ['progress', 'programming', 'behavior', 'feedback'];

test.describe('repeated facts: sentence counter', () => {
  test('counts sentences and ignores abbreviations, decimals and empty text', () => {
    expect(RF.countSentences('')).toBe(0);
    expect(RF.countSentences(null)).toBe(0);
    expect(RF.countSentences('One. Two! Three?')).toBe(3);
    expect(RF.countSentences('Client scored 4.5 on average, e.g. a good day. Next.')).toBe(2);
    expect(RF.countSentences('A line with no final stop')).toBe(1);
  });

  test('a quoted line with its own full stop stays inside its sentence', () => {
    expect(RF.countSentences('He said "Not now." and walked to the door. Staff waited.')).toBe(2);
  });

  test('bullets and newlines each end a sentence', () => {
    expect(RF.countSentences('- first point\n- second point\n- third point')).toBe(3);
  });
});

test.describe('repeated facts: overlap', () => {
  test('the same fact in different words across two sections is flagged on the later one', () => {
    const out = RF.check({
      progress: 'Client ran from the table twice during the blocks activity and staff blocked both attempts. He then finished the puzzle.',
      behavior: 'Elopement from the table occurred twice during blocks, and both attempts were blocked by staff.',
    }, { order: SECTIONS, labels: LABELS });
    expect(out).toEqual([{ section: 'behavior', code: 'ambiguous_item', detail: 'Repeats Progress' }]);
  });

  test('a legitimate echo of a goal name does not flag', () => {
    const out = RF.check({
      progress: 'Mand for help improved across the session with fewer prompts needed by the end.',
      programming: 'No change to the mand for help procedure was made today.',
      behavior: 'No elopement occurred. Antecedent supports included a visual schedule and first-then cards.',
      feedback: 'Caregiver practiced the visual schedule and was coached on first-then cards.',
    }, { order: SECTIONS, labels: LABELS });
    expect(out).toEqual([]);
  });

  test('caregiver coaching restated in Progress is flagged against Feedback Notes', () => {
    const out = RF.check({
      progress: 'The caregiver practiced the delay procedure and was coached on delivering the reinforcer right away.',
      feedback: 'Caregiver practiced the delay procedure, was coached on delivering the reinforcer right away.',
    }, { order: ['progress', 'feedback'], labels: LABELS });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ section: 'feedback', detail: 'Repeats Progress' });
  });

  test('one hint per section even when several sentences repeat', () => {
    const out = RF.check({
      progress: 'Staff blocked elopement twice at the door. Staff blocked a second elopement at the gate.',
      behavior: 'Elopement at the door was blocked by staff twice. Elopement at the gate was blocked by staff again.',
    }, { order: ['progress', 'behavior'], labels: LABELS });
    expect(out).toHaveLength(1);
  });

  test('short sentences and stopword-only overlap never flag', () => {
    const out = RF.check({
      progress: 'It went well.',
      behavior: 'It went well.',
    }, { order: ['progress', 'behavior'], labels: LABELS });
    expect(out).toEqual([]);
  });

  test('a section repeating itself is not a cross-section repeat', () => {
    const out = RF.check({
      progress: 'Elopement was blocked twice at the door. Elopement was blocked twice at the door.',
    }, { order: ['progress'], labels: LABELS });
    expect(out).toEqual([]);
  });

  test('empty, missing and non-string sections are skipped', () => {
    expect(RF.check({ progress: '', behavior: null, feedback: 4 }, { order: SECTIONS, labels: LABELS })).toEqual([]);
    expect(RF.check(null, { order: SECTIONS, labels: LABELS })).toEqual([]);
  });

  test('check never mutates its input', () => {
    const input = Object.freeze({
      progress: 'Client ran from the table twice and staff blocked both attempts.',
      behavior: 'Elopement from the table occurred twice and staff blocked both attempts.',
    });
    expect(() => RF.check(input, { order: ['progress', 'behavior'], labels: LABELS })).not.toThrow();
  });
});
