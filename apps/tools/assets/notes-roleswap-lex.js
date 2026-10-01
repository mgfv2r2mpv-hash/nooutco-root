/*
 * notes-roleswap-lex.js - The word lists.
 *
 * One of the notes-roleswap-*.js scripts, loaded in this order, each a small IIFE
 * adding to the one window.NotesRoleswap namespace (see notes-roleswap.js, which
 * loads last and holds the public API):
 *   lex, values, rows, ctx, engine, then notes-roleswap.js
 * Ported from the sass-assistant roleswap engine (src/roleswap/*.mjs) with the
 * import/export lines turned into namespace reads and writes and nothing else
 * changed. Pure: no DOM, no storage, no network, no globals but NotesRoleswap.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var NS = root.NotesRoleswap = root.NotesRoleswap || {};

  // The word lists the role swap reads, and nothing else.
  //
  // Kept apart from the engine (`roleswap.mjs`) for the same reason `sensitive.mjs`
  // keeps TOO_COMMON apart from its matcher: every list here is a judgement about
  // English that he may want to widen, and a widening should be one line in one
  // file rather than a hunt through a pass.
  //
  // His ruling, admin mode, copy-out role swap: "Swap a mention only when it points
  // at the one specific person ... When the next word is unclear, leave generic."
  // So every list below is a list of things the engine can be SURE about. A word on
  // no list is unknown, and unknown always lands on the generic side.
  //
  // No imports.

  // The four standing rows, and the separate BCaBA row. His aliases: client words =
  // client, learner, student, patient; BT words = BT, RBT, behavior technician;
  // BCBA words = BCBA, behavior analyst. BCaBA is never mapped to the BCBA row, so
  // its word is a word of its own and "assistant behavior analyst" reads as another
  // person through the modifier rule rather than as a BCBA.
  const STANDING_ROLES = [
    { id: 'client', label: 'Client', words: ['client', 'learner', 'student', 'patient'] },
    { id: 'bt', label: 'BT', words: ['BT', 'RBT', 'behavior technician'] },
    { id: 'bcba', label: 'BCBA', words: ['BCBA', 'behavior analyst'] },
    { id: 'caregiver', label: 'Caregiver', words: ['caregiver', 'parent', 'guardian'] },
    { id: 'bcaba', label: 'BCaBA', words: ['BCaBA'] },
  ];

  // What the caregiver row also matches while its toggle is on. Off by default,
  // because "mom" in a note is sometimes the client's mother and sometimes
  // somebody else's.
  const CAREGIVER_KIN = ['mom', 'mother', 'dad', 'father'];

  // The dropdown that adds a row. Each kind only SUGGESTS what the row looks for;
  // he edits it. A suggestion is a starting point, never a rule.
  const ADD_KINDS = [
    { id: 'clinician', label: 'Clinician', looksFor: 'doctor' },
    { id: 'therapist', label: 'Therapist', looksFor: 'SLP' },
    { id: 'relative', label: 'Relative', looksFor: 'uncle' },
    { id: 'teacher', label: 'Teacher', looksFor: 'teacher' },
    { id: 'other', label: 'Other', looksFor: '' },
  ];

  // Words that make the next role word NOT one specific person.
  const INDEFINITE = new Set([
    'a', 'an', 'each', 'every', 'any', 'another', 'other', 'some', 'one', 'no', 'all', 'both',
    'most', 'many', 'several', 'few', 'either', 'neither', 'various', 'multiple',
    'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
    'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  ]);

  // A noun in front of a role word makes it somebody else's: "school BT", "clinic
  // BCBA", "peer parent". Words that are not nouns are not on this list, so a verb
  // before a role word ("asked parent") never reads as a modifier.
  const MODIFIER_NOUNS = new Set([
    'school', 'clinic', 'home', 'center', 'centre', 'peer', 'sibling', 'classmate', 'teacher',
    'neighbor', 'neighbour', 'friend', 'cousin', 'agency', 'district', 'hospital', 'daycare',
    'classroom', 'community', 'private', 'outside', 'former', 'previous', 'prior', 'new',
    'lead', 'senior', 'assistant', 'substitute', 'visiting', 'other', 'foster', 'step',
    'adult', 'child', 'teen', 'kindergarten', 'preschool', 'summer', 'camp', 'single',
  ]);

  // What may stand before a role word without being a modifier or a verb. It is
  // what lets the engine call a mention high confidence: the word before it is on
  // this list or on VERB_LEAD.
  const FUNCTION_WORDS = new Set([
    'the', 'this', 'that', 'these', 'those', 'his', 'her', 'their', 'my', 'our', 'your', 'its',
    'and', 'or', 'but', 'nor', 'so', 'yet', 'of', 'to', 'with', 'for', 'by', 'from', 'at', 'in',
    'on', 'as', 'if', 'when', 'than', 'whether', 'because', 'while', 'since', 'after', 'before',
    'until', 'per', 'via', 'about', 'during', 'near', 'into', 'onto', 'through', 'over', 'under',
    'between', 'around', 'toward', 'towards', 'within', 'without', 'regarding', 'throughout',
    'against', 'upon', 'across', 'behind', 'beside', 'then', 'also', 'both', 'not', 'only',
    'is', 'was', 'were', 'are', 'be', 'been', 'being', 'has', 'had', 'have', 'will', 'would',
    'can', 'could', 'should', 'may', 'might', 'must', 'did', 'does', 'do', 'shall', 'who',
    'which', 'whom', 'whose', 'what', 'where', 'how', 'there', 'here', 'just', 'still', 'again',
    'always', 'never', 'often', 'usually', 'later', 'now', 'today', 'yesterday', 'soon', 'too',
    'either', 'neither', 'even', 'ever', 'once', 'although', 'though', 'unless', 'whereas',
  ]);

  // Verbs that take a person as their object, so the word after one of them is a
  // person and not a modifier. Past tense and base form, because the draft is in
  // whichever tense he wrote it.
  const VERB_LEAD = new Set([
    'asked', 'ask', 'told', 'tell', 'met', 'meet', 'saw', 'see', 'called', 'call', 'emailed',
    'email', 'informed', 'inform', 'thanked', 'thank', 'trained', 'train', 'taught', 'teach',
    'helped', 'help', 'observed', 'observe', 'supervised', 'supervise', 'coached', 'coach',
    'reminded', 'remind', 'notified', 'notify', 'contacted', 'contact', 'texted', 'text',
    'praised', 'praise', 'prompted', 'prompt', 'redirected', 'redirect', 'escorted', 'escort',
    'greeted', 'greet', 'joined', 'join', 'said', 'say', 'noted', 'note', 'reported', 'report',
    'recommended', 'recommend', 'spoke', 'speak', 'talked', 'talk', 'discussed', 'discuss',
    'consulted', 'consult', 'updated', 'update', 'sent', 'send', 'gave', 'give', 'showed',
    'show', 'handed', 'hand', 'let', 'had', 'has', 'have', 'got', 'get', 'brought', 'bring',
    'walked', 'walk', 'took', 'take', 'left', 'leave', 'visited', 'visit', 'interviewed',
    'interview', 'cleared', 'confirmed', 'confirm', 'requested', 'request', 'by', 'with',
  ]);

  // What may follow a role word and still leave it standing for the person: a verb,
  // an auxiliary, a preposition, a conjunction. Anything on this list swaps.
  const NEXT_FUNCTION = new Set([
    'is', 'was', 'were', 'are', 'be', 'been', 'being', 'has', 'had', 'have', 'will', 'would',
    'can', 'could', 'should', 'may', 'might', 'must', 'did', 'does', 'do', 'shall',
    'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'about', 'during', 'after',
    'before', 'near', 'into', 'onto', 'through', 'over', 'under', 'between', 'around', 'as',
    'per', 'via', 'toward', 'towards', 'within', 'without', 'regarding', 'throughout',
    'against', 'upon', 'across', 'behind', 'beside', 'and', 'or', 'but', 'nor', 'so', 'yet',
    'because', 'while', 'when', 'if', 'that', 'which', 'who', 'whom', 'whose', 'although',
    'since', 'until', 'than', 'then', 'also', 'there', 'here', 'just', 'still', 'again',
    'always', 'never', 'often', 'usually', 'later', 'now', 'today', 'yesterday', 'soon',
    'not', 'only', 'too', 'even', 'ever', 'once', 'both', 'all', 'either', 'neither',
    'what', 'where', 'how', 'whether', 'though', 'unless', 'whereas', 'first', 'next',
  ]);

  // Verbs the engine recognises after a role word. Base forms; the matcher also
  // tries the -s and -es forms, so "client asks" reads as a verb. Irregular pasts
  // are listed whole.
  const VERB_BASES = new Set([
    'ask', 'say', 'report', 'state', 'request', 'refuse', 'engage', 'attend', 'arrive', 'leave',
    'demonstrate', 'show', 'display', 'exhibit', 'make', 'take', 'give', 'want', 'need', 'prefer',
    'like', 'love', 'hate', 'enjoy', 'play', 'work', 'walk', 'run', 'sit', 'stand', 'wait',
    'respond', 'follow', 'complete', 'participate', 'require', 'benefit', 'struggle', 'cry',
    'scream', 'hit', 'throw', 'elope', 'remain', 'appear', 'seem', 'become', 'begin', 'start',
    'stop', 'continue', 'try', 'use', 'receive', 'provide', 'implement', 'collect', 'record',
    'observe', 'review', 'schedule', 'sign', 'consent', 'agree', 'decline', 'express', 'mention',
    'note', 'call', 'email', 'text', 'notify', 'reach', 'come', 'go', 'get', 'know', 'think',
    'feel', 'look', 'sound', 'tell', 'speak', 'talk', 'join', 'bring', 'carry', 'lead', 'help',
    'teach', 'train', 'coach', 'supervise', 'meet', 'visit', 'cancel', 'confirm', 'deny',
    'verify', 'accept', 'attempt', 'access', 'tolerate', 'initiate', 'imitate', 'comply',
    'resist', 'protest', 'laugh', 'smile', 'cooperate', 'transition', 'eat', 'drink', 'sleep',
    'fall', 'tire', 'calm', 'settle', 'recover', 'improve', 'worsen', 'increase', 'decrease',
  ]);

  const IRREGULAR_PAST = new Set([
    'said', 'told', 'met', 'saw', 'sat', 'got', 'came', 'went', 'made', 'gave', 'took', 'ran',
    'left', 'threw', 'hit', 'bit', 'began', 'fell', 'felt', 'found', 'kept', 'knew', 'led',
    'lost', 'paid', 'put', 'read', 'sent', 'set', 'shut', 'slept', 'spoke', 'stood', 'taught',
    'thought', 'understood', 'woke', 'won', 'wrote', 'brought', 'bought', 'caught', 'chose',
    'drew', 'drank', 'ate', 'flew', 'forgot', 'grew', 'held', 'heard', 'hid', 'meant', 'quit',
    'rose', 'sang', 'sold', 'swam', 'tore', 'wore', 'cried', 'tried', 'did', 'had', 'was',
    'became', 'drove', 'broke', 'built', 'dealt', 'dug', 'fed', 'fought', 'hurt', 'knelt', 'laid', 'lent', 'rang',
    'rode', 'shook', 'shot', 'slid', 'spent', 'stole', 'struck', 'swung', 'wept', 'stuck', 'swept', 'stung', 'sprang',
    'sank', 'forgave', 'froze', 'fled', 'flung', 'leapt', 'bled', 'burst', 'crept', 'blew', 'spat', 'dove',
  ]);

  // A word ending in -ing that is a noun far more often than a verb, so a role word
  // before it is a modifier or unknown, never the subject of a participle.
  const NOUN_ING = new Set([
    'training', 'coaching', 'counseling', 'counselling', 'programming', 'scheduling', 'screening', 'planning',
    'housing', 'funding', 'staffing', 'billing', 'reporting', 'monitoring', 'tracking', 'testing', 'building',
    'meeting', 'setting', 'wellbeing', 'offering', 'finding', 'findings', 'feeling', 'feelings', 'greeting',
    'listening', 'speaking', 'reading', 'writing', 'learning', 'teaching', 'parenting', 'caregiving', 'nursing',
    'sibling', 'ceiling', 'clothing', 'morning', 'evening', 'something', 'anything', 'nothing', 'everything',
  ]);

  // Base verbs that follow "that role" in a recommendation or a request, and that are
  // not also a noun: "recommended that parent attend". Kept short on purpose.
  const MANDATIVE = new Set(['attend', 'sign', 'complete', 'implement', 'participate', 'agree', 'arrive', 'remain',
    'continue', 'follow', 'provide', 'bring', 'return', 'receive', 'observe', 'collect', 'ensure']);

  // Words that may open a question ahead of a fronted auxiliary: "Why was the client
  // upset?"
  const WH_WORDS = new Set(['who', 'what', 'why', 'when', 'where', 'how', 'which', 'whom', 'whose']);

  // Auxiliaries that open a question: "Did BT arrive?", "Was client present?"
  const AUXILIARIES = new Set([
    'is', 'was', 'were', 'are', 'has', 'had', 'have', 'did', 'does', 'do', 'can', 'could', 'will', 'would', 'should',
    'may', 'might', 'must', 'shall',
  ]);

  // A word after a role word that is a NOUN or an adjective on purpose: the role
  // word is then a modifier ("client behavior", "parent training", "BCBA
  // supervision") and never swaps. Anything not here and not recognisably a verb or
  // function word is UNSURE, which also stays generic but is drawn amber.
  const MODIFIER_NEXT = new Set([
    'behavior', 'behaviour', 'behaviors', 'tantrum', 'concern', 'report', 'training', 'session',
    'consultation', 'protocol', 'supervision', 'rights', 'goal', 'goals', 'plan', 'data',
    'program', 'meeting', 'coaching', 'consent', 'engagement', 'participation', 'preference',
    'preferences', 'schedule', 'satisfaction', 'feedback', 'input', 'involvement', 'interview',
    'interviews', 'questionnaire', 'form', 'forms', 'record', 'records', 'file', 'chart',
    'caseload', 'population', 'outcomes', 'outcome', 'language', 'history', 'name', 'age',
    'level', 'status', 'needs', 'support', 'services', 'service', 'team', 'group', 'sample',
    'treatment', 'intake', 'assessment', 'evaluation', 'review', 'note', 'notes', 'log',
    'signature', 'availability', 'communication', 'education', 'counseling', 'consultation',
  ]);

  // Alive things. A possessive in front of one of these is the person, always, per
  // his ruling: "the client's mother" becomes "Jaden's mother" every time.
  const ALIVE_NOUNS = new Set([
    'mother', 'father', 'mom', 'dad', 'mommy', 'daddy', 'parent', 'parents', 'sibling', 'siblings',
    'brother', 'sister', 'brothers', 'sisters', 'grandmother', 'grandfather', 'grandma', 'grandpa',
    'aunt', 'uncle', 'cousin', 'family', 'friend', 'friends', 'peer', 'peers', 'classmate',
    'classmates', 'teacher', 'aide', 'twin', 'son', 'daughter', 'child', 'baby', 'caregiver',
    'guardian', 'nanny', 'babysitter', 'dog', 'cat', 'pet', 'puppy', 'kitten', 'bird', 'fish',
    'hamster', 'horse', 'plant', 'plants', 'stepmother', 'stepfather', 'stepbrother',
    'stepsister', 'grandparent', 'grandparents', 'neighbor', 'neighbour', 'doctor', 'therapist',
    'nurse', 'psychologist', 'pediatrician', 'physician', 'tutor', 'coach', 'sitter', 'roommate', 'spouse',
    'husband', 'wife', 'niece', 'nephew', 'boyfriend', 'girlfriend', 'partner', 'ex', 'grandchild', 'grandson',
    'granddaughter', 'in-law',
  ]);

  // Events and states of the person. His follow-up answer on these is pending, so
  // the choice is ONE constant, `EVENT_NOUNS_USE_NORMAL_RATE` in roleswap.mjs: true
  // means these swap at the normal rate, false means they use the possessive rates
  // like a document does.
  const EVENT_NOUNS = new Set([
    'concern', 'concerns', 'behavior', 'behaviors', 'behaviour', 'tantrum', 'tantrums', 'mood',
    'moods', 'elopement', 'elopements', 'meltdown', 'meltdowns', 'aggression', 'outburst',
    'outbursts', 'response', 'responses', 'progress', 'performance', 'engagement',
    'participation', 'attention', 'energy', 'health', 'sleep', 'appetite', 'anxiety', 'refusal',
    'compliance', 'communication', 'language', 'regression', 'frustration', 'excitement',
    'reaction', 'reactions', 'request', 'requests', 'attempt', 'attempts', 'work', 'day',
    'tolerance', 'stamina', 'skill', 'skills', 'ability', 'abilities', 'independence', 'improvement', 'growth',
    'development', 'fear', 'fears', 'sensitivity', 'motivation', 'interest', 'interests', 'comfort', 'stress',
    'fatigue', 'pain', 'symptom', 'symptoms', 'stereotypy', 'vocalization', 'vocalizations',
  ]);

  // Documents and services: these are the possessed things that use the 15% and 60%
  // rates, because "the client's plan" is as often read as "the plan" as it is
  // attached to a name.
  const DOCUMENT_NOUNS = new Set([
    'plan', 'plans', 'report', 'reports', 'goal', 'goals', 'protocol', 'protocols', 'schedule',
    'session', 'sessions', 'data', 'program', 'programs', 'file', 'chart', 'record', 'records',
    'assessment', 'evaluation', 'treatment', 'intake', 'form', 'forms', 'notes', 'note',
    'authorization', 'services', 'service', 'hours', 'baseline', 'targets', 'target', 'graph',
  ]);

  // A noun that is also an ordinary word and a person might be named: the warning
  // he sees on a typed value. Beyond sensitive.mjs's TOO_COMMON, which stops a mark
  // outright, these only WARN, because a client really can be called Will.
  const NAME_IS_A_WORD = new Set([
    'will', 'grace', 'hope', 'faith', 'joy', 'mark', 'bill', 'art', 'rob', 'pat', 'sue', 'ray',
    'rose', 'daisy', 'lily', 'ivy', 'violet', 'summer', 'autumn', 'april', 'may', 'june',
    'august', 'sunny', 'happy', 'angel', 'star', 'precious', 'chance', 'miracle', 'destiny',
    'justice', 'dawn', 'eve', 'gene', 'drew', 'bob', 'jack', 'rick', 'frank', 'miles', 'rich',
    'sandy', 'wade', 'cash', 'hunter', 'rocky', 'sky', 'storm', 'lane', 'page', 'river',
    'bear', 'rex', 'max', 'dean', 'earl', 'bay', 'don', 'dot', 'fern', 'hazel', 'iris', 'jade',
    'penny', 'pearl', 'ruby', 'skye', 'tom', 'whit', 'young', 'long', 'case', 'cook', 'miller',
  ]);

  NS._lex = { STANDING_ROLES, CAREGIVER_KIN, ADD_KINDS, INDEFINITE, MODIFIER_NOUNS, FUNCTION_WORDS, VERB_LEAD, NEXT_FUNCTION, VERB_BASES, IRREGULAR_PAST, NOUN_ING, MANDATIVE, WH_WORDS, AUXILIARIES, MODIFIER_NEXT, ALIVE_NOUNS, EVENT_NOUNS, DOCUMENT_NOUNS, NAME_IS_A_WORD };
})();
