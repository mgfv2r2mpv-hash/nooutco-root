/* THE HOUSE SYNONYM FAMILIES, AND THE ONLY THING AN AUTHOR'S WORD CHOICE MAY
 * LEAVE BEHIND.
 *
 * Two technicians describe the same five seconds and one writes "prompted", the
 * other writes "assisted". Neither is wrong and the difference is voice, which
 * is the thing this run is trying to learn. The problem is that the obvious way
 * to learn it, keeping the words somebody used, is a store full of clinical
 * text within a week, and a store full of clinical text is a store that will
 * eventually hold a name.
 *
 * So a word never leaves. A word is looked up in a closed house dictionary and
 * what leaves is {family_id, variant_index, count}: which of a handful of
 * meanings the author reached for, which synonym inside it they picked, and how
 * often. A word the house does not hold has no index at all, so it is counted
 * as unknown and dropped. That is the whole privacy argument, and it is
 * structural rather than a promise: buildEntries never reads the matched text,
 * only FAMILIES[i].id and an integer, and record() checks both against the
 * sealed dictionary before anything is handed to a caller who might store it.
 *
 * WHAT IS MINE AND WHAT IS THE MAINTAINER'S. The families named in the ruling
 * (prompting, mand, elopement, dysregulation) are his. Every surface form under
 * them, and every other family, is authored here and is the part to argue with.
 *
 * WHY SOME OBVIOUS FORMS ARE MISSING ON PURPOSE. A form that is a different
 * word in these notes is worse than a form that is absent, because it counts a
 * meaning the author did not reach for. "Ran" is the loudest case: "ran mixed
 * trials" is half the session notes in this app, so the elopement family holds
 * "ran off" and "ran away" as phrases and never bare "ran". Same reasoning
 * keeps "note" out of the display family and bare "bit" out of self-injury.
 * Each of these is a measurement choice, not a typo.
 *
 * NOT A VOCABULARY GRADE. Nothing here says one variant is better than another,
 * and nothing in this file ranks them. It measures which one an author uses so
 * that the tool can write the way they already write.
 *
 * Exposes window.NoteDiction
 *   .tally(text, dict)   -> counts, unknown, words
 *   .record(tally)       -> the payload, checked against the sealed dictionary
 *   .merge(prev, next)   -> a new per author record, immutably
 *   .selfCheck(dict)     -> duplicate surface forms, for the fixture test
 */
(function () {
  "use strict";

  /* Each family is one meaning. Each variant inside it is one way of saying
     that meaning, and its POSITION is what gets recorded, so the order of this
     list is a stored value: inserting a variant in the middle rewrites the
     meaning of every number already in the store. Append, never insert.

     Forms inside a variant are morphology, not choice. "prompted", "prompting"
     and "prompts" are the same decision by the author and share an index. */
  var FAMILIES = [
    {
      id: "prompting",
      variants: [
        ["prompted", "prompt", "prompting", "prompts"],
        ["assisted", "assist", "assisting", "assists"],
        ["guided", "guide", "guiding", "guides"],
        ["helped", "help", "helping", "helps"],
        ["supported", "supporting", "supports"],
        ["cued", "cue", "cuing", "cueing", "cues"],
      ],
    },
    {
      id: "mand",
      variants: [
        ["mand", "manded", "manding", "mands"],
        ["requested", "request", "requesting", "requests"],
        ["asked for", "asks for", "asking for", "ask for"],
        ["indicated", "indicate", "indicating", "indicates"],
      ],
    },
    {
      id: "elopement",
      variants: [
        ["elopement", "eloped", "elope", "eloping", "elopes"],
        ["bolted", "bolting", "bolts"],
        // Phrases only. Bare "ran" and bare "running" are the verb for
        // conducting a programme in these notes, and counting those as
        // elopement would put a behaviour in a note that never described one.
        ["ran off", "running off", "runs off", "ran away", "running away", "runs away"],
        ["left the area", "leaves the area", "leaving the area"],
        ["wandered", "wandering", "wanders"],
      ],
    },
    {
      id: "dysregulation",
      variants: [
        ["tantrum", "tantrums", "tantrumed", "tantrumming", "tantruming"],
        ["dysregulation", "dysregulated", "dysregulate", "dysregulating"],
        ["upset"],
        ["meltdown", "meltdowns"],
        ["distressed", "distress"],
      ],
    },
    {
      id: "aggression",
      variants: [
        ["aggression", "aggressive", "aggressively"],
        ["hitting", "hit", "hits"],
        ["struck", "striking", "strikes"],
        ["kicked", "kicking", "kicks"],
        ["swatted", "swatting", "swats"],
      ],
    },
    {
      id: "self_injury",
      variants: [
        ["self-injury", "self-injurious", "sib"],
        ["head-banging", "head banging", "banged", "banging"],
        ["scratched", "scratching", "scratches"],
        // "bit" is missing on purpose: "a bit longer" is the same three letters.
        ["biting", "bites"],
      ],
    },
    {
      id: "reinforcement",
      variants: [
        ["reinforced", "reinforce", "reinforcing", "reinforcement", "reinforces"],
        ["rewarded", "reward", "rewarding", "rewards"],
        ["praised", "praise", "praising", "praises"],
        ["earned", "earn", "earning", "earns"],
      ],
    },
    {
      id: "compliance",
      variants: [
        ["complied", "comply", "compliance", "complying", "compliant"],
        ["followed", "follow", "following", "follows"],
        ["cooperated", "cooperative", "cooperation", "cooperating"],
      ],
    },
    {
      id: "refusal",
      variants: [
        ["refused", "refuse", "refusing", "refusal", "refuses"],
        ["declined", "decline", "declining", "declines"],
        ["non-compliance", "noncompliance", "non-compliant", "noncompliant"],
        ["resisted", "resist", "resisting", "resists"],
        ["protested", "protest", "protesting", "protests"],
      ],
    },
    {
      id: "engagement",
      variants: [
        ["engaged", "engage", "engaging", "engagement", "engages"],
        ["participated", "participate", "participating", "participation"],
        ["attended", "attend", "attending"],
        ["on task", "on-task"],
      ],
    },
    {
      id: "redirection",
      variants: [
        ["redirected", "redirect", "redirecting", "redirection", "redirects"],
        ["re-engaged", "reengaged", "re-engaging", "reengaging"],
        ["refocused", "refocus", "refocusing"],
        ["prompted back", "brought back"],
      ],
    },
    {
      id: "independence",
      variants: [
        ["independently", "independent", "independence"],
        ["unprompted"],
        ["on his own", "on her own", "on their own"],
        ["without help", "without assistance", "without support"],
      ],
    },
    {
      id: "escalation",
      variants: [
        ["escalated", "escalate", "escalating", "escalation", "escalates"],
        ["increased", "increase", "increasing", "increases"],
        ["intensified", "intensify", "intensifying"],
        ["worsened", "worsening", "worsens"],
      ],
    },
    {
      id: "calming",
      variants: [
        ["calm", "calmed", "calming", "calmly"],
        ["regulated", "regulate", "regulating", "regulation"],
        ["settled", "settle", "settling", "settles"],
        ["de-escalated", "deescalated", "de-escalating", "de-escalation"],
      ],
    },
    {
      id: "transition",
      variants: [
        ["transition", "transitioned", "transitioning", "transitions"],
        ["moved", "move", "moving", "moves"],
        ["switched", "switch", "switching", "switches"],
        ["shifted", "shift", "shifting", "shifts"],
      ],
    },
    {
      id: "vocalization",
      variants: [
        ["vocalization", "vocalizations", "vocalisation", "vocalised", "vocalized", "vocalizing"],
        ["verbalized", "verbalised", "verbal", "verbalization", "verbally"],
        ["said", "says", "saying"],
        ["spoke", "speaking", "speaks"],
      ],
    },
    {
      id: "display",
      variants: [
        // "noted" and "note" are absent: a note is the object this whole app
        // makes, so the word is furniture here rather than a choice. "engaged
        // in" is absent too, because longest-first matching would take it out
        // of the engagement family every time the next word happened to be in.
        ["displayed", "display", "displaying", "displays"],
        ["exhibited", "exhibit", "exhibiting", "exhibits"],
        ["demonstrated", "demonstrate", "demonstrating", "demonstrates"],
        ["showed", "show", "showing", "shows"],
      ],
    },
    {
      id: "frequency",
      variants: [
        ["frequently", "frequent"],
        ["often"],
        ["repeatedly", "repeated"],
        ["multiple times", "several times"],
      ],
    },
    {
      id: "acquisition",
      variants: [
        ["mastered", "mastery", "mastering", "masters"],
        ["acquired", "acquisition", "acquiring", "acquires"],
        ["met criterion", "met the criterion", "meeting criterion"],
        ["generalized", "generalised", "generalization", "generalisation"],
      ],
    },
    {
      id: "caregiver_training",
      variants: [
        ["modeled", "modelled", "modeling", "modelling", "model"],
        ["coached", "coach", "coaching", "coaches"],
        ["trained", "train", "training", "trains"],
        ["reviewed", "review", "reviewing", "reviews"],
      ],
    },
  ];

  // A phrase longer than this is not looked for at all, which bounds the scan.
  var MAX_PHRASE_WORDS = 4;

  // Words as the other measures in this app count them: letters, with an
  // internal apostrophe or hyphen allowed so "self-injurious" and "don't" are
  // one token each rather than two.
  var WORD = /[A-Za-z][A-Za-z'’-]*/g;

  function wordsOf(text) {
    WORD.lastIndex = 0;
    return String(text == null ? "" : text).toLowerCase().match(WORD) || [];
  }

  /* One lookup for the whole dictionary, keyed on the surface form with its
     words joined by a single space. A phrase and a single word live in the same
     map because a phrase is only a form with a space in it. */
  function indexOf(dict) {
    var families = dict && dict.length ? dict : FAMILIES;
    var byForm = Object.create(null);
    var longest = 1;
    for (var f = 0; f < families.length; f++) {
      var variants = families[f].variants || [];
      for (var v = 0; v < variants.length; v++) {
        var forms = variants[v] || [];
        for (var i = 0; i < forms.length; i++) {
          var parts = wordsOf(forms[i]);
          if (!parts.length) continue;
          if (parts.length > MAX_PHRASE_WORDS) continue;
          var key = parts.join(" ");
          // First writer wins, so a form authored twice does not silently move
          // to whichever family happens to be last in the file. selfCheck is
          // what reports the collision.
          if (byForm[key] === undefined) {
            byForm[key] = { family: f, variant: v };
          }
          if (parts.length > longest) longest = parts.length;
        }
      }
    }
    return { families: families, byForm: byForm, longest: longest };
  }

  var HOUSE = indexOf(FAMILIES);

  /**
   * Count which meanings an author reached for, and how many words they used
   * that the house holds no meaning for.
   *
   * @param {string} text
   * @param {Array} dict  a dictionary to use instead of the house one. The test
   *   seam: an injected family is the only way to drive record() against an id
   *   the house does not hold, which is the case its refusal exists for.
   * @returns {{counts: Array, unknown: number, known: number, words: number}}
   */
  function tally(text, dict) {
    var idx = dict ? indexOf(dict) : HOUSE;
    var words = wordsOf(text);
    var seen = Object.create(null);
    var order = [];
    var unknown = 0;
    var known = 0;

    var i = 0;
    while (i < words.length) {
      // Longest first, so "asked for" is a mand rather than an unknown "asked"
      // followed by an unknown "for".
      var take = Math.min(idx.longest, words.length - i);
      var hit = null;
      var span = 0;
      for (var n = take; n >= 1; n--) {
        var key = words.slice(i, i + n).join(" ");
        var found = idx.byForm[key];
        if (found) {
          hit = found;
          span = n;
          break;
        }
      }
      if (!hit) {
        unknown++;
        i += 1;
        continue;
      }
      /* The matched text ends here. What survives this line is two integers,
         and that is the reason the counting map is keyed on positions rather
         than on the word: there is no variable below this point that a word
         could be sitting in. */
      var slot = hit.family + ":" + hit.variant;
      if (seen[slot] === undefined) {
        seen[slot] = 0;
        order.push(hit);
      }
      seen[slot] += 1;
      known += 1;
      i += span;
    }

    var counts = [];
    for (var o = 0; o < order.length; o++) {
      var at = order[o];
      var fam = idx.families[at.family];
      counts.push({
        family_id: fam.id,
        variant_index: at.variant,
        count: seen[at.family + ":" + at.variant],
      });
    }
    counts.sort(byFamilyThenVariant);

    return { counts: counts, unknown: unknown, known: known, words: words.length };
  }

  function byFamilyThenVariant(a, b) {
    if (a.family_id !== b.family_id) return a.family_id < b.family_id ? -1 : 1;
    return a.variant_index - b.variant_index;
  }

  /* The sealed lookup: which ids the house holds and how many variants each
     one has. Built from FAMILIES rather than written out, so it cannot drift
     from the dictionary above it. */
  var HOUSE_IDS = Object.create(null);
  for (var h = 0; h < FAMILIES.length; h++) {
    HOUSE_IDS[FAMILIES[h].id] = (FAMILIES[h].variants || []).length;
  }
  var FAMILY_IDS = FAMILIES.map(function (f) { return f.id; });

  /**
   * The payload, and the gate in front of the store.
   *
   * Everything here is checked against the SEALED house dictionary, never
   * against whatever dictionary produced the tally. That is the point: an
   * injected family, a renamed id or an index past the end of a variant list
   * lands in `refused` with a reason and cannot reach a caller who is about to
   * write it down.
   *
   * @param {{counts: Array, unknown: number, words: number}} counted
   * @returns {{counts: Array, unknown: number, words: number, refused: Array}}
   */
  function record(counted) {
    var src = (counted && counted.counts) || [];
    var kept = [];
    var refused = [];
    for (var i = 0; i < src.length; i++) {
      var entry = src[i] || {};
      var variants = HOUSE_IDS[entry.family_id];
      if (variants === undefined) {
        // No id, so no word: the refusal says which slot, never which family it
        // claimed to be, because a made up id is a string somebody supplied.
        refused.push({ at: i, reason: "family not in the house dictionary" });
        continue;
      }
      var vi = entry.variant_index;
      if (!isWholeNumber(vi) || vi < 0 || vi >= variants) {
        refused.push({ at: i, family_id: entry.family_id, reason: "variant index outside the family" });
        continue;
      }
      var c = entry.count;
      if (!isWholeNumber(c) || c <= 0) {
        refused.push({ at: i, family_id: entry.family_id, reason: "count is not a positive whole number" });
        continue;
      }
      kept.push({ family_id: entry.family_id, variant_index: vi, count: c });
    }
    kept.sort(byFamilyThenVariant);
    return {
      counts: kept,
      unknown: wholeOrZero(counted && counted.unknown),
      words: wholeOrZero(counted && counted.words),
      refused: refused,
    };
  }

  function isWholeNumber(v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
  }

  function wholeOrZero(v) {
    return isWholeNumber(v) && v >= 0 ? v : 0;
  }

  /**
   * One author's record plus one more note, as a new array. The running total
   * is the whole per author store: three fields per row and no history, the
   * same reason voice_level keeps running sums rather than events.
   *
   * @param {Array} prev  the record so far
   * @param {Array} next  this note's counts, already through record()
   * @returns {Array} a new array. Neither argument is touched.
   */
  function merge(prev, next) {
    var out = [];
    var at = Object.create(null);
    var add = function (entry) {
      if (!entry || HOUSE_IDS[entry.family_id] === undefined) return;
      if (!isWholeNumber(entry.variant_index) || !isWholeNumber(entry.count)) return;
      var key = entry.family_id + ":" + entry.variant_index;
      if (at[key] === undefined) {
        at[key] = out.length;
        out.push({ family_id: entry.family_id, variant_index: entry.variant_index, count: entry.count });
        return;
      }
      // Safe to add in place: the row being added to was built by the push
      // above, so it is this function's own object and neither argument holds a
      // reference to it.
      out[at[key]].count += entry.count;
    };
    (prev || []).forEach(add);
    (next || []).forEach(add);
    out.sort(byFamilyThenVariant);
    return out;
  }

  /**
   * Every surface form written down twice. A duplicate is not caught by any
   * measurement, because the loser simply never fires and the number it should
   * have carried lands on the winner instead. The fixture test reads this.
   */
  function selfCheck(dict) {
    var families = (dict && dict.length ? dict : FAMILIES);
    var where = Object.create(null);
    var duplicates = [];
    for (var f = 0; f < families.length; f++) {
      var variants = families[f].variants || [];
      for (var v = 0; v < variants.length; v++) {
        var forms = variants[v] || [];
        for (var i = 0; i < forms.length; i++) {
          var key = wordsOf(forms[i]).join(" ");
          if (!key) {
            duplicates.push({ form: forms[i], reason: "form holds no word" });
            continue;
          }
          if (where[key]) {
            duplicates.push({
              form: key,
              first: where[key],
              second: families[f].id + "[" + v + "]",
              reason: "form is written down twice",
            });
            continue;
          }
          where[key] = families[f].id + "[" + v + "]";
        }
      }
    }
    return duplicates;
  }

  window.NoteDiction = {
    FAMILIES: FAMILIES,
    FAMILY_IDS: FAMILY_IDS,
    VARIANT_COUNTS: HOUSE_IDS,
    MAX_PHRASE_WORDS: MAX_PHRASE_WORDS,
    tally: tally,
    record: record,
    merge: merge,
    selfCheck: selfCheck,
  };
})();
