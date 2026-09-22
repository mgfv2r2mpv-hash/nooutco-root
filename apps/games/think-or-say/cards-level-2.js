/* ── Think or Say? - Level 2 "Nuanced" ─────────────────────────────────
   The answer depends on a feature of the SITUATION, not on the words alone:
   true-but-hurtful observations, private things noticed, comments where
   audience / timing / volume decides, and curious questions that would
   embarrass the person asked.

   Where the same words flip on context, the card text CARRIES that context. A
   card whose answer depends on information the learner was never given is a
   broken card, not a hard one - so "you are right beside them, nobody else can
   hear" and "you are across the lunchroom" are written into the situation.

   Content rule and ORDER IS DATA: see cards-level-1.js. This pool runs
   THINK, THINK, SAY, SAY in eleven blocks of four, then a THINK, SAY tail:
   46 cards, 23 THINK and 23 SAY.
   ----------------------------------------------------------------------- */
(function (global) {
  'use strict';

  global.ThinkOrSayLevel2 = {
    id: 2,
    name: 'Nuanced',
    blurb: 'The situation decides - audience, timing, privacy, what can be changed.',
    cards: [
      // ── block 1 ──
      // The concert is over on both halves of this pair, so changeability is in
      // play on L2-01 - but on L2-02 it explains nothing about why a compliment
      // gets said, and a label that explains nothing is inflation. Left off both,
      // which is what the pair constraint permits.
      { id: 'L2-01', level: 2, cat: 'work', answer: 'think',
        situation: 'Your friend practised a song for weeks. At the concert they sang some notes wrong, and you heard it.',
        utterance: 'You sang some notes wrong.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', truthRank: 'true' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Think it. It is true, but true is not as important as kind - it would take away all the good they feel about the concert.' },
      // "and others can hear, and it is not fixable". Both labels needed the
      // situation to say so: the classroom around them is now written in, and
      // the spot is a thing no child can put right where they are standing.
      { id: 'L2-03', level: 2, cat: 'private', answer: 'think',
        situation: 'Your close friend is beside you, and the other kids around you would hear anything you say. They look embarrassed and are holding a hand over a spot on their skirt.',
        utterance: 'There is a spot on your skirt.', sayVerb: 'say', object: 'these words',
        features: { privacy: 'private', relationship: 'close-friend', audience: 'others-hear',
                    changeability: 'not-fixable', selfEsteem: 'hurts' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'statement' },
        reason: 'Think it. They already know, and they are trying to keep it private. There is nothing they can do about it here, and the kids around you would all hear - so saying it would only make your close friend feel worse.' },
      { id: 'L2-02', level: 2, cat: 'kind', answer: 'say',
        situation: 'Your friend practised a song for weeks. At the concert they remembered every single word, and you heard it.',
        utterance: 'You remembered every word.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', truthRank: 'true' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Say it! It is true and it is kind - here true and kind point the same way, and telling them what went well helps them want to try again.' },
      // "also help-or safety. A lot of these are missing cross labels". The
      // label is the headline finding, and it costs this card its pair: a card
      // declaring override: 'help-or-safety' can sit in no pair but the override
      // one (RESEARCH.md §5.4), so the privacy pair moved to L2-05/L2-20.
      { id: 'L2-04', level: 2, cat: 'other', answer: 'say',
        situation: 'Your close friend is beside you. A sticker has come loose on their bag and is about to fall off. They have not noticed.',
        utterance: 'There is a sticker falling off your bag.', sayVerb: 'say', object: 'these words',
        features: { privacy: 'not-private', relationship: 'close-friend', override: 'help-or-safety' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'statement' },
        reason: 'Say it. Nothing about it is private, and your close friend needs the help right now - one more step and the sticker is gone for good.' },

      // ── block 2 ──
      // "self-esteeme: hurts" on the haircut card. The label cannot live on one
      // half of a pair, so it is carried by all four cards of the L2-05 cluster
      // below - and it is honest on all four, because the sting is the same
      // words on the same person every time. What moves is whether they can do
      // anything about it (L2-06), who can hear it (L2-07), and whether it was
      // a private thing to have noticed at all (L2-20).
      { id: 'L2-06', level: 2, cat: 'looks', answer: 'think',
        situation: 'You are sitting right beside your friend at lunch. Nobody else can hear you. They got a new haircut yesterday and it looks strange to you.',
        utterance: 'Your haircut looks strange.', sayVerb: 'say', object: 'these words',
        features: { changeability: 'not-fixable', audience: 'just-them',
                    privacy: 'not-private', selfEsteem: 'hurts' },
        vary: { setting: 'school', person: 'peer', topic: 'looks', form: 'statement' },
        reason: 'Think it. A haircut is not a private thing and nobody else could hear you - but they cannot change their hair today, so it would only hurt.' },
      { id: 'L2-07', level: 2, cat: 'other', answer: 'think',
        situation: 'You are all the way across the lunchroom from your friend, with a lot of people in between. They have a bit of spinach stuck in their teeth.',
        utterance: 'You have something in your teeth!', sayVerb: 'say', object: 'these words',
        features: { audience: 'others-hear', changeability: 'fixable-now',
                    privacy: 'not-private', selfEsteem: 'hurts' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'exclamation' },
        reason: 'Think it. It is not a private thing and they could fix it - but calling it across the room means everyone hears, and that embarrasses them.' },
      { id: 'L2-05', level: 2, cat: 'kind', answer: 'say',
        situation: 'You are sitting right beside your friend at lunch. Nobody else can hear you. They have a bit of spinach stuck in their teeth.',
        utterance: 'You have something in your teeth.', sayVerb: 'say', object: 'these words',
        features: { changeability: 'fixable-now', audience: 'just-them',
                    privacy: 'not-private', selfEsteem: 'hurts' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Say it - quietly, just to them. Nobody enjoys hearing it, but it is not a private thing, they can fix it right now, and nobody else hears - so it helps far more than it stings.' },
      // The relationship pair holds TIMING constant at right-moment, so the pair
      // says what it means: on both cards there is time to talk and the thing is
      // private, and only who the person is decides the answer. On this card the
      // right moment is one the friend MADE by showing it - that invitation is
      // the nuance, and it is coded, not left to the prose.
      { id: 'L2-09', level: 2, cat: 'kind', answer: 'say',
        situation: 'Your close friend is beside you at lunch. They hold up their arm to show you a new bandage, and they wait for you to say something.',
        utterance: 'How did you get that?', sayVerb: 'ask', object: 'this question',
        features: { relationship: 'close-friend', privacy: 'private', timing: 'right-moment' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'question' },
        reason: 'Say it. A bandage is a private thing, but your close friend held it up to show you and is waiting - they opened it up, so right now is the moment to ask.' },

      // ── block 3 ──
      { id: 'L2-08', level: 2, cat: 'private', answer: 'think',
        situation: 'A person you have never met is in the shop line in front of you, and the line has stopped moving. You can see a scar on their arm and you are curious.',
        utterance: 'How did you get that?', sayVerb: 'ask', object: 'this question',
        features: { relationship: 'stranger', privacy: 'private', timing: 'right-moment' },
        vary: { setting: 'shop', person: 'stranger', topic: 'body', form: 'question' },
        reason: 'Think it. There is plenty of time, so nothing is wrong with the moment. What is wrong is that you do not know them, and their body is private. Being curious is fine, asking is not.' },
      { id: 'L2-10', level: 2, cat: 'other', answer: 'think',
        situation: 'Your friend is in the middle of their turn in the class play. You are right beside them and only they could hear you. Their shirt is on inside out.',
        utterance: 'Your shirt is inside out.', sayVerb: 'say', object: 'these words',
        features: { timing: 'wrong-moment', audience: 'just-them', changeability: 'fixable-now' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'statement' },
        reason: 'Think it for now. They could turn it around in a second - but they are in the middle of their turn, so this can wait one minute.' },
      { id: 'L2-11', level: 2, cat: 'other', answer: 'say',
        situation: 'Your friend has finished their turn in the class play. You are right beside them and only they can hear you. Their shirt is on inside out.',
        utterance: 'Your shirt is inside out.', sayVerb: 'say', object: 'these words',
        features: { timing: 'right-moment', audience: 'just-them', changeability: 'fixable-now' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'statement' },
        reason: 'Say it - quietly, now that they are finished. They can turn it around right away, and this is the right moment.' },
      { id: 'L2-12', level: 2, cat: 'other', answer: 'say',
        situation: 'A classmate once told you privately that they get very bad headaches, and that when a bad one starts they go pale and hold their head. Right now they have gone pale, they are holding their head, and they cannot stand up.',
        utterance: 'My classmate needs help.', sayVerb: 'tell', object: 'this news',
        features: { override: 'help-or-safety', privacy: 'private' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Say it! It was private - but this is exactly what they told you a bad headache looks like, they need help right now, and help always comes first.' },

      // ── block 4 ──
      { id: 'L2-13', level: 2, cat: 'private', answer: 'think',
        situation: 'A classmate once told you privately that they get very bad headaches, and that when a bad one starts they go pale and hold their head. Right now they are not pale at all, and they are playing with everyone else.',
        utterance: 'My classmate gets bad headaches.', sayVerb: 'tell', object: 'this news',
        features: { override: 'none', privacy: 'private' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Think it. Nobody needs help right now, so their private news stays theirs to tell.' },
      // The audit found selfEsteem: 'hurts' on L2-14 - its own reason says "so it
      // only hurts" - and it cannot be declared. The defeater pair holds
      // truthRank constant and flips changeability, so L2-15 would have to
      // carry the same label, and paint on a hand does not hurt anybody's
      // self-esteem. The label is left off and recorded here rather than dropped
      // silently (RESEARCH.md §5.4).
      { id: 'L2-14', level: 2, cat: 'looks', answer: 'think',
        situation: 'Your class lines up by height for a photo. Your classmate ends up right at the short end, and you can see for yourself that they are the shortest in the class.',
        utterance: 'You are the shortest in the class.', sayVerb: 'say', object: 'these words',
        features: { truthRank: 'true', changeability: 'not-fixable' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Think it. You can see for yourself that it is true, but true is not as important as kind, because nobody is unsafe and there is nothing they can do about how tall they are.' },
      { id: 'L2-15', level: 2, cat: 'other', answer: 'say',
        situation: 'Your classmate comes back from the painting table with a big smudge of paint on their hand, and the sink is right beside them.',
        utterance: 'You have paint on your hand.', sayVerb: 'say', object: 'these words',
        features: { truthRank: 'true', changeability: 'fixable-now' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Say it. You can see for yourself that it is true - and here true matters more, because they can wash it off right now.' },
      { id: 'L2-18', level: 2, cat: 'other', answer: 'say',
        situation: 'You see a classmate look all around the room, then take something out of another kid’s bag and put it in their own pocket.',
        utterance: 'I need to tell you something.', sayVerb: 'tell', object: 'this news',
        features: { override: 'help-or-safety', relationship: 'grown-up' },
        vary: { setting: 'school', person: 'teacher', topic: 'belongings', form: 'statement' },
        reason: 'Say it! When something is not safe or not fair, telling a grown-up is the right thing.' },

      // ── block 5 ──
      { id: 'L2-16', level: 2, cat: 'work', answer: 'think',
        situation: 'Your friend shows you their new backpack. You do not like how it looks.',
        utterance: 'I do not like that backpack.', sayVerb: 'say', object: 'these words',
        // "also not fixable, and liking is not help or safety."
        features: { selfEsteem: 'hurts', relationship: 'close-friend',
                    changeability: 'not-fixable', override: 'none' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'statement' },
        reason: 'Think it. They love their backpack, and these words would hurt their feelings. Nobody needs help and nothing is unsafe here - and the backpack they have today is not one they can change.' },
      { id: 'L2-17', level: 2, cat: 'other', answer: 'think',
        situation: 'Your class is in the middle of a quiet test. You have just noticed that your teacher’s tie looks funny to you.',
        utterance: 'Your tie looks funny!', sayVerb: 'say', object: 'these words',
        features: { timing: 'wrong-moment', audience: 'others-hear', selfEsteem: 'hurts' },
        vary: { setting: 'school', person: 'teacher', topic: 'belongings', form: 'exclamation' },
        reason: 'Think it. Everyone is working quietly, so calling it out would interrupt the whole class - and it would make your teacher feel silly in front of everybody.' },
      { id: 'L2-21', level: 2, cat: 'kind', answer: 'say',
        situation: 'Your teacher got a new haircut and you really like it. You are standing right beside her.',
        utterance: 'I like your haircut!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', relationship: 'grown-up' },
        vary: { setting: 'school', person: 'teacher', topic: 'looks', form: 'exclamation' },
        reason: 'Say it! A kind compliment is a nice thing to share.' },
      { id: 'L2-28', level: 2, cat: 'other', answer: 'say',
        situation: 'A classmate took your turn by accident. The game has stopped and everyone is waiting.',
        utterance: 'It is my turn now, please.', sayVerb: 'say', object: 'these words',
        features: { timing: 'right-moment', relationship: 'classmate',
                    privacy: 'not-private', audience: 'others-hear' },
        vary: { setting: 'playground', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Say it. Whose turn it is, is not a private thing, and everyone waiting needs to hear it - speaking up kindly about your turn is fair, and this is the right moment.' },

      // ── block 6 ──
      { id: 'L2-22', level: 2, cat: 'looks', answer: 'think',
        situation: 'Your grandma comes to visit. She has some hair missing on her head.',
        utterance: 'You do not have much hair.', sayVerb: 'say', object: 'these words',
        // "not fixable, either"
        features: { selfEsteem: 'hurts', relationship: 'grown-up', changeability: 'not-fixable' },
        vary: { setting: 'home', person: 'family', topic: 'looks', form: 'statement' },
        reason: 'Think it. Saying it might make Grandma feel sad, and her hair is not something she can change.' },
      { id: 'L2-19', level: 2, cat: 'smells', answer: 'think',
        situation: 'A grown-up bends down to help you and you notice their breath.',
        utterance: 'Your breath smells.', sayVerb: 'say', object: 'these words',
        // "and not fixable right now"
        features: { selfEsteem: 'hurts', relationship: 'grown-up', changeability: 'not-fixable' },
        vary: { setting: 'school', person: 'teacher', topic: 'smell', form: 'statement' },
        reason: 'Think it. Saying it would be embarrassing for them, and there is nothing they can do about their breath right now.' },
      // L2-22's partner on changeability: the same grandma and the same hair, and
      // the only thing that moves is whether she can do something about it now.
      { id: 'L2-37', level: 2, cat: 'looks', answer: 'say',
        situation: 'Your grandma comes to visit. She has been out in the garden, and there is a leaf stuck in her hair.',
        utterance: 'You have a leaf in your hair.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', relationship: 'grown-up', changeability: 'fixable-now' },
        vary: { setting: 'home', person: 'family', topic: 'looks', form: 'statement' },
        reason: 'Say it - kindly. It might make Grandma feel a little silly, but she can pull it out right now, and a grown-up in your family would want you to tell her.' },
      { id: 'L2-42', level: 2, cat: 'work', answer: 'say',
        situation: 'Your teacher finishes showing the class a new kind of math problem and asks if anyone has a question. You did not understand the second step.',
        utterance: 'I do not understand the second step.', sayVerb: 'say', object: 'these words',
        features: { relationship: 'grown-up', timing: 'right-moment' },
        vary: { setting: 'school', person: 'teacher', topic: 'work', form: 'statement' },
        reason: 'Say it. Your teacher is the grown-up whose job is to help you learn, and she just asked for questions - so this is the right moment, and she can only help if she knows.' },

      // ── block 7 ──
      { id: 'L2-27', level: 2, cat: 'other', answer: 'think',
        situation: 'A baby on the bus is crying very loudly, and the baby’s family is right there.',
        utterance: 'That baby is so loud!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', audience: 'others-hear' },
        vary: { setting: 'bus', person: 'family', topic: 'body', form: 'exclamation' },
        reason: 'Think it. The baby’s family can hear you, and saying it would make them feel bad.' },
      // "never met is a stranger, so taht is another reason to not ask...". The
      // relationship was already labelled; what was missing is that the REASON
      // never said it, so the card taught the hurt and not the stranger.
      { id: 'L2-25', level: 2, cat: 'looks', answer: 'think',
        situation: 'A man you have never met is on the bus, and he is very, very tall.',
        utterance: 'You are so tall!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', relationship: 'stranger', changeability: 'not-fixable' },
        vary: { setting: 'bus', person: 'stranger', topic: 'looks', form: 'exclamation' },
        reason: 'Think it. Pointing out how someone’s body looks can embarrass them, and how tall he is, is not something he can change. You have never met him either, so he is a stranger - that is one more reason to keep it in your head.' },
      // L2-27's partner on self-esteem: the same bus and the same family listening,
      // so being heard is held constant and only hurt against lift decides.
      { id: 'L2-36', level: 2, cat: 'kind', answer: 'say',
        situation: 'A baby on the bus is smiling and waving at you, and the baby’s family is right there.',
        utterance: 'That baby is so cute!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', audience: 'others-hear' },
        vary: { setting: 'bus', person: 'family', topic: 'looks', form: 'exclamation' },
        reason: 'Say it! The baby’s family can hear you - and this time that is a good thing, because these kind words would make them feel happy.' },
      { id: 'L2-44', level: 2, cat: 'other', answer: 'say',
        situation: 'You are riding the bus to the library for the first time. The bus has stopped and the driver is waiting for people to get on. You are not sure if this is your stop.',
        utterance: 'Is this the stop for the library?', sayVerb: 'ask', object: 'this question',
        features: { relationship: 'stranger', timing: 'right-moment' },
        vary: { setting: 'bus', person: 'stranger', topic: 'work', form: 'question' },
        reason: 'Say it. You do not know the driver, but helping riders find their stop is part of the job, and the bus is stopped - so this is the right moment to ask.' },

      // ── block 8 ──
      // The privacy pair, re-pointed off L2-03/L2-04 and onto the L2-05 cluster:
      // same lunch table, same quiet voice, same thing they could put right in a
      // second - and only whether it was a private thing to notice decides.
      { id: 'L2-20', level: 2, cat: 'private', answer: 'think',
        situation: 'You are sitting right beside your friend at lunch. Nobody else can hear you, and nobody else has seen. They are picking their nose.',
        utterance: 'I saw you picking your nose.', sayVerb: 'say', object: 'these words',
        features: { privacy: 'private', audience: 'just-them',
                    changeability: 'fixable-now', selfEsteem: 'hurts' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Think it. They could stop in a second and nobody else saw - but this one is private, and saying it out loud would embarrass them.' },
      { id: 'L2-26', level: 2, cat: 'private', answer: 'think',
        situation: 'A classmate pulls up their pants in the line and you see their underwear. Other kids are all around.',
        utterance: 'I saw your underwear.', sayVerb: 'say', object: 'these words',
        features: { privacy: 'private', audience: 'others-hear', selfEsteem: 'hurts' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Think it. That is private - saying it with everyone around would embarrass them.' },
      { id: 'L2-46', level: 2, cat: 'other', answer: 'say',
        situation: 'You and the kid from next door are walking to the playground, and nobody else is near. The zip on the back of their backpack is open.',
        utterance: 'Your backpack is open.', sayVerb: 'say', object: 'these words',
        features: { changeability: 'fixable-now', audience: 'just-them', privacy: 'not-private' },
        vary: { setting: 'playground', person: 'peer', topic: 'belongings', form: 'statement' },
        reason: 'Say it. It is not private, they can zip it right now, and nobody else is around to hear.' },
      // L2-08's partner on privacy: the same stranger in the same stopped line, and
      // only whether the thing you noticed is private moves. A stranger is a reason
      // to hold back, not a rule that you never speak.
      { id: 'L2-29', level: 2, cat: 'other', answer: 'say',
        situation: 'A person you have never met is in the shop line in front of you, and the line has stopped moving. Their glove has just fallen out of their pocket onto the floor.',
        utterance: 'You dropped your glove.', sayVerb: 'say', object: 'these words',
        features: { relationship: 'stranger', privacy: 'not-private', timing: 'right-moment' },
        vary: { setting: 'shop', person: 'stranger', topic: 'belongings', form: 'statement' },
        reason: 'Say it. You do not know them, but a dropped glove is not a private thing, and the line has stopped so there is time - telling them helps them get it back.' },

      // ── block 9 ──
      { id: 'L2-23', level: 2, cat: 'looks', answer: 'think',
        situation: 'You see a kid at school. They have a really big tummy.',
        utterance: 'You have a big tummy.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', changeability: 'not-fixable' },
        vary: { setting: 'school', person: 'peer', topic: 'looks', form: 'statement' },
        reason: 'Think it. Talking about how someone’s body looks can hurt their feelings.' },
      { id: 'L2-24', level: 2, cat: 'looks', answer: 'think',
        situation: 'Your teacher is wearing pants that look really silly to you.',
        utterance: 'Those pants look funny.', sayVerb: 'say', object: 'these words',
        // "not changeable in that moment"
        features: { selfEsteem: 'hurts', relationship: 'grown-up', changeability: 'not-fixable' },
        vary: { setting: 'school', person: 'teacher', topic: 'belongings', form: 'statement' },
        reason: 'Think it. It would make your teacher feel bad, and she cannot change what she is wearing in the middle of the school day.' },
      { id: 'L2-43', level: 2, cat: 'other', answer: 'say',
        situation: 'You are at your close friend’s house. They ask which game you want to play next, their racing game or their building game. You like the building game better.',
        utterance: 'I would rather play the building game.', sayVerb: 'say', object: 'these words',
        features: { relationship: 'close-friend', timing: 'right-moment' },
        vary: { setting: 'home', person: 'peer', topic: 'belongings', form: 'statement' },
        reason: 'Say it - kindly. Your close friend asked you, so now is the right moment, and saying what you like, politely, is not unkind.' },
      { id: 'L2-45', level: 2, cat: 'other', answer: 'say',
        situation: 'You are in a big shop and you cannot see your mom anywhere. A worker wearing a name badge is standing at the counter.',
        utterance: 'I cannot find my mom.', sayVerb: 'tell', object: 'this news',
        features: { override: 'help-or-safety', relationship: 'stranger' },
        vary: { setting: 'shop', person: 'stranger', topic: 'body', form: 'statement' },
        reason: 'Say it! You do not know the worker, but you are lost and need help - and a worker at their job is a safe person to tell. Help always comes first.' },

      // ── block 10 ──
      // The L2-30/L2-31 pair: the same sister at the same bad moment, and only
      // whether something is unsafe decides. Safety outranks a bad moment.
      { id: 'L2-30', level: 2, cat: 'smells', answer: 'think',
        situation: 'Your big sister is in the middle of a hard level of her video game, and she asked not to be bothered. You smell the popcorn she made, and you want some.',
        utterance: 'Can I have some popcorn?', sayVerb: 'ask', object: 'this question',
        features: { override: 'none', timing: 'wrong-moment' },
        vary: { setting: 'home', person: 'sibling', topic: 'smell', form: 'question' },
        reason: 'Think it for now. Nobody needs help and nothing is unsafe, and she is in the middle of her game - asking can wait until she finishes.' },
      // Same shape as L2-30/L2-31 on a different field: the coach is busy either
      // way, and only being hurt turns the wrong moment into the right one.
      { id: 'L2-32', level: 2, cat: 'other', answer: 'think',
        situation: 'You are in the middle of a soccer game at the park, and your coach is busy calling out to the players. You are bored of your spot on the field and want to try a different one.',
        utterance: 'Coach, can I play a different spot?', sayVerb: 'ask', object: 'this question',
        features: { override: 'none', timing: 'wrong-moment' },
        vary: { setting: 'playground', person: 'teacher', topic: 'work', form: 'question' },
        reason: 'Think it for now. Nobody is hurt and nothing is unsafe, and your coach is busy running the game - this can wait until the break.' },
      { id: 'L2-31', level: 2, cat: 'smells', answer: 'say',
        situation: 'Your big sister is in the middle of a hard level of her video game, and she asked not to be bothered. You smell burning, and smoke is coming from a pan on the stove.',
        utterance: 'The pan on the stove is smoking!', sayVerb: 'say', object: 'these words',
        features: { override: 'help-or-safety', timing: 'wrong-moment' },
        vary: { setting: 'home', person: 'sibling', topic: 'smell', form: 'exclamation' },
        reason: 'Say it! She asked not to be bothered, and she is in the middle of her game - but smoke on the stove is not safe, and safety always comes first.' },
      { id: 'L2-33', level: 2, cat: 'other', answer: 'say',
        situation: 'You are in the middle of a soccer game at the park, and your coach is busy calling out to the players. You twisted your ankle, and it hurts every time you run.',
        utterance: 'Coach, I hurt my ankle.', sayVerb: 'tell', object: 'this news',
        features: { override: 'help-or-safety', timing: 'wrong-moment' },
        vary: { setting: 'playground', person: 'teacher', topic: 'body', form: 'statement' },
        reason: 'Say it! It is the middle of the game and your coach is busy - but you are hurt, and getting help always comes first.' },

      // ── block 11 ──
      // The L2-34/L2-35 pair is the lunch-table audience contrast moved onto the
      // bus with a cousin: same tag, same quick fix, and only who can hear moves.
      { id: 'L2-34', level: 2, cat: 'looks', answer: 'think',
        situation: 'Your cousin is sitting at the very front of the bus, and you are at the back with lots of kids in between. The tag on the back of her shirt is sticking up.',
        utterance: 'Your tag is sticking out!', sayVerb: 'say', object: 'these words',
        features: { audience: 'others-hear', changeability: 'fixable-now', privacy: 'not-private' },
        vary: { setting: 'bus', person: 'family', topic: 'belongings', form: 'exclamation' },
        reason: 'Think it for now. It is not private and she could fix it in a second - but you would have to call it down the whole bus, and everybody would hear. Tell her quietly when you get off.' },
      // The L2-38/L2-39 pair: the same promise and the same grown-up asking. A
      // secret is kept until keeping it would leave someone unsafe.
      { id: 'L2-38', level: 2, cat: 'private', answer: 'think',
        situation: 'Your cousin tells you a secret and makes you promise not to tell: she still sleeps with a night-light. Later your mom asks what you two were whispering about.',
        utterance: 'She still sleeps with a night-light.', sayVerb: 'tell', object: 'this news',
        features: { override: 'none', privacy: 'private' },
        vary: { setting: 'home', person: 'family', topic: 'belongings', form: 'statement' },
        reason: 'Think it. It is private, and nobody needs help or is unsafe - so her secret stays hers to tell.' },
      { id: 'L2-35', level: 2, cat: 'looks', answer: 'say',
        situation: 'Your cousin is sitting right beside you on the bus, and nobody else can hear you. The tag on the back of her shirt is sticking up.',
        utterance: 'Your tag is sticking out.', sayVerb: 'say', object: 'these words',
        features: { audience: 'just-them', changeability: 'fixable-now', privacy: 'not-private' },
        vary: { setting: 'bus', person: 'family', topic: 'belongings', form: 'statement' },
        reason: 'Say it - quietly, just to her. It is not private, she can tuck it in right now, and nobody else can hear.' },
      { id: 'L2-39', level: 2, cat: 'private', answer: 'say',
        situation: 'Your cousin tells you a secret and makes you promise not to tell: she is going to walk to the lake by herself tonight, after everyone is asleep. Later your mom asks what you two were whispering about.',
        utterance: 'She is going to the lake alone tonight.', sayVerb: 'tell', object: 'this news',
        features: { override: 'help-or-safety', privacy: 'private' },
        vary: { setting: 'home', person: 'family', topic: 'body', form: 'statement' },
        reason: 'Say it! You promised to keep it secret - but she could get hurt, and when someone might not be safe, telling a grown-up comes before any promise.' },

      // ── tail ──
      // A second truthRank defeater, at home: the same picture and both remarks
      // true, so truth is held constant and only whether it hurts or lifts decides.
      // The lesson is to pick the true thing that is also kind.
      { id: 'L2-40', level: 2, cat: 'work', answer: 'think',
        situation: 'Your little brother spent all afternoon drawing your dog, and he gives you the picture. It does not look much like your dog.',
        utterance: 'That does not look like our dog.', sayVerb: 'say', object: 'these words',
        features: { truthRank: 'true', selfEsteem: 'hurts' },
        vary: { setting: 'home', person: 'sibling', topic: 'work', form: 'statement' },
        reason: 'Think it. It really does not look like him, but true is not as important as kind - he worked all afternoon, and these words would take away the good he feels.' },
      { id: 'L2-41', level: 2, cat: 'work', answer: 'say',
        situation: 'Your little brother spent all afternoon drawing your dog, and he gives you the picture. It does not look much like your dog, but you watched him work on it the whole time.',
        utterance: 'You worked so hard on this!', sayVerb: 'say', object: 'these words',
        features: { truthRank: 'true', selfEsteem: 'lifts' },
        vary: { setting: 'home', person: 'sibling', topic: 'work', form: 'exclamation' },
        reason: 'Say it! You watched him work the whole time, so it is true - and here true and kind point the same way. Say the true thing that makes him feel good.' },
    ],
    pairs: [
      { dim: 'selfEsteem',    a: 'L2-01', b: 'L2-02' },
      // Was L2-03/L2-04. L2-04's help-or-safety label evicted it (§5.4), and
      // L2-03's three added labels could not be met by any SAY card in the pool
      // - so the pair moved to the lunch table, where privacy is the only thing
      // that moves.
      { dim: 'privacy',       a: 'L2-20', b: 'L2-05' },
      { dim: 'changeability', a: 'L2-05', b: 'L2-06' },
      // The maintainer's worked example: same words, same fixable problem, and
      // only who can hear is different.
      { dim: 'audience',      a: 'L2-05', b: 'L2-07' },
      { dim: 'relationship',  a: 'L2-08', b: 'L2-09' },
      { dim: 'timing',        a: 'L2-10', b: 'L2-11' },
      { dim: 'override',      a: 'L2-12', b: 'L2-13' },
      { dim: 'truthRank',  a: 'L2-14', b: 'L2-15', kind: 'defeater' },
      // Further matched pairs, one per new contrast. The eight above are the
      // pool's required set; these repeat dimensions across fresh settings and
      // people so no one scene carries a contrast alone.
      { dim: 'privacy',       a: 'L2-08', b: 'L2-29' },
      { dim: 'override',      a: 'L2-31', b: 'L2-30' },
      { dim: 'override',      a: 'L2-33', b: 'L2-32' },
      { dim: 'override',      a: 'L2-39', b: 'L2-38' },
      { dim: 'audience',      a: 'L2-35', b: 'L2-34' },
      { dim: 'selfEsteem',    a: 'L2-36', b: 'L2-27' },
      { dim: 'changeability', a: 'L2-37', b: 'L2-22' },
      { dim: 'truthRank',     a: 'L2-40', b: 'L2-41', kind: 'defeater' },
    ],
  };
})(typeof window !== 'undefined' ? window : globalThis);
