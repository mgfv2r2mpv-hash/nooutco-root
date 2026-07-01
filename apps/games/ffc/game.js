'use strict';

/* ══════════════════════════════════════════════════════════════════
   FEATURE · FUNCTION · CLASS GAME
   Items carry four orthogonal tag sets (groups, features, functions,
   classes). Each trial mode picks a tag and builds an array where
   only the target item satisfies it; distractors are drawn from the
   same or different groups depending on mode.
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

// ── Mode configuration ─────────────────────────────────────────────
//
// Single source of truth for each mode's vocab bucket, shared prompt
// key, and distractor-selection strategy. Both class modes map to the
// same promptKey so their prompts are authored once in items.json.

const MODE_CONFIG = {
  feature:            { bucket: 'features',  promptKey: 'feature',  distractors: 'withinGroup'   },
  function:           { bucket: 'functions', promptKey: 'function', distractors: 'withinGroup'   },
  classWithinGroup:   { bucket: 'classes',   promptKey: 'class',    distractors: 'withinGroup'   },
  classCrossCategory: { bucket: 'classes',   promptKey: 'class',    distractors: 'crossCategory' },
};

// ── State ──────────────────────────────────────────────────────────

const state = {
  // Settings
  mode:              'feature',
  tag:               '',
  arraySize:         4,
  representErrors:   true,
  errorless:         false,
  noErrorAnim:       false,
  extraPanelOpen:    false,
  promptPersists:    false,
  promptStyle:       'sparkle',
  autoPromptEnabled: false,
  promptDelay:       false,
  promptDelaySecs:   3,

  // Per-mode target filters (arrays of item ids; empty = no filter)
  targetFilters: {
    feature:            [],
    function:           [],
    classWithinGroup:   [],
    classCrossCategory: [],
  },

  // Data
  items:          [],
  vocab:          { groups:[], features:[], functions:[], classes:[] },
  prompts:        {},
  promptDefaults: {},

  // Session
  active:      false,
  sessionData: [],
  trialNum:    0,

  // Current trial
  targetItem:    null,
  targetTag:     '',
  promptSentence:'',
  tileItems:     [],
  correctIdx:    0,
  trialErrors:   0,
  trialStart:    0,
  prompted:      false,
  autoPrompted:  false,
  isRepeatTrial: false,

  // Decks
  posDeck:     [],
  targetDecks: {},  // keyed by `${mode}|${tag}`

  // Target panel UI state
  targetPanelOpen: false,

  // Timer
  timerSecs:       0,
  timerRunning:    false,
  timerHandle:     null,
  timerAutoPaused: false,

  // Prompt timeouts
  promptHandle:     null,
  autoPromptHandle: null,

  // Post-answer reveal timeouts (tile flip + Next/Retry overlay). Tracked so a
  // new trial (Start / Next / Retry) can cancel a pending reveal — otherwise a
  // deferred showTrialButtons() from the finished trial lands on the fresh one.
  revealHandle:     null,
  btnHandle:        null,
};

// ── DOM references ─────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const el = {
  timerDisplay:        $('timer-display'),
  btnTimerToggle:      $('btn-timer-toggle'),
  btnTimerReset:       $('btn-timer-reset'),
  selMode:             $('sel-mode'),
  selTag:              $('sel-tag'),
  inpSize:             $('inp-size'),
  chkPersists:         $('chk-persists'),
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
  targetPanelModeLbl:  $('target-panel-mode-label'),
  btnTargetsAll:       $('btn-targets-all'),
  btnTargetsNone:      $('btn-targets-none'),
  btnTargetsClose:     $('btn-targets-close'),
  chkRepresentErrors:  $('chk-represent-errors'),
  chkErrorless:        $('chk-errorless'),
  chkNoErrorAnim:      $('chk-no-error-anim'),
  btnExtraToggle:      $('btn-extra-toggle'),
  extraPanel:          $('extra-panel'),
  btnExtraClose:       $('btn-extra-close'),
};

// ── Boot ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  bindEvents();
  await loadItems();
  restoreResults();
  initSession();
});

// ── Settings (localStorage) ────────────────────────────────────────

function loadSettings() {
  const s = JSON.parse(localStorage.getItem('ffcgSettings') || '{}');
  // Migrate legacy tag value.
  const legacyTag = s.tag === '__auto__' ? '' : s.tag;
  state.mode              = s.mode              ?? 'feature';
  state.tag               = legacyTag          ?? '';
  state.arraySize         = s.arraySize         ?? 4;
  state.representErrors   = s.representErrors   ?? true;
  state.errorless         = s.errorless         ?? false;
  state.noErrorAnim       = s.noErrorAnim       ?? false;
  state.promptPersists    = s.promptPersists    ?? false;
  state.promptStyle       = s.promptStyle       ?? 'sparkle';
  state.autoPromptEnabled = s.autoPromptEnabled ?? false;
  state.promptDelay       = s.promptDelay       ?? false;
  state.promptDelaySecs   = s.promptDelaySecs   ?? 3;
  state.targetFilters     = Object.assign(
    { feature:[], function:[], classWithinGroup:[], classCrossCategory:[] },
    s.targetFilters || {}
  );

  el.selMode.value              = state.mode;
  el.inpSize.value              = state.arraySize;
  el.chkRepresentErrors.checked = state.representErrors;
  el.chkErrorless.checked       = state.errorless;
  el.chkNoErrorAnim.checked     = state.noErrorAnim;
  el.chkPersists.checked        = state.promptPersists;
  el.selPromptStyle.value   = state.promptStyle;
  el.chkAutoPrompt.checked  = state.autoPromptEnabled;
  el.chkPromptDelay.checked = state.promptDelay;
  el.selPromptDelay.value   = state.promptDelaySecs;

  el.chkPromptDelay.disabled = !state.autoPromptEnabled;
  el.selPromptDelay.disabled = !state.autoPromptEnabled || !state.promptDelay;
}

function saveSettings() {
  localStorage.setItem('ffcgSettings', JSON.stringify({
    mode:              state.mode,
    tag:               state.tag,
    arraySize:         state.arraySize,
    representErrors:   state.representErrors,
    errorless:         state.errorless,
    noErrorAnim:       state.noErrorAnim,
    promptPersists:    state.promptPersists,
    promptStyle:       state.promptStyle,
    autoPromptEnabled: state.autoPromptEnabled,
    promptDelay:       state.promptDelay,
    promptDelaySecs:   state.promptDelaySecs,
    targetFilters:     state.targetFilters,
  }));
}

// ── Durable results persistence (device-local; never transmitted) ──
// Trial data is kept across reloads so a closed tab doesn't lose a session.
// Pseudonymous only — no PHI, never touches admin_token. "Clear data" wipes it.

const RESULTS_KEY = 'nooutco.results.ffc';

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

// ── Data loading ───────────────────────────────────────────────────

async function loadItems() {
  try {
    const r = await fetch('./items.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    state.items          = data.items          || [];
    state.vocab          = data.vocab          || { groups:[], features:[], functions:[], classes:[] };
    state.prompts        = data.prompts        || {};
    state.promptDefaults = data.promptDefaults || {};
  } catch (e) {
    console.error('Could not load items.json:', e);
    state.items = [];
  }
  pruneStaleTargetFilters();
  populateTagDropdown();
  updateTargetsCount();
}

/**
 * Remove ids from saved filters that no longer exist in items.json.
 * Prevents a stale filter from silently hiding tags forever.
 */
function pruneStaleTargetFilters() {
  const known = new Set(state.items.map(it => it.id));
  for (const mode of Object.keys(state.targetFilters)) {
    const before = state.targetFilters[mode] || [];
    state.targetFilters[mode] = before.filter(id => known.has(id));
  }
}

// ── Tag dropdown ───────────────────────────────────────────────────

/**
 * Items eligible as targets under the current mode's target filter.
 * An empty filter array means "no filter — use the whole pool".
 */
function eligibleTargetItems(mode = state.mode) {
  const filter = state.targetFilters[mode] || [];
  if (!filter.length) return state.items;
  const set = new Set(filter);
  return state.items.filter(it => set.has(it.id));
}

/**
 * Count items in the active target pool that carry the given tag.
 */
function tagTargetCount(tag, mode = state.mode) {
  const bucket = MODE_CONFIG[mode].bucket;
  return eligibleTargetItems(mode).filter(it =>
    Array.isArray(it[bucket]) && it[bucket].includes(tag)
  ).length;
}

function populateTagDropdown() {
  const bucket = MODE_CONFIG[state.mode].bucket;
  const allTags = [...(state.vocab[bucket] || [])]
    .sort((a, b) => tagLabel(a).localeCompare(tagLabel(b)));

  // Only offer tags with enough eligible targets to fill an array.
  const minTargets = 1; // need at least one target; distractors may be relaxed.
  const tags = allTags.filter(t => tagTargetCount(t) >= minTargets);

  el.selTag.innerHTML = '';
  if (!tags.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '(no tags available)';
    el.selTag.appendChild(o);
    el.selTag.value = '';
    state.tag = '';
    return;
  }

  tags.forEach(t => {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = tagLabel(t);
    el.selTag.appendChild(o);
  });

  if (state.tag && tags.includes(state.tag)) {
    el.selTag.value = state.tag;
  } else {
    state.tag = tags[0];
    el.selTag.value = state.tag;
  }
}

function tagLabel(tag) {
  return tag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function modeLabel(mode) {
  return mode.replace(/([A-Z])/g, ' $1').trim();
}

// ── Event bindings ─────────────────────────────────────────────────

function bindEvents() {
  el.btnTimerToggle.addEventListener('click', toggleTimer);
  el.btnTimerReset.addEventListener('click',  resetTimer);

  el.selMode.addEventListener('change', () => {
    state.mode = el.selMode.value;
    // Restore that mode's saved tag (if any) on switch; populateTagDropdown
    // picks the first available tag if the saved tag is no longer offered.
    state.tag  = '';
    state.targetDecks = {};
    saveSettings();
    populateTagDropdown();
    renderTargetPanel();
    updateTargetsCount();
  });

  el.selTag.addEventListener('change', () => {
    state.tag = el.selTag.value;
    state.targetDecks = {};
    saveSettings();
  });

  el.inpSize.addEventListener('change', () => {
    const v = Math.min(10, Math.max(2, parseInt(el.inpSize.value) || 4));
    state.arraySize = v;
    el.inpSize.value = v;
    state.posDeck = [];
    saveSettings();
    populateTagDropdown();
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

  el.btnStart.addEventListener('click',  () => { state.sessionActive = false; startGame(); });
  el.btnPrompt.addEventListener('click', onPromptButton);
  el.btnPrint.addEventListener('click',  printData);

  el.btnClearData.addEventListener('click', () => {
    if (!state.sessionData.length) { alert('No data to clear.'); return; }
    if (!confirm('Clear all trial data? This cannot be undone.')) return;
    state.sessionData = [];
    state.trialNum    = 0;
    el.resultsBody.innerHTML = '';
    if (window.NooutcoResults) NooutcoResults.clear(RESULTS_KEY);
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

// ── Target deck — cycle through target items without repeats ──────

function targetDeckKey(mode, tag) {
  return `${mode}|${tag}`;
}

function nextTarget(mode, tag, pool) {
  if (!pool.length) return null;
  const key = targetDeckKey(mode, tag);
  let deck = state.targetDecks[key];
  if (!deck || !deck.length) {
    deck = shuffle([...pool]);
    state.targetDecks[key] = deck;
  }
  return deck.pop();
}

// ── Trial builder ──────────────────────────────────────────────────

/**
 * Builds a trial for a given mode and tag.
 * Returns { targetItem, promptSentence, tileItems, correctIdx } or null if
 * the item pool is too small to build a valid trial.
 *
 * If forcedTarget is provided, that item is used as the target instead of
 * drawing a new one from the target deck (used for error-correction trials
 * so the learner sees the same item they just missed).
 */
function buildTrialData(mode, tag, n, forcedTarget = null) {
  const items = state.items;
  const { bucket, distractors: distStyle } = MODE_CONFIG[mode];
  const promptSentence = resolvePrompt(mode, tag);

  let target;
  if (forcedTarget) {
    target = forcedTarget;
  } else {
    // Apply the mode's target filter to the candidate target pool.
    const filter = state.targetFilters[mode] || [];
    const filterSet = filter.length ? new Set(filter) : null;

    const targetPool = items.filter(it =>
      it[bucket] && it[bucket].includes(tag) &&
      (!filterSet || filterSet.has(it.id))
    );
    if (!targetPool.length) return null;
    target = nextTarget(mode, tag, targetPool);
  }

  let distractorPool;

  if (distStyle === 'crossCategory') {
    const targetGroups = new Set(target.groups || []);
    distractorPool = items.filter(it =>
      it.id !== target.id &&
      !(it[bucket] && it[bucket].includes(tag)) &&
      !(it.groups || []).some(g => targetGroups.has(g))
    );
    if (distractorPool.length < n - 1) {
      console.warn(`[FFC] cross-category pool too small for tag="${tag}"; relaxing group constraint`);
      distractorPool = taglessPool(items, target, bucket, tag);
    }
  } else {
    const sharedGroup = pickRandom(target.groups && target.groups.length ? target.groups : ['']);
    distractorPool = items.filter(it =>
      it.id !== target.id &&
      !(it[bucket] && it[bucket].includes(tag)) &&
      (it.groups || []).includes(sharedGroup)
    );
    if (distractorPool.length < n - 1) {
      console.warn(`[FFC] within-group pool too small for tag="${tag}", group="${sharedGroup}"; relaxing`);
      distractorPool = taglessPool(items, target, bucket, tag);
    }
  }

  if (!distractorPool.length) return null;

  const distractors = sample(distractorPool, n - 1);
  while (distractors.length < n - 1) {
    distractors.push(pickRandom(distractorPool));
  }

  const correctPos = nextPosition();
  const tileItems  = new Array(n);
  let di = 0;
  for (let i = 0; i < n; i++) {
    tileItems[i] = (i === correctPos) ? target : distractors[di++];
  }

  return { targetItem: target, promptSentence, tileItems, correctIdx: correctPos };
}

function taglessPool(items, target, bucket, tag) {
  return items.filter(it => it.id !== target.id && !(it[bucket] && it[bucket].includes(tag)));
}

function resolvePrompt(mode, tag) {
  const { promptKey, bucket } = MODE_CONFIG[mode];
  const modePrompts = state.prompts[promptKey] || {};
  if (modePrompts[tag]) return modePrompts[tag];
  const template = state.promptDefaults[bucket] || `Which is ${tag.replace(/_/g, ' ')}?`;
  return template.replace('{tag}', tag.replace(/_/g, ' '));
}

// ── Game flow ──────────────────────────────────────────────────────

function startGame() {
  if (!state.items.length) {
    alert('No items loaded. Check that items.json is present and reload.');
    return;
  }

  state.active      = true;
  state.posDeck     = [];
  state.targetDecks = {};

  el.gameArea.removeAttribute('hidden');
  el.btnPrompt.removeAttribute('hidden');
  removeTrialButtons();

  resetTimer();
  startTimer();
  beginTrial();
}

function beginTrial(keepTarget = false, isRetry = false) {
  state.trialNum++;
  state.trialErrors   = 0;
  state.prompted      = false;
  state.autoPrompted  = false;
  state.isRepeatTrial = keepTarget && !isRetry;
  state.trialStart    = Date.now();

  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;

  // Cancel any pending reveal from the trial we're leaving so its deferred
  // Next/Retry overlay can't appear over this fresh trial.
  clearTimeout(state.revealHandle); state.revealHandle = null;
  clearTimeout(state.btnHandle);    state.btnHandle    = null;

  clearPrompt();

  if (!keepTarget && !isRetry && state.sessionActive) {
    // Session mode: a mixed-type trial drawn from the active-target map.
    const picked = buildSessionTrial();
    if (!picked) {
      alert('No active targets to run. Open Session setup and select some traits.');
      state.active = false;
      return;
    }
    state.mode           = picked.mode;     // drives distractor bucket + record
    state.currentType    = picked.type;
    state.targetItem     = picked.trial.targetItem;
    state.targetTag      = picked.tag;
    state.promptSentence = picked.trial.promptSentence;
    state.tileItems      = picked.trial.tileItems;
    state.correctIdx     = picked.trial.correctIdx;
  } else if (!keepTarget && !isRetry) {
    const tag = state.tag;
    if (!tag) { alert('No tag selected. Pick a tag or adjust your target filter.'); return; }
    const trial = buildTrialData(state.mode, tag, state.arraySize);
    if (!trial) {
      alert(`Not enough items to build a trial for tag "${tagLabel(tag)}". Add more items or widen the target filter.`);
      return;
    }
    state.targetItem     = trial.targetItem;
    state.targetTag      = tag;
    state.promptSentence = trial.promptSentence;
    state.tileItems      = trial.tileItems;
    state.correctIdx     = trial.correctIdx;
    state.currentType    = null;
  } else {
    // Error correction or retry: keep the same target item, rebuild distractors/positions.
    const trial = buildTrialData(state.mode, state.targetTag, state.arraySize, state.targetItem);
    if (trial) {
      state.tileItems  = trial.tileItems;
      state.correctIdx = trial.correctIdx;
    }
  }

  renderTrial();

  if (keepTarget && !isRetry) {
    // Error correction: always auto-prompt immediately.
    state.autoPrompted = true;
    setTimeout(applyPrompt, 80);
  } else if (!keepTarget && !isRetry && state.sessionActive) {
    // Session mode: prompting is driven by the chosen ABA method.
    const method = state.session.prompting;
    if (method === 'most-to-least') {           // errorless: model up-front
      state.autoPrompted = true;
      setTimeout(applyPrompt, 80);
    } else if (method === 'time-delay') {        // wait, then prompt
      state.autoPromptHandle = setTimeout(() => {
        state.autoPrompted = true;
        state.autoPromptHandle = null;
        applyPrompt();
      }, TIME_DELAY_SECS * 1000);
    }
    // least-to-most: no pre-prompt; the hint appears on a miss (onWrongClick).
  } else if (!keepTarget && !isRetry && state.autoPromptEnabled) {
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

function renderTrial() {
  el.sampleWord.textContent = state.promptSentence;
  fitSampleWord();

  const cols = gridCols(state.arraySize);
  el.compGrid.style.setProperty('--grid-cols', cols);
  el.compGrid.style.gridTemplateColumns = '';
  el.compGrid.innerHTML = '';

  state.tileItems.forEach((item, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'tile-wrapper';
    wrapper.dataset.index = idx;

    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.index = idx;

    const front = document.createElement('div');
    front.className = 'tile-face tile-front';
    const img = document.createElement('img');
    img.src = `_Resources/_imgSource/items/${item.img}`;
    img.alt = item.label;
    const labelSpan = document.createElement('span');
    labelSpan.className = 'tile-label';
    labelSpan.textContent = item.label;
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
  const cs = getComputedStyle(card);
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
    if (state.errorless) return;
    onWrongClick(wrapper);
  }
}

function onCorrectClick(wrapper, tile) {
  disableAllTiles();
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
    mode:      state.mode,
    tag:       state.targetTag,
    target:    state.targetItem.label,
    arraySize: state.arraySize,
    errors:    state.trialErrors,
    prompted:  state.prompted || state.autoPrompted,
    promptDelaySecs: (!state.isRepeatTrial && state.autoPromptEnabled && state.promptDelay)
      ? state.promptDelaySecs : null,
    promptType: !(state.prompted || state.autoPrompted) ? 'none'
      : (state.sessionActive ? (PROMPT_TYPE_BY_METHOD[state.session.prompting] || 'model')
        : (state.promptDelaySecs != null ? 'delay' : 'model')),
    type: state.currentType || null,
    time: elapsed,
    outcome,
    settingsKey: [
      state.mode, state.targetTag, state.arraySize,
      state.representErrors   ? 1 : 0,
      state.errorless         ? 1 : 0,
      state.noErrorAnim       ? 1 : 0,
      state.autoPromptEnabled ? 1 : 0,
      state.promptPersists    ? 1 : 0,
      state.promptStyle,
      state.promptDelay ? state.promptDelaySecs : 0,
    ].join('|'),
  });
  persistResults();

  if (window.__nooutcoTokens) window.__nooutcoTokens.award();

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
  state.revealHandle = setTimeout(() => {
    state.revealHandle = null;
    wrapper.classList.remove('expanding');
    tile.classList.add('flipped');
    state.btnHandle = setTimeout(() => {
      state.btnHandle = null;
      showTrialButtons();
    }, 580);
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
    persistResults();
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

  // Preferred path: branded clinical "FFC session · data sheet" in a new tab
  // (Frame 08) — a transcription aid, device-local, never transmitted.
  if (window.NooutcoResults) {
    NooutcoResults.open({ html: buildFfcDataSheet() });
    return;
  }

  // Fallback: legacy hidden print-section + the native print dialog.
  legacyPrintData();
}

// ── Frame 08 · clinical data sheet ─────────────────────────────────
// Builds the print-to-PDF trial sheet a technician scans to transcribe into
// the system of record. Clinical 3-code scoring (+/P/−); error-correction
// repeats are NOT separate rows — only the original error is recorded.

const SHEET_TYPE = {
  features:  { label: 'Feature',  dot: '#3b82f6' },  // blue
  functions: { label: 'Function', dot: '#7c3aed' },  // violet
  classes:   { label: 'Class',    dot: '#b45309' },  // amber
};

const SHEET_SCORE = {
  Correct:  { glyph: '+', cls: 'plus'  },
  Prompted: { glyph: 'P', cls: 'p'     },
  Error:    { glyph: '−', cls: 'minus' },
};

const SHEET_PROMPT_LABEL = { none: '—', model: 'Model', gesture: 'Gesture', delay: 'Delay' };

function sheetEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

function buildFfcDataSheet() {
  // Error correction (repeat trials) is performed but never a separate row.
  const primary = state.sessionData.filter(
    d => d.outcome !== 'Correction' && d.outcome !== 'Repeat Error');

  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' });
  const timeStr = now.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });

  const rows = primary.map((d, i) => {
    const type  = SHEET_TYPE[MODE_CONFIG[d.mode]?.bucket] || { label: modeLabel(d.mode), dot: '#9aa589' };
    const score = SHEET_SCORE[d.outcome] || SHEET_SCORE.Error;
    // Prompt type comes from the session prompting taxonomy (Frame 07); fall
    // back to legacy delay/generic for pre-session trial records.
    const prompt = d.promptType
      ? (SHEET_PROMPT_LABEL[d.promptType] || '—')
      : (d.prompted ? (d.promptDelaySecs != null ? 'Delay' : 'Prompted') : '—');
    return (
      `<tr>` +
        `<td class="c-n">${i + 1}</td>` +
        `<td class="c-target"><strong>${sheetEsc(d.target)}</strong> · ${sheetEsc(tagLabel(d.tag))}</td>` +
        `<td><span class="type"><span class="type-dot" style="background:${type.dot}"></span>${sheetEsc(type.label)}</span></td>` +
        `<td class="c-prompt">${sheetEsc(prompt)}</td>` +
        `<td class="c-score"><span class="badge badge-${score.cls}">${score.glyph}</span></td>` +
      `</tr>`
    );
  }).join('');

  const total       = primary.length;
  const independent = primary.filter(d => d.outcome === 'Correct').length;
  const prompted    = primary.filter(d => d.outcome === 'Prompted').length;
  const errors      = primary.filter(d => d.outcome === 'Error').length;
  const pct         = total ? Math.round((independent / total) * 100) : 0;

  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0">` +
    `<title>FFC session · data sheet</title>` +
    `<style>${SHEET_CSS}</style></head><body>` +
    `<div class="toolbar"><button type="button" onclick="window.print()">🖨 Print / Save as PDF</button></div>` +
    `<main class="paper">` +
      `<header class="title">` +
        `<img src="/logo-mark.svg" alt="" width="32" height="32">` +
        `<div class="title-main"><div class="title-h">FFC session · data sheet</div>` +
        `<div class="title-sub">Receptive identification by feature, function &amp; class</div></div>` +
        `<div class="title-right"><div><strong>${sheetEsc(dateStr)}</strong> · ${sheetEsc(timeStr)}</div>` +
        `<div>Array of ${sheetEsc(state.arraySize)}</div></div>` +
      `</header>` +
      `<div class="meta">` +
        `<div><div class="meta-k">Learner</div><div class="meta-v meta-sign">&nbsp;</div></div>` +
        `<div><div class="meta-k">Technician</div><div class="meta-v meta-sign">&nbsp;</div></div>` +
        `<div><div class="meta-k">Program</div><div class="meta-v">FFC · Receptive ID</div></div>` +
        `<div><div class="meta-k">Trials</div><div class="meta-v">${total}</div></div>` +
      `</div>` +
      `<table class="sheet"><thead><tr>` +
        `<th class="c-n">#</th><th>Target</th><th class="th-type">Type</th>` +
        `<th class="th-prompt">Prompt</th><th class="th-score">Score</th>` +
      `</tr></thead><tbody>${rows}</tbody></table>` +
      `<div class="summary">` +
        `<div class="sum"><div class="meta-k">Independent</div><div class="sum-v sum-plus">${independent} / ${total} <span>· ${pct}%</span></div></div>` +
        `<div class="sum"><div class="meta-k">Prompted</div><div class="sum-v sum-p">${prompted}</div></div>` +
        `<div class="sum"><div class="meta-k">Errors</div><div class="sum-v sum-minus">${errors}</div></div>` +
        `<div class="legend"><strong>+</strong> independent &nbsp; <strong>P</strong> prompted &nbsp; <strong>−</strong> error</div>` +
      `</div>` +
      `<div class="note"><span>ℹ️</span><div>Error correction is performed in session but is <strong>not logged as a separate trial</strong> — only the error is recorded. Defer to the program's specifications where they differ.</div></div>` +
      `<div class="genby">Generated by SAssi · No Outcome ABA · for transcription into the client record</div>` +
    `</main></body></html>`
  );
}

const SHEET_CSS = [
  '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
  'body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#e7ebe0;color:#374151;line-height:1.5;padding:24px}',
  '.toolbar{max-width:760px;margin:0 auto 14px;display:flex;justify-content:flex-end}',
  '.toolbar button{background:#4d5840;color:#fff;border:none;border-radius:8px;padding:9px 16px;font:inherit;font-weight:700;font-size:13px;cursor:pointer}',
  '.toolbar button:hover{background:#3f4a35}',
  '.paper{max-width:760px;margin:0 auto;background:#fff;border-radius:8px;padding:30px 34px;box-shadow:0 1px 3px rgba(0,0,0,.08)}',
  '.title{display:flex;align-items:flex-start;gap:12px;padding-bottom:16px;border-bottom:2px solid #1a1f14}',
  '.title-main{flex:1}',
  '.title-h{font-size:18px;font-weight:700;color:#1a1f14}',
  '.title-sub{font-size:12px;color:#6b7280}',
  '.title-right{text-align:right;font-size:12px;color:#374151;line-height:1.55}',
  '.title-right strong{color:#1a1f14}',
  '.meta{display:flex;gap:30px;flex-wrap:wrap;padding:14px 0 16px}',
  '.meta-k{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#9aa589}',
  '.meta-v{font-size:13.5px;font-weight:700;color:#1a1f14;margin-top:2px}',
  '.meta-sign{font-weight:400;color:#9aa589;border-bottom:1px solid #d4d9c8;min-width:140px}',
  '.sheet{width:100%;border-collapse:collapse;font-size:13px}',
  '.sheet th{text-align:left;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#7a8568;padding:8px 10px;border-bottom:1px solid #d4d9c8;background:#f4f6ef}',
  '.sheet td{padding:8px 10px;border-bottom:1px solid #eef0e9;color:#1a1f14}',
  '.c-n{width:38px;color:#9aa589;font-weight:700}',
  '.th-type{width:96px}.th-prompt{width:104px}.th-score{width:118px;text-align:center}',
  '.c-prompt{color:#6b7280}',
  '.c-score{text-align:center}',
  '.type{display:inline-flex;align-items:center;gap:6px;color:#374151}',
  '.type-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}',
  '.badge{font-weight:700;font-size:13px;border-radius:6px;padding:3px 12px;display:inline-block;min-width:30px}',
  '.badge-plus{color:#15803d;background:#dcfce7}',
  '.badge-p{color:#92722a;background:#fef3c7}',
  '.badge-minus{color:#b91c1c;background:#fee2e2}',
  '.summary{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px;padding:14px 16px;background:#f4f6ef;border:1px solid #e7ebe0;border-radius:10px}',
  '.sum{flex:1;min-width:120px}',
  '.sum-v{font-size:18px;font-weight:700;margin-top:2px}',
  '.sum-v span{font-size:12px;color:#6b7280}',
  '.sum-plus{color:#15803d}.sum-p{color:#92722a}.sum-minus{color:#b91c1c}',
  '.legend{flex:2;min-width:180px;align-self:center;font-size:11.5px;color:#6b7280}',
  '.legend strong{color:#374151}',
  '.note{display:flex;gap:9px;margin-top:14px;padding:11px 14px;background:#fffdf6;border:1px solid #f3e3b8;border-radius:10px}',
  '.note span{font-size:14px;flex-shrink:0}',
  '.note div{font-size:11.5px;color:#8a6c2e;line-height:1.55}',
  '.genby{margin-top:16px;font-size:10.5px;color:#aab199;text-align:right}',
  '@media print{body{background:#fff;padding:0}.toolbar{display:none}.paper{box-shadow:none;border-radius:0;max-width:none;padding:0}tr{break-inside:avoid}}'
].join('');

function legacyPrintData() {
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
      `<td${b}>${modeLabel(d.mode)}</td>` +
      `<td${b}>${tagLabel(d.tag)}</td>` +
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

/**
 * Items that carry any tag in the current mode's bucket.
 * Every item listed in the target panel comes from this pool.
 */
function itemsForMode(mode = state.mode) {
  const bucket = MODE_CONFIG[mode].bucket;
  return state.items.filter(it =>
    Array.isArray(it[bucket]) && it[bucket].length
  );
}

function renderTargetPanel() {
  el.targetPanelModeLbl.textContent = modeLabel(state.mode);
  const body = el.targetPanelBody;
  body.innerHTML = '';

  const bucket = MODE_CONFIG[state.mode].bucket;
  const relevant = itemsForMode();
  const tags = [...(state.vocab[bucket] || [])]
    .sort((a, b) => tagLabel(a).localeCompare(tagLabel(b)))
    .filter(tag => relevant.some(it => it[bucket].includes(tag)));

  if (!tags.length) {
    body.innerHTML = '<p class="target-panel-empty">No items yet for this mode.</p>';
    return;
  }

  const filter = new Set(state.targetFilters[state.mode] || []);

  tags.forEach(tag => {
    const group = document.createElement('div');
    group.className = 'target-group';

    const head = document.createElement('div');
    head.className = 'target-group-head';
    const title = document.createElement('span');
    title.className = 'target-group-title';
    title.textContent = tagLabel(tag);
    const grpAll  = document.createElement('button');
    grpAll.type  = 'button';
    grpAll.textContent = 'all';
    const grpNone = document.createElement('button');
    grpNone.type = 'button';
    grpNone.textContent = 'none';

    const tagItems = relevant.filter(it => it[bucket].includes(tag));

    grpAll.addEventListener('click',  () => setGroupTargets(tagItems, true));
    grpNone.addEventListener('click', () => setGroupTargets(tagItems, false));
    head.appendChild(title);
    head.appendChild(grpAll);
    head.appendChild(grpNone);
    group.appendChild(head);

    const list = document.createElement('div');
    list.className = 'target-group-list';
    tagItems.forEach(it => {
      const row = document.createElement('label');
      row.className = 'target-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.itemId = it.id;
      // Empty filter = every item considered enabled (whole pool). When the
      // user ticks anything, the filter becomes explicit.
      cb.checked = !filter.size || filter.has(it.id);
      cb.addEventListener('change', () => onTargetCheckboxChange(cb));

      const thumb = document.createElement('img');
      thumb.className = 'target-thumb';
      thumb.src = `_Resources/_imgSource/items/${it.img}`;
      thumb.alt = '';
      const thumbLbl = document.createElement('span');
      thumbLbl.className = 'target-thumb-label';
      thumbLbl.textContent = it.label;
      thumb.addEventListener('error', () => {
        thumb.remove();
        thumbLbl.classList.add('target-thumb-label-visible');
      });

      const label = document.createElement('span');
      label.className = 'target-row-label';
      label.textContent = it.label;

      row.appendChild(cb);
      row.appendChild(thumb);
      row.appendChild(thumbLbl);
      row.appendChild(label);
      list.appendChild(row);
    });
    group.appendChild(list);
    body.appendChild(group);
  });
}

function targetCheckboxes() {
  return el.targetPanelBody.querySelectorAll('input[type="checkbox"][data-item-id]');
}

function onTargetCheckboxChange(changedCb) {
  // An item may appear in multiple tag-groups, creating duplicate checkboxes.
  // Sync all duplicates for the changed item BEFORE reading the overall state,
  // otherwise an unchecked duplicate in another group keeps the item selected.
  if (changedCb) {
    const id    = changedCb.dataset.itemId;
    const state_ = changedCb.checked;
    targetCheckboxes().forEach(cb => {
      if (cb.dataset.itemId === id) cb.checked = state_;
    });
  }

  const relevant = itemsForMode();
  const checkedIds = new Set();
  targetCheckboxes().forEach(cb => {
    if (cb.checked) checkedIds.add(cb.dataset.itemId);
  });

  // If every relevant item is checked, treat as "no filter" (empty array).
  const allChecked = relevant.every(it => checkedIds.has(it.id));
  state.targetFilters[state.mode] = allChecked ? [] : [...checkedIds];

  state.targetDecks = {};
  saveSettings();
  updateTargetsCount();
  populateTagDropdown();
  syncDuplicateCheckboxes(checkedIds);
}

function syncDuplicateCheckboxes(checkedIds) {
  targetCheckboxes().forEach(cb => {
    cb.checked = checkedIds.has(cb.dataset.itemId);
  });
}

function setGroupTargets(items, checked) {
  const ids = new Set(items.map(it => it.id));
  targetCheckboxes().forEach(cb => {
    if (ids.has(cb.dataset.itemId)) cb.checked = checked;
  });
  onTargetCheckboxChange();
}

function setAllTargets(checked) {
  targetCheckboxes().forEach(cb => { cb.checked = checked; });
  onTargetCheckboxChange();
}

function updateTargetsCount() {
  const relevant = itemsForMode();
  const filter = state.targetFilters[state.mode] || [];
  const selected = filter.length ? filter.length : relevant.length;
  el.targetsCount.textContent = `${selected} of ${relevant.length}`;
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

// ════════════════════════════════════════════════════════════════════
// Session setup (Frame 07) — gated per-learner session targets.
// A curated stimulus pool + per-item active feature/function/class traits
// drives a mixed-type trial generator. Config persists per game to
// localStorage `nooutco.settings.ffc` (pseudonymous set names only — no PHI).
// ════════════════════════════════════════════════════════════════════

const SESSION_KEY = 'nooutco.settings.ffc';

// type (UI) → engine bucket + mode used by buildTrialData()
const TYPE_MAP = {
  feature:  { bucket: 'features',  mode: 'feature' },
  function: { bucket: 'functions', mode: 'function' },
  class:    { bucket: 'classes',   mode: 'classWithinGroup' },
};
const TYPE_ORDER = ['feature', 'function', 'class'];

// session.prompting → recorded prompt type (Frame 08 sheet) when a prompt fires
const PROMPT_TYPE_BY_METHOD = {
  'most-to-least': 'model',
  'least-to-most': 'gesture',
  'time-delay':    'delay',
};
const TIME_DELAY_SECS = 3;

const sEl = {};
function cacheSessionEls() {
  [
    'btn-session-toggle','session-panel','session-gate-pill','btn-session-close',
    'sel-session-set','session-pool-list','session-pool-count','inp-session-search',
    'btn-session-add','session-targets','session-array-val','session-types',
    'sel-session-prompting','session-prompting-sub','btn-session-start',
    'session-start-count','btn-session-save','btn-session-reset',
  ].forEach(id => { sEl[id] = document.getElementById(id); });
}

function itemById(id) { return state.items.find(it => it.id === id) || null; }

// Local escapers (sheetEsc handles & < > "); set names are user-entered.
function escHtml(s) { return sheetEsc(s); }
function escAttr(s) { return sheetEsc(s); }

function blankTargets(it) {
  // New items default to ALL their traits active; the tech then trims.
  return {
    feature:  [...(it.features  || [])],
    function: [...(it.functions || [])],
    class:    [...(it.classes   || [])],
  };
}

function activeCount(id, type) {
  const t = state.session.targets[id];
  return (t && t[type]) ? t[type].length : 0;
}

function eligiblePairCount() {
  // (item,type) pairs runnable: in pool, type included, ≥1 active trait.
  let n = 0;
  state.session.items.forEach(id => {
    state.session.includeTypes.forEach(type => {
      if (activeCount(id, type) > 0) n++;
    });
  });
  return n;
}
function sessionRunnable() { return eligiblePairCount() > 0; }

// ── Persistence ────────────────────────────────────────────────────
function loadSessionStore() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}'); }
  catch (e) { return {}; }
}
function saveSessionStore(store) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(store)); }
  catch (e) { /* storage full / unavailable — non-fatal */ }
}

function defaultSession() {
  return {
    items: [], targets: {},
    includeTypes: ['feature', 'function', 'class'],
    arraySize: state.arraySize || 4,
    prompting: 'most-to-least',
  };
}

function initSession() {
  cacheSessionEls();
  const store = loadSessionStore();
  // Restore the last-used set if present; else start from a blank session.
  const last = store.last && store.sets && store.sets[store.last];
  state.session = last ? normalizeSet(last) : defaultSession();
  state.sessionActive  = false;
  state.sessionEditing = false;
  state.sessionAddMode = false;
  state.sessionSel = state.session.items[0] || null;
  bindSessionEvents();
  renderSetPicker(store);
  renderSessionPanel();
}

function normalizeSet(set) {
  const out = defaultSession();
  out.items = Array.isArray(set.items) ? set.items.filter(id => itemById(id)) : [];
  out.includeTypes = Array.isArray(set.includeTypes) && set.includeTypes.length
    ? set.includeTypes.filter(t => TYPE_MAP[t]) : ['feature','function','class'];
  out.arraySize = clampArray(set.arraySize || 4);
  out.prompting = PROMPT_TYPE_BY_METHOD[set.prompting] ? set.prompting : 'most-to-least';
  out.targets = {};
  out.items.forEach(id => {
    const it = itemById(id);
    const src = (set.targets && set.targets[id]) || {};
    out.targets[id] = {
      feature:  intersectTraits(src.feature,  it.features),
      function: intersectTraits(src.function, it.functions),
      class:    intersectTraits(src.class,    it.classes),
    };
  });
  return out;
}
function intersectTraits(saved, available) {
  const avail = new Set(available || []);
  return Array.isArray(saved) ? saved.filter(t => avail.has(t)) : [...avail];
}
function clampArray(n) { return Math.max(1, Math.min(10, parseInt(n, 10) || 4)); }

// ── Rendering ──────────────────────────────────────────────────────
function renderSetPicker(store) {
  store = store || loadSessionStore();
  const sel = sEl['sel-session-set'];
  if (!sel) return;
  const names = Object.keys(store.sets || {});
  sel.innerHTML = '<option value="">📁 Unsaved session</option>' +
    names.map(n => `<option value="${escAttr(n)}">📁 ${escHtml(n)}</option>`).join('');
  sel.value = (store.last && (store.sets || {})[store.last]) ? store.last : '';
}

function renderSessionPanel() {
  renderSessionPool();
  renderSessionTargets();
  renderSessionBand();
  updateSessionStartCount();
}

function renderSessionPool() {
  const list = sEl['session-pool-list'];
  if (!list) return;
  const search = (sEl['inp-session-search'].value || '').trim().toLowerCase();
  list.innerHTML = '';

  const inPlay = new Set(state.session.items);
  const source = state.sessionAddMode ? state.items : state.session.items.map(itemById).filter(Boolean);
  const rows = source.filter(it => it && (!search || it.label.toLowerCase().includes(search)));

  sEl['session-pool-count'].textContent = String(state.session.items.length);
  sEl['btn-session-add'].textContent = state.sessionAddMode ? '✓ Done adding' : '＋ Add items';

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'session-pool-row is-out';
    empty.style.cursor = 'default';
    empty.textContent = state.sessionAddMode ? 'No stimuli match.' : 'No items yet — tap “＋ Add items”.';
    list.appendChild(empty);
    return;
  }

  rows.forEach(it => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'session-pool-row';
    if (!state.sessionAddMode && it.id === state.sessionSel) row.classList.add('is-selected');
    if (state.sessionAddMode && !inPlay.has(it.id)) row.classList.add('is-out');

    const emoji = document.createElement('img');
    emoji.className = 'pool-emoji';
    emoji.src = `_Resources/_imgSource/items/${it.img}`;
    emoji.alt = '';
    emoji.addEventListener('error', () => {
      const span = document.createElement('span');
      span.className = 'pool-emoji';
      span.textContent = '🔹';
      emoji.replaceWith(span);
    });

    const meta = document.createElement('div');
    meta.className = 'pool-meta';
    const name = document.createElement('div');
    name.className = 'pool-name';
    name.textContent = it.label;
    const sub = document.createElement('div');
    sub.className = 'pool-sub';
    if (state.sessionAddMode) {
      sub.textContent = inPlay.has(it.id) ? 'In play — tap to remove' : 'Tap to add';
    } else {
      sub.textContent = `${activeCount(it.id,'feature')} feature · ${activeCount(it.id,'function')} function · ${activeCount(it.id,'class')} class`;
    }
    meta.appendChild(name); meta.appendChild(sub);

    row.appendChild(emoji); row.appendChild(meta);
    row.addEventListener('click', () => {
      if (state.sessionAddMode) togglePoolItem(it.id);
      else { state.sessionSel = it.id; renderSessionPool(); renderSessionTargets(); }
    });
    list.appendChild(row);
  });
}

function togglePoolItem(id) {
  const idx = state.session.items.indexOf(id);
  if (idx >= 0) {
    state.session.items.splice(idx, 1);
    delete state.session.targets[id];
    if (state.sessionSel === id) state.sessionSel = state.session.items[0] || null;
  } else {
    state.session.items.push(id);
    state.session.targets[id] = blankTargets(itemById(id));
    state.sessionSel = id;
  }
  renderSessionPool();
  renderSessionTargets();
  updateSessionStartCount();
}

function renderSessionTargets() {
  const host = sEl['session-targets'];
  if (!host) return;
  const id = state.sessionSel;
  const it = id ? itemById(id) : null;
  if (!it || !state.session.targets[id]) {
    host.innerHTML = '<p class="session-empty">Select an item to set its active targets.</p>';
    return;
  }

  host.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'session-sel-head';
  const emojiBox = document.createElement('div');
  emojiBox.className = 'session-sel-emoji';
  const emoji = document.createElement('img');
  emoji.src = `_Resources/_imgSource/items/${it.img}`;
  emoji.alt = '';
  emoji.addEventListener('error', () => { emojiBox.textContent = '🔹'; });
  emojiBox.appendChild(emoji);
  const headText = document.createElement('div');
  headText.innerHTML = `<div class="session-sel-name">${escHtml(it.label)}</div>` +
    `<div class="session-sel-note">Active targets for this learner</div>`;
  head.appendChild(emojiBox); head.appendChild(headText);
  host.appendChild(head);

  const buckets = { feature: it.features, function: it.functions, class: it.classes };
  TYPE_ORDER.forEach(type => {
    const all = buckets[type] || [];
    if (!all.length) return;
    const active = new Set(state.session.targets[id][type] || []);

    const gh = document.createElement('div');
    gh.className = 'session-trait-group-head';
    gh.innerHTML = `<span class="gh-label">${type[0].toUpperCase()+type.slice(1)}</span><span class="gh-rule"></span>`;
    host.appendChild(gh);

    const wrap = document.createElement('div');
    wrap.className = 'session-trait-pills';
    all.forEach(trait => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'session-pill' + (active.has(trait) ? ' is-on' : '');
      pill.textContent = tagLabel(trait);
      pill.addEventListener('click', () => toggleTrait(id, type, trait));
      wrap.appendChild(pill);
    });
    host.appendChild(wrap);
  });

  const hint = document.createElement('div');
  hint.className = 'session-trait-hint';
  hint.textContent = "Tap a trait to set it as a target. Greyed traits stay out of this learner's runs.";
  host.appendChild(hint);
}

function toggleTrait(id, type, trait) {
  const arr = state.session.targets[id][type];
  const i = arr.indexOf(trait);
  if (i >= 0) arr.splice(i, 1); else arr.push(trait);
  renderSessionTargets();
  renderSessionPool();          // refresh the item's trait-count summary
  updateSessionStartCount();
}

function renderSessionBand() {
  sEl['session-array-val'].textContent = String(state.session.arraySize);
  [...sEl['session-types'].querySelectorAll('.session-type-pill')].forEach(pill => {
    pill.classList.toggle('is-on', state.session.includeTypes.includes(pill.dataset.type));
  });
  sEl['sel-session-prompting'].value = state.session.prompting;
  const subs = { 'most-to-least': 'Errorless start', 'least-to-most': 'Hints on miss', 'time-delay': `Waits ${TIME_DELAY_SECS}s` };
  sEl['session-prompting-sub'].textContent = subs[state.session.prompting] || '';
}

function updateSessionStartCount() {
  const eligibleItems = state.session.items.filter(id =>
    state.session.includeTypes.some(type => activeCount(id, type) > 0));
  sEl['session-start-count'].textContent = String(eligibleItems.length);
  const runnable = sessionRunnable();
  sEl['btn-session-start'].disabled = !runnable;
  sEl['btn-session-start'].style.opacity = runnable ? '' : '0.5';
}

// ── Gating (Frame 04 — long-press the gear to edit) ────────────────
let _holdTimer = null, _didHold = false;
function setSessionEditing(on) {
  state.sessionEditing = on;
  sEl['session-panel'].dataset.editing = String(on);
}
function openSessionPanel(editing) {
  setSessionPanelOpen(true);
  if (editing) setSessionEditing(true);
}
function setSessionPanelOpen(open) {
  state.sessionPanelOpen = open;
  sEl['btn-session-toggle'].setAttribute('aria-expanded', String(open));
  sEl['btn-session-toggle'].classList.toggle('is-open', open);
  if (open) { sEl['session-panel'].removeAttribute('hidden'); renderSessionPanel(); }
  else      { sEl['session-panel'].setAttribute('hidden', ''); setSessionEditing(false); }
}

function bindSessionEvents() {
  const gear = sEl['btn-session-toggle'];

  // Press-and-hold → open in editing mode; quick tap → toggle (locked) view.
  const startHold = (e) => {
    _didHold = false;
    gear.classList.add('is-holding');
    _holdTimer = setTimeout(() => {
      _didHold = true;
      gear.classList.remove('is-holding');
      openSessionPanel(true);            // unlocked
    }, 600);
  };
  const endHold = () => {
    gear.classList.remove('is-holding');
    if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = null; }
  };
  gear.addEventListener('pointerdown', startHold);
  gear.addEventListener('pointerup', endHold);
  gear.addEventListener('pointerleave', endHold);
  gear.addEventListener('pointercancel', endHold);
  gear.addEventListener('click', (e) => {
    if (_didHold) { _didHold = false; return; }   // hold already handled it
    setSessionPanelOpen(!state.sessionPanelOpen);
  });

  sEl['btn-session-close'].addEventListener('click', () => setSessionPanelOpen(false));

  sEl['inp-session-search'].addEventListener('input', renderSessionPool);

  sEl['btn-session-add'].addEventListener('click', () => {
    state.sessionAddMode = !state.sessionAddMode;
    sEl['inp-session-search'].value = '';
    renderSessionPool();
  });

  // Array stepper
  sEl['session-array-val'].parentElement.addEventListener('click', (e) => {
    const btn = e.target.closest('.session-step');
    if (!btn) return;
    state.session.arraySize = clampArray(state.session.arraySize + parseInt(btn.dataset.dir, 10));
    renderSessionBand();
  });

  // Types-to-include
  sEl['session-types'].addEventListener('click', (e) => {
    const pill = e.target.closest('.session-type-pill');
    if (!pill) return;
    const type = pill.dataset.type;
    const inc = state.session.includeTypes;
    const i = inc.indexOf(type);
    if (i >= 0) { if (inc.length > 1) inc.splice(i, 1); }   // keep ≥1
    else inc.push(type);
    renderSessionBand();
    updateSessionStartCount();
  });

  sEl['sel-session-prompting'].addEventListener('change', () => {
    state.session.prompting = sEl['sel-session-prompting'].value;
    renderSessionBand();
  });

  sEl['sel-session-set'].addEventListener('change', () => applySetByName(sEl['sel-session-set'].value));

  sEl['btn-session-save'].addEventListener('click', saveCurrentSet);
  sEl['btn-session-reset'].addEventListener('click', () => {
    state.session = defaultSession();
    state.sessionSel = null;
    renderSessionPanel();
  });

  sEl['btn-session-start'].addEventListener('click', startSession);
}

// ── Saved sets ─────────────────────────────────────────────────────
function applySetByName(name) {
  if (!name) return;
  const store = loadSessionStore();
  const set = store.sets && store.sets[name];
  if (!set) return;
  state.session = normalizeSet(set);
  state.sessionSel = state.session.items[0] || null;
  store.last = name; saveSessionStore(store);
  renderSessionPanel();
}

function saveCurrentSet() {
  const name = (prompt('Name this set (pseudonym only — no learner identifiers):', '') || '').trim();
  if (!name) return;
  const store = loadSessionStore();
  store.sets = store.sets || {};
  store.sets[name] = JSON.parse(JSON.stringify(state.session));
  store.last = name;
  saveSessionStore(store);
  renderSetPicker(store);
}

// ── Session trial generator ────────────────────────────────────────
function buildSessionTrial() {
  const s = state.session;
  const pairs = [];
  s.items.forEach(id => {
    const it = itemById(id);
    if (!it) return;
    s.includeTypes.forEach(type => {
      const traits = (s.targets[id] && s.targets[id][type]) || [];
      if (traits.length) pairs.push({ it, type, traits });
    });
  });
  if (!pairs.length) return null;

  const { it, type, traits } = pickRandom(pairs);
  const trait = pickRandom(traits);
  const mode  = TYPE_MAP[type].mode;
  // Use state.arraySize (engine source of truth — nextPosition()/fitGrid read it);
  // startSession() syncs it to session.arraySize before play begins.
  const trial = buildTrialData(mode, trait, state.arraySize, it);   // forcedTarget = it
  if (!trial) return null;
  return { trial, mode, tag: trait, type };
}

function startSession() {
  if (!sessionRunnable()) {
    alert('No active targets to run. Add items and tap some traits first.');
    return;
  }
  // Persist as the working/last config so a reload restores it.
  const store = loadSessionStore();
  store.working = JSON.parse(JSON.stringify(state.session));
  saveSessionStore(store);

  state.sessionActive = true;
  state.arraySize = state.session.arraySize;   // engine + fitGrid read this
  setSessionEditing(false);                    // re-lock on start
  setSessionPanelOpen(false);
  startGame();
}
