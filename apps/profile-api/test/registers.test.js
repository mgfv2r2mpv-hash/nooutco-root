import test from "node:test";
import assert from "node:assert/strict";

import { TOOL_REGISTER, KNOWN_TOOLS, registerFor } from "../src/registers.js";

/* The register is half of a PRIMARY KEY, so the ways it can go wrong are all
   silent: a tool with no entry, a fallback that quietly pools two tools
   together, or a value that shifts between requests. Each of those would
   fragment or merge a technician's card without anything failing. */

test.describe("every tool has a decided register", () => {
  test("no tool is missing an entry", () => {
    const missing = KNOWN_TOOLS.filter((t) => !TOOL_REGISTER[t]);
    assert.deepEqual(missing, [], "add the tool to TOOL_REGISTER and decide its document class");
  });

  test("no entry exists for a tool that does not", () => {
    const extra = Object.keys(TOOL_REGISTER).filter((t) => !KNOWN_TOOLS.includes(t));
    assert.deepEqual(extra, []);
  });

  test("SAP and the supervision note do not share a pool", () => {
    // This is the question he asked on 2026-08-06, as an assertion.
    assert.notEqual(registerFor("sap"), registerFor("sup"));
  });

  test("assess pools with sup, because both are clinical narrative", () => {
    assert.equal(registerFor("assess"), registerFor("sup"));
  });

  test("bt is on its own, since a technician signs that note", () => {
    for (const other of ["sap", "sup", "parent", "assess"]) {
      assert.notEqual(registerFor("bt"), registerFor(other));
    }
  });
});

test.describe("the fallback cannot silently merge two tools", () => {
  test("an unmapped tool gets a pool of its own, not a shared bucket", () => {
    // The tempting fallback is a single "unclassified". It would pool every
    // future tool together, which is the exact bleed the register exists to
    // stop, and it would do it without anything failing.
    assert.notEqual(registerFor("brand-new-tool"), registerFor("another-new-tool"));
    assert.equal(registerFor("brand-new-tool"), "brand-new-tool");
  });

  test("a missing tool is 'unknown' rather than undefined", () => {
    for (const bad of [null, undefined, "", 0, {}]) {
      assert.equal(registerFor(bad), "unknown");
    }
  });

  test("the same tool always maps to the same register", () => {
    // Nothing here reads KV or the network, which is why this holds. Deriving
    // the register from the voice block would make it depend on a fetch that
    // can fail, and a failed fetch would write rows under a different key.
    for (const t of KNOWN_TOOLS) assert.equal(registerFor(t), registerFor(t));
  });
});
