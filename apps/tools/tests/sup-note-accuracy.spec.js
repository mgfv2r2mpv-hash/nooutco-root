import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/* CARD sup-note-accuracy, from Kaleb's Supervision bench run, 2026-10-09.
 *
 * The prompt rules are pinned in the user prompt the browser sends (the served
 * system prompt is pinned by hash in sup-prompt-rules.spec.js and is not
 * touched). The checks in sup-checks.js are pinned on the bench's own cases.
 * Everything runs the real files in a bare vm: no server, no model call. */

const ROOT = join(__dirname, '..', 'notes/bcba');

function load({ withChecks = true } = {}) {
  const win = {};
  const ctx = vm.createContext({ window: win, console });
  const files = ['note-tools-util.js', 'register-rules.js']
    .concat(withChecks ? ['tools/sup-checks.js'] : [], ['tools/sup.js']);
  for (const f of files) {
    vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return win.NOTE_TOOLS.find((t) => t.id === 'sup');
}

const sup = load();

const STEADY = 'Client is making steady, substantial progress towards meeting goals (see summary below)';
const MODERATE = 'Client is making moderate progress towards meeting goals (see summary below)';

// The bench's sup-bt-present-fidelity case, both boxes, as the engine joins them.
const FIDELITY_INTAKE = [
  'ran manding probe, client mands for 6 items now (was 4 two wks ago), new ones are juice and bubbles. tacting animals stalled 3 sessions at 40% so changed to errorless w immediate echoic prompt starting today. elopement 2x at transitions, BT blocked and redirected, both under 1 min, no injury. reviewed last weeks notes, no concerns, data entry looks complete.',
  'PF on DTT pacing, BT waiting too long between trials, modeled 3 sec ITI, BT had it by 3rd block. IOA on manding 90%. follow up: BT runs tacting w new prompt from today, I update program sheet by Fri.',
].join('\n');

// The bench's sup-thin-input case, with the answer Kaleb gave.
const THIN_INTAKE = [
  'observed DTT block on colors and shapes. client did ok, some prompting needed. short session, client sick.',
  'BT ok',
  'Told BT to fade to gesture on colors next session, no fidelity check today.',
].join('\n');

const details = (out) => out.hints.map((h) => h.section + ': ' + h.detail);

test.describe('the Supervision prompt carries the only-what-the-BCBA-wrote rules', () => {
  const prompt = sup.buildUserPrompt({ btPresent: true, clinicalNotes: 'x', staffNotes: '' });
  const RULES = [
    ['the rules override the section specs', /ONLY WHAT THE BCBA WROTE\. These rules override the section specifications where they differ/],
    ['feedback only from what was written', /feedback: only feedback the BCBA wrote or gave as an answer/],
    ['no invented fidelity or coaching', /Never describe how the technician performed, what was coached, or a fidelity or IOA finding the notes do not state/],
    ['a check not done was not done', /"no fidelity check today"\) was not done/],
    ['next steps only from the notes, else empty', /When the notes give no next step for a goal, leave that row's nextSteps as "" for the BCBA to fill/],
    ['follow-up only from the notes, else empty', /When the notes give no follow-up item, leave followup as ""/],
    ['nothing invented as a next step', /Never write a next step, an assessment to run, or a strategy to try that the notes do not name/],
    ['a named procedure stays named', /A named procedure stays named\. Errorless/],
    ['the errorless case', /"Changed to errorless w immediate echoic prompt" is written as a change to errorless teaching/],
    ['no invented prompt level', /Name a prompt level only when the notes name that level/],
    ['progress no higher than moderate on a stall or a new behavior', /when any program has stalled[^\n]*or a new behavior of concern appears, choose no higher than the moderate option/],
  ];
  for (const [name, re] of RULES) {
    test(name, () => {
      expect(prompt).toMatch(re);
    });
  }

  test('no em dash reaches the prompt', () => {
    expect(prompt).not.toMatch(/\u2014/);
  });

  test('the served system prompt is untouched, so voice-module parity holds', () => {
    expect(sup.buildSystem()).not.toMatch(/ONLY WHAT THE BCBA WROTE/);
  });
});

test.describe('overall progress is no higher than moderate on a stall or a new behavior', () => {
  test('tacting stalled 3 sessions: "steady, substantial" becomes moderate, with a hint saying so', () => {
    const out = sup.normalizeOutput({ overallProgress: STEADY, hints: [] }, { intake: FIDELITY_INTAKE });
    expect(out.overallProgress).toBe(MODERATE);
    expect(details(out)).toContain('overallProgress: Set to moderate: the notes report a stalled program.');
  });

  test('a new behavior of concern caps it too', () => {
    const out = sup.normalizeOutput({ overallProgress: STEADY }, { intake: 'manding up to 8. new behavior: spitting at peers x3.' });
    expect(out.overallProgress).toBe(MODERATE);
    expect(details(out)).toContain('overallProgress: Set to moderate: the notes report a new behavior of concern.');
  });

  test('the other stall words count', () => {
    for (const said of ['imitation w objects flat 2 wks', 'tacting plateaued', 'no progress on matching', 'receptive ID not progressing']) {
      expect(sup.normalizeOutput({ overallProgress: STEADY }, { intake: said }).overallProgress, said).toBe(MODERATE);
    }
  });

  test('moderate and minimal picks are never touched', () => {
    const minimal = 'Client is making minimal progress towards goals and/or is demonstrating barriers (see summary below)';
    expect(sup.normalizeOutput({ overallProgress: MODERATE }, { intake: FIDELITY_INTAKE }).overallProgress).toBe(MODERATE);
    expect(sup.normalizeOutput({ overallProgress: minimal }, { intake: FIDELITY_INTAKE }).overallProgress).toBe(minimal);
  });

  test('steady progress with nothing stalled and nothing new stays steady', () => {
    const out = sup.normalizeOutput({ overallProgress: STEADY, hints: [] }, { intake: 'manding 3 to 7 independent, new targets juice and bubbles, new baby sister home' });
    expect(out.overallProgress).toBe(STEADY);
    expect(out.hints).toEqual([]);
  });
});

test.describe('a named procedure stays named', () => {
  test('"errorless" dropped from the note is flagged on the whole note', () => {
    const out = sup.normalizeOutput({
      programming: 'Tacting animals stalled at 40%, so the program was changed to an immediate echoic prompt starting today.',
      hints: [],
    }, { intake: FIDELITY_INTAKE });
    expect(details(out)).toContain('note: Notes name "errorless"; the note dropped it.');
  });

  test('a note that keeps "errorless" is not flagged', () => {
    const out = sup.normalizeOutput({
      programming: 'Tacting animals stalled at 40%, so the program was changed to errorless teaching with an immediate echoic prompt starting today.',
    }, { intake: FIDELITY_INTAKE });
    expect(details(out).filter((d) => /dropped it/.test(d))).toEqual([]);
  });

  test('a procedure kept in a goal row counts as kept', () => {
    const out = sup.normalizeOutput({
      goalsAnalyzed: [{ goal: 'Tacting animals', progress: 'Moved to errorless teaching.', nextSteps: '' }],
    }, { intake: 'tacting animals changed to errorless' });
    expect(details(out).filter((d) => /dropped it/.test(d))).toEqual([]);
  });

  test('"shapes" as a program target is not the shaping procedure', () => {
    const out = sup.normalizeOutput({ progress: 'Colors and shapes were observed.' }, { intake: THIN_INTAKE });
    expect(details(out).filter((d) => /shaping/.test(d))).toEqual([]);
  });
});

test.describe('feedback: no prompt level the BCBA did not write', () => {
  test('thin input: invented "full physical" feedback is flagged where it is written', () => {
    const out = sup.normalizeOutput({
      feedback: 'The behavior technician demonstrated appropriate timing and delivery of gestural prompts for the colors program; coaching was provided regarding consistency of full physical prompting mechanics.',
      hints: [],
    }, { intake: THIN_INTAKE });
    expect(details(out)).toContain('feedback: Notes never say "full physical"; use your own prompt words.');
    // "gesture" is in the answer, so "gestural" is the BCBA's own level.
    expect(details(out).filter((d) => /"gestural"/.test(d))).toEqual([]);
  });

  test('the prose itself is never rewritten by a check', () => {
    const feedback = 'Coaching was provided on full physical prompting.';
    expect(sup.normalizeOutput({ feedback }, { intake: THIN_INTAKE }).feedback).toBe(feedback);
  });
});

test.describe('an empty next step stays empty', () => {
  test('a goal row with no next step survives with nextSteps ""', () => {
    const out = sup.normalizeOutput({
      goalsAnalyzed: [{ goal: 'Colors', progress: 'Mostly at gesture.', nextSteps: '' }],
      followup: '',
    }, { intake: THIN_INTAKE });
    expect(out.goalsAnalyzed).toEqual([{ goal: 'Colors', progress: 'Mostly at gesture.', nextSteps: '' }]);
    expect(out.followup).toBe('');
  });
});

test.describe('the checks run only on a real draft, and fail open', () => {
  test('without the intake, nothing is changed or flagged', () => {
    const out = sup.normalizeOutput({ overallProgress: STEADY, feedback: 'full physical', hints: [] });
    expect(out.overallProgress).toBe(STEADY);
    expect(out.hints).toEqual([]);
  });

  test('a page where sup-checks.js did not load drafts as before', () => {
    const bare = load({ withChecks: false });
    const out = bare.normalizeOutput({ overallProgress: STEADY, hints: [] }, { intake: FIDELITY_INTAKE });
    expect(out.overallProgress).toBe(STEADY);
    expect(out.hints).toEqual([]);
  });

  test('the reviewed-notes pick is left exactly as it was (Kaleb, 2026-10-09)', () => {
    for (const v of ['Yes', 'No', '']) {
      expect(sup.normalizeOutput({ reviewedNotes: v }, { intake: THIN_INTAKE }).reviewedNotes).toBe(v);
    }
  });

  test('the model output is not mutated', () => {
    const raw = { overallProgress: STEADY, hints: [] };
    sup.normalizeOutput(raw, { intake: FIDELITY_INTAKE });
    expect(raw.overallProgress).toBe(STEADY);
  });
});
