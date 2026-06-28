'use strict';

/* ══════════════════════════════════════════════════════════════════
   HICKORY DICKORY DOCK  (Receptive ID)
   Sample = a written word label; the comparison pictures fan around a
   large grandfather clock (left side, floor, right side — never above
   it). Tap the picture that matches the name: it drops to the floor,
   runs to the clock, climbs it while the minute hand spins, reaches the
   top exactly as the hand strikes 12, the cuckoo pops, then it leaps
   down the far side and scampers off. "Next" sets the trial.

   Receptive-ID logic (decks, prompts, error handling, data, print) is
   identical to the Receptive Words game — only the stage is re-skinned.
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

/** Derive a display label from an image path. */
function labelFromSrc(src) {
  const override = state.manifest?.displayNames?.[src];
  if (typeof override === 'string' && override.trim()) return override;
  const name = src.split('/').pop().replace(/\.[^.]+$/, '');
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── State ──────────────────────────────────────────────────────────

const state = {
  // Persisted settings
  topic:             '',
  arraySize:         4,
  animations:        true,
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

  targetFilters: {},

  manifest:     null,
  topicFolders: [],
  topicImages:  [],
  otherImages:  [],

  targetPanelOpen: false,

  active:      false,
  sessionData: [],
  trialNum:    0,

  sampleSrc:    '',
  sampleLabel:  '',
  tileImages:   [],
  correctIdx:   0,
  trialErrors:  0,
  trialStart:   0,
  prompted:     false,
  autoPrompted: false,
  isRepeatTrial: false,
  resolving:    false,   // true during the climb / resolve sequence
  introPlaying: false,   // true during the rhyme intro

  // Clock — session only. Starts at 12 so the first correct "strikes one".
  clockHour: 12,

  geom: null,            // layout geometry (recomputed on render + resize)

  posDeck: [],
  sampleDeck: [],

  timerSecs:       0,
  timerRunning:    false,
  timerHandle:     null,
  timerAutoPaused: false,

  promptHandle:     null,
  autoPromptHandle: null,

  // Animation timeout handles (so a new trial can cancel a running one)
  animTimers: [],
};

// ── DOM references ─────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const el = {
  timerDisplay:        $('timer-display'),
  btnTimerToggle:      $('btn-timer-toggle'),
  btnTimerReset:       $('btn-timer-reset'),
  selTopic:            $('sel-topic'),
  inpSize:             $('inp-size'),
  chkAnimations:       $('chk-animations'),
  chkCross:                   $('chk-cross'),
  chkNonTargetDistractor:     $('chk-non-target-distractor'),
  chkPersists:                $('chk-persists'),
  selPromptStyle:      $('sel-prompt-style'),
  chkAutoPrompt:       $('chk-auto-prompt'),
  chkPromptDelay:      $('chk-prompt-delay'),
  selPromptDelay:      $('sel-prompt-delay'),
  btnStart:            $('btn-start'),
  gameArea:            $('game-area'),
  sampleSection:       $('sample-section'),
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
  state.animations        = s.animations        ?? true;
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
  el.chkAnimations.checked      = state.animations;
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
    animations:        state.animations,
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

  el.chkAnimations.addEventListener('change', () => {
    state.animations = el.chkAnimations.checked;
    saveSettings();
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

// ── Decks ──────────────────────────────────────────────────────────

function nextPosition() {
  if (!state.posDeck.length) {
    state.posDeck = shuffle([...Array(state.arraySize).keys()]);
  }
  return state.posDeck.pop();
}

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

// ── Animation timer helpers ────────────────────────────────────────

function after(ms, fn) {
  const h = setTimeout(fn, ms);
  state.animTimers.push(h);
  return h;
}

function clearAnimTimers() {
  state.animTimers.forEach(clearTimeout);
  state.animTimers = [];
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
  clearAnimTimers();
  state.trialNum++;
  state.trialErrors   = 0;
  state.prompted      = false;
  state.autoPrompted  = false;
  state.isRepeatTrial = keepSample;
  state.resolving     = false;
  state.introPlaying  = false;
  state.trialStart    = Date.now();

  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;

  clearPrompt();
  if (buildTrial(keepSample) === false) return;
  renderTrial();

  if (state.animations) {
    runIntro(() => {
      state.introPlaying = false;
      enableTiles();
      state.trialStart = Date.now();   // pace from when the child can respond
      schedulePrompts(keepSample);
    });
  } else {
    schedulePrompts(keepSample);
  }
}

function schedulePrompts(keepSample) {
  if (keepSample) {
    state.autoPrompted = true;
    after(80, applyPrompt);
  } else if (state.autoPromptEnabled) {
    if (state.promptDelay) {
      state.autoPromptHandle = setTimeout(() => {
        state.autoPrompted = true;
        state.autoPromptHandle = null;
        applyPrompt();
      }, state.promptDelaySecs * 1000);
    } else {
      state.autoPrompted = true;
      after(80, applyPrompt);
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
const MIN_TILE    = 50;
const GAP         = 14;

function clockMarkup() {
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
      </div>
    </div>

    <div class="clock-base"></div>
  </div>`;
}

// ── Render a trial onto the clock stage ────────────────────────────

function renderTrial() {
  el.sampleWord.textContent = state.sampleLabel;

  el.clockStage.innerHTML = clockMarkup();

  const floor = document.createElement('div');
  floor.className = 'stage-floor';
  el.clockStage.appendChild(floor);

  if (state.animations) {
    const title = document.createElement('div');
    title.className = 'rhyme-title';
    title.textContent = 'Hickory Dickory Dock …';
    el.clockStage.appendChild(title);
    el.sampleSection.classList.add('intro-hide');
  } else {
    el.sampleSection.classList.remove('intro-hide');
    requestAnimationFrame(fitSampleWord);
  }

  state.tileImages.forEach((src, idx) => {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.index = idx;
    if (state.animations) slot.classList.add('pre-in');

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
  setMinuteHand(0, false);
  setHourHandToCurrent(false);
}

/**
 * Geometry: a large clock standing on the floor, tiles fanned in a 'U'
 * up the left side, across the floor, and up the right side — never
 * above the clock.
 */
function layoutStage() {
  if (!el.gameArea || el.gameArea.hasAttribute('hidden')) return;
  const n = state.arraySize;
  if (!n) return;

  const W = el.clockStage.clientWidth;
  const H = el.clockStage.clientHeight;
  if (W < 60 || H < 60) return;

  const cx = W / 2;
  const floorH = clamp(Math.round(H * 0.05), 14, 34);
  const yFloor = H - floorH;

  const rightCount = Math.ceil(n / 2);
  const leftCount  = n - rightCount;
  const perSide    = Math.max(rightCount, leftCount, 1);

  let chosen = null;
  const maxClockH = yFloor - 6;
  for (let ch = maxClockH; ch >= 150; ch -= 6) {
    const cw     = ch / CLOCK_RATIO;
    const bandW  = (W - cw) / 2 - 2 * GAP;
    if (bandW < MIN_TILE) continue;
    const clockTop = yFloor - ch;
    const colTop   = clockTop + ch * 0.13;     // start at the clock's shoulder
    const colSpan  = (yFloor - 4) - colTop;
    if (colSpan < MIN_TILE) continue;
    const tileByBand = Math.min(bandW * 0.94, 180);
    const tileByCol  = (colSpan - (perSide - 1) * GAP) / perSide;
    const tile = Math.min(tileByBand, tileByCol, 180);
    if (tile < MIN_TILE) continue;
    // Leave headroom so the climber perched on the crown isn't clipped.
    if (clockTop < tile * 0.85 + 6) continue;
    chosen = { ch, cw, clockTop, tile, bandW, colTop, colSpan };
    break;
  }

  if (!chosen) {
    const tile = MIN_TILE;
    const ch   = clamp(yFloor - (tile * 0.85 + 6), 150, maxClockH);
    const cw   = ch / CLOCK_RATIO;
    const clockTop = yFloor - ch;
    const colTop   = clockTop + ch * 0.13;
    chosen = {
      ch, cw, clockTop, tile,
      bandW: Math.max(MIN_TILE, (W - cw) / 2 - 2 * GAP),
      colTop, colSpan: Math.max(tile, (yFloor - 4) - colTop),
    };
  }

  const { ch, cw, clockTop, tile, bandW, colTop, colSpan } = chosen;

  el.clockStage.style.setProperty('--clock-h', `${Math.round(ch)}px`);
  el.clockStage.style.setProperty('--clock-w', `${Math.round(cw)}px`);
  el.clockStage.style.setProperty('--tile-sz', `${Math.round(tile)}px`);
  el.clockStage.style.setProperty('--floor-h', `${floorH}px`);

  const clock = el.clockStage.querySelector('.clock');
  if (clock) {
    clock.style.left = `${cx}px`;
    clock.style.top  = `${clockTop}px`;
  }

  // Place a vertical fan of tiles on one side.
  const place = (count, side, startIdx, positions) => {
    for (let k = 0; k < count; k++) {
      const frac = count > 1 ? k / (count - 1) : 0;          // 0 = floor, 1 = shoulder
      const y = (yFloor - tile / 2 - 2) - frac * (colSpan - tile);
      const edgeX = cx + side * (cw / 2 + GAP + tile / 2);
      const bow = (bandW - tile) * 0.5 * Math.sin(frac * Math.PI);
      let x = edgeX + side * bow;
      x = clamp(x, tile / 2 + 4, W - tile / 2 - 4);
      positions[startIdx + k] = { x, y, side };
    }
  };

  const positions = new Array(n);
  place(rightCount, +1, 0, positions);
  place(leftCount,  -1, rightCount, positions);

  el.clockStage.querySelectorAll('.slot').forEach(slot => {
    const i = parseInt(slot.dataset.index, 10);
    const p = positions[i];
    slot.style.width  = `${Math.round(tile)}px`;
    slot.style.height = `${Math.round(tile)}px`;
    slot.style.left   = `${p.x}px`;
    slot.style.top    = `${p.y}px`;
  });

  state.geom = {
    cx, cw, ch, clockTop, yFloor, tile, W, H, positions,
  };
}

window.addEventListener('resize', () => { if (!state.resolving && !state.introPlaying) layoutStage(); });
window.addEventListener('orientationchange', () => { if (!state.resolving && !state.introPlaying) layoutStage(); });
if (window.ResizeObserver && el.clockStage) {
  new ResizeObserver(() => { if (!state.resolving && !state.introPlaying) layoutStage(); }).observe(el.clockStage);
}

// ── Song-paced intro ───────────────────────────────────────────────

function runIntro(done) {
  state.introPlaying = true;
  disableTiles();

  const slots = [...el.clockStage.querySelectorAll('.slot')];
  const title = el.clockStage.querySelector('.rhyme-title');

  if (title) requestAnimationFrame(() => title.classList.add('show'));

  // Tiles fade in, in place, staggered across the rhyme.
  const n = slots.length || 1;
  const firstAt = 350;
  const lastAt  = 2350;
  slots.forEach((slot, i) => {
    const t = firstAt + (n > 1 ? (i / (n - 1)) * (lastAt - firstAt) : 0);
    after(t, () => slot.classList.remove('pre-in'));
  });

  // Title lifts off the page, then the target word drops in.
  after(2400, () => { if (title) title.classList.add('leave'); });
  after(2850, () => {
    el.sampleSection.classList.remove('intro-hide');
    requestAnimationFrame(fitSampleWord);
  });
  after(3000, () => {
    if (title) title.remove();
    done();
  });
}

function disableTiles() {
  el.clockStage.querySelectorAll('.slot').forEach(s => { s.style.pointerEvents = 'none'; });
}

function enableTiles() {
  el.clockStage.querySelectorAll('.slot').forEach(s => { s.style.pointerEvents = ''; });
}

// ── Clock hands ────────────────────────────────────────────────────

function setMinuteHand(deg, animate) {
  const h = el.clockStage.querySelector('.hand-minute');
  if (!h) return;
  h.style.transition = animate ? 'transform 1.5s cubic-bezier(.45,.05,.35,1)' : 'none';
  h.style.transform  = `translateX(-50%) rotate(${deg}deg)`;
}

function setHourHandToCurrent(animate) {
  const h = el.clockStage.querySelector('.hand-hour');
  if (!h) return;
  h.style.transition = animate ? 'transform 0.45s cubic-bezier(.34,1.3,.5,1)' : 'none';
  h.style.transform  = `translateX(-50%) rotate(${state.clockHour * 30}deg)`;
}

function advanceHour(animate) {
  state.clockHour = (state.clockHour % 12) + 1;
  setHourHandToCurrent(animate);
}

// ── Tile interaction ───────────────────────────────────────────────

function onTileClick(idx) {
  if (!state.active || state.resolving || state.introPlaying) return;
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

function recordOutcome() {
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
      state.animations        ? 1 : 0,
      state.representErrors   ? 1 : 0,
      state.errorless         ? 1 : 0,
      state.noErrorAnim       ? 1 : 0,
      state.autoPromptEnabled ? 1 : 0,
      state.promptPersists    ? 1 : 0,
      state.promptStyle,
      state.promptDelay ? state.promptDelaySecs : 0,
    ].join('|'),
  });
  return outcome;
}

function onCorrectClick(slot, tile) {
  state.resolving = true;
  if (window.__nooutcoTokens) window.__nooutcoTokens.award();
  disableAllTiles();
  clearPrompt();
  if (state.timerRunning) { pauseTimer(); state.timerAutoPaused = true; }
  clearTimeout(state.autoPromptHandle);
  state.autoPromptHandle = null;

  recordOutcome();

  if (!state.animations) {
    tile.classList.add('chosen');
    el.clockStage.querySelectorAll('.slot').forEach(s => {
      if (s !== slot) s.classList.add('vanish');
    });
    advanceHour(false);
    after(520, showNextBtn);
    return;
  }

  playClimb(slot, tile);
}

/* The mouse drops to the floor, runs to the clock, climbs it as the
   minute hand sweeps to 12, the cuckoo strikes, then it leaps down the
   far side and scampers off.  ≈ 3.7s total. */
function playClimb(slot, tile) {
  const g   = state.geom;
  const idx = parseInt(slot.dataset.index, 10);
  const wrapper = slot.querySelector('.tile-wrapper');
  if (!g || !wrapper) { showNextBtn(); return; }

  // Everything else clears out of the way.
  el.clockStage.querySelectorAll('.slot').forEach(s => {
    if (s !== slot) s.classList.add('vanish');
  });

  const p0   = g.positions[idx] || { x: g.cx, y: g.yFloor, side: 1 };
  const s    = p0.side >= 0 ? 1 : -1;          // climb the side it started on
  const t    = g.tile;
  const floorY   = g.yFloor - t / 2 - 2;
  const sideX    = g.cx + s * (g.cw / 2 - t * 0.12);
  const climbTopY = g.clockTop + t * 0.18;
  const crownX   = g.cx;
  const crownTopY = g.clockTop - t * 0.30;
  const offX     = s > 0 ? -t * 2 : g.W + t * 2;     // run off the far side

  const move = (toX, toY, ms, easing, extra = '') => {
    wrapper.style.transition = `transform ${ms}ms ${easing}`;
    wrapper.style.transform  =
      `translate(${(toX - p0.x).toFixed(1)}px, ${(toY - p0.y).toFixed(1)}px) ${extra}`;
  };

  slot.style.zIndex = '30';
  tile.classList.add('climber');

  // A: drop to the floor
  move(p0.x, floorY, 420, 'cubic-bezier(.5,0,.9,.5)');
  after(420, () => wrapper.classList.add('squash'));
  after(560, () => wrapper.classList.remove('squash'));

  // B: scamper across the floor to the base of the clock
  after(470, () => move(sideX, floorY, 560, 'cubic-bezier(.4,0,.5,1)', 'rotate(0deg)'));

  // C: climb the clock while the minute hand sweeps to 12 (3 turns)
  after(1060, () => {
    move(sideX, climbTopY, 1500, 'cubic-bezier(.45,.05,.4,1)');
    wrapper.classList.add('clinging');
    setMinuteHand(1080, true);              // lands at 12 in 1.5s
  });
  after(2160, () => advanceHour(true));     // hour ticks over, completes ≈ 2560

  // D: reach the very top — the cuckoo strikes (minute hand now on 12)
  after(2560, () => {
    wrapper.classList.remove('clinging');
    move(crownX, crownTopY, 440, 'cubic-bezier(.34,1.4,.5,1)');
    strikeCuckoo();
  });

  // E: leap down the far side and scamper off-screen
  after(3060, () => {
    move(offX, floorY, 740, 'cubic-bezier(.45,0,.75,.5)', 'rotate(' + (s * 26) + 'deg)');
  });
  after(3460, () => { wrapper.style.opacity = '0'; });

  after(3760, showNextBtn);
}

function strikeCuckoo() {
  const clock = el.clockStage.querySelector('.clock');
  const crown = el.clockStage.querySelector('.clock-crown');
  if (clock) {
    clock.classList.add('chiming', 'striking');
    after(900, () => clock.classList.remove('chiming'));
    after(560, () => clock.classList.remove('striking'));   // tile leaps in front again
  }
  if (crown) {
    crown.classList.add('open');
    after(620, () => crown.classList.remove('open'));
  }
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
  if (state.resolving || state.introPlaying) return;
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
