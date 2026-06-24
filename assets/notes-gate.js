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

  // Public Cloudflare Turnstile site key for the login bot check. This is a PUBLIC
  // value and safe to commit. Paste the Site Key from the Turnstile widget created for
  // tools.nooutco.me. Leave "" to disable Turnstile (login proceeds without it) — the
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
  function login(password, turnstileToken) {
    return fetch(apiUrl("/api/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password, turnstileToken: turnstileToken || "" }),
    }).then(function (res) {
      // Read as text first: if a Cloudflare edge challenge intercepts the request it
      // returns HTML, not JSON. Surface a clear message instead of a raw JSON-parse error.
      return res.text().then(function (raw) {
        var data;
        try { data = JSON.parse(raw); }
        catch (e) {
          throw new Error("The login service is unreachable (a security check blocked the request). Please retry, or contact the administrator if it persists.");
        }
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

    // Cloudflare Turnstile bot check — active only when a site key is configured.
    // The script (challenges.cloudflare.com/turnstile/v0/api.js) loads async, so poll
    // briefly for window.turnstile before rendering into the modal container.
    var tsToken = "";
    var tsWidgetId = null;
    if (TURNSTILE_SITEKEY) {
      submit.disabled = true; // require a verification token before enabling submit
      (function renderTs(tries) {
        if (!window.turnstile || !window.turnstile.render) {
          if (tries > 0) setTimeout(function () { renderTs(tries - 1); }, 200);
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
    var systemPrompt = opts.systemPrompt;
    var userPrompt = opts.userPrompt;

    return fetch(apiUrl("/api/llm-call"), {
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

  // Detect candidate person names: runs of 1–2 capitalized words not in the
  // stoplist. ALL-CAPS acronyms (CLIENT, BCBA, ABA) are never matched. A trailing
  // possessive (‘s) is stripped so "Jacob’s" maps to "Jacob".
  //
  // Sentence-position heuristic: words at sentence starts are capitalized by grammar,
  // not necessarily because they are proper nouns. They are downgraded — skipped
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
      // possessive form — separate simple pattern avoids NAME_WORD consuming the ‘s
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

    // Nickname/prefix pass — flag any 3+ char word (any case) that is a strict
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

    // First-names dictionary pass — flags any word (any case) whose lowercase
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
    generateNote: generateNote,
    // Certified-non-PII store — localStorage cache + KV server backing.
    nonPii: { load: loadNonPii, saveTerm: saveNonPiiTerm, clear: clearNonPii, sync: syncNonPii },
    // exposed for testing / advanced use
    _scrub: { detectNames: detectNames, buildNameMap: buildNameMap, applyScrub: applyScrub, restoreDeep: restoreDeep },
  };
})();
