/* Clinical Typing Drills: the page.
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
import { bests, streak, sitting, ladder, stars, keyTrends, keyboardRates, lineChart, sparkline, keyboard, dayOf } from "./panel.js";
import { trophyCase, newlyUnlocked } from "./trophies.js";
import { createCalendar, renderTrophies } from "./calendar.js";
import { handOf, judge, createShiftTracker, createShiftFx } from "./shift.js";
import { nextPassage, trickyProfile, describeProfile } from "./passages.js";
import { renderPassage, markPassage } from "./copy.js";

const params = new URLSearchParams(location.search);
// ?clock=SECONDS overrides the minute picker: tests, and a quick look.
const CLOCK_OVERRIDE = Number(params.get("clock"));

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const root = $("main.drill");
const els = {
  setup: $("[data-drill-setup]"), start: $("[data-drill-start]"), mins: $$("[data-drill-minutes]"), pb: $("[data-drill-pb]"),
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
};

const data = { history: [], lexicon: [], settings: {} };
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
};

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
const kindOf = (h) => (h && h.mode === "copy" ? "copy" : "compose");
const ofKind = (kind) => data.history.filter((h) => kindOf(h) === kind);
const roundKind = () => (state.mode === "copy" ? "copy" : "compose");
const minutesFor = () => secondsFor() / 60;
function clockText(s) {
  const m = Math.floor(s / 60), r = Math.max(0, Math.floor(s - m * 60));
  return m + ":" + String(r).padStart(2, "0");
}
function setPhase(p) { state.phase = p; root.dataset.drillState = p; }
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
  if (save) { data.settings = { ...data.settings, minutes: m }; store.saveSettings(data.settings); }
}
function setMode(mode, save = true) {
  const m = mode === "copy" ? "copy" : "answer";
  for (const b of els.modes) b.classList.toggle("is-on", b.dataset.drillMode === m);
  els.lede.textContent = m === "copy"
    ? "Copy a passage from the field for the clock you pick, word for word, then answer it in your own words for a minute. Keep going if you have more to say."
    : "One clinical question. One to five minutes, as fast and as clean as you can. The garden grows with every word, and warms when you fly.";
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
  const won = trophyCase(data.history).filter((x) => x.unlocked).length;
  els.trophyChip.textContent = won ? `${won} trophies` : "";
  els.trophyChip.hidden = !won;
}
function home() {
  clearTimeout(state.timer);
  setPhase("idle");
  els.setup.hidden = false;
  els.question.hidden = true;
  els.results.hidden = true;
  garden.reset(); garden.cool();
  shiftFx.clear();
  setMinutes(state.minutes, false);
  renderChips();
  els.start.focus();
}

/* ---- arm ---------------------------------------------------------------- */
/* A new drill: a bank question, or a passage to copy. */
function arm() {
  if (data.settings.mode === "copy") {
    const recent = data.history.filter((h) => h.mode === "copy").map((h) => h.passage);
    // His ask: the passages work his tricky areas, and adapt as he improves.
    // The profile is read fresh from the recent drills every time.
    state.tricky = trickyProfile(data.history, keyboardRates(data.history, 20));
    state.weak = state.tricky.keys;
    armCopy(nextPassage(recent, state.tricky));
    return;
  }
  const recent = data.history.map((h) => h.itemId);
  // His ruling: the next question comes from the emptiest cell of the map.
  const cell = emptiestCell({ bank: BANK, history: data.history });
  state.item = nextItem(recent, Math.random, cell);
  state.passage = null;
  startRound("answer", state.minutes, null);
}

/* Copy: the passage for the picked clock, word for word. Never kept. */
function armCopy(passage) {
  state.passage = passage;
  state.item = { id: passage.id, outline: passage.outline, tag: passage.kind === "take" ? "the drill's take" : "study", question: passage.title, bullets: [] };
  startRound("copy", state.minutes, null);
}

/* Respond: a minute, in his own words, on the passage he just copied. */
function armRespond() {
  const p = state.passage;
  if (!p) { arm(); return; }
  state.item = { id: p.id, outline: p.outline, tag: "respond", question: p.respond, bullets: [] };
  startRound("respond", 1, null);
}

/* Keep going: the same question, the same box, a fresh clock. His ruling:
   "maybe I had more to say on it and stopped only because time was out." */
function continueRound() {
  if (!state.score || state.mode === "copy") return;
  startRound(state.mode, state.mode === "respond" ? 1 : state.roundMinutes, els.box.value);
}

function startRound(mode, minutes, carry) {
  state.mode = mode;
  state.roundMinutes = minutes;
  state.events = []; state.score = null; state.flagged = []; state.combo = 0; state.bestCombo = 0;
  state.backspaceInWord = false; state.record = null; state.kept = false;
  state.pendingDelete = null; state.bsRun = 0; state.coached = false;
  const continuing = typeof carry === "string";
  if (!continuing) { state.cont = 0; state.answerAt = null; state.keptUpTo = 0; }
  else state.cont += 1;
  shiftKeys.clear(); shiftFx.clear();
  root.dataset.drillMode = mode;
  const ol = itemById(state.item.outline);
  els.category.textContent = mode === "copy"
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
  if (mode === "copy") {
    els.bullets.replaceChildren(Object.assign(li(state.passage.source), { className: "passage-src" }));
    renderPassage(els.passage, state.passage.text, state.weak || []);
    els.passage.scrollTop = 0;
    markPassage(els.passage, "", state.passage.text);
  }
  els.passage.hidden = mode !== "copy";
  els.ref.hidden = mode !== "respond";
  if (mode === "respond") { els.refText.textContent = state.passage.text; els.ref.open = false; }
  els.box.value = continuing ? carry : "";
  state.prefix = els.box.value.length;
  els.box.disabled = false;
  els.box.placeholder = mode === "copy"
    ? "Type the passage above, exactly. Capitals and punctuation count. The clock starts on your first key."
    : "Start typing. The clock starts on your first key.";
  els.live.textContent = ""; els.combo.hidden = true; els.wpm.textContent = "0";
  els.hint.textContent = mode === "copy" ? "Copy it word for word. Finish the passage and the round ends early." : "The clock starts on your first keystroke. esc leaves without scoring.";
  els.clock.textContent = clockText(secondsFor());
  els.raceYou.style.left = "0%"; els.raceGhost.style.left = "0%"; els.raceNote.textContent = "";
  els.results.hidden = true; els.setup.hidden = true; els.question.hidden = false;
  heat = createHeat(usualAndBest());
  garden.reset();
  if (continuing) garden.update({ words: state.prefix / 5, heat: 0 });
  setPhase("armed");
  els.box.focus();
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
  if (kind === "char" && e.shiftKey) shiftCheck(e, ev);
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
  const unknown = state.mode !== "copy" && dict && !/^[A-Z]/.test(tok) && w && !isKnown(w, dict);
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
/* Shift side: which Shift is down, which hand owns the key. */
function shiftCheck(e, ev) {
  const side = shiftKeys.side(e);
  const hand = handOf(e.code);
  if (!side || !hand) return;
  ev.shift = side; ev.hand = hand;
  const j = judge(side, hand);
  if (j === "same") shiftFx.same(hand, e.key);
  else if (j === "ok") shiftFx.ok(side);
}
function onShiftKey(e) { shiftKeys.key(e); }

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
  if (state.mode === "copy" && state.passage) {
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
  els.hint.textContent = state.mode === "copy" ? "Go. Word for word; finish the passage and the round ends early." : "Go. Backspace and return count; paste does not.";
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
  clearTimeout(state.timer);
  setPhase("done");
  els.box.disabled = true;
  els.clock.textContent = "0:00";
  els.hint.textContent = "Time.";
  // A copy round that reaches the end of the passage stops early: score the time it took.
  const elapsed = Math.min(secondsFor(), (performance.now() - state.t0) / 1000);
  const scoredMinutes = state.mode === "copy" ? Math.max(elapsed, 5) / 60 : minutesFor();
  await wordsLoaded;
  knownCache = null;
  const prior = data.history.slice();
  state.score = scoreRound(scoredMinutes);
  const s = state.score;
  state.scoredMinutes = scoredMinutes;
  state.record = {
    at: new Date().toISOString(), itemId: state.item.id, outline: state.mode === "copy" ? null : state.item.outline, minutes: state.roundMinutes,
    mode: state.mode, ...(state.passage && state.mode !== "answer" ? { passage: state.passage.id } : {}), ...(state.cont ? { cont: state.cont } : {}),
    seconds: secondsFor(), gwam: s.gwam, nwam: s.nwam, accuracy: s.accuracy, rating: s.rating.name,
    corrections: s.corrections, uncorrected: s.uncorrected, words: s.grossWords, bestCombo: state.bestCombo,
    keys: s.keys, kept: false, revisions: s.revisions,
    habits: { wordByHand: s.habits.wordByHand, wordDeletes: s.habits.wordDeletes, lineDeletes: s.habits.lineDeletes },
    shift: s.shift,
    think: { ms: s.think.ms, count: s.think.count, sentence: s.think.sentence, clause: s.think.clause, word: s.think.word, mid: s.think.mid, flowWpm: s.think.flowWpm },
    lexicon: data.lexicon.length,
    // Names of what was slow and which tips fired: what the copy picker aims at next.
    slowPairs: s.timing.slowPairs.map((p) => p.pair), tips: s.tips.map((t) => t.id),
  };
  const st = stars(s, prior.filter((h) => kindOf(h) === roundKind()), state.roundMinutes);
  const before = trophyCase(prior);
  if (!state.answerAt) state.answerAt = state.record.at;
  if (s.gwam > 0) {
    data.history.push(state.record);
    store.saveHistory(data.history);
  }
  state.unlocked = s.gwam > 0 ? newlyUnlocked(before, trophyCase(data.history)) : [];
  store.log(`drill ${state.mode} ${state.item.id} ${state.roundMinutes}m nwam ${s.nwam} acc ${s.accuracy}`);
  render(s, st, prior);
}

/* The round's own text: a Keep going round scores only what it added. */
const roundText = () => els.box.value.slice(Math.min(state.prefix, els.box.value.length));
function scoreRound(minutes) {
  return scoreDrill({
    events: state.events, text: roundText(), minutes, lexicon: knownNow(),
    reference: state.mode === "copy" ? state.passage.text : undefined,
  });
}

/* ---- results ------------------------------------------------------------- */
function render(s, st, prior) {
  els.results.dataset.mode = "drill";
  els.nwam.textContent = s.nwam.toFixed(1);
  els.gwam.textContent = s.gwam.toFixed(1);
  els.errors.textContent = String(s.corrections + (s.uncorrected || 0));
  els.accuracy.textContent = Math.round(s.accuracy * 100) + "%";
  els.rating.textContent = s.rating.name;
  els.ratingNote.textContent = s.rating.accuracyGated ? "(one band down: accuracy under 96%)" : s.gwam < 1 ? "(nothing typed)" : "";
  const lad = ladder(s.nwam);
  els.next.textContent = lad.next ? `${lad.toNext} more NWAM to ${lad.next}.` : "Top band. Now hold it.";
  els.stars.replaceChildren(
    star(st.best, "Personal best"), star(st.beatLast, "Beat your last"), star(st.clean, "97% clean"),
    ...(state.bestCombo >= 15 ? [star(true, `${state.bestCombo} clean in a row`)] : []),
  );
  els.basis.textContent = s.netBasis === "reference"
    ? `A copy round: NWAM subtracts the ${s.uncorrected} word${s.uncorrected === 1 ? "" : "s"} that did not match the passage (capitals and punctuation count), over ${Math.round(state.scoredMinutes * 60)} seconds.`
    : s.netBasis === "corrections"
    ? `NWAM counts your ${s.corrections} corrections as the errors, because the word list has not loaded; uncorrected typos are not scored.`
    : `NWAM subtracts ${s.uncorrected} unknown word${s.uncorrected === 1 ? "" : "s"}; your ${s.corrections} correction${s.corrections === 1 ? "" : "s"} cost you time, not words. Mark a term clinical below and it comes out of the count.`;
  const pb = bests(prior.filter((h) => kindOf(h) === roundKind()))[String(state.roundMinutes)];
  els.pace.replaceChildren(lineChart([{ values: s.pace, dots: false }], { guide: pb ?? null, guideLabel: pb != null ? `best ${pb.toFixed(0)}` : "", height: 120, min: 0 }));
  els.tricky.replaceChildren(...(s.tricky.keys.length ? s.tricky.keys.map((k) => li(`${keyName(k.key)} hit by mistake ${k.count}×`)) : [li("Nothing corrected. Clean hands.")]));
  for (const c of s.tricky.confusions) els.tricky.appendChild(li(`hit ${keyName(c.hit)} for ${keyName(c.meant)}, ${c.count}×`));
  const tm = [];
  if (s.timing.intervals) tm.push(`${s.timing.medianMs} ms between keys, cadence ±${Math.round(s.timing.cv * 100)}%`);
  if (s.timing.afterShiftMs) tm.push(`${s.timing.afterShiftMs} ms after shift`);
  if (s.timing.punctuationMs) tm.push(`${s.timing.punctuationMs} ms on punctuation`);
  if (s.timing.pauses) tm.push(`${s.timing.pauses} pause${s.timing.pauses === 1 ? "" : "s"} over two seconds`);
  for (const p of s.timing.slowPairs) tm.push(`${p.pair} runs slow: ${p.ms} ms`);
  if (s.shift.ok + s.shift.same) tm.push(`${s.shift.ok} of ${s.shift.ok + s.shift.same} capitals with the opposite Shift`);
  if (s.revisions) tm.push(`${s.revisions} revision${s.revisions === 1 ? "" : "s"} with Option or Command+Backspace`);
  els.timing.replaceChildren(...(tm.length ? tm.map(li) : [li("Not enough keys to read a rhythm.")]));
  els.tips.replaceChildren(...(s.tips.length ? s.tips.map((t) => {
    const n = document.createElement("li");
    const b = document.createElement("b"); b.textContent = t.tip;
    const w = document.createElement("span"); w.textContent = "because " + t.why;
    n.append(b, w);
    return n;
  }) : [li("Nothing fired. Same form, faster, next time.")]));
  els.think.textContent = thinkText(s);
  renderUnlocked(state.unlocked || []);
  renderReview(s);
  renderBoard();
  const copying = state.mode === "copy";
  els.keep.hidden = copying;
  els.keep.disabled = !(s.gwam > 0);
  els.keep.textContent = "Keep it"; els.keep.appendChild(Object.assign(document.createElement("kbd"), { textContent: "K" }));
  els.keepnote.textContent = copying
    ? "Copy rounds are never kept: the words are the passage's, not yours. Respond is next, one minute."
    : store.inApp
      ? `Keep sends ${state.cont ? "this answer, every round of it," : "this answer"} to your voice corpus (drill register) and the expert queue.`
      : "This browser page keeps numbers only; the Mac app keeps text.";
  els.cont.hidden = copying;
  els.cont.disabled = !(s.gwam > 0) && !state.prefix;
  els.again.replaceChildren(copying ? "Respond · 1 min" : "Again", Object.assign(document.createElement("kbd"), { textContent: "return" }));
  showTab("drill");
  els.question.hidden = true;
  els.results.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderChips();
  els.again.focus();
}
/* The thinking, read apart from the typing. NWAM keeps the thinking in, as a
   real note's fifteen minutes do; flow speed is the fingers alone. */
function thinkText(s) {
  const k = s.think;
  const tail = k.tailMs ? ` The last ${Math.round(k.tailMs / 1000)} seconds, after your last key, are left out of this.` : "";
  if (!k.count) return `No stops over two seconds while you were typing: straight through at ${Math.round(k.flowWpm)} gross words a minute.${tail}`;
  const where = [
    k.sentence && `${k.sentence} at the end of a sentence`, k.clause && `${k.clause} after a comma`,
    k.word && `${k.word} between words`, k.mid && `${k.mid} inside a word`,
  ].filter(Boolean).join(", ");
  const planned = k.sentence + k.clause;
  // One or two stops are not a pattern; the read waits for three.
  const read = k.count < 3 ? ""
    : planned >= k.word + k.mid
    ? "Most of your thinking landed between ideas, which is where a note wants it."
    : "More of your stops fell mid-sentence than between ideas; try settling the next point at the full stop, then typing it through.";
  return `You stopped to think ${k.count} time${k.count === 1 ? "" : "s"}, ${Math.round(k.ms / 1000)} seconds in all: ${where}. While typing you ran ${Math.round(k.flowWpm)} gross words a minute.${read ? " " + read : ""}${tail}`;
}
function renderUnlocked(list) {
  els.unlocked.hidden = !list.length;
  els.unlocked.replaceChildren(...list.map((t) => {
    const n = document.createElement("span");
    n.className = "unlocked";
    n.dataset.unlocked = t.id;
    const b = document.createElement("b"); b.textContent = t.name;
    n.append("Trophy: ", b, ` · ${t.condition}`);
    return n;
  }));
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
    store.saveLexicon(data.lexicon);
  } else {
    data.settings = { ...data.settings, words: [...new Set(plainWords().concat([w]))] };
    store.saveSettings(data.settings);
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
  if (state.record) {
    Object.assign(state.record, { nwam: s.nwam, accuracy: s.accuracy, rating: s.rating.name, uncorrected: s.uncorrected });
    store.saveHistory(data.history);
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
  renderTrophies(els.trophies, data.history);
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
}
function openBoard(tab) {
  renderBoard();
  els.results.dataset.mode = "board";
  els.setup.hidden = true; els.question.hidden = true; els.results.hidden = false;
  setPhase("board");
  showTab(tab);
}

async function keep() {
  if (!state.score || state.kept || state.mode === "copy" || !(state.score.gwam > 0)) return;
  els.keep.disabled = true;
  els.keepnote.textContent = "Keeping...";
  // The whole answer, every Keep going round of it; if an earlier round was
  // already kept, only what came after, marked as continuing that one.
  const from = state.keptUpTo;
  const r = await store.keep({
    at: state.record.at, itemId: state.item.id, outline: state.item.outline, question: state.item.question,
    ...(from ? { continues: state.answerAt } : {}), ...(state.passage && state.mode === "respond" ? { passage: state.passage.id, passageSource: state.passage.source } : {}),
    minutes: state.roundMinutes, seconds: secondsFor(), text: els.box.value.slice(from),
    nwam: state.score.nwam, gwam: state.score.gwam, accuracy: state.score.accuracy,
    // Where he stopped to think, by character offset: the expert can read
    // what came right before each stop as what he was deciding.
    pauses: state.score.think.stops, revisions: state.score.revisions,
  }).catch((e) => ({ ok: false, note: String(e) }));
  if (r && r.ok) {
    state.kept = true;
    state.keptUpTo = els.box.value.length;
    state.record.kept = true;
    store.saveHistory(data.history);
    els.keep.textContent = "Kept";
    els.keepnote.textContent = [r.corpus, r.expert].filter(Boolean).join(" ") || "Kept.";
  } else {
    els.keep.disabled = false;
    els.keepnote.textContent = (r && r.note) || "Could not keep it.";
  }
}

/* ---- wire ---------------------------------------------------------------- */
for (const b of els.mins) b.addEventListener("click", () => setMinutes(Number(b.dataset.drillMinutes)));
els.start.addEventListener("click", arm);
els.again.addEventListener("click", () => (state.mode === "copy" && state.phase === "done" ? armRespond() : arm()));
els.cont.addEventListener("click", continueRound);
for (const b of els.modes) b.addEventListener("click", () => setMode(b.dataset.drillMode));
els.home.addEventListener("click", home);
els.keep.addEventListener("click", keep);
for (const b of els.opens) b.addEventListener("click", () => openBoard(b.dataset.drillOpen));
for (const t of els.tabs) t.addEventListener("click", () => showTab(t.dataset.tab));
els.box.addEventListener("keydown", onShiftKey);
els.box.addEventListener("keyup", onShiftKey);
els.box.addEventListener("blur", () => shiftKeys.clear());
els.box.addEventListener("input", onInput);
els.box.addEventListener("keydown", onKeydown);
els.box.addEventListener("paste", onPaste);
document.addEventListener("keydown", (e) => {
  if (e.target === els.box || e.metaKey || e.ctrlKey || e.altKey) return;
  const inButton = e.target && e.target.tagName === "BUTTON";
  if (state.phase === "idle") {
    if (e.key === "Enter" && !inButton) { e.preventDefault(); arm(); }
    else if (/^[1-5]$/.test(e.key)) setMinutes(Number(e.key));
  } else if (state.phase === "done" || state.phase === "board") {
    if (e.key === "Enter" && !(inButton && e.target !== els.again)) { e.preventDefault(); if (state.phase === "done" && state.mode === "copy") armRespond(); else arm(); }
    else if (e.key.toLowerCase() === "k" && state.phase === "done") { e.preventDefault(); keep(); }
    else if (e.key.toLowerCase() === "c" && state.phase === "done") { e.preventDefault(); continueRound(); }
    else if (e.key === "Escape") { e.preventDefault(); home(); }
  }
});

async function init() {
  const loaded = await store.load();
  Object.assign(data, loaded);
  const last = data.history.length ? data.history[data.history.length - 1].minutes : null;
  state.minutes = Number(data.settings.minutes) || last || 1;
  setMode(data.settings.mode, false);
  renderChips();
  drawMap();
  els.start.focus();
  await wordsLoaded;
  store.ready({ bank: BANK.length, outline: ITEMS.length, words: WORDS ? WORDS.length : 0, history: data.history.length });
}
init();

// For tests and a look under the hood; never for the page's own flow.
window.NoteDrill = { state, data, BANK, scoreDrill, finish, known: () => knownNow(), garden, drawMap, renderBoard, openBoard };
