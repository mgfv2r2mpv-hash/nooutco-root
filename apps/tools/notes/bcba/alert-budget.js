/* ONE BUDGET, EIGHT PRODUCERS, THREE TIERS.
 *
 * Eight separate things in this app can decide a technician needs to be told
 * something, and every one of them was written as though it were the only one.
 * The scrub notice, the pre-draft wrong-section check, the gap questions, the
 * model's own hint catalog, the expert pass, the register measure, the hollow
 * and absence passes, and the rubric band. Each is defensible on its own. Eight
 * at once is a wall, and a wall gets skipped whole - which is how a note ends
 * up filed with the one finding on it that a funder would have rejected.
 *
 * So the alerts get a BUDGET rather than a channel each. Every producer states
 * a tier, the queue is ranked across all of them, and what does not fit is
 * withheld with a reason rather than dropped in silence.
 *
 *   tier 1  the note says something wrong
 *   tier 2  the note is missing something a supervisor will ask about
 *   tier 3  the note could read better
 *
 * TWO RULES THAT ARE NOT NEGOTIABLE HERE.
 *
 * A tier-3 item never occupies a slot while a tier-1 is unresolved. Not ranked
 * below it - withheld entirely. "Reads a bit flat" beside "you claimed a
 * behaviour the data does not show" is not a priority ordering, it is noise
 * sitting on top of the one row that mattered.
 *
 * A producer that cannot state its tier gets no slot. It lands in `refused`
 * with a reason, where a test and a bench can both read it. A finding that
 * cannot say how bad it is cannot be ranked, and ranking it anyway by guessing
 * is how the one serious finding ends up fifth.
 *
 * WHAT THIS FILE IS NOT. It draws nothing and it knows nothing about the page.
 * It takes what the producers already compute and returns a list plus the
 * reasons for everything missing from it. The interface over the top of it is
 * the maintainer's to rule on, and this has to be true before that ruling
 * arrives rather than after.
 *
 * NO NOTE TEXT LEAVES IN AN ITEM'S IDENTITY. `key` is built out of a producer
 * id, a code and a section id, all of them enums. `detail` carries prose for
 * the reader and is never part of the key, so a disposition recorded against an
 * item is recorded against a CLASS and not against a sentence.
 */
(function () {
  "use strict";

  /* The tiers, as the maintainer stated them. Numbers because they sort, names
     because a producer that has to write `AlertBudget.TIER.WRONG` cannot
     accidentally state a tier it did not mean. */
  var TIER = { WRONG: 1, MISSING: 2, POLISH: 3 };
  var TIERS = [TIER.WRONG, TIER.MISSING, TIER.POLISH];

  /* HOW MANY ROWS THE WHOLE NOTE GETS, across all eight producers.
     The pre-draft check already argued this number for its own findings: "two
     findings is a technician who has something to fix; five is a wall, and a
     wall gets skipped whole". That argument was made about one producer. Five
     across ALL of them is the same ceiling applied where it belongs, which
     makes this the total budget and not a per-producer allowance.
     A caller may pass its own cap; nothing here treats five as a law. */
  var DEFAULT_CAP = 5;

  /* The model's own severity words, mapped onto the tiers. This is the one
     place the two vocabularies meet, and it is a straight reading rather than a
     judgement: "blocks-claim" is defined in the hint schema as a funder could
     reject the claim over this, which is the note saying something wrong;
     "thin" is missing clinical detail; "register" is how the note reads. */
  var KIND_TIER = {
    "blocks-claim": TIER.WRONG,
    thin: TIER.MISSING,
    register: TIER.POLISH,
  };

  /* An opaque token is [[T3]], [T3], [[t3]] and the whitespace variants a model
     returns. Same family the round-trip harness asserts against, and it is
     written out here rather than imported because notes-scrub owns the
     substitution and this owns the reading of a failure. One regex built per
     call: a global regex carries lastIndex between calls and the second read of
     the same note would come back clean. */
  function tokenFamily() {
    return /\[\[?\s*[Tt]\s*\d+\s*\]?\]/g;
  }

  function str(x) {
    return typeof x === "string" ? x : "";
  }

  function list(x) {
    return Array.isArray(x) ? x : [];
  }

  /* An item, with everything a ranker needs and nothing a renderer wants.
     `rank` is the producer's own ordering INSIDE its tier, never across tiers:
     a producer cannot promote itself past another producer's tier by ranking
     its finding zero. */
  function item(producer, tier, spec) {
    return {
      producer: producer,
      tier: tier,
      rank: typeof spec.rank === "number" && isFinite(spec.rank) ? spec.rank : 50,
      code: str(spec.code) || "unspecified",
      section: str(spec.section) || "note",
      detail: str(spec.detail),
      key: producer + ":" + (str(spec.code) || "unspecified") + ":" + (str(spec.section) || "note"),
    };
  }

  // ─────────────────────────────────────────────────────── the eight producers

  /* 1. THE SCRUB NOTICE, and it is two findings rather than one.
   *
   * A word that was substituted and STAYS in the note is an ordinary fact about
   * a note with a person's name in it. The technician should see it, and it is
   * not an error, so it is tier 2.
   *
   * A token still sitting in the rendered note is a different animal: the
   * clinician is reading "[[T3]] hit the table" where they wrote a word. That
   * is the note saying something wrong, and it is tier 1. It fires only on a
   * hydration failure, which is why tier 1 is not permanently occupied by a
   * producer that runs on every note.
   */
  function scrubItems(src) {
    var out = [];
    var map = list(src && src.map);
    var kept = map.filter(function (e) { return e && !e.restore && e.token; });
    var text = "";
    var output = (src && src.output) || null;
    if (output && typeof output === "object") {
      Object.keys(output).forEach(function (k) {
        if (typeof output[k] === "string") text += " " + output[k];
      });
    }
    var stranded = text ? (text.match(tokenFamily()) || []).length : 0;
    if (stranded) {
      out.push(item("scrub", TIER.WRONG, {
        code: "token_in_note",
        rank: 0,
        detail: stranded + " word" + (stranded > 1 ? "s were" : " was") +
          " replaced before the note went out and did not come back. Do not file this as it stands.",
      }));
    }
    if (kept.length) {
      out.push(item("scrub", TIER.MISSING, {
        code: "substituted",
        rank: 20,
        detail: kept.length + " name" + (kept.length > 1 ? "s were" : " was") +
          " written as a role. Check each one is really a person.",
      }));
    }
    return out;
  }

  /* 2. THE PRE-DRAFT WRONG-SECTION CHECK. A strategy typed into the box that
     does not own it lands in the narrative that does not own it, so the note
     states that a consequence procedure ran as an antecedent one. That is the
     note saying something wrong, and it is the one finding on the list that is
     a match against the tool's own published table rather than a judgement. */
  function wrongSectionItems(src) {
    return list(src && src.misfiled).map(function (f, i) {
      return item("wrong-section", TIER.WRONG, {
        code: str(f && f.code) || "strategy_in_wrong_section",
        section: str(f && f.section),
        rank: i,
        detail: str(f && f.homeLabel) ? str(f.homeLabel) + " strategy is filed elsewhere" : "",
      });
    });
  }

  /* 3. THE GAP QUESTIONS. What the model could not tell from the note is by
     definition what the note is missing, so every one of these is tier 2 - with
     one exception the engine already makes for its own reasons. A question the
     TOOL injected carries `injected`, and those are the misfiled rows, which
     producer 2 has already raised at tier 1. Raising them again here would put
     one finding in the queue twice under two tiers. */
  function gapItems(src) {
    return list(src && src.questions)
      .filter(function (q) { return q && !q.injected; })
      .map(function (q, i) {
        return item("gaps", TIER.MISSING, {
          code: "gap_" + (str(q.bar) || "unbarred").toLowerCase(),
          section: str(q.field),
          rank: i,
          detail: str(q.question),
        });
      });
  }

  /* 4. THE HINT CATALOG. The model already stated a severity and an ordering,
     and both are in the schema it answered against. Reading them is the whole
     job here. A hint whose kind is not one of the three the schema declares
     cannot state a tier, and it is refused rather than defaulted - a default
     would file an unknown severity as "thin" and it would never be looked at
     again. */
  function hintItems(src) {
    var out = [];
    var refused = [];
    list(src && src.hints).forEach(function (h, i) {
      if (!h || typeof h.code !== "string") {
        refused.push({ producer: "hints", reason: "no-code", at: i });
        return;
      }
      var tier = KIND_TIER[h.kind];
      if (!tier) {
        refused.push({ producer: "hints", reason: "no-tier", code: h.code, kind: str(h.kind) });
        return;
      }
      out.push(item("hints", tier, {
        code: h.code,
        section: str(h.section),
        rank: typeof h.rank === "number" && isFinite(h.rank) ? h.rank : 50,
        detail: str(h.detail),
      }));
    });
    return { items: out, refused: refused };
  }

  /* 5. THE EXPERT PASS. Three channels arrive in one result and they are not
     equally serious. Its hints carry the same kind vocabulary as the model's
     own, so they take the same reading. Its register findings and its term
     findings are both about how the note reads. */
  function expertItems(src) {
    var expert = (src && src.expert) || null;
    if (!expert || expert.status !== "done") return { items: [], refused: [] };
    var out = [];
    var refused = [];
    list(expert.hints).forEach(function (h, i) {
      var tier = h && KIND_TIER[h.kind];
      if (!tier) {
        refused.push({ producer: "expert", reason: "no-tier", kind: str(h && h.kind), at: i });
        return;
      }
      out.push(item("expert", tier, {
        code: str(h.code) || "expert_hint",
        section: str(h.section),
        rank: typeof h.rank === "number" && isFinite(h.rank) ? h.rank : 40,
        detail: str(h.detail),
      }));
    });
    var reg = list(expert.register).filter(function (r) {
      return r && str(r.quote).trim() && (r.action || "ask") !== "keep";
    });
    if (reg.length) {
      out.push(item("expert", TIER.POLISH, {
        code: "expert_register",
        rank: 60,
        detail: reg.length + " sentence" + (reg.length > 1 ? "s read" : " reads") + " like a machine wrote it",
      }));
    }
    var terms = list(expert.terms);
    if (terms.length) {
      out.push(item("expert", TIER.POLISH, {
        code: "expert_terms",
        rank: 61,
        detail: terms.length + " term" + (terms.length > 1 ? "s have" : " has") + " a more precise form",
      }));
    }
    return { items: out, refused: refused };
  }

  /* 6. THE REGISTER RULES, measured on the prose rather than asked of a model.
     note-metrics.js reads the note for the constructions the register rules
     ban, and its answer is a list of words. One flagged word is a word choice
     and three of them is the register, which is the engine's own standing rule
     and is why this raises nothing under the floor. Always tier 3: a note that
     reads flat is still a true note. */
  var REGISTER_FLOOR = 3;

  function registerItems(src) {
    var flagged = list(src && src.registerFlagged);
    if (flagged.length < REGISTER_FLOOR) return [];
    return [item("register", TIER.POLISH, {
      code: "tired_register",
      rank: 70,
      detail: flagged.length + " tired constructions. Say what happened in your own words.",
    })];
  }

  /* 7. THE HOLLOW AND ABSENCE PASSES, which report counts rather than findings.
     A cut sentence is already gone and nothing needs saying about it. A FLAGGED
     one stayed, because a person was doing the acting, and a sentence that
     records the absence of a person's action is the note asserting something
     nobody observed - tier 1. A recast zero and a hollow section are both the
     note being thin where the data is not, which is tier 2. */
  function passItems(src) {
    var out = [];
    var absence = (src && src.absence) || {};
    var hollow = (src && src.hollow) || {};
    if (absence.flagged) {
      out.push(item("passes", TIER.WRONG, {
        code: "absence_flagged",
        rank: 5,
        detail: absence.flagged + " sentence" + (absence.flagged > 1 ? "s report" : " reports") +
          " something that did not happen. Say what did.",
      }));
    }
    if (hollow.hollow) {
      out.push(item("passes", TIER.MISSING, {
        code: "hollow_section",
        rank: 25,
        detail: hollow.hollow + " section" + (hollow.hollow > 1 ? "s say" : " says") + " nothing a reader could act on",
      }));
    }
    return out;
  }

  /* 8. THE RUBRIC BAND. One item, never a per-dimension list: the rubric exists
     to say how the note is doing as a whole, and exploding it back into rows
     would put the same findings in the queue twice, once from the hints that
     fed it and once from the grade they produced.
     A blocking dimension is what a funder rejects, so `missing` is tier 1;
     `thin` is tier 2; `good` raises nothing. A level this does not recognise
     states no tier and is refused. */
  function rubricItems(src) {
    var q = (src && src.quality) || null;
    if (!q || !q.level || q.level === "idle" || q.level === "good") return { items: [], refused: [] };
    var tier = q.level === "missing" ? TIER.WRONG : q.level === "thin" ? TIER.MISSING : null;
    if (!tier) {
      return { items: [], refused: [{ producer: "rubric", reason: "no-tier", level: str(q.level) }] };
    }
    return {
      items: [item("rubric", tier, {
        code: "rubric_" + q.level,
        rank: 10,
        detail: str(q.reason),
      })],
      refused: [],
    };
  }

  /* The registry. Order here is the tie-break order in the queue, so it is the
     order the findings were argued in: what the tool knows for certain first,
     what the model judged after, what a measure noticed last. */
  /* `reads` NAMES THE SOURCE FIELDS, and it is not decoration.
     A producer id and the key its findings arrive under are different things:
     the wrong-section producer reads `misfiled`, the passes producer reads
     `absence` and `hollow`. Checking incoming keys against producer ids instead
     would refuse every real source as unregistered and fill the one list whose
     whole job is answering "why did I not see that" with noise. */
  var PRODUCERS = [
    { id: "scrub", label: "Words the scrubber substituted", reads: ["map", "output"], collect: scrubItems },
    { id: "wrong-section", label: "Strategy filed under the wrong box", reads: ["misfiled"], collect: wrongSectionItems },
    { id: "passes", label: "The hollow and absence passes", reads: ["absence", "hollow"], collect: passItems },
    { id: "rubric", label: "How the note grades", reads: ["quality"], collect: rubricItems },
    { id: "hints", label: "What the model flagged", reads: ["hints"], collect: hintItems },
    { id: "expert", label: "What the expert pass found", reads: ["expert"], collect: expertItems },
    { id: "gaps", label: "What the note could not answer", reads: ["questions"], collect: gapItems },
    { id: "register", label: "How the note reads", reads: ["registerFlagged"], collect: registerItems },
  ];

  var PRODUCER_IDS = PRODUCERS.map(function (p) { return p.id; });

  // ─────────────────────────────────────────────────────────────── the ranking

  /* Collect every producer's findings into one list, keeping the refusals.
     A source key naming no registered producer is itself a refusal: a ninth
     producer added later and never registered here would otherwise send its
     findings into a function that quietly ignores them, and the only symptom
     would be a note missing an alert nobody knew to look for. */
  function collect(sources, producers) {
    var src = sources && typeof sources === "object" ? sources : {};
    /* The registry is injectable so the tier rule can be tested on a producer
       that breaks it. Nothing in the app passes this: the eight are the eight,
       and a ninth added later belongs in PRODUCERS beside them. What it buys is
       that "a producer that cannot state its tier gets no slot" is a rule a
       test can put a producer in front of, rather than a claim about code no
       caller can reach. */
    var reg = Array.isArray(producers) && producers.length ? producers : PRODUCERS;
    /* Every field some producer claims to read, plus the producer ids
       themselves so an injected producer can be fed under its own name. */
    var known = {};
    reg.forEach(function (p) {
      known[p.id] = true;
      (p.reads || []).forEach(function (f) { known[f] = true; });
    });
    var items = [];
    var refused = [];
    Object.keys(src).forEach(function (k) {
      if (!known[k]) refused.push({ producer: k, reason: "unregistered" });
    });
    reg.forEach(function (p) {
      var r = p.collect(src) || [];
      if (Array.isArray(r)) {
        items = items.concat(r);
        return;
      }
      items = items.concat(list(r.items));
      refused = refused.concat(list(r.refused));
    });
    /* Last line of defence, and it is not redundant with the per-producer
       checks: a producer added later that forgets to state a tier lands here
       rather than in the queue at whatever number it happened to carry. */
    var tiered = [];
    items.forEach(function (it) {
      if (TIERS.indexOf(it.tier) === -1) {
        refused.push({ producer: it.producer, reason: "no-tier", code: it.code });
        return;
      }
      tiered.push(it);
    });
    return { items: tiered, refused: refused };
  }

  function producerOrder(id) {
    var i = PRODUCER_IDS.indexOf(id);
    return i === -1 ? PRODUCERS.length : i;
  }

  /* Resolution, and it is deliberately not the same question as acceptance.
     A CHANGE the tool made is accepted by default, which is the maintainer's
     ruling and is why no item here carries an accept control. A FINDING is a
     statement that the note has a fault, and nobody untouching it has answered
     that. So an item is resolved when the technician has said something about
     it - approved it, rejected it, or edited over it - and "no action" leaves
     it open. That is the only reading under which "a tier 3 never sits beside
     an unresolved tier 1" means anything at all. */
  var RESOLVING = { approve: true, reject: true, revert: true, edit: true };

  function resolvedBy(dispositions, key) {
    var d = dispositions && dispositions[key];
    return !!(d && RESOLVING[typeof d === "string" ? d : d.disposition]);
  }

  /* One ranked capped queue.
     Returns { shown, withheld, refused, open }, where `withheld` carries a
     reason per item and `open` is the unresolved tier-1 count the withholding
     rule turned on. Nothing is dropped without a record: this function's whole
     value is that the answer to "why did I not see that" is in its return. */
  function rank(items, opts) {
    var o = opts || {};
    var cap = typeof o.cap === "number" && o.cap >= 0 ? o.cap : DEFAULT_CAP;
    var dispositions = o.dispositions || {};
    var all = list(items).map(function (it) {
      return Object.assign({}, it, { resolved: resolvedBy(dispositions, it.key) });
    });

    var open = all.filter(function (it) {
      return it.tier === TIER.WRONG && !it.resolved;
    }).length;

    var sorted = all.slice().sort(function (a, b) {
      return (a.tier - b.tier) ||
        (a.rank - b.rank) ||
        (producerOrder(a.producer) - producerOrder(b.producer)) ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    });

    var shown = [];
    var withheld = [];
    sorted.forEach(function (it) {
      if (it.tier === TIER.POLISH && open) {
        withheld.push(Object.assign({}, it, { withheld: "tier-1-open" }));
        return;
      }
      if (shown.length >= cap) {
        withheld.push(Object.assign({}, it, { withheld: "over-cap" }));
        return;
      }
      shown.push(it);
    });

    return { shown: shown, withheld: withheld, open: open, cap: cap };
  }

  function build(sources, opts) {
    var got = collect(sources, opts && opts.producers);
    var ranked = rank(got.items, opts);
    return {
      shown: ranked.shown,
      withheld: ranked.withheld,
      refused: got.refused,
      open: ranked.open,
      cap: ranked.cap,
      offered: got.items.length,
    };
  }

  window.AlertBudget = {
    TIER: TIER,
    TIERS: TIERS,
    DEFAULT_CAP: DEFAULT_CAP,
    REGISTER_FLOOR: REGISTER_FLOOR,
    PRODUCERS: PRODUCERS,
    PRODUCER_IDS: PRODUCER_IDS,
    collect: collect,
    rank: rank,
    build: build,
  };
})();
