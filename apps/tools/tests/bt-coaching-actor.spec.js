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

function load({ withChecks = true, log = console } = {}) {
  const win = {};
  const ctx = vm.createContext({ window: win, console: log });
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

  // Reviewer R331-H1, Atlas's call: a check never changes a tick. A wrong
  // untick removes the BCBA's alert; a wrong tick costs the technician a look.
  test('"Contact family, new behavior" stays ticked, with a hint to check it', () => {
    expect(out.actionItems).toEqual(['Contact family, new behavior']);
    expect(details(out)).toContain('actionItems: Check "new behavior": the notes name no new behavior.');
  });

  test('"Visual schedule" stays ticked, with a hint to check it', () => {
    expect(out.antecedentStrategies).toEqual(['Visual schedule', 'Offered choices']);
    expect(details(out)).toContain('antecedentStrategies: Check "Visual schedule": the notes name no schedule.');
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

test.describe('a real new behavior keeps its tick and raises no hint', () => {
  /* Reviewer R331-H1. The first eleven are the reviewer's phrasings quoted in
     the hold; the clinic bench case's own wording leads. The rest are the
     earlier pins and close variants. */
  const NEW = [
    'never hit at swing before',
    'never hit before today',
    'started to hit peers',
    'began to bite',
    'Hitting started this week',
    'pinching is new',
    'new: hair pulling',
    'biting (new)',
    'kicking - new',
    'kicked mom, not seen before',
    'first instance of biting',
    'new behavior: spitting x3',
    'spitting is new this week',
    'first time he bit',
    'started biting at snack',
    'new bx, screaming at transitions',
    'never seen him scratch before',
    'pushing peers started today',
    'brand new behavior, throwing shoes',
    'new onset of head banging',
  ];
  for (const said of NEW) {
    test(said, () => {
      const out = bt.normalizeOutput({ actionItems: ['Contact family, new behavior'] }, { intake: said });
      expect(out.actionItems).toEqual(['Contact family, new behavior']);
      expect(details(out).filter((d) => /new behavior/.test(d))).toEqual([]);
    });
  }

  test('a new target, a new material or a caregiver question keeps the tick but raises the hint', () => {
    for (const said of ['new targets added to tacting', 'need new velcro', 'mom asked about potty training']) {
      const out = bt.normalizeOutput({ actionItems: ['Contact family, new behavior'] }, { intake: said });
      expect(out.actionItems, said).toEqual(['Contact family, new behavior']);
      expect(details(out), said).toContain('actionItems: Check "new behavior": the notes name no new behavior.');
    }
  });

  test('a schedule in the notes raises no "Visual schedule" hint', () => {
    const out = bt.normalizeOutput({ antecedentStrategies: ['Visual schedule'] }, { intake: 'used picture schedule for transitions' });
    expect(out.antecedentStrategies).toEqual(['Visual schedule']);
    expect(details(out).filter((d) => /schedule/i.test(d))).toEqual([]);
  });
});

test.describe('the hints accept the words a technician actually writes', () => {
  const promptHints = (note, intake) =>
    details(bt.normalizeOutput({ lessonProgressNarrative: note }, { intake })).filter((d) => /prompt words/.test(d));

  test('a prompt level the notes name is not flagged', () => {
    expect(promptHints('Receptive ID: a full physical prompt was faded to a gestural prompt.', 'receptive ID, full physical faded to gesture')).toEqual([]);
  });

  // Reviewer R331 LOW: shorthand for the level the BT wrote.
  const SHORTHAND = [
    ['FP', 'a full physical prompt was used', 'sit down FP x3'],
    ['PP', 'a partial physical prompt was used', 'touch nose PP'],
    ['full phys', 'a full physical prompt was used', 'full phys on 2 trials'],
    ['hoh', 'hand over hand guidance was used', 'hoh for handwashing'],
    ['used a point', 'a gestural prompt was used', 'used a point to the cup'],
    ['pointed', 'a gestural prompt was used', 'pointed to the correct card'],
    ['FV', 'a full verbal prompt was used', 'FV for "help please"'],
    ['PV', 'a partial verbal prompt was used', 'PV "he.."'],
  ];
  for (const [name, note, intake] of SHORTHAND) {
    test(`"${name}" counts as the level the BT wrote`, () => {
      expect(promptHints('Program: ' + note + '.', intake)).toEqual([]);
    });
  }

  test('lowercase "fp" or "pp" in ordinary words is not read as a level', () => {
    expect(promptHints('Program: a full physical prompt was used.', 'app on ipad, fp')).toEqual([
      'lessonProgressNarrative: Notes never say "full physical"; use your own prompt words.',
    ]);
  });

  const coachHints = (note, intake) =>
    details(bt.normalizeOutput({ lessonProgressNarrative: note }, { intake })).filter((d) => /coaching/.test(d));

  test('"asked mom about" is a conversation, not coaching', () => {
    expect(coachHints('Manding: the client manded for juice.', 'asked mom about sleep. manding for juice')).toEqual([]);
  });

  // Reviewer R331 LOW: the note may report the coaching in caregiver words.
  for (const note of ['The behavior technician told mom to wait.', 'The technician told dad to wait three seconds.', 'The technician showed the father how to guide.', 'The technician reminded grandma to wait.']) {
    test(`coaching reported as "${note}" is not flagged`, () => {
      expect(coachHints(note, 'I told dad to wait 3 seconds before guiding')).toEqual([]);
    });
  }

  const indepHints = (note) =>
    details(bt.normalizeOutput({ lessonProgressNarrative: note }, { intake: 'indep on most' })).filter((d) => /independent/.test(d));

  // Reviewer R331 LOW: independent said another way is still independent.
  for (const note of ['The client completed most on his own.', 'She did most on her own.', 'The client responded without prompts on most trials.', 'Most responses were without a prompt.', 'Most were unprompted.']) {
    test(`"${note}" keeps independent`, () => {
      expect(indepHints(note)).toEqual([]);
    });
  }
});

test.describe('the checks run only on a real draft, and fail open', () => {
  test('without the intake, nothing is flagged', () => {
    const out = bt.normalizeOutput(BAD_DRAFT);
    expect(out.actionItems).toEqual(['Contact family, new behavior']);
    expect(out.antecedentStrategies).toEqual(['Visual schedule', 'Offered choices']);
    expect(out.hints).toEqual([]);
  });

  test('a page where bt-checks.js did not load drafts as before, and says so in the console', () => {
    const warned = [];
    const bare = load({ withChecks: false, log: { ...console, warn: (...a) => warned.push(a.join(' ')) } });
    const out = bare.normalizeOutput(BAD_DRAFT, { intake: INTAKE });
    expect(out.actionItems).toEqual(['Contact family, new behavior']);
    expect(out.hints).toEqual([]);
    expect(warned.some((w) => /BtChecks/.test(w))).toBe(true);
  });

  test('a loaded page does not warn', () => {
    const warned = [];
    const ok = load({ log: { ...console, warn: (...a) => warned.push(a.join(' ')) } });
    ok.normalizeOutput(BAD_DRAFT, { intake: INTAKE });
    expect(warned).toEqual([]);
  });
});

test.describe('the BT page loads the checks', () => {
  // Reviewer R331 LOW: the vm tests above cannot see a missing script tag.
  test('window.BtChecks is on /notes/bt/ before the tool registers', async ({ page }) => {
    await page.goto('/notes/bt/');
    await page.waitForFunction(() => (window.NOTE_TOOLS || []).some((t) => t.id === 'bt'));
    expect(await page.evaluate(() => typeof (window.BtChecks && window.BtChecks.apply))).toBe('function');
  });
});
