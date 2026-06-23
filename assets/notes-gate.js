/*
 * notes-gate.js — shared client engine for the notes tools.
 *
 * Two responsibilities:
 *   1. Auth gate  — password login that unlocks server-side "Generate Note".
 *                   Until logged in, the primary button is "Login"; after login
 *                   it becomes "Generate Note". "Generate Prompt" is unaffected.
 *   2. PII scrub  — automatic name detection + tokenization on data SENT OUT to
 *                   the API, with restoration of the real names in the returned
 *                   text. The LLM never sees client/staff names; the clinician's
 *                   drafted note still reads with the real names.
 *
 * Framework-agnostic (vanilla). The React pages read state via NotesGate.isLoggedIn()
 * and re-render by subscribing to NotesGate.subscribe().
 */
(function () {
  "use strict";

  var TOKEN_KEY = "notes_auth_token";
  var EVT = "notes-auth-change";

  /* ───────────────────────── Auth ───────────────────────── */

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  // Decode the exp claim from our `<payload>.<sig>` token without verifying the
  // signature (the server verifies on every call; this is only for UI state).
  function tokenExp(tok) {
    try {
      var payload = tok.split(".")[0];
      var json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
      return typeof json.exp === "number" ? json.exp : 0;
    } catch (e) {
      return 0;
    }
  }

  function isLoggedIn() {
    var tok = getToken();
    if (!tok) return false;
    var exp = tokenExp(tok);
    if (exp && exp * 1000 < Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      return false;
    }
    return true;
  }

  function setToken(tok) {
    if (tok) localStorage.setItem(TOKEN_KEY, tok);
    else localStorage.removeItem(TOKEN_KEY);
    window.dispatchEvent(new Event(EVT));
  }

  function logout() {
    setToken("");
  }

  // Decode the token payload (role + allowed tools). The server re-checks scope
  // on every call; this only drives the UI (which button to show per tool).
  function tokenPayload() {
    var tok = getToken();
    if (!tok) return null;
    try {
      return JSON.parse(atob(tok.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
    } catch (e) { return null; }
  }
  function canUseTool(toolId) {
    var p = tokenPayload();
    if (!p || (p.exp && p.exp * 1000 < Date.now())) return false;
    if (p.role === "admin") return true;
    return Array.isArray(p.tools) && p.tools.indexOf(toolId) !== -1;
  }

  function subscribe(cb) {
    var handler = function () { cb(isLoggedIn()); };
    window.addEventListener(EVT, handler);
    window.addEventListener("storage", function (e) {
      if (!e || e.key === null || e.key === TOKEN_KEY) handler();
    });
    return function () { window.removeEventListener(EVT, handler); };
  }

  // POST the password to the worker; on success store the returned session token.
  function login(password) {
    return fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password }),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data.token) {
          throw new Error(data && data.error ? data.error : "Login failed.");
        }
        setToken(data.token);
        syncNonPii();
        return data;
      });
    });
  }

  /* ─────────────────────── Login modal ─────────────────────── */

  function openLogin() {
    if (document.getElementById("notes-login-backdrop")) return;
    var wrap = document.createElement("div");
    wrap.id = "notes-login-backdrop";
    wrap.setAttribute("style",
      "position:fixed;inset:0;background:rgba(20,28,14,.55);display:flex;align-items:center;" +
      "justify-content:center;z-index:9999;padding:20px;");
    wrap.innerHTML =
      '<div role="dialog" aria-modal="true" aria-labelledby="notes-login-title" ' +
      'style="position:relative;background:#fff;border-radius:14px;max-width:380px;width:100%;' +
      'padding:26px 24px;box-shadow:0 24px 60px rgba(20,28,14,.32);font-family:inherit;">' +
      '<button id="notes-login-x" aria-label="Close" style="position:absolute;top:10px;right:12px;' +
      'border:none;background:none;font-size:22px;line-height:1;color:#7a8a68;cursor:pointer;">&times;</button>' +
      '<h2 id="notes-login-title" style="font-size:18px;font-weight:700;color:#2d3a1f;margin:0 0 6px;">Log in</h2>' +
      '<p style="font-size:13px;color:#5a6b4a;margin:0 0 14px;line-height:1.5;">' +
      'Enter your access password to enable <strong>Generate Note</strong>. ' +
      'Generate Prompt stays available without logging in.</p>' +
      '<form id="notes-login-form">' +
      '<input id="notes-login-pw" type="password" autocomplete="current-password" placeholder="Password" ' +
      'style="width:100%;padding:11px 12px;border:1.5px solid #c0d4a8;border-radius:8px;font-size:14px;box-sizing:border-box;" />' +
      '<div id="notes-login-err" style="display:none;color:#c0392b;font-size:13px;margin-top:8px;"></div>' +
      '<button id="notes-login-submit" type="submit" ' +
      'style="margin-top:14px;width:100%;padding:12px;border:none;border-radius:8px;background:#374528;color:#fff;' +
      'font-size:15px;font-weight:600;cursor:pointer;">Log in</button>' +
      '</form></div>';
    document.body.appendChild(wrap);

    var close = function () { wrap.remove(); };
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    document.getElementById("notes-login-x").addEventListener("click", close);
    var escHandler = function (e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); } };
    document.addEventListener("keydown", escHandler);

    var pw = document.getElementById("notes-login-pw");
    var err = document.getElementById("notes-login-err");
    var submit = document.getElementById("notes-login-submit");
    pw.focus();
    document.getElementById("notes-login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      err.style.display = "none";
      submit.disabled = true; submit.textContent = "Logging in…";
      login(pw.value).then(function () {
        close();
      }).catch(function (ex) {
        err.textContent = ex.message || "Login failed.";
        err.style.display = "block";
        submit.disabled = false; submit.textContent = "Log in";
        pw.select();
      });
    });
  }

  /* ─────────────── Authenticated note generation ─────────────── */

  // Calls the server with the session token; the server uses its own API key.
  // No provider/API key leaves the browser. The caller is responsible for
  // scrubbing names out of `userPrompt` first (see notes-scrub.js / NotesScrub):
  // the de-identified role tokens (CLIENT, CAREGIVER, …) are intentionally kept
  // in the returned draft so it stays retrievable, so we do NOT restore names.
  function generateNote(opts) {
    var systemPrompt = opts.systemPrompt;
    var userPrompt = opts.userPrompt;

    return fetch("/api/llm-call", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken(),
      },
      body: JSON.stringify({
        systemPrompt: systemPrompt,
        userPrompt: userPrompt,
        model: opts.model || "claude-haiku-4-5-20251001",
        maxTokens: opts.maxTokens || 3000,
        tool: opts.tool,
      }),
    }).then(function (res) {
      if (res.status === 401) { setToken(""); throw new Error("Session expired — please log in again."); }
      if (res.status === 403) {
        return res.json().then(function (data) {
          throw new Error((data && data.error) || "Your access doesn't include this tool.");
        });
      }
      return res.json().then(function (data) {
        if (!res.ok) throw new Error("API error " + res.status + ": " + (data && data.error ? data.error : res.statusText));
        var raw = (data.content || []).map(function (b) { return b.text || ""; }).join("");
        var match = raw.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("No JSON found in response. Try again.");
        return JSON.parse(match[0]);
      });
    });
  }

  /* ───────────────────────── Scrub ───────────────────────── */

  // Words that are Title-Case but are not person names. Over-scrubbing is safe
  // (it round-trips back identically) but degrades the model's context, so we
  // exclude the common offenders: roles, place-of-service, days, months, and
  // frequent sentence-initial words.
  var STOPWORDS = {};
  ("Monday Tuesday Wednesday Thursday Friday Saturday Sunday " +
   "January February March April May June July August September October November December " +
   "Home School Clinic Community Telehealth Center Office Daycare " +
   "BCBA BCaBA RBT BT ABA EHR PHI AI Client Caregiver Parent Technician Teacher Staff Specialist Mom Dad Mother Father " +
   "He She They The This That These Those There Their When While After Before During With Without And But For " +
   "No Yes None Note Session Today Tomorrow Yesterday Goal Target Program Behavior Antecedent Response " +
   "I We You It If As At In On Of To Per " +
   "Mr Mrs Ms Dr " +
   // Common capitalized sentence-initial words & high-frequency clinical verbs that
   // are NOT names. Filtering these keeps a leading word from riding along with a
   // real name ("Then Jacob" -> "Jacob", "Saw MacArthur" -> "MacArthur").
   "Then Also Additionally However Therefore Overall Throughout Initially Later Afterward Subsequently " +
   "Once Upon Each Both Either Neither Some Most Many Several Few Another Other Next First Second Third Final " +
   "Met Saw Worked Used Ran Reviewed Completed Started Continued Did Was Were Been Had Has Have Got Went Came " +
   "Took Gave Said Asked Began Run Tried Made Put Kept Held Played Ate Drank Slept Arrived Left Returned Spoke " +
   "Talked Walked Sat Stood Helped Modeled Practiced Provided Observed Noted Demonstrated Engaged Discussed " +
   "Reported Initiated Prompted Redirected Reinforced Transitioned Followed Implemented Conducted Administered " +
   "Will Would Could Should May Might Must Can Do Does Done Get Go Come Make Take See " +
   // Pronouns that capitalise at sentence start
   "His Her Him Hers Them Their " +
   // Greetings / common sentence-starters
   "Hi Hello Hey " +
   // Common verbs / imperatives that capitalise at sentence start
   "Call Called Ask Asked Tell Told Send Sent " +
   // Number words and quantifiers
   "One Two Three Four Five Six Seven Eight Nine Ten " +
   // Role tokens (added as roles, should never be re-detected as names)
   "Sibling Peer")
    .split(/\s+/).forEach(function (w) { if (w) STOPWORDS[w.toLowerCase()] = true; });

  /* ─────────────── Certified-non-PII store ─────────────── */

  // Certified-non-PII store. localStorage is the fast cache; /api/nonpii is the
  // source of truth, synced on every authenticated page load and on every save.
  // Each entry: { term: string (lowercase), certifiedAt: ISO string }.
  var NONPII_KEY = "noaba.nonpii.v1";

  function loadNonPii() {
    try { return JSON.parse(localStorage.getItem(NONPII_KEY)) || []; } catch (e) { return []; }
  }

  function _writeLocal(list) {
    try { localStorage.setItem(NONPII_KEY, JSON.stringify(list)); } catch (e) {}
  }

  // Pull from server and merge into localStorage (union by term).
  function syncNonPii() {
    var tok = getToken();
    if (!tok) return;
    fetch("/api/nonpii", { headers: { "Authorization": "Bearer " + tok } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !Array.isArray(d.terms)) return;
        var local = loadNonPii();
        var seen = {};
        local.forEach(function (e) { seen[e.term] = true; });
        var merged = local.slice();
        d.terms.forEach(function (e) { if (!seen[e.term]) { merged.push(e); seen[e.term] = true; } });
        _writeLocal(merged);
      })
      .catch(function () {});
  }

  function saveNonPiiTerm(term) {
    var lc = (term || "").toLowerCase().trim();
    if (!lc) return;
    var list = loadNonPii();
    if (list.some(function (e) { return e.term === lc; })) return;
    var entry = { term: lc, certifiedAt: new Date().toISOString() };
    _writeLocal(list.concat([entry]));
    // Fire-and-forget to server; localStorage already updated so detection is instant.
    var tok = getToken();
    if (tok) {
      fetch("/api/nonpii", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
        body: JSON.stringify(entry),
      }).catch(function () {});
    }
  }

  function clearNonPii() {
    try { localStorage.removeItem(NONPII_KEY); } catch (e) {}
    var tok = getToken();
    if (tok) {
      fetch("/api/nonpii", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
        body: JSON.stringify({}),
      }).catch(function () {});
    }
  }

  // Detect candidate person names: runs of 1–2 capitalized words not in the
  // stoplist. A "word" starts with a capital, may carry internal capitals,
  // apostrophes, or hyphens (McKenzie, O'Brien, DeShawn, Anne-Marie), and ends
  // lowercase — so ALL-CAPS tokens/acronyms (CLIENT, BCBA, ABA) are never matched,
  // which keeps our own role tokens from being re-detected. A trailing possessive
  // ('s) is stripped so "Jacob's" maps to "Jacob" (applyScrub, case-insensitive,
  // then catches "Jacob" inside "Jacob's"). The review step backstops false
  // positives, so detection errs toward catching more.
  var NAME_WORD = "[A-Z][A-Za-z’’\\-]*[a-z]";
  function detectNames(text) {
    if (!text) return [];

    // Load clinician-certified non-PII terms so they are never flagged again.
    var excluded = {};
    loadNonPii().forEach(function (e) { excluded[e.term] = true; });

    var re = new RegExp("\\b(" + NAME_WORD + "(?:\\s+" + NAME_WORD + ")?)\\b", "g");
    var seen = {};
    var out = [];
    function push(name) {
      var key = name.toLowerCase();
      if (!seen[key] && !excluded[key]) { seen[key] = true; out.push(name); }
    }
    var m;
    while ((m = re.exec(text)) !== null) {
      var phrase = m[1].replace(/[‘’]s$/, ""); // drop possessive
      var words = phrase.split(/\s+/);
      var meaningful = words.filter(function (w) {
        return !STOPWORDS[w.toLowerCase()] && !excluded[w.toLowerCase()];
      });
      if (meaningful.length === 0) continue;
      if (meaningful.length === words.length) {
        push(phrase);
        // Also push each word individually so that a standalone lowercase occurrence
        // (e.g. "barbara" when "Barbara Jean" was detected) is covered by
        // applyScrub’s case-insensitive flag on the individual-word entry.
        if (words.length > 1) words.forEach(push);
      } else {
        meaningful.forEach(push);
      }
    }
    // Nickname/prefix pass — flag any 3+ char word (any case) that is a strict
    // prefix of a detected name (e.g. "barb" matches "barbara"). This catches
    // abbreviated nicknames that look like common lowercase words at first glance.
    var lowerDetected = out.map(function (n) { return n.toLowerCase(); });
    var pfxRe = /\b([A-Za-z]{3,})\b/g;
    var pm;
    while ((pm = pfxRe.exec(text)) !== null) {
      var w = pm[1];
      var wl = w.toLowerCase();
      if (seen[wl] || excluded[wl] || STOPWORDS[wl]) continue;
      if (lowerDetected.some(function (n) { return n !== wl && n.startsWith(wl); })) {
        push(w);
      }
    }

    // Longest first so "Barbara Jean" is replaced before "Barbara".
    out.sort(function (a, b) { return b.length - a.length; });
    return out;
  }

  function buildNameMap(text) {
    return detectNames(text).map(function (name, i) {
      return { name: name, token: "[NAME_" + (i + 1) + "]" };
    });
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function applyScrub(text, map) {
    var result = text;
    map.forEach(function (e) {
      result = result.replace(new RegExp("\\b" + escapeRe(e.name) + "\\b", "gi"), e.token);
    });
    return result;
  }

  // Recursively replace tokens back with the original names in any string value.
  function restoreDeep(value, map) {
    if (typeof value === "string") {
      var s = value;
      map.forEach(function (e) { s = s.split(e.token).join(e.name); });
      return s;
    }
    if (Array.isArray(value)) return value.map(function (v) { return restoreDeep(v, map); });
    if (value && typeof value === "object") {
      var o = {};
      Object.keys(value).forEach(function (k) { o[k] = restoreDeep(value[k], map); });
      return o;
    }
    return value;
  }

  // On page load, pull server list so detectNames benefits immediately.
  if (isLoggedIn()) syncNonPii();

  window.NotesGate = {
    isLoggedIn: isLoggedIn,
    canUseTool: canUseTool,
    subscribe: subscribe,
    openLogin: openLogin,
    login: login,
    logout: logout,
    token: getToken,
    generateNote: generateNote,
    // Certified-non-PII store — localStorage cache + KV server backing.
    nonPii: { load: loadNonPii, saveTerm: saveNonPiiTerm, clear: clearNonPii, sync: syncNonPii },
    // exposed for testing / advanced use
    _scrub: { detectNames: detectNames, buildNameMap: buildNameMap, applyScrub: applyScrub, restoreDeep: restoreDeep },
  };
})();
