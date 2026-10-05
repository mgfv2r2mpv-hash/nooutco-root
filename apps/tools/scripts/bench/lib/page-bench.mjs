/* THE BENCH IN HIS CONSOLE. Kaleb, 2026-10-04 (bench access, B): no bench
 * login; he pastes the bench into the console of a tool page he is logged in
 * on, one tool per sitting, as with the parent live script.
 *
 * This is lib/drive.mjs done from inside the page: the same steps a user takes
 * (fill the case, Generate, answer the page's questions from the case's truth,
 * Send, read the note card back), with plain DOM calls in place of Playwright.
 * Between cases it presses the page's own Clear, which drops the inputs, the
 * note and the scrub ledger; the confirm that Clear asks is answered yes for
 * that one press.
 *
 * The site refuses to be framed (X-Frame-Options DENY), so a case cannot run in
 * an iframe; Clear is what makes several cases one sitting.
 *
 * Built into scripts/bench/console/<tool>.js by scripts/bench/build-console.mjs,
 * which inlines the cases and lib/checks.mjs. This file must stay free of
 * imports: it is stringified into that script. */
export async function benchInPage(CASES, checkNote, opts = {}) {
  const LIMIT = opts.timeoutMs || 180000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const shown = (el) => !!el && el.getClientRects().length > 0;
  const until = async (fn, what, ms = LIMIT) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(250);
    }
  };

  /* React keeps a field's value in state, so the value is set through the
     element's own setter and announced with an input event, as typing does. */
  const type = (el, text) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const enter = (el) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
  const button = (re, root = document) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent.trim()) && shown(b));

  /* The page's in-flight calls, counted so the passes after the first draft
     (self-revision, corrections) can settle before the note is read. Put back
     when the run ends. */
  let inFlight = 0;
  const realFetch = window.fetch;
  window.fetch = function (...args) {
    inFlight += 1;
    return realFetch.apply(this, args).finally(() => { inFlight -= 1; });
  };
  const settle = async () => {
    const end = Date.now() + (opts.settleMs || 60000);
    let quiet = 0;
    while (Date.now() < end && quiet < 6) { quiet = inFlight ? 0 : quiet + 1; await sleep(250); }
  };

  const clear = async () => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Clear' && shown(x));
    if (!b) return;
    const realConfirm = window.confirm;
    window.confirm = () => true;
    try { b.click(); } finally { window.confirm = realConfirm; }
    await until(() => !$('[data-testid="generated-note"]') && !$('[data-panel-question]'), 'the page to clear', 10000);
  };

  const fieldNamed = (label) => {
    const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return $$('textarea, input').find((el) => {
      const name = el.getAttribute('aria-label') || (el.labels && el.labels[0] ? el.labels[0].textContent : '') || el.placeholder || '';
      return re.test(name) && shown(el);
    });
  };

  const fill = async (c) => {
    // A toggle is its label paragraph followed by a row of buttons.
    for (const [label, value] of Object.entries(c.toggles || {})) {
      const p = $$('p').find((x) => x.textContent.includes(label));
      const row = p && p.nextElementSibling;
      const b = row && [...row.querySelectorAll('button')].find((x) => x.textContent.trim() === value);
      if (!b) throw new Error(`no "${value}" button under "${label}"`);
      b.click();
    }
    for (const [field, value] of Object.entries(c.choices || {})) {
      const b = $(`[data-arrival-field="${field}"] [data-arrival="${value}"]`);
      if (!b) throw new Error(`no "${value}" choice for ${field}`);
      b.click();
    }
    for (const [label, text] of Object.entries(c.fields || {})) {
      const el = fieldNamed(label);
      if (!el) throw new Error(`no field named "${label}" on this page`);
      type(el, text);
    }
    await sleep(300);
  };

  const clearGates = async () => {
    await sleep(500);
    const ack = $('#notes-ack-go');
    if (shown(ack)) { const cb = $('#notes-ack-cb'); if (cb && !cb.checked) cb.click(); ack.click(); }
    const review = $('#notes-scrub-go');
    if (shown(review)) review.click();
  };

  // The truth entry whose words the question shares most, as drive.mjs does.
  const answerFor = (question, truth) => {
    const q = String(question || '').toLowerCase();
    let best = null, bestHits = 0;
    for (const t of truth || []) {
      const hits = (t.about || []).filter((k) => q.includes(String(k).toLowerCase())).length;
      if (hits > bestHits) { best = t; bestHits = hits; }
    }
    return best ? best.answer : null;
  };

  const openPanel = async () => {
    if (shown($('.revision-input'))) return;
    const fab = $('.revision-fab');
    if (shown(fab)) fab.click();
    await until(() => shown($('.revision-input')), 'the panel to open', 5000);
  };

  // Same reading as drive.mjs readNote: picks per group, text per narrative.
  const readNote = () => {
    const card = $('[data-testid="generated-note"]');
    const picks = {};
    card.querySelectorAll('[data-section-id]').forEach((sec) => {
      const on = [...sec.querySelectorAll('[data-option][data-on="1"]')].map((o) => o.getAttribute('data-option'));
      if (sec.querySelector('[data-option]')) picks[sec.getAttribute('data-section-id')] = on;
    });
    const text = {};
    card.querySelectorAll('[data-section-key]').forEach((sec) => {
      const key = sec.getAttribute('data-section-key');
      const single = sec.querySelector('[data-single-answer]');
      if (single) { picks[key] = [single.getAttribute('data-single-answer')]; return; }
      if (sec.querySelector('[data-section-id] [data-option]') || picks[key]) return;
      const ta = sec.querySelector('textarea');
      if (ta) text[key] = ta.value;
    });
    const fields = [...card.querySelectorAll('textarea, input:not([type]), input[type="text"]')].map((t) => t.value);
    return { picks, text, all: [card.innerText, ...fields].join('\n') };
  };

  const runCase = async (c) => {
    const started = Date.now();
    await clear();
    await fill(c);
    const go = button(/^(Generate|Regenerate)(?! Prompt)/);
    if (!go) throw new Error('no Generate button: log in first');
    go.click();
    await clearGates();

    const typed = { intake: Object.values(c.fields || {}).reduce((n, t) => n + words(t), 0), answers: 0 };
    const asked = [];
    const noteUp = () => shown($('[data-testid="generated-note"]'));
    await until(() => noteUp() || $('[data-panel-question]'), 'the first questions or the note');

    // Up to 3 rounds, the page's own cap.
    for (let round = 0; round < 3 && !noteUp(); round++) {
      if (!$('[data-panel-question]')) break;
      await openPanel();
      const loose = [];
      for (const el of $$('[data-panel-question]')) {
        const i = el.getAttribute('data-panel-question');
        const question = el.innerText.split('\n')[0];
        const answer = answerFor(question, c.truth);
        asked.push({ round: round + 1, question, answered: !!answer });
        if (!answer) continue;
        typed.answers += words(answer);
        const own = $(`[data-suggestion-own="${i}:own"]`);
        if (shown(own)) { type(own, answer); enter(own); } else loose.push(answer);
      }
      if (loose.length) type($('.revision-input'), loose.join(' '));
      // Send opens once enough is written, or when the page's minute runs out.
      const send = await until(() => { const b = $('.revision-send'); return b && !b.disabled && b; }, 'Send to open');
      send.click();
      const last = asked.length ? asked[asked.length - 1].question : '';
      await until(() => noteUp() || ($('[data-panel-question]') && $('[data-panel-question]').innerText.split('\n')[0] !== last), 'the next round or the note').catch(() => {});
    }
    await until(noteUp, 'the note');
    await settle();
    return { id: c.id, note: readNote(), asked, typed: { ...typed, total: typed.intake + typed.answers }, seconds: Math.round((Date.now() - started) / 1000) };
  };

  const results = [];
  const log = opts.log || ((s) => console.log(s));
  log(`Running ${CASES.length} cases on this page, one after another. Keep this tab in front; a hidden tab slows its timers.`);
  try {
    for (const [n, c] of CASES.entries()) {
      try {
        const out = await runCase(c);
        const fails = checkNote(c, out.note);
        results.push({ ...out, fails });
        log(`${n + 1} of ${CASES.length}: ${c.id}, ${fails.length ? 'FAIL' : 'pass'}, typed ${out.typed.total} words, ${new Set(out.asked.map((a) => a.round)).size} round(s), ${out.seconds}s`);
      } catch (err) {
        results.push({ id: c.id, fails: [`the run failed: ${err && err.message}`] });
        log(`${n + 1} of ${CASES.length}: ${c.id}, the run failed: ${err && err.message}`);
      }
    }
  } finally {
    window.fetch = realFetch;
  }
  return { at: new Date().toISOString(), page: location.pathname, results };
}
