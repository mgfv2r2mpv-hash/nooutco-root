/*
 * notes-scrub.js — confirm-first PHI/PII review shared by the notes tools.
 *
 * Compliance model (no BAA / no ZDR): PHI must never reach the API. De-identifying
 * the input *before* anything is sent is the HIPAA control here — the API only ever
 * receives role tokens (Client, Caregiver, …). Two gates run before any prompt is
 * built or sent:
 *
 *   1. acknowledge() — a once-per-page-load legal notice the clinician must accept
 *      (submitting PHI to a third-party AI service without a BAA can violate HIPAA
 *      and other laws). Returns false if declined.
 *   2. review()      — every detected name is shown for confirmation. The clinician
 *      edits the replacement, picks a role, or certifies the term is not PII (which
 *      leaves it untouched). Confirmed names are replaced everywhere.
 *
 * Tokens stay in the output (de-identified AND retrievable — the clinician
 * substitutes real names in their own EHR). The name->token map is EPHEMERAL: it
 * lives only for the duration of one action and is never stored or transmitted.
 * persistMap() is an inert hook for future encrypted-at-rest storage if re-insertion
 * is ever added.
 *
 * Depends on window.NotesGate._scrub (detectNames / applyScrub). Vanilla; the React
 * pages `await NotesScrub.acknowledge()` then `await NotesScrub.review(...)`.
 */
(function () {
  "use strict";

  // Role -> readable replacement token. Title-case so it reads naturally inline.
  // BCBA stays upper-case because it is an acronym, not a word.
  var ROLES = [
    { key: "client", label: "Client", token: "Client" },
    { key: "caregiver", label: "Caregiver", token: "Caregiver" },
    { key: "sibling", label: "Sibling", token: "Sibling" },
    { key: "peer", label: "Peer", token: "Peer" },
    { key: "technician", label: "Technician (BT/RBT)", token: "Technician" },
    { key: "bcba", label: "BCBA", token: "BCBA" },
    { key: "teacher", label: "Teacher", token: "Teacher" },
    { key: "specialist", label: "Specialist (SLP/OT/PT)", token: "Specialist" },
    { key: "staff", label: "Other staff", token: "Staff" },
  ];

  // What counts as PII/PHI — surfaced in the (?) tooltip on each row and in the
  // acknowledgment notice. Mirrors the HIPAA Safe-Harbor identifiers in plain words.
  var PII_HELP =
    "PII / PHI is any detail that could identify a person: full or partial names and " +
    "initials; dates tied to a person (birth, admission, discharge, death); ages over 89; " +
    "addresses or any location smaller than a state; phone, fax, or email; Social Security, " +
    "medical-record, insurance, or account numbers; license, certificate, vehicle, or device " +
    "IDs; URLs, IP addresses, biometric data (fingerprints, voice), or photos; and any other " +
    "unique code or characteristic that could identify the individual.";

  function scrub() { return (window.NotesGate && window.NotesGate._scrub) || null; }

  function detect(freeText) {
    var s = scrub();
    return s ? s.detectNames(freeText) : [];
  }

  function roleByKey(key) {
    for (var i = 0; i < ROLES.length; i++) if (ROLES[i].key === key) return ROLES[i];
    return ROLES[0];
  }

  // Best-guess default role from words near the name. Drives only the dropdown
  // default — the clinician confirms or overrides every choice.
  var CUES = [
    { rx: /\b(mom|mother|dad|father|parent|grandma|grandpa|grandmother|grandfather|guardian|caregiver|aunt|uncle|foster)\b/, role: "caregiver" },
    { rx: /\b(bt|rbt|tech|technician|aide|para)\b/, role: "technician" },
    { rx: /\b(bcba|bcaba|analyst|supervisor)\b/, role: "bcba" },
    { rx: /\b(teacher|sped)\b/, role: "teacher" },
    { rx: /\b(slp|ot|pt|speech|occupational|physical|therapist|specialist)\b/, role: "specialist" },
  ];
  function guessRole(name, text) {
    if (!text) return "client";
    var lower = text.toLowerCase();
    var needle = name.toLowerCase();
    var idx = lower.indexOf(needle);
    while (idx !== -1) {
      var ctx = lower.slice(Math.max(0, idx - 40), Math.min(lower.length, idx + needle.length + 40));
      for (var i = 0; i < CUES.length; i++) if (CUES[i].rx.test(ctx)) return CUES[i].role;
      idx = lower.indexOf(needle, idx + needle.length);
    }
    return "client";
  }

  // Find the sentence containing the first occurrence of name (case-insensitive)
  // and return a short clip, so the clinician sees context for each detection.
  function snippetFor(name, text) {
    if (!text) return "";
    var lower = text.toLowerCase();
    var lname = name.toLowerCase();
    var idx = lower.indexOf(lname);
    if (idx === -1) return "";
    var start = idx;
    while (start > 0 && !/[\n.!?]/.test(text[start - 1])) start--;
    var end = idx + name.length;
    while (end < text.length && !/[\n.!?]/.test(text[end])) end++;
    if (end < text.length) end++;
    var s = text.slice(start, end).trim();
    if (s.length > 80) {
      var rel = idx - start;
      var from = Math.max(0, rel - 30);
      s = (from > 0 ? "…" : "") + s.slice(from, Math.min(s.length, from + 70)).trim() + "…";
    }
    return s;
  }

  // Shown in the notice banner after any scrub so clinicians build better habits.
  var SCRUB_GUIDANCE =
    "Please be careful to avoid using names and identifying information in the future. " +
    "Refer to the client as “Client,” parent as “Parent,” and staff by role " +
    "(BT, BCBA, SLP, OT, etc.). Remember that client health information responsibility " +
    "sits with ALL providers at all times.";

  // Pre-fill replacement defaults, numbering duplicates within a role
  // (Client, Client 2). The clinician can edit any of them.
  function defaultTokens(names, freeText) {
    var counts = {};
    return names.map(function (name) {
      var role = roleByKey(guessRole(name, freeText));
      counts[role.key] = (counts[role.key] || 0) + 1;
      var n = counts[role.key];
      return { roleKey: role.key, token: n === 1 ? role.token : role.token + " " + n };
    });
  }

  // selections: [{ name, replacement, cert }] -> { map, certified }. Longest names
  // first so "John Smith" is replaced before "John".
  function buildMap(selections) {
    var map = [];
    var certified = [];
    selections.forEach(function (s) {
      if (s.cert) { certified.push(s.name); return; }
      var rep = (s.replacement || "").trim();
      if (!rep) return;
      map.push({ name: s.name, token: rep });
    });
    map.sort(function (a, b) { return b.name.length - a.name.length; });
    return { map: map, certified: certified };
  }

  function applyMap(text, map) {
    var s = scrub();
    if (!s || !map || !map.length) return text;
    return s.applyScrub(text, map);
  }

  function noticeText(map) {
    if (!map || !map.length) return "";
    return map.map(function (e) { return e.name + " → " + e.token; }).join(", ");
  }

  // Inert hook. If re-insertion is ever added, encrypt the map at rest here
  // (Web Crypto AES-GCM, key derived from a clinician passphrase via PBKDF2) — never
  // store the map in plaintext, never transmit it. Currently a no-op by design.
  function persistMap(/* map */) { return false; }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ───────────────── Acknowledgment (once per page load) ───────────────── */

  var acked = false;

  function acknowledge() {
    return new Promise(function (resolve) {
      if (acked) { resolve(true); return; }
      if (document.getElementById("notes-ack-backdrop")) { resolve(false); return; }

      var wrap = document.createElement("div");
      wrap.id = "notes-ack-backdrop";
      wrap.setAttribute("style",
        "position:fixed;inset:0;background:rgba(20,28,14,.6);display:flex;align-items:center;" +
        "justify-content:center;z-index:10000;padding:20px;");
      wrap.innerHTML =
        '<div role="dialog" aria-modal="true" aria-labelledby="notes-ack-title" ' +
        'style="position:relative;background:#fff;border-radius:14px;max-width:520px;width:100%;' +
        'padding:26px 26px 22px;box-shadow:0 24px 60px rgba(20,28,14,.34);font-family:inherit;max-height:88vh;overflow:auto;">' +
        '<h2 id="notes-ack-title" style="font-size:19px;font-weight:700;color:#7a2018;margin:0 0 10px;">' +
        "Do not submit Protected Health Information</h2>" +
        '<p style="font-size:13.5px;color:#3a4326;margin:0 0 12px;line-height:1.6;">' +
        "Do not enter Protected Health Information (PHI) or personally identifiable information " +
        "(PII) — client names, dates, addresses, or any other identifier — into this tool.</p>" +
        '<p style="font-size:13.5px;color:#3a4326;margin:0 0 12px;line-height:1.6;">' +
        "Submitting PHI to a third-party AI service without a signed Business Associate Agreement " +
        "can violate the Health Insurance Portability and Accountability Act (HIPAA), the HITECH " +
        "Act, and other applicable federal, state, and local laws, statutes, and regulations. " +
        "<strong>You are solely responsible</strong> for ensuring no identifying information is " +
        "submitted.</p>" +
        '<p style="font-size:13.5px;color:#3a4326;margin:0 0 16px;line-height:1.6;">' +
        "This tool detects and removes names before anything is transmitted as a safeguard, but " +
        "it does not replace your professional and legal duty to de-identify your input. Review " +
        "everything you enter.</p>" +
        '<label style="display:flex;gap:9px;align-items:flex-start;font-size:13.5px;color:#2d3a1f;' +
        'cursor:pointer;margin-bottom:16px;line-height:1.5;">' +
        '<input id="notes-ack-cb" type="checkbox" style="margin-top:2px;width:17px;height:17px;flex:0 0 auto;" />' +
        "<span>I understand and accept responsibility for not submitting PHI/PII.</span></label>" +
        '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
        '<button id="notes-ack-cancel" type="button" style="padding:10px 16px;border:1.5px solid #c0d4a8;border-radius:8px;' +
        'background:#fff;color:#5a6b4a;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>' +
        '<button id="notes-ack-go" type="button" disabled style="padding:10px 18px;border:none;border-radius:8px;' +
        'background:#a8b896;color:#fff;font-size:14px;font-weight:600;cursor:not-allowed;">I understand — continue</button>' +
        "</div></div>";
      document.body.appendChild(wrap);

      var cb = document.getElementById("notes-ack-cb");
      var go = document.getElementById("notes-ack-go");
      var cancel = document.getElementById("notes-ack-cancel");
      var done = false;
      function finish(ok) {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", escHandler);
        wrap.remove();
        resolve(ok);
      }
      function escHandler(e) { if (e.key === "Escape") finish(false); }
      cb.addEventListener("change", function () {
        go.disabled = !cb.checked;
        go.style.background = cb.checked ? "#374528" : "#a8b896";
        go.style.cursor = cb.checked ? "pointer" : "not-allowed";
      });
      go.addEventListener("click", function () { if (!cb.checked) return; acked = true; finish(true); });
      cancel.addEventListener("click", function () { finish(false); });
      wrap.addEventListener("click", function (e) { if (e.target === wrap) finish(false); });
      document.addEventListener("keydown", escHandler);
      cb.focus();
    });
  }

  /* ─────────────────────── Review modal ─────────────────────── */

  function optionsHtml(defaultKey) {
    return ROLES.map(function (r) {
      return '<option value="' + r.key + '"' + (r.key === defaultKey ? " selected" : "") + ">" + r.label + "</option>";
    }).join("");
  }

  // Resolves { cancelled, map, certified }. With no detected names it resolves
  // immediately (no modal). Otherwise it opens a confirm-first dialog.
  function review(opts) {
    return new Promise(function (resolve) {
      var freeText = (opts && opts.freeText) || "";
      var names = detect(freeText);
      if (!names.length) { resolve({ cancelled: false, map: [], certified: [] }); return; }
      if (document.getElementById("notes-scrub-backdrop")) { resolve({ cancelled: true, map: [], certified: [] }); return; }

      var defaults = defaultTokens(names, freeText);
      var rows = names.map(function (name, i) {
        var d = defaults[i];
        var snip = snippetFor(name, freeText);
        return (
          '<div style="padding:10px 0;border-top:1px solid #eef2e6;">' +
          '<div style="font-size:14px;font-weight:700;color:#2d3a1f;word-break:break-word;margin-bottom:' + (snip ? "2px" : "6px") + ';">' + esc(name) + "</div>" +
          (snip ? '<div style="font-size:11.5px;color:#7a8a68;font-style:italic;margin-bottom:6px;word-break:break-word;">' + esc(snip) + "</div>" : "") +
          '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">' +
          '<label style="font-size:11px;color:#7a8a68;font-weight:600;">Replace with' +
          '<input type="text" data-rep value="' + esc(d.token) + '" ' +
          'style="display:block;margin-top:3px;padding:7px 9px;border:1.5px solid #c0d4a8;border-radius:7px;font-size:13px;color:#2d3a1f;width:130px;" /></label>' +
          '<label style="font-size:11px;color:#7a8a68;font-weight:600;">Role' +
          '<select data-role style="display:block;margin-top:3px;padding:7px 9px;border:1.5px solid #c0d4a8;border-radius:7px;font-size:13px;background:#fff;color:#2d3a1f;">' +
          optionsHtml(d.roleKey) + "</select></label>" +
          "</div>" +
          '<label style="display:inline-flex;gap:7px;align-items:center;font-size:12.5px;color:#5a6b4a;cursor:pointer;margin-top:8px;">' +
          '<input type="checkbox" data-cert style="width:15px;height:15px;" /> I certify this is not PII ' +
          '<span data-pii-toggle role="button" tabindex="0" aria-label="What is PII?" ' +
          'style="display:inline-flex;width:16px;height:16px;border-radius:50%;border:1px solid #c0d4a8;background:#eef4e6;' +
          'color:#5a7040;font-size:11px;font-weight:700;align-items:center;justify-content:center;cursor:pointer;">?</span></label>' +
          "</div>"
        );
      }).join("");

      var wrap = document.createElement("div");
      wrap.id = "notes-scrub-backdrop";
      wrap.setAttribute("style",
        "position:fixed;inset:0;background:rgba(20,28,14,.55);display:flex;align-items:center;" +
        "justify-content:center;z-index:9999;padding:20px;");
      wrap.innerHTML =
        '<div role="dialog" aria-modal="true" aria-labelledby="notes-scrub-title" ' +
        'style="position:relative;background:#fff;border-radius:14px;max-width:480px;width:100%;' +
        'padding:24px 24px 20px;box-shadow:0 24px 60px rgba(20,28,14,.32);font-family:inherit;max-height:88vh;overflow:auto;">' +
        '<h2 id="notes-scrub-title" style="font-size:18px;font-weight:700;color:#2d3a1f;margin:0 0 6px;">Remove names before continuing</h2>' +
        '<p style="font-size:13px;color:#5a6b4a;margin:0 0 4px;line-height:1.5;">' +
        "We found " + names.length + (names.length === 1 ? " name" : " names") +
        ". Confirm the replacement for each — it is applied before anything leaves your device. " +
        "All matching spellings (including different capitalization) are replaced.</p>" +
        '<div id="notes-scrub-pii" style="display:none;margin:8px 0;padding:10px 12px;border-radius:8px;' +
        'background:#fdf6e8;border:1.5px solid #d4b483;color:#5a4420;font-size:12px;line-height:1.55;">' + esc(PII_HELP) + "</div>" +
        '<div style="display:flex;justify-content:flex-end;margin:8px 0 4px;">' +
        '<button id="notes-scrub-all" type="button" style="padding:5px 13px;border:1.5px solid #c0d4a8;' +
        'border-radius:6px;background:#f0f4ec;color:#374528;font-size:12px;font-weight:600;cursor:pointer;">' +
        "Accept all suggestions</button></div>" +
        '<div style="margin:0 0 16px;">' + rows + "</div>" +
        '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
        '<button id="notes-scrub-cancel" type="button" style="padding:10px 16px;border:1.5px solid #c0d4a8;border-radius:8px;' +
        'background:#fff;color:#5a6b4a;font-size:14px;font-weight:600;cursor:pointer;">Edit notes</button>' +
        '<button id="notes-scrub-go" type="button" style="padding:10px 18px;border:none;border-radius:8px;' +
        'background:#374528;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Scrub &amp; continue</button>' +
        "</div></div>";
      document.body.appendChild(wrap);

      // Role change updates that row's replacement to the role's base token.
      var rowEls = wrap.querySelectorAll("[data-role]");
      for (var r = 0; r < rowEls.length; r++) {
        (function (sel) {
          var container = sel.closest("div").parentNode;
          var rep = container.querySelector("[data-rep]");
          var cert = container.querySelector("[data-cert]");
          sel.addEventListener("change", function () { rep.value = roleByKey(sel.value).token; });
          cert.addEventListener("change", function () {
            var off = cert.checked;
            rep.disabled = off; sel.disabled = off;
            rep.style.opacity = off ? "0.45" : "1";
            sel.style.opacity = off ? "0.45" : "1";
          });
        })(rowEls[r]);
      }
      // Mobile-friendly PII tooltip: any (?) toggles the shared info panel.
      var pii = document.getElementById("notes-scrub-pii");
      var toggles = wrap.querySelectorAll("[data-pii-toggle]");
      for (var t = 0; t < toggles.length; t++) {
        toggles[t].addEventListener("click", function (e) {
          e.preventDefault();
          pii.style.display = pii.style.display === "none" ? "block" : "none";
        });
        toggles[t].addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pii.style.display = pii.style.display === "none" ? "block" : "none"; }
        });
      }

      var done = false;
      function finish(result) {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", escHandler);
        wrap.remove();
        resolve(result);
      }
      function escHandler(e) { if (e.key === "Escape") finish({ cancelled: true, map: [], certified: [] }); }
      wrap.addEventListener("click", function (e) { if (e.target === wrap) finish({ cancelled: true, map: [], certified: [] }); });
      document.addEventListener("keydown", escHandler);
      document.getElementById("notes-scrub-cancel").addEventListener("click", function () {
        finish({ cancelled: true, map: [], certified: [] });
      });
      document.getElementById("notes-scrub-all").addEventListener("click", function () {
        var built = buildMap(names.map(function (name, i) {
          return { name: name, replacement: defaults[i].token, cert: false };
        }));
        finish({ cancelled: false, map: built.map, certified: built.certified });
      });
      document.getElementById("notes-scrub-go").addEventListener("click", function () {
        var reps = wrap.querySelectorAll("[data-rep]");
        var certs = wrap.querySelectorAll("[data-cert]");
        var selections = [];
        for (var i = 0; i < names.length; i++) {
          selections.push({ name: names[i], replacement: reps[i].value, cert: certs[i].checked });
        }
        var built = buildMap(selections);
        finish({ cancelled: false, map: built.map, certified: built.certified });
      });
      var go = document.getElementById("notes-scrub-go");
      if (go) go.focus();
    });
  }

  window.NotesScrub = {
    ROLES: ROLES,
    PII_HELP: PII_HELP,
    SCRUB_GUIDANCE: SCRUB_GUIDANCE,
    acknowledge: acknowledge,
    review: review,
    applyMap: applyMap,
    noticeText: noticeText,
    persistMap: persistMap,
    // exposed for testing / the stress-test page
    _detect: detect,
    _buildMap: buildMap,
    _guessRole: guessRole,
  };
})();
