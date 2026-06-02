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
  symbolsData: null,        // { generated, sets: { name: [emoji, ...] } }
  setNames:    [],

  setName:       '',
  patternLength: 2,
  shownReps:     2,
  blanksToFill:  1,
  bankSize:      4,

  active:      false,
  sessionData: [],
  trialNum:    0,

  // Current trial
  unit:        [],   // e.g. ["🐶","🐱"]
  filledCount: 0,    // boxes already filled (shownReps * patternLength + filled blanks)
  blankIdx:    0,    // next blank to fill (0..blanksToFill-1)
  trialErrors: 0,
  trialStart:  0,
  bank:        [],

  // Timer
  timerSecs:    0,
  timerRunning: false,
  timerHandle:  null,
};

// ── DOM references ─────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const el = {
  timerDisplay:   $('timer-display'),
  btnTimerToggle: $('btn-timer-toggle'),
  btnTimerReset:  $('btn-timer-reset'),
  selSet:         $('sel-set'),
  inpPatternLen:  $('inp-pattern-length'),
  inpReps:        $('inp-reps'),
  inpBlanks:      $('inp-blanks'),
  inpBank:        $('inp-bank'),
  btnStart:       $('btn-start'),
  gameArea:       $('game-area'),
  patternRow:     $('pattern-row'),
  bankRow:        $('bank-row'),
  btnPrint:       $('btn-print'),
  btnClearData:   $('btn-clear-data'),
  resultsBody:    $('results-body'),
  printMeta:      $('print-meta'),
  printSummary:   $('print-summary'),
};

// ── Boot ───────────────────────────────────────────────────────────

async function loadSymbols() {
  try {
    const r = await fetch('./symbols.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('fetch failed: ' + r.status);
    state.symbolsData = await r.json();
  } catch (e) {
    console.warn('symbols.json load failed:', e);
    state.symbolsData = { sets: {} };
  }
  state.setNames = Object.keys(state.symbolsData.sets || {});
  populateSetDropdown();
}

function populateSetDropdown() {
  el.selSet.innerHTML = '';
  if (!state.setNames.length) {
    el.selSet.innerHTML = '<option value="">(no sets)</option>';
    return;
  }
  state.setNames.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    el.selSet.appendChild(opt);
  });
  state.setName = state.setNames[0];
  el.selSet.value = state.setName;
}

function bindEvents() {
  el.selSet.addEventListener('change', () => { state.setName = el.selSet.value; });
  el.inpPatternLen.addEventListener('change', () => {
    state.patternLength = clamp(parseInt(el.inpPatternLen.value, 10) || 2, 2, 5);
    el.inpPatternLen.value = state.patternLength;
    // Blanks must not exceed pattern length
    if (state.blanksToFill > state.patternLength) {
      state.blanksToFill = state.patternLength;
      el.inpBlanks.value = state.blanksToFill;
    }
    el.inpBlanks.max = state.patternLength;
  });
  el.inpReps.addEventListener('change', () => {
    state.shownReps = clamp(parseInt(el.inpReps.value, 10) || 2, 1, 4);
    el.inpReps.value = state.shownReps;
  });
  el.inpBlanks.addEventListener('change', () => {
    state.blanksToFill = clamp(parseInt(el.inpBlanks.value, 10) || 1, 1, state.patternLength);
    el.inpBlanks.value = state.blanksToFill;
  });
  el.inpBank.addEventListener('change', () => {
    state.bankSize = clamp(parseInt(el.inpBank.value, 10) || 4, 2, 8);
    el.inpBank.value = state.bankSize;
  });

  el.btnStart.addEventListener('click', startGame);
  el.btnTimerToggle.addEventListener('click', toggleTimer);
  el.btnTimerReset.addEventListener('click', resetTimer);
  el.btnPrint.addEventListener('click', printData);
  el.btnClearData.addEventListener('click', clearData);
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
  resetTimer();
  startTimer();
  beginTrial();
}

function beginTrial() {
  const pool = state.symbolsData.sets[state.setName].slice();
  // Pick a unique permutation of `patternLength` symbols
  shuffle(pool);
  state.unit = pool.slice(0, state.patternLength);

  state.trialNum++;
  state.trialErrors = 0;
  state.trialStart = Date.now();
  state.blankIdx = 0;

  // Build bank: unit symbols + distractors from remaining pool
  const remaining = pool.slice(state.patternLength);
  const distractorsNeeded = Math.max(0, state.bankSize - state.unit.length);
  const distractors = remaining.slice(0, distractorsNeeded);
  let bank = state.unit.concat(distractors);
  if (bank.length > state.bankSize) bank = bank.slice(0, state.bankSize);
  state.bank = shuffle(bank);

  renderPattern();
  renderBank();
}

function renderPattern() {
  el.patternRow.innerHTML = '';
  const reps = state.shownReps;
  const len  = state.patternLength;

  // Filled boxes
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i < len; i++) {
      const box = document.createElement('div');
      box.className = 'seq-box seq-box-filled';
      box.textContent = state.unit[i];
      el.patternRow.appendChild(box);
    }
  }
  // Blank boxes (one per blank to fill); the active one gets focus ring
  for (let b = 0; b < state.blanksToFill; b++) {
    const box = document.createElement('div');
    box.className = 'seq-box seq-box-blank';
    if (b === state.blankIdx) box.classList.add('seq-box-active');
    if (b < state.blankIdx) {
      // already filled (correctly) — render the symbol
      const expected = state.unit[(reps * len + b) % len];
      box.textContent = expected;
      box.classList.remove('seq-box-blank');
      box.classList.add('seq-box-filled');
    }
    box.dataset.blankIdx = String(b);
    el.patternRow.appendChild(box);
  }
}

function renderBank() {
  el.bankRow.innerHTML = '';
  state.bank.forEach(sym => {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'bank-tile';
    t.textContent = sym;
    t.addEventListener('click', () => onBankPick(sym, t));
    el.bankRow.appendChild(t);
  });
}

function onBankPick(sym, btnEl) {
  const len = state.patternLength;
  const reps = state.shownReps;
  const expected = state.unit[(reps * len + state.blankIdx) % len];

  // Find the active blank box
  const blankBox = el.patternRow.querySelector(`.seq-box-active`);

  if (sym === expected) {
    if (blankBox) {
      blankBox.textContent = sym;
      blankBox.classList.remove('seq-box-blank', 'seq-box-active');
      blankBox.classList.add('seq-box-filled');
    }
    state.blankIdx++;
    if (state.blankIdx >= state.blanksToFill) {
      finishTrial();
    } else {
      // Advance focus to next blank
      const nextBlank = el.patternRow.querySelector(`[data-blank-idx="${state.blankIdx}"]`);
      if (nextBlank) nextBlank.classList.add('seq-box-active');
    }
  } else {
    state.trialErrors++;
    if (blankBox) {
      blankBox.classList.add('shake');
      setTimeout(() => blankBox.classList.remove('shake'), 500);
    }
    btnEl.classList.add('shake');
    setTimeout(() => btnEl.classList.remove('shake'), 500);
  }
}

function finishTrial() {
  const time = ((Date.now() - state.trialStart) / 1000).toFixed(1);
  const outcome = state.trialErrors === 0 ? 'Correct' : 'Error';
  state.sessionData.push({
    trial:       state.trialNum,
    set:         state.setName,
    pattern:     state.unit.join(''),
    patternLen:  state.patternLength,
    reps:        state.shownReps,
    blanks:      state.blanksToFill,
    bankSize:    state.bankSize,
    errors:      state.trialErrors,
    time,
    outcome,
    settingsKey: `${state.setName}|${state.patternLength}|${state.shownReps}|${state.blanksToFill}|${state.bankSize}`,
  });
  // Brief pause, then next trial
  setTimeout(beginTrial, 600);
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
    const outcomeCls = d.outcome === 'Error' ? 'outcome-error' : 'outcome-ok';
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
      `<td${b}>${d.time}</td>` +
      `<td${b} class="${outcomeCls}">${d.outcome}</td>`;
    el.resultsBody.appendChild(tr);
  });

  const total   = state.sessionData.length;
  const correct = state.sessionData.filter(d => d.outcome === 'Correct').length;
  const errors  = state.sessionData.filter(d => d.outcome === 'Error').length;
  const avgTime = (
    state.sessionData.reduce((s, d) => s + parseFloat(d.time), 0) / total
  ).toFixed(1);

  el.printSummary.innerHTML =
    `<span>Total trials: <strong>${total}</strong></span>` +
    `<span>Correct: <strong>${correct}</strong></span>` +
    `<span>Error: <strong>${errors}</strong></span>` +
    `<span>Avg response time: <strong>${avgTime} s</strong></span>`;

  window.print();
}

function clearData() {
  if (!state.sessionData.length) {
    alert('No data to clear.');
    return;
  }
  if (!confirm(`Clear all ${state.sessionData.length} trial(s) from this session?`)) return;
  state.sessionData = [];
  state.trialNum = 0;
  resetTimer();
  el.gameArea.setAttribute('hidden', '');
  state.active = false;
}

// ── Init ───────────────────────────────────────────────────────────

(async function init() {
  bindEvents();
  await loadSymbols();
  renderTimer();
})();
