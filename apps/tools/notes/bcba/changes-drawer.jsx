/* What the tool changed, gathered out of the reading path.
 *
 * His ruling, the one that killed the affordance this replaces: "not the thing
 * with the inline check and exes that I had requested. I hate it and it looks
 * stupid and makes it hard to read and use. but indicate the changes and have
 * them default accepted (low weight for style) or staff can edit (strongest
 * signal), approve (stronger weight for style), or reject/revert (also a signal
 * for style in its manner)."
 *
 * That sentence splits cleanly in two, and this file is the second half.
 *
 *   INDICATE THE CHANGES  stays in the note. A changed phrase still draws as a
 *                         changed phrase, so a technician reading their note can
 *                         see what is not theirs.
 *   THE FOUR ANSWERS      come out of the note and live here, because a control
 *                         beside every changed phrase is a form wearing a note's
 *                         clothes, and on a phone it is a control in the way of
 *                         the sentence it is attached to.
 *
 * Nothing in this drawer is waiting for anybody. Every row is already in the
 * note and already counted as accepted, so a technician who never opens it
 * ships exactly the note they would have shipped anyway. It is a receipt.
 *
 * ORDER. The proposal said newest first, and this file does not do that, for an
 * honest reason: a corrections pass produces every mark at once, so no mark is
 * newer than any other and a timestamp here would be decoration. Note order is
 * the one ordering a reader can predict without being told, so the drawer reads
 * top to bottom the way the note does.
 *
 * Defines window.ChangesDrawer and window.ChangesDrawer.entriesFrom. Loaded
 * after disposition-row.jsx, whose row it draws, and before engine.jsx, which
 * owns the state.
 */

/* A move is one thing that happened, drawn in two places. corrections.js emits
   a mark at each end so the note can strike the sentence where it left and show
   it where it arrived, which is right for the note and wrong for a count: six
   changes including a move would report seven. The pair collapses here, onto
   the arriving end, because that is where the sentence now lives and that is
   the copy a technician would judge. */
var CD_MOVE = { "move-in": true, "move-out": true };

var CD_KIND_WORD = {
  added: "Added to",
  removed: "Removed from",
  moved: "Moved into",
  movedout: "Moved out of",
};

function CD_kindOf(type) {
  if (type === "ins") return "added";
  if (type === "del") return "removed";
  if (type === "move-in") return "moved";
  if (type === "move-out") return "movedout";
  return "";
}

/* One pass of marks, as rows. Pure, so the ordering and the collapsing can be
   tested without drawing anything. */
function CD_entriesFrom(corrections, markState, headings) {
  var marks = (corrections && corrections.marks) || [];
  var state = markState || {};
  var head = headings || {};

  // Which move ids arrived somewhere. A move-out whose partner is in the list
  // is the same event and drops; one without a partner is a real thing that
  // happened to this section and stays, named for what it is.
  var arrived = {};
  marks.forEach(function (m) {
    if (m.type === "move-in" && m.moveId) arrived[m.moveId] = true;
  });

  var out = [];
  marks.forEach(function (m) {
    if (m.type === "move-out" && m.moveId && arrived[m.moveId]) return;
    var kind = CD_kindOf(m.type);
    if (!kind) return;

    var st = state[m.key] || {};
    var text = typeof st.text === "string" ? st.text : m.text;
    var disposition = "default";
    if (st.reverted) disposition = "reverted";
    else if (typeof st.text === "string" && st.text !== m.text) disposition = "edited";
    else if (st.approved) disposition = "approved";

    out.push({
      key: m.key,
      id: m.id,
      heading: head[m.id] || m.id,
      kind: kind,
      text: text,
      original: m.text,
      state: disposition,
      from: m.from || "",
      fromHeading: m.from ? head[m.from] || m.from : "",
      why: m.why || "",
    });
  });
  return out;
}

/* The count the pill carries. Same collapsing as the list, because a pill that
   says six and a drawer that lists five is a bug a technician cannot explain. */
function CD_countOf(corrections, markState, headings) {
  return CD_entriesFrom(corrections, markState, headings).length;
}

function ChangesDrawerLine(props) {
  var e = props.entry;
  /* The line above the row names the section in full words. A technician
     reading the drawer is not looking at the note, so "Antecedent" has to be
     said rather than pointed at. */
  var where = CD_KIND_WORD[e.kind] + " " + e.heading;
  if (e.kind === "moved" && e.fromHeading) where += ", from " + e.fromHeading;

  return (
    <li className="cd-item" data-change={e.key} data-change-kind={e.kind} data-change-state={e.state}>
      <p className="cd-where">
        <button
          type="button"
          className="cd-where-btn"
          data-change-goto={e.id}
          onClick={function () { props.onGoTo(e.id); }}
          title="Show me this section"
        >
          {where}
        </button>
      </p>
      {e.why ? <p className="cd-why">{e.why}</p> : null}
      <window.AidSuggestion
        id={e.key}
        text={e.text}
        state={e.state}
        onApprove={function () { props.onApprove(e.key); }}
        onRevert={function () { props.onRevert(e.key); }}
        onEdit={function (text) { props.onEdit(e.key, text); }}
        queued={(props.queue || {})[e.key] ? (props.queue || {})[e.key].text : ""}
        onAsk={props.onAsk ? function (text) { props.onAsk(e.key, text); } : null}
      />
    </li>
  );
}

function ChangesDrawer(props) {
  var entries = props.entries || [];
  if (!entries.length) {
    return (
      <p className="cd-empty" data-changes-empty="true">
        Nothing has been changed yet. Once you generate a note, everything the
        tool added shows up here.
      </p>
    );
  }

  var kept = entries.filter(function (e) { return e.state !== "reverted"; }).length;

  return (
    <div className="cd-wrap" data-changes-drawer="true">
      <p className="cd-head">
        {kept === 1 ? "One change is in your note." : kept + " changes are in your note."}
        <span className="cd-head-sub"> Nothing here needs you. Open a line only if you want it different.</span>
      </p>
      <ul className="cd-list">
        {entries.map(function (e) {
          return (
            <ChangesDrawerLine
              key={e.key}
              entry={e}
              onApprove={props.onApprove}
              onRevert={props.onRevert}
              onEdit={props.onEdit}
              queue={props.queue}
              onAsk={props.onAsk}
              onGoTo={props.onGoTo}
            />
          );
        })}
      </ul>
    </div>
  );
}

window.ChangesDrawer = ChangesDrawer;
window.ChangesDrawer.entriesFrom = CD_entriesFrom;
window.ChangesDrawer.countOf = CD_countOf;
