/* The cadence tip names real pairs, never "the slow pairs above" when none are listed. node --test. */
import test from "node:test";
import assert from "node:assert/strict";
import { timingProfile, cadenceTip } from "../web/score.js";

test("the slowest two pairs are named even when none is slow past the cut", () => {
  // "abab cdcd" style: every pair typed twice, all near the median, so no slow pair.
  const keys = "the then that them";
  let t = 0;
  const events = [...keys].map((k, i) => ({ t: (t += i % 3 ? 100 : 120), kind: "char", key: k }));
  const p = timingProfile(events);
  assert.equal(p.slowPairs.length, 0);
  assert.equal(p.slowestPairs.length, 2);
  assert.ok(p.slowestPairs.every((d) => /^[a-z]{2}$/.test(d.pair) && d.ms > 0));
});

test("the tip names the pairs, or says what to type when there are none", () => {
  assert.match(cadenceTip([{ pair: "br", ms: 180 }, { pair: "mu", ms: 160 }]), /slowest pairs this round were br \(180 ms\) and mu \(160 ms\)\. Type each ten times/);
  assert.match(cadenceTip([{ pair: "br", ms: 180 }]), /were br \(180 ms\)\. Type it ten times/);
  assert.match(cadenceTip([]), /Type a line of your weak letters/);
  assert.doesNotMatch(cadenceTip([]), /above/);
});
