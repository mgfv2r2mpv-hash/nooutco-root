/*
 * notes-gate.js - shared client engine for the notes tools.
 *
 * Two responsibilities:
 *   1. Auth gate  - password login that unlocks server-side "Generate Note".
 *                   Until logged in, the primary button is "Login"; after login
 *                   it becomes "Generate Note". "Generate Prompt" is unaffected.
 *   2. PII scrub  - automatic name detection + tokenization on data SENT OUT to
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
  // Prefix for locally-saved note drafts (one key per tool). Kept as a constant so
  // logout can wipe every tool's draft - clinician free-text may contain PHI and
  // must not linger in localStorage past the session on a shared/kiosk machine.
  var DRAFT_PREFIX = "notes_draft_";

  // Public Cloudflare Turnstile site key for the login bot check. This is a PUBLIC
  // value and safe to commit. Paste the Site Key from the Turnstile widget created for
  // tools.nooutco.me. Leave "" to disable Turnstile (login proceeds without it) - the
  // worker likewise skips verification unless TURNSTILE_SECRET is set, so both sides
  // must be configured for the check to be enforced.
  var TURNSTILE_SITEKEY = "0x4AAAAAADqSIXik1l5V3Nrd";

  // Cloudflare Super Bot Fight Mode (can't be fully disabled on this plan) challenges
  // every non-static request, so fetch()/XHR to /api/* receives challenge HTML instead
  // of JSON. Static file extensions are exempt, so we suffix API paths with ".js"; the
  // worker strips it before routing. Set to "" (and remove the worker strip) once the
  // edge stops challenging /api/* (e.g. SBFM "Definitely automated" set to Allow).
  var API_SUFFIX = ".js";
  // The ".js" suffix dodges the bot challenge, but Pages' static-asset layer also
  // intercepts clean ".js" GET paths (serving the SPA fallback) until a query string
  // forces the request through to the worker. A per-call cache-buster guarantees the
  // worker is hit and the response is never served stale from cache.
  function apiUrl(path) { return path + API_SUFFIX + (path.indexOf("?") === -1 ? "?" : "&") + "_=" + Date.now(); }

  // Reject with a clear, retryable error if a request stalls at the edge. Behind
  // Super Bot Fight Mode + Pages static-asset interception an /api/* request can
  // intermittently hang; without this the login modal would sit forever on
  // "Logging in…" with neither a close nor an error, forcing a note-losing refresh.
  var LOGIN_TIMEOUT_MS = 20000;
  // Generation is a real LLM round-trip. This bounds the whole request, so it -
  // not the model's own output ceiling - is what actually limits how long a note
  // can get: any part of a tool's maxTokens budget the model can't produce
  // before this fires is unreachable, and the abort still leaves the API call
  // billed. Raised from 45s alongside sup's larger cap so the budget is real.
  // It only fires on a stall; a normal generation returns as soon as it's done.
  var GEN_TIMEOUT_MS = 90000;
  function fetchWithTimeout(url, opts, ms, timeoutMsg) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal }))
      .catch(function (e) {
        if (e && e.name === "AbortError") throw userError(timeoutMsg);
        // Network-level failure (offline, DNS, blocked). The raw message is
        // "Failed to fetch", which tells a clinician nothing - but the situation
        // is one they can act on, so it stays visible rather than being masked.
        if (e instanceof TypeError) throw userError("Couldn't reach the server. Check your connection and try again.");
        throw e;
      })
      .finally(function () { clearTimeout(timer); });
  }

  /* ──────────────────── Error classification ──────────────────── */

  // Two classes of failure, deliberately separated.
  //
  // A *user-facing* error is one a clinician can act on - log in again, retry,
  // ask for access. Its message is written for them, so it is shown verbatim to
  // everyone.
  //
  // An *internal* error is a defect. Its message is engineering detail, so
  // non-admins see GENERIC_ERROR while the real message plus structural
  // diagnostics are filed as an internal ticket instead. Before this split a raw
  // JSON.parse SyntaxError was rendered straight into the note tool's error line,
  // and nothing was recorded about why it threw.
  var GENERIC_ERROR = "Something went wrong. Please try again - if it happens again, contact your administrator.";

  function userError(message) {
    var e = new Error(message);
    e.userFacing = true;
    return e;
  }

  // `diagnostics` is structural only - stop reason, lengths, parser position.
  // Never note content: model output is clinical prose even after scrubbing.
  function internalError(message, diagnostics) {
    var e = new Error(message);
    e.userFacing = false;
    e.diagnostics = diagnostics || null;
    return e;
  }

  // Compact one-line rendering of a diagnostics bag, shared by the admin's
  // on-screen message and the internal ticket.
  function diagnosticLine(d) {
    return Object.keys(d)
      .filter(function (k) { return d[k] !== null && d[k] !== undefined && d[k] !== ""; })
      .map(function (k) { return k + "=" + d[k]; })
      .join(" · ");
  }

  // What the UI renders for a caught error. Anything not explicitly marked
  // user-facing is treated as internal - an unrecognized throw fails closed to
  // the generic message rather than leaking whatever it happened to say.
  function displayError(e) {
    if (e && e.userFacing) return e.message || GENERIC_ERROR;
    if (!isAdmin()) return GENERIC_ERROR;
    var msg = (e && e.message) || GENERIC_ERROR;
    return e && e.diagnostics ? msg + " [" + diagnosticLine(e.diagnostics) + "]" : msg;
  }

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

  /* ─────────────── Draft storage (encrypted at rest) ───────────────
   *
   * A draft is the clinician's own typing, BEFORE the scrub gate runs - the one
   * place in this system where unredacted PHI legitimately exists. It used to
   * sit in localStorage as plaintext until logout, which on a shared clinic
   * laptop meant "until someone else opens devtools".
   *
   * Now: AES-GCM, with a NON-EXTRACTABLE CryptoKey held in IndexedDB. The key
   * material cannot be read by script at all - crypto.subtle will use it but
   * never export it - so a dump of localStorage or of the IndexedDB file yields
   * ciphertext and a key handle that is useless outside this origin.
   *
   * Be clear about what this is not: script running ON this origin can still
   * call decrypt. This defends against passive inspection, device backups and
   * drafts outliving the session - not against an attacker already executing in
   * the page. The hard TTL below is the other half, and the more important one.
   */

  var DRAFT_TTL_MS = 12 * 60 * 60 * 1000; // hard expiry regardless of logout
  var KEY_DB = "noaba-notes";
  var KEY_STORE = "keys";
  var KEY_ID = "draft-key-v1";

  // In-memory plaintext cache. Reads are synchronous against this so the React
  // engine keeps its existing synchronous draft.load(); writes go through it
  // first and encrypt in the background.
  var draftCache = {};
  var draftKeyPromise = null;

  function idb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(KEY_DB, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(KEY_STORE)) req.result.createObjectStore(KEY_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet(db, k) {
    return new Promise(function (resolve, reject) {
      var r = db.transaction(KEY_STORE, "readonly").objectStore(KEY_STORE).get(k);
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function idbPut(db, k, v) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(KEY_STORE, "readwrite");
      t.objectStore(KEY_STORE).put(v, k);
      t.oncomplete = function () { resolve(); };
      t.onerror = function () { reject(t.error); };
    });
  }

  // Reuse the stored key so drafts survive a reload; mint one on first use.
  // extractable:false is the whole point - do not "fix" it to true.
  function draftKey() {
    if (draftKeyPromise) return draftKeyPromise;
    draftKeyPromise = (function () {
      if (!window.indexedDB || !window.crypto || !crypto.subtle) return Promise.resolve(null);
      return idb().then(function (db) {
        return idbGet(db, KEY_ID).then(function (existing) {
          if (existing) return existing;
          return crypto.subtle
            .generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
            .then(function (k) { return idbPut(db, KEY_ID, k).then(function () { return k; }); });
        });
      }).catch(function () { return null; });
    })();
    return draftKeyPromise;
  }

  function b64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(str) {
    var bin = atob(str);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function encryptDraft(obj) {
    return draftKey().then(function (key) {
      var plain = new TextEncoder().encode(JSON.stringify(obj));
      // No key (no WebCrypto / private-mode IndexedDB): store nothing rather
      // than silently falling back to plaintext. Losing a draft is recoverable;
      // writing unredacted PHI to disk in the clear is not.
      if (!key) return null;
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plain).then(function (buf) {
        return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(new Uint8Array(buf)), savedAt: Date.now() });
      });
    });
  }

  function decryptDraft(raw) {
    var rec;
    try { rec = JSON.parse(raw); } catch (e) { return Promise.resolve(null); }
    if (!rec || rec.v !== 1 || !rec.iv || !rec.ct) return Promise.resolve(null);
    if (!rec.savedAt || Date.now() - rec.savedAt > DRAFT_TTL_MS) return Promise.resolve(null);
    return draftKey().then(function (key) {
      if (!key) return null;
      return crypto.subtle
        .decrypt({ name: "AES-GCM", iv: unb64(rec.iv) }, key, unb64(rec.ct))
        .then(function (buf) { return JSON.parse(new TextDecoder().decode(buf)); })
        .catch(function () { return null; }); // key rotated or record tampered
    });
  }

  // Decrypt every stored draft into the cache once, before the UI renders.
  // Anything expired, corrupt, or written under a key we no longer hold is
  // dropped from storage here rather than lingering as undecryptable noise.
  var draftsReady = (function () {
    var pending = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(DRAFT_PREFIX) === 0) pending.push(k);
      }
    } catch (e) {}
    return Promise.all(pending.map(function (k) {
      var id = k.slice(DRAFT_PREFIX.length);
      var raw = localStorage.getItem(k);
      return decryptDraft(raw).then(function (obj) {
        if (obj) draftCache[id] = obj;
        else { try { localStorage.removeItem(k); } catch (e) {} }
      });
    })).then(function () { return true; }).catch(function () { return true; });
  })();

  // Remove every tool's saved draft. Called on logout so pre-scrub clinician
  // free-text (possible PHI) never outlives the session on a shared machine.
  function clearAllDrafts() {
    draftCache = {};
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(DRAFT_PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }

  function logout() {
    clearAllDrafts();
    // Anything still buffered belongs to the technician who is leaving. These
    // flush under whatever token is present when they next go out, so on a
    // shared clinic laptop -- which is the normal case here, not an edge one --
    // surviving an explicit logout means one person's events land against the
    // next person's login code. Unsent is the right outcome; misattributed is
    // not. A token that merely expires still keeps its buffer, because that is
    // the same technician coming back.
    try { localStorage.removeItem(AUDIT_BUFFER_KEY); } catch (e) {}
    try { localStorage.removeItem(CORRECTION_BUFFER_KEY); } catch (e) {}
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
  // Drives whether a raw error message is shown on screen. The token is signed
  // and the server re-checks every call, so a forged "admin" payload reveals
  // engineering detail to whoever forged it and nothing more.
  function isAdmin() {
    var p = tokenPayload();
    if (!p || (p.exp && p.exp * 1000 < Date.now())) return false;
    return p.role === "admin";
  }
  function canUseTool(toolId) {
    var p = tokenPayload();
    if (!p || (p.exp && p.exp * 1000 < Date.now())) return false;
    if (isAdmin()) return true;
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
  function login(password, turnstileToken) {
    return fetchWithTimeout(apiUrl("/api/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password, turnstileToken: turnstileToken || "" }),
    }, LOGIN_TIMEOUT_MS, "Login is taking too long - please retry.").then(function (res) {
      // Read as text first: if a Cloudflare edge challenge intercepts the request it
      // returns HTML, not JSON. Surface a clear message instead of a raw JSON-parse error.
      return res.text().then(function (raw) {
        var data;
        try { data = JSON.parse(raw); }
        catch (e) {
          throw userError("The login service is unreachable (a security check blocked the request). Please retry, or contact the administrator if it persists.");
        }
        if (!res.ok || !data.token) {
          throw userError(data && data.error ? data.error : "Login failed.");
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
      '<div id="notes-login-turnstile" style="margin-top:12px;"></div>' +
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

    // Cloudflare Turnstile bot check - active only when a site key is configured.
    // The script (challenges.cloudflare.com/turnstile/v0/api.js) loads async, so poll
    // briefly for window.turnstile before rendering into the modal container.
    var tsToken = "";
    var tsWidgetId = null;
    if (TURNSTILE_SITEKEY) {
      submit.disabled = true; // require a verification token before enabling submit
      (function renderTs(tries) {
        if (!window.turnstile || !window.turnstile.render) {
          if (tries > 0) { setTimeout(function () { renderTs(tries - 1); }, 200); return; }
          // Out of retries. Saying nothing here leaves a permanently dead Log in
          // button and no reason for it, which reads as "the tool is broken and
          // I have done something wrong". Name what failed and what to try.
          err.textContent = "The verification check could not load. Reload the page, "
            + "and if it keeps happening report it from the assistant.";
          err.style.display = "block";
          return;
        }
        try {
          tsWidgetId = window.turnstile.render("#notes-login-turnstile", {
            sitekey: TURNSTILE_SITEKEY,
            callback: function (t) { tsToken = t; submit.disabled = false; },
            "expired-callback": function () { tsToken = ""; submit.disabled = true; },
            "error-callback": function () { tsToken = ""; submit.disabled = true; },
          });
        } catch (e) {}
      })(25);
    }

    document.getElementById("notes-login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      err.style.display = "none";
      if (TURNSTILE_SITEKEY && !tsToken) {
        err.textContent = "Please complete the verification check.";
        err.style.display = "block";
        return;
      }
      submit.disabled = true; submit.textContent = "Logging in…";
      login(pw.value, tsToken).then(function () {
        close();
      }).catch(function (ex) {
        var msg = ex.message || "Login failed.";
        err.textContent = msg;
        err.style.display = "block";
        submit.disabled = false; submit.textContent = "Log in";
        // Email the admin about non-credential login failures (service/config/challenge
        // errors) so breakage is noticed even if no one reports it. Routine wrong-password
        // attempts are skipped. Best-effort and tokenless (the user isn't logged in yet);
        // bounded server-side by dedupe + an hourly budget.
        if (!/incorrect password/i.test(msg)) {
          fetch(apiUrl("/api/error-report"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tool: "login", message: msg, timestamp: new Date().toISOString() }),
          }).catch(function () {});
        }
        // Turnstile tokens are single-use; reset so the clinician can retry.
        if (TURNSTILE_SITEKEY && window.turnstile && tsWidgetId !== null) {
          try { window.turnstile.reset(tsWidgetId); } catch (e) {}
          tsToken = ""; submit.disabled = true;
        }
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
    return llmCall({
      systemPrompt: opts.systemPrompt,
      userPrompt: opts.userPrompt,
      model: opts.model || "claude-haiku-4-5-20251001",
      maxTokens: opts.maxTokens || 3000,
      tool: opts.tool,
      output_config: outputConfigFor(opts.responseSchema),
    }).then(function (r) { return r.parsed; });
  }

  // Multi-turn variant for the revision flow: sends the whole conversation
  // ({system, messages}); the worker adds prompt-cache markers so replayed
  // history is served from Anthropic's 5-minute prefix cache instead of being
  // recomputed. Resolves {parsed, rawText, usage} - rawText must be appended to
  // the conversation verbatim so the next turn's cache prefix matches.
  function generateConversation(opts) {
    return llmCall({
      system: opts.system,
      messages: opts.messages,
      model: opts.model || "claude-haiku-4-5-20251001",
      maxTokens: opts.maxTokens || 3000,
      tool: opts.tool,
      // The owning clinician's stored judgement is composed in server-side ONLY
      // when the caller asks for it, which is his ruling: an opinion never fills
      // a silence in the input. Sent as a literal true or omitted entirely, so a
      // truthy value cannot open the gate by accident. Every existing call path
      // leaves it undefined and behaves exactly as it did before.
      want_opinions: opts.wantOpinions === true ? true : null,
      output_config: outputConfigFor(opts.responseSchema),
    }, opts.expectKeys);
  }

  /* Prose, not a note. Used by "What would you do here?", which asks for advice
     to read rather than a note to serialize.
   *
   * It cannot go through llmCall, and finding out why is the reason this exists:
   * llmCall parses every response as the note JSON, and a parse failure is
   * "resamplable", so a prose answer would be requested twice and then thrown
   * away as malformed. Advice is the one call whose correct output is not JSON,
   * so it needs a path that never tries. */
  function generateProse(opts) {
    return llmPost({
      system: opts.system,
      messages: opts.messages,
      model: opts.model || "claude-haiku-4-5-20251001",
      maxTokens: opts.maxTokens || 1200,
      tool: opts.tool,
      want_opinions: opts.wantOpinions === true ? true : null,
    }).then(function (res) {
      if (res.status === 401) { setToken(""); throw userError("Session expired - please log in again."); }
      return res.json().then(function (data) {
        if (!res.ok) {
          throw internalError(
            "API error " + res.status + ": " + (data && data.error ? data.error : res.statusText),
            { stage: "http", status: res.status }
          );
        }
        return {
          text: (data.content || []).map(function (b) { return b.text || ""; }).join("").trim(),
          usage: data.usage || null,
          stopReason: data.stop_reason || null,
        };
      });
    });
  }

  // Constrains the model's answer to the tool's JSON Schema, so the note is
  // serialized by the API instead of being hand-typed as prose - which is what
  // makes the two escaping slips below impossible rather than recoverable.
  // Absent when a tool declares no schema, so tools can adopt this one at a
  // time and an un-migrated one keeps today's behaviour.
  function outputConfigFor(schema) {
    if (!schema) return null;
    return { format: { type: "json_schema", schema: schema } };
  }

  function llmPost(body) {
    // Drop null/undefined fields so an un-migrated tool sends no output_config
    // key at all, rather than an explicit null the worker has to special-case.
    var payload = {};
    Object.keys(body).forEach(function (k) {
      if (body[k] !== null && body[k] !== undefined) payload[k] = body[k];
    });
    return fetchWithTimeout(apiUrl("/api/llm-call"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + getToken(),
      },
      body: JSON.stringify(payload),
    }, GEN_TIMEOUT_MS, "Note generation timed out - please retry.");
  }

  // The model hand-serializes the whole draft as JSON, so one missed escape
  // anywhere in a ~1000-token object used to throw away the clinician's entire
  // note. repairModelJson (below) recovers the losslessly-fixable slips; this
  // covers the rest with a single resample. Resampling is the only safe answer
  // to an unescaped interior quote - a tacting SAP quotes its demands verbatim
  // ("What is it?"), and repairing that would mean guessing where the string was
  // meant to end, silently dropping clinical text. Sampling variance is what
  // makes the second call likely to land; the request is byte-identical, so it
  // reuses the same server-side prompt-cache prefix.
  // `expectKeys` are the top-level keys the tool's prompt contracts for. Parsing
  // proves the bytes are JSON, not that they are the note: the brace slice is a
  // greedy first-{ to last-}, so a stray brace in model prose can yield a
  // fragment that parses perfectly and carries none of the note. normalizeOutput
  // is deliberately tolerant of missing keys, so such a fragment used to render
  // as a note with silently blank sections. Checking shape here is what makes it
  // safe to be more forgiving about syntax above.
  function llmCall(body, expectKeys) {
    var attempt = function () {
      return llmPost(body).then(parseNoteResponse).then(function (r) {
        var missing = missingKeys(r.parsed, expectKeys);
        if (!missing.length) return r;
        // Key names are schema, not note content - safe to name in a ticket.
        throw internalError("Model response is missing required sections.", {
          stage: "shape",
          stopReason: r.stopReason,
          missingKeys: missing.join(","),
        });
      });
    };
    return attempt().catch(function (e) {
      if (!isResamplable(e)) throw e;
      return attempt().catch(function (e2) {
        if (e2 && e2.diagnostics) e2.diagnostics.retried = true;
        throw e2;
      });
    });
  }

  // Presence, not substance. A key present but thin is a clinical judgement the
  // hints system already covers; a key absent means the object is not the note
  // the prompt asked for. Callers that pass no key list opt out entirely.
  function missingKeys(parsed, expectKeys) {
    if (!expectKeys || !expectKeys.length) return [];
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return expectKeys.slice();
    return expectKeys.filter(function (k) {
      return !Object.prototype.hasOwnProperty.call(parsed, k);
    });
  }

  // Only a defect in what the model produced earns a second call. A max_tokens
  // truncation is not a slip - the resample hits the same cap, and it is the one
  // case that can present as either bad syntax or missing keys, so both stages
  // check it. HTTP/auth/timeout failures are the caller's or the network's
  // business, not the sampler's.
  function isResamplable(e) {
    var d = e && !e.userFacing && e.diagnostics;
    if (!d || d.stopReason === "max_tokens") return false;
    return d.stage === "parse" || d.stage === "shape";
  }

  // A control character is never legal inside a JSON string literal, so finding
  // one there is unambiguous: the model wrote the character where it owed the
  // escape. Rewriting it is lossless and - because the scan tracks string state
  // the same way a parser does - cannot alter text that already parses. Runs
  // only after a straight parse has failed.
  var CONTROL_ESCAPE = { "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t" };

  function repairModelJson(text) {
    var out = "", inStr = false, esc = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (!inStr) { out += ch; if (ch === '"') inStr = true; continue; }
      if (esc)         { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === '"')  { out += ch; inStr = false; continue; }
      var code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += CONTROL_ESCAPE[ch] || ("\\u" + ("000" + code.toString(16)).slice(-4));
        continue;
      }
      out += ch;
    }
    return out;
  }

  function tryParse(s) {
    try { return { ok: true, value: JSON.parse(s) }; }
    catch (err) { return { ok: false, error: (err && err.message) || "unknown" }; }
  }

  function parseNoteResponse(res) {
    if (res.status === 401) { setToken(""); throw userError("Session expired - please log in again."); }
    if (res.status === 403) {
      return res.json().then(function (data) {
        throw userError((data && data.error) || "Your access doesn't include this tool.");
      });
    }
    return res.json().then(function (data) {
      if (!res.ok) {
        throw internalError(
          "API error " + res.status + ": " + (data && data.error ? data.error : res.statusText),
          { stage: "http", status: res.status }
        );
      }
      var raw = (data.content || []).map(function (b) { return b.text || ""; }).join("");
      // Structural only, never note content. This is enough to tell the two
      // failure modes apart: a response truncated at the token cap
      // (stopReason=max_tokens, sliceChars near the limit) versus one the model
      // simply malformed, where parseError names the offending position.
      var diag = {
        stage: "parse",
        model: data.model || null,
        stopReason: data.stop_reason || null,
        rawChars: raw.length,
        outputTokens: (data.usage && data.usage.output_tokens) || null,
      };
      // Greedy first-{ to last-} slice: tolerant of a stray preamble, but it also
      // means a brace anywhere in the model's prose can start the slice off the
      // JSON entirely. Recorded so a bad slice is distinguishable from bad JSON.
      var match = raw.match(/\{[\s\S]*\}/);
      if (!match) {
        diag.braceMatch = false;
        throw internalError("No JSON object found in the model response.", diag);
      }
      diag.sliceChars = match[0].length;
      var attempt = tryParse(match[0]);
      if (!attempt.ok) {
        var repaired = tryParse(repairModelJson(match[0]));
        // Recorded either way: a draft that only survived repair is still a
        // model that is mis-serializing, and worth seeing in the ticket stream.
        if (repaired.ok) { diag.repaired = true; attempt = repaired; }
      }
      // stopReason rides along so the shape check downstream can tell a model
      // that dropped sections from one that was cut off at the cap.
      if (attempt.ok) {
        return {
          parsed: attempt.value,
          rawText: raw,
          usage: data.usage || null,
          stopReason: data.stop_reason || null,
        };
      }
      // The first parse's position is the informative one - the repaired text is
      // not what the model actually emitted.
      diag.parseError = attempt.error;
      throw internalError(
        data.stop_reason === "max_tokens"
          ? "Model output hit the token cap mid-JSON - raise maxTokens for this tool."
          : "Model returned malformed JSON.",
        diag
      );
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

  // Common US first names (lowercase). Any word in the note matching one of these
  // is flagged as a name candidate regardless of capitalisation, giving the clinician
  // a chance to certify it as non-PII or assign a role token. Sourced from SSA
  // most-popular baby names; intentionally excludes words that are also common English
  // nouns/verbs (e.g. "grace", "may" are intentionally included as they are more
  // often names in ABA clinical context than regular words).
  var FIRST_NAMES = {};
  ("james john robert michael william david richard joseph thomas charles " +
   "christopher daniel matthew anthony mark donald steven paul andrew joshua " +
   "kenneth kevin brian george timothy ronald edward jason jeffrey ryan jacob " +
   "gary nicholas eric jonathan stephen larry justin scott brandon benjamin " +
   "samuel raymond gregory frank alexander patrick jack dennis jerry tyler " +
   "aaron adam nathan henry zachary douglas peter kyle noah ethan jeremy " +
   "christian walter keith austin roger terry sean gerald carl harold dylan " +
   "arthur lawrence jordan jesse bryan billy joe bruce gabriel logan albert " +
   "willie alan wayne elijah roy eugene randy louis russell bobby philip " +
   "johnny vincent liam mason caleb hunter evan carter eli luke landon owen " +
   "oliver cole max aiden gavin cameron jayden ian brody blake nolan xavier " +
   "chase sebastian tristan marcus travis cody garrett derek ricky nelson " +
   "darius devonte jamal jaylen malik rashard tariq tyrone zion denzel " +
   "marquis dante terrence lamar quinton deon demarcus jeremiah isaiah " +
   "jose juan carlos miguel jorge alejandro diego pablo sergio andres " +
   "manuel mario victor roberto enrique rafael raphael raphy omar ivan felix julian abel " +
   "arturo hugo oscar pedro raul ernesto javier francisco alfonso hector " +
   "armando antonio emilio rodrigo alberto mauricio leandro tomas " +
   "wei ming jin yang kenji hiroshi yuki jun chen lei tao kai " +
   "mary patricia jennifer linda barbara elizabeth susan jessica sarah karen " +
   "lisa nancy betty margaret sandra ashley kimberly emily donna michelle " +
   "carol amanda melissa deborah stephanie rebecca sharon laura cynthia " +
   "kathleen amy angela shirley anna brenda pamela emma nicole helen samantha " +
   "katherine christine debra rachel carolyn janet catherine maria heather " +
   "diane julie joyce victoria kelly christina lauren joan evelyn olivia " +
   "judith megan cheryl martha andrea frances hannah teresa jacqueline gloria " +
   "kathryn sara janice jean alice madison doris abigail julia grace amber " +
   "denise beverly danielle marilyn brittany diana natalie sophia rose " +
   "isabella alexis tiffany kayla charlotte alyssa taylor brooke crystal " +
   "destiny jasmine sierra autumn brianna savannah skylar sydney kaylee " +
   "avery aaliyah alexa ava chloe claire ella gianna hailey haley lily " +
   "mia naomi paige piper ruby stella zoe layla maya ariana kylie mackenzie " +
   "peyton kennedy leah vanessa mariah tonya robin connie misty angie holly " +
   "erica molly miranda penny vera agnes miriam yolanda wanda tanya candace " +
   "felicia tracey stacy wendy gina sylvia lori tara april georgia dawn " +
   "eleanor edna tina kristen monique nakia raven tanisha tiara imani " +
   "keisha latoya ebony latasha shanice camille rosalyn deja essence fatima " +
   "amara nadia sofia valentina camila lucia gabriela alejandra claudia " +
   "monica rosa elena isabel carmen fernanda catalina adriana natalia " +
   "daniela paola ana bianca carolina diana esperanza eva graciela " +
   "guadalupe ingrid iris liliana lorena luisa marisol marta norma pilar " +
   "raquel rocio rosario silvana verónica xochitl yasmin " +
   "abby brianna breanna caitlin caroline cassandra cassidy cecilia celeste " +
   "cheyenne courtney dakota darlene dawn deanna destiny devon diamond " +
   "dolores dominique dora elaine elisa eliza elsie erin estelle esther " +
   "eve faith flora florence gail genevieve gertrude ginger gladys glenda " +
   "greta harriet ilene irene jade jada jenna jenny jewel jillian jolene " +
   "josephine joy judy june justine kate katie kaylee kelsey kendra kim " +
   "kira kirsten lacey leila lenora leona lillian lindsay lynne macy " +
   "madeline madelyn maggie mandy maxine melanie mindy muriel myra nadine " +
   "nellie nora norah paulette phyllis polly priscilla renee rhonda rita " +
   "roberta rowena ruth sabrina sally selena selina sherry stacy stefanie " +
   "sue tamara tammie tammy theresa tori traci tricia valerie viola violet " +
   "virginia vivian whitney wilma zelda bethany concepcion consuela delia " +
   "dominga elba elvira flor hortensia lupe marina marisol nereida nilda " +
   "rafaela soledad xiomara yareli")
    .split(/\s+/).forEach(function (w) { if (w) FIRST_NAMES[w] = true; });

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
    fetch(apiUrl("/api/nonpii"), { headers: { "Authorization": "Bearer " + tok } })
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
      fetch(apiUrl("/api/nonpii"), {
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
      fetch(apiUrl("/api/nonpii"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
        body: JSON.stringify({}),
      }).catch(function () {});
    }
  }

  /* ─────────────── Audit / usage events ───────────────
   *
   * Content-free by construction. An event carries counts, durations and a tool
   * id - never a word of the note. That is what makes it safe to keep a durable
   * record at all given this system stores nothing else.
   *
   * Two jobs, one mechanism: an audit trail of who generated what and when, and
   * the usage signal a supervisor needs to see whether the tool is being engaged
   * with or pasted past. The server re-validates the shape, so a modified client
   * cannot turn this into a text channel.
   *
   * Buffered locally and flushed opportunistically: a failed POST must never
   * cost a clinician their note, so nothing here is awaited on a hot path.
   */
  var AUDIT_BUFFER_KEY = "noaba.audit.buffer.v1";
  var AUDIT_MAX = 500; // bounded ring - a long offline stretch must not grow forever

  function auditBuffer() {
    try { return JSON.parse(localStorage.getItem(AUDIT_BUFFER_KEY)) || []; } catch (e) { return []; }
  }
  function writeAuditBuffer(list) {
    try { localStorage.setItem(AUDIT_BUFFER_KEY, JSON.stringify(list.slice(-AUDIT_MAX))); } catch (e) {}
  }

  // Numbers and short enums only. Anything else is dropped here, before it can
  // reach the buffer - the client-side half of "this cannot carry note text".
  function sanitizeAuditData(data) {
    var out = {};
    if (!data || typeof data !== "object") return out;
    Object.keys(data).slice(0, 12).forEach(function (k) {
      var v = data[k];
      if (typeof v === "number" && isFinite(v)) out[k] = Math.round(v);
      else if (typeof v === "boolean") out[k] = v;
      else if (typeof v === "string" && /^[a-z0-9_-]{1,24}$/i.test(v)) out[k] = v;
    });
    return out;
  }

  function auditEmit(type, data) {
    if (!/^[a-z_]{1,32}$/.test(type || "")) return;
    var list = auditBuffer();
    list.push({ type: type, tool: (data && data.tool) || null, ts: Date.now(), data: sanitizeAuditData(data) });
    writeAuditBuffer(list);
    auditFlush();
  }

  /* ── Style corrections ──────────────────────────────────────────────
     A measurement of how the technician rewrote a draft, never the rewrite
     itself. window.NoteStyleFeatures produces these; this only carries them.
     Buffered separately from audit events because they mean different things
     and are stored in different places, but flushed on the same request so a
     revision does not cost two round trips. ── */

  var CORRECTION_BUFFER_KEY = "noaba.corrections.buffer.v1";

  function correctionBuffer() {
    try { return JSON.parse(localStorage.getItem(CORRECTION_BUFFER_KEY)) || []; } catch (e) { return []; }
  }
  function writeCorrectionBuffer(list) {
    try { localStorage.setItem(CORRECTION_BUFFER_KEY, JSON.stringify(list.slice(-AUDIT_MAX))); } catch (e) {}
  }

  // The same "drop it, never coerce it" rule the audit path uses. A feature is
  // a short slug from a closed list; a direction is exactly -1 or 1.
  function sanitizeCorrection(c) {
    if (!c || typeof c !== "object") return null;
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(c.feature || "")) return null;
    var direction = c.direction > 0 ? 1 : c.direction < 0 ? -1 : 0;
    if (!direction) return null;
    var mag = typeof c.magnitude === "number" && isFinite(c.magnitude)
      ? Math.max(0, Math.min(1, c.magnitude)) : 1;
    return {
      feature: c.feature,
      direction: direction,
      magnitude: mag,
      source: c.source === "manual" ? "manual" : "revision",
      ts: Date.now(),
    };
  }

  function auditCorrections(list) {
    if (!list || !list.length) return;
    var clean = [];
    for (var i = 0; i < list.length && clean.length < 20; i++) {
      var c = sanitizeCorrection(list[i]);
      if (c) clean.push(c);
    }
    if (!clean.length) return;
    writeCorrectionBuffer(correctionBuffer().concat(clean));
    auditFlush();
  }

  var auditFlushing = false;
  function auditFlush() {
    if (auditFlushing) return;
    var tok = getToken();
    if (!tok) return; // events for a logged-out page have no technician to attribute
    var list = auditBuffer();
    var corr = correctionBuffer();
    if (!list.length && !corr.length) return;
    auditFlushing = true;
    var batch = list.slice(0, 50);
    var corrBatch = corr.slice(0, 50);
    fetch(apiUrl("/api/audit"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
      body: JSON.stringify({ events: batch, corrections: corrBatch }),
    })
      .then(function (r) {
        // Only drop what the server accepted. A 5xx leaves the batch buffered
        // for the next attempt rather than silently losing the record.
        if (!r.ok) return;
        writeAuditBuffer(auditBuffer().slice(batch.length));

        // Corrections are a separate question. The request succeeds even when
        // the profile store is unreachable or not yet deployed - that is the
        // fail-open design and it is right for the note - but dropping them on
        // that basis would discard the evidence while reporting success.
        // Keeping them means a technician's card starts populated the day the
        // store goes live, instead of needing five fresh corrections first.
        // The buffer is a bounded ring, so a store that never arrives costs a
        // fixed amount of localStorage and nothing else.
        return r.json().then(function (d) {
          if (d && d.profile === "ok") {
            writeCorrectionBuffer(correctionBuffer().slice(corrBatch.length));
          }
        });
      })
      .catch(function () {})
      .then(function () { auditFlushing = false; });
  }

  /* ─────────────── Learned style card ───────────────
     The technician's own card: rules derived from their corrections, plus the
     block that gets folded into the system prompt. Read through the tools
     worker, never from the profile store directly - the browser has no route
     to that and must not have one.

     Fails soft on every path. An empty card is a legitimate answer (a new
     technician has one), and so is an unreachable profile store, so callers
     cannot tell those apart and do not need to. ── */

  function styleCardGet() {
    var tok = getToken();
    if (!tok) return Promise.resolve({ rules: [], block: "", available: false });
    return fetch(apiUrl("/api/style-card"), { headers: { Authorization: "Bearer " + tok } })
      .then(function (r) { return r.ok ? r.json() : { rules: [], block: "", available: false }; })
      .catch(function () { return { rules: [], block: "", available: false }; });
  }

  // Muting is a deliberate action, so unlike the read this reports failure -
  // a rule the technician switched off must not keep shaping their notes while
  // the UI says otherwise.
  function styleCardMute(feature, muted) {
    var tok = getToken();
    if (!tok) return Promise.resolve(false);
    return fetch(apiUrl("/api/style-card/mute"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
      body: JSON.stringify({ feature: feature, muted: !!muted }),
    })
      .then(function (r) { return r.ok; })
      .catch(function () { return false; });
  }

  /* ─────────────── PII candidate capture (admin review queue) ─────────────── */

  // Fire-and-forget: report bare scrubbed words into the admin PII review queue.
  // PHI-safe by construction - only the lowercase word is sent (no surrounding text,
  // no client/session/date linkage), and words already in the FIRST_NAMES dictionary
  // are dropped here so we transmit only the heuristic-only catches worth reviewing.
  function reportScrubbed(terms) {
    var tok = getToken();
    if (!tok || !terms || !terms.length) return;
    var seen = {};
    var out = [];
    terms.forEach(function (t) {
      var lc = (t || "").toLowerCase().trim();
      if (!lc || seen[lc]) return;
      seen[lc] = true;
      if (FIRST_NAMES[lc]) return; // already in the dictionary - nothing to learn
      out.push(lc);
    });
    if (!out.length) return;
    fetch(apiUrl("/api/scrub-report"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
      body: JSON.stringify({ terms: out }),
    }).catch(function () {});
  }

  // Detect candidate person names: runs of 1-2 capitalized words not in the
  // stoplist. ALL-CAPS acronyms (CLIENT, BCBA, ABA) are never matched. A trailing
  // possessive (‘s) is stripped so "Jacob’s" maps to "Jacob".
  //
  // Sentence-position heuristic: words at sentence starts are capitalized by grammar,
  // not necessarily because they are proper nouns. They are downgraded - skipped
  // unless they also appear capitalized mid-sentence elsewhere, are in FIRST_NAMES,
  // or appear in a high-confidence grammatical context (possessive, role label,
  // preposition). This suppresses false positives from ABA program names like
  // "Tolerating Delays" or "Requesting Breaks" that open sentences.
  var NAME_WORD = "[A-Z][A-Za-z’’\\-]*[a-z]";
  function detectNames(text) {
    if (!text) return [];

    // Load clinician-certified non-PII terms so they are never flagged again.
    var excluded = {};
    loadNonPii().forEach(function (e) { excluded[e.term] = true; });

    // Build sentence-start and mid-sentence capitalized sets from sentence structure.
    var sentenceStartWords = {};
    var midSentenceCapitalized = {};
    text.split(/[.!?]\s+|\n/).forEach(function (sent) {
      var tokens = sent.trim().split(/\s+/);
      tokens.forEach(function (tok, idx) {
        var clean = tok.replace(/[^A-Za-z’\-]/g, "").replace(/[‘’]s$/i, "");
        if (clean.length < 2) return;
        var cl = clean.toLowerCase();
        if (idx === 0) {
          sentenceStartWords[cl] = true;
        } else if (/^[A-Z]/.test(clean)) {
          midSentenceCapitalized[cl] = true;
        }
      });
    });

    // Context-signal pre-pass: near-certain name positions in ABA clinical notes.
    // These bypass the sentence-start downgrade even if only at sentence starts.
    var contextNames = {};
    var SIMPLE_CAP = "([A-Z][a-z]{1,15}(?:[\\-’][A-Za-z]{1,})?)";
    [
      // role label immediately followed by a capitalized word: "client Jacob", "mom Sarah"
      new RegExp("\\b(?:client|caregiver|mom|dad|mother|father|guardian|bt|rbt|technician|teacher)\\s+" + SIMPLE_CAP + "\\b", "gi"),
      // possessive form - separate simple pattern avoids NAME_WORD consuming the ‘s
      new RegExp("\\b" + SIMPLE_CAP + "[‘’]s\\b", "g"),
      // after common prepositions: "with Jacob", "for Sarah", "beside Mark"
      new RegExp("\\b(?:with|for|beside)\\s+" + SIMPLE_CAP + "\\b", "gi"),
    ].forEach(function (cr) {
      var cm;
      while ((cm = cr.exec(text)) !== null) {
        var cname = cm[1];
        var cl = cname.toLowerCase();
        if (!excluded[cl] && !STOPWORDS[cl]) contextNames[cl] = cname;
      }
    });

    var seen = {};
    var out = [];
    function push(name) {
      var key = name.toLowerCase();
      if (!seen[key] && !excluded[key]) { seen[key] = true; out.push(name); }
    }

    // Add context-signal names first (bypass sentence-start filter).
    Object.keys(contextNames).forEach(function (k) { push(contextNames[k]); });

    var re = new RegExp("\\b(" + NAME_WORD + "(?:\\s+" + NAME_WORD + ")?)\\b", "g");
    var m;
    while ((m = re.exec(text)) !== null) {
      var phrase = m[1].replace(/[‘’]s$/, ""); // drop possessive
      var words = phrase.split(/\s+/);
      var meaningful = words.filter(function (w) {
        var wl = w.toLowerCase();
        if (STOPWORDS[wl] || excluded[wl]) return false;
        // Downgrade: sentence-start word that never appears mid-sentence capitalized,
        // not in FIRST_NAMES, and not in a high-confidence context → skip.
        if (sentenceStartWords[wl] && !midSentenceCapitalized[wl] && !FIRST_NAMES[wl] && !contextNames[wl]) return false;
        return true;
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

    // Nickname/prefix pass - flag any 3+ char word (any case) that is a strict
    // prefix of a detected name (e.g. "barb" matches "barbara").
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

    // First-names dictionary pass - flags any word (any case) whose lowercase
    // form is in the known-names list. Catches "mark", "barbara", etc. even when
    // typed all-lowercase and not caught by the NAME_WORD capitalisation heuristic.
    var dictRe = /\b([A-Za-z]{2,})\b/g;
    var dm;
    while ((dm = dictRe.exec(text)) !== null) {
      var dw = dm[1];
      var dwl = dw.toLowerCase();
      if (seen[dwl] || excluded[dwl] || STOPWORDS[dwl]) continue;
      if (FIRST_NAMES[dwl]) push(dw);
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

  /* ─────────── Non-name identifiers ───────────
   *
   * The on-page disclaimer has always named dates of birth, addresses, phone
   * numbers and ID/insurance numbers as PHI. Detection only ever covered person
   * names, so the tool was advertising a control it did not have.
   *
   * These are handled differently from names, deliberately. A name gets a review
   * modal because the clinician may want to map it to a role, or certify it as
   * not a person at all ("Grace" the program). None of that applies to a phone
   * number: there is no clinical reason for one to be in a session note, so
   * these are tokenised outright and merely reported afterwards. Removing the
   * click removes the chance of clicking through.
   *
   * Ordered longest-match-first at the call site so a ZIP inside an address is
   * not replaced before the address that contains it.
   */
  var IDENTIFIER_PATTERNS = [
    // Do SSN before the generic ID rule so it is labelled correctly.
    { type: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
    { type: "EMAIL", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
    // Street address: number + up to three words + a street-type suffix.
    // No trailing \.? - swallowing the sentence's full stop into the literal
    // would leave the replacement dangling against the next word.
    { type: "ADDRESS", re: /\b\d{1,6}\s+(?:[A-Za-z][A-Za-z.'-]*\s+){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Ct|Court|Way|Pl|Place|Ter|Terrace|Cir|Circle|Hwy|Highway)\b/gi },
    // Numeric and written dates. Deliberately broad: a session note never needs
    // one, and the notice tells the clinician exactly what was taken.
    { type: "DATE", re: /\b(?:0?[1-9]|1[0-2])[/\-.](?:0?[1-9]|[12]\d|3[01])[/\-.](?:19|20)?\d{2}\b/g },
    { type: "DATE", re: /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t)?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+(?:19|20)\d{2}\b/gi },
    // Phone, with or without country code / punctuation.
    { type: "PHONE", re: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g },
    // Labelled record/member/policy identifiers.
    { type: "ID", re: /\b(?:MRN|MR#|member(?:\s+ID)?|policy|insurance|subscriber|chart|record)\s*(?:#|no\.?|number|id)?\s*:?\s*[A-Z0-9][A-Z0-9-]{4,}\b/gi },
    // A bare 5-digit ZIP only when it follows a state abbreviation.
    { type: "ZIP", re: /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g },
  ];

  // Returns [{text, type}] - the literal matched substrings, longest first, with
  // any match wholly contained in an earlier (longer) one dropped so nested
  // replacements cannot corrupt each other.
  function detectIdentifiers(text) {
    if (!text) return [];
    var hits = [];
    IDENTIFIER_PATTERNS.forEach(function (p) {
      var re = new RegExp(p.re.source, p.re.flags);
      var m;
      while ((m = re.exec(text)) !== null) {
        if (!m[0] || !m[0].trim()) continue;
        hits.push({ text: m[0].trim(), type: p.type, at: m.index });
        if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
      }
    });
    hits.sort(function (a, b) { return b.text.length - a.text.length; });
    var kept = [];
    hits.forEach(function (h) {
      var swallowed = kept.some(function (k) {
        return k.text !== h.text && k.text.indexOf(h.text) !== -1;
      });
      var dupe = kept.some(function (k) { return k.text === h.text; });
      if (!swallowed && !dupe) kept.push({ text: h.text, type: h.type });
    });
    return kept;
  }

  // Map entries in the same {name, token} shape the name map uses, so they flow
  // through applyScrub and the "removed before this left your device" notice
  // without either needing to know there are two kinds.
  function buildIdentifierMap(text) {
    var counts = {};
    return detectIdentifiers(text).map(function (h) {
      counts[h.type] = (counts[h.type] || 0) + 1;
      return { name: h.text, token: "[" + h.type + "_" + counts[h.type] + "]", identifier: true };
    });
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function applyScrub(text, map) {
    var result = text;
    map.forEach(function (e) {
      // \b only asserts anything next to a WORD character. Names are words, so
      // wrapping them was fine; identifier literals are not - "(555) 213-4477"
      // starts with "(" and "1420 Maple Street." ends with ".", and demanding a
      // boundary there makes the replace silently match nothing. Apply each
      // boundary only on the side that actually has a word character.
      var lead = /^\w/.test(e.name) ? "\\b" : "";
      var tail = /\w$/.test(e.name) ? "\\b" : "";
      result = result.replace(new RegExp(lead + escapeRe(e.name) + tail, "gi"), e.token);
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

  // Load AI-learned algorithm overrides (public endpoint, no token needed).
  // Merges Claude-suggested stopwords/firstNames into the in-memory dictionaries.
  fetch(apiUrl("/api/scrub-config"))
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      (d.stopwords || []).forEach(function (w) { STOPWORDS[w.toLowerCase()] = true; });
      (d.firstNames || []).forEach(function (w) { FIRST_NAMES[w.toLowerCase()] = true; });
    })
    .catch(function () {});

  window.NotesGate = {
    isLoggedIn: isLoggedIn,
    canUseTool: canUseTool,
    subscribe: subscribe,
    openLogin: openLogin,
    login: login,
    logout: logout,
    token: getToken,
    apiUrl: apiUrl,
    isAdmin: isAdmin,
    generateNote: generateNote,
    generateConversation: generateConversation,
    generateProse: generateProse,
    // Error rendering - callers pass the caught error, never e.message, so the
    // user-facing/internal split is applied in one place.
    displayError: displayError,
    // Certified-non-PII store - localStorage cache + KV server backing.
    nonPii: { load: loadNonPii, saveTerm: saveNonPiiTerm, clear: clearNonPii, sync: syncNonPii },
    // PII candidate capture - reports bare scrubbed words to the admin review queue.
    pii: { reportScrubbed: reportScrubbed },
    // Content-free audit / usage events. Counts and enums only, never note text.
    styleCard: { get: styleCardGet, mute: styleCardMute },
    audit: {
      emit: auditEmit,
      corrections: auditCorrections,
      flush: auditFlush,
      _buffer: auditBuffer,
      _corrections: correctionBuffer,
    },
    // Local draft persistence for the note tools - keeps a clinician's typed note
    // across a page reload so a refresh (or an errant one) never loses their work.
    // Encrypted at rest (see "Draft storage" above) and hard-expired after 12h.
    // `ready` resolves once stored drafts are decrypted; the UI awaits it before
    // first render, which is what lets load() stay synchronous.
    draft: {
      ready: draftsReady,
      load: function (key) {
        var v = draftCache[key];
        return v === undefined ? null : v;
      },
      save: function (key, obj) {
        // Cache first so a reload during the async write still sees the note,
        // and so load() right after save() is consistent.
        draftCache[key] = obj;
        encryptDraft(obj).then(function (blob) {
          if (!blob) return;
          try { localStorage.setItem(DRAFT_PREFIX + key, blob); } catch (e) {}
        }).catch(function () {});
      },
      clear: function (key) {
        delete draftCache[key];
        try { localStorage.removeItem(DRAFT_PREFIX + key); } catch (e) {}
      },
      clearAll: clearAllDrafts,
    },
    // exposed for testing / advanced use
    _scrub: {
      detectNames: detectNames, buildNameMap: buildNameMap,
      detectIdentifiers: detectIdentifiers, buildIdentifierMap: buildIdentifierMap,
      // A POSITIVE test for a personal first name, for callers that need to gate
      // storage rather than offer a human a list to review. detectNames is
      // deliberately over-inclusive because a person adjudicates every hit; used
      // as a gate it refuses ordinary clinical prose ("Behavioral Skills",
      // "Receptive Identification") and keeps nothing.
      isFirstName: function (w) {
        return !!FIRST_NAMES[String(w || "").toLowerCase().replace(/[^a-z'\-]/g, "")];
      },
      applyScrub: applyScrub, restoreDeep: restoreDeep,
    },
    _json: { repair: repairModelJson },
  };
})();
