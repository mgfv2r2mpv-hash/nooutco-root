'use strict';

/* ══════════════════════════════════════════════════════════════════
   NAME GAME  (Receptive ID)
   Sample = a written word label; comparison array = images.
   Client selects the image that matches the spoken/written name.
   ══════════════════════════════════════════════════════════════════ */

// ── Utilities ──────────────────────────────────────────────────────

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Derive a display label from an image path.
 *  Uses manifest.displayNames[src] when set (so "on-squirrel.svg" can
 *  show as "On"); otherwise falls back to the filename.
 *  e.g. "T_animals/bear.svg" → "Bear"
 *       "T_community_helpers/mail-carrier.svg" → "Mail Carrier"
 */
function labelFromSrc(src) {
  const override = state.manifest?.displayNames?.[src];
  if (typeof override === 'string' && override.trim()) return override;
  const name = src.split('/').pop().replace(/\.[^.]+$/, '');
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── State ──────────────────────────────────────────────────────────

const state = {
  // Persisted settings
  topic:             '',
  arraySize:         4,
  representErrors:   true,
  errorless:         false,
  noErrorAnim:       false,
  extraPanelOpen:    false,
  crossCategory:          false,
  nonTargetDistractors:   true,
  promptPersists:         false,
  promptStyle:       'sparkle',
  autoPromptEnabled: false,
  promptDelay:       false,
  promptDelaySecs:   3,

  // Token board settings
  tokenBoardEnabled: false,
  scheduleType:      'FR',
  scheduleValue:     1,
  startingTokens:    0,
  goalTokens:        10,
  tokenEmoji:        'random',
  chosenEmoji:       '⭐',
  currentTokens:     0,
  trialsCompleted:   0,
  vr_schedule:       [],
  vr_scheduleTrial:  0,

  // Per-topic target filters: { topic: [srcPaths] } — empty array = no filter
  targetFilters: {},

  // Discovered folders & images
  manifest:     null,
  topicFolders: [],
  topicImages:  [],
  otherImages:  [],

  // Target panel UI state
  targetPanelOpen: false,

  // Session — persists across topic changes; cleared by Clear Data
  active:      false,
  sessionData: [],
  trialNum:    0,

  // Current trial
  sampleSrc:    '',   // image path for the correct answer (not displayed)
  sampleLabel:  '',   // word shown in the sample card
  tileImages:   [],
  correctIdx:   0,
  trialErrors:  0,
  trialStart:   0,
  prompted:     false,
  autoPrompted: false,
  isRepeatTrial: false,

  // Shuffled position deck
  posDeck: [],

  // Shuffled sample deck — ensures all items shown before any repeats
  sampleDeck: [],

  // Timer
  timerSecs:       0,
  timerRunning:    false,
  timerHandle:     null,
  timerAutoPaused: false,  // true when paused automatically on correct tap

  // Prompt timeouts
  promptHandle:     null,
  autoPromptHandle: null,
};

// ── DOM references ─────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const el = {
  timerDisplay:        $('timer-display'),
  btnTimerToggle:      $('btn-timer-toggle'),
  btnTimerReset:       $('btn-timer-reset'),
  selTopic:            $('sel-topic'),
  inpSize:             $('inp-size'),
  chkCross:                   $('chk-cross'),
  chkNonTargetDistractor:     $('chk-non-target-distractor'),
  chkPersists:                $('chk-persists'),
  selPromptStyle:      $('sel-prompt-style'),
  chkAutoPrompt:       $('chk-auto-prompt'),
  chkPromptDelay:      $('chk-prompt-delay'),
  selPromptDelay:      $('sel-prompt-delay'),
  btnStart:            $('btn-start'),
  gameArea:            $('game-area'),
  sampleWord:          $('sample-word'),
  compGrid:            $('comp-grid'),
  compSection:         $('comp-section'),
  btnPrompt:           $('btn-prompt'),
  btnPrint:            $('btn-print'),
  btnClearData:        $('btn-clear-data'),
  resultsBody:         $('results-body'),
  printMeta:           $('print-meta'),
  printSummary:        $('print-summary'),
  btnTargetsToggle:    $('btn-targets-toggle'),
  targetsCount:        $('targets-count'),
  targetPanel:         $('target-panel'),
  targetPanelBody:     $('target-panel-body'),
  targetPanelTopicLbl: $('target-panel-topic-label'),
  btnTargetsAll:       $('btn-targets-all'),
  btnTargetsNone:      $('btn-targets-none'),
  btnTargetsClose:     $('btn-targets-close'),
  chkRepresentErrors:  $('chk-represent-errors'),
  chkErrorless:        $('chk-errorless'),
  chkNoErrorAnim:      $('chk-no-error-anim'),
  btnExtraToggle:      $('btn-extra-toggle'),
  extraPanel:          $('extra-panel'),
  btnExtraClose:       $('btn-extra-close'),
  chkTokenBoard:       $('chk-token-board'),
  tokenSettings:       $('token-settings'),
  selScheduleType:     $('sel-schedule-type'),
  inpScheduleValue:    $('inp-schedule-value'),
  inpStartingTokens:   $('inp-starting-tokens'),
  inpGoalTokens:       $('inp-goal-tokens'),
  selTokenEmoji:       $('sel-token-emoji'),
  tokenBoard:          $('token-board'),
  tokenEmojiDisplay:   $('token-emoji-display'),
  tokenProgressText:   $('token-progress-text'),
};

// ── Boot ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  bindEvents();
  await discoverTopics();
});

// ── Settings (localStorage) ────────────────────────────────────────

function loadSettings() {
  const s = JSON.parse(localStorage.getItem('ngSettings') || '{}');
  state.topic             = s.topic             ?? '';
  state.arraySize         = s.arraySize         ?? 4;
  state.representErrors   = s.representErrors   ?? true;
  state.errorless         = s.errorless         ?? false;
  state.noErrorAnim       = s.noErrorAnim       ?? false;
  state.crossCategory          = s.crossCategory          ?? false;
  state.nonTargetDistractors   = s.nonTargetDistractors   ?? true;
  state.promptPersists         = s.promptPersists         ?? false;
  state.promptStyle       = s.promptStyle       ?? 'sparkle';
  state.autoPromptEnabled = s.autoPromptEnabled ?? false;
  state.promptDelay       = s.promptDelay       ?? false;
  state.promptDelaySecs   = s.promptDelaySecs   ?? 3;
  state.targetFilters     = (s.targetFilters && typeof s.targetFilters === 'object') ? s.targetFilters : {};

  state.tokenBoardEnabled = s.tokenBoardEnabled ?? false;
  state.scheduleType      = s.scheduleType      ?? 'FR';
  state.scheduleValue     = s.scheduleValue     ?? 1;
  state.startingTokens    = s.startingTokens    ?? 0;
  state.goalTokens        = s.goalTokens        ?? 10;
  state.tokenEmoji        = s.tokenEmoji        ?? 'random';
  state.chosenEmoji       = s.chosenEmoji       ?? '⭐';
  state.currentTokens     = s.currentTokens     ?? 0;

  el.inpSize.value              = state.arraySize;
  el.chkRepresentErrors.checked = state.representErrors;
  el.chkErrorless.checked       = state.errorless;
  el.chkNoErrorAnim.checked     = state.noErrorAnim;
  el.chkCross.checked                   = state.crossCategory;
  el.chkNonTargetDistractor.checked     = state.nonTargetDistractors;
  el.chkPersists.checked                = state.promptPersists;
  el.selPromptStyle.value   = state.promptStyle;
  el.chkAutoPrompt.checked  = state.autoPromptEnabled;
  el.chkPromptDelay.checked = state.promptDelay;
  el.selPromptDelay.value   = state.promptDelaySecs;

  el.chkTokenBoard.checked   = state.tokenBoardEnabled;
  el.selScheduleType.value   = state.scheduleType;
  el.inpScheduleValue.value  = state.scheduleValue;
  el.inpStartingTokens.value = state.startingTokens;
  el.inpGoalTokens.value     = state.goalTokens;
  el.selTokenEmoji.value     = state.tokenEmoji;

  el.chkPromptDelay.disabled = !state.autoPromptEnabled;
  el.selPromptDelay.disabled = !state.autoPromptEnabled || !state.promptDelay;

  updateTokenBoardUIVisibility();
}

function saveSettings() {
  localStorage.setItem('ngSettings', JSON.stringify({
    topic:             state.topic,
    arraySize:         state.arraySize,
    representErrors:   state.representErrors,
    errorless:         state.errorless,
    noErrorAnim:       state.noErrorAnim,
    crossCategory:        state.crossCategory,
    nonTargetDistractors: state.nonTargetDistractors,
    promptPersists:       state.promptPersists,
    promptStyle:       state.promptStyle,
    autoPromptEnabled: state.autoPromptEnabled,
    promptDelay:       state.promptDelay,
    promptDelaySecs:   state.promptDelaySecs,
    targetFilters:     state.targetFilters,
    tokenBoardEnabled: state.tokenBoardEnabled,
    scheduleType:      state.scheduleType,
    scheduleValue:     state.scheduleValue,
    startingTokens:    state.startingTokens,
    goalTokens:        state.goalTokens,
    tokenEmoji:        state.tokenEmoji,
    chosenEmoji:       state.chosenEmoji,
    currentTokens:     state.currentTokens,
  }));
}

// ── Image discovery ────────────────────────────────────────────────

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp)$/i;

async function fetchDirImages(folder) {
  try {
    const r = await fetch(`./${folder}/`);
    if (!r.ok) return [];
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    return [...doc.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href'))
      .filter(h => IMAGE_EXT.test(h) && !h.includes('/'))
      .map(h => `${folder}/${h}`);
  } catch {
    return [];
  }
}

async function discoverTopics() {
  let dirs = [];

  try {
    const r = await fetch('./manifest.json');
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data.folders) && data.folders.length) {
        state.manifest = data;
        dirs = data.folders;
        console.info(`manifest.json loaded (generated ${data.generated})`);
      }
    }
  } catch { /* fall through */ }

  if (!dirs.length) {
    try {
      const r = await fetch('./');
      if (!r.ok) throw new Error();
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      dirs = [...doc.querySelectorAll('a[href]')]
        .map(a => a.getAttribute('href'))
        .filter(h => /^T_[^/]+\/?$/.test(h))
        .map(h => h.replace(/\/$/, ''));
    } catch {
      console.warn('Could not discover topic folders.');
    }
  }

  state.topicFolders = dirs;
  buildTopicDropdown(dirs);

  if (dirs.length) {
    const saved = dirs.includes(state.topic) ? state.topic : dirs[0];
    state.topic = saved;
    el.selTopic.value = saved;
    await refreshImages();
  }
  updateTargetsCount();
}

const TOPIC_DISPLAY_NAMES = {};

function buildTopicDropdown(dirs) {
  el.selTopic.innerHTML = '';
  if (!dirs.length) {
    el.selTopic.innerHTML = '<option value="">-- No T_* folders found --</option>';
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

async function refreshImages() {
  if (!state.topic) { state.topicImages = []; state.otherImages = []; state.sampleDeck = []; return; }

  if (state.manifest) {
    state.topicImages = state.manifest.images[state.topic] || [];
    state.otherImages = (state.crossCategory && state.topicFolders.length > 1)
      ? state.topicFolders
          .filter(f => f !== state.topic)
          .flatMap(f => state.manifest.images[f] || [])
      : [];
    state.sampleDeck = [];
    return;
  }

  state.topicImages = await fetchDirImages(state.topic);
  if (state.crossCategory && state.topicFolders.length > 1) {
    const others = state.topicFolders.filter(f => f !== state.topic);
    state.otherImages = (await Promise.all(others.map(fetchDirImages))).flat();
  } else {
    state.otherImages = [];
  }
  state.sampleDeck = [];
  pruneStaleTargetFilter(state.topic);
}

/**
 * Drop any filter entries for the given topic that no longer point at
 * existing images (e.g. files deleted, folder renamed).
 */
function pruneStaleTargetFilter(topic) {
  if (!topic || !state.targetFilters[topic]) return;
  const known = new Set(state.topicImages);
  const before = state.targetFilters[topic];
  const kept = before.filter(src => known.has(src));
  if (kept.length !== before.length) {
    state.targetFilters[topic] = kept;
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
    renderTargetPanel();
    updateTargetsCount();
  });

  // Target panel
  el.btnTargetsToggle.addEventListener('click', toggleTargetPanel);
  el.btnTargetsClose .addEventListener('click', () => setTargetPanelOpen(false));
  el.btnTargetsAll   .addEventListener('click', () => setAllTargets(true));
  el.btnTargetsNone  .addEventListener('click', () => setAllTargets(false));

  el.inpSize.addEventListener('change', async () => {
    const v = Math.min(10, Math.max(1, parseInt(el.inpSize.value) || 4));
    state.arraySize = v;
    el.inpSize.value = v;
    state.posDeck = [];
    saveSettings();
    await refreshImages();
  });

  el.chkCross.addEventListener('change', async () => {
    state.crossCategory = el.chkCross.checked;
    saveSettings();
    await refreshImages();
  });

  el.chkNonTargetDistractor.addEventListener('change', () => {
    state.nonTargetDistractors = el.chkNonTargetDistractor.checked;
    saveSettings();
  });

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

  el.chkTokenBoard.addEventListener('change', () => {
    state.tokenBoardEnabled = el.chkTokenBoard.checked;
    updateTokenBoardUIVisibility();
    saveSettings();
  });
  el.selScheduleType.addEventListener('change', () => {
    state.scheduleType = el.selScheduleType.value;
    saveSettings();
  });
  el.inpScheduleValue.addEventListener('change', () => {
    state.scheduleValue = parseInt(el.inpScheduleValue.value) || 1;
    saveSettings();
  });
  el.inpStartingTokens.addEventListener('change', () => {
    state.startingTokens = parseInt(el.inpStartingTokens.value) || 0;
    saveSettings();
  });
  el.inpGoalTokens.addEventListener('change', () => {
    state.goalTokens = parseInt(el.inpGoalTokens.value) || 10;
    saveSettings();
  });
  el.selTokenEmoji.addEventListener('change', () => {
    state.tokenEmoji = el.selTokenEmoji.value;
    saveSettings();
  });

  el.btnStart.addEventListener('click',  startGame);
  el.btnPrompt.addEventListener('click', onPromptButton);
  el.btnPrint.addEventListener('click',  printData);

  el.btnClearData.addEventListener('click', () => {
    if (!state.sessionData.length) {
      alert('No data to clear.');
      return;
    }
    if (!confirm('Clear all trial data? This cannot be undone.')) return;
    state.sessionData = [];
    state.trialNum    = 0;
    el.resultsBody.innerHTML = '';
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

// ── Sample deck — no repeats until all items shown ─────────────────

/**
 * Images eligible as samples (targets) for the current topic, after the
 * per-topic target filter is applied. Empty filter = whole topic.
 */
function eligibleSamples() {
  const filter = state.targetFilters[state.topic] || [];
  if (!filter.length) return state.topicImages;
  const set = new Set(filter);
  return state.topicImages.filter(src => set.has(src));
}

function nextSample() {
  if (!state.sampleDeck.length) {
    const pool = eligibleSamples();
    if (!pool.length) return null;
    state.sampleDeck = shuffle([...pool]);
  }
  return state.sampleDeck.pop();
}

// ── Game flow ──────────────────────────────────────────────────────

function startGame() {
  if (!state.topic) {
    alert('Please select a topic from the dropdown first.');
    return;
  }
  if (!state.topicImages.length) {
    alert(`No images found in ${state.topic}/.\nAdd image files to that folder and reload the page.`);
    return;
  }
  if (!eligibleSamples().length) {
    alert('Your target filter has no items selected. Open the Targets panel and pick at least one item.');
    return;
  }

  state.active      = true;
  state.posDeck     = [];
  state.sampleDeck  = [];

  el.gameArea.removeAttribute('hidden');
  el.btnPrompt.removeAttribute('hidden');
  removeNextBtn();

  el.tokenBoard.hidden = state.tokenBoardEnabled ? false : true;
  initializeTokenBoard();

  resetTimer();
  startTimer();
  beginTrial();
}

/**
 * Begin a new trial.
 * keepSample=true → repeat trial (same target word, tiles reshuffled, auto-prompted).
 */
function beginTrial(keepSample = false) {
  state.trialNum++;
  state.trialErrors   = 0;
  state.prompted      = false;
  state.autoPrompted  = false;
  state.isRepeatTrial = keepSample;
  state.trialStart    = Date.now();

  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;

  clearPrompt();
  if (buildTrial(keepSample) === false) return;
  renderTrial();

  if (keepSample) {
    state.autoPrompted = true;
    setTimeout(applyPrompt, 80);
  } else if (state.autoPromptEnabled) {
    if (state.promptDelay) {
      state.autoPromptHandle = setTimeout(() => {
        state.autoPrompted = true;
        state.autoPromptHandle = null;
        applyPrompt();
      }, state.promptDelaySecs * 1000);
    } else {
      state.autoPrompted = true;
      setTimeout(applyPrompt, 80);
    }
  }
}

function buildTrial(keepSample) {
  const n = state.arraySize;

  if (!keepSample) {
    const nxt = nextSample();
    if (!nxt) {
      alert('No targets selected. Open the Targets panel and pick at least one item.');
      return false;
    }
    state.sampleSrc   = nxt;
    state.sampleLabel = labelFromSrc(state.sampleSrc);
  }

  const inCategoryPool = state.nonTargetDistractors ? [...state.topicImages] : eligibleSamples();
  const basePool = state.crossCategory
    ? [...inCategoryPool, ...state.otherImages]
    : [...inCategoryPool];

  const distractorPool = shuffle(basePool.filter(src => src !== state.sampleSrc));
  const getDistractor  = i =>
    distractorPool.length ? distractorPool[i % distractorPool.length] : state.sampleSrc;

  const correctPos = nextPosition();
  state.correctIdx = correctPos;
  state.tileImages = new Array(n);
  let di = 0;

  for (let i = 0; i < n; i++) {
    state.tileImages[i] = (i === correctPos) ? state.sampleSrc : getDistractor(di++);
  }
}

/** Shrink font-size until the word fits inside #sample-card without breaking mid-word. */
function fitSampleWord() {
  const card = document.getElementById('sample-card');
  const word = el.sampleWord;
  const cs = getComputedStyle(card);
  const maxW = card.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const maxH = card.clientHeight - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);
  let px = 52;
  word.style.fontSize = px + 'px';
  while (px > 12 && (word.scrollWidth > maxW || word.scrollHeight > maxH)) {
    px -= 2;
    word.style.fontSize = px + 'px';
  }
}

function renderTrial() {
  // Show the target word in the sample card
  el.sampleWord.textContent = state.sampleLabel;
  requestAnimationFrame(fitSampleWord);

  const cols = gridCols(state.arraySize);
  el.compGrid.style.setProperty('--grid-cols', cols);
  el.compGrid.style.gridTemplateColumns = '';
  el.compGrid.innerHTML = '';

  state.tileImages.forEach((src, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'tile-wrapper';
    wrapper.dataset.index = idx;

    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.index = idx;

    const front = document.createElement('div');
    front.className = 'tile-face tile-front';
    const img = document.createElement('img');
    img.src = src;
    img.alt = `Choice ${idx + 1}`;
    const labelSpan = document.createElement('span');
    labelSpan.className = 'tile-label';
    labelSpan.textContent = labelFromSrc(src);
    img.addEventListener('error', () => {
      img.remove();
      labelSpan.classList.add('tile-label-visible');
    });
    front.appendChild(img);
    front.appendChild(labelSpan);

    const back = document.createElement('div');
    back.className = 'tile-face tile-back';
    const okSpan = document.createElement('span');
    okSpan.className = 'ok-text';
    back.appendChild(okSpan);

    tile.appendChild(front);
    tile.appendChild(back);
    wrapper.appendChild(tile);

    wrapper.addEventListener('click', () => onTileClick(idx));
    el.compGrid.appendChild(wrapper);
  });

  fitGrid();
}

function gridCols(n) {
  const map = { 1:1, 2:2, 3:3, 4:4, 5:3, 6:3, 7:4, 8:4, 9:3, 10:5 };
  return map[n] ?? 4;
}

// Fit tiles to fill the available game-area in both dimensions while
// staying square. On mobile, picks the (cols, rows) layout that
// produces the largest tile so a 4-tile array becomes 2x2 instead of
// a thin 4x1 strip.
const _fitMobileMQ = window.matchMedia('(max-width: 680px)');
function fitGrid() {
  if (!el.gameArea || el.gameArea.hasAttribute('hidden')) return;
  const n = state.arraySize;
  if (!n) return;

  const gaStyle = getComputedStyle(el.gameArea);
  const isRow = gaStyle.flexDirection.startsWith('row');
  const padX = parseFloat(gaStyle.paddingLeft) + parseFloat(gaStyle.paddingRight);
  const padY = parseFloat(gaStyle.paddingTop) + parseFloat(gaStyle.paddingBottom);
  const flexGap = parseFloat(gaStyle.rowGap) || parseFloat(gaStyle.gap) || 0;

  let availW = el.gameArea.clientWidth - padX;
  let availH = el.gameArea.clientHeight - padY;

  const sampleSection = document.getElementById('sample-section');
  if (sampleSection && !sampleSection.hidden) {
    const r = sampleSection.getBoundingClientRect();
    if (isRow) availW -= r.width + flexGap;
    else        availH -= r.height + flexGap;
  }

  const areaLabel = el.compSection && el.compSection.querySelector('.area-label');
  if (areaLabel) {
    const lbl = getComputedStyle(areaLabel);
    availH -= areaLabel.getBoundingClientRect().height + parseFloat(lbl.marginBottom);
  }

  const cgStyle = getComputedStyle(el.compGrid);
  const tileGap = parseFloat(cgStyle.rowGap) || parseFloat(cgStyle.gap) || 8;

  let cols, rows;
  if (_fitMobileMQ.matches) {
    let best = { cols: gridCols(n), rows: Math.ceil(n / gridCols(n)), tile: 0 };
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const tw = (availW - (c - 1) * tileGap) / c;
      const th = (availH - (r - 1) * tileGap) / r;
      const t = Math.min(tw, th);
      if (t > best.tile) best = { cols: c, rows: r, tile: t };
    }
    cols = best.cols;
    rows = best.rows;
  } else {
    cols = gridCols(n);
    rows = Math.ceil(n / cols);
  }

  const tileW = (availW - (cols - 1) * tileGap) / cols;
  const tileH = (availH - (rows - 1) * tileGap) / rows;
  const tile = Math.max(56, Math.min(tileW, tileH, 320));

  el.compGrid.style.setProperty('--grid-cols', cols);
  el.compGrid.style.setProperty('--tile-sz', `${Math.floor(tile)}px`);
}

window.addEventListener('resize', () => fitGrid());
window.addEventListener('orientationchange', () => fitGrid());
if (window.ResizeObserver && el.gameArea) {
  new ResizeObserver(() => fitGrid()).observe(el.gameArea);
}

// ── Tile interaction ───────────────────────────────────────────────

function onTileClick(idx) {
  if (!state.active) return;
  const wrapper = getWrapper(idx);
  const tile    = getTile(idx);
  if (!tile || tile.classList.contains('tile-disabled')) return;

  if (idx === state.correctIdx) {
    onCorrectClick(wrapper, tile);
  } else {
    if (state.errorless) return;
    onWrongClick(wrapper);
  }
}

function onCorrectClick(wrapper, tile) {
  disableAllTiles();
  clearPrompt();
  // Pause timer while the learner waits for Next — only if it was running
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
    sample:    state.sampleLabel,
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
    ].join('|'),
  });

  if (outcome === 'Correct') {
    awardTokensForTrial();
  }

  const backFace = tile.querySelector('.tile-back');
  const okSpan   = backFace.querySelector('.ok-text');
  if (outcome === 'Correct') {
    backFace.classList.add('back-correct');
    okSpan.textContent = '✓';
  } else if (outcome === 'Prompted' || outcome === 'Correction') {
    okSpan.textContent = '✓';
  } else {
    okSpan.textContent = 'OK';
  }

  wrapper.classList.add('expanding');
  setTimeout(() => {
    wrapper.classList.remove('expanding');
    tile.classList.add('flipped');
    setTimeout(showNextBtn, 580);
  }, 280);
}

function onWrongClick(wrapper) {
  state.trialErrors++;

  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;

  if (!state.noErrorAnim) {
    wrapper.classList.add('jiggle', 'flash-red');
    const cleanup = () => wrapper.classList.remove('jiggle', 'flash-red');
    wrapper.addEventListener('animationend', cleanup, { once: true });
    setTimeout(() => wrapper.classList.remove('jiggle', 'flash-red'), 600);
  }

  state.autoPrompted = true;
  applyPrompt();
}

function disableAllTiles() {
  el.compGrid.querySelectorAll('.tile').forEach(t => t.classList.add('tile-disabled'));
  el.compGrid.querySelectorAll('.tile-wrapper').forEach(w => { w.style.pointerEvents = 'none'; });
}

function getWrapper(idx) {
  return el.compGrid.querySelector(`.tile-wrapper[data-index="${idx}"]`);
}

function getTile(idx) {
  return el.compGrid.querySelector(`.tile[data-index="${idx}"]`);
}

// ── Prompt logic ───────────────────────────────────────────────────

function applyPrompt() {
  clearPrompt();
  const tile = getTile(state.correctIdx);
  if (!tile) return;

  const cls = state.promptStyle === 'sparkle' ? 'prompt-sparkle' : 'prompt-outline';
  tile.classList.add(cls);

  if (!state.promptPersists) {
    state.promptHandle = setTimeout(() => {
      tile.classList.remove(cls);
      state.promptHandle = null;
    }, 3000);
  }
}

function clearPrompt() {
  clearTimeout(state.promptHandle);
  state.promptHandle = null;
  el.compGrid.querySelectorAll('.tile')
    .forEach(t => t.classList.remove('prompt-sparkle', 'prompt-outline'));
}

function onPromptButton() {
  state.prompted = true;
  applyPrompt();
}

// ── Trial overlay (Next + Retry watermark buttons) ─────────────────

function showNextBtn() {
  removeNextBtn();
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
  el.compSection.appendChild(overlay);
}

function removeNextBtn() {
  const overlay = $('trial-overlay');
  if (overlay) overlay.remove();
}

function onNextClick() {
  removeNextBtn();
  if (state.timerAutoPaused) { state.timerAutoPaused = false; startTimer(); }
  const last = state.sessionData[state.sessionData.length - 1];
  const needsRepeat = state.representErrors && last && (last.outcome === 'Error' || last.outcome === 'Repeat Error');
  beginTrial(needsRepeat);
}

function onRetryClick() {
  if (state.sessionData.length) {
    state.sessionData.pop();
    state.trialNum--;
  }
  removeNextBtn();
  if (state.timerAutoPaused) { state.timerAutoPaused = false; startTimer(); }
  beginTrial(false, true);
}

// ── Print data ─────────────────────────────────────────────────────

function printData() {
  if (!state.sessionData.length) {
    alert('No trial data to print yet. Complete at least one trial first.');
    return;
  }

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

// ── Target picker panel ───────────────────────────────────────────

function toggleTargetPanel() {
  setTargetPanelOpen(!state.targetPanelOpen);
}

function setTargetPanelOpen(open) {
  state.targetPanelOpen = open;
  el.btnTargetsToggle.setAttribute('aria-expanded', String(open));
  el.btnTargetsToggle.classList.toggle('is-open', open);
  if (open) {
    el.targetPanel.removeAttribute('hidden');
    renderTargetPanel();
  } else {
    el.targetPanel.setAttribute('hidden', '');
  }
}

function topicDisplayLabel(topic) {
  if (!topic) return '';
  return topic.replace(/^T_/, '').replace(/_/g, ' ')
              .replace(/\b\w/g, c => c.toUpperCase());
}

function renderTargetPanel() {
  if (el.targetPanelTopicLbl) {
    el.targetPanelTopicLbl.textContent = topicDisplayLabel(state.topic);
  }
  const body = el.targetPanelBody;
  body.innerHTML = '';

  if (!state.topic || !state.topicImages.length) {
    body.innerHTML = '<p class="target-panel-empty">No images for this topic.</p>';
    return;
  }

  const filter = new Set(state.targetFilters[state.topic] || []);
  state.topicImages.forEach(src => {
    const row = document.createElement('label');
    row.className = 'target-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.src = src;
    cb.checked = !filter.size || filter.has(src);
    cb.addEventListener('change', onTargetCheckboxChange);

    const thumb = document.createElement('img');
    thumb.className = 'target-thumb';
    thumb.src = src;
    thumb.alt = '';
    const thumbLbl = document.createElement('span');
    thumbLbl.className = 'target-thumb-label';
    thumbLbl.textContent = labelFromSrc(src);
    thumb.addEventListener('error', () => {
      thumb.remove();
      thumbLbl.classList.add('target-thumb-label-visible');
    });

    const label = document.createElement('span');
    label.className = 'target-row-label';
    label.textContent = labelFromSrc(src);

    row.appendChild(cb);
    row.appendChild(thumb);
    row.appendChild(thumbLbl);
    row.appendChild(label);
    body.appendChild(row);
  });
}

function targetCheckboxes() {
  return el.targetPanelBody.querySelectorAll('input[type="checkbox"][data-src]');
}

function onTargetCheckboxChange() {
  const checked = [];
  targetCheckboxes().forEach(cb => { if (cb.checked) checked.push(cb.dataset.src); });
  const allChecked = checked.length === state.topicImages.length;
  state.targetFilters[state.topic] = allChecked ? [] : checked;
  state.sampleDeck = [];
  saveSettings();
  updateTargetsCount();
}

function setAllTargets(checked) {
  targetCheckboxes().forEach(cb => { cb.checked = checked; });
  onTargetCheckboxChange();
}

function updateTargetsCount() {
  const total = state.topicImages.length;
  const filter = state.targetFilters[state.topic] || [];
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

function initializeTokenBoard() {
  if (!state.tokenBoardEnabled) return;
  
  if (state.tokenEmoji === 'random') {
    state.chosenEmoji = pickRandomEmoji();
  } else {
    state.chosenEmoji = state.tokenEmoji;
  }
  
  state.trialsCompleted = 0;
  state.vr_scheduleTrial = 0;
  if (state.scheduleType === 'VR') {
    state.vr_schedule = generateVRSchedule(1000, state.scheduleValue);
  }
  
  state.currentTokens = state.startingTokens;
  el.tokenBoard.hidden = false;
  renderTokenBoard();
}

function generateVRSchedule(numTrials, vrValue) {
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
  if (state.scheduleType === 'FR') {
    return state.trialsCompleted % state.scheduleValue === 0;
  } else if (state.scheduleType === 'VR') {
    if (state.vr_scheduleTrial < state.vr_schedule.length) {
      return state.trialsCompleted === state.vr_schedule[state.vr_scheduleTrial];
    }
    return false;
  }
  return false;
}

function awardTokensForTrial() {
  if (!state.tokenBoardEnabled) return;
  
  state.trialsCompleted++;
  
  if (shouldAwardTokens()) {
    if (state.currentTokens < state.goalTokens) {
      state.currentTokens++;
      if (state.scheduleType === 'VR') {
        state.vr_scheduleTrial++;
      }
    }
  }
  
  renderTokenBoard();
  saveSettings();
}

function renderTokenBoard() {
  const emojiDisplay = state.chosenEmoji.repeat(Math.min(state.currentTokens, 20));
  el.tokenEmojiDisplay.textContent = emojiDisplay;
  el.tokenProgressText.textContent = `${state.currentTokens} / ${state.goalTokens}`;
  
  if (state.currentTokens >= state.goalTokens) {
    el.tokenBoard.classList.add('goal-reached');
  } else {
    el.tokenBoard.classList.remove('goal-reached');
  }
}

function pickRandomEmoji() {
  const pool = ['⭐', '🔷', '💎', '✨', '🎁', '🏆', '💫', '🌟'];
  return pool[Math.floor(Math.random() * pool.length)];
}

function updateTokenBoardUIVisibility() {
  if (el.chkTokenBoard.checked) {
    el.tokenSettings.style.display = 'block';
  } else {
    el.tokenSettings.style.display = 'none';
  }
}
