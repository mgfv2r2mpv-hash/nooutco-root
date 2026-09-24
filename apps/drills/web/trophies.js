/* Days, streaks and trophies. Pure: history in, numbers out. node --test reads it.
 *
 * Every trophy is found by REPLAYING the history in time order, so its unlock
 * date is the drill that first met the condition, and a trophy can never be
 * lost or unlocked twice. Older records lack the newer fields (shift, habits,
 * think); a missing field counts as zero, never as a guess.
 */
import { dayOf } from "./panel.js";
import { BANDS } from "./score.js";
import { OUTLINE } from "./outline.js";
import { nemeses } from "./nemeses.js";

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
/** A secret: shown as "Secret" with its hint until it is earned. */
const secret = (id, name, condition, hint, measure) => ({ ...one("Secrets", id, name, condition, measure), secret: true, hint });

/* The ids are the ones the case has always used, so a trophy renamed here
   keeps the unlock date it already had. New ones only ever add ids. */
const CLOCK_NAMES = { 1: "Sprinter", 2: "Runner", 3: "Pacer", 4: "Distance Runner", 5: "Marathoner" };
const BAND_NAMES = { Average: "Cruising", Intermediate: "Picking Up Speed", Fluent: "Fluent Fingers", Professional: "Pro Typist",
  Expert: "Expert Hands", Elite: "Elite Fingers", Master: "Keyboard Master", Virtuoso: "Virtuoso", Stenographer: "Court Reporter" };

/* Short names for the domain trophies, one per BACB outline letter. */
const DOMAIN_NAMES = { A: "Radical", B: "Principled", C: "Data", D: "Design", E: "Ethics", F: "Assessment", G: "Procedures", H: "Intervention", I: "Supervision" };

/** His weak keys as of 2026-09-23, the ones the copy passages aim at. */
export const WEAK_KEYS = Object.freeze(["w", "m", "b", "u", "c"]);

/* Tips a drill can coach, and the achievement for making one go quiet. */
const RETIRABLE = [
  ["punctuation", "Full Stop, No Stall", "the punctuation tip (commas and full stops breaking your rhythm)"],
  ["cadence", "Steady Hands", "the rhythm tip (uneven timing inside words)"],
  ["shift", "Capital Gains", "the Shift tip (capitals costing you time)"],
  ["shiftSide", "Side Switcher", "the Shift side tip (capitals taken on the key's own side)"],
  ["optionDelete", "Word Eraser", "the Option+Backspace tip (words deleted letter by letter)"],
  ["drift", "Home Row Hero", "the home-row drift tip (neighbouring keys hit by mistake)"],
  ["pace", "Easy Does It", "the pace tip (more corrections than your eyes can keep up with)"],
];

export const TROPHIES = Object.freeze([
  ...tiers("Streaks", "streak", (a) => a.streak, [
    [3, "Warming Up"], [7, "On Fire"], [14, "Unstoppable"], [30, "Habit Formed"], [60, "Iron Will"], [100, "Centurion"],
  ], (n) => `Drill ${n} days in a row.`),
  ...tiers("Days", "days", (a) => a.days, [
    [5, "Regular"], [10, "Frequent Flyer"], [25, "Devoted"], [50, "Die-Hard"], [100, "Lifer"], [200, "Legend"],
  ], (n) => `Drill on ${n} different days.`),
  ...tiers("Sessions", "sessions", (a) => a.sessions, [
    [1, "First Keystrokes"], [10, "Getting the Hang of It"], [25, "Clockwork"], [50, "Half Century"], [100, "Centennial"], [250, "Grinder"], [500, "No Days Off"], [1000, "Thousand Club"],
  ], (n) => (n === 1 ? "Finish a drill." : `Finish ${n} drills.`)),
  ...[1, 2, 3, 4, 5].flatMap((m) => tiers("Clock length", `len${m}`, (a) => a.perLen[m] || 0, [
    [10, CLOCK_NAMES[m]], [50, `Seasoned ${CLOCK_NAMES[m]}`], [150, `${CLOCK_NAMES[m]} Legend`],
  ], (n) => `Finish ${n} drills on the ${m}-minute clock.`)),
  one("Clock length", "every-clock", "Full Range", "Finish at least one drill on each clock, 1 to 5 minutes.",
    (a) => [1, 2, 3, 4, 5].filter((m) => a.perLen[m]).length, 5),
  ...tiers("Words", "words", (a) => a.words, [
    [1000, "Wordsmith"], [5000, "Prolific"], [10000, "Chapter and Verse"], [25000, "Novella"], [50000, "NaNoWriMo"], [100000, "Epic"],
  ], (n) => `Type ${commas(n)} words in all (five keystrokes a word).`),
  ...tiers("Words", "kept", (a) => a.kept, [
    [250, "In Your Own Words"], [1000, "Found My Voice"], [5000, "Signature Style"], [20000, "Voice of Experience"],
  ], (n) => `Keep ${commas(n)} words: answers you pressed Keep it on, in your voice corpus.`),
  ...BANDS.slice(0, -1).slice().reverse().map((b) => one("Speed", `band-${b.name.toLowerCase()}`, BAND_NAMES[b.name] || b.name,
    `Reach ${b.min} NWAM on any clock (${b.name}).`, (a) => a.bestNwam, b.min)),
  one("Speed", "gwam-100", "Hundred Club", "Reach 100 GWAM on any clock.", (a) => a.bestGwam, 100),
  ...tiers("Speed", "pb", (a) => a.pbs, [[5, "Personal Best"], [25, "Record Breaker"], [75, "Never Satisfied"]],
    (n) => `Set ${n} personal bests (beating your old best at that clock).`),
  one("Speed", "leap", "Quantum Leap", "Beat your best at a clock by 10 NWAM or more in one drill.", (a) => a.leap),
  one("Clean", "clean-97", "Sharpshooter", "Finish a drill of 20 words or more at 97% accuracy or better.", (a) => a.clean97),
  one("Clean", "flawless", "Flawless Victory", "Finish a drill of 40 words or more at 100% accuracy.", (a) => a.flawless),
  one("Clean", "flawless-long", "Perfectionist", "Finish a drill on the 2-minute clock or longer at 100% accuracy.", (a) => a.flawlessLong),
  ...tiers("Clean", "combo", (a) => a.bestCombo, [[25, "Combo Starter"], [50, "Combo Master"], [100, "Untouchable"]],
    (n) => `Type ${n} clean words in a row: known, and no Backspace.`),
  one("Hands", "shift-drill", "Opposite Day", "Finish a drill with 8 capitals or more, every one with the opposite Shift.", (a) => a.shiftCleanDrill),
  ...tiers("Hands", "shift", (a) => a.shiftOk, [[100, "Crossover"], [1000, "Switch Pro"]],
    (n) => `Take ${commas(n)} capitals with the opposite-hand Shift.`),
  ...tiers("Hands", "revise", (a) => a.wordDeletes, [[25, "Option Unlocked"], [250, "Clean Slate"]],
    (n) => `Delete ${n} words with Option+Backspace.`),
  one("Hands", "weak-clean", "Five Clean Fingers",
    `Finish a drill pressing each of ${WEAK_KEYS.join(" ")} three times or more without missing one.`, (a) => a.weakClean),
  ...tiers("Field", "domains", (a) => a.domains, [[9, "Grand Tour"]], () => "Answer at least one question in each of the nine BACB domains."),
  ...tiers("Field", "items", (a) => a.items, [[25, "Explorer"], [50, "Cartographer"], [104, "Completionist"]],
    (n) => `Answer questions under ${n} different items of the BACB outline.`),
  ...tiers("Field", "lexicon", (a) => a.lexicon, [[10, "Jargon"], [50, "Walking Glossary"]],
    (n) => `Mark ${n} words clinical, into your lexicon.`),
  ...tiers("Habits", "sitting", (a) => a.bestSitting, [[3, "Hat Trick"], [5, "In the Zone"], [10, "Binge Session"]],
    (n) => `Finish ${n} drills in one sitting, each within 20 minutes of the last.`),
  one("Habits", "big-day", "Double Digits", "Finish 10 drills in one day.", (a) => a.bestDay, 10),
  one("Habits", "marathon-day", "Marathon Day", "Put 30 minutes or more on the clock in one day.", (a) => a.bestDayMinutes, 30),
  one("Habits", "full-spectrum", "Full Spectrum", "Finish a drill on every clock, 1 to 5 minutes, in one day.", (a) => a.fullSpectrum),
  one("Habits", "early", "Early Bird", "Finish a drill before 7 in the morning.", (a) => a.early),
  one("Habits", "late", "Night Owl", "Finish a drill after 10 at night.", (a) => a.late),
  one("Habits", "weekend", "Weekend Warrior", "Finish a drill on a Saturday or a Sunday.", (a) => a.weekend),
  one("Habits", "comeback", "The Return", "Drill again after a week or more away.", (a) => a.comeback),
  one("Modes", "copycat", "Copycat", "Finish a copy round.", (a) => a.copy),
  one("Modes", "talk-back", "Talk Back", "Finish a respond round: a free write on a passage you just copied.", (a) => a.respond),
  one("Modes", "on-a-roll", "On a Roll", "Keep going twice on one answer: three rounds in a row on the same prompt.", (a) => a.chain),
  one("Modes", "voice", "Voice Actor", "Answer a round by talking instead of typing.", (a) => a.spoken),
  one("Modes", "oracle", "Seeker", "Finish a round in Oracle mode.", (a) => a.oracle),
  // Getting better: each one compares his last five drills with his first
  // five, so it is earned by change, never by volume, and a lucky drill
  // cannot earn it alone.
  one("Getting better", "shift-better", "Switch Hitter",
    "Halve your same-side Shift share: your last 5 drills against your first 5, 10 capitals or more in each, starting from 15% or more.", (a) => a.shiftBetter),
  one("Getting better", "shift-run-5", "Clean Crossings",
    "Five drills in a row with 3 capitals or more each, every one with the opposite Shift.", (a) => a.shiftRun, 5),
  one("Getting better", "option-reflex", "Option Reflex",
    "Three in four of your word changes by Option+Backspace over your last 5 drills (4 changes or more), up a quarter or more from your first 5.", (a) => a.optionReflex),
  one("Getting better", "weak-better", "Weak Link No More",
    `Halve your miss rate on ${WEAK_KEYS.join(" ")}: your last 5 drills against your first 5, 100 presses or more of them in each.`, (a) => a.weakBetter),
  one("Getting better", "mid-better", "Unhesitating",
    "Halve your mid-word thinking stops: your last 5 drills against your first 5, which had 5 or more.", (a) => a.midBetter),
  one("Getting better", "accuracy-better", "Cleaning Up",
    "Raise your average accuracy 3 points: your last 5 drills of 20 words or more against your first 5.", (a) => a.accBetter),
  one("Getting better", "speed-better", "Level Up",
    "Raise your average NWAM by 5 at one clock: your last 5 drills there against your first 5.", (a) => a.speedBetter),
  ...RETIRABLE.map(([tip, name, what]) => one("Getting better", `retire-${tip}`, name,
    `Retire ${what}: it came up in 3 drills or more, then stayed quiet 5 drills in a row (40 words or more each).`, (a) => a.retired[tip] || 0)),
  // Conversations: staying with one idea over rounds, passes and days.
  ...tiers("Conversations", "baton", (a) => a.batonMax, [
    [1, "Pass the Baton"], [2, "Relay Team"], [3, "Anchor Leg"], [5, "Ultra Relay"], [10, "Endless Conversation"],
  ], (n) => (n === 1 ? "Pass the baton once: the expert answers your respond round with the next passage." : `Keep one baton chain going for ${n} passes.`)),
  ...tiers("Conversations", "baton-total", (a) => a.batonCopies, [[10, "Frequent Correspondent"], [50, "Pen Pals"]],
    (n) => `Copy ${n} passages the expert wrote back to you.`),
  ...tiers("Conversations", "keep-going", (a) => a.contMax, [[1, "Keep Going"], [4, "Stream of Thought"], [7, "Filibuster"]],
    (n) => (n === 1 ? "Keep going once: a second round on the same answer." : `Keep going ${n} times on one answer.`)),
  ...tiers("Conversations", "carried", (a) => a.carried, [[2, "Sleep On It"], [3, "The Long Game"]],
    (n) => `Answer the same prompt on ${n} different days.`),
  ...tiers("Conversations", "shelf-back", (a) => a.shelfBack, [[1, "Second Look"], [5, "Circle Back"], [20, "Nothing Left Behind"]],
    (n) => (n === 1 ? "Copy a shelved passage when it comes back to you." : `Copy ${n} shelved passages when they come back.`)),
  ...tiers("Conversations", "shelf-clear", (a) => a.shelfCleared, [[1, "Clean Shelf"], [5, "Tidy Mind"]],
    (n) => (n === 1 ? "Empty the shelf: copy the last passage waiting on it." : `Empty the shelf ${n} times.`)),
  ...tiers("Conversations", "variant", (a) => a.variants, [[1, "Same Idea, New Words"], [10, "Paraphrase Pro"]],
    (n) => (n === 1 ? "Copy a passage in its second wording." : `Copy ${n} passages in their second wording.`)),
  ...tiers("Conversations", "respond-n", (a) => a.respondN, [[10, "Conversationalist"], [50, "Debater"], [150, "Symposium"]],
    (n) => `Finish ${n} respond rounds.`),
  ...tiers("Conversations", "kept-n", (a) => a.keptN, [[1, "On the Record"], [10, "Testimony"], [50, "Oral History"], [150, "Collected Works"]],
    (n) => (n === 1 ? "Keep an answer: it goes to your voice corpus and the expert queue." : `Keep ${n} answers.`)),
  // The other side: a question that comes back for review wears a lens (review.js).
  one("The other side", "lens-steelman", "Devil's Advocate", "Answer a review question by steelmanning the view you usually argue against.", (a) => a.lens.steelman || 0),
  one("The other side", "lens-kneejerk", "Gut Check", "Answer a review question by testing your first reaction: habit or evidence?", (a) => a.lens.kneejerk || 0),
  one("The other side", "lens-mind", "Open Mind", "Answer a review question by naming what would change your mind.", (a) => a.lens.mind || 0),
  one("The other side", "lens-research", "Up to Date", "Answer a review question by saying what current research says and how you would check it.", (a) => a.lens.research || 0),
  one("The other side", "lens-all", "All Sides", "Answer through all four lenses: steelman, knee-jerk, what would change your mind, current research.", (a) => Object.keys(a.lens).length, 4),
  ...tiers("The other side", "reviews", (a) => a.reviewN, [[5, "Come Back Around"], [25, "Spaced Repetition"], [100, "Long-Term Memory"]],
    (n) => `Answer ${n} questions that came back for review.`),
  ...tiers("The other side", "lens-steelman-n", (a) => a.lens.steelman || 0, [[10, "Steel Sharpens Steel"]],
    (n) => `Steelman the other side ${n} times.`),
  // Teaching moments: the thirty-second nemesis drill (tame.js). Its rounds
  // come from settings.tame, never from history, and count only here.
  ...tiers("Teaching moments", "tame-n", (a) => a.tameN, [[1, "Sparring Partner"], [10, "Dojo Regular"], [50, "Sensei"]],
    (n) => (n === 1 ? "Take the thirty-second drill on a nemesis." : `Take ${n} nemesis drills.`)),
  ...tiers("Teaching moments", "tame-clean", (a) => a.tameClean, [[1, "Clean Hit"], [10, "Muscle Memory"]],
    (n) => (n === 1 ? "Finish a nemesis drill with the target costing you nothing." : `Finish ${n} nemesis drills with the target costing you nothing.`)),
  ...tiers("Teaching moments", "tame-targets", (a) => a.tameTargets, [[3, "Rogues' Gallery"]],
    (n) => `Drill ${n} different nemeses.`),
  ...tiers("Modes", "copy-n", (a) => a.copyN, [[10, "Scribe"], [50, "Scriptorium"], [150, "Illuminator"]],
    (n) => `Finish ${n} copy rounds.`),
  ...tiers("Modes", "passages", (a) => a.passages, [[10, "Well Read"], [25, "Bookworm"]],
    (n) => `Copy ${n} different passages from the field.`),
  ...tiers("Modes", "oracle-n", (a) => a.oracleN, [[10, "Pilgrim"], [50, "Oracle's Confidant"]],
    (n) => `Finish ${n} rounds in Oracle mode.`),
  ...tiers("Modes", "spoken-n", (a) => a.spokenN, [[10, "Radio Voice"], [50, "Podcaster"]],
    (n) => `Answer ${n} rounds by talking.`),
  // Thinking is never punished: taking back a thought earns something too.
  ...tiers("Modes", "revisions", (a) => a.revisions, [[10, "Second Thoughts"], [100, "Editor's Eye"], [500, "Ruthless Editor"]],
    (n) => `Take back ${n} thoughts in answer rounds (whole words deleted and rethought, never scored as errors).`),
  ...tiers("Hands", "strict-clean", (a) => a.strictClean, [[1, "Right Hand, Left Hand"], [10, "Crossed Wires No More"], [50, "Ambidextrous"]],
    (n) => `Finish ${n === 1 ? "a strict Shift drill" : `${n} strict Shift drills`} with 10 capitals or more and none refused.`),
  ...tiers("Speed", "gwam", (a) => a.bestGwam, [[110, "Blur"], [120, "Lightning Fingers"]],
    (n) => `Reach ${n} GWAM on any clock.`),
  one("Clean", "combo-200", "Unbreakable", "Type 200 clean words in a row: known, and no Backspace.", (a) => a.bestCombo, 200),
  ...tiers("Clean", "flawless-n", (a) => a.flawlessN, [[5, "Clean Sweep"], [25, "Immaculate"]],
    (n) => `Finish ${n} drills of 40 words or more at 100% accuracy.`),
  ...tiers("Clean", "clean-n", (a) => a.clean97N, [[10, "Marksman"], [50, "Sniper"], [150, "Dead Eye"]],
    (n) => `Finish ${n} drills of 20 words or more at 97% accuracy or better.`),
  ...tiers("Streaks", "streak-long", (a) => a.streak, [[200, "Bicentennial"], [365, "Year of Keys"]],
    (n) => `Drill ${n} days in a row.`),
  one("Days", "days-365", "Keeper of the Calendar", "Drill on 365 different days.", (a) => a.days, 365),
  one("Habits", "lunch", "Lunch Break", "Finish a drill between noon and 1 in the afternoon.", (a) => a.lunch),
  one("Habits", "every-weekday", "Seven Days a Week", "Drill on each day of the week, Sunday to Saturday.", (a) => a.weekdays, 7),
  one("Habits", "seasons", "Four Seasons", "Drill in all four seasons: winter, spring, summer and autumn.", (a) => a.seasons, 4),
  // One pair per BACB domain: answers filed under it.
  ...OUTLINE.flatMap((d) => tiers("Field", `domain-${d.letter}`, (a) => a.perDomain[d.letter] || 0,
    [[3, `${DOMAIN_NAMES[d.letter]} Initiate`], [15, `${DOMAIN_NAMES[d.letter]} Scholar`]],
    (n) => `Answer ${n} questions filed under ${d.letter}, ${d.name}.`)),
  secret("midnight", "Midnight Oil", "Finish a drill between midnight and 4 in the morning.", "Some ideas only come after midnight.", (a) => a.midnight),
  secret("friday-13", "Unlucky for Some", "Finish a drill on a Friday the 13th.", "Drill on a day most people would rather skip.", (a) => a.friday13),
  secret("new-year", "Fresh Start", "Finish a drill on New Year's Day.", "Start the year on the keys.", (a) => a.newYear),
  secret("photo-finish", "Photo Finish", "Tie your best NWAM at a clock to the tenth, without beating it.", "So close you could touch it.", (a) => a.photo),
  secret("deja-vu", "Deja Vu", "Two drills in a row with exactly the same NWAM.", "Do it again, exactly the same.", (a) => a.dejaVu),
]);

/* ---- getting better: first five against last five ---------------------- */

const WINDOW = 5;
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);

/** The first and last WINDOW drills of a list, or null until there are two whole windows. */
function windows(q) {
  return q.length < 2 * WINDOW ? null : { first: q.slice(0, WINDOW), last: q.slice(-WINDOW) };
}

/* Which drills each improvement reads. The replay files every drill into the
   lists it qualifies for as it goes, so a check reads ten drills, not the
   whole history again. */
const QUALIFIES = {
  shift: (h) => h.shift && num(h.shift.ok) + num(h.shift.same) > 0,
  habits: (h) => !!h.habits,
  weak: (h) => weakOf(h, "presses") > 0,
  think: (h) => !!h.think,
  acc: (h) => num(h.words) >= 20,
  tipped: (h) => Array.isArray(h.tips) && num(h.words) >= 40,
};

function shiftBetter(q) {
  const w = windows(q);
  if (!w) return 0;
  const share = (xs) => {
    const caps = sum(xs, (h) => num(h.shift.ok) + num(h.shift.same));
    return { caps, share: caps ? sum(xs, (h) => num(h.shift.same)) / caps : 0 };
  };
  const a = share(w.first), b = share(w.last);
  return a.caps >= 10 && b.caps >= 10 && a.share >= 0.15 && b.share <= a.share / 2 ? 1 : 0;
}

function optionReflex(q) {
  const w = windows(q);
  if (!w) return 0;
  const tally = (xs) => {
    const option = sum(xs, (h) => num(h.habits.wordDeletes)), byHand = sum(xs, (h) => num(h.habits.wordByHand));
    return { n: option + byHand, share: option + byHand ? option / (option + byHand) : 0 };
  };
  const a = tally(w.first), b = tally(w.last);
  return b.n >= 4 && b.share >= 0.75 && b.share - a.share >= 0.25 ? 1 : 0;
}

const weakOf = (h, f) => sum(WEAK_KEYS, (k) => num(h.keys && h.keys[k] && h.keys[k][f]));
function weakBetter(q) {
  const w = windows(q);
  if (!w) return 0;
  const rate = (xs) => ({ presses: sum(xs, (h) => weakOf(h, "presses")), misses: sum(xs, (h) => weakOf(h, "misses")) });
  const a = rate(w.first), b = rate(w.last);
  if (a.presses < 100 || b.presses < 100 || !a.misses) return 0;
  return b.misses / b.presses <= a.misses / a.presses / 2 ? 1 : 0;
}

function midBetter(q) {
  const w = windows(q);
  if (!w) return 0;
  const a = sum(w.first, (h) => num(h.think.mid)), b = sum(w.last, (h) => num(h.think.mid));
  return a >= 5 && b <= a / 2 ? 1 : 0;
}

function accBetter(q) {
  const w = windows(q);
  if (!w) return 0;
  const avg = (xs) => sum(xs, (h) => num(h.accuracy)) / xs.length;
  // A hair under 0.03, so 0.90 to 0.93 counts despite floating point.
  return avg(w.last) - avg(w.first) >= 0.0299 ? 1 : 0;
}

/** q: the drills at one clock that were typed (GWAM over zero). */
function speedBetter(q) {
  const w = windows(q);
  if (!w) return 0;
  const avg = (xs) => sum(xs, (h) => num(h.nwam)) / xs.length;
  return avg(w.last) - avg(w.first) >= 4.999 ? 1 : 0;
}

/**
 * q: drills that can show a tip (tips were recorded, and 40 words gave them
 * room to fire); fired: how many of them each tip came up in. When the last
 * WINDOW are quiet, every firing was before them, so the count is the "before".
 */
function retiredTips(q, fired) {
  const out = {};
  if (q.length < 3 + WINDOW) return out;
  const quiet = q.slice(-WINDOW);
  for (const [tip] of RETIRABLE) {
    if ((fired[tip] || 0) >= 3 && !quiet.some((h) => h.tips.includes(tip))) out[tip] = 1;
  }
  return out;
}

/** The running totals the trophies read, advanced one drill at a time. */
function emptyAgg() {
  return {
    sessions: 0, days: 0, streak: 0, perLen: {}, words: 0, kept: 0, bestNwam: 0, bestGwam: 0, pbs: 0, leap: 0,
    clean97: 0, flawless: 0, flawlessLong: 0, bestCombo: 0, shiftOk: 0, shiftCleanDrill: 0, wordDeletes: 0, weakClean: 0,
    domains: 0, items: 0, lexicon: 0, bestSitting: 0, bestDay: 0, bestDayMinutes: 0, fullSpectrum: 0,
    early: 0, late: 0, weekend: 0, comeback: 0, copy: 0, respond: 0, chain: 0, spoken: 0, oracle: 0,
    shiftBetter: 0, shiftRun: 0, optionReflex: 0, weakBetter: 0, midBetter: 0, accBetter: 0, speedBetter: 0, retired: {},
    midnight: 0, friday13: 0, newYear: 0, photo: 0, dejaVu: 0,
    batonMax: 0, batonCopies: 0, contMax: 0, carried: 0, shelfBack: 0, shelfCleared: 0, variants: 0, respondN: 0, keptN: 0,
    copyN: 0, passages: 0, oracleN: 0, spokenN: 0, revisions: 0, strictClean: 0, flawlessN: 0, clean97N: 0,
    lunch: 0, weekdays: 0, seasons: 0, perDomain: {}, reviewN: 0, lens: {}, tameN: 0, tameClean: 0, tameTargets: 0,
  };
}

/**
 * The trophy case: every trophy with { unlocked: ISO or null, have, need }.
 * tame is the nemesis drill log (settings.tame): replayed in time order with
 * the history so its dates stay true, but counted only by its own trophies.
 */
export function trophyCase(history, tame = []) {
  const list = sorted([...(history || []), ...(tame || [])]);
  const a = emptyAgg();
  const got = new Map();
  const days = new Set(), domains = new Set(), items = new Set();
  const perDay = new Map(), dayMinutes = new Map(), dayClocks = new Map();
  const bestAt = {};
  const lists = Object.fromEntries(Object.keys(QUALIFIES).map((k) => [k, []]));
  const byClock = {};
  const fired = {};
  let lastDay = null, run = 0, sit = 0, lastT = null, shiftRun = 0, lastNwam = null;
  const talk = { passages: new Set(), convDays: new Map(), weekdays: new Set(), seasons: new Set() };
  const tamed = new Set();
  for (const h of list) {
    if (h.mode === "tame") {
      a.tameN += 1;
      if (h.clean) a.tameClean += 1;
      tamed.add(String(h.target)); a.tameTargets = tamed.size;
      for (const tr of TROPHIES) if (!got.has(tr.id) && tr.measure(a) >= tr.need) got.set(tr.id, h.at);
      continue;
    }
    const t = Date.parse(h.at), day = dayOf(h.at), when = new Date(t);
    for (const [k, keep] of Object.entries(QUALIFIES)) if (keep(h)) lists[k].push(h);
    a.sessions += 1;
    if (lastDay && daysBetween(lastDay, day) >= 8) a.comeback = 1;
    if (day !== lastDay) { run = lastDay && daysBetween(lastDay, day) === 1 ? run + 1 : 1; lastDay = day; }
    a.streak = Math.max(a.streak, run);
    days.add(day); a.days = days.size;
    perDay.set(day, (perDay.get(day) || 0) + 1); a.bestDay = Math.max(a.bestDay, perDay.get(day));
    sit = lastT !== null && t - lastT <= SITTING_GAP_MS ? sit + 1 : 1; lastT = t;
    a.bestSitting = Math.max(a.bestSitting, sit);
    const m = Number(h.minutes);
    if (m) {
      a.perLen[m] = (a.perLen[m] || 0) + 1;
      dayMinutes.set(day, (dayMinutes.get(day) || 0) + m);
      a.bestDayMinutes = Math.max(a.bestDayMinutes, dayMinutes.get(day));
      const clocks = dayClocks.get(day) || new Set();
      clocks.add(m); dayClocks.set(day, clocks);
      if ([1, 2, 3, 4, 5].every((c) => clocks.has(c))) a.fullSpectrum = 1;
    }
    const words = num(h.words);
    a.words += words;
    if (h.kept) a.kept += words;
    const nwam = num(h.nwam);
    const prior = m ? bestAt[m] : undefined;
    if (prior != null && nwam > prior) a.pbs += 1;
    if (prior != null && prior > 0 && nwam - prior >= 9.999) a.leap = 1;
    if (prior != null && prior > 0 && nwam === prior) a.photo = 1;
    if (lastNwam !== null && nwam > 0 && nwam === lastNwam) a.dejaVu = 1;
    lastNwam = nwam;
    if (m) bestAt[m] = Math.max(bestAt[m] ?? -1, nwam);
    a.bestNwam = Math.max(a.bestNwam, nwam); a.bestGwam = Math.max(a.bestGwam, num(h.gwam));
    if (words >= 20 && num(h.accuracy) >= 0.97) a.clean97 = 1;
    if (words >= 40 && num(h.accuracy) >= 1) a.flawless = 1;
    if (m >= 2 && words >= 40 && num(h.accuracy) >= 1) a.flawlessLong = 1;
    a.bestCombo = Math.max(a.bestCombo, num(h.bestCombo));
    const sh = h.shift || {};
    a.shiftOk += num(sh.ok);
    if (num(sh.ok) >= 8 && num(sh.same) === 0) a.shiftCleanDrill = 1;
    // Drills with under 3 capitals neither add to the clean run nor break it.
    if (num(sh.ok) + num(sh.same) >= 3) shiftRun = num(sh.same) === 0 ? shiftRun + 1 : 0;
    a.shiftRun = Math.max(a.shiftRun, shiftRun);
    a.wordDeletes += num(h.habits && h.habits.wordDeletes);
    if (h.keys && WEAK_KEYS.every((k) => h.keys[k] && num(h.keys[k].presses) >= 3 && num(h.keys[k].misses) === 0)) a.weakClean = 1;
    if (h.outline) { domains.add(String(h.outline)[0]); items.add(h.outline); }
    a.domains = domains.size; a.items = items.size;
    a.lexicon = Math.max(a.lexicon, num(h.lexicon));
    if (h.mode === "copy") a.copy = 1;
    if (h.mode === "respond") a.respond = 1;
    if (h.mode === "oracle") a.oracle = 1;
    if (h.spoken) a.spoken = 1;
    if (num(h.cont) >= 2) a.chain = 1;
    const hour = when.getHours();
    if (hour < 7) a.early = 1;
    if (hour >= 22) a.late = 1;
    if (hour < 4) a.midnight = 1;
    if (when.getDay() === 0 || when.getDay() === 6) a.weekend = 1;
    if (when.getDay() === 5 && when.getDate() === 13) a.friday13 = 1;
    if (when.getMonth() === 0 && when.getDate() === 1) a.newYear = 1;
    conversations(a, h, day, talk);
    if (hour === 12) a.lunch = 1;
    talk.weekdays.add(when.getDay()); a.weekdays = talk.weekdays.size;
    talk.seasons.add(Math.floor(((when.getMonth() + 1) % 12) / 3));
    a.seasons = talk.seasons.size;
    if (words >= 20 && num(h.accuracy) >= 0.97) a.clean97N += 1;
    if (words >= 40 && num(h.accuracy) >= 1) a.flawlessN += 1;
    if (h.refused !== undefined && num(sh.ok) >= 10 && num(h.refused) === 0) a.strictClean += 1;
    // Improvements are sticky: once earned, a later slip does not take them back.
    if (m && num(h.gwam) > 0) (byClock[m] ||= []).push(h);
    if (QUALIFIES.tipped(h)) for (const tip of h.tips) fired[tip] = (fired[tip] || 0) + 1;
    a.shiftBetter ||= shiftBetter(lists.shift);
    a.optionReflex ||= optionReflex(lists.habits);
    a.weakBetter ||= weakBetter(lists.weak);
    a.midBetter ||= midBetter(lists.think);
    a.accBetter ||= accBetter(lists.acc);
    if (m && byClock[m]) a.speedBetter ||= speedBetter(byClock[m]);
    if (QUALIFIES.tipped(h)) for (const tip of Object.keys(retiredTips(lists.tipped, fired))) a.retired[tip] = 1;
    for (const tr of TROPHIES) if (!got.has(tr.id) && tr.measure(a) >= tr.need) got.set(tr.id, h.at);
  }
  // His nemeses first: they are the ones written from his own data.
  const mine = nemeses(list.filter((h) => h.mode !== "tame")).map((n) => ({
    id: n.id, family: n.family, group: n.group, kind: n.kind, name: n.name, condition: n.condition, need: n.need,
    // A full window that has not tamed it yet is one drill short, never "12 of 12".
    have: n.unlocked ? n.need : Math.min(n.need - 1, n.have), spotted: n.spotted, unlocked: n.unlocked,
  }));
  return [...mine, ...TROPHIES.map((tr) => ({
    id: tr.id, family: tr.family, group: tr.group, name: tr.name, condition: tr.condition, need: tr.need,
    ...(tr.secret ? { secret: true, hint: tr.hint } : {}),
    have: Math.min(tr.need, tr.measure(a)), unlocked: got.get(tr.id) || null,
  }))];
}

/* The conversation measures, one drill at a time. A baton passage's id is
   "baton-N", N the pass it came from; a conversation is one prompt (the
   passage, or the bank question) answered in any composed mode. Baton ids
   restart with every chain, so they are not counted as one conversation. */
function conversations(a, h, day, talk) {
  const baton = /^baton-(\d+)$/.exec(h.passage || "");
  if (baton) a.batonMax = Math.max(a.batonMax, Number(baton[1]));
  if (h.mode === "copy") {
    a.copyN += 1;
    if (baton) a.batonCopies += 1;
    else if (h.passage) { talk.passages.add(h.passage); a.passages = talk.passages.size; }
    if (h.fromShelf) a.shelfBack += 1;
    if (h.shelfEmpty) a.shelfCleared += 1;
    if (h.variant) a.variants += 1;
    return;
  }
  a.contMax = Math.max(a.contMax, num(h.cont));
  a.revisions += num(h.revisions);
  if (h.mode === "respond") a.respondN += 1;
  if (h.mode === "oracle") a.oracleN += 1;
  if (h.spoken) a.spokenN += 1;
  if (h.kept) a.keptN += 1;
  // A Keep going round of a review is the same answer, not a second review.
  if (h.review && !num(h.cont)) {
    a.reviewN += 1;
    if (h.lens) a.lens = { ...a.lens, [h.lens]: (a.lens[h.lens] || 0) + 1 };
  }
  if (h.outline) { const d = String(h.outline)[0]; a.perDomain[d] = (a.perDomain[d] || 0) + 1; }
  const key = baton ? null : h.passage || h.itemId;
  if (!key) return;
  const seen = talk.convDays.get(key) || new Set();
  seen.add(day); talk.convDays.set(key, seen);
  a.carried = Math.max(a.carried, seen.size);
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
