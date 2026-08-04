import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GAMES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * No game plays a completion chime.
 *
 * Removed on the maintainer's instruction. A tone that fires on every goal, in
 * a room where sessions run back to back, stops being a reinforcer and becomes
 * something staff and learners endure - and an unexpected sound is its own
 * problem for a learner who is sound-sensitive.
 *
 * Two tests, because the two ways this comes back are different. The runtime
 * one proves the shared path is silent; the source scan catches a game growing
 * its *own* oscillator again, which is exactly how famous-person came to have a
 * second copy of the same three notes that silencing reward.js would have
 * missed entirely.
 */

test.describe('no game plays a completion chime', () => {
  test('the shared reward module starts no audio on goal or on SR end', async ({ page }) => {
    await page.addInitScript(() => {
      window.__audioStarts = [];
      // Trip on the act of building an audio graph at all, not on one API: any
      // route to sound has to go through a context and an oscillator.
      for (const key of ['AudioContext', 'webkitAudioContext']) {
        const Real = window[key];
        if (!Real) continue;
        const Wrapped = function (...args) {
          const ctx = new Real(...args);
          const realOsc = ctx.createOscillator.bind(ctx);
          ctx.createOscillator = function () {
            window.__audioStarts.push('oscillator');
            return realOsc();
          };
          return ctx;
        };
        Object.defineProperty(window, key, { value: Wrapped, configurable: true, writable: true });
      }
    });

    await page.goto('/clock/');
    await page.waitForLoadState('networkidle');

    const api = await page.evaluate(() => !!window.NooutcoReward);
    expect(api, 'the shared reward module is loaded on this page').toBe(true);

    await page.evaluate(() => {
      window.NooutcoReward.playChime();
      window.NooutcoReward.celebrate(document.body);
    });
    // Give any scheduled audio a moment to have been created.
    await page.waitForTimeout(400);

    const starts = await page.evaluate(() => window.__audioStarts.slice());
    expect(starts, 'goal and SR end make no sound').toEqual([]);
  });

  test('no game carries its own oscillator for a completion sound', () => {
    // famous-person had a duplicate of the shared chime inline in its HTML, so
    // scanning only the shared module would have declared success while one
    // game kept chiming. Scan every game's own source instead.
    const offenders = [];
    const skip = new Set(['node_modules', 'test-results', 'playwright-report', '_Resources', 'tests', '.wrangler']);

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(js|html)$/.test(entry.name)) continue;
        const body = fs.readFileSync(full, 'utf8');
        if (/createOscillator\s*\(/.test(body)) {
          offenders.push(path.relative(GAMES_ROOT, full));
        }
      }
    };
    walk(GAMES_ROOT);

    expect(offenders, 'a game grew its own tone generator again').toEqual([]);
  });
});
