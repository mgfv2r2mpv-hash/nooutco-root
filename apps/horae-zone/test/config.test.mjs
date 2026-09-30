import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, SCHEMA } from './helpers.mjs';

const TOML = readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
const code = (text) => text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

// Ingress rules for a wrangler.toml text: workers.dev off and no route of any
// kind until the owner adds one at first deploy.
function ingressProblems(text) {
  const c = code(text);
  const problems = [];
  if (!/^workers_dev\s*=\s*false\s*$/m.test(c)) problems.push('workers_dev is not false');
  if (/^\s*(\[\[routes\]\]|routes\s*=|route\s*=)/m.test(c)) problems.push('a route is declared');
  if (/^\s*\[\[?env\./m.test(c)) problems.push('an environment is declared');
  return problems;
}

test('wrangler.toml keeps workers_dev off and declares no route', () => {
  assert.deepEqual(ingressProblems(TOML), []);
});

test('NEGATIVE CONTROL: a planted route line fails', () => {
  assert.deepEqual(ingressProblems(`${TOML}\nroute = "horae-zone.nooutco.me/*"\n`), ['a route is declared']);
  assert.deepEqual(ingressProblems(TOML.replace(/workers_dev\s*=\s*false/, 'workers_dev = true')), ['workers_dev is not false']);
});

test('wrangler.toml holds no secret value', () => {
  assert.doesNotMatch(code(TOML), /^\s*\[vars\]/m);
  assert.doesNotMatch(code(TOML), /(secret|token|key|pepper|password)\s*=/i);
});

test('schema.sql columns are content-free', () => {
  const columns = [...code(SCHEMA).matchAll(/^\s{2}(\w+)\s+(TEXT|INTEGER|BLOB)/gm)].map((m) => m[1]);
  assert.ok(columns.length > 0);
  for (const c of columns) assert.doesNotMatch(c, /body|email|code|seed|pin|password|note|name/i, c);
});
