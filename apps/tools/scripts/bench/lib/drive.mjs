/* THE NOTE BENCH DRIVES THE PAGE THE WAY A USER DOES.
 *
 * Kaleb's goal, 2026-10-04: every tool turns 100 to 125 typed words, plus the
 * follow-up questions, into a note he would submit, in 5 to 7 minutes of a
 * user's time. To measure that, a case is typed into the real page, the
 * questions the page asks are answered from the case's hidden session details
 * (`truth`), and the finished note is read back off the note card. Nothing here
 * reaches into the page's internals, so a bench run exercises exactly what a
 * user exercises: the scrub, the question rounds, the prompt store, the
 * self-revision and the backstops.
 *
 * Used two ways: by tests/note-bench.spec.js against the local server with the
 * model stubbed (no cost, proves the mechanics), and by scripts/bench/run.mjs
 * against the live site with a bench login (costs drafts; Kaleb approves). */

import { HELD_ROUND_ANSWER, readNoteCard } from './page-bench.mjs';

export { HELD_ROUND_ANSWER };

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;

/* The gates are off by ruling (2026-09-01); this clears them if they return. */
async function clearGates(page) {
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const review = page.locator('#notes-scrub-go');
  if (await review.isVisible({ timeout: 1200 }).catch(() => false)) await review.click();
}

export async function fillCase(page, c) {
  // A toggle is its label paragraph followed by a row of buttons.
  for (const [label, value] of Object.entries(c.toggles || {})) {
    const row = page.locator('p', { hasText: label }).first().locator('xpath=following-sibling::div[1]');
    await row.getByRole('button', { name: value, exact: true }).click();
  }
  // BT's arrival question: one button per choice, by its value.
  for (const [field, value] of Object.entries(c.choices || {})) {
    await page.locator(`[data-arrival-field="${field}"] [data-arrival="${value}"]`).click();
  }
  for (const [label, text] of Object.entries(c.fields || {})) {
    await page.getByRole('textbox', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).fill(text);
  }
}

/* The question asked, matched to the truth entry whose words it shares most.
   A question nothing in the truth speaks to is left alone, as a user who did
   not know would leave it. */
export function answerFor(question, truth) {
  const q = String(question || '').toLowerCase();
  let best = null;
  let bestHits = 0;
  for (const t of truth || []) {
    const hits = (t.about || []).filter((k) => q.includes(String(k).toLowerCase())).length;
    if (hits > bestHits) { best = t; bestHits = hits; }
  }
  return best ? best.answer : null;
}

/* The panel docks as a collapsed pill on some tools and open on others. */
async function openPanel(page) {
  const input = page.locator('.revision-input');
  if (await input.isVisible({ timeout: 800 }).catch(() => false)) return;
  const fab = page.locator('.revision-fab').first();
  if (await fab.isVisible({ timeout: 3000 }).catch(() => false)) await fab.click();
  await input.waitFor({ state: 'visible', timeout: 5000 });
}

/* Every question showing in the panel, with its index. */
async function questionsShown(page) {
  return page.locator('[data-panel-question]').evaluateAll((els) =>
    els.map((el) => ({ i: Number(el.getAttribute('data-panel-question')), text: el.innerText.split('\n')[0] })));
}

/* What the note card shows, read by the same function the console bench runs
   (page-bench.mjs readNoteCard), so a section the corrections pass drew as
   marks is read as the clinician copies it. Passed as source and evaluated as
   an expression, which is what keeps the two readers one. */
export async function readNote(page) {
  await page.getByTestId('generated-note').waitFor();
  return page.evaluate(`(${readNoteCard.toString()})(document.querySelector('[data-testid="generated-note"]'))`);
}

/* One case, start to finish. `opts.unlockSend` moves past the Send lock (the
   local spec runs it on a fake clock; live runs wait it out in real time). */
export async function runCase(page, c, opts = {}) {
  const started = Date.now();
  await page.goto(c.page);
  await fillCase(page, c);
  await page.getByRole('button', { name: /^(Generate|Regenerate)/ }).first().click();
  await clearGates(page);

  const typed = { intake: Object.values(c.fields || {}).reduce((n, t) => n + words(t), 0), answers: 0 };
  const asked = [];
  const held = [];
  const note = page.getByTestId('generated-note');
  const first = page.locator('[data-panel-question]').first();
  await Promise.race([
    note.waitFor({ timeout: opts.timeoutMs || 120000 }),
    first.waitFor({ timeout: opts.timeoutMs || 120000 }),
  ]);

  /* Up to 3 rounds, the page's own cap. A question with suggestions has its own
     words row and is answered there; the rest go together in the panel's Answer
     box, which the page pairs with the open questions, and Enter sends them. A
     round where nothing could be answered is sent empty, which drafts. */
  for (let round = 0; round < 3 && !(await note.isVisible().catch(() => false)); round++) {
    if (!(await page.locator('[data-panel-question]').count())) break;
    await openPanel(page);
    const loose = [];
    let answeredAny = false;
    for (const q of await questionsShown(page)) {
      const answer = answerFor(q.text, c.truth);
      asked.push({ round: round + 1, question: q.text, answered: !!answer });
      if (!answer) continue;
      answeredAny = true;
      typed.answers += words(answer);
      const own = page.locator(`[data-suggestion-own="${q.i}:own"]`);
      if (await own.isVisible().catch(() => false)) {
        await own.fill(answer);
        await own.press('Enter');
      } else {
        loose.push(answer);
      }
    }
    // A held round with nothing answered: the user's "nothing more", as
    // page-bench.mjs explains beside HELD_ROUND_ANSWER.
    if (!answeredAny && await page.locator('[data-skip-held]').isVisible().catch(() => false)) {
      held.push(round + 1);
      typed.answers += words(HELD_ROUND_ANSWER);
      loose.push(HELD_ROUND_ANSWER);
    }
    if (opts.unlockSend) await opts.unlockSend(page);
    const input = page.locator('.revision-input');
    if (loose.length) {
      await input.fill(loose.join(' '));
      await input.press('Enter');
    } else {
      await page.waitForFunction(() => {
        const b = document.querySelector('.revision-send');
        return b && !b.disabled;
      }, null, { timeout: opts.lockWaitMs || 120000 });
      await page.locator('.revision-send').click();
    }
    // The next round's questions, or the note.
    await Promise.race([
      note.waitFor({ timeout: opts.timeoutMs || 120000 }),
      page.waitForFunction((n) => document.querySelectorAll('[data-panel-question]').length > 0
        && document.querySelector('[data-panel-question]').innerText !== n, asked[asked.length - 1]?.question || '',
      { timeout: opts.timeoutMs || 120000 }),
    ]).catch(() => {});
  }
  await note.waitFor({ timeout: opts.timeoutMs || 120000 });

  // The passes after the first draft (self-revision, corrections) settle here.
  await page.waitForLoadState('networkidle', { timeout: opts.settleMs || 60000 }).catch(() => {});
  return {
    id: c.id,
    note: await readNote(page),
    asked,
    held,
    typed: { ...typed, total: typed.intake + typed.answers },
    seconds: Math.round((Date.now() - started) / 1000),
  };
}
