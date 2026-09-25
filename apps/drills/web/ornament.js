/* The garden in the margins.
 *
 * His ask, 2026-09-22: "As I type, the faster I am going or the more I have
 * written the more ornate it should become with increasingly animated little
 * cute vector drawings. Not distracting. Maybe the color of them warms up
 * toward a warm neutral and brighter blues as my speed keeps up."
 *
 * Two inputs, two effects, kept apart on purpose:
 *   words  (how much he has written)  -> GROWTH: the vines climb, leaves and
 *          blooms open, critters arrive. It only ever goes up in a drill.
 *   heat   (how fast, lately, against his OWN usual pace) -> WARMTH and TEMPO:
 *          colors lerp from cool slate to warm neutral with brighter blues, and
 *          the sway speeds up. It falls back when he pauses.
 *
 * Everything lives in the side margins and along the bottom edge, never under
 * the text, at modest opacity. prefers-reduced-motion keeps the growth and the
 * color and drops the motion.
 */

const NS = "http://www.w3.org/2000/svg";

/* Cool (heat 0) and warm (heat 1) palettes. Ink never changes: readability is
   not a reward. */
const COOL = {
  bg: [243, 245, 248], bg2: [233, 237, 243],
  stem: [150, 162, 176], leaf: [168, 181, 195], leaf2: [186, 197, 209],
  petalA: [196, 205, 216], petalB: [150, 172, 200], accent: [110, 136, 168], glow: [200, 212, 228],
};
const WARM = {
  bg: [250, 243, 233], bg2: [244, 233, 216],
  stem: [111, 150, 118], leaf: [128, 176, 138], leaf2: [166, 201, 150],
  petalA: [244, 186, 140], petalB: [44, 140, 255], accent: [23, 124, 255], glow: [255, 214, 170],
};

/* Dark mode keeps the garden's own colors and swaps only the ground they sit
   on: a deep slate cold, a deep warm umber hot. */
const DARK = { bg: [[28, 32, 40], [40, 32, 26]], bg2: [[18, 21, 27], [28, 22, 18]] };
const isDark = () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(",")})`;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function el(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  if (parent) parent.appendChild(n);
  return n;
}

/* ---- the little drawings -------------------------------------------- */

function leaf(g, x, y, angle, size) {
  const w = el("g", { class: "orn-leaf orn-sway", transform: `translate(${x} ${y}) rotate(${angle})` }, g);
  el("path", { d: `M0 0 C ${size * 0.5} ${-size * 0.45}, ${size} ${-size * 0.2}, ${size * 1.25} 0 C ${size} ${size * 0.2}, ${size * 0.5} ${size * 0.45}, 0 0 Z`, fill: "var(--orn-leaf)" }, w);
  el("path", { d: `M0 0 L ${size * 1.05} 0`, stroke: "var(--orn-leaf2)", "stroke-width": 1, fill: "none", opacity: 0.7 }, w);
  return w;
}

function daisy(g, x, y, r, which) {
  const f = el("g", { class: "orn-bloom orn-sway", transform: `translate(${x} ${y})` }, g);
  const fill = which % 2 ? "var(--orn-petalB)" : "var(--orn-petalA)";
  for (let i = 0; i < 6; i++) {
    el("ellipse", { cx: 0, cy: -r * 0.9, rx: r * 0.42, ry: r * 0.8, fill, transform: `rotate(${i * 60})`, opacity: 0.92 }, f);
  }
  el("circle", { cx: 0, cy: 0, r: r * 0.45, fill: "var(--orn-center)" }, f);
  return f;
}

function bell(g, x, y, r) {
  const f = el("g", { class: "orn-bloom orn-sway", transform: `translate(${x} ${y})` }, g);
  el("path", { d: `M ${-r} 0 Q ${-r} ${-r * 1.6} 0 ${-r * 1.6} Q ${r} ${-r * 1.6} ${r} 0 Q ${r * 0.5} ${-r * 0.35} 0 0 Q ${-r * 0.5} ${-r * 0.35} ${-r} 0 Z`, fill: "var(--orn-petalB)", opacity: 0.9 }, f);
  el("circle", { cx: 0, cy: r * 0.15, r: r * 0.18, fill: "var(--orn-center)" }, f);
  return f;
}

function butterfly(g, x, y, s) {
  const b = el("g", { class: "orn-critter orn-drift", transform: `translate(${x} ${y})` }, g);
  const inner = el("g", { transform: `scale(${s})` }, b);
  const wings = el("g", { class: "orn-flutter" }, inner);
  el("ellipse", { cx: -7, cy: -4, rx: 7, ry: 9, fill: "var(--orn-petalB)", opacity: 0.85 }, wings);
  el("ellipse", { cx: 7, cy: -4, rx: 7, ry: 9, fill: "var(--orn-petalB)", opacity: 0.85 }, wings);
  el("ellipse", { cx: -5, cy: 7, rx: 5, ry: 6, fill: "var(--orn-petalA)", opacity: 0.9 }, wings);
  el("ellipse", { cx: 5, cy: 7, rx: 5, ry: 6, fill: "var(--orn-petalA)", opacity: 0.9 }, wings);
  el("rect", { x: -1.4, y: -9, width: 2.8, height: 20, rx: 1.4, fill: "var(--orn-ink)" }, inner);
  el("path", { d: "M -1 -9 Q -4 -15 -6 -16 M 1 -9 Q 4 -15 6 -16", stroke: "var(--orn-ink)", "stroke-width": 1, fill: "none" }, inner);
  return b;
}

function bird(g, x, y, s, flip) {
  const b = el("g", { class: "orn-critter orn-hop", transform: `translate(${x} ${y}) scale(${flip ? -s : s} ${s})` }, g);
  el("ellipse", { cx: 0, cy: 0, rx: 13, ry: 10, fill: "var(--orn-accent)" }, b);
  el("circle", { cx: 9, cy: -6, r: 7, fill: "var(--orn-accent)" }, b);
  el("path", { d: "M 15 -7 L 21 -5 L 15 -3 Z", fill: "var(--orn-petalA)" }, b);
  el("circle", { cx: 11, cy: -8, r: 1.6, fill: "var(--orn-ink)" }, b);
  el("circle", { cx: 7.5, cy: -4, r: 1.8, fill: "var(--orn-petalA)", opacity: 0.55 }, b);
  el("path", { class: "orn-wing", d: "M -8 -2 Q 0 -12 6 0 Q -2 4 -8 -2 Z", fill: "var(--orn-glow)", opacity: 0.9 }, b);
  el("path", { d: "M -12 2 L -20 -2 L -19 5 Z", fill: "var(--orn-accent)" }, b);
  return b;
}

function bee(g, x, y, s) {
  const b = el("g", { class: "orn-critter orn-drift orn-drift-b", transform: `translate(${x} ${y}) scale(${s})` }, g);
  const wings = el("g", { class: "orn-flutter" }, b);
  el("ellipse", { cx: -3, cy: -8, rx: 5, ry: 7, fill: "#ffffff", opacity: 0.75 }, wings);
  el("ellipse", { cx: 4, cy: -8, rx: 5, ry: 7, fill: "#ffffff", opacity: 0.75 }, wings);
  el("ellipse", { cx: 0, cy: 0, rx: 10, ry: 7, fill: "var(--orn-petalA)" }, b);
  el("rect", { x: -3, y: -7, width: 2.6, height: 14, fill: "var(--orn-ink)", opacity: 0.75 }, b);
  el("rect", { x: 2.5, y: -7, width: 2.6, height: 14, fill: "var(--orn-ink)", opacity: 0.75 }, b);
  el("circle", { cx: 8, cy: -2, r: 1.3, fill: "var(--orn-ink)" }, b);
  return b;
}

function sparkle(g, x, y, s) {
  const p = el("g", { class: "orn-critter orn-twinkle", transform: `translate(${x} ${y}) scale(${s})` }, g);
  el("path", { d: "M 0 -9 Q 1.5 -1.5 9 0 Q 1.5 1.5 0 9 Q -1.5 1.5 -9 0 Q -1.5 -1.5 0 -9 Z", fill: "var(--orn-accent)" }, p);
  return p;
}

function snail(g, x, y, s) {
  const b = el("g", { class: "orn-critter orn-creep", transform: `translate(${x} ${y}) scale(${s})` }, g);
  el("path", { d: "M -16 6 Q -16 0 -6 0 L 14 0 Q 20 0 20 6 Z", fill: "var(--orn-leaf2)" }, b);
  el("circle", { cx: 2, cy: -6, r: 10, fill: "var(--orn-petalA)" }, b);
  el("path", { d: "M 2 -6 m -5 0 a 5 5 0 1 1 5 5 a 3 3 0 1 1 -3 -3", stroke: "var(--orn-accent)", "stroke-width": 1.6, fill: "none" }, b);
  el("path", { d: "M 16 0 L 19 -8 M 18 0 L 23 -6", stroke: "var(--orn-leaf2)", "stroke-width": 1.5 }, b);
  return b;
}

/* ---- the garden ------------------------------------------------------ */

/**
 * @param {SVGSVGElement} svg  a full-window, pointer-events:none layer
 * @param {{ column: number }} opts  width of the central text column, kept clear
 */
export function createGarden(svg, opts = {}) {
  const column = opts.column || 880;
  const root = document.documentElement;
  let W = 0, H = 0;
  let vines = [];      // { path, len, leaves: [{t, node}], blooms: [{t, node}] }
  let critters = [];   // { level, node }
  let meadow = null;
  let growth = 0, level = 0, heat = 0;

  function build() {
    W = window.innerWidth; H = window.innerHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.replaceChildren();
    vines = []; critters = [];
    const margin = Math.max(0, (W - column) / 2);
    const g = el("g", {}, svg);
    // No margin to grow in: a narrow window gets the meadow only.
    const sides = margin >= 70 ? [margin * 0.45, W - margin * 0.45] : [];
    sides.forEach((cx, si) => {
      const amp = Math.min(22, margin * 0.16);
      const pts = [];
      for (let y = H + 10; y >= 70; y -= 12) {
        pts.push([cx + amp * Math.sin(y / 70 + si * 2.1), y]);
      }
      const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      const path = el("path", { d, class: "orn-stem", fill: "none", stroke: "var(--orn-stem)", "stroke-width": 2.4, "stroke-linecap": "round" }, g);
      const len = path.getTotalLength();
      path.style.strokeDasharray = `${len}`;
      path.style.strokeDashoffset = `${len}`;
      const vine = { path, len, leaves: [], blooms: [] };
      for (let t = 0.03, i = 0; t < 0.98; t += 0.042, i++) {
        const pt = path.getPointAtLength(len * t);
        const node = leaf(g, pt.x, pt.y, (i % 2 ? -1 : 1) * (35 + (i * 17) % 25) + (i % 2 ? 180 : 0), 9 + (i % 3) * 2);
        node.classList.add("orn-item"); node.style.setProperty("--d", `${(i % 7) * -0.4}s`);
        vine.leaves.push({ t, node });
      }
      for (let t = 0.12, i = 0; t < 0.98; t += 0.11, i++) {
        const pt = path.getPointAtLength(len * t);
        const dx = (i % 2 ? 1 : -1) * 12;
        const node = i % 3 === 2 ? bell(g, pt.x + dx, pt.y, 7) : daisy(g, pt.x + dx, pt.y, 6 + (i % 2) * 1.5, i + si);
        node.classList.add("orn-item"); node.style.setProperty("--d", `${(i % 5) * -0.7}s`);
        vine.blooms.push({ t, node, needs: i });
      }
      vines.push(vine);
    });
    // The meadow along the bottom edge: tufts that appear as the level rises.
    meadow = el("g", { class: "orn-meadow" }, g);
    const tufts = Math.floor(W / 46);
    for (let i = 0; i < tufts; i++) {
      const x = 12 + i * (W - 24) / tufts + ((i * 37) % 17);
      const tuft = el("g", { class: "orn-tuft orn-sway", transform: `translate(${x.toFixed(1)} ${H + 2})` }, meadow);
      for (let k = -1; k <= 1; k++) {
        el("path", { d: `M 0 0 Q ${k * 4} -10 ${k * 7} ${-14 - ((i + k) % 3) * 4}`, stroke: "var(--orn-leaf)", "stroke-width": 2, fill: "none", "stroke-linecap": "round" }, tuft);
      }
      tuft.classList.add("orn-item"); tuft.dataset.need = String(1 + (i % 6));
      tuft.style.setProperty("--d", `${(i % 9) * -0.3}s`);
    }
    // Critters, by the level at which each arrives. Placed in the margins.
    const L = sides[0] ?? 40, R = sides[1] ?? W - 40;
    const plan = [
      [2, () => sparkle(g, L + 26, H * 0.72, 0.9)],
      [3, () => butterfly(g, L - 10, H * 0.55, 0.9)],
      [4, () => snail(g, R - 30, H - 16, 0.9)],
      [5, () => bird(g, R + 4, H * 0.42, 0.9, true)],
      [6, () => sparkle(g, R - 24, H * 0.62, 0.8)],
      [7, () => bee(g, L + 22, H * 0.34, 0.9)],
      [8, () => butterfly(g, R + 12, H * 0.24, 0.8)],
      [9, () => bird(g, L - 4, H * 0.18, 0.8, false)],
      [10, () => sparkle(g, L + 30, H * 0.12, 0.7)],
      [11, () => bee(g, R - 20, H * 0.8, 0.8)],
      [12, () => sparkle(g, W / 2 - column / 2 - 16, 44, 0.6)],
      [12, () => sparkle(g, W / 2 + column / 2 + 16, 44, 0.6)],
    ];
    if (sides.length) {
      for (const [lv, draw] of plan) {
        const node = draw();
        node.classList.add("orn-item");
        node.style.setProperty("--d", `${(lv % 4) * -0.9}s`);
        critters.push({ level: lv, node });
      }
    }
    apply();
  }

  function apply() {
    for (const v of vines) {
      v.path.style.strokeDashoffset = `${v.len * (1 - growth)}`;
      v.path.style.opacity = growth > 0.02 ? 1 : 0;
      for (const l of v.leaves) l.node.classList.toggle("on", growth >= l.t);
      for (const b of v.blooms) b.node.classList.toggle("on", growth >= b.t && level >= 1 + b.needs * 0.8);
    }
    if (meadow) for (const t of meadow.children) t.classList.toggle("on", level >= Number(t.dataset.need));
    for (const c of critters) c.node.classList.toggle("on", level >= c.level);
    // Warmth: colors and tempo from heat.
    const h = heat;
    const P = {};
    for (const k of Object.keys(COOL)) P[k] = mix(COOL[k], WARM[k], h);
    const dark = isDark();
    root.style.setProperty("--bg", dark ? mix(DARK.bg[0], DARK.bg[1], h) : P.bg);
    root.style.setProperty("--bg2", dark ? mix(DARK.bg2[0], DARK.bg2[1], h) : P.bg2);
    root.style.setProperty("--orn-stem", P.stem);
    root.style.setProperty("--orn-leaf", P.leaf);
    root.style.setProperty("--orn-leaf2", P.leaf2);
    root.style.setProperty("--orn-petalA", P.petalA);
    root.style.setProperty("--orn-petalB", P.petalB);
    root.style.setProperty("--orn-accent", P.accent);
    root.style.setProperty("--orn-glow", P.glow);
    root.style.setProperty("--orn-center", mix([214, 200, 170], [255, 196, 92], h));
    root.style.setProperty("--accent", P.accent);
    root.style.setProperty("--heat", h.toFixed(3));
    // Tempo: one sway cycle every 6s cold, every 2.4s hot.
    root.style.setProperty("--tempo", `${lerp(6, 2.4, h).toFixed(2)}s`);
    svg.dataset.level = String(level);
  }

  build();
  if (typeof matchMedia === "function") matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => apply());
  let resizeTimer = 0;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(build, 120); });

  return {
    /** words written so far and heat 0..1; call as often as you like. */
    update({ words, heat: h }) {
      const w = Math.max(0, words || 0);
      growth = 1 - Math.exp(-w / 70);
      heat = clamp01(h || 0);
      level = Math.min(14, Math.floor(w / 14) + Math.round(heat * 4));
      apply();
    },
    /** Back to bare ground for a new drill, color kept where it was. */
    reset() { growth = 0; level = 0; apply(); },
    /** Let the warmth fall back to cool over a few seconds after a drill. */
    cool() { heat = 0; apply(); },
    get state() { return { growth, level, heat }; },
  };
}

/**
 * Heat: how fast, lately, against his own usual pace. A rolling window of
 * placed keystrokes, smoothed, scaled so his usual NWAM sits near a third and
 * his best sits near the top.
 */
export function createHeat({ usual = 35, best = 70 } = {}) {
  const lo = Math.max(10, usual * 0.7);
  const hi = Math.max(lo + 10, best * 1.02);
  const WINDOW_MS = 6000;
  // A stop right after a full stop or a new line is planning the next point.
  // The garden holds its warmth through it, up to THINK_GRACE_MS, so thinking
  // at a sentence end costs nothing on screen. A stop mid-sentence cools.
  const THINK_GRACE_MS = 8000;
  let stamps = [];
  let smooth = 0;
  let lastT = 0;
  let lastPress = -Infinity;
  let lastCh = "";
  return {
    press(t, ch = "") { stamps.push(t); lastPress = t; lastCh = ch; },
    /** @returns {{ wpm: number, heat: number, holding?: boolean }} at time t (ms) */
    read(t) {
      stamps = stamps.filter((s) => t - s <= WINDOW_MS);
      if (/[.!?\n]/.test(lastCh) && t - lastPress > 600 && t - lastPress < THINK_GRACE_MS) {
        lastT = t;
        return { wpm: (stamps.length / 5) / (WINDOW_MS / 60000), heat: smooth, holding: true };
      }
      const span = Math.min(WINDOW_MS, Math.max(1500, t - (stamps[0] ?? t)));
      const wpm = (stamps.length / 5) / (span / 60000);
      const target = clamp01((wpm - lo) / (hi - lo));
      const dt = Math.max(0, t - lastT) / 1000;
      lastT = t;
      const k = 1 - Math.exp(-dt / 2.5);  // about 2.5s to settle
      smooth += (target - smooth) * k;
      return { wpm, heat: smooth };
    },
    reset() { stamps = []; smooth = 0; lastT = 0; lastPress = -Infinity; lastCh = ""; },
  };
}
