/* The ornament's one reading, by hand. node --test. */
import test from "node:test";
import assert from "node:assert/strict";
import { gloryOf } from "../web/flourish.js";

test("glory is the best star he earned: best, then beat, then clean, else plain", () => {
  assert.equal(gloryOf(["Personal best", "Beat your last", "97% clean"]), "best");
  assert.equal(gloryOf(["Beat your last", "97% clean"]), "beat");
  assert.equal(gloryOf(["97% clean", "15 clean in a row"]), "clean");
  assert.equal(gloryOf([]), "plain");
});
