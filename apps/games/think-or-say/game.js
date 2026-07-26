/* ── Think or Say? ─────────────────────────────────────────────────────
   A scenario card presents a thought; the learner decides whether it is a
   THINK IT (keep it inside) or a SAY IT (kind / okay to say out loud).
   Pre-K / Kindergarten social-language target.
   No build step — plain static HTML/CSS/JS.
   ----------------------------------------------------------------------- */

// ── Scenario set ───────────────────────────────────────────────────────
// answer: 'think' | 'say'.  tricky cards are held back unless enabled.
const CATEGORIES = {
  looks:   'How Someone Looks',
  smells:  'Smells',
  work:    'Their Work & Things',
  private: 'Private Things',
  kind:    'Kind Things to Say',
  other:   'Other Moments',
};

const SCENARIOS = [
  // ── How someone looks (THINK IT) ──
  { id: '1.1', cat: 'looks', answer: 'think',
    situation: 'You see a kid at school. They have a really big tummy.',
    thought: 'They have a big tummy.',
    reason: 'Think it. Talking about how someone’s body looks can hurt their feelings.' },
  { id: '1.2', cat: 'looks', answer: 'think',
    situation: 'Your grandma comes to visit. She has some hair missing on her head.',
    thought: 'Grandma doesn’t have much hair.',
    reason: 'Think it. Saying it might make Grandma feel sad.' },
  { id: '1.3', cat: 'looks', answer: 'think',
    situation: 'A boy in your class has a lot of spots on his face.',
    thought: 'He has spots all over.',
    reason: 'Think it. Saying it would embarrass him.' },
  { id: '1.4', cat: 'looks', answer: 'think',
    situation: 'Your teacher is wearing pants that look really silly to you.',
    thought: 'Those pants look funny.',
    reason: 'Think it. It would make your teacher feel bad.' },
  { id: '1.5', cat: 'looks', answer: 'think',
    situation: 'A man on the bus is very, very tall.',
    thought: 'He is so tall!',
    reason: 'Think it. Pointing out how someone’s body looks can embarrass them.' },
  { id: '1.6', cat: 'looks', answer: 'think',
    situation: 'A classmate is wearing two socks that don’t match.',
    thought: 'Their socks don’t match.',
    reason: 'Think it. They might feel embarrassed if you say it out loud.' },

  // ── Smells (THINK IT) ──
  { id: '2.1', cat: 'smells', answer: 'think',
    situation: 'You sit next to a classmate at lunch. Their food smells really strong.',
    thought: 'That smells weird.',
    reason: 'Think it. It would hurt their feelings about their food.' },
  { id: '2.2', cat: 'smells', answer: 'think',
    situation: 'A grown-up bends down to help you and you notice their breath.',
    thought: 'Their breath smells bad.',
    reason: 'Think it. Saying it would be embarrassing for them.' },

  // ── Their work & things (THINK IT) ──
  { id: '3.1', cat: 'work', answer: 'think',
    situation: 'A friend shows you a drawing they made. You think it doesn’t look very good.',
    thought: 'That drawing looks bad.',
    reason: 'Think it. They worked hard — saying it would hurt their feelings.' },
  { id: '3.2', cat: 'work', answer: 'think',
    situation: 'A classmate sings a song in circle time. You don’t like the way it sounds.',
    thought: 'That sounded really bad.',
    reason: 'Think it. Saying it would make them feel sad and not want to try.' },
  { id: '3.3', cat: 'work', answer: 'think',
    situation: 'Your friend shows you their new backpack. You think it’s ugly.',
    thought: 'I don’t like that backpack.',
    reason: 'Think it. They love their backpack — saying it would hurt their feelings.' },
  { id: '3.4', cat: 'work', answer: 'think',
    situation: 'A classmate gives the wrong answer in class.',
    thought: 'That was wrong.',
    reason: 'Think it. Saying it out loud would embarrass them.' },

  // ── Private things (THINK IT) ──
  { id: '4.1', cat: 'private', answer: 'think',
    situation: 'You see a classmate pull up their pants.',
    thought: 'I saw their underwear.',
    reason: 'Think it. That is private — saying it would embarrass them.' },
  { id: '4.2', cat: 'private', answer: 'think',
    situation: 'A kid at school has a small accident and their pants get wet.',
    thought: 'They had an accident.',
    reason: 'Think it. That is private and saying it would feel very embarrassing.' },
  { id: '4.3', cat: 'private', answer: 'think',
    situation: 'You notice a classmate picking their nose when they think no one is watching.',
    thought: 'I see them picking their nose.',
    reason: 'Think it. Saying it out loud would embarrass them.' },

  // ── Kind things to say (SAY IT) ──
  { id: '5.1', cat: 'kind', answer: 'say',
    situation: 'Your friend gets a new shirt with a dinosaur on it. You love dinosaurs too.',
    thought: 'I love that shirt!',
    reason: 'Say it! A kind compliment will make your friend happy.' },
  { id: '5.2', cat: 'kind', answer: 'say',
    situation: 'Your teacher reads a really funny story and you laugh.',
    thought: 'That story was so funny!',
    reason: 'Say it! Your teacher will feel happy you liked it.' },
  { id: '5.3', cat: 'kind', answer: 'say',
    situation: 'A classmate looks sad on the playground.',
    thought: 'I hope they feel better.',
    reason: 'Say it! You could say “Are you okay?” — it helps them feel less alone.' },
  { id: '5.4', cat: 'kind', answer: 'say',
    situation: 'Your friend helps you pick up your crayons when you drop them.',
    thought: 'That was really nice of them.',
    reason: 'Say it! Saying “Thank you!” is kind and makes friends feel good.' },
  { id: '5.5', cat: 'kind', answer: 'say',
    situation: 'Your mom makes your favorite dinner.',
    thought: 'This tastes SO good!',
    reason: 'Say it! It will make Mom happy to hear it.' },
  { id: '5.6', cat: 'kind', answer: 'say',
    situation: 'You don’t understand how to do the worksheet.',
    thought: 'I need help.',
    reason: 'Say it! Asking for help is always okay.' },
  { id: '5.7', cat: 'kind', answer: 'say',
    situation: 'Your tummy hurts at school.',
    thought: 'My tummy doesn’t feel good.',
    reason: 'Say it! Telling a grown-up when you feel sick is important.' },
  { id: '5.8', cat: 'kind', answer: 'say',
    situation: 'Your classmate shares their snack with you.',
    thought: 'That was so kind!',
    reason: 'Say it! “That was so nice, thank you!” makes friends feel great.' },
  { id: '5.9', cat: 'kind', answer: 'say',
    situation: 'Your friend makes it to the top of the climbing wall.',
    thought: 'They did it!',
    reason: 'Say it! Cheering a friend on is kind and fun.' },
  { id: '5.10', cat: 'kind', answer: 'say',
    situation: 'It is your friend’s birthday today.',
    thought: 'Happy birthday!',
    reason: 'Say it! Wishing a friend happy birthday makes them feel special.' },
  { id: '5.11', cat: 'kind', answer: 'say',
    situation: 'Your teacher got a new haircut and you really like it.',
    thought: 'I like their haircut!',
    reason: 'Say it! A kind compliment is a nice thing to share.' },
  { id: '5.12', cat: 'kind', answer: 'say',
    situation: 'You finished all your work and you feel proud.',
    thought: 'I did it!',
    reason: 'Say it! Sharing happy news about yourself is great.' },

  // ── Other moments ──
  { id: '6.1', cat: 'other', answer: 'think',
    situation: 'A baby on the bus is crying very loudly.',
    thought: 'That baby is so loud.',
    reason: 'Think it. Saying it might make the baby’s family feel bad.' },
  { id: '6.2', cat: 'other', answer: 'say',
    situation: 'A classmate took your turn by accident and you still want your turn.',
    thought: 'It’s my turn.',
    reason: 'Say it! You can speak up kindly: “I think it’s my turn.”' },

  // ── Tricky / reasoning cards (held back unless enabled) ──
  { id: 'T1', cat: 'looks', tricky: true, answer: 'think',
    situation: 'You think your friend’s new haircut looks really strange.',
    thought: 'That haircut looks weird.',
    reason: 'Think it. Even if it feels true, it would hurt their feelings — and they can’t change it right now.' },
  { id: 'T2', cat: 'kind', tricky: true, answer: 'say',
    situation: 'You notice your close friend has a little food stuck in their teeth.',
    thought: 'They have food in their teeth.',
    reason: 'You can say it — quietly and kindly, just to them: “Hey, you have something in your teeth.” Shouting it in front of everyone would be a think it. How and when we say it matters!' },
  { id: 'T3', cat: 'other', tricky: true, answer: 'say',
    situation: 'A classmate is about to run into the street where cars are driving.',
    thought: 'That’s dangerous!',
    reason: 'Say it — loudly, and tell a grown-up! When someone might get hurt, it is always right to speak up.' },
];

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
  chkIncludeTricky:$('chk-include-tricky'),
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
const RESULTS_KEY  = 'tosResults';

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
  includeTricky:   { type: 'bool', default: false },
};

const settingsStore = window.NooutcoSettings.defineStore({
  key: SETTINGS_KEY,
  legacyKey: LEGACY_SETTINGS_KEY,
  fields: SETTINGS_FIELDS,
});

/**
 * `tosSettings` spelled the prompt delay `promptDelaySec` — singular, and
 * stored as a STRING — which is a third spelling of the option eight other
 * games call `promptDelaySecs`. The fold renames it forward onto the shared
 * spelling; `tosSettings` itself keeps its own key, its own spelling and its
 * own string, untouched, because the fold never rewrites the retired key.
 */
function foldRetiredSettings(legacy) {
  const { promptDelaySec, ...rest } = legacy;
  return promptDelaySec == null ? rest : { ...rest, promptDelaySecs: promptDelaySec };
}

/**
 * Each panel control, the option it edits, and how its value is read.
 *
 * One row per persisted option, so a control can never edit an option the
 * field spec does not declare (and vice versa — asserted by the settings
 * store's own normalize()). Reading a control happens here and nowhere else.
 */
const SETTINGS_CONTROLS = [
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
  { node: 'chkIncludeTricky', option: 'includeTricky',   read: n => n.checked, write: (n, v) => { n.checked = v; } },
];

/** Render the panel from the configuration in force, so the two cannot diverge. */
function applySettingsToControls(cfg) {
  for (const c of SETTINGS_CONTROLS) c.write(el[c.node], cfg[c.option]);
  syncPromptDelayEnabled();
}

function loadSettings() {
  // Read-then-fold, never drop. Runs at most once; `tosSettings` is left intact.
  settingsStore.foldLegacy({ map: foldRetiredSettings });
  state.cfg = settingsStore.initial();
  applySettingsToControls(state.cfg);
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
function buildDeck() {
  const cat = state.cfg.category;
  const includeTricky = state.cfg.includeTricky;
  let pool = SCENARIOS.filter(s => {
    if (s.tricky && !includeTricky) return false;
    if (cat !== 'all' && s.cat !== cat) return false;
    return true;
  });
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
    alert('No cards match these settings. Try a different category or enable tricky cards.');
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
  el.thought.innerHTML = 'You think: <span class="quote">“' + escapeHtml(sc.thought) + '”</span>';

  el.reason.hidden = true;
  el.reason.className = '';

  choiceEls().forEach(c => {
    c.className = 'choice choice-' + c.dataset.answer;
    c.disabled = false;
  });

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
  // Re-present a missed card once, at the end of the deck.
  const sc = state.current;
  if (willRepresent()) {
    state.represented.add(sc.id);
    state.deck.push(sc);
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
  state.results.push({
    cat: CATEGORIES[sc.cat] || sc.cat,
    scenario: sc.situation,
    answer: sc.answer === 'think' ? 'THINK IT' : 'SAY IT',
    errors: state.trialErrors,
    prompted: state.trialPrompted,
    secs,
    outcome,
  });
  saveResults();
}

function saveResults() {
  try { localStorage.setItem(RESULTS_KEY, JSON.stringify(state.results)); } catch (e) {}
}

function loadResults() {
  try { state.results = JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]'); } catch (e) { state.results = []; }
}

function buildPrint() {
  const rows = state.results.map((r, i) => {
    const outClass = 'outcome-' + r.outcome;
    const outLabel = r.outcome === 'ok' ? 'Independent'
                   : r.outcome === 'prompted' ? 'Prompted' : 'Error then correct';
    return `<tr>
      <td>${i + 1}</td>
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
