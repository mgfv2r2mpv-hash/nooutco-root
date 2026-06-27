'use strict';

/*
 * token-board-ui.js — drop-in token board for games that don't ship their own.
 *
 * Injects the ⭐ star toggle + canonical FR/VR settings into #extra-panel-body,
 * a token-board display + "Finish & SR" button after #game-area, and wires it
 * all to the shared NooutcoTokens + NooutcoReward modules. The host game only
 * needs to: load reward.js, token-board.js, then this file (with
 * data-namespace), and call window.__nooutcoTokens.award() at its correct-answer
 * point.
 *
 * Requires NooutcoTokens and NooutcoReward to be loaded first.
 */
(function () {
  var ns = (document.currentScript && document.currentScript.dataset.namespace) || 'game';

  var EMOJI_OPTS = [
    ['random', 'Random (each session)'], ['⭐', '⭐ Star'], ['🔷', '🔷 Diamond'],
    ['💎', '💎 Gem'], ['✨', '✨ Sparkle'], ['🎁', '🎁 Gift'], ['🏆', '🏆 Trophy'],
    ['💫', '💫 Dizzy'], ['🌟', '🌟 Glowing Star'],
  ];

  function injectSettings() {
    var panel = document.getElementById('extra-panel-body') ||
      document.querySelector('#extra-panel .extra-panel-body');
    if (!panel || document.getElementById('chk-token-board')) return;
    var emojiOptions = EMOJI_OPTS.map(function (o) {
      return '<option value="' + o[0] + '">' + o[1] + '</option>';
    }).join('');
    var wrap = document.createElement('div');
    wrap.className = 'token-board-settings-divider';
    wrap.style.cssText = 'grid-column:1/-1;border-top:1px solid var(--border-default);padding-top:12px;margin-top:4px';
    wrap.innerHTML =
      '<span class="option-toggle option-toggle--star" id="chk-token-board-btn" role="switch" aria-checked="false" tabindex="0">' +
        '<span class="option-toggle-ico" aria-hidden="true">⭐</span> Token Board' +
        '<button type="button" class="help-btn" data-help="Track tokens on a Fixed Ratio (FR) or Variable Ratio (VR) schedule. When the goal is met, a Finish &amp; SR button appears.">?</button>' +
      '</span>' +
      '<input type="checkbox" id="chk-token-board" style="position:absolute;opacity:0;pointer-events:none;width:0;height:0">' +
      '<div id="token-settings" style="display:none;margin-top:12px">' +
        '<div class="extra-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">' +
          '<label for="sel-schedule-type">Schedule</label>' +
          '<select id="sel-schedule-type"><option value="FR">Fixed Ratio (FR)</option><option value="VR">Variable Ratio (VR)</option></select>' +
          '<input type="number" id="inp-schedule-value" min="1" max="100" value="1" style="width:50px">' +
        '</div>' +
        '<div class="extra-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
          '<label for="inp-starting-tokens">Starting Tokens</label>' +
          '<input type="number" id="inp-starting-tokens" min="0" max="1000" value="0" style="width:70px">' +
        '</div>' +
        '<div class="extra-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
          '<label for="inp-goal-tokens">Goal Tokens</label>' +
          '<input type="number" id="inp-goal-tokens" min="1" max="1000" value="10" style="width:70px">' +
        '</div>' +
        '<div class="extra-row" style="display:flex;gap:8px;align-items:center">' +
          '<label for="sel-token-emoji">Token Emoji</label>' +
          '<select id="sel-token-emoji">' + emojiOptions + '</select>' +
        '</div>' +
      '</div>';
    panel.appendChild(wrap);
  }

  function injectBoard() {
    if (document.getElementById('token-board')) return;
    var anchor = document.getElementById('game-area');
    var board = document.createElement('div');
    board.id = 'token-board';
    board.className = 'noaba-token-board';
    board.hidden = true;
    board.setAttribute('aria-label', 'Token progress tracker');
    board.innerHTML =
      '<div class="token-board-content">' +
        '<div id="token-emoji-display" class="token-display"></div>' +
        '<div id="token-progress-text" class="token-progress-text">0 / 10</div>' +
      '</div>';
    var row = document.createElement('div');
    row.className = 'finish-sr-row';
    row.style.cssText = 'display:flex;justify-content:center;margin:10px 0';
    row.innerHTML = '<button type="button" id="btn-finish-sr" class="finish-sr-btn" hidden>⭐ Finish &amp; SR</button>';
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(board, anchor.nextSibling);
      board.parentNode.insertBefore(row, board.nextSibling);
    } else {
      document.body.appendChild(board);
      document.body.appendChild(row);
    }
  }

  function wireStarToggle() {
    var star = document.getElementById('chk-token-board-btn');
    var chk = document.getElementById('chk-token-board');
    var finishBtn = document.getElementById('btn-finish-sr');
    if (!star || !chk) return;
    function sync() { star.setAttribute('aria-checked', String(chk.checked)); }
    function toggle(ev) {
      if (ev.target.closest('.help-btn')) return;
      chk.checked = !chk.checked;
      chk.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      if (!chk.checked && finishBtn) finishBtn.hidden = true;
    }
    star.addEventListener('click', toggle);
    star.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(ev); }
    });
    sync();
  }

  function init() {
    if (!window.NooutcoTokens || !window.NooutcoReward) return;
    injectSettings();
    injectBoard();

    var finishBtn = document.getElementById('btn-finish-sr');
    var board = document.getElementById('token-board');

    window.__nooutcoTokens = window.NooutcoTokens.create({
      namespace: ns,
      onGoal: function () {
        if (finishBtn) finishBtn.hidden = false;
        window.NooutcoReward.celebrate(board);
      },
    });

    wireStarToggle();

    if (finishBtn) {
      finishBtn.addEventListener('click', function () {
        window.NooutcoReward.openSR({
          minutes: 5,
          onBack: function () {
            finishBtn.hidden = !board.classList.contains('goal-reached');
          },
        });
      });
    }

    var start = document.getElementById('btn-start');
    if (start) {
      start.addEventListener('click', function () {
        window.__nooutcoTokens.startSession();
        if (finishBtn) finishBtn.hidden = true;
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
