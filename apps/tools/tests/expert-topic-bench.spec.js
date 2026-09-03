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

/* GRADING WHAT IT WROTE.
 *
 * The second half of his ask: "generate sandbox examples for him to grade and
 * correct." The route tests in expert-oracle.spec.js pin the frame and the
 * bands. These pin the part he touches - that the box is only there when there
 * is something to grade, that the band under his number is the band the model
 * will be told, that his words are scrubbed on the way out and his own back on
 * the way in, and that the rule the expert then states can reach the store
 * without being retyped.
 */
test.describe('grading the examples it writes', () => {
  async function answerThen(page, reply) {
    const sent = await openBench(page, (n) => ({
      body: n === 1
        ? { reply, metricsInForce: true, usage: null, model: 'test-model' }
        : { reply: 'The rule is: name what the antecedent did, not only what preceded it.',
            gradeTurn: 'SCORE: 78 out of 100, which puts it in "Close to Great!".',
            band: 'Close to Great!', metricsInForce: true, usage: null, model: 'test-model' },
    }));
    await page.locator('#btAsk').fill('write me an example note');
    await page.locator('#btSend').click();
    await expect(page.locator('#btLog')).toContainText(reply, { timeout: 10000 });
    return sent;
  }

  test('there is nothing to grade until it has written something', async ({ page }) => {
    // Present-then-hidden rather than merely absent, so deleting the whole panel
    // tomorrow does not leave this test passing.
    await openBench(page);
    await expect(page.locator('#btGradeBox')).toHaveCount(1);
    await expect(page.locator('#btGradeBox')).toBeHidden();
  });

  test('the box appears once it has, and goes away on Start over', async ({ page }) => {
    await answerThen(page, 'here is an example note');
    await expect(page.locator('#btGradeBox')).toBeVisible();
    await page.locator('#btScore').fill('78');
    await page.locator('#btReset').click();
    await expect(page.locator('#btGradeBox')).toBeHidden();
    await expect(page.locator('#btScore')).toHaveValue('');
  });

  test('the band under his number is the band the model is told', async ({ page }) => {
    /* The whole reason the page carries a second copy of the table. He picks a
       number by watching this label, so a label that disagrees with the Worker
       would have him grading against a band he never chose. The two tables are
       pinned against each other in expert-oracle.spec.js; this is the half that
       proves the label actually moves. */
    await answerThen(page, 'here is an example note');
    await page.locator('#btScore').fill('94');
    await expect(page.locator('#btBand')).toHaveText('Top-Tier Documentation');
    await page.locator('#btScore').fill('93');
    await expect(page.locator('#btBand')).toHaveText('Great Work!');
    await page.locator('#btScore').fill('69');
    await expect(page.locator('#btBand')).toHaveText('Keep going, your work is so important.');
  });

  test('a grade sends the number and his words, and no message of its own', async ({ page }) => {
    const sent = await answerThen(page, 'here is an example note');
    await page.locator('#btScore').fill('78');
    await page.locator('#btGradeNote').fill('the antecedent is named but not its effect');
    await page.locator('#btGrade').click();
    await expect.poll(() => sent.length, { timeout: 10000 }).toBe(2);

    expect(sent[1].grade).toEqual({ score: 78, comment: 'the antecedent is named but not its effect' });
    // The conversation ends on the example being graded. The frame is the
    // Worker's to write, so the page must not send one of its own.
    const roles = sent[1].messages.map((m) => m.role);
    expect(roles[roles.length - 1]).toBe('assistant');
    expect(JSON.stringify(sent[1].messages)).not.toContain('78 out of 100');
  });

  test('the frame the Worker composed is what lands in the transcript', async ({ page }) => {
    // Not a second version of it written here. He has to be able to tell a
    // disagreement about the note from a disagreement about the question.
    const sent = await answerThen(page, 'here is an example note');
    await page.locator('#btScore').fill('78');
    await page.locator('#btGrade').click();
    await expect(page.locator('#btLog')).toContainText('78 out of 100', { timeout: 10000 });
    await expect(page.locator('#btLog')).toContainText('Close to Great!');
    await expect(page.locator('#btUsage')).toContainText('Graded Close to Great!');
    expect(sent).toHaveLength(2);
  });

  test('a name typed into the grade note leaves de-identified and comes back his own', async ({ page }) => {
    /* Same round trip as the intake bench, asserted the same way: the stub hands
       back whatever the scrub chose, so the test never has to know the tokens.
       He is unlikely to type a client name into a grade, and "unlikely" is not
       a gate. */
    const sent = await openBench(page, (n) => {
      if (n === 1) return { body: { reply: 'here is an example note', metricsInForce: true, model: 'm' } };
      return null;
    });
    await page.route('**/api/expert-chat', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      sent.push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          body.grade
            ? { reply: 'noted', gradeTurn: 'WHAT I SAW IN IT:\n' + body.grade.comment, band: 'Close to Great!', metricsInForce: true, model: 'm' }
            : { reply: 'here is an example note', metricsInForce: true, model: 'm' }
        ),
      });
    });
    await page.locator('#btAsk').fill('write me an example note');
    await page.locator('#btSend').click();
    await expect(page.locator('#btLog')).toContainText('here is an example note', { timeout: 10000 });

    await page.locator('#btScore').fill('78');
    await page.locator('#btGradeNote').fill('Jacob would never have said that');
    await page.locator('#btGrade').click();
    await expect(page.locator('#btLog')).toContainText('noted', { timeout: 10000 });

    const graded = sent.filter((b) => b.grade);
    expect(graded).toHaveLength(1);
    expect(graded[0].grade.comment).not.toContain('Jacob');
    // And on screen it is his own sentence again, out of the same map.
    await expect(page.locator('#btLog')).toContainText('Jacob would never have said that');
  });

  test('a score off the scale never reaches the wire', async ({ page }) => {
    const sent = await answerThen(page, 'here is an example note');
    await page.locator('#btScore').fill('101');
    await page.locator('#btGrade').click();
    await expect(page.locator('#btGradeErr')).toBeVisible();
    expect(sent).toHaveLength(1);
  });

  test('an empty score is refused rather than sent as a nought', async ({ page }) => {
    // A blank box is not a zero, and a zero is a real grade he did not give.
    const sent = await answerThen(page, 'here is an example note');
    await page.locator('#btGradeNote').fill('all comment, no number');
    await page.locator('#btGrade').click();
    await expect(page.locator('#btGradeErr')).toBeVisible();
    expect(sent).toHaveLength(1);
  });

  test('the rule it then states can be carried to the store without retyping it', async ({ page }) => {
    /* The end of the loop. A rule that stays in a transcript reaches nothing:
       the expert only ever reads the knowledge store. This stops at staging - he
       still writes the title and approves it - because a bench answer going
       straight into a live prompt is the thing the review exists to prevent. */
    await answerThen(page, 'here is an example note');
    await page.locator('#btScore').fill('78');
    await page.locator('#btGrade').click();
    await expect(page.locator('#btLog')).toContainText('name what the antecedent did', { timeout: 10000 });

    await page.locator('#btPromote').click();
    await expect(page.locator('#tab-knowledge')).toBeVisible();
    await expect(page.locator('#knRule')).toHaveValue(/name what the antecedent did/);
    await expect(page.locator('#knTier')).toHaveValue('core');
    // Scoped to the tool the bench was pointed at, so a rule argued about bt
    // notes cannot land on every tool by default.
    expect(await page.locator('#knScope').inputValue()).toBe(await page.locator('#btTool').inputValue());
  });

  test('promoting before it has said anything says so rather than staging a blank', async ({ page }) => {
    await openBench(page);
    // The panel is hidden with no transcript, so reach the control directly:
    // the guard is in the handler, and that is what is being tested.
    await page.evaluate(() => document.getElementById('btPromote').click());
    await expect(page.locator('#knRule')).toHaveValue('');
  });

  test('a failed grade keeps his number and his reasoning', async ({ page }) => {
    /* Same rule as the question box, and it matters more here: the reasoning
       under a grade is the part that took thought, and a store that was down
       for a second is not a reason to write it twice. */
    const sent = await openBench(page, (n) => (n === 1
      ? { body: { reply: 'here is an example note', metricsInForce: true, model: 'm' } }
      : { status: 503, body: { error: 'The expert is unavailable.' } }));
    await page.locator('#btAsk').fill('write me an example note');
    await page.locator('#btSend').click();
    await expect(page.locator('#btLog')).toContainText('here is an example note', { timeout: 10000 });

    await page.locator('#btScore').fill('78');
    await page.locator('#btGradeNote').fill('the antecedent is named but not its effect');
    await page.locator('#btGrade').click();
    await expect(page.locator('#btErr')).toContainText('unavailable', { timeout: 10000 });
    await expect(page.locator('#btScore')).toHaveValue('78');
    await expect(page.locator('#btGradeNote')).toHaveValue('the antecedent is named but not its effect');
    expect(sent).toHaveLength(2);
  });

  test('and a sent one clears them, so the next example starts blank', async ({ page }) => {
    await answerThen(page, 'here is an example note');
    await page.locator('#btScore').fill('78');
    await page.locator('#btGradeNote').fill('thin on the antecedent');
    await page.locator('#btGrade').click();
    await expect(page.locator('#btLog')).toContainText('78 out of 100', { timeout: 10000 });
    await expect(page.locator('#btScore')).toHaveValue('');
    await expect(page.locator('#btGradeNote')).toHaveValue('');
  });

  test('the grading wiring parses, so no click is a silent no-op', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await answerThen(page, 'here is an example note');
    await page.locator('#btScore').fill('78');
    await page.locator('#btGrade').click();
    await expect(page.locator('#btLog')).toContainText('78 out of 100', { timeout: 10000 });
    await page.locator('#btPromote').click();
    expect(errors).toEqual([]);
  });
});
