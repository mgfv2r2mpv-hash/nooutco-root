/* What the tool added, and the four ways a technician can answer it.
 *
 * REPLACES the tick-and-cross row. The maintainer's words on that one: "not the
 * thing with the inline check and exes that I had requested. I hate it and it
 * looks stupid and makes it hard to read and use. but indicate the changes and
 * have them default accepted (low weight for style) or staff can edit
 * (strongest signal), approve (stronger weight for style), or reject/revert
 * (also a signal for style in its manner)".
 *
 * Two things in that sentence are doing all the work here.
 *
 * FIRST, the change is already in. Nothing needs clicking to keep it, so the
 * resting row is the sentence and nothing else. A technician who does not care
 * reads prose, touches nothing, and loses nothing. The glyph that used to sit
 * beside every sentence is gone because in the overwhelmingly common case it
 * reported a state nobody had to act on.
 *
 * SECOND, the four answers are worth different amounts, and that is the whole
 * reason this row is also the best style signal the profile will ever get: the
 * tool authored the sentence, so it knows exactly what was on offer.
 *
 *   untouched  low        they may never have read it. Silence agrees in the
 *                         note and says little about taste.
 *   approve    stronger   they acted, on purpose, having read it.
 *   revert     its own    negative evidence, different in kind. It says what
 *                         they do not want, not what they do.
 *   edit       strongest  they wanted the content and not the wording, so the
 *                         difference between offered and kept is a clean paired
 *                         specimen with topic and content held constant.
 *
 * Every control carries a WORD. No tick, no cross, no arrow, no pencil. A
 * technician should never have to learn what a glyph means to use their own
 * documentation tool, and on the phone they actually use there is no hover to
 * explain one.
 *
 * Defines window.DispositionRow and window.AidSuggestion. Loaded before
 * revision-panel.jsx and engine.jsx, both of which draw these rows.
 */

/* The resting state says nothing, because the resting state is agreement and a
   row that announces agreement is a row in the way. Everything else says what
   happened, in one word, quietly, at the end of the line.

   NAMED DZ_WORD, not STATE_WORD, and the prefix is load bearing. Nothing here
   is a module: every .jsx on the page compiles into one global scope, so two
   files that both declare `var STATE_WORD` do not collide loudly, the second
   one just wins. This file and section-map.jsx both had one, the section map
   loads second, and every state word in this row rendered as nothing while the
   state attribute beside it read correctly. Keep new top-level names in this
   file prefixed, and see tests/global-collisions.spec.js. */
var DZ_WORD = {
  approved: "approved",
  edited: "edited",
  reverted: "removed",
  // An alternative that lost is not rejected, it simply is not the one they
  // picked, and calling that "removed" would misreport what they did.
  notchosen: "not chosen",
};

function DispositionRow(props) {
  var text = props.text;
  var state = props.state || "default";
  var word = state === "reverted" && props.alternatives ? DZ_WORD.notchosen : DZ_WORD[state];

  var open = props.open;
  var setOpen = props.onOpenChange || function () {};
  var editing = props.editing;
  var setEditing = props.onEditingChange || function () {};

  var bufRef = React.useRef(text);
  var [buffer, setBuffer] = React.useState(text);
  React.useEffect(function () { setBuffer(text); bufRef.current = text; }, [text]);

  /* THE FIFTH ANSWER, added 2026-09-21. Asking for something else is not one of
     the four: approve, edit and revert all settle the sentence here and now,
     and this one hands it back to NoMe with a reason. It was reachable only
     from the inline popover, which quiet mode suppresses along with everything
     else that decides, so with the flag on a technician could see queued asks
     and never make one. His ruling: make the queue reachable. */
  var [asking, setAsking] = React.useState(false);
  var [ask, setAsk] = React.useState("");
  var queued = props.queued || "";
  React.useEffect(function () { setAsk(queued); }, [queued]);

  if (asking) {
    return (
      <div className="dz-row is-editing">
        <textarea
          className="dz-edit"
          value={ask}
          autoFocus
          rows={2}
          placeholder="What should it say instead"
          aria-label="Say what you want NoMe to change"
          data-disposition-ask-edit={props.id}
          onChange={function (e) { setAsk(e.target.value); }}
          onKeyDown={function (e) {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); props.onAsk(ask); setAsking(false); setOpen(false); }
            if (e.key === "Escape") { setAsk(queued); setAsking(false); }
          }}
        />
        <div className="dz-actions">
          <button type="button" className="dz-act dz-act-keep" data-disposition-ask-save={props.id}
            onClick={function () { props.onAsk(ask); setAsking(false); setOpen(false); }}>Add to the queue</button>
          <button type="button" className="dz-act" data-disposition-ask-cancel={props.id}
            onClick={function () { setAsk(queued); setAsking(false); }}>Cancel</button>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="dz-row is-editing">
        <textarea
          className="dz-edit"
          value={buffer}
          autoFocus
          rows={2}
          aria-label="Reword what the tool added"
          data-disposition-edit={props.id}
          onChange={function (e) { setBuffer(e.target.value); }}
          onKeyDown={function (e) {
            if (e.key === "Escape") { setBuffer(text); setEditing(false); }
          }}
        />
        <div className="dz-actions">
          <button type="button" className="dz-act dz-act-keep" data-disposition-save={props.id}
            onClick={function () { props.onEdit(buffer); setEditing(false); setOpen(false); }}>Keep my wording</button>
          <button type="button" className="dz-act" data-disposition-cancel={props.id}
            onClick={function () { setBuffer(text); setEditing(false); }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className={"dz-row dz-state-" + state}>
      {/* The sentence is the control. Tapping anywhere on it opens the answers,
          which means the target is the whole line rather than a 24px glyph, and
          that is the difference between usable and not usable with a thumb. */}
      <button
        type="button"
        className="dz-line"
        data-disposition={props.id}
        data-disposition-state={state}
        aria-expanded={open ? "true" : "false"}
        onClick={function () { setOpen(!open); }}
      >
        <span className="dz-text">{text}</span>
        {word ? <span className="dz-mark">{word}</span> : null}
      </button>

      {open && (
        <div className="dz-actions" role="group" aria-label="What do you want to do with this">
          {/* Approve is first because it is the cheapest honest answer for a
              technician who read it and agreed. It changes nothing in the note
              and everything in what the profile learns. */}
          <button type="button" className="dz-act" data-disposition-approve={props.id}
            onClick={function () { props.onApprove(); setOpen(false); }}>
            {state === "approved" ? "Approved" : "Approve"}
          </button>
          <button type="button" className="dz-act" data-disposition-editbtn={props.id}
            onClick={function () { setEditing(true); }}>Edit</button>
          {props.onAsk && (
            <button type="button" className="dz-act" data-disposition-ask={props.id}
              onClick={function () { setAsking(true); }}>
              {queued ? "Change what you asked" : "Ask for a change"}
            </button>
          )}
          <button type="button" className="dz-act" data-disposition-revert={props.id}
            onClick={function () { props.onRevert(); setOpen(false); }}>
            {state === "reverted"
              ? (props.alternatives ? "Use this one" : "Put it back")
              : (props.alternatives ? "Use a different one" : "Remove it")}
          </button>
        </div>
      )}
    </div>
  );
}

/* The group heading. His ruling opens "make it clear for technicians what is
   added", and one line above the group does that for every row at once, which
   is cheaper to read than a label on each. */
function DispositionHeading(props) {
  var n = props.count;
  return (
    <div className="dz-head">
      {n === 1 ? "NoMe added this to your note." : "NoMe added these to your note."}
      <span className="dz-head-sub"> Already in. Tap one to approve, edit or remove it.</span>
    </div>
  );
}

/* Open and editing are per row and belong to nobody else, so they live here
   rather than in whichever surface is drawing the row. Two surfaces draw these
   now, the assistant panel and the questions placed on the page, and neither
   should have to carry a pair of flags it does not read. */
function AidSuggestion(props) {
  var [open, setOpen] = React.useState(false);
  var [editing, setEditing] = React.useState(false);
  return (
    <DispositionRow
      id={props.id}
      text={props.text}
      state={props.state}
      alternatives={props.alternatives}
      open={open}
      onOpenChange={setOpen}
      editing={editing}
      onEditingChange={setEditing}
      onApprove={props.onApprove}
      onRevert={props.onRevert}
      onEdit={props.onEdit}
      queued={props.queued}
      onAsk={props.onAsk}
    />
  );
}

window.DispositionRow = DispositionRow;
window.DispositionHeading = DispositionHeading;
window.DispositionRow.DZ_WORD = DZ_WORD;
window.AidSuggestion = AidSuggestion;
