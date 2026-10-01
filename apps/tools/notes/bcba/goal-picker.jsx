/* The goal picker: a strip of chips above the Goals Analyzed grid.
 *
 * Each chip is a checkbox, the goal name and an eye. The eye opens a small
 * popover with the line of the notes the name came from and why it scored.
 * Both come from the masked text, so nothing here ever holds a raw name.
 * Unchecked chips stay in the strip. The Update goals button shows only while
 * the picks differ from the grid, and is disabled while its turn runs.
 *
 * The rules (cap of six, eviction order, held text) live in goal-picks.js. This
 * file only draws them. Defines window.GoalPicker. Loaded before engine.jsx.
 */
function GoalPicker({ candidates, picked, canUpdate, busy, onToggle, onUpdate }) {
  const [open, setOpen] = React.useState(null);
  if (!candidates || !candidates.length) return null;
  return (
    <div className="gp-strip" data-testid="goal-picker">
      <div className="gp-chips">
        {candidates.map((c) => {
          const on = picked.indexOf(c.name) !== -1;
          return (
            <span key={c.name} className={"gp-chip" + (on ? " gp-on" : "")} data-goal-chip={c.shown || c.name}>
              <label className="gp-label">
                <input type="checkbox" checked={on} onChange={() => onToggle(c.name)} aria-label={c.shown || c.name} />
                <span className="gp-name">{c.shown || c.name}</span>
              </label>
              <button
                type="button"
                className="gp-eye"
                aria-label={"Where " + (c.shown || c.name) + " came from"}
                aria-expanded={open === c.name}
                title={"Where this came from"}
                onClick={() => setOpen(open === c.name ? null : c.name)}
              >
                {"\u{1F441}"}
              </button>
              {open === c.name && (
                <div className="gp-pop" role="dialog" data-goal-pop={c.shown || c.name}>
                  <div className="gp-src">{c.source}</div>
                  <div className="gp-why">{c.why}</div>
                </div>
              )}
            </span>
          );
        })}
      </div>
      {canUpdate && (
        <button type="button" className="gp-update" data-goal-update disabled={busy} onClick={onUpdate}>
          {busy ? "Updating goals" : "Update goals"}
        </button>
      )}
    </div>
  );
}

window.GoalPicker = GoalPicker;
