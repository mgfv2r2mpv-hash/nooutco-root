/* Goal row order for the supervision tool.
 *
 * WHAT THIS IS. The rules for putting Goals Analyzed rows in an order a
 * supervisor expects, and for learning that order from the supervisor's own
 * drags. No DOM and no model call.
 *
 * CATEGORIES. A row belongs to one of four: reduction (behavior reduction and
 * safety), communication, play (play, leisure, social), other. The default
 * order is that list. Reduction is classified by the caller, who knows which
 * goals are reduction targets; the rest by words in the goal name.
 *
 * LEARNING. Dragging a row to sit beside a row of another category moves the
 * dragged row's CATEGORY, not the row. A supervisor who puts a play goal above
 * the communication goals has said play comes first, and every later swap or
 * draft keeps that. Dropping a row among its own category learns nothing.
 *
 * PRIVACY. What is stored in localStorage is the order of the four category
 * names and nothing else: no goal name, no note text, no client detail.
 */
(function () {
  "use strict";

  var CATEGORIES = ["reduction", "communication", "play", "other"];
  var KEY = "nome_goal_category_order_v1";

  var COMMUNICATION = /\b(mand|mands|request|requests|requesting|ask|asks|asking|tact|tacts|label|labels|labeling|labelling|vocal|verbal|speech|communicat\w*|intraverbal\w*|echoic|receptive|expressive|greet\w*|answer\w*|respond\w*|follow\w* (?:instruction|direction)\w*|instruction\w*|direction\w*|aac|pecs|sign|signs|words?)\b/i;
  var PLAY = /\b(play\w*|leisure|social\w*|peer\w*|turn[- ]?tak\w*|shar(?:e|es|ing)|game|games|toy|toys|imitat\w*|conversation\w*|friend\w*|joint attention|cooperat\w*)\b/i;

  function categoryOf(name, isReduction) {
    if (isReduction) return "reduction";
    var n = String(name || "");
    if (COMMUNICATION.test(n)) return "communication";
    if (PLAY.test(n)) return "play";
    return "other";
  }

  // A stored order is trusted only as far as it names real categories, once
  // each. Anything missing goes to the end in default order.
  function clean(order) {
    var out = [];
    (Array.isArray(order) ? order : []).forEach(function (c) {
      if (CATEGORIES.indexOf(c) !== -1 && out.indexOf(c) === -1) out.push(c);
    });
    CATEGORIES.forEach(function (c) { if (out.indexOf(c) === -1) out.push(c); });
    return out;
  }

  function isDefault(order) {
    var o = clean(order);
    return o.every(function (c, i) { return c === CATEGORIES[i]; });
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      return raw ? clean(JSON.parse(raw)) : CATEGORIES.slice();
    } catch (e) {
      return CATEGORIES.slice();
    }
  }

  function save(order) {
    try {
      if (isDefault(order)) window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, JSON.stringify(clean(order)));
    } catch (e) { /* storage can be blocked; the order then lasts for the page */ }
  }

  function reset() {
    try { window.localStorage.removeItem(KEY); } catch (e) { /* see save */ }
    return CATEGORIES.slice();
  }

  // Stable: rows of one category keep the order they have.
  function sortRows(rows, order, catOf) {
    var o = clean(order);
    return rows
      .map(function (r, i) { return { r: r, i: i, k: o.indexOf(catOf(r)) }; })
      .sort(function (a, b) { return a.k - b.k || a.i - b.i; })
      .map(function (x) { return x.r; });
  }

  // The order after a row was dropped at `index` of `rowsAfter`. The moved row's
  // category goes before the category of the row now below it, else after the
  // category of the row now above it. Same category on both sides: unchanged.
  function learn(order, rowsAfter, index, catOf) {
    var o = clean(order);
    var c = catOf(rowsAfter[index]);
    var below = rowsAfter[index + 1] ? catOf(rowsAfter[index + 1]) : null;
    var above = rowsAfter[index - 1] ? catOf(rowsAfter[index - 1]) : null;
    var rest = o.filter(function (x) { return x !== c; });
    if (below && below !== c) {
      rest.splice(rest.indexOf(below), 0, c);
      return rest;
    }
    if (above && above !== c) {
      rest.splice(rest.indexOf(above) + 1, 0, c);
      return rest;
    }
    return o;
  }

  window.GoalOrder = {
    CATEGORIES: CATEGORIES,
    KEY: KEY,
    categoryOf: categoryOf,
    clean: clean,
    isDefault: isDefault,
    load: load,
    save: save,
    reset: reset,
    sortRows: sortRows,
    learn: learn,
  };
})();
