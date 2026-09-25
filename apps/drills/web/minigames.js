/* The mini games' own memory: the pair race (pairgame.js) and Shifty Shifts
 * (shifty.js). His ruling of 2026-09-24: practice never touches history,
 * bests or bands, but it tracks its own progress and has its own trophies,
 * most of them hard to earn.
 *
 * games = { pairs: { br: [run, ...] }, shifty: [run, ...], river: [run, ...], earned: { id: at } }, kept in settings.
 * earned is the permanent record of each trophy's first date (ids and dates only, no typed
 * text), so a trophy never vanishes or moves once its run falls off the RUNS_KEPT cap.
 * Pure; node --test reads it.
 */

export const RUNS_KEPT = 60;

/**
 * A copy of games with one run added, the oldest dropped past RUNS_KEPT. Trophies are
 * read before the cap trims, and each newly earned one's first date goes into earned.
 */
export function addRun(games, kind, run, pair = null) {
  const g = { pairs: { ...((games && games.pairs) || {}) }, shifty: [...((games && games.shifty) || [])], river: [...((games && games.river) || [])], earned: { ...((games && games.earned) || {}) } };
  if (kind === "pair" && pair) g.pairs[pair] = [...(g.pairs[pair] || []), run];
  if (kind === "shifty") g.shifty = [...g.shifty, run];
  if (kind === "river") g.river = [...g.river, run];
  const newly = gameTrophies(g).filter((t) => t.at && !g.earned[t.id]);
  const earned = { ...g.earned, ...Object.fromEntries(newly.map((t) => [t.id, t.at])) };
  const cap = (runs) => runs.slice(-RUNS_KEPT);
  const pairs = Object.fromEntries(Object.entries(g.pairs).map(([p, runs]) => [p, cap(runs)]));
  return { pairs, shifty: cap(g.shifty), river: cap(g.river), earned };
}

/** Last, best and first for a list of runs, by a field where lower is better. */
export function progressOf(runs, field = "secs") {
  const xs = (runs || []).filter((r) => r && Number.isFinite(r[field]));
  if (!xs.length) return null;
  const best = Math.min(...xs.map((r) => r[field]));
  return { runs: xs.length, first: xs[0][field], last: xs[xs.length - 1][field], best };
}

/** One line of progress for the end of a game. */
export function progressLine(runs, field, unit) {
  const p = progressOf(runs, field);
  if (!p) return "";
  if (p.runs === 1) return `First run: ${fmt(p.last)} ${unit}. That is the mark to beat.`;
  const newBest = p.last === p.best;
  const fromFirst = p.first > 0 ? Math.round((1 - p.last / p.first) * 100) : 0;
  return `${newBest ? "New best" : `Best ${fmt(p.best)} ${unit}`}, run ${p.runs}.` +
    (fromFirst > 0 ? ` ${fromFirst}% faster than your first.` : "");
}
const fmt = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * The mini-game trophies. Each: id, name, cond, and when it was first earned
 * (the run that earned it), or null. Most are hard on purpose.
 */
export function gameTrophies(games) {
  const pairs = Object.entries((games && games.pairs) || {});
  const allPair = pairs.flatMap(([pair, runs]) => runs.map((r) => ({ ...r, pair }))).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const shifty = [...((games && games.shifty) || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const river = [...((games && games.river) || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const firstAt = (list, ok) => { const r = list.find(ok); return r ? r.at : null; };
  const nth = (list, n) => (list.length >= n ? list[n - 1].at : null);

  // A pair counts as tamed once a later run beats its first run's pair time by a quarter.
  const tamedAt = pairs.map(([, runs]) => {
    const first = runs.find((r) => Number.isFinite(r.ms));
    const r = first && runs.find((x) => x !== first && Number.isFinite(x.ms) && x.ms <= first.ms * 0.75);
    return r ? r.at : null;
  }).filter(Boolean).sort();

  // Beat your own best lap, over and over.
  let best = Infinity, beats = 0, beatsAt5 = null;
  for (const r of shifty) {
    if (!Number.isFinite(r.secs)) continue;
    if (r.secs < best) { if (best !== Infinity) { beats += 1; if (beats === 5) beatsAt5 = r.at; } best = r.secs; }
  }

  const list = [
    // The race of the tortoise and the hare.
    { id: "g-hare-today", name: "Hare Today", cond: "Finish a pair race.", at: nth(allPair, 1) },
    { id: "g-slow-steady", name: "Slow and Steady", cond: "Finish 25 pair races.", at: nth(allPair, 25) },
    { id: "g-shell-shock", name: "Shell Shock", cond: "Finish a pair race at 110 wpm or faster.", at: firstAt(allPair, (r) => r.wpm >= 110) },
    { id: "g-tortoise-tamer", name: "Tortoise Tamer", cond: "Type a pair a third faster in the race than it ran in the round that found it.", at: firstAt(allPair, (r) => Number.isFinite(r.ms) && Number.isFinite(r.roundMs) && r.ms <= r.roundMs * 0.67) },
    { id: "g-pair-surgeon", name: "Pair Surgeon", cond: "Average 70 ms or less on a pair through a whole race.", at: firstAt(allPair, (r) => Number.isFinite(r.ms) && r.ms <= 70) },
    { id: "g-menagerie", name: "Menagerie", cond: "Tame five different pairs: beat each one's first race time by a quarter.", at: tamedAt[4] || null },
    // Shifty Shifts.
    { id: "g-clutch", name: "Clutch", cond: "Finish Shifty Shifts.", at: nth(shifty, 1) },
    { id: "g-pit-crew", name: "Pit Crew", cond: "Finish Shifty Shifts 20 times.", at: nth(shifty, 20) },
    { id: "g-heel-toe", name: "Heel and Toe", cond: "Finish Shifty Shifts with no wrong-side Shift.", at: firstAt(shifty, (r) => r.wrong === 0) },
    { id: "g-redline", name: "Redline", cond: "Finish Shifty Shifts at 90 wpm or faster with no wrong-side Shift.", at: firstAt(shifty, (r) => r.wpm >= 90 && r.wrong === 0) },
    { id: "g-quick-clutch", name: "Quick Clutch", cond: "Average under 110 ms from Shift down to the letter, over a whole run.", at: firstAt(shifty, (r) => Number.isFinite(r.downToKey) && r.downToKey < 110) },
    { id: "g-silk", name: "Silk Shift", cond: "Average under 100 ms from letting go of Shift to the next key, over a whole run.", at: firstAt(shifty, (r) => Number.isFinite(r.upToNext) && r.upToNext < 100) },
    { id: "g-lap-record", name: "Lap Record", cond: "Beat your own best Shifty Shifts time five times.", at: beatsAt5 },
    // River Rhythm.
    { id: "g-flat-water", name: "Flat Water", cond: "Win River Rhythm.", at: nth(river, 1) },
    { id: "g-paddler", name: "Paddler", cond: "Win River Rhythm 10 times.", at: nth(river, 10) },
    { id: "g-glassy", name: "Glassy", cond: "Hold an even beat for 20 seconds without a break.", at: firstAt(river, (r) => r.bestStreak >= 20) },
    { id: "g-rapids", name: "Rapids Runner", cond: "Win River Rhythm in under 25 seconds.", at: firstAt(river, (r) => r.secs < 25) },
  ];
  const earned = (games && games.earned) || {};
  return list.map((t) => {
    const when = typeof earned[t.id] === "string" ? earned[t.id] : t.at;
    return { ...t, at: when, family: "Mini games", unlocked: !!when };
  });
}

