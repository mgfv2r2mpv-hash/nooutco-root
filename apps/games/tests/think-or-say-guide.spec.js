import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/**
 * ════════════════════════════════════════════════════════════════════════
 * think-or-say: the staff guide
 *
 * The guide is a TRANSLATION LAYER, not a manual: it says which switch
 * corresponds to which part of the Skill Acquisition Plan and what that switch
 * does on screen. It must not help a behaviour technician decide how to run the
 * programme — that is the BCBA's call via the plan — so this spec holds two
 * things in place that prose alone will not:
 *
 *   * SAP-FIRST FRAMING. The plan is the programme; where a plan is silent the
 *     guide says "ask your BCBA" and never "pick what works for you". There is
 *     deliberately no "what you're seeing → what to set" table, because that
 *     shape invites exactly the clinical judgement that is not the BT's to make.
 *   * ONE SOURCE, TWO SHIPMENTS. The in-game Guide screen and the standalone
 *     downloadable file are both produced by staff-guide.js's buildBody() from
 *     the same SECTIONS array. The strongest available proof is that their text
 *     is IDENTICAL, so this spec compares them character for character rather
 *     than spot-checking a heading in each.
 *
 * The standalone file is built in the browser from a Blob and never leaves the
 * device, like everything else this game produces (apps/games/CLAUDE.md §5).
 * ════════════════════════════════════════════════════════════════════════
 */

const URL = '/think-or-say/';
const STORE = 'nooutco.settings.think-or-say';

async function seed(page, working) {
  await page.addInitScript((args) => {
    localStorage.setItem(args.key, JSON.stringify({ working: args.cfg }));
  }, { key: STORE, cfg: working });
}

async function booted(page) {
  await expect(page.locator('#sel-category option').first()).toHaveText('All categories');
}

/** Whitespace-normalized text, so the two renderings compare on content only. */
const squash = s => s.replace(/\s+/g, ' ').trim();

async function openGuide(page) {
  await page.locator('#btn-guide').click();
  await expect(page.locator('#guide-screen')).toBeVisible();
  return squash(await page.locator('#guide-body').textContent());
}

const sections = page => page.evaluate(() =>
  window.ThinkOrSayGuide.SECTIONS.map(s => ({ id: s.id, heading: s.heading })));

const standalone = page => page.evaluate(() => window.ThinkOrSayGuide.renderStandalone());

// ── It is there, and it is whole ────────────────────────────────────────────

test('the Guide button opens a screen carrying every declared section', async ({ page }) => {
  await page.goto(URL);
  await booted(page);

  await expect(page.locator('#guide-screen')).toBeHidden();
  const text = await openGuide(page);

  const declared = await sections(page);
  expect(declared.length).toBeGreaterThan(6);
  for (const s of declared) {
    const node = page.locator('#guide-' + s.id);
    await expect(node).toBeVisible();
    await expect(node.locator('h2')).toHaveText(s.heading);
    expect(text).toContain(s.heading);
  }

  // The title and the audience line, so the file a service prints says what it
  // is and who it is for on its first two lines.
  await expect(page.locator('#guide-body .guide-title')).toHaveText('Think or Say? - Staff Guide');
  expect(text).toContain('For behaviour technicians');
});

test('the guide opens over a running trial and Close puts that trial back', async ({ page }) => {
  await seed(page, { level: 1, category: 'work', order: 'sequential' });
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();
  const card = await page.locator('#scenario-situation').textContent();

  await page.locator('#btn-guide').click();
  await expect(page.locator('#guide-screen')).toBeVisible();
  await expect(page.locator('#game-area')).toBeHidden();

  await page.locator('#btn-guide-close').click();
  await expect(page.locator('#guide-screen')).toBeHidden();
  await expect(page.locator('#game-area')).toBeVisible();
  // The same card, unanswered — reading the guide is not a trial.
  await expect(page.locator('#scenario-situation')).toHaveText(card);
  await expect(page.locator('#choices')).toBeHidden();
  expect(await page.evaluate(() => window.__thinkOrSay.session().results.length)).toBe(0);
});

test('Play reaches past an open guide and closes it', async ({ page }) => {
  await seed(page, { level: 1, category: 'work', order: 'sequential' });
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-guide').click();
  await expect(page.locator('#guide-screen')).toBeVisible();

  await page.locator('#btn-play').click();
  await expect(page.locator('#guide-screen')).toBeHidden();
  await expect(page.locator('#game-area')).toBeVisible();
});

// ── SAP-first framing ───────────────────────────────────────────────────────

test('the guide names the plan as the programme and sends silence to the BCBA', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  const text = await openGuide(page);

  expect(text).toContain('The Skill Acquisition Plan is the programme');
  expect(text).toContain('This app is the materials');
  expect(text).toContain('ask your BCBA');
  expect(text).toContain('It does not tell you which setting to choose');
});

test('the guide never tells a technician which setting to prefer', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  const text = (await openGuide(page)).toLowerCase();

  // Preference language. Any of these turns a translation layer into advice,
  // which is the BCBA's to give and not this file's.
  const banned = [
    'we recommend', 'we suggest', 'you should choose', 'you should set',
    'whichever you prefer', 'whatever works', 'up to you', 'best practice',
    'pick what works', 'if in doubt, choose', 'most technicians', 'try both',
    'find what works',
  ];
  for (const phrase of banned) expect(text).not.toContain(phrase);
});

test('there is no "what you are seeing → what to set" table', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  await openGuide(page);

  // Every table in the guide is keyed on what the PLAN says, on what a control
  // IS, or on what was recorded — never on what the technician is observing in
  // the learner, which is the shape that invites a clinical call.
  const headers = await page.locator('#guide-body .guide-table thead th').allTextContents();
  expect(headers.length).toBeGreaterThan(0);
  for (const h of headers) {
    expect(h.toLowerCase()).not.toMatch(/what (you'?re|you are|youre) seeing/);
    expect(h.toLowerCase()).not.toMatch(/^if you (see|notice|think)/);
  }
  expect(headers).toContain('If the SAP specifies…');
});

// ── The core table ──────────────────────────────────────────────────────────

test('the core table maps every protocol component the plan can specify', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  await openGuide(page);

  const rows = await page.locator('#guide-core .guide-table tbody tr').all();
  expect(rows.length).toBeGreaterThanOrEqual(12);

  const firstCells = [];
  for (const row of rows) {
    const cells = await row.locator('th, td').allTextContents();
    // If the SAP specifies… → set this → what it does on screen. Three columns,
    // and none of them empty: a row missing the third column is a row that
    // names a setting without saying what it does.
    expect(cells).toHaveLength(3);
    for (const c of cells) expect(squash(c).length).toBeGreaterThan(0);
    firstCells.push(squash(cells[0]).toLowerCase());
  }

  const required = [
    'least-to-most prompting',
    'most-to-least prompting',
    'constant time delay',
    'progressive time delay',
    'errorless teaching',
    'error correction with re-presentation',
    'suppressed error signal',
    'a generalization phase',
    'no generalization phase',
    'reinforcement schedule',
    'fixed position array',
    'counterbalanced positions',
    'rationale targets at level 3',
  ];
  for (const need of required) {
    expect(firstCells.some(c => c.includes(need)),
      `no core-table row for "${need}"`).toBe(true);
  }
});

test('every switch in the settings panel has a line in the guide', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-extra-toggle').click();
  await expect(page.locator('#extra-panel')).toBeVisible();

  // Read the labels off the live panel rather than listing them here, so a
  // control added later without a guide line fails this test instead of
  // shipping undocumented.
  const labels = await page.evaluate(() => {
    const seen = new Set();
    for (const node of document.querySelectorAll('#extra-panel label')) {
      const t = node.textContent.replace(/\?/g, '').replace(/\s+/g, ' ').trim();
      if (t) seen.add(t);
    }
    return Array.from(seen);
  });
  expect(labels.length).toBeGreaterThan(10);

  const text = (await openGuide(page)).toLowerCase();
  for (const label of labels) {
    expect(text.includes(label.toLowerCase()), `guide never mentions "${label}"`).toBe(true);
  }
});

// ── Level 3, and what this is not ───────────────────────────────────────────

test('the worked rationale examples use the app’s own three score labels', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  await openGuide(page);

  const labels = await page.evaluate(() => window.__thinkOrSay.rationaleLabels);
  const wanted = Object.values(labels);          // Correct / Partly correct / Not yet

  const tables = page.locator('#guide-rationale .guide-table');
  await expect(tables).toHaveCount(1);
  const scores = await tables.locator('tbody tr td:nth-child(2)').allTextContents();
  expect(scores.length).toBeGreaterThanOrEqual(4);
  for (const s of scores) expect(wanted).toContain(squash(s));
  // All three points are worked, not just the easy one.
  for (const w of wanted) expect(scores.map(squash)).toContain(w);

  const text = squash(await page.locator('#guide-rationale').textContent());
  expect(text).toContain('not on the example list');
  expect(text).toContain('must not contain a name');
});

test('the guide states what the app is not', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  await openGuide(page);

  const text = squash(await page.locator('#guide-not').textContent());
  expect(text).toContain('Not an assessment');
  expect(text).toContain('Not a substitute for the Skill Acquisition Plan');
  expect(text).toContain('Not a decision aid');
  expect(text).toContain('no account, no upload, no sync, no names');
});

// ── The screenshots ─────────────────────────────────────────────────────────

test('the guide shows real screenshots of the panel and the report', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  await openGuide(page);

  for (const src of ['guide-panel.png', 'guide-report.png']) {
    const img = page.locator(`#guide-body img[src="${src}"]`);
    await expect(img).toHaveCount(1);
    await expect(img).toHaveAttribute('alt', /\S/);
    // Actually decoded, not a broken reference that renders as alt text. The
    // figures are lazy, so they have to be on screen before that is a fair test.
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate(n => n.complete && n.naturalWidth > 0)).toBe(true);
    await expect(img.locator('xpath=../figcaption')).toHaveText(/\S/);
  }
});

// ── One source, two shipments ───────────────────────────────────────────────

test('the standalone file is a complete, self-contained HTML document', async ({ page }) => {
  await page.goto(URL);
  await booted(page);

  const html = await standalone(page);
  expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
  expect(html).toContain('<html lang="en">');
  expect(html).toContain('<meta charset="utf-8">');
  expect(html).toContain('Think or Say? - Staff Guide');
  // Its own stylesheet, because it has to survive as a file on a desktop with
  // no link back to this site.
  expect(html).toMatch(/<style>[\s\S]*guide-table[\s\S]*<\/style>/);
  expect(html).not.toContain('href="style.css"');
});

test('the standalone file embeds its screenshots rather than linking them', async ({ page }) => {
  await page.goto(URL);
  await booted(page);

  const html = await standalone(page);
  const srcs = Array.from(html.matchAll(/<img[^>]+src="([^"]*)"/g)).map(m => m[1]);
  expect(srcs.length).toBe(2);
  for (const src of srcs) expect(src.startsWith('data:image/png;base64,')).toBe(true);
  expect(html).not.toContain('Screenshot not embedded');
  expect(html).not.toContain('src="guide-panel.png"');
});

test('the in-game screen and the standalone file carry identical text', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  const onScreen = await openGuide(page);

  const inFile = await page.evaluate(async () => {
    const html = await window.ThinkOrSayGuide.renderStandalone();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.getElementById('guide-body').textContent;
  });

  // Character for character. Two renderings that merely agree on their headings
  // can still drift in the sentence that matters; these cannot drift at all,
  // because one buildBody() produced both.
  expect(squash(inFile)).toBe(onScreen);
  expect(onScreen.length).toBeGreaterThan(4000);
});

test('the download button saves the guide under its own filename', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-guide').click();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#btn-guide-download').click(),
  ]);
  expect(download.suggestedFilename()).toBe('think-or-say-staff-guide.html');

  const saved = await readFile(await download.path(), 'utf8');
  expect(saved.startsWith('<!DOCTYPE html>')).toBe(true);

  // The saved bytes carry the same guide, not a stub or an empty shell.
  const onScreen = squash(await page.locator('#guide-body').textContent());
  const inFile = await page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.getElementById('guide-body').textContent;
  }, saved);
  expect(squash(inFile)).toBe(onScreen);
});
