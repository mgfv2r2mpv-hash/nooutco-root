/* ClickClackOracle (was Clinical Typing Drills): the page.
 *
 * idle -> armed (question up, waiting for the first key) -> running (clock)
 * -> done (score). The clock starts on the first keystroke, never on a button:
 * the seconds spent reading the question are reading, not typing.
 *
 * Numbers are saved after every drill (the progress panel needs them). The TEXT
 * leaves the page only when he presses Keep it, his ruling of 2026-09-22, and
 * then goes to the voice corpus (drill register) and the expert queue through
 * the Mac app's shell. See store.js.
 */
import { scoreDrill, isKnown } from "./score.js";
import { nextItem, BANK, bankWords } from "./bank.js";
import { emptiestCell, render as renderMap } from "./map.js";
import { itemById, ITEMS } from "./outline.js";
import * as store from "./store.js";
import { createGarden, createHeat } from "./ornament.js";
import { bests, streak, sitting, ladder, personalLadder, refusedWeeks, refusedText, stars, keyTrends, keyboardRates, lineChart, sparkline, keyboard, dayOf } from "./panel.js";
import { trophyCase, newlyUnlocked } from "./trophies.js";
import { newlySpotted } from "./nemeses.js";
import { createCalendar, renderTrophies } from "./calendar.js";
import { handOf, judge, createShiftTracker, createShiftFx } from "./shift.js";
import { nextPassage, trickyProfile, describeProfile, PASSAGES } from "./passages.js";
import { pickWords, openPairGame } from "./pairgame.js";
import { buildShifty, openShifty, shiftyPool } from "./shifty.js";
import { openRiver } from "./river.js";
import { closeGames } from "./gamebox.js";
import { addRun, progressLine, gameTrophies } from "./minigames.js";
import { tameTarget, tameDrill, tameReport, tameEntry, appendTame, TAME_SECONDS } from "./tame.js";
import { renderPassage, markPassage } from "./copy.js";
import { shelve, unshelve, dueEntry, returned, describeShelf, copyRounds } from "./shelf.js";
import { pickReview, asReview, describeReviews } from "./review.js";
import { renderRead } from "./read.js";
import { bandUp, bandRoad } from "./bands.js";
import { nextSeed, openWithSeed } from "./seeds.js";
import { researchContext, toneOf } from "./stance.js";
import { ORACLE_SYSTEM, ORACLE_SCHEMA, oraclePrompt, readOracle, DRAFT_SYSTEM, DRAFT_SCHEMA, draftPrompt, toProposal,
  BATON_SYSTEM, BATON_SCHEMA, batonPrompt, readBaton, batonQuotes, batonWords, relevantRecords } from "./oracle.js";

const params = new URLSearchParams(location.search);
// ?clock=SECONDS overrides the minute picker: tests, and a quick look.
const CLOCK_OVERRIDE = Number(params.get("clock"));

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const root = $("main.drill");
const els = {
  setup: $("[data-drill-setup]"), start: $("[data-drill-start]"), mins: $$("[data-drill-minutes]"), pb: $("[data-drill-pb]"), road: $("[data-drill-road]"), levelUp: $("[data-drill-levelup]"),
  streak: $("[data-stat-streak]"), sitting: $("[data-stat-sitting]"), today: $("[data-stat-today]"), trophyChip: $("[data-stat-trophies]"),
  calendar: $("[data-drill-calendar]"), trophies: $("[data-drill-trophies]"), unlocked: $("[data-drill-unlocked]"), think: $("[data-drill-think]"),
  question: $("[data-drill-question]"), category: $("[data-drill-category]"), q: $("[data-drill-q]"), bullets: $("[data-drill-bullets]"),
  clock: $("[data-drill-clock]"), wpm: $("[data-drill-wpm]"), combo: $("[data-drill-combo]"), hint: $("[data-drill-hint]"), box: $("[data-drill-box]"),
  raceYou: $("[data-race-you]"), raceGhost: $("[data-race-ghost]"), raceNote: $("[data-race-note]"), live: $("[data-drill-live]"),
  results: $("[data-drill-results]"), nwam: $("[data-drill-nwam]"), gwam: $("[data-drill-gwam]"), errors: $("[data-drill-errors]"),
  accuracy: $("[data-drill-accuracy]"), rating: $("[data-drill-rating]"), ratingNote: $("[data-drill-rating-note]"), stars: $("[data-drill-stars]"),
  next: $("[data-drill-next]"), basis: $("[data-drill-basis]"), tabs: $$("[data-tab]"), panes: $$("[data-pane]"),
  pace: $("[data-drill-pace]"), tricky: $("[data-drill-tricky]"), timing: $("[data-drill-timing]"), tips: $("[data-drill-tips]"),
  review: $("[data-drill-review]"), reviewList: $("[data-drill-review-list]"),
  chartNwam: $("[data-chart-nwam]"), chartAcc: $("[data-chart-accuracy]"), bests: $("[data-drill-bests]"), trend: $("[data-drill-trend]"),
  keyboard: $("[data-drill-keyboard]"), keytrends: $("[data-drill-keytrends]"), mapGrid: $("[data-drill-map-grid]"),
  again: $("[data-drill-again]"), keep: $("[data-drill-keep]"), keepnote: $("[data-drill-keepnote]"), home: $("[data-drill-home]"),
  opens: $$("[data-drill-open]"), modes: $$("[data-drill-mode]"), lede: $("[data-drill-lede]"),
  passage: $("[data-drill-passage]"), ref: $("[data-drill-ref]"), refText: $("[data-drill-ref-text]"),
  cont: $("[data-drill-continue]"), working: $("[data-drill-working]"),
  oracleTopic: $("[data-drill-oracle-topic]"), oracleOnly: $$("[data-oracle-only]"), mic: $("[data-drill-mic]"), baton: $("[data-drill-baton]"), pending: $("[data-drill-pending]"),
  send: $("[data-drill-send]"), expertStatus: $("[data-drill-expert-status]"), expertToken: $("[data-drill-expert-token]"),
  strictShift: $("[data-drill-strict-shift]"), tame: $("[data-drill-tame]"), tameHome: $("[data-drill-tame-home]"),
  read: $("[data-drill-read]"), respond: $("[data-drill-respond]"), shelve: $("[data-drill-shelve]"), numbers: $("[data-drill-numbers]"),
  readHome: $("[data-drill-read-home]"), readNote: $("[data-drill-read-note]"), readUnlocked: $("[data-drill-read-unlocked]"), readLevelUp: $("[data-drill-read-levelup]"),
  readParts: { score: $("[data-drill-read-score]"), title: $("[data-drill-read-title]"), source: $("[data-drill-read-source]"),
    text: $("[data-drill-read-text]"), sources: $("[data-drill-read-sources]"), question: $("[data-drill-read-question]") },
  shelf: $("[data-drill-shelf]"), dueReviews: $("[data-drill-reviews]"), mapShelf: $("[data-drill-map-shelf]"),
  saveNote: $("[data-drill-savenote]"),
  expertConnect: $("[data-drill-expert-connect]"), expertSend: $("[data-drill-expert-send]"), expertLog: $("[data-drill-expert-log]"),
};

const data = { history: [], lexicon: [], settings: {} };

/* Every save goes through persist (AUDIT S6): a refused write is caught and shows
 * one quiet line under the bar, never an unhandled rejection. Each save writes the
 * whole list, so the next save of the same kind retries it and clears the line. */
const SAVE_WHAT = { saveHistory: "history", saveLexicon: "clinical words", saveSettings: "settings" };
const saveFailed = new Set();
function persist(op, value) {
  const done = (ok, why) => {
    if (ok) saveFailed.delete(op);
    else { saveFailed.add(op); store.log(`save ${op} failed: ${String(why).slice(0, 200)}`); }
    const what = [...saveFailed].map((k) => SAVE_WHAT[k]);
    els.saveNote.hidden = !what.length;
    els.saveNote.textContent = what.length ? `Your ${what.join(" and ")} could not be saved to disk just now. It is still here on screen, and the next save tries again.` : "";
  };
  return Promise.resolve()
    .then(() => store[op](value))
    .then((r) => done(!(r && r.ok === false), r && r.note), (e) => done(false, e));
}
let WORDS = null;
let bankSet = bankWords();

const state = {
  phase: "idle", minutes: 1, item: null, events: [], t0: 0, deadline: 0, timer: 0, score: null,
  flagged: [], combo: 0, bestCombo: 0, backspaceInWord: false, record: null, kept: false,
  pendingDelete: null, bsRun: 0, coached: false,
  // The round: "answer" (a bank question), "copy" (type a passage), "respond"
  // (answer the passage). roundMinutes is this round's clock: the picked one,
  // or one minute for a respond. prefix is where a Keep going round's own
  // text starts in the box; answerAt and keptUpTo tie the rounds of one answer.
  mode: "answer", passage: null, roundMinutes: 1, prefix: 0, cont: 0, answerAt: null, keptUpTo: 0,
  // The oracle: its topic, the turns so far ({ question, answer }), and this turn's reply.
  // listening/spoken: the microphone is on / this round holds words he TALKED.
  oracle: null, busy: false, listening: false, spoken: false, micBase: "",
  // micHeard: the last partial of the utterance under way; micSkip: how many
  // of its words already sit in micBase, because he typed after them.
  micHeard: "", micSkip: 0,
  // The baton pass: how many times this chain has gone to the expert and back.
  baton: 0,
};
// Kept answers being drafted right now, by their `at` stamp, so a baton
// pass in the background and the Send button never propose the same one twice.
const inFlight = new Set();

const garden = createGarden($("[data-garden]"), { column: 900 });
let heat = createHeat();
const shiftKeys = createShiftTracker();
const shiftFx = createShiftFx($("[data-sidefx]"));
const calendar = createCalendar(els.calendar);

/* ---- the word list ------------------------------------------------------ */
function known() {
  if (!WORDS) return null;
  const all = new Set(WORDS);
  for (const w of bankSet) all.add(w);
  for (const w of data.lexicon) all.add(w);
  for (const w of plainWords()) all.add(w);
  return all;
}
let knownCache = null;
function knownNow() { return knownCache || (knownCache = known()); }
const wordsLoaded = fetch(new URL("./words.txt", import.meta.url))
  .then((r) => (r.ok ? r.text() : ""))
  .then((t) => { if (!t || t.trimStart().startsWith("<")) return; const w = t.split("\n").filter(Boolean); if (w.length) { WORDS = w; knownCache = null; } })
  .catch(() => {});

/* ---- helpers ------------------------------------------------------------ */
const secondsFor = () => (CLOCK_OVERRIDE > 0 ? CLOCK_OVERRIDE : state.roundMinutes * 60);
/** Copy speed and compose speed are different skills: bests and heat never mix them. */
const kindOf = (h) => (h && h.mode === "copy" ? "copy" : h && h.mode === "tame" ? "tame" : "compose");
const ofKind = (kind) => (kind === "tame" ? tameLog() : data.history.filter((h) => kindOf(h) === kind));
const roundKind = () => kindOf({ mode: state.mode });
/* A copy round and a nemesis drill both type a reference text, word for word. */
const copyLike = () => state.mode === "copy" || state.mode === "tame";
/* The nemesis drill's own log: never in history, so never in bests or bands. */
const tameLog = () => (Array.isArray(data.settings.tame) ? data.settings.tame : []);
const trophies = () => trophyCase(data.history, tameLog());
const minutesFor = () => secondsFor() / 60;
function clockText(s) {
  const m = Math.floor(s / 60), r = Math.max(0, Math.floor(s - m * 60));
  return m + ":" + String(r).padStart(2, "0");
}
/* Every new screen starts at its top. His report of 2026-09-24: focusing a
   button scrolled the results to their bottom, and the next, shorter screen
   kept that scroll and showed white space. So focus never scrolls, and a
   screen change (anything but armed to running) resets it. */
function setPhase(p) {
  const changed = p !== state.phase && p !== "running";
  state.phase = p; root.dataset.drillState = p;
  if (changed || p === "armed") window.scrollTo(0, 0);
}
function li(text) { const n = document.createElement("li"); n.textContent = text; return n; }
function keyName(k) { return k === " " ? "space" : k === "\n" ? "return" : k; }
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function usualAndBest() {
  const mine = ofKind(roundKind());
  const same = mine.filter((h) => h.minutes === state.roundMinutes && Number.isFinite(h.nwam));
  const pool = same.length >= 3 ? same : mine.filter((h) => Number.isFinite(h.nwam));
  const usual = pool.length ? median(pool.slice(-10).map((h) => h.nwam)) : 35;
  const best = pool.length ? Math.max(...pool.map((h) => h.nwam)) : 70;
  return { usual, best };
}

/* ---- setup ---------------------------------------------------------------- */
function setMinutes(m, save = true) {
  state.minutes = m;
  for (const b of els.mins) b.classList.toggle("is-on", Number(b.dataset.drillMinutes) === m);
  state.roundMinutes = m;
  els.clock.textContent = clockText(secondsFor());
  const copying = data.settings.mode === "copy";
  const b = bests(ofKind(copying ? "copy" : "compose"))[String(m)];
  const what = copying ? "copying" : "answering";
  els.pb.textContent = b != null
    ? `Your best ${what} at ${m} minute${m === 1 ? "" : "s"}: ${b.toFixed(1)} NWAM. Beat it.`
    : `No ${what} drill at ${m} minute${m === 1 ? "" : "s"} yet. This one sets the bar.`;
  if (save) { data.settings = { ...data.settings, minutes: m }; persist("saveSettings", data.settings); }
  renderRoad(ofKind(copying ? "copy" : "compose"), what);
}
/* The bands as a road on the home screen: gilded where his numbers have been. */
function renderRoad(history, what) {
  const road = bandRoad(history);
  els.road.hidden = !road;
  if (!road) { els.road.replaceChildren(); return; }
  const ol = document.createElement("ol");
  ol.className = "road-gems";
  ol.append(...road.bands.map((b) => {
    const n = document.createElement("li");
    n.className = `gem is-${b.state}`;
    n.dataset.band = b.name;
    n.title = `${b.name}: ${b.min} NWAM and up`;
    const i = document.createElement("i");
    i.setAttribute("aria-hidden", "true");
    n.append(i, Object.assign(document.createElement("span"), { textContent: b.name }));
    return n;
  }));
  els.road.replaceChildren(ol, Object.assign(document.createElement("p"), { className: "road-line", textContent: `${road.line} (${what})` }));
}
const LEDES = {
  answer: "One clinical question. One to five minutes, as fast and as clean as you can. The garden grows with every word, and warms when you fly.",
  copy: "Copy a passage from the field for the clock you pick, word for word, then answer it in your own words for a minute. Keep going if you have more to say, or pass the baton: the expert answers you with the next passage.",
  oracle: "The oracle shares a little of its thinking and asks you one question. Answer for a minute, typing or talking. Return asks the follow-up; what you keep goes to the expert.",
};
function setMode(mode, save = true) {
  const m = LEDES[mode] ? mode : "copy";
  for (const b of els.modes) b.classList.toggle("is-on", b.dataset.drillMode === m);
  els.lede.textContent = LEDES[m];
  for (const n of els.oracleOnly) n.hidden = m !== "oracle";
  if (save) data.settings = { ...data.settings, mode: m };
  setMinutes(state.minutes, save);
}
function renderChips() {
  const s = streak(data.history);
  els.streak.textContent = s ? `${s} day${s === 1 ? "" : "s"} in a row` : "";
  const n = sitting(data.history);
  els.sitting.textContent = n ? `round ${n + (state.phase === "idle" ? 1 : 0)} this sitting` : "";
  const today = dayOf(new Date().toISOString());
  const t = data.history.filter((h) => h && h.at && dayOf(h.at) === today).length;
  els.today.textContent = t ? `${t} today` : "";
  const won = trophies().filter((x) => x.unlocked).length;
  els.trophyChip.textContent = won ? `${won} trophies` : "";
  els.trophyChip.hidden = !won;
}
function home() {
  holdIfUnkept();
  // Esc while talking: the Mac microphone goes off with the round (AUDIT A4).
  if (state.listening) stopMic();
  // A game left open on the results goes with them, timers and all (AUDIT G3).
  closeGames(els.results);
  clearTimeout(state.timer);
  setPhase("idle");
  els.setup.hidden = false;
  els.question.hidden = true;
  els.results.hidden = true;
  els.read.hidden = true;
  delete root.dataset.drillView;
  garden.reset(); garden.cool();
  shiftFx.clear();
  setMinutes(state.minutes, false);
  renderChips();
  renderShelf();
  renderTameOffer();
  els.start.focus({ preventScroll: true });
}

/* ---- arm ---------------------------------------------------------------- */
/* A new drill: a bank question, or a passage to copy. */
function arm() {
  // Busy is more than CSS: a reply that lands later would take over a round
  // started under it and clear its box (AUDIT S3).
  if (state.busy) return;
  state.baton = 0;
  if (data.settings.mode === "oracle") { armOracle(false); return; }
  if (data.settings.mode === "copy") {
    const recent = data.history.filter((h) => h.mode === "copy").map((h) => h.passage);
    // His ask: the passages work his tricky areas, and adapt as he improves.
    // The profile is read fresh from the recent drills every time.
    state.tricky = trickyProfile(data.history, keyboardRates(data.history, 20));
    state.weak = state.tricky.keys;
    // A shelved passage whose turn has come goes first, in new words.
    // A shelved id that no longer exists is dropped, so it never blocks the ones behind it.
    let back = null;
    for (let entry = dueEntry(shelf(), shelfNow()); entry && !back; entry = dueEntry(shelf(), shelfNow())) {
      back = returned(entry);
      if (!back) saveShelf(unshelve(shelf(), entry.id));
    }
    armCopy(back || nextPassage(recent, state.tricky, shelf().map((e) => e.id)));
    return;
  }
  // A question due for another look goes first, from the other side (review.js);
  // never two reviews in a row, so the map still gets its turn.
  const review = pickReview(data.history, Date.now(), inBank);
  if (review) state.item = asReview(BANK.find((b) => b.id === review.itemId), review.lens);
  else {
    const recent = data.history.map((h) => h.itemId);
    // His ruling: the next question comes from the emptiest cell of the map.
    const cell = emptiestCell({ bank: BANK, history: data.history });
    state.item = nextItem(recent, Math.random, cell);
  }
  state.passage = null;
  startRound("answer", state.minutes, null);
}

const inBank = (id) => BANK.some((b) => b.id === id);

/* Copy: the passage for the picked clock, word for word. Never kept. */
function armCopy(passage) {
  state.passage = passage;
  const tag = passage.kind === "baton" ? `baton pass ${state.baton}` : passage.kind === "take" ? "the drill's take" : "study";
  state.item = { id: passage.id, outline: passage.outline, tag: passage.fromShelf ? `${tag} \u00b7 back from the shelf` : tag, question: passage.title, bullets: [] };
  startRound("copy", state.minutes, null);
}

/* Respond: a minute, in his own words, on the passage he just copied. */
function armRespond() {
  const p = state.passage;
  if (!p) { arm(); return; }
  // A baton passage carries the expert's sources; they sit beside the question.
  const bullets = (p.sources || []).map((x) => ({ text: x.claim, source: x.source }));
  state.item = { id: p.id, outline: p.outline, tag: p.kind === "baton" ? `respond · baton pass ${state.baton}` : "respond", question: p.respond, bullets };
  startRound("respond", 1, null);
}

/* ---- the oracle ------------------------------------------------------------
   His Claude Code on this Mac asks one question and shares its thinking (his
   ruling 1A). A follow-up carries every turn so far, his answers included, so
   the next question builds on what he said. */
function busy(text) {
  state.busy = !!text;
  root.dataset.busy = text ? "1" : "";
  if (text) { els.pb.textContent = text; els.keepnote.textContent = text; }
  // Busy over: home's line goes back to the minute line (AUDIT S4).
  else if (state.phase === "idle") setMinutes(state.minutes, false);
}
async function armOracle(followUp) {
  if (state.busy) return;
  let topic, outline, seed = null;
  const turns = followUp && state.oracle ? state.oracle.turns.concat([{ question: state.oracle.reply.question, answer: els.box.value.trim() }]) : [];
  if (followUp && state.oracle) ({ topic, outline, seed } = state.oracle);
  else {
    const typed = els.oracleTopic ? els.oracleTopic.value.trim() : "";
    if (typed) { topic = typed; outline = null; }
    else if (openWithSeed(data.history)) {
      // No topic typed, and the last conversation came from the map: a live
      // question the field has not settled, asking for his view.
      const s = nextSeed(data.history);
      ({ topic, outline } = s);
      seed = s.id;
    } else {
      // No topic typed: the thinnest part of the map, as the bank does.
      const cell = emptiestCell({ bank: BANK, history: data.history, recent: 0 });
      const it = cell && itemById(cell);
      topic = it ? it.text : "a clinical question of your choosing";
      outline = it ? it.id : null;
    }
  }
  busy("The oracle is thinking. It usually takes about fifteen seconds.");
  const r = await store.askClaude({ system: ORACLE_SYSTEM, prompt: oraclePrompt({ topic, outline, turns }), schema: ORACLE_SCHEMA, webSearch: true })
    .catch((e) => ({ ok: false, note: String(e) }));
  const reply = r && r.ok ? readOracle(r.output) : null;
  busy("");
  if (!reply) {
    const why = (r && r.note) || "The oracle's reply could not be read.";
    els.pb.textContent = why; els.keepnote.textContent = why;
    return;
  }
  state.oracle = { topic, outline, seed, turns, reply };
  const bullets = reply.thoughts.map((t) => ({ text: t.text, source: t.source }));
  if (reply.reflection) bullets.unshift({ text: reply.reflection, source: "the oracle, on your last answer" });
  state.passage = null;
  state.item = { id: "oracle", outline, tag: `oracle \u00b7 ${seed ? "your view \u00b7 " : ""}turn ${turns.length + 1}`, question: reply.question, bullets };
  startRound("oracle", 1, null);
}

/* ---- talking ------------------------------------------------------------
   On-device speech (his ruling 3A). What he says lands in the box after what
   he typed; the round is marked spoken and keeps to the `spoken` register. */
async function toggleMic() {
  if (state.listening) { await stopMic(); return; }
  if (!["armed", "running"].includes(state.phase) || state.mode === "copy") return;
  const r = await store.micStart().catch((e) => ({ ok: false, note: String(e) }));
  if (!r || !r.ok) { els.hint.textContent = (r && r.note) || "The microphone would not start."; return; }
  const v = els.box.value;
  state.micBase = v && !/\s$/.test(v) ? v + " " : v;
  state.micHeard = ""; state.micSkip = 0;
  state.listening = true;
  els.mic.classList.add("is-on");
  els.mic.textContent = "Stop talking";
  if (state.phase === "armed") start();
  els.hint.textContent = "Listening, on this Mac only. Talk; the words land in the box.";
}
async function stopMic() {
  if (!state.listening) return;
  state.listening = false;
  els.mic.classList.remove("is-on");
  els.mic.textContent = "Talk";
  await store.micStop().catch(() => {});
}
window.ClickClack = {
  speech({ text, final } = {}) {
    if (!state.listening || typeof text !== "string") return;
    // A partial repeats the whole utterance so far; the words he typed after
    // are already in micBase, so only the words past them are added.
    const fresh = text.split(/\s+/).filter(Boolean).slice(state.micSkip).join(" ");
    const base = state.micBase;
    els.box.value = base + (fresh && base && !/\s$/.test(base) ? " " : "") + fresh;
    state.micHeard = text;
    state.spoken = true;
    if (final) { state.micBase = els.box.value + " "; state.micHeard = ""; state.micSkip = 0; }
  },
  // The Mac stopped listening on its own (a final result, an error, or its
  // time limit): the button goes back to Talk and the words heard stay (AUDIT S14).
  speechEnded() {
    if (!state.listening) return;
    state.listening = false;
    els.mic.classList.remove("is-on");
    els.mic.textContent = "Talk";
    els.hint.textContent = "The microphone stopped. Press Talk to go on talking, or type.";
  },
};
/* Typing while talking: what he typed stays, so the words heard so far are
   fixed into micBase and the next partial adds only its new words (AUDIT A12). */
function typedWhileTalking() {
  state.micBase = els.box.value;
  state.micSkip = state.micHeard.split(/\s+/).filter(Boolean).length;
}

/* ---- the expert on the website --------------------------------------------
   His ruling 2A: kept answers become PROPOSED records he commits or rejects
   in the admin page. oracle.js drafts and checks; the shell posts. */
async function renderExpert() {
  const st = await store.expertStatus().catch(() => ({ connected: false, queued: 0 }));
  els.expertStatus.textContent = `${st.note || ""} ${st.queued ? `${st.queued} kept answer${st.queued === 1 ? "" : "s"} waiting to go.` : "Nothing waiting."}`.trim();
  els.expertSend.disabled = !st.connected || !st.queued;
  els.send.hidden = !st.connected;
  return st;
}
async function connectExpert() {
  const t = els.expertToken.value.trim();
  if (!t) return;
  await store.expertToken(t);
  els.expertToken.value = "";
  await renderExpert();
}
/* Draft records from kept answers and propose them. `progress` is told which
   answer is being read; the baton pass runs this in the background with none. */
async function draftAndPropose(items, progress = () => {}) {
  let read = 0, staged = 0;
  const dropped = [], sent = [];
  const todo = items.filter((e) => e && e.at && !inFlight.has(e.at));
  todo.forEach((e) => inFlight.add(e.at));
  try {
    for (const entry of todo) {
      progress(read, todo.length);
      const r = await store.askClaude({ system: DRAFT_SYSTEM, prompt: draftPrompt(entry), schema: DRAFT_SCHEMA, webSearch: false })
        .catch((e) => ({ ok: false, note: String(e) }));
      if (!r || !r.ok) { dropped.push(r && r.note ? r.note : "no draft"); break; }
      read += 1;
      let allOk = true;
      for (const d of (r.output && r.output.records) || []) {
        const p = toProposal(d, entry);
        if (p.error) { dropped.push(p.error); continue; }
        const res = await store.expertPropose(p.record).catch((e) => ({ ok: false, note: String(e) }));
        if (res && res.ok) staged += 1;
        else { allOk = false; dropped.push((res && res.note) || "refused"); if (res && (res.status === 401 || res.status === 403)) break; }
      }
      if (allOk) sent.push(entry.at);
    }
    if (sent.length) await store.expertSent(sent);
  } finally {
    todo.forEach((e) => inFlight.delete(e.at));
  }
  return { read, staged, dropped, sent };
}
function expertReport({ read, staged, dropped }) {
  return `${read} answer${read === 1 ? "" : "s"} read, ${staged} proposal${staged === 1 ? "" : "s"} staged.`
    + (staged ? " Commit or reject them in the admin page, Knowledge tab." : "")
    + (dropped.length ? ` Held back: ${[...new Set(dropped)].join("; ")}.` : "");
}
async function sendToExpert() {
  if (state.busy) return;
  const st = await renderExpert();
  if (!st.connected) { els.expertLog.textContent = st.note || "Not connected."; return; }
  const { items = [] } = await store.expertQueue();
  // try/finally: a refused expertSent must not leave the oracle, baton and
  // Send dead until relaunch (AUDIT S5).
  let out;
  try { out = await draftAndPropose(items, (i, n) => busy(`Drafting from answer ${i + 1} of ${n}...`)); }
  finally { busy(""); }
  els.expertLog.textContent = expertReport(out);
  els.keepnote.textContent = els.expertLog.textContent;
  await renderExpert();
}

/* ---- the baton pass -------------------------------------------------------
   His ask: hand what he has to the expert, which ingests it in the background
   and answers him, agreeing, fleshing out, or gently pushing back with the
   research and what the expert holds. Its answer is his next passage to copy;
   then he responds again in his own words. */
async function batonPass() {
  if (state.busy || state.phase !== "done" || state.mode !== "respond" || !state.passage) return;
  const answer = els.box.value.trim();
  if (!answer) return;
  // Busy first, so a second B while the Keep is on its way does nothing.
  const reading = "The expert is reading your answer and the research. This usually takes under a minute.";
  busy(reading);
  // 1. Keep it, so it is in the voice corpus and the expert queue.
  if (!state.kept) await keep();
  // 2. The ingestion runs on its own; the reply below does not wait for it.
  if (state.kept) ingestInBackground(state.record.at);
  // 3. The expert reads, and answers with the next passage.
  busy(reading);
  const st = await store.expertStatus().catch(() => ({ connected: false }));
  const listed = st.connected ? await store.expertRecords().catch(() => ({ ok: false })) : { ok: false };
  const records = listed.ok ? relevantRecords(listed.records, `${state.passage.text} ${answer}`) : [];
  const target = batonWords(data.history, state.minutes);
  const turn = state.baton + 1;
  const r = await store.askClaude({
    system: BATON_SYSTEM, schema: BATON_SCHEMA, webSearch: true,
    prompt: batonPrompt({ passage: state.passage, question: state.item.question, answer, records, words: target, weak: state.weak || [], turn }),
  }).catch((e) => ({ ok: false, note: String(e) }));
  const reply = r && r.ok ? readBaton(r.output, target) : null;
  busy("");
  if (!reply) {
    els.keepnote.textContent = (r && r.note) || "The expert's reply could not be read. Your answer is kept.";
    return;
  }
  // A reply that quotes him would become a copy passage and could be shelved
  // to disk, so it is not used (AUDIT A10).
  if (batonQuotes(reply, answer)) {
    store.log(`baton ${turn}: dropped, the reply quoted the answer`);
    els.keepnote.textContent = "The expert's reply quoted your answer, so it was not used. Your answer is kept. Press B to ask again.";
    return;
  }
  state.baton = turn;
  store.log(`baton ${turn}: ${reply.text.split(/\s+/).length} words, ${records.length} records, ${reply.sources.length} sources`);
  armCopy({
    id: `baton-${turn}`, kind: "baton", outline: state.passage.outline, title: reply.title, text: reply.text,
    respond: reply.respond, sources: reply.sources,
    source: `The expert, ${reply.stance}${records.length ? `, with ${records.length} of its records` : ""}`,
  });
}
async function ingestInBackground(at) {
  const st = await store.expertStatus().catch(() => ({ connected: false }));
  if (!st.connected) return;
  const { items = [] } = await store.expertQueue().catch(() => ({ items: [] }));
  const mine = items.filter((e) => e.at === at);
  if (!mine.length) return;
  // Nobody awaits this, so a refusal is caught here and named in the log
  // instead of becoming an unhandled rejection (AUDIT S7).
  try {
    const out = await draftAndPropose(mine);
    els.expertLog.textContent = `Baton pass: ${expertReport(out)}`;
  } catch (e) {
    console.warn("expert: baton ingest failed", e);
    els.expertLog.textContent = "Baton pass: the answer could not reach the expert just now. It stays in the queue, and Send tries again.";
  }
  renderExpert();
}

/* Keep going: the same question, the same box, a fresh clock. His ruling:
   "maybe I had more to say on it and stopped only because time was out." */
function continueRound() {
  if (!state.score || copyLike()) return;
  // Held first: an Esc in the new round must not lose this finished one (AUDIT A3).
  holdIfUnkept();
  startRound(state.mode, state.mode === "respond" ? 1 : state.roundMinutes, els.box.value);
}

function startRound(mode, minutes, carry) {
  if (typeof carry !== "string") holdIfUnkept();
  closeGames(els.results);
  state.mode = mode;
  state.roundMinutes = minutes;
  state.events = []; state.score = null; state.flagged = []; state.combo = 0; state.bestCombo = 0;
  state.backspaceInWord = false; state.record = null; state.kept = false;
  state.pendingDelete = null; state.bsRun = 0; state.coached = false;
  const continuing = typeof carry === "string";
  if (!continuing) state.spoken = false;
  if (state.listening) stopMic();
  state.listening = false; els.mic.classList.remove("is-on"); els.mic.textContent = "Talk";
  els.mic.hidden = mode === "copy" || mode === "tame";
  if (!continuing) { state.cont = 0; state.answerAt = null; state.keptUpTo = 0; }
  else state.cont += 1;
  shiftKeys.clear(); shiftFx.clear();
  root.dataset.drillMode = mode;
  const ol = itemById(state.item.outline);
  els.category.textContent = mode === "tame"
    ? `nemesis drill \u00b7 ${state.passage.target.name} \u00b7 ${TAME_SECONDS} seconds, practice only`
    : mode === "copy"
    ? `copy · ${state.item.tag} · BACB ${state.item.outline}${describeProfile(state.tricky) ? ` · works ${describeProfile(state.tricky)}` : ""}`
    : `${state.item.tag} · BACB ${state.item.outline}${state.cont ? ` · keep going ${state.cont}` : ""}`;
  els.category.title = ol ? ol.text : "";
  els.q.textContent = state.item.question;
  els.bullets.replaceChildren(...state.item.bullets.map((b) => {
    const n = li(b.text);
    const src = document.createElement("span"); src.className = "src"; src.textContent = b.source;
    n.appendChild(src);
    return n;
  }));
  if (mode === "copy" || mode === "tame") {
    els.bullets.replaceChildren(
      ...(mode === "tame" ? [Object.assign(li(state.passage.lesson), { className: "tame-lesson" })] : []),
      Object.assign(li(state.passage.source), { className: "passage-src" }));
    renderPassage(els.passage, state.passage.text, state.weak || []);
    els.passage.scrollTop = 0;
    markPassage(els.passage, "", state.passage.text);
  }
  els.passage.hidden = mode !== "copy" && mode !== "tame";
  els.ref.hidden = mode !== "respond";
  if (mode === "respond") { els.refText.textContent = state.passage.text; els.ref.open = false; }
  els.box.value = continuing ? carry : "";
  state.prefix = els.box.value.length;
  els.box.disabled = false;
  els.box.placeholder = mode === "tame"
    ? "Type the words above, exactly. Clean first, then fast."
    : mode === "copy"
    ? "Type the passage above, exactly. No need to read ahead: it comes back to read properly when the round ends."
    : "Start typing. The clock starts on your first key.";
  els.live.textContent = ""; els.combo.hidden = true; els.wpm.textContent = "0";
  els.hint.textContent = mode === "tame" ? "Thirty seconds, offered not forced: esc leaves without scoring." : mode === "copy" ? "Copy it cold, word for word. You get to read it properly afterwards, before you answer." : "The clock starts on your first keystroke. esc leaves without scoring.";
  els.clock.textContent = clockText(secondsFor());
  els.raceYou.style.left = "0%"; els.raceGhost.style.left = "0%"; els.raceNote.textContent = "";
  els.results.hidden = true; els.setup.hidden = true; els.read.hidden = true; els.question.hidden = false;
  delete root.dataset.drillView;
  heat = createHeat(usualAndBest());
  garden.reset();
  if (continuing) garden.update({ words: state.prefix / 5, heat: 0 });
  setPhase("armed");
  els.box.focus({ preventScroll: true });
  // The one scroll a screen may need: the typing box, when a short window hides it.
  if (els.box.getBoundingClientRect().bottom > window.innerHeight) els.box.scrollIntoView({ block: "nearest" });
  els.box.setSelectionRange(els.box.value.length, els.box.value.length);
}

/* ---- the keystroke log ---------------------------------------------------- */
function onKeydown(e) {
  if (e.key === "Escape") { e.preventDefault(); home(); return; }
  if (state.phase === "done") { e.preventDefault(); return; }
  // Option+Backspace (a word) and Command+Backspace (the line): a change of
  // mind. The box does the delete; onInput logs how much it took.
  if (e.key === "Backspace" && (e.altKey || e.metaKey) && state.phase === "running") {
    state.pendingDelete = { t: performance.now() - state.t0, len: els.box.value.length, via: e.metaKey ? "line" : "word" };
    state.bsRun = 0;
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) { if (e.key.toLowerCase() === "v") e.preventDefault(); return; }
  let kind = null, key;
  if (e.key === "Backspace") kind = "backspace";
  else if (e.key === "Enter") kind = "enter";
  else if (e.key.length === 1) { kind = "char"; key = e.key; }
  if (!kind) return; // arrows, Shift alone, Tab: not typing
  if (state.phase === "armed") start();
  const t = performance.now() - state.t0;
  const ev = kind === "char" ? { t, kind, key } : { t, kind };
  if (kind === "char" && e.shiftKey && shiftCheck(e, ev) === "refused") {
    // Strict Shift: nothing lands. Logged apart, never a typing error.
    e.preventDefault();
    state.events.push({ t, kind: "refused", key, shift: ev.shift, hand: ev.hand });
    return;
  }
  state.events.push(ev);
  if (kind === "backspace") { state.backspaceInWord = true; state.bsRun += 1; }
  else { coachDelete(); heat.press(t, kind === "enter" ? "\n" : key); }
  // Read the closing word NOW, at keydown, before the boundary key lands: a
  // deferred read races a fast typist, who is already into the next word.
  if (kind === "enter" || (kind === "char" && /[\s.,;:!?)]/.test(key))) boundary(els.box.value.slice(0, els.box.selectionStart));
}

/* His ruling: "at the space boundary if a word was not corrected or known it is
   an error (or potential error)". The word that just closed is checked; an
   unknown one is named under the box. A clean known word feeds the combo. */
function boundary(textBeforeCaret) {
  const before = textBeforeCaret.replace(/[\s.,;:!?)]+$/, "");
  const m = before.match(/([A-Za-z][A-Za-z'\u2019-]*)$/);
  if (!m) return;
  const tok = m[1];
  const w = tok.toLowerCase().replace(/\u2019/g, "'").replace(/^'+|-+$/g, "");
  const dict = knownNow();
  // A copy round marks its own words against the passage; the lexicon is for his words.
  const unknown = !copyLike() && dict && !/^[A-Z]/.test(tok) && w && !isKnown(w, dict);
  if (unknown && !state.flagged.includes(w)) {
    state.flagged.push(w);
    els.live.textContent = "Unknown so far: " + state.flagged.join(", ");
  }
  if (!unknown && !state.backspaceInWord) {
    state.combo += 1;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
  } else state.combo = 0;
  state.backspaceInWord = false;
  els.combo.hidden = state.combo < 5;
  els.combo.textContent = `${state.combo} clean`;
  if (state.combo && state.combo % 10 === 0) { els.combo.classList.remove("pop"); void els.combo.offsetWidth; els.combo.classList.add("pop"); }
}
/* Shift side: which Shift is down, which hand owns the key. Strict Shift
   (his ask of 2026-09-23, default on) refuses a same-side capital, so the
   wrong-finger combo never pays off and goes on extinction. Caps Lock
   capitals are never judged. Returns the verdict: "ok", "same", "refused". */
const strictShift = () => data.settings.strictShift !== false;
function shiftCheck(e, ev) {
  if (e.getModifierState && e.getModifierState("CapsLock")) return null;
  // Capitals only: ? ! @ : and the other shifted symbols are never judged or refused.
  if (!/^[A-Za-z]$/.test(e.key || "")) return null;
  const side = shiftKeys.side(e);
  const hand = handOf(e.code);
  if (!side || !hand) return null;
  // Only the first capital of a Shift press is judged: "EHR" on one held Shift is right.
  if (!shiftKeys.firstInHold()) return null;
  ev.shift = side; ev.hand = hand;
  const j = judge(side, hand);
  if (j === "same" && strictShift()) {
    // Judge the retry too: holding the same Shift and pressing again must not slip through.
    shiftKeys.rejudge();
    shiftFx.refuse(hand, e.key);
    return "refused";
  }
  if (j === "same") shiftFx.same(hand, e.key);
  else if (j === "ok") shiftFx.ok(side);
  return j;
}
function onShiftKey(e) {
  shiftKeys.key(e);
  if (e.key !== "Shift") return;
  if (e.type === "keyup") { shiftFx.uncue(); return; }
  if (!e.repeat) shiftCue(e);
}
/* In a copy round the next letter is known, so the warning comes before the
   key: his ask of 2026-09-24. A Shift on the letter's own side lights that
   side red and the other side green, the moment Shift goes down. */
function nextCopyChar() {
  if (!copyLike() || !state.passage) return "";
  const ref = state.passage.text.split(/\s+/).filter(Boolean);
  const typed = els.box.value.slice(0, els.box.selectionStart ?? els.box.value.length);
  const words = typed.split(/\s+/);
  const i = words.length - 1;
  const partial = words[i] || "";
  return (ref[i] || "")[partial.length] || "";
}
function shiftCue(e) {
  if (!strictShift() || !["armed", "running"].includes(state.phase)) return;
  if (e.getModifierState && e.getModifierState("CapsLock")) return;
  const ch = nextCopyChar();
  if (!/^[A-Z]$/.test(ch)) return;
  const hand = handOf("Key" + ch);
  const side = e.code === "ShiftLeft" ? "L" : e.code === "ShiftRight" ? "R" : null;
  if (hand && side && side === hand) shiftFx.cue(side);
}

/* A word backspaced letter by letter, back to a space: once a drill, say so. */
function coachDelete() {
  const run = state.bsRun;
  state.bsRun = 0;
  if (state.coached || run < 3) return;
  const before = els.box.value.slice(0, els.box.selectionStart);
  if (before && !/\s$/.test(before)) return;
  state.coached = true;
  els.hint.textContent = "Changing a word? Option+Backspace takes the whole word in one stroke.";
}

/* After an Option or Command delete, log one backspace per character it took. */
function onInput() {
  if (state.listening) typedWhileTalking();
  if (copyLike() && state.passage) {
    markPassage(els.passage, els.box.value, state.passage.text);
    const typed = els.box.value.trim().split(/\s+/);
    const ref = state.passage.text.split(/\s+/);
    if (state.phase === "running" && typed.length >= ref.length && typed[typed.length - 1] === ref[ref.length - 1]) finish();
  }
  const p = state.pendingDelete;
  if (!p) return;
  state.pendingDelete = null;
  const n = p.len - els.box.value.length;
  for (let i = 0; i < n; i++) state.events.push({ t: p.t, kind: "backspace", via: p.via });
  state.backspaceInWord = false;
}

function onPaste(e) { e.preventDefault(); els.hint.textContent = "Paste is off: this is a typing drill."; }

/* ---- the clock ------------------------------------------------------------- */
function start() {
  state.t0 = performance.now();
  state.deadline = state.t0 + secondsFor() * 1000;
  setPhase("running");
  els.hint.textContent = copyLike() ? "Go. Word for word; finish the passage and the round ends early." : "Go. Backspace and return count; paste does not.";
  tick();
}
function tick() {
  const now = performance.now();
  const left = (state.deadline - now) / 1000;
  els.clock.textContent = clockText(Math.max(0, Math.ceil(left)));
  const t = now - state.t0;
  const { wpm, heat: h } = heat.read(t);
  els.wpm.textContent = String(Math.round(wpm));
  const placed = state.events.reduce((n, e) => n + (e.kind === "backspace" ? -1 : 1), 0);
  garden.update({ words: (state.prefix + Math.max(0, placed)) / 5, heat: h });
  // The race: you against your best pace at this clock.
  const { best } = usualAndBest();
  const total = secondsFor();
  const elapsed = Math.min(total, t / 1000);
  const target = best * 5 * (total / 60);
  const ghost = best * 5 * (elapsed / 60);
  els.raceGhost.style.left = `${Math.min(100, (ghost / target) * 100).toFixed(1)}%`;
  els.raceYou.style.left = `${Math.min(100, (Math.max(0, placed) / target) * 100).toFixed(1)}%`;
  const diff = Math.round((Math.max(0, placed) - ghost) / 5);
  els.raceNote.textContent = elapsed > 3 ? (diff >= 0 ? `${diff} words ahead of your best` : `${-diff} behind your best`) : "";
  if (left <= 0) { finish(); return; }
  state.timer = setTimeout(tick, 100);
}

async function finish() {
  if (state.listening) await stopMic();
  clearTimeout(state.timer);
  setPhase("done");
  settle();
  els.box.disabled = true;
  els.clock.textContent = "0:00";
  els.hint.textContent = "Time.";
  // A copy round that reaches the end of the passage stops early: score the time it took.
  const elapsed = Math.min(secondsFor(), (performance.now() - state.t0) / 1000);
  const scoredMinutes = copyLike() ? Math.max(elapsed, 5) / 60 : minutesFor();
  await wordsLoaded;
  knownCache = null;
  const prior = data.history.slice();
  state.score = scoreRound(scoredMinutes);
  const s = state.score;
  state.scoredMinutes = scoredMinutes;
  if (state.mode === "tame") { finishTame(s); return; }
  state.record = {
    at: new Date().toISOString(), itemId: state.item.id, outline: state.mode === "copy" ? null : state.item.outline, minutes: state.roundMinutes,
    mode: state.mode, ...(state.passage && state.mode !== "answer" ? { passage: state.passage.id } : {}),
    ...(state.mode === "copy" && state.passage.variant ? { variant: state.passage.variant } : {}), ...(state.mode === "copy" && state.passage.fromShelf ? { fromShelf: true } : {}), ...(state.cont ? { cont: state.cont } : {}),
    ...(state.mode === "answer" && state.item.review ? { review: true, lens: state.item.lens } : {}),
    ...(state.mode === "oracle" && state.oracle && state.oracle.seed ? { seed: state.oracle.seed } : {}),
    seconds: secondsFor(), gwam: s.gwam, nwam: s.nwam, accuracy: s.accuracy, rating: s.rating.name,
    corrections: s.corrections, uncorrected: s.uncorrected, words: s.grossWords, bestCombo: state.bestCombo,
    keys: s.keys, kept: false, revisions: s.revisions, revisedKeys: s.revisedKeys, keptWords: s.kept.words,
    habits: { wordByHand: s.habits.wordByHand, wordDeletes: s.habits.wordDeletes, lineDeletes: s.habits.lineDeletes },
    shift: s.shift,
    ...(s.refused.count || strictShift() ? { refused: s.refused.count, refusedKeys: s.refused.keys.map((k) => k.key) } : {}),
    think: { ms: s.think.ms, count: s.think.count, sentence: s.think.sentence, clause: s.think.clause, word: s.think.word, mid: s.think.mid, flowWpm: s.think.flowWpm },
    lexicon: data.lexicon.length,
    // Names of what was slow and which tips fired: what the copy picker aims at next.
    slowPairs: s.timing.slowPairs.map((p) => p.pair), tips: s.tips.map((t) => t.id),
    // Letter for letter, "meant>hit": what the nemesis engine reads. Letters only, never text.
    confusions: s.tricky.confusions.filter((c) => /^[a-z]$/.test(c.meant) && /^[a-z]$/.test(c.hit)).map((c) => `${c.meant}>${c.hit}`),
  };
  // The last passage on the shelf copied again: the shelf is empty after this round.
  if (state.mode === "copy" && state.passage.fromShelf && !unshelve(shelf(), state.passage.id).length) state.record.shelfEmpty = true;
  const st = stars(s, prior.filter((h) => kindOf(h) === roundKind()), state.roundMinutes);
  state.levelPrior = prior.filter((h) => kindOf(h) === roundKind());
  const before = trophyCase(prior, tameLog());
  if (!state.answerAt) state.answerAt = state.record.at;
  // A talked round has no keystrokes but it is still a round, and it can be kept.
  const spokenWords = state.spoken ? roundText().trim().split(/\s+/).filter(Boolean).length : 0;
  if (state.spoken) Object.assign(state.record, { spoken: true, spokenWords });
  const counts = s.gwam > 0 || spokenWords > 0;
  if (counts) {
    data.history.push(state.record);
    persist("saveHistory", data.history);
    // Copied again from the shelf: it is off the shelf now. Shelve it again to put it back.
    if (state.mode === "copy" && state.passage.fromShelf) saveShelf(unshelve(shelf(), state.passage.id));
  }
  const after = counts ? trophies() : before;
  state.unlocked = newlyUnlocked(before, after);
  state.spotted = newlySpotted(before, after);
  store.log(`drill ${state.mode} ${state.item.id} ${state.roundMinutes}m nwam ${s.nwam} acc ${s.accuracy}`);
  render(s, st, prior);
}

/* The nemesis drill ends here: its numbers go to settings.tame, never to
   history, so a word list never moves his bests, bands or nemeses. */
function finishTame(s) {
  const t = state.passage.target;
  const log = tameLog();
  const st = stars(s, log, TAME_SECONDS / 60);
  const before = trophies();
  state.record = null; state.levelPrior = []; state.spotted = [];
  if (s.gwam > 0) {
    data.settings = { ...data.settings, tame: appendTame(log, tameEntry(t, s, new Date().toISOString(), TAME_SECONDS / 60)) };
    persist("saveSettings", data.settings);
  }
  state.unlocked = newlyUnlocked(before, trophies());
  store.log(`drill tame ${t.id} nwam ${s.nwam} acc ${s.accuracy}`);
  render(s, st, log);
}

/* ---- the nemesis drill: offered, never forced ------------------------------- */
function currentTame() {
  return tameTarget(data.history, trickyProfile(data.history, keyboardRates(data.history, 20)).keys);
}
function armTame(target = currentTame()) {
  const passage = target && tameDrill(target, PASSAGES.map((p) => p.text));
  if (!passage) return;
  state.passage = passage;
  state.baton = 0;
  state.weak = target.kind === "pair" ? [...target.key] : [target.letter];
  state.item = { id: passage.id, outline: null, tag: "nemesis drill", question: passage.title, bullets: [] };
  startRound("tame", TAME_SECONDS / 60, null);
}
/* Home: one line naming the nemesis, and the button. Results: the button. */
function renderTameOffer() {
  const t = currentTame();
  els.tameHome.hidden = !t;
  els.tame.hidden = !t;
  if (!t) { els.tameHome.replaceChildren(); return; }
  const go = Object.assign(document.createElement("button"), { type: "button", className: "soft tame-go", textContent: `Drill it \u00b7 ${TAME_SECONDS}s ` });
  go.dataset.drillTameGo = t.id;
  go.append(Object.assign(document.createElement("kbd"), { textContent: "D" }));
  go.addEventListener("click", () => armTame(t));
  els.tameHome.replaceChildren(
    Object.assign(document.createElement("b"), { textContent: "Nemesis" }),
    Object.assign(document.createElement("span"), { textContent: `${t.name}: thirty seconds on it, if you like.` }), go);
  els.tame.replaceChildren(`Drill ${t.kind === "pair" ? t.key.toUpperCase() : t.letter.toUpperCase()} \u00b7 ${TAME_SECONDS}s `,
    Object.assign(document.createElement("kbd"), { textContent: "D" }));
  els.tame.title = `A ${TAME_SECONDS}-second drill on ${t.name}. Practice only: it stays out of your bests and bands.`;
}

/* The round's own text: a Keep going round scores only what it added. */
const roundText = () => els.box.value.slice(Math.min(state.prefix, els.box.value.length));
function scoreRound(minutes) {
  return scoreDrill({
    events: state.events, text: roundText(), minutes, lexicon: knownNow(),
    reference: copyLike() ? state.passage.text : undefined,
  });
}

/* ---- results ------------------------------------------------------------- */
function render(s, st, prior) {
  els.results.dataset.mode = "drill";
  els.nwam.textContent = s.nwam.toFixed(1);
  els.gwam.textContent = s.gwam.toFixed(1);
  els.errors.textContent = String(s.corrections + (s.uncorrected || 0));
  els.accuracy.textContent = Math.round(s.accuracy * 100) + "%";
  // A word list is not a band: the drill names itself instead.
  els.rating.textContent = state.mode === "tame" ? "Nemesis drill" : s.rating.name;
  els.ratingNote.textContent = state.mode === "tame" ? "(practice only: no band)" : s.rating.accuracyGated ? "(one band down: accuracy under 96%)" : s.gwam < 1 ? "(nothing typed)" : "";
  renderLevelUp(s);
  els.next.textContent = s.gwam < 1 ? "" : state.mode === "tame" ? tameReport(state.passage.target, s).line : ladderText(s.nwam, prior.filter((h) => kindOf(h) === roundKind()), state.roundMinutes);
  els.stars.replaceChildren(
    star(st.best, "Personal best"), star(st.beatLast, "Beat your last"), star(st.clean, "97% clean"),
    ...(state.bestCombo >= 15 ? [star(true, `${state.bestCombo} clean in a row`)] : []),
  );
  els.basis.textContent = s.netBasis === "reference"
    ? `${state.mode === "tame" ? "A nemesis drill" : "A copy round"}: NWAM subtracts the ${s.uncorrected} word${s.uncorrected === 1 ? "" : "s"} that did not match the passage (capitals and punctuation count), over ${Math.round(state.scoredMinutes * 60)} seconds.`
    : s.netBasis === "corrections"
    ? `NWAM counts your ${s.corrections} corrections as the errors, because the word list has not loaded; uncorrected typos are not scored.`
    : `NWAM subtracts ${s.uncorrected} unknown word${s.uncorrected === 1 ? "" : "s"}; your ${s.corrections} correction${s.corrections === 1 ? "" : "s"} cost you time, not words. Mark a term clinical below and it comes out of the count.`
      + (s.revisions ? ` ${revisionText(s)}` : "");
  const pb = bests(prior.filter((h) => kindOf(h) === roundKind()))[String(state.roundMinutes)];
  els.pace.replaceChildren(lineChart([{ values: s.pace, dots: false }], { guide: pb ?? null, guideLabel: pb != null ? `best ${pb.toFixed(0)}` : "", height: 120, min: 0 }));
  els.tricky.replaceChildren(...(s.tricky.keys.length ? s.tricky.keys.map((k) => li(`${keyName(k.key)} hit by mistake ${k.count}×`)) : [li("Nothing corrected. Clean hands.")]));
  for (const c of s.tricky.confusions) els.tricky.appendChild(li(`hit ${keyName(c.hit)} for ${keyName(c.meant)}, ${c.count}×`));
  const tm = [];
  if (s.timing.intervals) tm.push(`${s.timing.medianMs} ms between keys, cadence ±${Math.round(s.timing.cv * 100)}%`);
  if (s.timing.afterShiftMs) tm.push(`${s.timing.afterShiftMs} ms after shift`);
  if (s.timing.punctuationMs) tm.push(`${s.timing.punctuationMs} ms on punctuation`);
  if (s.timing.pauses) tm.push(`${s.timing.pauses} pause${s.timing.pauses === 1 ? "" : "s"} over two seconds`);
  if (s.shift.ok + s.shift.same) tm.push(`${s.shift.ok} of ${s.shift.ok + s.shift.same} capitals with the opposite Shift`);
  const refusedLine = refusedText(s.refused, refusedWeeks(data.history), strictShift());
  if (refusedLine) tm.push(refusedLine);
  if (s.revisions) tm.push(copyLike()
    ? `${s.revisions} revision${s.revisions === 1 ? "" : "s"} with Option or Command+Backspace`
    : `${s.revisions} revision${s.revisions === 1 ? "" : "s"} (a changed mind, never an error), ${s.kept.words} word${s.kept.words === 1 ? "" : "s"} kept`);
  const slowNodes = s.timing.slowPairs.map((p) => { const n = li(`${p.pair} runs slow: ${p.ms} ms `); n.append(pairButton(p.pair, p.ms)); return n; });
  els.timing.replaceChildren(...(tm.length || slowNodes.length ? [...tm.map(li), ...slowNodes] : [li("Not enough keys to read a rhythm.")]));
  // A Shift that went wrong (same side, or refused) offers the Shifty Shifts game.
  if ((s.shift && s.shift.same) || (s.refused && s.refused.count)) {
    const n = li("Shifts went wrong this round. ");
    n.dataset.shiftyOffer = "";
    n.append(shiftyButton());
    els.timing.appendChild(n);
  }
  els.tips.replaceChildren(...(s.tips.length ? s.tips.map((t) => {
    const n = document.createElement("li");
    const b = document.createElement("b"); b.textContent = t.tip;
    const w = document.createElement("span"); w.textContent = "because " + t.why;
    n.append(b, w);
    if (t.id === "cadence") { n.append(riverButton()); for (const p of s.timing.slowestPairs || []) n.append(pairButton(p.pair, p.ms)); }
    if (t.id === "shift" || t.id === "shiftSide") n.append(shiftyButton());
    return n;
  }) : [li("Nothing fired. Same form, faster, next time.")]));
  els.think.textContent = thinkText(s);
  renderUnlocked(state.unlocked || [], state.spotted || []);
  renderReview(s);
  renderBoard();
  const copying = copyLike();
  const hasWords = s.gwam > 0 || (state.spoken && roundText().trim().length > 0);
  if (state.spoken) els.basis.textContent = `You talked ${state.record && state.record.spokenWords ? state.record.spokenWords + " words of " : ""}this one. Talking has no typing score; what you typed around it is scored as usual.`;
  els.keep.hidden = copying;
  els.keep.disabled = !hasWords;
  els.keep.textContent = "Keep it"; els.keep.appendChild(Object.assign(document.createElement("kbd"), { textContent: "K" }));
  els.keepnote.textContent = state.mode === "tame"
    ? "A nemesis drill is practice only: its numbers stay out of your bests, your bands and the nemesis count. The nemesis is tamed in real rounds."
    : copying
    ? "Copy rounds are never kept: the words are the passage's, not yours. Respond is next, one minute."
    : store.inApp
      ? `Keep sends ${state.cont ? "this answer, every round of it," : "this answer"} to your voice corpus (${state.spoken ? "spoken" : "drill"} register) and the expert queue.`
      : "This browser page keeps numbers only; the Mac app keeps text.";
  els.cont.hidden = copying;
  els.baton.hidden = state.mode !== "respond";
  els.baton.disabled = !hasWords;
  els.cont.disabled = !hasWords && !state.prefix;
  renderTameOffer();
  els.again.replaceChildren(state.mode === "tame" ? `Again \u00b7 ${TAME_SECONDS}s` : copying ? "Respond · 1 min" : state.mode === "oracle" ? "Follow-up" : "Again", Object.assign(document.createElement("kbd"), { textContent: "return" }));
  showTab("drill");
  els.question.hidden = true;
  els.results.hidden = false;
  renderChips();
  els.again.focus({ preventScroll: true });
  if (state.mode === "copy") showRead();
}
/* ---- read and consider, and the shelf --------------------------------------
   His ask: the copy round is typed cold, then the passage comes back here to
   read, with its question. Respond (Return) or shelve it (S); a shelved one
   comes back later in new words (shelf.js, variants.js). */
const shelf = () => (Array.isArray(data.settings.shelf) ? data.settings.shelf : []);
const shelfNow = () => ({ round: copyRounds(data.history), today: dayOf(new Date().toISOString()) });
function saveShelf(next) {
  data.settings = { ...data.settings, shelf: next };
  persist("saveSettings", data.settings);
  renderShelf();
}
function renderDueReviews() {
  const line = describeReviews(data.history, Date.now(), inBank);
  els.dueReviews.hidden = !line;
  els.dueReviews.replaceChildren(...(line ? [
    Object.assign(document.createElement("b"), { textContent: "Review" }),
    Object.assign(document.createElement("span"), { textContent: line }),
  ] : []));
}
function renderShelf() {
  renderDueReviews();
  const rows = describeShelf(shelf(), shelfNow());
  els.shelf.hidden = !rows.length;
  els.shelf.replaceChildren(...(rows.length ? [
    Object.assign(document.createElement("b"), { textContent: `On the shelf (${rows.length})` }),
    ...rows.map((r) => Object.assign(document.createElement("span"), { className: r.due ? "is-due" : "", textContent: `${r.title}, ${r.when}` })),
  ] : []));
  els.mapShelf.replaceChildren(...(rows.length ? rows.map((r) => li(`${r.title}: ${r.when}`)) : [li("Nothing shelved. Shelve a passage after copying it and it comes back later in new words.")]));
}
function showRead() {
  renderRead(els.readParts, state.passage, state.score);
  const won = [...(state.unlocked || []), ...(state.spotted || [])];
  els.readUnlocked.hidden = !won.length;
  els.readUnlocked.replaceChildren(...els.unlocked.cloneNode(true).childNodes);
  // A copy round that opened a band says so here too: this screen comes first.
  els.readLevelUp.hidden = els.levelUp.hidden;
  els.readLevelUp.replaceChildren(...els.levelUp.cloneNode(true).childNodes);
  els.readNote.textContent = state.passage.fromShelf ? "Back from the shelf, in new words. Shelve it again if it still is not the day for it." : "";
  els.results.hidden = true;
  els.read.hidden = false;
  els.read.classList.remove("is-in"); void els.read.offsetWidth; els.read.classList.add("is-in");
  root.dataset.drillView = "read";
  window.scrollTo({ top: 0 });
  els.respond.focus({ preventScroll: true });
}
/* The numbers of the copy round, and back again. */
function toggleNumbers() {
  if (state.phase !== "done" || state.mode !== "copy") return;
  if (els.read.hidden) { showRead(); return; }
  els.read.hidden = true;
  els.results.hidden = false;
  delete root.dataset.drillView;
  els.again.focus({ preventScroll: true });
}
function shelveIt() {
  if (state.phase !== "done" || state.mode !== "copy" || !state.passage) return;
  const p = state.passage;
  saveShelf(shelve(shelf(), p, { at: new Date().toISOString(), round: copyRounds(data.history) }));
  store.log(`shelved ${p.id}${p.variant ? ` variant ${p.variant}` : ""}`);
  state.baton = 0;
  arm();
}

/* A band his numbers have never reached before, first time: the crest. A
   round with nothing typed never opens one. */
function renderLevelUp(s) {
  const up = s.gwam >= 1 ? bandUp(s.rating, state.levelPrior || []) : null;
  els.levelUp.hidden = !up;
  if (!up) { delete els.results.dataset.levelup; els.levelUp.replaceChildren(); return; }
  els.levelUp.replaceChildren(
    Object.assign(document.createElement("span"), { className: "crest-kicker", textContent: "New band" }),
    Object.assign(document.createElement("b"), { textContent: up.band }),
    Object.assign(document.createElement("span"), { className: "crest-note", textContent: `Past ${up.from}, the first time over ${up.min} NWAM.` }),
  );
  els.results.dataset.levelup = up.band;
}

/* The band is the field's yardstick; the personal ladder is his own. */
function ladderText(nwam, history, minutes) {
  const lad = ladder(nwam);
  const me = personalLadder(nwam, history, minutes);
  const band = lad.next ? `${lad.toNext} more NWAM to ${lad.next}.` : "Top band.";
  const mine = [
    me.usual != null ? `your usual ${me.usual}` : null,
    me.best != null ? `your best ${me.best.toFixed(0)}` : null,
    `next milestone ${me.milestone}`,
  ].filter(Boolean).join(", ");
  return `${band} At ${minutes} min: ${mine}.`;
}
/* Thinking is never punished; only typos are. Say so where the numbers are. */
function revisionText(s) {
  const n = s.revisions;
  return `${n} revision${n === 1 ? "" : "s"} took out ${s.revisedKeys} key${s.revisedKeys === 1 ? "" : "s"}: counted in your speed, never as errors. ${s.kept.words} word${s.kept.words === 1 ? "" : "s"} kept, and only those are kept.`;
}
/* The pauses, read apart from the typing. NWAM keeps the pauses in, as a
   real note's fifteen minutes do; flow speed is the fingers alone. */
function thinkText(s) {
  const k = s.think;
  const tail = k.tailMs ? ` The last ${Math.round(k.tailMs / 1000)} seconds, after your last key, are left out of this.` : "";
  if (!k.count) return `No pauses over two seconds: ${Math.round(k.flowWpm)} gross words a minute, straight through.${tail}`;
  const where = [
    k.sentence && `${k.sentence} at the end of a sentence`, k.clause && `${k.clause} after a comma`,
    k.word && `${k.word} between words`, k.mid && `${k.mid} inside a word`,
  ].filter(Boolean).join(", ");
  // What a pause means is his to know; the app says where it fell, and one
  // practical note when two or more fell inside words, where they cost the most.
  const read = k.mid >= 2 ? " Pauses inside a word cost the most speed; if a key was hard to find, the Keys tab shows which letters to practise." : "";
  return `${k.count} pause${k.count === 1 ? "" : "s"} over two seconds, ${Math.round(k.ms / 1000)} seconds in all: ${where}. Between pauses you typed ${Math.round(k.flowWpm)} gross words a minute.${read}${tail}`;
}
/* Trophies won this round, then any nemesis the round spotted: a new
   achievement written from his own numbers, there to be tamed. */
function renderUnlocked(list, spotted = []) {
  const row = (t, lead, cls) => {
    const n = document.createElement("span");
    n.className = cls;
    n.dataset[cls === "unlocked" ? "unlocked" : "spotted"] = t.id;
    const b = document.createElement("b"); b.textContent = t.name;
    n.append(lead, b, ` \u00b7 ${t.condition}`);
    return n;
  };
  els.unlocked.hidden = !list.length && !spotted.length;
  els.unlocked.replaceChildren(...list.map((t) => row(t, t.kind ? "Nemesis tamed: " : "Trophy: ", "unlocked")),
    ...spotted.map((t) => row(t, "New nemesis: ", "unlocked is-nemesis")));
  // Revealed one after another, not all at once.
  [...els.unlocked.children].forEach((n, i) => n.style.setProperty("--i", String(i)));
}

function star(on, label) { const n = document.createElement("span"); n.className = "star" + (on ? " on" : ""); n.textContent = label; return n; }

function renderReview(s) {
  const words = [...new Set(s.unknownWords || [])];
  if (!words.length) { els.review.hidden = true; return; }
  els.reviewList.replaceChildren(...words.map((w) => {
    const row = document.createElement("li");
    const word = document.createElement("b"); word.textContent = w;
    const clinical = document.createElement("button"); clinical.type = "button"; clinical.textContent = "clinical"; clinical.dataset.drillClinical = w;
    const plain = document.createElement("button"); plain.type = "button"; plain.textContent = "a word"; plain.dataset.drillWord = w;
    plain.title = "A real word, just not a clinical one (jackpot): never flagged again, and not counted as a clinical term";
    const typo = document.createElement("button"); typo.type = "button"; typo.textContent = "typo"; typo.dataset.drillTypo = w;
    clinical.addEventListener("click", () => markKnown(w, row, "clinical"));
    plain.addEventListener("click", () => markKnown(w, row, "word"));
    typo.addEventListener("click", () => { row.dataset.drillReviewed = "typo"; for (const b of row.querySelectorAll("button")) b.disabled = true; });
    row.append(word, clinical, plain, typo);
    return row;
  }));
  els.review.hidden = false;
}
/* His three answers for an unknown word: clinical (into the lexicon, and the
   lexicon trophies), a word (real English, not clinical: "jackpot"; kept in
   settings.words so it is known but never counted as clinical), or typo. */
function plainWords() { return Array.isArray(data.settings.words) ? data.settings.words : []; }
function markKnown(w, row, as) {
  if (as === "clinical") {
    data.lexicon = [...new Set(data.lexicon.concat([w]))];
    persist("saveLexicon", data.lexicon);
  } else {
    data.settings = { ...data.settings, words: [...new Set(plainWords().concat([w]))] };
    persist("saveSettings", data.settings);
  }
  knownCache = null;
  row.dataset.drillReviewed = as;
  for (const b of row.querySelectorAll("button")) b.disabled = true;
  // Re-score with the word known: it comes out of the errors and NWAM moves.
  state.score = scoreRound(state.scoredMinutes || minutesFor());
  const s = state.score;
  els.nwam.textContent = s.nwam.toFixed(1);
  els.errors.textContent = String(s.corrections + (s.uncorrected || 0));
  els.accuracy.textContent = Math.round(s.accuracy * 100) + "%";
  els.rating.textContent = s.rating.name;
  renderLevelUp(s);
  if (state.record) {
    Object.assign(state.record, { nwam: s.nwam, accuracy: s.accuracy, rating: s.rating.name, uncorrected: s.uncorrected });
    persist("saveHistory", data.history);
    renderBoard();
  }
}

/* ---- the board: progress, keys, map ---------------------------------------- */
function renderBoard() {
  const h = data.history.slice(-60);
  const nw = h.map((x) => x.nwam);
  const roll = nw.map((_, i) => { const w = nw.slice(Math.max(0, i - 4), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; });
  const pb = bests(ofKind("compose"))[String(state.minutes)];
  els.chartNwam.replaceChildren(lineChart([{ values: nw, cls: "soft", dots: true }, { values: roll }], { guide: pb ?? null, guideLabel: pb != null ? `best at ${state.minutes} min` : "" }));
  els.chartAcc.replaceChildren(lineChart([{ values: h.map((x) => x.accuracy * 100), cls: "acc", dots: true }], { height: 110, min: 80, max: 100, yFormat: (v) => `${Math.round(v)}%` }));
  const b = bests(ofKind("compose")), bc = bests(ofKind("copy"));
  const head = document.createElement("tr");
  for (const t of ["", "answer", "copy"]) { const th = document.createElement("th"); th.textContent = t; head.appendChild(th); }
  els.bests.replaceChildren(head, ...[1, 2, 3, 4, 5].map((m) => {
    const tr = document.createElement("tr");
    const a = document.createElement("td"); a.textContent = `${m} min`;
    const c = document.createElement("td"); c.textContent = b[String(m)] != null ? b[String(m)].toFixed(1) : "-";
    const d = document.createElement("td"); d.textContent = bc[String(m)] != null ? bc[String(m)].toFixed(1) : "-";
    tr.append(a, c, d);
    return tr;
  }));
  els.trend.textContent = trendText(data.history);
  els.keyboard.replaceChildren(keyboard(keyboardRates(data.history, 20)));
  const now = describeProfile(trickyProfile(data.history, keyboardRates(data.history, 20)));
  els.working.textContent = now
    ? `Copy rounds are aiming at: ${now}. Read from your last drills, so it moves as you improve.`
    : "Nothing to aim at yet. A few more drills and copy rounds start picking passages for your tricky keys.";
  const kt = keyTrends(data.history);
  els.keytrends.replaceChildren(...(kt.length ? kt.map((r) => {
    const n = document.createElement("li");
    const cap = document.createElement("span"); cap.className = "cap"; cap.textContent = r.key;
    const what = document.createElement("span"); what.textContent = `${r.misses} missed of ${r.presses} (${(r.rate * 100).toFixed(1)}%)`;
    const move = document.createElement("span");
    if (r.series.length >= 4) {
      const better = r.late < r.early;
      move.className = better ? "better" : "worse";
      move.textContent = better ? `down from ${(r.early * 100).toFixed(1)}%` : `up from ${(r.early * 100).toFixed(1)}%`;
    } else move.textContent = "not enough drills yet";
    n.append(cap, what, move, sparkline(r.series));
    return n;
  }) : [li("No key has cost you a correction yet. Keep typing and this fills in.")]));
  drawMap();
  calendar.render(data.history);
  renderTrophies(els.trophies, data.history, tameLog(), gameTrophies(games()).map((t) => ({ ...t, condition: t.cond, group: t.family, unlocked: t.at, need: 1, have: t.at ? 1 : 0 })));
}
function trendText(hist) {
  if (hist.length < 2) return "A few more drills and this reads your trend.";
  const last5 = hist.slice(-5), prev5 = hist.slice(-10, -5);
  const avg = (xs, k) => xs.reduce((s, x) => s + x[k], 0) / xs.length;
  const today = hist.filter((h) => new Date(h.at).toDateString() === new Date().toDateString()).length;
  const parts = [`${hist.length} drills in all, ${today} today.`];
  if (prev5.length) {
    const d = avg(last5, "nwam") - avg(prev5, "nwam");
    parts.push(`Your last five average ${avg(last5, "nwam").toFixed(1)} NWAM, ${d >= 0 ? "up" : "down"} ${Math.abs(d).toFixed(1)} on the five before.`);
    const a = (avg(last5, "accuracy") - avg(prev5, "accuracy")) * 100;
    parts.push(`Accuracy ${a >= 0 ? "up" : "down"} ${Math.abs(a).toFixed(1)} points.`);
  }
  const answered = new Set(hist.map((h) => h.outline).filter(Boolean)).size;
  parts.push(`You have answered under ${answered} of the outline's ${ITEMS.length} items.`);
  return parts.join(" ");
}
function drawMap() {
  const cols = renderMap(data.history, expertCounts(), BANK);
  els.mapGrid.replaceChildren(...cols.map((d) => {
    const col = document.createElement("div");
    col.className = "map-col"; col.dataset.mapDomain = d.letter;
    const head = document.createElement("div"); head.className = "map-head";
    const b = document.createElement("b"); b.textContent = d.letter;
    const nm = document.createElement("span"); nm.textContent = d.name;
    const it = document.createElement("i"); it.textContent = `${d.share || 0}% of the exam · ${d.mine} yours${d.expert ? ` · ${d.expert} expert` : ""}`;
    head.append(b, nm, it);
    col.appendChild(head);
    for (const c of d.cells) {
      const cell = document.createElement("div");
      cell.className = "map-cell" + (c.askable ? " is-askable" : "");
      cell.dataset.mapCell = c.id; cell.dataset.mapTotal = String(c.total);
      cell.style.setProperty("--shade", String(c.shade));
      cell.title = `${c.id} ${c.text}${c.total ? ` · ${c.mine} yours${c.expert ? `, ${c.expert} expert` : ""}` : " · nothing yet"}`;
      cell.textContent = c.id;
      col.appendChild(cell);
    }
    return col;
  }));
}
/* Expert records per outline item: the Mac app's shell may fill this in. */
function expertCounts() { const e = window.DrillExpert; return e && typeof e === "object" ? e : {}; }

function showTab(name) {
  for (const t of els.tabs) t.classList.toggle("is-on", t.dataset.tab === name);
  for (const p of els.panes) p.hidden = p.dataset.pane !== name;
  if (name === "expert") renderExpert();
}
function openBoard(tab) {
  // Not mid-round: the clock would run on and the finish would pull him off
  // the board to the results (AUDIT S2).
  if (state.phase === "armed" || state.phase === "running") return;
  renderBoard();
  els.results.dataset.mode = "board";
  els.setup.hidden = true; els.question.hidden = true; els.read.hidden = true; els.results.hidden = false;
  delete root.dataset.drillView;
  setPhase("board");
  showTab(tab);
}

/* Records whose Keep is on its way. K twice, a double click on the pending
   bar, or B twice would otherwise keep one answer twice: two queue lines and
   two drafts for him to reject. */
const keeping = new Set();
async function keep(held = null) {
  // held: an answer left without a Keep (renderPending); otherwise the one on screen.
  const live = !held || held instanceof Event;
  if (live) {
    const hasWords = state.score && (state.score.gwam > 0 || (state.spoken && roundText().trim()));
    if (!state.score || state.kept || copyLike() || !hasWords) return;
  }
  const snap = live ? snapshot() : held;
  if (!snap.record || snap.record.kept || keeping.has(snap.record)) return;
  keeping.add(snap.record);
  try { return await keepSnap(snap, live); } finally { keeping.delete(snap.record); }
}
async function keepSnap(snap, live) {
  if (live) {
    els.keep.disabled = true;
    els.keepnote.textContent = "Keeping...";
  }
  // The whole answer, every Keep going round of it; if an earlier round was
  // already kept, only what came after, marked as continuing that one.
  const from = snap.from;
  const text = snap.text.slice(from);
  // What was in front of him, and his tone, counted here on the Mac (stance.js).
  const research = researchContext({ mode: snap.mode, item: snap.item, passage: snap.passage, oracle: snap.oracle });
  const r = await store.keep({
    at: snap.record.at, itemId: snap.item.id, outline: snap.item.outline, question: snap.item.question,
    ...(from ? { continues: snap.answerAt } : {}), ...(snap.passage && snap.mode === "respond" ? { passage: snap.passage.id, passageSource: snap.passage.source } : {}),
    minutes: snap.roundMinutes, seconds: snap.seconds, text,
    // Left mid-round (AUDIT A11): no score to send, and it says so.
    ...(snap.score ? {
      nwam: snap.score.nwam, gwam: snap.score.gwam, accuracy: snap.score.accuracy,
      // Where he stopped to think, by character offset: the expert can read
      // what came right before each stop as what he was deciding.
      pauses: snap.score.think.stops, revisions: snap.score.revisions,
    } : { unscored: true }),
    mode: snap.mode, register: snap.spoken ? "spoken" : "drill",
    ...(snap.item.lens ? { lens: snap.item.lens } : {}),
    ...(research ? { research } : {}), tone: toneOf(text, snap.item.lens),
    ...(snap.mode === "oracle" && snap.oracle && snap.oracle.seed ? { seed: snap.oracle.seed } : {}),
    ...(snap.mode === "oracle" && snap.oracle ? { oracle: { topic: snap.oracle.topic, question: snap.oracle.reply.question, thoughts: snap.oracle.reply.thoughts } } : {}),
  }).catch((e) => ({ ok: false, note: String(e) }));
  if (!live) {
    if (r && r.ok) {
      snap.record.kept = true;
      // Held from the round still in state (Home, then Keep it): the round
      // is kept too, so a later Home does not hold it again.
      if (snap.record === state.record) { state.kept = true; state.keptUpTo = snap.text.length; }
      // An earlier round of the answer still on screen: its later Keep sends only what came after.
      else if (snap.answerAt && snap.answerAt === state.answerAt) state.keptUpTo = Math.max(state.keptUpTo, snap.text.length);
      persist("saveHistory", data.history); renderExpert();
    }
    els.keepnote.textContent = r && r.ok ? ([r.corpus, r.expert].filter(Boolean).join(" ") || "Kept.") : ((r && r.note) || "Could not keep it.");
    return r;
  }
  if (r && r.ok) {
    state.kept = true;
    state.keptUpTo = els.box.value.length;
    state.record.kept = true;
    dropSameAnswer();
    persist("saveHistory", data.history);
    els.keep.textContent = "Kept";
    els.keepnote.textContent = [r.corpus, r.expert].filter(Boolean).join(" ") || "Kept.";
    renderExpert();
  } else {
    els.keep.disabled = false;
    els.keepnote.textContent = (r && r.note) || "Could not keep it.";
  }
  return r;
}

/* ---- the pair game (pairgame.js) -------------------------------------------
   A slow pair is a button: ten words that hold it, typed against the clock. */
function pairButton(pair, ms) {
  const b = Object.assign(document.createElement("button"), { type: "button", className: "pair-go", textContent: `Blast ${pair}` });
  b.dataset.pair = pair;
  b.title = `Ten words with "${pair}", against the clock`;
  b.addEventListener("click", () => {
    const field = [...PASSAGES.map((x) => x.text), ...BANK.map((x) => x.question || "")];
    const words = pickWords(pair, { field, dictionary: WORDS || [] });
    if (!words.length) return;
    openPairGame(els.results, {
      pair, words, roundMs: ms, runs: (games().pairs || {})[pair] || [], progressLine,
      onResult: (run) => saveRun("pair", run, pair), onClose: () => els.again.focus({ preventScroll: true }),
    });
  });
  return b;
}

/* The mini games keep their own runs in settings, never in history (minigames.js). */
const games = () => (data.settings.games && typeof data.settings.games === "object" ? data.settings.games : {});
function saveRun(kind, run, pair) {
  data.settings = { ...data.settings, games: addRun(games(), kind, run, pair) };
  persist("saveSettings", data.settings);
}

/* River Rhythm (river.js): offered with the uneven-timing tip. */
function riverButton() {
  const b = Object.assign(document.createElement("button"), { type: "button", className: "pair-go river-go", textContent: "River Rhythm" });
  b.dataset.riverGo = "";
  b.title = "Keep an even beat and the kayak stays mid-river";
  const passage = () => PASSAGES[Math.floor(Math.random() * PASSAGES.length)].text;
  b.addEventListener("click", () => openRiver(els.results, {
    text: passage(), more: passage, runs: games().river || [], progressLine,
    onResult: (run) => saveRun("river", run), onClose: () => els.again.focus({ preventScroll: true }),
  }));
  return b;
}

/* Shifty Shifts (shifty.js): offered when a Shift went wrong this round. */
function shiftyButton() {
  const b = Object.assign(document.createElement("button"), { type: "button", className: "pair-go shifty-go", textContent: "Shifty Shifts" });
  b.dataset.shiftyGo = "";
  b.title = "Twenty words, thirteen capitals, both Shifts, against the clock";
  b.addEventListener("click", () => {
    const built = buildShifty(shiftyPool(PASSAGES));
    if (!built) return;
    openShifty(els.results, {
      built, runs: games().shifty || [], judge, handOf, progressLine,
      onResult: (run) => saveRun("shifty", run), onClose: () => els.again.focus({ preventScroll: true }),
    });
  });
  return b;
}

/* ---- an answer left without a Keep ------------------------------------------
   His report of 2026-09-24: respond, then a nemesis drill, and the answer had
   no way left to reach the expert. His ruling stands: text is kept only when
   he presses Keep. So the answer is held for this session, and a bar on the
   home and results screens offers Keep it and Send to the expert. */
/* No cap (AUDIT A8): a held answer lives in memory only, never on disk, so
   holding a tenth costs nothing, and dropping the oldest dropped his text.
   Empty answers are never held in the first place. */
function snapshot(over = {}) {
  return {
    record: state.record, item: state.item, passage: state.passage, oracle: state.oracle, mode: state.mode,
    roundMinutes: state.roundMinutes, seconds: secondsFor(), score: state.score, spoken: state.spoken,
    from: state.keptUpTo, answerAt: state.answerAt, text: els.box.value, ...over,
  };
}
/* Esc mid-round (AUDIT A11): twenty words or more is an answer worth holding.
   It is held unscored, with a record of its own that never goes to history,
   so bests, bands and nemeses are untouched and Keep it is still the only
   way it reaches the disk. */
const HOLD_MIN_WORDS = 20;
function holdRunning() {
  const words = roundText().trim().split(/\s+/).filter(Boolean).length;
  if (copyLike() || words < HOLD_MIN_WORDS) return;
  const at = new Date().toISOString();
  const elapsed = Math.round(Math.min(secondsFor(), (performance.now() - state.t0) / 1000));
  const snap = snapshot({ record: { at, kept: false, unscored: true }, score: null, seconds: elapsed, answerAt: state.answerAt || at });
  state.pending = [snap, ...(state.pending || []).filter((p) => !sameAnswer(p))];
  renderPending();
}
function holdIfUnkept() {
  if (state.phase === "running") { holdRunning(); return; }
  const hasWords = state.score && (state.score.gwam > 0 || (state.spoken && roundText().trim()));
  if (!["done", "board"].includes(state.phase) || state.kept || (state.record && state.record.kept) || copyLike() || !hasWords) return;
  state.pending = [snapshot(), ...(state.pending || []).filter((p) => p.record !== state.record && !sameAnswer(p))];
  renderPending();
}
/* A1: how many of his answers a quit would lose right now. The Mac shell
   asks this before it quits or closes the window, and warns when it is not
   0. It counts the held rows, plus the answer on screen when it is finished
   and unkept or still being written. A Keep going round and its held
   earlier round are one answer. Copy rounds are not his words. */
function unkeptCount() {
  const list = (state.pending || []).filter((p) => !(p.record && p.record.kept));
  const hasWords = state.score && (state.score.gwam > 0 || (state.spoken && roundText().trim()));
  const finished = ["done", "board"].includes(state.phase) && hasWords && !state.kept && !(state.record && state.record.kept);
  const writing = state.phase === "running" && Boolean(roundText().trim());
  const live = !copyLike() && (finished || writing);
  const held = live ? list.filter((p) => p.record !== state.record && !sameAnswer(p)) : list;
  return held.length + (live ? 1 : 0);
}
/* An earlier Keep going round of the answer on screen: the live round's text
   holds all of it, so the live round's Keep or hold replaces it. */
function sameAnswer(p) {
  return Boolean(p.answerAt) && p.answerAt === state.answerAt && p.record !== state.record;
}
function dropSameAnswer() {
  const before = (state.pending || []).length;
  state.pending = (state.pending || []).filter((p) => !sameAnswer(p));
  if (state.pending.length !== before) renderPending();
}
function renderPending() {
  const list = state.pending || [];
  els.pending.hidden = !list.length;
  const count = Object.assign(document.createElement("div"), {
    className: "pending-count",
    textContent: list.length === 1 ? "1 answer is held for this session, not kept." : `${list.length} answers are held for this session, not kept.`,
  });
  count.dataset.pendingCount = "";
  els.pending.replaceChildren(count, ...list.map((snap, i) => {
    const row = document.createElement("div");
    row.className = "pending-row";
    const q = (snap.item.question || "").slice(0, 70);
    const at = new Date(snap.record.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const t = Object.assign(document.createElement("span"), { textContent: `Your answer to "${q}${q.length >= 70 ? "..." : ""}" (${at})${snap.score ? "" : ", left mid-round and not scored,"} is not kept.` });
    const k = Object.assign(document.createElement("button"), { type: "button", className: "keep", textContent: "Keep it" });
    k.dataset.pendingKeep = String(i);
    const send = Object.assign(document.createElement("button"), { type: "button", className: "soft", textContent: "Send to the expert" });
    send.dataset.pendingSend = String(i);
    const note = Object.assign(document.createElement("span"), { className: "pending-note" });
    note.dataset.pendingNote = String(i);
    k.addEventListener("click", () => keepPending(snap, false, [k, send], note));
    send.addEventListener("click", () => keepPending(snap, true, [k, send], note));
    row.append(t, k, send, note);
    return row;
  }));
}
/* The row is disabled while it saves, and the outcome is written into the
   row itself: the results note and the expert log are hidden on home. */
async function keepPending(snap, thenSend, buttons = [], note = null) {
  for (const b of buttons) b.disabled = true;
  if (note) note.textContent = "Keeping...";
  const r = await keep(snap);
  if (r && r.ok) {
    state.pending = (state.pending || []).filter((p) => p !== snap);
    renderPending();
    if (thenSend) await sendToExpert();
    return;
  }
  for (const b of buttons) b.disabled = false;
  if (note) note.textContent = r ? (r.note || "Could not keep it.") : "";
}

/* ---- wire ---------------------------------------------------------------- */
for (const b of els.mins) b.addEventListener("click", () => setMinutes(Number(b.dataset.drillMinutes)));
els.start.addEventListener("click", arm);
function again() {
  if (state.busy) return;
  if (state.phase === "done" && state.mode === "tame") armTame(state.passage.target);
  else if (state.phase === "done" && state.mode === "copy") armRespond();
  else if (state.phase === "done" && state.mode === "oracle") armOracle(true);
  else arm();
}
els.again.addEventListener("click", again);
els.tame.addEventListener("click", () => armTame());
els.mic.addEventListener("click", toggleMic);
/* Send from the results or the board keeps the answer on screen first. His
   miss of 2026-09-23: four Keep going rounds were sent without a Keep, and
   Send only reads answers already kept, so they were lost. keep() itself
   skips a copy round, a kept one, and an empty one. */
async function keepThenSend() {
  if (state.busy) return;
  if (["done", "board"].includes(state.phase) && state.score && !state.kept) await keep();
  await sendToExpert();
}
els.send.addEventListener("click", keepThenSend);
els.expertSend.addEventListener("click", keepThenSend);
els.expertConnect.addEventListener("click", connectExpert);
els.cont.addEventListener("click", continueRound);
els.baton.addEventListener("click", batonPass);
for (const b of els.modes) b.addEventListener("click", () => setMode(b.dataset.drillMode));
els.home.addEventListener("click", home);
els.keep.addEventListener("click", keep);
els.respond.addEventListener("click", armRespond);
els.shelve.addEventListener("click", shelveIt);
els.numbers.addEventListener("click", toggleNumbers);
els.readHome.addEventListener("click", home);
for (const b of els.opens) b.addEventListener("click", () => openBoard(b.dataset.drillOpen));
for (const t of els.tabs) t.addEventListener("click", () => showTab(t.dataset.tab));
els.strictShift.addEventListener("change", () => {
  data.settings = { ...data.settings, strictShift: els.strictShift.checked };
  persist("saveSettings", data.settings);
});
els.box.addEventListener("keydown", onShiftKey);
els.box.addEventListener("keyup", onShiftKey);
els.box.addEventListener("blur", () => shiftKeys.clear());
els.box.addEventListener("input", onInput);
els.box.addEventListener("keydown", onKeydown);
els.box.addEventListener("paste", onPaste);
/* The settle: for three seconds after a round ends, keys do nothing. His
   ask: fingers still typing past the bell pressed Return on Again and started
   the next round. Clicks still work; a click is on purpose. Tests set
   window.__settleMs to skip the wait. */
const SETTLE_MS = 3000;
let settleUntil = 0;
function settle() {
  const ms = typeof window.__settleMs === "number" ? window.__settleMs : SETTLE_MS;
  settleUntil = Date.now() + ms;
  if (!ms) return;
  root.dataset.settling = "1";
  setTimeout(() => { if (Date.now() >= settleUntil) delete root.dataset.settling; }, ms);
}
document.addEventListener("keydown", (e) => {
  // A game opened by a click during the settle takes its keys at once (AUDIT G15).
  if (e.target && e.target.closest && e.target.closest("[data-minigame]")) return;
  if (Date.now() < settleUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
document.addEventListener("keydown", (e) => {
  if (e.target === els.box || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target && e.target.closest && e.target.closest("[data-minigame]")) return;
  const inButton = e.target && e.target.tagName === "BUTTON";
  if (e.target === els.oracleTopic) { if (e.key === "Enter") { e.preventDefault(); arm(); } return; }
  // A typed field gets its own keys: k, c, d, s or Return typed there never
  // keep, continue or start a drill (AUDIT S1).
  if (e.target === els.expertToken) { if (e.key === "Enter") { e.preventDefault(); connectExpert(); } return; }
  if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== "checkbox") return;
  if (state.phase === "idle") {
    if (e.key === "Enter" && !inButton) { e.preventDefault(); arm(); }
    else if (/^[1-5]$/.test(e.key)) setMinutes(Number(e.key));
    else if (e.key.toLowerCase() === "d" && !els.tameHome.hidden) { e.preventDefault(); armTame(); }
  } else if (state.phase === "done" || state.phase === "board") {
    if (e.key === "Enter" && !(inButton && e.target !== els.again)) { e.preventDefault(); again(); }
    else if (e.key.toLowerCase() === "k" && state.phase === "done") { e.preventDefault(); keep(); }
    else if (e.key.toLowerCase() === "d" && state.phase === "done" && !els.tame.hidden) { e.preventDefault(); armTame(); }
    else if (e.key.toLowerCase() === "c" && state.phase === "done") { e.preventDefault(); continueRound(); }
    else if (e.key.toLowerCase() === "b" && state.phase === "done" && !els.baton.hidden) { e.preventDefault(); batonPass(); }
    else if (e.key.toLowerCase() === "s" && state.phase === "done" && state.mode === "copy") { e.preventDefault(); shelveIt(); }
    else if (e.key.toLowerCase() === "n" && state.phase === "done" && state.mode === "copy") { e.preventDefault(); toggleNumbers(); }
    else if (e.key === "Escape") { e.preventDefault(); home(); }
  }
});

async function init() {
  const loaded = await store.load();
  Object.assign(data, loaded);
  const last = data.history.length ? data.history[data.history.length - 1].minutes : null;
  state.minutes = Number(data.settings.minutes) || last || 1;
  // His ruling of 2026-09-23: copy, then respond is the default mode. Moved
  // over once; after that the app opens on whatever mode he last picked.
  if (!data.settings.copyDefault) { data.settings = { ...data.settings, mode: "copy", copyDefault: true }; persist("saveSettings", data.settings); }
  setMode(data.settings.mode, false);
  els.strictShift.checked = strictShift();
  renderExpert();
  renderChips();
  renderShelf();
  renderTameOffer();
  drawMap();
  els.start.focus({ preventScroll: true });
  await wordsLoaded;
  store.ready({ bank: BANK.length, outline: ITEMS.length, words: WORDS ? WORDS.length : 0, history: data.history.length });
}
init();

// For tests and a look under the hood; never for the page's own flow.
window.NoteDrill = { handOf, state, data, BANK, scoreDrill, finish, known: () => knownNow(), garden, drawMap, renderBoard, openBoard, sendToExpert, batonPass, unkeptCount, ingestInBackground };
