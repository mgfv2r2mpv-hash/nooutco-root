/* ── Think or Say? - Level 3 "Explain" ─────────────────────────────────
   Its own pool, authored so the REASON is the teaching target. After the
   learner taps a tile the game asks for the reason, and on reveal it offers
   2-4 exemplar rationales written in deictic I-YOU terms (PEAK-T; Belisle et
   al. 2016 - RESEARCH.md §4.3).

   The exemplars are EXEMPLARS, never a scoring key. The technician scores what
   the learner actually said as Correct / Partly correct / Not yet, plus an
   optional note. A correct reason nobody wrote down here is the ideal outcome
   and scores fully Correct.

   CROSS-LABELS (the maintainer's headline finding, "A lot of these are missing
   cross labels"). This pool went to review declaring exactly two criterial
   features on all eighteen cards, against 2.57 at Level 1 and 2.93 at Level 2 - the lowest claim in the deck on the level whose whole target is SAYING what
   decides the card. Every card has now been read against all eight dimensions
   and labelled where the situation genuinely turns on one, worked pair by pair
   rather than card by card: L3-01..L3-15 are all paired, and L3-05 anchors two
   pairs at once, so its key set is shared by L3-06 AND L3-07. Where a label is
   honest on one half and impossible on the other it is left off and recorded in
   a comment below rather than dropped silently (RESEARCH.md §5.4). Every label
   added is also named by the card's own REASON, which is his L2-25 ruling
   generalised: a card teaches what its reason says.

   Content rule and ORDER IS DATA: see cards-level-1.js. This pool runs
   THINK, THINK, SAY, SAY in blocks of four, eight blocks with no tail - 32
   cards, 16 THINK and 16 SAY.
   ----------------------------------------------------------------------- */
(function (global) {
  'use strict';

  global.ThinkOrSayLevel3 = {
    id: 3,
    name: 'Explain',
    blurb: 'The reason is the target - the learner says why, and you score what they said.',
    cards: [
      // ── block 1 ──
      // The reading pair gains truthRank, held at `true` on both halves: the
      // learner hears both things happen, so the card is "true and it hurts"
      // against "true and it lifts", which is the same shape as L2-01/L2-02.
      // Audience is NOT added: the class hears both, but on the SAY half it
      // explains nothing about why a compliment gets said, and a label that
      // explains nothing is inflation.
      { id: 'L3-01', level: 3, cat: 'work', answer: 'think',
        situation: 'A classmate reads out loud in class. You hear for yourself that they get stuck on a lot of the words.',
        utterance: 'You got stuck a lot.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', relationship: 'classmate', truthRank: 'true' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Think it. You heard it for yourself, so it is true - but true is not as important as kind. They already know it was hard, and saying it would make them feel worse about reading.',
        rationales: [
          'It is true, but kind matters more than true here - saying it would still hurt you.',
          'If I said it, you would feel bad about your reading.',
          'You already know you got stuck, so telling you does not help you.',
          'I can keep it in my head and still be a good friend to you.',
        ] },
      // The privacy pair gains relationship and truthRank. Both are held
      // constant: it is the same close friend telling you both things, and the
      // learner knows both are true because they were told them first-hand - so
      // what moves is only whether the thing told was private.
      { id: 'L3-03', level: 3, cat: 'private', answer: 'think',
        situation: 'You and your close friend are on your own. They told you themselves that they see a special doctor to talk about their feelings.',
        utterance: 'You see a feelings doctor.', sayVerb: 'say', object: 'these words',
        features: { privacy: 'private', audience: 'just-them',
                    relationship: 'close-friend', truthRank: 'true' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Think it. You know it is true because they told you themselves, but true does not outrank private - they told you in private, so it is your close friend’s to tell, not yours.',
        rationales: [
          'You told me that in private, so it is yours to tell, not mine.',
          'It being true does not outrank their privacy.',
          'If I said it, you might not trust me with anything again.',
        ] },
      { id: 'L3-02', level: 3, cat: 'kind', answer: 'say',
        situation: 'A classmate reads out loud in class. You hear for yourself that they finish the whole page.',
        utterance: 'You read the whole page!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', relationship: 'classmate', truthRank: 'true' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'exclamation' },
        reason: 'Say it! You heard it for yourself, so it is true - and here the true thing is also the kind one, so they point the same way. Telling someone what went well makes them feel proud and want to try again.',
        rationales: [
          'If I say it, you would feel proud of your reading.',
          'It is true, and here true and kind point the same way, so saying it helps you.',
          'Telling you what you did well helps you want to read again.',
        ] },
      { id: 'L3-04', level: 3, cat: 'kind', answer: 'say',
        situation: 'You and your close friend are on your own. They told you themselves, all excited, that they got a new bike.',
        utterance: 'You got a new bike!', sayVerb: 'say', object: 'these words',
        features: { privacy: 'not-private', audience: 'just-them',
                    relationship: 'close-friend', truthRank: 'true' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'exclamation' },
        reason: 'Say it! You know it is true because they told you themselves, and a new bike is not a private thing - it is happy news your close friend was pleased to share, so talking about it is kind.',
        rationales: [
          'You were excited to tell me, so you would like me being interested.',
          'It is true and it is not private, so nothing here outranks saying it.',
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
      // The relationship pair gains truthRank at `not-sure` - the first card
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
        features: { relationship: 'close-friend', privacy: 'private', truthRank: 'not-sure' },
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
        features: { relationship: 'stranger', privacy: 'private', truthRank: 'not-sure' },
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
        features: { truthRank: 'true', privacy: 'private', relationship: 'classmate' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Think it. You really did see it, but true does not outrank private - your classmate went somewhere private for a reason.',
        rationales: [
          'It being true does not outrank where they went to be alone.',
          'You were on your own for a reason, so saying it would embarrass you.',
        ] },
      { id: 'L3-15', level: 3, cat: 'kind', answer: 'say',
        situation: 'You watched your classmate win the running race this morning, with everybody on the playground cheering them on.',
        utterance: 'You won the race!', sayVerb: 'say', object: 'these words',
        features: { truthRank: 'true', privacy: 'not-private', relationship: 'classmate' },
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

      // ── block 5 ──
      // L3-16 and L3-18 hold no pair either. Both gain truthRank and
      // changeability, and both were already teaching them in prose: the present
      // really is one you already own, the chart really does say what it says,
      // and neither is a thing the other person can put right now.
      { id: 'L3-16', level: 3, cat: 'other', answer: 'think',
        situation: 'Your close friend gives you a present they chose themselves. You can see it is something you already have at home.',
        utterance: 'I already have this.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', relationship: 'close-friend',
                    truthRank: 'true', changeability: 'not-fixable' },
        vary: { setting: 'home', person: 'family', topic: 'belongings', form: 'statement' },
        reason: 'Think it. You really do already have one, but true is not as important as kind, because nobody is unsafe and they cannot change it now - saying it would only spoil how good they feel about giving it.',
        rationales: [
          'You chose it for me, so saying it would spoil how good you feel.',
          'It is true that I have one already, but kind matters more than true here.',
          'You cannot change the present now, so telling you would not help.',
          'I can say thank you out loud and keep the other part in my head.',
        ] },
      { id: 'L3-18', level: 3, cat: 'work', answer: 'think',
        situation: 'You counted the stars on the chart, and your classmate has fewer than anybody else this week.',
        utterance: 'You got the fewest stars.', sayVerb: 'say', object: 'these words',
        features: { truthRank: 'true', selfEsteem: 'hurts',
                    relationship: 'classmate', changeability: 'not-fixable' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Think it. It is true, but true is not as important as kind, because nobody needs help and the week is over - your classmate cannot change the chart now.',
        rationales: [
          'True does not outrank kind here - it is true AND it would hurt you.',
          'The week is over, so there is nothing you can do about your number now.',
          'You already know your own number, so saying it just makes you feel worse.',
        ] },
      // The second round, L3-19..L3-32, is where the pool starts teaching the
      // HIERARCHY between the dimensions rather than one dimension at a time.
      // Seven of the fourteen put two considerations in conflict and let the
      // ordering decide: private against safety (L3-20), kind against private
      // with everyone listening (L3-21), wrong moment against fixable right now
      // (L3-23), true against kind (L3-25, L3-27), right moment against kind
      // (L3-31), and embarrassing against safety (L3-29). Twelve of them come
      // as six more minimum-difference pairs,
      // so each conflict has a partner where one feature moves and the answer
      // moves with it. They also go where the first eighteen never went: the
      // shop, the family table, siblings, and a stranger who can be helped.
      //
      // L3-20 pairs with L3-19 (override). Both are private - the cousin told
      // you on your own - and the whole table hears both. Only the danger
      // moves, and it outranks the secret.
      { id: 'L3-20', level: 3, cat: 'other', answer: 'say',
        situation: 'Your family is eating dinner together. Your cousin whispers to you that they ate a cookie with nuts in it, and now their lips feel funny. They are allergic to nuts, and they ask you not to tell anyone.',
        utterance: 'Their lips feel funny, and they ate nuts.', sayVerb: 'tell', object: 'this news',
        features: { override: 'help-or-safety', privacy: 'private', audience: 'others-hear' },
        vary: { setting: 'home', person: 'family', topic: 'body', form: 'statement' },
        reason: 'Say it - to a grown-up, right now. Your cousin told you in private and the whole table will hear, but they could be getting sick, and safety always comes first.',
        rationales: [
          'You could get really sick, so keeping you safe matters more than keeping your secret.',
          'Everybody at the table will hear me, and that is okay when you might need help.',
          'If I kept quiet and you got sicker, I would feel awful - I want you to be safe.',
        ] },
      // L3-23 pairs with L3-24 (changeability). Timing is held at the wrong
      // moment on both - he is busy - and both are said quietly to him alone.
      // A card left in the machine can be fixed in the next ten seconds; a
      // paint stain that never washed out cannot. That is the conflict the owner
      // asked for: the wrong moment loses to "they can fix it right now".
      { id: 'L3-23', level: 3, cat: 'other', answer: 'say',
        situation: 'You are at the shop with your dad, standing right next to him. He is busy talking to the cashier and packing the bags. You can see his bank card is still sticking out of the card machine.',
        utterance: 'Dad, your card is still in the machine.', sayVerb: 'tell', object: 'this news',
        features: { timing: 'wrong-moment', changeability: 'fixable-now', audience: 'just-them' },
        vary: { setting: 'shop', person: 'family', topic: 'belongings', form: 'statement' },
        reason: 'Say it - quietly. He is busy, so it is not the best moment, but he can fix it right now, and in a minute it will be too late. If you say it quietly, only he hears.',
        rationales: [
          'You can take your card right now, so telling you helps even though you are busy.',
          'If I waited until later, your card would be left behind.',
          'I can say it quietly so only you hear me.',
        ] },

      // ── block 6 ──
      { id: 'L3-19', level: 3, cat: 'private', answer: 'think',
        situation: 'Your family is eating dinner together. Earlier, your cousin told you on your own that they cried at the end of a sad movie last night.',
        utterance: 'You cried at the sad movie!', sayVerb: 'say', object: 'these words',
        features: { override: 'none', privacy: 'private', audience: 'others-hear' },
        vary: { setting: 'home', person: 'family', topic: 'body', form: 'exclamation' },
        reason: 'Think it. Nobody needs help and nothing is unsafe, your cousin told you this in private, and the whole table would hear - so it would only embarrass them.',
        rationales: [
          'You told me that on your own, so it is yours to tell, not mine.',
          'If I said it at the table, everybody would hear and you would feel embarrassed.',
          'Nobody is hurt or in danger, so there is no reason to share your private thing.',
        ] },
      // L3-21 pairs with L3-22 (audience). The compliment is kind on both and
      // the reading helper is private on both; only who can hear moves. It is
      // the "kind but private" conflict: kind does not outrank private when
      // everybody is listening, and it does not need to when nobody is.
      { id: 'L3-21', level: 3, cat: 'private', answer: 'think',
        situation: 'The whole class is sitting together on the carpet. Your close friend told you on your own that they go to a reading helper after school. They just read a page of their book to the class, and you can hear for yourself that their reading is getting better.',
        utterance: 'You are getting really good at reading with your helper.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', privacy: 'private', audience: 'others-hear' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Think it for now. It is kind and it would make them feel proud - but the reading helper is private, and the whole class would hear. Kind does not outrank private, so save it for when you are on your own.',
        rationales: [
          'It would make you feel proud, but you told me about your helper in private.',
          'Everybody on the carpet would hear, and you might not want them to know.',
          'I can tell you later, when it is just the two of us.',
        ] },
      { id: 'L3-22', level: 3, cat: 'kind', answer: 'say',
        situation: 'You and your close friend sit together at the back of the bus, and nobody else is near. They told you on your own that they go to a reading helper after school. They just read you a page of their book, and you can hear for yourself that their reading is getting better.',
        utterance: 'You are getting really good at reading with your helper.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', privacy: 'private', audience: 'just-them' },
        vary: { setting: 'bus', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Say it. The reading helper is private, but they told you themselves and nobody else can hear - so something kind, said to just them, makes them feel proud.',
        rationales: [
          'Nobody else can hear me, so your private thing stays private.',
          'If I say it, you would feel proud of how hard you have worked.',
          'You told me about your helper, so it is okay to talk about it with just you.',
        ] },
      // L3-26 pairs with L3-25 as a second truthRank defeater. Truth is held at
      // `true` - the learner smells the perfume and sees the umbrella - and both
      // are strangers, so "never talk to a stranger" cannot be the rule either.
      // What moves is whether they can fix it right now.
      { id: 'L3-26', level: 3, cat: 'kind', answer: 'say',
        situation: 'A person you have never met gets up to leave the bus. You can see their umbrella is still hooked on the back of their seat.',
        utterance: 'You forgot your umbrella!', sayVerb: 'say', object: 'these words',
        features: { truthRank: 'true', relationship: 'stranger', changeability: 'fixable-now' },
        vary: { setting: 'bus', person: 'stranger', topic: 'belongings', form: 'exclamation' },
        reason: 'Say it! You can see it for yourself, so it is true, and even though they are a stranger, they can grab it right now - so telling them helps.',
        rationales: [
          'You can grab your umbrella right now, so telling you helps you.',
          'I do not know you, but helping you get your umbrella back is still kind.',
          'If I stayed quiet, you would lose your umbrella.',
        ] },

      // ── block 7 ──
      { id: 'L3-24', level: 3, cat: 'looks', answer: 'think',
        situation: 'You are at the shop with your dad, standing right next to him. He is busy talking to the cashier and packing the bags. You can see an old paint stain on his shirt that never washed out.',
        utterance: 'Why is there paint on your shirt?', sayVerb: 'ask', object: 'this question',
        features: { timing: 'wrong-moment', changeability: 'not-fixable', audience: 'just-them' },
        vary: { setting: 'shop', person: 'family', topic: 'looks', form: 'question' },
        reason: 'Think it. You could ask quietly so only he hears, but he is busy, and that stain will never come out - so asking would not help.',
        rationales: [
          'That stain will not come out, so asking would not help you.',
          'You are busy with the cashier, and this can wait until later.',
          'Even if I ask quietly, it would just make you worry about your shirt.',
        ] },
      { id: 'L3-25', level: 3, cat: 'smells', answer: 'think',
        situation: 'A person you have never met sits down next to you on the bus. You can smell that they are wearing a lot of strong perfume.',
        utterance: 'Your perfume is really strong.', sayVerb: 'say', object: 'these words',
        features: { truthRank: 'true', relationship: 'stranger', changeability: 'not-fixable' },
        vary: { setting: 'bus', person: 'stranger', topic: 'smell', form: 'statement' },
        reason: 'Think it. You can smell it for yourself, so it is true - but true is not as important as kind. They are a stranger, and they cannot wash it off on the bus, so saying it would only hurt their feelings.',
        rationales: [
          'It is true, but you cannot change it on the bus, so telling you would only make you feel bad.',
          'I do not know you, so it is not my place to talk about how you smell.',
          'I can keep it in my head, or move seats if I need to.',
        ] },
      // L3-28 pairs with L3-27 (selfEsteem). The same brother, the same
      // drawing, the same quiet room, and both things really are on the page.
      // Only whether saying it hurts or lifts moves.
      { id: 'L3-28', level: 3, cat: 'kind', answer: 'say',
        situation: 'You and your little brother are on your own in the living room. He shows you a drawing he made of you, and you can see he put in your favorite hat.',
        utterance: 'You drew my favorite hat!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', truthRank: 'true', audience: 'just-them' },
        vary: { setting: 'home', person: 'sibling', topic: 'looks', form: 'exclamation' },
        reason: 'Say it! You can see it for yourself, so it is true - and here true and kind point the same way. Even with just the two of you, telling him makes him proud of his drawing.',
        rationales: [
          'If I say it, you would feel proud that you remembered my hat.',
          'It is true and it is kind, so saying it helps you.',
          'You made it for me, so I want you to know what I like about it.',
        ] },
      // L3-29 holds no pair. It is the owner's "embarrassing but a safety
      // issue": a fuss in front of her friends is exactly what she asked you
      // not to make, and the override beats it. Timing is right-moment because
      // before she jumps is the only moment that helps.
      { id: 'L3-29', level: 3, cat: 'other', answer: 'say',
        situation: 'Your big sister is on the swing in your back yard, with her friends all around. She has told you she does not like a fuss in front of them. You can see broken glass on the ground right where she is about to jump off.',
        utterance: 'Wait, there is broken glass!', sayVerb: 'say', object: 'these words',
        features: { override: 'help-or-safety', audience: 'others-hear', timing: 'right-moment' },
        vary: { setting: 'home', person: 'sibling', topic: 'body', form: 'exclamation' },
        reason: 'Say it - loudly, right now. Her friends will all hear, and she does not like a fuss, but she could get hurt, and safety always comes first. Before she jumps is the only moment that helps. Then tell a grown-up about the glass so they can clean it up.',
        rationales: [
          'You could get cut, so keeping you safe matters more than you feeling embarrassed.',
          'Everybody will hear me, and that is okay when you could get hurt.',
          'If I waited, you would already have jumped.',
        ] },

      // ── block 8 ──
      { id: 'L3-27', level: 3, cat: 'looks', answer: 'think',
        situation: 'You and your little brother are on your own in the living room. He shows you a drawing he made of you, and you can see he drew your nose much too big.',
        utterance: 'You made my nose too big!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', truthRank: 'true', audience: 'just-them' },
        vary: { setting: 'home', person: 'sibling', topic: 'looks', form: 'exclamation' },
        reason: 'Think it. You can see it for yourself, so it is true - but true is not as important as kind. Nobody else is around, and it would still make him feel bad about a drawing he made for you.',
        rationales: [
          'You made this for me, so if I said that, you would feel bad about your drawing.',
          'It is true, but being kind to you matters more to me than saying it.',
          'I can tell you what I like about it instead.',
        ] },
      // L3-31 pairs with L3-32 (selfEsteem), and it is the conflict a learner
      // meets most often: the coach ASKED, so the moment is right and the
      // thing is true - and it still hurts. Timing and truth are held on both;
      // only hurt against lift moves.
      { id: 'L3-31', level: 3, cat: 'work', answer: 'think',
        situation: 'After soccer practice, your coach asks the team to talk about how today went. You watched your teammate miss three shots at the goal.',
        utterance: 'You missed three shots at the goal.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', timing: 'right-moment', truthRank: 'true' },
        vary: { setting: 'playground', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Think it. The coach asked, so it is the right moment to talk, and it is true - but true is not as important as kind. Saying it would make your teammate feel bad about how they played.',
        rationales: [
          'The coach asked us to talk, but that does not mean I should say something that hurts you.',
          'It is true, but if I said it, you would feel bad about how you played.',
          'I can tell you something that went well for you instead.',
        ] },
      // L3-30 holds no pair. A smell is the kind of thing a learner is taught
      // to keep quiet about, and here it is a SAY: nobody else hears, she can
      // clean the shoe, and now - before the party - is the right moment.
      { id: 'L3-30', level: 3, cat: 'smells', answer: 'say',
        situation: 'Your big sister is putting on her shoes to go to a party. You are on your own with her by the front door, and you can smell that one of her shoes has stepped in something from the yard.',
        utterance: 'Your shoe smells like you stepped in something.', sayVerb: 'say', object: 'these words',
        features: { changeability: 'fixable-now', audience: 'just-them', timing: 'right-moment' },
        vary: { setting: 'home', person: 'sibling', topic: 'smell', form: 'statement' },
        reason: 'Say it - quietly, now. Nobody else can hear, she can clean her shoe before she goes, and now is the right moment - at the party it would be too late.',
        rationales: [
          'You can clean your shoe right now, so telling you helps you.',
          'It is just us by the door, so nobody else hears.',
          'If I waited until the party, everybody there would smell it.',
        ] },
      { id: 'L3-32', level: 3, cat: 'kind', answer: 'say',
        situation: 'After soccer practice, your coach asks the team to talk about how today went. You watched your teammate stop three shots at the goal.',
        utterance: 'You stopped three shots at the goal!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', timing: 'right-moment', truthRank: 'true' },
        vary: { setting: 'playground', person: 'peer', topic: 'work', form: 'exclamation' },
        reason: 'Say it! The coach asked, so it is the right moment, it is true, and here true and kind point the same way - saying it makes your teammate proud of how they played.',
        rationales: [
          'The coach asked us, so now is the right time to tell you.',
          'If I say it, you would feel proud of how you played.',
          'It is true, and I want you to know you played well.',
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
      { dim: 'truthRank',  a: 'L3-14', b: 'L3-15', kind: 'defeater' },
      // The second round's pairs. Each dimension's FIRST pair above is the one
      // the review spec pins; these add a second contrast on five of them.
      { dim: 'override',      a: 'L3-19', b: 'L3-20' },
      { dim: 'audience',      a: 'L3-21', b: 'L3-22' },
      { dim: 'changeability', a: 'L3-23', b: 'L3-24' },
      { dim: 'truthRank',     a: 'L3-25', b: 'L3-26', kind: 'defeater' },
      { dim: 'selfEsteem',    a: 'L3-27', b: 'L3-28' },
      { dim: 'selfEsteem',    a: 'L3-31', b: 'L3-32' },
    ],
  };
})(typeof window !== 'undefined' ? window : globalThis);
