/* A proposed change to a section, drawn before it is accepted.
 *
 * His ruling, 2026-09-23, on a screenshot of the old word-level view: "this is
 * hard to read. There has to be a better way to show a changed line than this."
 * The old view drew every deleted word struck through beside every inserted
 * one, so a reworded sentence read as both sentences shuffled together.
 *
 * What replaces it, scoped by him to this Accept/Discard view only:
 *
 *   rewrite   -> the NEW wording, on a green-red candystripe
 *   addition  -> green, as before
 *   removal   -> the empty watermark from the corrections view (no text node)
 *
 * Hover, click or tap on any of the three shows what it was, and a circle in
 * that popover opens the change in the Ask NoMe panel, quoted in the chip, the
 * same way a text selection does.
 *
 * The popover exists only while open, so the view's text is the proposed note
 * and nothing else. scrub-token-roundtrip.spec.js reads this view's innerText.
 */
(function () {
  "use strict";

  function Popover({ hunk, onAsk }) {
    const label = hunk.type === "ins" ? "Added" : hunk.type === "del" ? "Removed" : "Was";
    const body = hunk.type === "ins" ? "New text"
      : hunk.type === "del" ? hunk.text.trim() : hunk.was.trim();
    return (
      <span className="pd-pop" role="note" data-pending-pop="true" onClick={(e) => e.stopPropagation()}>
        <span className="pd-pop-label">{label}</span>
        <span className="pd-pop-was">{body}</span>
        <button
          type="button"
          className="pd-ask"
          data-pending-ask="true"
          aria-label="Open this change in Ask NoMe"
          title="Open this change in Ask NoMe"
          onClick={(e) => { e.stopPropagation(); onAsk(hunk); }}
        />
      </span>
    );
  }

  function Hunk({ hunk, n, open, onHover, onPin, onAsk }) {
    const cls = hunk.type === "change" ? "pd-change" : hunk.type === "ins" ? "diff-ins" : "cx-wm cx-wm-cut pd-cut";
    const hoverOnly = (fn) => (e) => { if (e.pointerType === "mouse") fn(); };
    const toggle = (e) => { e.stopPropagation(); onPin(); };
    return (
      <span
        className="pd-hunk"
        onPointerEnter={hoverOnly(() => onHover(true))}
        onPointerLeave={hoverOnly(() => onHover(false))}
      >
        {/* A removal holds no text node, so the numeral is generated content
            and nothing of the old wording sits in the view's text. */}
        <span
          className={cls}
          data-pending-hunk={hunk.type}
          data-n={hunk.type === "del" ? n : undefined}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          aria-label={hunk.type === "del" ? "Removed text" : undefined}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPin(); }
            if (e.key === "Escape" && open) { e.preventDefault(); onPin(); }
          }}
        >
          {hunk.type === "del" ? null : hunk.text}
        </span>
        {open && <Popover hunk={hunk} onAsk={onAsk} />}
      </span>
    );
  }

  function PendingDiff({ before, after, onAsk }) {
    const [pinned, setPinned] = React.useState(null);
    const [hovered, setHovered] = React.useState(null);
    const list = React.useMemo(() => window.NoteDiff.hunks(before || "", after || ""), [before, after]);

    // A click anywhere else puts a pinned popover away.
    React.useEffect(() => {
      if (pinned === null) return undefined;
      const close = () => setPinned(null);
      document.addEventListener("click", close);
      return () => document.removeEventListener("click", close);
    }, [pinned]);

    let cuts = 0;
    return (
      <div className="diff-view pd-view">
        {list.map((h, i) => {
          if (h.type === "same") return <span key={i}>{h.text}</span>;
          const n = h.type === "del" ? ++cuts : 0;
          return (
            <Hunk
              key={i}
              hunk={h}
              n={n}
              open={pinned === i || (pinned === null && hovered === i)}
              onHover={(on) => setHovered((cur) => (on ? i : cur === i ? null : cur))}
              onPin={() => setPinned((cur) => (cur === i ? null : i))}
              onAsk={(hunk) => { setPinned(null); setHovered(null); onAsk(hunk); }}
            />
          );
        })}
      </div>
    );
  }

  window.PendingDiff = PendingDiff;
})();
