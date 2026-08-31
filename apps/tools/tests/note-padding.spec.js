import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

/* A note that ran to two and a half times its own intake.
 *
 * Measured 2026-08-16 on a real sup note: 264 words of intake produced 638 words
 * of note, and the maintainer read it and said it said more than the session did
 * and he would have cut it. sup caps its four sections at 26 sentences in total,
 * so the model had filled its ceilings against a thin input.
 *
 * The cause was not a missing instruction. sup.js already says "Sparse input →
 * brief honest sentences", and register-rules.js already says a range is a
 * ceiling and never a target. The one line in the whole stack that says DO NOT
 * PAD lived in intake-voice.js behind `thin`, which is `words < 60`. At 264
 * words that gate never opened, so the instruction was absent from the very
 * prompt that padded.
 *
 * Another adjective would have been the same mistake. The model cannot judge
 * "sparse" without a reference and nothing gave it one, so it gets the number.
 */

const SECRET = 'playwright-local-test-secret';
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function adminToken() {
  const payload = { role: 'admin', kid: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 };
  const s = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${s}.${b64url(createHmac('sha256', SECRET).update(s).digest())}`;
}

// Comfortably over the 60-word `thin` gate, so it reproduces the failing case.
const NOT_THIN = Array.from({ length: 14 }, (_, i) =>
  `Trial block ${i + 1} ran with a three item array and the technician faded the prompt by the sixth presentation.`
).join('\n');

// Over the 25-word floor that makes an intake measurable at all, under the
// 60-word `thin` gate. Both lines should fire on this one.
const THIN = `DTT money program with a three item array today.
started full physical and faded to gestural by the sixth trial.
8 of 12 correct across the block.
no SIB today, and no elopement either.`;

test.beforeEach(async ({ page }) => {
  await page.goto('/notes/bt/');
  await page.waitForFunction(() => !!window.IntakeVoice);
});

const B = (page, text) => page.evaluate((t) => window.IntakeVoice.block(t), text);

test.describe('the intake size reaches the model', () => {
  test('a substantial intake is told its own size, which it never used to be', async ({ page }) => {
    const block = await B(page, NOT_THIN);
    expect(block).toMatch(/notes you were given run to \d+ words across \d+ sentences/);
  });

  test('the anti-padding rule no longer waits for a short intake', async ({ page }) => {
    // This is the regression. Before, a 264-word intake got nothing at all about
    // length, because the only such line sat behind words < 60.
    const block = await B(page, NOT_THIN);
    expect(block).toMatch(/ceiling and never a target/);
    expect(block).toMatch(/Every sentence you write comes from something in those notes/);
  });

  test('it still says something extra when the notes really are short', async ({ page }) => {
    const block = await B(page, THIN);
    expect(block).toMatch(/SHORT today/);
    expect(block).toMatch(/brief honest note is the correct output/);
    // And the size line is there too, because both are true at once.
    expect(block).toMatch(/run to \d+ words/);
  });

  test('the number it reports is the number it measured', async ({ page }) => {
    const { block, measured } = await page.evaluate((t) => ({
      block: window.IntakeVoice.block(t),
      measured: window.IntakeVoice.measure(t),
    }), NOT_THIN);
    expect(block).toContain(`run to ${measured.words} words across ${measured.sentences} sentences`);
  });

  test('nothing measurable is still an empty block, so a note drafts as before', async ({ page }) => {
    expect(await B(page, 'too short')).toBe('');
  });

  test('the block carries numbers and never the words it measured', async ({ page }) => {
    const block = await B(page, NOT_THIN);
    // "money", "SIB", any content word from the intake must not appear.
    expect(block).not.toContain('three item array');
    expect(block).not.toContain('Trial block');
  });
});

test.describe('the register measurement actually reaches the store', () => {
  test('note_register is accepted rather than dropped at the door', async ({ request }) => {
    // It was not on the allowlist, so 16 numbers per draft died here while
    // weekly.js, index.js and validate.js were all built to consume them.
    const res = await request.post('/api/audit', {
      headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' },
      data: { events: [{ type: 'note_register', tool: 'sup', ts: Date.now(), data: { words: 638, intakeWords: 264, expansion: 2.417 } }] },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).stored).toBe(1);
  });

  test('a fraction survives, because rounding one to an integer is what broke the shape profile', async ({ request }) => {
    // index.js folds a note into the shape profile only when sectionCv and
    // sectionStep are finite AND greater than zero. Both are well under 1, so
    // Math.round sent 0 every time and the fold never happened.
    const res = await request.post('/api/audit', {
      headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' },
      data: { events: [{ type: 'note_register', tool: 'sup', ts: Date.now(), data: { sectionCv: 0.34, sectionStep: 0.21 } }] },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).stored).toBe(1);
  });

  test('an unknown event type is still refused', async ({ request }) => {
    const res = await request.post('/api/audit', {
      headers: { Authorization: `Bearer ${adminToken()}`, 'Content-Type': 'application/json' },
      data: { events: [{ type: 'not_a_real_event', tool: 'sup', ts: Date.now(), data: { n: 1 } }] },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).stored).toBe(0);
  });
});
