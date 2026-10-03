/*
 * notes-scrub.js - automatic PHI/PII removal shared by the notes tools.
 *
 * Compliance model (no BAA / no ZDR): PHI must never reach the API. De-identifying
 * the input *before* anything is sent is the HIPAA control here - the API only ever
 * receives role tokens ([CLIENT], [CAREGIVER], …). Both gates run with no dialog:
 *
 *   1. acknowledge() - resolves true. The legal notice is now a permanent banner on
 *      the page rather than a modal you dismiss once and never read again.
 *   2. review()      - maps every detected name and identifier to a role token, and
 *      reports what it took afterwards.
 *
 * WHY BOTH DIALOGS WENT (2026-08-24, maintainer's ruling). Gate 2 used to open a
 * confirm-first dialog listing every detection with an editable token, a role
 * dropdown and a "not PII" checkbox. The maintainer named it the chief source of
 * token error, and the mechanism is alarm fatigue rather than impatience: a note
 * mentioning a school, a programme and a target behaviour can raise thirty flags of
 * which none are names, and a person asked to adjudicate thirty rows will not
 * adjudicate the thirty-first carefully. The dialog was therefore most wrong exactly
 * where it mattered most. The identifier pass had already made this argument for
 * itself - see identifierMap below, "removing the click removes the chance of
 * clicking through" - and this is that argument applied to names.
 *
 * Gate 1 went with it for a related reason. A modal accepted once per page load and
 * never read again is a click, not an understanding. The same words now sit on the
 * page next to the box being typed into, where they can actually be read, and the
 * scrub notice repeats the substance every time something is taken.
 *
 * WHAT WOULD HAVE BEEN LOST, AND WHERE IT WENT. The review dialog was the only
 * caller of NotesGate.nonPii.saveTerm, so it was the only way to stop a false
 * positive recurring. Delete it naively and a programme name that reads like a
 * person is scrubbed forever with no way to say otherwise. That escape now lives in
 * the after-the-fact notice: every substituted word is offered back as "not a name",
 * which certifies it for next time. The clinician still decides, about the words
 * that were actually taken rather than the thirty that were not, and after reading a
 * draft rather than before writing one.
 *
 * Tokens stay in the output (de-identified AND retrievable - the clinician
 * substitutes real names in their own EHR). The name->token map is NEVER
 * TRANSMITTED, and since 2026-09-09 it is no longer ephemeral: the engine keeps
 * it beside the draft, encrypted at rest, so an opaque token stays restorable
 * across a reload. It used to live for the duration of one action, which meant
 * a closed tab destroyed the only copy and every [[Tn]] in that note became
 * permanent. See scrubMapKey() in engine.jsx for where it goes and why the
 * token itself stays short.
 *
 * NOT the same job as NotesGate.scrubForAgent(), which the expert bench uses. That
 * one restores the real words into what comes back, because the expert quotes the
 * clinician verbatim and nothing it returns is written down. This one never
 * restores: the token is what the clinician wants left in the note.
 *
 * Depends on window.NotesGate._scrub (detectNames / applyScrub). Vanilla; the React
 * pages `await NotesScrub.acknowledge()` then `await NotesScrub.review(...)`. Both
 * still return promises so no caller had to change when the dialogs went.
 */
(function () {
  "use strict";

  /* Role -> the tag a person is replaced with.
   *
   * `tag` is what is minted: [CLIENT], [CAREGIVER], [BT]. `token` is the word
   * the mint used before 2026-09-28, "Client--1", and it stays only so a saved
   * draft or an open session holding that shape still restores. Nothing mints
   * it any more. */
  var ROLES = [
    { key: "client", label: "Client", token: "Client", tag: "CLIENT" },
    { key: "caregiver", label: "Caregiver", token: "Caregiver", tag: "CAREGIVER" },
    { key: "sibling", label: "Sibling", token: "Sibling", tag: "SIBLING" },
    { key: "peer", label: "Peer", token: "Peer", tag: "PEER" },
    { key: "technician", label: "Technician (BT/RBT)", token: "Technician", tag: "BT" },
    { key: "bcba", label: "BCBA", token: "BCBA", tag: "BCBA" },
    { key: "teacher", label: "Teacher", token: "Teacher", tag: "TEACHER" },
    { key: "specialist", label: "Specialist (SLP/OT/PT)", token: "Specialist", tag: "SPECIALIST" },
    { key: "staff", label: "Other staff", token: "Staff", tag: "STAFF" },
  ];

  /* THE ROLE TOKEN IS [CLIENT], AND A SECOND CLIENT IS [CLIENT-2].
   *
   * His ruling on 2026-09-28: "Need them to all be [CLIENT] so I can audit them
   * easily for missed restored tokens." One client, the common case, reads
   * exactly [CLIENT]. The number appears only from the second person of a role.
   *
   * It keeps what "Client--1" was chosen for. Square brackets around an
   * upper-case word are not prose, so a match is a token and never a word the
   * model chose, and rehydrate() and the EHR copy can substitute on it safely.
   * It also ends the prefix problem: the closing bracket means [CLIENT] is not
   * the start of [CLIENT-12], so no substitution depends on its order any more.
   *
   * THE SEPARATOR IS A HYPHEN, NEVER AN UNDERSCORE. [PHONE_1] is the identifier
   * shape and identifiers restore; a role tag written [CLIENT_2] would be
   * indexed as one and put a person's name back into the note. And the opaque
   * restorers need a T followed by a digit, which no role tag has, so neither
   * [TEACHER-2] nor [BT] can be read as [[T2]].
   */
  function roleTag(role, n) {
    return "[" + role.tag + (n > 1 ? "-" + n : "") + "]";
  }

  function roleByTag(tag) {
    for (var i = 0; i < ROLES.length; i++) if (ROLES[i].tag === tag) return ROLES[i];
    return null;
  }

  function roleByLegacyWord(word) {
    for (var i = 0; i < ROLES.length; i++) if (ROLES[i].token === word) return ROLES[i];
    return null;
  }

  /* Which role and which number a token stands for, in either shape. Null for
     anything that is not a role token, opaque and identifier tokens included. */
  function parseRoleToken(token) {
    var t = String(token || "");
    var m = /^\[([A-Z]+)(?:-(\d+))?\]$/.exec(t);
    if (m) {
      var byTag = roleByTag(m[1]);
      return byTag ? { role: byTag, n: m[2] ? parseInt(m[2], 10) : 1 } : null;
    }
    var legacy = /^([A-Za-z]+)--(\d+)$/.exec(t);
    if (legacy) {
      var byWord = roleByLegacyWord(legacy[1]);
      return byWord ? { role: byWord, n: parseInt(legacy[2], 10) } : null;
    }
    return null;
  }

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

  /* DETECTION, THEN THE TECHNICIAN'S OWN SCREEN LIST, IN THAT ORDER.
   *
   * Every path that flags a name on this page comes through here, which is the
   * point: the overlay that glows while someone types and the review that mints
   * the tokens used to ask the gate separately, and a consult wired into one of
   * them would have left the other flagging words the technician had already
   * cleared.
   *
   * `stats` is an out-parameter and it is optional on purpose. Passing one marks
   * the caller as the DRAFTING path, which is the only path allowed to refresh
   * an entry's expiry clock or emit a count. The overlay runs on a keystroke and
   * would otherwise write an encrypted record per character.
   */
  function detect(freeText, stats) {
    var s = scrub();
    var names = s ? s.detectNames(freeText) : [];
    return screenFilter(names, freeText, stats);
  }

  function screenStore() { return (window.NotesGate && window.NotesGate.screen) || null; }

  /* The type-time screen list, consulted before anything is flagged.
   *
   * A technician clears a highlighted word as "not a person" and it stops being
   * flagged on this device. Two rules are what make that safe to do at typing
   * speed rather than in a dialog somebody clicks through.
   *
   * IT ONLY EVER TOUCHES NAMES. This filters the output of the capitalised-word
   * heuristic and nothing else. identifierMap() runs first, from review(), and
   * never reads the list at all, so a date, a phone number, an address, a ZIP,
   * an email, an SSN or a record number keeps its pass whatever is in the list
   * and whatever a caller does. The store refusing to hold one of those is the
   * second lock rather than the only one.
   *
   * ADJACENCY BEATS A PRIOR SCREEN. "Grace" cleared as a programme name stays
   * cleared right up until somebody writes "mom Grace", "client Grace" or
   * "Grace, his mother", and then it is flagged anyway. A screening answer is
   * about a word; a role cue attached to that word is the text saying that this
   * time it is about a person. cueRole() decides it, which is the same rule the
   * token path uses, so the two cannot drift apart.
   */
  function screenFilter(names, text, stats) {
    var store = screenStore();
    if (!store || !names || !names.length) return names || [];
    var kept = [];
    var suppressed = [];
    var cued = 0;
    names.forEach(function (n) {
      if (!store.has(n)) { kept.push(n); return; }
      if (cueRole(n, text)) { kept.push(n); cued += 1; return; }
      suppressed.push(n);
    });
    if (stats) {
      stats.screened = suppressed.length;
      stats.cued = cued;
      if (suppressed.length) store.seen(suppressed);
    }
    return kept;
  }

  /* COUNTS AND THE PASS NAME, NEVER THE WORD.
   *
   * What anyone reading this back needs is how often the name pass is being
   * overruled and how often a role cue took an answer back, not which words were
   * involved. The word is the one thing here that could be clinical, so it is
   * not in scope: this function is handed two integers and a fixed pass name and
   * has no reader for the list at all.
   */
  function screenAudit(opts, stats) {
    if (!stats || (!stats.screened && !stats.cued)) return;
    var a = window.NotesGate && window.NotesGate.audit;
    if (!a) return;
    var tool = String((opts && opts.tool) || "");
    a.emit("phi_screen", {
      tool: /^[a-z0-9_-]{1,16}$/.test(tool) ? tool : "notes",
      pass: "name",
      screened: stats.screened,
      cued: stats.cued,
    });
  }

  /* The two answers a highlighted word can carry, and the only two.
   *
   * "not a person" clears it for this technician on this device. "yes, take it"
   * affirms the flag, and undoes a previous clearing if there was one, which is
   * how a mis-tap is repaired without anybody building a settings screen.
   *
   * Both record a count and the pass name. Neither records the word.
   */
  function screenAnswer(word, answer) {
    var store = screenStore();
    if (!store) return false;
    var cleared = 0;
    if (answer === "not-a-person") {
      if (!store.add(word)) return false;
      cleared = 1;
    } else if (answer === "take-it") {
      store.remove(word);
    } else {
      return false;
    }
    var a = window.NotesGate && window.NotesGate.audit;
    if (a) {
      a.emit("phi_screen_answer", { pass: "name", cleared: cleared, confirmed: cleared ? 0 : 1 });
    }
    return true;
  }

  function roleByKey(key) {
    for (var i = 0; i < ROLES.length; i++) if (ROLES[i].key === key) return ROLES[i];
    return ROLES[0];
  }

  // Role from the words near the name. This used to be a best guess seeding a
  // dropdown the clinician then confirmed; with the dropdown gone it decides the
  // token outright, so its failure mode changed and is worth naming: a name with
  // no cue near it falls through to "client". That is the right default for a
  // session note, where the unlabelled person overwhelmingly IS the client, and
  // it is the reason this differs from NotesGate.scrubForAgent(), which answers
  // "Person" instead. The difference is what happens to a wrong guess. Here the
  // token lands in a note a human reads and edits before signing. There it lands
  // in a prompt telling an expert model which human the programme is about, and
  // nobody sees it before the model does.
  /* ADJACENCY, not proximity. This is the part that had to change when the
   * dropdown went, and it is worth saying why in full because the old rule looks
   * harmless until nobody is checking it.
   *
   * The old rule scanned a 40-character window either side of the name and took
   * the first cue it found anywhere in it. On "Jacob eloped twice. Mom Sarah
   * called", the window around "Jacob" reaches "Mom" three words later, so Jacob
   * came back as a caregiver. That was survivable while a clinician was looking at
   * a dropdown reading "Jacob → Caregiver" and could fix it in one click. With the
   * dialog gone nobody sees it, and the note goes out calling the client a parent.
   *
   * So a cue now has to be ATTACHED to the name to claim it: immediately before
   * ("Mom Sarah", "BT Marcus", "client Jacob"), or immediately after as an
   * appositive ("Sarah, his mother", "Marcus (RBT)"). A cue merely in the same
   * sentence claims nothing. This is the same rule NotesGate.inferRoles() uses on
   * the expert path, which is not a coincidence - two role inferences that disagree
   * about the same sentence is a bug waiting for a Tuesday.
   *
   * The appositive form allows one optional possessive or article between the name
   * and the cue, which is what "Sarah, his mother" needs and what stops "Sarah, who
   * had driven the mother of another client" from matching.
   */
  var CUE_WORDS =
    "mom|mother|dad|father|parent|grandma|grandpa|grandmother|grandfather|guardian|" +
    "caregiver|aunt|uncle|foster|bt|rbt|tech|technician|aide|para|bcba|bcaba|analyst|" +
    "supervisor|teacher|sped|slp|ot|pt|speech|occupational|physical|therapist|specialist|" +
    "client|kiddo|learner|student|sibling|brother|sister|peer|classmate";
  var CUE_ROLE = {
    mom: "caregiver", mother: "caregiver", dad: "caregiver", father: "caregiver",
    parent: "caregiver", grandma: "caregiver", grandpa: "caregiver",
    grandmother: "caregiver", grandfather: "caregiver", guardian: "caregiver",
    caregiver: "caregiver", aunt: "caregiver", uncle: "caregiver", foster: "caregiver",
    bt: "technician", rbt: "technician", tech: "technician", technician: "technician",
    aide: "technician", para: "technician",
    bcba: "bcba", bcaba: "bcba", analyst: "bcba", supervisor: "bcba",
    teacher: "teacher", sped: "teacher",
    slp: "specialist", ot: "specialist", pt: "specialist", speech: "specialist",
    occupational: "specialist", physical: "specialist", therapist: "specialist",
    specialist: "specialist",
    client: "client", kiddo: "client", learner: "client", student: "client",
    sibling: "sibling", brother: "sibling", sister: "sibling",
    peer: "peer", classmate: "peer",
  };

  // The cue lookup on its own, returning null when nothing is attached. Split out
  // of guessRole because the caller now needs to know the DIFFERENCE between a
  // role that was read off the text and a role that was assumed, and guessRole
  // answers "client" to both.
  function cueRole(name, text) {
    if (!text) return null;
    var esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var before, after;
    try {
      // "Mom Sarah", "BT Marcus", "client Jacob"
      before = new RegExp("\\b(" + CUE_WORDS + ")\\.?\\s+" + esc + "\\b", "i");
      // "Sarah, his mother", "Marcus (RBT)", "Jacob - the learner"
      after = new RegExp("\\b" + esc + "\\b\\s*[,(-]\\s*(?:his|her|their|the|a|an)?\\s*(" + CUE_WORDS + ")\\b", "i");
    } catch (e) { return null; }

    var m = before.exec(text) || after.exec(text);
    if (m) {
      var role = CUE_ROLE[m[1].toLowerCase()];
      if (role) return role;
    }
    return null;
  }

  function guessRole(name, text) {
    return cueRole(name, text) || "client";
  }

  /* Is there POSITIVE evidence that this word is a person?
   *
   * Two signals, and they are the only two the scrubber actually has: a role cue
   * attached to the word ("Mom Sarah", "Sarah, his mother"), or the word sitting
   * in the first-name dictionary. Everything else that detectNames returns is a
   * capitalised word it could not rule out, which is a very different claim.
   *
   * This distinction did not exist before, and its absence is what put "Client 25"
   * in a signed note. detectNames is deliberately over-inclusive because it was
   * written for a path that ADJUDICATES every hit. On the drafting path nothing
   * adjudicates and nothing restores, so every colour, toy and piece of ABA
   * terminology it caught became a numbered client, permanently.
   */
  function personEvidence(name, text) {
    if (cueRole(name, text)) return true;
    var s = scrub();
    if (!s || !s.isFirstName) return false;
    return String(name).split(/\s+/).some(function (w) { return s.isFirstName(w); });
  }

  // Shown in the notice banner after any scrub so clinicians build better habits.
  var SCRUB_GUIDANCE =
    "Use roles, not names: e.g., Client, Parent, BT, BCBA, SLP, OT, PT, Teacher, etc.\n" +
    "All providers are responsible for client information privacy at all times.";

  /* Two kinds of replacement, decided by evidence rather than by hope.
   *
   * A word with person-evidence gets a ROLE token ([CLIENT], [CAREGIVER-2]) and that
   * token is what stays in the signed note. Unchanged, and deliberately so: the
   * de-identification of actual people is the whole point of this pass.
   *
   * A word without it gets an OPAQUE token instead, and the page puts the
   * original word back when the draft returns. The model never learns what the
   * word was, and a wrong guess costs the note nothing.
   *
   * That second class is the maintainer's instruction on 2026-08-26, and it
   * makes true a claim the code above the stopword list has been making since it
   * was written: "over-scrubbing is safe, it round-trips back identically". That
   * was true on the expert path, which restores. On this path nothing restored,
   * so over-scrubbing was not safe at all, and the comment was quietly wrong for
   * as long as it has been there.
   *
   * Shape is [[T1]] rather than a word: double brackets survive a JSON round trip,
   * carry no meaning for the model to act on, and cannot collide by prefix the way
   * "Client" collides with "Client 2".
   */
  /* Seeds for a SECOND scrub on the same note.
   *
   * defaultTokens numbered from zero on every call, which was harmless while
   * each call also replaced the map it was numbering against. Once the map
   * accumulates across a note - and it has to, see restoreOutput - restarting
   * the count mints a second [[T1]] for a different word, and restoreDeep then
   * puts whichever one it finds first into the note. A wrong word in a signed
   * note is worse than the token was.
   *
   * The map is the only thing that persists, so the seeds are read back out of
   * it rather than tracked separately. Two things to recover: the highest
   * opaque number issued, and how many of each role token are already in use.
   */
  function seedsFromMap(seen) {
    var seeds = { opaque: 0, counts: {} };
    if (!seen || !seen.length) return seeds;
    seen.forEach(function (e) {
      var token = String((e && e.token) || "");
      var op = /^\[\[T(\d+)\]\]$/.exec(token);
      if (op) {
        var n = parseInt(op[1], 10);
        if (n > seeds.opaque) seeds.opaque = n;
        return;
      }
      // Both shapes, so a draft saved as "Client--2" still stops the next mint
      // reusing its number.
      var rt = parseRoleToken(token);
      if (!rt) return;
      if (rt.n > (seeds.counts[rt.role.key] || 0)) seeds.counts[rt.role.key] = rt.n;
    });
    return seeds;
  }

  /* The identifier half of the same recovery. Tokens look like [phone_2], and
     they are never restored, so a restarted counter does not put a wrong word in
     the note the way a restarted [[Tn]] does - it puts one token in the note
     standing for two different numbers, which is worse to read and impossible to
     substitute back. */
  function identifierSeeds(seen) {
    var counts = {};
    (seen || []).forEach(function (e) {
      if (!e || !e.identifier) return;
      // [PHONE_1], not [phone_1] - the type keeps the case detectIdentifiers
      // gave it, and a lowercased key seeds nothing.
      var m = /^\[([A-Za-z_]+)_(\d+)\]$/.exec(String(e.token || ""));
      if (!m) return;
      var n = parseInt(m[2], 10);
      if (n > (counts[m[1]] || 0)) counts[m[1]] = n;
    });
    return counts;
  }

  /* THE HIGHEST T-NUMBER THE CLINICIAN ALREADY TYPED, so the mint starts above it.
   *
   * notes-gate.js restores a bare T3 since 2026-09-24, because the model drops
   * the brackets and his note came back reading "Goal: T2". That restore is safe
   * only if a T-number this note issued cannot also be one the clinician wrote,
   * a spinal level or a protocol step. Minting above every number the intake
   * spells makes that true by construction. Deliberately wider than the restorer
   * (any spacing, "Token", fullwidth): an over-read here costs a skipped number
   * and nothing else.
   */
  function typedTNumberCeiling(text) {
    var top = 0;
    var re = /[Tt\uFF34\uFF54](?:oken)?[\s_#-]*([0-9\uFF10-\uFF19]+)/g;
    var m;
    while ((m = re.exec(String(text || ""))) !== null) {
      var ascii = m[1].replace(/[\uFF10-\uFF19]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
      });
      var n = parseInt(ascii, 10);
      if (n > top && n < 100000) top = n;
    }
    return top;
  }

  /* OPAQUE NUMBERS START AT 101, so a bare one is never the model's own.
   *
   * The ceiling above keeps the mint off a T-number the clinician typed. It
   * cannot see one the model invents in its reply, and an ABA note abbreviates
   * trials as T1, T2, T3 without being asked. With the restorer reading bare
   * T-numbers, "responded on T1" would have come back as "responded on
   * Aggression". No model labels a trial T101, so starting there leaves every
   * number it might coin for itself below anything this note issues. A saved
   * ledger numbered from 1 still restores, because the restorer reads the map,
   * not the floor.
   */
  var OPAQUE_FLOOR = 100;

  function defaultTokens(names, freeText, seen) {
    var seeds = seedsFromMap(seen);
    var counts = seeds.counts;
    var opaque = Math.max(seeds.opaque, typedTNumberCeiling(freeText), OPAQUE_FLOOR);
    return names.map(function (name) {
      if (!personEvidence(name, freeText)) {
        opaque += 1;
        return { roleKey: null, token: "[[T" + opaque + "]]", restore: true };
      }
      var role = roleByKey(guessRole(name, freeText));
      counts[role.key] = (counts[role.key] || 0) + 1;
      var n = counts[role.key];
      /* WHY NOT A BARE WORD, AND WHY NOT "Client--1" ANY MORE.
       *
       * It was once the bare word "Client" for the first person of a role. That
       * is ordinary English the model writes on its own account, so the page
       * could never tell a token from a word the model chose, and rehydrate()
       * below could not exist. From 2026-09-02 it was "Client--1", which fixed
       * that and was ugly on purpose. From 2026-09-28 it is [CLIENT], which
       * keeps the property and is the shape he audits by. See roleTag(). */
      return {
        roleKey: role.key,
        token: roleTag(role, n),
        restore: false,
      };
    });
  }

  /* selections: [{ name, replacement, cert, restore }] -> { map, certified }.
   * Longest names first so "John Smith" is replaced before "John".
   *
   * FRAGMENTS ARE DROPPED when `text` is supplied. detectNames returns "Paw
   * Patrol" and also "Paw" and also "Patrol", because each is a capitalised word
   * it could not rule out. Once the phrase is replaced the two fragments match
   * nothing, but they still consumed a token apiece, which is most of how a note
   * with six people in it reached "Client 25". Worse, a fragment that DOES occur
   * on its own later gets a second, different token for the same word.
   *
   * So each name is tested against a copy of the text with every longer
   * replacement already applied. A name that has nothing left to match is not a
   * name, it is the inside of one.
   */
  function buildMap(selections, text) {
    var map = [];
    var certified = [];
    selections.forEach(function (s) {
      if (s.cert) { certified.push(s.name); return; }
      var rep = (s.replacement || "").trim();
      if (!rep) return;
      map.push({ name: s.name, token: rep, restore: !!s.restore });
    });
    map.sort(function (a, b) { return b.name.length - a.name.length; });

    if (typeof text !== "string" || !text) return { map: map, certified: certified };

    var remaining = text;
    var kept = [];
    map.forEach(function (e) {
      var after = applyMap(remaining, [e]);
      if (after === remaining) return; // nothing of this name survives - it was a fragment
      remaining = after;
      kept.push(e);
    });
    return { map: kept, certified: certified };
  }

  /* Names through the gate's case-blind replace, role words through their own.
     A role word is tokenised only where it stands for a person, which the
     gate's replace cannot tell: it would turn "client Jacob" and "the client"
     into tokens along with the "Client" he typed in place of a name. */
  function applyMap(text, map) {
    var s = scrub();
    if (!s || !map || !map.length) return text;
    var names = map.filter(function (e) { return !isRoleWordEntry(e); });
    var words = map.filter(isRoleWordEntry);
    var out = names.length ? s.applyScrub(text, names) : text;
    return words.length ? applyRoleWords(out, words) : out;
  }

  /* ─────────── A role word typed in place of a name ───────────
   *
   * His ruling, 2026-09-28: staff are told to write "Client" or "Caregiver"
   * instead of a name, and a word typed that way is where a name can be put
   * back, so it becomes that role's token. "Client" is [CLIENT], never a minted
   * person number, and it lands in the put-back table beside any name the scrub
   * found, pre-filled with the word itself so an untouched copy reads exactly
   * as he typed it.
   *
   * WHAT COUNTS. The word as a stand-in for a person: capitalised (Client,
   * Mom), or the acronym in capitals (BT, BCBA). NOT a label on a name that
   * follows it ("Client Jacob", "BT Marcus", where the name is the person and
   * gets the token), not a compound title ("Parent Training", "BCBA
   * Supervision"), not a hyphen compound ("BT-led"), and not the lower-case
   * word in running prose ("with staff using items"), which is not a person
   * standing in a sentence. */
  /* Every word here is on the gate's stoplist, so none of them can also be
     detected as a name and carry two entries. Add a word here only with it. */
  var ROLE_WORD_ROLE = {
    Client: "client",
    Caregiver: "caregiver", Parent: "caregiver",
    Mom: "caregiver", Dad: "caregiver", Mother: "caregiver", Father: "caregiver",
    Technician: "technician", BT: "technician", RBT: "technician",
    BCBA: "bcba", Teacher: "teacher", Staff: "staff",
    Sibling: "sibling", Peer: "peer",
  };

  /* Read off the entry itself as well as its flag. A map that lost the flag on
     the way through a caller would otherwise send "Client" through the gate's
     case-blind replace, which rewrites "the client" and even the "CLIENT"
     inside an issued [CLIENT]. No name can be a role word (every one of them
     is on the gate's stoplist), so the shape is proof enough. */
  function isRoleWordEntry(e) {
    if (!e) return false;
    if (e.roleWord) return true;
    return Object.prototype.hasOwnProperty.call(ROLE_WORD_ROLE, e.name) && !e.restore && !!parseRoleToken(e.token);
  }

  // The map without the role words, for re-scrubbing text the MODEL wrote.
  function withoutRoleWords(map) {
    return (map || []).filter(function (e) { return !isRoleWordEntry(e); });
  }

  function roleWordPattern(word) {
    /* Lead: start, or anything that is not a letter, digit, underscore,
       bracket or hyphen. Tail: not a word character or hyphen, and not a space
       then a capital or a bracket, which is a label on the name or token that
       follows it. No lookbehind, so Safari before 16.4 still parses it. */
    return new RegExp(
      "(^|[^A-Za-z0-9_\\[\\-])(" + word + ")(?![A-Za-z0-9_\\-])(?![ \\t]+[A-Z\\[])",
      "g",
    );
  }

  function applyRoleWords(text, entries) {
    var out = String(text);
    entries.forEach(function (e) {
      out = out.replace(roleWordPattern(e.name), function (hit, lead) { return lead + e.token; });
    });
    return out;
  }

  /* The name a role word is a label on, where the text says so: "Mom Sarah"
     makes a later bare "Mom" the same person as Sarah. */
  function labelledToken(word, text, persons) {
    for (var i = 0; i < persons.length; i++) {
      var esc = String(persons[i].name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp("\\b" + word + "\\.?\\s+" + esc + "\\b").test(text)) return persons[i].token;
    }
    return null;
  }

  function roleWordMap(text, built, seen) {
    var t = String(text || "");
    if (!t) return [];
    var prior = (seen || []).concat(built || []);
    var persons = prior.filter(function (e) { return e && !e.restore && !e.roleWord && !e.identifier && e.token; });
    var counts = seedsFromMap(prior).counts;
    var out = [];
    Object.keys(ROLE_WORD_ROLE).forEach(function (word) {
      if (!roleWordPattern(word).test(t)) return;
      var role = roleByKey(ROLE_WORD_ROLE[word]);
      var already = prior.concat(out).filter(function (e) { return e.roleWord && e.name === word; })[0];
      var token = (already && already.token) || labelledToken(word, t, persons);
      /* THE CLIENT IS ONE PERSON. A note has one client, so "Client" joins the
         client a name already stands for rather than minting a second. */
      if (!token && role.key === "client") {
        var firstClient = prior.concat(out).filter(function (e) {
          var rt = !e.restore && parseRoleToken(e.token);
          return rt && rt.role.key === "client";
        }).sort(function (a, b) { return parseRoleToken(a.token).n - parseRoleToken(b.token).n; })[0];
        if (firstClient) token = firstClient.token;
      }
      if (!token) {
        counts[role.key] = (counts[role.key] || 0) + 1;
        token = roleTag(role, counts[role.key]);
      }
      out.push({ name: word, token: token, restore: false, roleWord: true });
    });
    return out;
  }

  /* Every role tag the note carries, in order of first appearance, whether this
     page minted it or the model wrote it (the SAP drafter writes [CLIENT] on
     its prompt's instruction). The put-back table lists all of them. */
  function roleTagsIn(value) {
    var tags = ROLES.map(function (r) { return r.tag; }).join("|");
    var re = new RegExp("\\[(?:" + tags + ")(?:-\\d+)?\\]", "g");
    var found = [];
    mapStrings(value, function (str) {
      (str.match(re) || []).forEach(function (t) { if (found.indexOf(t) === -1) found.push(t); });
      return str;
    });
    return found;
  }

  /* ONE ROW PER TOKEN, for the put-back table and for forEhr. Two entries can
     share a token: the name the scrub found and the role word typed for the
     same person. The name wins the pre-fill, because it is the word the
     clinician would put back; the role word is only used where no name was
     typed. */
  function roleTokenRows(map) {
    var rows = [];
    var at = {};
    (map || []).forEach(function (e) {
      if (!e || e.restore || !e.name || !e.token) return;
      var i = at[e.token];
      if (i === undefined) { at[e.token] = rows.length; rows.push({ token: e.token, name: e.name, roleWord: !!e.roleWord }); return; }
      if (rows[i].roleWord && !e.roleWord) rows[i] = { token: e.token, name: e.name, roleWord: false };
    });
    return rows;
  }

  /* Put the round-trippable words back.
   *
   * Only entries flagged `restore` are reversed, so a role token stays exactly
   * where it is and no person's name re-enters a note. Walks objects and arrays
   * because the model answers with the note's whole JSON shape.
   *
   * Call it on the PARSED answer and never on the raw text: the revision flow
   * replays rawText verbatim to keep Anthropic's prefix cache warm, and a
   * restored word there would change the prefix and cost full price every turn.
   */
  /* Carry the round-trippable words forward for the life of one note.
   *
   * THE FAULT THIS FIXES. The page kept one map and replaced it on every scrub.
   * A revision scrubs only the typed instruction, so that replacement threw away
   * the draft's opaque tokens - and the model still had them, because the
   * revision replays the earlier turns verbatim to keep the prefix cache warm.
   * It copied [[T3]] and [[T9]] out of its own history into the new draft, and
   * nothing was left that knew [[T3]] had been "Play-Doh". Reported from a live
   * sup note on 2026-08-31.
   *
   * Deduped on token AND name together: the same word scrubbed twice is one
   * entry, and a token that somehow arrives twice for different words keeps both
   * so the collision is visible in the map rather than silent in the note.
   * seedsFromMap is what stops that collision being minted in the first place.
   */
  function mergeMaps(prev, next) {
    var out = (prev || []).slice();
    (next || []).forEach(function (e) {
      var dup = out.some(function (p) { return p.token === e.token && p.name === e.name; });
      if (!dup) out.push(e);
    });
    out.sort(function (a, b) { return String(b.name).length - String(a.name).length; });
    return out;
  }

  function restoreOutput(value, map) {
    var s = scrub();
    var list = map || [];
    var back = list.filter(function (e) { return e.restore; });
    var restored = (s && s.restoreDeep && back.length) ? s.restoreDeep(value, back) : value;
    return retireModelRoleTokens(restored, list);
  }

  function mapStrings(value, fn) {
    if (typeof value === "string") return fn(value);
    if (Array.isArray(value)) return value.map(function (v) { return mapStrings(v, fn); });
    if (value && typeof value === "object") {
      var o = {};
      Object.keys(value).forEach(function (k) { o[k] = mapStrings(value[k], fn); });
      return o;
    }
    return value;
  }

  /* A ROLE TOKEN THE MODEL WROTE ON ITS OWN ACCOUNT, in a shape this note never
   * issued.
   *
   * WHAT HE READ ON 2026-09-28. His SAP input named nobody, the scrub minted no
   * person token for it, and the note came back saying "Client--1". The
   * corrections pass had written it: it runs on the expert prompt, which told
   * it role tokens look like "Client--1" and must be carried through "both
   * hyphens and the number included", and the intake opened with the bare word
   * "Client". It wrote the shape it had been told a client takes.
   *
   * The prompt side is fixed where the prompt lives. This is the page's half,
   * for a model that does it anyway, and for the expert prompt until its store
   * is re-deployed: an old-shape token this note did not issue is not anybody's
   * name, so number one of a role becomes that role's tag, "Client--1" to
   * [CLIENT], and a [CLIENT-1] the model numbered for itself becomes [CLIENT].
   * A higher number the note never issued is left exactly as written, because
   * guessing which person it meant could point at the wrong one, and a visible
   * token is what his audit looks for.
   *
   * IT NEVER WRITES A NAME. Every replacement is a token for a token. An ISSUED
   * old-shape token, from a draft saved before the change, is not touched, so
   * rehydrate() and the EHR copy still put its word back. */
  function retireModelRoleTokens(value, map) {
    var issued = {};
    (map || []).forEach(function (e) { if (e && e.token) issued[e.token] = true; });
    var words = ROLES.map(function (r) { return r.token; }).join("|");
    var legacy = new RegExp("\\b(" + words + ")--(\\d+)\\b", "g");
    var selfNumbered = /\[([A-Z]+)-1\]/g;
    return mapStrings(value, function (str) {
      return str
        .replace(legacy, function (hit, word, num) {
          if (issued[hit] || parseInt(num, 10) !== 1) return hit;
          return roleTag(roleByLegacyWord(word), 1);
        })
        .replace(selfNumbered, function (hit, tag) {
          var role = roleByTag(tag);
          return role && !issued[hit] ? roleTag(role, 1) : hit;
        });
    });
  }

  /* PUTTING THE CLINICIAN'S OWN WORD BACK INTO THE CLINICIAN'S OWN SENTENCE.
   *
   * WHAT HE READ ON 2026-09-02. He typed "Happy at session start", the name
   * dictionary took Happy for a first name, and the expert - which reads the
   * de-identified intake - quoted back "Client at session start". A sentence he
   * never wrote, about a swap nothing on the page mentioned. His reading of the
   * mechanism was right: "the expert essentially got a code word".
   *
   * THIS USED TO BE A REFUSAL, and the refusal was correct at the time. The code
   * here reported the swap in a caption rather than undoing it, because a role
   * token was the bare word "Client" - ordinary English the expert writes on its
   * own account, and is told to. Substituting every "Client" back would have put
   * a real name into a sentence the model wrote about the role, which is a worse
   * fault than the one being fixed and is invisible when it happens.
   *
   * WHAT CHANGED IS THE TOKEN, NOT THE RULE. defaultTokens mints [CLIENT] now
   * (it minted "Client--1" from 2026-09-02 to 2026-09-28, and both are read),
   * and no model writing prose types either. A token in the text is therefore a
   * token and never a coincidence, so the substitution the old comment could not
   * make safely is now the ordinary one. That is what the shape buys, and if
   * the shape ever goes back to a bare word this has to go back to a caption.
   *
   * SCOPE IS THE CLINICIAN'S OWN WORDS AND NOTHING ELSE. Call it on a register
   * finding's `quote`, which is theirs by contract. Never on `move`, which is a
   * replacement sentence for the note and has to agree with the note. Never on
   * the note itself: the token is what protects it, and it stays. Opaque tokens
   * are not this function's business either - restoreOutput round-trips those.
   * And never on anything bound for the model: what this returns is for a
   * screen or a clipboard.
   */
  function rehydrate(text, map) {
    return forEhr(text, map);
  }

  /* THE ONE SUBSTITUTION OF A ROLE TOKEN FOR A WORD, used by rehydrate() and by
   * the engine's "Restore original words on copy".
   *
   * `overrides` is {token: replacement} from the put-back panel. A token with
   * no override gets the word the clinician typed; a blank override keeps the
   * token, as the panel says. Longest token first stays although the new shape
   * does not need it ([CLIENT] is not a prefix of [CLIENT-12]): a draft saved in
   * the old shape still holds Client--1 beside Client--12.
   */
  function forEhr(text, map, overrides) {
    var t = String(text || "");
    if (!t || !map || !map.length) return t;
    var back = roleTokenRows(map);
    if (!back.length) return t;
    var chosen = overrides || {};
    back
      .slice()
      .sort(function (a, b) { return String(b.token).length - String(a.token).length; })
      .forEach(function (e) {
        var has = Object.prototype.hasOwnProperty.call(chosen, e.token);
        var rep = String(has ? chosen[e.token] : e.name).trim();
        if (rep) t = t.split(e.token).join(rep);
      });
    return t;
  }

  // Only the substitutions that STAY in the note are worth telling a clinician
  // about. A round-tripped word was never taken, so listing it would report a
  // change that does not survive to the draft.
  function noticeText(map) {
    if (!map || !map.length) return "";
    return map
      .filter(function (e) { return !e.restore; })
      .map(function (e) { return e.name + " → " + e.token; })
      .join(", ");
  }

  /* DEAD, and kept only so an old stress-test page does not throw on it.
     Nothing in the tree calls it.

     It used to be the designated seam for encrypted-at-rest map storage, and it
     specified the contract well: never plaintext, never transmitted. That
     storage exists now, and it is NOT here - the engine writes the map through
     NotesGate.draft.save() under a sibling key, so it inherits the draft's own
     non-extractable AES-GCM key, its 12-hour TTL and its wipe on logout.

     The seam moved because this module does not know about tools or sessions
     and the engine does. Leaving the old comment saying "no-op by design" would
     have left two answers in the tree to one question, with the wrong one
     written in the more authoritative-looking place. */
  function persistMap(/* map */) { return false; }

  /* ───────────────── Acknowledgment ───────────────── */

  /* The legal notice is a BANNER now, not a dialog.
   *
   * It used to be a modal you accepted once per page load. A modal accepted once
   * and never read again is a click, not an understanding, and it bought nothing
   * that the permanent notice beside the textarea does not buy better. The words
   * themselves did not change and are not weakened: they live in ACK_NOTICE below
   * and the note pages render them where the typing happens.
   *
   * This still returns a promise resolving true, because every caller awaits it and
   * the seam is worth keeping. If a future compliance posture needs a hard gate
   * again, it goes back here and no call site changes.
   */
  var ACK_NOTICE =
    "Do not enter PHI or PII: client names, dates, addresses or any other identifier.\n" +
    "Sending PHI to a third-party AI service without a signed Business Associate " +
    "Agreement can violate HIPAA, the HITECH Act and other laws.\n" +
    "The user is solely responsible for de-identifying all input.\n" +
    "Names and identifiers are detected and removed before sending; this does not " +
    "replace the user's duty to de-identify.";

  function acknowledge() { return Promise.resolve(true); }

  // Non-name identifiers - DOB, phone, address, ZIP, email, SSN, MRN. Unlike a
  // name there is no clinical reason for one of these to be in a session note,
  // so they are tokenised outright rather than offered for review: removing the
  // click removes the chance of clicking through. They still appear in the
  // "removed before this left your device" notice.
  function identifierMap(freeText, seen) {
    var s = scrub();
    if (!s || !s.buildIdentifierMap) return [];
    return s.buildIdentifierMap(freeText, identifierSeeds(seen));
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
    for (var i = 0; i < ROLES.length; i++) {
      set[ROLES[i].token.toLowerCase()] = true;
      set[ROLES[i].tag.toLowerCase()] = true;
    }
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

  /* ─────────────────── The scrub itself ─────────────────── */

  /* Resolves { cancelled, map, certified }. No dialog, and `cancelled` is never
   * true, because there is nothing left for anyone to cancel.
   *
   * The ordering is load-bearing. Identifiers go FIRST so a longer literal like
   * "123 Jacob Street" is replaced whole before the name pass can see "Jacob"
   * nested inside it and break the address in half. buildMap then sorts names
   * longest-first for the same reason, so "John Smith" goes before "John".
   *
   * `certified` stays in the returned shape and stays empty. Certifying happens
   * after the fact now, through notPii(), rather than before the fact in a dialog.
   * Every caller destructures this object and there was no reason to churn them.
   */
  function review(opts) {
    return new Promise(function (resolve) {
      var freeText = (opts && opts.freeText) || "";
      /* Tokens already issued for THIS note, so a second scrub continues the
         numbering instead of colliding with it. Absent on a first draft, which
         is the same as an empty map. */
      var seen = (opts && opts.seen) || [];
      /* A SCRUB WITH NOTHING ALREADY ISSUED IS A NEW NOTE, and a new note is
         what the screen list counts its expiry in. A revision carries the note's
         map forward and must not tick the counter a second time, or a technician
         who revises hard would expire their own answers in an afternoon. The
         engine says so outright with `newNote`; the derivation is for the
         callers that do not, and it agrees with the engine on both branches. */
      var newNote = (opts && typeof opts.newNote === "boolean") ? opts.newNote : !seen.length;
      var store = screenStore();
      if (newNote && store) store.advanceNote();

      /* IDENTIFIERS FIRST, AND THAT ORDER IS THE SCREEN LIST'S OTHER GUARANTEE.
         This pass runs before the name pass and never consults the list, so a
         screened word sitting inside an address or a labelled record number
         cannot take the identifier's pass away with it. */
      var idMap = identifierMap(freeText, seen);
      var stats = { screened: 0, cued: 0 };
      var names = detect(freeText, stats);
      screenAudit(opts, stats);

      var defaults = names.length ? defaultTokens(names, freeText, seen) : [];
      var built = names.length ? buildMap(names.map(function (name, i) {
        return {
          name: name,
          replacement: defaults[i].token,
          cert: false,
          restore: defaults[i].restore,
        };
      }), freeText) : { map: [] };
      // Role words go LAST, so they can join the person a name already stands
      // for and so their numbers continue after the names'.
      var roleWords = roleWordMap(freeText, built.map, seen);
      var map = idMap.concat(built.map, roleWords);

      // Report the bare scrubbed words (names only, no context) to the admin PII
      // review queue. NotesGate.pii drops dictionary names and anything it cannot
      // transmit safely. Identifiers are excluded on purpose: the point of that
      // queue is to learn name vocabulary, and a phone number is neither a word
      // nor safe to transmit. A role word is not a name either.
      var reportable = map.filter(function (m) { return !m.identifier && !m.roleWord; });
      if (reportable.length && window.NotesGate && window.NotesGate.pii) {
        window.NotesGate.pii.reportScrubbed(reportable.map(function (m) { return m.name; }));
      }

      resolve({ cancelled: false, map: map, certified: [] });
    });
  }

  /* The escape that used to be a checkbox in the dialog.
   *
   * Certifying a term as not-PII is the only way to stop a false positive coming
   * back - a programme called Grace, a school called Bishop, a curriculum called
   * Milestones. The dialog owned that, and the dialog is gone, so the notice owns
   * it instead: the clinician clicks the word in "removed before this left your
   * device" and it is never taken again.
   *
   * Deliberately one-way. It stops the NEXT scrub and does not put the word back
   * into the draft just written, because that draft came out of a prompt the model
   * read with a token in it. Re-inserting a name into prose built around "Client"
   * produces a sentence nobody wrote.
   */
  function notPii(name) {
    var term = String(name || "").trim();
    if (!term) return false;
    if (!(window.NotesGate && window.NotesGate.nonPii)) return false;
    window.NotesGate.nonPii.saveTerm(term);
    return true;
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

  function escHtml(t) {
    return String(t)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /* WHERE EVERY FLAGGED WORD SITS, computed once and read by both halves.
   *
   * The overlay draws from this and the tap handler answers from it, so what
   * glows and what a tap means cannot disagree. It also goes through detect(),
   * which is what puts the technician's screen list in front of the overlay as
   * well as in front of the tokens.
   *
   * SPANS RATHER THAN REPLACEMENT INTO THE MARKED-UP STRING. The old pass wrapped
   * each name by running its regex over HTML that already had marks in it, so a
   * shorter name inside a longer one matched the text INSIDE a <mark> and nested
   * a second one in it. Positions cannot do that: a span overlapping one already
   * taken is dropped, longest name first, which is the same longest-first rule
   * buildMap uses on the token path and for the same reason.
   */
  function detectedSpans(text) {
    var t = String(text || "");
    if (!t) return [];
    var names = detect(t);
    if (!names.length) return [];
    var spans = [];
    names
      .slice()
      .sort(function (a, b) { return b.length - a.length; })
      .forEach(function (name) {
        var re;
        try {
          re = new RegExp("\\b" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
        } catch (e) { return; }
        var m;
        while ((m = re.exec(t)) !== null) {
          if (!m[0].length) { re.lastIndex += 1; continue; }
          var start = m.index;
          var end = start + m[0].length;
          var overlap = spans.some(function (sp) { return start < sp.end && end > sp.start; });
          if (!overlap) spans.push({ name: name, word: m[0], start: start, end: end });
        }
      });
    spans.sort(function (a, b) { return a.start - b.start; });
    return spans;
  }

  /* WHICH MARK DID THEY TAP? The caret answers it, and the caret is the only
   * thing that can.
   *
   * The highlight layer is pointer-events:none and sits UNDER the textarea at
   * z-index 0, because giving it pointer events would take the click away from
   * the field and stop typing working. So a tap lands on the textarea, the
   * browser sets selectionStart from where it landed, and that offset maps back
   * onto the span the overlay drew. Mouse and touch both set it, so one path
   * covers a laptop and a phone with no second code path to keep in step.
   */
  function markAt(text, index) {
    var i = Number(index);
    if (!isFinite(i)) return null;
    var spans = detectedSpans(text);
    for (var k = 0; k < spans.length; k++) {
      if (i >= spans[k].start && i <= spans[k].end) return spans[k];
    }
    return null;
  }

  function _syncHighlight(ta, hl) {
    var text = ta.value;
    var spans = detectedSpans(text);
    if (!spans.length) { hl.innerHTML = "​"; return; } // zero-width space keeps height

    var out = "";
    var at = 0;
    spans.forEach(function (sp) {
      out += escHtml(text.slice(at, sp.start)) + "<mark>" + escHtml(text.slice(sp.start, sp.end)) + "</mark>";
      at = sp.end;
    });
    out += escHtml(text.slice(at));

    hl.innerHTML = out;
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

    /* THE TAP SEAM, AND IT IS A SEAM RATHER THAN A POPOVER ON PURPOSE.
     *
     * A tap on a highlighted word raises `notes-phi-mark` on the textarea,
     * carrying the word and where it sits. Nothing here draws anything: what the
     * two answers look like on the page is the maintainer's ruling and not this
     * file's business, and a page that has not listened yet behaves exactly as it
     * did before. What this settles is the part that has to be right whatever the
     * answer looks like - that a tap can be resolved to the mark under it at all,
     * on a mouse and on a phone, without moving the overlay out from under the
     * field and breaking typing.
     *
     * The listener is passive and the event does not bubble past the textarea, so
     * a tap that lands on no mark costs one detect() and changes nothing.
     */
    function askAboutMark() {
      var hit = markAt(ta.value, ta.selectionStart);
      if (!hit) return;
      try {
        ta.dispatchEvent(new CustomEvent("notes-phi-mark", {
          bubbles: true,
          detail: { word: hit.word, name: hit.name, start: hit.start, end: hit.end, field: ta },
        }));
      } catch (e) {}
    }
    ta.addEventListener("click", askAboutMark);
    ta.addEventListener("touchend", askAboutMark, { passive: true });
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
    ACK_NOTICE: ACK_NOTICE,
    SCRUB_GUIDANCE: SCRUB_GUIDANCE,
    acknowledge: acknowledge,
    review: review,
    notPii: notPii,
    verifyOutput: verifyOutput,
    applyMap: applyMap,
    restoreOutput: restoreOutput,
    mergeMaps: mergeMaps,
    noticeText: noticeText,
    rehydrate: rehydrate,
    // "Restore original words on copy": role tokens to words, clipboard only.
    forEhr: forEhr,
    roleTokenRows: roleTokenRows,
    roleTagsIn: roleTagsIn,
    withoutRoleWords: withoutRoleWords,
    persistMap: persistMap,
    installPHIHighlight: installPHIHighlight,
    /* The type-time screen list. screenAnswer records one of the two answers a
       tapped mark can carry; markAt says which mark a caret offset is in, which
       is how a tap on the textarea becomes an answer about a word. */
    screenAnswer: screenAnswer,
    markAt: markAt,
    // exposed for testing / the stress-test page
    _detect: detect,
    _detectedSpans: detectedSpans,
    _screenFilter: screenFilter,
    _buildMap: buildMap,
    _guessRole: guessRole,
    _defaultTokens: defaultTokens,
    _seedsFromMap: seedsFromMap,
    _identifierSeeds: identifierSeeds,
    _personEvidence: personEvidence,
  };
})();
