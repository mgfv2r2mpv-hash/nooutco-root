'use strict';

/* ══════════════════════════════════════════════════════════════════
   SNACK QUEST
   A quest wrapper around three discrete-trial tasks (matching,
   receptive, expressive). Our friend is hungry; the learner picks the
   place, then earns his food a trial at a time. Each round he waddles
   closer to the current food; on a delivering round he reaches it.

   Naming rule (non-negotiable): the character is never named. He is
   "our friend" / "he" everywhere a person can see, and `friend` /
   `walker` everywhere in code.

   Schedule maths lives in ../token-board.js and persistence lives in
   ../results-report.js. Neither is reimplemented here - the delivering
   round is whatever `onAward` says it is.
   ══════════════════════════════════════════════════════════════════ */

// ── Content ────────────────────────────────────────────────────────

// `prompt` is the SD the staff member delivers, so it is written the way an SD
// is written: short, positive, and phrased as the action to take rather than as
// a description of the screen. None of the three writes the item's name: the
// receptive target is spoken and shown on its own line beneath the SD, so the
// written line only carries the instruction - and varies it across trials, the
// way a technician would, instead of repeating one fixed carrier phrase.
const RECEPTIVE_SDS = ['Find', 'Touch', 'Where is', 'Look for'];

const TASKS = [
  {
    id: 'matching',
    name: 'Matching',
    desc: 'A picture on top - find the one that matches.',
    glyph: '🧩',
    accent: '#5d8a4a',
    prompt: () => 'Match',
  },
  {
    id: 'receptive',
    name: 'Receptive',
    desc: 'Hear and see the word - find that picture.',
    glyph: '🔤',
    accent: '#4b7ea8',
    // Names no item: the target word is spoken and shown on its own line just
    // below this SD, so printing it here too read as "Find the sad" over "Sad".
    // The carrier phrase varies per trial; the word itself lives in that line.
    prompt: () => pickRandom(RECEPTIVE_SDS),
  },
  {
    id: 'expressive',
    name: 'Expressive',
    desc: 'One picture, no word - the learner says what it is.',
    glyph: '💬',
    accent: '#b8446a',
    prompt: () => 'What is it?',
  },
];

const PLACES = [
  { id: 'playroom',    name: 'Playroom',    desc: 'Cozy rug, toys everywhere.',              ground: 0.905, accent: '#b8446a' },
  { id: 'party',       name: 'Party',       desc: 'Food with friends!',                      ground: 0.925, accent: '#e2913a' },
  { id: 'sky',         name: 'Sky',         desc: 'A magic adventure up in the clouds.',     ground: 0.800, accent: '#6b5bb0' },
  { id: 'countryside', name: 'Countryside', desc: 'Out in the warm fresh air.',              ground: 0.895, accent: '#5d8a4a' },
];

/** Fruit pool; the honey is always appended last and never drawn here. */
const FRUIT = ['apple', 'bananas', 'dates', 'grapes', 'orange', 'watermelon'];
const HONEY = 'honey';

/**
 * Measured alpha bounding boxes, as fractions of the source image. The sprites
 * carry transparent padding, so raw width/height would neither line his feet up
 * with the ground nor make the fruit look consistently sized. Values come from
 * SPEC.md - they are measurements, not guesses, and must not be "tidied".
 */
const BOX = {
  friend:     { x0: 0.2381, x1: 0.7683, y0: 0.0894, y1: 0.9271 },
  apple:      { x0: 0.2500, x1: 0.7396, y0: 0.2292, y1: 0.7526 },
  bananas:    { x0: 0.0703, x1: 0.9401, y0: 0.1693, y1: 0.8307 },
  dates:      { x0: 0.1042, x1: 0.9245, y0: 0.2500, y1: 0.7786 },
  grapes:     { x0: 0.1172, x1: 0.9062, y0: 0.0339, y1: 0.9766 },
  honey:      { x0: 0.1510, x1: 0.9531, y0: 0.0573, y1: 0.9297 },
  orange:     { x0: 0.2188, x1: 0.7812, y0: 0.1563, y1: 0.8437 },
  watermelon: { x0: 0.1302, x1: 0.8542, y0: 0.2813, y1: 0.7760 },
};

const FRIEND_ASPECT = 928 / 1152;   // source sprite w/h
const SCENE_ASPECT  = 1376 / 768;

/** Our friend's rendered image height, as a fraction of the stage height. */
const FRIEND_H_FRAC = 0.46;
/** Target apparent food size (geometric mean of its content box) vs stage height. */
const FOOD_SIZE_FRAC = 0.115;
/**
 * Squarest the stage box is allowed to get. The scene art is 1.79:1, and
 * `object-fit: cover` on a *taller* box crops the sides while leaving the
 * vertical mapping - and therefore the ground line - exact. Growing into spare
 * height that way beats stranding a letterboxed strip in a tall viewport, but
 * cropping past this starts eating the composition.
 */
const STAGE_MIN_ASPECT = 1.35;
const STAGE_MIN_ASPECT_TALL = 1.15;
/** He walks within this horizontal band so he never clips the stage edge. */
const WALK_MIN = 0.13;
const WALK_MAX = 0.87;

/**
 * How long the scene is left alone before the question arrives - long enough to
 * find him, follow his turn, and see which snack has appeared. The snack's own
 * drop-in runs inside this window, so shortening it past the drop would put the
 * card up while the snack was still moving.
 */
const SETTLE_MS = 1150;

const PRAISE = {
  matching: [
    'You matched every single one! Our friend has a whole snack to share now - everything is better together.',
    'Match after match, all the way to the honey. He has plenty to pass around, and that is the best part.',
    'Every picture found its pair, and every snack found our friend. Sharing it makes it taste better.',
  ],
  receptive: [
    'You found every word he needed! Our friend has a snack to share now - everything is better together.',
    'You listened, you looked, you found it. He has enough for everyone, which is exactly how he likes it.',
    'Word by word you filled his basket. Now there is something for him and something to share.',
  ],
  expressive: [
    'You named every one of them! Our friend has a whole snack to share now - everything is better together.',
    'You said them all out loud, and he ate every bite you earned. Better still, there is some left to share.',
    'Your words brought him the whole basket. He is not eating it alone - everything is better together.',
  ],
};

// ── Utilities ──────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Display label for an image path, honouring the manifest override.
 *  Same convention as receptive/game.js. */
function labelFromSrc(src) {
  const override = state.manifest && state.manifest.displayNames && state.manifest.displayNames[src];
  if (typeof override === 'string' && override.trim()) return override;
  const name = src.split('/').pop().replace(/\.[^.]+$/, '');
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function topicDisplayLabel(topic) {
  if (!topic) return '';
  const named = (state.manifest && state.manifest.topicNames) || {};
  if (named[topic]) return named[topic];
  return topic.replace(/^T_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── State ──────────────────────────────────────────────────────────

const state = {
  // Technician settings
  topic: '',
  arraySize: 3,
  speak: true,
  promptsEarn: false,
  targetFilters: {},

  // Discovered stimuli
  manifest: null,
  topicFolders: [],
  topicImages: [],

  // Decks
  sampleDeck: [],
  posDeck: [],

  // Panels
  targetPanelOpen: false,
  extraPanelOpen: false,

  // Quest
  screen: 'task',
  task: null,
  place: null,
  foodTarget: 0,      // how many snacks the party needs - the token goal
  currentFood: '',    // the snack on the stage right now
  collected: [],      // the snacks actually acquired, in order
  fruitBag: [],       // fruits still to be dealt before the bag refills
  lastFruit: '',      // the fruit the bag last dealt, so a refill cannot repeat it
  roundNum: 0,
  questActive: false,
  busy: false,
  awaitingAnswer: false,   // the card is up and a response can be given
  pendingSpeak: '',        // receptive SD, held until the card carrying it is up

  // Sprite positions, as fractions of stage width
  friendX: 0.22,
  foodX: 0.7,
  facing: 1,

  // Current trial
  sampleSrc: '',
  sampleLabel: '',
  tileImages: [],
  correctIdx: 0,
  trialErrors: 0,
  trialPrompted: false,
  trialStart: 0,
  trialToken: 0,

  // Session
  sessionData: [],
  trialNum: 0,

  // Blob URL currently backing the expressive stimulus
  hiddenUrl: null,
};

const el = {
  header: $('app-header'),
  crumbs: $('quest-crumbs'),
  crumbTask: $('crumb-task'),
  crumbPlace: $('crumb-place'),
  selTopic: $('sel-topic'),
  inpSize: $('inp-size'),
  chkSpeak: $('chk-speak'),
  chkPromptsEarn: $('chk-prompts-earn'),
  promptRow: $('prompt-row'),
  btnPrompt: $('btn-prompt'),
  promptFlag: $('prompt-flag'),
  btnTargetsToggle: $('btn-targets-toggle'),
  targetsCount: $('targets-count'),
  targetPanel: $('target-panel'),
  targetPanelBody: $('target-panel-body'),
  targetPanelTopicLbl: $('target-panel-topic-label'),
  btnTargetsAll: $('btn-targets-all'),
  btnTargetsNone: $('btn-targets-none'),
  btnTargetsClose: $('btn-targets-close'),
  btnExtraToggle: $('btn-extra-toggle'),
  extraPanel: $('extra-panel'),
  btnExtraClose: $('btn-extra-close'),

  chkTokenBoard: $('chk-token-board'),
  inpGoalTokens: $('inp-goal-tokens'),
  selScheduleType: $('sel-schedule-type'),
  inpScheduleValue: $('inp-schedule-value'),
  tokenBoard: $('token-board'),

  live: $('quest-live'),
  screens: {
    task: $('screen-task'),
    place: $('screen-place'),
    quest: $('screen-quest'),
    done: $('screen-done'),
  },
  taskTiles: $('task-tiles'),
  placeTiles: $('place-tiles'),
  btnBackToTask: $('btn-back-to-task'),

  stageWrap: $('stage-wrap'),
  stage: $('stage'),
  stageScene: $('stage-scene'),
  walker: $('walker'),
  walkerImg: $('walker-img'),
  food: $('food'),
  foodImg: $('food-img'),
  snackStrip: $('snack-strip'),
  roundPill: $('round-pill'),
  btnAbandon: $('btn-abandon'),

  trialCard: $('trial-card'),
  trialPrompt: $('trial-prompt'),
  trialSample: $('trial-sample'),
  trialGrid: $('trial-grid'),
  scoreRow: $('score-row'),

  doneFinal: $('done-final'),
  doneFood: $('done-food'),
  donePraise: $('done-praise'),
  btnPlayAgain: $('btn-play-again'),
  btnOpenReport: $('btn-open-report'),
  btnClearData: $('btn-clear-data'),
  resultsBody: $('results-body'),
  resultsSummary: $('results-summary'),
};

// ── Settings store ─────────────────────────────────────────────────

const SETTINGS_KEY = 'nooutco.settings.snackQuest';
const RESULTS_KEY = 'nooutco.results.snackQuest';

const SETTINGS_FIELDS = {
  topic:         { type: 'string', default: '' },
  arraySize:     { type: 'int', min: 2, max: 4, default: 3 },
  speak:         { type: 'bool', default: true },
  // For a learner working at a prompted level: a prompt is still recorded as
  // Prompted, but it advances the ratio so prompting does not cost the snack.
  promptsEarn:   { type: 'bool', default: false },
  targetFilters: { type: 'map', default: {} },
  // First-run marker: the token board is this game's quest engine, so it is
  // switched on once, through its own DOM contract, and left under the
  // technician's control from then on.
  tokensSeeded:  { type: 'bool', default: false },
};

const settingsStore = window.NooutcoSettings.defineStore({
  key: SETTINGS_KEY,
  fields: SETTINGS_FIELDS,
});

function loadSettings() {
  const s = settingsStore.initial();
  state.topic = s.topic;
  state.arraySize = s.arraySize;
  state.speak = s.speak;
  state.promptsEarn = s.promptsEarn;
  state.targetFilters = s.targetFilters;
  state.tokensSeeded = s.tokensSeeded;

  el.inpSize.value = state.arraySize;
  el.chkSpeak.checked = state.speak;
  el.chkPromptsEarn.checked = state.promptsEarn;
}

function saveSettings() {
  settingsStore.saveWorking({
    topic: state.topic,
    arraySize: state.arraySize,
    speak: state.speak,
    promptsEarn: state.promptsEarn,
    targetFilters: state.targetFilters,
    tokensSeeded: state.tokensSeeded,
  });
}

// ── Token board ────────────────────────────────────────────────────
// `onAward` fires only when the schedule actually reinforces. That callback IS
// the delivering-round signal: set the flag, call award(), then branch on it.
// No FR/VR arithmetic is written here, by design.

let tokens = null;
let deliveredThisTrial = false;

function initTokens() {
  tokens = window.NooutcoTokens.create({
    namespace: 'snackQuest',
    onAward: () => { deliveredThisTrial = true; },
    onGoal: () => { /* honey collected; the quest finishes on the food count */ },
  });

  // Default the quest engine on the first time this device opens the game.
  // Done through the canonical controls so token-board.js owns its own state.
  if (!state.tokensSeeded) {
    state.tokensSeeded = true;
    if (!el.chkTokenBoard.checked) {
      el.chkTokenBoard.checked = true;
      el.chkTokenBoard.dispatchEvent(new Event('change'));
    }
    el.inpGoalTokens.value = '5';
    el.inpGoalTokens.dispatchEvent(new Event('change'));
    saveSettings();
  }

  // Constrain the schedule to the clinical range the brief asks for:
  // FR 1-5, VR 2-5. token-board.js allows 1-100; the game narrows it.
  const applyScheduleRange = () => {
    const isVR = el.selScheduleType.value === 'VR';
    const min = isVR ? 2 : 1;
    el.inpScheduleValue.min = String(min);
    el.inpScheduleValue.max = '5';
    const v = clamp(parseInt(el.inpScheduleValue.value, 10) || min, min, 5);
    if (String(v) !== el.inpScheduleValue.value) {
      el.inpScheduleValue.value = String(v);
      el.inpScheduleValue.dispatchEvent(new Event('change'));
    }
  };
  el.selScheduleType.addEventListener('change', applyScheduleRange);
  el.inpScheduleValue.addEventListener('change', applyScheduleRange);
  applyScheduleRange();
}

function tokenCfg() {
  return tokens ? tokens.getConfig() : { goalTokens: 5, startingTokens: 0, scheduleValue: 1 };
}

/** How many food items this quest lays out: the tokens still to be earned. */
function foodCount() {
  const cfg = tokenCfg();
  return Math.max(1, (cfg.goalTokens || 5) - (cfg.startingTokens || 0));
}

// ── Boot ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  if (window.NooutcoConfig) NooutcoConfig.migrate();
  loadSettings();
  restoreTrials();
  buildTaskTiles();
  buildPlaceTiles();
  bindEvents();
  initTokens();
  await discoverTopics();
  showScreen('task');
});

// ── Stimulus discovery ─────────────────────────────────────────────
// The topic libraries are shared; this game borrows the receptive manifest
// rather than copying any image library. Manifest entries are absolute
// (/shared/stimuli/img/...), so they resolve from this directory unchanged.

async function discoverTopics() {
  try {
    const r = await fetch('../receptive/manifest.json');
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data.folders) && data.folders.length) {
        state.manifest = data;
        state.topicFolders = data.folders;
      }
    }
  } catch (err) {
    console.warn('Snack Quest: could not load the shared topic manifest.', err);
  }

  buildTopicDropdown();

  if (state.topicFolders.length) {
    state.topic = state.topicFolders.includes(state.topic) ? state.topic : state.topicFolders[0];
    el.selTopic.value = state.topic;
    refreshImages();
  }
  updateTargetsCount();
}

function buildTopicDropdown() {
  el.selTopic.innerHTML = '';
  if (!state.topicFolders.length) {
    el.selTopic.innerHTML = '<option value="">-- no topics found --</option>';
    return;
  }
  state.topicFolders.forEach((folder) => {
    const o = document.createElement('option');
    o.value = folder;
    o.textContent = topicDisplayLabel(folder);
    el.selTopic.appendChild(o);
  });
}

function refreshImages() {
  const images = (state.manifest && state.manifest.images) || {};
  state.topicImages = images[state.topic] || [];
  state.sampleDeck = [];
  state.posDeck = [];
}

function eligibleSamples() {
  const filter = state.targetFilters[state.topic] || [];
  if (!filter.length) return state.topicImages;
  const set = new Set(filter);
  return state.topicImages.filter((src) => set.has(src));
}

function nextSample() {
  if (!state.sampleDeck.length) {
    const pool = eligibleSamples();
    if (!pool.length) return null;
    state.sampleDeck = shuffle(pool.slice());
  }
  return state.sampleDeck.pop();
}

function nextPosition(n) {
  if (!state.posDeck.length || state.posDeck.some((i) => i >= n)) {
    state.posDeck = shuffle(Array.from({ length: n }, (_, i) => i));
  }
  return state.posDeck.pop();
}

// ── Screens ────────────────────────────────────────────────────────

function showScreen(name) {
  state.screen = name;
  Object.entries(el.screens).forEach(([key, node]) => {
    if (key === name) node.removeAttribute('hidden');
    else node.setAttribute('hidden', '');
  });
  const inQuest = name === 'quest';
  const inPlay = inQuest || name === 'done';
  el.crumbs.hidden = !inPlay;
  // The board is the quest's progress meter, so it only belongs on screens
  // where a quest is running or has just finished - an empty "0 / 5" strip
  // above the task tiles is noise.
  el.tokenBoard.hidden = !inPlay || !(tokens && tokens.isEnabled());
  document.body.classList.toggle('settings-collapsed', inQuest);
  if (inQuest) layoutStage();
}

function buildTaskTiles() {
  el.taskTiles.innerHTML = '';
  TASKS.forEach((task) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice-tile';
    btn.dataset.task = task.id;
    btn.style.setProperty('--tile-accent', task.accent);
    btn.innerHTML =
      `<span class="choice-tile-glyph" aria-hidden="true">${task.glyph}</span>` +
      '<span class="choice-tile-body">' +
      `<span class="choice-tile-name">${task.name}</span>` +
      `<span class="choice-tile-desc">${task.desc}</span>` +
      '</span>';
    btn.addEventListener('click', () => {
      state.task = task;
      el.crumbTask.textContent = task.name;
      showScreen('place');
    });
    el.taskTiles.appendChild(btn);
  });
}

function buildPlaceTiles() {
  el.placeTiles.innerHTML = '';
  PLACES.forEach((place) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice-tile';
    btn.dataset.place = place.id;
    btn.style.setProperty('--tile-accent', place.accent);
    btn.innerHTML =
      `<span class="choice-tile-art"><img src="assets/scenes/${place.id}.webp" alt="" width="1376" height="768" loading="lazy" decoding="async"></span>` +
      '<span class="choice-tile-body">' +
      `<span class="choice-tile-name">${place.name}</span>` +
      `<span class="choice-tile-desc">${place.desc}</span>` +
      '</span>';
    btn.addEventListener('click', () => startQuest(place));
    el.placeTiles.appendChild(btn);
  });
}

// ── Stage layout ───────────────────────────────────────────────────
// The stage box, the ground line and both sprite anchors are computed in one
// place from the measured content boxes, so a resize can never desync them.

const layout = {
  w: 0, h: 0,
  ground: 0,
  friendW: 0, friendH: 0,
  foodW: 0, foodH: 0,
};

function layoutStage() {
  const wrap = el.stageWrap;
  if (!wrap) return;
  const availW = wrap.clientWidth;
  const availH = wrap.clientHeight;
  if (availW <= 0 || availH <= 0) return;

  // A portrait viewport has height to spare and no width to lose, so it is
  // allowed to crop the scene harder than a landscape one.
  const minAspect = availH > availW ? STAGE_MIN_ASPECT_TALL : STAGE_MIN_ASPECT;
  let w = availW;
  let h = w / SCENE_ASPECT;
  if (h > availH) h = availH;              // never wider than the art: that
  w = Math.min(w, h * SCENE_ASPECT);       // would crop vertically and move
  h = Math.min(availH, w / minAspect);     // the ground line

  layout.w = Math.floor(w);
  layout.h = Math.floor(h);
  el.stage.style.width = layout.w + 'px';
  el.stage.style.height = layout.h + 'px';

  const place = state.place || PLACES[0];
  layout.ground = layout.h * place.ground;

  layout.friendH = layout.h * FRIEND_H_FRAC;
  layout.friendW = layout.friendH * FRIEND_ASPECT;
  el.walker.style.width = layout.friendW + 'px';

  sizeFood();
  placeWalker(false);
  placeFood();
  layoutTrialCard();
}

/** Normalise the food sprite so every item looks about the same size on the
 *  ground: scale by the geometric mean of its content box, not the raw image. */
function sizeFood() {
  const key = currentFoodKey();
  if (!key) return;
  const b = BOX[key];
  const contentW = b.x1 - b.x0;
  const contentH = b.y1 - b.y0;
  const target = layout.h * FOOD_SIZE_FRAC;
  const size = target / Math.sqrt(contentW * contentH);
  layout.foodW = size;
  layout.foodH = size;   // the food sources are square
  el.food.style.width = size + 'px';
}

/** Our friend's content-box centre and feet line, in stage pixels. */
function walkerAnchor() {
  const b = BOX.friend;
  const centreFrac = (b.x0 + b.x1) / 2;
  return {
    dx: -layout.friendW * centreFrac,
    dy: -layout.friendH * b.y1,
    halfW: (layout.friendW * (b.x1 - b.x0)) / 2,
  };
}

function foodAnchor() {
  const key = currentFoodKey();
  const b = BOX[key] || BOX.apple;
  const centreFrac = (b.x0 + b.x1) / 2;
  return {
    dx: -layout.foodW * centreFrac,
    dy: -layout.foodH * b.y1,
    halfW: (layout.foodW * (b.x1 - b.x0)) / 2,
  };
}

function placeWalker(animate) {
  const a = walkerAnchor();
  const x = state.friendX * layout.w + a.dx;
  const y = layout.ground + a.dy;
  if (!animate) el.walker.style.transition = 'none';
  el.walker.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  if (!animate) {
    void el.walker.offsetWidth;   // commit the jump before transitions resume
    el.walker.style.transition = '';
  }
  el.walkerImg.style.transform = `scaleX(${state.facing}) rotate(3deg)`;
}

function placeFood() {
  const a = foodAnchor();
  const x = state.foodX * layout.w + a.dx;
  const y = layout.ground + a.dy;
  el.food.style.setProperty('--fx', x + 'px');
  el.food.style.setProperty('--fy', y + 'px');
}

/**
 * Size the trial card's contents to the stage rather than to the viewport. The
 * card is a bottom sheet that hugs its content, so every pixel not spent on
 * chrome is scene the learner can still see while they answer - and the
 * picture, which is the star, takes whatever is left.
 */
const CARD_CHROME = { pad: 42, prompt: 34, gap: 14, score: 122 };
/** Tile frames are 4:3, so a tile's height is this much of its width. */
const PICK_RATIO = 0.78;

function layoutTrialCard() {
  if (!layout.w || !state.task) return;
  const taskId = state.task.id;
  const isExpressive = taskId === 'expressive';
  const cols = Math.max(1, isExpressive ? 1 : state.tileImages.length || 1);
  const gap = 16;

  // The sheet may claim at most this much of the stage; the rest stays scene.
  let budget = layout.h * 0.90
    - CARD_CHROME.pad - CARD_CHROME.prompt - CARD_CHROME.gap * 2
    - (isExpressive ? CARD_CHROME.score : 0);

  let sample = 0;
  if (taskId === 'matching') sample = clamp(layout.h * 0.30, 110, 230);
  else if (taskId === 'receptive') sample = clamp(layout.h * 0.11, 34, 68);
  // The matching sample is a 4:3 frame like the tiles; the receptive one is a
  // single line of type, so `sample` is its font size and its own line height.
  if (sample) budget -= (taskId === 'matching' ? sample * PICK_RATIO : sample * 1.15) + CARD_CHROME.gap;

  const usableW = layout.w * 0.86 - gap * (cols - 1);
  const pick = clamp(
    Math.min(usableW / cols, budget / PICK_RATIO),
    72,
    isExpressive ? 460 : 300
  );

  el.trialGrid.style.setProperty('--cols', cols);
  el.trialGrid.style.setProperty('--pick-sz', Math.floor(pick) + 'px');
  el.trialGrid.querySelectorAll('.pick').forEach((n) => {
    n.style.setProperty('--pick-sz', Math.floor(pick) + 'px');
  });
  el.trialSample.style.setProperty('--sample-sz', Math.floor(sample) + 'px');
}

if (window.ResizeObserver) {
  new ResizeObserver(() => { if (state.screen === 'quest') layoutStage(); }).observe(el.stageWrap);
}
window.addEventListener('resize', () => { if (state.screen === 'quest') layoutStage(); });

// ── Quest ──────────────────────────────────────────────────────────

function currentFoodKey() { return state.currentFood; }

/**
 * The snack for the slot being worked on now - a bag draw.
 *
 * All six fruits go in a bag, are dealt out without replacement, and the bag
 * refills when it empties. The quest still runs to *any* goal, because its
 * length is the token target and never the size of the pool - dealing one fixed
 * hand of `slice(0, n - 1)` was the bug that silently capped an eight-token
 * quest at seven, leaving the goal unreachable and a field of one giving the
 * answer away once the pool ran dry.
 *
 * Why a bag rather than an independent draw. The independent draw it replaces
 * was genuinely random, and measured as such: 175 draws came out at 12.6-20.6%
 * per fruit against 16.7% expected, with adjacent repeats at 12.7% against
 * 16.7%. It was not broken - it *clumped*, because that is what independence
 * does, and `watermelon, watermelon, dates, dates` is what a learner sees when
 * it does. Even spread is the better teaching behaviour, bought at the price of
 * the last fruits in a bag being predictable.
 *
 * The refill re-draws when the new bag would open on the fruit the old one
 * closed with. That seam is the only place a bag can still repeat back to back,
 * and not repeating back to back is precisely what the bag is for. With six
 * fruits a reshuffle always has an alternative, so the loop cannot spin.
 *
 * The honey is the last slot and only the last slot. Asking for it by position
 * rather than storing it in a plan means it survives a snack falling away: a
 * failed final round redraws the honey, it does not demote it to a fruit.
 */
function drawFood() {
  if (state.collected.length >= state.foodTarget - 1) return HONEY;
  if (!state.fruitBag.length) {
    do {
      state.fruitBag = shuffle(FRUIT.slice());
    } while (state.lastFruit && state.fruitBag[state.fruitBag.length - 1] === state.lastFruit);
  }
  state.lastFruit = state.fruitBag.pop();
  return state.lastFruit;
}

function startQuest(place) {
  if (!state.topicImages.length) {
    alert('No pictures found for this topic. Pick another topic in the settings bar.');
    return;
  }
  if (!eligibleSamples().length) {
    alert('No targets selected. Open the Targets panel and pick at least one picture.');
    return;
  }

  state.place = place;
  el.crumbPlace.textContent = place.name;
  el.stageScene.src = `assets/scenes/${place.id}.webp`;

  state.foodTarget = foodCount();
  state.collected = [];
  // A fresh bag per quest - a new quest should not inherit half a bag, or its
  // opening fruits would be constrained by a quest the learner already finished.
  state.fruitBag = [];
  state.lastFruit = '';
  state.currentFood = drawFood();
  state.roundNum = 0;
  state.questActive = true;
  state.sampleDeck = [];
  state.posDeck = [];
  state.friendX = 0.2;
  state.facing = 1;

  if (tokens) tokens.startSession();
  renderSnackStrip();
  el.food.hidden = false;
  el.food.classList.remove('is-collected');
  el.walker.classList.remove('is-walking', 'is-hopping');

  showScreen('quest');
  requestAnimationFrame(() => {
    layoutStage();
    // The opening snack drops in like every other one. Placing the first one
    // silently would make the quest start with the board already arranged,
    // which is the one moment the learner most needs to watch it being set.
    spawnFood(false);
    beginTrial();
  });
}

/** Drop the current food at a fresh spot, far enough away to be worth walking to. */
function spawnFood(immediate) {
  const key = currentFoodKey();
  if (!key) return;
  el.foodImg.src = `assets/food/${key}.webp`;
  el.food.hidden = false;
  el.food.classList.remove('is-collected');

  let x;
  let guard = 0;
  do {
    x = WALK_MIN + Math.random() * (WALK_MAX - WALK_MIN);
    guard++;
  } while (Math.abs(x - state.friendX) < 0.28 && guard < 20);
  state.foodX = x;

  sizeFood();
  placeFood();
  if (!immediate && !prefersReducedMotion()) {
    el.food.classList.remove('is-appearing');
    void el.food.offsetWidth;
    el.food.classList.add('is-appearing');
  }
  updateRoundPill();
}

function updateRoundPill() {
  const total = state.foodTarget;
  const got = state.collected.length;
  el.roundPill.textContent = `Snack ${Math.min(got + 1, total)} of ${total}`;
}

function announce(msg) { el.live.textContent = msg; }

// ── Trials ─────────────────────────────────────────────────────────

async function beginTrial() {
  if (!state.questActive) return;
  state.roundNum++;
  state.trialErrors = 0;
  state.trialPrompted = false;
  state.trialStart = Date.now();
  state.trialToken++;
  state.awaitingAnswer = false;
  const token = state.trialToken;

  const next = nextSample();
  if (!next) {
    alert('No targets selected. Open the Targets panel and pick at least one picture.');
    endQuest();
    return;
  }
  state.sampleSrc = next;
  state.sampleLabel = labelFromSrc(next);

  buildTrialTiles();
  renderTrial();
  announce(`Round ${state.roundNum}.`);

  // The card covers the scene, so it must not arrive with the scene. The
  // learner watches him and the snack settle first - that is how they learn
  // what they are working toward and where it is - and only then is the
  // question put to them.
  await settleStage();
  if (!state.questActive || state.trialToken !== token) return;
  showTrialCard();
  state.awaitingAnswer = true;
  speakPending();
}

/**
 * Say the receptive SD, now that the card carrying it is on screen.
 *
 * Held until this point on purpose: the spoken SD and the array have to arrive
 * together. A word spoken over a bare scene is an SD with nothing to respond to,
 * and by the time the pictures appear the learner has already heard it and has
 * nothing left to match it against.
 */
function speakPending() {
  const word = state.pendingSpeak;
  state.pendingSpeak = '';
  if (word) speakWord(word);
}

/**
 * The beat between the scene being ready and the question being asked.
 *
 * Without it every round opened with the card already up, so the stage was
 * only ever visible *after* an answer - the learner never saw the snack they
 * were about to earn, and the character they are meant to be helping was
 * behind the tiles the whole time they were deciding.
 *
 * He turns to face the snack during the pause, which reads as him noticing it
 * and gives the beat a reason to exist beyond a delay.
 */
async function settleStage() {
  if (!state.questActive) return;
  if (Math.abs(state.foodX - state.friendX) > 0.005) {
    state.facing = state.foodX > state.friendX ? 1 : -1;
    placeWalker(false);
  }
  await sleep(prefersReducedMotion() ? 260 : SETTLE_MS);
}

function buildTrialTiles() {
  if (state.task.id === 'expressive') {
    state.tileImages = [];
    state.correctIdx = 0;
    return;
  }
  const n = clamp(state.arraySize, 2, 4);
  const pool = shuffle(state.topicImages.filter((src) => src !== state.sampleSrc));
  const correctPos = nextPosition(n);
  state.correctIdx = correctPos;
  state.tileImages = new Array(n);
  let di = 0;
  for (let i = 0; i < n; i++) {
    if (i === correctPos) state.tileImages[i] = state.sampleSrc;
    else state.tileImages[i] = pool.length ? pool[di++ % pool.length] : state.sampleSrc;
  }
}

function releaseHiddenUrl() {
  if (state.hiddenUrl) {
    URL.revokeObjectURL(state.hiddenUrl);
    state.hiddenUrl = null;
  }
}

/**
 * Expressive mode must not put the target word into the page at all - the
 * learner is meant to *name* the picture, not read it. The filename is part of
 * the word, so the stimulus is served from an object URL and the raw path never
 * reaches an attribute. Falls back to the plain path if the fetch fails; the
 * label is still never rendered either way.
 */
async function setHiddenStimulus(img, src, token) {
  releaseHiddenUrl();
  img.removeAttribute('src');
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error('stimulus fetch failed: ' + res.status);
    const url = URL.createObjectURL(await res.blob());
    if (token !== state.trialToken) { URL.revokeObjectURL(url); return; }
    state.hiddenUrl = url;
    img.src = url;
  } catch (err) {
    if (token !== state.trialToken) return;
    console.warn('Snack Quest: serving the expressive stimulus directly.', err);
    img.src = src;
  }
}

function renderTrial() {
  const task = state.task;
  // The written SD names no target in any mode: receptive shows and speaks its
  // word on a separate line, and expressive rests on the word never reaching the
  // page at all. So this line is only ever the instruction.
  el.trialPrompt.textContent = task.prompt();
  el.trialSample.innerHTML = '';
  el.trialGrid.innerHTML = '';
  el.scoreRow.hidden = task.id !== 'expressive';
  // Matching and receptive are scored by the learner's tap, so a prompt has to
  // be declared before they answer rather than judged after. Expressive already
  // has an explicit Prompted button in its scoring row.
  el.promptRow.hidden = task.id === 'expressive';
  el.btnPrompt.disabled = false;
  el.promptFlag.hidden = true;
  // The scoring buttons are static markup, so the previous trial's disable has
  // to be lifted here; the picture tiles are rebuilt and start enabled.
  el.scoreRow.querySelectorAll('.score-btn').forEach((b) => { b.disabled = false; });

  if (task.id === 'receptive') {
    el.trialSample.hidden = false;
    const word = document.createElement('div');
    word.className = 'sample-word';
    word.textContent = state.sampleLabel;
    el.trialSample.appendChild(word);
    // Queued, not spoken. The trial is built before the settle beat, so
    // speaking here would say the word at a scene the learner is still reading,
    // with no card and no pictures to attach it to - an SD delivered to an
    // empty array. It is spoken when the card carrying it is actually up.
    state.pendingSpeak = state.speak ? state.sampleLabel : '';
  } else if (task.id === 'matching') {
    el.trialSample.hidden = false;
    const pic = document.createElement('img');
    pic.className = 'sample-pic';
    pic.src = state.sampleSrc;
    pic.alt = 'The picture to match';
    pic.decoding = 'async';
    el.trialSample.appendChild(pic);
  } else {
    // Expressive: field of one, and the word appears nowhere.
    el.trialSample.hidden = true;
    const pic = document.createElement('img');
    pic.className = 'sample-pic';
    pic.alt = 'A picture to name';
    pic.decoding = 'async';
    const wrap = document.createElement('div');
    wrap.className = 'pick pick-solo';
    wrap.appendChild(pic);
    el.trialGrid.appendChild(wrap);
    setHiddenStimulus(pic, state.sampleSrc, state.trialToken);
  }

  state.tileImages.forEach((src, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pick';
    btn.dataset.index = String(idx);
    btn.setAttribute('aria-label', `Choice ${idx + 1}`);
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.decoding = 'async';
    const fallback = document.createElement('span');
    fallback.className = 'pick-fallback';
    fallback.textContent = `Choice ${idx + 1}`;
    img.addEventListener('error', () => { img.remove(); fallback.classList.add('is-visible'); });
    btn.appendChild(img);
    btn.appendChild(fallback);
    btn.addEventListener('click', () => onPick(idx));
    el.trialGrid.appendChild(btn);
  });

  layoutTrialCard();
}

function speakWord(word) {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch (_) { /* speech is a nicety, never a blocker */ }
}

function showTrialCard() {
  el.trialCard.hidden = false;
  el.trialCard.classList.remove('is-leaving');
  el.trialCard.classList.add('is-entering');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.trialCard.classList.remove('is-entering'));
  });
  const first = el.trialCard.querySelector('.pick:not(.pick-solo), .score-btn');
  if (first) setTimeout(() => first.focus({ preventScroll: true }), 260);
}

async function hideTrialCard() {
  el.trialCard.classList.add('is-leaving');
  await sleep(prefersReducedMotion() ? 170 : 320);
  el.trialCard.hidden = true;
  el.trialCard.classList.remove('is-leaving');
}

// ── Responses ──────────────────────────────────────────────────────

function onPick(idx) {
  if (state.busy || !state.questActive) return;
  if (idx === state.correctIdx) {
    const btn = el.trialGrid.querySelector(`.pick[data-index="${idx}"]`);
    if (btn) btn.classList.add('is-right');
    finishTrial(state.trialErrors > 0 ? 'Error' : 'Correct');
    return;
  }
  state.trialErrors++;
  const btn = el.trialGrid.querySelector(`.pick[data-index="${idx}"]`);
  if (btn) {
    btn.classList.remove('is-wrong');
    void btn.offsetWidth;
    btn.classList.add('is-wrong');
  }
  // Correction: show which one it was, and let the learner take it.
  const right = el.trialGrid.querySelector(`.pick[data-index="${state.correctIdx}"]`);
  if (right) right.classList.add('is-right');
}

function onScore(kind) {
  if (state.busy || !state.questActive) return;
  if (kind === 'prompted') state.trialPrompted = true;
  if (kind === 'incorrect') state.trialErrors = 1;
  finishTrial(kind === 'correct' ? 'Correct' : kind === 'prompted' ? 'Prompted' : 'Error');
}

async function finishTrial(outcome) {
  state.busy = true;
  state.awaitingAnswer = false;
  el.trialGrid.querySelectorAll('.pick').forEach((b) => { b.disabled = true; });
  el.scoreRow.querySelectorAll('.score-btn').forEach((b) => { b.disabled = true; });

  recordTrial(outcome);

  // `award()` decides whether this round delivers; `onAward` flips the flag.
  // A prompted response advances the ratio only when the technician has said
  // prompts count for this learner. Either way it stays 'Prompted' in the data:
  // the setting changes what a prompt costs, never what is recorded about it.
  const earns = outcome === 'Correct' || (outcome === 'Prompted' && state.promptsEarn);

  deliveredThisTrial = false;
  if (earns) {
    if (tokens && tokens.isEnabled()) tokens.award();
    else deliveredThisTrial = true;   // no board: every earning round delivers
  }
  const delivering = deliveredThisTrial;

  // Every non-delivering round still walks - he is never made to stand still - // but only a delivering round may arrive. `walk('partway')` is capped short of
  // the food, so no run of errors can creep him onto it.
  const mode = delivering ? 'arrive' : 'partway';

  // An error is likelier to end in a tumble than a merely unreinforced round,
  // but neither is certain - a guaranteed fall on every error would just be a
  // slower way of punishing one.
  const tumbleChance = outcome === 'Error' ? 0.4 : 0.12;

  await sleep(prefersReducedMotion() ? 120 : 420);
  await hideTrialCard();
  await walk(mode, tumbleChance);

  if (delivering) {
    await collectFood();
    if (state.collected.length >= state.foodTarget) { finishQuest(); return; }
    state.currentFood = drawFood();
    spawnFood(false);
    await sleep(prefersReducedMotion() ? 60 : 320);
  } else if (outcome === 'Error') {
    // A wrong answer costs him this snack: it drops away and a fresh one is
    // drawn somewhere else. He keeps everything already collected - the strip
    // never loses a slot - so the cost is the trip, not the progress.
    await dropFood();
    state.currentFood = drawFood();
    spawnFood(false);
    announce('That one got away. Here comes another.');
    await sleep(prefersReducedMotion() ? 60 : 260);
  } else {
    announce('He is getting closer.');
    await sleep(prefersReducedMotion() ? 60 : 220);
  }

  state.busy = false;
  beginTrial();
}

/** How close a non-delivering round may bring him to the food, as a fraction of
 *  stage width. Arrival is what a reinforced round buys, so every other round
 *  stops short of this line however many of them run. */
const STANDOFF = 0.07;

/** Move him one leg, and wait out the transition. */
async function moveTo(targetX, tumbling) {
  const distFrac = Math.abs(targetX - state.friendX);
  if (distFrac > 0.005) state.facing = targetX > state.friendX ? 1 : -1;
  state.friendX = targetX;

  // The floor is two full waddle cycles (sq-waddle is 380ms), not one. A short
  // partway step used to clamp to ~420ms, which cut the waddle off mid-stride
  // and read as a twitch rather than a walk - the learner is meant to enjoy
  // watching him go, so a small step still gets time to look like walking.
  const floor = tumbling ? 380 : 760;
  const ms = prefersReducedMotion() ? 240 : clamp(distFrac * 2600, floor, 1500);
  el.walker.style.setProperty('--sq-walk-ms', ms + 'ms');
  el.walker.classList.add('is-walking');
  placeWalker(true);
  await sleep(ms + 40);
  el.walker.classList.remove('is-walking');
}

/** A tumble and a get-up, mid-walk. Costs him no ground - he lands where he
 *  fell - so it reads as effort rather than as a penalty on top of one. */
async function tumble() {
  if (prefersReducedMotion()) return;
  el.walker.classList.add('is-tumbling');
  await sleep(950);
  el.walker.classList.remove('is-tumbling');
  await sleep(80);
}

/** Move our friend toward the food.
 *
 *  'arrive' - a delivering round: he closes the remaining distance.
 *  'partway' - every other round: he covers ground but stops short of the food.
 *
 *  Only a reinforced round may arrive. A non-delivering round is capped at the
 *  STANDOFF line, so a run of errors can never creep him onto the snack and
 *  "he got there" keeps meaning what it says.
 *
 *  `tumbleChance` gives a non-delivering round some odds of a fall on the way.
 *  He still gets where that round was going, so a tumble is character, not an
 *  extra cost - stillness and lost ground are both off the table as feedback. */
async function walk(mode, tumbleChance = 0) {
  const arrive = mode === 'arrive';
  const anchorF = foodAnchor();
  const anchorW = walkerAnchor();
  const gapFrac = (anchorF.halfW + anchorW.halfW * 0.75) / layout.w;
  const dir = state.foodX >= state.friendX ? 1 : -1;
  const arriveX = clamp(state.foodX - dir * gapFrac, WALK_MIN, WALK_MAX);

  let targetX;
  if (arrive) {
    targetX = arriveX;
  } else {
    // ~1/n of the remaining distance, n taken from the configured ratio.
    const n = Math.max(2, tokenCfg().scheduleValue || 2);
    const remaining = arriveX - state.friendX;
    const sign = remaining >= 0 ? 1 : -1;
    const cap = arriveX - sign * STANDOFF;
    const step = state.friendX + remaining / n;
    targetX = sign > 0 ? Math.min(step, cap) : Math.max(step, cap);
    // Already at or past the stand-off: hold rather than sliding backwards.
    if (sign > 0 && targetX < state.friendX) targetX = state.friendX;
    if (sign < 0 && targetX > state.friendX) targetX = state.friendX;
  }

  const falls = !arrive && tumbleChance > 0 && Math.random() < tumbleChance;
  if (!falls) {
    await moveTo(targetX, false);
    return;
  }

  // Set off, go down partway, get up, finish the leg.
  const mid = state.friendX + (targetX - state.friendX) * 0.55;
  await moveTo(mid, true);
  await tumble();
  await moveTo(targetX, true);
}

async function collectFood() {
  const key = currentFoodKey();
  el.walker.classList.add('is-hopping');
  await sleep(prefersReducedMotion() ? 60 : 280);
  el.food.classList.add('is-collected');
  await sleep(prefersReducedMotion() ? 120 : 420);
  el.walker.classList.remove('is-hopping');
  el.food.hidden = true;

  state.collected.push(key);
  renderSnackStrip(true);
  announce(key === HONEY ? 'He got the honey!' : 'He got the snack!');
  updateRoundPill();
}

/** The snack drops away after a wrong answer. Visible, and quick - the learner
 *  should see *this* one leave so the next one reads as a fresh chance rather
 *  than as the same snack teleporting. */
async function dropFood() {
  if (el.food.hidden) return;
  el.food.classList.add('is-dropping');
  await sleep(prefersReducedMotion() ? 80 : 420);
  el.food.hidden = true;
  el.food.classList.remove('is-dropping');
}

/**
 * The snack strip IS the token board. The tokens in this game are the snacks
 * themselves - he is getting ready for the party, and the quest is done when he
 * has as many as the goal asks for - so the strip draws one slot per snack the
 * party needs: the ones already collected, and a waiting slot for each still to
 * come. A generic star tally alongside it would be a second, competing count of
 * the same thing, which is why the shared emoji display is hidden on this game.
 *
 * Filled slots show the snack *actually* acquired, which is why they read from
 * `collected` rather than from any plan - under a variable-ratio schedule the
 * snacks arrive on trials nobody can name in advance, and only the ones he
 * really got belong on the board.
 */
function renderSnackStrip(landed = false) {
  const strip = el.snackStrip;
  strip.innerHTML = '';
  for (let i = 0; i < state.foodTarget; i++) {
    const got = i < state.collected.length;
    const isLast = i === state.foodTarget - 1;
    const slot = document.createElement('span');
    slot.className = 'snack-slot';
    if (got) slot.classList.add('is-got');
    if (got) {
      const img = document.createElement('img');
      img.src = `assets/food/${state.collected[i]}.webp`;
      img.alt = '';
      img.width = 28;
      img.height = 28;
      if (landed && i === state.collected.length - 1) img.className = 'just-landed';
      slot.appendChild(img);
    } else if (isLast) {
      // The honey is always the last snack, so the final slot can show what it
      // is waiting for. It gives the strip a destination to read toward.
      slot.classList.add('is-honey-slot');
      const img = document.createElement('img');
      img.src = `assets/food/${HONEY}.webp`;
      img.alt = '';
      img.width = 28;
      img.height = 28;
      slot.appendChild(img);
    }
    strip.appendChild(slot);
  }
  strip.setAttribute('aria-label', `${state.collected.length} of ${state.foodTarget} snacks collected`);
}

// ── Trial records ──────────────────────────────────────────────────

function recordTrial(outcome) {
  state.trialNum++;
  const row = {
    trial: state.trialNum,
    task: state.task.name,
    place: state.place.name,
    topic: topicDisplayLabel(state.topic),
    target: state.sampleLabel,
    arraySize: state.task.id === 'expressive' ? 1 : state.tileImages.length,
    errors: state.trialErrors,
    prompted: state.trialPrompted,
    time: ((Date.now() - state.trialStart) / 1000).toFixed(1),
    outcome,
  };
  if (window.NooutcoResults) {
    NooutcoResults.record(RESULTS_KEY, state.sessionData, row,
      { autoPrompt: false, promptDelay: false }, state.trialPrompted);
  } else {
    state.sessionData.push(row);
  }
}

function restoreTrials() {
  if (!window.NooutcoResults) return;
  const rows = NooutcoResults.load(RESULTS_KEY);
  if (!Array.isArray(rows) || !rows.length) return;
  state.sessionData = rows;
  state.trialNum = rows.reduce((m, d) => Math.max(m, Number(d.trial) || 0), 0);
}

// ── Finish ─────────────────────────────────────────────────────────

function finishQuest() {
  state.questActive = false;
  state.busy = false;
  releaseHiddenUrl();

  const place = state.place;
  el.doneFinal.src = `assets/finals/${place.id}.webp`;
  el.donePraise.textContent = pickRandom(PRAISE[state.task.id] || PRAISE.matching);
  renderDoneFood();
  renderResults();
  showScreen('done');
  announce('Quest complete.');
}

/** Composite the collected food in front of the portrait artwork, scattered
 *  across the foreground so it reads as "he brought all of this back". */
function renderDoneFood() {
  el.doneFood.innerHTML = '';
  const items = state.collected;
  const n = items.length;
  items.forEach((key, i) => {
    const b = BOX[key];
    const img = document.createElement('img');
    img.src = `assets/food/${key}.webp`;
    img.alt = '';
    img.decoding = 'async';
    // Same geometric-mean normalisation as the stage, expressed in % of the
    // portrait width so the composite scales with the artwork.
    const size = 22 / Math.sqrt((b.x1 - b.x0) * (b.y1 - b.y0));
    const t = n === 1 ? 0.5 : i / (n - 1);
    // Spread by the item's own width so the widest sprite still lands inside
    // the frame - the honey is the largest and always last, i.e. furthest right.
    const left = 5 + t * Math.max(0, 95 - size - 5);
    const bottom = 4 + (i % 2 === 0 ? 0 : 7);
    img.style.width = size + '%';
    img.style.left = left + '%';
    img.style.bottom = bottom + '%';
    img.style.setProperty('--tilt', (i % 2 === 0 ? -6 : 6) + 'deg');
    img.style.animationDelay = (i * 90) + 'ms';
    el.doneFood.appendChild(img);
  });
}

function endQuest() {
  state.questActive = false;
  state.busy = false;
  releaseHiddenUrl();
  el.trialCard.hidden = true;
  renderResults();
  showScreen('task');
}

// ── Results ────────────────────────────────────────────────────────

const RESULT_COLUMNS = [
  { label: '#', key: 'trial' },
  { label: 'Task', key: 'task' },
  { label: 'Place', key: 'place' },
  { label: 'Topic', key: 'topic' },
  { label: 'Target', key: 'target' },
  { label: 'Array', key: 'arraySize' },
  { label: 'Time (s)', key: 'time' },
  { label: 'Outcome', key: 'outcome', cls: outcomeClass },
];

function outcomeClass(row) {
  if (row.outcome === 'Correct') return 'outcome-ok';
  if (row.outcome === 'Prompted') return 'outcome-prompted';
  return 'outcome-error';
}

function renderResults() {
  el.resultsBody.innerHTML = '';
  state.sessionData.forEach((d) => {
    const tr = document.createElement('tr');
    RESULT_COLUMNS.forEach((c) => {
      const td = document.createElement('td');
      td.textContent = d[c.key] == null ? '' : String(d[c.key]);
      if (c.cls) td.className = c.cls(d);
      tr.appendChild(td);
    });
    el.resultsBody.appendChild(tr);
  });

  const total = state.sessionData.length;
  const count = (o) => state.sessionData.filter((d) => d.outcome === o).length;
  el.resultsSummary.innerHTML = total
    ? `<span>Trials <strong>${total}</strong></span>` +
      `<span>Correct <strong>${count('Correct')}</strong></span>` +
      `<span>Prompted <strong>${count('Prompted')}</strong></span>` +
      `<span>Incorrect <strong>${count('Error')}</strong></span>`
    : '<span>No trials recorded yet.</span>';
}

function openReport() {
  if (!state.sessionData.length) { alert('No trial data yet.'); return; }
  const now = new Date();
  const count = (o) => state.sessionData.filter((d) => d.outcome === o).length;
  NooutcoResults.open({
    title: 'Snack Quest - Session Results',
    meta: `Printed ${now.toLocaleDateString()} at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    columns: RESULT_COLUMNS,
    rows: state.sessionData,
    summary: [
      { label: 'Trials', value: state.sessionData.length },
      { label: 'Correct', value: count('Correct') },
      { label: 'Prompted', value: count('Prompted') },
      { label: 'Incorrect', value: count('Error') },
    ],
  });
}

// ── Panels ─────────────────────────────────────────────────────────

function setTargetPanelOpen(open) {
  state.targetPanelOpen = open;
  el.btnTargetsToggle.setAttribute('aria-expanded', String(open));
  el.btnTargetsToggle.classList.toggle('is-open', open);
  if (open) {
    el.targetPanel.removeAttribute('hidden');
    renderTargetPanel();
  } else {
    el.targetPanel.setAttribute('hidden', '');
    // Cleared, not just hidden: the panel lists every label in the topic,
    // including the current target. Leaving it parked in the DOM would put the
    // answer back on the page during an expressive trial.
    el.targetPanelBody.innerHTML = '';
  }
}

function renderTargetPanel() {
  el.targetPanelTopicLbl.textContent = topicDisplayLabel(state.topic);
  const body = el.targetPanelBody;
  body.innerHTML = '';
  if (!state.topic || !state.topicImages.length) {
    body.innerHTML = '<p class="target-panel-empty">No pictures for this topic.</p>';
    return;
  }
  const filter = new Set(state.targetFilters[state.topic] || []);
  state.topicImages.forEach((src) => {
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
    thumb.addEventListener('error', () => { thumb.remove(); thumbLbl.classList.add('target-thumb-label-visible'); });

    const label = document.createElement('span');
    label.className = 'target-row-label';
    label.textContent = labelFromSrc(src);

    row.append(cb, thumb, thumbLbl, label);
    body.appendChild(row);
  });
}

function onTargetCheckboxChange() {
  const checked = [];
  el.targetPanelBody.querySelectorAll('input[type="checkbox"][data-src]')
    .forEach((cb) => { if (cb.checked) checked.push(cb.dataset.src); });
  state.targetFilters[state.topic] = checked.length === state.topicImages.length ? [] : checked;
  state.sampleDeck = [];
  saveSettings();
  updateTargetsCount();
}

function setAllTargets(checked) {
  el.targetPanelBody.querySelectorAll('input[type="checkbox"][data-src]')
    .forEach((cb) => { cb.checked = checked; });
  onTargetCheckboxChange();
}

function updateTargetsCount() {
  const total = state.topicImages.length;
  const filter = state.targetFilters[state.topic] || [];
  el.targetsCount.textContent = `${filter.length ? filter.length : total} of ${total}`;
  el.btnTargetsToggle.classList.toggle('is-filtered', filter.length > 0);
}

function setExtraPanelOpen(open) {
  state.extraPanelOpen = open;
  el.btnExtraToggle.setAttribute('aria-expanded', String(open));
  el.btnExtraToggle.classList.toggle('is-open', open);
  if (open) el.extraPanel.removeAttribute('hidden');
  else el.extraPanel.setAttribute('hidden', '');
}

// ── Events ─────────────────────────────────────────────────────────

function bindEvents() {
  el.selTopic.addEventListener('change', () => {
    state.topic = el.selTopic.value;
    saveSettings();
    refreshImages();
    if (state.targetPanelOpen) renderTargetPanel();
    updateTargetsCount();
  });

  el.inpSize.addEventListener('change', () => {
    const v = clamp(parseInt(el.inpSize.value, 10) || 3, 2, 4);
    state.arraySize = v;
    el.inpSize.value = String(v);
    state.posDeck = [];
    saveSettings();
  });

  el.chkSpeak.addEventListener('change', () => {
    state.speak = el.chkSpeak.checked;
    saveSettings();
  });

  el.chkPromptsEarn.addEventListener('change', () => {
    state.promptsEarn = el.chkPromptsEarn.checked;
    saveSettings();
  });

  // Declaring a prompt marks the trial and shows which picture is correct, so
  // the learner still completes the trial with help rather than being told the
  // answer after the fact.
  el.btnPrompt.addEventListener('click', () => {
    if (state.busy || !state.questActive || state.trialPrompted) return;
    state.trialPrompted = true;
    el.btnPrompt.disabled = true;
    el.promptFlag.hidden = false;
    const right = el.trialGrid.querySelector(`.pick[data-index="${state.correctIdx}"]`);
    if (right) right.classList.add('is-prompted');
    announce('Prompt given.');
  });

  el.btnTargetsToggle.addEventListener('click', () => setTargetPanelOpen(!state.targetPanelOpen));
  el.btnTargetsClose.addEventListener('click', () => setTargetPanelOpen(false));
  el.btnTargetsAll.addEventListener('click', () => setAllTargets(true));
  el.btnTargetsNone.addEventListener('click', () => setAllTargets(false));

  el.btnExtraToggle.addEventListener('click', () => setExtraPanelOpen(!state.extraPanelOpen));
  el.btnExtraClose.addEventListener('click', () => setExtraPanelOpen(false));

  el.btnBackToTask.addEventListener('click', () => showScreen('task'));
  el.btnAbandon.addEventListener('click', () => endQuest());

  el.scoreRow.querySelectorAll('.score-btn').forEach((b) => {
    b.addEventListener('click', () => onScore(b.dataset.score));
  });

  el.btnPlayAgain.addEventListener('click', () => showScreen('task'));
  el.btnOpenReport.addEventListener('click', openReport);
  el.btnClearData.addEventListener('click', () => {
    if (!state.sessionData.length) { alert('No data to clear.'); return; }
    if (!confirm('Clear all trial data? This cannot be undone.')) return;
    state.sessionData = [];
    state.trialNum = 0;
    if (window.NooutcoResults) NooutcoResults.clear(RESULTS_KEY);
    renderResults();
  });
}

// ── Test seam ──────────────────────────────────────────────────────
// Playwright needs positions and the current target to assert on. Everything
// here is read-only JS state; nothing it exposes is ever written to the DOM.

window.__sq = {
  peek() {
    const a = walkerAnchor();
    const f = foodAnchor();
    return {
      screen: state.screen,
      task: state.task ? state.task.id : null,
      place: state.place ? state.place.id : null,
      targetLabel: state.sampleLabel,
      round: state.roundNum,
      busy: state.busy,
      // The question is not askable the moment the walk ends any more - the
      // scene gets a beat to itself first. Drivers must wait on this rather
      // than on `!busy`, which now clears while the stage is still settling.
      awaitingAnswer: state.awaitingAnswer,
      foodKey: currentFoodKey() || null,
      collected: state.collected.slice(),
      foodTotal: state.foodTarget,
      friendCentreX: state.friendX * layout.w,
      foodCentreX: state.foodX * layout.w,
      friendHalfW: a.halfW,
      foodHalfW: f.halfW,
      stageW: layout.w,
      correctIndex: state.correctIdx,
      trials: state.sessionData.length,
    };
  },
};
