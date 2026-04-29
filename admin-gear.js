// Watermark gear button for game pages.
//
// Each page that loads this file must also expose the deploy-time
// admin password hash via window.ADMIN_SECRET_HASH (so the existing
// Cloudflare worker rewrite still works).
//
// Behaviour:
//   - Unauthenticated click: prompts for the admin password.
//   - Authenticated click: prompts to exit admin mode; on confirm,
//     clears the token and reloads the page so admin-only UI resets
//     to user view.
//
// Pages can react to auth state by listening for the
// 'admin-state-change' event on document, or by reading
// window.NoocAdmin.isAdmin(). The current state is also reflected
// on <body> via the 'admin-on' class so CSS can react too.

(function () {
  const HASH = (window.ADMIN_SECRET_HASH || '').trim();

  function isAdmin() {
    return !!HASH && localStorage.getItem('admin_token') === HASH;
  }

  function logout() {
    localStorage.removeItem('admin_token');
  }

  async function sha256Hex(str) {
    const buf = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function emitState() {
    const on = isAdmin();
    document.body.classList.toggle('admin-on', on);
    document.dispatchEvent(new CustomEvent('admin-state-change', { detail: { admin: on } }));
  }

  function injectStyles() {
    if (document.getElementById('admin-gear-styles')) return;
    const s = document.createElement('style');
    s.id = 'admin-gear-styles';
    s.textContent = `
      #admin-gear-btn {
        position: fixed;
        bottom: 10px;
        right: 10px;
        z-index: 1500;
        width: 30px;
        height: 30px;
        border: 1px solid rgba(0,0,0,0.18);
        background: rgba(255,255,255,0.55);
        color: #555;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        opacity: 0.32;
        padding: 0;
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
        transition: opacity 0.15s, background 0.15s, color 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      #admin-gear-btn:hover,
      #admin-gear-btn:focus-visible { opacity: 0.85; outline: none; }
      #admin-gear-btn svg { width: 16px; height: 16px; fill: currentColor; pointer-events: none; }
      body.admin-on #admin-gear-btn {
        opacity: 0.7;
        background: rgba(90,138,58,0.85);
        color: #fff;
        border-color: rgba(90,138,58,0.9);
      }
      body.admin-on #admin-gear-btn:hover { opacity: 1; }

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
        background: #fff;
        border-radius: 12px;
        padding: 22px 22px 18px;
        width: min(320px, 100%);
        box-shadow: 0 10px 40px rgba(0,0,0,0.25);
        font-family: 'Segoe UI', Inter, -apple-system, sans-serif;
        color: #2d3a1f;
      }
      #admin-gear-modal h2 { font-size: 16px; font-weight: 700; margin: 0 0 4px; color: #1a1f14; }
      #admin-gear-modal p  { font-size: 13px; color: #666; margin: 0 0 14px; line-height: 1.45; }
      #admin-gear-input {
        width: 100%;
        padding: 9px 11px;
        border: 1.5px solid #d5d5d5;
        border-radius: 8px;
        font-size: 14px;
        outline: none;
        margin-bottom: 6px;
        font-family: inherit;
      }
      #admin-gear-input:focus { border-color: #5a8a3a; }
      #admin-gear-actions { display: flex; gap: 8px; margin-top: 10px; }
      #admin-gear-actions button {
        flex: 1;
        padding: 9px;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
      }
      #admin-gear-actions .admin-gear-primary { background: #374528; color: #fff; }
      #admin-gear-actions .admin-gear-primary:hover { background: #2a3620; }
      #admin-gear-actions .admin-gear-secondary { background: #e8e8e8; color: #333; }
      #admin-gear-actions .admin-gear-secondary:hover { background: #d8d8d8; }
      #admin-gear-err { color: #c0392b; font-size: 12px; min-height: 16px; }
    `;
    document.head.appendChild(s);
  }

  function injectGear() {
    if (document.getElementById('admin-gear-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'admin-gear-btn';
    btn.type = 'button';
    btn.title = 'Admin';
    btn.setAttribute('aria-label', 'Admin');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.92c.04-.34.07-.69.07-1.08s-.03-.74-.07-1.08l2.32-1.82a.55.55 0 0 0 .13-.71l-2.2-3.82a.55.55 0 0 0-.67-.24l-2.74 1.1c-.57-.44-1.18-.81-1.86-1.08l-.41-2.92A.544.544 0 0 0 14 2h-4c-.27 0-.5.19-.54.44l-.41 2.92c-.68.27-1.29.64-1.86 1.08L4.45 5.34a.55.55 0 0 0-.67.24L1.58 9.4a.54.54 0 0 0 .13.71l2.32 1.82c-.04.34-.07.69-.07 1.08s.03.74.07 1.08L1.71 15.9a.55.55 0 0 0-.13.71l2.2 3.82c.13.24.41.33.67.24l2.74-1.1c.57.44 1.18.81 1.86 1.08l.41 2.92c.04.25.27.44.54.44h4c.27 0 .5-.19.54-.44l.41-2.92c.68-.27 1.29-.64 1.86-1.08l2.74 1.1c.26.09.54 0 .67-.24l2.2-3.82a.54.54 0 0 0-.13-.71l-2.32-1.81z"/>' +
      '</svg>';
    btn.addEventListener('click', openModal);
    document.body.appendChild(btn);
  }

  function injectModal() {
    if (document.getElementById('admin-gear-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'admin-gear-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML =
      '<div id="admin-gear-modal">' +
      '  <h2 id="admin-gear-title"></h2>' +
      '  <p  id="admin-gear-msg"></p>' +
      '  <input type="password" id="admin-gear-input" placeholder="Password" autocomplete="current-password">' +
      '  <div id="admin-gear-err" aria-live="polite"></div>' +
      '  <div id="admin-gear-actions">' +
      '    <button type="button" id="admin-gear-cancel" class="admin-gear-secondary">Cancel</button>' +
      '    <button type="button" id="admin-gear-go" class="admin-gear-primary">Unlock</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
    });
    document.getElementById('admin-gear-cancel').addEventListener('click', closeModal);
    document.getElementById('admin-gear-go').addEventListener('click', confirmAction);
    document.getElementById('admin-gear-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') confirmAction();
    });
  }

  function openModal() {
    const overlay = document.getElementById('admin-gear-overlay');
    const title = document.getElementById('admin-gear-title');
    const msg = document.getElementById('admin-gear-msg');
    const input = document.getElementById('admin-gear-input');
    const err = document.getElementById('admin-gear-err');
    const go = document.getElementById('admin-gear-go');
    err.textContent = '';
    if (isAdmin()) {
      title.textContent = 'Exit admin mode?';
      msg.textContent = 'This will hide admin-only controls and reload the page in user view.';
      input.style.display = 'none';
      go.textContent = 'Exit';
    } else {
      title.textContent = 'Game Master';
      msg.textContent = 'Enter the admin password to unlock admin controls on this page.';
      input.style.display = '';
      input.value = '';
      go.textContent = 'Unlock';
    }
    overlay.classList.add('open');
    if (!isAdmin()) {
      setTimeout(() => input.focus(), 30);
    } else {
      setTimeout(() => go.focus(), 30);
    }
  }

  function closeModal() {
    document.getElementById('admin-gear-overlay').classList.remove('open');
  }

  async function confirmAction() {
    const input = document.getElementById('admin-gear-input');
    const err = document.getElementById('admin-gear-err');
    if (isAdmin()) {
      logout();
      closeModal();
      window.location.reload();
      return;
    }
    const pw = input.value;
    if (!pw) { err.textContent = 'Enter a password.'; return; }
    if (!HASH) { err.textContent = 'Admin not configured.'; return; }
    const hash = await sha256Hex(pw);
    if (hash === HASH) {
      localStorage.setItem('admin_token', hash);
      closeModal();
      emitState();
    } else {
      err.textContent = 'Incorrect password.';
      input.value = '';
      input.focus();
    }
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
