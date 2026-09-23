/* The ornament around the drill, for the screens where he is not typing.
 *
 * His ask, 2026-09-23: "the screens are very spartan. Can we make them more
 * ornate especially when not in typing modes so I am visually living for the
 * app?" His standing rule: fun and ornate, never distracting while typing; the
 * more written and the faster, the more ornate.
 *
 * So this module only decorates. It reads what drill.js has already put on the
 * page (the phase, the stars, the garden's level, the calendar and trophy
 * case) and never changes a number or a word. It runs on its own, loaded by
 * index.html beside drill.js, so the drill works the same without it.
 *
 *   calm     body[data-calm] while a round is armed or running: the washes dim
 *            and stop, and nothing new moves.
 *   glory    results[data-glory] from the stars: best, beat, clean or plain.
 *            --rich from the garden's level (how much, how fast) scales the
 *            sunburst behind the number.
 *   burst    a one-time confetti burst on a personal best (skipped when the Mac
 *            asks for reduced motion).
 *   calendar each day's badge count becomes --n, so busier days glow warmer.
 *   trophies a trophy unlocked by this drill gets .is-fresh and a shine sweep.
 */

const NS = "http://www.w3.org/2000/svg";
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* A filigree corner, drawn once and turned for each corner of a card. */
function corner(where) {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 64 64");
  s.setAttribute("class", `filigree ${where}`);
  s.setAttribute("aria-hidden", "true");
  s.innerHTML =
    '<path class="fil-line" d="M4 60 V20 Q4 4 20 4 H60"/>' +
    '<path class="fil-line thin" d="M10 60 V24 Q10 10 24 10 H60"/>' +
    '<path class="fil-curl" d="M20 4 Q14 16 22 20 Q30 22 28 14 Q26 9 21 12"/>' +
    '<path class="fil-curl" d="M4 20 Q16 14 20 22 Q22 30 14 28 Q9 26 12 21"/>' +
    '<circle class="fil-gem" cx="10" cy="10" r="3.2"/>' +
    '<path class="fil-leaf" d="M34 10 Q40 3 46 10 Q40 12 34 10 Z"/>' +
    '<path class="fil-leaf" d="M10 34 Q3 40 10 46 Q12 40 10 34 Z"/>';
  return s;
}

/* A rule with a diamond in the middle, under the big heading. */
function divider() {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 240 16");
  s.setAttribute("class", "divider");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML =
    '<path class="div-line" d="M2 8 H100 M140 8 H238"/>' +
    '<path class="div-curl" d="M100 8 Q108 1 114 8 Q108 15 100 8 M140 8 Q132 1 126 8 Q132 15 140 8"/>' +
    '<path class="div-gem" d="M120 1 L127 8 L120 15 L113 8 Z"/>';
  return s;
}

function frame(card) {
  if (!card || card.querySelector(":scope > .filigree")) return;
  for (const w of ["tl", "tr", "bl", "br"]) card.appendChild(corner(w));
}

/* ---- the confetti burst ------------------------------------------------ */

const CONFETTI = ["#f3c75a", "#e8a33d", "#7fb0f0", "#f2a38a", "#9cc3a4", "#ffffff"];

export function burst(fromEl, count = 46) {
  if (reduced() || !fromEl) return null;
  const r = fromEl.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.className = "confetti";
  layer.setAttribute("aria-hidden", "true");
  layer.dataset.confetti = "";
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("i");
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const d = 120 + Math.random() * 180;
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    p.style.setProperty("--dx", `${Math.cos(a) * d}px`);
    p.style.setProperty("--dy", `${Math.sin(a) * d * 0.7 - 60}px`);
    p.style.setProperty("--r", `${Math.round(Math.random() * 720 - 360)}deg`);
    p.style.setProperty("--c", CONFETTI[i % CONFETTI.length]);
    p.style.animationDelay = `${Math.random() * 120}ms`;
    if (i % 3 === 0) p.className = "round";
    layer.appendChild(p);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 2400);
  return layer;
}

/* ---- readings of what drill.js drew ----------------------------------- */

/** best > beat > clean > plain, from the star labels drill.js renders. */
export function gloryOf(labels) {
  const on = (re) => labels.some((l) => re.test(l));
  if (on(/personal best/i)) return "best";
  if (on(/beat your last/i)) return "beat";
  if (on(/clean/i)) return "clean";
  return "plain";
}

function readStars(results) {
  return [...results.querySelectorAll("[data-drill-stars] .star.on")].map((n) => n.textContent || "");
}

function garnishCalendar(root) {
  const days = [...root.querySelectorAll(".cal-day.has")];
  for (const d of days) {
    const n = Number(d.querySelector("[data-cal-count]")?.dataset.calCount || 0);
    d.style.setProperty("--n", String(Math.min(1, n / 5).toFixed(2)));
  }
}

function markFresh(trophies, unlocked) {
  const fresh = new Set([...unlocked.querySelectorAll("[data-unlocked]")].map((n) => n.dataset.unlocked));
  for (const li of trophies.querySelectorAll("[data-trophy]")) li.classList.toggle("is-fresh", fresh.has(li.dataset.trophy));
}

/* ---- wiring ------------------------------------------------------------ */

export function flourish(doc = document) {
  const main = doc.querySelector("main.drill");
  if (!main) return;
  const body = doc.body;
  const setup = doc.querySelector("[data-drill-setup]");
  const results = doc.querySelector("[data-drill-results]");
  const stars = doc.querySelector("[data-drill-stars]");
  const hero = doc.querySelector("[data-drill-hero]");
  const cal = doc.querySelector("[data-drill-calendar]");
  const cups = doc.querySelector("[data-drill-trophies]");
  const unlocked = doc.querySelector("[data-drill-unlocked]");
  const garden = doc.querySelector("[data-garden]");

  frame(setup);
  frame(results);
  const h1 = setup && setup.querySelector("h1");
  if (h1 && !setup.querySelector(".divider")) h1.after(divider());

  const calm = () => {
    const s = main.dataset.drillState;
    body.dataset.calm = s === "armed" || s === "running" ? "1" : "";
  };
  new MutationObserver(calm).observe(main, { attributes: true, attributeFilter: ["data-drill-state"] });
  calm();

  if (results && stars) {
    new MutationObserver(() => {
      if (!stars.children.length) return;
      const glory = gloryOf(readStars(results));
      results.dataset.glory = glory;
      const level = Number(garden && garden.dataset.level) || 0;
      results.style.setProperty("--rich", (Math.min(14, level) / 14).toFixed(2));
      // Replay the entrance each drill, not only the first.
      results.classList.remove("is-in");
      void results.offsetWidth;
      results.classList.add("is-in");
      if (glory === "best") requestAnimationFrame(() => burst(hero));
    }).observe(stars, { childList: true });
  }
  if (cal) new MutationObserver(() => garnishCalendar(cal)).observe(cal, { childList: true });
  if (cups && unlocked) {
    const fresh = () => markFresh(cups, unlocked);
    new MutationObserver(fresh).observe(cups, { childList: true });
    new MutationObserver(fresh).observe(unlocked, { childList: true });
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => flourish());
  else flourish();
}
