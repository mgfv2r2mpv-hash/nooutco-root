/* Shared engine for the unified BCBA notes page. Each tool (sup/sap/assess/parent)
 * registers a config on window.NOTE_TOOLS (see tools/*.js); this engine renders the
 * active one and provides everything shared: inputs, scrub wiring, the multi-turn
 * conversation with the LLM (prompt-cached server-side), per-section revision with
 * an accept/discard preview, improvement hints, copy affordances, drafts, and the
 * cache-expiry idle timer. */

const TOOLS = window.NOTE_TOOLS || [];
const DEFAULT_TOOL = TOOLS.length ? TOOLS[0].id : "sup";

// Note-freshness window: Anthropic's prompt cache lives ~5 minutes from the LAST
// call (each generation/revision refreshes it). A gentle floating countdown nudges
// prompt edits while the note is still "warm"; nothing blocks when it reaches zero.
const CACHE_WINDOW_S = 300;
const CACHE_LOW_S = 60;

function toolById(id) {
  for (const t of TOOLS) if (t.id === id) return t;
  return null;
}

function urlToolParam() {
  const p = new URLSearchParams(location.search).get("tool");
  return toolById(p) ? p : DEFAULT_TOOL;
}

// Diagnostic escape hatch: ?schema=off drops back to the model hand-writing its
// own JSON - not a new mode, but exactly what shipped before responseSchema. It
// exists so a constrained and an unconstrained draft can be produced in one
// deployment, on one login, minutes apart; without it, comparing them means
// capturing a baseline from another environment BEFORE deploying, which cannot
// be recovered once missed. Also the fastest way to answer "is the schema doing
// this?" if a draft ever looks wrong in production.
//
// Admin-only so a clinician never lands on it by accident. isAdmin() decodes the
// session token in the browser without verifying its signature, so this is a UI
// control and not a security boundary - and does not need to be one, since the
// only thing the flag can select is the behaviour production already had.
function schemaDisabled() {
  if (!window.NotesGate || !NotesGate.isAdmin()) return false;
  return new URLSearchParams(location.search).get("schema") === "off";
}
// Exposed deliberately rather than relying on this file being a classic script,
// so the tests keep working if it is ever loaded as a module.
window.schemaDisabled = schemaDisabled;

/* ── The expert, beside the draft ─────────────────────────────────────────
 *
 * WHAT IT IS. A second reading of the same intake, by a model carrying the ABA
 * glossary and the mentalism lexicon, running at the same moment as the draft
 * and answering a question the drafting model is never asked: what does this
 * note most need, and which of these sentences claims something the clinician
 * did not observe. /api/expert-pass has existed since 2026-08-24 and the admin
 * bench was its only caller.
 *
 * WHY IT RUNS BESIDE THE LOOP RATHER THAN INSIDE IT. The live hint channel has
 * eight fixed codes per tool, and between them they cannot say "you wrote 'he
 * wanted attention', and that is a function claim". Whether the expert actually
 * beats that catalog is an open question, and the only way to answer it is to
 * put the two channels on the SAME note and read them together. So nothing is
 * replaced: the catalog hints render exactly as they did, and the expert's
 * findings sit beside them, labelled.
 *
 * EVERYONE WHOSE LOGIN CARRIES THE TOOL, widened on 2026-08-26 at his
 * instruction. This ran for an admin alone until then, which was a scope
 * decision I made rather than one he asked for: the reasoning was that a
 * technician should not meet an unproven second channel on a note they are
 * about to sign, while the person calibrating it should. He read that and
 * overruled it in one word, and the call was always his.
 *
 * canUseTool(), not isLoggedIn(), because it mirrors the check the route
 * already makes. handleExpertPass takes any live login and then refuses a tool
 * the login's own list does not carry. A looser gate here would fire a call the
 * Worker is going to answer 403, and the clinician would watch the reading fail
 * for a reason that was knowable before it was sent.
 *
 * Like schemaDisabled() above, this decodes the session token in the browser
 * without verifying its signature, so it is a UI control and nothing more - the
 * Worker still checks the token and the tool scope on every call.
 *
 * ?expert=off turns it off for a clean side-by-side against the catalog alone,
 * the same escape hatch and the same reasoning as ?schema=off.
 */
function expertEnabled(toolId) {
  if (!window.NotesGate || !NotesGate.canUseTool || !NotesGate.canUseTool(toolId)) return false;
  return new URLSearchParams(location.search).get("expert") !== "off";
}
window.expertEnabled = expertEnabled;

/* The corrections pass runs for the same people the expert pass runs for, and
   the gate is the same check for the same reason: the route takes any live
   login and then refuses a tool the login's own list does not carry, so a
   looser gate here would spend a call the Worker is going to answer 403.

   ?corrections=off turns it off, and it is worth more here than the expert's
   escape hatch is. This pass edits the note, so "show me the draft the model
   actually wrote" has to stay one query parameter away. */
function correctionsEnabled(toolId) {
  if (!window.NoteCorrections || !window.CorrectionsView) return false;
  if (!window.NotesGate || !NotesGate.canUseTool || !NotesGate.canUseTool(toolId)) return false;
  return new URLSearchParams(location.search).get("corrections") !== "off";
}
window.correctionsEnabled = correctionsEnabled;

/* THE SECTION LIST COMES OUT OF THE RESPONSE SCHEMA. The obvious source is
   formSections, and the reason not to read it is worth stating accurately,
   because this comment stated it wrongly until 2026-08-30. It is NOT that the
   two lists disagree: measured across all five tools at 6f38ff0d, four matched
   exactly and sup matched as a set in a different order. It is that nothing
   MAKES them agree. formSections is a render order the layout owns - his
   2026-08-04 change moved Goals Analyzed to lead and SECTION_IDS was not moved
   with it - while the schema enum is the contract the response is serialized
   against. Agreement between them is maintained by hand, and a caller reading
   the render order would send ids off the wrong structure the first time
   somebody reordered a card.

   hintSchema builds the enum as SECTION_IDS.concat(["note"]) for every tool, so
   the schema is the one place they all agree. Returns null for a tool with no
   responseSchema, which is how a tool opts out: giving it a schema opts it in.
   All five carry one since 2026-08-30, so the opt-out is currently unused - and
   it is kept rather than removed because it is what makes adding a sixth tool a
   one-file change.

   Kept byte-identical in intent to expertSections() in admin/index.html. The
   two are separate files with no module system between them, so the pin is
   tests/expert-in-notes.spec.js rather than a shared import. */
function expertSectionIds(tool) {
  let enumList = null;
  try {
    enumList = tool.responseSchema.properties.hints.items.properties.section.enum;
  } catch (e) { return null; }
  if (!Array.isArray(enumList)) return null;
  const whole = window.NoteToolsUtil ? window.NoteToolsUtil.HINT_WHOLE_NOTE : "note";
  return enumList.filter((id) => id !== whole);
}
window.expertSectionIds = expertSectionIds;

// File an internal ticket for a defect. Takes the caught error, not its message,
// so it can both skip the non-defects and carry the diagnostics bag.
function reportError(toolId, err) {
  const tok = localStorage.getItem("notes_auth_token");
  if (!tok) return;
  // A user-facing error (expired session, timeout, connection drop) is normal
  // operation, not something to file. Only internal faults become tickets.
  if (err && err.userFacing) return;
  fetch(NotesGate.apiUrl("/api/error-report"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
    body: JSON.stringify({
      message: (err && err.message) || "unknown",
      diagnostics: (err && err.diagnostics) || null,
      tool: toolId,
      timestamp: new Date().toISOString(),
    }),
  }).catch(() => {});
}

/* ── Section data helpers ─────────────────────────────────────────────── */

// The output key a section reads/writes ("progress", "sessionChecks", …).
const sectionId = (s) => s.key || s.group;

// Sections whose value comes from the model. A "facts" section echoes the
// clinician's own quick-picks and is never in the response, so including it in
// the expected-shape check would fail every generation on a key the model was
// never asked for.
const isModelSection = (s) => s.kind !== "facts";

// Resolve one row of a "facts" section. Facts mix quick-pick answers the
// clinician gave (from `values`) with the one field the model does decide
// (servicePaused, from `output`), so it needs both sides.
function factRowValue(row, output, values) {
  const src = row.from === "values" ? values : output;
  const v = src ? src[row.id] : null;
  return v == null || v === "" ? "Not specified" : String(v);
}

// Body text for a section - used by per-section Copy (NO heading; the EHR field
// already has its own label) and as "current content" context in revision turns.
function sectionBody(section, output, values) {
  const v = output ? output[sectionId(section)] : null;
  if (section.kind === "narrative") return v || "";
  if (section.kind === "single") return v || "None selected";
  if (section.kind === "checklist") {
    const ticks = Array.isArray(v) ? v : [];
    return ticks.length ? ticks.join(", ") : "None selected";
  }
  if (section.kind === "table") {
    const rows = Array.isArray(v) ? v : [];
    if (!rows.length) return "None identified";
    return rows.map((r) => section.columns.map((c) => `${c.label}: ${r[c.id] || ""}`).join("\n")).join("\n\n");
  }
  if (section.kind === "facts") {
    return (section.rows || []).map((r) => `${r.label}: ${factRowValue(r, output, values)}`).join("\n");
  }
  return "";
}

// Copy All keeps headings as separators between EHR fields.
function sectionBlock(section, output, values) {
  return `${section.heading}\n${sectionBody(section, output, values)}`;
}

function valuesEqual(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

/* ── Presentational bits ──────────────────────────────────────────────── */

const card = { background: "white", borderRadius: 12, border: "1px solid #c0d4a8", padding: 24, marginBottom: 20 };
const lbl = { fontSize: 13, fontWeight: 600, color: "#374528", textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 8 };
const subLbl = { fontSize: 15, fontWeight: 700, color: "#2d3a1f", display: "block", marginBottom: 6 };
const hintStyle = { fontSize: 12.5, color: "#7a9460", marginBottom: 10, lineHeight: 1.55 };
const inputBase = { width: "100%", padding: "10px 14px", borderRadius: 8, border: "1.5px solid #c0d4a8", fontSize: 14, color: "#2d3a1f", background: "#fafcf8" };
const smallBtn = { padding: "4px 12px", borderRadius: 6, border: "1px solid #c0d4a8", background: "white", color: "#374528", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };

// Label-adjacent "i" help affordance. Shows on hover/focus (desktop) and on
// tap (mobile) via a click toggle; taps outside or Escape dismiss it. On open,
// the bubble is clamped horizontally to the viewport so it never runs off an
// edge regardless of where the icon sits in the label row.
function InfoTooltip({ text }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const iconRef = React.useRef(null);
  const bubbleRef = React.useRef(null);

  const position = React.useCallback(() => {
    const icon = iconRef.current, bubble = bubbleRef.current;
    if (!icon || !bubble) return;
    const GUTTER = 8;
    // Clamp to the visible viewport width (clientWidth), not innerWidth - the
    // latter includes any horizontal overflow and would let the bubble sit
    // past the right edge on mobile.
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const iconRect = icon.getBoundingClientRect();
    const bubbleW = bubble.offsetWidth;
    let vpLeft = iconRect.left; // default: anchor bubble's left to the icon
    if (vpLeft + bubbleW > vw - GUTTER) vpLeft = vw - GUTTER - bubbleW;
    if (vpLeft < GUTTER) vpLeft = GUTTER;
    bubble.style.left = (vpLeft - iconRect.left) + "px";
    bubble.style.setProperty("--arrow-left", (iconRect.left + iconRect.width / 2 - vpLeft) + "px");
  }, []);

  // Keep the bubble clamped to the viewport at all times - even while hidden -
  // so a right-side icon's (position:absolute) bubble never expands the page's
  // horizontal scroll area. Reposition on resize/orientation change and on open.
  React.useLayoutEffect(() => {
    position();
    const onResize = () => position();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [position]);

  React.useLayoutEffect(() => { if (open) position(); }, [open, position]);

  React.useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className={"info-tip" + (open ? " open" : "")}>
      <span
        ref={iconRef}
        className="info-icon"
        tabIndex="0"
        role="button"
        aria-label="More information"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }}
      >i</span>
      <span ref={bubbleRef} className="info-bubble" role="tooltip">{text}</span>
    </span>
  );
}

function Tip({ text }) {
  return (
    <div style={{ fontSize: 12, color: "#5a7040", background: "#eef4e6", border: "1px solid #c8dba8", borderRadius: 7, padding: "7px 11px", marginBottom: 10, lineHeight: 1.55 }}>{text}</div>
  );
}

// Scannable in-flow help for an input: bold term - plain description. Recognition
// rather than recall, which matters for the BT tool specifically: a newly
// credentialed technician can name a strategy they used far more reliably than
// they can produce it from memory into an empty box. Collapsed by default so it
// doesn't crowd the form for someone who already knows the buckets.
function HelpList({ intro, items }) {
  return (
    <div style={{ background: "#eef4e6", border: "1px solid #c8dba8", borderRadius: 8, padding: "11px 14px", margin: "2px 0 12px", fontSize: 12.5, color: "#41502c", lineHeight: 1.5 }}>
      {intro ? <p style={{ marginBottom: items && items.length ? 8 : 0 }}>{intro}</p> : null}
      {items && items.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", columnGap: 18, rowGap: 5 }}>
          {items.map((it, i) => (
            <li key={i}><strong style={{ color: "#2d3a1f" }}>{it.t}</strong>{it.d ? ` - ${it.d}` : ""}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A free-text input with its label, optional collapsible examples, hint and box.
// Module-scope so the examples' open/closed state survives the parent re-render
// that every keystroke causes - inlining this in App would slam it shut on the
// first character typed.
function TextareaField({ field: f, value, onChange }) {
  const [helpOpen, setHelpOpen] = React.useState(false);
  // Tie the label to the box. Without this the field has a visible label and no
  // accessible name, so a screen reader announces an unlabelled text area.
  const fieldId = "field-" + f.id;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <label htmlFor={fieldId} style={{ ...subLbl, marginBottom: 0 }}>
          {f.label}{f.required ? <span style={{ color: "#c0392b" }}> *</span> : null}
          {(f.tooltip || f.placeholder) ? <InfoTooltip text={f.tooltip || f.placeholder} /> : null}
        </label>
        {f.help ? (
          <button
            type="button"
            onClick={() => setHelpOpen((o) => !o)}
            aria-expanded={helpOpen}
            style={{
              flexShrink: 0, padding: "4px 12px", borderRadius: 20, cursor: "pointer",
              border: helpOpen ? "1.5px solid #374528" : "1.5px solid #c0d4a8",
              background: helpOpen ? "#374528" : "white",
              color: helpOpen ? "white" : "#5a7040",
              fontFamily: "inherit", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
            }}
          >
            {helpOpen ? "Hide examples ▴" : "Examples ▾"}
          </button>
        ) : null}
      </div>
      {helpOpen && f.help ? <HelpList intro={f.help.intro} items={f.help.items} /> : null}
      {f.tip ? <Tip text={f.tip} /> : null}
      {f.hint ? <p style={hintStyle}>{f.hint}</p> : null}
      <textarea
        id={fieldId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={f.placeholder}
        style={{ ...inputBase, height: f.height || 160, resize: "vertical", lineHeight: 1.6 }}
      />
      {f.charCount ? <p style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}>{(value || "").length} characters</p> : null}
    </div>
  );
}

/* ── House rules ──────────────────────────────────────────────────────────
   Documentation standards that hold for every clinician regardless of personal
   style. They are shown, not hidden, because the point is that staff can see
   what the tool is holding them to - and because most of them are things the
   author is responsible for whether or not a tool is involved.

   Rules 2-5 are also written into each tool's system prompt; rule 1 is about
   what the technician types in, which no prompt can enforce. */
const ADMIN_STYLE_RULES = [
  { rule: "Removes PHI and PII from non-secure communications.", authorOnly: true },
  { rule: "Avoids interpretation and causal attribution, and prefers objective, observable statements." },
  { rule: "Limits unnecessary ABA jargon." },
  { rule: "Explains all acronyms on first use - e.g. Augmentative and Alternative Communication (AAC), Functional Communication Training (FCT)." },
  { rule: "Attributes reinforcement to a behavior and not an individual - e.g. “Functional requests were reinforced during session.”" },
];

function HouseRules() {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ marginBottom: 20, borderRadius: 10, border: "1px solid #c0d4a8", background: "#f7fbf3", overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, padding: "11px 16px", border: "none", background: "transparent", cursor: "pointer",
          fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, color: "#374528", textAlign: "left",
        }}
      >
        <span>Documentation standards this tool writes to</span>
        <span aria-hidden="true" style={{ color: "#7a9460", fontSize: 12 }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <ul style={{ margin: 0, padding: "0 16px 14px 34px", display: "grid", gap: 6 }}>
          {ADMIN_STYLE_RULES.map((r, i) => (
            <li key={i} style={{ fontSize: 12.8, color: "#41502c", lineHeight: 1.55 }}>
              {r.rule}
              {r.authorOnly ? <span style={{ color: "#7a9460" }}> (yours to enforce - the tool scrubs what it can, but it only sees what you type)</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* The learned style card lives on the profile page, not here.
 *
 * This is a clinical surface: a technician is on it to file a note, and a panel
 * inviting them to inspect and tune how the tool writes is a distraction from
 * that. The learning still happens here -- every revision and manual edit is
 * measured -- and the card is still fetched, because the block it produces goes
 * into the prompt. Only the viewing and tuning UI moves.
 *
 * That UI belongs on a separate, password-gated profile page, built next phase.
 * The component written for it is in git at c3fc75be if it is useful there;
 * NotesGate.styleCard.mute() is already wired and tested for it. */

// Read-only rows echoing quick-pick answers the model must not infer, so the BT
// can tick the matching EHR boxes without scrolling back up to the form.
function FactRows({ rows, output, values }) {
  return (
    <div style={{ fontSize: 13.5, color: "#2d3a1f", lineHeight: 1.8 }}>
      {(rows || []).map((r) => (
        <div key={r.id}>{r.label}: <strong>{factRowValue(r, output, values)}</strong></div>
      ))}
    </div>
  );
}

// Floating note-freshness countdown. Fixed top-right, out of the way; shows the
// warm-window remaining (mm:ss) after a note is generated and resets on each turn.
// Hover (desktop) or tap (mobile) reveals why prompt edits are best made in time.
// "Nothing happens" at zero - it just rests muted; revisions still work.
function CacheTimer({ remaining }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const expired = remaining <= 0;
  const low = !expired && remaining <= CACHE_LOW_S;
  const state = expired ? "expired" : (low ? "low" : "ok");
  const mmss = Math.floor(remaining / 60) + ":" + String(remaining % 60).padStart(2, "0");

  return (
    <div ref={ref} className={"cache-timer state-" + state + (open ? " open" : "")}>
      <button
        type="button"
        className="cache-timer-pill"
        aria-label={"Note-freshness timer: " + (expired ? "window elapsed" : mmss + " remaining") + ". Activate for details."}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <span className="cache-timer-dot" aria-hidden="true" />
        <span className="cache-timer-time">{expired ? "0:00" : mmss}</span>
      </button>
      <span className="cache-timer-bubble" role="tooltip">
        {expired
          ? "The quick-edit window has passed. Revisions still work - the next one just takes a moment longer while the tool re-reads the note. Edits made soon after generating are the fastest."
          : "Edits are most useful when made promptly. For about 5 minutes after each generation the tool keeps your note “warm,” so revisions apply fastest - each revision resets the timer."}
      </span>
    </div>
  );
}

// Read-only checklist mirroring a real-form checkbox group: full option list with
// AI-suggested options ticked (and bolded). single=true renders radio-style.
/* A suggested set of EHR ticks.
 *
 * `single` sections show ONLY the suggested answer, not the alternatives. The
 * tool is guessing one value from free text, and listing the two it rejected at
 * equal weight invites the technician to read them as a menu the tool is
 * offering rather than as a hypothesis it formed. The line underneath says
 * plainly that it is a guess and theirs to overrule. Multi-select sections still
 * show the whole list, because there "not ticked" is itself information they
 * need to check against the session. */
function Checklist({ options, selected, single = false, sectionId: sid }) {
  const sel = single ? (selected ? [selected] : []) : (Array.isArray(selected) ? selected : []);

  if (single) {
    const answer = sel[0];
    if (!answer) {
      return <p style={{ fontSize: 13, color: "#9aab86", fontStyle: "italic", margin: 0 }}>Nothing suggested - choose from your EHR form.</p>;
    }
    // The wrapper and the note carry class names so a compact section can lay
    // the answer and its caveat on one line instead of stacking them.
    return (
      <div className="compact-body">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
          <span aria-hidden="true" style={{
            flexShrink: 0, marginTop: 2, width: 16, height: 16, borderRadius: "50%",
            border: "1.5px solid #374528", background: "#374528", color: "white",
            fontSize: 11, fontWeight: 700, lineHeight: "14px", textAlign: "center",
          }}>✓</span>
          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: "#2d3a1f", fontWeight: 600 }}>{answer}</span>
        </div>
        <p className="section-note" style={{ fontSize: 11.5, color: "#8a9678", margin: "7px 0 0", lineHeight: 1.5 }}>
          Suggested from what you wrote. Use your clinical judgment and pick a different one on your form if it does not match the session.
        </p>
      </div>
    );
  }

  return (
    <div data-section-id={sid} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", columnGap: 14, rowGap: 4 }}>
      {options.map((label) => {
        const on = sel.includes(label);
        return (
          <div key={label} data-option={sid ? label : undefined} data-on={sid ? (on ? "1" : "0") : undefined}
            style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
            <span aria-hidden="true" style={{
              flexShrink: 0, marginTop: 1, width: 15, height: 15, borderRadius: 4,
              border: on ? "1.5px solid #374528" : "1.5px solid #c0d4a8",
              background: on ? "#374528" : "white", color: "white",
              fontSize: 11, fontWeight: 700, lineHeight: "13px", textAlign: "center",
            }}>{on ? "✓" : ""}</span>
            <span style={{ fontSize: 12.5, lineHeight: 1.4, color: on ? "#2d3a1f" : "#9aab86", fontWeight: on ? 600 : 400 }}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// Editable Goal/Progress/Next-Steps rows matching the EHR's 3-column grid.
// Each cell has its own copy affordance because the EHR has separate boxes.
function GoalsTable({ columns, rows, onChange, onCopyCell, copiedId, idPrefix }) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    return <p style={{ fontSize: 13, color: "#9aab86", fontStyle: "italic" }}>No goals identified in the notes.</p>;
  }
  const setCell = (ri, cid, val) => {
    const next = list.map((r, i) => (i === ri ? { ...r, [cid]: val } : r));
    onChange(next);
  };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {list.map((row, ri) => (
        <div key={ri} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, padding: 10, borderRadius: 8, border: "1px solid #ddecd0", background: "white" }}>
          {columns.map((c) => {
            const cellId = `${idPrefix}-r${ri}-${c.id}`;
            return (
              <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#7a9460", textTransform: "uppercase", letterSpacing: "0.03em" }}>{c.label}</span>
                  {onCopyCell && (
                    <button onClick={() => onCopyCell(cellId, row[c.id] || "")} style={{ ...smallBtn, padding: "1px 8px", fontSize: 11 }}>
                      {copiedId === cellId ? "✓" : "Copy"}
                    </button>
                  )}
                </div>
                <textarea
                  value={row[c.id] || ""}
                  onChange={(e) => setCell(ri, c.id, e.target.value)}
                  style={{ width: "100%", minHeight: 66, padding: 8, borderRadius: 6, border: "1px solid #c0d4a8", fontSize: 13, color: "#2d3a1f", lineHeight: 1.5, resize: "vertical", background: "#fafcf8" }}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// One-line improvement note under a section - canonical wording from the tool's
// client-side catalog; the model only picked the code (plus a short specifier).
//
// THE CAP IS THREE, AND IT DESTROYS NOTHING. A section with nine findings used
// to render nine identical yellow boxes, which reaches a technician at the end
// of a shift the same way rendering none does: nobody reads to the bottom of
// that. The top three by the model's own rank are shown and the rest sit behind
// a disclosure, so the list is short enough to act on and nothing is lost.
//
// normalizeHints has already sorted the array by rank, so array order IS rank
// order here and this deliberately does not re-sort. One place decides the
// ordering.
const HINT_CAP = 3;

// kind decides how loudly a hint is drawn. blocks-claim is the only one that
// changes colour, because a funder rejecting the claim is a different kind of
// problem from the note reading thin, and a technician skimming should be able
// to tell those apart without reading either.
const HINT_TONE = {
  "blocks-claim": { fg: "#9b1c1c", bg: "#fdf0ef", edge: "#eec4c0", mark: "⚠" },
  thin: { fg: "#8a6d1a", bg: "#fdf6e0", edge: "#ecd9a0", mark: "💡" },
  register: { fg: "#4b5563", bg: "#f3f4f6", edge: "#e5e7eb", mark: "✎" },
};

function hintText(hint, catalog) {
  if (hint.code === "other") return hint.detail || "";
  const base = catalog[hint.code] || "";
  return base + (hint.detail ? ` - ${hint.detail}` : "");
}

function HintRow({ hint, catalog }) {
  const text = hintText(hint, catalog);
  if (!text) return null;
  const tone = HINT_TONE[hint.kind] || HINT_TONE.thin;
  return (
    <p
      data-hint-kind={hint.kind || "thin"}
      data-hint-rank={hint.rank === null || hint.rank === undefined ? undefined : String(hint.rank)}
      style={{ fontSize: 12.5, color: tone.fg, background: tone.bg, border: `1px solid ${tone.edge}`, borderRadius: 7, padding: "6px 10px", marginBottom: 4, lineHeight: 1.5 }}
    >
      {tone.mark} {text}
    </p>
  );
}

// Shared by the per-section notes and the whole-note block, so the cap and the
// disclosure behave identically in both rather than being written twice.
function HintList({ hints, catalog, testid }) {
  const [open, setOpen] = React.useState(false);
  // A hint whose catalog entry is empty renders nothing, so it must not count
  // against the cap or the disclosure would offer to reveal blank rows.
  const shown = (hints || []).filter((h) => hintText(h, catalog));
  if (!shown.length) return null;
  const top = shown.slice(0, HINT_CAP);
  const rest = shown.slice(HINT_CAP);
  return (
    <div style={{ marginTop: 8 }} data-testid={testid}>
      {top.map((h, i) => <HintRow key={`t${i}`} hint={h} catalog={catalog} />)}
      {open && rest.map((h, i) => <HintRow key={`r${i}`} hint={h} catalog={catalog} />)}
      {rest.length > 0 && (
        <button
          type="button"
          data-testid="hint-disclosure"
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          style={{ fontSize: 11.5, color: "#5d6a4d", background: "none", border: "none", padding: "2px 2px 0", cursor: "pointer", textDecoration: "underline" }}
        >
          {open ? "Show fewer" : `${rest.length} more ${rest.length === 1 ? "note" : "notes"}`}
        </button>
      )}
    </div>
  );
}

function HintNotes({ hints, section, catalog }) {
  const id = sectionId(section);
  return <HintList hints={(hints || []).filter((h) => h.section === id)} catalog={catalog} testid={`hints-${id}`} />;
}

// Findings about the note as a whole. These have nowhere to live under a
// section heading, and filing them under the nearest one puts them somewhere
// they are not about, so they sit above the grid where the note starts.
function NoteHints({ hints, catalog }) {
  const whole = window.NoteToolsUtil ? window.NoteToolsUtil.HINT_WHOLE_NOTE : "note";
  const mine = (hints || []).filter((h) => h.section === whole);
  if (!mine.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, letterSpacing: ".07em", textTransform: "uppercase", color: "#7a9460", fontWeight: 700, marginBottom: 2 }}>
        About the whole note
      </div>
      <HintList hints={mine} catalog={catalog} testid="hints-note" />
    </div>
  );
}


/* ── Drawing what the expert found ────────────────────────────────────────
 *
 * The expert's hints carry the same three `kind` values the catalog's do, so
 * they reuse HINT_TONE rather than inventing a second colour language for the
 * same three ideas. What they do NOT share is where the words come from: a
 * catalog hint is a code looked up in a fixed list of eight, and an expert hint
 * is a sentence the model wrote about this note. So the row is drawn
 * differently on purpose - a left rule and a label - because a technician
 * reading two channels in one column has to be able to tell which one is
 * talking without reading either.
 */
const EXPERT_LABEL = "expert";

function ExpertRow({ finding, testid }) {
  const tone = HINT_TONE[finding.kind] || HINT_TONE.thin;
  const ask = String(finding.ask || "").trim();
  if (!ask) return null;
  return (
    <div
      data-testid={testid}
      data-expert-kind={finding.kind || "thin"}
      data-expert-rank={finding.rank === null || finding.rank === undefined ? undefined : String(finding.rank)}
      style={{ fontSize: 12.5, color: tone.fg, background: tone.bg, border: `1px solid ${tone.edge}`, borderLeft: `3px solid ${tone.fg}`, borderRadius: 7, padding: "6px 10px", marginBottom: 4, lineHeight: 1.5 }}
    >
      <span style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 700, opacity: 0.72, marginRight: 6 }}>
        {EXPERT_LABEL}
      </span>
      {tone.mark} {ask}
      {finding.why ? <div style={{ opacity: 0.82, marginTop: 3 }}>{finding.why}</div> : null}
    </div>
  );
}

/* The same cap and the same disclosure the catalog channel uses, for the same
   reason: nobody reads to the bottom of nine identical boxes at the end of a
   shift. Ranked by the model's own rank, and the Worker has already sorted the
   array, so array order IS rank order and this deliberately does not re-sort. */
function ExpertList({ findings, testid }) {
  const [open, setOpen] = React.useState(false);
  const shown = (findings || []).filter((f) => String(f.ask || "").trim());
  if (!shown.length) return null;
  const top = shown.slice(0, HINT_CAP);
  const rest = shown.slice(HINT_CAP);
  return (
    <div style={{ marginTop: 8 }} data-testid={testid}>
      {top.map((f, i) => <ExpertRow key={`t${i}`} finding={f} />)}
      {open && rest.map((f, i) => <ExpertRow key={`r${i}`} finding={f} />)}
      {rest.length > 0 && (
        <button
          type="button"
          data-testid={`${testid}-disclosure`}
          onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          style={{ fontSize: 11.5, color: "#5d6a4d", background: "none", border: "none", padding: "2px 2px 0", cursor: "pointer", textDecoration: "underline" }}
        >
          {open ? "Show fewer" : `${rest.length} more from the expert`}
        </button>
      )}
    </div>
  );
}

function ExpertNotes({ expert, section }) {
  if (!expert || expert.status !== "done") return null;
  const id = sectionId(section);
  return <ExpertList findings={(expert.hints || []).filter((f) => f.section === id)} testid={`expert-${id}`} />;
}

/* THE REGISTER FINDINGS ARE THE POINT, and they are the thing the catalog has
   no code for. Each one quotes the clinician's own sentence back and says what
   it claims that nobody watched happen, then offers the replacement. That is
   why the quote is drawn rather than summarised: "you wrote X" is checkable
   where "watch your mentalism" is advice.

   `keep` findings are drawn too. A sentence the expert looked at and passed is
   information - it means the reading covered it - and hiding them would make a
   thorough pass look like a thin one. */
const REGISTER_ACTION_LABEL = {
  reframe: "rewrite this",
  ask: "ask about this",
  remove: "cut this",
  keep: "fine as written",
};

function RegisterFinding({ finding }) {
  const quote = String(finding.quote || "").trim();
  if (!quote) return null;
  const action = finding.action || "ask";
  const muted = action === "keep";
  return (
    <div
      data-testid="expert-register-row"
      data-register-action={action}
      style={{ fontSize: 12.5, border: "1px solid #e5e7eb", borderRadius: 7, padding: "7px 10px", marginBottom: 5, lineHeight: 1.5, background: muted ? "#f9fafb" : "#f3f4f6", color: "#374151", opacity: muted ? 0.78 : 1 }}
    >
      <span style={{ fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 700, opacity: 0.7, marginRight: 6 }}>
        {REGISTER_ACTION_LABEL[action] || action}
      </span>
      <span style={{ fontStyle: "italic" }}>“{quote}”</span>
      {finding.why ? <div style={{ marginTop: 3, opacity: 0.85 }}>{finding.why}</div> : null}
      {finding.move ? <div style={{ marginTop: 3, color: "#374528", fontWeight: 600 }}>{finding.move}</div> : null}
    </div>
  );
}

/* Abbreviations, and what the expert took each one to mean. A resolved reading
   is a reading aid; an ambiguous or unknown one is a warning, because the whole
   draft downstream was written on that guess. */
const TERM_STATUS_LABEL = { resolved: "read as", ambiguous: "ambiguous", unknown: "not recognised" };

function TermFinding({ finding }) {
  const token = String(finding.token || "").trim();
  if (!token) return null;
  const status = finding.status || "unknown";
  const warn = status !== "resolved";
  return (
    <span
      data-testid="expert-term"
      data-term-status={status}
      title={finding.why || ""}
      style={{ display: "inline-block", fontSize: 12, borderRadius: 6, padding: "3px 8px", marginRight: 6, marginBottom: 5, border: `1px solid ${warn ? "#ecd9a0" : "#ddecd0"}`, background: warn ? "#fdf6e0" : "#f7fbf3", color: warn ? "#8a6d1a" : "#3f5130" }}
    >
      <strong>{token}</strong>
      {finding.reading ? ` ${TERM_STATUS_LABEL[status] || status} ${finding.reading}` : ` - ${TERM_STATUS_LABEL[status] || status}`}
    </span>
  );
}

/* Everything the expert found that is not about one section: the abbreviations
   it resolved, the sentences it read as claims, and its whole-note asks. It
   sits above the grid for the same reason NoteHints does - filing a whole-note
   finding under the nearest heading puts it somewhere it is not about.

   IT ALSO DRAWS ITS OWN FAILURES, which is the difference between a second
   opinion and a decoration. A pass that was asked for and did not arrive says
   so, because an empty panel and a broken call look identical from the outside
   and only one of them means "nothing to report". */
function ExpertReading({ expert }) {
  if (!expert) return null;

  const head = (
    <div style={{ fontSize: 11, letterSpacing: ".07em", textTransform: "uppercase", color: "#7a9460", fontWeight: 700, marginBottom: 4 }}>
      What the expert read in your intake
    </div>
  );

  if (expert.status === "running") {
    return (
      <div style={{ marginBottom: 16 }} data-testid="expert-reading">
        {head}
        <p style={{ fontSize: 12.5, color: "#7a9460", lineHeight: 1.5 }} data-testid="expert-running">
          Still reading. Your note is finished and this arrives beside it.
        </p>
      </div>
    );
  }

  if (expert.status === "failed") {
    return (
      <div style={{ marginBottom: 16 }} data-testid="expert-reading">
        {head}
        <p style={{ fontSize: 12.5, color: "#8a6d1a", lineHeight: 1.5 }} data-testid="expert-failed">
          The expert pass did not come back, so nothing here was reviewed a second time. Your note is unaffected.
        </p>
      </div>
    );
  }

  const whole = window.NoteToolsUtil ? window.NoteToolsUtil.HINT_WHOLE_NOTE : "note";
  const wholeHints = (expert.hints || []).filter((f) => f.section === whole);
  const register = expert.register || [];
  const terms = expert.terms || [];

  return (
    <div style={{ marginBottom: 16 }} data-testid="expert-reading">
      {head}
      {terms.length > 0 && (
        <div style={{ marginBottom: 8 }} data-testid="expert-terms">
          {terms.map((t, i) => <TermFinding key={i} finding={t} />)}
        </div>
      )}
      {register.length > 0 ? (
        <div style={{ marginBottom: 8 }} data-testid="expert-register">
          {register.map((r, i) => <RegisterFinding key={i} finding={r} />)}
        </div>
      ) : (
        /* Finding nothing is a result, and the panel has to agree or a clean
           note reads as a broken call. */
        <p style={{ fontSize: 12.5, color: "#7a9460", marginBottom: 8 }} data-testid="expert-register-empty">
          Nothing in your intake claims something you did not observe.
        </p>
      )}
      <ExpertList findings={wholeHints} testid="expert-note" />
      {expert.hintsDropped ? (
        <p style={{ fontSize: 11.5, color: "#7a9460", marginTop: 6 }} data-testid="expert-dropped">
          {expert.hintsDropped} lower-ranked finding{expert.hintsDropped === 1 ? " was" : "s were"} past the ceiling and are not shown.
        </p>
      ) : null}
    </div>
  );
}

/* ── App ──────────────────────────────────────────────────────────────── */

function freshSession(tool) {
  const saved = (window.NotesGate && NotesGate.draft.load(tool.id)) || {};
  const migrated = tool.migrateDraft ? tool.migrateDraft(saved) : saved;
  const values = {};
  tool.inputs.forEach((f) => {
    // defaultValue lets a toggle start on the common answer rather than unset -
    // BT's place-of-service is "Home" for most sessions, and making every
    // technician pick it every time is friction for no information gain.
    const fallback = f.defaultValue !== undefined ? f.defaultValue : null;
    if (f.type === "toggle") values[f.id] = migrated[f.id] !== undefined && migrated[f.id] !== null ? migrated[f.id] : fallback;
    else values[f.id] = migrated[f.id] || "";
  });
  return {
    values,
    output: null,
    conversation: [],     // [{role, content}] - replayed each turn; prefix is server-cached
    promptText: "",
    scrubMap: [],         // [{name, token, identifier?}] - what the last scrub took
    certified: [],        // names the clinician has since marked "not a name"
    error: "",
    lastCallAt: 0,
    proposal: null,        // pending revision, rendered as an inline diff
    expanded: [],
    /* The expert's second reading of the same intake, or null when it was never
       asked. {status:"running"} while the call is out, {status:"failed"} when
       it did not come back, and the findings themselves once it did. Held per
       session beside `output` and cleared with it, because a reading of the
       previous intake sitting next to a new note is worse than no reading. */
    expert: null,

    /* The corrections pass, and what the technician has done about it.
       `corrections` is what the pass changed, aligned against the draft it
       changed - null before it has run and after the marks are dismissed.
       `markState` is per-mark, keyed section:index, and holds only the
       decisions: everything not in it is accepted, which is the default and
       the reason a fresh note ships corrected without a click. */
    corrections: null,
    markState: {},

    // ── Assistant panel ──────────────────────────────────────────────────
    // What the clinician sees, which is not what the model sees: `conversation`
    // carries raw JSON both ways, `thread` carries the readable exchange.
    thread: [],            // [{role, kind, text}]
    annotation: null,      // {kind:"section"|"span", id, heading, text?}
    panelDraft: "",
    questions: null,       // triage questions awaiting an answer, or null
    readiness: null,       // 0-100 from triage; sets how long the skip stays locked
    pendingValues: null,   // scrubbed values held while triage runs
    // Answering two of three questions used to send the note to drafting with
    // the third still open. These carry the exchange across rounds so the next
    // pass can ask about what is genuinely still missing.
    bcbaOffer: "",         // a question for the BCBA the tool has offered to add
    ticketOffer: null,     // {note, target} feedback about the tool, offered as a stub
    ticketFiling: false,
    triageAnswers: "",     // everything they have answered so far, scrubbed
    triageRound: 0,        // rounds asked; capped so this cannot become an interrogation
    // Candidate answers offered alongside this round's questions. Absent from
    // the map means accepted, which is the resting state: a technician who
    // reads them and generates keeps all of them.
    suggestState: {},      // {"<question>:<suggestion>": {reverted, text}}
    // Changes a revision made OUTSIDE the section that was clicked, which the
    // model was not confident belonged there. Held here rather than applied, so
    // nothing is lost and nothing lands where it was not asked for.
    routingAsks: null,     // [{id, heading, value, prev, why, ...}] or null

    // ── Learned voice ────────────────────────────────────────────────────
    // styleCard is the live card, refreshed for display. convStyleBlock is the
    // snapshot the open conversation was drafted with, and must not track it -
    // it is part of the cached prompt prefix every revision replays.
    styleCard: null,       // {rules, block, available} | null while unknown
    convStyleBlock: "",
  };
}

function App() {
  const [activeId, setActiveId] = React.useState(urlToolParam);
  const [sessions, setSessions] = React.useState(() => {
    const map = {};
    TOOLS.forEach((t) => { map[t.id] = freshSession(t); });
    return map;
  });
  const [loading, setLoading] = React.useState(false);
  const [copied, setCopied] = React.useState(null);
  const [copiedPrompt, setCopiedPrompt] = React.useState(false);
  const [loggedIn, setLoggedIn] = React.useState(() => !!(window.NotesGate && NotesGate.isLoggedIn()));
  const [nowTick, setNowTick] = React.useState(Date.now());
  const [panelOpen, setPanelOpen] = React.useState(false);

  const tool = toolById(activeId) || TOOLS[0];
  const S = sessions[tool.id];
  const canUse = loggedIn && !!(window.NotesGate && NotesGate.canUseTool(tool.id));

  React.useEffect(() => (window.NotesGate ? NotesGate.subscribe(setLoggedIn) : undefined), []);

  // Back/forward navigation restores the tool that URL names.
  React.useEffect(() => {
    const onPop = () => setActiveId(urlToolParam());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 1s tick drives the cache-expiry banner countdown.
  React.useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // A docked panel insets the page rather than covering it; the class is on
  // <body> because #root is what gets the padding and the panel is a sibling.
  React.useEffect(() => {
    document.body.classList.toggle("revision-open", panelOpen);
    return () => document.body.classList.remove("revision-open");
  }, [panelOpen]);

  // Persist the active tool's typed inputs on every change (per-tool draft key).
  React.useEffect(() => {
    if (window.NotesGate) NotesGate.draft.save(tool.id, S.values);
  }, [S.values, tool.id]);

  const patchS = (patch) =>
    setSessions((prev) => ({ ...prev, [tool.id]: { ...prev[tool.id], ...(typeof patch === "function" ? patch(prev[tool.id]) : patch) } }));

  // Load the technician's learned voice once they are logged in - the card is
  // keyed on the login code, so there is nothing to ask for before that. Not
  // awaited by anything: an unreachable profile store leaves the card null and
  // every downstream path treats that as "no learned style", which is the same
  // prompt this tool used before any of this existed.
  React.useEffect(() => {
    if (!loggedIn || !window.NotesGate || !NotesGate.styleCard) return;
    let live = true;
    NotesGate.styleCard.get().then((card) => {
      if (live) patchS({ styleCard: card });
    });
    return () => { live = false; };
  }, [loggedIn, tool.id]);

  const setValue = (fid, val) => patchS((s) => ({ values: { ...s.values, [fid]: val } }));

  const switchTool = (id) => {
    if (id === activeId) return;
    const u = new URL(location.href);
    u.searchParams.set("tool", id);
    history.pushState({}, "", u);
    setActiveId(id);
    setCopied(null);
    setCopiedPrompt(false);
  };

  const collectFreeText = () =>
    tool.inputs.filter((f) => f.type === "textarea").map((f) => S.values[f.id] || "").join("\n");

  const handleCopy = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1800);
    // Copying is the moment the note leaves for the EHR - the right place to
    // record how long it was looked at and how much of it was rewritten.
    if (S.output && S.lastCallAt) {
      audit("note_copied", {
        seconds: Math.round((Date.now() - S.lastCallAt) / 1000),
        edited: manualEditChars(),
        revisions: S.conversation.filter((m) => m.role === "user").length - 1,
      });

      // Typing over the draft is the strongest signal there is - it is the
      // technician's own prose rather than something they approved. Measured at
      // copy time because that is when they are finished with it.
      const modelOut = lastModelOutput();
      if (modelOut) {
        const ids = narrativeIds();
        emitStyle(
          ids.map((id) => String(modelOut[id] || "")).join("\n\n"),
          ids.map((id) => String(S.output[id] || "")).join("\n\n"),
          "manual",
        );
      }
    }
  };

  /* ── LLM turns ─────────────────────────────────────────────────────── */

  // Every free-text send (initial notes, revisions, corrections) passes the same
  // scrub gate. Neither half of it opens a dialog any more, and both still return
  // promises, which is why this function did not have to change shape when they
  // stopped asking.
  //
  // scrubMap rather than a rendered string, because the notice now needs the
  // entries themselves: each substituted word is a button that certifies it as
  // not-PII for next time, which is where the deleted dialog's "not PII" checkbox
  // went. noticeText() is still exported for callers that only want the sentence.
  /* The map, in a ref as well as in state.

     finalize() needs it to put the round-trippable words back, and finalize()
     runs inside the same async turn that scrubGate() started. State set by
     patchS() is not visible to that closure until the next render, so reading
     S.scrubMap there would restore against the PREVIOUS note's map, or against
     an empty one on the first draft. The ref is what the model answer is
     measured against; the state copy stays because the notice renders from it. */
  const scrubMapRef = React.useRef([]);
  /* carryOver decides whether this scrub JOINS the note's map or replaces it,
     and getting it wrong is what put [[T3]] in a signed sup note on 2026-08-31.

     A revision scrubs only the newly typed instruction, because the section body
     is model output already in the conversation. That is right. What was wrong
     is that the map it produced then REPLACED the draft's map, taking the
     draft's opaque tokens with it. The model still had them: the revision
     replays the earlier turns verbatim for the prefix cache, so it copies
     [[T3]] out of its own history, and by then nothing knows [[T3]] was
     "Play-Doh".

     So: a fresh draft replaces, because it starts a new conversation and must
     not inherit the last note's words. Every later turn on the same note carries
     over. NotesScrub.review is given what is already issued so its numbering
     continues rather than minting a second [[T1]] for a different word. */
  const scrubGate = async (freeText, opts) => {
    const carryOver = !!(opts && opts.carryOver);
    if (!(await NotesScrub.acknowledge())) return null;
    const prior = carryOver ? scrubMapRef.current : [];
    const review = await NotesScrub.review({ freeText, seen: prior });
    if (review.cancelled) return null;
    const carried = carryOver ? NotesScrub.mergeMaps(prior, review.map) : review.map;
    scrubMapRef.current = carried;
    /* The BANNER gets the carried map too, not just this scrub's share of it.
       It tells the clinician what to substitute back in their EHR, and a note is
       one document however many turns built it: replacing the list on a revision
       took "Jacob → Client" off the screen while Client was still in the note
       they were about to copy. */
    patchS({ scrubMap: carried, certified: [] });
    return review;
  };

  // One-way, and the banner says so. Certifying stops the NEXT scrub taking the
  // word; it does not reach back into the draft that was just generated from a
  // prompt containing the token.
  const certifyNotPii = (name) => {
    if (!NotesScrub.notPii(name)) return;
    patchS({ certified: [...(S.certified || []), name] });
  };

  // Scrub the typed inputs only, then build prompts from the scrubbed values -
  // applying the map to a fully-composed prompt would also rewrite scaffolding
  // (headers, JSON key references) whenever a replacement collides with a
  // template word.
  const scrubValues = (map) => {
    const out = { ...S.values };
    tool.inputs.forEach((f) => {
      if (f.type === "textarea") out[f.id] = NotesScrub.applyMap(S.values[f.id] || "", map);
    });
    return out;
  };

  /* The learned style block is passed in rather than read from state, and is
     fixed for the life of a conversation.

     The system prompt is the cached prefix every revision replays. If the block
     changed between the first draft and a revision -- because the technician
     muted a rule in the panel while the note was open -- the prefix would no
     longer match and every subsequent turn would pay full price. So the card is
     snapshotted when the note is drafted, and a mute takes effect on the next
     note. The card UI says so. */
  /* ONE place decides how the system prompt is assembled, because two call paths
     build one - drafting and "what would you do here" - and they must agree byte
     for byte. If they disagree, the advice turn misses the prefix cache the note
     just warmed and pays full price for the whole conversation.

     A tool with serverPrompt set sends only the per-note block. Its own prompt is
     fetched inside the Worker from a service-bound Worker with no public URL, so
     it is neither downloadable nor forgeable. Everything else behaves exactly as
     it did. */
  const systemFor = (block) =>
    tool.serverPrompt
      ? { systemSuffix: block || "" }
      : { system: tool.buildSystem() + (block ? "\n\n" + block : "") };

  /* TRIAGE IS A CALL TOO, and the sup migration forgot it. This branch is the
     fix and triage-server-prompt.spec.js is the pin.

     A migrated tool sends no prompt text on ANY call, so triage asks for its
     prompt by kind and the Worker fetches the same text from the same store.
     Before this, triage sent its system prompt unconditionally, the Worker
     refused it with a 400 because the tool was migrated, and the catch below
     swallowed it: the note still drafted, and the technician silently lost the
     gap questions and the readiness reading.

     There is still one branch, not two. What changed on 2026-08-20 is which key
     the migrated side asks for: a tool with a triage prompt of its own names it
     with triageKind, and everything else gets "triage". sap is the only tool
     that overrides, and its override is a different prompt rather than a
     reworded one, so falling back would have asked a clinician about behavior
     counts instead of prompt hierarchies without erroring anywhere.

     triageKind and triageSystem are two halves of one fact and they are kept
     together by server-prompt.spec.js, which fails a migrated tool that has the
     override and not the key. That test is the only thing standing between this
     ternary and a silently wrong prompt. */
  const triageSystemFor = () =>
    tool.serverPrompt
      ? { promptKind: tool.triageKind || "triage" }
      : { system: (tool.triageSystem || TRIAGE_SYSTEM) + TRIAGE_SUGGESTIONS + TRIAGE_READINESS };

  /* EVERY DRAFT PASSES THROUGH HERE BEFORE ANYONE SEES IT.

     A note records what was done, never what was not done. That has been in the
     prompt in three separate places since 2026-08-15 and a note still came back
     saying "no recent session information was provided for comparison", so the
     rule is now enforced rather than asked for. absence.js cuts the sentence
     after the model returns, and what it will not cut it counts.

     It fails OPEN. If absence.js did not load, a note without the strip is worth
     more than no note, and the counts go out as zero rather than as a lie. */
  const finalize = (parsed) => {
    /* RESTORE FIRST, before normalising and before the absence strip reads a
       word of it. A word with no evidence of being a person went out as an
       opaque token, and this is where it comes back. Doing it here rather than
       at the call site is deliberate: this function already claims every draft
       passes through it, so nothing can reach a clinician having skipped it.

       Role tokens are NOT touched. Client stays Client. */
    const restored = NotesScrub.restoreOutput(parsed, scrubMapRef.current);
    const normalized = tool.normalizeOutput(restored);
    return window.NoteAbsence
      ? window.NoteAbsence.scrubNote(normalized)
      : { output: normalized, cut: 0, flagged: 0 };
  };
  const finalOutput = (parsed) => finalize(parsed).output;

  const runTurn = async (messages, styleBlock, wantOpinions) => {
    const r = await NotesGate.generateConversation({
      ...systemFor(styleBlock),
      messages,
      tool: tool.id,
      maxTokens: tool.maxTokens || 3000,
      // Only ever true when the clinician pressed "What would you do here?".
      // Drafting and ordinary revision leave it undefined, so the owning
      // clinician's stored judgement stays out of every note that did not ask.
      wantOpinions: wantOpinions === true,
      // The sections this tool renders are exactly the top-level keys its prompt
      // contracts for, so they double as the shape the response must satisfy.
      // Derived rather than declared, so the check cannot drift from the UI.
      expectKeys: tool.formSections.filter(isModelSection).map(sectionId),
      // Constrains the answer to the tool's schema so the API serializes the
      // note. Tools without one keep the plain-text path and the recovery
      // ladder beneath it, so this rolls out a tool at a time.
      responseSchema: schemaDisabled() ? null : (tool.responseSchema || null),
    });
    return r; // {parsed, rawText, usage, stopReason}
  };

  const pushThread = (role, kind, text) =>
    patchS((s) => ({ thread: [...s.thread, { role, kind, text }] }));

  /* ── Usage signal ─────────────────────────────────────────────────────
     Counts only, never a word of the note. What a supervisor needs to answer
     is not "what did this technician write" but "is the tool being worked with
     or pasted past" - and that question is answerable from lengths and counts
     alone, which is the only reason it is safe to keep a durable record here.
     Fire-and-forget: a metric must never cost someone their note. */

  const audit = (type, data) => {
    try {
      if (window.NotesGate && NotesGate.audit) NotesGate.audit.emit(type, { tool: tool.id, ...data });
    } catch (e) {}
  };

  // Characters typed per free-text input - a thinness signal that needs no text.
  const inputSizes = (values) => {
    const out = {};
    tool.inputs.filter((f) => f.type === "textarea").forEach((f) => {
      out["len_" + f.id.replace(/[^a-z0-9_]/gi, "")] = (values[f.id] || "").trim().length;
    });
    return out;
  };

  // The last thing the model actually returned, parsed. Both the manual-edit
  // measures below compare against this, so an accepted revision is treated as
  // the model's work and not as the clinician's own typing.
  const lastModelOutput = () => {
    if (!S.conversation.length) return null;
    for (let i = S.conversation.length - 1; i >= 0; i--) {
      if (S.conversation[i].role !== "assistant") continue;
      try { return JSON.parse(S.conversation[i].content.match(/\{[\s\S]*\}/)[0]); } catch (e) { return null; }
    }
    return null;
  };

  const narrativeIds = () =>
    tool.formSections.filter((s) => s.kind === "narrative").map(sectionId);

  // Section id to heading, so a move's dot can name where the sentence came
  // from rather than saying "somewhere else".
  const correctionHeadings = React.useMemo(() => {
    const map = {};
    tool.formSections.forEach((sec) => { map[sectionId(sec)] = sec.heading || ""; });
    return map;
  }, [tool.id]);

  /* How the note is doing, for the collapsed assistant pill.
   *
   * Built from the hints the model already returns rather than from a second
   * call: it has just read the note and said what is thin about it, so asking
   * again would cost a round trip to learn something we were already told.
   *
   * It reports a rubric rather than a tally. "2 spots could use more detail"
   * says work remains and nothing about what the work is, so the only way to
   * act on it is to open the panel and read both. The dimensions and the
   * grading live in note-rubric.js, and a tool brings its own because the hint
   * codes are per tool. Deliberately conservative either way: a green tick that
   * turns out to be wrong is worse than an amber one the technician glances at
   * and dismisses. */
  const noteQuality = () =>
    NoteRubric.grade({
      output: S.output,
      narrativeIds: narrativeIds(),
      rubric: tool.qualityRubric || null,
      hintCatalog: tool.hintCatalog || {},
    });

  // How much of the generated prose the clinician rewrote by hand.
  const manualEditChars = () => {
    if (!S.output) return 0;
    const modelOut = lastModelOutput();
    if (!modelOut) return 0;
    let delta = 0;
    narrativeIds().forEach((id) => {
      const before = String(modelOut[id] || "");
      const after = String(S.output[id] || "");
      if (before !== after) delta += Math.abs(after.length - before.length) || after.length;
    });
    return delta;
  };

  /* Turn a rewrite into a measurement of how this technician writes, and send
     only the measurement. The words never leave the page - style-features.js
     returns a feature name, a direction and a magnitude, nothing else.

     Both callers pass whole passages rather than individual sections: these are
     means and rates, and a two-sentence section produces a mean too unstable to
     learn anything from. */
  const emitStyle = (before, after, source) => {
    if (!before || !after || before === after) return;

    // Two consumers of the same difference, and they take different things.
    //
    // The shared style store takes NUMBERS: a feature, a direction, a magnitude,
    // and never a word. That is what makes it safe to keep for every technician.
    //
    // His voice profile takes the PAIR, because a pair holds topic and length
    // constant so every difference is a decision, and numbers cannot carry that.
    // It runs only for him, only after both halves pass an identifier check, and
    // it never leaves his browser. See assets/voice-capture.js.
    if (window.NoteStyleFeatures && window.NotesGate?.audit?.corrections) {
      const features = window.NoteStyleFeatures.compare(before, after, source);
      if (features.length) window.NotesGate.audit.corrections(features);
    }
    if (window.VoiceCapture) {
      const why = window.VoiceCapture.capture(before, after, {
        tool: tool.id,
        register: tool.voiceRegister || null,
        source,
      });
      /* WHY THIS IS AUDITED, when the pair itself never leaves the browser.
         Because otherwise nobody can answer "is capture actually working". It
         already failed silently once - the gate refused every note naming a
         clinical technique, kept nothing, and the only way to find out was to
         ask him to read a button. A refusal reason is a short fixed string from
         a closed set, in the same counts-only trail as everything else here, so
         this carries no note content and cannot. */
      if (window.VoiceCapture.enabled()) {
        audit("capture", { outcome: why || "kept", pending: window.VoiceCapture.stats().pending });
      }
    }
  };

  /* ── Triage: ask before drafting ──────────────────────────────────────
     A note is only as good as what went into it, and the commonest failure is
     not a bad draft but a thin one - a behavior with no count, a program with
     no prompt level. Asking costs one cheap call and is the only moment the
     technician still has the session in their head.

     Triage is its own call with its own system prompt. The note conversation's
     prefix is what the 5-minute cache is keyed on and every revision replays
     it, so that prefix has to stay byte-identical from the first draft on. */

  const TRIAGE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["sufficient", "readiness", "questions"],
    properties: {
      sufficient: { type: "boolean" },
      /* The bound lives in the prompt and in clampReadiness, never in the
         schema. The API refuses an integer carrying minimum or maximum, and it
         refuses the whole call, which is how all five tools lost their triage
         for a fortnight without any of them looking broken. */
      readiness: { type: "integer", description: "0 to 100." },
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field", "question", "suggestions", "bar"],
          properties: {
            field: { type: "string" },
            question: { type: "string" },
            /* Required, holding [] when there are none, rather than optional.
               The schema is shared by every tool and the model is constrained
               to it whether or not that tool's prompt mentions suggestions, so
               a key it must always emit is one it can never half-emit. */
            suggestions: { type: "array", items: { type: "string" } },
            /* Required and empty for the same reason, and the id alone rather
               than the rule it names. A tool whose prompt supplies no bar
               returns "", and the string that comes back is checked against a
               shape before anything reads it. */
            bar: { type: "string" },
          },
        },
      },
    },
  };

  const clampReadiness = (n) => Math.min(100, Math.max(0, Math.round(n)));

  /* Both of these now live in triage-prompt.js, so the prompt store can extract
     them from a deployed file. Read here rather than defined here, the same way
     the register rules are. */
  const TRIAGE_SYSTEM = (window.NoteTriagePrompt || {}).system || "";
  /* Between the tool's own prompt and the readiness block, so a tool that
     overrides the first still gets the candidate-answer mechanism. What a tool
     suggests ABOUT is its own prompt's business; how a suggestion is shaped and
     what makes one safe to accept by default is the same for all of them. */
  const TRIAGE_SUGGESTIONS = (window.NoteTriagePrompt || {}).suggestions || "";
  const TRIAGE_READINESS = (window.NoteTriagePrompt || {}).readiness || "";

  // The default above is written for session notes. A tool whose input is not a
  // session (a SAP is a program plan, with no counts and no "this session")
  // overrides both halves, because asking a plan how many times a behavior
  // occurred is worse than asking nothing.
  /* Up to three rounds. His note: the model need not give up after one,
     because a technician often answers two of three and the third only becomes
     answerable once the first two are on the table. The cap exists so this
     cannot turn into an interrogation, and the skip button is on screen the
     whole time. */
  const MAX_TRIAGE_ROUNDS = 3;

  /* The clinician's own words, labelled by the field they typed them into, and
     nothing else. Extracted from runTriage rather than written twice: the
     expert pass reads this too, and the two must be reading the SAME intake or
     a disagreement between them is a disagreement about the input rather than
     about the note. */
  const intakeBody = (scrubbed) =>
    tool.inputs
      .filter((f) => f.type === "textarea")
      .map((f) => `[${f.label}]${f.required ? " (required)" : ""}\n${(scrubbed[f.id] || "").trim() || "(empty)"}`)
      .join("\n\n");

  /* At most two, non-blank, and never longer than a sentence the technician
     would have typed themselves.

     The cap is a hard bound rather than a prompt request. Two is the number he
     asked for, and a question wearing five pre-accepted answers is no longer a
     question - it is a paragraph the tool wrote and dared them to read. */
  const MAX_SUGGESTIONS = 2;
  const MAX_SUGGESTION_CHARS = 220;

  /* The id of the standard a question came from, where the prompt gave the
     model one. It is not shown; it is what the audit trail carries, and it is
     the only way to find out which parts of the bar a technician's notes
     actually fail.

     Held to a shape rather than trusted, because this is a model-written string
     on its way into the one durable per-technician record the system keeps.
     "B4" is content-free. A sentence about a session is not, and the difference
     between them here is one regex. */
  const BAR_ID = /^[A-Z][0-9]{1,2}$/;
  const barId = (raw) => {
    const t = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    return BAR_ID.test(t) ? t : "";
  };

  const normalizeQuestion = (q) => ({
    ...q,
    suggestions: (Array.isArray(q.suggestions) ? q.suggestions : [])
      .filter((t) => typeof t === "string" && t.trim())
      .map((t) => t.trim().slice(0, MAX_SUGGESTION_CHARS))
      .slice(0, MAX_SUGGESTIONS),
    bar: barId(q.bar),
  });

  /* How many questions the reading buys, his ruling of 2026-08-31: "Minimize
     them but a truly bad note may need more than 3 clarifications."

     The prompt states the same bands and this is the bound, because a prompt
     asked for two can still return five and the technician is the one who pays
     for the extra three. A missing reading keeps the three the tool asked for
     before there was a reading at all. */
  const QUESTION_CEILINGS = [
    { from: 85, ask: 1 },
    { from: 60, ask: 2 },
    { from: 30, ask: 3 },
    { from: 0, ask: 5 },
  ];
  const DEFAULT_QUESTION_CEILING = 3;
  const questionCeilingFor = (readiness) => {
    if (!Number.isFinite(readiness)) return DEFAULT_QUESTION_CEILING;
    const band = QUESTION_CEILINGS.find((b) => readiness >= b.from);
    return band ? band.ask : DEFAULT_QUESTION_CEILING;
  };

  /* One hyphen-joined token rather than an array, because the audit sanitiser
     keeps a short token and drops everything else, an array included. Deduped
     and cut to what the sanitiser accepts, and the key is left off entirely
     when there is nothing to say, so a key that arrives is a key that was
     meant rather than one dropped quietly on the way. */
  const AUDIT_TOKEN_MAX = 24;
  const barsFor = (questions) => {
    const seen = [];
    (questions || []).forEach((q) => {
      const id = q && q.bar;
      if (id && seen.indexOf(id) === -1) seen.push(id);
    });
    let token = "";
    seen.forEach((id) => {
      const next = token ? token + "-" + id : id;
      if (next.length <= AUDIT_TOKEN_MAX) token = next;
    });
    return token ? { bars: token } : {};
  };

  const runTriage = async (scrubbed, priorAnswers) => {
    let body = intakeBody(scrubbed);
    if (priorAnswers && priorAnswers.trim()) {
      body += "\n\n[ALREADY ANSWERED BY THE CLINICIAN]\n" + priorAnswers.trim() +
        "\n\nTreat everything above as part of their notes. Ask ONLY about what is still genuinely missing. " +
        "Never re-ask something they have answered, and never rephrase an answered question. " +
        "If nothing important is still missing, return sufficient: true.";
    }
    const r = await NotesGate.generateConversation({
      ...triageSystemFor(),
      messages: [{ role: "user", content: (tool.triageIntro || "CLINICIAN'S RAW NOTES:") + "\n\n" + body }],
      tool: tool.id,
      maxTokens: 600,
      expectKeys: ["sufficient", "questions"],
      responseSchema: TRIAGE_SCHEMA,
    });
    // The clinician reads these, so they get the same restore the draft gets.
    // An opaque token in a gap question is worse than useless: it asks about a
    // word the person cannot see.
    const parsed = NotesScrub.restoreOutput(r.parsed || {}, scrubMapRef.current);
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    // Absent or unparseable stays null rather than becoming a number, so the
    // wait falls back to the full thirty seconds and the ceiling to three. A
    // missing reading must not hand out the shortcut a ready note earns.
    //
    // Clamped here rather than trusted, because the schema cannot carry the
    // bound. One clamp at the boundary means every consumer reads the same
    // number - the audit trail included, which the clamp inside
    // skipSecondsFor never covered.
    const readiness = Number.isFinite(parsed.readiness) ? clampReadiness(parsed.readiness) : null;
    return {
      questions: parsed.sufficient
        ? []
        : questions.filter((q) => q && q.question)
            .slice(0, questionCeilingFor(readiness))
            .map(normalizeQuestion),
      readiness,
    };
  };

  // Draft the note. `extra` is the technician's answers to the triage questions,
  // already scrubbed; it rides along in the same first user message so the
  // conversation stays a single linear prefix.
  /* Ask the model to look again at its own draft.
   *
   * It names one measurable failure: a draft whose sentences all come out the
   * same length. That is the strongest machine signal there is, and the ask
   * quotes the draft's own numbers back, because "your last draft ran at N
   * words a sentence" is a fact where "vary your sentence length" is a
   * preference with nothing to check it against.
   *
   * Returns null when there is nothing worth a second call, so a note that
   * already varies costs one API call rather than two.
   */
  /* The gate is the WITHIN-SECTION figure, because the whole-note one mixes
     variation inside a section with movement between sections and a note can
     pass it while every section reads flat.

     WHERE THE NUMBER COMES FROM. It is the human 10th percentile across 108
     documents, which is the same rule the old whole-note floor followed: fire
     only on prose in the bottom decile of human-shaped writing. In absolute
     terms 0.383 is lower than the 0.45 it replaces, but the two measure
     different quantities and 0.45 sat below the whole-note 10th percentile of
     0.506, so this is if anything the more willing of the two to fire.

     A false fire costs one extra API call; a miss ships a flat note.
     REVISE_SPREAD_FLOOR stays as the fallback for a note whose sections are
     each too short to measure. */
  const REVISE_WITHIN_FLOOR = 0.383;
  const REVISE_SPREAD_FLOOR = 0.45;
  /* Below this there is nothing to judge. A coefficient of variation over four
     or five short sentences is noise, not a register signal, and spending a
     second API call to "fix" it would be acting on a number that means nothing.
     A real note runs 250 words and up; this only filters out the genuinely
     tiny ones. */
  const REVISE_MIN_SENTENCES = 8;
  const REVISE_MIN_WORDS = 120;

  /* The two rules that hold whether or not a section was pointed at.
   *
   * Both come from faults he hit on the live tool. He asked whether something
   * belonged in the BCBA summary and the note was REWRITTEN rather than
   * answered. And on a move, content left the source section and never arrived
   * at the destination, so a move silently became a delete. */
  const REVISION_RULES = [
    `IF THE CLINICIAN SAYS THEY ARE UNSURE about something clinical - whether a behaviour counts, whether a program should change, whether something is worth reporting - do not guess and do not decide for them. Put a short question for the supervising BCBA in "bcbaQuestion", phrased the way the technician would ask it. Leave it empty otherwise. This is not for uncertainty about wording or formatting, only about clinical judgement.`,
    `IF THE MESSAGE IS A QUESTION rather than an instruction to change something, answer it in "answer" and return every other key EXACTLY as it currently stands. Do not edit the note to answer a question. "Should this go in the summary?" is a question. "Move this to the summary" is an instruction.`,
    `A MOVE HAS TWO HALVES AND YOU MUST DO BOTH. If content should move from one section to another, remove it from the source AND write it into the destination in the same reply, and list the destination in "crossSection". Never take content out of a section without putting it somewhere, unless the clinician explicitly asked for it to be deleted.`,
  ].join("\n");

  const selfRevise = async (conversation, block, first) => {
    if (!window.NoteMetrics) return null;

    const prose = tool.formSections
      .filter((sec) => sec.kind === "narrative" && sec.key)
      .map((sec) => String(finalOutput(first.parsed)[sec.key] || ""))
      .filter(Boolean)
      .join("\n\n");

    const m = window.NoteMetrics.measure(prose);
    // Nothing to measure, too little to judge, or it already mixes: leave it.
    if (!m) return null;
    if (m.sentences < REVISE_MIN_SENTENCES || m.words < REVISE_MIN_WORDS) return null;

    // Judge the sections when they can be judged, and the whole note only when
    // they cannot. Quoting the figure that was actually tested keeps the ask
    // honest: "your sections vary by 36%" is checkable, and it is the number
    // this call was made on.
    const scoped = m.sectionCv !== null && m.sectionCv !== undefined && m.sections >= 1;
    const spread = scoped ? m.sectionCv : m.burstiness;
    if (spread >= (scoped ? REVISE_WITHIN_FLOOR : REVISE_SPREAD_FLOOR)) return null;

    const where = scoped ? "within each section" : "across the note";
    const ask = [
      "Before I read this, look at your own draft again.",
      "",
      "Its narrative sentences average " + Math.round(m.meanLen) + " words, and " + where +
        " they vary by only " + Math.round(spread * 100) +
        "% around that. That is the problem: not the length, the SAMENESS.",
      "Uniform sentence length is the single strongest signal that prose was machine-written,",
      "and it is equally true whether every sentence is short or every sentence is long.",
      "",
      // These lines are joined with a newline, so a phrase split across two of
      // them is not the phrase any more. tests/self-revision.spec.js matches
      // "keep every checkbox" and caught exactly that. Keep each prohibition
      // whole on its own line.
      "Fix it INSIDE each section rather than between them. A note where every section reads at",
      "one flat pace, with all the variety sitting between sections, has the same problem in a",
      "different place. Put a short sentence next to a long one. Let a small fact be a short",
      "sentence. Join two related observations into one longer sentence where they belong together.",
      "Change nothing about the clinical content: no new facts, no removed facts, no softened",
      "findings, and keep every checkbox exactly as it is.",
      "",
      "Return the COMPLETE JSON object with ALL keys, as before.",
    ].join("\n");

    const next = [...conversation, { role: "user", content: ask }];
    const result = await runTurn(next, block);
    if (!result || !result.parsed) return null;
    return { ask, result };
  };

  const draftNote = async (scrubbedValues, extra) => {
    setLoading(true);
    patchS({ output: null, proposal: null, conversation: [], questions: null, readiness: null, pendingValues: null, expert: null, corrections: null, markState: {} });
    try {
      let userMsg = tool.buildUserPrompt(scrubbedValues);
      if (extra && extra.trim()) {
        userMsg += "\n\nTHE TECHNICIAN ADDED, ANSWERING FOLLOW-UP QUESTIONS (treat as part of the notes above):\n" + extra.trim();
      }
      // Snapshot the technician's learned style for this whole conversation.
      // Empty for a new technician, and empty when the profile store is
      // unreachable - both give exactly the prompt that shipped before any of
      // this existed, which is the intended failure mode.
      const styleBlock = (S.styleCard && S.styleCard.block) || "";

      /* The sentence shape target for THIS note, drawn per note rather than per
         session. It carries two numbers: how much sentence length should move
         inside a section, and how far the average should move between sections.
         Two rather than one because the whole-note figure is their mixture and
         does not identify a shape; see profile-api/src/shape.js for the corpus
         that settles it.

         Per note rather than fixed, because a fixed target would fix one note
         while making a hundred notes identically flat, which is its own
         signature. The seed is this note's identity, so a revision redraws the
         same target and the cached prefix survives.

         Best effort by design: an unreachable profile store gives exactly the
         prompt that shipped before any of this existed. */
      const shapeSeed = tool.id + ":" + Date.now() + ":" + Math.random().toString(36).slice(2, 8);
      let shapeBlock = "";
      try {
        const withShape = window.NotesGate && NotesGate.styleCard
          ? await NotesGate.styleCard.get({ tool: tool.id, seed: shapeSeed })
          : null;
        shapeBlock = (withShape && withShape.shapeBlock) || "";
      } catch (e) { shapeBlock = ""; }

      /* The technician's voice for THIS note, measured from what they just
         typed. Separate from the style card: that is slow, cross-session and
         content-free; this is the energy they brought today and is thrown away
         on reload. Empty string when there is too little to read, which drafts
         exactly as before. */
      const voiceBlock = window.IntakeVoice
        ? window.IntakeVoice.block(
            tool.inputs.map((f) => String(scrubbedValues[f.id] || "")).join("\n") +
            (extra && extra.trim() ? "\n" + extra.trim() : ""),
          )
        : "";

      /* THE EXPERT READS THE SAME INTAKE AT THE SAME MOMENT.
       *
       * Fired here rather than awaited anywhere: the draft's control flow never
       * touches it, so the note arrives exactly when it always did and a slow
       * or broken expert costs nobody a note. It is a Haiku call against a
       * system prefix that is identical on every note and therefore cached, so
       * in practice it finishes inside the drafting turn and the reading is
       * already on screen when the draft lands.
       *
       * It is sent the intake ALREADY SCRUBBED, by the gate the drafting call
       * passed through - NotesScrub.review() replaced every name with the role
       * token before either call was made. Nothing is restored on the way back,
       * which is the one way this caller differs from the admin bench: the
       * token is what the clinician wants left in, so the expert quotes "Client
       * hit the table" and the note beside it says "Client hit the table".
       *
       * runId guards a late arrival. A clinician who regenerates, or switches
       * tool and comes back, must not have the previous intake's reading
       * quietly attach itself to the note in front of them.
       */
      const expertSections = expertEnabled(tool.id) ? expertSectionIds(tool) : null;
      if (expertSections && window.NotesGate && NotesGate.expertPass) {
        const runId = String(Date.now()) + ":" + Math.random().toString(36).slice(2, 8);
        patchS({ expert: { status: "running", runId } });
        const expertIntake = intakeBody(scrubbedValues) +
          (extra && extra.trim() ? "\n\n[ANSWERED FOLLOW-UP QUESTIONS]\n" + extra.trim() : "");
        NotesGate.expertPass({ tool: tool.id, intake: expertIntake, sections: expertSections })
          .then((raw) => {
            /* The expert quotes the clinician's own sentences back at them, so a
               finding reading "you wrote '[[T4]] clinic'" names a word they
               cannot see. Same restore as the draft, and role tokens are left
               alone here too. */
            const found = raw ? NotesScrub.restoreOutput(raw, scrubMapRef.current) : raw;
            patchS((s) => {
              if (!s.expert || s.expert.runId !== runId) return {};
              return { expert: found ? { status: "done", runId, ...found } : { status: "failed", runId } };
            });
            // Counts and enums only, never a word of a finding. What this
            // answers is the question the phase exists for: how much the expert
            // says on a real note, beside what the catalog said on the same one.
            if (found) {
              audit("expert_pass", {
                hints: (found.hints || []).length,
                register: (found.register || []).length,
                terms: (found.terms || []).length,
                dropped: found.hintsDropped || 0,
                inTokens: (found.usage && found.usage.input_tokens) || 0,
                cachedTokens: (found.usage && found.usage.cache_read_input_tokens) || 0,
                outTokens: (found.usage && found.usage.output_tokens) || 0,
              });
            }
          })
          // expertPass resolves rather than rejects on every failure it knows
          // about; this covers the ones it does not.
          .catch(() => patchS((s) => (s.expert && s.expert.runId === runId ? { expert: { status: "failed", runId } } : {})));
      }

      const conversation = [{ role: "user", content: userMsg }];
      patchS({ convStyleBlock: styleBlock + voiceBlock + shapeBlock });
      let r = await runTurn(conversation, styleBlock + voiceBlock + shapeBlock);
      conversation.push({ role: "assistant", content: r.rawText });

      /* One self-revision before the technician ever sees it.
         Measured on 2026-08-04: rewriting the prompt moved the uniformity score
         not at all, 26 either way, while two rounds of the technician revising
         by hand took it to 16. Revision is what works, so the tool does the
         first one itself rather than shipping a draft that needs it. His words:
         "It should already be trying for one revision at least."
         Best effort - a failure here keeps the first draft rather than costing
         anyone their note. */
      try {
        const polished = await selfRevise(conversation, styleBlock + voiceBlock, r);
        if (polished) {
          r = polished.result;
          conversation.push({ role: "user", content: polished.ask });
          conversation.push({ role: "assistant", content: polished.result.rawText });
        }
      } catch (e) { /* keep the first draft */ }

      const finalDraft = finalize(r.parsed);

      /* THE CORRECTIONS PASS, before the technician ever reads the draft.
       *
       * Awaited rather than fired alongside, which is the opposite of the
       * expert pass above and for a reason: the expert writes a panel beside
       * the note, and this one writes the note. A technician who copied during
       * the gap would take away the uncorrected draft and never know a
       * correction existed, and "doing nothing ships all of it" would be false
       * for exactly the people least likely to wait.
       *
       * Best effort, like every other pass here. A null leaves the draft
       * standing with no marks, which is what shipped before this existed. */
      let corrected = finalDraft.output;
      let marks = null;
      if (correctionsEnabled(tool.id) && window.NotesGate && NotesGate.correctionsPass) {
        try {
          const draftSections = tool.formSections
            .filter((sec) => sec.kind === "narrative" && sec.key)
            .map((sec) => ({ id: sec.key, heading: sec.heading, text: String(finalDraft.output[sec.key] || "") }))
            .filter((d) => d.text.trim());
          const pass = draftSections.length
            ? await NotesGate.correctionsPass({
                tool: tool.id,
                intake: intakeBody(scrubbedValues) +
                  (extra && extra.trim() ? "\n\n[ANSWERED FOLLOW-UP QUESTIONS]\n" + extra.trim() : ""),
                draft: draftSections,
              })
            : null;
          const before = {};
          draftSections.forEach((d) => { before[d.id] = d.text; });
          const built = pass && window.NoteCorrections
            ? NoteCorrections.build({ before, corrections: pass.corrections })
            : null;
          if (built && built.count) {
            marks = built;
            corrected = { ...finalDraft.output, ...NoteCorrections.outputFor(built.sections, {}) };
          }
          // Counts and enums only. Never a word of a correction, and never a
          // word of the note it corrected.
          if (pass) {
            audit("corrections_pass", {
              sections: (pass.corrections || []).length,
              marks: built ? built.count : 0,
              dropped: pass.dropped || 0,
              inTokens: (pass.usage && pass.usage.input_tokens) || 0,
              cachedTokens: (pass.usage && pass.usage.cache_read_input_tokens) || 0,
              outTokens: (pass.usage && pass.usage.output_tokens) || 0,
            });
          }
        } catch (e) { /* keep the draft as it was written */ }
      }

      patchS({
        output: corrected,
        conversation,
        lastCallAt: Date.now(),
        corrections: marks,
        markState: {},
      });
      pushThread("assistant", "status", marks
        ? "Drafted, and I made " + marks.count + (marks.count === 1 ? " change" : " changes") +
          " the handout asks for. They are already in the note and marked where they are. Click a tick to undo or reword one."
        : "Drafted. Click any section - or select a phrase inside one - to revise it.");
      // Register signals for the weekly audit. Numbers only, measured on the
      // draft the clinician is about to read, so a drift toward machine-uniform
      // prose shows up in the Friday email rather than in a detector months
      // later. Best effort by design: a measurement failure must never cost
      // somebody their note.
      let register = null;
      try {
        const body = tool.formSections
          .map((s) => (s.key ? finalOutput(r.parsed)[s.key] : ""))
          .filter(Boolean).join("\n\n");
        register = window.NoteMetrics ? window.NoteMetrics.measure(body) : null;
      } catch (e) { register = null; }

      /* absenceCut and absenceFlagged are how we find out whether the prompt
         rule is working, which is the question that started this. Counts only:
         the sentence itself is clinical text and never leaves the page. */
      audit("note_generated", {
        ...inputSizes(scrubbedValues),
        answered: extra && extra.trim() ? 1 : 0,
        absenceCut: finalDraft.cut,
        absenceFlagged: finalDraft.flagged,
      });
      // Its own event, not merged into note_generated: the metric sanitiser
      // caps a payload at 12 numeric keys and silently drops the overflow, so
      // sharing a budget would quietly lose whichever signals sorted last.
      if (register) {
        /* HOW FAR THE NOTE RAN PAST ITS SOURCE, as a ratio, numbers only.
           Two hand measurements on 2026-08-16 landed in opposite directions on
           the same tool: one intake compressed 498 words to 258, another
           expanded 264 to 638 and read as padded. Two points settle nothing,
           which is exactly why this is measured on every note from here rather
           than argued from those two. Nothing but the ratio and the intake size
           leaves the page, and neither can be turned back into what anyone
           wrote. */
        const intakeWords = tool.inputs
          .map((f) => String(scrubbedValues[f.id] || ""))
          .join(" ").split(/\s+/).filter(Boolean).length;
        audit("note_register", {
          intakeWords,
          expansion: intakeWords ? Math.round((register.words / intakeWords) * 1000) / 1000 : 0,
          sentences: register.sentences,
          words: register.words,
          meanLen: register.meanLen,
          burstiness: register.burstiness,
          // The two the shape profile is actually learned from. Sent as their
          // own keys rather than replacing burstiness, which the score and the
          // Friday report both still read.
          sectionCv: register.sectionCv,
          sectionStep: register.sectionStep,
          sections: register.sections,
          openerVariety: register.openerVariety,
          repeatRate: register.repeatRate,
          actorRate: register.actorRate,
          clientRate: register.clientRate,
          imperativeRate: register.imperativeRate,
          topOpener: register.topOpenerRepeat,
          /* THE REGISTER REMEDIATION, WHICH USED TO STOP HERE. note-metrics has
             counted these four constructions since the day the bans shipped and
             the counts never left the browser, so the Friday report could not
             say whether the thing that took a real note from 53% to 0% was
             still holding. Density for the trend, and the four separately so a
             regression can be attributed rather than only noticed. */
          flaggedPer100: register.flaggedPer100,
          emptyAdverbs: register.emptyAdverbs,
          participialCausals: register.participialCausals,
          abstractStates: register.abstractStates,
          vagueVerbs: register.vagueVerbs,
          score: register.score,
        });
      }
    } catch (e) {
      patchS({ error: NotesGate.displayError(e) });
      pushThread("assistant", "status", "That didn't go through. " + NotesGate.displayError(e));
      reportError(tool.id, e);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    const err = tool.validate(S.values);
    if (err) { patchS({ error: err }); return; }
    if (!NotesGate.isLoggedIn()) { NotesGate.openLogin(); return; }
    patchS({ error: "", thread: [], annotation: null, panelDraft: "" });
    const review = await scrubGate(collectFreeText());
    if (!review) return;
    const scrubbed = scrubValues(review.map);
    setLoading(true);
    setPanelOpen(true);
    let questions = [];
    let readiness = null;
    try {
      const triage = await runTriage(scrubbed);
      questions = triage.questions;
      readiness = triage.readiness;
    } catch (e) {
      // Triage is an assist, not a gate. If it fails the note still gets
      // written - losing a question is a far smaller harm than refusing to
      // draft for a technician with eight notes left to file.
      reportError(tool.id, e);
    }
    if (questions.length) {
      setLoading(false);
      audit("gap_questions", { asked: questions.length, round: 1, readiness, ...barsFor(questions) });
      patchS({ questions, readiness, pendingValues: scrubbed, triageAnswers: "", triageRound: 1, suggestState: {} });
      return;
    }
    audit("gap_questions", { asked: 0 });
    await draftNote(scrubbed, "");
  };

  /* How long "generate anyway" stays locked while gap questions are on screen.
     The same wait on every tool, which is his ruling and not the default I
     reached for. I had scoped it to bt, reasoning that the price existed
     because skipping was cheaper than reading for someone still learning what a
     note needs, and that a BCBA already knows. He overruled it: "yeah, it
     should lock my drafters as well." A thin note is thin whoever wrote it.

     The wait scales with the note: a nearly-ready note drains fast, a thin one
     drains slow.

     A READY NOTE WAITS NOT AT ALL, which is his ruling of 2026-08-06 and the
     opposite of what I built. I had set a five second floor, arguing the pause
     had to stay a pause. He overruled it - "the floor is 0 for 85% or better" -
     and he is right about who the price is for. The wait exists because the
     audit trail showed skipping was cheaper than reading. On a note the model
     says is already complete there is nothing to read, so the price is charged
     for nothing and lands on the person who did the work properly.

     A missing reading still gets the full thirty. */
  const SKIP_COOLDOWN_MAX_SECONDS = 30;
  const SKIP_FREE_AT_READINESS = 85;

  /* Below the bar the tool refuses to draft until one round is answered. His
     ruling of 2026-08-31: "It should refuse a draft without an initial revision
     if the bar isn't met", and on what those questions should be like, "Make
     them try again. Try to give them minimal prompts to get the information
     needed across objections."

     THREE THINGS DO NOT GATE, and each is deliberate.

     A missing reading never gates. Triage that failed is an assist that failed,
     and refusing to draft over it would turn a lost question into a lost note.

     The second round never gates. One mandatory round is what he asked for, and
     a gate that could hold someone twice is a gate that could hold them
     forever.

     A kept suggestion opens it, because a kept suggestion IS the answer. It
     carries the technician's own words into the note, so a draft built on one
     is not the empty draft this refuses.

     EVERY TOOL, INCLUDING HIS OWN, on the same ruling that put the skip wait on
     all five: "should lock my drafters as well." A thin note is thin whoever
     wrote it. */
  const BAR_READINESS = SKIP_FREE_AT_READINESS;
  const gateHolds = () => (S.triageRound || 1) === 1 &&
    Number.isFinite(S.readiness) &&
    S.readiness < BAR_READINESS &&
    acceptedSuggestions().length === 0;

  const skipSecondsFor = (readiness) => {
    if (!Number.isFinite(readiness)) return SKIP_COOLDOWN_MAX_SECONDS;
    const pct = Math.min(100, Math.max(0, readiness));
    if (pct >= SKIP_FREE_AT_READINESS) return 0;
    // Ramped across the range that still waits, so it reaches zero AT his
    // threshold rather than stepping off a cliff there. 84 is very nearly free,
    // which is the same thing 85 is, and a one-point difference should not be
    // the difference between no wait and a long one.
    return Math.round(SKIP_COOLDOWN_MAX_SECONDS * (1 - pct / SKIP_FREE_AT_READINESS));
  };

  /* ── The candidate answers under each question ────────────────────────────
     Accepted by default and undone with a click, the same contract the
     corrections marks carry. Doing nothing keeps all of them.

     That is only safe because of what the prompt forbids: a suggestion
     rephrases something the technician already wrote and never supplies a fact
     they did not report. So leaving one alone re-surfaces their own observation
     rather than admitting the model's guess about their session. */
  const suggestKey = (qi, si) => qi + ":" + si;

  const suggestionText = (qi, si, raw) => {
    const st = (S.suggestState || {})[suggestKey(qi, si)];
    if (st && st.reverted) return "";
    return st && typeof st.text === "string" ? st.text : raw;
  };

  // In the order they were offered, so the answer reads down the questions.
  const acceptedSuggestions = () =>
    (S.questions || [])
      .flatMap((q, qi) => (q.suggestions || []).map((raw, si) => suggestionText(qi, si, raw)))
      .filter((t) => t && t.trim());

  const toggleSuggestion = (key) => {
    const prev = (S.suggestState || {})[key] || {};
    patchS({ suggestState: { ...(S.suggestState || {}), [key]: { ...prev, reverted: !prev.reverted } } });
  };

  // Editing does not accept: a technician can reword one they have undone and
  // leave it undone. The two flags are independent because the two decisions
  // are - what it should say, and whether it should be there at all.
  const editSuggestion = (key, text) => {
    const prev = (S.suggestState || {})[key] || {};
    patchS({ suggestState: { ...(S.suggestState || {}), [key]: { ...prev, text: text } } });
  };

  /* Skip is also the ACCEPT path for the suggestions, and that is deliberate.

     Sending requires typed text, so a technician whose only answer is "yes,
     those two are right" has nowhere else to go. Dropping their suggestions
     here would mean the one interaction cheap enough to actually get used is
     the one that throws itself away. The button says so when there is something
     to carry: "Nothing to add" becomes "Use these and generate".

     The gate runs over them rather than around them, because a technician who
     reworded one may have typed a name into it. An untouched suggestion came
     from already-scrubbed input, so it passes through unchanged. */
  const skipQuestions = async () => {
    // Checked here as well as drawn, so a stale render cannot walk past it.
    if (gateHolds()) return;
    const taken = acceptedSuggestions();
    audit("gap_questions", {
      skipped: (S.questions || []).length,
      suggestionsTaken: taken.length,
      round: S.triageRound || 1,
      // Audited on the skip as well as on the ask, because the only way to find
      // out whether this number tracks anything real is to see which readings
      // people walk away from.
      readiness: S.readiness,
    });
    let carried = "";
    if (taken.length) {
      const review = await scrubGate(taken.join("\n"), { carryOver: true });
      if (!review) return;
      carried = NotesScrub.applyMap(taken.join("\n"), review.map);
    }
    pushThread("user", "answer", taken.length ? taken.join("\n") : "(skipped)");
    // Anything they answered in an earlier round still counts. Dropping it
    // because they skipped the last question would throw away work they did.
    const answered = [S.triageAnswers, carried].filter((x) => x && x.trim()).join("\n");
    patchS({ triageAnswers: "", triageRound: 0, suggestState: {} });
    draftNote(S.pendingValues || scrubValues([]), answered);
  };

  /* ── Revisions ────────────────────────────────────────────────────────
     The exchange is committed to the conversation immediately (so follow-ups
     keep context and the cache prefix stays linear); Accept/Discard only
     controls what lands in the visible output. */

  /* ── Asking for a recommendation ──────────────────────────────────────
     The owning clinician's stored calls are gated behind an explicit request,
     by his ruling: "The tool has to request it - a 'what would you do here'
     affordance." So this is a separate button rather than something inferred
     from the wording of a revision instruction. Inference would mean the
     judgement sometimes appearing in a note nobody asked to individualise,
     which is the failure the gate exists to prevent.

     It returns advice into the thread and does NOT touch the note. A
     recommendation is something to read and act on, not a silent edit. */
  const askWhatWouldYouDo = async () => {
    if (loading) return;
    // The button is disabled without a note, so this is unreachable from the UI.
    // It stays as a guard for a programmatic caller, and says nothing to the
    // thread: repeating a refusal is what produced four identical lines in it.
    if (!S.output) return;
    const ann = S.annotation;
    const section = ann ? tool.formSections.find((s) => sectionId(s) === ann.id) : null;
    // Who is on the other side of the answer. A BCBA tool is asking a peer; the
    // BT tool is a technician asking the analyst who supervises them.
    const asker = tool.asker || "clinician";
    pushThread("user", "answer", section ? `What would you do here? (${section.heading})` : "What would you do here?");

    const userMsg = [
      `RECOMMENDATION REQUEST`,
      section
        ? `The clinician is asking what to do about "${section.heading}" (JSON key: ${ann.id}).`
        : `The clinician is asking what to do next for this case.`,
      section ? `\nCurrent content of that section:\n${sectionBody(section, S.output, S.values)}` : "",
      ``,
      `Answer in prose, as ${asker === "clinician" ? "advice to a supervising clinician" : `a board certified behavior analyst answering a ${asker}`}.`,
      `Do NOT return the note JSON and do not change any section.`,
      ``,
      `WHO IS ANSWERING. The voice, register and stored judgement above belong to one`,
      `analyst. Answer as that person would,`,
      `not as a neutral summary of the field: take a position where the record supports one.`,
      `This is the best resource available when the supervising BCBA is not there to turn`,
      `to, and it does not replace them.`,
      `Where the right answer is that this one is theirs to make, say so and say what to ask them.`,
      ``,
      `ANSWER AT THREE LEVELS, and do not stop at the first.`,
      `1. The immediate thing. What to do about what was asked, concretely.`,
      `2. What follows from it. What this implies for the plan, for the next session, for`,
      `   what the technician needs, for what a supervisor or a payer will read. If it`,
      `   implies nothing beyond itself, say so rather than padding.`,
      `3. What you would want to know. Name what is missing from the record that would`,
      `   change your answer, and say how it would change it.`,
      ``,
      `A clinician asking this has already thought of the obvious move. The value is in`,
      `the second and third levels, so treat a one-line answer as a sign you have not`,
      `finished thinking rather than as brevity.`,
      ``,
      `GROUND EVERY CLAIM in what is already in this conversation. Levels 2 and 3 are`,
      `where fabrication becomes tempting: an implication you cannot trace to something`,
      `stated is a guess, so mark it as a question rather than asserting it. If the input`,
      `does not support a recommendation at all, say what is missing instead of inventing`,
      `one. Where the stored judgement above conflicts with the input, follow the input and`,
      `say plainly which entry you set aside and what overruled it.`,
    ].filter(Boolean).join("\n");

    setLoading(true);
    try {
      const conversation = [...S.conversation, { role: "user", content: userMsg }];
      // No response schema: this turn is advice, not a note, so constraining it
      // to the note's shape would force it back into sections.
      // generateProse, not generateConversation: advice is not the note JSON,
      // and the note path would parse it, fail, and resample the same request.
      const r = await NotesGate.generateProse({
        ...systemFor(S.convStyleBlock),
        messages: conversation,
        tool: tool.id,
        // Three levels do not fit in the old one-paragraph budget, and a reply
        // truncated mid-thought reads as exactly the shallowness this fixes.
        maxTokens: 2000,
        wantOpinions: true,
      });
      /* TWO VERSIONS ON PURPOSE. The conversation keeps the model's own words,
         tokens and all, because it is replayed verbatim on the next turn and a
         restored word would both change the cached prefix and hand the model a
         name it was never given. The clinician reads the restored one. */
      const advice = (r.text || "").trim();
      conversation.push({ role: "assistant", content: advice });
      patchS({ conversation, lastCallAt: Date.now(), annotation: null, error: "" });
      audit("recommendation", { requested: 1, scoped: section ? 1 : 0 });
      const adviceForReader = NotesScrub.restoreOutput(advice, scrubMapRef.current);
      pushThread("assistant", "answer", adviceForReader || "I do not have enough in this note to suggest anything.");
    } catch (e) {
      patchS({ error: NotesGate.displayError(e) });
      pushThread("assistant", "status", "That didn't go through. " + NotesGate.displayError(e));
      reportError(tool.id, e);
    } finally {
      setLoading(false);
    }
  };

  const sendRevision = async (instruction) => {
    const review = await scrubGate(instruction, { carryOver: true });
    if (!review) return;
    const scrubbedInstruction = NotesScrub.applyMap(instruction, review.map);
    const ann = S.annotation;
    const section = ann ? tool.formSections.find((s) => sectionId(s) === ann.id) : null;

    // Only the typed instruction is NEW free text - scan/scrub that. The section
    // body is AI output already present verbatim in the conversation history (or
    // the clinician's own edit of it), so re-scanning it would flag words in the
    // generated prose ("Analyst", role tokens) on every single revision.
    let userMsg;
    if (section && ann.kind === "span") {
      userMsg = [
        `REVISION REQUEST`,
        `Target section: "${section.heading}" (JSON key: ${ann.id})`,
        `The clinician highlighted this phrase inside that section:`,
        `"${ann.text}"`,
        ``,
        `Current content of that section as shown to them (may include manual edits):`,
        sectionBody(section, S.output, S.values),
        ``,
        `Instruction: ${scrubbedInstruction}`,
        ``,
        `Change the highlighted phrase and only what the instruction requires around it; leave the rest of the section as written. Return the COMPLETE updated JSON object with ALL keys, copying every other section verbatim. Re-evaluate "hints". Never fabricate - if the instruction asks for information not present anywhere in this conversation, leave it out and emit the appropriate hint instead.`,
      ].join("\n");
    } else if (section) {
      userMsg = [
        `REVISION REQUEST`,
        `Target section: "${section.heading}" (JSON key: ${ann.id})`,
        `Current content of that section as shown to the clinician (may include their manual edits):`,
        sectionBody(section, S.output, S.values),
        ``,
        `Instruction: ${scrubbedInstruction}`,
        ``,
        `Return the COMPLETE updated JSON object with ALL keys. Re-evaluate "hints" for the whole note. Never fabricate - if the instruction asks for information not present anywhere in this conversation, leave it out and emit the appropriate hint instead.`,
        ``,
        // The clinician pointed at one section, but an instruction routinely
        // belongs partly somewhere else. Silently dropping that half is how a
        // correction gets lost, so the model changes what it needs to and
        // declares it.
        // Both rules apply whether or not a section was pointed at: a question
        // is just as likely typed into an empty panel as onto a section.
        REVISION_RULES,
        `The clinician pointed at ONE section. If the instruction also requires changing a DIFFERENT section, make that change too and list every such section in "crossSection".`,
        `Set "confident": true ONLY when the instruction names that section, or names content that appears in that section and nowhere else. Anything you inferred, guessed at, or judged stylistically consistent is "confident": false. A false is not a failure; it asks the clinician, which is the correct outcome when it is genuinely their call.`,
        `"why" is one short clause the clinician will read, naming what in their instruction sent the change there.`,
        `Leave "crossSection" empty and copy every other section verbatim when the instruction only concerns the section they pointed at.`,
      ].join("\n");
    } else if (ann && ann.kind === "quote") {
      // They pointed at something that was SAID rather than at a section. The
      // quote is context for the instruction, not a target: which sections move
      // is worked out from the instruction, as it is for any untargeted change.
      userMsg = [
        `REVISION REQUEST`,
        `The clinician pointed at this, from earlier in this conversation:`,
        `"${ann.text}"`,
        ``,
        `Instruction: ${scrubbedInstruction}`,
        ``,
        `Read the instruction as being ABOUT that quote. It is a pointer into this conversation, not content to copy into the note and not a section name.`,
        ``,
        REVISION_RULES,
        ``,
        `Return the COMPLETE updated JSON object with ALL keys; copy unaffected sections verbatim. Re-evaluate "hints". Never fabricate beyond what is stated.`,
      ].join("\n");
    } else {
      userMsg = [
        `ADDITIONAL DETAILS / CORRECTIONS from the clinician:`,
        scrubbedInstruction,
        ``,
        REVISION_RULES,
        ``,
        `Apply these to every affected section. Return the COMPLETE updated JSON object with ALL keys; copy unaffected sections verbatim. Re-evaluate "hints". Never fabricate beyond what is stated.`,
      ].join("\n");
    }

    setLoading(true);
    try {
      const conversation = [...S.conversation, { role: "user", content: userMsg }];
      // The same block the draft was written with, not whatever the card says
      // now - this replays a cached prefix and must match it byte for byte.
      const r = await runTurn(conversation, S.convStyleBlock || "");
      conversation.push({ role: "assistant", content: r.rawText });
      const normalized = finalOutput(r.parsed);
      const targetId = ann ? ann.id : null;

      /* Cross-section routing.
       *
       * This line used to be `if (targetId && id !== targetId) return;`, which
       * threw away every change the model made outside the section that was
       * clicked. That is how a correction got lost: you say "and shorten the
       * lesson narrative too" while pointing at Behavior, the model does it,
       * and the engine drops it on the floor without telling anyone.
       *
       * His ruling, 2026-08-04: apply the part that fits, and for the rest,
       * act automatically when the model is confident (with an undo) and ask
       * otherwise. So a confident cross-section change joins the same proposal
       * as the targeted one - it renders as an inline diff and Discard is the
       * undo - and an unconfident one becomes a question in the panel.
       *
       * Every tool reports crossSection as of 2026-08-30; the four BCBA tools
       * gained it with their schemas, and each one's normalizeOutput hands it
       * on. A tool that reported nothing here still degraded safely, because an
       * unrouted change asks rather than applies - silence must never read as
       * confidence - but it degraded silently, which is why the tools now say
       * so explicitly rather than relying on the fallback.
       */
      const routing = new Map(
        (normalized.crossSection || []).map((c) => [c.section, c]),
      );
      const changes = [];
      const asks = [];
      tool.formSections.filter(isModelSection).forEach((sec) => {
        const id = sectionId(sec);
        if (valuesEqual(normalized[id], S.output[id])) return;
        const change = {
          id, heading: sec.heading, kind: sec.kind, columns: sec.columns,
          value: normalized[id], prev: S.output[id],
        };
        if (!targetId || id === targetId) { changes.push(change); return; }
        const route = routing.get(id);
        if (route && route.confident) changes.push({ ...change, why: route.why });
        else asks.push({ ...change, why: route ? route.why : "" });
      });
      /* A question, answered. No proposal, no diff, nothing touched in the
         note: the reply goes into the panel where the rest of the conversation
         lives. Checked before the changes are applied, because a model that
         answers AND edits should still not edit. */
      /* Something they were unsure about, worth putting to the BCBA. Offered,
         never applied: the technician decides whether it goes in their note.
         It rides alongside an answer rather than replacing one, because "I do
         not know either, shall we ask?" is a legitimate reply. */
      const bcbaQuestion = String(normalized.bcbaQuestion || "").trim();

      const answer = String(normalized.answer || "").trim();
      if (answer) {
        patchS({
          conversation, lastCallAt: Date.now(), annotation: null,
          proposal: null, routingAsks: null, error: "",
        });
        audit("revision", { answered: 1, kind: ann ? ann.kind : "global" });
        pushThread("assistant", "answer", answer);
        if (bcbaQuestion) patchS({ bcbaOffer: bcbaQuestion });
        return;
      }
      if (bcbaQuestion) patchS({ bcbaOffer: bcbaQuestion });

      const carried = changes.filter((c) => c.id !== targetId);
      patchS({
        conversation,
        lastCallAt: Date.now(),
        annotation: null,
        proposal: { changes, hints: normalized.hints || [], targetSectionId: targetId, kind: ann ? ann.kind : "global" },
        routingAsks: asks.length ? asks : null,
        error: "",
      });
      audit("revision", {
        requested: 1, sections: changes.length, kind: ann ? ann.kind : "global",
        carried: carried.length, asked: asks.length,
      });
      pushThread(
        "assistant",
        "status",
        changes.length
          ? (changes.length === 1
              ? `Updated “${changes[0].heading}” - the change is highlighted in the note.`
              : `Updated ${changes.length} sections - the changes are highlighted in the note.`)
          : asks.length
            ? "That reads as belonging to a different section. See below."
            : "No change was needed for that - the note already reflects it, or the detail isn't in your notes."
      );
      // Name what was carried past the section they clicked, and why. Applying
      // it quietly would be the same content-routing problem in reverse: the
      // note changes somewhere they were not looking.
      if (carried.length) {
        pushThread(
          "assistant",
          "status",
          `That also changed ${carried.map((c) => "“" + c.heading + "”").join(" and ")}, because ` +
            (carried[0].why || "the instruction reached that section") +
            ". Discard reverts all of it.",
        );
      }
    } catch (e) {
      patchS({ error: NotesGate.displayError(e) });
      pushThread("assistant", "status", "That didn't go through. " + NotesGate.displayError(e));
      reportError(tool.id, e);
    } finally {
      setLoading(false);
    }
  };

  // One entry point for the panel's Send button: it either answers the pending
  // triage questions or asks for a revision, depending on where we are.
  const handlePanelSend = async () => {
    const text = S.panelDraft.trim();
    if (!text || loading) return;
    patchS({ panelDraft: "" });
    pushThread("user", "answer", text);

    /* Feedback about the tool rather than about the note. Sending it to the note
       model would produce a revision nobody asked for, so it offers to file it.

       Two ways to land here. Pointing at page furniture says it by where you
       clicked. Saying "stub" says it in words, for the case his ruling names:
       "when it can't tell if I am giving feedback on the page or the content."
       The word wins wherever it appears, including on a section he pointed at,
       because a guess about intent is exactly what the keyword exists to end. */
    const saysStub = /\bstubs?\b/i.test(text);
    const pointedAtPage = !!(S.annotation && S.annotation.kind === "page");
    if (pointScope === "page" && (saysStub || pointedAtPage)) {
      const target = (S.annotation && (S.annotation.text || S.annotation.heading)) || "";
      patchS({ annotation: null, ticketOffer: { note: text, target } });
      pushThread("assistant", "status", pointedAtPage
        ? "That reads as feedback about the tool rather than the note. Want it filed as a stub you can grill later?"
        : "You said stub, so I am reading that as feedback about the tool rather than a change to the note. File it?");
      return;
    }
    if (S.questions && S.questions.length) {
      // Same note, later turn. The answers are appended to the intake the draft
      // is built from, so their tokens have to survive to the draft and past it.
      //
      // The suggestions they left standing go through the SAME gate as the text
      // they typed, in one string, so an edited one cannot skip the check and a
      // name typed into either is caught once.
      const taken = acceptedSuggestions();
      const said = [...taken, text].filter((x) => x && x.trim()).join("\n");
      const review = await scrubGate(said, { carryOver: true });
      if (!review) return;
      audit("gap_questions", {
        answered: S.questions.length,
        suggestionsTaken: taken.length,
        round: S.triageRound || 1,
      });

      const answered = [S.triageAnswers, NotesScrub.applyMap(said, review.map)]
        .filter((x) => x && x.trim()).join("\n");
      const round = (S.triageRound || 1) + 1;

      // Ask again only while there is room, and only if something is genuinely
      // still missing. A round that comes back empty drafts immediately.
      if (round <= MAX_TRIAGE_ROUNDS) {
        setLoading(true);
        let more = [];
        let readiness = null;
        try {
          const triage = await runTriage(S.pendingValues, answered);
          more = triage.questions;
          readiness = triage.readiness;
        } catch (e) {
          // Triage is an assist, not a gate. Losing a follow-up question is a
          // far smaller harm than refusing to draft.
          reportError(tool.id, e);
        }
        setLoading(false);
        if (more.length) {
          audit("gap_questions", { asked: more.length, round, readiness, ...barsFor(more) });
          // Re-read each round rather than carried forward: answering two of
          // three questions is exactly the case where the note got closer, and
          // the wait should shorten to match.
          patchS({ questions: more, readiness, triageAnswers: answered, triageRound: round, suggestState: {} });
          return;
        }
      }
      patchS({ triageAnswers: "", triageRound: 0, suggestState: {} });
      await draftNote(S.pendingValues, answered);
      return;
    }
    if (!S.output) {
      pushThread("assistant", "status", "Generate the note first, then I can revise it.");
      return;
    }
    await sendRevision(text);
  };

  /* Only the owner ever captures, so for everyone else this stays 0 and the
     control never renders. Read from localStorage rather than tracked in React
     state, because capture happens inside emitStyle and both call sites are
     already doing enough. */
  const [pairCount, setPairCount] = React.useState(0);
  React.useEffect(() => {
    const read = () => setPairCount(window.VoiceCapture?.stats?.().pending || 0);
    read();
    const t = setInterval(read, 4000);
    return () => clearInterval(t);
  }, []);

  const targetSection = (annotation) => {
    patchS({ annotation });
    setPanelOpen(true);
  };

  /* ── Acting on a correction ───────────────────────────────────────────
     Every handler here rewrites the affected section from the marks, rather
     than editing the note text directly. The marks are the record of what the
     pass proposed; the note is derived from them and from the decisions. Doing
     it the other way round would make an undo unreachable the moment anything
     else touched the section. */
  const applyMarkState = (nextState) => {
    patchS((st) => {
      if (!st.corrections) return { markState: nextState };
      return {
        markState: nextState,
        output: { ...st.output, ...NoteCorrections.outputFor(st.corrections.sections, nextState) },
      };
    });
  };

  const toggleCorrection = (key) => {
    if (!S.corrections) return;
    const next = NoteCorrections.toggle(S.corrections.sections, S.markState, key);
    audit("corrections_mark", { undone: next[key] && next[key].reverted ? 1 : 0, restored: next[key] && next[key].reverted ? 0 : 1 });
    applyMarkState(next);
  };

  const editCorrection = (key, text) => {
    if (!S.corrections) return;
    audit("corrections_mark", { edited: 1 });
    applyMarkState(NoteCorrections.edit(S.markState, key, text));
  };

  /* Clearing a section's marks does NOT revert anything. The note already reads
     the way the marks say it does, and this is the only way back to a plain
     editable textarea, which is what a technician wants the moment they would
     rather type than click.

     One section at a time, because the button sits in that section and a
     control that quietly clears the marks in three other sections would be
     lying about what it does. */
  const dismissCorrections = (id) => {
    patchS((st) => {
      if (!st.corrections || !st.corrections.sections[id]) return {};
      const marks = st.corrections.marks.filter((m) => m.id !== id);
      const mine = st.corrections.marks.filter((m) => m.id === id);
      const kept = mine.filter((m) => !(st.markState[m.key] && st.markState[m.key].reverted)).length;
      audit("corrections_done", { kept, undone: mine.length - kept });
      if (!marks.length) return { corrections: null, markState: {} };
      const sections = {};
      Object.keys(st.corrections.sections).forEach((k) => {
        if (k !== id) sections[k] = st.corrections.sections[k];
      });
      const markState = {};
      Object.keys(st.markState).forEach((k) => {
        if (!k.startsWith(id + ":")) markState[k] = st.markState[k];
      });
      return {
        corrections: { ...st.corrections, sections, marks, changed: Object.keys(sections), count: marks.length },
        markState,
      };
    });
  };

  /* The blue dot on a moved sentence leads back to where it came from. Scroll
     plus a flash rather than scroll alone: a section that was already on screen
     would otherwise answer the click with nothing at all. */
  const goToOrigin = (originId) => {
    const el = document.querySelector('[data-section-key="' + originId + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("cx-flash");
    void el.offsetWidth;
    el.classList.add("cx-flash");
  };

  const acceptProposal = () => {
    if (!S.proposal) return;
    audit("revision", { accepted: 1, sections: S.proposal.changes.length, kind: S.proposal.kind || "section" });

    // An accepted revision is style evidence: the technician asked for a change
    // and kept the result, so the difference is what they wanted. Measured
    // across the narrative sections only - a checklist tick has no prose to
    // learn from.
    const narrative = new Set(narrativeIds());
    const changed = S.proposal.changes.filter((c) => narrative.has(c.id));
    emitStyle(
      changed.map((c) => String(S.output?.[c.id] || "")).join("\n\n"),
      changed.map((c) => String(c.value || "")).join("\n\n"),
      "revision",
    );

    patchS((s) => {
      const next = { ...s.output };
      s.proposal.changes.forEach((c) => { next[c.id] = c.value; });
      next.hints = s.proposal.hints;
      return { output: next, proposal: null };
    });
  };

  /* A change the revision made outside the section that was clicked, which the
     model would not vouch for. Taking it folds it into the same proposal, so it
     renders as an inline diff and Discard reverts it like anything else.

     Declining does NOT delete it. His ruling: rejected text stays in the
     conversation so it can be reused, which means the panel is where it lives
     rather than a variable nobody can reach. */
  /* Accepting the offer puts the question in the note, in the section that
     already exists to carry questions for the BCBA. It goes through the same
     proposal and Accept/Discard path as any other change, so it is visible and
     reversible rather than silently appended.

     IT IS NEVER TRANSMITTED. Not to the maintainer, not by email, not through
     any route. It becomes text in the note the technician copies into their
     EHR, and whichever BCBA supervises them reads it there. His correction on
     2026-08-04: "this goes in the text for them to copy (note output). but is
     not sent to me in the system. eventually there may be other bcbas' bts
     using this so it shouldn't come to me at all in that case." Anything that
     routed this to a person would break the moment a second BCBA exists.

     NOT ticked into Action Items for BCBA: that list is his EHR's closed set
     and has no option meaning "the technician has a question". Forcing the
     nearest one ("Contact staff") into a clinical record would be worse than
     leaving it to normal inference. */
  const FOLLOWUP_KEY = "followUpNarrative";
  const ACTION_KEY = "actionItems";

  // The checkbox that says a question is waiting. The label is read off the
  // tool's own option list, so the EHR owns the wording.
  const bcbaActionTick = (output) => {
    const sec = (tool.formSections || []).find((x) => sectionId(x) === ACTION_KEY);
    const label = ((tool.groupOptions || {})[ACTION_KEY] || []).find((o) => /contact staff/i.test(o));
    if (!sec || !label || !output) return null;
    const prev = Array.isArray(output[ACTION_KEY]) ? output[ACTION_KEY] : [];
    if (prev.includes(label)) return null;
    return {
      id: ACTION_KEY, heading: sec.heading, kind: sec.kind, prev,
      value: prev.filter((v) => !/^none$/i.test(String(v))).concat([label]),
    };
  };

  /* Feedback about the TOOL, filed while he is looking at it.
     His ask: as an admin, "I hate that the page does this" should become a stub
     he can grill into a proper dev item later, rather than something he has to
     remember afterwards. Offered only to an admin, and only when they pointed
     at page furniture rather than at the note, because that is the gesture that
     already means "this is about the page". */
  const fileTicket = async () => {
    const t = S.ticketOffer;
    if (!t || S.ticketFiling) return;
    patchS({ ticketFiling: true });
    try {
      const res = await fetch(NotesGate.apiUrl("/api/admin/ticket"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + NotesGate.token() },
        body: JSON.stringify({ note: t.note, where: location.pathname, target: t.target || "" }),
      });
      const data = await res.json().catch(() => ({}));
      patchS({ ticketOffer: null, ticketFiling: false });
      pushThread("assistant", "status", res.ok && data.ok
        ? "Filed as issue #" + data.number + ". It is labelled a stub, so nobody builds it before you have grilled it."
        : "Could not file it: " + (data.error || "the request failed") + " Nothing was lost, it is still above in this conversation.");
    } catch (e) {
      patchS({ ticketFiling: false });
      pushThread("assistant", "status", "Could not reach the ticket route. Nothing was lost, it is still above in this conversation.");
    }
  };

  const dismissTicket = () => patchS({ ticketOffer: null });

  const takeBcbaQuestion = () => {
    const q = (S.bcbaOffer || "").trim();
    if (!q || !S.output) return;
    const sec = tool.formSections.find((x) => x.key === FOLLOWUP_KEY);
    if (!sec) { patchS({ bcbaOffer: "" }); return; }

    const current = String(S.output[FOLLOWUP_KEY] || "").trim();
    // A default "nothing to report" line is replaced rather than contradicted.
    const isDefault = /^no new questions or concerns/i.test(current);
    const next = (!current || isDefault) ? q : current + " " + q;

    const changes = [{ id: FOLLOWUP_KEY, heading: sec.heading, kind: sec.kind, value: next, prev: S.output[FOLLOWUP_KEY] }];
    // A question for the BCBA is an action item, so the box gets ticked with it.
    const tick = bcbaActionTick(S.output);
    if (tick) changes.push(tick);

    audit("revision", { bcba_question_added: 1 });
    patchS((st) => ({
      bcbaOffer: "",
      proposal: st.proposal
        ? { ...st.proposal, changes: [...st.proposal.changes, ...changes] }
        : { changes, hints: st.output?.hints || [], targetSectionId: FOLLOWUP_KEY, kind: "bcba" },
    }));
    pushThread("assistant", "status", tick
      ? "Added to \u201c" + sec.heading + "\u201d and ticked \u201c" + tick.value[tick.value.length - 1] + "\u201d. Both are highlighted in the note."
      : "Added to \u201c" + sec.heading + "\u201d. It is highlighted in the note.");
  };

  const dismissBcbaQuestion = () => {
    audit("revision", { bcba_question_declined: 1 });
    patchS({ bcbaOffer: "" });
  };

  const takeRoutedChange = (ask) => {
    audit("revision", { routed_accepted: 1 });
    patchS((s) => ({
      proposal: s.proposal
        ? { ...s.proposal, changes: [...s.proposal.changes, ask] }
        : { changes: [ask], hints: s.output?.hints || [], targetSectionId: null, kind: "routed" },
      routingAsks: (s.routingAsks || []).filter((a) => a.id !== ask.id).length
        ? (s.routingAsks || []).filter((a) => a.id !== ask.id)
        : null,
    }));
    pushThread("assistant", "status", `Added to “${ask.heading}”. It is highlighted in the note.`);
  };

  const leaveRoutedChange = (ask) => {
    audit("revision", { routed_declined: 1 });
    patchS((s) => ({
      routingAsks: (s.routingAsks || []).filter((a) => a.id !== ask.id).length
        ? (s.routingAsks || []).filter((a) => a.id !== ask.id)
        : null,
    }));
    // The wording itself, kept where it can be read and reused. Dropping it is
    // the content loss this whole feature exists to stop.
    const text = Array.isArray(ask.value) ? ask.value.join(", ") : String(ask.value || "");
    pushThread("assistant", "answer", `Left “${ask.heading}” alone. What it would have said:\n\n${text}`);
  };

  const discardProposal = () => {
    if (S.proposal) audit("revision", { discarded: 1, sections: S.proposal.changes.length, kind: S.proposal.kind || "section" });
    patchS({ proposal: null });
  };

  const pendingChangeFor = (id) =>
    (S.proposal && S.proposal.changes.find((c) => c.id === id)) || null;

  /* THE COPY-PROMPT PATH IS FOR LOGGED-OUT VISITORS ONLY.
     His refinement of 2026-08-04: "If someone is not logged in, they get a
     basic-ass prompt from the copy prompt button. if you log in, it is
     generate-in-place."

     That resolves the fork cleanly, and better than removing it did. A
     logged-out visitor cannot reach the Worker at all, so a labelled prompt to
     paste elsewhere is the only value the page can give them - and because they
     are not authenticated, there was never any question of the voice block
     reaching them. Nothing leaks, because nothing is composed.

     Signed in, the button is gone and Generate Note is the only route, which is
     what makes it true that no authenticated output can bypass his voice. */
  const handleGeneratePrompt = async () => {
    const err = tool.validate(S.values);
    if (err) { patchS({ error: err }); return; }
    patchS({ error: "" });
    // Carries over so pressing this mid-note cannot clobber the live map and
    // strand the tokens already sitting in the open draft. On a fresh page there
    // is nothing to carry and it behaves exactly as it did.
    const review = await scrubGate(collectFreeText(), { carryOver: true });
    if (!review) return;
    patchS({ promptText: tool.buildLabeledPrompt(scrubValues(review.map)) });
    setCopiedPrompt(false);
  };

  /* The signed-in half of this path is gone on the same ruling: Generate Note
     already produces the note through the Worker with the voice, the stances and
     the obligations, so a second signed-in button could only produce a worse
     result. tool.buildLabeledPrompt() keeps a production caller through the
     logged-out branch above, so it is not dead code and sap-register.spec.js
     still guards the surface it builds. */

  const handleCopyAll = () => {
    if (!S.output) return;
    navigator.clipboard.writeText(tool.formSections.map((sec) => sectionBlock(sec, S.output, S.values)).join("\n\n"));
    setCopied("all");
    setTimeout(() => setCopied(null), 1800);
  };

  /* ── Clear / reset ─────────────────────────────────────────────────── */

  // True when the active tool holds anything worth confirming before wiping -
  // typed input, a generated note, or a built prompt. Drives whether Clear shows
  // and whether it double-checks first.
  // A toggle sitting on its default is not content - it is the state a fresh
  // page starts in, and counting it would show Clear before anything is typed.
  const hasContent = () =>
    tool.inputs.some((f) =>
      f.type === "toggle"
        ? S.values[f.id] != null && S.values[f.id] !== f.defaultValue
        : (S.values[f.id] || "").trim() !== ""
    ) || !!S.output || !!S.promptText;

  // One-click reset for the next use. Wipes this tool's saved draft, then rebuilds
  // a blank session (freshSession reloads the now-empty draft). Autosave keeps the
  // note across an accidental reload; this is the deliberate "start fresh" escape.
  const handleClear = () => {
    if (loading) return;
    if (hasContent() && !window.confirm("Clear this tool's inputs and generated note to start fresh? This can't be undone.")) return;
    if (window.NotesGate) NotesGate.draft.clear(tool.id);
    setSessions((prev) => ({ ...prev, [tool.id]: freshSession(tool) }));
    setCopied(null);
    setCopiedPrompt(false);
  };

  /* ── Note-freshness countdown ──────────────────────────────────────── */

  // Visible once a note exists, counting down the ~5-minute warm window from the
  // last call. Each generation/revision resets it (lastCallAt updates). At zero it
  // just rests - revisions still work, they only re-process the conversation once.
  // Read the live clock here (nowTick above is only the 1s re-render heartbeat) and
  // clamp to the window so a throttled/backgrounded tab can never show over 5:00.
  let cacheRemaining = null;
  if (S.output && S.lastCallAt) {
    const idleS = Math.max(0, Math.floor((Date.now() - S.lastCallAt) / 1000));
    cacheRemaining = Math.min(CACHE_WINDOW_S, CACHE_WINDOW_S - idleS);
  }

  /* ── Render helpers ────────────────────────────────────────────────── */

  const toggleExpand = (i) =>
    patchS((s) => ({ expanded: s.expanded.includes(i) ? s.expanded.filter((x) => x !== i) : [...s.expanded, i] }));

  const renderInput = (f) => {
    if (f.type === "toggle") {
      return (
        <div key={f.id} style={{ marginBottom: 20 }}>
          <p style={lbl}>{f.label}</p>
          {/* wraps because a toggle is not always two options - BT's
              place-of-service has five and must not overflow on mobile */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {f.options.map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => setValue(f.id, opt.value)}
                style={{
                  padding: "8px 18px", borderRadius: 8,
                  border: S.values[f.id] === opt.value ? "2px solid #374528" : "1.5px solid #c0d4a8",
                  background: S.values[f.id] === opt.value ? "#374528" : "white",
                  color: S.values[f.id] === opt.value ? "white" : "#374528",
                  fontFamily: "inherit", fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      );
    }
    return (
      <TextareaField
        key={f.id}
        field={f}
        value={S.values[f.id]}
        onChange={(val) => setValue(f.id, val)}
      />
    );
  };

  // A proposed change rendered where it belongs: inside the section it changes,
  // marked against what is there now. Accept/Discard act on the whole proposal -
  // a revision can touch more than one section, and applying half of one would
  // leave the note in a state the model never produced.
  const renderPendingChange = (change) => {
    const count = S.proposal.changes.length;
    return (
      <div style={{ marginTop: 10 }}>
        {change.kind === "narrative" ? (
          <div className="diff-view">
            {NoteDiff.words(change.prev || "", change.value || "").map((op, i) =>
              op.type === "same"
                ? <span key={i}>{op.text}</span>
                : <span key={i} className={op.type === "ins" ? "diff-ins" : "diff-del"}>{op.text}</span>
            )}
          </div>
        ) : (
          <div className="diff-view">
            {change.kind === "table"
              ? <GoalsTable columns={change.columns} rows={change.value} onChange={() => {}} idPrefix={"prop-" + change.id} />
              : <Checklist options={tool.groupOptions[change.id]} selected={change.value} single={change.kind === "single"} />}
          </div>
        )}
        <div className="diff-actions">
          <button type="button" className="diff-accept" onClick={acceptProposal}>
            {count > 1 ? `Accept all ${count}` : "Accept"}
          </button>
          <button type="button" className="diff-discard" onClick={discardProposal}>Discard</button>
          <p className="diff-note">
            {count > 1 ? `${count} sections changed - accepting applies them together.` : "Green is added, struck-through is removed."}
          </p>
        </div>
      </div>
    );
  };

  const renderSectionContent = (sec) => {
    const id = sectionId(sec);
    const v = S.output[id];
    const pending = pendingChangeFor(id);
    if (pending) return renderPendingChange(pending);
    if (sec.kind === "narrative") {
      /* A section the corrections pass changed is drawn as marks rather than as
         a textarea, because a textarea cannot carry a strikethrough. The marks
         are already in the note, so this is a view of what it says and not a
         thing waiting to be accepted. "Edit by hand" is how the box comes back. */
      const marked = S.corrections && S.corrections.sections[id];
      if (marked) {
        return (
          <React.Fragment>
            <CorrectionsView
              id={id}
              ops={marked}
              marks={{ why: (S.corrections.marks.find((m) => m.id === id) || {}).why || "" }}
              state={S.markState}
              headings={correctionHeadings}
              onToggle={toggleCorrection}
              onEdit={editCorrection}
              onGoToOrigin={goToOrigin}
            />
            <button
              type="button"
              className="cx-done"
              data-corrections-done={id}
              onClick={() => dismissCorrections(id)}
              title="Put the marks away and edit this section as text. Nothing is undone."
            >
              Edit by hand
            </button>
          </React.Fragment>
        );
      }
      const empty = !(v || "").trim();
      return (
        <textarea
          value={v || ""}
          // Selecting inside one of these is what raises the "Revise this" chip;
          // the attributes are how the selection handler knows which section it
          // is in without threading refs through every row.
          data-section-id={id}
          data-section-heading={sec.heading}
          onChange={(e) => patchS((s) => ({ output: { ...s.output, [id]: e.target.value } }))}
          placeholder={sec.emptyNote || ""}
          // Sized to the prose rather than to a fixed box: at full width these
          // no longer need an internal scrollbar to show four sentences, which
          // is what made them feel like the smallest thing on the page.
          rows={Math.max(3, Math.ceil((v || "").length / 105) + 1)}
          style={{ width: "100%", minHeight: sec.minHeight || 84, padding: "11px 12px", borderRadius: 7, border: "1px solid #c0d4a8", fontSize: 14.5, color: "#2d3a1f", lineHeight: 1.7, resize: "vertical", background: "white", opacity: empty ? 0.75 : 1 }}
        />
      );
    }
    if (sec.kind === "single") {
      return <Checklist options={tool.groupOptions[sec.group]} selected={v} single />;
    }
    if (sec.kind === "checklist") {
      return (v && v.length)
        ? <Checklist options={tool.groupOptions[sec.group]} selected={v} sectionId={id} />
        : <p style={{ fontSize: 13, color: "#9aab86", fontStyle: "italic" }}>{sec.emptyNote || "No options suggested - leave blank or review your notes."}</p>;
    }
    if (sec.kind === "table") {
      return (
        <GoalsTable
          columns={sec.columns}
          rows={v}
          onChange={(rows) => patchS((s) => ({ output: { ...s.output, [id]: rows } }))}
          onCopyCell={handleCopy}
          copiedId={copied}
          idPrefix={id}
        />
      );
    }
    if (sec.kind === "facts") {
      return <FactRows rows={sec.rows} output={S.output} values={S.values} />;
    }
    return null;
  };

  /* ── Layout ────────────────────────────────────────────────────────── */

  // Selecting a phrase inside a narrative raises a chip that targets just that
  // phrase - the same gesture as annotating a document.
  /* ── Point at anything ──────────────────────────────────────────────────
     His note: clicking only worked where a yellow bar already said it would,
     which is clunky next to Lavish where you can click anything. Point mode is
     the answer, and the scope is by role, his call: an admin can point at the
     whole page including labels, help text and buttons, because that is where
     their feedback about the TOOL comes from. Everyone else points at note
     content only, so a technician cannot ask NoMe to revise a heading.

     A click inside a section resolves to that section, so pointing lands in the
     existing revision flow rather than a parallel one. A click anywhere else is
     about the page, and says so. */
  /* Read at render rather than held in state, so a login or a logout moves it
     on the next paint. `loggedIn` is what forces that paint. Two things read it:
     the point scope below, and whether Copy All comes back on a tool that hides
     it. */
  const isAdmin = !!(window.NotesGate && NotesGate.isAdmin && NotesGate.isAdmin());
  const pointScope = isAdmin ? "page" : "note";
  const [pointMode, setPointMode] = React.useState(false);

  // Leaving point mode armed across a logout would let a technician inherit an
  // admin's whole-page scope.
  React.useEffect(() => { if (!loggedIn) setPointMode(false); }, [loggedIn]);

  React.useEffect(() => {
    if (!pointMode) return;

    // Never let the assistant's own furniture become a target: pointing at the
    // pill to turn pointing off would otherwise capture the pill.
    /* Only the toggle. His ruling of 2026-08-05 opened the rest of the assistant
       up: conversation text so a message can be about what was said, and the
       panel itself so a bug in it can be reported from inside it. The toggle
       stays out because turning pointing OFF has to remain possible while
       pointing is on. Everything else in there is one click, and that click
       disarms the mode anyway. */
    const OURS = ".point-toggle, [data-revise-chip], #eb-backdrop, #notes-login-backdrop, noaba-bar";
    const eligible = (el) => {
      if (!el || !el.closest || el.nodeType !== 1) return false;
      if (el.closest(OURS)) return false;
      if (pointScope === "page") return true;
      return !!el.closest("[data-section-key]");
    };

    let hovered = null;
    const clearHover = () => {
      if (hovered) hovered.classList.remove("point-hover");
      hovered = null;
    };
    const onOver = (e) => {
      const el = e.target;
      if (hovered === el) return;
      clearHover();
      if (!eligible(el)) return;
      el.classList.add("point-hover");
      hovered = el;
    };

    // Capture phase, and preventDefault: while pointing, a click means "this is
    // what I am talking about", not "press this button". Without that, pointing
    // at Generate Note would generate a note.
    const onClick = (e) => {
      const el = e.target;
      // Our own controls keep working: turning pointing off has to be possible
      // while pointing is on.
      if (!el || !el.closest || el.closest(OURS)) return;

      // Everything else is swallowed, in scope or not. Out of scope used to
      // fall through, so a technician who armed pointing and clicked Generate
      // Note generated a note. Arming a mode and then having a button fire is
      // the wrong surprise; an out-of-scope click should simply do nothing and
      // leave pointing armed so they can try again.
      e.preventDefault();
      e.stopPropagation();
      if (!eligible(el)) return;

      clearHover();
      setPointMode(false);

      const card = el.closest("[data-section-key]");
      if (card && card.getAttribute("data-revisable") === "true") {
        targetSection({
          kind: "section",
          id: card.getAttribute("data-section-key"),
          heading: card.getAttribute("data-section-title") || "",
        });
        return;
      }

      // A turn in the conversation refers to what was SAID, not to the tool and
      // not to a section. It carries the quoted words and leaves the message on
      // its ordinary path, so "do what you said there" still revises the note.
      const turn = el.closest("[data-thread-turn]");
      if (turn) {
        const said = (turn.textContent || "").trim().replace(/\s+/g, " ");
        targetSection({
          kind: "quote",
          id: "quote",
          heading: turn.getAttribute("data-thread-turn") || "",
          text: said.slice(0, 300),
        });
        return;
      }

      // Anything else is feedback about the page, the assistant panel included.
      // Carry a short, readable description rather than a selector: it is what
      // the clinician sees, and what makes the message make sense read back.
      // A container's textContent is the whole page, which records nothing
      // useful and drags the assistant's own chrome in with it. Take what the
      // element itself says: its explicit label, then its own text nodes, then
      // the first heading or control inside it.
      const flat = (t) => (t || "").trim().replace(/\s+/g, " ");
      const ownText = flat(Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "));
      // Headings only. Any control inside a container would do: on a form-heavy
      // page the first one is arbitrary, and "5:00" says less than nothing.
      const heading = el.querySelectorAll
        ? Array.from(el.querySelectorAll("h1, h2, h3")).find((n) => !n.closest(OURS))
        : null;
      const label =
        (el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder"))) ||
        ownText ||
        (heading ? flat(heading.textContent) : "") ||
        (el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""));
      targetSection({
        kind: "page",
        id: "page:" + (el.id || el.className || el.tagName.toLowerCase()),
        heading: card ? (card.getAttribute("data-section-title") || "") : "",
        text: label.slice(0, 120),
      });
    };

    const onKey = (e) => { if (e.key === "Escape") { clearHover(); setPointMode(false); } };

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    document.body.classList.add("is-pointing");
    return () => {
      clearHover();
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("is-pointing");
    };
  }, [pointMode, pointScope]);

  const { chipEl, clearChip } = useTextSelection((annotation) => targetSection(annotation));

  return (
    <React.Fragment>

      {/* Floating note-freshness countdown - sits above the page, out of the way. */}
      {cacheRemaining !== null && <CacheTimer remaining={cacheRemaining} />}

      {chipEl}

      <RevisionPanel
        open={panelOpen}
        onToggle={() => { setPanelOpen((o) => !o); clearChip(); }}
        thread={S.thread}
        annotation={S.annotation}
        onClearAnnotation={() => patchS({ annotation: null })}
        draft={S.panelDraft}
        onDraft={(v) => patchS({ panelDraft: v })}
        onSend={handlePanelSend}
        onAskAdvice={askWhatWouldYouDo}
        canAsk={!!S.output}
        pairCount={pairCount}
        onExportPairs={() => {
          const n = window.VoiceCapture?.exportPairs() || 0;
          if (n) { window.VoiceCapture.clearPairs(); setPairCount(0); }
          pushThread("assistant", "status", n
            ? `Exported ${n} captured edit${n === 1 ? "" : "s"}. Move the file into ~/Private/voice-corpus and run import-pairs.mjs.`
            : "Nothing captured yet.");
        }}
        loading={loading}
        questions={S.questions}
        suggestState={S.suggestState}
        onToggleSuggestion={toggleSuggestion}
        onEditSuggestion={editSuggestion}
        acceptedSuggestions={acceptedSuggestions().length}
        onSkipQuestions={skipQuestions}
        skipCooldown={skipSecondsFor(S.readiness)}
        skipHeld={gateHolds()}
        unread={S.questions ? S.questions.length : 0}
        quality={noteQuality()}
        loggedIn={loggedIn}
        pointMode={pointMode}
        onPointMode={setPointMode}
        pointScope={pointScope}
        ticketOffer={S.ticketOffer}
        ticketFiling={S.ticketFiling}
        onFileTicket={fileTicket}
        onDismissTicket={dismissTicket}
        bcbaOffer={S.bcbaOffer}
        onTakeBcba={takeBcbaQuestion}
        onDismissBcba={dismissBcbaQuestion}
        routingAsks={S.routingAsks}
        onTakeRouted={takeRoutedChange}
        onLeaveRouted={leaveRoutedChange}
        intro={tool.assistantIntro}
      />

      <div style={{ maxWidth: 860, margin: "0 auto" }}>

      {/* Ribbon - only when there is something to switch between. A page that
          mounts one tool (BT) would otherwise show a single dead tab. */}
      {TOOLS.length > 1 && (
        <div className="tool-ribbon" role="tablist" aria-label="Note tools">
          {TOOLS.map((t) => (
            <button key={t.id} role="tab" aria-selected={t.id === activeId} className={t.id === activeId ? "active" : ""} onClick={() => switchTool(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="tool-panel" key={tool.id}>

        {/* Header */}
        <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: "#2d3a1f", marginBottom: 4 }}>{tool.title}</h1>
            <p style={{ fontSize: 14, color: "#5a6b4a" }}>{tool.subtitle}</p>
            {/* Which mode this tab is in has to be readable, not inferred from
                the URL: the toggle exists to produce two samples for comparison,
                and a tab that doesn't say invites mislabelling them. */}
            {schemaDisabled() && (
              <p style={{ display: "inline-block", marginTop: 8, padding: "3px 11px", borderRadius: 999, border: "1px solid #d4b483", background: "#fdf6e8", color: "#7a5a1a", fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>
                Schema off - unconstrained draft
              </p>
            )}
          </div>
          {/* The "Scrubber" link is gone from the drafters, on his call of
              2026-08-04: "old news. hide it on the drafters." The scrub now runs
              inside the drafting flow itself, so sending someone to a separate
              page to do it by hand is an older way of working that the tool has
              outgrown. notes/scrubber.html still exists and is still reachable
              by URL for anyone who wants it standalone. Its wrapper goes too, or
              the header keeps an empty flex column reserving space for nothing. */}
        </div>

        {/* Disclaimer */}
        <div style={{ marginBottom: 24, padding: "14px 18px", borderRadius: 10, border: "1.5px solid #d4b483", background: "#fdf6e8", color: "#5a4420", fontSize: 13, lineHeight: 1.55 }}>
          <strong style={{ color: "#7a5a1a" }}>Disclaimer:</strong> Use of these AI-assisted queries is subject to the legal and regulatory constraints of the user's jurisdiction. These tools do not remove the user's responsibility to review all output for accuracy and to maintain compliance with the ethical standards of their credentialing board for professional behavior analysis work.{" "}
          <strong style={{ color: "#7a5a1a" }}>Do not enter any PHI (Protected Health Information) into this tool.</strong> PHI is any detail that could identify a specific client - including names, dates of birth, addresses, phone numbers, ID or insurance numbers, or any other personal identifiers.
        </div>

        {/* The documentation-standards panel used to sit here. Removed: they are
            global best practice and already enforced in the prompt, so showing
            them on a clinical surface was chrome the technician had to scroll
            past on every note. ADMIN_STYLE_RULES still drives the prompt. */}

        {/* Inputs */}
        <div style={card}>
          {tool.inputs.map(renderInput)}

          {S.error && <p style={{ color: "#c0392b", fontSize: 13, marginBottom: 12 }}>{S.error}</p>}
          {/* The legal notice, which used to be a modal accepted once per page load
              and then never read again. It sits here instead, beside the box being
              typed into, where it is in front of the clinician every time rather
              than once. Same words, load-bearing ones unabridged. */}
          <div style={{ margin: "0 0 14px", padding: "10px 14px", borderRadius: 10, border: "1px solid #d9c9a3", background: "#fdfaf2", color: "#5a4420", fontSize: 12, lineHeight: 1.55 }}>
            {NotesScrub.ACK_NOTICE}
          </div>

          {S.scrubMap.some((m) => !m.restore) && (
            <div style={{ margin: "0 0 16px", borderRadius: 10, border: "2px solid #c8962a", overflow: "hidden" }}>
              <div style={{ padding: "8px 14px", background: "#fdf3dc", color: "#5a3d00", fontSize: 12, lineHeight: 1.5 }}>
                <strong>Removed before this left your device</strong>{" "}
                <span style={{ color: "#7a6020" }}>- substitute back in your EHR.</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
                  {/* Round-tripped words are not listed. The banner tells a
                      clinician what to substitute back in their EHR, and a word
                      that comes back on its own needs no substituting: listing it
                      would send them looking for a change that is not there. */}
                  {S.scrubMap.filter((m) => !m.restore).map((m) => {
                    const done = (S.certified || []).includes(m.name);
                    return (
                      <span key={m.name} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #e0cb9a", borderRadius: 999, padding: "3px 4px 3px 10px", fontSize: 12 }}>
                        <span>
                          <strong>{m.identifier ? m.kind || "identifier" : m.name}</strong> → {m.token}
                        </span>
                        {/* Identifiers get no escape. A phone number is never "not a
                            name" in a way worth remembering, and offering the button
                            would invite clicking it. */}
                        {!m.identifier &&
                          (done ? (
                            <span style={{ color: "#4a6b3a", fontWeight: 700, padding: "2px 8px" }}>✓ kept next time</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => certifyNotPii(m.name)}
                              title={`Stop removing "${m.name}" in future notes. Does not change the draft below.`}
                              style={{ border: "1px solid #c0d4a8", background: "#f4f7ee", color: "#4a5c38", borderRadius: 999, padding: "2px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                            >
                              not a name
                            </button>
                          ))}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div style={{ padding: "10px 14px", background: "#fff8ec", color: "#3d2a00", fontSize: 13.5, fontWeight: 600, lineHeight: 1.55 }}>
                ⚠️ {NotesScrub.SCRUB_GUIDANCE}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={!loggedIn ? () => NotesGate.openLogin() : (canUse ? handleGenerate : undefined)}
              disabled={loading || (loggedIn && !canUse)}
              style={{
                padding: "11px 28px", borderRadius: 8, border: "none",
                background: (loading || (loggedIn && !canUse)) ? "#a0b890" : "#374528",
                color: "white", fontSize: 15, fontWeight: 600,
                cursor: (loading || (loggedIn && !canUse)) ? "not-allowed" : "pointer",
              }}
            >
              {!loggedIn ? "Log in" : (canUse ? (loading ? "Generating…" : (tool.genLabel || "Generate Note")) : "No access for this tool")}
            </button>
            {!loggedIn && (
              <button
                onClick={handleGeneratePrompt}
                title="Build a prompt you can paste into an AI of your choice. Log in to have the tool write the note for you instead."
                style={{ padding: "11px 18px", borderRadius: 8, border: "1.5px solid #374528", background: "white", color: "#374528", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
              >
                Generate Prompt
              </button>
            )}
            {hasContent() && (
              <button
                onClick={handleClear}
                disabled={loading}
                title="Clear inputs and generated note to start fresh"
                style={{ padding: "11px 18px", borderRadius: 8, border: "1.5px solid #d4b483", background: "white", color: "#7a5a1a", fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}
              >
                Clear
              </button>
            )}
            {loggedIn && (
              <button onClick={() => NotesGate.logout()} style={{ marginLeft: "auto", padding: "9px 16px", borderRadius: 8, border: "1.5px solid #c0d4a8", background: "white", color: "#5a6b4a", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Log out
              </button>
            )}
          </div>
        </div>

        {/* Generated Prompt - logged out only. */}
        {!loggedIn && S.promptText && (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: "#2d3a1f" }}>Generated Prompt</h2>
                {tool.promptIntro ? <p style={{ fontSize: 13, color: "#5a6b4a", marginTop: 3 }}>{tool.promptIntro}</p> : null}
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(S.promptText); setCopiedPrompt(true); setTimeout(() => setCopiedPrompt(false), 1800); }}
                style={{ padding: "7px 16px", borderRadius: 7, border: "1.5px solid #374528", background: "white", color: "#374528", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", marginLeft: 16 }}
              >
                {copiedPrompt ? "Copied!" : "Copy"}
              </button>
            </div>
            <textarea
              readOnly
              value={S.promptText}
              style={{ width: "100%", minHeight: 220, padding: 12, borderRadius: 8, border: "1px solid #c0d4a8", fontSize: 13, color: "#2d3a1f", lineHeight: 1.6, resize: "vertical", background: "#f7fbf3", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
            />
          </div>
        )}

        {/* Output */}
        {S.output && (
          <div style={{ ...card, marginBottom: 20 }} data-testid="generated-note">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: "#2d3a1f" }}>{tool.outputTitle || "Generated Note"}</h2>
              {/* Copy All is per-tool. Some EHR forms take one field at a time,
                  where a single combined blob is never what gets pasted.

                  An admin gets it back regardless, his call on 2026-08-06: "I
                  was wrong - for admin mode I do want copy all on the notes."
                  The reason it is hidden is about the technician's EHR workflow,
                  and he is not doing that job when he opens the tool. */}
              {(tool.copyAll !== false || isAdmin) && (
                <button
                  onClick={handleCopyAll}
                  style={{ padding: "7px 16px", borderRadius: 7, border: "1.5px solid #374528", background: copied === "all" ? "#374528" : "white", color: copied === "all" ? "white" : "#374528", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  {copied === "all" ? "Copied!" : "Copy All"}
                </button>
              )}
            </div>
            <p style={{ fontSize: 13, color: "#7a9460", marginBottom: 20, lineHeight: 1.55 }}>
              Checkbox suggestions are inferred from your notes - verify before ticking your form. Narratives are editable. <strong style={{ color: "#5a6b4a" }}>Click a section to revise it, or select a phrase inside one to revise just that</strong> - the assistant panel takes it from there. 💡 flags what might be missing, ⚠ flags what a funder could reject the claim over.
            </p>

            <NoteHints hints={S.output.hints} catalog={tool.hintCatalog} />
            <ExpertReading expert={S.expert} />

            <div className="output-grid">
              {tool.formSections.map((sec, i) => {
                const id = sectionId(sec);
                const isNarrative = sec.kind === "narrative";
                // The prose is what the technician reads, edits and signs their
                // name to, so it gets the whole width. Everything else is a list
                // of ticks they glance at on the way to their EHR form, and
                // pairing those up halves how far they have to scroll to reach
                // the next narrative.
                // Narratives are always full width because prose needs the
                // room. Anything else can ask for it: a goals table has columns
                // that do not fit in half a row, and a single yes/no reads
                // better as one short band than as a tall half-card.
                const fullRow = isNarrative || sec.fullWidth === true;
                const targeted = S.annotation && S.annotation.id === id;
                // Facts echo the clinician's own quick-picks - there is nothing
                // for the model to revise, so they are not a revision target.
                const revisable = isModelSection(sec) && !S.proposal;
                return (
                  <div
                    key={id}
                    // Point mode resolves a click on anything inside a section
                    // back to the section itself, so it needs the id and the
                    // heading on the card rather than only in this closure.
                    data-section-key={id}
                    data-section-title={sec.heading}
                    data-revisable={revisable ? "true" : "false"}
                    data-compact={sec.compact === true ? "true" : undefined}
                    className={[fullRow ? "full-row" : "", targeted ? "section-targeted" : "", revisable ? "section-clickable" : ""].filter(Boolean).join(" ") || undefined}
                    onClick={revisable ? (e) => {
                      // Clicking into the textarea to type, or hitting Copy or
                      // expand, is not "I want to revise this section".
                      if (e.target.closest && e.target.closest("textarea, button, input, a")) return;
                      targetSection({ kind: "section", id, heading: sec.heading });
                    } : undefined}
                    style={{ borderRadius: 9, border: "1px solid #ddecd0", background: "#f7fbf3", padding: 16 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#374528" }}>{sec.heading}</span>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        {/* The width toggle is gone: narratives are always full
                            width now, so it had nothing left to toggle. */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCopy("sec-" + id, sectionBody(sec, S.output, S.values)); }}
                          style={smallBtn}
                        >
                          {copied === "sec-" + id ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>

                    {renderSectionContent(sec)}
                    <HintNotes hints={S.output.hints} section={sec} catalog={tool.hintCatalog} />
                    <ExpertNotes expert={S.expert} section={sec} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
    </React.Fragment>
  );
}

class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ maxWidth: 560, margin: "80px auto", padding: 24, textAlign: "center", color: "#374528", fontFamily: "inherit" }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
        <p style={{ fontSize: 14, color: "#5a6b4a", marginBottom: 16 }}>This tool hit an unexpected error. Reloading usually fixes it.</p>
        <button onClick={() => location.reload()} style={{ padding: "10px 22px", borderRadius: 8, border: "none", background: "#374528", color: "white", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Reload</button>
      </div>
    );
  }
}

// Drafts are encrypted at rest, so decrypting them is asynchronous - but
// freshSession() reads them synchronously while building initial React state.
// Waiting here is what reconciles the two: by first render the plaintext cache
// is populated, so a reload still restores the clinician's typing.
const mount = () =>
  ReactDOM.createRoot(document.getElementById("root")).render(
    <ErrorBoundary><App /></ErrorBoundary>
  );

if (window.NotesGate && NotesGate.draft && NotesGate.draft.ready) {
  NotesGate.draft.ready.then(mount, mount);
} else {
  mount();
}
