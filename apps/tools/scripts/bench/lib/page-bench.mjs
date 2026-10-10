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

/* WHAT A USER TYPES WHEN THE PAGE HOLDS A ROUND THEY CANNOT ANSWER.
 *
 * Below the readiness bar the page refuses to draft until one question of the
 * first round is answered (his ruling of 2026-08-31, held in engine.jsx
 * gateHolds), and while it holds there is no Send at all, only the note that
 * says what opens it. A case's truth answers only what that session knew, so
 * a question it does not speak to used to leave the bench waiting on a Send
 * that could not appear: v3 on 9 Oct 2026, "timed out waiting for Send to
 * open". A user in that seat says there is nothing more and moves on, so the
 * bench does the same and records the round in `held`, where the report shows
 * it. Long enough (over 25 characters) to open the Send lock as typing does. */
export const HELD_ROUND_ANSWER = 'Nothing more to add from this session.';

/* WHICH TRUTH ANSWERS WHICH QUESTION, one round at a time.
 *
 * A case's truth is the session as the technician remembers it, each fact with
 * the words a question about it would use (`about`). A question takes the fact
 * whose words it shares most, counted at the start of a word, and each fact
 * answers at most one question in a round. When two questions want the same
 * fact, the one that fits it best gets it. A question no fact fits is left
 * blank, as a technician who did not track that would leave it.
 *
 * Kaleb's BT runs on 9 Oct 2026 are why: the picker took the first fact sharing
 * any one word. Both school questions got the greeting answer ("Q2 answer
 * duplicates Q1 answer"), a question about past sessions got the precursor
 * answer and the note wrote it as history, and a question about what guidance
 * dad used got the coaching answer.
 *
 * IGNORED_ABOUT holds the words nearly every question in a case carries (who
 * was there, the behavior, "before", "prompt"), so sharing one says nothing
 * about which fact is asked for. The picker skips them, and the spec keeps
 * every case's `about` free of them. */
export const IGNORED_ABOUT = [
  'how', 'what', 'when', 'why', 'who', 'which', 'did', 'does', 'was', 'were',
  'before', 'after', 'said', 'say', 'session', 'client', 'he', 'she', 'him', 'her',
  'dad', 'mom', 'father', 'mother', 'parent', 'caregiver', 'prompt', 'hit',
];

/* The phrase at the start of a word somewhere in the text, any case. Shared
   with lib/checks.mjs, which reads a note's mentions the same way. */
export function saysAtWordStart(text, phrase) {
  const at = String(text || '').toLowerCase();
  const p = String(phrase || '').toLowerCase();
  for (let i = at.indexOf(p); i !== -1; i = at.indexOf(p, i + 1)) {
    if (i === 0 || !/[a-z0-9]/.test(at[i - 1])) return true;
  }
  return false;
}

export function pickAnswers(questions, truth) {
  const lc = (s) => String(s || '').toLowerCase();
  const facts = truth || [];
  const fits = [];
  questions.forEach((q, qi) => facts.forEach((t, ti) => {
    const on = (t.about || []).filter((k) => !IGNORED_ABOUT.includes(lc(k)) && saysAtWordStart(q, k));
    if (on.length) fits.push({ qi, ti, on });
  }));
  // Best fit first; a tie goes to the earlier question, then the earlier fact.
  fits.sort((a, b) => b.on.length - a.on.length || a.qi - b.qi || a.ti - b.ti);
  const used = new Set();
  const picked = questions.map(() => ({ truth: null, matchedOn: [], answer: null }));
  for (const f of fits) {
    if (picked[f.qi].answer !== null || used.has(f.ti)) continue;
    used.add(f.ti);
    picked[f.qi] = { truth: f.ti, matchedOn: f.on, answer: facts[f.ti].answer };
  }
  return picked;
}

/* Which truth answered which question, a line each, so a mismatch shows in
   the run's log as well as in the report's `asked`. */
export function answerLines(asked) {
  return (asked || []).map((a) => `  round ${a.round}: ${a.question}\n    ${a.answer
    ? `truth ${a.truth} (on ${(a.matchedOn || []).join(', ')}): ${a.answer}`
    : 'left blank: no truth fits'}`);
}

/* One question on its own: the fact that fits it, or null. */
export function answerFor(question, truth) {
  return pickAnswers([question], truth)[0].answer;
}

/* THE NOTE CARD AS A CLINICIAN COPIES IT: picks per group, text per narrative,
 * and `all`, the whole note in the card's order, each section under its own
 * heading.
 *
 * A narrative the corrections pass changed is drawn as marks in place of its
 * textarea (engine.jsx renderSectionContent), and that box "holds exactly what
 * Copy gives you" (corrections-view.jsx). Reading textareas alone missed every
 * such section: on 9 Oct 2026 the live summaries of v1, v2 and v4 and the
 * Follow Ups of v2 and v4 read as empty, so every goal was "not named". The
 * box's controls are left out, and so is the rail of removed words under it,
 * which the clipboard does not carry either.
 *
 * `all` is built section by section. It was the card's innerText with every
 * field's value added at the end, and innerText never carries a textarea's
 * value, so on Kaleb's BT runs of 9 Oct 2026 every narrative read as if it sat
 * under Summary of Concerns, the last heading. The tool lays them out right.
 * A multi-select gives only its ticked labels, as the form will.
 *
 * Exported for lib/drive.mjs, which runs this same function in the page, so
 * the two benches cannot read a note two ways. Self-contained for that reason. */
export function readNoteCard(card) {
  const CONTROLS = 'button, input, textarea, [data-correction-pop], [data-correction-ask-box]';
  const boxText = (box) => {
    const copy = box.cloneNode(true);
    copy.querySelectorAll(CONTROLS).forEach((n) => n.remove());
    return copy.textContent;
  };
  // A section drawn some other way (the goals table, the facts) as shown, with
  // its fields' values, which innerText does not carry, kept in that section.
  const shownIn = (sec, title) => {
    let shown = sec.innerText;
    sec.querySelectorAll('button, [data-corrections-rail]').forEach((n) => {
      if (n.innerText) shown = shown.replace(n.innerText, '');
    });
    shown = shown.replace(title, '');
    const fields = [...sec.querySelectorAll('textarea, input:not([type]), input[type="text"]')].map((t) => t.value);
    return [shown, ...fields].map((s) => s.trim()).filter(Boolean).join('\n');
  };
  const picks = {};
  card.querySelectorAll('[data-section-id]').forEach((sec) => {
    const on = [...sec.querySelectorAll('[data-option][data-on="1"]')].map((o) => o.getAttribute('data-option'));
    if (sec.querySelector('[data-option]')) picks[sec.getAttribute('data-section-id')] = on;
  });
  const text = {};
  const parts = [];
  card.querySelectorAll('[data-section-key]').forEach((sec) => {
    const key = sec.getAttribute('data-section-key');
    const title = sec.getAttribute('data-section-title') || '';
    const say = (body) => parts.push([title, body].filter(Boolean).join('\n'));
    // A single-select shows only its chosen answer, marked for reading.
    const single = sec.querySelector('[data-single-answer]');
    if (single) { picks[key] = [single.getAttribute('data-single-answer')]; say(picks[key][0]); return; }
    if (sec.querySelector('[data-section-id] [data-option]') || picks[key]) {
      say([...sec.querySelectorAll('[data-option][data-on="1"]')].map((o) => o.getAttribute('data-option')).join('\n'));
      return;
    }
    const marked = sec.querySelector('[data-corrections-section]');
    if (marked) { text[key] = boxText(marked); say(text[key]); return; }
    const ta = sec.querySelector('textarea');
    if (ta) { text[key] = ta.value; say(text[key]); return; }
    say(shownIn(sec, title));
  });
  return { picks, text, all: parts.join('\n\n') };
}

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
    // Waited for, not looked up once: after a Clear the form is drawn again,
    // and on a slow run the box is not there yet the moment Clear returns.
    for (const [label, text] of Object.entries(c.fields || {})) {
      const el = await until(() => fieldNamed(label), `a field named "${label}" on this page`, 10000);
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

  const openPanel = async () => {
    if (shown($('.revision-input'))) return;
    const fab = $('.revision-fab');
    if (shown(fab)) fab.click();
    await until(() => shown($('.revision-input')), 'the panel to open', 5000);
  };

  const readNote = () => readNoteCard($('[data-testid="generated-note"]'));
  const held = () => shown($('[data-skip-held]'));

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
    const heldRounds = [];
    const noteUp = () => shown($('[data-testid="generated-note"]'));
    await until(() => noteUp() || $('[data-panel-question]'), 'the first questions or the note');

    // Up to 3 rounds, the page's own cap.
    for (let round = 0; round < 3 && !noteUp(); round++) {
      if (!$('[data-panel-question]')) break;
      await openPanel();
      const loose = [];
      let answeredAny = false;
      const shownQs = $$('[data-panel-question]').map((el) => ({ i: el.getAttribute('data-panel-question'), question: el.innerText.split('\n')[0] }));
      const picked = pickAnswers(shownQs.map((q) => q.question), c.truth);
      for (const [n, { i, question }] of shownQs.entries()) {
        const { answer, truth, matchedOn } = picked[n];
        asked.push({ round: round + 1, question, answered: !!answer, truth, matchedOn, answer });
        if (!answer) continue;
        answeredAny = true;
        typed.answers += words(answer);
        const own = $(`[data-suggestion-own="${i}:own"]`);
        if (shown(own)) { type(own, answer); enter(own); } else loose.push(answer);
      }
      // A held round with nothing answered: the user's "nothing more" (above).
      if (!answeredAny && held()) {
        heldRounds.push(round + 1);
        typed.answers += words(HELD_ROUND_ANSWER);
        loose.push(HELD_ROUND_ANSWER);
      }
      if (loose.length) type($('.revision-input'), loose.join(' '));
      // Send opens once enough is written, or when the page's lock runs out.
      const send = await until(() => { const b = $('.revision-send'); return b && !b.disabled && b; }, 'Send to open')
        .catch((err) => {
          throw held() ? new Error(`${err.message}: the page held the round and nothing answered it`) : err;
        });
      send.click();
      const last = asked.length ? asked[asked.length - 1].question : '';
      await until(() => noteUp() || ($('[data-panel-question]') && $('[data-panel-question]').innerText.split('\n')[0] !== last), 'the next round or the note').catch(() => {});
    }
    await until(noteUp, 'the note');
    await settle();
    return { id: c.id, note: readNote(), asked, held: heldRounds, typed: { ...typed, total: typed.intake + typed.answers }, seconds: Math.round((Date.now() - started) / 1000) };
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
        log(`${n + 1} of ${CASES.length}: ${c.id}, ${fails.length ? 'FAIL' : 'pass'}, typed ${out.typed.total} words, ${new Set(out.asked.map((a) => a.round)).size} round(s)${out.held.length ? `, held round ${out.held.join(' and ')} answered "${HELD_ROUND_ANSWER}"` : ''}, ${out.seconds}s`);
        if (out.asked.length) log(answerLines(out.asked).join('\n'));
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
