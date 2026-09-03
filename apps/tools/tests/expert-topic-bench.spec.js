import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

/* The standing-question bench: the expert with no intake in front of it.
 *
 * His ask: "the admin expert tool becomes conversational - engage on 'Let's
 * fine-tune BT session note completion criteria', answer questions, report
 * current metrics, generate sandbox examples for him to grade and correct."
 *
 * The route tests live in expert-oracle.spec.js. This file is about the page:
 * whether he can actually reach it, whether it sends what the route needs, and
 * whether it tells him when the answer he just read had no figures behind it.
 */

const SECRET = 'playwright-local-test-secret';
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function adminToken() {
  const p = { role: 'admin', kid: 'pw:admin', exp: Math.floor(Date.now() / 1000) + 3600 };
  const s = b64url(new TextEncoder().encode(JSON.stringify(p)));
  return `${s}.${b64url(createHmac('sha256', SECRET).update(s).digest())}`;
}

async function openBench(page, onChat) {
  const sent = [];
  await page.route('**/api/expert-chat', async (route) => {
    sent.push(JSON.parse(route.request().postData() || '{}'));
    const r = onChat ? onChat(sent.length) : {};
    await route.fulfill({
      status: r.status || 200,
      contentType: 'application/json',
      body: JSON.stringify(r.body || {
        reply: 'Across the last 30 days, 12 drafts were measured.',
        knowledgeInForce: '', topicInForce: 'x', metricsInForce: true,
        usage: { input_tokens: 10, output_tokens: 20 }, model: 'test-model',
      }),
    });
  });
  await page.goto('/admin/index.html');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), adminToken());
  await page.reload();
  await page.locator('.tab-btn[data-tab=expert]').click();
  return sent;
}

test.describe('he can talk to the expert without pasting an intake', () => {
  test('the standing-question card is there before anything has been run', async ({ page }) => {
    // The intake bench hides its conversation until a pass has run. This one
    // must not: there is nothing to run first, and a card that appears only
    // after an unrelated step is a card he will never find.
    await openBench(page);
    await expect(page.locator('#btAsk')).toBeVisible();
    await expect(page.locator('#btSend')).toBeVisible();
    await expect(page.locator('#exOracleCard')).toBeHidden();
  });

  test('it comes prefilled with the question he actually asked for', async ({ page }) => {
    await openBench(page);
    await expect(page.locator('#btTopic')).toHaveValue("Let's fine-tune BT session note completion criteria");
  });

  test('the tool list is the same one the intake bench offers', async ({ page }) => {
    await openBench(page);
    const bench = await page.locator('#btTool option').allTextContents();
    const intake = await page.locator('#exTool option').allTextContents();
    expect(bench.length).toBeGreaterThan(0);
    expect(bench).toEqual(intake);
  });

  test('a message sends the topic and the tool, and no intake', async ({ page }) => {
    const sent = await openBench(page);
    await page.locator('#btAsk').fill('How are my BTs doing on antecedent strategies?');
    await page.locator('#btSend').click();
    await expect.poll(() => sent.length, { timeout: 10000 }).toBe(1);

    expect(sent[0].topic).toBe("Let's fine-tune BT session note completion criteria");
    expect(sent[0].tool, 'no tool was sent, so the worker cannot fetch a prompt').toBeTruthy();
    expect(sent[0].intake, 'the topic bench sent an intake it does not have').toBeFalsy();
    expect(sent[0].messages).toHaveLength(1);
    expect(sent[0].messages[0].role).toBe('user');
  });

  test('the reply is shown, and the conversation accumulates', async ({ page }) => {
    const sent = await openBench(page);
    await page.locator('#btAsk').fill('first question');
    await page.locator('#btSend').click();
    await expect(page.locator('#btLog')).toContainText('Across the last 30 days', { timeout: 10000 });

    await page.locator('#btAsk').fill('second question');
    await page.locator('#btSend').click();
    await expect.poll(() => sent.length, { timeout: 10000 }).toBe(2);
    // Three turns: his first, the reply, his second. A bench that resent only
    // the newest message would be answering each question cold.
    expect(sent[1].messages).toHaveLength(3);
    expect(sent[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  test('it says plainly when the answer had no figures behind it', async ({ page }) => {
    /* The failure this exists for: the store is down, the expert answers in the
       abstract because it was told to, and the answer reads exactly like one
       backed by real rates. He would act on it. */
    await openBench(page, () => ({
      body: { reply: 'I have no figures for that.', metricsInForce: false, usage: null, model: 'test-model' },
    }));
    await page.locator('#btAsk').fill('how many notes last month');
    await page.locator('#btSend').click();
    await expect(page.locator('#btUsage')).toContainText('NO figures', { timeout: 10000 });
  });

  test('and says when it did have them', async ({ page }) => {
    await openBench(page);
    await page.locator('#btAsk').fill('how many notes last month');
    await page.locator('#btSend').click();
    await expect(page.locator('#btUsage')).toContainText("store's figures", { timeout: 10000 });
  });

  test('an empty message is refused before anything is sent', async ({ page }) => {
    const sent = await openBench(page);
    await page.locator('#btSend').click();
    await expect(page.locator('#btErr')).toBeVisible();
    expect(sent).toHaveLength(0);
  });

  test('Start over clears the transcript without reloading the page', async ({ page }) => {
    await openBench(page);
    await page.locator('#btAsk').fill('something');
    await page.locator('#btSend').click();
    await expect(page.locator('#btLog')).toContainText('Across the last 30 days', { timeout: 10000 });
    await page.locator('#btReset').click();
    await expect(page.locator('#btLog')).toContainText('Nothing asked yet');
  });

  test('a failed turn keeps his question rather than making him retype it', async ({ page }) => {
    await openBench(page, () => ({ status: 503, body: { error: 'The expert is unavailable.' } }));
    await page.locator('#btAsk').fill('a question worth keeping');
    await page.locator('#btSend').click();
    await expect(page.locator('#btErr')).toContainText('unavailable', { timeout: 10000 });
    await expect(page.locator('#btLog')).toContainText('a question worth keeping');
  });

  test('the two benches keep separate transcripts', async ({ page }) => {
    // Their scrub maps are separate too, which is the real reason: a token that
    // stood for a name in one must not follow him into the other.
    await openBench(page);
    await page.locator('#btAsk').fill('bench question');
    await page.locator('#btSend').click();
    await expect(page.locator('#btLog')).toContainText('bench question', { timeout: 10000 });
    await expect(page.locator('#exChatLog')).not.toContainText('bench question');
  });

  test('the page still has no script errors, so the shared wiring parses', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openBench(page);
    await page.locator('#btAsk').fill('x');
    await page.locator('#btSend').click();
    await expect(page.locator('#btLog')).toContainText('Across the last 30 days', { timeout: 10000 });
    expect(errors).toEqual([]);
  });
});
