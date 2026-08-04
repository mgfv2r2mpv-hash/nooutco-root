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
   than a DOM Range - which is the easier half. The chip anchors to the
   textarea's own top-right corner instead of the caret: caret coordinates in a
   textarea can't be measured without mirroring the content into a hidden div,
   and the corner is stable, predictable, and never lands under the pointer. */
function useTextSelection(onSelect) {
  const [chip, setChip] = React.useState(null); // {top, left, id, text}

  React.useEffect(() => {
    const read = (e) => {
      const el = e.target;
      if (!el || el.tagName !== "TEXTAREA") return;
      const id = el.getAttribute("data-section-id");
      if (!id) return; // only narrative section boxes opt in
      const start = el.selectionStart, end = el.selectionEnd;
      const text = (el.value || "").slice(start, end).trim();
      if (!text || text.length < 2) { setChip(null); return; }
      // Clamp to the viewport on BOTH axes. The chip is position:fixed and
      // anchored to the textarea, so a section below the fold would otherwise
      // put it off-screen - visible to a test, unclickable to a person.
      const r = el.getBoundingClientRect();
      const CHIP_W = 132, CHIP_H = 40, GUTTER = 8;
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = document.documentElement.clientHeight || window.innerHeight;
      setChip({
        top: Math.min(Math.max(GUTTER, r.top - 6), vh - CHIP_H),
        left: Math.min(Math.max(GUTTER, r.right - 120), vw - CHIP_W),
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
      setChip(null);
    };
    document.addEventListener("mouseup", read);
    document.addEventListener("keyup", read);
    document.addEventListener("pointerdown", clear);
    return () => {
      document.removeEventListener("mouseup", read);
      document.removeEventListener("keyup", read);
      document.removeEventListener("pointerdown", clear);
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
      ✎ Revise this
    </button>
  ) : null;

  return { chipEl, clearChip: () => setChip(null) };
}

/* ── Panel ────────────────────────────────────────────────────────────────── */

function Bubble({ role, children, muted }) {
  const mine = role === "user";
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", marginBottom: 8 }}>
      <div style={{
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

function RevisionPanel({
  open, onToggle, thread, annotation, onClearAnnotation,
  draft, onDraft, onSend, onAskAdvice, loading, questions, onSkipQuestions, unread, quality,
  loggedIn,
  intro,
}) {
  const scrollRef = React.useRef(null);
  const inputRef = React.useRef(null);
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
      if (t.closest(".revision-panel, .revision-fab, [data-revise-chip]")) return;
      if (t.closest(".section-clickable")) return; // that is a revise gesture
      // The report modal is opened FROM this panel and covers it. Collapsing
      // behind it would lose the conversation the report is probably about.
      if (t.closest("#eb-backdrop")) return;
      onToggle();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, onToggle]);

  const awaitingQuestions = !!(questions && questions.length);

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

  if (!open) {
    return (
      <button
        type="button"
        className={"revision-fab quality-" + (signedOut ? "idle" : q.level || "idle")}
        onClick={onToggle}
        aria-label={signedOut ? "Ask NoMe. Sign in to use the assistant, or report a problem." : "Open the assistant. " + qs.label}
        title={signedOut ? "Sign in to use the assistant, or report a problem" : q.reason || qs.label}
      >
        <span className="revision-fab-check" aria-hidden="true">
          {signedOut || q.level === "idle" ? "💬" : q.level === "good" ? "✓" : "!"}
        </span>
        <span className="revision-fab-label">Ask{nomeMark}</span>
        {!signedOut && unread > 0 && <span className="revision-fab-dot" aria-label={unread + " new"} />}
      </button>
    );
  }

  return (
    <React.Fragment>
    <aside className="revision-panel" aria-label="Assistant">
      <header className="revision-panel-head">
        <p className="revision-panel-title">
          <span className={"revision-head-dot quality-" + (signedOut ? "idle" : q.level || "idle")} aria-hidden="true" />
          <span className="revision-fab-label">Ask{nomeMark}</span>
        </p>
        <button type="button" onClick={onToggle} aria-label="Collapse the assistant" className="revision-panel-close">×</button>
      </header>

      <div className="revision-panel-body" ref={scrollRef}>
        {signedOut && (
          <p className="revision-empty">
            Sign in with your access code to use the assistant. If signing in is the
            problem, report it below and say what happened.
          </p>
        )}
        {!signedOut && thread.length === 0 && !awaitingQuestions && (
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
        {awaitingQuestions && (
          <div style={{ margin: "4px 0 10px" }}>
            {questions.map((q, i) => (
              <Bubble key={i} role="assistant">{q.question}</Bubble>
            ))}
            <button
              type="button"
              onClick={onSkipQuestions}
              disabled={loading}
              className="revision-skip"
            >
              Nothing to add - generate anyway
            </button>
          </div>
        )}
        {loading && <Bubble role="assistant" muted>Working…</Bubble>}
      </div>

      <form
        className="revision-panel-foot"
        onSubmit={(e) => { e.preventDefault(); onSend(); }}
      >
        {signedOut && <div className="revision-report-row revision-report-only">{reportButton}</div>}
        {!signedOut && annotation && (
          <div className="revision-chip-row">
            <span className="revision-chip">
              <strong>{annotation.kind === "span" ? "Selected" : "Section"}:</strong>{" "}
              {annotation.kind === "span"
                ? "“" + (annotation.text.length > 46 ? annotation.text.slice(0, 46) + "…" : annotation.text) + "”"
                : annotation.heading}
              <button type="button" onClick={onClearAnnotation} aria-label="Clear the selected target">×</button>
            </span>
          </div>
        )}
        {!signedOut && <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
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
          <button
            type="submit"
            disabled={loading || !draft.trim()}
            className="revision-send"
          >
            {loading ? "…" : "Send"}
          </button>
        </div>}
        {/* Asking is deliberately its own button rather than something inferred
            from the wording of a revision. The supervising clinician's stored
            judgement only reaches a note when someone asks for it, and a guess
            about intent would put it into notes nobody asked to individualise.
            It answers into the thread and never edits the note. */}
        {!signedOut && !awaitingQuestions && onAskAdvice && (
          <div className="revision-advice-row">
            <button
              type="button"
              className="revision-advice"
              disabled={loading}
              onClick={onAskAdvice}
              title={annotation
                ? "Ask what the supervising clinician would do about the selected section"
                : "Ask what the supervising clinician would do next. This answers in the panel and does not change the note."}
            >
              What would you do here?
            </button>
          </div>
        )}
        {/* "No PHI" assumes the reader already knows what counts. Spelling it
            out inline would crowd the footer, so the term itself carries the
            reminder. Click as well as hover, because on a tablet - which is what
            a lot of sessions are written on - there is no hover. */}
        {!signedOut && <p className="revision-foot-note">
          Do not enter{" "}
          <button
            type="button"
            className="phi-term"
            aria-label="What counts as PHI"
            onClick={(e) => { e.preventDefault(); setPhiOpen((o) => !o); }}
            aria-expanded={phiOpen}
          >
            PHI
          </button>
          . Enter sends, Shift+Enter for a new line.
          {phiOpen && (
            <span className="phi-tip" role="note">
              Protected Health Information: anything that could identify a specific person.
              Names, dates of birth, addresses, phone numbers, email, record or insurance
              numbers, or any other personal identifier.
            </span>
          )}
        </p>}
        {!signedOut && <div className="revision-report-row">{reportButton}</div>}
      </form>
    </aside>
    </React.Fragment>
  );
}

window.RevisionPanel = RevisionPanel;
window.useTextSelection = useTextSelection;
