import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

// Worker-level tests for the style-card routes and the correction write-through.
//
// These hit the real _worker.js through `wrangler pages dev`, not a mock. The
// dev server is bound a throwaway ADMIN_SECRET (see playwright.config.js) so a
// genuinely signed session token can be minted here - which is the only way to
// prove the authorisation behaviour rather than assume it.
//
// The profile Worker is NOT bound in dev, so every one of these also doubles as
// the fail-open test: this is exactly the state production is in until
// bt-profile-api is deployed.

const SECRET = 'playwright-local-test-secret';
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function tokenFor({ kid = 'pw:tech-1', role = 'user', expiresInSec = 3600 } = {}) {
  const payload = { role, kid, tools: ['bt'], exp: Math.floor(Date.now() / 1000) + expiresInSec };
  const payloadStr = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', SECRET).update(payloadStr).digest());
  return `${payloadStr}.${sig}`;
}

const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

test.describe('style card authorisation', () => {
  test('an unauthenticated request is refused', async ({ request }) => {
    const res = await request.get('/api/style-card.js');
    expect(res.status()).toBe(401);
  });

  test('a forged signature is refused', async ({ request }) => {
    const good = tokenFor();
    const forged = `${good.split('.')[0]}.${b64url(createHmac('sha256', 'wrong-secret').update(good.split('.')[0]).digest())}`;
    const res = await request.get('/api/style-card.js', { headers: auth(forged) });
    expect(res.status()).toBe(401);
  });

  test('a tampered payload is refused even though it decodes', async ({ request }) => {
    // Swap the payload for one naming a different technician, keeping the old
    // signature. If this ever passed, one technician could read another's card.
    const original = tokenFor({ kid: 'pw:tech-1' });
    const sig = original.split('.')[1];
    const swapped = b64url(
      new TextEncoder().encode(JSON.stringify({ role: 'user', kid: 'pw:someone-else', exp: Math.floor(Date.now() / 1000) + 3600 })),
    );
    const res = await request.get('/api/style-card.js', { headers: auth(`${swapped}.${sig}`) });
    expect(res.status()).toBe(401);
  });

  test('an expired token is refused', async ({ request }) => {
    const res = await request.get('/api/style-card.js', { headers: auth(tokenFor({ expiresInSec: -60 })) });
    expect(res.status()).toBe(401);
  });

  test('the card is scoped to the token, so a kid in the query string is ignored', async ({ request }) => {
    // The worker reads kid from the verified token and never from user input.
    // With no profile binding both come back identical, but the request must at
    // least not be refused or served someone else's card.
    const res = await request.get('/api/style-card.js?kid=pw:someone-else', {
      headers: auth(tokenFor({ kid: 'pw:tech-1' })),
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ available: false, rules: [], block: '' });
  });
});

test.describe('fail-open when the profile store is unavailable', () => {
  test('a missing profile binding yields an empty card, not an error', async ({ request }) => {
    // This is the live state until bt-profile-api is deployed. A technician must
    // not see a failure, and generation must not be blocked.
    const res = await request.get('/api/style-card.js', { headers: auth(tokenFor()) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(false);
    expect(body.rules).toEqual([]);
    expect(body.block).toBe('');
  });

  test('an admin session has no technician profile and is told so plainly', async ({ request }) => {
    const payload = { role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 };
    const payloadStr = b64url(new TextEncoder().encode(JSON.stringify(payload)));
    const sig = b64url(createHmac('sha256', SECRET).update(payloadStr).digest());

    const res = await request.get('/api/style-card.js', { headers: auth(`${payloadStr}.${sig}`) });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ available: false });
  });

  test('muting fails loudly rather than silently pretending it worked', async ({ request }) => {
    // The card read fails open because a note must still generate. A mute is a
    // deliberate user action, so if it did not take effect the technician has to
    // be told -- otherwise a rule they switched off keeps shaping their notes.
    const res = await request.post('/api/style-card/mute.js', {
      headers: auth(tokenFor()),
      data: { feature: 'sentence_length', muted: true },
    });
    expect(res.status()).toBe(503);
  });

  test('a mute without a feature is a bad request', async ({ request }) => {
    const res = await request.post('/api/style-card/mute.js', {
      headers: auth(tokenFor()),
      data: { muted: true },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('corrections reaching the audit endpoint', () => {
  test('a correction carrying prose is stripped to its measurement', async ({ request }) => {
    // The route has no KV in dev either, so this asserts on the accepted count:
    // the correction must be accepted (shape is valid) while its prose fields
    // are irrelevant to what gets forwarded.
    const res = await request.post('/api/audit.js', {
      headers: auth(tokenFor()),
      data: {
        events: [],
        corrections: [
          {
            feature: 'sentence_length',
            direction: -1,
            magnitude: 0.5,
            before: 'Jacob eloped from the table three times.',
            after: 'The client left the table 3x.',
          },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.corrections).toBe(1);
    // No profile binding in dev, so the forward is skipped -- and says so.
    expect(body.profile).toBe('skipped');
  });

  test('a malformed correction is dropped rather than forwarded', async ({ request }) => {
    const res = await request.post('/api/audit.js', {
      headers: auth(tokenFor()),
      data: {
        events: [],
        corrections: [
          { feature: 'has space', direction: 1 },
          { feature: 'sentence_length', direction: 0 },
          { feature: 'sentence_length' },
          { direction: 1 },
          'not an object',
          null,
        ],
      },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).corrections).toBe(0);
  });

  test('an empty submission is accepted without writing anything', async ({ request }) => {
    const res = await request.post('/api/audit.js', {
      headers: auth(tokenFor()),
      data: { events: [], corrections: [] },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ stored: 0 });
  });

  test('corrections are capped so one request cannot write unbounded rows', async ({ request }) => {
    const flood = Array.from({ length: 400 }, () => ({ feature: 'hedging', direction: 1 }));
    const res = await request.post('/api/audit.js', {
      headers: auth(tokenFor()),
      data: { events: [], corrections: flood },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).corrections).toBe(50);
  });

  test('an unauthenticated correction is refused', async ({ request }) => {
    const res = await request.post('/api/audit.js', {
      data: { corrections: [{ feature: 'hedging', direction: 1 }] },
    });
    expect(res.status()).toBe(401);
  });
});
