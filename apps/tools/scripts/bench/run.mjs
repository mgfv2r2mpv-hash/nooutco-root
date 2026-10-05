#!/usr/bin/env node
/* THE NOTE BENCH, LIVE.
 *
 * Drafts every case in scripts/bench/cases/<tool>.json on the live tool, the
 * way a user does (scripts/bench/lib/drive.mjs), checks each note
 * (scripts/bench/lib/checks.mjs), and prints a scoreboard: checks passed, words
 * a user typed, question rounds and seconds per case. Kaleb's goal, 2026-10-04:
 * submission-worthy notes from 100 to 125 typed words and 5 to 7 minutes.
 *
 * IT COSTS DRAFTS, so it runs only with --yes, and only with his approval of
 * the bench login. Each case is one to a few model calls on the live site.
 *
 * THE LOGIN. A session lasts 30 days, and login can need a Turnstile check a
 * script cannot pass, so the bench keeps its own browser profile
 * (~/.note-bench/profile, mode 700). Once a month:
 *
 *   node scripts/bench/run.mjs --login
 *
 * opens a window on the live site; log in there with the bench code and close
 * it. Every run after that reuses the session, headless. No token is copied
 * anywhere.
 *
 *   node scripts/bench/run.mjs --tool parent --yes
 *   node scripts/bench/run.mjs --tool all --yes
 *
 * Results go to ~/.note-bench/runs/ as JSON. Every case is invented, so the
 * results hold no client data. */
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runCase } from './lib/drive.mjs';
import { checkNote } from './lib/checks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true);
};
const BASE = arg('--base', 'https://tools.nooutco.me');
const HOME = path.join(homedir(), '.note-bench');
const PROFILE = arg('--profile', path.join(HOME, 'profile'));
const TOOLS = ['parent', 'bt', 'sup', 'assess', 'sap'];

function casesFor(tool) {
  const file = path.join(HERE, 'cases', `${tool}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).cases : [];
}

async function login() {
  mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, baseURL: BASE });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('/notes/parent/');
  console.log('Log in with the bench code in the window, then close it.');
  await new Promise((resolve) => ctx.on('close', resolve));
}

async function run(tools) {
  if (!existsSync(PROFILE)) {
    console.error('No bench session yet: run with --login first.');
    process.exit(2);
  }
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, baseURL: BASE });
  const page = ctx.pages()[0] || await ctx.newPage();
  const results = [];
  for (const tool of tools) {
    for (const c of casesFor(tool)) {
      try {
        const out = await runCase(page, c);
        const fails = checkNote(c, out.note);
        results.push({ tool, ...out, fails, pass: fails.length === 0 });
        console.log(`${fails.length ? 'FAIL' : 'pass'}  ${tool}/${c.id}  typed ${out.typed.total}  rounds ${new Set(out.asked.map((a) => a.round)).size}  ${out.seconds}s${fails.length ? `\n      ${fails.join('\n      ')}` : ''}`);
      } catch (err) {
        results.push({ tool, id: c.id, error: String(err && err.message || err).split('\n')[0], pass: false });
        console.log(`ERROR ${tool}/${c.id}  ${String(err && err.message || err).split('\n')[0]}`);
      }
    }
  }
  await ctx.close();

  const done = results.filter((r) => !r.error);
  const avg = (f) => (done.length ? Math.round(done.reduce((n, r) => n + f(r), 0) / done.length) : 0);
  console.log(`\n${results.filter((r) => r.pass).length} of ${results.length} cases pass every check`);
  console.log(`average typed ${avg((r) => r.typed.total)} words, ${avg((r) => r.seconds)} seconds per case`);
  mkdirSync(path.join(HOME, 'runs'), { recursive: true, mode: 0o700 });
  const file = path.join(HOME, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${tools.join('+')}.json`);
  writeFileSync(file, JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
  console.log(`results: ${file}`);
}

if (process.argv.includes('--login')) {
  await login();
} else {
  const tool = arg('--tool', 'parent');
  const tools = tool === 'all' ? TOOLS : [tool];
  const count = tools.reduce((n, t) => n + casesFor(t).length, 0);
  if (!process.argv.includes('--yes')) {
    console.log(`Would draft ${count} case(s) on ${BASE}: ${tools.join(', ')}. This costs model calls. Add --yes to run.`);
    process.exit(0);
  }
  await run(tools);
}
