import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* THE ROLE TOKEN IS "Client--1" NOW, AND THAT ODDNESS BUYS SOMETHING SPECIFIC.
 *
 * WHAT HE READ ON 2026-09-02, in his words: "that expert block has 'Client at
 * session start' because the expert got 'happy' as 'client' and it didn't pass
 * back the exact token found so that the rehydration could map it back to
 * 'happy'". He had typed "Happy at session start", the first-name dictionary
 * took Happy for a person, and the expert quoted back a sentence he never wrote.
 *
 * THE OLD SHAPE MADE THE OBVIOUS FIX UNSAFE. A role token was the bare word
 * "Client" for the first person of a role, and "Client 2" after that. "Client"
 * is ordinary English that the expert writes on its own account - the prompt
 * tells it to - so substituting every "Client" in a quote back to a name would
 * sooner or later put a real client's name into a sentence the model wrote about
 * the role. The page reported the swap in a caption instead, which told the
 * clinician their quote was wrong without giving them their words back.
 *
 * SO THE TOKEN CHANGED RATHER THAN THE RULE. "Client--1" is not English. No
 * model writing prose types it. A match is therefore a token and never a
 * coincidence, and NotesScrub.rehydrate can put the clinician's own word back
 * into the clinician's own sentence. That is the whole trade the double hyphen
 * pays for, and these tests are what stops it being traded away.
 *
 * TWO-SIDED. Every test in the first two blocks fails against the build before
 * this change: the mint gave "Client", the seed parser read a bare word, and
 * rehydrate did not exist.
 *
 * WHAT IS DELIBERATELY NOT HERE. That a role token never comes back into the
 * NOTE is pinned in scrub-token-roundtrip.spec.js, which asserts the rendered
 * note carries no client name. Wiring rehydrate into the drafting path would
 * fail there, which is the right place for it to fail.
 */

const INTAKE =
  'Client Jacob eloped twice. Mom Sarah called. Peer Ethan joined for the last ten minutes.';

const NOTE = {
  individualsPresent: ['Client'],
  clinicalStatus: ['Presented Calm'],
  clinicalStatusNarrative: 'The client settled quickly on arrival.',
  purpose: ['Worked on goals as stated in the treatment plan'],
  servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'Eight of ten trials came back correct with a gestural prompt.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'A two minute warning preceded each transition.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions and the technician blocked the door.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'Direct staff do not report new questions or concerns for the BCBA.',
  hints: [],
};

async function loggedIn(page) {
  await page.goto('/notes/bt/');
  await page.evaluate(() => {
    const payload = { role: 'user', kid: 'pw:tech-1', tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    localStorage.setItem('notes_auth_token', `${b64}.local-test`);
  });
  await page.reload();
}

const mapFor = (page, text) =>
  page.evaluate(async (t) => {
    const r = await window.NotesScrub.review({ freeText: t });
    return r.map.map((e) => ({ name: e.name, token: e.token, restore: !!e.restore }));
  }, text);

test.describe('every role token is numbered, and the separator is two hyphens', () => {
  test('the first person of a role is Client--1, not Client', async ({ page }) => {
    await loggedIn(page);
    const map = await mapFor(page, INTAKE);
    const jacob = map.find((e) => e.name === 'Jacob');
    expect(jacob).toBeTruthy();
    // The old mint dropped the number on the first of each role. A bare word is
    // exactly what the model writes on its own account, and it is what made the
    // rehydration below unsafe.
    expect(jacob.token).toBe('Client--1');
    expect(jacob.restore).toBe(false);
  });

  test('a second role gets its own counter, also from one', async ({ page }) => {
    await loggedIn(page);
    const map = await mapFor(page, INTAKE);
    expect(map.find((e) => e.name === 'Sarah').token).toBe('Caregiver--1');
    expect(map.find((e) => e.name === 'Ethan').token).toBe('Peer--1');
  });

  test('a second person of the SAME role numbers on rather than colliding', async ({ page }) => {
    await loggedIn(page);
    const map = await mapFor(page, 'Client Jacob and client Marcus both eloped.');
    const clients = map.filter((e) => /^Client--/.test(e.token)).map((e) => e.token).sort();
    expect(clients).toEqual(['Client--1', 'Client--2']);
  });

  test('a carried map seeds the counter, so a later scrub cannot reuse a number', async ({ page }) => {
    await loggedIn(page);
    // This is the guard that matters most in this block. A revision carries the
    // previous map forward; if seedsFromMap cannot read the new shape it starts
    // at one again and hands a SECOND person the token already standing for a
    // first, permanently and silently.
    const token = await page.evaluate(() =>
      window.NotesScrub._defaultTokens(
        ['Marcus'],
        'Client Marcus arrived.',
        [{ name: 'Jacob', token: 'Client--2', restore: false }]
      )[0].token
    );
    expect(token).toBe('Client--3');
  });

  test('the odd token is what actually crosses the wire', async ({ page }) => {
    const calls = [];
    await page.route('**/api/llm-call**', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}');
      if (!isTriageCall(b)) calls.push(b);
      /* Triage gates the draft, so it gets a real triage answer. Handing it an
         empty object stops the flow at a question and this test then fails
         because no draft happened rather than because the wire was wrong. */
      const text = isTriageCall(b)
        ? JSON.stringify({ sufficient: true, readiness: 95, questions: [] })
        : JSON.stringify(NOTE);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: [{ text }] }),
      });
    });

    await loggedIn(page);
    await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money array, 8 of 10 gestural');
    await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('two minute warning before transitions');
    await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill(INTAKE);
    await page.getByRole('button', { name: 'Generate Note' }).click();
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });

    const sent = JSON.stringify(calls);
    expect(sent).toContain('Client--1');
    expect(sent).not.toContain('Jacob');
  });
});

test.describe('rehydrate gives the clinician their own word back', () => {
  const run = (page, text, map) =>
    page.evaluate(([t, m]) => window.NotesScrub.rehydrate(t, m), [text, map]);

  test('a role token in their own sentence becomes the word they typed', async ({ page }) => {
    await loggedIn(page);
    const out = await run(page, 'Client--1 at session start', [
      { name: 'Happy', token: 'Client--1', restore: false },
    ]);
    // The exact sentence he read on 2026-09-02, and the exact word behind it.
    expect(out).toBe('Happy at session start');
  });

  test('it is not prefix-blind: Client--12 is not a Client--1 with a 2 after it', async ({ page }) => {
    await loggedIn(page);
    const out = await run(page, 'Client--1 and Client--12 played.', [
      { name: 'Jacob', token: 'Client--1', restore: false },
      { name: 'Ethan', token: 'Client--12', restore: false },
    ]);
    expect(out).toBe('Jacob and Ethan played.');
  });

  test('an opaque token is left where it is', async ({ page }) => {
    await loggedIn(page);
    // Opaque tokens round-trip through restoreOutput, which runs earlier. Doing
    // it twice would be harmless today and a duplicated rule to keep in step
    // forever, so this function stays out of it.
    const out = await run(page, 'The [[T1]] card came next.', [
      { name: 'Red', token: '[[T1]]', restore: true },
    ]);
    expect(out).toBe('The [[T1]] card came next.');
  });

  test('a sentence holding no token is returned unchanged', async ({ page }) => {
    await loggedIn(page);
    const out = await run(page, 'he wanted attention', [
      { name: 'Jacob', token: 'Client--1', restore: false },
    ]);
    expect(out).toBe('he wanted attention');
  });

  test('an empty map, an empty string and a missing map are all safe', async ({ page }) => {
    await loggedIn(page);
    expect(await run(page, 'Client--1 arrived.', [])).toBe('Client--1 arrived.');
    expect(await run(page, '', [{ name: 'Jacob', token: 'Client--1', restore: false }])).toBe('');
    expect(await page.evaluate(() => window.NotesScrub.rehydrate('Client--1 arrived.', null))).toBe('Client--1 arrived.');
  });
});
