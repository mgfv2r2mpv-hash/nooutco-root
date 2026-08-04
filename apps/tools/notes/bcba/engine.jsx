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

/* The learned style card is deliberately NOT rendered on this page.
 *
 * It is a clinical surface: a technician is on it to file a note, and a panel
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
function Checklist({ options, selected, single = false }) {
  const sel = single ? (selected ? [selected] : []) : (Array.isArray(selected) ? selected : []);

  if (single) {
    const answer = sel[0];
    if (!answer) {
      return <p style={{ fontSize: 13, color: "#9aab86", fontStyle: "italic", margin: 0 }}>Nothing suggested - choose from your EHR form.</p>;
    }
    return (
      <div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
          <span aria-hidden="true" style={{
            flexShrink: 0, marginTop: 2, width: 16, height: 16, borderRadius: "50%",
            border: "1.5px solid #374528", background: "#374528", color: "white",
            fontSize: 11, fontWeight: 700, lineHeight: "14px", textAlign: "center",
          }}>✓</span>
          <span style={{ fontSize: 13.5, lineHeight: 1.45, color: "#2d3a1f", fontWeight: 600 }}>{answer}</span>
        </div>
        <p style={{ fontSize: 11.5, color: "#8a9678", margin: "7px 0 0", lineHeight: 1.5 }}>
          Suggested from what you wrote. Use your clinical judgment and pick a different one on your form if it does not match the session.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", columnGap: 14, rowGap: 4 }}>
      {options.map((label) => {
        const on = sel.includes(label);
        return (
          <div key={label} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
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
function HintNotes({ hints, section, catalog }) {
  const id = sectionId(section);
  const mine = (hints || []).filter((h) => h.section === id);
  if (!mine.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {mine.map((h, i) => {
        const base = h.code === "other" ? "" : catalog[h.code] || "";
        const text = h.code === "other" ? h.detail : base + (h.detail ? ` - ${h.detail}` : "");
        if (!text) return null;
        return (
          <p key={i} style={{ fontSize: 12.5, color: "#8a6d1a", background: "#fdf6e0", border: "1px solid #ecd9a0", borderRadius: 7, padding: "6px 10px", marginBottom: 4, lineHeight: 1.5 }}>
            💡 {text}
          </p>
        );
      })}
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
    scrubNotice: "",
    error: "",
    lastCallAt: 0,
    proposal: null,        // pending revision, rendered as an inline diff
    expanded: [],

    // ── Assistant panel ──────────────────────────────────────────────────
    // What the clinician sees, which is not what the model sees: `conversation`
    // carries raw JSON both ways, `thread` carries the readable exchange.
    thread: [],            // [{role, kind, text}]
    annotation: null,      // {kind:"section"|"span", id, heading, text?}
    panelDraft: "",
    questions: null,       // triage questions awaiting an answer, or null
    pendingValues: null,   // scrubbed values held while triage runs

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
  // scrub gate: acknowledge (once per page load) + name review of the new text.
  const scrubGate = async (freeText) => {
    if (!(await NotesScrub.acknowledge())) return null;
    const review = await NotesScrub.review({ freeText });
    if (review.cancelled) return null;
    patchS({ scrubNotice: NotesScrub.noticeText(review.map) });
    return review;
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
  const runTurn = async (messages, styleBlock) => {
    const r = await NotesGate.generateConversation({
      system: tool.buildSystem() + (styleBlock ? "\n\n" + styleBlock : ""),
      messages,
      tool: tool.id,
      maxTokens: tool.maxTokens || 3000,
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

  /* How the note is doing, for the collapsed assistant pill.
   *
   * Built from the hints the model already returns rather than from a second
   * call: it has just read the note and said what is thin about it, so asking
   * again would cost a round trip to learn something we were already told.
   *
   * "missing" means a hint names a section that has no prose at all - a payer
   * reading that note finds a blank where a narrative should be. "thin" means
   * there are hints but every section has something in it. Deliberately
   * conservative: a green tick that turns out to be wrong is worse than an amber
   * one the technician glances at and dismisses. */
  const noteQuality = () => {
    if (!S.output) return { level: "idle" };

    const empties = narrativeIds().filter((id) => !String(S.output[id] || "").trim());
    if (empties.length) {
      return { level: "missing", reason: `${empties.length} narrative section${empties.length > 1 ? "s are" : " is"} empty` };
    }

    const hints = Array.isArray(S.output.hints) ? S.output.hints : [];
    if (hints.length) {
      return { level: "thin", reason: `${hints.length} spot${hints.length > 1 ? "s" : ""} could use more detail` };
    }
    return { level: "good", reason: "Nothing flagged. Review it before you file it." };
  };

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
    if (!window.NoteStyleFeatures || !window.NotesGate?.audit?.corrections) return;
    if (!before || !after || before === after) return;
    const features = window.NoteStyleFeatures.compare(before, after, source);
    if (features.length) window.NotesGate.audit.corrections(features);
  };

  /* ── Triage: ask before drafting ──────────────────────────────────────
     A note is only as good as what went into it, and the commonest failure is
     not a bad draft but a thin one - a behavior with no count, a program with
     no prompt level. Asking costs one cheap call and is the only moment the
     technician still has the session in their head.

     Deliberately NOT a turn in the note conversation. That conversation's
     prefix is what the 5-minute cache is keyed on, and every revision replays
     it; splicing a differently-prompted turn into the front would invalidate
     the prefix and make each revision pay for the whole note again. */

  const TRIAGE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["sufficient", "questions"],
    properties: {
      sufficient: { type: "boolean" },
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field", "question"],
          properties: { field: { type: "string" }, question: { type: "string" } },
        },
      },
    },
  };

  const TRIAGE_SYSTEM =
    "You are reviewing a clinician's raw session notes BEFORE they are turned into a formal note.\n\n" +
    "Your ONLY job: decide whether anything is too thin to write from, and if so ask at most 3 short, specific questions that would materially improve the finished note.\n\n" +
    "RULES\n" +
    "- Ask only about what a payer or supervisor would notice missing: counts or rates for a behavior, the prompt level used, whether a strategy worked, how this session compared to recent ones.\n" +
    "- Be specific and quote back what they wrote. \"You mentioned elopement - how many times, and what did you do?\" NOT \"Can you add more detail?\"\n" +
    "- NEVER ask for a name, a date, an address, or any other identifying detail. The notes are deliberately de-identified.\n" +
    "- Do not ask about something they plainly had nothing to report. A session with no behaviors of concern is a normal session, not a gap.\n" +
    "- If the notes are adequate, return sufficient=true and an empty array. Fewer questions is better than more; three is a ceiling, not a target.\n" +
    "- Return ONLY a JSON object: {\"sufficient\": boolean, \"questions\": [{\"field\": \"\", \"question\": \"\"}]}";

  const runTriage = async (scrubbed) => {
    const body = tool.inputs
      .filter((f) => f.type === "textarea")
      .map((f) => `[${f.label}]${f.required ? " (required)" : ""}\n${(scrubbed[f.id] || "").trim() || "(empty)"}`)
      .join("\n\n");
    const r = await NotesGate.generateConversation({
      system: TRIAGE_SYSTEM,
      messages: [{ role: "user", content: "CLINICIAN'S RAW NOTES:\n\n" + body }],
      tool: tool.id,
      maxTokens: 600,
      expectKeys: ["sufficient", "questions"],
      responseSchema: TRIAGE_SCHEMA,
    });
    const parsed = r.parsed || {};
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    return parsed.sufficient ? [] : questions.filter((q) => q && q.question).slice(0, 3);
  };

  // Draft the note. `extra` is the technician's answers to the triage questions,
  // already scrubbed; it rides along in the same first user message so the
  // conversation stays a single linear prefix.
  const draftNote = async (scrubbedValues, extra) => {
    setLoading(true);
    patchS({ output: null, proposal: null, conversation: [], questions: null, pendingValues: null });
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
      const conversation = [{ role: "user", content: userMsg }];
      patchS({ convStyleBlock: styleBlock });
      const r = await runTurn(conversation, styleBlock);
      conversation.push({ role: "assistant", content: r.rawText });
      patchS({ output: tool.normalizeOutput(r.parsed), conversation, lastCallAt: Date.now() });
      pushThread("assistant", "status", "Drafted. Click any section - or select a phrase inside one - to revise it.");
      audit("note_generated", { ...inputSizes(scrubbedValues), answered: extra && extra.trim() ? 1 : 0 });
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
    try {
      questions = await runTriage(scrubbed);
    } catch (e) {
      // Triage is an assist, not a gate. If it fails the note still gets
      // written - losing a question is a far smaller harm than refusing to
      // draft for a technician with eight notes left to file.
      reportError(tool.id, e);
    }
    if (questions.length) {
      setLoading(false);
      audit("gap_questions", { asked: questions.length });
      patchS({ questions, pendingValues: scrubbed });
      return;
    }
    audit("gap_questions", { asked: 0 });
    await draftNote(scrubbed, "");
  };

  const skipQuestions = () => {
    audit("gap_questions", { skipped: (S.questions || []).length });
    pushThread("user", "answer", "(skipped)");
    draftNote(S.pendingValues || scrubValues([]), "");
  };

  /* ── Revisions ────────────────────────────────────────────────────────
     The exchange is committed to the conversation immediately (so follow-ups
     keep context and the cache prefix stays linear); Accept/Discard only
     controls what lands in the visible output. */

  const sendRevision = async (instruction) => {
    const review = await scrubGate(instruction);
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
        `Return the COMPLETE updated JSON object with ALL keys. Copy every section not targeted by the instruction verbatim from the current note. Re-evaluate "hints" for the whole note. Never fabricate - if the instruction asks for information not present anywhere in this conversation, leave it out and emit the appropriate hint instead.`,
      ].join("\n");
    } else {
      userMsg = [
        `ADDITIONAL DETAILS / CORRECTIONS from the clinician:`,
        scrubbedInstruction,
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
      const normalized = tool.normalizeOutput(r.parsed);
      const targetId = ann ? ann.id : null;
      const changes = [];
      tool.formSections.filter(isModelSection).forEach((sec) => {
        const id = sectionId(sec);
        if (targetId && id !== targetId) return;
        if (!valuesEqual(normalized[id], S.output[id])) {
          changes.push({
            id, heading: sec.heading, kind: sec.kind, columns: sec.columns,
            value: normalized[id], prev: S.output[id],
          });
        }
      });
      patchS({
        conversation,
        lastCallAt: Date.now(),
        annotation: null,
        proposal: { changes, hints: normalized.hints || [], targetSectionId: targetId, kind: ann ? ann.kind : "global" },
        error: "",
      });
      audit("revision", { requested: 1, sections: changes.length, kind: ann ? ann.kind : "global" });
      pushThread(
        "assistant",
        "status",
        changes.length
          ? (changes.length === 1
              ? `Updated “${changes[0].heading}” - the change is highlighted in the note.`
              : `Updated ${changes.length} sections - the changes are highlighted in the note.`)
          : "No change was needed for that - the note already reflects it, or the detail isn't in your notes."
      );
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
    if (S.questions && S.questions.length) {
      const review = await scrubGate(text);
      if (!review) return;
      audit("gap_questions", { answered: S.questions.length });
      await draftNote(S.pendingValues, NotesScrub.applyMap(text, review.map));
      return;
    }
    if (!S.output) {
      pushThread("assistant", "status", "Generate the note first, then I can revise it.");
      return;
    }
    await sendRevision(text);
  };

  const targetSection = (annotation) => {
    patchS({ annotation });
    setPanelOpen(true);
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

  const discardProposal = () => {
    if (S.proposal) audit("revision", { discarded: 1, sections: S.proposal.changes.length, kind: S.proposal.kind || "section" });
    patchS({ proposal: null });
  };

  const pendingChangeFor = (id) =>
    (S.proposal && S.proposal.changes.find((c) => c.id === id)) || null;

  const handleGeneratePrompt = async () => {
    const err = tool.validate(S.values);
    if (err) { patchS({ error: err }); return; }
    patchS({ error: "" });
    const review = await scrubGate(collectFreeText());
    if (!review) return;
    patchS({ promptText: tool.buildLabeledPrompt(scrubValues(review.map)) });
    setCopiedPrompt(false);
  };

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
        ? <Checklist options={tool.groupOptions[sec.group]} selected={v} />
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
        loading={loading}
        questions={S.questions}
        onSkipQuestions={skipQuestions}
        unread={S.questions ? S.questions.length : 0}
        quality={noteQuality()}
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <a href="../scrubber.html" target="_blank" style={{ padding: "7px 16px", borderRadius: 8, border: "1.5px solid #c0d4a8", background: "#f0f4ec", color: "#374528", fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>Scrubber →</a>
          </div>
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
          {S.scrubNotice && (
            <div style={{ margin: "0 0 16px", borderRadius: 10, border: "2px solid #c8962a", overflow: "hidden" }}>
              <div style={{ padding: "8px 14px", background: "#fdf3dc", color: "#5a3d00", fontSize: 12, lineHeight: 1.5 }}>
                <strong>Removed before this left your device:</strong> {S.scrubNotice}{" "}
                <span style={{ color: "#7a6020" }}>- substitute back in your EHR.</span>
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
            <button
              onClick={handleGeneratePrompt}
              style={{ padding: "11px 18px", borderRadius: 8, border: "1.5px solid #374528", background: "white", color: "#374528", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              Generate Prompt
            </button>
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

        {/* Generated Prompt */}
        {S.promptText && (
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
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: "#2d3a1f" }}>{tool.outputTitle || "Generated Note"}</h2>
              {/* Copy All is per-tool. Some EHR forms take one field at a time,
                  where a single combined blob is never what gets pasted. */}
              {tool.copyAll !== false && (
                <button
                  onClick={handleCopyAll}
                  style={{ padding: "7px 16px", borderRadius: 7, border: "1.5px solid #374528", background: copied === "all" ? "#374528" : "white", color: copied === "all" ? "white" : "#374528", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  {copied === "all" ? "Copied!" : "Copy All"}
                </button>
              )}
            </div>
            <p style={{ fontSize: 13, color: "#7a9460", marginBottom: 20, lineHeight: 1.55 }}>
              Checkbox suggestions are inferred from your notes - verify before ticking your form. Narratives are editable. <strong style={{ color: "#5a6b4a" }}>Click a section to revise it, or select a phrase inside one to revise just that</strong> - the assistant panel takes it from there. 💡 notes flag what might be missing.
            </p>

            <div className="output-grid">
              {tool.formSections.map((sec, i) => {
                const id = sectionId(sec);
                const isNarrative = sec.kind === "narrative";
                // The prose is what the technician reads, edits and signs their
                // name to, so it gets the whole width. Everything else is a list
                // of ticks they glance at on the way to their EHR form, and
                // pairing those up halves how far they have to scroll to reach
                // the next narrative.
                const fullRow = isNarrative;
                const targeted = S.annotation && S.annotation.id === id;
                // Facts echo the clinician's own quick-picks - there is nothing
                // for the model to revise, so they are not a revision target.
                const revisable = isModelSection(sec) && !S.proposal;
                return (
                  <div
                    key={id}
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
