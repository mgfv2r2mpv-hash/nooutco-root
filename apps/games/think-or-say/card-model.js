/* ── Think or Say? - the card model ────────────────────────────────────
   The instructional universe, stated in code (RESEARCH.md §5), and the one
   constructor every authored card goes through.

   General case programming (Sprague & Horner 1984; Horner & Albin) asks for the
   instructional universe to be defined explicitly and then SAMPLED - must-have
   features define the class and stay constant, can-have features vary so they
   never acquire control. That definition lives here rather than in prose so a
   card that misses it does not exist at runtime.

   No build step - plain static JS, loaded before cards.js.
   ----------------------------------------------------------------------- */
(function (global) {
  'use strict';

  /* ── Card framing (Deliverable 2, unchanged) ─────────────────────────
     A card used to render `You think: "<thought>"`. That lead-in names one of
     the two actions and names it in the stem of the THINK IT tile, so a learner
     tracking only the salient word can answer every card correctly without ever
     contacting the rule (Song et al. 2021 - RESEARCH.md, "Card framing").

     A card presents four parts, in this order:
       1. the situation
       2. the fixed lead-in below - it names NEITHER action
       3. the candidate utterance, in quotes
       4. a balanced question naming BOTH actions, generated from the card's own
          verb pair so it cannot be hand-written to name only one.

     Tile LABELS stay THINK IT / SAY IT on every card - the response topography
     must not change card to card. Only the tile POSITIONS counterbalance.

     The residual stem overlap between "thought" and "THINK IT" is ruled real,
     irreducible and detectable: a learner under stem control answers THINK to
     everything, which shows in the report's answer-type split. No further
     mitigation is built. ------------------------------------------------- */

  var LEAD_IN = 'You have a thought:';

  /** The spoken action a card asks about. THINK is the other half, always. */
  var SAY_VERBS = ['say', 'ask', 'tell'];

  /**
   * The card's balanced question. Both actions are named, in the card's own verb
   * pair, from the card's own object phrase - so the two halves are grammatically
   * identical and neither is the longer or more elaborated option.
   */
  function balancedQuestion(sc) {
    return 'Should you THINK ' + sc.object + ', or ' + sc.sayVerb.toUpperCase() + ' ' + sc.object + '?';
  }

  /* ── Criterial ("must-have") dimensions ──────────────────────────────
     RESEARCH.md §5.1. A card declares a value for every dimension that is IN
     PLAY for it and omits the rest: "this card turns on audience and
     changeability" is a claim about the card, and coverage counts those claims.

     THE DIMENSIONS ARE ORDERED BY IMPORTANCE, and the cards teach the ordering
     rather than a categorical rule. Dimension 7 (`override`) outranks every
     other dimension when it is in play - help or safety is always SAY, and
     makeCard() refuses a card that says otherwise. Below it, how it would make
     the person feel outranks whether the thing is true.

     Dimension 8 (`truthRank`) is therefore a DEFEATER rather than a flip: it
     exists to strip a rule the learner will otherwise induce ("if it's true,
     say it"), so its matched pair holds it CONSTANT at `true` across both cards
     and flips something else. See definePairs().

     The reason lines state that ordering as a COMPARISON - "true is not as
     important as kind, because this is not about safety, and it can't be
     changed" - not as a categorical test. That is the maintainer's ruling and
     it is deliberate: a relational frame the learner can apply to a novel card
     is the target repertoire (RESEARCH.md §4.1), whereas "true is not the test"
     is a flat rule, states more than the literature supports, and gives a
     learner nothing to derive when two considerations disagree. Where the
     truth helps - they can fix it right now - the same comparison runs the
     other way and the card says so. ------------------------------------- */

  var DIMENSIONS = {
    selfEsteem:    { label: 'Would it hurt how the person feels about themselves?',
                     values: ['hurts', 'lifts'] },
    privacy:       { label: 'Is it private or embarrassing?',
                     values: ['private', 'not-private'] },
    changeability: { label: 'Can the person change it right now, or not?',
                     values: ['fixable-now', 'not-fixable'] },
    audience:      { label: 'Who else can hear - audience and volume',
                     values: ['just-them', 'others-hear'] },
    relationship:  { label: 'Who is it about - close friend, classmate, stranger, grown-up',
                     values: ['close-friend', 'classmate', 'grown-up', 'stranger'] },
    timing:        { label: 'When - right now, or later in private',
                     values: ['right-moment', 'wrong-moment'] },
    override:      { label: 'Does someone need help, or is safety at stake? (always SAY)',
                     values: ['help-or-safety', 'none'] },
    truthRank:     { label: 'It is true - but how much does true matter next to kind and safe?',
                     values: ['true', 'not-sure'] },
  };

  var DIMENSION_KEYS = Object.keys(DIMENSIONS);

  /* ── Varied ("can-have") features ────────────────────────────────────
     RESEARCH.md §5.2. Every card declares all four, and they must genuinely
     vary across a pool: a can-have value that only ever appears on one answer
     has quietly become criterial, and the POOL gets fixed, not the rule. */

  var CAN_HAVE = {
    setting: ['school', 'home', 'bus', 'playground', 'shop'],
    person:  ['peer', 'sibling', 'teacher', 'family', 'stranger'],
    topic:   ['looks', 'smell', 'work', 'belongings', 'body'],
    form:    ['statement', 'question', 'exclamation'],
  };

  var CAN_HAVE_KEYS = Object.keys(CAN_HAVE);

  function fail(id, msg) {
    throw new Error('think-or-say card ' + id + ': ' + msg);
  }

  /**
   * Build one card, or refuse to.
   *
   * Every authored card goes through here, so a card that cannot state a balanced
   * question - or that reintroduces the "You think" lead-in in its own prose, or
   * that claims a criterial feature the universe does not declare - does not
   * exist at runtime rather than shipping and being caught in review.
   */
  function makeCard(spec) {
    var need = ['id', 'level', 'cat', 'answer', 'situation', 'utterance', 'sayVerb', 'object', 'reason'];
    var missing = need.filter(function (k) { return !spec[k]; });
    if (missing.length) fail(spec.id || '?', 'missing ' + missing.join(', '));
    if (spec.answer !== 'think' && spec.answer !== 'say') fail(spec.id, 'answer must be think/say');
    if (SAY_VERBS.indexOf(spec.sayVerb) < 0) {
      fail(spec.id, 'sayVerb must be one of ' + SAY_VERBS.join('/'));
    }
    // The object phrase carries its own determiner so both halves of the question
    // stay grammatical whichever verb the card uses.
    if (!/^(this|these) \S/.test(spec.object)) {
      fail(spec.id, 'object phrase must start "this "/"these "');
    }
    ['situation', 'utterance', 'reason'].forEach(function (field) {
      if (/you think/i.test(spec[field])) {
        fail(spec.id, field + ' says "you think" - it gives the answer away');
      }
    });

    var features = spec.features || {};
    var featureKeys = Object.keys(features);
    if (!featureKeys.length) fail(spec.id, 'declares no criterial feature');
    featureKeys.forEach(function (k) {
      if (!DIMENSIONS[k]) fail(spec.id, 'unknown criterial dimension "' + k + '"');
      if (DIMENSIONS[k].values.indexOf(features[k]) < 0) {
        fail(spec.id, k + ' value "' + features[k] + '" is not in the universe');
      }
    });
    // Dimension 7 is an override, and an override that does not override is a
    // mis-keyed card, not a hard one.
    if (features.override === 'help-or-safety' && spec.answer !== 'say') {
      fail(spec.id, 'help or safety is in play, so the answer must be say');
    }

    var vary = spec.vary || {};
    CAN_HAVE_KEYS.forEach(function (k) {
      if (!vary[k]) fail(spec.id, 'missing can-have feature "' + k + '"');
      if (CAN_HAVE[k].indexOf(vary[k]) < 0) {
        fail(spec.id, k + ' value "' + vary[k] + '" is not in the universe');
      }
    });

    // Level 3 teaches the REASON, so its cards carry the exemplar rationales the
    // reveal offers. They are exemplars, never a scoring key: the technician
    // scores what the learner actually said (RESEARCH.md §6, Level 3).
    var rationales = spec.rationales || [];
    if (spec.level === 3) {
      if (rationales.length < 2 || rationales.length > 4) {
        fail(spec.id, 'a Level 3 card needs 2-4 exemplar rationales');
      }
    } else if (rationales.length) {
      fail(spec.id, 'exemplar rationales belong to Level 3 only');
    }

    var question = balancedQuestion(spec);
    if (question.indexOf('THINK') < 0 || question.indexOf(spec.sayVerb.toUpperCase()) < 0) {
      fail(spec.id, 'question names only one action');
    }

    var card = {};
    Object.keys(spec).forEach(function (k) { card[k] = spec[k]; });
    card.leadIn = LEAD_IN;
    card.question = question;
    card.features = Object.freeze(features);
    card.vary = Object.freeze(vary);
    card.rationales = Object.freeze(rationales.slice());
    return Object.freeze(card);
  }

  /**
   * The matched minimum-difference pairs for one level, validated on the way in.
   *
   * Horner, Albin & Ralph (1986) - the contrast is what teaches the defining
   * feature, so a "pair" that differs on two things at once teaches neither.
   * Two shapes, and the difference is the point:
   *
   *   flip - the two cards differ on exactly the dimension named, and the
   *              answer flips with it. Dimensions 1-7.
   *   defeater - dimension 8. Both cards HOLD the named dimension constant
   *              (`truthRank: 'true'`) and differ on one other criterial
   *              feature. That is the demonstration: truth was identical on both
   *              sides and the answer still moved, so truth is not the test.
   */
  function definePairs(levelId, byId, pairs) {
    return Object.freeze(pairs.map(function (p) {
      var a = byId[p.a];
      var b = byId[p.b];
      var where = 'think-or-say level ' + levelId + ' pair ' + p.dim;
      if (!a || !b) throw new Error(where + ': names a card that does not exist');
      if (!DIMENSIONS[p.dim]) throw new Error(where + ': unknown dimension');
      if (a.answer === b.answer) throw new Error(where + ': both cards answer ' + a.answer);

      var keysA = Object.keys(a.features).sort().join(',');
      var keysB = Object.keys(b.features).sort().join(',');
      if (keysA !== keysB) throw new Error(where + ': the two cards turn on different dimensions');

      var differing = Object.keys(a.features).filter(function (k) {
        return a.features[k] !== b.features[k];
      });
      if (differing.length !== 1) {
        throw new Error(where + ': differs on ' + differing.length + ' features, not exactly one');
      }
      if (p.kind === 'defeater') {
        if (a.features[p.dim] !== b.features[p.dim]) {
          throw new Error(where + ': a defeater pair must hold ' + p.dim + ' constant');
        }
        if (differing[0] === p.dim) throw new Error(where + ': ' + p.dim + ' is the feature that flipped');
      } else {
        if (differing[0] !== p.dim) {
          throw new Error(where + ': flips ' + differing[0] + ', not ' + p.dim);
        }
      }
      return Object.freeze({ dim: p.dim, kind: p.kind || 'flip', a: p.a, b: p.b, flips: differing[0] });
    }));
  }

  global.ThinkOrSayModel = Object.freeze({
    LEAD_IN: LEAD_IN,
    SAY_VERBS: SAY_VERBS,
    DIMENSIONS: DIMENSIONS,
    DIMENSION_KEYS: DIMENSION_KEYS,
    CAN_HAVE: CAN_HAVE,
    CAN_HAVE_KEYS: CAN_HAVE_KEYS,
    balancedQuestion: balancedQuestion,
    makeCard: makeCard,
    definePairs: definePairs,
  });
})(typeof window !== 'undefined' ? window : globalThis);
