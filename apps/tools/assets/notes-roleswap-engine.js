/*
 * notes-roleswap-engine.js - The swap itself.
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
  const { noteContext, before, after } = NS._ctx;
  const { wordsOf, activeRows } = NS._rows;
  const { fraction, possessiveOf, cleanValue } = NS._values;
  const { CAREGIVER_KIN, INDEFINITE, MODIFIER_NOUNS, FUNCTION_WORDS, VERB_LEAD, NEXT_FUNCTION, VERB_BASES, IRREGULAR_PAST, MODIFIER_NEXT, ALIVE_NOUNS, EVENT_NOUNS, NOUN_ING, WH_WORDS, AUXILIARIES, MANDATIVE, } = NS._lex;

  // The copy-out role swap: "the client" becomes the name he typed, at copy-out and
  // nowhere else.
  //
  // His rulings, all admin mode only, and the reason this is a pure module:
  //
  //   "The model reads the draft as written; the swap happens only at copy-out ...
  //   Swapped text lives only in the copy buffer, never in note state the model can
  //   read."
  //
  // So nothing in this file touches a document. It takes the text and the rows, and
  // hands back the text and a list of SPANS: where each mention was, what it would
  // become, whether it did, and why not when it did not.
  //
  // ONE PASS OVER THE ORIGINAL. Every decision below is read off the text he wrote.
  // The output is built from those decisions and never scanned again, so a typed
  // name like "Parker" cannot be found by a later look and swapped a second time.
  //
  // Swap a mention only when it points at the one specific person. The rest of the
  // engine is that sentence, said as rules:
  //
  //   plural                    "clients", "clients'"                    kept: plural
  //   indefinite                "a client", "each BT", "any parent"      kept: indefinite
  //   another person            "school BT", "peer's parent",
  //                             "parent of the peer"                     kept: other-person
  //   a label                   "Client A", "Parent 2"                   kept: label
  //   a hyphen form             "client-led", "BT-reported"              kept: hyphen
  //   quoted speech             "...the client..."                       kept: quote
  //   a title or heading        ALL CAPS, 3+ capitalised words, "Foo:"   kept: title
  //   already named             "BCBA (Brooke)", "Brooke, BCBA"          kept: already-named
  //   a modifier                "client behavior", "parent training"     kept: modifier
  //   not sure                  the next word is not one it knows        kept: unsure
  //
  // A bare role directly before a noun or adjective is a modifier and never swaps.
  // A bare role before a verb, auxiliary, preposition, conjunction, punctuation or
  // the end swaps. A possessive ("client's") is the person; what it possesses
  // decides how often (see `decide` below). Pronouns are never touched, because only
  // role words are ever matched.
  //
  // LEAVING A FEW BEHIND. A note in which every mention is swapped reads like a
  // form letter, so a few eligible mentions are left generic, by a hash and never
  // by chance: FNV-1a over the seed, the role, about 40 characters either side and
  // the paragraph number, so the same text and seed give the same bytes, and editing
  // one paragraph leaves every other paragraph as it was. The first eligible mention
  // in each paragraph is always swapped, two are never left in a row for one role,
  // at most one in three per role per paragraph, a role with fewer than four
  // eligible mentions in the whole note leaves none, and a mention is never left
  // beside a swapped one of the same role in the same sentence.


  // HIS FOLLOW-UP ANSWER IS PENDING, so this is one constant. True: events and
  // states of the person (concern, behavior, tantrum, mood, elopement) swap at the
  // normal rate after a possessive, and only documents and services (plan, report,
  // goals, protocol, schedule, session, data) use the 15% and 60% rates. False: both
  // kinds use the rates.
  const EVENT_NOUNS_USE_NORMAL_RATE = true;

  // His values. `bare` is "the client's [noun]", `modified` is "the client's
  // [adjective or noun] [noun]", `leave` is the most that are left behind.
  const DEFAULT_RATES = Object.freeze({ leave: 0.25, bare: 0.15, modified: 0.6 });
  const MIN_ELIGIBLE_FOR_LEAVES = 4;

  const SWAPPED = 'swapped';
  const REASON_TEXT = Object.freeze({
    swapped: 'Swapped for the name you typed.',
    plural: 'Left generic: a plural, so it is not one person.',
    indefinite: 'Left generic: "a", "each", "any" and the like do not point at one person.',
    'other-person': 'Left generic: this is somebody else (a school BT, a peer\'s parent, a parent of someone).',
    label: 'Left generic: a label such as Client A or Parent 2.',
    hyphen: 'Left generic: part of a hyphenated word.',
    quote: 'Left generic: it sits inside quoted speech.',
    title: 'Left generic: it sits in a title, a heading or a label.',
    'already-named': 'Left generic: the name is already beside it.',
    modifier: 'Left generic: it modifies the next word ("parent training", "client behavior").',
    density: 'Left generic on purpose, so the note does not read like a form letter.',
    unsure: 'Left generic: the words around it are not ones Sass can read with confidence.',
  });

  const NOUN_LY = new Set(['family', 'assembly', 'supply', 'reply', 'anomaly', 'ally', 'bully', 'belly', 'italy', 'july',
    // First names that end in -ly, so a capitalised one is not read as an adverb.
    'kelly', 'molly', 'holly', 'emily', 'sally', 'billy', 'willy', 'lily', 'polly', 'shelly', 'nelly', 'tilly',
    'milly', 'dolly', 'sully', 'reilly', 'kimberly', 'beverly', 'shirley', 'lilly', 'tally', 'cally']);
  const NOT_VERB_ED = new Set(['speed', 'breed', 'hundred', 'sacred', 'naked', 'wicked', 'kindred']);
  // Words that open a sentence and are followed by a comma without being a name:
  // "Unfortunately, the client refused." The -ly adverbs are caught by `isAdverb`.
  const INTRO_WORDS = new Set(['yes', 'no', 'okay', 'ok', 'well', 'so', 'sure', 'thus', 'therefore', 'hence', 'instead',
    'otherwise', 'still', 'sometimes', 'furthermore', 'moreover', 'consequently', 'nevertheless', 'nonetheless',
    'regardless', 'anyway', 'besides', 'likewise', 'afterwards', 'again', 'perhaps', 'maybe', 'please', 'thanks',
    'hello', 'hi', 'dear', 'second', 'third', 'per', 'once', 'often', 'usually', 'generally', 'lately']);
  const OPENERS = new Set(['however', 'today', 'yesterday', 'then', 'also', 'later', 'meanwhile', 'overall', 'finally',
    'initially', 'additionally', 'afterward', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
    'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
    'october', 'november', 'december', 'first', 'next', 'last', 'now', 'here', 'there', 'recently', 'currently']);
  // Every mark a draft uses for an apostrophe, and the possessive endings built on them.
  const APOS = "['’ʼ´`]";
  const POSSESSIVE = new RegExp(`^${APOS}s$`, 'i');
  const POSSESSIVE_END = new RegExp(`${APOS}s$|s${APOS}$`, 'i');
  // "wasn't", "can\u2019t", "client'll": an auxiliary in a contraction.
  const CONTRACTED = /n['\u2019]t$|['\u2019](?:ll|d|ve)$/;
  const CHAIN_JOIN = /^(?:\s*\/\s*|\s+(?:and|or|&)\s+)$/i;
  const LIST_JOIN = /^\s*(?:,|;|&|\/|and|or|,\s*and|,\s*or)\s*$/i;

  function isVerbForm(lower) {
    if (IRREGULAR_PAST.has(lower)) return true;
    if (/^[a-z]{3,}ed$/.test(lower) && !NOT_VERB_ED.has(lower)) return true;
    if (VERB_BASES.has(lower.slice(0, -1)) && lower.endsWith('s')) return true;
    if (VERB_BASES.has(lower.slice(0, -2)) && lower.endsWith('es')) return true;
    return lower.endsWith('ies') && VERB_BASES.has(`${lower.slice(0, -3)}y`);
  }
  const isAdverb = (lower) => lower.length > 4 && lower.endsWith('ly') && !NOUN_LY.has(lower);

  // ----------------------------------------------------------------- mentions

  function mentionRegex(rows) {
    const lookup = new Map();
    const words = [];
    for (const row of rows) {
      for (const w of wordsOf(row)) {
        const key = w.toLowerCase().replace(/\s+/g, ' ');
        if (lookup.has(key)) continue;
        lookup.set(key, { row, kin: row.id === 'caregiver' && CAREGIVER_KIN.includes(key) });
        words.push(w);
      }
    }
    if (!words.length) return null;
    const alt = words.sort((a, b) => b.length - a.length)
      .map((w) => w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|');
    return { lookup, re: new RegExp(`(?<![\\p{L}\\p{N}])(${alt})(${APOS}s|s${APOS}|es|s)?(?![\\p{L}\\p{N}])`, 'giu') };
  }

  // Every role word in the note, with two or more aliases of one role that stand as
  // one person ("parent/guardian", "parent and guardian") merged into ONE mention,
  // so the swap can never write "Janet/Janet".
  function findMentions(src, rows) {
    const found = mentionRegex(rows);
    if (!found) return [];
    const raw = [...src.matchAll(found.re)].map((m) => {
      const hit = found.lookup.get(m[1].toLowerCase().replace(/\s+/g, ' '));
      return { row: hit.row, kin: hit.kin, word: m[1], start: m.index, coreEnd: m.index + m[1].length, end: m.index + m[0].length, suffix: m[2] || '', chain: false };
    });
    const out = [];
    for (const m of raw) {
      const last = out[out.length - 1];
      const joined = last && last.row === m.row && !last.kin && !m.kin && !last.suffix
        && last.word.toLowerCase() !== m.word.toLowerCase() && CHAIN_JOIN.test(src.slice(last.end, m.start));
      if (joined) out[out.length - 1] = { ...last, coreEnd: m.coreEnd, end: m.end, suffix: m.suffix, chain: true, word: src.slice(last.start, m.coreEnd) };
      else out.push(m);
    }
    return out;
  }

  // ---------------------------------------------------------------- one verdict

  const verdict = (swap, reason, extra = {}) => ({ swap, reason, risky: false, rated: false, ...extra });

  // The words after a possessive that are the possessed thing. The first word is
  // always a noun (a possessive takes one), the rest stop at a function word, a
  // verb or an adverb.
  function nounPhrase(src, from) {
    const words = [];
    let at = from;
    while (words.length < 3) {
      const n = after(src, at);
      if (n.kind !== 'word') break;
      const stop = NEXT_FUNCTION.has(n.lower) || (words.length > 0 && (isVerbForm(n.lower) || isAdverb(n.lower)));
      if (stop) break;
      words.push(n.lower);
      at += n.spaces + n.len;
    }
    return words;
  }

  // An event or a state of the person: a listed noun, or a gerund ("the client's
  // walking") that is not a service word such as "training".
  const isEvent = (word) => EVENT_NOUNS.has(word)
    || (word.length >= 5 && word.endsWith('ing') && !NOUN_ING.has(word));

  // What a possessive does. "the client's mother" is the person, always, because a
  // mother, a sibling or a dog is somebody; anything else uses the rates, and the
  // two kinds of noun are told apart by EVENT_NOUNS_USE_NORMAL_RATE.
  function possessive(src, m, cfg, salt) {
    const phrase = nounPhrase(src, m.end);
    if (!phrase.length) return verdict(true, SWAPPED);
    if (phrase.some((w) => w.split('-').some((part) => ALIVE_NOUNS.has(part) || cfg.roleWords.has(part))) || phrase[0] === 'own') return verdict(true, SWAPPED);
    if (EVENT_NOUNS_USE_NORMAL_RATE && isEvent(phrase[phrase.length - 1])) return verdict(true, SWAPPED);
    const rates = cfg.rates[m.row.id];
    const rate = phrase.length >= 2 ? rates.modified : rates.bare;
    if (cfg.everything || fraction(`poss|${salt}`) < rate) return verdict(true, SWAPPED, { rated: true });
    return verdict(false, 'density', { rated: true });
  }

  // A capitalised word that cannot be somebody's name: the opener of a sentence, an
  // adverb, a function word, or one of the role words themselves ("Client, BT and
  // BCBA were present", "the client's BT").
  const notAName = (lower, cfg) => OPENERS.has(lower) || INTRO_WORDS.has(lower) || FUNCTION_WORDS.has(lower)
    || isAdverb(lower) || cfg.roleWords.has(lower);

  // The word after the role. A line break in the middle of a phrase is a space when
  // the next line goes on in lower case ("The client\nbehavior was noted"), unless
  // that word is itself a role word, which is a list with one entry a line.
  function unwrapped(src, m, cfg) {
    const next = after(src, m.end);
    if (next.kind !== 'end') return next;
    const wrap = src.slice(m.end).match(/^[ \t]*\r?\n[ \t]*(?=\p{Ll})/u);
    if (!wrap) return next;
    const onward = after(src, m.end + wrap[0].length);
    return onward.kind === 'word' && !cfg.roleWords.has(onward.lower) ? { ...onward, skip: wrap[0].length } : next;
  }

  // "Client engaging in play", "BT implementing the plan": a participle that is
  // followed by a determiner, a preposition, an adverb, a role word or a mark has the
  // role word as its subject. "client reading level" is not that, and stays unsure.
  function participleSubject(src, m, next, cfg) {
    if (next.kind !== 'word' || next.lower.length < 5 || !next.lower.endsWith('ing') || NOUN_ING.has(next.lower)) return false;
    const then = after(src, m.end + (next.skip || 0) + next.spaces + next.len);
    if (then.kind === 'end' || then.kind === 'punct') return true;
    return FUNCTION_WORDS.has(then.lower) || NEXT_FUNCTION.has(then.lower) || isAdverb(then.lower) || cfg.roleWords.has(then.lower);
  }

  // "recommended that parent attend", "asked that the BT complete": after "that" a
  // role word with a base verb is the subject of a mandative.
  function mandative(src, m, next) {
    if (next.kind !== 'word' || !MANDATIVE.has(next.lower)) return false;
    let prev = before(src, m.start);
    if (prev.kind === 'word' && (prev.lower === 'the' || prev.lower === 'this')) prev = before(src, prev.at);
    return prev.kind === 'word' && prev.lower === 'that';
  }

  // "Was client present?", "Is the client ok?", "Why was the client upset?": a role
  // word straight after an auxiliary that opens its clause is the subject.
  function frontedAuxiliary(src, m) {
    let prev = before(src, m.start);
    if (prev.kind === 'word' && (prev.lower === 'the' || prev.lower === 'this')) prev = before(src, prev.at);
    if (prev.kind !== 'word' || !AUXILIARIES.has(prev.lower)) return false;
    const lead = before(src, prev.at);
    return lead.kind === 'start' || lead.kind === 'punct' || (lead.kind === 'word' && WH_WORDS.has(lead.lower));
  }

  function alreadyNamed(src, m, next, cfg, poss) {
    const head = src.slice(Math.max(0, m.start - 48), m.start);
    const lead = head.match(/(\p{Lu}\p{Ll}+)(?:,\s+(?:the\s+)?|\s*\(\s*)$/u);
    if (lead && !notAName(lead[1].toLowerCase(), cfg)) return true;
    if (next.kind === 'punct' && next.ch === '(' && /^\(\s*\p{Lu}/u.test(next.rest)) return true;
    if (next.kind === 'punct' && next.ch === ',' && /^,\s+\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?\s*[,.]/u.test(next.rest)) return true;
    // After a possessive the next word is the possessed thing ("the client's Teacher"), never a name.
    return !poss && next.kind === 'word' && next.capital && !MODIFIER_NEXT.has(next.lower) && !notAName(next.lower, cfg);
  }

  function decide(src, m, ctx, cfg, salt) {
    const at = m.start;
    const poss = POSSESSIVE.test(m.suffix);
    if (m.suffix && !poss) return verdict(false, 'plural');
    // "parent(s)" is a plural that might be one.
    if (/^\(s\)/i.test(src.slice(m.end, m.end + 3))) return verdict(false, 'plural');
    if (/[-‐‑\u2013]/.test(src[at - 1] || '') && /\p{L}/u.test(src[at - 2] || '')) return verdict(false, 'hyphen');
    if (/^[-‐‑\u2013]\p{L}/u.test(src.slice(m.end, m.end + 2))) return verdict(false, 'hyphen');
    // An address or an identifier ("client@example.com", "client_name") is not a person.
    if (src[at - 1] === '@' || src[m.end] === '@' || (src[at - 1] === '_' && /\p{L}/u.test(src[at - 2] || ''))
      || (src[m.end] === '_' && /\p{L}/u.test(src[m.end + 1] || ''))) return verdict(false, 'unsure', { risky: true });
    if (ctx.quoted(at)) return verdict(false, 'quote');
    if (ctx.titled(at)) return verdict(false, 'title');
    const next = unwrapped(src, m, cfg);
    if (!poss && next.kind === 'word' && (/^\d+$/.test(next.raw) || (next.raw.length === 1 && /\p{Lu}/u.test(next.raw) && next.raw !== 'I'))) {
      return verdict(false, 'label');
    }
    if (next.kind === 'punct' && (next.ch === '#' || next.ch === ':')) return verdict(false, 'label');
    if (alreadyNamed(src, m, next, cfg, poss)) return verdict(false, 'already-named');
    const prev = beforeRole(src, at);
    if (prev.kind === 'word') {
      if (INDEFINITE.has(prev.lower) || /^\d+(?:st|nd|rd|th)?$/i.test(prev.raw)) return verdict(false, 'indefinite');
      if (POSSESSIVE_END.test(prev.raw) || MODIFIER_NOUNS.has(prev.lower)) return verdict(false, 'other-person');
    }
    if (next.kind === 'word' && next.lower === 'of' && m.row.id !== 'client') return verdict(false, 'other-person');
    // Two different roles joined by a slash ("client/parent") are not one person.
    if (/^\/\p{L}/u.test(src.slice(m.end, m.end + 2)) || (src[at - 1] === '/' && /\p{L}/u.test(src[at - 2] || ''))) {
      return verdict(false, 'unsure', { risky: true });
    }
    // The word before is one Sass knows how to read, or this is low confidence.
    const known = prev.kind !== 'word' || FUNCTION_WORDS.has(prev.lower) || VERB_LEAD.has(prev.lower) || isVerbForm(prev.lower);
    const risky = !known;
    if (poss) return { ...possessive(src, m, cfg, salt), risky };
    if (next.kind === 'end' || next.kind === 'punct') return verdict(true, SWAPPED, { risky });
    // "BT notes: no concerns" is a label; "BT notes that client was calm" is a verb.
    if (next.kind === 'word' && src[m.end + (next.skip || 0) + next.spaces + next.len] === ':'
      && (MODIFIER_NEXT.has(next.lower) || MODIFIER_NEXT.has(next.lower.replace(/s$/, '')))) return verdict(false, 'label');
    if (NEXT_FUNCTION.has(next.lower) || CONTRACTED.test(next.lower) || isVerbForm(next.lower) || isAdverb(next.lower)) return verdict(true, SWAPPED, { risky });
    if (MODIFIER_NEXT.has(next.lower)) return verdict(false, 'modifier');
    if (participleSubject(src, m, next, cfg) || frontedAuxiliary(src, m) || mandative(src, m, next)) return verdict(true, SWAPPED, { risky });
    return verdict(false, 'unsure', { risky: true });
  }

  // ------------------------------------------------------------------ the pass

  function configOf(options) {
    const rows = activeRows(options.rows);
    const rates = {};
    for (const row of rows) rates[row.id] = { ...DEFAULT_RATES, ...((options.rates || {})[row.id] || {}) };
    // Every word that names a person by role: a one-word alias, the last word of a
    // longer one ("technician", "analyst", never "behavior"), and the kin words.
    const roleWords = new Set([...rows.flatMap((r) => wordsOf(r)), ...CAREGIVER_KIN]
      .map((w) => w.toLowerCase().trim().split(/\s+/).pop()));
    return { rows, rates, roleWords, seed: options.seed ?? 1, everything: options.everything === true };
  }

  // "the" and "this" are absorbed by the swap: "The client's mother" is
  // "Jaden's mother", never "The Jaden's". "that" is not, because "noted that BT
  // arrived" has a conjunction in it.
  //
  // A describing word that makes the role the same one person ("primary caregiver",
  // "legal guardian", "the assigned BT") goes with it: "Primary Janet" is not a
  // sentence.
  const DESCRIBERS = new Set(['primary', 'legal', 'main', 'sole', 'custodial', 'biological', 'adoptive',
    'designated', 'assigned', 'current']);

  // The word before a role word, past a describing word.
  function beforeRole(src, start) {
    const prev = before(src, start);
    return prev.kind === 'word' && DESCRIBERS.has(prev.lower) ? before(src, prev.at) : prev;
  }

  function absorbed(src, m) {
    const near = before(src, m.start);
    const at = near.kind === 'word' && DESCRIBERS.has(near.lower) ? near.at : m.start;
    const prev = at === m.start ? near : before(src, at);
    return prev.kind === 'word' && (prev.lower === 'the' || prev.lower === 'this') ? prev.at : at;
  }

  function replacementFor(row, m) {
    const name = cleanValue(row.value);
    return POSSESSIVE.test(m.suffix) ? possessiveOf(name, { mark: m.suffix[0] }) : name;
  }

  // Lists ("Present: client, BT, parent.") are all or nothing: runs of spans with
  // nothing between them but a separator.
  function listGroups(src, spans) {
    const groups = [];
    let run = [0];
    for (let i = 1; i <= spans.length; i += 1) {
      const joined = i < spans.length && LIST_JOIN.test(src.slice(spans[i - 1].mentionEnd, spans[i].mentionStart));
      if (joined) run.push(i);
      else { if (run.length > 1) groups.push(run); run = [i]; }
    }
    return groups;
  }

  // Which eligible mentions are left generic, by the hash, under every cap above.
  function leaveSome(src, ctx, spans, cfg) {
    const eligible = spans.filter((s) => s.swapped);
    const perRole = new Map();
    for (const s of eligible) perRole.set(s.role, (perRole.get(s.role) || 0) + 1);
    if (cfg.everything) return spans;
    const groupOf = new Map();
    for (const g of listGroups(src, spans)) for (const i of g) groupOf.set(i, g);
    const decided = new Map();
    const state = new Map();
    const stateOf = (s) => {
      const key = `${s.role}|${s.paragraph}`;
      if (!state.has(key)) state.set(key, { seen: 0, leaves: 0, prevLeft: false });
      return state.get(key);
    };
    const inParagraph = (s) => eligible.filter((e) => e.role === s.role && e.paragraph === s.paragraph && !e.rated).length;
    const takesPart = (s) => s.swapped && !s.rated && (perRole.get(s.role) || 0) >= MIN_ELIGIBLE_FOR_LEAVES;
    const canLeave = (s) => {
      const st = stateOf(s);
      return st.seen > 0 && !st.prevLeft && st.leaves < Math.floor(inParagraph(s) / 3);
    };
    spans.forEach((s, i) => {
      if (!takesPart(s) || decided.has(i)) return;
      // A list is all or nothing, across roles: it is left only when every one of
      // its entries could be, and never when one of them is not up for leaving.
      const group = groupOf.get(i) || [i];
      const members = group.filter((j) => takesPart(spans[j]));
      const blocked = group.some((j) => spans[j].swapped && !takesPart(spans[j]));
      let left = false;
      if (!blocked && members.every((j) => canLeave(spans[j]))) {
        const [a, b] = ctx.paragraphs[s.paragraph];
        const pre = src.slice(Math.max(a, s.start - 40), s.start);
        const post = src.slice(s.end, Math.min(b, s.end + 40));
        left = fraction(`${cfg.seed}|${s.role}|${pre}|${post}|${s.paragraph}`) < cfg.rates[s.role].leave;
      }
      for (const j of members) {
        const st = stateOf(spans[j]);
        decided.set(j, left);
        st.seen += 1;
        st.prevLeft = left;
        if (left) st.leaves += 1;
      }
    });
    // Never a generic mention beside a swapped one of the same role in a sentence.
    const swappedIn = new Set();
    spans.forEach((s, i) => { if (s.swapped && !decided.get(i)) swappedIn.add(`${s.role}|${s.sentence}`); });
    return spans.map((s, i) => {
      if (!decided.get(i)) return s;
      return swappedIn.has(`${s.role}|${s.sentence}`) ? s : { ...s, swapped: false, reason: 'density' };
    });
  }

  // The spans for a note, in order, with `text` built from them. Nothing here
  // mutates its input.
  function swapRoles(text, options = {}) {
    const src = String(text ?? '');
    const cfg = configOf(options);
    const ctx = noteContext(src);
    let last = null;
    const spans = findMentions(src, cfg.rows).map((m) => {
      const para = ctx.paragraphOf(m.start);
      const [pa, pb] = ctx.paragraphs[para];
      const salt = `${cfg.seed}|${m.row.id}|${src.slice(Math.max(pa, m.start - 40), m.start)}|${src.slice(m.end, Math.min(pb, m.end + 40))}|${para}`;
      const own = decide(src, m, ctx, cfg, salt);
      // "the client's mother and father": the other half of a pair that belongs to
      // somebody else belongs to them too.
      const pair = last && last.verdict.reason === 'other-person' && last.mention.row === m.row
        && CHAIN_JOIN.test(src.slice(last.mention.end, m.start));
      const v = own.swap && pair ? verdict(false, 'other-person') : own;
      last = { mention: m, verdict: v };
      const start = absorbed(src, m);
      return {
        id: `${start}-${m.end}`, start, end: m.end, mentionStart: m.start, mentionEnd: m.end,
        role: m.row.id, original: src.slice(start, m.end), replacement: replacementFor(m.row, m),
        swapped: v.swap, reason: v.reason, risky: v.risky, rated: v.rated,
        paragraph: para, sentence: ctx.sentenceOf(m.start),
      };
    });
    const final = leaveSome(src, ctx, spans, cfg);
    const tidy = final.map(({ mentionStart, mentionEnd, rated, ...rest }) => rest);
    return { text: applySpans(src, tidy), spans: tidy, counts: countsOf(tidy) };
  }

  // The text with every span that is on written in, and `flips` (span ids) turned
  // the other way: the click on a span in the preview.
  function applySpans(text, spans, flips = new Set()) {
    const src = String(text ?? '');
    let out = '';
    let at = 0;
    for (const s of [...spans].sort((a, b) => a.start - b.start)) {
      const on = flips.has(s.id) ? !s.swapped : s.swapped;
      if (!on || s.start < at) continue;
      out += src.slice(at, s.start) + s.replacement;
      at = s.end;
    }
    return out + src.slice(at);
  }

  function countsOf(spans) {
    const byReason = {};
    for (const s of spans) byReason[s.reason] = (byReason[s.reason] || 0) + 1;
    return { swapped: spans.filter((s) => s.swapped).length, kept: spans.filter((s) => !s.swapped).length, byReason };
  }

  NS._engine = { EVENT_NOUNS_USE_NORMAL_RATE, DEFAULT_RATES, MIN_ELIGIBLE_FOR_LEAVES, SWAPPED, REASON_TEXT, swapRoles, applySpans };
})();
