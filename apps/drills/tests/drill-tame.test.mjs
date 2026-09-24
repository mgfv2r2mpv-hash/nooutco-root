/* The nemesis drill, item 8 of the overnight plan: thirty seconds on the
 * thing his own numbers say is costing him, offered and never forced, with a
 * line that teaches the fingering. Its numbers stay out of history. node --test. */
import test from "node:test";
import assert from "node:assert/strict";
import { fingerOf, tameTarget, tameLesson, wordPool, tameText, tameDrill, tameReport, tameEntry, appendTame, TAME_WORDS, TAME_LOG_MAX } from "../web/tame.js";
import { trophyCase } from "../web/trophies.js";
import { nemeses } from "../web/nemeses.js";
import { PASSAGES } from "../web/passages.js";

const at = (d, i = 0) => new Date(2026, 8, d, 9, i * 2).toISOString();
const rec = (d, i, extra = {}) => ({ at: at(d, i), minutes: 1, nwam: 80, gwam: 84, words: 84, accuracy: 0.96, mode: "answer", ...extra });
/* Eight drills missing u on a quarter of its presses: the engine spots nem-key-u. */
const missU = Array.from({ length: 8 }, (_, i) => rec(10, i, { keys: { u: { presses: 12, misses: 3 } } }));
const seq = (xs) => { let i = 0; return () => xs[i++ % xs.length]; };
const texts = PASSAGES.map((p) => p.text);

test("fingers and rows come from a US keyboard", () => {
  assert.deepEqual(fingerOf("w"), { finger: "left ring finger", row: "top", col: 1, hand: "left" });
  assert.equal(fingerOf("m").finger, "right index finger");
  assert.equal(fingerOf("m").row, "bottom");
  assert.equal(fingerOf("b").hand, "left");
  assert.equal(fingerOf("u").finger, "right index finger");
  assert.equal(fingerOf("1"), null);
});

test("the target is the newest untamed nemesis, else his trickiest key, else nothing", () => {
  const t = tameTarget(missU, ["w"]);
  assert.equal(t.id, "nem-key-u");
  assert.equal(t.kind, "key");
  assert.equal(t.letter, "u");
  assert.equal(tameTarget([], ["w", "m"]).id, "tricky-w");
  assert.equal(tameTarget([], []), null);
  assert.equal(tameTarget([], ["."]), null, "a punctuation key is not a letter drill");
  // Tamed: twelve clean drills since the spotting. The drill falls back to the tricky key.
  const tamed = [...missU, ...Array.from({ length: 12 }, (_, i) => rec(11, i, { keys: { u: { presses: 12, misses: 0 } } }))];
  assert.ok(nemeses(tamed).find((n) => n.id === "nem-key-u").unlocked);
  assert.equal(tameTarget(tamed, ["m"]).id, "tricky-m");
});

test("a confusion drills the letter he meant, a pair drills the pair", () => {
  const conf = Array.from({ length: 3 }, (_, i) => rec(10, i, { confusions: ["m>n"] }));
  const t = tameTarget(conf, []);
  assert.equal(t.kind, "confuse");
  assert.equal(t.letter, "m");
  assert.equal(t.hit, "n");
  assert.match(tameLesson(t), /hitting N for M\. M is your right index finger, bottom row; N is your right index finger, bottom row/);
  const pairs = Array.from({ length: 3 }, (_, i) => rec(10, i, { slowPairs: ["br"] }));
  const p = tameTarget(pairs, []);
  assert.equal(p.kind, "pair");
  assert.equal(p.key, "br");
  assert.match(tameLesson(p), /One finger does both/, "b and r are both the left index");
});

test("the lesson for a refused capital names the other pinky", () => {
  assert.match(tameLesson({ kind: "refused", key: "t", letter: "t" }), /T is a left-hand key, so your right pinky holds the right Shift/);
  assert.match(tameLesson({ kind: "refused", key: "m", letter: "m" }), /right-hand key, so your left pinky holds the left Shift/);
  assert.match(tameLesson({ kind: "key", key: "w", letter: "w" }), /W is your left ring finger, top row/);
});

test("the drill text is real words from the passages, two in three carrying the target", () => {
  const pool = wordPool(texts);
  assert.ok(pool.length > 500);
  const text = tameText({ kind: "key", key: "w", letter: "w" }, pool, seq([0.1, 0.4, 0.7, 0.2, 0.9, 0.55]));
  const words = text.split(" ");
  assert.equal(words.length, TAME_WORDS);
  for (const w of words) assert.ok(pool.includes(w), `${w} is not from a passage`);
  assert.ok(words.filter((w) => w.includes("w")).length >= (TAME_WORDS * 2) / 3 - 1);
  for (let i = 1; i < words.length; i++) assert.notEqual(words[i], words[i - 1], "never the same word twice in a row");
  assert.ok(/^[\x20-\x7e]+$/.test(text));
});

test("a refused capital is drilled with capitals, a pair with the pair", () => {
  const pool = wordPool(texts);
  const caps = tameText({ kind: "refused", key: "t", letter: "t" }, pool, seq([0.3, 0.6, 0.1])).split(" ");
  assert.ok(caps.filter((w) => /^T/.test(w)).length >= 29);
  const pair = tameText({ kind: "pair", key: "br", letter: "br" }, pool, seq([0.3, 0.6, 0.1])).split(" ");
  assert.ok(pair.filter((w) => w.includes("br")).length >= 29);
  assert.equal(tameText({ kind: "pair", key: "qz" }, pool), "", "no word, no drill");
  assert.equal(tameDrill({ id: "x", kind: "pair", key: "qz", name: "x" }, texts), null);
});

test("the drill is a passage the copy round can run, and says it is practice only", () => {
  const d = tameDrill(tameTarget(missU, []), texts, seq([0.5, 0.2]));
  assert.equal(d.id, "tame-nem-key-u");
  assert.equal(d.kind, "tame");
  assert.match(d.source, /Practice only: stays out of your bests and bands/);
  assert.match(d.lesson, /U is your right index finger, top row/);
  assert.equal(d.outline, null);
});

test("the report reads the target from the score's numbers", () => {
  const key = { kind: "key", key: "u", letter: "u" };
  assert.deepEqual(tameReport(key, { keys: { u: { presses: 20, misses: 1 } } }), { line: "U: 1 missed of 20 presses (5%).", clean: false });
  assert.equal(tameReport(key, { keys: { u: { presses: 20, misses: 0 } } }).clean, true);
  assert.equal(tameReport(key, { keys: { u: { presses: 4, misses: 0 } } }).clean, false, "too few presses to call it clean");
  const pair = { kind: "pair", key: "br" };
  assert.match(tameReport(pair, { timing: { slowPairs: [{ pair: "br", ms: 240 }] } }).line, /BR still ran slow, 240 ms/);
  assert.equal(tameReport(pair, { timing: { slowPairs: [] } }).clean, true);
  const conf = { kind: "confuse", letter: "m", hit: "n" };
  assert.match(tameReport(conf, { tricky: { confusions: [{ meant: "m", hit: "n", count: 2 }] } }).line, /N for M 2 times/);
  assert.equal(tameReport(conf, { tricky: { confusions: [] } }).clean, true);
  const refused = { kind: "refused", key: "t" };
  assert.match(tameReport(refused, { refused: { keys: [{ key: "T", count: 3 }] } }).line, /Capital T refused 3 times/);
});

test("the log is numbers only, capped, and never rewrites what is there", () => {
  const t = { id: "nem-key-u", kind: "key", key: "u", letter: "u" };
  const e = tameEntry(t, { nwam: 70, gwam: 74, accuracy: 0.98, keys: { u: { presses: 20, misses: 0 } } }, at(12));
  assert.deepEqual(Object.keys(e).sort(), ["accuracy", "at", "clean", "gwam", "kind", "minutes", "mode", "nwam", "target"]);
  assert.equal(e.clean, true);
  const log = [e];
  const next = appendTame(log, { ...e, at: at(12, 1) });
  assert.equal(log.length, 1, "the old log is not mutated");
  assert.equal(next.length, 2);
  assert.equal(appendTame(Array.from({ length: TAME_LOG_MAX }, () => e), e).length, TAME_LOG_MAX);
  assert.deepEqual(appendTame(undefined, e), [e]);
});

test("drills earn their own trophies, with true dates, and never tame a nemesis or move a band", () => {
  const t = { id: "nem-key-u", kind: "key", key: "u", letter: "u" };
  const drill = (d, i, clean) => ({ ...tameEntry(t, { nwam: 140, gwam: 150, accuracy: 1, keys: { u: { presses: clean ? 30 : 30, misses: clean ? 0 : 5 } } }, at(d, i)) });
  const tame = [drill(12, 0, false), drill(12, 1, true), ...Array.from({ length: 12 }, (_, i) => drill(13, i, true))];
  const withLog = trophyCase(missU, tame), without = trophyCase(missU);
  const get = (c, id) => c.find((x) => x.id === id);
  assert.equal(get(withLog, "tame-n-1").unlocked, at(12, 0));
  assert.equal(get(withLog, "tame-clean-1").unlocked, at(12, 1));
  assert.equal(get(withLog, "tame-n-10").unlocked, at(13, 7));
  assert.equal(get(without, "tame-n-1").unlocked, null);
  // A 140 NWAM word list is not a real round: no speed or band trophy moves, and the nemesis stays untamed.
  for (const x of without) if (!x.id.startsWith("tame-")) assert.equal(get(withLog, x.id).unlocked, x.unlocked, x.id);
  assert.equal(get(withLog, "nem-key-u").unlocked, null);
  // The order it arrives in does not change the dates.
  assert.deepEqual(trophyCase(missU, tame.slice().reverse()), withLog);
});
