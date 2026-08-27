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
