/* A MOCK THAT HANDS THE TOKEN BACK THE WAY IT WAS GIVEN IT PROVES NOTHING.
 *
 * The scrub mints an opaque token as the literal string [[T3]]. Every
 * round-trip test written before 2026-09-09 drove a mock that echoed the prompt
 * back byte-perfect, so [[T3]] always came back as [[T3]], the literal
 * substitution always found it, and the suite stayed green while a signed sup
 * note reached production reading [T1] through [T14] in Goals Analyzed. The one
 * thing a real model will not promise is the one thing the mock guaranteed.
 *
 * So this file is the negative control. reshape() rewrites every canonical
 * token into a shape the model has actually been seen to produce, and never
 * back into the canonical one. A build whose restore pass matches only the
 * literal token renders a token to the clinician, which is what the harness is
 * there to catch.
 *
 * WHY A FAMILY AND NOT A SHAPE. The brackets are decoration the model is free to
 * mangle; the number is the identity. Assertions read tokenFamily(), which
 * covers one or two brackets, incidental whitespace, and either case of T.
 * asserting the canonical shape is how a note carrying [T3] passed the leak
 * check for a week.
 */

/* Built fresh on every call rather than held at module scope. A /g regex keeps
   lastIndex between calls, and these are read inside loops.

   WIDENED 2026-09-18, AND THIS WAS A HOLE IN THE HARNESS ITSELF. The assertion
   family used to be the same width as the code it checks, so a note that kept a
   parenthesised (T3), an escaped \[T3\] or a bare T3 satisfied "no token
   survives" and the suite called it clean. A check can only catch what it can
   see, and an assertion family narrower than the shapes a model emits is an
   assertion that passes for the wrong reason. */
const T_NUM = '[Tt]\\s*[-_]?\\s*\\d+';
const BRACKETED =
  '\\\\?[\\[\\(\\uFF08\\uFF3B\\u3010\\u301A\\uFF62]{1,2}\\s*' + T_NUM +
  '(?:\\s*[,;/]\\s*' + T_NUM + ')*\\s*\\\\?[\\]\\)\\uFF09\\uFF3D\\u3011\\u301B\\uFF63]{1,2}';
const ANY_TOKEN = BRACKETED + '|\\b[Tt]\\d+\\b';

export const tokenFamily = () => new RegExp(ANY_TOKEN);
export const tokenFamilyAll = () => new RegExp(ANY_TOKEN, 'g');

// The mint, exactly as notes-scrub issues it. reshape() must never emit this.
export const canonicalAll = () => /\[\[T(\d+)\]\]/g;

/* Five shapes a model has been seen to return, none of them canonical.
 *
 * The first is the one he read on production: [[...]] read as a wiki link or a
 * markdown artefact and normalised down to one bracket. The rest are the
 * variants of the same habit - case folded, padded, or left unbalanced when the
 * model wrapped a line in the middle of the token.
 */
const SHAPES = [
  (n) => `[T${n}]`,
  (n) => `[[t${n}]]`,
  (n) => `[[T ${n}]]`,
  (n) => `[[T${n}]`,
  (n) => `[ t ${n} ]`,
  /* Added 2026-09-18 after measuring which reshapings rode past BOTH the
     restorer and the check meant to catch it. Each of these reached the EHR as a
     token with nothing on screen saying so. */
  (n) => `\\[T${n}\\]`,   // markdown escaped the brackets
  (n) => `(T${n})`,        // decided our brackets were markup
  (n) => `\uFF62T${n}\uFF63`, // unicode brackets
  (n) => `[T-${n}]`,       // hyphenated the number off the T
  (n) => `[[T0${n}]]`,     // padded the number
];

/* How many shapes there are, so a control can walk one number per shape instead
   of a hand-picked list that covers whatever the list covered the day it was
   written. Two shapes were added on 2026-09-18 and the control kept reading the
   original five without saying so. */
export const SHAPE_COUNT = SHAPES.length;

/* DELIBERATELY NOT IN THE LIST ABOVE: a bare T3 with the brackets gone.
   The restorer will not substitute a word for two characters sitting loose in
   prose, because that is how a sentence the clinician wrote gets corrupted. So
   a bare token is caught rather than repaired, and it is asserted where that
   behaviour lives, in alert-budget.spec.js, not here where the claim is that
   nothing survives into the note. */

/* Deterministic on the number, so a test that builds a quote for [[T4]] and a
   test that reads the note are talking about the same string. Spreading the
   shapes across the numbers is what makes one drafted note carry four different
   manglings at once, which is closer to a real reply than five runs each
   carrying one. */
export const reshapeOne = (n) => SHAPES[Number(n) % SHAPES.length](String(n));

export function reshape(text) {
  return String(text).replace(canonicalAll(), (_, n) => reshapeOne(n));
}

// Every [[Tn]] number the page actually put on the wire, in order of issue.
export function issuedNumbers(text) {
  const found = [];
  String(text).replace(canonicalAll(), (_, n) => { if (!found.includes(n)) found.push(n); return ''; });
  return found;
}

/* Read what reaches the CLIPBOARD, not what the page renders.
 *
 * Per-section Copy is the moment the note leaves for the EHR, and it hands a
 * string built from state rather than scraped from the DOM. A token that never
 * appears on screen can still be copied, so this path is asserted on its own
 * rather than assumed from the rendered note.
 */
export async function captureClipboard(page) {
  await page.addInitScript(() => {
    window.__copied = [];
    const install = () => {
      try {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: (t) => { window.__copied.push(String(t)); return Promise.resolve(); } },
        });
      } catch (e) { /* a browser that refuses the redefine is reported by the empty array */ }
    };
    install();
  });
}

export const copiedFrom = (page) => page.evaluate(() => window.__copied || []);

/* THE RESHAPING HAS TO HAPPEN BEFORE THE JSON ENCODER, NOT AFTER IT.
 *
 * A drafted note crosses the wire as JSON inside the model's text, and one of
 * the shapes above carries a backslash: a model that read our brackets as
 * markdown writes \[T5\] into the field, and its JSON encoder puts \\[T5\\] on
 * the wire. Reshaping the SERIALISED string instead dropped a bare \[ inside a
 * JSON string, which is not a legal escape, so the page could not parse the
 * reply at all and drew no note.
 *
 * That failure wears the costume of a restore bug and is not one. The harness
 * had corrupted the transport rather than the token, every test downstream of a
 * draft died on it, and a check that cannot tell "the page failed to restore a
 * token" from "the page failed to read the reply" is telling you nothing about
 * either. So walk the values, reshape each one, and serialise afterwards, which
 * is the order a real model works in.
 */
export function reshapeReply(obj) {
  if (typeof obj === 'string') return reshape(obj);
  const walk = (v) => {
    if (typeof v === 'string') return reshape(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, walk(val)]));
    }
    return v;
  };
  return JSON.stringify(walk(obj));
}
