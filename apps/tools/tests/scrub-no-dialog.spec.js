import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The scrub stopped asking, and still has to be right.
 *
 * Both dialogs are gone: the once-per-page legal acceptance and the confirm-first
 * name review. The maintainer named the second one the chief source of token error,
 * and the mechanism is alarm fatigue - thirty flags of which none are names trains a
 * person to clear the thirty-first without reading it.
 *
 * Deleting a confirmation is only safe if the thing it was confirming still happens,
 * so these are written from that angle. Every one of them would also pass against a
 * build where the dialog merely auto-clicked itself, which is deliberate: what is
 * being pinned is the OUTPUT, not the absence of a click. Two of them pin the
 * absence as well, because a modal that reappears would block the send silently.
 *
 * The escape the dialog used to own gets its own tests. It was the only caller of
 * nonPii.saveTerm, so if the notice's "not a name" button does not really certify,
 * this change quietly removed the only way to stop a false positive recurring and
 * nothing else in the suite would notice.
 */

const NOTE_WITH_NAMES = 'Jacob eloped twice. Mom Sarah called (555) 213-4477 about it.';

function noteReply() {
  return {
    individualsPresent: ['Client'],
    clinicalStatus: ['Presented Tired'],
    clinicalStatusNarrative: 'The client presented as tired on arrival.',
    purpose: ['Worked on goals as stated in the treatment plan'],
    servicePaused: 'No',
    abaTechniques: ['Discrete Trial Training'],
    lessonProgressNarrative: 'The behavior technician used a three-item array.',
    antecedentStrategies: ['Offered choices'],
    antecedentNarrative: 'Choices were offered before each demand.',
    consequenceStrategies: ['Redirection'],
    consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
    behaviorPlanNarrative: 'Elopement occurred on two occasions.',
    clientProgress: 'Steady progress towards goals and behaviors',
    actionItems: ['None'],
    followUpNarrative: 'Direct staff do not report new questions or concerns for the BCBA.',
    hints: [],
  };
}

async function loggedIn(page) {
  await page.goto('/notes/bt/');
  await page.evaluate(() => {
    const payload = { role: 'user', kid: 'pw:tech-1', tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    localStorage.setItem('notes_auth_token', `${b64}.local-test`);
  });
  await page.reload();
}

/** Draft a note carrying names, and hand back every note-call body that was sent. */
async function draft(page, text = NOTE_WITH_NAMES) {
  const calls = [];
  await page.route('**/api/llm-call**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (!isTriageCall(body)) calls.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: [{ text: JSON.stringify(noteReply()) }] }),
    });
  });

  await loggedIn(page);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill(text);
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });
  return calls;
}

test.describe('the scrub does not ask first', () => {
  test('neither dialog opens, and the note still drafts', async ({ page }) => {
    await draft(page);
    // Asserted after the draft completes rather than during: a modal that opened
    // and closed itself would still have been in the DOM at some point, and what
    // matters is that nothing ever waited on a human.
    await expect(page.locator('#notes-ack-backdrop')).toHaveCount(0);
    await expect(page.locator('#notes-scrub-backdrop')).toHaveCount(0);
  });

  test('the names and the phone number do not reach the API', async ({ page }) => {
    const calls = await draft(page);
    expect(calls.length).toBeGreaterThan(0);
    const sent = JSON.stringify(calls);
    for (const secret of ['Jacob', 'Sarah', '555', '213-4477']) {
      expect(sent, `"${secret}" crossed the wire`).not.toContain(secret);
    }
  });

  test('what went instead is a role token, not a bracket', async ({ page }) => {
    const calls = await draft(page);
    const sent = JSON.stringify(calls);
    // "Client" for the unlabelled name, "Caregiver" for the one behind "Mom".
    // This is the half a scrub-shaped no-op would fail: proving the names are
    // absent says nothing about whether anything readable replaced them.
    expect(sent).toContain('Client');
    expect(sent).toContain('Caregiver');
    expect(sent).not.toMatch(/\[NAME_\d\]/);
  });

  test('the legal notice is on the page before anything is sent', async ({ page }) => {
    await loggedIn(page);
    // It used to be a modal accepted once and never read again. If it is not
    // visible beside the textarea, deleting that modal deleted the notice.
    await expect(page.getByText(/without a signed Business Associate Agreement/i)).toBeVisible();
  });
});

test.describe('the notice carries the escape the dialog used to own', () => {
  test('it names what was taken, and what each became', async ({ page }) => {
    await draft(page);
    const notice = page.locator('text=Removed before this left your device').locator('..');
    // Jacob has no cue attached to him, so he is the Client. Sarah has "Mom"
    // directly in front of her, so she is the Caregiver. A build whose role
    // inference reads the whole sentence rather than the word next to the name
    // makes Jacob a Caregiver too, which is what this pins.
    await expect(notice).toContainText('Jacob → Client');
    await expect(notice).toContainText('Sarah → Caregiver');
  });

  test('"not a name" certifies the term so the next scrub keeps it', async ({ page }) => {
    await draft(page);
    const chip = page.locator('span', { hasText: /^Jacob → Client/ }).locator('button', { hasText: 'not a name' });
    await chip.click();
    await expect(page.getByText('✓ kept next time').first()).toBeVisible();

    // The button is only worth anything if it reached the store. This is the
    // assertion that fails if certifyNotPii is wired to state and nothing else.
    // The store lower-cases on the way in, which is why this compares that way.
    const terms = await page.evaluate(() => window.NotesGate.nonPii.load());
    expect(terms.map((e) => e.term)).toContain('jacob');
  });

  test('an identifier is not offered as "not a name"', async ({ page }) => {
    await draft(page);
    const notice = page.locator('text=Removed before this left your device').locator('..');
    // A phone number is never "not a name" in a way worth remembering, and a
    // button offering to keep one is a button somebody will eventually press.
    await expect(notice).not.toContainText('213-4477');
    const buttons = await notice.locator('button', { hasText: 'not a name' }).count();
    const names = await notice.locator('button', { hasText: 'not a name' }).allTextContents();
    expect(buttons, `offered on: ${names.join(', ')}`).toBeLessThanOrEqual(2);
  });
});
