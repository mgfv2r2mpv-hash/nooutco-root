/* ── Think or Say? — Level 3 "Explain" ─────────────────────────────────
   Its own pool, authored so the REASON is the teaching target. After the
   learner taps a tile the game asks for the reason, and on reveal it offers
   2-4 exemplar rationales written in deictic I-YOU terms (PEAK-T; Belisle et
   al. 2016 — RESEARCH.md §4.3).

   The exemplars are EXEMPLARS, never a scoring key. The technician scores what
   the learner actually said as Correct / Partly correct / Not yet, plus an
   optional note. A correct reason nobody wrote down here is the ideal outcome
   and scores fully Correct.

   Content rule and ORDER IS DATA: see cards-level-1.js. This pool runs
   THINK, THINK, SAY, SAY in blocks of four, then a THINK tail.
   ----------------------------------------------------------------------- */
(function (global) {
  'use strict';

  global.ThinkOrSayLevel3 = {
    id: 3,
    name: 'Explain',
    blurb: 'The reason is the target — the learner says why, and you score what they said.',
    cards: [
      // ── block 1 ──
      { id: 'L3-01', level: 3, cat: 'work', answer: 'think',
        situation: 'A classmate reads out loud in class and gets stuck on a lot of the words.',
        utterance: 'You got stuck a lot.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', relationship: 'classmate' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Think it. They already know it was hard — saying it would make them feel worse about reading.',
        rationales: [
          'If I said it, you would feel bad about your reading.',
          'You already know you got stuck, so telling you does not help you.',
          'I can keep it in my head and still be a good friend to you.',
        ] },
      { id: 'L3-03', level: 3, cat: 'private', answer: 'think',
        situation: 'You and your friend are on your own. They once told you that they see a special doctor to talk about their feelings.',
        utterance: 'You see a feelings doctor.', sayVerb: 'say', object: 'these words',
        features: { privacy: 'private', audience: 'just-them' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Think it. They told you in private — it is theirs to tell, not yours.',
        rationales: [
          'You told me that in private, so it is yours to tell, not mine.',
          'If I said it, you might not trust me with anything again.',
        ] },
      { id: 'L3-02', level: 3, cat: 'kind', answer: 'say',
        situation: 'A classmate reads out loud in class and finishes the whole page.',
        utterance: 'You read the whole page!', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'lifts', relationship: 'classmate' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'exclamation' },
        reason: 'Say it! Telling someone what went well makes them feel proud and want to try again.',
        rationales: [
          'If I say it, you would feel proud of your reading.',
          'Telling you what you did well helps you want to read again.',
        ] },
      { id: 'L3-04', level: 3, cat: 'kind', answer: 'say',
        situation: 'You and your friend are on your own. They once told you, all excited, that they got a new bike.',
        utterance: 'You got a new bike!', sayVerb: 'say', object: 'these words',
        features: { privacy: 'not-private', audience: 'just-them' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'exclamation' },
        reason: 'Say it! This is happy news they were pleased to share, so talking about it is kind.',
        rationales: [
          'You were excited to tell me, so you would like me being interested.',
          'This is happy news, not a private thing, so saying it does not hurt you.',
        ] },

      // ── block 2 ──
      { id: 'L3-06', level: 3, cat: 'looks', answer: 'think',
        situation: 'You and your friend are on your own in the hallway. You have noticed that their front teeth stick out.',
        utterance: 'Your teeth stick out.', sayVerb: 'say', object: 'these words',
        features: { changeability: 'not-fixable', audience: 'just-them' },
        vary: { setting: 'school', person: 'peer', topic: 'looks', form: 'statement' },
        reason: 'Think it. There is nothing they can do about their teeth today, so it would only hurt.',
        rationales: [
          'You cannot change your teeth today, so telling you only makes you feel bad.',
          'It would not help you — it would just hurt you.',
        ] },
      { id: 'L3-07', level: 3, cat: 'other', answer: 'think',
        situation: 'You and your friend are in the middle of a crowded assembly. The label on their sweater is sticking up at the back.',
        utterance: 'Your label is sticking up!', sayVerb: 'say', object: 'these words',
        features: { audience: 'others-hear', changeability: 'fixable-now' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'exclamation' },
        reason: 'Think it for now. They could fix it — but everyone would hear, so wait until you are on your own.',
        rationales: [
          'Everyone would hear me, and you would feel embarrassed.',
          'I can wait until we are on our own and tell you then.',
        ] },
      { id: 'L3-05', level: 3, cat: 'other', answer: 'say',
        situation: 'You and your friend are on your own in the hallway. The label on their sweater is sticking up at the back.',
        utterance: 'Your label is sticking up.', sayVerb: 'say', object: 'these words',
        features: { changeability: 'fixable-now', audience: 'just-them' },
        vary: { setting: 'school', person: 'peer', topic: 'belongings', form: 'statement' },
        reason: 'Say it. They can fix it right now and nobody else hears, so telling them helps.',
        rationales: [
          'You can fix it right now, so telling you helps you.',
          'I would want you to tell me if my label was sticking up.',
        ] },
      { id: 'L3-08', level: 3, cat: 'kind', answer: 'say',
        situation: 'Your close friend is sitting beside you and looks like they have been crying.',
        utterance: 'Are you okay?', sayVerb: 'ask', object: 'this question',
        features: { relationship: 'close-friend', privacy: 'private' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'question' },
        reason: 'Say it. Asking a close friend gently shows you care, and they can choose what to tell you.',
        rationales: [
          'You are my close friend, so asking gently shows I care about you.',
          'You can choose to tell me or not — I am only asking, not telling everyone.',
        ] },

      // ── block 3 ──
      { id: 'L3-09', level: 3, cat: 'private', answer: 'think',
        situation: 'A person you have never met is sitting near you on the bus. They look like they have been crying and they have turned away from everyone.',
        utterance: 'Are you okay?', sayVerb: 'ask', object: 'this question',
        features: { relationship: 'stranger', privacy: 'private' },
        vary: { setting: 'bus', person: 'stranger', topic: 'body', form: 'question' },
        reason: 'Think it. You do not know them and they turned away — tell your own grown-up instead.',
        rationales: [
          'I do not know you, and you turned away, so you may want to be left alone.',
          'I can tell my grown-up instead of asking you myself.',
        ] },
      { id: 'L3-10', level: 3, cat: 'other', answer: 'think',
        situation: 'Your teacher is in the middle of helping another child with a hard problem. You want to tell her about your weekend.',
        utterance: 'I went to the lake!', sayVerb: 'tell', object: 'this news',
        features: { timing: 'wrong-moment', relationship: 'grown-up' },
        vary: { setting: 'school', person: 'teacher', topic: 'work', form: 'exclamation' },
        reason: 'Think it for now. She is helping someone — your news can wait a minute.',
        rationales: [
          'She is busy helping someone right now, so my news can wait.',
          'If I say it now, she has to stop helping them.',
        ] },
      { id: 'L3-11', level: 3, cat: 'kind', answer: 'say',
        situation: 'Your teacher has finished helping and asks whether anyone has news to share. You want to tell her about your weekend.',
        utterance: 'I went to the lake!', sayVerb: 'tell', object: 'this news',
        features: { timing: 'right-moment', relationship: 'grown-up' },
        vary: { setting: 'school', person: 'teacher', topic: 'work', form: 'exclamation' },
        reason: 'Say it! She asked for news, so this is exactly the right moment.',
        rationales: [
          'She asked for news, so this is the right moment to tell her.',
          'Sharing happy news when someone asks for it is a kind thing to do.',
        ] },
      { id: 'L3-12', level: 3, cat: 'other', answer: 'say',
        situation: 'Your teacher is in the middle of helping another child. You can smell smoke coming from the hallway.',
        utterance: 'I can smell smoke!', sayVerb: 'tell', object: 'this news',
        features: { override: 'help-or-safety', timing: 'wrong-moment' },
        vary: { setting: 'school', person: 'teacher', topic: 'smell', form: 'exclamation' },
        reason: 'Say it! She is busy — but somebody could get hurt, and safety always comes first.',
        rationales: [
          'Somebody could get hurt, so this is more important than waiting.',
          'When it is about being safe, I say it straight away even if she is busy.',
        ] },

      // ── block 4 ──
      { id: 'L3-13', level: 3, cat: 'smells', answer: 'think',
        situation: 'Your teacher is in the middle of helping another child. You can smell somebody’s lunch and you do not like the smell.',
        utterance: 'That lunch smells gross!', sayVerb: 'say', object: 'these words',
        features: { override: 'none', timing: 'wrong-moment' },
        vary: { setting: 'school', person: 'teacher', topic: 'smell', form: 'exclamation' },
        reason: 'Think it. Nobody is in danger, she is busy, and it would hurt whoever brought that lunch.',
        rationales: [
          'Nobody is in danger, so I can wait — and it would hurt the person whose lunch it is.',
          'It is not important enough to stop her helping somebody else.',
        ] },
      { id: 'L3-14', level: 3, cat: 'private', answer: 'think',
        situation: 'It is true — you saw your classmate crying on their own in the bathroom this morning.',
        utterance: 'You were crying in the bathroom.', sayVerb: 'say', object: 'these words',
        features: { truthNotTest: 'true', privacy: 'private' },
        vary: { setting: 'school', person: 'peer', topic: 'body', form: 'statement' },
        reason: 'Think it. It being true does not make it yours to say — they went somewhere private for a reason.',
        rationales: [
          'It being true does not make it mine to say.',
          'You were on your own for a reason, so saying it would embarrass you.',
        ] },
      { id: 'L3-15', level: 3, cat: 'kind', answer: 'say',
        situation: 'It is true — you saw your classmate win the running race this morning, in front of everyone.',
        utterance: 'You won the race!', sayVerb: 'say', object: 'these words',
        features: { truthNotTest: 'true', privacy: 'not-private' },
        vary: { setting: 'playground', person: 'peer', topic: 'work', form: 'exclamation' },
        reason: 'Say it! It is true and it is not private, so saying it makes them feel good.',
        rationales: [
          'It is true, and everybody already saw it, so it is not a private thing.',
          'Saying it makes you feel good — true and kind go together here.',
        ] },
      { id: 'L3-17', level: 3, cat: 'other', answer: 'say',
        situation: 'A little kid at the park has climbed up high and cannot get down. No grown-up has noticed yet.',
        utterance: 'That kid needs help!', sayVerb: 'tell', object: 'this news',
        features: { override: 'help-or-safety', audience: 'others-hear' },
        vary: { setting: 'playground', person: 'stranger', topic: 'body', form: 'exclamation' },
        reason: 'Say it — loudly! Somebody could fall, so getting a grown-up straight away is right.',
        rationales: [
          'Somebody could fall, so I say it straight away and loudly.',
          'Getting a grown-up is the fastest way to help them.',
        ] },

      // ── tail ──
      { id: 'L3-16', level: 3, cat: 'other', answer: 'think',
        situation: 'Your friend gives you a present they chose themselves. It is something you already have at home.',
        utterance: 'I already have this.', sayVerb: 'say', object: 'these words',
        features: { selfEsteem: 'hurts', relationship: 'close-friend' },
        vary: { setting: 'home', person: 'family', topic: 'belongings', form: 'statement' },
        reason: 'Think it. They chose it for you — saying it would spoil how good they feel about giving it.',
        rationales: [
          'You chose it for me, so saying it would spoil how good you feel.',
          'I can say thank you out loud and keep the other part in my head.',
        ] },
      { id: 'L3-18', level: 3, cat: 'work', answer: 'think',
        situation: 'It is true — you counted, and your classmate got fewer stars than anybody else this week.',
        utterance: 'You got the fewest stars.', sayVerb: 'say', object: 'these words',
        features: { truthNotTest: 'true', selfEsteem: 'hurts' },
        vary: { setting: 'school', person: 'peer', topic: 'work', form: 'statement' },
        reason: 'Think it. True is not the test — it is true AND it would hurt, so it stays inside.',
        rationales: [
          'True is not the test. It is true AND it would hurt you.',
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
