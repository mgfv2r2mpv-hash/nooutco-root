import { test, expect } from '@playwright/test';
import { tokenFamily } from './helpers/token-reshape.js';

/* EVERY WORD THE SCRUB TOOK COMES BACK, IN EVERY SHAPE THE MODEL RETURNS IT.
 *
 * Kaleb's sup note on 2026-09-24 came back reading "Goal: T2 (Behavior T3)",
 * "Goal: T4", "Goal: T1" and "prompted 'T6 now' and 'T5 done'". The model had
 * dropped the brackets off [[T2]] and the rest, and the restorer only matched a
 * token with a bracket around it. His ruling that day: what was removed MUST be
 * put back on the page. Full stop.
 *
 * The bare form used to be left for the alert check to catch, on the reasoning
 * that swapping a word for a loose T3 could corrupt a sentence the clinician
 * wrote. That risk is closed at the source instead: the scrub never mints a
 * number the intake already spells, so a T3 the clinician typed can never be a
 * number this note issued.
 *
 * Three parts:
 *   1  his note, end to end through the real scrub
 *   2  the sweep: every shape x every sentence position x several numbers
 *   3  the controls: what must NOT change
 */

const INTAKE = [
  'BCBA in home with client, BT, mother and father for session. Goals assessed in session:',
  '* Aggresion (Bx Reduction): 1 instance toward BCBA when BCBA made a sound during physical play as a whistle noise.',
  '* Throwing (Bx Reduction) - 2 instances in session of throwing magnatiles to the floor.',
  '* Self-Aggression did not occurr in session.',
  '* Screaming: BCBA noted 3 instances. He was prompted "not now" and "All done" and said both, then later said "no gusta".',
].join('\n');

async function loggedIn(page) {
  await page.goto('/notes/bt/');
  await page.evaluate(() => {
    const payload = { role: 'user', kid: 'pw:tech-1', tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    localStorage.setItem('notes_auth_token', `${b64}.local-test`);
  });
  await page.reload();
  await page.waitForFunction(() => window.NotesScrub && window.NotesGate && window.NotesGate._scrub);
}

// ───────────────────────────────────────────── 1  his note, end to end

test.describe('the 2026-09-24 sup note', () => {
  test('every opaque token the scrub issued comes back as the word, when the model drops the brackets', async ({ page }) => {
    await loggedIn(page);
    const out = await page.evaluate(async (intake) => {
      const r = await window.NotesScrub.review({ freeText: intake });
      const opaque = r.map.filter((e) => /^\[\[T\d+\]\]$/.test(e.token));
      // The model's reply: every opaque token written bare, the way his came back.
      const bare = (s) => s.replace(/\[\[T(\d+)\]\]/g, 'T$1');
      const sent = window.NotesScrub.applyMap(intake, r.map);
      const reply = {
        goals: opaque.map((e) => ({ goal: bare(e.token), progress: `Noted ${bare(e.token)} in session.` })),
        summary: bare(sent),
        quote: opaque.map((e) => `'${bare(e.token)} now'`).join(' and '),
      };
      return {
        issued: opaque.map((e) => ({ name: e.name, token: e.token })),
        sent,
        restored: window.NotesScrub.restoreOutput(reply, r.map),
      };
    }, INTAKE);

    // Control: the scrub really did take words, or nothing below is tested.
    expect(out.issued.length, `no opaque tokens were issued; sent: ${out.sent}`).toBeGreaterThan(0);

    const flat = JSON.stringify(out.restored);
    expect(flat, `a token reached the note: ${flat}`).not.toMatch(tokenFamily());
    for (const e of out.issued) {
      expect(flat, `${e.token} (${e.name}) did not come back`).toContain(e.name);
    }
  });
});

// ───────────────────────────────────────────── 2  the sweep

/* Every shape a model has returned, or plausibly would, for token number n.
   The bare ones are what he hit; the rest keep the bracket families honest. */
const FW = (d) => String(d).replace(/\d/g, (c) => String.fromCharCode(0xff10 + Number(c)));
const SHAPES = {
  canonical: (n) => `[[T${n}]]`,
  bare: (n) => `T${n}`,
  bareLower: (n) => `t${n}`,
  bareHyphen: (n) => `T-${n}`,
  bareUnderscore: (n) => `T_${n}`,
  barePadded: (n) => `T0${n}`,
  bold: (n) => `**T${n}**`,
  italic: (n) => `*T${n}*`,
  code: (n) => '`T' + n + '`',
  doubleQuoted: (n) => `"T${n}"`,
  singleQuoted: (n) => `'T${n}'`,
  curlyQuoted: (n) => `\u201CT${n}\u201D`,
  possessive: (n) => `T${n}'s`,
  single: (n) => `[T${n}]`,
  lowerDouble: (n) => `[[t${n}]]`,
  spaced: (n) => `[[T ${n}]]`,
  paddedInside: (n) => `[[ T${n} ]]`,
  unbalancedLeft: (n) => `[[T${n}]`,
  unbalancedRight: (n) => `[T${n}]]`,
  looseSpaced: (n) => `[ t ${n} ]`,
  escaped: (n) => `\\[T${n}\\]`,
  escapedDouble: (n) => `\\[\\[T${n}\\]\\]`,
  paren: (n) => `(T${n})`,
  doubleParen: (n) => `((T${n}))`,
  hyphenated: (n) => `[T-${n}]`,
  underscored: (n) => `[T_${n}]`,
  padded: (n) => `[[T0${n}]]`,
  braces: (n) => `{T${n}}`,
  doubleBraces: (n) => `{{T${n}}}`,
  angle: (n) => `<T${n}>`,
  guillemets: (n) => `\u00ABT${n}\u00BB`,
  singleGuillemets: (n) => `\u2039T${n}\u203A`,
  halfwidthCorner: (n) => `\uFF62T${n}\uFF63`,
  corner: (n) => `\u300CT${n}\u300D`,
  whiteCorner: (n) => `\u300ET${n}\u300F`,
  lenticular: (n) => `\u3010T${n}\u3011`,
  tortoise: (n) => `\u3014T${n}\u3015`,
  angleCjk: (n) => `\u3008T${n}\u3009`,
  doubleAngleCjk: (n) => `\u300AT${n}\u300B`,
  fullwidthParen: (n) => `\uFF08T${n}\uFF09`,
  fullwidthSquare: (n) => `\uFF3BT${n}\uFF3D`,
  whiteSquare: (n) => `\u301AT${n}\u301B`,
  fullwidthT: (n) => `\uFF34${n}`,
  fullwidthDigits: (n) => `T${FW(n)}`,
  fullwidthBoth: (n) => `[\uFF34${FW(n)}]`,
  markdownLink: (n) => `[T${n}]()`,
  hashNumber: (n) => `T#${n}`,
  bracketHash: (n) => `[T#${n}]`,
  tokenWord: (n) => `[Token ${n}]`,
  tokenBare: (n) => `Token ${n}`,
  tokenBareLower: (n) => `token ${n}`,
};

/* Where in a sentence the token sits. Each one has been, or could be, the
   neighbour that stops a pattern matching. */
const CONTEXTS = {
  alone: (t) => t,
  start: (t) => `${t} occurred twice in session.`,
  middle: (t) => `Client showed ${t} during play.`,
  end: (t) => `Staff responded to ${t}.`,
  comma: (t) => `After ${t}, staff redirected.`,
  colon: (t) => `Goal: ${t}`,
  label: (t) => `Goal: ${t} (Behavior Reduction)`,
  newline: (t) => `Progress\n${t}\nNext steps`,
  bullet: (t) => `* ${t} did not occur`,
  quotedPhrase: (t) => `prompted '${t} now' and repeated`,
  semicolon: (t) => `${t}; no further instances`,
  question: (t) => `Was ${t} observed?`,
  dash: (t) => `Throwing - ${t} - stayed level`,
  slash: (t) => `choices/${t}/first-then`,
};

/* Low numbers for the ledgers saved before the floor, and the T101-up range
   the scrub mints today. */
const NUMBERS = [1, 2, 7, 12, 101, 106, 150];
const WORD = (n) => `word${n}x`;

test.describe('the sweep: every shape, every position, several numbers', () => {
  test(`${Object.keys(SHAPES).length} shapes x ${Object.keys(CONTEXTS).length} positions x ${NUMBERS.length} numbers all restore`, async ({ page }) => {
    await loggedIn(page);
    const cases = [];
    for (const [shape, make] of Object.entries(SHAPES)) {
      for (const [ctx, place] of Object.entries(CONTEXTS)) {
        for (const n of NUMBERS) {
          cases.push({ id: `${shape}/${ctx}/${n}`, n, text: place(make(n)), want: place(WORD(n)) });
        }
      }
    }
    const results = await page.evaluate(({ cases, numbers }) => {
      const map = numbers.map((n) => ({ name: `word${n}x`, token: `[[T${n}]]`, restore: true }));
      return cases.map((c) => ({ id: c.id, got: window.NotesScrub.restoreOutput(c.text, map), text: c.text }));
    }, { cases, numbers: NUMBERS });

    const failures = results.filter((r, i) => r.got.indexOf(WORD(cases[i].n)) === -1 || tokenFamily().test(r.got));
    // A count here, so the report says how many of how many, not just the first.
    expect(
      failures.map((f) => `${f.id}: ${JSON.stringify(f.text)} -> ${JSON.stringify(f.got)}`),
      `${failures.length} of ${results.length} cases left a token`,
    ).toEqual([]);
    expect(results.length).toBeGreaterThan(2000);
  });

  /* The alert check exists for the day the restorer misses, so it has to see
     every shape the restorer handles. Handed the raw, unrestored reply, it must
     raise a tier one for each. */
  test('the alert check flags every one of those shapes when the restorer is skipped', async ({ page }) => {
    await loggedIn(page);
    await page.waitForFunction(() => !!window.AlertBudget);
    const cases = [];
    for (const [shape, make] of Object.entries(SHAPES)) {
      for (const [ctx, place] of Object.entries(CONTEXTS)) {
        cases.push({ id: `${shape}/${ctx}`, text: place(make(7)) });
      }
    }
    const missed = await page.evaluate((cases) => {
      const map = [{ name: 'word7x', token: '[[T7]]', restore: true }];
      return cases.filter((c) => {
        const b = window.AlertBudget.build({ map, output: { lessonProgressNarrative: c.text } }, { cap: 99 });
        return !b.shown.some((i) => i.code === 'token_in_note' && i.tier === 1);
      }).map((c) => `${c.id}: ${JSON.stringify(c.text)}`);
    }, cases);
    expect(missed, `${missed.length} of ${cases.length} shapes went unflagged`).toEqual([]);
  });

  test('merged runs of several tokens restore every one', async ({ page }) => {
    await loggedIn(page);
    const RUNS = [
      '[[T1, T2]]', '[T1, T2]', '(T1, T2)', '[[T1]][[T2]]', '[[T1]] [[T2]]', 'T1, T2', 'T1 and T2',
      'T1/T2', 'T1-T2', 'T1 & T2', '[T1][T2]', 'T1;T2', '{T1, T2}', '[[T1/T2]]', 'T1,T2',
      'T1T2', '**T1** and **T2**', 'Token 1 and Token 2',
    ];
    const got = await page.evaluate((runs) => {
      const map = [
        { name: 'Aggresion', token: '[[T1]]', restore: true },
        { name: 'Throwing', token: '[[T2]]', restore: true },
      ];
      return runs.map((r) => ({ run: r, out: window.NotesScrub.restoreOutput(`Targets ${r} today.`, map) }));
    }, RUNS);
    const bad = got.filter((g) => !g.out.includes('Aggresion') || !g.out.includes('Throwing') || tokenFamily().test(g.out));
    expect(bad.map((b) => `${b.run} -> ${b.out}`)).toEqual([]);
  });

  test('restores inside the whole JSON shape a note comes back in', async ({ page }) => {
    await loggedIn(page);
    const out = await page.evaluate(() => {
      const map = [
        { name: 'Self-Aggression', token: '[[T1]]', restore: true },
        { name: 'Aggresion', token: '[[T2]]', restore: true },
        { name: 'Reduction', token: '[[T3]]', restore: true },
        { name: 'Throwing', token: '[[T4]]', restore: true },
        { name: 'All', token: '[[T5]]', restore: true },
        { name: 'not', token: '[[T6]]', restore: true },
      ];
      // His reply, verbatim in the parts that carried tokens.
      const reply = {
        goalsAnalyzed: [
          { goal: 'T2 (Behavior T3)', progress: 'One instance toward BCBA.' },
          { goal: 'T4 (Behavior T3)', progress: 'Two instances.' },
          { goal: 'T1', progress: 'No instances occurred in session.' },
          { goal: 'Screaming', progress: "client was prompted 'T6 now' and 'T5 done,' repeated both phrases, and later independently requested T6" },
        ],
        summary: 'The target behavior T2 occurred once. T1 did not occur.',
        protocol: "prompting fuller phrases such as 'T6 right now' or 'In a minute,'",
        behavior: "was prompted to use specific phrases ('T6 now,' 'T5 done')",
        nested: { deeper: [['T4'], { x: 'T3' }] },
        count: 3,
        flag: true,
        empty: null,
      };
      return window.NotesScrub.restoreOutput(reply, map);
    });
    const flat = JSON.stringify(out);
    expect(flat).not.toMatch(tokenFamily());
    expect(out.goalsAnalyzed[0].goal).toBe('Aggresion (Behavior Reduction)');
    expect(out.goalsAnalyzed[1].goal).toBe('Throwing (Behavior Reduction)');
    expect(out.goalsAnalyzed[2].goal).toBe('Self-Aggression');
    expect(out.goalsAnalyzed[3].progress).toContain("'not now' and 'All done,'");
    expect(out.protocol).toContain("'not right now'");
    expect(out.nested.deeper[0][0]).toBe('Throwing');
    expect(out.count).toBe(3);
    expect(out.flag).toBe(true);
    expect(out.empty).toBe(null);
  });
});

// ───────────────────────────────────────────── 3  what must not change

test.describe('the controls', () => {
  /* The reviewer's case. ABA notes label trials T1, T2, T3 without being asked,
     so the model coins them in its own prose. The scrub mints from T101 up, so
     none of those can be a number this note issued. */
  test("the model's own trial labels stay trial labels, while its bare tokens come back", async ({ page }) => {
    await loggedIn(page);
    const out = await page.evaluate(async (intake) => {
      const r = await window.NotesScrub.review({ freeText: intake });
      const opaque = r.map.filter((e) => /^\[\[T\d+\]\]$/.test(e.token));
      const bare = opaque.map((e) => e.token.replace(/\[\[T(\d+)\]\]/, 'T$1'));
      const reply = `Across T1, T2, T3 the client responded on T1 and T3 but not T2. Targets: ${bare.join(', ')}.`;
      return {
        numbers: opaque.map((e) => Number(e.token.replace(/\D/g, ''))),
        words: opaque.map((e) => e.name),
        back: window.NotesScrub.restoreOutput(reply, r.map),
      };
    }, INTAKE);
    expect(out.numbers.length).toBeGreaterThan(0);
    for (const n of out.numbers) expect(n, 'minted below the floor').toBeGreaterThan(100);
    expect(out.back).toContain('Across T1, T2, T3 the client responded on T1 and T3 but not T2.');
    for (const w of out.words) expect(out.back).toContain(w);
    expect(out.back).not.toMatch(/T1\d\d/);
  });

  test('a number this note never issued stays exactly as written', async ({ page }) => {
    await loggedIn(page);
    const TEXTS = ['T99', '[[T99]]', '[T99]', '(T99)', 'T-99', 'Goal: T99 today', '[[T1, T99]]'];
    const got = await page.evaluate((texts) => {
      const map = [{ name: 'Aggresion', token: '[[T1]]', restore: true }];
      return texts.map((t) => window.NotesScrub.restoreOutput(t, map));
    }, TEXTS);
    /* The mixed run is the one that changes. T1 is this note's, so its word
       comes back; T99 is not, so it stays for the alert check to raise. */
    expect(got).toEqual([...TEXTS.slice(0, -1), '[[Aggresion, T99]]']);
  });

  test('ordinary words and codes that contain an issued number are left alone', async ({ page }) => {
    await loggedIn(page);
    const TEXTS = [
      'AT3 was scheduled.', 'The T3a probe ran.', 'ST3 is a code.', 'Use T30 next time.', 'at 3 pm',
      'Part 3 of the plan.', 'BT3 arrived.', 'IT3 support', 'The 3T trial.', 'test3 file', 'TT3 target',
      'Room T3B', 'T3.5 version', 'Grade 3 reader', 'Set 3 of 5', '3 trials', 'GT-3 unit',
    ];
    const got = await page.evaluate((texts) => {
      const map = [{ name: 'Aggresion', token: '[[T3]]', restore: true }];
      return texts.map((t) => window.NotesScrub.restoreOutput(t, map));
    }, TEXTS);
    expect(got).toEqual(TEXTS);
  });

  test('a role token is never turned back into the person', async ({ page }) => {
    await loggedIn(page);
    const out = await page.evaluate(() => window.NotesScrub.restoreOutput('Client--1 met T1 and C1.', [
      { name: 'Jacob', token: 'Client--1', restore: false },
      { name: 'Blue', token: '[[T1]]', restore: true },
    ]));
    expect(out).toBe('Client--1 met Blue and C1.');
  });

  test('the scrub never mints a number the intake already spells, so a T the clinician typed stays theirs', async ({ page }) => {
    await loggedIn(page);
    const INTAKES = [
      'Worked on T1 and T2 targets with Magnatiles and Paw Patrol.',
      'Probe t3, then Mand and Tact with Blue cards.',
      'Protocol [T4] and (T5) ran; Echoic trials with Red cards.',
      'Level T-6 and T_7 with Yellow and Green blocks.',
      'Target T12 with Lego and Duplo.',
    ];
    const out = await page.evaluate(async (intakes) => {
      const res = [];
      for (const text of intakes) {
        const r = await window.NotesScrub.review({ freeText: text });
        const issued = r.map.filter((e) => /^\[\[T\d+\]\]$/.test(e.token));
        const typed = (text.match(/[Tt][\s_#-]*0*(\d+)/g) || []).map((m) => Number(m.replace(/\D/g, '')));
        // Ask for the whole note back with the tokens bare, then check the
        // clinician's own T-number survived and every word came back.
        const sent = window.NotesScrub.applyMap(text, r.map);
        const back = window.NotesScrub.restoreOutput(sent.replace(/\[\[T(\d+)\]\]/g, 'T$1'), r.map);
        res.push({
          text,
          issuedNumbers: issued.map((e) => Number(e.token.replace(/\D/g, ''))),
          typed,
          words: issued.map((e) => e.name),
          back,
        });
      }
      return res;
    }, INTAKES);
    for (const o of out) {
      expect(o.issuedNumbers.length, `nothing was scrubbed from: ${o.text}`).toBeGreaterThan(0);
      for (const n of o.issuedNumbers) {
        expect(o.typed, `${o.text}: minted T${n}, which the clinician already typed`).not.toContain(n);
      }
      for (const w of o.words) expect(o.back, `${w} did not come back`).toContain(w);
      for (const m of o.text.match(/[Tt][\s_#-]*\d+/g) || []) {
        expect(o.back, `the clinician's own ${m} was rewritten`).toContain(m);
      }
    }
  });
});
