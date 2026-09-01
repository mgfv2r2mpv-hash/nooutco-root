/*
 * notes-scrub.js - automatic PHI/PII removal shared by the notes tools.
 *
 * Compliance model (no BAA / no ZDR): PHI must never reach the API. De-identifying
 * the input *before* anything is sent is the HIPAA control here - the API only ever
 * receives role tokens (Client, Caregiver, …). Both gates run with no dialog:
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
 * substitutes real names in their own EHR). The name->token map is EPHEMERAL: it
 * lives only for the duration of one action and is never stored or transmitted.
 * persistMap() is an inert hook for future encrypted-at-rest storage if re-insertion
 * is ever added.
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
    "Please be careful to avoid using names and identifying information in the future. " +
    "Refer to the client as “Client,” parent as “Parent,” and staff by role " +
    "(BT, BCBA, SLP, OT, etc.). Remember that client health information responsibility " +
    "sits with ALL providers at all times.";

  /* Two kinds of replacement, decided by evidence rather than by hope.
   *
   * A word with person-evidence gets a ROLE token (Client, Caregiver 2) and that
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
      var rm = /^(.+?)(?: (\d+))?$/.exec(token);
      if (!rm) return;
      var role = ROLES.filter(function (r) { return r.token === rm[1]; })[0];
      if (!role) return;
      var idx = rm[2] ? parseInt(rm[2], 10) : 1;
      if (idx > (seeds.counts[role.key] || 0)) seeds.counts[role.key] = idx;
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

  function defaultTokens(names, freeText, seen) {
    var seeds = seedsFromMap(seen);
    var counts = seeds.counts;
    var opaque = seeds.opaque;
    return names.map(function (name) {
      if (!personEvidence(name, freeText)) {
        opaque += 1;
        return { roleKey: null, token: "[[T" + opaque + "]]", restore: true };
      }
      var role = roleByKey(guessRole(name, freeText));
      counts[role.key] = (counts[role.key] || 0) + 1;
      var n = counts[role.key];
      return {
        roleKey: role.key,
        token: n === 1 ? role.token : role.token + " " + n,
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

  function applyMap(text, map) {
    var s = scrub();
    if (!s || !map || !map.length) return text;
    return s.applyScrub(text, map);
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
    if (!s || !s.restoreDeep || !map || !map.length) return value;
    var back = map.filter(function (e) { return e.restore; });
    return back.length ? s.restoreDeep(value, back) : value;
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

  // Inert hook. If re-insertion is ever added, encrypt the map at rest here
  // (Web Crypto AES-GCM, key derived from a clinician passphrase via PBKDF2) - never
  // store the map in plaintext, never transmit it. Currently a no-op by design.
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
    "Do not enter Protected Health Information (PHI) or personally identifiable " +
    "information (PII) - client names, dates, addresses, or any other identifier - " +
    "into this tool. Submitting PHI to a third-party AI service without a signed " +
    "Business Associate Agreement can violate HIPAA, the HITECH Act, and other " +
    "applicable laws. You are solely responsible for ensuring no identifying " +
    "information is submitted. This tool detects and removes names and identifiers " +
    "before anything is transmitted as a safeguard, but it does not replace your " +
    "professional and legal duty to de-identify your input.";

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
      var idMap = identifierMap(freeText, seen);
      var names = detect(freeText);
      if (!names.length) { resolve({ cancelled: false, map: idMap, certified: [] }); return; }

      var defaults = defaultTokens(names, freeText, seen);
      var built = buildMap(names.map(function (name, i) {
        return {
          name: name,
          replacement: defaults[i].token,
          cert: false,
          restore: defaults[i].restore,
        };
      }), freeText);
      var map = idMap.concat(built.map);

      // Report the bare scrubbed words (names only, no context) to the admin PII
      // review queue. NotesGate.pii drops dictionary names and anything it cannot
      // transmit safely. Identifiers are excluded on purpose: the point of that
      // queue is to learn name vocabulary, and a phone number is neither a word
      // nor safe to transmit.
      if (map.length && window.NotesGate && window.NotesGate.pii) {
        window.NotesGate.pii.reportScrubbed(
          map.filter(function (m) { return !m.identifier; }).map(function (m) { return m.name; })
        );
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
    persistMap: persistMap,
    installPHIHighlight: installPHIHighlight,
    // exposed for testing / the stress-test page
    _detect: detect,
    _buildMap: buildMap,
    _guessRole: guessRole,
    _defaultTokens: defaultTokens,
    _seedsFromMap: seedsFromMap,
    _identifierSeeds: identifierSeeds,
    _personEvidence: personEvidence,
  };
})();
