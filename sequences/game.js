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
  extraPanelOpen:    false,

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
  selSet:          $('sel-set'),
  inpPatternLen:   $('inp-pattern-length'),
  inpReps:         $('inp-reps'),
  inpBlanks:       $('inp-blanks'),
  inpBank:         $('inp-bank'),
  btnExtraToggle:  $('btn-extra-toggle'),
  extraPanel:      $('extra-panel'),
  btnExtraClose:   $('btn-extra-close'),
  chkRepresentErrors: $('chk-represent-errors'),
  chkErrorless:    $('chk-errorless'),
  chkNoErrorAnim:  $('chk-no-error-anim'),
  chkPersists:     $('chk-persists'),
  chkAutoPrompt:   $('chk-auto-prompt'),
  chkPromptDelay:  $('chk-prompt-delay'),
  selPromptDelay:  $('sel-prompt-delay'),
  selPromptStyle:  $('sel-prompt-style'),
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

// ── Settings persistence ───────────────────────────────────────────

function loadSettings() {
  const s = JSON.parse(localStorage.getItem('seqSettings') || '{}');
  state.setName           = s.setName           ?? '';
  state.patternLength     = s.patternLength     ?? 2;
  state.shownReps         = s.shownReps         ?? 2;
  state.blanksToFill      = s.blanksToFill      ?? 1;
  state.bankSize          = s.bankSize          ?? 4;
  state.representErrors   = s.representErrors   ?? true;
  state.errorless         = s.errorless         ?? false;
  state.noErrorAnim       = s.noErrorAnim       ?? false;
  state.promptPersists    = s.promptPersists    ?? false;
  state.promptStyle       = s.promptStyle       ?? 'sparkle';
  state.autoPromptEnabled = s.autoPromptEnabled ?? false;
  state.promptDelay       = s.promptDelay       ?? false;
  state.promptDelaySecs   = s.promptDelaySecs   ?? 3;

  el.inpPatternLen.value        = state.patternLength;
  el.inpReps.value              = state.shownReps;
  el.inpBlanks.value            = state.blanksToFill;
  el.inpBlanks.max              = state.patternLength;
  el.inpBank.value              = state.bankSize;
  el.chkRepresentErrors.checked = state.representErrors;
  el.chkErrorless.checked       = state.errorless;
  el.chkNoErrorAnim.checked     = state.noErrorAnim;
  el.chkPersists.checked        = state.promptPersists;
  el.chkAutoPrompt.checked      = state.autoPromptEnabled;
  el.chkPromptDelay.checked     = state.promptDelay;
  el.selPromptDelay.value       = state.promptDelaySecs;
  el.selPromptStyle.value       = state.promptStyle;

  el.chkPromptDelay.disabled = !state.autoPromptEnabled;
  el.selPromptDelay.disabled = !state.autoPromptEnabled || !state.promptDelay;
}

function saveSettings() {
  localStorage.setItem('seqSettings', JSON.stringify({
    setName:           state.setName,
    patternLength:     state.patternLength,
    shownReps:         state.shownReps,
    blanksToFill:      state.blanksToFill,
    bankSize:          state.bankSize,
    representErrors:   state.representErrors,
    errorless:         state.errorless,
    noErrorAnim:       state.noErrorAnim,
    promptPersists:    state.promptPersists,
    promptStyle:       state.promptStyle,
    autoPromptEnabled: state.autoPromptEnabled,
    promptDelay:       state.promptDelay,
    promptDelaySecs:   state.promptDelaySecs,
  }));
}

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
  populateSetDropdown();
}

function populateSetDropdown() {
  const names = Object.keys(state.symbolsData.sets || {});
  el.selSet.innerHTML = '';
  if (!names.length) {
    el.selSet.innerHTML = '<option value="">(no sets)</option>';
    return;
  }
  names.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    el.selSet.appendChild(opt);
  });
  // Restore saved selection if still available
  const saved = state.setName && names.includes(state.setName) ? state.setName : names[0];
  state.setName = saved;
  el.selSet.value = saved;
}

// ── Event bindings ─────────────────────────────────────────────────

function bindEvents() {
  el.btnTimerToggle.addEventListener('click', toggleTimer);
  el.btnTimerReset.addEventListener('click',  resetTimer);

  el.selSet.addEventListener('change', () => {
    state.setName = el.selSet.value;
    saveSettings();
  });

  el.inpPatternLen.addEventListener('change', () => {
    state.patternLength = clamp(parseInt(el.inpPatternLen.value, 10) || 2, 2, 5);
    el.inpPatternLen.value = state.patternLength;
    if (state.blanksToFill > state.patternLength) {
      state.blanksToFill = state.patternLength;
      el.inpBlanks.value = state.blanksToFill;
    }
    el.inpBlanks.max = state.patternLength;
    saveSettings();
  });

  el.inpReps.addEventListener('change', () => {
    state.shownReps = clamp(parseInt(el.inpReps.value, 10) || 2, 1, 4);
    el.inpReps.value = state.shownReps;
    saveSettings();
  });

  el.inpBlanks.addEventListener('change', () => {
    state.blanksToFill = clamp(parseInt(el.inpBlanks.value, 10) || 1, 1, state.patternLength);
    el.inpBlanks.value = state.blanksToFill;
    saveSettings();
  });

  el.inpBank.addEventListener('change', () => {
    state.bankSize = clamp(parseInt(el.inpBank.value, 10) || 4, 2, 8);
    el.inpBank.value = state.bankSize;
    saveSettings();
  });

  // Extra panel
  el.btnExtraToggle.addEventListener('click', () => setExtraPanelOpen(!state.extraPanelOpen));
  el.btnExtraClose.addEventListener('click',  () => setExtraPanelOpen(false));

  el.chkRepresentErrors.addEventListener('change', () => { state.representErrors   = el.chkRepresentErrors.checked; saveSettings(); });
  el.chkErrorless.addEventListener('change',       () => { state.errorless         = el.chkErrorless.checked;       saveSettings(); });
  el.chkNoErrorAnim.addEventListener('change',     () => { state.noErrorAnim       = el.chkNoErrorAnim.checked;     saveSettings(); });
  el.chkPersists.addEventListener('change',        () => { state.promptPersists    = el.chkPersists.checked;        saveSettings(); });
  el.selPromptStyle.addEventListener('change',     () => { state.promptStyle       = el.selPromptStyle.value;       saveSettings(); });

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
    state.promptDelaySecs = parseInt(el.selPromptDelay.value, 10);
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

// ── Extra settings panel ───────────────────────────────────────────

function setExtraPanelOpen(open) {
  state.extraPanelOpen = open;
  el.btnExtraToggle.setAttribute('aria-expanded', String(open));
  el.btnExtraToggle.classList.toggle('is-open', open);
  if (open) el.extraPanel.removeAttribute('hidden');
  else      el.extraPanel.setAttribute('hidden', '');
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
    const pool = state.symbolsData.sets[state.setName].slice();
    shuffle(pool);
    state.unit = pool.slice(0, state.patternLength);
  }

  const pool       = state.symbolsData.sets[state.setName].slice();
  const unitSet    = new Set(state.unit);
  const distractors = pool.filter(s => !unitSet.has(s));
  shuffle(distractors);

  let bank = state.unit.slice();
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

  state.sessionData.push({
    trial:      state.trialNum,
    set:        state.setName,
    pattern:    state.unit.join(''),
    patternLen: state.patternLength,
    reps:       state.shownReps,
    blanks:     state.blanksToFill,
    bankSize:   state.bankSize,
    errors:     state.trialErrors,
    prompted:   state.prompted || state.autoPrompted,
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
  // Void the completed trial — procedural error, don't count it.
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

// ── Init ───────────────────────────────────────────────────────────

(async function init() {
  loadSettings();
  bindEvents();
  await loadSymbols();
  renderTimer();
})();
