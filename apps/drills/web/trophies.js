/* Days, streaks and trophies. Pure: history in, numbers out. node --test reads it.
 *
 * Every trophy is found by REPLAYING the history in time order, so its unlock
 * date is the drill that first met the condition, and a trophy can never be
 * lost or unlocked twice. Older records lack the newer fields (shift, habits,
 * think); a missing field counts as zero, never as a guess.
 */
import { dayOf } from "./panel.js";
import { BANDS } from "./score.js";

const DAY_MS = 86400000;
const SITTING_GAP_MS = 20 * 60000;

/** Whole days from one "2026-09-22" to another, calendar days, DST-proof. */
export function daysBetween(a, b) {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY_MS);
}

const sorted = (history) => (history || [])
  .filter((h) => h && h.at && Number.isFinite(Date.parse(h.at)))
  .slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

/**
 * One row per day with a drill: { day, count, nwam, gwam, bestNwam, bestGwam,
 * words, accuracy }. nwam, gwam and accuracy are the day's averages.
 */
export function dayStats(history) {
  const map = new Map();
  for (const h of sorted(history)) {
    const day = dayOf(h.at);
    const d = map.get(day) || { day, count: 0, sumN: 0, sumG: 0, sumA: 0, bestNwam: 0, bestGwam: 0, words: 0 };
    d.count += 1;
    d.sumN += num(h.nwam); d.sumG += num(h.gwam); d.sumA += num(h.accuracy);
    d.bestNwam = Math.max(d.bestNwam, num(h.nwam)); d.bestGwam = Math.max(d.bestGwam, num(h.gwam));
    d.words += num(h.words);
    map.set(day, d);
  }
  return [...map.values()].map((d) => ({
    day: d.day, count: d.count,
    nwam: round1(d.sumN / d.count), gwam: round1(d.sumG / d.count), accuracy: Math.round((d.sumA / d.count) * 1000) / 1000,
    bestNwam: d.bestNwam, bestGwam: d.bestGwam, words: round1(d.words),
  }));
}

/**
 * Runs of consecutive days. current counts back from today, or from yesterday
 * when today has no drill yet (the streak is not broken until today ends).
 */
export function streakRuns(days, today) {
  const list = [...new Set(days)].sort();
  const runs = [];
  for (const d of list) {
    const last = runs[runs.length - 1];
    if (last && daysBetween(last.end, d) === 1) { last.end = d; last.days += 1; }
    else runs.push({ start: d, end: d, days: 1 });
  }
  const longest = runs.reduce((m, r) => Math.max(m, r.days), 0);
  const tail = runs[runs.length - 1];
  const gap = tail && today ? daysBetween(tail.end, today) : Infinity;
  const current = tail && gap <= 1 ? tail.days : 0;
  return { runs, longest, current, alive: gap === 0 };
}

/* ---- the trophy case ---------------------------------------------------- */

const commas = (n) => Math.round(n).toLocaleString("en-US");

/** A family of tiers over one measure. */
function tiers(group, id, measure, list, cond) {
  return list.map(([need, name]) => ({ id: `${id}-${need}`, family: id, group, name, need, measure, condition: cond(need) }));
}
const one = (group, id, name, condition, measure, need = 1) => ({ id, family: id, group, name, need, measure, condition });

export const TROPHIES = Object.freeze([
  ...tiers("Streaks", "streak", (a) => a.streak, [
    [3, "Baseline"], [7, "Stable trend"], [14, "Maintenance"], [30, "Generalized"], [60, "Durable"], [100, "Behavioral momentum"],
  ], (n) => `Drill ${n} days in a row.`),
  ...tiers("Days", "days", (a) => a.days, [
    [5, "Five data days"], [10, "Ten data days"], [25, "Twenty-five days"], [50, "Fifty days"], [100, "A hundred days"], [200, "Two hundred days"],
  ], (n) => `Drill on ${n} different days.`),
  ...tiers("Sessions", "sessions", (a) => a.sessions, [
    [1, "First probe"], [10, "Ten trials"], [25, "Twenty-five trials"], [50, "Fifty trials"], [100, "A hundred trials"], [250, "Two-fifty"], [500, "Five hundred"], [1000, "A thousand trials"],
  ], (n) => (n === 1 ? "Finish a drill." : `Finish ${n} drills.`)),
  ...[1, 2, 3, 4, 5].flatMap((m) => tiers(`Clock length`, `len${m}`, (a) => a.perLen[m] || 0, [
    [10, `${m}-minute regular`], [50, `${m}-minute veteran`], [150, `${m}-minute master`],
  ], (n) => `Finish ${n} drills on the ${m}-minute clock.`)),
  one("Clock length", "every-clock", "Every clock", "Finish at least one drill on each clock, 1 to 5 minutes.",
    (a) => [1, 2, 3, 4, 5].filter((m) => a.perLen[m]).length, 5),
  ...tiers("Words", "words", (a) => a.words, [
    [1000, "A thousand words"], [5000, "Five thousand words"], [10000, "Ten thousand words"], [25000, "Twenty-five thousand"], [50000, "Fifty thousand"], [100000, "A hundred thousand"],
  ], (n) => `Type ${commas(n)} words in all (five keystrokes a word).`),
  ...tiers("Words", "kept", (a) => a.kept, [
    [250, "In your own words"], [1000, "A thousand kept"], [5000, "Five thousand kept"], [20000, "Twenty thousand kept"],
  ], (n) => `Keep ${commas(n)} words: answers you pressed Keep it on, in your voice corpus.`),
  ...BANDS.slice(0, -1).slice().reverse().map((b) => one("Speed", `band-${b.name.toLowerCase()}`, b.name,
    `Reach ${b.min} NWAM on any clock.`, (a) => a.bestNwam, b.min)),
  one("Speed", "gwam-100", "Triple digits", "Reach 100 GWAM on any clock.", (a) => a.bestGwam, 100),
  ...tiers("Speed", "pb", (a) => a.pbs, [[5, "Beat yourself"], [25, "Personal-best habit"], [75, "Always improving"]],
    (n) => `Set ${n} personal bests (beating your old best at that clock).`),
  one("Clean", "clean-97", "Clean run", "Finish a drill of 20 words or more at 97% accuracy or better.", (a) => a.clean97),
  one("Clean", "flawless", "Flawless", "Finish a drill of 40 words or more at 100% accuracy.", (a) => a.flawless),
  ...tiers("Clean", "combo", (a) => a.bestCombo, [[25, "Twenty-five clean"], [50, "Fifty clean"], [100, "A hundred clean"]],
    (n) => `Type ${n} clean words in a row: known, and no Backspace.`),
  one("Hands", "shift-drill", "Opposite hand", "Finish a drill with 8 capitals or more, every one with the opposite Shift.", (a) => a.shiftCleanDrill),
  ...tiers("Hands", "shift", (a) => a.shiftOk, [[100, "Cross-shift"], [1000, "Shift sense"]],
    (n) => `Take ${commas(n)} capitals with the opposite-hand Shift.`),
  ...tiers("Hands", "revise", (a) => a.wordDeletes, [[25, "Changed my mind"], [250, "Clean revisions"]],
    (n) => `Delete ${n} words with Option+Backspace.`),
  ...tiers("Field", "domains", (a) => a.domains, [[9, "Whole outline"]], () => "Answer at least one question in each of the nine BACB domains."),
  ...tiers("Field", "items", (a) => a.items, [[25, "Twenty-five items"], [50, "Fifty items"], [104, "Every item"]],
    (n) => `Answer questions under ${n} different items of the BACB outline.`),
  ...tiers("Field", "lexicon", (a) => a.lexicon, [[10, "Ten terms"], [50, "Fifty terms"]],
    (n) => `Mark ${n} words clinical, into your lexicon.`),
  ...tiers("Habits", "sitting", (a) => a.bestSitting, [[3, "Back to back"], [5, "Five in a sitting"], [10, "Massed trials"]],
    (n) => `Finish ${n} drills in one sitting, each within 20 minutes of the last.`),
  one("Habits", "big-day", "Big day", "Finish 10 drills in one day.", (a) => a.bestDay, 10),
  one("Habits", "early", "Early bird", "Finish a drill before 7 in the morning.", (a) => a.early),
  one("Habits", "late", "Night owl", "Finish a drill after 10 at night.", (a) => a.late),
  one("Habits", "comeback", "Comeback", "Drill again after a week or more away.", (a) => a.comeback),
]);

/** The running totals the trophies read, advanced one drill at a time. */
function emptyAgg() {
  return {
    sessions: 0, days: 0, streak: 0, perLen: {}, words: 0, kept: 0, bestNwam: 0, bestGwam: 0, pbs: 0,
    clean97: 0, flawless: 0, bestCombo: 0, shiftOk: 0, shiftCleanDrill: 0, wordDeletes: 0,
    domains: 0, items: 0, lexicon: 0, bestSitting: 0, bestDay: 0, early: 0, late: 0, comeback: 0,
  };
}

/** The trophy case: every trophy with { unlocked: ISO or null, have, need }. */
export function trophyCase(history) {
  const list = sorted(history);
  const a = emptyAgg();
  const got = new Map();
  const days = new Set(), domains = new Set(), items = new Set();
  const perDay = new Map();
  const bestAt = {};
  let lastDay = null, run = 0, sit = 0, lastT = null;
  for (const h of list) {
    const t = Date.parse(h.at), day = dayOf(h.at), when = new Date(t);
    a.sessions += 1;
    if (lastDay && daysBetween(lastDay, day) >= 8) a.comeback = 1;
    if (day !== lastDay) { run = lastDay && daysBetween(lastDay, day) === 1 ? run + 1 : 1; lastDay = day; }
    a.streak = Math.max(a.streak, run);
    days.add(day); a.days = days.size;
    perDay.set(day, (perDay.get(day) || 0) + 1); a.bestDay = Math.max(a.bestDay, perDay.get(day));
    sit = lastT !== null && t - lastT <= SITTING_GAP_MS ? sit + 1 : 1; lastT = t;
    a.bestSitting = Math.max(a.bestSitting, sit);
    const m = Number(h.minutes);
    if (m) a.perLen[m] = (a.perLen[m] || 0) + 1;
    const words = num(h.words);
    a.words += words;
    if (h.kept) a.kept += words;
    const nwam = num(h.nwam);
    if (m && bestAt[m] != null && nwam > bestAt[m]) a.pbs += 1;
    if (m) bestAt[m] = Math.max(bestAt[m] ?? -1, nwam);
    a.bestNwam = Math.max(a.bestNwam, nwam); a.bestGwam = Math.max(a.bestGwam, num(h.gwam));
    if (words >= 20 && num(h.accuracy) >= 0.97) a.clean97 = 1;
    if (words >= 40 && num(h.accuracy) >= 1) a.flawless = 1;
    a.bestCombo = Math.max(a.bestCombo, num(h.bestCombo));
    const sh = h.shift || {};
    a.shiftOk += num(sh.ok);
    if (num(sh.ok) >= 8 && num(sh.same) === 0) a.shiftCleanDrill = 1;
    a.wordDeletes += num(h.habits && h.habits.wordDeletes);
    if (h.outline) { domains.add(String(h.outline)[0]); items.add(h.outline); }
    a.domains = domains.size; a.items = items.size;
    a.lexicon = Math.max(a.lexicon, num(h.lexicon));
    const hour = when.getHours();
    if (hour < 7) a.early = 1;
    if (hour >= 22) a.late = 1;
    for (const tr of TROPHIES) if (!got.has(tr.id) && tr.measure(a) >= tr.need) got.set(tr.id, h.at);
  }
  return TROPHIES.map((tr) => ({
    id: tr.id, family: tr.family, group: tr.group, name: tr.name, condition: tr.condition, need: tr.need,
    have: Math.min(tr.need, tr.measure(a)), unlocked: got.get(tr.id) || null,
  }));
}

/** Trophies the last drill unlocked: in the case now, not in it one drill ago. */
export function newlyUnlocked(before, after) {
  const had = new Set(before.filter((t) => t.unlocked).map((t) => t.id));
  return after.filter((t) => t.unlocked && !had.has(t.id));
}

/**
 * A month for the calendar: weeks of seven cells, Sunday first. Each cell is
 * { day: "2026-09-22", date: 22, inMonth } and blank padding is null-free: the
 * spill-over days of the neighbouring months are there, marked inMonth false.
 */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const weeks = [];
  const d = new Date(start);
  do {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push({ day: dayOf(d.toISOString()), date: d.getDate(), inMonth: d.getMonth() === month });
      d.setDate(d.getDate() + 1);
    }
    weeks.push(week);
  } while (d.getMonth() === month);
  return weeks;
}

/**
 * Streak banners for one week row: the runs of 2 days or more that cross it,
 * as { from, to } column indexes and whether the run really starts or ends in
 * this row (a banner that wraps to the next week gets no rounded end there).
 */
export function bannersForWeek(week, runs) {
  const out = [];
  for (const r of runs) {
    if (r.days < 2) continue;
    const cols = week.map((c, i) => (c.day >= r.start && c.day <= r.end ? i : -1)).filter((i) => i >= 0);
    if (!cols.length) continue;
    const from = cols[0], to = cols[cols.length - 1];
    out.push({ from, to, starts: week[from].day === r.start, ends: week[to].day === r.end, days: r.days });
  }
  return out;
}

function num(x) { return Number.isFinite(Number(x)) ? Number(x) : 0; }
function round1(x) { return Math.round(x * 10) / 10; }
