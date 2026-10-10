import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/* CARD sap-note-accuracy, from Kaleb's SAP bench run, 2026-10-09.
 *
 * The bench passed 3 of 3 and the drafts still had real errors. Each item he
 * listed gets a describe below: the rule the user prompt now carries, and the
 * check in sap-checks.js / sap-numbers.js that flags a draft breaking it.
 *
 * The intakes are the bench's own (scripts/bench/cases/sap.json), joined the
 * way the engine joins them: goal, specifications, then the Q/A answers. The
 * drafts are written to show each failure he saw, and the corrected version
 * of the same block, so every check is pinned in both directions.
 *
 * Everything runs the real files in a bare vm: no server, no model call. The
 * served system prompt is not touched (voice-module parity), and a test pins
 * that. */

const ROOT = join(__dirname, '..', 'notes/bcba');
const CASES = JSON.parse(readFileSync(join(__dirname, '..', 'scripts/bench/cases/sap.json'), 'utf8')).cases;
const byId = (id) => CASES.find((c) => c.id === id);

function load({ withChecks = true, log = console } = {}) {
  const win = {};
  const ctx = vm.createContext({ window: win, console: log });
  const files = ['note-tools-util.js', 'register-rules.js']
    .concat(withChecks ? ['tools/sap-numbers.js', 'tools/sap-checks.js'] : [], ['tools/sap.js']);
  for (const f of files) {
    vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return win.NOTE_TOOLS.find((t) => t.id === 'sap');
}

const sap = load();

// The engine's draftIntake: each box, then the answers block.
const intakeOf = (id, answers) => [byId(id).fields['Treatment Goal'], byId(id).fields['SAP Specifications'], answers].join('\n');

const AAC = intakeOf('sap-aac-manding', [
  'Q: How often does he use "more" right now?',
  `A: ${byId('sap-aac-manding').truth[0].answer}`,
  'Q: What does he work for right now?',
  `A: ${byId('sap-aac-manding').truth[1].answer}`,
].join('\n'));
const TWO_STEP = intakeOf('sap-two-step-instructions', [
  'Q: Which instructions should he start with?',
  `A: ${byId('sap-two-step-instructions').truth[0].answer}`,
].join('\n'));
const WAITING = intakeOf('sap-thin-waiting', [
  'Q: How long does he wait right now?',
  `A: ${byId('sap-thin-waiting').truth[0].answer}`,
  'Q: What is he motivated by?',
  `A: ${byId('sap-thin-waiting').truth[1].answer}`,
  'Q: What has been tried before?',
  `A: ${byId('sap-thin-waiting').truth[2].answer}`,
].join('\n'));

const draft = (out, intake) => sap.normalizeOutput(out, { intake });
const flags = (out) => out.hints.map((h) => `${h.section}: ${h.detail}`);
const flagged = (out, re) => flags(out).filter((f) => re.test(f));

test.describe('the user prompt carries the rules, and the served system prompt is untouched', () => {
  const user = sap.buildUserPrompt({ goal: 'g', sapSpecs: 's' });
  const labeled = sap.buildLabeledPrompt({ goal: 'g', sapSpecs: 's' });
  const RULES = [
    ['the rules override the defaults and templates', /WHAT THE BCBA SET STANDS\. These rules override the standing defaults and the section templates where they differ/],
    ['1: a stated method, criterion or direction stands', /prompting direction or prompt hierarchy the BCBA states[^\n]*is used exactly as stated for the target it names/],
    ['1: it may be asked about but never switched', /You may raise a question about it, but the plan is written with the BCBA's choice\. Never switch it/],
    ['1: his reason is never turned around', /"he gets frustrated with errors" is the reason FOR Most-to-Least/],
    ['2: a 2-step instruction is one SD', /A 2-step instruction \(or longer\) is delivered as ONE SD that contains every step/],
    ['2: reinforcement after every step', /Reinforcement is delivered only after the learner completes every step\. Never reinforce step 1 on its own, and never present step 2 as a new SD/],
    ['2: every block agrees', /The SD, Teaching Strategy, Correct Response, Incorrect Response and both Error Correction blocks all describe it this way/],
    ['3: percentages equal their fractions', /2 of 3 is 67%, not 80%/],
    ['3: 3-trial probes written as a count', /With 3-trial probes the only possible scores are 1 of 3, 2 of 3 and 3 of 3/],
    ['3: below baseline means below', /A starting value called below baseline is lower than the baseline figure the BCBA gave/],
    ['3: step plans reach their target honestly', /\(target minus start\) divided by the step size is the number of steps, and each step takes at least one session/],
    ['4: the refined goal adds nothing', /never add a deadline, a setting, a person or a count that is not in the goal, the specifications or an answer/],
    ['4: it overrides the authorization-period default', /This overrides the instruction to add 'by the end of 1 authorization period'/],
    ['5: reinforcers he names stay, with the amount', /Every reinforcer the BCBA names, in the specifications or in an answer, stays in the plan with the amount given/],
    ['5: reinforcer tablet and AAC device kept apart', /"30 seconds of tablet time" for the reinforcer, "the AAC device" for the communication device/],
    ['5: level count matches the list', /a stated number of levels matches the levels listed/],
    ['5: hierarchy and error correction agree', /Every level the error correction steps use, Independent included, is a level in the hierarchy/],
    ['5: no self-made contradiction handed to him', /Never write a rule that conflicts with another rule you wrote and then ask the BCBA to settle it/],
    ['6: readiness never requires the target behavior', /Readiness, and the moment to run the program, never require the behavior targeted for reduction/],
  ];
  for (const [name, re] of RULES) {
    test(name, () => {
      expect(user).toMatch(re);
      expect(labeled, 'the logged-out copy prompt carries it too').toMatch(re);
    });
  }

  test('the rules come after his goal and specifications', () => {
    expect(user.indexOf('SAP Specifications:\ns')).toBeLessThan(user.indexOf('WHAT THE BCBA SET STANDS'));
  });

  test('no em dash reaches either prompt', () => {
    expect(user).not.toMatch(/\u2014/);
    expect(labeled).not.toMatch(/\u2014/);
  });

  test('the served system prompt is untouched, so voice-module parity holds', () => {
    expect(sap.buildSystem()).not.toMatch(/WHAT THE BCBA SET STANDS/);
  });
});

test.describe('1. a prompting direction he stated stands (AAC manding)', () => {
  test('the bench intake states most-to-least for "help"', () => {
    const win = {};
    const ctx = vm.createContext({ window: win, console });
    for (const f of ['tools/sap-numbers.js', 'tools/sap-checks.js']) vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx);
    const stated = win.SapChecks.statedDirections(win.SapChecks.clinicianWords(AAC));
    expect(stated.map((s) => `${s.dir.name} ${s.scope}`)).toEqual(['most-to-least help']);
  });

  test('both buttons switched to least-to-most is flagged where it is written', () => {
    const out = draft({
      promptHierarchy: 'Least-to-Most (LtM) for both "more" and "help"\n* I (Independent): wait 5 seconds\n* G (Gestural): point to the button\n* PP (Partial Physical): tap the forearm\n* FP (Full Physical): guide the hand',
      teachingStrategy: 'Most-to-Least was flagged as frustrating, so least-to-most runs for both buttons.',
    }, AAC);
    expect(flagged(out, /most-to-least/)).toEqual(['promptHierarchy: Your notes say most-to-least for "help"; the draft uses least-to-most.']);
  });

  test('a draft that never uses most-to-least is flagged', () => {
    const out = draft({ promptHierarchy: 'Least-to-Most (LtM)\n* I (Independent): wait\n* G (Gestural): point' }, AAC);
    expect(flagged(out, /most-to-least/)).toEqual(['promptHierarchy: Your notes say most-to-least for "help"; the draft never uses it.']);
  });

  test('most-to-least for "help" and least-to-most for "more" is not flagged', () => {
    const out = draft({
      promptHierarchy: 'Most-to-Least (MtL) for "help"; Least-to-Most (LtM) for "more"\n* FP (Full Physical): guide the hand\n* PP (Partial Physical): tap the forearm\n* G (Gestural): point\n* I (Independent): wait 5 seconds',
    }, AAC);
    expect(flagged(out, /most-to-least|least-to-most/)).toEqual([]);
  });

  test('a draft rejecting least-to-most in words is not read as using it', () => {
    const out = draft({ promptHierarchy: 'Most-to-Least (MtL) for "help", rather than least-to-most\n* FP (Full Physical): guide' }, AAC);
    expect(flagged(out, /least-to-most/)).toEqual([]);
  });

  test('an intake with no stated direction leaves the direction to the tool', () => {
    const out = draft({ promptHierarchy: 'Least-to-Most (LtM)\n* I (Independent): wait' }, TWO_STEP);
    expect(flagged(out, /most-to-least|least-to-most/)).toEqual([]);
  });

  test('a question about the direction is allowed: a conflict entry is not a switch', () => {
    const out = draft({
      promptHierarchy: 'Most-to-Least (MtL) for "help"\n* FP (Full Physical): guide',
      conflicts: [{ sections: ['promptHierarchy'], kind: 'label_vs_description', question: 'You wrote "use most-to-least for "help"" and "already taps "more" with a gesture prompt". Keep most-to-least for help?', readings: [{ name: 'MtL', consequence: 'a' }, { name: 'LtM', consequence: 'b' }] }],
    }, AAC);
    expect(flagged(out, /most-to-least|least-to-most/)).toEqual([]);
  });
});

test.describe('2. a 2-step instruction is one SD, reinforced after both steps', () => {
  test('step 1 reinforced, then step 2 as a new SD: flagged in the SD, the strategy and error correction', () => {
    const out = draft({
      sd: '* The technician says step 1 while pointing, e.g. "Get your shoes."\n* After step 1 is completed, the technician delivers praise, then says step 2 as a new SD, e.g. "Sit down."',
      teachingStrategy: 'Each step is taught in sequence. The technician presents step 2 once step 1 is reinforced.',
      errorCorrectionInitial: '(1) If [CLIENT] does not complete step 1 within 5 seconds, the technician points to the item.\n(2) Deliver praise for step 1, then give the second instruction as a separate instruction.',
    }, TWO_STEP);
    const sections = flagged(out, /step [12]/i).map((f) => f.split(':')[0]);
    expect(sections).toEqual(['sd', 'sd', 'teachingStrategy', 'teachingStrategy', 'errorCorrectionInitial', 'errorCorrectionInitial']);
    expect(flags(out)).toContain('sd: Reinforcement after step 1 teaches two 1-step instructions; reinforce after both steps.');
    expect(flags(out)).toContain('sd: Step 2 is given as its own SD; a 2-step instruction is one SD with both steps.');
  });

  test('one SD with both steps and reinforcement after both: nothing flagged', () => {
    const out = draft({
      sd: '* The technician gives both steps as one instruction, paired with a point, e.g. "Get your shoes and sit down."\n* The instruction is repeated no more than once.',
      teachingStrategy: 'Reinforcement is delivered only after both steps are completed; completing step 1 alone earns no reinforcement.',
      errorCorrectionInitial: '(1) If [CLIENT] completes step 1 and wanders, the technician points to the chair.\n(2) The technician re-presents the whole 2-step instruction once.',
    }, TWO_STEP);
    expect(flagged(out, /step [12]/i)).toEqual([]);
  });

  test('a goal that is not a multi-step instruction is never read this way', () => {
    const out = draft({ sd: 'After step 1 is completed, deliver praise, then present step 2 as a new SD.' }, WAITING);
    expect(flagged(out, /step [12]/i)).toEqual([]);
  });
});

test.describe('3. the numbers agree with each other (waiting)', () => {
  const BAD = {
    teachingStrategy: 'Initial wait interval: 15 seconds. This starts below current baseline (10 seconds). Increase the wait by 15 seconds each session, reaching 2 minutes by session 3.',
    maintenanceCriteria: 'Probes run weekly at 3 trials. The skill is maintained when [CLIENT] passes 2 of 3 trials (80%).',
  };

  test('a start called below baseline that is above it is flagged with both numbers', () => {
    expect(flags(draft(BAD, WAITING))).toContain('teachingStrategy: Says below baseline (10 s) but starts at 15 s.');
  });

  test('the baseline comes from his answer when the draft does not quote it', () => {
    const out = draft({ teachingStrategy: 'The first interval is 15 seconds, below his baseline.' }, WAITING);
    expect(flags(out)).toContain('teachingStrategy: Says below baseline (10 s) but starts at 15 s.');
  });

  test('a step plan that cannot reach 2 minutes by session 3 is flagged with the arithmetic', () => {
    expect(flags(draft(BAD, WAITING))).toContain('teachingStrategy: 15 s steps from 15 s reach 2 min at session 8 at the earliest, not session 3.');
  });

  test('"2 of 3" beside 80% is flagged', () => {
    expect(flags(draft(BAD, WAITING))).toContain('maintenanceCriteria: 2 of 3 is 66.7%, but the same sentence says 80%.');
  });

  test('80% of a 3-trial probe is flagged even with no fraction written', () => {
    const out = draft({ maintenanceCriteria: 'Maintenance probes run at 3 trials. The skill is maintained at 80% accuracy.' }, WAITING);
    expect(flags(out)).toContain('maintenanceCriteria: 80% of 3 trials is 2.4 trials. Say 2 of 3 (66.7%) or 3 of 3 (100%).');
  });

  // Reviewer R334-H1: a rounded percentage of a whole trial count is the
  // same number, and ACCURACY_RULES itself says 2 of 3 is 67%.
  for (const said of [
    'Maintained at 2 of 3 trials (67%).',
    'Maintained at 2 of 3 trials (66.7%).',
    'Re-enter teaching at 1 of 3 trials (33%).',
    'Mastery at 5 of 6 trials (83%).',
    'Probes run at 3 trials and the skill is maintained at 67% or higher.',
  ]) {
    test(`a rounded percentage of a whole count is not flagged: "${said}"`, () => {
      expect(flagged(draft({ maintenanceCriteria: said }, WAITING), /^maintenanceCriteria/)).toEqual([]);
    });
  }

  test('a percentage no whole count of the trials can make is still flagged: "6 trials at 85%"', () => {
    const out = draft({ masteryCriteria: 'Each probe runs 6 trials at 85% accuracy.' }, WAITING);
    expect(flags(out)).toContain('masteryCriteria: 85% of 6 trials is 5.1 trials. Say 5 of 6 (83.3%) or 6 of 6 (100%).');
  });

  test('"2 of 3 trials at 80%" is still flagged', () => {
    const out = draft({ maintenanceCriteria: 'Maintained at 2 of 3 trials at 80%.' }, WAITING);
    expect(flags(out)).toContain('maintenanceCriteria: 2 of 3 is 66.7%, but the same sentence says 80%.');
  });

  test('the corrected plan raises nothing', () => {
    const out = draft({
      teachingStrategy: 'Initial wait interval: 5 seconds, below current baseline (10 seconds). Increase the wait by 15 seconds after 2 consecutive sessions at criterion, up to 2 minutes.',
      maintenanceCriteria: 'Probes run weekly at 3 trials. Maintained at 3 of 3 trials (100%), on 2 of 3 consecutive weekly probes.',
      masteryCriteria: 'Minimum 5 trials at 80% accuracy across 3 consecutive sessions.',
      correctResponse: '+ [CLIENT] waits without screaming; deliver the tablet or the swing in the yard',
    }, WAITING);
    expect(flags(out)).toEqual([]);
  });

  test('a reachable deadline is not flagged', () => {
    const out = draft({ teachingStrategy: 'Start at 30 seconds. Increase by 30 seconds each session, reaching 2 minutes by session 4.' }, WAITING);
    expect(flagged(out, /at the earliest/)).toEqual([]);
  });

  test('sessions or probes counted beside a percentage are a schedule, not a mismatch', () => {
    const out = draft({ generalizationCriteria: '80% accuracy on 2 of 3 consecutive probes with 2 of 3 caregivers.' }, WAITING);
    expect(flagged(out, /%/)).toEqual([]);
  });
});

test.describe('4. the refined goal adds no deadline, setting, person or count', () => {
  const GOAL = byId('sap-two-step-instructions').fields['Treatment Goal'];

  test('"by the end of 1 authorization period" on a goal without one is flagged', () => {
    const out = draft({ refinedGoal: GOAL.replace(/\.$/, ', by the end of 1 authorization period.') }, TWO_STEP);
    expect(flagged(out, /^refinedGoal/)).toEqual(['refinedGoal: Refined goal adds what your goal does not say: "by the end of 1 authorization period".']);
  });

  test('his goal as written is not flagged', () => {
    expect(flagged(draft({ refinedGoal: GOAL }, TWO_STEP), /^refinedGoal/)).toEqual([]);
  });

  test('made measurable without adding a fact is not flagged', () => {
    const out = draft({ refinedGoal: '[CLIENT] will request preferred items using a 2-button AAC page (more, help) in 8 of 10 opportunities (80%) across 3 consecutive sessions, absent behaviors targeted for reduction, during play and snack, as measured by direct observation.' }, AAC);
    expect(flagged(out, /^refinedGoal/)).toEqual([]);
  });

  test('an added setting, person and count are each named', () => {
    const out = draft({ refinedGoal: '[CLIENT] will request preferred items using a 2-button AAC page in 9 of 10 opportunities across 3 consecutive sessions, at school, with his teacher.' }, AAC);
    expect(flagged(out, /^refinedGoal/)).toEqual(['refinedGoal: Refined goal adds what your goal does not say: teacher, school, 9.']);
  });

  // Reviewer R334-H1 item 2: his own shorthand for a timeframe is his deadline.
  for (const [his, refined] of [
    ['within 1 auth period', 'within 1 authorization period'],
    ['by end of auth', 'by the end of the authorization period'],
    ['in 6 months', 'within 6 months'],
    ['by 6/30/2027', 'by June 30, 2027'],
  ]) {
    test(`his shorthand "${his}" is his deadline, reworded as "${refined}"`, () => {
      const intake = `Client will wait 2 minutes in 4 of 5 opportunities ${his}.\nhome only.`;
      const out = draft({ refinedGoal: `[CLIENT] will wait 2 minutes in 4 of 5 opportunities ${refined}, at home.` }, intake);
      expect(flagged(out, /^refinedGoal/)).toEqual([]);
    });
  }

  test('maintenance "for 4 weeks" is not a deadline, so an added authorization period is still flagged', () => {
    expect(TWO_STEP).toMatch(/for 4 weeks/);
    const out = draft({ refinedGoal: GOAL.replace(/\.$/, ' within 6 months.') }, TWO_STEP);
    expect(flagged(out, /^refinedGoal/)).toEqual(['refinedGoal: Refined goal adds what your goal does not say: "within 6 months".']);
  });

  test('a deadline he wrote himself stays his', () => {
    const intake = 'Client will wait 2 minutes in 4 of 5 opportunities within 1 authorization period.\nhome only.';
    const out = draft({ refinedGoal: '[CLIENT] will wait 2 minutes in 4 of 5 opportunities by the end of 1 authorization period, at home.' }, intake);
    expect(flagged(out, /^refinedGoal/)).toEqual([]);
  });
});

test.describe('5. AAC: reinforcers stay, the hierarchy agrees with itself, no self-made contradiction', () => {
  test('his answer names the tablet for 30 seconds and goldfish crackers', () => {
    const win = {};
    const ctx = vm.createContext({ window: win, console });
    for (const f of ['tools/sap-numbers.js', 'tools/sap-checks.js']) vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx);
    expect(win.SapChecks.namedReinforcers(AAC).map((r) => [r.item, r.seconds])).toEqual([['tablet', 30], ['goldfish', null]]);
  });

  test('"tablet" used only for the AAC device is flagged as a lost reinforcer', () => {
    const out = draft({
      lessonSetUp: '* Place the AAC tablet in front of [CLIENT] at snack.',
      correctResponse: '+ [CLIENT] taps "help" on the AAC tablet within 5 seconds',
      teachingStrategy: 'Deliver one goldfish cracker contingent on each request.',
    }, AAC);
    expect(flags(out)).toContain('note: "tablet" now only means the AAC device; the tablet reinforcer is gone.');
  });

  test('the tablet kept without its 30 seconds is flagged', () => {
    const out = draft({ teachingStrategy: 'Deliver tablet access or one goldfish cracker contingent on each request.' }, AAC);
    expect(flags(out)).toContain('note: You gave tablet for 30 s; the draft never says how long.');
  });

  test('both reinforcers kept, with the amount, and the device named apart: nothing flagged', () => {
    const out = draft({
      lessonSetUp: '* Place the AAC device in front of [CLIENT] at snack.',
      teachingStrategy: 'Deliver 30 seconds of tablet time or one goldfish cracker contingent on each request.',
    }, AAC);
    expect(flagged(out, /reinforcer|how long/)).toEqual([]);
  });

  test('the waiting answer keeps the tablet and the swing', () => {
    const out = draft({ correctResponse: '+ waits without screaming; deliver the tablet' }, WAITING);
    expect(flags(out)).toContain('note: You named swing as a reinforcer; the draft never uses it.');
  });

  test('"five distinct levels" over four listed is flagged', () => {
    const out = draft({
      teachingStrategy: 'Most-to-Least for "help" across five distinct levels.',
      promptHierarchy: 'Most-to-Least (MtL)\n* FP (Full Physical): guide\n* PP (Partial Physical): tap\n* G (Gestural): point\n* I (Independent): wait',
    }, AAC);
    expect(flags(out)).toContain('teachingStrategy: Says 5 levels; the Prompt Hierarchy lists 4.');
  });

  test('"drop back one level" is not a level count', () => {
    const out = draft({
      promptHierarchy: 'Most-to-Least (MtL) for "help"\n* FP (Full Physical): guide\n* PP (Partial Physical): tap\n* G (Gestural): point\n* I (Independent): wait',
      errorCorrectionInitial: '(1) Drop back one level and re-present.',
    }, AAC);
    expect(flagged(out, /levels/)).toEqual([]);
  });

  test('error correction starting at independent after Independent left the hierarchy is flagged', () => {
    const out = draft({
      promptHierarchy: 'Most-to-Least (MtL) for "help"\n* FP (Full Physical): guide\n* PP (Partial Physical): tap\n* G (Gestural): point',
      errorCorrectionInitial: '(1) Start at independent: present the SD and wait 5 seconds.\n(2) Return to the full physical prompt.',
    }, AAC);
    expect(flags(out)).toContain('errorCorrectionInitial: Error correction uses "independent", which the Prompt Hierarchy does not list.');
  });

  test('an independent response is a response, not a level', () => {
    const out = draft({
      promptHierarchy: 'Most-to-Least (MtL) for "help"\n* FP (Full Physical): guide\n* G (Gestural): point',
      errorCorrectionInitial: '(1) Reinforce an independent response at once.\n(2) Return to the full physical prompt.',
    }, AAC);
    expect(flagged(out, /Error correction uses/)).toEqual([]);
  });

  test('two re-entry counts are flagged', () => {
    const out = draft({
      maintenanceCriteria: 'Probe weekly at 3 trials. After 1 probe below criterion, re-enter teaching.',
      errorCorrectionMaintenance: '(1) Re-present the SD.',
      reentryRule: 'After 2 consecutive maintenance probes below Maintenance Criteria, contact the BCBA so the skill can re-enter teaching.',
    }, AAC);
    expect(flags(out)).toContain('errorCorrectionMaintenance: One block re-enters after 1 low probe, another after 2; the plan should say one.');
  });

  test('a question asking him to settle two rules the draft wrote itself is flagged', () => {
    const out = draft({
      conflicts: [{
        sections: ['maintenanceCriteria', 'errorCorrectionMaintenance'],
        kind: 'figures',
        question: 'Maintenance says "re-enter after 1 probe below 80%" and the note says "after 2 consecutive maintenance probes". Which holds?',
        readings: [{ name: 'One probe', consequence: 'a' }, { name: 'Two probes', consequence: 'b' }],
      }],
    }, AAC);
    expect(flags(out)).toContain('maintenanceCriteria: This question is about two rules the draft wrote itself; the draft should make them agree.');
  });

  test('a question quoting his own words is a real question and is left alone', () => {
    const out = draft({
      conflicts: [{
        sections: ['masteryCriteria'],
        kind: 'figures',
        question: 'You wrote "mastery as in the goal" and the goal says "8 of 10 opportunities". Keep 8 of 10?',
        readings: [{ name: '8 of 10', consequence: 'a' }, { name: '80% over 5', consequence: 'b' }],
      }],
    }, AAC);
    expect(flagged(out, /wrote itself/)).toEqual([]);
  });
});

test.describe('6. readiness never requires the behavior being replaced', () => {
  test('"has grabbed in the last 30 seconds" is flagged', () => {
    const out = draft({ lessonSetUp: '* Arrange the AAC device at snack.\n* Ready when [CLIENT] has reached for or grabbed a preferred item in the last 30 seconds.' }, AAC);
    expect(flags(out)).toContain('lessonSetUp: Readiness waits for "grabbed", a behavior targeted for reduction.');
  });

  test('a sign of motivation that is not the behavior is not flagged', () => {
    const out = draft({ lessonSetUp: '* Ready when [CLIENT] looks at or moves toward a preferred item, before any grabbing.' }, AAC);
    expect(flagged(out, /Readiness/)).toEqual([]);
  });

  test('screaming named as a pause condition is not a readiness requirement', () => {
    const out = draft({ lessonSetUp: '* Ready when calm and not screaming.\n* Pause if screaming lasts past 1 minute.' }, WAITING);
    expect(flagged(out, /Readiness/)).toEqual([]);
  });
});

test.describe('hints only, fail-open, and revisions read the plan against itself', () => {
  test('no block is rewritten: every section comes back as the model wrote it', () => {
    const raw = {
      teachingStrategy: 'Initial wait interval: 15 seconds. This starts below current baseline (10 seconds).',
      refinedGoal: 'x by the end of 1 authorization period',
    };
    const out = draft(raw, WAITING);
    expect(out.teachingStrategy).toBe(raw.teachingStrategy);
    expect(out.refinedGoal).toBe(raw.refinedGoal);
  });

  test('the model\'s own hints are kept beside the checks', () => {
    const out = draft({ hints: [{ section: 'sd', code: 'thin_section', detail: 'model hint' }], refinedGoal: 'x by the end of 1 authorization period' }, WAITING);
    expect(flags(out)).toContain('sd: model hint');
    expect(flagged(out, /^refinedGoal/).length).toBe(1);
  });

  test('without the check files the page drafts exactly as before', () => {
    const bare = load({ withChecks: false });
    const out = bare.normalizeOutput({ refinedGoal: 'x by the end of 1 authorization period', hints: [] }, { intake: WAITING });
    expect(out.hints).toEqual([]);
    expect(out.refinedGoal).toBe('x by the end of 1 authorization period');
  });

  test('a page where the check files did not load says so in the console', () => {
    const warned = [];
    const bare = load({ withChecks: false, log: { ...console, warn: (...a) => warned.push(a.join(' ')) } });
    bare.normalizeOutput({ hints: [] }, { intake: WAITING });
    expect(warned.some((w) => /SapChecks/.test(w))).toBe(true);
  });

  test('a loaded page does not warn', () => {
    const warned = [];
    const ok = load({ log: { ...console, warn: (...a) => warned.push(a.join(' ')) } });
    ok.normalizeOutput({ hints: [] }, { intake: WAITING });
    expect(warned).toEqual([]);
  });

  test('no intake (not a real draft) means no checks against an intake', () => {
    const out = sap.normalizeOutput({ refinedGoal: 'x by the end of 1 authorization period' });
    expect(out.hints).toEqual([]);
  });

  test('a revision flags what the plan says against itself', () => {
    const current = {
      promptHierarchy: 'Most-to-Least (MtL)\n* FP (Full Physical): guide\n* PP (Partial Physical): tap\n* G (Gestural): point\n* I (Independent): wait',
      errorCorrectionInitial: '(1) Start at independent: present the SD and wait 5 seconds.',
    };
    const out = sap.mergeRevision({
      edits: [{ section: 'promptHierarchy', content: 'Most-to-Least (MtL)\n* FP (Full Physical): guide\n* PP (Partial Physical): tap\n* G (Gestural): point', why: 'removed Independent' }],
      dependents: [], conflicts: [], hints: [], design: [],
    }, current);
    expect(flags(out)).toContain('errorCorrectionInitial: Error correction uses "independent", which the Prompt Hierarchy does not list.');
  });

  test('a revision is never read against the first intake: his newer instruction can change the direction', () => {
    const out = sap.mergeRevision({
      edits: [{ section: 'promptHierarchy', content: 'Least-to-Most (LtM) for "help"\n* I (Independent): wait\n* G (Gestural): point', why: 'BCBA asked for LtM' }],
      dependents: [], conflicts: [], hints: [], design: [],
    }, { promptHierarchy: 'Most-to-Least (MtL) for "help"' });
    expect(flagged(out, /most-to-least/)).toEqual([]);
  });
});

test.describe('the SAP page loads the checks', () => {
  // Reviewer R334-H1 item 3: the vm tests above cannot see a missing script tag.
  test('window.SapChecks and window.SapNumbers are on /notes/sap/ once the page has loaded', async ({ page }) => {
    await page.goto('/notes/sap/');
    await page.waitForFunction(() => (window.NOTE_TOOLS || []).some((t) => t.id === 'sap'));
    await page.waitForLoadState('load');
    expect(await page.evaluate(() => typeof (window.SapChecks && window.SapChecks.apply))).toBe('function');
    expect(await page.evaluate(() => typeof (window.SapNumbers && window.SapNumbers.check))).toBe('function');
  });
});
