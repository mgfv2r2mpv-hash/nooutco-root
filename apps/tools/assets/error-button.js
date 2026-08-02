(function () {
  "use strict";

  var BTN_ID = "eb-float-btn";
  var BACKDROP_ID = "eb-backdrop";

  // Avoid double-injection if the script is included twice.
  if (document.getElementById(BTN_ID)) return;

  // ── Styles ──────────────────────────────────────────────────────────────────
  var style = document.createElement("style");
  style.textContent = [
    "#" + BTN_ID + " {",
    "  position: fixed; bottom: 14px; right: 14px; z-index: 500;",
    "  width: 40px; height: 40px;",
    "  border-radius: 50%; border: none;",
    "  background: #d97706;",
    "  color: #fff; font-size: 18px; line-height: 1;",
    "  cursor: pointer;",
    "  display: flex; align-items: center; justify-content: center;",
    "  box-shadow: 0 2px 8px rgba(0,0,0,.22);",
    "  transition: background .15s, transform .15s;",
    "}",
    "#" + BTN_ID + ":hover { background: #b45309; transform: scale(1.08); }",
    "#" + BTN_ID + ":focus-visible {",
    "  outline: 3px solid rgba(217,119,6,.45); outline-offset: 2px;",
    "}",
    "#" + BACKDROP_ID + " {",
    "  position: fixed; inset: 0; z-index: 8000;",
    "  background: rgba(20,28,14,.55);",
    "  display: flex; align-items: center; justify-content: center;",
    "  padding: 20px;",
    "}",
    ".eb-card {",
    "  background: #fff;",
    "  border-radius: 12px;",
    "  padding: 24px;",
    "  width: min(420px, 100%);",
    "  box-shadow: 0 8px 24px rgba(0,0,0,.25);",
    "  font-family: 'Atkinson Hyperlegible', system-ui, sans-serif;",
    "}",
    ".eb-title {",
    "  margin: 0 0 16px;",
    "  font-size: 17px; font-weight: 600;",
    "  color: #1a2010;",
    "}",
    ".eb-label {",
    "  display: block;",
    "  font-size: 13px; font-weight: 500; color: #374040;",
    "  margin-bottom: 5px;",
    "}",
    ".eb-textarea {",
    "  width: 100%; box-sizing: border-box;",
    "  padding: 10px 12px;",
    "  border: 1px solid #cbd5e1;",
    "  border-radius: 6px;",
    "  font-family: inherit; font-size: 14px; line-height: 1.5;",
    "  resize: vertical; min-height: 90px;",
    "  color: #1a2010;",
    "  transition: border-color .15s, box-shadow .15s;",
    "}",
    ".eb-textarea:focus {",
    "  outline: none;",
    "  border-color: #6a7659;",
    "  box-shadow: 0 0 0 3px rgba(106,118,89,.3);",
    "}",
    ".eb-input {",
    "  width: 100%; box-sizing: border-box;",
    "  padding: 9px 12px;",
    "  border: 1px solid #cbd5e1;",
    "  border-radius: 6px;",
    "  font-family: inherit; font-size: 14px;",
    "  color: #1a2010;",
    "  transition: border-color .15s, box-shadow .15s;",
    "}",
    ".eb-input:focus {",
    "  outline: none;",
    "  border-color: #6a7659;",
    "  box-shadow: 0 0 0 3px rgba(106,118,89,.3);",
    "}",
    ".eb-field { margin-bottom: 14px; }",
    ".eb-actions {",
    "  display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px;",
    "}",
    ".eb-btn-cancel {",
    "  padding: 9px 16px;",
    "  border: 1.5px solid #c8d4b0;",
    "  border-radius: 6px;",
    "  background: transparent;",
    "  color: #4d5840; font-size: 14px; font-weight: 500;",
    "  cursor: pointer;",
    "  font-family: inherit;",
    "  transition: background .15s;",
    "}",
    ".eb-btn-cancel:hover { background: #f0f4e8; }",
    ".eb-btn-submit {",
    "  padding: 9px 18px;",
    "  border: none; border-radius: 6px;",
    "  background: #6a7659; color: #fff;",
    "  font-size: 14px; font-weight: 600;",
    "  cursor: pointer;",
    "  font-family: inherit;",
    "  transition: background .15s;",
    "}",
    ".eb-btn-submit:hover:not(:disabled) { background: #5d6a4d; }",
    ".eb-btn-submit:disabled { background: #c8d4b0; color: #8a9a78; cursor: not-allowed; }",
    ".eb-status {",
    "  border-radius: 7px; padding: 12px 14px;",
    "  font-size: 14px; line-height: 1.45; margin-top: 14px;",
    "}",
    ".eb-status-ok   { background: #ecfdf5; color: #065f46; }",
    ".eb-status-dupe { background: #fffbeb; color: #92400e; }",
    ".eb-status-err  { background: #fef2f2; color: #991b1b; }",
  ].join("\n");
  document.head.appendChild(style);

  // ── Floating button ──────────────────────────────────────────────────────────
  var btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.setAttribute("aria-label", "Report an error");
  btn.title = "Report an error";
  btn.textContent = "⚠️";
  document.body.appendChild(btn);

  // ── Modal ────────────────────────────────────────────────────────────────────
  function openModal() {
    if (document.getElementById(BACKDROP_ID)) return;

    var backdrop = document.createElement("div");
    backdrop.id = BACKDROP_ID;
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "eb-modal-title");

    var toolName = (document.title || "").trim() || "App";

    backdrop.innerHTML = [
      '<div class="eb-card">',
      '  <h2 class="eb-title" id="eb-modal-title">Report an error</h2>',
      // A category covers most reports on its own and carries no PHI risk at
      // all, so it is asked first and the free-text box is framed as optional.
      '  <div class="eb-field">',
      '    <label class="eb-label" for="eb-kind">What happened?</label>',
      '    <select id="eb-kind" class="eb-input">',
      '      <option value="">Choose the closest…</option>',
      '      <option value="generate-failed">Generate Note failed or errored</option>',
      '      <option value="revision-failed">A revision failed or did nothing</option>',
      '      <option value="wrong-content">The note said something wrong or invented</option>',
      '      <option value="checkboxes-wrong">The suggested checkboxes were wrong</option>',
      '      <option value="scrub-missed">The scrubber missed something it should have caught</option>',
      '      <option value="scrub-overzealous">The scrubber flagged something that was not a name</option>',
      '      <option value="login">Login or access problem</option>',
      '      <option value="slow">Too slow, or it hung</option>',
      '      <option value="display">Something looked wrong on screen</option>',
      '      <option value="other">Something else</option>',
      '    </select>',
      '  </div>',
      '  <div class="eb-field">',
      '    <label class="eb-label" for="eb-msg">Anything to add? <span style="font-weight:400;color:#64748b">(optional)</span></label>',
      '    <textarea id="eb-msg" class="eb-textarea" placeholder="What you were doing when it happened…" maxlength="2000"></textarea>',
      // This box used to email whatever was typed straight to an inbox, outside
      // the scrubber — and the likeliest thing to paste into it is the note that
      // just failed. It now passes the same name/identifier review a note does.
      '    <p style="margin:6px 0 0;font-size:12px;color:#64748b;line-height:1.45;">',
      '      Do not paste the note itself. Names and identifiers are removed before this is sent.',
      '    </p>',
      '  </div>',
      '  <div class="eb-field">',
      '    <label class="eb-label" for="eb-email">Your email <span style="font-weight:400;color:#64748b">(optional, for follow-up)</span></label>',
      '    <input id="eb-email" class="eb-input" type="email" placeholder="you@example.com" autocomplete="email" />',
      '  </div>',
      '  <div id="eb-status-area"></div>',
      '  <div class="eb-actions">',
      '    <button class="eb-btn-cancel" id="eb-cancel">Cancel</button>',
      '    <button class="eb-btn-submit" id="eb-submit" disabled>Send Report</button>',
      '  </div>',
      '</div>',
    ].join("");

    document.body.appendChild(backdrop);

    var kindEl   = document.getElementById("eb-kind");
    var msgEl    = document.getElementById("eb-msg");
    var emailEl  = document.getElementById("eb-email");
    var submitEl = document.getElementById("eb-submit");
    var cancelEl = document.getElementById("eb-cancel");
    var statusEl = document.getElementById("eb-status-area");

    kindEl.focus();

    // A category alone is a valid report — the free text is genuinely optional
    // now, which is what lets us tell people not to paste the note in.
    function updateSubmit() {
      submitEl.disabled = !kindEl.value;
    }
    kindEl.addEventListener("change", updateSubmit);
    msgEl.addEventListener("input", updateSubmit);
    updateSubmit();

    function closeModal() {
      var el = document.getElementById(BACKDROP_ID);
      if (el) el.remove();
    }

    cancelEl.addEventListener("click", closeModal);

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeModal();
    });

    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") {
        closeModal();
        document.removeEventListener("keydown", onKey);
      }
    });

    submitEl.addEventListener("click", function () {
      var kind    = kindEl.value;
      var msg     = msgEl.value.trim();
      var replyTo = emailEl.value.trim();
      if (!kind) return;

      // Run whatever they typed through the same detector a note goes through.
      // This is the one user-facing text field that reaches an inbox, and the
      // likeliest thing to be pasted into it is the note that just failed.
      if (msg && window.NotesGate && window.NotesGate._scrub) {
        var s = window.NotesGate._scrub;
        var map = (s.buildIdentifierMap ? s.buildIdentifierMap(msg) : [])
          .concat(s.buildNameMap ? s.buildNameMap(msg) : []);
        if (map.length) msg = s.applyScrub(msg, map);
      }

      submitEl.disabled = true;
      cancelEl.disabled = true;
      submitEl.textContent = "Sending…";
      statusEl.innerHTML = "";

      // Append .js suffix — Bot Fight Mode exempts static extensions on this plan.
      fetch("/api/report-error.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind:    kind,
          message: msg || "(no additional detail)",
          tool:    toolName,
          replyTo: replyTo || undefined,
        }),
      })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
        .then(function (res) {
          if (res.status === 409) {
            statusEl.innerHTML = '<div class="eb-status eb-status-dupe">Already reported — we have this one.</div>';
            submitEl.textContent = "Send Report";
            cancelEl.disabled = false;
            return;
          }
          if (!res.ok) {
            statusEl.innerHTML = '<div class="eb-status eb-status-err">Couldn\'t send. Please try again.</div>';
            submitEl.disabled = false;
            submitEl.textContent = "Send Report";
            cancelEl.disabled = false;
            return;
          }
          statusEl.innerHTML = '<div class="eb-status eb-status-ok">Thanks — we\'ll look into it.</div>';
          setTimeout(closeModal, 2500);
        })
        .catch(function () {
          statusEl.innerHTML = '<div class="eb-status eb-status-err">Network error. Please try again.</div>';
          submitEl.disabled = false;
          submitEl.textContent = "Send Report";
          cancelEl.disabled = false;
        });
    });
  }

  btn.addEventListener("click", openModal);
})();
