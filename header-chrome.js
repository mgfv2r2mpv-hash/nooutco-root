/* header-chrome.js — shared toolbar behaviour for all games
   Handles: version label, minimize toggle, two-tap back guard, display-mode toggle. */
(function () {
  /* Version label */
  var v = window.APP_VERSION || '0.1.0';
  var vl = document.getElementById('app-version-label');
  if (vl) vl.textContent = v;

  /* Minimize / expand settings panel */
  var header = document.getElementById('app-header');
  var minBtn = document.getElementById('btn-minimize');

  function setCollapsed(collapsed) {
    document.body.classList.toggle('settings-collapsed', collapsed);
    if (minBtn) {
      minBtn.setAttribute('aria-expanded', String(!collapsed));
      minBtn.textContent = collapsed ? '▸' : '▾';
    }
  }

  if (header) header.addEventListener('click', function (e) {
    if (e.target.closest('a, select, input, label')) return;
    var btn = e.target.closest('button');
    if (btn && btn.id !== 'btn-minimize') return;
    setCollapsed(!document.body.classList.contains('settings-collapsed'));
  });

  /* Two-tap back confirm — prevents accidental exit during a session */
  var back = document.getElementById('btn-back');
  if (back) {
    var armed = false, timer = null, label = back.querySelector('.back-label');
    back.addEventListener('click', function (e) {
      if (!armed) {
        e.preventDefault();
        armed = true;
        if (label) label.textContent = 'Confirm back?';
        back.classList.add('confirm');
        timer = setTimeout(function () {
          armed = false;
          if (label) label.textContent = '← Games';
          back.classList.remove('confirm');
        }, 4000);
      } else {
        clearTimeout(timer);
      }
    });
  }

  /* Display mode toggle (Simple ○ / Visual ◇) with ghost banner */
  var dt = document.getElementById('display-toggle');
  var ghost = document.querySelector('.display-ghost');
  var ghostTimer = null;
  function applyMode(mode, announce) {
    var visual = mode === 'visual';
    document.body.classList.toggle('display-visual', visual);
    if (dt) dt.setAttribute('aria-checked', String(visual));
    if (announce && ghost) {
      ghost.textContent = visual ? 'Visual' : 'Simple';
      ghost.classList.remove('show');
      void ghost.offsetWidth;
      ghost.classList.add('show');
      clearTimeout(ghostTimer);
      ghostTimer = setTimeout(function () { ghost.classList.remove('show'); }, 1300);
    }
  }
  window.__syncDisplayToggle = function (mode) { applyMode(mode, false); };
  if (dt) dt.addEventListener('click', function () {
    var next = dt.getAttribute('aria-checked') === 'true' ? 'simple' : 'visual';
    applyMode(next, true);
    if (window.__setGameDisplayMode) window.__setGameDisplayMode(next);
  });
})();
