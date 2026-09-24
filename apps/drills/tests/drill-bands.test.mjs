/* The bands as a road: the highest band reached, a band opened for the first
 * time, and the road on the home screen. node --test. */
import test from "node:test";
import assert from "node:assert/strict";
import { bandOf, highestBand, bandUp, bandRoad, LEVEL_UP_MIN_ROUNDS } from "../web/bands.js";
import { BANDS, rate } from "../web/score.js";

const rec = (nwam, accuracy = 0.98, extra = {}) => ({ nwam, accuracy, minutes: 1, ...extra });
const name = (i) => BANDS[i].name;

test("a record's band is worked out from its numbers, never from the name stored on it", () => {
  // Made before the upper bands existed: 92 NWAM stored as Professional.
  assert.equal(name(bandOf(rec(92, 0.98, { rating: "Professional" }))), "Expert");
  // Under the accuracy gate it drops a band, as rate() does.
  assert.equal(name(bandOf(rec(92, 0.9))), "Professional");
  // No accuracy on an old record reads as clean, not as gated.
  assert.equal(name(bandOf({ nwam: 92 })), "Expert");
  assert.equal(bandOf(rec(0)), -1);
  assert.equal(bandOf({ accuracy: 1 }), -1);
  assert.equal(bandOf(null), -1);
});

test("the highest band is the best any record reached", () => {
  assert.equal(highestBand([]), -1);
  assert.equal(name(highestBand([rec(50), rec(101), rec(70)])), "Elite");
});

test("a round opens a band only past the best band of the prior rounds of its kind", () => {
  const prior = [rec(80), rec(88), rec(90)];
  const up = bandUp(rate(97, 0.98), prior);
  assert.deepEqual(up, { band: "Elite", min: 95, from: "Expert" });
  // The same band again is not a level up, and neither is a lower one.
  assert.equal(bandUp(rate(93, 0.98), prior), null);
  assert.equal(bandUp(rate(70, 0.98), prior), null);
  // Gated by accuracy, 97 NWAM is Expert: nothing opened.
  assert.equal(bandUp(rate(97, 0.9), prior), null);
});

test("the first few rounds never throw a level up", () => {
  const two = [rec(40), rec(42)];
  assert.equal(LEVEL_UP_MIN_ROUNDS, 3);
  assert.equal(bandUp(rate(90, 1), two), null);
  assert.ok(bandUp(rate(90, 1), [...two, rec(41)]));
  // Records with no numbers do not count toward the three.
  assert.equal(bandUp(rate(90, 1), [...two, { accuracy: 1 }]), null);
});

test("old records named Professional do not fake a level up his numbers already reached", () => {
  const old = [rec(99, 0.98, { rating: "Professional" }), rec(96, 0.98, { rating: "Professional" }), rec(90, 0.98, { rating: "Professional" })];
  assert.equal(bandUp(rate(98, 0.98), old), null);
  assert.equal(bandUp(rate(106, 0.98), old).band, "Master");
});

test("the road runs bottom band first: reached, the next one, then ahead", () => {
  assert.equal(bandRoad([]), null);
  const road = bandRoad([rec(60), rec(92)]);
  assert.equal(road.bands.length, BANDS.length);
  assert.equal(road.bands[0].name, "Amateur");
  assert.equal(road.bands.at(-1).name, "Stenographer");
  const by = Object.fromEntries(road.bands.map((b) => [b.name, b.state]));
  assert.equal(by.Amateur, "reached");
  assert.equal(by.Expert, "reached");
  assert.equal(by.Elite, "next");
  assert.equal(by.Master, "ahead");
  assert.equal(road.line, "Highest band so far: Expert. Next: Elite, at 95 NWAM.");
  const top = bandRoad([rec(130)]);
  assert.equal(top.next, null);
  assert.match(top.line, /the top of the road/);
  assert.ok(top.bands.every((b) => b.state === "reached"));
});
