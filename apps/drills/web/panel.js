/* The end-of-drill panel: progress over time, tricky keys moving, bests.
 *
 * The arithmetic here is pure and exported for the node tests (bests, streak,
 * key trends). The drawing helpers build SVG and need a document.
 */
import { BANDS } from "./score.js";

const NS = "http://www.w3.org/2000/svg";

/* ---- numbers ---------------------------------------------------------- */

/** Best NWAM per clock length: { "1": 72.4, "2": 68 } */
export function bests(history) {
  const out = {};
  for (const h of history || []) {
    if (!h || !Number.isFinite(h.nwam) || !h.minutes) continue;
    const k = String(h.minutes);
    if (!(k in out) || h.nwam > out[k]) out[k] = h.nwam;
  }
  return out;
}

/** Local calendar day of an ISO stamp, "2026-09-22". */
export const dayOf = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Days in a row, ending today or yesterday, with at least one drill. */
export function streak(history, now = new Date()) {
  const days = new Set((history || []).map((h) => h && dayOf(h.at)).filter(Boolean));
  const d = new Date(now);
  let n = 0;
  if (!days.has(dayOf(d.toISOString()))) d.setDate(d.getDate() - 1);
  while (days.has(dayOf(d.toISOString()))) { n += 1; d.setDate(d.getDate() - 1); }
  return n;
}

/** Drills in the current sitting: consecutive drills no more than 20 minutes apart. */
export function sitting(history, now = Date.now()) {
  const list = (history || []).filter((h) => h && h.at).map((h) => Date.parse(h.at)).filter(Number.isFinite).sort((a, b) => a - b);
  let n = 0;
  let t = now;
  for (let i = list.length - 1; i >= 0; i--) {
    if (t - list[i] > 20 * 60000) break;
    n += 1;
    t = list[i];
  }
  return n;
}

/** The band he is in, the next one, and how far off it is. */
export function ladder(nwam) {
  const i = BANDS.findIndex((b) => nwam >= b.min);
  const here = BANDS[i < 0 ? BANDS.length - 1 : i];
  const next = i > 0 ? BANDS[i - 1] : null;
  return { here: here.name, next: next ? next.name : null, toNext: next ? Math.max(0, Math.ceil(next.min - nwam)) : 0 };
}

/**
 * His own ladder at one clock: his usual (the median of his last ten drills
 * there, once he has three), his best before this drill, and the next
 * milestone, the next multiple of five above both. The bands are the field's
 * yardstick; this one is his, so there is always a next rung.
 * `history` is the prior drills of this kind; nothing here is written back.
 */
export function personalLadder(nwam, history, minutes) {
  const same = (history || []).filter((h) => h && h.minutes === minutes && Number.isFinite(h.nwam));
  const recent = same.slice(-10).map((h) => h.nwam).sort((a, b) => a - b);
  const mid = recent.length >> 1;
  const usual = recent.length >= 3 ? Math.round(recent.length % 2 ? recent[mid] : (recent[mid - 1] + recent[mid]) / 2) : null;
  const best = same.length ? Math.max(...same.map((h) => h.nwam)) : null;
  const top = Math.max(Number.isFinite(nwam) ? nwam : 0, best || 0);
  const milestone = (Math.floor(top / 5) + 1) * 5;
  return { usual, best, milestone, toMilestone: Math.max(0, Math.ceil(milestone - (Number.isFinite(nwam) ? nwam : 0))), n: same.length };
}

/** Stars for a drill: beat your last at this clock, 97%+ accuracy, a personal best. */
export function stars(score, history, minutes) {
  const same = (history || []).filter((h) => h && h.minutes === minutes);
  const prev = same.length ? same[same.length - 1] : null;
  const best = same.reduce((m, h) => Math.max(m, h.nwam || 0), 0);
  return {
    beatLast: !!prev && score.nwam > prev.nwam,
    clean: score.accuracy >= 0.97,
    best: score.nwam > best && score.gwam > 0,
  };
}

/**
 * Tricky keys over time: for each letter, the miss rate per drill (misses per
 * press), over the drills where it was pressed at least `minPresses` times.
 * Sorted by how tricky it is lately.
 */
export function keyTrends(history, { lastN = 30, minPresses = 4, top = 6 } = {}) {
  const drills = (history || []).filter((h) => h && h.keys).slice(-lastN);
  const per = {};
  drills.forEach((h, i) => {
    for (const [k, v] of Object.entries(h.keys)) {
      if (!v || v.presses < minPresses) continue;
      (per[k] || (per[k] = [])).push({ i, rate: v.misses / v.presses, presses: v.presses, misses: v.misses });
    }
  });
  const rows = Object.entries(per).map(([key, series]) => {
    const half = Math.max(1, Math.floor(series.length / 2));
    const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x.rate, 0) / xs.length : 0);
    const early = avg(series.slice(0, half));
    const late = avg(series.slice(-half));
    const misses = series.reduce((s, x) => s + x.misses, 0);
    const presses = series.reduce((s, x) => s + x.presses, 0);
    return { key, series: series.map((x) => x.rate), early, late, rate: presses ? misses / presses : 0, misses, presses };
  }).filter((r) => r.misses > 0);
  rows.sort((a, b) => b.late - a.late || b.rate - a.rate);
  return rows.slice(0, top);
}

/** Miss rate per letter over the last N drills, for the keyboard. */
export function keyboardRates(history, lastN = 20) {
  const acc = {};
  for (const h of (history || []).filter((x) => x && x.keys).slice(-lastN)) {
    for (const [k, v] of Object.entries(h.keys)) {
      const a = acc[k] || (acc[k] = { presses: 0, misses: 0 });
      a.presses += v.presses || 0;
      a.misses += v.misses || 0;
    }
  }
  const out = {};
  for (const [k, a] of Object.entries(acc)) out[k] = { ...a, rate: a.presses ? a.misses / a.presses : 0 };
  return out;
}

/* ---- drawing ---------------------------------------------------------- */

function el(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  if (parent) parent.appendChild(n);
  return n;
}

/**
 * A line chart. series: [{ values: number[], cls, dots? }], values may hold null.
 * The y range covers every series; a dashed guide line can mark a value.
 */
export function lineChart(series, { width = 560, height = 150, guide = null, guideLabel = "", yFormat = (v) => String(Math.round(v)), min = null, max = null } = {}) {
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "chart", role: "img" });
  const all = series.flatMap((s) => s.values.filter((v) => Number.isFinite(v)));
  if (guide != null) all.push(guide);
  if (!all.length) {
    el("text", { x: width / 2, y: height / 2, "text-anchor": "middle", class: "chart-empty" }, svg).textContent = "Your line starts after your first drill.";
    return svg;
  }
  const pad = { l: 34, r: 10, t: 10, b: 18 };
  let lo = min ?? Math.min(...all), hi = max ?? Math.max(...all);
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const span = hi - lo;
  if (min == null) lo -= span * 0.08;
  if (max == null) hi += span * 0.08;
  const n = Math.max(...series.map((s) => s.values.length), 2);
  const X = (i) => pad.l + (i * (width - pad.l - pad.r)) / (n - 1);
  const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  for (const f of [0, 0.5, 1]) {
    const v = lo + (hi - lo) * (1 - f);
    const y = pad.t + f * (height - pad.t - pad.b);
    el("line", { x1: pad.l, x2: width - pad.r, y1: y, y2: y, class: "chart-grid" }, svg);
    el("text", { x: pad.l - 6, y: y + 3, "text-anchor": "end", class: "chart-axis" }, svg).textContent = yFormat(v);
  }
  if (guide != null) {
    el("line", { x1: pad.l, x2: width - pad.r, y1: Y(guide), y2: Y(guide), class: "chart-guide" }, svg);
    if (guideLabel) el("text", { x: width - pad.r, y: Y(guide) - 4, "text-anchor": "end", class: "chart-axis" }, svg).textContent = guideLabel;
  }
  for (const s of series) {
    let d = "";
    s.values.forEach((v, i) => { if (Number.isFinite(v)) d += (d ? " L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); });
    if (d) el("path", { d, class: "chart-line " + (s.cls || "") }, svg);
    if (s.dots) s.values.forEach((v, i) => { if (Number.isFinite(v)) el("circle", { cx: X(i), cy: Y(v), r: i === s.values.length - 1 ? 4 : 2.4, class: "chart-dot " + (s.cls || "") }, svg); });
  }
  return svg;
}

/** A tiny line, for a key's miss rate across drills. */
export function sparkline(values, { width = 110, height = 26 } = {}) {
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "spark" });
  const v = values.filter(Number.isFinite);
  if (v.length < 2) { el("circle", { cx: width / 2, cy: height / 2, r: 2.5, class: "spark-dot" }, svg); return svg; }
  const hi = Math.max(...v, 0.05);
  const X = (i) => 3 + (i * (width - 6)) / (v.length - 1);
  const Y = (x) => height - 3 - (x / hi) * (height - 6);
  el("path", { d: v.map((x, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(x).toFixed(1)).join(" "), class: "spark-line" }, svg);
  el("circle", { cx: X(v.length - 1), cy: Y(v[v.length - 1]), r: 2.6, class: "spark-dot" }, svg);
  return svg;
}

const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

/** The keyboard, each key shaded by its miss rate. */
export function keyboard(rates) {
  const k = 34, gap = 5;
  const width = 10 * (k + gap) + 20, height = 3 * (k + gap) + 6;
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, class: "kbd" });
  const worst = Math.max(0.02, ...Object.values(rates).map((r) => r.rate || 0));
  ROWS.forEach((row, r) => {
    const off = [0, 0.5, 1.2][r] * (k + gap) / 1.2;
    [...row].forEach((ch, c) => {
      const x = 4 + off + c * (k + gap), y = 3 + r * (k + gap);
      const info = rates[ch];
      const t = info && info.presses ? Math.min(1, info.rate / worst) : 0;
      const g = el("g", { class: "kbd-key", "data-key": ch }, svg);
      el("rect", { x, y, width: k, height: k, rx: 7, style: `--t:${t.toFixed(3)}`, class: info && info.presses ? "kbd-cap" : "kbd-cap is-empty" }, g);
      el("text", { x: x + k / 2, y: y + k / 2 + 4, "text-anchor": "middle", class: "kbd-label" }, g).textContent = ch;
      el("title", {}, g).textContent = info && info.presses
        ? `${ch}: ${info.misses} missed of ${info.presses} (${(info.rate * 100).toFixed(1)}%)`
        : `${ch}: not enough presses yet`;
    });
  });
  return svg;
}
