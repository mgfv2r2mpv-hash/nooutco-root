#!/usr/bin/env node
/**
 * Horae Zone deploy (plan: sass-assistant docs/ios-plan.md §4). One command,
 * run by the owner from apps/horae-zone:
 *
 *   node bin/deploy.mjs             deploy, with prompts
 *   node bin/deploy.mjs --dry-run   print every step and command; nothing is
 *                                   run, asked, written or fetched
 *   node bin/deploy.mjs --check-only
 *                                   Step 7 alone, after a deploy: the checks
 *                                   and the checklist; asks nothing, needs no
 *                                   secret, changes nothing
 *   node bin/deploy.mjs --owner-admin
 *                                   Step 6 alone, after a deploy and the
 *                                   owner's sign-up: set the owner's account
 *                                   as the first administrator (one prompt,
 *                                   one guarded write; bin/deploy-admin.mjs)
 *   --new-account-key              replace an HZ_ACCOUNT_KEY and HZ_SEED_KEY
 *                                   already set (every stored account and
 *                                   enrolled authenticator code becomes
 *                                   unusable); asks for the typed word replace
 *                                   first
 *   --new-ticket-key                replace an HZ_TICKET_KEY already set (every
 *                                   ticket already issued stops working); asks
 *                                   for a y first
 *
 * Steps: print `wrangler --version`; confirm the Cloudflare account, and a
 * y before replacing a Worker already named horae-zone there; ask the values only the owner has
 * (the Resend key on a hidden prompt); create or find the D1 database, write
 * the gitignored wrangler.deploy.toml and apply schema.sql (idempotent); show
 * the rate rule clicks; deploy; put each secret through stdin; set the
 * owner's account as administrator once it exists (Step 6); check
 * everything (with the hostname checks to make once the Worker exists) and
 * print a PASS/FAIL checklist.
 *
 * A secret value is never on a command line, in a child's environment, in a
 * file or in the output: every printed line passes through scrub(), which
 * also masks each value's JSON-escaped and URL-encoded forms, and a check
 * whose output carries a value fails (test/deploy.test.mjs). Every wrangler
 * child also runs with WRANGLER_LOG_SANITIZE=true, whatever the shell says.
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
import { OWNER_ADMIN_FLAG, ownerAdminStep, ownerAdminDryRun } from "./deploy-admin.mjs";
import {
  CATALOG, SECRET_NAMES, DATABASE, HOSTNAME, DEPLOY_CONFIG, CRON, ACCOUNT_KEY_BYTES, SEED_KEY_BYTES,
  LineReader, deployConfig, scrub, parseJson, findDatabaseId, schemaTables, renderChecklist, ticketKeyJwk, isChallenge, isTurnstileKey,
} from "./deploy-parts.mjs";

const ROUTE_TRIES = 6;
const ROUTE_WAIT_MS = 10_000;
const ANSWER_TRIES = 3;
const TAIL_LINES = 15;
const WORKER = "horae-zone";
// Set last on every wrangler child, so a shell with WRANGLER_LOG_SANITIZE=false
// cannot turn off wrangler's own log redaction for this run.
const CHILD_ENV = Object.freeze({ WRANGLER_LOG_SANITIZE: "true" });

export const COMMANDS = Object.freeze({
  version: ["--version"],
  whoami: ["whoami", "--json"],
  deployments: ["deployments", "list", "--name", WORKER, "--json"],
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
  return flag === -1 ? args : args.slice(0, Math.max(flag, 1)); // `--version` names itself
};
const show = (args) => `wrangler ${args.map((a) => (/[\s'*]/.test(a) ? `"${a}"` : a)).join(" ")}`;

// Printed at the top of Step 2, before the two Turnstile prompts: the widget
// has to exist for its keys to be typed in.
export const TURNSTILE_WIDGET_STEPS = [
  "Before the Turnstile prompts, make the widget (dashboard, account confirmed above; once per account):",
  "  dash.cloudflare.com > Turnstile (type Turnstile in the dashboard search if the sidebar hides it) > Add widget.",
  `  Widget name: horae-zone. Hostname: ${HOSTNAME} (this one only). Widget Mode: Managed. Pre-clearance: No. Create.`,
  "  Keep that page open: the script asks for its Site Key, then its Secret Key (hidden).",
];

const EDGE_STEPS = [
  "Cloudflare step this script cannot do safely (dashboard, account confirmed above):",
  "  1. Rate rule on sign-up and sign-in (required at the first deploy, DESIGN-REVIEW A3 item 13; live since 8 Oct 2026):",
  `     dash.cloudflare.com > the nooutco.me zone > Security > Security rules > Create rule > Rate limiting rule`,
  `     (older dashboards: Security > WAF > Rate limiting rules > Create rule).`,
  `     Rule name: horae-zone sign-up and sign-in. Click "Edit expression" and paste:`,
  `       (http.host eq "${HOSTNAME}" and http.request.method eq "POST" and http.request.uri.path in {"/account" "/signin" "/recover"})`,
  `     With the same characteristics: IP. When rate exceeds: 2 requests per 10 seconds (the rule already live; add "/recover" to it).`,
  `     Then take action: Block, for the plan's block period. Deploy.`,
  "     Turnstile is wired in (src/turnstile.js) on /account and /signin: it bounds a stranger with many addresses,",
  "     which a per-address rule cannot. The rate rule stays as the backstop, and it is the only edge rule on /recover.",
];

// Printed in Step 7, once the Worker exists: before the deploy there is no
// horae-zone under Workers & Pages to look in.
const AFTER_DEPLOY_STEPS = [
  "Check after the deploy (dashboard; the route check below looks for the cf-ray header too):",
  "  Hostname proxied, so cf-connecting-ip comes from the Cloudflare edge and cannot be set by a caller:",
  `    Workers & Pages > horae-zone > Settings > Domains & Routes: ${HOSTNAME} listed as a Custom domain.`,
  `    DNS > Records: the horae-zone row shows Proxy status "Proxied" (orange cloud). A Custom domain is always proxied.`,
  "  The route check below reads Cloudflare's challenge header: when bot protection answers first, it prints the skip rule to add (D-22).",
];

// Printed when the route check meets a Cloudflare challenge: the zone's bot
// protection answered, so the Worker never saw the request. Rate limiting
// stays unskipped, so the rate rule from step 4 still covers the route.
const SKIP_RULE = [
  "Cloudflare's bot protection is answering before the Worker: the zone challenged GET /account, so the Worker never saw it.",
  "Add this skip rule (dashboard), then re-check the route:",
  "  dash.cloudflare.com > the nooutco.me zone > Security > Security rules > Create rule > Custom rule",
  `  Rule name: horae-zone skip bot protection. Click "Edit expression" and paste:`,
  `    (http.host eq "${HOSTNAME}")`,
  `  Then take action: Skip. WAF components to skip: tick only "All Super Bot Fight Mode Rules";`,
  `  leave "All rate limiting rules" unticked, so the rate rule (step 4) still applies.`,
  "  Place at: First. Deploy.",
];

const CHECK_AGAIN = "node bin/deploy.mjs --check-only";

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
    const res = await deps.run(args, { input, cwd: cwd ?? deps.root, env: { ...ctx.env, ...CHILD_ENV } });
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

// Printed first, so a report of the run says which wrangler made it; a
// wrangler that is missing or broken stops here, before any account call.
async function wranglerVersion(ctx) {
  const version = (await ctx.wrangler(COMMANDS.version)).trim().split("\n")[0];
  ctx.say(`wrangler ${version || "(no version printed)"}`);
}

// The accounts wrangler is logged in to; none stops the run.
async function loggedInAccounts(ctx) {
  let who;
  try {
    who = parseJson(await ctx.wrangler(COMMANDS.whoami));
  } catch (err) {
    throw new Stop(err instanceof Stop ? `Not logged in to Cloudflare: run "wrangler login", then this command again.\n${err.message}` : `wrangler whoami gave no account list (${err.message}).`);
  }
  const accounts = Array.isArray(who?.accounts) ? who.accounts.filter((a) => a && a.id && a.name) : [];
  if (who?.loggedIn === false || accounts.length === 0) throw new Stop('Not logged in to Cloudflare: run "wrangler login", then this command again.');
  return accounts;
}

function useAccount(ctx, account, how) {
  ctx.env.CLOUDFLARE_ACCOUNT_ID = account.id;
  ctx.item("Cloudflare account", "PASS", `${account.name} (${how})`);
}

async function confirmAccount(ctx, deps) {
  ctx.say("Step 1. Cloudflare account");
  const accounts = await loggedInAccounts(ctx);
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
  useAccount(ctx, chosen, "confirmed by you");
}

// --check-only and --owner-admin ask no account: the only one wrangler sees,
// or the one CLOUDFLARE_ACCOUNT_ID names. `flag` is the mode to run again.
async function pickAccountQuietly(ctx, deps, flag = "--check-only") {
  const accounts = await loggedInAccounts(ctx);
  if (accounts.length === 1) return useAccount(ctx, accounts[0], "the only account logged in");
  const named = accounts.find((a) => a.id === deps.accountId);
  if (!named) throw new Stop(`Logged in to more than one Cloudflare account: set CLOUDFLARE_ACCOUNT_ID to the one Horae Zone runs in, then run ${flag} again. Nothing was changed.`);
  useAccount(ctx, named, "named by CLOUDFLARE_ACCOUNT_ID");
}

const UNKNOWN_WORKER = `could not tell whether Worker ${WORKER} exists; nothing was changed; rerun once "wrangler ${COMMANDS.deployments.join(" ")}" answers`;
// The API's code for a Worker the account does not have (wrangler 4 prints it
// as "[code: 10007]" under "A request to the Cloudflare API ... failed").
const NO_SUCH_WORKER = /\[code: 10007\]/;

// In the confirmed account, before anything is created: a Worker already
// named horae-zone has its code replaced only on a typed y.
async function confirmWorker(ctx, deps) {
  let list;
  try {
    list = parseJson(ctx.checked("the Worker check", await ctx.wrangler(COMMANDS.deployments)));
  } catch (err) {
    if (NO_SUCH_WORKER.test(err.message)) return;
    throw new Stop(`${UNKNOWN_WORKER}\n${err.message}`);
  }
  if (!Array.isArray(list)) throw new Stop(`${UNKNOWN_WORKER}\nthe deployment list is not a list`);
  ctx.say(`  Worker ${WORKER} already exists; this will replace its code.`);
  const yes = (await deps.ask({ name: "confirm-replace-worker", question: "  Replace it? Type y to go on, n to stop: ", hidden: false })).trim().toLowerCase();
  if (yes !== "y" && yes !== "yes") throw new Stop(`Worker ${WORKER} not replaced; nothing was changed.`);
}

// `n` fresh random bytes as base64url; the bytes are zeroed once encoded.
function randomKey(deps, n) {
  const bytes = deps.randomBytes(n);
  const key = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64url");
  bytes.fill(0);
  return key;
}

async function collectAnswers(ctx, deps) {
  ctx.say("Step 2. Values only you have (typed answers are kept in memory only)");
  for (const line of TURNSTILE_WIDGET_STEPS) ctx.say(`  ${line}`);
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
  values.HZ_ACCOUNT_KEY = randomKey(deps, ACCOUNT_KEY_BYTES);
  ctx.known.push(values.HZ_ACCOUNT_KEY);
  ctx.say(`  Generated HZ_ACCOUNT_KEY (${ACCOUNT_KEY_BYTES} random bytes). It is never shown or saved; a key already set is kept unless --new-account-key.`);
  values.HZ_SEED_KEY = randomKey(deps, SEED_KEY_BYTES);
  ctx.known.push(values.HZ_SEED_KEY);
  ctx.say(`  Generated HZ_SEED_KEY (${SEED_KEY_BYTES} random bytes). It is never shown or saved; a key already set is kept unless --new-account-key.`);
  values.HZ_TICKET_KEY = await deps.generateTicketKey();
  // The JWK string and its private part d, so wrangler echoing either is masked.
  ctx.known.push(values.HZ_TICKET_KEY, JSON.parse(values.HZ_TICKET_KEY).d);
  ctx.say("  Generated HZ_TICKET_KEY (ECDSA P-256 private key, JWK). It is never shown or saved; a key already set is kept unless --new-ticket-key.");
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
  const configText = deployConfig(toml, { databaseId: id, vars });
  deps.writeFile(path.join(deps.root, DEPLOY_CONFIG), configText);
  ctx.say(`  Wrote ${DEPLOY_CONFIG} (gitignored): database id, route ${HOSTNAME}, no secret.`);
  await ctx.wrangler(COMMANDS.applySchema);
  ctx.say("  Applied schema.sql (every statement is IF NOT EXISTS).");
  ctx.item("Database present", "PASS", found ? "found" : "created");
  return configText;
}

async function edgeRule(ctx, deps) {
  ctx.say("Step 4. Edge rule, before the route goes live");
  for (const line of EDGE_STEPS) ctx.say(line);
  const yes = (await deps.ask({ name: "confirm-edge", question: "  Is the rate rule (1) in place? Type y once it is, n to go on without it: ", hidden: false })).trim().toLowerCase();
  return yes === "y" || yes === "yes";
}

const UNREADABLE_SECRETS = "could not read the secret list; the Worker and its secrets were not changed; rerun, or pass --new-account-key if you mean to replace it";
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

// --new-account-key over an account or seed key that is set, or may be (an
// unreadable list): only the typed word replace goes on, and anything else
// stops before deploy.
async function confirmReplaceKey(ctx, deps, existing) {
  const set = existing ? ACCOUNT_FLAG_KEYS.filter((n) => existing.has(n)).join(" and ") : "";
  ctx.say(`  --new-account-key replaces HZ_ACCOUNT_KEY and HZ_SEED_KEY (${existing ? `already set: ${set}` : "either may already be set: the secret list could not be read"}).`);
  ctx.say("  If it is replaced, every enrolment, ticket and account becomes unusable, and none can be recovered.");
  const answer = (await deps.ask({ name: "confirm-replace-key", question: "  Type replace to replace it (anything else stops): ", hidden: false })).trim();
  if (answer !== "replace") throw new Stop("HZ_ACCOUNT_KEY not replaced; the Worker and its secrets were not changed. Rerun without --new-account-key to keep it.");
}

// --new-ticket-key over a ticket key that is set, or may be: only y goes on.
// Accounts are untouched; only tickets already issued stop working.
async function confirmReplaceTicketKey(ctx, deps, existing) {
  ctx.say(`  --new-ticket-key: HZ_TICKET_KEY ${existing ? "is already set" : "may already be set (the secret list could not be read)"}.`);
  ctx.say("  If it is replaced, every ticket already issued stops working (each lives 5 minutes); accounts are not affected.");
  const yes = (await deps.ask({ name: "confirm-replace-ticket-key", question: "  Replace HZ_TICKET_KEY? Type y to go on, n to stop: ", hidden: false })).trim().toLowerCase();
  if (yes !== "y" && yes !== "yes") throw new Stop("HZ_TICKET_KEY not replaced; the Worker and its secrets were not changed. Rerun without --new-ticket-key to keep it.");
}

// The keys --new-account-key replaces: a new seed key alone would lock every
// confirmed enrolment out of its code, so it goes only with the account key.
const ACCOUNT_FLAG_KEYS = Object.freeze(["HZ_ACCOUNT_KEY", "HZ_SEED_KEY"]);

// What a kept key says in place of "Set": why it was kept, and the flag that replaces it.
const KEPT = Object.freeze({
  HZ_ACCOUNT_KEY: "  Kept HZ_ACCOUNT_KEY (already set; a new one would make every stored account unreadable, --new-account-key replaces it).",
  HZ_SEED_KEY: "  Kept HZ_SEED_KEY (already set; a new one would make every enrolled authenticator code unusable, --new-account-key replaces it).",
  HZ_TICKET_KEY: "  Kept HZ_TICKET_KEY (already set; a new one would stop every ticket already issued, --new-ticket-key replaces it).",
});

// A new HZ_ACCOUNT_KEY makes every stored account unreadable, a new
// HZ_SEED_KEY every sealed authenticator seed, and a new HZ_TICKET_KEY voids
// every ticket already issued, so a rerun keeps each one already set unless
// its flag says otherwise. An unreadable list (null) only gets this far under
// a confirmed --new-account-key, and then all three are put.
async function deployWorker(ctx, deps, values, { newAccountKey, newTicketKey }) {
  ctx.say("Step 5. Deploy the Worker, then put each secret");
  const existing = await secretsBeforeDeploy(ctx, newAccountKey);
  if (newAccountKey && (existing === null || ACCOUNT_FLAG_KEYS.some((n) => existing.has(n)))) await confirmReplaceKey(ctx, deps, existing);
  if (newTicketKey && (existing === null || existing.has("HZ_TICKET_KEY"))) await confirmReplaceTicketKey(ctx, deps, existing);
  const keep = new Set([
    ...(newAccountKey ? [] : ACCOUNT_FLAG_KEYS.filter((n) => existing.has(n))),
    ...(!newTicketKey && existing?.has("HZ_TICKET_KEY") ? ["HZ_TICKET_KEY"] : []),
  ]);
  const out = await ctx.wrangler(COMMANDS.deploy);
  ctx.item("Worker deployed", "PASS", `horae-zone, route ${HOSTNAME} (Custom domain)`);
  for (const name of SECRET_NAMES) {
    if (keep.has(name)) {
      ctx.say(KEPT[name]);
      continue;
    }
    await ctx.wrangler(COMMANDS.secretPut(name), { input: values[name] });
    ctx.say(`  Set ${name}.`);
  }
  return out;
}

// One look at the route, retried only while it answers 5xx or not at all.
async function probeRoute(ctx, deps) {
  const url = `https://${HOSTNAME}/account`;
  let last = "no answer";
  for (let i = 0; i < ROUTE_TRIES; i++) {
    if (i > 0) await deps.sleep(ROUTE_WAIT_MS);
    try {
      const res = await deps.fetchImpl(url, { method: "GET", redirect: "manual" });
      const body = ctx.checked("the route check", await res.text());
      if (isChallenge(res.headers, body)) {
        const mark = res.headers.has("cf-mitigated") ? " (cf-mitigated: challenge)" : "";
        return { pass: false, challenged: true, detail: `GET /account answered ${res.status} with a challenge${mark}: Cloudflare's bot protection is answering before the Worker; add the skip rule printed above` };
      }
      let error = null;
      try {
        error = JSON.parse(body)?.error ?? null;
      } catch {
        error = null;
      }
      const edge = res.headers.has("cf-ray");
      if (res.status === 405 && error === "method" && edge) return { pass: true, detail: "GET /account refused as method (405) through the Cloudflare edge" };
      last = `GET /account answered ${res.status}${error ? ` ${error}` : ""}${edge ? "" : ", with no cf-ray header (not through the Cloudflare edge)"}`;
      if (res.status < 500) break;
    } catch (err) {
      last = `GET /account failed: ${ctx.checked("the route check", err?.message ?? "error")}`;
    }
  }
  return { pass: false, challenged: false, detail: `${last}; expected 405 method through the edge` };
}

// A challenged route prints the skip rule and offers a re-check of the route
// alone, as often as it stays challenged; no other step runs again. Under
// --check-only nothing is asked: it says how to check again instead.
async function checkRoute(ctx, deps, checkOnly) {
  for (;;) {
    const result = await probeRoute(ctx, deps);
    if (result.pass) return ctx.item("Route answers", "PASS", result.detail);
    if (!result.challenged) return ctx.item("Route answers", "FAIL", result.detail);
    for (const line of SKIP_RULE) ctx.say(`  ${line}`);
    if (checkOnly) {
      ctx.say(`  Once it is in place, check again with: ${CHECK_AGAIN}`);
      return ctx.item("Route answers", "FAIL", result.detail);
    }
    const again = (await deps.ask({ name: "confirm-recheck-route", question: "  Re-check the route now? (y) Type y once the skip rule is in place, anything else leaves it FAIL: ", hidden: false })).trim().toLowerCase();
    if (again !== "y") return ctx.item("Route answers", "FAIL", result.detail);
  }
}

// The Turnstile site key is a Worker var, so the secret list cannot show it:
// it is read from the deploy-only config that carries it (a public value).
// Without it GET /challenge answers not-configured and nobody can sign up.
const SITEKEY_LINE = /^HZ_TURNSTILE_SITEKEY = "([^"]*)"$/m;
export function sitekeyItem(configText) {
  const value = SITEKEY_LINE.exec(configText ?? "")?.[1];
  return isTurnstileKey(value ?? "")
    ? ["PASS", `a Worker var in ${DEPLOY_CONFIG}`]
    : ["FAIL", `not in ${DEPLOY_CONFIG}: GET /challenge answers not-configured; run node bin/deploy.mjs with the widget's keys`];
}

// After a deploy, deployOut and edgeConfirmed come from Steps 5 and 4, and
// configText is the deploy-only config Step 3 wrote (or --check-only read).
// Under --check-only there is no deploy output and no prompt, so the cron
// and the rate rule are left to the dashboard and marked SKIPPED.
async function runChecks(ctx, deps, { deployOut, edgeConfirmed, configText, checkOnly = false }) {
  ctx.say("Step 7. Checks");
  for (const line of AFTER_DEPLOY_STEPS) ctx.say(`  ${line}`);
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
  ctx.item("Turnstile site key HZ_TURNSTILE_SITEKEY", ...sitekeyItem(configText));
  if (checkOnly) {
    ctx.item("Cron trigger", "SKIPPED", `--check-only has no deploy output; check ${CRON} under Triggers in the dashboard`);
  } else {
    const cronSeen = new RegExp(`schedule:\\s*${CRON.replace(/\*/g, "\\*")}`).test(ctx.checked("the deploy", deployOut));
    ctx.item("Cron trigger", cronSeen ? "PASS" : "FAIL", cronSeen ? `${CRON} (hourly purge)` : `no "schedule: ${CRON}" in the deploy output; check Triggers in the dashboard`);
  }
  await checkRoute(ctx, deps, checkOnly);
  if (checkOnly) return ctx.item("Edge rule on /account and /signin", "SKIPPED", "--check-only asks nothing; the rate rule is in the dashboard (step 4, item 1)");
  ctx.item("Edge rule on /account and /signin", edgeConfirmed ? "PASS" : "FAIL", edgeConfirmed ? "confirmed by you" : "required at the first deploy: add it (step 4, item 1)");
}

function dryRun(deps) {
  const say = deps.write;
  const put = (name) => `${show(COMMANDS.secretPut(name))}   < stdin: [masked]`;
  [
    "DRY RUN: nothing is run, asked, written or fetched. Secret values are shown as [masked].",
    "Every wrangler call runs with WRANGLER_LOG_SANITIZE=true.",
    `  ${show(COMMANDS.version)}   printed first; a missing wrangler stops here`,
    "Step 1. Cloudflare account",
    `  ${show(COMMANDS.whoami)}   then: confirm the account name (prompt)`,
    `  ${show(COMMANDS.deployments)}   when Worker ${WORKER} already exists: prompt, y replaces its code, anything else stops`,
    "Step 2. Values only you have",
    ...TURNSTILE_WIDGET_STEPS.map((l) => `  ${l}`),
    ...CATALOG.filter((s) => s.source === "asked").map((s) => `  prompt${s.hidden ? " (hidden)" : ""}: ${s.label} -> ${s.name}${s.store === "var" ? ` ([vars] in ${DEPLOY_CONFIG} when answered)` : ""}   checked: ${s.rule}`),
    `  generate: HZ_ACCOUNT_KEY = [masked] (${ACCOUNT_KEY_BYTES} random bytes, base64url)`,
    `  generate: HZ_SEED_KEY = [masked] (${SEED_KEY_BYTES} random bytes, base64url)`,
    "  generate: HZ_TICKET_KEY = [masked] (ECDSA P-256 private key, JWK)",
    `Step 3. D1 database "${DATABASE}"`,
    `  ${show(COMMANDS.d1List)}`,
    `  ${show(COMMANDS.d1Create)}   (only when missing, from an empty temp folder)`,
    `  write ${DEPLOY_CONFIG} (gitignored): wrangler.toml + database id + route ${HOSTNAME} as a Custom domain`,
    `  ${show(COMMANDS.applySchema)}`,
    "Step 4. Edge rule, before the route goes live",
    ...EDGE_STEPS.map((l) => `  ${l}`),
    "  prompt: is the rate rule in place?",
    "Step 5. Deploy the Worker, then put each secret",
    `  ${show(COMMANDS.secretList)}   (an HZ_ACCOUNT_KEY or HZ_SEED_KEY already set is kept unless --new-account-key; an unreadable list stops here)`,
    "  with --new-account-key over an account or seed key that is set (or an unreadable list): prompt, type replace or the run stops",
    "  an HZ_TICKET_KEY already set is kept unless --new-ticket-key; with it over a key that is set: prompt, y replaces it or the run stops",
    `  ${show(COMMANDS.deploy)}`,
    ...SECRET_NAMES.map((n) => `  ${put(n)}`),
    ...ownerAdminDryRun(show),
    "  (A5c: the admin routes need the role; the first administrator is set once)",
    "Step 7. Checks, then the PASS/FAIL checklist",
    ...AFTER_DEPLOY_STEPS.map((l) => `  ${l}`),
    `  ${show(COMMANDS.tables)}`,
    `    expect tables: ${schemaTables(deps.readFile(path.join(deps.root, "schema.sql"))).join(", ")}`,
    `  ${show(COMMANDS.secretList)}`,
    `    expect secrets (names only): ${SECRET_NAMES.join(", ")}`,
    `  read ${DEPLOY_CONFIG}: expect HZ_TURNSTILE_SITEKEY under [vars] (a public value)`,
    `  cron: "schedule: ${CRON}" in the deploy output`,
    `  GET https://${HOSTNAME}/account   expect 405 method with a cf-ray header`,
    "    a Cloudflare challenge (cf-mitigated: challenge, or a challenge page): prints the skip rule, then prompt: re-check the route now? (y)",
  ].forEach((l) => say(l));
  return { ok: true, dryRun: true, checklist: [] };
}

export async function deploy(deps) {
  const argv = deps.argv ?? [];
  if (argv.includes("--help")) {
    deps.write(`Usage: node bin/deploy.mjs [--dry-run] [--check-only] [${OWNER_ADMIN_FLAG}] [--new-account-key] [--new-ticket-key]   (from apps/horae-zone; see DEPLOY.md)`);
    return { ok: true, checklist: [] };
  }
  const full = { readFile: (f) => readFileSync(f, "utf8"), generateTicketKey: ticketKeyJwk, ...deps };
  if (argv.includes("--dry-run")) return dryRun(full);
  const ctx = makeContext(full);
  if (argv.includes("--check-only")) return finish(ctx, () => checkOnly(ctx, full));
  if (argv.includes(OWNER_ADMIN_FLAG)) return finish(ctx, () => ownerAdminOnly(ctx, full));
  return finish(ctx, async () => {
    await wranglerVersion(ctx);
    await confirmAccount(ctx, full);
    await confirmWorker(ctx, full);
    const values = await collectAnswers(ctx, full);
    const configText = await prepareDatabase(ctx, full, values);
    const edgeConfirmed = await edgeRule(ctx, full);
    const deployOut = await deployWorker(ctx, full, values, { newAccountKey: argv.includes("--new-account-key"), newTicketKey: argv.includes("--new-ticket-key") });
    await ownerAdminStep(ctx, full);
    await runChecks(ctx, full, { deployOut, edgeConfirmed, configText });
  });
}

// --check-only: Step 7 alone, after a deploy. It asks nothing and needs no
// secret; every wrangler call it makes reads (whoami, the table query, the
// secret names), and it writes no file.
async function checkOnly(ctx, deps) {
  await wranglerVersion(ctx);
  let configText;
  try {
    configText = deps.readFile(path.join(deps.root, DEPLOY_CONFIG));
  } catch {
    throw new Stop(`${DEPLOY_CONFIG} is not here: the deploy writes it (step 3), so run node bin/deploy.mjs first. Nothing was changed.`);
  }
  await pickAccountQuietly(ctx, deps);
  await runChecks(ctx, deps, { checkOnly: true, configText });
}

// --owner-admin: Step 6 alone, after a deploy and the owner's sign-up. It
// asks only which account is the owner's, needs no secret, and its one write
// is the guarded role insert (bin/deploy-admin.mjs).
async function ownerAdminOnly(ctx, deps) {
  await wranglerVersion(ctx);
  try {
    deps.readFile(path.join(deps.root, DEPLOY_CONFIG));
  } catch {
    throw new Stop(`${DEPLOY_CONFIG} is not here: the deploy writes it (step 3), so run node bin/deploy.mjs first. Nothing was changed.`);
  }
  await pickAccountQuietly(ctx, deps, OWNER_ADMIN_FLAG);
  await ownerAdminStep(ctx, deps);
}

async function finish(ctx, steps) {
  try {
    await steps();
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
// confirmed account id, with WRANGLER_LOG_SANITIZE=true over both.
export function runWrangler(args, { input, cwd, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn("wrangler", args, { cwd, env: { ...process.env, ...env, ...CHILD_ENV }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (err) => resolve({ code: 127, stdout, stderr: err.code === "ENOENT" ? "wrangler is not on PATH (npm i -g wrangler)" : err.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    // A wrangler that quits before reading stdin closes the pipe (EPIPE). Its
    // exit code already reports the failure through "close", so the write
    // error must not crash the run.
    child.stdin.on("error", () => {});
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
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
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
