'use strict';

/* ══════════════════════════════════════════════════════════════════
   INTRAVERBAL GAME
   Category-based fill-in-the-blank / carrier phrase game.
   items.json schema: categories[], categoryItems{}, items[{id,label,carriers[],images[]}]
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

function sample(arr, n) {
  return shuffle([...arr]).slice(0, n);
}

// ── State ──────────────────────────────────────────────────────────

const state = {
  // Settings
  category:          '',
  arraySize:         4,
  representErrors:   true,
  errorless:         false,
  noErrorAnim:       false,
  crossCategory:     false,
  promptPersists:    false,
  promptStyle:       'sparkle',
  autoPromptEnabled: false,
  promptDelay:       false,
  promptDelaySecs:   3,

  // Per-category target filters: { [cat]: itemId[] } — empty = no filter
  targetFilters: {},

  // Data
  categories:    [],
  categoryItems: {},
  items:         [],
  itemById:      {},

  // Session
  active:      false,
  sessionData: [],
  trialNum:    0,

  // Current trial
  targetItem:    null,
  carrierText:   '',
  tileItems:     [],
  correctIdx:    0,
  trialErrors:   0,
  trialStart:    0,
  prompted:      false,
  autoPrompted:  false,
  isRepeatTrial: false,

  // Decks
  posDeck:     [],
  targetDecks: {},  // keyed by category

  // Panel state
  targetPanelOpen: false,
  extraPanelOpen:  false,

  // Timer
  timerSecs:       0,
  timerRunning:    false,
  timerHandle:     null,
  timerAutoPaused: false,

  // Prompt timeouts
  promptHandle:     null,
  autoPromptHandle: null,

  // Vocal settings
  vocalPromptsEnabled:  false,
  vocalResponsesEnabled: false,

  // Recording
  recordingModalOpen: false,
  mediaRecorder: null,
  recordingCarrier: null,
  recordingTarget: null,
  isRecording: false,
  recordingType: null,
};

// ── DOM references ─────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const el = {
  timerDisplay:       $('timer-display'),
  btnTimerToggle:     $('btn-timer-toggle'),
  btnTimerReset:      $('btn-timer-reset'),
  selCategory:        $('sel-category'),
  inpSize:            $('inp-size'),
  btnStart:           $('btn-start'),
  gameArea:           $('game-area'),
  sampleWord:         $('sample-word'),
  compGrid:           $('comp-grid'),
  compSection:        $('comp-section'),
  btnPrompt:          $('btn-prompt'),
  btnPrint:           $('btn-print'),
  btnClearData:       $('btn-clear-data'),
  resultsBody:        $('results-body'),
  printMeta:          $('print-meta'),
  printSummary:       $('print-summary'),
  // Target panel
  btnTargetsToggle:   $('btn-targets-toggle'),
  targetsCount:       $('targets-count'),
  targetPanel:        $('target-panel'),
  targetPanelBody:    $('target-panel-body'),
  targetPanelCatLbl:  $('target-panel-category-label'),
  btnTargetsAll:      $('btn-targets-all'),
  btnTargetsNone:     $('btn-targets-none'),
  btnTargetsClose:    $('btn-targets-close'),
  // Extra panel
  btnExtraToggle:     $('btn-extra-toggle'),
  extraPanel:         $('extra-panel'),
  btnExtraClose:      $('btn-extra-close'),
  chkRepresentErrors: $('chk-represent-errors'),
  chkErrorless:       $('chk-errorless'),
  chkNoErrorAnim:     $('chk-no-error-anim'),
  chkCross:           $('chk-cross'),
  chkPersists:        $('chk-persists'),
  chkAutoPrompt:      $('chk-auto-prompt'),
  chkPromptDelay:     $('chk-prompt-delay'),
  selPromptDelay:     $('sel-prompt-delay'),
  selPromptStyle:     $('sel-prompt-style'),
  chkVocalPrompts:    $('chk-vocal-prompts'),
  chkVocalResponses:  $('chk-vocal-responses'),
  // Recording modal
  btnRecordToggle:    $('btn-record-toggle'),
  recordModal:        $('record-modal'),
  btnRecordClose:     $('btn-record-close'),
  recordCarrierText:  $('record-carrier-text'),
  recordTargetText:   $('record-target-text'),
  btnRecordCarrier:   $('btn-record-carrier'),
  btnPlayCarrier:     $('btn-play-carrier'),
  btnClearCarrier:    $('btn-clear-carrier'),
  btnRecordTarget:    $('btn-record-target'),
  btnPlayTarget:      $('btn-play-target'),
  btnClearTarget:     $('btn-clear-target'),
  recordStatus:       $('record-status'),
  btnSaveRecordings:  $('btn-save-recordings'),
};

// ── Boot ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  bindEvents();
  await loadItems();
});

// ── Settings (localStorage) ────────────────────────────────────────

function loadSettings() {
  const s = JSON.parse(localStorage.getItem('ivgSettings') || '{}');
  state.category          = s.category          ?? '';
  state.arraySize         = s.arraySize         ?? 4;
  state.representErrors   = s.representErrors   ?? true;
  state.errorless         = s.errorless         ?? false;
  state.noErrorAnim       = s.noErrorAnim       ?? false;
  state.crossCategory     = s.crossCategory     ?? false;
  state.promptPersists    = s.promptPersists    ?? false;
  state.promptStyle       = s.promptStyle       ?? 'sparkle';
  state.autoPromptEnabled = s.autoPromptEnabled ?? false;
  state.promptDelay       = s.promptDelay       ?? false;
  state.promptDelaySecs   = s.promptDelaySecs   ?? 3;
  state.vocalPromptsEnabled  = s.vocalPromptsEnabled  ?? false;
  state.vocalResponsesEnabled = s.vocalResponsesEnabled ?? false;
  state.targetFilters     = (s.targetFilters && typeof s.targetFilters === 'object')
    ? s.targetFilters : {};

  el.inpSize.value                = state.arraySize;
  el.chkRepresentErrors.checked   = state.representErrors;
  el.chkErrorless.checked         = state.errorless;
  el.chkNoErrorAnim.checked       = state.noErrorAnim;
  el.chkCross.checked             = state.crossCategory;
  el.chkPersists.checked          = state.promptPersists;
  el.selPromptStyle.value         = state.promptStyle;
  el.chkAutoPrompt.checked        = state.autoPromptEnabled;
  el.chkPromptDelay.checked       = state.promptDelay;
  el.selPromptDelay.value         = state.promptDelaySecs;
  el.chkVocalPrompts.checked      = state.vocalPromptsEnabled;
  el.chkVocalResponses.checked    = state.vocalResponsesEnabled;

  el.chkPromptDelay.disabled = !state.autoPromptEnabled;
  el.selPromptDelay.disabled = !state.autoPromptEnabled || !state.promptDelay;
}

function saveSettings() {
  localStorage.setItem('ivgSettings', JSON.stringify({
    category:          state.category,
    arraySize:         state.arraySize,
    representErrors:   state.representErrors,
    errorless:         state.errorless,
    noErrorAnim:       state.noErrorAnim,
    crossCategory:     state.crossCategory,
    promptPersists:    state.promptPersists,
    promptStyle:       state.promptStyle,
    autoPromptEnabled: state.autoPromptEnabled,
    promptDelay:       state.promptDelay,
    promptDelaySecs:   state.promptDelaySecs,
    vocalPromptsEnabled:  state.vocalPromptsEnabled,
    vocalResponsesEnabled: state.vocalResponsesEnabled,
    targetFilters:     state.targetFilters,
  }));
}

// ── Data loading ───────────────────────────────────────────────────

async function loadItems() {
  try {
    const r = await fetch('./items.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    state.categories    = data.categories    || [];
    state.categoryItems = data.categoryItems || {};
    state.items         = data.items         || [];
    state.itemById      = {};
    state.items.forEach(it => { state.itemById[it.id] = it; });
  } catch (e) {
    console.error('Could not load items.json:', e);
    state.categories    = [];
    state.categoryItems = {};
    state.items         = [];
    state.itemById      = {};
  }
  pruneStaleTargetFilters();
  populateCategoryDropdown();
  updateTargetsCount();
}

function pruneStaleTargetFilters() {
  const known = new Set(state.items.map(it => it.id));
  for (const cat of Object.keys(state.targetFilters)) {
    state.targetFilters[cat] = (state.targetFilters[cat] || []).filter(id => known.has(id));
  }
}

// ── Category dropdown ──────────────────────────────────────────────

function populateCategoryDropdown() {
  el.selCategory.innerHTML = '';
  if (!state.categories.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '(no categories)';
    el.selCategory.appendChild(o);
    state.category = '';
    return;
  }
  state.categories.forEach(cat => {
    const o = document.createElement('option');
    o.value = cat;
    o.textContent = catLabel(cat);
    el.selCategory.appendChild(o);
  });
  if (state.category && state.categories.includes(state.category)) {
    el.selCategory.value = state.category;
  } else {
    state.category = state.categories[0];
    el.selCategory.value = state.category;
  }
}

function catLabel(cat) {
  return cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Event bindings ─────────────────────────────────────────────────

function bindEvents() {
  el.btnTimerToggle.addEventListener('click', toggleTimer);
  el.btnTimerReset .addEventListener('click', resetTimer);

  el.selCategory.addEventListener('change', () => {
    state.category    = el.selCategory.value;
    state.targetDecks = {};
    saveSettings();
    renderTargetPanel();
    updateTargetsCount();
  });

  el.inpSize.addEventListener('change', () => {
    const v = Math.min(10, Math.max(2, parseInt(el.inpSize.value) || 4));
    state.arraySize  = v;
    el.inpSize.value = v;
    state.posDeck    = [];
    saveSettings();
  });

  // Target panel
  el.btnTargetsToggle.addEventListener('click', toggleTargetPanel);
  el.btnTargetsClose .addEventListener('click', () => setTargetPanelOpen(false));
  el.btnTargetsAll   .addEventListener('click', () => setAllTargets(true));
  el.btnTargetsNone  .addEventListener('click', () => setAllTargets(false));

  // Extra panel
  el.btnExtraToggle.addEventListener('click', toggleExtraPanel);
  el.btnExtraClose .addEventListener('click', () => setExtraPanelOpen(false));

  el.chkRepresentErrors.addEventListener('change', () => {
    state.representErrors = el.chkRepresentErrors.checked;
    saveSettings();
  });
  el.chkErrorless.addEventListener('change', () => {
    state.errorless = el.chkErrorless.checked;
    saveSettings();
  });
  el.chkNoErrorAnim.addEventListener('change', () => {
    state.noErrorAnim = el.chkNoErrorAnim.checked;
    saveSettings();
  });
  el.chkCross.addEventListener('change', () => {
    state.crossCategory = el.chkCross.checked;
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

  el.chkVocalPrompts.addEventListener('change', () => {
    state.vocalPromptsEnabled = el.chkVocalPrompts.checked;
    saveSettings();
  });

  el.chkVocalResponses.addEventListener('change', () => {
    state.vocalResponsesEnabled = el.chkVocalResponses.checked;
    saveSettings();
  });

  el.btnRecordToggle.addEventListener('click', toggleRecordingModal);
  el.btnRecordClose.addEventListener('click', closeRecordingModal);

  // Record button is admin-only; show/hide as admin state changes
  document.addEventListener('admin-state-change', syncRecordButton);
  el.btnRecordCarrier.addEventListener('click', () => startRecording('carrier'));
  el.btnPlayCarrier.addEventListener('click', () => playRecording('carrier'));
  el.btnClearCarrier.addEventListener('click', () => clearRecording('carrier'));
  el.btnRecordTarget.addEventListener('click', () => startRecording('target'));
  el.btnPlayTarget.addEventListener('click', () => playRecording('target'));
  el.btnClearTarget.addEventListener('click', () => clearRecording('target'));
  el.btnSaveRecordings.addEventListener('click', saveRecordingsToItems);

  el.btnStart    .addEventListener('click', startGame);
  el.btnPrompt   .addEventListener('click', onPromptButton);
  el.btnPrint    .addEventListener('click', printData);

  el.btnClearData.addEventListener('click', () => {
    if (!state.sessionData.length) { alert('No data to clear.'); return; }
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
  state.timerSecs  = 0;
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

// ── Target deck — cycle without repeats ───────────────────────────

function nextTarget(cat, pool) {
  if (!pool.length) return null;
  let deck = state.targetDecks[cat];
  if (!deck || !deck.length) {
    deck = shuffle([...pool]);
    state.targetDecks[cat] = deck;
  }
  return deck.pop();
}

// ── Items helpers ──────────────────────────────────────────────────

function eligibleTargetItems(cat = state.category) {
  const catItemIds = state.categoryItems[cat] || [];
  const filter     = state.targetFilters[cat] || [];
  const filterSet  = filter.length ? new Set(filter) : null;
  return catItemIds
    .map(id => state.itemById[id])
    .filter(it => it && (!filterSet || filterSet.has(it.id)));
}

function itemsForCategory(cat = state.category) {
  return (state.categoryItems[cat] || [])
    .map(id => state.itemById[id])
    .filter(Boolean);
}

// ── Trial builder ──────────────────────────────────────────────────

function buildTrialData(cat, n, forcedTarget = null, forcedCarrier = null) {
  const eligible = eligibleTargetItems(cat);
  if (!eligible.length) return null;

  const target = forcedTarget ?? nextTarget(cat, eligible);
  if (!target) return null;

  const carrier = forcedCarrier
    ?? ((target.carriers && target.carriers.length)
        ? pickRandom(target.carriers)
        : target.label);

  // Within-category distractors first; fall back to all items when pool is
  // too small OR crossCategory is enabled.
  const sameCatItems = (state.categoryItems[cat] || [])
    .map(id => state.itemById[id])
    .filter(it => it && it.id !== target.id);

  const distractorPool =
    (!state.crossCategory && sameCatItems.length >= n - 1)
      ? sameCatItems
      : state.items.filter(it => it.id !== target.id);

  if (!distractorPool.length) return null;

  const distractors = sample(distractorPool, n - 1);
  while (distractors.length < n - 1) distractors.push(pickRandom(distractorPool));

  const correctPos = nextPosition();
  const tileItems  = new Array(n);
  let di = 0;
  for (let i = 0; i < n; i++) {
    tileItems[i] = (i === correctPos) ? target : distractors[di++];
  }

  return { targetItem: target, carrierText: carrier, tileItems, correctIdx: correctPos };
}

// ── Game flow ──────────────────────────────────────────────────────

function startGame() {
  if (!state.items.length) {
    alert('No items loaded. Check that items.json is present and reload.');
    return;
  }
  if (!state.category) {
    alert('No category selected.');
    return;
  }
  if (!eligibleTargetItems().length) {
    alert('No eligible targets for this category. Check your target filter.');
    return;
  }

  state.active      = true;
  state.posDeck     = [];
  state.targetDecks = {};

  el.gameArea.removeAttribute('hidden');
  el.btnPrompt.removeAttribute('hidden');
  syncRecordButton();
  removeNextBtn();

  resetTimer();
  startTimer();
  beginTrial();
}

function beginTrial(keepTarget = false) {
  state.trialNum++;
  state.trialErrors   = 0;
  state.prompted      = false;
  state.autoPrompted  = false;
  state.isRepeatTrial = keepTarget;
  state.trialStart    = Date.now();

  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;
  clearPrompt();

  if (!keepTarget) {
    const cat = state.category;
    if (!cat) { alert('No category selected.'); return; }
    const trial = buildTrialData(cat, state.arraySize);
    if (!trial) {
      alert(`Not enough items to build a trial for "${catLabel(cat)}".`);
      return;
    }
    state.targetItem  = trial.targetItem;
    state.carrierText = trial.carrierText;
    state.tileItems   = trial.tileItems;
    state.correctIdx  = trial.correctIdx;
  } else {
    // Error correction: same target + same carrier; rebuild positions/distractors.
    const trial = buildTrialData(
      state.category, state.arraySize,
      state.targetItem, state.carrierText
    );
    if (trial) {
      state.tileItems  = trial.tileItems;
      state.correctIdx = trial.correctIdx;
    }
  }

  // Load recorded audio from storage if available
  const storedAudio = loadAudioFromStorage(state.targetItem.id);
  if (storedAudio) {
    if (storedAudio.carrierAudio) state.targetItem.carrierAudio = storedAudio.carrierAudio;
    if (storedAudio.labelAudio) state.targetItem.labelAudio = storedAudio.labelAudio;
  }

  renderTrial();

  if (state.vocalPromptsEnabled) {
    speakCarrier();
  }

  if (keepTarget) {
    state.autoPrompted = true;
    setTimeout(applyPrompt, 80);
  } else if (state.autoPromptEnabled) {
    if (state.promptDelay) {
      state.autoPromptHandle = setTimeout(() => {
        state.autoPrompted     = true;
        state.autoPromptHandle = null;
        applyPrompt();
      }, state.promptDelaySecs * 1000);
    } else {
      state.autoPrompted = true;
      setTimeout(applyPrompt, 80);
    }
  }
}

function renderTrial() {
  el.sampleWord.textContent = state.carrierText;
  fitSampleWord();

  const cols = gridCols(state.arraySize);
  el.compGrid.style.setProperty('--grid-cols', cols);
  el.compGrid.style.gridTemplateColumns = '';
  el.compGrid.innerHTML = '';

  state.tileItems.forEach((item, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className   = 'tile-wrapper';
    wrapper.dataset.index = idx;

    const tile = document.createElement('div');
    tile.className    = 'tile';
    tile.dataset.index = idx;

    const front = document.createElement('div');
    front.className = 'tile-face tile-front';

    if (item.images && item.images.length) {
      const imgSrc = pickRandom(item.images);
      const img    = document.createElement('img');
      img.src = `_Resources/_imgSource/items/${imgSrc}`;
      img.alt = item.label;
      const text = document.createElement('span');
      text.className = 'tile-text';
      img.addEventListener('error', () => {
        img.remove();
        text.classList.add('tile-text-visible');
        text.textContent = item.label;
      });
      front.appendChild(img);
      front.appendChild(text);
    } else {
      const text = document.createElement('span');
      text.className   = 'tile-text tile-text-visible';
      text.textContent = item.label;
      front.appendChild(text);
    }

    const back   = document.createElement('div');
    back.className = 'tile-face tile-back';
    const okSpan   = document.createElement('span');
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

  const compSection = document.getElementById('comp-section');
  const areaLabel = compSection && compSection.querySelector('.area-label');
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

function fitSampleWord() {
  const card = document.getElementById('sample-card');
  const word = el.sampleWord;
  const cs   = getComputedStyle(card);
  const maxW = card.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const maxH = card.clientHeight - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);
  let px = 36;
  word.style.fontSize = px + 'px';
  while (px > 10 && (word.scrollWidth > maxW || word.scrollHeight > maxH)) {
    px -= 1;
    word.style.fontSize = px + 'px';
  }
}

function gridCols(n) {
  const map = { 1:1, 2:2, 3:3, 4:4, 5:3, 6:3, 7:4, 8:4, 9:3, 10:5 };
  return map[n] ?? 4;
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
    if (state.errorless) return;  // silently ignore wrong taps
    onWrongClick(wrapper);
  }
}

function onCorrectClick(wrapper, tile) {
  disableAllTiles();
  clearPrompt();
  if (state.timerRunning) { pauseTimer(); state.timerAutoPaused = true; }

  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;

  if (state.vocalResponsesEnabled) {
    speakTarget();
  }

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
    category:  state.category,
    carrier:   state.carrierText,
    target:    state.targetItem.label,
    arraySize: state.arraySize,
    errors:    state.trialErrors,
    prompted:  state.prompted || state.autoPrompted,
    promptDelaySecs: (!state.isRepeatTrial && state.autoPromptEnabled && state.promptDelay)
      ? state.promptDelaySecs : null,
    time: elapsed,
    outcome,
    settingsKey: [
      state.category, state.arraySize,
      state.representErrors   ? 1 : 0,
      state.errorless         ? 1 : 0,
      state.noErrorAnim       ? 1 : 0,
      state.autoPromptEnabled ? 1 : 0,
      state.promptPersists    ? 1 : 0,
      state.promptStyle,
      state.promptDelay ? state.promptDelaySecs : 0,
    ].join('|'),
  });

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
  el.compGrid.querySelectorAll('.tile')
    .forEach(t => t.classList.add('tile-disabled'));
  el.compGrid.querySelectorAll('.tile-wrapper')
    .forEach(w => { w.style.pointerEvents = 'none'; });
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
  if (state.vocalPromptsEnabled) {
    speakCarrier();
  }
}

// ── Vocal synthesis ────────────────────────────────────────────────

function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

function speakCarrier() {
  if (!state.carrierText) return;
  if (state.targetItem?.carrierAudio) {
    const carrierIndex = state.targetItem.carriers?.indexOf(state.carrierText) ?? 0;
    const audio = state.targetItem.carrierAudio[carrierIndex];
    if (audio) {
      playAudioData(audio);
      return;
    }
  }
  speakText(state.carrierText);
}

function speakTarget() {
  if (!state.targetItem || !state.targetItem.label) return;
  if (state.targetItem?.labelAudio) {
    playAudioData(state.targetItem.labelAudio);
    return;
  }
  speakText(state.targetItem.label);
}

function playAudioData(audioData) {
  const audio = new Audio(audioData);
  audio.play().catch(() => console.error('Could not play audio'));
}

// ── Recording modal ────────────────────────────────────────────────

// The Record button is admin-only and only meaningful while a session
// is active. Hide it whenever either condition isn't met.
function syncRecordButton() {
  const isAdmin = window.NoocAdmin && window.NoocAdmin.isAdmin();
  const show = state.active && isAdmin;
  if (show) el.btnRecordToggle.removeAttribute('hidden');
  else      el.btnRecordToggle.setAttribute('hidden', '');
  if (!isAdmin && state.recordingModalOpen) closeRecordingModal();
}

function toggleRecordingModal() {
  state.recordingModalOpen ? closeRecordingModal() : openRecordingModal();
}

function openRecordingModal() {
  if (!state.active) return;
  state.recordingModalOpen = true;
  el.recordModal.removeAttribute('hidden');
  el.recordCarrierText.textContent = state.carrierText;
  el.recordTargetText.textContent = state.targetItem?.label || '';
  updateRecordingButtonStates();
}

function closeRecordingModal() {
  if (state.isRecording) stopRecording();
  state.recordingModalOpen = false;
  el.recordModal.setAttribute('hidden', '');
}

function updateRecordingButtonStates() {
  el.btnPlayCarrier.disabled = !state.recordingCarrier;
  el.btnClearCarrier.disabled = !state.recordingCarrier;
  el.btnPlayTarget.disabled = !state.recordingTarget;
  el.btnClearTarget.disabled = !state.recordingTarget;
}

async function startRecording(type) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.mediaRecorder = new MediaRecorder(stream);
    const chunks = [];
    state.mediaRecorder.ondataavailable = e => chunks.push(e.data);
    state.mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      blobToBase64(blob, base64 => {
        if (type === 'carrier') {
          state.recordingCarrier = base64;
        } else {
          state.recordingTarget = base64;
        }
        updateRecordingButtonStates();
        setRecordingStatus(`${type === 'carrier' ? 'Carrier' : 'Target'} recorded`, 'success');
      });
      stream.getTracks().forEach(t => t.stop());
    };
    state.isRecording = true;
    state.recordingType = type;
    state.mediaRecorder.start();
    const btn = type === 'carrier' ? el.btnRecordCarrier : el.btnRecordTarget;
    btn.textContent = 'Stop';
    btn.classList.add('recording');
  } catch (e) {
    setRecordingStatus('Microphone access denied', 'error');
  }
}

function stopRecording() {
  if (!state.mediaRecorder || !state.isRecording) return;
  state.mediaRecorder.stop();
  state.isRecording = false;
  const btn = state.recordingType === 'carrier' ? el.btnRecordCarrier : el.btnRecordTarget;
  btn.textContent = 'Record';
  btn.classList.remove('recording');
}

function playRecording(type) {
  const base64 = type === 'carrier' ? state.recordingCarrier : state.recordingTarget;
  if (!base64) return;
  const audio = new Audio(base64);
  audio.play().catch(() => setRecordingStatus('Could not play recording', 'error'));
}

function clearRecording(type) {
  if (type === 'carrier') {
    state.recordingCarrier = null;
  } else {
    state.recordingTarget = null;
  }
  updateRecordingButtonStates();
  setRecordingStatus(`${type === 'carrier' ? 'Carrier' : 'Target'} cleared`, 'success');
}

function setRecordingStatus(msg, type) {
  el.recordStatus.textContent = msg;
  el.recordStatus.className = 'record-status ' + (type || '');
  setTimeout(() => {
    el.recordStatus.textContent = '';
    el.recordStatus.className = 'record-status';
  }, 2500);
}

function blobToBase64(blob, callback) {
  const reader = new FileReader();
  reader.onloadend = () => callback(reader.result);
  reader.readAsDataURL(blob);
}

function saveRecordingsToItems() {
  if (!state.targetItem) return;
  const item = state.itemById[state.targetItem.id];
  if (!item) {
    setRecordingStatus('Item not found', 'error');
    return;
  }
  if (state.recordingCarrier) {
    if (!item.carrierAudio) item.carrierAudio = {};
    const carrierIndex = state.targetItem.carriers?.indexOf(state.carrierText) ?? 0;
    item.carrierAudio[carrierIndex] = state.recordingCarrier;
  }
  if (state.recordingTarget) {
    item.labelAudio = state.recordingTarget;
  }
  saveAudioToStorage(item.id, item);
  console.log('Recordings saved to item:', item);
  setRecordingStatus('Recordings saved!', 'success');
  state.recordingCarrier = null;
  state.recordingTarget = null;
  updateRecordingButtonStates();
  setTimeout(closeRecordingModal, 1500);
}

function saveAudioToStorage(itemId, itemData) {
  let recordings = JSON.parse(sessionStorage.getItem('ivgRecordings') || '{}');
  recordings[itemId] = itemData;
  sessionStorage.setItem('ivgRecordings', JSON.stringify(recordings));
}

function loadAudioFromStorage(itemId) {
  const recordings = JSON.parse(sessionStorage.getItem('ivgRecordings') || '{}');
  return recordings[itemId];
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
  const needsRepeat = state.representErrors
    && last && (last.outcome === 'Error' || last.outcome === 'Repeat Error');
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

    const tr   = document.createElement('tr');
    const prev = state.sessionData[i - 1];
    const settingsChanged = prev && d.settingsKey !== prev.settingsKey;
    if (settingsChanged) tr.classList.add('settings-changed');
    const b = settingsChanged ? ' style="font-weight:bold"' : '';
    tr.innerHTML =
      `<td${b}>${d.trial}</td>` +
      `<td${b}>${catLabel(d.category)}</td>` +
      `<td${b}>${d.carrier}</td>` +
      `<td${b}>${d.target}</td>` +
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

// ── Extra settings panel ───────────────────────────────────────────

function toggleExtraPanel() { setExtraPanelOpen(!state.extraPanelOpen); }

function setExtraPanelOpen(open) {
  state.extraPanelOpen = open;
  el.btnExtraToggle.setAttribute('aria-expanded', String(open));
  el.btnExtraToggle.classList.toggle('is-open', open);
  if (open) {
    el.extraPanel.removeAttribute('hidden');
  } else {
    el.extraPanel.setAttribute('hidden', '');
  }
}

// ── Target picker panel ────────────────────────────────────────────

function toggleTargetPanel() { setTargetPanelOpen(!state.targetPanelOpen); }

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

function renderTargetPanel() {
  el.targetPanelCatLbl.textContent = catLabel(state.category);
  const body = el.targetPanelBody;
  body.innerHTML = '';

  const catItems = itemsForCategory();
  if (!catItems.length) {
    body.innerHTML = '<p class="target-panel-empty">No items in this category.</p>';
    return;
  }

  const filter = new Set(state.targetFilters[state.category] || []);

  catItems.forEach(it => {
    const row = document.createElement('label');
    row.className = 'target-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.itemId = it.id;
    cb.checked = !filter.size || filter.has(it.id);
    cb.addEventListener('change', onTargetCheckboxChange);

    const label = document.createElement('span');
    label.className  = 'target-row-label';
    label.textContent = it.label;

    const sub = document.createElement('span');
    sub.className   = 'target-row-sub';
    sub.textContent = it.carriers && it.carriers.length ? it.carriers[0] : '';

    row.appendChild(cb);
    row.appendChild(label);
    row.appendChild(sub);
    body.appendChild(row);
  });
}

function targetCheckboxes() {
  return el.targetPanelBody.querySelectorAll('input[type="checkbox"][data-item-id]');
}

function onTargetCheckboxChange() {
  const catItems  = itemsForCategory();
  const checkedIds = new Set();
  targetCheckboxes().forEach(cb => {
    if (cb.checked) checkedIds.add(cb.dataset.itemId);
  });
  const allChecked = catItems.every(it => checkedIds.has(it.id));
  state.targetFilters[state.category] = allChecked ? [] : [...checkedIds];
  state.targetDecks = {};
  saveSettings();
  updateTargetsCount();
}

function setAllTargets(checked) {
  targetCheckboxes().forEach(cb => { cb.checked = checked; });
  onTargetCheckboxChange();
}

function updateTargetsCount() {
  const catItems = itemsForCategory();
  const filter   = state.targetFilters[state.category] || [];
  const selected = filter.length ? filter.length : catItems.length;
  el.targetsCount.textContent = `${selected} of ${catItems.length}`;
  el.btnTargetsToggle.classList.toggle('is-filtered', filter.length > 0);
}
