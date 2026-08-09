// Wiring: state, editor, render loop, and the gated graph-image read.
(function () {
  "use strict";

  var S = window.GVA_STATS;
  var V = window.GVA_VERDICT;
  var C = window.GVA_CHART;
  var R = window.GVA_REDACT;

  var TOOL_ID = "graphva";
  var DRAFT_KEY = "graphva";
  var REQUEST_TIMEOUT_MS = 60000;

  // A record with staffing churn across a long baseline and one plan. It is the
  // shape this tool exists for: six drawn phase changes, one condition change.
  var SAMPLE = [
    { name: "Baseline A", cond: "base", data: "7, 0" },
    { name: "Baseline B (BT left 1/12)", cond: "base", data: "1, 5, 1" },
    { name: "Baseline C (new BT 2/4)", cond: "base", data: "1, 1, 18, 12, 17, 6" },
    { name: "Baseline D (BT left case 2/27)", cond: "base", data: "0, 0, 0, 0, 0, 1, 0, 1" },
    { name: "Baseline E (new BT 4/29)", cond: "base", data: "1, 0, 1, 0, 4, 3, 2, 1, 2, 3, 2" },
    { name: "Baseline F (new BT added 6/3)", cond: "base", data: "5, 2, 0, 1, 5, 5, 4, 6, 12, 1, 0, 1, 0, 1, 5, 3, 10" },
    { name: "Plan 1 (autoswitch 7/13)", cond: "tx", data: "2, 10, 9, 13, 6, 2, 5, 5, 7, 4" },
  ];

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var r1 = function (v) { return S.isNum(v) ? (Math.round(v * 10) / 10).toFixed(1) : "n/a"; };
  var r2 = function (v) { return S.isNum(v) ? (Math.round(v * 100) / 100).toFixed(2) : "n/a"; };
  var pctS = function (v) { return S.isNum(v) ? Math.round(v * 100) + "%" : "n/a"; };

  var state = { phases: null, editor: null, images: [] };

  // --- persistence ---------------------------------------------------------

  function saveDraft() {
    if (!state.phases) return;
    if (!window.NotesGate || !NotesGate.draft) return;
    NotesGate.draft.save(DRAFT_KEY, {
      phases: state.phases,
      direction: $("direction").value,
      scale: $("scale").value,
    });
  }

  function loadDraft() {
    if (!window.NotesGate || !NotesGate.draft) return null;
    try { return NotesGate.draft.load(DRAFT_KEY); } catch (e) { return null; }
  }

  // --- options -------------------------------------------------------------

  function options() {
    return {
      direction: $("direction").value,
      scale: $("scale").value,
      ordinate: $("scale").selectedOptions[0].textContent,
      stabilityWidth: parseFloat($("envWidth").value),
      designOverride: $("design").value === "auto" ? null : $("design").value,
      targetKind: $("direction").value === "inc" ? "acquisition" : "reduction",
      view: $("view").value,
      showMean: $("showMean").checked,
      showTrend: $("showTrend").checked,
      showCDC: $("showCDC").checked,
      showEnvelope: $("showEnvelope").checked,
    };
  }

  // --- render --------------------------------------------------------------

  function render() {
    var opts = options();
    var result = V.evaluate(state.phases, opts);

    var chartInfo = C.render($("chart"), result, opts);
    $("legend").innerHTML = chartInfo.legend;
    renderChartNotes(result, chartInfo);
    renderVerdict(result);
    renderTiles(result);
    renderLegacy(result);
    renderMetrics(result);
    renderTransitions(result);
    saveDraft();
    return result;
  }

  function renderChartNotes(result, chartInfo) {
    var notes = [];
    if (chartInfo.cramped) {
      notes.push("Below about 15 pixels per data point, level and trend stop being readable. Switch the view to the terminal condition change for an expanded scale.");
    }
    // design.js already emits a richer within-condition warning, so adding one
    // here printed the same point twice.
    result.warnings.forEach(function (w) { notes.push(w); });
    $("chartNotes").innerHTML = notes.length
      ? '<div class="banner info"><ul>' + notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul></div>"
      : "";
  }

  function findingClass(finding) {
    if (finding === V.FINDING.PROGRESSING) return "progressing";
    if (finding === V.FINDING.NOT_PROGRESSING) return "not-progressing";
    if (finding === V.FINDING.IN_TREATMENT) return "in-treatment";
    return "none";
  }

  function renderVerdict(result) {
    var d = result.structure.design;
    var causalClass = result.causal.level;
    $("verdict").className = "verdict " + findingClass(result.finding);
    $("verdict").innerHTML =
      '<div class="vhead">' +
        '<span class="vfinding">' + esc(result.finding) + "</span>" +
        '<span class="vcausal ' + esc(causalClass) + '">' + esc(result.causal.headline) + "</span>" +
        '<span class="vcausal">' + esc(d.label) + " &middot; " +
          result.rating.demonstrations + "/" + result.rating.required + " demonstrations</span>" +
      "</div>" +
      '<div class="vbody">' +
        result.rationale.map(function (line) { return "<p>" + esc(line) + "</p>"; }).join("") +
      "</div>" +
      '<div class="vcausal-body">' + esc(result.causal.body) +
        (result.endsInWithdrawal
          ? " This record currently sits in a withdrawal phase, so the finding above speaks to the most recent intervention onset rather than to the terminal phase."
          : "") +
        (result.causalNote ? "<p style=\"margin:8px 0 0\">" + esc(result.causalNote) + "</p>" : "") +
      "</div>";
  }

  function renderTiles(result) {
    if (!result.primary) { $("tiles").innerHTML = ""; return; }
    var p = result.primary;
    var nap = p.overlap.nap;
    var tiles = [
      ["Level change, median", (p.level.deltaMedian > 0 ? "+" : "") + r1(p.level.deltaMedian),
        p.level.therapeutic ? "therapeutic direction" : "countertherapeutic direction"],
      // Tied values across phases are ordinary in count data, so the exact test
      // is often unavailable. Falling back to the interval keeps the tile
      // informative instead of only explaining its own silence.
      ["NAP", r2(nap.value),
        nap.exact && nap.exact.available
          ? "exact p " + (nap.exact.p < 0.001 ? "<.001" : r2(nap.exact.p))
          : (nap.ciDegenerate
            ? "complete separation"
            : "95% CI " + r2(nap.ciLow) + " to " + r2(nap.ciHigh))],
      ["Immediacy, 3 vs 3", p.immediacy.available ? (p.immediacy.delta > 0 ? "+" : "") + r1(p.immediacy.delta) : "n/a",
        p.immediacy.available && p.immediacy.therapeutic ? "immediate change present" : "no immediate change"],
      ["Dual-criteria", p.cdc.available ? p.cdc.k + "/" + p.cdc.n : "n/a",
        p.cdc.available ? "need " + p.cdc.critical + " to call an effect" : (p.cdc.reason || "")],
      ["Intervention trend", S.isNum(p.trend.toSlope) ? (p.trend.toSlope > 0 ? "+" : "") + r2(p.trend.toSlope) : "n/a",
        p.trend.therapeutic ? "therapeutic direction" : "countertherapeutic or flat"],
      ["Magnitude", p.lrr.available ? (p.lrr.pctChange > 0 ? "+" : "") + Math.round(p.lrr.pctChange) + "%" : "n/a",
        p.lrr.available ? "change from baseline" : (p.lrr.reason || "")],
    ];
    $("tiles").innerHTML = tiles.map(function (t) {
      return '<div class="tile"><div class="lab">' + esc(t[0]) + '</div><div class="val">' +
        esc(t[1]) + '</div><div class="note">' + esc(t[2]) + "</div></div>";
    }).join("");
  }

  function renderLegacy(result) {
    if (!result.primary) { $("legacyBox").classList.add("hidden"); return; }
    $("legacyBox").classList.remove("hidden");
    var o = result.primary.overlap;
    var rows = [
      ["PND", pctS(o.pnd), "Depends entirely on the single most extreme baseline point, so one outlier destroys it. Its expected value also shrinks as the baseline lengthens even when nothing else changes. No sampling distribution exists, so it carries no confidence interval."],
      ["PEM", pctS(o.pem), "Scores full credit for any point past the baseline median regardless of magnitude, so it ceilings almost immediately, and it ignores baseline variability entirely."],
      ["Tau-U", r2(o.tauU), "Tarlow (2017) showed its baseline-trend control produces unacceptable Type I error. It is not bounded to plus or minus 1 because its feasible range moves with phase length, it has no valid sampling distribution, and it cannot be drawn on the graph."],
      ["Overlap", pctS(o.inside), "Proportion of intervention points falling inside the baseline range. Descriptive only."],
    ];
    $("legacy").innerHTML = rows.map(function (row) {
      return '<div class="legacy-item"><div>' + esc(row[0]) + '</div><div class="n">' +
        esc(row[1]) + '</div><div class="why">' + esc(row[2]) + "</div></div>";
    }).join("");
  }

  function renderMetrics(result) {
    var tb = $("metrics").querySelector("tbody");
    tb.innerHTML = result.structure.phases.map(function (p) {
      var d = V.describePhase(p, result.direction, { stabilityWidth: options().stabilityWidth });
      var stabCell = d.stability.subGrain
        ? "n/a"
        : pctS(d.stability.proportion) + (d.stability.stable ? "" : " ✗");
      return '<tr class="' + (p.cond === "tx" ? "tx" : "") + '">' +
        "<td>" + esc(p.name) + "</td>" +
        "<td>" + (p.cond === "tx" ? "Tx" : "Base") + "</td>" +
        "<td>" + p.n + "</td>" +
        "<td>" + r1(d.mean) + "</td>" +
        "<td>" + r1(d.median) + "</td>" +
        "<td>" + r1(d.min) + " to " + r1(d.max) + "</td>" +
        "<td>" + r1(d.sd) + "</td>" +
        "<td>" + r1(d.mad) + "</td>" +
        "<td>" + (S.isNum(d.slope) ? (d.slope > 0 ? "+" : "") + r2(d.slope) : "n/a") + "</td>" +
        "<td>" + stabCell + "</td>" +
        "</tr>";
    }).join("");
  }

  function renderTransitions(result) {
    var t = result.transitions;
    if (!t.length) {
      $("transitions").innerHTML = '<p class="fineprint" style="margin:0">This record contains no condition change, so there is nothing to compare across phases.</p>';
      return;
    }
    var html = t.map(function (a) {
      var nap = a.overlap.nap;
      var bits = [
        "Level " + (a.level.deltaMedian > 0 ? "+" : "") + r1(a.level.deltaMedian),
        "NAP " + r2(nap.value),
        "Trend " + (S.isNum(a.trend.fromSlope) ? r2(a.trend.fromSlope) : "n/a") + " → " +
          (S.isNum(a.trend.toSlope) ? r2(a.trend.toSlope) : "n/a"),
        a.trend.reversal && a.trend.reversal.present
          ? "slope reversed at the line" + (a.trend.reversal.immediate ? ", immediate" : ", not immediate") +
            (a.trend.reversal.cyclicalCaution ? " (cyclical caution)" : "")
          : (a.trend.signInversion === true ? "slope sign inverted" : null),
        a.cdc.available ? "CDC " + a.cdc.k + "/" + a.cdc.n + " (need " + a.cdc.critical + ")" : null,
      ].filter(Boolean);
      return '<div class="legacy-item" style="grid-template-columns:1fr">' +
        "<div><strong>" + esc(a.transition.letters) + "</strong> &middot; " +
        esc(a.transition.from.name) + " → " + esc(a.transition.to.name) +
        (a.transition.eligible
          ? ' <span class="vcausal functional">counts</span>'
          : ' <span class="vcausal correlation">does not count: ' + esc(a.transition.ineligibleReason) + "</span>") +
        '</div><div class="why">' + esc(bits.join("  ·  ")) + "</div></div>";
    }).join("");

    var extra = "";
    if (result.reversibility.available) {
      extra += '<p class="fineprint"><strong>Reversibility (WWC v5.0).</strong> ' +
        result.reversibility.phases.map(function (p) {
          return esc(p.name) + ": NAP " + r2(p.nap) + " against the initial baseline, " +
            (p.reversed ? "at or below the 0.85 bar, so minimal reversibility was achieved" :
              "above the 0.85 bar, so reversibility is incomplete and the rating is capped");
        }).join("; ") + ".</p>";
    }
    if (result.consistency.available) {
      extra += '<p class="fineprint"><strong>Consistency across like phases.</strong> ' +
        result.consistency.pairs.map(function (p) {
          return esc(p.label) + " NAP " + r2(p.nap) + (p.consistent ? " (alike)" : " (differs)");
        }).join("; ") + ". Phases in the same condition should resemble each other, so a value near 0.50 is the desirable result here.</p>";
    }
    $("transitions").innerHTML = html + extra;
  }

  // --- editor --------------------------------------------------------------

  function drawEditor() {
    $("phases").innerHTML = state.phases.map(function (p, i) {
      return '<div class="phase-row">' +
        '<input type="text" value="' + esc(p.name) + '" data-i="' + i + '" data-k="name" aria-label="Phase name">' +
        '<select data-i="' + i + '" data-k="cond" aria-label="Condition">' +
          '<option value="base"' + (p.cond === "base" ? " selected" : "") + ">Baseline</option>" +
          '<option value="tx"' + (p.cond === "tx" ? " selected" : "") + ">Intervention</option>" +
        "</select>" +
        '<textarea data-i="' + i + '" data-k="data" rows="1" aria-label="Values">' + esc(p.data) + "</textarea>" +
        '<button data-del="' + i + '" aria-label="Remove phase">Remove</button>' +
        "</div>";
    }).join("");
  }

  // --- graph read ----------------------------------------------------------

  var EXTRACT_PROMPT = [
    "You are reading a single-case behavior-analytic graph so that a BCBA can run visual analysis on the numbers.",
    "Read only what is on the image. Do not analyze, interpret, or judge effectiveness.",
    "",
    "Return one JSON object and nothing else. No prose, no markdown fences.",
    "",
    "{",
    '  "target": "behavior name from the graph title, or null",',
    '  "ordinate": "y-axis label as printed, or null",',
    '  "direction": "dec if the behavior is one a team would want to reduce, inc if it is a skill being built, unknown if unclear",',
    '  "phases": [',
    '    {"name": "phase or condition label, including any text printed on the vertical phase change line", "cond": "base or tx", "data": [numbers in session order]}',
    "  ],",
    '  "uncertainties": ["each point or label you could not read with confidence, described plainly"]',
    "}",
    "",
    "Rules:",
    "- Never return a person's name. If a name appears anywhere on the image, write [NAME] in its place and note it in uncertainties.",
    "- If data labels are printed next to the points, use those printed numbers. Only estimate from pixel position when no label is printed, and list every estimated point in uncertainties.",
    "- Split the series at every vertical phase change line. Text printed on a phase line is that phase's name.",
    "- Series with different markers or colors are different conditions. Use the legend to decide which are baseline and which are intervention. Vertical lines separating segments of the same series are within-condition changes, so set cond to base for all of them if the legend says baseline.",
    "- Keep sessions in left-to-right order. Do not sort, smooth, average, or fill gaps.",
    "- If a phase has no readable points, give it an empty data array and say so in uncertainties.",
    "- Report what is printed even when it looks wrong. Note the apparent problem in uncertainties instead of correcting it.",
    "- If the image holds several separate graphs, read only the first panel and say in uncertainties that the other panels were not read.",
    "- Keep uncertainties brief. One short line each, ten entries at most.",
  ].join("\n");

  function st(msg, cls) {
    var el = $("status");
    el.textContent = msg;
    el.className = "status" + (cls ? " " + cls : "");
  }

  function parseJSON(text) {
    var t = text.replace(/```json|```/g, "").trim();
    var a = t.indexOf("{");
    var b = t.lastIndexOf("}");
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    return JSON.parse(t);
  }

  function repairJSON(text) {
    var t = text.replace(/```json|```/g, "").trim();
    var cuts = [];
    for (var i = t.length - 1; i >= 0 && cuts.length < 60; i--) if (t[i] === "}") cuts.push(i);
    for (var c = 0; c < cuts.length; c++) {
      var tails = ["]}", "}]}", '"]}', "]}]}"];
      for (var k = 0; k < tails.length; k++) {
        try { return JSON.parse(t.slice(0, cuts[c] + 1) + tails[k]); } catch (e) { /* next */ }
      }
    }
    return null;
  }

  function callReader(baked, context) {
    var prompt = EXTRACT_PROMPT + (context
      ? "\n\nContext supplied by the analyst who owns this record:\n\"\"\"\n" + context.slice(0, 1200) +
        "\n\"\"\"\nUse it to decide which panel to read, what the units are, which segments are baseline and which are intervention, and how to name phases. " +
        "It does not override the image. If it conflicts with what is printed on the graph, follow the graph and note the conflict in uncertainties. " +
        "Never add, adjust, or infer a data point on the strength of the context alone."
      : "");

    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, REQUEST_TIMEOUT_MS);

    return fetch(NotesGate.apiUrl("/api/llm-call"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + NotesGate.token() },
      signal: ctrl.signal,
      body: JSON.stringify({
        tool: TOOL_ID,
        model: "claude-sonnet-5",
        maxTokens: 8000,
        systemPrompt: "You transcribe data from behavior-analytic graphs into JSON. You never interpret and you never return a person's name.",
        userPrompt: prompt,
        images: [{ media_type: baked.mediaType, data: baked.base64 }],
      }),
    }).catch(function (e) {
      if (e && e.name === "AbortError") throw new Error("The reader timed out. Try a smaller crop.");
      throw e;
    }).then(function (res) {
      return res.text().then(function (raw) {
        var data;
        try { data = JSON.parse(raw); } catch (e) {
          throw new Error("The server returned something that was not JSON (" + res.status + ").");
        }
        if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ").");
        return data;
      });
    }).finally(function () { clearTimeout(timer); });
  }

  function applyExtraction(out) {
    if (!out.phases || !out.phases.length) throw new Error("No phases were returned. Try a larger or sharper image.");
    state.phases = out.phases.map(function (p) {
      return {
        name: String(p.name || "Phase").slice(0, 60),
        cond: p.cond === "tx" ? "tx" : "base",
        data: Array.isArray(p.data) ? p.data.join(", ") : String(p.data || ""),
      };
    });
    if (out.direction === "dec" || out.direction === "inc") $("direction").value = out.direction;
    drawEditor();
    render();

    var u = Array.isArray(out.uncertainties) ? out.uncertainties.filter(Boolean) : [];
    var banner = $("verifyBanner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "verifyBanner";
      banner.className = "banner";
      $("phases").parentNode.insertBefore(banner, $("phases"));
    }
    banner.innerHTML = "<strong>Verify before use.</strong> These values were read from an image and can be misread, " +
      "particularly where points are unlabeled, overlapping, or compressed. Check every phase against the source graph and correct it below." +
      (u.length ? "<ul>" + u.map(function (x) { return "<li>" + esc(String(x)) + "</li>"; }).join("") + "</ul>" : "");
    return state.phases.reduce(function (acc, p) { return acc + window.GVA_DESIGN.parseValues(p.data).length; }, 0);
  }

  // --- auth ----------------------------------------------------------------

  function syncAuth() {
    var loggedIn = !!(window.NotesGate && NotesGate.isLoggedIn());
    var canUse = loggedIn && !!(window.NotesGate && NotesGate.canUseTool(TOOL_ID));
    var btn = $("extract");
    btn.textContent = !loggedIn ? "Log in to read a graph" : (canUse ? "Read graph" : "No access for this tool");
    btn.disabled = loggedIn && !canUse;
    $("logout").classList.toggle("hidden", !loggedIn);
  }

  // --- events --------------------------------------------------------------

  function bind() {
    ["direction", "scale", "design", "view", "envWidth"].forEach(function (id) {
      $(id).addEventListener("change", render);
    });
    ["showMean", "showTrend", "showCDC", "showEnvelope"].forEach(function (id) {
      $(id).addEventListener("change", render);
    });

    $("phases").addEventListener("input", function (e) {
      var t = e.target;
      if (!t.dataset || t.dataset.k === undefined) return;
      state.phases[+t.dataset.i][t.dataset.k] = t.value;
      render();
    });
    $("phases").addEventListener("change", function (e) {
      var t = e.target;
      if (!t.dataset || t.dataset.k === undefined) return;
      state.phases[+t.dataset.i][t.dataset.k] = t.value;
      render();
    });
    $("phases").addEventListener("click", function (e) {
      var d = e.target.dataset.del;
      if (d === undefined || state.phases.length <= 1) return;
      state.phases.splice(+d, 1);
      drawEditor();
      render();
    });

    $("add").addEventListener("click", function () {
      state.phases.push({ name: "New phase", cond: "tx", data: "" });
      drawEditor();
      render();
    });
    $("reset").addEventListener("click", function () {
      state.phases = JSON.parse(JSON.stringify(SAMPLE));
      drawEditor();
      render();
    });
    $("clear").addEventListener("click", function () {
      state.phases = [{ name: "Baseline", cond: "base", data: "" }, { name: "Intervention", cond: "tx", data: "" }];
      drawEditor();
      render();
    });
    $("copy").addEventListener("click", function () {
      var result = render();
      var opts = options();
      var head = ["Phase", "Cond", "n", "Mean", "Median", "Min", "Max", "SD", "MAD", "TheilSen"].join("\t");
      var rows = result.structure.phases.map(function (p) {
        var d = V.describePhase(p, result.direction, { stabilityWidth: opts.stabilityWidth });
        return [p.name, p.cond, p.n, r1(d.mean), r1(d.median), r1(d.min), r1(d.max), r1(d.sd), r1(d.mad), r2(d.slope)].join("\t");
      });
      var text = [head].concat(rows).join("\n") + "\n\n" + result.finding + " - " + result.causal.headline + "\n" +
        result.rationale.join(" ");
      navigator.clipboard.writeText(text).then(
        function () { $("copy").textContent = "Copied"; setTimeout(function () { $("copy").textContent = "Copy metrics as text"; }, 1600); },
        function () { $("copy").textContent = "Copy blocked by browser"; setTimeout(function () { $("copy").textContent = "Copy metrics as text"; }, 1600); }
      );
    });

    // Import
    $("drop").addEventListener("click", function () { $("file").click(); });
    $("drop").addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); }
    });
    $("drop").addEventListener("dragover", function (e) { e.preventDefault(); $("drop").classList.add("over"); });
    $("drop").addEventListener("dragleave", function () { $("drop").classList.remove("over"); });
    $("drop").addEventListener("drop", function (e) {
      e.preventDefault();
      $("drop").classList.remove("over");
      if (e.dataTransfer.files.length) loadImage(e.dataTransfer.files[0]);
    });
    $("file").addEventListener("change", function (e) {
      if (e.target.files.length) loadImage(e.target.files[0]);
    });
    document.addEventListener("paste", function (e) {
      if (e.clipboardData && e.clipboardData.files.length) loadImage(e.clipboardData.files[0]);
    });

    $("modeRedact").addEventListener("click", function () { setMode("redact"); });
    $("modeCrop").addEventListener("click", function () { setMode("crop"); });
    $("redactUndo").addEventListener("click", function () { state.editor && state.editor.undo(); });
    $("redactClear").addEventListener("click", function () { state.editor && state.editor.clear(); });
    $("redactDrop").addEventListener("click", clearImage);
    window.addEventListener("resize", function () { state.editor && state.editor.resize(); });

    $("extract").addEventListener("click", onExtract);
    $("logout").addEventListener("click", function () { NotesGate.logout(); });

    if (window.NotesGate && NotesGate.subscribe) NotesGate.subscribe(syncAuth);
  }

  function setMode(mode) {
    if (!state.editor) return;
    state.editor.setMode(mode);
    $("modeRedact").setAttribute("aria-pressed", String(mode === "redact"));
    $("modeCrop").setAttribute("aria-pressed", String(mode === "crop"));
  }

  function loadImage(file) {
    if (!state.editor) {
      state.editor = R.create($("redactHost"), {
        onChange: function (s) {
          $("redactState").textContent = s.loaded
            ? s.redactions + " blackout" + (s.redactions === 1 ? "" : "s") + (s.cropped ? ", cropped" : "")
            : "";
        },
      });
    }
    state.editor.load(file).then(function () {
      $("redactTools").classList.remove("hidden");
      $("drop").classList.add("hidden");
      st("Image loaded. Black out anything identifying, then select Read graph.");
    }).catch(function (err) { st(err.message, "err"); });
  }

  function clearImage() {
    if (state.editor) state.editor.reset();
    $("redactTools").classList.add("hidden");
    $("drop").classList.remove("hidden");
    $("file").value = "";
    st("");
  }

  function onExtract() {
    if (!window.NotesGate || !NotesGate.isLoggedIn()) { NotesGate.openLogin(); return; }
    if (!state.editor || !state.editor.summary().loaded) { st("Add a graph image first.", "err"); return; }

    var baked = state.editor.bake();
    if (!baked) { st("Could not compose the image.", "err"); return; }

    var btn = $("extract");
    btn.disabled = true;
    btn.textContent = "Reading";
    st("Reading the graph. This takes a few seconds.", "busy");

    callReader(baked, $("context").value.trim()).then(function (data) {
      var text = (data.content || []).filter(function (b) { return b.type === "text"; })
        .map(function (b) { return b.text; }).join("\n");
      if (!text.trim()) throw new Error("The model returned no text. Retry, or crop to one panel.");
      var out;
      var salvaged = false;
      try { out = parseJSON(text); }
      catch (e) {
        out = repairJSON(text);
        if (!out) {
          throw new Error(data.stop_reason === "max_tokens"
            ? "The reading ran past the length limit and was cut off. Crop to one panel and try again."
            : "The reply was not valid JSON.");
        }
        salvaged = true;
      }
      var n = applyExtraction(out);
      st("Read " + state.phases.length + " phases, " + n + " data points" +
        (out.target ? " for " + out.target : "") +
        (salvaged ? ". The reading was cut off and partly recovered, so later phases may be incomplete" : "") +
        ". Verify against the source graph before use.", salvaged ? "err" : "ok");
    }).catch(function (err) {
      st(String(err.message || err), "err");
    }).finally(function () {
      btn.disabled = false;
      syncAuth();
    });
  }

  // --- boot ----------------------------------------------------------------

  function start() {
    var draft = loadDraft();
    state.phases = (draft && Array.isArray(draft.phases) && draft.phases.length)
      ? draft.phases
      : JSON.parse(JSON.stringify(SAMPLE));
    if (draft && draft.direction) $("direction").value = draft.direction;
    if (draft && draft.scale) $("scale").value = draft.scale;

    bind();
    drawEditor();
    render();
    syncAuth();
  }

  function boot() {
    // Saved drafts are encrypted at rest and decrypt asynchronously into the
    // gate's cache. Reading the cache before `draft.ready` resolves returns
    // nothing, so the record would silently reset to the sample on every
    // reload. Binding is deferred with it, so no handler can call render()
    // against an unpopulated state and clobber the stored draft with the
    // sample record.
    var ready = (window.NotesGate && NotesGate.draft && NotesGate.draft.ready) || Promise.resolve();
    Promise.resolve(ready).then(start, start);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
