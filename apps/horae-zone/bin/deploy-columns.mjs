/**
 * The column step of the Horae Zone deploy (bin/deploy.mjs, Step 3), run
 * after schema.sql is applied and before the Worker deploys.
 *
 * Why: every statement in schema.sql is CREATE TABLE IF NOT EXISTS, which
 * never touches a table that already exists. On 9 Oct 2026 production's
 * device table had no confirmed_at while the deployed code wrote it at
 * /unlock/finish, and every unlock answered 500 until the column was added by
 * hand. So the deploy now reads each table's columns on the target database
 * (PRAGMA table_info) and compares them with what schema.sql declares.
 *
 * What it does about a difference:
 *   - a missing column that is nullable, or has a constant DEFAULT, is added
 *     with ALTER TABLE ... ADD COLUMN, using schema.sql's own definition;
 *   - anything else (a missing NOT NULL column with no constant default, a
 *     missing PRIMARY KEY or UNIQUE column, a changed type, NOT NULL, DEFAULT
 *     or key, or a column schema.sql no longer declares) stops the deploy
 *     before the Worker deploys, one plain sentence per difference, and
 *     nothing is altered.
 * Then the tables it altered are read again, and any table that still
 * differs stops the deploy too.
 *
 * What schema.sql declares is read the same way: schema.sql is run on an
 * empty in-memory SQLite database (D1 is SQLite) and PRAGMA table_info is
 * read there, so both sides are SQLite's own report and nothing here parses a
 * column's type, NOT NULL or DEFAULT out of the SQL text.
 */
import { DatabaseSync } from "node:sqlite";
import { DATABASE, DEPLOY_CONFIG, parseJson, schemaTables } from "./deploy-parts.mjs";

// The same shape as every other remote read and write in the script.
const sql = (command) => ["d1", "execute", DATABASE, "--remote", "--json", "--command", command, "--config", DEPLOY_CONFIG];

export const COLUMN_COMMANDS = Object.freeze({
  columns: (table) => sql(`PRAGMA table_info(${table})`),
  addColumn: (table, definition) => sql(`ALTER TABLE ${table} ADD COLUMN ${definition}`),
});

const NOT_DEPLOYED = "The Worker was not deployed and no column was changed; fix the database or schema.sql, then run this command again.";
const ITEM = "Columns match schema.sql";

// A DEFAULT SQLite accepts on ADD COLUMN for rows already there: a number, a
// string or blob literal, TRUE or FALSE. NULL is no default at all.
const CONSTANT_DEFAULT = /^(?:[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?|0x[0-9a-f]+|'(?:[^']|'')*'|x'[0-9a-f]*'|true|false)$/i;
const isNullDefault = (value) => value === null || /^null$/i.test(value);

// The columns of one table as SQLite reports them, in a form both sides share.
const shape = (rows) => rows.map((r) => ({
  name: String(r.name),
  type: String(r.type ?? "").trim().replace(/\s+/g, " ").toUpperCase(),
  notnull: Number(r.notnull) === 1,
  dflt: r.dflt_value === null || r.dflt_value === undefined ? null : String(r.dflt_value),
  pk: Number(r.pk),
}));

/** Every table schema.sql creates, with its columns as SQLite reports them. */
export function declaredColumns(schemaSql) {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(schemaSql);
    return new Map(schemaTables(schemaSql).map((t) => [t, shape(db.prepare(`PRAGMA table_info(${t})`).all())]));
  } finally {
    db.close();
  }
}

// The text of each column definition in schema.sql, by table and column, so
// an added column carries exactly what schema.sql says (UNIQUE included,
// which is how the plan refuses it). Comments are dropped and runs of spaces
// close up; table constraints (PRIMARY KEY (...), UNIQUE (...)) are skipped.
export function columnDefinitions(schemaSql) {
  const out = new Map();
  for (const m of schemaSql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(/g)) {
    const defs = new Map();
    for (const p of tableParts(schemaSql, m.index + m[0].length)) {
      if (!p || /^(PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY|CONSTRAINT)\b/i.test(p)) continue;
      defs.set(p.split(" ")[0], p);
    }
    out.set(m[1], defs);
  }
  return out;
}

// The comma-separated parts of a CREATE TABLE body, from just after its "("
// to the ")" that closes it. A comma or bracket inside a 'string' or a nested
// (...) does not split, and a -- comment outside a string is dropped.
function tableParts(text, from) {
  const parts = [];
  let depth = 1;
  let quoted = false;
  let part = "";
  for (let i = from; i < text.length && depth > 0; i++) {
    const ch = text[i];
    if (quoted) {
      part += ch;
      if (ch === "'") quoted = false; // '' reads as close then open: the same text
      continue;
    }
    if (ch === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++;
      part += " ";
      continue;
    }
    if (ch === "'") quoted = true;
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 || (ch === "," && depth === 1)) {
      parts.push(part.trim().replace(/\s+/g, " "));
      part = "";
    } else {
      part += ch;
    }
  }
  return parts;
}

const yesNo = (b) => (b ? "yes" : "no");
const dfltText = (d) => (d === null ? "none" : d);

// Why a missing column cannot be added safely (the end of a sentence that
// names it), or null when it can.
function cannotAdd(col, definition) {
  if (!definition) return "whose definition in schema.sql could not be read";
  if (col.pk > 0) return "which schema.sql declares part of the PRIMARY KEY, and ALTER TABLE cannot add a key column";
  if (/\bUNIQUE\b/i.test(definition)) return "which schema.sql declares UNIQUE, and ALTER TABLE cannot add a UNIQUE column";
  if (!isNullDefault(col.dflt) && !CONSTANT_DEFAULT.test(col.dflt)) return `which has DEFAULT ${col.dflt} in schema.sql, not a constant, and ALTER TABLE cannot add it`;
  if (col.notnull && isNullDefault(col.dflt)) return "which schema.sql declares NOT NULL with no constant DEFAULT, so the rows already there would have no value for it";
  return null;
}

// One sentence per way a column that exists on both sides differs.
function changed(table, want, have) {
  const out = [];
  if (want.type !== have.type) out.push(`Table ${table} column ${want.name} is ${have.type || "untyped"} in the database but ${want.type || "untyped"} in schema.sql.`);
  if (want.notnull !== have.notnull) out.push(`Table ${table} column ${want.name} is NOT NULL ${yesNo(have.notnull)} in the database but NOT NULL ${yesNo(want.notnull)} in schema.sql.`);
  if (want.dflt !== have.dflt) out.push(`Table ${table} column ${want.name} has DEFAULT ${dfltText(have.dflt)} in the database but DEFAULT ${dfltText(want.dflt)} in schema.sql.`);
  if (want.pk !== have.pk) out.push(`Table ${table} column ${want.name} is ${have.pk ? "" : "not "}in the PRIMARY KEY in the database but is ${want.pk ? "" : "not "}in it in schema.sql.`);
  return out;
}

/**
 * What to do about one table: `add` lists the columns to add, `problems` one
 * sentence per difference this step will not change. A table the database
 * does not have at all (an empty PRAGMA) is a problem: schema.sql was just
 * applied, so it should be there.
 */
export function planTable(table, want, have, definitions = new Map()) {
  if (have.length === 0) return { add: [], problems: [`Table ${table} is not in the database, though schema.sql was just applied.`] };
  const add = [];
  const problems = [];
  const haveByName = new Map(have.map((c) => [c.name, c]));
  const wantNames = new Set(want.map((c) => c.name));
  for (const col of want) {
    const there = haveByName.get(col.name);
    if (there) {
      problems.push(...changed(table, col, there));
      continue;
    }
    const definition = definitions.get(col.name);
    const why = cannotAdd(col, definition);
    if (why) problems.push(`Table ${table} is missing column ${col.name}, ${why}.`);
    else add.push({ table, column: col.name, definition });
  }
  for (const col of have) {
    if (!wantNames.has(col.name)) problems.push(`Table ${table} has column ${col.name}, which schema.sql does not declare (removed or renamed there).`);
  }
  return { add, problems };
}

async function readColumns(ctx, table) {
  const rows = parseJson(ctx.checked(`the columns of ${table}`, await ctx.wrangler(COLUMN_COMMANDS.columns(table))));
  const results = rows?.[0]?.results;
  if (!Array.isArray(results)) throw new Error(`PRAGMA table_info(${table}) gave no rows list`);
  return shape(results);
}

function stop(ctx, Stop, problems) {
  ctx.item(ITEM, "FAIL", problems[0]);
  throw new Stop([`schema.sql and the database differ in a way the deploy will not change. ${NOT_DEPLOYED}`, ...problems.map((p) => `  ${p}`)].join("\n"));
}

/**
 * Step 3's column check, between applying schema.sql and the deploy. `Stop`
 * is the script's own error, so a stop here ends the run before the Worker
 * deploys, with the checklist printed.
 */
export async function reconcileColumns(ctx, schemaSql, Stop) {
  const declared = declaredColumns(schemaSql);
  const definitions = columnDefinitions(schemaSql);
  const plans = [];
  for (const [table, want] of declared) {
    plans.push(planTable(table, want, await readColumns(ctx, table), definitions.get(table)));
  }
  const problems = plans.flatMap((p) => p.problems);
  if (problems.length) stop(ctx, Stop, problems);
  const adds = plans.flatMap((p) => p.add);
  for (const { table, column, definition } of adds) {
    await ctx.wrangler(COLUMN_COMMANDS.addColumn(table, definition));
    ctx.say(`  Added column ${column} to table ${table} (ALTER TABLE ${table} ADD COLUMN ${definition}).`);
    ctx.item(`Column added ${table}.${column}`, "PASS", `ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
  // The check: every table altered is read again and must now match.
  const altered = [...new Set(adds.map((a) => a.table))];
  const still = [];
  for (const table of altered) still.push(...planTable(table, declared.get(table), await readColumns(ctx, table), definitions.get(table)).problems);
  if (still.length) stop(ctx, Stop, still.map((p) => `After adding columns: ${p}`));
  const detail = `${declared.size} tables, every column as schema.sql declares it${adds.length ? ` (${adds.length} added)` : ""}`;
  ctx.say(`  Columns: ${detail}.`);
  ctx.item(ITEM, "PASS", detail);
}
