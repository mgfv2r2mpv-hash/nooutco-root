import { test, expect } from '@playwright/test';

/* The assistant's empty state greeted every tool with "Fill in your session
 * notes and press Generate Note", which is wrong on three of the five. A SAP is
 * a program plan, not a session, and its button says Generate SAP, so the panel
 * was describing a different tool than the one on screen. The maintainer caught
 * it while testing SAP output and read it, correctly, as the assistant not
 * knowing where it was. */

const PAGES = [
  { tool: 'sap', path: '/notes/bcba/index.html?tool=sap', says: /treatment goal and any SAP specifications/i, button: 'Generate SAP' },
  { tool: 'sup', path: '/notes/bcba/index.html?tool=sup', says: /clinical observations and staff feedback/i, button: 'Generate Note' },
  { tool: 'assess', path: '/notes/bcba/index.html?tool=assess', says: /assessment/i, button: 'Generate Note' },
  { tool: 'parent', path: '/notes/bcba/index.html?tool=parent', says: /session notes/i, button: 'Generate Note' },
  { tool: 'bt', path: '/notes/bt/index.html', says: /session notes/i, button: 'Generate Note' },
];

for (const { tool, path, says, button } of PAGES) {
  test(`${tool} greets with its own inputs and its own button`, async ({ page }) => {
    await page.goto(path);
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    const intro = await page.evaluate((id) => {
      const t = window.NOTE_TOOLS.find((x) => x.id === id);
      return { intro: t.assistantIntro || '', genLabel: t.genLabel };
    }, tool);

    expect(intro.intro, `${tool} declares no assistantIntro`).toBeTruthy();
    expect(intro.intro).toMatch(says);
    // The greeting must name the button the page actually shows.
    expect(intro.intro, `${tool} greeting names the wrong button`).toContain(button);
  });
}

test('SAP is never described as a session note', async ({ page }) => {
  await page.goto('/notes/bcba/index.html?tool=sap');
  await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

  const intro = await page.evaluate(() =>
    window.NOTE_TOOLS.find((t) => t.id === 'sap').assistantIntro);

  // The exact wording that was showing on the SAP page before this fix.
  expect(intro).not.toMatch(/session notes/i);
  expect(intro).not.toMatch(/Generate Note\b/);
});
