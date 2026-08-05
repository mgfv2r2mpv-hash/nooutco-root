import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

// "If I am logged in as an admin and I get feedback on something like hate, the
// Page is doing this and I don't like it, it should be smart and asked me if I
// want to submit that as a ticket stub that can be grilled and made into
// something proper for development later."
//
// His answer on where it goes: a GitHub issue on nooutco-root, because that is
// where the work already lives.
//
// It needs GITHUB_ISSUE_TOKEN: a fine-grained token with Issues: write and
// nothing else, set as a Pages secret. Until it exists the route says so rather
// than pretending to have filed anything, which is what these tests pin.

const SECRET = 'playwright-local-test-secret';
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function signed({ role = 'admin', kid = 'pw:admin' } = {}) {
  const payload = { role, kid, tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${p}.${b64url(createHmac('sha256', SECRET).update(p).digest())}`;
}
const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

test.describe('who may file a ticket', () => {
  test('an unauthenticated request is refused', async ({ request }) => {
    const res = await request.post('/api/admin/ticket.js', { data: { note: 'the page is doing a thing' } });
    expect(res.status()).toBe(401);
  });

  test('a signed technician token is refused', async ({ request }) => {
    // The tracker is not a place a technician should be able to write to.
    const res = await request.post('/api/admin/ticket.js', {
      headers: auth(signed({ role: 'user', kid: 'pw:tech' })),
      data: { note: 'the page is doing a thing' },
    });
    expect(res.status()).toBe(401);
  });

  test('an empty note is refused rather than filed', async ({ request }) => {
    const res = await request.post('/api/admin/ticket.js', {
      headers: auth(signed()), data: { note: '  ' },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('when no issue token is configured', () => {
  test('it says so plainly instead of pretending', async ({ request }) => {
    // An admin who believes they filed a ticket and did not is worse off than
    // one told the wiring is missing.
    const res = await request.post('/api/admin/ticket.js', {
      headers: auth(signed()),
      data: { note: 'the assistant panel covers the follow-up section on a laptop' },
    });
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/nothing was filed/i);
    expect(body.reason).toBe('no_issue_token');
  });
});

test.describe('the offer in the panel', () => {
  function tokenFor(role) {
    const p = { role, kid: 'k', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
    return Buffer.from(JSON.stringify(p)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.sig';
  }

  async function pointAtThePage(page, role) {
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor(role));
    await page.goto('/notes/bt/');
    await page.waitForSelector('#root h1', { timeout: 45000 });
    await page.locator('.point-toggle').click();
    await page.locator('h1').click();
  }

  test('an admin pointing at the page gets offered a stub, not a revision', async ({ page }) => {
    await pointAtThePage(page, 'admin');
    await expect(page.locator('.revision-chip')).toContainText('About the page');

    let llmCalls = 0;
    await page.route('**/api/llm-call**', (r) => { llmCalls++; return r.abort(); });

    await page.locator('.revision-input').fill('I hate that this heading takes a whole row');
    await page.locator('.revision-send').click();

    const offer = page.locator('.ticket-offer');
    await expect(offer).toBeVisible();
    await expect(offer).toContainText('I hate that this heading takes a whole row');
    // Feedback about the tool must never be sent to the note model.
    expect(llmCalls, 'page feedback must not become a revision').toBe(0);
  });

  test('declining keeps the text in the conversation', async ({ page }) => {
    await pointAtThePage(page, 'admin');
    await page.locator('.revision-input').fill('the panel covers the follow-up section');
    await page.locator('.revision-send').click();
    await expect(page.locator('.ticket-offer')).toBeVisible();

    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page.locator('.ticket-offer')).toHaveCount(0);
    // Nothing is lost by declining.
    await expect(page.locator('.revision-panel-body')).toContainText('the panel covers the follow-up section');
  });

  test('a failure to file says so and keeps the text', async ({ page }) => {
    await pointAtThePage(page, 'admin');
    await page.route('**/api/admin/ticket**', (r) => r.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: 'No GitHub token is configured, so nothing was filed.', reason: 'no_issue_token' }),
    }));
    await page.locator('.revision-input').fill('the timer pill overlaps the nav on a phone');
    await page.locator('.revision-send').click();
    await page.getByRole('button', { name: 'File it' }).click();

    await expect(page.locator('.revision-panel-body')).toContainText(/Could not file it/i);
    await expect(page.locator('.revision-panel-body')).toContainText(/Nothing was lost/i);
    await expect(page.locator('.revision-panel-body')).toContainText('the timer pill overlaps the nav on a phone');
  });

  test('filing reports the issue number', async ({ page }) => {
    await pointAtThePage(page, 'admin');
    await page.route('**/api/admin/ticket**', (r) => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, number: 412, url: 'https://github.com/x/y/issues/412' }),
    }));
    await page.locator('.revision-input').fill('the copy button is easy to hit by accident');
    await page.locator('.revision-send').click();
    await page.getByRole('button', { name: 'File it' }).click();

    await expect(page.locator('.revision-panel-body')).toContainText('#412');
    // Labelled a stub so nobody builds it before he has grilled it.
    await expect(page.locator('.revision-panel-body')).toContainText(/stub/i);
    await expect(page.locator('.ticket-offer')).toHaveCount(0);
  });

  test('a technician never gets the offer, because they cannot point at the page', async ({ page }) => {
    await pointAtThePage(page, 'user');
    // The click on the heading did nothing at all for a technician.
    await expect(page.locator('.revision-chip')).toHaveCount(0);
    await expect(page.locator('.ticket-offer')).toHaveCount(0);
  });
});


/* The keyword.
 *
 * His ruling of 2026-08-05: "I also need a secret 'file' keyword that I can put
 * on when it can't tell if I am giving feedback on the page or the content. If
 * it sees the word 'stub' anywhere in there it should ask."
 *
 * Pointing says it by where you clicked. The word says it outright, which is
 * what the ambiguous case needs.
 */
test.describe('the stub keyword', () => {
  function tokenFor(role) {
    const p = { role, kid: 'k', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
    return Buffer.from(JSON.stringify(p)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.sig';
  }
  async function open(page, role) {
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor(role));
    await page.goto('/notes/bt/');
    await page.waitForSelector('#root h1', { timeout: 45000 });
    const fab = page.locator('.revision-fab');
    if (await fab.isVisible().catch(() => false)) await fab.click();
    await expect(page.locator('.revision-input')).toBeVisible();
  }

  test('the word alone asks, with nothing pointed at', async ({ page }) => {
    await open(page, 'admin');
    let llmCalls = 0;
    await page.route('**/api/llm-call**', (r) => { llmCalls++; return r.abort(); });

    await page.locator('.revision-input').fill('the panel scroll jumps when a proposal lands, stub this');
    await page.locator('.revision-send').click();

    const offer = page.locator('.ticket-offer');
    await expect(offer).toBeVisible();
    await expect(offer).toContainText('the panel scroll jumps when a proposal lands');
    expect(llmCalls, 'a stub must never reach the note model').toBe(0);
  });

  test('it asks rather than filing, so the word is never a send button', async ({ page }) => {
    await open(page, 'admin');
    let filed = 0;
    await page.route('**/api/admin/ticket**', (r) => { filed++; return r.abort(); });
    await page.locator('.revision-input').fill('stub: the copy button is easy to miss');
    await page.locator('.revision-send').click();
    await expect(page.locator('.ticket-offer')).toBeVisible();
    expect(filed, 'his ruling was that it asks').toBe(0);
  });

  // A real note, so the section cards exist. Before drafting, every label on the
  // page is page furniture, which is the opposite of the case being tested.
  async function drafted(page) {
    const reply = (o) => ({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(o) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
    });
    const note = {
      individualsPresent: ['Client'], clinicalStatus: ['Presented Tired'],
      clinicalStatusNarrative: 'The client presented as tired on arrival today.',
      purpose: ['Worked on goals as stated in the treatment plan'], servicePaused: 'No',
      abaTechniques: ['Discrete Trial Training'],
      lessonProgressNarrative: 'A three-item array was used across the money program.',
      antecedentStrategies: ['Offered choices'],
      antecedentNarrative: 'Choices were offered before each demand presented.',
      consequenceStrategies: ['Redirection'],
      consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
      behaviorPlanNarrative: 'Elopement occurred on two occasions during the session.',
      clientProgress: 'Steady progress towards goals and behaviors',
      actionItems: ['None'],
      followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
      hints: [],
    };
    let calls = 0;
    await page.route('**/api/llm-call**', (r) => {
      calls++;
      return r.fulfill(reply(calls === 1 ? { sufficient: true, questions: [] } : note));
    });
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor('admin'));
    await page.goto('/notes/bt/');
    await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3-item array');
    await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board');
    await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked');
    await page.getByRole('button', { name: 'Generate Note' }).click();
    const ack = page.locator('#notes-ack-go');
    if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.locator('#notes-ack-cb').check();
      await ack.click();
    }
    const scrub = page.locator('#notes-scrub-go');
    if (await scrub.isVisible({ timeout: 1500 }).catch(() => false)) await scrub.click();
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });
    const close = page.locator('.revision-panel-close');
    if (await close.isVisible({ timeout: 2000 }).catch(() => false)) await close.click();
  }

  test('the word wins on a section he pointed at, so pointing is not the decider', async ({ page }) => {
    await drafted(page);
    await page.locator('.point-toggle').click();
    await page.getByText('Narrative of Lesson Progress', { exact: true }).click();
    // A genuine note section, which without the word would become a revision.
    await expect(page.locator('.revision-chip')).toContainText('Section:');

    let revisions = 0;
    await page.unroute('**/api/llm-call**');
    await page.route('**/api/llm-call**', (r) => { revisions++; return r.abort(); });
    await page.locator('.revision-input').fill('this section heading is wrong, stub it');
    await page.locator('.revision-send').click();

    await expect(page.locator('.ticket-offer')).toBeVisible();
    expect(revisions, 'the keyword overrides where he clicked').toBe(0);
  });

  test('the section he pointed at becomes the target on the stub', async ({ page }) => {
    await drafted(page);
    await page.locator('.point-toggle').click();
    await page.getByText('Narrative of Lesson Progress', { exact: true }).click();

    let filed = null;
    await page.unroute('**/api/llm-call**');
    await page.route('**/api/admin/ticket**', async (r) => {
      filed = JSON.parse(r.request().postData() || '{}');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, number: 99 }) });
    });
    await page.locator('.revision-input').fill('stub: this heading is wrong');
    await page.locator('.revision-send').click();
    await page.getByRole('button', { name: 'File it' }).click();
    await expect(page.locator('.revision-panel-body')).toContainText('#99');

    expect(filed, 'the stub must record what he was looking at').toBeTruthy();
    expect(filed.target).toContain('Narrative of Lesson Progress');
  });

  test('a message without the word does not become a ticket', async ({ page }) => {
    // The keyword must be the only thing that diverts a message. That an
    // ordinary revision still revises is covered by the revision specs, which
    // draft a note first; here there is nothing to revise, so this asserts the
    // half it can actually see.
    await open(page, 'admin');
    await page.route('**/api/llm-call**', (r) => r.abort());
    await page.locator('.revision-input').fill('make the behaviour section shorter');
    await page.locator('.revision-send').click();
    await page.waitForTimeout(1200);
    await expect(page.locator('.ticket-offer')).toHaveCount(0);
  });

  test('a technician saying stub gets no offer, because they cannot file one', async ({ page }) => {
    await open(page, 'user');
    await page.route('**/api/llm-call**', (r) => r.abort());
    await page.locator('.revision-input').fill('stub this, the button is confusing');
    await page.locator('.revision-send').click();
    await page.waitForTimeout(1200);
    await expect(page.locator('.ticket-offer')).toHaveCount(0);
  });
});
