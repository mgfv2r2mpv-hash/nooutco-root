/* The Shift-side trainer.
 *
 * Touch typing shifts with the hand opposite the key: T is a left-hand key, so
 * a capital T takes the RIGHT Shift. The page knows which Shift is down from
 * its own keydown and keyup (event.code ShiftLeft / ShiftRight), and which
 * hand a key belongs to from the key's physical code, so it can tell a
 * same-side shift the moment the capital lands.
 *
 * Same side: the side he SHOULD have used gets a soft warm wash and a
 * watercolour Shift key, and the key he hit flashes on its own side. Right
 * side: a small star or smiley, gently, on the side he used. Nothing moves
 * under the text; all of it lives in the margins and fades on its own.
 */

const LEFT = new Set([
  "Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5",
  "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyA", "KeyS", "KeyD", "KeyF", "KeyG",
  "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB",
]);
const RIGHT = new Set([
  "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal",
  "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight", "Backslash",
  "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote",
  "KeyN", "KeyM", "Comma", "Period", "Slash",
]);
// Digit6 is taught to either index finger, so it is never judged.

/** "L", "R", or null for a key no hand owns (Digit6, space, the keypad). */
export function handOf(code) {
  if (LEFT.has(code)) return "L";
  if (RIGHT.has(code)) return "R";
  return null;
}

/** "ok" for the opposite Shift, "same" for the key's own side, null when it cannot be judged. */
export function judge(shift, hand) {
  if (!shift || !hand || shift === "B") return null;
  return shift === hand ? "same" : "ok";
}

/**
 * Which Shift keys are down, and which PRESS this is. Feed it every keydown
 * and keyup of the box. Each new Shift press gets a new hold number; a key
 * repeat does not. His bug report of 2026-09-23: "EHR" typed holding one Shift
 * flagged the H. Only the FIRST capital of a hold is judged (see firstInHold):
 * holding one Shift through an acronym is correct form, and changing sides
 * mid-acronym is the habit NOT to build.
 */
export function createShiftTracker() {
  const down = new Set();
  let hold = 0;
  let judged = -1;
  return {
    key(e) {
      if (e.code !== "ShiftLeft" && e.code !== "ShiftRight") return false;
      if (e.type === "keydown") { if (!e.repeat && !down.has(e.code)) hold += 1; down.add(e.code); }
      else down.delete(e.code);
      return true;
    },
    /** True once per Shift press: for the first capital typed while it is held. */
    firstInHold() {
      if (judged === hold) return false;
      judged = hold;
      return true;
    },
    /** "L", "R", "B" (both), or null. Trusts the event's own shiftKey over a stale set. */
    side(e) {
      if (!e.shiftKey) { down.clear(); return null; }
      const l = down.has("ShiftLeft"), r = down.has("ShiftRight");
      return l && r ? "B" : l ? "L" : r ? "R" : null;
    },
    /** Strict Shift refused this capital: the next capital of the SAME press is judged again, so holding the wrong Shift cannot sneak the retry through. */
    rejudge() { judged = -1; },
    clear() { down.clear(); judged = hold; },
  };
}

/* ---- the margins ------------------------------------------------------- */

const NS = "http://www.w3.org/2000/svg";
const FADE_MS = 1400;

function svg(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.appendChild(n);
  return n;
}

/** A Shift key painted in watercolour: a blotted wash, a darker bloom at the edge, the arrow and the word. */
function watercolourShift(seed) {
  const s = svg("svg", { viewBox: "0 0 150 76", class: "wc-shift" });
  const f = `wc${seed}`;
  const defs = svg("defs", {}, s);
  const filter = svg("filter", { id: f, x: "-20%", y: "-30%", width: "140%", height: "160%" }, defs);
  svg("feTurbulence", { type: "fractalNoise", baseFrequency: "0.035", numOctaves: 3, seed, result: "n" }, filter);
  svg("feDisplacementMap", { in: "SourceGraphic", in2: "n", scale: 11, xChannelSelector: "R", yChannelSelector: "G", result: "d" }, filter);
  svg("feGaussianBlur", { in: "d", stdDeviation: 1.1 }, filter);
  const g = svg("g", { filter: `url(#${f})` }, s);
  svg("rect", { x: 10, y: 10, width: 130, height: 56, rx: 14, class: "wc-wash" }, g);
  svg("rect", { x: 10, y: 10, width: 130, height: 56, rx: 14, class: "wc-edge" }, g);
  svg("path", { d: "M34 44 L46 28 L58 44 L51 44 L51 52 L41 52 L41 44 Z", class: "wc-arrow" }, s);
  const t = svg("text", { x: 70, y: 46, class: "wc-word" }, s);
  t.textContent = "shift";
  return s;
}

function glyph(kind) {
  const s = svg("svg", { viewBox: "0 0 40 40", class: "fx-glyph" });
  if (kind === "star") {
    svg("path", { d: "M20 4 L24.5 15 L36 15.5 L27 23 L30 34.5 L20 28 L10 34.5 L13 23 L4 15.5 L15.5 15 Z", class: "fx-star" }, s);
  } else {
    svg("circle", { cx: 20, cy: 20, r: 15, class: "fx-face" }, s);
    svg("circle", { cx: 15, cy: 17, r: 1.8, class: "fx-eye" }, s);
    svg("circle", { cx: 25, cy: 17, r: 1.8, class: "fx-eye" }, s);
    svg("path", { d: "M13.5 23 Q20 29.5 26.5 23", class: "fx-smile" }, s);
  }
  return s;
}

/**
 * The margin effects. layer is a fixed, pointer-free element with two children
 * [data-side="L"] and [data-side="R"].
 */
export function createShiftFx(layer) {
  const sides = { L: layer.querySelector('[data-side="L"]'), R: layer.querySelector('[data-side="R"]') };
  let seed = 1, cheer = 0;
  const later = (node, ms = FADE_MS) => setTimeout(() => node.remove(), ms);
  const replay = (node, cls) => { node.classList.remove(cls); void node.getBoundingClientRect(); node.classList.add(cls); };
  return {
    /** A same-side capital: key `key` on hand `hand`, so the other side was right. */
    same(hand, key) {
      const right = hand === "L" ? "R" : "L";
      const home = sides[right], wrong = sides[hand];
      if (!home || !wrong) return;
      home.querySelectorAll(".wc-shift").forEach((n) => n.remove());
      const paint = watercolourShift(seed++);
      home.appendChild(paint);
      later(paint, FADE_MS + 400);
      replay(home, "is-warn");
      const cap = document.createElement("span");
      cap.className = "fx-key";
      cap.textContent = key;
      const stack = wrong.querySelectorAll(".fx-key");
      if (stack.length >= 3) stack[0].remove();
      wrong.appendChild(cap);
      later(cap);
      layer.dataset.lastShift = "same";
    },
    /** Strict Shift: the same-side capital was refused. The same paint, and the key he hit struck through and shaken on its own side. */
    refuse(hand, key) {
      this.same(hand, key);
      const wrong = sides[hand];
      const cap = wrong && wrong.lastElementChild;
      if (cap && cap.classList.contains("fx-key")) cap.classList.add("is-refused");
      layer.dataset.lastShift = "refused";
    },
    /** An opposite-side capital: a small cheer on the side of the Shift he used. */
    ok(shift) {
      const side = sides[shift];
      if (!side) return;
      if (side.querySelector(".fx-glyph")) return; // one at a time: never a shower
      const g = glyph(cheer++ % 2 ? "smile" : "star");
      side.appendChild(g);
      later(g, 1100);
      layer.dataset.lastShift = "ok";
    },
    clear() { for (const s of Object.values(sides)) if (s) { s.replaceChildren(); s.classList.remove("is-warn"); } delete layer.dataset.lastShift; },
  };
}
