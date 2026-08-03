import { test, expect } from '@playwright/test';

// The style measurement runs in the browser and is the only thing standing
// between "we learn how a technician writes" and "we keep what they wrote".
// These pin both halves: that it detects a real change in the right direction,
// and that nothing but a number ever comes out of it.
//
// scrub-test.html loads style-features.js without React or Babel, so these run
// fast and cannot fail on a CDN hiccup.

const compare = (page, before, after, source = 'revision') =>
  page.evaluate(
    ({ b, a, s }) => window.NoteStyleFeatures.compare(b, a, s),
    { b: before, a: after, s: source },
  );

// Long enough to clear the minimum-length guard, in the register these notes use.
const BASE = [
  'The behavior technician implemented functional communication training during the morning session.',
  'The client demonstrated the ability to utilize the augmentative communication device independently.',
  'Reinforcement was delivered contingent upon appropriate requesting behavior throughout the session.',
  'The technician subsequently faded the gestural prompt across the remaining trials of the program.',
  'Data collection occurred continuously and indicated substantial improvement relative to baseline.',
].join(' ');

test.beforeEach(async ({ page }) => {
  await page.goto('/notes/scrub-test.html');
  await page.waitForFunction(() => !!(window.NoteStyleFeatures && window.NoteStyleFeatures.compare));
});

test.describe('what comes out is only ever a measurement', () => {
  test('an observation carries no text, at all', async ({ page }) => {
    const after = BASE.replace(
      'The client demonstrated the ability to utilize the augmentative communication device independently.',
      'Jacob used the device on his own.',
    );
    const out = await compare(page, BASE, after);
    expect(out.length).toBeGreaterThan(0);

    for (const o of out) {
      expect(Object.keys(o).sort()).toEqual(['direction', 'feature', 'magnitude', 'source']);
      expect(typeof o.feature).toBe('string');
      expect([1, -1]).toContain(o.direction);
      expect(o.magnitude).toBeGreaterThanOrEqual(0);
      expect(o.magnitude).toBeLessThanOrEqual(1);
    }

    // The name that was in the rewrite must not survive anywhere in the output.
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain('Jacob');
    expect(serialised).not.toContain('device');
    expect(serialised).not.toMatch(/[A-Z][a-z]{4,}\s/);
  });

  test('every feature emitted is one the profile store will accept', async ({ page }) => {
    // The closed list is duplicated across two deployables that share no module.
    // If they drift, learned signal is silently dropped on the floor.
    const known = [
      'sentence_length', 'plain_wording', 'actor_naming',
      'hedging', 'contractions', 'clause_density', 'quantification',
    ];
    const declared = await page.evaluate(() => window.NoteStyleFeatures.FEATURES);
    expect(declared.sort()).toEqual([...known].sort());
  });
});

test.describe('direction follows the edit', () => {
  test('shortening the prose reads as shorter sentences', async ({ page }) => {
    const short = [
      'The technician ran FCT.', 'The client used the device.', 'Prompts were faded.',
      'Data showed gains.', 'The session ended calmly.', 'Reinforcement followed requests.',
      'Trials were mixed.', 'The caregiver observed.', 'No escalation occurred.',
    ].join(' ');
    const out = await compare(page, BASE, short);
    const sl = out.find((o) => o.feature === 'sentence_length');
    expect(sl, 'sentence_length should be observed').toBeTruthy();
    expect(sl.direction).toBe(-1);
  });

  test('lengthening the prose reads as longer sentences', async ({ page }) => {
    const short = [
      'The technician ran FCT.', 'The client used the device.', 'Prompts were faded.',
      'Data showed gains.', 'The session ended calmly.', 'Reinforcement followed requests.',
      'Trials were mixed.', 'The caregiver observed.', 'No escalation occurred.',
    ].join(' ');
    // Same pair, reversed — the sign must reverse with it.
    const out = await compare(page, short, BASE);
    const sl = out.find((o) => o.feature === 'sentence_length');
    expect(sl).toBeTruthy();
    expect(sl.direction).toBe(1);
  });

  test('replacing elevated wording with plain wording reads as plainer', async ({ page }) => {
    const plain = BASE
      .replace('implemented functional communication training', 'ran communication training')
      .replace('demonstrated the ability to utilize', 'used')
      .replace('augmentative communication device', 'speech device')
      .replace('delivered contingent upon appropriate requesting behavior', 'given after each request')
      .replace('subsequently faded the gestural prompt', 'then faded the hand cue')
      .replace('indicated substantial improvement relative to baseline', 'showed clear gains over baseline');
    const out = await compare(page, BASE, plain);
    const pw = out.find((o) => o.feature === 'plain_wording');
    expect(pw, 'plain_wording should be observed').toBeTruthy();
    expect(pw.direction).toBe(-1);
  });

  test('naming who did what reads as more actor naming', async ({ page }) => {
    const actorless = [
      'Functional communication training was implemented during the morning session.',
      'Targets are taught using mixed trials across the program.',
      'Reinforcement was delivered contingent upon appropriate requesting.',
      'Prompts were faded across the remaining trials.',
      'Data collection occurred continuously throughout.',
    ].join(' ');
    const named = [
      'The behavior technician ran functional communication training during the morning session.',
      'The technician taught targets using mixed trials while the caregiver delivered the prompts.',
      'The technician reinforced appropriate requesting each time the client asked.',
      'The behavior technician faded prompts across the remaining trials.',
      'The technician collected data continuously throughout.',
    ].join(' ');
    const out = await compare(page, actorless, named);
    const an = out.find((o) => o.feature === 'actor_naming');
    expect(an, 'actor_naming should be observed').toBeTruthy();
    expect(an.direction).toBe(1);
  });

  test('removing hedges reads as less hedging', async ({ page }) => {
    const hedged = [
      'The client appeared to seem somewhat frustrated during the transition period.',
      'The technician may have possibly faded the prompt slightly too quickly in that trial.',
      'Behavior apparently tended to escalate relatively quickly after the demand was placed.',
      'The caregiver seemed to perhaps respond somewhat inconsistently across the observed trials.',
    ].join(' ');
    const direct = [
      'The client pushed the materials away during the transition period.',
      'The technician faded the prompt after two correct responses in that trial.',
      'Behavior escalated within ten seconds after the demand was placed.',
      'The caregiver responded on three of the five observed trials.',
    ].join(' ');
    const out = await compare(page, hedged, direct);
    const h = out.find((o) => o.feature === 'hedging');
    expect(h, 'hedging should be observed').toBeTruthy();
    expect(h.direction).toBe(-1);
  });

  test('adding counts reads as more quantification', async ({ page }) => {
    const vague = [
      'The client responded correctly on most of the trials that were presented.',
      'The technician faded the prompt after several correct responses in a row.',
      'Elopement occurred a few times and was blocked and redirected each time.',
      'The session ran for a while before the scheduled break was delivered.',
    ].join(' ');
    const counted = [
      'The client responded correctly on 8 of 10 trials that were presented.',
      'The technician faded the prompt after 3 correct responses in a row.',
      'Elopement occurred 2 times and was blocked and redirected each time.',
      'The session ran for 20 minutes before the scheduled 5 minute break.',
    ].join(' ');
    const out = await compare(page, vague, counted);
    const q = out.find((o) => o.feature === 'quantification');
    expect(q, 'quantification should be observed').toBeTruthy();
    expect(q.direction).toBe(1);
  });
});

test.describe('it stays quiet when there is nothing to learn', () => {
  test('an unchanged passage observes nothing', async ({ page }) => {
    expect(await compare(page, BASE, BASE)).toEqual([]);
  });

  test('a whitespace-only reflow observes nothing', async ({ page }) => {
    expect(await compare(page, BASE, BASE.replace(/ /g, '  '))).toEqual([]);
  });

  test('a passage too short to have a stable mean observes nothing', async ({ page }) => {
    // A one-line tweak must not cast a vote about someone's whole voice.
    expect(await compare(page, 'The client ran.', 'The client walked instead.')).toEqual([]);
  });

  test('a tiny edit inside a long passage stays under the noise floor', async ({ page }) => {
    const nudged = BASE.replace('substantial improvement', 'substantial progress');
    const out = await compare(page, BASE, nudged);
    // A single synonym swap should not move any measure meaningfully.
    expect(out.filter((o) => o.magnitude > 0.5)).toEqual([]);
  });

  test('empty and missing input is safe', async ({ page }) => {
    expect(await compare(page, '', BASE)).toEqual([]);
    expect(await compare(page, BASE, '')).toEqual([]);
    expect(await compare(page, null, null)).toEqual([]);
  });
});

test.describe('the source is carried through honestly', () => {
  test('a manual edit is labelled manual', async ({ page }) => {
    const short = ['The technician ran FCT.', 'The client used the device.', 'Prompts were faded.',
      'Data showed gains.', 'The session ended.', 'Reinforcement followed requests.',
      'Trials were mixed.', 'The caregiver observed.'].join(' ');
    const out = await compare(page, BASE, short, 'manual');
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((o) => o.source === 'manual')).toBe(true);
  });

  test('an unrecognised source falls back to revision rather than passing through', async ({ page }) => {
    const short = ['The technician ran FCT.', 'The client used the device.', 'Prompts were faded.',
      'Data showed gains.', 'The session ended.', 'Reinforcement followed requests.',
      'Trials were mixed.', 'The caregiver observed.'].join(' ');
    const out = await compare(page, BASE, short, "'; DROP TABLE correction_event; --");
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((o) => o.source === 'revision')).toBe(true);
  });
});

test.describe('the correction buffer behaves like the audit buffer', () => {
  test('a correction is buffered and cannot carry prose', async ({ page }) => {
    const buffered = await page.evaluate(() => {
      localStorage.removeItem('noaba.corrections.buffer.v1');
      window.NotesGate.audit.corrections([
        { feature: 'sentence_length', direction: -1, magnitude: 0.4, source: 'manual',
          before: 'Jacob eloped from the table.', after: 'The client left.' },
        { feature: 'not a feature', direction: 1 },
        { feature: 'hedging', direction: 0 },
        null,
      ]);
      return JSON.parse(localStorage.getItem('noaba.corrections.buffer.v1') || '[]');
    });

    expect(buffered).toHaveLength(1);
    expect(Object.keys(buffered[0]).sort()).toEqual(['direction', 'feature', 'magnitude', 'source', 'ts']);
    expect(JSON.stringify(buffered)).not.toContain('Jacob');
    expect(JSON.stringify(buffered)).not.toContain('eloped');
  });

  test('logging out discards buffered corrections rather than misattributing them', async ({ page }) => {
    // On a shared clinic laptop the next person to log in would otherwise
    // receive the previous technician's style evidence.
    const after = await page.evaluate(() => {
      localStorage.removeItem('noaba.corrections.buffer.v1');
      window.NotesGate.audit.corrections([{ feature: 'sentence_length', direction: -1 }]);
      const before = JSON.parse(localStorage.getItem('noaba.corrections.buffer.v1') || '[]').length;
      window.NotesGate.logout();
      const afterLogout = JSON.parse(localStorage.getItem('noaba.corrections.buffer.v1') || '[]').length;
      return { before, afterLogout };
    });
    expect(after.before).toBe(1);
    expect(after.afterLogout).toBe(0);
  });

  test('logging out also discards buffered audit events', async ({ page }) => {
    const after = await page.evaluate(() => {
      localStorage.removeItem('noaba.audit.buffer.v1');
      window.NotesGate.audit.emit('note_generated', { tool: 'bt', len_lesson: 10 });
      const before = JSON.parse(localStorage.getItem('noaba.audit.buffer.v1') || '[]').length;
      window.NotesGate.logout();
      const afterLogout = JSON.parse(localStorage.getItem('noaba.audit.buffer.v1') || '[]').length;
      return { before, afterLogout };
    });
    expect(after.before).toBe(1);
    expect(after.afterLogout).toBe(0);
  });
});
