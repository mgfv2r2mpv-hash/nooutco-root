/* The arithmetic behind the BT intake's word minimums and their colours.
 *
 * Run it:  node scripts/min-words-model.mjs          (a readable report)
 *          node scripts/min-words-model.mjs --json   (the same figures as data)
 *
 * WHY A SCRIPT AND NOT A COMMENT. Every number the page shows a technician (65
 * words, 8 / 26 / 13 / 18 by section, the gold line, the five colours) came out
 * of a calculation, and a constant whose derivation lives in someone's head is a
 * constant the next person cannot move safely. The page's own file,
 * notes/bcba/min-words.js, carries the results; this file re-derives them and
 * the test min-words.spec.js fails if the two ever disagree.
 *
 * WHAT IS MEASURED AND WHAT IS CHOSEN. Two things here are measured: the length
 * of a typical fragment (read off the example lines the intake already shows)
 * and the contrast and colour-blind distances (pure arithmetic on the colours).
 * The rest is a judgement written down so it can be argued with: the 65-word
 * total is Kaleb's, the section weights follow the output ceilings the prompt
 * already gives each narrative, and the gold margin is "one more fragment".
 * Nothing here was fitted to technician behaviour, because no technician has
 * used the control yet; the first week of real counts should replace the
 * weights if they disagree.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BT_SOURCE = join(HERE, "..", "notes", "bcba", "tools", "bt.js");

/* ── 1. Section weights and the allocation of 65 words ───────────────────── */

export const TOTAL_WORDS = 65;

/* Weight = how many sentences of finished note the section is allowed to grow
   into, taken from NARRATIVE GUIDANCE in bt.js buildUserPrompt. The intake box
   is the thing a technician types, and the narrative is what the model grows
   from it, so the more room the form gives a narrative the more the box has to
   carry.
     fLesson    -> lessonProgressNarrative   up to 8 sentences
     fBehavior  -> behaviorPlanNarrative     up to 4, plus the consequence
                   ticks, their effectiveness and overall progress it also feeds
                   (counted as one more and a half)
     fAntecedent-> antecedentNarrative       three parts per strategy, two
                   strategies expected: about 4
     fSession   -> clinicalStatusNarrative   up to 2, plus who was present and
                   the purpose ticks it also feeds (half a sentence)
     fFollowUp  -> followUpNarrative         one brief sentence, optional */
export const WEIGHTS = { fSession: 2.5, fLesson: 8, fAntecedent: 4, fBehavior: 5.5 };

/* Largest-remainder rounding, so the four minimums add to the total exactly
   rather than to 64 or 66 after each is rounded on its own. */
export function allocate(weights, total) {
  const ids = Object.keys(weights);
  const sum = ids.reduce((s, id) => s + weights[id], 0);
  const raw = ids.map((id) => ({ id, exact: (weights[id] / sum) * total }));
  const out = {};
  raw.forEach((r) => { out[r.id] = Math.floor(r.exact); });
  let left = total - Object.values(out).reduce((s, v) => s + v, 0);
  raw
    .slice()
    .sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)))
    .forEach((r) => { if (left > 0) { out[r.id] += 1; left -= 1; } });
  return out;
}

/* ── 2. The gold line: "one more fragment" ──────────────────────────────── */

/* Median length of the example lines the intake shows technicians. A fragment
   is the unit a technician actually types ("Offered choice of work order"), so
   "a small but meaningful amount over the minimum" is one more of them. */
export function fragmentWords() {
  const src = readFileSync(BT_SOURCE, "utf8");
  const lens = [];
  for (const m of src.matchAll(/\\n- ([^\\"]+)/g)) {
    lens.push(m[1].trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length);
  }
  lens.sort((a, b) => a - b);
  const mid = Math.floor(lens.length / 2);
  const median = lens.length % 2 ? lens[mid] : (lens[mid - 1] + lens[mid]) / 2;
  return { lens, median: Math.round(median) };
}

/* The margin is the larger of one fragment and a fifth of the minimum. The
   fragment is the floor because below it a "bonus" is one stray word and means
   nothing; the fifth keeps the long sections from reaching gold on a token
   extra clause. Weber's reasoning, applied to words: the amount you must add
   before a reader notices a difference scales with what is already there. */
export const GOLD_FRACTION = 0.2;
export function goldMargin(min, fragment) {
  return Math.max(fragment, Math.ceil(GOLD_FRACTION * min));
}

/* ── 3. Colour ────────────────────────────────────────────────────────────── */

const toLin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const fromLin = (v) => { const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, c)) * 255); };
export const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const rgbToHex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

export function relLuminance(rgb) {
  const [r, g, b] = rgb.map(toLin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const la = relLuminance(a), lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Ottosson's OKLab, the space the page interpolates in at run time as well.
export function linToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export function oklabToLin([L, a, b]) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const rgbToOklab = (rgb) => linToOklab(rgb.map(toLin));
export const oklabToHex = (lab) => rgbToHex(oklabToLin(lab).map(fromLin));
export const deltaE = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

// Machado, Oliveira and Fernandes 2009, severity 1.0, applied in linear RGB.
export const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
function simulate(rgb, kind) {
  const lin = rgb.map(toLin);
  const M = CVD[kind];
  return M.map((row) => Math.min(1, Math.max(0, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])));
}
const cvdLab = (rgb, kind) => linToOklab(simulate(rgb, kind));

/* The two surfaces the outline touches: the box's own fill, and the page behind
   it. WCAG 1.4.11 asks 3:1 of a component's boundary against what it sits next
   to, and the lighter-than-ring side is the one that sets the limit. */
export const SURFACES = { box: "#fafcf8", page: "#eef1ea" };
export const MIN_CONTRAST = 3.0;

/* Stages, in the order progress passes through them. Hue is OKLab hue in
   degrees. Lightness is solved, not picked: the highest lightness the stage can
   have while its outline still reaches 3:1 on both surfaces. Yellow is the
   stage where that bites, because a yellow bright enough to read as yellow on a
   pale green box is below 1.7:1; the solver returns the mustard that clears
   3:1, and that is the honest yellow for an outline. */
export const STAGES = [
  { id: "red", hue: 29, at: 0 },
  { id: "orange", hue: 58, at: 0.4 },
  { id: "yellow", hue: 102, at: 0.75 },
  { id: "green", hue: 145, at: 1 },
];
export const GOLD_STAGE = { id: "gold", hue: 74 };

function maxChroma(L, hueDeg) {
  const h = (hueDeg * Math.PI) / 180;
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 40; i++) {
    const c = (lo + hi) / 2;
    const lin = oklabToLin([L, c * Math.cos(h), c * Math.sin(h)]);
    if (lin.every((v) => v >= -1e-6 && v <= 1 + 1e-6)) lo = c; else hi = c;
  }
  return lo;
}
const CHROMA_CAP = 0.19;
function colourAt(L, hueDeg) {
  const h = (hueDeg * Math.PI) / 180;
  const c = Math.min(CHROMA_CAP, maxChroma(L, hueDeg));
  return oklabToHex([L, c * Math.cos(h), c * Math.sin(h)]);
}
function passes(hex) {
  const rgb = hexToRgb(hex);
  return Object.values(SURFACES).every((s) => contrast(rgb, hexToRgb(s)) >= MIN_CONTRAST);
}
function lightestPassing(hueDeg) {
  for (let L = 0.82; L > 0.3; L -= 0.005) {
    const hex = colourAt(L, hueDeg);
    if (passes(hex)) return { L: Math.round(L * 1000) / 1000, hex };
  }
  throw new Error("no passing lightness for hue " + hueDeg);
}

/* Lightness is then pulled DOWN (never up) per stage to separate the stages for
   a viewer whose red and green collapse together. Search a coarse grid and keep
   the set whose WORST neighbouring distance, across normal, protan and deutan
   vision, is largest. Normal vision is weighted by 1 and the two impairments by
   0.6, so the answer cannot trade away the common case to help the rare one. */
function solvePalette() {
  const ceilings = STAGES.map((s) => lightestPassing(s.hue).L);
  const goldCeil = lightestPassing(GOLD_STAGE.hue).L;
  /* How far each stage may be pulled below its ceiling. Yellow and gold get
     little room on purpose: lowered far enough, a yellow outline stops reading
     as yellow and becomes brown, and the separation that buys a colour-blind
     viewer is separation the counter text already provides. */
  const room = { red: [0, 0.03, 0.06, 0.09, 0.12], orange: [0, 0.03, 0.06, 0.09], yellow: [0, 0.02], green: [0, 0.03, 0.06, 0.09, 0.12], gold: [0, 0.02, 0.04] };
  let best = null;
  const pick = (ceil, d) => Math.max(0.35, ceil - d);
  for (const a of room.red) for (const b of room.orange) for (const c of room.yellow) for (const d of room.green) for (const g of room.gold) {
    const Ls = [pick(ceilings[0], a), pick(ceilings[1], b), pick(ceilings[2], c), pick(ceilings[3], d)];
    const gL = pick(goldCeil, g);
    const hexes = STAGES.map((s, i) => colourAt(Ls[i], s.hue)).concat(colourAt(gL, GOLD_STAGE.hue));
    if (!hexes.every(passes)) continue;
    const rgbs = hexes.map(hexToRgb);
    let worst = Infinity;
    const pairs = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 3], [2, 4]];
    for (const [i, j] of pairs) {
      const normal = deltaE(rgbToOklab(rgbs[i]), rgbToOklab(rgbs[j]));
      const prot = deltaE(cvdLab(rgbs[i], "protan"), cvdLab(rgbs[j], "protan")) / 0.6;
      const deut = deltaE(cvdLab(rgbs[i], "deutan"), cvdLab(rgbs[j], "deutan")) / 0.6;
      worst = Math.min(worst, normal, prot, deut);
    }
    if (!best || worst > best.worst) best = { worst, hexes };
  }
  return best;
}

export function palette() {
  const solved = solvePalette();
  const [red, orange, yellow, green, gold] = solved.hexes;
  return { red, orange, yellow, green, gold, worstWeightedDistance: solved.worst };
}

// Interpolate between the stage colours in OKLab, so the path from red to green
// passes through orange and yellow rather than through the muddy middle that an
// RGB blend would give.
export function colourForProgress(p, pal) {
  const x = Math.min(1, Math.max(0, p));
  const stops = STAGES.map((s) => ({ at: s.at, lab: rgbToOklab(hexToRgb(pal[s.id])) }));
  let i = 0;
  while (i < stops.length - 2 && x > stops[i + 1].at) i++;
  const a = stops[i], b = stops[i + 1];
  const t = (x - a.at) / (b.at - a.at);
  return oklabToHex(a.lab.map((v, k) => v + (b.lab[k] - v) * t));
}

/* ── 4. How much the model has to grow the note ───────────────────────────── */

/* One real specimen, the note that started this: its five narratives total
   about 150 words. Dividing by the intake length gives the expansion the model
   performs. It is one data point and is labelled as one; its job is to show why
   a tenth of the output length is too little to write from. */
export const SPECIMEN_OUTPUT_WORDS = 150;

/* ── Report ───────────────────────────────────────────────────────────────── */

export function buildModel() {
  const mins = allocate(WEIGHTS, TOTAL_WORDS);
  const frag = fragmentWords();
  const sections = Object.keys(WEIGHTS).map((id) => ({
    id,
    weight: WEIGHTS[id],
    share: WEIGHTS[id] / Object.values(WEIGHTS).reduce((s, v) => s + v, 0),
    min: mins[id],
    goldMargin: goldMargin(mins[id], frag.median),
    gold: mins[id] + goldMargin(mins[id], frag.median),
  }));
  const pal = palette();
  const rgbs = Object.fromEntries(Object.entries(pal).filter(([k]) => k !== "worstWeightedDistance").map(([k, v]) => [k, hexToRgb(v)]));
  const contrastRows = Object.entries(rgbs).map(([id, rgb]) => ({
    id, hex: pal[id],
    onBox: contrast(rgb, hexToRgb(SURFACES.box)),
    onPage: contrast(rgb, hexToRgb(SURFACES.page)),
  }));
  const pairs = [["red", "orange"], ["orange", "yellow"], ["yellow", "green"], ["green", "gold"], ["red", "green"], ["yellow", "gold"]];
  const distances = pairs.map(([a, b]) => ({
    pair: a + " / " + b,
    normal: deltaE(rgbToOklab(rgbs[a]), rgbToOklab(rgbs[b])),
    protan: deltaE(cvdLab(rgbs[a], "protan"), cvdLab(rgbs[b], "protan")),
    deutan: deltaE(cvdLab(rgbs[a], "deutan"), cvdLab(rgbs[b], "deutan")),
    tritan: deltaE(cvdLab(rgbs[a], "tritan"), cvdLab(rgbs[b], "tritan")),
  }));
  const curve = Array.from({ length: 21 }, (_, i) => {
    const p = i / 20;
    const hex = colourForProgress(p, pal);
    const rgb = hexToRgb(hex);
    return { p, hex, onBox: contrast(rgb, hexToRgb(SURFACES.box)), onPage: contrast(rgb, hexToRgb(SURFACES.page)) };
  });
  const expansion = [20, 40, 65, 100].map((w) => ({ intakeWords: w, ratio: SPECIMEN_OUTPUT_WORDS / w }));
  return { total: TOTAL_WORDS, fragment: frag, sections, palette: pal, contrastRows, distances, curve, expansion, stages: STAGES };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const m = buildModel();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(m, null, 2));
  } else {
    const f = (n, d = 2) => n.toFixed(d);
    console.log("TOTAL", m.total, "words; fragment median", m.fragment.median, "from", m.fragment.lens.length, "example lines");
    console.table(m.sections.map((s) => ({ section: s.id, weight: s.weight, share: f(s.share * 100, 1) + "%", min: s.min, goldMargin: s.goldMargin, goldAt: s.gold })));
    console.log("PALETTE", m.palette);
    console.table(m.contrastRows.map((r) => ({ stage: r.id, hex: r.hex, onBox: f(r.onBox), onPage: f(r.onPage) })));
    console.table(m.distances.map((d) => ({ pair: d.pair, normal: f(d.normal, 3), protan: f(d.protan, 3), deutan: f(d.deutan, 3), tritan: f(d.tritan, 3) })));
    console.log("worst contrast along the red-to-green path:", f(Math.min(...m.curve.map((c) => Math.min(c.onBox, c.onPage)))));
    console.table(m.expansion.map((e) => ({ intakeWords: e.intakeWords, outputPerInputWord: f(e.ratio, 1) })));
  }
}
