/* ── Think or Say? — the exemplar generator ────────────────────────────
   Teaching cards are HAND-AUTHORED and reviewable (cards-level-*.js). Probe
   items and re-presentations are GENERATED, from here.

   WHY THIS EXISTS. Probe novelty cannot depend on remembering what was already
   used. Storage gets cleared; one technician runs the same programme with two
   learners on the same device; a session can be restarted mid-block. Any scheme
   that tracks "used probes" is one localStorage wipe away from re-presenting a
   trained item as a generalization datum, and nothing on screen would say so.
   Generating from criterial templates removes the memory from the loop: the
   space is declared, finite, and enumerable, and every item in it carries its
   key from the template that made it.

   A TEMPLATE declares:
     * the criterial DIMENSION it turns on, and the KEY — which criterial
       configuration answers SAY and which answers THINK. The key is never
       substituted, so a generated item cannot be mis-keyed by construction.
     * the utterance, per variant.
     * SURFACE SLOTS — person, setting, topic, form — sampled at render time.
     * a PER-TEMPLATE allow-list of slot values. Never a global pool: a value
       that is pure surface on one dimension is criterial on another. "Somebody
       you have never met" is scenery on an audience template and IS THE ANSWER
       on a relationship one, so it may not be sampled there. `fixed` names the
       can-have values the key determines; `slots` names the ones it does not.
       validate() refuses a template that samples a value its own key uses.

   The same machinery re-renders a re-presented teaching card with a fresh
   surface — different person, setting or topic, identical criterial item — so a
   repeat cannot be passed on a memorised surface feature. See represent().

   The generated space is finite and is proved exhaustively in
   tests/think-or-say-generator.spec.js, which enumerates every template ×
   variant × slot combination.

   No build step — plain static JS, loaded after card-model.js.
   ----------------------------------------------------------------------- */
(function (global) {
  'use strict';

  var model = global.ThinkOrSayModel;
  if (!model) throw new Error('think-or-say: card-model.js must load before exemplar-generator.js');

  /* ── Slot vocabularies ───────────────────────────────────────────────
     Each value carries the grammar it needs, so a template writes
     "{A_person} is across the {the_setting}" and gets a grammatical sentence
     whichever value is drawn. PEOPLE are referred to NEUTRALLY — they/them/
     their throughout — so pronoun agreement cannot drift with the draw and a
     learner cannot pick up gender as the feature that decides.

     These are value DEFINITIONS. The allow-lists that use them are per
     template; there is deliberately no exported "all people" list to reach for.
     Every id is a can-have value from card-model.js CAN_HAVE. ------------- */

  var P = {
    peer:     { id: 'peer',     a: 'a classmate',                the: 'the classmate' },
    sibling:  { id: 'sibling',  a: 'your brother or sister',     the: 'your brother or sister' },
    family:   { id: 'family',   a: 'your grown-up at home',      the: 'your grown-up at home' },
    teacher:  { id: 'teacher',  a: 'your teacher',               the: 'your teacher' },
    stranger: { id: 'stranger', a: 'somebody you have never met', the: 'the person you have never met' },
  };

  var S = {
    school:     { id: 'school',     at: 'in the classroom',  the: 'classroom' },
    home:       { id: 'home',       at: 'at home',           the: 'room' },
    bus:        { id: 'bus',        at: 'on the bus',        the: 'bus' },
    playground: { id: 'playground', at: 'on the playground', the: 'playground' },
    shop:       { id: 'shop',       at: 'in the shop',       the: 'shop' },
  };

  /** Topic phrasings are bespoke per template — "work" is a drawing on one card
      and a maths sheet on another — so they are written inline, not shared. */
  function topic(id, a, the) { return { id: id, a: a, the: the }; }

  var SAMPLED_SURFACE = ['person', 'setting', 'topic'];

  /** Which placeholders name each can-have feature in a situation string. */
  var PLACEHOLDERS = {
    person:  ['a_person', 'A_person', 'the_person', 'The_person'],
    setting: ['at_setting', 'the_setting'],
    topic:   ['a_topic', 'the_topic'],
    form:    [],
  };

  /* ── The templates ───────────────────────────────────────────────────
     One per criterial dimension, each a matched minimum-difference pair: the
     two variants hold every criterial feature constant but one, and the answer
     flips with it (Horner, Albin & Ralph 1986). Dimension 8 is the defeater
     shape — truthNotTest is held CONSTANT at 'true' on both sides and something
     else flips, which is the demonstration that truth is not the test.

     Feature configurations mirror the authored pools' matched pairs, so a
     teaching card that turns on the same criterial configuration can be
     re-presented through the same template. ------------------------------ */

  var TEMPLATES = [
    {
      id: 'G-selfEsteem', dim: 'selfEsteem', cat: 'work', levels: [1, 2],
      sayVerb: 'say', object: 'these words',
      slots: {
        setting: [S.school, S.home, S.playground],
        topic: [topic('work', 'a drawing they made', 'the drawing'),
                topic('belongings', 'a model they built', 'the model')],
      },
      variants: [
        { value: 'hurts', answer: 'think',
          features: { selfEsteem: 'hurts', relationship: 'close-friend' },
          fixed: { person: P.peer, form: 'statement' },
          situation: 'Your close friend shows you {a_topic} {at_setting}. You do not like how {the_topic} looks.',
          utterance: 'That looks bad.',
          reason: 'Think it. They worked hard on it, and these words would hurt their feelings.',
          rationales: ['If I said that, my friend would feel bad about something they worked hard on.',
                       'They would be sad, and I would still be able to say something kind instead.'] },
        { value: 'lifts', answer: 'say',
          features: { selfEsteem: 'lifts', relationship: 'close-friend' },
          fixed: { person: P.peer, form: 'exclamation' },
          situation: 'Your close friend shows you {a_topic} {at_setting}. You really like how {the_topic} looks.',
          utterance: 'That looks great!',
          reason: 'Say it! Telling a friend you like their work makes them feel proud.',
          rationales: ['If I said that, my friend would feel proud of what they made.',
                       'It is kind and it is true, so saying it helps them.'] },
      ],
    },

    {
      id: 'G-privacy', dim: 'privacy', cat: 'private', levels: [1, 2],
      slots: { setting: [S.school, S.playground, S.bus] },
      variants: [
        { value: 'private', answer: 'think',
          features: { privacy: 'private', relationship: 'classmate' },
          fixed: { person: P.peer, topic: topic('body', 'a bandage', 'the bandage'), form: 'question' },
          sayVerb: 'ask', object: 'this question',
          situation: '{A_person} {at_setting} has a bandage on one arm, and you are curious about it.',
          utterance: 'How did you get that?',
          reason: 'Think it for now. How somebody got hurt is private, and they may not want to talk about it.',
          rationales: ['If I asked that, they might feel like they had to explain something private.',
                       'They can tell me about it if they want to. I do not have to ask.'] },
        { value: 'not-private', answer: 'say',
          features: { privacy: 'not-private', relationship: 'classmate' },
          fixed: { person: P.peer, topic: topic('belongings', 'a badge', 'the badge'), form: 'exclamation' },
          sayVerb: 'say', object: 'these words',
          situation: '{A_person} {at_setting} is wearing a big badge that says it is {their} birthday today.',
          utterance: 'Happy birthday!',
          reason: 'Say it! They are showing everybody on purpose, so it is not private at all.',
          rationales: ['They put the badge on so people would know. Saying it makes them feel good.',
                       'Nothing about this is private, so I can say it out loud.'] },
      ],
    },

    {
      id: 'G-changeability', dim: 'changeability', cat: 'looks', levels: [1, 2],
      sayVerb: 'tell', object: 'this news',
      slots: { person: [P.peer, P.sibling], setting: [S.home, S.playground, S.bus] },
      variants: [
        { value: 'fixable-now', answer: 'say',
          features: { changeability: 'fixable-now', audience: 'just-them' },
          fixed: { topic: topic('looks', 'a smudge of paint', 'the smudge'), form: 'statement' },
          situation: 'You are right beside {a_person} {at_setting} and nobody else can hear. There is a smudge of paint on {their} cheek that {they} could wipe off right now.',
          utterance: 'You have paint on your cheek.',
          reason: 'Say it quietly. They can fix it in a second, and then it is sorted.',
          rationales: ['If I told them quietly, they could wipe it off and nobody else would even notice.',
                       'They would want to know, because they can do something about it right now.'] },
        { value: 'not-fixable', answer: 'think',
          features: { changeability: 'not-fixable', audience: 'just-them' },
          fixed: { topic: topic('looks', 'a new haircut', 'the haircut'), form: 'statement' },
          situation: 'You are right beside {a_person} {at_setting} and nobody else can hear. {They} got a haircut this morning and it is much shorter than before. Nothing can change it today.',
          utterance: 'Your hair is really short now.',
          reason: 'Think it. They cannot change it today, so saying it would only make them feel bad.',
          rationales: ['There is nothing they could do about it, so telling them would just make them feel worse.',
                       'If somebody said that to me about my hair, I would feel bad and I could not fix it.'] },
      ],
    },

    {
      id: 'G-audience', dim: 'audience', cat: 'other', levels: [1, 2],
      sayVerb: 'tell', object: 'this news',
      slots: { person: [P.peer, P.sibling, P.family], setting: [S.school, S.home, S.shop] },
      variants: [
        { value: 'just-them', answer: 'say',
          features: { audience: 'just-them', changeability: 'fixable-now' },
          fixed: { topic: topic('body', 'something in their teeth', 'the food'), form: 'statement' },
          situation: 'You are sitting right beside {a_person} {at_setting} and nobody else is close enough to hear. There is a bit of food stuck in {their} teeth.',
          utterance: 'You have something in your teeth.',
          reason: 'Say it quietly. Only they can hear you, and they can sort it out straight away.',
          rationales: ['Nobody else would hear, so they would not feel embarrassed.',
                       'They can fix it right now, and they would want to know.'] },
        { value: 'others-hear', answer: 'think',
          features: { audience: 'others-hear', changeability: 'fixable-now' },
          fixed: { topic: topic('body', 'something in their teeth', 'the food'), form: 'exclamation' },
          situation: '{A_person} is right across the {the_setting} from you and everybody there would hear you. There is a bit of food stuck in {their} teeth.',
          utterance: 'You have something in your teeth!',
          reason: 'Think it for now. The same words shouted across the room would embarrass them. Wait until you are close.',
          rationales: ['Everybody would hear, and then they would feel embarrassed in front of everyone.',
                       'I could still tell them later, when I am standing next to them.'] },
      ],
    },

    {
      id: 'G-relationship', dim: 'relationship', cat: 'private', levels: [2],
      sayVerb: 'tell', object: 'this news',
      slots: { setting: [S.school, S.bus, S.shop] },
      variants: [
        { value: 'grown-up', answer: 'say',
          features: { relationship: 'grown-up', privacy: 'private' },
          fixed: { person: P.teacher, topic: topic('work', 'your work', 'your work'), form: 'statement' },
          situation: 'Something about your work has been worrying you all day. {A_person} is right there {at_setting} and asks how you are getting on.',
          utterance: 'I am worried about my work.',
          reason: 'Say it. A grown-up who looks after you is exactly who a worry is for.',
          rationales: ['If I told my grown-up, they could help me with the thing I am worried about.',
                       'That is what they are there for, so it is safe to tell them.'] },
        { value: 'stranger', answer: 'think',
          features: { relationship: 'stranger', privacy: 'private' },
          fixed: { person: P.stranger, topic: topic('work', 'your work', 'your work'), form: 'statement' },
          situation: 'Something about your work has been worrying you all day. The only person near you {at_setting} is {a_person}.',
          utterance: 'I am worried about my work.',
          reason: 'Think it for now. Save private worries for a grown-up who knows you.',
          rationales: ['They do not know me, so this is not something to tell them.',
                       'I can keep it in my head until I see somebody who looks after me.'] },
      ],
    },

    {
      id: 'G-timing', dim: 'timing', cat: 'other', levels: [1, 2],
      sayVerb: 'ask', object: 'this question',
      slots: { person: [P.teacher, P.family], setting: [S.school, S.home, S.shop] },
      variants: [
        { value: 'right-moment', answer: 'say',
          features: { timing: 'right-moment', relationship: 'grown-up' },
          fixed: { topic: topic('work', 'your work', 'your work'), form: 'question' },
          situation: 'You are stuck on your work {at_setting}. {The_person} has just finished talking and asks if anybody needs help.',
          utterance: 'Can you help me?',
          reason: 'Say it. They just asked, so this is the right moment.',
          rationales: ['They asked if anybody needed help, so now is exactly when to speak up.',
                       'Nobody is talking, so I am not interrupting anyone.'] },
        { value: 'wrong-moment', answer: 'think',
          features: { timing: 'wrong-moment', relationship: 'grown-up' },
          fixed: { topic: topic('work', 'your work', 'your work'), form: 'question' },
          situation: 'You are stuck on your work {at_setting}. {The_person} is in the middle of talking to somebody else.',
          utterance: 'Can you help me?',
          reason: 'Think it for now. It is a good question at the wrong moment — wait until they finish.',
          rationales: ['If I asked now I would be interrupting, and the other person would lose their turn.',
                       'It is a fine thing to ask. I just need to wait for a better moment.'] },
      ],
    },

    {
      id: 'G-override', dim: 'override', cat: 'other', levels: [1, 2],
      sayVerb: 'tell', object: 'this news',
      slots: { person: [P.peer, P.sibling, P.family] },
      variants: [
        { value: 'help-or-safety', answer: 'say',
          features: { override: 'help-or-safety', audience: 'others-hear' },
          fixed: { setting: S.playground, topic: topic('body', 'a car coming', 'the car'), form: 'exclamation' },
          situation: '{A_person} is right across the {the_setting} from you and everybody there would hear you. {They} are about to step out where a car is coming.',
          utterance: 'Stop! A car is coming!',
          reason: 'Say it — loudly, and tell a grown-up. When somebody might get hurt it is always right to speak up.',
          rationales: ['If I stayed quiet they could get hurt, and that matters more than being loud.',
                       'Somebody being in danger is always a say-it, even in front of everyone.'] },
        { value: 'none', answer: 'think',
          features: { override: 'none', audience: 'others-hear' },
          fixed: { topic: topic('belongings', 'muddy shoes', 'the mud'), form: 'exclamation' },
          slots: { setting: [S.playground, S.school, S.shop] },
          situation: '{A_person} is right across the {the_setting} from you and everybody there would hear you. {Their} shoes are covered in mud.',
          utterance: 'Your shoes are muddy!',
          reason: 'Think it. Nobody is in danger, and shouting it across the room would embarrass them.',
          rationales: ['Nobody is going to get hurt, so there is no reason to shout it.',
                       'Everybody would look at their shoes, and they would feel embarrassed.'] },
      ],
    },

    {
      id: 'G-truthNotTest', dim: 'truthNotTest', kind: 'defeater', cat: 'work', levels: [1, 2],
      sayVerb: 'say', object: 'these words',
      slots: { person: [P.peer, P.sibling], setting: [S.school, S.home] },
      variants: [
        { value: 'lifts', answer: 'say',
          features: { truthNotTest: 'true', selfEsteem: 'lifts' },
          fixed: { topic: topic('work', 'the sticker chart', 'the chart'), form: 'exclamation' },
          situation: 'You count the stickers on the chart {at_setting}. It is true that {the_person} filled a whole row today.',
          utterance: 'You filled a whole row!',
          reason: 'Say it! It is true AND it is kind, so it is a good thing to share.',
          rationales: ['It is true, and hearing it would make them feel proud of their work.',
                       'True and kind together means it is a say-it.'] },
        { value: 'hurts', answer: 'think',
          features: { truthNotTest: 'true', selfEsteem: 'hurts' },
          fixed: { topic: topic('work', 'the sticker chart', 'the chart'), form: 'statement' },
          situation: 'You count the stickers on the chart {at_setting}. It is true that {the_person} has the fewest.',
          utterance: 'You have the fewest stickers.',
          reason: 'Think it. It is true — but true is not the test. It would still hurt.',
          rationales: ['It is true, and it would still make them feel bad about themselves.',
                       'Something being true does not make it a say-it.'] },
      ],
    },
  ];

  /* ── Rendering ───────────────────────────────────────────────────────
     Slot values carry their own grammar, so substitution is the whole of it.
     An unresolved placeholder is a template bug, not a cosmetic one — it would
     print braces to a learner — so render() throws rather than shipping it. */

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function render(text, draw) {
    var person = draw.person;
    var setting = draw.setting;
    var top = draw.topic;
    var out = text
      .replace(/\{a_person\}/g, person.a)
      .replace(/\{A_person\}/g, cap(person.a))
      .replace(/\{the_person\}/g, person.the)
      .replace(/\{The_person\}/g, cap(person.the))
      .replace(/\{they\}/g, 'they').replace(/\{They\}/g, 'They')
      .replace(/\{them\}/g, 'them').replace(/\{Them\}/g, 'Them')
      .replace(/\{their\}/g, 'their').replace(/\{Their\}/g, 'Their')
      .replace(/\{at_setting\}/g, setting.at)
      .replace(/\{the_setting\}/g, setting.the)
      .replace(/\{a_topic\}/g, top.a)
      .replace(/\{the_topic\}/g, top.the);
    if (out.indexOf('{') >= 0) {
      throw new Error('think-or-say generator: unresolved placeholder in "' + text + '"');
    }
    return out;
  }

  /* ── Template validation, at load ────────────────────────────────────
     Everything here is a claim the enumeration test also makes from the
     outside. It is enforced here as well so a bad template does not exist at
     runtime, rather than existing and failing a probe trial in front of a
     learner. */

  function slotsFor(t, v) {
    var merged = {};
    model.CAN_HAVE_KEYS.forEach(function (k) {
      if (v.fixed && v.fixed[k] != null) return;              // the key decides it
      var list = (v.slots && v.slots[k]) || (t.slots && t.slots[k]);
      if (list) merged[k] = list;
    });
    return merged;
  }

  function valueId(x) { return typeof x === 'string' ? x : x.id; }

  function validate(t) {
    var where = 'think-or-say template ' + t.id;
    if (!model.DIMENSIONS[t.dim]) throw new Error(where + ': unknown dimension ' + t.dim);
    if (t.variants.length !== 2) throw new Error(where + ': needs exactly 2 variants');
    var a = t.variants[0], b = t.variants[1];
    if (a.answer === b.answer) throw new Error(where + ': both variants answer ' + a.answer);

    // Minimum difference: the two keys differ on exactly one criterial feature.
    var keysA = Object.keys(a.features).sort().join(',');
    var keysB = Object.keys(b.features).sort().join(',');
    if (keysA !== keysB) throw new Error(where + ': variants turn on different dimensions');
    var differing = Object.keys(a.features).filter(function (k) {
      return a.features[k] !== b.features[k];
    });
    if (differing.length !== 1) {
      throw new Error(where + ': variants differ on ' + differing.length + ' features, not one');
    }
    if (t.kind === 'defeater') {
      if (a.features[t.dim] !== b.features[t.dim]) throw new Error(where + ': a defeater holds ' + t.dim + ' constant');
    } else if (differing[0] !== t.dim) {
      throw new Error(where + ': flips ' + differing[0] + ', not ' + t.dim);
    }

    // The key's own criterial values may never be sampled as surface. This is
    // the rule that stops a global slot pool: "stranger" is scenery on the
    // audience template and IS the answer on the relationship one.
    var criterial = {};
    t.variants.forEach(function (v) {
      Object.keys(v.features).forEach(function (k) { criterial[v.features[k]] = k; });
    });

    t.variants.forEach(function (v) {
      var slots = slotsFor(t, v);
      model.CAN_HAVE_KEYS.forEach(function (k) {
        var fixed = v.fixed && v.fixed[k];
        if (fixed != null && slots[k]) throw new Error(where + ': ' + k + ' is both fixed and sampled');
        if (fixed == null && !slots[k]) throw new Error(where + ': ' + k + ' is neither fixed nor sampled');
        var list = slots[k] || [fixed];
        if (!list.length) throw new Error(where + ': empty allow-list for ' + k);
        list.forEach(function (val) {
          var id = valueId(val);
          if (model.CAN_HAVE[k].indexOf(id) < 0) {
            throw new Error(where + ': ' + k + ' value "' + id + '" is not in the can-have universe');
          }
          if (slots[k] && criterial[id]) {
            throw new Error(where + ': samples "' + id + '" as ' + k +
              ', but it is a criterial value of ' + criterial[id] + ' on this template');
          }
        });
        // A sampled slot the prose never mentions cannot make two items read
        // differently — it would silently inflate the space with duplicates.
        // Anything with a real choice must show up in the text.
        if (slots[k] && slots[k].length > 1) {
          var named = (PLACEHOLDERS[k] || []).some(function (ph) {
            return v.situation.indexOf('{' + ph + '}') >= 0;
          });
          if (!named) throw new Error(where + ': ' + k + ' is sampled but never named in the situation');
        }
      });
    });
  }

  TEMPLATES.forEach(validate);

  /* ── Enumeration ─────────────────────────────────────────────────────
     The generated space is finite: template × variant × the cartesian product
     of that variant's slot allow-lists. Order is deterministic, so item(i) is
     stable across sessions and devices without anything being stored. */

  function drawsFor(t, v) {
    var slots = slotsFor(t, v);
    var draws = [{}];
    model.CAN_HAVE_KEYS.forEach(function (k) {
      var list = slots[k] || [v.fixed[k]];
      var next = [];
      draws.forEach(function (d) {
        list.forEach(function (val) {
          var copy = {};
          Object.keys(d).forEach(function (dk) { copy[dk] = d[dk]; });
          copy[k] = val;
          next.push(copy);
        });
      });
      draws = next;
    });
    return draws;
  }

  function build(t, v, draw, n, opts) {
    var o = opts || {};
    var level = o.level || t.levels[0];
    var vary = {};
    model.CAN_HAVE_KEYS.forEach(function (k) { vary[k] = valueId(draw[k]); });
    var slots = slotsFor(t, v);
    var sampled = model.CAN_HAVE_KEYS.filter(function (k) { return !!slots[k]; });
    var spec = {
      id: o.id || (t.id + ':' + v.value + ':' + n),
      level: level,
      cat: t.cat,
      answer: v.answer,
      situation: render(v.situation, draw),
      utterance: v.utterance,
      sayVerb: v.sayVerb || t.sayVerb,
      object: v.object || t.object,
      reason: v.reason,
      features: v.features,
      vary: vary,
      // Provenance, not player data. The key travels with the item so a trial
      // record can say which template and which criterial configuration it came
      // from without anybody re-deriving it from the prose.
      generated: true,
      templateId: t.id,
      dim: t.dim,
      variant: v.value,
      surface: n,
      // Which can-have features were SAMPLED. The rest were fixed by the key —
      // G-relationship's "somebody you have never met" is `vary.person` AND
      // `features.relationship`, the same fact in both vocabularies, and it is
      // supplied by the template rather than drawn. Only sampled values are
      // subject to the never-criterial rule, and this is what says which is
      // which without re-deriving it from the template.
      sampled: sampled,
    };
    // Level 3 teaches the reason, so a re-presented Level 3 card keeps ITS OWN
    // exemplar rationales — the surface changed, the teaching content did not.
    if (level === 3) spec.rationales = (o.rationales && o.rationales.length) ? o.rationales : v.rationales;
    if (o.representedFrom) spec.representedFrom = o.representedFrom;
    return model.makeCard(spec);
  }

  /** Every item the generator can produce, at each template's default level. */
  function enumerate() {
    var out = [];
    TEMPLATES.forEach(function (t) {
      t.variants.forEach(function (v) {
        drawsFor(t, v).forEach(function (draw, n) { out.push(build(t, v, draw, n)); });
      });
    });
    return out;
  }

  var SPACE = Object.freeze(enumerate());

  /* ── Re-presentation ─────────────────────────────────────────────────
     A missed teaching card comes back with a FRESH SURFACE and the identical
     criterial item, so passing the repeat cannot be done on a memorised person
     or place. The match is on the whole criterial configuration plus the
     answer — a template that only half-matched would change the item, not its
     surface — and the draw chosen is the one that differs from the card's own
     surface on the most can-have features.

     Returns null when no template carries that exact configuration; the caller
     re-presents the card unchanged rather than substituting something else. */

  function sameFeatures(x, y) {
    var kx = Object.keys(x), ky = Object.keys(y);
    if (kx.length !== ky.length) return false;
    return kx.every(function (k) { return x[k] === y[k]; });
  }

  function represent(card, seed) {
    if (!card || !card.features) return null;
    var best = null;
    var bestScore = -1;
    var offset = Math.abs(Number(seed) || 0);
    TEMPLATES.forEach(function (t) {
      t.variants.forEach(function (v) {
        if (v.answer !== card.answer || !sameFeatures(v.features, card.features)) return;
        var draws = drawsFor(t, v);
        for (var i = 0; i < draws.length; i++) {
          var n = (i + offset) % draws.length;
          var draw = draws[n];
          var score = SAMPLED_SURFACE.filter(function (k) {
            return valueId(draw[k]) !== (card.vary && card.vary[k]);
          }).length;
          if (score > bestScore) { bestScore = score; best = { t: t, v: v, draw: draw, n: n }; }
        }
      });
    });
    if (!best || bestScore < 1) return null;
    return build(best.t, best.v, best.draw, best.n, {
      // Same id, because it is the same target on its second exposure: the
      // deck's "already re-presented" guard and the report both key on it.
      id: card.id,
      level: card.level,
      rationales: card.rationales,
      representedFrom: card.id,
    });
  }

  global.ThinkOrSayGenerator = Object.freeze({
    TEMPLATES: Object.freeze(TEMPLATES),
    SPACE: SPACE,
    count: SPACE.length,
    enumerate: enumerate,
    represent: represent,
    render: render,
  });
})(typeof window !== 'undefined' ? window : globalThis);
