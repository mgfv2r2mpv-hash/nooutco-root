/**
 * What a rerun of bin/deploy.mjs keeps (Step 2). Kaleb, 9 Oct 2026: "I want
 * this to be the last time I have to paste everything in." A value the live
 * Worker already holds is kept unless he names it, so a rerun asks one
 * question (Return keeps all) in place of every value.
 *
 * The script reads secrets by name only (wrangler secret list). It reads the
 * plain vars with their values from the version serving now (wrangler
 * versions view): they are public values (the Turnstile site key, the daily
 * limits), and Step 3 writes them back into wrangler.deploy.toml so the file
 * stays a full record. The deploy config also sets keep_vars = true, so
 * wrangler keeps a plain var the file does not name instead of deleting it.
 */
import { CATALOG } from "./deploy-parts.mjs";

const ANSWER_TRIES = 3;
export const ASKED_NAMES = Object.freeze(CATALOG.filter((s) => s.source === "asked").map((s) => s.name));
const VAR_NAMES = Object.freeze(CATALOG.filter((s) => s.store === "var").map((s) => s.name));
export const KEEP_QUESTION = "  Press Return to keep all of these, or type the names to replace (comma separated): ";
export const ASK_ALL_FLAG = "--ask-all";
const VERSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

// He dictates: "resend key." or "Resend-Key" reads as RESEND_KEY.
export function normalName(text) {
  return text.trim().replace(/[.!?]+$/, "").trim().replace(/[\s-]+/g, "_").toUpperCase();
}

function parseNames(text, allowed) {
  const names = [...new Set(String(text).split(",").map(normalName).filter(Boolean))];
  return { names, unknown: names.filter((n) => !allowed.includes(n)) };
}

const inCatalogOrder = (names) => ASKED_NAMES.filter((n) => names.includes(n));

/**
 * --change NAME[,NAME] or --change=NAME, repeatable: null when absent. A name
 * that is not an asked value throws, naming the ones it takes (the generated
 * keys have their own flags).
 */
export function changeFlag(argv) {
  const parts = argv.flatMap((a, i) => {
    if (a === "--change") return [argv[i + 1] ?? ""];
    return a.startsWith("--change=") ? [a.slice("--change=".length)] : [];
  });
  if (parts.length === 0) return null;
  const { names, unknown } = parseNames(parts.join(","), ASKED_NAMES);
  if (names.length === 0 || unknown.length > 0) throw new Error(`--change takes one or more of: ${ASKED_NAMES.join(", ")}`);
  return names;
}

// The version serving the Worker now: the newest deployment's largest share.
export function currentVersionId(deployments) {
  const latest = [...(Array.isArray(deployments) ? deployments : [])]
    .filter((d) => Array.isArray(d?.versions))
    .sort((a, b) => String(a.created_on).localeCompare(String(b.created_on)))
    .at(-1);
  const top = [...(latest?.versions ?? [])].sort((a, b) => (b?.percentage ?? 0) - (a?.percentage ?? 0))[0];
  const id = top?.version_id;
  return typeof id === "string" && VERSION_ID.test(id) ? id : null;
}

// The catalog's plain vars on that version, name to value. Secret bindings
// carry no value in this view, and only catalog var names are taken.
export function plainVars(view) {
  const bindings = view?.resources?.bindings;
  if (!Array.isArray(bindings)) throw new Error("the version view has no binding list");
  return Object.fromEntries(bindings
    .filter((b) => b?.type === "plain_text" && VAR_NAMES.includes(b.name) && typeof b.text === "string")
    .map((b) => [b.name, b.text]));
}

/**
 * What is set, from the secret names (`existing`, null when unreadable) and
 * the live plain vars (`liveVars`, null when unreadable). A var that could
 * not be read counts as missing, so it is asked rather than guessed.
 */
export function storedState(existing, liveVars) {
  const isSet = (s) => (s.store === "secret" ? existing?.has(s.name) : liveVars?.[s.name] !== undefined) === true;
  const asked = CATALOG.filter((s) => s.source === "asked");
  return {
    stored: asked.filter(isSet).map((s) => s.name),
    missing: asked.filter((s) => !isSet(s) && (!s.optional || liveVars === null)).map((s) => s.name),
    defaulted: asked.filter((s) => !isSet(s) && s.optional && liveVars !== null).map((s) => s.name),
  };
}

/**
 * The names this run asks for, in catalog order. Nothing stored (a first
 * deploy) or --ask-all: every one. --change: the missing ones and those
 * named. Otherwise one question lists what is stored (names only) and Return
 * keeps it all; a typed name is asked for. The question never echoes what
 * was typed, in case a value was pasted into it by mistake.
 */
export async function chooseAsked(ctx, deps, { existing, liveVars, change, askAll }, Stop) {
  const { stored, missing, defaulted } = storedState(existing, liveVars);
  if (askAll || stored.length === 0) return { ask: [...ASKED_NAMES], stored };
  if (change) return { ask: inCatalogOrder([...missing, ...change]), stored };
  ctx.say(`  Already set on the live Worker (names only): ${stored.join(", ")}`);
  if (defaulted.length > 0) ctx.say(`  Left at their default: ${defaulted.join(", ")} (type a name to set it)`);
  if (missing.length > 0) ctx.say(`  Not set yet, so asked below: ${missing.join(", ")}`);
  const allowed = [...stored, ...defaulted];
  for (let i = 0; i < ANSWER_TRIES; i++) {
    const answer = await deps.ask({ name: "keep-or-replace", question: KEEP_QUESTION, hidden: false });
    const { names, unknown } = parseNames(answer, allowed);
    if (unknown.length === 0) return { ask: inCatalogOrder([...missing, ...names]), stored };
    ctx.say(`  Not accepted: type names from this list, comma separated, or press Return: ${allowed.join(", ")}`);
  }
  throw new Stop(`No acceptable answer to the keep question after ${ANSWER_TRIES} tries. Nothing was created.`);
}
