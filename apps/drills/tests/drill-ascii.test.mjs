// D7: JS source is ASCII, with \u escapes for anything else (his ruling).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = [
  ...readdirSync(join(root, "web")).filter((f) => f.endsWith(".js")).map((f) => join("web", f)),
  ...readdirSync(join(root, "tests")).filter((f) => /\.(m?js)$/.test(f)).map((f) => join("tests", f)),
  ...readdirSync(join(root, "app")).filter((f) => /\.(m?js)$/.test(f)).map((f) => join("app", f)),
  "playwright.config.js",
];

test("D7: every web and test JS file is ASCII, with \\u escapes for anything else", () => {
  const found = [];
  for (const rel of sources) {
    readFileSync(join(root, rel), "utf8").split("\n").forEach((line, i) => {
      const m = line.match(/[^\x00-\x7f]/);
      if (m) found.push(`${rel}:${i + 1} U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
    });
  }
  assert.ok(sources.length > 20, "the file list reads the real folders");
  assert.deepEqual(found, []);
});
