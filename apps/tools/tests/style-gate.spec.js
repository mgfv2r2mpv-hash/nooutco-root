import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* scripts/style-gate.mjs is the CI style gate from issue #86. These are pure
 * Node assertions with no page under test: they pin the thresholds, prove each
 * check fails when it should, and prove the committed fixture set passes.
 *
 * style-gate.mjs is ESM and this spec is transpiled to CJS, so it loads through
 * a dynamic import, the same way sap-detector-calibration.spec.js does. */

let gate;
test.beforeAll(async () => {
  gate = await import(pathToFileURL(join(__dirname, '../scripts/style-gate.mjs')).href);
});

const fixture = (n) => readFileSync(join(__dirname, 'fixtures/notes', n), 'utf8');

test.describe('style gate (issue #86)', () => {
  test('the committed fixtures pass the gate', () => {
    const { rows, problems } = gate.runGate();
    expect(problems).toEqual([]);
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  test('the thresholds sit between human writing and the formulaic pole', () => {
    // 38 is the highest human document measured; 48 is the lower pole fixture.
    expect(gate.CEILING).toBeGreaterThan(38);
    expect(gate.CEILING).toBeLessThan(48);
    // The spread of the five QuillBot-scored human plans.
    expect(gate.DRIFT_POINTS).toBe(8);
  });

  test('a draft that collapses to the pole fails on the ceiling', () => {
    const total = gate.scoreText(fixture('old-terminology-a.txt'));
    const problems = gate.checkFixture('collapsed.txt', total, { role: 'draft', score: total });
    expect(problems.join('\n')).toMatch(/over the ceiling of 40/);
  });

  test('the same text recorded as a pole passes', () => {
    const total = gate.scoreText(fixture('old-terminology-a.txt'));
    expect(gate.checkFixture('pole.txt', total, { role: 'pole', score: total })).toEqual([]);
  });

  test('a move past the drift limit fails in either direction', () => {
    const up = gate.checkFixture('d.txt', 20, { role: 'draft', score: 11 });
    const down = gate.checkFixture('p.txt', 39, { role: 'pole', score: 48 });
    expect(up.join('\n')).toMatch(/moved \+9 \(limit 8\)/);
    expect(down.join('\n')).toMatch(/moved -9 \(limit 8\)/);
  });

  test('a move inside the drift limit passes', () => {
    expect(gate.checkFixture('d.txt', 18, { role: 'draft', score: 10 })).toEqual([]);
  });

  test('a fixture with no baseline entry fails and says how to fix it', () => {
    const problems = gate.checkFixture('live/new.txt', 12, undefined);
    expect(problems.join('\n')).toMatch(/no entry in style-baseline\.json.*score 12/);
  });

  test('an unknown role fails', () => {
    expect(gate.checkFixture('x.txt', 10, { role: 'sample', score: 10 }).length).toBe(1);
  });

  test('a baseline entry whose file is gone fails', () => {
    const base = JSON.parse(fixture('style-baseline.json'));
    const baseline = { fixtures: { ...base.fixtures, 'gone.txt': { role: 'draft', score: 10 } } };
    const { problems } = gate.runGate({ baseline });
    expect(problems.join('\n')).toMatch(/gone\.txt: listed in style-baseline\.json but the file is gone/);
  });
});
