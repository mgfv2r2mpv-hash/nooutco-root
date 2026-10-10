import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { checkedWhy, checkedReasons } from '../worker/change-claims.js';
import { correctionsFound } from '../_worker.js';

/* Two bench findings from 2026-10-09 that turned out to live in code every
 * tool shares, or that one tool's label made untrue.
 *
 *   A change note claimed an edit that did not land. The corrections pass
 *   (one route, all five tools) now holds each claim against the text.
 *
 *   The Assessment hint "Findings missing; Results of Assessment is empty"
 *   showed when that field had text. It now keys on the field.
 *
 * Pure: the Worker functions are imported, the tool file runs in a bare vm.
 * No server and no model call. */

const api = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });

test.describe('a change note never claims an edit that did not land', () => {
  const BEFORE = 'Preliminary assessment suggests the behavior is maintained by escape. Elopement occurred twice.';

  test('Sup case: "removed" a phrase that is still there is dropped', () => {
    const after = 'Preliminary assessment suggests the behavior is maintained by escape. Elopement occurred on two occasions.';
    expect(checkedWhy("Removed hedging 'preliminary assessment suggests'.", BEFORE, after)).toBe('');
    expect(checkedWhy('Removed "preliminary assessment suggests".', BEFORE, after)).toBe('');
    expect(checkedWhy('Removed preliminary assessment suggests and tightened wording.', BEFORE, after)).toBe('');
  });

  test('the same claim stands when the phrase really went', () => {
    const after = 'The behavior appears maintained by escape. Elopement occurred twice.';
    const why = "Removed hedging 'preliminary assessment suggests'.";
    expect(checkedWhy(why, BEFORE, after)).toBe(why);
  });

  test('Assessment case: "added counts or rates" with no number added is dropped', () => {
    const before = 'BCBA reviewed manding and elopement data with the caregiver.';
    const after = 'BCBA reviewed manding and elopement data with the caregiver, which informed goal selection.';
    const why = 'Added observable counts or rates for manding and elopement, drawn from the follow-up response.';
    expect(checkedWhy(why, before, after)).toBe('');
  });

  test('the same claim stands when a figure was added', () => {
    const before = 'BCBA reviewed manding data.';
    const after = 'BCBA reviewed manding data; the client manded 6 times per session.';
    const why = 'Added observable counts for manding, drawn from the follow-up response.';
    expect(checkedWhy(why, before, after)).toBe(why);
  });

  test('only the false clause goes; the true one stays as written', () => {
    const after = 'Preliminary assessment suggests the behavior is maintained by escape.';
    const why = 'Removed the repeated elopement sentence. Removed "preliminary assessment suggests".';
    expect(checkedWhy(why, BEFORE, after)).toBe('Removed the repeated elopement sentence.');
  });

  test('a claim to add or remove when nothing was added or removed is dropped', () => {
    expect(checkedWhy('Added the caregiver response.', 'A B C.', 'A B C. ')).toBe('');
    expect(checkedWhy('Cut the opinion about mood.', 'He was calm.', 'He was calm and seated.')).toBe('');
  });

  test('a claim that cannot be checked is kept', () => {
    const before = 'The client was frustrated and threw the card.';
    const after = 'The client threw the card.';
    for (const why of ['Removed the opinion about frustration.', 'Recast staff opinion as observation.', 'Moved the IOA result to Feedback.']) {
      expect(checkedWhy(why, before, after), why).toBe(why);
    }
  });

  test('"replaced X with Y" holds when X went', () => {
    const why = 'Replaced "utilized" with "used".';
    expect(checkedWhy(why, 'The BT utilized a board.', 'The BT used a board.')).toBe(why);
    expect(checkedWhy(why, 'The BT utilized a board.', 'The BT utilized a board, carefully.')).toBe('');
  });

  test('an apostrophe never reads as a quote', () => {
    const why = "Removed the client's name from the BT's line.";
    expect(checkedWhy(why, "The client's mom said hi. Done.", 'Done.')).toBe(why);
  });

  test('a reason whose quote did not change is dropped, and one that did is kept', () => {
    const before = 'Preliminary assessment suggests escape. Elopement occurred twice.';
    const after = 'Preliminary assessment suggests escape. Elopement occurred on two occasions.';
    const reasons = [
      { quote: 'preliminary assessment suggests', why: 'Hedge removed.' },
      { quote: 'occurred twice', why: 'Counts in words.' },
      { quote: 'on two occasions', why: 'Counts in words.' },
      { quote: 'not in either text', why: 'Unmatched quotes are left alone.' },
    ];
    expect(checkedReasons(reasons, before, after).map((r) => r.quote)).toEqual([
      'occurred twice', 'on two occasions', 'not in either text',
    ]);
  });

  test('the corrections route applies both checks to what it returns', () => {
    const draft = [{ id: 'progress', text: BEFORE }];
    const after = 'Preliminary assessment suggests the behavior is maintained by escape. Elopement occurred on two occasions.';
    const found = correctionsFound(api({
      corrections: [{
        section: 'progress',
        text: after,
        why: 'Removed "preliminary assessment suggests". Wrote the count in words.',
        reasons: [
          { quote: 'preliminary assessment suggests', why: 'Hedge removed.' },
          { quote: 'on two occasions', why: 'Count in words.' },
        ],
      }],
    }), draft);
    expect(found.corrections).toEqual([{
      section: 'progress',
      text: after,
      why: 'Wrote the count in words.',
      reasons: [{ quote: 'on two occasions', why: 'Count in words.' }],
    }]);
  });
});

test.describe('the Assessment "Results of Assessment is empty" hint keys on the field', () => {
  const win = {};
  const ctx = vm.createContext({ window: win, console });
  for (const f of ['note-tools-util.js', 'register-rules.js', 'tools/assess.js']) {
    vm.runInContext(readFileSync(join(__dirname, '..', 'notes/bcba', f), 'utf8'), ctx, { filename: f });
  }
  const assess = win.NOTE_TOOLS.find((t) => t.id === 'assess');
  const hint = (detail) => ({ section: 'results', code: 'no_results', detail, rank: 1, kind: 'thin' });

  test('an empty field keeps the label, which is then true', () => {
    const out = assess.normalizeOutput({ results: '', hints: [hint('FBA')] });
    expect(out.hints.map((h) => [h.code, h.detail])).toEqual([['no_results', 'FBA']]);
  });

  test('a field with text says what is missing instead of calling it empty', () => {
    const out = assess.normalizeOutput({
      results: 'Crying stopped in the tangible condition and continued in the attention condition.',
      hints: [hint('no current rate for manding')],
    });
    expect(out.hints.map((h) => [h.code, h.detail])).toEqual([
      ['other', 'A finding is missing from Results of Assessment: no current rate for manding'],
    ]);
    expect(assess.hintCatalog.no_results).toMatch(/is empty/);
  });

  test('with no detail, the note stays true without naming the field empty', () => {
    const out = assess.normalizeOutput({ results: 'VB-MAPP Level 1.', hints: [hint('')] });
    expect(out.hints.map((h) => h.detail)).toEqual(['Results of Assessment may be missing a finding.']);
  });

  test('other hints pass through untouched', () => {
    const out = assess.normalizeOutput({
      results: 'VB-MAPP Level 1.',
      hints: [{ section: 'results', code: 'unscored_instrument', detail: 'Vineland-3', rank: 1, kind: 'thin' }],
    });
    expect(out.hints.map((h) => h.code)).toEqual(['unscored_instrument']);
  });
});
