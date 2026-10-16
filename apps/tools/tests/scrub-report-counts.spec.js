import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scrubReportCount } from '../_worker.js';

/* Ask 8, 16 Oct 2026: the scrub report stores counts only, never a name. */

test('a report counts for its count, or the length of a legacy list, capped at 50', () => {
  expect(scrubReportCount({ count: 3 })).toBe(3);
  expect(scrubReportCount({ terms: ['a', 'b'] })).toBe(2);
  expect(scrubReportCount({ count: 500 })).toBe(50);
  expect(scrubReportCount({ count: -4 })).toBe(0);
  expect(scrubReportCount({ count: 'x', terms: 'y' })).toBe(0);
  expect(scrubReportCount(null)).toBe(0);
});

test('the report route and the browser never carry or store a name', () => {
  const worker = readFileSync(join(__dirname, '..', '_worker.js'), 'utf8');
  const handler = worker.match(/async function handleScrubReport[\s\S]*?\n}\n/)[0];
  expect(handler).not.toMatch(/enqueueTerms|normalizeTerm|pii-pending/);
  const gate = readFileSync(join(__dirname, '..', 'assets', 'notes-gate.js'), 'utf8');
  expect(gate).toMatch(/JSON\.stringify\(\{ count: out\.length \}\)/);
});
