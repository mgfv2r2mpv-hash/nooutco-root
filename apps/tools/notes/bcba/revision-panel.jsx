/* The assistant side panel.
 *
 * Replaces the old per-section "✎ Revise" input and the global corrections box.
 * Both worked, but they made revision a form field: you opened a box attached to
 * one section, typed one instruction, and read the answer in a card somewhere
 * else. This is the same loop as a conversation instead — you point at the part
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
   than a DOM Range — which is the easier half. The chip anchors to the
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
      // put it off-screen — visible to a test, unclickable to a person.
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
  draft, onDraft, onSend, loading, questions, onSkipQuestions, unread,
}) {
  const scrollRef = React.useRef(null);
  const inputRef = React.useRef(null);

  // Keep the newest turn in view as the exchange grows.
  React.useEffect(() => {
    if (!open || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, thread.length, loading, questions]);

  // Pointing at a section is a statement of intent — put the cursor where the
  // instruction goes so the next thing typed lands in the right place.
  React.useEffect(() => {
    if (open && annotation && inputRef.current) inputRef.current.focus();
  }, [open, annotation]);

  const awaitingQuestions = !!(questions && questions.length);

  if (!open) {
    return (
      <button
        type="button"
        className="revision-fab"
        onClick={onToggle}
        aria-label="Open the assistant panel"
      >
        <span aria-hidden="true">💬</span>
        <span>Assistant</span>
        {unread > 0 && <span className="revision-fab-dot" aria-label={unread + " new"} />}
      </button>
    );
  }

  return (
    <aside className="revision-panel" aria-label="Assistant">
      <header className="revision-panel-head">
        <div>
          <p className="revision-panel-title">Assistant</p>
          <p className="revision-panel-sub">
            {awaitingQuestions
              ? "A couple of questions before I draft"
              : "Click any section, or select a phrase, to revise it"}
          </p>
        </div>
        <button type="button" onClick={onToggle} aria-label="Collapse the assistant panel" className="revision-panel-close">×</button>
      </header>

      <div className="revision-panel-body" ref={scrollRef}>
        {thread.length === 0 && !awaitingQuestions && (
          <Bubble role="assistant" muted>
            Nothing yet. Fill in your session notes and press Generate Note — I'll ask about
            anything that looks thin before drafting.
          </Bubble>
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
              Nothing to add — generate anyway
            </button>
          </div>
        )}
        {loading && <Bubble role="assistant" muted>Working…</Bubble>}
      </div>

      <form
        className="revision-panel-foot"
        onSubmit={(e) => { e.preventDefault(); onSend(); }}
      >
        {annotation && (
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
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
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
                ? "Answer here — or skip above…"
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
        </div>
        <p className="revision-foot-note">No PHI. Enter sends, Shift+Enter for a new line.</p>
      </form>
    </aside>
  );
}

window.RevisionPanel = RevisionPanel;
window.useTextSelection = useTextSelection;
