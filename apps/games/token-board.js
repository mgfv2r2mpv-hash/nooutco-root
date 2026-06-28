'use strict';

/*
 * NooutcoTokens — shared FR/VR token board.
 *
 * Encapsulates the canonical reinforcement-schedule logic (Fixed Ratio /
 * Variable Ratio) and the token-board DOM contract used by the games, so games
 * that lacked a token board can gain one without re-implementing the math.
 *
 * Canonical DOM IDs (must exist on the page; same as the market game so the
 * Playwright contract holds):
 *   #chk-token-board, #token-settings,
 *   #sel-schedule-type, #inp-schedule-value, #inp-starting-tokens,
 *   #inp-goal-tokens, #sel-token-emoji,
 *   #token-board, #token-emoji-display, #token-progress-text
 *
 * API (window.NooutcoTokens.create(opts) → controller):
 *   opts.namespace  string   localStorage key suffix (required, e.g. 'emotionID')
 *   opts.onGoal()            fired once when currentTokens first reaches goal
 *   opts.onAward(n)          fired after each awarded trial (n = currentTokens)
 *   controller.award()       call on each correct/independent trial
 *   controller.startSession()reset tokens to starting + re-pick random emoji
 *   controller.reset()       alias for startSession
 *   controller.isEnabled()   boolean
 *   controller.isGoalMet()   boolean
 *   controller.getConfig()   current persisted config snapshot
 */
(function () {
  const EMOJI_POOL = ['⭐', '🔷', '💎', '✨', '🎁', '🏆', '💫', '🌟'];
  const DISPLAY_CAP = 20;

  function $(id) {
    return document.getElementById(id);
  }
  function pickRandomEmoji() {
    return EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)];
  }

  // VR schedule: one reinforcement placed randomly within each chunk of `vrValue`
  // trials — average rate ~1/vrValue with no gap exceeding ~1.5x the interval.
  function generateVRSchedule(numTrials, vrValue) {
    const itemsPerChunk = Math.max(1, Math.ceil(vrValue));
    const indices = [];
    for (let i = 0; i < numTrials; i += itemsPerChunk) {
      const chunkEnd = Math.min(i + itemsPerChunk, numTrials);
      indices.push(Math.floor(Math.random() * (chunkEnd - i)) + i);
    }
    return indices.sort((a, b) => a - b);
  }

  function create(opts) {
    opts = opts || {};
    const namespace = opts.namespace || 'default';
    const KEY = 'noaba.tokens.' + namespace + '.v1';
    const onGoal = typeof opts.onGoal === 'function' ? opts.onGoal : function () {};
    const onAward = typeof opts.onAward === 'function' ? opts.onAward : function () {};

    const el = {
      chk: $('chk-token-board'),
      settings: $('token-settings'),
      schedType: $('sel-schedule-type'),
      schedValue: $('inp-schedule-value'),
      starting: $('inp-starting-tokens'),
      goal: $('inp-goal-tokens'),
      emoji: $('sel-token-emoji'),
      board: $('token-board'),
      emojiDisplay: $('token-emoji-display'),
      progressText: $('token-progress-text'),
    };

    const cfg = {
      enabled: false,
      scheduleType: 'FR',
      scheduleValue: 1,
      startingTokens: 0,
      goalTokens: 10,
      tokenEmoji: 'random',
    };

    const run = {
      currentTokens: 0,
      chosenEmoji: '⭐',
      trialsCompleted: 0,
      vrSchedule: [],
      vrScheduleTrial: 0,
      goalFired: false,
    };

    function load() {
      try {
        const s = JSON.parse(localStorage.getItem(KEY));
        if (s) {
          cfg.enabled = s.enabled ?? cfg.enabled;
          cfg.scheduleType = s.scheduleType ?? cfg.scheduleType;
          cfg.scheduleValue = s.scheduleValue ?? cfg.scheduleValue;
          cfg.startingTokens = s.startingTokens ?? cfg.startingTokens;
          cfg.goalTokens = s.goalTokens ?? cfg.goalTokens;
          cfg.tokenEmoji = s.tokenEmoji ?? cfg.tokenEmoji;
        }
      } catch (_) {}
    }
    function save() {
      try {
        localStorage.setItem(KEY, JSON.stringify(cfg));
      } catch (_) {}
    }

    function syncControlsFromCfg() {
      if (!el.chk) return;
      el.chk.checked = cfg.enabled;
      el.schedType.value = cfg.scheduleType;
      el.schedValue.value = cfg.scheduleValue;
      el.starting.value = cfg.startingTokens;
      el.goal.value = cfg.goalTokens;
      el.emoji.value = cfg.tokenEmoji;
    }

    function updateSettingsVisibility() {
      if (el.settings) el.settings.style.display = cfg.enabled ? 'block' : 'none';
    }

    function startSession() {
      run.trialsCompleted = 0;
      run.vrScheduleTrial = 0;
      run.goalFired = false;
      run.chosenEmoji = cfg.tokenEmoji === 'random' ? pickRandomEmoji() : cfg.tokenEmoji;
      if (cfg.scheduleType === 'VR') {
        run.vrSchedule = generateVRSchedule(1000, cfg.scheduleValue);
      }
      run.currentTokens = cfg.startingTokens;
      if (el.board) el.board.hidden = !cfg.enabled;
      render();
    }

    function shouldAward() {
      if (cfg.scheduleType === 'FR') {
        return run.trialsCompleted % cfg.scheduleValue === 0;
      }
      // VR
      if (run.vrScheduleTrial >= run.vrSchedule.length) {
        const offset = run.trialsCompleted;
        run.vrSchedule = generateVRSchedule(1000, cfg.scheduleValue).map((i) => i + offset);
        run.vrScheduleTrial = 0;
      }
      const award = run.vrSchedule[run.vrScheduleTrial] === run.trialsCompleted;
      if (award) run.vrScheduleTrial++;
      return award;
    }

    function award() {
      if (!cfg.enabled) return;
      run.trialsCompleted++;
      if (shouldAward() && run.currentTokens < cfg.goalTokens) {
        run.currentTokens++;
        onAward(run.currentTokens);
      }
      render();
    }

    function render() {
      if (!cfg.enabled || !el.board) return;
      if (el.emojiDisplay) {
        el.emojiDisplay.textContent = run.chosenEmoji.repeat(Math.min(run.currentTokens, DISPLAY_CAP));
      }
      if (el.progressText) {
        el.progressText.textContent = run.currentTokens + ' / ' + cfg.goalTokens;
      }
      const met = run.currentTokens >= cfg.goalTokens;
      el.board.classList.toggle('goal-reached', met);
      if (met && !run.goalFired) {
        run.goalFired = true;
        onGoal();
      }
    }

    function wire() {
      if (!el.chk) return;
      el.chk.addEventListener('change', () => {
        cfg.enabled = el.chk.checked;
        updateSettingsVisibility();
        if (el.board) {
          el.board.hidden = !cfg.enabled;
          // Clear goal-reached when disabling so anything keyed off it (e.g.
          // attachGoalSR / Finish & SR) doesn't linger while the board is off.
          if (!cfg.enabled) {
            el.board.classList.remove('goal-reached');
            run.goalFired = false;
          }
        }
        if (cfg.enabled) startSession();
        save();
      });
      el.schedType.addEventListener('change', () => {
        cfg.scheduleType = el.schedType.value;
        save();
        if (cfg.enabled) startSession();
      });
      el.schedValue.addEventListener('change', () => {
        cfg.scheduleValue = parseInt(el.schedValue.value, 10) || 1;
        el.schedValue.value = cfg.scheduleValue;
        save();
        if (cfg.enabled) startSession();
      });
      el.starting.addEventListener('change', () => {
        cfg.startingTokens = parseInt(el.starting.value, 10) || 0;
        el.starting.value = cfg.startingTokens;
        run.currentTokens = cfg.startingTokens;
        run.goalFired = false;
        save();
        render();
      });
      el.goal.addEventListener('change', () => {
        cfg.goalTokens = parseInt(el.goal.value, 10) || 10;
        el.goal.value = cfg.goalTokens;
        run.goalFired = false;
        save();
        render();
      });
      el.emoji.addEventListener('change', () => {
        cfg.tokenEmoji = el.emoji.value;
        save();
        if (cfg.enabled) startSession();
      });
    }

    // init
    load();
    syncControlsFromCfg();
    updateSettingsVisibility();
    wire();
    if (cfg.enabled) {
      startSession();
    } else if (el.board) {
      el.board.hidden = true;
    }

    return {
      award,
      startSession,
      reset: startSession,
      render,
      isEnabled: () => cfg.enabled,
      isGoalMet: () => run.currentTokens >= cfg.goalTokens,
      getConfig: () => Object.assign({}, cfg),
      getTokens: () => run.currentTokens,
    };
  }

  window.NooutcoTokens = { create };
})();
