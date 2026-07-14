/*
 * build_index.mjs — re-house the Glam Team Makeover design-canvas game into the
 * repo as a faithful, vendored bespoke game.
 *
 * Input : tools/glam-art/staging_game.html  (the raw `Glam Team Makeover.dc.html`
 *         pulled from the Claude Design project — an <x-dc> React/dc-runtime doc)
 * Output: apps/games/glam-team-makeover/index.html
 *
 * Source layout (verified): the runtime reads TWO sibling nodes —
 *   <x-dc> …reactive template… </x-dc>
 *   <script type="text/x-dc" data-dc-script data-props="…"> class … extends DCLogic </script>
 * Both are preserved byte-for-byte here; only the outer chrome is swapped:
 *   - drop the design-canvas <helmet> wrapper; hoist its <style> into real <head>
 *   - fonts.css + tokens.css  -> the repo's shared ../tailwind.css bundle
 *   - assets/reward.js        -> the repo's shared ../reward.js
 *   - ./support.js            -> vendored vendor/support.js, preceded by
 *                                vendored React 18 UMD (react + react-dom)
 *   - assets/art-manifest.js  -> kept game-local, loaded in <head> before boot
 *   - the dead "← Games" back link href="#" -> "/"
 *   - add the standard admin-gear footer
 */
import fs from 'node:fs';

const SRC = 'tools/glam-art/staging_game.html';
const OUT = 'apps/games/glam-team-makeover/index.html';

const raw = fs.readFileSync(SRC, 'utf8');

// The payload spans from <x-dc> through the end of the sibling data-dc-script.
const xdcOpen = raw.indexOf('<x-dc>');
if (xdcOpen < 0) throw new Error('build_index: <x-dc> not found');
const dcsIdx = raw.indexOf('data-dc-script');
if (dcsIdx < 0) throw new Error('build_index: data-dc-script not found');
const scriptClose = raw.indexOf('</script>', dcsIdx);
if (scriptClose < 0) throw new Error('build_index: closing </script> for the logic class not found');

let payload = raw.slice(xdcOpen, scriptClose + '</script>'.length);

// Hoist the game's <style> (lives inside <helmet>) into real <head>.
const styleM = payload.match(/<style>[\s\S]*?<\/style>/i);
const gameStyle = styleM ? styleM[0] : '';
if (!gameStyle) console.warn('build_index: no <style> block found to hoist');

// Remove the entire <helmet>…</helmet> block (its links/scripts are provided by
// the repo chrome in <head>; its <style> was hoisted above).
const before = payload;
payload = payload.replace(/<helmet>[\s\S]*?<\/helmet>\s*/i, '');
if (payload === before) throw new Error('build_index: <helmet> block not found/stripped');

// Fix the single dead back-link (grep confirmed href="#" occurs exactly once).
const hashCount = (payload.match(/href="#"/g) || []).length;
if (hashCount !== 1) throw new Error(`build_index: expected exactly 1 href="#", found ${hashCount}`);
payload = payload.replace('href="#"', 'href="/"');

// The social-only art gate is now baked into staging (renderVals personArt reads
// s.theme==='social' && this.hasPersonArt()) — the Canvas2D compositor rewrite
// made the old string patch obsolete. Hero/pet stay on their procedural SVG.

// M1 scope: ship the makeover (social/person) only. Remove the Pet show +
// Superhero theme <option>s from the settings dropdown so those unfinished
// themes (procedural-placeholder art, M2) aren't reachable. `social` stays the
// default, and the game logic still supports the other themes for M2.
for (const t of ['pet', 'hero']) {
  const re = new RegExp(`<option value="${t}">[^<]*</option>`);
  if (!re.test(payload)) throw new Error(`build_index: theme option '${t}' not found — settings markup changed`);
  payload = payload.replace(re, '');
}

// ZONES.person + pop-spot hitboxes are now authored directly in staging for the
// eye-anchored (Canvas2D) frame — pop positions come from genEntry face anchors
// (this._spotPct). The old per-model re-tune + spotAnchors patches are obsolete.

// Post-conditions: both nodes survived.
if (!/<x-dc>[\s\S]*<\/x-dc>/.test(payload)) throw new Error('build_index: <x-dc>…</x-dc> missing after transform');
if (!/type="text\/x-dc"\s+data-dc-script/.test(payload)) throw new Error('build_index: data-dc-script missing after transform');
if (!payload.trimEnd().endsWith('</script>')) throw new Error('build_index: payload does not end at the logic </script>');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="version" content="1.0">
<title>Glam Team Makeover</title>

<!-- Shared design tokens + Atkinson fonts (compiled bundle, same as every game) -->
<link rel="stylesheet" href="../tailwind.css">

${gameStyle}

<!-- Shared reinforcement (SR) screen · this game's art manifest.
     Loaded here (not via the design-canvas helmet) so window.NooutcoReward and
     window.NooutcoArt exist before the runtime boots and first-renders. -->
<script src="../reward.js"></script>
<script src="assets/art-generated.js"></script>
<script src="assets/art-manifest.js"></script>

<!-- Vendored React 18 (UMD) + the design-canvas runtime. Scoped to this one game;
     no other game uses a framework. Must load before the runtime auto-boots. -->
<script src="vendor/react.production.min.js"></script>
<script src="vendor/react-dom.production.min.js"></script>
<script src="vendor/support.js"></script>
</head>
<body>
${payload}

<!-- Admin gear → GM hub. _worker.js rewrites the \`const ADMIN_SECRET_HASH = "…"\`
     line per request (regex needs the \`const\` form — matches every other game). -->
<script>
  const ADMIN_SECRET_HASH = "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918";
  window.ADMIN_SECRET_HASH = ADMIN_SECRET_HASH;
  window.ADMIN_GEAR_PAGE = '../GM/';
</script>
<script src="../admin-gear.js"></script>
</body>
</html>
`;

fs.writeFileSync(OUT, html);
console.log(`build_index: wrote ${OUT}`);
console.log(`  hoisted <style>: ${gameStyle.length} bytes`);
console.log(`  payload (x-dc template + logic class): ${payload.length} bytes`);
