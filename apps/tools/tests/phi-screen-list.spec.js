import { test, expect } from '@playwright/test';

/* THE TYPE-TIME SCREEN LIST.
 *
 * The name dictionary is deliberately as wide as it is, and the census in
 * scripts/phi-census.mjs put a number on what that costs: 26 false positives
 * over 12 synthetic notes, 2.2 a note, and a supervision note naming three
 * programmes pays 10 on its own. The maintainer's ruling is that the width
 * stays and the false positives are paid for here instead, by a technician
 * clearing a word once before they draft.
 *
 * Every claim that makes that safe is asserted below, because each one is the
 * kind that looks true until somebody adds a call site:
 *
 *   a  a cleared word is not flagged in the next note
 *   b  the same word behind a role cue is flagged anyway
 *   c  an identifier cannot be screened by any route
 *   d  nothing that leaves the device carries the word
 *   e  the list survives a reload and is not plaintext on disk
 *
 * scrub-test.html is used because it loads notes-gate.js and notes-scrub.js with
 * no React, no Babel and no Turnstile, so the store and the consult are tested
 * on their own rather than through a note page.
 */

// The same shape notes-gate.js reads: base64url(JSON) "." signature. The
// signature is never checked in the browser (the server re-checks every call),
// so a local one is enough to give the page a signed-in technician to key a
// list to, which is the whole point of kid here.
function tokenFor(kid = 'kid-screen-1') {
  const payload = { role: 'user', kid, exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.sig`;
}

const SCREEN_KEY = (kid = 'kid-screen-1') => 'noaba_screen_' + kid;

/* Both network calls a signed-in page makes on its own account are stubbed. The
   audit one answers 500 on purpose so the buffer is not drained: test (d) reads
   what the page kept AND what it tried to send, and a 200 would leave only one
   of those to look at. */
async function openScrubPage(page, { kid = 'kid-screen-1', posted = null } = {}) {
  await page.route('**/api/nonpii**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"terms":[]}' }));
  await page.route('**/api/audit**', async (route) => {
    if (posted) posted.push(route.request().postData() || '');
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"stubbed"}' });
  });
  await page.addInitScript((t) => { localStorage.setItem('notes_auth_token', t); }, tokenFor(kid));
  await page.goto('/notes/scrub-test.html');
  await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.screen && window.NotesScrub));
  await page.evaluate(() => window.NotesGate.screen.ready);
}

const lower = (names) => names.map((n) => n.toLowerCase());

test.describe('a word the technician clears stops being flagged', () => {
  test('a cleared word is not flagged in the next note', async ({ page }) => {
    await openScrubPage(page);
    const NOTE = 'Worked on Grace targets today and ran three trials.';

    // Not a vacuous pass: the word IS flagged before the answer is given.
    expect(lower(await page.evaluate((t) => window.NotesScrub._detect(t), NOTE))).toContain('grace');

    const stored = await page.evaluate(() => window.NotesScrub.screenAnswer('Grace', 'not-a-person'));
    expect(stored).toBe(true);

    expect(lower(await page.evaluate((t) => window.NotesScrub._detect(t), NOTE))).not.toContain('grace');
  });

  test('the drafting path mints no token for it either', async ({ page }) => {
    await openScrubPage(page);
    const NOTE = 'Worked on Grace targets today and ran three trials.';

    const before = await page.evaluate(async (t) => {
      const r = await window.NotesScrub.review({ freeText: t, newNote: true, tool: 'bt' });
      return r.map.map((m) => m.name);
    }, NOTE);
    expect(lower(before)).toContain('grace');

    await page.evaluate(() => window.NotesScrub.screenAnswer('Grace', 'not-a-person'));

    const after = await page.evaluate(async (t) => {
      const r = await window.NotesScrub.review({ freeText: t, newNote: true, tool: 'bt' });
      return { names: r.map.map((m) => m.name), text: window.NotesScrub.applyMap(t, r.map) };
    }, NOTE);
    expect(lower(after.names)).not.toContain('grace');
    // And the word is still in the note rather than standing behind a token.
    expect(after.text).toContain('Grace');
  });

  test('the highlight overlay stops marking it too', async ({ page }) => {
    await openScrubPage(page);
    const NOTE = 'Worked on Grace targets today.';

    const marksFor = async () => page.evaluate((t) => {
      const ta = document.getElementById('live');
      ta.value = t;
      window.NotesScrub.installPHIHighlight();
      const hl = ta.parentElement.querySelector('.phi-hl-layer');
      // Force a sync without depending on the trigger keystroke rule.
      ta.dispatchEvent(new Event('blur'));
      return Array.from(hl.querySelectorAll('mark')).map((m) => m.textContent);
    }, NOTE);

    expect(await marksFor()).toContain('Grace');
    await page.evaluate(() => window.NotesScrub.screenAnswer('Grace', 'not-a-person'));
    expect(await marksFor()).not.toContain('Grace');
  });

  test('yes, take it puts a mis-cleared word back', async ({ page }) => {
    await openScrubPage(page);
    const NOTE = 'Worked on Grace targets today.';

    await page.evaluate(() => window.NotesScrub.screenAnswer('Grace', 'not-a-person'));
    expect(lower(await page.evaluate((t) => window.NotesScrub._detect(t), NOTE))).not.toContain('grace');

    const ok = await page.evaluate(() => window.NotesScrub.screenAnswer('Grace', 'take-it'));
    expect(ok).toBe(true);
    expect(lower(await page.evaluate((t) => window.NotesScrub._detect(t), NOTE))).toContain('grace');
  });
});

test.describe('a role cue beats a prior screening', () => {
  // The three attachments cueRole() recognises, one test each, because the
  // failure this guards against is a person's real name going into a note
  // unprotected because a programme once shared their name.
  for (const [label, text] of [
    ['a cue in front', 'mom Grace attended the session.'],
    ['a role label in front', 'client Grace tacted 8 of 10.'],
    ['an appositive behind', 'Grace, his mother, called at pickup.'],
  ]) {
    test(`a screened word is flagged again with ${label}`, async ({ page }) => {
      await openScrubPage(page);
      await page.evaluate(() => window.NotesScrub.screenAnswer('Grace', 'not-a-person'));

      // Still cleared where nothing says it is a person.
      expect(lower(await page.evaluate(() => window.NotesScrub._detect('Ran Grace programme drills.'))))
        .not.toContain('grace');

      expect(lower(await page.evaluate((t) => window.NotesScrub._detect(t), text))).toContain('grace');
    });
  }

  test('a cue in the same sentence but not attached claims nothing', async ({ page }) => {
    await openScrubPage(page);
    await page.evaluate(() => window.NotesScrub.screenAnswer('Grace', 'not-a-person'));
    // Adjacency, not proximity - the same rule the token path uses. "mom" is in
    // this sentence and is attached to nothing, so the screening stands.
    const names = await page.evaluate(() =>
      window.NotesScrub._detect('Ran Grace drills twice. Mom arrived at the end.'));
    expect(lower(names)).not.toContain('grace');
  });
});

test.describe('an identifier cannot be screened by any route', () => {
  test('the store refuses every identifier shape outright', async ({ page }) => {
    await openScrubPage(page);
    const result = await page.evaluate(() => {
      const tries = [
        '555-867-5309', '06/14/2018', 'June 3, 2019', 'jacob@clinic.org',
        '123 Jacob Street', 'MRN 88231', '123-45-6789', 'CA 90210', 'policy A88231',
      ];
      const accepted = tries.filter((t) => window.NotesGate.screen.add(t));
      const viaAnswer = tries.filter((t) => window.NotesScrub.screenAnswer(t, 'not-a-person'));
      return { accepted, viaAnswer, count: window.NotesGate.screen.count() };
    });
    expect(result.accepted).toEqual([]);
    expect(result.viaAnswer).toEqual([]);
    expect(result.count).toBe(0);
  });

  /* TWO LOCKS ON THE SAME DOOR, and the test above is opened by either one, so
     each gets a fixture the other would let through. Found by taking each guard
     out and watching nothing fail: every shape in the list above is refused
     twice over, which is the right way round for a safety rule and the wrong way
     round for a test that is meant to be holding one of them up. */
  test('the letters-only rule refuses a word no identifier pattern would catch', async ({ page }) => {
    await openScrubPage(page);
    const refused = await page.evaluate(() =>
      ['b12', 'apt 4b', '7th', 'room 3'].filter((w) => !window.NotesGate.screen.add(w)));
    expect(refused).toEqual(['b12', 'apt 4b', '7th', 'room 3']);
  });

  test('the identifier check refuses a labelled record number made only of letters', async ({ page }) => {
    await openScrubPage(page);
    // "policy abcdef" is two plain words, which the letters-only rule admits.
    // The labelled-ID pattern reads it as a record number, and that is the lock
    // that has to answer here.
    const out = await page.evaluate(() => ({
      added: window.NotesGate.screen.add('policy abcdef'),
      count: window.NotesGate.screen.count(),
    }));
    expect(out.added).toBe(false);
    expect(out.count).toBe(0);
  });

  test('screening a word inside an address does not take the address with it', async ({ page }) => {
    await openScrubPage(page);
    // "Jacob" is a plain word and can be screened. The address it sits inside is
    // not, and the identifier pass runs before the name pass and never reads the
    // list, so the whole literal still goes.
    expect(await page.evaluate(() => window.NotesScrub.screenAnswer('Jacob', 'not-a-person'))).toBe(true);

    const out = await page.evaluate(async () => {
      const t = 'Session ran at 123 Jacob Street. Call 555-867-5309 to reschedule.';
      const r = await window.NotesScrub.review({ freeText: t, newNote: true, tool: 'bt' });
      return { text: window.NotesScrub.applyMap(t, r.map), tokens: r.map.map((m) => m.token) };
    });
    expect(out.tokens).toContain('[ADDRESS_1]');
    expect(out.tokens).toContain('[PHONE_1]');
    expect(out.text).not.toContain('123 Jacob Street');
    expect(out.text).not.toContain('555-867-5309');
  });
});

test.describe('nothing that leaves the device carries the word', () => {
  test('the audit trail records a count and the pass name only', async ({ page }) => {
    const posted = [];
    await openScrubPage(page, { posted });

    await page.evaluate(() => {
      localStorage.removeItem('noaba.audit.buffer.v1');
      window.NotesScrub.screenAnswer('Grace', 'not-a-person');
    });
    await page.evaluate(async () => {
      await window.NotesScrub.review({
        freeText: 'Worked on Grace targets today.', newNote: true, tool: 'bt',
      });
    });

    const buffered = await page.evaluate(() => window.NotesGate.audit._buffer());

    // Not vacuous: the screening WAS recorded, with the count and the pass.
    const screen = buffered.filter((e) => e.type === 'phi_screen');
    expect(screen, 'the screened count never reached the audit buffer').toHaveLength(1);
    expect(screen[0].tool).toBe('bt');
    expect(screen[0].data).toMatchObject({ pass: 'name', screened: 1, cued: 0 });

    const answer = buffered.filter((e) => e.type === 'phi_screen_answer');
    expect(answer).toHaveLength(1);
    expect(answer[0].data).toMatchObject({ pass: 'name', cleared: 1, confirmed: 0 });

    // And the word is in none of it, buffered or sent. A four letter word passes
    // the client sanitiser's short-slug rule, so this is the emit site's claim
    // rather than the sanitiser's, and it is the one worth pinning.
    const wire = JSON.stringify(buffered) + posted.join('');
    expect(wire.toLowerCase()).not.toContain('grace');
  });

  test('the list has no endpoint to reach', async ({ page }) => {
    const calls = [];
    await page.route('**/api/**', async (route) => {
      calls.push({
        path: new URL(route.request().url()).pathname,
        body: route.request().postData() || '',
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    // Its own setup rather than openScrubPage, because a later route wins in
    // Playwright and the helper's two handlers would swallow the calls this test
    // exists to count.
    await page.addInitScript((t) => { localStorage.setItem('notes_auth_token', t); }, tokenFor());
    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.screen && window.NotesScrub));
    await page.evaluate(() => window.NotesGate.screen.ready);

    await page.evaluate(() => {
      window.NotesScrub.screenAnswer('Grace', 'not-a-person');
      window.NotesScrub.screenAnswer('Bishop', 'not-a-person');
      window.NotesScrub.screenAnswer('Milestones', 'not-a-person');
    });
    await page.waitForTimeout(500);

    /* The three calls a signed-in note page makes on its own account, and no
       fourth. scrub-config pulls dictionaries DOWN, nonpii carries the shared
       certified vocabulary, audit carries counts. None of them is a route the
       screen list could ride on, and there is no other route to add it to. */
    expect([...new Set(calls.map((c) => c.path))].sort())
      .toEqual(['/api/audit.js', '/api/nonpii.js', '/api/scrub-config.js']);
    const sent = calls.map((c) => c.body).join('').toLowerCase();
    for (const word of ['grace', 'bishop', 'milestones']) {
      expect(sent, `${word} left the device`).not.toContain(word);
    }
  });
});

test.describe('the list is durable, private and bounded', () => {
  test('it survives a reload and is not plaintext in localStorage', async ({ page }) => {
    await openScrubPage(page);
    await page.evaluate(() => window.NotesScrub.screenAnswer('Grace', 'not-a-person'));

    await page.waitForFunction((k) => !!localStorage.getItem(k), SCREEN_KEY());
    const raw = await page.evaluate((k) => localStorage.getItem(k), SCREEN_KEY());
    const rec = JSON.parse(raw);
    expect(rec).toMatchObject({ v: 1 });
    expect(typeof rec.iv).toBe('string');
    expect(typeof rec.ct).toBe('string');
    expect(Object.keys(rec).sort()).toEqual(['ct', 'iv', 'savedAt', 'v']);
    expect(raw.toLowerCase()).not.toContain('grace');

    await page.reload();
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.screen));
    await page.evaluate(() => window.NotesGate.screen.ready);

    expect(await page.evaluate(() => window.NotesGate.screen.has('Grace'))).toBe(true);
    expect(lower(await page.evaluate(() => window.NotesScrub._detect('Ran Grace drills.'))))
      .not.toContain('grace');
  });

  test('another technician on the same laptop reads their own list', async ({ page }) => {
    await openScrubPage(page);
    await page.evaluate(() => window.NotesScrub.screenAnswer('Grace', 'not-a-person'));
    await page.waitForFunction((k) => !!localStorage.getItem(k), SCREEN_KEY());

    const other = await page.evaluate(async (t) => {
      localStorage.setItem('notes_auth_token', t);
      window.dispatchEvent(new Event('notes-auth-change'));
      await window.NotesGate.screen.ready;
      return {
        owner: window.NotesGate.screen.owner(),
        has: window.NotesGate.screen.has('Grace'),
        flagged: window.NotesScrub._detect('Ran Grace drills.').map((n) => n.toLowerCase()),
      };
    }, tokenFor('kid-screen-2'));

    expect(other.owner).toBe('kid-screen-2');
    expect(other.has, 'one technician read another technician\'s answers').toBe(false);
    expect(other.flagged).toContain('grace');
  });

  test('a record moved to another key is not read as that technician\'s', async ({ page }) => {
    await openScrubPage(page);
    await page.evaluate(() => window.NotesScrub.screenAnswer('Grace', 'not-a-person'));
    await page.waitForFunction((k) => !!localStorage.getItem(k), SCREEN_KEY());

    /* The owner is inside the ciphertext as well as in the key name. Copying one
       technician's record onto another's key is the cheapest way to get a list
       onto somebody it was not given by, and the key name alone would not notice
       it. Same device and same AES key, so this decrypts - and is then refused
       on what it says about itself. */
    const other = await page.evaluate(async ({ from, to, tok }) => {
      localStorage.setItem(to, localStorage.getItem(from));
      localStorage.setItem('notes_auth_token', tok);
      window.dispatchEvent(new Event('notes-auth-change'));
      await window.NotesGate.screen.ready;
      return { has: window.NotesGate.screen.has('Grace'), count: window.NotesGate.screen.count() };
    }, { from: SCREEN_KEY(), to: SCREEN_KEY('kid-screen-3'), tok: tokenFor('kid-screen-3') });

    expect(other.has, 'a moved record was read as the new owner\'s own list').toBe(false);
    expect(other.count).toBe(0);
  });

  test('an entry unseen for enough notes expires', async ({ page }) => {
    await openScrubPage(page);
    await page.evaluate(() => window.NotesScrub.screenAnswer('Grace', 'not-a-person'));

    // 25 notes is the window. Twenty four of them leave it alone.
    const still = await page.evaluate(() => {
      for (let i = 0; i < 24; i += 1) window.NotesGate.screen.advanceNote();
      return window.NotesGate.screen.has('Grace');
    });
    expect(still).toBe(true);

    const gone = await page.evaluate(() => {
      for (let i = 0; i < 3; i += 1) window.NotesGate.screen.advanceNote();
      return { has: window.NotesGate.screen.has('Grace'), count: window.NotesGate.screen.count() };
    });
    expect(gone.has).toBe(false);
    expect(gone.count).toBe(0);
  });

  test('drafting notes is what advances the clock', async ({ page }) => {
    await openScrubPage(page);
    await page.evaluate(() => window.NotesScrub.screenAnswer('Grace', 'not-a-person'));

    /* The expiry is counted in NOTES, so the thing that has to tick it is a note
       being drafted, not a test calling the counter by hand. Twenty six drafts
       that never mention the word, and the answer is gone. */
    const after = await page.evaluate(async () => {
      for (let i = 0; i < 26; i += 1) {
        await window.NotesScrub.review({
          freeText: 'worked on requesting for twenty minutes today.', newNote: true, tool: 'bt',
        });
      }
      return { notes: window.NotesGate.screen._noteCount(), has: window.NotesGate.screen.has('Grace') };
    });
    expect(after.notes).toBe(26);
    expect(after.has, 'twenty six drafts did not age the answer out').toBe(false);
  });

  test('a revision does not tick it a second time', async ({ page }) => {
    await openScrubPage(page);
    const notes = await page.evaluate(async () => {
      const t = 'worked on requesting for twenty minutes today.';
      await window.NotesScrub.review({ freeText: t, newNote: true, tool: 'bt' });
      await window.NotesScrub.review({ freeText: 'make it shorter', newNote: false, tool: 'bt' });
      await window.NotesScrub.review({ freeText: 'and add the data', newNote: false, tool: 'bt' });
      return window.NotesGate.screen._noteCount();
    });
    // A technician who revises hard must not expire their own answers by lunch.
    expect(notes).toBe(1);
  });

  test('a note that uses the word again restarts its clock', async ({ page }) => {
    await openScrubPage(page);
    await page.evaluate(() => window.NotesScrub.screenAnswer('Grace', 'not-a-person'));

    const kept = await page.evaluate(async () => {
      for (let i = 0; i < 20; i += 1) window.NotesGate.screen.advanceNote();
      // A note that would have flagged it. review() ticks the counter itself and
      // marks the entry seen, which is the pair that has to work together.
      await window.NotesScrub.review({ freeText: 'Ran Grace drills.', newNote: true, tool: 'bt' });
      for (let i = 0; i < 20; i += 1) window.NotesGate.screen.advanceNote();
      return window.NotesGate.screen.has('Grace');
    });
    expect(kept, 'a word used every few notes expired anyway').toBe(true);
  });

  test('the list is capped', async ({ page }) => {
    await openScrubPage(page);
    const out = await page.evaluate(() => {
      // Letters only, because that is all the store will hold - see the
      // identifier tests above for why that rule is what it is.
      const letters = 'abcdefghijklmnopqrstuvwxyz';
      const words = [];
      for (let i = 0; i < 260; i += 1) {
        words.push('zz' + letters[Math.floor(i / 26)] + letters[i % 26]);
      }
      const accepted = words.filter((w) => window.NotesGate.screen.add(w)).length;
      return { accepted, count: window.NotesGate.screen.count() };
    });
    // Every one was accepted; the cap is what bounds the list, not a refusal.
    expect(out.accepted).toBe(260);
    expect(out.count).toBe(200);
  });

  test('a logged-out page screens nothing', async ({ page }) => {
    await page.route('**/api/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.screen));
    await page.evaluate(() => window.NotesGate.screen.ready);

    const out = await page.evaluate(() => ({
      owner: window.NotesGate.screen.owner(),
      added: window.NotesScrub.screenAnswer('Grace', 'not-a-person'),
      flagged: window.NotesScrub._detect('Ran Grace drills.').map((n) => n.toLowerCase()),
    }));
    // No technician to key a list to means no list, and the word is still taken.
    expect(out.owner).toBe(null);
    expect(out.added).toBe(false);
    expect(out.flagged).toContain('grace');
  });
});

test.describe('a tap on a mark resolves to the word under it', () => {
  test('the caret offset maps onto the span the overlay drew', async ({ page }) => {
    await openScrubPage(page);
    const hits = await page.evaluate(() => {
      const t = 'Worked with Jacob and mom Sarah on requesting.';
      return {
        inside: window.NotesScrub.markAt(t, t.indexOf('Jacob') + 2),
        edge: window.NotesScrub.markAt(t, t.indexOf('Sarah')),
        outside: window.NotesScrub.markAt(t, t.indexOf('requesting') + 3),
      };
    });
    expect(hits.inside.word).toBe('Jacob');
    expect(hits.edge.word).toBe('Sarah');
    expect(hits.outside).toBe(null);
  });

  test('a tap on the textarea raises the word, and a tap on plain text raises nothing', async ({ page }) => {
    await openScrubPage(page);
    const seen = await page.evaluate(async () => {
      const ta = document.getElementById('live');
      ta.value = 'Worked with Jacob on requesting.';
      window.NotesScrub.installPHIHighlight();
      const got = [];
      ta.addEventListener('notes-phi-mark', (e) => got.push(e.detail.word));

      ta.setSelectionRange(14, 14);           // inside "Jacob"
      ta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      ta.setSelectionRange(2, 2);             // inside "Worked"
      ta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return got;
    });
    expect(seen).toEqual(['Jacob']);
  });

  test('a two word name is one mark rather than a mark inside a mark', async ({ page }) => {
    await openScrubPage(page);
    const marks = await page.evaluate(() => {
      const ta = document.getElementById('live');
      ta.value = 'Caregiver Barbara Jean attended with Barbara.';
      window.NotesScrub.installPHIHighlight();
      const hl = ta.parentElement.querySelector('.phi-hl-layer');
      ta.dispatchEvent(new Event('blur'));
      return {
        texts: Array.from(hl.querySelectorAll('mark')).map((m) => m.textContent),
        nested: hl.querySelectorAll('mark mark').length,
      };
    });
    expect(marks.nested, 'a shorter name matched inside a mark already drawn').toBe(0);
    expect(marks.texts).toContain('Barbara');
  });
});
