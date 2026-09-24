/* Your nemeses: achievements the app writes from HIS data. Pure: history in,
 * nemeses out. node --test reads it.
 *
 * The replay walks the history in time order, the same way the trophy case
 * does. When an issue first shows up often enough to be more than one bad
 * drill, a "tame it" achievement appears with the date it was spotted and the
 * baseline it was spotted at. It is earned when the same issue gets better
 * than that baseline, over enough drills since the spotting to mean it. Both
 * dates come from the drill that met the condition, so a replay never moves
 * them, and an issue is spotted once only.
 *
 * Four kinds, each from numbers the history already carries (never text):
 *   key      a letter missed often (keys[k].presses and misses)
 *   pair     a letter pair flagged slow (slowPairs)
 *   confuse  one letter typed for another (confusions, "meant>hit")
 *   refused  a capital refused for a same-side Shift (refusedKeys)
 * Tips already have their own "Retire the tip" trophies, so they are not here.
 */

/* A key is spotted over its last KEY_WINDOW drills, and tamed over the last
   KEY_TAME drills since the spotting. His miss rates run 1 to 4.5% (31 drills,
   2026-09-23), so 3% or worse is a real nemesis and not his normal. A window
   is spotted at its worst, so the next one drifts back toward his usual by
   chance alone; the taming window is longer than the spotting one so that a
   lucky stretch cannot earn it. */
const KEY_WINDOW = 8;
const KEY_TAME = 12;
const KEY_PRESSES = 60;
const KEY_MISSES = 3;
const KEY_RATE = 0.03;

/* A pair is flagged slow in only some drills, so it is spotted by frequency. */
const PAIR_WINDOW = 10;
const PAIR_HITS = 3;
const PAIR_QUIET = 15;
const PAIR_WORDS = 40;

const CONFUSE_HITS = 3;
const CONFUSE_QUIET = 8;
const CONFUSE_PRESSES = 40;

const REFUSED_WINDOW = 5;
const REFUSED_HITS = 3;
const REFUSED_QUIET = 5;
const REFUSED_CAPITALS = 10;

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const up = (s) => String(s).toUpperCase();

/* Names in the Steam style, picked by the issue so a name never changes. */
const KEY_NAMES = ["Tamer of {X}", "{X}, Subdued", "Exorcist of {X}", "{X} No More", "Master of {X}", "The {X} Whisperer"];
const PAIR_NAMES = ["Untangled: {X}", "{X} Unknotted", "Smooth {X}", "{X} at Speed", "Greased {X}"];
const pick = (list, key) => list[[...key].reduce((s, c) => s + c.charCodeAt(0), 0) % list.length].replace("{X}", up(key));

const LETTER = /^[a-z]$/;

/**
 * Every nemesis the history has spotted, in the order spotted:
 * { id, family, group, kind, name, condition, spotted, unlocked, have, need }.
 * have and need count the drills toward taming it, so the board can show progress.
 */
export function nemeses(list) {
  const found = new Map();
  const spot = (id, entry) => { if (!found.has(id)) found.set(id, { id, family: id, group: "Your nemeses", unlocked: null, have: 0, ...entry }); };
  const byKey = {}, pairs = [], confuse = [], strict = [];
  for (const h of list) {
    if (num(h.gwam) <= 0) continue;
    keyStep(h, byKey, found, spot);
    if (Array.isArray(h.slowPairs) && num(h.words) >= PAIR_WORDS) { pairs.push(h); pairStep(h, pairs, found, spot); }
    if (Array.isArray(h.confusions) && num(h.words) >= PAIR_WORDS) { confuse.push(h); confuseStep(h, confuse, found, spot); }
    if (h.refused !== undefined) { strict.push(h); refusedStep(h, strict, found, spot); }
  }
  return [...found.values()];
}

function keyStep(h, byKey, found, spot) {
  for (const [k, v] of Object.entries(h.keys || {})) {
    if (!LETTER.test(k) || !num(v && v.presses)) continue;
    const q = (byKey[k] ||= []);
    q.push({ at: h.at, presses: num(v.presses), misses: num(v.misses) });
    const id = `nem-key-${k}`;
    const n = found.get(id);
    if (!n) {
      const w = q.slice(-KEY_WINDOW);
      const presses = sum(w, (x) => x.presses), misses = sum(w, (x) => x.misses);
      if (w.length === KEY_WINDOW && presses >= KEY_PRESSES && misses >= KEY_MISSES && misses / presses >= KEY_RATE) {
        const base = misses / presses;
        spot(id, { kind: "key", key: k, base, from: q.length, need: KEY_TAME, spotted: h.at, name: pick(KEY_NAMES, k),
          condition: `${up(k)} missed on ${pct(base)} of presses over ${KEY_WINDOW} drills. Tame it: ${pct(base / 2)} or less over ${KEY_TAME} drills since, ${KEY_PRESSES} presses or more.` });
      }
      continue;
    }
    if (n.unlocked) continue;
    const since = q.slice(n.from);
    n.have = Math.min(since.length, KEY_TAME);
    const w = since.slice(-KEY_TAME);
    const presses = sum(w, (x) => x.presses), misses = sum(w, (x) => x.misses);
    if (w.length === KEY_TAME && presses >= KEY_PRESSES && misses / presses <= n.base / 2) n.unlocked = h.at;
  }
}

/* Quiet runs: after the spotting, count the drills in a row without the issue. */
function quietStep(n, clean, need, guard = true) {
  if (n.unlocked) return;
  n.have = clean ? n.have + 1 : 0;
  if (n.have >= need && guard) n.unlocked = n.lastAt;
}

function pairStep(h, pairs, found, spot) {
  const w = pairs.slice(-PAIR_WINDOW);
  for (const p of h.slowPairs) {
    if (!/^[a-z]{2}$/.test(p)) continue;
    const hits = w.filter((x) => x.slowPairs.includes(p)).length;
    if (hits >= PAIR_HITS) spot(`nem-pair-${p}`, { kind: "pair", key: p, need: PAIR_QUIET, spotted: h.at, name: pick(PAIR_NAMES, p),
      condition: `${up(p)} ran slow in ${hits} of your last ${w.length} drills. Tame it: ${PAIR_QUIET} drills in a row (${PAIR_WORDS} words or more) without it running slow.` });
  }
  for (const n of found.values()) {
    if (n.kind !== "pair" || n.spotted === h.at) continue;
    n.lastAt = h.at;
    quietStep(n, !h.slowPairs.includes(n.key), PAIR_QUIET);
  }
}

function confuseStep(h, confuse, found, spot) {
  for (const c of h.confusions) {
    const [meant, hit] = String(c).split(">");
    if (!LETTER.test(meant || "") || !LETTER.test(hit || "")) continue;
    const hits = confuse.filter((x) => x.confusions.includes(c)).length;
    if (hits >= CONFUSE_HITS) spot(`nem-confuse-${meant}-${hit}`, { kind: "confuse", key: c, meant, need: CONFUSE_QUIET, spotted: h.at, quiet: [],
      name: `${up(meant)} Is Not ${up(hit)}`,
      condition: `${up(hit)} typed for ${up(meant)} in ${hits} drills. Tame it: ${CONFUSE_QUIET} drills in a row without it, ${CONFUSE_PRESSES} presses of ${up(meant)} or more among them.` });
  }
  for (const n of found.values()) {
    if (n.kind !== "confuse" || n.spotted === h.at || n.unlocked) continue;
    const clean = !h.confusions.includes(n.key);
    n.quiet = clean ? [...n.quiet, h].slice(-CONFUSE_QUIET) : [];
    n.lastAt = h.at;
    const presses = sum(n.quiet, (x) => num(x.keys && x.keys[n.meant] && x.keys[n.meant].presses));
    quietStep(n, clean, CONFUSE_QUIET, presses >= CONFUSE_PRESSES);
  }
}

function refusedStep(h, strict, found, spot) {
  const w = strict.slice(-REFUSED_WINDOW);
  for (const k of new Set(h.refusedKeys || [])) {
    const key = String(k).toLowerCase();
    if (!LETTER.test(key)) continue;
    const hits = sum(w, (x) => (x.refusedKeys || []).filter((r) => String(r).toLowerCase() === key).length);
    if (hits >= REFUSED_HITS) spot(`nem-refused-${key}`, { kind: "refused", key, need: REFUSED_QUIET, spotted: h.at, quiet: [],
      name: `Extinction: Same-Side ${up(key)}`,
      condition: `capital ${up(key)} refused ${hits} times in ${w.length} strict drills. Tame it: ${REFUSED_QUIET} strict drills in a row with none refused, ${REFUSED_CAPITALS} capitals or more among them.` });
  }
  for (const n of found.values()) {
    if (n.kind !== "refused" || n.spotted === h.at || n.unlocked) continue;
    const clean = !(h.refusedKeys || []).some((r) => String(r).toLowerCase() === n.key);
    n.quiet = clean ? [...n.quiet, h].slice(-REFUSED_QUIET) : [];
    n.lastAt = h.at;
    const capitals = sum(n.quiet, (x) => num(x.shift && x.shift.ok));
    quietStep(n, clean, REFUSED_QUIET, capitals >= REFUSED_CAPITALS);
  }
}

/** Nemeses the last drill spotted: in the list now, not in it one drill ago. */
export function newlySpotted(before, after) {
  const had = new Set(before.filter((t) => t.spotted).map((t) => t.id));
  return after.filter((t) => t.spotted && !had.has(t.id));
}
