/* THE EXPERT'S PRAISE, DROPPED BEFORE ANYONE READS IT (issue #119).
 *
 * Kaleb, 2026-09-01, from inside the tool: "what is the use in the expert
 * saying 'this is good' to me? It just wastes space." The day after, he ruled
 * the same way on the register "keep" rows ("'Fine as written' is not
 * helpful"), and those are already filtered by action. This covers the rest:
 * an ask, or a phrase to reword, whose words only praise.
 *
 * THE LINE IS ACTIONABILITY, NOT TONE. A finding that praises AND asks for
 * something stays whole: "Good detail on the prompt. How long did each
 * elopement last?" is an ask with a compliment in front of it, and dropping it
 * would lose the ask. So a finding is dropped only when it matches a praise
 * pattern and matches nothing that asks for a change. When in doubt it stays.
 *
 * Pure. It reads the expert's result and returns a new one; it never edits
 * the one it was given. */
(function () {
  "use strict";

  /* Words that only approve. Each pattern names a verdict on the writing with
     nothing to do about it. */
  var PRAISE = [
    /\b(?:(?:this|that|the)\s+(?:note|section|sentence|description|summary|wording|phrasing|paragraph|part)|this|that|it)\s+(?:is|was|reads|looks)\s+(?:very\s+|really\s+)?(?:good|great|fine|solid|strong|clear|excellent|accurate|appropriate|complete|thorough|well[- ]\w+)\b/i,
    /\b(?:that's|it's|this's)\s+(?:very\s+|really\s+)?(?:good|great|fine|solid|strong|clear|excellent)\b/i,
    /\bwell[- ](?:written|documented|done|stated|described|structured|organized|organised|detailed|phrased|put)\b/i,
    /\b(?:good|great|nice|excellent|solid|strong|clear)\s+(?:job|work|detail|details|documentation|description|writing|note|section|sentence|summary|use|example|wording|phrasing)\b/i,
    /\bno\s+(?:changes?|edits?|issues?|concerns?|problems?)\s+(?:are\s+)?(?:needed|required|found|here)\b/i,
    /\bnothing\s+to\s+(?:change|fix|add|flag)\b/i,
    /\bfine\s+as\s+(?:written|is)\b/i,
    /\bkeep\s+(?:it\s+|this\s+)?as\s+(?:written|is)\b/i,
    /\b(?:meets|satisfies)\s+(?:the\s+)?(?:standard|criteria|criterion|bar|requirement)s?\b/i,
    /^\s*(?:good|great|nice|excellent|perfect|solid)[.!]?\s*$/i,
  ];

  /* Anything that asks the clinician to do or answer something. One match
     keeps the finding. A question mark is the strongest signal there is, since
     an ask is a question by the expert's own schema. */
  var ACTIONABLE = [
    /\?/,
    /\b(?:add|include|specify|state|say|name|clarify|describe|replace|remove|cut|change|rewrite|reword|rephrase|consider|move|split|confirm|list|give|report|record|quantify|define|drop|delete|expand|shorten|separate|attribute|count|note how|note what|note whether)\b/i,
    /\b(?:should|could|would|needs?|missing|lacks?|lacking|without|but|however|though|although|except|instead|unclear|vague|ambiguous|unsupported|not stated|not clear)\b/i,
  ];

  function text(v) {
    return typeof v === "string" ? v : "";
  }

  function any(patterns, s) {
    for (var i = 0; i < patterns.length; i++) if (patterns[i].test(s)) return true;
    return false;
  }

  /* True only when the words praise and ask for nothing. Empty text is not
     praise: a finding with nothing in it is some other fault, and another
     filter already decides what to do with it. */
  function praiseOnly(s) {
    var t = text(s).trim();
    if (!t) return false;
    if (!any(PRAISE, t)) return false;
    return !any(ACTIONABLE, withoutPraise(t));
  }

  /* The praise itself is taken out before looking for an ask, because some
     praise is built out of an action word: "nothing to change" and "keep as
     is" carry a verb that asks for nothing. */
  function withoutPraise(t) {
    return PRAISE.reduce(function (rest, re) {
      var flags = re.flags.indexOf("g") === -1 ? re.flags + "g" : re.flags;
      return rest.replace(new RegExp(re.source, flags), " ");
    }, t);
  }

  // An ask is praise when its words and its reason both ask for nothing.
  function hintIsPraise(h) {
    if (!h) return false;
    var joined = [text(h.ask), text(h.why)].filter(Boolean).join(" ");
    return praiseOnly(joined);
  }

  /* A phrase to reword is praise when it offers no replacement and its reason
     only approves. A row with a replacement is a remedy, whatever its reason
     says, so it stays. */
  function registerIsPraise(r) {
    if (!r) return false;
    if (text(r.move).trim() && !praiseOnly(r.move)) return false;
    return praiseOnly([text(r.why), text(r.move)].filter(Boolean).join(" "));
  }

  /* The expert's result with its praise-only findings removed, and a count of
     what went, so the audit can say how often it happens. Terms are readings,
     not verdicts, and pass through untouched. */
  function drop(found) {
    if (!found || typeof found !== "object") return found;
    var hints = Array.isArray(found.hints) ? found.hints : [];
    var register = Array.isArray(found.register) ? found.register : [];
    var keptHints = hints.filter(function (h) { return !hintIsPraise(h); });
    var keptRegister = register.filter(function (r) { return !registerIsPraise(r); });
    var dropped = (hints.length - keptHints.length) + (register.length - keptRegister.length);
    var out = {};
    for (var k in found) if (Object.prototype.hasOwnProperty.call(found, k)) out[k] = found[k];
    if (Array.isArray(found.hints)) out.hints = keptHints;
    if (Array.isArray(found.register)) out.register = keptRegister;
    out.praiseDropped = dropped;
    return out;
  }

  window.ExpertPraise = {
    praiseOnly: praiseOnly,
    hintIsPraise: hintIsPraise,
    registerIsPraise: registerIsPraise,
    drop: drop,
  };
})();
