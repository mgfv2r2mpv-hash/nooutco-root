import test from "node:test";
import assert from "node:assert/strict";

import { TOOL_REGISTER, KNOWN_TOOLS, registerFor } from "../src/registers.js";

// A register is half of a primary key, so the map is not a lookup table that
// can be wrong quietly. These pin the two properties that make it safe to key
// rows on: every tool has a decided class, and an undecided tool cannot share a
// pool with anything.

test("every tool the engine can run has a decided register", () => {
  for (const tool of KNOWN_TOOLS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(TOOL_REGISTER, tool),
      `${tool} has no register. Adding a tool is a decision about which document `
        + `class it writes in, and it has to be made here rather than defaulted.`,
    );
  }
});

test("the map names no tool the engine cannot run", () => {
  for (const tool of Object.keys(TOOL_REGISTER)) {
    assert.ok(
      KNOWN_TOOLS.includes(tool),
      `${tool} is mapped but is not a known tool, so the two lists have drifted.`,
    );
  }
});

test("the two clinical narrative tools share one pool", () => {
  // This is the whole point of per-register over per-tool. sup carried 57 of
  // his 66 corrections and assess 6; keyed per tool, assess would have sat
  // under the five-evidence bar and learned nothing.
  assert.equal(registerFor("sup"), registerFor("assess"));
  assert.equal(registerFor("sup"), "clinical-narrative");
});

test("a tool that writes a different document class does not share that pool", () => {
  const narrative = registerFor("sup");
  assert.notEqual(registerFor("sap"), narrative);
  assert.notEqual(registerFor("parent"), narrative);
  assert.notEqual(registerFor("bt"), narrative);
});

test("each register is a distinct pool where the classes differ", () => {
  assert.equal(registerFor("sap"), "clinical-instrument");
  assert.equal(registerFor("parent"), "interpersonal");
  assert.equal(registerFor("bt"), "technician-note");
});

test("an unmapped tool falls back to its own id, never to a shared bucket", () => {
  // A shared "unclassified" pool would recreate exactly the bleed this change
  // exists to stop, silently, for whichever tools were added without a
  // decision. Falling back to the tool id keeps an undecided tool alone.
  assert.equal(registerFor("brandnew"), "brandnew");
  assert.notEqual(registerFor("brandnew"), registerFor("alsonew"));
});

test("a missing or non-string tool is its own pool and not an empty key", () => {
  // These reach a primary key, so none of them may come back falsy.
  for (const bad of [undefined, null, "", 0, {}, []]) {
    assert.equal(registerFor(bad), "unknown");
  }
});
