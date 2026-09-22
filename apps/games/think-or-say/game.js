/* ── Think or Say? ─────────────────────────────────────────────────────
   A scenario card presents a thought; the learner decides whether it is a
   THINK IT (keep it inside) or a SAY IT (kind / okay to say out loud).
   Pre-K / Kindergarten social-language target.
   No build step - plain static HTML/CSS/JS.

   The cards themselves live in card-model.js (the instructional universe and
   the one constructor every card goes through) and cards-level-{1,2,3}.js
   (three separate pools, one card to exactly one level), assembled and checked
   by cards.js. A Level selector chooses the pool; this file runs the trials.
   ----------------------------------------------------------------------- */

/** The two tile labels, in the one spelling the tiles, the report and the rule use. */
const ANSWER_LABELS = { think: 'THINK IT', say: 'SAY IT' };

const CATEGORIES = {
  looks:   'How Someone Looks',
  smells:  'Smells',
  work:    'Their Work & Things',
  private: 'Private Things',
  kind:    'Kind Things to Say',
  other:   'Other Moments',
};

/**
 * The three ways a spoken reason is scored at Level 3, declared once.
 *
 * Scoring is INDEPENDENT of the exemplar rationales the card carries: the
 * technician is not picking which exemplar the learner matched, they are
 * judging what the learner actually said. A correct reason nobody wrote down
 * is the ideal outcome and scores fully Correct (RESEARCH.md §6, "Level 3").
 *
 * Three points, not more: a finer scale asks the technician for a judgement the
 * Skill Acquisition Plan has not defined, and mid-shift it would not be applied
 * the same way twice. The free-text note carries anything the three points
 * cannot, and it is optional because a required note becomes a copied one.
 */
const RATIONALE_SCORES = ['correct', 'partial', 'not-yet'];
const RATIONALE_LABELS = {
  correct:   'Correct',
  partial:   'Partly correct',
  'not-yet': 'Not yet',
};

// ── The cards ──────────────────────────────────────────────────────────
// card-model.js owns the framing constants and the instructional universe;
// cards.js assembles the three level pools and checks their coverage at load.
const MODEL = window.ThinkOrSayModel;
const CARDS = window.ThinkOrSayCards;
// exemplar-generator.js renders probe items and fresh surfaces for
// re-presentations from criterial templates - never from a memory of what has
// already been shown, because that memory does not survive a cleared store.
const GEN = window.ThinkOrSayGenerator;
// probes.js owns tagging, selection and placement; this file owns the running
// session - which supports a probe trial withholds, and how each trial is
// classified once it has been answered.
const PROBES = window.ThinkOrSayProbes;
// staff-guide.js is the single source for the technician guide. It renders the
// in-game Guide screen and the standalone download through the same
// buildBody(), so this file only decides WHEN to show it and never what it says.
const GUIDE = window.ThinkOrSayGuide;
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
  selLearner:      $('sel-learner'),
  levelBlurb:      $('level-blurb'),
  probeLevelLabel: $('probe-level-label'),
  probeBanner:     $('probe-banner'),
  chkShowRule:     $('chk-show-rule'),
  rulePanel:       $('rule-panel'),
  ruleTitle:       $('rule-title'),
  ruleLead:        $('rule-lead'),
  ruleBody:        $('rule-body'),
  ruleTip:         $('rule-tip'),
  printGen:        $('print-generalization'),
  genBody:         $('generalization-body'),
  btnPrompt:       $('btn-prompt'),
  btnLearn:        $('btn-learn'),
  btnPlay:         $('btn-play'),
  btnGuide:        $('btn-guide'),
  btnGuideDownload: $('btn-guide-download'),
  btnGuideClose:   $('btn-guide-close'),
  btnGuideCloseFoot: $('btn-guide-close-foot'),
  guideScreen:     $('guide-screen'),
  guideBody:       $('guide-body'),
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
  whyPanel:        $('why-panel'),
  whyVerdict:      $('why-verdict'),
  whyRows:         $('why-rows'),
  whyFlip:         $('why-flip'),
  whyTiers:        $('why-tiers'),
  revealPanel:     $('reveal-panel'),
  choiceLabel:     $('choice-label'),
  choices:         $('choices'),
  rationalePanel:    $('rationale-panel'),
  rationaleReveal:   $('btn-rationale-reveal'),
  rationaleExamples: $('rationale-examples'),
  rationaleList:     $('rationale-examples-list'),
  rationaleScores:   $('rationale-scores'),
  rationaleNote:     $('rationale-note'),
  timerDisplay:    $('timer-display'),
  btnTimerToggle:  $('btn-timer-toggle'),
  btnTimerReset:   $('btn-timer-reset'),
  btnPrint:        $('btn-print'),
  btnClearData:    $('btn-clear-data'),
  printMeta:       $('print-meta'),
  resultsBody:     $('results-body'),
  printSummary:    $('print-summary'),
};
// One probe block per level, each with its own persisted settings. The nodes are
// registered on `el` under the same names the SETTINGS_CONTROLS rows use, so a
// probe control is read and written exactly the way every other control is.
const PROBE_LEVELS = [1, 2, 3];
for (const L of PROBE_LEVELS) {
  el['chkProbes' + L]       = $('chk-probes-' + L);
  el['selProbeCount' + L]   = $('sel-probe-count-' + L);
  el['selProbePlace' + L]   = $('sel-probe-placement-' + L);
  el['probeTags' + L]       = $('probe-tags-' + L);
  el['chkProbeTokens' + L]  = $('chk-probe-tokens-' + L);
  el['probeLevel' + L]      = $('probe-level-' + L);
}
const choiceEls = () => Array.from(el.choices.querySelectorAll('.choice'));

// ── State ──────────────────────────────────────────────────────────────
const state = {
  // The programme parameters in force, normalized. Stage 7's DOM-as-state fix:
  // every runtime read used to reach into a control (`el.chkErrorless.checked`,
  // `el.selPromptDelay.value`), which made the *panel* the source of truth. The
  // controls are now a view of this object - written by
  // applySettingsToControls(), and read back only for the one control a
  // technician just changed. Populated by loadSettings() during init().
  cfg: null,
  deck: [],
  pos: 0,
  current: null,
  locked: false,           // a choice has been answered (awaiting Next)
  choicesRevealed: false,  // staff has tapped to show the choice tiles
  learnMode: false,
  // What was on screen when the Guide was opened, so closing it puts the
  // session back exactly as it was rather than dropping the technician on the
  // intro mid-deck. Null whenever the Guide is closed.
  guideReturn: null,
  shelfBanked: false,      // this session's rules already added to the learner's shelf
  trialErrors: 0,
  trialPrompted: false,
  // Latency, snapshotted the instant the learner answers. At Level 3 the trial
  // is not recorded until the technician has scored the spoken reason, and the
  // seconds that scoring takes are the technician's, not the learner's.
  trialSecs: 0,
  // The Level 3 rationale score for the trial on screen, '' until scored.
  rationaleScore: '',
  recorded: false,         // this trial has been written to the record
  represented: new Set(),  // scenario ids already re-presented
  // Probe lifecycle, per session. A generated item yields its generalization
  // datum ONCE; after that it is a trained target and every later run of it is
  // an ordinary trained trial. Nothing is discarded and nothing is uncounted.
  probeSeen: new Set(),
  probeTrial: false,       // the card on screen is a probe (supports withheld)
  learner: 'A',            // opaque settings slot - never a name, never an id
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
// retired but never deleted - loadResults() folds it forward on first run.
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
 * `autoPrompt` defaults to FALSE here - it is true only in `sequences`. That
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
  // Whether the level's stated rule stays on screen during the trial. Defaults
  // ON, and only Level 1 declares a rule to state, so the switch is a way to
  // FADE the support once the rule is held rather than a way to opt into it:
  // an early-acquisition learner should not have to have it turned on for them.
  showRule:        { type: 'bool', default: true },
  // Tile POSITIONS alternate between trials so that "the correct one is on the
  // left" cannot become the discriminative stimulus. Defaults ON; a plan that
  // specifies a fixed array (early acquisition, or a learner with a scanning
  // target) turns it off.
  counterbalance:  { type: 'bool', default: true },
};

/**
 * The probe block, declared once per level.
 *
 * PER LEVEL because a generalization phase is a phase of one level's programme:
 * a learner probing far items at Level 1 and not probing at all at Level 3 is an
 * ordinary state of affairs, and one shared block would make it unsayable. The
 * fields are flat and level-suffixed rather than nested so the shared store's
 * declarative clamping applies to each of them unchanged.
 *
 * `probesN` defaults FALSE at every level. Probes only run when the Skill
 * Acquisition Plan calls for a generalization phase.
 *
 * `probeTagsN` is a LIST, not an enum: near / far / deictic combine, and an item
 * can be far AND deictic. Level 3's default carries `deictic` because every
 * Level 3 item has it - the response required there is a spoken rationale - so
 * a Level 3 selection without it puts nothing in play.
 *
 * `probeTokensN` is a technician setting and defaults ON: withholding
 * reinforcement is a clinical decision that belongs to the plan, not a side
 * effect of switching probes on.
 */
for (const L of PROBE_LEVELS) {
  SETTINGS_FIELDS['probes' + L]        = { type: 'bool', default: false };
  SETTINGS_FIELDS['probeCount' + L]    = { type: 'int',  min: 1, max: 10, default: 3 };
  SETTINGS_FIELDS['probePlacement' + L] = { type: 'enum', values: PROBES.PLACEMENTS.slice(), default: 'interleaved' };
  SETTINGS_FIELDS['probeTags' + L]     = {
    type: 'list', values: PROBES.TAGS.slice(),
    default: L === 3 ? ['near', 'far', 'deictic'] : ['near', 'far'],
  };
  SETTINGS_FIELDS['probeTokens' + L]   = { type: 'bool', default: true };
}

const settingsStore = window.NooutcoSettings.defineStore({
  key: SETTINGS_KEY,
  legacyKey: LEGACY_SETTINGS_KEY,
  fields: SETTINGS_FIELDS,
});

/**
 * Read-then-fold. Two retired options, neither of them deleted anywhere.
 *
 * `promptDelaySec` - `tosSettings` spelled the prompt delay singular and stored
 * it as a STRING, a third spelling of the option eight other games call
 * `promptDelaySecs`. The fold renames it forward; `tosSettings` itself keeps its
 * own key, its own spelling and its own string, untouched.
 *
 * `includeTricky` - the "Include Tricky / Reasoning Cards" checkbox is
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
 * field spec does not declare (and vice versa - asserted by the settings
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
  { node: 'chkShowRule',      option: 'showRule',        read: n => n.checked, write: (n, v) => { n.checked = v; } },
  { node: 'chkCounterbalance',option: 'counterbalance',  read: n => n.checked, write: (n, v) => { n.checked = v; } },
];

/**
 * The probe rows, one per persisted probe option - fifteen of them, five per
 * level. Generated from the same list the fields are, so a level can never have
 * a field the panel cannot edit or a control the store does not persist.
 *
 * The tag control is a GROUP of checkboxes read as one array, because the option
 * it edits is one list. A `change` on any checkbox in the group bubbles to the
 * container, so the group behaves as a single control and the whole set is read
 * back together.
 */
const tagBoxes = n => Array.from(n.querySelectorAll('input[type=checkbox]'));
for (const L of PROBE_LEVELS) {
  SETTINGS_CONTROLS.push(
    { node: 'chkProbes' + L,      option: 'probes' + L,         read: n => n.checked, write: (n, v) => { n.checked = v; } },
    { node: 'selProbeCount' + L,  option: 'probeCount' + L,     read: n => n.value,   write: (n, v) => { n.value = String(v); } },
    { node: 'selProbePlace' + L,  option: 'probePlacement' + L, read: n => n.value,   write: (n, v) => { n.value = v; } },
    { node: 'probeTags' + L,      option: 'probeTags' + L,
      read: n => tagBoxes(n).filter(b => b.checked).map(b => b.dataset.tag),
      write: (n, v) => { tagBoxes(n).forEach(b => { b.checked = (v || []).indexOf(b.dataset.tag) >= 0; }); } },
    { node: 'chkProbeTokens' + L, option: 'probeTokens' + L,    read: n => n.checked, write: (n, v) => { n.checked = v; } },
  );
}

/** Render the panel from the configuration in force, so the two cannot diverge. */
function applySettingsToControls(cfg) {
  for (const c of SETTINGS_CONTROLS) c.write(el[c.node], cfg[c.option]);
  syncPromptDelayEnabled();
  el.levelBlurb.textContent = CARDS.level(cfg.level).blurb;
  // Switching level or fading the rule takes effect on the card already on
  // screen, not on the next one - renderRulePanel() shows nothing unless a
  // trial is showing, so this is a no-op everywhere else.
  renderRulePanel();
  // Only the level in play has its probe block on screen. The other two keep
  // their own stored settings; nothing is reset by looking away from them.
  for (const L of PROBE_LEVELS) el['probeLevel' + L].hidden = (L !== cfg.level);
  el.probeLevelLabel.textContent = 'Level ' + cfg.level;
  el.selLearner.value = state.learner;
  // A programmatic write fires no `change` event, so the prompting-method group
  // has to be told to re-read the two switches it summarises.
  if (window.NooutcoPrompting) window.NooutcoPrompting.refresh();
}

function loadSettings() {
  // Read-then-fold, never drop. Runs at most once; `tosSettings` is left intact.
  settingsStore.foldLegacy({ map: foldRetiredSettings });
  state.learner = storedLearner();
  state.cfg = settingsStore.normalize(foldRetiredSettings(rawStoredConfig()));
  applySettingsToControls(state.cfg);
}

/* ── Learner slots ─────────────────────────────────────────────────────
   Three opaque slots, A/B/C, each holding its own saved programme parameters.
   One technician runs the same programme with more than one learner on the same
   device, and the probe configuration is exactly the thing that differs between
   them - so the settings have to be separable.

   The slot is a LETTER. There is no name field, no identifier, and no place to
   put one: apps/games/CLAUDE.md §5 forbids player-identifiable data on the
   device, and a free-text "who is this?" box is the shortest route to breaking
   that. The slot is stored as the shared store's own `last` set name, so it
   rides the existing sets/last/working schema rather than adding a parallel one.
   Results are NOT namespaced by slot: the report is the session in front of you,
   and a slot switch is a settings action. */

const LEARNER_SLOTS = ['A', 'B', 'C'];
const setNameFor = slot => 'Learner ' + slot;

function storedLearner() {
  const last = settingsStore.load().last;
  const slot = typeof last === 'string' ? last.replace(/^Learner /, '') : '';
  return LEARNER_SLOTS.indexOf(slot) >= 0 ? slot : 'A';
}

/**
 * Switch slots: bank the configuration on screen under the slot being left,
 * then adopt the incoming slot's saved set. A slot that has never been saved
 * inherits what is on screen - that is its first configuration, not a reset.
 */
function switchLearner(slot) {
  if (LEARNER_SLOTS.indexOf(slot) < 0) return;
  settingsStore.saveSet(setNameFor(state.learner), state.cfg);
  state.learner = slot;
  const adopted = settingsStore.applySet(setNameFor(slot));
  if (adopted) state.cfg = adopted;
  else settingsStore.saveSet(setNameFor(slot), state.cfg);
  settingsStore.saveWorking(state.cfg);
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
 * Only the control the technician just touched is read - a control whose value
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

// ── Probe controls ─────────────────────────────────────────────────────
/**
 * Fill the three probe blocks from the vocabularies probes.js declares, so a
 * tag or a placement the module does not offer cannot appear in the panel.
 */
const TAG_LABELS = {
  near: 'Near - same territory, new instance',
  far: 'Far - a person, place or thing this level never pairs with it',
  deictic: 'Deictic - the learner also has to say why, in I - you terms',
};
const PLACEMENT_LABELS = { before: 'Before the deck', interleaved: 'Interleaved', after: 'After the deck' };

function populateProbeControls() {
  const counts = [];
  for (let n = 1; n <= 10; n++) counts.push(`<option value="${n}">${n}</option>`);
  const places = PROBES.PLACEMENTS
    .map(p => `<option value="${p}">${PLACEMENT_LABELS[p]}</option>`).join('');
  for (const L of PROBE_LEVELS) {
    el['selProbeCount' + L].innerHTML = counts.join('');
    el['selProbePlace' + L].innerHTML = places;
    el['probeTags' + L].innerHTML =
      '<span class="probe-tags-label">Tags in play</span>' +
      PROBES.TAGS.map(t =>
        `<label class="checkbox-label" title="${TAG_LABELS[t]}">` +
        `<input type="checkbox" data-tag="${t}"> ${t}</label>`).join('');
  }
}

/** The probe block in force - the one belonging to the level being taught. */
function probeCfg() {
  const L = state.cfg.level;
  return {
    on: state.cfg['probes' + L],
    count: state.cfg['probeCount' + L],
    placement: state.cfg['probePlacement' + L],
    tags: state.cfg['probeTags' + L],
    tokens: state.cfg['probeTokens' + L],
  };
}

/**
 * Is an instructional support in force RIGHT NOW?
 *
 * On a probe trial the supports probes.js names are withheld, so a correct
 * answer is evidence about the repertoire rather than about the prompt
 * (RESEARCH.md §4.2). Every runtime read of one of those four options goes
 * through here; reading `state.cfg` directly would leave a support live on a
 * probe and nothing on screen would say so.
 */
function supportOn(name) {
  if (state.probeTrial && PROBES.SUPPRESSED.indexOf(name) >= 0) return false;
  return state.cfg[name];
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
 * outright rather than filtering a single flat deck - that is what makes the
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
  state.deck = withProbes(pool);
  state.pos = 0;
  state.represented = new Set();
  state.probeSeen = new Set();
  state.probeTrial = false;
}

/**
 * Fold this level's probe block into the teaching deck.
 *
 * Off by default, so most sessions get the teaching deck back unchanged. When it
 * is on, the items are GENERATED (never drawn from the teaching pool), tagged by
 * probes.js, and placed where the plan says. The seed rotates the surfaces from
 * session to session without anything being stored - see probes.js on why a
 * remembered "already used" list would be worse than useless.
 */
function withProbes(deck) {
  const p = probeCfg();
  if (!p.on) return deck;
  const seed = Math.floor(Math.random() * 1000);
  const pool = PROBES.forCategory(state.cfg.level, p.tags, state.cfg.category);
  const probes = PROBES.select(state.cfg.level, p.tags, p.count, seed, pool);
  return PROBES.place(deck, probes, p.placement);
}

// ── Start ──────────────────────────────────────────────────────────────
function beginSession(mode) {
  // The settings bar stays live behind the guide, so Play is reachable from
  // it. Drop the restore state rather than restoring it - the new session
  // decides what is on screen, not the screen the guide was opened over.
  state.guideReturn = null;
  el.guideScreen.hidden = true;
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
  state.shelfBanked = false;
  collapseSettingsOnPhone();
  if (state.learnMode) {
    showLearnScreen();
  } else {
    enterTrials();
  }
}

/* On a phone the expanded settings bar is most of the first screen, so a
   session that starts with it open puts Learn or the first card ~500px down.
   Phones only: a technician on a tablet or laptop keeps the bar in view, and
   the bar is one tap away on a phone through the same minimize control. */
const PHONE_QUERY = '(max-width: 680px)';
const isPhone = () => !!(window.matchMedia && window.matchMedia(PHONE_QUERY).matches);

/** Collapse the settings bar through header-chrome's own minimize control. */
function collapseSettingsOnPhone() {
  if (!isPhone() || document.body.classList.contains('settings-collapsed')) return;
  const btn = $('btn-minimize');
  if (btn) btn.click();
}

/** Bring a section's top edge just under the sticky site nav (phones only). */
function scrollSectionIntoView(section) {
  if (!isPhone() || !section || section.hidden) return;
  const nav = document.querySelector('noaba-bar');
  const navBottom = nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0;
  const top = section.getBoundingClientRect().top + window.scrollY - navBottom - 8;
  window.scrollTo(0, Math.max(0, top));
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
  renderLearnLadder();
  renderLearnPair();
  el.learnScreen.hidden = false;
  scrollSectionIntoView(el.learnScreen);
}

/**
 * The Learn screen's ladder: one card per tier, top to bottom, drawn from the
 * same WHY_TIERS and WHY the Why panel uses after each card. Short on purpose -
 * the Teaching Interaction Procedure (Leaf et al. 2012) is a label, a reason
 * and an example, not a paragraph: each tier is its name, its questions and one
 * line of why.
 */
function renderLearnLadder() {
  const ladder = $('learn-ladder');
  if (!ladder || ladder.firstChild) return;
  const dims = Object.keys(MODEL.WHY);
  ladder.innerHTML = MODEL.WHY_TIERS.map(t => {
    const qs = dims.filter(k => MODEL.WHY[k].tier === t.tier).map(k => MODEL.WHY[k]);
    const icon = qs.length ? qs[0].icon : '';
    const pills = qs.map(q =>
      `<li class="learn-q"><span aria-hidden="true">${q.icon}</span> ${escapeHtml(q.question)}</li>`).join('');
    return `<li class="learn-tier" data-tier="${t.tier}" data-key="${t.key}">` +
      `<span class="learn-tier-num" aria-hidden="true">${t.tier}</span>` +
      '<div class="learn-tier-card">' +
        `<div class="learn-tier-head"><span class="learn-tier-icon" aria-hidden="true">${icon}</span>` +
        `<span class="learn-tier-name">${escapeHtml(t.label)}</span></div>` +
        `<p class="learn-tier-why">${escapeHtml(t.why || '')}</p>` +
        `<ul class="learn-qs">${pills}</ul>` +
      '</div></li>';
  }).join('');
}

/**
 * The worked example: the first Level 1 minimum-difference pair that flips on
 * one dimension (Horner, Albin & Ralph 1986), read off the level's own pairs
 * list, shown side by side with the one chip that changed.
 */
function renderLearnPair() {
  const body = $('learn-pair-body');
  if (!body || body.firstChild) return;
  const lv = CARDS.level(1);
  const byId = {};
  lv.cards.forEach(c => { byId[c.id] = c; });
  const pair = lv.pairs.find(p => p.kind === 'flip' && byId[p.a] && byId[p.b]);
  if (!pair) { $('learn-pair').hidden = true; return; }
  const def = MODEL.WHY[pair.flips];
  const side = card => {
    const val = (def && def.values[card.features[pair.flips]]) || { chip: card.features[pair.flips] };
    return `<div class="learn-side learn-side-${card.answer}" data-card="${card.id}" data-answer="${card.answer}">` +
      `<p class="learn-sit">${escapeHtml(card.situation)}</p>` +
      `<p class="learn-utt">\u201C${escapeHtml(card.utterance)}\u201D</p>` +
      '<div class="learn-side-foot">' +
        `<span class="learn-flip-chip" data-dim="${pair.flips}">${def ? def.icon + ' ' : ''}${escapeHtml(val.chip)}</span>` +
        `<span class="tag tag-${card.answer}">${ANSWER_LABELS[card.answer]}</span>` +
      '</div></div>';
  };
  body.innerHTML =
    (def ? `<p class="learn-pair-ask">Only one thing changed: <strong>${escapeHtml(def.question)}</strong></p>` : '') +
    `<div class="learn-sides">${side(byId[pair.a])}${side(byId[pair.b])}</div>`;
}

// ── Staff guide ────────────────────────────────────────────────────────
/**
 * Show the guide over whatever is on screen, and put that back on close.
 *
 * The guide is reference material a technician reaches for mid-shift, which
 * means mid-session as often as not. Opening it therefore suspends the screen
 * rather than ending the session: nothing is recorded, nothing advances, and
 * Close restores the intro, the Learn screen or the trial that was showing.
 */
function showGuide() {
  if (!el.guideBody.firstChild) GUIDE.renderInto(el.guideBody);
  if (!state.guideReturn) {
    state.guideReturn = {
      intro:  el.gameIntro.hidden,
      learn:  el.learnScreen.hidden,
      game:   el.gameArea.hidden,
      prompt: el.btnPrompt.hidden,
    };
  }
  el.gameIntro.hidden = true;
  el.learnScreen.hidden = true;
  el.gameArea.hidden = true;
  el.btnPrompt.hidden = true;
  el.guideScreen.hidden = false;
  window.scrollTo(0, 0);
}

function hideGuide() {
  el.guideScreen.hidden = true;
  const back = state.guideReturn;
  state.guideReturn = null;
  if (!back) { el.gameIntro.hidden = false; return; }
  el.gameIntro.hidden = back.intro;
  el.learnScreen.hidden = back.learn;
  el.gameArea.hidden = back.game;
  el.btnPrompt.hidden = back.prompt;
}

/**
 * Save the guide as a standalone file for an onboarding packet.
 *
 * The bytes are built by staff-guide.js from the same SECTIONS the screen
 * above was rendered from, with the screenshots inlined so the file works off
 * this site. Device-local: a Blob and an anchor, no network anywhere.
 */
async function downloadGuide() {
  let html;
  try {
    html = await GUIDE.renderStandalone();
  } catch (err) {
    // Say so. A download button that quietly does nothing sends a technician
    // to an onboarding packet with no guide in it.
    alert('The guide could not be prepared for download. It is still readable on this screen.');
    return;
  }
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = GUIDE.FILENAME;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function enterTrials() {
  el.learnScreen.hidden = true;
  el.learnVideo.innerHTML = '';     // stop any playing video
  el.gameArea.hidden = false;
  el.btnPrompt.hidden = false;
  resetTimer();
  renderTrial();
  scrollSectionIntoView(el.gameArea);
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
  state.trialSecs = 0;
  state.recorded = false;
  state.probeTrial = !!state.current.isProbe;
  resetRationale();

  const sc = state.current;
  el.progressLabel.textContent = `Card ${state.pos + 1} of ${state.deck.length}`;
  renderProbeBanner(sc);
  renderRulePanel();
  el.situation.textContent = sc.situation;
  renderThought(sc);
  el.question.textContent = sc.question;

  hideWhy();

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
  if (supportOn('autoPrompt')) scheduleAutoPrompt();
}

/**
 * Say plainly, on screen, that this trial is a probe and what that means.
 *
 * The technician has to be able to see it BEFORE reaching for the Prompt: the
 * button still works, and using it is a clinical call they are entitled to make,
 * but it turns the trial into a trained one. A suppression the staff cannot see
 * is a suppression they will accidentally undo.
 */
function renderProbeBanner(sc) {
  if (!sc.isProbe) {
    el.probeBanner.hidden = true;
    el.probeBanner.textContent = '';
    return;
  }
  el.probeBanner.textContent =
    'Probe - supports off (' + sc.probeTags.join(' + ') + '). ' +
    'Prompting still works, and records this as a trained trial.';
  el.probeBanner.hidden = false;
}

/** True while a trial card is on screen - finishSession hides the scenario. */
const trialOnScreen = () => !el.gameArea.hidden && !el.scenarioSection.hidden;

/**
 * State the rule on screen, for the whole trial, at the level that declares one.
 *
 * The maintainer's structural ruling: "Level 1 should state the rule (bring the
 * unspoken rules to light)". Level 1 is early acquisition, so the rule is a
 * VISIBLE support rather than something to be induced from feedback over 35
 * cards. The text is the level pool's own `rule` - one declaration, in the
 * data, rendered here - so no card carries a copy of it and there is nothing to
 * drift.
 *
 * Both branches render together, always. That is what keeps the strip from
 * answering the card underneath it: every card is a THINK IT or a SAY IT, and
 * the strip poses the four questions without saying which one this card meets.
 *
 * It is on screen for the whole trial, which is the point - a technician
 * checking the rule must not have to leave the card to do it. Levels 2 and 3
 * declare no rule, so nothing renders there whatever the switch says.
 *
 * Read through supportOn(), not off the configuration, because it is a SUPPORT:
 * a probe trial withholds it exactly as it withholds the reason reveal.
 */
/**
 * The Why-ladder icon for the dimension a rule question tests, so a pill in the
 * strip carries the same picture as the ladder row it will later light up.
 *
 * Derived from the question's own `when.is` predicate (its first key is the
 * dimension it asks about) and looked up in the model's WHY table, never
 * hard-coded, so a rewritten branch picks up its new icon for free. It rides in
 * a data attribute drawn by CSS `::before`, which keeps the pill's text content
 * exactly the rule text the data declares. Any lookup that fails leaves the pill
 * without an icon rather than throwing mid-render.
 */
function setRuleIcon(node, branch) {
  const is = branch && branch.when && branch.when.is;
  const dim = is && typeof is === 'object' ? Object.keys(is)[0] : null;
  const why = dim && MODEL && MODEL.WHY ? MODEL.WHY[dim] : null;
  if (!why || !why.icon) return;
  node.dataset.icon = why.icon;
  node.dataset.dim = dim;
}

function renderRulePanel() {
  const rule = CARDS.level(state.cfg.level).rule;
  const show = !!rule && supportOn('showRule') && trialOnScreen();
  el.rulePanel.hidden = !show;
  if (!show) {
    el.ruleBody.replaceChildren();
    return;
  }
  el.ruleTitle.textContent = rule.title;
  el.ruleLead.textContent = rule.lead;
  el.ruleTip.textContent = rule.tip;
  el.ruleTip.hidden = !rule.tip;

  // One row per answer, in the tile vocabulary the learner already has: the
  // amber THINK IT tag and the green SAY IT tag are the same two the choice
  // tiles carry, so the rule reads in the terms the response is made in.
  const rows = ['think', 'say'].map(answer => {
    const row = document.createElement('div');
    row.className = 'rule-row';
    const tag = document.createElement('span');
    tag.className = 'tag tag-' + answer;
    tag.textContent = ANSWER_LABELS[answer];
    const list = document.createElement('ul');
    list.className = 'rule-list';
    for (const branch of rule.branches.filter(b => b.answer === answer)) {
      const item = document.createElement('li');
      item.textContent = branch.test;
      setRuleIcon(item, branch);
      list.appendChild(item);
    }
    row.append(tag, list);
    return row;
  });

  // The standing override sits ABOVE the two columns rather than inside one of
  // them, because it outranks both: safety wins at a bad moment and in front of
  // everybody. Inside a column it would read as one question among equals, and
  // the columns would stop being answerable in any order.
  if (rule.always) {
    const banner = document.createElement('div');
    banner.className = 'rule-always';
    const tag = document.createElement('span');
    tag.className = 'tag tag-' + rule.always.answer;
    tag.textContent = ANSWER_LABELS[rule.always.answer];
    const text = document.createElement('p');
    text.className = 'rule-always-text';
    text.textContent = rule.always.test + ' ' + rule.always.note;
    setRuleIcon(text, rule.always);
    banner.append(tag, text);
    rows.unshift(banner);
  }

  el.ruleBody.replaceChildren(...rows);
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
  // The line sits in a thought bubble, the same shape as the THINK tile's
  // icon: a thought is private until it is said (Wellman et al. 2002; Kerr &
  // Durkin 2004). The tail and caption wait for settleThought().
  const tail = document.createElement('span');
  tail.className = 'thought-tail';
  tail.setAttribute('aria-hidden', 'true');
  const caption = document.createElement('span');
  caption.className = 'thought-caption';
  caption.hidden = true;
  el.thought.className = 'thought-bubble';
  el.thought.replaceChildren(lead, quote, tail, caption);
}

/**
 * After a correct answer the bubble shows what happened to the thought: a SAY
 * turns it into a speech bubble ("said out loud"), a THINK keeps it a thought
 * bubble with a lock ("kept inside"). It rides with the Why ladder, so a probe
 * withholds it like every other support; renderThought() resets it.
 */
function settleThought(answer) {
  const said = answer === 'say';
  el.thought.classList.remove('is-said', 'is-kept');
  el.thought.classList.add(said ? 'is-said' : 'is-kept');
  const caption = el.thought.querySelector('.thought-caption');
  if (!caption) return;
  caption.textContent = said ? 'said out loud' : '🔒 kept inside';
  caption.hidden = false;
}

/**
 * Counterbalance the tile POSITIONS between trials.
 *
 * The labels never move - THINK IT is always the brain tile and SAY IT always
 * the mouth tile - so the response topography is constant. Only which side each
 * sits on alternates, strictly, on the trial index.
 *
 * What that alternation guarantees is narrow, and worth stating exactly: each
 * POSITION holds each TILE equally often. It says NOTHING about which side is
 * CORRECT. Which side is correct is the interaction between this alternation
 * and the pool's own run of answers - and if a pool's answers ever alternate
 * with the same period as the tiles, the correct tile lands on the same side on
 * every single trial. That is a perfect position cue: precisely the faulty
 * stimulus control this rebuild exists to prevent.
 *
 * So the property is not asserted here, because it is not a property of this
 * function: it belongs to the AUTHORED ORDER of each pool. It is measured
 * instead - think-or-say-levels.spec.js walks every level pool in sequential
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
  state.trialSecs = Math.max(0, Math.round((Date.now() - state.trialStart) / 1000));
  // Reinforcement on a probe trial is a plan decision, not a side effect of
  // switching probes on, so it has its own switch and it defaults ON.
  if (window.__nooutcoTokens && (!state.probeTrial || probeCfg().tokens)) {
    window.__nooutcoTokens.award();
  }
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

  // At Level 3 the tile is only half the trial: the response the programme
  // targets is the spoken REASON. The trial is therefore neither revealed nor
  // recorded here - the game asks, the technician scores what was said, and
  // recordResult() runs on the way to the next card.
  if (needsRationale(state.current)) { askRationale(state.current); return; }

  recordResult();
  if (supportOn('showReason') || state.learnMode) showReason();
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
  if (supportOn('errorless')) {
    card.disabled = true;
    card.classList.add('locked', 'dim');
    // Surface the correct answer as a prompt.
    doPrompt();
  }
}

// ── Reason: the Why ladder ─────────────────────────────────────────────
/**
 * Show why the answer is the answer.
 *
 * The header is the verdict in the tile vocabulary plus the card's own reason
 * line (still #scenario-reason, still the authored text). Under it, the rules
 * in play on this card only, in the order of the hierarchy card-model.js
 * declares, so the ranking the reason line states in words is visible: the
 * row that decides it is marked, and a row pulling the other way is struck
 * as outranked. Callers gate it exactly as they gated the bare reason line.
 */
function showReason() {
  const sc = state.current;
  if (!sc) return;
  el.reason.textContent = sc.reason;
  el.reason.className = sc.answer === 'think' ? 'reason-think' : 'reason-say';
  el.reason.hidden = false;
  el.whyVerdict.className = 'tag tag-' + sc.answer;
  el.whyVerdict.textContent = ANSWER_LABELS[sc.answer];

  const rows = MODEL.whyLadder(sc);
  const flip = flipFor(sc);
  el.whyRows.replaceChildren(...rows.map((r, i) => whyRow(r, i, flip)));
  renderFlip(flip, rows.length);
  renderTiers(rows);
  el.whyPanel.className = 'why-panel why-' + sc.answer;
  el.whyPanel.hidden = false;
  settleThought(sc.answer);
  requestAnimationFrame(bringWhyIntoView);
}

/**
 * Scroll just enough that the ladder is on screen, so on a phone the learner
 * is not left hunting below the tiles; scrolling no further keeps as much of
 * the settled thought bubble in view as fits. The fixed print / clear bar
 * counts as covered space wherever it sits over the panel, and if the scroll
 * would park Next under it, Next is brought clear too. The panel's top always
 * wins. No smooth scroll under reduced motion.
 */
function bringWhyIntoView() {
  if (el.whyPanel.hidden) return;
  const PAD = 12;
  const vh = window.innerHeight;
  const panel = el.whyPanel.getBoundingClientRect();
  const barEl = $('bottom-bar');
  const bar = barEl ? barEl.getBoundingClientRect() : null;
  const across = r => !!bar && bar.width > 0 && r.left < bar.right && bar.left < r.right;
  const floor = r => (across(r) ? bar.top : vh) - PAD;

  let dy = Math.max(0, panel.bottom - floor(panel));
  const nextEl = $('btn-next');
  if (nextEl) {
    const next = nextEl.getBoundingClientRect();
    const under = across(next) && next.bottom - dy > bar.top && next.top - dy < bar.bottom;
    if (under) dy = next.bottom - floor(next);
  }
  if (panel.top - dy < PAD) dy = panel.top - PAD;
  if (Math.abs(dy) < 2) return;
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollBy({ top: dy, behavior: still ? 'auto' : 'smooth' });
}

function hideWhy() {
  el.reason.hidden = true;
  el.reason.className = '';
  el.whyPanel.hidden = true;
  el.whyRows.replaceChildren();
  el.whyFlip.replaceChildren();
  el.whyFlip.hidden = true;
  el.whyTiers.replaceChildren();
}

/** A small THINK / SAY badge. The word is always printed; colour only repeats it. */
function leanBadge(lean) {
  const b = document.createElement('span');
  b.className = 'why-lean why-lean-' + (lean || 'none');
  b.textContent = lean ? '\u2192 ' + lean.toUpperCase() : 'either way';
  return b;
}

function whyRow(r, i, flip) {
  const li = document.createElement('li');
  const cls = ['why-row', 'why-' + r.stance];
  if (r.decides) cls.push('is-decider');
  if (r.outranked) cls.push('is-outranked');
  if (flip && flip.dim === r.dim) cls.push('is-flip-dim');
  li.className = cls.join(' ');
  li.dataset.dim = r.dim;
  li.dataset.tier = String(r.tier);
  li.style.setProperty('--i', String(i));

  const icon = document.createElement('span');
  icon.className = 'why-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = r.icon;
  const q = document.createElement('span');
  q.className = 'why-q';
  q.textContent = r.question;
  const chip = document.createElement('span');
  chip.className = 'why-chip';
  chip.textContent = r.chip;
  li.append(icon, q, chip, leanBadge(r.lean));

  let mark = '';
  if (r.decides) mark = 'decides it';
  else if (r.outranked) mark = 'outranked';
  else if (r.stance === 'against') mark = 'not this time';
  else if (r.weak && r.stance === 'agree') mark = 'not enough alone';
  if (mark) {
    const m = document.createElement('span');
    m.className = 'why-mark';
    m.textContent = mark;
    li.appendChild(m);
  }
  return li;
}

/**
 * The card's matched minimum-difference partner (Horner, Albin & Ralph 1986),
 * if it has one: the card that differs on exactly one rule and answers the
 * other way. A card anchoring two pairs shows the first one declared.
 */
function flipFor(sc) {
  const lv = CARDS.LEVELS.find(l => l.id === sc.level);
  if (!lv) return null;
  const pair = lv.pairs.find(p => p.a === sc.id || p.b === sc.id);
  if (!pair) return null;
  const partner = lv.cards.find(c => c.id === (pair.a === sc.id ? pair.b : pair.a));
  if (!partner) return null;
  const def = MODEL.WHY[pair.flips];
  const val = def && def.values[partner.features[pair.flips]];
  return { dim: pair.flips, partner, chip: val ? val.chip : '' };
}

/**
 * A word as the diff compares it: lower case, punctuation off. A token that is
 * only punctuation (a spaced hyphen) normalises to '' and is never marked.
 */
const diffKey = w => w.toLowerCase().replace(/[^a-z0-9']/g, '');

/**
 * Which words of `to` are NOT in `from`, in order - an LCS over words.
 *
 * A minimum-difference contrast only teaches if the learner can SEE the one
 * thing that changed (Horner, Albin & Ralph 1986), so the partner's text is
 * shown whole and the words outside the longest common subsequence are
 * marked. Cards are a sentence or three, so the O(n*m) table is trivial.
 * Returns the tokens of `to` split on whitespace, each with `changed`.
 */
function wordDiff(from, to) {
  const a = String(from || '').split(/\s+/).filter(Boolean);
  const b = String(to || '').split(/\s+/).filter(Boolean);
  const ka = a.map(diffKey);
  const kb = b.map(diffKey);
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = ka[i] === kb[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const out = b.map(w => ({ word: w, changed: true }));
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (ka[i] === kb[j]) { out[j].changed = false; i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return out.map((t, k) => (kb[k] === '' ? { ...t, changed: false } : t));
}

/** The partner's text as nodes, each run of changed words wrapped in one <mark>. */
function diffNodes(from, to) {
  const runs = [];
  for (const t of wordDiff(from, to)) {
    const last = runs[runs.length - 1];
    if (last && last.changed === t.changed) last.words.push(t.word);
    else runs.push({ changed: t.changed, words: [t.word] });
  }
  const nodes = [];
  runs.forEach((r, k) => {
    if (k) nodes.push(document.createTextNode(' '));
    const text = r.words.join(' ');
    if (!r.changed) { nodes.push(document.createTextNode(text)); return; }
    const m = document.createElement('mark');
    m.className = 'why-diff';
    m.textContent = text;
    nodes.push(m);
  });
  return nodes;
}

function renderFlip(flip, index) {
  if (!flip) { el.whyFlip.hidden = true; el.whyFlip.replaceChildren(); return; }
  const sc = state.current;
  const lab = document.createElement('span');
  lab.className = 'why-flip-label';
  lab.textContent = 'Flip it: what changed?';
  const chip = document.createElement('span');
  chip.className = 'why-chip why-chip-flip';
  chip.textContent = flip.chip;
  const text = document.createElement('span');
  text.className = 'why-flip-text';
  text.append(...diffNodes(sc.situation, flip.partner.situation));
  const tag = document.createElement('span');
  tag.className = 'tag tag-' + flip.partner.answer;
  tag.textContent = ANSWER_LABELS[flip.partner.answer];
  const arrow = document.createElement('span');
  arrow.className = 'why-flip-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '\u2192';
  const parts = [lab, chip, arrow, tag, text];
  if (flip.partner.utterance && flip.partner.utterance !== sc.utterance) {
    const said = document.createElement('span');
    said.className = 'why-flip-said';
    said.append('\u201c', ...diffNodes(sc.utterance, flip.partner.utterance), '\u201d');
    parts.push(said);
  }
  el.whyFlip.replaceChildren(...parts);
  el.whyFlip.style.setProperty('--i', String(index));
  el.whyFlip.hidden = false;
}

/** The five tiers as one slim line, the tiers in play on this card lit. */
function renderTiers(rows) {
  const lit = new Set(rows.map(r => r.tier));
  el.whyTiers.replaceChildren(...MODEL.WHY_TIERS.map(t => {
    const li = document.createElement('li');
    li.className = 'why-tier' + (lit.has(t.tier) ? ' is-lit' : '');
    li.textContent = t.label;
    return li;
  }));
}

// ── Level 3: the spoken rationale ──────────────────────────────────────
/**
 * Level 3 cards, and only Level 3 cards, require a reason.
 *
 * Read off the card rather than off the settings panel: a Level 3 probe is
 * generated, and it is a Level 3 item because its level says so. There is no
 * switch for this - "the reason is the target" is what Level 3 IS, so making it
 * optional would make the level mean two different things on two devices.
 */
function needsRationale(sc) {
  return !!sc && sc.level === 3;
}

function resetRationale() {
  state.rationaleScore = '';
  el.rationalePanel.hidden = true;
  el.rationaleReveal.hidden = true;
  el.rationaleExamples.hidden = true;
  el.rationaleList.replaceChildren();
  el.rationaleNote.value = '';
  scoreButtons().forEach(b => b.classList.remove('is-picked'));
}

const scoreButtons = () => Array.from(el.rationaleScores.querySelectorAll('button'));

/**
 * Ask for the reason.
 *
 * The exemplars wait behind a button, even when "Show Reason After" is on. If
 * they appeared with the ask, the technician would be reading model answers
 * aloud before the learner had said anything - a prompt, delivered by the
 * layout. And on a probe trial the reveal is a withheld support, so the button
 * is not offered at all: `supportOn` is the single accessor that decides.
 */
function askRationale(sc) {
  el.rationalePanel.hidden = false;
  const hasExamples = Array.isArray(sc.rationales) && sc.rationales.length > 0;
  el.rationaleReveal.hidden = !(hasExamples && (supportOn('showReason') || state.learnMode));
}

function revealRationale() {
  const sc = state.current;
  if (!sc) return;
  showReason();
  el.rationaleList.replaceChildren(...(sc.rationales || []).map(text => {
    const li = document.createElement('li');
    li.textContent = text;      // authored content, placed as text, never markup
    return li;
  }));
  el.rationaleExamples.hidden = false;
  el.rationaleReveal.hidden = true;
}

/**
 * Score the reason the learner gave. Independent of the exemplars in every
 * direction: a score can be given without revealing them, and revealing them
 * scores nothing.
 */
function pickRationale(score) {
  if (!needsRationale(state.current)) return;
  state.rationaleScore = score;
  scoreButtons().forEach(b => b.classList.toggle('is-picked', b.dataset.score === score));
  // Scored, so the ladder is no longer the answer sheet. Same gating as the
  // exemplar reveal: withheld on a probe, shown in learn mode.
  if (supportOn('showReason') || state.learnMode) showReason();
  showNextButton();
}

function populateRationaleScores() {
  el.rationaleScores.replaceChildren(...RATIONALE_SCORES.map(score => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rationale-score';
    btn.dataset.score = score;
    btn.textContent = RATIONALE_LABELS[score];
    btn.addEventListener('click', () => pickRationale(score));
    return btn;
  }));
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
  // control instead used to hand `parseInt('')` - NaN, which setTimeout treats
  // as 0 - to the learner as an instant prompt whenever the stored value was
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
  return missed && supportOn('represent') && !state.represented.has(sc.id);
}

function nextTrial() {
  // A Level 3 trial is written here rather than on the tile tap, because the
  // score and the note are not known until now. Every other trial is already
  // recorded and this is a no-op for it.
  if (!state.recorded) recordResult();

  // Re-present a missed card once, at the end of the deck - with a FRESH
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
  // No card on screen, so no rule over it: the strip is a support for the
  // trial, not decoration on the summary.
  renderRulePanel();

  const total = state.results.length;
  const firstTry = state.results.filter(r => r.errors === 0 && !r.prompted).length;
  const counts = ruleCounts();
  const firstTimeDims = bankShelf(counts);
  const badges = ruleBadges(counts, firstTimeDims) + shelfLine(loadShelf());

  // Render the sheet as the session ends rather than only when Print is pressed,
  // so what the technician hands the BCBA is already built and already current.
  buildPrint();

  removeDoneCard();
  const card = document.createElement('div');
  card.id = 'done-card';
  card.innerHTML =
    '<div class="done-emoji">🎉</div>' +
    '<h2>Set complete!</h2>' +
    `<p>${firstTry} of ${total} correct on the first try.</p>` +
    badges +
    '<button type="button" id="btn-again">Play again</button>';
  el.gameArea.appendChild(card);
  $('btn-again').addEventListener('click', () => beginSession('play'));
}

/**
 * The rules that decided this session's cards, as small collectible badges
 * (the Power Card idea: a short rule with an icon, kept). One badge per
 * deciding dimension - the Why ladder row marked `decides` - counted over the
 * cards answered right on the first try. Probe trials are left out: a probe
 * withholds the ladder, so it taught no rule to collect.
 */
function ruleCounts() {
  const byId = new Map();
  CARDS.ALL.forEach(c => byId.set(c.id, c));
  state.deck.forEach(c => { if (c && c.id) byId.set(c.id, c); });
  const counts = new Map();
  state.results.forEach(r => {
    if (r.errors !== 0 || r.prompted || r.probeTags) return;
    const card = byId.get(r.cardId);
    if (!card) return;
    const row = MODEL.whyLadder(card).find(x => x.decides);
    if (!row) return;
    counts.set(row.dim, (counts.get(row.dim) || 0) + 1);
  });
  return counts;
}

/** This session's badges; a rule deciding a card for this learner for the first time is marked new. */
function ruleBadges(counts, firstTimeDims) {
  const fresh = firstTimeDims || new Set();
  if (!counts.size) return '';
  const tierName = {};
  MODEL.WHY_TIERS.forEach(t => { tierName[t.tier] = t.label; });
  const items = [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (MODEL.WHY[a[0]].tier - MODEL.WHY[b[0]].tier))
    .map(([dim, n]) => {
      const def = MODEL.WHY[dim];
      const isNew = fresh.has(dim);
      return `<li class="rule-badge${isNew ? ' rule-badge-new' : ''}" data-dim="${dim}" data-count="${n}"${isNew ? ' data-new="1"' : ''}>` +
        (isNew ? '<span class="rule-badge-new-label">new</span>' : '') +
        `<span class="rule-badge-icon" aria-hidden="true">${def.icon}</span>` +
        `<span class="rule-badge-name">${escapeHtml(RULE_NAMES[dim] || tierName[def.tier])}</span>` +
        `<span class="rule-badge-tier">${escapeHtml(tierName[def.tier])}</span>` +
        `<span class="rule-badge-count" aria-label="${n} ${n === 1 ? 'card' : 'cards'}">\u00D7${n}</span>` +
        '</li>';
    }).join('');
  return '<div id="done-rules" class="done-rules">' +
    '<h3 class="done-rules-title">Rules that decided your cards</h3>' +
    `<ul class="rule-badges">${items}</ul></div>`;
}

/* ── Badge shelf ─────────────────────────────────────────────────────────
   Every rule that has decided a first-try card for this learner slot, counted
   across sessions, so the done card can say what the learner has collected.
   Keyed by the opaque slot (A/B/C), never a name. Device-local and optional:
   every storage touch is guarded, and the done card renders without it. Clear
   data does NOT empty it, mirroring the slot's saved settings set, which Clear
   data also leaves alone: the button clears the session record in front of the
   technician, not the learner's history. */
const SHELF_KEY_PREFIX = 'nooutco.shelf.think-or-say.';
const shelfKey = () => SHELF_KEY_PREFIX + state.learner;

function loadShelf() {
  try {
    const raw = JSON.parse(localStorage.getItem(shelfKey()) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    Object.keys(raw).forEach(dim => {
      const n = Number(raw[dim]);
      if (MODEL.WHY[dim] && Number.isFinite(n) && n > 0) out[dim] = Math.floor(n);
    });
    return out;
  } catch (e) {
    return {};
  }
}

/** Add this session's counts to the shelf once; return the rules it holds for the first time. */
function bankShelf(counts) {
  const firstTime = new Set();
  if (state.shelfBanked || !counts.size) return firstTime;
  state.shelfBanked = true;
  const before = loadShelf();
  const after = Object.assign({}, before);
  counts.forEach((n, dim) => {
    if (!before[dim]) firstTime.add(dim);
    after[dim] = (before[dim] || 0) + n;
  });
  try {
    localStorage.setItem(shelfKey(), JSON.stringify(after));
  } catch (e) {
    // No storage (private window, blocked site data): the session's badges
    // still show; only the all-time line and the new marks go without.
    return new Set();
  }
  return firstTime;
}

function shelfLine(shelf) {
  const dims = Object.keys(shelf);
  if (!dims.length) return '';
  const items = dims
    .sort((a, b) => (shelf[b] - shelf[a]) || (MODEL.WHY[a].tier - MODEL.WHY[b].tier))
    .map(dim => {
      const name = RULE_NAMES[dim] || dim;
      return `<li class="shelf-item" data-dim="${dim}" data-count="${shelf[dim]}" title="${escapeHtml(name)}">` +
        `<span aria-hidden="true">${MODEL.WHY[dim].icon}</span>` +
        `<span class="shelf-count" aria-label="${escapeHtml(name)}: ${shelf[dim]}">${shelf[dim]}</span></li>`;
    }).join('');
  return `<div id="done-shelf" class="done-shelf" data-learner="${state.learner}">` +
    '<span class="done-shelf-title">All-time</span>' +
    `<ul class="shelf-items">${items}</ul></div>`;
}

/** A badge's short name: the rule a deciding row stands for, in two or three words. */
const RULE_NAMES = {
  override: 'Keep people safe',
  selfEsteem: 'Feelings',
  changeability: 'Fix it now',
  privacy: 'Private things',
  audience: 'Who hears it',
  timing: 'Right moment',
  relationship: 'Who they are',
  truthRank: 'Is it true?',
};

function removeDoneCard() {
  const d = $('done-card');
  if (d) d.remove();
}

// ── Results / data ─────────────────────────────────────────────────────
/**
 * Trained or generalization - decided once, when the trial is scored.
 *
 * The lifecycle, in full (Deliverable 5, RESEARCH.md §4.2):
 *
 *   a teaching card                  → trained, no tags
 *   a fresh probe run with supports
 *     withheld                       → GENERALIZATION, written once, tagged
 *   a probe where the technician
 *     delivered a prompt anyway      → trained, with the reason it was not clean
 *   any later run of an item already
 *     seen this session              → trained, "re-exposure"
 *
 * Either way the item becomes a trained target the moment it has been run: an
 * independent re-exposure is an independent trial, it is simply not a
 * generalization one. Nothing is discarded and nothing goes uncounted.
 *
 * The "seen" set is per SESSION and is never persisted. A stored one would be a
 * lie waiting to happen - clear the store and a trained item silently becomes a
 * generalization datum again - which is the whole reason probes are generated
 * rather than remembered.
 */
function classifyTrial(sc) {
  if (!sc.isProbe) return { trialClass: 'trained', probeTags: '', probeNote: '' };
  const tags = sc.tagKey || PROBES.tagKey(sc.probeTags);
  const firstRun = !state.probeSeen.has(sc.id);
  state.probeSeen.add(sc.id);
  if (!firstRun) return { trialClass: 'trained', probeTags: tags, probeNote: 're-exposure' };
  if (state.trialPrompted) {
    return { trialClass: 'trained', probeTags: tags, probeNote: 'prompt delivered' };
  }
  return { trialClass: 'generalization', probeTags: tags, probeNote: '' };
}

function recordResult() {
  const sc = state.current;
  let outcome = 'ok';
  if (state.trialPrompted) outcome = 'prompted';
  else if (state.trialErrors > 0) outcome = 'error';
  const cls = classifyTrial(sc);
  const row = {
    level: sc.level,
    // Which card this was, so the done card can name the rule that decided it.
    cardId: sc.id,
    cat: CATEGORIES[sc.cat] || sc.cat,
    scenario: sc.situation,
    answer: ANSWER_LABELS[sc.answer],
    errors: state.trialErrors,
    prompted: state.trialPrompted,
    secs: state.trialSecs,
    outcome,
    trialClass: cls.trialClass,
    probeTags: cls.probeTags,
    probeNote: cls.probeNote,
    // The Level 3 rationale. Blank at Levels 1 and 2, where no reason is asked
    // for - a blank column is honest about that, a zero would not be. The note
    // is the technician's own words and stays on this device, like every other
    // field here (apps/games/CLAUDE.md §5).
    rationaleScore: needsRationale(sc) ? state.rationaleScore : '',
    rationaleNote: needsRationale(sc) ? el.rationaleNote.value.trim() : '',
  };
  state.recorded = true;
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
      <td>${r.level == null ? '-' : r.level}</td>
      <td>${r.cat}</td>
      <td>${escapeHtml(r.scenario)}</td>
      <td>${r.answer}</td>
      <td>${r.errors}</td>
      <td>${r.prompted ? 'Yes' : 'No'}</td>
      <td>${r.secs}</td>
      <td class="${outClass}">${outLabel}</td>
      <td>${r.trialClass === 'generalization' ? 'Generalization' : 'Trained'}</td>
      <td>${escapeHtml(r.probeTags || '')}${r.probeNote ? ' (' + escapeHtml(r.probeNote) + ')' : ''}</td>
      <td>${rationaleCell(r)}</td>
    </tr>`;
  }).join('');
  el.resultsBody.innerHTML = rows;
  buildGeneralizationSplit();

  const total = state.results.length;
  const indep = state.results.filter(r => r.outcome === 'ok').length;
  const prompted = state.results.filter(r => r.prompted).length;
  const errs = state.results.reduce((a, r) => a + r.errors, 0);
  const d = new Date();
  el.printMeta.textContent = `${d.toLocaleDateString()} ${d.toLocaleTimeString()} - ${total} cards`;
  el.printSummary.innerHTML =
    `<span><strong>Independent:</strong> ${indep}/${total}</span>` +
    `<span><strong>Prompted:</strong> ${prompted}</span>` +
    `<span><strong>Total errors:</strong> ${errs}</span>` +
    rationaleTally();
}

/**
 * What the technician scored the spoken reason as, and their note.
 *
 * The note is printed beside the score rather than folded into it: the score is
 * the datum the plan asked for, the note is context for the BCBA reading it, and
 * the sheet should not blur which is which.
 */
function rationaleCell(r) {
  if (!r.rationaleScore) return '-';
  const label = RATIONALE_LABELS[r.rationaleScore] || r.rationaleScore;
  return escapeHtml(label) + (r.rationaleNote ? ' - ' + escapeHtml(r.rationaleNote) : '');
}

/** A count of the Level 3 reason scores, shown only once one has been given. */
function rationaleTally() {
  const scored = state.results.filter(r => r.rationaleScore);
  if (!scored.length) return '';
  const parts = RATIONALE_SCORES
    .map(s => `${scored.filter(r => r.rationaleScore === s).length} ${RATIONALE_LABELS[s].toLowerCase()}`)
    .join(' · ');
  return `<span><strong>Reasons:</strong> ${parts}</span>`;
}

/**
 * The trained / generalization split, and generalization broken out by the
 * EXACT tag set.
 *
 * Grouped by the whole set, never by individual tag: a far+deictic result
 * counted once under "far" and again under "deictic" would report four trials as
 * eight, and would answer neither question. Within-category and across-category
 * generalization came apart in Marzullo-Kerth et al. (RESEARCH.md §4.1), so the
 * buckets have to stay apart on the page too.
 *
 * Supported probes and re-exposures sit in the TRAINED bucket with the reason
 * they are there, so the sheet accounts for every trial that ran. Nothing here
 * interprets anything - it is a count of what happened.
 */
function buildGeneralizationSplit() {
  const rows = state.results;
  const gen = rows.filter(r => r.trialClass === 'generalization');
  const supported = rows.filter(r => r.trialClass === 'trained' && r.probeNote);
  if (!gen.length && !supported.length) {
    el.printGen.hidden = true;
    el.genBody.innerHTML = '';
    return;
  }
  const indep = list => list.filter(r => r.outcome === 'ok').length;
  const line = (bucket, list, note) =>
    `<tr><td>${escapeHtml(bucket)}</td><td>${list.length}</td>` +
    `<td>${indep(list)}</td><td>${escapeHtml(note)}</td></tr>`;

  const trained = rows.filter(r => r.trialClass !== 'generalization');
  const out = [line('Trained', trained, 'Teaching trials, plus every probe trial below that was not clean')];

  const keys = [];
  gen.forEach(r => { if (keys.indexOf(r.probeTags) < 0) keys.push(r.probeTags); });
  keys.forEach(k => {
    out.push(line('Generalization - ' + (k || 'untagged'), gen.filter(r => r.probeTags === k),
      'Untrained items, supports withheld'));
  });

  const notes = [];
  supported.forEach(r => { if (notes.indexOf(r.probeNote) < 0) notes.push(r.probeNote); });
  notes.forEach(n => {
    out.push(line('In trained - probe, ' + n, supported.filter(r => r.probeNote === n),
      n === 're-exposure' ? 'Already run this session, so not a generalization datum'
                          : 'A support was delivered, so not a generalization datum'));
  });

  el.genBody.innerHTML = out.join('');
  el.printGen.hidden = false;
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
  populateProbeControls();
  populateRationaleScores();
  loadSettings();
  loadResults();

  el.btnLearn.addEventListener('click', () => beginSession('learn'));
  el.btnPlay.addEventListener('click', () => beginSession('play'));
  el.btnLearnStart.addEventListener('click', enterTrials);
  el.btnPrompt.addEventListener('click', doPrompt);

  // Staff guide - the screen, and the same guide as a file.
  el.btnGuide.addEventListener('click', showGuide);
  el.btnGuideClose.addEventListener('click', hideGuide);
  el.btnGuideCloseFoot.addEventListener('click', hideGuide);
  el.btnGuideDownload.addEventListener('click', downloadGuide);

  el.revealPanel.addEventListener('click', revealChoices);
  el.rationaleReveal.addEventListener('click', revealRationale);
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

  // Persist settings on change - one control at a time, so only the option the
  // technician actually edited is read back off the panel.
  for (const control of SETTINGS_CONTROLS) {
    el[control.node].addEventListener('change', () => editSetting(control));
  }

  // The learner slot is not a persisted OPTION - it names which saved set of
  // options is in force - so it is wired here rather than in SETTINGS_CONTROLS.
  el.selLearner.addEventListener('change', () => switchLearner(el.selLearner.value));

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
  // The probe subsystem: tagging, selection, placement and the suppression list.
  // Read-only, and no player data - the tag of an item is a property of the item.
  probes: PROBES,
  // The staff guide's single source, so a spec can assert that the in-game
  // screen and the standalone file both come from it rather than comparing two
  // renderings and hoping.
  guide: GUIDE,
  // The Level 3 rationale vocabulary, so a spec asserts the three-way score
  // against the declaration rather than against the buttons rendered from it.
  rationaleScores: RATIONALE_SCORES.slice(),
  rationaleLabels: Object.assign({}, RATIONALE_LABELS),
  // The Why ladder's model, so a spec picks its cards by what the ladder will
  // show rather than by hard-coded id.
  whyLadder: MODEL.whyLadder,
  whyTiers: MODEL.WHY_TIERS,
  // The running session, for the specs that have to watch the lifecycle rather
  // than the data model: which deck positions hold probes, and what has already
  // yielded its generalization datum. Copies, never the live structures.
  session: () => ({
    learner: state.learner,
    deck: state.deck.map(c => ({
      id: c.id, answer: c.answer, cat: c.cat,
      isProbe: !!c.isProbe, tagKey: c.tagKey || '',
    })),
    probeSeen: Array.from(state.probeSeen),
    results: state.results.map(r => Object.assign({}, r)),
  }),
  // The settings schema as declared, so the one-row-per-persisted-option
  // invariant is checkable from the outside instead of only by reading the file.
  settings: () => ({
    cfg: Object.assign({}, state.cfg),
    defaults: settingsStore.defaults(),
    fields: Object.keys(SETTINGS_FIELDS),
    controls: SETTINGS_CONTROLS.map(c => c.option),
  }),
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
