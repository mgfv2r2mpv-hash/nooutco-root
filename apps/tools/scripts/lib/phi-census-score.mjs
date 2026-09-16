/**
 * phi-census-score - the scoring and the miss classifier, pure.
 *
 * NO I/O AND NO KNOWLEDGE OF THE DETECTOR. Everything here takes what a pass
 * returned plus the doc's authored truth and hands back counts, so the numbers
 * can be pinned in a test against a case worked by hand rather than against the
 * script's own output.
 *
 * A MISTAKE IS EITHER A FALSE POSITIVE OR A MISS, AND EVERY ONE GETS A CLASS.
 * classify() always returns a class, and the census fails loudly if anything
 * lands in 'unclassified': an unnamed mistake is the one a later slice will not
 * know it has to pay for.
 */

/* The five classes the objective names, plus the ones the corpus turned up.
   Order is precedence for the structural check in classifyFalsePositive. */
export const MISS_CLASSES = [
  'verb-after-role-cue',
  'dictionary-collision-with-clinical-vocabulary',
  'colour-or-material-word',
  'place-name-overlapping-span',
  'lowercase-real-name-no-cue',
  // Beyond the five, found by running this corpus:
  'program-name-capitalised',
  'nickname-prefix-pass',
  'identifier-cue-swallowed-a-word',
  'cue-word-splits-a-two-word-name',
  'sentence-start-survivor',
  'unclassified',
];

/* The cue words that put a name position in front of the next word. Two lists
   because the scrubber has two: the role labels that assign a role, and the
   prepositions that only mark a position. Both produce the same mistake. */
const ROLE_CUES = [
  'client', 'caregiver', 'mom', 'dad', 'mother', 'father', 'guardian', 'parent',
  'bt', 'rbt', 'technician', 'tech', 'teacher', 'sibling', 'peer', 'kiddo',
  'learner', 'student',
];
const POSITION_CUES = ['with', 'for', 'beside'];

const lc = (s) => String(s || '').toLowerCase();

/** Every lowercase word of `text`, in order, with the word before each one. */
function wordPairs(text) {
  const words = String(text || '').match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  return words.map((w, i) => ({ word: w, prev: i > 0 ? lc(words[i - 1]) : '' }));
}

/** True when `term` appears in `text` directly after a role or position cue. */
export function sitsAfterCue(term, text) {
  const t = lc(term);
  return wordPairs(text).some(
    (p) => lc(p.word) === t && (ROLE_CUES.includes(p.prev) || POSITION_CUES.includes(p.prev)),
  );
}

/** True when `term` appears in `text` only ever in lower case. */
export function onlyLowercase(term, text) {
  const t = lc(term);
  const seen = wordPairs(text).filter((p) => lc(p.word) === t);
  return seen.length > 0 && seen.every((p) => p.word[0] === p.word[0].toLowerCase());
}

/** True when `term` sits inside one of the doc's authored identifier spans. */
export function insideIdentifier(term, doc) {
  const t = lc(term);
  return (doc.identifiers || []).some((id) => lc(id.text).split(/\s+/).includes(t)
    || lc(id.text).includes(t + ' ') || lc(id.text).endsWith(' ' + t));
}

/** True when every occurrence of `term` opens a sentence or a line. */
export function onlyAtSentenceStart(term, text) {
  const t = lc(term);
  const opens = new Set();
  const inner = new Set();
  String(text || '').split(/[.!?]\s+|\n/).forEach((sent) => {
    (sent.trim().match(/[A-Za-z][A-Za-z'’-]*/g) || []).forEach((w, i) => {
      (i === 0 ? opens : inner).add(lc(w));
    });
  });
  return opens.has(t) && !inner.has(t);
}

/**
 * Class for a word the detector called a person and the author did not.
 *
 * PRECEDENCE IS POSITION FIRST, THEN THE AUTHORED TRAP, THEN SHAPE. A word
 * flagged because a cue sat in front of it is a cue fault whatever else the
 * word is, and a word overlapping an address is an overlap fault whatever the
 * word means. Only after those does the doc's own label get a say, because that
 * label describes the word rather than where it was standing.
 */
export function classifyFalsePositive(term, doc, ctx) {
  const t = lc(term);
  const text = doc.text || '';
  if (sitsAfterCue(t, text) && onlyLowercase(t, text)) return 'verb-after-role-cue';
  if (insideIdentifier(t, doc)) return 'place-name-overlapping-span';
  const trap = (doc.traps || {})[t];
  if (trap) return trap;
  if (ctx && ctx.isNicknamePrefixOf && ctx.isNicknamePrefixOf(t)) return 'nickname-prefix-pass';
  if (ctx && ctx.isFirstName && ctx.isFirstName(t)) return 'dictionary-collision-with-clinical-vocabulary';
  if (onlyAtSentenceStart(t, text)) return 'sentence-start-survivor';
  return 'unclassified';
}

/**
 * Class for a person the author named and the detector did not return.
 *
 * A TWO WORD NAME WITH A CUE IN FRONT OF IT IS ITS OWN CLASS. The phrase pass
 * takes two capitalised words at a time, so "Caregiver Barbara Jean" is read as
 * "Caregiver Barbara" first, the cue word drops out as a stopword, and what is
 * left is one word rather than two. The phrase never forms, and the human ends
 * up carrying one token per word.
 */
export function classifyMiss(term, doc, ctx) {
  const t = lc(term);
  const text = doc.text || '';
  const inDict = !!(ctx && ctx.isFirstName && ctx.isFirstName(t));
  if (t.includes(' ') && sitsAfterCue(t.split(' ')[0], text)) return 'cue-word-splits-a-two-word-name';
  if (onlyLowercase(t, text) && !inDict) return 'lowercase-real-name-no-cue';
  if (onlyAtSentenceStart(t, text) && !inDict) return 'sentence-start-survivor';
  return 'unclassified';
}

/**
 * Set scoring, case-insensitive, with a class on every mistake.
 *
 * `ambiguous` entries score as neither. A word that is a person in one sentence
 * of the doc and a material in another is right either way, and counting it
 * would move a number without anybody being able to say which way is better.
 */
export function scoreSet({ predicted, truth, doc, ctx, classifyFp, classifyFn }) {
  const amb = new Set((doc.ambiguous || []).map(lc));
  const pred = new Set(predicted.map(lc).filter((x) => !amb.has(x)));
  const want = new Set(truth.map(lc).filter((x) => !amb.has(x)));
  const tp = [...pred].filter((x) => want.has(x));
  const fp = [...pred].filter((x) => !want.has(x));
  const fn = [...want].filter((x) => !pred.has(x));
  return {
    tp: tp.length,
    fp: fp.length,
    fn: fn.length,
    precision: pred.size === 0 ? null : tp.length / pred.size,
    recall: want.size === 0 ? null : tp.length / want.size,
    falsePositives: fp.map((term) => ({ term, class: (classifyFp || classifyFalsePositive)(term, doc, ctx) })),
    misses: fn.map((term) => ({ term, class: (classifyFn || classifyMiss)(term, doc, ctx) })),
  };
}

/** Identifier scoring: a span is only a hit when its TYPE is right too. */
export function scoreIdentifiers(predicted, truth) {
  const key = (h) => `${lc(h.text)}::${h.type}`;
  const predByText = new Map(predicted.map((h) => [lc(h.text), h]));
  const truthByText = new Map(truth.map((h) => [lc(h.text), h]));
  const predKeys = new Set(predicted.map(key));
  const truthKeys = new Set(truth.map(key));
  const tp = [...predKeys].filter((k) => truthKeys.has(k));
  const fpKeys = [...predKeys].filter((k) => !truthKeys.has(k));
  const fnKeys = [...truthKeys].filter((k) => !predKeys.has(k));
  const typeErrors = fpKeys
    .map((k) => k.split('::')[0])
    .filter((text) => truthByText.has(text))
    .map((text) => ({ text, got: predByText.get(text).type, want: truthByText.get(text).type }));
  return {
    tp: tp.length,
    fp: fpKeys.length,
    fn: fnKeys.length,
    precision: predKeys.size === 0 ? null : tp.length / predKeys.size,
    recall: truthKeys.size === 0 ? null : tp.length / truthKeys.size,
    typeErrors,
    falsePositives: fpKeys.filter((k) => !truthByText.has(k.split('::')[0]))
      .map((k) => ({ term: k.split('::')[0], class: 'identifier-cue-swallowed-a-word' })),
    misses: fnKeys.filter((k) => !predByText.has(k.split('::')[0]))
      .map((k) => ({ term: k.split('::')[0], class: 'unclassified' })),
  };
}

/** Role scoring: a name mapped to the wrong role counts as both a miss and a hit against. */
export function scoreRoles(predicted, truth, doc, ctx) {
  const got = new Map(Object.entries(predicted || {}).map(([k, v]) => [lc(k), v]));
  const want = new Map(Object.entries(truth || {}).map(([k, v]) => [lc(k), v]));
  let tp = 0;
  const wrongRole = [];
  const misses = [];
  for (const [name, role] of want) {
    if (!got.has(name)) misses.push({ term: name, class: classifyMiss(name, doc, ctx) });
    else if (got.get(name) === role) tp += 1;
    else wrongRole.push({ term: name, got: got.get(name), want: role });
  }
  const falsePositives = [...got.keys()]
    .filter((n) => !want.has(n))
    .map((term) => ({ term, class: classifyFalsePositive(term, doc, ctx), role: got.get(term) }));
  return {
    tp,
    fp: falsePositives.length + wrongRole.length,
    fn: misses.length + wrongRole.length,
    precision: got.size === 0 ? null : tp / got.size,
    recall: want.size === 0 ? null : tp / want.size,
    wrongRole,
    falsePositives,
    misses,
  };
}

/**
 * How many humans came out of buildRoleMap wearing more than one role token.
 *
 * NOT A PRECISION QUESTION. Every entry can be a real person and the map can
 * still be wrong, because one caregiver arriving as Caregiver and Person 2 tells
 * the model there were two people in the room. The count is per person group
 * the doc authored.
 */
export function scoreTokenFragmentation(roleMap, doc) {
  const byName = new Map(roleMap.map((e) => [lc(e.name), e.token]));
  const split = [];
  for (const group of doc.personGroups || []) {
    const tokens = new Set(group.map(lc).map((n) => byName.get(n)).filter(Boolean));
    if (tokens.size > 1) split.push({ person: group[0], tokens: [...tokens] });
  }
  return { people: (doc.personGroups || []).length, split };
}

export function emptyTally() {
  const classes = {};
  MISS_CLASSES.forEach((c) => { classes[c] = { count: 0, examples: [] }; });
  return { tp: 0, fp: 0, fn: 0, classes };
}

export function addToTally(tally, docId, result) {
  tally.tp += result.tp;
  tally.fp += result.fp;
  tally.fn += result.fn;
  [...(result.falsePositives || []), ...(result.misses || [])].forEach((m) => {
    const bucket = tally.classes[m.class] || (tally.classes[m.class] = { count: 0, examples: [] });
    bucket.count += 1;
    if (bucket.examples.length < 6) bucket.examples.push(`${docId}:${m.term}`);
  });
}

export function rate(n, d) {
  return d === 0 ? null : n / d;
}

export function pct(v) {
  return v === null || v === undefined ? '  n/a' : `${(v * 100).toFixed(1).padStart(5)}%`;
}
