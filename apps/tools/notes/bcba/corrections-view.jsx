/* The corrections pass, drawn over the section it changed.
 *
 * THE RULE THIS FILE EXISTS TO KEEP: the box holds exactly what Copy gives you.
 *
 * His complaint, 2026-09-20, against a screenshot of this view: the same
 * sentence appeared twice, struck in red and again in green, and "it is hard to
 * tell visually what will be in the text buffer". The model sends a whole
 * rewritten section, diff.js word-diffs it, and a rewritten sentence comes back
 * as a long del run followed by a long ins run. Drawing both is what made the
 * double.
 *
 * So no op whose words are absent from the note draws its words here. It draws
 * a watermark instead, and its words go to the rail UNDER the box, outside it,
 * where they can be inspected without being read by accident.
 *
 *   if the op contributes text to the note -> draw the text
 *   if it contributes nothing              -> draw a watermark, rail its words
 *
 * That table is the whole design, and it catches a fault the old view had: an
 * undone ins used to render its words with .cx-reverted while
 * NoteCorrections.contribution() returned "" for it, so the box showed text the
 * clipboard would not take. Same disease, one line further down.
 *
 * HIS THREE COLOURS, kept: green added, red deleted, blue moved. A watermark
 * means one thing only, that words used to sit here and no longer do, so green
 * never gets one. Blue gets one at a move's origin, because those words are
 * still in the note, somewhere else.
 *
 * THE WATERMARK HOLDS NO TEXT NODE. His words: "I used [] to represent a tall
 * narrow watermark without any characters to make sure that nothing looks (or
 * does) copy out." Measured, five ways: a <span>[]</span> copies out; adding
 * user-select:none blocks the mouse and still leaves the text node for
 * textContent, which is what Copy reads; a span with no text node whose numeral
 * comes from .cx-wm::after { content: attr(data-n) } is absent from both. So
 * the numeral is generated content and there is no stripping step anywhere,
 * because none of it is text.
 *
 * NOTHING HERE ASKS PERMISSION. Every mark is already applied to the note, so a
 * technician who reads it and copies it ships the corrected note. His ruling:
 * doing nothing ships all of it.
 *
 * NoteCorrections owns what the marks mean and what the section reads like.
 * This file owns how they are drawn and which one is open.
 *
 * Defines window.CorrectionsView; loaded before engine.jsx, which owns the state.
 */
/* QUIET MODE, and what it is for.
 *
 * His earlier ruling on the affordance: "not the thing with the inline check and
 * exes that I had requested. I hate it and it looks stupid and makes it hard to
 * read and use. but indicate the changes and have them default accepted."
 *
 * Under this design the split falls out cleanly, because the watermark and the
 * rail are READING and not controls. They say what happened; they ask nothing.
 * So they stay in quiet mode and only the things that act go to the drawer: the
 * popover on a changed phrase, the rail's own buttons, and the origin dot. */
/* A REWRITTEN SENTENCE, and why the rail needs this.
 *
 * NoteDiff works at sentence granularity, so rewording a clause inside a
 * sentence arrives as a whole-sentence `del` beside a whole-sentence `ins`.
 * Under the rule above the removal goes to the rail, which would then repeat
 * every word that survived into the green text two lines up. That is his
 * original complaint, moved rather than cured: the same words twice.
 *
 * So the surviving head and tail are dimmed and the words that actually went
 * are left at full strength. Nothing is hidden and nothing is trimmed: the line
 * still reads as the sentence the technician wrote, and Restore still puts that
 * whole sentence back, so the label cannot disagree with the button.
 *
 * Fails safe. Two sentences sharing nothing give null and the row draws whole. */
function splitSurviving(removed, kept) {
  if (!removed || !kept) return null;
  var a = String(removed).split(/(\s+)/);
  var b = String(kept).split(/(\s+)/);
  /* Compared with trailing punctuation off, because a clause lifted out of the
     middle of a sentence leaves the sentence ending one word earlier: the draft
     had "each demand because..." and the rewrite has "each demand." Matching on
     the bare word is what lets the rail say "because the client dislikes
     transitions" instead of starting a word too late. Punctuation-only
     differences cannot hide anything, because an empty middle returns null. */
  var same = function (x, y) {
    return String(x).toLowerCase().replace(/[.,;:!?]+$/, "") === String(y).toLowerCase().replace(/[.,;:!?]+$/, "");
  };
  var head = 0;
  while (head < a.length && head < b.length && same(a[head], b[head])) head++;
  var tail = 0;
  while (tail < a.length - head && tail < b.length - head &&
         same(a[a.length - 1 - tail], b[b.length - 1 - tail])) tail++;
  if (head === 0 && tail === 0) return null;
  var mid = a.slice(head, a.length - tail).join("");
  if (!mid.trim()) return null;
  return { head: a.slice(0, head).join(""), mid: mid, tail: a.slice(a.length - tail).join("") };
}

/* The addition this removal was most likely rewritten into: the one sharing the
   longest run of opening words. Scored rather than assumed, because a section
   can carry several of each and pairing the wrong two would dim the wrong half. */
function pairedAddition(removed, ops, state, id) {
  var best = null, bestScore = 0;
  ops.forEach(function (op, index) {
    if (op.type !== "ins") return;
    var mark = state[NoteCorrections.keyOf(id, index)] || {};
    if (mark.reverted) return;
    var text = typeof mark.text === "string" ? mark.text : op.text;
    var a = String(removed).split(/\s+/), b = String(text).split(/\s+/);
    var n = 0;
    while (n < a.length && n < b.length && a[n].toLowerCase() === b[n].toLowerCase()) n++;
    if (n > bestScore) { bestScore = n; best = text; }
  });
  return bestScore >= 2 ? best : null;
}

function CorrectionsView({ id, ops, marks, state, onToggle, onEdit, onGoToOrigin, headings, quiet, queue, onAsk, onDropAsk }) {
  const [openKey, setOpenKey] = React.useState(null);
  const [editKey, setEditKey] = React.useState(null);
  const [buffer, setBuffer] = React.useState("");
  const [litKey, setLitKey] = React.useState(null);
  const [askKey, setAskKey] = React.useState(null);
  const [askBuffer, setAskBuffer] = React.useState("");
  const asks = Object.keys(queue || {}).map(function (k) { return queue[k]; }).filter(function (a) { return a.id === id; });

  /* What an op puts in the note right now, given what the technician has done
     to it. This mirrors NoteCorrections.contribution deliberately: if the two
     ever disagree, the box stops equalling the clipboard and the whole reason
     for this file is gone. The tests pin them against each other. */
  const SHOWS_TEXT = {
    same:       () => "kept",
    ins:        (rv) => (rv ? "gone" : "added"),
    del:        (rv) => (rv ? "restored" : "gone"),
    "move-in":  (rv) => (rv ? "absent" : "moved"),
    "move-out": (rv) => (rv ? "restored" : "elsewhere"),
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

  /* One pass to decide every op's fate, so the box and the rail cannot drift
     apart and so the watermarks can be numbered in reading order. His ruling:
     one sequence shared by red and blue. */
  const plan = [];
  const rail = [];
  let counter = 0;

  ops.forEach((op, index) => {
    if (op.type === "same") { plan.push({ kind: "text", index, text: op.text }); return; }

    const key = NoteCorrections.keyOf(id, index);
    const mark = state[key] || {};
    const reverted = !!mark.reverted;
    const text = typeof mark.text === "string" ? mark.text : op.text;
    const fate = (SHOWS_TEXT[op.type] || (() => "kept"))(reverted);
    const why = (marks && marks.reasons && marks.reasons[key]) || "";

    if (fate === "added")     { plan.push({ kind: "chg", index, key, op, text, tone: "ins", why }); return; }
    if (fate === "moved")     { plan.push({ kind: "chg", index, key, op, text, tone: "move-in", why }); return; }
    if (fate === "restored")  { plan.push({ kind: "restored", index, key, text: op.text }); return; }
    if (fate === "absent")    { return; /* the move was undone; its words are back at the origin */ }

    /* Nothing of this op is in the note. A watermark stands where the words
       were. It gets a rail line unless the words are simply somewhere else in
       the same note, which is what a move's origin is. */
    counter += 1;
    const n = String(counter);
    const elsewhere = op.type === "move-out";
    plan.push({ kind: "gone", index, key, op, n, tone: elsewhere ? "move" : "cut", text, why });
    if (!elsewhere) {
      const shown = op.type === "ins" ? text : op.text;
      rail.push({
        key, n, text: shown, why, kind: op.type,
        // Only a removal can have been rewritten into something. An addition the
        // technician took out was never in their draft to survive.
        split: op.type === "del" ? splitSurviving(shown, pairedAddition(shown, ops, state, id)) : null,
      });
    }
  });

  const dim = (key) => (litKey && litKey !== key ? " is-dim" : "");
  const lit = (key) => (litKey === key ? " is-lit" : "");

  return (
    <React.Fragment>
      <div className="cx-view" data-corrections-section={id}>
        {plan.map((p) => {
          if (p.kind === "text") return <span key={p.index}>{p.text}</span>;

          if (p.kind === "restored") {
            /* His ruling: a rejection keeps a faint neutral underline, so that
               on a second pass you can still see you overruled something here.
               It is your wording, so it is not a colour and not a mark. */
            return (
              <span
                key={p.index}
                className="cx cx-restored"
                data-correction={p.key}
                data-correction-restored="true"
                title="Original wording; restored"
              >
                {p.text}
              </span>
            );
          }

          if (p.kind === "gone") {
            /* THE WATERMARK. No children, ever. Its numeral is generated
               content so that neither a drag-select nor textContent can carry
               it to the clipboard. If you are tempted to put a character in
               here, read the header of this file first. */
            const title = p.tone === "move"
              ? "Moved out of here" + (headings[p.op.to] ? ", into " + headings[p.op.to] : "")
              : "Removal " + p.n + ". Removed words listed under the note.";
            return (
              <span
                key={p.index}
                className={"cx-wm cx-wm-" + p.tone + lit(p.key) + dim(p.key)}
                data-n={p.n}
                data-correction-mark={p.key}
                data-correction-type={p.op.type}
                /* In quiet mode the mark decides nothing, so calling it a
                   button would promise an action that is not there. It is
                   still announced, because "a removal happened here" is worth
                   hearing whether or not you can act on it. */
                role={quiet ? "img" : "button"}
                tabIndex={quiet ? undefined : 0}
                aria-label={title}
                title={title}
                onMouseEnter={() => setLitKey(p.key)}
                onMouseLeave={() => setLitKey(null)}
                onFocus={() => setLitKey(p.key)}
                onBlur={() => setLitKey(null)}
                onClick={() => {
                  if (quiet) return;
                  if (p.tone === "move" && p.op.to) onGoToOrigin(p.op.to);
                }}
              />
            );
          }

          /* p.kind === "chg": words that ARE in the note. */
          if (editKey === p.key) {
            return (
              <span key={p.index} className="cx-ctl">
                <input
                  className="cx-edit"
                  data-correction-edit={p.key}
                  value={buffer}
                  autoFocus
                  onChange={(e) => setBuffer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitEdit(p.key); }
                    if (e.key === "Escape") { e.preventDefault(); setEditKey(null); }
                  }}
                />
                <button type="button" className="cx-ck" title="Save wording"
                        data-correction-save={p.key} onClick={() => commitEdit(p.key)}>✓</button>
                <button type="button" className="cx-ck" title="Cancel the edit"
                        data-correction-cancel={p.key} onClick={() => setEditKey(null)}>✕</button>
              </span>
            );
          }

          return (
            <React.Fragment key={p.index}>
              <span
                className={"cx cx-" + p.tone + (quiet ? "" : " is-touchable")}
                data-correction={p.key}
                data-correction-type={p.op.type}
                data-correction-reverted="false"
                role={quiet ? undefined : "button"}
                tabIndex={quiet ? undefined : 0}
                title={p.tone === "ins" ? "Added. Click for reason and options." : "Moved here. Click for reason."}
                onClick={() => { if (!quiet) setOpenKey(openKey === p.key ? null : p.key); }}
                onKeyDown={(e) => {
                  if (quiet) return;
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenKey(openKey === p.key ? null : p.key); }
                }}
              >
                {p.text}
              </span>
              {!quiet && p.op.type === "move-in" && p.op.from && (
                <button
                  type="button"
                  className="cx-dot"
                  data-correction-origin={p.op.from}
                  aria-label={"Go to origin" + (headings[p.op.from] ? ": " + headings[p.op.from] : "")}
                  title={headings[p.op.from] ? "Came from " + headings[p.op.from] : "Go to origin"}
                  onClick={(e) => { e.stopPropagation(); onGoToOrigin(p.op.from); }}
                />
              )}
              {!quiet && openKey === p.key && (
                <span className="cx-pop" data-correction-pop={p.key}>
                  {p.why ? <span className="cx-pop-why">{p.why}</span> : null}
                  <button type="button" className="cx-ck" data-correction-undo={p.key}
                          title="Remove from note"
                          onClick={() => { onToggle(p.key); setOpenKey(null); }}>Remove</button>
                  <button type="button" className="cx-ck" data-correction-pencil={p.key}
                          title="Edit wording"
                          onClick={() => startEdit(p.key, p.text)}>Reword</button>
                  {/* His fourth answer: keep the content, ask for different
                      wording. It queues rather than sending, because the send
                      is one move for the whole note and it lives in the panel. */}
                  <button type="button" className="cx-ck" data-correction-ask={p.key}
                          title="Request a change to content or wording. Sent with the other queued asks."
                          onClick={() => {
                            const had = (queue || {})[p.key];
                            setAskBuffer(had ? had.text : "");
                            setAskKey(p.key);
                            setOpenKey(null);
                          }}>Ask for a change</button>
                </span>
              )}
              {!quiet && askKey === p.key && (
                <span className="cx-ask" data-correction-ask-box={p.key}>
                  <input
                    className="cx-edit"
                    data-correction-ask-input={p.key}
                    value={askBuffer}
                    autoFocus
                    placeholder="Requested change"
                    onChange={(e) => setAskBuffer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); onAsk(p.key, askBuffer); setAskKey(null); }
                      if (e.key === "Escape") { e.preventDefault(); setAskKey(null); }
                    }}
                  />
                  <button type="button" className="cx-ck" data-correction-ask-save={p.key}
                          onClick={() => { onAsk(p.key, askBuffer); setAskKey(null); }}>Queue it</button>
                  <button type="button" className="cx-ck" data-correction-ask-cancel={p.key}
                          onClick={() => setAskKey(null)}>Cancel</button>
                </span>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* THE RAIL. Outside the box and under it, which is his ruling and also
          the only place it can go: anything inside the box would be text the
          clipboard does not carry. */}
      {rail.length > 0 && (
        <div className="cx-rail" data-corrections-rail={id}>
          {/* ONE WORD. It said "Removed from this section, and not part of the
              copy", which he called telegraphing: a header that argues its own
              case has stopped being a header. The rail sits under the box and
              its lines are struck from nothing, so where it is already says
              what it is. */}
          <p className="cx-rail-head">Deletions</p>
          {rail.map((r) => (
            <div
              key={r.key}
              className={"cx-cut" + lit(r.key)}
              data-corrections-cut={r.key}
              onMouseEnter={() => setLitKey(r.key)}
              onMouseLeave={() => setLitKey(null)}
            >
              <span className="cx-wm cx-wm-cut cx-wm-key" data-n={r.n} aria-hidden="true" />
              <span className="cx-cut-text">
                {r.split ? (
                  <React.Fragment>
                    <span className="cx-cut-kept">{r.split.head}</span>
                    {r.split.mid}
                    <span className="cx-cut-kept">{r.split.tail}</span>
                  </React.Fragment>
                ) : r.text.trim()}
                {r.why ? <span className="cx-cut-why">{r.why}</span> : null}
              </span>
              {!quiet && (
                <button
                  type="button"
                  className="cx-ck cx-cut-act"
                  data-correction-undo={r.key}
                  title={r.kind === "ins" ? "Restore to note" : "Restore to note"}
                  onClick={() => onToggle(r.key)}
                >
                  {r.kind === "ins" ? "Put it back" : "Restore"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* QUEUED ASKS, under the section they are about. His ruling puts them
          here and the Send in the Ask NoMe panel, so a note with three of them
          costs one turn rather than three. Nothing here sends. */}
      {asks.length > 0 && (
        <div className="cx-asks" data-corrections-asks={id}>
          <p className="cx-asks-head">Queued</p>
          {asks.map((a) => (
            <div key={a.key} className="cx-ask-row" data-corrections-ask-row={a.key}>
              <span className="cx-ask-text">
                <span className="cx-ask-about">On: {String(a.about || "").trim().slice(0, 60)}</span>
                {a.text}
              </span>
              {!quiet && (
                <button type="button" className="cx-ck" data-correction-ask-drop={a.key}
                        title="Remove from queue" onClick={() => onDropAsk(a.key)}>Drop</button>
              )}
            </div>
          ))}
          <p className="cx-asks-foot">Sent together from the Ask NoMe panel.</p>
        </div>
      )}

      {/* The section line survives as a fallback for any change the pass gave no
          reason of its own. See correctionsSchema: the model returns quotes, and
          a quote that matches nothing leaves its op unexplained. */}
      {marks.why ? <p className="cx-why">{marks.why}</p> : null}
    </React.Fragment>
  );
}

window.CorrectionsView = CorrectionsView;
