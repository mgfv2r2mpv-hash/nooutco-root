import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/* CARD bt-coaching-actor, from Kaleb's bench run of a telehealth
 * parent-coaching case, 2026-10-09. The note wrote that "the parent waited three
 * seconds before delivering a full physical prompt ... and the client completed
 * the direction on the next three trials", from an intake where the technician
 * coached dad on video, dad followed through, and the word was "guide".
 *
 * The prompt rules are pinned in the user prompt the browser sends. The checks
 * in bt-checks.js are pinned on Kaleb's case and its neighbours. Everything
 * runs the real files in a bare vm, so no server and no model call. */

const ROOT = join(__dirname, '..', 'notes/bcba');

function load({ withChecks = true } = {}) {
  const win = {};
  const ctx = vm.createContext({ window: win, console });
  const files = ['note-tools-util.js', 'register-rules.js']
    .concat(withChecks ? ['tools/bt-checks.js'] : [], ['tools/bt.js']);
  for (const f of files) {
    vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return win.NOTE_TOOLS.find((t) => t.id === 'bt');
}

const bt = load();

// Kaleb's case, as the engine hands it to normalizeOutput: the boxes plus the
// answer to the follow-up question.
const INTAKE = [
  'telehealth, dad and client home',
  "dad ran trials w me coaching on video. 'sit down' needed dad to guide him. indep on most of the others.",
  'used my turn / your turn card for the turn taking game',
  'no behaviors today',
  'mom asked about potty training',
  'I told dad to wait 3 seconds before guiding; he did it on the next 3 trials.',
].join('\n');

const BAD_DRAFT = {
  individualsPresent: ['Client', 'Parent/Caregiver'],
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative:
    'Following directions: The parent waited three seconds before delivering a full physical prompt guiding the client to seated position, and the client completed the direction on the next three trials following the physical guidance.',
  antecedentStrategies: ['Visual schedule', 'Offered choices'],
  antecedentNarrative: 'A visual schedule was used during the turn taking game.',
  consequenceEffectiveness: 'Highly effective at addressing behaviors and mitigating future incidents',
  behaviorPlanNarrative: 'No behaviors of concern occurred.',
  actionItems: ['Contact family, new behavior'],
  followUpNarrative: "BT to follow up with BCBA about: 1. Caregiver's request about a toilet training goal.",
  hints: [],
};

const details = (out) => out.hints.map((h) => h.section + ': ' + h.detail);

test.describe('the BT prompt carries the who-did-what rules', () => {
  const prompt = bt.buildUserPrompt({});
  const RULES = [
    ['every act keeps its actor', /Every act keeps the actor the notes give it\. The technician coached, the caregiver implemented, the client responded/],
    ['"he did it" after coaching is the caregiver', /the caregiver did it, not the client/],
    ['the coaching is reported', /the coaching is the service\. Report what the technician told, showed or modeled for the caregiver, the feedback given/],
    ['never drop the coaching', /Never drop the coaching/],
    ['no prompt level the notes did not name', /"Guide him" is written as guided\. Never turn it into full physical/],
    ['naming a prompt type is not a licence to supply one', /never a reason to supply one/],
    ['indep keeps independent', /"indep on most" means independent on most trials/],
    ['a turn card is not a visual schedule', /"my turn \/ your turn" card is a turn-taking card, not a visual schedule/],
    ['a caregiver question is not a new behavior', /A caregiver's question, such as one about toilet training, is not a new behavior/],
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
    // These rules ride in the user prompt on purpose. If they ever move into
    // SYSTEM_CORE, the stored copy has to be re-extracted in the same change.
    expect(bt.buildSystem()).not.toMatch(/WHO DID WHAT, IN THE NOTES' OWN WORDS/);
  });
});

test.describe("Kaleb's coaching case, after the checks", () => {
  const out = bt.normalizeOutput(BAD_DRAFT, { intake: INTAKE });

  test('"Contact family, new behavior" is unticked when no behavior was new', () => {
    expect(out.actionItems).toEqual([]);
    expect(details(out)).toContain('actionItems: Unticked "new behavior": the notes name no new behavior.');
  });

  test('"Visual schedule" is unticked when the notes name no schedule, and other ticks stay', () => {
    expect(out.antecedentStrategies).toEqual(['Offered choices']);
    expect(details(out)).toContain('antecedentStrategies: Unticked "Visual schedule": the notes name no schedule.');
  });

  test('the visual schedule in the prose is flagged where it is written', () => {
    expect(details(out)).toContain('antecedentNarrative: Notes name no visual schedule; name the support you used.');
  });

  test('"full physical" is flagged because the notes said "guide"', () => {
    expect(details(out)).toContain('lessonProgressNarrative: Notes never say "full physical"; use your own prompt words.');
  });

  test('the dropped coaching is flagged', () => {
    expect(details(out)).toContain('lessonProgressNarrative: Your coaching of the caregiver is missing from the note.');
  });

  test('"indep" lost in the note is flagged', () => {
    expect(details(out)).toContain('lessonProgressNarrative: Notes say "independent"; the note dropped it.');
  });

  test('the prose itself is never rewritten by a check', () => {
    expect(out.lessonProgressNarrative).toBe(BAD_DRAFT.lessonProgressNarrative);
    expect(out.antecedentNarrative).toBe(BAD_DRAFT.antecedentNarrative);
  });

  test('the draft object the model returned is not mutated', () => {
    expect(BAD_DRAFT.actionItems).toEqual(['Contact family, new behavior']);
    expect(BAD_DRAFT.antecedentStrategies).toEqual(['Visual schedule', 'Offered choices']);
  });
});

test.describe('a note that gets it right is left alone', () => {
  const GOOD = {
    ...BAD_DRAFT,
    lessonProgressNarrative:
      'Following directions: The behavior technician coached the father by video and told him to wait three seconds before guiding. He waited on the next three trials. The client was independent on most other directions.',
    antecedentStrategies: ['Other'],
    antecedentNarrative: 'A my turn / your turn card was used during the turn taking game.',
    actionItems: [],
  };
  const out = bt.normalizeOutput(GOOD, { intake: INTAKE });

  test('no check fires', () => {
    expect(out.hints).toEqual([]);
    expect(out.antecedentStrategies).toEqual(['Other']);
  });
});

test.describe('ticks the notes do support are kept', () => {
  test('a behavior the notes call new keeps "Contact family, new behavior"', () => {
    for (const said of ['new behavior: spitting x3', 'spitting is new this week', 'first time he bit', 'started biting at snack', 'new bx, screaming at transitions']) {
      const out = bt.normalizeOutput({ actionItems: ['Contact family, new behavior'] }, { intake: said });
      expect(out.actionItems, said).toEqual(['Contact family, new behavior']);
    }
  });

  test('a new target or a new material is not a new behavior', () => {
    for (const said of ['new targets added to tacting', 'need new velcro', 'mom asked about potty training']) {
      const out = bt.normalizeOutput({ actionItems: ['Contact family, new behavior'] }, { intake: said });
      expect(out.actionItems, said).toEqual([]);
    }
  });

  test('a schedule in the notes keeps "Visual schedule"', () => {
    const out = bt.normalizeOutput({ antecedentStrategies: ['Visual schedule'] }, { intake: 'used picture schedule for transitions' });
    expect(out.antecedentStrategies).toEqual(['Visual schedule']);
  });

  test('a prompt level the notes name is not flagged', () => {
    const out = bt.normalizeOutput(
      { lessonProgressNarrative: 'Receptive ID: a full physical prompt was faded to a gestural prompt.' },
      { intake: 'receptive ID, full physical faded to gesture' },
    );
    expect(details(out).filter((d) => /prompt words/.test(d))).toEqual([]);
  });

  test('"asked mom about" is a conversation, not coaching', () => {
    const out = bt.normalizeOutput({ lessonProgressNarrative: 'Manding: the client manded for juice.' }, { intake: 'asked mom about sleep. manding for juice' });
    expect(details(out).some((d) => /coaching/.test(d))).toBe(false);
  });
});

test.describe('the checks run only on a real draft, and fail open', () => {
  test('without the intake, nothing is unticked or flagged', () => {
    const out = bt.normalizeOutput(BAD_DRAFT);
    expect(out.actionItems).toEqual(['Contact family, new behavior']);
    expect(out.antecedentStrategies).toEqual(['Visual schedule', 'Offered choices']);
    expect(out.hints).toEqual([]);
  });

  test('a page where bt-checks.js did not load drafts as before', () => {
    const bare = load({ withChecks: false });
    const out = bare.normalizeOutput(BAD_DRAFT, { intake: INTAKE });
    expect(out.actionItems).toEqual(['Contact family, new behavior']);
    expect(out.hints).toEqual([]);
  });
});
