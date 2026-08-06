import test from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeCorrections,
  sanitizeMetrics,
  clampTs,
  cleanKid,
  cleanSlug,
} from "../src/validate.js";

const NOW = 1_800_000_000_000;
const YEAR = 365 * 24 * 60 * 60 * 1000;

// The single claim this whole store rests on is that it cannot hold clinical
// text. These are the tests that make that a claim rather than a hope.
test.describe("nothing that looks like prose survives", () => {
  test("a correction keeps only its allowlisted fields", () => {
    const [out] = sanitizeCorrections(
      [
        {
          feature: "sentence_length",
          direction: -1,
          magnitude: 0.4,
          ts: NOW,
          // Everything below is the shape a leak would take.
          before: "Jacob eloped from the table three times.",
          after: "The client left the table 3x.",
          note: { text: "Jacob eloped" },
          words: ["Jacob", "eloped"],
        },
      ],
      NOW,
    );

    assert.deepEqual(Object.keys(out).sort(), [
      "direction",
      "feature",
      "magnitude",
      "source",
      "ts",
    ]);
    const serialised = JSON.stringify(out);
    assert.ok(!serialised.includes("Jacob"));
    assert.ok(!serialised.includes("eloped"));
  });

  test("a metric drops non-numeric values outright rather than stringifying them", () => {
    const [out] = sanitizeMetrics(
      [
        {
          type: "note_generated",
          data: {
            len_lesson: 128,
            answered: true,
            narrative: "The client eloped twice and was redirected.",
            nested: { note: "Jacob eloped" },
            list: ["Jacob"],
            nothing: null,
            notANumber: NaN,
            infinite: Infinity,
          },
        },
      ],
      NOW,
    );

    assert.deepEqual(out.data, { len_lesson: 128, answered: true });
    const serialised = JSON.stringify(out);
    assert.ok(!serialised.includes("Jacob"));
    assert.ok(!serialised.includes("object Object"));
    assert.ok(!serialised.includes("NaN"));
  });

  test("a hostile key name cannot smuggle a value through", () => {
    const [out] = sanitizeMetrics(
      [{ type: "note_copied", data: { "note text": 1, "../../etc": 2, "__proto__": 3, ok_key: 4 } }],
      NOW,
    );
    assert.deepEqual(out.data, { ok_key: 4 });
  });
});

test("an unknown feature is refused, so the closed list stays closed", () => {
  assert.deepEqual(
    sanitizeCorrections([{ feature: "made_up", direction: 1 }], NOW),
    [],
  );
});

test("opener_variety is on the closed list, in both directions", () => {
  // The browser can measure it; without this it would be measured, sent and
  // then silently dropped here, and the card would never learn it.
  const out = sanitizeCorrections(
    [
      { feature: "opener_variety", direction: 1, magnitude: 0.6, ts: NOW },
      { feature: "opener_variety", direction: -1, magnitude: 0.3, ts: NOW, source: "manual" },
    ],
    NOW,
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((c) => c.direction), [1, -1]);
  assert.deepEqual(out.map((c) => c.source), ["revision", "manual"]);
  assert.deepEqual(Object.keys(out[0]).sort(), [
    "direction",
    "feature",
    "magnitude",
    "source",
    "ts",
  ]);
});

test("an opener_variety correction cannot carry the opening it measured", () => {
  const [out] = sanitizeCorrections(
    [
      {
        feature: "opener_variety",
        direction: 1,
        magnitude: 0.5,
        // The shape a leak would take for this particular feature: the openings
        // themselves are words out of a clinical note.
        openers: ["The behavior technician", "Jacob then"],
        first_words: "The behavior technician",
        distinct: 4,
      },
    ],
    NOW,
  );
  const serialised = JSON.stringify(out);
  assert.ok(!serialised.includes("Jacob"));
  assert.ok(!serialised.includes("behavior"));
  assert.ok(!serialised.includes("openers"));
  assert.ok(!serialised.includes("distinct"));
});

test("a zero or missing direction is not evidence and is dropped", () => {
  assert.deepEqual(sanitizeCorrections([{ feature: "hedging", direction: 0 }], NOW), []);
  assert.deepEqual(sanitizeCorrections([{ feature: "hedging" }], NOW), []);
});

test("direction is normalised to exactly -1 or 1", () => {
  const out = sanitizeCorrections(
    [
      { feature: "hedging", direction: 99 },
      { feature: "contractions", direction: -0.2 },
    ],
    NOW,
  );
  assert.deepEqual(out.map((c) => c.direction), [1, -1]);
});

test("magnitude is clamped into 0..1 and defaults to full weight", () => {
  const out = sanitizeCorrections(
    [
      { feature: "hedging", direction: 1, magnitude: 12 },
      { feature: "contractions", direction: 1, magnitude: -3 },
      { feature: "plain_wording", direction: 1, magnitude: "lots" },
    ],
    NOW,
  );
  assert.deepEqual(out.map((c) => c.magnitude), [1, 0, 1]);
});

test("source falls back to 'revision' and never takes an arbitrary value", () => {
  const out = sanitizeCorrections(
    [
      { feature: "hedging", direction: 1, source: "manual" },
      { feature: "hedging", direction: 1, source: "revision" },
      { feature: "hedging", direction: 1, source: "'; DROP TABLE style_card; --" },
    ],
    NOW,
  );
  assert.deepEqual(out.map((c) => c.source), ["manual", "revision", "revision"]);
});

test("a future timestamp is clamped to now", () => {
  // Left alone it would sit at maximum recency weight forever and dominate
  // every later rebuild of the card.
  assert.equal(clampTs(NOW + 10 * YEAR, NOW), NOW);
  const [out] = sanitizeCorrections([{ feature: "hedging", direction: 1, ts: NOW + YEAR }], NOW);
  assert.equal(out.ts, NOW);
});

test("an absurdly old timestamp is floored rather than dropped", () => {
  assert.equal(clampTs(0, NOW), NOW - 5 * YEAR);
});

test("batches are capped so one request cannot write unbounded rows", () => {
  const flood = Array.from({ length: 500 }, () => ({ feature: "hedging", direction: 1 }));
  assert.equal(sanitizeCorrections(flood, NOW).length, 50);

  const metricFlood = Array.from({ length: 500 }, () => ({ type: "note_copied", data: { n: 1 } }));
  assert.equal(sanitizeMetrics(metricFlood, NOW).length, 50);
});

test("a metric carries at most sixteen keys", () => {
  const data = {};
  for (let i = 0; i < 40; i++) data[`k${i}`] = i;
  const [out] = sanitizeMetrics([{ type: "note_generated", data }], NOW);
  assert.equal(Object.keys(out.data).length, 16);
});

test("the largest payload the tools actually send arrives whole, with headroom", () => {
  /* The cap drops the overflow SILENTLY, so a payload that grows into it loses
     whichever keys sort last and nothing anywhere says so. That has already
     been a live risk once: note_register was at ten keys against a cap of
     twelve when the two section-scoped shape numbers were added.

     This is the real note_register payload from
     apps/tools/notes/bcba/engine.jsx. If it ever reaches the cap, raise the cap
     in the same commit rather than letting a signal disappear. */
  const register = {
    sentences: 41, words: 612, meanLen: 14.9, burstiness: 0.52,
    sectionCv: 0.47, sectionStep: 0.31, sections: 5,
    openerVariety: 1, repeatRate: 0.01, actorRate: 0.44, clientRate: 0.19,
    topOpener: 2, score: 18,
  };
  const [out] = sanitizeMetrics([{ type: "note_register", data: register }], NOW);

  assert.deepEqual(Object.keys(out.data).sort(), Object.keys(register).sort(),
    "a key was dropped, so a signal is missing from the Friday report");
  assert.ok(Object.keys(register).length <= 14,
    `note_register is at ${Object.keys(register).length} keys and the cap is 16; `
    + "raise the cap before adding more");
});

test("a shape number the note could not support is dropped rather than stored as zero", () => {
  // note-metrics.js omits sectionCv and sectionStep when no section had enough
  // sentences to measure. A null slipping through instead would be folded into
  // the technician's running profile as a real observation of perfect flatness.
  const [out] = sanitizeMetrics(
    [{ type: "note_register", data: { meanLen: 12, sectionCv: null, sectionStep: undefined, sections: 0 } }],
    NOW);
  assert.deepEqual(out.data, { meanLen: 12, sections: 0 });
});

test("non-array and malformed input is safe", () => {
  for (const bad of [null, undefined, "events", 42, {}]) {
    assert.deepEqual(sanitizeCorrections(bad, NOW), []);
    assert.deepEqual(sanitizeMetrics(bad, NOW), []);
  }
  assert.deepEqual(sanitizeCorrections([null, undefined, "x", 7], NOW), []);
  assert.deepEqual(sanitizeMetrics([null, undefined, "x", 7], NOW), []);
});

test("kid accepts the login-code id shape and rejects anything else", () => {
  assert.equal(cleanKid("pw:9f2c1a44-77bd-4e2f-9d1a-3b8f0c6e5a11"), "pw:9f2c1a44-77bd-4e2f-9d1a-3b8f0c6e5a11");
  assert.equal(cleanKid("admin"), "admin");

  for (const bad of ["", "a b", "kid/../other", "'; DROP TABLE technician; --", "x".repeat(65), null, 7, {}]) {
    assert.equal(cleanKid(bad), null, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("tool and metric type slugs are constrained", () => {
  assert.equal(cleanSlug("bt"), "bt");
  assert.equal(cleanSlug("note_generated"), "note_generated");
  for (const bad of ["", "9lives", "has space", "../etc", "x".repeat(40), null]) {
    assert.equal(cleanSlug(bad), null, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("a metric with no valid values still records that the event happened", () => {
  // The count is the signal; an empty data object is legitimate.
  const [out] = sanitizeMetrics([{ type: "note_copied", data: { prose: "..." } }], NOW);
  assert.equal(out.type, "note_copied");
  assert.deepEqual(out.data, {});
});
