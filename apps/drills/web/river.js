/* River Rhythm: the kayak stays mid-river while the beat between letters is
 * even, and drifts toward the bank when it goes uneven. His ask of
 * 2026-09-24, offered with the uneven-timing tip: twenty seconds of even
 * typing wins.
 *
 * The beat is read the way the tip reads it: letter to letter inside words
 * only, over the last RIVER_WINDOW gaps. A gap over PAUSE_GAP_MS is a pause,
 * not a beat, and is left out. Practice only: runs go to settings.games.
 * steadiness and driftOf are pure and exported for the node tests.
 */

export const RIVER_WINDOW = 8;
export const RIVER_GOAL_S = 20;
export const EVEN_CV = 0.35;      // at or under this, the water is calm
export const WILD_CV = 0.75;      // at this, the kayak is at the bank
export const PAUSE_GAP_MS = 1000;

/** Spread of the last gaps (coefficient of variation), or null with too few. */
export function steadiness(gaps) {
  const xs = (gaps || []).slice(-RIVER_WINDOW);
  if (xs.length < 4) return null;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  if (!m) return null;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
  return sd / m;
}

/** How far off centre, 0 (mid-river) to 1 (the bank), for a spread. */
export function driftOf(cv) {
  if (cv == null) return 0;
  return Math.max(0, Math.min(1, (cv - EVEN_CV) / (WILD_CV - EVEN_CV)));
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * Open the game. text: what to type (more is appended from `more` if he runs
 * out); runs: earlier River Rhythm runs; onResult(run) saves one.
 */
export function openRiver(host, { text, more = () => "", runs = [], progressLine = () => "", onResult = () => {}, onClose = () => {} }) {
  host.querySelector("[data-river]")?.remove();
  // Tests shorten the goal through window.__riverGoalS; he always gets the full twenty seconds.
  const goal = typeof window.__riverGoalS === "number" ? window.__riverGoalS : RIVER_GOAL_S;
  const box = el("div", "pairgame river");
  box.dataset.river = "1";
  box.setAttribute("role", "dialog");
  box.dataset.minigame = "river";
  // Keys aimed anywhere in the game (its Close too) stay in the game, where
  // the page's shortcuts never see them, and Escape closes it from anywhere.
  box.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); shut(); }
  });
  box.setAttribute("aria-label", "River Rhythm");
  box.append(el("h3", null, "River Rhythm"), el("p", "rv-how", `Keep an even beat between letters and the kayak stays mid-river. ${goal} seconds of even typing wins.`));
  const water = el("div", "rv-water");
  const kayak = el("span", "rv-kayak", "\u{1F6F6}");
  water.append(el("span", "rv-lane"), kayak);
  const meter = el("div", "rv-meter");
  const fill = el("span", "rv-fill");
  const label = el("span", "rv-label", `Even: 0.0 of ${goal} s`);
  meter.append(fill, label);
  const prompt = el("p", "pg-words rv-text", text);
  const input = el("input", "pg-input");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  input.placeholder = "Type the text at a steady beat. Accuracy is not scored here; the beat is.";
  const out = el("p", "pg-out");
  out.dataset.riverOut = "";
  const close = el("button", "soft pg-close", "Close");
  close.type = "button";
  box.append(water, meter, prompt, input, out, close);
  host.appendChild(box);

  const gaps = [];
  let lastKey = 0, lastWasLetter = false, t0 = 0, done = false;
  let even = 0, streak = 0, bestStreak = 0, lastTick = 0, side = 1, drift = 0;
  const all = [];
  const now = () => performance.now();

  const tick = () => {
    if (done || !t0) return;
    const t = now();
    const dt = (t - lastTick) / 1000;
    lastTick = t;
    const typing = t - lastKey < PAUSE_GAP_MS;
    const calm = typing && drift < 0.25 && gaps.length >= 4;
    if (calm) { even += dt; streak += dt; bestStreak = Math.max(bestStreak, streak); } else if (!typing || drift >= 0.25) streak = 0;
    fill.style.width = `${Math.min(100, (even / goal) * 100)}%`;
    label.textContent = `Even: ${Math.min(even, goal).toFixed(1)} of ${goal} s`;
    box.dataset.even = even.toFixed(1);
    if (even >= goal) finishGame();
  };
  const timer = setInterval(tick, 100);

  input.addEventListener("keydown", (e) => {
    if (done || e.key.length !== 1) return;
    const t = now();
    if (!t0) { t0 = t; lastTick = t; }
    const letter = /[A-Za-z]/.test(e.key);
    if (letter && lastWasLetter && lastKey && t - lastKey < PAUSE_GAP_MS) {
      gaps.push(t - lastKey);
      all.push(t - lastKey);
      const d = driftOf(steadiness(gaps));
      if (d > drift + 0.05 && drift < 0.05) side = Math.random() < 0.5 ? -1 : 1; // a fresh drift picks a bank
      drift = d;
      kayak.style.left = `${50 + side * drift * 38}%`;
      kayak.style.transform = `translateX(-50%) rotate(${side * drift * 25}deg)`;
      water.classList.toggle("is-rough", drift >= 0.25);
    }
    lastWasLetter = letter;
    lastKey = t;
  });
  input.addEventListener("input", () => {
    if (input.value.length > prompt.textContent.length - 40) prompt.textContent += " " + more();
  });

  function finishGame() {
    done = true;
    clearInterval(timer);
    input.disabled = true;
    const secs = Math.round(((now() - t0) / 1000) * 10) / 10;
    const run = { at: new Date().toISOString(), secs, bestStreak: Math.round(bestStreak * 10) / 10, spread: Math.round((steadiness(all.slice(-200)) || 0) * 100) };
    onResult(run);
    out.textContent = `You won in ${secs.toFixed(1)} s. Longest even stretch: ${run.bestStreak.toFixed(1)} s. ${progressLine([...runs, run], "secs", "s")}`.trim();
    box.dataset.done = "1";
    close.focus({ preventScroll: true });
  }
  const shut = () => { clearInterval(timer); box.remove(); onClose(); };
  close.addEventListener("click", shut);
  input.focus({ preventScroll: true });
  return box;
}
