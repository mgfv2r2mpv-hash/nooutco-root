'use strict';

/* ══════════════════════════════════════════════════════════════════
   SEQUENCES & PATTERNS GAME
   ══════════════════════════════════════════════════════════════════ */

// ── Utilities ──────────────────────────────────────────────────────

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function escHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
const escAttr = escHtml;

// ── Round setup (Frame 04 - gated in-game settings + ABA prompting) ──
// Pattern templates as position-index arrays; distinct symbols needed =
// max(index) + 1. AABB/ABB repeat positions within the unit.
const PATTERN_TEMPLATES = {
  'AB':   [0, 1],
  'ABC':  [0, 1, 2],
  'AABB': [0, 0, 1, 1],
  'ABB':  [0, 1, 1],
};

const ROUND_KEY = 'nooutco.settings.sequences';
// The retired settings-bar key. Read and folded forward, never deleted.
const LEGACY_SETTINGS_KEY = 'seqSettings';

// Prompting method (UI radio) → recorded prompt type when a prompt fires.
const PROMPT_TYPE_BY_METHOD = {
  'most-to-least': 'model',
  'least-to-most': 'gesture',
  'time-delay':    'delay',
};
const ROUND_TIME_DELAY_SECS = 3;

// ── State ──────────────────────────────────────────────────────────

const state = {
  // Loaded data
  symbolsData: null,

  // Settings (persisted)
  setName:           '',
  patternLength:     2,
  shownReps:         2,
  blanksToFill:      1,
  bankSize:          4,
  representErrors:   true,
  errorless:         false,
  noErrorAnim:       false,
  promptPersists:    false,
  promptStyle:       'sparkle',
  autoPromptEnabled: false,
  promptDelay:       false,
  promptDelaySecs:   3,

  // Round setup (Frame 04 - gated). Working config + panel/lock flags.
  round:          null,   // roundConfig - see defaultRound() for the full schema
  roundActive:    false,  // a curated round is currently in play
  roundEditing:   false,  // panel unlocked for editing (long-press)
  roundPanelOpen: false,

  // Session
  active:      false,
  sessionData: [],
  trialNum:    0,

  // Current trial
  unit:          [],   // e.g. ["🐶","🐱"]
  bank:          [],   // ordered list of bank tiles
  blankIdx:      0,    // which blank is focused (0..blanksToFill-1)
  trialErrors:   0,
  trialStart:    0,
  prompted:      false,
  autoPrompted:  false,
  isRepeatTrial: false,

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
  timerDisplay:    $('timer-display'),
  btnTimerToggle:  $('btn-timer-toggle'),
  btnTimerReset:   $('btn-timer-reset'),
  // Advanced overrides - moved from the retired #extra-panel into #round-panel.
  chkRepresentErrors: $('chk-represent-errors'),
  chkErrorless:    $('chk-errorless'),
  chkNoErrorAnim:  $('chk-no-error-anim'),
  chkPersists:     $('chk-persists'),
  chkAutoPrompt:   $('chk-auto-prompt'),
  chkPromptDelay:  $('chk-prompt-delay'),
  selPromptDelay:  $('sel-prompt-delay'),
  selPromptStyle:  $('sel-prompt-style'),
  // Round / settings panel
  btnRoundToggle:  $('btn-round-toggle'),
  roundPanel:      $('round-panel'),
  selRoundSet:     $('sel-round-set'),
  roundGatePill:   $('round-gate-pill'),
  btnRoundClose:   $('btn-round-close'),
  roundPatterns:   $('round-patterns'),
  selRoundSymbols: $('sel-round-symbols'),
  roundPrompting:  $('round-prompting'),
  roundSound:      $('round-sound'),
  btnRoundStart:   $('btn-round-start'),
  btnRoundSave:    $('btn-round-save'),
  btnRoundReset:   $('btn-round-reset'),
  btnStart:        $('btn-start'),
  btnPrompt:       $('btn-prompt'),
  gameArea:        $('game-area'),
  patternRow:      $('pattern-row'),
  bankSection:     $('bank-section'),
  bankRow:         $('bank-row'),
  btnPrint:        $('btn-print'),
  btnClearData:    $('btn-clear-data'),
  resultsBody:     $('results-body'),
  printMeta:       $('print-meta'),
  printSummary:    $('print-summary'),
};

// ── Symbol set loading ─────────────────────────────────────────────

async function loadSymbols() {
  try {
    const r = await fetch('./symbols.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('fetch failed: ' + r.status);
    state.symbolsData = await r.json();
  } catch (e) {
    console.warn('symbols.json load failed:', e);
    state.symbolsData = { sets: {} };
  }
}

// ── Event bindings ─────────────────────────────────────────────────
// The settings-bar numeric inputs and the #extra-panel are gone; every control
// now lives in #round-panel and is bound in bindRoundEvents().

function bindEvents() {
  el.btnTimerToggle.addEventListener('click', toggleTimer);
  el.btnTimerReset.addEventListener('click',  resetTimer);

  el.btnStart.addEventListener('click',  startRound);   // unified: the bar Start runs the round config
  el.btnPrompt.addEventListener('click', onPromptButton);
  el.btnPrint.addEventListener('click',  printData);

  el.btnClearData.addEventListener('click', () => {
    if (!state.sessionData.length) { alert('No data to clear.'); return; }
    if (!confirm('Clear all trial data? This cannot be undone.')) return;
    state.sessionData = [];
    if (window.NooutcoResults) NooutcoResults.clear(RESULTS_KEY);
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

// ── Game flow ──────────────────────────────────────────────────────

function startGame() {
  const pool = (state.symbolsData.sets || {})[state.setName] || [];
  if (pool.length < state.patternLength) {
    alert(`The "${state.setName}" set has only ${pool.length} symbols; needs at least ${state.patternLength} for this pattern length.`);
    return;
  }

  state.active = true;
  el.gameArea.removeAttribute('hidden');
  el.btnPrompt.removeAttribute('hidden');
  removeNextButton();

  resetTimer();
  startTimer();
  beginTrial();
}

/**
 * Begin a trial.
 * keepUnit=true  → error-correction repeat (same unit, same bank, auto-prompted).
 * isRetry=true   → procedural retry (same unit, reshuffled bank, no prompt).
 */
function beginTrial(keepUnit = false, isRetry = false) {
  state.trialNum++;
  state.trialErrors   = 0;
  state.prompted      = false;
  state.autoPrompted  = false;
  state.isRepeatTrial = keepUnit && !isRetry;
  state.blankIdx      = 0;
  state.trialStart    = Date.now();

  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;
  clearPrompt();

  buildTrial(keepUnit || isRetry);
  renderPattern();
  renderBank();

  if (keepUnit && !isRetry) {
    // Error correction: always auto-prompt immediately on the repeat.
    state.autoPrompted = true;
    setTimeout(() => applyPrompt(), 80);
  } else if (!keepUnit && !isRetry && state.autoPromptEnabled) {
    if (state.promptDelay) {
      state.autoPromptHandle = setTimeout(() => {
        state.autoPrompted = true;
        state.autoPromptHandle = null;
        applyPrompt();
      }, state.promptDelaySecs * 1000);
    } else {
      state.autoPrompted = true;
      setTimeout(() => applyPrompt(), 80);
    }
  }
}

function buildTrial(keepUnit) {
  if (!keepUnit) {
    const src = state.symbolsData.sets[state.setName].slice();
    shuffle(src);
    if (state.roundActive) {
      // Round mode: expand a random selected template into the unit.
      const template      = PATTERN_TEMPLATES[pickRandom(state.round.patterns)];
      const distinctCount = Math.max(...template) + 1;
      const chosen        = src.slice(0, distinctCount);
      state.unit          = template.map(i => chosen[i]);
      state.patternLength = state.unit.length;
      if (state.blanksToFill > state.patternLength) state.blanksToFill = state.patternLength;
    } else {
      state.unit = src.slice(0, state.patternLength);
    }
  }

  const pool        = state.symbolsData.sets[state.setName].slice();
  const unitSet     = new Set(state.unit);
  const distractors = pool.filter(s => !unitSet.has(s));
  shuffle(distractors);

  // Bank holds DISTINCT symbols only (templates like AABB repeat within the unit).
  let bank = [...unitSet];
  const needed = state.bankSize - bank.length;
  for (let i = 0; i < needed && i < distractors.length; i++) {
    bank.push(distractors[i]);
  }
  state.bank = shuffle(bank);
}

// ── Render ─────────────────────────────────────────────────────────

function renderPattern() {
  el.patternRow.innerHTML = '';
  const reps = state.shownReps;
  const len  = state.patternLength;

  // Filled (shown) boxes
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < len; i++) {
      const box = document.createElement('div');
      box.className = 'seq-box seq-box-filled';
      box.textContent = state.unit[i];
      el.patternRow.appendChild(box);
    }
  }

  // Blank boxes
  for (let b = 0; b < state.blanksToFill; b++) {
    const box = document.createElement('div');
    box.dataset.blankIdx = String(b);
    if (b === state.blankIdx) {
      box.className = 'seq-box seq-box-blank seq-box-active';
    } else {
      box.className = 'seq-box seq-box-blank';
    }
    el.patternRow.appendChild(box);
  }
}

function renderBank() {
  el.bankRow.innerHTML = '';
  state.bank.forEach(sym => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bank-tile';
    btn.dataset.sym = sym;
    btn.textContent = sym;
    btn.addEventListener('click', () => onBankPick(sym, btn));
    el.bankRow.appendChild(btn);
  });
}

// ── Bank interaction ───────────────────────────────────────────────

function onBankPick(sym, btnEl) {
  if (!state.active) return;
  if (btnEl.disabled) return;

  const reps     = state.shownReps;
  const len      = state.patternLength;
  const expected = state.unit[(reps * len + state.blankIdx) % len];

  if (sym === expected) {
    onCorrectPick(sym, btnEl);
  } else {
    if (state.errorless) return;
    onWrongPick(btnEl);
  }
}

function onCorrectPick(sym, btnEl) {
  if (window.__nooutcoTokens) window.__nooutcoTokens.award();
  // Cancel delayed auto-prompt
  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;
  clearPrompt();

  // Fill the active blank
  const blankBox = el.patternRow.querySelector('.seq-box-active');
  if (blankBox) {
    blankBox.textContent = sym;
    blankBox.classList.remove('seq-box-blank', 'seq-box-active');
    blankBox.classList.add('seq-box-filled');
  }

  state.blankIdx++;

  if (state.blankIdx < state.blanksToFill) {
    // Advance focus and re-apply prompt if needed
    const nextBlank = el.patternRow.querySelector(`[data-blank-idx="${state.blankIdx}"]`);
    if (nextBlank) nextBlank.classList.add('seq-box-active');

    if (state.isRepeatTrial || (state.autoPromptEnabled && !state.promptDelay)) {
      setTimeout(() => applyPrompt(), 80);
    } else if (state.autoPromptEnabled && state.promptDelay) {
      state.autoPromptHandle = setTimeout(() => {
        state.autoPrompted = true;
        state.autoPromptHandle = null;
        applyPrompt();
      }, state.promptDelaySecs * 1000);
    }
  } else {
    finishTrial();
  }
}

function onWrongPick(btnEl) {
  state.trialErrors++;

  // Cancel any pending auto-prompt delay; wrong pick triggers immediate prompt
  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;

  if (!state.noErrorAnim) {
    const blankBox = el.patternRow.querySelector('.seq-box-active');
    if (blankBox) {
      blankBox.classList.add('shake');
      setTimeout(() => blankBox.classList.remove('shake'), 500);
    }
    btnEl.classList.add('shake');
    setTimeout(() => btnEl.classList.remove('shake'), 500);
  }

  state.autoPrompted = true;
  applyPrompt();
}

// ── Prompt logic ───────────────────────────────────────────────────

function applyPrompt() {
  clearPrompt();
  const reps     = state.shownReps;
  const len      = state.patternLength;
  const expected = state.unit[(reps * len + state.blankIdx) % len];

  // Highlight all bank tiles matching the expected symbol
  el.bankRow.querySelectorAll('.bank-tile').forEach(btn => {
    if (btn.dataset.sym === expected) {
      const cls = state.promptStyle === 'sparkle' ? 'prompt-sparkle' : 'prompt-outline';
      btn.classList.add(cls);

      if (!state.promptPersists) {
        state.promptHandle = setTimeout(() => {
          btn.classList.remove(cls);
          state.promptHandle = null;
        }, 3000);
      }
    }
  });
}

function clearPrompt() {
  clearTimeout(state.promptHandle);
  state.promptHandle = null;
  el.bankRow.querySelectorAll('.bank-tile')
    .forEach(btn => btn.classList.remove('prompt-sparkle', 'prompt-outline'));
}

function onPromptButton() {
  state.prompted = true;
  applyPrompt();
}

// ── Trial completion ───────────────────────────────────────────────

function finishTrial() {
  // Pause timer while learner waits for Next
  if (state.timerRunning) { pauseTimer(); state.timerAutoPaused = true; }

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

  recordTrial({
    trial:      state.trialNum,
    set:        state.setName,
    pattern:    state.unit.join(''),
    patternLen: state.patternLength,
    reps:       state.shownReps,
    blanks:     state.blanksToFill,
    bankSize:   state.bankSize,
    errors:     state.trialErrors,
    prompted:   state.prompted || state.autoPrompted,
    promptType: (state.prompted || state.autoPrompted)
      ? (state.roundActive
          ? (PROMPT_TYPE_BY_METHOD[state.round.prompting] || 'model')
          : (state.autoPromptEnabled && state.promptDelay ? 'delay' : 'model'))
      : 'none',
    promptDelaySecs: (!state.isRepeatTrial && state.autoPromptEnabled && state.promptDelay)
      ? state.promptDelaySecs : null,
    time:       elapsed,
    outcome,
    settingsKey: [
      state.setName, state.patternLength, state.shownReps, state.blanksToFill,
      state.bankSize, state.representErrors ? 1 : 0, state.errorless ? 1 : 0,
      state.noErrorAnim ? 1 : 0, state.autoPromptEnabled ? 1 : 0,
      state.promptPersists ? 1 : 0, state.promptStyle,
      state.promptDelay ? state.promptDelaySecs : 0,
    ].join('|'),
  });

  showNextButton();
}

// ── Next / Retry buttons ───────────────────────────────────────────

function showNextButton() {
  removeNextButton();
  const overlay = document.createElement('div');
  overlay.id = 'trial-overlay';

  const btnNext = document.createElement('button');
  btnNext.className = 'btn-watermark btn-watermark-next';
  btnNext.textContent = 'Next';
  btnNext.addEventListener('click', onNextClick);

  const btnRetry = document.createElement('button');
  btnRetry.className = 'btn-watermark btn-watermark-retry';
  btnRetry.textContent = 'Retry';
  btnRetry.addEventListener('click', onRetryClick);

  overlay.appendChild(btnNext);
  overlay.appendChild(btnRetry);
  el.bankSection.appendChild(overlay);
}

function removeNextButton() {
  const overlay = $('trial-overlay');
  if (overlay) overlay.remove();
}

function onNextClick() {
  removeNextButton();
  if (state.timerAutoPaused) { state.timerAutoPaused = false; startTimer(); }
  const last = state.sessionData[state.sessionData.length - 1];
  const needsRepeat = state.representErrors && last &&
    (last.outcome === 'Error' || last.outcome === 'Repeat Error');
  beginTrial(needsRepeat);
}

function onRetryClick() {
  // Void the completed trial - procedural error, don't count it.
  if (state.sessionData.length) {
    state.sessionData.pop();
    state.trialNum--;
  }
  removeNextButton();
  if (state.timerAutoPaused) { state.timerAutoPaused = false; startTimer(); }
  beginTrial(false, true);
}

// ── Print & clear ──────────────────────────────────────────────────

function printData() {
  if (!state.sessionData.length) {
    alert('No trial data to print yet. Complete at least one trial first.');
    return;
  }
  const now = new Date();
  el.printMeta.textContent =
    `Printed: ${now.toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' })} ` +
    `at ${now.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' })}`;

  el.resultsBody.innerHTML = '';
  state.sessionData.forEach((d, i) => {
    const outcomeCls =
      (d.outcome === 'Error' || d.outcome === 'Repeat Error') ? 'outcome-error'
      : d.outcome === 'Prompted'   ? 'outcome-prompted'
      : d.outcome === 'Correction' ? 'outcome-correction'
      : 'outcome-ok';

    const prev = state.sessionData[i - 1];
    const settingsChanged = prev && d.settingsKey !== prev.settingsKey;
    const tr = document.createElement('tr');
    if (settingsChanged) tr.classList.add('settings-changed');
    const b = settingsChanged ? ' style="font-weight:bold"' : '';
    tr.innerHTML =
      `<td${b}>${d.trial}</td>` +
      `<td${b}>${d.set}</td>` +
      `<td${b}>${d.pattern}</td>` +
      `<td${b}>${d.patternLen}</td>` +
      `<td${b}>${d.reps}</td>` +
      `<td${b}>${d.blanks}</td>` +
      `<td${b}>${d.bankSize}</td>` +
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

// ════════════════════════════════════════════════════════════════════
// Round setup (Frame 04) - gated compact settings + ABA prompting.
// A curated pattern round (which templates, repeats, symbol set, prompting
// method, sound) that persists per game to localStorage `nooutco.settings.
// sequences` (pseudonymous set names only - no PHI). The legacy #settings-bar
// path is untouched and remains the fallback.
// ════════════════════════════════════════════════════════════════════

// The round config is the single source of truth for the whole settings panel:
// pattern selection + core trial shape + advanced prompt overrides. The schema
// below is the declaration the shared store (../game-settings.js) clamps
// against; `sequences` is the game that pattern was extracted from, so this is
// the reference shape for the other nine.
//
// `autoPromptEnabled` defaults to TRUE here and false in the other nine games.
// That difference is clinical, not accidental - do not harmonise it.
const ROUND_FIELDS = {
  patterns:     { type: 'list', values: () => Object.keys(PATTERN_TEMPLATES), default: ['AB'] },
  reps:         { type: 'int',  min: 1, max: 10, default: 2 },
  // The symbol set has to be validated against what actually loaded, so its
  // allowed values and its fallback are both resolved at normalize time.
  setName:      { type: 'enum', values: () => symbolSetNames(),
                  default: () => state.setName || symbolSetNames()[0] || '' },
  prompting:    { type: 'enum', values: () => Object.keys(PROMPT_TYPE_BY_METHOD), default: 'most-to-least' },
  sound:        { type: 'bool', default: true },
  // Core trial shape (pattern LENGTH is intrinsic to the selected templates).
  blanksToFill: { type: 'int',  min: 1, max: 5, default: 1 },
  bankSize:     { type: 'int',  min: 2, max: 8, default: 4 },
  // Advanced overrides (formerly the #extra-panel "Options").
  representErrors: { type: 'bool', default: true },
  errorless:       { type: 'bool', default: false },
  noErrorAnim:     { type: 'bool', default: false },
  promptPersists:  { type: 'bool', default: false },
  promptStyle:     { type: 'enum', values: ['sparkle', 'outline'], default: 'sparkle' },
  // Prompt behaviour - the method radio presets these; Advanced can override.
  autoPromptEnabled: { type: 'bool', default: true },
  promptDelay:       { type: 'bool', default: false },
  promptDelaySecs:   { type: 'int', min: 1, max: 10, default: ROUND_TIME_DELAY_SECS },
};

function symbolSetNames() {
  return Object.keys((state.symbolsData && state.symbolsData.sets) || {});
}

const roundStore = window.NooutcoSettings.defineStore({
  key: ROUND_KEY,
  legacyKey: LEGACY_SETTINGS_KEY,
  fields: ROUND_FIELDS,
});

function defaultRound() { return roundStore.defaults(); }
// The engine re-clamps what it reads out of the round config, so the two
// clamps the trial loop uses stay available outside the store's normalize().
function clampInt(n, min, max) { return window.NooutcoSettings.clampInt(n, min, max); }
function clampReps(n) { return window.NooutcoSettings.clampInt(n, 1, 10, 2); }

// Persist live edits as the working config so a reload restores the panel state.
function saveWorkingRound() { roundStore.saveWorking(state.round); }

// ── Rendering ──────────────────────────────────────────────────────
function renderRoundSetPicker(store) {
  store = store || roundStore.load();
  const sel = el.selRoundSet;
  if (!sel) return;
  const names = Object.keys(store.sets || {});
  sel.innerHTML = '<option value="">📁 Unsaved round</option>' +
    names.map(n => `<option value="${escAttr(n)}">📁 ${escHtml(n)}</option>`).join('');
  sel.value = (store.last && (store.sets || {})[store.last]) ? store.last : '';
}

function renderRoundPatterns() {
  const box = el.roundPatterns;
  if (!box) return;
  box.innerHTML = '';
  Object.keys(PATTERN_TEMPLATES).forEach(name => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'round-pill' + (state.round.patterns.includes(name) ? ' is-on' : '');
    b.dataset.pattern = name;
    b.textContent = name;
    box.appendChild(b);
  });
}

function renderRoundSymbols() {
  const sel = el.selRoundSymbols;
  if (!sel) return;
  const names = Object.keys((state.symbolsData && state.symbolsData.sets) || {});
  sel.innerHTML = names.map(n => `<option value="${escAttr(n)}">${escHtml(n)}</option>`).join('');
  if (!names.includes(state.round.setName)) state.round.setName = names[0] || '';
  sel.value = state.round.setName;
}

function renderRoundPrompting() {
  [...el.roundPrompting.querySelectorAll('.round-radio')].forEach(r =>
    r.classList.toggle('is-on', r.dataset.method === state.round.prompting));
}

// Steppers share one delegated handler; keys map straight onto round config fields.
const STEPPER_LIMITS = { reps: [1, 10], blanksToFill: [1, 5], bankSize: [2, 8] };
function setStepperVal(key, val) {
  const node = el.roundPanel.querySelector(`.round-stepper[data-stepper="${key}"] .round-step-val`);
  if (node) node.textContent = String(val);
}
function renderRoundSteppers() {
  setStepperVal('reps',         state.round.reps);
  setStepperVal('blanksToFill', state.round.blanksToFill);
  setStepperVal('bankSize',     state.round.bankSize);
}

function renderRoundSound() {
  el.roundSound.setAttribute('aria-checked', String(state.round.sound));
  el.roundSound.classList.toggle('is-on', state.round.sound);
}

// Advanced overrides - reflect round config into the moved #extra-panel controls.
function renderRoundAdvanced() {
  const r = state.round;
  el.chkRepresentErrors.checked = r.representErrors;
  el.chkErrorless.checked       = r.errorless;
  el.chkNoErrorAnim.checked     = r.noErrorAnim;
  el.chkPersists.checked        = r.promptPersists;
  el.chkAutoPrompt.checked      = r.autoPromptEnabled;
  el.chkPromptDelay.checked     = r.promptDelay;
  el.selPromptDelay.value       = r.promptDelaySecs;
  el.selPromptStyle.value       = r.promptStyle;
  el.chkPromptDelay.disabled    = !r.autoPromptEnabled;
  el.selPromptDelay.disabled    = !r.autoPromptEnabled || !r.promptDelay;
}

// Prompting-method radios are presets for the three prompt-behaviour fields.
const METHOD_PRESETS = {
  'most-to-least': { autoPromptEnabled: true,  promptDelay: false },
  'time-delay':    { autoPromptEnabled: true,  promptDelay: true, promptDelaySecs: ROUND_TIME_DELAY_SECS },
  'least-to-most': { autoPromptEnabled: false, promptDelay: false },
};
function applyMethodPreset(method) {
  const p = METHOD_PRESETS[method] || METHOD_PRESETS['most-to-least'];
  state.round.prompting        = method;
  state.round.autoPromptEnabled = p.autoPromptEnabled;
  state.round.promptDelay       = p.promptDelay;
  if (p.promptDelaySecs != null) state.round.promptDelaySecs = p.promptDelaySecs;
}

function updateRoundStart() {
  const ok = state.round.patterns.length > 0 && !!state.round.setName;
  el.btnRoundStart.disabled = !ok;
  el.btnRoundStart.style.opacity = ok ? '' : '0.5';
}

function renderRoundPanel() {
  renderRoundPatterns();
  renderRoundSteppers();
  renderRoundSymbols();
  renderRoundPrompting();
  renderRoundSound();
  renderRoundAdvanced();
  updateRoundStart();
}

// ── Gating (Frame 04 - long-press the gear to edit) ────────────────
function setRoundEditing(on) {
  state.roundEditing = on;
  el.roundPanel.dataset.editing = String(on);
}
function openRoundPanel(editing) {
  setRoundPanelOpen(true);
  if (editing) setRoundEditing(true);
}
function setRoundPanelOpen(open) {
  state.roundPanelOpen = open;
  el.btnRoundToggle.setAttribute('aria-expanded', String(open));
  el.btnRoundToggle.classList.toggle('is-open', open);
  if (open) { el.roundPanel.removeAttribute('hidden'); renderRoundPanel(); }
  else      { el.roundPanel.setAttribute('hidden', ''); setRoundEditing(false); }
}

function bindRoundEvents() {
  const gear = el.btnRoundToggle;
  if (!gear) return;

  // Press-and-hold → open unlocked; quick tap → toggle (locked) view.
  window.NooutcoSettings.holdToUnlock(gear, {
    holdMs: 600,
    onHold: () => openRoundPanel(true),
    onTap:  () => setRoundPanelOpen(!state.roundPanelOpen),
  });

  el.btnRoundClose.addEventListener('click', () => setRoundPanelOpen(false));

  el.roundPatterns.addEventListener('click', (e) => {
    const pill = e.target.closest('.round-pill');
    if (!pill) return;
    const p = pill.dataset.pattern;
    const arr = state.round.patterns;
    const i = arr.indexOf(p);
    if (i >= 0) arr.splice(i, 1); else arr.push(p);
    renderRoundPatterns();
    updateRoundStart();
    saveWorkingRound();
  });

  // Delegated stepper handler for reps / blanks / bank size.
  el.roundPanel.addEventListener('click', (e) => {
    const btn = e.target.closest('.round-step');
    if (!btn) return;
    const stepper = btn.closest('.round-stepper');
    const key = stepper && stepper.dataset.stepper;
    const limits = STEPPER_LIMITS[key];
    if (!limits) return;
    state.round[key] = clampInt(state.round[key] + parseInt(btn.dataset.dir, 10), limits[0], limits[1]);
    renderRoundSteppers();
    saveWorkingRound();
  });

  el.selRoundSymbols.addEventListener('change', () => {
    state.round.setName = el.selRoundSymbols.value;
    updateRoundStart();
    saveWorkingRound();
  });

  el.roundPrompting.addEventListener('click', (e) => {
    const r = e.target.closest('.round-radio');
    if (!r) return;
    applyMethodPreset(r.dataset.method);
    renderRoundPrompting();
    renderRoundAdvanced();
    saveWorkingRound();
  });

  el.roundSound.addEventListener('click', () => {
    state.round.sound = !state.round.sound;
    renderRoundSound();
    saveWorkingRound();
  });

  // Advanced overrides (moved from #extra-panel) - write straight to round config.
  el.chkRepresentErrors.addEventListener('change', () => { state.round.representErrors = el.chkRepresentErrors.checked; saveWorkingRound(); });
  el.chkErrorless.addEventListener('change',       () => { state.round.errorless       = el.chkErrorless.checked;       saveWorkingRound(); });
  el.chkNoErrorAnim.addEventListener('change',     () => { state.round.noErrorAnim     = el.chkNoErrorAnim.checked;     saveWorkingRound(); });
  el.chkPersists.addEventListener('change',        () => { state.round.promptPersists  = el.chkPersists.checked;        saveWorkingRound(); });
  el.selPromptStyle.addEventListener('change',     () => { state.round.promptStyle      = el.selPromptStyle.value;       saveWorkingRound(); });
  el.chkAutoPrompt.addEventListener('change', () => {
    state.round.autoPromptEnabled = el.chkAutoPrompt.checked;
    renderRoundAdvanced();
    saveWorkingRound();
  });
  el.chkPromptDelay.addEventListener('change', () => {
    state.round.promptDelay = el.chkPromptDelay.checked;
    renderRoundAdvanced();
    saveWorkingRound();
  });
  el.selPromptDelay.addEventListener('change', () => {
    state.round.promptDelaySecs = clampInt(el.selPromptDelay.value, 1, 10);
    saveWorkingRound();
  });

  el.selRoundSet.addEventListener('change', () => applyRoundByName(el.selRoundSet.value));
  el.btnRoundSave.addEventListener('click', saveCurrentRound);
  el.btnRoundReset.addEventListener('click', () => {
    state.round = defaultRound();
    renderRoundPanel();
  });
  el.btnRoundStart.addEventListener('click', startRound);
}

// ── Saved sets ─────────────────────────────────────────────────────
function applyRoundByName(name) {
  if (!name) return;
  const applied = roundStore.applySet(name);
  if (!applied) return;
  state.round = applied;
  renderRoundPanel();
}

function saveCurrentRound() {
  const name = (prompt('Name this set (pseudonym only - no learner identifiers):', '') || '').trim();
  if (!name) return;
  renderRoundSetPicker(roundStore.saveSet(name, state.round));
}

// ── Start a curated round ──────────────────────────────────────────
function applyRoundToEngine() {
  const r = state.round;
  state.roundActive     = true;
  state.setName         = r.setName;
  state.shownReps       = clampReps(r.reps);
  state.blanksToFill    = clampInt(r.blanksToFill, 1, 5);  // clamped per-trial to the template length
  state.bankSize        = clampInt(r.bankSize, 2, 8);
  // Advanced overrides (formerly #extra-panel).
  state.representErrors = r.representErrors;
  state.errorless       = r.errorless;
  state.noErrorAnim     = r.noErrorAnim;
  state.promptPersists  = r.promptPersists;
  state.promptStyle     = r.promptStyle;
  // Prompt behaviour: the method radio presets these three (see applyMethodPreset);
  // the Advanced group may override them. Values live on state.round, so copy straight through.
  state.autoPromptEnabled = r.autoPromptEnabled;
  state.promptDelay       = r.promptDelay;
  state.promptDelaySecs   = clampInt(r.promptDelaySecs, 1, 10);
  window.__noabaMuted     = !r.sound;              // gates the shared reward chime
}

function startRound() {
  const r = state.round;
  const sets = (state.symbolsData && state.symbolsData.sets) || {};
  if (!r.patterns.length) { alert('Pick at least one pattern to run.'); return; }
  const pool = sets[r.setName] || [];
  const maxDistinct = Math.max(...r.patterns.map(p => Math.max(...PATTERN_TEMPLATES[p]) + 1));
  if (pool.length < maxDistinct) {
    alert(`The "${r.setName}" set has only ${pool.length} symbols; needs at least ${maxDistinct} for the selected patterns.`);
    return;
  }

  // Persist as the working/last config so a reload restores it.
  roundStore.saveWorking(r);

  applyRoundToEngine();
  setRoundEditing(false);       // re-lock on start
  setRoundPanelOpen(false);

  const intro = document.getElementById('game-intro');
  if (intro) intro.hidden = true;
  if (window.__nooutcoTokens) window.__nooutcoTokens.startSession();

  startGame();
}

// One-time fold of the retired `seqSettings` store into the round working config,
// so a user who configured the old settings-bar/Options keeps their choices.
// Read-then-fold, never drop: `seqSettings` itself is left untouched in storage.
// The map names every field explicitly - an absent legacy field must land as
// `undefined` so the schema's default wins over whatever a saved set held.
function migrateLegacyIntoStore() {
  return roundStore.foldLegacy({
    map: (legacy) => ({
      blanksToFill:      legacy.blanksToFill,
      bankSize:          legacy.bankSize,
      representErrors:   legacy.representErrors,
      errorless:         legacy.errorless,
      noErrorAnim:       legacy.noErrorAnim,
      promptPersists:    legacy.promptPersists,
      promptStyle:       legacy.promptStyle,
      autoPromptEnabled: legacy.autoPromptEnabled,
      promptDelay:       legacy.promptDelay,
      promptDelaySecs:   legacy.promptDelaySecs,
    }),
  });
}

function initRound() {
  migrateLegacyIntoStore();
  state.round = roundStore.initial();
  state.roundActive = false;
  state.roundEditing = false;
  state.roundPanelOpen = false;
  bindRoundEvents();
  renderRoundSetPicker();
}

// ── Trial record (device-local) ────────────────────────────────────
// Trial rows used to live only in memory, so a refresh mid-session lost the
// technician's whole record. They persist here through the shared store, which
// is device-local and never transmitted (see results-report.js).
// promptType is already resolved above against the active round, so stampTrial
// leaves it alone and only adds the timestamp.
const RESULTS_KEY = 'nooutco.results.sequences';

function promptCfg() {
  return { autoPrompt: state.autoPromptEnabled, promptDelay: state.promptDelay };
}

function recordTrial(row) {
  const prompted = state.prompted || state.autoPrompted;
  if (window.NooutcoResults) {
    NooutcoResults.record(RESULTS_KEY, state.sessionData, row, promptCfg(), prompted);
  } else {
    state.sessionData.push(row);
  }
}

function persistTrials() {
  if (window.NooutcoResults) NooutcoResults.save(RESULTS_KEY, state.sessionData);
}

function restoreTrials() {
  if (!window.NooutcoResults) return;
  const rows = NooutcoResults.load(RESULTS_KEY);
  if (!Array.isArray(rows) || !rows.length) return;
  state.sessionData = rows;
  state.trialNum = rows.reduce((m, d) => Math.max(m, Number(d.trial) || 0), 0);
}

// ── Init ───────────────────────────────────────────────────────────

(async function init() {
  if (window.NooutcoConfig) NooutcoConfig.migrate();
  restoreTrials();
  bindEvents();
  await loadSymbols();
  initRound();
  renderTimer();
})();
