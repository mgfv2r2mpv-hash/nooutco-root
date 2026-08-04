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
