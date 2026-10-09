'use strict';

/**
 * Round setup - the gated Frame 04 panel, shared by every standard game.
 *
 * `sequences` built this panel first, as a config of its own (PHASE8-HANDOFF-3
 * §3a). The other games already keep their whole programme in one shared
 * store (`game-settings.js`) behind the controls in their settings bar and
 * Options panel, so this module adds the panel as a GATED VIEW OVER THOSE SAME
 * CONTROLS rather than as a second configuration:
 *
 *   - every panel control mirrors a game control the game already listens to;
 *     an edit here sets that control and fires a real `change`, so the game's
 *     own handler is the only thing that writes state or persists
 *   - the prompting radios drive `#chk-auto-prompt` / `#chk-prompt-delay` the
 *     same way, through `NooutcoPrompting`'s presets
 *   - saved sets are the store's own `sets` / `last`
 *
 * So a panel that is opened and left alone changes nothing: no state, no
 * storage, no trial. That is the property each game's spec pins.
 *
 * Gating: a quick tap on the gear opens the panel LOCKED (read-only); a
 * press-and-hold opens it unlocked, via `NooutcoSettings.holdToUnlock`. A
 * learner tapping the gear cannot change a running programme. `Start round`
 * stays live when locked, and re-locks the panel.
 *
 * Self-injects its own <style> (same convention as prompting-method.js), so a
 * game adopts it with one <script> tag and one `NooutcoRoundSetup.mount()`.
 */
(function () {
  const STYLE_ID = 'round-setup-style';
  const HOLD_MS = 600;
  const SET_NAME_PROMPT = 'Name this set (pseudonym only - no learner identifiers):';

  /** A stepper / select / switch per game control, chosen from what it is. */
  function kindOf(src) {
    if (src.tagName === 'SELECT') return 'select';
    if (src.type === 'checkbox') return 'switch';
    if (src.type === 'number') return 'stepper';
    return null;
  }

  /** The visible label a game control already carries, minus its "?" button. */
  function labelOf(src) {
    let node = src.id ? document.querySelector(`label[for="${src.id}"]`) : null;
    if (!node) node = src.closest('label');
    if (!node) return src.getAttribute('aria-label') || src.id;
    const copy = node.cloneNode(true);
    copy.querySelectorAll('.help-btn, input, select').forEach(n => n.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  }

  function make(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function button(cls, text, attrs) {
    const b = make('button', cls, text);
    b.type = 'button';
    Object.entries(attrs || {}).forEach(([k, v]) => b.setAttribute(k, v));
    return b;
  }

  /** Set a game control and let the game hear it, exactly as a click would. */
  function drive(src, value) {
    if (src.type === 'checkbox') {
      if (src.checked === value) return;
      src.checked = value;
    } else {
      if (String(src.value) === String(value)) return;
      src.value = String(value);
    }
    src.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** The value a control shipped with in the page's markup. */
  function markupDefault(src) {
    if (src.type === 'checkbox') return src.defaultChecked;
    if (src.tagName === 'SELECT') {
      const opts = [...src.options];
      const marked = opts.find(o => o.defaultSelected) || opts[0];
      return marked ? marked.value : src.value;
    }
    return src.defaultValue;
  }

  // ── Mirrors: one panel row per game control ───────────────────────

  function stepperMirror(src, label) {
    const box = make('div', 'round-stepper');
    const down = button('round-step', '−', { 'data-dir': '-1', 'aria-label': `Decrease ${label}` });
    const val = make('div', 'round-step-val');
    val.setAttribute('aria-live', 'polite');
    const up = button('round-step', '+', { 'data-dir': '1', 'aria-label': `Increase ${label}` });
    box.append(down, val, up);

    function bound(attr) {
      const n = parseInt(src.getAttribute(attr), 10);
      return Number.isFinite(n) ? n : null;
    }
    function step(dir) {
      const cur = parseInt(src.value, 10) || 0;
      const lo = bound('min');
      const hi = bound('max');
      let next = cur + dir;
      if (lo != null) next = Math.max(lo, next);
      if (hi != null) next = Math.min(hi, next);
      drive(src, next);
    }
    down.addEventListener('click', () => step(-1));
    up.addEventListener('click', () => step(1));

    return {
      node: box,
      controls: [down, up],
      render() {
        val.textContent = src.value;
        const cur = parseInt(src.value, 10) || 0;
        const lo = bound('min');
        const hi = bound('max');
        down.dataset.atLimit = String(lo != null && cur <= lo);
        up.dataset.atLimit = String(hi != null && cur >= hi);
      },
    };
  }

  function selectMirror(src, label) {
    const sel = make('select', 'round-select');
    sel.setAttribute('aria-label', label);
    sel.addEventListener('change', () => drive(src, sel.value));
    return {
      node: sel,
      controls: [sel],
      render() {
        const fresh = [...src.options].map(o => `${o.value}\u0000${o.textContent}`).join('\u0001');
        if (sel.dataset.sig !== fresh) {
          sel.innerHTML = '';
          [...src.options].forEach(o => sel.appendChild(new Option(o.textContent, o.value)));
          sel.dataset.sig = fresh;
        }
        sel.value = src.value;
      },
    };
  }

  function switchMirror(src, label) {
    const sw = button('round-toggle', null, { role: 'switch', 'aria-label': label });
    sw.appendChild(make('span', 'round-toggle-knob')).setAttribute('aria-hidden', 'true');
    sw.addEventListener('click', () => drive(src, !src.checked));
    return {
      node: sw,
      controls: [sw],
      render() {
        sw.setAttribute('aria-checked', String(src.checked));
        sw.classList.toggle('is-on', src.checked);
      },
    };
  }

  const MIRRORS = { stepper: stepperMirror, select: selectMirror, switch: switchMirror };

  /** Build the mirror for one `{ sel, label }` spec, or null if it is absent. */
  function mirrorFor(spec) {
    const s = typeof spec === 'string' ? { sel: spec } : spec;
    const src = document.querySelector(s.sel);
    if (!src) return null;
    const kind = kindOf(src);
    if (!kind) return null;
    const label = s.label || labelOf(src);
    const m = MIRRORS[kind](src, label);
    const row = make('div', 'round-field round-field-row');
    row.dataset.mirror = s.sel;
    row.append(make('div', 'round-field-label', label), m.node);
    return {
      src,
      row,
      controls: m.controls,
      // A control whose markup default is not a programme default (a learner
      // slot, say) opts out of Reset with `reset: false`.
      resettable: s.reset !== false,
      render() {
        m.render();
        // A control the game itself has disabled (e.g. Prompt Delay while
        // Auto-Prompt is off) is disabled here too, whatever the gate says.
        row.classList.toggle('is-unavailable', src.disabled);
      },
    };
  }

  // ── Prompting method: radios over the two primitives ──────────────

  function promptingMirror() {
    const P = window.NooutcoPrompting;
    const auto = document.getElementById('chk-auto-prompt');
    const delay = document.getElementById('chk-prompt-delay');
    if (!P || !auto || !delay) return null;

    const box = make('div', 'round-prompting');
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', 'Prompting method');
    const radios = P.METHODS.map(m => {
      const r = button('round-radio', null, { role: 'radio', 'data-method': m.id, title: m.hint });
      r.append(make('span', 'round-radio-dot'), make('span', 'round-radio-label', m.label));
      r.firstChild.setAttribute('aria-hidden', 'true');
      r.addEventListener('click', () => {
        const preset = P.presetFor(m.id);
        if (!preset) return;
        drive(auto, preset.autoPrompt);
        drive(delay, preset.promptDelay);
      });
      return r;
    });
    box.append(...radios);
    const hint = make('p', 'round-field-hint');

    return {
      node: [box, hint],
      controls: radios,
      sources: [auto, delay],
      render() {
        const id = P.derive({ autoPrompt: auto.checked, promptDelay: delay.checked });
        radios.forEach(r => {
          const on = r.dataset.method === id;
          r.classList.toggle('is-on', on);
          r.setAttribute('aria-checked', String(on));
        });
        const active = P.METHODS.find(m => m.id === id);
        hint.textContent = active ? active.hint : '';
      },
    };
  }

  // ── Panel shell ───────────────────────────────────────────────────

  function column(cls, title) {
    const col = make('div', `round-col ${cls}`);
    col.appendChild(make('div', 'round-col-title', title));
    return col;
  }

  function buildShell(opts) {
    const gear = button('btn-round', '🎯 Round setup', {
      id: 'btn-round-toggle',
      'aria-expanded': 'false',
      'aria-controls': 'round-panel',
      title: 'Tap to view · press and hold to edit',
    });
    const gearGroup = make('div', 'setting-group setting-round');
    gearGroup.appendChild(gear);

    const panel = make('section');
    panel.id = 'round-panel';
    panel.hidden = true;
    panel.dataset.editing = 'false';
    panel.setAttribute('aria-label', opts.label || 'Round setup');

    const head = make('div', 'round-head');
    const setPicker = make('select', 'round-set-picker');
    setPicker.id = 'sel-round-set';
    setPicker.setAttribute('aria-label', 'Saved round sets');
    const pill = make('span', 'round-gate-pill');
    pill.id = 'round-gate-pill';
    pill.setAttribute('role', 'status');
    const close = button('round-close', '×', { id: 'btn-round-close', 'aria-label': 'Close round setup' });
    const actions = make('div', 'round-head-actions');
    actions.append(setPicker, pill, close);
    head.append(make('div', 'round-title', opts.title || 'Round setup'), actions);

    const cols = make('div', 'round-cols');
    const core = column('round-col-core', 'Core');
    const prompting = column('round-col-prompting', 'Prompting method');
    const advanced = column('round-col-advanced', 'Advanced');
    cols.append(core, prompting, advanced);
    const body = make('div', 'round-body');
    body.appendChild(cols);

    const foot = make('div', 'round-foot');
    const start = button('btn-round-start', 'Start round', { id: 'btn-round-start' });
    const save = button('btn-round-save', '💾 Save as set', { id: 'btn-round-save' });
    const reset = button('btn-round-reset', 'Reset to defaults', { id: 'btn-round-reset' });
    foot.append(start, save, reset);

    panel.append(head, body, foot);
    return { gear, gearGroup, panel, setPicker, pill, close, core, prompting, advanced, start, save, reset };
  }

  function place(opts, ui) {
    const bar = document.querySelector(opts.bar || '#settings-bar');
    const startBtn = document.querySelector(opts.start || '#btn-start');
    if (!bar) return false;
    // Just before the bar item that holds the game's Start, so the gear sits
    // with the settings and Start stays last.
    let slot = startBtn && bar.contains(startBtn) ? startBtn : null;
    while (slot && slot.parentElement !== bar) slot = slot.parentElement;
    if (slot) bar.insertBefore(ui.gearGroup, slot);
    else bar.appendChild(ui.gearGroup);
    const after = document.querySelector(opts.after || '#extra-panel') || bar;
    after.insertAdjacentElement('afterend', ui.panel);
    return true;
  }

  // ── mount ─────────────────────────────────────────────────────────

  /**
   * @param {{
   *   store: object,              // the game's NooutcoSettings store
   *   reload: Function,           // re-render the game from store.initial()
   *   core: Array<string|{sel,label,reset?}>,
   *   advanced?: Array<string|{sel,label,reset?}>,
   *   start?: string,             // the game's own Start button
   *   sets?: boolean,             // false: no saved-set picker / Save button
   *   bar?: string, after?: string, title?: string, label?: string,
   * }} opts
   */
  function mount(opts) {
    if (!opts || !opts.store || typeof opts.reload !== 'function') {
      throw new Error('round-setup: mount needs a store and a reload()');
    }
    if (document.getElementById('round-panel')) return null;
    injectStyle();

    const ui = buildShell(opts);
    if (!place(opts, ui)) return null;

    const core = (opts.core || []).map(mirrorFor).filter(Boolean);
    const advanced = (opts.advanced || []).map(mirrorFor).filter(Boolean);
    core.forEach(m => ui.core.appendChild(m.row));
    advanced.forEach(m => ui.advanced.appendChild(m.row));
    if (!advanced.length) ui.advanced.remove();

    const prompting = promptingMirror();
    if (prompting) {
      const field = make('div', 'round-field round-field-prompting');
      field.append(...prompting.node);
      ui.prompting.appendChild(field);
    } else {
      ui.prompting.remove();
    }

    // A game that already spends the store's `sets` on something else (think-or-say
    // keeps its learner slots there) mounts with `sets: false`.
    const hasSets = opts.sets !== false;
    if (!hasSets) { ui.setPicker.remove(); ui.save.remove(); }

    const mirrors = core.concat(advanced);
    const gated = mirrors.flatMap(m => m.controls)
      .concat(prompting ? prompting.controls : [])
      .concat(hasSets ? [ui.setPicker, ui.save] : [])
      .concat([ui.reset]);
    const sources = new Set(mirrors.map(m => m.src).concat(prompting ? prompting.sources : []));
    const st = { open: false, editing: false };

    function renderSets() {
      if (!hasSets) return;
      const store = opts.store.load();
      const names = Object.keys(store.sets || {});
      ui.setPicker.innerHTML = '';
      ui.setPicker.appendChild(new Option('📁 Unsaved round', ''));
      names.forEach(n => ui.setPicker.appendChild(new Option(`📁 ${n}`, n)));
      ui.setPicker.value = (store.last && names.includes(store.last)) ? store.last : '';
    }

    function render() {
      mirrors.forEach(m => m.render());
      if (prompting) prompting.render();
      renderSets();
      gated.forEach(c => { c.disabled = !st.editing; });
      mirrors.forEach(m => {
        if (m.src.disabled) m.controls.forEach(c => { c.disabled = true; });
      });
      ui.pill.textContent = st.editing ? '🔓 Editing' : '🔒 Locked';
      ui.panel.dataset.editing = String(st.editing);
    }

    function setEditing(on) {
      st.editing = !!on;
      render();
    }

    function setOpen(open) {
      st.open = !!open;
      ui.gear.setAttribute('aria-expanded', String(st.open));
      ui.gear.classList.toggle('is-open', st.open);
      ui.panel.hidden = !st.open;
      if (!st.open) st.editing = false;
      if (st.open) render();
    }

    function applySet(name) {
      if (!name) return;
      const applied = opts.store.applySet(name);
      if (!applied) return;
      opts.store.saveWorking(applied);
      opts.reload();
      render();
    }

    function saveSet() {
      const name = (window.prompt(SET_NAME_PROMPT, '') || '').trim();
      if (!name) return;
      opts.store.saveSet(name, opts.store.initial());
      render();
    }

    /** Back to the values the page shipped with, through the game's handlers. */
    function resetToDefaults() {
      mirrors.filter(m => m.resettable).forEach(m => drive(m.src, markupDefault(m.src)));
      render();
    }

    function startRound() {
      setOpen(false);
      const startBtn = document.querySelector(opts.start || '#btn-start');
      if (startBtn) startBtn.click();
    }

    window.NooutcoSettings.holdToUnlock(ui.gear, {
      holdMs: HOLD_MS,
      onHold: () => { setOpen(true); setEditing(true); },
      onTap: () => setOpen(!st.open),
    });
    ui.close.addEventListener('click', () => setOpen(false));
    if (hasSets) {
      ui.setPicker.addEventListener('change', () => applySet(ui.setPicker.value));
      ui.save.addEventListener('click', saveSet);
    }
    ui.reset.addEventListener('click', resetToDefaults);
    ui.start.addEventListener('click', startRound);

    // An edit made anywhere (this panel, the settings bar, the Options panel)
    // re-renders the panel, so the two views can never disagree.
    document.addEventListener('change', e => {
      if (st.open && sources.has(e.target)) render();
    });

    const api = {
      open: () => setOpen(true),
      close: () => setOpen(false),
      unlock: () => { setOpen(true); setEditing(true); },
      isOpen: () => st.open,
      isEditing: () => st.editing,
      render,
      panel: ui.panel,
      gear: ui.gear,
    };
    window.NooutcoRoundSetup.active = api;
    return api;
  }

  // ── Styles ────────────────────────────────────────────────────────

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .btn-round {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 5px 10px; border-radius: var(--radius-md, 8px);
        border: 1px solid var(--sage-300, #dfe6d2); background: var(--sage-50, #f3f6ee);
        color: var(--sage-800, #4d5840); font: inherit; font-size: var(--text-sm, 13px);
        font-weight: 700; cursor: pointer; user-select: none; -webkit-user-select: none;
        touch-action: none;
        transition: background 0.15s, box-shadow 0.15s;
      }
      .btn-round:hover { background: var(--sage-100, #eaf0e0); }
      .btn-round.is-holding { box-shadow: 0 0 0 3px rgba(77,88,64,0.22); }
      .btn-round.is-open { background: var(--sage-700, #4d5840); border-color: var(--sage-700, #4d5840); color: #fff; }

      #round-panel {
        width: min(1200px, calc(100vw - 32px)); margin: 14px auto 6px;
        background: var(--surface-card, #fff); border: 1px solid var(--border-default, #e2e6d9);
        border-radius: 16px; box-shadow: 0 16px 42px rgba(44,51,31,0.16); overflow: hidden;
        color: var(--text-primary, #1a1f14);
      }
      #round-panel .round-head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 12px; padding: 12px 18px; }
      #round-panel .round-title { font-size: 16px; font-weight: 700; }
      #round-panel .round-head-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; }
      #round-panel .round-set-picker,
      #round-panel .round-select {
        background: var(--surface-card, #fff); border: 1px solid var(--border-strong, #dfe6d2);
        color: var(--text-primary, #1a1f14); border-radius: 9px; padding: 7px 10px;
        font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; max-width: 100%;
      }
      #round-panel .round-gate-pill {
        display: inline-flex; align-items: center; border-radius: 999px; padding: 5px 11px;
        font-size: 11.5px; font-weight: 700; white-space: nowrap;
        background: #eef1e8; border: 1px solid #dfe3d6; color: #5d6a4d;
      }
      #round-panel[data-editing="true"] .round-gate-pill { background: #fef3c7; border-color: #fae3a0; color: #7a5d17; }
      #round-panel .round-close { background: transparent; border: none; color: #7a8568; font-size: 22px; line-height: 1; cursor: pointer; padding: 0 4px; }

      #round-panel .round-body { padding: 0 18px 6px; }
      #round-panel .round-cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; border-top: 1px solid #eef0e9; }
      #round-panel .round-col { display: flex; flex-direction: column; min-width: 0; padding: 0 20px; }
      #round-panel .round-col:first-child { padding-left: 0; }
      #round-panel .round-col:last-child { padding-right: 0; }
      #round-panel .round-col + .round-col { border-left: 1px solid #eef0e9; }
      #round-panel .round-col-title { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #6f7a5e; padding: 11px 0 1px; }
      #round-panel .round-field { padding: 9px 0; border-top: 1px solid #eef0e9; }
      #round-panel .round-col-title + .round-field { border-top: none; }
      #round-panel .round-field-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
      #round-panel .round-field-row.is-unavailable { opacity: 0.5; }
      #round-panel .round-field-label { font-size: 13px; font-weight: 700; color: #2c331f; }
      #round-panel .round-field-hint { font-size: 11.5px; line-height: 1.35; color: #6f7a5e; margin: 8px 0 0; }

      #round-panel .round-stepper { display: inline-flex; align-items: center; gap: 2px; background: #f4f6ef; border: 1px solid #e7ebe0; border-radius: 9px; padding: 3px; flex-shrink: 0; }
      #round-panel .round-step { width: 32px; height: 32px; border: none; background: #fff; border-radius: 7px; font-size: 17px; color: #4d5840; cursor: pointer; box-shadow: 0 1px 2px rgba(44,51,31,0.08); }
      #round-panel .round-step[data-at-limit="true"] { color: #b8bfab; }
      #round-panel .round-step-val { min-width: 34px; text-align: center; font-size: 15px; font-weight: 700; }

      #round-panel .round-prompting { display: flex; flex-direction: column; gap: 5px; }
      #round-panel .round-radio {
        display: flex; align-items: center; gap: 10px; text-align: left; width: 100%;
        background: #fff; border: 1px solid #e2e6d9; border-radius: 9px; padding: 8px 12px;
        cursor: pointer; font: inherit;
      }
      #round-panel .round-radio-dot { flex-shrink: 0; width: 16px; height: 16px; border-radius: 999px; border: 2px solid #cdd4c0; background: #fff; }
      #round-panel .round-radio-label { font-size: 13px; font-weight: 600; color: #2c331f; }
      #round-panel .round-radio.is-on { border-color: #4d5840; box-shadow: inset 0 0 0 1px #4d5840; }
      #round-panel .round-radio.is-on .round-radio-label { font-weight: 700; }
      #round-panel .round-radio.is-on .round-radio-dot { border-color: #4d5840; background: radial-gradient(circle at center, #4d5840 0 5px, #fff 6px); }

      #round-panel .round-toggle { position: relative; flex-shrink: 0; width: 46px; height: 26px; border-radius: 999px; border: none; background: #d4dac9; cursor: pointer; transition: background 0.15s; }
      #round-panel .round-toggle.is-on { background: #4d5840; }
      #round-panel .round-toggle-knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 999px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2); transition: transform 0.15s; }
      #round-panel .round-toggle.is-on .round-toggle-knob { transform: translateX(20px); }

      #round-panel .round-foot { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 12px 18px; border-top: 1px solid #eef0e9; }
      #round-panel .btn-round-start { flex: 1 1 160px; background: #4d5840; color: #fff; border: none; border-radius: 10px; padding: 12px; font: inherit; font-size: 14px; font-weight: 700; cursor: pointer; }
      #round-panel .btn-round-start:hover { background: #3f4a35; }
      #round-panel .btn-round-save { background: transparent; color: #4d5840; border: 1px solid #e2e6d9; border-radius: 10px; padding: 11px 14px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
      #round-panel .btn-round-reset { background: transparent; color: #5d6a4d; border: none; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; text-decoration: underline; }

      /* Gating: locked controls are disabled (so keyboard is gated too) and muted. */
      #round-panel button:disabled,
      #round-panel select:disabled { cursor: not-allowed; }
      #round-panel[data-editing="false"] .round-body,
      #round-panel[data-editing="false"] .round-set-picker,
      #round-panel[data-editing="false"] .btn-round-save,
      #round-panel[data-editing="false"] .btn-round-reset { opacity: 0.6; }

      @media (max-width: 900px) {
        #round-panel .round-cols { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        #round-panel .round-col-advanced { grid-column: 1 / -1; border-left: none; border-top: 1px solid #eef0e9; padding: 0; }
      }
      @media (max-width: 639px) {
        #round-panel { width: auto; margin: 12px 16px 6px; }
        #round-panel .round-cols { grid-template-columns: minmax(0, 1fr); }
        #round-panel .round-col { padding: 0; }
        #round-panel .round-col + .round-col { border-left: none; border-top: 1px solid #eef0e9; }
      }
      @media print { #round-panel { display: none !important; } }
    `;
    document.head.appendChild(style);
  }

  window.NooutcoRoundSetup = { mount, active: null };
})();
