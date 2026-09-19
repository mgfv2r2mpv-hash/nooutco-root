/* The assistant side panel.
 *
 * Replaces the old per-section "✎ Revise" input and the global corrections box.
 * Both worked, but they made revision a form field: you opened a box attached to
 * one section, typed one instruction, and read the answer in a card somewhere
 * else. This is the same loop as a conversation instead - you point at the part
 * of the note you mean, say what's wrong with it in the panel, and the change
 * lands highlighted in the note itself.
 *
 * The panel carries the whole exchange: the questions asked before drafting, the
 * answers, and every revision since. It docks to the right on a wide screen,
 * becomes a bottom sheet on a narrow one, and collapses to a floating pill so it
 * is never in the way of the note.
 *
 * Defines window.RevisionPanel and window.useTextSelection; loaded before
 * engine.jsx, which owns all the state.
 */

/* ── Selecting a phrase to revise ─────────────────────────────────────────
   Narrative sections are textareas, so a selection is selectionStart/End rather
   than a DOM Range - which is the easier half.

   THE CHIP USED TO ANCHOR TO THE TEXTAREA'S CORNER, and the comment that stood
   here gave the reason: "caret coordinates in a textarea can't be measured
   without mirroring the content into a hidden div". That is true, and it is
   also already done, twice a day, in this same repo: notes-scrub.js mirrors
   every textarea into an absolutely positioned overlay with cloned computed
   style so it can draw PHI highlights over the right characters. The hard part
   was built and running in production while this file called it impossible.

   So it mirrors now, and the chip sits on the phrase. That matters more than it
   sounds: "say what is wrong with THIS" reads as a different offer from a
   button in the corner of a box, and on a phone the corner of a box can be most
   of a screen away from the words it is about.

   Two safety rails. The mirror is measured, never trusted: if anything about it
   comes back empty the chip falls back to the corner and the technician loses
   nothing. And on touch the chip goes BELOW the selection rather than above,
   because iOS puts its own Copy and Look Up callout above a selection and two
   controls in one place is a fight the system wins. */

/* One reusable hidden div. Created on first use, never removed: making and
   dropping one per selection would thrash layout on a phone while somebody
   drags a selection handle. */
function measureMirror() {
  var m = document.getElementById("revise-phrase-mirror");
  if (m) return m;
  m = document.createElement("div");
  m.id = "revise-phrase-mirror";
  m.setAttribute("aria-hidden", "true");
  document.body.appendChild(m);
  return m;
}

/* Where the selected characters actually are, in viewport coordinates.
   Returns null rather than a guess when it cannot say. */
function phraseRect(ta, start, end) {
  try {
    if (!(end > start)) return null;
    var box = ta.getBoundingClientRect();
    if (!box.width) return null;
    var cs = window.getComputedStyle(ta);
    var m = measureMirror();

    /* Position fixed and hidden by visibility rather than display, because a
       display:none element has no layout and therefore no rects to read. */
    m.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;z-index:-1;" +
      "white-space:pre-wrap;overflow-wrap:break-word;word-wrap:break-word;margin:0;";
    [
      "fontSize", "fontFamily", "fontWeight", "fontStyle", "fontVariant",
      "lineHeight", "letterSpacing", "wordSpacing", "textIndent", "textTransform",
      "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      "boxSizing", "tabSize",
    ].forEach(function (k) { try { m.style[k] = cs[k]; } catch (e) {} });
    // A transparent border of the same width, so the first character starts
    // where it starts in the real box rather than one border to the left.
    m.style.borderStyle = "solid";
    m.style.borderColor = "transparent";
    m.style.width = box.width + "px";
    m.style.left = box.left + "px";
    // Scrolled content moves up inside the box; the mirror moves with it, so a
    // phrase halfway down a scrolled section still measures where it is SEEN.
    m.style.top = (box.top - ta.scrollTop) + "px";
    m.textContent = ta.value || "";

    var node = m.firstChild;
    if (!node) return null;
    var range = document.createRange();
    range.setStart(node, Math.min(start, node.length));
    range.setEnd(node, Math.min(end, node.length));
    var rects = range.getClientRects();
    // The FIRST rect, not the bounding one: a selection running over three
    // lines has a bounding box whose top-left is nowhere near its first word.
    var r = rects.length ? rects[0] : range.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) return null;
    // A phrase scrolled out of sight would put the chip outside the section
    // it belongs to, so it is held to the part of the box a person can see.
    var top = Math.min(Math.max(r.top, box.top), box.bottom);
    return { top: top, bottom: Math.min(Math.max(r.bottom, box.top), box.bottom), left: r.left, right: r.right };
  } catch (e) {
    return null;
  }
}

/* Above the phrase on a mouse, below it on a finger, clamped to the viewport on
   both axes. The chip is position:fixed, so a section below the fold would
   otherwise put it off screen: visible to a test, unreachable to a person. */
function placeChip(anchor, touch) {
  var CHIP_W = 152, CHIP_H = 40, GUTTER = 8;
  var vw = document.documentElement.clientWidth || window.innerWidth;
  var vh = document.documentElement.clientHeight || window.innerHeight;
  var top = touch ? anchor.bottom + 8 : anchor.top - CHIP_H - 2;
  if (top < GUTTER) top = anchor.bottom + 8;
  if (top > vh - CHIP_H - GUTTER) top = anchor.top - CHIP_H - 2;
  return {
    top: Math.min(Math.max(GUTTER, top), vh - CHIP_H - GUTTER),
    left: Math.min(Math.max(GUTTER, anchor.left - 8), vw - CHIP_W - GUTTER),
  };
}
// How long an iOS selection handle has to sit still before the chip reads the
// selection. Long enough that a drag does not repaint on every pixel, short
// enough that a technician who has stopped dragging is not waiting on it.
const SELECTION_SETTLE_MS = 200;

function useTextSelection(onSelect) {
  const [chip, setChip] = React.useState(null); // {top, left, id, text}

  React.useEffect(() => {
    /* A SECTION THE CORRECTIONS PASS TOUCHED IS NOT A TEXTAREA. It is drawn as
       spans so a strikethrough is possible, and until now that put it outside
       this whole mechanism: the one kind of section most likely to need a word
       said about it was the one kind you could not select a phrase in. Under
       the author aid flag a corrected section is the COMMON case, so the
       omission would have been most of the note.

       This half is the easy half, ironically. Real text in real elements means
       a real Range, and a Range knows exactly where it is. */
    const readRendered = () => {
      const sel = window.getSelection && window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { setChip(null); return; }
      const range = sel.getRangeAt(0);
      const host = range.commonAncestorContainer;
      const node = host && host.nodeType === 1 ? host : host && host.parentNode;
      if (!node || !node.closest) { setChip(null); return; }
      const view = node.closest("[data-corrections-section]");
      if (!view) { setChip(null); return; }
      const text = String(sel.toString() || "").trim();
      if (!text || text.length < 2) { setChip(null); return; }
      const rects = range.getClientRects();
      const r = rects.length ? rects[0] : range.getBoundingClientRect();
      if (!r || (!r.width && !r.height)) { setChip(null); return; }
      const card = view.closest("[data-section-key]");
      const pos = placeChip(r, touching);
      setChip({
        top: pos.top,
        left: pos.left,
        id: view.getAttribute("data-corrections-section"),
        text,
        heading: (card && card.getAttribute("data-section-title")) || "",
      });
    };

    const read = (e) => {
      const el = e.target;
      /* THE CHIP'S OWN MOUSEUP. It used to be harmless, because `read` bailed
         on anything that was not a textarea and the chip is a button. Now that
         a non-textarea falls through to the rendered branch, the sequence
         pointerdown, mouseup, click had the mouseup find no document selection
         - a textarea's selection is not one - clear the chip, and unmount the
         button before its own click could fire. Revising a phrase stopped
         working entirely, and only the test that clicks the chip caught it. */
      if (el && el.closest && el.closest("[data-revise-chip]")) return;
      if (!el || el.tagName !== "TEXTAREA") return readRendered();
      const id = el.getAttribute("data-section-id");
      if (!id) return; // only narrative section boxes opt in
      const start = el.selectionStart, end = el.selectionEnd;
      const text = (el.value || "").slice(start, end).trim();
      if (!text || text.length < 2) { setChip(null); return; }
      /* The phrase if the mirror can find it, the box's corner if it cannot.
         Falling back rather than failing is deliberate: a chip in a slightly
         dull place still revises the sentence, and no chip at all is a feature
         that disappeared. */
      const box = el.getBoundingClientRect();
      const anchor = phraseRect(el, start, end) ||
        { top: box.top, bottom: box.top + 22, left: box.right - 120, right: box.right };
      const pos = placeChip(anchor, touching);
      setChip({
        top: pos.top,
        left: pos.left,
        id,
        text,
        heading: el.getAttribute("data-section-heading") || "",
      });
    };
    const clear = (e) => {
      // Keep the chip alive while it is being clicked.
      if (e.target && e.target.closest && e.target.closest("[data-revise-chip]")) return;
      const el = e.target;
      if (el && el.tagName === "TEXTAREA" && el.getAttribute("data-section-id")) return;
      if (el && el.closest && el.closest("[data-corrections-section]")) return;
      setChip(null);
    };
    /* TOUCH, and why `read` cannot simply be handed another event name.
       iOS finishes a selection with the drag handles and fires no mouseup on
       the document, so neither listener above ever runs and the chip never
       appears on a phone. The event that DOES report it is selectionchange,
       which fires on document rather than on the textarea, so its e.target is
       the document and `read` would bail on the tagName check. This resolves
       the box from activeElement instead and hands `read` the shape it wants.

       Gated on the LAST pointer having been a touch, because selectionchange
       also fires on every pixel of a mouse drag: ungated, it would pop the chip
       mid-drag on a desktop, which is a behaviour change rather than an
       addition. A mouse-only machine never opens the gate, takes the early
       return forever, and behaves exactly as it did.

       Last, not ever. A latching flag would be simpler and wrong: a touchscreen
       laptop is one device that gets both, and one stray tap would leave the
       new path armed for every mouse drag after it. Writing the flag on every
       pointerdown means a mouse press closes the gate again on the way in. */
    let touching = false;
    let settle = null;
    const noteTouch = (e) => { touching = e.pointerType === "touch"; };
    const readSelection = () => {
      if (!touching) return;
      // iOS fires this on every pixel of handle movement, so read once the
      // handle has been still. Otherwise the chip chases the finger.
      clearTimeout(settle);
      settle = setTimeout(() => {
        const el = document.activeElement;
        if (el && el.tagName === "TEXTAREA") read({ target: el });
        // Nothing is focused when a finger selects rendered text, so the
        // rendered branch is reached directly rather than through activeElement.
        else readRendered();
      }, SELECTION_SETTLE_MS);
    };

    document.addEventListener("mouseup", read);
    document.addEventListener("keyup", read);
    document.addEventListener("pointerdown", clear);
    document.addEventListener("pointerdown", noteTouch, true);
    document.addEventListener("selectionchange", readSelection);
    return () => {
      clearTimeout(settle);
      document.removeEventListener("mouseup", read);
      document.removeEventListener("keyup", read);
      document.removeEventListener("pointerdown", clear);
      document.removeEventListener("pointerdown", noteTouch, true);
      document.removeEventListener("selectionchange", readSelection);
    };
  }, []);

  const chipEl = chip ? (
    <button
      data-revise-chip="true"
      type="button"
      onClick={() => { onSelect({ kind: "span", id: chip.id, heading: chip.heading, text: chip.text }); setChip(null); }}
      style={{
        position: "fixed", top: chip.top, left: chip.left, zIndex: 80,
        padding: "6px 13px", borderRadius: 999, border: "none",
        background: "#374528", color: "white", fontFamily: "inherit",
        fontSize: 12.5, fontWeight: 700, cursor: "pointer",
        boxShadow: "0 4px 14px rgba(45,58,31,.35)", whiteSpace: "nowrap",
      }}
    >
      Say what is wrong
    </button>
  ) : null;

  return { chipEl, clearChip: () => setChip(null) };
}

/* ── Panel ────────────────────────────────────────────────────────────────── */

function Bubble({ role, children, muted }) {
  const mine = role === "user";
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginBottom: 8 }}>
      {/* A turn is pointable, so a message can be about what was said here
          rather than about the note. */}
      <div data-thread-turn={mine ? "you" : "NoMe"} style={{
        maxWidth: "88%", padding: "8px 11px", borderRadius: 10, fontSize: 13, lineHeight: 1.5,
        background: mine ? "#374528" : (muted ? "transparent" : "white"),
        color: mine ? "white" : (muted ? "#7a9460" : "#2d3a1f"),
        border: mine ? "none" : (muted ? "none" : "1px solid #ddecd0"),
        fontStyle: muted ? "italic" : "normal",
        whiteSpace: "pre-wrap",
      }}>
        {children}
      </div>
    </div>
  );
}


/* ── A candidate answer, offered under the question it answers ─────────────
   Same three states as a correction mark, because it is the same contract and a
   technician should not have to learn it twice: a ghost tick while it is
   accepted, an undo arrow and a pencil once they click it, and a check and a
   cross while they are rewording it.

   Accepted is the resting state, so the tick is nearly invisible. What the eye
   should land on is the sentence, which is the thing they are deciding about.

   `alternatives` says this row is one of several answers to ONE question, which
   changes what the controls MEAN without changing what they are. Undoing an
   alternative picks it and strikes its siblings, so the arrow reads "use this
   one instead" rather than "put it back". The gesture stays the same three
   states on purpose: a technician learns this contract once, on the corrections
   marks, and a second interaction model for one row type would cost more than
   the extra click it saves. */
function SuggestionRow({ id, text, accepted, alternatives, onToggle, onEdit }) {
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [buffer, setBuffer] = React.useState(text);

  React.useEffect(() => { setBuffer(text); }, [text]);

  if (editing) {
    return (
      <div className="tg-suggestion is-editing">
        <input
          className="cx-edit"
          value={buffer}
          autoFocus
          aria-label="Reword this suggestion"
          data-suggestion-edit={id}
          onChange={(e) => setBuffer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onEdit(buffer); setEditing(false); }
            if (e.key === "Escape") { setBuffer(text); setEditing(false); }
          }}
        />
        <span className="cx-ctl">
          <button type="button" className="cx-ck" title="Save" data-suggestion-save={id}
            onClick={() => { onEdit(buffer); setEditing(false); }}>✓</button>
          <button type="button" className="cx-ck" title="Cancel" data-suggestion-cancel={id}
            onClick={() => { setBuffer(text); setEditing(false); }}>✕</button>
        </span>
      </div>
    );
  }

  return (
    <div className={"tg-suggestion" + (accepted ? "" : " is-dropped")}>
      <span
        className="tg-suggestion-text"
        data-suggestion={id}
        data-suggestion-accepted={accepted ? "1" : "0"}
      >
        {text}
      </span>
      {open ? (
        <span className="cx-ctl">
          <button type="button" className="cx-ck" data-suggestion-toggle={id}
            title={accepted
              ? (alternatives ? "Drop it, and answer this one yourself" : "Drop this one")
              : (alternatives ? "Use this one instead" : "Put it back")}
            onClick={() => { onToggle(); setOpen(false); }}>{accepted ? "↶" : "↷"}</button>
          <button type="button" className="cx-ck" title="Reword it" data-suggestion-pencil={id}
            onClick={() => { setEditing(true); setOpen(false); }}>✎</button>
        </span>
      ) : (
        <button
          type="button"
          className={"cx-ck" + (accepted ? " is-ghost" : "")}
          title={accepted
            ? "Included. Click to change it."
            : (alternatives ? "Not the one you picked. Click to choose it." : "Dropped. Click to change it.")}
          data-suggestion-tick={id}
          onClick={() => setOpen(true)}
        >
          {accepted ? "✓" : "✗"}
        </button>
      )}
    </div>
  );
}

/* ── The same row, in the shape he ruled for ───────────────────────────────
   SuggestionRow above stays exactly as it is, because it is what the
   technicians are using today and nothing is being taken off them mid-shift.
   This is the ?aid=1 replacement, and the only thing it adds to DispositionRow
   is the open and editing state that the old row kept inside itself. */
/* ── Skipping the gap questions costs a moment ─────────────────────────────
   His idea, 2026-08-05, after the audit trail showed something worth acting on:
   two technicians, 22 sessions, ten gap-question rounds, and ZERO revisions ever
   made. They generate and copy. The questions are the one moment the session is
   still in their head, and skipping them is currently one frictionless click.

   So the escape stays, and it costs a few seconds. The bar drains, then the
   button works. This is deliberately a delay and NOT a block: the engine's own
   comment says a tired technician at 7pm with eight notes left must never be
   trapped behind a question, and that is still right. A wait they can watch end
   is not a trap; a wait with no exit would be.

   The duration is passed in rather than fixed here, because his next step is to
   scale it - the closer the note is to ready, the shorter the drain - and that
   judgement belongs to whatever can see the note, not to a button. */
function SkipAfterCooldown({ seconds, onSkip, loading, carrying }) {
  const total = Math.max(0, Number(seconds) || 0);
  const [left, setLeft] = React.useState(total);

  React.useEffect(() => {
    setLeft(total);
    if (!total) return;
    // Wall-clock, not a tick counter: a backgrounded tab throttles timers, and
    // counting ticks would make the wait longer for someone who looked away.
    const started = Date.now();
    const id = setInterval(() => {
      const remaining = Math.max(0, total - Math.round((Date.now() - started) / 1000));
      setLeft(remaining);
      if (remaining <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [total]);

  const ready = left <= 0;
  const pct = total ? ((total - left) / total) * 100 : 100;

  return (
    <div className="skip-cooldown">
      <button
        type="button"
        onClick={onSkip}
        disabled={loading || !ready}
        className="revision-skip"
        title={ready
          ? (carrying ? "Generate with the suggestions you left standing" : "Generate without answering these")
          : "Have a look at the questions first. This unlocks in a moment."}
      >
        {/* This button is the ACCEPT path when suggestions are on screen, since
            sending needs typed text and agreeing with a suggestion needs none.
            Calling that "nothing to add" while it carries two sentences into
            the note would describe the wrong thing entirely. */}
        {carrying
          ? (ready ? "Use these and generate" : `Use these and generate (${left}s)`)
          : (ready ? "Nothing to add - generate anyway" : `Nothing to add (${left}s)`)}
      </button>
      {!ready && (
        <div className="skip-cooldown-bar" aria-hidden="true">
          <span style={{ width: pct + "%" }} />
        </div>
      )}
    </div>
  );
}

/* ── The two glyphs ───────────────────────────────────────────────────────
   Drawn here rather than pulled from an icon font or a sprite sheet: the notes
   pages compile their JSX in the browser and vendor everything they need, so a
   second network dependency for two shapes would be the most expensive way to
   save twenty lines. Stroked in currentColor, so the mic inverts with the
   button when it is listening and neither needs a second colour rule.

   aria-hidden on both, because the button beside them carries the name. An SVG
   that announces itself would have a screen reader read the control twice. */
function MicGlyph() {
  return (
    <svg className="icon-btn-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function SendGlyph() {
  return (
    <svg className="icon-btn-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 3 10.5 13.5" />
      <path d="M21 3 14.5 21 10.5 13.5 3 9.5z" />
    </svg>
  );
}

function RevisionPanel({
  open, onToggle, thread, annotation, onClearAnnotation,
  draft, onDraft, onSend, onAskAdvice, canAsk, onExportPairs, pairCount, loading, questions, onSkipQuestions, skipCooldown, skipHeld, unread, quality, suggestionDisposition, onApproveSuggestion, placedQuestions, pendingAnswers,
  suggestState, suggestionAccepted, onToggleSuggestion, onEditSuggestion, acceptedSuggestions,
  loggedIn,
  intro,
  routingAsks, onTakeRouted, onLeaveRouted,
  bcbaOffer, onTakeBcba, onDismissBcba,
  ticketOffer, ticketFiling, onFileTicket, onDismissTicket,
  pointMode, onPointMode, pointScope,
  changes, onApproveChange, onRevertChange, onEditChange, onGoToSection,
}) {
  const scrollRef = React.useRef(null);
  const inputRef = React.useRef(null);

  /* THE PILL'S NUMBER CHANGES MEANING, and that is the whole redesign in one
     word. It used to carry the count of things wanting something from the
     technician, which is a debt: seven things to answer. The questions moved
     onto the note itself, so what is left to count is what was already done for
     them, which is a receipt: six changes, all of them in, none of them owed.
     Same badge, same corner, opposite meaning. */
  const changeList = Array.isArray(changes) ? changes : [];
  const hasChanges = changeList.length > 0;
  const [view, setView] = React.useState("ask");

  /* Opening with changes shows the changes, because that is the answer to the
     question a technician opens this with. Switching to the composer is their
     choice and it sticks: this only runs when the panel opens or when changes
     appear for the first time, so a pass landing mid-sentence never yanks the
     view out from under someone who is typing. */
  React.useEffect(() => {
    if (!hasChanges) setView("ask");
    else if (open) setView("changes");
  }, [open, hasChanges]);

  /* TALKING TO THE NOTE. Typing on a phone after a session is the root canal,
     and a technician who can hold a button and say what happened is getting
     something the EHR cannot give them.

     The recogniser lives in a ref rather than in state because the button needs
     to know whether one is running on the way DOWN, and a state read inside a
     rapid keydown repeat is stale. The ref also doubles as the reentry guard:
     NoteSpeech.listen returns a stop function on every path, including the ones
     that fail, so a non-null ref means one is up. */
  const [listening, setListening] = React.useState(false);
  const stopRef = React.useRef(null);
  const draftRef = React.useRef(draft);
  React.useEffect(() => { draftRef.current = draft; }, [draft]);

  /* Recognised words go into the same box typing goes into, which is the whole
     privacy story: the scrub that tokenises every name before a model sees it
     sits downstream of this box and does not care how the words arrived. */
  const startTalking = () => {
    if (stopRef.current) return;
    if (!window.NoteSpeech || !window.NoteSpeech.available()) return;
    let ended = false;
    const done = () => { ended = true; stopRef.current = null; setListening(false); };
    const stop = window.NoteSpeech.listen({
      onText: (said) => {
        const heard = String(said || "").trim();
        if (!heard) return;
        const had = draftRef.current || "";
        // Adding, never replacing. Somebody who typed half of it and said the
        // rest should keep both halves.
        const joined = had && !/\s$/.test(had) ? had + " " + heard : had + heard;
        draftRef.current = joined;
        onDraft(joined);
      },
      onEnd: done,
      onError: done,
    });
    // listen() reports a failed start through onError before it returns, so a
    // ref set here would be a stop function for a recogniser that never ran.
    if (ended) return;
    stopRef.current = stop;
    setListening(true);
  };

  const stopTalking = () => {
    const stop = stopRef.current;
    stopRef.current = null;
    setListening(false);
    if (stop) stop();
  };

  // Let go of a button that is gone and the recogniser would keep the
  // microphone open with nothing left to put the words into.
  React.useEffect(() => () => { if (stopRef.current) stopRef.current(); }, []);

  const [phiOpen, setPhiOpen] = React.useState(false);

  // Keep the newest turn in view as the exchange grows.
  React.useEffect(() => {
    if (!open || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, thread.length, loading, questions]);

  // Pointing at a section is a statement of intent - put the cursor where the
  // instruction goes so the next thing typed lands in the right place.
  React.useEffect(() => {
    if (open && annotation && inputRef.current) inputRef.current.focus();
  }, [open, annotation]);

  /* Tapping off the panel collapses it, so the technician can get back to the
     page - but the click still reaches whatever it landed on.
   *
   * This started as a full-screen backdrop, which was wrong: it swallowed every
   * click on the note, and clicking a section is the tool's core gesture. So it
   * listens instead of blocking, and deliberately does NOT collapse when the
   * click was on a revisable section or the chip, because that click means
   * "revise this" and the panel is where the instruction gets typed. */
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest(".revision-panel, .revision-dock, .revision-fab, .point-toggle, [data-revise-chip]")) return;
      if (t.closest(".section-clickable")) return; // that is a revise gesture
      // The report modal is opened FROM this panel and covers it. Collapsing
      // behind it would lose the conversation the report is probably about.
      if (t.closest("#eb-backdrop")) return;
      onToggle();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, onToggle]);

  /* One read of the flag for the whole panel. Off, every line below is the
     panel the technicians are using today. */
  const aidOn = !!(window.authorAidEnabled && window.authorAidEnabled() && window.DispositionRow);
  const awaitingQuestions = !!(questions && questions.length);

  /* THE FLOOR PLAN'S OTHER HALF. Moving the questions onto the page is only
     half the fix: measured on an iPhone 14 profile, this panel is 465px of a
     664px viewport, so with the questions gone it was still a tall empty box
     sitting on top of the question it had just handed over.

     When every question is drawn on the page, the panel has exactly one thing
     left that the page cannot do, which is the button that ends the round. So
     it becomes that button. The answer box goes too: with an answer box under
     every question, a second one here labelled "answer here" is a second place
     to type the same thing. */
  const everyQuestionPlaced = awaitingQuestions
    && questions.every((q, i) => placedQuestions && placedQuestions[i]);
  const barMode = awaitingQuestions && everyQuestionPlaced;
  // Whether the held line can point at a suggestion, which is the cheapest way
  // out of the gate when there is one to keep.
  const hasSuggestions = awaitingQuestions && questions.some((q) => (q.suggestions || []).length > 0);

  /* The error report used to be a second floating circle sitting on the same
     corner as this pill. It lives in here now, which fixes the collision and
     also puts it somewhere reachable while LOGGED OUT - the state you are in
     when the thing you want to report is that you cannot log in. The panel
     renders before authentication for exactly that reason. */
  const openReport = () => {
    if (window.ErrorReport) window.ErrorReport.open();
  };

  /* The wordmark, not the word. An img with alt text rather than a CSS
     background, so the panel header still reads "Ask NoMe" aloud instead of
     "Ask" followed by silence. The pill carries its own aria-label, which
     names the note's state and is the more useful thing to announce there. */
  const nomeMark = <img className="nome-mark" src="/notes/nome-wordmark.png" alt="NoMe" />;
  const reportButton = (
    <button type="button" className="revision-report" onClick={openReport}>
      ⚠ Report a problem
    </button>
  );

  // Collapsed, the assistant is a pill carrying the note's quality at a glance:
  // green when it reads complete, amber when it is thin but usable, red when
  // something a payer would ask for is missing. Grey before there is a note to
  // judge. The state is the reason to open it, so it belongs on the button.
  const q = quality || {};
  const QUALITY = {
    good:    { dot: "#4a8a2f", label: "Note looks complete" },
    thin:    { dot: "#d9932b", label: "Note is usable but thin" },
    missing: { dot: "#b3261e", label: "Note is missing something important" },
    idle:    { dot: "#a9b89a", label: "No note yet" },
  };
  const qs = QUALITY[q.level] || QUALITY.idle;

  // Signed out there is no note to judge, so the disc sits idle and the panel
  // offers the report instead of a composer. The pill still says Ask NoMe: it
  // is the same assistant either way, and the label is how a person finds it
  // when the thing they need to report is that they cannot log in.
  const signedOut = loggedIn === false;

  /* Point mode.
   *
   * Clicking only worked where a yellow bar already said it would, which reads
   * as clunky next to Lavish where you can click anything. This is the mode
   * selector he asked for: it sits beside the collapsed pill, and while it is
   * on, anything you hover is outlined and anything you click becomes the
   * thing the next message is about.
   *
   * Scope is by role, his call: an admin can point at the whole page including
   * labels, help text and buttons, because that is where their feedback about
   * the tool comes from. Everyone else points at note content only, so a
   * technician cannot end up asking NoMe to revise a heading. */
  const pointToggle = onPointMode ? (
    <button
      type="button"
      className={"point-toggle" + (pointMode ? " is-on" : "")}
      onClick={() => onPointMode(!pointMode)}
      aria-pressed={pointMode}
      aria-label={pointMode ? "Stop pointing at things" : "Point at something on the page"}
      title={
        pointMode
          ? "Pointing. Click anything, or press Escape."
          : pointScope === "page"
            ? "Point at anything on the page"
            : "Point at any part of the note"
      }
    >
      <span aria-hidden="true">◎</span>
    </button>
  ) : null;

  if (!open) {
    return (
      <div className="revision-dock">
        {pointToggle}
        <button
          type="button"
          className={"revision-fab quality-" + (signedOut ? "idle" : q.level || "idle")}
          onClick={onToggle}
          aria-label={
            signedOut
              ? "Ask NoMe. Sign in to use the assistant, or report a problem."
              : hasChanges
                ? "See what NoMe changed. " + changeList.length + (changeList.length === 1 ? " change" : " changes") + ", already in your note."
                : "Open the assistant. " + qs.label
          }
          title={signedOut ? "Sign in to use the assistant, or report a problem" : q.reason || qs.label}
        >
          <span className="revision-fab-check" aria-hidden="true">
            {signedOut || q.level === "idle" ? "💬" : q.level === "good" ? "✓" : "!"}
          </span>
          {!signedOut && hasChanges ? (
            <span className="revision-fab-label" data-fab-changes={changeList.length}>
              {changeList.length} {changeList.length === 1 ? "change" : "changes"}
            </span>
          ) : (
            <span className="revision-fab-label">Ask{nomeMark}</span>
          )}
          {!signedOut && !hasChanges && unread > 0 && <span className="revision-fab-dot" aria-label={unread + " new"} />}
        </button>
      </div>
    );
  }

  return (
    <React.Fragment>
    <aside className={"revision-panel" + (barMode ? " revision-panel-bar" : "")} aria-label="Assistant">
      <header className="revision-panel-head">
        <p className="revision-panel-title">
          <span className={"revision-head-dot quality-" + (signedOut ? "idle" : q.level || "idle")} aria-hidden="true" />
          <span className="revision-fab-label">Ask{nomeMark}</span>
        </p>
        <span className="revision-head-actions">
          {/* The selector lives in both places, as he asked: in the panel and
              floating beside the pill when collapsed. Pointing at something is
              just as likely mid-conversation as before one starts. */}
          {pointToggle}
          <button type="button" onClick={onToggle} aria-label="Collapse the assistant" className="revision-panel-close">×</button>
        </span>
      </header>

      <div className="revision-panel-body" ref={scrollRef}>
        {/* THE DRAWER, AND WHY IT IS A VIEW RATHER THAN A THIRD FLOATING THING.
            The report button used to be its own circle on this corner and the
            collision is recorded above as the reason it moved in here. A
            changes sheet floating beside the pill would rebuild exactly that
            problem, so the panel carries two views and the pill stays one
            control. */}
        {hasChanges && (
          <div className="cd-switch" role="group" aria-label="What you are looking at">
            <button
              type="button"
              className={"cd-tab" + (view === "changes" ? " is-on" : "")}
              data-changes-tab="changes"
              aria-pressed={view === "changes"}
              onClick={() => setView("changes")}
            >
              What changed
            </button>
            <button
              type="button"
              className={"cd-tab" + (view === "ask" ? " is-on" : "")}
              data-changes-tab="ask"
              aria-pressed={view === "ask"}
              onClick={() => setView("ask")}
            >
              Ask NoMe something
            </button>
          </div>
        )}

        {view === "changes" && window.ChangesDrawer && (
          <window.ChangesDrawer
            entries={changeList}
            onApprove={onApproveChange}
            onRevert={onRevertChange}
            onEdit={onEditChange}
            onGoTo={onGoToSection}
          />
        )}

        {view !== "changes" && (
          <React.Fragment>
        {signedOut && (
          <p className="revision-empty">
            Sign in with your access code to use the assistant. If signing in is the
            problem, report it below and say what happened.
          </p>
        )}
        {!signedOut && thread.length === 0 && !awaitingQuestions && (
          <p className="revision-empty">
            {intro || "Fill in the form above and press the generate button. I'll ask about anything that looks thin before drafting, then you can click any section, or select a phrase inside one, to revise it."}
          </p>
        )}
        {thread.map((m, i) => (
          <Bubble key={i} role={m.role} muted={m.kind === "status"}>{m.text}</Bubble>
        ))}

        {/* Feedback about the tool, offered as a ticket stub. Admin only, and
            only after pointing at page furniture. */}
        {ticketOffer ? (
          <div className="bcba-offer ticket-offer">
            <p className="bcba-offer-q">File this as a stub?</p>
            <p className="bcba-offer-preview">{ticketOffer.note}</p>
            <div className="bcba-offer-actions">
              <button type="button" className="bcba-take" onClick={onFileTicket} disabled={ticketFiling}>
                {ticketFiling ? "Filing..." : "File it"}
              </button>
              <button type="button" className="bcba-leave" onClick={onDismissTicket} disabled={ticketFiling}>
                Not now
              </button>
            </div>
          </div>
        ) : null}

        {/* Something the technician said they were unsure about, offered as a
            question for the BCBA. Offered, never applied: putting words in a
            clinical record on their behalf is not the tool's call. It goes in
            the follow-up section, which already exists to carry questions. */}
        {bcbaOffer ? (
          <div className="bcba-offer">
            <p className="bcba-offer-q">
              That sounds like one for the BCBA. Add this to the note?
            </p>
            <p className="bcba-offer-preview">{bcbaOffer}</p>
            <div className="bcba-offer-actions">
              <button type="button" className="bcba-take" onClick={onTakeBcba}>Add it to the note</button>
              <button type="button" className="bcba-leave" onClick={onDismissBcba}>No thanks</button>
            </div>
          </div>
        ) : null}

        {/* A revision that reached past the section that was clicked, where the
            model would not vouch for the routing. Asked here rather than inline
            in the note, per his ruling, so the whole exchange stays in one
            scroll. Declining keeps the wording in the conversation rather than
            deleting it. */}
        {Array.isArray(routingAsks) && routingAsks.map((ask) => (
          <div key={ask.id} className="routing-ask">
            <p className="routing-ask-q">
              This also belongs in <strong>{ask.heading}</strong>.
              {ask.why ? " " + ask.why.replace(/\.?$/, ".") : ""}
            </p>
            <p className="routing-ask-preview">
              {Array.isArray(ask.value) ? ask.value.join(", ") : String(ask.value || "")}
            </p>
            <div className="routing-ask-actions">
              <button type="button" className="routing-take" onClick={() => onTakeRouted(ask)}>
                Put it there
              </button>
              <button type="button" className="routing-leave" onClick={() => onLeaveRouted(ask)}>
                Leave that section
              </button>
            </div>
          </div>
        ))}
        {awaitingQuestions && (
          <div style={{ margin: "4px 0 10px" }}>
            {/* A question already drawn on the page beside the box it asks about
                is not drawn again here. Asking the same thing twice, in two
                places, with two answer boxes, would be worse than the panel it
                replaced. A question with no box on this form was not placed and
                still belongs here. */}
            {questions.map((q, i) => (placedQuestions && placedQuestions[i]) ? null : (
              <React.Fragment key={i}>
                <Bubble role="assistant">{q.question}</Bubble>
                {(q.suggestions || []).length > 0 && aidOn && (
                  <div className="tg-suggestions dz-group">
                    <window.DispositionHeading count={q.suggestions.length} />
                    {q.suggestions.map((raw, j) => {
                      const key = i + ":" + j;
                      const st = (suggestState || {})[key] || {};
                      return (
                        <window.AidSuggestion
                          key={key}
                          id={key}
                          text={typeof st.text === "string" ? st.text : raw}
                          state={suggestionDisposition ? suggestionDisposition(i, j) : "default"}
                          alternatives={q.suggestions.length > 1}
                          onApprove={() => onApproveSuggestion && onApproveSuggestion(key)}
                          onRevert={() => onToggleSuggestion(key)}
                          onEdit={(text) => onEditSuggestion(key, text)}
                        />
                      );
                    })}
                  </div>
                )}
                {(q.suggestions || []).length > 0 && !aidOn && (
                  <div className="tg-suggestions">
                    {q.suggestions.map((raw, j) => {
                      const key = i + ":" + j;
                      const st = (suggestState || {})[key] || {};
                      /* The engine owns which one stands, because the default
                         depends on how many the question carries and the panel
                         should not be re-deriving a clinical rule. */
                      const accepted = suggestionAccepted
                        ? suggestionAccepted(i, j)
                        : !st.reverted;
                      return (
                        <SuggestionRow
                          key={key}
                          id={key}
                          text={typeof st.text === "string" ? st.text : raw}
                          accepted={accepted}
                          alternatives={q.suggestions.length > 1}
                          onToggle={() => onToggleSuggestion(key)}
                          onEdit={(text) => onEditSuggestion(key, text)}
                        />
                      );
                    })}
                  </div>
                )}
              </React.Fragment>
            ))}
            {skipHeld ? (
              /* No button rather than a dead one. A disabled control invites
                 hunting for the state that enables it, and there is only one:
                 answer something. */
              <div className="skip-held" data-skip-held="1">
                {hasSuggestions && !acceptedSuggestions
                  ? "Keep one of the suggestions, or answer a question, and the note generates."
                  : "Answer one of these and the note generates."}
              </div>
            ) : (
              <SkipAfterCooldown
                seconds={skipCooldown}
                onSkip={onSkipQuestions}
                loading={loading}
                carrying={acceptedSuggestions || 0}
              />
            )}
          </div>
        )}
        {loading && <Bubble role="assistant" muted>Working…</Bubble>}
          </React.Fragment>
        )}
      </div>

      <form
        className={"revision-panel-foot" + (barMode ? " is-bar" : "")}
        onSubmit={(e) => { e.preventDefault(); onSend(); }}
      >
        {signedOut && <div className="revision-report-row revision-report-only">{reportButton}</div>}
        {!signedOut && annotation && (
          <div className="revision-chip-row">
            <span className={"revision-chip" + (annotation.kind === "page" ? " is-page" : "")}>
              <strong>
                {annotation.kind === "span" ? "Selected"
                  : annotation.kind === "page" ? "About the page"
                  : annotation.kind === "quote" ? "From " + (annotation.heading || "the conversation")
                  : "Section"}:
              </strong>{" "}
              {annotation.kind === "span" || annotation.kind === "page" || annotation.kind === "quote"
                ? "“" + (String(annotation.text || "").length > 46
                    ? String(annotation.text).slice(0, 46) + "…"
                    : String(annotation.text || "")) + "”"
                : annotation.heading}
              <button type="button" onClick={onClearAnnotation} aria-label="Clear the selected target">×</button>
            </span>
          </div>
        )}
        {/* ONE ROW FOR THE THREE THINGS THAT SEND WORDS. Typing, talking and
            sending were three stacked full-width blocks, and measured on an
            iPhone 14 profile the footer they made was 276px of a 664px screen:
            more than a third of the phone spent on chrome, above a note the
            technician is trying to read. Hold-to-talk was the biggest single
            block and it is the same verb as Send, so it belongs beside it.

            Icons rather than words for both, because a 46px square says
            "press me" in a quarter of the width a label needs, and these two
            are the most-used controls on the panel - the pair a technician
            learns on day one and never has to read again. Everything that
            cannot be learned once still says what it is, in the line below. */}
        {!signedOut && !barMode && <div className="revision-compose">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); }
            }}
            rows={2}
            placeholder={
              awaitingQuestions
                ? "Answer here - or skip above…"
                : annotation
                  ? "What should change about this?"
                  : "Ask for a change, or add a detail you forgot…"
            }
            className="revision-input"
          />
          {/* HIS RULING IS ON THE AFFORDANCE. He allowed the audio path and asked
              staff to keep names off it: "Staff should still avoid using client
              names on this surface so they should not be dictating it to Apple as
              well. This will be part of their training that I will do in person."
              A rule that lives only in a training session is a rule somebody
              forgets in month four, so it sits under this button rather than as
              an alert in a queue. It costs the technician nothing and it is
              never not there.

              Offered only where the browser can actually hear, which is a
              capability check and not a browser check: sniffing for Safari would
              refuse a capable browser we did not think of AND offer the control
              on a version that cannot do it. */}
          {window.NoteSpeech && window.NoteSpeech.available() && (
            <button
              type="button"
              data-speak="true"
              className={"icon-btn speak-btn" + (listening ? " is-on" : "")}
              aria-pressed={listening ? "true" : "false"}
              title={listening ? "Listening. Let go when you are done." : "Hold to talk"}
              /* Capturing the pointer means a thumb that slides off the button
                 while talking still ends the recording on the way up, rather
                 than leaving the microphone open. */
              onPointerDown={(e) => {
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
                startTalking();
              }}
              onPointerUp={stopTalking}
              onPointerCancel={stopTalking}
              onLostPointerCapture={stopTalking}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") { e.preventDefault(); startTalking(); }
              }}
              onKeyUp={(e) => {
                if (e.key === " " || e.key === "Enter") { e.preventDefault(); stopTalking(); }
              }}
            >
              <MicGlyph />
              {/* The state in words, for a screen reader and for the test that
                  asks whether this button says which of its two states it is
                  in. Sighted people read the same thing off the colour and off
                  the line under the row. */}
              <span className="icon-btn-say">
                {listening ? "Listening. Let go when you are done." : "Hold to talk"}
              </span>
            </button>
          )}
          <button
            type="submit"
            /* An answer typed under the question it answers is still an
               answer. This used to read the panel's own box only, so the floor
               plan's boxes could be full and Send dead. */
            disabled={loading || (!draft.trim() && !pendingAnswers)}
            className="icon-btn revision-send"
            title="Send"
          >
            {loading ? <span className="icon-btn-wait" aria-hidden="true">…</span> : <SendGlyph />}
            <span className="icon-btn-say">{loading ? "Sending" : "Send"}</span>
          </button>
        </div>}
        {/* ONE LINE OF FINE PRINT, NOT THREE. The rule about names, the rule
            about PHI and what the Enter key does were a centred paragraph, a
            left-aligned paragraph and a full-width button between them. They
            are the same kind of thing - the stuff you read once - so they read
            as one line now, at the size the speaking rule already demanded.

            "No PHI" assumes the reader already knows what counts, so the term
            itself carries the definition. Click as well as hover, because on a
            tablet - which is what a lot of sessions are written on - there is
            no hover. */}
        {!signedOut && !barMode && <p className="revision-foot-note">
          {/* The hint half swaps to the live state, because a microphone that
              is listening has to say so somewhere a person is already looking,
              and the icon alone cannot. The RULE half never swaps: his ruling
              is that it is never not there, and "never" includes the seconds
              somebody is actually speaking into it. */}
          {window.NoteSpeech && window.NoteSpeech.available() && (
            <span data-speak-rule="true" className={listening ? "is-listening" : undefined}>
              {listening ? "Listening. Let go when you are done." : "Hold the mic to talk."}
              {" "}{window.NoteSpeech.RULE}{" "}
            </span>
          )}
          Never enter{" "}
          <button
            type="button"
            className="phi-term"
            aria-label="What counts as PHI"
            onClick={(e) => { e.preventDefault(); setPhiOpen((o) => !o); }}
            aria-expanded={phiOpen}
          >
            PHI
          </button>
          . Enter sends
          {/* A KEYBOARD HINT ONLY WHERE THERE IS A KEYBOARD. On a phone there
              is no Shift key to press, and this clause is the difference
              between two lines of fine print and three: CI's chromium measured
              the footer past its own bound on Linux fonts while a Mac read it
              comfortably inside, which is the same shape as every other
              measurement this repo has taken on one machine and believed. */}
          <span className="foot-keys">, Shift+Enter for a new line</span>.
          {phiOpen && (
            <span className="phi-tip" role="note">
              Protected Health Information: anything that could identify a specific person.
              Names, dates of birth, addresses, phone numbers, email, record or insurance
              numbers, or any other personal identifier.
            </span>
          )}
        </p>}
        {/* THE ERRANDS, SIDE BY SIDE. Asking the supervising clinician, taking
            the captured pairs and reporting a problem each had a full-width row
            to themselves and a divider above the last one. None of them is the
            main loop, and three stacked full-width buttons read as three
            decisions to make before typing. One row, one weight.

            Asking is deliberately its own button rather than something inferred
            from the wording of a revision. The supervising clinician's stored
            judgement only reaches a note when someone asks for it, and a guess
            about intent would put it into notes nobody asked to individualise.
            It answers into the thread and never edits the note. */}
        {!signedOut && <div className="revision-errands">
          {!awaitingQuestions && onAskAdvice && (
            <button
              type="button"
              className="revision-advice"
              /* Disabled until there is a note to advise on. It used to accept
                 the click and answer "generate the note first", so four clicks
                 stacked four identical refusals in the thread and nothing on the
                 button ever said why. A control that cannot do its job should
                 look like it, not explain itself afterwards. */
              disabled={loading || !canAsk}
              onClick={onAskAdvice}
              title={!canAsk
                ? "Generate the note first, then this can suggest what to do next."
                : annotation
                  ? "Ask what the supervising clinician would do about the selected section"
                  : "Ask what the supervising clinician would do next. This answers in the panel and does not change the note."}
            >
              What would you do here?
            </button>
          )}
          {/* Only the owning clinician captures pairs, so only he sees this, and
              it only appears once there is something to take. Export is his
              deliberate act: the file lands in Downloads and he moves it into
              ~/Private/voice-corpus. Nothing here has ever been sent anywhere. */}
          {pairCount > 0 && (
            <button
              type="button"
              className="revision-advice revision-export"
              onClick={onExportPairs}
              title="Save the captured before/after pairs to a file. Nothing has left this browser."
            >
              Export {pairCount} pair{pairCount === 1 ? "" : "s"}
            </button>
          )}
          {reportButton}
        </div>}
      </form>
    </aside>
    </React.Fragment>
  );
}

window.RevisionPanel = RevisionPanel;
window.useTextSelection = useTextSelection;
