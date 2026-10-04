import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/* LOWERCASE NAMES ARE CAUGHT.
 *
 * Kaleb's ruling on his Masking Quality review, 2026-10-04: a lowercase word
 * the English list does not know is flagged like any name, and masked until
 * he excuses it ("not a name" after the draft). The list is SCOWL at size 50
 * plus the tool's own words. The PHI census showed two lowercase names with
 * nothing before them ("kaelen", "tavion") reaching the model in the clear.
 *
 * The other side matters as much: ordinary note prose, typed lowercase, with
 * contractions, possessives and ABA terms, must flag nothing. Every name and
 * word below is invented. */

const ROOT = process.cwd();
const url = (rel) => 'file://' + path.join(ROOT, rel);

let gateLib;
let gate;
test.beforeAll(async () => {
  gateLib = await import(url('scripts/lib/gate-context.mjs'));
  gate = gateLib.loadGateFromFile(path.join(ROOT, 'assets/notes-gate.js'), 'working tree');
});

test.describe('the lowercase pass', () => {
  test('the English list is loaded beside the scrubber', () => {
    expect(gate.raw.hasEnglishWords()).toBe(true);
  });

  test('uncommon names typed in lowercase with nothing before them are caught', () => {
    const found = gate.detectNames('mom said kaelen and tavion played outside before session');
    expect(found).toEqual(expect.arrayContaining(['kaelen', 'tavion']));
  });

  const ORDINARY = [
    "client didn't want the ipad, so the bt used a first-then board and he complied",
    'bt ran dtt, manding for breaks at 80%, eloped twice, blocked and redirected',
    "caregiver texted the bcba about the toileting schedule; client's data looked good",
    'used gestural prompts on the tacting targets, then faded to independent',
    'reviewed the youtube video with the caregiver and emailed the visual schedule',
    "they're working on waiting; we'll probe again next week and he can't skip it",
  ];
  for (const line of ORDINARY) {
    test(`ordinary note prose flags nothing: ${line.slice(0, 40)}…`, () => {
      expect(gate.detectNames(line)).toEqual([]);
    });
  }

  test("none of the tool's own words is a first name", () => {
    const words = gate.raw.lowerOkWords();
    expect(words.length).toBeGreaterThan(0);
    expect(words.filter((w) => gate.isFirstName(w))).toEqual([]);
  });

  test('without the word list the pass is off, as before it existed', () => {
    const bare = gateLib.loadGateSource(readFileSync(path.join(ROOT, 'assets/notes-gate.js'), 'utf8'), 'no list');
    expect(bare.raw.hasEnglishWords()).toBe(false);
    expect(bare.detectNames('mom said kaelen and tavion played outside')).toEqual([]);
  });

  test('the committed word list is what the builder writes', () => {
    const run = spawnSync(process.execPath, ['scripts/build-english-words.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });
});

test.describe('on the page', () => {
  for (const page$ of ['/notes/bt/', '/notes/bcba/']) {
    test(`${page$} loads the list before the scrubber, and an excused word stays excused`, async ({ page }) => {
      await page.goto(page$);
      const out = await page.evaluate(() => {
        const s = window.NotesGate._scrub;
        const before = s.detectNames('mom said kaelen came along');
        window.NotesGate.nonPii.saveTerm('kaelen');
        const after = s.detectNames('mom said kaelen came along');
        return { loaded: s.hasEnglishWords(), before, after };
      });
      expect(out.loaded).toBe(true);
      expect(out.before).toContain('kaelen');
      expect(out.after).not.toContain('kaelen');
    });
  }
});
