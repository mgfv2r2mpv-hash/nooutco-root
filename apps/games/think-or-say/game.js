/* ── Think or Say? ─────────────────────────────────────────────────────
   A scenario card presents a thought; the learner decides whether it is a
   THINK IT (keep it inside) or a SAY IT (kind / okay to say out loud).
   Pre-K / Kindergarten social-language target.
   No build step — plain static HTML/CSS/JS.

   The cards themselves live in card-model.js (the instructional universe and
   the one constructor every card goes through) and cards-level-{1,2,3}.js
   (three separate pools, one card to exactly one level), assembled and checked
   by cards.js. A Level selector chooses the pool; this file runs the trials.
   ----------------------------------------------------------------------- */

const CATEGORIES = {
  looks:   'How Someone Looks',
  smells:  'Smells',
  work:    'Their Work & Things',
  private: 'Private Things',
  kind:    'Kind Things to Say',
  other:   'Other Moments',
};

// ── The cards ──────────────────────────────────────────────────────────
// card-model.js owns the framing constants and the instructional universe;
// cards.js assembles the three level pools and checks their coverage at load.
const MODEL = window.ThinkOrSayModel;
const CARDS = window.ThinkOrSayCards;
// exemplar-generator.js renders probe items and fresh surfaces for
// re-presentations from criterial templates — never from a memory of what has
// already been shown, because that memory does not survive a cleared store.
const GEN = window.ThinkOrSayGenerator;
const LEAD_IN = MODEL.LEAD_IN;
const SAY_VERBS = MODEL.SAY_VERBS;
const balancedQuestion = MODEL.balancedQuestion;

// Optional teaching video for Learn mode. Set to an embeddable URL
// (e.g. 'https://www.youtube.com/embed/VIDEO_ID') to show a player above the
// written rule; leave empty to show the rule text only.
const LEARN_VIDEO_URL = '';

// ── DOM ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  selCategory:     $('sel-category'),
  selOrder:        $('sel-order'),
  btnExtraToggle:  $('btn-extra-toggle'),
  btnExtraClose:   $('btn-extra-close'),
  extraPanel:      $('extra-panel'),
  chkRepresent:    $('chk-represent-errors'),
  chkErrorless:    $('chk-errorless'),
  chkNoErrorAnim:  $('chk-no-error-anim'),
  chkAutoPrompt:   $('chk-auto-prompt'),
  chkPromptDelay:  $('chk-prompt-delay'),
  selPromptDelay:  $('sel-prompt-delay'),
  selPromptStyle:  $('sel-prompt-style'),
  chkShowReason:   $('chk-show-reason'),
  chkCounterbalance: $('chk-counterbalance'),
  selLevel:        $('sel-level'),
  levelBlurb:      $('level-blurb'),
  btnPrompt:       $('btn-prompt'),
  btnLearn:        $('btn-learn'),
  btnPlay:         $('btn-play'),
  gameIntro:       $('game-intro'),
  learnScreen:     $('learn-screen'),
  learnVideo:      $('learn-video'),
  btnLearnStart:   $('btn-learn-start'),
  gameArea:        $('game-area'),
  progressLabel:   $('progress-label'),
  scenarioSection: $('scenario-section'),
  choiceSection:   $('choice-section'),
  scenarioCard:    $('scenario-card'),
  situation:       $('scenario-situation'),
  thought:         $('scenario-thought'),
  question:        $('scenario-question'),
  reason:          $('scenario-reason'),
  revealPanel:     $('reveal-panel'),
  choiceLabel:     $('choice-label'),
  choices:         $('choices'),
  timerDisplay:    $('timer-display'),
  btnTimerToggle:  $('btn-timer-toggle'),
  btnTimerReset:   $('btn-timer-reset'),
  btnPrint:        $('btn-print'),
  btnClearData:    $('btn-clear-data'),
  printMeta:       $('print-meta'),
  resultsBody:     $('results-body'),
  printSummary:    $('print-summary'),
};
const choiceEls = () => Array.from(el.choices.querySelectorAll('.choice'));

// ── State ──────────────────────────────────────────────────────────────
const state = {
  // The programme parameters in force, normalized. Stage 7's DOM-as-state fix:
  // every runtime read used to reach into a control (`el.chkErrorless.checked`,
  // `el.selPromptDelay.value`), which made the *panel* the source of truth. The
  // controls are now a view of this object — written by
  // applySettingsToControls(), and read back only for the one control a
  // technician just changed. Populated by loadSettings() during init().
  cfg: null,
  deck: [],
  pos: 0,
  current: null,
  locked: false,           // a choice has been answered (awaiting Next)
  choicesRevealed: false,  // staff has tapped to show the choice tiles
  learnMode: false,
  trialErrors: 0,
  trialPrompted: false,
  represented: new Set(),  // scenario ids already re-presented
  promptTimer: null,
  // timer
  timerSecs: 0,
  timerRunning: false,
  timerHandle: null,
  trialStart: 0,
  // session results
  results: [],
};

// ── Settings persistence ───────────────────────────────────────────────
const SETTINGS_KEY = 'nooutco.settings.think-or-say';
const LEGACY_SETTINGS_KEY = 'tosSettings';
// Namespaced to match the other nine games. The bare `tosResults` key is
// retired but never deleted — loadResults() folds it forward on first run.
const RESULTS_KEY        = 'nooutco.results.think-or-say';
const LEGACY_RESULTS_KEY = 'tosResults';

/**
 * The programme parameters this game persists, declared ONCE (Stage 6).
 *
 * `../game-settings.js` derives both the defaults and the clamping from this
 * single declaration, so there is no second hand-written description of the
 * schema to drift out of sync with it.
 *
 * `category` is an enum rather than a free string because an unoffered value is
 * worse here than an out-of-range one: a stored category naming a set of cards
 * that no longer exists leaves the select showing nothing AND makes `buildDeck`
 * match zero scenarios, so the game cannot start at all. The honest fallback is
 * the "All categories" the panel can actually show.
 *
 * `autoPrompt` defaults to FALSE here — it is true only in `sequences`. That
 * difference is clinical, not accidental; do not harmonise it.
 */
const SETTINGS_FIELDS = {
  // Which teaching pool is in play. An int rather than an enum because the
  // select hands back a string and `int` parses it; the range is the levels
  // that exist, so a stored 4 clamps to 3 rather than emptying the deck.
  level:           { type: 'int',  min: 1, max: 3, default: 1 },
  category:        { type: 'enum', values: ['all'].concat(Object.keys(CATEGORIES)), default: 'all' },
  order:           { type: 'enum', values: ['shuffle', 'sequential'], default: 'shuffle' },
  represent:       { type: 'bool', default: true },
  errorless:       { type: 'bool', default: false },
  noErrorAnim:     { type: 'bool', default: false },
  autoPrompt:      { type: 'bool', default: false },
  promptDelay:     { type: 'bool', default: false },
  // The select offers 1/2/3/4/5/10 s, so its ceiling of 10 is renderable and a
  // range is honest here (an enum would be too, but the platform-wide spelling
  // of this field in eight other games is `int {min:1, max:10}`).
  promptDelaySecs: { type: 'int',  min: 1, max: 10, default: 3 },
  promptStyle:     { type: 'enum', values: ['sparkle', 'outline'], default: 'sparkle' },
  showReason:      { type: 'bool', default: true },
  // Tile POSITIONS alternate between trials so that "the correct one is on the
  // left" cannot become the discriminative stimulus. Defaults ON; a plan that
  // specifies a fixed array (early acquisition, or a learner with a scanning
  // target) turns it off.
  counterbalance:  { type: 'bool', default: true },
};

const settingsStore = window.NooutcoSettings.defineStore({
  key: SETTINGS_KEY,
  legacyKey: LEGACY_SETTINGS_KEY,
  fields: SETTINGS_FIELDS,
});

/**
 * Read-then-fold. Two retired options, neither of them deleted anywhere.
 *
 * `promptDelaySec` — `tosSettings` spelled the prompt delay singular and stored
 * it as a STRING, a third spelling of the option eight other games call
 * `promptDelaySecs`. The fold renames it forward; `tosSettings` itself keeps its
 * own key, its own spelling and its own string, untouched.
 *
 * `includeTricky` — the "Include Tricky / Reasoning Cards" checkbox is
 * superseded by the Level selector. Its tricky cards were the nuanced,
 * context-decides ones, so a stored `true` folds forward onto Level 2 and a
 * stored `false` onto Level 1. A configuration that already names a level keeps
 * it: the retired option never overrides a live one.
 */
function foldRetiredSettings(stored) {
  const { promptDelaySec, includeTricky, ...rest } = stored;
  const folded = { ...rest };
  if (promptDelaySec != null) folded.promptDelaySecs = promptDelaySec;
  if (folded.level == null && includeTricky != null) folded.level = includeTricky ? 2 : 1;
  return folded;
}

/**
 * Each panel control, the option it edits, and how its value is read.
 *
 * One row per persisted option, so a control can never edit an option the
 * field spec does not declare (and vice versa — asserted by the settings
 * store's own normalize()). Reading a control happens here and nowhere else.
 */
const SETTINGS_CONTROLS = [
  { node: 'selLevel',         option: 'level',           read: n => n.value,   write: (n, v) => { n.value = String(v); } },
  { node: 'selCategory',      option: 'category',        read: n => n.value,   write: (n, v) => { n.value = v; } },
  { node: 'selOrder',         option: 'order',           read: n => n.value,   write: (n, v) => { n.value = v; } },
  { node: 'chkRepresent',     option: 'represent',       read: n => n.checked, write: (n, v) => { n.checked = v; } },
  { node: 'chkErrorless',     option: 'errorless',       read: n => n.checked, write: (n, v) => { n.checked = v; } },
  { node: 'chkNoErrorAnim',   option: 'noErrorAnim',     read: n => n.checked, write: (n, v) => { n.checked = v; } },
  { node: 'chkAutoPrompt',    option: 'autoPrompt',      read: n => n.checked, write: (n, v) => { n.checked = v; } },
  { node: 'chkPromptDelay',   option: 'promptDelay',     read: n => n.checked, write: (n, v) => { n.checked = v; } },
  { node: 'selPromptDelay',   option: 'promptDelaySecs', read: n => n.value,   write: (n, v) => { n.value = v; } },
  { node: 'selPromptStyle',   option: 'promptStyle',     read: n => n.value,   write: (n, v) => { n.value = v; } },
  { node: 'chkShowReason',    option: 'showReason',      read: n => n.checked, write: (n, v) => { n.checked = v; } },
  { node: 'chkCounterbalance',option: 'counterbalance',  read: n => n.checked, write: (n, v) => { n.checked = v; } },
];

/** Render the panel from the configuration in force, so the two cannot diverge. */
function applySettingsToControls(cfg) {
  for (const c of SETTINGS_CONTROLS) c.write(el[c.node], cfg[c.option]);
  syncPromptDelayEnabled();
  el.levelBlurb.textContent = CARDS.level(cfg.level).blurb;
  // A programmatic write fires no `change` event, so the prompting-method group
  // has to be told to re-read the two switches it summarises.
  if (window.NooutcoPrompting) window.NooutcoPrompting.refresh();
}

function loadSettings() {
  // Read-then-fold, never drop. Runs at most once; `tosSettings` is left intact.
  settingsStore.foldLegacy({ map: foldRetiredSettings });
  state.cfg = settingsStore.normalize(foldRetiredSettings(rawStoredConfig()));
  applySettingsToControls(state.cfg);
}

/**
 * The configuration as STORED, before normalize() drops the keys this build no
 * longer declares. `initial()` normalizes on the way out, which is right for
 * every live option and wrong for a retired one: a `includeTricky` sitting in
 * the store would be dropped before the fold could read it, silently sending a
 * technician who had tricky cards on back to Level 1. Mirrors the store's own
 * working → last saved set → defaults chain.
 */
function rawStoredConfig() {
  const store = settingsStore.load();
  const lastSet = store.last && store.sets ? store.sets[store.last] : null;
  return store.working || lastSet || settingsStore.defaults();
}

/**
 * Fold one control's edit into the configuration and persist it.
 *
 * Only the control the technician just touched is read — a control whose value
 * changed without a `change` event (the browser restoring form state across a
 * reload, most commonly) is not a technician decision and must not silently
 * become one. `normalize()` re-clamps the whole config using the same
 * declaration the load path uses, so the select's string becomes the store's
 * int, and re-rendering the panel afterwards makes any clamp visible rather
 * than leaving the panel showing a value that is not in force.
 */
function editSetting(control) {
  const raw = Object.assign({}, state.cfg, { [control.option]: control.read(el[control.node]) });
  state.cfg = settingsStore.normalize(raw);
  settingsStore.saveWorking(state.cfg);
  applySettingsToControls(state.cfg);
}

/** Persist the configuration in force, unchanged. */
function saveSettings() {
  settingsStore.saveWorking(state.cfg);
}

function syncPromptDelayEnabled() {
  const on = state.cfg.autoPrompt;
  el.chkPromptDelay.disabled = !on;
  el.selPromptDelay.disabled = !on || !state.cfg.promptDelay;
}

// ── Category dropdown ──────────────────────────────────────────────────
function populateCategories() {
  const opts = ['<option value="all">All categories</option>'];
  for (const [key, label] of Object.entries(CATEGORIES)) {
    opts.push(`<option value="${key}">${label}</option>`);
  }
  el.selCategory.innerHTML = opts.join('');
}

// ── Utility ────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Build deck ─────────────────────────────────────────────────────────
/**
 * The deck is the level's own pool, optionally narrowed to one category.
 *
 * A card belongs to exactly one level, so the level selector chooses the pool
 * outright rather than filtering a single flat deck — that is what makes the
 * coverage guarantees (≥3 exemplars per criterial dimension, one matched
 * minimum-difference pair per dimension) properties of what the learner
 * actually sees.
 *
 * Under `sequential` the authored array order IS the trial order, and that
 * order is load-bearing: see positionTiles().
 */
function buildDeck() {
  const cat = state.cfg.category;
  let pool = CARDS.level(state.cfg.level).cards
    .filter(s => cat === 'all' || s.cat === cat);
  if (state.cfg.order === 'shuffle') pool = shuffle(pool);
  state.deck = pool;
  state.pos = 0;
  state.represented = new Set();
}

// ── Start ──────────────────────────────────────────────────────────────
function beginSession(mode) {
  saveSettings();
  buildDeck();
  if (!state.deck.length) {
    alert('No cards match these settings. Try a different category, or another level.');
    return;
  }
  state.results = [];
  saveResults();
  state.learnMode = (mode === 'learn');
  el.gameIntro.hidden = true;
  removeDoneCard();
  if (state.learnMode) {
    showLearnScreen();
  } else {
    enterTrials();
  }
}

// Learn mode: teaching screen first, then the practice trials.
function showLearnScreen() {
  el.gameArea.hidden = true;
  el.btnPrompt.hidden = true;
  if (LEARN_VIDEO_URL) {
    el.learnVideo.innerHTML =
      '<iframe src="' + LEARN_VIDEO_URL + '" title="Think it or Say it" ' +
      'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" ' +
      'allowfullscreen></iframe>';
    el.learnVideo.hidden = false;
  } else {
    el.learnVideo.innerHTML = '';
    el.learnVideo.hidden = true;
  }
  el.learnScreen.hidden = false;
}

function enterTrials() {
  el.learnScreen.hidden = true;
  el.learnVideo.innerHTML = '';     // stop any playing video
  el.gameArea.hidden = false;
  el.btnPrompt.hidden = false;
  resetTimer();
  renderTrial();
}

// ── Render a trial ─────────────────────────────────────────────────────
function renderTrial() {
  clearPromptTimer();
  removeNextButton();
  removeDoneCard();
  el.scenarioSection.hidden = false;
  el.choiceSection.hidden = false;

  state.current = state.deck[state.pos];
  state.locked = false;
  state.choicesRevealed = false;
  state.trialErrors = 0;
  state.trialPrompted = false;

  const sc = state.current;
  el.progressLabel.textContent = `Card ${state.pos + 1} of ${state.deck.length}`;
  el.situation.textContent = sc.situation;
  renderThought(sc);
  el.question.textContent = sc.question;

  el.reason.hidden = true;
  el.reason.className = '';

  choiceEls().forEach(c => {
    c.className = 'choice choice-' + c.dataset.answer;
    c.disabled = false;
  });
  positionTiles();

  // Show the scenario to be read first. The choice tiles and the trial timer
  // wait until staff taps the reveal panel.
  el.choices.hidden = true;
  el.choiceLabel.hidden = true;
  el.revealPanel.hidden = false;
  el.btnPrompt.disabled = true;
  resetTimer();
}

// Staff taps the reveal panel once the card has been read aloud: the choice
// tiles appear and the per-trial timer (and any auto-prompt) starts now.
function revealChoices() {
  if (state.choicesRevealed || state.locked) return;
  state.choicesRevealed = true;
  el.revealPanel.hidden = true;
  el.choiceLabel.hidden = false;
  el.choices.hidden = false;
  el.btnPrompt.disabled = false;
  state.trialStart = Date.now();
  resetTimer();
  startTimer();
  if (state.cfg.autoPrompt) scheduleAutoPrompt();
}

/**
 * The lead-in and the candidate utterance.
 *
 * Built as nodes rather than as markup: the utterance is authored content that
 * has already been through `makeCard`, and putting it in the DOM as text means
 * there is no escaping step that a later card can be written to slip past.
 */
function renderThought(sc) {
  const lead = document.createElement('span');
  lead.className = 'lead-in';
  lead.textContent = sc.leadIn;
  const quote = document.createElement('span');
  quote.className = 'quote';
  quote.textContent = '“' + sc.utterance + '”';
  el.thought.replaceChildren(lead, quote);
}

/**
 * Counterbalance the tile POSITIONS between trials.
 *
 * The labels never move — THINK IT is always the brain tile and SAY IT always
 * the mouth tile — so the response topography is constant. Only which side each
 * sits on alternates, strictly, on the trial index.
 *
 * What that alternation guarantees is narrow, and worth stating exactly: each
 * POSITION holds each TILE equally often. It says NOTHING about which side is
 * CORRECT. Which side is correct is the interaction between this alternation
 * and the pool's own run of answers — and if a pool's answers ever alternate
 * with the same period as the tiles, the correct tile lands on the same side on
 * every single trial. That is a perfect position cue: precisely the faulty
 * stimulus control this rebuild exists to prevent.
 *
 * So the property is not asserted here, because it is not a property of this
 * function: it belongs to the AUTHORED ORDER of each pool. It is measured
 * instead — think-or-say-levels.spec.js walks every level pool in sequential
 * order with this setting on, counts how often the correct tile lands on each
 * side, and fails if either side holds it more than 65% of the time.
 */
function positionTiles() {
  const tiles = choiceEls();
  const think = tiles.find(c => c.dataset.answer === 'think');
  const say   = tiles.find(c => c.dataset.answer === 'say');
  if (!think || !say) return;
  const sayFirst = state.cfg.counterbalance && (state.pos % 2 === 1);
  el.choices.replaceChildren(...(sayFirst ? [say, think] : [think, say]));
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// ── Choice handling ────────────────────────────────────────────────────
function onChoiceClick(e) {
  const card = e.currentTarget;
  if (state.locked) return;
  if (card.disabled) return;

  const chosen = card.dataset.answer;
  const correct = state.current.answer;

  if (chosen === correct) {
    answerCorrect(card);
  } else {
    answerWrong(card);
  }
}

function answerCorrect(card) {
  state.locked = true;
  if (window.__nooutcoTokens) window.__nooutcoTokens.award();
  pauseTimer();                 // stop the per-trial timer on the correct response
  clearPromptTimer();
  clearPromptHighlight();
  choiceEls().forEach(c => {
    c.classList.add('locked');
    c.disabled = true;
    if (c !== card) c.classList.add('dim');
  });
  card.classList.remove('prompt-sparkle', 'prompt-outline');
  card.classList.add('correct');

  recordResult();
  if (state.cfg.showReason || state.learnMode) showReason();
  showNextButton();
}

function answerWrong(card) {
  state.trialErrors++;
  if (!state.cfg.noErrorAnim) {
    card.classList.remove('wiggle', 'flash-red');
    void card.offsetWidth;            // restart animation
    card.classList.add('wiggle', 'flash-red');
    card.classList.add('wrong');
    setTimeout(() => {
      card.classList.remove('wiggle', 'flash-red', 'wrong');
    }, 520);
  }
  // In errorless mode, disable the wrong choice so only the correct one remains.
  if (state.cfg.errorless) {
    card.disabled = true;
    card.classList.add('locked', 'dim');
    // Surface the correct answer as a prompt.
    doPrompt();
  }
}

// ── Reason ─────────────────────────────────────────────────────────────
function showReason() {
  el.reason.textContent = state.current.reason;
  el.reason.className = state.current.answer === 'think' ? 'reason-think' : 'reason-say';
  el.reason.hidden = false;
}

// ── Prompt ─────────────────────────────────────────────────────────────
function doPrompt() {
  if (state.locked || !state.choicesRevealed) return;
  const style = state.cfg.promptStyle === 'outline' ? 'prompt-outline' : 'prompt-sparkle';
  clearPromptHighlight();
  const target = choiceEls().find(c => c.dataset.answer === state.current.answer);
  if (target && !target.disabled) target.classList.add(style);
  state.trialPrompted = true;
}

function clearPromptHighlight() {
  choiceEls().forEach(c => c.classList.remove('prompt-sparkle', 'prompt-outline'));
}

function scheduleAutoPrompt() {
  clearPromptTimer();
  // `promptDelaySecs` is already an int here: the store clamps it on load and
  // editSetting() re-normalizes the select's string on every edit. Reading the
  // control instead used to hand `parseInt('')` — NaN, which setTimeout treats
  // as 0 — to the learner as an instant prompt whenever the stored value was
  // one the select could not display.
  const delay = state.cfg.promptDelay ? state.cfg.promptDelaySecs * 1000 : 0;
  state.promptTimer = setTimeout(() => { if (!state.locked) doPrompt(); }, delay);
}

function clearPromptTimer() {
  if (state.promptTimer) { clearTimeout(state.promptTimer); state.promptTimer = null; }
}

// ── Next / advance ─────────────────────────────────────────────────────
function showNextButton() {
  removeNextButton();
  const btn = document.createElement('button');
  btn.id = 'btn-next';
  btn.type = 'button';
  const isLast = state.pos + 1 >= state.deck.length;
  btn.textContent = (isLast && !willRepresent()) ? 'Finish' : 'Next →';
  btn.addEventListener('click', nextTrial);
  el.choiceSection.appendChild(btn);
}

function removeNextButton() {
  const b = $('btn-next');
  if (b) b.remove();
}

// Will the current card be re-queued at the end of the deck?
function willRepresent() {
  const sc = state.current;
  const missed = state.trialErrors > 0 || state.trialPrompted;
  return missed && state.cfg.represent && !state.represented.has(sc.id);
}

function nextTrial() {
  // Re-present a missed card once, at the end of the deck — with a FRESH
  // SURFACE where the generator carries the card's criterial configuration.
  // Same criterial item, different person, place or thing, so the repeat cannot
  // be passed on a memorised surface feature. A card whose configuration no
  // template holds comes back unchanged rather than becoming a different card.
  const sc = state.current;
  if (willRepresent()) {
    state.represented.add(sc.id);
    state.deck.push((GEN && GEN.represent(sc, state.deck.length)) || sc);
  }
  state.pos++;
  if (state.pos >= state.deck.length) {
    finishSession();
  } else {
    renderTrial();
  }
}

// ── Finish ─────────────────────────────────────────────────────────────
function finishSession() {
  pauseTimer();
  clearPromptTimer();
  removeNextButton();
  el.scenarioSection.hidden = true;
  el.choiceSection.hidden = true;
  el.progressLabel.textContent = '';

  const total = state.results.length;
  const firstTry = state.results.filter(r => r.errors === 0 && !r.prompted).length;

  removeDoneCard();
  const card = document.createElement('div');
  card.id = 'done-card';
  card.innerHTML =
    '<div class="done-emoji">🎉</div>' +
    '<h2>Set complete!</h2>' +
    `<p>${firstTry} of ${total} correct on the first try.</p>` +
    '<button type="button" id="btn-again">Play again</button>';
  el.gameArea.appendChild(card);
  $('btn-again').addEventListener('click', () => beginSession('play'));
}

function removeDoneCard() {
  const d = $('done-card');
  if (d) d.remove();
}

// ── Results / data ─────────────────────────────────────────────────────
function recordResult() {
  const sc = state.current;
  const secs = Math.max(0, Math.round((Date.now() - state.trialStart) / 1000));
  let outcome = 'ok';
  if (state.trialPrompted) outcome = 'prompted';
  else if (state.trialErrors > 0) outcome = 'error';
  const row = {
    level: sc.level,
    cat: CATEGORIES[sc.cat] || sc.cat,
    scenario: sc.situation,
    answer: sc.answer === 'think' ? 'THINK IT' : 'SAY IT',
    errors: state.trialErrors,
    prompted: state.trialPrompted,
    secs,
    outcome,
  };
  if (window.NooutcoResults) {
    NooutcoResults.record(
      RESULTS_KEY, state.results, row,
      { autoPrompt: state.cfg.autoPrompt, promptDelay: state.cfg.promptDelay },
      state.trialPrompted,
    );
  } else {
    state.results.push(row);
    saveResults();
  }
}

function saveResults() {
  if (window.NooutcoResults) { NooutcoResults.save(RESULTS_KEY, state.results); return; }
  try { localStorage.setItem(RESULTS_KEY, JSON.stringify(state.results)); } catch (e) {}
}

/**
 * Load the trial record, folding the retired bare `tosResults` key forward on
 * first run. Read-then-fold: the old key is left in place rather than deleted,
 * so a technician who reverts to an older build still has their session.
 */
function loadResults() {
  if (window.NooutcoResults) {
    state.results = NooutcoResults.load(RESULTS_KEY);
    if (!state.results.length) {
      let legacy = [];
      try { legacy = JSON.parse(localStorage.getItem(LEGACY_RESULTS_KEY) || '[]'); } catch (e) { legacy = []; }
      if (Array.isArray(legacy) && legacy.length) {
        state.results = legacy;
        NooutcoResults.save(RESULTS_KEY, state.results);
      }
    }
    return;
  }
  try { state.results = JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]'); } catch (e) { state.results = []; }
}

function buildPrint() {
  const rows = state.results.map((r, i) => {
    const outClass = 'outcome-' + r.outcome;
    const outLabel = r.outcome === 'ok' ? 'Independent'
                   : r.outcome === 'prompted' ? 'Prompted' : 'Error then correct';
    return `<tr>
      <td>${i + 1}</td>
      <td>${r.level == null ? '—' : r.level}</td>
      <td>${r.cat}</td>
      <td>${escapeHtml(r.scenario)}</td>
      <td>${r.answer}</td>
      <td>${r.errors}</td>
      <td>${r.prompted ? 'Yes' : 'No'}</td>
      <td>${r.secs}</td>
      <td class="${outClass}">${outLabel}</td>
    </tr>`;
  }).join('');
  el.resultsBody.innerHTML = rows;

  const total = state.results.length;
  const indep = state.results.filter(r => r.outcome === 'ok').length;
  const prompted = state.results.filter(r => r.prompted).length;
  const errs = state.results.reduce((a, r) => a + r.errors, 0);
  const d = new Date();
  el.printMeta.textContent = `${d.toLocaleDateString()} ${d.toLocaleTimeString()} — ${total} cards`;
  el.printSummary.innerHTML =
    `<span><strong>Independent:</strong> ${indep}/${total}</span>` +
    `<span><strong>Prompted:</strong> ${prompted}</span>` +
    `<span><strong>Total errors:</strong> ${errs}</span>`;
}

function printData() {
  if (!state.results.length) { alert('No session data yet. Play some cards first.'); return; }
  buildPrint();
  window.print();
}

function clearData() {
  if (!confirm('Clear all recorded session data?')) return;
  state.results = [];
  saveResults();
  alert('Session data cleared.');
}

// ── Timer ──────────────────────────────────────────────────────────────
function startTimer() {
  if (state.timerRunning) return;
  state.timerRunning = true;
  el.btnTimerToggle.textContent = 'Pause';
  state.timerHandle = setInterval(() => { state.timerSecs++; renderTimer(); }, 1000);
}
function pauseTimer() {
  if (!state.timerRunning) return;
  state.timerRunning = false;
  el.btnTimerToggle.textContent = 'Resume';
  clearInterval(state.timerHandle);
}
function toggleTimer() { state.timerRunning ? pauseTimer() : startTimer(); }
function resetTimer() {
  pauseTimer();
  state.timerSecs = 0;
  renderTimer();
}
function renderTimer() {
  const m = String(Math.floor(state.timerSecs / 60)).padStart(2, '0');
  const s = String(state.timerSecs % 60).padStart(2, '0');
  el.timerDisplay.textContent = `${m}:${s}`;
}

// ── Wiring ─────────────────────────────────────────────────────────────
function init() {
  if (window.NooutcoConfig) NooutcoConfig.migrate();
  populateCategories();
  loadSettings();
  loadResults();

  el.btnLearn.addEventListener('click', () => beginSession('learn'));
  el.btnPlay.addEventListener('click', () => beginSession('play'));
  el.btnLearnStart.addEventListener('click', enterTrials);
  el.btnPrompt.addEventListener('click', doPrompt);

  el.revealPanel.addEventListener('click', revealChoices);
  choiceEls().forEach(c => c.addEventListener('click', onChoiceClick));

  // Extra panel
  el.btnExtraToggle.addEventListener('click', () => {
    const open = el.extraPanel.hidden;
    el.extraPanel.hidden = !open;
    el.btnExtraToggle.classList.toggle('is-open', open);
    el.btnExtraToggle.setAttribute('aria-expanded', String(open));
  });
  el.btnExtraClose.addEventListener('click', () => {
    el.extraPanel.hidden = true;
    el.btnExtraToggle.classList.remove('is-open');
    el.btnExtraToggle.setAttribute('aria-expanded', 'false');
  });

  // Persist settings on change — one control at a time, so only the option the
  // technician actually edited is read back off the panel.
  for (const control of SETTINGS_CONTROLS) {
    el[control.node].addEventListener('change', () => editSetting(control));
  }

  // Timer
  el.btnTimerToggle.addEventListener('click', toggleTimer);
  el.btnTimerReset.addEventListener('click', resetTimer);

  // Data
  el.btnPrint.addEventListener('click', printData);
  el.btnClearData.addEventListener('click', clearData);
}

/**
 * A read-only view of the three pools, the instructional universe they were
 * built against, and the framing every card carries.
 *
 * `card-model.js` enforces the per-card invariants and `cards.js` the per-pool
 * ones, both at module load; this is how the Playwright specs assert them
 * across EVERY pool from the data rather than one card at a time through the
 * UI. Nothing here is player data and nothing here is written back.
 */
window.__thinkOrSay = Object.freeze({
  cards: CARDS.ALL,
  levels: CARDS.LEVELS,
  level: CARDS.level,
  minExemplarsPerDimension: CARDS.MIN_EXEMPLARS_PER_DIMENSION,
  dimensions: MODEL.DIMENSION_KEYS.slice(),
  canHave: MODEL.CAN_HAVE_KEYS.slice(),
  leadIn: LEAD_IN,
  sayVerbs: SAY_VERBS.slice(),
  balancedQuestion,
  // The exemplar generator, so the spec can enumerate the whole finite space it
  // can produce rather than sampling it through the UI.
  generator: GEN,
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
