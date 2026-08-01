/* ── Think or Say? — the card registry ─────────────────────────────────
   Three levels, three separate pools, one card to exactly one level.

   Card selection is driven by the COVERAGE MATRIX in card-model.js, never by a
   target count: there is no established sufficient-N (Hupp 1986 found five
   "good" exemplars beat three only slightly, and not significantly — see
   RESEARCH.md §3.4). Every pool is checked here, at load, for
     * ≥3 exemplars of every criterial dimension, and
     * one matched minimum-difference pair per criterial dimension.
   A pool that misses either throws rather than shipping a hole in the teaching
   set. The Playwright spec asserts the same properties from the outside, so the
   check is not merely self-reported.

   No build step — loaded after card-model.js and the three pool files.
   ----------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var model = global.ThinkOrSayModel;
  if (!model) throw new Error('think-or-say: card-model.js must load before cards.js');

  /** Every criterial dimension needs at least this many exemplars in a pool. */
  var MIN_EXEMPLARS_PER_DIMENSION = 3;

  var seenIds = Object.create(null);

  function buildLevel(raw) {
    if (!raw) throw new Error('think-or-say: a level pool file did not load');
    var cards = raw.cards.map(function (spec) {
      if (spec.level !== raw.id) {
        throw new Error('think-or-say card ' + spec.id + ': declares level ' + spec.level +
          ' but sits in the level ' + raw.id + ' pool');
      }
      // Pools are disjoint by id, so a card cannot be taught at two levels and
      // quietly become two different targets in the same report.
      if (seenIds[spec.id]) throw new Error('think-or-say: duplicate card id ' + spec.id);
      seenIds[spec.id] = true;
      return model.makeCard(spec);
    });

    var byId = Object.create(null);
    cards.forEach(function (c) { byId[c.id] = c; });

    var coverage = coverageOf(cards);
    model.DIMENSION_KEYS.forEach(function (dim) {
      if (coverage[dim].length < MIN_EXEMPLARS_PER_DIMENSION) {
        throw new Error('think-or-say level ' + raw.id + ': dimension ' + dim + ' has ' +
          coverage[dim].length + ' exemplars, needs ' + MIN_EXEMPLARS_PER_DIMENSION);
      }
    });

    var pairs = model.definePairs(raw.id, byId, raw.pairs);
    var covered = pairs.map(function (p) { return p.dim; });
    model.DIMENSION_KEYS.forEach(function (dim) {
      if (covered.indexOf(dim) < 0) {
        throw new Error('think-or-say level ' + raw.id + ': no minimum-difference pair for ' + dim);
      }
    });

    return Object.freeze({
      id: raw.id,
      name: raw.name,
      blurb: raw.blurb,
      rule: ruleOf(raw),
      cards: Object.freeze(cards),
      pairs: pairs,
      coverage: Object.freeze(coverage),
    });
  }

  /**
   * The rule a level states on screen while its cards are being run, checked
   * on the way in. Level 1 declares one; Levels 2 and 3 declare none and show
   * nothing (see the note in cards-level-1.js for why).
   *
   * The one property worth enforcing is that a stated rule names BOTH answers.
   * Every card is a THINK IT or a SAY IT, so a rule strip showing one branch
   * alone would answer the card underneath it before the learner looked.
   */
  function ruleOf(raw) {
    var rule = raw.rule;
    if (!rule) return null;
    var where = 'think-or-say level ' + raw.id + ' rule: ';
    if (!rule.title || !rule.lead) throw new Error(where + 'needs a title and a lead');
    var branches = rule.branches || [];
    branches.forEach(function (b) {
      if (!b.test) throw new Error(where + 'a branch states no test');
      if (b.answer !== 'think' && b.answer !== 'say') {
        throw new Error(where + 'branch answer must be think or say');
      }
    });
    ['think', 'say'].forEach(function (answer) {
      var named = branches.filter(function (b) { return b.answer === answer; });
      if (!named.length) {
        throw new Error(where + 'states no ' + answer + ' branch, so it names the answer to every card');
      }
    });
    // A `when` clause is what makes the rule checkable against the deck it is
    // stated over, so a malformed one has to fail here rather than quietly
    // never firing - a branch that never fires reads on screen exactly like one
    // that works, and would leave cards silently undecided.
    function whenOf(clause, whose) {
      if (!clause) throw new Error(where + whose + ' states no `when`, so it cannot be checked');
      var is = clause.is || {};
      var isNot = clause.isNot || {};
      if (!Object.keys(is).length && !Object.keys(isNot).length) {
        throw new Error(where + whose + ' has an empty `when`, which matches every card');
      }
      [is, isNot].forEach(function (set) {
        Object.keys(set).forEach(function (dim) {
          if (!model.DIMENSIONS[dim]) {
            throw new Error(where + whose + ' keys on "' + dim + '", which is not a criterial dimension');
          }
          if (model.DIMENSIONS[dim].values.indexOf(set[dim]) < 0) {
            throw new Error(where + whose + ' wants ' + dim + '="' + set[dim] + '", not a value that dimension takes');
          }
        });
      });
      return Object.freeze({ is: Object.freeze(is), isNot: Object.freeze(isNot) });
    }

    // The standing override, if the level declares one. It outranks the
    // columns, so it is carried separately rather than as a ninth branch.
    var always = null;
    if (rule.always) {
      if (!rule.always.test) throw new Error(where + 'the standing rule states no test');
      if (rule.always.answer !== 'think' && rule.always.answer !== 'say') {
        throw new Error(where + 'the standing rule answer must be think or say');
      }
      always = Object.freeze({
        answer: rule.always.answer,
        test: rule.always.test,
        note: rule.always.note || '',
        when: whenOf(rule.always.when, 'the standing rule'),
      });
    }

    return Object.freeze({
      title: rule.title,
      lead: rule.lead,
      tip: rule.tip || '',
      always: always,
      branches: Object.freeze(branches.map(function (b) {
        return Object.freeze({
          answer: b.answer,
          test: b.test,
          when: whenOf(b.when, 'branch "' + b.test + '"'),
        });
      })),
    });
  }

  /** Which cards declare each criterial dimension — the coverage matrix, as data. */
  function coverageOf(cards) {
    var out = {};
    model.DIMENSION_KEYS.forEach(function (dim) {
      out[dim] = Object.freeze(cards
        .filter(function (c) { return c.features[dim] != null; })
        .map(function (c) { return c.id; }));
    });
    return out;
  }

  var LEVELS = Object.freeze([
    buildLevel(global.ThinkOrSayLevel1),
    buildLevel(global.ThinkOrSayLevel2),
    buildLevel(global.ThinkOrSayLevel3),
  ]);

  var ALL = Object.freeze(LEVELS.reduce(function (acc, lv) {
    return acc.concat(lv.cards);
  }, []));

  function level(id) {
    return LEVELS.filter(function (lv) { return lv.id === Number(id); })[0] || LEVELS[0];
  }

  global.ThinkOrSayCards = Object.freeze({
    LEVELS: LEVELS,
    ALL: ALL,
    level: level,
    levelIds: Object.freeze(LEVELS.map(function (lv) { return lv.id; })),
    MIN_EXEMPLARS_PER_DIMENSION: MIN_EXEMPLARS_PER_DIMENSION,
  });
})(typeof window !== 'undefined' ? window : globalThis);
