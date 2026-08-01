/* ── Think or Say? — Level 3 "Explain" ─────────────────────────────────
   Its own pool, authored so the REASON is the teaching target. After the
   learner taps a tile the game asks for the reason, and on reveal it offers
   2-4 exemplar rationales written in deictic I-YOU terms (PEAK-T; Belisle et
   al. 2016 — RESEARCH.md §4.3).

   The exemplars are EXEMPLARS, never a scoring key. The technician scores what
   the learner actually said as Correct / Partly correct / Not yet, plus an
   optional note. A correct reason nobody wrote down here is the ideal outcome
   and scores fully Correct.

   CROSS-LABELS (the maintainer's headline finding, "A lot of these are missing
   cross labels"). This pool went to review declaring exactly two criterial
   features on all eighteen cards, against 2.57 at Level 1 and 2.93 at Level 2 —
   the lowest claim in the deck on the level whose whole target is SAYING what
   decides the card. Every card has now been read against all eight dimensions
   and labelled where the situation genuinely turns on one, worked pair by pair
   rather than card by card: L3-01..L3-15 are all paired, and L3-05 anchors two
   pairs at once, so its key set is shared by L3-06 AND L3-07. Where a label is
   honest on one half and impossible on the other it is left off and recorded in
   a comment below rather than dropped silently (RESEARCH.md §5.4). Every label
   added is also named by the card's own REASON, which is his L2-25 ruling
   generalised: a card teaches what its reason says.

   Content rule and ORDER IS DATA: see cards-level-1.js. This pool runs
   THINK, THINK, SAY, SAY in blocks of four, then a THINK tail.
   ----------------------------------------------------------------------- */
(function (global) {
  'use strict';

  global.ThinkOrSayLevel3 = {
    id: 3,
    name: 'Explain',
    blurb: 'The reason is the target - the learner says why, and you score what they said.',
    cards: [
      // ── block 1 ──
      // The reading pair gains truthNotTest, held at `true` on both halves: the
      // learner hears both things happen, so the card is "true and it hurts"
      // against "true and it lifts", which is the same shape as L2-01/L2-02.
      // Audience is NOT added: the class hears both, but on the SAY half it
      // explains nothing about why a compliment gets said, and a label that
      // explains nothing is inflation.
      { id: 'L3-01', level: 3, cat: 'work', answer: 'think',
        situation: 'A classmate reads out loud in class. You hear for yourself that they get stuck on a lot of the words.',
        utterance: 'You got stuck a lot.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', relationship: 'classmate', truthNotTest: 'true' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Think it. You heard it for yourself, so it is true - and true is not the test. They already know it was hard, and saying it would make them feel worse about reading.',
        rationales: [
          'It is true, and true is not the test - saying it would still hurt you.',
          'If I said it, you would feel bad about your reading.',
          'You already know you got stuck, so telling you does not help you.',
          'I can keep it in my head and still be a good friend to you.',
        ] },
      // The privacy pair gains relationship and truthNotTest. Both are held
      // constant: it is the same close friend telling you both things, and the
      // learner knows both are true because they were told them first-hand - so
      // what moves is only whether the thing told was private.
      { id: 'L3-03', level: 3, cat: 'private', answer: 'think',
        situation: 'You and your close friend are on your own. They told you themselves that they see a special doctor to talk about their feelings.',
        utterance: 'You see a feelings doctor.', sayVerb: 'say', object: 'these words',
        features: { privacy: 'private', audience: 'just-them',
                    relationship: 'close-friend', truthNotTest: 'true' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Think it. You know it is true because they told you themselves, and true is not the test - they told you in private, so it is your close friend’s to tell, not yours.',
        rationales: [
          'You told me that in private, so it is yours to tell, not mine.',
          'It being true does not change that - true is not the test.',
          'If I said it, you might not trust me with anything again.',
        ] },
      { id: 'L3-02', level: 3, cat: 'kind', answer: 'say',
        situation: 'A classmate reads out loud in class. You hear for yourself that they finish the whole page.',
        utterance: 'You read the whole page!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', relationship: 'classmate', truthNotTest: 'true' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'exclamation' },
        reason: 'Say it! You heard it for yourself, so it is true - and this time the true thing is a kind one. Telling someone what went well makes them feel proud and want to try again.',
        rationales: [
          'If I say it, you would feel proud of your reading.',
          'It is true, and this time saying the true thing helps you.',
          'Telling you what you did well helps you want to read again.',
        ] },
      { id: 'L3-04', level: 3, cat: 'kind', answer: 'say',
        situation: 'You and your close friend are on your own. They told you themselves, all excited, that they got a new bike.',
        utterance: 'You got a new bike!', sayVerb: 'say', object: 'these words',
        features: { privacy: 'not-private', audience: 'just-them',
                    relationship: 'close-friend', truthNotTest: 'true' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'exclamation' },
        reason: 'Say it! You know it is true because they told you themselves, and a new bike is not a private thing - it is happy news your close friend was pleased to share, so talking about it is kind.',
        rationales: [
          'You were excited to tell me, so you would like me being interested.',
          'It is true and it is not private, so saying it does not hurt you.',
        ] },

      // ── block 2 ──
      // The L3-05 cluster. L3-05 anchors both the changeability pair (L3-06) and
      // the audience pair (L3-07), so all three cards must declare the SAME
      // criterial keys. Two labels are honest on all three and were missing:
      // it is the same close friend every time, and none of the three things is
      // a private thing to have noticed. That is the point of the cluster -
      // "not private" is not a licence to say it; what decides is whether they
      // can fix it and who can hear.
      // selfEsteem is NOT added, and cannot be: it stings on L3-06 (teeth) and
      // on L3-07 (in front of the assembly) but not on L3-05, so it would be a
      // second differing feature and the pairs would stop being minimum
      // difference.
      { id: 'L3-06', level: 3, cat: 'looks', answer: 'think',
        situation: 'You and your close friend are on your own in the hallway. You have noticed that their front teeth stick out.',
        utterance: 'Your teeth stick out.', sayVerb: 'say', object: 'these words',
        features: { changeability: 'not-fixable', audience: 'just-them',
                    relationship: 'close-friend', privacy: 'not-private' },
        vary: { setting: 'school', person: 'peer', topic: 'looks', form: 'statement' },
        reason: 'Think it. Teeth are not a private thing and nobody else can hear you - but there is nothing your close friend can do about their teeth today, so it would only hurt.',
        rationales: [
          'You cannot change your teeth today, so telling you only makes you feel bad.',
          'Nobody else can hear me, and that still does not make it worth saying.',
          'It would not help you - it would just hurt you.',
        ] },
      { id: 'L3-07', level: 3, cat: 'other', answer: 'think',
        situation: 'You and your close friend are in the middle of a crowded assembly. The label on their sweater is sticking up at the back.',
        utterance: 'Your label is sticking up!', sayVerb: 'say', object: 'these words',
        features: { audience: 'others-hear', changeability: 'fixable-now',
                    relationship: 'close-friend', privacy: 'not-private' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'exclamation' },
        reason: 'Think it for now. A label is not a private thing and they could fix it - but everyone in the assembly would hear, so wait until you are on your own.',
        rationales: [
          'Everyone would hear me, and you would feel embarrassed.',
          'It is not a private thing, but here is not the place to say it.',
          'I can wait until we are on our own and tell you then.',
        ] },
      { id: 'L3-05', level: 3, cat: 'other', answer: 'say',
        situation: 'You and your close friend are on your own in the hallway. The label on their sweater is sticking up at the back.',
        utterance: 'Your label is sticking up.', sayVerb: 'say', object: 'these words',
        features: { changeability: 'fixable-now', audience: 'just-them',
                    relationship: 'close-friend', privacy: 'not-private' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'statement' },
        reason: 'Say it. A label is not a private thing, your close friend can fix it right now, and nobody else hears - so telling them helps.',
        rationales: [
          'You can fix it right now, so telling you helps you.',
          'A label sticking up is not a private thing, and nobody else can hear me.',
          'I would want you to tell me if my label was sticking up.',
        ] },
      // The relationship pair gains truthNotTest at `not-sure` - the first card
      // in the deck to sample that value, and the honest one here: red eyes are
      // what the learner can actually see, and whether the person was crying is
      // exactly what they do not know. It is held constant, so what moves is
      // only who the person is: not being sure is a reason to ASK a close
      // friend and a reason to leave a stranger alone.
      // audience, timing and override are all in play on one half and not the
      // other (a bus is not a quiet seat beside you; a turned back is not a
      // moment), so none of them can be declared here.
      { id: 'L3-08', level: 3, cat: 'kind', answer: 'say',
        situation: 'Your close friend is sitting beside you. Their eyes are red and wet, and you are not sure what has happened.',
        utterance: 'Are you okay?', sayVerb: 'ask', object: 'this question',
        features: { relationship: 'close-friend', privacy: 'private', truthNotTest: 'not-sure' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'question' },
        reason: 'Say it. You are not sure what has happened, and asking a close friend gently is how you find out - they can choose what to tell you.',
        rationales: [
          'I am not sure what happened, so I ask you instead of guessing.',
          'You are my close friend, so asking gently shows I care about you.',
          'You can choose to tell me or not - I am only asking, not telling everyone.',
        ] },

      // ── block 3 ──
      { id: 'L3-09', level: 3, cat: 'private', answer: 'think',
        situation: 'A person you have never met is sitting near you on the bus. Their eyes are red and wet, and they have turned away from everyone.',
        utterance: 'Are you okay?', sayVerb: 'ask', object: 'this question',
        features: { relationship: 'stranger', privacy: 'private', truthNotTest: 'not-sure' },
        vary: { setting: 'bus', person: 'stranger', topic: 'body', form: 'question' },
        reason: 'Think it. You are not sure what has happened, you do not know them, and they turned away - tell your own grown-up instead.',
        rationales: [
          'I do not know you, and you turned away, so you may want to be left alone.',
          'I am not sure what happened, and it is not mine to ask about.',
          'I can tell my grown-up instead of asking you myself.',
        ] },
      // The timing pair gains override and privacy, both constant. Weekend news
      // is nobody's private business and nobody's emergency on either card - so
      // the pair says plainly that neither of the two dimensions a learner
      // reaches for first is what decides it. Timing is.
      { id: 'L3-10', level: 3, cat: 'other', answer: 'think',
        situation: 'Your teacher is in the middle of helping another child with a hard problem. You want to tell her about your weekend.',
        utterance: 'I went to the lake!', sayVerb: 'tell', object: 'this news',
        features: { timing: 'wrong-moment', relationship: 'grown-up',
                    override: 'none', privacy: 'not-private' },
        vary: { setting: 'school', person: 'teacher', topic: 'work', form: 'exclamation' },
        reason: 'Think it for now. Nobody needs help and nothing is unsafe, and your weekend is not a private thing - but she is helping someone, so your news can wait a minute.',
        rationales: [
          'She is busy helping someone right now, so my news can wait.',
          'Nobody needs help and nothing is unsafe, so there is no reason to say it this second.',
          'If I say it now, she has to stop helping them.',
        ] },
      { id: 'L3-11', level: 3, cat: 'kind', answer: 'say',
        situation: 'Your teacher has finished helping and asks whether anyone has news to share. You want to tell her about your weekend.',
        utterance: 'I went to the lake!', sayVerb: 'tell', object: 'this news',
        features: { timing: 'right-moment', relationship: 'grown-up',
                    override: 'none', privacy: 'not-private' },
        vary: { setting: 'school', person: 'teacher', topic: 'work', form: 'exclamation' },
        reason: 'Say it! Nothing here is about help or being safe, and your weekend is not a private thing - she asked for news, so this is exactly the right moment.',
        rationales: [
          'She asked for news, so this is the right moment to tell her.',
          'It is not private and nobody needs help - it is just good news to share.',
          'Sharing happy news when someone asks for it is a kind thing to do.',
        ] },
      // The override pair gains relationship and audience. The class is written
      // into both situations because audience is the label L3-13's own reason
      // was already leaning on - "it would hurt whoever brought that lunch" only
      // means anything if that person can hear. Held constant, it teaches the
      // harder half of the override: everyone hearing you is a reason to wait,
      // right up until somebody could get hurt.
      // selfEsteem is honest on L3-13 and absent on L3-12 (nobody's feelings are
      // in the smoke), so it cannot be declared on either.
      { id: 'L3-12', level: 3, cat: 'other', answer: 'say',
        situation: 'Your teacher is in the middle of helping another child, and the whole class is around you. You can smell smoke coming from the hallway.',
        utterance: 'I can smell smoke!', sayVerb: 'tell', object: 'this news',
        features: { override: 'help-or-safety', timing: 'wrong-moment',
                    relationship: 'grown-up', audience: 'others-hear' },
        vary: { setting: 'school', person: 'teacher', topic: 'smell', form: 'exclamation' },
        reason: 'Say it! She is busy and the whole class would hear you - but somebody could get hurt, and safety always comes first.',
        rationales: [
          'Somebody could get hurt, so this is more important than waiting.',
          'Everyone hearing me does not matter when somebody could get hurt.',
          'When it is about being safe, I say it straight away even if she is busy.',
        ] },

      // ── block 4 ──
      { id: 'L3-13', level: 3, cat: 'smells', answer: 'think',
        situation: 'Your teacher is in the middle of helping another child, and the whole class is around you. You can smell somebody’s lunch and you do not like the smell.',
        utterance: 'That lunch smells gross!', sayVerb: 'say', object: 'these words',
        features: { override: 'none', timing: 'wrong-moment',
                    relationship: 'grown-up', audience: 'others-hear' },
        vary: { setting: 'school', person: 'teacher', topic: 'smell', form: 'exclamation' },
        reason: 'Think it. Nobody is in danger, she is busy, and the whole class would hear you - including whoever brought that lunch.',
        rationales: [
          'Nobody is in danger, so I can wait.',
          'Everybody would hear me, including the person whose lunch it is.',
          'It is not important enough to stop her helping somebody else.',
        ] },
      // The defeater pair gains relationship, constant at classmate: truth is
      // held at `true` on both halves and privacy is what flips, so naming who
      // it is about costs the pair nothing and stops the contrast reading as
      // "one is a friend and one is not".
      // selfEsteem cannot join it - it hurts on L3-14 and lifts on L3-15, which
      // is a second difference.
      { id: 'L3-14', level: 3, cat: 'private', answer: 'think',
        situation: 'You walked into the bathroom this morning and saw your classmate crying on their own in there.',
        utterance: 'You were crying in the bathroom.', sayVerb: 'say', object: 'these words',
        features: { truthNotTest: 'true', privacy: 'private', relationship: 'classmate' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Think it. You really did see it, and it being true does not make it yours to say - your classmate went somewhere private for a reason.',
        rationales: [
          'It being true does not make it mine to say.',
          'You were on your own for a reason, so saying it would embarrass you.',
        ] },
      { id: 'L3-15', level: 3, cat: 'kind', answer: 'say',
        situation: 'You watched your classmate win the running race this morning, with everybody on the playground cheering them on.',
        utterance: 'You won the race!', sayVerb: 'say', object: 'these words',
        features: { truthNotTest: 'true', privacy: 'not-private', relationship: 'classmate' },
        vary: { setting: 'playground', person: 'peer', topic: 'work', form: 'exclamation' },
        reason: 'Say it! You really did see it, and your classmate won in front of everybody, so it is not a private thing - saying it makes them feel good.',
        rationales: [
          'It is true, and everybody already saw it, so it is not a private thing.',
          'Saying it makes you feel good - true and kind go together here.',
        ] },
      // L3-17 holds no pair, so the audit was free here: it gains relationship
      // and timing outright. Both are what the card is for. A stranger and a
      // moment you would normally wait through are the two reasons a learner
      // gives themselves for staying quiet, and the override beats them both.
      { id: 'L3-17', level: 3, cat: 'other', answer: 'say',
        situation: 'A little kid you have never met has climbed up high at the park and cannot get down. No grown-up has noticed yet.',
        utterance: 'That kid needs help!', sayVerb: 'tell', object: 'this news',
        features: { override: 'help-or-safety', audience: 'others-hear',
                    relationship: 'stranger', timing: 'right-moment' },
        vary: { setting: 'playground', person: 'stranger', topic: 'body', form: 'exclamation' },
        reason: 'Say it - loudly, right now. You have never met them, so they are a stranger, and that does not matter here: somebody could fall, so a grown-up needs to know straight away.',
        rationales: [
          'Somebody could fall, so I say it straight away and loudly.',
          'I do not know them, and that does not matter when somebody could get hurt.',
          'Getting a grown-up is the fastest way to help them.',
        ] },

      // ── tail ──
      // The two tail cards hold no pair either. Both gain truthNotTest and
      // changeability, and both were already teaching them in prose: the present
      // really is one you already own, the chart really does say what it says,
      // and neither is a thing the other person can put right now.
      { id: 'L3-16', level: 3, cat: 'other', answer: 'think',
        situation: 'Your close friend gives you a present they chose themselves. You can see it is something you already have at home.',
        utterance: 'I already have this.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', relationship: 'close-friend',
                    truthNotTest: 'true', changeability: 'not-fixable' },
        vary: { setting: 'home', person: 'family', topic: 'belongings', form: 'statement' },
        reason: 'Think it. You really do already have one, and true is not the test - they chose it for you and cannot change it now, so saying it would only spoil how good they feel about giving it.',
        rationales: [
          'You chose it for me, so saying it would spoil how good you feel.',
          'It is true that I have one already, and true is not the test.',
          'You cannot change the present now, so telling you would not help.',
          'I can say thank you out loud and keep the other part in my head.',
        ] },
      { id: 'L3-18', level: 3, cat: 'work', answer: 'think',
        situation: 'You counted the stars on the chart, and your classmate has fewer than anybody else this week.',
        utterance: 'You got the fewest stars.', sayVerb: 'say', object: 'these words',
        features: { truthNotTest: 'true', selfEsteem: 'hurts',
                    relationship: 'classmate', changeability: 'not-fixable' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Think it. True is not the test - it is true AND it would hurt, and the week is over, so your classmate cannot change the chart now.',
        rationales: [
          'True is not the test. It is true AND it would hurt you.',
          'The week is over, so there is nothing you can do about your number now.',
          'You already know your own number, so saying it just makes you feel worse.',
        ] },
    ],
    pairs: [
      { dim: 'selfEsteem',    a: 'L3-01', b: 'L3-02' },
      { dim: 'privacy',       a: 'L3-03', b: 'L3-04' },
      { dim: 'changeability', a: 'L3-05', b: 'L3-06' },
      { dim: 'audience',      a: 'L3-05', b: 'L3-07' },
      { dim: 'relationship',  a: 'L3-08', b: 'L3-09' },
      { dim: 'timing',        a: 'L3-10', b: 'L3-11' },
      { dim: 'override',      a: 'L3-12', b: 'L3-13' },
      { dim: 'truthNotTest',  a: 'L3-14', b: 'L3-15', kind: 'defeater' },
    ],
  };
})(typeof window !== 'undefined' ? window : globalThis);
