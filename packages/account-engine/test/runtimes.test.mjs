// The engine is shared by a Node service, a browser page (the Sass canvas, the
// JanusMirror pairing shell) and a Cloudflare Worker (Horae Zone). Each run
// below loads the same files from src/ and must derive the same CPace
// generator and finish a full exchange.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probe } from '../src/probe.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const full = path.join(dir, n);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function engineFiles() {
  return [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'vendor', 'noble'))]
    .filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

const expected = probe();

test('the engine source needs nothing Node-only', () => {
  for (const file of engineFiles().filter((f) => f.includes(`${path.sep}src${path.sep}`))) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /from ['"]node:|require\(|\bBuffer\b|\bprocess\./, path.relative(ROOT, file));
  }
});

test('the engine\'s pake runs unchanged in Node', () => {
  assert.equal(expected.finished, true);
  assert.equal(expected.wrongRefused, true);
  assert.match(expected.generator, /^[0-9a-f]{64}$/);
  assert.deepEqual(probe(), expected);
});

test('the engine\'s pake runs unchanged in a browser', async (t) => {
  const { chromium } = require('playwright');
  const server = createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>probe</title>');
      return;
    }
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(404); res.end(); return; }
    try {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404); res.end();
    }
  });
  const port = await listen(server);
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); server.close(); });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const got = await page.evaluate(async () => (await import('/src/probe.mjs')).probe());
  assert.deepEqual(got, expected);
});

test('the engine\'s pake runs unchanged in a Worker', async (t) => {
  const workerd = require.resolve('workerd/bin/workerd');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'engine-workerd-'));
  const modules = engineFiles().map((f) => {
    const name = path.relative(ROOT, f).split(path.sep).join('/');
    return `(name = "${name}", esModule = embed "${path.relative(dir, f)}")`;
  });
  writeFileSync(path.join(dir, 'worker.mjs'), [
    "import { probe } from './src/probe.mjs';",
    'export default { fetch: () => Response.json(probe()) };',
  ].join('\n'));
  modules.unshift(`(name = "worker.mjs", esModule = embed "worker.mjs")`);
  // workerd resolves module names from the main module's folder, so it sits at the root.
  writeFileSync(path.join(dir, 'config.capnp'), `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [(name = "main", worker = .w)],
  sockets = [(name = "http", address = "127.0.0.1:0", http = (), service = "main")],
);
const w :Workerd.Worker = (
  modules = [${modules.join(',\n    ')}],
  compatibilityDate = "2026-09-01",
);
`);
  const port = await new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const child = spawn(workerd, ['serve', path.join(dir, 'config.capnp'), `--socket-addr=http=127.0.0.1:${port}`], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  t.after(() => { child.kill(); rmSync(dir, { recursive: true, force: true }); });
  let body = null;
  for (let i = 0; i < 100 && body === null; i += 1) {
    try {
      body = await (await fetch(`http://127.0.0.1:${port}/`)).json();
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(body, `workerd never answered: ${stderr.slice(0, 400)}`);
  assert.deepEqual(body, expected);
});
