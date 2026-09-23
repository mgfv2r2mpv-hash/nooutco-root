/* A static server for the drill page under test. Serves web/, and words.txt
   built the way app/build.sh builds it (from /usr/share/dict/words), falling
   back to a small fixture when the machine has no dictionary. */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB = join(HERE, "..", "web");
const PORT = Number(process.argv[2]) || 8955;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml" };

function words() {
  const dict = "/usr/share/dict/words";
  const src = existsSync(dict) ? readFileSync(dict, "utf8") : readFileSync(join(HERE, "fixtures", "words.txt"), "utf8");
  const set = new Set(src.split("\n").map((w) => w.trim().toLowerCase()).filter((w) => /^[a-z]{2,}$/.test(w)));
  for (const w of readFileSync(join(HERE, "fixtures", "words.txt"), "utf8").split("\n")) if (w.trim()) set.add(w.trim().toLowerCase());
  return [...set].sort().join("\n");
}
const WORDS = words();

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/words.txt") { res.writeHead(200, { "content-type": TYPES[".txt"] }); res.end(WORDS); return; }
  const file = normalize(join(WEB, path === "/" ? "index.html" : path));
  if (!file.startsWith(WEB) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`drills test server on ${PORT}`));
