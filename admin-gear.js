// Gear button for game pages — visible only when GM mode is active.
//
// Pages may optionally set window.ADMIN_GEAR_PAGE to the relative URL of the
// admin tool relevant to that game. If unset, the gear link goes to the GM page.
//
// GM mode state is stored as a SHA-256 password hash in localStorage under
// 'admin_token'. Any non-empty 64-char hex value is treated as active (the hash
// was verified server-side at login time on the main page).
//
// Pages can react to auth state by listening for 'admin-state-change' on document
// or reading window.NoocAdmin.isAdmin(). The <body> class 'admin-on' is toggled too.

(function () {
  function isAdmin() {
    const t = localStorage.getItem('admin_token') || '';
    return /^[0-9a-f]{64}$/.test(t);
  }

  function logout() {
    localStorage.removeItem('admin_token');
  }

  function emitState() {
    const on = isAdmin();
    document.body.classList.toggle('admin-on', on);
    document.dispatchEvent(new CustomEvent('admin-state-change', { detail: { admin: on } }));
    const btn = document.getElementById('admin-gear-btn');
    if (btn) btn.style.display = on ? '' : 'none';
  }

  function injectStyles() {
    if (document.getElementById('admin-gear-styles')) return;
    const s = document.createElement('style');
    s.id = 'admin-gear-styles';
    s.textContent = `
      #admin-gear-btn {
        display: none;
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 1500;
        width: 36px;
        height: 36px;
        border: 1.5px solid rgba(90,138,58,0.7);
        background: rgba(90,138,58,0.88);
        color: #fff;
        border-radius: 50%;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        padding: 0;
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
        transition: background 0.15s, border-color 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      #admin-gear-btn:hover { background: rgba(55,69,40,0.95); border-color: rgba(55,69,40,0.9); }
      #admin-gear-btn svg { width: 18px; height: 18px; fill: currentColor; pointer-events: none; }

      #admin-gear-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.45);
        z-index: 2000;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      #admin-gear-overlay.open { display: flex; }
      #admin-gear-modal {
        position: relative;
        background: #fff;
        border-radius: 12px;
        padding: 22px 22px 18px;
        width: min(300px, 100%);
        box-shadow: 0 10px 40px rgba(0,0,0,0.25);
        font-family: 'Segoe UI', Inter, -apple-system, sans-serif;
        color: #2d3a1f;
      }
      #admin-gear-close-x {
        position: absolute;
        top: 12px; right: 12px;
        width: 28px; height: 28px;
        background: none; border: none;
        cursor: pointer;
        font-size: 18px; line-height: 1;
        color: #999;
        display: flex; align-items: center; justify-content: center;
        border-radius: 50%;
        padding: 0;
      }
      #admin-gear-close-x:hover { background: #f0f0f0; color: #555; }
      #admin-gear-modal h2 {
        font-size: 14px; font-weight: 700;
        color: #374528; margin: 0 28px 4px 0;
        text-transform: uppercase; letter-spacing: 0.06em;
      }
      #admin-gear-modal p {
        font-size: 13px; color: #7a9460;
        margin: 0 0 16px; line-height: 1.4;
      }
      #admin-gear-actions {
        display: flex; flex-direction: column; gap: 8px;
      }
      #admin-gear-actions button, #admin-gear-actions a {
        display: block; width: 100%;
        padding: 10px 14px;
        border-radius: 9px;
        font-size: 14px; font-weight: 600;
        cursor: pointer;
        text-align: center;
        text-decoration: none;
        font-family: inherit;
        box-sizing: border-box;
        border: 1.5px solid transparent;
        transition: background 0.12s;
      }
      #admin-gear-page-btn {
        background: #374528; color: #fff; border-color: #374528;
      }
      #admin-gear-page-btn:hover { background: #2a3620; }
      #admin-gear-exit-btn {
        background: #fff; color: #374528; border-color: #b8cfa0;
      }
      #admin-gear-exit-btn:hover { background: #f0f4e8; }
    `;
    document.head.appendChild(s);
  }

  function injectGear() {
    if (document.getElementById('admin-gear-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'admin-gear-btn';
    btn.type = 'button';
    btn.title = 'GM Mode';
    btn.setAttribute('aria-label', 'GM Mode options');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.92c.04-.34.07-.69.07-1.08s-.03-.74-.07-1.08l2.32-1.82a.55.55 0 0 0 .13-.71l-2.2-3.82a.55.55 0 0 0-.67-.24l-2.74 1.1c-.57-.44-1.18-.81-1.86-1.08l-.41-2.92A.544.544 0 0 0 14 2h-4c-.27 0-.5.19-.54.44l-.41 2.92c-.68.27-1.29.64-1.86 1.08L4.45 5.34a.55.55 0 0 0-.67.24L1.58 9.4a.54.54 0 0 0 .13.71l2.32 1.82c-.04.34-.07.69-.07 1.08s.03.74.07 1.08L1.71 15.9a.55.55 0 0 0-.13.71l2.2 3.82c.13.24.41.33.67.24l2.74-1.1c.57.44 1.18.81 1.86 1.08l.41 2.92c.04.25.27.44.54.44h4c.27 0 .5-.19.54-.44l.41-2.92c.68-.27 1.29-.64 1.86-1.08l2.74 1.1c.26.09.54 0 .67-.24l2.2-3.82a.54.54 0 0 0-.13-.71l-2.32-1.81z"/>' +
      '</svg>';
    btn.style.display = 'none';
    btn.addEventListener('click', openModal);
    document.body.appendChild(btn);
  }

  function injectModal() {
    if (document.getElementById('admin-gear-overlay')) return;
    const adminPage = (window.ADMIN_GEAR_PAGE || '').trim();
    const overlay = document.createElement('div');
    overlay.id = 'admin-gear-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div id="admin-gear-modal">' +
      '  <button type="button" id="admin-gear-close-x" aria-label="Close">×</button>' +
      '  <h2>GM Mode · On</h2>' +
      '  <p>You are in GM mode on this page.</p>' +
      '  <div id="admin-gear-actions">' +
      (adminPage
        ? '    <a href="' + adminPage + '" id="admin-gear-page-btn">Admin Page</a>'
        : '') +
      '    <button type="button" id="admin-gear-exit-btn">Exit GM Mode</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
    });
    document.getElementById('admin-gear-close-x').addEventListener('click', closeModal);
    document.getElementById('admin-gear-exit-btn').addEventListener('click', () => {
      logout();
      closeModal();
      emitState();
    });
  }

  function openModal() {
    document.getElementById('admin-gear-overlay').classList.add('open');
  }

  function closeModal() {
    document.getElementById('admin-gear-overlay').classList.remove('open');
  }

  function init() {
    injectStyles();
    injectGear();
    injectModal();
    emitState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.NoocAdmin = { isAdmin, logout };
})();
