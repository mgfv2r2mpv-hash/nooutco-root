'use strict';

/* ══════════════════════════════════════════════════════════════════
   IDENTICAL MATCHING GAME

   Two image-discovery modes (tried in order):
   1. manifest.json  – pre-built file list; works on Cloudflare Pages
      and any static host. Generate it with: node build.js
   2. Directory listing – parsed from the HTTP server's HTML index;
      works locally with: python3 -m http.server 8000
   ══════════════════════════════════════════════════════════════════ */

// ── Utilities ──────────────────────────────────────────────────────

/** Fisher-Yates shuffle (mutates and returns the array). */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Pick a random element from an array. */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── State ──────────────────────────────────────────────────────────

const state = {
  // Persisted settings
  topic:          '',
  arraySize:      4,
  crossCategory:  false,
  promptPersists: false,
  promptStyle:    'sparkle',   // 'sparkle' | 'outline'

  // Discovered folders & images
  manifest:     null, // parsed manifest.json, or null when using dir-listing
  topicFolders: [],   // all T_* folder names
  topicImages:  [],   // images in the selected topic folder
  otherImages:  [],   // images in all other folders (cross-category mode)

  // Session
  active:      false,
  sessionData: [],    // array of completed trial records
  trialNum:    0,

  // Current trial
  sampleSrc:   '',    // src of the sample stimulus
  tileImages:  [],    // src[0..N-1] for comparison tiles
  correctIdx:  0,     // which tile index is the correct answer
  trialErrors: 0,     // wrong clicks this trial
  trialStart:  0,     // Date.now() at trial start
  prompted:    false, // user clicked Prompt button this trial
  autoPrompted:false, // prompt shown automatically (error or repeat)

  // Controls repeat-trial behaviour
  keepSample:  false, // next beginTrial() keeps same sampleSrc + auto-prompts

  // Shuffled position deck (ensures equal distribution)
  posDeck: [],

  // Timer
  timerSecs:    0,
  timerRunning: false,
  timerHandle:  null,

  // Prompt fade timeout
  promptHandle: null,
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
  btnStart:       $('btn-start'),
  gameArea:       $('game-area'),
  sampleImg:      $('sample-img'),
  compGrid:       $('comp-grid'),
  compSection:    $('comp-section'),
  btnPrompt:      $('btn-prompt'),
  btnPrint:       $('btn-print'),
  resultsBody:    $('results-body'),
  printMeta:      $('print-meta'),
  printSummary:   $('print-summary'),
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
  state.topic          = s.topic          ?? '';
  state.arraySize      = s.arraySize      ?? 4;
  state.crossCategory  = s.crossCategory  ?? false;
  state.promptPersists = s.promptPersists ?? false;
  state.promptStyle    = s.promptStyle    ?? 'sparkle';

  el.inpSize.value         = state.arraySize;
  el.chkCross.checked      = state.crossCategory;
  el.chkPersists.checked   = state.promptPersists;
  el.selPromptStyle.value  = state.promptStyle;
}

function saveSettings() {
  localStorage.setItem('mgSettings', JSON.stringify({
    topic:          state.topic,
    arraySize:      state.arraySize,
    crossCategory:  state.crossCategory,
    promptPersists: state.promptPersists,
    promptStyle:    state.promptStyle,
  }));
}

// ── Image discovery ────────────────────────────────────────────────

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp)$/i;

/** Fetch a directory listing and return image paths inside it. */
async function fetchDirImages(folder) {
  try {
    const r = await fetch(`./${folder}/`);
    if (!r.ok) return [];
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    return [...doc.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href'))
      // Reject paths with slashes (sub-dirs) and non-image hrefs
      .filter(h => IMAGE_EXT.test(h) && !h.includes('/'))
      .map(h => `${folder}/${h}`);
  } catch {
    return [];
  }
}

/**
 * Discover topic folders, trying manifest.json first (Cloudflare Pages /
 * any static host), then falling back to HTTP directory listing (local dev).
 */
async function discoverTopics() {
  let dirs = [];

  // ── 1. Try manifest.json ──
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
  } catch { /* not present – fall through */ }

  // ── 2. Fall back to HTTP directory listing ──
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
      console.warn(
        'Could not discover topic folders. ' +
        'Either run "node build.js" to generate manifest.json, ' +
        'or serve locally with "python3 -m http.server 8000".'
      );
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

/** Populate the topic <select> from discovered folders. */
function buildTopicDropdown(dirs) {
  el.selTopic.innerHTML = '';
  if (!dirs.length) {
    el.selTopic.innerHTML = '<option value="">-- No T_* folders found --</option>';
    return;
  }
  dirs.forEach(d => {
    const o = document.createElement('option');
    o.value = d;
    // T_community_helpers → "Community Helpers"
    o.textContent = d.slice(2).replace(/_/g, ' ')
                     .replace(/\b\w/g, c => c.toUpperCase());
    el.selTopic.appendChild(o);
  });
}

/**
 * (Re)load images for the current topic (and all others if cross-category).
 * Uses manifest.json when available; otherwise fetches directory listings.
 * Called on: initial load, topic change, array-size change, cross-category toggle.
 */
async function refreshImages() {
  if (!state.topic) { state.topicImages = []; state.otherImages = []; return; }

  if (state.manifest) {
    // Fast path: data is already in memory
    state.topicImages = state.manifest.images[state.topic] || [];
    state.otherImages = (state.crossCategory && state.topicFolders.length > 1)
      ? state.topicFolders
          .filter(f => f !== state.topic)
          .flatMap(f => state.manifest.images[f] || [])
      : [];
    return;
  }

  // Slow path: fetch directory listings
  state.topicImages = await fetchDirImages(state.topic);

  if (state.crossCategory && state.topicFolders.length > 1) {
    const others = state.topicFolders.filter(f => f !== state.topic);
    state.otherImages = (await Promise.all(others.map(fetchDirImages))).flat();
  } else {
    state.otherImages = [];
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
    state.posDeck = [];        // reset position deck for new size
    saveSettings();
    await refreshImages();
  });

  el.chkCross.addEventListener('change', async () => {
    state.crossCategory = el.chkCross.checked;
    saveSettings();
    await refreshImages();
  });

  el.chkPersists.addEventListener('change', () => {
    state.promptPersists = el.chkPersists.checked;
    saveSettings();
  });

  el.selPromptStyle.addEventListener('change', () => {
    state.promptStyle = el.selPromptStyle.value;
    saveSettings();
  });

  el.btnStart.addEventListener('click',  startGame);
  el.btnPrompt.addEventListener('click', onPromptButton);
  el.btnPrint.addEventListener('click',  printData);
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
  renderTimer();
}

function renderTimer() {
  const m = String(Math.floor(state.timerSecs / 60)).padStart(2, '0');
  const s = String(state.timerSecs % 60).padStart(2, '0');
  el.timerDisplay.textContent = `${m}:${s}`;
}

// ── Position deck ──────────────────────────────────────────────────
/**
 * Returns the next correct-tile position, drawn from a shuffled deck.
 * The deck is refilled each time it empties, guaranteeing that over
 * every N trials each position is used exactly once.
 */
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
    alert(
      `No images found in ${state.topic}/.\n` +
      'Add image files to that folder and reload the page.'
    );
    return;
  }

  // Reset session state
  state.active      = true;
  state.sessionData = [];
  state.trialNum    = 0;
  state.posDeck     = [];
  state.keepSample  = false;

  el.resultsBody.innerHTML = '';
  el.gameArea.removeAttribute('hidden');
  el.btnPrompt.removeAttribute('hidden');
  removeNextBtn();

  resetTimer();
  startTimer();
  beginTrial();
}

/**
 * Begin a new trial.
 * @param {boolean} keepSample - If true, reuse state.sampleSrc and show
 *   an immediate auto-prompt (repeat trial after an error).
 */
function beginTrial(keepSample = false) {
  state.trialNum++;
  state.trialErrors  = 0;
  state.prompted     = false;
  state.autoPrompted = keepSample; // repeat trials are inherently auto-prompted
  state.trialStart   = Date.now();

  clearPrompt();
  buildTrial(keepSample);
  renderTrial();

  if (keepSample) {
    // Auto-prompt the correct tile immediately (slight delay for DOM paint)
    setTimeout(applyPrompt, 80);
  }
}

/**
 * Build the tile array for the current trial.
 * @param {boolean} keepSample - If true, keep state.sampleSrc unchanged.
 */
function buildTrial(keepSample) {
  const n = state.arraySize;

  // ── Sample image ──
  if (!keepSample) {
    state.sampleSrc = pickRandom(state.topicImages);
  }

  // ── Distractor pool ──
  const basePool = state.crossCategory
    ? [...state.topicImages, ...state.otherImages]
    : [...state.topicImages];

  // Remove the sample from the distractor pool to avoid duplication
  const distractorPool = shuffle(basePool.filter(src => src !== state.sampleSrc));

  // If the pool is exhausted, allow repeats (modular index)
  const getDistractor = i =>
    distractorPool.length ? distractorPool[i % distractorPool.length] : state.sampleSrc;

  // ── Assign positions ──
  const correctPos     = nextPosition();
  state.correctIdx     = correctPos;
  state.tileImages     = new Array(n);
  let di = 0;

  for (let i = 0; i < n; i++) {
    state.tileImages[i] = (i === correctPos) ? state.sampleSrc : getDistractor(di++);
  }
}

/** Render sample image and comparison grid from current state. */
function renderTrial() {
  // Sample
  el.sampleImg.src = state.sampleSrc;
  el.sampleImg.alt = 'Sample stimulus';

  // Grid column count
  const cols = gridCols(state.arraySize);
  el.compGrid.style.gridTemplateColumns = `repeat(${cols}, 128px)`;
  el.compGrid.innerHTML = '';

  state.tileImages.forEach((src, idx) => {
    // Wrapper (expand + jiggle animations)
    const wrapper = document.createElement('div');
    wrapper.className = 'tile-wrapper';
    wrapper.dataset.index = idx;

    // Tile (flip animation)
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.index = idx;

    // Front face
    const front = document.createElement('div');
    front.className = 'tile-face tile-front';
    const img = document.createElement('img');
    img.src = src;
    img.alt = `Choice ${idx + 1}`;
    front.appendChild(img);

    // Back face
    const back = document.createElement('div');
    back.className = 'tile-face tile-back';
    const okText = document.createElement('span');
    okText.className = 'ok-text';
    okText.textContent = 'OK';
    back.appendChild(okText);

    tile.appendChild(front);
    tile.appendChild(back);
    wrapper.appendChild(tile);

    wrapper.addEventListener('click', () => onTileClick(idx));
    el.compGrid.appendChild(wrapper);
  });
}

/** Return number of grid columns for a given tile count. */
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
    onWrongClick(wrapper, idx);
  }
}

function onCorrectClick(wrapper, tile) {
  disableAllTiles();
  clearPrompt();

  // Record trial
  const elapsed = ((Date.now() - state.trialStart) / 1000).toFixed(1);
  const outcome = state.trialErrors > 0 ? 'Prompted correction' : 'Correct';
  state.sessionData.push({
    trial:     state.trialNum,
    topic:     state.topic.slice(2).replace(/_/g, ' '),
    sample:    state.sampleSrc.split('/').pop(),
    arraySize: state.arraySize,
    errors:    state.trialErrors,
    prompted:  state.prompted || state.autoPrompted,
    time:      elapsed,
    outcome,
  });

  // Animate: wrapper expands, then tile flips, then Next button appears
  wrapper.classList.add('expanding');
  setTimeout(() => {
    wrapper.classList.remove('expanding');
    tile.classList.add('flipped');
    setTimeout(showNextBtn, 580);
  }, 280);
}

function onWrongClick(wrapper, idx) {
  state.trialErrors++;

  // Jiggle + red flash on the clicked wrapper
  wrapper.classList.add('jiggle', 'flash-red');
  const cleanup = () => wrapper.classList.remove('jiggle', 'flash-red');
  wrapper.addEventListener('animationend', cleanup, { once: true });
  // Fallback in case animationend doesn't fire
  setTimeout(() => wrapper.classList.remove('jiggle', 'flash-red'), 600);

  // Auto-prompt the correct tile
  state.autoPrompted = true;
  applyPrompt();
}

function disableAllTiles() {
  el.compGrid.querySelectorAll('.tile').forEach(t => {
    t.classList.add('tile-disabled');
  });
  el.compGrid.querySelectorAll('.tile-wrapper').forEach(w => {
    w.style.pointerEvents = 'none';
  });
}

function getWrapper(idx) {
  return el.compGrid.querySelector(`.tile-wrapper[data-index="${idx}"]`);
}

function getTile(idx) {
  return el.compGrid.querySelector(`.tile[data-index="${idx}"]`);
}

// ── Prompt logic ───────────────────────────────────────────────────

/** Apply the chosen prompt effect to the correct tile. */
function applyPrompt() {
  clearPrompt(); // clear any existing prompt/timeout first

  const tile = getTile(state.correctIdx);
  if (!tile) return;

  const cls = state.promptStyle === 'sparkle' ? 'prompt-sparkle' : 'prompt-outline';
  tile.classList.add(cls);

  if (!state.promptPersists) {
    // Remove after 3 s (no fade needed; the animation just stops)
    state.promptHandle = setTimeout(() => {
      tile.classList.remove(cls);
      state.promptHandle = null;
    }, 3000);
  }
}

/** Clear any active prompt effect from all tiles. */
function clearPrompt() {
  clearTimeout(state.promptHandle);
  state.promptHandle = null;
  el.compGrid.querySelectorAll('.tile')
    .forEach(t => t.classList.remove('prompt-sparkle', 'prompt-outline'));
}

/** Handler for the manual Prompt button. */
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
  // If the completed trial had errors → repeat same sample with auto-prompt
  const last = state.sessionData[state.sessionData.length - 1];
  const hadErrors = last && last.errors > 0;
  beginTrial(hadErrors);
}

// ── Print data ─────────────────────────────────────────────────────

function printData() {
  if (!state.sessionData.length) {
    alert('No trial data to print yet. Complete at least one trial first.');
    return;
  }

  // Build metadata line
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });
  el.printMeta.textContent =
    `Printed: ${dateStr} at ${timeStr}  |  ` +
    `Topic: ${state.topic.slice(2).replace(/_/g, ' ')}  |  ` +
    `Array size: ${state.arraySize}`;

  // Populate table rows
  el.resultsBody.innerHTML = '';
  state.sessionData.forEach(d => {
    const tr = document.createElement('tr');
    const isError = d.outcome !== 'Correct';

    tr.innerHTML = `
      <td>${d.trial}</td>
      <td>${d.topic}</td>
      <td>${d.sample}</td>
      <td>${d.arraySize}</td>
      <td>${d.errors}</td>
      <td>${d.prompted ? 'Yes' : 'No'}</td>
      <td>${d.time}</td>
      <td class="${isError ? 'outcome-error' : 'outcome-ok'}">${d.outcome}</td>
    `;
    el.resultsBody.appendChild(tr);
  });

  // Summary stats
  const total    = state.sessionData.length;
  const correct  = state.sessionData.filter(d => d.outcome === 'Correct').length;
  const avgTime  = (
    state.sessionData.reduce((s, d) => s + parseFloat(d.time), 0) / total
  ).toFixed(1);
  const prompted = state.sessionData.filter(d => d.prompted).length;

  el.printSummary.innerHTML =
    `<span>Total trials: <strong>${total}</strong></span>` +
    `<span>Correct (no errors): <strong>${correct}</strong></span>` +
    `<span>Prompted corrections: <strong>${total - correct}</strong></span>` +
    `<span>Trials with prompt: <strong>${prompted}</strong></span>` +
    `<span>Avg response time: <strong>${avgTime} s</strong></span>`;

  window.print();
}
