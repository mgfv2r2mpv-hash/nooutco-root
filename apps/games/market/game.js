'use strict';

/* ══════════════════════════════════════════════════════════════════
   MATCHING MARKET — matching game with corner-market theme
   Core matching logic ported from IDMatchGame; rendering / payoff
   sequence is the market scene.
   ══════════════════════════════════════════════════════════════════ */

// Images live in the IDMatchGame sibling folder; we re-use that manifest.
const IMAGE_BASE = '../../IDMatchGame/IDMatchGame/';

// ── Utilities ──────────────────────────────────────────────────────

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function srcLabel(src) {
  return src.split('/').pop()
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function captionFor(src) {
  const w = srcLabel(src).toLowerCase();
  const article = /^[aeiou]/.test(w) ? 'an' : 'a';
  return `I'd like ${article} ${w}, please.`;
}

// ── State ──────────────────────────────────────────────────────────

const state = {
  topic: '',
  arraySize: 4,
  animTier: 'full',
  showCaption: false,
  sameCustomerOnRetry: true,
  representErrors: true,
  errorless: false,
  noErrorAnim: false,
  nonTargetDistractors: true,
  crossCategory: false,
  promptPersists: false,
  promptStyle: 'sparkle',
  autoPromptEnabled: false,
  promptDelay: false,
  promptDelaySecs: 3,
  targetFilters: {},

  extraPanelOpen: false,
  targetPanelOpen: false,

  manifest:     null,
  topicFolders: [],
  topicImages:  [],
  otherImages:  [],

  active: false,
  sessionData: [],
  trialNum: 0,

  sampleSrc: '',
  tileImages: [],
  correctIdx: 0,
  trialErrors: 0,
  trialStart: 0,
  prompted: false,
  autoPrompted: false,
  isRepeatTrial: false,
  customerSeed: 0,

  posDeck: [],

  timerSecs: 0,
  timerRunning: false,
  timerHandle: null,
  timerAutoPaused: false,

  promptHandle: null,
  autoPromptHandle: null,

  // Token Board
  tokenBoardEnabled: false,
  scheduleType: 'FR',
  scheduleValue: 1,
  startingTokens: 0,
  goalTokens: 10,
  tokenEmoji: 'random',
  chosenEmoji: '⭐',
  currentTokens: 0,
  trialsCompleted: 0,
  vr_schedule: [],
  vr_scheduleTrial: 0,
};

// ── DOM references ─────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const el = {
  timerDisplay:   $('timer-display'),
  btnTimerToggle: $('btn-timer-toggle'),
  btnTimerReset:  $('btn-timer-reset'),

  selTopic:       $('sel-topic'),
  inpSize:        $('inp-size'),
  chkCross:       $('chk-cross'),
  chkPersists:    $('chk-persists'),
  selPromptStyle: $('sel-prompt-style'),
  chkAutoPrompt:  $('chk-auto-prompt'),
  chkPromptDelay: $('chk-prompt-delay'),
  selPromptDelay: $('sel-prompt-delay'),
  btnStart:       $('btn-start'),

  gameArea:       $('game-area'),
  marketStage:    $('market-stage'),
  customerLayer:  $('customer-layer'),
  speechBubble:   $('speech-bubble'),
  speechCaption:  $('speech-caption'),
  sampleImg:      $('sample-img'),
  bag:            $('bag-on-counter'),
  floatingEmojis: $('floating-emojis'),
  compGrid:       $('comp-grid'),
  compSection:    $('comp-section'),
  shelfPlanks:    $('shelf-planks'),

  btnPrompt:      $('btn-prompt'),
  btnPrint:       $('btn-print'),
  btnClearData:   $('btn-clear-data'),

  resultsBody:        $('results-body'),
  printMeta:          $('print-meta'),
  printSummary:       $('print-summary'),

  chkRepresentErrors: $('chk-represent-errors'),
  chkErrorless:       $('chk-errorless'),
  chkNoErrorAnim:     $('chk-no-error-anim'),
  chkNonTargetDistractor: $('chk-non-target-distractor'),
  selAnimTier:        $('sel-anim-tier'),
  chkCaption:         $('chk-caption'),
  chkSameCustomer:    $('chk-same-customer'),

  btnExtraToggle:     $('btn-extra-toggle'),
  extraPanel:         $('extra-panel'),
  btnExtraClose:      $('btn-extra-close'),

  btnTargetsToggle:   $('btn-targets-toggle'),
  targetsCount:       $('targets-count'),
  targetPanel:        $('target-panel'),
  targetPanelBody:    $('target-panel-body'),
  btnTargetsAll:      $('btn-targets-all'),
  btnTargetsNone:     $('btn-targets-none'),
  btnTargetsClose:    $('btn-targets-close'),

  // Token Board
  chkTokenBoard:      $('chk-token-board'),
  tokenSettings:      $('token-settings'),
  selScheduleType:    $('sel-schedule-type'),
  inpScheduleValue:   $('inp-schedule-value'),
  inpStartingTokens:  $('inp-starting-tokens'),
  inpGoalTokens:      $('inp-goal-tokens'),
  selTokenEmoji:      $('sel-token-emoji'),
  tokenBoard:         $('token-board'),
  tokenEmojiDisplay:  $('token-emoji-display'),
  tokenProgressText:  $('token-progress-text'),
};

// ── Boot ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  if (window.NooutcoConfig) NooutcoConfig.migrate();
  loadSettings();
  restoreResults();
  bindEvents();
  await discoverTopics();
});

// ── Durable results persistence (device-local; never transmitted) ──────

const RESULTS_KEY = 'mmResults';

function persistResults() {
  if (window.NooutcoResults) NooutcoResults.save(RESULTS_KEY, state.sessionData);
}

function restoreResults() {
  if (!window.NooutcoResults) return;
  const saved = NooutcoResults.load(RESULTS_KEY);
  if (Array.isArray(saved) && saved.length) {
    state.sessionData = saved;
    state.trialNum = saved.reduce((max, d) => Math.max(max, d.trial || 0), 0);
  }
}

// Toolbar display slider (Simple / Visual) maps to the animation tier.
window.__setGameDisplayMode = function (mode) {
  state.animTier = (mode === 'visual') ? 'full' : 'minimal';
  if (el.selAnimTier) el.selAnimTier.value = state.animTier;
  saveSettings();
};

// ── Settings ───────────────────────────────────────────────────────

function loadSettings() {
  const s = JSON.parse(localStorage.getItem('mmSettings') || '{}');
  state.topic                = s.topic                ?? '';
  state.arraySize            = s.arraySize            ?? 4;
  state.animTier             = s.animTier             ?? 'full';
  state.showCaption          = s.showCaption          ?? false;
  state.sameCustomerOnRetry  = s.sameCustomerOnRetry  ?? true;
  state.representErrors      = s.representErrors      ?? true;
  state.errorless            = s.errorless            ?? false;
  state.noErrorAnim          = s.noErrorAnim          ?? false;
  state.nonTargetDistractors = s.nonTargetDistractors ?? true;
  state.crossCategory        = s.crossCategory        ?? false;
  state.promptPersists       = s.promptPersists       ?? false;
  state.promptStyle          = s.promptStyle          ?? 'sparkle';
  state.autoPromptEnabled    = s.autoPromptEnabled    ?? false;
  state.promptDelay          = s.promptDelay          ?? false;
  state.promptDelaySecs      = s.promptDelaySecs      ?? 3;
  state.targetFilters        = s.targetFilters        ?? {};

  state.tokenBoardEnabled    = s.tokenBoardEnabled    ?? false;
  state.scheduleType         = s.scheduleType         ?? 'FR';
  state.scheduleValue        = s.scheduleValue        ?? 1;
  state.startingTokens       = s.startingTokens       ?? 0;
  state.goalTokens           = s.goalTokens           ?? 10;
  state.tokenEmoji           = s.tokenEmoji           ?? 'random';
  state.chosenEmoji          = s.chosenEmoji          ?? '⭐';
  state.currentTokens        = s.currentTokens        ?? state.startingTokens;

  el.inpSize.value                   = state.arraySize;
  el.selAnimTier.value               = state.animTier;
  if (window.__syncDisplayToggle) window.__syncDisplayToggle(state.animTier === 'full' ? 'visual' : 'simple');
  el.chkCaption.checked              = state.showCaption;
  el.chkSameCustomer.checked         = state.sameCustomerOnRetry;
  el.chkRepresentErrors.checked      = state.representErrors;
  el.chkErrorless.checked            = state.errorless;
  el.chkNoErrorAnim.checked          = state.noErrorAnim;
  el.chkNonTargetDistractor.checked  = state.nonTargetDistractors;
  el.chkCross.checked                = state.crossCategory;
  el.chkPersists.checked             = state.promptPersists;
  el.selPromptStyle.value            = state.promptStyle;
  el.chkAutoPrompt.checked           = state.autoPromptEnabled;
  el.chkPromptDelay.checked          = state.promptDelay;
  el.selPromptDelay.value            = state.promptDelaySecs;

  el.chkTokenBoard.checked           = state.tokenBoardEnabled;
  el.selScheduleType.value           = state.scheduleType;
  el.inpScheduleValue.value          = state.scheduleValue;
  el.inpStartingTokens.value         = state.startingTokens;
  el.inpGoalTokens.value             = state.goalTokens;
  el.selTokenEmoji.value             = state.tokenEmoji;

  el.chkPromptDelay.disabled = !state.autoPromptEnabled;
  el.selPromptDelay.disabled = !state.autoPromptEnabled || !state.promptDelay;

  updateTokenBoardUIVisibility();
  if (state.tokenBoardEnabled) {
    initializeTokenBoard();
  }
}

function saveSettings() {
  localStorage.setItem('mmSettings', JSON.stringify({
    topic:                state.topic,
    arraySize:            state.arraySize,
    animTier:             state.animTier,
    showCaption:          state.showCaption,
    sameCustomerOnRetry:  state.sameCustomerOnRetry,
    representErrors:      state.representErrors,
    errorless:            state.errorless,
    noErrorAnim:          state.noErrorAnim,
    nonTargetDistractors: state.nonTargetDistractors,
    crossCategory:        state.crossCategory,
    promptPersists:       state.promptPersists,
    promptStyle:          state.promptStyle,
    autoPromptEnabled:    state.autoPromptEnabled,
    promptDelay:          state.promptDelay,
    promptDelaySecs:      state.promptDelaySecs,
    targetFilters:        state.targetFilters,
    tokenBoardEnabled:    state.tokenBoardEnabled,
    scheduleType:         state.scheduleType,
    scheduleValue:        state.scheduleValue,
    startingTokens:       state.startingTokens,
    goalTokens:           state.goalTokens,
    tokenEmoji:           state.tokenEmoji,
    chosenEmoji:          state.chosenEmoji,
    currentTokens:        state.currentTokens,
  }));
}

// ── Image discovery ────────────────────────────────────────────────

async function discoverTopics() {
  try {
    const r = await fetch(IMAGE_BASE + 'manifest.json');
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data.folders) && data.folders.length) {
        state.manifest = data;
        state.topicFolders = data.folders;
        buildTopicDropdown(data.folders);
        const saved = data.folders.includes(state.topic) ? state.topic : data.folders[0];
        state.topic = saved;
        el.selTopic.value = saved;
        await refreshImages();
        return;
      }
    }
  } catch { /* fall through */ }

  console.warn('Could not load manifest.json from', IMAGE_BASE);
  buildTopicDropdown([]);
}

const TOPIC_DISPLAY_NAMES = {
  'T_pbs_characters': 'PBS Characters',
};

function buildTopicDropdown(dirs) {
  el.selTopic.innerHTML = '';
  if (!dirs.length) {
    el.selTopic.innerHTML = '<option value="">-- No topics found --</option>';
    return;
  }
  dirs.forEach(d => {
    const o = document.createElement('option');
    o.value = d;
    o.textContent = TOPIC_DISPLAY_NAMES[d] ||
      d.slice(2).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    el.selTopic.appendChild(o);
  });
}

function withBase(srcs) {
  return srcs.map(s => IMAGE_BASE + s);
}

async function refreshImages() {
  if (!state.topic || !state.manifest) {
    state.topicImages = []; state.otherImages = []; updateTargetsCount(); return;
  }
  state.topicImages = withBase(state.manifest.images[state.topic] || []);
  state.otherImages = (state.crossCategory && state.topicFolders.length > 1)
    ? withBase(state.topicFolders
        .filter(f => f !== state.topic)
        .flatMap(f => state.manifest.images[f] || []))
    : [];

  pruneStaleTargetFilter();
  updateTargetsCount();
  if (state.targetPanelOpen) renderTargetPanel();
}

function pruneStaleTargetFilter() {
  const filter = state.targetFilters[state.topic];
  if (!filter || !filter.length) return;
  const known = new Set(state.topicImages);
  const pruned = filter.filter(src => known.has(src));
  if (pruned.length !== filter.length) {
    state.targetFilters[state.topic] = pruned;
    saveSettings();
  }
}

// ── Event bindings ─────────────────────────────────────────────────

function bindEvents() {
  el.btnTimerToggle.addEventListener('click', toggleTimer);
  el.btnTimerReset.addEventListener('click',  resetTimer);

  el.selTopic.addEventListener('change', async () => {
    state.topic = el.selTopic.value;
    saveSettings();
    await refreshImages();
  });

  el.inpSize.addEventListener('change', async () => {
    const v = Math.min(10, Math.max(1, parseInt(el.inpSize.value) || 4));
    state.arraySize = v;
    el.inpSize.value = v;
    state.posDeck = [];
    saveSettings();
    await refreshImages();
  });

  el.selAnimTier.addEventListener('change', () => {
    state.animTier = el.selAnimTier.value;
    saveSettings();
    if (window.__syncDisplayToggle) window.__syncDisplayToggle(state.animTier === 'full' ? 'visual' : 'simple');
  });
  el.chkCaption.addEventListener('change', () => {
    state.showCaption = el.chkCaption.checked;
    saveSettings();
    if (state.active) updateCaption();
  });
  el.chkSameCustomer.addEventListener('change', () => {
    state.sameCustomerOnRetry = el.chkSameCustomer.checked;
    saveSettings();
  });

  el.chkNonTargetDistractor.addEventListener('change', () => {
    state.nonTargetDistractors = el.chkNonTargetDistractor.checked;
    saveSettings();
  });
  el.chkCross.addEventListener('change', async () => {
    state.crossCategory = el.chkCross.checked;
    saveSettings();
    await refreshImages();
  });

  el.btnTargetsToggle.addEventListener('click', toggleTargetPanel);
  el.btnTargetsClose .addEventListener('click', () => setTargetPanelOpen(false));
  el.btnTargetsAll   .addEventListener('click', () => setAllTargets(true));
  el.btnTargetsNone  .addEventListener('click', () => setAllTargets(false));

  el.chkPersists.addEventListener('change', () => {
    state.promptPersists = el.chkPersists.checked;
    saveSettings();
  });
  el.selPromptStyle.addEventListener('change', () => {
    state.promptStyle = el.selPromptStyle.value;
    saveSettings();
  });
  el.chkAutoPrompt.addEventListener('change', () => {
    state.autoPromptEnabled = el.chkAutoPrompt.checked;
    el.chkPromptDelay.disabled = !state.autoPromptEnabled;
    el.selPromptDelay.disabled = !state.autoPromptEnabled || !state.promptDelay;
    saveSettings();
  });
  el.chkPromptDelay.addEventListener('change', () => {
    state.promptDelay = el.chkPromptDelay.checked;
    el.selPromptDelay.disabled = !state.promptDelay;
    saveSettings();
  });
  el.selPromptDelay.addEventListener('change', () => {
    state.promptDelaySecs = parseInt(el.selPromptDelay.value);
    saveSettings();
  });

  el.btnExtraToggle.addEventListener('click', toggleExtraPanel);
  el.btnExtraClose .addEventListener('click', () => setExtraPanelOpen(false));
  el.chkRepresentErrors.addEventListener('change', () => { state.representErrors = el.chkRepresentErrors.checked; saveSettings(); });
  el.chkErrorless.addEventListener('change',       () => { state.errorless       = el.chkErrorless.checked;       saveSettings(); });
  el.chkNoErrorAnim.addEventListener('change',     () => { state.noErrorAnim     = el.chkNoErrorAnim.checked;     saveSettings(); });

  el.btnStart.addEventListener('click',  startGame);
  el.btnPrompt.addEventListener('click', onPromptButton);
  el.btnPrint.addEventListener('click',  printData);

  el.btnClearData.addEventListener('click', () => {
    if (!state.sessionData.length) { alert('No data to clear.'); return; }
    if (!confirm('Clear all trial data? This cannot be undone.')) return;
    state.sessionData = [];
    state.trialNum = 0;
    el.resultsBody.innerHTML = '';
    if (window.NooutcoResults) NooutcoResults.clear(RESULTS_KEY);
  });

  // Token Board Events
  el.chkTokenBoard.addEventListener('change', () => {
    state.tokenBoardEnabled = el.chkTokenBoard.checked;
    updateTokenBoardUIVisibility();
    if (state.tokenBoardEnabled) {
      initializeTokenBoard();
    } else {
      el.tokenBoard.hidden = true;
    }
    saveSettings();
  });

  el.selScheduleType.addEventListener('change', () => {
    state.scheduleType = el.selScheduleType.value;
    saveSettings();
  });

  el.inpScheduleValue.addEventListener('change', () => {
    state.scheduleValue = parseInt(el.inpScheduleValue.value) || 1;
    el.inpScheduleValue.value = state.scheduleValue;
    saveSettings();
  });

  el.inpStartingTokens.addEventListener('change', () => {
    state.startingTokens = parseInt(el.inpStartingTokens.value) || 0;
    el.inpStartingTokens.value = state.startingTokens;
    state.currentTokens = state.startingTokens;
    renderTokenBoard();
    saveSettings();
  });

  el.inpGoalTokens.addEventListener('change', () => {
    state.goalTokens = parseInt(el.inpGoalTokens.value) || 10;
    el.inpGoalTokens.value = state.goalTokens;
    renderTokenBoard();
    saveSettings();
  });

  el.selTokenEmoji.addEventListener('change', () => {
    state.tokenEmoji = el.selTokenEmoji.value;
    initializeTokenBoard();
    saveSettings();
  });
}

// ── Timer ──────────────────────────────────────────────────────────

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
  state.trialStart = Date.now();
  renderTimer();
}
function renderTimer() {
  const m = String(Math.floor(state.timerSecs / 60)).padStart(2, '0');
  const s = String(state.timerSecs % 60).padStart(2, '0');
  el.timerDisplay.textContent = `${m}:${s}`;
}

// ── Position deck ──────────────────────────────────────────────────

function nextPosition() {
  if (!state.posDeck.length) {
    state.posDeck = shuffle([...Array(state.arraySize).keys()]);
  }
  return state.posDeck.pop();
}

// ── Game flow ──────────────────────────────────────────────────────

function startGame() {
  if (!state.topic) { alert('Please select a topic from the dropdown first.'); return; }
  if (!state.topicImages.length) {
    alert(`No images found in ${state.topic}/.\nCheck that the IDMatchGame folder is present alongside this one.`);
    return;
  }

  state.active = true;
  state.posDeck = [];

  el.gameArea.removeAttribute('hidden');
  el.btnPrompt.removeAttribute('hidden');
  removeTrialButtons();

  // Initialize token board if enabled
  if (state.tokenBoardEnabled) {
    initializeTokenBoard();
  }

  resetTimer();
  startTimer();
  beginTrial();
}

function beginTrial(keepSample = false, isRetry = false) {
  state.trialNum++;
  state.trialErrors = 0;
  state.prompted = false;
  state.autoPrompted = false;
  state.isRepeatTrial = keepSample && !isRetry;
  state.trialStart = Date.now();

  // Customer seed: deterministic per trial number, unless retry/keepSample
  // and the "same customer" option is on (re-use prior seed).
  if (!(state.sameCustomerOnRetry && (keepSample || isRetry))) {
    state.customerSeed = Date.now() & 0x7fffffff;
  }

  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;
  clearPrompt();

  buildTrial(keepSample || isRetry);
  renderTrial();

  if (keepSample && !isRetry) {
    state.autoPrompted = true;
    setTimeout(applyPrompt, getTierBubbleDelay() + 80);
  } else if (!keepSample && !isRetry && state.autoPromptEnabled) {
    if (state.promptDelay) {
      state.autoPromptHandle = setTimeout(() => {
        state.autoPrompted = true;
        state.autoPromptHandle = null;
        applyPrompt();
      }, state.promptDelaySecs * 1000);
    } else {
      state.autoPrompted = true;
      setTimeout(applyPrompt, getTierBubbleDelay() + 80);
    }
  }
}

function buildTrial(keepSample) {
  const n = state.arraySize;

  if (!keepSample) {
    const filter = state.targetFilters[state.topic] || [];
    const candidatePool = filter.length
      ? state.topicImages.filter(src => filter.includes(src))
      : state.topicImages;
    state.sampleSrc = pickRandom(candidatePool.length ? candidatePool : state.topicImages);
  }

  const filter = state.targetFilters[state.topic] || [];
  const eligibleTargets = filter.length
    ? state.topicImages.filter(src => filter.includes(src))
    : state.topicImages;

  let basePool;
  if (state.crossCategory) {
    basePool = [...state.topicImages, ...state.otherImages];
  } else if (state.nonTargetDistractors) {
    basePool = [...state.topicImages];
  } else {
    basePool = [...eligibleTargets];
  }

  const distractorPool = shuffle(basePool.filter(src => src !== state.sampleSrc));
  const getDistractor = i =>
    distractorPool.length ? distractorPool[i % distractorPool.length] : state.sampleSrc;

  const correctPos = nextPosition();
  state.correctIdx = correctPos;
  state.tileImages = new Array(n);
  let di = 0;
  for (let i = 0; i < n; i++) {
    state.tileImages[i] = (i === correctPos) ? state.sampleSrc : getDistractor(di++);
  }
}

// ── Render the market scene ────────────────────────────────────────

function gridCols(n) {
  const map = { 1:1, 2:2, 3:3, 4:2, 5:3, 6:3, 7:4, 8:4, 9:3, 10:5 };
  return map[n] ?? 4;
}

/* Place a wooden plank under each bucket row so tiles always appear to
   rest on a shelf regardless of array size. */
function renderShelfPlanks(rows) {
  if (!el.shelfPlanks) return;
  el.shelfPlanks.innerHTML = '';
  for (let i = 0; i < rows; i++) {
    const p = document.createElement('div');
    p.className = 'shelf-plank';
    p.style.top = `${((i + 1) / rows) * 100}%`;
    el.shelfPlanks.appendChild(p);
  }
}

function renderTrial() {
  // Sample image in speech bubble
  el.sampleImg.src = state.sampleSrc;
  el.sampleImg.alt = 'Customer request';
  updateCaption();

  // Comparison grid (buckets)
  const cols = gridCols(state.arraySize);
  const rows = Math.max(1, Math.ceil(state.arraySize / cols));
  el.compGrid.style.setProperty('--grid-cols', cols);
  el.compGrid.innerHTML = '';
  state.tileImages.forEach((src, idx) => {
    const bucket = document.createElement('div');
    bucket.className = 'bucket';
    bucket.dataset.index = idx;
    const img = document.createElement('img');
    img.src = src;
    img.alt = `Choice ${idx + 1}`;
    bucket.appendChild(img);
    bucket.addEventListener('click', () => onTileClick(idx));
    el.compGrid.appendChild(bucket);
  });
  renderShelfPlanks(rows);

  // Customer
  renderCustomer();

  // Reset bag state
  el.bag.classList.remove('bag-shake', 'bag-handoff');
  el.bag.style.opacity = '';

  // Hide speech bubble briefly, then pop in (after walk-in if Full)
  el.speechBubble.classList.remove('shown', 'hiding');
  const bubbleDelay = getTierBubbleDelay();
  setTimeout(() => el.speechBubble.classList.add('shown'), bubbleDelay);
}

function updateCaption() {
  if (!state.sampleSrc) return;
  el.speechCaption.textContent = captionFor(state.sampleSrc);
  if (state.showCaption) el.speechCaption.removeAttribute('hidden');
  else el.speechCaption.setAttribute('hidden', '');
}

function renderCustomer() {
  el.customerLayer.innerHTML = '';
  el.customerLayer.classList.remove('tier-full', 'tier-light', 'entering', 'exiting');

  if (state.animTier === 'minimal') {
    // No customer art in minimal mode
    return;
  }

  const svg = window.MMCharacters.buildCustomer(state.customerSeed);
  el.customerLayer.appendChild(svg);

  const tier = state.animTier === 'full' ? 'tier-full' : 'tier-light';
  el.customerLayer.classList.add(tier, 'entering');
  // Strip 'entering' after animation so subsequent transforms work
  const dur = state.animTier === 'full' ? 760 : 300;
  setTimeout(() => el.customerLayer.classList.remove('entering'), dur);
}

function getTierBubbleDelay() {
  if (state.animTier === 'full')    return 720;  // wait for walk-in
  if (state.animTier === 'light')   return 240;
  return 80;
}

// ── Tile (bucket) interaction ──────────────────────────────────────

function onTileClick(idx) {
  if (!state.active) return;
  const bucket = getBucket(idx);
  if (!bucket || bucket.classList.contains('bucket-disabled')) return;

  if (idx === state.correctIdx) onCorrectClick(bucket);
  else if (!state.errorless)    onWrongClick(bucket);
}

function getBucket(idx) {
  return el.compGrid.querySelector(`.bucket[data-index="${idx}"]`);
}

function onCorrectClick(bucket) {
  disableAllBuckets();
  clearPrompt();
  if (state.timerRunning) { pauseTimer(); state.timerAutoPaused = true; }

  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;

  const elapsed = ((Date.now() - state.trialStart) / 1000).toFixed(1);

  let outcome;
  if (state.isRepeatTrial) {
    outcome = state.trialErrors > 0 ? 'Repeat Error' : 'Correction';
  } else if (state.trialErrors > 0) {
    outcome = 'Error';
  } else if (state.prompted || state.autoPrompted) {
    outcome = 'Prompted';
  } else {
    outcome = 'Correct';
  }

  state.sessionData.push({
    trial:     state.trialNum,
    topic:     state.topic.slice(2).replace(/_/g, ' '),
    sample:    state.sampleSrc.split('/').pop(),
    arraySize: state.arraySize,
    errors:    state.trialErrors,
    prompted:  state.prompted || state.autoPrompted,
    promptDelaySecs: (!state.isRepeatTrial && state.autoPromptEnabled && state.promptDelay)
      ? state.promptDelaySecs : null,
    time:      elapsed,
    outcome,
    settingsKey: [
      state.topic, state.arraySize,
      state.representErrors   ? 1 : 0,
      state.errorless         ? 1 : 0,
      state.noErrorAnim       ? 1 : 0,
      state.autoPromptEnabled ? 1 : 0,
      state.promptPersists    ? 1 : 0,
      state.promptStyle,
      state.promptDelay ? state.promptDelaySecs : 0,
      state.animTier,
    ].join('|'),
  });
  persistResults();

  // Award tokens on correct response
  if (outcome === 'Correct') {
    awardTokensForTrial();
  }

  playCorrectSequence(bucket).then(() => showTrialButtons());
}

/**
 * Item flies from clicked bucket to the paper bag, customer grins,
 * emoji float, bag hands off, customer exits. Minimal tier short-circuits
 * to just a brief bag shake.
 */
function playCorrectSequence(bucket) {
  return new Promise(resolve => {
    const stageRect  = el.marketStage.getBoundingClientRect();
    const bucketRect = bucket.getBoundingClientRect();
    const bagRect    = el.bag.getBoundingClientRect();

    const img = bucket.querySelector('img');

    // Clone the item image and animate it from bucket to bag.
    const flying = document.createElement('img');
    flying.src = img ? img.src : '';
    flying.alt = '';
    flying.className = 'item-flying';
    flying.style.left   = (bucketRect.left - stageRect.left + bucketRect.width  * 0.11) + 'px';
    flying.style.top    = (bucketRect.top  - stageRect.top  + bucketRect.height * 0.11) + 'px';
    flying.style.width  = (bucketRect.width  * 0.78) + 'px';
    flying.style.height = (bucketRect.height * 0.78) + 'px';
    const dx = (bagRect.left + bagRect.width / 2) - (bucketRect.left + bucketRect.width / 2);
    const dy = (bagRect.top  + bagRect.height / 2) - (bucketRect.top  + bucketRect.height / 2);
    flying.style.setProperty('--dx', dx + 'px');
    flying.style.setProperty('--dy', dy + 'px');
    el.marketStage.appendChild(flying);

    // Hide the bucket's own image so it doesn't appear duplicated
    if (img) img.style.opacity = '0';

    setTimeout(() => {
      el.bag.classList.add('bag-shake');
    }, 380);

    setTimeout(() => {
      flying.remove();
      el.bag.classList.remove('bag-shake');

      // Customer grin
      const svg = el.customerLayer.querySelector('.customer-svg');
      if (svg && window.MMCharacters) window.MMCharacters.setCustomerGrin(svg, true);

      // Floating emojis
      if (state.animTier !== 'minimal') {
        spawnFloatingEmoji('😊', 0);
        spawnFloatingEmoji('🪙', 240);
      }
    }, 600);

    if (state.animTier === 'minimal') {
      setTimeout(resolve, 700);
      return;
    }

    // Bag hands off, customer walks out
    setTimeout(() => {
      el.bag.classList.add('bag-handoff');
    }, 900);

    setTimeout(() => {
      el.customerLayer.classList.add('exiting');
    }, 1100);

    const exitDur = state.animTier === 'full' ? 800 : 320;
    setTimeout(resolve, 1100 + exitDur);
  });
}

function spawnFloatingEmoji(glyph, delay) {
  setTimeout(() => {
    const span = document.createElement('span');
    span.className = 'floating-emoji';
    span.textContent = glyph;
    span.style.left = (10 + Math.random() * 50) + '%';
    span.style.top  = (40 + Math.random() * 30) + '%';
    el.floatingEmojis.appendChild(span);
    setTimeout(() => span.remove(), 1200);
  }, delay);
}

function onWrongClick(bucket) {
  state.trialErrors++;
  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;

  if (!state.noErrorAnim) {
    bucket.classList.add('jiggle', 'flash-red');
    setTimeout(() => bucket.classList.remove('jiggle', 'flash-red'), 600);
  }

  state.autoPrompted = true;
  applyPrompt();
}

function disableAllBuckets() {
  el.compGrid.querySelectorAll('.bucket').forEach(b => {
    b.classList.add('bucket-disabled');
    b.style.pointerEvents = 'none';
  });
}

// ── Prompt logic ───────────────────────────────────────────────────

function applyPrompt() {
  clearPrompt();
  const bucket = getBucket(state.correctIdx);
  if (!bucket) return;

  const cls = state.promptStyle === 'sparkle' ? 'prompt-sparkle' : 'prompt-outline';
  bucket.classList.add(cls);

  if (!state.promptPersists) {
    state.promptHandle = setTimeout(() => {
      bucket.classList.remove(cls);
      state.promptHandle = null;
    }, 3000);
  }
}

function clearPrompt() {
  clearTimeout(state.promptHandle);
  state.promptHandle = null;
  el.compGrid.querySelectorAll('.bucket')
    .forEach(b => b.classList.remove('prompt-sparkle', 'prompt-outline'));
}

function onPromptButton() {
  state.prompted = true;
  applyPrompt();
}

// ── Next / Retry overlay ───────────────────────────────────────────

function showTrialButtons() {
  removeTrialButtons();
  const overlay = document.createElement('div');
  overlay.id = 'trial-overlay';

  const btnNext = document.createElement('button');
  btnNext.id = 'btn-next';
  btnNext.className = 'btn-watermark btn-watermark-next';
  btnNext.textContent = 'Next';
  btnNext.addEventListener('click', onNextClick);

  const btnRetry = document.createElement('button');
  btnRetry.id = 'btn-retry';
  btnRetry.className = 'btn-watermark btn-watermark-retry';
  btnRetry.textContent = 'Retry';
  btnRetry.addEventListener('click', onRetryClick);

  overlay.appendChild(btnNext);
  overlay.appendChild(btnRetry);
  el.marketStage.appendChild(overlay);
}

function removeTrialButtons() {
  const overlay = $('trial-overlay');
  if (overlay) overlay.remove();
}

function onNextClick() {
  removeTrialButtons();
  el.speechBubble.classList.remove('shown', 'hiding');
  el.bag.classList.remove('bag-handoff');
  if (state.timerAutoPaused) { state.timerAutoPaused = false; startTimer(); }
  const last = state.sessionData[state.sessionData.length - 1];
  const needsRepeat = state.representErrors && last && (last.outcome === 'Error' || last.outcome === 'Repeat Error');
  beginTrial(needsRepeat);
}

function onRetryClick() {
  if (state.sessionData.length) {
    state.sessionData.pop();
    state.trialNum--;
    persistResults();
  }
  removeTrialButtons();
  el.speechBubble.classList.remove('shown', 'hiding');
  el.bag.classList.remove('bag-handoff');
  if (state.timerAutoPaused) { state.timerAutoPaused = false; startTimer(); }
  beginTrial(false, true);
}

// ── Print data ─────────────────────────────────────────────────────

function printData() {
  if (!state.sessionData.length) {
    alert('No trial data to print yet. Complete at least one trial first.');
    return;
  }

  // Preferred path: durable, branded report in a new tab (raw data only).
  if (window.NooutcoResults) {
    const now = new Date();
    const total = state.sessionData.length;
    const meta =
      `Printed: ${now.toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' })} ` +
      `at ${now.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' })}  |  ` +
      `Array size: ${state.arraySize}`;
    const count = o => state.sessionData.filter(d => d.outcome === o).length;
    const avgTime = (state.sessionData.reduce((s, d) => s + parseFloat(d.time), 0) / total).toFixed(1);
    const outcomeCls = d =>
      (d.outcome === 'Error' || d.outcome === 'Repeat Error') ? 'outcome-error'
      : d.outcome === 'Prompted'   ? 'outcome-prompted'
      : d.outcome === 'Correction' ? 'outcome-correction'
      : 'outcome-ok';

    NooutcoResults.open({
      title: 'Matching Market — Session Results',
      meta,
      columns: [
        { label: '#',          key: 'trial' },
        { label: 'Topic',      key: 'topic' },
        { label: 'Sample',     key: 'sample' },
        { label: 'Array Size', key: 'arraySize' },
        { label: 'Errors',     key: 'errors' },
        { label: 'Prompted',   key: 'promptedLabel' },
        { label: 'Delay (s)',  key: 'delayLabel' },
        { label: 'Time (s)',   key: 'time' },
        { label: 'Outcome',    key: 'outcome', cls: outcomeCls },
      ],
      rows: state.sessionData.map(d => ({
        trial: d.trial, topic: d.topic, sample: d.sample, arraySize: d.arraySize,
        errors: d.errors, time: d.time, outcome: d.outcome,
        promptedLabel: d.prompted ? 'Yes' : 'No',
        delayLabel: d.promptDelaySecs != null ? d.promptDelaySecs : '-',
      })),
      summary: [
        { label: 'Total trials',      value: total },
        { label: 'Correct',           value: count('Correct') },
        { label: 'Prompted',          value: count('Prompted') },
        { label: 'Error',             value: count('Error') },
        { label: 'Correction',        value: count('Correction') },
        { label: 'Repeat Error',      value: count('Repeat Error') },
        { label: 'Avg response time', value: `${avgTime} s` },
      ],
    });
    return;
  }

  // Fallback: legacy hidden print-section + native dialog.
  const now = new Date();
  el.printMeta.textContent =
    `Printed: ${now.toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' })} ` +
    `at ${now.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' })}  |  ` +
    `Array size: ${state.arraySize}`;

  el.resultsBody.innerHTML = '';
  state.sessionData.forEach((d, i) => {
    const outcomeCls =
      (d.outcome === 'Error' || d.outcome === 'Repeat Error') ? 'outcome-error'
      : d.outcome === 'Prompted'   ? 'outcome-prompted'
      : d.outcome === 'Correction' ? 'outcome-correction'
      : 'outcome-ok';

    const tr = document.createElement('tr');
    const prev = state.sessionData[i - 1];
    const settingsChanged = prev && d.settingsKey !== prev.settingsKey;
    if (settingsChanged) tr.classList.add('settings-changed');
    const b = settingsChanged ? ' style="font-weight:bold"' : '';
    tr.innerHTML =
      `<td${b}>${d.trial}</td>` +
      `<td${b}>${d.topic}</td>` +
      `<td${b}>${d.sample}</td>` +
      `<td${b}>${d.arraySize}</td>` +
      `<td${b}>${d.errors}</td>` +
      `<td${b}>${d.prompted ? 'Yes' : 'No'}</td>` +
      `<td${b}>${d.promptDelaySecs != null ? d.promptDelaySecs : '-'}</td>` +
      `<td${b}>${d.time}</td>` +
      `<td${b} class="${outcomeCls}">${d.outcome}</td>`;
    el.resultsBody.appendChild(tr);
  });

  const total      = state.sessionData.length;
  const correct    = state.sessionData.filter(d => d.outcome === 'Correct').length;
  const prompted   = state.sessionData.filter(d => d.outcome === 'Prompted').length;
  const errors     = state.sessionData.filter(d => d.outcome === 'Error').length;
  const correction = state.sessionData.filter(d => d.outcome === 'Correction').length;
  const repErrors  = state.sessionData.filter(d => d.outcome === 'Repeat Error').length;
  const avgTime    = (
    state.sessionData.reduce((s, d) => s + parseFloat(d.time), 0) / total
  ).toFixed(1);

  el.printSummary.innerHTML =
    `<span>Total trials: <strong>${total}</strong></span>` +
    `<span>Correct: <strong>${correct}</strong></span>` +
    `<span>Prompted: <strong>${prompted}</strong></span>` +
    `<span>Error: <strong>${errors}</strong></span>` +
    `<span>Correction: <strong>${correction}</strong></span>` +
    `<span>Repeat Error: <strong>${repErrors}</strong></span>` +
    `<span>Avg response time: <strong>${avgTime} s</strong></span>`;

  window.print();
}

// ── Target picker panel ────────────────────────────────────────────

function toggleTargetPanel() { setTargetPanelOpen(!state.targetPanelOpen); }
function setTargetPanelOpen(open) {
  state.targetPanelOpen = open;
  el.btnTargetsToggle.setAttribute('aria-expanded', String(open));
  el.btnTargetsToggle.classList.toggle('is-open', open);
  if (open) { el.targetPanel.removeAttribute('hidden'); renderTargetPanel(); }
  else       { el.targetPanel.setAttribute('hidden', ''); }
}

function renderTargetPanel() {
  const body = el.targetPanelBody;
  body.innerHTML = '';
  const images = state.topicImages;
  if (!images.length) {
    body.innerHTML = '<p class="target-panel-empty">No images in this topic.</p>';
    return;
  }
  const filter = new Set(state.targetFilters[state.topic] || []);
  images.forEach(src => {
    const row = document.createElement('label');
    row.className = 'target-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.src = src;
    cb.checked = !filter.size || filter.has(src);
    cb.addEventListener('change', () => onTargetCheckboxChange(cb));
    const thumb = document.createElement('img');
    thumb.className = 'target-thumb';
    thumb.src = src;
    thumb.alt = '';
    thumb.addEventListener('error', () => thumb.remove());
    const lbl = document.createElement('span');
    lbl.className = 'target-row-label';
    lbl.textContent = srcLabel(src);
    row.appendChild(cb); row.appendChild(thumb); row.appendChild(lbl);
    body.appendChild(row);
  });
}

function targetCheckboxes() {
  return el.targetPanelBody.querySelectorAll('input[type="checkbox"][data-src]');
}

function onTargetCheckboxChange() {
  const checkedSrcs = new Set();
  targetCheckboxes().forEach(cb => { if (cb.checked) checkedSrcs.add(cb.dataset.src); });
  const allChecked = state.topicImages.every(src => checkedSrcs.has(src));
  state.targetFilters[state.topic] = allChecked ? [] : [...checkedSrcs];
  saveSettings();
  updateTargetsCount();
}

function setAllTargets(checked) {
  targetCheckboxes().forEach(cb => { cb.checked = checked; });
  onTargetCheckboxChange();
}

function updateTargetsCount() {
  if (!el.targetsCount) return;
  const filter = state.targetFilters[state.topic] || [];
  const total    = state.topicImages.length;
  const selected = filter.length ? filter.length : total;
  el.targetsCount.textContent = `${selected} of ${total}`;
  el.btnTargetsToggle.classList.toggle('is-filtered', filter.length > 0);
}

// ── Extra settings panel ───────────────────────────────────────────

function toggleExtraPanel() { setExtraPanelOpen(!state.extraPanelOpen); }
function setExtraPanelOpen(open) {
  state.extraPanelOpen = open;
  el.btnExtraToggle.setAttribute('aria-expanded', String(open));
  el.btnExtraToggle.classList.toggle('is-open', open);
  if (open) { el.extraPanel.removeAttribute('hidden'); }
  else       { el.extraPanel.setAttribute('hidden', ''); }
}

// ── Token Board ────────────────────────────────────────────────────

const EMOJI_POOL = ['⭐', '🔷', '💎', '✨', '🎁', '🏆', '💫', '🌟'];

function updateTokenBoardUIVisibility() {
  if (state.tokenBoardEnabled) {
    el.tokenSettings.style.display = 'block';
  } else {
    el.tokenSettings.style.display = 'none';
  }
}

function pickRandomEmoji() {
  return EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
}

function initializeTokenBoard() {
  if (!state.tokenBoardEnabled) return;

  // Pick emoji if random
  if (state.tokenEmoji === 'random') {
    state.chosenEmoji = pickRandomEmoji();
  } else {
    state.chosenEmoji = state.tokenEmoji;
  }

  // Reset trial count and generate VR schedule if needed
  state.trialsCompleted = 0;
  state.vr_scheduleTrial = 0;
  if (state.scheduleType === 'VR') {
    state.vr_schedule = generateVRSchedule(1000, state.scheduleValue);
  }

  // Set starting tokens
  state.currentTokens = state.startingTokens;

  // Show token board
  el.tokenBoard.hidden = false;
  renderTokenBoard();
}

function generateVRSchedule(numTrials, vrValue) {
  // Generate a VR schedule where reinforcement happens on average every vrValue trials.
  // Uses chunked randomization to prevent excessive drift.
  //
  // Algorithm: Divide the session into chunks of vrValue trials, place one reinforcement
  // randomly within each chunk. This ensures:
  // - Exactly numTrials/vrValue reinforcements (or close to it)
  // - No gap exceeds ~1.5x the target interval
  // - Fair distribution across the session

  const itemsPerChunk = Math.ceil(vrValue);
  const reinforcementIndices = [];

  for (let i = 0; i < numTrials; i += itemsPerChunk) {
    const chunkEnd = Math.min(i + itemsPerChunk, numTrials);
    const randomPos = Math.floor(Math.random() * (chunkEnd - i)) + i;
    reinforcementIndices.push(randomPos);
  }

  return reinforcementIndices.sort((a, b) => a - b);
}

function shouldAwardTokens() {
  // Determine if tokens should be awarded for the current trial
  if (state.scheduleType === 'FR') {
    // Fixed ratio: award when trialsCompleted is a multiple of scheduleValue
    return state.trialsCompleted % state.scheduleValue === 0;
  } else if (state.scheduleType === 'VR') {
    // Variable ratio: check if current trial is in the pre-generated schedule
    if (state.vr_scheduleTrial >= state.vr_schedule.length) {
      // Re-generate if we've exhausted the current schedule
      // Offset indices by current trialsCompleted to keep schedule continuous
      const offset = state.trialsCompleted;
      const newSchedule = generateVRSchedule(1000, state.scheduleValue);
      state.vr_schedule = newSchedule.map(idx => idx + offset);
      state.vr_scheduleTrial = 0;
    }
    const shouldAward = state.vr_schedule[state.vr_scheduleTrial] === state.trialsCompleted;
    if (shouldAward) {
      state.vr_scheduleTrial++;
    }
    return shouldAward;
  }
  return false;
}

function awardTokensForTrial() {
  if (!state.tokenBoardEnabled || !state.active) return;

  state.trialsCompleted++;
  if (shouldAwardTokens()) {
    if (state.currentTokens < state.goalTokens) {
      state.currentTokens++;
    }
  }

  renderTokenBoard();
  saveSettings();
}

function renderTokenBoard() {
  if (!state.tokenBoardEnabled) return;

  // Display emoji repeated for current token count
  const emojiDisplay = state.chosenEmoji.repeat(Math.min(state.currentTokens, 20)); // Cap display at 20
  el.tokenEmojiDisplay.textContent = emojiDisplay;

  // Update progress text
  el.tokenProgressText.textContent = `${state.currentTokens} / ${state.goalTokens}`;

  // Check if goal reached
  if (state.currentTokens >= state.goalTokens) {
    el.tokenBoard.classList.add('goal-reached');
  } else {
    el.tokenBoard.classList.remove('goal-reached');
  }
}
