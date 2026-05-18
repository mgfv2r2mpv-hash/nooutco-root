'use strict';

/* ══════════════════════════════════════════════════════════════════
   HICKORY DICKORY DOCK  (Receptive ID)
   Sample = a written word label; the comparison pictures circle a
   grandfather clock. Tap the picture that matches the name: it floats
   up to the top of the clock, the cuckoo pops out, the clock strikes
   the next hour, and the picture tumbles off. "Next" sets the trial.

   Receptive-ID logic (decks, prompts, error handling, data, print) is
   the same as the Receptive Words game — only the stage is re-skinned.
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
 *  Uses manifest.displayNames[src] when set; otherwise the filename.
 *  e.g. "T_animals/bear.svg" → "Bear"
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
  resolving:    false,   // true while the clock-strike animation runs

  // Clock — session only. Starts at 12 so the first correct "strikes one".
  clockHour: 12,

  // Layout geometry (recomputed on render + resize)
  geom: null,

  // Shuffled position deck
  posDeck: [],

  // Shuffled sample deck — ensures all items shown before any repeats
  sampleDeck: [],

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
  clockSection:        $('clock-section'),
  clockStage:          $('clock-stage'),
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
};

// ── Boot ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  loadSettings();
  bindEvents();
  await discoverTopics();
});

// ── Settings (localStorage) ────────────────────────────────────────

function loadSettings() {
  const s = JSON.parse(localStorage.getItem('hddSettings') || '{}');
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

  el.chkPromptDelay.disabled = !state.autoPromptEnabled;
  el.selPromptDelay.disabled = !state.autoPromptEnabled || !state.promptDelay;
}

function saveSettings() {
  localStorage.setItem('hddSettings', JSON.stringify({
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
  state.clockHour   = 12;

  el.gameArea.removeAttribute('hidden');
  el.btnPrompt.removeAttribute('hidden');
  removeNextBtn();

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
  state.resolving     = false;
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

/** Shrink font-size until the word fits inside #sample-card. */
function fitSampleWord() {
  const card = $('sample-card');
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

// ── The grandfather clock ──────────────────────────────────────────

const CLOCK_RATIO = 1.95;   // clock height / clock width

function clockMarkup() {
  // 12 hour ticks around the dial
  let ticks = '';
  for (let h = 1; h <= 12; h++) {
    const a = (h / 12) * Math.PI * 2 - Math.PI / 2;
    const x = 50 + Math.cos(a) * 38;
    const y = 50 + Math.sin(a) * 38;
    const big = (h % 3 === 0);
    ticks += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${big ? 2.6 : 1.4}" fill="#5a3a1c"/>`;
  }
  return `
  <div class="clock" aria-hidden="true">
    <div class="clock-crown">
      <div class="cuckoo-door door-left"></div>
      <div class="cuckoo-door door-right"></div>
      <div class="cuckoo">
        <div class="cuckoo-bird">
          <div class="cuckoo-wing"></div>
          <div class="cuckoo-beak"></div>
          <div class="cuckoo-eye"></div>
        </div>
        <div class="cuckoo-bubble">Cuckoo!</div>
      </div>
    </div>

    <div class="clock-head">
      <div class="clock-face">
        <svg class="clock-dial" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="47" fill="#fdf6e3" stroke="#6b4423" stroke-width="3"/>
          <circle cx="50" cy="50" r="43" fill="none" stroke="#caa46a" stroke-width="1"/>
          ${ticks}
          <circle cx="50" cy="50" r="3.4" fill="#3a2410"/>
        </svg>
        <div class="hand hand-minute"></div>
        <div class="hand hand-hour"></div>
        <div class="hand-cap"></div>
      </div>
    </div>

    <div class="clock-body">
      <div class="pendulum-window">
        <div class="pendulum"><span class="pendulum-bob"></span></div>
        <div class="mouse">
          <span class="mouse-ear"></span>
          <span class="mouse-tail"></span>
        </div>
      </div>
    </div>

    <div class="clock-base"></div>
  </div>`;
}

// ── Render a trial onto the clock stage ────────────────────────────

function renderTrial() {
  el.sampleWord.textContent = state.sampleLabel;
  requestAnimationFrame(fitSampleWord);

  el.clockStage.innerHTML = clockMarkup();
  setHourHand(state.clockHour, false);

  state.tileImages.forEach((src, idx) => {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.index = idx;

    const wrapper = document.createElement('div');
    wrapper.className = 'tile-wrapper';

    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.dataset.index = idx;

    const front = document.createElement('div');
    front.className = 'tile-front';
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

    const badge = document.createElement('div');
    badge.className = 'tile-badge';
    badge.textContent = '✓';

    tile.appendChild(front);
    tile.appendChild(badge);
    wrapper.appendChild(tile);
    slot.appendChild(wrapper);

    slot.addEventListener('click', () => onTileClick(idx));
    el.clockStage.appendChild(slot);
  });

  layoutStage();
}

// Compute stage geometry: ring radius, tile size, clock size, slot
// positions, and the landing point at the top of the clock.
function layoutStage() {
  if (!el.gameArea || el.gameArea.hasAttribute('hidden')) return;
  const n = state.arraySize;
  if (!n) return;

  const W = el.clockStage.clientWidth;
  const H = el.clockStage.clientHeight;
  if (W < 40 || H < 40) return;

  const cx = W / 2;
  const cy = H / 2;
  const PAD = 14;
  const GAP = 14;
  const maxOuter = Math.min(W, H) / 2 - PAD;

  let tile = 0, R = 0, clockH = 0;
  const upper = Math.min(186, Math.max(56, maxOuter * 0.95));
  for (let t = upper; t >= 46; t -= 2) {
    const r = maxOuter - t / 2;
    if (r <= 10) continue;
    const okSpacing = (n < 2) ? true
      : (2 * r * Math.sin(Math.PI / n) >= t + GAP);
    const innerR = r - t * 0.62 - GAP;
    if (innerR <= 30) continue;
    // largest clock (ratio = H/W) whose half-diagonal fits innerR
    const hc = 2 * innerR / Math.sqrt(1 / (CLOCK_RATIO * CLOCK_RATIO) + 1);
    if (okSpacing && hc >= 150) {
      tile = t;
      R = r;
      clockH = Math.min(hc, H * 0.82, 470);
      break;
    }
  }

  if (!tile) {
    // Tight fit fallback: smallest tiles, whatever clock still fits.
    tile = 46;
    R = Math.max(30, maxOuter - tile / 2);
    const innerR = Math.max(20, R - tile * 0.62 - GAP);
    clockH = Math.max(120, Math.min(
      2 * innerR / Math.sqrt(1 / (CLOCK_RATIO * CLOCK_RATIO) + 1),
      H * 0.82, 470));
  }

  const clockW = clockH / CLOCK_RATIO;
  el.clockStage.style.setProperty('--clock-h', `${Math.round(clockH)}px`);
  el.clockStage.style.setProperty('--clock-w', `${Math.round(clockW)}px`);
  el.clockStage.style.setProperty('--tile-sz', `${Math.round(tile)}px`);

  const clock = el.clockStage.querySelector('.clock');
  if (clock) {
    clock.style.left = `${cx}px`;
    clock.style.top  = `${cy}px`;
  }

  // Landing point: just above the clock crown, centred.
  const landX = cx;
  const landY = cy - clockH / 2 - tile * 0.16;

  const slots = el.clockStage.querySelectorAll('.slot');
  const positions = [];
  slots.forEach((slot, i) => {
    const theta = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const sx = cx + R * Math.cos(theta);
    const sy = cy + R * Math.sin(theta);
    slot.style.width  = `${Math.round(tile)}px`;
    slot.style.height = `${Math.round(tile)}px`;
    slot.style.left   = `${sx}px`;
    slot.style.top    = `${sy}px`;
    positions.push({ x: sx, y: sy });
  });

  state.geom = { cx, cy, R, tile, clockH, clockW, landX, landY, positions, W, H };
}

window.addEventListener('resize', () => { if (!state.resolving) layoutStage(); });
window.addEventListener('orientationchange', () => { if (!state.resolving) layoutStage(); });
if (window.ResizeObserver && el.clockStage) {
  new ResizeObserver(() => { if (!state.resolving) layoutStage(); }).observe(el.clockStage);
}

// ── Clock hands & cuckoo ───────────────────────────────────────────

function setHourHand(hour, animate) {
  const hourHand = el.clockStage.querySelector('.hand-hour');
  const minHand  = el.clockStage.querySelector('.hand-minute');
  if (!hourHand) return;
  hourHand.style.transition = animate
    ? 'transform 0.9s cubic-bezier(.34,1.3,.5,1)' : 'none';
  if (minHand) minHand.style.transition = animate
    ? 'transform 0.9s cubic-bezier(.34,1.3,.5,1)' : 'none';
  // hour 12 → 360deg (top); each hour = 30deg
  hourHand.style.transform = `translateX(-50%) rotate(${hour * 30}deg)`;
  if (minHand) minHand.style.transform = `translateX(-50%) rotate(${hour * 360}deg)`;
}

/** The clock strikes: doors open, cuckoo springs out and calls, the
 *  hour hand advances, the mouse scampers, the body gives a chime shake. */
function strikeClock() {
  state.clockHour = (state.clockHour % 12) + 1;
  setHourHand(state.clockHour, true);

  const clock = el.clockStage.querySelector('.clock');
  if (clock) {
    clock.classList.add('chiming');
    setTimeout(() => clock.classList.remove('chiming'), 900);
  }
  el.clockStage.querySelector('.clock-crown')?.classList.add('open');
  el.clockStage.querySelector('.mouse')?.classList.add('run');

  setTimeout(() => {
    el.clockStage.querySelector('.clock-crown')?.classList.remove('open');
    el.clockStage.querySelector('.mouse')?.classList.remove('run');
  }, 1500);
}

// ── Tile interaction ───────────────────────────────────────────────

function onTileClick(idx) {
  if (!state.active || state.resolving) return;
  const slot = getSlot(idx);
  const tile = getTile(idx);
  if (!tile || tile.classList.contains('tile-disabled')) return;

  if (idx === state.correctIdx) {
    onCorrectClick(slot, tile);
  } else {
    if (state.errorless) return;
    onWrongClick(slot);
  }
}

function onCorrectClick(slot, tile) {
  state.resolving = true;
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

  const idx     = parseInt(slot.dataset.index, 10);
  const wrapper = slot.querySelector('.tile-wrapper');
  const g       = state.geom;
  if (!g || !wrapper) { showNextBtn(); return; }

  const from = g.positions[idx] || { x: g.cx, y: g.cy };
  const dx   = g.landX - from.x;
  const dy   = g.landY - from.y;

  tile.classList.add('chosen');

  // 1) Float up to the top of the clock.
  wrapper.style.transition = 'transform 0.75s cubic-bezier(.32,.9,.4,1)';
  requestAnimationFrame(() => {
    wrapper.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
  });

  // 2) Perch + the clock strikes the next hour.
  setTimeout(() => {
    wrapper.classList.add('perched');
    strikeClock();
  }, 780);

  // 3) The picture tumbles off the clock.
  setTimeout(() => {
    wrapper.classList.remove('perched');
    const drop = (g.H - g.landY) + g.tile + 60;
    const dir  = (dx >= 0 ? 1 : -1);
    wrapper.style.transition =
      'transform 0.85s cubic-bezier(.5,0,.9,.45), opacity 0.85s ease-in';
    wrapper.style.transform =
      `translate(${dx + dir * g.tile * 0.5}px, ${dy + drop}px) rotate(${dir * 70}deg) scale(0.85)`;
    wrapper.style.opacity = '0';
  }, 2400);

  // 4) Offer the next trial.
  setTimeout(showNextBtn, 3320);
}

function onWrongClick(slot) {
  state.trialErrors++;

  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;

  if (!state.noErrorAnim) {
    const wrapper = slot.querySelector('.tile-wrapper');
    if (wrapper) {
      wrapper.classList.add('jiggle', 'flash-red');
      const cleanup = () => wrapper.classList.remove('jiggle', 'flash-red');
      wrapper.addEventListener('animationend', cleanup, { once: true });
      setTimeout(cleanup, 600);
    }
  }

  state.autoPrompted = true;
  applyPrompt();
}

function disableAllTiles() {
  el.clockStage.querySelectorAll('.tile').forEach(t => t.classList.add('tile-disabled'));
  el.clockStage.querySelectorAll('.slot').forEach(s => { s.style.pointerEvents = 'none'; });
}

function getSlot(idx) {
  return el.clockStage.querySelector(`.slot[data-index="${idx}"]`);
}

function getTile(idx) {
  return el.clockStage.querySelector(`.tile[data-index="${idx}"]`);
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
  el.clockStage.querySelectorAll('.tile')
    .forEach(t => t.classList.remove('prompt-sparkle', 'prompt-outline'));
}

function onPromptButton() {
  if (state.resolving) return;
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
  el.clockSection.appendChild(overlay);
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
  beginTrial(false);
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
