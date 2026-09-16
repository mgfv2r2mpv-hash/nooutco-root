/* The question goes where the answer already is.
 *
 * WHAT THIS REPLACES, measured rather than argued. On an iPhone 14 profile,
 * with the gap questions open, the page is 2555px of intake boxes and the
 * assistant panel is 465px tall and fixed to the bottom of a 664px viewport. It
 * covers seventy percent of the screen. The question on it says "you wrote that
 * you moved to the floor, was that in the plan?" and the box holding the words
 * "moved to the floor" is behind the panel. The technician answers a question
 * about their own writing without being able to see their own writing, one
 * question at a time, into a single box shared by all of them.
 *
 * His instinct, in his words: "maybe it is time to come out of the Ask NoMe
 * chat panel and look at a more all-visible open floor plan design interface
 * that remains iPhone screen friendly."
 *
 * So each question is drawn under the intake box it is about, with its own
 * answer field. No mapping had to be invented for this and none was: a triage
 * question already names its field, and that field id is the id of a box on the
 * form. A question naming no box on this form is not placed and stays in the
 * panel, because losing a question is worse than any layout.
 *
 * ONE ACTION STILL FINISHES THE ROUND. There is no Send on a question here, and
 * that is deliberate rather than unfinished: every send is another round and
 * another call, so three questions with three Sends would be three rounds and
 * three waits. The answers collect in place and one button spends them.
 *
 * Defines window.QuestionInline. Loaded before engine.jsx.
 */

function QuestionInline(props) {
  var items = props.items || [];
  if (!items.length) return null;

  return (
    <div className="qi-wrap" data-question-inline={props.field}>
      {items.map(function (it) {
        var drafted = (props.drafts || {})[it.qi] || "";
        return (
          <div className="qi" key={it.qi} data-question={it.qi} data-question-field={props.field}>
            {/* Marked as the tool asking, because the box above it is the
                technician's own writing and the two must not read as one
                voice. */}
            <div className="qi-ask">
              <span className="qi-who">NoMe asks</span>
              <span className="qi-q">{it.question}</span>
            </div>

            {it.suggestions && it.suggestions.length > 0 && (
              <div className="qi-sugs">
                <window.DispositionHeading count={it.suggestions.length} />
                {it.suggestions.map(function (s) {
                  return (
                    <window.AidSuggestion
                      key={s.key}
                      id={s.key}
                      text={s.text}
                      state={s.state}
                      alternatives={it.suggestions.length > 1}
                      onApprove={function () { props.onApprove(s.key); }}
                      onRevert={function () { props.onRevert(s.key); }}
                      onEdit={function (t) { props.onEdit(s.key, t); }}
                    />
                  );
                })}
              </div>
            )}

            {/* Optional, and it says so. A technician whose whole answer is
                "yes, those two sentences are right" has already given it above
                and should not have to retype it here. */}
            <label className="qi-answer">
              <span className="qi-answer-label">Anything to add in your own words (optional)</span>
              <textarea
                className="qi-answer-box"
                rows={2}
                value={drafted}
                data-question-answer={it.qi}
                placeholder="No names or other PHI."
                onChange={function (e) { props.onDraft(it.qi, e.target.value); }}
              />
            </label>
          </div>
        );
      })}
    </div>
  );
}

/* Which questions belong to which box. Exported so the engine does not carry a
   filter and the tests can ask the question directly. A question with no field,
   or a field this form does not have, belongs to nobody and is left alone. */
function placeQuestions(questions, fieldIds) {
  var placed = {};
  var unplaced = [];
  (questions || []).forEach(function (q, qi) {
    var f = q && q.field;
    if (f && fieldIds.indexOf(f) !== -1) {
      if (!placed[f]) placed[f] = [];
      placed[f].push({ qi: qi, question: q.question, field: f });
    } else {
      unplaced.push({ qi: qi, question: q && q.question, field: f || null });
    }
  });
  return { placed: placed, unplaced: unplaced };
}

window.QuestionInline = QuestionInline;
window.QuestionInline.placeQuestions = placeQuestions;
