// Carrying his drills from one Mac to the other: nothing from either side is lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  carryOver, looksLikeData, mergeByAt, mergeEarned, mergeGames, mergeQueue,
  mergeSettings, mergeShelf, mergeWords, newestAt,
} from "../app/carry-over.mjs";
import { HISTORY_MAX } from "../web/store.js";
import { RUNS_KEPT } from "../web/minigames.js";
import { TAME_LOG_MAX } from "../web/tame.js";

const round = (at, extra = {}) => ({ at, mode: "answer", nwam: 90, ...extra });
const dir = () => mkdtempSync(join(tmpdir(), "carry-"));

function folder(data = {}) {
  const d = dir();
  if (data.history) writeFileSync(join(d, "history.json"), JSON.stringify(data.history));
  if (data.lexicon) writeFileSync(join(d, "lexicon.json"), JSON.stringify(data.lexicon));
  if (data.settings) writeFileSync(join(d, "settings.json"), JSON.stringify(data.settings));
  if (data.queue) writeFileSync(join(d, "expert-queue.jsonl"), data.queue.join("\n") + "\n");
  if (data.kept) {
    mkdirSync(join(d, "kept"), { recursive: true });
    for (const [name, text] of Object.entries(data.kept)) writeFileSync(join(d, "kept", name), text);
  }
  return d;
}

test("both Macs' rounds come together, one per timestamp, oldest first", () => {
  const mine = [round("2026-09-24T10:00:00.000Z"), round("2026-09-24T12:00:00.000Z")];
  const theirs = [round("2026-09-23T09:00:00.000Z"), round("2026-09-24T10:00:00.000Z")];
  const out = mergeByAt(mine, theirs);
  assert.deepEqual(out.map((r) => r.at), [
    "2026-09-23T09:00:00.000Z", "2026-09-24T10:00:00.000Z", "2026-09-24T12:00:00.000Z",
  ]);
});

test("the same round on both sides keeps the fuller record", () => {
  const thin = round("2026-09-24T10:00:00.000Z");
  const full = round("2026-09-24T10:00:00.000Z", { accuracy: 98, outline: "G.4", pauses: [] });
  assert.equal(mergeByAt([thin], [full])[0].accuracy, 98);
  assert.equal(mergeByAt([full], [thin])[0].accuracy, 98);
});

test("a merged history over the cap keeps the newest rounds", () => {
  const many = Array.from({ length: HISTORY_MAX + 40 }, (_, i) => round(`2026-01-01T00:${String(i % 60).padStart(2, "0")}:${String(Math.floor(i / 60)).padStart(2, "0")}.000Z`));
  const out = mergeByAt(many, [round("2026-09-24T10:00:00.000Z")], HISTORY_MAX);
  assert.equal(out.length, HISTORY_MAX);
  assert.equal(out[out.length - 1].at, "2026-09-24T10:00:00.000Z");
});

test("his clinical words from both Macs make one set", () => {
  assert.deepEqual(mergeWords(["mand", "tact"], ["tact", "echoic"]), ["echoic", "mand", "tact"]);
});

test("a shelved passage keeps the later entry, which holds the newer count", () => {
  const older = { id: "p-token", at: "2026-09-20T10:00:00.000Z", round: 2 };
  const newer = { id: "p-token", at: "2026-09-23T10:00:00.000Z", round: 7 };
  assert.deepEqual(mergeShelf([older], [newer]), [newer]);
  assert.deepEqual(mergeShelf([newer], [older]), [newer]);
});

test("a game trophy keeps the day it was first earned", () => {
  const mine = { "pair-fast": "2026-09-24" };
  const theirs = { "pair-fast": "2026-09-21", "river-steady": "2026-09-22" };
  assert.deepEqual(mergeEarned(mine, theirs), { "pair-fast": "2026-09-21", "river-steady": "2026-09-22" });
});

test("mini game runs merge per pair and per game, under the same cap", () => {
  const mine = { pairs: { we: [{ at: "2026-09-24T10:00:00.000Z", secs: 9 }] }, shifty: [], river: [], earned: {} };
  const theirs = {
    pairs: { we: [{ at: "2026-09-23T10:00:00.000Z", secs: 11 }], mb: [{ at: "2026-09-23T11:00:00.000Z", secs: 8 }] },
    shifty: Array.from({ length: RUNS_KEPT + 5 }, (_, i) => ({ at: `2026-09-2${i % 9}T0${i % 9}:00:00.000Z`, secs: i })),
    river: [], earned: {},
  };
  const out = mergeGames(mine, theirs);
  assert.deepEqual(out.pairs.we.map((r) => r.secs), [11, 9]);
  assert.equal(out.pairs.mb.length, 1);
  assert.ok(out.shifty.length <= RUNS_KEPT);
});

test("the tame log merges by timestamp and stays under its cap", () => {
  const entry = (i) => ({ at: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`, mode: "tame", target: `t${i}` });
  const mine = Array.from({ length: TAME_LOG_MAX }, (_, i) => entry(i));
  const out = mergeSettings({ tame: mine }, { tame: [entry(0), entry(9999)] });
  assert.ok(out.tame.length <= TAME_LOG_MAX);
});

test("the plain preferences come from the Mac with the newer round", () => {
  const mine = { history: [round("2026-09-20T10:00:00.000Z")], settings: { minutes: 1, strictShift: false } };
  const theirs = { history: [round("2026-09-24T10:00:00.000Z")], settings: { minutes: 3, strictShift: true } };
  const theirsNewer = mergeSettings(mine.settings, theirs.settings, { mineNewer: newestAt(mine.history) >= newestAt(theirs.history) });
  assert.equal(theirsNewer.minutes, 3);
  assert.equal(theirsNewer.strictShift, true);
});

test("a preference only one Mac has is kept either way", () => {
  assert.equal(mergeSettings({ copyDefault: true }, {}, { mineNewer: false }).copyDefault, true);
  assert.equal(mergeSettings({}, { bandsNoted: true }, { mineNewer: true }).bandsNoted, true);
});

test("the expert queue dedupes and runs oldest first", () => {
  const a = JSON.stringify({ at: "2026-09-23T10:00:00.000Z", answer: "one" });
  const b = JSON.stringify({ at: "2026-09-24T10:00:00.000Z", answer: "two" });
  assert.deepEqual(mergeQueue([b, a], [a]), [a, b]);
});

test("a folder that is not the app's data is refused", () => {
  assert.equal(looksLikeData(dir()), false);
  assert.throws(() => carryOver(dir(), dir()), /does not hold/);
});

test("a whole carry over merges the files, copies new answers and never overwrites one already here", () => {
  const from = folder({
    history: [round("2026-09-23T09:00:00.000Z")],
    lexicon: ["mand"],
    settings: { minutes: 3, words: ["gambler"] },
    queue: [JSON.stringify({ at: "2026-09-23T09:00:00.000Z", answer: "theirs" })],
    kept: { "20260923T090000000-G4.txt": "their answer", "20260924T120000000-B2.txt": "theirs, same name" },
  });
  const into = folder({
    history: [round("2026-09-24T12:00:00.000Z")],
    lexicon: ["tact"],
    settings: { minutes: 1 },
    kept: { "20260924T120000000-B2.txt": "mine, do not touch" },
  });

  const r = carryOver(from, into);

  assert.deepEqual(JSON.parse(readFileSync(join(into, "history.json"), "utf8")).map((x) => x.at), [
    "2026-09-23T09:00:00.000Z", "2026-09-24T12:00:00.000Z",
  ]);
  assert.deepEqual(JSON.parse(readFileSync(join(into, "lexicon.json"), "utf8")), ["mand", "tact"]);
  const settings = JSON.parse(readFileSync(join(into, "settings.json"), "utf8"));
  assert.equal(settings.minutes, 1, "this Mac has the newer round, so its clock stands");
  assert.deepEqual(settings.words, ["gambler"]);
  assert.equal(readFileSync(join(into, "kept", "20260923T090000000-G4.txt"), "utf8"), "their answer");
  assert.equal(readFileSync(join(into, "kept", "20260924T120000000-B2.txt"), "utf8"), "mine, do not touch");
  assert.equal(readdirSync(join(into, "kept")).length, 2);
  assert.equal(r.kept.copied, 1);
  assert.ok(existsSync(r.backup), "the destination was backed up first");
  assert.deepEqual(JSON.parse(readFileSync(join(r.backup, "history.json"), "utf8")).map((x) => x.at), ["2026-09-24T12:00:00.000Z"]);
});

test("a dry run writes nothing at all", () => {
  const from = folder({ history: [round("2026-09-23T09:00:00.000Z")], kept: { "a.txt": "x" } });
  const into = folder({ history: [round("2026-09-24T12:00:00.000Z")] });
  const before = readdirSync(into).sort();
  const r = carryOver(from, into, { dry: true });
  assert.equal(r.backup, null);
  assert.equal(r.rounds.after, 2);
  assert.equal(r.kept.copied, 1);
  assert.deepEqual(readdirSync(into).sort(), before);
  assert.deepEqual(JSON.parse(readFileSync(join(into, "history.json"), "utf8")).map((x) => x.at), ["2026-09-24T12:00:00.000Z"]);
});

test("an empty Mac takes the other one's drills whole", () => {
  const from = folder({ history: [round("2026-09-23T09:00:00.000Z"), round("2026-09-24T10:00:00.000Z")], lexicon: ["mand"] });
  const into = folder({});
  mkdirSync(join(into, "kept"), { recursive: true });
  const r = carryOver(from, into);
  assert.equal(r.rounds.after, 2);
  assert.equal(r.usedPreferencesFrom, "the other Mac");
});
