import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import worker from "../src/index.js";
import {
  USAGE_KINDS, MAX_QUESTIONS_PER_SEND, readCounts, ratesOf, summariseTriageUsage,
} from "../src/triage-usage.js";
import { d1Sqlite } from "./helpers/d1-sqlite.js";

/* The BT usage report: how each technician answered NoMe's questions, per tool.
 * Every kid, tool and count below is invented. */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(path.join(HERE, "../schema.sql"), "utf8");
const AUDIT_SOURCE = readFileSync(path.join(HERE, "../../tools/_worker.js"), "utf8");
const ENGINE_SOURCE = readFileSync(path.join(HERE, "../../tools/notes/bcba/engine.jsx"), "utf8");

const send = (kid, tool, counts, extra = {}) => ({
  kid, tool, data: JSON.stringify({ round: 1, ...counts, ...extra }),
});

test("the four kinds are the four the Pages worker keeps, and the four the engine counts", () => {
  const m = AUDIT_SOURCE.match(/triage_answers:\s*\[([^\]]*)\]/);
  assert.ok(m, "AUDIT_INTEGER_KEYS.triage_answers not found in _worker.js");
  const kept = m[1].match(/"([a-z_]+)"/g).map((s) => s.slice(1, -1)).filter((k) => k !== "round");
  assert.deepEqual([...kept].sort(), [...USAGE_KINDS].sort());
  const counted = ENGINE_SOURCE.match(/const counts = \{([^}]*)\}/);
  assert.ok(counted, "the engine's triage_answers counts were not found");
  for (const kind of USAGE_KINDS) assert.match(counted[1], new RegExp(`\\b${kind}: 0\\b`));
});

test("a row is read by the four kind names and nothing else", () => {
  const counts = readCounts(JSON.stringify({
    accepted_as_is: 2, edited: 1, own_words: 0, not_refined: 1, round: 3, note: "a sentence",
  }));
  assert.deepEqual(counts, { accepted_as_is: 2, edited: 1, own_words: 0, not_refined: 1 });
  assert.equal(Object.keys(counts).length, USAGE_KINDS.length);
});

test("a missing kind reads as zero, and a Send with no questions is not a reading", () => {
  assert.deepEqual(readCounts({ edited: 2 }), { accepted_as_is: 0, edited: 2, own_words: 0, not_refined: 0 });
  assert.equal(readCounts({ round: 2 }), null);
});

test("one bad count drops the whole Send rather than tilting the rates", () => {
  for (const bad of [-1, 1.5, "3", null, MAX_QUESTIONS_PER_SEND + 1, Number.NaN]) {
    assert.equal(readCounts({ accepted_as_is: 2, edited: bad }), null, `edited: ${String(bad)}`);
  }
  assert.equal(readCounts("not json"), null);
  assert.equal(readCounts("[1,2]"), null);
  assert.ok(readCounts({ accepted_as_is: MAX_QUESTIONS_PER_SEND }), "the bound itself is a reading");
});

test("rates are over questions, not over Sends, and empty is null rather than zero", () => {
  assert.deepEqual(ratesOf({ accepted_as_is: 3, edited: 1, own_words: 0, not_refined: 0 }),
    { accepted_as_is: 0.75, edited: 0.25, own_words: 0, not_refined: 0 });
  assert.deepEqual(ratesOf({ accepted_as_is: 0, edited: 0, own_words: 0, not_refined: 0 }),
    { accepted_as_is: null, edited: null, own_words: null, not_refined: null });
});

test("the report folds per technician and per tool, with a cohort line per tool", () => {
  const report = summariseTriageUsage([
    send("pw:avery", "bt", { accepted_as_is: 3, edited: 1, own_words: 0, not_refined: 0 }),
    send("pw:avery", "bt", { accepted_as_is: 1, edited: 0, own_words: 2, not_refined: 1 }),
    send("pw:avery", "sup", { accepted_as_is: 0, edited: 0, own_words: 1, not_refined: 0 }),
    send("pw:blake", "bt", { accepted_as_is: 0, edited: 0, own_words: 0, not_refined: 2 }),
  ]);

  assert.equal(report.skipped, 0);
  assert.deepEqual(report.technicians.map((t) => t.kid), ["pw:avery", "pw:blake"]);

  const avery = report.technicians[0];
  const bt = avery.tools.find((t) => t.tool === "bt");
  assert.equal(bt.sends, 2);
  assert.equal(bt.questions, 8);
  assert.deepEqual(bt.counts, { accepted_as_is: 4, edited: 1, own_words: 2, not_refined: 1 });
  assert.equal(bt.rates.accepted_as_is, 0.5);
  assert.equal(avery.total.sends, 3);
  assert.equal(avery.total.questions, 9);
  assert.equal(avery.total.counts.own_words, 3);

  const cohortBt = report.tools.find((t) => t.tool === "bt");
  assert.equal(cohortBt.sends, 3);
  assert.equal(cohortBt.questions, 10);
  assert.equal(cohortBt.counts.not_refined, 3);
});

test("rows that are not readings are counted as skipped, never folded", () => {
  const report = summariseTriageUsage([
    send("pw:avery", "bt", { accepted_as_is: 1 }),
    { kid: "", tool: "bt", data: JSON.stringify({ accepted_as_is: 1 }) },
    { kid: "pw:avery", tool: "bt", data: "{" },
    null,
  ]);
  assert.equal(report.skipped, 3);
  assert.equal(report.technicians.length, 1);
  assert.equal(report.technicians[0].total.questions, 1);
});

test("the report holds no string but a kid, a tool id and a kind name", () => {
  const report = summariseTriageUsage([
    send("pw:avery", "bt", { accepted_as_is: 1, edited: 1 }, { own: "Client hit peer at 10:15" }),
  ]);
  const strings = [];
  const walk = (v, key) => {
    if (key) strings.push(key);
    if (typeof v === "string") strings.push(v);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(report);
  const allowed = new Set([
    "pw:avery", "bt", "all", ...USAGE_KINDS,
    "technicians", "tools", "skipped", "kid", "tool", "total", "sends", "questions", "counts", "rates",
  ]);
  for (const s of strings) assert.ok(allowed.has(s) || /^\d+$/.test(s), `unexpected string in the report: ${s}`);
});

test("/triage-usage reads only triage_answers rows inside the window, through real SQL", async () => {
  const DB = d1Sqlite(SCHEMA);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const insert = DB.sqlite.prepare("INSERT INTO usage_metric (kid, tool, ts, type, data) VALUES (?, ?, ?, ?, ?)");
  insert.run("pw:avery", "bt", now - day, "triage_answers", JSON.stringify({ accepted_as_is: 2, edited: 1, own_words: 1, not_refined: 0, round: 1 }));
  insert.run("pw:avery", "bt", now - 40 * day, "triage_answers", JSON.stringify({ accepted_as_is: 9, edited: 0, own_words: 0, not_refined: 0, round: 1 }));
  insert.run("pw:avery", "bt", now - day, "note_copied", JSON.stringify({ edited: 120, seconds: 40 }));

  const res = await worker.fetch(new Request("https://profile.internal/triage-usage?days=30"), { DB });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.windowDays, 30);
  assert.equal(body.capped, false);
  assert.equal(body.technicians.length, 1);
  assert.deepEqual(body.technicians[0].total.counts, { accepted_as_is: 2, edited: 1, own_words: 1, not_refined: 0 });

  const wide = await (await worker.fetch(new Request("https://profile.internal/triage-usage?days=60"), { DB })).json();
  assert.equal(wide.technicians[0].total.counts.accepted_as_is, 11);
});

test("/triage-usage is a read only", async () => {
  const DB = d1Sqlite(SCHEMA);
  const res = await worker.fetch(new Request("https://profile.internal/triage-usage", { method: "POST", body: "{}" }), { DB });
  assert.equal(res.status, 404);
});
