#!/usr/bin/env node
// Copies packages/shared canonical sources into each consuming app.
//
// Cloudflare Pages uploads apps/<app> as-is with no build step, so shared code
// must physically live inside each app. Generated copies are committed; CI runs
// this script + `git diff --exit-code apps` to block hand-edits of the copies.
//
// Edit the canonical files in packages/shared/, then run `npm run sync:shared`.

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shared = join(root, "packages", "shared");
const apps = ["tools", "games"];

// [ source relative to packages/shared, destination relative to apps/<app> ]
const files = [
  ["css/tokens.css", "tokens.css"],
  ["worker/helpers.js", "shared/helpers.js"],
  ["worker/suggest.js", "shared/suggest.js"],
];

for (const app of apps) {
  for (const [src, dst] of files) {
    mkdirSync(dirname(join(root, "apps", app, dst)), { recursive: true });
    copyFileSync(join(shared, src), join(root, "apps", app, dst));
    console.log(`apps/${app}/`.padEnd(12) + `${dst.padEnd(18)} <- packages/shared/${src}`);
  }
}
console.log(`\nsync-shared: ${apps.length * files.length} files written.`);
