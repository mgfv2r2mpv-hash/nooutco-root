import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendorMismatches } from '../bin/vendor-pins.mjs';

const VENDOR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor');

test('the vendored noble files match the hashes recorded when they were vendored', () => {
  assert.deepEqual(vendorMismatches(path.join(VENDOR, 'noble'), path.join(VENDOR, 'noble.sha256')), []);
});

test('NEGATIVE CONTROL: a vendored file that differs from its pin fails', (t) => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'engine-vendor-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  cpSync(path.join(VENDOR, 'noble'), path.join(tmp, 'noble'), { recursive: true });
  appendFileSync(path.join(tmp, 'noble', 'hashes', 'sha2.js'), '\n// changed\n');
  writeFileSync(path.join(tmp, 'noble', 'hashes', 'extra.js'), 'export {};\n');
  const found = vendorMismatches(path.join(tmp, 'noble'), path.join(VENDOR, 'noble.sha256'));
  assert.deepEqual(found.sort(), ['./hashes/extra.js', './hashes/sha2.js']);
});

test('NEGATIVE CONTROL: a pinned file that is missing fails', (t) => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'engine-vendor-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  cpSync(path.join(VENDOR, 'noble'), path.join(tmp, 'noble'), { recursive: true });
  rmSync(path.join(tmp, 'noble', 'hashes', 'hmac.js'));
  assert.deepEqual(vendorMismatches(path.join(tmp, 'noble'), path.join(VENDOR, 'noble.sha256')), ['./hashes/hmac.js']);
});
