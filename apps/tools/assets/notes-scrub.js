/*
 * notes-scrub.js - confirm-first PHI/PII review shared by the notes tools.
 *
 * Compliance model (no BAA / no ZDR): PHI must never reach the API. De-identifying
 * the input *before* anything is sent is the HIPAA control here - the API only ever
 * receives role tokens (Client, Caregiver, …). Two gates run before any prompt is
 * built or sent:
 *
 *   1. acknowledge() - a once-per-page-load legal notice the clinician must accept
 *      (submitting PHI to a third-party AI service without a BAA can violate HIPAA
 *      and other laws). Returns false if declined.
 *   2. review()      - every detected name is shown for confirmation. The clinician
 *      edits the replacement, picks a role, or certifies the term is not PII (which
 *      leaves it untouched). Confirmed names are replaced everywhere.
 *
 * Tokens stay in the output (de-identified AND retrievable - the clinician
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

  // What counts as PII/PHI - surfaced in the (?) tooltip on each row and in the
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
  // default - the clinician confirms or overrides every choice.
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
  // Uses word-boundary regex (not indexOf) to avoid substring false-hits like
  // "one" matching inside "done".
  function snippetFor(name, text) {
    if (!text) return "";
    var re;
    try {
      re = new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
    } catch (e) { return ""; }
    var match = re.exec(text);
    if (!match) return "";
    var idx = match.index;
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
  // (Web Crypto AES-GCM, key derived from a clinician passphrase via PBKDF2) - never
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
        "(PII) - client names, dates, addresses, or any other identifier - into this tool.</p>" +
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
        'background:#a8b896;color:#fff;font-size:14px;font-weight:600;cursor:not-allowed;">I understand - continue</button>' +
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

  // Non-name identifiers - DOB, phone, address, ZIP, email, SSN, MRN. Unlike a
  // name there is no clinical reason for one of these to be in a session note,
  // so they are tokenised outright rather than offered for review: removing the
  // click removes the chance of clicking through. They still appear in the
  // "removed before this left your device" notice.
  function identifierMap(freeText) {
    var s = scrub();
    return s && s.buildIdentifierMap ? s.buildIdentifierMap(freeText) : [];
  }

  /* Verifying MODEL OUTPUT, which is a different job from reviewing input.
   *
   * review() asks a person about names it found in what they typed. That is the
   * right shape for input and the wrong shape for output, for two reasons. The
   * output was generated from already-scrubbed input, so anything identifying in
   * it is either a role token the scrub itself inserted, or a leak - a name the
   * model invented or echoed from somewhere. Neither is something to ask a tired
   * clinician to adjudicate at 7pm. And a modal that appears after the note is
   * written trains people to click through it.
   *
   * So this does not ask. It reports, and the caller REFUSES TO STORE on a
   * finding. It exists because a before/after pair is generated clinical prose,
   * and keeping one is only safe if something has actually checked it first.
   *
   * Returns { clean, names, identifiers }. Names are returned as counts and
   * positions only - the caller is a storage gate and has no business receiving
   * the identifying strings it is meant to be keeping out.
   */
  /* IT DOES NOT USE detect(). That was the first version and it was wrong.
   *
   * detect() is a CANDIDATE GENERATOR for the review modal, deliberately
   * over-inclusive because a person adjudicates every hit. Measured against
   * ordinary clinical prose it returns "presented", "responded", "prompting",
   * "modeling". As a storage gate it would refuse essentially every pair, and
   * the capture loop would look like it was running while keeping nothing.
   *
   * What this uses instead:
   *   IDENTIFIERS   the existing precise patterns - phone, DOB, address, email,
   *                 SSN, MRN. No clinical reason for one to be here at all.
   *   RESIDUAL NAME a capitalised word that is not sentence-initial, not one of
   *                 the role tokens the scrub itself inserts, and not known
   *                 clinical vocabulary. The input was already scrubbed with a
   *                 person in the loop, so anything of that shape in the output
   *                 was invented or echoed, and either way it does not get kept.
   */
  /* WHY THIS IS A POSITIVE TEST AND NOT AN ALLOWLIST.
   *
   * The first version flagged any capitalised word that was not sentence-initial
   * and not on a hand-written list of field vocabulary. Measured against real
   * supervision prose it refused eight terms in a single paragraph: "Behavioral
   * Skills Training", "Discrete Trial Training", "Receptive Identification",
   * "Behavior Intervention Plan". ABA writing is full of capitalised programme
   * and technique names, so the gate kept almost nothing and said nothing about
   * why.
   *
   * detectNames has the same problem for the same reason - it is a candidate
   * generator for a modal where a person adjudicates every hit, and on the same
   * paragraph it returns "Natural Environment" and "Expressive Labeling".
   *
   * So this asks the narrower question the situation actually allows. The input
   * was scrubbed with a person in the loop before it ever reached the model, so
   * the output can only contain a personal name if the model invented one, and
   * an invented one will be an ordinary first name rather than a programme
   * title. FIRST_NAMES already holds that dictionary. A capitalised word counts
   * only if it IS a known first name.
   */
  function residualNames(t) {
    var g = scrub();
    if (!g || !g.isFirstName) return []; // caller fails shut on a missing gate
    var out = [];
    var toks = t.match(/[A-Za-z][A-Za-z'\u2019-]*/g) || [];
    for (var i = 0; i < toks.length; i++) {
      var w = toks[i];
      if (!/^[A-Z]/.test(w)) continue;
      if (!g.isFirstName(w)) continue;
      // A role token the scrub itself inserted is not a leak.
      if (ROLE_TOKENS[w.toLowerCase()]) continue;
      if (out.indexOf(w) === -1) out.push(w);
    }
    return out;
  }

  var ROLE_TOKENS = (function () {
    var set = {};
    for (var i = 0; i < ROLES.length; i++) set[ROLES[i].token.toLowerCase()] = true;
    return set;
  })();

  function verifyOutput(text) {
    var t = String(text || "");
    if (!t.trim()) return { clean: true, names: 0, identifiers: 0, kinds: [] };
    var idMap = identifierMap(t) || [];
    var names = residualNames(t);
    return {
      clean: names.length === 0 && idMap.length === 0,
      names: names.length,
      identifiers: idMap.length,
      // Kinds, never values: enough to tell a DOB leak from a phone leak when
      // reading a refusal count, and not enough to reconstruct either.
      kinds: idMap.map(function (m) { return m.kind || m.role || "identifier"; }),
    };
  }

  // Resolves { cancelled, map, certified }. With no detected names it resolves
  // immediately (no modal) - but any identifiers found are still mapped.
  // Otherwise it opens a confirm-first dialog for the names.
  function review(opts) {
    return new Promise(function (resolve) {
      var freeText = (opts && opts.freeText) || "";
      var idMap = identifierMap(freeText);
      var names = detect(freeText);
      if (!names.length) { resolve({ cancelled: false, map: idMap, certified: [] }); return; }
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
        ". Confirm the replacement for each - it is applied before anything leaves your device. " +
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
        // Identifiers ride along with whatever the clinician decided about the
        // names. They go FIRST in the map so a longer literal ("123 Jacob
        // Street") is replaced before a name nested inside it could break it.
        if (result && !result.cancelled) {
          result = { cancelled: false, map: idMap.concat(result.map || []), certified: result.certified || [] };
        }
        // Report the bare scrubbed words (names only, no context) to the admin PII review
        // queue. NotesGate.pii drops dictionary names and any words it can't transmit safely.
        // Identifiers are excluded: the point of that queue is to learn name
        // vocabulary, and a phone number is neither a word nor safe to transmit.
        if (result && !result.cancelled && result.map && result.map.length &&
            window.NotesGate && window.NotesGate.pii) {
          window.NotesGate.pii.reportScrubbed(
            result.map.filter(function (m) { return !m.identifier; }).map(function (m) { return m.name; })
          );
        }
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
        // Persist certified-non-PII terms so they are never flagged in future sessions.
        if (window.NotesGate && window.NotesGate.nonPii) {
          built.certified.forEach(function (name) { window.NotesGate.nonPii.saveTerm(name); });
        }
        finish({ cancelled: false, map: built.map, certified: built.certified });
      });
      var go = document.getElementById("notes-scrub-go");
      if (go) go.focus();
    });
  }

  /* ─────────────────── Live PHI highlighting ─────────────────── */
  // Overlay a transparent highlight layer behind each textarea so detected
  // name candidates glow yellow as the clinician types. Triggers after every
  // space, line break, or punctuation keystroke to encourage in-place editing
  // before the review dialog opens.
  //
  // Architecture: a position:relative wrapper div contains (a) an absolutely-
  // positioned highlight div with pointer-events:none at z-index 0, and (b) the
  // original textarea at z-index 1 with a transparent background. Font/padding
  // are cloned from the textarea's computed style so text positions align exactly.
  // Scroll sync keeps the two in lockstep.

  var HIGHLIGHT_TRIGGER_RE = /[\s.,!?;:()\[\]{}\-'"]/;

  function _syncHighlight(ta, hl) {
    var text = ta.value;
    var names = (window.NotesGate && window.NotesGate._scrub)
      ? window.NotesGate._scrub.detectNames(text)
      : [];

    if (!names.length) { hl.innerHTML = "​"; return; } // zero-width space keeps height

    // Escape HTML then wrap each detected name in a <mark>.
    var esc = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Sort longest-first so "Barbara Jean" is highlighted as a unit before "Barbara".
    var sorted = names.slice().sort(function (a, b) { return b.length - a.length; });
    sorted.forEach(function (name) {
      var re = new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
      esc = esc.replace(re, "<mark>$&</mark>");
    });

    hl.innerHTML = esc;
    hl.scrollTop = ta.scrollTop;
  }

  function _applyComputedStyle(src, dst) {
    var cs = window.getComputedStyle(src);
    // Font metrics - every property that affects character position.
    ["font", "fontSize", "fontFamily", "fontWeight", "fontStyle",
     "lineHeight", "letterSpacing", "wordSpacing",
     "wordWrap", "overflowWrap", "wordBreak", "tabSize", "textIndent",
     "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
     "boxSizing",
    ].forEach(function (p) { try { dst.style[p] = cs[p]; } catch (e) {} });
    // Transparent border - same dimensions as the textarea's border so the
    // content area (where text starts) aligns exactly. Without this the hl
    // text is offset left/up by the textarea's border width, causing the mark
    // to appear under the wrong characters (e.g. "Swing" → only "wing" glows).
    try {
      dst.style.borderStyle = cs.borderStyle;
      dst.style.borderTopWidth = cs.borderTopWidth;
      dst.style.borderRightWidth = cs.borderRightWidth;
      dst.style.borderBottomWidth = cs.borderBottomWidth;
      dst.style.borderLeftWidth = cs.borderLeftWidth;
      dst.style.borderColor = "transparent";
    } catch (e) {}
  }

  // Attaches a highlight overlay to one textarea. Idempotent via data attribute.
  function _attachHighlight(ta) {
    if (ta.dataset.phiHl) return;
    ta.dataset.phiHl = "1";

    var parent = ta.parentNode;
    var wrapper = document.createElement("div");
    wrapper.style.cssText = "position:relative;display:block;width:100%;";

    var hl = document.createElement("div");
    hl.setAttribute("aria-hidden", "true");
    // overflow:scroll (not hidden) so scrollTop sync works; scrollbar hidden via CSS.
    hl.style.cssText = [
      "position:absolute", "inset:0",
      "pointer-events:none",
      "overflow:scroll",
      "-ms-overflow-style:none",
      "scrollbar-width:none",
      "white-space:pre-wrap", "word-wrap:break-word",
      "color:transparent",
      "z-index:0",
    ].join(";");

    // Mark style: yellow bg, transparent text (real text in the textarea shows through).
    if (!document.getElementById("phi-highlight-style")) {
      var markCSS = document.createElement("style");
      markCSS.id = "phi-highlight-style";
      markCSS.textContent =
        "[data-phi-hl]{background:transparent!important;position:relative;z-index:1;}" +
        ".phi-hl-layer mark{background:#fffb80;color:transparent;border-radius:2px;}" +
        ".phi-hl-layer::-webkit-scrollbar{display:none;}";
      document.head.appendChild(markCSS);
    }
    hl.className = "phi-hl-layer";

    // Moving a node in the DOM blurs it. This runs on a timer that is not
    // synchronised with anything the clinician is doing, so it can land while
    // someone is already typing - and then their focus, their caret and the
    // keystrokes that follow all go to the body instead of the note. Record
    // where the caret was, move the textarea, and put both back.
    var hadFocus = document.activeElement === ta;
    var selStart = ta.selectionStart;
    var selEnd = ta.selectionEnd;
    var selDir = ta.selectionDirection;

    parent.insertBefore(wrapper, ta);
    wrapper.appendChild(hl);
    wrapper.appendChild(ta);

    if (hadFocus) {
      // preventScroll because the field was already on screen - refocusing it
      // must not jolt the page under the clinician mid-sentence.
      try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
      try { ta.setSelectionRange(selStart, selEnd, selDir); } catch (e) {}
    }

    // Clone computed style AFTER inserting so getComputedStyle is accurate.
    _applyComputedStyle(ta, hl);

    function update() { _syncHighlight(ta, hl); }

    ta.addEventListener("input", function () {
      var v = ta.value;
      if (!v.length || HIGHLIGHT_TRIGGER_RE.test(v[v.length - 1])) update();
    });
    ta.addEventListener("scroll", function () { hl.scrollTop = ta.scrollTop; });
    ta.addEventListener("blur", update);
    // Sync once on attach in case the field already has content.
    update();
  }

  // Finds all unprocessed textareas in the document and attaches highlighting.
  function installPHIHighlight() {
    document.querySelectorAll("textarea:not([data-phi-hl])").forEach(_attachHighlight);
  }

  // Auto-install: run after DOMContentLoaded and re-scan when auth state changes
  // (textareas may only appear after login unlocks the form).
  function _scheduleInstall() {
    setTimeout(installPHIHighlight, 200);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _scheduleInstall);
  } else {
    _scheduleInstall();
  }
  window.addEventListener("notes-auth-change", function () { setTimeout(installPHIHighlight, 300); });

  window.NotesScrub = {
    ROLES: ROLES,
    PII_HELP: PII_HELP,
    SCRUB_GUIDANCE: SCRUB_GUIDANCE,
    acknowledge: acknowledge,
    review: review,
    verifyOutput: verifyOutput,
    applyMap: applyMap,
    noticeText: noticeText,
    persistMap: persistMap,
    installPHIHighlight: installPHIHighlight,
    // exposed for testing / the stress-test page
    _detect: detect,
    _buildMap: buildMap,
    _guessRole: guessRole,
  };
})();
