import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* A word the scrubber cannot rule out must come back.
 *
 * The fault this pins, from a note the maintainer drafted on 2026-08-26: a
 * finished note said "(e.g., 'Client 25' repetition)". Client 25 was the colour
 * Red. Running the real scrub over a realistic intake found 30 "names" of which
 * six were people; Mand, Tact and Echoic went to the model as client names, and
 * "Paw Patrol" was ALSO split into a separate "Paw" and "Patrol", which is most
 * of how the numbering reached 25.
 *
 * The cause was a premise, not a typo. The comment above the stopword list said
 * over-scrubbing was safe because it round-trips back identically. That is true
 * on the expert path, which restores. The drafting path never restored, so every
 * false positive was permanent, and the more cautious the detector got the more
 * damage it did.
 *
 * So these tests are written against OUTPUT, not against the map. The mock echoes
 * whatever tokens it was actually sent, which is the only way a round-trip test
 * can fail honestly: a build that sends "Client 25" gets "Client 25" back and the
 * assertion fails on the rendered note, exactly as the maintainer saw it.
 *
 * The other half matters just as much and has its own tests below: a word with
 * real evidence of being a person must still be tokenised and must NOT come back.
 * A round-trip that restores everything would pass every test above this line and
 * would put a client's name in a signed note.
 */

const INTAKE =
  'Client Jacob labeled Blue, Red and Yellow cards correctly. ' +
  'Data collected on Mand, Tact and Echoic trials. ' +
  'Preferred play with the Paw Patrol figures. Mom Sarah called about Thursday.';

async function loggedIn(page) {
  await page.goto('/notes/bt/');
  await page.evaluate(() => {
    const payload = { role: 'user', kid: 'pw:tech-1', tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    localStorage.setItem('notes_auth_token', `${b64}.local-test`);
  });
  await page.reload();
}

/* The mock echoes the intake it was given straight back into a narrative field.
   That is what makes this two-sided: whatever the page put on the wire is what
   the page gets back, so the rendered note shows the tokens verbatim unless
   something restores them. */
function echoReply(body) {
  /* Echo the clinician's own line back, in whatever form it reached the model.
     A build that sent "Client 25" echoes "Client 25"; a build that sent an opaque
     token echoes the token. Either way the rendered note is the thing under test. */
  const content = ((body.messages || []).map((m) => m.content || '').join('\n')) || '';
  const line = content.split('\n').find((l) => /labeled/.test(l)) || '';
  const echoed = line.trim().slice(0, 400);
  return {
    individualsPresent: ['Client'],
    clinicalStatus: ['Presented Tired'],
    clinicalStatusNarrative: 'The client presented as tired on arrival.',
    purpose: ['Worked on goals as stated in the treatment plan'],
    servicePaused: 'No',
    abaTechniques: ['Discrete Trial Training'],
    lessonProgressNarrative: echoed || 'Nothing echoed.',
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
}

async function draft(page, text = INTAKE) {
  const calls = [];
  await page.route('**/api/llm-call**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (!isTriageCall(body)) calls.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: [{ text: JSON.stringify(echoReply(body)) }] }),
    });
  });

  await loggedIn(page);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill(text);
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });
  /* The NOTE, not the page. Two reasons this is not innerText on the body.
     The substitution banner beside the inputs correctly shows "Jacob -> Client"
     so the clinician can put the name back in their EHR, and counting that as a
     leak would fail a working build. And the narratives are EDITABLE, so they are
     textareas, whose values innerText does not see at all - a check that skipped
     them would pass on a build that rendered nothing. */
  const note = page.getByTestId('generated-note');
  const noteText = await note.evaluate((el) =>
    [el.innerText, ...[...el.querySelectorAll('textarea')].map((t) => t.value)].join('\n')
  );
  return { calls, noteText };
}

test.describe('a word with no evidence of being a person comes back', () => {
  test('the colours and the ABA terms survive the round trip', async ({ page }) => {
    const { noteText } = await draft(page);
    // Every one of these was a numbered client token before this change.
    for (const word of ['Blue', 'Red', 'Yellow', 'Mand', 'Tact', 'Echoic']) {
      expect(noteText, `"${word}" did not come back`).toContain(word);
    }
  });

  test('no opaque token is left anywhere a clinician can read it', async ({ page }) => {
    const { noteText } = await draft(page);
    expect(noteText).not.toMatch(/\[\[T\d+\]\]/);
  });

  test('and the note never says Client with a number on it', async ({ page }) => {
    const { noteText } = await draft(page);
    // The literal shape of the reported fault. A build that numbers colours as
    // clients fails here even if every other assertion somehow passed.
    expect(noteText).not.toMatch(/\bClient \d+\b/);
  });

  test('none of those words reached the model in the clear', async ({ page }) => {
    const { calls } = await draft(page);
    expect(calls.length).toBeGreaterThan(0);
    const sent = JSON.stringify(calls);
    // The round trip is not an excuse to stop scrubbing: the model still never
    // sees the word, it sees a token it cannot interpret.
    for (const word of ['Mand', 'Tact', 'Echoic', 'Paw Patrol']) {
      expect(sent, `"${word}" crossed the wire`).not.toContain(word);
    }
    expect(sent).toMatch(/\[\[T\d+\]\]/);
  });
});

test.describe('a word with evidence of being a person does NOT come back', () => {
  test('the named client and the named parent stay tokenised in the note', async ({ page }) => {
    const { noteText } = await draft(page);
    expect(noteText, 'a client name re-entered the note').not.toContain('Jacob');
    expect(noteText, 'a parent name re-entered the note').not.toContain('Sarah');
  });

  test('and neither of them reached the model', async ({ page }) => {
    const { calls } = await draft(page);
    const sent = JSON.stringify(calls);
    expect(sent).not.toContain('Jacob');
    expect(sent).not.toContain('Sarah');
    expect(sent).toContain('Client');
    expect(sent).toContain('Caregiver');
  });
});

test.describe('the map itself', () => {
  test('a fragment of a longer detection is dropped rather than numbered', async ({ page }) => {
    await loggedIn(page);
    const map = await page.evaluate(async (text) => {
      const r = await window.NotesScrub.review({ freeText: text });
      return r.map.map((e) => ({ name: e.name, token: e.token, restore: !!e.restore }));
    }, INTAKE);
    const names = map.map((e) => e.name);
    expect(names).toContain('Paw Patrol');
    // Both fragments matched nothing once the phrase was taken, and each used to
    // consume a token number of its own.
    expect(names).not.toContain('Paw');
    expect(names).not.toContain('Patrol');
  });

  test('evidence decides which kind of token a word gets', async ({ page }) => {
    await loggedIn(page);
    const map = await page.evaluate(async (text) => {
      const r = await window.NotesScrub.review({ freeText: text });
      return r.map.map((e) => ({ name: e.name, token: e.token, restore: !!e.restore }));
    }, INTAKE);
    const byName = Object.fromEntries(map.map((e) => [e.name, e]));
    expect(byName['Jacob'], 'a cued name should be a kept role token').toMatchObject({ restore: false });
    expect(byName['Jacob'].token).toMatch(/^Client/);
    expect(byName['Sarah'].token).toMatch(/^Caregiver/);
    expect(byName['Red'], 'a colour should round-trip').toMatchObject({ restore: true });
    expect(byName['Red'].token).toMatch(/^\[\[T\d+\]\]$/);
  });

  test('the substitution notice lists only what stays in the note', async ({ page }) => {
    await loggedIn(page);
    const notice = await page.evaluate(async (text) => {
      const r = await window.NotesScrub.review({ freeText: text });
      return window.NotesScrub.noticeText(r.map);
    }, INTAKE);
    expect(notice).toContain('Jacob');
    // Telling a clinician that "Red" was substituted would report a change that
    // does not survive to the draft.
    expect(notice).not.toContain('[[T');
    expect(notice).not.toContain('Red →');
  });
});

test.describe('restoring is not prefix-blind', () => {
  test('Client 2 survives a map that also carries Client', async ({ page }) => {
    await loggedIn(page);
    const out = await page.evaluate(() =>
      window.NotesGate._scrub.restoreDeep('Client and Client 2 played.', [
        { name: 'Jacob', token: 'Client' },
        { name: 'Ethan', token: 'Client 2' },
      ])
    );
    // Restoring in map order rewrote the "Client" inside "Client 2" and left
    // "Jacob 2" behind, on the expert path, for as long as numbered roles existed.
    expect(out).toBe('Jacob and Ethan played.');
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * AND IT HAS TO SURVIVE THE SECOND TURN.
 *
 * Everything above this line drafts a note and stops. That is why every one of
 * those tests passed on 2026-08-31 while a signed sup note went out reading
 * "T9" and "T4" where two of the clinician's own words belonged.
 *
 * The page kept ONE map and replaced it on every scrub. A revision scrubs only
 * the newly typed instruction - correctly, because the section body is model
 * output already in the conversation - and that replacement threw the draft's
 * opaque tokens away. The model still had them: a revision replays the earlier
 * turns verbatim to keep Anthropic's prefix cache warm, so it copied [[T3]] out
 * of its own history into the new draft, and by then nothing on the page knew
 * [[T3]] had been a word.
 *
 * The mock below reproduces that exactly rather than approximating it. It reads
 * the opaque tokens off the wire and echoes them back, which is the only honest
 * way to write this: a build that has lost the map renders the token, and a
 * build that carried it renders the word.
 * ───────────────────────────────────────────────────────────────────────────── */

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

const json = (obj) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }] }),
});

/* Draft, then revise. The revision reply carries whatever opaque tokens the page
   put on the wire in the turns before it, which is what the live model did. */
async function reviseAfterDraft(page, instruction) {
  let turn = 0;
  const sent = [];
  await page.route('**/api/llm-call**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(body)) return route.fulfill(json({ sufficient: true, questions: [] }));
    turn++;
    sent.push(body);
    const content = (body.messages || []).map((m) => m.content || '').join('\n');
    if (turn === 1) {
      // The draft echoes the clinician's line back in whatever form it arrived,
      // so the assistant turn in the conversation carries the tokens too.
      const line = content.split('\n').find((l) => /labeled/.test(l)) || '';
      return route.fulfill(json({ ...NOTE, lessonProgressNarrative: line.trim().slice(0, 400) }));
    }
    const tokens = [...new Set(content.match(/\[\[T\d+\]\]/g) || [])];
    return route.fulfill(json({
      ...NOTE,
      lessonProgressNarrative: tokens.length
        ? `The client labeled ${tokens.join(', ')} cards on nine of ten trials.`
        : 'NO OPAQUE TOKEN REACHED THE MODEL, so this test proved nothing.',
    }));
  });

  await loggedIn(page);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill(INTAKE);
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });

  await page.locator('.revision-input').fill(instruction);
  await page.locator('.revision-send').click();
  await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 30000 });
  return { sent };
}

// Everything a clinician can read: the note card's text plus the values of the
// editable narratives, which innerText does not see at all.
const readNote = (page) =>
  page.getByTestId('generated-note').evaluate((el) =>
    [el.innerText, ...[...el.querySelectorAll('textarea')].map((t) => t.value)].join('\n')
  );

test.describe('a revision does not lose the words the draft round-tripped', () => {
  test('the model copies its own tokens forward and the page still puts the words back', async ({ page }) => {
    await reviseAfterDraft(page, 'tighten the lesson narrative');
    await page.locator('.diff-accept').click();

    const noteText = await readNote(page);
    // The reported fault, in the form it was reported: "T9" and "T4" in a note.
    expect(noteText, 'an opaque token survived into the note').not.toMatch(/\[\[T\d+\]\]/);
    expect(noteText, 'a bare token number survived into the note').not.toMatch(/\bT\d+\b/);
    for (const word of ['Blue', 'Red', 'Yellow']) {
      expect(noteText, `"${word}" did not come back after the revision`).toContain(word);
    }
  });

  test('and the token is already gone in the diff, before anything is accepted', async ({ page }) => {
    await reviseAfterDraft(page, 'tighten the lesson narrative');
    // A clinician reads the proposal before accepting it. A token visible here
    // is the same defect one click earlier.
    const diff = await page.locator('.diff-view').first().innerText();
    expect(diff).not.toMatch(/\[\[T\d+\]\]/);
    expect(diff).toContain('Blue');
  });

  test('the client name is still withheld from the model on the revision turn', async ({ page }) => {
    const { sent } = await reviseAfterDraft(page, 'tighten the lesson narrative');
    const wire = JSON.stringify(sent);
    // Carrying the map forward must not turn into restoring on the way OUT.
    expect(wire, 'a client name crossed the wire on a later turn').not.toContain('Jacob');
    expect(wire).not.toContain('Sarah');
  });

  test('the substitution banner still says what to put back after a revision', async ({ page }) => {
    await reviseAfterDraft(page, 'tighten the lesson narrative');
    // The banner is the clinician's instruction sheet for their EHR. Replacing
    // it with the revision's own map took "Jacob -> Client" off the screen while
    // Client was still in the note they were about to copy.
    await expect(page.getByText('Removed before this left your device')).toBeVisible();
    expect(await page.locator('body').innerText()).toContain('Jacob');
  });
});

test.describe('numbering continues across scrubs of the same note', () => {
  test('a second scrub does not mint a second [[T1]] for a different word', async ({ page }) => {
    await loggedIn(page);
    const out = await page.evaluate(async () => {
      const first = await window.NotesScrub.review({ freeText: 'Worked on Blue, Red and Yellow cards.' });
      const second = await window.NotesScrub.review({
        freeText: 'Also ran Purple and Orange.',
        seen: first.map,
      });
      return {
        first: first.map.map((e) => ({ name: e.name, token: e.token })),
        second: second.map.map((e) => ({ name: e.name, token: e.token })),
        merged: window.NotesScrub.mergeMaps(first.map, second.map).map((e) => e.token),
      };
    });
    const firstTokens = out.first.map((e) => e.token);
    const secondTokens = out.second.map((e) => e.token);
    expect(firstTokens.length).toBeGreaterThan(0);
    expect(secondTokens.length).toBeGreaterThan(0);
    // The collision itself: without seeding, both scrubs start at [[T1]] and
    // restoreDeep then puts whichever word it finds first into the note.
    for (const t of secondTokens) {
      expect(firstTokens, `${t} was issued twice for two different words`).not.toContain(t);
    }
    // And the merged map holds one entry per token.
    expect(new Set(out.merged).size).toBe(out.merged.length);
  });

  test('an identifier token is not reissued for a different number', async ({ page }) => {
    await loggedIn(page);
    const tokens = await page.evaluate(async () => {
      const first = await window.NotesScrub.review({ freeText: 'Mom can be reached at 555-867-5309.' });
      const second = await window.NotesScrub.review({
        freeText: 'Dad prefers 555-201-9988 instead.',
        seen: first.map,
      });
      return [...first.map, ...second.map].filter((e) => e.identifier).map((e) => e.token);
    });
    // An identifier is never restored, so a reissued [phone_1] does not put a
    // wrong word in the note - it puts one token in the note standing for two
    // different numbers, which cannot be substituted back at all.
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  test('merging the same scrub twice does not duplicate it', async ({ page }) => {
    await loggedIn(page);
    const n = await page.evaluate(() => {
      const map = [{ name: 'Jacob', token: 'Client', restore: false }];
      return window.NotesScrub.mergeMaps(map, map).length;
    });
    expect(n).toBe(1);
  });
});
