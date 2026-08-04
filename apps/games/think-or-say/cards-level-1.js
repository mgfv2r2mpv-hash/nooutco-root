/* ── Think or Say? - Level 1 "Clear" ───────────────────────────────────
   Early acquisition. The answer is obvious to anyone holding the rule: the
   discrimination is available from the utterance itself and no card asks the
   learner to weigh two criterial dimensions against each other.

   THINK side is blatant - angry words, openly rude statements, private things
   said out loud. SAY side is equally blatant - thanking, asking for help,
   telling a grown-up you feel sick, speaking up about danger, a genuine
   compliment.

   CONTENT RULE (all three levels): only mild, non-name-calling utterances are
   QUOTED. Anything harsher is described, never printed. No slurs, no profanity,
   no specific insults - the game must not teach the vocabulary it warns against.

   CROSS-LABELS. A card declares every criterial dimension that SUPPLIES A
   REASON for its answer, not just the one its pair flips - the maintainer's
   headline finding was that most cards carried two labels where three or four
   apply. The test of applicability is the reason line: if a technician
   debriefing the card would name the dimension, the card declares it. A
   dimension a value could merely be assigned to ("it happens to be a
   classmate") is NOT in play, because a label that explains nothing inflates
   the coverage matrix without teaching anything. Two working rules follow:
     * `privacy` means the information itself is private - the body, home life,
       something told quietly. Embarrassment caused by WHO CAN HEAR is coded by
       `audience`, so the two dimensions stay distinct rather than doubling up.
     * `truthRank: 'true'` goes on a card whose whole temptation is that the
       observation is verifiably true. That is the defeater doing its work, and
       it is exactly the case the learner has to survive.

   ORDER IS DATA. The array order is the deck order under `order: sequential`,
   and it is arranged so the answers do not run in step with the tile
   counterbalance (which alternates on the trial index). Blocks of four run
   THINK, SAY, SAY, THINK; the tail runs SAY. Reordering this array can create a
   perfect position cue - think-or-say-levels.spec.js measures it.
   ----------------------------------------------------------------------- */
(function (global) {
  'use strict';

  global.ThinkOrSayLevel1 = {
    id: 1,
    name: 'Clear',
    blurb: 'Early acquisition - the answer is obvious once you hold the rule.',

    /* ── The rule, stated on screen ─────────────────────────────────────
       The maintainer's structural ruling: "Level 1 should state the rule
       (bring the unspoken rules to light)". Level 1 is early acquisition, so
       the rule is VISIBLE rather than discovered - the Social Thinking point
       in RESEARCH.md §1, that a hidden social rule has to be made explicit
       before anyone can be expected to follow it.

       Declared HERE, once, and never on a card. A per-card rule line would be
       35 copies free to drift apart, and a card that states its own rule
       states its own answer.

       BOTH branches are always on screen together, and that is what keeps the
       strip from giving the card away: every card is a THINK IT or a SAY IT,
       so a strip naming only one side would answer every card in the deck.
       The four tests are the questions, not the verdict - which of them the
       card in front of the learner meets is still theirs to work out.

       Levels 2 and 3 declare no rule, so nothing renders there. At Level 2 the
       situation decides and a four-line rule would be wrong as often as right;
       at Level 3 the learner supplies the reason, and a rule left on screen is
       the answer sheet. -------------------------------------------------- */
    rule: {
      title: 'The rule at Level 1',
      lead: 'Before you say a thought, ask yourself:',

      /* Safety is not one question among equals, it OUTRANKS every other
         question - which is what the `override` dimension means, and what
         L1-13 exists to teach: a classmate stepping toward the road is a SAY
         IT at the worst possible moment, in front of everybody. Stated above
         the two columns so it reads as the standing rule it is. */
      always: {
        answer: 'say',
        test: 'Is somebody hurt, or is somebody not safe?',
        note: 'Then say it - even at a bad moment, even if everybody hears.',
        when: { is: { override: 'help-or-safety' } },
      },

      /* The columns are ORDER-INDEPENDENT by construction, because the panel
         renders them grouped by answer rather than in sequence. No Level 1
         card may satisfy a THINK question and a SAY question at once - a rule
         whose correctness depends on which line you happen to read first is
         not a rule a learner can hold. `when` is what makes that checkable:
         think-or-say-review.spec.js walks all 35 cards through these
         predicates and fails if any card is undecided, contradicted, or
         answered both ways. Edit a card's features and the rule is re-proved
         against it. */
      branches: [
        { answer: 'think', test: 'Could it hurt how they feel?',
          when: { is: { selfEsteem: 'hurts' } } },
        { answer: 'think', test: 'Would other people hear it?',
          when: { is: { audience: 'others-hear' }, isNot: { selfEsteem: 'lifts' } } },
        { answer: 'think', test: 'Is it a private thing about them?',
          when: { is: { privacy: 'private' }, isNot: { relationship: 'grown-up' } } },
        { answer: 'think', test: 'Is this the wrong moment?',
          when: { is: { timing: 'wrong-moment' } } },
        { answer: 'think', test: 'Is it something they cannot change?',
          when: { is: { changeability: 'not-fixable' } } },
        { answer: 'say',   test: 'Is it kind or a true compliment, and not private?',
          when: { is: { selfEsteem: 'lifts' }, isNot: { privacy: 'private' } } },
        { answer: 'say',   test: 'Is it your own news, and a good moment to tell your grown-up?',
          when: { is: { relationship: 'grown-up' }, isNot: { timing: 'wrong-moment' } } },
        { answer: 'say',   test: 'Can they fix it right now, with only you hearing?',
          when: { is: { changeability: 'fixable-now', audience: 'just-them' } } },
      ],
      tip: 'Still not sure? Ask your grown-up.',
    },

    cards: [
      // ── block 1 ──
      { id: 'L1-01', level: 1, cat: 'work', answer: 'think',
        situation: 'Your friend shows you a drawing they made. You do not like how it looks.',
        utterance: 'That drawing looks bad.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', relationship: 'close-friend' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Think it. They worked hard on it - these words would hurt their feelings.' },
      { id: 'L1-02', level: 1, cat: 'kind', answer: 'say',
        situation: 'Your friend shows you a drawing they made. You really like how it looks.',
        utterance: 'That drawing looks great!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', relationship: 'close-friend' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'exclamation' },
        reason: 'Say it! A kind, true compliment makes your friend feel proud.' },
      // The privacy pair holds SELF-ESTEEM constant at lifts. Both utterances are
      // kind and both are true; only whether the news was shared openly or told
      // quietly decides the answer. That is the whole point of the contrast, and
      // it is why the THINK side is a nice thing to hear rather than a cruel one.
      { id: 'L1-04', level: 1, cat: 'kind', answer: 'say',
        situation: 'A classmate tells you out loud, in front of everyone, that they just learned to tie their own shoes.',
        utterance: 'You can tie your shoes!', sayVerb: 'say', object: 'these words',
        features: { privacy: 'not-private', relationship: 'classmate', selfEsteem: 'lifts' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'exclamation' },
        reason: 'Say it! They shared this happy news with everyone, and hearing it back makes them feel proud.' },
      { id: 'L1-03', level: 1, cat: 'private', answer: 'think',
        situation: 'A classmate leans in and tells you quietly, so nobody else hears, that they slept in their own bed all week for the first time.',
        utterance: 'You slept in your own bed all week.', sayVerb: 'say', object: 'these words',
        features: { privacy: 'private', relationship: 'classmate', selfEsteem: 'lifts' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Think it. Kind words can still be private words. They told you quietly, so it is their news to share, not yours.' },

      // ── block 2 ──
      // L1-05 anchors two pairs: it flips CHANGEABILITY against L1-06 and
      // AUDIENCE against L1-08, so all three cards carry the same two keys and
      // each pair moves exactly one of them. The coat is the same coat on all
      // three, so the contrast is criterial and nothing else.
      { id: 'L1-06', level: 1, cat: 'looks', answer: 'think',
        situation: 'You are right beside your friend at the coat hooks. Nobody else is near. Their coat is much too small for them now.',
        utterance: 'Your coat is too small.', sayVerb: 'say', object: 'these words',
        features: { changeability: 'not-fixable', audience: 'just-them' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'statement' },
        reason: 'Think it. They cannot change their coat right now, so saying it would only make them feel bad.' },
      { id: 'L1-05', level: 1, cat: 'other', answer: 'say',
        situation: 'You are right beside your friend at the coat hooks. Nobody else is near. Their coat is inside out.',
        utterance: 'Your coat is inside out.', sayVerb: 'say', object: 'these words',
        features: { changeability: 'fixable-now', audience: 'just-them' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'statement' },
        reason: 'Say it - quietly, just to them. They can fix it right now, so telling them helps.' },
      // An undone lace is a trip hazard, so this card is help-or-safety as well
      // as quiet-and-fixable. That label forces the card OUT of the audience
      // pair: its partner would have to carry `override` too, and any card
      // carrying help-or-safety must answer SAY, so no THINK partner can exist.
      // L1-08 took the audience pair instead. RESEARCH.md §5.4 states the rule.
      { id: 'L1-07', level: 1, cat: 'other', answer: 'say',
        situation: 'You are sitting right next to your friend. Nobody else can hear you. Their shoelace is undone, and they are standing up to run outside.',
        utterance: 'Your shoelace is undone.', sayVerb: 'say', object: 'these words',
        features: { audience: 'just-them', changeability: 'fixable-now', override: 'help-or-safety' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'statement' },
        reason: 'Say it - quietly, just to them. They can tie it right now, and a loose lace is easy to trip over when you run.' },
      { id: 'L1-08', level: 1, cat: 'other', answer: 'think',
        situation: 'You are all the way across the noisy gym from your friend. Everyone is in between. Their coat is inside out.',
        utterance: 'Your coat is inside out!', sayVerb: 'say', object: 'these words',
        features: { audience: 'others-hear', changeability: 'fixable-now' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'exclamation' },
        reason: 'Think it. Shouting it means everyone hears, and that would embarrass your friend. Wait until you are close.' },

      // ── block 3 ──
      // Telling a grown-up you feel sick is help-or-safety, and L1-09 cannot say
      // so: it is the SAY half of the relationship pair, its partner L1-10 answers
      // THINK, and a partner carrying `override` at the same value would have to
      // answer SAY. The label is real and the pair will not hold it.
      { id: 'L1-10', level: 1, cat: 'private', answer: 'think',
        situation: 'Your tummy has hurt all morning. A person you have never met is sitting beside you on the bus.',
        utterance: 'My tummy does not feel good.', sayVerb: 'say', object: 'these words',
        features: { relationship: 'stranger', privacy: 'private' },
        vary: { setting: 'bus', person: 'stranger', topic: 'body', form: 'statement' },
        reason: 'Think it. You do not know this person. Tell your own grown-up instead.' },
      { id: 'L1-09', level: 1, cat: 'other', answer: 'say',
        situation: 'Your tummy has hurt all morning. Your teacher is right beside you.',
        utterance: 'My tummy does not feel good.', sayVerb: 'say', object: 'these words',
        features: { relationship: 'grown-up', privacy: 'private' },
        vary: { setting: 'school', person: 'teacher', topic: 'body', form: 'statement' },
        reason: 'Say it! Telling a grown-up when you feel sick is important.' },
      { id: 'L1-11', level: 1, cat: 'kind', answer: 'say',
        situation: 'Your teacher has finished talking and is looking right at you. You want to show her your drawing.',
        utterance: 'Look at my drawing!', sayVerb: 'say', object: 'these words',
        features: { timing: 'right-moment', relationship: 'grown-up' },
        vary: { setting: 'school', person: 'teacher', topic: 'work', form: 'exclamation' },
        reason: 'Say it! She is free now, so this is a good moment to share.' },
      { id: 'L1-12', level: 1, cat: 'other', answer: 'think',
        situation: 'Your teacher is in the middle of talking to another grown-up. You want to show her your drawing.',
        utterance: 'Look at my drawing!', sayVerb: 'say', object: 'these words',
        features: { timing: 'wrong-moment', relationship: 'grown-up' },
        vary: { setting: 'school', person: 'teacher', topic: 'work', form: 'exclamation' },
        reason: 'Think it for now. She is busy with someone else - you can say it when she is finished.' },

      // ── block 4 ──
      // The override pair also holds TIMING constant at wrong-moment: the teacher
      // is mid-sentence on both cards, so the pair shows that help or safety
      // beats a bad moment while an unhelpful remark does not.
      { id: 'L1-14', level: 1, cat: 'other', answer: 'think',
        situation: 'Your class has lined up on the playground and your teacher is talking to everyone. A classmate near the front has just lost the game their team was playing.',
        utterance: 'Your team lost!', sayVerb: 'say', object: 'these words',
        features: { override: 'none', audience: 'others-hear', timing: 'wrong-moment' },
        vary: { setting: 'playground', person: 'peer', topic: 'work', form: 'exclamation' },
        reason: 'Think it. Nobody is in danger, they already know they lost, and calling it out while your teacher is talking means the whole class hears it.' },
      { id: 'L1-13', level: 1, cat: 'other', answer: 'say',
        situation: 'Your class has lined up on the playground and your teacher is talking to everyone. A classmate steps away from the line toward the street, where cars are driving past.',
        utterance: 'Stop! Cars are coming!', sayVerb: 'tell', object: 'this news',
        features: { override: 'help-or-safety', audience: 'others-hear', timing: 'wrong-moment' },
        vary: { setting: 'playground', person: 'peer', topic: 'body', form: 'exclamation' },
        reason: 'Say it - loudly, and tell a grown-up! Your teacher is talking and everyone will hear you, and that does not matter: when someone might get hurt, speaking up comes first.' },
      // The defeater pair carries its truth in what the learner DID - they counted
      // the chart themselves - rather than in an "It is true that" lead-in bolted
      // to the front of the situation. A card that announces its own criterial
      // feature teaches the announcement.
      { id: 'L1-16', level: 1, cat: 'kind', answer: 'say',
        situation: 'You count the stickers on the chart yourself. Your classmate has filled a whole row today.',
        utterance: 'You filled a whole row!', sayVerb: 'say', object: 'these words',
        features: { truthRank: 'true', selfEsteem: 'lifts' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'exclamation' },
        reason: 'Say it! It is true and it is kind - here true and kind point the same way.' },
      { id: 'L1-15', level: 1, cat: 'work', answer: 'think',
        situation: 'You count the stickers on the chart yourself. Your classmate has the fewest of anyone.',
        utterance: 'You have the fewest stickers.', sayVerb: 'say', object: 'these words',
        features: { truthRank: 'true', selfEsteem: 'hurts' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Think it. It is true, but true is not as important as kind here - it would still hurt.' },

      // ── block 5 ──
      { id: 'L1-17', level: 1, cat: 'other', answer: 'think',
        situation: 'Your whole class is singing a song together. You want to tell your friend about your new shoes.',
        utterance: 'I got new shoes!', sayVerb: 'tell', object: 'this news',
        features: { timing: 'wrong-moment', relationship: 'close-friend', audience: 'others-hear' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'exclamation' },
        reason: 'Think it for now. Everyone is singing and everyone would hear you - you can tell your friend at snack time.' },
      { id: 'L1-18', level: 1, cat: 'kind', answer: 'say',
        situation: 'You do not understand how to do the worksheet. You put your hand up, and your teacher comes over to your table.',
        utterance: 'Can you help me?', sayVerb: 'ask', object: 'this question',
        features: { override: 'help-or-safety', relationship: 'grown-up', timing: 'right-moment' },
        vary: { setting: 'school', person: 'teacher', topic: 'work', form: 'question' },
        reason: 'Say it! You put your hand up and your teacher came over, so this is the moment - asking a grown-up for help is always okay.' },
      { id: 'L1-19', level: 1, cat: 'other', answer: 'say',
        situation: 'A classmate has fallen over on the playground and is crying.',
        utterance: 'Someone is hurt!', sayVerb: 'tell', object: 'this news',
        features: { override: 'help-or-safety', audience: 'others-hear', timing: 'right-moment' },
        vary: { setting: 'playground', person: 'peer', topic: 'body', form: 'exclamation' },
        reason: 'Say it! When someone is hurt, tell a grown-up straight away - right now is the moment, and it does not matter who hears.' },
      { id: 'L1-20', level: 1, cat: 'work', answer: 'think',
        situation: 'A classmate answers the teacher’s question in front of the whole class, and the answer they give is wrong.',
        utterance: 'That was wrong.', sayVerb: 'say', object: 'these words',
        features: { truthRank: 'true', selfEsteem: 'hurts', audience: 'others-hear' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Think it. It is true, but true is not as important as kind - and everyone would hear it.' },

      // ── block 6 ──
      { id: 'L1-21', level: 1, cat: 'private', answer: 'think',
        situation: 'A kid at school has a small accident and their pants get wet. Other kids are all around.',
        utterance: 'Your pants are wet.', sayVerb: 'say', object: 'these words',
        features: { privacy: 'private', audience: 'others-hear', selfEsteem: 'hurts', truthRank: 'true' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Think it. It is true and you can see it, but true is not as important as kind - it is private, and everyone around would hear.' },
      { id: 'L1-22', level: 1, cat: 'kind', answer: 'say',
        situation: 'Your friend gets a new shirt with a dinosaur on it. You love dinosaurs too.',
        utterance: 'I love that shirt!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', relationship: 'close-friend' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'exclamation' },
        reason: 'Say it! A kind compliment will make your friend happy.' },
      { id: 'L1-23', level: 1, cat: 'kind', answer: 'say',
        situation: 'Your classmate shares their snack with you.',
        utterance: 'That was so kind!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', relationship: 'classmate' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'exclamation' },
        reason: 'Say it! Saying thank you makes friends feel good.' },
      { id: 'L1-24', level: 1, cat: 'other', answer: 'think',
        situation: 'Your little brother knocks over the blocks you were building. You feel angry with him.',
        utterance: 'Go away!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', audience: 'others-hear', override: 'none' },
        vary: { setting: 'home', person: 'sibling', topic: 'belongings', form: 'exclamation' },
        reason: 'Think it. Nobody is hurt and nobody is in danger, so this is not a speak-up-anyway moment. Angry words hurt - you can ask a grown-up for help instead.' },

      // ── block 7 ──
      { id: 'L1-25', level: 1, cat: 'smells', answer: 'think',
        situation: 'You sit next to a classmate at lunch. Their food smells really strong.',
        utterance: 'That smells gross.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', relationship: 'classmate', changeability: 'not-fixable', truthRank: 'true' },
        vary: { setting: 'school', person: 'peer', topic: 'smell', form: 'statement' },
        reason: 'Think it. It is true that you can smell it, but true is not as important as kind, because nobody needs help and they cannot change their lunch now.' },
      { id: 'L1-26', level: 1, cat: 'kind', answer: 'say',
        situation: 'Your mom makes your favorite dinner.',
        utterance: 'This tastes SO good!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', relationship: 'grown-up' },
        vary: { setting: 'home', person: 'family', topic: 'work', form: 'exclamation' },
        reason: 'Say it! It will make Mom happy to hear it.' },
      { id: 'L1-28', level: 1, cat: 'kind', answer: 'say',
        situation: 'Your friend makes it to the top of the climbing wall.',
        utterance: 'You did it!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', audience: 'others-hear', relationship: 'close-friend' },
        vary: { setting: 'playground', person: 'peer', topic: 'work', form: 'exclamation' },
        reason: 'Say it! Cheering a friend on is kind and fun.' },
      { id: 'L1-27', level: 1, cat: 'looks', answer: 'think',
        situation: 'A boy in your class has a lot of spots on his face.',
        utterance: 'You have spots all over.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', changeability: 'not-fixable', truthRank: 'true' },
        vary: { setting: 'school', person: 'peer', topic: 'looks', form: 'statement' },
        reason: 'Think it. It is true, but true is not as important as kind, because nobody is unsafe and he cannot change it.' },

      // ── block 8 ──
      { id: 'L1-29', level: 1, cat: 'looks', answer: 'think',
        situation: 'A classmate is wearing two socks that do not match.',
        utterance: 'Your socks do not match.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', changeability: 'not-fixable', truthRank: 'true' },
        vary: { setting: 'school', person: 'peer', topic: 'looks', form: 'statement' },
        reason: 'Think it. It is true, but true is not as important as kind, because nobody needs help and they cannot change their socks at school.' },
      { id: 'L1-30', level: 1, cat: 'kind', answer: 'say',
        situation: 'Your teacher finishes reading a really funny story and you laugh.',
        utterance: 'That story was so funny!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', relationship: 'grown-up', timing: 'right-moment' },
        vary: { setting: 'school', person: 'teacher', topic: 'work', form: 'exclamation' },
        reason: 'Say it! Your teacher will feel happy you liked it.' },
      { id: 'L1-31', level: 1, cat: 'kind', answer: 'say',
        situation: 'Your friend helps you pick up your crayons when you drop them.',
        utterance: 'Thank you, that was really nice!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', relationship: 'close-friend' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'exclamation' },
        reason: 'Say it! Saying thank you is kind and makes friends feel good.' },
      { id: 'L1-35', level: 1, cat: 'private', answer: 'think',
        situation: 'A classmate has a bandage on their arm and you are curious about it. Lots of kids are standing around you both.',
        utterance: 'How did you get that?', sayVerb: 'ask', object: 'this question',
        features: { privacy: 'private', audience: 'others-hear' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'question' },
        reason: 'Think it for now. How they got hurt is private, and asking in front of everyone could embarrass them.' },

      // ── tail ──
      { id: 'L1-32', level: 1, cat: 'kind', answer: 'say',
        situation: 'It is your friend’s birthday and they are wearing a big birthday badge.',
        utterance: 'Happy birthday!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', timing: 'right-moment', relationship: 'close-friend' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'exclamation' },
        reason: 'Say it! Wishing a friend happy birthday makes them feel special.' },
      { id: 'L1-33', level: 1, cat: 'kind', answer: 'say',
        situation: 'A classmate is sitting alone on the playground and looks sad.',
        utterance: 'Are you okay?', sayVerb: 'ask', object: 'this question',
        features: { override: 'help-or-safety', relationship: 'classmate', selfEsteem: 'lifts' },
        vary: { setting: 'playground', person: 'peer', topic: 'body', form: 'question' },
        reason: 'Say it! Asking kindly helps them feel less alone, and it is how you check somebody is okay.' },
      { id: 'L1-34', level: 1, cat: 'kind', answer: 'say',
        situation: 'You finished all of your work and you feel proud of it.',
        utterance: 'I did it!', sayVerb: 'tell', object: 'this news',
        features: { selfEsteem: 'lifts', timing: 'right-moment' },
        vary: { setting: 'school', person: 'teacher', topic: 'work', form: 'exclamation' },
        reason: 'Say it! Sharing happy news about yourself is great.' },
    ],
    // One matched minimum-difference pair per criterial dimension. `defeater` is
    // dimension 8: truth is held CONSTANT across both cards and something else
    // flips, which is the demonstration that truth is not what decides.
    pairs: [
      { dim: 'selfEsteem',    a: 'L1-01', b: 'L1-02' },
      { dim: 'privacy',       a: 'L1-03', b: 'L1-04' },
      { dim: 'changeability', a: 'L1-05', b: 'L1-06' },
      // L1-05 anchors two pairs, the way L2-05 does: same coat, same friend, and
      // one pair moves whether it can be fixed while the other moves who hears.
      // L1-07 held this pair until it took the help-or-safety label an undone
      // lace deserves, which no THINK partner can carry.
      { dim: 'audience',      a: 'L1-05', b: 'L1-08' },
      { dim: 'relationship',  a: 'L1-09', b: 'L1-10' },
      { dim: 'timing',        a: 'L1-11', b: 'L1-12' },
      { dim: 'override',      a: 'L1-13', b: 'L1-14' },
      { dim: 'truthRank',  a: 'L1-15', b: 'L1-16', kind: 'defeater' },
    ],
  };
})(typeof window !== 'undefined' ? window : globalThis);
