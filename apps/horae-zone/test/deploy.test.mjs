// The deploy script (bin/deploy.mjs, plan §4) against a mocked wrangler: no
// test calls Cloudflare, sends mail or writes outside a temp folder. Every
// secret value is a fixed fake, and each test checks it never reaches the
// output, a command line, a child's environment or a written file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { deploy } from '../bin/deploy.mjs';
import { CATALOG, LineReader, deployConfig, scrub, HOSTNAME } from '../bin/deploy-parts.mjs';
import { accountKeys } from '../src/account-keys.js';

const FAKE_DB_ID = '11111111-2222-3333-4444-555555555555';
const FAKE_ACCOUNT = { id: 'acc0000000000000000000000000fake', name: 'Example Test Account' };
// 32 fixed bytes stand in for crypto randomness, so the generated key is known.
const FIXED_BYTES = Buffer.alloc(32, 0x5a);
const GENERATED = FIXED_BYTES.toString('base64url');
const ANSWERS = {
  RESEND_KEY: 're_FAKE_resend_key_7d1c',
  HZ_MAIL_FROM: 'Horae Zone <mail@example.test>',
  HZ_ALERT_TO: 'alerts@example.test',
  HZ_LINK_BASE: 'https://example.test/signup',
  HZ_CODES_PER_DAY: '',
};
const SECRET_VALUES = [GENERATED, ANSWERS.RESEND_KEY, ANSWERS.HZ_MAIL_FROM, ANSWERS.HZ_ALERT_TO];
const TABLES = ['device', 'nonce', 'role', 'audit', 'account', 'challenge', 'throttle', 'ticket'];
const SECRET_NAMES = ['HZ_ACCOUNT_KEY', 'RESEND_KEY', 'HZ_MAIL_FROM', 'HZ_ALERT_TO', 'HZ_LINK_BASE'];

// A wrangler stand-in. `state` decides what each command answers; every call
// is recorded with its args, stdin, cwd and env.
function mockWrangler(state = {}) {
  const calls = [];
  const db = { present: state.dbPresent ?? false };
  const secretsSet = new Set(state.existingSecrets ?? []);
  // As wrangler 4 does: a Worker that was never deployed has no secret list.
  let deployed = state.workerExists ?? secretsSet.size > 0;
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  async function run(args, opts = {}) {
    calls.push({ args, input: opts.input, cwd: opts.cwd, env: opts.env });
    const cmd = args.slice(0, 2).join(' ');
    if (cmd === 'whoami --json') return ok(JSON.stringify({ loggedIn: true, email: 'owner@example.test', accounts: state.accounts ?? [FAKE_ACCOUNT] }));
    if (cmd === 'd1 list') return ok(JSON.stringify(db.present ? [{ uuid: FAKE_DB_ID, name: 'horae-zone' }, { uuid: 'x', name: 'other' }] : [{ uuid: 'x', name: 'other' }]));
    if (cmd === 'd1 create') { db.present = true; return ok(`database_id = "${FAKE_DB_ID}"`); }
    if (cmd === 'd1 execute' && args.includes('--file')) return ok('[{"success":true}]');
    if (cmd === 'd1 execute') return ok(JSON.stringify([{ results: (state.tables ?? TABLES).map((name) => ({ name })), success: true }]));
    if (cmd === 'deploy --config') deployed = true;
    if (cmd === 'deploy --config') return ok(state.deployOut ?? `Uploaded horae-zone\nDeployed horae-zone triggers\n  ${HOSTNAME} (custom domain)\n  schedule: 0 * * * *\nCurrent Version ID: v1`);
    if (cmd === 'secret put') { secretsSet.add(args[2]); return ok(`Success! Uploaded secret ${args[2]}`); }
    if (cmd === 'secret list' && state.secretListFail) return { code: 1, stdout: '', stderr: state.secretListFail };
    if (cmd === 'secret list' && !deployed) return { code: 1, stdout: '', stderr: '✘ [ERROR] Worker "horae-zone" not found.\n\nIf this is a new Worker, run `wrangler deploy` first to create it.' };
    if (cmd === 'secret list') return ok(state.secretListOut ?? JSON.stringify([...secretsSet].filter((n) => n !== state.dropSecret).map((name) => ({ name, type: 'secret_text' }))));
    return { code: 1, stdout: '', stderr: `mock: unknown command ${args.join(' ')}` };
  }
  return { run, calls };
}

function harness({ wrangler = mockWrangler(), argv = [], answers = ANSWERS, confirm = 'y', edge = 'y', replaceKey, route ={ status: 405, body: '{"error":"method"}', ray: true } } = {}) {
  const lines = [];
  const files = new Map();
  const fetched = [];
  const asked = [];
  const ask = async ({ question, hidden, name }) => {
    asked.push({ question, hidden, name });
    if (name === 'confirm-account') return confirm;
    if (name === 'confirm-edge') return edge;
    if (name === 'confirm-replace-key' && replaceKey !== undefined) return replaceKey;
    if (name in answers) return answers[name];
    throw new Error(`unexpected prompt ${name}`);
  };
  const deps = {
    argv,
    root: ROOT,
    run: wrangler.run,
    ask,
    write: (text) => lines.push(text),
    randomBytes: (n) => { assert.equal(n, 32); return Buffer.from(FIXED_BYTES); },
    writeFile: (file, text) => files.set(file, text),
    makeTempDir: () => '/tmp/hz-deploy-test-empty',
    removeDir: () => {},
    sleep: async () => {},
    fetchImpl: async (url, init) => {
      fetched.push({ url, init });
      return new Response(route.body, { status: route.status, headers: route.ray ? { 'cf-ray': 'abc-EWR' } : {} });
    },
  };
  return { deps, lines, files, fetched, asked, wrangler, output: () => lines.join('\n') };
}

function assertNoSecretAnywhere(h) {
  const out = h.output();
  for (const v of SECRET_VALUES) {
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
  for (const cmd of ['wrangler whoami --json', 'wrangler d1 list --json', 'wrangler d1 create horae-zone',
    'wrangler d1 execute horae-zone --remote --yes --file schema.sql --config wrangler.deploy.toml',
    'wrangler deploy --config wrangler.deploy.toml', 'wrangler secret list --format json --config wrangler.deploy.toml']) {
    assert.ok(out.includes(cmd), `dry run lists: ${cmd}`);
  }
  for (const name of SECRET_NAMES) assert.match(out, new RegExp(`wrangler secret put ${name} --config wrangler\\.deploy\\.toml\\s+< stdin: \\[masked\\]`));
  assert.match(out, /GET https:\/\/horae-zone\.nooutco\.me\/account/);
  assert.match(out, /WAF|rate limiting rule/i);
  assert.match(out, /A5c/);
});

test('a full run against mocked wrangler creates the database, sets every secret through stdin and passes the checklist', async () => {
  const h = harness();
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  const order = h.wrangler.calls.map((c) => c.args.slice(0, 2).join(' '));
  assert.deepEqual(order.slice(0, 5), ['whoami --json', 'd1 list', 'd1 create', 'd1 list', 'd1 execute']);
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
  assert.equal(h.wrangler.calls.find((c) => c.args[2] === 'RESEND_KEY').input, ANSWERS.RESEND_KEY);
  assert.equal(h.asked.find((a) => a.name === 'RESEND_KEY').hidden, true);
  assert.equal(h.asked.find((a) => a.name === 'HZ_ALERT_TO').hidden, false);
  assert.ok(h.wrangler.calls.slice(1).every((c) => c.env?.CLOUDFLARE_ACCOUNT_ID === FAKE_ACCOUNT.id), 'every call after whoami is pinned to the confirmed account');
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

test('declining the account stops before anything is created or deployed', async () => {
  const h = harness({ confirm: 'n' });
  const result = await deploy(h.deps);
  assert.equal(result.ok, false);
  assert.deepEqual(h.wrangler.calls.map((c) => c.args.slice(0, 2).join(' ')), ['whoami --json']);
  assert.equal(h.files.size, 0);
});

test('with several accounts, the one picked is the one every call is pinned to', async () => {
  const second = { id: 'acc1111111111111111111111111fake', name: 'Second Test Account' };
  const h = harness({ wrangler: mockWrangler({ accounts: [FAKE_ACCOUNT, second] }), confirm: '2' });
  const result = await deploy(h.deps);
  assert.equal(result.ok, true, h.output());
  assert.ok(h.wrangler.calls.slice(1).every((c) => c.env?.CLOUDFLARE_ACCOUNT_ID === second.id));
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

  const r4 = await deploy(harness({ wrangler: mockWrangler({ tables: TABLES.filter((t) => t !== 'ticket') }) }).deps);
  assert.equal(statusOf(r4, 'Schema applied'), 'FAIL');

  const r5 = await deploy(harness({ route: { status: 405, body: '{"error":"method"}', ray: false } }).deps);
  assert.equal(statusOf(r5, 'Route answers'), 'FAIL', 'an answer without cf-ray did not come through the Cloudflare edge');

  const r6 = await deploy(harness({ edge: 'n' }).deps);
  assert.equal(statusOf(r6, 'Edge rule'), 'FAIL');
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
    assert.match(h.output(), /could not read the secret list; nothing was changed; rerun, or pass --new-account-key if you mean to replace it/, shape);
    assert.equal(h.wrangler.calls.some((c) => c.args[0] === 'deploy'), false, `${shape}: no deploy`);
    assert.equal(h.wrangler.calls.some((c) => c.args[0] === 'secret' && c.args[1] === 'put'), false, `${shape}: no secret put`);
    assertNoSecretAnywhere(h);
  }
});

test('a failed secret list read stops before deploy; only "Worker not found" reads as no secrets yet', async () => {
  const h = harness({ wrangler: mockWrangler({ dbPresent: true, existingSecrets: ['HZ_ACCOUNT_KEY'], secretListFail: '✘ [ERROR] A request to the Cloudflare API failed. Authentication error [code: 10000]' }) });
  const result = await deploy(h.deps);
  assert.equal(result.ok, false);
  assert.match(h.output(), /could not read the secret list; nothing was changed/);
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
    assert.match(no.output(), /HZ_ACCOUNT_KEY not replaced; nothing was changed/, `answer ${JSON.stringify(answer)}`);
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

test('the generated account key is 32 random bytes, base64url, and the service accepts it', async () => {
  const h = harness();
  await deploy(h.deps);
  const key = h.wrangler.calls.find((c) => c.args[2] === 'HZ_ACCOUNT_KEY').input;
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(await accountKeys({ HZ_ACCOUNT_KEY: key }));
});

test('a bad answer is asked again, and three bad answers stop the run before any write', async () => {
  const h = harness({ answers: { ...ANSWERS, HZ_LINK_BASE: 'http://example.test/?q=1' } });
  const result = await deploy(h.deps);
  assert.equal(result.ok, false);
  assert.equal(h.asked.filter((a) => a.name === 'HZ_LINK_BASE').length, 3);
  assert.equal(h.wrangler.calls.some((c) => c.args[1] === 'create' || c.args[0] === 'deploy' || c.args[0] === 'secret'), false);
});

test('every environment name the service reads is handled by the deploy script', () => {
  const src = path.join(ROOT, 'src');
  const read = new Set();
  for (const f of readdirSync(src)) {
    for (const m of readFileSync(path.join(src, f), 'utf8').matchAll(/\benv\??\.([A-Z][A-Z0-9_]*)/g)) read.add(m[1]);
  }
  read.delete('DB'); // the D1 binding, from the deploy config
  const handled = new Set(CATALOG.map((s) => s.name));
  assert.ok(read.size >= 6);
  for (const name of read) assert.ok(handled.has(name), `${name} is read by src/ but the deploy script does not set it`);
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
