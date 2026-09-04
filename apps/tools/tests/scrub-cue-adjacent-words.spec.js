import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* THE WORD AFTER A ROLE CUE IS NOT A PERSON JUST FOR SITTING THERE.
 *
 * WHAT HE REPORTED ON 2026-09-04: "Some tokens are still ending up in the output
 * text for notes on main."
 *
 * THE DEFECT. detectNames builds three name-candidate patterns and two of them
 * carry a "gi" flag, so the cue half matches "client" and "Client" alike. That
 * same flag also lets the [A-Z] in SIMPLE_CAP match a lowercase letter, so the
 * pattern written to read "client Jacob" read "client labeled" just as happily.
 * The word after ANY role cue, and after with / for / beside, became a name
 * candidate whatever part of speech it was.
 *
 * WHY THAT PUT A TOKEN IN THE NOTE RATHER THAN COSTING A NUMBER. The two faults
 * compound. A candidate sitting next to a role cue is exactly what
 * personEvidence reads as proof of a person, so the verb did not get the opaque
 * token that round-trips - it got a ROLE token, and a role token is the one kind
 * that never comes back. Measured on the build before this change:
 *
 *   "Client labeled Blue, Red and Yellow cards."
 *     -> "Client Client--1 [[T2]], [[T3]] and [[T1]] cards."
 *
 * The clinician's verb was gone, the model wrote its note around a person who
 * does not exist, and "Client--1" stayed in the signed note. labeled, chased,
 * tolerated, honored, reports, mands and breaks all did the same thing.
 *
 * TWO-SIDED, AND THE SECOND SIDE IS THE ONE THAT MATTERS MOST. Every test in the
 * first block and the third fails against 64dfde63. The second block is what
 * stops the fix over-correcting: a capitalisation guard that also stopped taking
 * real names would pass every test above it and put a client's name in a note.
 */

async function loggedIn(page) {
  await page.goto('/notes/bt/');
  await page.evaluate(() => {
    const payload = { role: 'user', kid: 'pw:tech-1', tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    localStorage.setItem('notes_auth_token', `${b64}.local-test`);
  });
  await page.reload();
}

const names = (page, text) =>
  page.evaluate((t) => window.NotesGate._scrub.detectNames(t), text);

/* The map the drafting path actually builds, split the way the harm splits: an
   entry that restores costs the note nothing, and an entry that does not is
   permanent in what the technician signs. */
const scrubOf = (page, text) =>
  page.evaluate(async (t) => {
    const rev = await window.NotesScrub.review({ freeText: t });
    return {
      stays: rev.map.filter((e) => !e.restore).map((e) => `${e.name} -> ${e.token}`),
      restores: rev.map.filter((e) => e.restore).map((e) => `${e.name} -> ${e.token}`),
      scrubbed: window.NotesScrub.applyMap(t, rev.map),
    };
  }, text);

test.describe('the word after a role cue is not a person just for sitting there', () => {
  test('a verb after a role cue is not a name candidate', async ({ page }) => {
    await loggedIn(page);
    expect(await names(page, 'Client labeled Blue, Red and Yellow cards.')).not.toContain('labeled');
    expect(await names(page, 'Client chased peers during free play.')).not.toContain('chased');
    expect(await names(page, 'BT used hand over hand. Client tolerated it well.')).not.toContain('tolerated');
    expect(await names(page, 'Mom reports the client slept poorly.')).not.toContain('reports');
  });

  test('nor is the ordinary word after with, for or beside', async ({ page }) => {
    await loggedIn(page);
    // "Client mands for breaks" was two candidates in one clause: mands off the
    // cue pattern, breaks off the preposition pattern.
    const found = await names(page, 'Client mands for breaks. BT honored each one within five seconds.');
    expect(found).not.toContain('mands');
    expect(found).not.toContain('breaks');
    expect(found).not.toContain('honored');
  });

  test('and no permanent token is minted for a sentence holding no person', async ({ page }) => {
    await loggedIn(page);
    const r = await scrubOf(page, 'Client labeled Blue, Red and Yellow cards.');
    // The whole report, in one assertion: a sentence with nobody in it must
    // leave nothing behind in the signed note.
    expect(r.stays).toEqual([]);
  });

  test('the clinician keeps their own verb, which is what the note is built from', async ({ page }) => {
    await loggedIn(page);
    const r = await scrubOf(page, 'Client labeled Blue, Red and Yellow cards.');
    expect(r.scrubbed).toContain('labeled');
    // The colours are still taken, and they still come back: that half was
    // already right and this change must not trade it away.
    expect(r.restores.length).toBe(3);
    expect(r.scrubbed).not.toContain('Blue');
  });
});

test.describe('and the names are still taken', () => {
  test('a capitalised name after a cue still gets a role token that stays', async ({ page }) => {
    await loggedIn(page);
    const r = await scrubOf(page, 'Client Jacob eloped twice. Mom Sarah called. Peer Ethan joined.');
    expect(r.stays.sort()).toEqual(['Ethan -> Peer--1', 'Jacob -> Client--1', 'Sarah -> Caregiver--1']);
  });

  test('a name typed in lowercase is still taken, which is what the guard could have cost', async ({ page }) => {
    await loggedIn(page);
    /* This is the test that decides whether the fix is safe. The guard says a
       context-signal candidate must be capitalised, and a technician typing
       "mom sarah called" capitalises nothing. The first-names dictionary pass
       catches those words on its own, whatever their case, so nothing is lost -
       and if that pass is ever narrowed, this fails rather than a name reaching
       the model in the clear. */
    const r = await scrubOf(page, 'mom sarah called about thursday and client jacob eloped.');
    expect(r.stays.sort()).toEqual(['jacob -> Client--1', 'sarah -> Caregiver--1']);
    expect(r.scrubbed).not.toMatch(/sarah|jacob/i);
  });

  test('a capitalised word after a cue is still taken even when no dictionary knows it', async ({ page }) => {
    await loggedIn(page);
    // The cue pattern's real job, and the reason it is not simply deleted: an
    // uncommon name gets caught by its position when no list holds it.
    expect(await names(page, 'Client Adaeze worked on tacts.')).toContain('Adaeze');
  });
});

test.describe('the same flag, the same file, the expert copy', () => {
  const roles = (page, text) => page.evaluate((t) => window.NotesGate._scrub.inferRoles(t), text);

  test('inferRoles does not file an ordinary word as a person', async ({ page }) => {
    await loggedIn(page);
    // inferRoles carried the identical "gi" plus [A-Z] trap, two hundred lines
    // away. buildRoleMap reads it, so the wrong entry renames a word everywhere
    // it appears in what the expert is sent.
    expect(await roles(page, 'Mom reports the client slept poorly.')).toEqual({});
    expect(await roles(page, 'Client labeled the cards.')).toEqual({});
  });

  test('and still files a real one', async ({ page }) => {
    await loggedIn(page);
    expect(await roles(page, 'Mom Sarah called. Client Jacob eloped.')).toEqual({
      sarah: 'Caregiver', jacob: 'Client',
    });
  });
});

test.describe('what the technician actually signs', () => {
  const INTAKE = 'Client labeled Blue, Red and Yellow cards.';

  /* Echo the scrubbed line straight back, so whatever the page put on the wire is
     what the page gets back. Keyed on "cards", which survives both builds: before
     the fix the line reads "Client Client--1 [[T2]], [[T3]] and [[T1]] cards." */
  function echoReply(body) {
    const content = ((body.messages || []).map((m) => m.content || '').join('\n')) || '';
    const line = content.split('\n').find((l) => /cards/.test(l)) || '';
    return {
      individualsPresent: ['Client'],
      clinicalStatus: ['Presented Calm'],
      clinicalStatusNarrative: 'The client settled quickly on arrival.',
      purpose: ['Worked on goals as stated in the treatment plan'],
      servicePaused: 'No',
      abaTechniques: ['Discrete Trial Training'],
      lessonProgressNarrative: line.trim().slice(0, 400) || 'Nothing echoed.',
      antecedentStrategies: ['Offered choices'],
      antecedentNarrative: 'A two minute warning preceded each transition.',
      consequenceStrategies: ['Redirection'],
      consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
      behaviorPlanNarrative: 'Redirection was delivered within five seconds each time.',
      clientProgress: 'Steady progress towards goals and behaviors',
      actionItems: ['None'],
      followUpNarrative: 'Direct staff do not report new questions or concerns for the BCBA.',
      hints: [],
    };
  }

  async function draft(page) {
    await page.route('**/api/llm-call**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const text = isTriageCall(body)
        ? JSON.stringify({ sufficient: true, readiness: 95, questions: [] })
        : JSON.stringify(echoReply(body));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ text }] }) });
    });
    await loggedIn(page);
    await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill(INTAKE);
    await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before each demand');
    await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
    await page.getByRole('button', { name: 'Generate Note' }).click();
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });
    /* The note, not the page. The substitution banner beside the inputs is
       supposed to name every swap, and counting it as a leak would fail a working
       build; the narratives are editable, so their text lives in textarea values
       that innerText cannot see. */
    return page.getByTestId('generated-note').evaluate((el) =>
      [el.innerText, ...[...el.querySelectorAll('textarea')].map((t) => t.value)].join('\n'));
  }

  test('the signed note carries no role token for a sentence with nobody in it', async ({ page }) => {
    const noteText = await draft(page);
    expect(noteText).not.toMatch(/Client--\d/);
  });

  test('and it still says what the technician said', async ({ page }) => {
    const noteText = await draft(page);
    for (const word of ['labeled', 'Blue', 'Red', 'Yellow']) {
      expect(noteText, `"${word}" did not survive to the note`).toContain(word);
    }
  });
});
