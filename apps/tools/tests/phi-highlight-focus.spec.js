import { test, expect } from '@playwright/test';

// The PHI highlight overlay puts a yellow mark behind a detected name by
// wrapping each textarea in a positioned div and laying a mirror layer under
// it. Wrapping MOVES the textarea in the DOM, and moving a node blurs it.
//
// Nothing synchronises that move with the clinician. It runs on a timer after
// DOMContentLoaded and again after any login change, so it can land on a
// technician who is already typing - and before this was fixed it dropped their
// focus and their caret on the floor, and the rest of the sentence went to
// <body> instead of the note.
//
// It also made "place of service defaults to Home" flake under parallel load.
// Playwright's fill() is focus-then-insert, and a wrap landing between those
// two steps swallowed the text with no error: the field stayed empty, the
// engine never saw a change, and Clear never appeared.
//
// scrub-test.html is used deliberately: it loads notes-scrub.js WITHOUT React,
// Babel or Turnstile, so the overlay is tested on its own.

test.beforeEach(async ({ page }) => {
  await page.goto('/notes/scrub-test.html');
  // The page installs the overlay on its own timer. Wait for that to land, then
  // undo it, so each test decides exactly when the wrap happens.
  await page.waitForSelector('#live[data-phi-hl="1"]');
  await page.evaluate(() => {
    const ta = document.getElementById('live');
    const wrapper = ta.parentElement;
    wrapper.parentElement.insertBefore(ta, wrapper);
    wrapper.remove();
    delete ta.dataset.phiHl;
    ta.value = '';
  });
});

test.describe('the PHI highlight overlay installs under the clinician', () => {
  test('keeps the focus and the caret of a field being typed in', async ({ page }) => {
    const state = await page.evaluate(() => {
      const ta = document.getElementById('live');
      ta.value = 'session started at nine';
      ta.focus();
      ta.setSelectionRange(7, 15);
      window.NotesScrub.installPHIHighlight();
      return {
        wrapped: ta.dataset.phiHl === '1',
        focused: document.activeElement === ta,
        start: ta.selectionStart,
        end: ta.selectionEnd,
        value: ta.value,
      };
    });

    // The overlay did go on - this is not passing by doing nothing.
    expect(state.wrapped).toBe(true);
    expect(state.focused, 'the wrap blurred a field the clinician was typing in').toBe(true);
    expect([state.start, state.end], 'the wrap moved the caret').toEqual([7, 15]);
    expect(state.value).toBe('session started at nine');
  });

  test('the keystrokes that follow still reach the note', async ({ page }) => {
    // Arm the overlay to install the instant the field takes focus. That is the
    // window a fast typist and Playwright's fill() both sit in.
    await page.evaluate(() => {
      document.getElementById('live').addEventListener(
        'focus',
        () => window.NotesScrub.installPHIHighlight(),
        { once: true },
      );
    });

    await page.locator('#live').fill('arrived tired');

    await expect(page.locator('#live')).toHaveValue('arrived tired');
    expect(await page.evaluate(() => document.getElementById('live').dataset.phiHl)).toBe('1');
  });

  test('does not grab focus for a field nobody is in', async ({ page }) => {
    const active = await page.evaluate(() => {
      document.getElementById('live').blur();
      window.NotesScrub.installPHIHighlight();
      return document.activeElement === document.getElementById('live');
    });

    // Restoring focus is only ever restoring - the overlay must not pull the
    // clinician into a field they never clicked.
    expect(active).toBe(false);
  });
});
