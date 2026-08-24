import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

/* The expert pass de-identifies before it sends.
 *
 * The route was written expecting a scrubbed intake and its only caller sent
 * the raw textarea, so the Worker documented a control nobody performed. These
 * tests are what make the comment true, and they are deliberately two-sided:
 * proving the identifiers are GONE on the way out is only half of it, because a
 * scrub that never restores would pass that half and hand the clinician back
 * findings about "Person" and "[PHONE_1]".
 *
 * The assertions read the actual request body rather than trusting a helper's
 * return value. What matters is what crossed the wire.
 */

const SECRET = 'playwright-local-test-secret';
const TOKEN_KEY = 'notes_auth_token';
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function adminToken() {
  const payload = { role: 'admin', kid: 'pw:admin', exp: Math.floor(Date.now() / 1000) + 3600 };
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${p}.${b64url(createHmac('sha256', SECRET).update(p).digest())}`;
}

// One fixture carrying all three kinds at once, because they are scrubbed by
// two different passes and the ordering between them is the part most likely to
// break: "1420 Maple Street" contains a capitalised word that the name pass
// would otherwise take for a person.
const INTAKE = [
  'Session with client Jacob at home. Mom Sarah reported he eloped twice.',
  'Reach her at (555) 213-4477 or the home at 1420 Maple Street.',
  'BT Marcus ran the session and Jacob tolerated the wait.',
].join(' ');

const SECRETS = ['Jacob', 'Sarah', 'Marcus', '(555) 213-4477', '1420 Maple Street'];

/* The findings come back talking about the tokens, exactly as the model would.
 * Restoring them is what the caller has to get right. */
const FINDINGS = {
  terms: [{ token: 'SBT', reading: 'Skills-Based Treatment', status: 'resolved', why: 'Named beside toleration.' }],
  register: [
    {
      quote: 'Client tolerated the wait',
      action: 'keep',
      why: 'Observable.',
      move: 'Leave it.',
    },
  ],
  hints: [
    { section: 'note', rank: 1, kind: 'thin', ask: 'How many times did Client elope?', why: 'Caregiver reported two.' },
  ],
  hintsDropped: 0,
  usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  model: 'claude-haiku-4-5-20251001',
};

async function runBench(page, findings = FINDINGS) {
  await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
  const sent = [];
  await page.route('**/api/expert-pass', (route) => {
    sent.push(JSON.parse(route.request().postData() || '{}'));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(findings) });
  });
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Expert', exact: true }).click();
  await page.locator('#exIntake').fill(INTAKE);
  await page.getByRole('button', { name: 'Run the expert' }).click();
  await expect.poll(() => sent.length).toBe(1);
  return sent[0];
}

test.describe('the expert pass de-identifies before it sends', () => {
  test('not one of the five identifiers reaches the route', async ({ page }) => {
    const body = await runBench(page);
    for (const secret of SECRETS) {
      expect(body.intake, `"${secret}" crossed the wire`).not.toContain(secret);
    }
    // And it is still a usable note rather than a field of tokens.
    expect(body.intake).toContain('eloped twice');
    expect(body.intake).toContain('tolerated the wait');
  });

  test('the roles are inferred from the labels already in the note', async ({ page }) => {
    const body = await runBench(page);
    // "client Jacob" -> Client, "Mom Sarah" -> Caregiver, "BT Marcus" -> Technician.
    expect(body.intake).toContain('Client');
    expect(body.intake).toContain('Caregiver');
    expect(body.intake).toContain('Technician');
  });

  test('an unlabelled name becomes Person rather than a guessed Client', async ({ page }) => {
    /* The one wrong guess with teeth. Calling an unlabelled name Client tells
       the expert that a peer is the person the programme is about, and every
       ranked question then aims at the wrong human. */
    await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
    await page.goto('/admin/');
    const out = await page.evaluate(() =>
      window.NotesGate.scrubForAgent('Client Jacob played near Michael for ten minutes.')
    );
    // Jacob is labelled and becomes Client. Michael is not, and must not.
    expect(out.text).toContain('Person');
    expect(out.text).not.toContain('Michael');
    expect(out.text).toContain('Client');
    // The label is absorbed rather than left doubled up beside its own token.
    expect(out.text).not.toMatch(/client\s+Client/i);
    expect(out.text).toBe('Client played near Person for ten minutes.');
  });

  test('the findings come back carrying the real words again', async ({ page }) => {
    await runBench(page);
    // The model talked about Client and Caregiver; the clinician reads Jacob and Sarah.
    await expect(page.locator('#exHints')).toContainText('Jacob');
    await expect(page.locator('#exRegister')).toContainText('Jacob');
    await expect(page.locator('#exHints')).toContainText('Sarah');
    // And the tokens the model actually answered in are gone from what is shown.
    await expect(page.locator('#exHints')).not.toContainText('Client');
    await expect(page.locator('#exHints')).not.toContainText('Caregiver');
  });

  test('the page says what it took, in counts and never in words', async ({ page }) => {
    await runBench(page);
    const notice = page.locator('#exScrubbed');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/removed before this left your device/i);
    await expect(notice).toContainText('3 names');
    for (const secret of SECRETS) {
      await expect(notice).not.toContainText(secret);
    }
  });

  test('a clean intake says so rather than staying silent', async ({ page }) => {
    await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, adminToken()]);
    await page.route('**/api/expert-pass', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FINDINGS) })
    );
    await page.goto('/admin/');
    await page.getByRole('button', { name: 'Expert', exact: true }).click();
    await page.locator('#exIntake').fill('The learner tolerated a two minute wait with no protest.');
    await page.getByRole('button', { name: 'Run the expert' }).click();
    await expect(page.locator('#exScrubbed')).toContainText(/nothing to remove/i);
  });
});
