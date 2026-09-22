import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';
import {
  reshapeReply, reshapeOne, SHAPE_COUNT, issuedNumbers, tokenFamily, captureClipboard, copiedFrom,
} from './helpers/token-reshape.js';

/* EVERY PATH A TOKEN CAN REACH A CLINICIAN, DRIVEN BY A MOCK THAT RESHAPES IT.
 *
 * scrub-token-roundtrip.spec.js proves the round trip on the draft and the
 * revision, and three of its tests mangle the token on purpose. This file is the
 * sweep: the same reshaping mock on every surface a clinician reads, so a repair
 * that holds on the draft and not on the expert quote fails here rather than in
 * an EHR.
 *
 * WHY A RESHAPING MOCK IS THE WHOLE POINT. An echo mock hands [[T3]] back as
 * [[T3]], the literal substitution always finds it, and the suite stays green
 * through the exact fault it was written to catch - fourteen ordinary clinical
 * terms reaching a signed sup note as [T1] through [T14] on 2026-09-09. The mock
 * here never returns the canonical shape. It returns the five manglings a model
 * has actually been seen to produce, spread across the token numbers so one
 * drafted note carries four of them at once.
 *
 * ASSERTIONS READ THE FAMILY, NEVER THE SHAPE. tokenFamily() is one or two
 * brackets, optional whitespace, upper or lower case T. The old leak check read
 * /\[\[T\d+\]\]/ and a note carrying [T3] passed it while showing the clinician
 * a token.
 *
 * THE SIX PATHS, in the order they appear below:
 *   1  the draft
 *   2  a revision
 *   3  an expert quote
 *   4  panel advice
 *   5  per-section Copy
 *   6  the saved draft after a reload
 *
 * Each describe carries its own control - a test that fails if the mock stopped
 * putting tokens on the wire at all, because "no token in the note" is also true
 * of a build that sent nothing.
 */

const PAGE = '/notes/bt/';

/* One intake carrying all three classes: words with no evidence of a person
   (colours, ABA terms, a toy brand) that must come BACK, and two names with a
   role cue in front of them that must NOT. */
const INTAKE =
  'Client Jacob labeled Blue, Red and Yellow cards correctly. ' +
  'Data collected on Mand, Tact and Echoic trials. ' +
  'Preferred play with the Paw Patrol figures. Mom Sarah called about Thursday.';

const ROUND_TRIPPED = ['Blue', 'Red', 'Yellow', 'Mand', 'Tact', 'Echoic'];
const WITHHELD = ['Jacob', 'Sarah'];

const NOTE = {
  individualsPresent: ['Client'],
  clinicalStatus: ['Presented Tired'],
  clinicalStatusNarrative: 'The client presented as tired on arrival.',
  purpose: ['Worked on goals as stated in the treatment plan'],
  servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'The behavior technician ran a three-item array.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'Choices were offered before each demand.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'Direct staff do not report new questions or concerns for the BCBA.',
  hints: [],
};

/* The reply, with every canonical token in it mangled on the way out. This is
   the seam: nothing below chooses a shape, so no test can accidentally assert
   against the one shape the page already handles. */
const modelSays = (obj) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    content: [{ type: 'text', text: reshapeReply(obj) }],
    usage: { output_tokens: 100 },
    stop_reason: 'end_turn',
  }),
});

function tokenFor(role = 'user', tools = ['bt']) {
  const payload = { role, kid: 'pw:tech-1', tools, exp: Math.floor(Date.now() / 1000) + 3600 };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.local-test`;
}

async function loggedIn(page, role = 'user') {
  await page.goto(PAGE);
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor(role));
  await page.reload();
}

// Echo the clinician's own line back in whatever form it arrived, so the
// assistant turn in the conversation carries the tokens the way the live model
// did. A build that sent the word echoes the word and the leak check fires.
const echoedLine = (wire) => (wire.split('\n').find((l) => /labeled/.test(l)) || '').trim().slice(0, 400);

/* Everything a clinician can read in the note card: its text plus the values of
   the editable narratives, which innerText does not see at all. A check that
   skipped the textareas would pass on a build that rendered nothing. */
const readNote = (page) =>
  page.getByTestId('generated-note').evaluate((el) =>
    [el.innerText, ...[...el.querySelectorAll('textarea')].map((t) => t.value)].join('\n'));

async function fillIntake(page, text = INTAKE) {
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill(text);
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
}

// The gates are off by the maintainer's ruling of 2026-09-01, so this is a
// defensive pass rather than a step: it costs nothing when nothing is showing
// and keeps the harness working if either comes back.
async function clearGates(page) {
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const review = page.locator('#notes-scrub-go');
  if (await review.isVisible({ timeout: 1200 }).catch(() => false)) await review.click();
}

// The panel docks as a collapsed pill on some tools and open on others, so the
// ask button and the revision box are one click away rather than reliably there.
async function openPanel(page) {
  const input = page.locator('.revision-input');
  if (await input.isVisible({ timeout: 800 }).catch(() => false)) return;
  const fab = page.locator('.revision-fab').first();
  if (await fab.isVisible({ timeout: 3000 }).catch(() => false)) await fab.click();
  await expect(input).toBeVisible({ timeout: 5000 });
}

/* One driver for every path. `sent` collects the non-triage bodies so a test can
   prove the token really crossed the wire before reading the note for its
   absence. */
async function drive(page, { onAdvice, role = 'user' } = {}) {
  const sent = [];
  let drafted = 0;
  await page.route('**/api/llm-call**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(body)) return route.fulfill(modelSays({ sufficient: true, readiness: 95, questions: [] }));
    sent.push(body);
    const wire = (body.messages || []).map((m) => m.content || '').join('\n');

    if (body.want_opinions === true) {
      return route.fulfill(modelSays(onAdvice ? onAdvice(wire) : 'No advice fixture was installed.'));
    }
    drafted += 1;
    if (drafted === 1) {
      const line = echoedLine(wire);
      return route.fulfill(modelSays({
        ...NOTE,
        lessonProgressNarrative: line || 'NOTHING WAS ECHOED, so this test proved nothing.',
      }));
    }
    /* A later turn copies the tokens out of its own replayed history, which is
       what the live model did on 2026-08-31. Reading them off the wire rather
       than hardcoding them is what makes a build that lost the map render a
       token here instead of quietly passing. */
    const nums = issuedNumbers(wire);
    return route.fulfill(modelSays({
      ...NOTE,
      lessonProgressNarrative: nums.length
        ? `The client labeled ${nums.map((n) => `[[T${n}]]`).join(', ')} cards on nine of ten trials.`
        : 'NO OPAQUE TOKEN REACHED THE MODEL, so this test proved nothing.',
    }));
  });

  await loggedIn(page, role);
  await fillIntake(page);
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await clearGates(page);
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });
  return { sent };
}

// number -> the clinician's word, straight out of the ledger the page wrote.
const ledger = (page) =>
  page.evaluate(() => {
    const map = window.NotesGate.draft.load('bt::map') || [];
    const out = {};
    map.forEach((e) => {
      const m = /^\[\[T(\d+)\]\]$/.exec(String(e.token || ''));
      if (m) out[m[1]] = e.name;
    });
    return out;
  });

/* ── 0. the harness itself ────────────────────────────────────────────────
   A sweep that asserts absence is worth exactly what its control is worth. If
   the reshaper ever emitted the canonical shape, every test below would be an
   echo mock again and would pass on the build that shipped the fault. */
test.describe('the mock reshapes, so absence means something', () => {
  test('no shape it emits is the token the page minted', async () => {
    /* ONE NUMBER PER SHAPE, BY CONSTRUCTION. This was seven numbers chosen by
       hand, which covered the five shapes that existed the day it was written
       and quietly stopped covering the list the day two more were added. */
    for (let i = 1; i <= SHAPE_COUNT; i++) {
      const n = String(i);
      const piece = reshapeOne(n);
      /* THE CLAIM IS IDENTITY, NOT BRACKETS. One reshaping pads the number, so
         [[T9]] comes back as [[T09]]: canonically SHAPED, and still not the
         token the page minted, because the literal substitution looks for
         [[T9]] and will not find it. Asserting against the bracket pattern read
         that legitimate mangling as a broken control and would have cost the
         next person the shape rather than the assertion. */
      expect(piece, `the reshaper handed [[T${n}]] straight back`).not.toBe(`[[T${n}]]`);
      /* Still reads as a token, or every absence asserted below would be
         passing because the string stopped looking like one. */
      expect(piece, `${piece} left the family`).toMatch(tokenFamily());
    }
  });

  test('the page really did put canonical tokens on the wire', async ({ page }) => {
    const { sent } = await drive(page);
    const wire = JSON.stringify(sent);
    expect(sent.length).toBeGreaterThan(0);
    expect(wire, 'nothing was tokenised, so every absence below is vacuous').toMatch(/\[\[T\d+\]\]/);
    for (const word of ['Mand', 'Tact', 'Echoic', 'Paw Patrol', ...WITHHELD]) {
      expect(wire, `"${word}" crossed the wire in the clear`).not.toContain(word);
    }
  });

  /* THE FILE'S HEADER CLAIMS ONE DRAFTED NOTE CARRIES SEVERAL MANGLINGS AT ONCE,
     AND UNTIL NOW NOTHING CHECKED IT. Every test below reads as a sweep across
     the shapes, but the sweep is only as wide as the numbers this intake happens
     to mint: an intake trimmed to two tokens would run every path against two
     reshapings and still report the same green. That is the vacuous-control
     failure this whole file was written about, one level up. */
  test('and the reply mangled them more than one way', async ({ page }) => {
    const { sent } = await drive(page);
    const nums = issuedNumbers(JSON.stringify(sent));
    expect(nums.length, 'no token was issued, so every path below drove an echo mock').toBeGreaterThan(0);
    const shapes = new Set(nums.map((n) => Number(n) % SHAPE_COUNT));
    expect(
      shapes.size,
      `this note issued ${nums.length} tokens and they landed on ${shapes.size} reshaping(s), so the sweep swept one shape`,
    ).toBeGreaterThan(3);
  });
});

/* ── 1. the draft ───────────────────────────────────────────────────────── */
test.describe('path 1, the draft', () => {
  test('a reshaped token does not reach the drafted note', async ({ page }) => {
    await drive(page);
    expect(await readNote(page)).not.toMatch(tokenFamily());
  });

  test('and the words behind those tokens are back in it', async ({ page }) => {
    await drive(page);
    const noteText = await readNote(page);
    for (const word of ROUND_TRIPPED) {
      expect(noteText, `"${word}" did not come back through a reshaped token`).toContain(word);
    }
  });

  test('a cued name is still withheld from the note', async ({ page }) => {
    await drive(page);
    const noteText = await readNote(page);
    for (const word of WITHHELD) {
      expect(noteText, `"${word}" re-entered the note`).not.toContain(word);
    }
  });
});

/* ── 2. a revision ──────────────────────────────────────────────────────── */
async function revise(page, instruction = 'tighten the lesson narrative') {
  const out = await drive(page);
  await page.locator('.revision-input').fill(instruction);
  await page.locator('.revision-send').click();
  await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 30000 });
  return out;
}

test.describe('path 2, a revision', () => {
  test('the token is already gone in the diff, before anything is accepted', async ({ page }) => {
    await revise(page);
    // A clinician reads the proposal before accepting it, so a token visible
    // here is the same defect one click earlier.
    const diff = await page.locator('.diff-view').first().innerText();
    expect(diff).not.toMatch(tokenFamily());
    expect(diff, 'the revision carried no round-tripped word, so it proved nothing').toContain('Blue');
  });

  test('and it is gone from the note once the revision is accepted', async ({ page }) => {
    await revise(page);
    await page.locator('.diff-accept').click();
    const noteText = await readNote(page);
    expect(noteText).not.toMatch(tokenFamily());
    for (const word of ['Blue', 'Red', 'Yellow']) {
      expect(noteText, `"${word}" did not survive the revision`).toContain(word);
    }
  });

  test('carrying the map forward does not turn into restoring on the way out', async ({ page }) => {
    const { sent } = await revise(page);
    const wire = JSON.stringify(sent);
    for (const word of WITHHELD) {
      expect(wire, `"${word}" crossed the wire on a later turn`).not.toContain(word);
    }
  });
});

/* ── 3. an expert quote ─────────────────────────────────────────────────── */
/* The expert quotes the clinician's own sentence back at them. A finding reading
   "you wrote '[T4] clinic'" names a word they cannot see, and it is the one
   surface where the quote is theirs rather than the model's. */
async function withExpert(page) {
  const asked = [];
  await page.route('**/api/expert-pass**', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const nums = issuedNumbers(body.intake || '');
    asked.push(nums);
    // Reshaped here rather than through modelSays, because this route answers
    // the Worker's own JSON shape and not the LLM envelope.
    const t = nums.length ? reshapeOne(nums[0]) : 'NO-TOKEN-REACHED-THE-EXPERT';
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        terms: [],
        register: [{
          quote: `labeled ${t} cards correctly`,
          action: 'keep', why: 'Observable and countable.', move: 'Leave it as written.',
        }],
        hints: [{
          section: 'note', rank: 1, kind: 'thin',
          ask: `How many ${t} trials ran before the prompt faded?`,
          why: 'A payer reads a trial count with no denominator as unsupported.',
        }],
        hintsDropped: 0,
        usage: { input_tokens: 20, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        model: 'claude-haiku-4-5-20251001',
      }),
    });
  });
  await drive(page);
  await expect(page.getByTestId('expert-reading')).toBeVisible({ timeout: 30000 });
  return { asked };
}

test.describe('path 3, an expert quote', () => {
  test('the expert was handed tokens, so what it quotes back is a token', async ({ page }) => {
    const { asked } = await withExpert(page);
    expect(asked.length, 'the expert pass never ran').toBeGreaterThan(0);
    expect(asked[0].length, 'no opaque token reached the expert, so the quote proved nothing').toBeGreaterThan(0);
  });

  test('no reshaped token survives into the reading the clinician sees', async ({ page }) => {
    await withExpert(page);
    const toggle = page.getByTestId('expert-register-toggle');
    if (await toggle.isVisible({ timeout: 2000 }).catch(() => false)) await toggle.click();
    expect(await page.getByTestId('expert-reading').innerText()).not.toMatch(tokenFamily());
  });

  test('the quote says the clinician own word instead', async ({ page }) => {
    const { asked } = await withExpert(page);
    const words = await ledger(page);
    const expected = words[asked[0][0]];
    expect(expected, 'the ledger holds no word for the number the expert was given').toBeTruthy();
    const toggle = page.getByTestId('expert-register-toggle');
    if (await toggle.isVisible({ timeout: 2000 }).catch(() => false)) await toggle.click();
    const reading = await page.getByTestId('expert-reading').innerText();
    expect(reading, `the expert quoted a token where "${expected}" belonged`).toContain(expected);
  });
});

/* ── 4. panel advice ────────────────────────────────────────────────────── */
/* Two versions on purpose: the conversation keeps the model's own words, tokens
   and all, because it is replayed verbatim on the next turn. The clinician reads
   the restored one. This drives the reader's half. */
async function askAdvice(page) {
  const out = await drive(page, {
    onAdvice: (wire) => {
      const nums = issuedNumbers(wire);
      return nums.length
        ? `Run the ${nums.map((n) => `[[T${n}]]`).join(' and ')} arrays in a mixed block before you fade the prompt.`
        : 'NO OPAQUE TOKEN REACHED THE ADVICE TURN, so this test proved nothing.';
    },
  });
  await openPanel(page);
  await page.getByRole('button', { name: /What would you do here/i }).click();
  await expect(page.locator('.revision-panel-body')).toContainText(/mixed block|proved nothing/, { timeout: 30000 });
  return out;
}

test.describe('path 4, panel advice', () => {
  test('the advice turn was given tokens, so its answer carries them', async ({ page }) => {
    await askAdvice(page);
    const thread = await page.locator('.revision-panel-body').innerText();
    expect(thread, 'the advice fixture never saw a token').not.toContain('proved nothing');
  });

  test('no reshaped token reaches the panel the clinician reads', async ({ page }) => {
    await askAdvice(page);
    expect(await page.locator('.revision-panel-body').innerText()).not.toMatch(tokenFamily());
  });

  test('the advice names the clinician own word', async ({ page }) => {
    await askAdvice(page);
    const thread = await page.locator('.revision-panel-body').innerText();
    const words = Object.values(await ledger(page));
    expect(words.length, 'the ledger is empty, so this proves nothing').toBeGreaterThan(0);
    expect(words.some((w) => thread.includes(w)), `none of ${words.join(', ')} came back in the advice`).toBe(true);
  });
});

/* ── 5. per-section Copy ────────────────────────────────────────────────── */
/* Copy is the moment the note leaves for the EHR, and it hands the EHR a string
   built from state rather than scraped from the page. A token that never renders
   can still be copied, so this reads the clipboard rather than the note. */
test.describe('path 5, per-section Copy', () => {
  test('nothing a section copies carries a reshaped token', async ({ page }) => {
    await captureClipboard(page);
    await drive(page);
    const buttons = page.getByTestId('generated-note').getByRole('button', { name: 'Copy', exact: true });
    const n = await buttons.count();
    expect(n, 'no per-section Copy button was found').toBeGreaterThan(0);
    for (let i = 0; i < n; i++) await buttons.nth(i).click();

    const copied = await copiedFrom(page);
    expect(copied.length, 'nothing reached the clipboard').toBe(n);
    for (const text of copied) {
      expect(text, 'a token was copied into the EHR').not.toMatch(tokenFamily());
    }
  });

  test('and the section that held them copies the words instead', async ({ page }) => {
    await captureClipboard(page);
    await drive(page);
    const buttons = page.getByTestId('generated-note').getByRole('button', { name: 'Copy', exact: true });
    for (let i = 0; i < await buttons.count(); i++) await buttons.nth(i).click();
    const all = (await copiedFrom(page)).join('\n');
    for (const word of ['Blue', 'Red', 'Yellow']) {
      expect(all, `"${word}" was not on the clipboard`).toContain(word);
    }
    for (const word of WITHHELD) {
      expect(all, `"${word}" was copied into the EHR`).not.toContain(word);
    }
  });

  /* COPY ALL IS A DIFFERENT BUTTON AND A DIFFERENT BUILDER. Per-section Copy
     hands back one section's body; Copy All joins the tool's copyGroups, which
     is a separate assembly that could lose the restore on its own. bt sets
     copyAll:false because its EHR form takes one field at a time, so the button
     exists for an admin only - that is the login this drives, not a convenience. */
  test('Copy All carries no token either', async ({ page }) => {
    await captureClipboard(page);
    await drive(page, { role: 'admin' });
    await page.getByRole('button', { name: /^Copy All/ }).click();
    const copied = await copiedFrom(page);
    expect(copied.length, 'Copy All put nothing on the clipboard').toBeGreaterThan(0);
    const all = copied[copied.length - 1];
    expect(all).not.toMatch(tokenFamily());
    expect(all, 'Copy All copied an empty note').toContain('Blue');
  });
});

/* ── 6. the saved draft after a reload ──────────────────────────────────── */
/* [[T3]] is a number. The ledger is what says 3 was "Blue", and it used to live
   in one React ref and nowhere else, so closing the tab destroyed the only copy
   and every opaque token in that note became permanent.
 *
 * WHAT THE PAGE DOES AND DOES NOT KEEP. freshSession() restores the typed inputs
 * and the ledger, and deliberately not the output or the conversation, so there
 * is no rendered note on the other side of a reload to read a token out of. The
 * two surfaces that do survive are asserted here: the substitution banner the
 * clinician works from in their EHR, and the restore entry point every
 * model-answer path calls, driven against the ledger as the page rebuilt it.
 */
test.describe('path 6, the saved draft after a reload', () => {
  test('the ledger survives, and a reshaped token still restores against it', async ({ page }) => {
    await drive(page);
    const before = await ledger(page);
    expect(Object.keys(before).length, 'nothing was stored, so the reload proves nothing').toBeGreaterThan(0);

    await page.reload();
    /* Mount is gated on NotesGate.draft.ready, so a restored input is the signal
       that the encrypted cache is populated. Reading the store before the
       decrypt settles would test the race and nothing else. */
    await expect(page.getByRole('textbox', { name: /Skill Acquisition/i })).toHaveValue(/labeled/);

    const survived = await ledger(page);
    const numbers = Object.keys(survived);
    expect(numbers.length, 'the ledger did not survive the reload').toBeGreaterThan(0);

    /* Every number the reload brought back, each in its own mangled shape, and
       all of them through restoreOutput - the call every clinician-facing path
       makes, and the one that filters the map down to what is restorable before
       it substitutes. */
    const sentence = 'The client sorted the ' + numbers.map((n) => reshapeOne(n)).join(', ') + ' cards.';
    const restored = await page.evaluate(
      (line) => window.NotesScrub.restoreOutput(line, window.NotesGate.draft.load('bt::map') || []),
      sentence,
    );
    expect(restored, 'a reshaped token did not restore against the reloaded ledger').not.toMatch(tokenFamily());
    for (const n of numbers) {
      expect(restored, `the word behind token ${n} was lost across the reload`).toContain(survived[n]);
    }
  });

  test('the substitution banner still says what to put back', async ({ page }) => {
    await drive(page);
    await page.reload();
    await expect(page.getByRole('textbox', { name: /Skill Acquisition/i })).toHaveValue(/labeled/);
    // The banner is the clinician's instruction sheet for their EHR, and the note
    // it belongs to may already be pasted there.
    await expect(page.getByText('Removed before this left your device')).toBeVisible({ timeout: 10000 });
    expect(await page.locator('body').innerText()).toContain('Jacob');
  });

  test('and it is not plaintext on disk', async ({ page }) => {
    await drive(page);
    const raw = await page.evaluate(() => localStorage.getItem('notes_draft_bt::map') || '');
    expect(raw, 'nothing was written').not.toEqual('');
    for (const word of ['Blue', 'Mand', 'Paw Patrol']) {
      expect(raw, `"${word}" is on disk in the clear`).not.toContain(word);
    }
  });
});

/* ── 7. a cleared note's ledger must not reach the next note ─────────────
 *
 * The seventh surface is the one where a token comes back as the WRONG word,
 * which is worse than coming back as a token: a visible [T3] is a defect a
 * clinician can see, and the previous note's word in this note is a defect they
 * cannot.
 *
 * handleClear resets the session and the stored ledger. It also has to reset the
 * in-memory ref, because the carry-over callers seed themselves from that ref,
 * merge the stale entries into the new note's map, and the autosave then writes
 * them to disk as THIS note's ledger. Generate Prompt is the caller driven here
 * because it is the one that carries over without needing a model.
 */
async function promptFor(page, text) {
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill(text);
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Prompt' }).click();
  await clearGates(page);
  await expect.poll(() => page.evaluate(() => (window.NotesGate.draft.load('bt::map') || []).length))
    .toBeGreaterThan(0);
}

test.describe('path 7, a cleared note does not seed the next one', () => {
  test('no number the new note issued restores to the cleared note word', async ({ page }) => {
    await page.goto(PAGE);
    await promptFor(page, 'Client sorted the Magenta cards during Tact trials.');

    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /^Clear/ }).click();
    await expect(page.getByRole('textbox', { name: /Skill Acquisition/i })).toHaveValue('');

    await promptFor(page, 'Client sorted the Turquoise cards during Echoic trials.');

    const words = await ledger(page);
    const numbers = Object.keys(words);
    expect(numbers.length, 'the new note issued nothing, so this proves nothing').toBeGreaterThan(0);
    expect(Object.values(words), 'the new note never tokenised its own word').toContain('Turquoise');

    /* Every number this note issued, restored through the same reshaped shapes a
       model returns. A ledger carrying the cleared note's entry hands "Magenta"
       back into a note that never said it. */
    const sentence = 'The client sorted the ' + numbers.map((n) => reshapeOne(n)).join(', ') + ' cards.';
    const restored = await page.evaluate(
      (line) => window.NotesScrub.restoreOutput(line, window.NotesGate.draft.load('bt::map') || []),
      sentence,
    );
    expect(restored, 'the cleared note word came back through the in-memory map').not.toContain('Magenta');
    expect(restored).toContain('Turquoise');
    expect(restored).not.toMatch(tokenFamily());
  });
});

/* ── 8. two tools in one page, one ref between them ──────────────────────
 *
 * /notes/bcba/ mounts four tools behind a ribbon and the engine holds ONE
 * scrubMapRef for all of them. Switching tabs remounts the panel and keeps the
 * component, so the ref carries whichever tool last scrubbed. A revision on the
 * tool you came BACK to then measures the model's answer against the other
 * tool's ledger.
 *
 * That is the wrong-word fault again, and it is sharper here than after a Clear:
 * both tools start numbering at [[T1]], so the stale ledger does not merely fail
 * to restore, it restores the other note's word into this one.
 */
const SUP_NOTE = {
  sessionChecks: [], goalsAnalyzed: [], overallProgress: '', progress: '',
  programming: '', behavior: '', feedback: '', reviewedNotes: '', followup: '', hints: [],
};
const PARENT_NOTE = {
  individualsPresent: [], supportActivities: [], caregiverResponse: '',
  progressStatus: '', summary: '', followup: '', hints: [],
};

const SUP_INTAKE = 'BT ran the Blue, Red and Yellow card array with the client and scored nine of ten.';
const PARENT_INTAKE = 'Caregiver practiced manding with the Magenta, Turquoise and Lavender tokens at home.';

test.describe('path 8, switching tools and coming back', () => {
  test('the revision restores against this tool ledger, not the other one', async ({ page }) => {
    let turn = 0;
    await page.route('**/api/llm-call**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (isTriageCall(body)) return route.fulfill(modelSays({ sufficient: true, readiness: 95, questions: [] }));
      const wire = (body.messages || []).map((m) => m.content || '').join('\n');
      const nums = issuedNumbers(wire);
      turn += 1;
      /* The revision has to SAY something different from the draft or the engine
         renders no diff, and the test then fails on a missing panel rather than
         on a stranded token. Same tokens, different sentence. */
      const said = turn === 3 ? 'in a mixed block on nine of ten trials' : 'in a mixed block';
      const carried = nums.length
        ? `Ran ${nums.map((n) => `[[T${n}]]`).join(', ')} ${said}.`
        : 'NO OPAQUE TOKEN REACHED THE MODEL, so this test proved nothing.';
      // Turn 1 is the sup draft, turn 2 the parent draft, turn 3 the sup
      // revision. Each answers in its own tool's shape or the note will not
      // render and the revision has nothing to revise.
      if (turn === 2) return route.fulfill(modelSays({ ...PARENT_NOTE, summary: carried }));
      return route.fulfill(modelSays({ ...SUP_NOTE, progress: carried }));
    });

    await page.goto('/notes/bcba/index.html?tool=sup');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t),
      tokenFor('user', ['sup', 'parent']));
    await page.reload();

    await page.getByRole('textbox', { name: /Session Notes \/ Clinical Observations/i }).fill(SUP_INTAKE);
    // sup.validate() rejects an unset btPresent toggle, so the draft never runs
    // and the ribbon has nothing to switch away from.
    await page.getByRole('button', { name: 'No, Behavior Analyst only' }).click();
    await page.getByRole('button', { name: 'Generate Note' }).click();
    await clearGates(page);
    await expect(page.getByTestId('generated-note')).toBeVisible({ timeout: 30000 });

    await page.getByRole('tab', { name: 'Parent Training' }).click();
    await page.getByRole('textbox', { name: /^Session Notes \*/i }).fill(PARENT_INTAKE);
    await page.getByRole('button', { name: 'Generate Note' }).click();
    await clearGates(page);
    await expect(page.getByTestId('generated-note')).toBeVisible({ timeout: 30000 });

    await page.getByRole('tab', { name: 'Supervision' }).click();
    await expect(page.getByTestId('generated-note')).toBeVisible({ timeout: 10000 });

    await openPanel(page);
    await page.locator('.revision-input').fill('tighten the progress paragraph');
    await page.locator('.revision-send').click();
    await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 30000 });
    await page.locator('.diff-accept').click();

    const noteText = await readNote(page);
    expect(noteText, 'the revision proved nothing').not.toContain('proved nothing');
    expect(noteText, 'a token survived the tool switch').not.toMatch(tokenFamily());
    for (const word of ['Blue', 'Red', 'Yellow']) {
      expect(noteText, `"${word}" was lost across the tool switch`).toContain(word);
    }
    for (const word of ['Magenta', 'Turquoise', 'Lavender']) {
      expect(noteText, `"${word}" came from the OTHER tool ledger`).not.toContain(word);
    }
  });
});
