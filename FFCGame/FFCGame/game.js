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

// ── State ──────────────────────────────────────────────────────────

const state = {
  // Settings
  mode:              'feature',
  tag:               '__auto__',
  arraySize:         4,
  promptPersists:    false,
  promptStyle:       'sparkle',
  autoPromptEnabled: false,
  promptDelay:       false,
  promptDelaySecs:   3,

  // Data
  items:       [],
  vocab:       { groups:[], features:[], functions:[], classes:[] },
  prompts:     {},

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
  posDeck:    [],
  tagDeck:    [],

  // Timer
  timerSecs:       0,
  timerRunning:    false,
  timerHandle:     null,
  timerAutoPaused: false,

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
  selMode:        $('sel-mode'),
  selTag:         $('sel-tag'),
  inpSize:        $('inp-size'),
  chkPersists:    $('chk-persists'),
  selPromptStyle: $('sel-prompt-style'),
  chkAutoPrompt:  $('chk-auto-prompt'),
  chkPromptDelay: $('chk-prompt-delay'),
  selPromptDelay: $('sel-prompt-delay'),
  btnStart:       $('btn-start'),
  gameArea:       $('game-area'),
  sampleWord:     $('sample-word'),
  compGrid:       $('comp-grid'),
  compSection:    $('comp-section'),
  btnPrompt:      $('btn-prompt'),
  btnPrint:       $('btn-print'),
  btnClearData:   $('btn-clear-data'),
  resultsBody:    $('results-body'),
  printMeta:      $('print-meta'),
  printSummary:   $('print-summary'),
};

// ── Boot ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  bindEvents();
  await loadItems();
});

// ── Settings (localStorage) ────────────────────────────────────────

function loadSettings() {
  const s = JSON.parse(localStorage.getItem('ffcgSettings') || '{}');
  state.mode              = s.mode              ?? 'feature';
  state.tag               = s.tag               ?? '__auto__';
  state.arraySize         = s.arraySize         ?? 4;
  state.promptPersists    = s.promptPersists    ?? false;
  state.promptStyle       = s.promptStyle       ?? 'sparkle';
  state.autoPromptEnabled = s.autoPromptEnabled ?? false;
  state.promptDelay       = s.promptDelay       ?? false;
  state.promptDelaySecs   = s.promptDelaySecs   ?? 3;

  el.selMode.value          = state.mode;
  el.inpSize.value          = state.arraySize;
  el.chkPersists.checked    = state.promptPersists;
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
    promptPersists:    state.promptPersists,
    promptStyle:       state.promptStyle,
    autoPromptEnabled: state.autoPromptEnabled,
    promptDelay:       state.promptDelay,
    promptDelaySecs:   state.promptDelaySecs,
  }));
}

// ── Data loading ───────────────────────────────────────────────────

async function loadItems() {
  try {
    const r = await fetch('./items.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    state.items   = data.items   || [];
    state.vocab   = data.vocab   || { groups:[], features:[], functions:[], classes:[] };
    state.prompts = data.prompts || {};
  } catch (e) {
    console.error('Could not load items.json:', e);
    state.items = [];
  }
  populateTagDropdown();
}

// ── Tag dropdown ───────────────────────────────────────────────────

function vocabForMode(mode) {
  if (mode === 'feature')            return state.vocab.features  || [];
  if (mode === 'function')           return state.vocab.functions || [];
  if (mode === 'classWithinGroup')   return state.vocab.classes   || [];
  if (mode === 'classCrossCategory') return state.vocab.classes   || [];
  return [];
}

function populateTagDropdown() {
  const tags = vocabForMode(state.mode);
  el.selTag.innerHTML = '<option value="__auto__">Auto-cycle</option>';
  tags.forEach(t => {
    const o = document.createElement('option');
    o.value = t;
    o.textContent = tagLabel(t);
    el.selTag.appendChild(o);
  });
  // Restore saved tag if still valid
  if (state.tag && (state.tag === '__auto__' || tags.includes(state.tag))) {
    el.selTag.value = state.tag;
  } else {
    el.selTag.value = '__auto__';
    state.tag = '__auto__';
  }
}

function tagLabel(tag) {
  return tag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Event bindings ─────────────────────────────────────────────────

function bindEvents() {
  el.btnTimerToggle.addEventListener('click', toggleTimer);
  el.btnTimerReset.addEventListener('click',  resetTimer);

  el.selMode.addEventListener('change', () => {
    state.mode = el.selMode.value;
    state.tag  = '__auto__';
    state.tagDeck = [];
    saveSettings();
    populateTagDropdown();
  });

  el.selTag.addEventListener('change', () => {
    state.tag = el.selTag.value;
    state.tagDeck = [];
    saveSettings();
  });

  el.inpSize.addEventListener('change', () => {
    const v = Math.min(10, Math.max(2, parseInt(el.inpSize.value) || 4));
    state.arraySize = v;
    el.inpSize.value = v;
    state.posDeck = [];
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

  el.btnStart.addEventListener('click',  startGame);
  el.btnPrompt.addEventListener('click', onPromptButton);
  el.btnPrint.addEventListener('click',  printData);

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

// ── Tag deck — cycle through tags without repeats ──────────────────

function nextTag() {
  if (state.tag !== '__auto__') return state.tag;
  const tags = vocabForMode(state.mode);
  if (!tags.length) return null;
  if (!state.tagDeck.length) {
    state.tagDeck = shuffle([...tags]);
  }
  return state.tagDeck.pop();
}

// ── Trial builder ──────────────────────────────────────────────────

/**
 * Builds a trial for a given mode and tag.
 * Returns { targetItem, promptSentence, tileItems, correctIdx } or null if
 * the item pool is too small to build a valid trial.
 */
function buildTrialData(mode, tag, n) {
  const items = state.items;
  const bucket = modeBucket(mode);
  const promptSentence = resolvePrompt(mode, tag);

  // Pool of items that ARE the target (have the tag)
  const targetPool = items.filter(it => it[bucket] && it[bucket].includes(tag));
  if (!targetPool.length) return null;
  const target = pickRandom(targetPool);

  let distractorPool;

  if (mode === 'classCrossCategory') {
    // Distractors share NO group with the target and don't carry the class tag
    const targetGroups = new Set(target.groups || []);
    distractorPool = items.filter(it =>
      it.id !== target.id &&
      !(it[bucket] && it[bucket].includes(tag)) &&
      !(it.groups || []).some(g => targetGroups.has(g))
    );
    if (distractorPool.length < n - 1) {
      // Relax: allow items from any group, just not same class tag
      console.warn(`[FFC] cross-category pool too small for tag="${tag}"; relaxing group constraint`);
      distractorPool = items.filter(it =>
        it.id !== target.id && !(it[bucket] && it[bucket].includes(tag))
      );
    }
  } else {
    // Within-group: distractors share a group with target but lack the tag
    const sharedGroup = pickRandom(target.groups && target.groups.length ? target.groups : ['']);
    distractorPool = items.filter(it =>
      it.id !== target.id &&
      !(it[bucket] && it[bucket].includes(tag)) &&
      (it.groups || []).includes(sharedGroup)
    );
    if (distractorPool.length < n - 1) {
      // Relax: any item without the tag
      console.warn(`[FFC] within-group pool too small for tag="${tag}", group="${sharedGroup}"; relaxing`);
      distractorPool = items.filter(it =>
        it.id !== target.id && !(it[bucket] && it[bucket].includes(tag))
      );
    }
  }

  if (!distractorPool.length) return null;

  const distractors = sample(distractorPool, n - 1);
  // Pad with duplicates if still short (shouldn't happen in a healthy item set)
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

function modeBucket(mode) {
  if (mode === 'feature')            return 'features';
  if (mode === 'function')           return 'functions';
  if (mode === 'classWithinGroup')   return 'classes';
  if (mode === 'classCrossCategory') return 'classes';
  return 'features';
}

function resolvePrompt(mode, tag) {
  const overrides = state.prompts[mode] || {};
  if (overrides[tag]) return overrides[tag];
  if (mode === 'classWithinGroup' || mode === 'classCrossCategory') {
    const shared = state.prompts.class || {};
    if (shared[tag]) return shared[tag];
  }
  const bucket = modeBucket(mode);
  const readable = tag.replace(/_/g, ' ');
  if (bucket === 'features')  return `Which one is ${readable}?`;
  if (bucket === 'functions') return `Which do you ${readable}?`;
  return `Which one is a ${readable}?`;
}

// ── Game flow ──────────────────────────────────────────────────────

function startGame() {
  if (!state.items.length) {
    alert('No items loaded. Check that items.json is present and reload.');
    return;
  }

  state.active     = true;
  state.posDeck    = [];
  state.tagDeck    = [];

  el.gameArea.removeAttribute('hidden');
  el.btnPrompt.removeAttribute('hidden');
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
    const tag = nextTag();
    if (!tag) { alert('No tags available for this mode.'); return; }
    const trial = buildTrialData(state.mode, tag, state.arraySize);
    if (!trial) {
      alert(`Not enough items to build a trial for tag "${tagLabel(tag)}". Add more items in the FFC Manager.`);
      return;
    }
    state.targetItem     = trial.targetItem;
    state.targetTag      = tag;
    state.promptSentence = trial.promptSentence;
    state.tileItems      = trial.tileItems;
    state.correctIdx     = trial.correctIdx;
  } else {
    // Reshuffle positions only, keep same target and tag
    const trial = buildTrialData(state.mode, state.targetTag, state.arraySize);
    if (trial) {
      state.tileItems  = trial.tileItems;
      state.correctIdx = trial.correctIdx;
    }
  }

  renderTrial();

  if (keepTarget) {
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

function renderTrial() {
  el.sampleWord.textContent = state.promptSentence;
  fitSampleWord();

  const cols = gridCols(state.arraySize);
  const tileSz = getComputedStyle(document.documentElement).getPropertyValue('--tile-sz').trim() || '160px';
  el.compGrid.style.gridTemplateColumns = `repeat(${cols}, ${tileSz})`;
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
    front.appendChild(img);

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
    time: elapsed,
    outcome,
    settingsKey: [
      state.mode, state.targetTag, state.arraySize,
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

  wrapper.classList.add('jiggle', 'flash-red');
  const cleanup = () => wrapper.classList.remove('jiggle', 'flash-red');
  wrapper.addEventListener('animationend', cleanup, { once: true });
  setTimeout(() => wrapper.classList.remove('jiggle', 'flash-red'), 600);

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

// ── Next button ────────────────────────────────────────────────────

function showNextBtn() {
  removeNextBtn();
  const btn = document.createElement('button');
  btn.id = 'btn-next';
  btn.textContent = 'Next';
  btn.addEventListener('click', onNextClick);
  el.compSection.appendChild(btn);
}

function removeNextBtn() {
  const btn = $('btn-next');
  if (btn) btn.remove();
}

function onNextClick() {
  removeNextBtn();
  if (state.timerAutoPaused) { state.timerAutoPaused = false; startTimer(); }
  const last = state.sessionData[state.sessionData.length - 1];
  const needsRepeat = last && (last.outcome === 'Error' || last.outcome === 'Repeat Error');
  beginTrial(needsRepeat);
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
    const modeLabel = d.mode.replace(/([A-Z])/g, ' $1').trim();
    tr.innerHTML =
      `<td${b}>${d.trial}</td>` +
      `<td${b}>${modeLabel}</td>` +
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
