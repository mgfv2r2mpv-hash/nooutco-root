'use strict';

/* ══════════════════════════════════════════════════════════════════
   IDENTICAL MATCHING GAME
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

// ── State ──────────────────────────────────────────────────────────

const state = {
  // Persisted settings
  topic:             '',
  arraySize:         4,
  representErrors:   true,
  errorless:         false,
  noErrorAnim:       false,
  extraPanelOpen:    false,
  nonTargetDistractors: true,
  crossCategory:     false,
  promptPersists:    false,
  promptStyle:       'sparkle',
  autoPromptEnabled: false,
  promptDelay:       false,
  promptDelaySecs:   3,

  // Per-topic target filters (arrays of src paths; empty = no filter)
  targetFilters: {},

  // Target panel UI state
  targetPanelOpen: false,

  // Discovered folders & images
  manifest:     null,
  topicFolders: [],
  topicImages:  [],
  otherImages:  [],

  // Session — persists across topic changes; cleared by Clear Data
  active:      false,
  sessionData: [],
  trialNum:    0,

  // Current trial
  sampleSrc:    '',
  tileImages:   [],
  correctIdx:   0,
  trialErrors:  0,
  trialStart:   0,
  prompted:     false,
  autoPrompted: false,
  isRepeatTrial: false,

  // Shuffled position deck
  posDeck: [],

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
  sampleImg:      $('sample-img'),
  compGrid:       $('comp-grid'),
  compSection:    $('comp-section'),
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
};

// ── Boot ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  bindEvents();
  await discoverTopics();
});

// ── Settings (localStorage) ────────────────────────────────────────

function loadSettings() {
  const s = JSON.parse(localStorage.getItem('mgSettings') || '{}');
  state.topic             = s.topic             ?? '';
  state.arraySize         = s.arraySize         ?? 4;
  state.representErrors   = s.representErrors   ?? true;
  state.errorless         = s.errorless         ?? false;
  state.noErrorAnim       = s.noErrorAnim       ?? false;
  state.nonTargetDistractors = s.nonTargetDistractors ?? true;
  state.crossCategory     = s.crossCategory     ?? false;
  state.promptPersists    = s.promptPersists    ?? false;
  state.promptStyle       = s.promptStyle       ?? 'sparkle';
  state.autoPromptEnabled = s.autoPromptEnabled ?? false;
  state.promptDelay       = s.promptDelay       ?? false;
  state.promptDelaySecs   = s.promptDelaySecs   ?? 3;
  state.targetFilters     = s.targetFilters     ?? {};

  el.inpSize.value              = state.arraySize;
  el.chkRepresentErrors.checked = state.representErrors;
  el.chkErrorless.checked       = state.errorless;
  el.chkNoErrorAnim.checked     = state.noErrorAnim;
  el.chkNonTargetDistractor.checked = state.nonTargetDistractors;
  el.chkCross.checked           = state.crossCategory;
  el.chkPersists.checked    = state.promptPersists;
  el.selPromptStyle.value   = state.promptStyle;
  el.chkAutoPrompt.checked  = state.autoPromptEnabled;
  el.chkPromptDelay.checked = state.promptDelay;
  el.selPromptDelay.value   = state.promptDelaySecs;

  // Sync enabled state of delay controls
  el.chkPromptDelay.disabled = !state.autoPromptEnabled;
  el.selPromptDelay.disabled = !state.autoPromptEnabled || !state.promptDelay;
}

function saveSettings() {
  localStorage.setItem('mgSettings', JSON.stringify({
    topic:             state.topic,
    arraySize:         state.arraySize,
    representErrors:   state.representErrors,
    errorless:         state.errorless,
    noErrorAnim:       state.noErrorAnim,
    nonTargetDistractors: state.nonTargetDistractors,
    crossCategory:     state.crossCategory,
    promptPersists:    state.promptPersists,
    promptStyle:       state.promptStyle,
    autoPromptEnabled: state.autoPromptEnabled,
    promptDelay:       state.promptDelay,
    promptDelaySecs:   state.promptDelaySecs,
    targetFilters:     state.targetFilters,
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
}

// Display name overrides for folder names that contain abbreviations or proper nouns
const TOPIC_DISPLAY_NAMES = {
  'T_pbs_characters': 'PBS Characters',
};

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
  if (!state.topic) { state.topicImages = []; state.otherImages = []; updateTargetsCount(); return; }

  if (state.manifest) {
    state.topicImages = state.manifest.images[state.topic] || [];
    state.otherImages = (state.crossCategory && state.topicFolders.length > 1)
      ? state.topicFolders
          .filter(f => f !== state.topic)
          .flatMap(f => state.manifest.images[f] || [])
      : [];
  } else {
    state.topicImages = await fetchDirImages(state.topic);
    if (state.crossCategory && state.topicFolders.length > 1) {
      const others = state.topicFolders.filter(f => f !== state.topic);
      state.otherImages = (await Promise.all(others.map(fetchDirImages))).flat();
    } else {
      state.otherImages = [];
    }
  }

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

  el.chkNonTargetDistractor.addEventListener('change', () => {
    state.nonTargetDistractors = el.chkNonTargetDistractor.checked;
    saveSettings();
  });

  el.chkCross.addEventListener('change', async () => {
    state.crossCategory = el.chkCross.checked;
    saveSettings();
    await refreshImages();
  });

  // Target panel
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

  // sessionData and trialNum persist; only reset active-play state
  state.active     = true;
  state.posDeck    = [];

  el.gameArea.removeAttribute('hidden');
  el.btnPrompt.removeAttribute('hidden');
  removeTrialButtons();

  resetTimer();
  startTimer();
  beginTrial();
}

/**
 * Begin a new trial.
 * keepSample=true → error-correction repeat (same sample, reshuffled, auto-prompted).
 * isRetry=true    → procedural-error retry (same sample, reshuffled, no prompt).
 */
function beginTrial(keepSample = false, isRetry = false) {
  state.trialNum++;
  state.trialErrors   = 0;
  state.prompted      = false;
  state.autoPrompted  = false;
  state.isRepeatTrial = keepSample && !isRetry;
  state.trialStart    = Date.now();

  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;

  clearPrompt();
  buildTrial(keepSample || isRetry);
  renderTrial();

  if (keepSample && !isRetry) {
    // Error correction: always auto-prompt immediately.
    state.autoPrompted = true;
    setTimeout(applyPrompt, 80);
  } else if (!keepSample && !isRetry && state.autoPromptEnabled) {
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
  // isRetry: no auto-prompt — clean fresh presentation.
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

function renderTrial() {
  el.sampleImg.src = state.sampleSrc;
  el.sampleImg.alt = 'Sample stimulus';

  const cols = gridCols(state.arraySize);
  el.compGrid.style.setProperty('--grid-cols', cols);
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
    front.appendChild(img);

    // Back face — content (text + colour class) set at correct-click time
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

// Recompute tile size when the game area resizes (orientation,
// settings panel toggle, soft-keyboard, etc.).
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

  // Cancel delayed auto-prompt if it hadn't fired yet
  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;

  const elapsed = ((Date.now() - state.trialStart) / 1000).toFixed(1);

  // Determine outcome (5 possibilities)
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
    ].join('|'),
  });

  // Style back face before flip
  const backFace = tile.querySelector('.tile-back');
  const okSpan   = backFace.querySelector('.ok-text');
  if (outcome === 'Correct') {
    backFace.classList.add('back-correct');
    okSpan.textContent = '✓';
  } else if (outcome === 'Prompted' || outcome === 'Correction') {
    okSpan.textContent = '✓';   // neutral grey + checkmark
  } else {
    okSpan.textContent = 'OK';  // Error or Repeat Error
  }

  wrapper.classList.add('expanding');
  setTimeout(() => {
    wrapper.classList.remove('expanding');
    tile.classList.add('flipped');
    setTimeout(showTrialButtons, 580);
  }, 280);
}

function onWrongClick(wrapper) {
  state.trialErrors++;

  // Cancel any pending auto-prompt delay; wrong click triggers immediate prompt
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
  el.compSection.appendChild(overlay);
}

function removeTrialButtons() {
  const overlay = $('trial-overlay');
  if (overlay) overlay.remove();
}

function onNextClick() {
  removeTrialButtons();
  if (state.timerAutoPaused) { state.timerAutoPaused = false; startTimer(); }
  const last = state.sessionData[state.sessionData.length - 1];
  const needsRepeat = state.representErrors && last && (last.outcome === 'Error' || last.outcome === 'Repeat Error');
  beginTrial(needsRepeat);
}

function onRetryClick() {
  // Void the completed trial — procedural error, don't count it.
  if (state.sessionData.length) {
    state.sessionData.pop();
    state.trialNum--;
  }
  removeTrialButtons();
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

// ── Target picker panel ────────────────────────────────────────────

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

function srcLabel(src) {
  return src.split('/').pop()
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
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

    row.appendChild(cb);
    row.appendChild(thumb);
    row.appendChild(lbl);
    body.appendChild(row);
  });
}

function targetCheckboxes() {
  return el.targetPanelBody.querySelectorAll('input[type="checkbox"][data-src]');
}

function onTargetCheckboxChange(changedCb) {
  const checkedSrcs = new Set();
  targetCheckboxes().forEach(cb => {
    if (cb.checked) checkedSrcs.add(cb.dataset.src);
  });

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
