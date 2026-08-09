// SVG chart for single-case records.
//
// The design goal is that the picture and the statistic never disagree. The
// dual-criteria lines drawn here are the same two lines the CDC test counted
// against, taken from the returned test object rather than recomputed, so a
// reader can see the points the test counted.
//
// Two line weights carry meaning and must not be collapsed: a solid dark rule
// is a condition change, a light dotted rule is a change inside a condition
// (a technician change, a setting change). Giving a staffing change the same
// visual authority as a phase change is how a record gets misread.
(function () {
  "use strict";

  var S = window.GVA_STATS;

  var COLOR = {
    base: "#3F4A55",
    tx: "#1F6FB2",
    ink: "#15181C",
    muted: "#7B848D",
    grid: "#EDF0F2",
    axis: "#B9C1C9",
    envelope: "#3F4A55",
    cdc: "#9C5D0A",
  };

  var GEOM = { W: 1000, H: 470, L: 66, R: 26, T: 40, B: 66, GAP: 0.7 };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function el(tag, attrs, text) {
    var parts = Object.keys(attrs).map(function (k) {
      return k + '="' + esc(attrs[k]) + '"';
    });
    return "<" + tag + " " + parts.join(" ") + (text === undefined
      ? "/>"
      : ">" + esc(text) + "</" + tag + ">");
  }

  // Lay every phase out on one running session index, leaving a gap at each
  // phase boundary so the change line has somewhere to sit.
  function layout(phases) {
    var cursor = 0;
    var placed = phases.map(function (p) {
      var xs = p.values.map(function (_, i) { return cursor + i; });
      cursor += p.values.length + GEOM.GAP;
      return { phase: p, xs: xs };
    });
    return { placed: placed, total: Math.max(1, cursor - GEOM.GAP) };
  }

  function scales(placed, total, maxYOverride) {
    var all = [];
    placed.forEach(function (p) { all = all.concat(p.phase.values); });
    var top = maxYOverride || Math.max(4, Math.ceil(Math.max.apply(null, all.concat([0])) * 1.14));
    var plotW = GEOM.W - GEOM.L - GEOM.R;
    var plotH = GEOM.H - GEOM.B - GEOM.T;
    return {
      maxY: top,
      x: function (v) { return GEOM.L + ((v + 0.5) / total) * plotW; },
      y: function (v) {
        var clamped = Math.max(0, Math.min(top, v));
        return GEOM.H - GEOM.B - (clamped / top) * plotH;
      },
    };
  }

  function axes(sc, ordinate, abscissa) {
    var out = "";
    var step = sc.maxY <= 10 ? 2 : sc.maxY <= 24 ? 4 : sc.maxY <= 60 ? 10 : 20;
    for (var g = 0; g <= sc.maxY; g += step) {
      out += el("line", { x1: GEOM.L, y1: sc.y(g), x2: GEOM.W - GEOM.R, y2: sc.y(g), stroke: COLOR.grid });
      out += el("text", {
        x: GEOM.L - 10, y: sc.y(g) + 4, "text-anchor": "end", "font-size": 12,
        fill: COLOR.muted, "font-family": "IBM Plex Mono, monospace",
      }, String(g));
    }
    out += el("line", { x1: GEOM.L, y1: sc.y(0), x2: GEOM.W - GEOM.R, y2: sc.y(0), stroke: COLOR.axis });
    out += el("line", { x1: GEOM.L, y1: GEOM.T, x2: GEOM.L, y2: sc.y(0), stroke: COLOR.axis });
    var midY = (GEOM.T + GEOM.H - GEOM.B) / 2;
    out += el("text", {
      x: 20, y: midY, "font-size": 12, fill: COLOR.muted, "text-anchor": "middle",
      transform: "rotate(-90 20 " + midY + ")",
    }, ordinate || "Value per session");
    out += el("text", {
      x: (GEOM.L + GEOM.W - GEOM.R) / 2, y: GEOM.H - 22, "font-size": 12,
      fill: COLOR.muted, "text-anchor": "middle",
    }, abscissa || "Consecutive sessions");
    return out;
  }

  // Condition changes get a solid rule with a label; within-condition changes
  // get a light dotted rule and no label, because they are not phase changes.
  function changeLines(placed, sc) {
    var out = "";
    for (var i = 1; i < placed.length; i++) {
      var prev = placed[i - 1];
      var cur = placed[i];
      if (!prev.xs.length || !cur.xs.length) continue;
      var mid = (sc.x(prev.xs[prev.xs.length - 1]) + sc.x(cur.xs[0])) / 2;
      var isCondition = prev.phase.cond !== cur.phase.cond;
      out += el("line", {
        x1: mid, y1: isCondition ? GEOM.T - 2 : GEOM.T + 14, x2: mid, y2: sc.y(0),
        stroke: isCondition ? COLOR.ink : COLOR.muted,
        "stroke-width": isCondition ? 1.4 : 0.8,
        "stroke-dasharray": isCondition ? "" : "2 4",
        opacity: isCondition ? 1 : 0.55,
      });
    }
    return out;
  }

  // IBM Plex Mono advance width at 11.5px. Used to decide how much of a phase
  // name fits before it would run into the next one.
  var LABEL_CHAR_PX = 6.3;
  var LABEL_MIN_CHARS = 4;

  function series(placed, sc, opts) {
    var out = "";
    placed.forEach(function (p, pi) {
      var color = p.phase.cond === "tx" ? COLOR.tx : COLOR.base;
      if (!p.xs.length) return;

      // Labels alternate between two rows, so each one may run until the phase
      // two along rather than the very next one. A long baseline with several
      // technician changes otherwise stacks six names on one line and none of
      // them can be read.
      var startX = sc.x(p.xs[0]);
      var nextTwo = placed[pi + 2];
      var limit = (nextTwo && nextTwo.xs.length ? sc.x(nextTwo.xs[0]) : GEOM.W - GEOM.R) - startX - 14;
      var maxChars = Math.floor(limit / LABEL_CHAR_PX);
      if (maxChars >= LABEL_MIN_CHARS) {
        var name = p.phase.name;
        var text = name.length > maxChars ? name.slice(0, Math.max(1, maxChars - 1)) + "…" : name;
        out += el("text", {
          x: startX, y: GEOM.T - (pi % 2 ? 8 : 21), "font-size": 11.5, fill: color,
          "font-family": "IBM Plex Mono, monospace",
        }, text);
      }

      out += el("polyline", {
        fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round",
        points: p.xs.map(function (x, i) { return sc.x(x) + "," + sc.y(p.phase.values[i]); }).join(" "),
      });

      p.xs.forEach(function (x, i) {
        var v = p.phase.values[i];
        out += p.phase.cond === "tx"
          ? el("rect", { x: sc.x(x) - 3.5, y: sc.y(v) - 3.5, width: 7, height: 7, fill: color })
          : el("circle", { cx: sc.x(x), cy: sc.y(v), r: 3.5, fill: color });
        if (opts.showValues) {
          out += el("text", {
            x: sc.x(x), y: sc.y(v) - 9, "font-size": 10, fill: color, "text-anchor": "middle",
            "font-family": "IBM Plex Mono, monospace",
          }, String(v));
        }
      });

      var x0 = sc.x(p.xs[0]) - 5;
      var x1 = sc.x(p.xs[p.xs.length - 1]) + 5;

      if (opts.showMean && p.phase.values.length > 1) {
        var m = S.mean(p.phase.values);
        out += el("line", {
          x1: x0, y1: sc.y(m), x2: x1, y2: sc.y(m), stroke: color,
          "stroke-width": 1, "stroke-dasharray": "2 3", opacity: 0.65,
        });
      }

      if (opts.showEnvelope && p.phase.values.length > 1) {
        var st = S.stability(p.phase.values, { width: opts.stabilityWidth });
        // Suppressed when the envelope is finer than the measurement grain -
        // drawing a band nothing can fall inside misleads more than it informs.
        if (st.available && !st.subGrain && S.isNum(st.lower)) {
          out += el("rect", {
            x: x0, y: sc.y(st.upper), width: Math.max(0, x1 - x0),
            height: Math.max(0, sc.y(st.lower) - sc.y(st.upper)),
            fill: COLOR.envelope, opacity: 0.06,
          });
        }
      }

      if (opts.showTrend && p.phase.values.length >= 2) {
        var ts = S.theilSen(p.phase.values);
        if (ts) {
          var last = p.phase.values.length - 1;
          out += el("line", {
            x1: sc.x(p.xs[0]), y1: sc.y(ts.at(0)),
            x2: sc.x(p.xs[last]), y2: sc.y(ts.at(last)),
            stroke: color, "stroke-width": 1.6, "stroke-dasharray": "9 5", opacity: 0.8,
          });
        }
      }
    });
    return out;
  }

  // The two criterion lines the CDC test actually counted against, extended
  // across the treatment phase. Drawn from the test object so the picture can
  // never drift from the number.
  function cdcOverlay(placed, sc, result, opts) {
    if (!opts.showCDC || !result.primary || !result.primary.cdc.available) return "";
    var cdc = result.primary.cdc;
    var fromPhase = result.primary.from.phase;
    var toPhase = result.primary.to.phase;

    var target = null;
    var source = null;
    placed.forEach(function (p) {
      if (p.phase === toPhase) target = p;
      if (p.phase === fromPhase) source = p;
    });
    if (!target || !target.xs.length || !source || !source.xs.length) return "";

    var xStart = sc.x(source.xs[source.xs.length - 1]);
    var xEnd = sc.x(target.xs[target.xs.length - 1]) + 6;
    var out = "";

    out += el("line", {
      x1: xStart, y1: sc.y(cdc.meanLine), x2: xEnd, y2: sc.y(cdc.meanLine),
      stroke: COLOR.cdc, "stroke-width": 1.3, "stroke-dasharray": "5 3", opacity: 0.9,
    });

    var n = target.xs.length;
    out += el("line", {
      x1: xStart, y1: sc.y(cdc.trendAt(-1)),
      x2: sc.x(target.xs[n - 1]), y2: sc.y(cdc.trendAt(n - 1)),
      stroke: COLOR.cdc, "stroke-width": 1.3, "stroke-dasharray": "1 3", opacity: 0.9,
    });

    // Ring the points the test counted, so "k of n" is checkable by eye.
    var dir = result.direction;
    target.xs.forEach(function (x, j) {
      var v = toPhase.values[j];
      var beats = dir === "dec"
        ? v < cdc.meanLine && v < cdc.trendAt(j)
        : v > cdc.meanLine && v > cdc.trendAt(j);
      if (!beats) return;
      out += el("circle", {
        cx: sc.x(x), cy: sc.y(v), r: 7, fill: "none",
        stroke: COLOR.cdc, "stroke-width": 1.2, opacity: 0.75,
      });
    });

    out += el("text", {
      x: xEnd, y: sc.y(cdc.meanLine) - 6, "text-anchor": "end", "font-size": 10,
      fill: COLOR.cdc, "font-family": "IBM Plex Mono, monospace",
    }, "CDC " + cdc.k + "/" + cdc.n + " need " + cdc.critical);

    return out;
  }

  function legend(result, opts) {
    var items = [
      ['<span class="key" style="border-top-color:' + COLOR.base + '"></span>', "Baseline condition"],
      ['<span class="key" style="border-top-color:' + COLOR.tx + '"></span>', "Intervention condition"],
    ];
    if (opts.showTrend) {
      items.push(['<span class="key" style="border-top-color:' + COLOR.muted + ';border-top-style:dashed"></span>', "Theil-Sen trend"]);
    }
    if (opts.showMean) {
      items.push(['<span class="key" style="border-top-color:' + COLOR.muted + ';border-top-style:dotted"></span>', "Phase mean"]);
    }
    if (opts.showCDC && result.primary && result.primary.cdc.available) {
      items.push(['<span class="key" style="border-top-color:' + COLOR.cdc + ';border-top-style:dashed"></span>', "Dual-criteria lines"]);
    }
    if (result.structure.withinChanges.length) {
      items.push(['<span class="key" style="border-top-color:' + COLOR.muted + ';border-top-style:dotted"></span>', "Change within a condition"]);
    }
    return items.map(function (pair) { return "<span>" + pair[0] + pair[1] + "</span>"; }).join("");
  }

  function render(svg, result, options) {
    var opts = options || {};
    var phases = result.structure.phases;
    if (!phases.length) {
      svg.innerHTML = el("text", {
        x: GEOM.W / 2, y: GEOM.H / 2, "text-anchor": "middle", "font-size": 14, fill: COLOR.muted,
      }, "No data to plot");
      return { legend: "" };
    }

    // Terminal view expands the last condition change so level and trend stay
    // readable when a long baseline would otherwise compress them away.
    var shown = phases;
    if (opts.view === "terminal" && result.primary) {
      var a = result.primary.from.phase;
      var b = result.primary.to.phase;
      shown = phases.filter(function (p) { return p === a || p === b; });
      if (shown.length < 2) shown = phases.slice(-2);
    }

    var lay = layout(shown);
    var sc = scales(lay.placed, lay.total);
    // Below roughly 15px per point, level and trend stop being readable.
    var density = (GEOM.W - GEOM.L - GEOM.R) / Math.max(1, lay.total);

    var body = "";
    body += axes(sc, opts.ordinate, opts.abscissa);
    body += changeLines(lay.placed, sc);
    body += cdcOverlay(lay.placed, sc, result, opts);
    body += series(lay.placed, sc, Object.assign({}, opts, {
      showValues: opts.showValues !== false && lay.total <= 34,
    }));

    svg.setAttribute("viewBox", "0 0 " + GEOM.W + " " + GEOM.H);
    svg.innerHTML =
      el("title", { id: "chartTitle" }, "Phase chart") +
      el("desc", { id: "chartDesc" },
        "Data path by phase with condition change lines, phase means, Theil-Sen trend lines" +
        (opts.showCDC ? ", and dual-criteria criterion lines" : "") + ".") +
      body;

    return {
      legend: legend(result, opts),
      density: density,
      cramped: density < 15,
    };
  }

  window.GVA_CHART = { render: render, COLOR: COLOR, GEOM: GEOM };
})();
