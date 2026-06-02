'use strict';

/* ══════════════════════════════════════════════════════════════════
   PATTERN PACK CO. — assembly-line skin
   ------------------------------------------------------------------
   Pure presentation. The game engine (game.js) calls four hooks:

     PPCSkin.playIntro(cb)            box rolls in, bulk lid opens   → cb
     PPCSkin.onCorrect(box, sym, btn) chosen item slides into slot
     PPCSkin.onWrong(box, btn)        gentle "reject" on the line
     PPCSkin.onComplete(outcome, cb)  bow → ship out → lid closes
                                      → neon lights                  → cb

   All timing lives here and is shortened when <body> has the
   `reduce-motion` class. Every hook is best-effort: if the scene
   markup is missing the engine still works (the box simply shows the
   filled symbol with no animation).
   ══════════════════════════════════════════════════════════════════ */

(function () {

  const $ = id => document.getElementById(id);
  const EASE = 'cubic-bezier(.22,.61,.36,1)';

  // Base durations (ms). Scaled down when reduce-motion is on.
  const D = {
    rollIn:   720,
    settle:   150,
    lidOpen:  460,
    fly:      330,
    bow:      440,
    ship:     720,
    pause:    240,
    lidClose: 420,
  };

  let els = null;

  function cache() {
    els = {
      neon:    $('neon-sign'),
      belt:    $('belt-treads'),
      tray:    $('tray'),
      bowLid:  $('bow-lid'),
      bulkLid: $('bulk-lid'),
    };
  }

  function ready() {
    if (!els) cache();
    return !!(els && els.tray && els.bulkLid && els.bowLid);
  }

  function dur(ms) {
    return document.body.classList.contains('reduce-motion')
      ? Math.max(70, Math.round(ms * 0.4))
      : ms;
  }

  // Remove every in-flight item clone. They are position:fixed, so any
  // straggler would float above the lid (and not follow the box as it
  // ships out). Sweep them whenever the box closes or a new one arrives.
  function sweepFlyers() {
    document.querySelectorAll('.ppc-fly').forEach(n => n.remove());
    document.querySelectorAll('.seq-box.is-landing')
      .forEach(b => b.classList.remove('is-landing'));
  }

  // Set a transform with (or without) a transition, forcing a reflow so
  // a none→duration switch always animates from the current position.
  function tx(el, transform, ms, ease) {
    if (!el) return;
    el.style.transition = ms ? `transform ${ms}ms ${ease || EASE}` : 'none';
    void el.offsetWidth;            // reflow
    el.style.transform = transform;
  }

  // Bulk bin lid: hinged at the bottom front. Closed = upright (covers the
  // bank); open = flipped down out of the way (choices revealed).
  function setBulkLid(open, ms) {
    tx(els.bulkLid, open ? 'rotateX(89deg)' : 'rotateX(0deg)', ms);
    els.bulkLid.classList.toggle('is-open', open);
  }

  // Bow lid over the gift box: hinged at the top back. Stored = flipped up
  // and away (box open); covered = lying flat over the box (bow showing).
  function setBow(covered, ms) {
    tx(els.bowLid, covered ? 'rotateX(0deg)' : 'rotateX(-128deg)', ms);
    els.bowLid.classList.toggle('is-covered', covered);
  }

  // ── Hook: a fresh box rides in and opens ──────────────────────────
  function playIntro(cb) {
    const done = () => { if (typeof cb === 'function') cb(); };
    if (!ready()) return done();

    sweepFlyers();                // clear any leftover in-flight clones
    els.neon.classList.remove('lit');
    setBow(false, 0);              // box open
    setBulkLid(false, 0);         // bulk lid covering the choices
    tx(els.tray, 'translateX(170%)', 0);    // park it in the right tunnel
    els.belt.classList.add('running');

    const inMs = dur(D.rollIn);
    tx(els.tray, 'translateX(0)', inMs);

    setTimeout(() => {
      // little settle, then stop the belt
      tx(els.tray, 'translateY(-5px)', dur(D.settle));
      setTimeout(() => {
        tx(els.tray, 'translateY(0)', dur(D.settle));
        els.belt.classList.remove('running');
        setBulkLid(true, dur(D.lidOpen));   // reveal the choices
        setTimeout(done, dur(D.lidOpen));
      }, dur(D.settle));
    }, inMs);
  }

  // ── Hook: chosen item slides from the bulk bin into its slot ───────
  function onCorrect(boxEl, sym, btnEl) {
    if (!ready() || !boxEl || !btnEl) return;
    try {
      const from = btnEl.getBoundingClientRect();
      const to   = boxEl.getBoundingClientRect();
      if (!from.width || !to.width) return;

      const clone = document.createElement('div');
      clone.className = 'ppc-fly';
      clone.textContent = sym;
      clone.style.left   = from.left + 'px';
      clone.style.top    = from.top  + 'px';
      clone.style.width  = from.width  + 'px';
      clone.style.height = from.height + 'px';
      document.body.appendChild(clone);

      boxEl.classList.add('is-landing');   // hide the slot glyph until it lands

      const dx    = (to.left + to.width / 2) - (from.left + from.width / 2);
      const dy    = (to.top  + to.height / 2) - (from.top  + from.height / 2);
      const scale = to.width / from.width;
      const ms    = dur(D.fly);

      requestAnimationFrame(() => {
        clone.style.transition = `transform ${ms}ms ${EASE}, opacity ${ms}ms ease`;
        clone.style.transform  = `translate(${dx}px, ${dy}px) scale(${scale})`;
      });

      setTimeout(() => {
        clone.remove();
        boxEl.classList.remove('is-landing');
        boxEl.classList.add('slot-pop');
        setTimeout(() => boxEl.classList.remove('slot-pop'), 240);
      }, ms);
    } catch (e) {
      // best-effort only; the slot already shows the symbol
      if (boxEl) boxEl.classList.remove('is-landing');
    }
  }

  // ── Hook: incorrect tap — a small jolt on the line ────────────────
  function onWrong(boxEl, btnEl) {
    if (!ready()) return;
    els.tray.classList.remove('belt-jolt');
    void els.tray.offsetWidth;
    els.tray.classList.add('belt-jolt');
    setTimeout(() => els.tray.classList.remove('belt-jolt'), 420);
  }

  // ── Hook: box finished — bow it, ship it, close lid, light neon ───
  function onComplete(outcome, cb) {
    const done = () => { if (typeof cb === 'function') cb(); };
    if (!ready()) return done();

    // Let the final item finish sliding into its slot before the lid drops.
    const lead = dur(D.fly) + 80;
    setTimeout(() => {
      sweepFlyers();                                 // no clone may float above the lid
      setBow(true, dur(D.bow));                      // lid with a bow drops on
      els.tray.classList.add('is-wrapped');

      setTimeout(() => {
        els.belt.classList.add('running');
        setBulkLid(false, dur(D.lidClose));         // bulk lid closes for next time
        els.neon.classList.add('lit');              // PACKED! thumbs-up glows
        tx(els.tray, 'translateX(-175%)', dur(D.ship)); // ship into the left tunnel

        setTimeout(() => {
          els.belt.classList.remove('running');
          els.tray.classList.remove('is-wrapped');
          done();
        }, dur(D.ship));
      }, dur(D.bow) + dur(D.pause));
    }, lead);
  }

  window.PPCSkin = { playIntro, onCorrect, onWrong, onComplete };

})();
