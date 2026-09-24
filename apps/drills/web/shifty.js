/* Shifty Shifts: twenty words, thirteen of them with a capital, and a car
 * that drives as he types them. His ask of 2026-09-24: offered on the review
 * screen when a Shift went wrong, with an even split of left and right Shifts
 * (the thirteenth to a random side) and weird ones, like "inFixed", so the
 * capital is not always first. A tachometer shows each shift: fast and clean
 * revs high, slow or wrong-side stalls it.
 *
 * Each capital is timed three ways: Shift down to the letter, the letter to
 * letting go of Shift, and letting go to the next key. Practice only: the
 * run goes to settings.games (minigames.js), never to history.
 *
 * buildShifty is pure and exported for the node tests.
 */

export const SHIFTY_WORDS = 20;
export const SHIFTY_CAPS = 13;

const LEFT = new Set("qwertasdfgzxcvb");
const handOfLetter = (ch) => (LEFT.has(ch.toLowerCase()) ? "L" : "R");

function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Twenty words; thirteen carry one capital. The Shift each capital needs is
 * the one opposite its letter's hand; six go to one Shift and seven to the
 * other, the extra side chosen at random. Capitals sit first, inside, or
 * last in the word. Returns { words, caps: [{ word, index, shift, where }] }.
 */
export function buildShifty(pool, rand = Math.random) {
  const words = [...new Set((pool || []).map((w) => String(w).toLowerCase()).filter((w) => /^[a-z]{4,9}$/.test(w)))];
  if (words.length < SHIFTY_WORDS * 2) return null;
  const extraLeft = rand() < 0.5;
  const shifts = shuffle([...Array(extraLeft ? 7 : 6).fill("L"), ...Array(extraLeft ? 6 : 7).fill("R")], rand);
  const wheres = shuffle([...Array(5).fill("start"), ...Array(5).fill("inside"), ...Array(3).fill("end")], rand);
  const slots = shuffle([...Array(SHIFTY_WORDS).keys()], rand).slice(0, SHIFTY_CAPS).sort((a, b) => a - b);
  const used = new Set();
  const out = new Array(SHIFTY_WORDS).fill(null);
  const caps = [];
  const order = shuffle(words, rand);
  slots.forEach((slot, k) => {
    const shift = shifts[k];
    const needHand = shift === "L" ? "R" : "L"; // the letter sits under the other hand
    let where = wheres[k];
    const fit = (w, wh) => {
      const idx = wh === "start" ? [0] : wh === "end" ? [w.length - 1] : [...Array(w.length - 2).keys()].map((i) => i + 1);
      return idx.filter((i) => handOfLetter(w[i]) === needHand);
    };
    let pick = null;
    for (const wh of [where, "inside", "start", "end"]) {
      for (const w of order) {
        if (used.has(w)) continue;
        const idx = fit(w, wh);
        if (idx.length) { pick = { w, i: idx[Math.floor(rand() * idx.length)] }; where = wh; break; }
      }
      if (pick) break;
    }
    if (!pick) return;
    used.add(pick.w);
    out[slot] = pick.w.slice(0, pick.i) + pick.w[pick.i].toUpperCase() + pick.w.slice(pick.i + 1);
    caps.push({ word: slot, index: pick.i, shift, where });
  });
  for (let i = 0; i < SHIFTY_WORDS; i++) {
    if (out[i]) continue;
    const w = order.find((x) => !used.has(x));
    used.add(w);
    out[i] = w;
  }
  return { words: out, caps };
}

/** Revs for one shift, from its three times added up: quick and clean runs high. */
export function rpmOf(totalMs, wrong = false) {
  if (wrong || !Number.isFinite(totalMs)) return 800;
  return Math.round(8000 * Math.min(1, Math.max(0.1, (600 - totalMs) / 500)));
}

const avg = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.appendChild(n);
  return n;
}

/** The tachometer: a half dial to 8000, the last 1500 in red. */
function tach() {
  const s = svg("svg", { viewBox: "0 0 120 72", class: "sh-tach" });
  svg("path", { d: "M10 64 A50 50 0 0 1 110 64", class: "sh-dial" }, s);
  svg("path", { d: "M97.9 31.7 A50 50 0 0 1 110 64", class: "sh-red" }, s);
  for (let k = 0; k <= 8; k++) {
    const a = Math.PI * (1 - k / 8);
    svg("line", { x1: 60 + 44 * Math.cos(a), y1: 64 - 44 * Math.sin(a), x2: 60 + 50 * Math.cos(a), y2: 64 - 50 * Math.sin(a), class: "sh-tick" }, s);
  }
  const needle = svg("line", { x1: 60, y1: 64, x2: 60, y2: 20, class: "sh-needle" }, s);
  svg("circle", { cx: 60, cy: 64, r: 4, class: "sh-hub" }, s);
  const label = svg("text", { x: 60, y: 54, class: "sh-rpm" }, s);
  label.textContent = "0";
  return { node: s, set(rpm) { needle.style.transform = `rotate(${-90 + (Math.min(8000, rpm) / 8000) * 180}deg)`; label.textContent = (rpm / 1000).toFixed(1); } };
}

/**
 * Open the game over the page. runs: his earlier Shifty runs, for the
 * progress line; onResult(run) saves one; judge(shiftSide, hand) is the
 * drill's own Shift rule.
 */
export function openShifty(host, { built, runs = [], judge, handOf, progressLine = () => "", onResult = () => {}, onClose = () => {} }) {
  host.querySelector("[data-shifty]")?.remove();
  const box = el("div", "pairgame shifty");
  box.dataset.shifty = "1";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Shifty Shifts");
  const head = el("div", "sh-head");
  head.append(el("h3", null, "Shifty Shifts"), el("span", "sh-sub", "13 capitals, both Shifts, some in odd places"));
  const road = el("div", "sh-road");
  const car = el("span", "sh-car", "\u{1F3CE}\uFE0F");
  road.append(car, el("span", "sh-flag", "\u{1F3C1}"));
  const gauge = tach();
  const top = el("div", "sh-top");
  top.append(road, gauge.node);
  const list = el("p", "pg-words");
  const spans = built.words.map((w) => { const s = el("span", "pg-word", w); list.append(s, " "); return s; });
  const input = el("input", "pg-input");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  input.placeholder = "Type the line, capitals and all. The clock starts on your first key.";
  const out = el("p", "pg-out");
  out.dataset.shiftyOut = "";
  const close = el("button", "soft pg-close", "Close");
  close.type = "button";
  box.append(head, top, list, input, out, close);
  host.appendChild(box);
  spans[0]?.classList.add("is-cur");

  let t0 = 0, done = false, wrong = 0;
  let shiftDown = null, shiftCode = null, letterAt = null, releasedAt = null;
  const downToKey = [], keyToUp = [], upToNext = [];
  let lastParts = null;
  const now = () => performance.now();

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { shut(); return; }
    if (done) return;
    const t = now();
    if (!t0 && e.key.length === 1) t0 = t;
    if (e.key === "Shift") { if (!e.repeat) { shiftDown = t; shiftCode = e.code; } return; }
    if (releasedAt != null && e.key.length === 1) {
      upToNext.push(t - releasedAt);
      if (lastParts) { lastParts.push(t - releasedAt); gauge.set(rpmOf(lastParts.reduce((s, x) => s + x, 0))); lastParts = null; }
      releasedAt = null;
    }
    if (/^[A-Z]$/.test(e.key) && e.shiftKey && shiftDown != null && letterAt == null) {
      const side = shiftCode === "ShiftLeft" ? "L" : shiftCode === "ShiftRight" ? "R" : null;
      const hand = handOf(e.code);
      if (side && hand && judge(side, hand) === "same") {
        e.preventDefault(); // the drill's strict rule: the wrong Shift does not type
        wrong += 1;
        gauge.set(rpmOf(0, true));
        box.classList.remove("is-stall"); void box.offsetWidth; box.classList.add("is-stall");
        return;
      }
      letterAt = t;
      downToKey.push(t - shiftDown);
      lastParts = [t - shiftDown];
    }
  });
  input.addEventListener("keyup", (e) => {
    if (e.key !== "Shift") return;
    const t = now();
    if (letterAt != null) { keyToUp.push(t - letterAt); if (lastParts) lastParts.push(t - letterAt); releasedAt = t; }
    letterAt = null; shiftDown = null; shiftCode = null;
  });
  input.addEventListener("input", () => {
    const typed = input.value.split(" ");
    const complete = typed.length - 1;
    spans.forEach((s, i) => {
      s.classList.toggle("is-ok", i < complete && typed[i] === built.words[i]);
      s.classList.toggle("is-bad", i < complete && typed[i] !== built.words[i]);
      s.classList.toggle("is-cur", i === complete);
    });
    car.style.left = `${Math.min(1, complete / built.words.length) * 86}%`;
    if (complete >= built.words.length) finishGame();
  });

  function finishGame() {
    done = true;
    input.disabled = true;
    const secs = Math.round(((now() - t0) / 1000) * 10) / 10;
    const chars = built.words.join(" ").length + 1;
    const run = {
      at: new Date().toISOString(), secs, wpm: Math.round(chars / 5 / (secs / 60)), wrong,
      shifts: downToKey.length, downToKey: avg(downToKey), keyToUp: avg(keyToUp), upToNext: avg(upToNext),
    };
    onResult(run);
    const parts = [`${secs.toFixed(1)} s, ${run.wpm} wpm, ${wrong} wrong-side.`];
    if (run.downToKey != null) parts.push(`Shift to letter ${run.downToKey} ms, letter to let go ${run.keyToUp} ms, let go to next key ${run.upToNext ?? "-"} ms.`);
    parts.push(progressLine([...runs, run], "secs", "s"));
    out.textContent = parts.filter(Boolean).join(" ");
    box.dataset.done = "1";
    close.focus({ preventScroll: true });
  }
  const shut = () => { box.remove(); onClose(); };
  close.addEventListener("click", shut);
  input.focus({ preventScroll: true });
  return box;
}
