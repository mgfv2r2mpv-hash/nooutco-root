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
  // No provider/API key leaves the browser. Returns the parsed JSON object the
  // notes tools expect (first {...} block in the model's text), with names restored.
  function generateNote(opts) {
    var systemPrompt = opts.systemPrompt;
    var userPrompt = opts.userPrompt;
    var map = buildNameMap(userPrompt);
    var scrubbedUser = applyScrub(userPrompt, map);

    return fetch("/api/llm-call", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken(),
      },
      body: JSON.stringify({
        systemPrompt: systemPrompt,
        userPrompt: scrubbedUser,
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
        var parsed = JSON.parse(match[0]);
        return restoreDeep(parsed, map); // put the real names back into the draft
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
   "BCBA BCaBA RBT BT ABA EHR PHI AI Client Caregiver Parent Technician Teacher Staff Mom Dad Mother Father " +
   "He She They The This That These Those There Their When While After Before During With Without And But For " +
   "No Yes None Note Session Today Tomorrow Yesterday Goal Target Program Behavior Antecedent Response " +
   "I We You It If As At In On Of To Per " +
   "January Mr Mrs Ms Dr")
    .split(/\s+/).forEach(function (w) { if (w) STOPWORDS[w.toLowerCase()] = true; });

  // Detect candidate person names: runs of 1–2 Title-Case words not in the stoplist.
  function detectNames(text) {
    if (!text) return [];
    var re = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g;
    var seen = {};
    var out = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      var phrase = m[1];
      // A multi-word phrase counts if ANY word is a plausible name; a single word
      // must not be a stopword.
      var words = phrase.split(/\s+/);
      var meaningful = words.filter(function (w) { return !STOPWORDS[w.toLowerCase()]; });
      if (meaningful.length === 0) continue;
      var key = phrase.toLowerCase();
      if (!seen[key]) { seen[key] = true; out.push(phrase); }
    }
    // Longest first so "John Smith" is tokenized before "John".
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

  window.NotesGate = {
    isLoggedIn: isLoggedIn,
    canUseTool: canUseTool,
    subscribe: subscribe,
    openLogin: openLogin,
    login: login,
    logout: logout,
    token: getToken,
    generateNote: generateNote,
    // exposed for testing / advanced use
    _scrub: { detectNames: detectNames, buildNameMap: buildNameMap, applyScrub: applyScrub, restoreDeep: restoreDeep },
  };
})();
