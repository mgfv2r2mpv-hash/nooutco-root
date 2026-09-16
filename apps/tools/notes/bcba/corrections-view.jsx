/* The corrections pass, drawn over the section it changed.
 *
 * NOTHING HERE ASKS PERMISSION. Every mark is already applied to the note, so a
 * technician who reads it and copies it ships the corrected note. His ruling:
 * doing nothing ships all of it. The controls appear once you click a tick, and
 * they undo rather than accept.
 *
 * Why a mode per mark rather than a row of buttons: a note has a dozen of these
 * and a dozen visible button pairs is a form, not a note. A ghosted tick beside
 * the change is enough to say "this was changed and you can touch it", and the
 * undo and the pencil arrive only for the one mark being considered.
 *
 * NoteCorrections owns what the marks mean and what the section reads like.
 * This file owns how they are drawn and which one is open.
 *
 * Defines window.CorrectionsView; loaded before engine.jsx, which owns the state.
 */
/* QUIET MODE, and what it is for.
 *
 * His ruling on the affordance below: "not the thing with the inline check and
 * exes that I had requested. I hate it and it looks stupid and makes it hard to
 * read and use. but indicate the changes and have them default accepted."
 *
 * The indication is the half he kept, so in quiet mode a changed phrase still
 * draws as a changed phrase and reads exactly as it did. What goes is every
 * control attached to it: the ghost tick, the undo, the pencil, and the origin
 * dot on a move. All four move into the changes drawer, where a technician goes
 * only if they want something different, and where the same four answers are
 * spelled as words.
 *
 * The origin dot goes too, though it is navigation rather than a disposition,
 * because the drawer row says "Moved into Antecedent, from Consequence" in
 * words and that line is itself the button. Saying it beats drawing it. */
function CorrectionsView({ id, ops, marks, state, onToggle, onEdit, onGoToOrigin, headings, quiet }) {
  const [openKey, setOpenKey] = React.useState(null);
  const [editKey, setEditKey] = React.useState(null);
  const [buffer, setBuffer] = React.useState("");

  const CLASS = {
    ins: "cx cx-ins",
    del: "cx cx-del",
    "move-in": "cx cx-move-in",
    "move-out": "cx cx-move-out",
  };

  const TITLE = {
    ins: "Added, from what you wrote",
    del: "Removed",
    "move-in": "Moved here",
    "move-out": "Moved out of here",
  };

  const startEdit = (key, text) => {
    setBuffer(text);
    setEditKey(key);
  };

  const commitEdit = (key) => {
    onEdit(key, buffer);
    setEditKey(null);
    setOpenKey(null);
  };

  return (
    <div className="cx-view" data-corrections-section={id}>
      {ops.map((op, index) => {
        if (op.type === "same") return <span key={index}>{op.text}</span>;

        const key = NoteCorrections.keyOf(id, index);
        const mark = state[key] || {};
        const reverted = !!mark.reverted;
        const text = typeof mark.text === "string" ? mark.text : op.text;
        const cls = (CLASS[op.type] || "cx") + (reverted ? " cx-reverted" : "");

        if (editKey === key) {
          return (
            <span key={index} className="cx-ctl">
              <input
                className="cx-edit"
                data-correction-edit={key}
                value={buffer}
                autoFocus
                onChange={(e) => setBuffer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitEdit(key); }
                  if (e.key === "Escape") { e.preventDefault(); setEditKey(null); }
                }}
              />
              <button type="button" className="cx-ck" title="Save this wording"
                      data-correction-save={key} onClick={() => commitEdit(key)}>✓</button>
              <button type="button" className="cx-ck" title="Cancel the edit"
                      data-correction-cancel={key} onClick={() => setEditKey(null)}>✕</button>
            </span>
          );
        }

        return (
          <React.Fragment key={index}>
            <span
              className={cls}
              data-correction={key}
              data-correction-type={op.type}
              data-correction-reverted={reverted ? "true" : "false"}
              title={reverted ? "Undone. The note keeps your draft here." : TITLE[op.type] || ""}
            >
              {text}
            </span>
            {/* The dot leads back to where the sentence came from, so a move can
                be read as one thing happening in two places rather than as a
                deletion here and an arrival there. It goes away when the move is
                undone, because then nothing moved. */}
            {!quiet && op.type === "move-in" && op.from && !reverted && (
              <button
                type="button"
                className="cx-dot"
                data-correction-origin={op.from}
                aria-label={"Show where this came from" + (headings[op.from] ? ": " + headings[op.from] : "")}
                title={headings[op.from] ? "Came from " + headings[op.from] : "Show where this came from"}
                onClick={() => onGoToOrigin(op.from)}
              />
            )}
            {!quiet && <span className="cx-ctl">
              {openKey === key ? (
                <React.Fragment>
                  <button
                    type="button"
                    className="cx-ck"
                    data-correction-undo={key}
                    title={reverted ? "Put this change back" : "Undo this change"}
                    onClick={() => { onToggle(key); setOpenKey(null); }}
                  >
                    {reverted ? "↷" : "↶"}
                  </button>
                  <button
                    type="button"
                    className="cx-ck"
                    data-correction-pencil={key}
                    title="Edit this wording"
                    onClick={() => startEdit(key, text)}
                  >
                    ✎
                  </button>
                </React.Fragment>
              ) : (
                <button
                  type="button"
                  className={"cx-ck" + (reverted ? "" : " is-ghost")}
                  data-correction-tick={key}
                  title={reverted ? "Undone. Click for options." : "Applied. Click for options."}
                  onClick={() => setOpenKey(key)}
                >
                  {reverted ? "↩" : "✓"}
                </button>
              )}
            </span>}
          </React.Fragment>
        );
      })}
      {marks.why ? <p className="cx-why">{marks.why}</p> : null}
    </div>
  );
}

window.CorrectionsView = CorrectionsView;
