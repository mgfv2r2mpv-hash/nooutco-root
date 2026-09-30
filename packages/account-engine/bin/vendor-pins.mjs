// Checks a vendored folder against the sha256 record written when it was
// vendored. Returns the relative paths ("./x/y.js") that differ, are missing
// or are not recorded; an empty list means every file matches its pin.
// `only` limits the files on disk that are compared (the pins folder also
// holds its source note, which carries no pin).
import crypto from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full, base) : [`./${path.relative(base, full).split(path.sep).join('/')}`];
  });
}

export function vendorMismatches(dir, recordFile, { only = null } = {}) {
  const recorded = new Map(readFileSync(recordFile, 'utf8').trim().split('\n')
    .map((line) => { const [hash, file] = line.split(/\s+/); return [file, hash]; }));
  const onDisk = walk(dir).filter((f) => !only || only.test(f));
  const bad = new Set();
  for (const file of onDisk) {
    const hash = crypto.createHash('sha256').update(readFileSync(path.join(dir, file))).digest('hex');
    if (hash !== recorded.get(file)) bad.add(file);
  }
  for (const file of recorded.keys()) {
    if (!existsSync(path.join(dir, file))) bad.add(file);
  }
  return [...bad];
}
