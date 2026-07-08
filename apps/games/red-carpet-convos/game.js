'use strict';
/* ══════════════════════════════════════════════════════════════════
   Red Carpet Convos — game logic (vanilla port of the design prototype).

   Phase machine: start → explore (Meet) → talk (Talk) → wrap (Reward).
   A "turn" = the learner's Comment (even move) then Volley (odd move),
   both the learner; the partner takes a beat only AFTER the volley, then
   hands back. Prompt fade levels are DERIVED from say/ask at runtime.

   Rendering: setState() rebuilds #rcc for the active screen, then a post
   pass runs the karaoke and binds the few imperative bits (search input,
   hover-logo swap, reward timer) that must survive without a re-render.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  var root = document.getElementById('rcc');
  if (!root) return;

  // ── Constants ──────────────────────────────────────────────────────
  var LEVELS = ['Independent', 'Minimal', 'Partial', 'Full'];
  var REACT = ["Oh, I didn't know that!", "Whoa, really?", "That's so cool.", "Huh, interesting!", "Nice, I like that."];
  var RING_C = 552.9; // 2πr for r=88
  var INKS = ['#1a1a1a', '#1d4ed8', '#b91c1c'];
  var REFS = [
    { authors: 'Sarokoff, Taylor & Poulson (2001)', title: 'Teaching conversational skills to children with autism using a script-fading procedure.', where: 'J. Applied Behavior Analysis, 34(3), 289–297.', url: 'https://scholar.google.com/scholar?q=Sarokoff+Taylor+Poulson+2001+script-fading+conversational+skills+autism' },
    { authors: 'Nuernberger et al. (2013)', title: 'Using behavioral skills training to teach social skills to young adults with an autism spectrum disorder.', where: 'J. Applied Behavior Analysis, 46(1), 325–331.', url: 'https://scholar.google.com/scholar?q=Nuernberger+2013+behavioral+skills+training+social+skills+autism' },
    { authors: 'Leaf et al. (2012)', title: 'Evaluation of the relative efficacy of a free-standing conversation map program.', where: 'Research in Autism Spectrum Disorders, 6(1), 499–509.', url: 'https://scholar.google.com/scholar?q=Leaf+2012+free-standing+conversation+map+program+autism' }
  ];
  var LAYOUT_DEFS = [
    { k: 'map', icon: '🗺', label: 'Conversation map', desc: 'Follow the route' },
    { k: 'spotlight', icon: '🖼', label: 'Spotlight', desc: 'Photo + hint' },
    { k: 'hooks', icon: '🃏', label: 'Hook cards', desc: 'Pick an angle' },
    { k: 'transcript', icon: '💬', label: 'Transcript', desc: 'See the chat' }
  ];
  // Fallback accent palette for people that ship without one.
  var PALETTE = [['#7c3aed', '#ede9fe'], ['#0ea5e9', '#e2f2fb'], ['#2563eb', '#dbeafe'], ['#6b7c47', '#eef0da'], ['#ea580c', '#ffedd5']];

  var PEOPLE = [];

  // ── State ──────────────────────────────────────────────────────────
  var state = {
    phase: 'start', pIdx: 0, used: [],
    exploreShown: 1,
    moveIdx: 0, records: [], support: 3, selectedHook: null, beat: false, errs: {}, hoverLogo: false, pendingLayout: null, imgFull: false,
    searchOpen: false, searchQuery: '', suggest: '',
    layout: 'spotlight', method: 'mtl', startSupport: 3, turnCount: 4, persist: true, karaoke: true,
    tTotal: 180, tRem: 180, tRun: false, tDone: false, showRefs: false, ink: '#1a1a1a'
  };

  // Karaoke bookkeeping (persist across re-renders)
  var _kkey = '', _kprev = null, _kmove = -1, _ktimers = [];
  var _tint = null;          // reward timer interval
  var _wrapEntered = false;  // guard the one-time celebration animations

  // ── Escaping ───────────────────────────────────────────────────────
  function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

  // ── Data helpers ───────────────────────────────────────────────────
  function person() { return PEOPLE[state.pIdx] || PEOPLE[0]; }
  function firstName() { return person().name.split(' ')[0].replace(/[^A-Za-z-].*/, ''); }
  function facts() { return person().facts.slice(0, state.turnCount); }
  function totalMoves() { return state.turnCount * 2; }
  function curTurn() { return Math.floor(state.moveIdx / 2); }
  function isComment() { return state.moveIdx % 2 === 0; }
  function curFact() { return facts()[curTurn()] || facts()[0]; }
  function resetSupport() { return state.method === 'mtl' ? state.startSupport : 0; }

  function fadeEnd(s, frac) {
    var w = String(s).replace(/[.!?]+$/, '').split(/\s+/);
    var k = Math.max(2, Math.round(w.length * frac));
    return w.slice(0, k).join(' ') + '…';
  }
  function reactLine(f) {
    var s = (f.sayShort || f.say || '').replace(/[.!?]+$/, '');
    s = s.charAt(0).toLowerCase() + s.slice(1);
    return "I think it's cool that " + s + ".";
  }
  function commentText(f, lvl) { return lvl >= 3 ? f.say : lvl === 2 ? fadeEnd(f.say, .6) : fadeEnd(f.say, .32); }
  function volleyText(f, lvl) { return lvl >= 3 ? f.ask : fadeEnd(f.ask, .6); }
  function hintPayload() {
    var lvl = state.support, f = curFact(), c = isComment();
    if (lvl <= 0 || !f) return { kind: 'none' };
    if (c) return { kind: 'say', text: commentText(f, lvl) };
    if (lvl === 1) return { kind: 'cue', text: 'Ask a question about ' + f.topic + '.' };
    return { kind: 'say', text: volleyText(f, lvl) };
  }

  // ── Inline style helpers (match the prototype) ─────────────────────
  function segStyle(active) { return 'padding:9px 14px;border-radius:var(--radius-md);border:1.5px solid ' + (active ? 'var(--sage-500)' : 'var(--sage-200)') + ';background:' + (active ? 'var(--sage-500)' : '#fff') + ';color:' + (active ? '#fff' : 'var(--sage-700)') + ';font-weight:700;font-size:13px;cursor:pointer;transition:all .15s'; }
  function cardStyle(active) { return 'flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:5px;padding:13px 9px;border-radius:var(--radius-md);border:1.5px solid ' + (active ? 'var(--sage-500)' : 'var(--sage-200)') + ';background:' + (active ? 'var(--sage-50)' : '#fff') + ';color:var(--slate-800);cursor:pointer;transition:all .15s;box-shadow:' + (active ? 'inset 0 0 0 1px var(--sage-500)' : 'none'); }
  function toggleStyle(on) { return 'padding:9px 13px;border-radius:var(--radius-md);border:1.5px solid ' + (on ? 'var(--sage-500)' : 'var(--sage-200)') + ';background:' + (on ? 'var(--sage-50)' : '#fff') + ';color:' + (on ? 'var(--sage-700)' : 'var(--slate-400)') + ';font-weight:700;font-size:12.5px;cursor:pointer;transition:all .15s'; }

  // ── Karaoke (imperative, one-time reveal) ──────────────────────────
  function clearK() { _ktimers.forEach(clearTimeout); _ktimers = []; }
  function sayEls(text) {
    return String(text).trim().split(/\s+/).map(function (w) {
      return '<span data-kw="1" style="color:#c2c9bb;transition:color .18s ease">' + escHtml(w) + '</span>';
    }).join(' ');
  }
  function hintNodeHTML(payload) {
    if (!payload || payload.kind === 'none') {
      return '<div style="display:flex;align-items:center;gap:10px;color:var(--slate-400);font-size:15px;font-style:italic">' +
        '<span style="font-size:19px;font-style:normal">🗣</span>No prompt showing. Try it from memory, or tap ＋ for a hint.</div>';
    }
    if (payload.kind === 'cue') {
      return '<div style="display:flex;align-items:center;gap:11px;background:repeating-linear-gradient(135deg,#f7f8f2 0 9px,#eef1e6 9px 18px);border:1.5px dashed var(--sage-300);border-radius:12px;padding:14px 16px">' +
        '<span style="font-size:9.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--slate-400);border-radius:999px;padding:3px 9px;flex:0 0 auto">Cue</span>' +
        '<span style="font-size:16px;font-style:italic;color:var(--slate-600);font-weight:600">' + escHtml(payload.text) + '</span></div>';
    }
    return '<div data-say="' + escAttr(payload.text) + '" style="font-size:22px;font-weight:700;color:var(--slate-900);line-height:1.35;overflow-wrap:break-word;animation:fpg-pop .22s ease-out">' +
      '<span style="color:var(--slate-400);font-weight:700;font-size:26px;margin-right:.12em">“</span>' +
      sayEls(payload.text) +
      '<span style="color:var(--slate-400);font-weight:700;font-size:26px">”</span></div>';
  }
  function runKaraoke() {
    var box = root.querySelector('[data-say]');
    var line = box; // the say container itself carries data-say + the [data-kw] spans
    var key = state.phase + '|' + state.moveIdx + '|' + state.support + '|' + state.layout + '|' + (line ? line.getAttribute('data-say') : '');
    if (key === _kkey) return;
    _kkey = key; clearK();
    if (!line || !state.karaoke) {
      if (line) { line.querySelectorAll('[data-kw]').forEach(function (w) { w.style.color = 'var(--slate-900)'; }); _kprev = null; }
      return;
    }
    var words = [].slice.call(line.querySelectorAll('[data-kw]'));
    var cur = words.map(function (w) { return w.textContent; });
    var strip = function (x) { return x.replace(/[….,!?'"]+$/, '').toLowerCase(); };
    var startFrom = 0;
    if (_kmove === state.moveIdx && Array.isArray(_kprev) && cur.length >= _kprev.length) {
      var ok = true;
      for (var i = 0; i < _kprev.length; i++) { if (strip(_kprev[i]) !== strip(cur[i])) { ok = false; break; } }
      if (ok) startFrom = _kprev.length;
    }
    _kprev = cur; _kmove = state.moveIdx;
    words.forEach(function (w, i) { w.style.color = i < startFrom ? 'var(--slate-900)' : '#c2c9bb'; });
    if (startFrom >= words.length) return;
    var t = startFrom > 0 ? 70 : 180;
    for (var j = startFrom; j < words.length; j++) {
      (function (idx) {
        var w = words[idx];
        var len = w.textContent.replace(/[.,!?…'"—-]/g, '').length;
        var dur = Math.min(560, Math.max(150, len * 58 + 100));
        _ktimers.push(setTimeout(function () { if (idx > 0) { words[idx - 1].style.color = 'var(--slate-900)'; } w.style.color = 'var(--pa)'; }, t));
        t += dur;
      })(j);
    }
    _ktimers.push(setTimeout(function () { if (words.length) words[words.length - 1].style.color = 'var(--slate-900)'; }, t));
  }

  // ── setState / render dispatch ─────────────────────────────────────
  function setState(patch) {
    var next = typeof patch === 'function' ? patch(state) : patch;
    state = Object.assign({}, state, next);
    render();
  }

  // ── Flow ───────────────────────────────────────────────────────────
  function pickNext() {
    var n = PEOPLE.length, used = state.used;
    if (used.length >= n) used = [];
    var i = state.pIdx;
    for (var k = 0; k < n; k++) { var c = (state.pIdx + 1 + k) % n; if (used.indexOf(c) < 0) { i = c; break; } }
    return { i: i, used: used.concat([i]) };
  }
  function begin() { setState({ phase: 'explore', exploreShown: 1, used: [state.pIdx] }); }
  function revealNext() { setState(function (s) { return { exploreShown: Math.min(s.turnCount, s.exploreShown + 1) }; }); }
  function startTalk() { _kkey = ''; setState({ phase: 'talk', moveIdx: 0, records: [], support: resetSupport(), selectedHook: null, beat: false, errs: {} }); }
  function less() { setState(function (s) { return { support: Math.max(0, s.support - 1) }; }); }
  function more() { setState(function (s) { return { support: Math.min(3, s.support + 1) }; }); }
  function selectHook(id) { setState({ selectedHook: id }); }
  function backMove() {
    setState(function (s) {
      if (s.beat) { var r = s.records.slice(); r[s.moveIdx] = null; return { beat: false, records: r }; }
      if (s.moveIdx <= 0) return { phase: 'explore' };
      var r2 = s.records.slice(); r2[s.moveIdx - 1] = null;
      return { moveIdx: s.moveIdx - 1, records: r2, support: resetSupport(), selectedHook: null };
    });
  }
  function score() {
    setState(function (s) {
      var r = s.records.slice();
      r[s.moveIdx] = { outcome: 'correct', level: s.support, corrected: (s.errs[s.moveIdx] || 0) > 0 };
      if (s.moveIdx % 2 === 1) return { records: r, beat: true };
      return { records: r, moveIdx: s.moveIdx + 1, support: resetSupport(), selectedHook: null };
    });
  }
  function miss() {
    setState(function (s) {
      var errs = Object.assign({}, s.errs); errs[s.moveIdx] = (errs[s.moveIdx] || 0) + 1;
      var support = s.method === 'mtl' ? 3 : Math.min(3, s.support + 1);
      return { errs: errs, support: support };
    });
  }
  function continueBeat() {
    setState(function (s) {
      var last = s.moveIdx >= totalMoves() - 1;
      if (last) { _wrapEntered = false; return { beat: false, phase: 'wrap', tRem: s.tTotal, tRun: false, tDone: false, ink: pickInk() }; }
      return { beat: false, moveIdx: s.moveIdx + 1, support: resetSupport(), selectedHook: null };
    });
  }
  function pickInk() { return INKS[Math.floor(Math.random() * INKS.length)]; }
  function finish() { clearInterval(_tint); _tint = null; _wrapEntered = false; setState(function (s) { return { phase: 'wrap', beat: false, tRem: s.tTotal, tRun: false, tDone: false, ink: pickInk() }; }); }
  function newPerson() { var pk = pickNext(); _kkey = ''; clearInterval(_tint); _tint = null; setState({ pIdx: pk.i, used: pk.used, phase: 'explore', exploreShown: 1, moveIdx: 0, records: [], selectedHook: null, beat: false, errs: {}, imgFull: false }); }
  function toggleSearch() { setState(function (s) { return { searchOpen: !s.searchOpen, searchQuery: '', suggest: '' }; }); }
  function closeSearch() { setState({ searchOpen: false, searchQuery: '', suggest: '' }); }
  function pickIndex(i) { _kkey = ''; setState(function (s) { return { pIdx: i, used: s.used.indexOf(i) < 0 ? s.used.concat([i]) : s.used, phase: 'explore', exploreShown: 1, moveIdx: 0, records: [], selectedHook: null, beat: false, errs: {}, imgFull: false, searchOpen: false, searchQuery: '' }; }); }
  function suggestPerson() {
    var q = (state.searchQuery || '').trim(); if (!q) return;
    state.suggest = 'sending'; updateSuggestMsg();
    var done = function () { state.suggest = 'sent'; updateSuggestMsg(); };
    try { fetch('/api/suggest-person', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: q, ts: Date.now() }) }).then(done).catch(done); }
    catch (_) { done(); }
  }
  function requestLayout(k) { if (k === state.layout) return; if (state.phase === 'talk') setState({ pendingLayout: k }); else setState({ layout: k }); }
  function confirmLayout() { _kkey = ''; setState(function (s) { return { layout: s.pendingLayout || s.layout, pendingLayout: null, moveIdx: 0, records: [], support: resetSupport(), selectedHook: null, beat: false, errs: {} }; }); }
  function cancelLayout() { setState({ pendingLayout: null }); }
  function home() { clearInterval(_tint); _tint = null; setState({ phase: 'start' }); }

  // ── Reward timer (imperative — never triggers a full re-render) ─────
  function tFmt(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function ringOffset() { return ((1 - state.tRem / state.tTotal) * RING_C).toFixed(1); }
  function updateTimerDom() {
    var t = document.getElementById('rcc-timer-text'); if (t) t.textContent = tFmt(state.tRem);
    var r = document.getElementById('rcc-ring'); if (r) r.style.strokeDashoffset = ringOffset();
  }
  function updateTimerControls() {
    var wrap = document.getElementById('rcc-timer-controls'); if (!wrap) return;
    wrap.innerHTML = timerControlsHTML();
    var presets = document.getElementById('rcc-reward-presets'); if (presets) presets.style.display = state.tRun ? 'none' : 'flex';
  }
  function timerToggle() {
    if (state.tRun) { clearInterval(_tint); _tint = null; state.tRun = false; updateTimerControls(); return; }
    state.tRun = true; state.tDone = false; updateTimerControls();
    _tint = setInterval(function () {
      if (state.tRem <= 1) { clearInterval(_tint); _tint = null; state.tRem = 0; state.tRun = false; state.tDone = true; updateTimerDom(); updateTimerControls(); chime(); return; }
      state.tRem -= 1; updateTimerDom();
    }, 1000);
  }
  function timerReset() { clearInterval(_tint); _tint = null; state.tRem = state.tTotal; state.tRun = false; state.tDone = false; updateTimerDom(); updateTimerControls(); }
  function setReward(m) {
    if (state.tRun) return;
    var s = m * 60; clearInterval(_tint); _tint = null;
    state.tTotal = s; state.tRem = s; state.tDone = false;
    updateTimerDom(); updateTimerControls();
    var host = document.getElementById('rcc-reward-presets');
    if (host) host.innerHTML = rewardPresetsHTML();
  }
  function chime() {
    try {
      var c = new (window.AudioContext || window.webkitAudioContext)();
      [523, 659, 784].forEach(function (f, i) {
        var o = c.createOscillator(), g = c.createGain(); o.connect(g); g.connect(c.destination);
        o.type = 'sine'; o.frequency.value = f; var t = c.currentTime + i * .28;
        g.gain.setValueAtTime(.3, t); g.gain.exponentialRampToValueAtTime(.001, t + 1); o.start(t); o.stop(t + 1.1);
      });
    } catch (_) {}
  }

  function updateSuggestMsg() {
    var el = document.getElementById('rcc-suggest-msg'); if (!el) return;
    el.textContent = state.suggest === 'sending' ? 'Sending…' : state.suggest === 'sent' ? 'Sent to your team ✨' : '';
  }

  // ── Print (self-contained; data stays device-local, never transmitted) ──
  function printData() {
    var p = person(), recs = state.records, dt = new Date().toLocaleString();
    var rows = recs.map(function (r, m) {
      if (!r) return '';
      var turn = Math.floor(m / 2) + 1, type = m % 2 === 0 ? 'Comment' : 'Volley';
      var out = r.corrected ? 'Error, corrected' : 'Correct';
      var ctx = (r.level === 0 && !r.corrected) ? 'Independent' : (LEVELS[r.level] + ' prompt');
      return '<tr><td>' + turn + '</td><td>' + type + '</td><td>' + out + '</td><td>' + ctx + '</td></tr>';
    }).join('');
    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Red Carpet Convos — Session Record</title>' +
      '<style>body{font-family:Atkinson Hyperlegible,Arial,sans-serif;font-size:12px;margin:26px;color:#111827}h1{font-size:18px;margin:0 0 2px}.s{color:#6b7280;margin-bottom:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e5e7eb;padding:6px 9px;text-align:left}th{background:#f3f4f6;font-size:11px;text-transform:uppercase;letter-spacing:.05em}</style></head><body>' +
      '<h1>Red Carpet Convos — Session Record</h1><div class="s">' + escHtml(p.name) + ' · ' + escHtml(p.tag) + ' · Prompting: ' + (state.method === 'mtl' ? 'Most-to-least' : 'Least-to-most') + ' · Printed ' + escHtml(dt) + '</div>' +
      '<table><thead><tr><th>Turn</th><th>Move</th><th>Outcome</th><th>Prompt level</th></tr></thead><tbody>' + rows + '</tbody></table></body></html>';
    var w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); w.print(); }
  }

  // ── Image error fallback ───────────────────────────────────────────
  function imgErr(el) { if (el) el.style.visibility = 'hidden'; }

  // ══════════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════════
  function render() {
    var p = person();
    if (!p) { root.innerHTML = '<div style="margin:auto;padding:40px;text-align:center;color:var(--slate-500);font-family:var(--font-sans)">Couldn\'t load the roster. <button onclick="location.reload()" style="margin-left:8px;padding:8px 14px;border:1.5px solid var(--sage-300);border-radius:6px;background:#fff;color:var(--sage-700);font-weight:700;cursor:pointer">Reload</button></div>'; return; }
    var html = renderBar();
    if (state.phase === 'start') html += renderStart();
    else if (state.phase === 'explore') html += renderExplore();
    else if (state.phase === 'talk') html += renderTalk();
    else if (state.phase === 'wrap') html += renderWrap();
    root.innerHTML = html;
    postRender();
  }

  function postRender() {
    // Karaoke every render.
    runKaraoke();
    // Search input: keep focus + caret across renders (only the results sublist
    // updates on keystroke — see bindSearchInput — so this handles panel open).
    if (state.phase === 'explore' && state.searchOpen) {
      var inp = document.getElementById('rcc-search-input');
      if (inp) { bindSearchInput(inp); if (document.activeElement !== inp) { inp.focus(); var v = inp.value; inp.value = ''; inp.value = v; } }
    }
    // Talk: hover-logo swap (imperative; inline opacity wins over CSS :hover).
    if (state.phase === 'talk') {
      var slot = document.getElementById('rcc-logo-slot');
      if (slot) {
        var logo = slot.querySelector('[data-logo]');
        slot.addEventListener('mouseenter', function () { if (logo) logo.style.opacity = '1'; });
        slot.addEventListener('mouseleave', function () { if (logo) logo.style.opacity = '0'; });
      }
    }
    // Wrap: mark the one-time celebration as played so a later imperative
    // timer update never has to rebuild (it doesn't — timer is imperative).
    if (state.phase === 'wrap') _wrapEntered = true;
  }

  // ── App bar ────────────────────────────────────────────────────────
  function renderBar() {
    var p = person(), onTalk = state.phase === 'talk';
    var version = window.APP_VERSION ? ('v' + window.APP_VERSION) : '';
    var left;
    if (onTalk) {
      var dots = '';
      for (var m = 0; m < totalMoves(); m++) {
        var rec = state.records[m], isc = m === state.moveIdx, corr = rec && rec.corrected;
        var bg = isc ? p.accent : rec ? (corr ? 'var(--amber-300)' : 'var(--sage-400)') : '#d7dccb';
        dots += '<span style="width:' + (isc ? '22px' : '9px') + ';height:9px;border-radius:999px;transition:all .2s;background:' + bg + '"></span>';
      }
      left = '<div id="rcc-logo-slot" title="Hover for No Outcome ABA" style="position:relative;width:34px;height:34px;border-radius:999px;overflow:hidden;flex:0 0 auto;background:var(--slate-100);cursor:default">' +
        '<img src="' + escAttr(p.img) + '" alt="' + escAttr(p.name) + '" referrerpolicy="no-referrer" data-imgerr style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 20%" />' +
        '<img data-logo src="assets/logo-mark.svg" alt="No Outcome ABA" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#fff;padding:2px;opacity:0;transition:opacity .15s var(--ease-standard)" /></div>' +
        '<div style="line-height:1.1;min-width:0"><div style="font-size:14px;font-weight:800;color:var(--slate-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:34vw">' + escHtml(p.name) + '</div>' +
        '<div style="font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--slate-400)">Turn ' + (curTurn() + 1) + ' of ' + state.turnCount + '</div></div>' +
        '<div style="display:flex;gap:5px;align-items:center;margin:0 4px">' + dots + '</div>';
    } else {
      left = '<img src="assets/logo-mark.svg" alt="No Outcome ABA" style="width:32px;height:32px;flex:0 0 auto" />' +
        '<div style="line-height:1.15"><div style="font-size:15px;font-weight:800;color:var(--sage-700);letter-spacing:-.01em;white-space:nowrap">Red Carpet Convos</div>' +
        '<div style="font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-500)">Conversation game' + (version ? ' · ' + version : '') + '</div></div>';
    }
    var right = '';
    if (onTalk) {
      var mini = LAYOUT_DEFS.map(function (o) {
        var on = state.layout === o.k;
        return '<button data-act="requestLayout" data-arg="' + o.k + '" title="' + escAttr(o.label) + '" style="width:32px;height:28px;border:none;border-radius:var(--radius-sm);background:' + (on ? '#fff' : 'transparent') + ';color:' + (on ? 'var(--sage-700)' : 'var(--slate-400)') + ';font-size:14px;cursor:pointer;box-shadow:' + (on ? 'var(--shadow-sm)' : 'none') + '">' + o.icon + '</button>';
      }).join('');
      right += '<div style="display:flex;gap:3px;padding:3px;background:var(--sage-100);border-radius:var(--radius-md)">' + mini + '</div>';
    } else {
      var pl = { start: 'Setup', explore: 'Phase 1 · Meet', talk: 'Phase 2 · Talk', wrap: 'Reward' }[state.phase];
      var pc = state.phase === 'start' ? 'var(--slate-400)' : 'var(--sage-600)';
      right += '<span style="font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:' + pc + ';background:var(--sage-100);border-radius:999px;padding:4px 11px">' + pl + '</span>';
    }
    right += '<button data-act="home" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1.5px solid var(--sage-200);border-radius:var(--radius-md);background:transparent;color:var(--sage-700);font-size:12.5px;font-weight:700;cursor:pointer">Restart</button>';

    return '<div style="display:flex;align-items:center;gap:12px;padding:10px 18px;background:#fff;border-bottom:1px solid var(--sage-200);position:sticky;top:0;z-index:20">' +
      left + '<div style="display:flex;align-items:center;gap:9px;margin-left:auto;flex:0 0 auto">' + right + '</div></div>';
  }

  // ── Start / Setup ──────────────────────────────────────────────────
  function renderStart() {
    var refsHTML = '';
    if (state.showRefs) {
      refsHTML = '<div style="position:absolute;left:0;top:100%;margin-top:8px;z-index:30;width:min(460px,88vw);background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-lg);padding:15px 17px;box-shadow:var(--shadow-lg);animation:fpg-pop .18s ease-out">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px"><span style="font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-500)">Evidence base</span>' +
        '<button data-act="toggleRefs" aria-label="Close" style="border:none;background:none;color:var(--slate-400);font-size:15px;cursor:pointer;line-height:1;padding:2px">✕</button></div>' +
        '<div style="display:flex;flex-direction:column;gap:11px">' +
        REFS.map(function (r) { return '<a href="' + escAttr(r.url) + '" target="_blank" rel="noopener" style="display:block"><div style="font-size:13px;font-weight:800;color:var(--sage-700);line-height:1.32">' + escHtml(r.title) + '</div><div style="font-size:11.5px;color:var(--slate-500);margin-top:2px">' + escHtml(r.authors) + ' · ' + escHtml(r.where) + '</div></a>'; }).join('') +
        '</div><div style="font-size:11px;color:var(--slate-400);margin-top:11px;line-height:1.45;border-top:1px solid var(--sage-200);padding-top:9px">Phase 1 primes the facts before any demand. Phase 2 fades scripts from full model down to independent. The Conversation map layout follows the map approach in Leaf et al.</div></div>';
    }
    var layoutOpts = LAYOUT_DEFS.map(function (o) {
      return '<button data-act="setLayout" data-arg="' + o.k + '" style="' + cardStyle(state.layout === o.k) + '">' +
        '<span style="font-size:24px;line-height:1">' + o.icon + '</span><span style="font-weight:800;font-size:12.5px;line-height:1.15;color:var(--slate-800)">' + o.label + '</span>' +
        '<span style="font-size:10.5px;color:var(--slate-500);font-weight:600;line-height:1.2">' + o.desc + '</span></button>';
    }).join('');
    var methodOpts = [{ k: 'mtl', label: 'Most-to-least', desc: 'Start with full support' }, { k: 'ltm', label: 'Least-to-most', desc: 'Start independent' }].map(function (o) {
      return '<button data-act="setMethod" data-arg="' + o.k + '" style="' + segStyle(state.method === o.k) + '" title="' + escAttr(o.desc) + '">' + o.label + '</button>';
    }).join('');
    var startOpts = [3, 2, 1, 0].map(function (l) {
      return '<button data-act="setStart" data-arg="' + l + '" style="' + segStyle(state.startSupport === l) + ';padding:8px 11px;font-size:12px">' + LEVELS[l] + '</button>';
    }).join('');
    var turnOpts = [2, 3, 4].map(function (n) { return '<button data-act="setTurns" data-arg="' + n + '" style="' + segStyle(state.turnCount === n) + ';min-width:46px">' + n + '</button>'; }).join('');
    var rewardOpts = [1, 2, 3, 5].map(function (m) { return '<button data-act="setReward" data-arg="' + m + '" style="' + segStyle(state.tTotal === m * 60) + ';padding:7px 12px;font-size:12px">' + m + ' min</button>'; }).join('');
    var methodHelp = state.method === 'mtl' ? 'Full model first, then fade support out.' : 'Learner tries alone; add help only if stuck.';
    var startLevelLabel = state.method === 'mtl' ? 'Start support at' : 'Support ceiling';

    return '<div class="rcc-scroll" style="flex:1;overflow-y:auto;display:flex;justify-content:center;padding:34px 20px 56px">' +
      '<div style="width:100%;max-width:720px;animation:fpg-fade .3s ease-out">' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--slate-500);margin-bottom:8px">Set up the activity</div>' +
      '<h1 style="font-size:32px;font-weight:800;letter-spacing:-.4px;color:var(--slate-900);line-height:1.1">Meet and discuss someone famous! 🌟💃📸</h1>' +
      '<div style="position:relative;max-width:560px"><p style="font-size:15px;color:var(--slate-600);line-height:1.55;margin-top:10px">Two quick phases: get to know a famous person, then have a short conversation about them. ' +
      '<button data-act="toggleRefs" title="Evidence base" aria-label="About the research behind this game" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:1.5px solid var(--sage-300);border-radius:999px;background:#fff;color:var(--sage-700);font-size:11px;font-weight:800;cursor:pointer;vertical-align:1px;transition:all .15s">?</button></p>' + refsHTML + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:22px 0 6px">' +
      '<div style="background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-lg);padding:16px 18px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:20px">📖</span><span style="font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--sage-600)">Phase 1 · Meet</span></div><div style="font-size:15px;font-weight:800;color:var(--slate-900);margin-bottom:3px">Explore the facts</div><div style="font-size:13px;color:var(--slate-600);line-height:1.45">Read a few facts together and chat freely. No scoring. Just get to know them.</div></div>' +
      '<div style="background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-lg);padding:16px 18px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:20px">💬</span><span style="font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--sage-600)">Phase 2 · Talk</span></div><div style="font-size:15px;font-weight:800;color:var(--slate-900);margin-bottom:3px">Have the conversation</div><div style="font-size:13px;color:var(--slate-600);line-height:1.45">Comment, then volley a question back. Hints appear only when help is needed.</div></div>' +
      '</div>' +
      '<div style="background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-lg);padding:18px 20px;margin-top:16px"><div style="display:flex;flex-direction:column;gap:16px">' +
      '<div><div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:7px"><span style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-500)">Conversation layout</span><span style="font-size:11.5px;color:var(--slate-400);font-weight:600">compare all four</span></div><div style="display:flex;gap:8px;flex-wrap:wrap">' + layoutOpts + '</div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
      '<div><div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-500);margin-bottom:7px">Prompting</div><div style="display:flex;gap:7px">' + methodOpts + '</div><div style="font-size:11.5px;color:var(--slate-500);margin-top:6px;line-height:1.4">' + methodHelp + '</div></div>' +
      '<div><div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-500);margin-bottom:7px">' + startLevelLabel + '</div><div style="display:flex;gap:6px;flex-wrap:wrap">' + startOpts + '</div></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
      '<div><div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-500);margin-bottom:7px">Turns (one fact each)</div><div style="display:flex;gap:6px">' + turnOpts + '</div></div>' +
      '<div><div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-500);margin-bottom:7px">Reward break</div><div style="display:flex;gap:6px;flex-wrap:wrap">' + rewardOpts + '</div></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button data-act="togglePersist" style="' + toggleStyle(state.persist) + '">📌 Keep prompt on screen</button><button data-act="toggleKaraoke" style="' + toggleStyle(state.karaoke) + '">🎤 Karaoke</button></div>' +
      '</div></div>' +
      '<button data-act="begin" style="margin-top:20px;width:100%;padding:16px;border:none;border-radius:var(--radius-md);background:var(--sage-500);color:#fff;font-size:16px;font-weight:800;cursor:pointer;box-shadow:var(--shadow-sm)">Red Carpet Ready! 🤩 →</button>' +
      '</div></div>';
  }

  // ── Meet / Explore ─────────────────────────────────────────────────
  function searchResultsHTML() {
    var sq = (state.searchQuery || '').trim(), sql = sq.toLowerCase();
    if (!sq) return '';
    var matches = PEOPLE.map(function (p, i) { return { p: p, i: i }; }).filter(function (o) { return o.p.name.toLowerCase().indexOf(sql) >= 0; });
    var rows = matches.map(function (o) {
      return '<button data-act="pickIndex" data-arg="' + o.i + '" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:none;background:none;padding:8px 6px;border-radius:8px;cursor:pointer;font-family:inherit">' +
        '<span style="font-size:18px">' + (o.p.emoji || '⭐') + '</span><span style="flex:1;font-weight:700;font-size:14px;color:var(--slate-900)">' + escHtml(o.p.name) + '</span>' +
        '<span style="font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--slate-400)">' + escHtml(o.p.tag) + '</span></button>';
    }).join('');
    if (matches.length === 0) {
      rows = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 4px 2px"><span style="font-size:13px;color:var(--slate-500)">No one yet by that name.</span>' +
        '<button data-act="suggest" style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border:1px solid var(--violet-200);border-radius:var(--radius-pill);background:transparent;color:var(--violet-500);font-size:11px;font-weight:700;cursor:pointer">✨ Suggest “' + escHtml(sq) + '”</button>' +
        '<span id="rcc-suggest-msg" style="font-size:12px;color:var(--sage-700);font-weight:700">' + (state.suggest === 'sending' ? 'Sending…' : state.suggest === 'sent' ? 'Sent to your team ✨' : '') + '</span></div>';
    }
    return '<div style="margin-top:8px;border-top:1px solid var(--sage-100);padding-top:6px;display:flex;flex-direction:column;gap:2px">' + rows + '</div>';
  }

  function renderExplore() {
    var p = person();
    var searchHTML = '';
    if (state.searchOpen) {
      searchHTML = '<div style="background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm);padding:12px 14px;margin-bottom:14px">' +
        '<div style="display:flex;align-items:center;gap:9px"><span style="font-size:16px">🔍</span>' +
        '<input id="rcc-search-input" value="' + escAttr(state.searchQuery) + '" placeholder="Search for a famous person…" style="flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:inherit;font-size:15px;font-weight:600;color:var(--slate-900)" />' +
        '<button data-act="closeSearch" aria-label="Close search" style="border:none;background:none;color:var(--slate-400);font-size:15px;cursor:pointer;padding:2px">✕</button></div>' +
        '<div id="rcc-search-results">' + searchResultsHTML() + '</div></div>';
    }
    var factsHTML = facts().slice(0, state.exploreShown).map(function (f, i) {
      return '<div style="background:#fff;border:1px solid var(--sage-200);border-left:4px solid var(--pa);border-radius:var(--radius-lg);padding:14px 16px;animation:fpg-pop .25s ease-out">' +
        '<div style="display:flex;align-items:center;gap:9px;margin-bottom:5px"><span style="width:22px;height:22px;border-radius:var(--radius-pill);background:var(--pabg);color:var(--pa);font-size:12px;font-weight:800;display:inline-flex;align-items:center;justify-content:center">' + (i + 1) + '</span>' +
        '<span style="font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--slate-400)">' + escHtml(f.topic) + '</span></div>' +
        '<div style="font-size:17px;font-weight:600;color:var(--slate-800);line-height:1.4">' + escHtml(f.text) + '</div></div>';
    }).join('');
    var controls = state.exploreShown < state.turnCount
      ? '<button data-act="revealNext" style="flex:1;padding:14px;border:1.5px solid var(--sage-300);border-radius:var(--radius-md);background:#fff;color:var(--sage-700);font-size:15px;font-weight:800;cursor:pointer">＋ Next fact</button>'
      : '<button data-act="startTalk" style="flex:1;padding:14px;border:none;border-radius:var(--radius-md);background:var(--sage-500);color:#fff;font-size:15px;font-weight:800;cursor:pointer;box-shadow:var(--shadow-sm)">Start talking →</button>';

    return '<div class="rcc-scroll" style="flex:1;overflow-y:auto;padding:26px 20px 40px;--pa:' + p.accent + ';--pabg:' + p.accentBg + '">' +
      '<div style="width:100%;max-width:680px;margin:0 auto;animation:fpg-fade .3s ease-out">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">' +
      '<span style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--sage-600)">📖 Phase 1 · Meet</span>' +
      '<span style="flex:1;height:1px;background:var(--sage-200)"></span>' +
      '<span style="font-size:12px;font-weight:700;color:var(--slate-500)">Fact ' + state.exploreShown + ' of ' + state.turnCount + '</span>' +
      '<button data-act="newPerson" title="Pick a different person" style="flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border:1.5px solid var(--sage-200);border-radius:var(--radius-pill);background:#fff;color:var(--sage-700);font-size:12px;font-weight:800;cursor:pointer">🎲 New person</button>' +
      '<button data-act="toggleSearch" title="Search for a person" style="flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:1.5px solid var(--sage-200);border-radius:999px;background:#fff;color:var(--sage-700);font-size:14px;cursor:pointer">🔍</button>' +
      '</div>' + searchHTML +
      '<div style="background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-xl);overflow:hidden;box-shadow:var(--shadow-md)">' +
      '<div style="height:6px;background:var(--pa)"></div>' +
      '<div style="display:flex;gap:0;flex-wrap:wrap">' +
      '<div style="position:relative;flex:0 0 auto;width:230px;max-width:42%;min-width:180px;background:var(--pabg)"><img src="' + escAttr(p.img) + '" alt="' + escAttr(p.name) + '" referrerpolicy="no-referrer" data-imgerr style="width:100%;height:100%;min-height:210px;object-fit:cover;object-position:center 32%;display:block" /></div>' +
      '<div style="flex:1;min-width:210px;padding:18px 20px"><div style="display:flex;align-items:center;gap:9px;margin-bottom:6px"><span style="font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--pa);background:var(--pabg);border-radius:var(--radius-pill);padding:4px 11px">' + escHtml(p.tag) + '</span><span style="font-size:13px;color:var(--slate-400);font-weight:700">' + escHtml(p.years) + '</span></div>' +
      '<div style="font-size:26px;font-weight:800;color:var(--slate-900);letter-spacing:-.4px;line-height:1.1">' + escHtml(p.name) + '</div>' +
      '<div style="margin-top:12px;font-size:12.5px;color:var(--slate-500);line-height:1.5;display:flex;gap:8px;align-items:flex-start"><span style="font-size:15px;line-height:1.2">🧑‍⚕️</span><span>Model it here: read each fact aloud, then say a comment and ask a question yourself, so the learner hears what it sounds like. Point at the photo, react, wonder aloud. No demands yet.</span></div></div>' +
      '</div></div>' +
      '<div style="display:flex;flex-direction:column;gap:10px;margin-top:16px">' + factsHTML + '</div>' +
      '<div style="display:flex;gap:10px;margin-top:18px">' + controls + '</div>' +
      '<div style="text-align:center;margin-top:12px"><button data-act="startTalk" style="border:none;background:none;color:var(--slate-500);font-size:12.5px;font-weight:700;cursor:pointer;text-decoration:underline">Skip ahead to the conversation</button></div>' +
      '</div></div>';
  }

  // ── Talk stages ────────────────────────────────────────────────────
  function heroImgHTML(p, h) {
    var fit = state.imgFull ? 'contain' : 'cover', pos = state.imgFull ? 'center' : 'center 34%';
    var cur = state.imgFull ? 'zoom-out' : 'zoom-in', icon = state.imgFull ? '↩' : '⤢', title = state.imgFull ? 'Back to close-up' : 'See the whole photo';
    return '<div style="position:relative;border-radius:var(--radius-xl);overflow:hidden;background:var(--pabg);border:1px solid var(--sage-200);height:' + h + '">' +
      '<img src="' + escAttr(p.img) + '" alt="' + escAttr(p.name) + '" referrerpolicy="no-referrer" data-imgerr data-act="toggleImg" style="width:100%;height:100%;object-fit:' + fit + ';object-position:' + pos + ';display:block;cursor:' + cur + '" />' +
      '<button data-act="toggleImg" title="' + title + '" aria-label="' + title + '" style="position:absolute;top:10px;right:10px;width:32px;height:32px;border-radius:999px;border:none;background:rgba(17,24,39,.55);color:#fff;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)">' + icon + '</button>' +
      '<div style="position:absolute;left:0;right:0;bottom:0;padding:24px 20px 16px;background:linear-gradient(to top,rgba(17,24,39,.8),rgba(17,24,39,0));color:#fff"><div style="font-size:25px;font-weight:800;line-height:1.05">' + escHtml(p.name) + '</div><div style="font-size:12.5px;opacity:.9;font-weight:700;margin-top:2px">' + escHtml(p.tag) + ' · ' + escHtml(p.years) + '</div></div></div>';
  }

  function stageSpotlight(p, move) {
    return '<div><div style="margin-bottom:0">' + heroImgHTML(p, 'clamp(240px,42vh,380px)') + '</div>' +
      '<div style="position:relative;margin:-30px 16px 0;background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-lg);box-shadow:var(--shadow-md);padding:16px 18px">' +
      '<div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-400);margin-bottom:10px">' + move.prompt + '</div>' +
      '<div>' + hintNodeHTML(hintPayload()) + '</div></div></div>';
  }

  function hookDefs(f, c) {
    return c
      ? [{ id: 'fact', icon: '💬', label: 'Say the fact', line: f.say }, { id: 'short', icon: '⚡', label: 'In a few words', line: f.sayShort }, { id: 'think', icon: '💡', label: 'Say what you think', line: reactLine(f) }]
      : [{ id: 'about', icon: '❓', label: 'Ask about it', line: f.ask }, { id: 'think', icon: '🤔', label: 'Ask what they think', line: 'What do you think about ' + f.topic + '?' }, { id: 'you', icon: '🙋', label: 'Ask them back', line: f.askYou || 'Have you ever tried something like that?' }];
  }
  function hookShown(line) { return state.support <= 0 ? '' : (state.support >= 3 ? line : fadeEnd(line, state.support === 1 ? .34 : .62)); }
  function stageHooks(p, move, f, c) {
    var defs = hookDefs(f, c);
    var cards = defs.map(function (d) {
      var sel = state.selectedHook === d.id, shown = hookShown(d.line);
      var scriptStyle = shown ? 'font-size:14px;color:' + (sel ? 'var(--slate-900)' : 'var(--slate-600)') + ';line-height:1.35;font-weight:' + (sel ? '700' : '600') : 'font-size:12.5px;color:var(--slate-400);font-style:italic;font-weight:600';
      var scriptText = shown ? '“' + escHtml(shown) + '”' : 'your words';
      return '<button data-act="selectHook" data-arg="' + d.id + '" style="text-align:left;border:1.5px solid ' + (sel ? 'var(--pa)' : 'var(--sage-200)') + ';background:' + (sel ? 'var(--pabg)' : '#fff') + ';border-radius:var(--radius-lg);padding:13px 14px;cursor:pointer;transition:all .15s;display:flex;flex-direction:column;gap:6px">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="font-size:17px">' + d.icon + '</span><span style="font-size:13px;font-weight:800;color:var(--slate-900)">' + d.label + '</span></div>' +
        '<div style="' + scriptStyle + '">' + scriptText + '</div></button>';
    }).join('');
    var chosen = defs.filter(function (d) { return d.id === state.selectedHook; })[0];
    var hookHint;
    if (chosen) { var cl = hookShown(chosen.line); hookHint = cl ? hintNodeHTML({ kind: 'say', text: cl }) : '<div style="font-size:13px;color:var(--slate-400);font-style:italic">Independent. Say it in your own words.</div>'; }
    else hookHint = '<div style="font-size:13px;color:var(--slate-400);font-style:italic">Tap a card, then say it your way. Your partner reacts, then it is your turn again.</div>';
    return '<div style="margin-bottom:14px">' + heroImgHTML(p, 'clamp(200px,32vh,300px)') + '</div>' +
      '<div style="background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-xl);padding:18px 20px">' +
      '<div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-400);margin-bottom:12px">' + (c ? 'Pick a hook for your comment!' : 'Pick a hook for your question!') + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">' + cards + '</div>' +
      '<div style="margin-top:14px">' + hookHint + '</div></div>';
  }

  function stageTranscript() {
    var thread = '';
    for (var m = 0; m < state.moveIdx; m++) {
      var rec = state.records[m]; if (!rec) continue;
      var turn = Math.floor(m / 2), isC = m % 2 === 0, ff = facts()[turn]; if (!ff) continue;
      var lt;
      if (rec.level === 0) lt = isC ? ('(talked about ' + ff.topic + ')') : ('(asked about ' + ff.topic + ')');
      else lt = isC ? commentText(ff, rec.level) : (rec.level === 1 ? ('(asked about ' + ff.topic + ')') : volleyText(ff, rec.level));
      thread += '<div style="display:flex;gap:8px;align-items:flex-end;justify-content:flex-start"><div style="width:28px;height:28px;border-radius:999px;background:var(--pabg);display:flex;align-items:center;justify-content:center;font-size:15px;flex:0 0 auto">🦸</div>' +
        '<div style="max-width:78%;background:var(--pabg);color:var(--slate-800);border-radius:14px 14px 14px 4px;padding:9px 13px"><div style="font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;opacity:.65;margin-bottom:2px">Learner</div><div style="font-size:15px;line-height:1.4;font-weight:600">' + escHtml(lt) + '</div></div></div>';
      if (!isC) {
        var nf = facts()[turn + 1];
        var pt = nf ? ('Good question! Remember the part about ' + nf.topic + '?') : 'Good question! You really got to know them.';
        thread += '<div style="display:flex;gap:8px;align-items:flex-end;justify-content:flex-end;flex-direction:row-reverse"><div style="width:28px;height:28px;border-radius:999px;background:var(--sage-100);display:flex;align-items:center;justify-content:center;font-size:15px;flex:0 0 auto">🧑‍⚕️</div>' +
          '<div style="max-width:78%;background:var(--sage-100);color:var(--slate-700);border-radius:14px 14px 4px 14px;padding:9px 13px"><div style="font-size:9.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;opacity:.65;margin-bottom:2px">Partner</div><div style="font-size:15px;line-height:1.4;font-weight:600">' + escHtml(pt) + '</div></div></div>';
      }
    }
    return '<div style="background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-xl);padding:8px 8px 0;display:flex;flex-direction:column">' +
      '<div class="rcc-scroll" style="max-height:300px;overflow-y:auto;padding:12px 12px 4px;display:flex;flex-direction:column;gap:10px">' + thread + '</div>' +
      '<div style="border-top:1px dashed var(--sage-300);margin-top:4px;padding:14px 14px 16px;background:#fbfcf9;border-radius:0 0 var(--radius-xl) var(--radius-xl)">' +
      '<div style="font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-400);margin-bottom:9px">Your turn 🦸</div>' +
      '<div>' + hintNodeHTML(hintPayload()) + '</div></div></div>';
  }

  function stageMap() {
    var ct = curTurn();
    var nodes = facts().map(function (ff, ti) {
      var done = state.records[ti * 2] && state.records[ti * 2 + 1], current = ti === ct;
      var circle = done ? 'background:var(--pa);border:2px solid var(--pa);color:#fff' : current ? 'background:#fff;border:3px solid var(--pa);color:var(--pa)' : 'background:#fff;border:2px solid var(--sage-200);color:var(--slate-400)';
      return '<div style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;flex:1">' +
        '<div style="width:38px;height:38px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;' + circle + ';transition:all .2s">' + (done ? '✓' : (ti + 1)) + '</div>' +
        '<div style="font-size:11px;font-weight:' + (current ? '800' : '700') + ';color:' + (current ? 'var(--slate-800)' : 'var(--slate-400)') + ';text-align:center;max-width:100px;line-height:1.2;margin-top:7px">' + escHtml(ff.topic) + '</div></div>';
    }).join('');
    var steps = [{ key: 'Comment', icon: '💬', idx: 0 }, { key: 'Volley', icon: '🔁', idx: 1 }].map(function (s) {
      var rec = state.records[ct * 2 + s.idx], isCur = state.moveIdx === ct * 2 + s.idx;
      var ss = rec ? 'background:var(--pabg);color:var(--pa);border:1.5px solid var(--pa)' : isCur ? 'background:var(--pa);color:#fff;border:1.5px solid var(--pa)' : 'background:#fff;color:var(--slate-400);border:1.5px solid var(--sage-200)';
      return '<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:800;' + ss + '">' + s.icon + ' ' + s.key + ' ' + (rec ? '✓' : (isCur ? '●' : '○')) + '</span>';
    }).join('');
    return '<div style="background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-xl);padding:20px 20px 18px">' +
      '<div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-400);margin-bottom:16px">The conversation route</div>' +
      '<div style="position:relative;display:flex;justify-content:space-between;align-items:flex-start;padding:0 6px"><div style="position:absolute;top:19px;left:34px;right:34px;height:3px;background:var(--sage-200);border-radius:2px"></div>' + nodes + '</div>' +
      '<div style="border-top:1px dashed var(--sage-300);margin-top:16px;padding-top:14px"><div style="display:flex;align-items:center;gap:9px;margin-bottom:13px;flex-wrap:wrap"><span style="font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--slate-500)">You are here</span>' + steps + '</div>' +
      '<div>' + hintNodeHTML(hintPayload()) + '</div></div></div>';
  }

  function renderTalk() {
    var p = person(), c = isComment(), f = curFact(), fn = firstName();
    var move = { icon: c ? '💬' : '🔁', eyebrow: c ? 'Comment' : 'Volley', title: c ? ('Say something about ' + fn) : 'Ask a question back', prompt: c ? 'Make a comment' : 'Volley a question back', topic: f ? f.topic : '' };
    var stage = state.layout === 'spotlight' ? stageSpotlight(p, move) : state.layout === 'hooks' ? stageHooks(p, move, f, c) : state.layout === 'transcript' ? stageTranscript() : stageMap();

    var lowerHTML;
    if (state.beat) {
      var ct = curTurn(), beatTitle, beatPartner;
      if (isComment()) { beatTitle = "Partner's turn"; beatPartner = 'Say something back about what they shared (for example, “' + REACT[state.moveIdx % REACT.length] + '”), then ask if they have anything they want to ask you.'; }
      else {
        var nf = facts()[ct + 1], b = nf && nf.bridge;
        beatTitle = "Partner's turn: answer them";
        beatPartner = (ct + 1 < state.turnCount && b) ? ('Answer their question in your own words, then jog their memory, for example: “' + b + '”') : 'Answer their question in your own words, then tell them what a great chat that was.';
      }
      lowerHTML = '<div style="display:flex;gap:13px;align-items:center;margin-top:16px;flex-wrap:wrap;background:var(--sage-50);border:1px solid var(--sage-200);border-radius:var(--radius-lg);padding:13px 15px">' +
        '<span style="font-size:24px;flex:0 0 auto">🧑‍⚕️</span><div style="flex:1;min-width:160px"><div style="font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--sage-600)">' + beatTitle + '</div>' +
        '<div style="font-size:15px;color:var(--slate-700);font-weight:600;line-height:1.35;margin-top:2px">' + escHtml(beatPartner) + '</div></div>' +
        '<button data-act="continueBeat" style="flex:0 0 auto;padding:12px 22px;border:none;border-radius:var(--radius-md);background:var(--sage-500);color:#fff;font-size:15px;font-weight:800;cursor:pointer;box-shadow:var(--shadow-sm)">Continue →</button></div>';
    } else {
      var showErr = (state.errs && (state.errs[state.moveIdx] || 0) > 0);
      var errBar = showErr ? '<div style="display:flex;align-items:center;gap:8px;margin-top:14px;background:var(--amber-100);border:1px solid var(--amber-300);border-radius:var(--radius-md);padding:9px 13px;color:var(--amber-700);font-size:13px;font-weight:700"><span style="font-size:15px">↻</span>More help added. Model the prompt, then let them try again.</div>' : '';
      var lessOn = state.support > 0, moreOn = state.support < 3;
      lowerHTML = errBar + '<div style="display:flex;gap:12px;align-items:center;margin-top:14px;flex-wrap:wrap">' +
        '<div style="display:flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-pill);padding:5px 6px 5px 14px"><span style="font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--slate-500)">Support</span>' +
        '<span style="font-size:12.5px;font-weight:800;color:var(--pa);min-width:74px;text-align:center">' + LEVELS[state.support] + '</span>' +
        '<button data-act="less" title="Less help" style="width:32px;height:32px;border-radius:999px;border:1.5px solid ' + (lessOn ? 'var(--sage-300)' : 'var(--sage-200)') + ';background:#fff;color:' + (lessOn ? 'var(--sage-700)' : 'var(--slate-300)') + ';font-size:17px;font-weight:800;cursor:' + (lessOn ? 'pointer' : 'default') + '">–</button>' +
        '<button data-act="more" title="More help" style="width:32px;height:32px;border-radius:999px;border:1.5px solid ' + (moreOn ? 'var(--sage-300)' : 'var(--sage-200)') + ';background:' + (moreOn ? 'var(--sage-50)' : '#fff') + ';color:' + (moreOn ? 'var(--sage-700)' : 'var(--slate-300)') + ';font-size:16px;font-weight:800;cursor:' + (moreOn ? 'pointer' : 'default') + '">＋</button></div>' +
        '<div style="display:flex;gap:10px;margin-left:auto"><button data-act="miss" style="padding:12px 20px;border:1.5px solid var(--red-100);border-radius:var(--radius-md);background:var(--red-100);color:var(--red-700);font-size:15px;font-weight:800;cursor:pointer">Try again</button>' +
        '<button data-act="score" style="padding:12px 24px;border:none;border-radius:var(--radius-md);background:var(--green-700);color:#fff;font-size:15px;font-weight:800;cursor:pointer;box-shadow:var(--shadow-sm)">✓ Got it</button></div></div>';
    }

    var modal = '';
    if (state.pendingLayout) {
      var lname = (LAYOUT_DEFS.filter(function (d) { return d.k === state.pendingLayout; })[0] || {}).label || '';
      modal = '<div style="position:fixed;inset:0;z-index:50;background:var(--surface-overlay);display:flex;align-items:center;justify-content:center;padding:20px" data-act="cancelLayout">' +
        '<div data-stop="1" style="background:#fff;border-radius:var(--radius-xl);box-shadow:var(--shadow-modal);max-width:380px;width:100%;padding:22px 22px 18px">' +
        '<div style="font-size:17px;font-weight:800;color:var(--slate-900)">Switch to ' + escHtml(lname) + '?</div>' +
        '<div style="font-size:13.5px;color:var(--slate-600);line-height:1.5;margin-top:6px">Changing the layout restarts this chat from the first turn.</div>' +
        '<div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end"><button data-act="cancelLayout" style="padding:10px 16px;border:1.5px solid var(--sage-200);border-radius:var(--radius-md);background:#fff;color:var(--slate-500);font-size:13px;font-weight:700;cursor:pointer">Keep going</button>' +
        '<button data-act="confirmLayout" style="padding:10px 18px;border:none;border-radius:var(--radius-md);background:var(--sage-500);color:#fff;font-size:13px;font-weight:800;cursor:pointer">Switch &amp; restart</button></div></div></div>';
    }

    return '<div class="rcc-scroll" style="flex:1;overflow-y:auto;padding:0;--pa:' + p.accent + ';--pabg:' + p.accentBg + '">' +
      '<div style="max-width:900px;margin:0 auto;padding:20px 18px 36px;animation:fpg-fade .25s ease-out">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><span style="font-size:22px">' + move.icon + '</span>' +
      '<div><div style="font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--sage-600)">' + move.eyebrow + '</div><div style="font-size:17px;font-weight:800;color:var(--slate-900);line-height:1.15">' + escHtml(move.title) + '</div></div>' +
      '<span style="margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--pa);background:var(--pabg);border-radius:var(--radius-pill);padding:5px 12px">💬 ' + escHtml(move.topic) + '</span></div>' +
      stage + lowerHTML +
      '<div style="display:flex;gap:14px;margin-top:20px;justify-content:center"><button data-act="backMove" style="border:none;background:none;color:var(--slate-500);font-size:12.5px;font-weight:700;cursor:pointer">← Back</button>' +
      '<button data-act="finish" style="border:none;background:none;color:var(--slate-500);font-size:12.5px;font-weight:700;cursor:pointer;text-decoration:underline">Finish &amp; reward</button>' +
      '<button data-act="newPerson" style="border:none;background:none;color:var(--slate-500);font-size:12.5px;font-weight:700;cursor:pointer">New person</button></div>' +
      '</div>' + modal + '</div>';
  }

  // ── Reward / Wrap ──────────────────────────────────────────────────
  function rewardPresetsHTML() {
    return [1, 2, 3, 5].map(function (m) { return '<button data-act="setReward" data-arg="' + m + '" style="' + segStyle(state.tTotal === m * 60) + ';padding:7px 12px;font-size:12px">' + m + ' min</button>'; }).join('');
  }
  function timerControlsHTML() {
    if (state.tDone) return '<span style="font-size:13px;font-weight:800;color:var(--sage-700)">🎉 Time\'s up!</span>';
    var btn = state.tRun ? '⏸ Pause' : (state.tRem < state.tTotal ? '▶ Resume' : '▶ Start');
    return '<button data-act="timerToggle" style="padding:9px 16px;border:none;border-radius:var(--radius-md);background:var(--sage-500);color:#fff;font-size:13px;font-weight:800;cursor:pointer">' + btn + '</button>' +
      '<button data-act="timerReset" style="padding:9px 14px;border:1.5px solid var(--sage-300);border-radius:var(--radius-md);background:#fff;color:var(--sage-700);font-size:13px;font-weight:800;cursor:pointer">Reset</button>';
  }

  function renderWrap() {
    var p = person(), fn = firstName();
    var wallDefs = [
      { w: 94, h: 116, rot: '-6deg', pos: 'center 18%', delay: '0s', dur: '5s', z: 1, mt: '20px' },
      { w: 126, h: 150, rot: '3deg', pos: 'center 22%', delay: '.6s', dur: '6.2s', z: 3, mt: '0' },
      { w: 110, h: 132, rot: '-3deg', pos: 'center 14%', delay: '1.1s', dur: '5.5s', z: 2, mt: '10px' },
      { w: 86, h: 106, rot: '7deg', pos: 'center 26%', delay: '.3s', dur: '6.6s', z: 1, mt: '28px' }
    ];
    var wall = wallDefs.map(function (d) {
      return '<div class="fpg-float" style="--rot:' + d.rot + ';width:' + d.w + 'px;height:' + d.h + 'px;margin-top:' + d.mt + ';background:#fff;padding:5px 5px 15px;border-radius:5px;box-shadow:0 8px 20px rgba(17,24,39,.16);transform:rotate(' + d.rot + ');animation:fpg-float ' + d.dur + ' ease-in-out infinite alternate;animation-delay:' + d.delay + ';z-index:' + d.z + ';flex:0 0 auto">' +
        '<img src="' + escAttr(p.img) + '" alt="" referrerpolicy="no-referrer" data-imgerr style="width:100%;height:100%;object-fit:cover;object-position:' + d.pos + ';display:block;border-radius:3px" /></div>';
    }).join('');
    var review = facts().map(function (ff) { return '<div style="display:flex;gap:9px;align-items:flex-start"><span style="width:8px;height:8px;border-radius:999px;background:var(--pa);flex:0 0 auto;margin-top:7px"></span><span style="font-size:14px;color:var(--slate-700);line-height:1.4">' + escHtml(ff.text) + '</span></div>'; }).join('');
    var summary = state.records.map(function (r, m) {
      if (!r) return '';
      var turn = Math.floor(m / 2) + 1, isC = m % 2 === 0, indep = r.level === 0 && !r.corrected, corr = !!r.corrected;
      var outcome = corr ? 'Corrected' : (indep ? 'Independent' : 'Prompted');
      var pill = 'font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:3px 10px;border-radius:999px;background:' + (corr ? 'var(--amber-100)' : indep ? 'var(--green-100)' : 'var(--blue-50)') + ';color:' + (corr ? 'var(--amber-700)' : indep ? 'var(--green-800)' : 'var(--blue-700)');
      return '<div style="display:flex;align-items:center;gap:10px;font-size:13px"><span style="font-size:15px">' + (isC ? '💬' : '🔁') + '</span><span style="font-weight:700;color:var(--slate-700);flex:1">Turn ' + turn + ' · ' + (isC ? 'Comment' : 'Volley') + '</span><span style="' + pill + '">' + outcome + '</span><span style="font-size:11px;font-weight:700;color:var(--slate-400);min-width:66px;text-align:right">' + LEVELS[r.level] + '</span></div>';
    }).join('');

    return '<div class="rcc-scroll" style="flex:1;overflow-y:auto;padding:0;--pa:' + p.accent + ';--pabg:' + p.accentBg + '">' +
      '<div style="position:relative;overflow:hidden;background:radial-gradient(125% 92% at 50% 0,var(--pabg) 0,#eef1ea 60%);padding:32px 20px 24px">' +
      '<div aria-hidden="true" style="position:absolute;top:72px;left:50%;width:300px;height:300px;transform:translate(-50%,-50%);z-index:0;background:repeating-conic-gradient(from 0deg, rgba(214,170,60,.20) 0deg 5deg, transparent 5deg 16deg);-webkit-mask:radial-gradient(closest-side,#000 0,#000 26%,transparent 70%);mask:radial-gradient(closest-side,#000 0,#000 26%,transparent 70%);animation:fpg-burst 1s .1s ease-out both"></div>' +
      '<div aria-hidden="true" style="position:absolute;inset:0;z-index:3;pointer-events:none">' +
      '<span style="position:absolute;left:11%;top:44%;width:90px;height:90px;border-radius:50%;background:radial-gradient(circle,#fff 0,rgba(255,255,255,0) 68%);opacity:0;animation:fpg-flash 1.2s 1.5s ease-in-out 2"></span>' +
      '<span style="position:absolute;right:13%;top:34%;width:80px;height:80px;border-radius:50%;background:radial-gradient(circle,#fff 0,rgba(255,255,255,0) 68%);opacity:0;animation:fpg-flash 1.2s 2.3s ease-in-out 2"></span>' +
      '<span style="position:absolute;left:35%;top:62%;width:70px;height:70px;border-radius:50%;background:radial-gradient(circle,#fff 0,rgba(255,255,255,0) 68%);opacity:0;animation:fpg-flash 1.1s 3s ease-in-out 2"></span></div>' +
      '<div style="position:relative;z-index:2;text-align:center;animation:fpg-rise .4s ease-out"><div style="font-size:32px;line-height:1">🎉</div><h2 style="font-size:34px;font-weight:800;letter-spacing:-.5px;color:var(--slate-900);margin-top:4px">You did it!</h2><p style="font-size:14px;color:var(--slate-600);margin-top:4px">Thanks for chatting about ' + escHtml(fn) + '.</p></div>' +
      '<div style="position:relative;z-index:1;display:flex;justify-content:center;align-items:flex-end;gap:12px;margin-top:20px;min-height:172px">' + wall + '</div></div>' +
      '<div style="max-width:560px;margin:0 auto;padding:10px 20px 44px;display:flex;flex-direction:column;gap:16px">' +
      '<div style="--ink:' + state.ink + ';background:#fffdf5;border:1px solid var(--sage-200);border-radius:var(--radius-lg);box-shadow:var(--shadow-md);padding:20px 16px 16px;text-align:center;overflow:hidden">' +
      '<div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-400)">Thanks for chatting!</div>' +
      '<div style="margin-top:8px"><div class="fpg-auto" style="font-family:\'Dancing Script\',cursive;font-size:clamp(26px,6.4vw,44px);font-weight:700;line-height:1.1;color:var(--ink);clip-path:inset(0 100% 0 0);animation:fpg-sign 1.3s .35s ease-out forwards;white-space:nowrap">' + escHtml(p.name) + '</div>' +
      '<svg viewBox="0 0 240 26" style="width:min(72%,240px);height:18px;margin-top:0" aria-hidden="true"><path class="fpg-flourish" d="M8 15 C 60 3, 150 28, 232 9" fill="none" stroke="' + state.ink + '" stroke-width="3" stroke-linecap="round" stroke-dasharray="270" stroke-dashoffset="270" style="animation:fpg-draw .8s 1.45s ease-out forwards"></path></svg></div>' +
      '<div style="font-size:12px;color:var(--slate-400);margin-top:4px;font-weight:700">' + escHtml(p.tag) + ' · ' + escHtml(p.years) + '</div></div>' +
      '<div style="background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-lg);padding:16px 18px"><div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-500);margin-bottom:10px">What you talked about</div><div style="display:flex;flex-direction:column;gap:8px">' + review + '</div></div>' +
      '<div style="background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-lg);padding:16px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
      '<div style="position:relative;width:96px;height:96px;flex:0 0 auto;display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 200 200" style="position:absolute;inset:0;transform:rotate(-90deg)"><circle cx="100" cy="100" r="88" fill="none" stroke="#e0e3c2" stroke-width="15"></circle><circle id="rcc-ring" cx="100" cy="100" r="88" fill="none" stroke="var(--sage-500)" stroke-width="15" stroke-linecap="round" stroke-dasharray="552.9" style="stroke-dashoffset:' + ringOffset() + ';transition:stroke-dashoffset 1s linear"></circle></svg><div id="rcc-timer-text" style="font-size:21px;font-weight:800;color:var(--slate-900);letter-spacing:-1px">' + tFmt(state.tRem) + '</div></div>' +
      '<div style="flex:1;min-width:170px"><div style="font-size:14px;font-weight:800;color:var(--slate-900)">Reward break</div><div style="font-size:12px;color:var(--slate-500);line-height:1.4;margin-top:2px">Set a short timer, then follow with a preferred activity.</div>' +
      '<div id="rcc-reward-presets" style="display:' + (state.tRun ? 'none' : 'flex') + ';gap:5px;flex-wrap:wrap;margin-top:9px">' + rewardPresetsHTML() + '</div>' +
      '<div id="rcc-timer-controls" style="display:flex;gap:8px;margin-top:10px;align-items:center">' + timerControlsHTML() + '</div></div></div>' +
      '<div style="background:#fff;border:1px solid var(--sage-200);border-radius:var(--radius-lg);padding:16px 18px"><div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--slate-500);margin-bottom:10px">Conversation data</div><div style="display:flex;flex-direction:column;gap:7px">' + summary + '</div>' +
      '<div style="display:flex;gap:10px;margin-top:16px"><button data-act="print" style="flex:1;padding:11px;border:1.5px solid var(--sage-300);border-radius:var(--radius-md);background:#fff;color:var(--sage-700);font-size:13px;font-weight:800;cursor:pointer">🖨 Print data</button>' +
      '<button data-act="newPerson" style="flex:1;padding:11px;border:none;border-radius:var(--radius-md);background:var(--sage-500);color:#fff;font-size:13px;font-weight:800;cursor:pointer">New person →</button></div></div>' +
      '</div></div>';
  }

  // ══════════════════════════════════════════════════════════════════
  //  EVENTS
  // ══════════════════════════════════════════════════════════════════
  var ACTIONS = {
    toggleRefs: function () { setState(function (s) { return { showRefs: !s.showRefs }; }); },
    setLayout: function (a) { setState({ layout: a }); },
    setMethod: function (a) { setState({ method: a, support: a === 'mtl' ? state.startSupport : 0 }); },
    setStart: function (a) { var l = +a; setState({ startSupport: l, support: state.method === 'mtl' ? l : 0 }); },
    setTurns: function (a) { setState({ turnCount: +a }); },
    togglePersist: function () { setState(function (s) { return { persist: !s.persist }; }); },
    toggleKaraoke: function () { setState(function (s) { return { karaoke: !s.karaoke }; }); },
    begin: begin,
    revealNext: revealNext,
    startTalk: startTalk,
    newPerson: newPerson,
    toggleSearch: toggleSearch,
    closeSearch: closeSearch,
    pickIndex: function (a) { pickIndex(+a); },
    suggest: suggestPerson,
    requestLayout: function (a) { requestLayout(a); },
    confirmLayout: confirmLayout,
    cancelLayout: cancelLayout,
    selectHook: function (a) { selectHook(a); },
    toggleImg: function () { setState(function (s) { return { imgFull: !s.imgFull }; }); },
    less: less, more: more, score: score, miss: miss, continueBeat: continueBeat,
    backMove: backMove, finish: finish, home: home,
    // reward (imperative — do not re-render)
    setReward: function (a) { if (state.phase === 'wrap') setReward(+a); else setState({ tTotal: (+a) * 60, tRem: (+a) * 60 }); },
    timerToggle: timerToggle, timerReset: timerReset, print: printData
  };

  root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t || !root.contains(t)) return;
    var act = t.getAttribute('data-act');
    // modal backdrop: only fire when the backdrop itself is clicked
    if (act === 'cancelLayout' && e.target.closest('[data-stop]')) return;
    var fn = ACTIONS[act];
    if (fn) { e.preventDefault(); fn(t.getAttribute('data-arg')); }
  });

  // Delegated image-error fallback
  root.addEventListener('error', function (e) { var el = e.target; if (el && el.hasAttribute && el.hasAttribute('data-imgerr')) imgErr(el); }, true);

  // Search input — update only the results sublist (keeps focus/caret).
  function bindSearchInput(inp) {
    if (inp._bound) return; inp._bound = true;
    inp.addEventListener('input', function () {
      state.searchQuery = inp.value; state.suggest = '';
      var host = document.getElementById('rcc-search-results');
      if (host) host.innerHTML = searchResultsHTML();
    });
  }

  // ── Boot ───────────────────────────────────────────────────────────
  function assignAccents(list) {
    list.forEach(function (p, i) { if (!p.accent) { var pr = PALETTE[i % PALETTE.length]; p.accent = pr[0]; p.accentBg = pr[1]; } });
    return list;
  }
  fetch('people.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
    .then(function (data) {
      var list = Array.isArray(data) ? data : (data && data.people) || [];
      PEOPLE = assignAccents(list.filter(function (p) { return p && p.name && p.facts && p.facts.length; }));
      render();
    })
    .catch(function () { PEOPLE = []; render(); });
})();
