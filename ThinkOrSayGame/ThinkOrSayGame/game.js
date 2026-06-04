/* ── Think or Say? ─────────────────────────────────────────────────────
   A scenario card presents a thought; the learner decides whether it is a
   THINK IT (keep it inside) or a SAY IT (kind / okay to say out loud).
   Pre-K / Kindergarten social-language target.
   No build step — plain static HTML/CSS/JS.
   ----------------------------------------------------------------------- */

// ── Scenario set ───────────────────────────────────────────────────────
// answer: 'think' | 'say'.  tricky cards are held back unless enabled.
const CATEGORIES = {
  looks:   'How Someone Looks',
  smells:  'Smells',
  work:    'Their Work & Things',
  private: 'Private Things',
  kind:    'Kind Things to Say',
  other:   'Other Moments',
};

const SCENARIOS = [
  // ── How someone looks (THINK IT) ──
  { id: '1.1', cat: 'looks', answer: 'think',
    situation: 'You see a kid at school. They have a really big tummy.',
    thought: 'They have a big tummy.',
    reason: 'Think it. Talking about how someone’s body looks can hurt their feelings.' },
  { id: '1.2', cat: 'looks', answer: 'think',
    situation: 'Your grandma comes to visit. She has some hair missing on her head.',
    thought: 'Grandma doesn’t have much hair.',
    reason: 'Think it. Saying it might make Grandma feel sad.' },
  { id: '1.3', cat: 'looks', answer: 'think',
    situation: 'A boy in your class has a lot of spots on his face.',
    thought: 'He has spots all over.',
    reason: 'Think it. Saying it would embarrass him.' },
  { id: '1.4', cat: 'looks', answer: 'think',
    situation: 'Your teacher is wearing pants that look really silly to you.',
    thought: 'Those pants look funny.',
    reason: 'Think it. It would make your teacher feel bad.' },
  { id: '1.5', cat: 'looks', answer: 'think',
    situation: 'A man on the bus is very, very tall.',
    thought: 'He is so tall!',
    reason: 'Think it. Pointing out how someone’s body looks can embarrass them.' },
  { id: '1.6', cat: 'looks', answer: 'think',
    situation: 'A classmate is wearing two socks that don’t match.',
    thought: 'Their socks don’t match.',
    reason: 'Think it. They might feel embarrassed if you say it out loud.' },

  // ── Smells (THINK IT) ──
  { id: '2.1', cat: 'smells', answer: 'think',
    situation: 'You sit next to a classmate at lunch. Their food smells really strong.',
    thought: 'That smells weird.',
    reason: 'Think it. It would hurt their feelings about their food.' },
  { id: '2.2', cat: 'smells', answer: 'think',
    situation: 'A grown-up bends down to help you and you notice their breath.',
    thought: 'Their breath smells bad.',
    reason: 'Think it. Saying it would be embarrassing for them.' },

  // ── Their work & things (THINK IT) ──
  { id: '3.1', cat: 'work', answer: 'think',
    situation: 'A friend shows you a drawing they made. You think it doesn’t look very good.',
    thought: 'That drawing looks bad.',
    reason: 'Think it. They worked hard — saying it would hurt their feelings.' },
  { id: '3.2', cat: 'work', answer: 'think',
    situation: 'A classmate sings a song in circle time. You don’t like the way it sounds.',
    thought: 'That sounded really bad.',
    reason: 'Think it. Saying it would make them feel sad and not want to try.' },
  { id: '3.3', cat: 'work', answer: 'think',
    situation: 'Your friend shows you their new backpack. You think it’s ugly.',
    thought: 'I don’t like that backpack.',
    reason: 'Think it. They love their backpack — saying it would hurt their feelings.' },
  { id: '3.4', cat: 'work', answer: 'think',
    situation: 'A classmate gives the wrong answer in class.',
    thought: 'That was wrong.',
    reason: 'Think it. Saying it out loud would embarrass them.' },

  // ── Private things (THINK IT) ──
  { id: '4.1', cat: 'private', answer: 'think',
    situation: 'You see a classmate pull up their pants.',
    thought: 'I saw their underwear.',
    reason: 'Think it. That is private — saying it would embarrass them.' },
  { id: '4.2', cat: 'private', answer: 'think',
    situation: 'A kid at school has a small accident and their pants get wet.',
    thought: 'They had an accident.',
    reason: 'Think it. That is private and saying it would feel very embarrassing.' },
  { id: '4.3', cat: 'private', answer: 'think',
    situation: 'You notice a classmate picking their nose when they think no one is watching.',
    thought: 'I see them picking their nose.',
    reason: 'Think it. Saying it out loud would embarrass them.' },

  // ── Kind things to say (SAY IT) ──
  { id: '5.1', cat: 'kind', answer: 'say',
    situation: 'Your friend gets a new shirt with a dinosaur on it. You love dinosaurs too.',
    thought: 'I love that shirt!',
    reason: 'Say it! A kind compliment will make your friend happy.' },
  { id: '5.2', cat: 'kind', answer: 'say',
    situation: 'Your teacher reads a really funny story and you laugh.',
    thought: 'That story was so funny!',
    reason: 'Say it! Your teacher will feel happy you liked it.' },
  { id: '5.3', cat: 'kind', answer: 'say',
    situation: 'A classmate looks sad on the playground.',
    thought: 'I hope they feel better.',
    reason: 'Say it! You could say “Are you okay?” — it helps them feel less alone.' },
  { id: '5.4', cat: 'kind', answer: 'say',
    situation: 'Your friend helps you pick up your crayons when you drop them.',
    thought: 'That was really nice of them.',
    reason: 'Say it! Saying “Thank you!” is kind and makes friends feel good.' },
  { id: '5.5', cat: 'kind', answer: 'say',
    situation: 'Your mom makes your favorite dinner.',
    thought: 'This tastes SO good!',
    reason: 'Say it! It will make Mom happy to hear it.' },
  { id: '5.6', cat: 'kind', answer: 'say',
    situation: 'You don’t understand how to do the worksheet.',
    thought: 'I need help.',
    reason: 'Say it! Asking for help is always okay.' },
  { id: '5.7', cat: 'kind', answer: 'say',
    situation: 'Your tummy hurts at school.',
    thought: 'My tummy doesn’t feel good.',
    reason: 'Say it! Telling a grown-up when you feel sick is important.' },
  { id: '5.8', cat: 'kind', answer: 'say',
    situation: 'Your classmate shares their snack with you.',
    thought: 'That was so kind!',
    reason: 'Say it! “That was so nice, thank you!” makes friends feel great.' },
  { id: '5.9', cat: 'kind', answer: 'say',
    situation: 'Your friend makes it to the top of the climbing wall.',
    thought: 'They did it!',
    reason: 'Say it! Cheering a friend on is kind and fun.' },
  { id: '5.10', cat: 'kind', answer: 'say',
    situation: 'It is your friend’s birthday today.',
    thought: 'Happy birthday!',
    reason: 'Say it! Wishing a friend happy birthday makes them feel special.' },
  { id: '5.11', cat: 'kind', answer: 'say',
    situation: 'Your teacher got a new haircut and you really like it.',
    thought: 'I like their haircut!',
    reason: 'Say it! A kind compliment is a nice thing to share.' },
  { id: '5.12', cat: 'kind', answer: 'say',
    situation: 'You finished all your work and you feel proud.',
    thought: 'I did it!',
    reason: 'Say it! Sharing happy news about yourself is great.' },

  // ── Other moments ──
  { id: '6.1', cat: 'other', answer: 'think',
    situation: 'A baby on the bus is crying very loudly.',
    thought: 'That baby is so loud.',
    reason: 'Think it. Saying it might make the baby’s family feel bad.' },
  { id: '6.2', cat: 'other', answer: 'say',
    situation: 'A classmate took your turn by accident and you still want your turn.',
    thought: 'It’s my turn.',
    reason: 'Say it! You can speak up kindly: “I think it’s my turn.”' },

  // ── Tricky / reasoning cards (held back unless enabled) ──
  { id: 'T1', cat: 'looks', tricky: true, answer: 'think',
    situation: 'You think your friend’s new haircut looks really strange.',
    thought: 'That haircut looks weird.',
    reason: 'Think it. Even if it feels true, it would hurt their feelings — and they can’t change it right now.' },
  { id: 'T2', cat: 'kind', tricky: true, answer: 'say',
    situation: 'You notice your close friend has a little food stuck in their teeth.',
    thought: 'They have food in their teeth.',
    reason: 'You can say it — quietly and kindly, just to them: “Hey, you have something in your teeth.” Shouting it in front of everyone would be a think it. How and when we say it matters!' },
  { id: 'T3', cat: 'other', tricky: true, answer: 'say',
    situation: 'A classmate is about to run into the street where cars are driving.',
    thought: 'That’s dangerous!',
    reason: 'Say it — loudly, and tell a grown-up! When someone might get hurt, it is always right to speak up.' },
];

// ── DOM ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  selCategory:     $('sel-category'),
  selOrder:        $('sel-order'),
  btnExtraToggle:  $('btn-extra-toggle'),
  btnExtraClose:   $('btn-extra-close'),
  extraPanel:      $('extra-panel'),
  chkRepresent:    $('chk-represent-errors'),
  chkErrorless:    $('chk-errorless'),
  chkNoErrorAnim:  $('chk-no-error-anim'),
  chkAutoPrompt:   $('chk-auto-prompt'),
  chkPromptDelay:  $('chk-prompt-delay'),
  selPromptDelay:  $('sel-prompt-delay'),
  selPromptStyle:  $('sel-prompt-style'),
  chkShowReason:   $('chk-show-reason'),
  chkIncludeTricky:$('chk-include-tricky'),
  btnPrompt:       $('btn-prompt'),
  btnStart:        $('btn-start'),
  gameIntro:       $('game-intro'),
  gameArea:        $('game-area'),
  progressLabel:   $('progress-label'),
  scenarioSection: $('scenario-section'),
  choiceSection:   $('choice-section'),
  scenarioCard:    $('scenario-card'),
  situation:       $('scenario-situation'),
  thought:         $('scenario-thought'),
  reason:          $('scenario-reason'),
  choices:         $('choices'),
  timerDisplay:    $('timer-display'),
  btnTimerToggle:  $('btn-timer-toggle'),
  btnTimerReset:   $('btn-timer-reset'),
  btnPrint:        $('btn-print'),
  btnClearData:    $('btn-clear-data'),
  printMeta:       $('print-meta'),
  resultsBody:     $('results-body'),
  printSummary:    $('print-summary'),
};
const choiceEls = () => Array.from(el.choices.querySelectorAll('.choice'));

// ── State ──────────────────────────────────────────────────────────────
const state = {
  deck: [],
  pos: 0,
  current: null,
  locked: false,           // a choice has been answered (awaiting Next)
  trialErrors: 0,
  trialPrompted: false,
  represented: new Set(),  // scenario ids already re-presented
  promptTimer: null,
  // timer
  timerSecs: 0,
  timerRunning: false,
  timerHandle: null,
  trialStart: 0,
  // session results
  results: [],
};

// ── Settings persistence ───────────────────────────────────────────────
const SETTINGS_KEY = 'tosSettings';
const RESULTS_KEY  = 'tosResults';

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (e) {}
  el.selCategory.value      = s.category      ?? 'all';
  el.selOrder.value         = s.order         ?? 'shuffle';
  el.chkRepresent.checked   = s.represent     ?? true;
  el.chkErrorless.checked   = s.errorless     ?? false;
  el.chkNoErrorAnim.checked = s.noErrorAnim   ?? false;
  el.chkAutoPrompt.checked  = s.autoPrompt    ?? false;
  el.chkPromptDelay.checked = s.promptDelay   ?? false;
  el.selPromptDelay.value   = s.promptDelaySec ?? '3';
  el.selPromptStyle.value   = s.promptStyle   ?? 'sparkle';
  el.chkShowReason.checked  = s.showReason    ?? true;
  el.chkIncludeTricky.checked = s.includeTricky ?? false;
  syncPromptDelayEnabled();
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    category:      el.selCategory.value,
    order:         el.selOrder.value,
    represent:     el.chkRepresent.checked,
    errorless:     el.chkErrorless.checked,
    noErrorAnim:   el.chkNoErrorAnim.checked,
    autoPrompt:    el.chkAutoPrompt.checked,
    promptDelay:   el.chkPromptDelay.checked,
    promptDelaySec:el.selPromptDelay.value,
    promptStyle:   el.selPromptStyle.value,
    showReason:    el.chkShowReason.checked,
    includeTricky: el.chkIncludeTricky.checked,
  }));
}

function syncPromptDelayEnabled() {
  const on = el.chkAutoPrompt.checked;
  el.chkPromptDelay.disabled = !on;
  el.selPromptDelay.disabled = !on || !el.chkPromptDelay.checked;
}

// ── Category dropdown ──────────────────────────────────────────────────
function populateCategories() {
  const opts = ['<option value="all">All categories</option>'];
  for (const [key, label] of Object.entries(CATEGORIES)) {
    opts.push(`<option value="${key}">${label}</option>`);
  }
  el.selCategory.innerHTML = opts.join('');
}

// ── Utility ────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Build deck ─────────────────────────────────────────────────────────
function buildDeck() {
  const cat = el.selCategory.value;
  const includeTricky = el.chkIncludeTricky.checked;
  let pool = SCENARIOS.filter(s => {
    if (s.tricky && !includeTricky) return false;
    if (cat !== 'all' && s.cat !== cat) return false;
    return true;
  });
  if (el.selOrder.value === 'shuffle') pool = shuffle(pool);
  state.deck = pool;
  state.pos = 0;
  state.represented = new Set();
}

// ── Start ──────────────────────────────────────────────────────────────
function startGame() {
  saveSettings();
  buildDeck();
  if (!state.deck.length) {
    alert('No cards match these settings. Try a different category or enable tricky cards.');
    return;
  }
  state.results = [];
  saveResults();
  el.gameIntro.hidden = true;
  el.gameArea.hidden = false;
  el.btnPrompt.hidden = false;
  el.btnStart.textContent = 'Restart';
  removeDoneCard();
  resetTimer();
  startTimer();
  renderTrial();
}

// ── Render a trial ─────────────────────────────────────────────────────
function renderTrial() {
  clearPromptTimer();
  removeNextButton();
  removeDoneCard();
  el.scenarioSection.hidden = false;
  el.choiceSection.hidden = false;

  state.current = state.deck[state.pos];
  state.locked = false;
  state.trialErrors = 0;
  state.trialPrompted = false;
  state.trialStart = Date.now();

  const sc = state.current;
  el.progressLabel.textContent = `Card ${state.pos + 1} of ${state.deck.length}`;
  el.situation.textContent = sc.situation;
  el.thought.innerHTML = 'You think: <span class="quote">“' + escapeHtml(sc.thought) + '”</span>';

  el.reason.hidden = true;
  el.reason.className = '';

  choiceEls().forEach(c => {
    c.className = 'choice choice-' + c.dataset.answer;
    c.disabled = false;
  });

  if (el.chkAutoPrompt.checked) scheduleAutoPrompt();
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// ── Choice handling ────────────────────────────────────────────────────
function onChoiceClick(e) {
  const card = e.currentTarget;
  if (state.locked) return;
  if (card.disabled) return;

  const chosen = card.dataset.answer;
  const correct = state.current.answer;

  if (chosen === correct) {
    answerCorrect(card);
  } else {
    answerWrong(card);
  }
}

function answerCorrect(card) {
  state.locked = true;
  clearPromptTimer();
  clearPromptHighlight();
  choiceEls().forEach(c => {
    c.classList.add('locked');
    c.disabled = true;
    if (c !== card) c.classList.add('dim');
  });
  card.classList.remove('prompt-sparkle', 'prompt-outline');
  card.classList.add('correct');

  recordResult();
  if (el.chkShowReason.checked) showReason();
  showNextButton();
}

function answerWrong(card) {
  state.trialErrors++;
  if (!el.chkNoErrorAnim.checked) {
    card.classList.remove('wiggle', 'flash-red');
    void card.offsetWidth;            // restart animation
    card.classList.add('wiggle', 'flash-red');
    card.classList.add('wrong');
    setTimeout(() => {
      card.classList.remove('wiggle', 'flash-red', 'wrong');
    }, 520);
  }
  // In errorless mode, disable the wrong choice so only the correct one remains.
  if (el.chkErrorless.checked) {
    card.disabled = true;
    card.classList.add('locked', 'dim');
    // Surface the correct answer as a prompt.
    doPrompt();
  }
}

// ── Reason ─────────────────────────────────────────────────────────────
function showReason() {
  el.reason.textContent = state.current.reason;
  el.reason.className = state.current.answer === 'think' ? 'reason-think' : 'reason-say';
  el.reason.hidden = false;
}

// ── Prompt ─────────────────────────────────────────────────────────────
function doPrompt() {
  if (state.locked) return;
  const style = el.selPromptStyle.value === 'outline' ? 'prompt-outline' : 'prompt-sparkle';
  clearPromptHighlight();
  const target = choiceEls().find(c => c.dataset.answer === state.current.answer);
  if (target && !target.disabled) target.classList.add(style);
  state.trialPrompted = true;
}

function clearPromptHighlight() {
  choiceEls().forEach(c => c.classList.remove('prompt-sparkle', 'prompt-outline'));
}

function scheduleAutoPrompt() {
  clearPromptTimer();
  const delay = el.chkPromptDelay.checked ? parseInt(el.selPromptDelay.value, 10) * 1000 : 0;
  state.promptTimer = setTimeout(() => { if (!state.locked) doPrompt(); }, delay);
}

function clearPromptTimer() {
  if (state.promptTimer) { clearTimeout(state.promptTimer); state.promptTimer = null; }
}

// ── Next / advance ─────────────────────────────────────────────────────
function showNextButton() {
  removeNextButton();
  const btn = document.createElement('button');
  btn.id = 'btn-next';
  btn.type = 'button';
  const isLast = state.pos + 1 >= state.deck.length;
  btn.textContent = (isLast && !willRepresent()) ? 'Finish' : 'Next →';
  btn.addEventListener('click', nextTrial);
  el.choiceSection.appendChild(btn);
}

function removeNextButton() {
  const b = $('btn-next');
  if (b) b.remove();
}

// Will the current card be re-queued at the end of the deck?
function willRepresent() {
  const sc = state.current;
  const missed = state.trialErrors > 0 || state.trialPrompted;
  return missed && el.chkRepresent.checked && !state.represented.has(sc.id);
}

function nextTrial() {
  // Re-present a missed card once, at the end of the deck.
  const sc = state.current;
  if (willRepresent()) {
    state.represented.add(sc.id);
    state.deck.push(sc);
  }
  state.pos++;
  if (state.pos >= state.deck.length) {
    finishSession();
  } else {
    renderTrial();
  }
}

// ── Finish ─────────────────────────────────────────────────────────────
function finishSession() {
  pauseTimer();
  clearPromptTimer();
  removeNextButton();
  el.scenarioSection.hidden = true;
  el.choiceSection.hidden = true;
  el.progressLabel.textContent = '';

  const total = state.results.length;
  const firstTry = state.results.filter(r => r.errors === 0 && !r.prompted).length;

  removeDoneCard();
  const card = document.createElement('div');
  card.id = 'done-card';
  card.innerHTML =
    '<div class="done-emoji">🎉</div>' +
    '<h2>Set complete!</h2>' +
    `<p>${firstTry} of ${total} correct on the first try.</p>` +
    '<button type="button" id="btn-again">Play again</button>';
  el.gameArea.appendChild(card);
  $('btn-again').addEventListener('click', startGame);
}

function removeDoneCard() {
  const d = $('done-card');
  if (d) d.remove();
}

// ── Results / data ─────────────────────────────────────────────────────
function recordResult() {
  const sc = state.current;
  const secs = Math.max(0, Math.round((Date.now() - state.trialStart) / 1000));
  let outcome = 'ok';
  if (state.trialPrompted) outcome = 'prompted';
  else if (state.trialErrors > 0) outcome = 'error';
  state.results.push({
    cat: CATEGORIES[sc.cat] || sc.cat,
    scenario: sc.situation,
    answer: sc.answer === 'think' ? 'THINK IT' : 'SAY IT',
    errors: state.trialErrors,
    prompted: state.trialPrompted,
    secs,
    outcome,
  });
  saveResults();
}

function saveResults() {
  try { localStorage.setItem(RESULTS_KEY, JSON.stringify(state.results)); } catch (e) {}
}

function loadResults() {
  try { state.results = JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]'); } catch (e) { state.results = []; }
}

function buildPrint() {
  const rows = state.results.map((r, i) => {
    const outClass = 'outcome-' + r.outcome;
    const outLabel = r.outcome === 'ok' ? 'Independent'
                   : r.outcome === 'prompted' ? 'Prompted' : 'Error then correct';
    return `<tr>
      <td>${i + 1}</td>
      <td>${r.cat}</td>
      <td>${escapeHtml(r.scenario)}</td>
      <td>${r.answer}</td>
      <td>${r.errors}</td>
      <td>${r.prompted ? 'Yes' : 'No'}</td>
      <td>${r.secs}</td>
      <td class="${outClass}">${outLabel}</td>
    </tr>`;
  }).join('');
  el.resultsBody.innerHTML = rows;

  const total = state.results.length;
  const indep = state.results.filter(r => r.outcome === 'ok').length;
  const prompted = state.results.filter(r => r.prompted).length;
  const errs = state.results.reduce((a, r) => a + r.errors, 0);
  const d = new Date();
  el.printMeta.textContent = `${d.toLocaleDateString()} ${d.toLocaleTimeString()} — ${total} cards`;
  el.printSummary.innerHTML =
    `<span><strong>Independent:</strong> ${indep}/${total}</span>` +
    `<span><strong>Prompted:</strong> ${prompted}</span>` +
    `<span><strong>Total errors:</strong> ${errs}</span>`;
}

function printData() {
  if (!state.results.length) { alert('No session data yet. Play some cards first.'); return; }
  buildPrint();
  window.print();
}

function clearData() {
  if (!confirm('Clear all recorded session data?')) return;
  state.results = [];
  saveResults();
  alert('Session data cleared.');
}

// ── Timer ──────────────────────────────────────────────────────────────
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

// ── Wiring ─────────────────────────────────────────────────────────────
function init() {
  populateCategories();
  loadSettings();
  loadResults();

  el.btnStart.addEventListener('click', startGame);
  el.btnPrompt.addEventListener('click', doPrompt);

  choiceEls().forEach(c => c.addEventListener('click', onChoiceClick));

  // Extra panel
  el.btnExtraToggle.addEventListener('click', () => {
    const open = el.extraPanel.hidden;
    el.extraPanel.hidden = !open;
    el.btnExtraToggle.classList.toggle('is-open', open);
    el.btnExtraToggle.setAttribute('aria-expanded', String(open));
  });
  el.btnExtraClose.addEventListener('click', () => {
    el.extraPanel.hidden = true;
    el.btnExtraToggle.classList.remove('is-open');
    el.btnExtraToggle.setAttribute('aria-expanded', 'false');
  });

  // Persist settings on change
  [el.selCategory, el.selOrder, el.chkRepresent, el.chkErrorless, el.chkNoErrorAnim,
   el.chkAutoPrompt, el.chkPromptDelay, el.selPromptDelay, el.selPromptStyle,
   el.chkShowReason, el.chkIncludeTricky].forEach(node => {
    node.addEventListener('change', () => { syncPromptDelayEnabled(); saveSettings(); });
  });

  // Timer
  el.btnTimerToggle.addEventListener('click', toggleTimer);
  el.btnTimerReset.addEventListener('click', resetTimer);

  // Data
  el.btnPrint.addEventListener('click', printData);
  el.btnClearData.addEventListener('click', clearData);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
