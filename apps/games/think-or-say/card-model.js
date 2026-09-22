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

  /* ── The Why ladder: the dimensions in the learner's words ────────────
     After a correct answer the game shows the rules that were in play on the
     card, ordered by the hierarchy above, so the unspoken ranking becomes
     something the learner can see: "Is it true? Yes - SAY" sitting struck
     under "Would it hurt their feelings? Yes - THINK".

     TIERS, top to bottom. Safety always wins; true is last and is WEAK -
     true is not enough on its own, which is what the truthRank defeater
     teaches.

     Each value carries a chip (the card's answer to the question, in a few
     words) and a LEAN: which answer that value pulls toward on its own, or
     null when it pulls neither way. A lean is a pull, not a verdict - the
     card's answer is authored, and the ladder only shows which pull won.
     Checked against every authored card: relationship has to lean, because
     its matched pairs flip the answer on it (a grown-up or a close friend
     pulls toward SAY, a stranger toward THINK), and so does privacy, whose
     pairs flip on it (L3-15 has nothing else to decide it). `override: none`,
     a classmate and "not sure" only remove a reason, so they pull neither
     way. */

  var WHY_TIERS = [
    { tier: 1, key: 'safety',     label: 'Safety' },
    { tier: 2, key: 'kind',       label: 'Kind' },
    { tier: 3, key: 'where-when', label: 'Where & when' },
    { tier: 4, key: 'who',        label: 'Who' },
    { tier: 5, key: 'true',       label: 'True' },
  ];

  var WHY = {
    override: { tier: 1, icon: '\u{1F6A8}', question: 'Is someone hurt or not safe?',
      values: {
        'help-or-safety': { chip: 'Yes - help or safety', lean: 'say' },
        none:             { chip: 'Nobody is in danger', lean: null },
      } },
    selfEsteem: { tier: 2, icon: '\u{1F49B}', question: 'Would it hurt their feelings?',
      values: {
        hurts: { chip: 'It would hurt', lean: 'think' },
        lifts: { chip: 'It would feel good', lean: 'say' },
      } },
    changeability: { tier: 2, icon: '\u{1F527}', question: 'Can they fix it right now?',
      values: {
        'fixable-now': { chip: 'They can fix it now', lean: 'say' },
        'not-fixable': { chip: 'They cannot change it', lean: 'think' },
      } },
    privacy: { tier: 2, icon: '\u{1F512}', question: 'Is it private?',
      values: {
        private:       { chip: 'It is private', lean: 'think' },
        'not-private': { chip: 'Not private', lean: 'say' },
      } },
    audience: { tier: 3, icon: '\u{1F442}', question: 'Who would hear it?',
      values: {
        'just-them':   { chip: 'Only they hear', lean: 'say' },
        'others-hear': { chip: 'Everyone hears', lean: 'think' },
      } },
    timing: { tier: 3, icon: '\u{23F0}', question: 'Is it the right moment?',
      values: {
        'right-moment': { chip: 'A good moment', lean: 'say' },
        'wrong-moment': { chip: 'Not the moment', lean: 'think' },
      } },
    relationship: { tier: 4, icon: '\u{1F465}', question: 'Who are they to you?',
      values: {
        'close-friend': { chip: 'A close friend', lean: 'say' },
        classmate:      { chip: 'A classmate', lean: null },
        'grown-up':     { chip: 'A grown-up you know', lean: 'say' },
        stranger:       { chip: 'A stranger', lean: 'think' },
      } },
    truthRank: { tier: 5, icon: '\u{2705}', question: 'Is it true?',
      values: {
        true:       { chip: 'Yes, it is true', lean: 'say', weak: true },
        'not-sure': { chip: 'Not sure', lean: null },
      } },
  };

  /**
   * The rows of the Why ladder for one card: only the dimensions in play,
   * ordered by tier (then by the order above), each marked for how it sits
   * against the card's answer.
   *
   *   agree   - the value pulls toward the answer.
   *   decides - the top-most agreeing row that is not weak. One per card.
   *   against - the value pulls the other way. Below the deciding row it was
   *             OUTRANKED; above it, the pull was real but did not hold on
   *             this card ("not this time" - e.g. they could fix it, but
   *             everyone would hear).
   *   neutral - the value pulls neither way.
   *
   * Within a tier an agreeing row sorts first, so a same-tier contest reads
   * the way the reason line states it: "it would hurt" sits under "they can
   * fix it now" on a card where fixing it wins. Changeability sits above
   * privacy in the kind tier so that, on a SAY card where every condition is
   * met, the row that decides it is the reason the card is about ("they can
   * fix it now") rather than the absence of one ("not private").
   */
  function whyLadder(card) {
    var features = (card && card.features) || {};
    var order = Object.keys(WHY);
    var rows = Object.keys(features).filter(function (k) { return WHY[k]; }).map(function (k) {
      var def = WHY[k];
      var val = def.values[features[k]] || { chip: String(features[k]), lean: null };
      var stance = val.lean === null ? 'neutral' : (val.lean === card.answer ? 'agree' : 'against');
      return {
        dim: k, tier: def.tier, icon: def.icon, question: def.question,
        value: features[k], chip: val.chip, lean: val.lean, weak: !!val.weak,
        stance: stance, decides: false, outranked: false,
      };
    });
    var rankOf = { agree: 0, neutral: 1, against: 2 };
    rows.sort(function (a, b) {
      return (a.tier - b.tier) || (rankOf[a.stance] - rankOf[b.stance]) ||
        (order.indexOf(a.dim) - order.indexOf(b.dim));
    });
    var decider = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].stance === 'agree' && !rows[i].weak) { decider = i; break; }
    }
    return rows.map(function (r, i) {
      r.decides = i === decider;
      r.outranked = r.stance === 'against' && decider >= 0 && i > decider;
      return Object.freeze(r);
    });
  }

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
    WHY: WHY,
    WHY_TIERS: WHY_TIERS,
    whyLadder: whyLadder,
  });
})(typeof window !== 'undefined' ? window : globalThis);
