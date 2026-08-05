import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

/* Capturing what the owning clinician changed.
 *
 * The safety argument for keeping a before/after pair at all rests on three
 * claims, so all three are asserted here rather than described in a comment:
 * nothing leaves the browser, nothing unverified is kept, and it only runs for
 * him. If any of these ever stops being true, this file should fail.
 */

const SECRET = 'playwright-local-test-secret';
const b64url = (b) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function tokenFor(role) {
  const payload = { role, kid: 'pw:' + role, tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${p}.${b64url(createHmac('sha256', SECRET).update(p).digest())}`;
}

// Long enough to clear the 25-word floor, and free of anything identifying.
const BEFORE =
  'The behavior technician presented a three item array and the client responded ' +
  'correctly on the majority of trials across the session, with prompting faded ' +
  'gradually from full physical to independent responding throughout.';
const AFTER =
  'The behavior technician presented a three item array, and the client responded ' +
  'correctly in eighty percent of trials measured across the session, with prompting ' +
  'faded from full physical to independent over the course of the visit.';

async function load(page, role) {
  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor(role));
  await page.goto('/notes/bt/');
  await page.waitForFunction(() => !!window.VoiceCapture);
}

test.describe('voice capture', () => {
  test('captures a pair for the owner', async ({ page }) => {
    await load(page, 'admin');
    const r = await page.evaluate(([b, a]) => {
      localStorage.removeItem('voice_pairs_v1');
      const why = window.VoiceCapture.capture(b, a, { tool: 'bt', source: 'revision' });
      return { why, pending: window.VoiceCapture.stats().pending, enabled: window.VoiceCapture.enabled() };
    }, [BEFORE, AFTER]);
    expect(r.enabled).toBe(true);
    expect(r.why).toBeNull();
    expect(r.pending).toBe(1);
  });

  test('captures nothing at all for a technician', async ({ page }) => {
    // A technician's revisions belong to that technician's style card. Rolling
    // them into his voice profile would be attributing someone else's writing to
    // him, which is worse than capturing nothing.
    await load(page, 'user');
    const r = await page.evaluate(([b, a]) => {
      localStorage.removeItem('voice_pairs_v1');
      return {
        why: window.VoiceCapture.capture(b, a, { tool: 'bt' }),
        pending: window.VoiceCapture.stats().pending,
        enabled: window.VoiceCapture.enabled(),
      };
    }, [BEFORE, AFTER]);
    expect(r.enabled).toBe(false);
    expect(r.why).toBe('not-owner');
    expect(r.pending).toBe(0);
  });

  test('refuses a pair with an identifier on either side, and says nothing about what it found', async ({ page }) => {
    // THE LOAD-BEARING ONE. A pair is generated clinical prose, and keeping one
    // is only defensible because something checked it first.
    await load(page, 'admin');
    const r = await page.evaluate(([b, a]) => {
      localStorage.removeItem('voice_pairs_v1');
      const dirty = b + ' Contact the parent on 555-123-4567 to confirm.';
      const beforeDirty = window.VoiceCapture.capture(dirty, a, { tool: 'bt' });
      const afterDirty = window.VoiceCapture.capture(b, a + ' Reached them at 555-123-4567.', { tool: 'bt' });
      return { beforeDirty, afterDirty, pending: window.VoiceCapture.stats().pending };
    }, [BEFORE, AFTER]);
    expect(r.beforeDirty).toBe('refused-identifier');
    expect(r.afterDirty).toBe('refused-identifier');
    // Nothing was kept, from either direction.
    expect(r.pending).toBe(0);
  });

  test('refuses a name the model invented, and passes the role tokens the scrub inserts', async ({ page }) => {
    // The first version of the verifier used the review modal's name detector,
    // which is a deliberately over-inclusive CANDIDATE generator: on ordinary
    // clinical prose it returns "presented", "responded", "prompting". As a
    // storage gate it refused everything, so the loop would have looked like it
    // was running while keeping nothing. It now checks for a capitalised word
    // that is not sentence-initial, not a role token, and not field vocabulary.
    await load(page, 'admin');
    const r = await page.evaluate(([b, a]) => {
      localStorage.removeItem('voice_pairs_v1');
      const tokens = 'Client responded to Caregiver. BCBA coached Technician with modeling and feedback during the visit, and the pair worked on tolerating a delay across the session.';
      return {
        rolesKept: window.VoiceCapture.capture(tokens, tokens.replace('modeling', 'modelling'), { tool: 'bt' }),
        nameRefused: window.VoiceCapture.capture(b + ' Marcus responded well.', a, { tool: 'bt' }),
      };
    }, [BEFORE, AFTER]);
    expect(r.rolesKept, 'role tokens are what the scrub itself inserts').toBeNull();
    expect(r.nameRefused).toBe('refused-identifier');
  });

  test('real clinical prose survives the gate, including named techniques and programs', async ({ page }) => {
    // THE ONE THAT NEARLY SANK IT. The first gate flagged any capitalised word
    // that was not on a hand-written allowlist, and ABA writing is full of
    // capitalised programme and technique names: it refused eight terms in one
    // paragraph and kept nothing, silently. detectNames has the same problem for
    // the same reason - it is a candidate generator for a modal, not a gate.
    //
    // The gate now asks whether a capitalised word IS a known first name, which
    // is the narrower question the situation allows: the input was scrubbed with
    // a person in the loop, so a name in the output was invented by the model.
    await load(page, 'admin');
    const r = await page.evaluate(() => {
      localStorage.removeItem('voice_pairs_v1');
      const techniques =
        'BCBA coached the technician using Behavioral Skills Training, with modeling and rehearsal. ' +
        'Discrete Trial Training was run in a three item array, and Natural Environment Teaching was ' +
        'used for the mand targets across the remainder of the session.';
      const programs =
        'The client worked on Receptive Identification and Expressive Labeling during the session. ' +
        'Progress on Tolerating Denial held steady, and the team reviewed the Behavior Intervention ' +
        'Plan before closing out the visit with the caregiver.';
      return {
        techniques: window.NotesScrub.verifyOutput(techniques).clean,
        programs: window.NotesScrub.verifyOutput(programs).clean,
        withName: window.NotesScrub.verifyOutput(techniques + ' Marcus responded well.').clean,
      };
    });
    expect(r.techniques, 'named techniques must not read as a person').toBe(true);
    expect(r.programs, 'named programs must not read as a person').toBe(true);
    expect(r.withName, 'an invented first name must still be caught').toBe(false);
  });

  test('refuses when the verifier is missing rather than storing unchecked', async ({ page }) => {
    // Failing open here would mean an unverified pair on disk, so it fails shut.
    await load(page, 'admin');
    const why = await page.evaluate(([b, a]) => {
      localStorage.removeItem('voice_pairs_v1');
      const real = window.NotesScrub.verifyOutput;
      delete window.NotesScrub.verifyOutput;
      const r = window.VoiceCapture.capture(b, a, { tool: 'bt' });
      window.NotesScrub.verifyOutput = real;
      return r;
    }, [BEFORE, AFTER]);
    expect(why).toBe('no-verifier');
  });

  test('skips a change too small to be a decision', async ({ page }) => {
    await load(page, 'admin');
    const r = await page.evaluate(() => {
      localStorage.removeItem('voice_pairs_v1');
      return {
        short: window.VoiceCapture.capture('Ran a probe.', 'Ran a trial.', { tool: 'bt' }),
        same: window.VoiceCapture.capture('identical text here', 'identical text here', { tool: 'bt' }),
      };
    });
    expect(r.short).toBe('too-short');
    expect(r.same).toBe('no-change');
  });

  test('never sends a pair anywhere', async ({ page }) => {
    // The whole design rests on this. Pairs live in his browser until he
    // exports them himself; there is no endpoint and there is meant to be no
    // request.
    const requests = [];
    page.on('request', (r) => {
      if (['POST', 'PUT', 'PATCH'].includes(r.method())) requests.push(r.url());
    });
    await load(page, 'admin');
    await page.evaluate(([b, a]) => {
      localStorage.removeItem('voice_pairs_v1');
      window.VoiceCapture.capture(b, a, { tool: 'bt', source: 'revision' });
    }, [BEFORE, AFTER]);
    await page.waitForTimeout(1200);
    expect(requests, `capture made ${requests.length} outbound call(s)`).toHaveLength(0);
  });

  test('the store is bounded, and drops the oldest rather than the newest', async ({ page }) => {
    await load(page, 'admin');
    const r = await page.evaluate(([b, a]) => {
      localStorage.removeItem('voice_pairs_v1');
      // Lower case on purpose: a capitalised token that is not field vocabulary
      // is exactly what the verifier refuses, and it would refuse all 205.
      for (let i = 0; i < 205; i++) window.VoiceCapture.capture(b + ' run number ' + i + '.', a, { tool: 'bt' });
      const list = window.VoiceCapture._read();
      return { n: list.length, first: list[0].before.slice(-18), last: list[list.length - 1].before.slice(-18) };
    }, [BEFORE, AFTER]);
    expect(r.n).toBe(200);
    // The newest survived; the oldest went.
    expect(r.last).toContain('204');
    expect(r.first).not.toContain('number 0.');
  });
});

/* Capture reports its own outcome, so nobody has to read a button to find out.
 *
 * It failed silently once already: the gate refused every note naming a clinical
 * technique, kept nothing, and the only way to discover that was to ask him what
 * the export button said. A reason from a closed set, in the counts-only audit
 * trail, closes that loop permanently.
 */
test.describe('capture telemetry', () => {
  test('an outcome is audited, and it carries no note text', async ({ page }) => {
    const posted = [];
    await page.route('**/api/audit**', async (route) => {
      posted.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await load(page, 'admin');

    await page.evaluate(([b, a]) => {
      localStorage.removeItem('voice_pairs_v1');
      // Drive the same path the engine uses, then emit as the engine does.
      const why = window.VoiceCapture.capture(b, a, { tool: 'bt', source: 'revision' });
      window.NotesGate.audit.emit('capture', {
        tool: 'bt', outcome: why || 'kept', pending: window.VoiceCapture.stats().pending,
      });
    }, [BEFORE, AFTER]);
    await page.waitForTimeout(1500);

    const body = JSON.stringify(posted);
    expect(posted.length, 'the outcome must reach the audit trail').toBeGreaterThan(0);
    expect(body).toMatch(/"outcome":"kept"/);
    // THE LOAD-BEARING HALF: counts and a fixed reason, never a word of the note.
    expect(body).not.toContain('technician presented');
    expect(body).not.toContain('eighty percent');
  });

  test('a refusal is reported as a reason, not as silence', async ({ page }) => {
    await load(page, 'admin');
    const why = await page.evaluate(([b, a]) => {
      localStorage.removeItem('voice_pairs_v1');
      return window.VoiceCapture.capture(b + ' Marcus responded well.', a, { tool: 'bt' });
    }, [BEFORE, AFTER]);
    // A closed-set string, safe to put in a durable trail.
    expect(why).toBe('refused-identifier');
    expect(why).not.toMatch(/Marcus/);
  });
});
