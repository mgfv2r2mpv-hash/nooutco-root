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

// Body text for a section — used by per-section Copy (NO heading; the EHR field
// already has its own label) and as "current content" context in revision turns.
function sectionBody(section, output) {
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
  return "";
}

// Copy All keeps headings as separators between EHR fields.
function sectionBlock(section, output) {
  return `${section.heading}\n${sectionBody(section, output)}`;
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
    // Clamp to the visible viewport width (clientWidth), not innerWidth — the
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

  // Keep the bubble clamped to the viewport at all times — even while hidden —
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

// Floating note-freshness countdown. Fixed top-right, out of the way; shows the
// warm-window remaining (mm:ss) after a note is generated and resets on each turn.
// Hover (desktop) or tap (mobile) reveals why prompt edits are best made in time.
// "Nothing happens" at zero — it just rests muted; revisions still work.
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
          ? "The quick-edit window has passed. Revisions still work — the next one just takes a moment longer while the tool re-reads the note. Edits made soon after generating are the fastest."
          : "Edits are most useful when made promptly. For about 5 minutes after each generation the tool keeps your note “warm,” so revisions apply fastest — each revision resets the timer."}
      </span>
    </div>
  );
}

// Read-only checklist mirroring a real-form checkbox group: full option list with
// AI-suggested options ticked (and bolded). single=true renders radio-style.
function Checklist({ options, selected, single = false }) {
  const sel = single ? (selected ? [selected] : []) : (Array.isArray(selected) ? selected : []);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", columnGap: 20, rowGap: 7 }}>
      {options.map((label) => {
        const on = sel.includes(label);
        return (
          <div key={label} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
            <span aria-hidden="true" style={{
              flexShrink: 0, marginTop: 1, width: 17, height: 17, borderRadius: single ? "50%" : 4,
              border: on ? "1.5px solid #374528" : "1.5px solid #c0d4a8",
              background: on ? "#374528" : "white", color: "white",
              fontSize: 12, fontWeight: 700, lineHeight: "15px", textAlign: "center",
            }}>{on ? "✓" : ""}</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.45, color: on ? "#2d3a1f" : "#9aab86", fontWeight: on ? 600 : 400 }}>{label}</span>
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

// One-line improvement note under a section — canonical wording from the tool's
// client-side catalog; the model only picked the code (plus a short specifier).
function HintNotes({ hints, section, catalog }) {
  const id = sectionId(section);
  const mine = (hints || []).filter((h) => h.section === id);
  if (!mine.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {mine.map((h, i) => {
        const base = h.code === "other" ? "" : catalog[h.code] || "";
        const text = h.code === "other" ? h.detail : base + (h.detail ? ` — ${h.detail}` : "");
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
    if (f.type === "toggle") values[f.id] = migrated[f.id] !== undefined ? migrated[f.id] : null;
    else values[f.id] = migrated[f.id] || "";
  });
  return {
    values,
    output: null,
    conversation: [],     // [{role, content}] — replayed each turn; prefix is server-cached
    promptText: "",
    scrubNotice: "",
    error: "",
    lastCallAt: 0,
    proposal: null,        // pending revision preview
    reviseFor: null,       // section id with an open revise input
    reviseDraft: "",
    globalDraft: "",
    expanded: [],
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

  // Persist the active tool's typed inputs on every change (per-tool draft key).
  React.useEffect(() => {
    if (window.NotesGate) NotesGate.draft.save(tool.id, S.values);
  }, [S.values, tool.id]);

  const patchS = (patch) =>
    setSessions((prev) => ({ ...prev, [tool.id]: { ...prev[tool.id], ...(typeof patch === "function" ? patch(prev[tool.id]) : patch) } }));

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

  // Scrub the typed inputs only, then build prompts from the scrubbed values —
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

  const runTurn = async (messages) => {
    const r = await NotesGate.generateConversation({
      system: tool.buildSystem(),
      messages,
      tool: tool.id,
      maxTokens: tool.maxTokens || 3000,
      // The sections this tool renders are exactly the top-level keys its prompt
      // contracts for, so they double as the shape the response must satisfy.
      // Derived rather than declared, so the check cannot drift from the UI.
      expectKeys: tool.formSections.map(sectionId),
    });
    return r; // {parsed, rawText, usage, stopReason}
  };

  const handleGenerate = async () => {
    const err = tool.validate(S.values);
    if (err) { patchS({ error: err }); return; }
    if (!NotesGate.isLoggedIn()) { NotesGate.openLogin(); return; }
    patchS({ error: "" });
    const review = await scrubGate(collectFreeText());
    if (!review) return;
    setLoading(true);
    patchS({ output: null, proposal: null, conversation: [] });
    try {
      const userMsg = tool.buildUserPrompt(scrubValues(review.map));
      const conversation = [{ role: "user", content: userMsg }];
      const r = await runTurn(conversation);
      conversation.push({ role: "assistant", content: r.rawText });
      patchS({ output: tool.normalizeOutput(r.parsed), conversation, lastCallAt: Date.now() });
    } catch (e) {
      patchS({ error: NotesGate.displayError(e) });
      reportError(tool.id, e);
    } finally {
      setLoading(false);
    }
  };

  // Shared by per-section revisions and the global corrections box. The exchange
  // is committed to the conversation immediately (so follow-ups keep context and
  // the cache prefix stays linear); Accept/Discard only controls what lands in
  // the visible output.
  // freeText is the raw clinician-typed material to scan; compose(map) builds the
  // final message with each free-text piece scrubbed individually (scaffolding
  // like "REVISION REQUEST" never passes through the map).
  const sendRevision = async (freeText, compose, targetSectionId) => {
    const review = await scrubGate(freeText);
    if (!review) return;
    setLoading(true);
    try {
      const userMsg = compose(review.map);
      const conversation = [...S.conversation, { role: "user", content: userMsg }];
      const r = await runTurn(conversation);
      conversation.push({ role: "assistant", content: r.rawText });
      const normalized = tool.normalizeOutput(r.parsed);
      const changes = [];
      tool.formSections.forEach((sec) => {
        const id = sectionId(sec);
        if (targetSectionId && id !== targetSectionId) return;
        if (!valuesEqual(normalized[id], S.output[id])) {
          changes.push({ id, heading: sec.heading, kind: sec.kind, columns: sec.columns, value: normalized[id] });
        }
      });
      patchS({
        conversation,
        lastCallAt: Date.now(),
        reviseFor: null,
        reviseDraft: "",
        globalDraft: targetSectionId ? S.globalDraft : "",
        proposal: { changes, hints: normalized.hints || [], targetSectionId: targetSectionId || null },
        error: "",
      });
    } catch (e) {
      patchS({ error: NotesGate.displayError(e) });
      reportError(tool.id, e);
    } finally {
      setLoading(false);
    }
  };

  const handleReviseSection = (section) => {
    const instruction = S.reviseDraft.trim();
    if (!instruction) return;
    const id = sectionId(section);
    // Only the typed instruction is NEW free text — scan/scrub that. The section
    // body is AI output already present verbatim in the conversation history (or
    // the clinician's own edit of it), so re-scanning it would flag words in the
    // generated prose ("Analyst", role tokens) on every single revision.
    const body = sectionBody(section, S.output);
    const compose = (map) => [
      `REVISION REQUEST`,
      `Target section: "${section.heading}" (JSON key: ${id})`,
      `Current content of that section as shown to the BCBA (may include their manual edits):`,
      body,
      ``,
      `Instruction: ${NotesScrub.applyMap(instruction, map)}`,
      ``,
      `Return the COMPLETE updated JSON object with ALL keys. Copy every section not targeted by the instruction verbatim from the current note. Re-evaluate "hints" for the whole note. Never fabricate — if the instruction asks for information not present anywhere in this conversation, leave it out and emit the appropriate hint instead.`,
    ].join("\n");
    sendRevision(instruction, compose, id);
  };

  const handleGlobalCorrections = () => {
    const text = S.globalDraft.trim();
    if (!text) return;
    const compose = (map) => [
      `ADDITIONAL DETAILS / CORRECTIONS from the BCBA:`,
      NotesScrub.applyMap(text, map),
      ``,
      `Apply these to every affected section. Return the COMPLETE updated JSON object with ALL keys; copy unaffected sections verbatim. Re-evaluate "hints". Never fabricate beyond what is stated.`,
    ].join("\n");
    sendRevision(text, compose, null);
  };

  const acceptProposal = () => {
    if (!S.proposal) return;
    patchS((s) => {
      const next = { ...s.output };
      s.proposal.changes.forEach((c) => { next[c.id] = c.value; });
      next.hints = s.proposal.hints;
      return { output: next, proposal: null };
    });
  };

  const discardProposal = () => patchS({ proposal: null });

  const editProposalChange = (idx, value) =>
    patchS((s) => ({
      proposal: { ...s.proposal, changes: s.proposal.changes.map((c, i) => (i === idx ? { ...c, value } : c)) },
    }));

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
    navigator.clipboard.writeText(tool.formSections.map((sec) => sectionBlock(sec, S.output)).join("\n\n"));
    setCopied("all");
    setTimeout(() => setCopied(null), 1800);
  };

  /* ── Clear / reset ─────────────────────────────────────────────────── */

  // True when the active tool holds anything worth confirming before wiping —
  // typed input, a generated note, or a built prompt. Drives whether Clear shows
  // and whether it double-checks first.
  const hasContent = () =>
    tool.inputs.some((f) => (f.type === "toggle" ? S.values[f.id] != null : (S.values[f.id] || "").trim() !== "")) ||
    !!S.output || !!S.promptText;

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
  // just rests — revisions still work, they only re-process the conversation once.
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
          <div style={{ display: "flex", gap: 10 }}>
            {f.options.map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => setValue(f.id, opt.value)}
                style={{
                  padding: "8px 22px", borderRadius: 8,
                  border: S.values[f.id] === opt.value ? "2px solid #374528" : "1.5px solid #c0d4a8",
                  background: S.values[f.id] === opt.value ? "#374528" : "white",
                  color: S.values[f.id] === opt.value ? "white" : "#374528",
                  fontWeight: 600, fontSize: 14, cursor: "pointer",
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
      <div key={f.id} style={{ marginBottom: 20 }}>
        <label style={subLbl}>
          {f.label}{f.required ? <span style={{ color: "#c0392b" }}> *</span> : null}
          {(f.tooltip || f.placeholder) ? <InfoTooltip text={f.tooltip || f.placeholder} /> : null}
        </label>
        {f.tip ? <Tip text={f.tip} /> : null}
        {f.hint ? <p style={hintStyle}>{f.hint}</p> : null}
        <textarea
          value={S.values[f.id]}
          onChange={(e) => setValue(f.id, e.target.value)}
          placeholder={f.placeholder}
          style={{ ...inputBase, height: f.height || 160, resize: "vertical", lineHeight: 1.6 }}
        />
        {f.charCount ? <p style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}>{(S.values[f.id] || "").length} characters</p> : null}
      </div>
    );
  };

  const renderSectionContent = (sec) => {
    const id = sectionId(sec);
    const v = S.output[id];
    if (sec.kind === "narrative") {
      const empty = !(v || "").trim();
      return (
        <textarea
          value={v || ""}
          onChange={(e) => patchS((s) => ({ output: { ...s.output, [id]: e.target.value } }))}
          placeholder={sec.emptyNote || ""}
          style={{ width: "100%", minHeight: S.expanded.includes(id) ? 140 : (sec.minHeight || 90), padding: 10, borderRadius: 7, border: "1px solid #c0d4a8", fontSize: 14, color: "#2d3a1f", lineHeight: 1.65, resize: "vertical", background: "white", opacity: empty ? 0.75 : 1 }}
        />
      );
    }
    if (sec.kind === "single") {
      return <Checklist options={tool.groupOptions[sec.group]} selected={v} single />;
    }
    if (sec.kind === "checklist") {
      return (v && v.length)
        ? <Checklist options={tool.groupOptions[sec.group]} selected={v} />
        : <p style={{ fontSize: 13, color: "#9aab86", fontStyle: "italic" }}>{sec.emptyNote || "No options suggested — leave blank or review your notes."}</p>;
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
    return null;
  };

  const renderProposalValue = (c, idx) => {
    if (c.kind === "narrative") {
      return (
        <textarea
          value={c.value || ""}
          onChange={(e) => editProposalChange(idx, e.target.value)}
          style={{ width: "100%", minHeight: 110, padding: 10, borderRadius: 7, border: "1px solid #c8b26a", fontSize: 14, color: "#2d3a1f", lineHeight: 1.65, resize: "vertical", background: "white" }}
        />
      );
    }
    if (c.kind === "table") {
      return (
        <GoalsTable
          columns={c.columns}
          rows={c.value}
          onChange={(rows) => editProposalChange(idx, rows)}
          idPrefix={`prop-${c.id}`}
        />
      );
    }
    if (c.kind === "single") {
      return <Checklist options={tool.groupOptions[c.id]} selected={c.value} single />;
    }
    return <Checklist options={tool.groupOptions[c.id]} selected={c.value} />;
  };

  // The proposal preview renders in-place — inside the revised section, or below
  // the corrections box for a global edit — so the change appears where the BCBA
  // is looking, not scrolled off the top. Bring it into view when it arrives.
  const proposalRef = React.useRef(null);
  const proposalKey = S.proposal ? (S.proposal.targetSectionId || "global") + ":" + S.lastCallAt : "";
  React.useEffect(() => {
    if (!proposalKey || !proposalRef.current) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    proposalRef.current.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, [proposalKey]); // proposalKey encodes which proposal (section + turn) is showing

  const renderProposalCard = () => (
    <div ref={proposalRef} style={{ marginTop: 14, borderRadius: 10, border: "2px solid #c8b26a", background: "#fffbef", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "#6d5613" }}>Proposed revision</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={acceptProposal} style={{ padding: "7px 18px", borderRadius: 7, border: "none", background: "#374528", color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Accept</button>
          <button onClick={discardProposal} style={{ padding: "7px 14px", borderRadius: 7, border: "1.5px solid #b0a070", background: "white", color: "#6d5613", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Discard</button>
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: "#8a7430", marginBottom: 14, lineHeight: 1.5 }}>
        Review before it lands in the note — edit the text below, Accept to apply, or Discard to keep the current version. To push back, discard and send another revision.
      </p>
      {S.proposal.changes.length === 0 && (
        <p style={{ fontSize: 13, color: "#8a7430", fontStyle: "italic" }}>The model made no changes for that instruction — the section already reflects it, or the requested detail isn't in the notes (check for a new hint after accepting).</p>
      )}
      {S.proposal.changes.map((c, idx) => (
        <div key={c.id} style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 12.5, fontWeight: 700, color: "#6d5613", marginBottom: 6 }}>{c.heading}</p>
          {renderProposalValue(c, idx)}
        </div>
      ))}
    </div>
  );

  /* ── Layout ────────────────────────────────────────────────────────── */

  return (
    <React.Fragment>

      {/* Floating note-freshness countdown — sits above the page, out of the way. */}
      {cacheRemaining !== null && <CacheTimer remaining={cacheRemaining} />}

      <div style={{ maxWidth: 860, margin: "0 auto" }}>

      {/* Ribbon */}
      <div className="tool-ribbon" role="tablist" aria-label="BCBA note tools">
        {TOOLS.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === activeId} className={t.id === activeId ? "active" : ""} onClick={() => switchTool(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="tool-panel" key={tool.id}>

        {/* Header */}
        <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: "#2d3a1f", marginBottom: 4 }}>{tool.title}</h1>
            <p style={{ fontSize: 14, color: "#5a6b4a" }}>{tool.subtitle}</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <a href="../scrubber.html" target="_blank" style={{ padding: "7px 16px", borderRadius: 8, border: "1.5px solid #c0d4a8", background: "#f0f4ec", color: "#374528", fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>Scrubber →</a>
          </div>
        </div>

        {/* Disclaimer */}
        <div style={{ marginBottom: 24, padding: "14px 18px", borderRadius: 10, border: "1.5px solid #d4b483", background: "#fdf6e8", color: "#5a4420", fontSize: 13, lineHeight: 1.55 }}>
          <strong style={{ color: "#7a5a1a" }}>Disclaimer:</strong> Use of these AI-assisted queries is subject to the legal and regulatory constraints of the user's jurisdiction. These tools do not remove the user's responsibility to review all output for accuracy and to maintain compliance with the ethical standards of their credentialing board for professional behavior analysis work.{" "}
          <strong style={{ color: "#7a5a1a" }}>Do not enter any PHI (Protected Health Information) into this tool.</strong> PHI is any detail that could identify a specific client — including names, dates of birth, addresses, phone numbers, ID or insurance numbers, or any other personal identifiers.
        </div>

        {/* Inputs */}
        <div style={card}>
          {tool.inputs.map(renderInput)}

          {S.error && <p style={{ color: "#c0392b", fontSize: 13, marginBottom: 12 }}>{S.error}</p>}
          {S.scrubNotice && (
            <div style={{ margin: "0 0 16px", borderRadius: 10, border: "2px solid #c8962a", overflow: "hidden" }}>
              <div style={{ padding: "8px 14px", background: "#fdf3dc", color: "#5a3d00", fontSize: 12, lineHeight: 1.5 }}>
                <strong>Removed before this left your device:</strong> {S.scrubNotice}{" "}
                <span style={{ color: "#7a6020" }}>— substitute back in your EHR.</span>
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
              <button
                onClick={handleCopyAll}
                style={{ padding: "7px 16px", borderRadius: 7, border: "1.5px solid #374528", background: copied === "all" ? "#374528" : "white", color: copied === "all" ? "white" : "#374528", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                {copied === "all" ? "Copied!" : "Copy All"}
              </button>
            </div>
            <p style={{ fontSize: 13, color: "#7a9460", marginBottom: 20, lineHeight: 1.55 }}>
              Checkbox suggestions are inferred from your notes — verify before ticking your form. Narratives are editable; use ✎ Revise on a section (or the corrections box below) for AI help, and the 💡 notes for what might be missing.
            </p>

            <div className="output-grid">
              {tool.formSections.map((sec, i) => {
                const id = sectionId(sec);
                const isNarrative = sec.kind === "narrative";
                const isOpen = S.expanded.includes(i);
                const fullRow = !isNarrative || isOpen;
                return (
                  <div key={id} className={fullRow ? "full-row" : undefined} style={{ borderRadius: 9, border: "1px solid #ddecd0", background: "#f7fbf3", padding: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10, gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#374528" }}>{sec.heading}</span>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        {isNarrative && (
                          <button onClick={() => toggleExpand(i)} title={isOpen ? "Collapse to half width" : "Expand to full row"} style={smallBtn}>
                            {isOpen ? "⤡" : "⤢"}
                          </button>
                        )}
                        <button
                          onClick={() => patchS((s) => ({ reviseFor: s.reviseFor === id ? null : id, reviseDraft: "" }))}
                          disabled={loading || !!S.proposal}
                          title="Ask the AI to revise this section"
                          style={{ ...smallBtn, opacity: loading || S.proposal ? 0.5 : 1 }}
                        >
                          ✎ Revise
                        </button>
                        <button onClick={() => handleCopy("sec-" + id, sectionBody(sec, S.output))} style={smallBtn}>
                          {copied === "sec-" + id ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>

                    {renderSectionContent(sec)}
                    <HintNotes hints={S.output.hints} section={sec} catalog={tool.hintCatalog} />

                    {S.reviseFor === id && (
                      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                        <input
                          autoFocus
                          value={S.reviseDraft}
                          onChange={(e) => patchS({ reviseDraft: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Enter") handleReviseSection(sec); }}
                          placeholder={'e.g. "expand with the FCT data" or "split the pending change into its own sentence"'}
                          style={{ ...inputBase, flex: 1, padding: "8px 12px", fontSize: 13 }}
                        />
                        <button onClick={() => handleReviseSection(sec)} disabled={loading || !S.reviseDraft.trim()} style={{ padding: "8px 16px", borderRadius: 7, border: "none", background: loading || !S.reviseDraft.trim() ? "#a0b890" : "#374528", color: "white", fontSize: 13, fontWeight: 600, cursor: loading ? "wait" : "pointer" }}>
                          {loading ? "…" : "Send"}
                        </button>
                      </div>
                    )}

                    {/* Revision preview appears right here, in the section being revised. */}
                    {S.proposal && S.proposal.targetSectionId === id && renderProposalCard()}
                  </div>
                );
              })}
            </div>

            {/* Global corrections box */}
            <div style={{ marginTop: 18, padding: 14, borderRadius: 9, border: "1px dashed #c0d4a8", background: "#fbfdf8" }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#374528", marginBottom: 6 }}>Add details / corrections</p>
              <p style={{ fontSize: 12.5, color: "#7a9460", marginBottom: 8, lineHeight: 1.5 }}>
                Anything you forgot or want fixed across the note — e.g. "we also ran a preference assessment" or "the IOA was 92%". The AI updates the affected sections and you preview before it lands. No PHI.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <textarea
                  value={S.globalDraft}
                  onChange={(e) => patchS({ globalDraft: e.target.value })}
                  placeholder="Additional details or corrections…"
                  style={{ ...inputBase, flex: 1, height: 60, resize: "vertical", fontSize: 13, lineHeight: 1.5 }}
                />
                <button onClick={handleGlobalCorrections} disabled={loading || !!S.proposal || !S.globalDraft.trim()} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: (loading || S.proposal || !S.globalDraft.trim()) ? "#a0b890" : "#374528", color: "white", fontSize: 13, fontWeight: 600, cursor: loading ? "wait" : "pointer", alignSelf: "flex-start" }}>
                  {loading ? "…" : "Send"}
                </button>
              </div>
            </div>

            {/* Cross-note revision preview appears by the corrections box that sent it. */}
            {S.proposal && !S.proposal.targetSectionId && renderProposalCard()}
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

ReactDOM.createRoot(document.getElementById("root")).render(
  <ErrorBoundary><App /></ErrorBoundary>
);
