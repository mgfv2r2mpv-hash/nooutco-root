import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// House rule, asked for repeatedly and across several tools: no em dashes and no
// en dashes, anywhere. Use a hyphen.
//
// This exists because asking was not making it stick. It covers strings a
// clinician reads, the prompts the model is told to imitate, and the comments
// and docs around them, because the habit is what has to go and a rule with
// exceptions is the habit with extra steps.
//
// It also happens to serve the detection goal: all seven human-written plans in
// the measured corpus used zero em dashes, and their overuse is a recognisable
// machine-writing tell.

// Playwright runs with apps/tools as the working directory (playwright.config.js
// lives there). import.meta is unavailable because this package is not ESM.
const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  'node_modules', '.wrangler', 'playwright-report', 'test-results', 'dist', 'build',
]);

// The generated copies under apps/tools/shared are synced from packages/shared;
// fixing them here would be undone by the next `npm run sync:shared`. They are
// covered because the canonical source is.
//
// apps/tools/vendor holds React, ReactDOM and Babel byte-for-byte as published.
// None of them carries a dash today, but this is a rule about how we write, and
// "go edit babel.min.js" is not an instruction anyone should ever be handed.
const SKIP_PATHS = [path.join(ROOT, 'shared'), path.join(ROOT, 'vendor')];

const EXTS = new Set(['.js', '.jsx', '.html', '.css', '.md', '.json', '.jsonc', '.sql', '.yml']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (SKIP_DIRS.has(entry)) continue;
    if (SKIP_PATHS.some((p) => full === p || full.startsWith(p + path.sep))) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(entry))) out.push(full);
  }
  return out;
}

// Written as escapes, never as literals. A repo-wide sweep replaced the two
// literal characters that used to sit here with a spaced hyphen, which left this
// spec testing whether any line contains " - " and failing on every file in the
// tree. A detector must not be destroyable by the thing it detects.
const EM_DASH = '\u2014';
const EN_DASH = '\u2013';

test('no em dashes or en dashes anywhere in apps/tools', () => {
  const offenders = [];

  for (const file of walk(ROOT)) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (line.includes(EM_DASH) || line.includes(EN_DASH)) {
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 90)}`);
      }
    });
  }

  expect(
    offenders,
    `Use a hyphen instead. Found ${offenders.length} em/en dash(es):\n` + offenders.join('\n'),
  ).toEqual([]);
});
