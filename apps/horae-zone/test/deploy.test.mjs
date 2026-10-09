// The deploy script (bin/deploy.mjs, plan §4) against a mocked wrangler: no
// test calls Cloudflare, sends mail or writes outside a temp folder. Every
// secret value is a fixed fake, and each test checks it never reaches the
// output, a command line, a child's environment or a written file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, SCHEMA } from './helpers.mjs';
import { deploy, runWrangler } from '../bin/deploy.mjs';
import { declaredColumns, columnDefinitions, planTable, tableStatements } from '../bin/deploy-columns.mjs';
import { CATALOG, LineReader, deployConfig, scrub, schemaTables, HOSTNAME } from '../bin/deploy-parts.mjs';
import { accountKeys } from '../src/account-keys.js';
import { seedBoxKey } from '../src/otp.js';
import { reopenBaseOk } from '../src/unlock.js';

const FAKE_DB_ID = '11111111-2222-3333-4444-555555555555';
const FAKE_ACCOUNT = { id: 'acc0000000000000000000000000fake', name: 'Example Test Account' };
// 32 fixed bytes stand in for crypto randomness, so each generated key is
// known: the first draw is the account key, the second the seed sealing key.
const FIXED_BYTES = Buffer.alloc(32, 0x5a);
const GENERATED = FIXED_BYTES.toString('base64url');
const FIXED_SEED_BYTES = Buffer.alloc(32, 0x3c);
const GENERATED_SEED = FIXED_SEED_BYTES.toString('base64url');
const ANSWERS = {
  RESEND_KEY: 're_FAKE_resend_key_7d1c',
  HZ_MAIL_FROM: 'Horae Zone <mail@example.test>',
  HZ_ALERT_TO: 'alerts@example.test',
  HZ_LINK_BASE: 'https://example.test/signup',
  HZ_REOPEN_BASE: 'https://example.test/reopen',
  HZ_RESET_BASE: 'https://example.test/pin-reset',
  // Obviously fake production-shaped keys: 0x, then letters no widget has.
  HZ_TURNSTILE_SITEKEY: '0xFAKEsitekeyFORtests00',
  HZ_TURNSTILE_SECRET: '0xFAKEturnstileSECRETforTESTS0000000',
  HZ_CODES_PER_DAY: '',
};
// A fixed ticket key, made here with WebCrypto (not by the script), so a run
// that uses it has a known value to look for.
const FIXED_TICKET_PAIR = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const FIXED_TICKET_JWK = await crypto.subtle.exportKey('jwk', FIXED_TICKET_PAIR.privateKey);
const FIXED_TICKET_KEY = JSON.stringify({ kty: FIXED_TICKET_JWK.kty, crv: FIXED_TICKET_JWK.crv, x: FIXED_TICKET_JWK.x, y: FIXED_TICKET_JWK.y, d: FIXED_TICKET_JWK.d });
const SECRET_VALUES = [GENERATED, GENERATED_SEED, ANSWERS.RESEND_KEY, ANSWERS.HZ_MAIL_FROM, ANSWERS.HZ_ALERT_TO, ANSWERS.HZ_TURNSTILE_SECRET, FIXED_TICKET_KEY, FIXED_TICKET_JWK.d];
// The tables schema.sql creates, read the way the script reads them, so a new
// table never needs this file changed.
const TABLES = schemaTables(SCHEMA);
const SECRET_NAMES = ['HZ_ACCOUNT_KEY', 'HZ_SEED_KEY', 'HZ_TICKET_KEY', 'RESEND_KEY', 'HZ_MAIL_FROM', 'HZ_ALERT_TO', 'HZ_LINK_BASE', 'HZ_REOPEN_BASE', 'HZ_RESET_BASE', 'HZ_TURNSTILE_SECRET'];

// A wrangler stand-in. `state` decides what each command answers; every call
// is recorded with its args, stdin, cwd and env.
// The remote database is real SQLite (D1 is SQLite), made from
// `state.existingSchema` (schema.sql by default): applying schema.sql runs it
// for real, so CREATE TABLE IF NOT EXISTS leaves an existing table as it was,
// and every PRAGMA table_info and ALTER TABLE the script sends runs on it.
function mockWrangler(state = {}) {
  const calls = [];
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(state.existingSchema ?? SCHEMA);
  const db = { present: state.dbPresent ?? false };
  const secretsSet = new Set(state.existingSecrets ?? []);
  // As wrangler 4 does: a Worker that was never deployed has no secret list.
  let deployed = state.workerExists ?? secretsSet.size > 0;
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  // Step 6's Horae Zone tables: `hzAccounts` are account rows {id,
  // created_at, devices}, `admins` the account ids holding the admin role.
  // The grant follows its SQL's own guard: only an account in the list, and
  // only while no admin is set; `grantNoRow` makes it answer no row anyway.
  const admins = new Set(state.admins ?? []);
  const hzAccounts = state.hzAccounts ?? [];
  const rows = (results) => ok(JSON.stringify([{ results, success: true, meta: {} }]));
  function roleCommand(sql) {
    if (/^SELECT COUNT\(\*\) AS admins FROM role/.test(sql)) return rows([{ admins: admins.size }]);
    if (/^SELECT a\.id, a\.created_at/.test(sql)) return rows(hzAccounts);
    if (/^INSERT INTO role/.test(sql)) {
      const id = sql.match(/WHERE id = '([^']*)'/)?.[1];
      if (state.grantNoRow || admins.size > 0 || !hzAccounts.some((a) => a.id === id)) return rows([]);
      admins.add(id);
      return rows([{ account_id: id }]);
    }
    return { code: 1, stdout: '', stderr: `mock: unknown role command ${sql}` };
  }
  // SQL run on the database as D1 would run it: an SQLite error is a failed
  // wrangler call carrying SQLite's own words, as wrangler 4 prints them.
  function onDatabase(sql) {
    try {
      if (/^PRAGMA table_info\(\w+\)$/.test(sql)) return rows(sqlite.prepare(sql).all());
      sqlite.exec(sql);
      return rows([]);
    } catch (err) {
      return { code: 1, stdout: '', stderr: `✘ [ERROR] ${err.message}` };
    }
  }
  function columnCommand(sql) {
    if (/^ALTER TABLE/.test(sql) && state.alterFail) return { code: 1, stdout: '', stderr: state.alterFail };
    if (/^ALTER TABLE/.test(sql) && state.alterOut) return ok(state.alterOut);
    return onDatabase(sql);
  }
  async function run(args, opts = {}) {
    calls.push({ args, input: opts.input, cwd: opts.cwd, env: opts.env });
    const cmd = args.slice(0, 2).join(' ');
    // Not a TTY, so wrangler 4 prints the bare version number.
    if (cmd === '--version') return state.versionFail ? { code: 127, stdout: '', stderr: state.versionFail } : ok('4.104.0\n');
    if (cmd === 'whoami --json') return ok(JSON.stringify({ loggedIn: true, email: 'owner@example.test', accounts: state.accounts ?? [FAKE_ACCOUNT] }));
    if (cmd === 'd1 list') return ok(JSON.stringify(db.present ? [{ uuid: FAKE_DB_ID, name: 'horae-zone' }, { uuid: 'x', name: 'other' }] : [{ uuid: 'x', name: 'other' }]));
    if (cmd === 'd1 create') { db.present = true; return ok(`database_id = "${FAKE_DB_ID}"`); }
    if (cmd === 'd1 execute' && args.includes('--file')) {
      const applied = onDatabase(SCHEMA);
      return applied.code === 0 ? ok('[{"success":true}]') : applied;
    }
    if (cmd === 'd1 execute' && /^CREATE TABLE\b/.test(args[args.indexOf('--command') + 1] ?? '')) return onDatabase(args[args.indexOf('--command') + 1]);
    if (cmd === 'd1 execute' && /^(PRAGMA table_info|ALTER TABLE)\b/.test(args[args.indexOf('--command') + 1] ?? '')) return columnCommand(args[args.indexOf('--command') + 1]);
    if (cmd === 'd1 execute' && !/sqlite_master/.test(args[args.indexOf('--command') + 1] ?? '')) return roleCommand(args[args.indexOf('--command') + 1]);
    if (cmd === 'd1 execute') return ok(JSON.stringify([{ results: (state.tables ?? TABLES).map((name) => ({ name })), success: true }]));
    if (cmd === 'deploy --config') deployed = true;
    if (cmd === 'deploy --config') return ok(state.deployOut ?? `Uploaded horae-zone\nDeployed horae-zone triggers\n  ${HOSTNAME} (custom domain)\n  schedule: 0 * * * *\nCurrent Version ID: v1`);
    if (cmd === 'deployments list' && state.deploymentsFail) return { code: 1, stdout: '', stderr: state.deploymentsFail };
    if (cmd === 'deployments list' && state.deploymentsOut !== undefined) return ok(state.deploymentsOut);
    // wrangler 4 on a Worker the account does not have: the API's code 10007.
    if (cmd === 'deployments list' && !deployed) return { code: 1, stdout: '', stderr: `✘ [ERROR] A request to the Cloudflare API (/accounts/${FAKE_ACCOUNT.id}/workers/scripts/horae-zone/deployments) failed.\n\n  This Worker does not exist on your account. [code: 10007]` };
    if (cmd === 'deployments list') return ok(JSON.stringify([{ id: 'dep-1', source: 'wrangler', strategy: 'percentage', created_on: '2026-10-01T00:00:00Z', versions: [{ version_id: 'v1', percentage: 100 }] }]));
    if (cmd === 'secret put') { secretsSet.add(args[2]); return ok(`Success! Uploaded secret ${args[2]}`); }
    if (cmd === 'secret list' && state.secretListFail) return { code: 1, stdout: '', stderr: state.secretListFail };
    if (cmd === 'secret list' && !deployed) return { code: 1, stdout: '', stderr: '✘ [ERROR] Worker "horae-zone" not found.\n\nIf this is a new Worker, run `wrangler deploy` first to create it.' };
    if (cmd === 'secret list') return ok(state.secretListOut ?? JSON.stringify([...secretsSet].filter((n) => n !== state.dropSecret).map((name) => ({ name, type: 'secret_text' }))));
    return { code: 1, stdout: '', stderr: `mock: unknown command ${args.join(' ')}` };
  }
  return { run, calls, admins, sqlite };
}

// route: one answer for every fetch, or a list answered in order (the last
// repeats). recheck: the answers to "re-check the route now?", in order.
function harness({ wrangler = mockWrangler(), argv = [], answers = ANSWERS, confirm = 'y', edge = 'y', replaceKey, replaceTicketKey, replaceWorker = 'y', ticketKey = FIXED_TICKET_KEY, randomBytes, route = { status: 405, body: '{"error":"method"}', ray: true }, recheck, pick, confirmOwner = 'y' } = {}) {
  const lines = [];
  const draws = [FIXED_BYTES, FIXED_SEED_BYTES];
  const files = new Map();
  const fetched = [];
  const asked = [];
  const routes = Array.isArray(route) ? [...route] : [route];
  const rechecks = recheck === undefined ? undefined : [...recheck];
  const ask = async ({ question, hidden, name }) => {
    asked.push({ question, hidden, name });
    if (name === 'confirm-account') return confirm;
    if (name === 'confirm-edge') return edge;
    if (name === 'confirm-recheck-route' && rechecks?.length) return rechecks.shift();
    if (name === 'confirm-replace-key' && replaceKey !== undefined) return replaceKey;
    if (name === 'confirm-replace-ticket-key' && replaceTicketKey !== undefined) return replaceTicketKey;
    if (name === 'confirm-replace-worker') return replaceWorker;
    if (name === 'pick-owner-account' && pick !== undefined) return pick;
    if (name === 'confirm-owner-account') return confirmOwner;
    if (name in answers) return answers[name];
    throw new Error(`unexpected prompt ${name}`);
  };
  const deps = {
    argv,
    root: ROOT,
    run: wrangler.run,
    ask,
    write: (text) => lines.push(text),
    randomBytes: randomBytes ?? ((n) => {
      assert.equal(n, 32);
      assert.ok(draws.length > 0, 'two random draws: the account key, then the seed key');
      return Buffer.from(draws.shift());
    }),
    writeFile: (file, text) => files.set(file, text),
    makeTempDir: () => '/tmp/hz-deploy-test-empty',
    removeDir: () => {},
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      fetched.push({ url, init });
      const answer = routes.length > 1 ? routes.shift() : routes[0];
      return new Response(answer.body, { status: answer.status, headers: { ...(answer.ray ? { 'cf-ray': 'abc-EWR' } : {}), ...(answer.headers ?? {}) } });
    },
  };
  // ticketKey null leaves the script's own WebCrypto generator in place.
  if (ticketKey !== null) deps.generateTicketKey = async () => ticketKey;
  return { deps, lines, files, fetched, asked, wrangler, output: () => lines.join('\n') };
}

function assertNoSecretAnywhere(h) {
  const out = h.output();
  // The ticket key a run put (its own generated one included) and its private part.
  const ticket = h.wrangler.calls.find((c) => c.args[0] === 'secret' && c.args[2] === 'HZ_TICKET_KEY')?.input;
  const extra = ticket ? [ticket, JSON.parse(ticket).d] : [];
  for (const v of [...SECRET_VALUES, ...extra]) {
    assert.equal(out.includes(v), false, `output carries a secret value`);
    for (const c of h.wrangler.calls) {
      assert.equal(c.args.join(' ').includes(v), false, `argv of ${c.args.slice(0, 2).join(' ')} carries a secret value`);
      assert.equal(JSON.stringify(c.env ?? {}).includes(v), false, 'a child env carries a secret value');
    }
    for (const [file, text] of h.files) assert.equal(text.includes(v), false, `${file} carries a secret value`);
  }
}

const statusOf = (result, prefix) => result.checklist.find((i) => i.item.startsWith(prefix))?.status;

test('dry run prints every step and command, masks secrets and touches nothing', async () => {
  const forbidden = (what) => () => { throw new Error(`dry run called ${what}`); };
  const lines = [];
  const result = await deploy({
    argv: ['--dry-run'], root: ROOT, write: (t) => lines.push(t),
    run: forbidden('wrangler'), ask: forbidden('a prompt'), fetchImpl: forbidden('fetch'),
    writeFile: forbidden('writeFile'), makeTempDir: forbidden('makeTempDir'), removeDir: forbidden('removeDir'),
    randomBytes: forbidden('randomBytes'), sleep: forbidden('sleep'),
  });
  const out = lines.join('\n');
  assert.equal(result.dryRun, true);
  assert.match(out, /DRY RUN/);
  assert.match(out, /WRANGLER_LOG_SANITIZE=true/);
  for (const cmd of ['wrangler --version', 'wrangler whoami --json', 'wrangler deployments list --name horae-zone --json', 'wrangler d1 list --json', 'wrangler d1 create horae-zone',
    'wrangler d1 execute horae-zone --remote --yes --file schema.sql --config wrangler.deploy.toml',
    'wrangler deploy --config wrangler.deploy.toml', 'wrangler secret list --format json --config wrangler.deploy.toml']) {
    assert.ok(out.includes(cmd), `dry run lists: ${cmd}`);
  }
  for (const name of SECRET_NAMES) assert.match(out, new RegExp(`wrangler secret put ${name} --config wrangler\\.deploy\\.toml\\s+< stdin: \\[masked\\]`));
  assert.match(out, /GET https:\/\/horae-zone\.nooutco\.me\/account/);
  assert.match(out, /WAF|rate limiting rule/i);
  assert.match(out, /A5c/);
  assert.match(out, /generate: HZ_TICKET_KEY = \[masked\] \(ECDSA P-256 private key, JWK\)/);
  assert.match(out, /generate: HZ_SEED_KEY = \[masked\] \(32 random bytes, base64url\)/);
  assert.match(out, /--new-ticket-key/);
});

test('the dry run shows each A5 step from the catalog and schema.sql, with every value masked and no key generated', async () => {
  const forbidden = (what) => () => { throw new Error(`dry run called ${what}`); };
  const lines = [];
  await deploy({
    argv: ['--dry-run'], root: ROOT, write: (t) => lines.push(t),
    run: forbidden('wrangler'), ask: forbidden('a prompt'), fetchImpl: forbidden('fetch'),
    writeFile: forbidden('writeFile'), makeTempDir: forbidden('makeTempDir'), removeDir: forbidden('removeDir'),
    randomBytes: forbidden('randomBytes'), generateTicketKey: forbidden('generateTicketKey'), sleep: forbidden('sleep'),
  });
  const out = lines.join('\n');
  const step = (n) => out.slice(out.indexOf(`Step ${n}.`), out.indexOf(`Step ${n + 1}.`) === -1 ? undefined : out.indexOf(`Step ${n + 1}.`));
  // Each asked value shows its prompt and the rule its check applies, so the reopen base reads as https, no ? and no #.
  for (const s of CATALOG.filter((c) => c.source === 'asked')) {
    const line = lines.find((l) => l.includes(`-> ${s.name}`));
    assert.ok(line && step(2).includes(line), `Step 2 prompts for ${s.name}`);
    assert.equal(line.includes('(hidden)'), Boolean(s.hidden), `${s.name} hidden only when the catalog says so`);
    assert.ok(line.includes(`checked: ${s.rule}`), `${s.name} prompt shows its rule: ${line}`);
  }
  assert.ok(lines.find((l) => l.includes('-> HZ_REOPEN_BASE')).includes('checked: https, no ? and no #'));
  for (const s of CATALOG.filter((c) => c.source === 'generated')) {
    assert.match(step(2), new RegExp(`generate: ${s.name} = \\[masked\\] \\(`), `Step 2 generates ${s.name}, masked`);
  }
  for (const name of ['HZ_ACCOUNT_KEY', 'HZ_SEED_KEY', 'HZ_TICKET_KEY']) assert.ok(step(5).includes(`an ${name}`) || step(5).includes(`or ${name}`), `Step 5 says when ${name} is kept`);
  for (const s of CATALOG.filter((c) => c.store === 'secret')) {
    assert.match(step(5), new RegExp(`wrangler secret put ${s.name} --config wrangler\\.deploy\\.toml\\s+< stdin: \\[masked\\]`));
  }
  // Step 7 names what the checklist expects: every schema.sql table (A5's included) and every secret, by name only.
  const tablesLine = lines.find((l) => l.includes('expect tables:'));
  assert.ok(tablesLine && step(7).includes(tablesLine), 'Step 7 names the tables the schema check expects');
  assert.deepEqual(tablesLine.split('expect tables:')[1].split(',').map((t) => t.trim()), TABLES);
  for (const t of ['otp', 'exchange', 'limits', 'pending_try']) assert.ok(TABLES.includes(t));
  const secretsLine = lines.find((l) => l.includes('expect secrets (names only):'));
  assert.ok(secretsLine && step(7).includes(secretsLine), 'Step 7 names the secrets the checklist looks for');
  assert.deepEqual(secretsLine.split('expect secrets (names only):')[1].split(',').map((n) => n.trim()).sort(), [...SECRET_NAMES].sort());
  // Masked means no value: none of the test's fake values, and no JWK or base64url key shape.
  for (const v of [...SECRET_VALUES, ANSWERS.HZ_LINK_BASE, ANSWERS.HZ_REOPEN_BASE]) assert.equal(out.includes(v), false, 'dry run prints no value');
  assert.doesNotMatch(out, /"d"\s*:|"kty"|[A-Za-z0-9_-]{43}/);
});

test('a full run against mocked wrangler creates the database, sets every secret through stdin and passes the checklist', async () => {
  const h = harness();
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  const order = h.wrangler.calls.map((c) => c.args.slice(0, 2).join(' '));
  assert.deepEqual(order.slice(0, 7), ['--version', 'whoami --json', 'deployments list', 'd1 list', 'd1 create', 'd1 list', 'd1 execute']);
  assert.ok(order.indexOf('deploy --config') < order.indexOf('secret put'), 'the Worker exists before a secret is put');
  // d1 create runs in an empty folder, so it cannot edit the committed wrangler.toml.
  assert.equal(h.wrangler.calls.find((c) => c.args[1] === 'create').cwd, '/tmp/hz-deploy-test-empty');
  for (const name of SECRET_NAMES) {
    const put = h.wrangler.calls.find((c) => c.args[0] === 'secret' && c.args[2] === name);
    assert.ok(put, `${name} is put`);
    assert.equal(typeof put.input, 'string');
    assert.ok(put.input.length > 0);
  }
  assert.equal(h.wrangler.calls.find((c) => c.args[2] === 'HZ_ACCOUNT_KEY').input, GENERATED);
  assert.equal(h.wrangler.calls.find((c) => c.args[2] === 'HZ_SEED_KEY').input, GENERATED_SEED);
  assert.equal(h.wrangler.calls.find((c) => c.args[2] === 'HZ_TICKET_KEY').input, FIXED_TICKET_KEY);
  assert.equal(h.wrangler.calls.find((c) => c.args[2] === 'RESEND_KEY').input, ANSWERS.RESEND_KEY);
  assert.equal(h.asked.find((a) => a.name === 'RESEND_KEY').hidden, true);
  assert.equal(h.asked.find((a) => a.name === 'HZ_ALERT_TO').hidden, false);
  assert.ok(h.wrangler.calls.slice(2).every((c) => c.env?.CLOUDFLARE_ACCOUNT_ID === FAKE_ACCOUNT.id), 'every call after whoami is pinned to the confirmed account');
  for (const i of result.checklist) assert.ok(i.status === 'PASS' || (i.status === 'SKIPPED' && /administrator/.test(i.item)), `${i.item}: ${i.status} ${i.detail}`);
  assert.match(h.output(), /^RESULT: PASS/m);
  assert.equal(h.fetched[0].url, `https://${HOSTNAME}/account`);
  assert.equal(h.fetched[0].init.method, 'GET');
  assertNoSecretAnywhere(h);
});

test('the deploy config carries the real id and the one proxied route, and wrangler.toml stays clean', async () => {
  const h = harness();
  await deploy(h.deps);
  const file = path.join(ROOT, 'wrangler.deploy.toml');
  const text = h.files.get(file);
  assert.ok(text, 'wrangler.deploy.toml is written next to wrangler.toml');
  assert.match(text, new RegExp(`database_id = "${FAKE_DB_ID}"`));
  assert.match(text, /^workers_dev = false$/m);
  assert.match(text, /^routes = \[\{ pattern = "horae-zone\.nooutco\.me", custom_domain = true \}\]$/m);
  assert.ok(text.indexOf('routes =') < text.indexOf('[triggers]'), 'routes is a top-level key, before the first table');
  assert.equal([...h.files.keys()].length, 1, 'no other file is written');
  assert.doesNotMatch(readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8'), new RegExp(FAKE_DB_ID));
  const ignored = execFileSync('git', ['check-ignore', 'wrangler.deploy.toml'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.equal(ignored, 'wrangler.deploy.toml');
});

test('NEGATIVE CONTROL: deployConfig refuses a wrangler.toml whose placeholder id is gone', () => {
  assert.throws(() => deployConfig('name = "x"\nworkers_dev = false\n[triggers]\n', { databaseId: FAKE_DB_ID }), /placeholder/);
  assert.throws(() => deployConfig('name = "x"\nworkers_dev = true\ndatabase_id = "00000000-0000-0000-0000-000000000000"\n', { databaseId: FAKE_DB_ID }), /workers_dev/);
});

test('a database that already exists is found, not created, and the schema is still applied', async () => {
  const h = harness({ wrangler: mockWrangler({ dbPresent: true }) });
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  assert.equal(h.wrangler.calls.some((c) => c.args[0] === 'd1' && c.args[1] === 'create'), false);
  const apply = h.wrangler.calls.find((c) => c.args[1] === 'execute' && c.args.includes('--file'));
  assert.ok(apply.args.includes('--remote'));
  assert.match(h.files.get(path.join(ROOT, 'wrangler.deploy.toml')), new RegExp(FAKE_DB_ID));
});

test('the schema is idempotent: every CREATE in schema.sql says IF NOT EXISTS', () => {
  const sql = readFileSync(path.join(ROOT, 'schema.sql'), 'utf8').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  const creates = sql.match(/CREATE\s+(TABLE|INDEX|UNIQUE INDEX)[^(;]*/gi) ?? [];
  assert.ok(creates.length > 0);
  for (const c of creates) assert.match(c, /IF NOT EXISTS/i, c);
});

// ---- Columns: schema.sql's columns reach a table that already exists ----
// schema.sql with one stretch of a table's text replaced, as an older
// database was made; the guard fails loudly if the text it edits has moved.
function olderSchema(from, to) {
  assert.ok(SCHEMA.includes(from), `schema.sql still has: ${from.trim()}`);
  return SCHEMA.replace(from, to);
}
const columnsOf = (h, table) => h.wrangler.sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const sqlCalls = (h, re) => h.wrangler.calls.filter((c) => re.test(c.args[c.args.indexOf('--command') + 1] ?? ''));
const called = (h, first) => h.wrangler.calls.some((c) => c.args[0] === first[0] && c.args[1] === first[1]);

test('9 Oct incident: an existing device table without confirmed_at gets it added before the Worker deploys', async () => {
  const h = harness({ wrangler: mockWrangler({ dbPresent: true, existingSchema: olderSchema(',\n  confirmed_at INTEGER\n', '\n') }) });
  assert.equal(columnsOf(h, 'device').includes('confirmed_at'), false, 'the database starts the way production was');
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  assert.ok(columnsOf(h, 'device').includes('confirmed_at'), 'device has confirmed_at after the deploy');
  const alters = sqlCalls(h, /^ALTER TABLE/);
  assert.deepEqual(alters.map((c) => c.args[c.args.indexOf('--command') + 1]), ['ALTER TABLE device ADD COLUMN confirmed_at INTEGER']);
  assert.ok(alters[0].args.includes('--remote') && alters[0].args.includes('wrangler.deploy.toml'), 'the ALTER goes to the remote database through the deploy config');
  const at = (pred) => h.wrangler.calls.findIndex(pred);
  assert.ok(sqlCalls(h, /^CREATE TABLE/).length === 1 && h.wrangler.calls.indexOf(sqlCalls(h, /^CREATE TABLE/)[0]) < h.wrangler.calls.indexOf(alters[0]), 'after schema.sql\'s tables are applied');
  assert.ok(h.wrangler.calls.indexOf(alters[0]) < at((c) => c.args.includes('--file')), 'before schema.sql\'s indexes and triggers');
  assert.ok(h.wrangler.calls.indexOf(alters[0]) < at((c) => c.args[0] === 'deploy'), 'before the Worker deploys');
  const added = result.checklist.find((i) => i.item === 'Column added device.confirmed_at');
  assert.equal(added?.status, 'PASS', 'the checklist names the column it added');
  assert.match(added.detail, /ALTER TABLE device ADD COLUMN confirmed_at INTEGER/);
  assert.equal(statusOf(result, 'Columns match schema.sql'), 'PASS');
  assert.match(h.output(), /Added column confirmed_at to table device/);
  assertNoSecretAnywhere(h);
});

test('a missing column that schema.sql also indexes is added before the index is made, and the deploy passes', async () => {
  // An older limits table: no reopen_hash and so no index on it. Applying the
  // whole of schema.sql first would fail on CREATE INDEX limits_reopen_hash
  // (no such column) before any column could be added.
  const older = olderSchema('  version      INTEGER NOT NULL DEFAULT 0,\n  reopen_hash  TEXT\n);\n\nCREATE INDEX IF NOT EXISTS limits_reopen_hash ON limits (reopen_hash);\n', '  version      INTEGER NOT NULL DEFAULT 0\n);\n');
  const h = harness({ wrangler: mockWrangler({ dbPresent: true, existingSchema: older }) });
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  assert.ok(columnsOf(h, 'limits').includes('reopen_hash'), 'limits has reopen_hash after the deploy');
  const index = h.wrangler.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'limits_reopen_hash'").get();
  assert.equal(index?.name, 'limits_reopen_hash', 'the index on it was made');
  assert.equal(result.checklist.find((i) => i.item === 'Column added limits.reopen_hash')?.status, 'PASS');
  const at = (c) => h.wrangler.calls.indexOf(c);
  const [alter] = sqlCalls(h, /^ALTER TABLE limits ADD COLUMN reopen_hash TEXT$/);
  const file = h.wrangler.calls.find((c) => c.args.includes('--file'));
  assert.ok(alter && file && at(alter) < at(file), 'the column is added before schema.sql\'s indexes are applied');
  assert.ok(at(file) < h.wrangler.calls.findIndex((c) => c.args[0] === 'deploy'), 'and the indexes before the Worker deploys');
});

test('the first pass is every CREATE TABLE in schema.sql and nothing else, and on an empty database makes the same tables', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(tableStatements(SCHEMA));
  const made = (type) => db.prepare('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name').all(type).map((r) => r.name);
  assert.deepEqual(made('table').filter((t) => t !== 'sqlite_sequence'), [...TABLES].sort());
  assert.deepEqual([made('index').filter((n) => !n.startsWith('sqlite_autoindex')), made('trigger')], [[], []], 'no index or trigger in the first pass');
  assert.doesNotMatch(tableStatements(SCHEMA), /--/, 'no comment reaches the command line');
  assert.deepEqual(declaredColumns(tableStatements(SCHEMA)), declaredColumns(SCHEMA), 'every column as the whole file declares it');
});

test('a failed ALTER stops before the Worker deploys with wrangler\'s own reason and the table and column named', async () => {
  const older = olderSchema(',\n  confirmed_at INTEGER\n', '\n');
  const reason = '✘ [ERROR] A request to the Cloudflare API failed. D1_ERROR: database is locked: SQLITE_BUSY';
  for (const state of [{ alterFail: reason }, { alterOut: JSON.stringify([{ success: false, error: 'D1_ERROR: database is locked: SQLITE_BUSY' }]) }]) {
    const h = harness({ wrangler: mockWrangler({ dbPresent: true, existingSchema: older, ...state }) });
    const result = await deploy(h.deps);
    assert.equal(result.ok, false);
    assert.equal(called(h, ['deploy', '--config']), false, 'the Worker is not deployed');
    assert.match(h.output(), /STOPPED\. Could not add column confirmed_at to table device[^\n]*Worker was not deployed/);
    assert.match(h.output(), /database is locked: SQLITE_BUSY/, 'wrangler\'s own reason is printed');
    assert.equal(statusOf(result, 'Columns match schema.sql'), 'FAIL');
    assert.match(result.checklist.find((i) => i.item === 'Columns match schema.sql').detail, /Could not add column confirmed_at to table device/);
  }
});

test('a missing NOT NULL column without a default stops the deploy before the Worker deploys, naming table and column', async () => {
  const h = harness({ wrangler: mockWrangler({ dbPresent: true, existingSchema: olderSchema('  sign_key    TEXT    NOT NULL,\n', '') }) });
  const result = await deploy(h.deps);
  assert.equal(result.ok, false);
  assert.equal(sqlCalls(h, /^ALTER TABLE/).length, 0, 'no column is added');
  assert.equal(called(h, ['deploy', '--config']), false, 'the Worker is not deployed');
  assert.equal(called(h, ['secret', 'put']), false, 'no secret is put');
  assert.equal(columnsOf(h, 'device').includes('sign_key'), false);
  assert.match(h.output(), /STOPPED\. [^\n]*Worker was not deployed/);
  assert.match(h.output(), /Table device is missing column sign_key, which schema\.sql declares NOT NULL with no constant DEFAULT/);
  assert.equal(statusOf(result, 'Columns match schema.sql'), 'FAIL');
});

test('a changed type or a column schema.sql no longer declares stops the deploy before the Worker deploys', async () => {
  const h = harness({ wrangler: mockWrangler({ dbPresent: true, existingSchema: olderSchema('  agree_key   TEXT,\n', '  agree_key   INTEGER,\n  legacy_key  TEXT,\n') }) });
  const result = await deploy(h.deps);
  assert.equal(result.ok, false);
  assert.equal(sqlCalls(h, /^ALTER TABLE/).length, 0);
  assert.equal(called(h, ['deploy', '--config']), false, 'the Worker is not deployed');
  assert.match(h.output(), /Table device column agree_key is INTEGER in the database but TEXT in schema\.sql/);
  assert.match(h.output(), /Table device has column legacy_key, which schema\.sql does not declare/);
});

test('a missing NOT NULL column with a constant DEFAULT is added; a UNIQUE, key or non-constant DEFAULT column is not', () => {
  const ddl = `CREATE TABLE IF NOT EXISTS t (
  id    TEXT    PRIMARY KEY,
  n     INTEGER NOT NULL DEFAULT 0, -- a comment, (with a comma)
  s     TEXT    DEFAULT 'a,b',
  u     TEXT    UNIQUE,
  e     INTEGER DEFAULT (1 + 1)
);`;
  const want = declaredColumns(ddl).get('t');
  const defs = columnDefinitions(ddl).get('t');
  const only = (name) => want.filter((c) => c.name === 'id' || c.name === name);
  const added = planTable('t', want, only('none'), defs);
  assert.deepEqual(added.add.map((a) => a.definition), ['n INTEGER NOT NULL DEFAULT 0', "s TEXT DEFAULT 'a,b'"]);
  assert.match(added.problems.join('\n'), /missing column u, which schema\.sql declares UNIQUE/);
  assert.match(added.problems.join('\n'), /missing column e, which has DEFAULT 1 \+ 1 in schema\.sql, not a constant/);
  assert.match(planTable('t', want, want.filter((c) => c.name !== 'id'), defs).problems.join('\n'), /missing column id, which schema\.sql declares part of the PRIMARY KEY/);
  assert.deepEqual(planTable('t', want, want, defs), { add: [], problems: [] }, 'NEGATIVE CONTROL: the same columns plan nothing');
});

test('NEGATIVE CONTROL: a database that matches schema.sql gets no column added', async () => {
  const h = harness({ wrangler: mockWrangler({ dbPresent: true }) });
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  assert.equal(sqlCalls(h, /^ALTER TABLE/).length, 0, 'no ALTER TABLE is sent');
  assert.equal(result.checklist.some((i) => i.item.startsWith('Column added')), false);
  assert.equal(statusOf(result, 'Columns match schema.sql'), 'PASS');
  assert.deepEqual(sqlCalls(h, /^PRAGMA table_info/).map((c) => c.args[c.args.indexOf('--command') + 1]), TABLES.map((t) => `PRAGMA table_info(${t})`), 'every table schema.sql declares is read once');
});

test('declining the account stops before anything is created or deployed', async () => {
  const h = harness({ confirm: 'n' });
  const result = await deploy(h.deps);
  assert.equal(result.ok, false);
  assert.deepEqual(h.wrangler.calls.map((c) => c.args.slice(0, 2).join(' ')), ['--version', 'whoami --json']);
  assert.equal(h.files.size, 0);
});

test('with several accounts, the one picked is the one every call is pinned to', async () => {
  const second = { id: 'acc1111111111111111111111111fake', name: 'Second Test Account' };
  const h = harness({ wrangler: mockWrangler({ accounts: [FAKE_ACCOUNT, second] }), confirm: '2' });
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  assert.ok(h.wrangler.calls.slice(2).every((c) => c.env?.CLOUDFLARE_ACCOUNT_ID === second.id));
  assert.match(h.output(), /Second Test Account/);
});

test('the checklist fails the item that is wrong: a 5xx route, a missing secret, no cron, a missing table', async () => {
  const h1 = harness({ route: { status: 500, body: '{"error":"failed"}', ray: true } });
  const r1 = await deploy(h1.deps);
  assert.equal(statusOf(r1, 'Route answers'), 'FAIL');
  assert.equal(r1.ok, false);
  assert.match(h1.output(), /^RESULT: FAIL/m);

  const r2 = await deploy(harness({ wrangler: mockWrangler({ dropSecret: 'RESEND_KEY' }) }).deps);
  assert.equal(statusOf(r2, 'Secret RESEND_KEY'), 'FAIL');
  assert.equal(statusOf(r2, 'Secret HZ_ACCOUNT_KEY'), 'PASS');

  const r3 = await deploy(harness({ wrangler: mockWrangler({ deployOut: 'Deployed horae-zone\n' }) }).deps);
  assert.equal(statusOf(r3, 'Cron trigger'), 'FAIL');

  for (const gone of ['ticket', 'pending_try']) {
    const r4 = await deploy(harness({ wrangler: mockWrangler({ tables: TABLES.filter((t) => t !== gone) }) }).deps);
    assert.equal(statusOf(r4, 'Schema applied'), 'FAIL', `${gone} missing`);
    assert.match(r4.checklist.find((i) => i.item === 'Schema applied').detail, new RegExp(`missing table\\(s\\): ${gone}$`));
  }

  const r5 = await deploy(harness({ route: { status: 405, body: '{"error":"method"}', ray: false } }).deps);
  assert.equal(statusOf(r5, 'Route answers'), 'FAIL', 'an answer without cf-ray did not come through the Cloudflare edge');

  const r6 = await deploy(harness({ edge: 'n' }).deps);
  assert.equal(statusOf(r6, 'Edge rule'), 'FAIL');
});

// The text of one step: from "Step n." to the next "Step n+1." (or the end).
const stepText = (out, n) => {
  const from = out.indexOf(`Step ${n}.`);
  const to = out.indexOf(`Step ${n + 1}.`, from);
  return out.slice(from, to === -1 ? undefined : to);
};

test('Step 4 prints only the rate rule; the hostname and DNS checks come after the deploy', async () => {
  const h = harness();
  await deploy(h.deps);
  const out = h.output();
  const four = stepText(out, 4);
  assert.match(four, /Rate rule on sign-up and sign-in/);
  // Before the deploy no Worker named horae-zone exists, so its Domains & Routes page cannot be found.
  assert.doesNotMatch(four, /Domains & Routes|Workers & Pages|Proxied|DNS > Records/);
  assert.doesNotMatch(four, /Skip|Bot Fight Mode/);
  const seven = stepText(out, 7);
  assert.match(seven, /Check after the deploy/);
  assert.match(seven, new RegExp(`Workers & Pages > horae-zone > Settings > Domains & Routes: ${HOSTNAME.replace(/\./g, '\\.')} listed as a Custom domain`));
  assert.match(seven, /DNS > Records: the horae-zone row shows Proxy status "Proxied"/);

  const lines = [];
  await deploy({ argv: ['--dry-run'], root: ROOT, write: (t) => lines.push(t) });
  const dry = lines.join('\n');
  assert.doesNotMatch(stepText(dry, 4), /Domains & Routes|Proxied/);
  assert.match(stepText(dry, 7), /Check after the deploy[\s\S]*Domains & Routes/);
});

// What the 4 Oct 2026 deploy met: Super Bot Fight Mode answered the route
// check with a managed challenge before the Worker saw the request.
const CHALLENGED = { status: 403, body: '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body></body></html>', ray: true, headers: { 'cf-mitigated': 'challenge' } };
const ROUTE_OK = { status: 405, body: '{"error":"method"}', ray: true };
const routeItems = (result) => result.checklist.filter((i) => i.item === 'Route answers');

function assertSkipRule(out) {
  assert.match(out, /Cloudflare's bot protection is answering before the Worker/);
  assert.match(out, /Security > Security rules > Create rule > Custom rule/);
  assert.match(out, new RegExp(`\\(http\\.host eq "${HOSTNAME.replace(/\./g, '\\.')}"\\)`));
  assert.match(out, /Then take action: Skip/);
  assert.match(out, /tick only "All Super Bot Fight Mode Rules"/);
  assert.match(out, /leave "All rate limiting rules" unticked/);
  assert.match(out, /Place at: First/);
}

test('a route answered by a Cloudflare challenge fails plainly and prints the exact skip rule', async () => {
  const h = harness({ route: CHALLENGED, recheck: ['n'] });
  const result = await deploy(h.deps);
  const [item] = routeItems(result);
  assert.equal(item.status, 'FAIL');
  assert.match(item.detail, /403/);
  assert.match(item.detail, /Cloudflare's bot protection is answering before the Worker/);
  assertSkipRule(stepText(h.output(), 7));
  assert.deepEqual(h.asked.filter((a) => a.name === 'confirm-recheck-route').map((a) => /re-check the route now\? \(y\)/i.test(a.question)), [true]);
  assert.equal(h.fetched.length, 1, 'n checks the route no more');
  assert.equal(routeItems(result).length, 1);
});

test('a challenge page with no cf-mitigated header is read as a challenge too', async () => {
  const h = harness({ route: { ...CHALLENGED, headers: {}, body: '<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>' }, recheck: ['n'] });
  const result = await deploy(h.deps);
  assert.equal(statusOf(result, 'Route answers'), 'FAIL');
  assertSkipRule(stepText(h.output(), 7));
});

test('a re-check after the skip rule turns the route PASS, and redoes no other step', async () => {
  const base = harness();
  await deploy(base.deps);
  const h = harness({ route: [CHALLENGED, ROUTE_OK], recheck: ['y'] });
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  assert.deepEqual(routeItems(result).map((i) => i.status), ['PASS']);
  assert.equal(h.fetched.length, 2);
  // The same wrangler calls as a run whose route passed at once: nothing was put, deployed or created twice.
  assert.deepEqual(h.wrangler.calls.map((c) => c.args), base.wrangler.calls.map((c) => c.args));
  assert.deepEqual(h.asked.map((a) => a.name).filter((n) => n !== 'confirm-recheck-route'), base.asked.map((a) => a.name));
  assertNoSecretAnywhere(h);
});

test('a re-check still challenged asks again; a plain 403 offers no skip rule and no re-check', async () => {
  const h = harness({ route: [CHALLENGED, CHALLENGED, ROUTE_OK], recheck: ['y', 'y'] });
  const result = await deploy(h.deps);
  assert.equal(statusOf(result, 'Route answers'), 'PASS');
  assert.equal(h.asked.filter((a) => a.name === 'confirm-recheck-route').length, 2);

  // No recheck answer given: the harness throws on the prompt, so none was asked.
  const plain = harness({ route: { status: 403, body: '{"error":"forbidden"}', ray: true } });
  const r2 = await deploy(plain.deps);
  assert.equal(statusOf(r2, 'Route answers'), 'FAIL');
  assert.doesNotMatch(plain.output(), /is answering before the Worker|Place at: First/);
  assert.equal(plain.asked.some((a) => a.name === 'confirm-recheck-route'), false);
});

// --check-only after a deploy: wrangler.deploy.toml is on disk (a stand-in
// here) and the Worker has every secret. `readFile` serves the stand-in and
// reads every other file for real; `missingConfig` makes the config absent.
function checkOnly({ wrangler, missingConfig = false, sitekey = ANSWERS.HZ_TURNSTILE_SITEKEY, ...rest } = {}) {
  const h = harness({ argv: ['--check-only'], wrangler: wrangler ?? mockWrangler({ dbPresent: true, existingSecrets: SECRET_NAMES }), ...rest });
  h.deps.readFile = (file) => {
    if (path.basename(file) !== 'wrangler.deploy.toml') return readFileSync(file, 'utf8');
    if (missingConfig) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`), { code: 'ENOENT' });
    const vars = sitekey === null ? '' : `\n[vars]\nHZ_TURNSTILE_SITEKEY = "${sitekey}"\n`;
    return `name = "horae-zone"\n[[d1_databases]]\ndatabase_id = "${FAKE_DB_ID}"\n${vars}`;
  };
  return h;
}
// The only wrangler calls --check-only may make: none writes anything.
const READ_ONLY = ['--version', 'whoami --json', `d1 execute horae-zone --remote --json --command SELECT name FROM sqlite_master WHERE type='table' --config wrangler.deploy.toml`, 'secret list --format json --config wrangler.deploy.toml'];

test('--check-only runs only the Step 7 checks: it asks nothing and calls no write command', async () => {
  const h = checkOnly();
  const result = await deploy(h.deps);
  const out = h.output();
  assert.deepEqual(h.asked, [], 'no prompt at all');
  assert.equal(h.files.size, 0, 'no file written');
  for (const c of h.wrangler.calls) assert.ok(READ_ONLY.includes(c.args.join(' ')), `--check-only called a non-read command: wrangler ${c.args.join(' ')}`);
  for (const c of h.wrangler.calls) assert.equal(c.input ?? '', '', 'no stdin to any wrangler call');
  const did = (prefix) => h.wrangler.calls.some((c) => c.args.join(' ').startsWith(prefix));
  for (const write of ['secret put', 'deploy', 'd1 create', 'deployments']) assert.equal(did(write), false, `no ${write}`);
  assert.ok(did('d1 execute horae-zone --remote --json --command') && did('secret list'), 'the schema and secret reads ran');
  for (const n of [1, 2, 3, 4, 5, 6]) assert.equal(out.includes(`Step ${n}.`), false, `no Step ${n}`);
  assert.match(out, /Step 7\. Checks/);
  assert.match(out, /Check after the deploy/);
  for (const c of h.wrangler.calls.filter((c) => c.args[0] !== '--version' && c.args[0] !== 'whoami')) assert.equal(c.env.CLOUDFLARE_ACCOUNT_ID, FAKE_ACCOUNT.id);
  assert.equal(statusOf(result, 'Cloudflare account'), 'PASS');
  assert.equal(statusOf(result, 'Schema applied'), 'PASS');
  for (const name of SECRET_NAMES) assert.equal(statusOf(result, `Secret ${name}`), 'PASS');
  assert.equal(statusOf(result, 'Route answers'), 'PASS');
  assert.equal(statusOf(result, 'Cron trigger'), 'SKIPPED');
  assert.equal(statusOf(result, 'Edge rule'), 'SKIPPED');
  assert.equal(result.ok, true, out);
  assertNoSecretAnywhere(h);
});

test('--check-only on a challenged route prints the skip rule and asks nothing', async () => {
  // No recheck answer: the harness throws on the prompt, so a FAIL here means none was asked.
  const h = checkOnly({ route: CHALLENGED });
  const result = await deploy(h.deps);
  assert.deepEqual(h.asked, []);
  const [item] = routeItems(result);
  assert.equal(item.status, 'FAIL');
  assert.match(item.detail, /Cloudflare's bot protection is answering before the Worker/);
  assertSkipRule(h.output());
  assert.match(h.output(), /node bin\/deploy\.mjs --check-only/, 'says how to check again');
  assert.equal(h.fetched.length, 1);
});

test('--check-only picks the account without asking, and stops plainly when it cannot', async () => {
  const other = { id: 'acc1111111111111111111111111fake', name: 'Second Test Account' };
  const two = () => mockWrangler({ dbPresent: true, existingSecrets: SECRET_NAMES, accounts: [FAKE_ACCOUNT, other] });

  const many = checkOnly({ wrangler: two() });
  const r1 = await deploy(many.deps);
  assert.deepEqual(many.asked, []);
  assert.equal(r1.ok, false);
  assert.match(many.output(), /more than one Cloudflare account: set CLOUDFLARE_ACCOUNT_ID/);
  assert.deepEqual(many.wrangler.calls.map((c) => c.args.join(' ')), ['--version', 'whoami --json']);

  const named = checkOnly({ wrangler: two() });
  named.deps.accountId = other.id;
  const r2 = await deploy(named.deps);
  assert.deepEqual(named.asked, []);
  assert.equal(r2.ok, true, named.output());
  assert.match(r2.checklist.find((i) => i.item === 'Cloudflare account').detail, /Second Test Account/);
  assert.ok(named.wrangler.calls.filter((c) => c.args[0] === 'secret').every((c) => c.env.CLOUDFLARE_ACCOUNT_ID === other.id));

  const missing = checkOnly({ missingConfig: true });
  const r3 = await deploy(missing.deps);
  assert.equal(r3.ok, false);
  assert.match(missing.output(), /wrangler\.deploy\.toml is not here/);
  assert.deepEqual(missing.wrangler.calls.map((c) => c.args.join(' ')), ['--version'], 'stops before any account call');
});

// ---- Step 6, the owner as administrator (A5c) ----

// Account ids are randomUUID values (src/signup.js); times are fixed.
const OWNER_ACCOUNT = { id: '6f1c2a0e-1111-4c4c-8a8a-0000000000a1', created_at: Date.UTC(2026, 9, 9, 14, 2), devices: 2 };
const LATER_ACCOUNT = { id: '6f1c2a0e-2222-4c4c-8a8a-0000000000b2', created_at: Date.UTC(2026, 9, 10, 9, 30), devices: 1 };
const sqlOf = (c) => c.args[c.args.indexOf('--command') + 1] ?? '';
const grants = (h) => h.wrangler.calls.filter((c) => /^INSERT INTO role/.test(sqlOf(c)));

// --owner-admin after a deploy: wrangler.deploy.toml is on disk (a stand-in).
function ownerAdminRun({ wrangler, ...rest } = {}) {
  const h = harness({ argv: ['--owner-admin'], wrangler: wrangler ?? mockWrangler({ dbPresent: true, existingSecrets: SECRET_NAMES, hzAccounts: [OWNER_ACCOUNT] }), ...rest });
  h.deps.readFile = (file) => {
    if (path.basename(file) !== 'wrangler.deploy.toml') return readFileSync(file, 'utf8');
    return `name = "horae-zone"\n[[d1_databases]]\ndatabase_id = "${FAKE_DB_ID}"\n`;
  };
  return h;
}

test('Step 6 sets the account the owner picks as administrator, once, guarded in the statement itself', async () => {
  const h = harness({ wrangler: mockWrangler({ hzAccounts: [OWNER_ACCOUNT, LATER_ACCOUNT] }), pick: '1' });
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  assert.equal(statusOf(result, 'Owner as administrator'), 'PASS');
  const six = stepText(h.output(), 6);
  assert.match(six, /1\) created 2026-10-09 14:02 UTC, 2 devices/);
  assert.match(six, /2\) created 2026-10-10 09:30 UTC, 1 device\b/);
  assert.equal(h.asked.find((a) => a.name === 'pick-owner-account').hidden, false);
  const [grant] = grants(h);
  assert.ok(grant, 'one grant was run');
  assert.equal(grants(h).length, 1);
  assert.match(sqlOf(grant), new RegExp(`WHERE id = '${OWNER_ACCOUNT.id}'`));
  assert.match(sqlOf(grant), /NOT EXISTS \(SELECT 1 FROM role WHERE role = 'admin'\)/, 'set once: the statement refuses when an admin exists');
  assert.ok(grant.args.includes('--remote'));
  assert.deepEqual([...h.wrangler.admins], [OWNER_ACCOUNT.id]);
  const order = h.wrangler.calls.map((c) => c.args.slice(0, 2).join(' '));
  assert.ok(order.lastIndexOf('secret put') < h.wrangler.calls.indexOf(grant), 'Step 6 runs after the secrets are put');
  assertNoSecretAnywhere(h);
});

test('Step 6 changes nothing and asks nothing when an administrator is already set', async () => {
  const h = harness({ wrangler: mockWrangler({ hzAccounts: [OWNER_ACCOUNT, LATER_ACCOUNT], admins: [LATER_ACCOUNT.id] }) });
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  assert.equal(statusOf(result, 'Owner as administrator'), 'PASS');
  assert.match(result.checklist.find((i) => i.item === 'Owner as administrator').detail, /already set/);
  assert.equal(h.asked.some((a) => a.name === 'pick-owner-account'), false);
  assert.deepEqual(grants(h), []);
});

test('Step 6 with no account yet is SKIPPED, asks nothing, and names --owner-admin for after sign-up', async () => {
  const h = harness();
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  assert.equal(statusOf(result, 'Owner as administrator'), 'SKIPPED');
  assert.match(stepText(h.output(), 6), /node bin\/deploy\.mjs --owner-admin/);
  assert.equal(h.asked.some((a) => a.name === 'pick-owner-account'), false);
  assert.deepEqual(grants(h), []);
});

test('a blank or out-of-range pick, or a pick not confirmed with y, sets no role', async () => {
  for (const pick of ['', '0', '3', 'x', '1.5']) {
    const h = harness({ wrangler: mockWrangler({ hzAccounts: [OWNER_ACCOUNT, LATER_ACCOUNT] }), pick });
    const result = await deploy(h.deps);
    assert.equal(statusOf(result, 'Owner as administrator'), 'SKIPPED', `pick ${JSON.stringify(pick)}`);
    assert.deepEqual(grants(h), [], `pick ${JSON.stringify(pick)}`);
    assert.equal(h.asked.some((a) => a.name === 'confirm-owner-account'), false, 'no read-back for a pick that names no account');
    assert.equal(result.ok, true);
  }
  for (const confirmOwner of ['', 'n', 'no', '2']) {
    const h = harness({ wrangler: mockWrangler({ hzAccounts: [OWNER_ACCOUNT, LATER_ACCOUNT] }), pick: '2', confirmOwner });
    const result = await deploy(h.deps);
    assert.match(stepText(h.output(), 6), /You picked the account created 2026-10-10 09:30 UTC, 1 device\./, 'the pick is read back');
    assert.equal(statusOf(result, 'Owner as administrator'), 'SKIPPED', `confirm ${JSON.stringify(confirmOwner)}`);
    assert.deepEqual(grants(h), [], `confirm ${JSON.stringify(confirmOwner)}`);
  }
});

test('an account row of any other shape is never shown, picked or put into a command', async () => {
  const planted = { id: "x' OR 1=1; DROP TABLE role; --", created_at: Date.UTC(2026, 9, 8), devices: 1 };
  const h = harness({ wrangler: mockWrangler({ hzAccounts: [planted, OWNER_ACCOUNT] }), pick: '1' });
  const result = await deploy(h.deps);
  assert.equal(h.output().includes('DROP TABLE'), false);
  assert.match(stepText(h.output(), 6), /1\) created 2026-10-09 14:02 UTC/, 'the one well-formed row is the first choice');
  assert.equal(grants(h).length, 1);
  assert.match(sqlOf(grants(h)[0]), new RegExp(`WHERE id = '${OWNER_ACCOUNT.id}'`));
  assert.equal(h.wrangler.calls.some((c) => c.args.join(' ').includes('DROP TABLE')), false);
  assert.equal(statusOf(result, 'Owner as administrator'), 'PASS');
});

test('a grant that comes back with no row fails plainly, and an unreadable table fails the item', async () => {
  const h = harness({ wrangler: mockWrangler({ hzAccounts: [OWNER_ACCOUNT], grantNoRow: true }), pick: '1' });
  const result = await deploy(h.deps);
  assert.equal(statusOf(result, 'Owner as administrator'), 'FAIL');
  assert.match(result.checklist.find((i) => i.item === 'Owner as administrator').detail, /no role was set/);
  assert.equal(result.ok, false);

  const broken = mockWrangler({ hzAccounts: [OWNER_ACCOUNT] });
  const run = broken.run;
  broken.run = async (args, opts) => (/COUNT\(\*\) AS admins/.test(args.join(' ')) ? { code: 1, stdout: '', stderr: 'no such table: role' } : run(args, opts));
  const h2 = harness({ wrangler: broken });
  const r2 = await deploy(h2.deps);
  assert.equal(statusOf(r2, 'Owner as administrator'), 'FAIL');
  assert.equal(statusOf(r2, 'Route answers'), 'PASS', 'the checks still run after it');
  assert.deepEqual(grants(h2), []);
});

test('--owner-admin runs Step 6 alone: no deploy, no secret, no other write, only the pick and its read-back', async () => {
  const h = ownerAdminRun({ pick: '1' });
  const result = await deploy(h.deps);
  const out = h.output();
  assert.equal(result.ok, true, out);
  assert.deepEqual(h.asked.map((a) => a.name), ['pick-owner-account', 'confirm-owner-account']);
  assert.equal(h.files.size, 0, 'no file written');
  for (const c of h.wrangler.calls) assert.equal(c.input ?? '', '', 'no stdin to any wrangler call');
  const writes = h.wrangler.calls.filter((c) => ['secret', 'deploy', 'deployments'].includes(c.args[0]) || c.args[1] === 'create' || c.args.includes('--file'));
  assert.deepEqual(writes, []);
  assert.equal(grants(h).length, 1, 'the one write is the grant');
  for (const n of [1, 2, 3, 4, 5, 7]) assert.equal(out.includes(`Step ${n}.`), false, `no Step ${n}`);
  assert.match(out, /Step 6\. Owner as administrator/);
  assert.equal(statusOf(result, 'Owner as administrator'), 'PASS');
  for (const c of h.wrangler.calls.filter((c) => c.args[0] === 'd1')) assert.equal(c.env.CLOUDFLARE_ACCOUNT_ID, FAKE_ACCOUNT.id);
  assertNoSecretAnywhere(h);
});

test('the dry run names Step 6, its reads and its one guarded write', async () => {
  const forbidden = (what) => () => { throw new Error(`dry run called ${what}`); };
  const lines = [];
  await deploy({
    argv: ['--dry-run'], root: ROOT, write: (t) => lines.push(t),
    run: forbidden('wrangler'), ask: forbidden('a prompt'), fetchImpl: forbidden('fetch'),
    writeFile: forbidden('writeFile'), makeTempDir: forbidden('makeTempDir'), removeDir: forbidden('removeDir'),
    randomBytes: forbidden('randomBytes'), sleep: forbidden('sleep'),
  });
  const six = stepText(lines.join('\n'), 6);
  assert.match(six, /SELECT COUNT\(\*\) AS admins FROM role/);
  assert.match(six, /FROM account a/);
  assert.match(six, /INSERT INTO role/);
  assert.match(six, /prompt: the number of your own account/);
  assert.match(six, /--owner-admin/);
  assert.doesNotMatch(six, /SKIPPED/);
});

test('NEGATIVE CONTROL: a planted token in a check\'s output is caught', async () => {
  const planted = JSON.stringify([...SECRET_NAMES.map((name) => ({ name, type: 'secret_text' })), { name: 'LEAK', value: GENERATED }]);
  const h = harness({ wrangler: mockWrangler({ secretListOut: planted }) });
  const result = await deploy(h.deps);
  assert.equal(h.output().includes(GENERATED), false, 'the planted token never reaches the output');
  const leak = result.checklist.find((i) => /secret value/.test(i.detail));
  assert.ok(leak, 'a checklist item names the leak');
  assert.equal(leak.status, 'FAIL');
  assert.equal(result.ok, false);
  assertNoSecretAnywhere(h);
});

test('scrub masks every known value and reports that it did', () => {
  assert.deepEqual(scrub('a re_FAKE b re_FAKE', ['re_FAKE']), { text: 'a [masked] b [masked]', leaked: true });
  assert.deepEqual(scrub('nothing here', ['re_FAKE', '']), { text: 'nothing here', leaked: false });
});

// A value with quotes and angle brackets changes shape in JSON and in a URL.
const QUOTED_FROM = '"Horae Zone" <mail@example.test>';
const encodedForms = (v) => [
  JSON.stringify(v).slice(1, -1),
  encodeURIComponent(v),
  encodeURIComponent(v).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()),
  encodeURI(v),
  new URLSearchParams({ v }).toString().slice(2),
];

test('scrub also masks the JSON-escaped and URL-encoded forms of each value', () => {
  const forms = encodedForms(QUOTED_FROM);
  assert.equal(new Set([QUOTED_FROM, ...forms]).size, forms.length + 1, 'every form differs from the raw value');
  for (const form of forms) {
    const { text, leaked } = scrub(`before ${form} after`, [QUOTED_FROM]);
    assert.equal(text, 'before [masked] after', `form ${form} is masked`);
    assert.equal(leaked, true);
  }
  const { text } = scrub(`{"from":${JSON.stringify(QUOTED_FROM)}} ?from=${encodeURIComponent(QUOTED_FROM)}`, [QUOTED_FROM]);
  assert.equal(text, '{"from":"[masked]"} ?from=[masked]');
});

test('a wrangler failure echoing a value JSON-escaped or URL-encoded prints neither form', async () => {
  const w = mockWrangler();
  const base = w.run;
  const echo = `{"from":${JSON.stringify(QUOTED_FROM)}}\nGET /send?from=${encodeURIComponent(QUOTED_FROM)}`;
  w.run = async (args, opts) => (args[0] === 'deploy' ? (w.calls.push({ args, ...opts }), { code: 1, stdout: '', stderr: echo }) : base(args, opts));
  const h = harness({ wrangler: w, answers: { ...ANSWERS, HZ_MAIL_FROM: QUOTED_FROM } });
  const result = await deploy(h.deps);
  assert.equal(result.ok, false);
  assert.match(h.output(), /wrangler deploy failed/);
  for (const form of [QUOTED_FROM, ...encodedForms(QUOTED_FROM)]) assert.equal(h.output().includes(form), false, `output carries ${form}`);
  assert.match(h.output(), /\{"from":"\[masked\]"\}/);
});

test('a wrangler failure is reported with its output scrubbed, and the run stops', async () => {
  const w = mockWrangler();
  const base = w.run;
  w.run = async (args, opts) => (args[0] === 'deploy' ? (w.calls.push({ args, ...opts }), { code: 1, stdout: '', stderr: `boom ${GENERATED}` }) : base(args, opts));
  const h = harness({ wrangler: w });
  const result = await deploy(h.deps);
  assert.equal(result.ok, false);
  assert.match(h.output(), /wrangler deploy failed/);
  assert.equal(h.output().includes(GENERATED), false);
  assert.equal(w.calls.some((c) => c.args[0] === 'secret' && c.args[1] === 'put'), false, 'no secret is put after a failed deploy');
});

test('a rerun keeps the account key already set, unless --new-account-key is given', async () => {
  const h = harness({ wrangler: mockWrangler({ dbPresent: true, existingSecrets: ['HZ_ACCOUNT_KEY'] }) });
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  assert.equal(h.wrangler.calls.some((c) => c.args[0] === 'secret' && c.args[2] === 'HZ_ACCOUNT_KEY'), false, 'the stored key is not replaced');
  assert.ok(h.wrangler.calls.some((c) => c.args[0] === 'secret' && c.args[2] === 'RESEND_KEY'));
  assert.match(h.output(), /Kept HZ_ACCOUNT_KEY/);
  assert.equal(statusOf(result, 'Secret HZ_ACCOUNT_KEY'), 'PASS');

  const h2 = harness({ argv: ['--new-account-key'], replaceKey: 'replace', wrangler: mockWrangler({ dbPresent: true, existingSecrets: ['HZ_ACCOUNT_KEY'] }) });
  await deploy(h2.deps);
  assert.equal(h2.wrangler.calls.find((c) => c.args[0] === 'secret' && c.args[2] === 'HZ_ACCOUNT_KEY')?.input, GENERATED);
  assertNoSecretAnywhere(h2);
});

// Review 2026-10-04 item 1: an unreadable secret list once read as "no
// secrets", so a rerun replaced HZ_ACCOUNT_KEY and lost every account.
test('a secret list that is not an array of named entries stops the run before deploy, and the account key is not replaced', async () => {
  const shapes = {
    'a single object': JSON.stringify({ name: 'HZ_ACCOUNT_KEY', type: 'secret_text' }),
    'an object wrapper': JSON.stringify({ result: [{ name: 'HZ_ACCOUNT_KEY', type: 'secret_text' }] }),
    'an entry with no string name': JSON.stringify([{ name: 'HZ_ACCOUNT_KEY' }, { type: 'secret_text' }]),
    'no JSON at all': 'Secret Name: HZ_ACCOUNT_KEY',
  };
  for (const [shape, out] of Object.entries(shapes)) {
    const h = harness({ wrangler: mockWrangler({ dbPresent: true, existingSecrets: ['HZ_ACCOUNT_KEY'], secretListOut: out }) });
    const result = await deploy(h.deps);
    assert.equal(result.ok, false, shape);
    assert.match(h.output(), /could not read the secret list; the Worker and its secrets were not changed; rerun, or pass --new-account-key if you mean to replace it/, shape);
    assert.equal(h.wrangler.calls.some((c) => c.args[0] === 'deploy'), false, `${shape}: no deploy`);
    assert.equal(h.wrangler.calls.some((c) => c.args[0] === 'secret' && c.args[1] === 'put'), false, `${shape}: no secret put`);
    assertNoSecretAnywhere(h);
  }
});

test('a failed secret list read stops before deploy; only "Worker not found" reads as no secrets yet', async () => {
  const h = harness({ wrangler: mockWrangler({ dbPresent: true, existingSecrets: ['HZ_ACCOUNT_KEY'], secretListFail: '✘ [ERROR] A request to the Cloudflare API failed. Authentication error [code: 10000]' }) });
  const result = await deploy(h.deps);
  assert.equal(result.ok, false);
  assert.match(h.output(), /could not read the secret list; the Worker and its secrets were not changed/);
  assert.equal(h.wrangler.calls.some((c) => c.args[0] === 'deploy' || (c.args[0] === 'secret' && c.args[1] === 'put')), false);

  const first = harness({ wrangler: mockWrangler({ dbPresent: true }) });
  const r = await deploy(first.deps);
  assert.equal(r.ok, true, first.output());
  const order = first.wrangler.calls.map((c) => c.args.slice(0, 2).join(' '));
  assert.ok(order.indexOf('secret list') < order.indexOf('deploy --config'), 'the secret list is read before the deploy');
  assert.equal(first.wrangler.calls.find((c) => c.args[2] === 'HZ_ACCOUNT_KEY')?.input, GENERATED, 'a first deploy sets the key');
});

// Review 2026-10-04 item 2: --new-account-key replaced a stored key with no
// confirmation, so one stray flag lost every account.
test('--new-account-key over a stored key prints the consequence and replaces it only on the typed word replace', async () => {
  const stored = () => mockWrangler({ dbPresent: true, existingSecrets: ['HZ_ACCOUNT_KEY'] });
  const yes = harness({ argv: ['--new-account-key'], replaceKey: 'replace', wrangler: stored() });
  await deploy(yes.deps);
  const prompt = yes.asked.find((a) => a.name === 'confirm-replace-key');
  assert.ok(prompt, 'the replacement is confirmed through a prompt');
  assert.equal(prompt.hidden, false);
  assert.match(yes.output(), /every enrolment, ticket and account becomes unusable/);
  const order = yes.wrangler.calls.map((c) => c.args.slice(0, 2).join(' '));
  assert.equal(yes.wrangler.calls.find((c) => c.args[0] === 'secret' && c.args[2] === 'HZ_ACCOUNT_KEY')?.input, GENERATED);
  assert.ok(order.indexOf('secret list') < order.indexOf('deploy --config'));
  assertNoSecretAnywhere(yes);

  for (const answer of ['', 'y', 'yes', 'REPLACE', 'replace it']) {
    const no = harness({ argv: ['--new-account-key'], replaceKey: answer, wrangler: stored() });
    const result = await deploy(no.deps);
    assert.equal(result.ok, false, `answer ${JSON.stringify(answer)}`);
    assert.match(no.output(), /HZ_ACCOUNT_KEY not replaced; the Worker and its secrets were not changed/, `answer ${JSON.stringify(answer)}`);
    assert.equal(no.wrangler.calls.some((c) => c.args[0] === 'deploy' || (c.args[0] === 'secret' && c.args[1] === 'put')), false, `answer ${JSON.stringify(answer)}: no deploy, no secret put`);
  }
});

test('--new-account-key asks too when the secret list is unreadable, and not on a first deploy', async () => {
  const unreadable = harness({ argv: ['--new-account-key'], replaceKey: 'n', wrangler: mockWrangler({ dbPresent: true, existingSecrets: ['HZ_ACCOUNT_KEY'], secretListOut: '{}' }) });
  const result = await deploy(unreadable.deps);
  assert.equal(result.ok, false);
  assert.ok(unreadable.asked.some((a) => a.name === 'confirm-replace-key'), 'an unknown list may hold a key, so the replacement is confirmed');
  assert.equal(unreadable.wrangler.calls.some((c) => c.args[0] === 'deploy' || (c.args[0] === 'secret' && c.args[1] === 'put')), false);

  const first = harness({ argv: ['--new-account-key'], wrangler: mockWrangler({ dbPresent: true }) });
  const r = await deploy(first.deps);
  assert.equal(r.ok, true, first.output());
  assert.equal(first.asked.some((a) => a.name === 'confirm-replace-key'), false, 'a Worker never deployed has no key to replace');
});

// Review 2026-10-04 item 4: a Worker already named horae-zone in the confirmed
// account had its code replaced with no warning.
test('a Worker already named horae-zone is named, and replaced only on y, before anything is created', async () => {
  const existing = () => mockWrangler({ workerExists: true });
  const yes = harness({ wrangler: existing(), replaceWorker: 'y' });
  const r = await deploy(yes.deps);
  assert.equal(r.ok, true, yes.output());
  assert.match(yes.output(), /Worker horae-zone already exists; this will replace its code/);
  const check = yes.wrangler.calls.find((c) => c.args[0] === 'deployments');
  assert.deepEqual(check?.args, ['deployments', 'list', '--name', 'horae-zone', '--json']);
  assert.equal(check.env?.CLOUDFLARE_ACCOUNT_ID, FAKE_ACCOUNT.id, 'checked in the confirmed account');
  assert.equal(yes.asked.find((a) => a.name === 'confirm-replace-worker')?.hidden, false);

  for (const answer of ['n', '', 'no', 'replace']) {
    const no = harness({ wrangler: existing(), replaceWorker: answer });
    const result = await deploy(no.deps);
    assert.equal(result.ok, false, `answer ${JSON.stringify(answer)}`);
    assert.match(no.output(), /Worker horae-zone not replaced; nothing was changed/, `answer ${JSON.stringify(answer)}`);
    assert.deepEqual(no.wrangler.calls.map((c) => c.args.slice(0, 2).join(' ')), ['--version', 'whoami --json', 'deployments list'],`answer ${JSON.stringify(answer)}: nothing after the check`);
    assert.equal(no.files.size, 0);
  }

  const fresh = harness();
  assert.equal((await deploy(fresh.deps)).ok, true, fresh.output());
  assert.ok(fresh.wrangler.calls.some((c) => c.args[0] === 'deployments'), 'a first deploy is checked too');
  assert.equal(fresh.asked.some((a) => a.name === 'confirm-replace-worker'), false, 'no Worker, no question');
  assert.doesNotMatch(fresh.output(), /already exists/);
});

test('a Worker check that cannot tell whether horae-zone exists stops before anything is created', async () => {
  const cases = {
    'an auth failure': { deploymentsFail: '✘ [ERROR] A request to the Cloudflare API failed. Authentication error [code: 10000]' },
    'an object, not a list': { deploymentsOut: '{"deployments":[]}' },
    'no JSON at all': { deploymentsOut: 'Deployment ID: dep-1' },
  };
  for (const [what, state] of Object.entries(cases)) {
    const h = harness({ wrangler: mockWrangler(state) });
    const result = await deploy(h.deps);
    assert.equal(result.ok, false, what);
    assert.match(h.output(), /could not tell whether Worker horae-zone exists; nothing was changed/, what);
    assert.deepEqual(h.wrangler.calls.map((c) => c.args.slice(0, 2).join(' ')), ['--version', 'whoami --json', 'deployments list'],what);
  }
});

test('the run prints `wrangler --version` first, and a missing wrangler stops before the account is read', async () => {
  const h = harness();
  assert.equal((await deploy(h.deps)).ok, true, h.output());
  assert.deepEqual(h.wrangler.calls[0].args, ['--version']);
  assert.ok(h.lines.indexOf('wrangler 4.104.0') >= 0, 'the version is printed');
  assert.ok(h.lines.indexOf('wrangler 4.104.0') < h.lines.findIndex((l) => l.startsWith('Step 1.')), 'before step 1');

  const none = harness({ wrangler: mockWrangler({ versionFail: 'wrangler is not on PATH (npm i -g wrangler)' }) });
  assert.equal((await deploy(none.deps)).ok, false);
  assert.match(none.output(), /wrangler is not on PATH/);
  assert.match(none.output(), /wrangler --version failed/, 'the failure names the command');
  assert.deepEqual(none.wrangler.calls.map((c) => c.args.slice(0, 2).join(' ')), ['--version']);
  assert.equal(none.files.size, 0);
});

test('every wrangler call runs with WRANGLER_LOG_SANITIZE=true, over a shell that turned it off', async () => {
  const h = harness();
  assert.equal((await deploy(h.deps)).ok, true, h.output());
  for (const c of h.wrangler.calls) assert.equal(c.env?.WRANGLER_LOG_SANITIZE, 'true', `${c.args.slice(0, 2).join(' ')}`);

  // The real runner, against a stand-in `wrangler` that prints the variable it got.
  const bin = mkdtempSync(path.join(tmpdir(), 'hz-fake-wrangler-'));
  try {
    writeFileSync(path.join(bin, 'wrangler'), '#!/bin/sh\nprintf %s "$WRANGLER_LOG_SANITIZE"\n', { mode: 0o755 });
    const res = await runWrangler(['--version'], { env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, WRANGLER_LOG_SANITIZE: 'false' } });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(res.stdout, 'true');
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test('a wrangler that exits before reading its stdin is reported by its exit code, not a crash', async () => {
  // A big input guarantees the pipe fills, so the write hits a closed pipe (EPIPE).
  const bin = mkdtempSync(path.join(tmpdir(), 'hz-fake-wrangler-'));
  try {
    writeFileSync(path.join(bin, 'wrangler'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
    const res = await runWrangler(['secret', 'put', 'HZ_FAKE'], { input: 'x'.repeat(4 << 20), env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
    assert.equal(res.code, 3);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test('the generated account key is 32 random bytes, base64url, and the service accepts it', async () => {
  const h = harness();
  await deploy(h.deps);
  const key = h.wrangler.calls.find((c) => c.args[2] === 'HZ_ACCOUNT_KEY').input;
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(await accountKeys({ HZ_ACCOUNT_KEY: key }));
});

test('the generated seed key is 32 random bytes of its own, base64url, and the service seals seeds with it', async () => {
  const h = harness();
  await deploy(h.deps);
  const key = h.wrangler.calls.find((c) => c.args[0] === 'secret' && c.args[2] === 'HZ_SEED_KEY')?.input;
  assert.equal(key, GENERATED_SEED, 'HZ_SEED_KEY is put through stdin');
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(await seedBoxKey({ HZ_SEED_KEY: key }), 'src/otp.js makes a seed box key from it');
  assert.match(h.output(), /Generated HZ_SEED_KEY/);
  assertNoSecretAnywhere(h);

  // Real randomness: the seed key is its own draw, never the account key again.
  const real = harness({ randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)) });
  await deploy(real.deps);
  const putOf = (name) => real.wrangler.calls.find((c) => c.args[0] === 'secret' && c.args[2] === name)?.input;
  assert.notEqual(putOf('HZ_SEED_KEY'), putOf('HZ_ACCOUNT_KEY'));
  assert.ok(await seedBoxKey({ HZ_SEED_KEY: putOf('HZ_SEED_KEY') }));
  assert.equal(real.output().includes(putOf('HZ_SEED_KEY')), false, 'the real seed key is never printed');
});

test('a rerun keeps the seed key already set; only a confirmed --new-account-key replaces it', async () => {
  const stored = (names = ['HZ_ACCOUNT_KEY', 'HZ_SEED_KEY', 'HZ_TICKET_KEY']) => mockWrangler({ dbPresent: true, existingSecrets: names });
  const putOf = (h, name) => h.wrangler.calls.find((c) => c.args[0] === 'secret' && c.args[1] === 'put' && c.args[2] === name);

  const keep = harness({ wrangler: stored() });
  const kept = await deploy(keep.deps);
  assert.equal(kept.ok, true, keep.output());
  assert.equal(putOf(keep, 'HZ_SEED_KEY'), undefined, 'the stored seed key is not replaced');
  assert.match(keep.output(), /Kept HZ_SEED_KEY \(already set; a new one would make every enrolled authenticator code unusable, --new-account-key replaces it\)/);
  assert.equal(statusOf(kept, 'Secret HZ_SEED_KEY'), 'PASS');

  const ticket = harness({ argv: ['--new-ticket-key'], replaceTicketKey: 'y', wrangler: stored() });
  assert.equal((await deploy(ticket.deps)).ok, true, ticket.output());
  assert.equal(putOf(ticket, 'HZ_SEED_KEY'), undefined, '--new-ticket-key leaves the seed key alone');

  const yes = harness({ argv: ['--new-account-key'], replaceKey: 'replace', wrangler: stored() });
  assert.equal((await deploy(yes.deps)).ok, true, yes.output());
  assert.equal(putOf(yes, 'HZ_SEED_KEY')?.input, GENERATED_SEED);
  assert.equal(putOf(yes, 'HZ_ACCOUNT_KEY')?.input, GENERATED);
  assert.match(yes.output(), /HZ_ACCOUNT_KEY and HZ_SEED_KEY/);
  assertNoSecretAnywhere(yes);

  const no = harness({ argv: ['--new-account-key'], replaceKey: 'n', wrangler: stored() });
  assert.equal((await deploy(no.deps)).ok, false);
  assert.equal(no.wrangler.calls.some((c) => c.args[0] === 'deploy' || (c.args[0] === 'secret' && c.args[1] === 'put')), false, 'refused: no deploy, no secret put');

  // A seed key set without an account key still needs the typed replace.
  const seedOnly = harness({ argv: ['--new-account-key'], replaceKey: 'n', wrangler: stored(['HZ_SEED_KEY']) });
  assert.equal((await deploy(seedOnly.deps)).ok, false);
  assert.ok(seedOnly.asked.some((a) => a.name === 'confirm-replace-key'), 'a stored seed key is confirmed before it is replaced');
  assert.equal(seedOnly.wrangler.calls.some((c) => c.args[0] === 'secret' && c.args[1] === 'put'), false);
});

// The ticket call unlock.js makes (ticketKey): a test drifts loudly if it changes.
const UNLOCK_IMPORT = 'crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])';

test('the generated ticket key is an ECDSA P-256 private JWK the service imports and signs with', async () => {
  assert.ok(readFileSync(path.join(ROOT, 'src', 'unlock.js'), 'utf8').includes(UNLOCK_IMPORT), 'unlock.js still imports the ticket key this way');
  const h = harness({ ticketKey: null });
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  const value = h.wrangler.calls.find((c) => c.args[0] === 'secret' && c.args[2] === 'HZ_TICKET_KEY')?.input;
  assert.equal(typeof value, 'string', 'HZ_TICKET_KEY is put through stdin');
  assert.notEqual(value, FIXED_TICKET_KEY, 'the script made its own key');
  const jwk = JSON.parse(value);
  assert.equal(jwk.kty, 'EC');
  assert.equal(jwk.crv, 'P-256');
  for (const part of ['x', 'y', 'd']) assert.match(jwk[part], /^[A-Za-z0-9_-]{43}$/, part);
  // As unlock.js does it: the same import, then a signature its public half verifies.
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const data = new TextEncoder().encode('horae-zone-unlock-ticket-v1.payload');
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
  const pub = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, sig, data));
  assert.match(h.output(), /Generated HZ_TICKET_KEY/);
  assertNoSecretAnywhere(h);
});

test('a wrangler failure echoing the ticket key or its private part prints neither', async () => {
  const w = mockWrangler();
  const base = w.run;
  const echo = `key ${FIXED_TICKET_KEY}\nd=${FIXED_TICKET_JWK.d}\n${JSON.stringify({ value: FIXED_TICKET_KEY })}`;
  w.run = async (args, opts) => (args[0] === 'deploy' ? (w.calls.push({ args, ...opts }), { code: 1, stdout: '', stderr: echo }) : base(args, opts));
  const h = harness({ wrangler: w });
  const result = await deploy(h.deps);
  assert.equal(result.ok, false);
  assert.match(h.output(), /wrangler deploy failed/);
  assert.equal(h.output().includes(FIXED_TICKET_JWK.d), false, 'the private part is masked');
  assert.equal(h.output().includes(JSON.stringify(FIXED_TICKET_KEY).slice(1, -1)), false, 'the JSON-escaped key is masked');
  assertNoSecretAnywhere(h);
});

test('a rerun keeps the ticket key already set, unless --new-ticket-key is given and confirmed with y', async () => {
  const stored = () => mockWrangler({ dbPresent: true, existingSecrets: ['HZ_ACCOUNT_KEY', 'HZ_TICKET_KEY'] });
  const putOf = (h, name) => h.wrangler.calls.find((c) => c.args[0] === 'secret' && c.args[1] === 'put' && c.args[2] === name);

  const keep = harness({ wrangler: stored() });
  const kept = await deploy(keep.deps);
  assert.equal(kept.ok, true, keep.output());
  assert.equal(putOf(keep, 'HZ_TICKET_KEY'), undefined, 'the stored ticket key is not replaced');
  assert.match(keep.output(), /Kept HZ_TICKET_KEY/);
  assert.equal(statusOf(kept, 'Secret HZ_TICKET_KEY'), 'PASS');
  assert.equal(keep.asked.some((a) => a.name === 'confirm-replace-ticket-key'), false);

  const yes = harness({ argv: ['--new-ticket-key'], replaceTicketKey: 'y', wrangler: stored() });
  const replaced = await deploy(yes.deps);
  assert.equal(replaced.ok, true, yes.output());
  const prompt = yes.asked.find((a) => a.name === 'confirm-replace-ticket-key');
  assert.ok(prompt, 'the replacement is confirmed through a prompt');
  assert.equal(prompt.hidden, false);
  assert.match(yes.output(), /every ticket already issued stops working/);
  assert.equal(putOf(yes, 'HZ_TICKET_KEY')?.input, FIXED_TICKET_KEY);
  assert.equal(putOf(yes, 'HZ_ACCOUNT_KEY'), undefined, '--new-ticket-key leaves the account key alone');
  const order = yes.wrangler.calls.map((c) => c.args.slice(0, 2).join(' '));
  assert.ok(order.indexOf('secret list') < order.indexOf('deploy --config'));
  assertNoSecretAnywhere(yes);

  for (const answer of ['', 'n', 'no', 'replace']) {
    const no = harness({ argv: ['--new-ticket-key'], replaceTicketKey: answer, wrangler: stored() });
    const result = await deploy(no.deps);
    assert.equal(result.ok, false, `answer ${JSON.stringify(answer)}`);
    assert.match(no.output(), /HZ_TICKET_KEY not replaced; the Worker and its secrets were not changed/, `answer ${JSON.stringify(answer)}`);
    assert.equal(no.wrangler.calls.some((c) => c.args[0] === 'deploy' || (c.args[0] === 'secret' && c.args[1] === 'put')), false, `answer ${JSON.stringify(answer)}: no deploy, no secret put`);
  }

  const first = harness({ argv: ['--new-ticket-key'], wrangler: mockWrangler({ dbPresent: true }) });
  const r = await deploy(first.deps);
  assert.equal(r.ok, true, first.output());
  assert.equal(first.asked.some((a) => a.name === 'confirm-replace-ticket-key'), false, 'a Worker never deployed has no ticket key to replace');
  assert.equal(putOf(first, 'HZ_TICKET_KEY')?.input, FIXED_TICKET_KEY);
});

test('a bad answer is asked again, and three bad answers stop the run before any write', async () => {
  const h = harness({ answers: { ...ANSWERS, HZ_LINK_BASE: 'http://example.test/?q=1' } });
  const result = await deploy(h.deps);
  assert.equal(result.ok, false);
  assert.equal(h.asked.filter((a) => a.name === 'HZ_LINK_BASE').length, 3);
  assert.equal(h.wrangler.calls.some((c) => c.args[1] === 'create' || c.args[0] === 'deploy' || c.args[0] === 'secret'), false);
});

test('the reopen link base is asked with a plain prompt, checked the way src/unlock.js checks it, and put through stdin', async () => {
  const h = harness();
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  const asked = h.asked.filter((a) => a.name === 'HZ_REOPEN_BASE');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].hidden, false);
  const put = h.wrangler.calls.find((c) => c.args[0] === 'secret' && c.args[2] === 'HZ_REOPEN_BASE');
  assert.ok(put, 'HZ_REOPEN_BASE is put');
  assert.equal(put.input, ANSWERS.HZ_REOPEN_BASE);
  assert.equal(put.args.includes(ANSWERS.HZ_REOPEN_BASE), false, 'the value is never in argv');
  // The script's check is unlock.js's own reopenBaseOk, so the two cannot drift.
  const entry = CATALOG.find((s) => s.name === 'HZ_REOPEN_BASE');
  assert.equal(entry?.check, reopenBaseOk);
  for (const bad of ['http://example.test/reopen', 'https://example.test/reopen?x=1', 'https://example.test/reopen#x', 'not a url', '']) {
    assert.equal(reopenBaseOk(bad), false, bad);
  }
  assert.equal(reopenBaseOk(ANSWERS.HZ_REOPEN_BASE), true);
});

test('a bad reopen link base is asked again, and three bad answers stop the run before any write', async () => {
  const h = harness({ answers: { ...ANSWERS, HZ_REOPEN_BASE: 'https://example.test/reopen?next=1' } });
  const result = await deploy(h.deps);
  assert.equal(result.ok, false);
  assert.equal(h.asked.filter((a) => a.name === 'HZ_REOPEN_BASE').length, 3);
  assert.ok(h.output().includes('Not accepted (https, no ? and no #)'));
  assert.equal(h.wrangler.calls.some((c) => c.args[1] === 'create' || c.args[0] === 'deploy' || c.args[0] === 'secret'), false);
});

test('the schema check expects every table schema.sql creates, A5 tables included', () => {
  assert.equal(TABLES.length, [...SCHEMA.matchAll(/\bCREATE\s+TABLE\b/gi)].length, 'schemaTables misses a CREATE TABLE');
  for (const t of ['device', 'ticket', 'otp', 'exchange', 'limits', 'pending_try']) assert.ok(TABLES.includes(t), t);
});

test('every environment name the service reads is handled by the deploy script', () => {
  const src = path.join(ROOT, 'src');
  const read = new Set();
  for (const f of readdirSync(src, { recursive: true }).filter((f) => /\.(m?js)$/.test(f))) {
    const text = readFileSync(path.join(src, f), 'utf8');
    // Only env.X and env?.X are scanned, so any other way of reading env fails here.
    assert.doesNotMatch(text, /\benv\??\.?\[|\}\s*=\s*env\b/, `${f} reads env some way other than env.NAME`);
    for (const m of text.matchAll(/\benv\??\.([A-Z][A-Z0-9_]*)/g)) read.add(m[1]);
  }
  read.delete('DB'); // the D1 binding, from the deploy config
  const handled = new Set(CATALOG.map((s) => s.name));
  for (const name of ['HZ_ACCOUNT_KEY', 'HZ_SEED_KEY', 'HZ_TICKET_KEY', 'HZ_REOPEN_BASE', 'HZ_LINK_BASE', 'RESEND_KEY']) assert.ok(read.has(name), `the scan finds ${name}`);
  for (const name of read) assert.ok(handled.has(name), `${name} is read by src/ but the deploy script does not set it`);
  for (const name of handled) assert.ok(read.has(name), `${name} is set by the deploy script but src/ never reads it`);
});

// DEPLOY.md by its "## " sections, each with its code spans taken out.
function deployDoc() {
  const text = readFileSync(path.join(ROOT, 'DEPLOY.md'), 'utf8');
  const sections = {};
  for (const part of text.split(/^## /m).slice(1)) {
    const [heading, ...body] = part.split('\n');
    sections[heading.trim()] = body.join('\n');
  }
  return { text, sections, plain: (name) => sections[name].replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '') };
}

test('DEPLOY.md names every value the script asks for, generates and puts', () => {
  const { text, sections } = deployDoc();
  const asks = sections['What it asks'];
  const does = sections['What it does'];
  assert.ok(asks && does, 'DEPLOY.md keeps its "What it asks" and "What it does" sections');
  for (const s of CATALOG.filter((s) => s.source === 'asked')) assert.ok(asks.includes(`\`${s.name}\``), `"What it asks" names \`${s.name}\``);
  for (const s of CATALOG.filter((s) => s.source === 'generated')) assert.ok(does.includes(`\`${s.name}\``), `"What it does" names the generated \`${s.name}\``);
  for (const name of SECRET_NAMES) assert.ok(does.includes(`\`${name}\``), `"What it does" names the secret \`${name}\``);
  assert.ok(does.includes('--new-ticket-key'), '"What it does" names --new-ticket-key');
  // A5 is built: its seed and ticket keys are their own secrets, not derived or to come.
  assert.doesNotMatch(text, /arrives with A5/);
  assert.doesNotMatch(text, /no separate[^.]*ticket key/);
  assert.match(sections['What to expect at the end'], new RegExp(`Schema applied\\s+${TABLES.length} tables present`));
});

test('every message DEPLOY.md quotes is one the script prints', async () => {
  const { plain } = deployDoc();
  const quoted = ['What it asks', 'What it does'].flatMap((s) => [...plain(s).matchAll(/"([^"\n]+)"/g)].map((m) => m[1]));
  assert.ok(quoted.length >= 4, `DEPLOY.md quotes the script (found ${quoted.length})`);
  const stored = (state = {}) => mockWrangler({ dbPresent: true, existingSecrets: ['HZ_ACCOUNT_KEY', 'HZ_SEED_KEY', 'HZ_TICKET_KEY'], ...state });
  const runs = [
    harness(),
    harness({ wrangler: stored() }),
    harness({ wrangler: mockWrangler({ workerExists: true }) }),
    harness({ wrangler: mockWrangler({ workerExists: true }), replaceWorker: 'n' }),
    harness({ wrangler: stored({ secretListOut: '{}' }) }),
    harness({ argv: ['--new-account-key'], replaceKey: 'n', wrangler: stored() }),
    harness({ argv: ['--new-ticket-key'], replaceTicketKey: 'n', wrangler: stored() }),
  ];
  for (const h of runs) await deploy(h.deps);
  const printed = runs.map((h) => h.output()).join('\n');
  for (const q of quoted) assert.ok(printed.includes(q), `DEPLOY.md quotes "${q}", which the script never prints`);
});

test('DEPLOY.md gives the skip rule the script prints, says when it is required, and names --check-only', async () => {
  const { sections, plain } = deployDoc();
  const byHand = sections['By hand, in the dashboard'];
  assert.ok(byHand, 'DEPLOY.md keeps its "By hand, in the dashboard" section');
  assertSkipRule(byHand);
  assert.match(byHand, /required when the zone runs Super Bot Fight Mode/);
  // Free Bot Fight Mode runs outside the Ruleset Engine, so no Skip rule reaches it.
  assert.match(byHand, /Bot Fight Mode[^.]*cannot be skipped/);
  assert.match(byHand, /turn Bot Fight Mode off/);
  assert.doesNotMatch(byHand, /managed rule or Bot Fight Mode|only if a managed rule/, 'the old D-22 wording is gone');
  assert.match(sections['The one command'], /node bin\/deploy\.mjs --check-only/);
  assert.match(byHand, /node bin\/deploy\.mjs --check-only/);

  // What the doc quotes from a challenged run and from --check-only, the script prints.
  const runs = [harness({ route: CHALLENGED, recheck: ['n'] }), checkOnly({ route: CHALLENGED }), checkOnly({ missingConfig: true })];
  for (const h of runs) await deploy(h.deps);
  const printed = runs.map((h) => h.output()).join('\n');
  const quoted = ['The one command', 'By hand, in the dashboard'].flatMap((s) => [...plain(s).matchAll(/"([^"\n]+)"/g)].map((m) => m[1]));
  assert.ok(quoted.length >= 3, `the skip rule and --check-only quote the script (found ${quoted.length})`);
  for (const q of quoted) assert.ok(printed.includes(q), `DEPLOY.md quotes "${q}", which the script never prints`);
});

test('the hidden prompt never echoes what is typed, and piped lines are read in turn', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let echoed = '';
  output.on('data', (d) => { echoed += d; });
  const reader = new LineReader(input, output);
  input.write('re_FAKE_hidden_value\nsecond line\n');
  const first = await reader.ask({ question: 'Resend API key: ', hidden: true });
  const second = await reader.ask({ question: 'Alert address: ', hidden: false });
  reader.close();
  assert.equal(first, 're_FAKE_hidden_value');
  assert.equal(second, 'second line');
  assert.match(echoed, /Resend API key: /);
  assert.equal(echoed.includes('re_FAKE_hidden_value'), false);
});

// A stand-in terminal: isTTY true, setRawMode records each call, and a fake
// process records the exit and SIGTERM listeners and any re-raised signal.
function fakeTerminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  const raw = [];
  input.isTTY = true;
  input.setRawMode = (on) => { raw.push(on); input.isRaw = on; };
  const proc = new EventEmitter();
  proc.pid = 4242;
  proc.killed = [];
  proc.kill = (pid, signal) => { proc.killed.push([pid, signal]); };
  return { input, output, raw, proc };
}

// Settles with the prompt's outcome, or 'still waiting' when a key that should
// have ended it left it open (the old reader appended Ctrl-D to the value).
const outcome = (promise) => Promise.race([
  promise.then((value) => ({ value }), (err) => ({ error: err.message })),
  new Promise((r) => setTimeout(() => r('still waiting'), 200)),
]);

test('Ctrl-C and Ctrl-D each cancel a hidden prompt and leave raw mode off', async () => {
  for (const key of ['\u0003', '\u0004']) {
    const { input, output, raw, proc } = fakeTerminal();
    const reader = new LineReader(input, output, proc);
    const asked = reader.ask({ question: 'Resend API key: ', hidden: true });
    input.write(`re_FAKE_partial${key}`);
    assert.deepEqual(await outcome(asked), { error: 'cancelled' }, `key ${JSON.stringify(key)} cancels`);
    assert.deepEqual(raw, [true, false], `key ${JSON.stringify(key)} ends raw mode false`);
    assert.equal(input.isRaw, false);
    assert.equal(reader.buffer, '', `key ${JSON.stringify(key)} drops the partly typed key`);
    reader.close();
  }
});

test('an arrow key or other ESC sequence does not change the hidden value', async () => {
  const { input, output, proc } = fakeTerminal();
  const reader = new LineReader(input, output, proc);
  const asked = reader.ask({ question: 'Resend API key: ', hidden: true });
  // Up, Left (CSI), Home (SS3), Delete (CSI ~), split across chunks, and a lone ESC + x.
  input.write('re_\u001b[A\u001b[DFAKE\u001bOH_');
  input.write('\u001b[');
  input.write('3~arrow\u001bx\r');
  assert.deepEqual(await outcome(asked), { value: 're_FAKE_arrow' });
  reader.close();
});

test('the terminal leaves raw mode when the process exits or gets SIGTERM mid-prompt', async () => {
  const exiting = fakeTerminal();
  const reader = new LineReader(exiting.input, exiting.output, exiting.proc);
  const asked = reader.ask({ question: 'Resend API key: ', hidden: true });
  assert.equal(exiting.proc.listenerCount('exit'), 1, 'an exit listener is set while raw');
  exiting.proc.emit('exit', 1);
  assert.deepEqual(exiting.raw, [true, false]);
  assert.equal((await outcome(asked)).error, 'cancelled');
  reader.close();

  const terminated = fakeTerminal();
  const second = new LineReader(terminated.input, terminated.output, terminated.proc);
  const pending = second.ask({ question: 'Resend API key: ', hidden: true });
  terminated.proc.emit('SIGTERM');
  assert.deepEqual(terminated.raw, [true, false]);
  assert.deepEqual(terminated.proc.killed, [[4242, 'SIGTERM']], 'SIGTERM is raised again so the process still ends');
  assert.equal((await outcome(pending)).error, 'cancelled');
  second.close();

  // A prompt that ends normally takes its listeners with it.
  const normal = fakeTerminal();
  const third = new LineReader(normal.input, normal.output, normal.proc);
  const done = third.ask({ question: 'Resend API key: ', hidden: true });
  normal.input.write('re_FAKE_value\r');
  assert.deepEqual(await outcome(done), { value: 're_FAKE_value' });
  assert.equal(normal.proc.listenerCount('exit'), 0);
  assert.equal(normal.proc.listenerCount('SIGTERM'), 0);
  third.close();
});

// Turnstile (design of 8 Oct 2026, section 2). The widget's two keys are
// asked in Step 2, after the clicks that make the widget; the site key is a
// public Worker var, the secret key a hidden prompt put on stdin.
test('Step 2 prints the widget clicks before the Turnstile prompts; the secret is hidden and put on stdin, the site key is a var', async () => {
  const h = harness();
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  const two = stepText(h.output(), 2);
  assert.match(two, /Add widget/);
  assert.match(two, /Hostname: horae-zone\.nooutco\.me \(this one only\)\. Widget Mode: Managed\. Pre-clearance: No/);
  assert.ok(h.asked.findIndex((a) => a.name === 'HZ_TURNSTILE_SITEKEY') >= 0);
  assert.equal(h.asked.find((a) => a.name === 'HZ_TURNSTILE_SECRET').hidden, true);
  assert.equal(h.asked.find((a) => a.name === 'HZ_TURNSTILE_SITEKEY').hidden, false);
  assert.equal(h.wrangler.calls.find((c) => c.args[0] === 'secret' && c.args[2] === 'HZ_TURNSTILE_SECRET').input, ANSWERS.HZ_TURNSTILE_SECRET);
  assert.equal(h.wrangler.calls.some((c) => c.args[0] === 'secret' && c.args[2] === 'HZ_TURNSTILE_SITEKEY'), false, 'the site key is not a secret');
  const config = [...h.files.values()][0];
  assert.match(config, new RegExp(`^HZ_TURNSTILE_SITEKEY = "${ANSWERS.HZ_TURNSTILE_SITEKEY}"$`, 'm'));
  assert.equal(statusOf(result, 'Turnstile site key'), 'PASS');
  assert.equal(statusOf(result, 'Secret HZ_TURNSTILE_SECRET'), 'PASS');
  assertNoSecretAnywhere(h);
});

test('Cloudflare\'s Turnstile test keys are refused at the prompt, and three of them stop the run before any write', async () => {
  for (const [name, testKey] of [['HZ_TURNSTILE_SECRET', '1x0000000000000000000000000000000AA'], ['HZ_TURNSTILE_SITEKEY', '1x00000000000000000000AA'], ['HZ_TURNSTILE_SECRET', '2x0000000000000000000000000000000AA'], ['HZ_TURNSTILE_SITEKEY', '3x00000000000000000000FF']]) {
    const h = harness({ answers: { ...ANSWERS, [name]: testKey } });
    const result = await deploy(h.deps);
    assert.equal(result.ok, false, `${name} ${testKey}`);
    assert.equal(h.asked.filter((a) => a.name === name).length, 3);
    assert.match(h.output(), /Not accepted \(a production key from the Turnstile page \(starts 0x; Cloudflare's 1x, 2x and 3x test keys are refused\)\)/);
    assert.equal(h.wrangler.calls.some((c) => c.args[1] === 'create' || c.args[0] === 'deploy' || c.args[0] === 'secret'), false);
  }
  assert.equal(CATALOG.find((s) => s.name === 'HZ_TURNSTILE_SECRET').check(ANSWERS.HZ_TURNSTILE_SECRET), true, 'NEGATIVE CONTROL: a production-shaped key passes');
});

test('--check-only fails the site key item when wrangler.deploy.toml has no HZ_TURNSTILE_SITEKEY, and passes it when it does', async () => {
  const missing = checkOnly({ sitekey: null });
  const r1 = await deploy(missing.deps);
  assert.equal(statusOf(r1, 'Turnstile site key'), 'FAIL');
  assert.match(r1.checklist.find((i) => i.item.startsWith('Turnstile site key')).detail, /not-configured/);
  const testKey = checkOnly({ sitekey: '1x00000000000000000000AA' });
  assert.equal(statusOf(await deploy(testKey.deps), 'Turnstile site key'), 'FAIL', 'a test site key is not a production one');
  const present = checkOnly();
  assert.equal(statusOf(await deploy(present.deps), 'Turnstile site key'), 'PASS', 'NEGATIVE CONTROL');
});

test('Step 4 says Turnstile is wired and the rate rule (2 per 10 seconds) is the backstop', async () => {
  const h = harness();
  await deploy(h.deps);
  const four = stepText(h.output(), 4);
  assert.match(four, /2 requests per 10 seconds/);
  assert.match(four, /Turnstile is wired in/);
  assert.match(four, /backstop/);
  assert.doesNotMatch(four, /Turnstile is not wired/);
});
