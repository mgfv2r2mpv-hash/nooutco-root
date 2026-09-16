/* The section map.
 *
 * A technician working a note on a phone pastes it into the EHR one section at a
 * time, and the question they carry the whole way down the page is "what have I
 * not pasted yet". Nothing on the page answered it. The per-section Copy button
 * flashed a tick for 1800ms and then forgot, so the only record of what had gone
 * over lived in the technician's head while the page kept rewriting underneath
 * them.
 *
 * The harder half is the one that made a lock look attractive: a section that is
 * already in the EHR can legitimately change afterwards, because a behaviour
 * datum entered at 2pm belongs in the picture of how the client showed up. The
 * answer is not to stop the change. It is to say so, and keep saying so until
 * the technician has dealt with it.
 *
 * So each section carries one of three states, and the strip is the only place
 * any of them is reported:
 *
 *   not copied   it has never gone to the EHR
 *   copied       what is on screen is what was pasted
 *   changed      it moved after it was pasted, and the EHR is now behind
 *
 * That last state is why this replaces alerts rather than adding one. Without
 * the strip, "changed since you copied" has to be a banner on the section or a
 * toast, and a toast dies while the technician is looking somewhere else. One
 * always-visible strip carries six sections' worth of that state for free.
 *
 * Four rules keep it legible, and they are the design, not decoration:
 *   1. Every tile carries a word. No bare dot, badge or coloured square. Colour
 *      repeats the word and never replaces it, which is also what makes the
 *      strip work for a technician who does not see the orange.
 *   2. Three states and no fourth. A fourth costs a word nobody learns.
 *   3. The strip never reports a finding. Findings belong to the alert budget.
 *   4. Only the changed tile ever asks for anything.
 *
 * Defines window.SectionMap. Loaded before engine.jsx, which owns the state.
 */

/* What a copy records.
 *
 * A mark stores a HASH of the text that went to the clipboard, never the text.
 * The state machine only ever asks "is this still the same string", so the text
 * itself buys nothing and storing it would put a second copy of the note's prose
 * in local storage beside the draft. A 32-bit FNV-1a is enough: a collision
 * means one missed "changed" in about four billion, and the cost of that miss is
 * the state the tool has today for every section, all the time.
 */
function hashText(s) {
  var h = 0x811c9dc5;
  var str = String(s == null ? "" : s);
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/* Three states, derived rather than stored, so the strip cannot disagree with
   the note. A mark with no matching section, or a section with no mark, both
   read as not copied, which is the safe direction: the strip over-reports work
   still to do rather than telling a technician something is in the EHR when it
   is not. */
function stateFor(mark, currentText) {
  if (!mark) return "pending";
  return mark.h === hashText(currentText) ? "copied" : "changed";
}

var MAP_WORD = { pending: "not copied", copied: "copied", changed: "changed" };

/* The summary line. It exists because a technician should not have to read six
   tiles to learn there is nothing to do. Counts only, in words, and the changed
   clause is dropped entirely when the count is zero rather than rendered as a
   zero, because "0 changed" is a thing to read and nothing is not. */
function summaryLine(counts, total) {
  var parts = [total + (total === 1 ? " section" : " sections")];
  if (counts.copied) parts.push(counts.copied + " copied");
  if (counts.changed) {
    parts.push(counts.changed + (counts.changed === 1 ? " changed since you copied it" : " changed since you copied them"));
  }
  if (!counts.copied && !counts.changed) parts.push("nothing copied yet");
  return parts.join(" · ");
}

function SectionMap(props) {
  var sections = props.sections || [];
  var marks = props.marks || {};
  var textOf = props.textOf || function () { return ""; };

  var rows = sections.map(function (sec) {
    var st = stateFor(marks[sec.id], textOf(sec.id));
    return { id: sec.id, heading: sec.heading || sec.id, state: st };
  });

  var counts = { pending: 0, copied: 0, changed: 0 };
  rows.forEach(function (r) { counts[r.state]++; });

  if (!rows.length) return null;

  /* One live region, on the summary and not on the tiles. A screen reader user
     who copies a section hears "4 copied, 1 changed since you copied it" once,
     rather than a tile at a time as the strip re-renders. */
  return (
    <div className="section-map" role="group" aria-label="Section map">
      <div className="section-map-head" aria-live="polite">
        {summaryLine(counts, rows.length)}
      </div>

      <div className="section-map-strip">
        {rows.map(function (r) {
          var wants = r.state === "changed";
          return (
            <button
              key={r.id}
              type="button"
              className={"section-tile section-tile-" + r.state}
              /* The id and the state are on the tile so a test can assert the
                 state machine directly instead of reading it back out of a
                 class name, which is styling and free to change. */
              data-section-tile={r.id}
              data-state={r.state}
              onClick={function () {
                if (wants && props.onRecopy) return props.onRecopy(r.id);
                if (props.onJump) props.onJump(r.id);
              }}
              aria-label={
                r.heading + ", " + MAP_WORD[r.state] +
                (wants ? ". Open it and copy it again." : ". Go to this section.")
              }
            >
              <span className="section-tile-name">{r.heading}</span>
              <span className="section-tile-state">{MAP_WORD[r.state]}</span>
            </button>
          );
        })}
      </div>

      {/* The legend is permanent rather than a tooltip, because a word a
          technician has to hover to understand is the cryptic thing this design
          exists to avoid, and hovering does not exist on the phone they use. */}
      <div className="section-map-legend">
        <span><b>copied</b> it is in the EHR</span>
        <span><b>changed</b> it moved after you copied it</span>
        <span><b>not copied</b> still here only</span>
      </div>
    </div>
  );
}

window.SectionMap = SectionMap;
window.SectionMap.hashText = hashText;
window.SectionMap.stateFor = stateFor;
window.SectionMap.summaryLine = summaryLine;
