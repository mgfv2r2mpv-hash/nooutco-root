/* The pair game: a slow pair from the round, ten words that hold it, typed
 * against the clock in a small window over the results. His ask of
 * 2026-09-24: "a clickable tooltip with 10 different words with the tricky
 * combination for me to blast through in the moment, like a mini game."
 *
 * Practice only: nothing here goes into history, bests or bands.
 * pickWords is pure and exported for the node tests.
 */

import { closeGames } from "./gamebox.js";

export const GAME_WORDS = 10;

const clean = (w) => String(w || "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * Ten words holding `pair`. Words from the field (the passages, the bank)
 * come first, the ones he will type in his notes; the dictionary fills the
 * rest, shorter words first. No repeats; 3 to 11 letters.
 */
export function pickWords(pair, { field = [], dictionary = [], n = GAME_WORDS, rand = Math.random } = {}) {
  const p = clean(pair);
  if (p.length !== 2) return [];
  const fits = (w) => w.length >= 3 && w.length <= 11 && w.includes(p);
  const seen = new Set();
  const out = [];
  const take = (list) => {
    for (const w of list) {
      if (out.length >= n) return;
      if (!fits(w) || seen.has(w)) continue;
      seen.add(w);
      out.push(w);
    }
  };
  const fieldWords = shuffle([...new Set(field.flatMap((t) => String(t).split(/\s+/)).map(clean))], rand);
  take(fieldWords);
  if (out.length < n) {
    const pool = dictionary.map(clean).filter(fits).filter((w) => !seen.has(w));
    pool.sort((a, b) => a.length - b.length);
    // The shortest few hundred, shuffled, so each game is new but plain.
    take(shuffle(pool.slice(0, 300), rand));
  }
  return out;
}

function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Milliseconds per pair: the mean gap between the pair's two letters. */
export function pairMs(events, pair) {
  const p = clean(pair);
  const gaps = [];
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1], b = events[i];
    if (a.kind === "char" && b.kind === "char" && (a.key + b.key).toLowerCase() === p) gaps.push(b.t - a.t);
  }
  return gaps.length ? Math.round(gaps.reduce((s, x) => s + x, 0) / gaps.length) : null;
}

/* The race: the hare bolts, then idles doing something silly; the tortoise
   moves only as he types, and it always wins when the last word lands. */
const HARE_BITS = [
  ["\u{1FAA5}", "brushing his teeth"],
  ["\u{1F4FA}", "watching TV"],
  ["\u{1F4A4}", "napping"],
  ["\u{1F955}", "snacking"],
  ["\u{1F4F1}", "scrolling his phone"],
];
function race() {
  const track = document.createElement("div");
  track.className = "pg-track";
  const lane = (cls, face) => { const n = document.createElement("span"); n.className = cls; n.textContent = face; track.appendChild(n); return n; };
  const hare = lane("pg-hare", "\u{1F407}");
  const bubble = lane("pg-bubble", "");
  const tortoise = lane("pg-tortoise", "\u{1F422}");
  lane("pg-flag", "\u{1F3C1}");
  let bit = 0, idle = 0, wait = 0;
  return {
    node: track,
    go() {
      hare.classList.add("is-bolt");
      wait = setTimeout(() => {
        const show = () => { const [face, what] = HARE_BITS[bit++ % HARE_BITS.length]; bubble.textContent = face; bubble.title = `The hare is ${what}`; bubble.classList.add("is-on"); };
        show();
        idle = setInterval(show, 1800);
      }, 1100);
    },
    step(frac) { tortoise.style.left = `${Math.min(1, frac) * 84}%`; },
    win() {
      clearTimeout(wait); clearInterval(idle);
      tortoise.style.left = "84%";
      tortoise.classList.add("is-win");
      bubble.textContent = "\u{2757}";
      hare.classList.add("is-late");
    },
    stop() { clearTimeout(wait); clearInterval(idle); },
  };
}

/**
 * Open the game over the page. host is where the window goes; roundMs is the
 * pair's time in the round just typed; runs are his earlier races on this
 * pair; onResult(run) saves one (minigames.js).
 */
export function openPairGame(host, { pair, words, roundMs = null, runs = [], progressLine = () => "", onResult = () => {}, onClose = () => {} }) {
  closeGames(host);
  const box = document.createElement("div");
  box.className = "pairgame";
  box.dataset.pairgame = pair;
  box.setAttribute("role", "dialog");
  box.dataset.minigame = "pair";
  // Keys aimed anywhere in the game (its Close too) stay in the game, where
  // the page's shortcuts never see them, and Escape closes it from anywhere.
  box.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); shut(); }
  });
  box.setAttribute("aria-label", `Pair race: ${pair}`);
  const title = document.createElement("h3");
  title.textContent = `The tortoise and the hare: "${pair}"`;
  const track = race();
  const list = document.createElement("p");
  list.className = "pg-words";
  const spans = words.map((w) => {
    const s = document.createElement("span");
    s.className = "pg-word";
    s.textContent = w;
    list.append(s, " ");
    return s;
  });
  const input = document.createElement("input");
  input.className = "pg-input";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  input.placeholder = "Type the words, space after each. The clock starts on your first key.";
  const out = document.createElement("p");
  out.className = "pg-out";
  out.dataset.pairgameOut = "";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "soft pg-close";
  close.textContent = "Close";
  box.append(title, track.node, list, input, out, close);
  host.appendChild(box);

  const events = [];
  let t0 = 0, done = false;
  spans[0]?.classList.add("is-cur");
  const finishGame = () => {
    done = true;
    input.disabled = true;
    track.win();
    const secs = Math.round(((performance.now() - t0) / 1000) * 10) / 10;
    const wpm = Math.round((words.join(" ").length + 1) / 5 / (secs / 60));
    const ms = pairMs(events, pair);
    const run = { at: new Date().toISOString(), secs, wpm, ms, roundMs };
    onResult(run);
    const vs = ms != null && roundMs ? ` "${pair}" took ${ms} ms, against ${roundMs} ms in the round${ms < roundMs ? ". Faster." : "."}` : "";
    const prog = ms != null ? progressLine([...runs, run], "ms", "ms on the pair") : "";
    out.textContent = `The tortoise wins. ${words.length} words in ${secs.toFixed(1)} s, ${wpm} wpm.${vs} ${prog}`.trim();
    box.dataset.done = "1";
    close.focus({ preventScroll: true });
  };
  input.addEventListener("keydown", (e) => {
    if (done) return;
    if (!t0 && e.key.length === 1) { t0 = performance.now(); track.go(); }
    if (e.key.length === 1) events.push({ t: performance.now(), kind: "char", key: e.key });
  });
  input.addEventListener("input", () => {
    const typed = input.value.split(" ");
    const complete = typed.length - 1;
    spans.forEach((s, i) => {
      s.classList.toggle("is-ok", i < complete && typed[i] === words[i]);
      s.classList.toggle("is-bad", i < complete && typed[i] !== words[i]);
      s.classList.toggle("is-cur", i === complete);
    });
    track.step(complete / words.length);
    if (complete >= words.length) finishGame();
  });
  const shut = (handBack = true) => { track.stop(); box.remove(); if (handBack) onClose(); };
  box.shut = () => shut(false);
  close.addEventListener("click", () => shut());
  input.focus({ preventScroll: true });
  return box;
}
