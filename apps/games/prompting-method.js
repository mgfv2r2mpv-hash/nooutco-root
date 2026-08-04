'use strict';

/**
 * Prompting method - the three ABA prompting procedures as presets over the
 * Auto-Prompt / Prompt Delay primitives every game already exposes.
 *
 * `sequences` has shipped these three cards since Frame 04; the other games
 * expose only the primitives, so a technician had to know that "auto-prompt on,
 * delay off" IS most-to-least. This module is that vocabulary, shared.
 *
 * Two deliberate differences from sequences' own copy (see NOTES-gnhf.md):
 *
 *  1. The method is DERIVED from the primitives, never stored. A stored method
 *     goes stale the moment the technician touches Auto-Prompt under the
 *     primitives - sequences keeps showing "Time delay" after the delay is
 *     switched off. Deriving is total: every combination of the two switches
 *     maps to exactly one procedure, so there is no "custom" state and nothing
 *     new to persist.
 *  2. A preset never writes `promptDelaySecs`. sequences resets it to 3 s on
 *     every Time-Delay click, which silently discards a technician's 7 s.
 *     The seconds are their own control and stay where they were put.
 *
 * Self-injects its own <style> and self-wires from `[data-prompting-method]`
 * (same convention as reward.js / tooltip-help.js). A game adopts it with one
 * markup line, one <script> tag, and one `NooutcoPrompting.refresh()` call
 * wherever it already re-renders the panel from the configuration in force.
 */
(function () {
  const AUTO_PROMPT_ID = 'chk-auto-prompt';
  const PROMPT_DELAY_ID = 'chk-prompt-delay';

  /**
   * Ordered most-prompted to least-prompted, which is the order a technician
   * fades through. `preset` is the full patch a click applies.
   */
  const METHODS = [
    {
      id: 'most-to-least',
      icon: '✨',
      label: 'Immediate (Most to Least)',
      hint: 'Prompt every trial from the start, then fade.',
      preset: { autoPrompt: true, promptDelay: false },
    },
    {
      id: 'time-delay',
      icon: '⏳',
      label: 'Delayed (Fixed Time Delay)',
      hint: 'Wait the set number of seconds, then prompt.',
      preset: { autoPrompt: true, promptDelay: true },
    },
    {
      id: 'least-to-most',
      icon: '🙋',
      label: 'Independent First (Least to Most)',
      hint: 'No automatic prompt; prompt only on request.',
      preset: { autoPrompt: false, promptDelay: false },
    },
  ];

  const GROUP_HELP =
    'The prompting procedure this programme runs. Each option sets the ' +
    'Auto-Prompt and Prompt Delay switches below - change those directly to ' +
    'fine-tune it, and this follows.';

  /**
   * Total: every combination of the two switches names exactly one procedure.
   * With auto-prompt off there is no automatic prompt to delay, so the delay
   * switch is inert and the procedure is least-to-most whatever it holds.
   */
  function derive(cfg) {
    if (!cfg || !cfg.autoPrompt) return 'least-to-most';
    return cfg.promptDelay ? 'time-delay' : 'most-to-least';
  }

  function presetFor(id) {
    const m = METHODS.find(x => x.id === id);
    return m ? Object.assign({}, m.preset) : null;
  }

  /**
   * Prompting method → the prompt topography recorded on a trial when a prompt
   * actually fires. Previously duplicated verbatim in sequences and ffc; it
   * lives here now so all ten games record the same vocabulary and a change to
   * the mapping cannot drift between them.
   */
  const PROMPT_TYPE_BY_METHOD = {
    'most-to-least': 'model',
    'least-to-most': 'gesture',
    'time-delay':    'delay',
  };

  /**
   * The prompt type for one trial. `prompted` is whether a prompt was actually
   * delivered - by the technician or automatically. An unprompted trial is
   * 'none' regardless of the configured procedure, because the procedure
   * describes what *would* happen, not what did.
   */
  function promptTypeFor(cfg, prompted) {
    if (!prompted) return 'none';
    return PROMPT_TYPE_BY_METHOD[derive(cfg)] || 'model';
  }

  function injectStyle() {
    if (document.getElementById('prompting-method-style')) return;
    const style = document.createElement('style');
    style.id = 'prompting-method-style';
    style.textContent = `
      .prompting-method-field {
        /* Every panel that hosts this is an auto-fill grid, so without this the
           group lands in one 220px column and the three procedures stack. */
        grid-column: 1 / -1;
        margin: 12px 0 14px;
        padding: 10px 12px;
        border: 1px solid var(--border-subtle, rgba(0,0,0,0.08));
        border-radius: 10px;
        background: var(--surface-sunken, rgba(0,0,0,0.02));
      }
      .prompting-method-title {
        display: flex;
        align-items: center;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: var(--text-muted, #5a6b4a);
        margin: 0 0 8px;
      }
      .prompting-method-options {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .prompting-method-options .option-toggle { text-align: left; }
      .prompting-method-hint {
        margin: 8px 0 0;
        font-size: 12px;
        line-height: 1.45;
        color: var(--text-muted, #5a6b4a);
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * A mounted group. Reads the two checkboxes rather than the game's state:
   * the pills are a view of controls that are themselves rendered from the
   * configuration, so the group needs no knowledge of any game's schema.
   */
  function mountInto(container) {
    const chkAuto = document.getElementById(AUTO_PROMPT_ID);
    const chkDelay = document.getElementById(PROMPT_DELAY_ID);
    if (!chkAuto || !chkDelay) return null;

    injectStyle();
    container.classList.add('prompting-method-field');
    container.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'prompting-method-title';
    title.textContent = 'Prompting method';
    const help = document.createElement('button');
    help.type = 'button';
    help.className = 'help-btn';
    help.textContent = '?';
    help.setAttribute('aria-label', 'Help');
    help.setAttribute('data-help', GROUP_HELP);
    title.appendChild(help);
    container.appendChild(title);

    const options = document.createElement('div');
    options.className = 'prompting-method-options';
    options.setAttribute('role', 'radiogroup');
    options.setAttribute('aria-label', 'Prompting method');
    container.appendChild(options);

    const buttons = METHODS.map(m => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'option-toggle';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.setAttribute('data-method', m.id);
      b.title = m.hint;
      const ico = document.createElement('span');
      ico.className = 'option-toggle-ico';
      ico.setAttribute('aria-hidden', 'true');
      ico.textContent = m.icon;
      b.appendChild(ico);
      b.appendChild(document.createTextNode(m.label));
      options.appendChild(b);
      return b;
    });

    const hint = document.createElement('p');
    hint.className = 'prompting-method-hint';
    container.appendChild(hint);

    function refresh() {
      const id = derive({ autoPrompt: chkAuto.checked, promptDelay: chkDelay.checked });
      const active = METHODS.find(m => m.id === id);
      buttons.forEach((b, i) => {
        const on = METHODS[i].id === id;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        // Roving tabindex: the group is one tab stop, arrows move within it.
        b.tabIndex = on ? 0 : -1;
      });
      hint.textContent = active ? active.hint : '';
    }

    /**
     * Apply a preset by driving the two controls the game already listens to,
     * one at a time, with a real `change` event each. The game's own handler
     * is the only thing that writes state or persists - this never reaches
     * past the panel.
     */
    function select(id) {
      const preset = presetFor(id);
      if (!preset) return;
      setChecked(chkAuto, preset.autoPrompt);
      setChecked(chkDelay, preset.promptDelay);
      refresh();
    }

    function setChecked(node, value) {
      if (node.checked === value) return;
      node.checked = value;
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }

    options.addEventListener('click', e => {
      const b = e.target.closest('[data-method]');
      if (b) select(b.getAttribute('data-method'));
    });

    options.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' &&
          e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1 : -1;
      const next = buttons[(i + step + buttons.length) % buttons.length];
      next.tabIndex = 0;
      next.focus();
      select(next.getAttribute('data-method'));
    });

    // A primitive edited directly moves the selection, so the two can never
    // disagree about which procedure is running.
    chkAuto.addEventListener('change', refresh);
    chkDelay.addEventListener('change', refresh);

    refresh();
    return { refresh, select, container };
  }

  const groups = [];

  function mount() {
    for (const container of document.querySelectorAll('[data-prompting-method]')) {
      if (container.dataset.promptingMounted === '1') continue;
      const g = mountInto(container);
      if (g) {
        container.dataset.promptingMounted = '1';
        groups.push(g);
      }
    }
    return groups.length;
  }

  /**
   * Re-read the controls. Games call this wherever they already push the
   * configuration into the panel - the load path writes `.checked` directly,
   * which fires no `change` event for the group to hear.
   */
  function refresh() {
    if (!groups.length) mount();
    for (const g of groups) g.refresh();
  }

  window.NooutcoPrompting = {
    METHODS,
    PROMPT_TYPE_BY_METHOD,
    derive,
    presetFor,
    promptTypeFor,
    mount,
    refresh,
    select(id) { for (const g of groups) g.select(id); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
