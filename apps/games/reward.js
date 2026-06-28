'use strict';

/*
 * NooutcoReward — shared SR (reinforcement) experience.
 *
 * Ported from the famous-person game's SR screen so every game can deliver the
 * same reinforcement when a learner earns their goal: a 5:00 countdown ring with
 * a Web-Audio chime, floating particles, and a "go back" return.
 *
 * Self-injects its own <style> and overlay markup (same convention as
 * tooltip-help.js) so it needs no Tailwind rebuild and no per-game markup.
 *
 * API (window.NooutcoReward):
 *   openSR({ minutes = 5, title = 'SR Timer', onBack })  → full-screen SR timer
 *   celebrate(anchorEl)                                  → quick burst + chime
 *   playChime()                                          → ascending 3-note chime
 *   mountSR()                                            → ensure markup exists (idempotent)
 */
(function () {
  const RING_R = 93;
  const RING_CIRC = 2 * Math.PI * RING_R; // ≈ 584.3
  const DEFAULT_MINUTES = 5;

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    total: DEFAULT_MINUTES * 60,
    remaining: DEFAULT_MINUTES * 60,
    running: false,
    interval: null,
    onBack: null,
    mounted: false,
  };

  let els = null;

  // ── Audio: ascending 3-note chime (C5, E5, G5) ──────────────────────────────
  function playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523, 659, 784];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = ctx.currentTime + i * 0.32;
        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
        osc.start(t);
        osc.stop(t + 1.2);
        // Release the AudioContext once the final note has finished so we don't
        // accumulate contexts / keep audio resources alive after the chime.
        if (i === notes.length - 1) {
          osc.onended = () => { if (ctx.state !== 'closed') ctx.close().catch(() => {}); };
        }
      });
    } catch (_) {
      /* AudioContext unavailable — silent fallback */
    }
  }

  // ── Styles (injected once) ──────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('noaba-sr-styles')) return;
    const style = document.createElement('style');
    style.id = 'noaba-sr-styles';
    style.textContent = `
      #noaba-sr-overlay {
        position: fixed; inset: 0; z-index: 200;
        display: none; align-items: center; justify-content: center;
        background: var(--surface-page, #f9fafb);
      }
      #noaba-sr-overlay.open { display: flex; }
      .noaba-sr-card {
        display: flex; flex-direction: column; align-items: center;
        gap: 28px; width: 100%; max-width: 400px; padding: 24px;
        text-align: center;
      }
      .noaba-sr-title {
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 28px; font-weight: 900;
        color: var(--text-primary, #111827); letter-spacing: -0.5px;
      }
      .noaba-timer-container {
        position: relative; width: 240px; height: 240px;
        display: flex; align-items: center; justify-content: center;
      }
      .noaba-progress-ring {
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        transform: rotate(-90deg);
      }
      .noaba-ring-bg { fill: none; stroke: var(--slate-200, #e5e7eb); stroke-width: 14; }
      .noaba-ring-fg {
        fill: none; stroke: var(--sage-500, #6a7659); stroke-width: 14;
        stroke-linecap: round;
        stroke-dasharray: ${RING_CIRC.toFixed(0)};
        stroke-dashoffset: 0;
        transition: stroke-dashoffset 1s linear;
      }
      .noaba-timer-display {
        position: relative; z-index: 1;
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 56px; font-weight: 900;
        color: var(--text-primary, #111827); letter-spacing: -3px;
      }
      .noaba-timer-display.tick { animation: noaba-pulse-tick .28s ease-out; }
      @keyframes noaba-pulse-tick {
        0% { transform: scale(1); } 45% { transform: scale(1.045); } 100% { transform: scale(1); }
      }
      .noaba-particles {
        position: absolute; inset: 0; pointer-events: none;
        overflow: hidden; border-radius: 50%;
      }
      .noaba-particle {
        position: absolute; border-radius: 50%;
        background: var(--sage-500, #6a7659); opacity: 0.22;
        animation: noaba-float-up linear infinite;
      }
      @keyframes noaba-float-up {
        0% { transform: translateY(0) translateX(0); opacity: .22; }
        60% { opacity: .35; }
        100% { transform: translateY(-230px) translateX(var(--drift, 0px)); opacity: 0; }
      }
      .noaba-timer-controls { display: flex; gap: 14px; width: 100%; }
      .noaba-timer-controls button { flex: 1; }
      .noaba-btn {
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: var(--text-lg, 16px); font-weight: 700;
        border-radius: var(--radius-lg, 8px); padding: 10px 18px;
        cursor: pointer; border: 1.5px solid transparent;
        transition: background .15s ease, transform .15s ease, box-shadow .15s ease;
      }
      .noaba-btn:active { transform: scale(.97); }
      .noaba-btn-primary {
        background: var(--brand-primary, #6a7659); color: #fff;
        box-shadow: var(--shadow-sm, 0 1px 3px rgba(17,24,39,.1));
      }
      .noaba-btn-primary:hover { background: var(--brand-primary-hover, #5d6a4d); }
      .noaba-btn-outline {
        background: var(--surface-card, #fff); color: var(--text-body, #374151);
        border-color: var(--border-strong, #d1d5db);
      }
      .noaba-btn-outline:hover { background: var(--surface-sunken, #f3f4f6); }
      .noaba-btn-large { font-size: var(--text-xl, 18px); padding: 12px 28px; }
      .noaba-timer-done {
        display: flex; flex-direction: column; align-items: center; gap: 14px;
        animation: noaba-fade-in .4s ease-out;
      }
      @keyframes noaba-fade-in {
        from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); }
      }
      .noaba-done-emoji { font-size: 80px; line-height: 1; }
      .noaba-done-text {
        font-family: var(--font-sans, system-ui, sans-serif);
        font-size: 26px; font-weight: 800; color: var(--text-primary, #111827);
      }
      .noaba-hidden { display: none !important; }
      @media (prefers-reduced-motion: reduce) {
        .noaba-ring-fg { transition: none; }
        .noaba-timer-display.tick { animation: none; }
        .noaba-particle { display: none; }
      }
      @media (max-width: 480px) {
        .noaba-timer-container { width: 200px; height: 200px; }
        .noaba-timer-display { font-size: 46px; letter-spacing: -2px; }
        .noaba-sr-title { font-size: 22px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Markup (injected once) ──────────────────────────────────────────────────
  function mountSR() {
    if (state.mounted) return;
    injectStyles();
    const overlay = document.createElement('div');
    overlay.id = 'noaba-sr-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Reinforcement timer');
    overlay.innerHTML = `
      <div class="noaba-sr-card">
        <h2 class="noaba-sr-title" id="noaba-sr-title">SR Timer</h2>
        <div class="noaba-timer-container">
          <svg class="noaba-progress-ring" viewBox="0 0 200 200" aria-hidden="true">
            <circle class="noaba-ring-bg" cx="100" cy="100" r="${RING_R}"></circle>
            <circle class="noaba-ring-fg" id="noaba-ring-fg" cx="100" cy="100" r="${RING_R}"></circle>
          </svg>
          <div class="noaba-timer-display" id="noaba-timer-display">5:00</div>
          <div class="noaba-particles" id="noaba-particles"></div>
        </div>
        <div class="noaba-timer-controls" id="noaba-timer-controls">
          <button class="noaba-btn noaba-btn-primary" id="noaba-play-pause">▶ Start</button>
          <button class="noaba-btn noaba-btn-outline" id="noaba-stop">■ Stop</button>
        </div>
        <div class="noaba-timer-done noaba-hidden" id="noaba-timer-done">
          <div class="noaba-done-emoji">🎉</div>
          <p class="noaba-done-text">Nice work!</p>
          <button class="noaba-btn noaba-btn-primary noaba-btn-large" id="noaba-back">Go back</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    els = {
      overlay,
      title: overlay.querySelector('#noaba-sr-title'),
      ring: overlay.querySelector('#noaba-ring-fg'),
      display: overlay.querySelector('#noaba-timer-display'),
      particles: overlay.querySelector('#noaba-particles'),
      controls: overlay.querySelector('#noaba-timer-controls'),
      done: overlay.querySelector('#noaba-timer-done'),
      playPause: overlay.querySelector('#noaba-play-pause'),
      stop: overlay.querySelector('#noaba-stop'),
      back: overlay.querySelector('#noaba-back'),
    };

    els.playPause.addEventListener('click', () => {
      state.running ? pauseTimer() : startTimer();
    });
    els.stop.addEventListener('click', showTimerDone);
    els.back.addEventListener('click', () => {
      resetTimer();
      hide();
      if (typeof state.onBack === 'function') state.onBack();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.overlay.classList.contains('open')) {
        resetTimer();
        hide();
        if (typeof state.onBack === 'function') state.onBack();
      }
    });

    state.mounted = true;
  }

  // ── Timer mechanics ─────────────────────────────────────────────────────────
  function formatTime(secs) {
    return Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
  }
  function updateRing() {
    const offset = (1 - state.remaining / state.total) * RING_CIRC;
    els.ring.style.strokeDashoffset = offset.toFixed(2);
  }
  function tickPulse() {
    if (reduceMotion) return;
    const el = els.display;
    el.classList.remove('tick');
    void el.offsetWidth;
    el.classList.add('tick');
  }
  function timerTick() {
    if (state.remaining <= 0) {
      clearInterval(state.interval);
      state.interval = null;
      state.running = false;
      els.display.textContent = '0:00';
      updateRing();
      playChime();
      showTimerDone();
      return;
    }
    state.remaining--;
    els.display.textContent = formatTime(state.remaining);
    updateRing();
    tickPulse();
  }
  function startTimer() {
    if (state.running) return;
    state.running = true;
    els.playPause.textContent = '⏸ Pause';
    state.interval = setInterval(timerTick, 1000);
  }
  function pauseTimer() {
    clearInterval(state.interval);
    state.interval = null;
    state.running = false;
    els.playPause.textContent = '▶ Resume';
  }
  function showTimerDone() {
    clearInterval(state.interval);
    state.interval = null;
    state.running = false;
    els.controls.classList.add('noaba-hidden');
    els.done.classList.remove('noaba-hidden');
  }
  function resetTimer() {
    clearInterval(state.interval);
    state.interval = null;
    state.running = false;
    state.remaining = state.total;
    els.display.textContent = formatTime(state.total);
    els.ring.style.transition = 'none';
    els.ring.style.strokeDashoffset = '0';
    requestAnimationFrame(() => {
      els.ring.style.transition = '';
    });
    els.playPause.textContent = '▶ Start';
    els.controls.classList.remove('noaba-hidden');
    els.done.classList.add('noaba-hidden');
  }

  // ── Particles ───────────────────────────────────────────────────────────────
  function createParticles(container) {
    if (reduceMotion || !container) return;
    container.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      const p = document.createElement('div');
      p.className = 'noaba-particle';
      const size = 5 + Math.random() * 9;
      const left = 15 + Math.random() * 70;
      const dur = 3.2 + Math.random() * 3;
      const del = -(Math.random() * dur);
      const dft = ((Math.random() - 0.5) * 50).toFixed(1);
      p.style.cssText =
        `width:${size}px;height:${size}px;left:${left}%;bottom:8%;` +
        `animation-duration:${dur}s;animation-delay:${del}s;--drift:${dft}px;`;
      container.appendChild(p);
    }
  }

  function show() {
    els.overlay.classList.add('open');
  }
  function hide() {
    els.overlay.classList.remove('open');
  }

  // ── Public: open the full SR timer screen ───────────────────────────────────
  function openSR(opts) {
    opts = opts || {};
    mountSR();
    const minutes = typeof opts.minutes === 'number' && opts.minutes > 0 ? opts.minutes : DEFAULT_MINUTES;
    state.total = Math.round(minutes * 60);
    state.remaining = state.total;
    state.onBack = opts.onBack || null;
    els.title.textContent = opts.title || 'SR Timer';
    resetTimer();
    createParticles(els.particles);
    show();
  }

  // ── Public: quick celebratory burst at the moment a goal is hit ──────────────
  function celebrate(anchorEl) {
    playChime();
    if (reduceMotion) return;
    injectStyles();
    const burst = document.createElement('div');
    burst.className = 'noaba-particles';
    let rect = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    if (anchorEl && anchorEl.getBoundingClientRect) rect = anchorEl.getBoundingClientRect();
    burst.style.cssText =
      `position:fixed;left:${rect.left}px;top:${rect.top}px;` +
      `width:${rect.width}px;height:${rect.height}px;z-index:210;border-radius:0;`;
    document.body.appendChild(burst);
    createParticles(burst);
    setTimeout(() => burst.remove(), 2600);
  }

  // ── Public: decoupled goal → SR wiring for games that already track a
  // token goal. Watches the token board for the `goal-reached` class (added by
  // the game's own render) and, without touching that game's logic, pops a
  // "Finish & SR" button + a celebratory burst. ──────────────────────────────
  function attachGoalSR(opts) {
    opts = opts || {};
    const board = document.getElementById(opts.boardId || 'token-board');
    const btn = document.getElementById(opts.buttonId || 'btn-finish-sr');
    if (!board || !btn) return null;
    const minutes = typeof opts.minutes === 'number' ? opts.minutes : DEFAULT_MINUTES;
    let fired = false;

    // The goal is "met" only when the board both carries the goal-reached class
    // AND is visible. Games disable the token board by setting board.hidden =
    // true; without checking that, the Finish & SR button could linger after the
    // board is turned off.
    function isMet() {
      return board.classList.contains('goal-reached') && !board.hidden;
    }
    function sync() {
      const met = isMet();
      if (met && !fired) {
        fired = true;
        btn.hidden = false;
        celebrate(board);
      } else if (!met && fired) {
        fired = false;
        btn.hidden = true;
      }
    }
    btn.addEventListener('click', () => {
      openSR({
        minutes: minutes,
        title: opts.title || 'SR Timer',
        onBack: () => { btn.hidden = !isMet(); },
      });
    });
    new MutationObserver(sync).observe(board, { attributes: true, attributeFilter: ['class', 'hidden'] });
    sync();
    return { sync };
  }

  window.NooutcoReward = { mountSR, openSR, celebrate, playChime, attachGoalSR };
})();
