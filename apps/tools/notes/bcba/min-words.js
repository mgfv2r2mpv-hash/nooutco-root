/* Word minimums for a note tool's intake: the count, the per-section floor, the
 * colour a box shows on the way to it, and the "ready" reading the bar draws.
 *
 * Pure. It draws nothing and reads no DOM, so the engine owns every pixel and a
 * test can drive it with plain strings. Loaded as a classic script, and also
 * require()-able so scripts/min-words-model.mjs can check it against its own
 * arithmetic.
 *
 * WHY THIS EXISTS. A technician who writes eleven words gets a note the model
 * has to grow fivefold, and what it grows it from is its own register rather
 * than hers. A floor on what she types buys two things at once: more of her
 * actual observations in the record, and a prompt that can be strict about
 * inventing, because there is something to be strict against. The floor is
 * split by section because the form is not even: lesson progress and behavior
 * carry the clinical weight, and a note can be thin where it is only telling the
 * BCBA something.
 *
 * WHERE THE NUMBERS COME FROM. Nothing below is a free choice. The weights,
 * the 65, the gold margin and the five colours are derived in
 * scripts/min-words-model.mjs, and tests/min-words.spec.js fails if this file
 * and that one ever disagree. To move a number, move it there first.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MinWords = api;
})(typeof window !== "undefined" ? window : this, function () {
  /* ── The five colours, solved in scripts/min-words-model.mjs ─────────────
     Each clears 3:1 against both the box fill (#fafcf8) and the page behind it
     (#eef1ea), which is what WCAG 1.4.11 asks of an outline that is the only
     thing marking a state. Yellow is a mustard rather than a lemon for the same
     reason: a yellow bright enough to look like yellow is 1.7:1 on this page. */
  var PALETTE = {
    red: "#ee5647",
    orange: "#b76300",
    yellow: "#9a8b00",
    green: "#00771d",
    gold: "#ad7300",
  };

  /* Where on the way to the minimum each colour is fully itself. Between two,
     the colour is blended in OKLab, so red passes through orange and yellow on
     the way to green and never through the brown an RGB blend would give. */
  var STOPS = [
    { id: "red", at: 0 },
    { id: "orange", at: 0.4 },
    { id: "yellow", at: 0.75 },
    { id: "green", at: 1 },
  ];

  /* "Small but meaningful" past the minimum: one more fragment (the median
     example line the form already shows is 6 words) or a fifth of the minimum,
     whichever is more. */
  var GOLD_FRACTION = 0.2;
  var FRAGMENT_WORDS = 6;

  /* ── Counting ────────────────────────────────────────────────────────────
     A word is a run of non-space characters with a letter or digit in it, so a
     bullet, an arrow or a lone "-" is not one, and "face-to-face" and "x2" are
     one each. A token repeated straight after itself counts once: "a a a a" is
     the only cheap way past a counter, and it costs a technician nothing to
     leave out. */
  function count(text) {
    var tokens = String(text == null ? "" : text).split(/\s+/);
    var n = 0, prev = "";
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (!/[A-Za-z0-9]/.test(t)) continue;
      var key = t.toLowerCase();
      if (key === prev) continue;
      prev = key;
      n += 1;
    }
    return n;
  }

  /* ── The plan: minimums from weights ─────────────────────────────────────
     Largest-remainder rounding so the minimums add to the total exactly. */
  function allocate(weights, total) {
    var ids = Object.keys(weights);
    var sum = ids.reduce(function (s, id) { return s + weights[id]; }, 0);
    var out = {};
    var rem = ids.map(function (id) {
      var exact = (weights[id] / sum) * total;
      out[id] = Math.floor(exact);
      return { id: id, frac: exact - Math.floor(exact) };
    });
    var left = total - ids.reduce(function (s, id) { return s + out[id]; }, 0);
    rem.sort(function (a, b) { return b.frac - a.frac; }).forEach(function (r) {
      if (left > 0) { out[r.id] += 1; left -= 1; }
    });
    return out;
  }

  function goldMargin(min) {
    return Math.max(FRAGMENT_WORDS, Math.ceil(GOLD_FRACTION * min));
  }

  /* cfg: { total, weights: { fieldId: weight }, optional: [fieldId] }
     An optional field is counted and shown but has no floor, which is how a
     section that may honestly be thin stays out of the way. */
  function plan(cfg) {
    if (!cfg || !cfg.weights) return null;
    var mins = allocate(cfg.weights, cfg.total);
    var fields = Object.keys(cfg.weights).map(function (id) {
      return { id: id, min: mins[id], gold: mins[id] + goldMargin(mins[id]) };
    });
    var byId = {};
    fields.forEach(function (f) { byId[f.id] = f; });
    (cfg.optional || []).forEach(function (id) {
      byId[id] = { id: id, min: 0, gold: 0, optional: true };
    });
    return { total: cfg.total, fields: fields, byId: byId, optional: cfg.optional || [] };
  }

  /* ── Colour ──────────────────────────────────────────────────────────────── */
  function hexToRgb(h) {
    return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); });
  }
  function toLin(c) {
    var v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function fromLin(v) {
    var c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, c)) * 255);
  }
  function toOklab(hex) {
    var lin = hexToRgb(hex).map(toLin);
    var l = Math.cbrt(0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2]);
    var m = Math.cbrt(0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2]);
    var s = Math.cbrt(0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2]);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }
  function fromOklab(lab) {
    var l = Math.pow(lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2], 3);
    var m = Math.pow(lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2], 3);
    var s = Math.pow(lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2], 3);
    var lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    return "#" + lin.map(function (v) { return fromLin(v).toString(16).padStart(2, "0"); }).join("");
  }

  function colourFor(progress) {
    var x = Math.min(1, Math.max(0, progress || 0));
    var i = 0;
    while (i < STOPS.length - 2 && x > STOPS[i + 1].at) i++;
    var a = STOPS[i], b = STOPS[i + 1];
    var t = (x - a.at) / (b.at - a.at);
    var la = toOklab(PALETTE[a.id]), lb = toOklab(PALETTE[b.id]);
    return fromOklab(la.map(function (v, k) { return v + (lb[k] - v) * t; }));
  }

  /* ── Reading a set of values against a plan ─────────────────────────────── */
  function stateOf(n, f) {
    if (f.optional) return "optional";
    if (n >= f.gold) return "gold";
    if (n >= f.min) return "met";
    return "short";
  }

  /* One section's reading. `color` is what the outline shows: the blend while
     the box is short, green once it is met, gold beyond the margin. */
  function readField(f, text) {
    var n = count(text);
    var state = stateOf(n, f);
    var progress = f.min > 0 ? Math.min(1, n / f.min) : 1;
    return {
      id: f.id,
      count: n,
      min: f.min,
      gold: f.gold,
      state: state,
      progress: progress,
      remaining: Math.max(0, f.min - n),
      color: state === "gold" ? PALETTE.gold : colourFor(progress),
    };
  }

  /* The whole intake. `filled` caps each section at its own floor, so a long
     lesson cannot make up for a missing antecedent: the bar fills only with the
     words each section was asked for, and reaches `total` only when every
     section has met its floor. */
  function read(p, values) {
    if (!p) return null;
    var fields = {};
    var filled = 0;
    var allGold = true;
    p.fields.forEach(function (f) {
      var r = readField(f, values && values[f.id]);
      fields[f.id] = r;
      filled += Math.min(r.count, r.min);
      if (r.state !== "gold") allGold = false;
    });
    p.optional.forEach(function (id) {
      fields[id] = readField(p.byId[id], values && values[id]);
    });
    var progress = p.total > 0 ? Math.min(1, filled / p.total) : 1;
    var ready = filled >= p.total;
    return {
      fields: fields,
      filled: filled,
      total: p.total,
      remaining: Math.max(0, p.total - filled),
      ready: ready,
      progress: progress,
      color: ready ? (allGold ? PALETTE.gold : PALETTE.green) : colourFor(progress),
    };
  }

  /* What Generate says when it is refused: the sections still short, the most
     missing first, in the technician's own labels. */
  function shortfall(p, values, labelOf) {
    var r = read(p, values);
    if (!r) return [];
    return p.fields
      .map(function (f) { return r.fields[f.id]; })
      .filter(function (x) { return x.state === "short"; })
      .sort(function (a, b) { return b.remaining - a.remaining; })
      .map(function (x) { return { id: x.id, label: labelOf ? labelOf(x.id) : x.id, remaining: x.remaining, min: x.min }; });
  }

  return {
    count: count,
    plan: plan,
    allocate: allocate,
    goldMargin: goldMargin,
    read: read,
    readField: readField,
    shortfall: shortfall,
    colourFor: colourFor,
    PALETTE: PALETTE,
    STOPS: STOPS,
    GOLD_FRACTION: GOLD_FRACTION,
    FRAGMENT_WORDS: FRAGMENT_WORDS,
  };
});
