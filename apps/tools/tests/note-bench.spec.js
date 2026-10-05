import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { isTriageCall } from './helpers/llm-call.js';

/* THE NOTE BENCH'S MECHANICS, with the model stubbed.
 *
 * scripts/bench drives the real page the way a user does and reads the finished
 * note back off the note card (Kaleb's goal, 2026-10-04: submission-worthy notes
 * from 100 to 125 typed words and 5 to 7 minutes). A live run costs drafts and
 * runs only with his say-so; this spec proves, for nothing, that the driver
 * fills a case, answers the page's questions from the case's truth, reads the
 * picks and narratives back, and that the checks fire on a bad note and stay
 * quiet on a good one. Every word is invented. */

const ROOT = process.cwd();
const url = (rel) => 'file://' + path.join(ROOT, rel);
const SECRET = 'playwright-local-test-secret';
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function token() {
  const payload = { role: 'user', kid: 'pw:bench', tools: ['parent', 'sup', 'assess', 'sap'], exp: Math.floor(Date.now() / 1000) + 3600 };
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${p}.${b64url(createHmac('sha256', SECRET).update(p).digest())}`;
}
const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const CASES = JSON.parse(readFileSync(path.join(ROOT, 'scripts/bench/cases/parent.json'), 'utf8')).cases;
const V1 = CASES.find((c) => c.id === 'v1-the-original-shape');

const MIDDLE = 'Parent/Family is trying to learn new strategies, but there are some small barriers to generalization.';
const GOOD = {
  individualsPresent: ['Parent/Caregiver', 'Client', 'Technician'],
  supportActivities: ['Collected data on current goals'],
  caregiverResponse: MIDDLE,
  progressStatus: 'Moderate progress towards goals',
  summary: 'BCBA met with caregivers about a staff transition the parents requested. Client completed Complete Functional One-Step Instructions on 2 of 3 trials, both with a physical prompt (criterion: gesture prompt). Climbing (Bx Reduction) occurred 2 times. Caregivers ran Prompt FCR (Antecedent) at 6/1. Caregivers implemented Prompt to Sit for Interval, Prompt to Go to Bathroom and Use Timer at 2/0.',
  followup: 'Review the missed FCR prompt with caregivers before the next session.',
  hints: [],
};
// The first option, not the third: the code moves "no barriers" down on its
// own when the notes name a barrier (#264), so only a pick the code leaves
// alone shows the check firing.
const BAD = { ...GOOD, caregiverResponse: 'Parent/Family is not responding to training due to large barriers and/or resistance.', summary: GOOD.summary + ' Caregivers met criterion on all three parent goals.' };

async function stub(page, draft) {
  const seen = { triage: 0, drafts: [] };
  await page.route('**/api/llm-call**', (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) {
      seen.triage += 1;
      return route.fulfill(reply(seen.triage === 1
        ? { sufficient: false, readiness: 60, questions: [{ field: 'sessionNotes', question: 'You wrote 0/3 on the one-step instruction. What happened on those trials?', suggestions: [] }] }
        : { sufficient: true, readiness: 90, questions: [] }));
    }
    seen.drafts.push(String((b.messages || [])[0]?.content || ''));
    return route.fulfill(reply(draft));
  });
  await page.clock.install();
  await page.goto('/notes/parent/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), token());
  return seen;
}

let drive;
let checks;
test.beforeAll(async () => {
  drive = await import(url('scripts/bench/lib/drive.mjs'));
  checks = await import(url('scripts/bench/lib/checks.mjs'));
});

test.describe('the bench drives the page', () => {
  test('answers a question from the truth, counts the typing, reads the note back', async ({ page }) => {
    const seen = await stub(page, GOOD);
    const out = await drive.runCase(page, V1, { unlockSend: (p) => p.clock.runFor(61_000), timeoutMs: 30000, settleMs: 3000 });

    expect(out.asked).toEqual([{ round: 1, question: 'You wrote 0/3 on the one-step instruction. What happened on those trials?', answered: true }]);
    expect(out.typed.intake).toBe(97);
    expect(out.typed.answers).toBeGreaterThan(10);
    expect(seen.drafts.join('\n')).toContain('Tantrum behavior occurred on 1 trial');
    expect(out.note.picks.caregiverResponse).toEqual([MIDDLE]);
    expect(out.note.text.summary).toContain('Prompt FCR');
  });

  test('a good note passes the checks and a bad one names what it broke', async ({ page }) => {
    await stub(page, GOOD);
    const good = await drive.runCase(page, V1, { unlockSend: (p) => p.clock.runFor(61_000), timeoutMs: 30000, settleMs: 3000 });
    expect(checks.checkNote(V1, good.note)).toEqual([]);
  });

  test('the checks fire on a bad note', async ({ page }) => {
    await stub(page, BAD);
    const bad = await drive.runCase(page, V1, { unlockSend: (p) => p.clock.runFor(61_000), timeoutMs: 30000, settleMs: 3000 });
    const fails = checks.checkNote(V1, bad.note).join('\n');
    expect(fails).toMatch(/Caregiver Response picked/);
    expect(fails).toMatch(/goal count the list does not support: "all three"/);
  });
});

test.describe('answer matching', () => {
  test('a question takes the truth entry it shares the most words with, or none', () => {
    const truth = [{ about: ['climbing', 'respond'], answer: 'A' }, { about: ['0/3', 'trials'], answer: 'B' }];
    expect(drive.answerFor('What happened on the 0/3 trials?', truth)).toBe('B');
    expect(drive.answerFor('How did caregivers respond to climbing?', truth)).toBe('A');
    expect(drive.answerFor('What was the weather?', truth)).toBeNull();
  });
});

/* Every case can be typed into its real page: a field label that matches no
   box, or a toggle with no such button, fails here for nothing instead of in a
   live run that costs drafts. */
test.describe('every bench case fits its page', () => {
  const files = ['parent', 'sup', 'bt', 'assess', 'sap']
    .map((t) => path.join(ROOT, `scripts/bench/cases/${t}.json`))
    .filter((f) => { try { readFileSync(f); return true; } catch { return false; } });
  for (const file of files) {
    const { tool, cases } = JSON.parse(readFileSync(file, 'utf8'));
    for (const c of cases) {
      test(`${tool}/${c.id}`, async ({ page }) => {
        await page.goto(c.page);
        await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), token());
        await page.goto(c.page);
        await drive.fillCase(page, c);
        for (const [label, text] of Object.entries(c.fields || {})) {
          await expect(page.getByRole('textbox', { name: new RegExp(label, 'i') })).toHaveValue(text);
        }
        for (const [label, value] of Object.entries(c.toggles || {})) {
          const row = page.locator('p', { hasText: label }).first().locator('xpath=following-sibling::div[1]');
          await expect(row.getByRole('button', { name: value, exact: true })).toHaveAttribute('aria-pressed', 'true');
        }
      });
    }
  }
});
