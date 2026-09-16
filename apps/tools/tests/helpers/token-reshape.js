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
   lastIndex between calls, and these are read inside loops. */
export const tokenFamily = () => /\[{1,2}\s*[Tt]\s*\d+\s*\]{1,2}/;
export const tokenFamilyAll = () => /\[{1,2}\s*[Tt]\s*\d+\s*\]{1,2}/g;

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
];

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
