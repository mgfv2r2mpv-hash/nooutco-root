#!/usr/bin/env node
/**
 * download-famous-images.js
 *
 * Downloads all Famous Person Game images locally so the game has zero
 * runtime dependency on Wikimedia Commons URLs.
 *
 * Run from the repo root (or anywhere — paths are resolved relative to this file):
 *   node IDMatchGame/download-famous-images.js
 *
 * Re-runnable: already-downloaded files are skipped.
 * Outputs:
 *   FamousGame/FamousPerson/images/  ← one file per person
 *   FamousGame/FamousPerson/image-map.json  ← used by update-image-paths.js
 *
 * After running, check for any FAILEDs, fix those URLs in TheGame.html, then:
 *   node IDMatchGame/update-image-paths.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

const ROOT      = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'FamousGame', 'FamousPerson', 'TheGame.html');
const OUT_DIR   = path.join(ROOT, 'FamousGame', 'FamousPerson', 'images');
const MAP_PATH  = path.join(ROOT, 'FamousGame', 'FamousPerson', 'image-map.json');

// ── Parse people from TheGame.html ───────────────────────────────────────────

const html = fs.readFileSync(HTML_PATH, 'utf8');

// Slice just the PEOPLE array (starts at "const PEOPLE = [", ends at first "];" on its own line)
const peopleStart = html.indexOf('const PEOPLE = [');
if (peopleStart === -1) throw new Error('Could not find "const PEOPLE = [" in TheGame.html');
const peopleEnd = html.indexOf('\n];', peopleStart);
if (peopleEnd === -1) throw new Error('Could not find end of PEOPLE array');
const peopleText = html.slice(peopleStart, peopleEnd + 3);

// Extract names and img URLs in document order (they're paired within each person block)
const names = [...peopleText.matchAll(/^\s+name:\s*'([^']+)'/gm)].map(m => m[1]);
const imgs  = [...peopleText.matchAll(/^\s+img:\s*'([^']+)'/gm)].map(m => m[1]);

if (names.length !== imgs.length) {
  throw new Error(
    `Mismatch: found ${names.length} name entries but ${imgs.length} img entries. ` +
    'Check TheGame.html for malformed PEOPLE entries.'
  );
}

const people = names.map((name, i) => ({ name, imgUrl: imgs[i] }));
console.log(`Found ${people.length} people in PEOPLE array.\n`);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '');
}

function inferExt(imgUrl) {
  const m = imgUrl.match(/\.(jpe?g|png|gif|webp|svg)(?:[?#]|$)/i);
  if (!m) return '.jpg';
  return '.' + m[1].toLowerCase().replace('jpeg', 'jpg');
}

/** Download a URL to dest, following up to 5 redirects. */
function download(imgUrl, dest) {
  return new Promise((resolve, reject) => {
    const attempt = (u, hops) => {
      if (hops > 5) return reject(new Error('Too many redirects'));
      let parsed;
      try { parsed = new URL(u); } catch (e) { return reject(e); }
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          headers: {
            'User-Agent':
              'games-nooutco-me-downloader/1.0 (https://github.com/mgfv2r2mpv-hash/games-nooutco-me)',
          },
        },
        res => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            const next = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, u).href;
            return attempt(next, hops + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          const out = fs.createWriteStream(dest);
          res.pipe(out);
          out.on('finish', resolve);
          out.on('error', reject);
        }
      );
      req.on('error', reject);
    };
    attempt(imgUrl, 0);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const map    = [];
  const failed = [];

  for (let i = 0; i < people.length; i++) {
    const { name, imgUrl } = people[i];
    const filename = makeSlug(name) + inferExt(imgUrl);
    const dest     = path.join(OUT_DIR, filename);
    const newPath  = 'images/' + filename;

    // Skip if already downloaded (re-runnable)
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      process.stdout.write(`  [skip] ${name}\n`);
      map.push({ name, oldUrl: imgUrl, newPath });
      continue;
    }

    process.stdout.write(`  [${String(i + 1).padStart(3)}/${people.length}] ${name} ... `);
    try {
      await download(imgUrl, dest);
      process.stdout.write('ok\n');
      map.push({ name, oldUrl: imgUrl, newPath });
    } catch (err) {
      // Clean up partial file
      try { fs.unlinkSync(dest); } catch {}
      process.stdout.write(`FAILED (${err.message})\n`);
      failed.push({ name, imgUrl, error: err.message });
    }
  }

  // Write mapping for update-image-paths.js
  fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + '\n');
  console.log(`\nimage-map.json written — ${map.length} entries`);

  if (failed.length) {
    console.log(`\n⚠️  ${failed.length} failed download(s):`);
    failed.forEach(f => {
      console.log(`   ${f.name}`);
      console.log(`     ${f.imgUrl}`);
    });
    console.log('\nFor each failure:');
    console.log('  1. Find a working image URL on https://commons.wikimedia.org');
    console.log('  2. Update the img: value in TheGame.html');
    console.log('  3. Re-run this script (already-downloaded files are skipped)');
  } else {
    console.log('✓  All images downloaded successfully.');
  }

  console.log('\nNext step: node IDMatchGame/update-image-paths.js');
}

main().catch(err => { console.error(err.message); process.exit(1); });
