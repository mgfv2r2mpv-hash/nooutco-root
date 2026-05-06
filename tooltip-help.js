'use strict';

function initHelpButtons() {
  let activePopup = null;

  const style = document.createElement('style');
  style.textContent = `
    .help-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #d4a574;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      border: none;
      cursor: help;
      padding: 0;
      margin-left: 6px;
      vertical-align: middle;
      flex-shrink: 0;
    }
    .help-btn:hover {
      background: #c29560;
    }
    .help-btn:active {
      background: #b08a50;
    }

    .help-popup {
      position: fixed;
      max-width: 300px;
      background: rgba(0, 0, 0, 0.9);
      color: #fff;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.5;
      z-index: 10000;
      pointer-events: none;
      white-space: normal;
      word-wrap: break-word;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    }
  `;
  document.head.appendChild(style);

  function closePopup() {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
    }
  }

  function showPopup(button, text) {
    closePopup();

    const popup = document.createElement('div');
    popup.className = 'help-popup';
    popup.textContent = text;
    document.body.appendChild(popup);
    activePopup = popup;

    const rect = button.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();

    let left = rect.left + rect.width / 2 - popupRect.width / 2;
    let top = rect.bottom + 8;

    if (left < 8) left = 8;
    if (left + popupRect.width > window.innerWidth - 8) {
      left = window.innerWidth - popupRect.width - 8;
    }

    if (top + popupRect.height > window.innerHeight - 8) {
      top = rect.top - popupRect.height - 8;
    }

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.help-btn');
    if (btn) {
      e.stopPropagation();
      const text = btn.getAttribute('data-help');
      if (text) {
        if (activePopup) {
          closePopup();
        } else {
          showPopup(btn, text);
        }
      }
    } else {
      closePopup();
    }
  }, true);

  document.addEventListener('scroll', closePopup);
  window.addEventListener('resize', closePopup);

  return {
    addHelpButton(parentSelector, helpText) {
      const parent = document.querySelector(parentSelector);
      if (!parent) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'help-btn';
      btn.setAttribute('data-help', helpText);
      btn.textContent = '?';
      btn.setAttribute('aria-label', 'Help');
      parent.appendChild(btn);
    }
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHelpButtons);
} else {
  initHelpButtons();
}
