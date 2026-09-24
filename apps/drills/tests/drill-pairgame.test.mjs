/* The pair game's word picker and timing, by hand. node --test. */
import test from "node:test";
import assert from "node:assert/strict";
import { pickWords, pairMs } from "../web/pairgame.js";

test("ten words holding the pair, field words first, no repeats, dictionary fills the rest", () => {
  const field = ["The Bravo brief brought a bridge, bright", "brief brief"];
  const dictionary = ["abracadabra", "bread", "brow", "broad", "brick", "bring", "brisk", "brute", "brunch", "brand", "cobra", "zebra", "br", "brooooooooooklyn"];
  const w = pickWords("br", { field, dictionary, rand: () => 0.5 });
  assert.equal(w.length, 10);
  assert.equal(new Set(w).size, 10);
  assert.ok(w.every((x) => x.includes("br") && x.length >= 3 && x.length <= 11));
  for (const f of ["bravo", "brief", "brought", "bridge", "bright"]) assert.ok(w.includes(f), f);
  assert.deepEqual(pickWords("b", { dictionary }), []);
});

test("the pair's time is the mean gap between its two letters", () => {
  const ev = [{ t: 0, kind: "char", key: "b" }, { t: 150, kind: "char", key: "r" }, { t: 300, kind: "char", key: "a" }, { t: 400, kind: "char", key: "B" }, { t: 450, kind: "char", key: "r" }];
  assert.equal(pairMs(ev, "br"), 100);
  assert.equal(pairMs(ev, "zz"), null);
});
