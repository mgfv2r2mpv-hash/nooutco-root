#!/usr/bin/env node
// Copies packages/shared canonical sources into each consuming app.
//
// Cloudflare Pages uploads apps/<app> as-is with no build step, so shared code
// must physically live inside each app. Generated copies are committed; CI runs
// this script + `git diff --exit-code apps` to block hand-edits of the copies.
//
// Edit the canonical files in packages/shared/, then run `npm run sync:shared`.
//
// Two destination kinds:
//   • worker source → apps/<app>/shared/…  (assetsignored; bundled into _worker.js)
//   • served client assets → apps/<app>/assets/… or app root (NEVER under shared/,
//     which is .assetsignore'd and would 404). nav-bar.* + the brand logo are
//     served assets; admin-shell.* is games-only.

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shared = join(root, "packages", "shared");

// { src: relative to packages/shared, dst: relative to apps/<app>, apps: [...] }
const files = [
  // Design tokens — served at each app root.
  { src: "css/tokens.css", dst: "tokens.css", apps: ["tools", "games", "apex"] },

  // Unified nav bar — served client assets, on every product.
  { src: "ui/nav-bar.js", dst: "assets/nav-bar.js", apps: ["tools", "games", "apex"] },
  { src: "ui/nav-bar.css", dst: "assets/nav-bar.css", apps: ["tools", "games", "apex"] },

  // One canonical brand mark — served at each app root (component defaults to /logo-mark.svg).
  { src: "ui/logo-mark.svg", dst: "logo-mark.svg", apps: ["tools", "games", "apex"] },

  // Games admin shell — served client assets, games only (Game Master managers).
  { src: "ui/admin-shell.css", dst: "assets/admin-shell.css", apps: ["games"] },
  { src: "ui/admin-shell.js",  dst: "assets/admin-shell.js",  apps: ["games"] },

  // Worker source — bundled into _worker.js (tools + games only).
  { src: "worker/helpers.js", dst: "shared/helpers.js", apps: ["tools", "games"] },
  { src: "worker/suggest.js", dst: "shared/suggest.js", apps: ["tools", "games"] },
];

let written = 0;
for (const { src, dst, apps } of files) {
  for (const app of apps) {
    const out = join(root, "apps", app, dst);
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(join(shared, src), out);
    console.log(`apps/${app}/`.padEnd(12) + `${dst.padEnd(20)} <- packages/shared/${src}`);
    written++;
  }
}
console.log(`\nsync-shared: ${written} files written.`);
