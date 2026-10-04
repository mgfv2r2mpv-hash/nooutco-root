#!/usr/bin/env node
/**
 * Horae Zone deploy (plan: sass-assistant docs/ios-plan.md §4). One command,
 * run by the owner from apps/horae-zone:
 *
 *   node bin/deploy.mjs             deploy, with prompts
 *   node bin/deploy.mjs --dry-run   print every step and command; nothing is
 *                                   run, asked, written or fetched
 *   --new-account-key               replace an HZ_ACCOUNT_KEY already set (every
 *                                   stored account becomes unreadable)
 *
 * Steps: confirm the Cloudflare account; ask the values only the owner has
 * (the Resend key on a hidden prompt); create or find the D1 database, write
 * the gitignored wrangler.deploy.toml and apply schema.sql (idempotent); show
 * the edge rule clicks; deploy; put each secret through stdin; check
 * everything and print a PASS/FAIL checklist.
 *
 * A secret value is never on a command line, in a child's environment, in a
 * file or in the output: every printed line passes through scrub(), and a
 * check whose output carries a value fails (test/deploy.test.mjs).
 *
 * Why a generated config file rather than --var or flags: the database id
 * has to sit in the [[d1_databases]] block, which no wrangler flag sets, and
 * the route must not appear in the committed wrangler.toml before the first
 * deploy (test/config.test.mjs). wrangler.deploy.toml holds the id, the route
 * and the plain variables, never a secret, and is gitignored.
 */
import { spawn } from "node:child_process";
import { randomBytes as nodeRandomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROUTES } from "../src/routes.js";
import {
  CATALOG, SECRET_NAMES, DATABASE, HOSTNAME, DEPLOY_CONFIG, CRON, ACCOUNT_KEY_BYTES,
  LineReader, deployConfig, scrub, parseJson, findDatabaseId, schemaTables, renderChecklist,
} from "./deploy-parts.mjs";

const ROUTE_TRIES = 6;
const ROUTE_WAIT_MS = 10_000;
const ANSWER_TRIES = 3;
const TAIL_LINES = 15;

export const COMMANDS = Object.freeze({
  whoami: ["whoami", "--json"],
  d1List: ["d1", "list", "--json"],
  d1Create: ["d1", "create", DATABASE],
  applySchema: ["d1", "execute", DATABASE, "--remote", "--yes", "--file", "schema.sql", "--config", DEPLOY_CONFIG],
  deploy: ["deploy", "--config", DEPLOY_CONFIG],
  secretPut: (name) => ["secret", "put", name, "--config", DEPLOY_CONFIG],
  secretList: ["secret", "list", "--format", "json", "--config", DEPLOY_CONFIG],
  tables: ["d1", "execute", DATABASE, "--remote", "--json", "--command", "SELECT name FROM sqlite_master WHERE type='table'", "--config", DEPLOY_CONFIG],
});

// The command words before the first flag, e.g. "secret put RESEND_KEY".
const labelOf = (args) => {
  const flag = args.findIndex((a) => a.startsWith("-"));
  return flag === -1 ? args : args.slice(0, flag);
};
const show = (args) => `wrangler ${args.map((a) => (/[\s'*]/.test(a) ? `"${a}"` : a)).join(" ")}`;

const ADMIN_BUILT = Object.entries(ROUTES).some(([p, r]) => p.startsWith("/admin/") && typeof r.handler === "function");
const ADMIN_NOTE = "A5c (admin) is not built: the /admin routes answer not-built, and the owner has no account until sign-up through this Worker. This step adds the owner's admin role once A5c lands.";

const EDGE_STEPS = [
  "Cloudflare steps this script cannot do safely (dashboard, account confirmed above):",
  "  1. Rate rule on sign-up and sign-in (required at the first deploy, DESIGN-REVIEW A3 item 13):",
  `     dash.cloudflare.com > the nooutco.me zone > Security > Security rules > Create rule > Rate limiting rule`,
  `     (older dashboards: Security > WAF > Rate limiting rules > Create rule).`,
  `     Rule name: horae-zone sign-up and sign-in. Click "Edit expression" and paste:`,
  `       (http.host eq "${HOSTNAME}" and http.request.method eq "POST" and http.request.uri.path in {"/account" "/signin"})`,
  `     With the same characteristics: IP. When rate exceeds: 10 requests per 1 minute (or the shortest period`,
  `     the plan offers, with the count scaled down). Then take action: Block, for 10 minutes (or the plan's longest). Deploy.`,
  "     (Turnstile is not wired into the service, so the rate rule is the edge rule to add.)",
  "  2. Hostname proxied, so cf-connecting-ip comes from the Cloudflare edge and cannot be set by a caller:",
  `     Workers & Pages > horae-zone > Settings > Domains & Routes: ${HOSTNAME} listed as a Custom domain.`,
  `     DNS > Records: the horae-zone row shows Proxy status "Proxied" (orange cloud). A Custom domain is always proxied;`,
  "     the checklist also looks for the cf-ray header on the route's answer.",
  "  3. Only if a managed rule or Bot Fight Mode challenges the app's calls (D-22): Security > Security rules > Create rule >",
  `     Custom rule, expression (http.host eq "${HOSTNAME}"), action Skip, tick the managed rules and Super Bot Fight Mode.`,
];

class Stop extends Error {}

function makeContext(deps) {
  const known = [];
  const checklist = [];
  const ctx = {
    known,
    checklist,
    env: {},
    say: (text) => deps.write(scrub(text, known).text),
    item: (item, status, detail) => checklist.push({ item, status, detail }),
  };
  ctx.wrangler = async (args, { input, cwd } = {}) => {
    const res = await deps.run(args, { input, cwd: cwd ?? deps.root, env: { ...ctx.env } });
    if (res.code !== 0) {
      const tail = `${res.stderr ?? ""}\n${res.stdout ?? ""}`.trim().split("\n").slice(-TAIL_LINES).join("\n");
      throw new Stop(`${show(labelOf(args))} failed (exit ${res.code}):\n${scrub(tail, known).text}`);
    }
    return String(res.stdout ?? "");
  };
  // A check's own output: masked before use, and a value in it fails the check.
  ctx.checked = (label, text) => {
    const { text: clean, leaked } = scrub(text, known);
    if (leaked) ctx.item(`Output of ${label}`, "FAIL", "carried a secret value (masked here, never printed)");
    return clean;
  };
  return ctx;
}

async function confirmAccount(ctx, deps) {
  ctx.say("Step 1. Cloudflare account");
  let who;
  try {
    who = parseJson(await ctx.wrangler(COMMANDS.whoami));
  } catch (err) {
    throw new Stop(err instanceof Stop ? `Not logged in to Cloudflare: run "wrangler login", then this command again.\n${err.message}` : `wrangler whoami gave no account list (${err.message}).`);
  }
  const accounts = Array.isArray(who?.accounts) ? who.accounts.filter((a) => a && a.id && a.name) : [];
  if (who?.loggedIn === false || accounts.length === 0) throw new Stop('Not logged in to Cloudflare: run "wrangler login", then this command again.');
  let chosen = null;
  if (accounts.length === 1) {
    ctx.say(`  Logged in to: ${accounts[0].name}`);
    const yes = (await deps.ask({ name: "confirm-account", question: "  Deploy Horae Zone to this account? Type y to go on: ", hidden: false })).trim().toLowerCase();
    if (yes === "y" || yes === "yes") chosen = accounts[0];
  } else {
    accounts.forEach((a, i) => ctx.say(`  ${i + 1}) ${a.name}`));
    const pick = (await deps.ask({ name: "confirm-account", question: "  Number of the account to deploy to (blank stops): ", hidden: false })).trim();
    if (/^\d+$/.test(pick) && Number(pick) >= 1 && Number(pick) <= accounts.length) chosen = accounts[Number(pick) - 1];
  }
  if (!chosen) throw new Stop("Account not confirmed. Nothing was created.");
  ctx.env.CLOUDFLARE_ACCOUNT_ID = chosen.id;
  ctx.item("Cloudflare account", "PASS", `${chosen.name} (confirmed by you)`);
}

async function collectAnswers(ctx, deps) {
  ctx.say("Step 2. Values only you have (typed answers are kept in memory only)");
  const values = {};
  for (const entry of CATALOG.filter((s) => s.source === "asked")) {
    let value = null;
    for (let i = 0; i < ANSWER_TRIES && value === null; i++) {
      const answer = (await deps.ask({ name: entry.name, question: `  ${entry.label}${entry.hidden ? " (hidden)" : ""}: `, hidden: entry.hidden === true })).trim();
      if (answer === "" && entry.optional) {
        value = "";
      } else if (entry.check(answer)) {
        value = answer;
      } else {
        ctx.say(`  Not accepted (${entry.rule}).`);
      }
    }
    if (value === null) throw new Stop(`No acceptable answer for ${entry.name} after ${ANSWER_TRIES} tries. Nothing was created.`);
    if (value !== "") values[entry.name] = value;
    if (entry.sensitive && value) ctx.known.push(value);
  }
  const bytes = deps.randomBytes(ACCOUNT_KEY_BYTES);
  values.HZ_ACCOUNT_KEY = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64url");
  bytes.fill(0);
  ctx.known.push(values.HZ_ACCOUNT_KEY);
  ctx.say(`  Generated HZ_ACCOUNT_KEY (${ACCOUNT_KEY_BYTES} random bytes). It is never shown or saved; a rerun makes a new one.`);
  return values;
}

async function prepareDatabase(ctx, deps, values) {
  ctx.say(`Step 3. D1 database "${DATABASE}"`);
  let id = findDatabaseId(parseJson(await ctx.wrangler(COMMANDS.d1List)));
  const found = id !== null;
  if (!found) {
    // An empty folder, so wrangler finds no config to add the id to.
    const empty = deps.makeTempDir();
    try {
      await ctx.wrangler(COMMANDS.d1Create, { cwd: empty });
    } finally {
      deps.removeDir(empty);
    }
    id = findDatabaseId(parseJson(await ctx.wrangler(COMMANDS.d1List)));
    if (id === null) throw new Stop(`"${DATABASE}" was created but is not in the database list yet. Run this command again.`);
  }
  ctx.say(`  ${found ? "Found" : "Created"} "${DATABASE}".`);
  const vars = Object.fromEntries(CATALOG.filter((s) => s.store === "var" && values[s.name]).map((s) => [s.name, values[s.name]]));
  const toml = deps.readFile(path.join(deps.root, "wrangler.toml"));
  deps.writeFile(path.join(deps.root, DEPLOY_CONFIG), deployConfig(toml, { databaseId: id, vars }));
  ctx.say(`  Wrote ${DEPLOY_CONFIG} (gitignored): database id, route ${HOSTNAME}, no secret.`);
  await ctx.wrangler(COMMANDS.applySchema);
  ctx.say("  Applied schema.sql (every statement is IF NOT EXISTS).");
  ctx.item("Database present", "PASS", found ? "found" : "created");
}

async function edgeRule(ctx, deps) {
  ctx.say("Step 4. Edge rule, before the route goes live");
  for (const line of EDGE_STEPS) ctx.say(line);
  const yes = (await deps.ask({ name: "confirm-edge", question: "  Is the rate rule (1) in place? Type y once it is, n to go on without it: ", hidden: false })).trim().toLowerCase();
  return yes === "y" || yes === "yes";
}

const UNREADABLE_SECRETS = "could not read the secret list; nothing was changed; rerun, or pass --new-account-key if you mean to replace it";
// wrangler 4's words for a Worker never deployed (wrangler-dist secret list).
const WORKER_NOT_FOUND = /Worker "horae-zone"[^\n]* not found/;

// The names of the Worker's secrets (never values: wrangler lists names).
// Anything but an array of entries with a string name throws: read as "no
// secrets", it would let a rerun replace HZ_ACCOUNT_KEY.
async function secretNames(ctx, label) {
  const list = parseJson(ctx.checked(label, await ctx.wrangler(COMMANDS.secretList)));
  if (!Array.isArray(list) || !list.every((s) => typeof s?.name === "string")) throw new Error(`${label} is not an array of named entries`);
  return new Set(list.map((s) => s.name));
}

// Before the deploy, so an unreadable list stops the run with the Worker
// untouched. Only wrangler's "not found" means no Worker and so no secrets.
async function secretsBeforeDeploy(ctx, newAccountKey) {
  try {
    return await secretNames(ctx, "the secret list");
  } catch (err) {
    if (WORKER_NOT_FOUND.test(err.message)) return new Set();
    if (newAccountKey) return null;
    throw new Stop(`${UNREADABLE_SECRETS}\n${err.message}`);
  }
}

// A new HZ_ACCOUNT_KEY makes every stored account unreadable, so a rerun
// keeps the one already set unless --new-account-key says otherwise.
async function deployWorker(ctx, values, newAccountKey) {
  ctx.say("Step 5. Deploy the Worker, then put each secret");
  const existing = await secretsBeforeDeploy(ctx, newAccountKey);
  const keep = !newAccountKey && existing.has("HZ_ACCOUNT_KEY");
  const out = await ctx.wrangler(COMMANDS.deploy);
  ctx.item("Worker deployed", "PASS", `horae-zone, route ${HOSTNAME} (Custom domain)`);
  for (const name of SECRET_NAMES) {
    if (name === "HZ_ACCOUNT_KEY" && keep) {
      ctx.say("  Kept HZ_ACCOUNT_KEY (already set; a new one would make every stored account unreadable, --new-account-key replaces it).");
      continue;
    }
    await ctx.wrangler(COMMANDS.secretPut(name), { input: values[name] });
    ctx.say(`  Set ${name}.`);
  }
  return out;
}

function adminStep(ctx) {
  ctx.say("Step 6. Owner as administrator");
  ctx.say(`  SKIPPED. ${ADMIN_NOTE}`);
  ctx.item("Owner as administrator", ADMIN_BUILT ? "FAIL" : "SKIPPED", ADMIN_BUILT ? "A5c is built but this script does not set the role yet" : "A5c not built (see step 6)");
}

async function checkRoute(ctx, deps) {
  const url = `https://${HOSTNAME}/account`;
  let last = "no answer";
  for (let i = 0; i < ROUTE_TRIES; i++) {
    if (i > 0) await deps.sleep(ROUTE_WAIT_MS);
    try {
      const res = await deps.fetchImpl(url, { method: "GET", redirect: "manual" });
      const body = ctx.checked("the route check", await res.text());
      let error = null;
      try {
        error = JSON.parse(body)?.error ?? null;
      } catch {
        error = null;
      }
      const edge = res.headers.has("cf-ray");
      if (res.status === 405 && error === "method" && edge) return ctx.item("Route answers", "PASS", "GET /account refused as method (405) through the Cloudflare edge");
      last = `GET /account answered ${res.status}${error ? ` ${error}` : ""}${edge ? "" : ", with no cf-ray header (not through the Cloudflare edge)"}`;
      if (res.status < 500) break;
    } catch (err) {
      last = `GET /account failed: ${ctx.checked("the route check", err?.message ?? "error")}`;
    }
  }
  ctx.item("Route answers", "FAIL", `${last}; expected 405 method through the edge`);
}

async function runChecks(ctx, deps, deployOut, edgeConfirmed) {
  ctx.say("Step 7. Checks");
  const expected = schemaTables(deps.readFile(path.join(deps.root, "schema.sql")));
  try {
    const rows = parseJson(ctx.checked("the schema check", await ctx.wrangler(COMMANDS.tables)));
    const have = new Set((rows?.[0]?.results ?? []).map((r) => r.name));
    const missing = expected.filter((t) => !have.has(t));
    ctx.item("Schema applied", missing.length ? "FAIL" : "PASS", missing.length ? `missing table(s): ${missing.join(", ")}` : `${expected.length} tables present`);
  } catch (err) {
    ctx.item("Schema applied", "FAIL", err.message.split("\n")[0]);
  }
  try {
    const names = await secretNames(ctx, "the secret check");
    for (const name of SECRET_NAMES) ctx.item(`Secret ${name}`, names.has(name) ? "PASS" : "FAIL", names.has(name) ? "set (name only)" : "not in the Worker's secret list");
  } catch (err) {
    ctx.item("Secrets", "FAIL", err.message.split("\n")[0]);
  }
  const cronSeen = new RegExp(`schedule:\\s*${CRON.replace(/\*/g, "\\*")}`).test(ctx.checked("the deploy", deployOut));
  ctx.item("Cron trigger", cronSeen ? "PASS" : "FAIL", cronSeen ? `${CRON} (hourly purge)` : `no "schedule: ${CRON}" in the deploy output; check Triggers in the dashboard`);
  await checkRoute(ctx, deps);
  ctx.item("Edge rule on /account and /signin", edgeConfirmed ? "PASS" : "FAIL", edgeConfirmed ? "confirmed by you" : "required at the first deploy: add it (step 4, item 1)");
}

function dryRun(deps) {
  const say = deps.write;
  const put = (name) => `${show(COMMANDS.secretPut(name))}   < stdin: [masked]`;
  [
    "DRY RUN: nothing is run, asked, written or fetched. Secret values are shown as [masked].",
    "Step 1. Cloudflare account",
    `  ${show(COMMANDS.whoami)}   then: confirm the account name (prompt)`,
    "Step 2. Values only you have",
    ...CATALOG.filter((s) => s.source === "asked").map((s) => `  prompt${s.hidden ? " (hidden)" : ""}: ${s.label} -> ${s.name}${s.store === "var" ? ` ([vars] in ${DEPLOY_CONFIG} when answered)` : ""}`),
    `  generate: HZ_ACCOUNT_KEY = [masked] (${ACCOUNT_KEY_BYTES} random bytes, base64url)`,
    `Step 3. D1 database "${DATABASE}"`,
    `  ${show(COMMANDS.d1List)}`,
    `  ${show(COMMANDS.d1Create)}   (only when missing, from an empty temp folder)`,
    `  write ${DEPLOY_CONFIG} (gitignored): wrangler.toml + database id + route ${HOSTNAME} as a Custom domain`,
    `  ${show(COMMANDS.applySchema)}`,
    "Step 4. Edge rule, before the route goes live",
    ...EDGE_STEPS.map((l) => `  ${l}`),
    "  prompt: is the rate rule in place?",
    "Step 5. Deploy the Worker, then put each secret",
    `  ${show(COMMANDS.secretList)}   (an HZ_ACCOUNT_KEY already set is kept unless --new-account-key; an unreadable list stops here)`,
    `  ${show(COMMANDS.deploy)}`,
    ...SECRET_NAMES.map((n) => `  ${put(n)}`),
    "Step 6. Owner as administrator",
    `  ${ADMIN_BUILT ? "set the owner's admin role" : `SKIPPED. ${ADMIN_NOTE}`}`,
    "Step 7. Checks, then the PASS/FAIL checklist",
    `  ${show(COMMANDS.tables)}`,
    `  ${show(COMMANDS.secretList)}`,
    `  cron: "schedule: ${CRON}" in the deploy output`,
    `  GET https://${HOSTNAME}/account   expect 405 method with a cf-ray header`,
  ].forEach((l) => say(l));
  return { ok: true, dryRun: true, checklist: [] };
}

export async function deploy(deps) {
  const argv = deps.argv ?? [];
  if (argv.includes("--help")) {
    deps.write("Usage: node bin/deploy.mjs [--dry-run] [--new-account-key]   (from apps/horae-zone; see DEPLOY.md)");
    return { ok: true, checklist: [] };
  }
  if (argv.includes("--dry-run")) return dryRun(deps);
  const full = { readFile: (f) => readFileSync(f, "utf8"), ...deps };
  const ctx = makeContext(full);
  try {
    await confirmAccount(ctx, full);
    const values = await collectAnswers(ctx, full);
    await prepareDatabase(ctx, full, values);
    const edgeConfirmed = await edgeRule(ctx, full);
    const deployOut = await deployWorker(ctx, values, argv.includes("--new-account-key"));
    adminStep(ctx);
    await runChecks(ctx, full, deployOut, edgeConfirmed);
  } catch (err) {
    const message = err instanceof Stop ? err.message : `unexpected error: ${err?.message ?? err}`;
    ctx.say(`STOPPED. ${message}`);
    ctx.item("Run finished", "FAIL", message.split("\n")[0]);
  }
  ctx.say(renderChecklist(ctx.checklist));
  return { ok: ctx.checklist.every((i) => i.status !== "FAIL"), checklist: ctx.checklist };
}

// The real wrangler: stdin carries a secret (or closes at once, so wrangler
// runs non-interactive), and the child gets this environment plus the
// confirmed account id.
export function runWrangler(args, { input, cwd, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn("wrangler", args, { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (err) => resolve({ code: 127, stdout, stderr: err.code === "ENOENT" ? "wrangler is not on PATH (npm i -g wrangler)" : err.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

async function main() {
  const reader = new LineReader(process.stdin, process.stdout);
  const result = await deploy({
    argv: process.argv.slice(2),
    root: path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
    run: runWrangler,
    ask: (q) => reader.ask(q),
    write: (text) => process.stdout.write(`${text}\n`),
    randomBytes: nodeRandomBytes,
    writeFile: (file, text) => writeFileSync(file, text, { mode: 0o600 }),
    makeTempDir: () => mkdtempSync(path.join(tmpdir(), "hz-deploy-")),
    removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
    fetchImpl: (...a) => globalThis.fetch(...a),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  reader.close();
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
